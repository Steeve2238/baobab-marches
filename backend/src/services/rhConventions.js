const db = require("../db");
const { v4: uuidv4 } = require("uuid");
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


/**
 * Convention / categorie a preselectionner pour un salarie : le dossier de paie fait foi (c'est lui que la paie lit),
 * sinon on retrouve la convention a partir du texte de la fiche.
 */
async function selectionPourEmploye(tenantId, emp, conventions) {
  const dossier = await P.chargerDossier(tenantId, emp.id);
  if (dossier && dossier.convention_id) {
    const conv = conventions.find((c) => c.id === dossier.convention_id);
    if (conv) {
      const cat = dossier.categorie_code ? conv.categories.find((k) => k.code === dossier.categorie_code) : null;
      return { convention_id: conv.id, categorie_code: cat ? cat.code : null, origine: "PAIE" };
    }
  }
  return { ...resoudre(conventions, emp.convention_collective, emp.categorie), origine: "FICHE" };
}

/**
 * Fiche employe -> dossier de paie : renseigne la convention et la categorie du dossier (sans toucher au salaire manuel,
 * au sursalaire, a l'anciennete ni aux elements fixes). Ne remplace JAMAIS une convention / categorie deja choisie
 * dans la paie : dans ce cas on renvoie un CONFLIT pour que l'utilisateur soit prevenu.
 * Retourne { statut: "OK" | "IDENTIQUE" | "CONFLIT" | "IGNORE", paie?: {convention, categorie} }.
 */
async function synchroniserDossierPaie(tenantId, employeId, { conventionId, categorieCode }, auteurId) {
  await P.assurerDefauts(tenantId);
  const cr = await db.query(`SELECT id, libelle FROM paie_convention WHERE tenant_id = $1 AND id = $2`, [tenantId, conventionId]);
  if (!cr.rows.length) return { statut: "IGNORE" };
  const conv = cr.rows[0];
  let cat = null;
  if (categorieCode) {
    const grille = await P.grilleA(tenantId, conv.id, auj());
    cat = grille.find((k) => k.code === categorieCode) || null;
    if (!cat) return { statut: "IGNORE" };
  }
  const dossier = await P.chargerDossier(tenantId, employeId);
  const nouvelleCat = cat ? cat.code : null;

  if (dossier) {
    const convDiff = dossier.convention_id && dossier.convention_id !== conv.id;
    const catDiff = dossier.categorie_code && nouvelleCat && dossier.categorie_code !== nouvelleCat;
    if (convDiff || catDiff) {
      let libConv = dossier.convention_libelle || "";
      let libCat = dossier.categorie_code || "";
      if (dossier.convention_id) {
        const grille = await P.grilleA(tenantId, dossier.convention_id, auj());
        const k = grille.find((x) => x.code === dossier.categorie_code);
        if (k) libCat = k.libelle;
      }
      return { statut: "CONFLIT", paie: { convention: libConv, categorie: libCat } };
    }
    const convFinale = dossier.convention_id || conv.id;
    const catFinale = dossier.categorie_code || nouvelleCat;
    if (convFinale === dossier.convention_id && (catFinale || null) === (dossier.categorie_code || null)) return { statut: "IDENTIQUE" };
    await db.query(
      `UPDATE paie_dossier SET convention_id = $3, categorie_code = $4, date_modification = now(), modifie_par = $5 WHERE tenant_id = $1 AND employe_id = $2`,
      [tenantId, employeId, convFinale, catFinale, auteurId || null]
    );
  } else {
    await db.query(
      `INSERT INTO paie_dossier (employe_id, tenant_id, convention_id, categorie_code, modifie_par) VALUES ($1, $2, $3, $4, $5)`,
      [employeId, tenantId, conv.id, nouvelleCat, auteurId || null]
    );
  }
  // Meme journal que les changements faits depuis le dossier de paie.
  const avantConv = dossier ? dossier.convention_id : null;
  const avantCat = dossier ? dossier.categorie_code : null;
  const apresConv = dossier && dossier.convention_id ? dossier.convention_id : conv.id;
  const apresCat = dossier && dossier.categorie_code ? dossier.categorie_code : nouvelleCat;
  for (const [champ, a, n] of [["paie.convention", avantConv, apresConv], ["paie.categorie", avantCat, apresCat]]) {
    if ((a || null) !== (n || null)) {
      await db.query(
        `INSERT INTO employe_historique (id, tenant_id, employe_id, champ, ancienne_valeur, nouvelle_valeur, modifie_par) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uuidv4(), tenantId, employeId, champ, a ? String(a).slice(0, 50) : null, n ? String(n).slice(0, 50) : null, auteurId || null]
      );
    }
  }
  return { statut: "OK" };
}

module.exports = { listerConventions, resoudre, composition, selectionPourEmploye, synchroniserDossierPaie };
