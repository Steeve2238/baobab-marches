/**
 * Envoi d'email - utilise pour l'instant uniquement pour la reinitialisation
 * de mot de passe ("mot de passe oublie", voir routes/auth.js et
 * routes/superAdmin.js). Demande explicite de Steeve le 06/09/2026.
 *
 * Configuration via un compte email cree dans cPanel (O2switch) - voir
 * "Comptes E-mail" - plutot qu'un service tiers (Brevo, SendGrid, etc.),
 * choix explicite de Steeve pour ne pas dependre d'un service externe
 * supplementaire. Variables d'environnement necessaires (a ajouter dans
 * "Setup Node.js App" comme DATABASE_URL/JWT_SECRET) :
 *   SMTP_HOST       - ex: mail.ymsgroupe.com (voir "Comptes E-mail" -> "Se
 *                     connecter" -> parametres de messagerie pour la valeur
 *                     exacte fournie par O2switch)
 *   SMTP_PORT       - 465 (SSL) ou 587 (STARTTLS)
 *   SMTP_SECURE     - "true" si port 465, "false" si port 587
 *   SMTP_USER       - adresse complete, ex: noreply@ymsgroupe.com
 *   SMTP_PASSWORD   - mot de passe de ce compte email
 *   SMTP_FROM_NAME  - nom affiche comme expediteur, ex: "Baobab Marches"
 *   FRONTEND_URL    - ex: https://baobabmarches.ymsgroupe.com (sans slash
 *                     final), utilise pour construire le lien cliquable dans
 *                     l'email
 *
 * Tant que ces variables ne sont pas configurees, envoyerEmailReinitialisation
 * echoue (rejette la promesse) - les routes appelantes doivent l'attraper et
 * logger l'erreur sans jamais revenir a l'utilisateur avec un message qui
 * confirmerait ou infirmerait l'existence d'un compte pour l'email fourni.
 */
const nodemailer = require("nodemailer");

let transporteur = null;

function obtenirTransporteur() {
  if (transporteur) return transporteur;

  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    throw new Error(
      "Configuration SMTP manquante (SMTP_HOST/SMTP_USER/SMTP_PASSWORD) - voir backend/src/utils/mailer.js"
    );
  }

  transporteur = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 465,
    secure: SMTP_SECURE !== "false", // true par defaut (port 465/SSL)
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });

  return transporteur;
}

/**
 * Envoie l'email de reinitialisation de mot de passe. Le lien pointe vers la
 * page de reinitialisation cote frontend (client ou Super Admin selon
 * l'appelant), avec le jeton en clair dans l'URL (seul son empreinte SHA-256
 * est stockee en base - voir routes/auth.js).
 */
async function envoyerEmailReinitialisation({ destinataire, prenom, lienReinitialisation }) {
  const nomExpediteur = process.env.SMTP_FROM_NAME || "Baobab Marches";
  const transport = obtenirTransporteur();

  const sujet = "Reinitialisation de votre mot de passe - Baobab Marches";
  const texte = `Bonjour ${prenom || ""},

Vous avez demande la reinitialisation de votre mot de passe sur Baobab Marches.

Cliquez sur le lien suivant pour choisir un nouveau mot de passe (valable 1 heure) :
${lienReinitialisation}

Si vous n'etes pas a l'origine de cette demande, vous pouvez ignorer cet email : votre mot de passe actuel reste inchange.`;

  const html = `
    <p>Bonjour ${prenom || ""},</p>
    <p>Vous avez demande la reinitialisation de votre mot de passe sur <strong>Baobab Marches</strong>.</p>
    <p><a href="${lienReinitialisation}" style="background:#0F3D44;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;">Choisir un nouveau mot de passe</a></p>
    <p style="font-size:12.5px;color:#666;">Ce lien est valable 1 heure. Si vous n'etes pas a l'origine de cette demande, ignorez cet email : votre mot de passe actuel reste inchange.</p>
  `;

  await transport.sendMail({
    from: `"${nomExpediteur}" <${process.env.SMTP_USER}>`,
    to: destinataire,
    subject: sujet,
    text: texte,
    html,
  });
}

module.exports = { envoyerEmailReinitialisation };
