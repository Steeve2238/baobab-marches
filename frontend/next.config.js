/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Limite a 1 seul processus de build (au lieu de paralleliser sur tous les
  // coeurs detectes) - necessaire sur l'hebergement mutualise O2switch, dont
  // le compte a un plafond strict de processus simultanes (CloudLinux LVE) :
  // sans cette limite, "next build" tente de lancer plusieurs processus
  // "jest-worker" en parallele et echoue avec `spawn ... EAGAIN` des la phase
  // "Collecting page data" (voir claude/resume_reprise_projet.md, chantier
  // migration O2switch). Sans effet notable sur la vitesse pour un projet de
  // cette taille (~90 pages).
  experimental: {
    cpus: 1,
  },
};

module.exports = nextConfig;
