const express = require("express");
const db = require("../db");
const { requireAuth, requireModule, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { evaluerEcartMarge } = require("../services/anticipationEngine");

const router = express.Router();
router.use(requireAuth);
router.use(requireModule("dossiers"));
router.use(blockLectureSeule);

/**
 * Calcule le cout de revient et la marge a partir des composantes saisies.
 * Contrairement au Module 2 (financement), cette structure de calcul est
 * un schema comptable stable (pas une clause contractuelle variable par
 * marche) : elle n'a donc pas besoin de passer par le moteur de regles.
 */
function calculerDerives(champs) {
  const {
    prix_achat_devise,
    taux_change,
    prix_cif,
    frais_douane_transit,
    frais_bancaires,
    frais_dao_caution,
    redevance_armp,
    marge_pct_visee,
    prix_final_ht_hd,
  } = champs;

  const prixCifCalcule =
    prix_cif != null
      ? Number(prix_cif)
      : prix_achat_devise != null && taux_change != null
      ? Number(prix_achat_devise) * Number(taux_change)
      : null;

  const cout_revient =
    prixCifCalcule != null
      ? prixCifCalcule +
        Number(frais_douane_transit || 0) +
        Number(frais_bancaires || 0) +
        Number(frais_dao_caution || 0) +
        Number(redevance_armp || 0)
      : null;

  const marge_pct_reelle =
    prix_final_ht_hd != null && cout_revient != null && Number(prix_final_ht_hd) !== 0
      ? Math.round(
          ((Number(prix_final_ht_hd) - cout_revient) / Number(prix_final_ht_hd)) * 100 * 100
        ) / 100
      : null;

  return {
    prix_cif: prixCifCalcule,
    cout_revient: cout_revient != null ? Math.round(cout_revient * 100) / 100 : null,
    marge_pct_reelle,
    marge_pct_visee: marge_pct_visee != null ? Number(marge_pct_visee) : null,
  };
}

// GET /api/marge/dossiers/:dossierId - historique des calculs de marge du dossier
router.get("/dossiers/:dossierId", async (req, res) => {
  const { dossierId } = req.params;
  try {
    const dossierCheck = await db.query(
      `SELECT id FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    if (dossierCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }

    const result = await db.query(
      `SELECT * FROM calcul_marge WHERE dossier_ao_id = $1 ORDER BY date_calcul DESC`,
      [dossierId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "MARGE_FETCH_ERROR") });
  }
});

// POST /api/marge/dossiers/:dossierId - nouveau calcul de marge
router.post("/dossiers/:dossierId", async (req, res) => {
  const { dossierId } = req.params;
  const champs = req.body;

  try {
    const dossierCheck = await db.query(
      `SELECT id, intitule FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    if (dossierCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }

    const derives = calculerDerives(champs);

    const result = await db.query(
      `INSERT INTO calcul_marge
         (dossier_ao_id, prix_achat_devise, taux_change, prix_cif, frais_douane_transit,
          frais_bancaires, frais_dao_caution, redevance_armp, cout_revient,
          marge_pct_visee, marge_pct_reelle, prix_final_ht_hd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        dossierId,
        champs.prix_achat_devise || null,
        champs.taux_change || null,
        derives.prix_cif,
        champs.frais_douane_transit || null,
        champs.frais_bancaires || null,
        champs.frais_dao_caution || null,
        champs.redevance_armp || null,
        derives.cout_revient,
        derives.marge_pct_visee,
        derives.marge_pct_reelle,
        champs.prix_final_ht_hd || null,
      ]
    );

    await evaluerEcartMarge({
      tenantId: req.user.tenantId,
      dossierId,
      dossierIntitule: dossierCheck.rows[0].intitule,
      margePctVisee: derives.marge_pct_visee,
      margePctReelle: derives.marge_pct_reelle,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "MARGE_CREATE_ERROR") });
  }
});

// PATCH /api/marge/:id - mise a jour d'un calcul existant (ex: marge reelle
// qui evolue au fil de l'execution -> alimente le Radar d'anticipation, Module 15)
router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const champs = req.body;

  try {
    const existant = await db.query(
      `SELECT cm.*, d.intitule AS dossier_intitule FROM calcul_marge cm
       JOIN dossier_ao d ON d.id = cm.dossier_ao_id
       WHERE cm.id = $1 AND d.tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (existant.rows.length === 0) {
      return res.status(404).json({ error: t(req, "MARGE_NOT_FOUND") });
    }

    const fusion = { ...existant.rows[0], ...champs };
    const derives = calculerDerives(fusion);

    const result = await db.query(
      `UPDATE calcul_marge
       SET prix_achat_devise = $1, taux_change = $2, prix_cif = $3, frais_douane_transit = $4,
           frais_bancaires = $5, frais_dao_caution = $6, redevance_armp = $7, cout_revient = $8,
           marge_pct_visee = $9, marge_pct_reelle = $10, prix_final_ht_hd = $11
       WHERE id = $12
       RETURNING *`,
      [
        fusion.prix_achat_devise || null,
        fusion.taux_change || null,
        derives.prix_cif,
        fusion.frais_douane_transit || null,
        fusion.frais_bancaires || null,
        fusion.frais_dao_caution || null,
        fusion.redevance_armp || null,
        derives.cout_revient,
        derives.marge_pct_visee,
        derives.marge_pct_reelle,
        fusion.prix_final_ht_hd || null,
        id,
      ]
    );

    await evaluerEcartMarge({
      tenantId: req.user.tenantId,
      dossierId: existant.rows[0].dossier_ao_id,
      dossierIntitule: existant.rows[0].dossier_intitule,
      margePctVisee: derives.marge_pct_visee,
      margePctReelle: derives.marge_pct_reelle,
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "MARGE_UPDATE_ERROR") });
  }
});

module.exports = router;
