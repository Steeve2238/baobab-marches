/**
 * Signature electronique du salarie : signature enregistree + code de confirmation a usage unique envoye par e-mail.
 * Trace conservee a chaque signature : date/heure, adresse IP, navigateur, empreinte du contrat et de la signature.
 * C'est une signature electronique simple : elle ne remplace pas une signature qualifiee.
 */
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const mailer = require("../utils/mailer");

const DUREE_CODE_MIN = 10;
const MAX_TENTATIVES = 5;
const DELAI_RENVOI_SEC = 60;

const hash = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const hashCode = (code, id) => hash(`${id}:${code}:${process.env.JWT_SECRET || "baobab"}`);

function masquerEmail(email) {
  if (!email) return "";
  const [l, d] = String(email).split("@");
  if (!d) return "***";
  return `${l.slice(0, 2)}${"*".repeat(Math.max(1, l.length - 2))}@${d}`;
}

function ipDe(req) {
  const xf = req.headers["x-forwarded-for"];
  return (xf ? String(xf).split(",").pop().trim() : req.ip || req.socket?.remoteAddress || "").slice(0, 64);
}

// Valide une image data-URL ou base64 brut ; retourne { base64, mime } ou null.
function imageValide(entree, maxOctets = 400 * 1024) {
  if (!entree || typeof entree !== "string") return null;
  let mime = null;
  let b64 = entree;
  const m = entree.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/);
  if (m) { mime = m[1]; b64 = m[2]; }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return null;
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0 || buf.length > maxOctets) return null;
  const png = buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!png && !jpg) return null;
  const vraiMime = png ? "image/png" : "image/jpeg";
  if (mime && mime !== vraiMime) return null;
  return { base64: buf.toString("base64"), mime: vraiMime, buf };
}

async function adresseDestinataire(employeId) {
  const r = await db.query(
    `SELECT COALESCE(NULLIF(e.email_personnel, ''), u.email) AS email
     FROM employe e LEFT JOIN utilisateur u ON u.id = e.utilisateur_id WHERE e.id = $1`,
    [employeId]
  );
  return r.rows[0] ? r.rows[0].email : null;
}

/**
 * Genere un code a 6 chiffres, le stocke (empreinte seulement) et l'envoie par e-mail.
 * Retourne { envoye_a (masque), code_test? } ; code_test uniquement si RH_CODE_TEST_MODE=1 (essais locaux, jamais en production).
 * Leve une erreur de code : "PAS_EMAIL", "TROP_VITE", "EMAIL_ECHEC".
 */
async function envoyerCode({ tenantId, employeId, objet, referenceId, libelle }) {
  const email = await adresseDestinataire(employeId);
  if (!email) throw Object.assign(new Error("PAS_EMAIL"), { code: "PAS_EMAIL" });
  const recent = await db.query(
    `SELECT 1 FROM rh_code_confirmation WHERE employe_id = $1 AND objet = $2 AND COALESCE(reference_id::text, '') = COALESCE($3::text, '')
       AND date_creation > now() - ($4 || ' seconds')::interval`,
    [employeId, objet, referenceId || null, String(DELAI_RENVOI_SEC)]
  );
  if (recent.rows.length) throw Object.assign(new Error("TROP_VITE"), { code: "TROP_VITE" });

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const id = uuidv4();
  // Les codes precedents non utilises pour la meme operation sont invalides.
  await db.query(
    `UPDATE rh_code_confirmation SET utilise = TRUE WHERE employe_id = $1 AND objet = $2 AND COALESCE(reference_id::text, '') = COALESCE($3::text, '') AND NOT utilise`,
    [employeId, objet, referenceId || null]
  );
  await db.query(
    `INSERT INTO rh_code_confirmation (id, tenant_id, employe_id, objet, reference_id, code_hash, expire_le, envoye_a)
     VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' minutes')::interval, $8)`,
    [id, tenantId, employeId, objet, referenceId || null, hashCode(code, id), String(DUREE_CODE_MIN), masquerEmail(email)]
  );
  const test = process.env.RH_CODE_TEST_MODE === "1" && process.env.NODE_ENV !== "production";
  if (!test) {
    try {
      await mailer.envoyerEmailSimple({
        destinataire: email,
        sujet: `Code de confirmation : ${code}`,
        message: `Votre code de confirmation est : ${code}\n\n${libelle}\n\nIl est valable ${DUREE_CODE_MIN} minutes et ne peut servir qu'une seule fois. Si vous n'etes pas a l'origine de cette demande, ignorez ce message et prevenez les ressources humaines.`,
      });
    } catch (err) {
      console.error("Envoi du code de confirmation impossible :", err.message);
      await db.query(`UPDATE rh_code_confirmation SET utilise = TRUE WHERE id = $1`, [id]);
      throw Object.assign(new Error("EMAIL_ECHEC"), { code: "EMAIL_ECHEC" });
    }
  }
  return { envoye_a: masquerEmail(email), expire_dans_minutes: DUREE_CODE_MIN, ...(test ? { code_test: code } : {}) };
}

/** Verifie et consomme le code. Retourne { ok:true, envoye_a } ou { ok:false, raison: "INVALIDE"|"TROP_ESSAIS" }. */
async function verifierCode({ employeId, objet, referenceId, code }) {
  const r = await db.query(
    `SELECT * FROM rh_code_confirmation
     WHERE employe_id = $1 AND objet = $2 AND COALESCE(reference_id::text, '') = COALESCE($3::text, '') AND NOT utilise AND expire_le > now()
     ORDER BY date_creation DESC LIMIT 1`,
    [employeId, objet, referenceId || null]
  );
  const ligne = r.rows[0];
  if (!ligne) return { ok: false, raison: "INVALIDE" };
  if (ligne.tentatives >= MAX_TENTATIVES) return { ok: false, raison: "TROP_ESSAIS" };
  const propose = String(code || "").replace(/\s/g, "");
  const attendu = Buffer.from(ligne.code_hash);
  const recu = Buffer.from(hashCode(propose, ligne.id));
  const bon = attendu.length === recu.length && crypto.timingSafeEqual(attendu, recu);
  if (!bon) {
    await db.query(`UPDATE rh_code_confirmation SET tentatives = tentatives + 1 WHERE id = $1`, [ligne.id]);
    return { ok: false, raison: ligne.tentatives + 1 >= MAX_TENTATIVES ? "TROP_ESSAIS" : "INVALIDE" };
  }
  await db.query(`UPDATE rh_code_confirmation SET utilise = TRUE WHERE id = $1`, [ligne.id]);
  return { ok: true, envoye_a: ligne.envoye_a };
}

async function journaliser(tenantId, contratId, evenement, statutApres, utilisateurId, ip, details) {
  await db.query(
    `INSERT INTO rh_contrat_evenement (id, tenant_id, contrat_id, evenement, statut_apres, utilisateur_id, ip, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [uuidv4(), tenantId, contratId, evenement, statutApres, utilisateurId || null, ip || null, details ? JSON.stringify(details) : null]
  );
}

module.exports = { envoyerCode, verifierCode, imageValide, masquerEmail, ipDe, hash, journaliser, adresseDestinataire };

/** Signature du salarie telle qu'imprimee sur le contrat (image figee a la signature + mention horodatee). */
function signaturePdf(row) {
  const s = row && row.signature_salarie_json;
  if (!s || !s.image_base64) return null;
  const d = new Date(s.date);
  const p2 = (n) => String(n).padStart(2, "0");
  const horodatage = `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
  return { image_base64: s.image_base64, mention: `Lu et approuvé - signé électroniquement le ${horodatage}` };
}

/** Version sans l'image pour les reponses JSON. */
function signatureResume(s) {
  if (!s) return null;
  const { image_base64, ...reste } = s;
  return reste;
}

module.exports.signaturePdf = signaturePdf;
module.exports.signatureResume = signatureResume;
