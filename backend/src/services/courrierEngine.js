/**
 * Remplace les variables {{chemin.vers.valeur}} d'un gabarit de courrier par
 * les valeurs reelles d'un contexte (dossier, montants, dates...). Les
 * variables absentes du contexte sont clairement signalees dans le texte
 * rendu plutot que silencieusement laissees vides, pour que l'utilisateur
 * les remarque avant l'envoi.
 */
function resoudreChemin(contexte, chemin) {
  return chemin
    .split(".")
    .reduce((valeur, cle) => (valeur && valeur[cle] !== undefined ? valeur[cle] : undefined), contexte);
}

function rendreTemplate(template, contexte) {
  const variablesManquantes = [];

  const rendu = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, chemin) => {
    const valeur = resoudreChemin(contexte, chemin);
    if (valeur === undefined || valeur === null || valeur === "") {
      variablesManquantes.push(chemin);
      return `[${chemin} MANQUANT]`;
    }
    return String(valeur);
  });

  return { rendu, variablesManquantes };
}

/**
 * Construit le contexte standard disponible pour tout courrier genere a
 * partir d'un dossier (variables {{dossier.xxx}} toujours disponibles),
 * fusionne avec des variables complementaires fournies au moment de la
 * generation (ex: {{montant}}, {{delai_demande_jours}}...).
 */
function construireContexte(dossier, variablesComplementaires = {}) {
  return {
    dossier: {
      reference: dossier.reference_externe,
      intitule: dossier.intitule,
      montant_estime: dossier.montant_estime,
      devise: dossier.devise,
      maitre_ouvrage: dossier.maitre_ouvrage_nom,
      statut: dossier.statut,
      date_limite_soumission: dossier.date_limite_soumission
        ? new Date(dossier.date_limite_soumission).toLocaleDateString("fr-FR")
        : undefined,
    },
    date_jour: new Date().toLocaleDateString("fr-FR"),
    ...variablesComplementaires,
  };
}

module.exports = { rendreTemplate, construireContexte };
