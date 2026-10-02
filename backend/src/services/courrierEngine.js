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

/**
 * Equivalent de construireContexte ci-dessus, mais pour un dossier de
 * Consultation restreinte (chantier du 02/10/2026, demande de Steeve : "le
 * client veut avoir la possibilite de faire les courriers comme avec les
 * appels d'offres"). Reutilise expres les MEMES cles {{dossier.xxx}} que
 * construireContexte pour qu'un modele de courrier existant (ecrit pour un
 * dossier AO) fonctionne sans modification sur une consultation restreinte -
 * seule la provenance des valeurs change :
 *   - reference      : le numero du devis le plus recent lie a cette
 *                       consultation (une consultation elle-meme n'a pas de
 *                       numero propre) - absent si aucun devis n'existe
 *                       encore, signale comme toute variable manquante.
 *   - intitule        : l'objet de la consultation.
 *   - montant_estime  : le total TTC du devis le plus recent, si disponible.
 *   - maitre_ouvrage   : reutilise pour porter le nom du CLIENT (l'equivalent
 *                       du maitre d'ouvrage cote appel d'offres - le tiers a
 *                       qui le courrier s'adresse).
 *   - date_limite_soumission : n'existe pas pour une consultation restreinte,
 *                       volontairement laissee absente plutot que de la
 *                       detourner d'un sens different.
 * Ajoute en plus {{dossier.date_reception}}, propre a la consultation
 * restreinte (date a laquelle la demande du client a ete recue).
 */
function construireContexteConsultation(consultation, devisPlusRecent, variablesComplementaires = {}) {
  return {
    dossier: {
      reference: devisPlusRecent ? devisPlusRecent.numero : undefined,
      intitule: consultation.objet,
      montant_estime: devisPlusRecent ? devisPlusRecent.total_ttc : undefined,
      devise: "XOF",
      maitre_ouvrage: consultation.client_nom,
      statut: consultation.statut,
      date_reception: consultation.date_reception
        ? new Date(consultation.date_reception).toLocaleDateString("fr-FR")
        : undefined,
    },
    date_jour: new Date().toLocaleDateString("fr-FR"),
    ...variablesComplementaires,
  };
}

module.exports = { rendreTemplate, construireContexte, construireContexteConsultation };
