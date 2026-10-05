/**
 * Exports Excel et PDF des etats financiers (phase 4) : bilan et compte de
 * resultat SYSCOHADA. Meme charte que comptaExports. Les lignes a zero (N et N-1)
 * sont masquees, sauf totaux, soldes et lignes "non classes" non nulles.
 */
const XLSX = require("xlsx");
const { fmt, dateJJMMAAbarre, feuilleAvecLargeurs, formaterNombres } = require("./comptaExports");
const { pdfTableau } = require("./comptaExportsAnalytique");

const nul = (v) => (v ? v : null);
const indent = (n) => "   ".repeat(n || 0);
const MESSAGES = {
  ECRITURES_EN_INSTANCE_EXCLUES: (a) => `${a.nombre} écriture(s) en instance non incluse(s) dans cet état.`,
  COMPTES_NON_CLASSES: (a) => `${a.nombre} compte(s) non classé(s) : à vérifier.`,
  A_NOUVEAUX_ABSENTS: () => "Aucun à-nouveau enregistré sur cet exercice : le bilan peut être incomplet.",
  BILAN_DESEQUILIBRE: (a) => `Bilan déséquilibré (écart ${fmt(a.ecart, { zero: true })}).`,
  IMPOT_NON_COMPTABILISE: () => "Aucun impôt sur le résultat (compte 89) comptabilisé : résultat avant impôt.",
  N1_EXERCICE_COMPLET: () => "La colonne N-1 reprend l'exercice précédent complet.",
};
const notesAvertissements = (data) => (data.avertissements || []).map((a) => (MESSAGES[a.code] ? MESSAGES[a.code](a) : a.code));

function visible(l, ...vals) {
  if (l.type === "titre" || l.type === "total" || l.type === "solde") return true;
  return vals.some((v) => v) || false;
}

const libExercice = (data) => `${data.exercice.libelle || "Exercice"}${data.exercice_n1 ? ` — N-1 : ${data.exercice_n1.libelle || ""}` : ""}`;

// ---- Bilan -----------------------------------------------------------------

function bilanXlsx(data, entreprise) {
  const aoa = [];
  aoa.push([entreprise]);
  aoa.push([`Bilan au ${dateJJMMAAbarre(data.periode.fin)} — ${libExercice(data)}`]);
  aoa.push(["ACTIF", "Libellé", "Brut", "Amort. et dépréc.", "Net N", "Net N-1"]);
  for (const l of data.actif) {
    if (!visible(l, l.brut, l.amort, l.net, l.net_n1)) continue;
    if (l.type === "titre") aoa.push([null, l.libelle, null, null, null, null]);
    else aoa.push([l.code, indent(l.retrait) + l.libelle, nul(l.brut), nul(l.amort), nul(l.net), nul(l.net_n1)]);
  }
  aoa.push([]);
  const debutPassif = aoa.length;
  aoa.push(["PASSIF", "Libellé", null, null, "Net N", "Net N-1"]);
  for (const l of data.passif) {
    if (!visible(l, l.net, l.net_n1)) continue;
    if (l.type === "titre") aoa.push([null, l.libelle, null, null, null, null]);
    else aoa.push([l.code, indent(l.retrait) + l.libelle, null, null, nul(l.net), nul(l.net_n1)]);
  }
  aoa.push([]);
  for (const n of notesAvertissements(data)) aoa.push([null, n]);
  const ws = feuilleAvecLargeurs(aoa, [8, 62, 18, 18, 18, 18]);
  formaterNombres(ws, [2, 3, 4, 5], 3);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Bilan");
  void debutPassif;
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function bilanPdf(data, entreprise) {
  const colonnes = [
    { titre: "Réf.", poids: 5 },
    { titre: "Libellé", poids: 41 },
    { titre: "Brut", poids: 14, align: "right" },
    { titre: "Amort. et dépréc.", poids: 14, align: "right" },
    { titre: "Net N", poids: 14, align: "right" },
    { titre: "Net N-1", poids: 14, align: "right" },
  ];
  const lignes = [{ cellules: ["", "ACTIF", "", "", "", ""], gras: true }];
  for (const l of data.actif) {
    if (!visible(l, l.brut, l.amort, l.net, l.net_n1)) continue;
    if (l.type === "titre") lignes.push({ cellules: ["", l.libelle, "", "", "", ""], gras: true, separateur: true });
    else {
      const gras = l.type === "total" && (l.fort || l.sous_total);
      lignes.push({ cellules: [l.code, indent(l.retrait) + l.libelle, l.brut, l.amort, l.net, l.net_n1], gras, separateur: l.fort });
    }
  }
  lignes.push({ cellules: ["", "PASSIF", "", "", "", ""], gras: true, separateur: true });
  for (const l of data.passif) {
    if (!visible(l, l.net, l.net_n1)) continue;
    if (l.type === "titre") lignes.push({ cellules: ["", l.libelle, "", "", "", ""], gras: true, separateur: true });
    else lignes.push({ cellules: [l.code, indent(l.retrait) + l.libelle, "", "", l.net, l.net_n1], gras: l.type === "total", separateur: l.fort });
  }
  return pdfTableau({
    entreprise,
    titre: "Bilan",
    sousTitre: `${libExercice(data)}${data.inclure_instance ? " — écritures en instance incluses" : ""}`,
    periode: data.periode,
    colonnes,
    lignes,
    notes: notesAvertissements(data),
    layout: "portrait",
  });
}

// ---- Compte de resultat ----------------------------------------------------

const visibleR = (l) => visible(l, l.n, l.n1);

function resultatXlsx(data, entreprise) {
  const aoa = [];
  aoa.push([entreprise]);
  aoa.push([`Compte de résultat du ${dateJJMMAAbarre(data.periode.debut)} au ${dateJJMMAAbarre(data.periode.fin)} — ${libExercice(data)}`]);
  aoa.push(["Réf.", "Libellé", "Exercice N", "Exercice N-1"]);
  for (const l of data.lignes) {
    if (!visibleR(l)) continue;
    const solde = l.type === "solde";
    aoa.push([l.code, solde ? l.libelle : indent(1) + l.libelle, solde ? l.n : nul(l.n), solde ? l.n1 : nul(l.n1)]);
  }
  aoa.push([]);
  for (const n of notesAvertissements(data)) aoa.push([null, n]);
  const ws = feuilleAvecLargeurs(aoa, [8, 66, 20, 20]);
  formaterNombres(ws, [2, 3], 3);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Compte de résultat");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function resultatPdf(data, entreprise) {
  const colonnes = [
    { titre: "Réf.", poids: 6 },
    { titre: "Libellé", poids: 60 },
    { titre: "Exercice N", poids: 17, align: "right" },
    { titre: "Exercice N-1", poids: 17, align: "right" },
  ];
  const lignes = data.lignes
    .filter(visibleR)
    .map((l) => {
      const solde = l.type === "solde";
      return {
        cellules: [l.code, solde ? l.libelle : indent(1) + l.libelle, solde ? fmt(l.n, { zero: true }) : l.n, l.n1 === null ? "" : solde ? fmt(l.n1, { zero: true }) : l.n1],
        gras: solde,
        separateur: solde,
      };
    });
  return pdfTableau({
    entreprise,
    titre: "Compte de résultat",
    sousTitre: `${libExercice(data)}${data.inclure_instance ? " — écritures en instance incluses" : ""}`,
    periode: data.periode,
    colonnes,
    lignes,
    notes: notesAvertissements(data),
    layout: "portrait",
  });
}


// ---- Tableau des immobilisations ------------------------------------------

function ecritureCellules(l) {
  return [l.brut_debut, l.acquisitions, l.sorties, l.brut_fin, l.amort_debut, l.dotations, l.amort_sorties, l.amort_fin, l.vnc_fin];
}

function immobilisationsXlsx(data, entreprise) {
  const aoa = [];
  aoa.push([entreprise]);
  aoa.push([`Tableau des immobilisations et amortissements — ${data.exercice.libelle} (du ${dateJJMMAAbarre(data.exercice.date_debut)} au ${dateJJMMAAbarre(data.exercice.date_fin)})`]);
  aoa.push(["Compte", "Libellé", "Brut début", "Acquisitions", "Sorties", "Brut fin", "Amort. début", "Dotations", "Amort. sortis", "Amort. fin", "VNC fin"]);
  for (const g of data.groupes) {
    aoa.push([g.groupe, g.libelle, ...ecritureCellules(g).map(nul)]);
    for (const l of g.lignes) aoa.push([l.code, `   ${l.libelle}${l.statut === "SORTIE" ? " (sorti)" : ""}`, ...ecritureCellules(l).map(nul)]);
  }
  aoa.push([null, "TOTAL", ...ecritureCellules(data.totaux)]);
  aoa.push([]);
  const c = data.controle;
  aoa.push([null, `Contrôle avec la comptabilité — brut : fiches ${fmt(c.brut_fiches, { zero: true })} / comptabilité ${fmt(c.brut_comptabilite, { zero: true })} (écart ${fmt(c.ecart_brut, { zero: true })})`]);
  aoa.push([null, `Contrôle avec la comptabilité — amortissements : fiches ${fmt(c.amort_fiches, { zero: true })} / comptabilité ${fmt(c.amort_comptabilite, { zero: true })} (écart ${fmt(c.ecart_amort, { zero: true })})`]);
  const ws = feuilleAvecLargeurs(aoa, [10, 46, 15, 15, 15, 15, 15, 15, 15, 15, 15]);
  formaterNombres(ws, [2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Immobilisations");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function immobilisationsPdf(data, entreprise) {
  const colonnes = [
    { titre: "Compte", poids: 7 },
    { titre: "Libellé", poids: 22 },
    { titre: "Brut début", poids: 9, align: "right" },
    { titre: "Acquis.", poids: 9, align: "right" },
    { titre: "Sorties", poids: 9, align: "right" },
    { titre: "Brut fin", poids: 9, align: "right" },
    { titre: "Amort. début", poids: 9, align: "right" },
    { titre: "Dotations", poids: 9, align: "right" },
    { titre: "Amort. sortis", poids: 9, align: "right" },
    { titre: "Amort. fin", poids: 9, align: "right" },
    { titre: "VNC fin", poids: 9, align: "right" },
  ];
  const lignes = [];
  for (const g of data.groupes) {
    lignes.push({ cellules: [g.groupe, g.libelle, ...ecritureCellules(g)], gras: true, separateur: true });
    for (const l of g.lignes) lignes.push({ cellules: [l.code, `   ${l.libelle}${l.statut === "SORTIE" ? " (sorti)" : ""}`, ...ecritureCellules(l)] });
  }
  lignes.push({ cellules: ["", "TOTAL", ...ecritureCellules(data.totaux)], gras: true, separateur: true });
  const c = data.controle;
  return pdfTableau({
    entreprise,
    titre: "Tableau des immobilisations",
    sousTitre: `${data.exercice.libelle}${data.inclure_instance ? " — écritures en instance incluses" : ""}`,
    periode: { debut: data.exercice.date_debut, fin: data.exercice.date_fin },
    colonnes,
    lignes,
    notes: [
      `Contrôle brut : fiches ${fmt(c.brut_fiches, { zero: true })} / comptabilité ${fmt(c.brut_comptabilite, { zero: true })} — écart ${fmt(c.ecart_brut, { zero: true })} (attendu : 0).`,
      `Contrôle amortissements : fiches ${fmt(c.amort_fiches, { zero: true })} / comptabilité ${fmt(c.amort_comptabilite, { zero: true })} — écart ${fmt(c.ecart_amort, { zero: true })} (attendu : 0).`,
    ],
  });
}

module.exports = { bilanXlsx, bilanPdf, resultatXlsx, resultatPdf, immobilisationsXlsx, immobilisationsPdf };
