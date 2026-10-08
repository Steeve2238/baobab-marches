const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const sig = require("../services/rhSignature");
const { contratTravailPdf, courrierRhPdf } = require("../services/rhDocumentsPdf");
const CR = require("../services/rhCourriers");
const { chargerEntete } = require("../services/rhCommun");

/**
 * RH lot 3 : "Mon espace RH". Chaque salarie n'accede qu'a SA fiche (liee a son compte) : signature enregistree,
 * contrats a signer / signes, documents. Aucun module n'est exige : un compte lie a une fiche suffit.
 */
const router = express.Router();
router.use(requireAuth);

const STATUTS_VISIBLES = ["ENVOYE_SALARIE", "SIGNE_SALARIE", "TRANSMIS_INSPECTION", "VISE"];

async function maFiche(req, res) {
  const r = await db.query(
    `SELECT e.id, e.tenant_id, e.matricule, COALESCE(e.nom, u.nom) AS nom, COALESCE(e.prenom, u.prenom) AS prenom,
            e.poste, e.email_personnel, u.email
     FROM employe e JOIN utilisateur u ON u.id = e.utilisateur_id
     WHERE e.tenant_id = $1 AND e.utilisateur_id = $2`,
    [req.user.tenantId, req.user.sub]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: t(req, "RH_ESPACE_SANS_FICHE") });
    return null;
  }
  return r.rows[0];
}

const erreurCode = (req, res, err) => {
  const map = { PAS_EMAIL: [400, "RH_ESPACE_PAS_EMAIL"], TROP_VITE: [429, "RH_ESPACE_CODE_TROP_VITE"], EMAIL_ECHEC: [503, "RH_ESPACE_EMAIL_ECHEC"] };
  const m = map[err.code];
  if (m) return res.status(m[0]).json({ error: t(req, m[1]) });
  console.error(err);
  return res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
};

function vueContrat(row) {
  const { signe_base64, signature_salarie_json, ...reste } = row;
  return {
    ...reste,
    a_fichier_signe: Boolean(signe_base64),
    signature_salarie: sig.signatureResume(signature_salarie_json),
    a_signer: row.statut === "ENVOYE_SALARIE",
  };
}

async function chargerMonContrat(req, res, fiche) {
  const r = await db.query(
    `SELECT * FROM rh_contrat WHERE id = $1 AND tenant_id = $2 AND employe_id = $3 AND statut = ANY($4)`,
    [req.params.id, req.user.tenantId, fiche.id, STATUTS_VISIBLES]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: t(req, "RH_CONTRAT_INTROUVABLE") });
    return null;
  }
  return r.rows[0];
}

// GET /api/rh/espace/moi
router.get("/moi", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const s = await db.query(`SELECT mode, date_enregistrement FROM rh_signature_employe WHERE employe_id = $1`, [f.id]);
    const c = await db.query(
      `SELECT COUNT(*) FILTER (WHERE statut = 'ENVOYE_SALARIE')::int AS a_signer, COUNT(*)::int AS total
       FROM rh_contrat WHERE employe_id = $1 AND statut = ANY($2)`,
      [f.id, STATUTS_VISIBLES]
    );
    const cr = await db.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE date_lecture IS NULL)::int AS non_lus
       FROM rh_courrier WHERE employe_id = $1 AND statut = 'EMIS' AND visible_employe`,
      [f.id]
    );
    const bp = await db.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ac.date_consultation IS NULL)::int AS non_consultes
       FROM paie_archive_fichier a JOIN paie_periode p ON p.id = a.periode_id AND p.statut = 'CLOTUREE'
       LEFT JOIN paie_bulletin_accuse ac ON ac.periode_id = p.id AND ac.employe_id = a.employe_id
       WHERE a.employe_id = $1 AND a.type = 'BULLETIN'`,
      [f.id]
    ).catch(() => ({ rows: [{ total: 0, non_consultes: 0 }] }));
    res.json({
      bulletins: bp.rows[0],
      courriers: cr.rows[0],
      employe: { id: f.id, matricule: f.matricule, nom: f.nom, prenom: f.prenom, poste: f.poste },
      email_confirmation: sig.masquerEmail(f.email_personnel || f.email),
      signature: s.rows[0] ? { enregistree: true, mode: s.rows[0].mode, date_enregistrement: s.rows[0].date_enregistrement } : { enregistree: false },
      contrats: c.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

// GET /api/rh/espace/signature - image de ma signature (apercu)
router.get("/signature", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const s = await db.query(`SELECT image_base64, type_mime, mode, date_enregistrement FROM rh_signature_employe WHERE employe_id = $1`, [f.id]);
    if (!s.rows[0]) return res.json({ enregistree: false });
    res.json({ enregistree: true, ...s.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

// POST /api/rh/espace/signature/code - demande d'un code pour (re)enregistrer la signature
router.post("/signature/code", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const r = await sig.envoyerCode({
      tenantId: req.user.tenantId, employeId: f.id, objet: "SIGNATURE", referenceId: null,
      libelle: "Ce code confirme l'enregistrement de votre signature electronique dans votre espace RH.",
    });
    res.json(r);
  } catch (err) {
    erreurCode(req, res, err);
  }
});

// PUT /api/rh/espace/signature { image, mode, code }
router.put("/signature", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const img = sig.imageValide(req.body.image);
    if (!img) return res.status(400).json({ error: t(req, "RH_ESPACE_SIGNATURE_INVALIDE") });
    const v = await sig.verifierCode({ employeId: f.id, objet: "SIGNATURE", referenceId: null, code: req.body.code });
    if (!v.ok) {
      return res.status(400).json({ error: t(req, v.raison === "TROP_ESSAIS" ? "RH_ESPACE_CODE_TROP_ESSAIS" : "RH_ESPACE_CODE_INVALIDE") });
    }
    const mode = req.body.mode === "IMPORTEE" ? "IMPORTEE" : "DESSINEE";
    await db.query(
      `INSERT INTO rh_signature_employe (employe_id, tenant_id, image_base64, type_mime, mode, empreinte, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (employe_id) DO UPDATE SET image_base64 = EXCLUDED.image_base64, type_mime = EXCLUDED.type_mime, mode = EXCLUDED.mode,
         empreinte = EXCLUDED.empreinte, ip = EXCLUDED.ip, user_agent = EXCLUDED.user_agent, date_enregistrement = now()`,
      [f.id, req.user.tenantId, img.base64, img.mime, mode, sig.hash(img.base64), sig.ipDe(req), String(req.headers["user-agent"] || "").slice(0, 300)]
    );
    res.json({ enregistree: true, mode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

// GET /api/rh/espace/contrats
router.get("/contrats", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const r = await db.query(
      `SELECT * FROM rh_contrat WHERE employe_id = $1 AND tenant_id = $2 AND statut = ANY($3) ORDER BY date_creation DESC`,
      [f.id, req.user.tenantId, STATUTS_VISIBLES]
    );
    res.json(r.rows.map((x) => { const v = vueContrat(x); delete v.contenu_json; return v; }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

router.get("/contrats/:id", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const row = await chargerMonContrat(req, res, f);
    if (!row) return;
    const ev = await db.query(
      `SELECT evenement, statut_apres, date_evenement FROM rh_contrat_evenement WHERE contrat_id = $1 ORDER BY date_evenement`,
      [row.id]
    );
    res.json({ ...vueContrat(row), contenu: row.contenu_json, evenements: ev.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

router.get("/contrats/:id/pdf", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const row = await chargerMonContrat(req, res, f);
    if (!row) return;
    const e = await db.query(
      `SELECT raison_sociale, adresse, telephone, email, signataire_nom, signataire_titre, rccm, ninea, site_web,
              coordonnees_bancaires, logo_base64, logo_type_mime, signature_cachet_base64, signature_cachet_type_mime
       FROM tenant WHERE id = $1`,
      [req.user.tenantId]
    );
    const buf = await contratTravailPdf(row, row.contenu_json, e.rows[0] || {}, { signeEmployeur: true, signatureSalarie: sig.signaturePdf(row) });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${row.numero}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

// Exemplaire vise / scanne
router.get("/contrats/:id/scan", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const row = await chargerMonContrat(req, res, f);
    if (!row) return;
    if (!row.signe_base64) return res.status(404).json({ error: t(req, "RH_CONTRAT_SCAN_ABSENT") });
    res.setHeader("Content-Type", row.signe_type_mime || "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${(row.signe_nom_fichier || row.numero).replace(/[^\w.\- ]/g, "_")}"`);
    res.send(Buffer.from(row.signe_base64, "base64"));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

// Demande de code pour signer un contrat
router.post("/contrats/:id/code", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const row = await chargerMonContrat(req, res, f);
    if (!row) return;
    if (row.statut !== "ENVOYE_SALARIE") return res.status(409).json({ error: t(req, "RH_ESPACE_NON_SIGNABLE") });
    const s = await db.query(`SELECT 1 FROM rh_signature_employe WHERE employe_id = $1`, [f.id]);
    if (!s.rows[0]) return res.status(409).json({ error: t(req, "RH_ESPACE_SIGNATURE_ABSENTE") });
    const r = await sig.envoyerCode({
      tenantId: req.user.tenantId, employeId: f.id, objet: "CONTRAT", referenceId: row.id,
      libelle: `Ce code confirme votre signature electronique du contrat ${row.numero}.`,
    });
    res.json(r);
  } catch (err) {
    erreurCode(req, res, err);
  }
});

// Signature du contrat { code, accepte }
router.post("/contrats/:id/signer", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const row = await chargerMonContrat(req, res, f);
    if (!row) return;
    if (row.statut !== "ENVOYE_SALARIE") return res.status(409).json({ error: t(req, "RH_ESPACE_NON_SIGNABLE") });
    if (req.body.accepte !== true) return res.status(400).json({ error: t(req, "RH_ESPACE_ACCEPTATION") });
    const s = await db.query(`SELECT * FROM rh_signature_employe WHERE employe_id = $1`, [f.id]);
    if (!s.rows[0]) return res.status(409).json({ error: t(req, "RH_ESPACE_SIGNATURE_ABSENTE") });
    const v = await sig.verifierCode({ employeId: f.id, objet: "CONTRAT", referenceId: row.id, code: req.body.code });
    if (!v.ok) {
      return res.status(400).json({ error: t(req, v.raison === "TROP_ESSAIS" ? "RH_ESPACE_CODE_TROP_ESSAIS" : "RH_ESPACE_CODE_INVALIDE") });
    }
    const ip = sig.ipDe(req);
    const trace = {
      date: new Date().toISOString(),
      ip,
      user_agent: String(req.headers["user-agent"] || "").slice(0, 300),
      methode: "SIGNATURE_ENREGISTREE_CODE_EMAIL",
      code_envoye_a: v.envoye_a,
      empreinte_contrat: row.empreinte,
      empreinte_signature: s.rows[0].empreinte,
      signataire: `${f.prenom} ${f.nom}`.trim(),
      matricule: f.matricule,
      image_base64: s.rows[0].image_base64,
      type_mime: s.rows[0].type_mime,
    };
    const maj = await db.query(
      `UPDATE rh_contrat SET statut = 'SIGNE_SALARIE', date_signature_salarie = now(), signature_salarie_json = $1, date_modification = now()
       WHERE id = $2 AND statut = 'ENVOYE_SALARIE' RETURNING *`,
      [JSON.stringify(trace), row.id]
    );
    if (maj.rows.length === 0) return res.status(409).json({ error: t(req, "RH_ESPACE_NON_SIGNABLE") });
    await sig.journaliser(req.user.tenantId, row.id, "SIGNE_SALARIE", "SIGNE_SALARIE", req.user.sub, ip, {
      empreinte_contrat: row.empreinte, code_envoye_a: v.envoye_a,
    });
    res.json(vueContrat(maj.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

// ------------------------------------------------------------------------------------------- courriers
const COURRIER_VISIBLE = "id = $1 AND tenant_id = $2 AND employe_id = $3 AND statut = 'EMIS' AND visible_employe";

function vueCourrier(row, avecContenu) {
  const def = CR.TYPES[row.type] || {};
  const { contenu_json, champs_json, lignes_json, notes, ...reste } = row;
  const base = {
    id: reste.id, numero: reste.numero, type: reste.type, date_courrier: reste.date_courrier, date_publication: reste.date_publication,
    date_lecture: reste.date_lecture, date_accuse: reste.date_accuse, reponse_texte: reste.reponse_texte, date_reponse: reste.date_reponse,
    objet: contenu_json ? contenu_json.objet : null,
    accuse_requis: Boolean(def.accuse), reponse_prevue: Boolean(def.reponse),
    date_limite: def.reponse && champs_json ? champs_json.date_limite || null : null,
  };
  return avecContenu ? { ...base, contenu: contenu_json } : base;
}

async function monCourrier(req, res, f) {
  const r = await db.query(`SELECT * FROM rh_courrier WHERE ${COURRIER_VISIBLE}`, [req.params.id, req.user.tenantId, f.id]);
  if (r.rows.length === 0) {
    res.status(404).json({ error: t(req, "RH_COURRIER_INTROUVABLE") });
    return null;
  }
  return r.rows[0];
}

router.get("/courriers", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const r = await db.query(
      `SELECT * FROM rh_courrier WHERE tenant_id = $1 AND employe_id = $2 AND statut = 'EMIS' AND visible_employe ORDER BY date_courrier DESC, date_creation DESC`,
      [req.user.tenantId, f.id]
    );
    res.json(r.rows.map((x) => vueCourrier(x, false)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_COURRIER_ERREUR") });
  }
});

router.get("/courriers/:id", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const row = await monCourrier(req, res, f);
    if (!row) return;
    if (!row.date_lecture) {
      await db.query(`UPDATE rh_courrier SET date_lecture = now() WHERE id = $1`, [row.id]);
      row.date_lecture = new Date();
    }
    res.json(vueCourrier(row, true));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_COURRIER_ERREUR") });
  }
});

router.get("/courriers/:id/pdf", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const row = await monCourrier(req, res, f);
    if (!row) return;
    const buf = await courrierRhPdf(row, row.contenu_json, await chargerEntete(req.user.tenantId), { emis: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${row.numero}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_COURRIER_ERREUR") });
  }
});

// Accuse de reception electronique (date/heure et adresse IP conservees).
router.post("/courriers/:id/accuse", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const row = await monCourrier(req, res, f);
    if (!row) return;
    if (!row.date_accuse) {
      await db.query(`UPDATE rh_courrier SET date_accuse = now(), ip_accuse = $1, date_lecture = COALESCE(date_lecture, now()) WHERE id = $2`, [sig.ipDe(req), row.id]);
      const maj = (await db.query(`SELECT * FROM rh_courrier WHERE id = $1`, [row.id])).rows[0];
      return res.json(vueCourrier(maj, true));
    }
    res.json(vueCourrier(row, true));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_COURRIER_ERREUR") });
  }
});

// Reponse du salarie a une demande d'explication (une seule fois).
router.post("/courriers/:id/reponse", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const row = await monCourrier(req, res, f);
    if (!row) return;
    if (!(CR.TYPES[row.type] && CR.TYPES[row.type].reponse)) return res.status(409).json({ error: t(req, "RH_COURRIER_REPONSE_NON_PREVUE") });
    if (row.reponse_texte) return res.status(409).json({ error: t(req, "RH_COURRIER_REPONSE_DEJA") });
    const texte = String(req.body.texte || "").trim().slice(0, 8000);
    if (!texte) return res.status(400).json({ error: t(req, "RH_COURRIER_REPONSE_VIDE") });
    await db.query(
      `UPDATE rh_courrier SET reponse_texte = $1, date_reponse = now(), date_accuse = COALESCE(date_accuse, now()), ip_accuse = COALESCE(ip_accuse, $2) WHERE id = $3`,
      [texte, sig.ipDe(req), row.id]
    );
    const maj = (await db.query(`SELECT * FROM rh_courrier WHERE id = $1`, [row.id])).rows[0];
    res.json(vueCourrier(maj, true));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_COURRIER_ERREUR") });
  }
});

// ---- Bulletins de paie (PAIE-3B) : seuls les mois clotures (archive verrouillee) sont visibles ; accuse de reception electronique.
async function monBulletin(req, res, fiche) {
  const r = await db.query(
    `SELECT a.id AS fichier_id, a.nom_fichier, a.mime, a.contenu, p.id AS periode_id, p.annee, p.mois
     FROM paie_archive_fichier a JOIN paie_periode p ON p.id = a.periode_id
     WHERE a.tenant_id = $1 AND a.employe_id = $2 AND a.type = 'BULLETIN' AND p.id = $3 AND p.statut = 'CLOTUREE'`,
    [req.user.tenantId, fiche.id, req.params.periodeId]
  );
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params.periodeId)) || r.rows.length === 0) {
    res.status(404).json({ error: t(req, "PAIE_BULLETIN_INTROUVABLE") });
    return null;
  }
  return r.rows[0];
}

router.get("/bulletins", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const r = await db.query(
      `SELECT p.id AS periode_id, p.annee, p.mois, p.date_cloture, b.net_a_payer, b.brut, ac.date_consultation, ac.date_accuse
       FROM paie_archive_fichier a
       JOIN paie_periode p ON p.id = a.periode_id AND p.statut = 'CLOTUREE'
       LEFT JOIN paie_bulletin b ON b.periode_id = p.id AND b.employe_id = a.employe_id
       LEFT JOIN paie_bulletin_accuse ac ON ac.periode_id = p.id AND ac.employe_id = a.employe_id
       WHERE a.tenant_id = $1 AND a.employe_id = $2 AND a.type = 'BULLETIN'
       ORDER BY p.annee DESC, p.mois DESC`,
      [req.user.tenantId, f.id]
    );
    res.json(r.rows.map((x) => ({ ...x, net_a_payer: Number(x.net_a_payer), brut: Number(x.brut) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PAIE_SERVER_ERROR") });
  }
});

router.get("/bulletins/:periodeId/pdf", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const row = await monBulletin(req, res, f);
    if (!row) return;
    await db.query(
      `INSERT INTO paie_bulletin_accuse (id, tenant_id, periode_id, employe_id, date_consultation) VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (periode_id, employe_id) DO UPDATE SET date_consultation = COALESCE(paie_bulletin_accuse.date_consultation, now())`,
      [require("uuid").v4(), req.user.tenantId, row.periode_id, f.id]
    );
    res.setHeader("Content-Type", row.mime);
    res.setHeader("Content-Disposition", `${req.query.telecharger === "1" ? "attachment" : "inline"}; filename="${row.nom_fichier}"`);
    res.send(row.contenu);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PAIE_SERVER_ERROR") });
  }
});

router.post("/bulletins/:periodeId/accuse", async (req, res) => {
  try {
    const f = await maFiche(req, res);
    if (!f) return;
    const row = await monBulletin(req, res, f);
    if (!row) return;
    await db.query(
      `INSERT INTO paie_bulletin_accuse (id, tenant_id, periode_id, employe_id, date_consultation, date_accuse, ip_accuse) VALUES ($1,$2,$3,$4, now(), now(), $5)
       ON CONFLICT (periode_id, employe_id) DO UPDATE SET date_consultation = COALESCE(paie_bulletin_accuse.date_consultation, now()),
         date_accuse = COALESCE(paie_bulletin_accuse.date_accuse, now()), ip_accuse = COALESCE(paie_bulletin_accuse.ip_accuse, $5)`,
      [require("uuid").v4(), req.user.tenantId, row.periode_id, f.id, sig.ipDe(req)]
    );
    const a = (await db.query(`SELECT date_consultation, date_accuse FROM paie_bulletin_accuse WHERE periode_id = $1 AND employe_id = $2`, [row.periode_id, f.id])).rows[0];
    res.json(a);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PAIE_SERVER_ERROR") });
  }
});

module.exports = router;
