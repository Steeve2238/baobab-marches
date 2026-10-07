/**
 * Exports de la declaration de TVA (module Fiscalite) :
 *   - PDF : le formulaire DGID (lignes L5 a L120) puis les annexes (exonerations, precompte, deductions par
 *     fournisseur, importations). Filigrane "BROUILLON" tant que la declaration n'est pas marquee deposee.
 *   - Excel : une feuille par etat (declaration, ventes, exonerations, precompte, achats locaux, importations).
 */
const XLSX = require("xlsx");
const { fmt, nouveauPdf, tronquer, dateJJMMAAbarre, feuilleAvecLargeurs, formaterNombres } = require("./comptaExports");

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** Libelles du formulaire (reproduits tels que sur l'imprime DGID). */
const LIGNES = [
  [5, "Montant des opérations", null],
  [10, "Affaires à l'exportation", "EXPORTATIONS"],
  [15, "Affaires réalisées à l'intérieur non taxées", "EXONERATIONS"],
  [20, "Affaires réalisées en suspension de la TVA", "SUSPENSIONS"],
  [25, "Total affaires non soumises à la TVA (L10+L15+L20)", null],
  [30, "Prélèvements et livraisons ou prestations à soi-même", null],
  [35, "Montant Total Taxable (L5-L25)", null],
  [40, "Montant taxable - Taux réduit", null],
  [45, "Montant taxable - Taux Normal (L35-L40)", null],
  [50, "Montant de la TVA - Taux Réduit (L40*10%)", null],
  [55, "Montant de la TVA - Taux Normal (L45*18%)", null],
  [60, "Montant de la TVA Brut (L50+L55)", null],
  [65, "Affaires soumises au précompte", null],
  [70, "Précompte de TVA", "TVA PRECOMPTEE"],
  [75, "Imputation de chèques DDI", null],
  [76, "Total des avances (L70+L75)", null],
  [80, "Montant des importations du mois", null],
  [85, "TVA acquittée sur les importations du mois", "IMPORTATIONS"],
  [90, "TVA acquittée sur les achats intérieurs du mois", "ACHATS LOCAUX"],
  [91, "Déductions sur achats (L85+L90)", null],
  [92, "Total déductions pour le mois (L76+L91)", null],
  [93, "Solde total exigible pour la période", null],
  [95, "Montant des remboursements demandés et accordés", null],
  [100, "Crédit de TVA du mois précédent", null],
  [105, "Montant total déductible pour le mois (L70+L75+L85+L90+L100)", null],
  [110, "Solde Total Exigible (L60-L105 si positif)", null],
  [115, "Crédit de TVA à reporter (L105-L60 si positif)", null],
  [120, "Montant des remboursements demandés et en instruction", null],
];

const titrePeriode = (p) => `${MOIS[p.mois - 1]} ${p.annee}`;

function libelleLigne(n, libelle, profil) {
  if (profil && n === 50) return `Montant de la TVA - Taux Réduit (L40*${profil.taux_tva_reduit}%)`;
  if (profil && n === 55) return `Montant de la TVA - Taux Normal (L45*${profil.taux_tva_normal}%)`;
  return libelle;
}

// ---- Excel -------------------------------------------------------------------

function tvaXlsx(calcul, declaration) {
  const wb = XLSX.utils.book_new();
  const p = calcul.periode;
  const c = calcul.contribuable;
  const L = declaration ? declaration.lignes : calcul.lignes;
  const d = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) : null);

  const aoa = [
    [c.raison_sociale],
    [`Déclaration de TVA — ${titrePeriode(p)}${declaration && declaration.statut === "PREPAREE" ? " (préparée)" : declaration ? ` (${declaration.statut === "DEPOSEE" ? "déposée" : "payée"})` : " (brouillon)"}`],
    [`NINEA : ${c.ninea || "—"}   ·   Période du ${dateJJMMAAbarre(p.debut)} au ${dateJJMMAAbarre(p.fin)}   ·   Date limite de dépôt et de paiement : ${dateJJMMAAbarre(p.date_limite)}`],
    [],
    ["Ligne", "Désignation", "Annexe fiscale", "Montant"],
  ];
  const debutDonnees = aoa.length;
  for (const [n, lib, annexe] of LIGNES) aoa.push([`L${n}`, libelleLigne(n, lib, calcul.profil), annexe, L[n] ?? 0]);
  const ws = feuilleAvecLargeurs(aoa, [8, 66, 18, 18]);
  formaterNombres(ws, [3], debutDonnees);
  wb.SheetNames.push("Déclaration");
  wb.Sheets["Déclaration"] = ws;

  // Ventes
  const av = [["N° facture", "Date", "Client", "NINEA client", "Type", "Taux %", "TTC retenu", "HT", "TVA", "Code opération", "Précompte", "Écriture"]];
  for (const v of calcul.ventes) {
    av.push([v.numero, d(v.date), v.client_nom, v.client_ninea, v.type_facturation, v.taux, v.ttc, v.ht, v.tva, v.code_operation, v.precompte || null, v.ecriture_statut || "Non comptabilisée"]);
  }
  const wsv = feuilleAvecLargeurs(av, [16, 11, 34, 16, 12, 8, 15, 15, 14, 14, 13, 16]);
  formaterNombres(wsv, [6, 7, 8, 10], 1);
  XLSX.utils.book_append_sheet(wb, wsv, "Ventes");

  // Exonérations
  const ae = [["Code", "N° facture", "Date", "Client", "NINEA", "Motif", "Base HT"]];
  for (const x of calcul.annexes.exonerations) ae.push([x.code_libelle, x.numero, d(x.date), x.client_nom, x.client_ninea, x.motif, x.base]);
  const wse = feuilleAvecLargeurs(ae, [22, 16, 11, 34, 16, 28, 16]);
  formaterNombres(wse, [6], 1);
  XLSX.utils.book_append_sheet(wb, wse, "État des exonérations");

  // Précompte
  const ap = [["N° facture", "Date", "Client", "NINEA", "Base HT", "TVA facturée", "Précompte retenu"]];
  for (const x of calcul.annexes.precompte) ap.push([x.numero, d(x.date), x.client_nom, x.client_ninea, x.base, x.tva_facturee, x.precompte]);
  const wsp = feuilleAvecLargeurs(ap, [16, 11, 34, 16, 16, 15, 16]);
  formaterNombres(wsp, [4, 5, 6], 1);
  XLSX.utils.book_append_sheet(wb, wsp, "Précompte");

  // Achats locaux par fournisseur
  const al = [["Fournisseur", "NINEA", "Nb factures", "Base HT", "TVA facturée", "TVA déductible", "TVA non déductible"]];
  for (const x of calcul.annexes.achats_locaux) al.push([x.fournisseur_nom, x.ninea, x.nombre, x.base, x.tva, x.tva_deductible, x.tva_non_deductible]);
  const wsl = feuilleAvecLargeurs(al, [36, 16, 11, 16, 15, 16, 18]);
  formaterNombres(wsl, [3, 4, 5, 6], 1);
  XLSX.utils.book_append_sheet(wb, wsl, "Achats locaux");

  // Détail des achats
  const aa = [["N° interne", "Réf. fournisseur", "Date", "Fournisseur", "NINEA", "Type", "Base", "TVA", "Déductible", "Motif"]];
  for (const a of calcul.achats) {
    aa.push([a.numero, a.reference_fournisseur, d(a.date), a.fournisseur_nom, a.fournisseur_ninea, a.type_operation === "IMPORT" ? "Importation" : "Local", a.base, a.tva, a.deductible ? "Oui" : "Non", a.motif_non_deductible]);
  }
  const wsa = feuilleAvecLargeurs(aa, [14, 18, 11, 34, 16, 12, 15, 14, 11, 30]);
  formaterNombres(wsa, [6, 7], 1);
  XLSX.utils.book_append_sheet(wb, wsa, "Détail achats");

  // Importations
  const ai = [["N° interne", "Réf. fournisseur", "Date", "Fournisseur", "Base (valeur en douane)", "TVA acquittée", "Déductible"]];
  for (const x of calcul.annexes.importations) ai.push([x.numero, x.reference_fournisseur, d(x.date), x.fournisseur_nom, x.base, x.tva, x.deductible ? "Oui" : "Non"]);
  const wsi = feuilleAvecLargeurs(ai, [14, 18, 11, 34, 22, 15, 11]);
  formaterNombres(wsi, [4, 5], 1);
  XLSX.utils.book_append_sheet(wb, wsi, "Importations");

  for (const nom of wb.SheetNames) {
    const ws2 = wb.Sheets[nom];
    const plage = ws2["!ref"] ? XLSX.utils.decode_range(ws2["!ref"]) : null;
    if (!plage) continue;
    for (let r = 0; r <= plage.e.r; r++) {
      for (let col = 0; col <= plage.e.c; col++) {
        const cell = ws2[XLSX.utils.encode_cell({ r, c: col })];
        if (cell && cell.t === "d") cell.z = "dd/mm/yyyy";
      }
    }
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true });
}

// ---- PDF -----------------------------------------------------------------------

async function tvaPdf(calcul, declaration) {
  const { doc, fini } = nouveauPdf({ margins: { top: 34, bottom: 28, left: 40, right: 40 } });
  const p = calcul.periode;
  const c = calcul.contribuable;
  const L = declaration ? declaration.lignes : calcul.lignes;
  const brouillon = !declaration || declaration.statut === "PREPAREE";
  const largeur = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x0 = doc.page.margins.left;

  function filigrane() {
    if (!brouillon) return;
    doc.save();
    doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font("Helvetica-Bold").fontSize(70).fillColor("#cfcfcf").opacity(0.35);
    doc.text("BROUILLON", 0, doc.page.height / 2 - 40, { width: doc.page.width, align: "center", lineBreak: false });
    doc.restore();
    doc.opacity(1);
  }

  // ---- Page 1 : le formulaire
  filigrane();
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#000").text("RÉPUBLIQUE DU SÉNÉGAL", x0, 34, { lineBreak: false });
  doc.font("Helvetica").fontSize(8).text("Un Peuple - Un But - Une Foi", x0, 45, { lineBreak: false });
  doc.font("Helvetica").fontSize(8).text("DGID - Ministère des Finances et du Budget", x0, 56, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(14).text("TAXE SUR LA VALEUR AJOUTÉE", x0, 82, { width: largeur, align: "center", lineBreak: false });
  doc.font("Helvetica-Oblique").fontSize(8).fillColor("#555").text("Aide à la déclaration — à reporter sur le portail de la DGID", x0, 100, { width: largeur, align: "center", lineBreak: false });
  doc.moveTo(x0, 114).lineTo(x0 + largeur, 114).lineWidth(0.7).stroke("#000");

  const info = [
    ["NINEA", c.ninea || "—", "Période d'imposition", titrePeriode(p).toUpperCase()],
    ["Nom du contribuable", c.raison_sociale, "Type de taxe", "TAXE SUR LA VALEUR AJOUTÉE"],
    ["Centre fiscal", calcul.profil.centre_fiscal || "—", "Début / fin de période", `${dateJJMMAAbarre(p.debut)} au ${dateJJMMAAbarre(p.fin)}`],
    ["Date limite de dépôt", dateJJMMAAbarre(p.date_limite), "Date limite de paiement", dateJJMMAAbarre(p.date_limite)],
  ];
  let y = 124;
  for (const [a, b, c2, d2] of info) {
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000").text(a, x0, y, { width: 110, lineBreak: false });
    doc.font("Helvetica").text(tronquer(doc, b, 150), x0 + 110, y, { width: 150, lineBreak: false });
    doc.font("Helvetica-Bold").text(c2, x0 + 280, y, { width: 100, lineBreak: false });
    doc.font("Helvetica").text(tronquer(doc, d2, 130), x0 + 385, y, { width: 130, lineBreak: false });
    y += 13;
  }
  y += 6;
  doc.moveTo(x0, y).lineTo(x0 + largeur, y).lineWidth(0.5).stroke("#000");
  y += 6;
  doc.font("Helvetica-Bold").fontSize(8).text("Annexe fiscale", x0 + 300, y, { width: 90, lineBreak: false });
  doc.text("Ligne", x0 + 400, y, { width: 40, align: "center", lineBreak: false });
  doc.text("Montant", x0 + 440, y, { width: largeur - 440, align: "right", lineBreak: false });
  y += 13;
  const hl = 15.2;
  for (const [n, lib, annexe] of LIGNES) {
    const total = [25, 35, 60, 76, 91, 92, 105, 110, 115].includes(n);
    doc.font(total ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor("#000");
    doc.text(tronquer(doc, libelleLigne(n, lib, calcul.profil), 290), x0, y, { width: 292, lineBreak: false });
    if (annexe) doc.font("Helvetica").fontSize(7).fillColor("#444").text(annexe, x0 + 300, y + 0.5, { width: 95, lineBreak: false });
    doc.font("Helvetica").fontSize(7).fillColor("#888").text("........", x0 + 395, y + 1, { width: 18, lineBreak: false });
    doc.font(total ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor("#000").text(String(n), x0 + 400, y, { width: 40, align: "center", lineBreak: false });
    const valeur = L[n] ?? 0;
    doc.text(fmt(valeur, { zero: [110, 115, 60].includes(n) }), x0 + 440, y, { width: largeur - 440, align: "right", lineBreak: false });
    y += hl;
  }
  y += 6;
  doc.font("Helvetica-Oblique").fontSize(7).fillColor("#555");
  doc.text(
    `Document établi par Baobab Marchés le ${dateJJMMAAbarre(new Date().toISOString().slice(0, 10))}${brouillon ? " — brouillon à valider avant dépôt" : ""}. Montants en francs CFA (XOF), arrondis au franc.`,
    x0,
    y,
    { width: largeur, lineBreak: false }
  );
  const annexesVides = [
    ["exonérations", calcul.annexes.exonerations],
    ["précompte", calcul.annexes.precompte],
    ["achats locaux", calcul.annexes.achats_locaux],
    ["importations", calcul.annexes.importations],
  ].filter(([, tab]) => tab.length === 0).map(([n]) => n);
  if (annexesVides.length > 0) {
    y += 10;
    doc.text(`Annexes sans opération sur la période : ${annexesVides.join(", ")}.`, x0, y, { width: largeur, lineBreak: false });
  }
  if (declaration && declaration.date_depot) {
    y += 10;
    doc.text(`Déposée le ${dateJJMMAAbarre(declaration.date_depot)}${declaration.reference_depot ? ` — réf. ${declaration.reference_depot}` : ""}.`, x0, y, { width: largeur, lineBreak: false });
  }

  // ---- Pages d'annexes
  function nouvellePage(titre) {
    doc.addPage();
    filigrane();
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(titre, x0, 34, { lineBreak: false });
    doc.font("Helvetica").fontSize(8).text(`${c.raison_sociale} — NINEA ${c.ninea || "—"} — TVA ${titrePeriode(p)}`, x0, 49, { lineBreak: false });
    doc.moveTo(x0, 62).lineTo(x0 + largeur, 62).lineWidth(0.5).stroke("#000");
    return 70;
  }
  const bas = doc.page.height - 36;

  function tableau(titre, colonnes, lignes, totaux) {
    // Annexe sans opération : pas de page vide (mentionnée en pied du formulaire).
    if (lignes.length === 0) return;
    let yy = nouvellePage(titre);
    const xs = [];
    let cx = x0;
    for (const col of colonnes) {
      xs.push(cx);
      cx += col.w;
    }
    const enTete = () => {
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
      colonnes.forEach((col, i) => doc.text(col.titre, xs[i] + 1, yy, { width: col.w - 4, align: col.al || "left", lineBreak: false }));
      doc.moveTo(x0, yy + 11).lineTo(x0 + largeur, yy + 11).lineWidth(0.4).stroke("#000");
      yy += 15;
    };
    enTete();
    if (lignes.length === 0) {
      doc.font("Helvetica").fontSize(8).text("Aucune opération sur la période.", x0 + 1, yy, { lineBreak: false });
      return;
    }
    for (const l of lignes) {
      if (yy + 11 > bas) {
        yy = nouvellePage(`${titre} (suite)`);
        enTete();
      }
      doc.font("Helvetica").fontSize(7.5).fillColor("#000");
      colonnes.forEach((col, i) => {
        const v = l[col.cle];
        const texte = col.nombre ? fmt(v, { zero: true }) : tronquer(doc, v === null || v === undefined ? "" : String(v), col.w - 5);
        doc.text(texte, xs[i] + 1, yy, { width: col.w - 4, align: col.al || "left", lineBreak: false });
      });
      yy += 11;
    }
    if (totaux) {
      if (yy + 14 > bas) yy = nouvellePage(`${titre} (suite)`);
      doc.moveTo(x0, yy).lineTo(x0 + largeur, yy).lineWidth(0.4).stroke("#000");
      yy += 3;
      doc.font("Helvetica-Bold").fontSize(7.5);
      colonnes.forEach((col, i) => {
        if (totaux[col.cle] !== undefined) doc.text(col.nombre ? fmt(totaux[col.cle], { zero: true }) : String(totaux[col.cle]), xs[i] + 1, yy, { width: col.w - 4, align: col.al || "left", lineBreak: false });
      });
    }
  }

  const somme = (tab, k) => tab.reduce((s, x) => s + Number(x[k] || 0), 0);
  const ex = calcul.annexes.exonerations.map((x) => ({ ...x, date: dateJJMMAAbarre(x.date), ninea: x.client_ninea || "NINEA ?" }));
  tableau(
    "Annexe — État des exonérations, exportations et suspensions",
    [
      { titre: "Nature", cle: "code_libelle", w: 100 },
      { titre: "N° facture", cle: "numero", w: 70 },
      { titre: "Date", cle: "date", w: 50 },
      { titre: "Client", cle: "client_nom", w: 140 },
      { titre: "NINEA", cle: "ninea", w: 70 },
      { titre: "Base HT", cle: "base", w: 85, al: "right", nombre: true },
    ],
    ex,
    { code_libelle: "TOTAL", base: somme(ex, "base") }
  );
  const pr = calcul.annexes.precompte.map((x) => ({ ...x, date: dateJJMMAAbarre(x.date), ninea: x.client_ninea || "NINEA ?" }));
  tableau(
    "Annexe — TVA précomptée",
    [
      { titre: "N° facture", cle: "numero", w: 80 },
      { titre: "Date", cle: "date", w: 55 },
      { titre: "Client", cle: "client_nom", w: 150 },
      { titre: "NINEA", cle: "ninea", w: 75 },
      { titre: "Base HT", cle: "base", w: 70, al: "right", nombre: true },
      { titre: "Précompte", cle: "precompte", w: 85, al: "right", nombre: true },
    ],
    pr,
    { numero: "TOTAL", base: somme(pr, "base"), precompte: somme(pr, "precompte") }
  );
  const al = calcul.annexes.achats_locaux.map((x) => ({ ...x, ninea: x.ninea || "NINEA ?" }));
  tableau(
    "Annexe — TVA déductible sur achats locaux, par fournisseur",
    [
      { titre: "Fournisseur", cle: "fournisseur_nom", w: 150 },
      { titre: "NINEA", cle: "ninea", w: 70 },
      { titre: "Nb", cle: "nombre", w: 28, al: "right" },
      { titre: "Base HT", cle: "base", w: 80, al: "right", nombre: true },
      { titre: "TVA facturée", cle: "tva", w: 75, al: "right", nombre: true },
      { titre: "TVA déductible", cle: "tva_deductible", w: 85, al: "right", nombre: true },
    ],
    al,
    { fournisseur_nom: "TOTAL", base: somme(al, "base"), tva: somme(al, "tva"), tva_deductible: somme(al, "tva_deductible") }
  );
  const im = calcul.annexes.importations.map((x) => ({ ...x, date: dateJJMMAAbarre(x.date), ded: x.deductible ? "Oui" : "Non" }));
  tableau(
    "Annexe — Importations",
    [
      { titre: "N° interne", cle: "numero", w: 70 },
      { titre: "Date", cle: "date", w: 55 },
      { titre: "Fournisseur", cle: "fournisseur_nom", w: 160 },
      { titre: "Base (douane)", cle: "base", w: 90, al: "right", nombre: true },
      { titre: "TVA acquittée", cle: "tva", w: 90, al: "right", nombre: true },
      { titre: "Déd.", cle: "ded", w: 40 },
    ],
    im,
    { numero: "TOTAL", base: somme(im, "base"), tva: somme(im, "tva") }
  );
  doc.end();
  return fini;
}

module.exports = { tvaXlsx, tvaPdf, LIGNES };
