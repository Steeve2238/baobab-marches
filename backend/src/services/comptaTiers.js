/**
 * Comptabilite - phase 3B : lettrage, balances tiers (clients / fournisseurs) et
 * balance agee.
 *
 * LETTRAGE : on apparie des lignes d'un meme compte collectif et d'un meme
 * tiers dont le total des debits egale le total des credits ; elles recoivent
 * un code (AA, AB...) unique dans l'entreprise. Seules les lignes d'ecritures
 * VALIDEES peuvent etre lettrees.
 *
 * BALANCE AGEE : on ne vieillit que les ELEMENTS OUVERTS, c'est-a-dire les
 * lignes de compte collectif non lettrees a la date d'arrete. Les reglements
 * (credits clients / debits fournisseurs non lettres) sont imputes sur les
 * pieces les plus anciennes ; ce qui reste de reglement sans piece est affiche
 * a part ("non impute"). L'anciennete se calcule par defaut a partir de
 * l'echeance (jours de retard), ou de la date de piece.
 */
const { v4: uuidv4 } = require("uuid");
const compta = require("./comptaService");
const { resoudrePeriode, statutsInclus, RapportError } = require("./comptaRapports");

const { versCentimes, centimesVersDecimal, ComptaError } = compta;
const dateSql = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const aDecimal = (c) => c / 100;
const NATURE = { CLIENT: "COLLECTIF_CLIENT", FOURNISSEUR: "COLLECTIF_FOURNISSEUR" };
const TRANCHES_PAR_DEFAUT = [0, 30, 60, 90, 180];

function exigerType(type) {
  if (!NATURE[type]) throw new ComptaError("COMPTA_TIERS_TYPE_INVALIDE");
  return NATURE[type];
}

// ----------------------------------------------------------------------------
// Lettrage
// ----------------------------------------------------------------------------

/** Code de lettrage a partir d'un numero : 1 -> AA, 2 -> AB, ... 677 -> AAA. */
function codeLettrage(n) {
  let i = n - 1;
  let longueur = 2;
  while (i >= 26 ** longueur) {
    i -= 26 ** longueur;
    longueur += 1;
  }
  let code = "";
  for (let k = 0; k < longueur; k++) {
    code = String.fromCharCode(65 + (i % 26)) + code;
    i = Math.floor(i / 26);
  }
  return code;
}

async function prochainCodeLettrage(client, tenantId) {
  await client.query(
    `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero)
     VALUES ($1, 'LETTRAGE', 0, 0) ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
    [tenantId]
  );
  const r = await client.query(
    `UPDATE compteur_numerotation SET dernier_numero = dernier_numero + 1
     WHERE tenant_id = $1 AND type_compteur = 'LETTRAGE' AND annee = 0 RETURNING dernier_numero`,
    [tenantId]
  );
  return codeLettrage(r.rows[0].dernier_numero);
}

/** Lignes d'un tiers, pour l'ecran de lettrage. etat : NON_LETTREES (defaut) | LETTREES | TOUTES. */
async function lignesPourLettrage(client, tenantId, { tiers_id, etat = "NON_LETTREES", limit = 500 } = {}) {
  if (!tiers_id) throw new ComptaError("COMPTA_TIERS_REQUIS");
  const tiers = await client.query(`SELECT id, code, nom, type_tiers FROM tiers_comptable WHERE id = $1 AND tenant_id = $2`, [tiers_id, tenantId]);
  if (!tiers.rows[0]) throw new ComptaError("COMPTA_CLIENT_INTROUVABLE", 404);
  const filtreEtat = etat === "LETTREES" ? "AND l.lettrage IS NOT NULL" : etat === "TOUTES" ? "" : "AND l.lettrage IS NULL";
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const r = await client.query(
    `SELECT l.id, l.debit, l.credit, l.lettrage, l.date_echeance, l.libelle AS ligne_libelle,
            e.id AS ecriture_id, e.date_ecriture, e.numero_piece, e.numero_ecriture, e.statut, e.libelle AS ecriture_libelle,
            j.code AS journal_code, c.id AS compte_id, c.numero AS compte_numero, c.libelle AS compte_libelle
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN journal_comptable j ON j.id = e.journal_id
     JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.tenant_id = $1 AND l.tiers_id = $2 AND c.lettrable = true AND e.statut IN ('VALIDEE', 'EN_INSTANCE') ${filtreEtat}
     ORDER BY c.numero, e.date_ecriture, j.code, e.numero_ecriture NULLS LAST, l.ordre
     LIMIT ${lim}`,
    [tenantId, tiers_id]
  );
  return { tiers: tiers.rows[0], lignes: r.rows };
}

async function appliquerLettrage(client, tenantId, utilisateurId, ligneIds, action) {
  const code = await prochainCodeLettrage(client, tenantId);
  await client.query(`UPDATE ligne_ecriture SET lettrage = $2 WHERE tenant_id = $1 AND id = ANY($3::uuid[])`, [tenantId, code, ligneIds]);
  await compta.audit(client, tenantId, utilisateurId, action, "lettrage", code, null, { code, nb_lignes: ligneIds.length });
  return code;
}

async function lettrer(client, tenantId, utilisateurId, ligneIds) {
  const ids = Array.isArray(ligneIds) ? [...new Set(ligneIds.map(String))] : [];
  if (ids.length < 2 || ids.length > 500 || ids.some((x) => !/^[0-9a-f-]{36}$/i.test(x))) throw new ComptaError("COMPTA_LETTRAGE_LIGNES_REQUISES");
  const r = await client.query(
    `SELECT l.id, l.debit, l.credit, l.lettrage, l.compte_id, l.tiers_id, e.statut, c.lettrable
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.tenant_id = $1 AND l.id = ANY($2::uuid[]) FOR UPDATE OF l`,
    [tenantId, ids]
  );
  const lignes = r.rows;
  if (
    lignes.length !== ids.length ||
    lignes.some((l) => l.lettrage || l.statut !== "VALIDEE" || !l.lettrable || !l.tiers_id) ||
    new Set(lignes.map((l) => l.compte_id)).size !== 1 ||
    new Set(lignes.map((l) => l.tiers_id)).size !== 1
  ) {
    throw new ComptaError("COMPTA_LETTRAGE_LIGNES_INVALIDES");
  }
  const net = lignes.reduce((a, l) => a + versCentimes(l.debit) - versCentimes(l.credit), 0);
  if (net !== 0) throw new ComptaError("COMPTA_LETTRAGE_DESEQUILIBRE");
  const code = await appliquerLettrage(client, tenantId, utilisateurId, ids, "LETTRAGE");
  return { code, nb_lignes: ids.length };
}

async function delettrer(client, tenantId, utilisateurId, code) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2,}$/.test(c)) throw new ComptaError("COMPTA_LETTRAGE_INTROUVABLE", 404);
  const r = await client.query(`UPDATE ligne_ecriture SET lettrage = NULL WHERE tenant_id = $1 AND lettrage = $2 RETURNING id`, [tenantId, c]);
  if (r.rows.length === 0) throw new ComptaError("COMPTA_LETTRAGE_INTROUVABLE", 404);
  await compta.audit(client, tenantId, utilisateurId, "DELETTRAGE", "lettrage", c, { code: c, nb_lignes: r.rows.length }, null);
  return { code: c, nb_lignes: r.rows.length };
}

/** Lettre un groupe de lignes s'il est complet, valide, non lettre et equilibre. Retourne le nombre de lignes lettrees. */
async function lettrerGroupeSiPossible(client, tenantId, utilisateurId, lignes) {
  if (lignes.length < 2) return 0;
  if (lignes.some((l) => l.lettrage || l.statut !== "VALIDEE" || !l.tiers_id)) return 0;
  if (new Set(lignes.map((l) => l.compte_id)).size !== 1 || new Set(lignes.map((l) => l.tiers_id)).size !== 1) return 0;
  if (lignes.reduce((a, l) => a + versCentimes(l.debit) - versCentimes(l.credit), 0) !== 0) return 0;
  await appliquerLettrage(client, tenantId, utilisateurId, lignes.map((l) => l.id), "LETTRAGE_AUTO");
  return lignes.length;
}

async function lignesCollectifDesEcritures(client, tenantId, ecritureIds, nature) {
  if (ecritureIds.length === 0) return [];
  const r = await client.query(
    `SELECT l.id, l.debit, l.credit, l.lettrage, l.compte_id, l.tiers_id, e.statut
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.tenant_id = $1 AND l.ecriture_id = ANY($2::uuid[]) AND c.nature = $3 AND l.tiers_id IS NOT NULL`,
    [tenantId, ecritureIds, nature]
  );
  return r.rows;
}

/** Composantes connexes (union-find) a partir de paires [a, b] ; les noeuds isoles sont ajoutes avec `seuls`. */
function composantes(paires, seuls = []) {
  const parent = new Map();
  const trouver = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c);
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  for (const [a, b] of paires) parent.set(trouver(a), trouver(b));
  for (const s of seuls) trouver(s);
  const groupes = new Map();
  for (const x of parent.keys()) {
    const r = trouver(x);
    if (!groupes.has(r)) groupes.set(r, []);
    groupes.get(r).push(x);
  }
  return Array.from(groupes.values());
}

/**
 * Lettrage automatique, uniquement la ou il n'y a aucune ambiguite :
 *  - une ecriture et son extourne (toutes deux validees) ;
 *  - une facture fournisseur / de vente integralement reglee, avec les
 *    reglements qui lui sont imputes (et tous leurs autres imputes), si toutes
 *    les ecritures concernees sont validees.
 */
async function lettrageAutomatique(client, tenantId, utilisateurId) {
  const resume = { groupes: 0, lignes: 0 };
  const ajouter = (n) => {
    if (n > 0) {
      resume.groupes += 1;
      resume.lignes += n;
    }
  };

  // 1. Ecritures extournees
  const ex = await client.query(
    `SELECT e.id AS a, e.extournee_par_id AS b FROM ecriture_comptable e
     JOIN ecriture_comptable x ON x.id = e.extournee_par_id
     WHERE e.tenant_id = $1 AND e.statut = 'VALIDEE' AND x.statut = 'VALIDEE'`,
    [tenantId]
  );
  for (const p of ex.rows) {
    for (const nature of Object.values(NATURE)) {
      const lignes = await lignesCollectifDesEcritures(client, tenantId, [p.a, p.b], nature);
      const parCle = new Map();
      for (const l of lignes) {
        const k = `${l.compte_id}|${l.tiers_id}`;
        if (!parCle.has(k)) parCle.set(k, []);
        parCle.get(k).push(l);
      }
      for (const g of parCle.values()) ajouter(await lettrerGroupeSiPossible(client, tenantId, utilisateurId, g));
    }
  }

  // 2. Fournisseurs : factures soldees + reglements imputes
  const impF = await client.query(
    `SELECT i.facture_id, i.reglement_id FROM reglement_fournisseur_imputation i
     JOIN reglement_fournisseur rg ON rg.id = i.reglement_id AND rg.statut = 'ENREGISTRE'
     JOIN facture_fournisseur f ON f.id = i.facture_id AND f.statut = 'ENREGISTREE'
     WHERE i.tenant_id = $1`,
    [tenantId]
  );
  const facF = await client.query(
    `SELECT id, (montant_regle >= montant_ttc) AS soldee FROM facture_fournisseur WHERE tenant_id = $1 AND statut = 'ENREGISTREE'`,
    [tenantId]
  );
  const soldeeF = new Map(facF.rows.map((f) => [f.id, f.soldee]));
  for (const comp of composantes(impF.rows.map((x) => [`F:${x.facture_id}`, `R:${x.reglement_id}`]))) {
    const facs = comp.filter((n) => n.startsWith("F:")).map((n) => n.slice(2));
    const regs = comp.filter((n) => n.startsWith("R:")).map((n) => n.slice(2));
    if (facs.length === 0 || !facs.every((id) => soldeeF.get(id))) continue;
    const ec = await client.query(
      `SELECT id FROM ecriture_comptable WHERE tenant_id = $1 AND (
         (origine = 'FACTURE_ACHAT' AND origine_role = 'FACTURE' AND origine_id = ANY($2::uuid[])) OR
         (origine = 'REGLEMENT_FOURNISSEUR' AND origine_role = 'REGLEMENT' AND origine_id = ANY($3::uuid[])))`,
      [tenantId, facs, regs]
    );
    const lignes = await lignesCollectifDesEcritures(client, tenantId, ec.rows.map((x) => x.id), NATURE.FOURNISSEUR);
    ajouter(await lettrerGroupeSiPossible(client, tenantId, utilisateurId, lignes));
  }

  // 3. Clients : factures de vente PAYEES (encaissement automatique et/ou reglements imputes)
  const impC = await client.query(
    `SELECT i.facture_id, i.reglement_id FROM reglement_client_imputation i
     JOIN reglement_client rg ON rg.id = i.reglement_id AND rg.statut = 'ENREGISTRE'
     JOIN facture_vente f ON f.id = i.facture_id AND f.statut <> 'ANNULEE'
     WHERE i.tenant_id = $1`,
    [tenantId]
  );
  const facC = await client.query(
    `SELECT id, (statut = 'PAYEE') AS soldee FROM facture_vente WHERE tenant_id = $1 AND statut <> 'ANNULEE'`,
    [tenantId]
  );
  const soldeeC = new Map(facC.rows.map((f) => [f.id, f.soldee]));
  const seuls = await client.query(
    `SELECT DISTINCT origine_id FROM ecriture_comptable WHERE tenant_id = $1 AND origine = 'FACTURE_VENTE' AND origine_role = 'ENCAISSEMENT'`,
    [tenantId]
  );
  for (const comp of composantes(impC.rows.map((x) => [`F:${x.facture_id}`, `R:${x.reglement_id}`]), seuls.rows.map((x) => `F:${x.origine_id}`))) {
    const facs = comp.filter((n) => n.startsWith("F:")).map((n) => n.slice(2));
    const regs = comp.filter((n) => n.startsWith("R:")).map((n) => n.slice(2));
    if (facs.length === 0 || !facs.every((id) => soldeeC.get(id))) continue;
    const ec = await client.query(
      `SELECT id FROM ecriture_comptable WHERE tenant_id = $1 AND (
         (origine = 'FACTURE_VENTE' AND origine_role IN ('FACTURE', 'ENCAISSEMENT') AND origine_id = ANY($2::uuid[])) OR
         (origine = 'REGLEMENT_CLIENT' AND origine_role = 'REGLEMENT' AND origine_id = ANY($3::uuid[])))`,
      [tenantId, facs, regs]
    );
    const lignes = await lignesCollectifDesEcritures(client, tenantId, ec.rows.map((x) => x.id), NATURE.CLIENT);
    ajouter(await lettrerGroupeSiPossible(client, tenantId, utilisateurId, lignes));
  }
  return resume;
}

// ----------------------------------------------------------------------------
// Balance des tiers
// ----------------------------------------------------------------------------

const ZERO = () => ({ ouv_d: 0, ouv_c: 0, mvt_d: 0, mvt_c: 0 });
const soldeTiers = (t) => {
  const net = t.ouv_d + t.mvt_d - (t.ouv_c + t.mvt_c);
  return { sd: net > 0 ? net : 0, sc: net < 0 ? -net : 0 };
};
function versLigneTiers(t) {
  const s = soldeTiers(t);
  return {
    ouverture_debit: aDecimal(t.ouv_d),
    ouverture_credit: aDecimal(t.ouv_c),
    mouvement_debit: aDecimal(t.mvt_d),
    mouvement_credit: aDecimal(t.mvt_c),
    solde_debit: aDecimal(s.sd),
    solde_credit: aDecimal(s.sc),
  };
}

/**
 * Balance des tiers d'un type (CLIENT ou FOURNISSEUR) : ouverture (a-nouveaux +
 * periodes anterieures), mouvements de la periode, soldes cumules. Controle : le
 * total des soldes des tiers est compare au solde des comptes collectifs.
 */
async function balanceTiers(client, tenantId, options = {}) {
  const nature = exigerType(options.type);
  const { exercice, debut, fin } = await resoudrePeriode(client, tenantId, options);
  const statuts = statutsInclus(options.inclure_instance);
  const r = await client.query(
    `SELECT t.id AS tiers_id, t.code, t.nom, t.compte_collectif, e.date_ecriture, j.type_journal, l.debit, l.credit
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN journal_comptable j ON j.id = e.journal_id
     JOIN tiers_comptable t ON t.id = l.tiers_id
     WHERE l.tenant_id = $1 AND t.type_tiers = $2 AND e.exercice_id = $3 AND e.date_ecriture <= $4::date AND e.statut = ANY($5::text[])`,
    [tenantId, options.type, exercice.id, fin, statuts]
  );
  const parTiers = new Map();
  for (const l of r.rows) {
    let t = parTiers.get(l.tiers_id);
    if (!t) {
      t = { code: l.code, nom: l.nom, compte_collectif: l.compte_collectif, ...ZERO() };
      parTiers.set(l.tiers_id, t);
    }
    const d = versCentimes(l.debit);
    const c = versCentimes(l.credit);
    if (l.type_journal === "A_NOUVEAUX" || dateSql(l.date_ecriture) < debut) {
      t.ouv_d += d;
      t.ouv_c += c;
    } else {
      t.mvt_d += d;
      t.mvt_c += c;
    }
  }
  const liste = Array.from(parTiers.values()).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const total = ZERO();
  let sdTotal = 0;
  let scTotal = 0;
  const lignes = liste.map((t) => {
    total.ouv_d += t.ouv_d;
    total.ouv_c += t.ouv_c;
    total.mvt_d += t.mvt_d;
    total.mvt_c += t.mvt_c;
    const s = soldeTiers(t);
    sdTotal += s.sd;
    scTotal += s.sc;
    return { code: t.code, nom: t.nom, compte_collectif: t.compte_collectif, ...versLigneTiers(t) };
  });

  // Controle : solde des comptes collectifs (tous tiers confondus, y compris lignes sans tiers)
  const c = await client.query(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net,
            COALESCE(SUM(l.debit - l.credit) FILTER (WHERE l.tiers_id IS NULL), 0) AS net_sans_tiers,
            COUNT(*) FILTER (WHERE l.tiers_id IS NULL)::int AS nb_sans_tiers
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.tenant_id = $1 AND c.nature = $2 AND e.exercice_id = $3 AND e.date_ecriture <= $4::date AND e.statut = ANY($5::text[])`,
    [tenantId, nature, exercice.id, fin, statuts]
  );
  const netTiers = sdTotal - scTotal;
  const netCollectif = versCentimes(c.rows[0].net);
  return {
    type: options.type,
    exercice: { id: exercice.id, libelle: exercice.libelle, date_debut: exercice.date_debut, date_fin: exercice.date_fin },
    periode: { debut, fin },
    inclure_instance: !!options.inclure_instance,
    lignes,
    totaux: { ...versLigneTiers(total), solde_debit: aDecimal(sdTotal), solde_credit: aDecimal(scTotal) },
    nombre_tiers: lignes.length,
    controle: {
      solde_tiers: aDecimal(netTiers),
      solde_collectif: aDecimal(netCollectif),
      ecart: aDecimal(netCollectif - netTiers),
      lignes_sans_tiers: c.rows[0].nb_sans_tiers,
      solde_sans_tiers: aDecimal(versCentimes(c.rows[0].net_sans_tiers)),
    },
  };
}

// ----------------------------------------------------------------------------
// Balance agee
// ----------------------------------------------------------------------------

function tranchesDepuisBornes(bornes) {
  return bornes.map((b, i) => (i === 0 ? { de: null, a: b } : { de: bornes[i - 1] + 1, a: b })).concat([{ de: bornes[bornes.length - 1] + 1, a: null }]);
}

function indexTranche(jours, bornes) {
  for (let i = 0; i < bornes.length; i++) if (jours <= bornes[i]) return i;
  return bornes.length;
}

const joursEntre = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

/**
 * Balance agee des clients ou des fournisseurs a `date_arrete`.
 * mode : ECHEANCE (defaut, jours de retard) ou FACTURE (jours depuis la piece).
 * `tiers_id` restreint a un tiers et ajoute le detail des pieces ouvertes.
 */
async function balanceAgee(client, tenantId, options = {}) {
  const nature = exigerType(options.type);
  const param = await compta.exigerInitialise(client, tenantId);
  const dateArrete = options.date_arrete || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArrete) || Number.isNaN(Date.parse(dateArrete)) || new Date(`${dateArrete}T00:00:00Z`).toISOString().slice(0, 10) !== dateArrete) throw new ComptaError("COMPTA_DATE_ARRETE_INVALIDE");
  const mode = options.mode === "FACTURE" ? "FACTURE" : "ECHEANCE";
  const bornes = Array.isArray(param.tranches_balance_agee) && param.tranches_balance_agee.length ? param.tranches_balance_agee : TRANCHES_PAR_DEFAUT;
  const nb = bornes.length + 1;
  const statuts = statutsInclus(options.inclure_instance);
  const clientSens = options.type === "CLIENT"; // client : piece = debit ; fournisseur : piece = credit

  const params = [tenantId, options.type, nature, dateArrete, statuts];
  let filtreTiers = "";
  if (options.tiers_id) {
    params.push(String(options.tiers_id));
    filtreTiers = ` AND t.id::text = $${params.length}`;
  }
  const r = await client.query(
    `SELECT l.id AS ligne_id, l.debit, l.credit, l.date_echeance, l.libelle AS ligne_libelle,
            e.id AS ecriture_id, e.date_ecriture, e.numero_piece, e.statut, e.libelle AS ecriture_libelle,
            t.id AS tiers_id, t.code, t.nom, t.compte_collectif
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN compte_comptable c ON c.id = l.compte_id
     JOIN tiers_comptable t ON t.id = l.tiers_id
     WHERE l.tenant_id = $1 AND t.type_tiers = $2 AND c.nature = $3 AND l.lettrage IS NULL
       AND e.date_ecriture <= $4::date AND e.statut = ANY($5::text[]) ${filtreTiers}
     ORDER BY t.code, e.date_ecriture, e.numero_ecriture NULLS LAST, l.ordre`,
    params
  );

  const compteAvance = clientSens ? param.compte_acompte_client : param.compte_acompte_fournisseur;
  const av = await client.query(
    `SELECT l.tiers_id, COALESCE(SUM(${clientSens ? "l.credit - l.debit" : "l.debit - l.credit"}), 0) AS avance
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.tenant_id = $1 AND c.numero = $2 AND l.tiers_id IS NOT NULL AND l.lettrage IS NULL
       AND e.date_ecriture <= $3::date AND e.statut = ANY($4::text[])
     GROUP BY l.tiers_id`,
    [tenantId, compteAvance, dateArrete, statuts]
  );
  const avances = new Map(av.rows.map((x) => [x.tiers_id, versCentimes(x.avance)]));

  const parTiers = new Map();
  for (const l of r.rows) {
    let t = parTiers.get(l.tiers_id);
    if (!t) {
      t = { tiers_id: l.tiers_id, code: l.code, nom: l.nom, compte_collectif: l.compte_collectif, pieces: [], reglementsC: 0 };
      parTiers.set(l.tiers_id, t);
    }
    const d = versCentimes(l.debit);
    const c = versCentimes(l.credit);
    const montantPiece = clientSens ? d : c;
    const montantReglement = clientSens ? c : d;
    if (montantPiece > 0) {
      const echeance = l.date_echeance ? dateSql(l.date_echeance) : dateSql(l.date_ecriture);
      const dateRef = mode === "ECHEANCE" ? echeance : dateSql(l.date_ecriture);
      t.pieces.push({
        ligne_id: l.ligne_id, ecriture_id: l.ecriture_id, piece: l.numero_piece || "", libelle: l.ecriture_libelle,
        date: dateSql(l.date_ecriture), echeance, date_ref: dateRef, restant_c: montantPiece, montant_c: montantPiece, statut: l.statut,
      });
    }
    if (montantReglement > 0) t.reglementsC += montantReglement;
  }

  const sortie = [];
  const total = { buckets: new Array(nb).fill(0), total: 0, non_impute: 0, avances: 0 };
  let echuC = 0;
  let auDela90C = 0;
  let produitJours = 0;
  let sansTiersControle = 0;
  const tousLesRetards = [];

  for (const t of parTiers.values()) {
    t.pieces.sort((a, b) => (a.date_ref < b.date_ref ? -1 : a.date_ref > b.date_ref ? 1 : 0));
    let reste = t.reglementsC;
    for (const p of t.pieces) {
      const imput = Math.min(reste, p.restant_c);
      p.restant_c -= imput;
      reste -= imput;
    }
    const buckets = new Array(nb).fill(0);
    const details = [];
    let totalT = 0;
    let echuT = 0;
    for (const p of t.pieces) {
      if (p.restant_c <= 0) continue;
      const jours = joursEntre(dateArrete, p.date_ref);
      const idx = indexTranche(jours, bornes);
      buckets[idx] += p.restant_c;
      totalT += p.restant_c;
      if (jours > 0) {
        echuT += p.restant_c;
        produitJours += jours * p.restant_c;
      }
      if (jours > 90) auDela90C += p.restant_c;
      details.push({ ...p, restant: aDecimal(p.restant_c), montant: aDecimal(p.montant_c), jours, tranche: idx });
    }
    const avance = avances.get(t.tiers_id) || 0;
    if (totalT === 0 && reste === 0 && avance === 0) continue;
    total.total += totalT;
    total.non_impute += reste;
    total.avances += avance;
    buckets.forEach((b, i) => (total.buckets[i] += b));
    echuC += echuT;
    if (echuT > 0) tousLesRetards.push({ code: t.code, nom: t.nom, echu: aDecimal(echuT) });
    sortie.push({
      tiers_id: t.tiers_id, code: t.code, nom: t.nom, compte_collectif: t.compte_collectif,
      buckets: buckets.map(aDecimal), total: aDecimal(totalT), non_impute: aDecimal(reste), avances: aDecimal(avance),
      solde_net: aDecimal(totalT - reste), echu: aDecimal(echuT),
      ...(options.tiers_id ? { pieces: details.map(({ restant_c, montant_c, date_ref, ...d }) => d) } : {}),
    });
  }
  if (options.tri === "CODE") sortie.sort((a, b) => (a.code < b.code ? -1 : 1));
  else sortie.sort((a, b) => b.total - a.total || (a.code < b.code ? -1 : 1));

  // Controle : lignes de collectif sans tiers (hors balance agee) a la meme date
  const sansTiers = await client.query(
    `SELECT COUNT(*)::int AS nb, COALESCE(SUM(${clientSens ? "l.debit - l.credit" : "l.credit - l.debit"}), 0) AS net
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.tenant_id = $1 AND c.nature = $2 AND l.tiers_id IS NULL AND l.lettrage IS NULL
       AND e.date_ecriture <= $3::date AND e.statut = ANY($4::text[])`,
    [tenantId, nature, dateArrete, statuts]
  );
  sansTiersControle = versCentimes(sansTiers.rows[0].net);

  const soldeNetC = total.total - total.non_impute;
  const pct = (v) => (total.total > 0 ? Math.round((v / total.total) * 10000) / 100 : 0);
  return {
    type: options.type,
    date_arrete: dateArrete,
    mode,
    inclure_instance: !!options.inclure_instance,
    tranches: tranchesDepuisBornes(bornes),
    tiers: sortie,
    totaux: {
      buckets: total.buckets.map(aDecimal),
      total: aDecimal(total.total),
      non_impute: aDecimal(total.non_impute),
      avances: aDecimal(total.avances),
      solde_net: aDecimal(soldeNetC),
    },
    pourcentages: total.buckets.map(pct),
    indicateurs: {
      encours: aDecimal(total.total),
      echu: aDecimal(echuC),
      part_echue_pct: pct(echuC),
      retard_moyen_jours: echuC > 0 ? Math.round((produitJours / echuC) * 10) / 10 : 0,
      au_dela_90: aDecimal(auDela90C),
      part_au_dela_90_pct: pct(auDela90C),
      plus_gros_retards: tousLesRetards.sort((a, b) => b.echu - a.echu).slice(0, 10),
    },
    controle: {
      lignes_sans_tiers: sansTiers.rows[0].nb,
      solde_sans_tiers: aDecimal(sansTiersControle),
      solde_balance_agee: aDecimal(soldeNetC),
    },
  };
}

module.exports = { codeLettrage, lignesPourLettrage, lettrer, delettrer, lettrageAutomatique, balanceTiers, balanceAgee, RapportError };
