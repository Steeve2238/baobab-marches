/**
 * Paie : moteur de calcul d'un bulletin (fonction pure, aucun acces base).
 * Methode reprise du classeur « Traitement des salaires » de Steeve (feuilles Bulletins de paie / Simulateur) :
 *   salaire de base de la grille x (jours payes / 30), sursalaire, anciennete (% x salaire de base), heures supplementaires,
 *   primes et indemnites, brut, imposable, IPRES RG / RC, TRIMF (table annuelle), IR (table mensuelle ou formule du CGI),
 *   charges patronales (IPRES, CFCE, securite sociale), net a payer arrondi selon le parametre.
 * Tous les montants des lignes sont arrondis au franc.
 */
const B = require("./paieBaremes");

const r0 = (n) => Math.round((Number(n) || 0) + (n < 0 ? -1e-9 : 1e-9));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Jours du mois sur la base 30 jours (convention 30/360) entre deux dates incluses. */
function jours30(debut, fin) {
  const d = new Date(debut + "T00:00:00Z");
  const f = new Date(fin + "T00:00:00Z");
  const dernierJour = (x) => new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  const jd = d.getUTCDate() === dernierJour(d) ? 30 : Math.min(30, d.getUTCDate());
  const jf = f.getUTCDate() === dernierJour(f) ? 30 : Math.min(30, f.getUTCDate());
  return Math.max(0, jf - jd + 1);
}

/** Annees completes entre deux dates (anciennete). */
function anneesCompletes(depuis, au) {
  if (!depuis) return 0;
  const d = new Date(depuis), f = new Date(au);
  let a = f.getUTCFullYear() - d.getUTCFullYear();
  const m = f.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && f.getUTCDate() < d.getUTCDate())) a -= 1;
  return Math.max(0, a);
}

/** Taux d'anciennete (%) : plus grande ligne dont le nombre d'annees est atteint (VLOOKUP approche du classeur). */
function tauxAnciennete(table, annees) {
  let taux = 0;
  for (const l of [...(table || [])].sort((a, b) => a.annees - b.annees)) if (annees >= l.annees) taux = num(l.taux);
  return taux;
}

/**
 * ctx : voir routes/paie.js (construireContexte). Champs lus :
 *  periode {annee, mois, debut, fin}, parametres, cotisations[], bareme {irIndex, trimfIndex}, formule,
 *  employe {date_embauche, date_sortie, date_anciennete, parts_ir, parts_trimf, ...}, dossier,
 *  convention {anciennete[], majorations[]}, categorie {code, libelle, classification, salaire_base},
 *  rubriques {code -> rubrique}, elementsFixes[], variables {absences[], heures_sup[], gains[], retenues[]},
 *  absenceTypes {code -> {libelle, taux_maintien}}, cumul {brutCumule, moisTravailles, irDejaPaye}
 */
function calculerBulletin(ctx) {
  const P = ctx.parametres || {};
  const avertissements = [];
  const var_ = ctx.variables || {};
  const joursMois = num(P.jours_mois) || 30;
  const heuresMois = num(P.heures_mensuelles) || 173.33;
  const emp = ctx.employe || {};
  const dossier = ctx.dossier || {};
  const periode = ctx.periode;

  // ---------------------------------------------------------------- jours payes
  const debutEff = emp.date_embauche && String(emp.date_embauche).slice(0, 10) > periode.debut ? String(emp.date_embauche).slice(0, 10) : periode.debut;
  const finEff = emp.date_sortie && String(emp.date_sortie).slice(0, 10) < periode.fin ? String(emp.date_sortie).slice(0, 10) : periode.fin;
  const joursPresence = finEff < debutEff ? 0 : Math.min(joursMois, jours30(debutEff, finEff));
  let joursAbsence = 0;
  const absences = [];
  for (const a of var_.absences || []) {
    const type = (ctx.absenceTypes || {})[a.type] || { libelle: a.type, taux_maintien: 0 };
    const j = Math.max(0, num(a.jours));
    const retenus = j * (1 - Math.min(100, Math.max(0, num(type.taux_maintien))) / 100);
    joursAbsence += retenus;
    absences.push({ type: a.type, libelle: type.libelle, jours: j, taux_maintien: num(type.taux_maintien), jours_retenus: retenus });
  }
  const joursPayes = Math.max(0, joursPresence - joursAbsence);
  const ratio = joursMois > 0 ? joursPayes / joursMois : 0;
  if (joursPresence < joursMois) avertissements.push({ niveau: "INFO", code: "MOIS_INCOMPLET", valeur: String(joursPresence) });

  // ---------------------------------------------------------------- elements de salaire
  const lignes = [];
  const ajouter = (l) => {
    const montant = r0(l.montant);
    const ligne = { origine: "CALCULE", quantite: null, taux: null, base: null, imposable: true, cotisable: true, exoneration_plafond: null, ...l, montant };
    const exo = ligne.exoneration_plafond != null ? num(ligne.exoneration_plafond) : 0;
    ligne.imposable_montant = ligne.imposable ? Math.max(0, montant - exo) : 0;
    ligne.cotisable_montant = ligne.cotisable ? Math.max(0, montant - exo) : 0;
    lignes.push(ligne);
    return ligne;
  };

  const cat = ctx.categorie || null;
  const baseCategorielle = dossier.salaire_base_manuel != null ? num(dossier.salaire_base_manuel) : cat ? num(cat.salaire_base) : 0;
  if (!cat && dossier.salaire_base_manuel == null) avertissements.push({ niveau: "BLOQUANT", code: "SANS_CATEGORIE" });
  const sursalaire = num(dossier.sursalaire);

  ajouter({ section: "SALAIRE", code: "SALAIRE_BASE", libelle: "Salaire de base", base: baseCategorielle, quantite: ratio, montant: baseCategorielle * ratio, origine: "GRILLE" });
  if (sursalaire) ajouter({ section: "SALAIRE", code: "SURSALAIRE", libelle: "Sursalaire", base: sursalaire, quantite: ratio, montant: sursalaire * ratio, origine: "DOSSIER" });

  // Ancienneté
  const refAnc = dossier.date_anciennete || emp.date_anciennete || emp.date_embauche || null;
  const annees = anneesCompletes(refAnc, periode.fin);
  const tauxAnc = tauxAnciennete(ctx.convention && ctx.convention.anciennete, annees);
  if (!refAnc) avertissements.push({ niveau: "ATTENTION", code: "DATE_EMBAUCHE_MANQUANTE" });
  if (tauxAnc > 0) {
    ajouter({ section: "INDEMNITES", code: "ANCIENNETE", libelle: `Prime d'ancienneté (${annees} ans)`, base: baseCategorielle, taux: tauxAnc, quantite: ratio, montant: ((baseCategorielle * tauxAnc) / 100) * ratio, origine: "CALCULE" });
  }

  // Heures supplementaires
  const baseHoraire = P.base_taux_horaire === "BASE" ? baseCategorielle : baseCategorielle + sursalaire;
  const tauxHoraire = heuresMois > 0 ? baseHoraire / heuresMois : 0;
  for (const h of var_.heures_sup || []) {
    const heures = num(h.heures);
    if (!(heures > 0)) continue;
    const maj = ((ctx.convention && ctx.convention.majorations) || []).find((m) => m.code === h.code);
    if (!maj) { avertissements.push({ niveau: "ATTENTION", code: "HS_TYPE_INCONNU", valeur: h.code }); continue; }
    ajouter({
      section: "INDEMNITES", code: h.code, libelle: `${maj.libelle || "Heures supplémentaires"}`, base: tauxHoraire, taux: num(maj.taux), quantite: heures,
      montant: tauxHoraire * (1 + num(maj.taux) / 100) * heures, origine: "VARIABLE",
    });
  }

  // Rubriques : elements fixes du dossier puis variables du mois (le mois l'emporte sur le fixe).
  const rubriques = ctx.rubriques || {};
  const parRubrique = new Map();
  for (const e of ctx.elementsFixes || []) parRubrique.set(e.rubrique_code, { fixe: e, variable: null });
  for (const g of var_.gains || []) {
    const cur = parRubrique.get(g.rubrique_code) || { fixe: null, variable: null };
    cur.variable = g;
    parRubrique.set(g.rubrique_code, cur);
  }
  const retenuesSaisies = [];
  const remboursements = [];
  for (const [code, { fixe, variable }] of parRubrique) {
    const rub = rubriques[code];
    if (!rub) { avertissements.push({ niveau: "ATTENTION", code: "RUBRIQUE_INCONNUE", valeur: code }); continue; }
    let montant = 0, quantite = null, base = null;
    if (rub.mode === "QUANTITE") {
      quantite = variable && variable.quantite != null ? num(variable.quantite) : fixe && fixe.quantite != null ? num(fixe.quantite) : 0;
      const unitaire = variable && variable.montant != null ? num(variable.montant) : fixe ? num(fixe.montant) : num(rub.montant_defaut);
      base = unitaire;
      montant = unitaire * quantite;
    } else if (rub.mode === "VARIABLE") {
      montant = variable && variable.montant != null ? num(variable.montant) : 0;
    } else {
      montant = variable && variable.montant != null ? num(variable.montant) : fixe ? num(fixe.montant) : num(rub.montant_defaut);
    }
    if (rub.proratisable && !(variable && variable.montant != null && rub.mode === "VARIABLE")) montant *= ratio;
    if (!(montant > 0)) continue;
    if (rub.sens === "RETENUE") { retenuesSaisies.push({ code, libelle: rub.libelle, montant: r0(montant) }); continue; }
    if (rub.sens === "REMBOURSEMENT") { remboursements.push({ code, libelle: rub.libelle, montant: r0(montant) }); continue; }
    ajouter({
      section: rub.section === "SALAIRE" ? "SALAIRE" : "INDEMNITES", code, libelle: rub.libelle, base, quantite, montant,
      origine: variable ? "VARIABLE" : "FIXE", imposable: rub.imposable !== false, cotisable: rub.soumis_cotisations !== false,
      exoneration_plafond: rub.exoneration_plafond != null ? num(rub.exoneration_plafond) : null,
    });
  }

  // Retenues saisies sans passer par une rubrique (acompte, avance...) : { rubrique_code, montant }
  for (const g of var_.retenues || []) {
    const rub = rubriques[g.rubrique_code];
    if (!rub) { avertissements.push({ niveau: "ATTENTION", code: "RUBRIQUE_INCONNUE", valeur: g.rubrique_code }); continue; }
    const m = num(g.montant);
    if (m > 0) retenuesSaisies.push({ code: g.rubrique_code, libelle: rub.libelle, montant: r0(m) });
  }

  // ---------------------------------------------------------------- totaux
  const somme = (f) => lignes.reduce((s, l) => s + f(l), 0);
  const totalSalaire = somme((l) => (l.section === "SALAIRE" ? l.montant : 0));
  const totalIndemnites = somme((l) => (l.section === "INDEMNITES" ? l.montant : 0));
  const brut = totalSalaire + totalIndemnites;
  const imposable = somme((l) => l.imposable_montant);
  const baseCotisable = somme((l) => l.cotisable_montant);
  const nonImposable = brut - imposable;

  // ---------------------------------------------------------------- cotisations
  const cadre = dossier.regime_rc != null ? !!dossier.regime_rc : !!(cat && cat.classification === "CADRE");
  const retenues = [];
  const charges = [];
  for (const c of ctx.cotisations || []) {
    if (c.public === "CADRES" && !cadre) continue;
    const plafond = c.plafond_mensuel != null ? num(c.plafond_mensuel) : null;
    const base = plafond != null ? Math.min(baseCotisable, plafond) : baseCotisable;
    if (num(c.taux_salarie) > 0) retenues.push({ code: c.code, libelle: c.libelle, section: c.section, base: r0(base), taux: num(c.taux_salarie), montant: r0((base * num(c.taux_salarie)) / 100) });
    if (num(c.taux_patronal) > 0) charges.push({ code: c.code, libelle: c.libelle, section: c.section, base: r0(base), taux: num(c.taux_patronal), montant: r0((base * num(c.taux_patronal)) / 100) });
  }

  // ---------------------------------------------------------------- TRIMF et IR
  const bareme = ctx.bareme || {};
  const partsTrimf = num(emp.parts_trimf);
  const partsIr = num(emp.parts_ir);
  if (!partsIr) avertissements.push({ niveau: "ATTENTION", code: "PARTS_ABSENTES" });
  const t = B.trimfMensuelParPersonne(bareme.trimfIndex, imposable);
  const trimf = { parts: partsTrimf, par_personne: t.montant, montant: r0(t.montant * partsTrimf), source: t.source, revenu_table: t.revenu_table };
  let ir;
  const mode = P.mode_ir || "BAREME";
  if (mode === "CUMUL" && ctx.cumul) {
    const c = B.irCumul({ brutCumule: num(ctx.cumul.brutCumule) + imposable, moisTravailles: num(ctx.cumul.moisTravailles) + 1, parts: partsIr || 1, irDejaPaye: ctx.cumul.irDejaPaye, formule: ctx.formule });
    ir = { parts: partsIr, montant: r0(c.ir_du_mois), source: "CUMUL", revenu_table: null };
  } else if (mode === "FORMULE" || mode === "CUMUL") {
    ir = { parts: partsIr, montant: r0(B.irMensuelFormule(imposable, partsIr || 1, ctx.formule)), source: "FORMULE", revenu_table: null };
  } else {
    const x = B.irMensuelTable(bareme.irIndex, imposable, partsIr || 1, ctx.formule);
    ir = { parts: partsIr, montant: r0(x.montant), source: x.source, revenu_table: x.revenu_table };
    if (x.source === "FORMULE") avertissements.push({ niveau: "INFO", code: "IR_HORS_TABLE" });
  }
  if (!bareme.irIndex || !bareme.trimfIndex) avertissements.push({ niveau: "ATTENTION", code: "BAREME_ABSENT" });
  if (ir.montant > 0) retenues.push({ code: "IR", libelle: "Impôt sur le revenu", section: "IMPOT", base: r0(imposable), taux: null, parts: partsIr, montant: ir.montant });
  if (trimf.montant > 0) retenues.push({ code: "TRIMF", libelle: "TRIMF", section: "IMPOT", base: r0(imposable), taux: null, parts: partsTrimf, montant: trimf.montant });

  const autresRetenues = retenuesSaisies.reduce((s, x) => s + x.montant, 0);
  const totalRetenuesLegales = retenues.reduce((s, x) => s + x.montant, 0);
  const totalRetenues = totalRetenuesLegales + autresRetenues;
  const totalRemboursements = remboursements.reduce((s, x) => s + x.montant, 0);
  const netAvantArrondi = brut - totalRetenues + totalRemboursements;
  const arrondiNet = num(P.arrondi_net) || 1;
  const netAPayer = arrondiNet > 1 ? B.mround(netAvantArrondi, arrondiNet) : r0(netAvantArrondi);
  if (netAPayer < 0) avertissements.push({ niveau: "BLOQUANT", code: "NET_NEGATIF" });
  const totalCharges = charges.reduce((s, x) => s + x.montant, 0);

  return {
    periode,
    jours: { mois: joursMois, presence: joursPresence, absences_retenues: joursAbsence, payes: joursPayes, ratio, absences },
    anciennete: { annees, taux: tauxAnc },
    categorie: cat ? { code: cat.code, libelle: cat.libelle, classification: cat.classification, salaire_base: baseCategorielle } : null,
    cadre,
    taux_horaire: tauxHoraire,
    lignes,
    totaux: { elements_salaire: totalSalaire, indemnites: totalIndemnites, brut, non_imposable: nonImposable, imposable, base_cotisable: baseCotisable },
    retenues, retenues_saisies: retenuesSaisies, remboursements,
    ir, trimf,
    total_retenues: totalRetenues,
    total_remboursements: totalRemboursements,
    net_avant_arrondi: netAvantArrondi,
    arrondi_net: arrondiNet,
    net_a_payer: netAPayer,
    charges_patronales: charges,
    total_charges_patronales: totalCharges,
    cout_employeur: brut + totalCharges,
    avertissements,
  };
}

module.exports = { calculerBulletin, jours30, anneesCompletes, tauxAnciennete };
