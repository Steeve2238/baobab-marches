/**
 * Exports du calcul de l'impot sur les societes (module Fiscalite, lot 3) :
 *   - Excel : calcul, retraitements, deficits, acomptes ;
 *   - PDF : "liasse de calcul" (chaine resultat comptable -> impot du -> solde), retraitements, deficits, acomptes.
 * Filigrane BROUILLON tant que la declaration n'est pas deposee.
 */
const XLSX = require("xlsx");
const { fmt, nouveauPdf, tronquer, dateJJMMAAbarre, feuilleAvecLargeurs, formaterNombres } = require("./comptaExports");

const LIBELLES = {
  IS_COMPTABILISE: "Impôt sur les sociétés et IMF comptabilisés (compte 89)",
  AMENDES_PENALITES: "Amendes et pénalités (compte 647)",
  DONS_EXCEDENT: "Dons et libéralités au-delà du plafond",
  PROVISIONS_A_VERIFIER: "Dotations aux provisions comptabilisées (à vérifier)",
  REPRISES_PROVISIONS_TAXEES: "Reprises de provisions antérieurement taxées",
  TAXE_VOITURES_PM: "Taxe spéciale sur les voitures particulières des personnes morales",
  AMORT_NON_ADMIS: "Amortissements non admis en déduction",
  INTERETS_EXCEDENTAIRES: "Autres intérêts excédentaires (hors comptes courants d'associés)",
  CCA_CAPITAL_NON_LIBERE: "Intérêts de comptes courants — capital non entièrement libéré (art. 11-2 b)",
  CCA_TAUX_EXCEDENTAIRE: "Intérêts de comptes courants — fraction au-delà du taux plafonné (art. 11-2 a)",
  CCA_PERSONNES_PHYSIQUES: "Intérêts de comptes courants — sommes supérieures au capital, personnes physiques (art. 11-2 c)",
  CCA_PERSONNES_MORALES: "Intérêts de comptes courants — personnes morales (art. 11-2 d)",
  CCA_REPORT_DEDUCTION: "Intérêts de comptes courants — report des exercices antérieurs (art. 11-2 j)",
  REMUNERATIONS_EXCESSIVES: "Rémunérations excessives",
  ALLOCATIONS_FORFAITAIRES: "Allocations forfaitaires non justifiées",
  PROVISIONS_NON_DEDUCTIBLES: "Provisions non déductibles",
  AUTRE_REINTEGRATION: "Autre réintégration",
  PRODUITS_PARTICIPATION: "Produits de participation exonérés (régime mère-filiale)",
  PLUS_VALUES_REINVESTIES: "Plus-values de cession réinvesties",
  AUTRE_DEDUCTION: "Autre déduction",
};
const libelleLigne = (l) => (l.libelle ? l.libelle : LIBELLES[l.code] || l.code);

const AVERT_FR = {
  EXERCICE_COMPTABLE_ABSENT: "aucun exercice comptable : résultat saisi à la main",
  RESULTAT_COMPTABLE_SAISI: "résultat comptable et chiffre d'affaires saisis",
  EXERCICE_NON_CLOTURE: "exercice comptable non clôturé",
  EXERCICE_DUREE_ATYPIQUE: "exercice de durée différente de 12 mois",
  ECRITURES_EN_INSTANCE: "écritures en instance non retenues",
  DONS_A_VERIFIER: "dons à vérifier (organismes reconnus)",
  PROVISIONS_A_VERIFIER: "provisions à vérifier (art. 11)",
  REPRISES_A_VERIFIER: "reprises de provisions à vérifier",
  DEFICIT_EXERCICE: "exercice déficitaire",
  DEFICIT_PERIME: "déficit ordinaire prescrit",
  IMF_APPLICABLE: "impôt minimum forfaitaire applicable",
  IMF_EXONERE_SAISI: "IMF déclaré exonéré",
  CREDIT_IMPOT_NON_IMPUTE: "crédit d'impôt non imputé",
  ACOMPTES_SUPERIEURS_A_IMPOT: "acomptes supérieurs à l'impôt",
  ACOMPTES_BASE_ABSENTE: "base des acomptes non renseignée",
  CA_NUL: "chiffre d'affaires nul",
  SOURCE_IMPORT: "données issues de la balance / du grand livre importés",
  IMPORT_BALANCE_DESEQUILIBREE: "balance importée déséquilibrée",
  IMPORT_BALANCE_SANS_RESULTAT: "balance importée sans comptes de classes 6 et 7",
  IMPORT_BALANCE_SANS_CLASSE_1: "balance importée sans compte de classe 1",
  BALANCE_DEDUITE_GRAND_LIVRE: "soldes reconstitués du grand livre (pas de balance importée)",
  TAXE_VOITURES_A_REINTEGRER: "taxe sur les voitures particulières à réintégrer si elle est comptabilisée en charges",
  CCA_NATURE_A_CONFIRMER: "nature (personne physique / morale) des associés à confirmer",
  CCA_SOLDE_CLOTURE_RETENU: "solde de clôture retenu faute d'écritures datées",
  CCA_INTERETS_ABSENTS: "comptes courants d'associés sans intérêts comptabilisés",
  CCA_GROUPE_NON_TRAITE: "règle des sociétés d'un même groupe (art. 11-2 e) non traitée",
  CCA_CAPITAL_ABSENT: "capital social introuvable",
  CCA_CAPITAL_NON_LIBERE: "capital non entièrement libéré",
  CCA_TAUX_BCEAO_A_RENSEIGNER: "taux BCEAO à renseigner",
  CCA_TAUX_DEPASSE: "taux d'intérêt supérieur au maximum déductible",
  CCA_REPORT_PERIME: "intérêts reportés prescrits",
  CCA_REPORT_DEDUIT: "report d'intérêts antérieurs déduit",
  CCA_REINTEGRATION_PM: "intérêts de personnes morales réintégrés (art. 11-2 d)",
};
const NATURE_PAIEMENT = { ACOMPTE_1: "1er acompte", ACOMPTE_2: "2e acompte", SOLDE: "Solde", AUTRE: "Autre versement" };
const TYPE_DEFICIT = { ORDINAIRE: "Déficit ordinaire", AMORTISSEMENT_DIFFERE: "Amortissements réputés différés" };

function chaine(c) {
  const R = [];
  R.push(["Résultat comptable de l'exercice", c.comptable.resultat_comptable, "résultat net, classes 6 à 8"]);
  R.push(["+ Réintégrations", c.retraitements.total_reintegrations, "art. 8 à 11"]);
  R.push(["- Déductions", c.retraitements.total_deductions, "art. 11, 12 à 25"]);
  R.push(["= Résultat fiscal avant déficits", c.resultat_fiscal_avant_deficits, "art. 16-2"]);
  R.push(["- Déficits imputés", c.total_imputations, "art. 16"]);
  R.push(["= Résultat fiscal imposable", c.resultat_fiscal_imposable, ""]);
  R.push([`Base de l'IS (arrondie au millier inférieur)`, c.base_is, "art. 36"]);
  R.push([`IS calculé (${c.parametres.taux_is} %)`, c.is_calcule, "art. 36"]);
  R.push([`Chiffre d'affaires HT de l'exercice`, c.imf.ca, "base de l'IMF"]);
  R.push([`IMF dû (${c.parametres.imf_taux} % du CA, plafond ${fmt(c.parametres.imf_plafond)})`, c.imf.du, c.imf.exonere ? "exonéré" : "art. 38 à 40"]);
  R.push([`Impôt applicable : ${c.impot_applicable}`, c.impot_du, "max (IS - crédits, IMF)"]);
  R.push(["Crédits d'impôt imputés", c.credits_impot.impute, "art. 37"]);
  R.push(["Acomptes et versements déjà effectués", c.acomptes.verses, "art. 213 à 215"]);
  R.push(["SOLDE À PAYER (au plus tard le 15 juin)", c.solde_a_payer, "art. 214"]);
  return R;
}

function isXlsx(calcul, contribuable, dossier, deficits) {
  const c = calcul;
  const wb = XLSX.utils.book_new();
  const statut = dossier ? dossier.statut : "BROUILLON";
  const aoa = [[contribuable.raison_sociale], [`Impôt sur les sociétés — exercice ${c.annee}${c.exercice ? ` (${c.exercice.date_debut} au ${c.exercice.date_fin})` : ""} — ${statut}`], [], ["Poste", "Montant (XOF)", "Référence"]];
  for (const l of chaine(c)) aoa.push(l);
  aoa.push([], ["Avertissements"]);
  for (const a of c.avertissements) aoa.push([AVERT_FR[a.code] || a.code]);
  const ws = feuilleAvecLargeurs(aoa, [60, 18, 28]);
  formaterNombres(ws, [1], 4);
  XLSX.utils.book_append_sheet(wb, ws, "Calcul IS");

  const r = [["Sens", "Nature", "Référence CGI", "Montant comptabilisé", "Montant retenu", "Source", "Note"]];
  for (const l of [...c.retraitements.reintegrations, ...c.retraitements.deductions]) {
    r.push([l.sens === "REINTEGRATION" ? "Réintégration" : "Déduction", libelleLigne(l), l.reference || "", l.comptabilise, l.montant, l.mode === "MANUEL" ? "Saisie" : l.modifie ? "Ajusté" : l.mode === "SUGGESTION" ? "Suggestion" : "Balance", l.note || ""]);
  }
  const wr = feuilleAvecLargeurs(r, [14, 62, 18, 20, 16, 12, 36]);
  formaterNombres(wr, [3, 4], 1);
  XLSX.utils.book_append_sheet(wb, wr, "Retraitements");

  const d = [["Exercice d'origine", "Nature", "Montant initial", "Imputé", "Reste", "Source"]];
  for (const x of deficits) d.push([x.annee_origine, TYPE_DEFICIT[x.type], x.montant_initial, x.impute, x.reste, x.source === "DECLARATION" ? "Déclaration" : "Saisie"]);
  const wd = feuilleAvecLargeurs(d, [18, 36, 16, 14, 14, 14]);
  formaterNombres(wd, [2, 3, 4], 1);
  XLSX.utils.book_append_sheet(wb, wd, "Déficits");

  if (c.cca && c.cca.actif) {
    const k = c.cca;
    const cc = [
      ["Intérêts de comptes courants d'associés (CGI art. 11-2)"],
      ["Taux BCEAO (%)", k.taux.bceao === null ? "à renseigner" : k.taux.bceao, "Majoration (points)", k.taux.majoration, "Taux maximum (%)", k.taux.plafond === null ? "" : k.taux.plafond],
      ["Capital social", k.capital.montant, "Capital libéré", k.capital.libere ? "Oui" : "Non"],
      [],
      ["Associé", "Nature", "Compte", "Somme avancée", "Intérêts", "Taux (%)", "Réintégration", "Déductible"],
    ];
    for (const x of k.associes) cc.push([x.nom, x.nature === "PERSONNE_PHYSIQUE" ? "Personne physique" : "Personne morale", x.compte || "", x.somme, x.interets, x.taux_effectif, x.reintegration, x.deductible]);
    cc.push(["Total", "", "", "", k.totaux.interets, "", k.totaux.reintegration, k.totaux.deductible], []);
    cc.push(["Détail personnes morales (art. 11-2 d)"]);
    cc.push(["Sommes avancées par les personnes morales", k.pm.somme], ["Plafond des sommes (1,5 × capital)", k.pm.plafond_structurel], ["Sommes excédentaires", k.pm.exces]);
    cc.push(["Résultat avant intérêts hors comptes courants", k.pm.composantes.rao], ["+ intérêts", k.pm.composantes.interets], ["+ amortissements", k.pm.composantes.amortissements], ["+ provisions", k.pm.composantes.provisions], ["= base de calcul", k.pm.base_ebitda]);
    cc.push(["Plafond 15 % de la base", k.pm.plafond_15], ["Intérêts rémunérant les sommes excédentaires", k.pm.part_sur_exces], ["Intérêts au-delà du plafond de 15 %", k.pm.part_au_dela_15], ["Réintégration (le plus petit des deux)", k.pm.reintegration]);
    if (k.report.deduction > 0) cc.push(["Report antérieur déduit", k.report.deduction]);
    cc.push([], ["Variante prudente (méthode du fichier d'analyse, indicative, non appliquée)", k.variante_excel.reintegration_pm, "Écart de réintégration", k.variante_excel.ecart_reintegration, "Écart d'IS", k.variante_excel.ecart_is]);
    const wc = feuilleAvecLargeurs(cc, [52, 22, 16, 18, 18, 14, 16, 16]);
    formaterNombres(wc, [1, 3, 4, 6, 7], 4);
    XLSX.utils.book_append_sheet(wb, wc, "Comptes courants");
  }

  const a = [["Nature", "Date", "Montant", "Référence"]];
  for (const p of c.acomptes.detail) a.push([NATURE_PAIEMENT[p.nature], p.date_paiement, p.montant, p.reference || ""]);
  a.push([], ["Acomptes à verser l'année suivante (indicatif)"]);
  const plan = c.acomptes.plan;
  if (plan.base !== null) {
    a.push(["Base : impôt du dernier exercice", "", plan.base]);
    a.push(["1er acompte (≥ IMF)", plan.echeance_1, plan.acompte_1]);
    a.push(["2e acompte", plan.echeance_2, plan.acompte_2]);
  } else a.push(["Base non renseignée"]);
  const wa = feuilleAvecLargeurs(a, [44, 14, 16, 24]);
  formaterNombres(wa, [2], 1);
  XLSX.utils.book_append_sheet(wb, wa, "Acomptes");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function isPdf(calcul, contribuable, dossier, deficits) {
  const c = calcul;
  const { doc, fini } = nouveauPdf({ margins: { top: 36, bottom: 30, left: 40, right: 40 } });
  const brouillon = !dossier || dossier.statut === "BROUILLON" || dossier.statut === "PREPAREE";
  const x0 = doc.page.margins.left;
  const largeur = doc.page.width - x0 - doc.page.margins.right;
  let y = 0;

  function filigrane() {
    if (!brouillon) return;
    doc.save();
    doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font("Helvetica-Bold").fontSize(70).fillColor("#cfcfcf").opacity(0.3);
    doc.text("BROUILLON", 0, doc.page.height / 2 - 40, { width: doc.page.width, align: "center", lineBreak: false });
    doc.restore();
    doc.opacity(1);
  }
  function titre(t) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text(t, x0, y, { width: largeur, lineBreak: false });
    y += 15;
    doc.moveTo(x0, y - 2).lineTo(x0 + largeur, y - 2).lineWidth(0.5).stroke("#000");
  }
  function saut(h) {
    if (y + h > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      filigrane();
      y = doc.page.margins.top;
    }
  }

  filigrane();
  y = 36;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#000").text("RÉPUBLIQUE DU SÉNÉGAL", x0, y, { lineBreak: false });
  doc.font("Helvetica").fontSize(8).text("Un Peuple - Un But - Une Foi", x0, y + 11, { lineBreak: false });
  y += 36;
  doc.font("Helvetica-Bold").fontSize(14).text("IMPÔT SUR LES SOCIÉTÉS — LIASSE DE CALCUL", x0, y, { width: largeur, align: "center", lineBreak: false });
  y += 17;
  doc.font("Helvetica-Oblique").fontSize(8).fillColor("#555").text("Aide à la déclaration — à reporter sur l'imprimé de déclaration des résultats (DGID)", x0, y, { width: largeur, align: "center", lineBreak: false });
  y += 18;
  const info = [
    ["Contribuable", contribuable.raison_sociale || "—", "NINEA", contribuable.ninea || "—"],
    ["Exercice", c.exercice ? `${dateJJMMAAbarre(c.exercice.date_debut)} au ${dateJJMMAAbarre(c.exercice.date_fin)} (${c.exercice.duree_mois} mois)` : String(c.annee), "Déclaration avant le", `30/04/${c.annee + 1}`],
    ["Source du résultat", c.source === "COMPTABILITE" ? "Balance (écritures validées)" : c.source === "IMPORT" ? "Balance / grand livre importés" : "Saisie manuelle", "Solde à payer avant le", `15/06/${c.annee + 1}`],
  ];
  for (const [a, b, c2, d2] of info) {
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000").text(a, x0, y, { width: 100, lineBreak: false });
    doc.font("Helvetica").text(tronquer(doc, b, 190), x0 + 100, y, { width: 190, lineBreak: false });
    doc.font("Helvetica-Bold").text(c2, x0 + 300, y, { width: 100, lineBreak: false });
    doc.font("Helvetica").text(tronquer(doc, d2, 110), x0 + 400, y, { width: 110, lineBreak: false });
    y += 12;
  }
  y += 8;

  titre("1. Détermination de l'impôt");
  for (const [lib, val, ref] of chaine(c)) {
    saut(14);
    const fort = /^(=|SOLDE|Impôt applicable)/.test(lib);
    doc.font(fort ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor("#000");
    doc.text(tronquer(doc, lib, 300), x0, y, { width: 305, lineBreak: false });
    doc.font("Helvetica").fontSize(7).fillColor("#666").text(tronquer(doc, ref, 90), x0 + 310, y + 1, { width: 90, lineBreak: false });
    doc.font(fort ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor("#000").text(fmt(val, { zero: true }), x0 + 400, y, { width: largeur - 400, align: "right", lineBreak: false });
    y += 14;
  }
  y += 6;

  const toutes = [...c.retraitements.reintegrations, ...c.retraitements.deductions];
  titre("2. Retraitements extra-comptables");
  if (toutes.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#555").text("Aucun retraitement.", x0, y, { lineBreak: false });
    y += 14;
  }
  for (const sens of ["REINTEGRATION", "DEDUCTION"]) {
    const groupe = toutes.filter((l) => l.sens === sens);
    if (groupe.length === 0) continue;
    saut(16);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000").text(sens === "REINTEGRATION" ? "Réintégrations" : "Déductions", x0, y, { lineBreak: false });
    y += 13;
    for (const l of groupe) {
      saut(13);
      doc.font("Helvetica").fontSize(8).fillColor("#000").text(tronquer(doc, libelleLigne(l), 300), x0 + 8, y, { width: 300, lineBreak: false });
      doc.fillColor("#666").fontSize(7).text(l.reference || "", x0 + 315, y + 1, { width: 80, lineBreak: false });
      doc.fillColor("#000").fontSize(8).text(fmt(l.montant, { zero: true }), x0 + 400, y, { width: largeur - 400, align: "right", lineBreak: false });
      y += 12.5;
    }
    y += 3;
  }
  y += 4;

  saut(60);
  titre("3. Déficits imputés (art. 16)");
  if (c.imputations.length === 0 && c.deficit_cree.ordinaire + c.deficit_cree.amortissement_differe === 0) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#555").text("Aucune imputation.", x0, y, { lineBreak: false });
    y += 14;
  }
  for (const i of c.imputations) {
    saut(13);
    doc.font("Helvetica").fontSize(8).fillColor("#000").text(`${TYPE_DEFICIT[i.type]} de l'exercice ${i.annee_origine}`, x0 + 8, y, { width: 300, lineBreak: false });
    doc.text(fmt(i.montant, { zero: true }), x0 + 400, y, { width: largeur - 400, align: "right", lineBreak: false });
    y += 12.5;
  }
  if (c.deficit_cree.ordinaire + c.deficit_cree.amortissement_differe > 0) {
    saut(26);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000").text("Déficit constaté sur l'exercice (reportable) :", x0 + 8, y, { lineBreak: false });
    y += 12.5;
    doc.font("Helvetica").text(`Déficit ordinaire : ${fmt(c.deficit_cree.ordinaire, { zero: true })} — Amortissements réputés différés : ${fmt(c.deficit_cree.amortissement_differe, { zero: true })}`, x0 + 8, y, { lineBreak: false });
    y += 14;
  }
  y += 6;

  saut(70);
  titre("4. Acomptes et versements");
  for (const p of c.acomptes.detail) {
    saut(13);
    doc.font("Helvetica").fontSize(8).fillColor("#000").text(`${NATURE_PAIEMENT[p.nature]} — ${dateJJMMAAbarre(p.date_paiement)}${p.reference ? ` — ${p.reference}` : ""}`, x0 + 8, y, { width: 330, lineBreak: false });
    doc.text(fmt(p.montant, { zero: true }), x0 + 400, y, { width: largeur - 400, align: "right", lineBreak: false });
    y += 12.5;
  }
  if (c.acomptes.detail.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#555").text("Aucun versement enregistré.", x0, y, { lineBreak: false });
    y += 14;
  }
  const plan = c.acomptes.plan;
  if (plan.base !== null) {
    saut(40);
    y += 4;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000").text(`Acomptes à verser en ${c.annee + 1} (indicatif, base ${fmt(plan.base)})`, x0, y, { lineBreak: false });
    y += 12.5;
    doc.font("Helvetica").text(`1er acompte avant le ${dateJJMMAAbarre(plan.echeance_1)} : ${fmt(plan.acompte_1, { zero: true })} — 2e acompte avant le ${dateJJMMAAbarre(plan.echeance_2)} : ${fmt(plan.acompte_2, { zero: true })}`, x0 + 8, y, { lineBreak: false });
    y += 14;
  }
  y += 6;
  if (c.cca && c.cca.actif) {
    const k = c.cca;
    saut(90);
    titre("5. Intérêts de comptes courants d'associés (art. 11-2)");
    doc.font("Helvetica").fontSize(8).fillColor("#000").text(
      `Taux BCEAO : ${k.taux.bceao === null ? "à renseigner" : `${k.taux.bceao} %`} — majoration ${k.taux.majoration} pts — capital ${fmt(k.capital.montant)} (${k.capital.libere ? "entièrement libéré" : "non entièrement libéré"})`,
      x0 + 8, y, { width: largeur - 8, lineBreak: false }
    );
    y += 13;
    for (const x of k.associes) {
      saut(13);
      doc.font("Helvetica").fontSize(8).fillColor("#000").text(`${tronquer(doc, x.nom, 180)} (${x.nature === "PERSONNE_PHYSIQUE" ? "PP" : "PM"})`, x0 + 8, y, { width: 200, lineBreak: false });
      doc.text(`somme ${fmt(x.somme)}`, x0 + 210, y, { width: 90, align: "right", lineBreak: false });
      doc.text(`intérêts ${fmt(x.interets)}`, x0 + 305, y, { width: 90, align: "right", lineBreak: false });
      doc.text(`réint. ${fmt(x.reintegration, { zero: true })}`, x0 + 400, y, { width: largeur - 400, align: "right", lineBreak: false });
      y += 12.5;
    }
    saut(40);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000").text(`Total intérêts ${fmt(k.totaux.interets, { zero: true })} — réintégration ${fmt(k.totaux.reintegration, { zero: true })} — déductible ${fmt(k.totaux.deductible, { zero: true })}`, x0 + 8, y, { width: largeur - 8, lineBreak: false });
    y += 13;
    doc.font("Helvetica-Oblique").fontSize(7).fillColor("#555").text(
      `Base de calcul (résultat avant intérêts + intérêts + amortissements + provisions) : ${fmt(k.pm.base_ebitda, { zero: true })} — plafond 15 % : ${fmt(k.pm.plafond_15, { zero: true })}. Variante prudente indicative : réintégration PM ${fmt(k.variante_excel.reintegration_pm, { zero: true })} (écart d'IS ${fmt(k.variante_excel.ecart_is, { zero: true })}), non appliquée.`,
      x0 + 8, y, { width: largeur - 8 }
    );
    y += 26;
  }
  if (c.avertissements.length > 0) {
    saut(30);
    doc.font("Helvetica-Oblique").fontSize(7).fillColor("#555").text(`Points d'attention : ${c.avertissements.map((a) => AVERT_FR[a.code] || a.code).join(" ; ")}.`, x0, y, { width: largeur });
  }
  doc.font("Helvetica-Oblique").fontSize(7).fillColor("#555").text("Document d'aide établi par Baobab Marchés : à contrôler et valider par le comptable avant tout dépôt. Taux et plafonds : paramètres de l'exercice (CGI 2025).", x0, doc.page.height - 46, { width: largeur, lineBreak: false });
  doc.end();
  return fini;
}

module.exports = { isXlsx, isPdf, LIBELLES };
