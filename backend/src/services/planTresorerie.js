/**
 * Plan de tresorerie d'un dossier : collecte des donnees (Dossier de calcul,
 * echeanciers, commandes, simulation de financement) puis appel du moteur.
 * Les parametres propres au dossier sont dans plan_tresorerie (migration 045).
 */
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { chargerParametres } = require("./produitsCatalogue");
const { calculerOffre } = require("./calculPrixEngine");
const echeancierSvc = require("./echeancier");
const engine = require("./planTresorerieEngine");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const arr2 = (n) => Math.round(Number(n) * 100) / 100;
const jour = (d) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function colonne(type) {
  return type === "ao" ? "dossier_ao_id" : type === "consultation" ? "consultation_id" : null;
}

async function dossierDuTenant(tenantId, type, id) {
  if (!UUID_RE.test(String(id))) return null;
  if (type === "ao") {
    const r = await db.query(
      `SELECT d.id, d.intitule AS libelle, d.reference_externe AS reference, mo.nom AS client_nom
       FROM dossier_ao d LEFT JOIN maitre_ouvrage mo ON mo.id = d.maitre_ouvrage_id WHERE d.id = $1 AND d.tenant_id = $2`,
      [id, tenantId]
    );
    return r.rows[0] ? { ...r.rows[0], type: "ao" } : null;
  }
  const r = await db.query(
    `SELECT c.id, c.objet AS libelle, c.client_commercial_id, cl.nom AS client_nom, cl.echeancier_json AS client_echeancier
     FROM consultation c LEFT JOIN client_commercial cl ON cl.id = c.client_commercial_id WHERE c.id = $1 AND c.tenant_id = $2`,
    [id, tenantId]
  );
  return r.rows[0] ? { ...r.rows[0], type: "consultation" } : null;
}

const PARAMS_DEFAUT = () => ({
  date_t: new Date().toISOString().slice(0, 10),
  base: "TTC",
  hors_douane: false,
  apport_xof: 0,
  pas: "AUTO",
  marge_jours: 15,
  jalons: {},
  avec_financement: true,
  simulation_id: null,
  condition_id: null,
  echeancier_client: null,
  echeanciers_fournisseurs: {},
  autres_flux: [],
});

function paramsDepuisLigne(r) {
  return {
    date_t: jour(r.date_t),
    base: r.base,
    hors_douane: r.hors_douane,
    apport_xof: Number(r.apport_xof),
    pas: r.pas,
    marge_jours: r.marge_jours,
    jalons: r.jalons_json || {},
    avec_financement: r.avec_financement,
    simulation_id: r.simulation_id,
    condition_id: r.condition_id,
    echeancier_client: echeancierSvc.lire(r.echeancier_client_json),
    echeanciers_fournisseurs: r.echeanciers_fournisseurs_json || {},
    autres_flux: Array.isArray(r.autres_flux_json) ? r.autres_flux_json : [],
    enregistre: true,
  };
}

async function chargerParams(tenantId, type, id) {
  const col = colonne(type);
  const r = await db.query(`SELECT * FROM plan_tresorerie WHERE tenant_id = $1 AND ${col} = $2`, [tenantId, id]);
  return r.rows[0] ? paramsDepuisLigne(r.rows[0]) : { ...PARAMS_DEFAUT(), enregistre: false };
}

/** Valide et nettoie les parametres recus. Retourne { params } ou { erreur }. */
function nettoyerParams(b, existants) {
  const p = { ...PARAMS_DEFAUT(), ...(existants || {}) };
  if (b.date_t !== undefined) {
    if (!DATE_RE.test(String(b.date_t))) return { erreur: "PLAN_DATE_INVALIDE" };
    p.date_t = String(b.date_t);
  }
  if (b.base !== undefined) {
    if (!["TTC", "HT"].includes(b.base)) return { erreur: "PLAN_PARAM_INVALIDE" };
    p.base = b.base;
  }
  if (b.hors_douane !== undefined) p.hors_douane = !!b.hors_douane;
  if (b.apport_xof !== undefined) {
    const n = Number(String(b.apport_xof === "" ? 0 : b.apport_xof).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return { erreur: "PLAN_PARAM_INVALIDE" };
    p.apport_xof = n;
  }
  if (b.pas !== undefined) {
    if (!["AUTO", "JOUR", "SEMAINE", "MOIS"].includes(b.pas)) return { erreur: "PLAN_PARAM_INVALIDE" };
    p.pas = b.pas;
  }
  if (b.marge_jours !== undefined) {
    const n = Math.round(Number(b.marge_jours));
    if (!Number.isFinite(n) || n < 0 || n > 365) return { erreur: "PLAN_PARAM_INVALIDE" };
    p.marge_jours = n;
  }
  if (b.jalons !== undefined) {
    const j = {};
    for (const k of Object.keys(engine.JALONS_DEFAUT)) {
      const v = b.jalons && b.jalons[k];
      if (v === undefined || v === null || v === "") continue;
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > 720) return { erreur: "PLAN_PARAM_INVALIDE" };
      j[k] = n;
    }
    p.jalons = j;
  }
  if (b.avec_financement !== undefined) p.avec_financement = !!b.avec_financement;
  if (b.simulation_id !== undefined) p.simulation_id = b.simulation_id && UUID_RE.test(b.simulation_id) ? b.simulation_id : null;
  if (b.condition_id !== undefined) p.condition_id = b.condition_id && UUID_RE.test(b.condition_id) ? b.condition_id : null;
  if (b.echeancier_client !== undefined) {
    if (b.echeancier_client === null || (Array.isArray(b.echeancier_client) && b.echeancier_client.length === 0)) p.echeancier_client = null;
    else {
      const n = echeancierSvc.normaliser(b.echeancier_client);
      if (n.erreur) return { erreur: n.erreur };
      p.echeancier_client = n.lignes;
    }
  }
  if (b.echeanciers_fournisseurs !== undefined) {
    const out = {};
    for (const [fid, lignes] of Object.entries(b.echeanciers_fournisseurs || {})) {
      if (!UUID_RE.test(fid) || !Array.isArray(lignes) || lignes.length === 0) continue;
      const n = echeancierSvc.normaliser(lignes);
      if (n.erreur) return { erreur: n.erreur };
      out[fid] = n.lignes;
    }
    p.echeanciers_fournisseurs = out;
  }
  if (b.autres_flux !== undefined) {
    const out = [];
    for (const a of Array.isArray(b.autres_flux) ? b.autres_flux : []) {
      const montant = Number(String(a.montant ?? "").replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(montant) || montant <= 0) continue;
      const ligne = { libelle: String(a.libelle || "").trim().slice(0, 120), sens: a.sens === "ENTREE" ? "ENTREE" : "SORTIE", montant };
      if (a.date && DATE_RE.test(String(a.date))) ligne.date = String(a.date);
      else if (a.evenement && echeancierSvc.EVENEMENTS.includes(a.evenement)) {
        ligne.evenement = a.evenement;
        ligne.jours = Math.max(0, Math.min(720, Math.round(Number(a.jours) || 0)));
      }
      out.push(ligne);
    }
    p.autres_flux = out.slice(0, 30);
  }
  return { params: p };
}

async function sauverParams(tenantId, userId, type, id, p) {
  const col = colonne(type);
  const ex = await db.query(`SELECT id FROM plan_tresorerie WHERE tenant_id = $1 AND ${col} = $2`, [tenantId, id]);
  const echClient = p.echeancier_client ? JSON.stringify(p.echeancier_client) : null;
  if (ex.rows[0]) {
    await db.query(
      `UPDATE plan_tresorerie SET date_t = $1, base = $2, hors_douane = $3, apport_xof = $4, pas = $5, marge_jours = $6, jalons_json = $7,
              avec_financement = $8,
              simulation_id = (SELECT id FROM financement_simulation WHERE id = $9 AND tenant_id = $14),
              condition_id = (SELECT id FROM financement_condition WHERE id = $10 AND tenant_id = $14),
              echeancier_client_json = $11, echeanciers_fournisseurs_json = $12, autres_flux_json = $13, date_maj = now()
       WHERE id = $15 AND tenant_id = $14`,
      [p.date_t, p.base, p.hors_douane, p.apport_xof, p.pas, p.marge_jours, JSON.stringify(p.jalons || {}), p.avec_financement,
        p.simulation_id, p.condition_id, echClient, JSON.stringify(p.echeanciers_fournisseurs || {}), JSON.stringify(p.autres_flux || []), tenantId, ex.rows[0].id]
    );
  } else {
    await db.query(
      `INSERT INTO plan_tresorerie (id, tenant_id, ${col}, date_t, base, hors_douane, apport_xof, pas, marge_jours, jalons_json, avec_financement,
              simulation_id, condition_id, echeancier_client_json, echeanciers_fournisseurs_json, autres_flux_json, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               (SELECT id FROM financement_simulation WHERE id = $12 AND tenant_id = $2),
               (SELECT id FROM financement_condition WHERE id = $13 AND tenant_id = $2),
               $14, $15, $16, $17)`,
      [uuidv4(), tenantId, id, p.date_t, p.base, p.hors_douane, p.apport_xof, p.pas, p.marge_jours, JSON.stringify(p.jalons || {}), p.avec_financement,
        p.simulation_id, p.condition_id, echClient, JSON.stringify(p.echeanciers_fournisseurs || {}), JSON.stringify(p.autres_flux || []), userId || null]
    );
  }
}

/** Offres retenues du dossier, avec leur calcul. */
async function offresDuDossier(tenantId, type, id) {
  const col = colonne(type);
  const parametres = await chargerParametres(tenantId);
  const r = await db.query(
    `SELECT co.*, f.nom AS fournisseur_nom, f.echeancier_json AS fournisseur_echeancier
     FROM calcul_offre co
     JOIN calcul_article ca ON ca.id = co.calcul_article_id
     JOIN dossier_calcul dc ON dc.id = ca.dossier_calcul_id
     LEFT JOIN fournisseur f ON f.id = co.fournisseur_id
     WHERE dc.tenant_id = $1 AND dc.${col} = $2 AND co.retenue = true
     ORDER BY ca.ordre_affichage ASC`,
    [tenantId, id]
  );
  return r.rows.map((o) => ({ offre: o, calcul: calculerOffre(o, parametres) }));
}

async function simulationsDuDossier(tenantId, type, id) {
  const col = colonne(type);
  const r = await db.query(
    `SELECT id, libelle, type_facilite, montant, duree_jours, date_prise, date_echeance, statut, condition_retenue_id, releve_retenu_json,
            resultats_json, cout_retenu_xof, date_creation
     FROM financement_simulation WHERE tenant_id = $1 AND ${col} = $2 ORDER BY date_creation DESC`,
    [tenantId, id]
  );
  return r.rows;
}

function resumeSimulation(s) {
  const releves = (s.resultats_json && s.resultats_json.releves) || [];
  return {
    id: s.id,
    libelle: s.libelle,
    type_facilite: s.type_facilite,
    montant: Number(s.montant),
    duree_jours: s.duree_jours,
    date_prise: jour(s.date_prise),
    date_echeance: jour(s.date_echeance),
    statut: s.statut,
    condition_retenue_id: s.condition_retenue_id,
    banque_retenue: s.releve_retenu_json && s.releve_retenu_json.releve ? s.releve_retenu_json.releve.partenaire_nom : null,
    recommandee_id: s.resultats_json && s.resultats_json.classement ? s.resultats_json.classement.recommandee_id : null,
    banques: releves.map((r) => ({
      condition_id: r.condition_id,
      partenaire_nom: r.partenaire_nom,
      eligible: r.eligible,
      cout_ttc: r.totaux ? r.totaux.cout_ttc : null,
    })),
  };
}

/** Releve retenu pour le plan : { simulation, releve } ou null. */
function choisirFinancement(sims, params) {
  if (params.avec_financement === false) return null;
  let sim = null;
  if (params.simulation_id) sim = sims.find((s) => s.id === params.simulation_id) || null;
  if (!sim) sim = sims.find((s) => s.statut === "RETENUE" || s.statut === "CONTROLEE") || null;
  if (!sim) return null;
  const releves = (sim.resultats_json && sim.resultats_json.releves) || [];
  let releve = null;
  if (params.condition_id) releve = releves.find((r) => r.condition_id === params.condition_id) || null;
  if (!releve && sim.releve_retenu_json && sim.releve_retenu_json.releve) releve = sim.releve_retenu_json.releve;
  if (!releve && sim.resultats_json && sim.resultats_json.classement && sim.resultats_json.classement.recommandee_id) {
    releve = releves.find((r) => r.condition_id === sim.resultats_json.classement.recommandee_id) || null;
  }
  if (!releve) releve = releves.find((r) => r.eligible) || releves[0] || null;
  return releve ? { sim, releve } : null;
}

async function charger(tenantId, type, id, lang = "fr", surcharge) {
  const col = colonne(type);
  if (!col) return null;
  const dossier = await dossierDuTenant(tenantId, type, id);
  if (!dossier) return null;
  let params = await chargerParams(tenantId, type, id);
  if (surcharge) params = { ...params, ...surcharge };

  const offres = await offresDuDossier(tenantId, type, id);

  // ---- Vente (previsionnel) : Dossier de calcul, a defaut devis du dossier
  let vente = null;
  let sourceVente = null;
  if (offres.length > 0) {
    const ht = offres.reduce((s, x) => s + x.calcul.montantTotalArrondiHt, 0);
    const tva = offres.reduce((s, x) => s + x.calcul.tvaVente, 0);
    vente = { ht: arr2(ht), tva: arr2(tva), ttc: arr2(ht + tva) };
    sourceVente = "DOSSIER_CALCUL";
  }
  let devis = null;
  if (type === "consultation") {
    const d = await db.query(
      `SELECT id, numero, statut, total_ht, montant_tva, total_ttc, echeancier_json FROM devis
       WHERE tenant_id = $1 AND consultation_id = $2 AND statut NOT IN ('REFUSE', 'EXPIRE')
       ORDER BY (statut = 'VALIDE') DESC, date_creation DESC LIMIT 1`,
      [tenantId, id]
    );
    devis = d.rows[0] || null;
    if (!vente && devis) {
      vente = { ht: Number(devis.total_ht), tva: Number(devis.montant_tva), ttc: Number(devis.total_ttc) };
      sourceVente = "DEVIS";
    }
  }

  // ---- Echeancier client : plan > devis > fiche client
  let echClient = null;
  let sourceClient = null;
  if (params.echeancier_client) {
    echClient = params.echeancier_client;
    sourceClient = "PLAN";
  } else if (devis && echeancierSvc.lire(devis.echeancier_json)) {
    echClient = echeancierSvc.lire(devis.echeancier_json);
    sourceClient = "DEVIS";
  } else if (dossier.client_echeancier && echeancierSvc.lire(dossier.client_echeancier)) {
    echClient = echeancierSvc.lire(dossier.client_echeancier);
    sourceClient = "FICHE_CLIENT";
  }

  // ---- Achats par fournisseur : plan > commande > fiche fournisseur
  const groupes = new Map();
  for (const x of offres) {
    const fid = x.offre.fournisseur_id;
    if (!groupes.has(fid)) groupes.set(fid, { fournisseur_id: fid, fournisseur_nom: x.offre.fournisseur_nom, montant_xof: 0, fiche: echeancierSvc.lire(x.offre.fournisseur_echeancier) });
    groupes.get(fid).montant_xof += x.calcul.prixAchatTotalXof;
  }
  const commandes = (
    await db.query(
      `SELECT fournisseur_id, echeancier_json FROM commande_fournisseur
       WHERE tenant_id = $1 AND ${col} = $2 AND statut <> 'ANNULEE' AND echeancier_json IS NOT NULL ORDER BY date_creation DESC`,
      [tenantId, id]
    )
  ).rows;
  const achats = [];
  for (const g of groupes.values()) {
    let ech = null;
    let source = null;
    const surch = params.echeanciers_fournisseurs && params.echeanciers_fournisseurs[g.fournisseur_id];
    if (echeancierSvc.lire(surch)) {
      ech = surch;
      source = "PLAN";
    } else {
      const c = commandes.find((k) => k.fournisseur_id === g.fournisseur_id && echeancierSvc.lire(k.echeancier_json));
      if (c) {
        ech = echeancierSvc.lire(c.echeancier_json);
        source = "COMMANDE";
      } else if (g.fiche) {
        ech = g.fiche;
        source = "FICHE_FOURNISSEUR";
      }
    }
    achats.push({ fournisseur_id: g.fournisseur_id, fournisseur_nom: g.fournisseur_nom, montant_xof: arr2(g.montant_xof), echeancier: ech, source });
  }

  // ---- Frais d'approche (Dossier de calcul)
  const somme = (fn) => arr2(offres.reduce((s, x) => s + fn(x), 0));
  const frais = {
    fret: somme((x) => Number(x.offre.fret_alloue_xof) || 0),
    assurance: somme((x) => x.calcul.assurance),
    transit: somme((x) => Number(x.offre.frais_transit_xof) || 0),
    droits_douane: somme((x) => x.calcul.droitDouane + x.calcul.redevanceStatistique + x.calcul.pcs + x.calcul.pccCosec),
    tva_import: somme((x) => x.calcul.tvaImport),
    frais_paiement: somme((x) => x.calcul.totalFraisBancaires),
  };

  // ---- Financement
  const sims = await simulationsDuDossier(tenantId, type, id);
  const choix = choisirFinancement(sims, params);
  let financement = null;
  if (choix) {
    financement = {
      libelle: choix.sim.libelle || null,
      type_facilite: choix.sim.type_facilite,
      montant: Number(choix.sim.montant),
      duree_jours: choix.sim.duree_jours,
      date_prise: jour(choix.sim.date_prise),
      date_echeance: jour(choix.sim.date_echeance),
      releve: choix.releve,
      simulation_id: choix.sim.id,
      condition_id: choix.releve.condition_id,
    };
  }

  const clientNom = dossier.client_nom || null;
  const plan = engine.construirePlan(
    {
      date_t: params.date_t,
      base: params.base,
      hors_douane: params.hors_douane,
      apport_xof: params.apport_xof,
      pas: params.pas,
      marge_jours: params.marge_jours,
      jalons: params.jalons,
      vente: vente ? { ...vente, client_nom: clientNom, echeancier: echClient } : null,
      achats,
      frais,
      autres: params.autres_flux,
      financement,
    },
    lang
  );

  return {
    dossier: { type, id, libelle: dossier.libelle, reference: dossier.reference || null, client_nom: clientNom },
    params,
    sources: {
      vente: sourceVente,
      client: { source: sourceClient, echeancier: echClient, nom: clientNom },
      fournisseurs: achats.map((a) => ({ fournisseur_id: a.fournisseur_id, nom: a.fournisseur_nom, montant_xof: a.montant_xof, source: a.source, echeancier: a.echeancier })),
      frais,
      vente_montants: vente,
      financement: financement
        ? { simulation_id: financement.simulation_id, condition_id: financement.condition_id, libelle: financement.libelle, banque: financement.releve.partenaire_nom }
        : null,
    },
    simulations_disponibles: sims.map(resumeSimulation),
    jalons_defaut: engine.JALONS_DEFAUT,
    plan,
  };
}

module.exports = { charger, chargerParams, nettoyerParams, sauverParams, dossierDuTenant, colonne, offresDuDossier, simulationsDuDossier, resumeSimulation };
