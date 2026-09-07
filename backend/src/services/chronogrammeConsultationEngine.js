/**
 * Generation automatique du chronogramme d'une consultation (Module
 * Ventes/Negoce). Confirme avec Steeve le 07/09/2026 : reception de la
 * consultation -> collecte des offres fournisseurs/logistique -> calcul du
 * prix de revient -> validation interne -> envoi du devis (J0 = date limite
 * de reponse). Contrairement au chronogramme d'un dossier d'AO (retro-
 * planning a offsets fixes en jours - J-7, J-5...), le delai d'une
 * consultation restreinte est tres variable (de quelques jours a plusieurs
 * semaines selon le client), donc les etapes intermediaires sont placees en
 * PROPORTION de la fenetre [date_reception -> date_limite_reponse] plutot
 * qu'a un nombre de jours fixe. Ne remplace pas la saisie manuelle (toujours
 * possible via POST /api/ventes/consultations/:id/chronogramme/taches) :
 * produit un jeu de taches de depart coherent, que l'utilisateur peut
 * ensuite ajuster.
 */

const ETAPES = [
  { fraction: 0, jalon: "J0", intitule: "Reception de la consultation" },
  { fraction: 0.35, jalon: null, intitule: "Collecte des offres fournisseurs / logistique" },
  { fraction: 0.6, jalon: null, intitule: "Calcul du prix de revient" },
  { fraction: 0.8, jalon: null, intitule: "Validation interne" },
  { fraction: 1, jalon: "J0 reponse", intitule: "Envoi du devis" },
];

/**
 * Ajoute un nombre (eventuellement fractionnaire, arrondi) de jours a une
 * date de depart, retourne une date ISO (YYYY-MM-DD).
 */
function ajouterJours(dateBase, jours) {
  const d = new Date(dateBase);
  d.setUTCDate(d.getUTCDate() + Math.round(jours));
  return d.toISOString().slice(0, 10);
}

/**
 * @param {object} consultation - ligne consultation (date_reception,
 *   date_limite_reponse)
 * @returns {Array<{intitule: string, jalon_relatif: string|null, date_echeance: string, ordre_affichage: number}>}
 * @throws {Error} DATE_LIMITE_REPONSE_REQUISE si la consultation n'a pas de
 *   date_limite_reponse renseignee.
 */
function genererChronogrammeConsultation(consultation) {
  const depart = consultation.date_reception;
  const j0 = consultation.date_limite_reponse;
  if (!j0) {
    throw new Error("DATE_LIMITE_REPONSE_REQUISE");
  }

  const totalJours = (new Date(j0) - new Date(depart)) / (1000 * 60 * 60 * 24);
  // Fenetre nulle ou negative (delai deja depasse, ou saisi par erreur avant
  // la reception) : toutes les etapes sont alignees sur J0 plutot que de
  // produire des dates incoherentes - l'utilisateur peut toujours corriger
  // les dates a la main ensuite.
  const fenetre = totalJours > 0 ? totalJours : 0;

  return ETAPES.map((etape, idx) => ({
    intitule: etape.intitule,
    jalon_relatif: etape.jalon,
    date_echeance: ajouterJours(depart, fenetre * etape.fraction),
    ordre_affichage: idx,
  }));
}

module.exports = { genererChronogrammeConsultation };
