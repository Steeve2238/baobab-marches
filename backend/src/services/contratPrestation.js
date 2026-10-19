/**
 * Contrats de prestation : validation des champs, redaction du contrat a partir du modele par defaut, avertissements.
 *
 * Le contrat lie l'entreprise ("le Client") a un prestataire independant (personne physique ou societe). Ce n'est PAS un contrat
 * de travail : aucune paie, aucune DMT, aucune reference au Code du travail. Le texte est une base de travail qui doit etre relue
 * par un juriste avant usage ; aucune duree legale n'y est affirmee, les durees (preavis, confidentialite, delais) sont des choix
 * contractuels modifiables a l'ecran ou par clause particuliere.
 *
 * Les paragraphes sont construits a partir du contexte (pas de moteur de balises) : un contexte identique donne un texte identique.
 */
const { montantEnLettres, premiereLettreMajuscule } = require("../utils/montantEnLettres");

const FORMES = ["PERSONNE_PHYSIQUE", "SOCIETE"];
const MODES = ["FORFAIT", "TAUX_JOUR", "TAUX_HORAIRE", "MENSUEL"];
const PROPRIETES = ["ENTREPRISE", "PRESTATAIRE_LICENCE"];
const DEVISES = { XOF: { singulier: "franc CFA", pluriel: "francs CFA", sigle: "F CFA" }, EUR: { singulier: "euro", pluriel: "euros", sigle: "EUR" }, USD: { singulier: "dollar américain", pluriel: "dollars américains", sigle: "USD" } };
const STATUTS = ["BROUILLON", "VALIDE", "SIGNE", "TERMINE", "RESILIE", "ANNULE"];
const TAUX_RETENUE_PP = 5; // proposition (module Fiscalite, art. 200) : modifiable, a confirmer avec le conseil fiscal

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : "");
function dateLongue(d) {
  const s = iso(d);
  if (!s) return "";
  const j = Number(s.slice(8, 10));
  return `${j === 1 ? "1er" : j} ${MOIS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
}
const POINTS = "……………………";
const ou = (v, vide = POINTS) => (v !== undefined && v !== null && String(v).trim() !== "" ? String(v).trim() : vide);
const nombre = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const minusculeInitiale = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const nombreDec = (n) => String(Number(n)).replace(".", ",");

function dateOuNull(v) {
  if (v == null || v === "") return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined;
}
const texteOuNull = (v, max) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
function entierOuErreur(v, min, max) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

function normaliserEcheancier(liste) {
  if (!Array.isArray(liste) || liste.length > 24) return null;
  const out = [];
  for (const l of liste) {
    const libelle = l && l.libelle ? String(l.libelle).trim().slice(0, 200) : "";
    const montant = Math.round(Number(l && l.montant));
    const date = l && l.date ? dateOuNull(l.date) : null;
    if (!libelle || !Number.isFinite(montant) || montant < 0 || date === undefined) return null;
    out.push({ libelle, date, montant });
  }
  return out;
}

const CHAMPS_TEXTE = {
  prestataire_nom: 200, prestataire_adresse: 300, prestataire_ninea: 40, prestataire_rccm: 60, prestataire_piece: 100,
  prestataire_qualification: 200, representant: 150, qualite_representant: 100, prestataire_telephone: 40, prestataire_email: 150,
  prestataire_paiement: 300, objet: 600, missions: 4000, livrables: 3000, lieu_execution: 200, clauses_particulieres: 4000,
  juridiction: 150, lieu_signature: 100, notes: 2000,
};
const CHAMPS_BOOL = ["tacite_reconduction", "sous_traitance_autorisee", "montants_ttc", "tva_applicable", "frais_remboursables"];

/** Valide et normalise les champs recus (creation ou modification partielle). */
function champsContrat(body) {
  const erreurs = [];
  const v = {};
  for (const [k, max] of Object.entries(CHAMPS_TEXTE)) {
    if (k in body) v[k] = texteOuNull(body[k], max);
  }
  if ("forme" in body) (FORMES.includes(body.forme) ? (v.forme = body.forme) : erreurs.push("forme"));
  if ("mode_honoraires" in body) (MODES.includes(body.mode_honoraires) ? (v.mode_honoraires = body.mode_honoraires) : erreurs.push("mode_honoraires"));
  if ("propriete_livrables" in body) (PROPRIETES.includes(body.propriete_livrables) ? (v.propriete_livrables = body.propriete_livrables) : erreurs.push("propriete_livrables"));
  if ("devise" in body) (DEVISES[body.devise] ? (v.devise = body.devise) : erreurs.push("devise"));
  for (const k of ["date_contrat", "date_effet", "date_fin"]) {
    if (k in body) {
      const d = dateOuNull(body[k]);
      if (d === undefined) erreurs.push(k);
      else v[k] = d;
    }
  }
  for (const k of CHAMPS_BOOL) if (k in body) v[k] = body[k] === true || body[k] === "true" || body[k] === 1 || body[k] === "1";
  for (const [k, max] of [["preavis_jours", 365], ["delai_paiement_jours", 365]]) {
    if (k in body) {
      const n = entierOuErreur(body[k], 0, max);
      if (n === undefined) erreurs.push(k);
      else v[k] = n;
    }
  }
  if ("montant" in body) {
    const n = Math.round(Number(body.montant));
    if (!Number.isFinite(n) || n < 0 || n > 99999999999999) erreurs.push("montant");
    else v.montant = n;
  }
  for (const [k, max] of [["quantite_estimee", 100000], ["retenue_taux", 100], ["penalite_retard_pct", 100]]) {
    if (k in body) {
      if (body[k] === "" || body[k] == null) v[k] = null;
      else {
        const n = Number(body[k]);
        if (!Number.isFinite(n) || n < 0 || n > max) erreurs.push(k);
        else v[k] = Math.round(n * 100) / 100;
      }
    }
  }
  if ("echeancier" in body) {
    const e = normaliserEcheancier(body.echeancier);
    if (e === null) erreurs.push("echeancier");
    else v.echeancier_json = JSON.stringify(e);
  }
  return { v, erreurs };
}

/** Honoraires estimes : forfait, ou unitaire x quantite prevue (null si la quantite est inconnue). */
function totalEstime(c) {
  const montant = Number(c.montant) || 0;
  if (c.mode_honoraires === "FORFAIT") return montant;
  const q = c.quantite_estimee == null ? null : Number(c.quantite_estimee);
  return q ? Math.round(montant * q) : null;
}

const UNITES = {
  TAUX_JOUR: { un: "jour", pl: "jours", par: "par jour de travail effectif" },
  TAUX_HORAIRE: { un: "heure", pl: "heures", par: "par heure de travail effectif" },
  MENSUEL: { un: "mois", pl: "mois", par: "par mois" },
};

function contexte(entete, c) {
  const dev = DEVISES[c.devise] || DEVISES.XOF;
  const lettres = (m) => premiereLettreMajuscule(montantEnLettres(m, { devise: dev }));
  return {
    entreprise: {
      raison_sociale: ou(entete.raison_sociale, ""),
      siege: ou(entete.adresse, ""),
      representant: ou(entete.signataire_nom, ""),
      qualite: ou(entete.signataire_titre, ""),
      rccm: entete.rccm || "",
      ninea: entete.ninea || "",
    },
    dev,
    lettres,
  };
}

function identitePrestataire(c) {
  const pp = c.forme === "PERSONNE_PHYSIQUE";
  const l = [];
  l.push([pp ? "Nom et prénoms" : "Raison sociale", ou(c.prestataire_nom)]);
  if (pp) {
    l.push(["Profession / spécialité", ou(c.prestataire_qualification)]);
    l.push(["Pièce d'identité", ou(c.prestataire_piece)]);
  } else {
    l.push(["Représentée par", `${ou(c.representant)}${c.qualite_representant ? `, ${c.qualite_representant}` : ""}`]);
    l.push(["RCCM", ou(c.prestataire_rccm)]);
  }
  l.push(["NINEA", ou(c.prestataire_ninea)]);
  l.push(["Adresse", ou(c.prestataire_adresse)]);
  const contact = [c.prestataire_telephone ? `Tél. ${c.prestataire_telephone}` : null, c.prestataire_email].filter(Boolean).join(" - ");
  if (contact) l.push(["Contact", contact]);
  return l;
}

/**
 * Redige le contrat. Retourne { articles, identite, entreprise, ville, date_contrat, forme, mode_honoraires, devise, total, total_lettres }
 * c : champs du contrat (ligne contrat_prestation, dates en texte ISO ou Date).
 */
function rediger(entete, c) {
  const { entreprise, dev, lettres } = contexte(entete, c);
  const pp = c.forme === "PERSONNE_PHYSIQUE";
  const P = "le Prestataire";
  const unite = UNITES[c.mode_honoraires];
  const total = totalEstime(c);
  const echeancier = Array.isArray(c.echeancier_json) ? c.echeancier_json : [];
  const A = [];
  const add = (titre, paragraphes, extra) => A.push({ numero: A.length + 1, titre, paragraphes: paragraphes.filter(Boolean), ...(extra || {}) });

  add("Objet du contrat", [
    `Le Client confie au Prestataire, qui l'accepte, la mission suivante : ${ou(c.objet)}.`,
    c.missions ? `Description détaillée de la mission : ${c.missions}` : null,
    "Le présent contrat est un contrat de prestation de services ; il est régi par le droit sénégalais et, en ce qu'ils s'appliquent, par les Actes uniformes de l'OHADA.",
  ]);

  add("Indépendance du Prestataire", [
    `${premiereLettreMajuscule(P)} exécute la mission en toute indépendance. Il n'existe entre les parties aucun lien de subordination : le présent contrat n'est pas un contrat de travail et ne confère au Prestataire aucun des droits attachés à la qualité de salarié du Client.`,
    "Le Prestataire organise librement son travail, ses horaires et ses méthodes, dans le respect du délai et des résultats attendus, et utilise ses propres moyens matériels et logiciels, sauf accord écrit contraire. Il n'est pas tenu à l'exclusivité et peut travailler pour d'autres clients, sous réserve de ses obligations de confidentialité et de loyauté.",
    pp
      ? "Le Prestataire est seul responsable de ses obligations fiscales et sociales (déclaration d'activité, cotisations, impôts personnels) ; le Client n'effectue aucune déclaration ni cotisation sociale à ce titre, sous réserve de la retenue à la source prévue à l'article « Honoraires »."
      : "Le Prestataire est seul responsable de ses obligations sociales, fiscales et d'assurance à l'égard de son personnel et de l'administration. Le personnel qu'il affecte à la mission demeure placé sous sa seule autorité.",
  ]);

  const finTxt = c.date_fin
    ? `Il prend fin le ${dateLongue(c.date_fin)}${c.tacite_reconduction ? `, et se reconduit tacitement par périodes successives de même durée, sauf dénonciation notifiée par écrit au moins ${c.preavis_jours} jours avant l'échéance` : ", sans tacite reconduction, sauf avenant signé des deux parties"}.`
    : "Il est conclu pour la durée nécessaire à l'achèvement de la mission, sans date de fin fixée, et peut être résilié dans les conditions de l'article « Résiliation ».";
  add("Durée", [`Le présent contrat prend effet le ${dateLongue(c.date_effet)}. ${finTxt}`]);

  add("Exécution de la mission", [
    `${premiereLettreMajuscule(P)} s'engage à exécuter la mission avec le soin et la compétence attendus d'un professionnel de sa spécialité, dans les règles de l'art. Il est tenu d'une obligation de moyens, sauf pour les livrables expressément définis ci-dessous, pour lesquels il s'engage sur le résultat.`,
    c.lieu_execution ? `Lieu d'exécution : ${c.lieu_execution}.` : null,
    c.livrables ? `Livrables attendus : ${c.livrables}` : null,
    "Le Prestataire informe le Client, sans délai, de toute difficulté susceptible d'affecter l'exécution de la mission ou ses délais, et rend compte de l'avancement à la demande du Client.",
    c.sous_traitance_autorisee
      ? "Le Prestataire peut recourir à des sous-traitants pour une partie de la mission, sous sa responsabilité entière et à condition d'en informer préalablement le Client par écrit ; il s'assure que les sous-traitants respectent les obligations de confidentialité du présent contrat."
      : "Le Prestataire exécute personnellement la mission. Il ne peut la sous-traiter, en tout ou partie, sans l'accord écrit préalable du Client.",
  ]);

  // Honoraires
  const hono = [];
  if (c.mode_honoraires === "FORFAIT") {
    hono.push(`En contrepartie de la mission, le Client verse au Prestataire des honoraires forfaitaires de ${nombre(c.montant)} ${dev.sigle} (${minusculeInitiale(lettres(c.montant))}), ${c.montants_ttc ? "toutes taxes comprises" : "hors taxes"}.`);
  } else {
    hono.push(`En contrepartie de la mission, le Client verse au Prestataire des honoraires de ${nombre(c.montant)} ${dev.sigle} (${minusculeInitiale(lettres(c.montant))}) ${unite.par}, ${c.montants_ttc ? "toutes taxes comprises" : "hors taxes"}.`);
    if (total != null) hono.push(`Sur la base de ${nombreDec(c.quantite_estimee)} ${Number(c.quantite_estimee) > 1 ? unite.pl : unite.un} prévus, les honoraires estimés s'élèvent à ${nombre(total)} ${dev.sigle} (${minusculeInitiale(lettres(total))}). Cette estimation n'engage pas le Client au-delà du travail effectivement réalisé et accepté ; tout dépassement doit être approuvé par écrit.`);
    else hono.push("Le nombre d'unités de travail n'est pas fixé à la signature ; le travail effectué est justifié par un relevé validé par le Client avant facturation.");
  }
  if (c.tva_applicable) hono.push(c.montants_ttc ? "Les honoraires incluent la taxe sur la valeur ajoutée applicable, que le Prestataire facture et reverse à l'administration." : "La taxe sur la valeur ajoutée applicable est facturée en sus par le Prestataire, au taux en vigueur.");
  else hono.push("Le Prestataire déclare ne pas facturer la taxe sur la valeur ajoutée ; il en informe sans délai le Client si sa situation change.");
  if (Number(c.retenue_taux) > 0) hono.push(`Conformément à la législation fiscale en vigueur, le Client opère sur les sommes versées une retenue à la source au taux de ${nombreDec(c.retenue_taux)} %, qu'il verse à l'administration fiscale pour le compte du Prestataire. Les paiements du Client sont nets de cette retenue, dont le Prestataire reçoit justification.`);
  hono.push(c.frais_remboursables ? "Les frais engagés pour la mission (déplacements, hébergement, achats), préalablement approuvés par écrit par le Client, sont remboursés sur justificatifs, en sus des honoraires." : "Les honoraires couvrent l'ensemble des frais du Prestataire ; aucun frais n'est remboursé, sauf accord écrit préalable du Client.");
  add("Honoraires", hono, echeancier.length ? {
    echeancier: {
      lignes: echeancier.map((l) => ({ libelle: l.libelle, date: l.date ? iso(l.date) : null, montant: Number(l.montant) })),
      total: echeancier.reduce((s, l) => s + Number(l.montant), 0),
      devise: dev.sigle,
    },
  } : undefined);

  add("Facturation et paiement", [
    `${premiereLettreMajuscule(P)} établit une facture${echeancier.length ? " à chaque échéance prévue à l'article « Honoraires »" : c.mode_honoraires === "FORFAIT" ? " à l'achèvement de la mission" : " périodique, accompagnée du relevé du travail effectué"}. Le Client règle chaque facture dans un délai de ${c.delai_paiement_jours} jours à compter de sa réception, par virement ou par tout autre moyen convenu${c.prestataire_paiement ? ` (coordonnées de paiement : ${c.prestataire_paiement})` : ""}.`,
    Number(c.penalite_retard_pct) > 0 ? `Tout retard de paiement non contesté donne lieu à des pénalités de ${nombreDec(c.penalite_retard_pct)} % par mois de retard, calculées sur les sommes dues.` : null,
    "Le Client peut contester une facture de bonne foi, par écrit et motivé, dans un délai raisonnable ; la partie non contestée est payée à l'échéance.",
  ]);

  add("Obligations du Client", [
    "Le Client fournit au Prestataire, en temps utile, les informations, documents et accès nécessaires à l'exécution de la mission, désigne un interlocuteur et valide les livrables ou formule ses observations dans un délai raisonnable. Il règle les honoraires dans les conditions du présent contrat.",
  ]);

  add("Confidentialité", [
    "Le Prestataire s'interdit de divulguer ou d'utiliser, pour son compte ou celui d'un tiers, les informations non publiques dont il a connaissance à l'occasion de la mission (informations commerciales, financières, techniques, données des clients et du personnel du Client). Cette obligation vaut pendant toute la durée du contrat et pendant cinq (5) ans après son terme, sauf obligation légale de communication.",
    "À la fin du contrat, le Prestataire restitue ou détruit, à la demande du Client, les documents et supports qui lui ont été confiés.",
  ]);

  add("Propriété des livrables", [
    c.propriete_livrables === "ENTREPRISE"
      ? "Les livrables réalisés pour le Client dans le cadre de la mission, et les droits de propriété intellectuelle qui s'y attachent, sont cédés au Client au fur et à mesure de leur paiement intégral, pour toute la durée de protection et pour tous usages, y compris leur modification et leur exploitation. Le Prestataire conserve ses outils, méthodes et savoir-faire préexistants ou génériques, qu'il concède au Client pour l'usage des livrables."
      : "Le Prestataire reste titulaire des droits de propriété intellectuelle sur les livrables. Il concède au Client, à compter de leur paiement intégral, une licence non exclusive, pour la durée de protection, pour les besoins de l'activité du Client, y compris l'usage, la reproduction interne et la modification.",
    "Le Prestataire garantit qu'il détient les droits nécessaires et que les livrables ne portent atteinte à aucun droit de tiers.",
  ]);

  add("Données personnelles", [
    "Chaque partie traite les données personnelles dont elle a connaissance dans le cadre du contrat conformément à la législation sénégalaise applicable à la protection des données personnelles. Le Prestataire n'utilise les données du Client que pour l'exécution de la mission, en assure la sécurité et les restitue ou les détruit à la fin du contrat.",
  ]);

  add("Résiliation", [
    `Chaque partie peut mettre fin au contrat à tout moment, sans motif, par notification écrite respectant un préavis de ${c.preavis_jours} jours. Les honoraires correspondant au travail réellement accompli et accepté jusqu'à la date de fin restent dus, au prorata.`,
    "En cas de manquement grave de l'une des parties à ses obligations, l'autre partie peut résilier le contrat quinze (15) jours après une mise en demeure par écrit restée sans effet, sans préjudice de dommages-intérêts.",
    "Les articles relatifs à la confidentialité, à la propriété des livrables, aux données personnelles, à la responsabilité et au règlement des différends survivent à la fin du contrat.",
  ]);

  add("Responsabilité et force majeure", [
    "Chaque partie répond des dommages directs causés à l'autre par sa faute dans l'exécution du contrat. Sauf faute lourde ou dolosive, la responsabilité du Prestataire est limitée au montant des honoraires perçus au titre de la mission, et aucune partie n'est tenue des dommages indirects (perte de profit, de clientèle, d'image).",
    "Aucune partie n'est responsable d'un manquement dû à un cas de force majeure au sens du droit applicable, à condition d'en informer l'autre sans délai ; si l'empêchement dépasse soixante (60) jours, chacune peut résilier le contrat sans indemnité.",
  ]);

  if (c.clauses_particulieres) add("Clauses particulières", c.clauses_particulieres.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean));

  add("Dispositions générales et règlement des différends", [
    "Le contrat exprime l'intégralité de l'accord des parties et remplace tout accord antérieur sur le même objet ; toute modification requiert un avenant écrit signé des deux parties. Le Prestataire ne peut céder le contrat sans l'accord écrit du Client. Si une stipulation est nulle ou inapplicable, les autres restent en vigueur.",
    "Les notifications se font par écrit, remis contre décharge, par lettre recommandée ou par courriel avec accusé de réception, aux adresses indiquées en tête du contrat.",
    `Le contrat est soumis au droit sénégalais. Les parties s'efforcent de régler à l'amiable tout différend dans un délai de trente (30) jours à compter de sa notification écrite ; à défaut, compétence est attribuée au ${ou(c.juridiction, "Tribunal de commerce de Dakar")}.`,
  ]);

  return {
    entreprise,
    identite: identitePrestataire(c),
    forme: c.forme,
    articles: A,
    ville: ou(c.lieu_signature, "Dakar"),
    date_contrat: iso(c.date_contrat),
    mode_honoraires: c.mode_honoraires,
    devise: c.devise,
    total,
    total_lettres: total != null ? lettres(total) : null,
  };
}

/** Controles avant validation. Niveau BLOQUANT : la validation est refusee ; ATTENTION : affiche seulement. */
function avertissements(entete, c) {
  const a = [];
  const B = (code, valeur) => a.push({ niveau: "BLOQUANT", code, ...(valeur ? { valeur } : {}) });
  const W = (code, valeur) => a.push({ niveau: "ATTENTION", code, ...(valeur ? { valeur } : {}) });
  const pp = c.forme === "PERSONNE_PHYSIQUE";
  if (!entete.raison_sociale) B("ENTETE_ENTREPRISE");
  if (!c.prestataire_nom) B("PRESTATAIRE_NOM");
  if (!c.objet) B("OBJET");
  if (!c.date_effet) B("DATE_EFFET");
  if (!(Number(c.montant) > 0)) B("MONTANT");
  if (c.date_fin && c.date_effet && iso(c.date_fin) < iso(c.date_effet)) B("DATES");
  if (!pp && !c.representant) B("REPRESENTANT");
  const ech = Array.isArray(c.echeancier_json) ? c.echeancier_json : [];
  if (ech.length) {
    const somme = ech.reduce((s, l) => s + Number(l.montant), 0);
    const tot = totalEstime(c);
    if (tot != null && somme > tot) B("ECHEANCIER_SUPERIEUR", `${nombre(somme)} / ${nombre(tot)}`);
    else if (tot != null && c.mode_honoraires === "FORFAIT" && somme < tot) W("ECHEANCIER_INCOMPLET", `${nombre(somme)} / ${nombre(tot)}`);
  }
  if (!c.prestataire_adresse) W("ADRESSE");
  if (!c.prestataire_ninea) W("NINEA");
  if (pp && !c.prestataire_piece) W("PIECE");
  if (!entete.signataire_nom) W("SIGNATAIRE");
  if (pp && !(Number(c.retenue_taux) > 0)) W("RETENUE_PP", `${TAUX_RETENUE_PP} %`);
  if (!pp && Number(c.retenue_taux) > 0) W("RETENUE_SOCIETE");
  if (c.mode_honoraires !== "FORFAIT" && c.quantite_estimee == null) W("QUANTITE");
  // Risque de requalification en contrat de travail : prestataire personne physique, remuneration reguliere, longue duree.
  if (pp && c.date_effet) {
    const mois = c.date_fin ? (Date.parse(iso(c.date_fin)) - Date.parse(iso(c.date_effet))) / (30.44 * 86400000) : Infinity;
    if (mois > 12 && c.mode_honoraires !== "FORFAIT") W("REQUALIFICATION");
    else if (!c.date_fin && c.mode_honoraires === "MENSUEL") W("REQUALIFICATION");
  }
  return a;
}

module.exports = {
  FORMES, MODES, PROPRIETES, DEVISES, STATUTS, TAUX_RETENUE_PP,
  champsContrat, rediger, avertissements, identitePrestataire, totalEstime, dateOuNull, iso, dateLongue,
};
