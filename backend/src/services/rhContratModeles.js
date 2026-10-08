/**
 * Modeles de contrats de travail (CDI, CDD, journalier) et moteur de redaction.
 *
 * Un modele est une liste d'articles { titre, paragraphes[], remuneration? }. Les paragraphes contiennent des variables
 * entre accolades ({travailleur}, {date_effet}...) et peuvent commencer par une balise de condition :
 *   [ESSAI]      paragraphe retenu seulement s'il y a une periode d'essai ;
 *   [SANS_ESSAI] paragraphe retenu seulement s'il n'y en a pas.
 * Un article peut porter "si": "ESSAI" (article entier retenu seulement avec periode d'essai).
 * Un article "remuneration": true recoit le tableau des elements de remuneration.
 *
 * ATTENTION : textes rediges comme base de travail a partir du modele transmis par le client ; ils doivent etre relus
 * par un conseil en droit du travail avant usage. Aucune duree legale n'y est citee : le texte renvoie au Code du travail
 * et a la convention collective, et le controle des durees est fait par des avertissements a l'ecran.
 */
const { entierEnLettres, montantEnLettres, premiereLettreMajuscule } = require("../utils/montantEnLettres");

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const POINTS = "……………………";

const VARIABLES = [
  ["employeur", "Raison sociale de l'employeur"],
  ["siege", "Adresse du siège"],
  ["representant", "Représentant de l'employeur"],
  ["qualite_representant", "Qualité du représentant"],
  ["travailleur", "Civilité, prénom et nom du travailleur"],
  ["fonction", "Fonction / emploi"],
  ["classification", "Catégorie professionnelle"],
  ["convention", "Convention collective"],
  ["lieu_emploi", "Lieu d'emploi"],
  ["date_effet", "Date de prise d'effet"],
  ["date_fin", "Date de fin (CDD)"],
  ["motif", "Motif du CDD (précédé de « , »)"],
  ["essai", "Durée de la période d'essai en lettres"],
  ["heures", "Heures hebdomadaires"],
  ["date_contrat", "Date du contrat"],
  ["ville", "Lieu de signature"],
];

function iso(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : "";
}
function dateLongue(d) {
  const s = iso(d);
  if (!s) return "";
  const j = Number(s.slice(8, 10));
  return `${j === 1 ? "1er" : j} ${MOIS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
}

// --------------------------------------------------------------------------- modeles par defaut
const ART_OBJET = {
  titre: "Objet du contrat",
  paragraphes: [
    "Le présent contrat a pour objet de définir les droits et les obligations des contractants pendant la durée des fonctions que le travailleur exercera au service de {employeur}, au regard de la législation sociale sénégalaise (loi n° 97-17 du 1er décembre 1997 portant Code du travail), de la convention collective applicable ({convention}) et des règlements qui en découlent.",
  ],
};
const ART_POSTE = {
  titre: "Description du poste et lieu d'emploi",
  paragraphes: [
    "{travailleur}, qui accepte, exercera les fonctions de : {fonction}, classé(e) en {classification} de la convention collective {convention}.",
    "Ces fonctions sont susceptibles d'évolution eu égard au développement du service ; elles concernent tous les aspects s'attachant directement ou indirectement aux spécifications du poste et correspondent aux capacités du travailleur.",
    "Le lieu d'emploi est : {lieu_emploi}. Lorsque les nécessités du service l'exigent, le travailleur peut être affecté à un autre lieu de travail de l'entreprise, dans le respect de la législation et de la convention collective.",
  ],
};
const ART_CONDITIONS = {
  titre: "Conditions de service",
  paragraphes: [
    "Pendant la durée de validité du présent contrat, le travailleur s'engage à consacrer toute son activité professionnelle à son employeur, selon les directives qui lui seront données par écrit ou verbalement. Il respectera scrupuleusement les obligations relatives au secret professionnel, le règlement intérieur ainsi que les consignes de sécurité et d'hygiène, et prendra soin du matériel qui lui est confié.",
    "Le travailleur déclare n'être lié à aucun autre employeur et être libre de tout engagement pouvant porter préjudice à la bonne marche du service.",
  ],
};
const ART_HORAIRES = {
  titre: "Durée et horaires de travail",
  paragraphes: [
    "La durée du travail est fixée à {heures} heures par semaine. La répartition du temps de travail pourra être modifiée selon les nécessités de l'exploitation, dans le respect du contrat et de la réglementation en vigueur.",
    "Les heures effectuées au-delà de la durée légale sont des heures supplémentaires, accomplies à la demande de l'employeur et rémunérées conformément à la législation et à la convention collective.",
  ],
};
const ART_ESSAI = {
  titre: "Période d'essai",
  si: "ESSAI",
  paragraphes: [
    "Le travailleur est engagé à l'essai pour une période de {essai} à compter du {date_effet}.",
    "Pendant cette période, chacune des parties peut mettre fin au contrat sans préavis ni indemnité, par notification écrite, sous réserve des dispositions du Code du travail et de la convention collective applicable. À défaut de rupture avant le terme de l'essai, l'engagement devient définitif.",
  ],
};
const ART_CONGES = {
  titre: "Congés et absences",
  paragraphes: [
    "Le travailleur a droit aux congés payés et aux congés exceptionnels dans les conditions prévues par le Code du travail et la convention collective. Toute absence doit être justifiée et portée sans délai à la connaissance de l'employeur.",
  ],
};
const ART_SOCIAL = {
  titre: "Protection sociale et déclarations",
  paragraphes: [
    "L'employeur déclare le travailleur à l'Inspection du travail et de la sécurité sociale (déclaration d'embauche, déclaration de mouvement du travailleur), l'immatricule à la Caisse de sécurité sociale et à l'Institution de prévoyance retraite du Sénégal (IPRES) et verse les cotisations correspondantes.",
    "Le travailleur s'engage à fournir les pièces nécessaires (pièce d'identité, acte de naissance, pièces d'état civil des personnes à charge) et à signaler sans délai tout changement de sa situation de famille ou de sa résidence.",
  ],
};
const ART_LITIGES = {
  titre: "Litiges - contestations",
  paragraphes: [
    "Toutes contestations, tous litiges relatifs à l'interprétation ou à l'exécution du présent contrat doivent faire l'objet d'un règlement amiable. Au cas où un tel règlement ne peut être obtenu, compétence est donnée aux juridictions sociales de {ville}.",
  ],
};

const MODELES_DEFAUT = {
  CDI: [
    ART_OBJET,
    {
      titre: "Durée du contrat",
      paragraphes: [
        "Le présent contrat est conclu pour une durée indéterminée. Il prend effet à compter du {date_effet}.",
        "[ESSAI]Il comporte une période d'essai de {essai}, dans les conditions de l'article « Période d'essai » ci-après.",
      ],
    },
    ART_POSTE,
    ART_CONDITIONS,
    ART_HORAIRES,
    {
      titre: "Rémunération",
      remuneration: true,
      paragraphes: [
        "Le salaire brut mensuel est ainsi décomposé :",
        "Le salaire est payé mensuellement sur bulletin de paie, sous déduction des cotisations sociales et des retenues fiscales prévues par la loi. Il est revu conformément aux barèmes de la convention collective applicable.",
      ],
    },
    ART_ESSAI,
    ART_CONGES,
    ART_SOCIAL,
    {
      titre: "Rupture du contrat",
      paragraphes: [
        "Le contrat peut être rompu par l'une ou l'autre des parties dans les conditions prévues par le Code du travail et la convention collective, notamment en ce qui concerne le préavis et les indemnités éventuelles. Tout préavis est notifié par écrit.",
      ],
    },
    ART_LITIGES,
  ],
  CDD: [
    ART_OBJET,
    {
      titre: "Durée du contrat",
      paragraphes: [
        "Le présent contrat est conclu pour une durée déterminée, du {date_effet} au {date_fin}{motif}.",
        "Il prend fin de plein droit à son terme. Il ne peut être renouvelé ou prorogé que dans les limites et conditions prévues par le Code du travail et la convention collective applicable.",
        "[ESSAI]Il comporte une période d'essai de {essai}, dans les conditions de l'article « Période d'essai » ci-après.",
      ],
    },
    ART_POSTE,
    ART_CONDITIONS,
    ART_HORAIRES,
    {
      titre: "Rémunération",
      remuneration: true,
      paragraphes: [
        "Le salaire brut mensuel est ainsi décomposé :",
        "Le salaire est payé mensuellement sur bulletin de paie, sous déduction des cotisations sociales et des retenues fiscales prévues par la loi. Il est revu conformément aux barèmes de la convention collective applicable.",
      ],
    },
    ART_ESSAI,
    ART_CONGES,
    ART_SOCIAL,
    {
      titre: "Fin et rupture du contrat",
      paragraphes: [
        "Le contrat prend fin à son terme. Sa rupture anticipée n'est possible que dans les cas et conditions prévus par le Code du travail, notamment en cas de faute grave, de force majeure ou d'accord des parties.",
        "À l'échéance du terme, les sommes dues au travailleur au titre de l'exécution du contrat lui sont versées, et un certificat de travail lui est remis.",
      ],
    },
    ART_LITIGES,
  ],
  JOURNALIER: [
    ART_OBJET,
    {
      titre: "Nature et durée de l'engagement",
      paragraphes: [
        "Le travailleur est engagé en qualité de journalier à compter du {date_effet}. L'engagement est conclu jour par jour et prend fin à l'issue de chaque journée de travail, sous réserve des dispositions légales et conventionnelles applicables au travail journalier, notamment lorsque l'engagement se poursuit au-delà d'une certaine durée.",
      ],
    },
    {
      titre: "Fonctions et lieu d'emploi",
      paragraphes: [
        "{travailleur}, qui accepte, exercera les fonctions de : {fonction}, classé(e) en {classification} de la convention collective {convention}.",
        "Le lieu d'emploi est : {lieu_emploi}.",
      ],
    },
    ART_CONDITIONS,
    ART_HORAIRES,
    {
      titre: "Rémunération",
      remuneration: true,
      paragraphes: [
        "Le travailleur est rémunéré à la journée effectivement travaillée, aux conditions suivantes :",
        "Le salaire est payé à l'issue de chaque période de paie convenue, sur bulletin de paie, sous déduction des cotisations sociales et des retenues fiscales prévues par la loi.",
      ],
    },
    ART_SOCIAL,
    ART_LITIGES,
  ],
};

// --------------------------------------------------------------------------- contexte et redaction
function civilite(emp) {
  if (emp.civilite === "MME") return "Madame";
  if (emp.civilite === "MLLE") return "Mademoiselle";
  if (emp.civilite === "M") return "Monsieur";
  return emp.sexe === "F" ? "Madame" : emp.sexe === "M" ? "Monsieur" : "";
}

function libelleSituation(emp, nbEnfants) {
  const f = emp.sexe === "F";
  const base = {
    CELIBATAIRE: "Célibataire",
    MARIE: f ? "Mariée" : "Marié",
    DIVORCE: f ? "Divorcée" : "Divorcé",
    VEUF: f ? "Veuve" : "Veuf",
  }[emp.situation_familiale];
  if (!base) return "";
  const enf = nbEnfants === 0 ? "sans enfant" : nbEnfants === 1 ? "1 enfant à charge" : `${nbEnfants} enfants à charge`;
  return `${base} ${enf}`;
}

function libelleCategorie(cat) {
  if (!cat) return "";
  const c = String(cat).trim();
  return /cat[ée]gorie/i.test(c) ? c : `${c} catégorie`;
}

function nombreHeures(h) {
  const n = Number(h);
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

/**
 * Construit le contexte de redaction. entete = ligne tenant ; emp = fiche employe ; enfants = enfants ;
 * contrat = champs du contrat (date_effet, date_fin, periode_essai_mois, heures_hebdo, poste, lieu_emploi, convention,
 * categorie, motif, elements, date_contrat, lieu_signature, type).
 */
function construireContexte(entete, emp, enfants, contrat, enfantACharge) {
  const annee = new Date().getFullYear();
  const nbEnfants = (enfants || []).filter((e) => enfantACharge(e, annee)).length;
  const nom = [emp.prenom, emp.nom ? String(emp.nom).toUpperCase() : ""].filter(Boolean).join(" ");
  const travailleur = [civilite(emp), nom].filter(Boolean).join(" ") || POINTS;
  const naissance = [emp.date_naissance ? dateLongue(emp.date_naissance) : "", emp.lieu_naissance ? `à ${emp.lieu_naissance}` : ""].filter(Boolean).join(" ");
  const filiationLien = emp.sexe === "F" ? "Fille de" : "Fils de";
  const parents = [emp.pere_nom, emp.mere_nom ? `${emp.pere_nom ? "et de " : "de "}${emp.mere_nom}` : null].filter(Boolean).join(" ");
  const essaiMois = Number(contrat.periode_essai_mois) || 0;
  const lignes = (contrat.elements || []).map((l) => ({
    libelle: String(l.libelle || "").trim(),
    montant: Number(l.montant) || 0,
    essai: l.essai !== false,
  }));
  const totalApres = lignes.reduce((s, l) => s + l.montant, 0);
  const totalEssai = lignes.filter((l) => l.essai).reduce((s, l) => s + l.montant, 0);
  const sansEssai = lignes.filter((l) => !l.essai).map((l) => l.libelle);
  const ville = contrat.lieu_signature || "Dakar";
  const variables = {
    employeur: entete.raison_sociale || POINTS,
    siege: entete.adresse || POINTS,
    representant: entete.signataire_nom || POINTS,
    qualite_representant: entete.signataire_titre || POINTS,
    travailleur,
    fonction: contrat.poste || emp.poste || POINTS,
    classification: libelleCategorie(contrat.categorie || emp.categorie) || POINTS,
    convention: contrat.convention || emp.convention_collective || POINTS,
    lieu_emploi: contrat.lieu_emploi || emp.lieu_travail || POINTS,
    date_effet: contrat.date_effet ? dateLongue(contrat.date_effet) : POINTS,
    date_fin: contrat.date_fin ? dateLongue(contrat.date_fin) : POINTS,
    motif: contrat.motif ? `, ${String(contrat.motif).trim().replace(/^,\s*/, "")}` : "",
    essai: essaiMois ? `${entierEnLettres(essaiMois)} (${essaiMois}) mois` : "",
    heures: nombreHeures(contrat.heures_hebdo || 40),
    date_contrat: contrat.date_contrat ? dateLongue(contrat.date_contrat) : dateLongue(new Date()),
    ville,
  };
  const identite = [
    ["Nom et prénoms du travailleur", travailleur],
    ["Date et lieu de naissance", naissance || POINTS],
    ["Nationalité", emp.nationalite || POINTS],
    ["Filiation", parents ? `${filiationLien} ${parents}` : POINTS],
    ["Situation de famille", libelleSituation(emp, nbEnfants) || POINTS],
    ["Lieu de résidence habituelle", [emp.adresse, emp.ville].filter(Boolean).join(", ") || POINTS],
    ["Fonction", variables.fonction],
    ["Date de l'engagement", variables.date_effet],
    ["Classification professionnelle", variables.classification],
    ["Convention collective", variables.convention],
    ["Durée de travail", `${variables.heures} h par semaine`],
  ];
  return { variables, identite, essaiMois, lignes, totalApres, totalEssai, sansEssai, ville };
}

function remplacer(texte, variables) {
  return texte.replace(/\{(\w+)\}/g, (m, k) => (k in variables ? variables[k] : m));
}

/**
 * Redige le contrat : renvoie le contenu complet (parties, identite, articles numerotes, remuneration, signature).
 * modeleArticles : articles du modele (personnalise ou par defaut).
 */
function rediger(type, modeleArticles, entete, ctx, contratChamps) {
  const { variables, essaiMois } = ctx;
  const articles = [];
  for (const a of modeleArticles) {
    if (a.si === "ESSAI" && !essaiMois) continue;
    const paragraphes = [];
    for (const p of a.paragraphes || []) {
      let t = String(p);
      const m = /^\[(ESSAI|SANS_ESSAI)\]/.exec(t);
      if (m) {
        if (m[1] === "ESSAI" && !essaiMois) continue;
        if (m[1] === "SANS_ESSAI" && essaiMois) continue;
        t = t.slice(m[0].length);
      }
      paragraphes.push(remplacer(t, variables));
    }
    const art = { numero: articles.length + 1, titre: a.titre, paragraphes };
    if (a.remuneration) {
      const jour = type === "JOURNALIER";
      art.remuneration = {
        lignes: ctx.lignes,
        total: ctx.totalApres,
        total_lettres: premiereLettreMajuscule(montantEnLettres(ctx.totalApres)),
        libelle_total: jour ? "Total brut par jour" : "Total brut mensuel",
        total_essai: essaiMois && ctx.sansEssai.length ? ctx.totalEssai : null,
        sans_essai: essaiMois ? ctx.sansEssai : [],
      };
      if (essaiMois && ctx.sansEssai.length) {
        art.paragraphes.push(
          `Pendant la période d'essai, les éléments suivants ne sont pas versés : ${ctx.sansEssai.join(", ")}. La rémunération brute est alors de ${new Intl.NumberFormat("fr-FR").format(ctx.totalEssai).replace(/[  ]/g, " ")} F CFA.`
        );
      }
    }
    articles.push(art);
  }
  return {
    version: 1,
    type,
    numero: contratChamps.numero || null,
    employeur: {
      raison_sociale: entete.raison_sociale || null,
      siege: entete.adresse || null,
      representant: entete.signataire_nom || null,
      qualite: entete.signataire_titre || null,
      telephone: entete.telephone || null,
      email: entete.email || null,
      rccm: entete.rccm || null,
      ninea: entete.ninea || null,
    },
    identite: ctx.identite,
    articles,
    ville: ctx.ville,
    date_contrat: contratChamps.date_contrat,
    exemplaires: 3,
  };
}

// --------------------------------------------------------------------------- avertissements
function avertissements(entete, emp, c, ctx) {
  const A = [];
  const bloquant = (code, champ) => A.push({ niveau: "BLOQUANT", code, champ });
  const attention = (code, champ, extra) => A.push({ niveau: "ATTENTION", code, champ, ...(extra || {}) });
  if (!emp.nom || !emp.prenom) bloquant("IDENTITE_INCOMPLETE");
  if (!c.date_effet) bloquant("DATE_EFFET");
  if (!(c.poste || emp.poste)) bloquant("POSTE");
  if (!ctx.lignes.some((l) => l.montant > 0)) bloquant("REMUNERATION");
  if (c.type === "CDD") {
    if (!c.date_fin) bloquant("DATE_FIN_CDD");
    else if (c.date_effet && c.date_fin <= c.date_effet) bloquant("DATE_FIN_AVANT_EFFET");
    else if (c.date_effet) {
      const mois = (new Date(c.date_fin) - new Date(c.date_effet)) / (86400000 * 30.44);
      if (mois > 24) attention("CDD_LONG", "date_fin", { valeur: Math.round(mois) });
    }
    if (!c.motif) attention("CDD_MOTIF", "motif");
  }
  if (!entete.raison_sociale) bloquant("ENTETE_RAISON_SOCIALE");
  if (!entete.signataire_nom) attention("ENTETE_SIGNATAIRE");
  if (!entete.signature_cachet_base64) attention("ENTETE_SIGNATURE_IMAGE");
  if (ctx.essaiMois > 6) attention("ESSAI_LONG", "periode_essai_mois", { valeur: ctx.essaiMois });
  if (Number(c.heures_hebdo) > 40) attention("HEURES_SUP", "heures_hebdo", { valeur: Number(c.heures_hebdo) });
  if (!(c.convention || emp.convention_collective)) attention("CONVENTION", "convention");
  if (!(c.categorie || emp.categorie)) attention("CATEGORIE", "categorie");
  if (!emp.date_naissance || !emp.lieu_naissance) attention("NAISSANCE");
  if (!emp.adresse) attention("ADRESSE");
  if (!emp.pere_nom && !emp.mere_nom) attention("FILIATION");
  if (!emp.nationalite) attention("NATIONALITE");
  if (!emp.numero_css || !emp.numero_ipres) attention("NUMEROS_SOCIAUX");
  if (emp.date_embauche && c.date_effet && iso(emp.date_embauche) !== iso(c.date_effet) && c.type !== "JOURNALIER") {
    attention("DATE_EMBAUCHE_FICHE", "date_effet");
  }
  if (c.type === "JOURNALIER") attention("JOURNALIER_DMT");
  return A;
}

module.exports = { MODELES_DEFAUT, VARIABLES, construireContexte, rediger, avertissements, dateLongue, iso, civilite, libelleSituation, libelleCategorie };
