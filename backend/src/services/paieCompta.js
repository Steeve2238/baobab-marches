/**
 * Paie (lot PAIE-3B) : ecriture comptable (OD) d'une periode de paie.
 *
 * Une seule ecriture par periode, au statut EN_INSTANCE (jamais validee automatiquement : la comptabilite la controle),
 * journal d'operations diverses, date = dernier jour du mois, origine PAIE (index unique : pas de doublon).
 *
 *   Debit  : charges de personnel (salaires, primes, conges, preavis, remboursements de frais : comptes parametrables),
 *            charges sociales patronales (IPRES, CSS), CFCE patronale
 *   Credit : personnel remuneration due (net a payer), IR, TRIMF, IPRES, CSS, CFCE a payer, avances / autres retenues
 * Les comptes viennent de paie_compte_param (valeurs SYSCOHADA par defaut), completes a la longueur des comptes de l'entreprise.
 * L'equilibre est exact : la ligne "personnel - remuneration due" est la ligne d'equilibre (ecart d'arrondi du net signale).
 */
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const P = require("./paieParametres");
const compta = require("./comptaService");

const { PaieError } = P;
const { versCentimes, centimesVersDecimal } = compta;
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ORIGINE = "PAIE";
const num = (v) => Number(v) || 0;

function dernierJour(annee, mois) {
  return `${annee}-${String(mois).padStart(2, "0")}-${String(new Date(Date.UTC(annee, mois, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Cle de compte pour un code de cotisation (retenue ou charge patronale). */
function cleCotisation(c) {
  if (c.code === "CFCE") return "CFCE_A_PAYER";
  if (c.code === "CSS_AT") return "CSS_AT_A_PAYER";
  if (c.section === "RETRAITE") return "IPRES_A_PAYER";
  if (c.section === "SOCIAL") return "CSS_A_PAYER";
  return "CSS_A_PAYER";
}

/** Lignes de l'ecriture (montants entiers en F CFA, avec cle de compte) calculees depuis les bulletins de la periode. */
async function construireLignes(tid, p) {
  const rub = await db.query(`SELECT code, compte_cle, sens FROM paie_rubrique WHERE tenant_id = $1`, [tid]);
  const parCode = new Map(rub.rows.map((r) => [r.code, r]));
  const bul = await db.query(`SELECT calcul_json FROM paie_bulletin WHERE tenant_id = $1 AND periode_id = $2`, [tid, p.id]);
  if (!bul.rows.length) throw new PaieError("PAIE_AUCUN_BULLETIN", 409);

  const debits = new Map(), credits = new Map(); // cle -> montant
  const ajouter = (m, cle, montant) => { if (montant) m.set(cle, (m.get(cle) || 0) + Math.round(montant)); };
  let netTotal = 0;
  for (const { calcul_json: b } of bul.rows) {
    for (const l of b.lignes || []) {
      const r = parCode.get(l.code);
      ajouter(debits, (r && r.compte_cle) || (String(l.code).startsWith("PRIME") ? "PRIMES" : "SALAIRES"), num(l.montant));
    }
    for (const x of b.remboursements || []) ajouter(debits, (parCode.get(x.code) && parCode.get(x.code).compte_cle) || "REMBOURSEMENT_FRAIS", num(x.montant));
    for (const c of b.charges_patronales || []) {
      ajouter(debits, c.code === "CFCE" ? "CFCE_CHARGE" : "CHARGES_SOCIALES", num(c.montant));
      ajouter(credits, cleCotisation(c), num(c.montant));
    }
    for (const c of b.retenues || []) {
      if (c.code === "IR") ajouter(credits, "IR_A_PAYER", num(c.montant));
      else if (c.code === "TRIMF") ajouter(credits, "TRIMF_A_PAYER", num(c.montant));
      else ajouter(credits, cleCotisation(c), num(c.montant));
    }
    for (const x of b.retenues_saisies || []) ajouter(credits, (parCode.get(x.code) && parCode.get(x.code).compte_cle) || "PERSONNEL_DUES", num(x.montant));
    netTotal += num(b.net_a_payer);
  }
  const totalDebit = [...debits.values()].reduce((s, v) => s + v, 0);
  const autresCredits = [...credits.values()].reduce((s, v) => s + v, 0);
  const net = totalDebit - autresCredits; // ligne d'equilibre
  ajouter(credits, "PERSONNEL_DUES", net);
  const libelleCle = { SALAIRES: "Salaires et appointements", PRIMES: "Primes et gratifications", CONGES: "Indemnités de congés", PREAVIS: "Indemnités de préavis / départ", REMBOURSEMENT_FRAIS: "Remboursements de frais",
    CHARGES_SOCIALES: "Charges sociales patronales", CFCE_CHARGE: "CFCE patronale", PERSONNEL_DUES: "Personnel - rémunérations dues", AVANCES_PERSONNEL: "Personnel - avances et acomptes", CSS_A_PAYER: "CSS prestations familiales", CSS_AT_A_PAYER: "CSS accidents du travail", IPRES_A_PAYER: "IPRES", IR_A_PAYER: "IR retenu sur salaires", TRIMF_A_PAYER: "TRIMF retenue", CFCE_A_PAYER: "CFCE à payer" };
  const comptes = Object.fromEntries((await P.getComptes(tid)).map((c) => [c.cle, c.compte]));
  const mois = `${MOIS_FR[p.mois - 1]} ${p.annee}`;
  const lignes = [];
  for (const [cle, m] of debits) lignes.push({ cle, compte: comptes[cle], libelle: `${libelleCle[cle] || cle} ${mois}`, debit: m, credit: 0 });
  for (const [cle, m] of credits) lignes.push({ cle, compte: comptes[cle], libelle: `${libelleCle[cle] || cle} ${mois}`, debit: 0, credit: m });
  return { lignes, total: totalDebit, net, ecart_arrondi: Math.round(net - netTotal) };
}

async function etat(tid, p) {
  const t = await db.query(`SELECT module_comptabilite_actif AS a FROM tenant WHERE id = $1`, [tid]);
  const actif = !!(t.rows[0] && t.rows[0].a);
  let ecriture = null;
  if (actif) {
    const e = await db.query(`SELECT id, numero_piece, numero_ecriture, statut, date_ecriture FROM ecriture_comptable WHERE tenant_id = $1 AND origine = $2 AND origine_id = $3 AND origine_role = ''`, [tid, ORIGINE, p.id]);
    ecriture = e.rows[0] || null;
  }
  return { actif, ecriture };
}

/** Apercu (sans ecrire) : lignes avec numero de compte reel et comptes manquants du plan comptable. */
async function apercu(tid, p) {
  const c = await construireLignes(tid, p);
  const e = await etat(tid, p);
  let manquants = [];
  if (e.actif) {
    const param = await compta.getParametre(db, tid);
    if (param) {
      const numeros = [...new Set(c.lignes.map((l) => compta.completerNumero(l.compte, param.longueur_compte)))];
      const r = await db.query(`SELECT numero FROM compte_comptable WHERE tenant_id = $1 AND numero = ANY($2)`, [tid, numeros]);
      const ok = new Set(r.rows.map((x) => x.numero));
      manquants = numeros.filter((n) => !ok.has(n));
      c.lignes.forEach((l) => { l.numero = compta.completerNumero(l.compte, param.longueur_compte); });
    }
  }
  return { ...c, comptabilite: e, comptes_manquants: manquants };
}

/** Cree l'ecriture EN_INSTANCE de la periode (periode VALIDEE ou CLOTUREE). */
async function genererEcriture(tid, userId, periodeId) {
  const p = (await db.query(`SELECT * FROM paie_periode WHERE tenant_id = $1 AND id = $2`, [tid, periodeId])).rows[0];
  if (!p) throw new PaieError("PAIE_PERIODE_INTROUVABLE", 404);
  if (p.statut === "OUVERTE") throw new PaieError("PAIE_COMPTA_PERIODE_OUVERTE", 409);
  const t = await db.query(`SELECT module_comptabilite_actif AS a FROM tenant WHERE id = $1`, [tid]);
  if (!(t.rows[0] && t.rows[0].a)) throw new PaieError("PAIE_COMPTA_INACTIVE", 409);
  const c = await construireLignes(tid, p);
  return compta.avecTransaction(async (client) => {
    const param = await compta.exigerInitialise(client, tid);
    const deja = await client.query(`SELECT id FROM ecriture_comptable WHERE tenant_id = $1 AND origine = $2 AND origine_id = $3 AND origine_role = ''`, [tid, ORIGINE, p.id]);
    if (deja.rows[0]) throw new PaieError("PAIE_COMPTA_DEJA", 409);
    const j = await client.query(`SELECT * FROM journal_comptable WHERE tenant_id = $1 AND type_journal = 'OPERATIONS_DIVERSES' AND actif = true ORDER BY code LIMIT 1`, [tid]);
    if (!j.rows[0]) throw new PaieError("PAIE_COMPTA_JOURNAL", 409);
    const date = dernierJour(p.annee, p.mois);
    const exercice = await client.query(`SELECT * FROM exercice_comptable WHERE tenant_id = $1 AND date_debut <= $2::date AND date_fin >= $2::date`, [tid, date]);
    if (!exercice.rows[0] || exercice.rows[0].statut === "CLOTURE") throw new PaieError("PAIE_COMPTA_EXERCICE", 409);
    const lignes = [], manquants = [];
    for (const l of c.lignes) {
      const numero = compta.completerNumero(l.compte, param.longueur_compte);
      const r = await client.query(`SELECT id FROM compte_comptable WHERE tenant_id = $1 AND numero = $2`, [tid, numero]);
      if (!r.rows[0]) { manquants.push(numero); continue; }
      lignes.push({ compte_id: r.rows[0].id, tiers_id: null, libelle: l.libelle, debit_c: versCentimes(l.debit) || 0, credit_c: versCentimes(l.credit) || 0, date_echeance: null });
    }
    if (manquants.length) throw new PaieError("PAIE_COMPTA_COMPTES_MANQUANTS", 409, { comptes: manquants });
    const numeroPiece = `PAIE-${p.annee}-${String(p.mois).padStart(2, "0")}`;
    const e = await client.query(
      `INSERT INTO ecriture_comptable (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'EN_INSTANCE',$8,$9,'',$10) RETURNING *`,
      [uuidv4(), tid, exercice.rows[0].id, j.rows[0].id, numeroPiece, date, `Paie ${MOIS_FR[p.mois - 1]} ${p.annee}`, ORIGINE, p.id, userId || null]
    );
    await compta.insererLignes(client, tid, e.rows[0].id, lignes);
    return { ecriture: e.rows[0], total: c.total, ecart_arrondi: c.ecart_arrondi, nb_lignes: lignes.length };
  });
}

/** Appel depuis la cloture : ne fait jamais echouer la cloture (l'ecriture pourra etre generee a la main). */
async function genererSilencieux(tid, userId, periodeId) {
  try {
    const t = await db.query(`SELECT module_comptabilite_actif AS a FROM tenant WHERE id = $1`, [tid]);
    if (!(t.rows[0] && t.rows[0].a)) return { statut: "INACTIVE" };
    const r = await genererEcriture(tid, userId, periodeId);
    return { statut: "CREEE", numero_piece: r.ecriture.numero_piece };
  } catch (err) {
    console.error("Paie : ecriture comptable impossible", err.message);
    return { statut: "ECHEC", code: err.code || err.message };
  }
}

module.exports = { construireLignes, apercu, etat, genererEcriture, genererSilencieux };
