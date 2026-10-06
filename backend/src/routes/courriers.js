const express = require("express");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, requireModule, requireModuleAny, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { rendreTemplate, construireContexte, construireContexteConsultation } = require("../services/courrierEngine");
const courrierFinancement = require("../services/courrierFinancement");

const router = express.Router();
router.use(requireAuth);

// La generation/l'historique de courriers (routes /generer, /historique,
// /generes/:id/statut ci-dessous) sont volontairement positionnees AVANT le
// requireModule("courriers") ci-dessous, avec leur propre garde
// requireModuleAny("courriers", "dossiers", "marches") : depuis le chantier
// du 02/10/2026 (demande de Steeve, "le client veut avoir la possibilite de
// faire les courriers comme avec les appels d'offres"), ces routes servent
// aussi bien un dossier Appel d'Offres (module "dossiers") qu'une
// consultation restreinte (module "marches") - les restreindre au seul
// module "courriers" aurait bloque un utilisateur qui n'a que l'un des deux
// autres modules dans son perimetre. Le CRUD des modeles eux-memes (plus
// bas) reste lui reserve au module "courriers" uniquement, inchange.
const accesGenerationCourrier = requireModuleAny("courriers", "dossiers", "marches");

// accesGenerationCourrier ci-dessus ouvre seulement la PORTE des routes
// (passe des que l'utilisateur a au moins un des 3 modules) - elle ne dit pas
// quel TYPE de dossier il a le droit de toucher une fois entre. Sans ce
// deuxieme filtre, un utilisateur n'ayant que "marches" dans son perimetre
// (ex. COMMERCIAL_TEST) pourrait generer/consulter/marquer-envoye un courrier
// sur un dossier Appel d'Offres auquel il n'a par ailleurs aucun acces -
// incoherent avec le reste de la plateforme (meme principe que le filtre
// deja applique sur GET /api/dossiers/unifies). Reutilise ici la meme regle :
// AO necessite "dossiers" (ou tableauDeBord, ou admin), CONSULTATION
// necessite "marches" (ou admin).
function aAccesTypeDossier(permissions, dossierType) {
  if (permissions.admin) return true;
  if (dossierType === "AO") {
    return permissions.modules.includes("dossiers") || permissions.tableauDeBord;
  }
  if (dossierType === "CONSULTATION") {
    return permissions.modules.includes("marches");
  }
  return false;
}

// ----------------------------------------------------------------------------
// Generation unifiee (AO + Consultation restreinte) + historique numerote
// (chantier du 02/10/2026)
// ----------------------------------------------------------------------------

// Tire le prochain numero de la sequence COURRIER, par tenant et par annee
// civile - meme principe que tirerProchainNumero dans routes/ventes.js
// (verrou de ligne + upsert sur compteur_numerotation), reproduit ici plutot
// que partage car ce fichier ne depend pas de ventes.js et la convention
// etablie sur cette plateforme est de dupliquer ce petit helper par module
// plutot que d'introduire un fichier utilitaire partage supplementaire.
async function tirerProchainNumeroCourrier(client, tenantId, annee) {
  await client.query(
    `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero)
     VALUES ($1, 'COURRIER', $2, 0)
     ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
    [tenantId, annee]
  );
  const result = await client.query(
    `UPDATE compteur_numerotation
     SET dernier_numero = dernier_numero + 1
     WHERE tenant_id = $1 AND type_compteur = 'COURRIER' AND annee = $2
     RETURNING dernier_numero`,
    [tenantId, annee]
  );
  return result.rows[0].dernier_numero;
}

function formaterNumeroCourrier(annee, sequence) {
  return `COUR-${annee}-${String(sequence).padStart(4, "0")}`;
}

// POST /api/courriers/generer - remplace le rendu a la volee de
// POST /dossiers/:dossierId/generer (conservee ci-dessous pour compatibilite,
// non appelee par le nouveau frontend) : genere ET enregistre le courrier
// avec un numero de suite, pour un dossier AO ou une consultation
// restreinte. Une seule chronologie de numeros partagee entre les deux types
// (demande explicite de Steeve : "ca va etre la meme chronologie").
router.post("/generer", accesGenerationCourrier, async (req, res) => {
  const { dossier_type, dossier_id, modele_id, variables } = req.body;

  if (!["AO", "CONSULTATION"].includes(dossier_type)) {
    return res.status(400).json({ error: t(req, "COURRIER_DOSSIER_TYPE_INVALID") });
  }
  if (!aAccesTypeDossier(req.user.permissions, dossier_type)) {
    return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  }
  if (!dossier_id || !modele_id) {
    return res.status(400).json({ error: t(req, "MODELE_ID_REQUIRED") });
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    let contexte;
    if (dossier_type === "AO") {
      const dossierResult = await client.query(
        `SELECT d.*, mo.nom AS maitre_ouvrage_nom
         FROM dossier_ao d
         LEFT JOIN maitre_ouvrage mo ON mo.id = d.maitre_ouvrage_id
         WHERE d.id = $1 AND d.tenant_id = $2`,
        [dossier_id, req.user.tenantId]
      );
      if (dossierResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
      }
      contexte = construireContexte(dossierResult.rows[0], variables || {});
    } else {
      const consultationResult = await client.query(
        `SELECT c.*, cl.nom AS client_nom
         FROM consultation c JOIN client_commercial cl ON cl.id = c.client_commercial_id
         WHERE c.id = $1 AND c.tenant_id = $2`,
        [dossier_id, req.user.tenantId]
      );
      if (consultationResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: t(req, "VENTE_CONSULTATION_NOT_FOUND") });
      }
      // Devis le plus recent lie a cette consultation, pour {{dossier.reference}}
      // et {{dossier.montant_estime}} (une consultation seule n'a ni numero ni
      // montant propre - voir construireContexteConsultation).
      const devisResult = await client.query(
        `SELECT numero, total_ttc FROM devis
         WHERE consultation_id = $1 AND tenant_id = $2
         ORDER BY date_creation DESC LIMIT 1`,
        [dossier_id, req.user.tenantId]
      );
      contexte = construireContexteConsultation(
        consultationResult.rows[0],
        devisResult.rows[0] || null,
        variables || {}
      );
    }

    const modeleResult = await client.query(
      `SELECT * FROM modele_courrier WHERE id = $1 AND tenant_id = $2`,
      [modele_id, req.user.tenantId]
    );
    if (modeleResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "MODELE_NOT_FOUND") });
    }
    const modele = modeleResult.rows[0];

    // Financement du dossier (simulation, compte d'exploitation, plan de
    // tresorerie) : variables reprises automatiquement ; ce que l'utilisateur
    // a saisi a la main garde la priorite.
    const auto = await courrierFinancement.contexte(req.user.tenantId, dossier_type === "AO" ? "ao" : "consultation", dossier_id);
    for (const [cle, valeur] of Object.entries(auto)) {
      if (contexte[cle] === undefined || contexte[cle] === "" || contexte[cle] === null) contexte[cle] = valeur;
    }
    const titreRendu = rendreTemplate(modele.titre, contexte);
    const corpsRendu = rendreTemplate(modele.corps_template, contexte);
    const variablesManquantes = [...new Set([...titreRendu.variablesManquantes, ...corpsRendu.variablesManquantes])];

    const annee = new Date().getFullYear();
    const sequence = await tirerProchainNumeroCourrier(client, req.user.tenantId, annee);
    const numero = formaterNumeroCourrier(annee, sequence);

    const insertResult = await client.query(
      `INSERT INTO courrier_genere
         (id, tenant_id, dossier_ao_id, consultation_id, modele_courrier_id,
          numero, titre_rendu, contenu_final, variables_json, statut)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'BROUILLON')
       RETURNING *`,
      [
        uuidv4(),
        req.user.tenantId,
        dossier_type === "AO" ? dossier_id : null,
        dossier_type === "CONSULTATION" ? dossier_id : null,
        modele_id,
        numero,
        titreRendu.rendu,
        corpsRendu.rendu,
        JSON.stringify(variables || {}),
      ]
    );
    await client.query("COMMIT");

    const ligne = insertResult.rows[0];
    res.status(201).json({
      id: ligne.id,
      numero: ligne.numero,
      modele_id: modele.id,
      type_courrier: modele.type_courrier,
      dossier_type,
      dossier_id,
      titre: ligne.titre_rendu,
      corps: ligne.contenu_final,
      statut: ligne.statut,
      date_generation: ligne.date_generation,
      variables_manquantes: variablesManquantes,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "GENERATION_ERROR") });
  } finally {
    client.release();
  }
});

// GET /api/courriers/historique?dossier_type=AO|CONSULTATION&dossier_id=...
// Liste (plus recent d'abord) des courriers deja generes pour un dossier
// donne - ou, sans parametres, l'historique complet du tenant (ecran global
// a prevoir eventuellement, pas construit pour l'instant).
router.get("/historique", accesGenerationCourrier, async (req, res) => {
  const { dossier_type, dossier_id } = req.query;
  const permissions = req.user.permissions;

  // Filtre explicite sur un dossier donne : il faut avoir acces a ce type
  // precis (voir aAccesTypeDossier), pas seulement a l'un des 3 modules.
  if (dossier_type && dossier_id && !aAccesTypeDossier(permissions, dossier_type)) {
    return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  }

  try {
    const conditions = ["cg.tenant_id = $1"];
    const params = [req.user.tenantId];
    if (dossier_type === "AO" && dossier_id) {
      params.push(dossier_id);
      conditions.push(`cg.dossier_ao_id = $${params.length}`);
    } else if (dossier_type === "CONSULTATION" && dossier_id) {
      params.push(dossier_id);
      conditions.push(`cg.consultation_id = $${params.length}`);
    } else {
      // Pas de filtre precis demande (ecran global) : on ne montre que les
      // types de dossier auxquels l'utilisateur a reellement acces, plutot
      // que de tout bloquer ou tout montrer.
      const typesAutorises = [];
      if (aAccesTypeDossier(permissions, "AO")) typesAutorises.push("cg.dossier_ao_id IS NOT NULL");
      if (aAccesTypeDossier(permissions, "CONSULTATION")) typesAutorises.push("cg.consultation_id IS NOT NULL");
      if (typesAutorises.length === 0) {
        return res.json([]);
      }
      conditions.push(`(${typesAutorises.join(" OR ")})`);
    }
    const result = await db.query(
      `SELECT cg.id, cg.numero, cg.titre_rendu, cg.contenu_final, cg.statut, cg.date_generation,
              cg.dossier_ao_id, cg.consultation_id, mc.type_courrier, mc.titre AS modele_titre
       FROM courrier_genere cg
       JOIN modele_courrier mc ON mc.id = cg.modele_courrier_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY cg.date_generation DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "HISTORIQUE_COURRIER_FETCH_ERROR") });
  }
});

// PATCH /api/courriers/generes/:id/statut - marque un courrier comme envoye
// (seule transition geree pour l'instant : BROUILLON -> ENVOYE).
router.patch("/generes/:id/statut", accesGenerationCourrier, async (req, res) => {
  const { id } = req.params;
  const { statut } = req.body;
  if (statut !== "ENVOYE") {
    return res.status(400).json({ error: t(req, "STATUT_INVALID") });
  }
  try {
    // Le type precis du courrier n'est connu qu'une fois la ligne lue (l'id
    // seul ne le dit pas) - on verifie donc l'acces APRES cette lecture,
    // avant d'autoriser la transition de statut (meme regle que
    // aAccesTypeDossier ailleurs dans ce fichier).
    const courrierActuel = await db.query(
      `SELECT dossier_ao_id, consultation_id FROM courrier_genere WHERE id = $1 AND tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (courrierActuel.rows.length === 0) {
      return res.status(404).json({ error: t(req, "COURRIER_GENERE_NOT_FOUND") });
    }
    const dossierType = courrierActuel.rows[0].dossier_ao_id ? "AO" : "CONSULTATION";
    if (!aAccesTypeDossier(req.user.permissions, dossierType)) {
      return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
    }

    const result = await db.query(
      `UPDATE courrier_genere SET statut = 'ENVOYE' WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "COURRIER_GENERE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "HISTORIQUE_COURRIER_FETCH_ERROR") });
  }
});

router.use(requireModule("courriers"));
router.use(blockLectureSeule);

// ----------------------------------------------------------------------------
// Modeles de courriers (tenant-scope)
// ----------------------------------------------------------------------------

// GET /api/courriers/modeles
router.get("/modeles", async (req, res) => {
  const { type_courrier } = req.query;
  try {
    const result = await db.query(
      type_courrier
        ? `SELECT * FROM modele_courrier WHERE tenant_id = $1 AND type_courrier = $2 ORDER BY titre ASC`
        : `SELECT * FROM modele_courrier WHERE tenant_id = $1 ORDER BY titre ASC`,
      type_courrier ? [req.user.tenantId, type_courrier] : [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "MODELES_FETCH_ERROR") });
  }
});

// POST /api/courriers/modeles
router.post("/modeles", async (req, res) => {
  const { type_courrier, titre, corps_template, declencheur_evenement } = req.body;
  if (!type_courrier || !titre || !corps_template) {
    return res.status(400).json({ error: t(req, "MODELE_FIELDS_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO modele_courrier (id, tenant_id, type_courrier, titre, corps_template, declencheur_evenement)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [uuidv4(), req.user.tenantId, type_courrier, titre, corps_template, declencheur_evenement || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "MODELE_CREATE_ERROR") });
  }
});

// PATCH /api/courriers/modeles/:id
router.patch("/modeles/:id", async (req, res) => {
  const { id } = req.params;
  const { titre, corps_template, declencheur_evenement } = req.body;
  try {
    const result = await db.query(
      `UPDATE modele_courrier
       SET titre = COALESCE($1, titre),
           corps_template = COALESCE($2, corps_template),
           declencheur_evenement = COALESCE($3, declencheur_evenement)
       WHERE id = $4 AND tenant_id = $5
       RETURNING *`,
      [titre || null, corps_template || null, declencheur_evenement || null, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "MODELE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "MODELE_UPDATE_ERROR") });
  }
});

// DELETE /api/courriers/modeles/:id
router.delete("/modeles/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM modele_courrier WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "MODELE_NOT_FOUND") });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "MODELE_DELETE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Generation de courriers (rendu des variables, sans envoi)
// ----------------------------------------------------------------------------

// POST /api/courriers/dossiers/:dossierId/generer
router.post("/dossiers/:dossierId/generer", async (req, res) => {
  const { dossierId } = req.params;
  const { modele_id, variables } = req.body;

  if (!modele_id) {
    return res.status(400).json({ error: t(req, "MODELE_ID_REQUIRED") });
  }

  try {
    const dossierResult = await db.query(
      `SELECT d.*, mo.nom AS maitre_ouvrage_nom
       FROM dossier_ao d
       LEFT JOIN maitre_ouvrage mo ON mo.id = d.maitre_ouvrage_id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    if (dossierResult.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }

    const modeleResult = await db.query(
      `SELECT * FROM modele_courrier WHERE id = $1 AND tenant_id = $2`,
      [modele_id, req.user.tenantId]
    );
    if (modeleResult.rows.length === 0) {
      return res.status(404).json({ error: t(req, "MODELE_NOT_FOUND") });
    }
    const modele = modeleResult.rows[0];

    const contexte = construireContexte(dossierResult.rows[0], variables || {});
    const titreRendu = rendreTemplate(modele.titre, contexte);
    const corpsRendu = rendreTemplate(modele.corps_template, contexte);

    res.json({
      modele_id: modele.id,
      type_courrier: modele.type_courrier,
      titre: titreRendu.rendu,
      corps: corpsRendu.rendu,
      variables_manquantes: [...new Set([...titreRendu.variablesManquantes, ...corpsRendu.variablesManquantes])],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "GENERATION_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Suggestions automatiques (heuristiques simples a partir de l'etat du dossier)
// ----------------------------------------------------------------------------

// GET /api/courriers/dossiers/:dossierId/suggestions
router.get("/dossiers/:dossierId/suggestions", async (req, res) => {
  const { dossierId } = req.params;
  try {
    const dossierResult = await db.query(
      `SELECT id, date_limite_soumission, statut FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    if (dossierResult.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }
    const dossier = dossierResult.rows[0];

    const tachesResult = await db.query(
      `SELECT statut, date_echeance FROM chronogramme_tache WHERE dossier_ao_id = $1`,
      [dossierId]
    );

    const typesSuggeres = new Set();
    const raisons = {};

    const tachesEnRetard = tachesResult.rows.filter((tache) => tache.statut === "EN_RETARD");
    if (tachesEnRetard.length > 0) {
      typesSuggeres.add("DEMANDE_PROROGATION");
      raisons.DEMANDE_PROROGATION = `${tachesEnRetard.length} tache(s) en retard sur le chronogramme.`;
      typesSuggeres.add("RESERVE_ORDRE_SERVICE");
      raisons.RESERVE_ORDRE_SERVICE = `${tachesEnRetard.length} tache(s) en retard : envisager une reserve sur ordre de service.`;
    }

    if (dossier.date_limite_soumission && ["ANALYSE", "GO"].includes(dossier.statut)) {
      const joursRestants = Math.ceil(
        (new Date(dossier.date_limite_soumission) - new Date()) / (1000 * 60 * 60 * 24)
      );
      if (joursRestants >= 0 && joursRestants <= 5) {
        typesSuggeres.add("DEMANDE_CLARIFICATION");
        raisons.DEMANDE_CLARIFICATION = `Date limite de soumission dans ${joursRestants} jour(s) - dernier moment pour demander des clarifications.`;
      }
    }

    if (typesSuggeres.size === 0) {
      return res.json([]);
    }

    const modelesResult = await db.query(
      `SELECT * FROM modele_courrier WHERE tenant_id = $1 AND type_courrier = ANY($2::text[])`,
      [req.user.tenantId, [...typesSuggeres]]
    );

    const suggestions = modelesResult.rows.map((modele) => ({
      ...modele,
      raison: raisons[modele.type_courrier],
    }));

    res.json(suggestions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUGGESTIONS_FETCH_ERROR") });
  }
});

module.exports = router;
