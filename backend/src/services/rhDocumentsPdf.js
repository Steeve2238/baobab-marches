/**
 * PDF des documents RH du client : contrat de travail et declaration de mouvement du travailleur (DMT).
 * En-tete, logo, signature et cachet viennent de l'en-tete du client (table tenant). pdfkit, sans navigateur.
 */
const { helpers: H } = require("./offresContratsPdf");
const { LIBELLES_OBJET, OBJETS } = require("./rhDmt");

const { PETROLE, ACCENT, GRIS, LIGNE, nouveauDocument, largeurUtile, placerImage, image, asseoir, dateLongue, dateCourte, fmt } = H;
const POINTS = "………………………";
const ou = (v, vide = POINTS) => (v !== undefined && v !== null && String(v).trim() !== "" ? String(v).trim() : vide);

const TITRES = {
  CDI: "CONTRAT DE TRAVAIL À DURÉE INDÉTERMINÉE",
  CDD: "CONTRAT DE TRAVAIL À DURÉE DÉTERMINÉE",
  JOURNALIER: "CONTRAT DE TRAVAIL JOURNALIER",
};

function enteteClient(doc, e) {
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const y0 = doc.y;
  const aLogo = placerImage(doc, image(e.logo_base64), x0, y0, [110, 54]);
  const xT = x0 + (aLogo ? 125 : 0);
  const wT = L - (aLogo ? 125 : 0);
  doc.font("Helvetica-Bold").fontSize(12).fillColor(PETROLE).text(ou(e.raison_sociale, "Entreprise"), xT, y0, { width: wT, align: aLogo ? "right" : "left" });
  let y = doc.y;
  const lignes = [
    e.adresse,
    [e.telephone ? `Tél. ${e.telephone}` : null, e.email].filter(Boolean).join(" - "),
    [e.rccm ? `RCCM ${e.rccm}` : null, e.ninea ? `NINEA ${e.ninea}` : null].filter(Boolean).join(" - "),
  ].filter(Boolean);
  doc.font("Helvetica").fontSize(8.5).fillColor(GRIS);
  for (const l of lignes) {
    doc.text(l, xT, y, { width: wT, align: aLogo ? "right" : "left" });
    y = doc.y;
  }
  const yFin = Math.max(y, y0 + (aLogo ? 56 : 0)) + 6;
  doc.moveTo(x0, yFin).lineTo(x0 + L, yFin).lineWidth(1.4).strokeColor(ACCENT).stroke();
  doc.x = x0;
  doc.y = yFin + 12;
}

function titreDoc(doc, texte, sous) {
  const x0 = doc.page.margins.left;
  doc.font("Helvetica-Bold").fontSize(14).fillColor(PETROLE).text(texte, x0, doc.y, { width: largeurUtile(doc), align: "center" });
  if (sous) doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(sous, x0, doc.y + 2, { width: largeurUtile(doc), align: "center" });
  doc.moveDown(0.7);
}

function para(doc, texte, o = {}) {
  doc.font(o.gras ? "Helvetica-Bold" : o.italique ? "Helvetica-Oblique" : "Helvetica").fontSize(o.taille || 9.8).fillColor(o.couleur || "#000");
  doc.text(texte, doc.page.margins.left + (o.retrait || 0), doc.y, { width: largeurUtile(doc) - (o.retrait || 0), align: o.align || "justify", lineGap: 1.6 });
}

function pieds(doc, e, { reference, projet, mention }) {
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
    doc.text(`${ou(e.raison_sociale, "")}${mention ? `  -  ${mention}` : ""}`, x0, y + 5, { width: L - 100, lineBreak: false });
    doc.text(`${reference}  -  Page ${i + 1} / ${range.count}`, x0, y + 5, { width: L, align: "right", lineBreak: false });
    if (!projet && mention !== false) doc.text("Paraphes :  Employeur ________      Travailleur ________", x0, y + 17, { width: L, align: "right", lineBreak: false });
    doc.page.margins.bottom = marge;
  }
}

function cadreSignature(doc, x, y, w, h, { titre, mention, imageBuf, lignes, hautBoite }) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor(PETROLE).text(titre, x, y, { width: w, align: "center" });
  let yy = doc.y;
  if (lignes && lignes.length) {
    doc.font("Helvetica").fontSize(8.5).fillColor("#000");
    for (const l of lignes) {
      doc.text(l, x, yy, { width: w, align: "center" });
      yy = doc.y;
    }
  }
  if (mention) {
    doc.font("Helvetica-Oblique").fontSize(7.8).fillColor(GRIS).text(mention, x, yy + 1, { width: w, align: "center" });
    yy = doc.y;
  }
  const yb = Math.max(yy + 4, y + (hautBoite || 44));
  doc.rect(x, yb, w, h).lineWidth(0.6).strokeColor(LIGNE).stroke();
  if (imageBuf) placerImage(doc, imageBuf, x + 6, yb + 4, [w - 12, h - 8]);
  return yb + h;
}

// ------------------------------------------------------------------------------------------- contrat de travail
/**
 * @param {object} contrat ligne rh_contrat (avec contenu_json fige ou contenu live fourni dans `contenu`)
 * @param {object} contenu contenu redige (rediger())
 * @param {object} entete ligne tenant (en-tete, signataire, logo, signature_cachet)
 * @param {object} opts { signeEmployeur, signatureSalarie: {image_base64, date, mention} }
 */
async function contratTravailPdf(contrat, contenu, entete, opts = {}) {
  const { doc, fini } = nouveauDocument();
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const projet = !opts.signeEmployeur;
  const emp = contenu.employeur;

  enteteClient(doc, entete);
  titreDoc(doc, TITRES[contenu.type] || "CONTRAT DE TRAVAIL", `N° ${contrat.numero}${projet ? "  -  PROJET (non signé)" : ""}`);

  doc.font("Helvetica-Bold").fontSize(10).fillColor(PETROLE).text("ENTRE LES SOUSSIGNÉS", x0, doc.y, { width: L, characterSpacing: 0.4 });
  doc.moveDown(0.3);
  para(doc, `L'entreprise ${ou(emp.raison_sociale)} dont le siège se trouve à ${ou(emp.siege)}, représentée aux fins des présentes par ${ou(emp.representant)} en sa qualité de ${ou(emp.qualite)}, ci-après désignée « l'employeur ».`);
  doc.moveDown(0.2);
  para(doc, "D'UNE PART ;", { gras: true, align: "left" });
  doc.moveDown(0.4);

  // Identite du travailleur : tableau libelle / valeur
  for (const [k, v] of contenu.identite) {
    asseoir(doc, 18);
    const y1 = doc.y;
    doc.font("Helvetica-Bold").fontSize(9.3).fillColor(GRIS).text(k, x0, y1, { width: 175 });
    const yk = doc.y;
    doc.font("Helvetica").fontSize(9.8).fillColor("#000").text(v, x0 + 185, y1, { width: L - 185 });
    doc.y = Math.max(yk, doc.y) + 2.5;
  }
  doc.moveDown(0.3);
  para(doc, "Ci-après dénommé(e) « le Travailleur »,", { gras: true, align: "left" });
  doc.moveDown(0.2);
  para(doc, "D'AUTRE PART,", { gras: true, align: "left" });
  doc.moveDown(0.5);
  para(doc, "Il a été convenu et arrêté ce qui suit :", { italique: true, align: "left" });

  for (const a of contenu.articles) {
    asseoir(doc, 70);
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(10.3).fillColor(PETROLE).text(`ARTICLE ${a.numero} : ${String(a.titre).toUpperCase()}`, x0, doc.y, { width: L });
    doc.moveDown(0.25);
    const paras = a.paragraphes.slice();
    const r = a.remuneration;
    // Le tableau de remuneration vient apres le premier paragraphe d'introduction.
    for (let i = 0; i < paras.length; i++) {
      para(doc, paras[i]);
      doc.moveDown(0.3);
      if (r && i === 0) {
        for (const l of r.lignes) {
          asseoir(doc, 16);
          const y1 = doc.y;
          doc.font("Helvetica").fontSize(9.8).fillColor("#000").text(`-  ${l.libelle}${l.essai === false ? " (hors période d'essai)" : ""}`, x0 + 10, y1, { width: L - 130 });
          const yl = doc.y;
          doc.font("Helvetica").fontSize(9.8).text(`${fmt(l.montant)} F CFA`, x0 + L - 120, y1, { width: 120, align: "right" });
          doc.y = Math.max(yl, doc.y) + 1;
          doc.moveTo(x0 + 10, doc.y).lineTo(x0 + L, doc.y).lineWidth(0.3).strokeColor(LIGNE).stroke();
          doc.y += 2;
        }
        asseoir(doc, 40);
        const y2 = doc.y + 2;
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text(r.libelle_total, x0 + 10, y2, { width: L - 130 });
        doc.text(`${fmt(r.total)} F CFA`, x0 + L - 120, y2, { width: 120, align: "right" });
        doc.y = y2 + 15;
        doc.font("Helvetica-Oblique").fontSize(9).fillColor(GRIS).text(`Soit : ${r.total_lettres}.`, x0 + 10, doc.y, { width: L - 10 });
        doc.moveDown(0.4);
      }
    }
  }

  // Signatures
  asseoir(doc, 175);
  doc.moveDown(1);
  para(doc, `Fait en trois (3) exemplaires à ${ou(contenu.ville, "Dakar")}, le ${dateLongue(contenu.date_contrat || contrat.date_contrat)}.`, { gras: true, align: "left" });
  doc.moveDown(0.7);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(PETROLE).text("Signatures :", x0, doc.y, { width: L });
  doc.moveDown(0.4);
  const gap = 12;
  const w = (L - 2 * gap) / 3;
  const y = doc.y;
  const sal = opts.signatureSalarie || null;
  const hautBoite = sal && sal.mention ? 66 : 44;
  const b1 = cadreSignature(doc, x0, y, w, 78, {
    titre: "Le Travailleur",
    mention: "Précédé de la mention manuscrite « Lu et approuvé »",
    imageBuf: sal && sal.image_base64 ? image(sal.image_base64) : null,
    lignes: sal && sal.mention ? [sal.mention] : [],
    hautBoite,
  });
  const b2 = cadreSignature(doc, x0 + w + gap, y, w, 78, { titre: "L'Inspecteur du travail", mention: "Visa", hautBoite });
  const b3 = cadreSignature(doc, x0 + 2 * (w + gap), y, w, 78, {
    titre: "L'Employeur",
    mention: "Précédé de la mention « Lu et approuvé »",
    imageBuf: opts.signeEmployeur ? image(entete.signature_cachet_base64) : null,
    lignes: opts.signeEmployeur ? [[emp.representant, emp.qualite].filter(Boolean).join(", ")] : [],
    hautBoite,
  });
  doc.y = Math.max(b1, b2, b3) + 6;

  pieds(doc, entete, { reference: contrat.numero, projet, mention: undefined });
  doc.end();
  return fini;
}

// ------------------------------------------------------------------------------------------- DMT
function caseObjet(doc, x, y, coche) {
  doc.rect(x, y, 9, 9).lineWidth(0.7).strokeColor("#000").stroke();
  if (coche) {
    doc.moveTo(x + 1.5, y + 1.5).lineTo(x + 7.5, y + 7.5).moveTo(x + 7.5, y + 1.5).lineTo(x + 1.5, y + 7.5).lineWidth(1.1).strokeColor("#000").stroke();
  }
}

/** Ligne de rubriques : [["Libelle", valeur], ...] disposees sur la ligne, avec retour a la ligne si besoin. */
function rubriques(doc, paires) {
  asseoir(doc, 24);
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const lh = 12.5;
  let x = x0;
  let y = doc.y;
  let bas = y + lh;
  for (const [k, v] of paires) {
    const label = `${k} : `;
    const val = ou(v);
    doc.font("Helvetica-Bold").fontSize(9.2);
    const wl = doc.widthOfString(label);
    doc.font("Helvetica").fontSize(9.6);
    const wv = doc.widthOfString(val);
    if (x + wl + wv > x0 + L && x > x0) {
      x = x0;
      y = bas + 1;
    }
    doc.font("Helvetica-Bold").fontSize(9.2).fillColor("#000").text(label, x, y, { lineBreak: false });
    doc.font("Helvetica").fontSize(9.6).fillColor("#000");
    if (x + wl + wv <= x0 + L) {
      doc.text(val, x + wl, y, { lineBreak: false });
      x += wl + wv + 16;
      bas = Math.max(bas, y + lh);
    } else {
      const w = x0 + L - (x + wl);
      doc.text(val, x + wl, y, { width: w });
      bas = Math.max(bas, doc.y);
      x = x0 + L + 1;
    }
  }
  doc.y = bas + 2.5;
  doc.x = x0;
}

function dmtSection(doc, titre) {
  asseoir(doc, 40);
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(PETROLE).text(titre, doc.page.margins.left, doc.y, { width: largeurUtile(doc), characterSpacing: 0.3 });
  const y = doc.y + 1;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + largeurUtile(doc), y).lineWidth(0.5).strokeColor(LIGNE).stroke();
  doc.y = y + 4;
}

async function dmtPdf(dmt, d, entete, opts = {}) {
  const { doc, fini } = nouveauDocument();
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const projet = dmt.statut === "BROUILLON";
  const D = (v) => (v ? dateCourte(v) : "");

  enteteClient(doc, entete);
  titreDoc(doc, "DÉCLARATION DE MOUVEMENT DU TRAVAILLEUR", projet ? "PROJET" : null);
  rubriques(doc, [["N°", dmt.numero], ["De la (date)", D(dmt.date_dmt)]]);

  dmtSection(doc, "RÉFÉRENCES");
  para(doc, "Article 222, alinéas 2, 3, 4 et 5 du Code du travail (loi n° 97-17 du 1er décembre 1997) ; arrêté ministériel n° 7301 du 17 mai 1963 déterminant les modalités des déclarations de mouvement du travailleur (J.O. du 22 juin 1963, p. 285).", { taille: 8.8, couleur: GRIS });

  dmtSection(doc, "OBJET DE LA PRÉSENTE DÉCLARATION");
  const colW = L / 2;
  let yy = doc.y + 2;
  OBJETS.forEach((o, i) => {
    const col = i % 2;
    if (col === 0 && i > 0) yy += 15;
    const xx = x0 + col * colW;
    caseObjet(doc, xx, yy, d.objet === o);
    doc.font(d.objet === o ? "Helvetica-Bold" : "Helvetica").fontSize(9.2).fillColor("#000").text(LIBELLES_OBJET[o], xx + 14, yy, { width: colW - 20, lineBreak: false });
  });
  doc.y = yy + 18;
  if (d.precision_objet) rubriques(doc, [["Précisions (à compter de, nouvelle situation)", d.precision_objet]]);

  dmtSection(doc, "CONCERNANT LE TRAVAILLEUR");
  rubriques(doc, [["Nom", d.nom], ["Prénom(s)", d.prenoms], ["Sexe", d.sexe]]);
  rubriques(doc, [["Né(e) le", D(d.date_naissance)], ["à", d.lieu_naissance], ["Pays", d.pays_naissance], ["Nationalité", d.nationalite]]);
  rubriques(doc, [["Fils / fille de", d.pere], ["et de", d.mere], ["Groupe ethnique", d.groupe_ethnique]]);
  rubriques(doc, [["Adresse", d.adresse]]);
  const pieceLib = { CNI: "CNI", PASSEPORT: "Passeport", CARTE_SEJOUR: "Carte de séjour", AUTRE: "Pièce" }[d.piece_type] || "CNI";
  rubriques(doc, [[`${pieceLib} n°`, d.piece_numero], ["Délivré(e) à", d.piece_lieu], ["Le", D(d.piece_date)]]);
  rubriques(doc, [["N° d'immatriculation à la CSS", d.numero_css], ["N° d'immatriculation à l'IPRES", d.numero_ipres]]);
  rubriques(doc, [["Situation de famille", d.situation_familiale], ["Nombre d'épouses", d.nombre_epouses]]);
  rubriques(doc, [["Noms des épouses", d.noms_epouses]]);
  rubriques(doc, [["Nombre d'enfants à charge", d.nombre_enfants], ["Noms des enfants à charge", d.noms_enfants]]);
  rubriques(doc, [["Date d'entrée dans l'établissement", D(d.date_entree)]]);
  rubriques(doc, [["N° et date de la déclaration d'embauche effectuée lors de l'engagement", [d.declaration_numero, D(d.declaration_date)].filter(Boolean).join(" du ")]]);
  rubriques(doc, [["Profession", d.profession], ["Emploi dans l'établissement", d.emploi]]);
  rubriques(doc, [["Convention collective", d.convention], ["Catégorie", d.categorie]]);
  rubriques(doc, [["Éventuellement, date de début du contrat", D(d.date_debut_contrat)]]);
  rubriques(doc, [["N° et date du visa d'approbation par l'inspecteur du travail et de la sécurité sociale", d.visa_inspecteur]]);
  rubriques(doc, [["N° et date du visa d'enregistrement à la section locale du service de la main-d'œuvre", d.visa_section_locale]]);
  rubriques(doc, [["Raison sociale et adresse précise de l'employeur", d.employeur]]);
  rubriques(doc, [["Activité de l'établissement", d.activite]]);

  asseoir(doc, 60);
  doc.font("Helvetica-Bold").fontSize(9.2).fillColor("#000").text("Durée du contrat :", x0, doc.y);
  doc.moveDown(0.15);
  const cdd = d.duree === "CDD";
  let y1 = doc.y;
  caseObjet(doc, x0 + 10, y1, cdd);
  doc.font("Helvetica").fontSize(9.4).text(`À durée déterminée du ${ou(D(d.date_debut))} au ${ou(D(d.date_fin))}${d.chantier ? `  -  chantier / motif : ${d.chantier}` : ""}`, x0 + 26, y1, { width: L - 30 });
  y1 = doc.y + 3;
  caseObjet(doc, x0 + 10, y1, !cdd);
  doc.font("Helvetica").fontSize(9.4).text(`À durée indéterminée à compter du ${ou(D(d.date_debut))}${d.essai_mois ? `, dont période d'essai de ${d.essai_mois} mois` : ""}`, x0 + 26, y1, { width: L - 30 });
  doc.y += 4;
  rubriques(doc, [["Nom et adresse du précédent employeur", d.precedent_employeur]]);
  rubriques(doc, [["Lieu de résidence habituel du travailleur", d.residence_habituelle], ["Date d'entrée au Sénégal", D(d.date_entree_senegal)]]);

  dmtSection(doc, "STATUT MILITAIRE");
  rubriques(doc, [["Classe de recrutement", d.mil_classe]]);
  rubriques(doc, [["L'intéressé a-t-il effectué son service militaire", d.mil_service]]);
  rubriques(doc, [["Armée d'appartenance", d.mil_armee], ["Grade dans la réserve", d.mil_grade]]);

  dmtSection(doc, "DISPOSITIONS PARTICULIÈRES CONCERNANT L'ENGAGEMENT");
  para(doc, "(Auxquelles les parties ont expressément souscrit)", { taille: 8.6, couleur: GRIS, align: "left", italique: true });
  doc.moveDown(0.2);
  para(doc, `1) Le salaire du travailleur sera fixé pour la ${ou(d.categorie_texte || d.categorie, "…")} de la convention collective ${ou(d.convention)}, en fonction d'un horaire de travail hebdomadaire de ${ou(d.heures_hebdo)} heures.`);
  doc.moveDown(0.3);
  (d.elements || []).forEach((l, i) => {
    asseoir(doc, 14);
    const yl = doc.y;
    doc.font("Helvetica").fontSize(9.6).fillColor("#000").text(`${i + 1}) ${l.libelle}`, x0 + 14, yl, { width: L - 150 });
    const yk = doc.y;
    doc.text(`${fmt(l.montant)} F CFA`, x0 + L - 120, yl, { width: 120, align: "right" });
    doc.y = Math.max(yk, doc.y) + 1.5;
  });
  if ((d.elements || []).length) {
    const yl = doc.y;
    doc.font("Helvetica-Bold").fontSize(9.8).text("TOTAL BRUT", x0 + 14, yl, { width: L - 150 });
    doc.text(`${fmt(d.total_brut)} F CFA`, x0 + L - 120, yl, { width: 120, align: "right" });
    doc.y = yl + 15;
  }

  asseoir(doc, 130);
  doc.moveDown(0.8);
  const gap = 16;
  const w = (L - gap) / 2;
  const y = doc.y;
  const b1 = cadreSignature(doc, x0, y, w, 70, { titre: "Signature du travailleur" });
  const b2 = cadreSignature(doc, x0 + w + gap, y, w, 70, {
    titre: "Signature de l'employeur",
    mention: "(précédée de la mention manuscrite : pour accord)",
    imageBuf: opts.signeEmployeur ? image(entete.signature_cachet_base64) : null,
  });
  doc.y = Math.max(b1, b2) + 8;
  para(doc, "À établir en trois exemplaires : un pour le travailleur, un pour l'employeur, un à déposer au Bureau central de la main-d'œuvre (Dakar) ou à la section locale. L'ampliation de la déclaration doit obligatoirement être remise au travailleur.", { taille: 8.2, couleur: GRIS, align: "left" });

  pieds(doc, entete, { reference: dmt.numero, projet, mention: false });
  doc.end();
  return fini;
}


// ------------------------------------------------------------------------------------------- courriers RH
const fmtF = (n) => `${fmt(Number(n) || 0)} F CFA`;

function signatureEmployeur(doc, entete, contenu, x, w, emis, titre) {
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(9.3).fillColor(PETROLE).text(titre || `Pour ${ou(contenu.employeur, "l'employeur")}`, x, y, { width: w, align: "center" });
  const yImg = doc.y + 2;
  if (emis) placerImage(doc, image(entete.signature_cachet_base64), x + 10, yImg, [w - 20, 62]);
  const yNom = yImg + 66;
  doc.font("Helvetica").fontSize(9).fillColor("#000").text([contenu.signataire.nom, contenu.signataire.titre].filter(Boolean).join("\n") || "", x, yNom, { width: w, align: "center" });
  return doc.y;
}

/**
 * Courrier RH. contenu = contenu fige (ou redige a la volee pour l'apercu). opts : { emis }.
 * Formats : LETTRE (lettre a un salarie), ATTESTATION (attestation / certificat), RECU (solde de tout compte).
 */
async function courrierRhPdf(courrier, contenu, entete, opts = {}) {
  const { doc, fini } = nouveauDocument();
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const projet = !opts.emis;
  const dateTxt = `${ou(contenu.lieu, "Dakar")}, le ${dateLongue(contenu.date_courrier)}`;
  enteteClient(doc, entete);

  const tableauLignes = () => {
    if (!contenu.lignes || contenu.lignes.length === 0) return;
    doc.moveDown(0.2);
    for (const l of contenu.lignes) {
      asseoir(doc, 18);
      const y1 = doc.y;
      doc.font("Helvetica").fontSize(9.8).fillColor("#000").text(l.libelle, x0 + 10, y1, { width: L - 150 });
      const yl = doc.y;
      doc.text(fmtF(l.montant), x0 + L - 130, y1, { width: 130, align: "right" });
      doc.y = Math.max(yl, doc.y) + 1.5;
      doc.moveTo(x0 + 10, doc.y).lineTo(x0 + L, doc.y).lineWidth(0.3).strokeColor(LIGNE).stroke();
      doc.y += 3;
    }
    asseoir(doc, 34);
    const y1 = doc.y;
    doc.font("Helvetica-Bold").fontSize(10.2).fillColor("#000").text("Total", x0 + 10, y1, { width: L - 150 });
    doc.text(fmtF(contenu.total), x0 + L - 130, y1, { width: 130, align: "right" });
    doc.moveDown(0.2);
    if (contenu.total_lettres) para(doc, `Soit : ${contenu.total_lettres}.`, { italique: true, align: "left", retrait: 10 });
    doc.moveDown(0.5);
  };

  if (contenu.format === "LETTRE") {
    doc.font("Helvetica").fontSize(9.8).fillColor("#000").text(dateTxt, x0, doc.y, { width: L, align: "right" });
    doc.font("Helvetica").fontSize(8.5).fillColor(GRIS).text(`Réf. : ${courrier.numero}${projet ? "  -  PROJET" : ""}`, x0, doc.y, { width: L, align: "right" });
    doc.moveDown(0.8);
    const d = contenu.destinataire;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(PETROLE).text(d.nom, x0, doc.y, { width: L / 2 });
    doc.font("Helvetica").fontSize(9.3).fillColor("#000");
    for (const l of [d.fonction, d.matricule ? `Matricule ${d.matricule}` : null, d.adresse].filter(Boolean)) doc.text(l, x0, doc.y, { width: L / 2 });
    doc.moveDown(0.9);
    doc.font("Helvetica-Bold").fontSize(10.2).fillColor("#000").text(`Objet : ${contenu.objet}`, x0, doc.y, { width: L });
    doc.moveDown(0.8);
    para(doc, `${contenu.civilite_long},`, { align: "left" });
    doc.moveDown(0.5);
    for (const p of contenu.paragraphes) {
      asseoir(doc, 30);
      para(doc, p);
      doc.moveDown(0.5);
    }
    asseoir(doc, 40);
    if (contenu.formule) para(doc, contenu.formule, { align: "left" });
    doc.moveDown(0.8);
    asseoir(doc, 160);
    const yBloc = doc.y;
    const wSig = 200;
    const yFin = signatureEmployeur(doc, entete, contenu, x0 + L - wSig, wSig, opts.emis);
    if (contenu.accuse === "RECEPTION") {
      doc.y = yBloc;
      cadreSignature(doc, x0, yBloc, 230, 70, {
        titre: "Accusé de réception",
        mention: "Reçu en main propre le ……/……/……………\nNom, signature du salarié",
        hautBoite: 42,
      });
    }
    doc.y = Math.max(yFin, doc.y) + 6;
  } else {
    // ATTESTATION et RECU : titre centre, texte, lignes eventuelles
    doc.font("Helvetica").fontSize(9.8).fillColor("#000").text(dateTxt, x0, doc.y, { width: L, align: "right" });
    doc.moveDown(0.8);
    titreDoc(doc, contenu.objet, `N° ${courrier.numero}${projet ? "  -  PROJET (non émis)" : ""}`);
    doc.moveDown(0.6);
    let lignesPosees = false;
    const texteLignes = contenu.lignes && contenu.lignes.length > 0;
    for (const p of contenu.paragraphes) {
      asseoir(doc, 30);
      para(doc, p);
      doc.moveDown(0.5);
      if (texteLignes && !lignesPosees && /(comme suit|décomposé)/i.test(p)) {
        tableauLignes();
        lignesPosees = true;
      }
    }
    if (texteLignes && !lignesPosees) tableauLignes();
    doc.moveDown(0.8);
    asseoir(doc, 170);
    para(doc, `Fait à ${ou(contenu.lieu, "Dakar")}, le ${dateLongue(contenu.date_courrier)}.`, { gras: true, align: "left" });
    doc.moveDown(0.6);
    const yBloc = doc.y;
    const wSig = 210;
    let yFin;
    if (contenu.format === "RECU") {
      cadreSignature(doc, x0, yBloc, 230, 78, {
        titre: "Le salarié",
        mention: "Mention manuscrite « Pour solde de tout compte, lu et approuvé » - signature",
        hautBoite: 44,
      });
      doc.y = yBloc;
      yFin = signatureEmployeur(doc, entete, contenu, x0 + L - wSig, wSig, opts.emis, `Pour ${ou(contenu.employeur, "l'employeur")}`);
    } else {
      yFin = signatureEmployeur(doc, entete, contenu, x0 + L - wSig, wSig, opts.emis);
    }
    doc.y = Math.max(yFin, doc.y) + 6;
  }
  pieds(doc, entete, { reference: courrier.numero, projet, mention: false });
  doc.end();
  return fini;
}

// ------------------------------------------------------------------------------------------- ordre de virement
async function ordreVirementPdf(ov, entete, opts = {}) {
  const { doc, fini } = nouveauDocument();
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const projet = ov.statut === "BROUILLON";
  enteteClient(doc, entete);
  doc.font("Helvetica").fontSize(9.8).fillColor("#000").text(`Dakar, le ${dateLongue(ov.date_creation || new Date())}`, x0, doc.y, { width: L, align: "right" });
  doc.font("Helvetica").fontSize(8.5).fillColor(GRIS).text(`Réf. : ${ov.numero}${projet ? "  -  PROJET" : ""}`, x0, doc.y, { width: L, align: "right" });
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(PETROLE).text(`Monsieur le Directeur`, x0, doc.y, { width: L / 2 });
  doc.font("Helvetica").fontSize(9.5).fillColor("#000").text(ou(ov.banque_donneur, "Banque"), x0, doc.y, { width: L / 2 });
  doc.moveDown(0.9);
  doc.font("Helvetica-Bold").fontSize(10.2).fillColor("#000").text(`Objet : Ordre de virement - ${ov.libelle}`, x0, doc.y, { width: L });
  doc.moveDown(0.7);
  para(doc, "Monsieur le Directeur,", { align: "left" });
  doc.moveDown(0.4);
  para(doc, `Nous vous prions de bien vouloir débiter notre compte n° ${ou(ov.compte_donneur)} ouvert dans vos livres, et d'exécuter le ${dateLongue(ov.date_execution)} les virements ci-dessous, pour un montant total de ${fmtF(ov.total)} (${premiereLettre(ov.total, true)}).`);
  doc.moveDown(0.7);

  const cols = [
    { k: "n", t: "N°", w: 22, a: "left" },
    { k: "nom", t: "Bénéficiaire", w: 128, a: "left" },
    { k: "banque", t: "Banque", w: 88, a: "left" },
    { k: "numero_compte", t: "N° de compte", w: 160, a: "left" },
    { k: "montant", t: "Montant (F CFA)", w: L - 398, a: "right" },
  ];
  const entetesTable = () => {
    const y = doc.y;
    doc.rect(x0, y - 2, L, 16).fillColor("#EEF2F3").fill();
    let x = x0;
    doc.font("Helvetica-Bold").fontSize(8.3).fillColor(PETROLE);
    for (const c of cols) { doc.text(c.t, x + 3, y + 1, { width: c.w - 6, align: c.a, lineBreak: false }); x += c.w; }
    doc.y = y + 17;
  };
  entetesTable();
  const lignes = ov.lignes_json || [];
  lignes.forEach((l, i) => {
    if (doc.y + 18 > doc.page.height - doc.page.margins.bottom) { doc.addPage(); doc.x = x0; entetesTable(); }
    const y = doc.y;
    let x = x0;
    const vals = { n: String(i + 1), nom: l.nom || "", banque: l.banque || "", numero_compte: l.numero_compte || "", montant: fmt(Number(l.montant) || 0) };
    doc.font("Helvetica").fontSize(8.3).fillColor("#000");
    for (const c of cols) { doc.text(vals[c.k], x + 3, y, { width: c.w - 6, align: c.a, lineBreak: false }); x += c.w; }
    doc.y = y + 14;
    doc.moveTo(x0, doc.y).lineTo(x0 + L, doc.y).lineWidth(0.3).strokeColor(LIGNE).stroke();
    doc.y += 2;
  });
  if (doc.y + 24 > doc.page.height - doc.page.margins.bottom) { doc.addPage(); doc.x = x0; }
  const yT = doc.y + 4;
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#000");
  doc.text(`TOTAL (${lignes.length} virement${lignes.length > 1 ? "s" : ""})`, x0 + 3, yT, { width: L - 140, lineBreak: false });
  doc.text(fmt(Number(ov.total) || 0), x0 + L - 130, yT, { width: 127, align: "right", lineBreak: false });
  doc.y = yT + 20;
  para(doc, `Arrêté le présent ordre à la somme de : ${premiereLettre(ov.total)}.`, { italique: true, align: "left" });
  doc.moveDown(0.6);
  para(doc, "Veuillez agréer, Monsieur le Directeur, l'expression de nos salutations distinguées.", { align: "left" });
  doc.moveDown(0.8);
  asseoir(doc, 150);
  const wSig = 210;
  doc.y = signatureEmployeur(doc, entete, { employeur: entete.raison_sociale, signataire: { nom: entete.signataire_nom, titre: entete.signataire_titre } }, x0 + L - wSig, wSig, !projet);
  pieds(doc, entete, { reference: ov.numero, projet, mention: false });
  doc.end();
  return fini;
}

function premiereLettre(montant, minuscule) {
  const { montantEnLettres, premiereLettreMajuscule } = require("../utils/montantEnLettres");
  if (!montant) return "zéro franc CFA";
  const l = montantEnLettres(Number(montant));
  return minuscule ? l : premiereLettreMajuscule(l);
}

module.exports = { contratTravailPdf, dmtPdf, courrierRhPdf, ordreVirementPdf, helpersRh: { enteteClient, titreDoc, para, pieds, cadreSignature, signatureEmployeur, ou } };

