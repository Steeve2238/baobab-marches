/**
 * Module Fiscalite, lot 5 : estimateur de penalites (CGI art. 665 a 671). Estimation indicative - ce n'est ni une
 * liquidation ni un conseil : l'administration fixe seule le montant definitif (art. 672 : ni transaction ni remise une fois fixees).
 *
 *  - interet de retard (art. 665 I) : 5 % du solde impaye, plus 0,5 % pour chaque mois ou fraction de mois de retard supplementaire ;
 *    impots locaux (CEL...) : 10 % (art. 665 II) ;
 *  - penalite (art. 671) : 25 % des droits elus (defaut de declaration ou de paiement) ; 50 % en cas de defaut de reversement d'impots
 *    facturés, collectes ou retenus (TVA collectee, retenues a la source), de manoeuvres / mauvaise foi ou de taxation d'office ;
 *    100 % en cas de recidive ou d'activite non declaree ;
 *  - amende de 200 000 F pour manquement a une obligation declarative sans amende specifique (art. 667) ; doublee en cas de recidive (art. 671 VII).
 */
const num = (v) => Number(v || 0);

/** Natures d'impot et regles qui en decoulent. */
const NATURES = {
  TVA: { collecte: true, local: false },
  RETENUE: { collecte: true, local: false },
  IS: { collecte: false, local: false },
  IMPOT_LOCAL: { collecte: false, local: true },
  AUTRE: { collecte: false, local: false },
};

function joursEntre(a, b) {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db_ = Date.parse(`${b}T00:00:00Z`);
  return Math.round((db_ - da) / 86400000);
}

/**
 * @param {object} e { montant, jours_retard | (date_echeance, date_paiement), nature, declaration_deposee, taxation_office,
 *                      mauvaise_foi, recidive, activite_non_declaree, defaut_declaration }
 */
function estimer(e) {
  const montant = Math.max(0, Math.round(num(e.montant)));
  let jours = e.jours_retard;
  if ((jours === undefined || jours === null) && e.date_echeance && e.date_paiement) jours = joursEntre(e.date_echeance, e.date_paiement);
  jours = Math.max(0, Math.round(num(jours)));
  const nature = NATURES[e.nature] ? e.nature : "AUTRE";
  const regle = NATURES[nature];
  if (jours === 0 || montant === 0) {
    return { nature, montant, jours_retard: 0, mois_retard: 0, taux_interet: 0, interet_retard: 0, taux_penalite: 0, penalite: 0, amende: 0, total: 0, total_avec_droits: montant, hypotheses: [], references: [] };
  }
  const mois = Math.ceil(jours / 30);
  const tauxInteret = regle.local ? 10 : 5 + 0.5 * Math.max(0, mois - 1);
  const interet = Math.round((montant * tauxInteret) / 100);
  const hypotheses = [regle.local ? "INTERET_LOCAL_10" : "INTERET_5_PLUS_05_PAR_MOIS"];
  const references = [regle.local ? "Art. 665 II" : "Art. 665 I"];

  let tauxPenalite = 25;
  hypotheses.push("PENALITE_25_DEFAUT_PAIEMENT");
  if (regle.collecte) {
    tauxPenalite = 50;
    hypotheses.pop();
    hypotheses.push("PENALITE_50_COLLECTE_NON_REVERSEE");
  }
  if (e.mauvaise_foi || e.taxation_office) {
    tauxPenalite = Math.max(tauxPenalite, 50);
    hypotheses.pop();
    hypotheses.push(e.taxation_office ? "PENALITE_50_TAXATION_OFFICE" : "PENALITE_50_MAUVAISE_FOI");
  }
  if (e.recidive || e.activite_non_declaree) {
    tauxPenalite = 100;
    hypotheses.pop();
    hypotheses.push(e.recidive ? "PENALITE_100_RECIDIVE" : "PENALITE_100_ACTIVITE_NON_DECLAREE");
  }
  references.push("Art. 671");
  const penalite = Math.round((montant * tauxPenalite) / 100);

  let amende = 0;
  const declarationManquante = e.defaut_declaration !== undefined ? !!e.defaut_declaration : !e.declaration_deposee;
  if (declarationManquante) {
    amende = 200000 * (e.recidive ? 2 : 1);
    hypotheses.push(e.recidive ? "AMENDE_200000_DOUBLEE_RECIDIVE" : "AMENDE_200000_DEFAUT_DECLARATION");
    references.push("Art. 667");
  } else hypotheses.push("DECLARATION_DEPOSEE_PAS_AMENDE");

  const total = interet + penalite + amende;
  return {
    nature,
    montant,
    jours_retard: jours,
    mois_retard: mois,
    taux_interet: tauxInteret,
    interet_retard: interet,
    taux_penalite: tauxPenalite,
    penalite,
    amende,
    total,
    total_avec_droits: montant + total,
    hypotheses,
    references,
  };
}

module.exports = { NATURES, estimer, joursEntre };
