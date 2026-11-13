const db = require("../db");
const P = require("./paieParametres");

/**
 * Conventions collectives pour le contrat de travail : liste deroulante (convention -> categories) et
 * salaire de base automatique issu de la grille du parametrage Paie.
 */


const arrondi = (v) => Math.round(Number(v) || 0);
const norm = (s) =>
  String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const auj = () => new Date().toISOString().slice(0, 10);
const jour = (d) => (d ? String(d).slice(0, 10) : null);

async function listerConventions(tenantId, date) {
  await P.assurerDefauts(tenantId);
  const d = jour(date) || auj();
  const r = await db.query(
    `SELECT id, code, libelle, anciennete_json FROM paie_convention WHERE tenant_id = $1 AND actif IS NOT FALSE ORDER BY ordre, libelle`,
    [tenantId]
  );
  const out = [];
  for (const c of r.rows) {
    const grille = await P.grilleA(tenantId, c.id, d);
    out.push({
      id: c.id,
      code: c.code,
      libelle: c.libelle,
      anciennete: Array.isArray(c.anciennete_json) ? c.anciennete_json : [],
      categories: grille.map((k) => ({ code: k.code, libelle: k.libelle, classification: k.classification, salaire_base: k.salaire_base })),
    });
  }
  return out;
}

/** Retrouve convention / categorie depuis les textes libres de la fiche ou d'un ancien contrat. */
function resoudre(conventions, texteConvention, texteCategorie) {
  const tc = norm(texteConvention);
  let conv = null;
  if (tc) {
    conv =
      conventions.find((c) => norm(c.code) === tc || norm(c.libelle) === tc) ||
      conventions.find((c) => norm(c.libelle).includes(tc) || tc.includes(norm(c.libelle)) || tc.includes(norm(c.code))) ||
      null;
  }
  if (!conv && conventions.length === 1) conv = conventions[0];
  let cat = null;
  const tk = norm(texteCategorie);
  if (conv && tk) {
    const cats = conv.categories;
    cat =
      cats.find((k) => norm(k.code) === tk || norm(k.libelle) === tk) ||
      cats.find((k) => tk === norm(`categorie ${k.code}`) || tk === norm(`cat ${k.code}`)) ||
      cats.find((k) => norm(k.libelle).includes(tk) || (norm(k.code).length > 1 && tk.includes(norm(k.code)))) ||
      null;
  }
  return { convention_id: conv ? conv.id : null, categorie_code: cat ? cat.code : null };
}

/**
 * Salaire de base propose pour une convention / categorie a une date (grille du parametrage Paie).
 * Volontairement limite au salaire de base : sursalaire, anciennete, elements fixes et variables sont deja traites par la Paie
 * (pas de double traitement dans le contrat).
 * Retourne { convention, categorie, lignes[] }.
 */
async function composition(tenantId, { conventionId, categorieCode, dateContrat }) {
  await P.assurerDefauts(tenantId);
  const date = jour(dateContrat) || auj();
  const out = { convention: null, categorie: null, lignes: [] };
  if (!conventionId) return out;
  const cr = await db.query(`SELECT id, code, libelle FROM paie_convention WHERE tenant_id = $1 AND id = $2`, [tenantId, conventionId]);
  if (!cr.rows.length) return out;
  const conv = cr.rows[0];
  out.convention = { id: conv.id, code: conv.code, libelle: conv.libelle };
  const grille = await P.grilleA(tenantId, conv.id, date);
  const cat = categorieCode ? grille.find((k) => k.code === categorieCode) : null;
  if (!cat) return out;
  out.categorie = { code: cat.code, libelle: cat.libelle, classification: cat.classification, salaire_base: cat.salaire_base };
  out.lignes.push({ libelle: "Salaire de base", montant: arrondi(cat.salaire_base), essai: true, auto: true });
  return out;
}

module.exports = { listerConventions, resoudre, composition };
