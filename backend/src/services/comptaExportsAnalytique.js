/**
 * Exports Excel et PDF des etats analytiques (phase 3C) : resultat par dossier,
 * detail d'un dossier, grand livre analytique. Meme charte que comptaExports.
 */
const XLSX = require("xlsx");
const { fmt, nouveauPdf, tronquer, cadreEntete, maintenantTirage, dateJJMMAAbarre, feuilleAvecLargeurs, formaterNombres } = require("./comptaExports");

const nul = (v) => (v ? v : null);
const pct = (v) => (v === null || v === undefined ? "" : `${String(v).replace(".", ",")} %`);
const TYPES = { AO: "AO", CONSULTATION: "Consultation", LIBRE: "Affaire" };

/**
 * PDF tabulaire generique. colonnes : [{ titre, poids, align }] ; lignes :
 * [{ cellules: [...], gras }] ; notes : lignes de texte sous le tableau.
 */
async function pdfTableau({ entreprise, titre, sousTitre, periode, colonnes, lignes, notes = [], layout = "landscape" }) {
  const { doc, fini } = nouveauPdf({ layout });
  const tirage = maintenantTirage();
  const { left, right } = doc.page.margins;
  const largeur = doc.page.width - left - right;
  const totalPoids = colonnes.reduce((a, c) => a + c.poids, 0);
  const xs = [];
  const ws = [];
  let x = left;
  for (const c of colonnes) {
    const w = (largeur * c.poids) / totalPoids;
    xs.push(x);
    ws.push(w);
    x += w;
  }
  const lh = 10.5;
  const bas = doc.page.height - 34;
  let page = 0;
  let y = 0;

  function nouvellePage(premiere = false) {
    if (!premiere) doc.addPage({ size: "A4", layout, margins: doc.page.margins });
    page += 1;
    y = cadreEntete(doc, { entreprise, titre, sousTitre, periode, deviseLibelle: "F CFA", numeroPage: page, tirage });
    doc.save();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
    colonnes.forEach((c, i) => doc.text(c.titre, xs[i], y, { width: ws[i] - 4, align: c.align || "left", lineBreak: false }));
    doc.moveTo(left - 4, y + 11).lineTo(left + largeur + 4, y + 11).lineWidth(0.5).stroke("#000");
    doc.restore();
    y += 16;
  }

  nouvellePage(true);
  for (const l of lignes) {
    if (y + lh > bas - 14) nouvellePage();
    doc.save();
    doc.font(l.gras ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).fillColor("#000");
    if (l.separateur) doc.moveTo(left - 4, y - 1).lineTo(left + largeur + 4, y - 1).lineWidth(0.5).stroke("#000");
    l.cellules.forEach((v, i) => {
      const c = colonnes[i];
      const texte = typeof v === "number" ? fmt(v, { zero: false }) : String(v ?? "");
      doc.text(c.align === "right" ? texte : tronquer(doc, texte, ws[i] - 6), xs[i], y, { width: ws[i] - 4, align: c.align || "left", lineBreak: false });
    });
    doc.restore();
    y += lh;
  }
  y += 6;
  for (const n of notes) {
    if (y + lh > bas) nouvellePage();
    doc.save();
    doc.font("Helvetica").fontSize(7.5).fillColor("#000");
    doc.text(n, left, y, { width: largeur, lineBreak: false });
    doc.restore();
    y += lh;
  }
  doc.end();
  return fini;
}

// ---- Resultat par dossier --------------------------------------------------

function balanceAnalytiqueXlsx(data, entreprise) {
  const aoa = [];
  aoa.push([entreprise]);
  aoa.push([`Résultat par dossier — du ${dateJJMMAAbarre(data.periode.debut)} au ${dateJJMMAAbarre(data.periode.fin)}`]);
  aoa.push(["Code", "Dossier", "Type", "Produits", "Charges", "Résultat", "Marge %"]);
  for (const l of data.lignes) aoa.push([l.code, l.libelle, TYPES[l.type_section] || l.type_section, nul(l.produits), nul(l.charges), l.resultat, l.marge_pct]);
  const na = data.non_affecte;
  aoa.push(["", "Non affecté", "", nul(na.produits), nul(na.charges), na.resultat, null]);
  const t = data.totaux;
  aoa.push([null, "TOTAL (comptabilité générale)", null, t.produits, t.charges, t.resultat, null]);
  const ws = feuilleAvecLargeurs(aoa, [12, 56, 14, 18, 18, 18, 10]);
  formaterNombres(ws, [3, 4, 5], 3);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Résultat par dossier");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function balanceAnalytiquePdf(data, entreprise) {
  const colonnes = [
    { titre: "Code", poids: 7 },
    { titre: "Dossier", poids: 36 },
    { titre: "Type", poids: 9 },
    { titre: "Produits", poids: 13, align: "right" },
    { titre: "Charges", poids: 13, align: "right" },
    { titre: "Résultat", poids: 13, align: "right" },
    { titre: "Marge", poids: 8, align: "right" },
  ];
  const lignes = data.lignes.map((l) => ({ cellules: [l.code, l.libelle, TYPES[l.type_section] || l.type_section, l.produits, l.charges, fmt(l.resultat, { zero: true }), pct(l.marge_pct)] }));
  const na = data.non_affecte;
  lignes.push({ cellules: ["", "Non affecté", "", na.produits, na.charges, fmt(na.resultat, { zero: true }), ""], separateur: true });
  const t = data.totaux;
  lignes.push({ cellules: ["", "TOTAL (comptabilité générale)", "", t.produits, t.charges, fmt(t.resultat, { zero: true }), ""], gras: true, separateur: true });
  return pdfTableau({
    entreprise,
    titre: "Résultat par dossier",
    sousTitre: data.inclure_instance ? "Écritures en instance incluses" : "Écritures validées",
    periode: data.periode,
    colonnes,
    lignes,
    notes: [`Contrôle : écart produits ${fmt(data.controle.ecart_produits, { zero: true })} — écart charges ${fmt(data.controle.ecart_charges, { zero: true })} (attendu : 0).`],
  });
}

// ---- Detail d'un dossier ---------------------------------------------------

function resultatDossierXlsx(data, entreprise) {
  const aoa = [];
  aoa.push([entreprise]);
  aoa.push([`Dossier ${data.section.code} — ${data.section.libelle}`]);
  aoa.push([`Du ${dateJJMMAAbarre(data.periode.debut)} au ${dateJJMMAAbarre(data.periode.fin)}`]);
  aoa.push(["Compte", "Libellé", "Montant"]);
  aoa.push(["", "PRODUITS", null]);
  for (const l of data.produits) aoa.push([l.numero, l.libelle, l.montant]);
  aoa.push(["", "Total produits", data.total_produits]);
  aoa.push(["", "CHARGES", null]);
  for (const l of data.charges) aoa.push([l.numero, l.libelle, l.montant]);
  aoa.push(["", "Total charges", data.total_charges]);
  aoa.push(["", "RÉSULTAT", data.resultat]);
  aoa.push(["", "Marge %", data.marge_pct]);
  const ws = feuilleAvecLargeurs(aoa, [14, 60, 18]);
  formaterNombres(ws, [2], 4);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dossier");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function resultatDossierPdf(data, entreprise) {
  const colonnes = [
    { titre: "Compte", poids: 12 },
    { titre: "Libellé", poids: 70 },
    { titre: "Montant", poids: 18, align: "right" },
  ];
  const lignes = [{ cellules: ["", "PRODUITS", ""], gras: true }];
  data.produits.forEach((l) => lignes.push({ cellules: [l.numero, l.libelle, l.montant] }));
  lignes.push({ cellules: ["", "Total produits", data.total_produits], gras: true, separateur: true });
  lignes.push({ cellules: ["", "CHARGES", ""], gras: true });
  data.charges.forEach((l) => lignes.push({ cellules: [l.numero, l.libelle, l.montant] }));
  lignes.push({ cellules: ["", "Total charges", data.total_charges], gras: true, separateur: true });
  lignes.push({ cellules: ["", `RÉSULTAT${data.marge_pct !== null ? ` (marge ${pct(data.marge_pct)})` : ""}`, fmt(data.resultat, { zero: true })], gras: true, separateur: true });
  return pdfTableau({
    entreprise,
    titre: `Dossier ${data.section.code}`,
    sousTitre: data.section.libelle,
    periode: data.periode,
    colonnes,
    lignes,
    layout: "portrait",
  });
}

// ---- Grand livre analytique -----------------------------------------------

function grandLivreAnalytiqueXlsx(data, entreprise) {
  const aoa = [];
  aoa.push([entreprise]);
  aoa.push([`Grand livre analytique — dossier ${data.section.code} ${data.section.libelle}`]);
  aoa.push([`Du ${dateJJMMAAbarre(data.periode.debut)} au ${dateJJMMAAbarre(data.periode.fin)}`]);
  aoa.push(["Date", "Journal", "Pièce", "Compte", "Libellé compte", "Libellé", "Débit", "Crédit", "Statut"]);
  for (const l of data.lignes) aoa.push([l.date, l.journal, l.piece, l.compte_numero, l.compte_libelle, l.libelle, nul(l.debit), nul(l.credit), l.statut]);
  aoa.push([null, null, null, null, null, "TOTAUX", data.totaux.debit, data.totaux.credit, null]);
  aoa.push([null, null, null, null, null, "Solde (débit - crédit)", data.totaux.solde, null, null]);
  const ws = feuilleAvecLargeurs(aoa, [12, 9, 16, 12, 34, 44, 16, 16, 12]);
  formaterNombres(ws, [6, 7], 4);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Grand livre analytique");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function grandLivreAnalytiquePdf(data, entreprise) {
  const colonnes = [
    { titre: "Date", poids: 9 },
    { titre: "Jnl", poids: 5 },
    { titre: "N° pièce", poids: 12 },
    { titre: "Compte", poids: 9 },
    { titre: "Libellé", poids: 37 },
    { titre: "Débit", poids: 14, align: "right" },
    { titre: "Crédit", poids: 14, align: "right" },
  ];
  const lignes = data.lignes.map((l) => ({ cellules: [dateJJMMAAbarre(l.date), l.journal, l.piece, l.compte_numero, l.libelle, l.debit, l.credit] }));
  lignes.push({ cellules: ["", "", "", "", "TOTAUX", data.totaux.debit, data.totaux.credit], gras: true, separateur: true });
  return pdfTableau({
    entreprise,
    titre: "Grand livre analytique",
    sousTitre: `${data.section.code} - ${data.section.libelle}`,
    periode: data.periode,
    colonnes,
    lignes,
    notes: [`Solde (débit - crédit) : ${fmt(data.totaux.solde, { zero: true })}`],
  });
}

module.exports = {
  balanceAnalytiqueXlsx,
  balanceAnalytiquePdf,
  resultatDossierXlsx,
  resultatDossierPdf,
  grandLivreAnalytiqueXlsx,
  grandLivreAnalytiquePdf,
};
