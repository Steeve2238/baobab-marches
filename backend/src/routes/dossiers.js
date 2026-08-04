const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);

// GET /api/dossiers - liste des dossiers du tenant courant
router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT d.id, d.reference_externe, d.intitule, d.secteur, d.montant_estime,
              d.devise, d.date_limite_soumission, d.statut,
              mo.nom AS maitre_ouvrage_nom
       FROM dossier_ao d
       LEFT JOIN maitre_ouvrage mo ON mo.id = d.maitre_ouvrage_id
       WHERE d.tenant_id = $1
       ORDER BY d.date_limite_soumission ASC NULLS LAST`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "DOSSIERS_FETCH_ERROR") });
  }
});

// GET /api/dossiers/:id - detail complet (dossier + clauses + chronogramme)
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const dossierResult = await db.query(
      `SELECT d.*, mo.nom AS maitre_ouvrage_nom
       FROM dossier_ao d
       LEFT JOIN maitre_ouvrage mo ON mo.id = d.maitre_ouvrage_id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [id, req.user.tenantId]
    );
    const dossier = dossierResult.rows[0];
    if (!dossier) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }

    const clausesResult = await db.query(
      `SELECT * FROM clause_extraite WHERE dossier_ao_id = $1 ORDER BY date_extraction ASC`,
      [id]
    );

    const chronogrammeResult = await db.query(
      `SELECT c.*, r.code AS role_code, r.libelle AS role_libelle
       FROM chronogramme_tache c
       LEFT JOIN role r ON r.id = c.role_porteur_id
       WHERE c.dossier_ao_id = $1
       ORDER BY c.ordre_affichage ASC`,
      [id]
    );

    res.json({
      ...dossier,
      clauses: clausesResult.rows,
      chronogramme: chronogrammeResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "DOSSIER_FETCH_ERROR") });
  }
});

// POST /api/dossiers - creation manuelle (l'extraction automatique alimentera
// ce meme endpoint dans une iteration ulterieure)
router.post("/", async (req, res) => {
  const {
    reference_externe,
    intitule,
    maitre_ouvrage_id,
    secteur,
    montant_estime,
    devise,
    date_limite_soumission,
  } = req.body;

  if (!intitule) {
    return res.status(400).json({ error: t(req, "DOSSIER_INTITULE_REQUIRED") });
  }

  try {
    const result = await db.query(
      `INSERT INTO dossier_ao
         (tenant_id, reference_externe, intitule, maitre_ouvrage_id, secteur,
          montant_estime, devise, date_limite_soumission, statut)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ANALYSE')
       RETURNING *`,
      [
        req.user.tenantId,
        reference_externe || null,
        intitule,
        maitre_ouvrage_id || null,
        secteur || null,
        montant_estime || null,
        devise || "XOF",
        date_limite_soumission || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "DOSSIER_CREATE_ERROR") });
  }
});

// PATCH /api/dossiers/:id/statut - changement de statut (workflow go/no-go...)
router.patch("/:id/statut", async (req, res) => {
  const { id } = req.params;
  const { statut } = req.body;
  const statutsValides = [
    "ANALYSE", "GO", "NO_GO", "SOUMIS", "ATTRIBUE",
    "NON_ATTRIBUE", "EN_EXECUTION", "RECEPTION", "CLOTURE",
  ];
  if (!statutsValides.includes(statut)) {
    return res.status(400).json({ error: t(req, "STATUT_INVALID") });
  }

  try {
    const result = await db.query(
      `UPDATE dossier_ao SET statut = $1
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [statut, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "DOSSIER_STATUT_UPDATE_ERROR") });
  }
});

module.exports = router;
