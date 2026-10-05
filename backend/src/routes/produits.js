const express = require("express");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { prixVenteDepuisCout, chargerOffresRetenues, sourceLibelle } = require("../services/produitsCatalogue");
const { enregistrerMouvement, stockProduit } = require("../services/stockService");

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------------------------
// Catalogue "Produits" (base de calcul globale, 05/10/2026). Meme regle
// d'acces que le dossier de calcul (routes/calculPrix.js) : le catalogue sert
// a la fois a chiffrer les devis (module "marches") et a alimenter la base
// depuis les dossiers de calcul (modules "marches" ou "dossiers").
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function avecPrixVente(p) {
  return {
    ...p,
    stock_quantite: p.stock_quantite !== undefined ? Number(p.stock_quantite) : undefined,
    cout_revient_unitaire_xof: Number(p.cout_revient_unitaire_xof),
    marge_pct: Number(p.marge_pct),
    prix_vente_xof: prixVenteDepuisCout(p.cout_revient_unitaire_xof, p.marge_pct),
  };
}

// Valide cout (>= 0) et marge (fraction 0..10). Renvoie { erreur } ou les valeurs.
function validerCoutMarge(cout, marge) {
  const c = cout === undefined || cout === null || cout === "" ? 0 : Number(cout);
  const m = marge === undefined || marge === null || marge === "" ? 0 : Number(marge);
  if (!Number.isFinite(c) || c < 0 || c > 1e13) return { erreur: "PRODUIT_COUT_INVALID" };
  if (!Number.isFinite(m) || m < 0 || m > 10) return { erreur: "PRODUIT_MARGE_INVALID" };
  return { cout: Math.round(c * 100) / 100, marge: Math.round(m * 10000) / 10000 };
}

// GET /api/produits?q=&inclure_inactifs=1
router.get("/", async (req, res) => {
  const { q, inclure_inactifs } = req.query;
  try {
    const conditions = ["p.tenant_id = $1"];
    const valeurs = [req.user.tenantId];
    if (!inclure_inactifs) conditions.push("p.actif = true");
    if (q && String(q).trim()) {
      valeurs.push(`%${String(q).trim()}%`);
      conditions.push(`(p.designation ILIKE $${valeurs.length} OR p.reference ILIKE $${valeurs.length} OR p.categorie ILIKE $${valeurs.length})`);
    }
    const result = await db.query(
      `SELECT p.*, COALESCE((SELECT SUM(m.quantite) FROM mouvement_stock m WHERE m.produit_id = p.id), 0) AS stock_quantite
       FROM produit p WHERE ${conditions.join(" AND ")}
       ORDER BY lower(p.designation) ASC`,
      valeurs
    );
    res.json(result.rows.map(avecPrixVente));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRODUIT_FETCH_ERROR") });
  }
});

// GET /api/produits/candidats?dossier_calcul_id= : offres retenues des
// dossiers de calcul, avec indication de celles deja presentes au catalogue.
router.get("/candidats", async (req, res) => {
  const { dossier_calcul_id } = req.query;
  if (dossier_calcul_id && !UUID_RE.test(String(dossier_calcul_id))) return res.json([]);
  try {
    res.json(await chargerOffresRetenues(req.user.tenantId, { dossierCalculId: dossier_calcul_id || undefined }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRODUIT_FETCH_ERROR") });
  }
});

// POST /api/produits/importer { offre_ids: [...] } : cree un produit par offre
// retenue (ignore celles deja importees).
router.post("/importer", async (req, res) => {
  const ids = Array.isArray(req.body.offre_ids) ? req.body.offre_ids.filter((i) => UUID_RE.test(String(i))) : [];
  if (ids.length === 0) return res.status(400).json({ error: t(req, "PRODUIT_IMPORT_VIDE") });
  try {
    const candidats = await chargerOffresRetenues(req.user.tenantId, { offreIds: ids });
    let crees = 0;
    let ignores = 0;
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      for (const c of candidats) {
        if (c.deja_importe) {
          ignores += 1;
          continue;
        }
        await client.query(
          `INSERT INTO produit (id, tenant_id, designation, unite, cout_revient_unitaire_xof, marge_pct,
                                source_offre_id, source_libelle, date_cout, cree_par)
           VALUES ($1,$2,$3,'U',$4,$5,$6,$7,CURRENT_DATE,$8)`,
          [uuidv4(), req.user.tenantId, c.libelle, c.cout_revient_unitaire_xof, c.marge_pct, c.offre_id, sourceLibelle(c), req.user.sub]
        );
        crees += 1;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    res.status(201).json({ crees, ignores });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRODUIT_CREATE_ERROR") });
  }
});

router.post("/", async (req, res) => {
  const { reference, designation, unite, categorie, cout_revient_unitaire_xof, marge_pct, notes } = req.body;
  if (!designation || !String(designation).trim()) {
    return res.status(400).json({ error: t(req, "PRODUIT_DESIGNATION_REQUIRED") });
  }
  const v = validerCoutMarge(cout_revient_unitaire_xof, marge_pct);
  if (v.erreur) return res.status(400).json({ error: t(req, v.erreur) });
  try {
    const ref = reference && String(reference).trim() ? String(reference).trim() : null;
    const result = await db.query(
      `INSERT INTO produit (id, tenant_id, reference, designation, unite, categorie, cout_revient_unitaire_xof,
                            marge_pct, date_cout, notes, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE,$9,$10) RETURNING *`,
      [uuidv4(), req.user.tenantId, ref, String(designation).trim(), (unite && String(unite).trim()) || "U",
       (categorie && String(categorie).trim()) || null, v.cout, v.marge, (notes && String(notes).trim()) || null, req.user.sub]
    );
    res.status(201).json(avecPrixVente(result.rows[0]));
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: t(req, "PRODUIT_REFERENCE_EXISTS") });
    console.error(err);
    res.status(500).json({ error: t(req, "PRODUIT_CREATE_ERROR") });
  }
});

router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "PRODUIT_NOT_FOUND") });
  try {
    const actuel = (await db.query(`SELECT * FROM produit WHERE id = $1 AND tenant_id = $2`, [id, req.user.tenantId])).rows[0];
    if (!actuel) return res.status(404).json({ error: t(req, "PRODUIT_NOT_FOUND") });
    const b = req.body;
    const designation = b.designation !== undefined ? String(b.designation || "").trim() : actuel.designation;
    if (!designation) return res.status(400).json({ error: t(req, "PRODUIT_DESIGNATION_REQUIRED") });
    const v = validerCoutMarge(
      b.cout_revient_unitaire_xof !== undefined ? b.cout_revient_unitaire_xof : actuel.cout_revient_unitaire_xof,
      b.marge_pct !== undefined ? b.marge_pct : actuel.marge_pct
    );
    if (v.erreur) return res.status(400).json({ error: t(req, v.erreur) });
    const texte = (champ, defaut) => (b[champ] !== undefined ? (String(b[champ] || "").trim() || null) : defaut);
    const coutChange = Number(actuel.cout_revient_unitaire_xof) !== v.cout;
    const result = await db.query(
      `UPDATE produit SET reference = $1, designation = $2, unite = $3, categorie = $4, cout_revient_unitaire_xof = $5,
              marge_pct = $6, actif = $7, notes = $8, date_cout = CASE WHEN $9 THEN CURRENT_DATE ELSE date_cout END,
              date_maj = now()
       WHERE id = $10 AND tenant_id = $11 RETURNING *`,
      [texte("reference", actuel.reference), designation, texte("unite", actuel.unite) || "U", texte("categorie", actuel.categorie),
       v.cout, v.marge, b.actif !== undefined ? !!b.actif : actuel.actif, texte("notes", actuel.notes), coutChange, id, req.user.tenantId]
    );
    res.json(avecPrixVente(result.rows[0]));
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: t(req, "PRODUIT_REFERENCE_EXISTS") });
    console.error(err);
    res.status(500).json({ error: t(req, "PRODUIT_UPDATE_ERROR") });
  }
});

// POST /api/produits/:id/actualiser : relit cout de revient et marge depuis
// l'offre source (si elle existe encore et est toujours retenue).
router.post("/:id/actualiser", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "PRODUIT_NOT_FOUND") });
  try {
    const p = (await db.query(`SELECT * FROM produit WHERE id = $1 AND tenant_id = $2`, [id, req.user.tenantId])).rows[0];
    if (!p) return res.status(404).json({ error: t(req, "PRODUIT_NOT_FOUND") });
    if (!p.source_offre_id) return res.status(409).json({ error: t(req, "PRODUIT_SANS_SOURCE") });
    const [c] = await chargerOffresRetenues(req.user.tenantId, { offreIds: [p.source_offre_id] });
    if (!c) return res.status(409).json({ error: t(req, "PRODUIT_SOURCE_NON_RETENUE") });
    const result = await db.query(
      `UPDATE produit SET cout_revient_unitaire_xof = $1, marge_pct = $2, source_libelle = $3, date_cout = CURRENT_DATE, date_maj = now()
       WHERE id = $4 AND tenant_id = $5 RETURNING *`,
      [c.cout_revient_unitaire_xof, c.marge_pct, sourceLibelle({ dossier_nom: c.dossier_nom, fournisseur_nom: c.fournisseur_nom }), id, req.user.tenantId]
    );
    res.json(avecPrixVente(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRODUIT_UPDATE_ERROR") });
  }
});

// Mouvements de stock d'un article (entrees, sorties, ajustements).
router.get("/:id/mouvements", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "PRODUIT_NOT_FOUND") });
  try {
    const r = await db.query(
      `SELECT id, type_mouvement, quantite, cout_unitaire_xof, date_mouvement, origine_type, origine_id, libelle
       FROM mouvement_stock WHERE tenant_id = $1 AND produit_id = $2 ORDER BY date_mouvement DESC, date_creation DESC LIMIT 200`,
      [req.user.tenantId, id]
    );
    res.json(r.rows.map((m) => ({ ...m, quantite: Number(m.quantite), cout_unitaire_xof: m.cout_unitaire_xof === null ? null : Number(m.cout_unitaire_xof) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRODUIT_FETCH_ERROR") });
  }
});

// Correspondance references fournisseurs <-> cet article.
router.get("/:id/references-fournisseurs", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "PRODUIT_NOT_FOUND") });
  try {
    const r = await db.query(
      `SELECT pr.id, pr.reference_fournisseur, pr.designation_fournisseur, f.nom AS fournisseur_nom
       FROM produit_reference_fournisseur pr JOIN fournisseur f ON f.id = pr.fournisseur_id
       WHERE pr.tenant_id = $1 AND pr.produit_id = $2 ORDER BY f.nom, pr.reference_fournisseur`,
      [req.user.tenantId, id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRODUIT_FETCH_ERROR") });
  }
});

// Ajustement manuel du stock (inventaire, stock initial, casse...).
router.post("/:id/ajustement-stock", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "PRODUIT_NOT_FOUND") });
  const quantite = Number(req.body.quantite);
  const motif = String(req.body.motif || "").trim();
  if (!Number.isFinite(quantite) || quantite === 0) return res.status(400).json({ error: t(req, "PRODUIT_STOCK_QUANTITE_INVALID") });
  if (!motif) return res.status(400).json({ error: t(req, "PRODUIT_STOCK_MOTIF_REQUIRED") });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const p = (await client.query(`SELECT * FROM produit WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, req.user.tenantId])).rows[0];
    if (!p) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "PRODUIT_NOT_FOUND") });
    }
    await enregistrerMouvement(client, {
      tenantId: req.user.tenantId,
      produitId: id,
      type: "AJUSTEMENT",
      quantite: Math.round(quantite * 1000) / 1000,
      coutUnitaire: Number(p.cout_revient_unitaire_xof),
      origineType: "MANUEL",
      libelle: motif.slice(0, 200),
      userId: req.user.sub,
    });
    const stock = await stockProduit(client, req.user.tenantId, id);
    await client.query("COMMIT");
    res.json({ ...avecPrixVente(p), stock_quantite: stock });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "PRODUIT_UPDATE_ERROR") });
  } finally {
    client.release();
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "PRODUIT_NOT_FOUND") });
  try {
    const result = await db.query(`DELETE FROM produit WHERE id = $1 AND tenant_id = $2 RETURNING id`, [id, req.user.tenantId]);
    if (result.rows.length === 0) return res.status(404).json({ error: t(req, "PRODUIT_NOT_FOUND") });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRODUIT_DELETE_ERROR") });
  }
});

module.exports = router;
