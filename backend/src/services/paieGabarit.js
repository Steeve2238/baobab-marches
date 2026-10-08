/**
 * Paie : gabarit Excel d'une convention collective (grille des categories, anciennete, majorations d'heures supplementaires).
 * Permet de charger une convention ou de revaloriser une grille a partir d'un fichier.
 */
const XLSX = require("xlsx");

const CLASSIFICATIONS = {
  OUVRIER: "OUVRIER", OUVRIERS: "OUVRIER", EMPLOYE: "EMPLOYE", EMPLOYES: "EMPLOYE", "EMPLOYÉ": "EMPLOYE", "EMPLOYÉS": "EMPLOYE",
  AGENT_MAITRISE: "AGENT_MAITRISE", "AGENT DE MAITRISE": "AGENT_MAITRISE", "AGENT DE MAÎTRISE": "AGENT_MAITRISE", "AGENTS DE MAITRISE": "AGENT_MAITRISE",
  CADRE: "CADRE", CADRES: "CADRE", INGENIEUR: "CADRE", "INGÉNIEUR": "CADRE",
};
const LIBELLE_CLASSIFICATION = { OUVRIER: "Ouvrier", EMPLOYE: "Employé", AGENT_MAITRISE: "Agent de maîtrise", CADRE: "Cadre" };

function nombre(v) {
  if (typeof v === "number") return v;
  if (v == null) return NaN;
  return Number(String(v).replace(/\s/g, "").replace(",", "."));
}

/** Classeur modele (ou export) : feuilles Grille, Anciennete, Heures supplementaires. */
function genererGabarit(convention, grille) {
  const wb = XLSX.utils.book_new();
  const g = [["Code", "Libellé", "Classification (Ouvrier / Employé / Agent de maîtrise / Cadre)", "Salaire de base (pour 173,33 h)"]];
  for (const l of grille) g.push([l.code, l.libelle, LIBELLE_CLASSIFICATION[l.classification] || l.classification, l.salaire_base]);
  if (grille.length === 0) g.push(["1", "1ère catégorie", "Employé", 70000]);
  const wsG = XLSX.utils.aoa_to_sheet(g);
  wsG["!cols"] = [{ wch: 10 }, { wch: 34 }, { wch: 40 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, wsG, "Grille");
  const a = [["Années d'ancienneté", "Taux (% du salaire de base)"]];
  for (const l of convention.anciennete || []) a.push([l.annees, l.taux]);
  const wsA = XLSX.utils.aoa_to_sheet(a);
  wsA["!cols"] = [{ wch: 22 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, wsA, "Ancienneté");
  const h = [["Code", "Libellé", "Majoration (%)"]];
  for (const l of convention.majorations || []) h.push([l.code, l.libelle, l.taux]);
  const wsH = XLSX.utils.aoa_to_sheet(h);
  wsH["!cols"] = [{ wch: 12 }, { wch: 60 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsH, "Heures supplémentaires");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/** Lit le classeur : { categories[], anciennete[] | null, majorations[] | null, erreurs[] }. */
function lireGabarit(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const feuille = (re) => wb.SheetNames.find((n) => re.test(norm(n)));
  const erreurs = [];
  const nomG = feuille(/grille|bareme|categor/) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[nomG], { header: 1, raw: true, defval: null });
  const categories = [];
  const vus = new Set();
  rows.forEach((r, i) => {
    if (i === 0 && isNaN(nombre(r[3]))) return; // en-tete
    if (r.every((c) => c == null || c === "")) return;
    const code = r[0] == null ? "" : String(r[0]).trim();
    const libelle = r[1] == null ? "" : String(r[1]).trim();
    const cl = CLASSIFICATIONS[String(r[2] == null ? "" : r[2]).trim().toUpperCase()];
    const sal = nombre(r[3]);
    if (!code || !libelle || !cl || !Number.isFinite(sal) || sal < 0) { erreurs.push({ ligne: i + 1, code }); return; }
    if (vus.has(code)) { erreurs.push({ ligne: i + 1, code, doublon: true }); return; }
    vus.add(code);
    categories.push({ code: code.slice(0, 20), libelle: libelle.slice(0, 120), classification: cl, salaire_base: Math.round(sal) });
  });
  let anciennete = null;
  const nomA = feuille(/anciennete/);
  if (nomA) {
    anciennete = [];
    for (const r of XLSX.utils.sheet_to_json(wb.Sheets[nomA], { header: 1, raw: true, defval: null })) {
      const an = nombre(r[0]), tx = nombre(r[1]);
      if (Number.isFinite(an) && Number.isFinite(tx) && an >= 0 && tx >= 0 && tx <= 100) anciennete.push({ annees: Math.round(an), taux: tx });
    }
    if (!anciennete.length) anciennete = null;
  }
  let majorations = null;
  const nomH = feuille(/heures|majoration/);
  if (nomH) {
    majorations = [];
    for (const r of XLSX.utils.sheet_to_json(wb.Sheets[nomH], { header: 1, raw: true, defval: null })) {
      const code = r[0] == null ? "" : String(r[0]).trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      const tx = nombre(r[2]);
      if (code && Number.isFinite(tx) && tx >= 0 && tx <= 300) majorations.push({ code: code.slice(0, 20), libelle: String(r[1] || code).slice(0, 120), taux: tx });
    }
    if (!majorations.length) majorations = null;
  }
  return { feuille: nomG, categories, anciennete, majorations, erreurs };
}

module.exports = { genererGabarit, lireGabarit, CLASSIFICATIONS };
