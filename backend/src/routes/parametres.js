const express = require("express");
const multer = require("multer");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);

// Logo tenant, utilise sur les documents imprimables du module Ventes
// (devis/facture/BL). Pas de stockage cloud (S3 ou equivalent) configure
// sur cette plateforme (voir routes/extraction.js) : le logo est stocke
// directement en base, encode en base64, taille limitee cote applicatif
// pour ne pas alourdir la table tenant outre mesure.
const MIMETYPES_LOGO_ACCEPTES = ["image/png", "image/jpeg"];
const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 Mo
});

// Convertit une erreur Multer (ex : fichier trop volumineux) en reponse JSON
// claire, au lieu de la laisser remonter jusqu'au gestionnaire d'erreur
// generique de index.js (message non specifique "Erreur serveur inattendue").
// Necessaire car un multer.MulterError leve pendant le parsing du flux
// multipart survient AVANT le try/catch de la route - il faut l'intercepter
// en enveloppant upload.single(...) plutot que de l'utiliser tel quel comme
// middleware de route (bug reel rencontre le 05/09/2026 : upload d'un vrai
// logo > 2 Mo renvoyait un message generique et illisible pour l'utilisateur).
function televerserLogo(middlewareMulter) {
  return (req, res, next) => {
    middlewareMulter(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ error: t(req, "VENTE_LOGO_TOO_LARGE") });
        }
        console.error(err);
        return res.status(500).json({ error: t(req, "VENTE_LOGO_UPLOAD_ERROR") });
      }
      next();
    });
  };
}

// GET /api/parametres/entete
router.get("/entete", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT raison_sociale, adresse, telephone, email, signataire_nom, signataire_titre,
              rccm, ninea, site_web, coordonnees_bancaires
       FROM tenant WHERE id = $1`,
      [req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "ENTETE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "ENTETE_FETCH_ERROR") });
  }
});

// PATCH /api/parametres/entete
router.patch("/entete", async (req, res) => {
  const {
    raison_sociale,
    adresse,
    telephone,
    email,
    signataire_nom,
    signataire_titre,
    rccm,
    ninea,
    site_web,
    coordonnees_bancaires,
  } = req.body;
  try {
    const result = await db.query(
      `UPDATE tenant
       SET raison_sociale = COALESCE($1, raison_sociale),
           adresse = $2,
           telephone = $3,
           email = $4,
           signataire_nom = $5,
           signataire_titre = $6,
           rccm = $7,
           ninea = $8,
           site_web = $9,
           coordonnees_bancaires = $10
       WHERE id = $11
       RETURNING raison_sociale, adresse, telephone, email, signataire_nom, signataire_titre,
                 rccm, ninea, site_web, coordonnees_bancaires`,
      [
        raison_sociale || null,
        adresse || null,
        telephone || null,
        email || null,
        signataire_nom || null,
        signataire_titre || null,
        rccm || null,
        ninea || null,
        site_web || null,
        coordonnees_bancaires || null,
        req.user.tenantId,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "ENTETE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "ENTETE_UPDATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Parametres du module Ventes : taux de TVA systematique + logo, utilises
// automatiquement sur chaque devis/facture (voir routes/ventes.js). Reserve
// a ADMIN : ce sont des parametres globaux au tenant, pas une donnee
// operationnelle du quotidien.
// ----------------------------------------------------------------------------

// GET /api/parametres/ventes
router.get("/ventes", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT taux_tva_pourcentage, logo_base64, logo_type_mime,
              signature_cachet_base64, signature_cachet_type_mime
       FROM tenant WHERE id = $1`,
      [req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "VENTE_PARAMETRES_FETCH_ERROR") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_PARAMETRES_FETCH_ERROR") });
  }
});

// PATCH /api/parametres/ventes - taux de TVA
router.patch("/ventes", requireRole("ADMIN"), async (req, res) => {
  const { taux_tva_pourcentage } = req.body;
  const taux = Number(taux_tva_pourcentage);
  if (!Number.isFinite(taux) || taux < 0 || taux > 100) {
    return res.status(400).json({ error: t(req, "VENTE_TAUX_TVA_INVALID") });
  }
  try {
    const result = await db.query(
      `UPDATE tenant SET taux_tva_pourcentage = $1 WHERE id = $2
       RETURNING taux_tva_pourcentage, logo_base64, logo_type_mime,
                 signature_cachet_base64, signature_cachet_type_mime`,
      [taux, req.user.tenantId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_PARAMETRES_UPDATE_ERROR") });
  }
});

// POST /api/parametres/ventes/logo
router.post("/ventes/logo", requireRole("ADMIN"), televerserLogo(uploadLogo.single("logo")), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: t(req, "VENTE_LOGO_FILE_REQUIRED") });
  }
  if (!MIMETYPES_LOGO_ACCEPTES.includes(req.file.mimetype)) {
    return res.status(400).json({ error: t(req, "VENTE_LOGO_TYPE_INVALID") });
  }
  try {
    const base64 = req.file.buffer.toString("base64");
    const result = await db.query(
      `UPDATE tenant SET logo_base64 = $1, logo_type_mime = $2 WHERE id = $3
       RETURNING taux_tva_pourcentage, logo_base64, logo_type_mime,
                 signature_cachet_base64, signature_cachet_type_mime`,
      [base64, req.file.mimetype, req.user.tenantId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_LOGO_UPLOAD_ERROR") });
  }
});

// DELETE /api/parametres/ventes/logo
router.delete("/ventes/logo", requireRole("ADMIN"), async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE tenant SET logo_base64 = NULL, logo_type_mime = NULL WHERE id = $1
       RETURNING taux_tva_pourcentage, logo_base64, logo_type_mime,
                 signature_cachet_base64, signature_cachet_type_mime`,
      [req.user.tenantId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_LOGO_UPLOAD_ERROR") });
  }
});

// POST /api/parametres/ventes/signature-cachet - signature + cachet du
// tenant, affiches sous le nom du signataire sur les devis/factures/BL
// imprimes. Une seule image (le cachet papier est scanne avec la signature
// dessus dans l'usage reel, pas deux champs separes) - meme convention que
// les factures Super Admin (migration 022). Reutilise le meme multer/wrapper
// que le logo ci-dessus (2 Mo, PNG/JPEG uniquement).
router.post(
  "/ventes/signature-cachet",
  requireRole("ADMIN"),
  televerserLogo(uploadLogo.single("signature_cachet")),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: t(req, "VENTE_SIGNATURE_CACHET_FILE_REQUIRED") });
    }
    if (!MIMETYPES_LOGO_ACCEPTES.includes(req.file.mimetype)) {
      return res.status(400).json({ error: t(req, "VENTE_LOGO_TYPE_INVALID") });
    }
    try {
      const base64 = req.file.buffer.toString("base64");
      const result = await db.query(
        `UPDATE tenant SET signature_cachet_base64 = $1, signature_cachet_type_mime = $2 WHERE id = $3
         RETURNING taux_tva_pourcentage, logo_base64, logo_type_mime, signature_cachet_base64, signature_cachet_type_mime`,
        [base64, req.file.mimetype, req.user.tenantId]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: t(req, "VENTE_LOGO_UPLOAD_ERROR") });
    }
  }
);

// DELETE /api/parametres/ventes/signature-cachet
router.delete("/ventes/signature-cachet", requireRole("ADMIN"), async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE tenant SET signature_cachet_base64 = NULL, signature_cachet_type_mime = NULL WHERE id = $1
       RETURNING taux_tva_pourcentage, logo_base64, logo_type_mime, signature_cachet_base64, signature_cachet_type_mime`,
      [req.user.tenantId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_LOGO_UPLOAD_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Parametres du "Dossier de calcul" (prix de revient et marge) : taux de
// douane, change, commissions bancaires... utilises par
// services/calculPrixEngine.js. Reserve a ADMIN (comme le taux de TVA
// Ventes ci-dessus) - la TVA appliquee au prix de vente n'est PAS dupliquee
// ici, elle reste `tenant.taux_tva_pourcentage` (voir GET/PATCH
// /parametres/ventes) pour rester toujours identique au reste de la
// plateforme, comme demande par Steeve dans le prototype Excel valide.
// ----------------------------------------------------------------------------

const CLES_PARAMETRES_CALCUL_PRIX = [
  "tauxDroitDouane",
  "tauxRedevanceStatistique",
  "tauxPCS",
  "tauxPCC",
  "tauxCOSEC",
  "tauxTvaImport",
  "tauxAssuranceFret",
  "margeCibleDefaut",
  "pariteEurXof",
  "tauxCommissionTTHU",
  "tauxCommissionDBS",
  "commissionDbsMinimum",
  "tauxTAF",
  "forfaitSwift",
  "forfaitTimbre",
  "forfaitAutresFraisVirement",
  "tauxAutresFraisVirement",
  "refacturerFraisPaiement",
];

// GET /api/parametres/calcul-prix
router.get("/calcul-prix", async (req, res) => {
  try {
    const result = await db.query(`SELECT parametres_calcul_prix_json FROM tenant WHERE id = $1`, [
      req.user.tenantId,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "CALCUL_PARAMETRES_FETCH_ERROR") });
    }
    res.json(result.rows[0].parametres_calcul_prix_json);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CALCUL_PARAMETRES_FETCH_ERROR") });
  }
});

// PATCH /api/parametres/calcul-prix - mise a jour partielle (fusion JSONB) :
// seules les cles presentes dans le corps sont modifiees, valeurs
// numeriques >= 0 uniquement (un taux exprime en decimal, ex 0.20 pour 20%
// - jamais en pourcentage brut, coherent avec le reste du moteur de calcul).
router.patch("/calcul-prix", requireRole("ADMIN"), async (req, res) => {
  const misesAJour = {};
  for (const cle of CLES_PARAMETRES_CALCUL_PRIX) {
    if (req.body[cle] === undefined) continue;
    const valeur = Number(req.body[cle]);
    if (!Number.isFinite(valeur) || valeur < 0 || (cle === "refacturerFraisPaiement" && valeur !== 0 && valeur !== 1)) {
      return res.status(400).json({ error: t(req, "CALCUL_PARAMETRES_INVALID") });
    }
    misesAJour[cle] = valeur;
  }
  try {
    const result = await db.query(
      `UPDATE tenant SET parametres_calcul_prix_json = parametres_calcul_prix_json || $1::jsonb
       WHERE id = $2 RETURNING parametres_calcul_prix_json`,
      [JSON.stringify(misesAJour), req.user.tenantId]
    );
    res.json(result.rows[0].parametres_calcul_prix_json);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CALCUL_PARAMETRES_UPDATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Profil d'activite (migration 068) : MARCHES | NEGOCE | LES_DEUX. Adapte le menu
// et les libelles (NEGOCE : « Ventes », sans Appel d'offres ni Dossiers). Ne change
// aucune permission. Modifiable par l'ADMIN du client (et par le Super Admin).
// ----------------------------------------------------------------------------

const PROFILS_ACTIVITE = ["MARCHES", "NEGOCE", "LES_DEUX"];

router.get("/profil-activite", async (req, res) => {
  try {
    const r = await db.query(`SELECT profil_activite FROM tenant WHERE id = $1`, [req.user.tenantId]);
    res.json({ profil_activite: (r.rows[0] && r.rows[0].profil_activite) || "LES_DEUX" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CALCUL_PARAMETRES_FETCH_ERROR") });
  }
});

router.patch("/profil-activite", requireRole("ADMIN"), async (req, res) => {
  const profil = req.body && req.body.profil_activite;
  if (!PROFILS_ACTIVITE.includes(profil)) {
    return res.status(400).json({ error: t(req, "PROFIL_ACTIVITE_INVALIDE") });
  }
  try {
    await db.query(`UPDATE tenant SET profil_activite = $1 WHERE id = $2`, [profil, req.user.tenantId]);
    res.json({ profil_activite: profil });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CALCUL_PARAMETRES_UPDATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Reprise de numerotation (Devis / Facture-BL) : permet a un tenant qui avait
// deja une sequence utilisee ailleurs (ex Excel) de renseigner le dernier
// numero deja utilise, pour que le prochain document genere continue a partir
// de la. Reserve a ADMIN (parametre global au tenant, comme le taux de TVA
// Ventes ci-dessus). "VENTE" est le compteur partage Facture/BL (voir
// routes/ventes.js, tirerProchainNumero).
// ----------------------------------------------------------------------------

async function chargerCompteurs(tenantId, annee) {
  const result = await db.query(
    `SELECT type_compteur, dernier_numero FROM compteur_numerotation
     WHERE tenant_id = $1 AND annee = $2 AND type_compteur IN ('DEVIS','VENTE')`,
    [tenantId, annee]
  );
  const parType = {};
  result.rows.forEach((r) => { parType[r.type_compteur] = r.dernier_numero; });
  return {
    annee,
    dernier_numero_devis: parType.DEVIS || 0,
    dernier_numero_vente: parType.VENTE || 0,
  };
}

// GET /api/parametres/numerotation
router.get("/numerotation", requireRole("ADMIN"), async (req, res) => {
  try {
    const annee = new Date().getFullYear();
    res.json(await chargerCompteurs(req.user.tenantId, annee));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "NUMEROTATION_FETCH_ERROR") });
  }
});

// PATCH /api/parametres/numerotation - definit un numero de depart pour
// l'annee en cours. Bloque toute baisse par rapport au numero deja
// enregistre (evite tout risque de doublon futur si on se trompe de sens).
router.patch("/numerotation", requireRole("ADMIN"), async (req, res) => {
  const { dernier_numero_devis, dernier_numero_vente } = req.body;
  const annee = new Date().getFullYear();
  const misesAJour = [
    dernier_numero_devis !== undefined ? { type: "DEVIS", valeur: Number(dernier_numero_devis) } : null,
    dernier_numero_vente !== undefined ? { type: "VENTE", valeur: Number(dernier_numero_vente) } : null,
  ].filter(Boolean);

  if (misesAJour.length === 0) {
    return res.status(400).json({ error: t(req, "NUMEROTATION_FIELDS_REQUIRED") });
  }
  for (const { valeur } of misesAJour) {
    if (!Number.isInteger(valeur) || valeur < 0) {
      return res.status(400).json({ error: t(req, "NUMEROTATION_INVALID") });
    }
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    for (const { type, valeur } of misesAJour) {
      await client.query(
        `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
        [req.user.tenantId, type, annee]
      );
      const actuel = await client.query(
        `SELECT dernier_numero FROM compteur_numerotation
         WHERE tenant_id = $1 AND type_compteur = $2 AND annee = $3 FOR UPDATE`,
        [req.user.tenantId, type, annee]
      );
      if (valeur < actuel.rows[0].dernier_numero) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: t(req, "NUMEROTATION_BAISSE_INTERDITE") });
      }
      await client.query(
        `UPDATE compteur_numerotation SET dernier_numero = $1
         WHERE tenant_id = $2 AND type_compteur = $3 AND annee = $4`,
        [valeur, req.user.tenantId, type, annee]
      );
    }
    await client.query("COMMIT");
    res.json(await chargerCompteurs(req.user.tenantId, annee));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "NUMEROTATION_UPDATE_ERROR") });
  } finally {
    client.release();
  }
});

module.exports = router;
