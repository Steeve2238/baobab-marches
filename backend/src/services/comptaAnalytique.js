/**
 * Comptabilite analytique par dossier (phase 3C).
 *
 *  - Sections : une par dossier AO et par consultation restreinte (creees
 *    automatiquement, codes AO001 / CR001), plus des "affaires libres" (AF001
 *    ou code choisi).
 *  - Ventilation : voir comptaVentilation.js. Montants signes comme
 *    (debit - credit) : charge > 0, produit < 0.
 *  - Etats : resultat par dossier (balance analytique), detail d'un dossier par
 *    compte, grand livre analytique. "Non affecte" = part des classes 6 et 7
 *    qui n'est ventilee sur aucun dossier ; sections + non affecte = totaux de
 *    la comptabilite generale (controle).
 */
const { v4: uuidv4 } = require("uuid");
const compta = require("./comptaService");
const ventilation = require("./comptaVentilation");
const { resoudrePeriode, statutsInclus, RapportError } = require("./comptaRapports");

const { versCentimes, centimesVersDecimal, ComptaError } = compta;
const aDecimal = (c) => c / 100;
const dateSql = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const PREFIXES = { AO: "AO", CONSULTATION: "CR", LIBRE: "AF" };

// ----------------------------------------------------------------------------
// Sections
// ----------------------------------------------------------------------------

async function prochainCode(client, tenantId, type) {
  const prefixe = PREFIXES[type];
  const compteur = `SECTION:${prefixe}`;
  await client.query(
    `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero)
     VALUES ($1, $2, 0, 0) ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
    [tenantId, compteur]
  );
  const r = await client.query(
    `UPDATE compteur_numerotation SET dernier_numero = dernier_numero + 1
     WHERE tenant_id = $1 AND type_compteur = $2 AND annee = 0 RETURNING dernier_numero`,
    [tenantId, compteur]
  );
  return `${prefixe}${String(r.rows[0].dernier_numero).padStart(3, "0")}`;
}

const tronquer = (t, n) => (String(t || "").length > n ? `${String(t).slice(0, n - 1)}…` : String(t || ""));

/** Cree les sections manquantes pour les dossiers AO et les consultations ; rafraichit leurs libelles. */
async function synchroniserSections(client, tenantId) {
  const ao = await client.query(
    `SELECT d.id, d.reference_externe, d.intitule FROM dossier_ao d
     WHERE d.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM section_analytique s WHERE s.tenant_id = d.tenant_id AND s.dossier_ao_id = d.id)
     ORDER BY d.date_creation, d.id`,
    [tenantId]
  );
  for (const d of ao.rows) {
    const code = await prochainCode(client, tenantId, "AO");
    await client.query(
      `INSERT INTO section_analytique (id, tenant_id, code, libelle, type_section, dossier_ao_id)
       VALUES ($1, $2, $3, $4, 'AO', $5) ON CONFLICT DO NOTHING`,
      [uuidv4(), tenantId, code, tronquer(`${d.reference_externe ? `${d.reference_externe} - ` : ""}${d.intitule}`, 200), d.id]
    );
  }
  const cr = await client.query(
    `SELECT c.id, c.objet, cl.nom AS client_nom FROM consultation c
     JOIN client_commercial cl ON cl.id = c.client_commercial_id
     WHERE c.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM section_analytique s WHERE s.tenant_id = c.tenant_id AND s.consultation_id = c.id)
     ORDER BY c.date_creation, c.id`,
    [tenantId]
  );
  for (const c of cr.rows) {
    const code = await prochainCode(client, tenantId, "CONSULTATION");
    await client.query(
      `INSERT INTO section_analytique (id, tenant_id, code, libelle, type_section, consultation_id)
       VALUES ($1, $2, $3, $4, 'CONSULTATION', $5) ON CONFLICT DO NOTHING`,
      [uuidv4(), tenantId, code, tronquer(`${c.client_nom} - ${c.objet}`, 200), c.id]
    );
  }
  await client.query(
    `UPDATE section_analytique s
     SET libelle = left(COALESCE(d.reference_externe || ' - ', '') || d.intitule, 200)
     FROM dossier_ao d
     WHERE s.tenant_id = $1 AND s.dossier_ao_id = d.id AND s.libelle <> left(COALESCE(d.reference_externe || ' - ', '') || d.intitule, 200)`,
    [tenantId]
  );
  await client.query(
    `UPDATE section_analytique s
     SET libelle = left(cl.nom || ' - ' || c.objet, 200)
     FROM consultation c JOIN client_commercial cl ON cl.id = c.client_commercial_id
     WHERE s.tenant_id = $1 AND s.consultation_id = c.id AND s.libelle <> left(cl.nom || ' - ' || c.objet, 200)`,
    [tenantId]
  );
}

async function listerSections(client, tenantId, { actifs = false, synchroniser = true } = {}) {
  if (synchroniser) await synchroniserSections(client, tenantId);
  const r = await client.query(
    `SELECT s.*, (SELECT COUNT(*)::int FROM ventilation_analytique v WHERE v.section_id = s.id) AS nb_lignes
     FROM section_analytique s
     WHERE s.tenant_id = $1 ${actifs ? "AND s.actif = true" : ""}
     ORDER BY s.type_section, s.code`,
    [tenantId]
  );
  return r.rows;
}

/** Section d'une consultation (creee au besoin). */
async function sectionPourConsultation(client, tenantId, consultationId) {
  let r = await client.query(`SELECT id FROM section_analytique WHERE tenant_id = $1 AND consultation_id = $2`, [tenantId, consultationId]);
  if (r.rows[0]) return r.rows[0].id;
  await synchroniserSections(client, tenantId);
  r = await client.query(`SELECT id FROM section_analytique WHERE tenant_id = $1 AND consultation_id = $2`, [tenantId, consultationId]);
  return r.rows[0]?.id || null;
}

/** Section d'un dossier d'appel d'offres (creee au besoin). */
async function sectionPourDossierAo(client, tenantId, dossierAoId) {
  let r = await client.query(`SELECT id FROM section_analytique WHERE tenant_id = $1 AND dossier_ao_id = $2`, [tenantId, dossierAoId]);
  if (r.rows[0]) return r.rows[0].id;
  await synchroniserSections(client, tenantId);
  r = await client.query(`SELECT id FROM section_analytique WHERE tenant_id = $1 AND dossier_ao_id = $2`, [tenantId, dossierAoId]);
  return r.rows[0]?.id || null;
}

async function creerSection(client, tenantId, utilisateurId, { code, libelle } = {}) {
  const lib = String(libelle || "").trim();
  if (!lib) throw new ComptaError("COMPTA_ANALYTIQUE_LIBELLE_REQUIS", 400);
  let c = String(code || "").trim().toUpperCase();
  if (c && !/^[A-Z0-9_-]{2,20}$/.test(c)) throw new ComptaError("COMPTA_ANALYTIQUE_CODE_INVALIDE", 400);
  if (!c) c = await prochainCode(client, tenantId, "LIBRE");
  const r = await client.query(
    `INSERT INTO section_analytique (id, tenant_id, code, libelle, type_section) VALUES ($1, $2, $3, $4, 'LIBRE') RETURNING *`,
    [uuidv4(), tenantId, c, tronquer(lib, 200)]
  );
  await compta.audit(client, tenantId, utilisateurId, "CREATION_SECTION_ANALYTIQUE", "section_analytique", r.rows[0].id, null, { code: c, libelle: lib });
  return { ...r.rows[0], nb_lignes: 0 };
}

/** Libelle modifiable pour les affaires libres uniquement ; activation / desactivation pour toutes. */
async function modifierSection(client, tenantId, utilisateurId, id, { libelle, actif } = {}) {
  const r = await client.query(`SELECT * FROM section_analytique WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  const s = r.rows[0];
  if (!s) throw new ComptaError("COMPTA_ANALYTIQUE_SECTION_INTROUVABLE", 404);
  let lib = s.libelle;
  if (libelle !== undefined) {
    if (s.type_section !== "LIBRE") throw new ComptaError("COMPTA_ANALYTIQUE_SECTION_AUTO", 409);
    lib = String(libelle || "").trim();
    if (!lib) throw new ComptaError("COMPTA_ANALYTIQUE_LIBELLE_REQUIS", 400);
  }
  const maj = await client.query(
    `UPDATE section_analytique SET libelle = $3, actif = $4 WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenantId, tronquer(lib, 200), typeof actif === "boolean" ? actif : s.actif]
  );
  await compta.audit(client, tenantId, utilisateurId, "MODIFICATION_SECTION_ANALYTIQUE", "section_analytique", id, { libelle: s.libelle, actif: s.actif }, { libelle: lib, actif: maj.rows[0].actif });
  return maj.rows[0];
}

// ----------------------------------------------------------------------------
// Ventilation apres coup
// ----------------------------------------------------------------------------

async function chargerLigne(client, tenantId, ligneId) {
  const r = await client.query(
    `SELECT l.*, c.analytique, c.classe, e.statut AS ecriture_statut, x.statut AS exercice_statut
     FROM ligne_ecriture l
     JOIN compte_comptable c ON c.id = l.compte_id
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN exercice_comptable x ON x.id = e.exercice_id
     WHERE l.id = $1 AND l.tenant_id = $2 FOR UPDATE OF l`,
    [ligneId, tenantId]
  );
  const l = r.rows[0];
  if (!l) throw new ComptaError("COMPTA_ANALYTIQUE_LIGNE_INTROUVABLE", 404);
  if (l.exercice_statut === "CLOTURE") throw new ComptaError("COMPTA_EXERCICE_CLOTURE", 409);
  return l;
}

/** Remplace la ventilation d'une ligne (meme sur une ecriture validee : les montants comptables ne changent pas). */
async function ventilerLigne(client, tenantId, utilisateurId, ligneId, items) {
  const l = await chargerLigne(client, tenantId, ligneId);
  if (!l.analytique) throw new ComptaError("COMPTA_ANALYTIQUE_COMPTE_NON_ANALYTIQUE", 400);
  const avant = await client.query(`SELECT section_id, montant FROM ventilation_analytique WHERE ligne_ecriture_id = $1`, [ligneId]);
  await client.query(`DELETE FROM ventilation_analytique WHERE ligne_ecriture_id = $1`, [ligneId]);
  await ventilation.ventilerLigne(client, tenantId, ligneId, l.compte_id, versCentimes(l.debit), versCentimes(l.credit), items || []);
  const apres = await client.query(`SELECT section_id, montant FROM ventilation_analytique WHERE ligne_ecriture_id = $1`, [ligneId]);
  await compta.audit(client, tenantId, utilisateurId, "VENTILATION_ANALYTIQUE", "ligne_ecriture", ligneId, avant.rows, apres.rows);
  return apres.rows;
}

/** Affecte 100 % de plusieurs lignes a un dossier. */
async function ventilerLot(client, tenantId, utilisateurId, { ligne_ids, section_id } = {}) {
  if (!Array.isArray(ligne_ids) || ligne_ids.length === 0 || ligne_ids.length > 500) throw new ComptaError("COMPTA_ANALYTIQUE_INVALIDE", 400);
  if (!section_id) throw new ComptaError("COMPTA_ANALYTIQUE_SECTION_INTROUVABLE", 400);
  let n = 0;
  for (const id of ligne_ids) {
    await ventilerLigne(client, tenantId, utilisateurId, id, [{ section_id }]);
    n++;
  }
  return { lignes: n };
}

/** Lignes de charges / produits dont la ventilation est absente ou partielle. */
async function lignesAVentiler(client, tenantId, { exercice_id, limit = 300 } = {}) {
  const params = [tenantId];
  let filtre = "";
  if (exercice_id) {
    params.push(String(exercice_id));
    filtre = ` AND e.exercice_id::text = $${params.length}`;
  }
  const lim = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  const r = await client.query(
    `SELECT * FROM (
       SELECT l.id, l.debit, l.credit, l.libelle AS ligne_libelle, e.id AS ecriture_id, e.date_ecriture, e.numero_piece, e.libelle AS ecriture_libelle, e.statut,
              j.code AS journal_code, c.numero AS compte_numero, c.libelle AS compte_libelle, c.classe,
              COALESCE((SELECT SUM(ABS(v.montant)) FROM ventilation_analytique v WHERE v.ligne_ecriture_id = l.id), 0) AS ventile
       FROM ligne_ecriture l
       JOIN ecriture_comptable e ON e.id = l.ecriture_id
       JOIN journal_comptable j ON j.id = e.journal_id
       JOIN compte_comptable c ON c.id = l.compte_id
       WHERE l.tenant_id = $1 AND c.analytique = true AND c.classe IN (6, 7) AND e.statut IN ('VALIDEE', 'EN_INSTANCE')
         AND j.type_journal <> 'A_NOUVEAUX' ${filtre}
     ) t WHERE (t.debit + t.credit) > t.ventile
     ORDER BY t.date_ecriture DESC, t.numero_piece NULLS LAST, t.id
     LIMIT ${lim}`,
    params
  );
  return r.rows.map((x) => ({ ...x, restant: aDecimal(versCentimes(x.debit) + versCentimes(x.credit) - versCentimes(x.ventile)) }));
}

/** Section a appliquer a une facture de vente : dossier choisi sur le devis, sinon section de sa consultation. */
async function sectionDeFacture(client, tenantId, factureId) {
  const r = await client.query(
    `SELECT d.section_analytique_id, d.consultation_id
     FROM facture_vente f JOIN devis d ON d.id = f.devis_id
     WHERE f.id = $1 AND f.tenant_id = $2`,
    [factureId, tenantId]
  );
  const d = r.rows[0];
  if (!d) return null;
  if (d.section_analytique_id) {
    const s = await client.query(`SELECT id FROM section_analytique WHERE id = $1 AND tenant_id = $2 AND actif = true`, [d.section_analytique_id, tenantId]);
    if (s.rows[0]) return s.rows[0].id;
  }
  if (d.consultation_id) return sectionPourConsultation(client, tenantId, d.consultation_id);
  return null;
}

/**
 * Applique l'heritage "dossier du devis" aux ecritures de vente deja generees
 * (avant la phase 3C, ou dont le devis a recu son dossier ensuite) : les
 * lignes de produit non encore ventilees sont affectees a 100 %. Les factures
 * annulees (ecriture extournee) sont ignorees.
 */
async function appliquerHeritageVentes(client, tenantId, utilisateurId, { devis_id = null } = {}) {
  // Sans devis cible : on ne complete que les lignes non ventilees. Avec un devis cible (dossier choisi ou retire
  // sur le devis) : on remplace aussi une ventilation a 100 % sur un seul dossier (heritage precedent) ; une
  // ventilation partielle ou repartie sur plusieurs dossiers est consideree comme manuelle et reste intacte.
  const r = await client.query(
    `SELECT l.id AS ligne_id, e.origine_id AS facture_id,
            (SELECT v.section_id FROM ventilation_analytique v WHERE v.ligne_ecriture_id = l.id LIMIT 1) AS section_actuelle
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.tenant_id = $1 AND e.origine = 'FACTURE_VENTE' AND e.origine_role = 'FACTURE' AND e.extournee_par_id IS NULL
       AND c.classe = 7 AND c.analytique = true
       AND ($2::text IS NULL OR e.origine_id::text IN (SELECT id::text FROM facture_vente WHERE devis_id::text = $2::text AND tenant_id = $1))
       AND (
         NOT EXISTS (SELECT 1 FROM ventilation_analytique v WHERE v.ligne_ecriture_id = l.id)
         OR ($2::text IS NOT NULL
             AND (SELECT COUNT(*) FROM ventilation_analytique v WHERE v.ligne_ecriture_id = l.id) = 1
             AND (SELECT SUM(ABS(v.montant)) FROM ventilation_analytique v WHERE v.ligne_ecriture_id = l.id) = ABS(l.debit - l.credit))
       )`,
    [tenantId, devis_id]
  );
  const cache = new Map();
  let lignes = 0;
  for (const x of r.rows) {
    if (!cache.has(x.facture_id)) cache.set(x.facture_id, await sectionDeFacture(client, tenantId, x.facture_id));
    const section = cache.get(x.facture_id);
    if (section === x.section_actuelle) continue;
    if (!section && !x.section_actuelle) continue;
    await ventilerLigne(client, tenantId, utilisateurId, x.ligne_id, section ? [{ section_id: section }] : []);
    lignes++;
  }
  return { lignes };
}

// ----------------------------------------------------------------------------
// Etats
// ----------------------------------------------------------------------------

const CORPS_ECRITURES = `
  FROM ventilation_analytique v
  JOIN section_analytique s ON s.id = v.section_id
  JOIN ligne_ecriture l ON l.id = v.ligne_ecriture_id
  JOIN ecriture_comptable e ON e.id = l.ecriture_id
  JOIN journal_comptable j ON j.id = e.journal_id
  JOIN compte_comptable c ON c.id = l.compte_id`;

const FILTRE_PERIODE = `v.tenant_id = $1 AND e.exercice_id = $2 AND e.date_ecriture BETWEEN $3::date AND $4::date
  AND e.statut = ANY($5::text[]) AND j.type_journal <> 'A_NOUVEAUX'`;

async function periode(client, tenantId, options) {
  const { exercice, debut, fin } = await resoudrePeriode(client, tenantId, options);
  return { exercice, debut, fin, statuts: statutsInclus(options.inclure_instance) };
}

const marge = (resultatC, produitsC) => (produitsC > 0 ? Math.round((resultatC / produitsC) * 10000) / 100 : null);

/** Resultat par dossier : charges (classe 6), produits (classe 7), resultat et marge par section. */
async function balanceAnalytique(client, tenantId, options = {}) {
  const p = await periode(client, tenantId, options);
  const args = [tenantId, p.exercice.id, p.debut, p.fin, p.statuts];
  const r = await client.query(
    `SELECT s.id, s.code, s.libelle, s.type_section, s.actif, c.classe, COALESCE(SUM(v.montant), 0) AS net
     ${CORPS_ECRITURES} WHERE ${FILTRE_PERIODE} AND c.classe IN (6, 7)
     GROUP BY s.id, c.classe`,
    args
  );
  const parSection = new Map();
  let ventile6 = 0;
  let ventile7 = 0;
  for (const x of r.rows) {
    let s = parSection.get(x.id);
    if (!s) {
      s = { section_id: x.id, code: x.code, libelle: x.libelle, type_section: x.type_section, actif: x.actif, charges_c: 0, produits_c: 0 };
      parSection.set(x.id, s);
    }
    const net = versCentimes(x.net);
    if (x.classe === 6) {
      s.charges_c += net;
      ventile6 += net;
    } else {
      s.produits_c += -net;
      ventile7 += net;
    }
  }
  const compteGeneral = await client.query(
    `SELECT c.classe, COALESCE(SUM(l.debit - l.credit), 0) AS net
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN journal_comptable j ON j.id = e.journal_id
     JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.tenant_id = $1 AND e.exercice_id = $2 AND e.date_ecriture BETWEEN $3::date AND $4::date
       AND e.statut = ANY($5::text[]) AND j.type_journal <> 'A_NOUVEAUX' AND c.classe IN (6, 7)
     GROUP BY c.classe`,
    args
  );
  let general6 = 0;
  let general7 = 0;
  for (const x of compteGeneral.rows) {
    if (x.classe === 6) general6 = versCentimes(x.net);
    else general7 = versCentimes(x.net);
  }
  const lignes = Array.from(parSection.values())
    .sort((a, b) => (a.code < b.code ? -1 : 1))
    .map((s) => {
      const res = s.produits_c - s.charges_c;
      return {
        section_id: s.section_id, code: s.code, libelle: s.libelle, type_section: s.type_section, actif: s.actif,
        charges: aDecimal(s.charges_c), produits: aDecimal(s.produits_c), resultat: aDecimal(res), marge_pct: marge(res, s.produits_c),
      };
    });
  const nonAffecteCharges = general6 - ventile6;
  const nonAffecteProduits = -general7 - -ventile7;
  const totalCharges = lignes.reduce((a, l) => a + versCentimes(l.charges), 0);
  const totalProduits = lignes.reduce((a, l) => a + versCentimes(l.produits), 0);
  return {
    exercice: { id: p.exercice.id, libelle: p.exercice.libelle, date_debut: p.exercice.date_debut, date_fin: p.exercice.date_fin },
    periode: { debut: p.debut, fin: p.fin },
    inclure_instance: !!options.inclure_instance,
    lignes,
    non_affecte: {
      charges: aDecimal(nonAffecteCharges),
      produits: aDecimal(nonAffecteProduits),
      resultat: aDecimal(nonAffecteProduits - nonAffecteCharges),
    },
    totaux: {
      charges: aDecimal(totalCharges + nonAffecteCharges),
      produits: aDecimal(totalProduits + nonAffecteProduits),
      resultat: aDecimal(totalProduits + nonAffecteProduits - totalCharges - nonAffecteCharges),
      charges_dossiers: aDecimal(totalCharges),
      produits_dossiers: aDecimal(totalProduits),
      resultat_dossiers: aDecimal(totalProduits - totalCharges),
    },
    // Controle : les totaux (dossiers + non affecte) doivent egaler les classes 6 et 7 de la comptabilite generale.
    controle: {
      charges_generales: aDecimal(general6),
      produits_generaux: aDecimal(-general7),
      ecart_charges: aDecimal(totalCharges + nonAffecteCharges - general6),
      ecart_produits: aDecimal(totalProduits + nonAffecteProduits + general7),
    },
  };
}

async function chargerSection(client, tenantId, sectionId) {
  if (!sectionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sectionId))) {
    throw new ComptaError("COMPTA_ANALYTIQUE_SECTION_INTROUVABLE", 404);
  }
  const r = await client.query(`SELECT * FROM section_analytique WHERE id = $1 AND tenant_id = $2`, [sectionId, tenantId]);
  if (!r.rows[0]) throw new ComptaError("COMPTA_ANALYTIQUE_SECTION_INTROUVABLE", 404);
  return r.rows[0];
}

/** Detail d'un dossier : charges et produits par compte, resultat et marge. */
async function resultatDossier(client, tenantId, options = {}) {
  const section = await chargerSection(client, tenantId, options.section_id);
  const p = await periode(client, tenantId, options);
  const r = await client.query(
    `SELECT c.id AS compte_id, c.numero, c.libelle, c.classe, COALESCE(SUM(v.montant), 0) AS net
     ${CORPS_ECRITURES} WHERE ${FILTRE_PERIODE} AND v.section_id = $6 AND c.classe IN (6, 7)
     GROUP BY c.id ORDER BY c.numero`,
    [tenantId, p.exercice.id, p.debut, p.fin, p.statuts, section.id]
  );
  const charges = [];
  const produits = [];
  let tc = 0;
  let tp = 0;
  for (const x of r.rows) {
    const net = versCentimes(x.net);
    if (x.classe === 6) {
      charges.push({ numero: x.numero, libelle: x.libelle, montant: aDecimal(net) });
      tc += net;
    } else {
      produits.push({ numero: x.numero, libelle: x.libelle, montant: aDecimal(-net) });
      tp += -net;
    }
  }
  return {
    section: { id: section.id, code: section.code, libelle: section.libelle, type_section: section.type_section },
    exercice: { id: p.exercice.id, libelle: p.exercice.libelle },
    periode: { debut: p.debut, fin: p.fin },
    inclure_instance: !!options.inclure_instance,
    produits, charges,
    total_produits: aDecimal(tp), total_charges: aDecimal(tc), resultat: aDecimal(tp - tc), marge_pct: marge(tp - tc, tp),
  };
}

/** Grand livre analytique : lignes ventilees sur un dossier, avec solde progressif (debit - credit). */
async function grandLivreAnalytique(client, tenantId, options = {}) {
  const section = await chargerSection(client, tenantId, options.section_id);
  const p = await periode(client, tenantId, options);
  const r = await client.query(
    `SELECT l.id AS ligne_id, e.id AS ecriture_id, e.date_ecriture, e.numero_piece, e.libelle AS ecriture_libelle, e.statut,
            j.code AS journal_code, c.numero AS compte_numero, c.libelle AS compte_libelle, l.libelle AS ligne_libelle, v.montant
     ${CORPS_ECRITURES} WHERE ${FILTRE_PERIODE} AND v.section_id = $6
     ORDER BY c.numero, e.date_ecriture, j.code, e.numero_ecriture NULLS LAST, l.ordre`,
    [tenantId, p.exercice.id, p.debut, p.fin, p.statuts, section.id]
  );
  let d = 0;
  let c = 0;
  const lignes = r.rows.map((x) => {
    const m = versCentimes(x.montant);
    if (m > 0) d += m;
    else c += -m;
    return {
      ligne_id: x.ligne_id, ecriture_id: x.ecriture_id, date: dateSql(x.date_ecriture), journal: x.journal_code, piece: x.numero_piece || "",
      compte_numero: x.compte_numero, compte_libelle: x.compte_libelle, libelle: x.ligne_libelle || x.ecriture_libelle, statut: x.statut,
      debit: m > 0 ? aDecimal(m) : 0, credit: m < 0 ? aDecimal(-m) : 0,
    };
  });
  return {
    section: { id: section.id, code: section.code, libelle: section.libelle, type_section: section.type_section },
    exercice: { id: p.exercice.id, libelle: p.exercice.libelle },
    periode: { debut: p.debut, fin: p.fin },
    inclure_instance: !!options.inclure_instance,
    lignes,
    totaux: { debit: aDecimal(d), credit: aDecimal(c), solde: aDecimal(d - c) },
  };
}

module.exports = {
  synchroniserSections,
  listerSections,
  sectionPourConsultation,
  sectionPourDossierAo,
  creerSection,
  modifierSection,
  ventilerLigne,
  ventilerLot,
  lignesAVentiler,
  sectionDeFacture,
  appliquerHeritageVentes,
  balanceAnalytique,
  resultatDossier,
  grandLivreAnalytique,
  RapportError,
};
