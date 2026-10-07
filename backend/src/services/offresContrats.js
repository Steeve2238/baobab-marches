/**
 * Super Admin : offres commerciales (devis) et contrats clients.
 *
 * Parcours : offre BROUILLON -> ENVOYEE (e-mail) -> ACCEPTEE (genere automatiquement le contrat PREPARE, signe cote editeur)
 * -> contrat ENVOYE -> SIGNE (contrat signe par le client depose dans la plateforme).
 * Les prix sont recalcules cote serveur ; le contrat est fige (contenu_json) a sa generation.
 */
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { construireArticles } = require("./contratModele");

class CommercialError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const STATUTS_OFFRE = ["BROUILLON", "ENVOYEE", "ACCEPTEE", "REFUSEE", "ANNULEE"];
const MODULES = {
  COMPTABILITE: "Comptabilité",
  FISCALITE: "Fiscalité",
  PAIE: "Paie",
};

const arrondi = (v) => Math.round(Number(v) || 0);
const texte = (v, max = 500) => {
  const s = String(v === undefined || v === null ? "" : v).trim();
  return s ? s.slice(0, max) : null;
};
const jourIso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

function ajouterMois(isoDate, mois) {
  const [a, m, j] = isoDate.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + mois, j));
  // si le jour a deborde (ex. 31 janvier + 1 mois), on revient au dernier jour du mois voulu
  if (d.getUTCDate() !== j) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
const veille = (isoDate) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

async function numeroSuivant(client, type, annee) {
  const r = await client.query(
    `INSERT INTO numerotation_commerciale (type, annee, dernier) VALUES ($1, $2, 1)
     ON CONFLICT (type, annee) DO UPDATE SET dernier = numerotation_commerciale.dernier + 1 RETURNING dernier`,
    [type, annee]
  );
  const prefixe = type === "OFFRE" ? "OFF" : "CTR";
  return `${prefixe}-${annee}-${String(r.rows[0].dernier).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Lignes et totaux
// ---------------------------------------------------------------------------

function nettoyerLignes(lignes) {
  if (!Array.isArray(lignes)) return [];
  const out = [];
  for (const l of lignes.slice(0, 40)) {
    const libelle = texte(l && l.libelle, 200);
    if (!libelle) continue;
    const quantite = Math.round((Number(l.quantite) || 0) * 100) / 100;
    const prix = arrondi(l.prix_unitaire);
    if (quantite <= 0 || prix < 0) throw new CommercialError("OFFRE_LIGNE_INVALIDE", 400, { libelle });
    out.push({ libelle, description: texte(l.description, 400), quantite, unite: texte(l.unite, 20) || "", prix_unitaire: prix, montant: arrondi(quantite * prix) });
  }
  return out;
}

function calculerTotaux(lignes, remisePct, tvaPct) {
  const sousTotal = lignes.reduce((t, l) => t + l.montant, 0);
  const remise = arrondi((sousTotal * remisePct) / 100);
  const ht = sousTotal - remise;
  const tva = arrondi((ht * tvaPct) / 100);
  return { sous_total: sousTotal, remise, total_ht: ht, total_tva: tva, total_ttc: ht + tva };
}

/** Lignes proposees pour une offre d'apres la formule, le mode d'hebergement, les modules et la duree. */
async function proposerLignes({ tenant_id, formule_id, mode, modules, duree_mois }) {
  const t = await db.query(
    `SELECT te.id, te.raison_sociale, te.adresse, te.ninea, te.rccm, te.email, te.signataire_nom, te.signataire_titre,
            te.formule_abonnement_id, te.mode_hebergement, te.module_comptabilite_prix_mensuel_xof, te.module_fiscalite_prix_mensuel_xof
     FROM tenant te WHERE te.id = $1`,
    [tenant_id]
  );
  const tenant = t.rows[0];
  if (!tenant) throw new CommercialError("SUPER_ADMIN_CLIENT_NOT_FOUND", 404);
  const fid = formule_id || tenant.formule_abonnement_id;
  if (!fid) throw new CommercialError("OFFRE_FORMULE_REQUISE", 400);
  const f = (await db.query(`SELECT * FROM formule_abonnement WHERE id = $1`, [fid])).rows[0];
  if (!f) throw new CommercialError("SUPER_ADMIN_FORMULE_NOT_FOUND", 404);
  const m = mode === "LOCAL" ? "LOCAL" : "HEBERGE";
  const duree = Math.max(1, Math.min(120, Number(duree_mois) || 12));
  const plafond = f.plafond_utilisateurs ? `jusqu'à ${f.plafond_utilisateurs} utilisateurs` : "utilisateurs illimités";
  const lignes = [];
  if (m === "HEBERGE") {
    lignes.push({ libelle: `Abonnement à la plateforme Baobab Marchés - formule ${f.nom}`, description: `Accès en ligne hébergé, ${plafond}, maintenance et mises à jour incluses`, quantite: duree, unite: "mois", prix_unitaire: arrondi(f.prix_mensuel_xof) });
  } else {
    lignes.push({ libelle: `Licence d'utilisation de Baobab Marchés - formule ${f.nom}`, description: `Version installée chez le client, ${plafond}, mises à jour et support pendant ${duree} mois`, quantite: Math.round((duree / 12) * 100) / 100, unite: "an", prix_unitaire: arrondi(f.prix_licence_annuelle_xof) });
  }
  const prixModule = { COMPTABILITE: arrondi(tenant.module_comptabilite_prix_mensuel_xof), FISCALITE: arrondi(tenant.module_fiscalite_prix_mensuel_xof), PAIE: 0 };
  for (const code of Array.isArray(modules) ? modules : []) {
    if (!MODULES[code]) continue;
    lignes.push({ libelle: `Module ${MODULES[code]}`, description: m === "HEBERGE" ? "Supplément mensuel" : "Supplément mensuel de licence", quantite: duree, unite: "mois", prix_unitaire: prixModule[code] || 0 });
  }
  if (arrondi(f.frais_installation_xof) > 0) {
    lignes.push({ libelle: "Frais d'installation et de paramétrage", description: "Une seule fois, à la mise en service", quantite: 1, unite: "forfait", prix_unitaire: arrondi(f.frais_installation_xof) });
  }
  return {
    lignes,
    formule: { id: f.id, nom: f.nom, plafond_utilisateurs: f.plafond_utilisateurs },
    client: {
      raison_sociale: tenant.raison_sociale,
      client_adresse: tenant.adresse,
      client_ninea: tenant.ninea,
      client_rccm: tenant.rccm,
      destinataire_email: tenant.email,
      representant_nom: tenant.signataire_nom,
      representant_fonction: tenant.signataire_titre,
    },
  };
}

// ---------------------------------------------------------------------------
// Offres
// ---------------------------------------------------------------------------

const SELECT_OFFRE = `
  SELECT o.*, te.raison_sociale AS client_raison_sociale,
         c.id AS contrat_id, c.numero AS contrat_numero, c.statut AS contrat_statut
  FROM offre_commerciale o
  JOIN tenant te ON te.id = o.tenant_id
  LEFT JOIN contrat_client c ON c.offre_id = o.id
`;

function versOffre(r) {
  const validite = r.date_offre ? jourIso(r.date_offre) : null;
  let dateValidite = null;
  if (r.date_offre) {
    const d = new Date(`${jourIso(r.date_offre)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Number(r.validite_jours || 0));
    dateValidite = d.toISOString().slice(0, 10);
  }
  const expiree = ["BROUILLON", "ENVOYEE"].includes(r.statut) && dateValidite && dateValidite < new Date().toISOString().slice(0, 10);
  return {
    ...r,
    date_offre: validite,
    date_validite: dateValidite,
    expiree: !!expiree,
    date_acceptation: jourIso(r.date_acceptation),
    lignes: r.lignes_json || [],
    totaux: { total_ht: Number(r.total_ht_xof), total_tva: Number(r.total_tva_xof), total_ttc: Number(r.total_ttc_xof) },
  };
}

async function listerOffres({ tenantId, statut } = {}) {
  const params = [];
  const cond = [];
  if (tenantId) {
    params.push(tenantId);
    cond.push(`o.tenant_id = $${params.length}`);
  }
  if (statut && STATUTS_OFFRE.includes(statut)) {
    params.push(statut);
    cond.push(`o.statut = $${params.length}`);
  }
  const r = await db.query(`${SELECT_OFFRE} ${cond.length ? `WHERE ${cond.join(" AND ")}` : ""} ORDER BY o.date_creation DESC LIMIT 500`, params);
  return r.rows.map(versOffre);
}

async function getOffre(id) {
  const r = await db.query(`${SELECT_OFFRE} WHERE o.id = $1`, [id]);
  if (!r.rows[0]) throw new CommercialError("OFFRE_INTROUVABLE", 404);
  return versOffre(r.rows[0]);
}

function lireCorps(corps) {
  const c = corps || {};
  const lignes = nettoyerLignes(c.lignes);
  if (lignes.length === 0) throw new CommercialError("OFFRE_LIGNES_REQUISES", 400);
  const remise = Math.max(0, Math.min(100, Number(c.remise_pct) || 0));
  const tva = Math.max(0, Math.min(100, Number(c.tva_pct) || 0));
  const duree = Math.max(1, Math.min(120, Math.round(Number(c.duree_mois) || 12)));
  const validite = Math.max(1, Math.min(365, Math.round(Number(c.validite_jours) || 30)));
  const modules = [...new Set((Array.isArray(c.modules) ? c.modules : []).filter((x) => MODULES[x]))];
  const t = calculerTotaux(lignes, remise, tva);
  return {
    mode: c.mode_hebergement === "LOCAL" ? "LOCAL" : "HEBERGE",
    formule_id: c.formule_abonnement_id || null,
    modules,
    duree,
    lignes,
    remise,
    tva,
    totaux: t,
    date_offre: /^\d{4}-\d{2}-\d{2}$/.test(String(c.date_offre || "")) ? c.date_offre : null,
    validite,
    conditions_paiement: texte(c.conditions_paiement, 800),
    notes: texte(c.notes, 1500),
    client_forme_juridique: texte(c.client_forme_juridique, 80),
    client_adresse: texte(c.client_adresse, 300),
    client_ninea: texte(c.client_ninea, 60),
    client_rccm: texte(c.client_rccm, 60),
    representant_nom: texte(c.representant_nom, 120),
    representant_fonction: texte(c.representant_fonction, 120),
    destinataire_email: texte(c.destinataire_email, 200),
  };
}

async function infoFormule(formuleId) {
  if (!formuleId) return { nom: null, plafond: null };
  const f = (await db.query(`SELECT nom, plafond_utilisateurs FROM formule_abonnement WHERE id = $1`, [formuleId])).rows[0];
  if (!f) throw new CommercialError("SUPER_ADMIN_FORMULE_NOT_FOUND", 404);
  return { nom: f.nom, plafond: f.plafond_utilisateurs };
}

async function creerOffre(tenantId, adminId, corps) {
  const tenant = (await db.query(`SELECT id FROM tenant WHERE id = $1`, [tenantId])).rows[0];
  if (!tenant) throw new CommercialError("SUPER_ADMIN_CLIENT_NOT_FOUND", 404);
  const c = lireCorps(corps);
  const f = await infoFormule(c.formule_id);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const dateOffre = c.date_offre || new Date().toISOString().slice(0, 10);
    const numero = await numeroSuivant(client, "OFFRE", Number(dateOffre.slice(0, 4)));
    const id = uuidv4();
    await client.query(
      `INSERT INTO offre_commerciale (id, numero, tenant_id, mode_hebergement, formule_abonnement_id, formule_nom, plafond_utilisateurs, modules,
         duree_mois, lignes_json, remise_pct, tva_pct, total_ht_xof, total_tva_xof, total_ttc_xof, date_offre, validite_jours, conditions_paiement, notes,
         client_forme_juridique, client_adresse, client_ninea, client_rccm, representant_nom, representant_fonction, destinataire_email, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [id, numero, tenantId, c.mode, c.formule_id, f.nom, f.plafond, c.modules, c.duree, JSON.stringify(c.lignes), c.remise, c.tva, c.totaux.total_ht, c.totaux.total_tva, c.totaux.total_ttc,
        dateOffre, c.validite, c.conditions_paiement, c.notes, c.client_forme_juridique, c.client_adresse, c.client_ninea, c.client_rccm, c.representant_nom, c.representant_fonction, c.destinataire_email, adminId || null]
    );
    await client.query("COMMIT");
    return getOffre(id);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function modifierOffre(id, corps) {
  const actuelle = await getOffre(id);
  if (!["BROUILLON", "ENVOYEE"].includes(actuelle.statut)) throw new CommercialError("OFFRE_NON_MODIFIABLE", 409);
  const c = lireCorps(corps);
  const f = await infoFormule(c.formule_id);
  await db.query(
    `UPDATE offre_commerciale SET mode_hebergement=$2, formule_abonnement_id=$3, formule_nom=$4, plafond_utilisateurs=$5, modules=$6, duree_mois=$7, lignes_json=$8,
       remise_pct=$9, tva_pct=$10, total_ht_xof=$11, total_tva_xof=$12, total_ttc_xof=$13, date_offre=COALESCE($14, date_offre), validite_jours=$15,
       conditions_paiement=$16, notes=$17, client_forme_juridique=$18, client_adresse=$19, client_ninea=$20, client_rccm=$21, representant_nom=$22,
       representant_fonction=$23, destinataire_email=$24, date_modification=now()
     WHERE id = $1`,
    [id, c.mode, c.formule_id, f.nom, f.plafond, c.modules, c.duree, JSON.stringify(c.lignes), c.remise, c.tva, c.totaux.total_ht, c.totaux.total_tva, c.totaux.total_ttc, c.date_offre,
      c.validite, c.conditions_paiement, c.notes, c.client_forme_juridique, c.client_adresse, c.client_ninea, c.client_rccm, c.representant_nom, c.representant_fonction, c.destinataire_email]
  );
  return getOffre(id);
}

async function marquerEnvoyee(id, destinataire) {
  const o = await getOffre(id);
  if (!["BROUILLON", "ENVOYEE"].includes(o.statut)) throw new CommercialError("OFFRE_NON_MODIFIABLE", 409);
  await db.query(`UPDATE offre_commerciale SET statut = 'ENVOYEE', date_envoi = now(), envoye_a = $2, date_modification = now() WHERE id = $1`, [id, destinataire]);
  return getOffre(id);
}

async function refuserOffre(id, motif) {
  const o = await getOffre(id);
  if (!["BROUILLON", "ENVOYEE"].includes(o.statut)) throw new CommercialError("OFFRE_NON_MODIFIABLE", 409);
  await db.query(`UPDATE offre_commerciale SET statut = 'REFUSEE', motif_refus = $2, date_modification = now() WHERE id = $1`, [id, texte(motif, 500)]);
  return getOffre(id);
}

async function annulerOffre(id) {
  const o = await getOffre(id);
  if (o.statut === "ACCEPTEE") throw new CommercialError("OFFRE_DEJA_ACCEPTEE", 409);
  await db.query(`UPDATE offre_commerciale SET statut = 'ANNULEE', date_modification = now() WHERE id = $1`, [id]);
  return getOffre(id);
}

// ---------------------------------------------------------------------------
// Contrats
// ---------------------------------------------------------------------------

async function getParametresEditeur() {
  const r = await db.query(`SELECT * FROM plateforme_parametres WHERE id = true`);
  return r.rows[0] || {};
}

/** Contenu fige du contrat d'apres l'offre acceptee et les informations de l'editeur. */
async function construireContenu(offre, params, dateEffet) {
  const dateContrat = new Date().toISOString().slice(0, 10);
  const dateFin = veille(ajouterMois(dateEffet, offre.duree_mois));
  const editeur = {
    raison_sociale: params.raison_sociale || null,
    forme_juridique: params.forme_juridique || null,
    capital_social: params.capital_social || null,
    adresse: params.adresse || null,
    telephone: params.telephone || null,
    email: params.email || null,
    rccm: params.rccm || null,
    ninea: params.ninea || null,
    site_web: params.site_web || null,
    representant_nom: params.representant_nom || null,
    representant_fonction: params.representant_fonction || null,
    coordonnees_bancaires: params.coordonnees_bancaires || null,
    ville_signature: params.ville_signature || "Dakar",
  };
  const client = {
    raison_sociale: offre.client_raison_sociale,
    forme_juridique: offre.client_forme_juridique || null,
    adresse: offre.client_adresse || null,
    ninea: offre.client_ninea || null,
    rccm: offre.client_rccm || null,
    representant_nom: offre.representant_nom || null,
    representant_fonction: offre.representant_fonction || null,
    email: offre.destinataire_email || null,
  };
  const articles = construireArticles({
    variante: offre.mode_hebergement,
    editeur: editeur.raison_sociale || "l'Éditeur",
    client: client.raison_sociale,
    formule: offre.formule_nom || "-",
    plafond: offre.plafond_utilisateurs,
    duree_mois: offre.duree_mois,
    penalite_mois: Number(params.penalite_pi_mois) || 24,
    mention_pi: params.mention_propriete_intellectuelle ? String(params.mention_propriete_intellectuelle).trim().replace(/\.+$/, "") + "." : null,
    juridiction: params.tribunal_competent || "Tribunal de Commerce Hors Classe de Dakar",
    ville: editeur.ville_signature,
    annee: Number(dateContrat.slice(0, 4)),
  });
  const avertissements = [];
  const manque = (valeur, code) => {
    if (!valeur) avertissements.push(code);
  };
  manque(editeur.raison_sociale, "EDITEUR_RAISON_SOCIALE");
  manque(editeur.adresse, "EDITEUR_ADRESSE");
  manque(editeur.rccm || editeur.ninea, "EDITEUR_RCCM_NINEA");
  manque(editeur.representant_nom, "EDITEUR_REPRESENTANT");
  manque(params.signature_cachet_base64, "EDITEUR_SIGNATURE");
  manque(client.adresse, "CLIENT_ADRESSE");
  manque(client.representant_nom, "CLIENT_REPRESENTANT");
  manque(client.rccm || client.ninea, "CLIENT_RCCM_NINEA");
  const contenu = {
    version_modele: 1,
    variante: offre.mode_hebergement,
    date_contrat: dateContrat,
    date_effet: dateEffet,
    date_fin: dateFin,
    duree_mois: offre.duree_mois,
    editeur,
    client,
    formule: { nom: offre.formule_nom, plafond_utilisateurs: offre.plafond_utilisateurs },
    modules: (offre.modules || []).map((m) => MODULES[m] || m),
    offre_numero: offre.numero,
    offre_date: offre.date_offre,
    lignes: offre.lignes,
    remise_pct: Number(offre.remise_pct),
    tva_pct: Number(offre.tva_pct),
    totaux: { ...calculerTotaux(offre.lignes, Number(offre.remise_pct), Number(offre.tva_pct)) },
    conditions_paiement: offre.conditions_paiement,
    penalite_mois: Number(params.penalite_pi_mois) || 24,
    articles,
  };
  return { contenu, avertissements, dateFin };
}

async function accepterOffre(id, { date_acceptation, note } = {}) {
  const offre = await getOffre(id);
  if (offre.statut === "ACCEPTEE") throw new CommercialError("OFFRE_DEJA_ACCEPTEE", 409);
  if (!["BROUILLON", "ENVOYEE"].includes(offre.statut)) throw new CommercialError("OFFRE_NON_MODIFIABLE", 409);
  const dateAcc = /^\d{4}-\d{2}-\d{2}$/.test(String(date_acceptation || "")) ? date_acceptation : new Date().toISOString().slice(0, 10);
  const params = await getParametresEditeur();
  const { contenu, avertissements, dateFin } = await construireContenu(offre, params, dateAcc);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE offre_commerciale SET statut = 'ACCEPTEE', date_acceptation = $2, note_acceptation = $3, date_modification = now() WHERE id = $1`, [id, dateAcc, texte(note, 500)]);
    const numero = await numeroSuivant(client, "CONTRAT", Number(dateAcc.slice(0, 4)));
    await client.query(
      `INSERT INTO contrat_client (id, numero, tenant_id, offre_id, variante, date_contrat, date_effet, duree_mois, date_fin, contenu_json, avertissements_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [uuidv4(), numero, offre.tenant_id, id, offre.mode_hebergement, contenu.date_contrat, dateAcc, offre.duree_mois, dateFin, JSON.stringify(contenu), JSON.stringify(avertissements)]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return getOffre(id);
}

const SELECT_CONTRAT = `
  SELECT c.id, c.numero, c.tenant_id, c.offre_id, c.statut, c.variante, c.date_contrat, c.date_effet, c.duree_mois, c.date_fin, c.avertissements_json,
         c.date_envoi, c.envoye_a, c.date_signature_client, c.signe_nom_fichier, c.signe_type_mime, c.date_depot_signe, c.notes, c.date_creation,
         (c.signe_base64 IS NOT NULL) AS a_un_fichier_signe,
         te.raison_sociale AS client_raison_sociale, o.numero AS offre_numero
  FROM contrat_client c
  JOIN tenant te ON te.id = c.tenant_id
  JOIN offre_commerciale o ON o.id = c.offre_id
`;

function versContrat(r) {
  return { ...r, date_contrat: jourIso(r.date_contrat), date_effet: jourIso(r.date_effet), date_fin: jourIso(r.date_fin), date_signature_client: jourIso(r.date_signature_client), avertissements: r.avertissements_json || [] };
}

async function listerContrats({ tenantId } = {}) {
  const r = await db.query(`${SELECT_CONTRAT} ${tenantId ? "WHERE c.tenant_id = $1" : ""} ORDER BY c.date_creation DESC LIMIT 500`, tenantId ? [tenantId] : []);
  return r.rows.map(versContrat);
}

async function getContrat(id) {
  const r = await db.query(`${SELECT_CONTRAT} WHERE c.id = $1`, [id]);
  if (!r.rows[0]) throw new CommercialError("CONTRAT_INTROUVABLE", 404);
  return versContrat(r.rows[0]);
}

async function getContratComplet(id) {
  const r = await db.query(`SELECT * FROM contrat_client WHERE id = $1`, [id]);
  if (!r.rows[0]) throw new CommercialError("CONTRAT_INTROUVABLE", 404);
  return r.rows[0];
}

/** Regenere le contenu fige (informations de l'editeur ou du client completees entre-temps), tant que le contrat n'est pas envoye. */
async function regenererContrat(id, { date_effet } = {}) {
  const c = await getContratComplet(id);
  if (c.statut !== "PREPARE") throw new CommercialError("CONTRAT_NON_MODIFIABLE", 409);
  const offre = await getOffre(c.offre_id);
  const dateEffet = /^\d{4}-\d{2}-\d{2}$/.test(String(date_effet || "")) ? date_effet : jourIso(c.date_effet);
  const params = await getParametresEditeur();
  const { contenu, avertissements, dateFin } = await construireContenu(offre, params, dateEffet);
  await db.query(
    `UPDATE contrat_client SET contenu_json = $2, avertissements_json = $3, date_effet = $4, date_fin = $5, date_contrat = CURRENT_DATE, date_modification = now() WHERE id = $1`,
    [id, JSON.stringify(contenu), JSON.stringify(avertissements), dateEffet, dateFin]
  );
  return getContrat(id);
}

async function marquerContratEnvoye(id, destinataire) {
  const c = await getContratComplet(id);
  if (!["PREPARE", "ENVOYE"].includes(c.statut)) throw new CommercialError("CONTRAT_NON_MODIFIABLE", 409);
  await db.query(`UPDATE contrat_client SET statut = 'ENVOYE', date_envoi = now(), envoye_a = $2, date_modification = now() WHERE id = $1`, [id, destinataire]);
  return getContrat(id);
}

async function deposerContratSigne(id, fichier, { date_signature } = {}) {
  const c = await getContratComplet(id);
  if (!["PREPARE", "ENVOYE", "SIGNE"].includes(c.statut)) throw new CommercialError("CONTRAT_NON_MODIFIABLE", 409);
  if (!fichier || !fichier.buffer) throw new CommercialError("CONTRAT_FICHIER_REQUIS", 400);
  const types = ["application/pdf", "image/png", "image/jpeg"];
  if (!types.includes(fichier.mimetype)) throw new CommercialError("CONTRAT_FICHIER_TYPE", 400);
  const dateSig = /^\d{4}-\d{2}-\d{2}$/.test(String(date_signature || "")) ? date_signature : new Date().toISOString().slice(0, 10);
  await db.query(
    `UPDATE contrat_client SET statut = 'SIGNE', date_signature_client = $2, signe_nom_fichier = $3, signe_type_mime = $4, signe_base64 = $5,
       date_depot_signe = now(), date_modification = now() WHERE id = $1`,
    [id, dateSig, String(fichier.originalname || "contrat_signe").slice(0, 200), fichier.mimetype, fichier.buffer.toString("base64")]
  );
  return getContrat(id);
}

async function getContratSigne(id) {
  const r = await db.query(`SELECT numero, signe_nom_fichier, signe_type_mime, signe_base64 FROM contrat_client WHERE id = $1`, [id]);
  const c = r.rows[0];
  if (!c) throw new CommercialError("CONTRAT_INTROUVABLE", 404);
  if (!c.signe_base64) throw new CommercialError("CONTRAT_SIGNE_ABSENT", 404);
  return { nom: c.signe_nom_fichier || `${c.numero}-signe`, mime: c.signe_type_mime, buffer: Buffer.from(c.signe_base64, "base64"), numero: c.numero };
}

async function mettreNotesContrat(id, notes) {
  await getContratComplet(id);
  await db.query(`UPDATE contrat_client SET notes = $2, date_modification = now() WHERE id = $1`, [id, texte(notes, 1500)]);
  return getContrat(id);
}

module.exports = {
  CommercialError,
  MODULES,
  proposerLignes,
  calculerTotaux,
  listerOffres,
  getOffre,
  creerOffre,
  modifierOffre,
  marquerEnvoyee,
  refuserOffre,
  annulerOffre,
  accepterOffre,
  listerContrats,
  getContrat,
  getContratComplet,
  regenererContrat,
  marquerContratEnvoye,
  deposerContratSigne,
  getContratSigne,
  mettreNotesContrat,
  getParametresEditeur,
};
