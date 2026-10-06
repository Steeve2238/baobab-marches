/**
 * Echeanciers de paiement (06/10/2026) : conditions de paiement structurees des
 * clients (ce que nous leur accordons) et des fournisseurs (ce qu'ils nous
 * accordent). Un echeancier est une liste de lignes
 *   { pourcentage, evenement, jours, libelle? }
 * dont la somme des pourcentages vaut 100. Chaque ligne se lit :
 * « X % a <evenement> + N jours ».
 *
 * La fiche (client / fournisseur) porte l'echeancier PAR DEFAUT ; il est copie
 * sur chaque devis, facture ou commande, ou il reste modifiable sans toucher a
 * la fiche. Le plan de tresorerie lit l'echeancier du DOCUMENT.
 */

const EVENEMENTS = ["COMMANDE", "EXPEDITION", "ARRIVEE", "LIVRAISON", "FACTURATION", "RECEPTION"];

const LIBELLES = {
  fr: {
    COMMANDE: { court: "la commande", apres: "la commande" },
    EXPEDITION: { court: "l'expédition", apres: "l'expédition" },
    ARRIVEE: { court: "l'arrivée de la marchandise", apres: "l'arrivée de la marchandise" },
    LIVRAISON: { court: "la livraison", apres: "la livraison" },
    FACTURATION: { court: "la facturation", apres: "la facture" },
    RECEPTION: { court: "la réception", apres: "la réception" },
  },
  en: {
    COMMANDE: { court: "order", apres: "order" },
    EXPEDITION: { court: "shipment", apres: "shipment" },
    ARRIVEE: { court: "goods arrival", apres: "goods arrival" },
    LIVRAISON: { court: "delivery", apres: "delivery" },
    FACTURATION: { court: "invoicing", apres: "invoice" },
    RECEPTION: { court: "acceptance", apres: "acceptance" },
  },
};

// Modeles proposes a la saisie (generiques ; l'utilisateur les adapte).
const MODELES = {
  CLIENT: [
    { code: "CLI_COMMANDE", nom: "Paiement à la commande", lignes: [{ pourcentage: 100, evenement: "COMMANDE", jours: 0 }] },
    { code: "CLI_30_70_LIVRAISON", nom: "30 % à la commande, solde à la livraison", lignes: [{ pourcentage: 30, evenement: "COMMANDE", jours: 0 }, { pourcentage: 70, evenement: "LIVRAISON", jours: 0 }] },
    { code: "CLI_50_50_LIVRAISON", nom: "50 % à la commande, 50 % à la livraison", lignes: [{ pourcentage: 50, evenement: "COMMANDE", jours: 0 }, { pourcentage: 50, evenement: "LIVRAISON", jours: 0 }] },
    { code: "CLI_30_70_FACTURE_30", nom: "30 % à la commande, solde 30 jours après facture", lignes: [{ pourcentage: 30, evenement: "COMMANDE", jours: 0 }, { pourcentage: 70, evenement: "FACTURATION", jours: 30 }] },
    { code: "CLI_FACTURE_30", nom: "30 jours après facture", lignes: [{ pourcentage: 100, evenement: "FACTURATION", jours: 30 }] },
    { code: "CLI_FACTURE_60", nom: "60 jours après facture", lignes: [{ pourcentage: 100, evenement: "FACTURATION", jours: 60 }] },
    { code: "CLI_FACTURE_90", nom: "90 jours après facture", lignes: [{ pourcentage: 100, evenement: "FACTURATION", jours: 90 }] },
    { code: "CLI_LIVRAISON", nom: "Comptant à la livraison", lignes: [{ pourcentage: 100, evenement: "LIVRAISON", jours: 0 }] },
  ],
  FOURNISSEUR: [
    { code: "FOU_COMMANDE", nom: "Paiement comptant à la commande", lignes: [{ pourcentage: 100, evenement: "COMMANDE", jours: 0 }] },
    { code: "FOU_30_70_EXPEDITION", nom: "30 % à la commande, solde avant expédition", lignes: [{ pourcentage: 30, evenement: "COMMANDE", jours: 0 }, { pourcentage: 70, evenement: "EXPEDITION", jours: 0 }] },
    { code: "FOU_50_50_EXPEDITION", nom: "50 % à la commande, 50 % avant expédition", lignes: [{ pourcentage: 50, evenement: "COMMANDE", jours: 0 }, { pourcentage: 50, evenement: "EXPEDITION", jours: 0 }] },
    { code: "FOU_EXPEDITION", nom: "100 % avant expédition (crédit documentaire à vue)", lignes: [{ pourcentage: 100, evenement: "EXPEDITION", jours: 0 }] },
    { code: "FOU_ARRIVEE_30", nom: "30 jours après arrivée de la marchandise", lignes: [{ pourcentage: 100, evenement: "ARRIVEE", jours: 30 }] },
    { code: "FOU_FACTURE_30", nom: "30 jours après facture", lignes: [{ pourcentage: 100, evenement: "FACTURATION", jours: 30 }] },
    { code: "FOU_FACTURE_60", nom: "60 jours après facture", lignes: [{ pourcentage: 100, evenement: "FACTURATION", jours: 60 }] },
    { code: "FOU_30_70_ARRIVEE_30", nom: "30 % à la commande, solde 30 jours après arrivée", lignes: [{ pourcentage: 30, evenement: "COMMANDE", jours: 0 }, { pourcentage: 70, evenement: "ARRIVEE", jours: 30 }] },
  ],
};

function num(v) {
  if (v === undefined || v === null || v === "") return NaN;
  return Number(String(v).replace(/\s/g, "").replace(",", "."));
}

/**
 * Valide et normalise. Retourne { lignes } ou { erreur: "CLE_MESSAGE" }.
 * `lignes` peut venir sous forme de tableau ou de chaine JSON.
 */
function normaliser(brut) {
  let l = brut;
  if (typeof l === "string") {
    try {
      l = JSON.parse(l);
    } catch (e) {
      return { erreur: "ECHEANCIER_INVALIDE" };
    }
  }
  if (!Array.isArray(l) || l.length === 0) return { erreur: "ECHEANCIER_REQUIS" };
  if (l.length > 12) return { erreur: "ECHEANCIER_TROP_LIGNES" };
  const lignes = [];
  let somme = 0;
  for (const x of l) {
    const p = num(x && x.pourcentage);
    const j = x && x.jours !== undefined && x.jours !== "" ? num(x.jours) : 0;
    const ev = x && String(x.evenement || "").toUpperCase();
    if (!Number.isFinite(p) || p <= 0 || p > 100) return { erreur: "ECHEANCIER_POURCENTAGE" };
    if (!EVENEMENTS.includes(ev)) return { erreur: "ECHEANCIER_EVENEMENT" };
    if (!Number.isInteger(j) || j < 0 || j > 720) return { erreur: "ECHEANCIER_JOURS" };
    somme += p;
    const ligne = { pourcentage: Math.round(p * 100) / 100, evenement: ev, jours: j };
    const lib = x.libelle !== undefined && x.libelle !== null ? String(x.libelle).trim().slice(0, 120) : "";
    if (lib) ligne.libelle = lib;
    lignes.push(ligne);
  }
  if (Math.abs(somme - 100) > 0.01) return { erreur: "ECHEANCIER_TOTAL" };
  return { lignes };
}

function fmtPct(p) {
  return String(Math.round(Number(p) * 100) / 100).replace(".", ",");
}

/** Texte lisible : « 30 % à la commande ; 70 % 30 jours après la livraison ». */
function texte(lignes, lang = "fr") {
  if (!Array.isArray(lignes) || lignes.length === 0) return "";
  const L = LIBELLES[lang] || LIBELLES.fr;
  return lignes
    .map((x) => {
      const ev = L[x.evenement] || { court: x.evenement, apres: x.evenement };
      const j = Number(x.jours) || 0;
      if (lang === "en") {
        return j === 0 ? `${fmtPct(x.pourcentage)}% at ${ev.court}` : `${fmtPct(x.pourcentage)}% ${j} day${j > 1 ? "s" : ""} after ${ev.apres}`;
      }
      return j === 0 ? `${fmtPct(x.pourcentage)} % à ${ev.court}` : `${fmtPct(x.pourcentage)} % ${j} jour${j > 1 ? "s" : ""} après ${ev.apres}`;
    })
    .join(" ; ");
}

/** Lit la colonne JSONB (deja objet avec pg) en tableau ou null. */
function lire(valeur) {
  if (!valeur) return null;
  if (Array.isArray(valeur)) return valeur.length ? valeur : null;
  try {
    const v = JSON.parse(valeur);
    return Array.isArray(v) && v.length ? v : null;
  } catch (e) {
    return null;
  }
}

module.exports = { EVENEMENTS, MODELES, normaliser, texte, lire, LIBELLES };
