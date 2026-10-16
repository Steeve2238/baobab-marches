/**
 * Depenses et resultat mensuel (Pack Commerce, lot 5).
 *
 * - Categories de depenses parametrables (compte de charge + compte de TVA recuperable) : les comptes
 *   proposes par defaut ne sont que des propositions, modifiables par l'entreprise.
 * - Saisie rapide d'une depense reglee via un mode de reglement (sens DECAISSEMENT).
 * - Ecriture comptable automatique EN_INSTANCE, uniquement si le module comptabilite est actif :
 *       Dr compte de charge (HT)   Dr TVA recuperable (si parametree)   Cr tresorerie du mode (TTC)
 *   Elle est validee ou corrigee par le comptable depuis l'ecran « En instance » (comme toutes les ecritures).
 * - Compte de resultat mensuel simplifie et marges par produit / par vendeur, calcules a partir des
 *   donnees d'exploitation (ils ne dependent pas du module comptabilite).
 */
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const compta = require("./comptaService");
const modesReglement = require("./modesReglement");

const { versCentimes, centimesVersDecimal } = compta;

class DepenseError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// Propositions de depart (SYSCOHADA revise). A valider avec l'expert-comptable de chaque entreprise.
const DEFAUTS = [
  ["LOYER", "Loyer et charges locatives", "62220000", null],
  ["ELEC_EAU", "Électricité et eau", "60520000", "44520000"],
  ["CARBURANT", "Carburant", "60530000", "44520000"],
  ["FOURNITURES", "Fournitures de bureau", "60550000", "44520000"],
  ["ENTRETIEN", "Entretien et réparations", "62420000", "44540000"],
  ["TRANSPORT_VENTES", "Transport sur ventes (livraisons)", "61200000", "44540000"],
  ["TRANSPORT_ACHATS", "Transport sur achats", "61100000", "44540000"],
  ["TELEPHONE", "Téléphone et internet", "62810000", "44540000"],
  ["PUBLICITE", "Publicité et annonces", "62710000", "44540000"],
  ["HONORAIRES", "Honoraires (comptable, avocat…)", "63240000", "44540000"],
  ["FRAIS_BANCAIRES", "Frais bancaires", "63180000", null],
  ["ASSURANCES", "Assurances", "62510000", null],
  ["IMPOTS_TAXES", "Impôts et taxes", "64800000", null],
  ["SALAIRES", "Salaires et appointements", "66110000", null],
  ["DIVERS", "Charges diverses", "65880000", null],
];

const txt = (v, max) => {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
};
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const dateSql = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const dateValide = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());
const arr2 = (n) => Math.round(Number(n) * 100) / 100;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
async function assurerCategoriesDefaut(queryable, tenantId) {
  const n = await queryable.query(`SELECT COUNT(*)::int AS n FROM categorie_depense WHERE tenant_id = $1`, [tenantId]);
  if (n.rows[0].n > 0) return;
  let ordre = 0;
  for (const [code, libelle, charge, tva] of DEFAUTS) {
    await queryable.query(
      `INSERT INTO categorie_depense (id, tenant_id, code, libelle, compte_charge, compte_tva, ordre)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, code) DO NOTHING`,
      [uuidv4(), tenantId, code, libelle, charge, tva, ordre++]
    );
  }
}

async function listerCategories(tenantId, { actives = false } = {}) {
  await assurerCategoriesDefaut(db, tenantId);
  const r = await db.query(
    `SELECT c.*, (SELECT COUNT(*)::int FROM depense d WHERE d.categorie_id = c.id) AS nb_depenses
     FROM categorie_depense c WHERE c.tenant_id = $1 ${actives ? "AND c.actif = true" : ""} ORDER BY c.ordre, c.libelle`,
    [tenantId]
  );
  return r.rows;
}

async function verifierCompte(tenantId, numero, erreur) {
  if (!numero) return;
  const c = await db.query(`SELECT 1 FROM compte_comptable WHERE tenant_id = $1 AND numero = $2`, [tenantId, numero]);
  // Plan comptable non encore initialise : on ne bloque pas (le compte sera controle a la comptabilisation).
  const plan = await db.query(`SELECT 1 FROM compte_comptable WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  if (plan.rows.length > 0 && c.rows.length === 0) throw new DepenseError(erreur);
}

async function nettoyerCategorie(tenantId, data, existante = null) {
  const get = (k) => (data[k] !== undefined ? data[k] : existante ? existante[k] : null);
  const libelle = txt(get("libelle"), 80);
  if (!libelle) throw new DepenseError("DEPENSE_CATEGORIE_LIBELLE_REQUIS");
  const compteCharge = txt(get("compte_charge"), 20);
  const compteTva = txt(get("compte_tva"), 20);
  await verifierCompte(tenantId, compteCharge, "DEPENSE_COMPTE_CHARGE_INTROUVABLE");
  await verifierCompte(tenantId, compteTva, "DEPENSE_COMPTE_TVA_INTROUVABLE");
  return { libelle, compte_charge: compteCharge, compte_tva: compteTva, actif: data.actif !== undefined ? !!data.actif : existante ? existante.actif : true };
}

async function creerCategorie(tenantId, data) {
  await assurerCategoriesDefaut(db, tenantId);
  const n = await nettoyerCategorie(tenantId, data);
  const base = (txt(data.code, 30) || n.libelle).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "CATEGORIE";
  let code = base, i = 1;
  while ((await db.query(`SELECT 1 FROM categorie_depense WHERE tenant_id = $1 AND code = $2`, [tenantId, code])).rows.length > 0) code = `${base}_${++i}`;
  const o = await db.query(`SELECT COALESCE(MAX(ordre),0)+1 AS o FROM categorie_depense WHERE tenant_id = $1`, [tenantId]);
  const r = await db.query(
    `INSERT INTO categorie_depense (id, tenant_id, code, libelle, compte_charge, compte_tva, actif, ordre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [uuidv4(), tenantId, code, n.libelle, n.compte_charge, n.compte_tva, n.actif, o.rows[0].o]
  );
  return r.rows[0];
}

async function modifierCategorie(tenantId, id, data) {
  const ex = (await db.query(`SELECT * FROM categorie_depense WHERE id = $1 AND tenant_id = $2`, [id, tenantId])).rows[0];
  if (!ex) throw new DepenseError("DEPENSE_CATEGORIE_INTROUVABLE", 404);
  const n = await nettoyerCategorie(tenantId, data, ex);
  const r = await db.query(
    `UPDATE categorie_depense SET libelle = $3, compte_charge = $4, compte_tva = $5, actif = $6 WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenantId, n.libelle, n.compte_charge, n.compte_tva, n.actif]
  );
  return r.rows[0];
}

async function supprimerCategorie(tenantId, id) {
  const ex = (await db.query(`SELECT * FROM categorie_depense WHERE id = $1 AND tenant_id = $2`, [id, tenantId])).rows[0];
  if (!ex) throw new DepenseError("DEPENSE_CATEGORIE_INTROUVABLE", 404);
  const used = await db.query(`SELECT 1 FROM depense WHERE categorie_id = $1 LIMIT 1`, [id]);
  if (used.rows.length > 0) {
    await db.query(`UPDATE categorie_depense SET actif = false WHERE id = $1`, [id]);
    return { desactivee: true };
  }
  await db.query(`DELETE FROM categorie_depense WHERE id = $1`, [id]);
  return { supprimee: true };
}

// ---------------------------------------------------------------------------
// Depenses
// ---------------------------------------------------------------------------
async function prochainNumero(client, tenantId, annee) {
  await client.query(
    `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero) VALUES ($1, 'DEPENSE', $2, 0)
     ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
    [tenantId, annee]
  );
  const r = await client.query(
    `UPDATE compteur_numerotation SET dernier_numero = dernier_numero + 1 WHERE tenant_id = $1 AND type_compteur = 'DEPENSE' AND annee = $2 RETURNING dernier_numero`,
    [tenantId, annee]
  );
  return `DEP-${annee}-${String(r.rows[0].dernier_numero).padStart(4, "0")}`;
}

async function creerDepense(utilisateur, data) {
  const { tenantId, sub: userId } = utilisateur;
  const date = data.date_depense || aujourdhui();
  if (!dateValide(date)) throw new DepenseError("DEPENSE_DATE_INVALIDE");
  const libelle = txt(data.libelle, 200);
  if (!libelle) throw new DepenseError("DEPENSE_LIBELLE_REQUIS");
  const ttc = Number(data.montant_ttc);
  if (!Number.isFinite(ttc) || ttc <= 0) throw new DepenseError("DEPENSE_MONTANT_INVALIDE");
  const taux = data.taux_tva_pourcentage === undefined || data.taux_tva_pourcentage === "" ? 0 : Number(data.taux_tva_pourcentage);
  if (!Number.isFinite(taux) || taux < 0 || taux > 100) throw new DepenseError("DEPENSE_TVA_INVALIDE");

  const client = await db.pool.connect();
  let depense;
  try {
    await client.query("BEGIN");
    const cat = (await client.query(`SELECT * FROM categorie_depense WHERE id = $1 AND tenant_id = $2 AND actif = true`, [data.categorie_id, tenantId])).rows[0];
    if (!cat) throw new DepenseError("DEPENSE_CATEGORIE_INTROUVABLE", 404);
    let modeId = null, modeLibelle = txt(data.mode_libelle, 80);
    if (data.mode_reglement_id) {
      const m = await modesReglement.lire(client, tenantId, data.mode_reglement_id);
      if (!m || !m.actif) throw new DepenseError("MODE_REGLEMENT_INTROUVABLE", 404);
      if (m.sens !== "LES_DEUX" && m.sens !== "DECAISSEMENT") throw new DepenseError("MODE_REGLEMENT_SENS_INTERDIT");
      modeId = m.id; modeLibelle = m.libelle;
    } else {
      throw new DepenseError("DEPENSE_MODE_REQUIS");
    }
    const ttcC = versCentimes(ttc);
    const htC = taux > 0 ? Math.round((ttcC * 100) / (100 + taux)) : ttcC;
    const tvaC = ttcC - htC;
    const numero = await prochainNumero(client, tenantId, Number(date.slice(0, 4)));
    const r = await client.query(
      `INSERT INTO depense (id, tenant_id, numero, date_depense, categorie_id, libelle, beneficiaire, montant_ttc, taux_tva_pourcentage,
                            montant_tva, montant_ht, mode_reglement_id, mode_libelle, reference, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [uuidv4(), tenantId, numero, date, cat.id, libelle, txt(data.beneficiaire, 120), centimesVersDecimal(ttcC), taux,
       centimesVersDecimal(tvaC), centimesVersDecimal(htC), modeId, modeLibelle, txt(data.reference, 80), userId || null]
    );
    depense = r.rows[0];
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await apresDepense(tenantId, userId, depense.id);
  return depense;
}

async function listerDepenses(tenantId, { du, au, categorie_id, limit = 300 } = {}) {
  const params = [tenantId];
  let f = "";
  if (du && dateValide(du)) { params.push(du); f += ` AND d.date_depense >= $${params.length}`; }
  if (au && dateValide(au)) { params.push(au); f += ` AND d.date_depense <= $${params.length}`; }
  if (categorie_id) { params.push(categorie_id); f += ` AND d.categorie_id::text = $${params.length}`; }
  const r = await db.query(
    `SELECT d.*, c.libelle AS categorie_libelle, u.prenom, u.nom AS nom_utilisateur,
            (SELECT e.statut FROM ecriture_comptable e WHERE e.tenant_id = d.tenant_id AND e.origine = 'DEPENSE' AND e.origine_id = d.id AND e.origine_role = 'DEPENSE' LIMIT 1) AS ecriture_statut
     FROM depense d JOIN categorie_depense c ON c.id = d.categorie_id LEFT JOIN utilisateur u ON u.id = d.cree_par
     WHERE d.tenant_id = $1 ${f} ORDER BY d.date_depense DESC, d.date_creation DESC LIMIT ${Math.min(Math.max(Number(limit) || 300, 1), 1000)}`,
    params
  );
  const actives = r.rows.filter((d) => d.statut === "ENREGISTREE");
  return {
    depenses: r.rows.map((d) => ({ ...d, cree_par_nom: [d.prenom, d.nom_utilisateur].filter(Boolean).join(" ") || null })),
    total_ttc: arr2(actives.reduce((s, d) => s + Number(d.montant_ttc), 0)),
    total_ht: arr2(actives.reduce((s, d) => s + Number(d.montant_ht), 0)),
  };
}

async function annulerDepense(utilisateur, id) {
  const { tenantId, sub: userId } = utilisateur;
  const d = (await db.query(`SELECT * FROM depense WHERE id = $1 AND tenant_id = $2`, [id, tenantId])).rows[0];
  if (!d) throw new DepenseError("DEPENSE_INTROUVABLE", 404);
  if (d.statut === "ANNULEE") throw new DepenseError("DEPENSE_DEJA_ANNULEE", 409);
  await db.query(`UPDATE depense SET statut = 'ANNULEE', date_annulation = now() WHERE id = $1`, [id]);
  await silencieux(tenantId, "annulation de depense", (client) => genererAnnulationDepense(client, tenantId, userId, id));
  return { id, statut: "ANNULEE" };
}

// ---------------------------------------------------------------------------
// Comptabilite (uniquement si le module est actif chez le client)
// ---------------------------------------------------------------------------
async function silencieux(tenantId, libelle, fn) {
  try {
    if (!(await compta.moduleComptabiliteActif(tenantId))) return null;
    return await compta.avecTransaction(fn);
  } catch (err) {
    console.error(`Comptabilite : ${libelle} impossible`, err.message);
    return null;
  }
}

async function compteParNumero(client, tenantId, numero) {
  const r = await client.query(`SELECT id FROM compte_comptable WHERE tenant_id = $1 AND numero = $2`, [tenantId, numero]);
  return r.rows[0] ? r.rows[0].id : null;
}

async function genererEcritureDepense(client, tenantId, utilisateurId, depenseId) {
  const parametre = await compta.getParametre(client, tenantId);
  if (!parametre || !parametre.initialisee) return { statut: "IGNOREE", raison: "NON_INITIALISEE" };
  const d = (await client.query(
    `SELECT d.*, c.compte_charge, c.compte_tva, c.libelle AS categorie_libelle FROM depense d JOIN categorie_depense c ON c.id = d.categorie_id
     WHERE d.id = $1 AND d.tenant_id = $2`, [depenseId, tenantId]
  )).rows[0];
  if (!d || d.statut !== "ENREGISTREE") return { statut: "IGNOREE", raison: "NON_ENREGISTREE" };
  const ex = await client.query(`SELECT 1 FROM ecriture_comptable WHERE tenant_id = $1 AND origine = 'DEPENSE' AND origine_id = $2 AND origine_role = 'DEPENSE'`, [tenantId, depenseId]);
  if (ex.rows.length > 0) return { statut: "EXISTANTE" };
  const date = dateSql(d.date_depense);
  const exercice = await compta.exerciceDeLaDate(client, tenantId, date);
  if (!exercice) return { statut: "IGNOREE", raison: "HORS_EXERCICE" };
  if (exercice.statut === "CLOTURE") return { statut: "IGNOREE", raison: "EXERCICE_CLOTURE" };
  if (!d.compte_charge) return { statut: "IGNOREE", raison: "COMPTE_CHARGE_ABSENT" };
  const idCharge = await compteParNumero(client, tenantId, d.compte_charge);
  if (!idCharge) return { statut: "IGNOREE", raison: "COMPTE_CHARGE_INTROUVABLE" };

  let res = null;
  try {
    res = await modesReglement.resoudre(client, tenantId, d.mode_reglement_id || null, { sens: "DECAISSEMENT", texteLegacy: d.mode_libelle });
  } catch (e) {
    if (!(e instanceof modesReglement.ModeError)) throw e;
    return { statut: "IGNOREE", raison: e.code };
  }
  const especes = /esp|cash|caisse|liquide/i.test(String(d.mode_libelle || ""));
  const journal = (res && res.journal)
    || (await client.query(`SELECT * FROM journal_comptable WHERE tenant_id = $1 AND type_journal = $2 AND actif = true ORDER BY code LIMIT 1`, [tenantId, especes ? "CAISSE" : "BANQUE"])).rows[0];
  if (!journal) return { statut: "IGNOREE", raison: "JOURNAL_ABSENT" };
  const numeroTreso = (res && res.compteTresorerie) || journal.compte_tresorerie || compta.completerNumero(especes ? "5711" : "5211", parametre.longueur_compte);
  const idTreso = await compteParNumero(client, tenantId, numeroTreso);
  if (!idTreso) return { statut: "IGNOREE", raison: "COMPTE_TRESORERIE_INTROUVABLE" };

  const ttcC = versCentimes(d.montant_ttc), tvaC = versCentimes(d.montant_tva);
  let idTva = null;
  if (tvaC > 0 && d.compte_tva) idTva = await compteParNumero(client, tenantId, d.compte_tva);
  // Pas de compte de TVA recuperable exploitable : la TVA reste dans la charge (non recuperee).
  const chargeC = idTva ? ttcC - tvaC : ttcC;
  const libelle = `${d.categorie_libelle} - ${d.libelle}`.slice(0, 200);
  const lignes = [{ compte_id: idCharge, tiers_id: null, libelle, debit_c: chargeC, credit_c: 0, date_echeance: null }];
  if (idTva) lignes.push({ compte_id: idTva, tiers_id: null, libelle: `TVA ${d.numero}`, debit_c: tvaC, credit_c: 0, date_echeance: null });
  lignes.push({ compte_id: idTreso, tiers_id: null, libelle: `Paiement ${d.numero}${d.mode_libelle ? " - " + d.mode_libelle : ""}`, debit_c: 0, credit_c: ttcC, date_echeance: null, compte_modifiable: "TRESORERIE" });
  const ecriture = await client.query(
    `INSERT INTO ecriture_comptable
       (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, cree_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'EN_INSTANCE','DEPENSE',$8,'DEPENSE',$9) RETURNING *`,
    [uuidv4(), tenantId, exercice.id, journal.id, d.numero, date, libelle, depenseId, utilisateurId || null]
  );
  await compta.insererLignes(client, tenantId, ecriture.rows[0].id, lignes);
  return { statut: "CREEE" };
}

async function genererAnnulationDepense(client, tenantId, utilisateurId, depenseId) {
  const parametre = await compta.getParametre(client, tenantId);
  if (!parametre || !parametre.initialisee) return { statut: "IGNOREE", raison: "NON_INITIALISEE" };
  const ecritures = await client.query(
    `SELECT * FROM ecriture_comptable WHERE tenant_id = $1 AND origine = 'DEPENSE' AND origine_id = $2 AND origine_role = 'DEPENSE' FOR UPDATE`, [tenantId, depenseId]
  );
  for (const e of ecritures.rows) {
    if (e.statut !== "VALIDEE") {
      await client.query(`DELETE FROM ligne_ecriture WHERE ecriture_id = $1`, [e.id]);
      await client.query(`DELETE FROM ecriture_comptable WHERE id = $1`, [e.id]);
      continue;
    }
    if (e.extournee_par_id) continue;
    const date = aujourdhui();
    const exercice = await compta.exerciceDeLaDate(client, tenantId, date);
    if (!exercice || exercice.statut === "CLOTURE") continue;
    const inverse = await client.query(
      `INSERT INTO ecriture_comptable
         (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, extourne_de_id, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'EN_INSTANCE','DEPENSE',$8,'ANNULATION',$9,$10) RETURNING *`,
      [uuidv4(), tenantId, exercice.id, e.journal_id, e.numero_piece, date, `Annulation : ${e.libelle}`, depenseId, e.id, utilisateurId || null]
    );
    const lignes = await client.query(`SELECT * FROM ligne_ecriture WHERE ecriture_id = $1 ORDER BY ordre`, [e.id]);
    await compta.insererLignes(client, tenantId, inverse.rows[0].id, lignes.rows.map((l) => ({
      compte_id: l.compte_id, tiers_id: l.tiers_id, libelle: l.libelle,
      debit_c: versCentimes(l.credit), credit_c: versCentimes(l.debit),
      date_echeance: null, compte_modifiable: l.compte_modifiable === "TRESORERIE" ? "TRESORERIE" : null, analytique_inverse_de: l.id,
    })));
    await client.query(`UPDATE ecriture_comptable SET extournee_par_id = $2 WHERE id = $1`, [e.id, inverse.rows[0].id]);
  }
  return { statut: "OK" };
}

const apresDepense = (tenantId, userId, depenseId) =>
  silencieux(tenantId, "ecriture de depense", (client) => genererEcritureDepense(client, tenantId, userId, depenseId));

/** Rattrapage : ecritures manquantes des depenses enregistrees (appele par le rattrapage global des ventes). */
async function rattraperDepenses(tenantId, utilisateurId, { depuis } = {}) {
  const liste = await db.query(
    `SELECT id FROM depense WHERE tenant_id = $1 AND statut = 'ENREGISTREE' ${depuis ? "AND date_depense >= $2::date" : ""} ORDER BY date_depense`,
    depuis ? [tenantId, depuis] : [tenantId]
  );
  let creees = 0;
  for (const d of liste.rows) {
    try {
      const r = await compta.avecTransaction((client) => genererEcritureDepense(client, tenantId, utilisateurId, d.id));
      if (r.statut === "CREEE") creees++;
    } catch (err) {
      console.error("Rattrapage depenses :", err.message);
    }
  }
  return { depenses: creees };
}

// ---------------------------------------------------------------------------
// Resultat mensuel simplifie
// ---------------------------------------------------------------------------
function moisBornes(mois) {
  const m = /^(\d{4})-(\d{2})$/.test(String(mois || "")) ? String(mois) : aujourdhui().slice(0, 7);
  const [a, mm] = m.split("-").map(Number);
  const debut = `${a}-${String(mm).padStart(2, "0")}-01`;
  const fin = new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10);
  return { mois: m, debut, fin };
}

async function calculMois(tenantId, debut, fin) {
  // CA HT net des remises, diminue des avoirs clients emis dans la periode (lot 6c).
  const ca = (await db.query(
    `SELECT COALESCE(SUM(total_ht - montant_remise),0)
              - COALESCE((SELECT SUM(total_ht) FROM avoir_vente a WHERE a.tenant_id = $1 AND a.date_avoir BETWEEN $2 AND $3),0) AS ht,
            COUNT(*)::int AS nb FROM facture_vente
     WHERE tenant_id = $1 AND statut <> 'ANNULEE' AND date_facture BETWEEN $2 AND $3`, [tenantId, debut, fin]
  )).rows[0];
  // Cout des marchandises vendues = sorties de stock des BL de la periode, valorisees au cout enregistre a la sortie,
  // diminue des marchandises remises en stock par les avoirs (au cout de sortie d'origine).
  const cout = (await db.query(
    `SELECT COALESCE(SUM(-quantite * COALESCE(cout_unitaire_xof,0)),0) AS c FROM mouvement_stock
     WHERE tenant_id = $1 AND ((type_mouvement = 'SORTIE' AND origine_type = 'BL') OR origine_type = 'AVOIR') AND date_mouvement BETWEEN $2 AND $3`, [tenantId, debut, fin]
  )).rows[0];
  const ch = (await db.query(
    `SELECT c.id, c.libelle, COALESCE(SUM(d.montant_ht),0) AS ht
     FROM depense d JOIN categorie_depense c ON c.id = d.categorie_id
     WHERE d.tenant_id = $1 AND d.statut = 'ENREGISTREE' AND d.date_depense BETWEEN $2 AND $3 GROUP BY c.id, c.libelle ORDER BY 3 DESC`, [tenantId, debut, fin]
  )).rows;
  const caHt = Number(ca.ht), coutV = Number(cout.c);
  const charges = ch.map((c) => ({ categorie: c.libelle, montant: Math.round(Number(c.ht)) }));
  const totalCharges = charges.reduce((s, c) => s + c.montant, 0);
  const marge = Math.round(caHt - coutV);
  return {
    ca_ht: Math.round(caHt), nb_factures: ca.nb, cout_ventes: Math.round(coutV), marge_brute: marge,
    taux_marge: caHt > 0 ? Math.round(((caHt - coutV) / caHt) * 1000) / 10 : null,
    charges, total_charges: totalCharges, resultat: marge - totalCharges,
  };
}

async function resultatMensuel(tenantId, mois) {
  const b = moisBornes(mois);
  const courant = await calculMois(tenantId, b.debut, b.fin);
  // Tendance : 6 derniers mois se terminant au mois demande
  const [a, m] = b.mois.split("-").map(Number);
  const serie = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    const deb = d.toISOString().slice(0, 10);
    const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const c = i === 0 ? courant : await calculMois(tenantId, deb, fin);
    serie.push({ mois: deb.slice(0, 7), ca_ht: c.ca_ht, marge_brute: c.marge_brute, total_charges: c.total_charges, resultat: c.resultat });
  }
  const precedent = serie[serie.length - 2];
  return { mois: b.mois, debut: b.debut, fin: b.fin, ...courant, serie, precedent };
}

/** Marges par produit et par vendeur sur une periode (cout = sorties de stock des BL de la periode). */
async function marges(tenantId, du, au) {
  const debut = du && dateValide(du) ? du : aujourdhui().slice(0, 8) + "01";
  const fin = au && dateValide(au) ? au : aujourdhui();
  const produits = (await db.query(
    `WITH lignes AS (
       SELECT l.produit_id, l.designation, l.quantite AS q, l.montant_ht * (1 - f.pourcentage_remise / 100) AS ht
       FROM facture_vente_ligne l JOIN facture_vente f ON f.id = l.facture_vente_id
       WHERE f.tenant_id = $1 AND f.statut <> 'ANNULEE' AND f.date_facture BETWEEN $2 AND $3 AND l.produit_id IS NOT NULL AND l.non_chiffre = false
       UNION ALL
       SELECT al.produit_id, al.designation, -al.quantite, -al.montant_ht
       FROM avoir_vente_ligne al JOIN avoir_vente a ON a.id = al.avoir_id
       WHERE a.tenant_id = $1 AND a.date_avoir BETWEEN $2 AND $3 AND al.produit_id IS NOT NULL),
     ca AS (SELECT produit_id, MAX(designation) AS designation, SUM(q) AS qte, SUM(ht) AS ca_ht FROM lignes GROUP BY produit_id),
     cout AS (
       SELECT produit_id, SUM(-quantite * COALESCE(cout_unitaire_xof,0)) AS c FROM mouvement_stock
       WHERE tenant_id = $1 AND ((type_mouvement = 'SORTIE' AND origine_type = 'BL') OR origine_type = 'AVOIR') AND date_mouvement BETWEEN $2 AND $3 GROUP BY produit_id)
     SELECT ca.produit_id, ca.designation, p.reference, ca.qte, ca.ca_ht, COALESCE(cout.c,0) AS cout
     FROM ca LEFT JOIN cout ON cout.produit_id = ca.produit_id LEFT JOIN produit p ON p.id = ca.produit_id ORDER BY ca.ca_ht DESC`,
    [tenantId, debut, fin]
  )).rows.map((p) => {
    const ca = Number(p.ca_ht), c = Number(p.cout);
    return { produit_id: p.produit_id, designation: p.designation, reference: p.reference, qte: Math.round(Number(p.qte) * 100) / 100,
      ca_ht: Math.round(ca), cout: Math.round(c), marge: Math.round(ca - c), taux: ca > 0 ? Math.round(((ca - c) / ca) * 1000) / 10 : null };
  });
  const vendeurs = (await db.query(
    `WITH f AS (
       SELECT fv.id, fv.total_ht - fv.montant_remise
                - COALESCE((SELECT SUM(a.total_ht) FROM avoir_vente a WHERE a.facture_vente_id = fv.id AND a.date_avoir BETWEEN $2 AND $3), 0) AS total_ht,
              COALESCE(fv.vendeur_id, fv.cree_par) AS vendeur
       FROM facture_vente fv
       WHERE fv.tenant_id = $1 AND fv.statut <> 'ANNULEE' AND fv.date_facture BETWEEN $2 AND $3),
     cout AS (
       SELECT x.fid, SUM(x.c) AS c FROM (
         SELECT bl.facture_vente_id AS fid, SUM(-m.quantite * COALESCE(m.cout_unitaire_xof,0)) AS c
         FROM mouvement_stock m JOIN bon_livraison bl ON bl.id = m.origine_id
         WHERE m.tenant_id = $1 AND m.type_mouvement = 'SORTIE' AND m.origine_type = 'BL' AND m.date_mouvement BETWEEN $2 AND $3 GROUP BY bl.facture_vente_id
         UNION ALL
         SELECT a.facture_vente_id AS fid, SUM(-m.quantite * COALESCE(m.cout_unitaire_xof,0)) AS c
         FROM mouvement_stock m JOIN avoir_vente a ON a.id = m.origine_id
         WHERE m.tenant_id = $1 AND m.origine_type = 'AVOIR' AND m.date_mouvement BETWEEN $2 AND $3 GROUP BY a.facture_vente_id) x GROUP BY x.fid)
     SELECT f.vendeur, u.prenom, u.nom, COUNT(*)::int AS nb, SUM(f.total_ht) AS ca_ht, COALESCE(SUM(cout.c),0) AS cout
     FROM f LEFT JOIN cout ON cout.fid = f.id LEFT JOIN utilisateur u ON u.id = f.vendeur GROUP BY f.vendeur, u.prenom, u.nom ORDER BY 5 DESC`,
    [tenantId, debut, fin]
  )).rows.map((v) => {
    const ca = Number(v.ca_ht), c = Number(v.cout);
    return { vendeur: [v.prenom, v.nom].filter(Boolean).join(" ") || "—", nb_factures: v.nb, ca_ht: Math.round(ca), cout: Math.round(c), marge: Math.round(ca - c), taux: ca > 0 ? Math.round(((ca - c) / ca) * 1000) / 10 : null };
  });
  return { du: debut, au: fin, produits, vendeurs };
}

module.exports = {
  DepenseError, DEFAUTS, listerCategories, creerCategorie, modifierCategorie, supprimerCategorie,
  creerDepense, listerDepenses, annulerDepense, genererEcritureDepense, rattraperDepenses, resultatMensuel, marges,
};
