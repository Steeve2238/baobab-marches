/**
 * Declaration de mouvement du travailleur (DMT) : rubriques du formulaire officiel (art. 222 du Code du travail,
 * arrete ministeriel n° 7301 du 17 mai 1963), prerempies depuis la fiche employe, le contrat et l'en-tete du client.
 */
const { dateLongue, iso, libelleCategorie } = require("./rhContratModeles");

const OBJETS = [
  "EMBAUCHE",
  "LICENCIEMENT_ECONOMIQUE",
  "EXPIRATION_CONTRAT",
  "DEMISSION",
  "MUTATION",
  "CHANGEMENT_CATEGORIE",
  "MODIFICATION_CONTRAT",
  "CHANGEMENT_SITUATION_FAMILLE",
  "CHANGEMENT_RESIDENCE",
  "CHANGEMENT_EMPLOI",
  "DECES",
];

const LIBELLES_OBJET = {
  EMBAUCHE: "Embauche",
  LICENCIEMENT_ECONOMIQUE: "Licenciement économique",
  EXPIRATION_CONTRAT: "Expiration normale du contrat",
  DEMISSION: "Démission",
  MUTATION: "Mutation",
  CHANGEMENT_CATEGORIE: "Changement de catégorie professionnelle",
  MODIFICATION_CONTRAT: "Modification du contrat de travail",
  CHANGEMENT_SITUATION_FAMILLE: "Changement de situation de famille",
  CHANGEMENT_RESIDENCE: "Changement de résidence habituelle",
  CHANGEMENT_EMPLOI: "Changement d'emploi",
  DECES: "Décès",
};

const SITUATIONS = { CELIBATAIRE: "Célibataire", MARIE: "Marié(e)", DIVORCE: "Divorcé(e)", VEUF: "Veuf / veuve" };

function donneesDmt({ entete, emp, enfants, contrat, objet, enfantACharge, activite }) {
  const annee = new Date().getFullYear();
  const aCharge = (enfants || []).filter((e) => enfantACharge(e, annee));
  const c = contrat || null;
  const elements = c ? (c.elements_json || []).map((l) => ({ libelle: l.libelle, montant: Number(l.montant) || 0 })) : [];
  const duree = c ? (c.type === "CDD" ? "CDD" : "CDI") : /CDD/i.test(emp.type_contrat || "") ? "CDD" : "CDI";
  return {
    objet,
    precision_objet: "",
    nom: emp.nom ? String(emp.nom).toUpperCase() : "",
    prenoms: emp.prenom || "",
    sexe: emp.sexe === "F" ? "Féminin" : emp.sexe === "M" ? "Masculin" : "",
    date_naissance: iso(emp.date_naissance),
    lieu_naissance: emp.lieu_naissance || "",
    pays_naissance: emp.pays_naissance || "",
    nationalite: emp.nationalite || "",
    pere: emp.pere_nom || "",
    mere: emp.mere_nom || "",
    groupe_ethnique: emp.groupe_ethnique || "",
    adresse: [emp.adresse, emp.ville].filter(Boolean).join(", "),
    piece_type: emp.piece_type || "",
    piece_numero: emp.piece_numero || "",
    piece_lieu: emp.piece_lieu || "",
    piece_date: iso(emp.piece_date),
    numero_css: emp.numero_css || "",
    numero_ipres: emp.numero_ipres || "",
    situation_familiale: SITUATIONS[emp.situation_familiale] || "",
    nombre_epouses: emp.situation_familiale === "MARIE" && emp.sexe !== "F" ? String(emp.nombre_epouses || 1) : "",
    noms_epouses: emp.situation_familiale === "MARIE" && emp.sexe !== "F" ? [emp.conjoint_prenom, emp.conjoint_nom].filter(Boolean).join(" ") : "",
    nombre_enfants: String(aCharge.length),
    noms_enfants: aCharge.map((e) => [e.prenom, e.nom].filter(Boolean).join(" ")).join(", "),
    date_entree: iso(emp.date_embauche) || (c ? iso(c.date_effet) : ""),
    declaration_numero: emp.numero_declaration_embauche || "",
    declaration_date: iso(emp.date_declaration_embauche),
    profession: (c && c.poste) || emp.poste || "",
    emploi: (c && c.poste) || emp.poste || "",
    convention: (c && c.convention) || emp.convention_collective || "",
    categorie: (c && c.categorie) || emp.categorie || "",
    date_debut_contrat: c ? iso(c.date_effet) : iso(emp.date_embauche),
    visa_inspecteur: "",
    visa_section_locale: "",
    employeur: [entete.raison_sociale, entete.adresse ? `(${entete.adresse})` : ""].filter(Boolean).join(" "),
    activite: activite || "",
    duree,
    date_debut: c ? iso(c.date_effet) : iso(emp.date_embauche),
    date_fin: c ? iso(c.date_fin) : iso(emp.date_fin_contrat),
    essai_mois: c && c.periode_essai_mois ? String(c.periode_essai_mois) : emp.periode_essai_mois ? String(emp.periode_essai_mois) : "",
    chantier: c && c.motif ? c.motif : "",
    precedent_employeur: emp.precedent_employeur || "",
    residence_habituelle: [emp.adresse, emp.ville].filter(Boolean).join(", "),
    date_entree_senegal: iso(emp.date_entree_senegal),
    mil_classe: "",
    mil_service: emp.statut_militaire || "",
    mil_armee: "",
    mil_grade: "",
    heures_hebdo: String(Number((c && c.heures_hebdo) || emp.heures_hebdo || 40)),
    elements,
    total_brut: elements.reduce((s, l) => s + l.montant, 0),
    categorie_texte: libelleCategorie((c && c.categorie) || emp.categorie),
  };
}

function avertissementsDmt(d) {
  const A = [];
  const att = (code, champ) => A.push({ niveau: "ATTENTION", code, champ });
  if (!d.nom || !d.prenoms) A.push({ niveau: "BLOQUANT", code: "IDENTITE_INCOMPLETE" });
  if (!d.date_naissance || !d.lieu_naissance) att("NAISSANCE", "date_naissance");
  if (!d.piece_numero) att("PIECE", "piece_numero");
  if (!d.numero_css || !d.numero_ipres) att("NUMEROS_SOCIAUX", "numero_css");
  if (!d.convention || !d.categorie) att("CONVENTION", "convention");
  if (!d.activite) att("ACTIVITE", "activite");
  if (d.duree === "CDD" && (!d.date_debut || !d.date_fin)) att("DATES_CDD", "date_fin");
  return A;
}

module.exports = { OBJETS, LIBELLES_OBJET, donneesDmt, avertissementsDmt };
