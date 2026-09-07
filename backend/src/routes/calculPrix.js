const express = require("express");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { calculerOffre } = require("../services/calculPrixEngine");

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------------------------
// Module "Dossier de calcul" (prix de revient et marge) - confirme avec
// Steeve le 07/09/2026 a partir de son propre tableau Excel (dossier
// CONSULTATION 26000/536/537 DN, prototype approuve "le tableau me
// convient"). Un dossier de calcul est rattache SOIT a un dossier d'appel
// d'offres (module "dossiers"), SOIT a une consultation restreinte (module
// "marches") - jamais les deux (voir contrainte CHECK,
// migrations/021_dossier_calcul.sql). L'acces est donc ouvert a quiconque a
// l'un OU l'autre de ces deux modules (ou le tableau de bord general, meme
// exception que requireModule("dossiers")) - pas de restriction plus fine
// par enregistrement, le controle de tenant se fait toujours au niveau des
// requetes SQL elles-memes.
// ----------------------------------------------------------------------------
router.use((req, res, next) => {
  const permissions = req.user?.permissions;
  if (!permissions) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  if (permissions.admin) return next();
  if (permissions.tableauDeBord) return next();
  if ((permissions.modules || []).some((m) => m === "marches" || m === "dossiers")) return next();
  return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
});
router.use(blockLectureSeule);

// ----------------------------------------------------------------------------
// Registres partenaires (fournisseur/transitaire) - REUTILISE les tables
// deja existantes (voir routes/fournisseurs.js et routes/logistique.js),
// aucune nouvelle table de repertoire ici (demande explicite de Steeve : pas
// de redondance). Ces deux routes de lecture/creation rapide sont
// dupliquees ICI (memes tables, memes colonnes) uniquement pour eviter
// d'exiger en plus les modules "fournisseurs"/"logistique" - un utilisateur
// qui a seulement "marches" (ex Assistante administrative sur les
// consultations) doit pouvoir choisir/ajouter un partenaire dans le tableau
// de calcul sans avoir besoin d'un acces au module Fournisseurs ou
// Logistique en tant que tel (meme piege que celui corrige le 07/09/2026
// dans routes/ventes.js - eviter de le reintroduire ici).
// ----------------------------------------------------------------------------

router.get("/fournisseurs", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nom, pays FROM fournisseur WHERE tenant_id = $1 ORDER BY nom ASC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "FOURNISSEURS_FETCH_ERROR") });
  }
});

router.post("/fournisseurs", async (req, res) => {
  const { nom, pays } = req.body;
  if (!nom || !nom.trim()) {
    return res.status(400).json({ error: t(req, "FOURNISSEUR_NOM_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO fournisseur (id, tenant_id, nom, pays) VALUES ($1, $2, $3, $4) RETURNING id, nom, pays`,
      [uuidv4(), req.user.tenantId, nom.trim(), pays || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "FOURNISSEUR_CREATE_ERROR") });
  }
});

router.get("/transitaires", async (req, res) => {
  try {
    const result = await db.query(`SELECT id, nom FROM transitaire WHERE tenant_id = $1 ORDER BY nom ASC`, [
      req.user.tenantId,
    ]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "TRANSITAIRES_FETCH_ERROR") });
  }
});

router.post("/transitaires", async (req, res) => {
  const { nom } = req.body;
  if (!nom || !nom.trim()) {
    return res.status(400).json({ error: t(req, "TRANSITAIRE_NOM_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO transitaire (id, tenant_id, nom, contact_json) VALUES ($1, $2, $3, $4) RETURNING id, nom`,
      [uuidv4(), req.user.tenantId, nom.trim(), {}]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "TRANSITAIRE_CREATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

// Contexte (client/objet ou reference/intitule) du parent d'un dossier de
// calcul, pour affichage - un seul des deux JOIN "matche" jamais selon le
// rattachement (contrainte CHECK garantit l'exclusivite dossier_ao_id /
// consultation_id).
const SELECT_DOSSIERS_CALCUL = `
  SELECT dc.*,
         d.reference_externe AS dossier_ao_reference, d.intitule AS dossier_ao_intitule,
         cl.nom AS consultation_client_nom, cons.objet AS consultation_objet
  FROM dossier_calcul dc
  LEFT JOIN dossier_ao d ON d.id = dc.dossier_ao_id
  LEFT JOIN consultation cons ON cons.id = dc.consultation_id
  LEFT JOIN client_commercial cl ON cl.id = cons.client_commercial_id
`;

async function chargerParametres(tenantId) {
  const result = await db.query(`SELECT parametres_calcul_prix_json, taux_tva_pourcentage FROM tenant WHERE id = $1`, [
    tenantId,
  ]);
  const row = result.rows[0];
  return { ...row.parametres_calcul_prix_json, tauxTvaVente: Number(row.taux_tva_pourcentage) / 100 };
}

// Recharge une offre avec ses noms de partenaires + ses colonnes calculees,
// pour repondre systematiquement avec le meme format apres creation/MAJ.
async function rechargerOffre(offreId, tenantId) {
  const parametres = await chargerParametres(tenantId);
  const result = await db.query(
    `SELECT co.*, f.nom AS fournisseur_nom, tr.nom AS transitaire_nom
     FROM calcul_offre co
     LEFT JOIN fournisseur f ON f.id = co.fournisseur_id
     LEFT JOIN transitaire tr ON tr.id = co.transitaire_id
     WHERE co.id = $1`,
    [offreId]
  );
  const offre = result.rows[0];
  return { ...offre, calcul: calculerOffre(offre, parametres) };
}

// ----------------------------------------------------------------------------
// Dossiers de calcul
// ----------------------------------------------------------------------------

// GET /api/calcul-prix/dossiers?dossier_ao_id=&consultation_id=
router.get("/dossiers", async (req, res) => {
  const { dossier_ao_id, consultation_id } = req.query;
  try {
    const conditions = ["dc.tenant_id = $1"];
    const valeurs = [req.user.tenantId];
    if (dossier_ao_id) {
      conditions.push(`dc.dossier_ao_id = $${valeurs.length + 1}`);
      valeurs.push(dossier_ao_id);
    }
    if (consultation_id) {
      conditions.push(`dc.consultation_id = $${valeurs.length + 1}`);
      valeurs.push(consultation_id);
    }
    const result = await db.query(
      `${SELECT_DOSSIERS_CALCUL} WHERE ${conditions.join(" AND ")} ORDER BY dc.date_creation DESC`,
      valeurs
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CALCUL_DOSSIER_FETCH_ERROR") });
  }
});

// GET /api/calcul-prix/dossiers/:id - fiche complete : articles + offres
// (chacune enrichie de toutes les colonnes calculees, jamais stockees en
// base - voir services/calculPrixEngine.js) + synthese par article (offre
// marquee "retenue" pour chaque article, ou null si aucune).
router.get("/dossiers/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const dossierResult = await db.query(`${SELECT_DOSSIERS_CALCUL} WHERE dc.id = $1 AND dc.tenant_id = $2`, [
      id,
      req.user.tenantId,
    ]);
    const dossier = dossierResult.rows[0];
    if (!dossier) {
      return res.status(404).json({ error: t(req, "CALCUL_DOSSIER_NOT_FOUND") });
    }

    const parametres = await chargerParametres(req.user.tenantId);

    const articlesResult = await db.query(
      `SELECT * FROM calcul_article WHERE dossier_calcul_id = $1 ORDER BY ordre_affichage ASC`,
      [id]
    );

    const offresResult = await db.query(
      `SELECT co.*, f.nom AS fournisseur_nom, tr.nom AS transitaire_nom
       FROM calcul_offre co
       JOIN calcul_article ca ON ca.id = co.calcul_article_id
       LEFT JOIN fournisseur f ON f.id = co.fournisseur_id
       LEFT JOIN transitaire tr ON tr.id = co.transitaire_id
       WHERE ca.dossier_calcul_id = $1
       ORDER BY co.date_reception ASC NULLS LAST`,
      [id]
    );

    const articles = articlesResult.rows.map((article) => {
      const offres = offresResult.rows
        .filter((o) => o.calcul_article_id === article.id)
        .map((offre) => ({ ...offre, calcul: calculerOffre(offre, parametres) }));
      return { ...article, offres };
    });

    const syntheseParArticle = articles.map((article) => {
      const retenue = article.offres.find((o) => o.retenue);
      return {
        calcul_article_id: article.id,
        libelle: article.libelle,
        offre_retenue: retenue
          ? {
              id: retenue.id,
              fournisseur_nom: retenue.fournisseur_nom,
              quantite: retenue.quantite,
              prixUnitaireArrondi: retenue.calcul.prixUnitaireArrondi,
              montantTotalArrondiHt: retenue.calcul.montantTotalArrondiHt,
              tvaVente: retenue.calcul.tvaVente,
              totalTtc: retenue.calcul.totalTtc,
              margeNetteReelle: retenue.calcul.margeNetteReelle,
              margeNetteReellePct: retenue.calcul.margeNetteReellePct,
            }
          : null,
      };
    });

    res.json({ ...dossier, articles, syntheseParArticle });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CALCUL_DOSSIER_FETCH_ERROR") });
  }
});

router.post("/dossiers", async (req, res) => {
  const { dossier_ao_id, consultation_id, nom } = req.body;
  if (!nom || !nom.trim()) {
    return res.status(400).json({ error: t(req, "CALCUL_DOSSIER_NOM_REQUIRED") });
  }
  if (!!dossier_ao_id === !!consultation_id) {
    // soit les deux fournis, soit aucun des deux -> invalide dans les deux cas
    return res.status(400).json({ error: t(req, "CALCUL_DOSSIER_PARENT_REQUIRED") });
  }
  try {
    if (dossier_ao_id) {
      const check = await db.query(`SELECT id FROM dossier_ao WHERE id = $1 AND tenant_id = $2`, [
        dossier_ao_id,
        req.user.tenantId,
      ]);
      if (check.rows.length === 0) {
        return res.status(404).json({ error: t(req, "CALCUL_DOSSIER_PARENT_NOT_FOUND") });
      }
    } else {
      const check = await db.query(`SELECT id FROM consultation WHERE id = $1 AND tenant_id = $2`, [
        consultation_id,
        req.user.tenantId,
      ]);
      if (check.rows.length === 0) {
        return res.status(404).json({ error: t(req, "CALCUL_DOSSIER_PARENT_NOT_FOUND") });
      }
    }

    const result = await db.query(
      `INSERT INTO dossier_calcul (id, tenant_id, dossier_ao_id, consultation_id, nom, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [uuidv4(), req.user.tenantId, dossier_ao_id || null, consultation_id || null, nom.trim(), req.user.sub]
    );
    res.status(201).json({ ...result.rows[0], articles: [], syntheseParArticle: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CALCUL_DOSSIER_CREATE_ERROR") });
  }
});

router.delete("/dossiers/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(`DELETE FROM dossier_calcul WHERE id = $1 AND tenant_id = $2 RETURNING id`, [
      id,
      req.user.tenantId,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "CALCUL_DOSSIER_NOT_FOUND") });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CALCUL_DOSSIER_DELETE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Articles
// ----------------------------------------------------------------------------

router.post("/dossiers/:id/articles", async (req, res) => {
  const { id } = req.params;
  const { libelle, ordre_affichage } = req.body;
  if (!libelle || !libelle.trim()) {
    return res.status(400).json({ error: t(req, "CALCUL_ARTICLE_LIBELLE_REQUIRED") });
  }
  try {
    const dossierCheck = await db.query(`SELECT id FROM dossier_calcul WHERE id = $1 AND tenant_id = $2`, [
      id,
      req.user.tenantId,
    ]);
    if (dossierCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "CALCUL_DOSSIER_NOT_FOUND") });
    }
    const result = await db.query(
      `INSERT INTO calcul_article (id, dossier_calcul_id, libelle, ordre_affichage)
       VALUES ($1, $2, $3, COALESCE($4, 0)) RETURNING *`,
      [uuidv4(), id, libelle.trim(), ordre_affichage]
    );
    res.status(201).json({ ...result.rows[0], offres: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CALCUL_ARTICLE_CREATE_ERROR") });
  }
});

router.patch("/articles/:id", async (req, res) => {
  const { id } = req.params;
  const { libelle, ordre_affichage } = req.body;
  if (libelle === undefined && ordre_affichage === undefined) {
    return res.status(400).json({ error: t(req, "CALCUL_ARTICLE_FIELDS_REQUIRED") });
  }
  try {
    const colonnes = [];
    const valeurs = [];
    if (libelle !== undefined) {
      colonnes.push(`libelle = $${colonnes.length + 1}`);
      valeurs.push(libelle.trim());
    }
    if (ordre_affichage !== undefined) {
      colonnes.push(`ordre_affichage = $${colonnes.length + 1}`);
      valeurs.push(ordre_affichage);
    }
    const idxId = valeurs.length + 1;
    const idxTenant = valeurs.length + 2;
    const result = await db.query(
      `UPDATE calcul_article ca
       SET ${colonnes.join(", ")}
       FROM dossier_calcul dc
       WHERE ca.id = $${idxId} AND ca.dossier_calcul_id = dc.id AND dc.tenant_id = $${idxTenant}
       RETURNING ca.*`,
      [...valeurs, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "CALCUL_ARTICLE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CALCUL_ARTICLE_UPDATE_ERROR") });
  }
});

router.delete("/articles/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM calcul_article ca
       USING dossier_calcul dc
       WHERE ca.id = $1 AND ca.dossier_calcul_id = dc.id AND dc.tenant_id = $2
       RETURNING ca.id`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "CALCUL_ARTICLE_NOT_FOUND") });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CALCUL_ARTICLE_DELETE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Offres (Registre offres partenaires)
// ----------------------------------------------------------------------------

router.post("/articles/:id/offres", async (req, res) => {
  const { id } = req.params;
  const {
    fournisseur_id,
    transitaire_id,
    devise,
    prix_unitaire_devise,
    cours_devise,
    quantite,
    fret_alloue_xof,
    frais_transit_xof,
    date_reception,
    marge_cible_pct,
    notes,
  } = req.body;

  if (!fournisseur_id || !prix_unitaire_devise || !quantite) {
    return res.status(400).json({ error: t(req, "CALCUL_OFFRE_FIELDS_REQUIRED") });
  }

  try {
    const articleCheck = await db.query(
      `SELECT ca.id FROM calcul_article ca
       JOIN dossier_calcul dc ON dc.id = ca.dossier_calcul_id
       WHERE ca.id = $1 AND dc.tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (articleCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "CALCUL_ARTICLE_NOT_FOUND") });
    }

    const fournisseurCheck = await db.query(`SELECT id FROM fournisseur WHERE id = $1 AND tenant_id = $2`, [
      fournisseur_id,
      req.user.tenantId,
    ]);
    if (fournisseurCheck.rows.length === 0) {
      return res.status(400).json({ error: t(req, "CALCUL_OFFRE_FOURNISSEUR_INVALID") });
    }
    if (transitaire_id) {
      const transitaireCheck = await db.query(`SELECT id FROM transitaire WHERE id = $1 AND tenant_id = $2`, [
        transitaire_id,
        req.user.tenantId,
      ]);
      if (transitaireCheck.rows.length === 0) {
        return res.status(400).json({ error: t(req, "CALCUL_OFFRE_TRANSITAIRE_INVALID") });
      }
    }

    const deviseFinale = (devise || "XOF").trim().toUpperCase();
    const coursFinal = deviseFinale === "XOF" ? 1 : Number(cours_devise) || 0;

    const result = await db.query(
      `INSERT INTO calcul_offre
         (id, calcul_article_id, fournisseur_id, transitaire_id, devise, prix_unitaire_devise,
          cours_devise, quantite, fret_alloue_xof, frais_transit_xof, date_reception, marge_cible_pct, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        uuidv4(),
        id,
        fournisseur_id,
        transitaire_id || null,
        deviseFinale,
        prix_unitaire_devise,
        coursFinal,
        quantite,
        fret_alloue_xof || 0,
        frais_transit_xof || 0,
        date_reception || null,
        marge_cible_pct != null && marge_cible_pct !== "" ? marge_cible_pct : null,
        notes || null,
      ]
    );

    const offreComplete = await rechargerOffre(result.rows[0].id, req.user.tenantId);
    res.status(201).json(offreComplete);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CALCUL_OFFRE_CREATE_ERROR") });
  }
});

// PATCH /api/calcul-prix/offres/:id - tout champ est optionnel, seuls les
// champs REELLEMENT presents dans le corps sont modifies (meme convention
// dynamique que PATCH /api/chronogramme/taches/:id) : une chaine vide sur
// transitaire_id/marge_cible_pct desaffecte explicitement le champ (revient
// a NULL), un champ absent est laisse tel quel.
router.patch("/offres/:id", async (req, res) => {
  const { id } = req.params;
  const body = req.body;

  try {
    const offreCheck = await db.query(
      `SELECT co.id, co.calcul_article_id, co.devise, co.cours_devise
       FROM calcul_offre co
       JOIN calcul_article ca ON ca.id = co.calcul_article_id
       JOIN dossier_calcul dc ON dc.id = ca.dossier_calcul_id
       WHERE co.id = $1 AND dc.tenant_id = $2`,
      [id, req.user.tenantId]
    );
    const offreActuelle = offreCheck.rows[0];
    if (!offreActuelle) {
      return res.status(404).json({ error: t(req, "CALCUL_OFFRE_NOT_FOUND") });
    }

    if (body.fournisseur_id !== undefined) {
      const check = await db.query(`SELECT id FROM fournisseur WHERE id = $1 AND tenant_id = $2`, [
        body.fournisseur_id,
        req.user.tenantId,
      ]);
      if (check.rows.length === 0) {
        return res.status(400).json({ error: t(req, "CALCUL_OFFRE_FOURNISSEUR_INVALID") });
      }
    }
    if (body.transitaire_id) {
      const check = await db.query(`SELECT id FROM transitaire WHERE id = $1 AND tenant_id = $2`, [
        body.transitaire_id,
        req.user.tenantId,
      ]);
      if (check.rows.length === 0) {
        return res.status(400).json({ error: t(req, "CALCUL_OFFRE_TRANSITAIRE_INVALID") });
      }
    }

    // "Retenue" est exclusive au sein d'un meme article (une seule offre
    // retenue par article - c'est ce qui doit remonter dans la synthese/le
    // devis) : si on marque cette offre comme retenue, on desactive les
    // autres offres du meme article d'abord.
    if (body.retenue === true) {
      await db.query(`UPDATE calcul_offre SET retenue = false WHERE calcul_article_id = $1 AND id != $2`, [
        offreActuelle.calcul_article_id,
        id,
      ]);
    }

    // La devise et le cours de change vont toujours ensemble (XOF => cours
    // force a 1), donc traites conjointement plutot que comme deux colonnes
    // dynamiques independantes.
    let deviseFinale;
    let coursFinal;
    if (body.devise !== undefined) {
      deviseFinale = String(body.devise).trim().toUpperCase();
      coursFinal = deviseFinale === "XOF" ? 1 : Number(body.cours_devise ?? offreActuelle.cours_devise) || 0;
    } else if (body.cours_devise !== undefined) {
      deviseFinale = offreActuelle.devise;
      coursFinal = offreActuelle.devise === "XOF" ? 1 : Number(body.cours_devise) || 0;
    }

    const colonnes = [];
    const valeurs = [];
    function ajouter(colonne, valeur) {
      colonnes.push(`${colonne} = $${colonnes.length + 1}`);
      valeurs.push(valeur);
    }
    if (body.fournisseur_id !== undefined) ajouter("fournisseur_id", body.fournisseur_id);
    if (body.transitaire_id !== undefined) ajouter("transitaire_id", body.transitaire_id === "" ? null : body.transitaire_id);
    if (deviseFinale !== undefined) ajouter("devise", deviseFinale);
    if (coursFinal !== undefined) ajouter("cours_devise", coursFinal);
    if (body.prix_unitaire_devise !== undefined) ajouter("prix_unitaire_devise", body.prix_unitaire_devise);
    if (body.quantite !== undefined) ajouter("quantite", body.quantite);
    if (body.fret_alloue_xof !== undefined) ajouter("fret_alloue_xof", body.fret_alloue_xof);
    if (body.frais_transit_xof !== undefined) ajouter("frais_transit_xof", body.frais_transit_xof);
    if (body.date_reception !== undefined) ajouter("date_reception", body.date_reception || null);
    if (body.marge_cible_pct !== undefined)
      ajouter("marge_cible_pct", body.marge_cible_pct === "" ? null : body.marge_cible_pct);
    if (body.retenue !== undefined) ajouter("retenue", body.retenue);
    if (body.notes !== undefined) ajouter("notes", body.notes || null);

    if (colonnes.length > 0) {
      const idxId = valeurs.length + 1;
      await db.query(`UPDATE calcul_offre SET ${colonnes.join(", ")} WHERE id = $${idxId}`, [...valeurs, id]);
    }

    const offreComplete = await rechargerOffre(id, req.user.tenantId);
    res.json(offreComplete);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CALCUL_OFFRE_UPDATE_ERROR") });
  }
});

router.delete("/offres/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM calcul_offre co
       USING calcul_article ca, dossier_calcul dc
       WHERE co.id = $1 AND co.calcul_article_id = ca.id AND ca.dossier_calcul_id = dc.id AND dc.tenant_id = $2
       RETURNING co.id`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "CALCUL_OFFRE_NOT_FOUND") });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CALCUL_OFFRE_DELETE_ERROR") });
  }
});

module.exports = router;
