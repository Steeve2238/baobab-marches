const express = require("express");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { enregistrerMouvement, stockProduit } = require("../services/stockService");

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------------------------
// Livraison d'un dossier d'appel d'offres (05/10/2026, Lot 5) : la marchandise
// livree au maitre d'ouvrage sort du stock. Les consultations restreintes
// passent par devis -> facture -> bon de livraison (qui sortent deja du stock).
// Acces : modules "dossiers", "marches" ou "fournisseurs", admin, tableau de bord.
// ----------------------------------------------------------------------------
router.use((req, res, next) => {
  const permissions = req.user?.permissions;
  if (!permissions) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  if (permissions.admin || permissions.tableauDeBord) return next();
  if ((permissions.modules || []).some((m) => m === "dossiers" || m === "marches" || m === "fournisseurs")) return next();
  return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
});
router.use(blockLectureSeule);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNull = (v) => (typeof v === "string" && UUID_RE.test(v) ? v : null);
const arr3 = (n) => Math.round(n * 1000) / 1000;

async function chargerLivraison(tenantId, id) {
  if (!UUID_RE.test(String(id))) return null;
  const l = (
    await db.query(
      `SELECT v.*, d.reference_externe AS dossier_reference, d.intitule AS dossier_intitule
       FROM livraison_dossier v JOIN dossier_ao d ON d.id = v.dossier_ao_id
       WHERE v.id = $1 AND v.tenant_id = $2`,
      [id, tenantId]
    )
  ).rows[0];
  if (!l) return null;
  const lignes = (
    await db.query(
      `SELECT l.id, l.ordre, l.produit_id, l.designation, l.reference, l.unite, l.quantite, l.cout_unitaire_xof,
              COALESCE((SELECT SUM(m.quantite) FROM mouvement_stock m WHERE m.tenant_id = $2 AND m.produit_id = l.produit_id), 0) AS stock_actuel
       FROM livraison_dossier_ligne l WHERE l.livraison_id = $1 ORDER BY l.ordre ASC`,
      [id, tenantId]
    )
  ).rows.map((x) => ({
    ...x,
    quantite: Number(x.quantite),
    cout_unitaire_xof: x.cout_unitaire_xof === null ? null : Number(x.cout_unitaire_xof),
    stock_actuel: Number(x.stock_actuel),
  }));
  return { ...l, lignes, nb_lignes: lignes.length };
}

// Lignes saisies : article du catalogue + quantite. Les lignes vides sont ignorees ;
// les doublons d'un meme article sont cumules.
function nettoyerLignes(brutes) {
  const cumul = new Map();
  for (const l of Array.isArray(brutes) ? brutes : []) {
    const produitId = uuidOuNull(l.produit_id);
    const quantite = Number(l.quantite);
    if (!produitId && !(Number.isFinite(quantite) && quantite > 0)) continue;
    if (!produitId || !Number.isFinite(quantite) || quantite <= 0) return { erreur: "LIVRAISON_INVALID" };
    cumul.set(produitId, arr3((cumul.get(produitId) || 0) + quantite));
  }
  if (cumul.size === 0) return { erreur: "LIVRAISON_INVALID" };
  return { lignes: [...cumul.entries()].map(([produit_id, quantite]) => ({ produit_id, quantite })) };
}

async function remplacerLignes(client, tenantId, livraisonId, lignes) {
  await client.query(`DELETE FROM livraison_dossier_ligne WHERE livraison_id = $1`, [livraisonId]);
  let ordre = 0;
  for (const l of lignes) {
    const p = (await client.query(`SELECT reference, designation, unite FROM produit WHERE id = $1 AND tenant_id = $2`, [l.produit_id, tenantId])).rows[0];
    if (!p) return false;
    await client.query(
      `INSERT INTO livraison_dossier_ligne (id, livraison_id, ordre, produit_id, designation, reference, unite, quantite)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuidv4(), livraisonId, ordre++, l.produit_id, p.designation, p.reference, p.unite, l.quantite]
    );
  }
  return true;
}

async function dossierDuTenant(queryable, tenantId, id) {
  const idOk = uuidOuNull(id);
  if (!idOk) return false;
  return (await queryable.query(`SELECT 1 FROM dossier_ao WHERE id = $1 AND tenant_id = $2`, [idOk, tenantId])).rows.length > 0;
}

// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const where = ["v.tenant_id = $1"];
    const params = [req.user.tenantId];
    if (uuidOuNull(req.query.dossier_ao_id)) {
      params.push(req.query.dossier_ao_id);
      where.push(`v.dossier_ao_id = $${params.length}`);
    }
    if (["BROUILLON", "LIVREE", "ANNULEE"].includes(String(req.query.statut))) {
      params.push(req.query.statut);
      where.push(`v.statut = $${params.length}`);
    }
    const rows = (
      await db.query(
        `SELECT v.*, d.reference_externe AS dossier_reference, d.intitule AS dossier_intitule,
                (SELECT COUNT(*)::int FROM livraison_dossier_ligne l WHERE l.livraison_id = v.id) AS nb_lignes
         FROM livraison_dossier v JOIN dossier_ao d ON d.id = v.dossier_ao_id
         WHERE ${where.join(" AND ")} ORDER BY v.date_livraison DESC, v.date_creation DESC LIMIT 500`,
        params
      )
    ).rows;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "LIVRAISON_FETCH_ERROR") });
  }
});

// Marchandise recue pour le dossier (receptions validees des commandes du dossier)
// moins ce qui a deja ete livre : propose a la livraison, declare avant /:id.
router.get("/a-livrer", async (req, res) => {
  const dossierId = uuidOuNull(req.query.dossier_ao_id);
  if (!dossierId) return res.status(400).json({ error: t(req, "LIVRAISON_INVALID") });
  try {
    const rows = (
      await db.query(
        `WITH recu AS (
           SELECT rl.produit_id, SUM(rl.quantite) AS quantite
           FROM reception_ligne rl
           JOIN reception_marchandise r ON r.id = rl.reception_id
           JOIN commande_fournisseur cf ON cf.id = r.commande_id
           WHERE r.tenant_id = $1 AND r.statut = 'VALIDEE' AND cf.dossier_ao_id = $2 AND rl.produit_id IS NOT NULL
           GROUP BY rl.produit_id
         ), livre AS (
           SELECT l.produit_id, SUM(l.quantite) AS quantite
           FROM livraison_dossier_ligne l JOIN livraison_dossier v ON v.id = l.livraison_id
           WHERE v.tenant_id = $1 AND v.dossier_ao_id = $2 AND v.statut = 'LIVREE'
           GROUP BY l.produit_id
         )
         SELECT p.id AS produit_id, p.reference, p.designation, p.unite,
                COALESCE(recu.quantite, 0) AS recu, COALESCE(livre.quantite, 0) AS livre,
                COALESCE((SELECT SUM(m.quantite) FROM mouvement_stock m WHERE m.tenant_id = $1 AND m.produit_id = p.id), 0) AS stock_actuel
         FROM recu JOIN produit p ON p.id = recu.produit_id AND p.tenant_id = $1
         LEFT JOIN livre ON livre.produit_id = p.id
         ORDER BY p.designation ASC`,
        [req.user.tenantId, dossierId]
      )
    ).rows.map((r) => ({
      produit_id: r.produit_id,
      reference: r.reference,
      designation: r.designation,
      unite: r.unite,
      recu: Number(r.recu),
      livre: Number(r.livre),
      restant: Math.max(0, arr3(Number(r.recu) - Number(r.livre))),
      stock_actuel: Number(r.stock_actuel),
    }));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "LIVRAISON_FETCH_ERROR") });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const l = await chargerLivraison(req.user.tenantId, req.params.id);
    if (!l) return res.status(404).json({ error: t(req, "LIVRAISON_NOT_FOUND") });
    res.json(l);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "LIVRAISON_FETCH_ERROR") });
  }
});

router.post("/", async (req, res) => {
  const b = req.body || {};
  const net = nettoyerLignes(b.lignes);
  if (net.erreur) return res.status(400).json({ error: t(req, net.erreur) });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await dossierDuTenant(client, req.user.tenantId, b.dossier_ao_id))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "LIVRAISON_INVALID") });
    }
    const annee = new Date().getFullYear();
    await client.query(
      `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero) VALUES ($1,'LIVRAISON_DOSSIER',$2,0)
       ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
      [req.user.tenantId, annee]
    );
    const seq = (
      await client.query(
        `UPDATE compteur_numerotation SET dernier_numero = dernier_numero + 1
         WHERE tenant_id = $1 AND type_compteur = 'LIVRAISON_DOSSIER' AND annee = $2 RETURNING dernier_numero`,
        [req.user.tenantId, annee]
      )
    ).rows[0].dernier_numero;
    const id = uuidv4();
    await client.query(
      `INSERT INTO livraison_dossier (id, tenant_id, numero, dossier_ao_id, date_livraison, notes, cree_par)
       VALUES ($1,$2,$3,$4,COALESCE($5, CURRENT_DATE),$6,$7)`,
      [id, req.user.tenantId, `LIV-${annee}-${String(seq).padStart(4, "0")}`, b.dossier_ao_id, b.date_livraison || null,
       String(b.notes || "").trim() || null, req.user.sub]
    );
    if (!(await remplacerLignes(client, req.user.tenantId, id, net.lignes))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "LIVRAISON_INVALID") });
    }
    await client.query("COMMIT");
    res.status(201).json(await chargerLivraison(req.user.tenantId, id));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "LIVRAISON_SAVE_ERROR") });
  } finally {
    client.release();
  }
});

router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "LIVRAISON_NOT_FOUND") });
  const b = req.body || {};
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const actuelle = (await client.query(`SELECT * FROM livraison_dossier WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, req.user.tenantId])).rows[0];
    if (!actuelle) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "LIVRAISON_NOT_FOUND") });
    }
    if (actuelle.statut !== "BROUILLON") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "LIVRAISON_NON_MODIFIABLE") });
    }
    let dossierId = actuelle.dossier_ao_id;
    if (b.dossier_ao_id !== undefined) {
      if (!(await dossierDuTenant(client, req.user.tenantId, b.dossier_ao_id))) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "LIVRAISON_INVALID") });
      }
      dossierId = b.dossier_ao_id;
    }
    await client.query(
      `UPDATE livraison_dossier SET dossier_ao_id = $1, date_livraison = COALESCE($2, date_livraison), notes = $3 WHERE id = $4`,
      [dossierId, b.date_livraison || null, b.notes !== undefined ? String(b.notes || "").trim() || null : actuelle.notes, id]
    );
    if (Array.isArray(b.lignes)) {
      const net = nettoyerLignes(b.lignes);
      if (net.erreur || !(await remplacerLignes(client, req.user.tenantId, id, net.lignes))) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "LIVRAISON_INVALID") });
      }
    }
    await client.query("COMMIT");
    res.json(await chargerLivraison(req.user.tenantId, id));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "LIVRAISON_SAVE_ERROR") });
  } finally {
    client.release();
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "LIVRAISON_NOT_FOUND") });
  try {
    const r = await db.query(`DELETE FROM livraison_dossier WHERE id = $1 AND tenant_id = $2 AND statut = 'BROUILLON' RETURNING id`, [id, req.user.tenantId]);
    if (r.rows.length === 0) {
      const existe = await db.query(`SELECT 1 FROM livraison_dossier WHERE id = $1 AND tenant_id = $2`, [id, req.user.tenantId]);
      return res.status(existe.rows.length ? 409 : 404).json({ error: t(req, existe.rows.length ? "LIVRAISON_NON_MODIFIABLE" : "LIVRAISON_NOT_FOUND") });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "LIVRAISON_SAVE_ERROR") });
  }
});

// Validation : sortie de stock. Jamais bloquee par un stock insuffisant (la
// marchandise est physiquement partie) : les articles dont le stock devient
// negatif sont signales dans la reponse, comme pour le bon de livraison.
router.post("/:id/valider", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "LIVRAISON_NOT_FOUND") });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const liv = (await client.query(`SELECT * FROM livraison_dossier WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, req.user.tenantId])).rows[0];
    if (!liv) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "LIVRAISON_NOT_FOUND") });
    }
    if (liv.statut !== "BROUILLON") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "LIVRAISON_NON_MODIFIABLE") });
    }
    const lignes = (
      await client.query(
        `SELECT l.id, l.produit_id, l.quantite, p.cout_revient_unitaire_xof, p.reference, p.designation
         FROM livraison_dossier_ligne l JOIN produit p ON p.id = l.produit_id AND p.tenant_id = $2
         WHERE l.livraison_id = $1 ORDER BY l.ordre ASC`,
        [id, req.user.tenantId]
      )
    ).rows;
    if (lignes.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "LIVRAISON_INVALID") });
    }
    const avertissementsStock = [];
    for (const l of lignes) {
      const cout = Number(l.cout_revient_unitaire_xof);
      await client.query(`UPDATE livraison_dossier_ligne SET cout_unitaire_xof = $1 WHERE id = $2`, [cout, l.id]);
      await enregistrerMouvement(client, {
        tenantId: req.user.tenantId,
        produitId: l.produit_id,
        type: "SORTIE",
        quantite: -Number(l.quantite),
        coutUnitaire: cout,
        date: liv.date_livraison,
        origineType: "LIVRAISON_DOSSIER",
        origineId: id,
        libelle: `Livraison ${liv.numero}`,
        userId: req.user.sub,
      });
      const stock = await stockProduit(client, req.user.tenantId, l.produit_id);
      if (stock < 0) avertissementsStock.push({ produit_id: l.produit_id, reference: l.reference, designation: l.designation, stock });
    }
    await client.query(`UPDATE livraison_dossier SET statut = 'LIVREE', date_validation = now() WHERE id = $1`, [id]);
    await client.query("COMMIT");
    res.json({ ...(await chargerLivraison(req.user.tenantId, id)), avertissements_stock: avertissementsStock });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "LIVRAISON_SAVE_ERROR") });
  } finally {
    client.release();
  }
});

// Annulation : la marchandise revient en stock (mouvement inverse).
router.post("/:id/annuler", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "LIVRAISON_NOT_FOUND") });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const liv = (await client.query(`SELECT * FROM livraison_dossier WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, req.user.tenantId])).rows[0];
    if (!liv) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "LIVRAISON_NOT_FOUND") });
    }
    if (liv.statut !== "LIVREE") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "LIVRAISON_ANNULATION_IMPOSSIBLE") });
    }
    const mouvements = (
      await client.query(
        `SELECT produit_id, SUM(quantite) AS quantite, MAX(cout_unitaire_xof) AS cout FROM mouvement_stock
         WHERE tenant_id = $1 AND origine_type = 'LIVRAISON_DOSSIER' AND origine_id = $2 AND type_mouvement = 'SORTIE'
         GROUP BY produit_id`,
        [req.user.tenantId, id]
      )
    ).rows;
    for (const m of mouvements) {
      await enregistrerMouvement(client, {
        tenantId: req.user.tenantId,
        produitId: m.produit_id,
        type: "ANNULATION",
        quantite: -Number(m.quantite),
        coutUnitaire: m.cout === null ? null : Number(m.cout),
        origineType: "LIVRAISON_DOSSIER",
        origineId: id,
        libelle: `Annulation ${liv.numero}`,
        userId: req.user.sub,
      });
    }
    await client.query(`UPDATE livraison_dossier SET statut = 'ANNULEE' WHERE id = $1`, [id]);
    await client.query("COMMIT");
    res.json(await chargerLivraison(req.user.tenantId, id));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "LIVRAISON_SAVE_ERROR") });
  } finally {
    client.release();
  }
});

module.exports = router;
