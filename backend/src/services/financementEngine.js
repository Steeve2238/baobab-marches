/**
 * Moteur de calcul du Financement v2 (06/10/2026).
 *
 *  calculerReleve()    : decompte detaille d'une banque pour un besoin donne
 *                        (avance, frais ligne par ligne, taxe, retenue, net recu).
 *  comparer()          : releve de plusieurs banques + classement + commentaire.
 *  analyserVersement() : compare le montant REELLEMENT recu avec le decompte
 *                        simule, teste des hypotheses et fabrique les questions
 *                        a poser a la banque.
 *
 * Tout est deterministe (aucune formule saisie par l'utilisateur) : les regles
 * viennent de la condition de la banque et de ses lignes de frais.
 * Montants en XOF, arrondis a l'unite (comme un decompte bancaire).
 */

const { famille: familleDe } = require("./financementCatalogue");

const NB = " ";
const rond = (n) => Math.round(Number(n) || 0);
const fmt = (n) => String(rond(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
const fmtPct = (n, lang) => {
  const s = (Math.round((Number(n) || 0) * 10) / 10).toFixed(1);
  const sansZero = s.endsWith(".0") ? s.slice(0, -2) : s;
  return lang === "en" ? sansZero : sansZero.replace(".", ",");
};
const fmtTaux = (n, lang) => {
  const s = String(Math.round((Number(n) || 0) * 10000) / 10000);
  return lang === "en" ? s : s.replace(".", ",");
};
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const jourStr = (d) => (d ? String(d).slice(0, 10) : null);

function joursEntre(d1, d2) {
  const a = Date.parse(`${jourStr(d1)}T00:00:00Z`);
  const b = Date.parse(`${jourStr(d2)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

const JOURS_PERIODE = { MOIS: 30, TRIMESTRE: 90, SEMESTRE: 180 };

// ---------------------------------------------------------------------------
// Textes (francais / anglais)
// ---------------------------------------------------------------------------
const TX = {
  fr: {
    plafond: (p) => `Le montant (${fmt(p.montant)} XOF) dépasse le plafond accordé (${fmt(p.plafond)} XOF).`,
    montantMin: (p) => `Le montant est inférieur au minimum exigé (${fmt(p.min)} XOF).`,
    dureeMax: (p) => `La durée (${p.duree} j) dépasse la durée maximale prévue (${p.max} j).`,
    dureeMin: (p) => `La durée (${p.duree} j) est inférieure à la durée minimale prévue (${p.min} j).`,
    debiteurNonAgree: (p) => `Le débiteur « ${p.debiteur} » ne figure pas dans la liste des débiteurs agréés.`,
    encoursDepasse: (p) => `Le montant dépasse l'encours autorisé pour « ${p.debiteur} » (${fmt(p.encours)} XOF).`,
    expiree: (p) => `La proposition n'est plus valable depuis le ${p.date}.`,
    pasEffective: (p) => `Ces conditions ne prennent effet que le ${p.date}.`,
    terminee: (p) => `Ces conditions se terminent le ${p.date}, avant l'échéance prévue.`,
    negociation: () => "Conditions encore en négociation : les chiffres sont indicatifs.",
    baseHt: () => "La banque calcule sur le montant HT, qui n'est pas renseigné : le montant saisi est utilisé.",
    incomplete: (p) => `« ${p.libelle} » n'a pas de taux ou de montant renseigné : elle est comptée pour 0.`,
    retenueAConfirmer: (p) =>
      `Il n'est pas précisé si la retenue de garantie (${fmt(p.retenue)} XOF) vient EN PLUS de l'avance. Si elle s'y ajoute, vous ne recevriez que ${fmt(p.flux)} XOF au lieu de ${fmt(p.fluxActuel)} XOF.`,
    // formules
    fFlat: (p) => `${fmtTaux(p.taux, "fr")} % × ${fmt(p.base)}`,
    fAnnuel: (p) => `${fmtTaux(p.taux, "fr")} % par an × ${p.jours} j / ${p.baseJours} × ${fmt(p.base)}`,
    fPeriode: (p) => `${fmtTaux(p.taux, "fr")} % × ${p.n} période${p.n > 1 ? "s" : ""} × ${fmt(p.base)}`,
    fForfait: () => "Montant fixe",
    fForfaitPeriode: (p) => `${fmt(p.fixe)} × ${p.n} période${p.n > 1 ? "s" : ""}`,
    fMin: (p) => ` (minimum ${fmt(p.min)} appliqué)`,
    fMax: (p) => ` (plafonné à ${fmt(p.max)})`,
    // commentaire
    titreAucune: () => "Aucune banque ne peut financer ce besoin",
    titreUne: (p) => `${p.banque} est la seule banque comparable`,
    titreMeilleure: (p) => `${p.banque} est la plus avantageuse`,
    resumeMeilleure: (p) =>
      `Pour ${fmt(p.montant)} XOF sur ${p.duree} jours, ${p.banque} vous coûte ${fmt(p.cout)} XOF au total (${fmtPct(p.pct, "fr")} % du montant)` +
      `${p.famille === "GARANTIE" ? "." : ` et vous recevez ${fmt(p.flux)} XOF dès la mise en place.`}`,
    resumeUne: (p) => `Ajoutez les conditions d'autres banques pour comparer. Chez ${p.banque} : coût total ${fmt(p.cout)} XOF.`,
    pointMoinsChere: (p) =>
      `Elle coûte ${fmt(p.ecart)} XOF de moins que ${p.autre} (${fmt(p.cout)} contre ${fmt(p.coutAutre)} XOF).`,
    pointPilote: (p) =>
      `La différence vient surtout de « ${p.libelle} » : ${fmt(p.montant)} XOF chez ${p.banque} contre ${fmt(p.montantAutre)} XOF chez ${p.autre}.`,
    pointTresorerie: (p) =>
      `${p.banque} avance davantage immédiatement (${fmt(p.flux)} XOF, soit ${fmt(p.plus)} XOF de plus) mais coûte ${fmt(p.surcout)} XOF de plus.`,
    pointRetenue: (p) => `${fmt(p.retenue)} XOF restent retenus en garantie chez ${p.banque} et vous reviennent à l'échéance.`,
    pointNonComparable: (p) => `${p.banque} ne peut pas être retenue : ${p.raison}`,
    retenueIncoherente: (p) =>
      `Le fonds de garantie / la retenue (${fmt(p.retenue)} XOF) dépasse la part non avancée de la créance (${fmt(p.part)} XOF, soit ${fmtPct(p.partPct, "fr")} %). Vérifiez le taux saisi : « encours garantis par créance » dans une proposition désigne en général le taux d'avance, pas le fonds de garantie.`,
    retenueElevee: (p) => `Le fonds de garantie représente ${fmtPct(p.pct, "fr")} % de la créance : c'est inhabituel, vérifiez la saisie.`,
    pointsAConfirmer: (p) => `${p.n} point(s) non précisé(s) par la banque : ${p.liste}. Les chiffres peuvent changer une fois confirmés.`,
    libVersement: () => "Versement à l'entreprise",
    libTaxeSur: (p) => `Taxe sur ${p.libelle}`,
    vigilanceIndicatif: () => "Au moins une proposition est encore en négociation : confirmez les chiffres par écrit avant de signer.",
    questionRetenue: (p) =>
      `Chez ${p.banque} : la retenue / le fonds de garantie de ${fmtTaux(p.pct, "fr")} % est-il compris dans l'avance de ${fmtTaux(p.avance, "fr")} % ou vient-il en plus ?`,
    questionTaxe: (p) => `${p.banque} : la ${p.taxe} de ${fmtTaux(p.taux, "fr")} % s'applique-t-elle à toutes les commissions, intérêts compris ?`,
    questionDuree: (p) => `${p.banque} : à partir de quelle date et sur combien de jours les intérêts sont-ils calculés (jours de valeur, minimum facturé) ?`,
    // controle
    synConforme: (p) => `Le versement de ${fmt(p.recu)} XOF correspond à la proposition de ${p.banque} (${fmt(p.attendu)} XOF).`,
    synMoins: (p) =>
      `Vous avez reçu ${fmt(p.recu)} XOF alors que la proposition de ${p.banque} donne ${fmt(p.attendu)} XOF : ${fmt(p.ecart)} XOF de moins (${fmtPct(p.pct, "fr")} %).`,
    synPlus: (p) =>
      `Vous avez reçu ${fmt(p.recu)} XOF alors que la proposition de ${p.banque} donne ${fmt(p.attendu)} XOF : ${fmt(p.ecart)} XOF de plus (${fmtPct(p.pct, "fr")} %).`,
    synHypothese: (p) => `Ce montant s'explique si ${p.liste}.`,
    synResteHyp: (p) => `Avec cette hypothèse, il resterait ${fmt(p.reste)} XOF non expliqués.`,
    synAucune: () => "Aucune des hypothèses testées ne reproduit exactement ce montant : demandez le détail du décompte à la banque.",
    hR: () => "la retenue de garantie s'ajoute à l'avance (au lieu d'y être incluse)",
    hI: () => "les intérêts sont calculés sur toute la créance et non sur l'avance",
    hPAvant: () => "les intérêts sont prélevés dès le versement",
    hPFin: () => "les intérêts ne sont prélevés qu'à l'échéance",
    hT: () => "la taxe est appliquée à tous les frais",
    hN: () => "aucune taxe n'est appliquée",
    hB: (p) => `la banque a calculé sur le montant ${p.base}`,
    qDetail: () => ({
      question: "Pouvez-vous nous communiquer le décompte détaillé de ce versement, ligne par ligne (avance, commissions, intérêts, taxes, retenue) ?",
      contexte: "Sans décompte détaillé, on ne peut pas dire quelle ligne explique l'écart.",
    }),
    qRetenue: (p) => ({
      question: `Le fonds de garantie / la retenue (${fmt(p.retenue)} XOF) est-il déduit EN PLUS de l'avance, ou est-il déjà compris dans les ${fmtTaux(p.avance, "fr")} % avancés ?`,
      contexte: "La proposition de la banque mentionne les deux sans préciser s'ils se cumulent : c'est la première cause d'écart.",
    }),
    qDuree: (p) => ({
      question: `Sur combien de jours les intérêts ont-ils été calculés, et à partir de quelle date ? Nous avons compté ${p.duree} jours.`,
      contexte: p.implicite ? `Pour arriver à ce montant, il faudrait environ ${p.implicite} jours de financement.` : "Un nombre de jours plus élevé (jours de valeur, minimum facturé) augmente les intérêts.",
    }),
    qInterets: () => ({
      question: "Les intérêts (commission de financement) sont-ils calculés sur le montant avancé ou sur le montant total de la facture ?",
      contexte: "Calculés sur la facture entière, ils coûtent plus cher que sur l'avance seule.",
    }),
    qPrelevementAvant: () => ({
      question: "Les intérêts sont-ils prélevés dès le versement de l'avance (précompte) ou à l'échéance ?",
      contexte: "Prélevés dès le départ, ils réduisent immédiatement la somme que vous recevez.",
    }),
    qTaxe: (p) => ({
      question: `La ${p.taxe} de ${fmtTaux(p.taux, "fr")} % a-t-elle été appliquée sur toutes les commissions et tous les intérêts ? Quel est le montant total de taxe prélevé ?`,
      contexte: "La proposition ne précise pas toujours sur quelles lignes la taxe s'applique.",
    }),
    qBase: (p) => ({
      question: `L'avance et les commissions ont-elles été calculées sur le montant ${p.base} de la facture ?`,
      contexte: "Un calcul sur le HT ou sur le TTC change toutes les lignes proportionnelles.",
    }),
    qFraisNonPrevus: (p) => ({
      question: `Y a-t-il des frais qui ne figurent pas dans la proposition (frais de dossier, timbre, commission de mise en place, assurance) ? Il reste ${fmt(p.reste)} XOF non expliqués.`,
      contexte: "Demandez la liste écrite de tous les frais prélevés ; tout frais non prévu à la proposition doit être justifié.",
    }),
    qLigneEcart: (p) => ({
      question: `« ${p.libelle} » : la banque a prélevé ${fmt(p.banque)} XOF, nous attendions ${fmt(p.simule)} XOF. Quel est le taux, la base et le nombre de jours utilisés ?`,
      contexte: `Écart de ${fmt(Math.abs(p.ecart))} XOF sur cette ligne.`,
    }),
    qLigneNonPrevue: (p) => ({
      question: `« ${p.libelle} » (${fmt(p.montant)} XOF) ne figure pas dans la proposition. Sur quelle base est-elle prélevée ?`,
      contexte: "Un frais absent de la proposition signée peut être contesté.",
    }),
    qMontantSuperieur: () => ({
      question: "Pourquoi le versement est-il supérieur à la proposition (avance plus élevée, commission réduite, geste commercial) ? Merci de le confirmer par écrit.",
      contexte: "Un écart favorable doit aussi être compris, il peut être corrigé plus tard.",
    }),
    qAvance: (p) => ({
      question: `Quel taux d'avance a été appliqué ? Pour obtenir ce montant, il faudrait environ ${fmtPct(p.pct, "fr")} % au lieu de ${fmtPct(p.attendu, "fr")} %.`,
      contexte: "Un taux d'avance plus faible que prévu réduit directement le versement.",
    }),
    ligneConforme: "CONFORME",
  },
  en: {
    plafond: (p) => `The amount (${fmt(p.montant)} XOF) exceeds the granted limit (${fmt(p.plafond)} XOF).`,
    montantMin: (p) => `The amount is below the required minimum (${fmt(p.min)} XOF).`,
    dureeMax: (p) => `The term (${p.duree} d) exceeds the maximum term (${p.max} d).`,
    dureeMin: (p) => `The term (${p.duree} d) is below the minimum term (${p.min} d).`,
    debiteurNonAgree: (p) => `The debtor "${p.debiteur}" is not in the list of approved debtors.`,
    encoursDepasse: (p) => `The amount exceeds the authorised outstanding for "${p.debiteur}" (${fmt(p.encours)} XOF).`,
    expiree: (p) => `The proposal has not been valid since ${p.date}.`,
    pasEffective: (p) => `These conditions only take effect on ${p.date}.`,
    terminee: (p) => `These conditions end on ${p.date}, before the planned due date.`,
    negociation: () => "Conditions still under negotiation: figures are indicative.",
    baseHt: () => "The bank calculates on the amount excl. tax, which is not filled in: the entered amount is used.",
    incomplete: (p) => `"${p.libelle}" has no rate or amount: counted as 0.`,
    retenueAConfirmer: (p) =>
      `It is not stated whether the guarantee retention (${fmt(p.retenue)} XOF) comes IN ADDITION to the advance. If it does, you would only receive ${fmt(p.flux)} XOF instead of ${fmt(p.fluxActuel)} XOF.`,
    fFlat: (p) => `${fmtTaux(p.taux, "en")}% × ${fmt(p.base)}`,
    fAnnuel: (p) => `${fmtTaux(p.taux, "en")}% per year × ${p.jours} d / ${p.baseJours} × ${fmt(p.base)}`,
    fPeriode: (p) => `${fmtTaux(p.taux, "en")}% × ${p.n} period${p.n > 1 ? "s" : ""} × ${fmt(p.base)}`,
    fForfait: () => "Fixed amount",
    fForfaitPeriode: (p) => `${fmt(p.fixe)} × ${p.n} period${p.n > 1 ? "s" : ""}`,
    fMin: (p) => ` (minimum ${fmt(p.min)} applied)`,
    fMax: (p) => ` (capped at ${fmt(p.max)})`,
    titreAucune: () => "No bank can finance this need",
    titreUne: (p) => `${p.banque} is the only comparable bank`,
    titreMeilleure: (p) => `${p.banque} is the best option`,
    resumeMeilleure: (p) =>
      `For ${fmt(p.montant)} XOF over ${p.duree} days, ${p.banque} costs ${fmt(p.cout)} XOF in total (${fmtPct(p.pct, "en")}% of the amount)` +
      `${p.famille === "GARANTIE" ? "." : ` and you receive ${fmt(p.flux)} XOF at set-up.`}`,
    resumeUne: (p) => `Add other banks' conditions to compare. ${p.banque}: total cost ${fmt(p.cout)} XOF.`,
    pointMoinsChere: (p) => `It costs ${fmt(p.ecart)} XOF less than ${p.autre} (${fmt(p.cout)} vs ${fmt(p.coutAutre)} XOF).`,
    pointPilote: (p) => `The gap mainly comes from "${p.libelle}": ${fmt(p.montant)} XOF at ${p.banque} vs ${fmt(p.montantAutre)} XOF at ${p.autre}.`,
    pointTresorerie: (p) => `${p.banque} advances more cash up front (${fmt(p.flux)} XOF, ${fmt(p.plus)} XOF more) but costs ${fmt(p.surcout)} XOF more.`,
    pointRetenue: (p) => `${fmt(p.retenue)} XOF stay withheld as guarantee at ${p.banque} and come back to you at maturity.`,
    pointNonComparable: (p) => `${p.banque} cannot be selected: ${p.raison}`,
    retenueIncoherente: (p) =>
      `The guarantee fund / retention (${fmt(p.retenue)} XOF) exceeds the part of the receivable that is not advanced (${fmt(p.part)} XOF, i.e. ${fmtPct(p.partPct, "en")}%). Check the rate entered: "guaranteed exposure per receivable" in a proposal usually means the advance rate, not the guarantee fund.`,
    retenueElevee: (p) => `The guarantee fund is ${fmtPct(p.pct, "en")}% of the receivable: this is unusual, please check the entry.`,
    pointsAConfirmer: (p) => `${p.n} point(s) not specified by the bank: ${p.liste}. Figures may change once confirmed.`,
    libVersement: () => "Payment to the company",
    libTaxeSur: (p) => `Tax on ${p.libelle}`,
    vigilanceIndicatif: () => "At least one proposal is still under negotiation: confirm the figures in writing before signing.",
    questionRetenue: (p) => `${p.banque}: is the ${fmtTaux(p.pct, "en")}% guarantee retention included in the ${fmtTaux(p.avance, "en")}% advance, or on top of it?`,
    questionTaxe: (p) => `${p.banque}: does the ${p.taxe} of ${fmtTaux(p.taux, "en")}% apply to all commissions, interest included?`,
    questionDuree: (p) => `${p.banque}: from which date and over how many days is interest calculated (value days, minimum charged)?`,
    synConforme: (p) => `The payment of ${fmt(p.recu)} XOF matches ${p.banque}'s proposal (${fmt(p.attendu)} XOF).`,
    synMoins: (p) => `You received ${fmt(p.recu)} XOF while ${p.banque}'s proposal gives ${fmt(p.attendu)} XOF: ${fmt(p.ecart)} XOF less (${fmtPct(p.pct, "en")}%).`,
    synPlus: (p) => `You received ${fmt(p.recu)} XOF while ${p.banque}'s proposal gives ${fmt(p.attendu)} XOF: ${fmt(p.ecart)} XOF more (${fmtPct(p.pct, "en")}%).`,
    synHypothese: (p) => `This amount is explained if ${p.liste}.`,
    synResteHyp: (p) => `With this assumption, ${fmt(p.reste)} XOF would remain unexplained.`,
    synAucune: () => "None of the tested assumptions reproduces this amount exactly: ask the bank for the detailed statement.",
    hR: () => "the guarantee retention is added to the advance (instead of being included)",
    hI: () => "interest is calculated on the whole receivable, not on the advance",
    hPAvant: () => "interest is deducted at payment",
    hPFin: () => "interest is only deducted at maturity",
    hT: () => "tax is applied to all fees",
    hN: () => "no tax is applied",
    hB: (p) => `the bank calculated on the ${p.base} amount`,
    qDetail: () => ({
      question: "Could you send the detailed statement of this payment, line by line (advance, commissions, interest, taxes, retention)?",
      contexte: "Without it, we cannot tell which line explains the gap.",
    }),
    qRetenue: (p) => ({
      question: `Is the guarantee fund / retention (${fmt(p.retenue)} XOF) deducted IN ADDITION to the advance, or already included in the ${fmtTaux(p.avance, "en")}% advanced?`,
      contexte: "The proposal mentions both without saying whether they add up: this is the first cause of gaps.",
    }),
    qDuree: (p) => ({
      question: `Over how many days was interest calculated, and from which date? We counted ${p.duree} days.`,
      contexte: p.implicite ? `To reach this amount, about ${p.implicite} days of financing would be needed.` : "More days (value days, minimum charged) increase interest.",
    }),
    qInterets: () => ({
      question: "Is interest (financing commission) calculated on the advanced amount or on the full invoice amount?",
      contexte: "On the full invoice it costs more than on the advance alone.",
    }),
    qPrelevementAvant: () => ({
      question: "Is interest deducted when the advance is paid (up front) or at maturity?",
      contexte: "Deducted up front, it immediately reduces what you receive.",
    }),
    qTaxe: (p) => ({
      question: `Was the ${p.taxe} of ${fmtTaux(p.taux, "en")}% applied to all commissions and interest? What is the total tax deducted?`,
      contexte: "The proposal does not always say which lines are taxed.",
    }),
    qBase: (p) => ({
      question: `Were the advance and commissions calculated on the ${p.base} amount of the invoice?`,
      contexte: "Excl. tax vs incl. tax changes every proportional line.",
    }),
    qFraisNonPrevus: (p) => ({
      question: `Are there fees that are not in the proposal (file fee, stamp duty, set-up commission, insurance)? ${fmt(p.reste)} XOF remain unexplained.`,
      contexte: "Ask for the written list of all fees; any fee not in the proposal must be justified.",
    }),
    qLigneEcart: (p) => ({
      question: `"${p.libelle}": the bank charged ${fmt(p.banque)} XOF, we expected ${fmt(p.simule)} XOF. What rate, base and number of days were used?`,
      contexte: `Gap of ${fmt(Math.abs(p.ecart))} XOF on this line.`,
    }),
    qLigneNonPrevue: (p) => ({
      question: `"${p.libelle}" (${fmt(p.montant)} XOF) is not in the proposal. On what basis is it charged?`,
      contexte: "A fee missing from the signed proposal can be challenged.",
    }),
    qMontantSuperieur: () => ({
      question: "Why is the payment higher than the proposal (higher advance, reduced commission, goodwill)? Please confirm in writing.",
      contexte: "A favourable gap must also be understood: it may be corrected later.",
    }),
    qAvance: (p) => ({
      question: `What advance rate was applied? To reach this amount it would be about ${fmtPct(p.pct, "en")}% instead of ${fmtPct(p.attendu, "en")}%.`,
      contexte: "A lower advance rate than planned directly reduces the payment.",
    }),
    ligneConforme: "CONFORME",
  },
};
const tx = (lang) => TX[lang] || TX.fr;

// ---------------------------------------------------------------------------
// Entree normalisee
// ---------------------------------------------------------------------------
/**
 * entree brute : { montant, montant_ht, date_prise, date_echeance, duree_jours, debiteur }
 * Retourne l'entree avec duree_jours calculee, ou lance une Error("DUREE_INVALIDE" | "MONTANT_INVALIDE").
 */
function normaliserEntree(brut) {
  const montant = num(brut.montant);
  if (!montant || montant <= 0) throw new Error("MONTANT_INVALIDE");
  const datePrise = jourStr(brut.date_prise);
  const dateEcheance = jourStr(brut.date_echeance);
  let duree = null;
  if (datePrise && dateEcheance) duree = joursEntre(datePrise, dateEcheance);
  if (duree === null || Number.isNaN(duree)) duree = num(brut.duree_jours);
  if (!duree || duree <= 0) throw new Error("DUREE_INVALIDE");
  return {
    montant,
    montant_ht: num(brut.montant_ht),
    date_prise: datePrise,
    date_echeance: dateEcheance,
    duree_jours: Math.round(duree),
    debiteur: brut.debiteur ? String(brut.debiteur).trim() : null,
  };
}


// ---------------------------------------------------------------------------
// Points a confirmer avec la banque (8/10/2026) : ce que la proposition ne dit pas.
// ---------------------------------------------------------------------------
const POINTS = {
  fr: {
    BASE_COMMISSION: { titre: "base de la commission flat (créance ou avance)", question: (p) => `Sur quel montant la commission de ${fmtTaux(p.taux, "fr")} % est-elle calculée : la créance entière (HT ou TTC) ou seulement le montant avancé ?`, contexte: "Sur la créance entière, elle coûte plus cher que sur l'avance seule." },
    TAXE: { titre: "taxe applicable et taux (TOB, TVA…)", question: () => "Quelle taxe s'applique à chaque commission et frais (TOB, TVA, autre), à quel taux, et les montants annoncés sont-ils hors taxes ou toutes taxes comprises ?", contexte: "Le taux réellement appliqué peut différer du taux par défaut de la plateforme." },
    BASE_JOURS: { titre: "base de jours (360 ou 365)", question: () => "Les intérêts sont-ils calculés sur 360 ou 365 jours, et à partir de quelle date de valeur ?", contexte: "Quelques jours de différence modifient les intérêts." },
    PRELEVEMENT_INTERETS: { titre: "date de prélèvement des intérêts", question: () => "Quand la commission de financement est-elle prélevée (au déblocage, à l'encaissement de la facture, chaque mois) et sur quel solde et combien de jours réels ?", contexte: "Prélevée à l'échéance, elle ne réduit pas la somme reçue au déblocage." },
    FRAIS_UNIQUES: { titre: "frais ponctuels ou à chaque opération (dossier, avenant, mise en place)", question: () => "Les frais de dossier, d'avenant ou de mise en place sont-ils dus une seule fois par contrat, ou à chaque bordereau ou nouveau débiteur ?", contexte: "Ponctuels, ils ne pèsent que sur la première opération." },
    LIBERATION_FONDS: { titre: "libération du fonds de garantie", question: () => "Quand et comment le fonds de garantie est-il restitué (à l'encaissement de la facture ?) et peut-il être diminué des retards, impayés ou frais ?", contexte: "Cette somme reste immobilisée tant qu'elle n'est pas libérée." },
    RETARD_PAIEMENT: { titre: "pénalités si le débiteur paie en retard", question: () => "Que se passe-t-il si le débiteur paie après l'échéance : taux ou pénalités, délai de grâce, recours contre nous ?", contexte: "Avec recours, un retard ou un impayé peut vous être refacturé." },
    VALIDITE: { titre: "date de validité de l'offre", question: () => "Jusqu'à quelle date l'offre est-elle valable, et les conditions du contrat signé sont-elles identiques à la proposition ?", contexte: "Une proposition indicative peut changer au contrat." },
    DUREE_MAX: { titre: "durée maximale de financement", question: () => "Quelle est la durée maximale de financement d'une facture ?", contexte: "Au-delà, la banque peut refuser ou facturer davantage." },
  },
  en: {
    BASE_COMMISSION: { titre: "base of the flat commission (receivable or advance)", question: (p) => `What amount is the ${fmtTaux(p.taux, "en")}% commission calculated on: the whole receivable (excl. or incl. tax) or only the advanced amount?`, contexte: "On the whole receivable it costs more than on the advance alone." },
    TAXE: { titre: "applicable tax and rate (bank tax, VAT…)", question: () => "Which tax applies to each commission and fee, at what rate, and are the quoted amounts before or after tax?", contexte: "The rate actually applied may differ from the platform's default." },
    BASE_JOURS: { titre: "day-count basis (360 or 365)", question: () => "Is interest calculated on 360 or 365 days, and from which value date?", contexte: "A few days' difference changes the interest." },
    PRELEVEMENT_INTERETS: { titre: "when interest is charged", question: () => "When is the financing commission charged (at drawdown, when the invoice is collected, monthly) and on which balance and how many actual days?", contexte: "Charged at maturity, it does not reduce the amount received at drawdown." },
    FRAIS_UNIQUES: { titre: "one-off or per-operation fees (file, amendment, set-up)", question: () => "Are file, amendment or set-up fees due once per contract, or with every batch or new debtor?", contexte: "If one-off, they only weigh on the first operation." },
    LIBERATION_FONDS: { titre: "release of the guarantee fund", question: () => "When and how is the guarantee fund returned (when the invoice is collected?) and can it be reduced by delays, unpaid items or fees?", contexte: "This money stays tied up until released." },
    RETARD_PAIEMENT: { titre: "penalties if the debtor pays late", question: () => "What happens if the debtor pays after maturity: rate or penalties, grace period, recourse against us?", contexte: "With recourse, a delay or default can be charged back to you." },
    VALIDITE: { titre: "offer validity date", question: () => "Until when is the offer valid, and are the signed contract terms identical to the proposal?", contexte: "An indicative proposal may change at contract stage." },
    DUREE_MAX: { titre: "maximum financing period", question: () => "What is the maximum financing period for an invoice?", contexte: "Beyond it the bank may refuse or charge more." },
  },
};
const CODES_POINTS = Object.keys(POINTS.fr);

/** Points pertinents pour cette condition et non confirmes par l'utilisateur. */
function pointsAConfirmer(condition, frais, fam, lang) {
  const confirmes = condition.points_confirmes_json && typeof condition.points_confirmes_json === "object" ? condition.points_confirmes_json : {};
  const actifs = (frais || []).filter((f) => f.actif !== false);
  const couts = actifs.filter((f) => f.nature !== "RETENUE");
  const flat = couts.find((f) => f.mode_calcul === "POURCENT_FLAT" && num(f.taux_pct) !== null);
  const pertinents = [];
  if (fam === "CREANCE" && flat) pertinents.push(["BASE_COMMISSION", { taux: num(flat.taux_pct) }]);
  if (couts.some((f) => f.soumis_taxe !== false)) pertinents.push(["TAXE", {}]);
  if (couts.some((f) => f.mode_calcul === "POURCENT_ANNUEL")) {
    pertinents.push(["BASE_JOURS", {}]);
    pertinents.push(["PRELEVEMENT_INTERETS", {}]);
  }
  if (fam === "CREANCE" && couts.some((f) => f.mode_calcul === "FORFAIT")) pertinents.push(["FRAIS_UNIQUES", {}]);
  if (actifs.some((f) => f.nature === "RETENUE")) pertinents.push(["LIBERATION_FONDS", {}]);
  if (fam === "CREANCE") pertinents.push(["RETARD_PAIEMENT", {}]);
  if (!condition.date_validite) pertinents.push(["VALIDITE", {}]);
  if (fam !== "GARANTIE" && num(condition.duree_max_jours) === null) pertinents.push(["DUREE_MAX", {}]);
  const L = POINTS[lang] || POINTS.fr;
  return pertinents
    .filter(([code]) => confirmes[code] !== true)
    .map(([code, p]) => ({ code, titre: L[code].titre, question: L[code].question(p), contexte: L[code].contexte }));
}

// ---------------------------------------------------------------------------
// Releve d'une banque
// ---------------------------------------------------------------------------
function formuleTexte(lang, l, p) {
  const T = tx(lang);
  let s;
  if (l.mode_calcul === "POURCENT_FLAT") s = T.fFlat({ taux: l.taux, base: p.base });
  else if (l.mode_calcul === "POURCENT_ANNUEL") s = T.fAnnuel({ taux: l.taux, jours: p.jours, baseJours: p.baseJours, base: p.base });
  else if (l.mode_calcul === "POURCENT_PAR_PERIODE") s = T.fPeriode({ taux: l.taux, n: p.n, base: p.base });
  else if (l.mode_calcul === "FORFAIT_PAR_PERIODE") s = T.fForfaitPeriode({ fixe: l.fixe, n: p.n });
  else s = T.fForfait();
  if (p.minAppliquee) s += T.fMin({ min: l.minimum });
  if (p.maxAppliquee) s += T.fMax({ max: l.maximum });
  return s;
}

/**
 * @param {object} condition  ligne financement_condition (+ partenaire_nom)
 * @param {Array}  frais      lignes financement_condition_frais
 * @param {object} entree     sortie de normaliserEntree()
 * @param {object} opts       variantes pour le controle (voir plus bas) + lang
 */
function calculerReleve(condition, frais, entree, opts = {}) {
  const lang = opts.lang || "fr";
  const T = tx(lang);
  const fam = familleDe(condition.type_facilite);
  const baseJours = Number(condition.base_jours) || 360;
  const joursValeur = Number(condition.jours_valeur) || 0;
  const dureeBase = opts.dureeOverride || entree.duree_jours;
  const dureeFacturee = Math.max(dureeBase + joursValeur, num(condition.duree_minimale_facturee) || 0);

  const avertissements = [];
  const bloquants = [];
  const incomplet = [];

  // ----- base de la creance et avance
  let baseCreance = entree.montant;
  if (fam === "CREANCE") {
    let baseHt = String(condition.base_creance).toUpperCase() === "HT";
    if (opts.baseInverse) baseHt = !baseHt;
    if (baseHt) {
      if (entree.montant_ht) baseCreance = entree.montant_ht;
      else if (!opts.baseInverse) avertissements.push({ code: "BASE_HT_INCONNUE", texte: T.baseHt() });
    }
  }
  const tauxAvance = opts.avanceOverridePct !== undefined ? opts.avanceOverridePct : num(condition.taux_avance_pct) ?? 100;
  const avance = fam === "GARANTIE" ? 0 : rond((baseCreance * tauxAvance) / 100);

  // ----- mode de retenue
  let retenueMode = opts.retenueMode || null;
  if (!retenueMode) retenueMode = condition.retenue_incluse_avance === "EN_PLUS" ? "EN_PLUS" : "INCLUSE";
  const retenueDeduite = (retenue) => (fam === "CREANCE" ? retenueMode === "EN_PLUS" : true);

  // ----- lignes
  const lignes = [];
  let coutHt = 0;
  let taxes = 0;
  let deduitCouts = 0;
  let aPayerEcheance = 0;
  let fraisUniquesTtc = 0;
  let retenueMontant = 0;
  let retenueDeduiteMontant = 0;

  const taxeTaux = num(condition.taxe_taux_pct) || 0;
  const periodes = (p) => {
    const jp = p === "AN" ? baseJours : JOURS_PERIODE[p] || 90;
    const brut = dureeFacturee / jp;
    return Math.max(1, Math.ceil(brut - 1e-9));
  };

  for (const f of frais) {
    if (f.actif === false) continue;
    const l = {
      code: f.code,
      libelle: f.libelle,
      nature: f.nature,
      mode_calcul: f.mode_calcul,
      taux: num(f.taux_pct),
      fixe: num(f.montant_fixe),
      minimum: num(f.minimum),
      maximum: num(f.maximum),
      periode: f.periode,
    };
    let base = f.base === "AVANCE" ? avance : baseCreance;
    if (opts.interetsSurCreance && f.mode_calcul === "POURCENT_ANNUEL" && f.base === "AVANCE") base = baseCreance;
    if (fam === "GARANTIE") base = entree.montant;
    if (fam === "PRET" && f.base === "CREANCE") base = entree.montant;

    const pourcent = ["POURCENT_FLAT", "POURCENT_ANNUEL", "POURCENT_PAR_PERIODE"].includes(f.mode_calcul);
    const manque = pourcent ? l.taux === null : l.fixe === null;
    const n = periodes(f.periode);
    let brut = 0;
    if (!manque) {
      if (f.mode_calcul === "POURCENT_FLAT") brut = (base * l.taux) / 100;
      else if (f.mode_calcul === "POURCENT_ANNUEL") brut = (base * l.taux * dureeFacturee) / (100 * baseJours);
      else if (f.mode_calcul === "POURCENT_PAR_PERIODE") brut = (base * l.taux * n) / 100;
      else if (f.mode_calcul === "FORFAIT") brut = l.fixe;
      else if (f.mode_calcul === "FORFAIT_PAR_PERIODE") brut = l.fixe * n;
    } else {
      incomplet.push(f.code);
      avertissements.push({ code: "LIGNE_INCOMPLETE", texte: T.incomplete({ libelle: f.libelle }) });
    }
    let minAppliquee = false;
    let maxAppliquee = false;
    if (!manque && l.minimum !== null && brut < l.minimum) {
      brut = l.minimum;
      minAppliquee = true;
    }
    if (!manque && l.maximum !== null && brut > l.maximum) {
      brut = l.maximum;
      maxAppliquee = true;
    }
    const montantHt = rond(brut);

    let prelevement = f.prelevement;
    if (opts.inverserPrelevementInterets && f.mode_calcul === "POURCENT_ANNUEL") {
      prelevement = prelevement === "A_L_ECHEANCE" ? "A_LA_MISE_EN_PLACE" : "A_L_ECHEANCE";
    }

    const ligne = {
      code: f.code,
      libelle: f.libelle,
      nature: f.nature,
      mode_calcul: f.mode_calcul,
      base_montant: rond(base),
      formule: manque ? null : formuleTexte(lang, l, { base: rond(base), jours: dureeFacturee, baseJours, n, minAppliquee, maxAppliquee }),
      montant_ht: montantHt,
      taxe: 0,
      total: montantHt,
      prelevement,
      incomplete: manque,
      frequence: f.frequence === "UNIQUE_CONTRAT" ? "UNIQUE_CONTRAT" : "PAR_OPERATION",
    };

    if (f.nature === "RETENUE") {
      ligne.deduite_maintenant = retenueDeduite(montantHt);
      ligne.restituee = true;
      retenueMontant += montantHt;
      if (ligne.deduite_maintenant) retenueDeduiteMontant += montantHt;
      lignes.push(ligne);
      continue;
    }

    let soumis = f.soumis_taxe !== false;
    if (opts.taxeTout) soumis = true;
    if (opts.sansTaxe) soumis = false;
    const tauxLigne = num(f.taxe_taux_pct) !== null ? num(f.taxe_taux_pct) : taxeTaux;
    const taxe = soumis ? rond((montantHt * tauxLigne) / 100) : 0;
    ligne.taxe = taxe;
    ligne.taxe_taux_pct = soumis ? tauxLigne : 0;
    ligne.taxe_libelle = f.taxe_libelle || condition.taxe_libelle || "TOB";
    ligne.total = montantHt + taxe;
    ligne.soumis_taxe = soumis;
    coutHt += montantHt;
    taxes += taxe;
    if (ligne.frequence === "UNIQUE_CONTRAT") fraisUniquesTtc += ligne.total;
    if (prelevement === "A_L_ECHEANCE") aPayerEcheance += ligne.total;
    else deduitCouts += ligne.total;
    lignes.push(ligne);
  }

  const coutTtc = coutHt + taxes;
  const fluxMiseEnPlace = avance - deduitCouts - retenueDeduiteMontant;
  const baseTaux = fam === "GARANTIE" ? entree.montant : Math.max(fluxMiseEnPlace, 1);
  const tauxEffectif = dureeFacturee > 0 && baseTaux > 0 ? (coutTtc / baseTaux) * (365 / dureeFacturee) * 100 : 0;

  // ----- controles d'eligibilite
  const plafond = num(condition.plafond_montant);
  if (plafond !== null && entree.montant > plafond) {
    bloquants.push({ code: "PLAFOND_DEPASSE", texte: T.plafond({ montant: entree.montant, plafond }) });
  }
  const montantMin = num(condition.montant_min);
  if (montantMin !== null && entree.montant < montantMin) bloquants.push({ code: "MONTANT_MIN", texte: T.montantMin({ min: montantMin }) });
  const dureeMax = num(condition.duree_max_jours);
  if (dureeMax !== null && entree.duree_jours > dureeMax) bloquants.push({ code: "DUREE_MAX", texte: T.dureeMax({ duree: entree.duree_jours, max: dureeMax }) });
  const dureeMin = num(condition.duree_min_jours);
  if (dureeMin !== null && entree.duree_jours < dureeMin) avertissements.push({ code: "DUREE_MIN", texte: T.dureeMin({ duree: entree.duree_jours, min: dureeMin }) });

  const debiteurs = Array.isArray(condition.debiteurs_agrees_json) ? condition.debiteurs_agrees_json : [];
  if (condition.restreindre_debiteurs && entree.debiteur) {
    const cible = entree.debiteur.toLowerCase();
    const trouve = debiteurs.find((d) => d && d.nom && (d.nom.toLowerCase() === cible || cible.includes(d.nom.toLowerCase()) || d.nom.toLowerCase().includes(cible)));
    if (!trouve) bloquants.push({ code: "DEBITEUR_NON_AGREE", texte: T.debiteurNonAgree({ debiteur: entree.debiteur }) });
    else if (num(trouve.encours_autorise) !== null && entree.montant > num(trouve.encours_autorise)) {
      bloquants.push({ code: "ENCOURS_DEPASSE", texte: T.encoursDepasse({ debiteur: entree.debiteur, encours: num(trouve.encours_autorise) }) });
    }
  }

  const refDate = entree.date_prise || new Date().toISOString().slice(0, 10);
  const dv = jourStr(condition.date_validite);
  if (dv && dv < refDate) avertissements.push({ code: "PROPOSITION_EXPIREE", texte: T.expiree({ date: dv }) });
  const de = jourStr(condition.date_effet);
  if (de && de > refDate) avertissements.push({ code: "PAS_ENCORE_EFFECTIVE", texte: T.pasEffective({ date: de }) });
  const df = jourStr(condition.date_fin);
  const ech = entree.date_echeance;
  if (df && ech && df < ech) avertissements.push({ code: "CONVENTION_TERMINEE", texte: T.terminee({ date: df }) });
  if (condition.statut === "EN_NEGOCIATION") avertissements.push({ code: "EN_NEGOCIATION", texte: T.negociation() });

  // ----- coherence du fonds de garantie / retenue (fiche creance)
  if (fam === "CREANCE" && retenueMontant > 0 && baseCreance > 0) {
    const partNonAvancee = rond(baseCreance - avance);
    if (retenueMode === "INCLUSE" && retenueMontant > partNonAvancee + 1) {
      avertissements.push({
        code: "RETENUE_INCOHERENTE",
        texte: T.retenueIncoherente({ retenue: retenueMontant, part: partNonAvancee, partPct: (partNonAvancee / baseCreance) * 100 }),
      });
    } else if ((retenueMontant / baseCreance) * 100 > 30) {
      avertissements.push({ code: "RETENUE_ELEVEE", texte: T.retenueElevee({ pct: (retenueMontant / baseCreance) * 100 }) });
    }
  }

  // ----- points que la banque n'a pas precises
  const aConfirmer = pointsAConfirmer(condition, frais, fam, lang);
  if (aConfirmer.length) {
    avertissements.push({ code: "POINTS_A_CONFIRMER", texte: T.pointsAConfirmer({ n: aConfirmer.length, liste: aConfirmer.map((x) => x.titre).join(" ; ") }) });
  }

  // ----- variante prudente quand la retenue est a confirmer
  let varianteRetenue = null;
  if (fam === "CREANCE" && retenueMontant > 0 && !opts.retenueMode && condition.retenue_incluse_avance === "A_CONFIRMER") {
    const enPlus = fluxMiseEnPlace - retenueMontant;
    varianteRetenue = { flux_mise_en_place: enPlus, retenue: retenueMontant };
    avertissements.push({ code: "RETENUE_A_CONFIRMER", texte: T.retenueAConfirmer({ retenue: retenueMontant, flux: enPlus, fluxActuel: fluxMiseEnPlace }) });
  }

  return {
    condition_id: condition.id,
    partenaire_id: condition.partenaire_id,
    partenaire_nom: condition.partenaire_nom,
    type_facilite: condition.type_facilite,
    libelle: condition.libelle,
    statut_condition: condition.statut,
    famille: fam,
    eligible: bloquants.length === 0,
    bloquants,
    avertissements,
    incomplet,
    duree_jours: entree.duree_jours,
    duree_facturee: dureeFacturee,
    base_jours: baseJours,
    base_creance_montant: rond(baseCreance),
    taux_avance_pct: tauxAvance,
    avance_montant: avance,
    retenue_mode: fam === "CREANCE" && retenueMontant > 0 ? retenueMode : null,
    taxe_libelle: condition.taxe_libelle || "TOB",
    taxe_taux_pct: taxeTaux,
    lignes,
    totaux: {
      cout_ht: coutHt,
      taxes,
      cout_ttc: coutTtc,
      deduit_couts_maintenant: deduitCouts,
      a_payer_echeance: aPayerEcheance,
      retenue_totale: retenueMontant,
      retenue_deduite: retenueDeduiteMontant,
      flux_mise_en_place: fluxMiseEnPlace,
      frais_uniques_ttc: fraisUniquesTtc,
      cout_courant_ttc: coutTtc - fraisUniquesTtc,
      net_final: fam === "CREANCE" ? baseCreance - coutTtc : null,
      part_du_montant_pct: entree.montant > 0 ? (coutTtc / entree.montant) * 100 : 0,
      taux_effectif_annuel_pct: tauxEffectif,
    },
    variante_retenue_en_plus: varianteRetenue,
    points_a_confirmer: aConfirmer,
    justificatifs: condition.justificatifs || null,
    conditions_particulieres: condition.conditions_particulieres || null,
    recours: condition.recours || null,
    domiciliation_exigee: !!condition.domiciliation_exigee,
  };
}

// ---------------------------------------------------------------------------
// Comparatif et commentaire
// ---------------------------------------------------------------------------
function totalParCode(releve) {
  const m = new Map();
  for (const l of releve.lignes) {
    if (l.nature === "RETENUE") continue;
    const cur = m.get(l.code) || { libelle: l.libelle, total: 0 };
    cur.total += l.total;
    m.set(l.code, cur);
  }
  return m;
}

function commenter(releves, entree, lang) {
  const T = tx(lang);
  const eligibles = releves.filter((r) => r.eligible);
  const nonEligibles = releves.filter((r) => !r.eligible);
  const points = [];
  const vigilance = [];
  const questions = [];

  const trier = [...eligibles].sort((a, b) => a.totaux.cout_ttc - b.totaux.cout_ttc || b.totaux.flux_mise_en_place - a.totaux.flux_mise_en_place);
  const meilleure = trier[0] || null;
  const seconde = trier[1] || null;

  let titre;
  let resume;
  if (!meilleure) {
    titre = T.titreAucune();
    resume = nonEligibles.map((r) => `${r.partenaire_nom} : ${r.bloquants.map((b) => b.texte).join(" ")}`).join(" ");
  } else if (!seconde) {
    titre = T.titreUne({ banque: meilleure.partenaire_nom });
    resume = T.resumeUne({ banque: meilleure.partenaire_nom, cout: meilleure.totaux.cout_ttc });
  } else {
    titre = T.titreMeilleure({ banque: meilleure.partenaire_nom });
    resume = T.resumeMeilleure({
      banque: meilleure.partenaire_nom,
      montant: entree.montant,
      duree: entree.duree_jours,
      cout: meilleure.totaux.cout_ttc,
      pct: meilleure.totaux.part_du_montant_pct,
      flux: meilleure.totaux.flux_mise_en_place,
      famille: meilleure.famille,
    });
    const ecart = seconde.totaux.cout_ttc - meilleure.totaux.cout_ttc;
    if (ecart > 0) {
      points.push(
        T.pointMoinsChere({ ecart, autre: seconde.partenaire_nom, cout: meilleure.totaux.cout_ttc, coutAutre: seconde.totaux.cout_ttc })
      );
      // ligne qui explique le plus l'ecart
      const a = totalParCode(meilleure);
      const b = totalParCode(seconde);
      let pilote = null;
      for (const code of new Set([...a.keys(), ...b.keys()])) {
        const va = a.get(code);
        const vb = b.get(code);
        const diff = (vb ? vb.total : 0) - (va ? va.total : 0);
        if (!pilote || diff > pilote.diff) pilote = { diff, libelle: (va || vb).libelle, montant: va ? va.total : 0, montantAutre: vb ? vb.total : 0 };
      }
      if (pilote && pilote.diff > 0) {
        points.push(T.pointPilote({ libelle: pilote.libelle, montant: pilote.montant, montantAutre: pilote.montantAutre, banque: meilleure.partenaire_nom, autre: seconde.partenaire_nom }));
      }
    } else {
      points.push(lang === "en" ? "The banks cost the same: compare the cash received." : "Les banques coûtent la même chose : comparez la trésorerie reçue.");
    }
  }

  if (meilleure && meilleure.famille !== "GARANTIE" && eligibles.length > 1) {
    const plusCash = [...eligibles].sort((a, b) => b.totaux.flux_mise_en_place - a.totaux.flux_mise_en_place)[0];
    if (plusCash.condition_id !== meilleure.condition_id) {
      points.push(
        T.pointTresorerie({
          banque: plusCash.partenaire_nom,
          flux: plusCash.totaux.flux_mise_en_place,
          plus: plusCash.totaux.flux_mise_en_place - meilleure.totaux.flux_mise_en_place,
          surcout: plusCash.totaux.cout_ttc - meilleure.totaux.cout_ttc,
        })
      );
    }
  }
  if (meilleure && meilleure.totaux.retenue_totale > 0) {
    points.push(T.pointRetenue({ banque: meilleure.partenaire_nom, retenue: meilleure.totaux.retenue_totale }));
  }
  for (const r of nonEligibles) {
    points.push(T.pointNonComparable({ banque: r.partenaire_nom, raison: r.bloquants.map((b) => b.texte).join(" ") }));
  }
  if (releves.some((r) => r.statut_condition === "EN_NEGOCIATION")) vigilance.push(T.vigilanceIndicatif());
  for (const r of eligibles) {
    if (r.variante_retenue_en_plus) {
      vigilance.push(r.avertissements.find((a) => a.code === "RETENUE_A_CONFIRMER").texte);
      questions.push(T.questionRetenue({ banque: r.partenaire_nom, pct: r.totaux.retenue_totale && r.base_creance_montant ? (r.totaux.retenue_totale / r.base_creance_montant) * 100 : 0, avance: r.taux_avance_pct }));
    }
    if (r.lignes.some((l) => l.mode_calcul === "POURCENT_ANNUEL")) questions.push(T.questionDuree({ banque: r.partenaire_nom }));
    if (r.totaux.taxes > 0 && r.lignes.some((l) => l.nature === "COUT" && l.soumis_taxe === false && l.montant_ht > 0)) {
      questions.push(T.questionTaxe({ banque: r.partenaire_nom, taxe: r.taxe_libelle, taux: r.taxe_taux_pct }));
    }
  }
  for (const r of eligibles) {
    for (const pt of r.points_a_confirmer || []) questions.push(`${r.partenaire_nom} — ${pt.question}`);
  }
  return { titre, resume, points, vigilance, questions_avant_signature: questions.slice(0, 10) };
}

/**
 * @param {Array} elements [{condition, frais}]
 * @param {object} entreeBrute
 * @param {string} lang
 */
function comparer(elements, entreeBrute, lang = "fr") {
  const entree = normaliserEntree(entreeBrute);
  const releves = elements.map(({ condition, frais }) => calculerReleve(condition, frais, entree, { lang }));
  const eligibles = releves.filter((r) => r.eligible);
  const parCout = [...eligibles].sort((a, b) => a.totaux.cout_ttc - b.totaux.cout_ttc || b.totaux.flux_mise_en_place - a.totaux.flux_mise_en_place);
  const parFlux = [...eligibles].sort((a, b) => b.totaux.flux_mise_en_place - a.totaux.flux_mise_en_place);
  const classement = {
    recommandee_id: parCout[0] ? parCout[0].condition_id : null,
    moins_chere_id: parCout[0] ? parCout[0].condition_id : null,
    plus_tresorerie_id: parFlux[0] && parFlux[0].famille !== "GARANTIE" ? parFlux[0].condition_id : null,
    ordre: parCout.map((r) => r.condition_id),
  };
  const ordreIndex = new Map(classement.ordre.map((id, i) => [id, i]));
  releves.sort((a, b) => {
    const ia = ordreIndex.has(a.condition_id) ? ordreIndex.get(a.condition_id) : 999;
    const ib = ordreIndex.has(b.condition_id) ? ordreIndex.get(b.condition_id) : 999;
    return ia - ib;
  });
  return { entree, releves, classement, commentaire: commenter(releves, entree, lang) };
}

// ---------------------------------------------------------------------------
// Controle d'un versement reel
// ---------------------------------------------------------------------------
function normaliser(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Rapproche le libelle d'une ligne du decompte bancaire d'une ligne simulee.
// Les libelles varient selon les banques : « commission de service » = commission d'affacturage,
// « frais sur avenant » / « mise en place » = frais de dossier, « transfert vers le fonds de garantie » = fonds de garantie.
function trouverLigne(libelle, releve, dejaPris) {
  const n = normaliser(libelle);
  const candidates = releve.lignes.filter((l) => !dejaPris.has(l.code + l.libelle));
  const par = (re) => candidates.find((l) => re.test(normaliser(l.libelle + " " + l.code)));
  if (/(paiement emis|versement|virement|net verse|decaissement)/.test(n)) return { estVersement: true };
  if (/(tob|taxe|tva|impot)/.test(n)) return { estTaxe: true };
  if (/(affactur|commission de service|frais de service)/.test(n)) {
    return par(/affactur/) || candidates.find((l) => l.nature === "COUT" && l.mode_calcul === "POURCENT_FLAT");
  }
  if (/(garantie|retenue|reserve|depot)/.test(n)) return par(/(garantie|retenue|depot)/);
  if (/(financ|interet|agio|escompte)/.test(n)) return candidates.find((l) => l.mode_calcul === "POURCENT_ANNUEL");
  if (/avenant|mise en place|ouverture de dossier/.test(n)) return par(/avenant/) || par(/dossier/);
  if (/dossier/.test(n)) return par(/dossier/) || par(/avenant/);
  if (/timbre/.test(n)) return par(/timbre/);
  if (/(gestion|recouvr)/.test(n)) return par(/(gestion|recouvr)/);
  if (/(caution|aval)/.test(n)) return par(/(caution|aval)/);
  if (/(ouverture|engagement|confirmation)/.test(n)) return par(/(ouverture|engagement|confirmation)/);
  return candidates.find((l) => normaliser(l.libelle).includes(n) || n.includes(normaliser(l.libelle)));
}

const alias = (txt) =>
  normaliser(txt)
    .replace(/^(les |des |le |la |l')/, "")
    .replace(/frais de services?/, "commission de service")
    .trim();

/** Ligne (deja rapprochee) a laquelle une ligne de taxe du decompte se rattache : « TVA sur frais sur avenant » -> avenant. */
function parentDeTaxe(libelle, lignes, dernierIdx) {
  const n = normaliser(libelle);
  const m = n.match(/\b(?:sur|on)\b\s+(.*)$/);
  if (m) {
    const hint = alias(m[1]);
    const trouve = lignes.findIndex((r) => {
      const a = alias(r.libelle_banque);
      return a && (a.includes(hint) || hint.includes(a));
    });
    if (trouve >= 0) return trouve;
  }
  return dernierIdx;
}

function comparerLignes(lignesBanque, releve, tolerance, T) {
  const dejaPris = new Set();
  const lignes = []; // lignes non taxe, dans l'ordre du decompte
  const taxes = []; // { libelle, montant, apres }
  const versements = [];
  for (const lb of lignesBanque) {
    const montant = Math.abs(num(lb.montant) || 0);
    const m = trouverLigne(lb.libelle, releve, dejaPris);
    if (m && m.estVersement) {
      versements.push({ libelle: lb.libelle, montant });
      continue;
    }
    if (m && m.estTaxe) {
      taxes.push({ libelle: lb.libelle, montant, apres: lignes.length - 1 });
      continue;
    }
    if (!m) {
      lignes.push({ libelle_banque: lb.libelle, montant_banque: montant, statut: "NON_PREVU", ecart: montant, taxeBanque: 0 });
      continue;
    }
    dejaPris.add(m.code + m.libelle);
    // Le decompte peut presenter le HT ou le TTC : on retient la lecture la plus proche.
    const ecartHt = montant - m.montant_ht;
    const ecartTtc = montant - m.total;
    const lectureTtc = Math.abs(ecartTtc) < Math.abs(ecartHt);
    const ecart = lectureTtc ? ecartTtc : ecartHt;
    lignes.push({
      libelle_banque: lb.libelle,
      montant_banque: montant,
      code: m.code,
      libelle_simule: m.libelle,
      montant_simule: lectureTtc ? m.total : m.montant_ht,
      ecart: rond(ecart),
      statut: Math.abs(ecart) <= tolerance ? "CONFORME" : "ECART",
      taxeBanque: 0,
      ligneSim: m,
      lectureTtc,
    });
  }

  // taxes du decompte : rattachees a leur ligne quand c'est possible
  let taxeLibre = 0;
  for (const tx of taxes) {
    const idx = lignes.length ? parentDeTaxe(tx.libelle, lignes, tx.apres) : -1;
    if (idx >= 0 && lignes[idx]) lignes[idx].taxeBanque += tx.montant;
    else taxeLibre += tx.montant;
  }

  const res = [];
  let taxesSimRattachees = 0;
  const statutEcart = (e) => (Math.abs(e) <= tolerance ? "CONFORME" : "ECART");
  // Une taxe separee sur le decompte prouve que le montant de la ligne est hors taxe : lecture HT imposee.
  for (const l of lignes) {
    if (l.ligneSim && l.lectureTtc && l.taxeBanque > 0) {
      l.lectureTtc = false;
      l.montant_simule = l.ligneSim.montant_ht;
      l.ecart = rond(l.montant_banque - l.ligneSim.montant_ht);
      l.statut = statutEcart(l.ecart);
    }
  }
  for (const l of lignes) {
    const { taxeBanque, ligneSim, lectureTtc, ...row } = l;
    res.push(row);
    if (ligneSim && !lectureTtc) {
      taxesSimRattachees += ligneSim.taxe;
      if (ligneSim.taxe > 0 || taxeBanque > 0) {
        const ecart = taxeBanque - ligneSim.taxe;
        res.push({
          libelle_banque: T.libTaxeSur({ libelle: l.libelle_banque }),
          libelle_simule: T.libTaxeSur({ libelle: ligneSim.libelle }),
          code: `TAXE:${ligneSim.code}`,
          montant_simule: ligneSim.taxe,
          montant_banque: taxeBanque,
          ecart: rond(ecart),
          statut: statutEcart(ecart),
        });
      }
    } else if (ligneSim && lectureTtc) {
      taxesSimRattachees += ligneSim.taxe;
    } else if (!ligneSim && taxeBanque > 0) {
      res.push({ libelle_banque: T.libTaxeSur({ libelle: l.libelle_banque }), montant_banque: taxeBanque, montant_simule: 0, ecart: rond(taxeBanque), statut: "NON_PREVU" });
    }
  }
  if (taxeLibre > 0) {
    const restantes = Math.max(0, releve.totaux.taxes - taxesSimRattachees);
    const ecart = taxeLibre - restantes;
    res.push({ libelle_banque: releve.taxe_libelle, montant_banque: taxeLibre, code: "TAXE", libelle_simule: releve.taxe_libelle, montant_simule: restantes, ecart: rond(ecart), statut: statutEcart(ecart) });
  }
  // versement(s) a l'entreprise : comparaison avec le net attendu, ce n'est pas un cout
  for (const v of versements) {
    const attendu = releve.totaux.flux_mise_en_place;
    const ecart = v.montant - attendu;
    res.push({ libelle_banque: v.libelle, libelle_simule: T.libVersement(), code: "VERSEMENT", montant_banque: v.montant, montant_simule: attendu, ecart: rond(ecart), statut: statutEcart(ecart) });
  }
  // lignes simulees absentes du decompte : « a venir » si elles sont prelevees a l'echeance
  for (const l of releve.lignes) {
    if (dejaPris.has(l.code + l.libelle) || l.montant_ht === 0) continue;
    const aVenir = l.nature === "COUT" && l.prelevement === "A_L_ECHEANCE";
    res.push({ libelle_simule: l.libelle, code: l.code, montant_simule: l.nature === "RETENUE" ? l.montant_ht : l.total, montant_banque: 0, ecart: -(l.nature === "RETENUE" ? l.montant_ht : l.total), statut: aVenir ? "A_VENIR" : "ABSENT" });
  }
  return res;
}

function resoudre(f, cible, bas, haut) {
  // f decroissante ou croissante : on cherche x tel que f(x) ~ cible par dichotomie.
  const fb = f(bas);
  const fh = f(haut);
  if (Number.isNaN(fb) || Number.isNaN(fh)) return null;
  if ((cible - fb) * (cible - fh) > 0) return null;
  let lo = bas;
  let hi = haut;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if ((fm - cible) * (fb - cible) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * @param {object} p { condition, frais, entree(normalisee), montant_recu, date_prise_reelle?, date_echeance_reelle?, lignes_banque?, lang }
 */
function analyserVersement({ condition, frais, entree, montant_recu, date_prise_reelle, date_echeance_reelle, lignes_banque, lang = "fr" }) {
  const T = tx(lang);
  let entreeEff = { ...entree };
  if (date_prise_reelle || date_echeance_reelle) {
    const prise = jourStr(date_prise_reelle) || entree.date_prise;
    const ech = jourStr(date_echeance_reelle) || entree.date_echeance;
    if (prise && ech) {
      const d = joursEntre(prise, ech);
      if (d && d > 0) entreeEff = { ...entree, date_prise: prise, date_echeance: ech, duree_jours: d };
    }
  }
  const recu = rond(montant_recu);
  const base = calculerReleve(condition, frais, entreeEff, { lang });
  const attendu = base.totaux.flux_mise_en_place;
  const ecart = recu - attendu;
  const tolerance = Math.max(1000, Math.round(entreeEff.montant * 0.001));
  const verdict = Math.abs(ecart) <= tolerance ? "CONFORME" : ecart < 0 ? "MOINS_QUE_PREVU" : "PLUS_QUE_PREVU";
  const pct = attendu !== 0 ? (Math.abs(ecart) / Math.abs(attendu)) * 100 : 0;
  const banque = condition.partenaire_nom;

  // ---- hypotheses : toutes les combinaisons de variantes plausibles
  const toggles = [];
  if (base.retenue_mode === "INCLUSE" && base.totaux.retenue_totale > 0) toggles.push({ cle: "R", opts: { retenueMode: "EN_PLUS" }, texte: T.hR() });
  if (frais.some((f) => f.actif !== false && f.mode_calcul === "POURCENT_ANNUEL" && f.base === "AVANCE") && base.famille === "CREANCE") toggles.push({ cle: "I", opts: { interetsSurCreance: true }, texte: T.hI() });
  const ligneInteret = base.lignes.find((l) => l.mode_calcul === "POURCENT_ANNUEL");
  if (ligneInteret) {
    toggles.push({ cle: "P", opts: { inverserPrelevementInterets: true }, texte: ligneInteret.prelevement === "A_L_ECHEANCE" ? T.hPAvant() : T.hPFin() });
  }
  if (base.totaux.taxes > 0 && base.lignes.some((l) => l.nature === "COUT" && l.soumis_taxe === false && l.montant_ht > 0)) toggles.push({ cle: "T", opts: { taxeTout: true }, texte: T.hT() });
  if (base.totaux.taxes > 0) toggles.push({ cle: "N", opts: { sansTaxe: true }, texte: T.hN() });
  if (base.famille === "CREANCE" && entreeEff.montant_ht) {
    const baseActuelle = String(condition.base_creance).toUpperCase() === "HT" ? "TTC" : "HT";
    toggles.push({ cle: "B", opts: { baseInverse: true }, texte: T.hB({ base: baseActuelle }) });
  }

  const combos = [];
  const k = toggles.length;
  for (let mask = 1; mask < 1 << k; mask++) {
    const choisis = toggles.filter((_, i) => mask & (1 << i));
    if (choisis.some((c) => c.cle === "T") && choisis.some((c) => c.cle === "N")) continue;
    const opts = Object.assign({ lang }, ...choisis.map((c) => c.opts));
    const r = calculerReleve(condition, frais, entreeEff, opts);
    combos.push({ cles: choisis.map((c) => c.cle), textes: choisis.map((c) => c.texte), net: r.totaux.flux_mise_en_place, reste: recu - r.totaux.flux_mise_en_place, nb: choisis.length });
  }
  const explicatives = combos.filter((c) => Math.abs(c.reste) <= tolerance).sort((a, b) => a.nb - b.nb || Math.abs(a.reste) - Math.abs(b.reste));
  const seules = combos.filter((c) => c.nb === 1).map((c) => ({ libelle: c.textes[0], net_calcule: c.net, ecart_restant: c.reste, explique: Math.abs(c.reste) <= tolerance }));
  const meilleureApprox = [...combos].sort((a, b) => Math.abs(a.reste) - Math.abs(b.reste) || a.nb - b.nb)[0] || null;

  // ---- valeurs implicites (duree, avance) pour la situation de base
  const net = (o) => calculerReleve(condition, frais, entreeEff, Object.assign({ lang }, o)).totaux.flux_mise_en_place;
  let dureeImplicite = null;
  if (base.famille !== "GARANTIE" && recu < attendu) {
    const d = resoudre((x) => net({ dureeOverride: Math.max(1, Math.round(x)) }), recu, 1, 1500);
    if (d !== null) dureeImplicite = Math.round(d);
  }
  let avanceImplicite = null;
  if (base.famille === "CREANCE" || base.famille === "PRET") {
    const a = resoudre((x) => net({ avanceOverridePct: x }), recu, 0, Math.max(100, Number(base.taux_avance_pct) || 100));
    if (a !== null) avanceImplicite = Math.round(a * 10) / 10;
  }

  // ---- comparaison ligne a ligne si le decompte de la banque est fourni
  const lignesBanque = Array.isArray(lignes_banque) ? lignes_banque.filter((l) => l && l.libelle && num(l.montant) !== null) : [];
  const comparaisonLignes = lignesBanque.length ? comparerLignes(lignesBanque, base, tolerance, T) : [];

  // ---- questions a poser
  const questions = [];
  const ajouter = (q) => q && questions.push(q);
  if (verdict === "CONFORME") {
    // rien a contester
  } else if (verdict === "PLUS_QUE_PREVU") {
    ajouter(T.qMontantSuperieur());
    ajouter(T.qDetail());
  } else {
    const best = explicatives[0] || null;
    const cles = new Set(best ? best.cles : []);
    if (cles.has("R")) ajouter(T.qRetenue({ retenue: base.totaux.retenue_totale, avance: base.taux_avance_pct }));
    if (cles.has("I")) ajouter(T.qInterets());
    if (cles.has("P")) ajouter(T.qPrelevementAvant());
    if (cles.has("T") || cles.has("N")) ajouter(T.qTaxe({ taxe: base.taxe_libelle, taux: base.taxe_taux_pct }));
    if (cles.has("B")) ajouter(T.qBase({ base: String(condition.base_creance).toUpperCase() === "HT" ? "TTC" : "HT" }));
    if (!best) {
      if (base.retenue_mode === "INCLUSE" && base.totaux.retenue_totale > 0) ajouter(T.qRetenue({ retenue: base.totaux.retenue_totale, avance: base.taux_avance_pct }));
      if (dureeImplicite && dureeImplicite > entreeEff.duree_jours && dureeImplicite <= 800) ajouter(T.qDuree({ duree: entreeEff.duree_jours, implicite: dureeImplicite }));
      else if (base.lignes.some((l) => l.mode_calcul === "POURCENT_ANNUEL")) ajouter(T.qDuree({ duree: entreeEff.duree_jours }));
      if (avanceImplicite !== null && avanceImplicite < Number(base.taux_avance_pct) - 0.5) ajouter(T.qAvance({ pct: avanceImplicite, attendu: Number(base.taux_avance_pct) }));
      if (base.totaux.taxes > 0) ajouter(T.qTaxe({ taxe: base.taxe_libelle, taux: base.taxe_taux_pct }));
      ajouter(T.qFraisNonPrevus({ reste: Math.abs(meilleureApprox ? meilleureApprox.reste : ecart) }));
    } else if (Math.abs(best.reste) > 0 && Math.abs(best.reste) > tolerance / 2) {
      ajouter(T.qFraisNonPrevus({ reste: Math.abs(best.reste) }));
    }
    ajouter(T.qDetail());
  }
  for (const c of comparaisonLignes) {
    if (c.statut === "ECART" && c.code !== "VERSEMENT") ajouter(T.qLigneEcart({ libelle: c.libelle_simule, banque: c.montant_banque, simule: c.montant_simule, ecart: c.ecart }));
    else if (c.statut === "NON_PREVU") ajouter(T.qLigneNonPrevue({ libelle: c.libelle_banque, montant: c.montant_banque }));
  }

  // points que la proposition ne precisait pas : a demander des qu'un ecart apparait
  if (verdict !== "CONFORME" || comparaisonLignes.some((c) => ["ECART", "NON_PREVU"].includes(c.statut))) {
    for (const pt of base.points_a_confirmer || []) ajouter({ question: pt.question, contexte: pt.contexte });
  }

  // ---- synthese
  let synthese;
  if (verdict === "CONFORME") synthese = T.synConforme({ recu, attendu, banque });
  else if (verdict === "MOINS_QUE_PREVU") synthese = T.synMoins({ recu, attendu, ecart: Math.abs(ecart), pct, banque });
  else synthese = T.synPlus({ recu, attendu, ecart: Math.abs(ecart), pct, banque });
  const phrases = [synthese];
  if (verdict !== "CONFORME") {
    if (explicatives[0]) {
      phrases.push(T.synHypothese({ liste: explicatives[0].textes.join(lang === "en" ? " and " : " et ") }));
      if (Math.abs(explicatives[0].reste) > 0) phrases.push(T.synResteHyp({ reste: Math.abs(explicatives[0].reste) }));
    } else phrases.push(T.synAucune());
  }

  // Questions : sans doublon
  const vues = new Set();
  const questionsUniques = questions.filter((q) => {
    if (vues.has(q.question)) return false;
    vues.add(q.question);
    return true;
  });

  return {
    verdict,
    montant_recu: recu,
    montant_attendu: attendu,
    ecart,
    ecart_pct: pct,
    tolerance,
    duree_utilisee: entreeEff.duree_jours,
    releve_simule: base,
    hypotheses: {
      explicatives: explicatives.slice(0, 3).map((c) => ({ libelle: c.textes.join(lang === "en" ? " + " : " + "), net_calcule: c.net, ecart_restant: c.reste })),
      individuelles: seules,
      meilleure_approximation: meilleureApprox ? { libelle: meilleureApprox.textes.join(" + "), net_calcule: meilleureApprox.net, ecart_restant: meilleureApprox.reste } : null,
    },
    implicites: { duree_jours: dureeImplicite, taux_avance_pct: avanceImplicite },
    comparaison_lignes: comparaisonLignes,
    questions: questionsUniques,
    synthese: phrases.join(" "),
  };
}

module.exports = { normaliserEntree, calculerReleve, comparer, analyserVersement, joursEntre, fmt, CODES_POINTS };
