/**
 * Tables de lecture du COFI (Code d'Identification Fiscale) - 3 caracteres qui suivent le NINEA sur
 * l'identifiant fiscal unique senegalais, ex. "0001462 2G3".
 *
 * Source : guide "Comprendre le NINEA" du cabinet NKAC Audit (https://nkac-audit.com), recoupe le 07/10/2026.
 * Le CGI 2025 ne decrit pas cette structure. Chaque entree porte un indicateur `confirme` :
 *   - true  : valeur confirmee par la source ;
 *   - false : valeur donnee a titre d'exemple par la source / saisie par Steeve, a confirmer avec la DGID.
 * Le decodeur n'invente JAMAIS une valeur absente de ces tables : un code inconnu est affiche tel quel
 * ("code non reconnu") et peut etre ajoute ici sans toucher au reste du programme.
 */

// 1er caractere (chiffre) : regime fiscal
const REGIMES = {
  0: { regime: "REEL", assujetti_tva: false, libelle: "Régime du réel, non assujetti à la TVA", confirme: true },
  1: { regime: "CGU", assujetti_tva: false, libelle: "Contribution globale unique (CGU)", confirme: true },
  2: { regime: "REEL", assujetti_tva: true, libelle: "Régime du réel, assujetti à la TVA", confirme: true },
};

// 2e caractere (lettre) : centre fiscal de rattachement. Liste a completer.
const CENTRES = {
  G: { libelle: "Centre des grandes entreprises (DGE)", confirme: true },
  D: { libelle: "Dakar (centre à préciser)", confirme: false },
};

// 3e caractere (chiffre) : forme juridique. Liste a completer.
const FORMES_JURIDIQUES = {
  1: { libelle: "Entreprise individuelle", confirme: false },
  2: { libelle: "SARL", confirme: false },
  3: { libelle: "Société anonyme (SA)", confirme: true },
};

module.exports = { REGIMES, CENTRES, FORMES_JURIDIQUES };
