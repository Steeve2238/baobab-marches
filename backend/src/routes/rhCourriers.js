const express = require("express");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { requireAuth, requireModule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const C = require("../services/rhCourriers");
const { chargerEntete, chargerEmploye, prochainNumero, dateOuNull } = require("../services/rhCommun");
const { courrierRhPdf } = require("../services/rhDocumentsPdf");
const mailer = require("../utils/mailer");
const sig = require("../services/rhSignature");

/**
 * RH lot 4 : courriers RH (modeles modifiables, redaction, emission figee, PDF, publication dans l'espace employe,
 * suivi de la remise et de la reponse du salarie). Acces : module "rh".
 */
const router = express.Router();
router.use(requireAuth);
router.use(requireModule("rh"));

const erreur = (req, res, err, code = "RH_COURRIER_ERREUR") => {
  console.error(err);
  res.status(500).json({ error: t(req, code) });
};

async function modeleDe(tenantId, type) {
  const r = await db.query(`SELECT objet, paragraphes_json FROM rh_modele_courrier WHERE tenant_id = $1 AND type = $2`, [tenantId, type]);
  if (r.rows[0]) return { objet: r.rows[0].objet, paragraphes: r.rows[0].paragraphes_json, personnalise: true };
  return { objet: C.TYPES[type].objet, paragraphes: C.TYPES[type].paragraphes, personnalise: false };
}

// ------------------------------------------------------------------------------------------- types et modeles
router.get("/courriers/types", async (req, res) => {
  try {
    const perso = await db.query(`SELECT type, objet, paragraphes_json FROM rh_modele_courrier WHERE tenant_id = $1`, [req.user.tenantId]);
    const map = Object.fromEntries(perso.rows.map((r) => [r.type, r]));
    res.json(
      C.ORDRE_TYPES.map((type) => {
        const d = C.TYPES[type];
        const p = map[type];
        return {
          type, format: d.format, accuse: d.accuse || null, reponse: Boolean(d.reponse), lignes: Boolean(d.lignes),
          champs: d.champs,
          modele: p ? { objet: p.objet, paragraphes: p.paragraphes_json, personnalise: true } : { objet: d.objet, paragraphes: d.paragraphes, personnalise: false },
          modele_defaut: { objet: d.objet, paragraphes: d.paragraphes },
        };
      })
    );
  } catch (err) { erreur(req, res, err); }
});

router.put("/modeles-courriers/:type", async (req, res) => {
  try {
    const type = req.params.type;
    if (!C.TYPES[type]) return res.status(404).json({ error: t(req, "RH_COURRIER_TYPE_INVALIDE") });
    const objet = req.body.objet ? String(req.body.objet).trim() : "";
    const paragraphes = (Array.isArray(req.body.paragraphes) ? req.body.paragraphes : []).map((p) => String(p).trim()).filter(Boolean);
    if (!objet || paragraphes.length === 0 || paragraphes.length > 30) return res.status(400).json({ error: t(req, "RH_COURRIER_MODELE_INVALIDE") });
    await db.query(
      `INSERT INTO rh_modele_courrier (tenant_id, type, objet, paragraphes_json, modifie_par) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, type) DO UPDATE SET objet = EXCLUDED.objet, paragraphes_json = EXCLUDED.paragraphes_json,
         date_modification = now(), modifie_par = EXCLUDED.modifie_par`,
      [req.user.tenantId, type, objet, JSON.stringify(paragraphes), req.user.sub]
    );
    res.json({ ok: true });
  } catch (err) { erreur(req, res, err); }
});

router.delete("/modeles-courriers/:type", async (req, res) => {
  try {
    await db.query(`DELETE FROM rh_modele_courrier WHERE tenant_id = $1 AND type = $2`, [req.user.tenantId, req.params.type]);
    res.json({ ok: true });
  } catch (err) { erreur(req, res, err); }
});

// ------------------------------------------------------------------------------------------- helpers courriers
function champsValides(type, brut) {
  const def = C.TYPES[type];
  const out = {};
  const b = brut && typeof brut === "object" ? brut : {};
  for (const c of def.champs) {
    let v = b[c.name];
    if (v == null || String(v).trim() === "") { out[c.name] = ""; continue; }
    if (c.type === "date") { v = dateOuNull(v); if (v === undefined) return null; }
    else if (c.type === "int") { v = Number(v); if (!Number.isInteger(v) || v < 0) return null; }
    else if (c.type === "time") { v = String(v).trim(); if (!/^\d{2}:\d{2}$/.test(v)) return null; }
    else v = String(v).trim().slice(0, 4000);
    out[c.name] = v;
  }
  return out;
}

function lignesValides(brut) {
  if (!Array.isArray(brut)) return [];
  const out = [];
  for (const l of brut.slice(0, 40)) {
    const libelle = String(l.libelle || "").trim().slice(0, 200);
    const montant = Number(l.montant);
    if (!libelle && !l.montant) continue;
    if (!libelle || !Number.isFinite(montant) || montant < 0) return null;
    out.push({ libelle, montant: Math.round(montant) });
  }
  return out;
}

async function charger(req, res) {
  const r = await db.query(`SELECT * FROM rh_courrier WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.user.tenantId]);
  if (r.rows.length === 0) { res.status(404).json({ error: t(req, "RH_COURRIER_INTROUVABLE") }); return null; }
  return r.rows[0];
}

async function composer(tenantId, row) {
  const emp = await chargerEmploye(tenantId, row.employe_id);
  const entete = await chargerEntete(tenantId);
  let contenu = row.contenu_json;
  let avert = [];
  if (!contenu) {
    const modele = await modeleDe(tenantId, row.type);
    contenu = C.rediger(row.type, modele, entete, emp, row.champs_json || {}, row.lignes_json || [], {
      numero: row.numero, lieu: row.lieu, date_courrier: row.date_courrier,
    });
    avert = C.avertissements(row.type, entete, emp, row.champs_json || {}, row.lignes_json || []);
  }
  return {
    ...row,
    employe: { id: emp.id, nom: emp.nom, prenom: emp.prenom, matricule: emp.matricule, a_compte: Boolean(emp.utilisateur_id) },
    contenu,
    fige: Boolean(row.contenu_json),
    avertissements: avert,
    accuse_requis: Boolean(C.TYPES[row.type] && C.TYPES[row.type].accuse),
    reponse_prevue: Boolean(C.TYPES[row.type] && C.TYPES[row.type].reponse),
  };
}

// Valeurs par defaut d'un nouveau courrier a partir de la fiche employe.
router.get("/courriers/prefill", async (req, res) => {
  try {
    const type = req.query.type;
    if (!C.TYPES[type]) return res.status(400).json({ error: t(req, "RH_COURRIER_TYPE_INVALIDE") });
    const emp = await chargerEmploye(req.user.tenantId, req.query.employe_id);
    if (!emp) return res.status(404).json({ error: t(req, "RH_COURRIER_EMPLOYE_INTROUVABLE") });
    const champs = {};
    for (const c of C.TYPES[type].champs) champs[c.name] = "";
    let lignes = [];
    if (type === "CERTIFICAT_TRAVAIL" || type === "SOLDE_TOUT_COMPTE") champs.date_sortie = emp.date_sortie ? String(emp.date_sortie).slice(0, 10) : "";
    if (type === "DOMICILIATION_SALAIRE") { champs.banque = emp.banque || ""; champs.numero_compte = emp.numero_compte || ""; }
    if (type === "CHANGEMENT_POSTE") champs.ancien_poste = emp.poste || "";
    if (type === "SOLDE_TOUT_COMPTE") champs.mode_paiement = emp.mode_paiement === "VIREMENT" ? "virement" : emp.mode_paiement === "ESPECES" ? "espèces" : "";
    if (type === "ATTESTATION_SALAIRE") {
      const c = await db.query(
        `SELECT elements_json FROM rh_contrat WHERE tenant_id = $1 AND employe_id = $2 AND statut <> 'ANNULE' ORDER BY date_creation DESC LIMIT 1`,
        [req.user.tenantId, emp.id]
      );
      if (c.rows[0]) lignes = (c.rows[0].elements_json || []).map((l) => ({ libelle: l.libelle, montant: Number(l.montant) || 0 }));
    }
    res.json({ employe_id: emp.id, type, date_courrier: new Date().toISOString().slice(0, 10), lieu: "Dakar", champs, lignes, notes: "" });
  } catch (err) { erreur(req, res, err); }
});

router.get("/courriers", async (req, res) => {
  try {
    const params = [req.user.tenantId];
    let where = "c.tenant_id = $1";
    if (req.query.employe_id) { params.push(req.query.employe_id); where += ` AND c.employe_id = $${params.length}`; }
    if (req.query.type) { params.push(req.query.type); where += ` AND c.type = $${params.length}`; }
    if (req.query.statut) { params.push(req.query.statut); where += ` AND c.statut = $${params.length}`; }
    const r = await db.query(
      `SELECT c.id, c.numero, c.type, c.statut, c.date_courrier, c.visible_employe, c.date_lecture, c.date_accuse, c.date_reponse,
              c.mode_remise, c.date_remise, c.date_creation,
              COALESCE(e.nom, u.nom) AS employe_nom, COALESCE(e.prenom, u.prenom) AS employe_prenom, e.matricule AS employe_matricule, e.id AS employe_id
       FROM rh_courrier c JOIN employe e ON e.id = c.employe_id LEFT JOIN utilisateur u ON u.id = e.utilisateur_id
       WHERE ${where} ORDER BY c.date_creation DESC LIMIT 500`,
      params
    );
    res.json(r.rows);
  } catch (err) { erreur(req, res, err); }
});

router.post("/courriers", async (req, res) => {
  try {
    const type = req.body.type;
    if (!C.TYPES[type]) return res.status(400).json({ error: t(req, "RH_COURRIER_TYPE_INVALIDE") });
    const emp = await chargerEmploye(req.user.tenantId, req.body.employe_id);
    if (!emp) return res.status(404).json({ error: t(req, "RH_COURRIER_EMPLOYE_INTROUVABLE") });
    const champs = champsValides(type, req.body.champs);
    const lignes = lignesValides(req.body.lignes);
    const d = dateOuNull(req.body.date_courrier);
    if (!champs || !lignes || d === undefined) return res.status(400).json({ error: t(req, "RH_COURRIER_CHAMP_INVALIDE") });
    const numero = await prochainNumero(req.user.tenantId, "COURRIER", "CR");
    const id = uuidv4();
    await db.query(
      `INSERT INTO rh_courrier (id, tenant_id, employe_id, numero, type, date_courrier, lieu, champs_json, lignes_json, notes, cree_par)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7, $8, $9, $10, $11)`,
      [id, req.user.tenantId, emp.id, numero, type, d, req.body.lieu ? String(req.body.lieu).trim().slice(0, 80) : "Dakar",
       JSON.stringify(champs), JSON.stringify(lignes), req.body.notes ? String(req.body.notes).slice(0, 2000) : null, req.user.sub]
    );
    const row = (await db.query(`SELECT * FROM rh_courrier WHERE id = $1`, [id])).rows[0];
    res.status(201).json(await composer(req.user.tenantId, row));
  } catch (err) { erreur(req, res, err); }
});

router.get("/courriers/:id", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    res.json(await composer(req.user.tenantId, row));
  } catch (err) { erreur(req, res, err); }
});

router.patch("/courriers/:id", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (row.statut !== "BROUILLON") return res.status(409).json({ error: t(req, "RH_COURRIER_FIGE") });
    const sets = {};
    if ("champs" in req.body) { const c = champsValides(row.type, req.body.champs); if (!c) return res.status(400).json({ error: t(req, "RH_COURRIER_CHAMP_INVALIDE") }); sets.champs_json = JSON.stringify(c); }
    if ("lignes" in req.body) { const l = lignesValides(req.body.lignes); if (!l) return res.status(400).json({ error: t(req, "RH_COURRIER_CHAMP_INVALIDE") }); sets.lignes_json = JSON.stringify(l); }
    if ("date_courrier" in req.body) { const d = dateOuNull(req.body.date_courrier); if (!d) return res.status(400).json({ error: t(req, "RH_COURRIER_CHAMP_INVALIDE") }); sets.date_courrier = d; }
    if ("lieu" in req.body) sets.lieu = req.body.lieu ? String(req.body.lieu).trim().slice(0, 80) : null;
    if ("notes" in req.body) sets.notes = req.body.notes ? String(req.body.notes).slice(0, 2000) : null;
    const cles = Object.keys(sets);
    if (cles.length) {
      await db.query(`UPDATE rh_courrier SET ${cles.map((c, i) => `${c} = $${i + 1}`).join(", ")}, date_modification = now() WHERE id = $${cles.length + 1}`, [...Object.values(sets), row.id]);
    }
    const maj = (await db.query(`SELECT * FROM rh_courrier WHERE id = $1`, [row.id])).rows[0];
    res.json(await composer(req.user.tenantId, maj));
  } catch (err) { erreur(req, res, err); }
});

router.delete("/courriers/:id", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (row.statut !== "BROUILLON") return res.status(409).json({ error: t(req, "RH_COURRIER_FIGE") });
    await db.query(`DELETE FROM rh_courrier WHERE id = $1`, [row.id]);
    res.json({ ok: true });
  } catch (err) { erreur(req, res, err); }
});

router.post("/courriers/:id/emettre", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (row.statut !== "BROUILLON") return res.status(409).json({ error: t(req, "RH_COURRIER_FIGE") });
    const vue = await composer(req.user.tenantId, row);
    if (vue.avertissements.some((a) => a.niveau === "BLOQUANT")) {
      return res.status(422).json({ error: t(req, "RH_COURRIER_BLOQUANT"), avertissements: vue.avertissements });
    }
    const contenu = { ...vue.contenu, numero: row.numero };
    const empreinte = crypto.createHash("sha256").update(JSON.stringify(contenu)).digest("hex");
    await db.query(
      `UPDATE rh_courrier SET statut = 'EMIS', contenu_json = $1, empreinte = $2, date_emission = now(), emis_par = $3, date_modification = now() WHERE id = $4`,
      [JSON.stringify(contenu), empreinte, req.user.sub, row.id]
    );
    const maj = (await db.query(`SELECT * FROM rh_courrier WHERE id = $1`, [row.id])).rows[0];
    res.json(await composer(req.user.tenantId, maj));
  } catch (err) { erreur(req, res, err); }
});

router.post("/courriers/:id/annuler", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    await db.query(`UPDATE rh_courrier SET statut = 'ANNULE', visible_employe = FALSE, date_modification = now() WHERE id = $1`, [row.id]);
    const maj = (await db.query(`SELECT * FROM rh_courrier WHERE id = $1`, [row.id])).rows[0];
    res.json(await composer(req.user.tenantId, maj));
  } catch (err) { erreur(req, res, err); }
});

// Publication dans l'espace du salarie (ou retrait de la publication).
router.post("/courriers/:id/publier", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (row.statut !== "EMIS") return res.status(409).json({ error: t(req, "RH_COURRIER_NON_EMIS") });
    const publier = req.body.publier !== false;
    if (publier) {
      const emp = await chargerEmploye(req.user.tenantId, row.employe_id);
      if (!emp.utilisateur_id) return res.status(409).json({ error: t(req, "RH_COURRIER_SANS_COMPTE") });
      await db.query(
        `UPDATE rh_courrier SET visible_employe = TRUE, date_publication = COALESCE(date_publication, now()),
                mode_remise = COALESCE(mode_remise, 'ESPACE_EMPLOYE'), date_remise = COALESCE(date_remise, CURRENT_DATE), date_modification = now() WHERE id = $1`,
        [row.id]
      );
      try {
        const email = await sig.adresseDestinataire(row.employe_id);
        if (email && process.env.RH_CODE_TEST_MODE !== "1") {
          await mailer.envoyerEmailSimple({
            destinataire: email,
            sujet: `Nouveau courrier ${row.numero}`,
            message: `Bonjour ${emp.prenom || ""},\n\nUn courrier (${row.numero}) vous a été adressé. Vous pouvez le consulter dans votre espace RH.`,
          });
        }
      } catch (e) { console.error("Notification courrier impossible :", e.message); }
    } else {
      await db.query(`UPDATE rh_courrier SET visible_employe = FALSE, date_modification = now() WHERE id = $1`, [row.id]);
    }
    const maj = (await db.query(`SELECT * FROM rh_courrier WHERE id = $1`, [row.id])).rows[0];
    res.json(await composer(req.user.tenantId, maj));
  } catch (err) { erreur(req, res, err); }
});

// Remise enregistree manuellement (main propre, e-mail, recommande...).
router.post("/courriers/:id/remise", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (row.statut !== "EMIS") return res.status(409).json({ error: t(req, "RH_COURRIER_NON_EMIS") });
    const modes = ["MAIN_PROPRE", "ESPACE_EMPLOYE", "EMAIL", "COURRIER_RECOMMANDE", "AUTRE"];
    const d = dateOuNull(req.body.date_remise);
    if (!modes.includes(req.body.mode_remise) || !d) return res.status(400).json({ error: t(req, "RH_COURRIER_CHAMP_INVALIDE") });
    await db.query(`UPDATE rh_courrier SET mode_remise = $1, date_remise = $2, date_modification = now() WHERE id = $3`, [req.body.mode_remise, d, row.id]);
    const maj = (await db.query(`SELECT * FROM rh_courrier WHERE id = $1`, [row.id])).rows[0];
    res.json(await composer(req.user.tenantId, maj));
  } catch (err) { erreur(req, res, err); }
});

router.get("/courriers/:id/pdf", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    const vue = await composer(req.user.tenantId, row);
    const entete = await chargerEntete(req.user.tenantId);
    const buf = await courrierRhPdf(row, vue.contenu, entete, { emis: row.statut === "EMIS" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${row.numero}.pdf"`);
    res.send(buf);
  } catch (err) { erreur(req, res, err); }
});

module.exports = router;
