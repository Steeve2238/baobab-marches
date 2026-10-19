const express = require("express");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { requireAuth, requireModuleAny, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const svc = require("../services/contratPrestation");
const { contratPrestationPdf } = require("../services/contratPrestationPdf");

/**
 * Contrats de prestation (prestataires, consultants, freelances). Distinct des contrats de travail : pas de paie, pas de DMT.
 * Acces : fournisseurs, marches ou rh (ADMIN compris). Le contrat est FIGE a la validation ; le scan signe peut etre joint ensuite.
 */
const router = express.Router();
router.use(requireAuth);
router.use(requireModuleAny("fournisseurs", "marches", "rh"));
router.use(blockLectureSeule);

async function chargerEntete(tenantId) {
  const r = await db.query(
    `SELECT raison_sociale, adresse, telephone, email, signataire_nom, signataire_titre, rccm, ninea, site_web,
            coordonnees_bancaires, logo_base64, logo_type_mime, signature_cachet_base64, signature_cachet_type_mime
     FROM tenant WHERE id = $1`,
    [tenantId]
  );
  return r.rows[0] || {};
}

async function prochainNumero(tenantId) {
  const annee = new Date().getFullYear();
  const r = await db.query(
    `INSERT INTO rh_numerotation (tenant_id, type, annee, dernier) VALUES ($1, 'PRESTATION', $2, 1)
     ON CONFLICT (tenant_id, type, annee) DO UPDATE SET dernier = rh_numerotation.dernier + 1
     RETURNING dernier`,
    [tenantId, annee]
  );
  return `CP-${annee}-${String(r.rows[0].dernier).padStart(4, "0")}`;
}

const jours = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Indicateurs d'echeance : fin_proche (dans 30 jours), expire (date de fin depassee, contrat toujours actif). */
function indicateurs(row) {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const actif = row.statut === "VALIDE" || row.statut === "SIGNE";
  const fin = row.date_fin ? String(row.date_fin).slice(0, 10) : null;
  return {
    fin_proche: Boolean(actif && fin && fin >= aujourdhui && fin <= jours(aujourdhui, 30)),
    expire: Boolean(actif && fin && fin < aujourdhui),
  };
}

function champsPourRedaction(row) {
  return {
    ...row,
    date_effet: row.date_effet ? String(row.date_effet).slice(0, 10) : null,
    date_fin: row.date_fin ? String(row.date_fin).slice(0, 10) : null,
    date_contrat: row.date_contrat ? String(row.date_contrat).slice(0, 10) : null,
  };
}

async function composer(tenantId, row) {
  const entete = await chargerEntete(tenantId);
  const champs = champsPourRedaction(row);
  let contenu = row.contenu_json;
  let avert = [];
  if (!contenu) {
    contenu = svc.rediger(entete, champs);
    avert = svc.avertissements(entete, champs);
  }
  const { signe_base64, contenu_json, ...reste } = row;
  let fournisseur = null;
  if (row.fournisseur_id) {
    const f = await db.query(`SELECT id, nom FROM fournisseur WHERE id = $1 AND tenant_id = $2`, [row.fournisseur_id, tenantId]);
    fournisseur = f.rows[0] || null;
  }
  return { ...reste, a_fichier_signe: Boolean(signe_base64), fige: Boolean(contenu_json), contenu, avertissements: avert, fournisseur, ...indicateurs(row) };
}

async function charger(req, res) {
  const r = await db.query(`SELECT * FROM contrat_prestation WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.user.tenantId]);
  if (r.rows.length === 0) {
    res.status(404).json({ error: t(req, "PRESTA_INTROUVABLE") });
    return null;
  }
  return r.rows[0];
}

async function verifierFournisseur(tenantId, fournisseurId) {
  if (!fournisseurId) return true;
  const r = await db.query(`SELECT 1 FROM fournisseur WHERE id = $1 AND tenant_id = $2`, [fournisseurId, tenantId]);
  return r.rows.length > 0;
}

// ----------------------------------------------------------------------------------------------- liste
router.get("/", async (req, res) => {
  try {
    const params = [req.user.tenantId];
    let where = "WHERE tenant_id = $1";
    if (req.query.statut && svc.STATUTS.includes(String(req.query.statut))) {
      params.push(String(req.query.statut));
      where += ` AND statut = $${params.length}`;
    }
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim().slice(0, 100)}%`);
      where += ` AND (prestataire_nom ILIKE $${params.length} OR objet ILIKE $${params.length} OR numero ILIKE $${params.length})`;
    }
    const r = await db.query(
      `SELECT id, numero, statut, forme, prestataire_nom, objet, date_effet, date_fin, mode_honoraires, montant, quantite_estimee, devise, date_creation
       FROM contrat_prestation ${where} ORDER BY date_creation DESC LIMIT 500`,
      params
    );
    res.json(r.rows.map((x) => ({ ...x, ...indicateurs(x) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRESTA_ERREUR") });
  }
});

// Valeurs par defaut d'un nouveau contrat (prestataire repris de la fiche fournisseur si fournisseur_id est donne).
router.get("/prefill", async (req, res) => {
  try {
    const entete = await chargerEntete(req.user.tenantId);
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const base = {
      forme: "PERSONNE_PHYSIQUE", mode_honoraires: "FORFAIT", devise: "XOF", propriete_livrables: "ENTREPRISE",
      date_contrat: aujourdhui, date_effet: aujourdhui, date_fin: null, preavis_jours: 30, delai_paiement_jours: 30,
      retenue_taux: svc.TAUX_RETENUE_PP, juridiction: "Tribunal de commerce de Dakar", lieu_signature: "Dakar",
      tacite_reconduction: false, sous_traitance_autorisee: false, tva_applicable: false, montants_ttc: false, frais_remboursables: false,
      echeancier: [], prestataire_paiement: "",
    };
    if (req.query.fournisseur_id) {
      const f = await db.query(`SELECT id, nom FROM fournisseur WHERE id = $1 AND tenant_id = $2`, [req.query.fournisseur_id, req.user.tenantId]);
      if (f.rows.length === 0) return res.status(404).json({ error: t(req, "PRESTA_FOURNISSEUR_INTROUVABLE") });
      base.fournisseur_id = f.rows[0].id;
      base.prestataire_nom = f.rows[0].nom;
    }
    res.json({ ...base, entreprise: { raison_sociale: entete.raison_sociale || "", signataire_nom: entete.signataire_nom || "" } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRESTA_ERREUR") });
  }
});

// Fournisseurs proposes pour pre-remplir le prestataire.
router.get("/fournisseurs", async (req, res) => {
  try {
    const r = await db.query(`SELECT id, nom FROM fournisseur WHERE tenant_id = $1 ORDER BY nom LIMIT 1000`, [req.user.tenantId]);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRESTA_ERREUR") });
  }
});

// ----------------------------------------------------------------------------------------------- creation / lecture / modification
router.post("/", async (req, res) => {
  try {
    const { v, erreurs } = svc.champsContrat(req.body || {});
    if (erreurs.length) return res.status(400).json({ error: t(req, "PRESTA_CHAMP_INVALIDE"), champs: erreurs });
    if (!v.prestataire_nom || !v.objet || !v.date_effet) return res.status(400).json({ error: t(req, "PRESTA_CHAMPS_REQUIS") });
    if (req.body.fournisseur_id) {
      if (!(await verifierFournisseur(req.user.tenantId, req.body.fournisseur_id))) return res.status(404).json({ error: t(req, "PRESTA_FOURNISSEUR_INTROUVABLE") });
      v.fournisseur_id = req.body.fournisseur_id;
    }
    const numero = await prochainNumero(req.user.tenantId);
    const id = uuidv4();
    const cols = { id, tenant_id: req.user.tenantId, numero, cree_par: req.user.sub, ...v };
    const noms = Object.keys(cols);
    await db.query(`INSERT INTO contrat_prestation (${noms.join(", ")}) VALUES (${noms.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(cols));
    const row = (await db.query(`SELECT * FROM contrat_prestation WHERE id = $1`, [id])).rows[0];
    res.status(201).json(await composer(req.user.tenantId, row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRESTA_ERREUR") });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    res.json(await composer(req.user.tenantId, row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRESTA_ERREUR") });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (row.statut !== "BROUILLON") return res.status(409).json({ error: t(req, "PRESTA_FIGE") });
    const { v, erreurs } = svc.champsContrat(req.body || {});
    if (erreurs.length) return res.status(400).json({ error: t(req, "PRESTA_CHAMP_INVALIDE"), champs: erreurs });
    if ("prestataire_nom" in v && !v.prestataire_nom) return res.status(400).json({ error: t(req, "PRESTA_CHAMPS_REQUIS") });
    if ("objet" in v && !v.objet) return res.status(400).json({ error: t(req, "PRESTA_CHAMPS_REQUIS") });
    if ("date_effet" in v && !v.date_effet) return res.status(400).json({ error: t(req, "PRESTA_CHAMPS_REQUIS") });
    if ("fournisseur_id" in (req.body || {})) {
      const fid = req.body.fournisseur_id || null;
      if (!(await verifierFournisseur(req.user.tenantId, fid))) return res.status(404).json({ error: t(req, "PRESTA_FOURNISSEUR_INTROUVABLE") });
      v.fournisseur_id = fid;
    }
    const cles = Object.keys(v);
    if (cles.length) {
      const sets = [...cles.map((c, i) => `${c} = $${i + 1}`), "date_modification = now()"];
      await db.query(`UPDATE contrat_prestation SET ${sets.join(", ")} WHERE id = $${cles.length + 1} AND tenant_id = $${cles.length + 2}`, [...cles.map((c) => v[c]), row.id, req.user.tenantId]);
    }
    const maj = (await db.query(`SELECT * FROM contrat_prestation WHERE id = $1`, [row.id])).rows[0];
    res.json(await composer(req.user.tenantId, maj));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRESTA_ERREUR") });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (row.statut !== "BROUILLON") return res.status(409).json({ error: t(req, "PRESTA_FIGE") });
    await db.query(`DELETE FROM contrat_prestation WHERE id = $1 AND tenant_id = $2`, [row.id, req.user.tenantId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRESTA_ERREUR") });
  }
});

// ----------------------------------------------------------------------------------------------- cycle de vie
router.post("/:id/valider", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (row.statut !== "BROUILLON") return res.status(409).json({ error: t(req, "PRESTA_FIGE") });
    const vue = await composer(req.user.tenantId, row);
    if (vue.avertissements.some((a) => a.niveau === "BLOQUANT")) {
      return res.status(422).json({ error: t(req, "PRESTA_BLOQUANT"), avertissements: vue.avertissements });
    }
    const contenu = { ...vue.contenu, numero: row.numero };
    const empreinte = crypto.createHash("sha256").update(JSON.stringify(contenu)).digest("hex");
    await db.query(
      `UPDATE contrat_prestation SET statut = 'VALIDE', contenu_json = $1, empreinte = $2, date_validation = now(), valide_par = $3, date_modification = now()
       WHERE id = $4 AND tenant_id = $5 AND statut = 'BROUILLON'`,
      [JSON.stringify(contenu), empreinte, req.user.sub, row.id, req.user.tenantId]
    );
    const maj = (await db.query(`SELECT * FROM contrat_prestation WHERE id = $1`, [row.id])).rows[0];
    res.json(await composer(req.user.tenantId, maj));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRESTA_ERREUR") });
  }
});

function fichierValide(f) {
  if (!f || !f.base64) return null;
  const b64 = String(f.base64).replace(/^data:[^,]*,/, "");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return null;
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0 || buf.length > 8 * 1024 * 1024) return null;
  const pdf = buf.slice(0, 5).toString() === "%PDF-";
  const png = buf.length > 8 && buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const jpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
  if (!pdf && !png && !jpg) return null;
  const mime = pdf ? "application/pdf" : png ? "image/png" : "image/jpeg";
  return { base64: buf.toString("base64"), mime, nom: String(f.nom || `contrat-signe.${pdf ? "pdf" : png ? "png" : "jpg"}`).slice(0, 120) };
}

// Exemplaire signe (scan) : un contrat valide passe a SIGNE ; le scan peut ensuite etre remplace.
router.put("/:id/scan", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (!["VALIDE", "SIGNE", "TERMINE", "RESILIE"].includes(row.statut)) return res.status(409).json({ error: t(req, "PRESTA_ETAPE_INVALIDE") });
    const f = fichierValide(req.body);
    if (!f) return res.status(400).json({ error: t(req, "PRESTA_FICHIER_INVALIDE") });
    const d = svc.dateOuNull(req.body.date_signature);
    if (d === undefined) return res.status(400).json({ error: t(req, "PRESTA_CHAMP_INVALIDE"), champs: ["date_signature"] });
    const statut = row.statut === "VALIDE" ? "SIGNE" : row.statut;
    await db.query(
      `UPDATE contrat_prestation SET signe_base64 = $1, signe_type_mime = $2, signe_nom_fichier = $3, statut = $4,
              date_signature = COALESCE($5::date, date_signature, CURRENT_DATE), date_modification = now() WHERE id = $6 AND tenant_id = $7`,
      [f.base64, f.mime, f.nom, statut, d, row.id, req.user.tenantId]
    );
    const maj = (await db.query(`SELECT * FROM contrat_prestation WHERE id = $1`, [row.id])).rows[0];
    res.json(await composer(req.user.tenantId, maj));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRESTA_ERREUR") });
  }
});

router.get("/:id/scan", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (!row.signe_base64) return res.status(404).json({ error: t(req, "PRESTA_SCAN_ABSENT") });
    res.setHeader("Content-Type", row.signe_type_mime || "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${(row.signe_nom_fichier || row.numero).replace(/[^\w.\- ]/g, "_")}"`);
    res.send(Buffer.from(row.signe_base64, "base64"));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRESTA_ERREUR") });
  }
});

async function terminer(req, res, vers) {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (!["VALIDE", "SIGNE"].includes(row.statut)) return res.status(409).json({ error: t(req, "PRESTA_ETAPE_INVALIDE") });
    const d = svc.dateOuNull(req.body && req.body.date);
    if (d === undefined) return res.status(400).json({ error: t(req, "PRESTA_CHAMP_INVALIDE"), champs: ["date"] });
    const motif = req.body && req.body.motif ? String(req.body.motif).trim().slice(0, 1000) : null;
    if (vers === "RESILIE" && !motif) return res.status(400).json({ error: t(req, "PRESTA_MOTIF_REQUIS") });
    await db.query(
      `UPDATE contrat_prestation SET statut = $1, date_fin_reelle = COALESCE($2::date, CURRENT_DATE), motif_fin = $3, date_modification = now() WHERE id = $4 AND tenant_id = $5`,
      [vers, d, motif, row.id, req.user.tenantId]
    );
    const maj = (await db.query(`SELECT * FROM contrat_prestation WHERE id = $1`, [row.id])).rows[0];
    res.json(await composer(req.user.tenantId, maj));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRESTA_ERREUR") });
  }
}
router.post("/:id/terminer", (req, res) => terminer(req, res, "TERMINE"));
router.post("/:id/resilier", (req, res) => terminer(req, res, "RESILIE"));

// Annulation : seulement avant signature (un contrat signe se resilie).
router.post("/:id/annuler", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (!["BROUILLON", "VALIDE"].includes(row.statut)) return res.status(409).json({ error: t(req, "PRESTA_ETAPE_INVALIDE") });
    await db.query(`UPDATE contrat_prestation SET statut = 'ANNULE', date_modification = now() WHERE id = $1 AND tenant_id = $2`, [row.id, req.user.tenantId]);
    const maj = (await db.query(`SELECT * FROM contrat_prestation WHERE id = $1`, [row.id])).rows[0];
    res.json(await composer(req.user.tenantId, maj));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRESTA_ERREUR") });
  }
});

router.get("/:id/pdf", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    const vue = await composer(req.user.tenantId, row);
    const entete = await chargerEntete(req.user.tenantId);
    const valide = row.statut !== "BROUILLON" && row.statut !== "ANNULE";
    const buf = await contratPrestationPdf(row, vue.contenu, entete, { valide });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${row.numero}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PRESTA_ERREUR") });
  }
});

module.exports = router;
