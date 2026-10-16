/**
 * Ecritures comptables des avoirs clients (Pack Commerce, lot 6c). Toujours EN_INSTANCE (validees ou corrigees par le comptable),
 * uniquement si le module Comptabilite est actif.
 *
 *   AVOIR          Dr 70x (une ligne par ligne d'avoir, HT)   Dr TVA collectee   Cr 411 client (TTC)
 *   REMBOURSEMENT  Dr 411 client                              Cr tresorerie du mode de reglement (si une somme est remboursee)
 *
 * Proposition de depart (a faire valider par l'expert-comptable) : le meme compte de vente que la facture d'origine est utilise ;
 * le comptable peut le remplacer par un compte de rabais/remises/ristournes ou de retours depuis l'ecran « En instance ».
 */
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const compta = require("./comptaService");
const modesReglement = require("./modesReglement");
const cv = require("./comptaVentes");

const { versCentimes } = compta;
const dateSql = (d) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d).slice(0, 10));

async function ecritureExistante(client, tenantId, avoirId, role) {
  const r = await client.query(
    `SELECT 1 FROM ecriture_comptable WHERE tenant_id = $1 AND origine = 'AVOIR_VENTE' AND origine_id = $2 AND origine_role = $3`,
    [tenantId, avoirId, role]
  );
  return r.rows.length > 0;
}

async function genererEcrituresAvoir(client, tenantId, utilisateurId, avoirId) {
  const parametre = await compta.getParametre(client, tenantId);
  if (!parametre || !parametre.initialisee) return { statut: "IGNOREE", raison: "NON_INITIALISEE" };
  const a = (
    await client.query(
      `SELECT a.*, f.numero AS facture_numero, c.nom AS client_nom FROM avoir_vente a
       JOIN facture_vente f ON f.id = a.facture_vente_id JOIN client_commercial c ON c.id = a.client_commercial_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [avoirId, tenantId]
    )
  ).rows[0];
  if (!a) return { statut: "IGNOREE", raison: "INTROUVABLE" };
  const date = dateSql(a.date_avoir);
  const exercice = await compta.exerciceDeLaDate(client, tenantId, date);
  if (!exercice) return { statut: "IGNOREE", raison: "HORS_EXERCICE" };
  if (exercice.statut === "CLOTURE") return { statut: "IGNOREE", raison: "EXERCICE_CLOTURE" };
  const tiers = await compta.assurerTiersClient(client, tenantId, { id: a.client_commercial_id, nom: a.client_nom });
  const idClient = await cv.idCompte(client, tenantId, tiers.compte_collectif);
  let creees = 0;

  if (!(await ecritureExistante(client, tenantId, avoirId, "AVOIR"))) {
    const journal = await cv.premierJournal(client, tenantId, "VENTES");
    if (!journal) return { statut: "IGNOREE", raison: "JOURNAL_ABSENT" };
    const idTva = await cv.idCompte(client, tenantId, parametre.compte_tva_collectee);
    const lignesAvoir = (await client.query(`SELECT designation, montant_ht FROM avoir_vente_ligne WHERE avoir_id = $1 ORDER BY ordre`, [avoirId])).rows;
    const ttcC = versCentimes(a.total_ttc);
    const htC = versCentimes(a.total_ht);
    const montants = cv.repartir(htC, lignesAvoir.map((l) => Math.max(versCentimes(l.montant_ht), 0)));
    const lignes = [];
    for (let i = 0; i < lignesAvoir.length; i++) {
      if (montants[i] === 0) continue;
      const compte = await cv.compteDeVente(client, tenantId, parametre, a.client_commercial_id, lignesAvoir[i].designation);
      lignes.push({ compte_id: compte.id, tiers_id: null, libelle: `Avoir ${a.numero} - ${lignesAvoir[i].designation}`.slice(0, 200), debit_c: montants[i], credit_c: 0, date_echeance: null, compte_modifiable: "PRODUIT" });
    }
    const tvaC = ttcC - htC;
    if (tvaC !== 0) lignes.push({ compte_id: idTva, tiers_id: null, libelle: `TVA avoir ${a.numero}`, debit_c: tvaC > 0 ? tvaC : 0, credit_c: tvaC < 0 ? -tvaC : 0, date_echeance: null });
    lignes.push({ compte_id: idClient, tiers_id: tiers.id, libelle: `Avoir ${a.numero} (facture ${a.facture_numero})`, debit_c: 0, credit_c: ttcC, date_echeance: null });
    const e = await client.query(
      `INSERT INTO ecriture_comptable
         (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'EN_INSTANCE','AVOIR_VENTE',$8,'AVOIR',$9) RETURNING id`,
      [uuidv4(), tenantId, exercice.id, journal.id, a.numero, date, `Avoir ${a.numero} - ${a.client_nom} (facture ${a.facture_numero})`.slice(0, 200), avoirId, utilisateurId || null]
    );
    await compta.insererLignes(client, tenantId, e.rows[0].id, lignes);
    creees++;
  }

  if (Number(a.montant_rembourse) > 0 && !(await ecritureExistante(client, tenantId, avoirId, "REMBOURSEMENT"))) {
    let res = null;
    try {
      res = await modesReglement.resoudre(client, tenantId, a.mode_reglement_id || null, { sens: "DECAISSEMENT", texteLegacy: a.mode_libelle });
    } catch (e) {
      if (!(e instanceof modesReglement.ModeError)) throw e;
    }
    const especes = cv.estEspeces(a.mode_libelle);
    const journal = (res && res.journal) || (await cv.premierJournal(client, tenantId, especes ? "CAISSE" : "BANQUE")) || (await cv.premierJournal(client, tenantId, especes ? "BANQUE" : "CAISSE"));
    if (!journal) return { statut: creees ? "CREEE" : "IGNOREE", raison: "JOURNAL_ABSENT", ecritures: creees };
    const numeroTreso = (res && res.compteTresorerie) || journal.compte_tresorerie || compta.completerNumero(especes ? "5711" : "5211", parametre.longueur_compte);
    const rC = versCentimes(a.montant_rembourse);
    const e = await client.query(
      `INSERT INTO ecriture_comptable
         (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'EN_INSTANCE','AVOIR_VENTE',$8,'REMBOURSEMENT',$9) RETURNING id`,
      [uuidv4(), tenantId, exercice.id, journal.id, a.numero, date, `Remboursement avoir ${a.numero} - ${a.client_nom}`.slice(0, 200), avoirId, utilisateurId || null]
    );
    await compta.insererLignes(client, tenantId, e.rows[0].id, [
      { compte_id: idClient, tiers_id: tiers.id, libelle: `Remboursement avoir ${a.numero}`, debit_c: rC, credit_c: 0, date_echeance: null },
      { compte_id: await cv.idCompte(client, tenantId, numeroTreso), tiers_id: null, libelle: `Remboursement avoir ${a.numero}${a.mode_libelle ? " - " + a.mode_libelle : ""}`, debit_c: 0, credit_c: rC, date_echeance: null, compte_modifiable: "TRESORERIE" },
    ]);
    creees++;
  }
  return { statut: creees ? "CREEE" : "EXISTANTE", ecritures: creees };
}

async function silencieux(tenantId, libelle, fn) {
  try {
    if (!(await compta.moduleComptabiliteActif(tenantId))) return null;
    return await compta.avecTransaction(fn);
  } catch (err) {
    console.error(`Comptabilite : ${libelle} impossible`, err.message);
    return null;
  }
}

const apresCreationAvoir = (tenantId, userId, avoirId) =>
  silencieux(tenantId, "ecritures d'avoir", (client) => genererEcrituresAvoir(client, tenantId, userId, avoirId));

/** Rattrapage a l'activation du module (ou depuis une date) : ecritures manquantes des avoirs. */
async function rattraperAvoirs(tenantId, utilisateurId, { depuis } = {}) {
  const liste = await db.query(
    `SELECT id FROM avoir_vente WHERE tenant_id = $1 ${depuis ? "AND date_avoir >= $2::date" : ""} ORDER BY date_avoir, date_creation`,
    depuis ? [tenantId, depuis] : [tenantId]
  );
  let creees = 0;
  for (const a of liste.rows) {
    try {
      const r = await compta.avecTransaction((client) => genererEcrituresAvoir(client, tenantId, utilisateurId, a.id));
      if (r.statut === "CREEE") creees += r.ecritures || 0;
    } catch (err) {
      console.error("Rattrapage avoirs :", err.message);
    }
  }
  return { avoirs: creees };
}

module.exports = { genererEcrituresAvoir, apresCreationAvoir, rattraperAvoirs };
