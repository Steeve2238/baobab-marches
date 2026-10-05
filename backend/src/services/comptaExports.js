/**
 * Exports Excel et PDF du grand livre et de la balance generale, a l'image des
 * editions Sage 100 recues en reference (chantier comptabilite, 04/10/2026) :
 *   - balance : trois blocs de colonnes (soldes au debut, mouvements, soldes
 *     cumules), lignes `*** libelle` de sous-total par famille, "A reporter" /
 *     "Report" en bas et en haut de page ;
 *   - grand livre : date JJMMAA, code journal, n° de piece, libelle, lettrage,
 *     mouvements debit/credit et solde progressif, "Total compte ..." par compte
 *     et par famille.
 * Le PDF est genere cote serveur avec pdfkit (aucun navigateur sans tete : voir
 * la contrainte de processus de l'hebergement mutualise).
 */
const XLSX = require("xlsx");
const PDFDocument = require("pdfkit");

// ----------------------------------------------------------------------------
// Formats
// ----------------------------------------------------------------------------

/** 1234567.5 -> "1 234 567,50" ; entiers sans decimales ; 0/vide -> "". */
function fmt(n, { zero = false } = {}) {
  if (n === null || n === undefined || n === "") return "";
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  if (v === 0 && !zero) return "";
  const negatif = v < 0;
  const abs = Math.abs(v);
  const entier = Math.floor(abs + 1e-9);
  const centimes = Math.round((abs - entier) * 100);
  let texte = String(entier).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  if (centimes > 0) texte += `,${String(centimes).padStart(2, "0")}`;
  return (negatif ? "-" : "") + texte;
}

function dateJJMMAA(iso) {
  const [a, m, j] = String(iso).slice(0, 10).split("-");
  return `${j}${m}${a.slice(2)}`;
}

function dateJJMMAAAA(iso) {
  const [a, m, j] = String(iso).slice(0, 10).split("-");
  return `${j}/${m}/${a}`;
}

function dateJJMMAAbarre(iso) {
  const [a, m, j] = String(iso).slice(0, 10).split("-");
  return `${j}/${m}/${a.slice(2)}`;
}

function maintenantTirage() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return {
    date: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`,
    heure: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
  };
}

function isoVersDate(iso) {
  const [a, m, j] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, j));
}

// ----------------------------------------------------------------------------
// Excel
// ----------------------------------------------------------------------------

function feuilleAvecLargeurs(aoa, largeurs) {
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  ws["!cols"] = largeurs.map((wch) => ({ wch }));
  return ws;
}

function formaterNombres(ws, colonnes, depuisLigne) {
  const plage = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = depuisLigne; r <= plage.e.r; r++) {
    for (const c of colonnes) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") cell.z = "#,##0.00;-#,##0.00";
    }
  }
}

/** Balance generale au format Sage (Excel). */
function balanceXlsx(data, entreprise) {
  const debut = dateJJMMAAbarre(data.periode.debut);
  const aoa = [];
  aoa.push([entreprise]);
  aoa.push([null, null, `Solde au ${debut}`, null, "Mouvements", null, "Soldes cumulés", null]);
  aoa.push(["compte", null, "Débit", "Crédit", "Débit", "Crédit", "Débit", "Crédit"]);
  const nul = (v) => (v ? v : null);
  for (const l of data.lignes) {
    if (l.type === "compte") {
      aoa.push([
        l.numero,
        l.libelle,
        nul(l.ouverture_debit),
        nul(l.ouverture_credit),
        nul(l.mouvement_debit),
        nul(l.mouvement_credit),
        nul(l.solde_debit),
        nul(l.solde_credit),
      ]);
    } else {
      aoa.push([
        l.prefixe,
        `${l.niveau === 3 ? "**" : "***"} ${l.libelle}`,
        nul(l.ouverture_debit),
        nul(l.ouverture_credit),
        nul(l.mouvement_debit),
        nul(l.mouvement_credit),
        nul(l.solde_debit),
        nul(l.solde_credit),
      ]);
    }
  }
  const t = data.totaux;
  aoa.push([
    null,
    "TOTAUX",
    t.ouverture_debit,
    t.ouverture_credit,
    t.mouvement_debit,
    t.mouvement_credit,
    t.solde_debit,
    t.solde_credit,
  ]);
  const ws = feuilleAvecLargeurs(aoa, [14, 46, 16, 16, 16, 16, 16, 16]);
  formaterNombres(ws, [2, 3, 4, 5, 6, 7], 3);
  ws["!merges"] = [
    { s: { r: 1, c: 2 }, e: { r: 1, c: 3 } },
    { s: { r: 1, c: 4 }, e: { r: 1, c: 5 } },
    { s: { r: 1, c: 6 }, e: { r: 1, c: 7 } },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Balance");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/** Grand livre au format Sage (Excel) : une ligne par ecriture, comptes a la suite. */
function grandLivreXlsx(data) {
  const aoa = [["N° COMPTE", "DATE", "CODE J", "N° PIECES", "LIBELLE", "Let", "DEBIT", "CREDIT", "SOLDES"]];
  for (const c of data.comptes) {
    if (c.report.debit || c.report.credit) {
      aoa.push([c.numero, null, null, null, "Report", null, c.report.debit || null, c.report.credit || null, c.report.solde]);
    }
    for (const l of c.lignes) {
      aoa.push([
        c.numero,
        isoVersDate(l.date),
        l.journal,
        l.numero_piece || l.numero_ecriture || null,
        l.libelle,
        l.lettrage || null,
        l.debit || null,
        l.credit || null,
        l.solde_progressif,
      ]);
    }
  }
  const ws = feuilleAvecLargeurs(aoa, [12, 12, 8, 12, 50, 6, 16, 16, 18]);
  const plage = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = 1; r <= plage.e.r; r++) {
    const d = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    if (d && d.v instanceof Date) d.z = "dd/mm/yyyy";
  }
  formaterNombres(ws, [6, 7, 8], 1);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Grand livre");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ----------------------------------------------------------------------------
// PDF
// ----------------------------------------------------------------------------

function nouveauPdf(options) {
  const doc = new PDFDocument({ size: "A4", margins: { top: 24, bottom: 10, left: 28, right: 28 }, ...options });
  const morceaux = [];
  doc.on("data", (m) => morceaux.push(m));
  const fini = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(morceaux)));
    doc.on("error", reject);
  });
  return { doc, fini };
}

/** Coupe un texte pour qu'il tienne sur `largeur` points (ajoute "..." si coupe). */
function tronquer(doc, texte, largeur) {
  let t = String(texte || "");
  if (doc.widthOfString(t) <= largeur) return t;
  while (t.length > 1 && doc.widthOfString(`${t}...`) > largeur) t = t.slice(0, -1);
  return `${t}...`;
}

/** Decoupe un texte en lignes de largeur maximale `largeur` (retour a la ligne par mots). */
function lignesDeTexte(doc, texte, largeur, maxLignes = 2) {
  const mots = String(texte || "").split(/\s+/).filter(Boolean);
  const lignes = [];
  let courante = "";
  for (const mot of mots) {
    const essai = courante ? `${courante} ${mot}` : mot;
    if (doc.widthOfString(essai) <= largeur) {
      courante = essai;
    } else {
      if (courante) lignes.push(courante);
      courante = mot;
    }
  }
  if (courante) lignes.push(courante);
  if (lignes.length === 0) lignes.push("");
  if (lignes.length > maxLignes) {
    const reste = lignes.slice(maxLignes - 1).join(" ");
    return [...lignes.slice(0, maxLignes - 1), tronquer(doc, reste, largeur)];
  }
  return lignes;
}

function cadreEntete(doc, { entreprise, titre, sousTitre, periode, deviseLibelle, numeroPage, tirage }) {
  const { left, right, top } = doc.page.margins;
  const largeur = doc.page.width - left - right;
  const x0 = left;
  const y0 = top;
  doc.save();
  doc.lineWidth(0.8).rect(x0 - 4, y0 - 6, largeur + 8, doc.page.height - y0 - 14).stroke("#000000");
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#000").text(entreprise, x0, y0, { width: largeur * 0.3, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(15).text(titre, x0, y0 - 2, { width: largeur, align: "center", lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(8).text(sousTitre, x0, y0 + 17, { width: largeur, align: "center", lineBreak: false });
  doc.font("Helvetica").fontSize(7.5);
  const xd = x0 + largeur - 130;
  doc.text(`Période du`, xd, y0 - 2, { lineBreak: false });
  doc.text(dateJJMMAAbarre(periode.debut), xd + 60, y0 - 2, { lineBreak: false });
  doc.text(`au`, xd, y0 + 8, { lineBreak: false });
  doc.text(dateJJMMAAbarre(periode.fin), xd + 60, y0 + 8, { lineBreak: false });
  doc.text(`Tenue de compte : ${deviseLibelle}`, xd, y0 + 18, { lineBreak: false });
  const yl = y0 + 32;
  doc.moveTo(x0 - 4, yl).lineTo(x0 + largeur + 4, yl).lineWidth(0.5).stroke("#000");
  doc.text(`Édité le ${tirage.date} à ${tirage.heure}`, x0, yl + 3, { width: largeur / 2, lineBreak: false });
  doc.text(`Page : ${numeroPage}`, x0, yl + 3, { width: largeur, align: "right", lineBreak: false });
  const yl2 = yl + 14;
  doc.moveTo(x0 - 4, yl2).lineTo(x0 + largeur + 4, yl2).lineWidth(0.5).stroke("#000");
  doc.restore();
  return yl2 + 4;
}

// ---- Balance PDF -----------------------------------------------------------

async function balancePdf(data, entreprise) {
  const { doc, fini } = nouveauPdf({ layout: "landscape" });
  const tirage = maintenantTirage();
  const { left, right } = doc.page.margins;
  const largeur = doc.page.width - left - right;
  const colNum = 66;
  const colMontant = 74;
  const colLib = largeur - colNum - colMontant * 6 - 6;
  const xs = {};
  xs.num = left;
  xs.lib = left + colNum;
  const x1 = xs.lib + colLib;
  const montants = ["od", "oc", "md", "mc", "sd", "sc"];
  montants.forEach((k, i) => (xs[k] = x1 + i * colMontant));

  const hauteurLigne = 10.5;
  const bas = doc.page.height - 34;
  let page = 0;
  let y = 0;
  const cumul = { od: 0, oc: 0, md: 0, mc: 0, sd: 0, sc: 0 };

  function enteteColonnes() {
    doc.save();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
    const yh = y;
    doc.text("Numéro", xs.num, yh, { width: colNum, lineBreak: false });
    doc.text("de", xs.num, yh + 8, { width: colNum, lineBreak: false });
    doc.text("compte", xs.num, yh + 16, { width: colNum, lineBreak: false });
    doc.text("Intitulé des comptes", xs.lib, yh + 8, { width: colLib, align: "center", lineBreak: false });
    doc.text(`Mouvements au ${dateJJMMAAbarre(data.periode.debut)}`, xs.od, yh, { width: colMontant * 2, align: "center", lineBreak: false });
    doc.text("Mouvements", xs.md, yh, { width: colMontant * 2, align: "center", lineBreak: false });
    doc.text("Soldes cumulés", xs.sd, yh, { width: colMontant * 2, align: "center", lineBreak: false });
    for (const k of montants) {
      doc.text(k.endsWith("d") ? "Débit" : "Crédit", xs[k], yh + 18, { width: colMontant - 4, align: "right", lineBreak: false });
    }
    doc.moveTo(left - 4, yh + 29).lineTo(left + largeur + 4, yh + 29).lineWidth(0.5).stroke("#000");
    doc.restore();
    y = yh + 36;
  }

  function lignePied(libelle, valeurs, gras = true) {
    doc.save();
    doc.moveTo(left - 4, y - 2).lineTo(left + largeur + 4, y - 2).lineWidth(0.5).stroke("#000");
    doc.font(gras ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).fillColor("#000");
    doc.text(libelle, xs.lib, y + 1, { width: colLib - 6, align: "right", lineBreak: false });
    for (const k of montants) {
      doc.text(fmt(valeurs[k]), xs[k], y + 1, { width: colMontant - 4, align: "right", lineBreak: false });
    }
    doc.restore();
  }

  function nouvellePage(premiere = false) {
    if (!premiere) doc.addPage({ size: "A4", layout: "landscape", margins: doc.page.margins });
    page += 1;
    y = cadreEntete(doc, {
      entreprise,
      titre: "Balance des comptes",
      sousTitre: data.inclure_instance ? "Complète (écritures en instance incluses)" : "Complète",
      periode: data.periode,
      deviseLibelle: "F CFA",
      numeroPage: page,
      tirage,
    });
    enteteColonnes();
    if (!premiere) {
      doc.save();
      doc.font("Helvetica-Bold").fontSize(7.5);
      doc.text("Report", xs.lib, y, { width: colLib - 6, align: "right", lineBreak: false });
      for (const k of montants) doc.text(fmt(cumul[k]), xs[k], y, { width: colMontant - 4, align: "right", lineBreak: false });
      doc.restore();
      y += hauteurLigne + 2;
    }
  }

  nouvellePage(true);
  for (const l of data.lignes) {
    const estCompte = l.type === "compte";
    const hauteurNecessaire = estCompte ? hauteurLigne : hauteurLigne + 4;
    if (y + hauteurNecessaire > bas - 14) {
      lignePied("A reporter", cumul);
      nouvellePage();
    }
    doc.save();
    doc.fillColor("#000");
    if (estCompte) {
      doc.font("Helvetica").fontSize(7.5);
      doc.text(l.numero, xs.num, y, { width: colNum, lineBreak: false });
      doc.text(tronquer(doc, l.libelle, colLib - 6), xs.lib, y, { width: colLib - 6, lineBreak: false });
      const v = { od: l.ouverture_debit, oc: l.ouverture_credit, md: l.mouvement_debit, mc: l.mouvement_credit, sd: l.solde_debit, sc: l.solde_credit };
      for (const k of montants) {
        doc.text(fmt(v[k]), xs[k], y, { width: colMontant - 4, align: "right", lineBreak: false });
        cumul[k] += v[k] || 0;
      }
      y += hauteurLigne;
    } else {
      doc.font("Helvetica-Bold").fontSize(7.5);
      const etoiles = l.niveau === 3 ? "**" : "***";
      doc.text(l.prefixe, xs.num, y, { width: colNum, lineBreak: false });
      doc.text(tronquer(doc, `${etoiles} ${l.libelle}`, colLib - 6), xs.lib, y, { width: colLib - 6, lineBreak: false });
      const v = { od: l.ouverture_debit, oc: l.ouverture_credit, md: l.mouvement_debit, mc: l.mouvement_credit, sd: l.solde_debit, sc: l.solde_credit };
      for (const k of montants) doc.text(fmt(v[k]), xs[k], y, { width: colMontant - 4, align: "right", lineBreak: false });
      y += hauteurLigne + 5;
    }
    doc.restore();
  }
  // Total general
  if (y + 20 > bas) {
    lignePied("A reporter", cumul);
    nouvellePage();
  }
  y += 4;
  const t = data.totaux;
  lignePied("TOTAUX", {
    od: t.ouverture_debit,
    oc: t.ouverture_credit,
    md: t.mouvement_debit,
    mc: t.mouvement_credit,
    sd: t.solde_debit,
    sc: t.solde_credit,
  });
  doc.end();
  return fini;
}

// ---- Grand livre PDF -------------------------------------------------------

async function grandLivrePdf(data, entreprise) {
  const { doc, fini } = nouveauPdf({ layout: "portrait" });
  const tirage = maintenantTirage();
  const { left, right } = doc.page.margins;
  const largeur = doc.page.width - left - right;
  const w = { date: 38, cj: 28, piece: 52, let: 22, d: 62, c: 62, s: 66 };
  const wLib = largeur - w.date - w.cj - w.piece - w.let - w.d - w.c - w.s;
  const x = {};
  x.date = left;
  x.cj = x.date + w.date;
  x.piece = x.cj + w.cj;
  x.lib = x.piece + w.piece;
  x.let = x.lib + wLib;
  x.d = x.let + w.let;
  x.c = x.d + w.d;
  x.s = x.c + w.c;

  const lh = 9.5;
  const bas = doc.page.height - 36;
  let page = 0;
  let y = 0;
  const cumul = { d: 0, c: 0 };

  function enteteColonnes() {
    doc.save();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
    doc.text("Date", x.date, y, { width: w.date, lineBreak: false });
    doc.text("C.j", x.cj, y, { width: w.cj, lineBreak: false });
    doc.text("N° pièce", x.piece, y, { width: w.piece, lineBreak: false });
    doc.text("Libellé écriture", x.lib, y, { width: wLib, align: "center", lineBreak: false });
    doc.text("Let", x.let, y, { width: w.let, lineBreak: false });
    doc.text("Mouvement", x.d, y, { width: w.d - 4, align: "right", lineBreak: false });
    doc.text("Mouvement", x.c, y, { width: w.c - 4, align: "right", lineBreak: false });
    doc.text("Solde", x.s, y, { width: w.s - 2, align: "right", lineBreak: false });
    doc.text("débit", x.d, y + 8.5, { width: w.d - 4, align: "right", lineBreak: false });
    doc.text("crédit", x.c, y + 8.5, { width: w.c - 4, align: "right", lineBreak: false });
    doc.text("progressif", x.s, y + 8.5, { width: w.s - 2, align: "right", lineBreak: false });
    doc.moveTo(left - 4, y + 19).lineTo(left + largeur + 4, y + 19).lineWidth(0.5).stroke("#000");
    doc.restore();
    y += 25;
  }

  function lignePied(libelle, v) {
    doc.save();
    doc.moveTo(left - 4, y - 1).lineTo(left + largeur + 4, y - 1).lineWidth(0.5).stroke("#000");
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
    doc.text(libelle, x.lib, y + 2, { width: wLib + w.let - 6, align: "right", lineBreak: false });
    doc.text(fmt(v.d), x.d, y + 2, { width: w.d - 4, align: "right", lineBreak: false });
    doc.text(fmt(v.c), x.c, y + 2, { width: w.c - 4, align: "right", lineBreak: false });
    doc.text(fmt(v.d - v.c, { zero: true }), x.s, y + 2, { width: w.s - 2, align: "right", lineBreak: false });
    doc.restore();
  }

  function nouvellePage(premiere = false) {
    if (!premiere) doc.addPage({ size: "A4", layout: "portrait", margins: doc.page.margins });
    page += 1;
    y = cadreEntete(doc, {
      entreprise,
      titre: "Grand-livre des comptes",
      sousTitre: data.inclure_instance ? "Complet (écritures en instance incluses)" : "Complet",
      periode: data.periode,
      deviseLibelle: "F CFA",
      numeroPage: page,
      tirage,
    });
    enteteColonnes();
    if (!premiere) {
      doc.save();
      doc.font("Helvetica-Bold").fontSize(7.5);
      doc.text("Report", x.lib, y, { width: wLib + w.let - 6, align: "right", lineBreak: false });
      doc.text(fmt(cumul.d), x.d, y, { width: w.d - 4, align: "right", lineBreak: false });
      doc.text(fmt(cumul.c), x.c, y, { width: w.c - 4, align: "right", lineBreak: false });
      doc.text(fmt(cumul.d - cumul.c, { zero: true }), x.s, y, { width: w.s - 2, align: "right", lineBreak: false });
      doc.restore();
      y += lh + 3;
    }
  }

  function assurerPlace(hauteur) {
    if (y + hauteur > bas - 14) {
      lignePied("A reporter", cumul);
      nouvellePage();
    }
  }

  function ligneTotal(libelle, d, c, s) {
    assurerPlace(lh + 2);
    doc.save();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
    doc.text(libelle, x.piece, y, { width: x.d - x.piece - 4, lineBreak: false });
    doc.text(fmt(d), x.d, y, { width: w.d - 4, align: "right", lineBreak: false });
    doc.text(fmt(c), x.c, y, { width: w.c - 4, align: "right", lineBreak: false });
    doc.text(fmt(s, { zero: true }), x.s, y, { width: w.s - 2, align: "right", lineBreak: false });
    doc.restore();
    y += lh + 2;
  }

  nouvellePage(true);

  // Totaux de famille (2 chiffres puis classe), recalcules ici a partir des comptes
  const famille2 = {};
  const classe1 = {};
  for (const c of data.comptes) {
    for (const [cle, table] of [
      [c.numero.slice(0, 2), famille2],
      [c.numero.slice(0, 1), classe1],
    ]) {
      const t = table[cle] || (table[cle] = { d: 0, c: 0 });
      t.d += c.total_debit;
      t.c += c.total_credit;
    }
  }

  for (let i = 0; i < data.comptes.length; i++) {
    const c = data.comptes[i];
    assurerPlace(lh * 4);
    doc.save();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
    doc.text(c.numero, left, y, { width: 62, lineBreak: false });
    doc.text(tronquer(doc, c.libelle, largeur - 70), left + 66, y, { width: largeur - 70, lineBreak: false });
    doc.restore();
    y += lh + 1;

    if (c.report.debit || c.report.credit) {
      assurerPlace(lh);
      doc.save();
      doc.font("Helvetica-Oblique").fontSize(7.5).fillColor("#000");
      doc.text("Report", x.lib, y, { width: wLib, lineBreak: false });
      doc.text(fmt(c.report.debit), x.d, y, { width: w.d - 4, align: "right", lineBreak: false });
      doc.text(fmt(c.report.credit), x.c, y, { width: w.c - 4, align: "right", lineBreak: false });
      doc.text(fmt(c.report.solde, { zero: true }), x.s, y, { width: w.s - 2, align: "right", lineBreak: false });
      doc.restore();
      y += lh;
    }

    for (const l of c.lignes) {
      doc.font("Helvetica").fontSize(7.5);
      const lignesLib = lignesDeTexte(doc, l.libelle, wLib - 4, 2);
      const h = lh * lignesLib.length;
      assurerPlace(h);
      doc.save();
      doc.font("Helvetica").fontSize(7.5).fillColor("#000");
      doc.text(dateJJMMAA(l.date), x.date, y, { width: w.date, lineBreak: false });
      doc.text(l.journal, x.cj, y, { width: w.cj, lineBreak: false });
      doc.text(String(l.numero_piece || l.numero_ecriture || ""), x.piece, y, { width: w.piece - 2, lineBreak: false });
      lignesLib.forEach((t, k) => doc.text(t, x.lib, y + k * lh, { width: wLib - 4, lineBreak: false }));
      doc.text(l.lettrage || "", x.let, y, { width: w.let, lineBreak: false });
      doc.text(fmt(l.debit), x.d, y, { width: w.d - 4, align: "right", lineBreak: false });
      doc.text(fmt(l.credit), x.c, y, { width: w.c - 4, align: "right", lineBreak: false });
      doc.text(fmt(l.solde_progressif, { zero: true }), x.s, y, { width: w.s - 2, align: "right", lineBreak: false });
      doc.restore();
      cumul.d += l.debit;
      cumul.c += l.credit;
      y += h;
    }

    y += 1;
    ligneTotal(`Total compte ${c.numero}`, c.total_debit, c.total_credit, c.solde);

    const suivant = data.comptes[i + 1];
    const p2 = c.numero.slice(0, 2);
    const p1 = c.numero.slice(0, 1);
    if (!suivant || suivant.numero.slice(0, 2) !== p2) {
      const t = famille2[p2];
      ligneTotal(`Total compte ${p2}`, t.d, t.c, t.d - t.c);
    }
    if (!suivant || suivant.numero.slice(0, 1) !== p1) {
      const t = classe1[p1];
      ligneTotal(`Total compte ${p1}`, t.d, t.c, t.d - t.c);
    }
    y += 6;
  }
  assurerPlace(lh * 2);
  y += 2;
  lignePied("TOTAL GENERAL", { d: data.total.debit, c: data.total.credit });
  doc.end();
  return fini;
}

module.exports = { balanceXlsx, grandLivreXlsx, balancePdf, grandLivrePdf, fmt, nouveauPdf, tronquer, cadreEntete, maintenantTirage, dateJJMMAAbarre, feuilleAvecLargeurs, formaterNombres };
