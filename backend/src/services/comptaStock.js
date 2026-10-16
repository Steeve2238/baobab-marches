/**
 * Comptabilisation du stock a l'inventaire (Pack Commerce, lot 9) - methode de l'inventaire intermittent (SYSCOHADA).
 *
 * Les achats restent en charge (compte d'achat). A la VALIDATION d'un inventaire, une ecriture EN_INSTANCE (validee ensuite par
 * le comptable) constate la variation de stock :
 *   - annulation du STOCK INITIAL = solde du compte de stock a la date (calcule naturellement : a-nouveaux ou dernier inventaire) :
 *         Dr variation de stock (6031) / Cr stock (31)
 *   - constatation du STOCK FINAL = valeur du stock a la date de l'inventaire, selon la methode choisie (CMUP / FIFO / dernier cout) :
 *         Dr stock (31) / Cr variation de stock (6031)
 * Plusieurs inventaires dans l'exercice s'enchainent sans double comptage (le solde du compte de stock sert toujours de base).
 * Comptes parametrables (compta_parametre.compte_stock_marchandises / compte_variation_stock) ; propositions : 3110.. et 6031.. du plan.
 * Uniquement si le module Comptabilite est actif ; rattrapage possible pour les inventaires valides avant l'activation.
 */
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const compta = require("./comptaService");
const cv = require("./comptaVentes");
const valo = require("./valorisationStock");

const { versCentimes, centimesVersDecimal, ComptaError } = compta;
const ORIGINE = "INVENTAIRE_STOCK";
const iso = (d) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d).slice(0, 10));

/** Comptes retenus : parametres de l'entreprise, sinon propositions du plan (31 marchandises, 6031 variation). */
async function comptes(client, tenantId, parametre) {
  const longueur = parametre.longueur_compte;
  return {
    stock: parametre.compte_stock_marchandises || compta.completerNumero("311", longueur),
    variation: parametre.compte_variation_stock || compta.completerNumero("6031", longueur),
  };
}

/** Solde debiteur du compte (ecritures validees ou en instance) a la date incluse, en centimes. */
async function soldeCompte(client, tenantId, numero, date) {
  const r = await client.query(
    `SELECT COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c
     FROM ligne_ecriture l JOIN ecriture_comptable e ON e.id = l.ecriture_id JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.tenant_id = $1 AND c.numero = $2 AND e.statut IN ('VALIDEE', 'EN_INSTANCE') AND e.date_ecriture <= $3::date`,
    [tenantId, numero, date]
  );
  return versCentimes(r.rows[0].d) - versCentimes(r.rows[0].c);
}

async function valeurStock(client, tenantId, date) {
  const v = await valo.valoriserTout(client, tenantId, { au: date });
  return { centimes: versCentimes(v.total_valeur), methode: v.methode, nb_produits: v.nb_produits };
}

/** Apercu pour une date : stock initial (solde du compte), stock final (valorisation), variation. */
async function apercu(client, tenantId, date) {
  const parametre = await compta.getParametre(client, tenantId);
  if (!parametre || !parametre.initialisee) return null;
  const cpt = await comptes(client, tenantId, parametre);
  const si = await soldeCompte(client, tenantId, cpt.stock, date);
  const sf = await valeurStock(client, tenantId, date);
  return {
    date, compte_stock: cpt.stock, compte_variation: cpt.variation, methode: sf.methode,
    stock_initial: si / 100, stock_final: sf.centimes / 100, variation: (si - sf.centimes) / 100,
  };
}

async function ecritureExistante(client, tenantId, inventaireId) {
  const r = await client.query(
    `SELECT id, statut, numero_ecriture FROM ecriture_comptable WHERE tenant_id = $1 AND origine = $2 AND origine_id = $3 AND origine_role = 'INVENTAIRE'`,
    [tenantId, ORIGINE, inventaireId]
  );
  return r.rows[0] || null;
}

async function genererEcritureInventaire(client, tenantId, utilisateurId, inventaireId) {
  const parametre = await compta.getParametre(client, tenantId);
  if (!parametre || !parametre.initialisee) return { statut: "IGNOREE", raison: "NON_INITIALISEE" };
  const inv = (await client.query(`SELECT * FROM inventaire WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [inventaireId, tenantId])).rows[0];
  if (!inv || inv.statut !== "VALIDE") return { statut: "IGNOREE", raison: "NON_VALIDE" };
  if (await ecritureExistante(client, tenantId, inventaireId)) return { statut: "EXISTANTE" };
  const date = iso(inv.date_inventaire);
  // Un inventaire plus recent deja comptabilise fausserait le stock initial : on refuse (rattraper dans l'ordre chronologique).
  const posterieur = await client.query(
    `SELECT 1 FROM inventaire i JOIN ecriture_comptable e ON e.tenant_id = i.tenant_id AND e.origine = $3 AND e.origine_id = i.id AND e.origine_role = 'INVENTAIRE'
     WHERE i.tenant_id = $1 AND i.date_inventaire > $2::date LIMIT 1`,
    [tenantId, date, ORIGINE]
  );
  if (posterieur.rows.length > 0) return { statut: "IGNOREE", raison: "INVENTAIRE_POSTERIEUR" };
  const exercice = await compta.exerciceDeLaDate(client, tenantId, date);
  if (!exercice) return { statut: "IGNOREE", raison: "HORS_EXERCICE" };
  if (exercice.statut === "CLOTURE") return { statut: "IGNOREE", raison: "EXERCICE_CLOTURE" };
  const journal = await cv.premierJournal(client, tenantId, "OPERATIONS_DIVERSES");
  if (!journal) return { statut: "IGNOREE", raison: "JOURNAL_ABSENT" };
  const cpt = await comptes(client, tenantId, parametre);
  const idStock = await cv.idCompte(client, tenantId, cpt.stock);
  const idVar = await cv.idCompte(client, tenantId, cpt.variation);
  const si = await soldeCompte(client, tenantId, cpt.stock, date);
  const sf = (await valeurStock(client, tenantId, date)).centimes;
  if (si === 0 && sf === 0) return { statut: "IGNOREE", raison: "STOCK_NUL" };

  const lib = `Inventaire ${inv.numero}`;
  const lignes = [];
  if (si !== 0) {
    const m = Math.abs(si);
    lignes.push({ compte_id: idVar, tiers_id: null, libelle: `${lib} - annulation du stock initial`, debit_c: si > 0 ? m : 0, credit_c: si < 0 ? m : 0, date_echeance: null });
    lignes.push({ compte_id: idStock, tiers_id: null, libelle: `${lib} - annulation du stock initial`, debit_c: si < 0 ? m : 0, credit_c: si > 0 ? m : 0, date_echeance: null });
  }
  if (sf !== 0) {
    lignes.push({ compte_id: idStock, tiers_id: null, libelle: `${lib} - stock final`, debit_c: sf, credit_c: 0, date_echeance: null });
    lignes.push({ compte_id: idVar, tiers_id: null, libelle: `${lib} - stock final`, debit_c: 0, credit_c: sf, date_echeance: null });
  }
  const e = await client.query(
    `INSERT INTO ecriture_comptable (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, cree_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'EN_INSTANCE',$8,$9,'INVENTAIRE',$10) RETURNING id`,
    [uuidv4(), tenantId, exercice.id, journal.id, inv.numero, date, `${lib} - variation de stock au ${date}`.slice(0, 200), ORIGINE, inventaireId, utilisateurId || null]
  );
  await compta.insererLignes(client, tenantId, e.rows[0].id, lignes);
  await compta.audit(client, tenantId, utilisateurId, "COMPTABILISATION_INVENTAIRE", "inventaire", inventaireId, null, {
    numero: inv.numero, stock_initial: centimesVersDecimal(si), stock_final: centimesVersDecimal(sf),
  });
  return { statut: "CREEE", ecriture_id: e.rows[0].id, stock_initial: si / 100, stock_final: sf / 100, variation: (si - sf) / 100 };
}

async function silencieux(tenantId, fn) {
  try {
    if (!(await compta.moduleComptabiliteActif(tenantId))) return null;
    return await compta.avecTransaction(fn);
  } catch (err) {
    console.error("Comptabilite : ecriture d'inventaire impossible", err.message);
    return null;
  }
}
/** Appele apres la validation d'un inventaire : sans effet si le module Comptabilite n'est pas actif. */
const apresValidation = (tenantId, userId, inventaireId) => silencieux(tenantId, (client) => genererEcritureInventaire(client, tenantId, userId, inventaireId));

/** Etat pour l'ecran Comptabilite : parametres, apercu a ce jour, inventaires valides et leur ecriture. */
async function etat(client, tenantId) {
  const parametre = await compta.getParametre(client, tenantId);
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const ap = await apercu(client, tenantId, aujourdhui);
  const inv = await client.query(
    `SELECT i.id, i.numero, i.libelle, i.date_inventaire, i.date_validation,
            e.id AS ecriture_id, e.statut AS ecriture_statut, e.numero_ecriture
     FROM inventaire i
     LEFT JOIN ecriture_comptable e ON e.tenant_id = i.tenant_id AND e.origine = $2 AND e.origine_id = i.id AND e.origine_role = 'INVENTAIRE'
     WHERE i.tenant_id = $1 AND i.statut = 'VALIDE' ORDER BY i.date_inventaire DESC, i.date_creation DESC LIMIT 100`,
    [tenantId, ORIGINE]
  );
  const cfg = parametre && parametre.initialisee ? await comptes(client, tenantId, parametre) : null;
  return {
    comptes: cfg, parametre_stock: !!(parametre && parametre.compte_stock_marchandises), apercu: ap,
    inventaires: inv.rows.map((x) => ({ ...x, date_inventaire: iso(x.date_inventaire) })),
  };
}

/** Rattrapage : comptabilise, dans l'ordre chronologique, les inventaires valides sans ecriture. */
async function rattraper(tenantId, utilisateurId) {
  const liste = await db.query(
    `SELECT i.id FROM inventaire i WHERE i.tenant_id = $1 AND i.statut = 'VALIDE'
       AND NOT EXISTS (SELECT 1 FROM ecriture_comptable e WHERE e.tenant_id = i.tenant_id AND e.origine = $2 AND e.origine_id = i.id AND e.origine_role = 'INVENTAIRE')
     ORDER BY i.date_inventaire, i.date_creation`,
    [tenantId, ORIGINE]
  );
  let creees = 0;
  for (const i of liste.rows) {
    const r = await compta.avecTransaction((client) => genererEcritureInventaire(client, tenantId, utilisateurId, i.id));
    if (r.statut === "CREEE") creees += 1;
  }
  return { ecritures: creees };
}

module.exports = { ORIGINE, apercu, genererEcritureInventaire, apresValidation, etat, rattraper };
