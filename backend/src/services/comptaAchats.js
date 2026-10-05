/**
 * Comptabilite - phase 3A : achats, reglements fournisseurs, tresorerie.
 *
 *   FACTURE FOURNISSEUR  Dr 6x / 2x / 3x (une ligne par ligne de facture, HT)
 *                        Dr 4452 (TVA recuperable)
 *                        Cr 401 (fournisseur, TTC, avec echeance)
 *   REGLEMENT            Dr 401 (fournisseur, part imputee aux factures)
 *                        Dr 4091 (fournisseur, reliquat = avance versee)
 *                        Cr 52x / 57x (compte de tresorerie du journal choisi)
 *
 * Comme pour les ventes, les ecritures sont creees EN_INSTANCE : le
 * comptable saisit la piece, le Directeur Financier (ou tout detenteur du
 * droit "validation") valide depuis l'ecran "En instance". Les montants sont
 * calcules en centimes entiers (jamais en virgule flottante).
 *
 * L'annulation d'une facture ou d'un reglement supprime l'ecriture si elle
 * est encore en instance, sinon cree une ecriture inverse EN_INSTANCE.
 */
const { v4: uuidv4 } = require("uuid");
const compta = require("./comptaService");

const { versCentimes, centimesVersDecimal, ComptaError } = compta;

const ORIGINE_FACTURE = "FACTURE_ACHAT";
const ORIGINE_REGLEMENT = "REGLEMENT_FOURNISSEUR";
const CLASSES_CHARGE_OU_ACTIF = [2, 3, 6];

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const dateSql = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const dateValide = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());

async function prochainNumero(client, tenantId, typeCompteur, prefixe, annee) {
  await client.query(
    `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero)
     VALUES ($1, $2, $3, 0) ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
    [tenantId, typeCompteur, annee]
  );
  const r = await client.query(
    `UPDATE compteur_numerotation SET dernier_numero = dernier_numero + 1
     WHERE tenant_id = $1 AND type_compteur = $2 AND annee = $3 RETURNING dernier_numero`,
    [tenantId, typeCompteur, annee]
  );
  return `${prefixe}-${annee}-${String(r.rows[0].dernier_numero).padStart(4, "0")}`;
}

async function compteParNumero(client, tenantId, numero) {
  const r = await client.query(`SELECT * FROM compte_comptable WHERE tenant_id = $1 AND numero = $2`, [tenantId, String(numero)]);
  if (!r.rows[0]) throw new ComptaError("COMPTA_COMPTE_INTROUVABLE", 400, { numero });
  return r.rows[0];
}

async function premierJournal(client, tenantId, type) {
  const r = await client.query(
    `SELECT * FROM journal_comptable WHERE tenant_id = $1 AND type_journal = $2 AND actif = true ORDER BY code LIMIT 1`,
    [tenantId, type]
  );
  return r.rows[0] || null;
}

async function exercicePourSaisie(client, tenantId, date) {
  const exercice = await compta.exerciceDeLaDate(client, tenantId, date);
  if (!exercice) throw new ComptaError("COMPTA_EXERCICE_INTROUVABLE", 400);
  if (exercice.statut === "CLOTURE") throw new ComptaError("COMPTA_EXERCICE_CLOTURE", 409);
  return exercice;
}

async function tiersFournisseur(client, tenantId, tiersId) {
  const r = await client.query(`SELECT * FROM tiers_comptable WHERE id = $1 AND tenant_id = $2`, [tiersId, tenantId]);
  const t = r.rows[0];
  if (!t || t.type_tiers !== "FOURNISSEUR" || !t.actif) throw new ComptaError("COMPTA_FOURNISSEUR_INTROUVABLE", 404);
  return t;
}

async function idCompte(client, tenantId, numero) {
  return (await compteParNumero(client, tenantId, numero)).id;
}

/** Cree l'ecriture inverse (EN_INSTANCE) d'une ecriture deja validee et marque l'originale extournee. */
async function contrePasser(client, tenantId, utilisateurId, ecriture, origine, origineId, role, libelle) {
  const date = aujourdhui();
  const exercice = await exercicePourSaisie(client, tenantId, date);
  const inverse = await client.query(
    `INSERT INTO ecriture_comptable
       (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, extourne_de_id, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'EN_INSTANCE', $8, $9, $10, $11, $12) RETURNING *`,
    [uuidv4(), tenantId, exercice.id, ecriture.journal_id, ecriture.numero_piece, date, libelle, origine, origineId, role, ecriture.id, utilisateurId || null]
  );
  const lignes = await client.query(`SELECT * FROM ligne_ecriture WHERE ecriture_id = $1 ORDER BY ordre`, [ecriture.id]);
  await compta.insererLignes(
    client,
    tenantId,
    inverse.rows[0].id,
    lignes.rows.map((l) => ({
      compte_id: l.compte_id,
      tiers_id: l.tiers_id,
      libelle: l.libelle,
      debit_c: versCentimes(l.credit),
      credit_c: versCentimes(l.debit),
      date_echeance: l.date_echeance ? dateSql(l.date_echeance) : null,
    }))
  );
  await client.query(`UPDATE ecriture_comptable SET extournee_par_id = $2 WHERE id = $1`, [ecriture.id, inverse.rows[0].id]);
  return inverse.rows[0];
}

/** Supprime une ecriture non validee, ou la contre-passe si elle l'est. */
async function annulerEcritureLiee(client, tenantId, utilisateurId, origine, origineId, roleOrigine, roleAnnulation, libelle) {
  const r = await client.query(
    `SELECT * FROM ecriture_comptable WHERE tenant_id = $1 AND origine = $2 AND origine_id = $3 AND origine_role = $4 FOR UPDATE`,
    [tenantId, origine, origineId, roleOrigine]
  );
  const e = r.rows[0];
  if (!e) return { supprimee: false, contrepassee: false };
  if (e.statut !== "VALIDEE") {
    await client.query(`DELETE FROM ligne_ecriture WHERE ecriture_id = $1`, [e.id]);
    await client.query(`DELETE FROM ecriture_comptable WHERE id = $1`, [e.id]);
    return { supprimee: true, contrepassee: false };
  }
  if (e.extournee_par_id) return { supprimee: false, contrepassee: false };
  await contrePasser(client, tenantId, utilisateurId, e, origine, origineId, roleAnnulation, libelle);
  return { supprimee: false, contrepassee: true };
}

// ----------------------------------------------------------------------------
// Fournisseurs (liste des tiers + creation rapide)
// ----------------------------------------------------------------------------

async function listerFournisseurs(client, tenantId) {
  const r = await client.query(
    `SELECT t.id, t.code, t.nom, t.compte_collectif, t.delai_reglement_jours,
            COALESCE(SUM(f.montant_ttc - f.montant_regle) FILTER (WHERE f.statut = 'ENREGISTREE'), 0) AS solde,
            COALESCE(SUM(f.montant_ttc - f.montant_regle) FILTER (WHERE f.statut = 'ENREGISTREE' AND f.date_echeance < CURRENT_DATE), 0) AS echu
     FROM tiers_comptable t
     LEFT JOIN facture_fournisseur f ON f.tiers_id = t.id
     WHERE t.tenant_id = $1 AND t.type_tiers = 'FOURNISSEUR' AND t.actif = true
     GROUP BY t.id ORDER BY t.nom`,
    [tenantId]
  );
  return r.rows;
}

/** Cree un fournisseur (fiche + tiers comptable) depuis le module comptable. */
async function creerFournisseur(client, tenantId, utilisateurId, { nom, pays, delai_reglement_jours }) {
  await compta.exigerInitialise(client, tenantId);
  const nomNet = String(nom || "").trim();
  if (!nomNet) throw new ComptaError("COMPTA_FOURNISSEUR_NOM_REQUIS");
  const doublon = await client.query(`SELECT 1 FROM fournisseur WHERE tenant_id = $1 AND lower(nom) = lower($2)`, [tenantId, nomNet]);
  if (doublon.rows.length > 0) throw new ComptaError("COMPTA_FOURNISSEUR_EXISTE", 409);
  const f = await client.query(
    `INSERT INTO fournisseur (id, tenant_id, nom, pays) VALUES ($1, $2, $3, $4) RETURNING *`,
    [uuidv4(), tenantId, nomNet, pays ? String(pays).trim() : null]
  );
  const tiers = await compta.assurerTiersFournisseur(client, tenantId, f.rows[0]);
  const delai = Number.isInteger(Number(delai_reglement_jours)) && Number(delai_reglement_jours) >= 0 ? Number(delai_reglement_jours) : 30;
  await client.query(`UPDATE tiers_comptable SET delai_reglement_jours = $2 WHERE id = $1`, [tiers.id, delai]);
  await compta.audit(client, tenantId, utilisateurId, "CREATION_FOURNISSEUR", "tiers_comptable", tiers.id, null, { nom: nomNet });
  return { ...tiers, delai_reglement_jours: delai, solde: "0", echu: "0" };
}

// ----------------------------------------------------------------------------
// Factures fournisseurs
// ----------------------------------------------------------------------------

/**
 * Controle et chiffre les lignes saisies. Retourne { lignes, ht_c, tva_c, ttc_c }
 * (montants en centimes).
 */
async function chiffrerLignesFacture(client, tenantId, lignesSaisies, parametre) {
  if (!Array.isArray(lignesSaisies) || lignesSaisies.length === 0) throw new ComptaError("COMPTA_FACTURE_FOURNISSEUR_LIGNES_REQUISES");
  if (lignesSaisies.length > 100) throw new ComptaError("COMPTA_FACTURE_FOURNISSEUR_LIGNES_REQUISES");
  const lignes = [];
  let ht = 0;
  let tva = 0;
  for (let i = 0; i < lignesSaisies.length; i++) {
    const l = lignesSaisies[i] || {};
    const libelle = String(l.libelle || "").trim();
    if (!libelle) throw new ComptaError("COMPTA_FACTURE_FOURNISSEUR_LIGNE_LIBELLE", 400, { ligne: i + 1 });
    const montantC = versCentimes(l.montant_ht);
    if (Number.isNaN(montantC) || montantC <= 0) throw new ComptaError("COMPTA_MONTANT_INVALIDE", 400, { ligne: i + 1 });
    const taux = l.taux_tva === undefined || l.taux_tva === null || l.taux_tva === "" ? 18 : Number(l.taux_tva);
    if (!Number.isFinite(taux) || taux < 0 || taux > 100) throw new ComptaError("COMPTA_FACTURE_FOURNISSEUR_TAUX_INVALIDE", 400, { ligne: i + 1 });
    const numeroCompte = l.compte_numero || parametre.compte_achat_defaut;
    const compte = await compteParNumero(client, tenantId, numeroCompte);
    if (!compte.actif || !CLASSES_CHARGE_OU_ACTIF.includes(compte.classe)) {
      throw new ComptaError("COMPTA_FACTURE_FOURNISSEUR_COMPTE_INVALIDE", 400, { ligne: i + 1, numero: compte.numero });
    }
    const tvaC = Math.round((montantC * Math.round(taux * 100)) / 10000);
    lignes.push({ libelle, compte, montant_c: montantC, taux, tva_c: tvaC });
    ht += montantC;
    tva += tvaC;
  }
  return { lignes, ht_c: ht, tva_c: tva, ttc_c: ht + tva };
}

async function creerFactureFournisseur(client, tenantId, utilisateurId, data) {
  const parametre = await compta.exigerInitialise(client, tenantId);
  const tiers = await tiersFournisseur(client, tenantId, data.tiers_id);
  const reference = String(data.reference_fournisseur || "").trim();
  if (!reference) throw new ComptaError("COMPTA_FACTURE_FOURNISSEUR_REFERENCE_REQUISE");
  if (!dateValide(data.date_facture)) throw new ComptaError("COMPTA_DATE_INVALIDE");
  let echeance = data.date_echeance;
  if (echeance) {
    if (!dateValide(echeance)) throw new ComptaError("COMPTA_DATE_INVALIDE");
    if (echeance < data.date_facture) throw new ComptaError("COMPTA_FACTURE_FOURNISSEUR_ECHEANCE_AVANT");
  } else {
    const d = new Date(`${data.date_facture}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + (tiers.delai_reglement_jours ?? 30));
    echeance = d.toISOString().slice(0, 10);
  }
  const exercice = await exercicePourSaisie(client, tenantId, data.date_facture);
  const journal = await premierJournal(client, tenantId, "ACHATS");
  if (!journal) throw new ComptaError("COMPTA_JOURNAL_ACHATS_ABSENT", 409);

  const doublon = await client.query(
    `SELECT 1 FROM facture_fournisseur WHERE tenant_id = $1 AND tiers_id = $2 AND lower(reference_fournisseur) = lower($3) AND statut = 'ENREGISTREE'`,
    [tenantId, tiers.id, reference]
  );
  if (doublon.rows.length > 0) throw new ComptaError("COMPTA_FACTURE_FOURNISSEUR_DOUBLON", 409);

  const { lignes, ht_c, tva_c, ttc_c } = await chiffrerLignesFacture(client, tenantId, data.lignes, parametre);
  const annee = Number(data.date_facture.slice(0, 4));
  const numero = await prochainNumero(client, tenantId, "FACT_FOURN", "AF", annee);
  const libelle = data.libelle ? String(data.libelle).trim() : null;

  const f = await client.query(
    `INSERT INTO facture_fournisseur
       (id, tenant_id, numero, tiers_id, reference_fournisseur, date_facture, date_echeance, libelle, montant_ht, montant_tva, montant_ttc, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [uuidv4(), tenantId, numero, tiers.id, reference, data.date_facture, echeance, libelle, centimesVersDecimal(ht_c), centimesVersDecimal(tva_c), centimesVersDecimal(ttc_c), utilisateurId]
  );
  const facture = f.rows[0];
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    await client.query(
      `INSERT INTO facture_fournisseur_ligne (id, tenant_id, facture_id, ordre, libelle, compte_id, montant_ht, taux_tva, montant_tva)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [uuidv4(), tenantId, facture.id, i + 1, l.libelle, l.compte.id, centimesVersDecimal(l.montant_c), l.taux, centimesVersDecimal(l.tva_c)]
    );
  }

  const ecriture = await client.query(
    `INSERT INTO ecriture_comptable
       (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'EN_INSTANCE', $8, $9, 'FACTURE', $10) RETURNING *`,
    [uuidv4(), tenantId, exercice.id, journal.id, reference, data.date_facture, `Facture ${reference} - ${tiers.nom}`, ORIGINE_FACTURE, facture.id, utilisateurId]
  );
  const lignesEcriture = lignes.map((l) => ({
    compte_id: l.compte.id,
    tiers_id: null,
    libelle: l.libelle,
    debit_c: l.montant_c,
    credit_c: 0,
    date_echeance: null,
  }));
  if (tva_c > 0) {
    lignesEcriture.push({
      compte_id: await idCompte(client, tenantId, parametre.compte_tva_recuperable),
      tiers_id: null,
      libelle: `TVA facture ${reference}`,
      debit_c: tva_c,
      credit_c: 0,
      date_echeance: null,
    });
  }
  lignesEcriture.push({
    compte_id: await idCompte(client, tenantId, tiers.compte_collectif),
    tiers_id: tiers.id,
    libelle: `Facture ${reference} - ${tiers.nom}`,
    debit_c: 0,
    credit_c: ttc_c,
    date_echeance: echeance,
  });
  await compta.insererLignes(client, tenantId, ecriture.rows[0].id, lignesEcriture);
  await compta.audit(client, tenantId, utilisateurId, "CREATION_FACTURE_FOURNISSEUR", "facture_fournisseur", facture.id, null, {
    numero,
    reference,
    montant_ttc: centimesVersDecimal(ttc_c),
  });
  return { ...facture, ecriture_id: ecriture.rows[0].id };
}

const SELECT_FACTURE = `
  SELECT f.*, (f.montant_ttc - f.montant_regle) AS solde, t.code AS tiers_code, t.nom AS tiers_nom,
         (f.statut = 'ENREGISTREE' AND f.montant_ttc > f.montant_regle AND f.date_echeance < CURRENT_DATE) AS en_retard,
         e.id AS ecriture_id, e.statut AS ecriture_statut, e.numero_ecriture AS ecriture_numero
  FROM facture_fournisseur f
  JOIN tiers_comptable t ON t.id = f.tiers_id
  LEFT JOIN ecriture_comptable e ON e.tenant_id = f.tenant_id AND e.origine = '${ORIGINE_FACTURE}' AND e.origine_id = f.id AND e.origine_role = 'FACTURE'`;

async function listerFacturesFournisseur(client, tenantId, { q, tiers_id, etat, limit = 100, offset = 0 } = {}) {
  const params = [tenantId];
  let filtre = "";
  if (q) {
    params.push(`%${String(q).toLowerCase()}%`);
    filtre += ` AND (lower(f.reference_fournisseur) LIKE $${params.length} OR lower(f.numero) LIKE $${params.length} OR lower(t.nom) LIKE $${params.length} OR lower(COALESCE(f.libelle, '')) LIKE $${params.length})`;
  }
  if (tiers_id) {
    params.push(String(tiers_id));
    filtre += ` AND f.tiers_id::text = $${params.length}`;
  }
  if (etat === "IMPAYEES") filtre += ` AND f.statut = 'ENREGISTREE' AND f.montant_ttc > f.montant_regle`;
  else if (etat === "SOLDEES") filtre += ` AND f.statut = 'ENREGISTREE' AND f.montant_ttc <= f.montant_regle`;
  else if (etat === "ANNULEES") filtre += ` AND f.statut = 'ANNULEE'`;
  else if (etat === "EN_RETARD") filtre += ` AND f.statut = 'ENREGISTREE' AND f.montant_ttc > f.montant_regle AND f.date_echeance < CURRENT_DATE`;
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 300);
  const off = Math.max(Number(offset) || 0, 0);
  const base = `FROM facture_fournisseur f JOIN tiers_comptable t ON t.id = f.tiers_id WHERE f.tenant_id = $1 ${filtre}`;
  const total = await client.query(`SELECT COUNT(*)::int AS n ${base}`, params);
  const r = await client.query(
    `${SELECT_FACTURE} WHERE f.tenant_id = $1 ${filtre} ORDER BY f.date_facture DESC, f.numero DESC LIMIT ${lim} OFFSET ${off}`,
    params
  );
  return { total: total.rows[0].n, factures: r.rows };
}

async function lireFactureFournisseur(client, tenantId, id) {
  const r = await client.query(`${SELECT_FACTURE} WHERE f.tenant_id = $1 AND f.id = $2`, [tenantId, id]);
  if (!r.rows[0]) throw new ComptaError("COMPTA_FACTURE_FOURNISSEUR_INTROUVABLE", 404);
  const lignes = await client.query(
    `SELECT l.*, c.numero AS compte_numero, c.libelle AS compte_libelle
     FROM facture_fournisseur_ligne l JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.facture_id = $1 ORDER BY l.ordre`,
    [id]
  );
  const reglements = await client.query(
    `SELECT i.montant, rg.id AS reglement_id, rg.numero, rg.date_reglement, rg.mode_paiement, rg.reference, rg.statut
     FROM reglement_fournisseur_imputation i JOIN reglement_fournisseur rg ON rg.id = i.reglement_id
     WHERE i.facture_id = $1 ORDER BY rg.date_reglement, rg.numero`,
    [id]
  );
  return { ...r.rows[0], lignes: lignes.rows, reglements: reglements.rows };
}

async function annulerFactureFournisseur(client, tenantId, utilisateurId, id) {
  const r = await client.query(`SELECT * FROM facture_fournisseur WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  const f = r.rows[0];
  if (!f) throw new ComptaError("COMPTA_FACTURE_FOURNISSEUR_INTROUVABLE", 404);
  if (f.statut === "ANNULEE") throw new ComptaError("COMPTA_FACTURE_FOURNISSEUR_DEJA_ANNULEE", 409);
  const imputations = await client.query(
    `SELECT 1 FROM reglement_fournisseur_imputation i
     JOIN reglement_fournisseur rg ON rg.id = i.reglement_id
     WHERE i.facture_id = $1 AND rg.statut = 'ENREGISTRE' LIMIT 1`,
    [id]
  );
  if (imputations.rows.length > 0) throw new ComptaError("COMPTA_FACTURE_FOURNISSEUR_REGLEE", 409);
  const res = await annulerEcritureLiee(client, tenantId, utilisateurId, ORIGINE_FACTURE, id, "FACTURE", "ANNULATION", `Annulation facture ${f.reference_fournisseur}`);
  await client.query(
    `UPDATE facture_fournisseur SET statut = 'ANNULEE', annule_par = $3, date_annulation = now() WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId, utilisateurId]
  );
  await compta.audit(client, tenantId, utilisateurId, "ANNULATION_FACTURE_FOURNISSEUR", "facture_fournisseur", id, { statut: f.statut }, { statut: "ANNULEE", ...res });
  return { ...res, statut: "ANNULEE" };
}

// ----------------------------------------------------------------------------
// Reglements fournisseurs
// ----------------------------------------------------------------------------

async function creerReglementFournisseur(client, tenantId, utilisateurId, data) {
  const parametre = await compta.exigerInitialise(client, tenantId);
  const tiers = await tiersFournisseur(client, tenantId, data.tiers_id);
  if (!dateValide(data.date_reglement)) throw new ComptaError("COMPTA_DATE_INVALIDE");
  const montantC = versCentimes(data.montant);
  if (Number.isNaN(montantC) || montantC <= 0) throw new ComptaError("COMPTA_MONTANT_INVALIDE");
  const exercice = await exercicePourSaisie(client, tenantId, data.date_reglement);

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
    const fr = await client.query(`SELECT * FROM facture_fournisseur WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [s.facture_id, tenantId]);
    const f = fr.rows[0];
    if (!f || f.tiers_id !== tiers.id || f.statut !== "ENREGISTREE") throw new ComptaError("COMPTA_REGLEMENT_IMPUTATION_INVALIDE", 400);
    const soldeC = versCentimes(f.montant_ttc) - versCentimes(f.montant_regle);
    if (mC > soldeC) throw new ComptaError("COMPTA_REGLEMENT_DEPASSE_SOLDE", 409, { libelle: f.reference_fournisseur });
    imputations.push({ facture: f, montant_c: mC });
    totalImputeC += mC;
  }
  if (totalImputeC > montantC) throw new ComptaError("COMPTA_REGLEMENT_IMPUTATION_SUPERIEURE", 409);
  const avanceC = montantC - totalImputeC;

  const annee = Number(data.date_reglement.slice(0, 4));
  const numero = await prochainNumero(client, tenantId, "REGL_FOURN", "RF", annee);
  const rg = await client.query(
    `INSERT INTO reglement_fournisseur
       (id, tenant_id, numero, tiers_id, journal_id, date_reglement, montant, mode_paiement, reference, libelle, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      uuidv4(), tenantId, numero, tiers.id, journal.id, data.date_reglement, centimesVersDecimal(montantC),
      data.mode_paiement ? String(data.mode_paiement).trim() : null,
      data.reference ? String(data.reference).trim() : null,
      data.libelle ? String(data.libelle).trim() : null,
      utilisateurId,
    ]
  );
  const reglement = rg.rows[0];
  for (const i of imputations) {
    await client.query(
      `INSERT INTO reglement_fournisseur_imputation (id, tenant_id, reglement_id, facture_id, montant) VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), tenantId, reglement.id, i.facture.id, centimesVersDecimal(i.montant_c)]
    );
    await client.query(
      `UPDATE facture_fournisseur SET montant_regle = montant_regle + $2 WHERE id = $1`,
      [i.facture.id, centimesVersDecimal(i.montant_c)]
    );
  }

  const libelleEcriture = `Reglement ${tiers.nom}${data.reference ? ` - ${String(data.reference).trim()}` : ""}`;
  const ecriture = await client.query(
    `INSERT INTO ecriture_comptable
       (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'EN_INSTANCE', $8, $9, 'REGLEMENT', $10) RETURNING *`,
    [uuidv4(), tenantId, exercice.id, journal.id, data.reference ? String(data.reference).trim() : numero, data.date_reglement, libelleEcriture, ORIGINE_REGLEMENT, reglement.id, utilisateurId]
  );
  const lignes = [];
  const idCollectif = await idCompte(client, tenantId, tiers.compte_collectif);
  if (totalImputeC > 0) {
    lignes.push({ compte_id: idCollectif, tiers_id: tiers.id, libelle: `Reglement ${tiers.nom}`, debit_c: totalImputeC, credit_c: 0, date_echeance: null });
  }
  if (avanceC > 0) {
    lignes.push({
      compte_id: await idCompte(client, tenantId, parametre.compte_acompte_fournisseur),
      tiers_id: tiers.id,
      libelle: `Avance ${tiers.nom}`,
      debit_c: avanceC,
      credit_c: 0,
      date_echeance: null,
    });
  }
  lignes.push({
    compte_id: await idCompte(client, tenantId, journal.compte_tresorerie),
    tiers_id: null,
    libelle: libelleEcriture,
    debit_c: 0,
    credit_c: montantC,
    date_echeance: null,
    compte_modifiable: "TRESORERIE",
  });
  await compta.insererLignes(client, tenantId, ecriture.rows[0].id, lignes);
  await compta.audit(client, tenantId, utilisateurId, "CREATION_REGLEMENT_FOURNISSEUR", "reglement_fournisseur", reglement.id, null, {
    numero,
    montant: centimesVersDecimal(montantC),
    avance: centimesVersDecimal(avanceC),
  });
  return { ...reglement, ecriture_id: ecriture.rows[0].id, avance: centimesVersDecimal(avanceC) };
}

const SELECT_REGLEMENT = `
  SELECT rg.*, t.code AS tiers_code, t.nom AS tiers_nom, j.code AS journal_code, j.libelle AS journal_libelle,
         e.id AS ecriture_id, e.statut AS ecriture_statut, e.numero_ecriture AS ecriture_numero,
         COALESCE((SELECT SUM(i.montant) FROM reglement_fournisseur_imputation i WHERE i.reglement_id = rg.id), 0) AS montant_impute
  FROM reglement_fournisseur rg
  JOIN tiers_comptable t ON t.id = rg.tiers_id
  JOIN journal_comptable j ON j.id = rg.journal_id
  LEFT JOIN ecriture_comptable e ON e.tenant_id = rg.tenant_id AND e.origine = '${ORIGINE_REGLEMENT}' AND e.origine_id = rg.id AND e.origine_role = 'REGLEMENT'`;

async function listerReglementsFournisseur(client, tenantId, { q, tiers_id, limit = 100, offset = 0 } = {}) {
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
    `SELECT COUNT(*)::int AS n FROM reglement_fournisseur rg JOIN tiers_comptable t ON t.id = rg.tiers_id WHERE rg.tenant_id = $1 ${filtre}`,
    params
  );
  const r = await client.query(
    `${SELECT_REGLEMENT} WHERE rg.tenant_id = $1 ${filtre} ORDER BY rg.date_reglement DESC, rg.numero DESC LIMIT ${lim} OFFSET ${off}`,
    params
  );
  return { total: total.rows[0].n, reglements: r.rows };
}

async function lireReglementFournisseur(client, tenantId, id) {
  const r = await client.query(`${SELECT_REGLEMENT} WHERE rg.tenant_id = $1 AND rg.id = $2`, [tenantId, id]);
  if (!r.rows[0]) throw new ComptaError("COMPTA_REGLEMENT_INTROUVABLE", 404);
  const imputations = await client.query(
    `SELECT i.montant, f.id AS facture_id, f.numero, f.reference_fournisseur, f.montant_ttc
     FROM reglement_fournisseur_imputation i JOIN facture_fournisseur f ON f.id = i.facture_id
     WHERE i.reglement_id = $1 ORDER BY f.date_facture`,
    [id]
  );
  return { ...r.rows[0], imputations: imputations.rows };
}

async function annulerReglementFournisseur(client, tenantId, utilisateurId, id) {
  const r = await client.query(`SELECT * FROM reglement_fournisseur WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  const rg = r.rows[0];
  if (!rg) throw new ComptaError("COMPTA_REGLEMENT_INTROUVABLE", 404);
  if (rg.statut === "ANNULE") throw new ComptaError("COMPTA_REGLEMENT_DEJA_ANNULE", 409);
  const res = await annulerEcritureLiee(client, tenantId, utilisateurId, ORIGINE_REGLEMENT, id, "REGLEMENT", "ANNULATION", `Annulation reglement ${rg.numero}`);
  const imputations = await client.query(`SELECT * FROM reglement_fournisseur_imputation WHERE reglement_id = $1`, [id]);
  for (const i of imputations.rows) {
    await client.query(`UPDATE facture_fournisseur SET montant_regle = GREATEST(montant_regle - $2, 0) WHERE id = $1`, [i.facture_id, i.montant]);
  }
  await client.query(
    `UPDATE reglement_fournisseur SET statut = 'ANNULE', annule_par = $3, date_annulation = now() WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId, utilisateurId]
  );
  await compta.audit(client, tenantId, utilisateurId, "ANNULATION_REGLEMENT_FOURNISSEUR", "reglement_fournisseur", id, { statut: rg.statut }, { statut: "ANNULE", ...res });
  return { ...res, statut: "ANNULE" };
}

// ----------------------------------------------------------------------------
// Tresorerie : comptes bancaires / caisses et mouvements
// ----------------------------------------------------------------------------

/** Journaux de banque et de caisse avec leur solde (ecritures validees ; en instance en complement). */
async function listerComptesTresorerie(client, tenantId) {
  const r = await client.query(
    `SELECT j.id, j.code, j.libelle, j.type_journal, j.compte_tresorerie, j.actif,
            c.libelle AS compte_libelle,
            COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.statut = 'VALIDEE'), 0) AS solde_valide,
            COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.statut = 'EN_INSTANCE'), 0) AS solde_instance
     FROM journal_comptable j
     LEFT JOIN compte_comptable c ON c.tenant_id = j.tenant_id AND c.numero = j.compte_tresorerie
     LEFT JOIN ligne_ecriture l ON l.compte_id = c.id
     LEFT JOIN ecriture_comptable e ON e.id = l.ecriture_id AND e.statut IN ('VALIDEE', 'EN_INSTANCE')
     WHERE j.tenant_id = $1 AND j.type_journal IN ('BANQUE', 'CAISSE')
     GROUP BY j.id, c.libelle ORDER BY j.type_journal, j.code`,
    [tenantId]
  );
  return r.rows;
}

/** Cree un compte de banque ou de caisse : compte 52x/57x + journal associe. */
async function creerCompteTresorerie(client, tenantId, utilisateurId, { type, libelle }) {
  const parametre = await compta.exigerInitialise(client, tenantId);
  if (!["BANQUE", "CAISSE"].includes(type)) throw new ComptaError("COMPTA_JOURNAL_CHAMPS_INVALIDES");
  const nom = String(libelle || "").trim();
  if (!nom) throw new ComptaError("COMPTA_JOURNAL_CHAMPS_INVALIDES");
  const racine = compta.completerNumero(type === "BANQUE" ? "5211" : "5711", parametre.longueur_compte);
  const numero = await compta.prochainNumeroCompte(client, tenantId, racine);
  const compte = await compta.creerCompte(client, tenantId, utilisateurId, {
    numero,
    libelle: nom,
    nature: "TRESORERIE",
    sens_normal: "D",
    lettrable: false,
    tiers_obligatoire: false,
    analytique: false,
  });
  const prefixe = type === "BANQUE" ? "BQ" : "CAI";
  const existants = await client.query(`SELECT code FROM journal_comptable WHERE tenant_id = $1 AND code LIKE $2`, [tenantId, `${prefixe}%`]);
  let max = prefixe === "CAI" ? 1 : 0;
  for (const row of existants.rows) {
    const m = new RegExp(`^${prefixe}(\\d*)$`).exec(row.code);
    if (m) max = Math.max(max, Number(m[1] || 1));
  }
  const code = `${prefixe}${max + 1}`;
  const journal = await compta.creerJournal(client, tenantId, utilisateurId, {
    code,
    libelle: nom,
    type_journal: type,
    compte_tresorerie: compte.numero,
  });
  return { ...journal, compte_libelle: compte.libelle, solde_valide: "0", solde_instance: "0" };
}

/**
 * Mouvement de banque / caisse : une entree ou une sortie face a un compte de
 * contrepartie (frais bancaires, versement, virement interne...). Cree un
 * brouillon (ou, si `valider` et droit de validation, une ecriture validee).
 */
async function creerMouvementTresorerie(client, tenantId, utilisateurId, data, { peutValider = false } = {}) {
  await compta.exigerInitialise(client, tenantId);
  const jr = await client.query(
    `SELECT * FROM journal_comptable WHERE id = $1 AND tenant_id = $2 AND actif = true AND type_journal IN ('BANQUE', 'CAISSE')`,
    [data.journal_id, tenantId]
  );
  const journal = jr.rows[0];
  if (!journal || !journal.compte_tresorerie) throw new ComptaError("COMPTA_REGLEMENT_JOURNAL_INVALIDE", 400);
  if (!["ENTREE", "SORTIE"].includes(data.sens)) throw new ComptaError("COMPTA_MOUVEMENT_SENS_INVALIDE");
  const montantC = versCentimes(data.montant);
  if (Number.isNaN(montantC) || montantC <= 0) throw new ComptaError("COMPTA_MONTANT_INVALIDE");
  const contrepartie = await compteParNumero(client, tenantId, data.contrepartie_numero);
  if (!contrepartie.actif || contrepartie.numero === journal.compte_tresorerie) throw new ComptaError("COMPTA_MOUVEMENT_CONTREPARTIE_INVALIDE");
  let tiersId = null;
  if (data.tiers_id) {
    const t = await client.query(`SELECT id FROM tiers_comptable WHERE id = $1 AND tenant_id = $2`, [data.tiers_id, tenantId]);
    if (!t.rows[0]) throw new ComptaError("COMPTA_FOURNISSEUR_INTROUVABLE", 404);
    tiersId = t.rows[0].id;
  }
  if (contrepartie.tiers_obligatoire && !tiersId) throw new ComptaError("COMPTA_TIERS_REQUIS", 400, { numero: contrepartie.numero });
  const libelle = String(data.libelle || "").trim();
  const lignes = [
    {
      compte_numero: journal.compte_tresorerie,
      libelle,
      debit: data.sens === "ENTREE" ? centimesVersDecimal(montantC) : 0,
      credit: data.sens === "SORTIE" ? centimesVersDecimal(montantC) : 0,
    },
    {
      compte_numero: contrepartie.numero,
      tiers_id: tiersId,
      libelle,
      debit: data.sens === "SORTIE" ? centimesVersDecimal(montantC) : 0,
      credit: data.sens === "ENTREE" ? centimesVersDecimal(montantC) : 0,
    },
  ];
  const brouillon = await compta.creerBrouillon(client, tenantId, utilisateurId, {
    journal_id: journal.id,
    date_ecriture: data.date_ecriture,
    libelle,
    numero_piece: data.numero_piece,
    lignes,
  });
  if (data.valider && peutValider) return compta.validerEcriture(client, tenantId, utilisateurId, brouillon.id);
  return brouillon;
}

module.exports = {
  listerFournisseurs,
  creerFournisseur,
  creerFactureFournisseur,
  listerFacturesFournisseur,
  lireFactureFournisseur,
  annulerFactureFournisseur,
  creerReglementFournisseur,
  listerReglementsFournisseur,
  lireReglementFournisseur,
  annulerReglementFournisseur,
  listerComptesTresorerie,
  creerCompteTresorerie,
  creerMouvementTresorerie,
};
