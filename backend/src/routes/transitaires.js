const express = require("express");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { TYPES_COUT, REPARTITIONS } = require("../services/receptionCouts");
const {
  MODES_TRANSPORT,
  STATUTS_COTATION,
  validiteCotation,
  totalCotationXof,
  coutsDepuisCotation,
  statsTransitaires,
} = require("../services/transitaires");

const { assurerTiersPourTransitaireSilencieux } = require("../services/comptaService");
const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------------------------
// Transitaires, cotations et performance (05/10/2026, Lot 4).
// Acces : modules "logistique", "fournisseurs" ou "marches" (les trois equipes
// utilisent les memes transitaires), admin et tableau de bord.
// ----------------------------------------------------------------------------
router.use((req, res, next) => {
  const permissions = req.user?.permissions;
  if (!permissions) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  if (permissions.admin || permissions.tableauDeBord) return next();
  if ((permissions.modules || []).some((m) => m === "logistique" || m === "fournisseurs" || m === "marches")) return next();
  return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
});
router.use(blockLectureSeule);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const arr2 = (n) => Math.round(n * 100) / 100;
const texte = (v, max = 200) => String(v ?? "").trim().slice(0, max) || null;

// ---------------------------------------------------------------------------
// Cotations : lecture
// ---------------------------------------------------------------------------
const SELECT_COTATION = `
  SELECT c.*, tr.nom AS transitaire_nom
  FROM transitaire_cotation c
  JOIN transitaire tr ON tr.id = c.transitaire_id
`;

async function lignesCotations(ids) {
  if (ids.length === 0) return new Map();
  const rows = (
    await db.query(
      `SELECT id, cotation_id, ordre, type_cout, libelle, montant, repartition
       FROM transitaire_cotation_ligne WHERE cotation_id = ANY($1) ORDER BY cotation_id, ordre ASC`,
      [ids]
    )
  ).rows;
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.cotation_id)) m.set(r.cotation_id, []);
    m.get(r.cotation_id).push({ ...r, montant: Number(r.montant) });
  }
  return m;
}

function enrichirCotation(c, lignes) {
  return {
    ...c,
    cours_devise: Number(c.cours_devise),
    lignes,
    total_devise: arr2(lignes.reduce((s, l) => s + l.montant, 0)),
    total_xof: totalCotationXof(c, lignes),
    ...validiteCotation(c.date_validite),
  };
}

async function chargerCotation(tenantId, id) {
  if (!UUID_RE.test(String(id))) return null;
  const c = (await db.query(`${SELECT_COTATION} WHERE c.id = $1 AND c.tenant_id = $2`, [id, tenantId])).rows[0];
  if (!c) return null;
  const lignes = (await lignesCotations([id])).get(id) || [];
  return enrichirCotation(c, lignes);
}

async function listerCotations(tenantId, filtres = {}) {
  const where = ["c.tenant_id = $1"];
  const params = [tenantId];
  const ajouter = (sql, v) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (filtres.transitaire_id && UUID_RE.test(filtres.transitaire_id)) ajouter("c.transitaire_id = ?", filtres.transitaire_id);
  if (filtres.incoterm) ajouter("c.incoterm = ?", String(filtres.incoterm).toUpperCase());
  if (filtres.mode && MODES_TRANSPORT.includes(String(filtres.mode).toUpperCase())) ajouter("c.mode_transport = ?", String(filtres.mode).toUpperCase());
  if (filtres.origine) ajouter("c.origine ILIKE ?", `%${String(filtres.origine).trim()}%`);
  if (filtres.destination) ajouter("c.destination ILIKE ?", `%${String(filtres.destination).trim()}%`);
  if (filtres.statut && STATUTS_COTATION.includes(String(filtres.statut).toUpperCase())) ajouter("c.statut = ?", String(filtres.statut).toUpperCase());
  if (filtres.valides) where.push("c.statut <> 'REFUSEE' AND (c.date_validite IS NULL OR c.date_validite >= CURRENT_DATE)");
  const rows = (
    await db.query(`${SELECT_COTATION} WHERE ${where.join(" AND ")} ORDER BY c.date_cotation DESC, c.date_creation DESC LIMIT 500`, params)
  ).rows;
  const lignes = await lignesCotations(rows.map((r) => r.id));
  return rows.map((r) => enrichirCotation(r, lignes.get(r.id) || []));
}

// Validation du corps d'une cotation (creation et modification).
function nettoyerCotation(b) {
  const devise = String(b.devise || "XOF").trim().toUpperCase().slice(0, 8) || "XOF";
  const cours = devise === "XOF" ? 1 : Number(b.cours_devise);
  if (!Number.isFinite(cours) || cours <= 0) return { erreur: "COTATION_INVALID" };
  const mode = String(b.mode_transport || "MER").toUpperCase();
  if (!MODES_TRANSPORT.includes(mode)) return { erreur: "COTATION_INVALID" };
  const delai = b.delai_jours === "" || b.delai_jours === undefined || b.delai_jours === null ? null : Number(b.delai_jours);
  if (delai !== null && (!Number.isInteger(delai) || delai < 0)) return { erreur: "COTATION_INVALID" };
  const lignes = [];
  for (const l of Array.isArray(b.lignes) ? b.lignes : []) {
    const brut = l.montant === "" || l.montant === undefined || l.montant === null ? 0 : Number(l.montant);
    const type = String(l.type_cout || "AUTRE").toUpperCase();
    if (!Number.isFinite(brut) || brut < 0 || !TYPES_COUT.includes(type)) return { erreur: "COTATION_INVALID" };
    if (brut === 0) continue;
    const rep = String(l.repartition || "VALEUR").toUpperCase();
    lignes.push({ type_cout: type, libelle: texte(l.libelle), montant: arr2(brut), repartition: REPARTITIONS.includes(rep) ? rep : "VALEUR" });
  }
  if (lignes.length === 0) return { erreur: "COTATION_INVALID" };
  const dateValidite = b.date_validite || null;
  const dateCotation = b.date_cotation || null;
  if (dateValidite && dateCotation && String(dateValidite) < String(dateCotation)) return { erreur: "COTATION_INVALID" };
  return {
    cotation: {
      reference: texte(b.reference),
      origine: texte(b.origine),
      destination: texte(b.destination),
      mode_transport: mode,
      incoterm: texte(b.incoterm, 10) ? texte(b.incoterm, 10).toUpperCase() : null,
      devise,
      cours,
      date_cotation: dateCotation,
      date_validite: dateValidite,
      delai_jours: delai,
      notes: texte(b.notes, 2000),
    },
    lignes,
  };
}

async function remplacerLignesCotation(client, cotationId, lignes) {
  await client.query(`DELETE FROM transitaire_cotation_ligne WHERE cotation_id = $1`, [cotationId]);
  let ordre = 0;
  for (const l of lignes) {
    await client.query(
      `INSERT INTO transitaire_cotation_ligne (id, cotation_id, ordre, type_cout, libelle, montant, repartition)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuidv4(), cotationId, ordre++, l.type_cout, l.libelle, l.montant, l.repartition]
    );
  }
}

async function transitaireDuTenant(queryable, tenantId, id) {
  if (!id || !UUID_RE.test(String(id))) return false;
  return (await queryable.query(`SELECT 1 FROM transitaire WHERE id = $1 AND tenant_id = $2`, [id, tenantId])).rows.length > 0;
}

// ---------------------------------------------------------------------------
// Cotations : routes (declarees AVANT /:id)
// ---------------------------------------------------------------------------
router.get("/cotations", async (req, res) => {
  try {
    res.json(await listerCotations(req.user.tenantId, req.query));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "COTATION_FETCH_ERROR") });
  }
});

// Comparaison : cotations encore valides pour un trajet / un incoterm, de la
// moins chere a la plus chere, avec la fiabilite du transitaire.
router.get("/cotations/comparer", async (req, res) => {
  try {
    const liste = await listerCotations(req.user.tenantId, { ...req.query, valides: true });
    const stats = new Map((await statsTransitaires(req.user.tenantId)).map((s) => [s.id, s]));
    const lignes = liste
      .map((c) => {
        const s = stats.get(c.transitaire_id) || {};
        return {
          ...c,
          transitaire_taux_retard_pct: s.taux_retard_pct ?? null,
          transitaire_ecart_cote_reel_pct: s.ecart_cote_reel_pct ?? null,
          transitaire_nb_expeditions: s.nb_expeditions ?? 0,
        };
      })
      .sort((a, b) => a.total_xof - b.total_xof);
    const delais = lignes.filter((c) => c.delai_jours !== null).map((c) => c.delai_jours);
    const minDelai = delais.length ? Math.min(...delais) : null;
    const minTotal = lignes.length ? lignes[0].total_xof : null;
    res.json(
      lignes.map((c) => ({
        ...c,
        moins_chere: c.total_xof === minTotal,
        plus_rapide: minDelai !== null && c.delai_jours === minDelai,
        ecart_vs_moins_chere_pct: minTotal > 0 ? Math.round(((c.total_xof - minTotal) / minTotal) * 1000) / 10 : null,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "COTATION_FETCH_ERROR") });
  }
});

router.get("/cotations/:id", async (req, res) => {
  try {
    const c = await chargerCotation(req.user.tenantId, req.params.id);
    if (!c) return res.status(404).json({ error: t(req, "COTATION_NOT_FOUND") });
    res.json(c);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "COTATION_FETCH_ERROR") });
  }
});

// Couts d'approche proposes a partir d'une cotation (rien n'est enregistre) :
// l'ecran de reception les reprend puis l'utilisateur les ajuste.
router.get("/cotations/:id/couts", async (req, res) => {
  try {
    const c = await chargerCotation(req.user.tenantId, req.params.id);
    if (!c) return res.status(404).json({ error: t(req, "COTATION_NOT_FOUND") });
    res.json({
      cotation_id: c.id,
      transitaire_id: c.transitaire_id,
      transitaire_nom: c.transitaire_nom,
      incoterm: c.incoterm,
      delai_jours: c.delai_jours,
      statut_validite: c.statut_validite,
      couts: coutsDepuisCotation(c, c.lignes, req.query.devise),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "COTATION_FETCH_ERROR") });
  }
});

router.post("/cotations", async (req, res) => {
  const net = nettoyerCotation(req.body || {});
  if (net.erreur) return res.status(400).json({ error: t(req, net.erreur) });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await transitaireDuTenant(client, req.user.tenantId, req.body.transitaire_id))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "COTATION_INVALID") });
    }
    const id = uuidv4();
    const c = net.cotation;
    await client.query(
      `INSERT INTO transitaire_cotation (id, tenant_id, transitaire_id, reference, origine, destination, mode_transport, incoterm,
                                         devise, cours_devise, date_cotation, date_validite, delai_jours, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11, CURRENT_DATE),$12,$13,$14)`,
      [id, req.user.tenantId, req.body.transitaire_id, c.reference, c.origine, c.destination, c.mode_transport, c.incoterm,
       c.devise, c.cours, c.date_cotation, c.date_validite, c.delai_jours, c.notes]
    );
    await remplacerLignesCotation(client, id, net.lignes);
    await client.query("COMMIT");
    res.status(201).json(await chargerCotation(req.user.tenantId, id));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "COTATION_SAVE_ERROR") });
  } finally {
    client.release();
  }
});

router.patch("/cotations/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "COTATION_NOT_FOUND") });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const actuelle = (
      await client.query(`SELECT * FROM transitaire_cotation WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, req.user.tenantId])
    ).rows[0];
    if (!actuelle) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "COTATION_NOT_FOUND") });
    }
    const anciennesLignes = (await lignesCotations([id])).get(id) || [];
    const fusion = {
      ...actuelle,
      ...req.body,
      lignes: Array.isArray(req.body.lignes) ? req.body.lignes : anciennesLignes,
    };
    const net = nettoyerCotation({
      ...fusion,
      cours_devise: req.body.cours_devise !== undefined ? req.body.cours_devise : actuelle.cours_devise,
      date_cotation: fusion.date_cotation ? String(fusion.date_cotation).slice(0, 10) : null,
      date_validite: fusion.date_validite ? String(fusion.date_validite).slice(0, 10) : null,
    });
    if (net.erreur) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, net.erreur) });
    }
    let transitaireId = actuelle.transitaire_id;
    if (req.body.transitaire_id !== undefined) {
      if (!(await transitaireDuTenant(client, req.user.tenantId, req.body.transitaire_id))) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "COTATION_INVALID") });
      }
      transitaireId = req.body.transitaire_id;
    }
    const c = net.cotation;
    await client.query(
      `UPDATE transitaire_cotation SET transitaire_id = $1, reference = $2, origine = $3, destination = $4, mode_transport = $5,
              incoterm = $6, devise = $7, cours_devise = $8, date_cotation = COALESCE($9, date_cotation), date_validite = $10,
              delai_jours = $11, notes = $12
       WHERE id = $13`,
      [transitaireId, c.reference, c.origine, c.destination, c.mode_transport, c.incoterm, c.devise, c.cours,
       c.date_cotation, c.date_validite, c.delai_jours, c.notes, id]
    );
    if (Array.isArray(req.body.lignes)) await remplacerLignesCotation(client, id, net.lignes);
    await client.query("COMMIT");
    res.json(await chargerCotation(req.user.tenantId, id));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "COTATION_SAVE_ERROR") });
  } finally {
    client.release();
  }
});

router.post("/cotations/:id/statut", async (req, res) => {
  const statut = String(req.body.statut || "").toUpperCase();
  if (!STATUTS_COTATION.includes(statut)) return res.status(400).json({ error: t(req, "COTATION_STATUT_INVALID") });
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: t(req, "COTATION_NOT_FOUND") });
  try {
    const r = await db.query(`UPDATE transitaire_cotation SET statut = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id`, [
      statut,
      req.params.id,
      req.user.tenantId,
    ]);
    if (r.rows.length === 0) return res.status(404).json({ error: t(req, "COTATION_NOT_FOUND") });
    res.json(await chargerCotation(req.user.tenantId, req.params.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "COTATION_SAVE_ERROR") });
  }
});

router.delete("/cotations/:id", async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: t(req, "COTATION_NOT_FOUND") });
  try {
    const r = await db.query(`DELETE FROM transitaire_cotation WHERE id = $1 AND tenant_id = $2 RETURNING id`, [
      req.params.id,
      req.user.tenantId,
    ]);
    if (r.rows.length === 0) return res.status(404).json({ error: t(req, "COTATION_NOT_FOUND") });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "COTATION_DELETE_ERROR") });
  }
});

// ---------------------------------------------------------------------------
// Transitaires
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    res.json(await statsTransitaires(req.user.tenantId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "TRANSITAIRES_FETCH_ERROR") });
  }
});

router.post("/", async (req, res) => {
  const nom = texte(req.body.nom);
  if (!nom) return res.status(400).json({ error: t(req, "TRANSITAIRE_NOM_REQUIRED") });
  try {
    const id = uuidv4();
    await db.query(
      `INSERT INTO transitaire (id, tenant_id, nom, contact_json, email, telephone, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, req.user.tenantId, nom, {}, texte(req.body.email), texte(req.body.telephone, 50), texte(req.body.notes, 2000)]
    );
    await assurerTiersPourTransitaireSilencieux(req.user.tenantId, { id, nom });
    res.status(201).json((await statsTransitaires(req.user.tenantId, id))[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "TRANSITAIRE_CREATE_ERROR") });
  }
});

router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "TRANSITAIRE_NOT_FOUND") });
  try {
    const actuel = (await db.query(`SELECT * FROM transitaire WHERE id = $1 AND tenant_id = $2`, [id, req.user.tenantId])).rows[0];
    if (!actuel) return res.status(404).json({ error: t(req, "TRANSITAIRE_NOT_FOUND") });
    const b = req.body;
    const nom = b.nom !== undefined ? texte(b.nom) : actuel.nom;
    if (!nom) return res.status(400).json({ error: t(req, "TRANSITAIRE_NOM_REQUIRED") });
    await db.query(
      `UPDATE transitaire SET nom = $1, email = $2, telephone = $3, notes = $4, actif = $5 WHERE id = $6`,
      [
        nom,
        b.email !== undefined ? texte(b.email) : actuel.email,
        b.telephone !== undefined ? texte(b.telephone, 50) : actuel.telephone,
        b.notes !== undefined ? texte(b.notes, 2000) : actuel.notes,
        b.actif !== undefined ? b.actif === true || b.actif === "true" : actuel.actif,
        id,
      ]
    );
    await assurerTiersPourTransitaireSilencieux(req.user.tenantId, { id, nom });
    res.json((await statsTransitaires(req.user.tenantId, id))[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "TRANSITAIRE_UPDATE_ERROR") });
  }
});

// Fiche detaillee : performance, cotations, expeditions (receptions), couts par type.
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: t(req, "TRANSITAIRE_NOT_FOUND") });
  try {
    const fiche = (await statsTransitaires(req.user.tenantId, id))[0];
    if (!fiche) return res.status(404).json({ error: t(req, "TRANSITAIRE_NOT_FOUND") });
    const cotations = await listerCotations(req.user.tenantId, { transitaire_id: id });
    const expeditions = (
      await db.query(
        `SELECT r.id, r.numero, r.date_reception, r.date_expedition, r.date_arrivee_prevue, r.statut, r.incoterm,
                f.nom AS fournisseur_nom,
                CASE WHEN r.date_expedition IS NOT NULL THEN (r.date_reception - r.date_expedition) END AS delai_jours,
                CASE WHEN r.date_arrivee_prevue IS NOT NULL THEN (r.date_reception > r.date_arrivee_prevue) END AS retard,
                COALESCE((SELECT SUM(c.montant * CASE WHEN c.en_devise_facture THEN r.cours_devise ELSE 1 END)
                          FROM reception_cout_approche c WHERE c.reception_id = r.id AND c.transitaire_id = r.transitaire_id), 0) AS couts_xof
         FROM reception_marchandise r
         JOIN fournisseur f ON f.id = r.fournisseur_id
         WHERE r.tenant_id = $1 AND r.transitaire_id = $2 AND r.statut <> 'ANNULEE'
         ORDER BY r.date_reception DESC, r.date_creation DESC LIMIT 100`,
        [req.user.tenantId, id]
      )
    ).rows.map((e) => ({ ...e, couts_xof: arr2(Number(e.couts_xof)) }));
    const parType = (
      await db.query(
        `SELECT c.type_cout,
                SUM(c.montant * CASE WHEN c.en_devise_facture THEN r.cours_devise ELSE 1 END) AS total_xof
         FROM reception_cout_approche c JOIN reception_marchandise r ON r.id = c.reception_id
         WHERE c.tenant_id = $1 AND c.transitaire_id = $2 AND r.statut = 'VALIDEE'
         GROUP BY c.type_cout ORDER BY total_xof DESC`,
        [req.user.tenantId, id]
      )
    ).rows.map((r) => ({ type_cout: r.type_cout, total_xof: arr2(Number(r.total_xof)) }));
    res.json({ ...fiche, cotations, expeditions, couts_par_type: parType });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "TRANSITAIRES_FETCH_ERROR") });
  }
});

module.exports = router;
module.exports.nettoyerCotation = nettoyerCotation;
