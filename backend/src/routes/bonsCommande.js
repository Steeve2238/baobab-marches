const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { requireAuth, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");

// ----------------------------------------------------------------------------
// Bons de commande (Pack Commerce, lot 4) — migration 074.
//  * BC client : reference + date saisies sur le devis (recopiees sur les
//    factures), scan archive en piece jointe.
//  * BC fournisseur : pieces jointes (BC signe retourne par le fournisseur).
// Les pieces sont stockees en base (PDF / images, 5 Mo max, 10 par element).
// ----------------------------------------------------------------------------
const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => {
  const p = req.user?.permissions;
  if (!p) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  if (p.admin || p.tableauDeBord) return next();
  if ((p.modules || []).some((m) => m === "marches" || m === "fournisseurs")) return next();
  return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TAILLE_MAX = 5 * 1024 * 1024;
const MAX_PIECES = 10;
const TYPES_ACCEPTES = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: TAILLE_MAX } });

const ENTITES = {
  DEVIS_BC_CLIENT: { table: "devis", modules: ["marches"] },
  COMMANDE_FOURNISSEUR: { table: "commande_fournisseur", modules: ["fournisseurs", "marches"] },
};

function entiteAutorisee(req, type) {
  const def = ENTITES[type];
  if (!def) return null;
  const p = req.user.permissions;
  if (p.admin || p.tableauDeBord) return def;
  return (p.modules || []).some((m) => def.modules.includes(m)) ? def : null;
}

function gerer(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: t(req, "BC_ERREUR") });
    }
  };
}

// --- BC client sur le devis --------------------------------------------------
router.patch(
  "/client/devis/:id",
  blockLectureSeule,
  gerer(async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "VENTE_DEVIS_NOT_FOUND") });
    const reference = String(req.body.reference_bc_client || "").trim().slice(0, 120) || null;
    const dateBc = req.body.date_bc_client || null;
    if (dateBc && !DATE_RE.test(dateBc)) return res.status(400).json({ error: t(req, "BC_DATE_INVALIDE") });
    const r = await db.query(
      `UPDATE devis SET reference_bc_client = $3, date_bc_client = $4 WHERE id = $1 AND tenant_id = $2 RETURNING id, reference_bc_client, date_bc_client`,
      [id, req.user.tenantId, reference, dateBc]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: t(req, "VENTE_DEVIS_NOT_FOUND") });
    res.json(r.rows[0]);
  })
);

// --- Pieces jointes ----------------------------------------------------------
router.get(
  "/pieces/:type/:id",
  gerer(async (req, res) => {
    const def = entiteAutorisee(req, req.params.type);
    if (!def || !UUID_RE.test(req.params.id)) return res.status(404).json({ error: t(req, "BC_PIECE_INTROUVABLE") });
    const r = await db.query(
      `SELECT p.id, p.nom_fichier, p.type_mime, p.taille, p.date_creation, u.prenom, u.nom
       FROM piece_jointe p LEFT JOIN utilisateur u ON u.id = p.cree_par
       WHERE p.tenant_id = $1 AND p.entite_type = $2 AND p.entite_id = $3 ORDER BY p.date_creation`,
      [req.user.tenantId, req.params.type, req.params.id]
    );
    res.json({
      pieces: r.rows.map((p) => ({ id: p.id, nom_fichier: p.nom_fichier, type_mime: p.type_mime, taille: p.taille, date_creation: p.date_creation, ajoute_par: [p.prenom, p.nom].filter(Boolean).join(" ") || null })),
    });
  })
);

router.post(
  "/pieces/:type/:id",
  blockLectureSeule,
  (req, res, next) =>
    upload.single("fichier")(req, res, (err) => {
      if (err) return res.status(400).json({ error: t(req, err.code === "LIMIT_FILE_SIZE" ? "BC_PIECE_TROP_GROSSE" : "BC_ERREUR") });
      next();
    }),
  gerer(async (req, res) => {
    const { type, id } = req.params;
    const def = entiteAutorisee(req, type);
    if (!def || !UUID_RE.test(id)) return res.status(404).json({ error: t(req, "BC_PIECE_INTROUVABLE") });
    if (!req.file) return res.status(400).json({ error: t(req, "BC_PIECE_FICHIER_REQUIS") });
    if (!TYPES_ACCEPTES[req.file.mimetype]) return res.status(400).json({ error: t(req, "BC_PIECE_TYPE_REFUSE") });
    const e = await db.query(`SELECT id FROM ${def.table} WHERE id = $1 AND tenant_id = $2`, [id, req.user.tenantId]);
    if (e.rows.length === 0) return res.status(404).json({ error: t(req, "BC_PIECE_INTROUVABLE") });
    const n = await db.query(`SELECT COUNT(*)::int AS n FROM piece_jointe WHERE tenant_id = $1 AND entite_type = $2 AND entite_id = $3`, [req.user.tenantId, type, id]);
    if (n.rows[0].n >= MAX_PIECES) return res.status(400).json({ error: t(req, "BC_PIECE_TROP_NOMBREUSES") });
    // multer lit le nom en latin1 : on le retablit en UTF-8 (accents).
    const nom = Buffer.from(req.file.originalname, "latin1").toString("utf8").replace(/[\\/\r\n"]/g, "_").slice(0, 160);
    const r = await db.query(
      `INSERT INTO piece_jointe (id, tenant_id, entite_type, entite_id, nom_fichier, type_mime, taille, contenu, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, nom_fichier, type_mime, taille, date_creation`,
      [uuidv4(), req.user.tenantId, type, id, nom, req.file.mimetype, req.file.size, req.file.buffer, req.user.sub]
    );
    res.status(201).json(r.rows[0]);
  })
);

router.get(
  "/fichier/:pieceId",
  gerer(async (req, res) => {
    if (!UUID_RE.test(req.params.pieceId)) return res.status(404).json({ error: t(req, "BC_PIECE_INTROUVABLE") });
    const r = await db.query(`SELECT * FROM piece_jointe WHERE id = $1 AND tenant_id = $2`, [req.params.pieceId, req.user.tenantId]);
    const p = r.rows[0];
    if (!p || !entiteAutorisee(req, p.entite_type)) return res.status(404).json({ error: t(req, "BC_PIECE_INTROUVABLE") });
    res.setHeader("Content-Type", p.type_mime);
    res.setHeader("Content-Disposition", `${req.query.telecharger === "1" ? "attachment" : "inline"}; filename="${p.nom_fichier.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(p.nom_fichier)}`);
    res.send(p.contenu);
  })
);

router.delete(
  "/fichier/:pieceId",
  blockLectureSeule,
  gerer(async (req, res) => {
    if (!UUID_RE.test(req.params.pieceId)) return res.status(404).json({ error: t(req, "BC_PIECE_INTROUVABLE") });
    const r = await db.query(`SELECT entite_type FROM piece_jointe WHERE id = $1 AND tenant_id = $2`, [req.params.pieceId, req.user.tenantId]);
    if (r.rows.length === 0 || !entiteAutorisee(req, r.rows[0].entite_type)) return res.status(404).json({ error: t(req, "BC_PIECE_INTROUVABLE") });
    await db.query(`DELETE FROM piece_jointe WHERE id = $1 AND tenant_id = $2`, [req.params.pieceId, req.user.tenantId]);
    res.json({ ok: true });
  })
);

module.exports = router;
