const express = require("express");
const multer = require("multer");
const db = require("../db");
const { requireAuth, requireModule, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { extraireTexteFichier, extraireClauses } = require("../services/extractionEngine");

const router = express.Router();
router.use(requireAuth);
router.use(requireModule("dossiers"));
router.use(blockLectureSeule);

const MIMETYPES_ACCEPTES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

// Stockage en memoire uniquement : le fichier est lu, son texte est extrait,
// puis le buffer est jete. Aucun stockage cloud (S3 ou equivalent) n'est
// configure pour l'instant sur Railway - seul le NOM du fichier est
// conserve (dossier_ao.fichier_dao_url) a titre de tracabilite, pas le
// contenu. A revoir si Steeve veut un jour re-consulter le DAO original.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 Mo
});

// POST /api/extraction/dossiers/:dossierId/analyser
// Upload du DAO (PDF ou Word), extraction du texte puis des clauses
// candidates (voir services/extractionEngine.js). Les clauses sont
// enregistrees avec niveau_vigilance = 'A_VERIFIER' et
// valide_par_juridique = false : elles doivent etre validees, corrigees ou
// rejetees par un humain - voir PATCH/DELETE /clauses/:id ci-dessous.
router.post("/dossiers/:dossierId/analyser", upload.single("fichier"), async (req, res) => {
  const { dossierId } = req.params;

  if (!req.file) {
    return res.status(400).json({ error: t(req, "EXTRACTION_FILE_REQUIRED") });
  }
  if (!MIMETYPES_ACCEPTES.includes(req.file.mimetype)) {
    return res.status(400).json({ error: t(req, "EXTRACTION_FILE_TYPE_INVALID") });
  }

  try {
    const dossierCheck = await db.query(
      `SELECT id FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    if (dossierCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }

    const texte = await extraireTexteFichier(req.file.buffer, req.file.mimetype);
    const clausesCandidates = extraireClauses(texte);

    const clausesInserees = [];
    for (const clause of clausesCandidates) {
      const result = await db.query(
        `INSERT INTO clause_extraite
           (dossier_ao_id, type_clause, libelle, valeur_numerique, valeur_texte,
            article_reference, niveau_vigilance, valide_par_juridique)
         VALUES ($1, $2, $3, $4, $5, $6, 'A_VERIFIER', false)
         RETURNING *`,
        [
          dossierId,
          clause.type_clause,
          clause.libelle,
          clause.valeur_numerique,
          clause.valeur_texte,
          clause.article_reference,
        ]
      );
      clausesInserees.push(result.rows[0]);
    }

    await db.query(`UPDATE dossier_ao SET fichier_dao_url = $1 WHERE id = $2`, [
      req.file.originalname,
      dossierId,
    ]);

    res.status(201).json({
      nombre_clauses_detectees: clausesInserees.length,
      clauses: clausesInserees,
    });
  } catch (err) {
    console.error(err);
    if (err.message === "FORMAT_NON_SUPPORTE") {
      return res.status(400).json({ error: t(req, "EXTRACTION_FILE_TYPE_INVALID") });
    }
    res.status(500).json({ error: t(req, "EXTRACTION_ERROR") });
  }
});

// PATCH /api/extraction/clauses/:id - validation ou correction manuelle
// d'une clause extraite automatiquement. L'extraction n'est jamais
// consideree fiable sans ce passage humain (principe du Module 1 / futur
// Module 7 "intelligence juridique").
router.patch("/clauses/:id", async (req, res) => {
  const { id } = req.params;
  const { libelle, valeur_numerique, valeur_texte, niveau_vigilance, valide_par_juridique } = req.body;

  const niveauxValides = ["STANDARD", "A_VERIFIER", "RISQUE"];
  if (niveau_vigilance && !niveauxValides.includes(niveau_vigilance)) {
    return res.status(400).json({ error: t(req, "STATUT_INVALID") });
  }

  try {
    const result = await db.query(
      `UPDATE clause_extraite ce
       SET libelle = COALESCE($1, ce.libelle),
           valeur_numerique = COALESCE($2, ce.valeur_numerique),
           valeur_texte = COALESCE($3, ce.valeur_texte),
           niveau_vigilance = COALESCE($4, ce.niveau_vigilance),
           valide_par_juridique = COALESCE($5, ce.valide_par_juridique),
           valide_par_utilisateur_id = CASE
             WHEN $5 = true THEN $6
             ELSE ce.valide_par_utilisateur_id
           END
       FROM dossier_ao d
       WHERE ce.id = $7 AND ce.dossier_ao_id = d.id AND d.tenant_id = $8
       RETURNING ce.*`,
      [
        libelle || null,
        valeur_numerique != null ? valeur_numerique : null,
        valeur_texte || null,
        niveau_vigilance || null,
        valide_par_juridique != null ? valide_par_juridique : null,
        req.user.sub,
        id,
        req.user.tenantId,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "CLAUSE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CLAUSE_UPDATE_ERROR") });
  }
});

// DELETE /api/extraction/clauses/:id - rejet d'un faux positif d'extraction
router.delete("/clauses/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM clause_extraite ce
       USING dossier_ao d
       WHERE ce.id = $1 AND ce.dossier_ao_id = d.id AND d.tenant_id = $2
       RETURNING ce.id`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "CLAUSE_NOT_FOUND") });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CLAUSE_DELETE_ERROR") });
  }
});

module.exports = router;
