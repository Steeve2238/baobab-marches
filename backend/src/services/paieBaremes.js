/**
 * Paie : baremes officiels IR / TRIMF et formule de l'impot sur le revenu (CGI).
 *
 * - Baremes "tables" (fichier de la DGID repris dans le classeur de Steeve) : lignes [revenu, TRIMF par personne, IR 1 part,
 *   1,5, 2, 2,5, 3, 3,5, 4, 4,5, 5 parts]. Table mensuelle : pas de 1 000 F de revenu mensuel ; table annuelle : pas de
 *   5 000 F de revenu annuel (utilisee pour le TRIMF).
 * - Formule CGI (controle et repli) : abattement de 30 % plafonne, bareme progressif, reduction pour charges de famille.
 * Fonctions pures (sauf le chargement des fichiers de reference).
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PARTS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

/** Formule par defaut (CGI en vigueur, reprise du « Tableur de calcul de l'IR »). Modifiable par entreprise avec date d'effet. */
const FORMULE_DEFAUT = {
  abattement_taux: 30,
  abattement_plafond: 900000,
  tranches: [
    { de: 0, a: 630000, taux: 0 },
    { de: 630000, a: 1500000, taux: 20 },
    { de: 1500000, a: 4000000, taux: 30 },
    { de: 4000000, a: 8000000, taux: 35 },
    { de: 8000000, a: 13500000, taux: 37 },
    { de: 13500000, a: 50000000, taux: 40 },
    { de: 50000000, a: null, taux: 43 },
  ],
  // parts -> reduction = taux % de l'impot, bornee entre minimum et maximum
  reductions: [
    { parts: 1, taux: 0, minimum: 0, maximum: 0 },
    { parts: 1.5, taux: 10, minimum: 100000, maximum: 300000 },
    { parts: 2, taux: 15, minimum: 200000, maximum: 650000 },
    { parts: 2.5, taux: 20, minimum: 300000, maximum: 1100000 },
    { parts: 3, taux: 25, minimum: 400000, maximum: 1650000 },
    { parts: 3.5, taux: 30, minimum: 500000, maximum: 2030000 },
    { parts: 4, taux: 35, minimum: 600000, maximum: 2490000 },
    { parts: 4.5, taux: 40, minimum: 700000, maximum: 2755000 },
    { parts: 5, taux: 45, minimum: 800000, maximum: 3180000 },
  ],
};

const arrondi = (n) => Math.round(n);
/** Arrondi au multiple le plus proche (MROUND d'Excel : .5 vers le haut). */
const mround = (n, m) => (m > 0 ? Math.round(n / m + 1e-9) * m : n);

/** Droit progressif sur un revenu annuel deja abattu (sans reduction pour charges de famille). */
function droitProgressif(base, tranches) {
  let total = 0;
  for (const t of tranches) {
    const haut = t.a == null ? Infinity : t.a;
    if (base > t.de) total += (Math.min(base, haut) - t.de) * (t.taux / 100);
  }
  return total;
}

/** IR annuel par la formule du CGI pour un brut imposable annuel et un nombre de parts (1 a 5, par demi-part). */
function irAnnuelFormule(brutAnnuel, parts, formule = FORMULE_DEFAUT) {
  const brut = Math.max(0, Number(brutAnnuel) || 0);
  const abattement = Math.min(brut * (formule.abattement_taux / 100), formule.abattement_plafond);
  const base = brut - abattement;
  const droit = droitProgressif(base, formule.tranches);
  const p = Math.min(5, Math.max(1, Math.round((Number(parts) || 1) * 2) / 2));
  const r = formule.reductions.find((x) => x.parts === p) || { taux: 0, minimum: 0, maximum: 0 };
  let reduction = 0;
  if (r.taux > 0) reduction = Math.min(Math.max((droit * r.taux) / 100, r.minimum), r.maximum);
  return { brut_annuel: brut, abattement, base_imposable: base, droit_progressif: droit, reduction, impot: Math.max(0, droit - reduction) };
}

/** IR mensuel par la formule (impot annuel / 12). */
function irMensuelFormule(imposableMensuel, parts, formule) {
  return irAnnuelFormule((Number(imposableMensuel) || 0) * 12, parts, formule).impot / 12;
}

/**
 * Methode cumulee du « Tableur de calcul de l'IR » : brut imposable cumule ramene a l'annee (/ mois travailles x 12),
 * impot annuel x mois / 12, moins l'impot deja preleve sur la periode.
 */
function irCumul({ brutCumule, moisTravailles, parts, irDejaPaye = 0, formule }) {
  const mois = Math.max(1, Number(moisTravailles) || 1);
  const annualise = ((Number(brutCumule) || 0) / mois) * 12;
  const d = irAnnuelFormule(annualise, parts, formule);
  const irPeriode = (d.impot / 12) * mois;
  return { ...d, brut_annualise: annualise, ir_periode: irPeriode, ir_du_mois: Math.max(0, irPeriode - (Number(irDejaPaye) || 0)) };
}

// ------------------------------------------------------------------------------------------- tables
/** Index de recherche (tableau de revenus trie) d'une table de lignes. */
function indexer(lignes) {
  const l = (lignes || []).filter((r) => Array.isArray(r) && Number.isFinite(Number(r[0]))).sort((a, b) => a[0] - b[0]);
  return { lignes: l, revenus: l.map((r) => r[0]), min: l.length ? l[0][0] : null, max: l.length ? l[l.length - 1][0] : null };
}

/** Ligne exacte (VLOOKUP exact des classeurs) ; null si le revenu n'est pas dans la table. */
function ligneExacte(index, revenu) {
  let lo = 0, hi = index.revenus.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index.revenus[mid] === revenu) return index.lignes[mid];
    if (index.revenus[mid] < revenu) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/**
 * IR mensuel d'apres la table officielle. Revenu arrondi au millier (MROUND(...;1000) du classeur).
 * Retourne { montant, source: "TABLE" | "FORMULE" | "SOUS_TABLE", revenu_table }.
 */
function irMensuelTable(indexMensuel, imposableMensuel, parts, formule) {
  const revenu = mround(Number(imposableMensuel) || 0, 1000);
  const p = Math.min(5, Math.max(1, Math.round((Number(parts) || 1) * 2) / 2));
  if (!indexMensuel || !indexMensuel.lignes.length) return { montant: irMensuelFormule(imposableMensuel, p, formule), source: "FORMULE", revenu_table: revenu };
  if (revenu < indexMensuel.min) return { montant: 0, source: "SOUS_TABLE", revenu_table: revenu };
  if (revenu > indexMensuel.max) return { montant: irMensuelFormule(imposableMensuel, p, formule), source: "FORMULE", revenu_table: revenu };
  const ligne = ligneExacte(indexMensuel, revenu);
  if (!ligne) return { montant: irMensuelFormule(imposableMensuel, p, formule), source: "FORMULE", revenu_table: revenu };
  const col = 2 + PARTS.indexOf(p);
  return { montant: Number(ligne[col]) || 0, source: "TABLE", revenu_table: revenu };
}

/**
 * TRIMF mensuel par personne : revenu annualise arrondi a 5 000, TRIMF annuel / 12 (comme le classeur).
 * Sous la premiere ligne de la table : pas de TRIMF.
 */
function trimfMensuelParPersonne(indexAnnuel, imposableMensuel) {
  const annuel = mround((Number(imposableMensuel) || 0) * 12, 5000);
  if (!indexAnnuel || !indexAnnuel.lignes.length) return { montant: 0, annuel: 0, revenu_table: annuel, source: "AUCUN" };
  if (annuel < indexAnnuel.min) return { montant: 0, annuel: 0, revenu_table: annuel, source: "SOUS_TABLE" };
  const ligne = ligneExacte(indexAnnuel, Math.min(annuel, indexAnnuel.max));
  if (!ligne) return { montant: 0, annuel: 0, revenu_table: annuel, source: "AUCUN" };
  return { montant: Number(ligne[1]) / 12, annuel: Number(ligne[1]), revenu_table: annuel, source: "TABLE" };
}

// ------------------------------------------------------------------------------------------- fichiers de reference
const DOSSIER = path.join(__dirname, "..", "..", "data", "paie");
function lireFichierReference(nom) {
  const chemin = path.join(DOSSIER, nom);
  if (!fs.existsSync(chemin)) return null;
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(chemin)).toString("utf8"));
}

// ------------------------------------------------------------------------------------------- import Excel
/**
 * Lit un classeur de bareme (feuille « Trimf Annuel » ou « Trimf Mensuel » du fichier DGID, ou toute feuille de meme forme) :
 * colonne revenu, TRIMF par personne, IR de 1 a 5 parts. Les lignes d'en-tete sont ignorees.
 * Retourne { lignes, pas, min, max } ou leve une erreur explicite.
 */
function lireBaremeExcel(buffer, nomFeuille) {
  const XLSX = require("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const noms = wb.SheetNames;
  const feuille = nomFeuille && noms.includes(nomFeuille) ? nomFeuille : noms.find((n) => /trimf|bar[eè]me/i.test(n)) || noms[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[feuille], { header: 1, raw: true, defval: null });
  const lignes = [];
  for (const r of rows) {
    // Le classeur de la DGID laisse la colonne A vide : on repere la premiere cellule numerique de la ligne.
    const debut = r.findIndex((c) => typeof c === "number");
    if (debut < 0) continue;
    const vals = r.slice(debut, debut + 10).map((c) => (typeof c === "number" ? c : 0));
    if (vals.length < 2 || vals[0] < 1000) continue;
    while (vals.length < 10) vals.push(0);
    lignes.push(vals.map((v, i) => (i === 0 ? Math.round(v) : Math.round(v * 100) / 100)));
  }
  if (lignes.length < 10) throw Object.assign(new Error("BAREME_ILLISIBLE"), { code: "PAIE_BAREME_ILLISIBLE" });
  lignes.sort((a, b) => a[0] - b[0]);
  const pas = new Set();
  for (let i = 1; i < lignes.length; i++) pas.add(lignes[i][0] - lignes[i - 1][0]);
  return { feuille, lignes, pas: pas.size === 1 ? [...pas][0] : null, min: lignes[0][0], max: lignes[lignes.length - 1][0] };
}

module.exports = {
  PARTS, FORMULE_DEFAUT, arrondi, mround, droitProgressif, irAnnuelFormule, irMensuelFormule, irCumul,
  indexer, ligneExacte, irMensuelTable, trimfMensuelParPersonne, lireFichierReference, lireBaremeExcel,
};
