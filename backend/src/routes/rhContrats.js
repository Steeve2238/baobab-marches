const express = require("express");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { requireAuth, requireModule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const rhFiche = require("../services/rhFiche");
const modeles = require("../services/rhContratModeles");
const dmtSvc = require("../services/rhDmt");
const { contratTravailPdf, dmtPdf } = require("../services/rhDocumentsPdf");
const sig = require("../services/rhSignature");
const mailer = require("../utils/mailer");

/**
 * RH lot 2 : modeles de contrats, contrats de travail (redaction, validation, PDF) et DMT.
 * Acces : module "rh" (ADMIN compris). Le salarie accede a ses propres documents via l'espace employe (lot RH-3).
 */
const router = express.Router();
router.use(requireAuth);
router.use(requireModule("rh"));

const TYPES_CONTRAT = ["CDI", "CDD", "JOURNALIER"];
const dateOuNull = (v) => {
  if (v == null || v === "") return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined;
};

async function chargerEntete(tenantId) {
  const r = await db.query(
    `SELECT raison_sociale, adresse, telephone, email, signataire_nom, signataire_titre, rccm, ninea, site_web,
            coordonnees_bancaires, logo_base64, logo_type_mime, signature_cachet_base64, signature_cachet_type_mime
     FROM tenant WHERE id = $1`,
    [tenantId]
  );
  return r.rows[0] || {};
}

async function chargerEmploye(tenantId, id) {
  const r = await db.query(
    `SELECT e.*, COALESCE(e.nom, u.nom) AS nom, COALESCE(e.prenom, u.prenom) AS prenom
     FROM employe e LEFT JOIN utilisateur u ON u.id = e.utilisateur_id
     WHERE e.tenant_id = $1 AND e.id = $2`,
    [tenantId, id]
  );
  if (r.rows.length === 0) return null;
  const enf = await db.query(
    `SELECT id, nom, prenom, sexe, date_naissance, etudiant, infirme, revenus_propres, adopte
     FROM employe_enfant WHERE tenant_id = $1 AND employe_id = $2`,
    [tenantId, id]
  );
  return { emp: r.rows[0], enfants: enf.rows };
}

async function prochainNumero(tenantId, type, prefixe) {
  const annee = new Date().getFullYear();
  const r = await db.query(
    `INSERT INTO rh_numerotation (tenant_id, type, annee, dernier) VALUES ($1, $2, $3, 1)
     ON CONFLICT (tenant_id, type, annee) DO UPDATE SET dernier = rh_numerotation.dernier + 1
     RETURNING dernier`,
    [tenantId, type, annee]
  );
  return `${prefixe}-${annee}-${String(r.rows[0].dernier).padStart(4, "0")}`;
}

async function articlesModele(tenantId, type) {
  const r = await db.query(`SELECT articles_json FROM rh_modele_contrat WHERE tenant_id = $1 AND type = $2`, [tenantId, type]);
  return r.rows.length ? { articles: r.rows[0].articles_json, personnalise: true } : { articles: modeles.MODELES_DEFAUT[type], personnalise: false };
}

// ------------------------------------------------------------------------------------------- modeles
function articlesValides(articles) {
  if (!Array.isArray(articles) || articles.length === 0 || articles.length > 40) return null;
  const out = [];
  for (const a of articles) {
    const titre = a && a.titre ? String(a.titre).trim() : "";
    if (!titre) return null;
    const paragraphes = (Array.isArray(a.paragraphes) ? a.paragraphes : [])
      .map((p) => String(p).trim())
      .filter(Boolean);
    const art = { titre, paragraphes };
    if (a.remuneration) art.remuneration = true;
    if (a.si === "ESSAI") art.si = "ESSAI";
    out.push(art);
  }
  if (!out.some((a) => a.remuneration)) return null;
  return out;
}

router.get("/modeles-contrats", async (req, res) => {
  try {
    const result = [];
    for (const type of TYPES_CONTRAT) {
      const m = await articlesModele(req.user.tenantId, type);
      result.push({ type, personnalise: m.personnalise, articles: m.articles });
    }
    res.json({ modeles: result, variables: modeles.VARIABLES });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

router.put("/modeles-contrats/:type", async (req, res) => {
  const { type } = req.params;
  if (!TYPES_CONTRAT.includes(type)) return res.status(400).json({ error: t(req, "RH_CONTRAT_TYPE_INVALIDE") });
  const articles = articlesValides(req.body.articles);
  if (!articles) return res.status(400).json({ error: t(req, "RH_MODELE_INVALIDE") });
  try {
    await db.query(
      `INSERT INTO rh_modele_contrat (id, tenant_id, type, articles_json, modifie_par) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, type) DO UPDATE SET articles_json = EXCLUDED.articles_json, date_modification = now(), modifie_par = EXCLUDED.modifie_par`,
      [uuidv4(), req.user.tenantId, type, JSON.stringify(articles), req.user.sub]
    );
    res.json({ type, personnalise: true, articles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

router.delete("/modeles-contrats/:type", async (req, res) => {
  const { type } = req.params;
  if (!TYPES_CONTRAT.includes(type)) return res.status(400).json({ error: t(req, "RH_CONTRAT_TYPE_INVALIDE") });
  try {
    await db.query(`DELETE FROM rh_modele_contrat WHERE tenant_id = $1 AND type = $2`, [req.user.tenantId, type]);
    res.json({ type, personnalise: false, articles: modeles.MODELES_DEFAUT[type] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

// ------------------------------------------------------------------------------------------- contrats
function normaliserElements(liste) {
  const out = [];
  for (const l of Array.isArray(liste) ? liste : []) {
    const libelle = l && l.libelle ? String(l.libelle).trim() : "";
    if (!libelle) continue;
    const montant = Number(l.montant);
    if (!Number.isFinite(montant) || montant < 0) return null;
    out.push({ libelle, montant: Math.round(montant), essai: l.essai !== false });
  }
  return out;
}

function champsContrat(body) {
  const erreurs = [];
  const v = {};
  if ("type" in body) {
    if (!TYPES_CONTRAT.includes(body.type)) erreurs.push("type");
    else v.type = body.type;
  }
  for (const k of ["date_contrat", "date_effet", "date_fin"]) {
    if (k in body) {
      const d = dateOuNull(body[k]);
      if (d === undefined) erreurs.push(k);
      else v[k] = d;
    }
  }
  for (const k of ["lieu_signature", "poste", "lieu_emploi", "convention", "categorie", "motif", "notes"]) {
    if (k in body) v[k] = body[k] == null || String(body[k]).trim() === "" ? null : String(body[k]).trim();
  }
  if ("periode_essai_mois" in body) {
    const n = body.periode_essai_mois === "" || body.periode_essai_mois == null ? null : Number(body.periode_essai_mois);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 36)) erreurs.push("periode_essai_mois");
    else v.periode_essai_mois = n;
  }
  if ("heures_hebdo" in body) {
    const n = Number(body.heures_hebdo);
    if (!Number.isFinite(n) || n <= 0 || n > 84) erreurs.push("heures_hebdo");
    else v.heures_hebdo = n;
  }
  if ("elements" in body) {
    const e = normaliserElements(body.elements);
    if (e === null) erreurs.push("elements");
    else v.elements_json = JSON.stringify(e);
  }
  return { v, erreurs };
}

function contratPourRedaction(row) {
  return {
    type: row.type,
    numero: row.numero,
    date_contrat: row.date_contrat,
    lieu_signature: row.lieu_signature,
    date_effet: row.date_effet ? String(row.date_effet).slice(0, 10) : null,
    date_fin: row.date_fin ? String(row.date_fin).slice(0, 10) : null,
    periode_essai_mois: row.periode_essai_mois,
    heures_hebdo: row.heures_hebdo,
    poste: row.poste,
    lieu_emploi: row.lieu_emploi,
    convention: row.convention,
    categorie: row.categorie,
    motif: row.motif,
    elements: row.elements_json || [],
  };
}

async function composerContrat(tenantId, row) {
  const e = await chargerEmploye(tenantId, row.employe_id);
  const entete = await chargerEntete(tenantId);
  const champs = contratPourRedaction(row);
  let contenu = row.contenu_json;
  let avert = [];
  if (!contenu) {
    const m = await articlesModele(tenantId, row.type);
    const ctx = modeles.construireContexte(entete, e.emp, e.enfants, champs, rhFiche.enfantACharge);
    contenu = modeles.rediger(row.type, m.articles, entete, ctx, champs);
    avert = modeles.avertissements(entete, e.emp, champs, ctx);
  }
  const { signe_base64, signature_salarie_json, ...reste } = row;
  return {
    ...reste,
    a_fichier_signe: Boolean(signe_base64),
    signature_salarie: sig.signatureResume(signature_salarie_json),
    employe: { id: e.emp.id, nom: e.emp.nom, prenom: e.emp.prenom, matricule: e.emp.matricule, a_compte: Boolean(e.emp.utilisateur_id) },
    contenu,
    fige: Boolean(row.contenu_json),
    avertissements: avert,
  };
}

// Valeurs par defaut pour un nouveau contrat, a partir de la fiche employe.
router.get("/contrats/prefill", async (req, res) => {
  try {
    const type = TYPES_CONTRAT.includes(req.query.type) ? req.query.type : "CDI";
    const e = await chargerEmploye(req.user.tenantId, req.query.employe_id);
    if (!e) return res.status(404).json({ error: t(req, "RH_FICHE_NOT_FOUND") });
    const emp = e.emp;
    res.json({
      employe_id: emp.id,
      type,
      date_effet: emp.date_embauche ? String(emp.date_embauche).slice(0, 10) : "",
      date_fin: emp.date_fin_contrat ? String(emp.date_fin_contrat).slice(0, 10) : "",
      periode_essai_mois: emp.periode_essai_mois != null ? emp.periode_essai_mois : "",
      heures_hebdo: Number(emp.heures_hebdo) || 40,
      poste: emp.poste || "",
      lieu_emploi: emp.lieu_travail || "",
      convention: emp.convention_collective || "",
      categorie: emp.categorie || "",
      motif: "",
      lieu_signature: "Dakar",
      date_contrat: new Date().toISOString().slice(0, 10),
      elements: [{ libelle: "Salaire de base", montant: 0, essai: true }],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

router.get("/contrats", async (req, res) => {
  try {
    const params = [req.user.tenantId];
    let filtre = "";
    if (req.query.employe_id) {
      params.push(req.query.employe_id);
      filtre += ` AND c.employe_id = $${params.length}`;
    }
    if (req.query.statut) {
      params.push(req.query.statut);
      filtre += ` AND c.statut = $${params.length}`;
    }
    const r = await db.query(
      `SELECT c.id, c.numero, c.type, c.statut, c.date_contrat, c.date_effet, c.date_fin, c.poste, c.employe_id,
              COALESCE(e.prenom, u.prenom) AS employe_prenom, COALESCE(e.nom, u.nom) AS employe_nom, e.matricule
       FROM rh_contrat c
       JOIN employe e ON e.id = c.employe_id
       LEFT JOIN utilisateur u ON u.id = e.utilisateur_id
       WHERE c.tenant_id = $1 ${filtre}
       ORDER BY c.date_creation DESC`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

router.post("/contrats", async (req, res) => {
  try {
    const e = await chargerEmploye(req.user.tenantId, req.body.employe_id);
    if (!e) return res.status(404).json({ error: t(req, "RH_FICHE_NOT_FOUND") });
    const { v, erreurs } = champsContrat(req.body);
    if (erreurs.length) return res.status(400).json({ error: t(req, "RH_CONTRAT_CHAMP_INVALIDE"), champs: erreurs });
    if (!v.type || !v.date_effet) return res.status(400).json({ error: t(req, "RH_CONTRAT_CHAMPS_REQUIS") });
    const numero = await prochainNumero(req.user.tenantId, "CONTRAT", "CT");
    const id = uuidv4();
    const cols = { id, tenant_id: req.user.tenantId, employe_id: e.emp.id, numero, cree_par: req.user.sub, ...v };
    if (!("elements_json" in cols)) cols.elements_json = "[]";
    const noms = Object.keys(cols);
    await db.query(
      `INSERT INTO rh_contrat (${noms.join(", ")}) VALUES (${noms.map((_, i) => `$${i + 1}`).join(", ")})`,
      Object.values(cols)
    );
    const row = (await db.query(`SELECT * FROM rh_contrat WHERE id = $1`, [id])).rows[0];
    res.status(201).json(await composerContrat(req.user.tenantId, row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

async function chargerContrat(req, res) {
  const r = await db.query(`SELECT * FROM rh_contrat WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.user.tenantId]);
  if (r.rows.length === 0) {
    res.status(404).json({ error: t(req, "RH_CONTRAT_INTROUVABLE") });
    return null;
  }
  return r.rows[0];
}

router.get("/contrats/:id", async (req, res) => {
  try {
    const row = await chargerContrat(req, res);
    if (!row) return;
    const vue = await composerContrat(req.user.tenantId, row);
    const ev = await db.query(
      `SELECT ev.evenement, ev.statut_apres, ev.ip, ev.details, ev.date_evenement, u.prenom, u.nom
       FROM rh_contrat_evenement ev LEFT JOIN utilisateur u ON u.id = ev.utilisateur_id
       WHERE ev.contrat_id = $1 ORDER BY ev.date_evenement`,
      [row.id]
    );
    res.json({ ...vue, evenements: ev.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

router.patch("/contrats/:id", async (req, res) => {
  try {
    const row = await chargerContrat(req, res);
    if (!row) return;
    if (row.statut !== "BROUILLON") return res.status(409).json({ error: t(req, "RH_CONTRAT_FIGE") });
    const { v, erreurs } = champsContrat(req.body);
    if (erreurs.length) return res.status(400).json({ error: t(req, "RH_CONTRAT_CHAMP_INVALIDE"), champs: erreurs });
    const cles = Object.keys(v);
    if (cles.length) {
      await db.query(
        `UPDATE rh_contrat SET ${cles.map((c, i) => `${c} = $${i + 1}`).join(", ")}, date_modification = now() WHERE id = $${cles.length + 1}`,
        [...Object.values(v), row.id]
      );
    }
    const maj = (await db.query(`SELECT * FROM rh_contrat WHERE id = $1`, [row.id])).rows[0];
    res.json(await composerContrat(req.user.tenantId, maj));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

router.delete("/contrats/:id", async (req, res) => {
  try {
    const row = await chargerContrat(req, res);
    if (!row) return;
    if (row.statut !== "BROUILLON") return res.status(409).json({ error: t(req, "RH_CONTRAT_FIGE") });
    await db.query(`DELETE FROM rh_contrat WHERE id = $1`, [row.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

// Validation : fige le texte, appose la signature de l'employeur et passe le contrat a SIGNE_EMPLOYEUR.
router.post("/contrats/:id/valider", async (req, res) => {
  try {
    const row = await chargerContrat(req, res);
    if (!row) return;
    if (row.statut !== "BROUILLON") return res.status(409).json({ error: t(req, "RH_CONTRAT_FIGE") });
    const vue = await composerContrat(req.user.tenantId, row);
    if (vue.avertissements.some((a) => a.niveau === "BLOQUANT")) {
      return res.status(422).json({ error: t(req, "RH_CONTRAT_BLOQUANT"), avertissements: vue.avertissements });
    }
    const contenu = { ...vue.contenu, numero: row.numero, date_contrat: row.date_contrat };
    const empreinte = crypto.createHash("sha256").update(JSON.stringify(contenu)).digest("hex");
    await db.query(
      `UPDATE rh_contrat SET statut = 'SIGNE_EMPLOYEUR', contenu_json = $1, empreinte = $2,
              date_signature_employeur = now(), signe_employeur_par = $3, date_modification = now() WHERE id = $4`,
      [JSON.stringify(contenu), empreinte, req.user.sub, row.id]
    );
    await sig.journaliser(req.user.tenantId, row.id, "SIGNE_EMPLOYEUR", "SIGNE_EMPLOYEUR", req.user.sub, sig.ipDe(req), { empreinte });
    const maj = (await db.query(`SELECT * FROM rh_contrat WHERE id = $1`, [row.id])).rows[0];
    res.json(await composerContrat(req.user.tenantId, maj));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

// ---- Circuit : envoi au salarie, transmission a l'Inspection du travail, visa --------------------------------
async function changerEtape(req, res, { depuis, vers, evenement, champs, details, apres }) {
  const row = await chargerContrat(req, res);
  if (!row) return null;
  if (!depuis.includes(row.statut)) {
    res.status(409).json({ error: t(req, "RH_CONTRAT_ETAPE_INVALIDE") });
    return null;
  }
  const cles = Object.keys(champs || {});
  const sets = ["statut = $1", "date_modification = now()", ...cles.map((c, i) => `${c} = $${i + 2}`)];
  const r = await db.query(
    `UPDATE rh_contrat SET ${sets.join(", ")} WHERE id = $${cles.length + 2} AND statut = ANY($${cles.length + 3}) RETURNING *`,
    [vers, ...cles.map((c) => champs[c]), row.id, depuis]
  );
  if (r.rows.length === 0) {
    res.status(409).json({ error: t(req, "RH_CONTRAT_ETAPE_INVALIDE") });
    return null;
  }
  await sig.journaliser(req.user.tenantId, row.id, evenement, vers, req.user.sub, sig.ipDe(req), details);
  if (apres) await apres(row);
  return r.rows[0];
}

router.post("/contrats/:id/envoyer", async (req, res) => {
  try {
    const row0 = await chargerContrat(req, res);
    if (!row0) return;
    const e = await chargerEmploye(req.user.tenantId, row0.employe_id);
    if (!e.emp.utilisateur_id) return res.status(409).json({ error: t(req, "RH_CONTRAT_SANS_COMPTE") });
    const maj = await changerEtape(req, res, {
      depuis: ["SIGNE_EMPLOYEUR"], vers: "ENVOYE_SALARIE", evenement: "ENVOYE_SALARIE",
      champs: { date_envoi_salarie: new Date() },
      apres: async (row) => {
        // Notification au salarie : echec silencieux (le contrat reste visible dans son espace).
        try {
          const email = await sig.adresseDestinataire(row.employe_id);
          if (email && process.env.RH_CODE_TEST_MODE !== "1") {
            await mailer.envoyerEmailSimple({
              destinataire: email,
              sujet: `Contrat de travail ${row.numero} a signer`,
              message: `Bonjour ${e.emp.prenom || ""},\n\nVotre contrat de travail ${row.numero} est disponible dans votre espace RH. Connectez-vous pour le lire et le signer.`,
            });
          }
        } catch (err) {
          console.error("Notification contrat impossible :", err.message);
        }
      },
    });
    if (maj) res.json(await composerContrat(req.user.tenantId, maj));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

router.post("/contrats/:id/transmettre-inspection", async (req, res) => {
  try {
    const d = dateOuNull(req.body.date);
    if (d === undefined) return res.status(400).json({ error: t(req, "RH_CONTRAT_CHAMP_INVALIDE") });
    const maj = await changerEtape(req, res, {
      depuis: ["SIGNE_SALARIE"], vers: "TRANSMIS_INSPECTION", evenement: "TRANSMIS_INSPECTION",
      champs: { date_transmission_inspection: d || new Date().toISOString().slice(0, 10) },
    });
    if (maj) res.json(await composerContrat(req.user.tenantId, maj));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
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
  return { base64: buf.toString("base64"), mime, nom: String(f.nom || `contrat-vise.${pdf ? "pdf" : png ? "png" : "jpg"}`).slice(0, 120) };
}

router.post("/contrats/:id/viser", async (req, res) => {
  try {
    const numero = req.body.numero_visa ? String(req.body.numero_visa).trim() : "";
    const d = dateOuNull(req.body.date_visa);
    if (!numero || !d) return res.status(400).json({ error: t(req, "RH_CONTRAT_VISA_REQUIS") });
    const champs = { numero_visa: numero, date_visa: d, commentaire_inspection: req.body.commentaire ? String(req.body.commentaire).slice(0, 1000) : null };
    if (req.body.fichier) {
      const f = fichierValide(req.body.fichier);
      if (!f) return res.status(400).json({ error: t(req, "RH_CONTRAT_FICHIER_INVALIDE") });
      champs.signe_base64 = f.base64; champs.signe_type_mime = f.mime; champs.signe_nom_fichier = f.nom;
    }
    const maj = await changerEtape(req, res, {
      depuis: ["TRANSMIS_INSPECTION"], vers: "VISE", evenement: "VISE", champs, details: { numero_visa: numero, date_visa: d },
    });
    if (maj) res.json(await composerContrat(req.user.tenantId, maj));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

// Exemplaire scanne (avec ou sans visa) : peut etre ajoute ou remplace apres la signature de l'employeur.
router.put("/contrats/:id/scan", async (req, res) => {
  try {
    const row = await chargerContrat(req, res);
    if (!row) return;
    if (row.statut === "BROUILLON" || row.statut === "ANNULE") return res.status(409).json({ error: t(req, "RH_CONTRAT_ETAPE_INVALIDE") });
    const f = fichierValide(req.body);
    if (!f) return res.status(400).json({ error: t(req, "RH_CONTRAT_FICHIER_INVALIDE") });
    await db.query(`UPDATE rh_contrat SET signe_base64 = $1, signe_type_mime = $2, signe_nom_fichier = $3, date_modification = now() WHERE id = $4`, [f.base64, f.mime, f.nom, row.id]);
    await sig.journaliser(req.user.tenantId, row.id, "SCAN_AJOUTE", row.statut, req.user.sub, sig.ipDe(req), { nom: f.nom });
    const maj = (await db.query(`SELECT * FROM rh_contrat WHERE id = $1`, [row.id])).rows[0];
    res.json(await composerContrat(req.user.tenantId, maj));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

router.get("/contrats/:id/scan", async (req, res) => {
  try {
    const row = await chargerContrat(req, res);
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

router.post("/contrats/:id/annuler", async (req, res) => {
  try {
    const row = await chargerContrat(req, res);
    if (!row) return;
    if (row.statut === "VISE") return res.status(409).json({ error: t(req, "RH_CONTRAT_FIGE") });
    await db.query(`UPDATE rh_contrat SET statut = 'ANNULE', date_modification = now() WHERE id = $1`, [row.id]);
    const maj = (await db.query(`SELECT * FROM rh_contrat WHERE id = $1`, [row.id])).rows[0];
    res.json(await composerContrat(req.user.tenantId, maj));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

router.get("/contrats/:id/pdf", async (req, res) => {
  try {
    const row = await chargerContrat(req, res);
    if (!row) return;
    const vue = await composerContrat(req.user.tenantId, row);
    const entete = await chargerEntete(req.user.tenantId);
    const signe = row.statut !== "BROUILLON" && row.statut !== "ANNULE";
    const buf = await contratTravailPdf(row, vue.contenu, entete, { signeEmployeur: signe, signatureSalarie: sig.signaturePdf(row) });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${row.numero}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_CONTRAT_ERREUR") });
  }
});

// ------------------------------------------------------------------------------------------- DMT
async function composerDmt(tenantId, row) {
  const { signe_base64, ...reste } = row;
  const e = await chargerEmploye(tenantId, row.employe_id);
  return {
    ...reste,
    a_fichier_signe: Boolean(signe_base64),
    employe: { id: e.emp.id, nom: e.emp.nom, prenom: e.emp.prenom, matricule: e.emp.matricule },
    avertissements: dmtSvc.avertissementsDmt(row.donnees_json),
    libelle_objet: dmtSvc.LIBELLES_OBJET[row.objet],
  };
}

async function activiteDerniere(tenantId) {
  const r = await db.query(
    `SELECT donnees_json->>'activite' AS activite FROM rh_dmt
     WHERE tenant_id = $1 AND COALESCE(donnees_json->>'activite', '') <> '' ORDER BY date_creation DESC LIMIT 1`,
    [tenantId]
  );
  return r.rows[0] ? r.rows[0].activite : "";
}

router.get("/dmt/prefill", async (req, res) => {
  try {
    const objet = dmtSvc.OBJETS.includes(req.query.objet) ? req.query.objet : "EMBAUCHE";
    const e = await chargerEmploye(req.user.tenantId, req.query.employe_id);
    if (!e) return res.status(404).json({ error: t(req, "RH_FICHE_NOT_FOUND") });
    let contrat = null;
    if (req.query.contrat_id) {
      contrat = (await db.query(`SELECT * FROM rh_contrat WHERE id = $1 AND tenant_id = $2`, [req.query.contrat_id, req.user.tenantId])).rows[0] || null;
    } else {
      contrat = (
        await db.query(
          `SELECT * FROM rh_contrat WHERE employe_id = $1 AND tenant_id = $2 AND statut <> 'ANNULE' ORDER BY date_creation DESC LIMIT 1`,
          [e.emp.id, req.user.tenantId]
        )
      ).rows[0] || null;
    }
    const entete = await chargerEntete(req.user.tenantId);
    const donnees = dmtSvc.donneesDmt({
      entete, emp: e.emp, enfants: e.enfants, contrat, objet, enfantACharge: rhFiche.enfantACharge,
      activite: await activiteDerniere(req.user.tenantId),
    });
    res.json({ employe_id: e.emp.id, contrat_id: contrat ? contrat.id : null, date_dmt: new Date().toISOString().slice(0, 10), objet, donnees });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DMT_ERREUR") });
  }
});

router.get("/dmt", async (req, res) => {
  try {
    const params = [req.user.tenantId];
    let filtre = "";
    if (req.query.employe_id) {
      params.push(req.query.employe_id);
      filtre = ` AND d.employe_id = $2`;
    }
    const r = await db.query(
      `SELECT d.id, d.numero, d.date_dmt, d.objet, d.statut, d.employe_id, d.numero_visa, d.date_visa,
              COALESCE(e.prenom, u.prenom) AS employe_prenom, COALESCE(e.nom, u.nom) AS employe_nom, e.matricule
       FROM rh_dmt d JOIN employe e ON e.id = d.employe_id LEFT JOIN utilisateur u ON u.id = e.utilisateur_id
       WHERE d.tenant_id = $1 ${filtre} ORDER BY d.date_creation DESC`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DMT_ERREUR") });
  }
});

function donneesDmtValides(d) {
  if (!d || typeof d !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (k === "elements") {
      const e = normaliserElements(v);
      if (e === null) return null;
      out.elements = e.map((l) => ({ libelle: l.libelle, montant: l.montant }));
    } else if (k === "total_brut") {
      continue;
    } else if (typeof v === "string" || typeof v === "number") {
      out[k] = String(v);
    }
  }
  out.total_brut = (out.elements || []).reduce((s, l) => s + l.montant, 0);
  if (!dmtSvc.OBJETS.includes(out.objet)) return null;
  return out;
}

router.post("/dmt", async (req, res) => {
  try {
    const e = await chargerEmploye(req.user.tenantId, req.body.employe_id);
    if (!e) return res.status(404).json({ error: t(req, "RH_FICHE_NOT_FOUND") });
    const donnees = donneesDmtValides(req.body.donnees);
    if (!donnees) return res.status(400).json({ error: t(req, "RH_DMT_CHAMP_INVALIDE") });
    const dateDmt = dateOuNull(req.body.date_dmt) || new Date().toISOString().slice(0, 10);
    const numero = await prochainNumero(req.user.tenantId, "DMT", "DMT");
    const id = uuidv4();
    await db.query(
      `INSERT INTO rh_dmt (id, tenant_id, employe_id, contrat_id, numero, date_dmt, objet, donnees_json, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, req.user.tenantId, e.emp.id, req.body.contrat_id || null, numero, dateDmt, donnees.objet, JSON.stringify(donnees), req.user.sub]
    );
    const row = (await db.query(`SELECT * FROM rh_dmt WHERE id = $1`, [id])).rows[0];
    res.status(201).json(await composerDmt(req.user.tenantId, row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DMT_ERREUR") });
  }
});

async function chargerDmt(req, res) {
  const r = await db.query(`SELECT * FROM rh_dmt WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.user.tenantId]);
  if (r.rows.length === 0) {
    res.status(404).json({ error: t(req, "RH_DMT_INTROUVABLE") });
    return null;
  }
  return r.rows[0];
}

router.get("/dmt/:id", async (req, res) => {
  try {
    const row = await chargerDmt(req, res);
    if (!row) return;
    res.json(await composerDmt(req.user.tenantId, row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DMT_ERREUR") });
  }
});

// Mise a jour : contenu (tant que BROUILLON) et suivi de depot / visa (statut, numero et date de visa).
router.patch("/dmt/:id", async (req, res) => {
  try {
    const row = await chargerDmt(req, res);
    if (!row) return;
    const sets = [];
    const params = [];
    const ajouter = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (req.body.donnees !== undefined) {
      if (row.statut !== "BROUILLON") return res.status(409).json({ error: t(req, "RH_DMT_FIGEE") });
      const donnees = donneesDmtValides(req.body.donnees);
      if (!donnees) return res.status(400).json({ error: t(req, "RH_DMT_CHAMP_INVALIDE") });
      ajouter("donnees_json", JSON.stringify(donnees));
      ajouter("objet", donnees.objet);
    }
    if (req.body.date_dmt !== undefined) {
      const d = dateOuNull(req.body.date_dmt);
      if (!d) return res.status(400).json({ error: t(req, "RH_DMT_CHAMP_INVALIDE") });
      ajouter("date_dmt", d);
    }
    if (req.body.statut !== undefined) {
      if (!["BROUILLON", "SIGNEE", "DEPOSEE", "VISEE", "ANNULEE"].includes(req.body.statut)) {
        return res.status(400).json({ error: t(req, "RH_DMT_CHAMP_INVALIDE") });
      }
      ajouter("statut", req.body.statut);
    }
    for (const k of ["date_depot", "date_visa"]) {
      if (req.body[k] !== undefined) {
        const d = dateOuNull(req.body[k]);
        if (d === undefined) return res.status(400).json({ error: t(req, "RH_DMT_CHAMP_INVALIDE") });
        ajouter(k, d);
      }
    }
    for (const k of ["numero_visa", "visa_section_locale", "notes"]) {
      if (req.body[k] !== undefined) ajouter(k, req.body[k] === "" || req.body[k] == null ? null : String(req.body[k]).trim());
    }
    if (sets.length) {
      params.push(row.id);
      await db.query(`UPDATE rh_dmt SET ${sets.join(", ")}, date_modification = now() WHERE id = $${params.length}`, params);
    }
    const maj = (await db.query(`SELECT * FROM rh_dmt WHERE id = $1`, [row.id])).rows[0];
    res.json(await composerDmt(req.user.tenantId, maj));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DMT_ERREUR") });
  }
});

router.delete("/dmt/:id", async (req, res) => {
  try {
    const row = await chargerDmt(req, res);
    if (!row) return;
    if (row.statut !== "BROUILLON" && row.statut !== "ANNULEE") return res.status(409).json({ error: t(req, "RH_DMT_FIGEE") });
    await db.query(`DELETE FROM rh_dmt WHERE id = $1`, [row.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DMT_ERREUR") });
  }
});

router.get("/dmt/:id/pdf", async (req, res) => {
  try {
    const row = await chargerDmt(req, res);
    if (!row) return;
    const entete = await chargerEntete(req.user.tenantId);
    const signee = row.statut !== "BROUILLON" && row.statut !== "ANNULEE";
    const buf = await dmtPdf(row, row.donnees_json, entete, { signeEmployeur: signee });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${row.numero}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DMT_ERREUR") });
  }
});

module.exports = router;
