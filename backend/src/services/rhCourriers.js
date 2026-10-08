/**
 * Courriers RH : attestations, certificats, lettres disciplinaires, convocations, solde de tout compte, courrier libre...
 * Chaque type a : un format (ATTESTATION / LETTRE / RECU), des champs a saisir et un texte par defaut a variables {xxx}.
 * Le client peut modifier l'objet et le texte de chaque type (table rh_modele_courrier).
 * Les textes par defaut sont une BASE DE TRAVAIL a faire relire par un conseil en droit du travail : ils ne citent
 * aucune duree legale (preavis, delais) qui doit etre precisee par l'entreprise selon le Code du travail et sa convention.
 */
const { montantEnLettres, premiereLettreMajuscule } = require("../utils/montantEnLettres");
const { dateLongue, civilite, libelleCategorie } = require("./rhContratModeles");

const POINTS = "……………………";
const fmtNombre = (n) => new Intl.NumberFormat("fr-FR").format(Number(n) || 0).replace(/[\u202f\u00a0]/g, " ");

const T = (name, requis) => ({ name, type: "text", requis: Boolean(requis) });
const A = (name, requis) => ({ name, type: "textarea", requis: Boolean(requis) });
const D = (name, requis) => ({ name, type: "date", requis: Boolean(requis) });
const H = (name) => ({ name, type: "time", requis: false });
const I = (name, requis) => ({ name, type: "int", requis: Boolean(requis) });

// accuse : cadre de remise a signer par le salarie sur le PDF ("RECEPTION" ou "SOLDE")
const TYPES = {
  ATTESTATION_TRAVAIL: {
    format: "ATTESTATION", champs: [], accuse: null,
    objet: "ATTESTATION DE TRAVAIL",
    paragraphes: [
      "Je soussigné, {representant}, {qualite_representant} de {employeur}, atteste que {travailleur}, {ne} le {date_naissance} à {lieu_naissance}, est {employe} au sein de notre entreprise depuis le {date_embauche}, en qualité de {fonction}.",
      "Cette attestation est délivrée à {interesse} pour servir et valoir ce que de droit.",
    ],
  },
  CERTIFICAT_TRAVAIL: {
    format: "ATTESTATION", champs: [D("date_sortie", true)], accuse: null,
    objet: "CERTIFICAT DE TRAVAIL",
    paragraphes: [
      "Je soussigné, {representant}, {qualite_representant} de {employeur}, certifie que {travailleur}, {ne} le {date_naissance} à {lieu_naissance}, a été {employe} au sein de notre entreprise du {date_embauche} au {date_sortie}, en qualité de {fonction}.",
      "{il_elle_maj} nous quitte libre de tout engagement.",
      "Le présent certificat est délivré à {interesse} pour servir et valoir ce que de droit.",
    ],
  },
  ATTESTATION_SALAIRE: {
    format: "ATTESTATION", champs: [], accuse: null, lignes: true,
    objet: "ATTESTATION DE SALAIRE",
    paragraphes: [
      "Je soussigné, {representant}, {qualite_representant} de {employeur}, atteste que {travailleur}, {employe} depuis le {date_embauche} en qualité de {fonction}, perçoit une rémunération mensuelle brute de {total} F CFA ({total_lettres}), décomposée comme suit :",
      "{LIGNES}",
      "Cette attestation est délivrée à {interesse} pour servir et valoir ce que de droit.",
    ],
  },
  DOMICILIATION_SALAIRE: {
    format: "ATTESTATION", champs: [T("banque", true), T("numero_compte", true)], accuse: null,
    objet: "ATTESTATION DE DOMICILIATION DE SALAIRE",
    paragraphes: [
      "Je soussigné, {representant}, {qualite_representant} de {employeur}, atteste que {travailleur}, {employe} depuis le {date_embauche} en qualité de {fonction}, perçoit son salaire par virement sur le compte n° {numero_compte} ouvert auprès de {banque}.",
      "Nous nous engageons à maintenir cette domiciliation jusqu'à notification contraire de la banque ou de {interesse}.",
    ],
  },
  DEMANDE_EXPLICATION: {
    format: "LETTRE", accuse: "RECEPTION", reponse: true,
    champs: [D("date_faits", true), A("faits", true), D("date_limite", true)],
    objet: "Demande d'explication",
    paragraphes: [
      "Nous avons constaté que, le {date_faits}, les faits suivants se sont produits : {faits}",
      "Ces faits étant susceptibles de constituer un manquement à vos obligations professionnelles, nous vous demandons de bien vouloir nous fournir vos explications par écrit au plus tard le {date_limite}.",
      "Nous vous précisons qu'aucune décision n'est prise à ce stade et que vos explications seront examinées avec attention.",
    ],
  },
  AVERTISSEMENT: {
    format: "LETTRE", accuse: "RECEPTION",
    champs: [D("date_faits", true), A("faits", true)],
    objet: "Avertissement",
    paragraphes: [
      "Nous avons constaté que, le {date_faits}, les faits suivants se sont produits : {faits}",
      "Ces faits constituent un manquement à vos obligations professionnelles. Nous vous notifions par la présente un avertissement.",
      "Nous vous invitons à vous conformer strictement à vos obligations. À défaut, nous pourrions être amenés à envisager des mesures plus sévères, dans le respect des dispositions du Code du travail, de la convention collective et du règlement intérieur.",
    ],
  },
  MISE_A_PIED: {
    format: "LETTRE", accuse: "RECEPTION",
    champs: [D("date_faits", true), A("faits", true), D("date_debut", true), D("date_fin", true)],
    objet: "Notification de mise à pied disciplinaire",
    paragraphes: [
      "Nous avons constaté que, le {date_faits}, les faits suivants se sont produits : {faits}",
      "Ces faits constituant une faute, nous vous notifions une mise à pied disciplinaire du {date_debut} au {date_fin} inclus. Cette période n'est pas rémunérée.",
      "Vous reprendrez votre poste à l'issue de cette période, sauf indication contraire de notre part. Nous attendons de vous le strict respect de vos obligations professionnelles.",
    ],
  },
  CONVOCATION_ENTRETIEN: {
    format: "LETTRE", accuse: "RECEPTION",
    champs: [D("date_entretien", true), H("heure"), T("lieu_entretien"), A("objet_entretien", true)],
    objet: "Convocation à un entretien préalable",
    paragraphes: [
      "Nous vous prions de bien vouloir vous présenter à un entretien le {date_entretien} à {heure}, à l'adresse suivante : {lieu_entretien}.",
      "Cet entretien portera sur : {objet_entretien}",
      "Vous pouvez vous faire assister, lors de cet entretien, par une personne de votre choix, dans les conditions prévues par la réglementation et le règlement intérieur.",
    ],
  },
  LICENCIEMENT: {
    format: "LETTRE", accuse: "RECEPTION",
    champs: [A("motif", true), D("date_effet", true)],
    objet: "Notification de licenciement",
    paragraphes: [
      "Après examen de votre situation et suite à l'entretien préalable, nous sommes au regret de vous notifier notre décision de mettre fin à votre contrat de travail pour le motif suivant : {motif}",
      "Votre contrat prendra fin le {date_effet}, sous réserve des dispositions relatives au préavis prévues par le Code du travail et la convention collective applicable.",
      "À votre départ, votre certificat de travail et votre solde de tout compte vous seront remis dans les conditions prévues par la réglementation.",
    ],
  },
  ACCEPTATION_DEMISSION: {
    format: "LETTRE", accuse: "RECEPTION",
    champs: [D("date_demission", true), D("date_effet", true)],
    objet: "Prise d'acte de votre démission",
    paragraphes: [
      "Nous avons bien reçu votre lettre de démission datée du {date_demission} et en prenons acte.",
      "Votre contrat de travail prendra fin le {date_effet}, sous réserve des dispositions relatives au préavis prévues par le Code du travail et la convention collective applicable.",
      "Votre certificat de travail et votre solde de tout compte vous seront remis à votre départ.",
    ],
  },
  CONFIRMATION_EMBAUCHE: {
    format: "LETTRE", accuse: "RECEPTION",
    champs: [D("date_effet", true)],
    objet: "Confirmation de votre engagement",
    paragraphes: [
      "Nous avons le plaisir de vous informer qu'à l'issue de votre période d'essai, votre engagement en qualité de {fonction} est confirmé à compter du {date_effet}.",
      "Les autres clauses de votre contrat de travail demeurent inchangées.",
    ],
  },
  CHANGEMENT_POSTE: {
    format: "LETTRE", accuse: "RECEPTION",
    champs: [T("ancien_poste"), T("nouveau_poste", true), T("nouvelle_categorie"), D("date_effet", true)],
    objet: "Notification de changement de poste",
    paragraphes: [
      "Nous avons le plaisir de vous informer que, à compter du {date_effet}, vous exercerez les fonctions de {nouveau_poste}{nouvelle_categorie_txt}, en remplacement de vos fonctions de {ancien_poste}.",
      "Les modalités de ce changement, notamment sur la rémunération, feront l'objet d'un avenant à votre contrat de travail, le cas échéant.",
    ],
  },
  AUTORISATION_CONGE: {
    format: "LETTRE", accuse: null,
    champs: [D("date_debut", true), D("date_fin", true), I("nb_jours"), D("date_reprise")],
    objet: "Décision de congé",
    paragraphes: [
      "Suite à votre demande, nous vous informons que votre congé est accordé du {date_debut} au {date_fin} inclus ({nb_jours} jour(s)).",
      "Vous reprendrez votre poste le {date_reprise}.",
    ],
  },
  SOLDE_TOUT_COMPTE: {
    format: "RECU", accuse: "SOLDE", lignes: true,
    champs: [D("date_sortie", true), T("mode_paiement")],
    objet: "REÇU POUR SOLDE DE TOUT COMPTE",
    paragraphes: [
      "Je soussigné, {travailleur}, {employe} par {employeur} en qualité de {fonction} du {date_embauche} au {date_sortie}, reconnais avoir reçu de mon employeur la somme de {total} F CFA ({total_lettres}), par {mode_paiement}, représentant le solde de tout compte, décomposé comme suit :",
      "{LIGNES}",
      "Ce paiement solde l'ensemble des sommes dues au titre de l'exécution et de la cessation de mon contrat de travail, sous réserve des droits que la loi me reconnaît.",
    ],
  },
  LIBRE: {
    format: "LETTRE", accuse: null,
    champs: [T("objet_libre", true), A("corps_libre", true)],
    objet: "{objet_libre}",
    paragraphes: ["{corps_libre}"],
  },
};

const ORDRE_TYPES = Object.keys(TYPES);
const FORMULE_POLITESSE = "Veuillez agréer, {civilite_long}, l'expression de nos salutations distinguées.";

function formatChamp(def, valeur) {
  if (valeur == null || String(valeur).trim() === "") return "";
  if (def.type === "date") return dateLongue(valeur);
  if (def.type === "time") return String(valeur).replace(":", " h ");
  if (def.type === "int") return String(Number(valeur));
  return String(valeur).trim();
}

/** Variables de substitution : employeur, travailleur, champs saisis, totaux. */
function construireVariables(type, entete, emp, champs, lignes, dateCourrier) {
  const def = TYPES[type];
  const f = emp.sexe === "F";
  const total = (lignes || []).reduce((s, l) => s + (Number(l.montant) || 0), 0);
  const nom = [emp.prenom, emp.nom ? String(emp.nom).toUpperCase() : ""].filter(Boolean).join(" ");
  const civ = civilite(emp);
  const v = {
    employeur: entete.raison_sociale || POINTS,
    siege: entete.adresse || POINTS,
    representant: entete.signataire_nom || POINTS,
    qualite_representant: entete.signataire_titre || POINTS,
    travailleur: [civ, nom].filter(Boolean).join(" ") || POINTS,
    nom_complet: nom || POINTS,
    civilite_long: f ? "Madame" : "Monsieur",
    matricule: emp.matricule || POINTS,
    fonction: emp.poste || POINTS,
    classification: libelleCategorie(emp.categorie) || POINTS,
    convention: emp.convention_collective || POINTS,
    date_embauche: emp.date_embauche ? dateLongue(emp.date_embauche) : POINTS,
    date_naissance: emp.date_naissance ? dateLongue(emp.date_naissance) : POINTS,
    lieu_naissance: emp.lieu_naissance || POINTS,
    ville: "Dakar",
    date_courrier: dateLongue(dateCourrier || new Date()),
    ne: f ? "née" : "né",
    employe: f ? "employée" : "employé",
    interesse: f ? "l'intéressée" : "l'intéressé",
    il_elle: f ? "elle" : "il",
    il_elle_maj: f ? "Elle" : "Il",
    total: fmtNombre(total),
    total_lettres: total ? montantEnLettres(total) : POINTS,
    banque: POINTS,
    numero_compte: POINTS,
  };
  for (const c of def.champs) {
    const val = formatChamp(c, champs[c.name]);
    v[c.name] = val || POINTS;
  }
  v.nouvelle_categorie_txt = champs.nouvelle_categorie ? ` (catégorie ${champs.nouvelle_categorie})` : "";
  if (type === "SOLDE_TOUT_COMPTE" && !champs.mode_paiement) v.mode_paiement = "virement ou espèces";
  if (type === "AUTORISATION_CONGE") {
    if (!champs.nb_jours) v.nb_jours = POINTS;
    if (!champs.date_reprise) v.date_reprise = POINTS;
  }
  if (type === "DOMICILIATION_SALAIRE") {
    v.banque = champs.banque || emp.banque || POINTS;
    v.numero_compte = champs.numero_compte || emp.numero_compte || POINTS;
  }
  return v;
}

const remplacer = (texte, v) => String(texte).replace(/\{([a-z_A-Z]+)\}/g, (m, k) => (k in v ? v[k] : m));

/**
 * Compose le contenu du courrier a partir du modele (objet + paragraphes) et des champs saisis.
 * Retourne l'objet fige a la validation.
 */
function rediger(type, modele, entete, emp, champs, lignes, meta) {
  const def = TYPES[type];
  const v = construireVariables(type, entete, emp, champs, lignes, meta.date_courrier);
  const objet = remplacer(modele.objet, v);
  const paragraphes = [];
  let tableau = null;
  for (const p of modele.paragraphes) {
    const brut = String(p).trim();
    if (brut === "{LIGNES}") {
      if (def.lignes) tableau = true;
      continue;
    }
    paragraphes.push(remplacer(p, v));
  }
  const lignesOk = (lignes || []).filter((l) => String(l.libelle || "").trim() || Number(l.montant)).map((l) => ({ libelle: String(l.libelle || "").trim(), montant: Number(l.montant) || 0 }));
  const total = lignesOk.reduce((s, l) => s + l.montant, 0);
  return {
    version: 1,
    type,
    format: def.format,
    accuse: def.accuse,
    objet,
    numero: meta.numero || null,
    lieu: meta.lieu || "Dakar",
    date_courrier: meta.date_courrier,
    destinataire: {
      nom: v.travailleur,
      matricule: emp.matricule || null,
      fonction: emp.poste || null,
      adresse: [emp.adresse, emp.ville].filter(Boolean).join(", ") || null,
    },
    civilite_long: v.civilite_long,
    paragraphes,
    lignes: tableau ? lignesOk : [],
    total: tableau ? total : null,
    total_lettres: tableau && total ? premiereLettreMajuscule(montantEnLettres(total)) : null,
    formule: def.format === "LETTRE" ? remplacer(FORMULE_POLITESSE, v) : null,
    signataire: { nom: entete.signataire_nom || null, titre: entete.signataire_titre || null },
    employeur: entete.raison_sociale || null,
  };
}

/** Controles avant emission. Niveaux : BLOQUANT (emission refusee) / ATTENTION. */
function avertissements(type, entete, emp, champs, lignes) {
  const def = TYPES[type];
  const a = [];
  if (!emp.nom || !emp.prenom) a.push({ niveau: "BLOQUANT", code: "IDENTITE_INCOMPLETE" });
  for (const c of def.champs) {
    if (c.requis && !String(champs[c.name] == null ? "" : champs[c.name]).trim()) a.push({ niveau: "BLOQUANT", code: "CHAMP_REQUIS", valeur: c.name });
  }
  const lignesOk = (lignes || []).filter((l) => Number(l.montant) > 0);
  if (def.lignes && lignesOk.length === 0) a.push({ niveau: "BLOQUANT", code: "LIGNES_REQUISES" });
  if (!entete.raison_sociale) a.push({ niveau: "BLOQUANT", code: "ENTETE_RAISON_SOCIALE" });
  if (!entete.signataire_nom) a.push({ niveau: "ATTENTION", code: "ENTETE_SIGNATAIRE" });
  if (!entete.signature_cachet_base64) a.push({ niveau: "ATTENTION", code: "ENTETE_SIGNATURE_IMAGE" });
  if (!emp.date_embauche && ["ATTESTATION_TRAVAIL", "CERTIFICAT_TRAVAIL", "ATTESTATION_SALAIRE", "DOMICILIATION_SALAIRE", "SOLDE_TOUT_COMPTE"].includes(type)) a.push({ niveau: "ATTENTION", code: "DATE_EMBAUCHE" });
  if (!emp.date_naissance && ["ATTESTATION_TRAVAIL", "CERTIFICAT_TRAVAIL"].includes(type)) a.push({ niveau: "ATTENTION", code: "NAISSANCE" });
  if (!emp.poste && type !== "LIBRE") a.push({ niveau: "ATTENTION", code: "POSTE" });
  if (type === "DEMANDE_EXPLICATION" && champs.date_faits && champs.date_limite && champs.date_limite < champs.date_faits) a.push({ niveau: "BLOQUANT", code: "DATE_LIMITE" });
  if (type === "MISE_A_PIED" && champs.date_debut && champs.date_fin && champs.date_fin < champs.date_debut) a.push({ niveau: "BLOQUANT", code: "PERIODE" });
  if (type === "AUTORISATION_CONGE" && champs.date_debut && champs.date_fin && champs.date_fin < champs.date_debut) a.push({ niveau: "BLOQUANT", code: "PERIODE" });
  return a;
}

module.exports = { TYPES, ORDRE_TYPES, rediger, avertissements, construireVariables, remplacer, POINTS };
