const express = require("express");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, requireModule, requireModuleAny, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);

// GET /api/dossiers/unifies - liste fusionnee Dossiers AO + Consultations
// restreintes (chantier du 02/10/2026, demande de Steeve : "l'interface
// dossier doit aussi bien faire apparaitre les marches restreint que les
// appels d'offres"). Positionnee AVANT le requireModule("dossiers") ci-dessous
// (qui s'applique a partir d'ici a toutes les routes suivantes de ce fichier),
// avec sa propre garde requireModuleAny("dossiers", "marches") : un
// utilisateur qui n'a que l'un des deux modules dans son perimetre doit quand
// meme pouvoir ouvrir cet ecran fusionne - il verra alors seulement les
// entrees du type auquel il a acces (filtre applique ci-dessous, independant
// de la garde de route qui elle ne fait qu'autoriser l'acces a l'ecran).
router.get("/unifies", requireModuleAny("dossiers", "marches"), async (req, res) => {
  const permissions = req.user.permissions;
  const accesAo = permissions.admin || permissions.modules.includes("dossiers") || permissions.tableauDeBord;
  const accesConsultation = permissions.admin || permissions.modules.includes("marches");

  try {
    const requetes = [];

    if (accesAo) {
      requetes.push(
        db.query(
          `SELECT d.id, 'AO' AS type_dossier, d.reference_externe, d.intitule,
                  d.montant_estime, d.devise, d.statut, d.date_limite_soumission,
                  mo.nom AS tiers_nom, d.date_limite_soumission AS date_tri
           FROM dossier_ao d
           LEFT JOIN maitre_ouvrage mo ON mo.id = d.maitre_ouvrage_id
           WHERE d.tenant_id = $1`,
          [req.user.tenantId]
        )
      );
    }
    if (accesConsultation) {
      requetes.push(
        db.query(
          `SELECT c.id, 'CONSULTATION' AS type_dossier, NULL AS reference_externe, c.objet AS intitule,
                  NULL::numeric AS montant_estime, 'XOF' AS devise, c.statut, c.date_limite_reponse AS date_limite_soumission,
                  cl.nom AS tiers_nom, COALESCE(c.date_limite_reponse, c.date_reception) AS date_tri
           FROM consultation c
           LEFT JOIN client_commercial cl ON cl.id = c.client_commercial_id
           WHERE c.tenant_id = $1`,
          [req.user.tenantId]
        )
      );
    }

    const resultats = await Promise.all(requetes);
    const lignes = resultats.flatMap((r) => r.rows);
    lignes.sort((a, b) => {
      if (!a.date_tri) return 1;
      if (!b.date_tri) return -1;
      return new Date(a.date_tri) - new Date(b.date_tri);
    });

    res.json(lignes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "DOSSIERS_FETCH_ERROR") });
  }
});

router.use(requireModule("dossiers"));
router.use(blockLectureSeule);

// GET /api/dossiers - liste des dossiers du tenant courant
router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT d.id, d.reference_externe, d.intitule, d.secteur, d.montant_estime,
              d.devise, d.date_limite_soumission, d.statut, d.date_creation,
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

    // Le statut EN_RETARD est toujours recalcule cote serveur a partir de la
    // date d'echeance (jamais fourni tel quel par le client) - meme principe
    // que suivi_logistique.statut_penalite (Module 3) : une tache en retard
    // doit se signaler seule, sans action manuelle prealable.
    await db.query(
      `UPDATE chronogramme_tache
       SET statut = 'EN_RETARD'
       WHERE dossier_ao_id = $1
         AND statut IN ('A_FAIRE', 'EN_COURS')
         AND date_echeance IS NOT NULL
         AND date_echeance < CURRENT_DATE`,
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
         (id, tenant_id, reference_externe, intitule, maitre_ouvrage_id, secteur,
          montant_estime, devise, date_limite_soumission, statut)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ANALYSE')
       RETURNING *`,
      [
        uuidv4(),
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

// Statuts a partir desquels les champs descriptifs du dossier restent
// modifiables (avant attribution du marche). Au-dela, le dossier est engage
// (attribue, execute, cloture...) et ses informations d'origine ne doivent
// plus bouger - seule la route de changement de statut ci-dessous reste
// ouverte, jamais celle-ci.
const STATUTS_MODIFIABLES = ["ANALYSE", "GO", "NO_GO", "SOUMIS"];

// PATCH /api/dossiers/:id - edition des champs descriptifs (hors statut, qui
// a sa propre route dediee ci-dessous). Signale par le premier client de la
// plateforme (rapport PDF, 24/09/2026) : aucune route ne permettait de
// corriger un dossier deja enregistre.
router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const {
    intitule,
    reference_externe,
    maitre_ouvrage_id,
    secteur,
    montant_estime,
    devise,
    date_limite_soumission,
  } = req.body;

  try {
    const dossierActuel = await db.query(
      `SELECT statut FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (dossierActuel.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }
    if (!STATUTS_MODIFIABLES.includes(dossierActuel.rows[0].statut)) {
      return res.status(409).json({ error: t(req, "DOSSIER_MODIFICATION_LOCKED") });
    }

    const result = await db.query(
      `UPDATE dossier_ao
       SET intitule = COALESCE($1, intitule),
           reference_externe = COALESCE($2, reference_externe),
           maitre_ouvrage_id = COALESCE($3, maitre_ouvrage_id),
           secteur = COALESCE($4, secteur),
           montant_estime = COALESCE($5, montant_estime),
           devise = COALESCE($6, devise),
           date_limite_soumission = COALESCE($7, date_limite_soumission)
       WHERE id = $8 AND tenant_id = $9
       RETURNING *`,
      [
        intitule || null,
        reference_externe || null,
        maitre_ouvrage_id || null,
        secteur || null,
        montant_estime || null,
        devise || null,
        date_limite_soumission || null,
        id,
        req.user.tenantId,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "DOSSIER_UPDATE_ERROR") });
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
