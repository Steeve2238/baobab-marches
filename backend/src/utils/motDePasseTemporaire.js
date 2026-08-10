/**
 * Generation d'un mot de passe temporaire humainement communicable (par
 * telephone ou de vive voix), utilise a la creation d'un utilisateur et a la
 * reinitialisation de mot de passe (voir routes/utilisateurs.js).
 *
 * Inspire du format utilise sur OGAA ("Prenom@2026"), avec un suffixe
 * numerique en plus : le format OGAA pur est identique pour tous les
 * utilisateurs crees la meme annee (donc devinable), le suffixe aleatoire
 * corrige ça sans sacrifier la lisibilite/memorisabilite.
 */
function genererMotDePasseTemporaire(prenom) {
  const lettres = (prenom || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // retire les accents (e.g. "é" -> "e")
    .replace(/[^a-zA-Z]/g, "");

  const prenomNettoye = lettres
    ? lettres.charAt(0).toUpperCase() + lettres.slice(1).toLowerCase()
    : "Utilisateur";

  const annee = new Date().getFullYear();
  const suffixe = Math.floor(10 + Math.random() * 90); // 2 chiffres

  return `${prenomNettoye}@${annee}${suffixe}`;
}

module.exports = { genererMotDePasseTemporaire };
