const express = require("express");
const db = require("../db");
const { requireAuth, requireRole, requireRoleOuValidateurUniversel, requireModule } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);

// Le Directeur Financier n'a normalement PAS "marches" dans son perimetre
// (perimetre standard = Financement uniquement, voir migration
// 017_permissions_roles.sql) - mais Steeve a explicitement demande qu'un
// validateur universel (DG ou Directeur Financier) puisse valider/refuser un
// devis en l'absence de l'autre ("si le directeur financier n'est pas la,
// c'est le directeur general qui va signer, si vice versa" - Phase 2 du
// systeme de permissions par role, 05/09/2026). Deux niveaux d'exception,
// pour rester aussi precis que possible sans elargir son perimetre reel :
//   - LECTURE (GET) : toujours autorisee pour un validateur universel, meme
//     sans "marches" dans ses modules - il doit pouvoir consulter un devis
//     (et son contexte : client, consultation liee...) avant de decider,
//     comme le ferait n'importe quel approbateur.
//   - ECRITURE : seules les 2 routes de DECISION sur un devis (valider /
//     changer son statut, ce qui couvre le refus) sont autorisees sans
//     "marches" - la creation de devis/consultations et la facturation
//     restent hors de son perimetre standard, inchangees.
router.use((req, res, next) => {
  const estValidateurUniversel = !!req.user?.permissions?.validateurUniversel;
  if (estValidateurUniversel) {
    if (req.method === "GET") return next();
    const estRouteDecisionDevis =
      (req.method === "POST" && /^\/devis\/[^/]+\/valider$/.test(req.path)) ||
      (req.method === "PATCH" && /^\/devis\/[^/]+\/statut$/.test(req.path));
    if (estRouteDecisionDevis) return next();
  }
  return requireModule("marches")(req, res, next);
});

// ----------------------------------------------------------------------------
// Module Ventes/Negoce (cadre avec Steeve le 04/09/2026, voir
// claude/resume_reprise_projet.md) : Consultation -> Devis (valide par la
// Direction) -> Facture -> Bon de livraison, avec numerotation automatique
// et calculs (HT/TVA/TTC) toujours faits cote serveur (jamais fait confiance
// a des totaux envoyes par le frontend).
//
// Repartition des roles actee avec Steeve (requireRole accepte plusieurs
// codes ; ADMIN passe toujours, comme partout ailleurs sur la plateforme) :
//   - COMMERCIAL / ADMINISTRATIF : enregistre les consultations, cree/edite
//     les devis.
//   - Validation d'un devis : tout "validateur universel" (Directeur General
//     ou Directeur Financier - voir requireRoleOuValidateurUniversel,
//     Phase 2 du systeme de permissions par role, 05/09/2026), plus DIRECTION
//     par son code de role pour compatibilite si un tenant a un role
//     DIRECTION qui n'a pas (encore) coche validateur_universel. Ce n'est
//     PLUS reserve au seul code de role "DIRECTION" en dur : Steeve a
//     explicitement demande que le Directeur Financier puisse valider a la
//     place du Directeur General en cas d'absence, et inversement.
//   - COMPTABLE / FINANCIER : genere facture puis bon de livraison, suit les
//     paiements et les livraisons.
// La LECTURE (GET) n'est pas restreinte par role : "consultation restreinte"
// dans la demande de Steeve designe la 1ere etape du flux commercial (une
// demande recue d'un client), pas un acces limite en lecture - confirme
// avec lui avant de coder.
// ----------------------------------------------------------------------------

const ROLES_CREATION = ["COMMERCIAL", "ADMINISTRATIF"];
const ROLES_VALIDATION = ["DIRECTION"];
const ROLES_FACTURATION = ["COMPTABLE", "FINANCIER"];

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

// Tire le prochain numero d'une sequence (DEVIS ou VENTE), par tenant et par
// annee civile. Verrou de ligne (FOR UPDATE) + upsert pour eviter deux
// documents avec le meme numero en cas de generation concurrente - meme
// precaution que pour tout compteur/solde partage sur cette plateforme.
async function tirerProchainNumero(client, tenantId, typeCompteur, annee) {
  await client.query(
    `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
    [tenantId, typeCompteur, annee]
  );
  const result = await client.query(
    `UPDATE compteur_numerotation
     SET dernier_numero = dernier_numero + 1
     WHERE tenant_id = $1 AND type_compteur = $2 AND annee = $3
     RETURNING dernier_numero`,
    [tenantId, typeCompteur, annee]
  );
  return result.rows[0].dernier_numero;
}

function formaterNumeroDevis(annee, mois, sequence) {
  return `DEV-${annee}-${String(mois).padStart(2, "0")}-${String(sequence).padStart(4, "0")}`;
}

// Stocke sans le mois (ex "2026-096") : le mois est reconstitue a
// l'affichage a partir de mois_emission (voir formaterNumeroAffichageVente
// cote frontend), pour que Facture et BL affichent toujours le meme mois
// meme si le BL est genere plus tard dans le mois suivant.
function formaterNumeroVente(annee, sequence) {
  return `${annee}-${String(sequence).padStart(3, "0")}`;
}

// Valide une liste de lignes {designation, unite, quantite, prix_unitaire_ht}
// et renvoie les lignes enrichies de leur montant_ht calcule, plus les
// totaux (jamais calcules cote client).
function calculerLignesEtTotaux(lignesBrutes, tauxTva) {
  if (!Array.isArray(lignesBrutes) || lignesBrutes.length === 0) {
    return { erreur: "VIDE" };
  }
  const lignes = [];
  let totalHt = 0;
  for (const brut of lignesBrutes) {
    const quantite = Number(brut.quantite);
    const prixUnitaireHt = Number(brut.prix_unitaire_ht);
    if (!brut.designation || !Number.isFinite(quantite) || quantite <= 0 || !Number.isFinite(prixUnitaireHt) || prixUnitaireHt < 0) {
      return { erreur: "LIGNE_INVALIDE" };
    }
    const montantHt = Math.round(quantite * prixUnitaireHt * 100) / 100;
    lignes.push({
      designation: brut.designation.trim(),
      unite: (brut.unite || "U").trim(),
      quantite,
      prix_unitaire_ht: prixUnitaireHt,
      montant_ht: montantHt,
    });
    totalHt += montantHt;
  }
  totalHt = Math.round(totalHt * 100) / 100;
  const montantTva = Math.round(totalHt * (Number(tauxTva) / 100) * 100) / 100;
  const totalTtc = Math.round((totalHt + montantTva) * 100) / 100;
  return { lignes, total_ht: totalHt, montant_tva: montantTva, total_ttc: totalTtc };
}

async function chargerLignesDevis(devisId) {
  const result = await db.query(
    `SELECT id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht
     FROM devis_ligne WHERE devis_id = $1 ORDER BY ordre ASC`,
    [devisId]
  );
  return result.rows;
}

async function chargerLignesFacture(factureId) {
  const result = await db.query(
    `SELECT id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht
     FROM facture_vente_ligne WHERE facture_vente_id = $1 ORDER BY ordre ASC`,
    [factureId]
  );
  return result.rows;
}

async function chargerLignesBl(blId) {
  const result = await db.query(
    `SELECT id, ordre, designation, unite, quantite_livree
     FROM bon_livraison_ligne WHERE bon_livraison_id = $1 ORDER BY ordre ASC`,
    [blId]
  );
  return result.rows;
}

// ----------------------------------------------------------------------------
// Clients commerciaux (clients DU tenant - a ne pas confondre avec les
// tenants de la plateforme Baobab)
// ----------------------------------------------------------------------------

router.get("/clients", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM client_commercial WHERE tenant_id = $1 ORDER BY nom ASC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_CLIENT_FETCH_ERROR") });
  }
});

router.post("/clients", requireRole(...ROLES_CREATION, ...ROLES_FACTURATION), async (req, res) => {
  const { nom, adresse, telephone, email } = req.body;
  if (!nom || !nom.trim()) {
    return res.status(400).json({ error: t(req, "VENTE_CLIENT_FIELDS_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO client_commercial (tenant_id, nom, adresse, telephone, email)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.tenantId, nom.trim(), adresse || null, telephone || null, email || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_CLIENT_CREATE_ERROR") });
  }
});

router.patch("/clients/:id", requireRole(...ROLES_CREATION, ...ROLES_FACTURATION), async (req, res) => {
  const { id } = req.params;
  const { nom, adresse, telephone, email, actif } = req.body;
  try {
    const result = await db.query(
      `UPDATE client_commercial
       SET nom = COALESCE($1, nom), adresse = $2, telephone = $3, email = $4,
           actif = COALESCE($5, actif)
       WHERE id = $6 AND tenant_id = $7 RETURNING *`,
      [nom || null, adresse || null, telephone || null, email || null, actif != null ? actif : null, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "VENTE_CLIENT_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_CLIENT_UPDATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Consultations (demandes recues d'un client - 1ere etape du flux)
// ----------------------------------------------------------------------------

router.get("/consultations", async (req, res) => {
  const { statut } = req.query;
  try {
    const result = await db.query(
      statut
        ? `SELECT c.*, cl.nom AS client_nom
           FROM consultation c JOIN client_commercial cl ON cl.id = c.client_commercial_id
           WHERE c.tenant_id = $1 AND c.statut = $2 ORDER BY c.date_reception DESC`
        : `SELECT c.*, cl.nom AS client_nom
           FROM consultation c JOIN client_commercial cl ON cl.id = c.client_commercial_id
           WHERE c.tenant_id = $1 ORDER BY c.date_reception DESC`,
      statut ? [req.user.tenantId, statut] : [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_CONSULTATION_FETCH_ERROR") });
  }
});

router.post("/consultations", requireRole(...ROLES_CREATION), async (req, res) => {
  const { client_commercial_id, objet, date_reception, notes } = req.body;
  if (!client_commercial_id || !objet || !objet.trim()) {
    return res.status(400).json({ error: t(req, "VENTE_CONSULTATION_FIELDS_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO consultation (tenant_id, client_commercial_id, objet, date_reception, notes, cree_par)
       VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6) RETURNING *`,
      [req.user.tenantId, client_commercial_id, objet.trim(), date_reception || null, notes || null, req.user.sub]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_CONSULTATION_CREATE_ERROR") });
  }
});

router.patch("/consultations/:id", requireRole(...ROLES_CREATION), async (req, res) => {
  const { id } = req.params;
  const { objet, statut, notes } = req.body;
  try {
    const result = await db.query(
      `UPDATE consultation
       SET objet = COALESCE($1, objet), statut = COALESCE($2, statut), notes = $3
       WHERE id = $4 AND tenant_id = $5 RETURNING *`,
      [objet || null, statut || null, notes || null, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "VENTE_CONSULTATION_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_CONSULTATION_UPDATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Devis
// ----------------------------------------------------------------------------

router.get("/devis", async (req, res) => {
  const { statut } = req.query;
  try {
    const result = await db.query(
      statut
        ? `SELECT d.*, cl.nom AS client_nom
           FROM devis d JOIN client_commercial cl ON cl.id = d.client_commercial_id
           WHERE d.tenant_id = $1 AND d.statut = $2 ORDER BY d.date_creation DESC`
        : `SELECT d.*, cl.nom AS client_nom
           FROM devis d JOIN client_commercial cl ON cl.id = d.client_commercial_id
           WHERE d.tenant_id = $1 ORDER BY d.date_creation DESC`,
      statut ? [req.user.tenantId, statut] : [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_DEVIS_FETCH_ERROR") });
  }
});

router.get("/devis/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT d.*, cl.nom AS client_nom, cl.adresse AS client_adresse
       FROM devis d JOIN client_commercial cl ON cl.id = d.client_commercial_id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "VENTE_DEVIS_NOT_FOUND") });
    }
    const lignes = await chargerLignesDevis(id);
    const factureResult = await db.query(
      `SELECT id, numero FROM facture_vente WHERE devis_id = $1 AND tenant_id = $2`,
      [id, req.user.tenantId]
    );
    res.json({ ...result.rows[0], lignes, facture: factureResult.rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_DEVIS_FETCH_ERROR") });
  }
});

router.post("/devis", requireRole(...ROLES_CREATION), async (req, res) => {
  const { client_commercial_id, consultation_id, objet, date_devis, conditions_paiement, delai_livraison, validite_offre, lignes } = req.body;
  if (!client_commercial_id) {
    return res.status(400).json({ error: t(req, "VENTE_DEVIS_FIELDS_REQUIRED") });
  }
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const tenantResult = await client.query(`SELECT taux_tva_pourcentage FROM tenant WHERE id = $1`, [req.user.tenantId]);
    const tauxTva = tenantResult.rows[0].taux_tva_pourcentage;

    const calcul = calculerLignesEtTotaux(lignes, tauxTva);
    if (calcul.erreur === "VIDE") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "VENTE_DEVIS_FIELDS_REQUIRED") });
    }
    if (calcul.erreur === "LIGNE_INVALIDE") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "VENTE_DEVIS_LIGNE_INVALID") });
    }

    const maintenant = new Date();
    const annee = maintenant.getFullYear();
    const mois = maintenant.getMonth() + 1;
    const sequence = await tirerProchainNumero(client, req.user.tenantId, "DEVIS", annee);
    const numero = formaterNumeroDevis(annee, mois, sequence);

    const devisResult = await client.query(
      `INSERT INTO devis (tenant_id, numero, consultation_id, client_commercial_id, objet, date_devis,
                           conditions_paiement, delai_livraison, validite_offre, taux_tva_pourcentage,
                           total_ht, montant_tva, total_ttc, cree_par)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6, CURRENT_DATE),$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        req.user.tenantId, numero, consultation_id || null, client_commercial_id, objet || null, date_devis || null,
        conditions_paiement || null, delai_livraison || null, validite_offre || null, tauxTva,
        calcul.total_ht, calcul.montant_tva, calcul.total_ttc, req.user.sub,
      ]
    );
    const devis = devisResult.rows[0];

    let ordre = 0;
    for (const ligne of calcul.lignes) {
      await client.query(
        `INSERT INTO devis_ligne (devis_id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [devis.id, ordre++, ligne.designation, ligne.unite, ligne.quantite, ligne.prix_unitaire_ht, ligne.montant_ht]
      );
    }

    if (consultation_id) {
      await client.query(
        `UPDATE consultation SET statut = 'DEVIS_EN_COURS' WHERE id = $1 AND tenant_id = $2 AND statut = 'RECUE'`,
        [consultation_id, req.user.tenantId]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ ...devis, lignes: calcul.lignes });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_DEVIS_CREATE_ERROR") });
  } finally {
    client.release();
  }
});

// PATCH /devis/:id - reedition des lignes/champs, uniquement tant que le
// devis n'est pas encore VALIDE/REFUSE/EXPIRE (au-dela, un devis est fige :
// toute correction passe par un nouveau devis, comme sur le terrain).
router.patch("/devis/:id", requireRole(...ROLES_CREATION), async (req, res) => {
  const { id } = req.params;
  const { objet, date_devis, conditions_paiement, delai_livraison, validite_offre, lignes } = req.body;

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const existant = await client.query(
      `SELECT * FROM devis WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [id, req.user.tenantId]
    );
    if (existant.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "VENTE_DEVIS_NOT_FOUND") });
    }
    const devisActuel = existant.rows[0];
    if (!["BROUILLON", "ENVOYE"].includes(devisActuel.statut)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "VENTE_DEVIS_NOT_EDITABLE") });
    }

    let totaux = { total_ht: devisActuel.total_ht, montant_tva: devisActuel.montant_tva, total_ttc: devisActuel.total_ttc };
    if (lignes) {
      const calcul = calculerLignesEtTotaux(lignes, devisActuel.taux_tva_pourcentage);
      if (calcul.erreur === "VIDE") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "VENTE_DEVIS_FIELDS_REQUIRED") });
      }
      if (calcul.erreur === "LIGNE_INVALIDE") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "VENTE_DEVIS_LIGNE_INVALID") });
      }
      await client.query(`DELETE FROM devis_ligne WHERE devis_id = $1`, [id]);
      let ordre = 0;
      for (const ligne of calcul.lignes) {
        await client.query(
          `INSERT INTO devis_ligne (devis_id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, ordre++, ligne.designation, ligne.unite, ligne.quantite, ligne.prix_unitaire_ht, ligne.montant_ht]
        );
      }
      totaux = calcul;
    }

    const result = await client.query(
      `UPDATE devis
       SET objet = COALESCE($1, objet), date_devis = COALESCE($2, date_devis),
           conditions_paiement = $3, delai_livraison = $4, validite_offre = $5,
           total_ht = $6, montant_tva = $7, total_ttc = $8
       WHERE id = $9 AND tenant_id = $10 RETURNING *`,
      [
        objet || null, date_devis || null, conditions_paiement || null, delai_livraison || null, validite_offre || null,
        totaux.total_ht, totaux.montant_tva, totaux.total_ttc, id, req.user.tenantId,
      ]
    );
    await client.query("COMMIT");
    const nouvellesLignes = await chargerLignesDevis(id);
    res.json({ ...result.rows[0], lignes: nouvellesLignes });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_DEVIS_UPDATE_ERROR") });
  } finally {
    client.release();
  }
});

// PATCH /devis/:id/statut - transitions manuelles simples (ENVOYE, REFUSE,
// EXPIRE). La transition vers VALIDE passe exclusivement par /valider
// ci-dessous (trace qui a valide et quand). REFUSE est une decision de
// validation (rejet) : ouverte aussi a tout validateur universel, pas
// seulement au code de role DIRECTION.
router.patch("/devis/:id/statut", requireRoleOuValidateurUniversel(...ROLES_CREATION, ...ROLES_VALIDATION), async (req, res) => {
  const { id } = req.params;
  const { statut } = req.body;
  if (!["ENVOYE", "REFUSE", "EXPIRE"].includes(statut)) {
    return res.status(400).json({ error: t(req, "VENTE_DEVIS_STATUT_INVALID") });
  }
  try {
    const result = await db.query(
      `UPDATE devis SET statut = $1 WHERE id = $2 AND tenant_id = $3 AND statut IN ('BROUILLON','ENVOYE') RETURNING *`,
      [statut, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ error: t(req, "VENTE_DEVIS_NOT_EDITABLE") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_DEVIS_UPDATE_ERROR") });
  }
});

// POST /devis/:id/valider - reserve a un validateur universel (Directeur
// General ou Directeur Financier - voir requireRoleOuValidateurUniversel) ou
// au code de role DIRECTION pour compatibilite, plus ADMIN. Un devis valide
// devient facturable ; il n'est plus modifiable au-dela.
router.post("/devis/:id/valider", requireRoleOuValidateurUniversel(...ROLES_VALIDATION), async (req, res) => {
  const { id } = req.params;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE devis SET statut = 'VALIDE', valide_par = $1, date_validation = now()
       WHERE id = $2 AND tenant_id = $3 AND statut IN ('BROUILLON','ENVOYE') RETURNING *`,
      [req.user.sub, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "VENTE_DEVIS_NOT_EDITABLE") });
    }
    const devis = result.rows[0];
    if (devis.consultation_id) {
      await client.query(
        `UPDATE consultation SET statut = 'CONVERTIE' WHERE id = $1 AND tenant_id = $2`,
        [devis.consultation_id, req.user.tenantId]
      );
    }
    await client.query("COMMIT");
    res.json(devis);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_DEVIS_VALIDER_ERROR") });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------------------
// Facture de vente - generee depuis un devis VALIDE. Lignes figees (copie),
// numero tire du compteur VENTE (partage avec le bon de livraison).
// ----------------------------------------------------------------------------

router.get("/factures", async (req, res) => {
  const { statut } = req.query;
  try {
    const result = await db.query(
      statut
        ? `SELECT f.*, cl.nom AS client_nom,
                  bl.id AS bl_id, bl.statut AS bl_statut
           FROM facture_vente f
           JOIN client_commercial cl ON cl.id = f.client_commercial_id
           LEFT JOIN bon_livraison bl ON bl.facture_vente_id = f.id
           WHERE f.tenant_id = $1 AND f.statut = $2 ORDER BY f.date_creation DESC`
        : `SELECT f.*, cl.nom AS client_nom,
                  bl.id AS bl_id, bl.statut AS bl_statut
           FROM facture_vente f
           JOIN client_commercial cl ON cl.id = f.client_commercial_id
           LEFT JOIN bon_livraison bl ON bl.facture_vente_id = f.id
           WHERE f.tenant_id = $1 ORDER BY f.date_creation DESC`,
      statut ? [req.user.tenantId, statut] : [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_FACTURE_FETCH_ERROR") });
  }
});

router.get("/factures/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT f.*, cl.nom AS client_nom, cl.adresse AS client_adresse
       FROM facture_vente f JOIN client_commercial cl ON cl.id = f.client_commercial_id
       WHERE f.id = $1 AND f.tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "VENTE_FACTURE_NOT_FOUND") });
    }
    const lignes = await chargerLignesFacture(id);
    const blResult = await db.query(`SELECT id, numero, statut FROM bon_livraison WHERE facture_vente_id = $1`, [id]);
    res.json({ ...result.rows[0], lignes, bon_livraison: blResult.rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_FACTURE_FETCH_ERROR") });
  }
});

router.post("/devis/:id/generer-facture", requireRole(...ROLES_FACTURATION), async (req, res) => {
  const { id } = req.params;
  const { reference_bc_client, date_echeance } = req.body;

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const devisResult = await client.query(
      `SELECT * FROM devis WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [id, req.user.tenantId]
    );
    if (devisResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "VENTE_DEVIS_NOT_FOUND") });
    }
    const devis = devisResult.rows[0];
    if (devis.statut !== "VALIDE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "VENTE_DEVIS_NOT_VALIDE") });
    }

    const dejaFacture = await client.query(`SELECT id FROM facture_vente WHERE devis_id = $1`, [id]);
    if (dejaFacture.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "VENTE_DEVIS_ALREADY_INVOICED") });
    }

    const lignesDevis = await chargerLignesDevis(id);

    const maintenant = new Date();
    const annee = maintenant.getFullYear();
    const mois = maintenant.getMonth() + 1;
    const sequence = await tirerProchainNumero(client, req.user.tenantId, "VENTE", annee);
    const numero = formaterNumeroVente(annee, sequence);

    const factureResult = await client.query(
      `INSERT INTO facture_vente (tenant_id, numero, mois_emission, devis_id, client_commercial_id,
                                   reference_bc_client, taux_tva_pourcentage, total_ht, montant_tva, total_ttc,
                                   date_echeance, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        req.user.tenantId, numero, mois, id, devis.client_commercial_id,
        reference_bc_client || null, devis.taux_tva_pourcentage, devis.total_ht, devis.montant_tva, devis.total_ttc,
        date_echeance || null, req.user.sub,
      ]
    );
    const facture = factureResult.rows[0];

    let ordre = 0;
    for (const ligne of lignesDevis) {
      await client.query(
        `INSERT INTO facture_vente_ligne (facture_vente_id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [facture.id, ordre++, ligne.designation, ligne.unite, ligne.quantite, ligne.prix_unitaire_ht, ligne.montant_ht]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ ...facture, lignes: lignesDevis });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_FACTURE_GENERATE_ERROR") });
  } finally {
    client.release();
  }
});

router.patch("/factures/:id", requireRole(...ROLES_FACTURATION), async (req, res) => {
  const { id } = req.params;
  const { reference_bc_client, date_echeance } = req.body;
  try {
    const result = await db.query(
      `UPDATE facture_vente SET reference_bc_client = $1, date_echeance = $2
       WHERE id = $3 AND tenant_id = $4 RETURNING *`,
      [reference_bc_client || null, date_echeance || null, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "VENTE_FACTURE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_FACTURE_UPDATE_ERROR") });
  }
});

router.patch("/factures/:id/marquer-payee", requireRole(...ROLES_FACTURATION), async (req, res) => {
  const { id } = req.params;
  const { mode_paiement } = req.body;
  try {
    const result = await db.query(
      `UPDATE facture_vente SET statut = 'PAYEE', date_paiement = now(), mode_paiement = $1
       WHERE id = $2 AND tenant_id = $3 AND statut = 'IMPAYEE' RETURNING *`,
      [mode_paiement || null, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ error: t(req, "VENTE_FACTURE_STATUT_INVALID") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_FACTURE_UPDATE_ERROR") });
  }
});

router.patch("/factures/:id/annuler", requireRole(...ROLES_FACTURATION), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `UPDATE facture_vente SET statut = 'ANNULEE'
       WHERE id = $1 AND tenant_id = $2 AND statut = 'IMPAYEE' RETURNING *`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ error: t(req, "VENTE_FACTURE_STATUT_INVALID") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_FACTURE_UPDATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Bon de livraison - genere depuis une facture, reutilise son numero. Les
// quantites livrees sont editables independamment de la facture (livraison
// partielle).
// ----------------------------------------------------------------------------

router.get("/bl", async (req, res) => {
  const { statut } = req.query;
  try {
    const result = await db.query(
      statut
        ? `SELECT bl.*, cl.nom AS client_nom, f.numero AS facture_numero
           FROM bon_livraison bl
           JOIN client_commercial cl ON cl.id = bl.client_commercial_id
           JOIN facture_vente f ON f.id = bl.facture_vente_id
           WHERE bl.tenant_id = $1 AND bl.statut = $2 ORDER BY bl.date_creation DESC`
        : `SELECT bl.*, cl.nom AS client_nom, f.numero AS facture_numero
           FROM bon_livraison bl
           JOIN client_commercial cl ON cl.id = bl.client_commercial_id
           JOIN facture_vente f ON f.id = bl.facture_vente_id
           WHERE bl.tenant_id = $1 ORDER BY bl.date_creation DESC`,
      statut ? [req.user.tenantId, statut] : [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_BL_FETCH_ERROR") });
  }
});

router.get("/bl/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT bl.*, cl.nom AS client_nom, cl.adresse AS client_adresse, f.numero AS facture_numero
       FROM bon_livraison bl
       JOIN client_commercial cl ON cl.id = bl.client_commercial_id
       JOIN facture_vente f ON f.id = bl.facture_vente_id
       WHERE bl.id = $1 AND bl.tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "VENTE_BL_NOT_FOUND") });
    }
    const lignes = await chargerLignesBl(id);
    res.json({ ...result.rows[0], lignes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_BL_FETCH_ERROR") });
  }
});

router.post("/factures/:id/generer-bl", requireRole(...ROLES_FACTURATION), async (req, res) => {
  const { id } = req.params;

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const factureResult = await client.query(
      `SELECT * FROM facture_vente WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [id, req.user.tenantId]
    );
    if (factureResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "VENTE_FACTURE_NOT_FOUND") });
    }
    const facture = factureResult.rows[0];

    const dejaBl = await client.query(`SELECT id FROM bon_livraison WHERE facture_vente_id = $1`, [id]);
    if (dejaBl.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "VENTE_FACTURE_ALREADY_HAS_BL") });
    }

    const lignesFacture = await chargerLignesFacture(id);

    // Le BL reutilise le numero ET le mois d'emission de la facture (pas de
    // tirage sur le compteur VENTE) : reproduit la pratique observee chez
    // Steeve ou Facture et BL d'une meme transaction portent le meme numero.
    const blResult = await client.query(
      `INSERT INTO bon_livraison (tenant_id, numero, mois_emission, facture_vente_id, client_commercial_id, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.tenantId, facture.numero, facture.mois_emission, id, facture.client_commercial_id, req.user.sub]
    );
    const bl = blResult.rows[0];

    let ordre = 0;
    for (const ligne of lignesFacture) {
      await client.query(
        `INSERT INTO bon_livraison_ligne (bon_livraison_id, ordre, designation, unite, quantite_livree)
         VALUES ($1,$2,$3,$4,$5)`,
        [bl.id, ordre++, ligne.designation, ligne.unite, ligne.quantite]
      );
    }

    await client.query("COMMIT");
    const lignesBl = await chargerLignesBl(bl.id);
    res.status(201).json({ ...bl, lignes: lignesBl });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_BL_GENERATE_ERROR") });
  } finally {
    client.release();
  }
});

// PATCH /bl/:id - edition des quantites livrees (livraison partielle),
// uniquement tant que le BL est en brouillon.
router.patch("/bl/:id", requireRole(...ROLES_FACTURATION), async (req, res) => {
  const { id } = req.params;
  const { lignes, date_bl } = req.body;

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const existant = await client.query(`SELECT * FROM bon_livraison WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, req.user.tenantId]);
    if (existant.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "VENTE_BL_NOT_FOUND") });
    }
    if (existant.rows[0].statut !== "BROUILLON") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "VENTE_BL_UPDATE_ERROR") });
    }

    if (Array.isArray(lignes)) {
      await client.query(`DELETE FROM bon_livraison_ligne WHERE bon_livraison_id = $1`, [id]);
      let ordre = 0;
      for (const ligne of lignes) {
        const quantite = Number(ligne.quantite_livree);
        if (!ligne.designation || !Number.isFinite(quantite) || quantite < 0) continue;
        await client.query(
          `INSERT INTO bon_livraison_ligne (bon_livraison_id, ordre, designation, unite, quantite_livree)
           VALUES ($1,$2,$3,$4,$5)`,
          [id, ordre++, ligne.designation, ligne.unite || "U", quantite]
        );
      }
    }
    if (date_bl) {
      await client.query(`UPDATE bon_livraison SET date_bl = $1 WHERE id = $2`, [date_bl, id]);
    }

    await client.query("COMMIT");
    const result = await db.query(`SELECT * FROM bon_livraison WHERE id = $1`, [id]);
    const lignesFinales = await chargerLignesBl(id);
    res.json({ ...result.rows[0], lignes: lignesFinales });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_BL_UPDATE_ERROR") });
  } finally {
    client.release();
  }
});

router.patch("/bl/:id/marquer-livre", requireRole(...ROLES_FACTURATION), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `UPDATE bon_livraison SET statut = 'LIVRE' WHERE id = $1 AND tenant_id = $2 AND statut = 'BROUILLON' RETURNING *`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ error: t(req, "VENTE_BL_UPDATE_ERROR") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_BL_UPDATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Statistiques et suivi consolide (demandes de Steeve du 04/09/2026, en
// complement du chantier initial) - lecture seule, pas de restriction de
// role (meme principe que le reste des GET de ce module).
// ----------------------------------------------------------------------------

// GET /statistiques - chiffres globaux pour le pipeline commercial : ce que
// Steeve appelait "le tableau de suivi Excel" cote statistiques (repartition
// des devis par statut, CA facture/paye/impaye, taux de conversion). Les
// pourcentages de conversion sont calcules cote frontend a partir des
// compteurs bruts renvoyes ici (evite de dupliquer une logique
// d'arrondi/formatage des deux cotes).
router.get("/statistiques", async (req, res) => {
  const tenantId = req.user.tenantId;
  try {
    const [consultationsResult, devisResult, devisFacturesResult, facturesResult] = await Promise.all([
      db.query(`SELECT statut, COUNT(*)::int AS n FROM consultation WHERE tenant_id = $1 GROUP BY statut`, [tenantId]),
      db.query(`SELECT statut, COUNT(*)::int AS n FROM devis WHERE tenant_id = $1 GROUP BY statut`, [tenantId]),
      db.query(
        `SELECT COUNT(*)::int AS n FROM devis d JOIN facture_vente f ON f.devis_id = d.id WHERE d.tenant_id = $1`,
        [tenantId]
      ),
      db.query(
        `SELECT statut, COUNT(*)::int AS n, COALESCE(SUM(total_ht),0) AS total_ht, COALESCE(SUM(total_ttc),0) AS total_ttc
         FROM facture_vente WHERE tenant_id = $1 GROUP BY statut`,
        [tenantId]
      ),
    ]);

    const consultationsParStatut = { RECUE: 0, DEVIS_EN_COURS: 0, CONVERTIE: 0, SANS_SUITE: 0 };
    let consultationsTotal = 0;
    for (const row of consultationsResult.rows) {
      consultationsParStatut[row.statut] = row.n;
      consultationsTotal += row.n;
    }

    const devisParStatut = { BROUILLON: 0, ENVOYE: 0, VALIDE: 0, REFUSE: 0, EXPIRE: 0 };
    let devisTotal = 0;
    for (const row of devisResult.rows) {
      devisParStatut[row.statut] = row.n;
      devisTotal += row.n;
    }

    const facturesParStatut = { IMPAYEE: { n: 0, total_ttc: 0 }, PAYEE: { n: 0, total_ttc: 0 }, ANNULEE: { n: 0, total_ttc: 0 } };
    let facturesTotal = 0;
    for (const row of facturesResult.rows) {
      facturesParStatut[row.statut] = { n: row.n, total_ttc: Number(row.total_ttc) };
      facturesTotal += row.n;
    }
    // Chiffre d'affaires "actif" = hors factures annulees (une facture
    // annulee ne represente pas une vente reelle).
    const totalTtcPaye = facturesParStatut.PAYEE.total_ttc;
    const totalTtcImpaye = facturesParStatut.IMPAYEE.total_ttc;

    res.json({
      consultations: { total: consultationsTotal, par_statut: consultationsParStatut },
      devis: { total: devisTotal, par_statut: devisParStatut, convertis_en_facture: devisFacturesResult.rows[0].n },
      factures: {
        total: facturesTotal,
        par_statut: facturesParStatut,
        total_ttc_facture: totalTtcPaye + totalTtcImpaye,
        total_ttc_paye: totalTtcPaye,
        total_ttc_impaye: totalTtcImpaye,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_STATISTIQUES_FETCH_ERROR") });
  }
});

// GET /suivi - vue consolidee "une ligne par devis", enrichie de sa facture
// et son BL s'ils existent : equivalent generique du tableau "Suivi Global"
// que Steeve tenait a la main dans Excel, toujours a jour puisque genere a
// la volee depuis les memes donnees que les pages Devis/Factures/BL.
router.get("/suivi", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         d.id AS devis_id, d.numero AS devis_numero, d.statut AS devis_statut,
         d.date_devis, d.objet, d.total_ht AS devis_total_ht, d.total_ttc AS devis_total_ttc,
         cl.nom AS client_nom,
         f.id AS facture_id, f.numero AS facture_numero, f.mois_emission AS facture_mois_emission,
         f.statut AS facture_statut, f.date_facture, f.date_echeance,
         f.total_ttc AS facture_total_ttc, f.reference_bc_client,
         bl.id AS bl_id, bl.numero AS bl_numero, bl.statut AS bl_statut, bl.date_bl
       FROM devis d
       JOIN client_commercial cl ON cl.id = d.client_commercial_id
       LEFT JOIN facture_vente f ON f.devis_id = d.id
       LEFT JOIN bon_livraison bl ON bl.facture_vente_id = f.id
       WHERE d.tenant_id = $1
       ORDER BY d.date_devis DESC, d.date_creation DESC
       LIMIT 500`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_SUIVI_FETCH_ERROR") });
  }
});

module.exports = router;
