const express = require("express");
const db = require("../db");
const { requireAuth, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const valo = require("../services/valorisationStock");
const inventaire = require("../services/inventaire");

// Stock (Pack Commerce, lot 6) : valorisation, parametres, seuils, journal des mouvements, inventaires.
const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => {
  const p = req.user?.permissions;
  if (!p) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  if (p.admin || p.tableauDeBord) return next();
  if ((p.modules || []).some((m) => m === "marches" || m === "dossiers" || m === "comptabilite" || m === "comptabilite-validation")) return next();
  return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
});
router.use((req, res, next) => (req.method === "GET" ? next() : blockLectureSeule(req, res, next)));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const estGestionnaire = (req) => {
  const p = req.user.permissions;
  return !!(p.admin || (p.modules || []).includes("comptabilite-validation") || (p.modules || []).includes("comptabilite"));
};

function gerer(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof inventaire.InventaireError) return res.status(err.status).json({ error: t(req, err.code), code: err.code });
      if (err && (err.code === "STOCK_METHODE_INVALIDE" || err.code === "STOCK_DATE_INVALIDE")) return res.status(400).json({ error: t(req, err.code), code: err.code });
      console.error(err);
      res.status(500).json({ error: t(req, "STOCK_ERREUR") });
    }
  };
}

// --- Parametres de valorisation ------------------------------------------------------------
router.get("/parametres", gerer(async (req, res) => {
  const cfg = await valo.lireMethode(db, req.user.tenantId);
  const hist = (
    await db.query(
      `SELECT h.methode, h.date_effet, h.date_creation, u.email AS par FROM stock_valorisation_historique h
       LEFT JOIN utilisateur u ON u.id = h.cree_par WHERE h.tenant_id = $1 ORDER BY h.date_creation DESC LIMIT 20`,
      [req.user.tenantId]
    )
  ).rows;
  res.json({ ...cfg, historique: hist.map((h) => ({ ...h, date_effet: String(h.date_effet instanceof Date ? new Date(h.date_effet.getTime() - h.date_effet.getTimezoneOffset() * 60000).toISOString() : h.date_effet).slice(0, 10) })), peut_modifier: estGestionnaire(req) });
}));

router.put("/parametres", gerer(async (req, res) => {
  if (!estGestionnaire(req)) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  const { methode, date_effet, seuil_defaut } = req.body || {};
  if (seuil_defaut !== undefined) {
    const s = Number(seuil_defaut);
    if (!Number.isFinite(s) || s < 0 || s > 1e9) return res.status(400).json({ error: t(req, "STOCK_SEUIL_INVALIDE") });
    await db.query(`UPDATE tenant SET seuil_stock_defaut = $2 WHERE id = $1`, [req.user.tenantId, s]);
  }
  if (methode !== undefined) {
    const actuel = await valo.lireMethode(db, req.user.tenantId);
    if (methode !== actuel.methode || (date_effet && date_effet !== actuel.date_effet)) {
      await valo.changerMethode(req.user.tenantId, req.user.sub, methode, date_effet);
    }
  }
  res.json(await valo.lireMethode(db, req.user.tenantId));
}));

// --- Valorisation / etat du stock ---------------------------------------------------------
router.get("/valorisation", gerer(async (req, res) => {
  const methode = valo.METHODES.includes(req.query.methode) ? req.query.methode : undefined;
  res.json(await valo.valoriserTout(db, req.user.tenantId, { au: req.query.au, methode }));
}));

// Seuil d'alerte d'un produit (null = seuil par defaut)
router.patch("/produits/:id/seuil", gerer(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: t(req, "PRODUIT_NOT_FOUND") });
  const brut = req.body ? req.body.seuil_alerte : null;
  let seuil = null;
  if (brut !== null && brut !== "" && brut !== undefined) {
    seuil = Number(brut);
    if (!Number.isFinite(seuil) || seuil < 0 || seuil > 1e9) return res.status(400).json({ error: t(req, "STOCK_SEUIL_INVALIDE") });
  }
  const r = await db.query(`UPDATE produit SET seuil_alerte = $3 WHERE id = $1 AND tenant_id = $2 RETURNING id, seuil_alerte`, [req.params.id, req.user.tenantId, seuil]);
  if (r.rows.length === 0) return res.status(404).json({ error: t(req, "PRODUIT_NOT_FOUND") });
  res.json({ id: r.rows[0].id, seuil_alerte: r.rows[0].seuil_alerte === null ? null : Number(r.rows[0].seuil_alerte) });
}));

// --- Journal des mouvements ---------------------------------------------------------------
router.get("/mouvements", gerer(async (req, res) => {
  const cond = ["m.tenant_id = $1"];
  const val = [req.user.tenantId];
  if (req.query.produit_id && UUID_RE.test(String(req.query.produit_id))) { val.push(req.query.produit_id); cond.push(`m.produit_id = $${val.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.du || ""))) { val.push(req.query.du); cond.push(`m.date_mouvement >= $${val.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.au || ""))) { val.push(req.query.au); cond.push(`m.date_mouvement <= $${val.length}`); }
  if (["ENTREE", "SORTIE", "AJUSTEMENT", "ANNULATION"].includes(req.query.type)) { val.push(req.query.type); cond.push(`m.type_mouvement = $${val.length}`); }
  const r = await db.query(
    `SELECT m.id, m.date_mouvement, m.type_mouvement, m.quantite, m.cout_unitaire_xof, m.origine_type, m.libelle, p.reference, p.designation
     FROM mouvement_stock m JOIN produit p ON p.id = m.produit_id WHERE ${cond.join(" AND ")}
     ORDER BY m.date_mouvement DESC, m.date_creation DESC LIMIT 500`,
    val
  );
  res.json({
    mouvements: r.rows.map((m) => ({
      ...m, date_mouvement: String(m.date_mouvement instanceof Date ? new Date(m.date_mouvement.getTime() - m.date_mouvement.getTimezoneOffset() * 60000).toISOString() : m.date_mouvement).slice(0, 10),
      quantite: Number(m.quantite), cout_unitaire_xof: m.cout_unitaire_xof === null ? null : Number(m.cout_unitaire_xof),
    })),
  });
}));

// --- Inventaires --------------------------------------------------------------------------
router.get("/inventaires", gerer(async (req, res) => res.json({ inventaires: await inventaire.lister(req.user.tenantId) })));
router.post("/inventaires", gerer(async (req, res) => res.status(201).json(await inventaire.creer({ tenantId: req.user.tenantId, sub: req.user.sub }, req.body || {}))));
router.get("/inventaires/:id", gerer(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: t(req, "INVENTAIRE_INTROUVABLE") });
  res.json(await inventaire.detail(req.user.tenantId, req.params.id));
}));
router.put("/inventaires/:id/lignes", gerer(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: t(req, "INVENTAIRE_INTROUVABLE") });
  res.json(await inventaire.saisir(req.user.tenantId, req.params.id, (req.body || {}).lignes));
}));
router.post("/inventaires/:id/valider", gerer(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: t(req, "INVENTAIRE_INTROUVABLE") });
  if (!estGestionnaire(req)) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  res.json(await inventaire.valider({ tenantId: req.user.tenantId, sub: req.user.sub }, req.params.id));
}));
router.post("/inventaires/:id/annuler", gerer(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: t(req, "INVENTAIRE_INTROUVABLE") });
  res.json(await inventaire.annuler(req.user.tenantId, req.params.id));
}));

module.exports = router;
