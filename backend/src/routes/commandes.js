const express = require("express");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const echeancierSvc = require("../services/echeancier");
const { chargerParametres } = require("../services/produitsCatalogue");
const { calculerOffre } = require("../services/calculPrixEngine");

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------------------------
// Commandes fournisseur (05/10/2026, Lot 5). Obligatoires avant toute reception.
// Rattachees a un dossier (AO ou consultation) ou, a defaut, au stock general.
// Acces : modules "fournisseurs" ou "marches" (comme les receptions), admin et
// tableau de bord.
// ----------------------------------------------------------------------------
router.use((req, res, next) => {
  const permissions = req.user?.permissions;
  if (!permissions) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  if (permissions.admin || permissions.tableauDeBord) return next();
  if ((permissions.modules || []).some((m) => m === "fournisseurs" || m === "marches")) return next();
  // Lecture de la synthese estime/engage/reel depuis la fiche d'un dossier : module "dossiers" suffit.
  if (req.method === "GET" && req.path === "/synthese-dossier" && (permissions.modules || []).includes("dossiers")) return next();
  return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
});
router.use(blockLectureSeule);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const arr2 = (n) => Math.round(n * 100) / 100;
const uuidOuNull = (v) => (typeof v === "string" && UUID_RE.test(v) ? v : null);

const SELECT_ENTETE = `
  SELECT c.*, f.nom AS fournisseur_nom, tr.nom AS transitaire_nom, ct.reference AS cotation_reference,
         d.reference_externe AS dossier_ao_reference, d.intitule AS dossier_ao_intitule,
         cons.objet AS consultation_objet, cl.nom AS consultation_client_nom
  FROM commande_fournisseur c
  JOIN fournisseur f ON f.id = c.fournisseur_id
  LEFT JOIN transitaire tr ON tr.id = c.transitaire_id
  LEFT JOIN transitaire_cotation ct ON ct.id = c.cotation_id
  LEFT JOIN dossier_ao d ON d.id = c.dossier_ao_id
  LEFT JOIN consultation cons ON cons.id = c.consultation_id
  LEFT JOIN client_commercial cl ON cl.id = cons.client_commercial_id
`;

async function lignesAvecSuivi(ids) {
  if (ids.length === 0) return new Map();
  const rows = (
    await db.query(
      `SELECT l.id, l.commande_id, l.ordre, l.reference_fournisseur, l.designation, l.unite, l.quantite, l.prix_unitaire_devise,
              l.produit_id, l.calcul_offre_id, p.reference AS produit_reference,
              co.prix_unitaire_devise AS offre_prix_devise, co.devise AS offre_devise,
              (SELECT rl.prix_unitaire_devise FROM reception_ligne rl JOIN reception_marchandise r ON r.id = rl.reception_id
                WHERE rl.commande_ligne_id = l.id AND r.statut = 'VALIDEE'
                ORDER BY r.date_reception DESC, r.date_validation DESC NULLS LAST LIMIT 1) AS dernier_paye_devise,
              COALESCE((SELECT SUM(rl.quantite) FROM reception_ligne rl JOIN reception_marchandise r ON r.id = rl.reception_id
                        WHERE rl.commande_ligne_id = l.id AND r.statut = 'VALIDEE'), 0) AS quantite_recue
       FROM commande_fournisseur_ligne l
       LEFT JOIN produit p ON p.id = l.produit_id
       LEFT JOIN calcul_offre co ON co.id = l.calcul_offre_id
       WHERE l.commande_id = ANY($1) ORDER BY l.commande_id, l.ordre ASC`,
      [ids]
    )
  ).rows;
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.commande_id)) m.set(r.commande_id, []);
    const quantite = Number(r.quantite);
    const recue = Number(r.quantite_recue);
    m.get(r.commande_id).push({
      ...r,
      quantite,
      prix_unitaire_devise: Number(r.prix_unitaire_devise),
      // Prix unique : offert (dossier de calcul) / engage (cette commande) / paye (derniere reception validee).
      prix_offert_devise: r.offre_prix_devise === null || r.offre_prix_devise === undefined ? null : Number(r.offre_prix_devise),
      prix_paye_devise: r.dernier_paye_devise === null || r.dernier_paye_devise === undefined ? null : Number(r.dernier_paye_devise),
      quantite_recue: recue,
      quantite_restante: Math.max(0, Math.round((quantite - recue) * 1000) / 1000),
    });
  }
  return m;
}

function enrichir(c, lignes) {
  const cours = Number(c.cours_devise);
  const totalDevise = arr2(lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_devise, 0));
  const recuDevise = arr2(lignes.reduce((s, l) => s + Math.min(l.quantite_recue, l.quantite) * l.prix_unitaire_devise, 0));
  const toutRecu = lignes.length > 0 && lignes.every((l) => l.quantite_recue >= l.quantite);
  const rienRecu = lignes.every((l) => l.quantite_recue <= 0);
  return {
    ...c,
    cours_devise: cours,
    lignes,
    nb_lignes: lignes.length,
    total_devise: totalDevise,
    total_xof: arr2(totalDevise * cours),
    recu_xof: arr2(recuDevise * cours),
    statut_reception: c.statut !== "CONFIRMEE" ? null : toutRecu ? "COMPLETE" : rienRecu ? "AUCUNE" : "PARTIELLE",
  };
}

async function chargerCommande(tenantId, id) {
  if (!UUID_RE.test(String(id))) return null;
  const c = (await db.query(`${SELECT_ENTETE} WHERE c.id = $1 AND c.tenant_id = $2`, [id, tenantId])).rows[0];
  if (!c) return null;
  const lignes = (await lignesAvecSuivi([id])).get(id) || [];
  const receptions = (
    await db.query(
      `SELECT r.id, r.numero, r.date_reception, r.statut, r.reference_facture,
              (SELECT COALESCE(SUM(l.quantite * l.prix_unitaire_devise), 0) FROM reception_ligne l WHERE l.reception_id = r.id) * r.cours_devise AS total_xof
       FROM reception_marchandise r WHERE r.commande_id = $1 ORDER BY r.date_reception DESC, r.date_creation DESC`,
      [id]
    )
  ).rows.map((r) => ({ ...r, total_xof: arr2(Number(r.total_xof)) }));
  const historique = (
    await db.query(
      `SELECT id, date_correction, utilisateur_nom, motif, modifications, total_avant_devise, total_apres_devise
       FROM commande_fournisseur_historique WHERE commande_id = $1 AND tenant_id = $2 ORDER BY date_correction DESC`,
      [id, tenantId]
    )
  ).rows.map((h) => ({ ...h, total_avant_devise: Number(h.total_avant_devise), total_apres_devise: Number(h.total_apres_devise) }));
  return { ...enrichir(c, lignes), receptions, historique };
}

// Corps d'une commande (creation et modification d'un brouillon).
function nettoyerCommande(b) {
  const devise = String(b.devise || "XOF").trim().toUpperCase().slice(0, 8) || "XOF";
  const cours = devise === "XOF" ? 1 : Number(b.cours_devise);
  if (!Number.isFinite(cours) || cours <= 0) return { erreur: "COMMANDE_INVALID" };
  const lignes = [];
  for (const l of Array.isArray(b.lignes) ? b.lignes : []) {
    const designation = String(l.designation ?? "").trim();
    const quantite = Number(l.quantite);
    const pu = l.prix_unitaire_devise === "" || l.prix_unitaire_devise === undefined || l.prix_unitaire_devise === null ? 0 : Number(l.prix_unitaire_devise);
    if (!designation && !(Number.isFinite(quantite) && quantite > 0)) continue; // ligne vide ignoree
    if (!designation || !Number.isFinite(quantite) || quantite <= 0 || !Number.isFinite(pu) || pu < 0) return { erreur: "COMMANDE_INVALID" };
    lignes.push({
      reference_fournisseur: String(l.reference_fournisseur ?? "").trim() || null,
      designation,
      unite: String(l.unite ?? "").trim() || "U",
      quantite: Math.round(quantite * 1000) / 1000,
      prix_unitaire_devise: Math.round(pu * 10000) / 10000,
      produit_id: uuidOuNull(l.produit_id),
      calcul_offre_id: uuidOuNull(l.calcul_offre_id),
    });
  }
  const ao = uuidOuNull(b.dossier_ao_id);
  const cons = uuidOuNull(b.consultation_id);
  if (ao && cons) return { erreur: "COMMANDE_DOSSIER_INVALID" };
  return {
    entete: {
      devise,
      cours,
      incoterm: String(b.incoterm || "").trim().toUpperCase().slice(0, 10) || null,
      date_commande: b.date_commande || null,
      date_livraison_prevue: b.date_livraison_prevue || null,
      notes: String(b.notes || "").trim() || null,
      dossier_ao_id: ao,
      consultation_id: cons,
      transitaire_id: uuidOuNull(b.transitaire_id),
      cotation_id: uuidOuNull(b.cotation_id),
    },
    lignes,
  };
}

async function remplacerLignes(client, tenantId, commandeId, lignes) {
  await client.query(`DELETE FROM commande_fournisseur_ligne WHERE commande_id = $1`, [commandeId]);
  let ordre = 0;
  for (const l of lignes) {
    await client.query(
      `INSERT INTO commande_fournisseur_ligne (id, commande_id, ordre, reference_fournisseur, designation, unite, quantite,
                                               prix_unitaire_devise, produit_id, calcul_offre_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
               (SELECT id FROM produit WHERE id = $9 AND tenant_id = $11),
               (SELECT co.id FROM calcul_offre co JOIN calcul_article ca ON ca.id = co.calcul_article_id
                  JOIN dossier_calcul dc ON dc.id = ca.dossier_calcul_id WHERE co.id = $10 AND dc.tenant_id = $11))`,
      [uuidv4(), commandeId, ordre++, l.reference_fournisseur, l.designation, l.unite, l.quantite, l.prix_unitaire_devise,
       l.produit_id, l.calcul_offre_id, tenantId]
    );
  }
}

async function prochainNumero(client, tenantId, type, prefixe) {
  const annee = new Date().getFullYear();
  await client.query(
    `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero) VALUES ($1,$2,$3,0)
     ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
    [tenantId, type, annee]
  );
  const seq = (
    await client.query(
      `UPDATE compteur_numerotation SET dernier_numero = dernier_numero + 1
       WHERE tenant_id = $1 AND type_compteur = $2 AND annee = $3 RETURNING dernier_numero`,
      [tenantId, type, annee]
    )
  ).rows[0].dernier_numero;
  return `${prefixe}-${annee}-${String(seq).padStart(4, "0")}`;
}

async function fournisseurDuTenant(queryable, tenantId, id) {
  if (!id || !UUID_RE.test(String(id))) return false;
  return (await queryable.query(`SELECT 1 FROM fournisseur WHERE id = $1 AND tenant_id = $2`, [id, tenantId])).rows.length > 0;
}

// Echeancier de paiement de la commande : celui fourni (valide), sinon celui de la
// fiche fournisseur. Ecrit apres l'insertion de l'en-tete.
async function poserEcheancierCommande(queryable, tenantId, commandeId, fournisseurId, fourni) {
  let lignes = null;
  if (fourni !== undefined && fourni !== null && fourni !== "") {
    const n = echeancierSvc.normaliser(fourni);
    if (n.erreur) return n.erreur;
    lignes = n.lignes;
  } else {
    const r = await queryable.query(`SELECT echeancier_json FROM fournisseur WHERE id = $1 AND tenant_id = $2`, [fournisseurId, tenantId]);
    lignes = echeancierSvc.lire(r.rows[0] && r.rows[0].echeancier_json);
  }
  if (lignes) {
    await queryable.query(`UPDATE commande_fournisseur SET echeancier_json = $1 WHERE id = $2 AND tenant_id = $3`, [JSON.stringify(lignes), commandeId, tenantId]);
  }
  return null;
}

const INSERT_ENTETE = `
  INSERT INTO commande_fournisseur (id, tenant_id, numero, fournisseur_id, dossier_ao_id, consultation_id, dossier_calcul_id,
                                    devise, cours_devise, incoterm, transitaire_id, cotation_id, date_commande,
                                    date_livraison_prevue, notes, cree_par)
  VALUES ($1,$2,$3,$4,
          (SELECT id FROM dossier_ao WHERE id = $5 AND tenant_id = $2),
          (SELECT id FROM consultation WHERE id = $6 AND tenant_id = $2),
          (SELECT id FROM dossier_calcul WHERE id = $7 AND tenant_id = $2),
          $8,$9,$10,
          (SELECT id FROM transitaire WHERE id = $11 AND tenant_id = $2),
          (SELECT id FROM transitaire_cotation WHERE id = $12 AND tenant_id = $2),
          COALESCE($13, CURRENT_DATE),$14,$15,$16)`;

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const where = ["c.tenant_id = $1"];
    const params = [req.user.tenantId];
    const ajouter = (sql, v) => {
      params.push(v);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (["BROUILLON", "CONFIRMEE", "ANNULEE"].includes(String(req.query.statut))) ajouter("c.statut = ?", req.query.statut);
    if (uuidOuNull(req.query.fournisseur_id)) ajouter("c.fournisseur_id = ?", req.query.fournisseur_id);
    if (uuidOuNull(req.query.dossier_ao_id)) ajouter("c.dossier_ao_id = ?", req.query.dossier_ao_id);
    if (uuidOuNull(req.query.consultation_id)) ajouter("c.consultation_id = ?", req.query.consultation_id);
    const rows = (await db.query(`${SELECT_ENTETE} WHERE ${where.join(" AND ")} ORDER BY c.date_commande DESC, c.date_creation DESC LIMIT 500`, params)).rows;
    const lignes = await lignesAvecSuivi(rows.map((r) => r.id));
    let liste = rows.map((r) => {
      const e = enrichir(r, lignes.get(r.id) || []);
      delete e.lignes;
      return e;
    });
    if (req.query.a_recevoir) liste = liste.filter((c) => c.statut === "CONFIRMEE" && c.statut_reception !== "COMPLETE");
    res.json(liste);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "COMMANDE_FETCH_ERROR") });
  }
});

// ---------------------------------------------------------------------------
// Estime / engage / reel d'un dossier (declare AVANT /:id)
// ---------------------------------------------------------------------------
router.get("/synthese-dossier", async (req, res) => {
  const ao = uuidOuNull(req.query.dossier_ao_id);
  const cons = uuidOuNull(req.query.consultation_id);
  if ((ao ? 1 : 0) + (cons ? 1 : 0) !== 1) return res.status(400).json({ error: t(req, "COMMANDE_DOSSIER_INVALID") });
  try {
    res.json(await syntheseDossier(req.user.tenantId, ao ? "dossier_ao_id" : "consultation_id", ao || cons));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "COMMANDE_FETCH_ERROR") });
  }
});

// Estime (offres retenues du Dossier de calcul) / engage (commandes) / reel
// (receptions validees + couts d'approche) + marge du dossier : marge estimee
// (marge nette du Dossier de calcul) et marge reelle recalculee avec le cout
// de revient reel, disponible quand tout est commande et recu.
async function syntheseDossier(tenantId, colonne, cle) {
  const parametres = await chargerParametres(tenantId);
  const offres = (
    await db.query(
      `SELECT co.* FROM calcul_offre co
       JOIN calcul_article ca ON ca.id = co.calcul_article_id
       JOIN dossier_calcul dc ON dc.id = ca.dossier_calcul_id
       WHERE dc.tenant_id = $1 AND dc.${colonne} = $2 AND co.retenue = true`,
      [tenantId, cle]
    )
  ).rows;
  let estimeAchat = 0;
  let estimeRevient = 0;
  let estimeVente = 0;
  let estimeFraisBancaires = 0;
  let estimeMarge = 0;
  for (const o of offres) {
    const c = calculerOffre(o, parametres);
    estimeAchat += c.prixAchatTotalXof;
    // L'assurance transport est une depense reelle : le cout de revient du dossier
    // l'inclut (le Dossier de calcul ne s'en sert que dans la valeur en douane).
    estimeRevient += c.coutDeRevientHt + c.assurance;
    estimeVente += c.montantTotalArrondiHt;
    estimeFraisBancaires += c.totalFraisBancaires;
    // Meme base que la marge reelle (prix de vente arrondi - cout de revient -
    // frais de paiement fournisseur) : estime et reel sont comparables, et ce
    // chiffre est celui du compte d'exploitation previsionnel.
    estimeMarge += c.montantTotalArrondiHt - c.coutDeRevientHt - c.assurance - c.totalFraisBancaires;
  }
  // Autres charges directes saisies sur le dossier (compte d'exploitation).
  const autresCharges = arr2(
    Number(
      (
        await db.query(`SELECT COALESCE(SUM(montant_xof), 0) AS s FROM dossier_charge_directe WHERE tenant_id = $1 AND ${colonne} = $2`, [tenantId, cle])
      ).rows[0].s
    )
  );
  estimeMarge -= autresCharges;
  const commandes = (
    await db.query(`${SELECT_ENTETE} WHERE c.tenant_id = $1 AND c.${colonne} = $2 AND c.statut <> 'ANNULEE' ORDER BY c.date_commande ASC`, [tenantId, cle])
  ).rows;
  const lignes = await lignesAvecSuivi(commandes.map((c) => c.id));
  const enrichies = commandes.map((c) => {
    const e = enrichir(c, lignes.get(c.id) || []);
    delete e.lignes;
    return e;
  });
  const engage = arr2(enrichies.reduce((s, c) => s + c.total_xof, 0));
  const reel = (
    await db.query(
      `SELECT COUNT(*)::int AS nb,
              COALESCE(SUM((SELECT SUM(l.quantite * l.prix_unitaire_devise) FROM reception_ligne l WHERE l.reception_id = r.id) * r.cours_devise), 0) AS achat_xof,
              COALESCE(SUM((SELECT SUM(c.montant * CASE WHEN c.en_devise_facture THEN r.cours_devise ELSE 1 END)
                            FROM reception_cout_approche c WHERE c.reception_id = r.id)), 0) AS approche_xof
       FROM reception_marchandise r
       JOIN commande_fournisseur cf ON cf.id = r.commande_id
       WHERE r.tenant_id = $1 AND r.statut = 'VALIDEE' AND cf.${colonne} = $2`,
      [tenantId, cle]
    )
  ).rows[0];
  // Offres retenues pas encore commandees : l'ecart n'aurait pas de sens.
  const nonCommandees = (
    await db.query(
      `SELECT COUNT(*)::int AS n FROM calcul_offre co
       JOIN calcul_article ca ON ca.id = co.calcul_article_id
       JOIN dossier_calcul dc ON dc.id = ca.dossier_calcul_id
       WHERE dc.tenant_id = $1 AND dc.${colonne} = $2 AND co.retenue = true
         AND NOT EXISTS (SELECT 1 FROM commande_fournisseur_ligne cl JOIN commande_fournisseur cf ON cf.id = cl.commande_id
                         WHERE cl.calcul_offre_id = co.id AND cf.statut <> 'ANNULEE')`,
      [tenantId, cle]
    )
  ).rows[0].n;
  const achatReel = arr2(Number(reel.achat_xof));
  const approcheReelle = arr2(Number(reel.approche_xof));
  const revientReel = arr2(achatReel + approcheReelle);
  // Frais bancaires RETENUS dans le module Financement (banque choisie apres simulation) :
  // quand ils existent, ce sont eux - et non l'estimation du Dossier de calcul - qui
  // alimentent la marge reelle.
  const colFin = colonne === "dossier_ao_id" ? "dossier_ao_id" : "consultation_id";
  const fin = (
    await db.query(
      `SELECT s.id, s.libelle, s.type_facilite, s.montant, s.statut, s.cout_retenu_xof, p.nom AS banque
       FROM financement_simulation s
       LEFT JOIN financement_condition c ON c.id = s.condition_retenue_id
       LEFT JOIN partenaire_financier p ON p.id = c.partenaire_id
       WHERE s.tenant_id = $1 AND s.${colFin} = $2 AND s.statut IN ('RETENUE','CONTROLEE') ORDER BY s.date_retenue ASC`,
      [tenantId, cle]
    )
  ).rows;
  const fraisFinancementRetenus = arr2(fin.reduce((s, x) => s + Number(x.cout_retenu_xof || 0), 0));
  // Frais de paiement du fournisseur (change, virement) ET cout de la ligne de
  // financement s'additionnent : ce sont deux depenses distinctes.
  const fraisBancairesUtilises = arr2(estimeFraisBancaires + fraisFinancementRetenus);
  const comparable = enrichies.length > 0 && nonCommandees === 0 && enrichies.every((c) => c.statut_reception === "COMPLETE");
  const estimeRevientArr = arr2(estimeRevient);
  const margeEstimeePct = estimeRevient > 0 ? (estimeMarge / estimeRevient) * 100 : null;
  // Marge reelle = prix de vente HT du Dossier de calcul - cout de revient reel - frais bancaires estimes.
  const margeReelleXof = comparable ? arr2(estimeVente - revientReel - fraisBancairesUtilises - autresCharges) : null;
  const margeReellePct = comparable && revientReel > 0 ? (margeReelleXof / revientReel) * 100 : null;
  return {
    estime: { nb_offres: offres.length, achat_xof: arr2(estimeAchat), cout_revient_xof: estimeRevientArr, vente_ht_xof: arr2(estimeVente) },
    engage: { nb_commandes: enrichies.length, achat_xof: engage },
    reel: { nb_receptions: reel.nb, achat_xof: achatReel, couts_approche_xof: approcheReelle, cout_revient_xof: revientReel },
    commandes: enrichies,
    autres_charges_xof: autresCharges,
    offres_non_commandees: nonCommandees,
    comparable,
    frais_bancaires: {
      estimes_xof: arr2(estimeFraisBancaires),
      paiement_fournisseur_xof: arr2(estimeFraisBancaires),
      retenus_xof: fraisFinancementRetenus,
      utilises_xof: fraisBancairesUtilises,
      source: fin.length > 0 ? "FINANCEMENT" : "DOSSIER_CALCUL",
      financements: fin,
    },
    ecart_cout_revient_xof: comparable && estimeRevientArr > 0 ? arr2(revientReel - estimeRevientArr) : null,
    ecart_cout_revient_pct: comparable && estimeRevientArr > 0 ? Math.round(((revientReel - estimeRevientArr) / estimeRevientArr) * 1000) / 10 : null,
    ecart_achat_engage_reel_xof: comparable ? arr2(achatReel - engage) : null,
    marge: {
      estimee_xof: arr2(estimeMarge),
      estimee_avec_financement_xof: fin.length > 0 ? arr2(estimeMarge - fraisFinancementRetenus) : null,
      estimee_pct: margeEstimeePct === null ? null : Math.round(margeEstimeePct * 100) / 100,
      reelle_xof: margeReelleXof,
      reelle_pct: margeReellePct === null ? null : Math.round(margeReellePct * 100) / 100,
      ecart_points: margeEstimeePct !== null && margeReellePct !== null ? Math.round((margeEstimeePct - margeReellePct) * 100) / 100 : null,
    },
  };
}

// Radar d'anticipation : apres chaque reception validee ou annulee, la marge du
// dossier d'appel d'offres est recalculee avec le reel (remplace l'ancien
// "calcul de marge" manuel). Ne bloque jamais l'operation appelante.
async function reevaluerMargeDossier(tenantId, commandeId) {
  try {
    if (!uuidOuNull(commandeId)) return null;
    const c = (
      await db.query(
        `SELECT cf.dossier_ao_id, d.intitule FROM commande_fournisseur cf JOIN dossier_ao d ON d.id = cf.dossier_ao_id
         WHERE cf.id = $1 AND cf.tenant_id = $2`,
        [commandeId, tenantId]
      )
    ).rows[0];
    if (!c) return null;
    const syn = await syntheseDossier(tenantId, "dossier_ao_id", c.dossier_ao_id);
    if (syn.marge.estimee_pct === null || syn.marge.reelle_pct === null) return syn;
    const { evaluerEcartMarge } = require("../services/anticipationEngine");
    await evaluerEcartMarge({
      tenantId,
      dossierId: c.dossier_ao_id,
      dossierIntitule: c.intitule,
      margePctVisee: syn.marge.estimee_pct,
      margePctReelle: syn.marge.reelle_pct,
    });
    return syn;
  } catch (err) {
    console.error("reevaluerMargeDossier", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Creation depuis les offres retenues d'un dossier de calcul : une commande
// BROUILLON par fournisseur / devise / transitaire. Idempotent : une offre deja
// commandee (commande non annulee) n'est pas recommandee.
// ---------------------------------------------------------------------------
router.post("/depuis-calcul", async (req, res) => {
  const dossierCalculId = uuidOuNull(req.body.dossier_calcul_id);
  if (!dossierCalculId) return res.status(404).json({ error: t(req, "CALCUL_DOSSIER_NOT_FOUND") });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const dc = (await client.query(`SELECT * FROM dossier_calcul WHERE id = $1 AND tenant_id = $2`, [dossierCalculId, req.user.tenantId])).rows[0];
    if (!dc) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "CALCUL_DOSSIER_NOT_FOUND") });
    }
    const offres = (
      await client.query(
        `SELECT co.*, ca.libelle, ca.ordre_affichage FROM calcul_offre co
         JOIN calcul_article ca ON ca.id = co.calcul_article_id
         WHERE ca.dossier_calcul_id = $1 AND co.retenue = true
           AND NOT EXISTS (SELECT 1 FROM commande_fournisseur_ligne cl JOIN commande_fournisseur cf ON cf.id = cl.commande_id
                           WHERE cl.calcul_offre_id = co.id AND cf.statut <> 'ANNULEE')
         ORDER BY ca.ordre_affichage ASC`,
        [dossierCalculId]
      )
    ).rows;
    if (offres.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "COMMANDE_CALCUL_VIDE") });
    }
    const groupes = new Map();
    for (const o of offres) {
      const cle = [o.fournisseur_id, o.devise, Number(o.cours_devise), o.transitaire_id || ""].join("|");
      if (!groupes.has(cle)) groupes.set(cle, []);
      groupes.get(cle).push(o);
    }
    const creees = [];
    for (const liste of groupes.values()) {
      const premiere = liste[0];
      const id = uuidv4();
      const numero = await prochainNumero(client, req.user.tenantId, "COMMANDE", "CMD");
      await client.query(INSERT_ENTETE, [
        id, req.user.tenantId, numero, premiere.fournisseur_id, dc.dossier_ao_id, dc.consultation_id, dc.id,
        premiere.devise, Number(premiere.cours_devise), null, premiere.transitaire_id, null, null, null,
        `Depuis le dossier de calcul « ${dc.nom} »`, req.user.sub,
      ]);
      await poserEcheancierCommande(client, req.user.tenantId, id, premiere.fournisseur_id, undefined);
      await remplacerLignes(
        client,
        req.user.tenantId,
        id,
        liste.map((o) => ({
          reference_fournisseur: null,
          designation: o.libelle,
          unite: "U",
          quantite: Number(o.quantite),
          prix_unitaire_devise: Number(o.prix_unitaire_devise),
          produit_id: null,
          calcul_offre_id: o.id,
        }))
      );
      creees.push(id);
    }
    await client.query("COMMIT");
    res.status(201).json(await Promise.all(creees.map((id) => chargerCommande(req.user.tenantId, id))));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "COMMANDE_SAVE_ERROR") });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    const c = await chargerCommande(req.user.tenantId, req.params.id);
    if (!c) return res.status(404).json({ error: t(req, "COMMANDE_NOT_FOUND") });
    res.json(c);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "COMMANDE_FETCH_ERROR") });
  }
});

// Donnees reprises par l'ecran de reception : en-tete + quantites restant a recevoir.
router.get("/:id/pour-reception", async (req, res) => {
  try {
    const c = await chargerCommande(req.user.tenantId, req.params.id);
    if (!c) return res.status(404).json({ error: t(req, "COMMANDE_NOT_FOUND") });
    if (c.statut !== "CONFIRMEE") return res.status(409).json({ error: t(req, "RECEPTION_COMMANDE_INVALID") });
    res.json({
      commande_id: c.id,
      numero: c.numero,
      fournisseur_id: c.fournisseur_id,
      fournisseur_nom: c.fournisseur_nom,
      devise: c.devise,
      cours_devise: c.cours_devise,
      incoterm: c.incoterm,
      transitaire_id: c.transitaire_id,
      cotation_id: c.cotation_id,
      lignes: c.lignes
        .filter((l) => l.quantite_restante > 0)
        .map((l) => ({
          commande_ligne_id: l.id,
          reference_fournisseur: l.reference_fournisseur,
          designation: l.designation,
          unite: l.unite,
          quantite: l.quantite_restante,
          prix_unitaire_devise: l.prix_unitaire_devise,
          produit_id: l.produit_id,
          commande_quantite: Number(l.quantite),
          commande_deja_recue: Number(l.quantite_recue || 0),
        })),
      dossier_ao_id: c.dossier_ao_id,
      consultation_id: c.consultation_id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "COMMANDE_FETCH_ERROR") });
  }
});

router.post("/", async (req, res) => {
  const net = nettoyerCommande(req.body || {});
  if (net.erreur) return res.status(400).json({ error: t(req, net.erreur) });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await fournisseurDuTenant(client, req.user.tenantId, req.body.fournisseur_id))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "COMMANDE_INVALID") });
    }
    const e = net.entete;
    const id = uuidv4();
    const numero = await prochainNumero(client, req.user.tenantId, "COMMANDE", "CMD");
    await client.query(INSERT_ENTETE, [
      id, req.user.tenantId, numero, req.body.fournisseur_id, e.dossier_ao_id, e.consultation_id, uuidOuNull(req.body.dossier_calcul_id),
      e.devise, e.cours, e.incoterm, e.transitaire_id, e.cotation_id, e.date_commande, e.date_livraison_prevue, e.notes, req.user.sub,
    ]);
    const errEch = await poserEcheancierCommande(client, req.user.tenantId, id, req.body.fournisseur_id, req.body.echeancier);
    if (errEch) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, errEch) });
    }
    await remplacerLignes(client, req.user.tenantId, id, net.lignes);
    await client.query("COMMIT");
    res.status(201).json(await chargerCommande(req.user.tenantId, id));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "COMMANDE_SAVE_ERROR") });
  } finally {
    client.release();
  }
});

router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "COMMANDE_NOT_FOUND") });
  const b = req.body || {};
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const actuelle = (await client.query(`SELECT * FROM commande_fournisseur WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, req.user.tenantId])).rows[0];
    if (!actuelle) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "COMMANDE_NOT_FOUND") });
    }
    if (actuelle.statut === "ANNULEE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "COMMANDE_NON_MODIFIABLE") });
    }
    if (b.echeancier !== undefined) {
      const n = echeancierSvc.normaliser(b.echeancier);
      if (n.erreur) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, n.erreur) });
      }
      await client.query(`UPDATE commande_fournisseur SET echeancier_json = $1 WHERE id = $2 AND tenant_id = $3`, [JSON.stringify(n.lignes), id, req.user.tenantId]);
    }
    if (actuelle.statut === "CONFIRMEE") {
      // Commande confirmee : lignes, fournisseur, prix et devise figes ; dates, transitaire et notes restent modifiables.
      await client.query(
        `UPDATE commande_fournisseur SET
                date_livraison_prevue = $1, notes = $2,
                transitaire_id = (SELECT id FROM transitaire WHERE id = $3 AND tenant_id = $5),
                cotation_id = (SELECT id FROM transitaire_cotation WHERE id = $4 AND tenant_id = $5)
         WHERE id = $6`,
        [
          b.date_livraison_prevue !== undefined ? b.date_livraison_prevue || null : actuelle.date_livraison_prevue,
          b.notes !== undefined ? String(b.notes || "").trim() || null : actuelle.notes,
          b.transitaire_id !== undefined ? uuidOuNull(b.transitaire_id) : actuelle.transitaire_id,
          b.cotation_id !== undefined ? uuidOuNull(b.cotation_id) : actuelle.cotation_id,
          req.user.tenantId,
          id,
        ]
      );
      await client.query("COMMIT");
      return res.json(await chargerCommande(req.user.tenantId, id));
    }
    const anciennesLignes = (await lignesAvecSuivi([id])).get(id) || [];
    const net = nettoyerCommande({
      devise: b.devise !== undefined ? b.devise : actuelle.devise,
      cours_devise: b.cours_devise !== undefined ? b.cours_devise : actuelle.cours_devise,
      incoterm: b.incoterm !== undefined ? b.incoterm : actuelle.incoterm,
      date_commande: b.date_commande !== undefined ? b.date_commande : actuelle.date_commande,
      date_livraison_prevue: b.date_livraison_prevue !== undefined ? b.date_livraison_prevue : actuelle.date_livraison_prevue,
      notes: b.notes !== undefined ? b.notes : actuelle.notes,
      dossier_ao_id: b.dossier_ao_id !== undefined || b.consultation_id !== undefined ? b.dossier_ao_id : actuelle.dossier_ao_id,
      consultation_id: b.dossier_ao_id !== undefined || b.consultation_id !== undefined ? b.consultation_id : actuelle.consultation_id,
      transitaire_id: b.transitaire_id !== undefined ? b.transitaire_id : actuelle.transitaire_id,
      cotation_id: b.cotation_id !== undefined ? b.cotation_id : actuelle.cotation_id,
      lignes: Array.isArray(b.lignes) ? b.lignes : anciennesLignes,
    });
    if (net.erreur) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, net.erreur) });
    }
    let fournisseurId = actuelle.fournisseur_id;
    if (b.fournisseur_id !== undefined) {
      if (!(await fournisseurDuTenant(client, req.user.tenantId, b.fournisseur_id))) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "COMMANDE_INVALID") });
      }
      fournisseurId = b.fournisseur_id;
    }
    const e = net.entete;
    await client.query(
      `UPDATE commande_fournisseur SET fournisseur_id = $1, devise = $2, cours_devise = $3, incoterm = $4,
              date_commande = COALESCE($5, date_commande), date_livraison_prevue = $6, notes = $7,
              dossier_ao_id = (SELECT id FROM dossier_ao WHERE id = $8 AND tenant_id = $12),
              consultation_id = (SELECT id FROM consultation WHERE id = $9 AND tenant_id = $12),
              transitaire_id = (SELECT id FROM transitaire WHERE id = $10 AND tenant_id = $12),
              cotation_id = (SELECT id FROM transitaire_cotation WHERE id = $11 AND tenant_id = $12)
       WHERE id = $13`,
      [fournisseurId, e.devise, e.cours, e.incoterm, e.date_commande, e.date_livraison_prevue, e.notes, e.dossier_ao_id,
       e.consultation_id, e.transitaire_id, e.cotation_id, req.user.tenantId, id]
    );
    if (Array.isArray(b.lignes)) await remplacerLignes(client, req.user.tenantId, id, net.lignes);
    await client.query("COMMIT");
    res.json(await chargerCommande(req.user.tenantId, id));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "COMMANDE_SAVE_ERROR") });
  } finally {
    client.release();
  }
});

// POST /:id/corriger - correction ADMINISTRATEUR d'une commande confirmee (prix unitaires, Incoterm, quantites,
// suppression de lignes), avec motif obligatoire et historique. Les receptions deja faites ne sont pas touchees.
// Corps : { motif, incoterm?, lignes?: [{ id, prix_unitaire_devise?, quantite?, supprimer? }] }
router.post("/:id/corriger", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "COMMANDE_NOT_FOUND") });
  if (!req.user.permissions || !req.user.permissions.admin) {
    return res.status(403).json({ error: t(req, "COMMANDE_CORRECTION_ADMIN") });
  }
  const b = req.body || {};
  const motif = String(b.motif || "").trim();
  if (motif.length < 3) return res.status(400).json({ error: t(req, "COMMANDE_CORRECTION_MOTIF") });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const cmd = (await client.query(`SELECT * FROM commande_fournisseur WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, req.user.tenantId])).rows[0];
    if (!cmd) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "COMMANDE_NOT_FOUND") });
    }
    if (cmd.statut !== "CONFIRMEE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "COMMANDE_CORRECTION_STATUT") });
    }
    // Lignes avec les quantites deja engagees en reception (toute reception non annulee, validee ou en brouillon).
    const lignes = (
      await client.query(
        `SELECT l.*, COALESCE((SELECT SUM(rl.quantite) FROM reception_ligne rl JOIN reception_marchandise r ON r.id = rl.reception_id
                               WHERE rl.commande_ligne_id = l.id AND r.statut <> 'ANNULEE'), 0) AS quantite_en_reception
         FROM commande_fournisseur_ligne l WHERE l.commande_id = $1 ORDER BY l.ordre`,
        [id]
      )
    ).rows;
    const parId = new Map(lignes.map((l) => [l.id, l]));
    const totalAvant = arr2(lignes.reduce((s, l) => s + Number(l.quantite) * Number(l.prix_unitaire_devise), 0));
    const modifs = [];
    const aSupprimer = [];
    const majLignes = [];
    for (const demande of Array.isArray(b.lignes) ? b.lignes : []) {
      const l = parId.get(demande && demande.id);
      if (!l) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "COMMANDE_INVALID") });
      }
      if (demande.supprimer) {
        if (Number(l.quantite_en_reception) > 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: t(req, "COMMANDE_CORRECTION_LIGNE_RECUE") });
        }
        aSupprimer.push(l.id);
        modifs.push({ type: "LIGNE_SUPPRIMEE", ligne_id: l.id, designation: l.designation, avant: { quantite: Number(l.quantite), prix_unitaire_devise: Number(l.prix_unitaire_devise) }, apres: null });
        continue;
      }
      let prix = Number(l.prix_unitaire_devise);
      let quantite = Number(l.quantite);
      if (demande.prix_unitaire_devise !== undefined && demande.prix_unitaire_devise !== null && demande.prix_unitaire_devise !== "") {
        const p = Math.round(Number(demande.prix_unitaire_devise) * 10000) / 10000;
        if (!Number.isFinite(p) || p < 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: t(req, "COMMANDE_INVALID") });
        }
        if (p !== prix) {
          modifs.push({ type: "PRIX", ligne_id: l.id, designation: l.designation, avant: prix, apres: p });
          prix = p;
        }
      }
      if (demande.quantite !== undefined && demande.quantite !== null && demande.quantite !== "") {
        const q = Math.round(Number(demande.quantite) * 1000) / 1000;
        if (!Number.isFinite(q) || q <= 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: t(req, "COMMANDE_INVALID") });
        }
        if (q < Number(l.quantite_en_reception)) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: t(req, "COMMANDE_CORRECTION_QUANTITE_RECUE") });
        }
        if (q !== quantite) {
          modifs.push({ type: "QUANTITE", ligne_id: l.id, designation: l.designation, avant: quantite, apres: q });
          quantite = q;
        }
      }
      if (prix !== Number(l.prix_unitaire_devise) || quantite !== Number(l.quantite)) majLignes.push({ id: l.id, prix, quantite });
    }
    if (aSupprimer.length >= lignes.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "COMMANDE_CORRECTION_DERNIERE_LIGNE") });
    }
    if (b.incoterm !== undefined) {
      const inco = String(b.incoterm || "").trim().toUpperCase().slice(0, 10) || null;
      if (inco !== (cmd.incoterm || null)) {
        modifs.push({ type: "INCOTERM", ligne_id: null, designation: null, avant: cmd.incoterm || null, apres: inco });
        await client.query(`UPDATE commande_fournisseur SET incoterm = $1 WHERE id = $2`, [inco, id]);
      }
    }
    if (modifs.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "COMMANDE_CORRECTION_AUCUN_CHANGEMENT") });
    }
    for (const m of majLignes) {
      await client.query(`UPDATE commande_fournisseur_ligne SET prix_unitaire_devise = $1, quantite = $2 WHERE id = $3`, [m.prix, m.quantite, m.id]);
    }
    if (aSupprimer.length) await client.query(`DELETE FROM commande_fournisseur_ligne WHERE id = ANY($1)`, [aSupprimer]);
    const totalApres = arr2(
      (await client.query(`SELECT COALESCE(SUM(quantite * prix_unitaire_devise), 0) AS t FROM commande_fournisseur_ligne WHERE commande_id = $1`, [id])).rows[0].t
    );
    const u = (await client.query(`SELECT prenom, nom FROM utilisateur WHERE id = $1`, [req.user.sub])).rows[0];
    await client.query(
      `INSERT INTO commande_fournisseur_historique (id, tenant_id, commande_id, utilisateur_id, utilisateur_nom, motif, modifications, total_avant_devise, total_apres_devise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [uuidv4(), req.user.tenantId, id, req.user.sub, u ? `${u.prenom} ${u.nom}`.trim() : req.user.email || null, motif, JSON.stringify(modifs), totalAvant, totalApres]
    );
    await client.query("COMMIT");
    res.json(await chargerCommande(req.user.tenantId, id));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "COMMANDE_SAVE_ERROR") });
  } finally {
    client.release();
  }
});

router.post("/:id/confirmer", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "COMMANDE_NOT_FOUND") });
  try {
    const c = await chargerCommande(req.user.tenantId, id);
    if (!c) return res.status(404).json({ error: t(req, "COMMANDE_NOT_FOUND") });
    if (c.statut !== "BROUILLON") return res.status(409).json({ error: t(req, "COMMANDE_NON_MODIFIABLE") });
    if (c.lignes.length === 0) return res.status(400).json({ error: t(req, "COMMANDE_VIDE") });
    await db.query(`UPDATE commande_fournisseur SET statut = 'CONFIRMEE', date_confirmation = now() WHERE id = $1`, [id]);
    res.json(await chargerCommande(req.user.tenantId, id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "COMMANDE_SAVE_ERROR") });
  }
});

router.post("/:id/annuler", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "COMMANDE_NOT_FOUND") });
  try {
    const c = (await db.query(`SELECT statut FROM commande_fournisseur WHERE id = $1 AND tenant_id = $2`, [id, req.user.tenantId])).rows[0];
    if (!c) return res.status(404).json({ error: t(req, "COMMANDE_NOT_FOUND") });
    if (c.statut === "ANNULEE") return res.status(409).json({ error: t(req, "COMMANDE_NON_MODIFIABLE") });
    const rec = await db.query(`SELECT 1 FROM reception_marchandise WHERE commande_id = $1 AND statut <> 'ANNULEE' LIMIT 1`, [id]);
    if (rec.rows.length) return res.status(409).json({ error: t(req, "COMMANDE_ANNULATION_IMPOSSIBLE") });
    await db.query(`UPDATE commande_fournisseur SET statut = 'ANNULEE' WHERE id = $1`, [id]);
    res.json(await chargerCommande(req.user.tenantId, id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "COMMANDE_SAVE_ERROR") });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "COMMANDE_NOT_FOUND") });
  try {
    const r = await db.query(`DELETE FROM commande_fournisseur WHERE id = $1 AND tenant_id = $2 AND statut = 'BROUILLON' RETURNING id`, [id, req.user.tenantId]);
    if (r.rows.length === 0) {
      const existe = await db.query(`SELECT 1 FROM commande_fournisseur WHERE id = $1 AND tenant_id = $2`, [id, req.user.tenantId]);
      return res.status(existe.rows.length ? 409 : 404).json({ error: t(req, existe.rows.length ? "COMMANDE_SUPPRESSION_IMPOSSIBLE" : "COMMANDE_NOT_FOUND") });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "COMMANDE_DELETE_ERROR") });
  }
});

module.exports = router;
module.exports.syntheseDossier = syntheseDossier;
module.exports.reevaluerMargeDossier = reevaluerMargeDossier;
