/**
 * PDF du contrat de prestation. Reprend l'en-tete du client (logo, coordonnees), le texte fige du contrat, le tableau
 * des echeances et les cadres de signature (prestataire / entreprise). pdfkit, sans navigateur.
 */
const { helpers: H } = require("./offresContratsPdf");
const { helpersRh } = require("./rhDocumentsPdf");

const { PETROLE, GRIS, LIGNE, nouveauDocument, largeurUtile, asseoir, dateLongue, fmt, image } = H;
const { enteteClient, titreDoc, para, cadreSignature, ou } = helpersRh;

function pieds(doc, entete, { reference, projet }) {
  const range = doc.bufferedPageRange();
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (projet) {
      doc.save();
      doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.font("Helvetica-Bold").fontSize(80).fillColor("#000").fillOpacity(0.06).text("PROJET", 0, doc.page.height / 2 - 40, { width: doc.page.width, align: "center", lineBreak: false });
      doc.restore();
      doc.fillOpacity(1);
    }
    const marge = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 50;
    doc.moveTo(x0, y).lineTo(x0 + L, y).lineWidth(0.5).strokeColor(LIGNE).stroke();
    doc.font("Helvetica").fontSize(7).fillColor(GRIS);
    doc.text(ou(entete.raison_sociale, ""), x0, y + 5, { width: L - 100, lineBreak: false });
    doc.text(`${reference}  -  Page ${i + 1} / ${range.count}`, x0, y + 5, { width: L, align: "right", lineBreak: false });
    if (!projet) doc.text("Paraphes :  Client ________      Prestataire ________", x0, y + 17, { width: L, align: "right", lineBreak: false });
    doc.page.margins.bottom = marge;
  }
}

/**
 * @param {object} contrat ligne contrat_prestation
 * @param {object} contenu contenu redige (rediger()) ou fige
 * @param {object} entete ligne tenant
 * @param {object} opts { valide }  true : le contrat est valide (cachet de l'entreprise et pas de filigrane PROJET)
 */
async function contratPrestationPdf(contrat, contenu, entete, opts = {}) {
  const { doc, fini } = nouveauDocument();
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const projet = !opts.valide;
  const emp = contenu.entreprise || {};

  enteteClient(doc, entete);
  titreDoc(doc, "CONTRAT DE PRESTATION DE SERVICES", `N° ${contrat.numero}${projet ? "  -  PROJET (non validé)" : ""}`);

  doc.font("Helvetica-Bold").fontSize(10).fillColor(PETROLE).text("ENTRE LES SOUSSIGNÉS", x0, doc.y, { width: L, characterSpacing: 0.4 });
  doc.moveDown(0.3);
  para(doc, `L'entreprise ${ou(emp.raison_sociale)}${emp.rccm ? `, RCCM ${emp.rccm}` : ""}${emp.ninea ? `, NINEA ${emp.ninea}` : ""}, dont le siège se trouve à ${ou(emp.siege)}, représentée aux fins des présentes par ${ou(emp.representant)} ${emp.qualite ? `(${emp.qualite})` : ""}, ci-après désignée « le Client ».`);
  doc.moveDown(0.2);
  para(doc, "D'UNE PART ;", { gras: true, align: "left" });
  doc.moveDown(0.4);

  for (const [k, v] of contenu.identite) {
    asseoir(doc, 18);
    const y1 = doc.y;
    doc.font("Helvetica-Bold").fontSize(9.3).fillColor(GRIS).text(k, x0, y1, { width: 175 });
    const yk = doc.y;
    doc.font("Helvetica").fontSize(9.8).fillColor("#000").text(v, x0 + 185, y1, { width: L - 185 });
    doc.y = Math.max(yk, doc.y) + 2.5;
  }
  doc.moveDown(0.3);
  para(doc, "Ci-après désigné(e) « le Prestataire »,", { gras: true, align: "left" });
  doc.moveDown(0.2);
  para(doc, "D'AUTRE PART,", { gras: true, align: "left" });
  doc.moveDown(0.5);
  para(doc, "Il a été convenu et arrêté ce qui suit :", { italique: true, align: "left" });

  for (const a of contenu.articles) {
    asseoir(doc, 70);
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(10.3).fillColor(PETROLE).text(`ARTICLE ${a.numero} : ${String(a.titre).toUpperCase()}`, x0, doc.y, { width: L });
    doc.moveDown(0.25);
    for (const p of a.paragraphes) {
      para(doc, p);
      doc.moveDown(0.3);
    }
    if (a.echeancier) {
      const e = a.echeancier;
      doc.font("Helvetica-Bold").fontSize(9.3).fillColor(GRIS).text("Échéancier de paiement", x0 + 10, doc.y, { width: L - 10 });
      doc.moveDown(0.2);
      for (const l of e.lignes) {
        asseoir(doc, 16);
        const y1 = doc.y;
        doc.font("Helvetica").fontSize(9.8).fillColor("#000").text(`-  ${l.libelle}${l.date ? ` (${dateLongue(l.date)})` : ""}`, x0 + 10, y1, { width: L - 150 });
        const yl = doc.y;
        doc.font("Helvetica").fontSize(9.8).text(`${fmt(l.montant)} ${e.devise}`, x0 + L - 130, y1, { width: 130, align: "right" });
        doc.y = Math.max(yl, doc.y) + 1;
        doc.moveTo(x0 + 10, doc.y).lineTo(x0 + L, doc.y).lineWidth(0.3).strokeColor(LIGNE).stroke();
        doc.y += 2;
      }
      asseoir(doc, 24);
      const y2 = doc.y + 2;
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text("Total des échéances", x0 + 10, y2, { width: L - 150 });
      doc.text(`${fmt(e.total)} ${e.devise}`, x0 + L - 130, y2, { width: 130, align: "right" });
      doc.y = y2 + 16;
      doc.moveDown(0.3);
    }
  }

  asseoir(doc, 170);
  doc.moveDown(1);
  para(doc, `Fait en deux (2) exemplaires originaux à ${ou(contenu.ville, "Dakar")}, le ${dateLongue(contenu.date_contrat || contrat.date_contrat)}.`, { gras: true, align: "left" });
  doc.moveDown(0.7);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(PETROLE).text("Signatures :", x0, doc.y, { width: L });
  doc.moveDown(0.4);
  const gap = 24;
  const w = (L - gap) / 2;
  const y = doc.y;
  const b1 = cadreSignature(doc, x0, y, w, 80, {
    titre: "Le Prestataire",
    mention: "Précédé de la mention manuscrite « Lu et approuvé »",
    lignes: [contenu.forme === "SOCIETE" ? ou(contenu.identite[1] && contenu.identite[1][1], "") : ""].filter(Boolean),
    hautBoite: 44,
  });
  const b2 = cadreSignature(doc, x0 + w + gap, y, w, 80, {
    titre: "Le Client",
    mention: "Précédé de la mention « Lu et approuvé »",
    imageBuf: opts.valide ? image(entete.signature_cachet_base64) : null,
    lignes: opts.valide ? [[emp.representant, emp.qualite].filter(Boolean).join(", ")] : [],
    hautBoite: 44,
  });
  doc.y = Math.max(b1, b2) + 6;

  pieds(doc, entete, { reference: contrat.numero, projet });
  doc.end();
  return fini;
}

module.exports = { contratPrestationPdf };
