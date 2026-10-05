const express = require("express");
const multer = require("multer");
const db = require("../db");
const { requireAuth, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { lireFactureExcel } = require("../services/receptionExcel");
const {
  chargerAchats, ajouterVariations, syntheseParFournisseur, marquerMeilleurs, derniersAchatsFournisseur, pct, arr2,
} = require("../services/prixFournisseurs");

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------------------------
// Prix par fournisseur (Lot 3, 05/10/2026) : historique des prix d'achat par
// article et par fournisseur, variations, comparaison d'une offre recue avec ce
// qui a deja ete paye. Lecture seule sur les receptions validees.
// Acces : memes modules que les receptions (fournisseurs OU marches).
// ----------------------------------------------------------------------------
router.use((req, res, next) => {
  const permissions = req.user?.permissions;
  if (!permissions) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  if (permissions.admin || permissions.tableauDeBord) return next();
  if ((permissions.modules || []).some((m) => m === "fournisseurs" || m === "marches")) return next();
  return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
});
router.use(blockLectureSeule);

const uploadExcel = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Synthese : un ligne par couple (article, fournisseur).
router.get("/", async (req, res) => {
  const { q, fournisseur_id: fournisseurId } = req.query;
  try {
    const achats = ajouterVariations(await chargerAchats(req.user.tenantId));
    const produits = (
      await db.query(`SELECT id, reference, designation, unite FROM produit WHERE tenant_id = $1`, [req.user.tenantId])
    ).rows;
    const parId = new Map(produits.map((p) => [p.id, p]));
    let lignes = marquerMeilleurs(syntheseParFournisseur(achats)).map((l) => ({
      ...l,
      reference: parId.get(l.produit_id)?.reference || null,
      designation: parId.get(l.produit_id)?.designation || "",
      unite: parId.get(l.produit_id)?.unite || "",
    }));
    if (fournisseurId && UUID_RE.test(String(fournisseurId))) lignes = lignes.filter((l) => l.fournisseur_id === fournisseurId);
    if (q && String(q).trim()) {
      const n = norm(q);
      lignes = lignes.filter((l) => norm(l.designation).includes(n) || norm(l.reference).includes(n) || norm(l.fournisseur_nom).includes(n));
    }
    lignes.sort((a, b) => a.designation.localeCompare(b.designation) || a.fournisseur_nom.localeCompare(b.fournisseur_nom));
    res.json(lignes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRIX_FETCH_ERROR") });
  }
});

// Historique complet d'un article, tous fournisseurs confondus.
router.get("/produit/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "PRODUIT_NOT_FOUND") });
  try {
    const produit = (
      await db.query(`SELECT id, reference, designation, unite FROM produit WHERE id = $1 AND tenant_id = $2`, [id, req.user.tenantId])
    ).rows[0];
    if (!produit) return res.status(404).json({ error: t(req, "PRODUIT_NOT_FOUND") });
    const achats = ajouterVariations(await chargerAchats(req.user.tenantId, { produitId: id }));
    res.json({
      produit,
      fournisseurs: marquerMeilleurs(syntheseParFournisseur(achats)),
      achats,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRIX_FETCH_ERROR") });
  }
});

// ---------------------------------------------------------------------------
// Comparaison d'une offre fournisseur avec l'historique (rien n'est enregistre).
// ---------------------------------------------------------------------------
async function comparerOffre(tenantId, fournisseurId, devise, cours, lignes) {
  const mappings = (
    await db.query(
      `SELECT m.produit_id, m.reference_fournisseur, m.designation_fournisseur
       FROM produit_reference_fournisseur m WHERE m.tenant_id = $1 AND m.fournisseur_id = $2`,
      [tenantId, fournisseurId]
    )
  ).rows;
  const produits = (await db.query(`SELECT id, reference, designation FROM produit WHERE tenant_id = $1`, [tenantId])).rows;
  const parRef = new Map(mappings.map((m) => [norm(m.reference_fournisseur), m.produit_id]));
  const parDesignation = new Map();
  for (const p of produits) parDesignation.set(norm(p.designation), p.id);
  for (const m of mappings) if (m.designation_fournisseur) parDesignation.set(norm(m.designation_fournisseur), m.produit_id);
  const produitsParId = new Map(produits.map((p) => [p.id, p]));

  const resolus = lignes.map((l) => {
    const viaRef = l.reference_fournisseur ? parRef.get(norm(l.reference_fournisseur)) : null;
    if (viaRef) return { produit_id: viaRef, correspondance: "REFERENCE" };
    const viaDes = parDesignation.get(norm(l.designation));
    if (viaDes) return { produit_id: viaDes, correspondance: "DESIGNATION" };
    return { produit_id: null, correspondance: null };
  });
  const ids = [...new Set(resolus.map((r) => r.produit_id).filter(Boolean))];
  const derniers = await derniersAchatsFournisseur(tenantId, fournisseurId, ids, null);
  const tous = ids.length ? syntheseParFournisseur(ajouterVariations(await chargerAchats(tenantId, { produitIds: ids }))) : [];

  const sortie = lignes.map((l, index) => {
    const r = resolus[index];
    const prixOffre = arr2(l.prix_unitaire_devise * cours);
    const dernier = r.produit_id ? derniers.get(r.produit_id) || null : null;
    const autres = tous.filter((x) => x.produit_id === r.produit_id && x.fournisseur_id !== fournisseurId);
    const meilleurAutre = autres.length
      ? autres.reduce((m, x) => (x.dernier_achat.prix_achat_xof < m.dernier_achat.prix_achat_xof ? x : m))
      : null;
    const article = r.produit_id ? produitsParId.get(r.produit_id) : null;
    return {
      index,
      reference_fournisseur: l.reference_fournisseur || null,
      designation: l.designation,
      unite: l.unite || "U",
      quantite: Number(l.quantite) || 0,
      prix_unitaire_devise: Number(l.prix_unitaire_devise),
      prix_offre_xof: prixOffre,
      article: article ? { id: article.id, reference: article.reference, designation: article.designation } : null,
      correspondance: r.correspondance,
      dernier_achat: dernier ? { prix_achat_xof: dernier.prix_achat_xof, date: dernier.date, numero: dernier.numero } : null,
      ecart_dernier_pct: dernier ? pct(prixOffre, dernier.prix_achat_xof) : null,
      meilleur_autre: meilleurAutre
        ? { fournisseur_nom: meilleurAutre.fournisseur_nom, prix_achat_xof: meilleurAutre.dernier_achat.prix_achat_xof, date: meilleurAutre.dernier_achat.date }
        : null,
      ecart_meilleur_autre_pct: meilleurAutre ? pct(prixOffre, meilleurAutre.dernier_achat.prix_achat_xof) : null,
    };
  });
  const comparables = sortie.filter((l) => l.ecart_dernier_pct !== null);
  return {
    devise,
    cours_devise: cours,
    lignes: sortie,
    resume: {
      nb_lignes: sortie.length,
      nb_reconnues: sortie.filter((l) => l.article).length,
      nb_comparables: comparables.length,
      nb_hausses: comparables.filter((l) => l.ecart_dernier_pct > 0).length,
      nb_baisses: comparables.filter((l) => l.ecart_dernier_pct < 0).length,
      ecart_moyen_pct: comparables.length ? arr2(comparables.reduce((s, l) => s + l.ecart_dernier_pct, 0) / comparables.length) : null,
    },
  };
}

async function preparer(req) {
  const b = req.body;
  if (!b.fournisseur_id || !UUID_RE.test(String(b.fournisseur_id))) return { erreur: "RECEPTION_FOURNISSEUR_REQUIRED" };
  const f = await db.query(`SELECT 1 FROM fournisseur WHERE id = $1 AND tenant_id = $2`, [b.fournisseur_id, req.user.tenantId]);
  if (f.rows.length === 0) return { erreur: "RECEPTION_FOURNISSEUR_REQUIRED" };
  const devise = String(b.devise || "XOF").trim().toUpperCase().slice(0, 8) || "XOF";
  const cours = devise === "XOF" ? 1 : Number(b.cours_devise);
  if (!Number.isFinite(cours) || cours <= 0) return { erreur: "RECEPTION_COURS_INVALID" };
  return { fournisseurId: b.fournisseur_id, devise, cours };
}

router.post("/comparer", async (req, res) => {
  try {
    const p = await preparer(req);
    if (p.erreur) return res.status(400).json({ error: t(req, p.erreur) });
    const lignes = (Array.isArray(req.body.lignes) ? req.body.lignes : []).filter((l) => String(l.designation || "").trim());
    for (const l of lignes) {
      const pu = Number(l.prix_unitaire_devise);
      if (!Number.isFinite(pu) || pu < 0) return res.status(400).json({ error: t(req, "RECEPTION_LIGNE_INVALID") });
    }
    res.json(await comparerOffre(req.user.tenantId, p.fournisseurId, p.devise, p.cours, lignes));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRIX_FETCH_ERROR") });
  }
});

router.post("/comparer-excel", uploadExcel.single("fichier"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: t(req, "RECEPTION_IMPORT_FICHIER") });
    const p = await preparer(req);
    if (p.erreur) return res.status(400).json({ error: t(req, p.erreur) });
    const lu = lireFactureExcel(req.file.buffer);
    if (lu.erreur === "FICHIER") return res.status(400).json({ error: t(req, "RECEPTION_IMPORT_FICHIER") });
    if (lu.erreur === "COLONNES") return res.status(400).json({ error: t(req, "RECEPTION_IMPORT_COLONNES") });
    const resultat = await comparerOffre(req.user.tenantId, p.fournisseurId, p.devise, p.cours, lu.lignes);
    resultat.avertissements = lu.avertissements.map((a) => {
      if (a.code === "LIGNE_IGNOREE") return t(req, "RECEPTION_IMPORT_LIGNE_IGNOREE").replace("{n}", a.ligne);
      if (a.code === "PRIX_MANQUANT") return t(req, "RECEPTION_IMPORT_PRIX_MANQUANT").replace("{n}", a.ligne);
      return t(req, "RECEPTION_IMPORT_ECART").replace("{n}", a.ligne).replace("{calcule}", a.calcule).replace("{montant}", a.montant);
    });
    res.json(resultat);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRIX_FETCH_ERROR") });
  }
});

module.exports = router;
