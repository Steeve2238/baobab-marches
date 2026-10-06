const express = require("express");
const multer = require("multer");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { assurerTiersPourFournisseurSilencieux } = require("../services/comptaService");
const { chargerParametres } = require("../services/produitsCatalogue");
const echeancierSvc = require("../services/echeancier");
const { enregistrerMouvement, stockProduit, genererReferenceInterne } = require("../services/stockService");
const { reevaluerMargeDossier } = require("./commandes");
const { tableInclus } = require("../services/incoterms");
const { lireFactureExcel } = require("../services/receptionExcel");
const { derniersAchatsFournisseur, pct } = require("../services/prixFournisseurs");
const { TYPES_COUT, REPARTITIONS, repartirCouts, avertissementsIncoterm, estimerAssuranceEtDouane } = require("../services/receptionCouts");

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------------------------
// Receptions de marchandises (05/10/2026) : la facture du fournisseur est la
// porte d'entree des articles et du stock. Independant du module Comptabilite.
// Acces : modules "fournisseurs" ou "marches" (les equipes commerciales doivent
// voir ce qui est en stock), admin et tableau de bord.
// ----------------------------------------------------------------------------
router.use((req, res, next) => {
  const permissions = req.user?.permissions;
  if (!permissions) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  if (permissions.admin || permissions.tableauDeBord) return next();
  if ((permissions.modules || []).some((m) => m === "fournisseurs" || m === "marches")) return next();
  return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
});
router.use(blockLectureSeule);

const uploadExcel = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const arr2 = (n) => Math.round(n * 100) / 100;

// Fournisseurs : memes tables que le reste de la plateforme (aucun repertoire
// supplementaire) ; lecture/creation rapide dupliquees ici pour ne pas exiger
// d'autre module (meme principe que routes/calculPrix.js).
router.get("/fournisseurs", async (req, res) => {
  try {
    const r = await db.query(`SELECT id, nom, pays, echeancier_json FROM fournisseur WHERE tenant_id = $1 ORDER BY nom ASC`, [req.user.tenantId]);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "FOURNISSEURS_FETCH_ERROR") });
  }
});

router.post("/fournisseurs", async (req, res) => {
  const { nom, pays } = req.body;
  if (!nom || !String(nom).trim()) return res.status(400).json({ error: t(req, "FOURNISSEUR_NOM_REQUIRED") });
  const ech = echeancierSvc.normaliser(req.body.echeancier);
  if (ech.erreur) return res.status(400).json({ error: t(req, ech.erreur) });
  try {
    const r = await db.query(
      `INSERT INTO fournisseur (id, tenant_id, nom, pays, echeancier_json) VALUES ($1,$2,$3,$4,$5) RETURNING id, nom, pays, echeancier_json`,
      [uuidv4(), req.user.tenantId, String(nom).trim(), pays || null, JSON.stringify(ech.lignes)]
    );
    await assurerTiersPourFournisseurSilencieux(req.user.tenantId, r.rows[0]);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "FOURNISSEUR_CREATE_ERROR") });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nettoyerLignes(lignesBrutes) {
  if (!Array.isArray(lignesBrutes)) return { lignes: [] };
  const lignes = [];
  for (const l of lignesBrutes) {
    const designation = String(l.designation ?? "").trim();
    const quantite = Number(l.quantite);
    const poidsBrut = l.poids_unitaire_kg === "" || l.poids_unitaire_kg === undefined || l.poids_unitaire_kg === null ? null : Number(l.poids_unitaire_kg);
    if (poidsBrut !== null && (!Number.isFinite(poidsBrut) || poidsBrut < 0)) return { erreur: "RECEPTION_LIGNE_INVALID" };
    const poids = poidsBrut === null || poidsBrut === 0 ? null : Math.round(poidsBrut * 10000) / 10000;
    const pu = l.prix_unitaire_devise === "" || l.prix_unitaire_devise === undefined || l.prix_unitaire_devise === null ? 0 : Number(l.prix_unitaire_devise);
    if (!designation || !Number.isFinite(quantite) || quantite <= 0 || !Number.isFinite(pu) || pu < 0) {
      return { erreur: "RECEPTION_LIGNE_INVALID" };
    }
    lignes.push({
      reference_fournisseur: String(l.reference_fournisseur ?? "").trim() || null,
      designation,
      unite: String(l.unite ?? "").trim() || "U",
      quantite: Math.round(quantite * 1000) / 1000,
      prix_unitaire_devise: Math.round(pu * 10000) / 10000,
      produit_id: typeof l.produit_id === "string" && UUID_RE.test(l.produit_id) ? l.produit_id : null,
      reference_interne: String(l.reference_interne ?? "").trim() || null,
      poids_unitaire_kg: poids,
      commande_ligne_id: typeof l.commande_ligne_id === "string" && UUID_RE.test(l.commande_ligne_id) ? l.commande_ligne_id : null,
    });
  }
  return { lignes };
}

// Couts d'approche saisis (transport, assurance, douane, transit...). Les lignes
// a montant nul sont ignorees ; un montant negatif ou un type inconnu est refuse.
function nettoyerCouts(coutsBruts) {
  if (!Array.isArray(coutsBruts)) return { couts: [] };
  const couts = [];
  for (const c of coutsBruts) {
    const brut = c.montant === "" || c.montant === undefined || c.montant === null ? 0 : Number(c.montant);
    const type = String(c.type_cout || "AUTRE").toUpperCase();
    if (!Number.isFinite(brut) || brut < 0 || !TYPES_COUT.includes(type)) return { erreur: "RECEPTION_COUT_INVALID" };
    if (brut === 0) continue;
    const repartition = String(c.repartition || "VALEUR").toUpperCase();
    couts.push({
      type_cout: type,
      libelle: String(c.libelle || "").trim().slice(0, 200) || null,
      montant: arr2(brut),
      en_devise_facture: c.en_devise_facture === true || c.en_devise_facture === "true",
      repartition: REPARTITIONS.includes(repartition) ? repartition : "VALEUR",
      transitaire_id: typeof c.transitaire_id === "string" && UUID_RE.test(c.transitaire_id) ? c.transitaire_id : null,
      facture_reference: String(c.facture_reference || "").trim().slice(0, 100) || null,
      montant_cote_xof: c.montant_cote_xof === "" || c.montant_cote_xof === undefined || c.montant_cote_xof === null || !(Number(c.montant_cote_xof) >= 0)
        ? null
        : arr2(Number(c.montant_cote_xof)),
    });
  }
  return { couts };
}

async function remplacerCouts(client, tenantId, receptionId, couts) {
  // Les couts sont reecrits en bloc : un cout inchange (meme type, montant, devise, transitaire)
  // garde le lien vers sa facture comptable (Lot 7).
  const anciens = (
    await client.query(
      `SELECT type_cout, montant, en_devise_facture, transitaire_id, facture_fournisseur_id
       FROM reception_cout_approche WHERE reception_id = $1 AND facture_fournisseur_id IS NOT NULL`,
      [receptionId]
    )
  ).rows;
  await client.query(`DELETE FROM reception_cout_approche WHERE reception_id = $1`, [receptionId]);
  let ordre = 0;
  for (const c of couts) {
    const i = anciens.findIndex(
      (a) =>
        a.type_cout === c.type_cout &&
        Number(a.montant) === Number(c.montant) &&
        !!a.en_devise_facture === !!c.en_devise_facture &&
        (a.transitaire_id || null) === (c.transitaire_id || null)
    );
    const factureId = i >= 0 ? anciens.splice(i, 1)[0].facture_fournisseur_id : null;
    await client.query(
      `INSERT INTO reception_cout_approche (id, tenant_id, reception_id, ordre, type_cout, libelle, montant, en_devise_facture, repartition,
                                            transitaire_id, facture_reference, montant_cote_xof, facture_fournisseur_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
               (SELECT id FROM transitaire WHERE id = $10 AND tenant_id = $2), $11, $12, $13)`,
      [uuidv4(), tenantId, receptionId, ordre++, c.type_cout, c.libelle, c.montant, c.en_devise_facture, c.repartition,
       c.transitaire_id, c.facture_reference, c.montant_cote_xof, factureId]
    );
  }
}

async function lireCouts(queryable, receptionId) {
  return (
    await queryable.query(
      `SELECT c.id, c.ordre, c.type_cout, c.libelle, c.montant, c.en_devise_facture, c.repartition,
              c.transitaire_id, tr.nom AS transitaire_nom, c.facture_reference, c.montant_cote_xof,
              c.facture_fournisseur_id, ff.numero AS facture_compta_numero
       FROM reception_cout_approche c
       LEFT JOIN transitaire tr ON tr.id = c.transitaire_id
       LEFT JOIN facture_fournisseur ff ON ff.id = c.facture_fournisseur_id AND ff.statut = 'ENREGISTREE'
       WHERE c.reception_id = $1 ORDER BY c.ordre ASC`,
      [receptionId]
    )
  ).rows.map((c) => ({ ...c, montant: Number(c.montant), montant_cote_xof: c.montant_cote_xof === null ? null : Number(c.montant_cote_xof) }));
}

const libelleSource = (rec, fournisseurNom) => `${rec.numero} · ${fournisseurNom}`.slice(0, 300);

function validerEntete(b) {
  const devise = String(b.devise || "XOF").trim().toUpperCase().slice(0, 8) || "XOF";
  const cours = devise === "XOF" ? 1 : Number(b.cours_devise);
  if (!Number.isFinite(cours) || cours <= 0) return { erreur: "RECEPTION_COURS_INVALID" };
  return {
    devise,
    cours,
    incoterm: String(b.incoterm || "").trim().toUpperCase().slice(0, 10) || null,
    reference_facture: String(b.reference_facture || "").trim() || null,
    date_facture: b.date_facture || null,
    date_reception: b.date_reception || null,
    notes: String(b.notes || "").trim() || null,
    transitaire_id: typeof b.transitaire_id === "string" && UUID_RE.test(b.transitaire_id) ? b.transitaire_id : null,
    cotation_id: typeof b.cotation_id === "string" && UUID_RE.test(b.cotation_id) ? b.cotation_id : null,
    date_expedition: b.date_expedition || null,
    date_arrivee_prevue: b.date_arrivee_prevue || null,
  };
}

async function fournisseurDuTenant(queryable, tenantId, id) {
  if (!id || !UUID_RE.test(String(id))) return false;
  const r = await queryable.query(`SELECT 1 FROM fournisseur WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  return r.rows.length > 0;
}

// Commande fournisseur a laquelle rattacher une reception : du tenant et confirmee.
async function commandeRattachable(queryable, tenantId, id) {
  if (!id || !UUID_RE.test(String(id))) return null;
  const r = await queryable.query(
    `SELECT * FROM commande_fournisseur WHERE id = $1 AND tenant_id = $2 AND statut = 'CONFIRMEE'`,
    [id, tenantId]
  );
  return r.rows[0] || null;
}

function ecartPrecedent(precedent, prixXof) {
  if (!precedent) return { prix_precedent_xof: null, prix_precedent_date: null, prix_precedent_numero: null, variation_prix_pct: null };
  return {
    prix_precedent_xof: precedent.prix_achat_xof,
    prix_precedent_date: precedent.date,
    prix_precedent_numero: precedent.numero,
    variation_prix_pct: pct(prixXof, precedent.prix_achat_xof),
  };
}

async function chargerReception(tenantId, id) {
  if (!UUID_RE.test(String(id))) return null;
  const r = await db.query(
    `SELECT r.*, f.nom AS fournisseur_nom, ff.numero AS facture_fournisseur_numero,
            tr.nom AS transitaire_nom, ct.reference AS cotation_reference,
            cf.numero AS commande_numero, cf.statut AS commande_statut,
            cf.dossier_ao_id AS commande_dossier_ao_id, cf.consultation_id AS commande_consultation_id,
            d.reference_externe AS dossier_ao_reference, d.intitule AS dossier_ao_intitule, cons.objet AS consultation_objet
     FROM reception_marchandise r
     JOIN fournisseur f ON f.id = r.fournisseur_id
     LEFT JOIN facture_fournisseur ff ON ff.id = r.facture_fournisseur_id AND ff.statut = 'ENREGISTREE'
     LEFT JOIN transitaire tr ON tr.id = r.transitaire_id
     LEFT JOIN transitaire_cotation ct ON ct.id = r.cotation_id
     LEFT JOIN commande_fournisseur cf ON cf.id = r.commande_id
     LEFT JOIN dossier_ao d ON d.id = cf.dossier_ao_id
     LEFT JOIN consultation cons ON cons.id = cf.consultation_id
     WHERE r.id = $1 AND r.tenant_id = $2`,
    [id, tenantId]
  );
  const reception = r.rows[0];
  if (!reception) return null;
  const lignes = (
    await db.query(
      `SELECT l.*, p.reference AS produit_reference, p.designation AS produit_designation,
              pm.id AS mapping_produit_id, pp.id AS mapping_article_id, pp.reference AS mapping_reference, pp.designation AS mapping_designation,
              cl.quantite AS commande_quantite, cl.prix_unitaire_devise AS commande_prix_devise,
              COALESCE((SELECT SUM(rl2.quantite) FROM reception_ligne rl2 JOIN reception_marchandise r2 ON r2.id = rl2.reception_id
                        WHERE rl2.commande_ligne_id = l.commande_ligne_id AND r2.statut = 'VALIDEE' AND r2.id <> l.reception_id), 0) AS commande_deja_recue
       FROM reception_ligne l
       LEFT JOIN commande_fournisseur_ligne cl ON cl.id = l.commande_ligne_id
       LEFT JOIN produit p ON p.id = l.produit_id
       LEFT JOIN produit_reference_fournisseur pm
         ON pm.tenant_id = $2 AND pm.fournisseur_id = $3 AND l.reference_fournisseur IS NOT NULL
        AND lower(pm.reference_fournisseur) = lower(l.reference_fournisseur)
       LEFT JOIN produit pp ON pp.id = pm.produit_id
       WHERE l.reception_id = $1 ORDER BY l.ordre ASC`,
      [id, tenantId, reception.fournisseur_id]
    )
  ).rows;
  const cours = Number(reception.cours_devise);
  const couts = await lireCouts(db, id);
  const lignesBase = lignes.map((l) => ({
    ...l,
    quantite: Number(l.quantite),
    prix_unitaire_devise: Number(l.prix_unitaire_devise),
    poids_unitaire_kg: l.poids_unitaire_kg === null ? null : Number(l.poids_unitaire_kg),
  }));
  const rep = repartirCouts(lignesBase, couts, cours);
  // Ecart par rapport au dernier achat valide du meme article chez le meme fournisseur.
  const idsArticles = [...new Set(lignesBase.map((l) => l.produit_id || l.mapping_article_id).filter(Boolean))];
  const precedents = await derniersAchatsFournisseur(
    tenantId,
    reception.fournisseur_id,
    idsArticles,
    reception.statut === "BROUILLON" ? null : { date: reception.date_reception, validation: reception.date_validation }
  );
  let totalDevise = 0;
  const lignesCalculees = lignesBase.map((l, i) => {
    const montantDevise = arr2(l.quantite * l.prix_unitaire_devise);
    totalDevise += montantDevise;
    const cmdQte = l.commande_quantite === null || l.commande_quantite === undefined ? null : Number(l.commande_quantite);
    const cmdPrix = l.commande_prix_devise === null || l.commande_prix_devise === undefined ? null : Number(l.commande_prix_devise);
    return {
      ...l,
      commande_quantite: cmdQte,
      commande_prix_devise: cmdPrix,
      commande_deja_recue: Number(l.commande_deja_recue || 0),
      ecart_prix_commande_pct: cmdPrix !== null && cmdPrix > 0 ? pct(l.prix_unitaire_devise, cmdPrix) : null,
      montant_devise: montantDevise,
      cout_unitaire_xof: arr2(l.prix_unitaire_devise * cours),
      montant_xof: arr2(montantDevise * cours),
      cout_approche_xof: rep.lignes[i].cout_approche_xof,
      cout_revient_unitaire_xof: rep.lignes[i].cout_revient_unitaire_xof,
      cout_revient_total_xof: rep.lignes[i].cout_revient_total_xof,
      ...ecartPrecedent(precedents.get(l.produit_id || l.mapping_article_id), arr2(l.prix_unitaire_devise * cours)),
      article_reconnu: l.mapping_produit_id
        ? { id: l.mapping_article_id, reference: l.mapping_reference, designation: l.mapping_designation }
        : null,
    };
  });
  return {
    ...reception,
    cours_devise: cours,
    lignes: lignesCalculees,
    couts_approche: rep.couts.map((c) => ({
      ...c,
      ecart_cote_xof: c.montant_cote_xof === null || c.montant_cote_xof === undefined ? null : arr2(c.montant_xof - c.montant_cote_xof),
    })),
    delai_transport_jours:
      reception.date_expedition && reception.date_reception
        ? Math.round((new Date(String(reception.date_reception).slice(0, 10)) - new Date(String(reception.date_expedition).slice(0, 10))) / 86400000)
        : null,
    total_couts_approche_xof: rep.total_couts_approche_xof,
    cout_revient_total_xof: arr2(rep.total_achat_xof + rep.total_couts_approche_xof),
    avertissements_couts: [...rep.avertissements, ...avertissementsIncoterm(reception.incoterm, couts, await tableInclus(db, tenantId))],
    avertissements_commande: reception.commande_id
      ? lignesBase.flatMap((l, i) => {
          const res = [];
          if (!l.commande_ligne_id) res.push({ code: "HORS_COMMANDE", designation: l.designation });
          else if (Number(l.commande_deja_recue || 0) + l.quantite > Number(l.commande_quantite) + 0.0005)
            res.push({ code: "QUANTITE_SUPERIEURE", designation: l.designation, commande: Number(l.commande_quantite), recue: Number(l.commande_deja_recue || 0) + l.quantite });
          return res;
        })
      : [],
    total_devise: arr2(totalDevise),
    total_xof: arr2(totalDevise * cours),
  };
}

async function remplacerLignes(client, receptionId, lignes, commandeId) {
  await client.query(`DELETE FROM reception_ligne WHERE reception_id = $1`, [receptionId]);
  let ordre = 0;
  for (const l of lignes) {
    await client.query(
      `INSERT INTO reception_ligne (id, reception_id, ordre, reference_fournisseur, designation, unite, quantite,
                                    prix_unitaire_devise, produit_id, reference_interne, poids_unitaire_kg, commande_ligne_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
               (SELECT id FROM commande_fournisseur_ligne WHERE id = $12 AND commande_id = $13))`,
      [uuidv4(), receptionId, ordre++, l.reference_fournisseur, l.designation, l.unite, l.quantite,
       l.prix_unitaire_devise, l.produit_id, l.reference_interne, l.poids_unitaire_kg, l.commande_ligne_id, commandeId || null]
    );
  }
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  const { fournisseur_id, statut } = req.query;
  try {
    const conditions = ["r.tenant_id = $1"];
    const valeurs = [req.user.tenantId];
    if (fournisseur_id && UUID_RE.test(String(fournisseur_id))) {
      valeurs.push(fournisseur_id);
      conditions.push(`r.fournisseur_id = $${valeurs.length}`);
    }
    if (statut && ["BROUILLON", "VALIDEE", "ANNULEE"].includes(statut)) {
      valeurs.push(statut);
      conditions.push(`r.statut = $${valeurs.length}`);
    }
    const r = await db.query(
      `SELECT r.id, r.numero, r.commande_id, r.reference_facture, r.date_reception, r.devise, r.cours_devise, r.incoterm, r.statut,
              f.nom AS fournisseur_nom, cf.numero AS commande_numero,
              COUNT(l.id)::int AS nb_lignes,
              COALESCE(SUM(ROUND(l.quantite * l.prix_unitaire_devise, 2)), 0) AS total_devise
       FROM reception_marchandise r
       JOIN fournisseur f ON f.id = r.fournisseur_id
       LEFT JOIN commande_fournisseur cf ON cf.id = r.commande_id
       LEFT JOIN reception_ligne l ON l.reception_id = r.id
       WHERE ${conditions.join(" AND ")}
       GROUP BY r.id, f.nom, cf.numero
       ORDER BY r.date_reception DESC, r.numero DESC`,
      valeurs
    );
    res.json(
      r.rows.map((x) => ({
        ...x,
        cours_devise: Number(x.cours_devise),
        total_devise: Number(x.total_devise),
        total_xof: arr2(Number(x.total_devise) * Number(x.cours_devise)),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RECEPTION_FETCH_ERROR") });
  }
});

// Lecture d'une facture fournisseur Excel -> lignes proposees (rien n'est
// enregistre : l'utilisateur controle puis enregistre la reception).
router.post("/importer-excel", uploadExcel.single("fichier"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: t(req, "RECEPTION_IMPORT_FICHIER") });
  const resultat = lireFactureExcel(req.file.buffer);
  if (resultat.erreur === "FICHIER") return res.status(400).json({ error: t(req, "RECEPTION_IMPORT_FICHIER") });
  if (resultat.erreur === "COLONNES") return res.status(400).json({ error: t(req, "RECEPTION_IMPORT_COLONNES") });
  const avertissements = resultat.avertissements.map((a) => {
    if (a.code === "LIGNE_IGNOREE") return t(req, "RECEPTION_IMPORT_LIGNE_IGNOREE").replace("{n}", a.ligne);
    if (a.code === "PRIX_MANQUANT") return t(req, "RECEPTION_IMPORT_PRIX_MANQUANT").replace("{n}", a.ligne);
    return t(req, "RECEPTION_IMPORT_ECART").replace("{n}", a.ligne).replace("{calcule}", a.calcule).replace("{montant}", a.montant);
  });
  res.json({ lignes: resultat.lignes, avertissements });
});

router.get("/:id", async (req, res) => {
  try {
    const reception = await chargerReception(req.user.tenantId, req.params.id);
    if (!reception) return res.status(404).json({ error: t(req, "RECEPTION_NOT_FOUND") });
    res.json(reception);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RECEPTION_FETCH_ERROR") });
  }
});

// ---------------------------------------------------------------------------
// Creation / modification (brouillon)
// ---------------------------------------------------------------------------
router.post("/", async (req, res) => {
  const b = req.body;
  const entete = validerEntete(b);
  if (entete.erreur) return res.status(400).json({ error: t(req, entete.erreur) });
  const net = nettoyerLignes(b.lignes || []);
  if (net.erreur) return res.status(400).json({ error: t(req, net.erreur) });
  const netCouts = nettoyerCouts(b.couts_approche);
  if (netCouts.erreur) return res.status(400).json({ error: t(req, netCouts.erreur) });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    // Commande fournisseur OBLIGATOIRE : le fournisseur de la reception est celui de la commande.
    const commande = await commandeRattachable(client, req.user.tenantId, b.commande_id);
    if (!commande) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, b.commande_id ? "RECEPTION_COMMANDE_INVALID" : "RECEPTION_COMMANDE_REQUIRED") });
    }
    b.fournisseur_id = commande.fournisseur_id;
    if (b.transitaire_id === undefined) entete.transitaire_id = commande.transitaire_id;
    if (b.cotation_id === undefined) entete.cotation_id = commande.cotation_id;
    if (!entete.incoterm && commande.incoterm && b.incoterm === undefined) entete.incoterm = commande.incoterm;
    if (!(await fournisseurDuTenant(client, req.user.tenantId, b.fournisseur_id))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "RECEPTION_FOURNISSEUR_REQUIRED") });
    }
    const annee = new Date().getFullYear();
    await client.query(
      `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero) VALUES ($1,'RECEPTION',$2,0)
       ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
      [req.user.tenantId, annee]
    );
    const seq = (
      await client.query(
        `UPDATE compteur_numerotation SET dernier_numero = dernier_numero + 1
         WHERE tenant_id = $1 AND type_compteur = 'RECEPTION' AND annee = $2 RETURNING dernier_numero`,
        [req.user.tenantId, annee]
      )
    ).rows[0].dernier_numero;
    const id = uuidv4();
    await client.query(
      `INSERT INTO reception_marchandise (id, tenant_id, numero, fournisseur_id, reference_facture, date_facture, date_reception,
                                          devise, cours_devise, incoterm, notes, cree_par,
                                          transitaire_id, cotation_id, date_expedition, date_arrivee_prevue, commande_id)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, CURRENT_DATE),$8,$9,$10,$11,$12,
               (SELECT id FROM transitaire WHERE id = $13 AND tenant_id = $2),
               (SELECT id FROM transitaire_cotation WHERE id = $14 AND tenant_id = $2), $15, $16, $17)`,
      [id, req.user.tenantId, `REC-${annee}-${String(seq).padStart(4, "0")}`, b.fournisseur_id, entete.reference_facture,
       entete.date_facture, entete.date_reception, entete.devise, entete.cours, entete.incoterm, entete.notes, req.user.sub,
       entete.transitaire_id, entete.cotation_id, entete.date_expedition, entete.date_arrivee_prevue, commande.id]
    );
    await remplacerLignes(client, id, net.lignes, commande.id);
    await remplacerCouts(client, req.user.tenantId, id, netCouts.couts);
    await client.query("COMMIT");
    res.status(201).json(await chargerReception(req.user.tenantId, id));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "RECEPTION_CREATE_ERROR") });
  } finally {
    client.release();
  }
});

router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "RECEPTION_NOT_FOUND") });
  const b = req.body;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const actuelle = (
      await client.query(`SELECT * FROM reception_marchandise WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, req.user.tenantId])
    ).rows[0];
    if (!actuelle) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "RECEPTION_NOT_FOUND") });
    }
    if (actuelle.statut !== "BROUILLON") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "RECEPTION_NON_MODIFIABLE") });
    }
    const entete = validerEntete({
      devise: b.devise !== undefined ? b.devise : actuelle.devise,
      cours_devise: b.cours_devise !== undefined ? b.cours_devise : actuelle.cours_devise,
      incoterm: b.incoterm !== undefined ? b.incoterm : actuelle.incoterm,
      reference_facture: b.reference_facture !== undefined ? b.reference_facture : actuelle.reference_facture,
      date_facture: b.date_facture !== undefined ? b.date_facture : actuelle.date_facture,
      date_reception: b.date_reception !== undefined ? b.date_reception : actuelle.date_reception,
      notes: b.notes !== undefined ? b.notes : actuelle.notes,
      transitaire_id: b.transitaire_id !== undefined ? b.transitaire_id : actuelle.transitaire_id,
      cotation_id: b.cotation_id !== undefined ? b.cotation_id : actuelle.cotation_id,
      date_expedition: b.date_expedition !== undefined ? b.date_expedition : actuelle.date_expedition,
      date_arrivee_prevue: b.date_arrivee_prevue !== undefined ? b.date_arrivee_prevue : actuelle.date_arrivee_prevue,
    });
    if (entete.erreur) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, entete.erreur) });
    }
    let commandeId = actuelle.commande_id;
    if (!commandeId && b.commande_id) {
      // Reception anterieure sans commande : on peut la rattacher (jamais la changer ensuite).
      const commande = await commandeRattachable(client, req.user.tenantId, b.commande_id);
      if (!commande) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "RECEPTION_COMMANDE_INVALID") });
      }
      commandeId = commande.id;
      b.fournisseur_id = commande.fournisseur_id;
      await client.query(`UPDATE reception_marchandise SET commande_id = $1 WHERE id = $2`, [commandeId, id]);
    } else if (commandeId) {
      b.fournisseur_id = undefined; // fournisseur impose par la commande
    }
    let fournisseurId = actuelle.fournisseur_id;
    if (b.fournisseur_id !== undefined) {
      if (!(await fournisseurDuTenant(client, req.user.tenantId, b.fournisseur_id))) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "RECEPTION_FOURNISSEUR_REQUIRED") });
      }
      fournisseurId = b.fournisseur_id;
    }
    await client.query(
      `UPDATE reception_marchandise SET fournisseur_id = $1, reference_facture = $2, date_facture = $3,
              date_reception = COALESCE($4, date_reception), devise = $5, cours_devise = $6, incoterm = $7, notes = $8,
              transitaire_id = (SELECT id FROM transitaire WHERE id = $10 AND tenant_id = $11),
              cotation_id = (SELECT id FROM transitaire_cotation WHERE id = $12 AND tenant_id = $11),
              date_expedition = $13, date_arrivee_prevue = $14
       WHERE id = $9`,
      [fournisseurId, entete.reference_facture, entete.date_facture, entete.date_reception, entete.devise, entete.cours,
       entete.incoterm, entete.notes, id, entete.transitaire_id, req.user.tenantId, entete.cotation_id,
       entete.date_expedition, entete.date_arrivee_prevue]
    );
    if (Array.isArray(b.lignes)) {
      const net = nettoyerLignes(b.lignes);
      if (net.erreur) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, net.erreur) });
      }
      await remplacerLignes(client, id, net.lignes, commandeId);
    }
    if (Array.isArray(b.couts_approche)) {
      const netCouts = nettoyerCouts(b.couts_approche);
      if (netCouts.erreur) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, netCouts.erreur) });
      }
      await remplacerCouts(client, req.user.tenantId, id, netCouts.couts);
    }
    await client.query("COMMIT");
    res.json(await chargerReception(req.user.tenantId, id));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "RECEPTION_UPDATE_ERROR") });
  } finally {
    client.release();
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "RECEPTION_NOT_FOUND") });
  try {
    const r = await db.query(
      `DELETE FROM reception_marchandise WHERE id = $1 AND tenant_id = $2 AND statut = 'BROUILLON' RETURNING id`,
      [id, req.user.tenantId]
    );
    if (r.rows.length === 0) {
      const existe = await db.query(`SELECT 1 FROM reception_marchandise WHERE id = $1 AND tenant_id = $2`, [id, req.user.tenantId]);
      return res.status(existe.rows.length ? 409 : 404).json({ error: t(req, existe.rows.length ? "RECEPTION_NON_MODIFIABLE" : "RECEPTION_NOT_FOUND") });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RECEPTION_DELETE_ERROR") });
  }
});

// ---------------------------------------------------------------------------
// Couts d'approche
// ---------------------------------------------------------------------------

// Estimation de l'assurance et des droits et taxes de douane avec les
// parametres du tenant (taux du dossier de calcul). Rien n'est enregistre :
// l'utilisateur reprend ou corrige les montants proposes.
router.post("/estimer-couts-approche", async (req, res) => {
  const total = Number(req.body.total_achat_xof);
  const fret = req.body.fret_xof === undefined || req.body.fret_xof === "" ? 0 : Number(req.body.fret_xof);
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(fret) || fret < 0) {
    return res.status(400).json({ error: t(req, "RECEPTION_COUT_INVALID") });
  }
  try {
    const parametres = await chargerParametres(req.user.tenantId);
    res.json(estimerAssuranceEtDouane({ totalAchatXof: total, fretXof: fret, incoterm: req.body.incoterm }, parametres, await tableInclus(db, req.user.tenantId)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RECEPTION_UPDATE_ERROR") });
  }
});

// Remplace les couts d'approche d'une reception BROUILLON ou VALIDEE (la facture
// du transitaire arrive souvent apres la reception). Sur une reception validee,
// le cout de revient est recalcule : mouvements d'entree, cout fige des lignes
// et cout de l'article (si cette reception en est toujours la derniere source).
router.put("/:id/couts-approche", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "RECEPTION_NOT_FOUND") });
  const netCouts = nettoyerCouts(req.body.couts_approche);
  if (netCouts.erreur) return res.status(400).json({ error: t(req, netCouts.erreur) });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const rec = (
      await client.query(`SELECT * FROM reception_marchandise WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, req.user.tenantId])
    ).rows[0];
    if (!rec) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "RECEPTION_NOT_FOUND") });
    }
    if (rec.statut === "ANNULEE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "RECEPTION_NON_MODIFIABLE") });
    }
    await remplacerCouts(client, req.user.tenantId, id, netCouts.couts);
    // Informations de transport saisies ou completees apres la reception
    // (la facture et les dates du transitaire arrivent souvent plus tard).
    const b = req.body;
    if (["transitaire_id", "cotation_id", "date_expedition", "date_arrivee_prevue"].some((k) => b[k] !== undefined)) {
      const ent = validerEntete({
        devise: rec.devise,
        cours_devise: rec.cours_devise,
        transitaire_id: b.transitaire_id !== undefined ? b.transitaire_id : rec.transitaire_id,
        cotation_id: b.cotation_id !== undefined ? b.cotation_id : rec.cotation_id,
        date_expedition: b.date_expedition !== undefined ? b.date_expedition : rec.date_expedition,
        date_arrivee_prevue: b.date_arrivee_prevue !== undefined ? b.date_arrivee_prevue : rec.date_arrivee_prevue,
      });
      await client.query(
        `UPDATE reception_marchandise SET
                transitaire_id = (SELECT id FROM transitaire WHERE id = $1 AND tenant_id = $5),
                cotation_id = (SELECT id FROM transitaire_cotation WHERE id = $2 AND tenant_id = $5),
                date_expedition = $3, date_arrivee_prevue = $4
         WHERE id = $6`,
        [ent.transitaire_id, ent.cotation_id, ent.date_expedition, ent.date_arrivee_prevue, req.user.tenantId, id]
      );
      if (rec.statut === "VALIDEE" && ent.cotation_id) {
        await client.query(
          `UPDATE transitaire_cotation SET statut = 'RETENUE' WHERE id = $1 AND tenant_id = $2 AND statut = 'RECUE'`,
          [ent.cotation_id, req.user.tenantId]
        );
      }
    }
    if (rec.statut === "VALIDEE") {
      const fournisseur = (await client.query(`SELECT nom FROM fournisseur WHERE id = $1`, [rec.fournisseur_id])).rows[0];
      const label = libelleSource(rec, fournisseur.nom);
      const lignes = (await client.query(`SELECT * FROM reception_ligne WHERE reception_id = $1 ORDER BY ordre ASC`, [id])).rows;
      const repartition = repartirCouts(lignes, await lireCouts(client, id), Number(rec.cours_devise));
      for (const [i, l] of lignes.entries()) {
        const cout = repartition.lignes[i].cout_revient_unitaire_xof;
        await client.query(`UPDATE reception_ligne SET cout_revient_unitaire_xof = $1 WHERE id = $2`, [cout, l.id]);
        if (!l.produit_id) continue;
        await client.query(
          `UPDATE mouvement_stock SET cout_unitaire_xof = $1
           WHERE tenant_id = $2 AND origine_type = 'RECEPTION' AND origine_id = $3 AND type_mouvement = 'ENTREE' AND produit_id = $4`,
          [cout, req.user.tenantId, id, l.produit_id]
        );
        await client.query(
          `UPDATE produit SET cout_revient_unitaire_xof = $1, date_maj = now()
           WHERE id = $2 AND tenant_id = $3 AND source_libelle = $4`,
          [cout, l.produit_id, req.user.tenantId, label]
        );
      }
    }
    await client.query("COMMIT");
    if (rec.commande_id && rec.statut === "VALIDEE") await reevaluerMargeDossier(req.user.tenantId, rec.commande_id);
    res.json(await chargerReception(req.user.tenantId, id));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "RECEPTION_UPDATE_ERROR") });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Validation : cree/rapproche les articles, memorise la correspondance de
// references et alimente le stock. Le cout de revient de l'article devient le
// cout de CETTE reception (dernier cout) : prix d'achat converti en XOF + part
// des couts d'approche (transport, assurance, douane, transit...).
// ---------------------------------------------------------------------------
router.post("/:id/valider", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "RECEPTION_NOT_FOUND") });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const rec = (
      await client.query(`SELECT * FROM reception_marchandise WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, req.user.tenantId])
    ).rows[0];
    if (!rec) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "RECEPTION_NOT_FOUND") });
    }
    if (rec.statut !== "BROUILLON") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "RECEPTION_NON_MODIFIABLE") });
    }
    const lignes = (await client.query(`SELECT * FROM reception_ligne WHERE reception_id = $1 ORDER BY ordre ASC`, [id])).rows;
    if (lignes.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "RECEPTION_VIDE") });
    }
    // Une reception ne se valide que rattachee a une commande fournisseur confirmee.
    if (!rec.commande_id || !(await commandeRattachable(client, req.user.tenantId, rec.commande_id))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, rec.commande_id ? "RECEPTION_COMMANDE_INVALID" : "RECEPTION_COMMANDE_REQUIRED") });
    }
    const fournisseur = (await client.query(`SELECT nom FROM fournisseur WHERE id = $1`, [rec.fournisseur_id])).rows[0];
    const parametres = await chargerParametres(req.user.tenantId);
    const margeDefaut = Number(parametres.margeCibleDefaut) || 0;
    const cours = Number(rec.cours_devise);
    const sourceLibelle = libelleSource(rec, fournisseur.nom);
    let nouveaux = 0;
    // Cout de revient = prix d'achat + part des couts d'approche (transport,
    // assurance, douane, transit...) : c'est lui qui devient le cout de l'article.
    const repartition = repartirCouts(lignes, await lireCouts(client, id), cours);

    for (const [indexLigne, l] of lignes.entries()) {
      const coutUnitaire = repartition.lignes[indexLigne].cout_revient_unitaire_xof;
      await client.query(`UPDATE reception_ligne SET cout_revient_unitaire_xof = $1 WHERE id = $2`, [coutUnitaire, l.id]);
      let produitId = null;

      if (l.produit_id) {
        const p = await client.query(`SELECT id FROM produit WHERE id = $1 AND tenant_id = $2`, [l.produit_id, req.user.tenantId]);
        if (p.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: t(req, "RECEPTION_LIGNE_INVALID") });
        }
        produitId = l.produit_id;
      } else if (l.reference_fournisseur) {
        const m = await client.query(
          `SELECT produit_id FROM produit_reference_fournisseur
           WHERE tenant_id = $1 AND fournisseur_id = $2 AND lower(reference_fournisseur) = lower($3)`,
          [req.user.tenantId, rec.fournisseur_id, l.reference_fournisseur]
        );
        if (m.rows.length > 0) produitId = m.rows[0].produit_id;
      }

      if (!produitId) {
        const reference = l.reference_interne || (await genererReferenceInterne(client, req.user.tenantId));
        try {
          produitId = uuidv4();
          await client.query(
            `INSERT INTO produit (id, tenant_id, reference, designation, unite, cout_revient_unitaire_xof, marge_pct,
                                  source_libelle, date_cout, cree_par)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, CURRENT_DATE),$10)`,
            [produitId, req.user.tenantId, reference, l.designation, l.unite, coutUnitaire, margeDefaut, sourceLibelle,
             rec.date_reception, req.user.sub]
          );
          nouveaux += 1;
        } catch (err) {
          if (err.code === "23505") {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: t(req, "PRODUIT_REFERENCE_EXISTS") + " (" + reference + ")" });
          }
          throw err;
        }
      } else {
        await client.query(
          `UPDATE produit SET cout_revient_unitaire_xof = $1, source_libelle = $2, date_cout = COALESCE($3, CURRENT_DATE), date_maj = now()
           WHERE id = $4 AND tenant_id = $5`,
          [coutUnitaire, sourceLibelle, rec.date_reception, produitId, req.user.tenantId]
        );
      }

      if (l.reference_fournisseur) {
        await client.query(
          `INSERT INTO produit_reference_fournisseur (id, tenant_id, produit_id, fournisseur_id, reference_fournisseur, designation_fournisseur)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (tenant_id, fournisseur_id, lower(reference_fournisseur))
           DO UPDATE SET produit_id = EXCLUDED.produit_id, designation_fournisseur = EXCLUDED.designation_fournisseur`,
          [uuidv4(), req.user.tenantId, produitId, rec.fournisseur_id, l.reference_fournisseur, l.designation]
        );
      }

      await client.query(`UPDATE reception_ligne SET produit_id = $1 WHERE id = $2`, [produitId, l.id]);
      await enregistrerMouvement(client, {
        tenantId: req.user.tenantId,
        produitId,
        type: "ENTREE",
        quantite: Number(l.quantite),
        coutUnitaire,
        date: rec.date_reception,
        origineType: "RECEPTION",
        origineId: id,
        libelle: sourceLibelle,
        userId: req.user.sub,
      });
    }

    await client.query(
      `UPDATE reception_marchandise SET statut = 'VALIDEE', valide_par = $1, date_validation = now() WHERE id = $2`,
      [req.user.sub, id]
    );
    // La cotation du transitaire utilisee pour cette reception devient "retenue".
    if (rec.cotation_id) {
      await client.query(
        `UPDATE transitaire_cotation SET statut = 'RETENUE' WHERE id = $1 AND tenant_id = $2 AND statut = 'RECUE'`,
        [rec.cotation_id, req.user.tenantId]
      );
    }
    await client.query("COMMIT");
    if (rec.commande_id) await reevaluerMargeDossier(req.user.tenantId, rec.commande_id);
    const reception = await chargerReception(req.user.tenantId, id);
    res.json({ ...reception, nouveaux_articles: nouveaux });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "RECEPTION_VALIDATE_ERROR") });
  } finally {
    client.release();
  }
});

// Annulation d'une reception validee : mouvements inverses, refusee si le stock
// deviendrait negatif (marchandise deja livree).
router.post("/:id/annuler", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "RECEPTION_NOT_FOUND") });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const rec = (
      await client.query(`SELECT * FROM reception_marchandise WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, req.user.tenantId])
    ).rows[0];
    if (!rec) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "RECEPTION_NOT_FOUND") });
    }
    if (rec.statut !== "VALIDEE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "RECEPTION_ANNULATION_IMPOSSIBLE") });
    }
    const mouvements = (
      await client.query(
        `SELECT produit_id, SUM(quantite) AS quantite FROM mouvement_stock
         WHERE tenant_id = $1 AND origine_type = 'RECEPTION' AND origine_id = $2 AND type_mouvement = 'ENTREE'
         GROUP BY produit_id`,
        [req.user.tenantId, id]
      )
    ).rows;
    for (const m of mouvements) {
      const stock = await stockProduit(client, req.user.tenantId, m.produit_id);
      if (stock - Number(m.quantite) < -0.0005) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: t(req, "RECEPTION_ANNULATION_STOCK_INSUFFISANT") });
      }
    }
    for (const m of mouvements) {
      await enregistrerMouvement(client, {
        tenantId: req.user.tenantId,
        produitId: m.produit_id,
        type: "ANNULATION",
        quantite: -Number(m.quantite),
        origineType: "RECEPTION",
        origineId: id,
        libelle: `Annulation ${rec.numero}`,
        userId: req.user.sub,
      });
    }
    await client.query(`UPDATE reception_marchandise SET statut = 'ANNULEE' WHERE id = $1`, [id]);
    await client.query("COMMIT");
    if (rec.commande_id) await reevaluerMargeDossier(req.user.tenantId, rec.commande_id);
    res.json(await chargerReception(req.user.tenantId, id));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "RECEPTION_UPDATE_ERROR") });
  } finally {
    client.release();
  }
});

module.exports = router;
