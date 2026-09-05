// Serveur Node.js personnalise pour Next.js, necessaire pour faire tourner le
// frontend sous cPanel "Setup Node.js App" (Phusion Passenger) sur O2switch,
// exactement comme backend/src/index.js le fait deja pour le backend Express.
// Passenger demarre ce fichier et attend une application qui ecoute sur
// process.env.PORT - `next start` seul ne convient pas car Passenger ne sait
// pas lancer un binaire CLI, il a besoin d'un fichier JS unique en point
// d'entree (voir backend/src/index.js pour le meme principe cote API).
//
// IMPORTANT (voir claude/resume_reprise_projet.md, chantier migration
// O2switch) : les variables NEXT_PUBLIC_* sont figees par Next.js au moment
// du `npm run build`, jamais relues au demarrage. Ce fichier ne fait que
// SERVIR le build deja genere - la variable NEXT_PUBLIC_API_URL doit donc
// etre exportee AVANT de lancer `npm run build`, pas seulement configuree ici
// ou dans l'UI cPanel.
const { createServer } = require("http");
const next = require("next");

const port = parseInt(process.env.PORT, 10) || 3000;
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    handle(req, res);
  }).listen(port, () => {
    console.log(`Baobab Marches frontend demarre sur le port ${port}`);
  });
});
