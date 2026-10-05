/**
 * Exports Excel et PDF de la balance des tiers (clients / fournisseurs) et de la
 * balance agee. Meme charte que comptaExports (Sage-like) ; PDF paysage pdfkit.
 */
const XLSX = require("xlsx");
const {
  fmt,
  nouveauPdf,
  tronquer,
  cadreEntete,
  maintenantTirage,
  dateJJMMAAbarre,
  feuilleAvecLargeurs,
  formaterNombres,
} = require("./comptaExports");

const nul = (v) => (v ? v : null);
const libelleType = (type) => (type === "CLIENT" ? "clients" : "fournisseurs");

/** Libelle d'une tranche : "Non échu" / "1 à 30 j" / "> 180 j". */
function libelleTranche(tr, mode) {
  if (tr.de === null) return mode === "FACTURE" ? "0 j et moins" : "Non échu";
  if (tr.a === null) return `> ${tr.de - 1} j`;
  return `${tr.de} à ${tr.a} j`;
}

// ---- Excel -----------------------------------------------------------------

function balanceTiersXlsx(data, entreprise) {
  const aoa = [];
  aoa.push([entreprise]);
  aoa.push([`Balance des ${libelleType(data.type)} — du ${dateJJMMAAbarre(data.periode.debut)} au ${dateJJMMAAbarre(data.periode.fin)}`]);
  aoa.push([null, null, null, `Solde au ${dateJJMMAAbarre(data.periode.debut)}`, null, "Mouvements", null, "Soldes cumulés", null]);
  aoa.push(["Code", "Nom", "Collectif", "Débit", "Crédit", "Débit", "Crédit", "Débit", "Crédit"]);
  for (const l of data.lignes) {
    aoa.push([
      l.code,
      l.nom,
      l.compte_collectif,
      nul(l.ouverture_debit),
      nul(l.ouverture_credit),
      nul(l.mouvement_debit),
      nul(l.mouvement_credit),
      nul(l.solde_debit),
      nul(l.solde_credit),
    ]);
  }
  const t = data.totaux;
  aoa.push([null, "TOTAUX", null, t.ouverture_debit, t.ouverture_credit, t.mouvement_debit, t.mouvement_credit, t.solde_debit, t.solde_credit]);
  aoa.push([]);
  aoa.push([null, "Solde des comptes collectifs", null, data.controle.solde_collectif]);
  aoa.push([null, "Écart avec la balance des tiers", null, data.controle.ecart]);
  const ws = feuilleAvecLargeurs(aoa, [12, 44, 12, 16, 16, 16, 16, 16, 16]);
  formaterNombres(ws, [3, 4, 5, 6, 7, 8], 4);
  ws["!merges"] = [
    { s: { r: 2, c: 3 }, e: { r: 2, c: 4 } },
    { s: { r: 2, c: 5 }, e: { r: 2, c: 6 } },
    { s: { r: 2, c: 7 }, e: { r: 2, c: 8 } },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Balance ${libelleType(data.type)}`.slice(0, 31));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function balanceAgeeXlsx(data, entreprise) {
  const noms = data.tranches.map((tr) => libelleTranche(tr, data.mode));
  const aoa = [];
  aoa.push([entreprise]);
  aoa.push([
    `Balance âgée des ${libelleType(data.type)} au ${dateJJMMAAbarre(data.date_arrete)} — ${
      data.mode === "FACTURE" ? "ancienneté depuis la date de pièce" : "retard par rapport à l'échéance"
    }`,
  ]);
  aoa.push(["Code", "Nom", ...noms, "Total", "Règlements non imputés", "Solde net", "Avances"]);
  for (const l of data.tiers) {
    aoa.push([l.code, l.nom, ...l.buckets.map(nul), l.total, nul(l.non_impute), l.solde_net, nul(l.avances)]);
  }
  const t = data.totaux;
  aoa.push([null, "TOTAUX", ...t.buckets, t.total, t.non_impute, t.solde_net, t.avances]);
  aoa.push([null, "Répartition (%)", ...data.pourcentages, 100]);
  aoa.push([]);
  aoa.push([null, "Montant échu", data.indicateurs.echu]);
  aoa.push([null, "Part échue (%)", data.indicateurs.part_echue_pct]);
  aoa.push([null, "Retard moyen pondéré (jours)", data.indicateurs.retard_moyen_jours]);
  aoa.push([null, "Au-delà de 90 jours", data.indicateurs.au_dela_90]);
  const nbCols = 2 + noms.length + 4;
  const ws = feuilleAvecLargeurs(aoa, [12, 40, ...noms.map(() => 15), 16, 18, 16, 14].slice(0, nbCols));
  formaterNombres(ws, Array.from({ length: nbCols - 2 }, (_, i) => i + 2), 3);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Balance âgée");

  // Detail des pieces ouvertes (si un seul tiers demande)
  const avecPieces = data.tiers.filter((x) => Array.isArray(x.pieces) && x.pieces.length);
  if (avecPieces.length) {
    const d = [["Tiers", "Pièce", "Libellé", "Date", "Échéance", "Montant", "Reste dû", "Jours", "Statut"]];
    for (const x of avecPieces) {
      for (const p of x.pieces) d.push([`${x.code} ${x.nom}`, p.piece, p.libelle, p.date, p.echeance, p.montant, p.restant, p.jours, p.statut]);
    }
    const wd = feuilleAvecLargeurs(d, [30, 16, 40, 12, 12, 16, 16, 8, 12]);
    formaterNombres(wd, [5, 6], 1);
    XLSX.utils.book_append_sheet(wb, wd, "Pièces ouvertes");
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ---- PDF -------------------------------------------------------------------

async function balanceTiersPdf(data, entreprise) {
  const { doc, fini } = nouveauPdf({ layout: "landscape" });
  const tirage = maintenantTirage();
  const { left, right } = doc.page.margins;
  const largeur = doc.page.width - left - right;
  const colCode = 56;
  const colCol = 56;
  const colMontant = 74;
  const colNom = largeur - colCode - colCol - colMontant * 6 - 6;
  const xs = { code: left, nom: left + colCode, col: left + colCode + colNom };
  const x1 = xs.col + colCol;
  const montants = ["od", "oc", "md", "mc", "sd", "sc"];
  montants.forEach((k, i) => (xs[k] = x1 + i * colMontant));
  const lh = 10.5;
  const bas = doc.page.height - 34;
  let page = 0;
  let y = 0;
  const cumul = { od: 0, oc: 0, md: 0, mc: 0, sd: 0, sc: 0 };

  function enteteColonnes() {
    doc.save();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
    doc.text("Code", xs.code, y + 8, { width: colCode, lineBreak: false });
    doc.text("Intitulé du tiers", xs.nom, y + 8, { width: colNom, align: "center", lineBreak: false });
    doc.text("Collectif", xs.col, y + 8, { width: colCol, lineBreak: false });
    doc.text(`Soldes au ${dateJJMMAAbarre(data.periode.debut)}`, xs.od, y, { width: colMontant * 2, align: "center", lineBreak: false });
    doc.text("Mouvements", xs.md, y, { width: colMontant * 2, align: "center", lineBreak: false });
    doc.text("Soldes cumulés", xs.sd, y, { width: colMontant * 2, align: "center", lineBreak: false });
    for (const k of montants) doc.text(k.endsWith("d") ? "Débit" : "Crédit", xs[k], y + 18, { width: colMontant - 4, align: "right", lineBreak: false });
    doc.moveTo(left - 4, y + 29).lineTo(left + largeur + 4, y + 29).lineWidth(0.5).stroke("#000");
    doc.restore();
    y += 36;
  }

  function pied(libelle, v) {
    doc.save();
    doc.moveTo(left - 4, y - 2).lineTo(left + largeur + 4, y - 2).lineWidth(0.5).stroke("#000");
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
    doc.text(libelle, xs.nom, y + 1, { width: colNom + colCol - 6, align: "right", lineBreak: false });
    for (const k of montants) doc.text(fmt(v[k]), xs[k], y + 1, { width: colMontant - 4, align: "right", lineBreak: false });
    doc.restore();
  }

  function nouvellePage(premiere = false) {
    if (!premiere) doc.addPage({ size: "A4", layout: "landscape", margins: doc.page.margins });
    page += 1;
    y = cadreEntete(doc, {
      entreprise,
      titre: `Balance des ${libelleType(data.type)}`,
      sousTitre: data.inclure_instance ? "Écritures en instance incluses" : "Écritures validées",
      periode: data.periode,
      deviseLibelle: "F CFA",
      numeroPage: page,
      tirage,
    });
    enteteColonnes();
    if (!premiere) {
      doc.save();
      doc.font("Helvetica-Bold").fontSize(7.5);
      doc.text("Report", xs.nom, y, { width: colNom + colCol - 6, align: "right", lineBreak: false });
      for (const k of montants) doc.text(fmt(cumul[k]), xs[k], y, { width: colMontant - 4, align: "right", lineBreak: false });
      doc.restore();
      y += lh + 2;
    }
  }

  nouvellePage(true);
  for (const l of data.lignes) {
    if (y + lh > bas - 14) {
      pied("A reporter", cumul);
      nouvellePage();
    }
    doc.save();
    doc.font("Helvetica").fontSize(7.5).fillColor("#000");
    doc.text(l.code, xs.code, y, { width: colCode, lineBreak: false });
    doc.text(tronquer(doc, l.nom, colNom - 6), xs.nom, y, { width: colNom - 6, lineBreak: false });
    doc.text(l.compte_collectif || "", xs.col, y, { width: colCol, lineBreak: false });
    const v = { od: l.ouverture_debit, oc: l.ouverture_credit, md: l.mouvement_debit, mc: l.mouvement_credit, sd: l.solde_debit, sc: l.solde_credit };
    for (const k of montants) {
      doc.text(fmt(v[k]), xs[k], y, { width: colMontant - 4, align: "right", lineBreak: false });
      cumul[k] += v[k] || 0;
    }
    doc.restore();
    y += lh;
  }
  if (y + 40 > bas) {
    pied("A reporter", cumul);
    nouvellePage();
  }
  y += 4;
  const t = data.totaux;
  pied("TOTAUX", { od: t.ouverture_debit, oc: t.ouverture_credit, md: t.mouvement_debit, mc: t.mouvement_credit, sd: t.solde_debit, sc: t.solde_credit });
  y += lh + 6;
  doc.save();
  doc.font("Helvetica").fontSize(7.5).fillColor("#000");
  doc.text(
    `Contrôle : solde des comptes collectifs ${fmt(data.controle.solde_collectif, { zero: true })} — balance des tiers ${fmt(data.controle.solde_tiers, { zero: true })} — écart ${fmt(data.controle.ecart, { zero: true })}`,
    xs.code,
    y,
    { width: largeur, lineBreak: false }
  );
  doc.restore();
  doc.end();
  return fini;
}

async function balanceAgeePdf(data, entreprise) {
  const { doc, fini } = nouveauPdf({ layout: "landscape" });
  const tirage = maintenantTirage();
  const { left, right } = doc.page.margins;
  const largeur = doc.page.width - left - right;
  const nb = data.tranches.length;
  const colCode = 52;
  const colMontant = 66;
  const nbCols = nb + 3; // tranches + total + non impute + solde net
  const colNom = largeur - colCode - colMontant * nbCols - 4;
  const xs = { code: left, nom: left + colCode };
  const x1 = xs.nom + colNom;
  const lh = 10.5;
  const bas = doc.page.height - 34;
  let page = 0;
  let y = 0;

  const titresColonnes = [...data.tranches.map((tr) => libelleTranche(tr, data.mode)), "Total", "Non imputé", "Solde net"];
  const xCol = (i) => x1 + i * colMontant;

  function enteteColonnes() {
    doc.save();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
    doc.text("Code", xs.code, y + 8, { width: colCode, lineBreak: false });
    doc.text("Intitulé du tiers", xs.nom, y + 8, { width: colNom, align: "center", lineBreak: false });
    titresColonnes.forEach((titre, i) => doc.text(titre, xCol(i), y + 8, { width: colMontant - 4, align: "right", lineBreak: false }));
    doc.moveTo(left - 4, y + 22).lineTo(left + largeur + 4, y + 22).lineWidth(0.5).stroke("#000");
    doc.restore();
    y += 28;
  }

  function nouvellePage(premiere = false) {
    if (!premiere) doc.addPage({ size: "A4", layout: "landscape", margins: doc.page.margins });
    page += 1;
    y = cadreEntete(doc, {
      entreprise,
      titre: `Balance âgée des ${libelleType(data.type)}`,
      sousTitre: data.mode === "FACTURE" ? "Ancienneté depuis la date de pièce" : "Retard par rapport à l'échéance",
      periode: { debut: data.date_arrete, fin: data.date_arrete },
      deviseLibelle: "F CFA",
      numeroPage: page,
      tirage,
    });
    enteteColonnes();
  }

  function ligne(code, nom, valeurs, gras) {
    doc.save();
    doc.font(gras ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).fillColor("#000");
    doc.text(code || "", xs.code, y, { width: colCode, lineBreak: false });
    doc.text(tronquer(doc, nom || "", colNom - 6), xs.nom, y, { width: colNom - 6, lineBreak: false });
    valeurs.forEach((v, i) => doc.text(typeof v === "string" ? v : fmt(v), xCol(i), y, { width: colMontant - 4, align: "right", lineBreak: false }));
    doc.restore();
    y += lh;
  }

  nouvellePage(true);
  for (const l of data.tiers) {
    if (y + lh > bas - 14) nouvellePage();
    ligne(l.code, l.nom, [...l.buckets, l.total, l.non_impute, l.solde_net], false);
  }
  if (y + 60 > bas) nouvellePage();
  doc.save();
  doc.moveTo(left - 4, y).lineTo(left + largeur + 4, y).lineWidth(0.5).stroke("#000");
  doc.restore();
  y += 3;
  const t = data.totaux;
  ligne("", "TOTAUX", [...t.buckets, t.total, t.non_impute, t.solde_net], true);
  ligne("", "Répartition", [...data.pourcentages.map((p) => `${String(p).replace(".", ",")} %`), "100 %"], false);
  y += 6;
  const i = data.indicateurs;
  doc.save();
  doc.font("Helvetica").fontSize(7.5).fillColor("#000");
  doc.text(
    `Montant échu : ${fmt(i.echu, { zero: true })} (${String(i.part_echue_pct).replace(".", ",")} %) — retard moyen pondéré : ${String(i.retard_moyen_jours).replace(".", ",")} j — au-delà de 90 j : ${fmt(i.au_dela_90, { zero: true })} (${String(i.part_au_dela_90_pct).replace(".", ",")} %)`,
    xs.code,
    y,
    { width: largeur, lineBreak: false }
  );
  if (data.controle.lignes_sans_tiers > 0) {
    y += 10;
    doc.text(
      `Attention : ${data.controle.lignes_sans_tiers} ligne(s) de comptes collectifs sans tiers (${fmt(data.controle.solde_sans_tiers, { zero: true })}) ne figurent pas dans cette balance.`,
      xs.code,
      y,
      { width: largeur, lineBreak: false }
    );
  }
  doc.restore();
  doc.end();
  return fini;
}

module.exports = { balanceTiersXlsx, balanceAgeeXlsx, balanceTiersPdf, balanceAgeePdf, libelleTranche };
