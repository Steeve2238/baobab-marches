/**
 * A lancer UNE SEULE FOIS, sur le serveur du Super Admin : node scripts/generer-cles-licence.js
 * Affiche la paire de cles de signature des licences.
 *  - LICENCE_PRIVATE_KEY_B64 : a mettre dans les variables d'environnement du backend (cPanel > Setup Node.js App).
 *    NE JAMAIS la committer ni la partager : qui la possede peut fabriquer des licences.
 *  - La cle publique sera embarquee dans la future version installable (elle ne permet que de verifier).
 * Sauvegarde la cle privee en lieu sur : si elle est perdue, toutes les licences deja emises devront etre reemises
 * avec une nouvelle paire.
 */
const { genererPaireCles } = require("../src/services/licence");

const { privee_pem, publique_pem } = genererPaireCles();
console.log("=== LICENCE_PRIVATE_KEY_B64 (secret, a mettre dans l'environnement du backend) ===");
console.log(Buffer.from(privee_pem, "utf8").toString("base64"));
console.log("\n=== Cle publique (a embarquer dans la version installable) ===");
console.log(publique_pem);
