/**
 * Comptabilite - phase 3B : encaissements clients (reglements imputes sur les
 * factures de vente, partiels ou totaux).
 *
 *   ENCAISSEMENT   Dr 52x / 57x (compte de tresorerie du journal choisi)
 *                  Cr 411 (client, part imputee aux factures)
 *                  Cr 4191 (client, reliquat = avance recue)
 *
 * Meme principe que les reglements fournisseurs : ecriture EN_INSTANCE validee
 * ensuite par le responsable. La facture de vente passe PAYEE quand le montant
 * encaisse atteint le net a payer. "Marquer payee" dans Ventes encaisse le
 * reste a payer (voir comptaVentes.genererEcritureEncaissement) ; une facture
 * encaissee en partie ne peut pas etre annulee (annuler d'abord les reglements).
 */
const { v4: uuidv4 } = require("uuid");
const compta = require("./comptaService");

const { versCentimes, centimesVersDecimal, ComptaError } = compta;
const ORIGINE = "REGLEMENT_CLIENT";

const dateValide = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());
const dateSql = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

async function prochainNumero(client, tenantId, annee) {
  await client.query(
    `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero)
     VALUES ($1, 'REGL_CLIENT', $2, 0) ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
    [tenantId, annee]
  );
  const r = await client.query(
    `UPDATE compteur_numerotation SET dernier_numero = dernier_numero + 1
     WHERE tenant_id = $1 AND type_compteur = 'REGL_CLIENT' AND annee = $2 RETURNING dernier_numero`,
    [tenantId, annee]
  );
  return `RC-${annee}-${String(r.rows[0].dernier_numero).padStart(4, "0")}`;
}

async function idCompte(client, tenantId, numero) {
  const r = await client.query(`SELECT id FROM compte_comptable WHERE tenant_id = $1 AND numero = $2`, [tenantId, String(numero)]);
  if (!r.rows[0]) throw new ComptaError("COMPTA_COMPTE_INTROUVABLE", 400, { numero });
  return r.rows[0].id;
}

async function tiersClient(client, tenantId, tiersId) {
  const r = await client.query(`SELECT * FROM tiers_comptable WHERE id = $1 AND tenant_id = $2`, [tiersId, tenantId]);
  const t = r.rows[0];
  if (!t || t.type_tiers !== "CLIENT" || !t.actif) throw new ComptaError("COMPTA_CLIENT_INTROUVABLE", 404);
  return t;
}

/** Clients ayant des factures de vente a encaisser, avec leur reste a payer. */
async function listerClientsAEncaisser(client, tenantId) {
  const r = await client.query(
    `SELECT t.id, t.code, t.nom, t.compte_collectif,
            COUNT(f.id)::int AS nb_factures,
            COALESCE(SUM(f.montant_net_a_payer - f.montant_encaisse), 0) AS solde
     FROM tiers_comptable t
     JOIN facture_vente f ON f.client_commercial_id = t.client_commercial_id AND f.tenant_id = t.tenant_id AND f.statut = 'IMPAYEE'
     WHERE t.tenant_id = $1 AND t.type_tiers = 'CLIENT' AND t.actif = true
     GROUP BY t.id ORDER BY t.nom`,
    [tenantId]
  );
  return r.rows;
}

/** Factures de vente impayees d'un client (reste a payer = net - deja encaisse). */
async function facturesOuvertesClient(client, tenantId, tiersId) {
  const t = await tiersClient(client, tenantId, tiersId);
  const r = await client.query(
    `SELECT f.id, f.numero, f.date_facture, f.date_echeance, f.montant_net_a_payer, f.montant_encaisse,
            (f.montant_net_a_payer - f.montant_encaisse) AS solde,
            (f.date_echeance IS NOT NULL AND f.date_echeance < CURRENT_DATE) AS en_retard
     FROM facture_vente f
     WHERE f.tenant_id = $1 AND f.client_commercial_id = $2 AND f.statut = 'IMPAYEE'
     ORDER BY COALESCE(f.date_echeance, f.date_facture), f.numero`,
    [tenantId, t.client_commercial_id]
  );
  return r.rows;
}

async function creerReglementClient(client, tenantId, utilisateurId, data) {
  const parametre = await compta.exigerInitialise(client, tenantId);
  const tiers = await tiersClient(client, tenantId, data.tiers_id);
  if (!dateValide(data.date_reglement)) throw new ComptaError("COMPTA_DATE_INVALIDE");
  const montantC = versCentimes(data.montant);
  if (Number.isNaN(montantC) || montantC <= 0) throw new ComptaError("COMPTA_MONTANT_INVALIDE");
  const exercice = await compta.exerciceDeLaDate(client, tenantId, data.date_reglement);
  if (!exercice) throw new ComptaError("COMPTA_EXERCICE_INTROUVABLE", 400);
  if (exercice.statut === "CLOTURE") throw new ComptaError("COMPTA_EXERCICE_CLOTURE", 409);

  const jr = await client.query(
    `SELECT * FROM journal_comptable WHERE id = $1 AND tenant_id = $2 AND actif = true AND type_journal IN ('BANQUE', 'CAISSE')`,
    [data.journal_id, tenantId]
  );
  const journal = jr.rows[0];
  if (!journal || !journal.compte_tresorerie) throw new ComptaError("COMPTA_REGLEMENT_JOURNAL_INVALIDE", 400);

  const saisies = Array.isArray(data.imputations) ? data.imputations.filter((i) => i && i.facture_id) : [];
  const vus = new Set();
  const imputations = [];
  let totalImputeC = 0;
  for (const s of saisies) {
    if (vus.has(s.facture_id)) throw new ComptaError("COMPTA_REGLEMENT_IMPUTATION_INVALIDE", 400);
    vus.add(s.facture_id);
    const mC = versCentimes(s.montant);
    if (Number.isNaN(mC) || mC <= 0) throw new ComptaError("COMPTA_MONTANT_INVALIDE");
    const fr = await client.query(`SELECT * FROM facture_vente WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [s.facture_id, tenantId]);
    const f = fr.rows[0];
    if (!f || f.client_commercial_id !== tiers.client_commercial_id || f.statut !== "IMPAYEE") throw new ComptaError("COMPTA_REGLEMENT_IMPUTATION_INVALIDE", 400);
    const soldeC = versCentimes(f.montant_net_a_payer) - versCentimes(f.montant_encaisse);
    if (mC > soldeC) throw new ComptaError("COMPTA_REGLEMENT_DEPASSE_SOLDE", 409, { libelle: f.numero });
    imputations.push({ facture: f, montant_c: mC, solde_c: soldeC });
    totalImputeC += mC;
  }
  if (totalImputeC > montantC) throw new ComptaError("COMPTA_REGLEMENT_IMPUTATION_SUPERIEURE", 409);
  const avanceC = montantC - totalImputeC;

  const annee = Number(data.date_reglement.slice(0, 4));
  const numero = await prochainNumero(client, tenantId, annee);
  const reference = data.reference ? String(data.reference).trim() : null;
  const rg = await client.query(
    `INSERT INTO reglement_client
       (id, tenant_id, numero, tiers_id, journal_id, date_reglement, montant, mode_paiement, reference, libelle, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      uuidv4(), tenantId, numero, tiers.id, journal.id, data.date_reglement, centimesVersDecimal(montantC),
      data.mode_paiement ? String(data.mode_paiement).trim() : null, reference,
      data.libelle ? String(data.libelle).trim() : null, utilisateurId,
    ]
  );
  const reglement = rg.rows[0];
  for (const i of imputations) {
    await client.query(
      `INSERT INTO reglement_client_imputation (id, tenant_id, reglement_id, facture_id, montant) VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), tenantId, reglement.id, i.facture.id, centimesVersDecimal(i.montant_c)]
    );
    const solde = i.solde_c - i.montant_c === 0;
    await client.query(
      `UPDATE facture_vente
       SET montant_encaisse = montant_encaisse + $2,
           statut = CASE WHEN $3 THEN 'PAYEE' ELSE statut END,
           date_paiement = CASE WHEN $3 THEN $4::date ELSE date_paiement END,
           mode_paiement = CASE WHEN $3 THEN $5 ELSE mode_paiement END
       WHERE id = $1`,
      [i.facture.id, centimesVersDecimal(i.montant_c), solde, data.date_reglement, data.mode_paiement ? String(data.mode_paiement).trim() : null]
    );
  }

  const libelleEcriture = `Encaissement ${tiers.nom}${reference ? ` - ${reference}` : ""}`;
  const ecriture = await client.query(
    `INSERT INTO ecriture_comptable
       (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'EN_INSTANCE', $8, $9, 'REGLEMENT', $10) RETURNING *`,
    [uuidv4(), tenantId, exercice.id, journal.id, reference || numero, data.date_reglement, libelleEcriture, ORIGINE, reglement.id, utilisateurId]
  );
  const lignes = [
    {
      compte_id: await idCompte(client, tenantId, journal.compte_tresorerie),
      tiers_id: null,
      libelle: libelleEcriture,
      debit_c: montantC,
      credit_c: 0,
      date_echeance: null,
      compte_modifiable: "TRESORERIE",
    },
  ];
  if (totalImputeC > 0) {
    lignes.push({ compte_id: await idCompte(client, tenantId, tiers.compte_collectif), tiers_id: tiers.id, libelle: `Reglement ${tiers.nom}`, debit_c: 0, credit_c: totalImputeC, date_echeance: null });
  }
  if (avanceC > 0) {
    lignes.push({ compte_id: await idCompte(client, tenantId, parametre.compte_acompte_client), tiers_id: tiers.id, libelle: `Avance ${tiers.nom}`, debit_c: 0, credit_c: avanceC, date_echeance: null });
  }
  await compta.insererLignes(client, tenantId, ecriture.rows[0].id, lignes);
  await compta.audit(client, tenantId, utilisateurId, "CREATION_REGLEMENT_CLIENT", "reglement_client", reglement.id, null, {
    numero, montant: centimesVersDecimal(montantC), avance: centimesVersDecimal(avanceC),
  });
  return { ...reglement, ecriture_id: ecriture.rows[0].id, avance: centimesVersDecimal(avanceC) };
}

const SELECT_REGLEMENT = `
  SELECT rg.*, t.code AS tiers_code, t.nom AS tiers_nom, j.code AS journal_code, j.libelle AS journal_libelle,
         e.id AS ecriture_id, e.statut AS ecriture_statut, e.numero_ecriture AS ecriture_numero,
         COALESCE((SELECT SUM(i.montant) FROM reglement_client_imputation i WHERE i.reglement_id = rg.id), 0) AS montant_impute
  FROM reglement_client rg
  JOIN tiers_comptable t ON t.id = rg.tiers_id
  JOIN journal_comptable j ON j.id = rg.journal_id
  LEFT JOIN ecriture_comptable e ON e.tenant_id = rg.tenant_id AND e.origine = '${ORIGINE}' AND e.origine_id = rg.id AND e.origine_role = 'REGLEMENT'`;

async function listerReglementsClient(client, tenantId, { q, tiers_id, limit = 100, offset = 0 } = {}) {
  const params = [tenantId];
  let filtre = "";
  if (q) {
    params.push(`%${String(q).toLowerCase()}%`);
    filtre += ` AND (lower(rg.numero) LIKE $${params.length} OR lower(t.nom) LIKE $${params.length} OR lower(COALESCE(rg.reference, '')) LIKE $${params.length})`;
  }
  if (tiers_id) {
    params.push(String(tiers_id));
    filtre += ` AND rg.tiers_id::text = $${params.length}`;
  }
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 300);
  const off = Math.max(Number(offset) || 0, 0);
  const total = await client.query(
    `SELECT COUNT(*)::int AS n FROM reglement_client rg JOIN tiers_comptable t ON t.id = rg.tiers_id WHERE rg.tenant_id = $1 ${filtre}`,
    params
  );
  const r = await client.query(
    `${SELECT_REGLEMENT} WHERE rg.tenant_id = $1 ${filtre} ORDER BY rg.date_reglement DESC, rg.numero DESC LIMIT ${lim} OFFSET ${off}`,
    params
  );
  return { total: total.rows[0].n, reglements: r.rows };
}

async function lireReglementClient(client, tenantId, id) {
  const r = await client.query(`${SELECT_REGLEMENT} WHERE rg.tenant_id = $1 AND rg.id = $2`, [tenantId, id]);
  if (!r.rows[0]) throw new ComptaError("COMPTA_REGLEMENT_INTROUVABLE", 404);
  const imputations = await client.query(
    `SELECT i.montant, f.id AS facture_id, f.numero, f.montant_net_a_payer
     FROM reglement_client_imputation i JOIN facture_vente f ON f.id = i.facture_id
     WHERE i.reglement_id = $1 ORDER BY f.date_facture`,
    [id]
  );
  return { ...r.rows[0], imputations: imputations.rows };
}

async function annulerReglementClient(client, tenantId, utilisateurId, id) {
  const r = await client.query(`SELECT * FROM reglement_client WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  const rg = r.rows[0];
  if (!rg) throw new ComptaError("COMPTA_REGLEMENT_INTROUVABLE", 404);
  if (rg.statut === "ANNULE") throw new ComptaError("COMPTA_REGLEMENT_DEJA_ANNULE", 409);
  const imputations = await client.query(`SELECT * FROM reglement_client_imputation WHERE reglement_id = $1`, [id]);
  // Une facture marquee payee dans Ventes apres cet encaissement partiel a deja son propre encaissement : on ne touche pas a l'historique.
  for (const i of imputations.rows) {
    const enc = await client.query(
      `SELECT 1 FROM ecriture_comptable WHERE tenant_id = $1 AND origine = 'FACTURE_VENTE' AND origine_id = $2 AND origine_role = 'ENCAISSEMENT'`,
      [tenantId, i.facture_id]
    );
    if (enc.rows.length > 0) throw new ComptaError("COMPTA_REGLEMENT_CLIENT_FACTURE_ENCAISSEE", 409);
  }
  const ec = await client.query(
    `SELECT * FROM ecriture_comptable WHERE tenant_id = $1 AND origine = $2 AND origine_id = $3 AND origine_role = 'REGLEMENT' FOR UPDATE`,
    [tenantId, ORIGINE, id]
  );
  const e = ec.rows[0];
  const res = { supprimee: false, contrepassee: false };
  if (e) {
    if (e.statut !== "VALIDEE") {
      await client.query(`DELETE FROM ligne_ecriture WHERE ecriture_id = $1`, [e.id]);
      await client.query(`DELETE FROM ecriture_comptable WHERE id = $1`, [e.id]);
      res.supprimee = true;
    } else if (!e.extournee_par_id) {
      const date = new Date().toISOString().slice(0, 10);
      const exercice = await compta.exerciceDeLaDate(client, tenantId, date);
      if (!exercice || exercice.statut === "CLOTURE") throw new ComptaError("COMPTA_EXERCICE_CLOTURE", 409);
      const inverse = await client.query(
        `INSERT INTO ecriture_comptable
           (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, extourne_de_id, cree_par)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'EN_INSTANCE', $8, $9, 'ANNULATION', $10, $11) RETURNING *`,
        [uuidv4(), tenantId, exercice.id, e.journal_id, e.numero_piece, date, `Annulation reglement ${rg.numero}`, ORIGINE, id, e.id, utilisateurId]
      );
      const lignes = await client.query(`SELECT * FROM ligne_ecriture WHERE ecriture_id = $1 ORDER BY ordre`, [e.id]);
      await compta.insererLignes(
        client, tenantId, inverse.rows[0].id,
        lignes.rows.map((l) => ({
          compte_id: l.compte_id, tiers_id: l.tiers_id, libelle: l.libelle,
          debit_c: versCentimes(l.credit), credit_c: versCentimes(l.debit),
          date_echeance: l.date_echeance ? dateSql(l.date_echeance) : null,
        }))
      );
      await client.query(`UPDATE ecriture_comptable SET extournee_par_id = $2 WHERE id = $1`, [e.id, inverse.rows[0].id]);
      res.contrepassee = true;
    }
  }
  for (const i of imputations.rows) {
    await client.query(
      `UPDATE facture_vente
       SET montant_encaisse = GREATEST(montant_encaisse - $2, 0),
           statut = 'IMPAYEE', date_paiement = NULL, mode_paiement = NULL
       WHERE id = $1 AND statut <> 'ANNULEE'`,
      [i.facture_id, i.montant]
    );
  }
  await client.query(
    `UPDATE reglement_client SET statut = 'ANNULE', annule_par = $3, date_annulation = now() WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId, utilisateurId]
  );
  await compta.audit(client, tenantId, utilisateurId, "ANNULATION_REGLEMENT_CLIENT", "reglement_client", id, { statut: rg.statut }, { statut: "ANNULE", ...res });
  return { ...res, statut: "ANNULE" };
}

module.exports = {
  listerClientsAEncaisser,
  facturesOuvertesClient,
  creerReglementClient,
  listerReglementsClient,
  lireReglementClient,
  annulerReglementClient,
};
