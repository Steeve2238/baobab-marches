/**
 * Portail de remise tracee des offres et contrats.
 *
 * Principe : l'editeur (Super Admin) cree un partage pour un document. Le systeme genere
 *  - un lien unique (jeton aleatoire de 192 bits, envoye par e-mail) ;
 *  - un code a 6 chiffres (affiche une seule fois a l'editeur, qui le transmet au client par un autre canal : WhatsApp, telephone).
 * Le client ouvre le lien, saisit son e-mail ou son telephone et le code, consulte le document, le telecharge et le signe (dessin, nom, qualite).
 * Chaque etape est journalisee (date, IP, navigateur). Le jeton et le code ne sont jamais stockes en clair.
 * Le document est fige (snapshot) a la creation du partage : le client signe exactement le texte envoye, et une empreinte SHA-256 le prouve.
 * Signature electronique simple : elle ne remplace pas une signature electronique qualifiee.
 */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const mailer = require("../utils/mailer");
const oc = require("./offresContrats");
const pdfs = require("./offresContratsPdf");
const ventesPdf = require("./ventesPdf");
const pv = require("./portailVentes");
const { imageValide, masquerEmail } = require("./rhSignature");

const DUREE_DEFAUT_JOURS = 30;
const MAX_ECHECS = 5;
const BLOCAGE_MIN = 30;
const SESSION_HEURES = 2;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[a-f0-9]{48}$/;

class PortailError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const sha = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const secret = () => process.env.JWT_SECRET || "baobab";
const hashToken = (token) => sha(`portail:${token}`);
const hashCode = (code, id) => sha(`${id}:${code}:${secret()}`);
const chiffres = (v) => String(v || "").replace(/\D/g, "");
const memeTel = (a, b) => {
  const x = chiffres(a);
  const y = chiffres(b);
  return x.length >= 8 && y.length >= 8 && x.slice(-9) === y.slice(-9);
};
const egalSur = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function jsonStable(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jsonStable).join(",")}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${jsonStable(v[k])}`).join(",")}}`;
}

const DOCS = {
  OFFRE: { lib: "Offre commerciale", art: "l'offre commerciale", pr: "la", origine: "EDITEUR" },
  CONTRAT: { lib: "Contrat", art: "le contrat", pr: "le", origine: "EDITEUR" },
  FACTURE: { lib: "Facture", art: "la facture", pr: "la", origine: "TENANT" },
  DEVIS: { lib: "Devis", art: "le devis", pr: "le", origine: "TENANT" },
};
const libelleType = (type) => (DOCS[type] || DOCS.CONTRAT).lib;
const PORTEE_EDITEUR = { origine: "EDITEUR" };

/** Cloisonnement : un document de l'editeur n'est jamais visible depuis une entreprise, et inversement ; une entreprise ne voit que les siens. */
function verifierPortee(ligne, portee = PORTEE_EDITEUR) {
  if (!ligne || ligne.origine !== portee.origine || (portee.origine === "TENANT" && ligne.tenant_id !== portee.tenantId)) throw new PortailError("PORTAIL_INTROUVABLE", 404);
}
const dateHeure = (d) => {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(x.getUTCDate())}/${p(x.getUTCMonth() + 1)}/${x.getUTCFullYear()} à ${p(x.getUTCHours())}:${p(x.getUTCMinutes())}:${p(x.getUTCSeconds())} UTC (heure de Dakar)`;
};

async function journaliser(partageId, evenement, { ip, ua, details } = {}) {
  await db.query(
    `INSERT INTO portail_evenement (id, partage_id, evenement, ip, user_agent, details) VALUES ($1,$2,$3,$4,$5,$6)`,
    [uuidv4(), partageId, evenement, ip ? String(ip).slice(0, 64) : null, ua ? String(ua).slice(0, 300) : null, details ? JSON.stringify(details) : null]
  );
}

/** Evite de noter dix fois la meme action quand la page est rechargee : meme evenement, meme IP, dans la fenetre donnee. */
async function journaliserSiNouveau(partageId, evenement, ctx, minutes) {
  const r = await db.query(
    `SELECT 1 FROM portail_evenement WHERE partage_id = $1 AND evenement = $2 AND ip IS NOT DISTINCT FROM $3 AND date_evenement > now() - ($4 || ' minutes')::interval LIMIT 1`,
    [partageId, evenement, ctx.ip || null, String(minutes)]
  );
  if (!r.rows[0]) await journaliser(partageId, evenement, ctx);
}

function lienPour(token) {
  return `${String(process.env.FRONTEND_URL || "").replace(/\/$/, "")}/portail/${token}`;
}

function genererJetonEtCode() {
  return { token: crypto.randomBytes(24).toString("hex"), code: String(crypto.randomInt(0, 1000000)).padStart(6, "0") };
}

function statutAffiche(r) {
  if (r.statut === "SIGNE") return "SIGNE";
  if (r.statut === "REVOQUE") return "REVOQUE";
  if (new Date(r.expire_le) < new Date()) return "EXPIRE";
  if (r.bloque_jusqua && new Date(r.bloque_jusqua) > new Date()) return "BLOQUE";
  return "ACTIF";
}

function versResume(r) {
  return {
    id: r.id,
    type_document: r.type_document,
    document_id: r.document_id,
    numero_document: r.numero_document,
    tenant_id: r.tenant_id,
    client_raison_sociale: r.client_raison_sociale || null,
    origine: r.origine,
    signature_requise: r.signature_requise !== false,
    destinataire_nom: r.destinataire_nom,
    destinataire_email: r.destinataire_email,
    destinataire_tel: r.destinataire_tel,
    statut: statutAffiche(r),
    expire_le: r.expire_le,
    date_creation: r.date_creation,
    date_envoi_email: r.date_envoi_email,
    envoye_a: r.envoye_a,
    premiere_ouverture: r.premiere_ouverture,
    dernier_acces: r.dernier_acces,
    date_consultation: r.date_consultation,
    date_telechargement: r.date_telechargement,
    date_signature: r.date_signature,
    tentatives_echec: r.tentatives_echec,
    signataire: r.nom_signataire || null,
    offre_id: r.type_document === "OFFRE" ? r.document_id : r.contrat_offre_id || null,
  };
}

const SELECT_PARTAGE = `
  SELECT p.id, p.type_document, p.document_id, p.tenant_id, p.numero_document, p.destinataire_nom, p.destinataire_email, p.destinataire_tel,
         p.statut, p.expire_le, p.tentatives_echec, p.bloque_jusqua, p.date_envoi_email, p.envoye_a, p.premiere_ouverture, p.dernier_acces,
         p.date_consultation, p.date_telechargement, p.date_signature, p.date_creation, p.empreinte_document, p.origine, p.signature_requise,
         CASE WHEN p.origine = 'TENANT' THEN p.snapshot_json->'document'->>'client_nom' ELSE te.raison_sociale END AS client_raison_sociale, s.nom_signataire, cc.offre_id AS contrat_offre_id
  FROM portail_partage p
  LEFT JOIN contrat_client cc ON p.type_document = 'CONTRAT' AND cc.id = p.document_id
  LEFT JOIN tenant te ON te.id = p.tenant_id
  LEFT JOIN portail_signature s ON s.partage_id = p.id
`;

// ---------------------------------------------------------------------------
// Cote editeur (Super Admin)
// ---------------------------------------------------------------------------

async function envoyerLien({ partage, lien, params, message }) {
  const emetteur = params.raison_sociale || "Baobab Marchés";
  const validite = new Date(partage.expire_le).toLocaleDateString("fr-FR");
  const d = DOCS[partage.type_document] || DOCS.CONTRAT;
  const actions = partage.signature_requise === false ? `${d.pr === "la" ? "la" : "le"} consulter et ${d.pr === "la" ? "la" : "le"} télécharger` : `${d.pr === "la" ? "la" : "le"} consulter, ${d.pr === "la" ? "la" : "le"} télécharger et ${d.pr === "la" ? "la" : "le"} signer`;
  const corps =
    message ||
    `Bonjour${partage.destinataire_nom ? ` ${partage.destinataire_nom}` : ""},\n\n${emetteur} vous transmet ${d.art} ${partage.numero_document}. Vous pouvez ${actions} en ligne depuis ce lien sécurisé :\n\n${lien}\n\nPour y accéder, vous aurez besoin de votre adresse e-mail ou de votre numéro de téléphone, ainsi que d'un code d'accès que nous vous communiquons séparément (WhatsApp ou téléphone).\n\nCe lien est valable jusqu'au ${validite}.\n\nCordialement,\n${emetteur}`;
  await mailer.envoyerEmailAvecPieceJointe({
    destinataire: partage.destinataire_email,
    sujet: `${d.lib} ${partage.numero_document} - ${partage.signature_requise === false ? "à consulter" : "à consulter et signer"}`,
    message: corps,
    pieces: [],
    repondreA: params.email || null,
    copie: params.email || null,
  });
}

async function chargerDocument(type, documentId, tenantEmetteur) {
  if (DOCS[type] && DOCS[type].origine === "TENANT") {
    const c = await pv.chargerDocumentVente(type, documentId, tenantEmetteur);
    pv.verifierPartageable(type, c.document);
    return { document: c.document, tenantId: tenantEmetteur, numero: c.numero, params: c.params };
  }
  if (type === "OFFRE") {
    const o = await oc.getOffre(documentId);
    if (!["BROUILLON", "ENVOYEE"].includes(o.statut)) throw new PortailError("PORTAIL_DOCUMENT_NON_PARTAGEABLE", 409);
    return { document: o, tenantId: o.tenant_id, numero: o.numero, params: null };
  }
  const c = await oc.getContratComplet(documentId);
  if (!["PREPARE", "ENVOYE"].includes(c.statut)) throw new PortailError("PORTAIL_DOCUMENT_NON_PARTAGEABLE", 409);
  const { signe_base64, ...reste } = c;
  return { document: reste, tenantId: c.tenant_id, numero: c.numero, params: null };
}

/**
 * Cree (ou remplace) le partage d'un document. Retourne le lien et le code EN CLAIR, une seule fois.
 * @returns {{ partage, lien, code, email_envoye, email_erreur }}
 */
async function creerPartage({ type, documentId, adminId, email, telephone, nom, jours, envoyerEmail = true, message, ip, tenantId: tenantEmetteur, signatureRequise, creeParEmail }) {
  if (!DOCS[type]) throw new PortailError("PORTAIL_TYPE_INVALIDE", 400);
  const origine = DOCS[type].origine;
  if (origine === "TENANT" && !tenantEmetteur) throw new PortailError("PORTAIL_TYPE_INVALIDE", 400);
  const signature = origine === "EDITEUR" ? true : signatureRequise === undefined || signatureRequise === null ? type === "DEVIS" : signatureRequise === true || signatureRequise === "true";
  const emailN = String(email || "").trim().toLowerCase();
  const tel = String(telephone || "").trim();
  if (!emailN && !chiffres(tel)) throw new PortailError("PORTAIL_DESTINATAIRE_REQUIS", 400);
  if (emailN && !EMAIL_RE.test(emailN)) throw new PortailError("PORTAIL_EMAIL_INVALIDE", 400);
  if (tel && chiffres(tel).length < 8) throw new PortailError("PORTAIL_TEL_INVALIDE", 400);
  const nbJours = Math.min(180, Math.max(1, Math.round(Number(jours) || DUREE_DEFAUT_JOURS)));

  const deja = await db.query(`SELECT statut FROM portail_partage WHERE type_document = $1 AND document_id = $2 AND statut = 'SIGNE' LIMIT 1`, [type, documentId]);
  if (deja.rows[0]) throw new PortailError("PORTAIL_DEJA_SIGNE", 409);

  let chargement;
  try {
    chargement = await chargerDocument(type, documentId, tenantEmetteur);
  } catch (e) {
    if (e instanceof pv.VenteDocError) throw new PortailError(e.code, e.status);
    throw e;
  }
  const { document, tenantId, numero } = chargement;
  const params = chargement.params || (await oc.getParametresEditeur());
  const snapshot = JSON.parse(JSON.stringify({ document, params }));
  const empreinte = sha(jsonStable(snapshot));
  const { token, code } = genererJetonEtCode();
  const id = uuidv4();
  const expire = new Date(Date.now() + nbJours * 86400000);

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE portail_partage SET statut = 'REVOQUE' WHERE type_document = $1 AND document_id = $2 AND statut = 'ACTIF'`, [type, documentId]);
    await client.query(
      `INSERT INTO portail_partage (id, type_document, document_id, tenant_id, numero_document, token_hash, code_hash, destinataire_nom, destinataire_email, destinataire_tel,
         expire_le, snapshot_json, empreinte_document, cree_par, origine, signature_requise, cree_par_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id, type, documentId, tenantId, numero, hashToken(token), hashCode(code, id), String(nom || "").trim().slice(0, 120) || null, emailN || null, tel || null, expire, JSON.stringify(snapshot), empreinte, adminId || null, origine, signature, creeParEmail || null]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await journaliser(id, "CREE", { ip, details: { destinataire: emailN || tel, empreinte } });

  // Le document passe a « envoye » : il n'est plus modifiable tant que le partage est actif.
  const cible = emailN || tel;
  if (type === "OFFRE") await oc.marquerEnvoyee(documentId, cible);
  else if (type === "CONTRAT") await oc.marquerContratEnvoye(documentId, cible);
  else if (type === "DEVIS") await pv.marquerDevisEnvoye(documentId, tenantEmetteur);

  const lien = lienPour(token);
  const ligne = (await db.query(`${SELECT_PARTAGE} WHERE p.id = $1`, [id])).rows[0];
  const resultat = { lien, code, email_envoye: false, email_erreur: null };
  if (emailN && envoyerEmail) {
    try {
      await envoyerLien({ partage: ligne, lien, params, message: String(message || "").slice(0, 5000) || null });
      await db.query(`UPDATE portail_partage SET date_envoi_email = now(), envoye_a = $2 WHERE id = $1`, [id, emailN]);
      await journaliser(id, "EMAIL_ENVOYE", { ip, details: { a: emailN } });
      resultat.email_envoye = true;
    } catch (e) {
      console.error(e);
      resultat.email_erreur = "PORTAIL_EMAIL_ECHEC";
      await journaliser(id, "EMAIL_ECHEC", { ip });
    }
  }
  resultat.partage = versResume((await db.query(`${SELECT_PARTAGE} WHERE p.id = $1`, [id])).rows[0]);
  return resultat;
}

/** Nouveau lien et nouveau code (l'ancien lien cesse de fonctionner) ; ne s'applique qu'a un partage non signe et non revoque. */
async function renouveler(id, { envoyerEmail = false, jours, ip, portee } = {}) {
  const r = await db.query(`${SELECT_PARTAGE} WHERE p.id = $1`, [id]);
  const ligne = r.rows[0];
  verifierPortee(ligne, portee);
  if (ligne.statut === "SIGNE") throw new PortailError("PORTAIL_DEJA_SIGNE", 409);
  if (ligne.statut === "REVOQUE") throw new PortailError("PORTAIL_REVOQUE", 409);
  const nbJours = Math.min(180, Math.max(1, Math.round(Number(jours) || DUREE_DEFAUT_JOURS)));
  const { token, code } = genererJetonEtCode();
  const expire = new Date(Date.now() + nbJours * 86400000);
  await db.query(
    `UPDATE portail_partage SET token_hash = $2, code_hash = $3, expire_le = $4, tentatives_echec = 0, bloque_jusqua = NULL WHERE id = $1`,
    [id, hashToken(token), hashCode(code, id), expire]
  );
  await journaliser(id, "RENOUVELE", { ip });
  const lien = lienPour(token);
  const resultat = { lien, code, email_envoye: false, email_erreur: null };
  if (envoyerEmail && ligne.destinataire_email) {
    try {
      const params = ligne.origine === "TENANT" ? (await db.query(`SELECT snapshot_json->'params' AS p FROM portail_partage WHERE id = $1`, [id])).rows[0].p : await oc.getParametresEditeur();
      await envoyerLien({ partage: { ...ligne, expire_le: expire }, lien, params });
      await db.query(`UPDATE portail_partage SET date_envoi_email = now(), envoye_a = $2 WHERE id = $1`, [id, ligne.destinataire_email]);
      await journaliser(id, "EMAIL_ENVOYE", { ip, details: { a: ligne.destinataire_email } });
      resultat.email_envoye = true;
    } catch (e) {
      console.error(e);
      resultat.email_erreur = "PORTAIL_EMAIL_ECHEC";
      await journaliser(id, "EMAIL_ECHEC", { ip });
    }
  }
  resultat.partage = versResume((await db.query(`${SELECT_PARTAGE} WHERE p.id = $1`, [id])).rows[0]);
  return resultat;
}

async function revoquer(id, ip, portee) {
  const r = await db.query(`SELECT statut, origine, tenant_id FROM portail_partage WHERE id = $1`, [id]);
  verifierPortee(r.rows[0], portee);
  if (r.rows[0].statut === "SIGNE") throw new PortailError("PORTAIL_DEJA_SIGNE", 409);
  await db.query(`UPDATE portail_partage SET statut = 'REVOQUE' WHERE id = $1`, [id]);
  await journaliser(id, "REVOQUE", { ip });
  return getPartage(id, portee);
}

async function lister({ type, documentId, tenantId, statut, portee = PORTEE_EDITEUR } = {}) {
  const cond = [];
  const vals = [];
  vals.push(portee.origine);
  cond.push(`p.origine = $${vals.length}`);
  if (portee.origine === "TENANT") tenantId = portee.tenantId;
  if (type) { vals.push(type); cond.push(`p.type_document = $${vals.length}`); }
  if (documentId) { vals.push(documentId); cond.push(`p.document_id = $${vals.length}`); }
  if (tenantId) { vals.push(tenantId); cond.push(`p.tenant_id = $${vals.length}`); }
  const r = await db.query(`${SELECT_PARTAGE} ${cond.length ? `WHERE ${cond.join(" AND ")}` : ""} ORDER BY p.date_creation DESC LIMIT 500`, vals);
  let rows = r.rows.map(versResume);
  if (statut) rows = rows.filter((x) => x.statut === statut);
  return rows;
}

async function getPartage(id, portee) {
  const r = await db.query(`${SELECT_PARTAGE} WHERE p.id = $1`, [id]);
  verifierPortee(r.rows[0], portee);
  const ev = await db.query(`SELECT evenement, ip, user_agent, details, date_evenement FROM portail_evenement WHERE partage_id = $1 ORDER BY date_evenement, id`, [id]);
  const sg = await db.query(
    `SELECT nom_signataire, qualite_signataire, mode, identifiant_masque, ip, user_agent, date_signature, empreinte_document, empreinte_signature FROM portail_signature WHERE partage_id = $1`,
    [id]
  );
  return { ...versResume(r.rows[0]), empreinte_document: r.rows[0].empreinte_document, evenements: ev.rows, signature: sg.rows[0] || null };
}

/** Quand le document est traite par un autre chemin (acceptation manuelle, refus, annulation, contrat signe depose), les liens actifs sont desactives. */
async function revoquerActifsDocument(type, documentId, ip) {
  const r = await db.query(`UPDATE portail_partage SET statut = 'REVOQUE' WHERE type_document = $1 AND document_id = $2 AND statut = 'ACTIF' RETURNING id`, [type, documentId]);
  for (const ligne of r.rows) await journaliser(ligne.id, "REVOQUE", { ip, details: { raison: "document traite par un autre chemin" } });
}

/** Vrai si le document ne doit plus etre modifie (partage actif non expire, ou signe). */
async function documentVerrouille(type, documentId) {
  const r = await db.query(
    `SELECT 1 FROM portail_partage WHERE type_document = $1 AND document_id = $2 AND (statut = 'SIGNE' OR (statut = 'ACTIF' AND expire_le > now())) LIMIT 1`,
    [type, documentId]
  );
  return !!r.rows[0];
}

// ---------------------------------------------------------------------------
// Cote client (public)
// ---------------------------------------------------------------------------

async function trouverParToken(token) {
  if (!TOKEN_RE.test(String(token || ""))) return null;
  const r = await db.query(`SELECT * FROM portail_partage WHERE token_hash = $1`, [hashToken(token)]);
  return r.rows[0] || null;
}

async function exiger(token) {
  const ligne = await trouverParToken(token);
  if (!ligne) throw new PortailError("PORTAIL_LIEN_INVALIDE", 404);
  return ligne;
}

/** Premiere page : n'expose aucun contenu, seulement l'etat du lien. */
async function infoPublique(token, ctx) {
  const ligne = await exiger(token);
  await db.query(`UPDATE portail_partage SET premiere_ouverture = COALESCE(premiere_ouverture, now()), dernier_acces = now() WHERE id = $1`, [ligne.id]);
  await journaliserSiNouveau(ligne.id, "LIEN_OUVERT", ctx, 5);
  const params = ligne.snapshot_json.params || {};
  return {
    type_document: ligne.type_document,
    numero_document: ligne.numero_document,
    emetteur: params.raison_sociale || "Baobab Marchés",
    signature_requise: ligne.signature_requise !== false,
    statut: statutAffiche(ligne),
    bloque_jusqua: ligne.bloque_jusqua && new Date(ligne.bloque_jusqua) > new Date() ? ligne.bloque_jusqua : null,
    expire_le: ligne.expire_le,
  };
}

function creerSession(ligne, identifiantMasque) {
  return jwt.sign({ pid: ligne.id, scope: "portail", idm: identifiantMasque, v: ligne.code_hash.slice(0, 16) }, secret(), { expiresIn: `${SESSION_HEURES}h` });
}

async function acces(token, { identifiant, code }, ctx) {
  const ligne = await exiger(token);
  const etat = statutAffiche(ligne);
  if (etat === "REVOQUE") throw new PortailError("PORTAIL_LIEN_REVOQUE", 410);
  if (etat === "EXPIRE") throw new PortailError("PORTAIL_LIEN_EXPIRE", 410);
  if (etat === "BLOQUE") throw new PortailError("PORTAIL_ACCES_BLOQUE", 429);

  const ident = String(identifiant || "").trim();
  const codeSaisi = String(code || "").replace(/\s/g, "");
  const okIdent = !!ident && ((ligne.destinataire_email && ident.toLowerCase() === ligne.destinataire_email) || (ligne.destinataire_tel && memeTel(ident, ligne.destinataire_tel)));
  const okCode = egalSur(hashCode(codeSaisi, ligne.id), ligne.code_hash);
  if (!(okIdent && okCode)) {
    const r = await db.query(`UPDATE portail_partage SET tentatives_echec = tentatives_echec + 1 WHERE id = $1 RETURNING tentatives_echec`, [ligne.id]);
    const n = r.rows[0].tentatives_echec;
    if (n >= MAX_ECHECS) {
      await db.query(`UPDATE portail_partage SET tentatives_echec = 0, bloque_jusqua = now() + ($2 || ' minutes')::interval WHERE id = $1`, [ligne.id, String(BLOCAGE_MIN)]);
      await journaliser(ligne.id, "ACCES_BLOQUE", { ...ctx, details: { minutes: BLOCAGE_MIN } });
      throw new PortailError("PORTAIL_ACCES_BLOQUE", 429);
    }
    await journaliser(ligne.id, "ACCES_REFUSE", { ...ctx, details: { restantes: MAX_ECHECS - n } });
    throw new PortailError("PORTAIL_ACCES_REFUSE", 401, { restantes: MAX_ECHECS - n });
  }
  await db.query(`UPDATE portail_partage SET tentatives_echec = 0, bloque_jusqua = NULL, dernier_acces = now() WHERE id = $1`, [ligne.id]);
  await journaliser(ligne.id, "ACCES_VALIDE", ctx);
  const masque = ident.includes("@") ? masquerEmail(ident) : `***${chiffres(ident).slice(-3)}`;
  return { session: creerSession(ligne, masque) };
}

/** Controle la session (Bearer) pour ce lien. Retourne la ligne de partage et l'identifiant masque. */
async function exigerSession(token, enteteAuth) {
  const ligne = await exiger(token);
  const m = String(enteteAuth || "").match(/^Bearer (.+)$/);
  let payload;
  try {
    payload = jwt.verify(m ? m[1] : "", secret());
  } catch (e) {
    throw new PortailError("PORTAIL_SESSION_INVALIDE", 401);
  }
  if (!payload || payload.scope !== "portail" || payload.pid !== ligne.id || payload.v !== ligne.code_hash.slice(0, 16)) throw new PortailError("PORTAIL_SESSION_INVALIDE", 401);
  const etat = statutAffiche(ligne);
  if (etat === "REVOQUE") throw new PortailError("PORTAIL_LIEN_REVOQUE", 410);
  if (etat === "EXPIRE") throw new PortailError("PORTAIL_LIEN_EXPIRE", 410);
  return { ligne, identifiantMasque: payload.idm || "" };
}

async function signatureDe(partageId) {
  const r = await db.query(`SELECT * FROM portail_signature WHERE partage_id = $1`, [partageId]);
  return r.rows[0] || null;
}

function resumeSignature(s) {
  if (!s) return null;
  return { nom_signataire: s.nom_signataire, qualite_signataire: s.qualite_signataire, date_signature: s.date_signature, ip: s.ip, empreinte_document: s.empreinte_document };
}

async function consulter(ligne, ctx) {
  await db.query(`UPDATE portail_partage SET date_consultation = COALESCE(date_consultation, now()), dernier_acces = now() WHERE id = $1`, [ligne.id]);
  await journaliserSiNouveau(ligne.id, "DOCUMENT_CONSULTE", ctx, 10);
  const params = ligne.snapshot_json.params || {};
  const sig = await signatureDe(ligne.id);
  return {
    type_document: ligne.type_document,
    numero_document: ligne.numero_document,
    emetteur: params.raison_sociale || "Baobab Marchés",
    destinataire_nom: ligne.destinataire_nom,
    a_signer: ligne.statut === "ACTIF" && ligne.signature_requise !== false,
    signature_requise: ligne.signature_requise !== false,
    signature: resumeSignature(sig),
    expire_le: ligne.expire_le,
  };
}

// --- PDF (version figee, avec la signature et le certificat une fois signe) ----------------------------------------------------

const LIBELLES_EVENEMENT = {
  CREE: "Partage créé par l'émetteur",
  EMAIL_ENVOYE: "Lien envoyé par e-mail",
  EMAIL_ECHEC: "Échec d'envoi de l'e-mail",
  LIEN_OUVERT: "Lien ouvert",
  ACCES_REFUSE: "Accès refusé (identifiant ou code incorrect)",
  ACCES_BLOQUE: "Accès bloqué temporairement",
  ACCES_VALIDE: "Accès validé (identifiant et code)",
  DOCUMENT_CONSULTE: "Document consulté",
  PDF_AFFICHE: "PDF affiché",
  PDF_TELECHARGE: "PDF téléchargé",
  SIGNE: "Document signé électroniquement",
  RENOUVELE: "Nouveau lien et nouveau code générés",
  REVOQUE: "Partage révoqué",
  COPIE_ENVOYEE: "Copie signée envoyée par e-mail",
};

function pageCertificat(doc, ligne, sig, evenements) {
  const H = pdfs.helpers;
  const x0 = doc.page.margins.left;
  const L = H.largeurUtile(doc);
  H.titre(doc, "CERTIFICAT DE SIGNATURE ÉLECTRONIQUE", `${libelleType(ligne.type_document)} n° ${ligne.numero_document}`);
  const lignes = [
    ["Document", `${libelleType(ligne.type_document)} n° ${ligne.numero_document}`],
    ["Signataire", `${sig.nom_signataire}${sig.qualite_signataire ? `, ${sig.qualite_signataire}` : ""}`],
    ["Date et heure de signature", dateHeure(sig.date_signature)],
    ["Adresse IP du signataire", sig.ip || "non disponible"],
    ["Navigateur", (sig.user_agent || "non disponible").slice(0, 120)],
    ["Accès contrôlé par", `${sig.identifiant_masque || "identifiant et code d'accès"} et code à 6 chiffres`],
    ["Mode de signature", sig.mode === "IMPORTEE" ? "Image de signature importée" : "Signature dessinée à l'écran"],
    ["Empreinte du document (SHA-256)", sig.empreinte_document],
    ["Empreinte de la signature (SHA-256)", sig.empreinte_signature],
  ];
  for (const [k, v] of lignes) {
    H.asseoir(doc, 22);
    const y1 = doc.y;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(H.GRIS).text(k, x0, y1, { width: 150 });
    const yk = doc.y;
    doc.font("Helvetica").fontSize(k.startsWith("Empreinte") ? 7.8 : 9.3).fillColor("#000").text(v, x0 + 160, y1, { width: L - 160 });
    doc.y = Math.max(yk, doc.y) + 4;
    doc.moveTo(x0, doc.y - 1).lineTo(x0 + L, doc.y - 1).lineWidth(0.4).strokeColor(H.LIGNE).stroke();
    doc.y += 3;
  }
  H.section(doc, "Journal des opérations");
  for (const e of evenements) {
    H.asseoir(doc, 14);
    const y1 = doc.y;
    doc.font("Helvetica").fontSize(8.5).fillColor("#000").text(dateHeure(e.date_evenement).replace(" (heure de Dakar)", ""), x0, y1, { width: 170 });
    doc.text(LIBELLES_EVENEMENT[e.evenement] || e.evenement, x0 + 175, y1, { width: L - 175 - 110 });
    doc.fillColor(H.GRIS).text(e.ip || "", x0 + L - 105, y1, { width: 105, align: "right" });
    doc.y = Math.max(doc.y, y1 + 12) + 1;
  }
  doc.moveDown(0.8);
  H.corps(doc, "Ce certificat atteste de la signature électronique simple du document ci-dessus par la personne désignée, après contrôle de son identifiant (e-mail ou téléphone) et d'un code d'accès à usage limité. Le document signé est celui figé lors de l'envoi : toute modification ultérieure produirait une empreinte différente. Cette signature ne remplace pas une signature électronique qualifiée.", { taille: 8.5, couleur: H.GRIS, align: "justify" });
}

async function rendrePdf(ligne) {
  const snap = ligne.snapshot_json;
  const sig = await signatureDe(ligne.id);
  const opts = { cadre: ligne.signature_requise !== false };
  if (sig) {
    const evenements = (await db.query(`SELECT evenement, ip, date_evenement FROM portail_evenement WHERE partage_id = $1 AND evenement <> 'COPIE_ENVOYEE' ORDER BY date_evenement, id`, [ligne.id])).rows;
    opts.signature = {
      image_buf: Buffer.from(sig.image_base64, "base64"),
      mention: `${ligne.type_document === "FACTURE" ? "Facture reçue, accusé de réception." : "Lu et approuvé, bon pour accord."} Signé électroniquement par ${sig.nom_signataire}${sig.qualite_signataire ? `, ${sig.qualite_signataire}` : ""}, le ${dateHeure(sig.date_signature).replace(" (heure de Dakar)", "")}.`,
    };
    opts.apres = (doc) => pageCertificat(doc, ligne, sig, evenements);
  }
  if (ligne.type_document === "FACTURE") return ventesPdf.facturePdf(snap.document, snap.params, opts);
  if (ligne.type_document === "DEVIS") return ventesPdf.devisPdf(snap.document, snap.params, opts);
  return ligne.type_document === "OFFRE" ? pdfs.offrePdf(snap.document, snap.params, opts) : pdfs.contratPdf(snap.document, snap.params, opts);
}

function nomPdf(ligne, signe) {
  return `${ligne.numero_document}${signe ? "-signe" : ""}.pdf`;
}

async function pdfPourClient(ligne, { telecharger }, ctx) {
  const buf = await rendrePdf(ligne);
  if (telecharger) {
    await db.query(`UPDATE portail_partage SET date_telechargement = COALESCE(date_telechargement, now()) WHERE id = $1`, [ligne.id]);
    await journaliser(ligne.id, "PDF_TELECHARGE", { ...ctx, details: { signe: ligne.statut === "SIGNE" } });
  } else {
    await journaliserSiNouveau(ligne.id, "PDF_AFFICHE", ctx, 10);
  }
  return { buffer: buf, nom: nomPdf(ligne, ligne.statut === "SIGNE") };
}

async function pdfPourEditeur(id, portee) {
  const r = await db.query(`SELECT * FROM portail_partage WHERE id = $1`, [id]);
  verifierPortee(r.rows[0], portee);
  return { buffer: await rendrePdf(r.rows[0]), nom: nomPdf(r.rows[0], r.rows[0].statut === "SIGNE") };
}

// --- Signature --------------------------------------------------------------------------------------------------------------------

async function notifierSignature(ligne, sig) {
  const params = ligne.snapshot_json.params || {};
  const libelle = `${libelleType(ligne.type_document)} ${ligne.numero_document}`;
  const ou = ligne.origine === "TENANT"
    ? `Le document signé et son certificat sont disponibles dans la plateforme, rubrique Ventes > Suivi des envois.`
    : `Le document signé et son certificat sont disponibles dans le Super Admin, rubrique Suivi des documents.`;
  const dests = [...new Set([params.email, ligne.cree_par_email].filter(Boolean).map((x) => String(x).toLowerCase()))];
  for (const dest of dests) {
    try {
      await mailer.envoyerEmailSimple({
        destinataire: dest,
        sujet: `${libelle} signé par ${sig.nom_signataire}`,
        message: `Bonjour,\n\n${libelle} a été signé électroniquement par ${sig.nom_signataire}${sig.qualite_signataire ? ` (${sig.qualite_signataire})` : ""} le ${dateHeure(sig.date_signature)}, depuis l'adresse IP ${sig.ip || "inconnue"}.\n\n${ou}\n\nBaobab Marchés`,
      });
    } catch (e) {
      console.error(e);
    }
  }
  try {
    if (ligne.destinataire_email) {
      const fraiche = (await db.query(`SELECT * FROM portail_partage WHERE id = $1`, [ligne.id])).rows[0];
      const buf = await rendrePdf(fraiche);
      await mailer.envoyerEmailAvecPieceJointe({
        destinataire: ligne.destinataire_email,
        sujet: `${libelle} - copie signée`,
        message: `Bonjour ${sig.nom_signataire},\n\nNous vous confirmons la signature de ${DOCS[ligne.type_document].art} ${ligne.numero_document} le ${dateHeure(sig.date_signature)}. Vous trouverez ci-joint votre copie signée, avec son certificat de signature.\n\nCordialement,\n${params.raison_sociale || "Baobab Marchés"}`,
        pieces: [{ nom: nomPdf(ligne, true), contenu: buf, type: "application/pdf" }],
        repondreA: params.email || null,
        copie: params.email || null,
      });
      await journaliser(ligne.id, "COPIE_ENVOYEE", { details: { a: ligne.destinataire_email } });
    }
  } catch (e) {
    console.error(e);
  }
}

async function signer(ligne, corps, identifiantMasque, ctx) {
  if (ligne.statut === "SIGNE") throw new PortailError("PORTAIL_DEJA_SIGNE", 409);
  if (ligne.signature_requise === false) throw new PortailError("PORTAIL_SIGNATURE_NON_DEMANDEE", 409);
  const nom = String((corps && corps.nom) || "").trim();
  const qualite = String((corps && corps.qualite) || "").trim();
  if (nom.length < 3 || nom.length > 120) throw new PortailError("PORTAIL_NOM_REQUIS", 400);
  if (qualite.length > 120) throw new PortailError("PORTAIL_NOM_REQUIS", 400);
  if (!corps || corps.lu_approuve !== true) throw new PortailError("PORTAIL_ACCEPTATION_REQUISE", 400);
  const img = imageValide(corps.signature, 400 * 1024);
  if (!img) throw new PortailError("PORTAIL_SIGNATURE_INVALIDE", 400);
  const mode = corps.mode === "IMPORTEE" ? "IMPORTEE" : "DESSINEE";
  if (sha(jsonStable(ligne.snapshot_json)) !== ligne.empreinte_document) throw new PortailError("PORTAIL_DOCUMENT_ALTERE", 409);

  const client = await db.pool.connect();
  let signature;
  try {
    await client.query("BEGIN");
    const verrou = await client.query(`SELECT statut FROM portail_partage WHERE id = $1 FOR UPDATE`, [ligne.id]);
    if (!verrou.rows[0] || verrou.rows[0].statut !== "ACTIF") throw new PortailError(verrou.rows[0] && verrou.rows[0].statut === "SIGNE" ? "PORTAIL_DEJA_SIGNE" : "PORTAIL_LIEN_REVOQUE", 409);
    const ins = await client.query(
      `INSERT INTO portail_signature (id, partage_id, nom_signataire, qualite_signataire, mode, image_base64, image_mime, identifiant_masque, ip, user_agent, empreinte_document, empreinte_signature)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [uuidv4(), ligne.id, nom, qualite || null, mode, img.base64, img.mime, identifiantMasque || null, ctx.ip || null, ctx.ua ? String(ctx.ua).slice(0, 300) : null, ligne.empreinte_document, sha(img.base64)]
    );
    signature = ins.rows[0];
    await client.query(`UPDATE portail_partage SET statut = 'SIGNE', date_signature = $2 WHERE id = $1`, [ligne.id, signature.date_signature]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await journaliser(ligne.id, "SIGNE", { ...ctx, details: { nom, qualite: qualite || null } });

  // Effet sur le document lui-meme.
  const jour = new Date().toISOString().slice(0, 10);
  try {
    if (ligne.type_document === "OFFRE") {
      await oc.accepterOffre(ligne.document_id, { date_acceptation: jour, note: `Acceptée par signature électronique de ${nom} (portail, IP ${ctx.ip || "inconnue"})` });
    } else if (ligne.type_document === "CONTRAT") {
      await db.query(
        `UPDATE contrat_client SET statut = 'SIGNE', date_signature_client = $2, date_modification = now() WHERE id = $1 AND statut IN ('PREPARE', 'ENVOYE')`,
        [ligne.document_id, jour]
      );
    }
  } catch (e) {
    console.error(e);
    await journaliser(ligne.id, "ERREUR_APPLICATION", { details: { message: String(e.message || e).slice(0, 200) } });
  }
  notifierSignature(ligne, signature).catch((e) => console.error(e));
  return resumeSignature(signature);
}

module.exports = {
  PortailError,
  creerPartage,
  renouveler,
  revoquer,
  revoquerActifsDocument,
  lister,
  getPartage,
  documentVerrouille,
  pdfPourEditeur,
  infoPublique,
  acces,
  exigerSession,
  consulter,
  pdfPourClient,
  signer,
  jsonStable,
  sha,
  DOCS,
};
