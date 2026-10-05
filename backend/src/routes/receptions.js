const express = require("express");
const multer = require("multer");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { assurerTiersPourFournisseurSilencieux } = require("../services/comptaService");
const { chargerParametres } = require("../services/produitsCatalogue");
const { enregistrerMouvement, stockProduit, genererReferenceInterne } = require("../services/stockService");
const { lireFactureExcel } = require("../services/receptionExcel");
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
    const r = await db.query(`SELECT id, nom, pays FROM fournisseur WHERE tenant_id = $1 ORDER BY nom ASC`, [req.user.tenantId]);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "FOURNISSEURS_FETCH_ERROR") });
  }
});

router.post("/fournisseurs", async (req, res) => {
  const { nom, pays } = req.body;
  if (!nom || !String(nom).trim()) return res.status(400).json({ error: t(req, "FOURNISSEUR_NOM_REQUIRED") });
  try {
    const r = await db.query(
      `INSERT INTO fournisseur (id, tenant_id, nom, pays) VALUES ($1,$2,$3,$4) RETURNING id, nom, pays`,
      [uuidv4(), req.user.tenantId, String(nom).trim(), pays || null]
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
    });
  }
  return { couts };
}

async function remplacerCouts(client, tenantId, receptionId, couts) {
  await client.query(`DELETE FROM reception_cout_approche WHERE reception_id = $1`, [receptionId]);
  let ordre = 0;
  for (const c of couts) {
    await client.query(
      `INSERT INTO reception_cout_approche (id, tenant_id, reception_id, ordre, type_cout, libelle, montant, en_devise_facture, repartition)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [uuidv4(), tenantId, receptionId, ordre++, c.type_cout, c.libelle, c.montant, c.en_devise_facture, c.repartition]
    );
  }
}

async function lireCouts(queryable, receptionId) {
  return (
    await queryable.query(
      `SELECT id, ordre, type_cout, libelle, montant, en_devise_facture, repartition
       FROM reception_cout_approche WHERE reception_id = $1 ORDER BY ordre ASC`,
      [receptionId]
    )
  ).rows.map((c) => ({ ...c, montant: Number(c.montant) }));
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
  };
}

async function fournisseurDuTenant(queryable, tenantId, id) {
  if (!id || !UUID_RE.test(String(id))) return false;
  const r = await queryable.query(`SELECT 1 FROM fournisseur WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  return r.rows.length > 0;
}

async function chargerReception(tenantId, id) {
  if (!UUID_RE.test(String(id))) return null;
  const r = await db.query(
    `SELECT r.*, f.nom AS fournisseur_nom, ff.numero AS facture_fournisseur_numero
     FROM reception_marchandise r
     JOIN fournisseur f ON f.id = r.fournisseur_id
     LEFT JOIN facture_fournisseur ff ON ff.id = r.facture_fournisseur_id
     WHERE r.id = $1 AND r.tenant_id = $2`,
    [id, tenantId]
  );
  const reception = r.rows[0];
  if (!reception) return null;
  const lignes = (
    await db.query(
      `SELECT l.*, p.reference AS produit_reference, p.designation AS produit_designation,
              pm.id AS mapping_produit_id, pp.reference AS mapping_reference, pp.designation AS mapping_designation
       FROM reception_ligne l
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
  let totalDevise = 0;
  const lignesCalculees = lignesBase.map((l, i) => {
    const montantDevise = arr2(l.quantite * l.prix_unitaire_devise);
    totalDevise += montantDevise;
    return {
      ...l,
      montant_devise: montantDevise,
      cout_unitaire_xof: arr2(l.prix_unitaire_devise * cours),
      montant_xof: arr2(montantDevise * cours),
      cout_approche_xof: rep.lignes[i].cout_approche_xof,
      cout_revient_unitaire_xof: rep.lignes[i].cout_revient_unitaire_xof,
      cout_revient_total_xof: rep.lignes[i].cout_revient_total_xof,
      article_reconnu: l.mapping_produit_id
        ? { id: l.mapping_produit_id, reference: l.mapping_reference, designation: l.mapping_designation }
        : null,
    };
  });
  return {
    ...reception,
    cours_devise: cours,
    lignes: lignesCalculees,
    couts_approche: rep.couts,
    total_couts_approche_xof: rep.total_couts_approche_xof,
    cout_revient_total_xof: arr2(rep.total_achat_xof + rep.total_couts_approche_xof),
    avertissements_couts: [...rep.avertissements, ...avertissementsIncoterm(reception.incoterm, couts)],
    total_devise: arr2(totalDevise),
    total_xof: arr2(totalDevise * cours),
  };
}

async function remplacerLignes(client, receptionId, lignes) {
  await client.query(`DELETE FROM reception_ligne WHERE reception_id = $1`, [receptionId]);
  let ordre = 0;
  for (const l of lignes) {
    await client.query(
      `INSERT INTO reception_ligne (id, reception_id, ordre, reference_fournisseur, designation, unite, quantite,
                                    prix_unitaire_devise, produit_id, reference_interne, poids_unitaire_kg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [uuidv4(), receptionId, ordre++, l.reference_fournisseur, l.designation, l.unite, l.quantite,
       l.prix_unitaire_devise, l.produit_id, l.reference_interne, l.poids_unitaire_kg]
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
      `SELECT r.id, r.numero, r.reference_facture, r.date_reception, r.devise, r.cours_devise, r.incoterm, r.statut,
              f.nom AS fournisseur_nom,
              COUNT(l.id)::int AS nb_lignes,
              COALESCE(SUM(ROUND(l.quantite * l.prix_unitaire_devise, 2)), 0) AS total_devise
       FROM reception_marchandise r
       JOIN fournisseur f ON f.id = r.fournisseur_id
       LEFT JOIN reception_ligne l ON l.reception_id = r.id
       WHERE ${conditions.join(" AND ")}
       GROUP BY r.id, f.nom
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
                                          devise, cours_devise, incoterm, notes, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, CURRENT_DATE),$8,$9,$10,$11,$12)`,
      [id, req.user.tenantId, `REC-${annee}-${String(seq).padStart(4, "0")}`, b.fournisseur_id, entete.reference_facture,
       entete.date_facture, entete.date_reception, entete.devise, entete.cours, entete.incoterm, entete.notes, req.user.sub]
    );
    await remplacerLignes(client, id, net.lignes);
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
    });
    if (entete.erreur) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, entete.erreur) });
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
              date_reception = COALESCE($4, date_reception), devise = $5, cours_devise = $6, incoterm = $7, notes = $8
       WHERE id = $9`,
      [fournisseurId, entete.reference_facture, entete.date_facture, entete.date_reception, entete.devise, entete.cours,
       entete.incoterm, entete.notes, id]
    );
    if (Array.isArray(b.lignes)) {
      const net = nettoyerLignes(b.lignes);
      if (net.erreur) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, net.erreur) });
      }
      await remplacerLignes(client, id, net.lignes);
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
    res.json(estimerAssuranceEtDouane({ totalAchatXof: total, fretXof: fret, incoterm: req.body.incoterm }, parametres));
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
    await client.query("COMMIT");
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
