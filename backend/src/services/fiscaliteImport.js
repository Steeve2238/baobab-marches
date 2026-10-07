/**
 * Module Fiscalite (payant) - lot 3b : fiscalite utilisable SANS le module Comptabilite.
 *
 * Le client importe sa balance generale (exercice N, et N-1 pour les comparatifs) et, s'il veut le solde moyen des comptes
 * courants d'associes, son grand livre. Ces fichiers alimentent le meme moteur que la comptabilite de la plateforme
 * (voir fiscaliteDonnees.js). Rien n'est ecrit dans la comptabilite : les donnees restent dans des tables propres a la fiscalite.
 *
 * Formats lus (memes lecteurs que l'import Sage de la comptabilite) :
 *  - BALANCE : export Sage a 8 colonnes [compte, libelle, AN D/C, mouvements D/C, soldes cumules D/C], ou balance simple
 *    [compte, libelle, debit, credit] / [compte, libelle, solde debiteur, solde crediteur] avec ligne d'en-tete ;
 *  - GRAND LIVRE : colonnes N° COMPTE, DATE, CODE J, N° PIECES, LIBELLE, DEBIT, CREDIT (+ TIERS facultatif).
 */
const crypto = require("crypto");
const XLSX = require("xlsx");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const importCompta = require("./comptaImport");
const { FiscaliteError } = require("./fiscaliteTva");

const { lireClasseur, lireMontant, cleEntete } = importCompta;
const texte = (v) => (v === null || v === undefined ? "" : String(v).trim());
const francs = (centimes) => Math.round(centimes) / 100;

/** Longueur maximale des numeros de compte du fichier (8 pour Sage, 6 ou 7 ailleurs) : evite de completer a tort. */
function detecterLongueur(rows, colonne = 0) {
  let max = 0;
  for (const r of rows.slice(0, 5000)) {
    const v = (r || [])[colonne];
    const s = typeof v === "number" ? String(Math.round(v)) : texte(v).replace(/\s/g, "").replace(/\.0+$/, "");
    if (/^[1-9]\d{2,11}$/.test(s) && s.length > max) max = s.length;
  }
  return Math.min(Math.max(max, 3), 12);
}

const ENTETE_COMPTE = /^(compte|ncompte|numerocompte|numcompte|account|nodecompte|comptes)$/;
const ENTETE_LIBELLE = /^(libelle|intitule|designation|nomducompte|libellecompte)$/;
const ENTETE_DEBIT = /^(debit|debiteur|totaldebit|mouvementdebit)$/;
const ENTETE_CREDIT = /^(credit|crediteur|totalcredit|mouvementcredit)$/;
const ENTETE_SOLDE_D = /^(soldedebit|soldedebiteur|sd|soldedb)$/;
const ENTETE_SOLDE_C = /^(soldecredit|soldecrediteur|sc|soldecr)$/;

/** Balance simple a une ligne d'en-tete : compte, libelle, puis debit / credit ou solde debiteur / solde crediteur. */
function parserBalanceSimple(rows, longueur) {
  let idx = -1;
  let cols = null;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const m = {};
    (rows[i] || []).forEach((c, k) => {
      const e = cleEntete(c);
      if (!e) return;
      if (m.compte === undefined && ENTETE_COMPTE.test(e)) m.compte = k;
      else if (m.libelle === undefined && ENTETE_LIBELLE.test(e)) m.libelle = k;
      else if (m.soldeD === undefined && ENTETE_SOLDE_D.test(e)) m.soldeD = k;
      else if (m.soldeC === undefined && ENTETE_SOLDE_C.test(e)) m.soldeC = k;
      else if (m.debit === undefined && ENTETE_DEBIT.test(e)) m.debit = k;
      else if (m.credit === undefined && ENTETE_CREDIT.test(e)) m.credit = k;
    });
    const aSolde = m.soldeD !== undefined && m.soldeC !== undefined;
    const aDebCred = m.debit !== undefined && m.credit !== undefined;
    if (m.compte !== undefined && (aSolde || aDebCred)) {
      idx = i;
      cols = m;
      break;
    }
  }
  if (idx < 0) return null;
  const lignes = [];
  const erreurs = [];
  const [cd, cc] = cols.soldeD !== undefined ? [cols.soldeD, cols.soldeC] : [cols.debit, cols.credit];
  for (let i = idx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const compte = importCompta.normaliserCompte(r[cols.compte], longueur, 1);
    if (!compte) continue;
    const d = lireMontant(r[cd]);
    const c = lireMontant(r[cc]);
    if (Number.isNaN(d) || Number.isNaN(c)) {
      erreurs.push({ code: "MONTANT_INVALIDE", ligne: i + 1 });
      continue;
    }
    lignes.push({ compte, libelle: cols.libelle !== undefined ? texte(r[cols.libelle]) : "", an_c: 0, mvt_d_c: d, mvt_c_c: c, solde_c: d - c });
  }
  if (lignes.length === 0) return null;
  return { lignes, erreurs, format: "SIMPLE" };
}

/** Balance Sage a 8 colonnes. Renvoie null si le fichier n'a pas cette forme. */
function parserBalanceSage(rows, longueur) {
  const nbCandidates = rows.filter((r) => r && r.length >= 6 && importCompta.normaliserCompte(r[0], longueur, 3) && [4, 5, 6, 7].some((k) => r[k] !== null && r[k] !== undefined && r[k] !== "")).length;
  if (nbCandidates === 0) return null;
  let an;
  let mvt;
  let solde;
  try {
    an = importCompta.parserBalanceGenerale(rows, longueur, "AN");
    mvt = importCompta.parserBalanceGenerale(rows, longueur, "MOUVEMENTS");
    solde = importCompta.parserBalanceGenerale(rows, longueur, "SOLDES");
  } catch (e) {
    return null;
  }
  // parserBalanceGenerale ne renvoie que le net : on relit debit / credit des mouvements pour les cumuler.
  const mvtDC = new Map();
  for (const r of rows) {
    const compte = importCompta.normaliserCompte((r || [])[0], longueur, 3);
    if (!compte) continue;
    const d = lireMontant(r[4]);
    const c = lireMontant(r[5]);
    if (Number.isNaN(d) || Number.isNaN(c)) continue;
    const p = mvtDC.get(compte) || { d: 0, c: 0 };
    p.d += d;
    p.c += c;
    mvtDC.set(compte, p);
  }
  const m = new Map();
  const prendre = (compte) => {
    if (!m.has(compte)) m.set(compte, { compte, libelle: "", an_c: 0, mvt_d_c: 0, mvt_c_c: 0, solde_c: 0 });
    return m.get(compte);
  };
  for (const l of an.lignes) {
    const x = prendre(l.compte);
    x.libelle = x.libelle || l.libelle;
    x.an_c += l.net_c;
  }
  for (const [compte, p] of mvtDC) {
    const x = prendre(compte);
    x.mvt_d_c += p.d;
    x.mvt_c_c += p.c;
  }
  for (const l of solde.lignes) {
    const x = prendre(l.compte);
    x.libelle = x.libelle || l.libelle;
    x.solde_c += l.net_c;
  }
  return { lignes: [...m.values()], erreurs: [...an.erreurs, ...solde.erreurs], format: "SAGE" };
}

/** Les lecteurs Sage de la comptabilite levent des ComptaError : on les traduit en erreurs Fiscalite. */
function traduire(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof FiscaliteError) throw e;
    if (e && e.code && String(e.code).startsWith("COMPTA_IMPORT")) {
      throw new FiscaliteError(e.code === "COMPTA_IMPORT_VIDE" ? "FISCALITE_IMPORT_VIDE" : e.code === "COMPTA_IMPORT_FORMAT_GL" ? "FISCALITE_IMPORT_FORMAT_GL" : "FISCALITE_IMPORT_FICHIER_INVALIDE");
    }
    throw e;
  }
}

function analyserBalance(buffer) {
  return traduire(() => analyserBalanceBrut(buffer));
}

function analyserBalanceBrut(buffer) {
  const rows = lireClasseur(buffer);
  const longueur = detecterLongueur(rows);
  const parse = parserBalanceSimple(rows, longueur) || parserBalanceSage(rows, longueur);
  if (!parse) throw new FiscaliteError("FISCALITE_IMPORT_FORMAT_BALANCE");
  const avertissements = [];
  const erreurs = parse.erreurs.slice(0, 20);
  // Une ligne d'etat peut reprendre un compte deja vu (sous-totaux) : on fusionne par compte.
  let totD = 0;
  let totC = 0;
  let net = 0;
  let classes67 = 0;
  for (const l of parse.lignes) {
    net += l.solde_c;
    if (l.solde_c > 0) totD += l.solde_c;
    else totC -= l.solde_c;
    if (/^[67]/.test(l.compte)) classes67++;
  }
  if (Math.abs(net) > 100) avertissements.push({ code: "BALANCE_DESEQUILIBREE", ecart: francs(net) });
  if (classes67 === 0) avertissements.push({ code: "BALANCE_SANS_RESULTAT" });
  if (!parse.lignes.some((l) => /^1/.test(l.compte))) avertissements.push({ code: "BALANCE_SANS_CLASSE_1" });
  return {
    format: parse.format,
    longueur_comptes: longueur,
    lignes: parse.lignes,
    erreurs,
    avertissements,
    total_debit: francs(totD),
    total_credit: francs(totC),
  };
}

function analyserGrandLivre(buffer) {
  return traduire(() => analyserGrandLivreBrut(buffer));
}

function analyserGrandLivreBrut(buffer) {
  const rows = lireClasseur(buffer);
  const longueur = detecterLongueur(rows);
  const p = importCompta.parserGrandLivre(rows, longueur);
  let totD = 0;
  let totC = 0;
  for (const l of p.lignes) {
    totD += l.debit_c;
    totC += l.credit_c;
  }
  const avertissements = [];
  if (Math.abs(totD - totC) > 100) avertissements.push({ code: "GRAND_LIVRE_DESEQUILIBRE", ecart: francs(totD - totC) });
  return {
    format: "GRAND_LIVRE",
    longueur_comptes: longueur,
    lignes: p.lignes,
    erreurs: p.erreurs.slice(0, 20),
    nb_erreurs: p.erreurs.length,
    avertissements,
    total_debit: francs(totD),
    total_credit: francs(totC),
  };
}

function validerPeriode(annee, debut, fin) {
  const a = Number(annee);
  if (!Number.isInteger(a) || a < 2000 || a > 2100) throw new FiscaliteError("FISCALITE_PERIODE_INVALIDE");
  const d = debut || `${a}-01-01`;
  const f = fin || `${a}-12-31`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{4}-\d{2}-\d{2}$/.test(f) || d > f) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
  return { annee: a, date_debut: d, date_fin: f };
}

const NATURES = ["BALANCE", "GRAND_LIVRE"];
const ROLES = ["EXERCICE", "PRECEDENT"];

function resume(a, nature, extra = {}) {
  return {
    nature,
    format: a.format,
    nb_lignes: a.lignes.length,
    total_debit: a.total_debit,
    total_credit: a.total_credit,
    avertissements: a.avertissements,
    erreurs: a.erreurs,
    echantillon: a.lignes.slice(0, 12).map((l) =>
      nature === "BALANCE"
        ? { compte: l.compte, libelle: l.libelle, an: francs(l.an_c), debit: francs(l.mvt_d_c), credit: francs(l.mvt_c_c), solde: francs(l.solde_c) }
        : { compte: l.compte, date: l.date, journal: l.journal, piece: l.piece, libelle: l.libelle, debit: francs(l.debit_c), credit: francs(l.credit_c), tiers: l.tiers }
    ),
    ...extra,
  };
}

/** Apercu : lit le fichier et rend compte, sans rien ecrire. */
function apercu(nature, buffer, { annee, date_debut, date_fin } = {}) {
  if (!NATURES.includes(nature)) throw new FiscaliteError("FISCALITE_CODE_INVALIDE");
  const p = validerPeriode(annee, date_debut, date_fin);
  const a = nature === "BALANCE" ? analyserBalance(buffer) : analyserGrandLivre(buffer);
  const extra = { periode: p };
  if (nature === "GRAND_LIVRE") {
    const hors = a.lignes.filter((l) => l.date < p.date_debut || l.date > p.date_fin).length;
    if (hors > 0) a.avertissements.push({ code: "GRAND_LIVRE_HORS_PERIODE", nombre: hors });
  }
  return { ...resume(a, nature, extra), _analyse: a };
}

async function importer(tenantId, userId, { nature, role, annee, date_debut, date_fin, buffer, nomFichier }) {
  const r = ROLES.includes(role) ? role : "EXERCICE";
  const ap = apercu(nature, buffer, { annee, date_debut, date_fin });
  if (ap.erreurs.length > 0 && ap.nature === "GRAND_LIVRE" && ap.nb_lignes === 0) throw new FiscaliteError("FISCALITE_IMPORT_VIDE");
  const a = ap._analyse;
  const p = ap.periode;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE fiscalite_import_jeu SET actif = FALSE WHERE tenant_id = $1 AND annee = $2 AND nature = $3 AND role = $4 AND actif`, [tenantId, p.annee, nature, r]);
    const id = uuidv4();
    const empreinte = crypto.createHash("sha256").update(buffer).digest("hex");
    await client.query(
      `INSERT INTO fiscalite_import_jeu (id, tenant_id, annee, nature, role, nom_fichier, empreinte, date_debut, date_fin, nb_lignes, total_debit, total_credit, avertissements, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, tenantId, p.annee, nature, r, String(nomFichier || "").slice(0, 200) || null, empreinte, p.date_debut, p.date_fin, a.lignes.length, a.total_debit, a.total_credit, JSON.stringify(a.avertissements), userId]
    );
    // Insertion par paquets
    const paquet = 500;
    for (let i = 0; i < a.lignes.length; i += paquet) {
      const tranche = a.lignes.slice(i, i + paquet);
      const params = [];
      if (nature === "BALANCE") {
        const valeurs = tranche.map((l, k) => {
          const o = k * 8;
          params.push(id, tenantId, l.compte, l.libelle || null, francs(l.an_c), francs(l.mvt_d_c), francs(l.mvt_c_c), francs(l.solde_c));
          return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8})`;
        });
        // Un compte repete dans le fichier (sous-totaux) est cumule.
        await client.query(
          `INSERT INTO fiscalite_import_balance (jeu_id, tenant_id, compte, libelle, an_net, mvt_debit, mvt_credit, solde_net) VALUES ${valeurs.join(",")}
           ON CONFLICT (jeu_id, compte) DO UPDATE SET an_net = fiscalite_import_balance.an_net + EXCLUDED.an_net,
             mvt_debit = fiscalite_import_balance.mvt_debit + EXCLUDED.mvt_debit, mvt_credit = fiscalite_import_balance.mvt_credit + EXCLUDED.mvt_credit,
             solde_net = fiscalite_import_balance.solde_net + EXCLUDED.solde_net`,
          params
        );
      } else {
        const valeurs = tranche.map((l, k) => {
          const o = k * 10;
          params.push(id, tenantId, l.compte, l.date, l.journal, l.piece || null, l.libelle || null, francs(l.debit_c), francs(l.credit_c), l.tiers || l.nomTiers || null);
          return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10})`;
        });
        await client.query(
          `INSERT INTO fiscalite_import_ligne (jeu_id, tenant_id, compte, date_ecriture, journal, piece, libelle, debit, credit, tiers) VALUES ${valeurs.join(",")}`,
          params
        );
      }
    }
    await client.query("COMMIT");
    const { _analyse, ...sortie } = ap;
    void _analyse;
    return { id, ...sortie };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function lister(tenantId) {
  const r = await db.query(
    `SELECT j.id, j.annee, j.nature, j.role, j.nom_fichier, j.date_debut, j.date_fin, j.nb_lignes, j.total_debit, j.total_credit, j.avertissements, j.actif, j.date_creation,
            u.prenom, u.nom
     FROM fiscalite_import_jeu j LEFT JOIN utilisateur u ON u.id = j.cree_par
     WHERE j.tenant_id = $1 ORDER BY j.annee DESC, j.date_creation DESC LIMIT 200`,
    [tenantId]
  );
  return r.rows.map((x) => ({
    id: x.id,
    annee: x.annee,
    nature: x.nature,
    role: x.role,
    nom_fichier: x.nom_fichier,
    date_debut: String(x.date_debut).slice(0, 10),
    date_fin: String(x.date_fin).slice(0, 10),
    nb_lignes: x.nb_lignes,
    total_debit: Number(x.total_debit),
    total_credit: Number(x.total_credit),
    avertissements: x.avertissements || [],
    actif: x.actif,
    date_creation: x.date_creation,
    par: [x.prenom, x.nom].filter(Boolean).join(" ") || null,
  }));
}

async function supprimer(tenantId, id) {
  const r = await db.query(`DELETE FROM fiscalite_import_jeu WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenantId, id]);
  if (r.rowCount === 0) throw new FiscaliteError("FISCALITE_IMPORT_INTROUVABLE", 404);
}

// ----------------------------------------------------------------------------
// Tableau d'associes (Excel) : renvoie les lignes pour pre-remplir le formulaire, rien n'est enregistre.
// ----------------------------------------------------------------------------

const E_ASSOCIE = /^(associe|nom|nomassocie|actionnaire|beneficiaire|nomdelassocie)$/;
const E_NATURE = /^(nature|type|naturedelassocie|personne|statut)$/;
const E_COMPTE = /^(compte|comptecourant|ncompte|numerocompte)$/;
const E_SOMME = /^(sommesmisesadisposition|compteourant|comptecourantmoyen|soldemoyen|encoursmoyen|montant|sommes|soldecloture|encours|comptecourantassocie)$/;
const E_INTERETS = /^(interets|interetscomptabilises|interetscomptabilisés|charge|chargesinteret)$/;
const E_TAUX = /^(taux|tauxapplique|tauxcontractuel)$/;

function analyserAssocies(buffer) {
  return traduire(() => analyserAssociesBrut(buffer));
}

function analyserAssociesBrut(buffer) {
  const rows = lireClasseur(buffer);
  let idx = -1;
  let cols = null;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const m = {};
    (rows[i] || []).forEach((c, k) => {
      const e = cleEntete(c);
      if (!e) return;
      if (m.nom === undefined && E_ASSOCIE.test(e)) m.nom = k;
      else if (m.nature === undefined && E_NATURE.test(e)) m.nature = k;
      else if (m.compte === undefined && E_COMPTE.test(e)) m.compte = k;
      else if (m.somme === undefined && E_SOMME.test(e)) m.somme = k;
      else if (m.interets === undefined && E_INTERETS.test(e)) m.interets = k;
      else if (m.taux === undefined && E_TAUX.test(e)) m.taux = k;
    });
    if (m.nom !== undefined && (m.somme !== undefined || m.interets !== undefined)) {
      idx = i;
      cols = m;
      break;
    }
  }
  if (idx < 0) throw new FiscaliteError("FISCALITE_IMPORT_FORMAT_ASSOCIES");
  const associes = [];
  const erreurs = [];
  for (let i = idx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const nom = texte(r[cols.nom]);
    if (!nom || /^totaux?$/i.test(nom)) continue;
    const natBrute = cols.nature !== undefined ? cleEntete(r[cols.nature]) : "";
    const nature = /^(pp|physique|personnephysique|particulier)/.test(natBrute) ? "PERSONNE_PHYSIQUE" : "PERSONNE_MORALE";
    const somme = cols.somme !== undefined ? lireMontant(r[cols.somme]) : 0;
    const interets = cols.interets !== undefined ? lireMontant(r[cols.interets]) : 0;
    let taux = null;
    if (cols.taux !== undefined && r[cols.taux] !== null && r[cols.taux] !== "") {
      const brut = typeof r[cols.taux] === "number" ? r[cols.taux] : Number(String(r[cols.taux]).replace("%", "").replace(",", ".").trim());
      if (Number.isFinite(brut)) taux = brut > 0 && brut <= 1 ? brut * 100 : brut;
    }
    if (Number.isNaN(somme) || Number.isNaN(interets)) {
      erreurs.push({ code: "MONTANT_INVALIDE", ligne: i + 1 });
      continue;
    }
    associes.push({
      nom,
      compte: cols.compte !== undefined ? texte(r[cols.compte]) : "",
      nature,
      somme: cols.somme !== undefined ? francs(somme) : null,
      interets: cols.interets !== undefined ? francs(interets) : null,
      taux: taux === null ? null : Math.round(taux * 10000) / 10000,
    });
  }
  if (associes.length === 0) throw new FiscaliteError("FISCALITE_IMPORT_VIDE");
  return { associes, erreurs };
}

function modeleBalance() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["compte", "libelle", "solde debiteur", "solde crediteur"],
    ["10100000", "Capital social", null, 5000000],
    ["46600000", "Associes, comptes courants", null, 7500000],
    ["52110000", "Banque", 12000000, null],
    ["67420000", "Interets sur comptes courants bloques", 430000, null],
    ["70100000", "Ventes de marchandises", null, 56000000],
  ]);
  ws["!cols"] = [{ wch: 14 }, { wch: 44 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, "Balance");
  const aide = XLSX.utils.aoa_to_sheet([
    ["Balance generale pour le module Fiscalite"],
    ["Une ligne par compte, avec une ligne d'en-tete : compte, libelle, solde debiteur, solde crediteur (ou debit, credit)."],
    ["L'export Sage a 8 colonnes (a-nouveaux, mouvements, soldes cumules) est aussi reconnu tel quel, sans en-tete."],
    ["Il faut la balance APRES inventaire (classes 1 a 8, y compris amortissements et provisions) et, pour le chiffre d'affaires, les comptes 70."],
  ]);
  aide["!cols"] = [{ wch: 130 }];
  XLSX.utils.book_append_sheet(wb, aide, "Aide");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function modeleAssocies() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Associe", "Nature", "Compte", "Compte courant (somme mise a disposition)", "Interets comptabilises", "Taux"],
    ["Societe Mere SA", "Personne morale", "46600001", 7562694419, 441536774, "5,7 %"],
    ["Monsieur Exemple", "Personne physique", "46600002", 20000000, 1000000, "5 %"],
  ]);
  ws["!cols"] = [{ wch: 30 }, { wch: 20 }, { wch: 14 }, { wch: 38 }, { wch: 22 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, "Associes");
  const aide = XLSX.utils.aoa_to_sheet([
    ["Associes ayant mis des sommes a disposition de la societe (comptes courants) - module Fiscalite"],
    ["Nature : Personne morale ou Personne physique. Compte : numero du compte de l'associe (facultatif, sert a rapprocher la balance)."],
    ["Compte courant : solde moyen de l'exercice si vous l'avez, sinon le solde de cloture. Interets : charge comptabilisee pour cet associe. Taux : taux contractuel."],
    ["Les montants saisis ici remplacent ceux que la plateforme deduit de la balance ou du grand livre."],
  ]);
  aide["!cols"] = [{ wch: 140 }];
  XLSX.utils.book_append_sheet(wb, aide, "Aide");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

module.exports = { apercu, importer, lister, supprimer, analyserAssocies, modeleBalance, modeleAssocies, detecterLongueur };
