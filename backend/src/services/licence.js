/**
 * Licences de la version installable (chantier du 07/10/2026, voir
 * claude/cadrage_futur_version_installee_licence_07102026.md).
 *
 * Une licence est une cle de texte signee (Ed25519) : "BAOBAB-LIC1.<donnees>.<signature>" ou <donnees> est le JSON
 * de la licence encode en base64url. La cle PRIVEE de signature reste sur le serveur du Super Admin (variable
 * d'environnement LICENCE_PRIVATE_KEY_B64, jamais en base ni dans le depot) ; l'application installee chez le client
 * ne contiendra que la cle PUBLIQUE : elle peut verifier une licence mais pas en fabriquer une, et une cle modifiee a
 * la main est refusee.
 */
const crypto = require("crypto");

const PREFIXE = "BAOBAB-LIC1.";

function enB64u(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function deB64u(s) {
  const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64");
}

/** Genere une nouvelle paire de cles (a faire UNE fois, voir scripts/generer-cles-licence.js). */
function genererPaireCles() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privee_pem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publique_pem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

/** Cle privee de signature configuree sur ce serveur (PEM), ou null. */
function chargerClePrivee() {
  const b64 = process.env.LICENCE_PRIVATE_KEY_B64;
  if (!b64) return null;
  try {
    const pem = Buffer.from(b64, "base64").toString("utf8");
    crypto.createPrivateKey(pem); // valide le format
    return pem;
  } catch (_err) {
    return null;
  }
}

/** Cle publique correspondante (PEM), derivee de la cle privee configuree, ou null. */
function clePubliqueConfiguree() {
  const privee = chargerClePrivee();
  if (!privee) return null;
  return crypto.createPublicKey(privee).export({ type: "spki", format: "pem" });
}

/** Signe un objet de licence et renvoie la cle de texte. Lance une erreur code "SANS_CLE" si aucune cle privee. */
function signerLicence(payload) {
  const privee = chargerClePrivee();
  if (!privee) {
    const err = new Error("Cle de signature des licences non configuree");
    err.code = "SANS_CLE";
    throw err;
  }
  const donnees = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = crypto.sign(null, donnees, crypto.createPrivateKey(privee));
  return `${PREFIXE}${enB64u(donnees)}.${enB64u(signature)}`;
}

/**
 * Verifie une cle de licence avec une cle publique (PEM). Renvoie { valide, payload, erreur }.
 * Ne controle PAS les dates (a faire par l'appelant, voir etatLicence).
 */
function verifierLicence(cle, publiquePem) {
  try {
    const texte = String(cle || "").trim().replace(/\s+/g, "");
    if (!texte.startsWith(PREFIXE)) return { valide: false, erreur: "FORMAT" };
    const [donneesB64, signatureB64] = texte.slice(PREFIXE.length).split(".");
    if (!donneesB64 || !signatureB64) return { valide: false, erreur: "FORMAT" };
    const donnees = deB64u(donneesB64);
    const ok = crypto.verify(null, donnees, crypto.createPublicKey(publiquePem), deB64u(signatureB64));
    if (!ok) return { valide: false, erreur: "SIGNATURE" };
    return { valide: true, payload: JSON.parse(donnees.toString("utf8")) };
  } catch (_err) {
    return { valide: false, erreur: "FORMAT" };
  }
}

const JOURS_GRACE = 30;

/**
 * Etat d'une licence a une date donnee : ACTIVE (avant la fin), GRACE (jusqu'a 30 jours apres la fin : tout
 * fonctionne, avertissement), LECTURE_SEULE (au-dela : consultation seule, plus de saisie), NON_COMMENCEE.
 * "aujourdhui" au format AAAA-MM-JJ.
 */
function etatLicence(payload, aujourdhui) {
  const jour = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const auj = jour(aujourdhui);
  if (auj < jour(payload.debut)) return { etat: "NON_COMMENCEE", jours_restants: null };
  const fin = jour(payload.fin);
  const joursApresFin = Math.floor((auj - fin) / 86400000);
  if (joursApresFin <= 0) return { etat: "ACTIVE", jours_restants: -joursApresFin };
  if (joursApresFin <= JOURS_GRACE) return { etat: "GRACE", jours_grace_restants: JOURS_GRACE - joursApresFin };
  return { etat: "LECTURE_SEULE", jours_depuis_fin: joursApresFin };
}

module.exports = {
  PREFIXE,
  JOURS_GRACE,
  genererPaireCles,
  chargerClePrivee,
  clePubliqueConfiguree,
  signerLicence,
  verifierLicence,
  etatLicence,
};
