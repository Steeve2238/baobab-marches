const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, requireRoleOuValidateurUniversel, requireModule, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { genererChronogrammeConsultation } = require("../services/chronogrammeConsultationEngine");
const { assurerTiersPourClientSilencieux } = require("../services/comptaService");
const comptaVentes = require("../services/comptaVentes");
const { verifierAffectationValide } = require("../utils/affectationTache");

const router = express.Router();
router.use(requireAuth);

// Import Excel des devis historiques (30/09/2026) - meme limite que l'import
// de fiches de temps RH (5 Mo, largement suffisant pour quelques centaines
// de lignes de resume).
const uploadExcelDevis = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

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
//   - ECRITURE : seules les routes de DECISION sur un devis sont autorisees
//     sans "marches" - valider/changer son statut (ce qui couvre le refus),
//     et depuis le 02/10/2026 (demande de Steeve, meme logique : "uniquement
//     le DG ou le directeur financier") corriger son client ou le supprimer
//     (routes dediees PATCH /devis/:id/client et DELETE /devis/:id,
//     justement separees de l'edition generale PATCH /devis/:id pour pouvoir
//     les lister ici sans ouvrir celle-ci - creation de devis/consultations,
//     edition des lignes/remise et facturation restent hors de son perimetre
//     standard, inchangees.
router.use((req, res, next) => {
  const estValidateurUniversel = !!req.user?.permissions?.validateurUniversel;
  if (estValidateurUniversel) {
    if (req.method === "GET") return next();
    const estRouteDecisionDevis =
      (req.method === "POST" && /^\/devis\/[^/]+\/valider$/.test(req.path)) ||
      (req.method === "PATCH" && /^\/devis\/[^/]+\/statut$/.test(req.path)) ||
      (req.method === "PATCH" && /^\/devis\/[^/]+\/client$/.test(req.path)) ||
      (req.method === "DELETE" && /^\/devis\/[^/]+$/.test(req.path));
    if (estRouteDecisionDevis) return next();
  }
  return requireModule("marches")(req, res, next);
});

// Bloque toute ecriture pour un role marque "lecture seule" (ADMIN jamais
// concerne) - meme convention que les autres modules (fournisseurs.js,
// chronogramme.js...). Ajoute le 07/09/2026 en meme temps que la
// suppression de ROLES_CREATION/ROLES_FACTURATION ci-dessous : ce module
// utilisait jusque-la son propre systeme de codes de role en dur, qui ne
// reconnaissait QUE les codes exacts "COMMERCIAL"/"ADMINISTRATIF" (creation)
// et "COMPTABLE"/"FINANCIER" (facturation) - or les roles sont librement
// nommes par tenant (voir routes/roles.js) et rien n'indiquait qu'il fallait
// utiliser ces codes precis. Resultat concret chez Steeve : ses roles reels
// ("AA" Assistante administrative, "AC" Assistante comptable...) ne
// matchaient aucun de ces codes, donc SEUL le compte ADMIN pouvait creer un
// client/une consultation/un devis ou gerer une facture/un BL, quel que soit
// le module coche sur le role. Corrige en retombant sur le meme systeme
// modules + lecture-seule que le reste de la plateforme : un role avec le
// module "Marches" coche (et qui n'est pas 100% lecture seule) peut
// desormais creer/gerer clients, consultations, devis, factures et BL.
router.use(blockLectureSeule);

// ----------------------------------------------------------------------------
// Module Ventes/Negoce (cadre avec Steeve le 04/09/2026, voir
// claude/resume_reprise_projet.md) : Consultation -> Devis (valide par la
// Direction) -> Facture -> Bon de livraison, avec numerotation automatique
// et calculs (HT/TVA/TTC) toujours faits cote serveur (jamais fait confiance
// a des totaux envoyes par le frontend).
//
// Creation/edition (clients, consultations, devis) et facturation
// (facture/BL) : ouvertes a tout role ayant le module "Marches" et qui n'est
// pas en lecture seule (cf. blockLectureSeule ci-dessus) - plus de
// restriction par code de role en dur pour ces actions (voir la note
// ci-dessus sur pourquoi ROLES_CREATION/ROLES_FACTURATION ont ete retires).
//
// Validation d'un devis (routes /valider et /statut) : reste plus stricte,
// reservee a un "validateur universel" (Directeur General ou Directeur
// Financier - voir requireRoleOuValidateurUniversel, Phase 2 du systeme de
// permissions par role, 05/09/2026) ou au code de role DIRECTION pour
// compatibilite. Steeve a explicitement demande que le Directeur Financier
// puisse valider a la place du Directeur General en cas d'absence, et
// inversement - c'est une decision d'approbation, volontairement gardee
// distincte du simple acces au module.
//
// La LECTURE (GET) n'est pas restreinte par role : "consultation restreinte"
// dans la demande de Steeve designe la 1ere etape du flux commercial (une
// demande recue d'un client), pas un acces limite en lecture - confirme
// avec lui avant de coder.
// ----------------------------------------------------------------------------

const ROLES_CREATION = ["COMMERCIAL", "ADMINISTRATIF"];
const ROLES_VALIDATION = ["DIRECTION"];

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
//
// Remise en pourcentage (chantier du 01/10/2026, demande ecrite du client) :
// decision de Steeve, se calcule sur le HT, AVANT la TVA. total_ht reste la
// somme BRUTE des lignes (inchange, c'est ce que signifie ce champ partout
// ailleurs dans le systeme) ; montant_remise = total_ht * pourcentage/100 ;
// la TVA et le total TTC sont ensuite calcules sur le HT NET de remise. Si
// aucun pourcentage n'est fourni (devis sans remise, cas normal), le calcul
// est strictement identique a avant.
//
// Lignes non chiffrees (chantier du 04/10/2026) : le prix unitaire peut etre
// un nombre OU une mention texte ("NC", "Non chiffre", "En attente
// d'informations"...). Une ligne a mention texte (ou sans prix) est enregistree
// avec non_chiffre = true et sa mention ; elle est EXCLUE de total_ht (jamais
// comptee comme un montant nul valide). Un 0 saisi explicitement reste un prix
// chiffre. nb_lignes_non_chiffrees permet de signaler un total partiel.
const MENTION_PRIX_DEFAUT = "NC";
const MENTION_PRIX_MAX = 80;

// Renvoie { chiffre: true, valeur } | { chiffre: false, mention } | { invalide: true }.
function analyserPrixLigne(brut) {
  if (brut && brut.non_chiffre === true) {
    return { chiffre: false, mention: normaliserMentionPrix(brut.mention_prix) };
  }
  const valeurBrute = brut ? brut.prix_unitaire_ht : undefined;
  if (typeof valeurBrute === "number") {
    if (!Number.isFinite(valeurBrute) || valeurBrute < 0) return { invalide: true };
    return { chiffre: true, valeur: valeurBrute };
  }
  if (valeurBrute === undefined || valeurBrute === null) {
    return { chiffre: false, mention: MENTION_PRIX_DEFAUT };
  }
  const texte = String(valeurBrute).trim();
  if (texte === "") return { chiffre: false, mention: MENTION_PRIX_DEFAUT };
  // Nombre ecrit en texte : "1500", "1 500", "1500,50", "1500.50"
  const compact = texte.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (/^-?\d+(\.\d+)?$/.test(compact)) {
    const valeur = Number(compact);
    if (!Number.isFinite(valeur) || valeur < 0) return { invalide: true };
    return { chiffre: true, valeur };
  }
  return { chiffre: false, mention: normaliserMentionPrix(texte) };
}

function normaliserMentionPrix(brut) {
  const texte = String(brut === undefined || brut === null ? "" : brut).replace(/\s+/g, " ").trim();
  return (texte || MENTION_PRIX_DEFAUT).slice(0, MENTION_PRIX_MAX);
}

function calculerLignesEtTotaux(lignesBrutes, tauxTva, pourcentageRemiseBrut) {
  if (!Array.isArray(lignesBrutes) || lignesBrutes.length === 0) {
    return { erreur: "VIDE" };
  }
  const lignes = [];
  let totalHt = 0;
  let nbNonChiffrees = 0;
  for (const brut of lignesBrutes) {
    const quantite = Number(brut.quantite);
    const designation = typeof brut.designation === "string" ? brut.designation.trim() : "";
    const prix = analyserPrixLigne(brut);
    if (!designation || !Number.isFinite(quantite) || quantite <= 0 || prix.invalide) {
      return { erreur: "LIGNE_INVALIDE" };
    }
    if (!prix.chiffre) {
      nbNonChiffrees += 1;
      lignes.push({
        designation,
        unite: (brut.unite || "U").trim(),
        quantite,
        prix_unitaire_ht: 0,
        montant_ht: 0,
        non_chiffre: true,
        mention_prix: prix.mention,
      });
      continue;
    }
    const montantHt = Math.round(quantite * prix.valeur * 100) / 100;
    lignes.push({
      designation,
      unite: (brut.unite || "U").trim(),
      quantite,
      prix_unitaire_ht: prix.valeur,
      montant_ht: montantHt,
      non_chiffre: false,
      mention_prix: null,
    });
    totalHt += montantHt;
  }
  totalHt = Math.round(totalHt * 100) / 100;

  const pourcentageRemise = pourcentageRemiseBrut === undefined || pourcentageRemiseBrut === null || pourcentageRemiseBrut === ""
    ? 0
    : Number(pourcentageRemiseBrut);
  if (!Number.isFinite(pourcentageRemise) || pourcentageRemise < 0 || pourcentageRemise > 100) {
    return { erreur: "REMISE_INVALIDE" };
  }

  const montantRemise = Math.round(totalHt * (pourcentageRemise / 100) * 100) / 100;
  const totalHtNet = Math.round((totalHt - montantRemise) * 100) / 100;
  const montantTva = Math.round(totalHtNet * (Number(tauxTva) / 100) * 100) / 100;
  const totalTtc = Math.round((totalHtNet + montantTva) * 100) / 100;
  return {
    lignes,
    total_ht: totalHt,
    pourcentage_remise: pourcentageRemise,
    montant_remise: montantRemise,
    montant_tva: montantTva,
    total_ttc: totalTtc,
    nb_lignes_non_chiffrees: nbNonChiffrees,
  };
}

// Calcule l'avancement de facturation d'un devis : somme des montants nets a
// payer deja factures (hors factures ANNULEEs) et ce qu'il reste a facturer.
// Utilise a la fois pour bloquer un depassement (generer-facture) et pour
// l'affichage (fiche devis, compte client). "queryable" est soit le pool
// (db.query) soit un client de transaction (meme forme d'appel .query) -
// permet de reutiliser cette fonction dans une transaction verrouillee (FOR
// UPDATE sur le devis) sans changer de connexion en cours de route.
async function calculerAvancementFacturation(queryable, tenantId, devisId, totalTtcDevis) {
  const result = await queryable.query(
    `SELECT COALESCE(SUM(montant_net_a_payer), 0) AS total
     FROM facture_vente WHERE devis_id = $1 AND tenant_id = $2 AND statut != 'ANNULEE'`,
    [devisId, tenantId]
  );
  const dejaFacture = Math.round(Number(result.rows[0].total) * 100) / 100;
  const resteAFacturer = Math.round((Number(totalTtcDevis) - dejaFacture) * 100) / 100;
  return { deja_facture: dejaFacture, reste_a_facturer: resteAFacturer };
}

// Mapping tolerant du statut texte libre saisi par le client dans le
// fichier Excel d'import (30/09/2026) vers les statuts normalises de Baobab
// - une valeur vide ou non reconnue tombe sur BROUILLON plutot que de
// bloquer la ligne (meme philosophie que l'import de fiches de temps RH,
// voir routes/rh.js : on ne perd jamais une ligne pour une valeur de texte
// libre inattendue, on la signale juste dans le rapport d'import).
const SYNONYMES_STATUT_IMPORT = {
  VALIDE: ["VALIDE", "ACCEPTE", "GAGNE"],
  ENVOYE: ["ENVOYE", "EN ATTENTE", "EN COURS"],
  REFUSE: ["REFUSE", "PERDU", "REJETE"],
  EXPIRE: ["EXPIRE", "SANS SUITE", "ANNULE"],
};
function retirerAccents(valeur) {
  return valeur.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function normaliserStatutImport(brut) {
  const valeur = retirerAccents(String(brut || "").trim().toUpperCase());
  if (!valeur) return { statut: "BROUILLON", reconnu: true };
  for (const [statut, synonymes] of Object.entries(SYNONYMES_STATUT_IMPORT)) {
    if (synonymes.includes(valeur)) return { statut, reconnu: true };
  }
  return { statut: "BROUILLON", reconnu: false, brut: String(brut).trim() };
}

async function chargerLignesDevis(devisId) {
  const result = await db.query(
    `SELECT id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht, non_chiffre, mention_prix
     FROM devis_ligne WHERE devis_id = $1 ORDER BY ordre ASC`,
    [devisId]
  );
  return result.rows;
}

async function chargerLignesFacture(factureId) {
  const result = await db.query(
    `SELECT id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht, non_chiffre, mention_prix
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

router.post("/clients", async (req, res) => {
  const { nom, adresse, telephone, email } = req.body;
  if (!nom || !nom.trim()) {
    return res.status(400).json({ error: t(req, "VENTE_CLIENT_FIELDS_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO client_commercial (id, tenant_id, nom, adresse, telephone, email)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [uuidv4(), req.user.tenantId, nom.trim(), adresse || null, telephone || null, email || null]
    );
    // Compte tiers comptable (CAxxx) : cree automatiquement, sans jamais faire echouer la creation du client.
    await assurerTiersPourClientSilencieux(req.user.tenantId, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_CLIENT_CREATE_ERROR") });
  }
});

router.patch("/clients/:id", async (req, res) => {
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
    // Repercute le nouveau nom sur le compte tiers (le code du tiers, lui, ne change jamais).
    await assurerTiersPourClientSilencieux(req.user.tenantId, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_CLIENT_UPDATE_ERROR") });
  }
});

// GET /clients/:id/compte - "compte client" demande par Steeve le 30/09/2026
// en complement de la facturation en plusieurs fois (acompte/solde) : vue
// consolidee de ce qu'un client doit au total, tous devis confondus (total
// facture, total deja paye, solde restant du), plus le detail devis par
// devis (facture/reste a facturer) et facture par facture.
router.get("/clients/:id/compte", async (req, res) => {
  const { id } = req.params;
  try {
    const clientResult = await db.query(
      `SELECT * FROM client_commercial WHERE id = $1 AND tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ error: t(req, "VENTE_CLIENT_NOT_FOUND") });
    }

    const devisResult = await db.query(
      `SELECT d.id, d.numero, d.statut, d.date_devis, d.objet, d.total_ttc,
              COALESCE((
                SELECT SUM(f.montant_net_a_payer) FROM facture_vente f
                WHERE f.devis_id = d.id AND f.statut != 'ANNULEE'
              ), 0) AS deja_facture
       FROM devis d
       WHERE d.client_commercial_id = $1 AND d.tenant_id = $2
       ORDER BY d.date_creation DESC`,
      [id, req.user.tenantId]
    );
    const devis = devisResult.rows.map((d) => ({
      ...d,
      reste_a_facturer: Math.round((Number(d.total_ttc) - Number(d.deja_facture)) * 100) / 100,
    }));

    const facturesResult = await db.query(
      `SELECT f.id, f.numero, f.mois_emission, f.devis_id, d.numero AS devis_numero,
              f.type_facturation, f.pourcentage_acompte, f.montant_net_a_payer,
              f.statut, f.date_facture, f.date_echeance
       FROM facture_vente f
       JOIN devis d ON d.id = f.devis_id
       WHERE f.client_commercial_id = $1 AND f.tenant_id = $2
       ORDER BY f.date_creation DESC`,
      [id, req.user.tenantId]
    );

    let totalFacture = 0;
    let totalPaye = 0;
    for (const f of facturesResult.rows) {
      if (f.statut === "ANNULEE") continue;
      totalFacture += Number(f.montant_net_a_payer);
      if (f.statut === "PAYEE") totalPaye += Number(f.montant_net_a_payer);
    }
    totalFacture = Math.round(totalFacture * 100) / 100;
    totalPaye = Math.round(totalPaye * 100) / 100;
    const soldeDu = Math.round((totalFacture - totalPaye) * 100) / 100;

    res.json({
      client: clientResult.rows[0],
      totaux: { total_facture: totalFacture, total_paye: totalPaye, solde_du: soldeDu },
      devis,
      factures: facturesResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_CLIENT_COMPTE_FETCH_ERROR") });
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

router.post("/consultations", async (req, res) => {
  const { client_commercial_id, objet, date_reception, notes } = req.body;
  if (!client_commercial_id || !objet || !objet.trim()) {
    return res.status(400).json({ error: t(req, "VENTE_CONSULTATION_FIELDS_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO consultation (id, tenant_id, client_commercial_id, objet, date_reception, notes, cree_par)
       VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6, $7) RETURNING *`,
      [uuidv4(), req.user.tenantId, client_commercial_id, objet.trim(), date_reception || null, notes || null, req.user.sub]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_CONSULTATION_CREATE_ERROR") });
  }
});

// GET /api/ventes/consultations/:id - fiche detaillee d'une consultation :
// infos client, chronogramme (taches propres a cette consultation, voir
// consultation_tache) et devis eventuellement deja lies - necessaire a la
// page de detail (chronogramme + lien "Creer un devis").
router.get("/consultations/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT c.*, cl.nom AS client_nom, cl.adresse AS client_adresse,
              cl.telephone AS client_telephone, cl.email AS client_email
       FROM consultation c JOIN client_commercial cl ON cl.id = c.client_commercial_id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "VENTE_CONSULTATION_NOT_FOUND") });
    }
    const tachesResult = await db.query(
      `SELECT * FROM consultation_tache WHERE consultation_id = $1 ORDER BY ordre_affichage ASC`,
      [id]
    );
    const devisResult = await db.query(
      `SELECT id, numero, statut FROM devis WHERE consultation_id = $1 AND tenant_id = $2`,
      [id, req.user.tenantId]
    );
    res.json({ ...result.rows[0], taches: tachesResult.rows, devis: devisResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_CONSULTATION_FETCH_ERROR") });
  }
});

router.patch("/consultations/:id", async (req, res) => {
  const { id } = req.params;
  const { objet, statut, notes, date_limite_reponse } = req.body;
  try {
    const result = await db.query(
      `UPDATE consultation
       SET objet = COALESCE($1, objet), statut = COALESCE($2, statut), notes = $3,
           date_limite_reponse = COALESCE($4, date_limite_reponse)
       WHERE id = $5 AND tenant_id = $6 RETURNING *`,
      [objet || null, statut || null, notes || null, date_limite_reponse || null, id, req.user.tenantId]
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
// Chronogramme d'une consultation (voir services/chronogrammeConsultationEngine.js
// et migrations/020_chronogramme_consultation.sql) - meme principe que le
// chronogramme d'un dossier d'AO (routes/chronogramme.js) mais retro-planning
// PROPORTIONNEL (pas d'offsets fixes) et sans notion de "phase". Les taches
// creees ici remontent aussi dans GET /api/chronogramme/mes-taches (voir
// l'UNION ALL ajoutee dans routes/chronogramme.js le 07/09/2026).
// ----------------------------------------------------------------------------

// POST /api/ventes/consultations/:id/chronogramme/generer - genere le
// retro-planning standard a partir de date_reception / date_limite_reponse.
// Meme garde-fou anti-doublon que pour un dossier d'AO : refuse si des
// taches existent deja pour cette consultation, sauf ?force=true (auquel cas
// les anciennes taches sont supprimees puis remplacees).
router.post("/consultations/:id/chronogramme/generer", async (req, res) => {
  const { id } = req.params;
  const force = req.query.force === "true";

  try {
    const consultationResult = await db.query(
      `SELECT * FROM consultation WHERE id = $1 AND tenant_id = $2`,
      [id, req.user.tenantId]
    );
    const consultation = consultationResult.rows[0];
    if (!consultation) {
      return res.status(404).json({ error: t(req, "VENTE_CONSULTATION_NOT_FOUND") });
    }

    const existantResult = await db.query(
      `SELECT id FROM consultation_tache WHERE consultation_id = $1 LIMIT 1`,
      [id]
    );
    if (existantResult.rows.length > 0 && !force) {
      return res.status(409).json({ error: t(req, "VENTE_CHRONOGRAMME_ALREADY_EXISTS") });
    }

    let taches;
    try {
      taches = genererChronogrammeConsultation(consultation);
    } catch (err) {
      if (err.message === "DATE_LIMITE_REPONSE_REQUISE") {
        return res.status(400).json({ error: t(req, "VENTE_CHRONOGRAMME_DATE_LIMITE_REQUISE") });
      }
      throw err;
    }

    if (force && existantResult.rows.length > 0) {
      await db.query(`DELETE FROM consultation_tache WHERE consultation_id = $1`, [id]);
    }

    const inserees = [];
    for (const tache of taches) {
      const result = await db.query(
        `INSERT INTO consultation_tache
           (id, consultation_id, intitule, jalon_relatif, date_echeance, statut, ordre_affichage)
         VALUES ($1, $2, $3, $4, $5, 'A_FAIRE', $6)
         RETURNING *`,
        [uuidv4(), id, tache.intitule, tache.jalon_relatif, tache.date_echeance, tache.ordre_affichage]
      );
      inserees.push(result.rows[0]);
    }

    res.status(201).json(inserees);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CHRONOGRAMME_GENERATE_ERROR") });
  }
});

// POST /api/ventes/consultations/:id/chronogramme/taches - ajout manuel
// d'une tache au chronogramme d'une consultation.
router.post("/consultations/:id/chronogramme/taches", async (req, res) => {
  const { id } = req.params;
  const {
    intitule,
    jalon_relatif,
    date_echeance,
    role_porteur_id,
    assigne_utilisateur_id,
    document_attendu,
    ordre_affichage,
  } = req.body;

  if (!intitule || !intitule.trim()) {
    return res.status(400).json({ error: t(req, "VENTE_CONSULTATION_TACHE_FIELDS_REQUIRED") });
  }

  try {
    const consultationCheck = await db.query(
      `SELECT id FROM consultation WHERE id = $1 AND tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (consultationCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "VENTE_CONSULTATION_NOT_FOUND") });
    }

    const erreurAffectation = await verifierAffectationValide(
      req.user.tenantId,
      role_porteur_id,
      assigne_utilisateur_id
    );
    if (erreurAffectation) {
      return res.status(400).json({ error: t(req, erreurAffectation) });
    }

    const result = await db.query(
      `INSERT INTO consultation_tache
         (id, consultation_id, intitule, jalon_relatif, date_echeance, role_porteur_id,
          assigne_utilisateur_id, document_attendu, statut, ordre_affichage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'A_FAIRE', COALESCE($9, 0))
       RETURNING *`,
      [
        uuidv4(),
        id,
        intitule.trim(),
        jalon_relatif || null,
        date_echeance || null,
        role_porteur_id || null,
        assigne_utilisateur_id || null,
        document_attendu || null,
        ordre_affichage,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "TACHE_CREATE_ERROR") });
  }
});

// PATCH /api/ventes/consultations/chronogramme-taches/:id - mise a jour du
// statut et/ou de l'affectation d'une tache de consultation. Route separee
// (prefixe "chronogramme-taches") plutot que "/consultations/:id/taches/:tacheId"
// pour rester coherente avec la forme utilisee par le chronogramme des
// dossiers d'AO (PATCH /api/chronogramme/taches/:id, un seul id necessaire
// cote frontend pour agir sur une tache).
router.patch("/consultations/chronogramme-taches/:id", async (req, res) => {
  const { id } = req.params;
  let { statut, role_porteur_id, assigne_utilisateur_id } = req.body;
  if (role_porteur_id === "") role_porteur_id = null;
  if (assigne_utilisateur_id === "") assigne_utilisateur_id = null;
  const statutsValides = ["A_FAIRE", "EN_COURS", "FAIT", "EN_RETARD"];

  if (statut === undefined && role_porteur_id === undefined && assigne_utilisateur_id === undefined) {
    return res.status(400).json({ error: t(req, "TACHE_FIELDS_REQUIRED") });
  }
  if (statut !== undefined && !statutsValides.includes(statut)) {
    return res.status(400).json({ error: t(req, "STATUT_INVALID") });
  }

  try {
    const erreurAffectation = await verifierAffectationValide(
      req.user.tenantId,
      role_porteur_id,
      assigne_utilisateur_id
    );
    if (erreurAffectation) {
      return res.status(400).json({ error: t(req, erreurAffectation) });
    }

    const colonnes = [];
    const valeurs = [];
    if (statut !== undefined) {
      colonnes.push(`statut = $${colonnes.length + 1}`);
      valeurs.push(statut);
    }
    if (role_porteur_id !== undefined) {
      colonnes.push(`role_porteur_id = $${colonnes.length + 1}`);
      valeurs.push(role_porteur_id);
    }
    if (assigne_utilisateur_id !== undefined) {
      colonnes.push(`assigne_utilisateur_id = $${colonnes.length + 1}`);
      valeurs.push(assigne_utilisateur_id);
    }

    const idxId = valeurs.length + 1;
    const idxTenant = valeurs.length + 2;
    const result = await db.query(
      `UPDATE consultation_tache cst
       SET ${colonnes.join(", ")}
       FROM consultation cons
       WHERE cst.id = $${idxId} AND cst.consultation_id = cons.id AND cons.tenant_id = $${idxTenant}
       RETURNING cst.*`,
      [...valeurs, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "TACHE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "TACHE_STATUT_UPDATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Devis
// ----------------------------------------------------------------------------

router.get("/devis", async (req, res) => {
  const { statut } = req.query;
  try {
    // a_facture (chantier du 02/10/2026, bouton Supprimer sur cette liste) :
    // indique si au moins une facture existe deja sur ce devis, pour que le
    // frontend puisse griser/masquer le bouton plutot que de laisser
    // cliquer sur une suppression qui echouera a coup sur (voir DELETE
    // /devis/:id, qui refuse dans ce cas).
    const result = await db.query(
      statut
        ? `SELECT d.*, cl.nom AS client_nom,
                  EXISTS(SELECT 1 FROM facture_vente fv WHERE fv.devis_id = d.id) AS a_facture
           FROM devis d JOIN client_commercial cl ON cl.id = d.client_commercial_id
           WHERE d.tenant_id = $1 AND d.statut = $2 ORDER BY d.date_creation DESC`
        : `SELECT d.*, cl.nom AS client_nom,
                  EXISTS(SELECT 1 FROM facture_vente fv WHERE fv.devis_id = d.id) AS a_facture
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

// GET /devis/modele-import - modele Excel vierge telechargeable pour l'import
// de devis historiques (place AVANT /devis/:id : sinon Express matcherait
// "modele-import" comme une valeur d'id, meme piege de routage que
// /rh/fiches-temps/modele-import, voir routes/rh.js).
router.get("/devis/modele-import", (req, res) => {
  try {
    const enTetes = ["Numero d'origine", "Client", "Date (AAAA-MM-JJ)", "Objet", "Montant total TTC", "Statut"];
    const legende = [
      [],
      ["Valeurs de statut reconnues (une valeur vide ou non reconnue est importee en Brouillon) :"],
      ["Valide, Accepte ou Gagne  ->  Valide"],
      ["Envoye, En attente ou En cours  ->  Envoye"],
      ["Refuse, Perdu ou Rejete  ->  Refuse"],
      ["Expire, Sans suite ou Annule  ->  Expire"],
      [],
      ["Le numero d'origine est conserve tel quel (ex : 299) - ne pas utiliser le format DEV-AAAA-MM-NNNN."],
      ["Un client dont le nom ne correspond a aucun client existant est cree automatiquement."],
    ];
    const feuille = XLSX.utils.aoa_to_sheet([enTetes, [], ...legende]);
    feuille["!cols"] = [{ wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 32 }, { wch: 16 }, { wch: 14 }];
    const classeur = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(classeur, feuille, "Devis historiques");
    const buffer = XLSX.write(classeur, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="modele_import_devis_historiques.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_DEVIS_IMPORT_MODELE_ERROR") });
  }
});

// POST /devis/importer - import tolerant des devis historiques (30/09/2026,
// voir migration 025 pour le contexte complet). Une ligne invalide (numero
// manquant/deja utilise, client manquant, date/montant invalides) est
// signalee dans le rapport et sautee - jamais de blocage de tout le fichier
// pour une seule ligne en erreur.
router.post("/devis/importer", uploadExcelDevis.single("fichier"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: t(req, "VENTE_DEVIS_IMPORT_FILE_REQUIRED") });
  }
  let classeur;
  try {
    classeur = XLSX.read(req.file.buffer, { type: "buffer" });
  } catch {
    return res.status(400).json({ error: t(req, "VENTE_DEVIS_IMPORT_FILE_TYPE_INVALID") });
  }
  // XLSX.read est tolerant (ex : un fichier texte brut ne leve pas toujours
  // d'exception) - un classeur sans feuille est le signe fiable d'un fichier
  // qui n'est pas un vrai .xlsx.
  if (!classeur.SheetNames || classeur.SheetNames.length === 0) {
    return res.status(400).json({ error: t(req, "VENTE_DEVIS_IMPORT_FILE_TYPE_INVALID") });
  }
  const feuille = classeur.Sheets[classeur.SheetNames[0]];
  const lignesBrutes = XLSX.utils.sheet_to_json(feuille, { header: 1, defval: "" });

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    // Clients commerciaux existants (par nom normalise) - un nom qui ne
    // correspond a aucun client existant est cree a la volee : on ne
    // demande pas de preparer a l'avance une fiche pour chacun des 300
    // devis, import tolerant comme pour le reste de cette route.
    const clientsExistants = await client.query(`SELECT id, nom FROM client_commercial WHERE tenant_id = $1`, [req.user.tenantId]);
    const clientParNom = new Map(clientsExistants.rows.map((c) => [c.nom.trim().toLowerCase(), c.id]));

    const numerosExistants = new Set(
      (await client.query(`SELECT numero FROM devis WHERE tenant_id = $1`, [req.user.tenantId])).rows.map((d) => d.numero)
    );
    const numerosVusDansLeFichier = new Set();

    const erreurs = [];
    const anomaliesStatut = [];
    let nombreImportes = 0;
    const dateImport = new Date().toISOString().slice(0, 10);

    for (let i = 1; i < lignesBrutes.length; i++) {
      const ligneExcel = i + 1; // numero de ligne tel que vu dans Excel (1 = en-tetes)
      const [numeroBrut, clientBrut, dateBrut, objetBrut, montantBrut, statutBrut] = lignesBrutes[i];
      const numero = String(numeroBrut || "").trim();
      const nomClient = String(clientBrut || "").trim();
      const dateTexte = String(dateBrut || "").trim();
      const montant = Number(montantBrut);

      if (!numero && !nomClient && !dateTexte && !montantBrut) continue; // ligne vide (ou legende) : ignoree silencieusement

      if (!numero) {
        erreurs.push({ ligne: ligneExcel, numero: null, motif: t(req, "VENTE_DEVIS_IMPORT_NUMERO_REQUIS") });
        continue;
      }
      if (numerosExistants.has(numero) || numerosVusDansLeFichier.has(numero)) {
        erreurs.push({ ligne: ligneExcel, numero, motif: t(req, "VENTE_DEVIS_IMPORT_NUMERO_DOUBLON") });
        continue;
      }
      if (!nomClient) {
        erreurs.push({ ligne: ligneExcel, numero, motif: t(req, "VENTE_DEVIS_IMPORT_CLIENT_REQUIS") });
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTexte)) {
        erreurs.push({ ligne: ligneExcel, numero, motif: t(req, "VENTE_DEVIS_IMPORT_DATE_INVALID") });
        continue;
      }
      if (!Number.isFinite(montant) || montant <= 0) {
        erreurs.push({ ligne: ligneExcel, numero, motif: t(req, "VENTE_DEVIS_IMPORT_MONTANT_INVALID") });
        continue;
      }

      numerosVusDansLeFichier.add(numero);

      let clientCommercialId = clientParNom.get(nomClient.toLowerCase());
      if (!clientCommercialId) {
        clientCommercialId = uuidv4();
        await client.query(`INSERT INTO client_commercial (id, tenant_id, nom, actif) VALUES ($1, $2, $3, true)`, [
          clientCommercialId,
          req.user.tenantId,
          nomClient,
        ]);
        clientParNom.set(nomClient.toLowerCase(), clientCommercialId);
      }

      const objet = String(objetBrut || "").trim() || null;
      const { statut, reconnu, brut } = normaliserStatutImport(statutBrut);
      let notesImport = `Devis historique importe le ${dateImport}.`;
      if (!reconnu) {
        notesImport += ` Statut d'origine non reconnu ("${brut}") -> importe en Brouillon.`;
        anomaliesStatut.push({ ligne: ligneExcel, numero, statut_origine: brut });
      }

      // Resume global uniquement (decision Steeve, 30/09/2026) : ni detail
      // HT/TVA d'origine ni compteur de numerotation touches - le montant
      // saisi est stocke tel quel en TTC, avec taux_tva_pourcentage=0 pour
      // ne pas fabriquer une repartition HT/TVA que l'on ne connait pas.
      // Une seule ligne devis_ligne recapitulative est creee pour garder
      // l'invariant "un devis a au moins une ligne" utilise partout
      // ailleurs (edition, impression).
      const devisId = uuidv4();
      await client.query(
        `INSERT INTO devis (id, tenant_id, numero, client_commercial_id, objet, date_devis, statut,
                             taux_tva_pourcentage, total_ht, montant_tva, total_ttc, cree_par, importe, notes_import)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,0,$8,$9,true,$10)`,
        [devisId, req.user.tenantId, numero, clientCommercialId, objet, dateTexte, statut, montant, req.user.sub, notesImport]
      );
      await client.query(
        `INSERT INTO devis_ligne (id, devis_id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht)
         VALUES ($1,$2,0,$3,'FORFAIT',1,$4,$4)`,
        [uuidv4(), devisId, objet || t(req, "VENTE_DEVIS_IMPORT_LIGNE_DESIGNATION_DEFAUT"), montant]
      );
      nombreImportes++;
    }

    await client.query("COMMIT");
    res.json({ nombre_importes: nombreImportes, nombre_erreurs: erreurs.length, erreurs, anomalies_statut: anomaliesStatut });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_DEVIS_IMPORT_ERROR") });
  } finally {
    client.release();
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
    const devis = result.rows[0];
    const lignes = await chargerLignesDevis(id);
    // Un devis peut desormais donner lieu a PLUSIEURS factures (acompte(s) +
    // solde) - voir migration 024. "facture" (singulier) est conserve pour
    // compatibilite avec d'anciens clients caches, mais le frontend courant
    // utilise "factures" (tableau, le plus recent en premier) et l'avancement
    // calcule ci-dessous.
    const facturesResult = await db.query(
      `SELECT id, numero, statut, type_facturation, pourcentage_acompte, montant_net_a_payer, date_facture
       FROM facture_vente WHERE devis_id = $1 AND tenant_id = $2 ORDER BY date_creation DESC`,
      [id, req.user.tenantId]
    );
    const avancement = await calculerAvancementFacturation(db, req.user.tenantId, id, devis.total_ttc);
    res.json({
      ...devis,
      lignes,
      factures: facturesResult.rows,
      facture: facturesResult.rows[facturesResult.rows.length - 1] || null,
      ...avancement,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_DEVIS_FETCH_ERROR") });
  }
});

router.post("/devis", async (req, res) => {
  const { client_commercial_id, consultation_id, objet, date_devis, conditions_paiement, delai_livraison, validite_offre, lignes, pourcentage_remise } = req.body;
  // Numero manuel (chantier du 01/10/2026, demande ecrite du client) : reserve
  // a l'ADMIN, et uniquement a la creation (jamais modifiable ensuite, voir
  // PATCH /devis/:id qui ne l'accepte pas). Verification du role faite ici
  // explicitement (pas de middleware de role sur cette route, comme pour le
  // reste de la creation - voir note en tete de fichier).
  const numeroManuelBrut = typeof req.body.numero === "string" ? req.body.numero.trim() : "";
  if (!client_commercial_id) {
    return res.status(400).json({ error: t(req, "VENTE_DEVIS_FIELDS_REQUIRED") });
  }
  if (numeroManuelBrut && !req.user?.roles?.includes("ADMIN")) {
    return res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
  }
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const tenantResult = await client.query(`SELECT taux_tva_pourcentage FROM tenant WHERE id = $1`, [req.user.tenantId]);
    const tauxTva = tenantResult.rows[0].taux_tva_pourcentage;

    const calcul = calculerLignesEtTotaux(lignes, tauxTva, pourcentage_remise);
    if (calcul.erreur === "VIDE") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "VENTE_DEVIS_FIELDS_REQUIRED") });
    }
    if (calcul.erreur === "LIGNE_INVALIDE") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "VENTE_DEVIS_LIGNE_INVALID") });
    }
    if (calcul.erreur === "REMISE_INVALIDE") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "VENTE_DEVIS_REMISE_INVALID") });
    }

    let numero;
    if (numeroManuelBrut) {
      const doublon = await client.query(
        `SELECT 1 FROM devis WHERE tenant_id = $1 AND numero = $2`,
        [req.user.tenantId, numeroManuelBrut]
      );
      if (doublon.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: t(req, "VENTE_DEVIS_NUMERO_DEJA_UTILISE") });
      }
      numero = numeroManuelBrut;
    } else {
      const maintenant = new Date();
      const annee = maintenant.getFullYear();
      const mois = maintenant.getMonth() + 1;
      const sequence = await tirerProchainNumero(client, req.user.tenantId, "DEVIS", annee);
      numero = formaterNumeroDevis(annee, mois, sequence);
    }

    const devisResult = await client.query(
      `INSERT INTO devis (id, tenant_id, numero, consultation_id, client_commercial_id, objet, date_devis,
                           conditions_paiement, delai_livraison, validite_offre, taux_tva_pourcentage,
                           total_ht, pourcentage_remise, montant_remise, montant_tva, total_ttc, cree_par,
                           nb_lignes_non_chiffrees)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, CURRENT_DATE),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        uuidv4(), req.user.tenantId, numero, consultation_id || null, client_commercial_id, objet || null, date_devis || null,
        conditions_paiement || null, delai_livraison || null, validite_offre || null, tauxTva,
        calcul.total_ht, calcul.pourcentage_remise, calcul.montant_remise, calcul.montant_tva, calcul.total_ttc, req.user.sub,
        calcul.nb_lignes_non_chiffrees,
      ]
    );
    const devis = devisResult.rows[0];

    let ordre = 0;
    for (const ligne of calcul.lignes) {
      await client.query(
        `INSERT INTO devis_ligne (id, devis_id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht, non_chiffre, mention_prix)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [uuidv4(), devis.id, ordre++, ligne.designation, ligne.unite, ligne.quantite, ligne.prix_unitaire_ht, ligne.montant_ht, ligne.non_chiffre, ligne.mention_prix]
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

// PATCH /devis/:id - reedition des lignes/champs. Un devis EXPIRE reste
// fige. Un devis BROUILLON/ENVOYE/REFUSE se modifie sans consequence sur son
// statut. Un devis VALIDE (chantier du 06/10/2026 avec Steeve : "on doit
// pouvoir corriger un devis deja entierement facture, ex avenant/ligne
// oubliee") reste modifiable lui aussi, MAIS toute modification le refait
// systematiquement repasser en BROUILLON (perd sa validation et son
// eventuelle date de validation) - il doit etre revalide par la Direction
// avant de pouvoir generer une nouvelle facture dessus (voir
// POST /devis/:id/generer-facture, qui exige toujours statut === VALIDE).
// Garde-fou associe : si la modification fait baisser le total en dessous de
// ce qui a deja ete facture dessus (factures non annulees), elle est
// refusee - jamais de "reste a facturer" negatif.
router.patch("/devis/:id", async (req, res) => {
  const { id } = req.params;
  const { objet, date_devis, conditions_paiement, delai_livraison, validite_offre, lignes, pourcentage_remise } = req.body;
  // NB : le numero n'est volontairement jamais accepte ici - un numero
  // manuel (ADMIN) ne peut etre choisi qu'a la creation (POST /devis), voir
  // decision de Steeve du 01/10/2026. Le client non plus (chantier du
  // 02/10/2026) : voir la route dediee PATCH /devis/:id/client ci-dessous,
  // volontairement separee de celle-ci pour rester accessible au DG/
  // Directeur Financier meme quand "marches" n'est pas dans son perimetre
  // (voir le router.use plus haut dans ce fichier).

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
    if (!["BROUILLON", "ENVOYE", "REFUSE", "VALIDE"].includes(devisActuel.statut)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "VENTE_DEVIS_NOT_EDITABLE") });
    }

    let totaux = {
      total_ht: devisActuel.total_ht,
      pourcentage_remise: devisActuel.pourcentage_remise,
      montant_remise: devisActuel.montant_remise,
      montant_tva: devisActuel.montant_tva,
      total_ttc: devisActuel.total_ttc,
      nb_lignes_non_chiffrees: devisActuel.nb_lignes_non_chiffrees,
    };
    // La remise peut etre modifiee meme sans retoucher les lignes (ex :
    // negociation apres coup sur un devis deja chiffre) - on recalcule alors
    // les totaux a partir des lignes existantes.
    if (lignes || pourcentage_remise !== undefined) {
      const lignesPourCalcul = lignes || (await chargerLignesDevis(id)).map((l) => ({
        designation: l.designation, unite: l.unite, quantite: l.quantite, prix_unitaire_ht: l.prix_unitaire_ht,
        non_chiffre: l.non_chiffre, mention_prix: l.mention_prix,
      }));
      const remisePourCalcul = pourcentage_remise !== undefined ? pourcentage_remise : devisActuel.pourcentage_remise;
      const calcul = calculerLignesEtTotaux(lignesPourCalcul, devisActuel.taux_tva_pourcentage, remisePourCalcul);
      if (calcul.erreur === "VIDE") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "VENTE_DEVIS_FIELDS_REQUIRED") });
      }
      if (calcul.erreur === "LIGNE_INVALIDE") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "VENTE_DEVIS_LIGNE_INVALID") });
      }
      if (calcul.erreur === "REMISE_INVALIDE") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "VENTE_DEVIS_REMISE_INVALID") });
      }

      // Le verrou FOR UPDATE ci-dessus serialise toute generation concurrente
      // de facture sur ce devis - la somme deja facturee est donc a jour.
      const { deja_facture: dejaFacture } = await calculerAvancementFacturation(client, req.user.tenantId, id, calcul.total_ttc);
      if (calcul.total_ttc + 0.01 < dejaFacture) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: t(req, "VENTE_DEVIS_MONTANT_INFERIEUR_FACTURE") });
      }

      if (lignes) {
        await client.query(`DELETE FROM devis_ligne WHERE devis_id = $1`, [id]);
        let ordre = 0;
        for (const ligne of calcul.lignes) {
          await client.query(
            `INSERT INTO devis_ligne (id, devis_id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht, non_chiffre, mention_prix)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [uuidv4(), id, ordre++, ligne.designation, ligne.unite, ligne.quantite, ligne.prix_unitaire_ht, ligne.montant_ht, ligne.non_chiffre, ligne.mention_prix]
          );
        }
      }
      totaux = calcul;
    }

    const repasseEnBrouillon = devisActuel.statut === "VALIDE";

    await client.query(
      `UPDATE devis
       SET objet = COALESCE($1, objet), date_devis = COALESCE($2, date_devis),
           conditions_paiement = $3, delai_livraison = $4, validite_offre = $5,
           total_ht = $6, pourcentage_remise = $7, montant_remise = $8, montant_tva = $9, total_ttc = $10,
           statut = CASE WHEN $11 THEN 'BROUILLON' ELSE statut END,
           valide_par = CASE WHEN $11 THEN NULL ELSE valide_par END,
           date_validation = CASE WHEN $11 THEN NULL ELSE date_validation END,
           nb_lignes_non_chiffrees = $14
       WHERE id = $12 AND tenant_id = $13`,
      [
        objet || null, date_devis || null, conditions_paiement || null, delai_livraison || null, validite_offre || null,
        totaux.total_ht, totaux.pourcentage_remise, totaux.montant_remise, totaux.montant_tva, totaux.total_ttc,
        repasseEnBrouillon, id, req.user.tenantId, totaux.nb_lignes_non_chiffrees || 0,
      ]
    );
    // Relit avec la jointure client (comme GET /devis/:id) plutot que de
    // renvoyer le simple RETURNING * de l'UPDATE : le meme bug existait deja
    // avant le chantier du 02/10/2026 (RETURNING * ne contient jamais les
    // colonnes jointes client_nom/client_adresse), decouvert et corrige a
    // cette occasion - sans cette relecture, l'ecran se retrouvait avec un
    // nom de client vide apres n'importe quelle edition tant que la page
    // n'etait pas rechargee.
    const devisAvecClient = await client.query(
      `SELECT d.*, cl.nom AS client_nom, cl.adresse AS client_adresse
       FROM devis d JOIN client_commercial cl ON cl.id = d.client_commercial_id
       WHERE d.id = $1`,
      [id]
    );
    await client.query("COMMIT");
    const nouvellesLignes = await chargerLignesDevis(id);
    res.json({ ...devisAvecClient.rows[0], lignes: nouvellesLignes });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_DEVIS_UPDATE_ERROR") });
  } finally {
    client.release();
  }
});

// PATCH /devis/:id/client - correction du client sur un devis deja cree
// (chantier du 02/10/2026, demande de Steeve : "ils se sont trompes de
// client... il faudrait le rendre accessible [...] uniquement [au] DG ou
// [au] directeur financier"). Route dediee et volontairement separee de
// l'edition generale ci-dessus (plutot qu'un champ de plus dans son body) :
// c'est ce qui permet de la lister dans les exceptions du router.use plus
// haut dans ce fichier, pour qu'un validateur universel sans "marches" dans
// son perimetre (typiquement le Directeur Financier, voir le commentaire a
// ce sujet plus haut) puisse tout de meme corriger un client - une
// correction plus sensible qu'un simple ajustement de lignes/remise, jamais
// ouverte au meme perimetre que la creation/edition courante.
router.patch("/devis/:id/client", async (req, res) => {
  const { id } = req.params;
  const { client_commercial_id } = req.body;
  const estValidateurUniversel = req.user.roles.includes("ADMIN") || !!req.user.permissions?.validateurUniversel;
  if (!estValidateurUniversel) {
    return res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
  }
  if (!client_commercial_id) {
    return res.status(400).json({ error: t(req, "VENTE_DEVIS_FIELDS_REQUIRED") });
  }

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
    if (!["BROUILLON", "ENVOYE", "REFUSE", "VALIDE"].includes(devisActuel.statut)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "VENTE_DEVIS_NOT_EDITABLE") });
    }

    const clientResult = await client.query(
      `SELECT 1 FROM client_commercial WHERE id = $1 AND tenant_id = $2`,
      [client_commercial_id, req.user.tenantId]
    );
    if (clientResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "VENTE_CLIENT_NOT_FOUND") });
    }

    // Comme pour toute autre edition d'un devis Valide (PATCH /devis/:id
    // ci-dessus) : corriger le client change la substance du document, il
    // doit donc etre revalide avant de pouvoir generer une nouvelle facture
    // dessus.
    const repasseEnBrouillon = devisActuel.statut === "VALIDE";
    await client.query(
      `UPDATE devis
       SET client_commercial_id = $1,
           statut = CASE WHEN $2 THEN 'BROUILLON' ELSE statut END,
           valide_par = CASE WHEN $2 THEN NULL ELSE valide_par END,
           date_validation = CASE WHEN $2 THEN NULL ELSE date_validation END
       WHERE id = $3 AND tenant_id = $4`,
      [client_commercial_id, repasseEnBrouillon, id, req.user.tenantId]
    );
    const devisAvecClient = await client.query(
      `SELECT d.*, cl.nom AS client_nom, cl.adresse AS client_adresse
       FROM devis d JOIN client_commercial cl ON cl.id = d.client_commercial_id
       WHERE d.id = $1`,
      [id]
    );
    await client.query("COMMIT");
    const lignes = await chargerLignesDevis(id);
    res.json({ ...devisAvecClient.rows[0], lignes });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_DEVIS_UPDATE_ERROR") });
  } finally {
    client.release();
  }
});

// DELETE /devis/:id - suppression definitive (chantier du 02/10/2026, demande
// de Steeve : "pouvoir supprimer les devis inutiles ou les devis ou il y a
// des erreurs, des brouillons... quand c'est trop encombre"). Reservee au
// DG/Directeur Financier (validateur universel) ou ADMIN - meme niveau
// d'autorite que le changement de client ci-dessus, une suppression etant
// irreversible. Bloquee des qu'une facture existe deja sur ce devis (quel
// que soit son statut, y compris ANNULEE) : on ne supprime jamais une piece
// qui a une trace comptable en aval, seulement en amont de toute
// facturation - meme principe de prudence que le garde-fou anti-depassement
// de generer-facture.
router.delete("/devis/:id", async (req, res) => {
  const { id } = req.params;
  const estValidateurUniversel = req.user.roles.includes("ADMIN") || !!req.user.permissions?.validateurUniversel;
  if (!estValidateurUniversel) {
    return res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
  }

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
    const devis = existant.rows[0];

    const facturesResult = await client.query(
      `SELECT 1 FROM facture_vente WHERE devis_id = $1 AND tenant_id = $2 LIMIT 1`,
      [id, req.user.tenantId]
    );
    if (facturesResult.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "VENTE_DEVIS_SUPPRESSION_FACTURE_EXISTANTE") });
    }

    // devis_ligne est en ON DELETE CASCADE (migration 016) - pas de
    // suppression manuelle des lignes necessaire.
    await client.query(`DELETE FROM devis WHERE id = $1 AND tenant_id = $2`, [id, req.user.tenantId]);

    // Si ce devis etait le dernier rattache a sa consultation, on remet la
    // consultation a RECUE - symetrique du passage a DEVIS_EN_COURS fait a
    // la creation d'un devis (POST /devis) - plutot que de la laisser
    // bloquee sur "devis en cours" sans plus aucun devis dessus.
    if (devis.consultation_id) {
      const autresDevis = await client.query(
        `SELECT 1 FROM devis WHERE consultation_id = $1 AND tenant_id = $2 LIMIT 1`,
        [devis.consultation_id, req.user.tenantId]
      );
      if (autresDevis.rows.length === 0) {
        await client.query(
          `UPDATE consultation SET statut = 'RECUE' WHERE id = $1 AND tenant_id = $2 AND statut = 'DEVIS_EN_COURS'`,
          [devis.consultation_id, req.user.tenantId]
        );
      }
    }

    await client.query("COMMIT");
    res.status(204).end();
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_DEVIS_DELETE_ERROR") });
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
      `UPDATE devis SET statut = $1 WHERE id = $2 AND tenant_id = $3 AND statut IN ('BROUILLON','ENVOYE','REFUSE') RETURNING *`,
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
    // Un devis qui comporte encore des lignes non chiffrees (NC) ne peut pas etre
    // valide : son total n'est que partiel, il ne doit jamais devenir le
    // montant definitif de la commande.
    const nonChiffre = await client.query(
      `SELECT nb_lignes_non_chiffrees FROM devis WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [id, req.user.tenantId]
    );
    if (nonChiffre.rows.length > 0 && Number(nonChiffre.rows[0].nb_lignes_non_chiffrees) > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "VENTE_DEVIS_LIGNES_NON_CHIFFREES") });
    }
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

router.post("/devis/:id/generer-facture", async (req, res) => {
  const { id } = req.params;
  const { reference_bc_client, date_echeance } = req.body;
  // type_facturation : INTEGRALE (defaut, tout le devis d'un coup) | ACOMPTE
  // (pourcentage libre choisi selon la demande du client) | SOLDE (le reste
  // non encore facture, calcule automatiquement) - voir migration 024 et le
  // chantier du 30/09/2026 avec Steeve ("le client peut demander une facture
  // d'acompte de 20%, 30%, 50%... et le solde ensuite").
  const typeFacturation = req.body.type_facturation || "INTEGRALE";
  const pourcentageAcompteBrut = req.body.pourcentage_acompte;
  // Numero manuel (chantier du 01/10/2026) : meme principe que pour le devis
  // - reserve a l'ADMIN, uniquement au moment de cette creation.
  const numeroManuelBrut = typeof req.body.numero === "string" ? req.body.numero.trim() : "";

  if (!["INTEGRALE", "ACOMPTE", "SOLDE"].includes(typeFacturation)) {
    return res.status(400).json({ error: t(req, "VENTE_FACTURE_TYPE_INVALID") });
  }
  if (numeroManuelBrut && !req.user?.roles?.includes("ADMIN")) {
    return res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
  }

  let pourcentageAcompte = null;
  if (typeFacturation === "ACOMPTE") {
    pourcentageAcompte = Number(pourcentageAcompteBrut);
    if (pourcentageAcompteBrut === undefined || pourcentageAcompteBrut === null || pourcentageAcompteBrut === "") {
      return res.status(400).json({ error: t(req, "VENTE_FACTURE_POURCENTAGE_REQUIS") });
    }
    if (!Number.isFinite(pourcentageAcompte) || pourcentageAcompte <= 0 || pourcentageAcompte > 100) {
      return res.status(400).json({ error: t(req, "VENTE_FACTURE_POURCENTAGE_INVALID") });
    }
  }

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
    if (Number(devis.nb_lignes_non_chiffrees) > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "VENTE_DEVIS_LIGNES_NON_CHIFFREES") });
    }

    // Le verrou FOR UPDATE ci-dessus sur la ligne devis serialise toute
    // generation concurrente de facture pour CE devis (une 2e requete
    // attendra la fin de la transaction en cours avant de lire a son tour) -
    // la somme ci-dessous est donc toujours a jour au moment du calcul.
    const { deja_facture: dejaFacture } = await calculerAvancementFacturation(client, req.user.tenantId, id, devis.total_ttc);

    let montantNetAPayer;
    if (typeFacturation === "SOLDE") {
      montantNetAPayer = Math.round((Number(devis.total_ttc) - dejaFacture) * 100) / 100;
      if (montantNetAPayer <= 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: t(req, "VENTE_FACTURE_DEVIS_DEJA_SOLDE") });
      }
    } else if (typeFacturation === "ACOMPTE") {
      montantNetAPayer = Math.round(Number(devis.total_ttc) * (pourcentageAcompte / 100) * 100) / 100;
    } else {
      montantNetAPayer = Number(devis.total_ttc);
    }

    // Garde-fou anti-depassement (decision Steeve, 30/09/2026) : le cumul des
    // factures sur un meme devis ne peut jamais depasser son montant total -
    // marge de 0.01 XOF pour absorber les arrondis de calcul.
    if (typeFacturation !== "SOLDE" && dejaFacture + montantNetAPayer > Number(devis.total_ttc) + 0.01) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "VENTE_FACTURE_DEPASSE_DEVIS") });
    }

    const lignesDevis = await chargerLignesDevis(id);

    let numero;
    if (numeroManuelBrut) {
      const doublon = await client.query(
        `SELECT 1 FROM facture_vente WHERE tenant_id = $1 AND numero = $2`,
        [req.user.tenantId, numeroManuelBrut]
      );
      if (doublon.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: t(req, "VENTE_FACTURE_NUMERO_DEJA_UTILISE") });
      }
      numero = numeroManuelBrut;
    } else {
      const maintenant = new Date();
      const annee = maintenant.getFullYear();
      const sequence = await tirerProchainNumero(client, req.user.tenantId, "VENTE", annee);
      numero = formaterNumeroVente(annee, sequence);
    }
    const mois = new Date().getMonth() + 1;

    const factureResult = await client.query(
      `INSERT INTO facture_vente (id, tenant_id, numero, mois_emission, devis_id, client_commercial_id,
                                   reference_bc_client, taux_tva_pourcentage, total_ht, pourcentage_remise, montant_remise,
                                   montant_tva, total_ttc, date_echeance, cree_par, type_facturation, pourcentage_acompte,
                                   montant_net_a_payer)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        uuidv4(), req.user.tenantId, numero, mois, id, devis.client_commercial_id,
        reference_bc_client || null, devis.taux_tva_pourcentage, devis.total_ht, devis.pourcentage_remise, devis.montant_remise,
        devis.montant_tva, devis.total_ttc, date_echeance || null, req.user.sub, typeFacturation, pourcentageAcompte,
        montantNetAPayer,
      ]
    );
    const facture = factureResult.rows[0];

    let ordre = 0;
    for (const ligne of lignesDevis) {
      await client.query(
        `INSERT INTO facture_vente_ligne (id, facture_vente_id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht, non_chiffre, mention_prix)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [uuidv4(), facture.id, ordre++, ligne.designation, ligne.unite, ligne.quantite, ligne.prix_unitaire_ht, ligne.montant_ht, ligne.non_chiffre === true, ligne.mention_prix || null]
      );
    }

    await client.query("COMMIT");
    // Ecriture comptable en instance (chantier E, phase 2) : jamais bloquante pour la facturation.
    await comptaVentes.apresGenerationFacture(req.user.tenantId, req.user.sub, facture.id);
    res.status(201).json({ ...facture, lignes: lignesDevis });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_FACTURE_GENERATE_ERROR") });
  } finally {
    client.release();
  }
});

router.patch("/factures/:id", async (req, res) => {
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
    await comptaVentes.apresModificationFacture(req.user.tenantId, id);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_FACTURE_UPDATE_ERROR") });
  }
});

router.patch("/factures/:id/marquer-payee", async (req, res) => {
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
    await comptaVentes.apresPaiementFacture(req.user.tenantId, req.user.sub, id);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_FACTURE_UPDATE_ERROR") });
  }
});

router.patch("/factures/:id/annuler", async (req, res) => {
  const { id } = req.params;
  try {
    // Facture deja encaissee en partie (reglements clients de la comptabilite) : annuler d'abord ces reglements.
    const partiel = await db.query(
      `SELECT 1 FROM facture_vente WHERE id = $1 AND tenant_id = $2 AND montant_encaisse > 0`,
      [id, req.user.tenantId]
    );
    if (partiel.rows.length > 0) {
      return res.status(409).json({ error: t(req, "VENTE_FACTURE_ENCAISSEMENT_PARTIEL") });
    }
    const result = await db.query(
      `UPDATE facture_vente SET statut = 'ANNULEE'
       WHERE id = $1 AND tenant_id = $2 AND statut = 'IMPAYEE' RETURNING *`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ error: t(req, "VENTE_FACTURE_STATUT_INVALID") });
    }
    await comptaVentes.apresAnnulationFacture(req.user.tenantId, req.user.sub, id);
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

router.post("/factures/:id/generer-bl", async (req, res) => {
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
      `INSERT INTO bon_livraison (id, tenant_id, numero, mois_emission, facture_vente_id, client_commercial_id, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [uuidv4(), req.user.tenantId, facture.numero, facture.mois_emission, id, facture.client_commercial_id, req.user.sub]
    );
    const bl = blResult.rows[0];

    let ordre = 0;
    for (const ligne of lignesFacture) {
      await client.query(
        `INSERT INTO bon_livraison_ligne (id, bon_livraison_id, ordre, designation, unite, quantite_livree)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [uuidv4(), bl.id, ordre++, ligne.designation, ligne.unite, ligne.quantite]
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
router.patch("/bl/:id", async (req, res) => {
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
          `INSERT INTO bon_livraison_ligne (id, bon_livraison_id, ordre, designation, unite, quantite_livree)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [uuidv4(), id, ordre++, ligne.designation, ligne.unite || "U", quantite]
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

router.patch("/bl/:id/marquer-livre", async (req, res) => {
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
      // COUNT(DISTINCT d.id) et non COUNT(*) : depuis la migration 024, un
      // devis peut avoir plusieurs factures (acompte(s) + solde) - sans le
      // DISTINCT, un devis facture en 2 fois serait compte deux fois ici.
      db.query(
        `SELECT COUNT(DISTINCT d.id)::int AS n FROM devis d JOIN facture_vente f ON f.devis_id = d.id WHERE d.tenant_id = $1`,
        [tenantId]
      ),
      // montant_net_a_payer (et non total_ht/total_ttc, qui restent la copie
      // du devis ENTIER a titre de reference sur la facture) : c'est le
      // montant reellement facture sur CE document precis (acompte ou
      // solde), seule base valable pour additionner un chiffre d'affaires
      // sans compter plusieurs fois le meme devis.
      db.query(
        `SELECT statut, COUNT(*)::int AS n, COALESCE(SUM(montant_net_a_payer),0) AS total_net
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
      // "total_ttc" ici designe le montant net a payer cumule pour ce statut
      // (nom de champ conserve pour ne pas casser un ancien frontend cache),
      // pas la somme des total_ttc des devis entiers.
      facturesParStatut[row.statut] = { n: row.n, total_ttc: Number(row.total_net) };
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
      // Depuis la migration 024 (facturation en plusieurs fois), un devis
      // peut avoir plusieurs factures : ce LEFT JOIN produit alors une ligne
      // par (devis, facture) - toujours utile pour un tableau de suivi (on
      // veut voir chaque acompte/solde separement), mais chaque ligne porte
      // aussi l'avancement GLOBAL du devis (devis_deja_facture/
      // devis_reste_a_facturer, identique sur toutes les lignes d'un meme
      // devis) pour ne pas avoir a le recalculer cote frontend.
      `SELECT
         d.id AS devis_id, d.numero AS devis_numero, d.statut AS devis_statut,
         d.date_devis, d.objet, d.total_ht AS devis_total_ht, d.total_ttc AS devis_total_ttc,
         cl.nom AS client_nom,
         f.id AS facture_id, f.numero AS facture_numero, f.mois_emission AS facture_mois_emission,
         f.statut AS facture_statut, f.date_facture, f.date_echeance,
         f.total_ttc AS facture_total_ttc, f.reference_bc_client,
         f.type_facturation, f.pourcentage_acompte, f.montant_net_a_payer,
         bl.id AS bl_id, bl.numero AS bl_numero, bl.statut AS bl_statut, bl.date_bl,
         COALESCE((
           SELECT SUM(f2.montant_net_a_payer) FROM facture_vente f2
           WHERE f2.devis_id = d.id AND f2.statut != 'ANNULEE'
         ), 0) AS devis_deja_facture,
         d.total_ttc - COALESCE((
           SELECT SUM(f2.montant_net_a_payer) FROM facture_vente f2
           WHERE f2.devis_id = d.id AND f2.statut != 'ANNULEE'
         ), 0) AS devis_reste_a_facturer
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
