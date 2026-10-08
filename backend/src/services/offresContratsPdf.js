/**
 * PDF de l'offre commerciale et du contrat (pdfkit, sans navigateur : compatible avec l'hebergement mutualise).
 * En-tete, logo, signature et cachet de l'editeur viennent de plateforme_parametres (les memes que les factures du Super Admin).
 */
const PDFDocument = require("pdfkit");

const PETROLE = "#12383F";
const ACCENT = "#C8742B";
const GRIS = "#5B6A6C";
const LIGNE = "#C9D1D2";
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const fmt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const xof = (n) => `${fmt(n)} F CFA`;
const qte = (n) => String(Number(n)).replace(".", ",");
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : "");
const dateCourte = (d) => {
  const s = iso(d);
  return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "";
};
const dateLongue = (d) => {
  const s = iso(d);
  if (!s) return "";
  const j = Number(s.slice(8, 10));
  return `${j === 1 ? "1er" : j} ${MOIS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
};
const POINTS = "……………………………";
const ou = (v, vide = POINTS) => (v && String(v).trim() ? String(v).trim() : vide);

function image(base64) {
  if (!base64) return null;
  try {
    return Buffer.from(base64, "base64");
  } catch (e) {
    return null;
  }
}

function nouveauDocument() {
  const doc = new PDFDocument({ size: "A4", margins: { top: 46, bottom: 64, left: 48, right: 48 }, bufferPages: true });
  const morceaux = [];
  doc.on("data", (m) => morceaux.push(m));
  const fini = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(morceaux)));
    doc.on("error", reject);
  });
  return { doc, fini };
}

const largeurUtile = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const basPage = (doc) => doc.page.height - doc.page.margins.bottom;

function placerImage(doc, buf, x, y, fit) {
  if (!buf) return false;
  try {
    doc.image(buf, x, y, { fit });
    return true;
  } catch (e) {
    return false;
  }
}

/** En-tete de premiere page : logo a gauche, identite de l'editeur a droite. */
function enteteEditeur(doc, params) {
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const y0 = doc.y;
  const logo = image(params.logo_base64);
  const aLogo = placerImage(doc, logo, x0, y0, [120, 56]);
  const xTexte = x0 + (aLogo ? 135 : 0);
  const wTexte = L - (aLogo ? 135 : 0);
  let y = y0;
  doc.font("Helvetica-Bold").fontSize(12).fillColor(PETROLE).text(ou(params.raison_sociale, "Éditeur de la plateforme"), xTexte, y, { width: wTexte, align: aLogo ? "right" : "left" });
  y = doc.y;
  const forme = [params.forme_juridique, params.capital_social ? `capital de ${params.capital_social}` : null].filter(Boolean).join(" - ");
  const lignes = [forme, params.adresse, [params.telephone ? `Tél. ${params.telephone}` : null, params.email].filter(Boolean).join(" - "), [params.rccm ? `RCCM ${params.rccm}` : null, params.ninea ? `NINEA ${params.ninea}` : null].filter(Boolean).join(" - "), params.site_web].filter(Boolean);
  doc.font("Helvetica").fontSize(8.5).fillColor(GRIS);
  for (const l of lignes) {
    doc.text(l, xTexte, y, { width: wTexte, align: aLogo ? "right" : "left" });
    y = doc.y;
  }
  const yFin = Math.max(y, y0 + (aLogo ? 58 : 0)) + 6;
  doc.moveTo(x0, yFin).lineTo(x0 + L, yFin).lineWidth(1.4).strokeColor(ACCENT).stroke();
  doc.x = x0;
  doc.y = yFin + 14;
}

function titre(doc, texte, sousTitre) {
  const x0 = doc.page.margins.left;
  doc.font("Helvetica-Bold").fontSize(16).fillColor(PETROLE).text(texte, x0, doc.y, { width: largeurUtile(doc), align: "center" });
  if (sousTitre) doc.font("Helvetica").fontSize(9.5).fillColor(GRIS).text(sousTitre, x0, doc.y + 2, { width: largeurUtile(doc), align: "center" });
  doc.moveDown(0.8);
}

function asseoir(doc, hauteur) {
  if (doc.y + hauteur > basPage(doc)) {
    doc.addPage();
    doc.x = doc.page.margins.left;
    return true;
  }
  return false;
}

/** Pied de page sur toutes les pages : copyright, paraphes (contrat) et numerotation. */
function piedsDePage(doc, params, { paraphes, reference }) {
  const range = doc.bufferedPageRange();
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const annee = new Date().getFullYear();
  const editeur = params.raison_sociale || "l'Éditeur";
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const margeBasse = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // le pied de page est dans la marge : sans cela pdfkit ajouterait une page
    const y = doc.page.height - 50;
    doc.moveTo(x0, y).lineTo(x0 + L, y).lineWidth(0.5).strokeColor(LIGNE).stroke();
    doc.font("Helvetica").fontSize(7).fillColor(GRIS);
    doc.text(`© ${annee} ${editeur} - Baobab Marchés - Tous droits réservés. Document confidentiel.`, x0, y + 5, { width: L - 90, lineBreak: false });
    doc.text(`${reference}  -  Page ${i + 1} / ${range.count}`, x0, y + 5, { width: L, align: "right", lineBreak: false });
    if (paraphes) doc.text("Paraphes :  Éditeur ________      Client ________", x0, y + 17, { width: L, align: "right", lineBreak: false });
    doc.page.margins.bottom = margeBasse;
  }
}

/** Bloc signature de l'editeur (image signature + cachet) ; renvoie la hauteur utilisee. */
function blocEditeur(doc, params, x, y, w, { mention } = {}) {
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(PETROLE).text(ou(params.raison_sociale, "L'Éditeur"), x, y, { width: w });
  let yy = doc.y;
  if (params.representant_nom) {
    doc.font("Helvetica").fontSize(9).fillColor("#000").text(`${params.representant_nom}${params.representant_fonction ? `, ${params.representant_fonction}` : ""}`, x, yy, { width: w });
    yy = doc.y;
  }
  if (mention) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor(GRIS).text(mention, x, yy + 1, { width: w });
    yy = doc.y;
  }
  const sig = image(params.signature_cachet_base64);
  if (sig) placerImage(doc, sig, x, yy + 4, [Math.min(w, 170), 80]);
  return yy + 88 - y;
}

// ---------------------------------------------------------------------------
// Tableau des lignes
// ---------------------------------------------------------------------------

function tableauLignes(doc, lignes) {
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const cols = [L - 45 - 45 - 74 - 84, 45, 45, 74, 84];
  const xs = [x0];
  cols.forEach((w, i) => xs.push(xs[i] + w));
  const entete = () => {
    const y = doc.y;
    doc.rect(x0, y, L, 20).fill(PETROLE);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#FFFFFF");
    ["Désignation", "Qté", "Unité", "Prix unitaire", "Montant"].forEach((h, i) => doc.text(h, xs[i] + 5, y + 6, { width: cols[i] - 10, align: i >= 3 ? "right" : i === 0 ? "left" : "center", lineBreak: false }));
    doc.y = y + 20;
  };
  entete();
  for (const l of lignes) {
    doc.font("Helvetica-Bold").fontSize(9);
    const hTitre = doc.heightOfString(l.libelle, { width: cols[0] - 10 });
    doc.font("Helvetica").fontSize(8);
    const hDesc = l.description ? doc.heightOfString(l.description, { width: cols[0] - 10 }) : 0;
    const h = Math.max(22, hTitre + hDesc + 10);
    if (doc.y + h > basPage(doc)) {
      doc.addPage();
      entete();
    }
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000").text(l.libelle, xs[0] + 5, y + 5, { width: cols[0] - 10 });
    if (l.description) doc.font("Helvetica").fontSize(8).fillColor(GRIS).text(l.description, xs[0] + 5, y + 5 + hTitre, { width: cols[0] - 10 });
    doc.font("Helvetica").fontSize(9).fillColor("#000");
    doc.text(qte(l.quantite), xs[1] + 3, y + 5, { width: cols[1] - 6, align: "center", lineBreak: false });
    doc.text(l.unite || "", xs[2] + 3, y + 5, { width: cols[2] - 6, align: "center", lineBreak: false });
    doc.text(fmt(l.prix_unitaire), xs[3] + 3, y + 5, { width: cols[3] - 8, align: "right", lineBreak: false });
    doc.font("Helvetica-Bold").text(fmt(l.montant), xs[4] + 3, y + 5, { width: cols[4] - 8, align: "right", lineBreak: false });
    doc.moveTo(x0, y + h).lineTo(x0 + L, y + h).lineWidth(0.5).strokeColor(LIGNE).stroke();
    doc.y = y + h;
  }
  doc.x = x0;
}

function totaux(doc, t, remisePct, tvaPct) {
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const wLib = 190;
  const xL = x0 + L - wLib - 84 + 5;
  const ligne = (lib, val, fort) => {
    asseoir(doc, 18);
    const y = doc.y + 3;
    doc.font(fort ? "Helvetica-Bold" : "Helvetica").fontSize(fort ? 10.5 : 9).fillColor(fort ? PETROLE : "#000");
    doc.text(lib, xL, y, { width: wLib, align: "right", lineBreak: false });
    doc.text(val, x0 + L - 84, y, { width: 79, align: "right", lineBreak: false });
    doc.y = y + (fort ? 16 : 14);
  };
  if (t.remise > 0 || tvaPct > 0) ligne("Sous-total", xof(t.sous_total));
  if (t.remise > 0) ligne(`Remise (${qte(remisePct)} %)`, `- ${xof(t.remise)}`);
  ligne(tvaPct > 0 ? "Total hors taxes" : "Total net", xof(t.total_ht), tvaPct <= 0);
  if (tvaPct > 0) {
    ligne(`TVA (${qte(tvaPct)} %)`, xof(t.total_tva));
    ligne("Total toutes taxes comprises", xof(t.total_ttc), true);
  }
  doc.x = x0;
}

function section(doc, libelle) {
  asseoir(doc, 40);
  const x0 = doc.page.margins.left;
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(PETROLE).text(libelle.toUpperCase(), x0, doc.y, { width: largeurUtile(doc), characterSpacing: 0.4 });
  doc.moveDown(0.25);
}

function corps(doc, texte, options = {}) {
  doc.font(options.gras ? "Helvetica-Bold" : "Helvetica").fontSize(options.taille || 9.5).fillColor(options.couleur || "#000");
  doc.text(texte, doc.page.margins.left + (options.retrait || 0), doc.y, { width: largeurUtile(doc) - (options.retrait || 0), align: options.align || "left", lineGap: 1.5 });
}

// ---------------------------------------------------------------------------
// Offre commerciale
// ---------------------------------------------------------------------------

/**
 * @param {object} offre offre (getOffre) @param {object} params plateforme_parametres
 */
async function offrePdf(offre, params) {
  const { doc, fini } = nouveauDocument();
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  enteteEditeur(doc, params);
  titre(doc, "OFFRE COMMERCIALE", `N° ${offre.numero}  -  Établie le ${dateLongue(offre.date_offre)}  -  Valable jusqu'au ${dateLongue(offre.date_validite)}`);

  // Destinataire
  const yBloc = doc.y;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(GRIS).text("DESTINATAIRE", x0, yBloc);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(`${offre.client_raison_sociale}${offre.client_forme_juridique ? ` (${offre.client_forme_juridique})` : ""}`, x0, doc.y + 2, { width: L / 2 });
  doc.font("Helvetica").fontSize(9).fillColor("#000");
  if (offre.client_adresse) doc.text(offre.client_adresse, x0, doc.y, { width: L / 2 });
  if (offre.representant_nom) doc.text(`À l'attention de ${offre.representant_nom}${offre.representant_fonction ? `, ${offre.representant_fonction}` : ""}`, x0, doc.y, { width: L / 2 });
  if (offre.destinataire_email) doc.text(offre.destinataire_email, x0, doc.y, { width: L / 2 });
  const yG = doc.y;
  // Objet (colonne de droite)
  const mode = offre.mode_hebergement === "LOCAL" ? "licence d'utilisation de la version installée" : "abonnement à la plateforme hébergée";
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(GRIS).text("OBJET", x0 + L / 2 + 15, yBloc, { width: L / 2 - 15 });
  doc.font("Helvetica").fontSize(9.5).fillColor("#000").text(`Offre de ${mode} Baobab Marchés, formule « ${offre.formule_nom || "-"} », pour une durée de ${offre.duree_mois} mois.`, x0 + L / 2 + 15, doc.y + 2, { width: L / 2 - 15 });
  doc.y = Math.max(yG, doc.y) + 14;
  doc.x = x0;

  tableauLignes(doc, offre.lignes);
  doc.moveDown(0.4);
  const t = { sous_total: offre.lignes.reduce((s, l) => s + l.montant, 0) };
  t.remise = Math.round((t.sous_total * Number(offre.remise_pct)) / 100);
  t.total_ht = Number(offre.total_ht_xof);
  t.total_tva = Number(offre.total_tva_xof);
  t.total_ttc = Number(offre.total_ttc_xof);
  totaux(doc, t, Number(offre.remise_pct), Number(offre.tva_pct));

  const incluses = (offre.modules || []).length ? `Modules inclus en supplément : ${offre.modules.map((m) => ({ COMPTABILITE: "Comptabilité", FISCALITE: "Fiscalité", PAIE: "Paie" }[m] || m)).join(", ")}.` : null;
  section(doc, "Conditions");
  corps(doc, [
    incluses,
    `Durée : ${offre.duree_mois} mois à compter de la date d'effet du contrat. Prix en francs CFA (XOF)${Number(offre.tva_pct) > 0 ? ", TVA comprise dans le total TTC" : ", nets"}.`,
    offre.conditions_paiement || "Paiement par virement bancaire ou mobile money, dans les quinze (15) jours de la facture. Les frais d'installation sont dus en une seule fois.",
    `Cette offre est valable ${offre.validite_jours} jours, soit jusqu'au ${dateLongue(offre.date_validite)}. Son acceptation donne lieu à l'établissement d'un contrat de ${offre.mode_hebergement === "LOCAL" ? "licence" : "service"}, qui vous sera adressé pour signature.`,
    offre.notes,
  ].filter(Boolean).join("\n"));
  if (params.coordonnees_bancaires) {
    doc.moveDown(0.3);
    corps(doc, `Coordonnées bancaires : ${params.coordonnees_bancaires}`, { taille: 9, couleur: GRIS });
  }

  // Bon pour accord
  asseoir(doc, 150);
  doc.moveDown(1);
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(PETROLE).text("BON POUR ACCORD (client)", x0, y, { width: L / 2 - 10 });
  doc.font("Helvetica").fontSize(8.5).fillColor(GRIS).text("Date, nom et qualité du signataire, signature et cachet précédés de la mention « Lu et approuvé, bon pour accord ».", x0, doc.y + 2, { width: L / 2 - 10 });
  doc.rect(x0, doc.y + 6, L / 2 - 10, 70).lineWidth(0.6).strokeColor(LIGNE).stroke();
  blocEditeur(doc, params, x0 + L / 2 + 15, y, L / 2 - 15, { mention: "Pour l'Éditeur" });

  piedsDePage(doc, params, { paraphes: false, reference: offre.numero });
  doc.end();
  return fini;
}

// ---------------------------------------------------------------------------
// Contrat
// ---------------------------------------------------------------------------

function presentationPartie(p, role) {
  const forme = p.forme_juridique ? `, ${p.forme_juridique}` : "";
  const capital = p.capital_social ? ` au capital de ${p.capital_social}` : "";
  const ident = [p.rccm ? `immatriculée au RCCM sous le numéro ${p.rccm}` : null, p.ninea ? `NINEA ${p.ninea}` : null].filter(Boolean).join(", ");
  const rep = `représentée par ${ou(p.representant_nom)}, agissant en qualité de ${ou(p.representant_fonction)}, dûment habilité${role === "Éditeur" ? "" : "(e)"} à cet effet`;
  return `La société ${ou(p.raison_sociale)}${forme}${capital}, dont le siège est situé à ${ou(p.adresse)}${ident ? `, ${ident}` : ""}, ${rep}`;
}

async function contratPdf(contratRow, params) {
  const c = contratRow.contenu_json;
  const { doc, fini } = nouveauDocument();
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const H = c.variante === "HEBERGE";
  // Les parametres de l'editeur sont ceux figes dans le contrat (identite), l'image de signature vient des parametres courants.
  const ed = { ...params, ...Object.fromEntries(Object.entries(c.editeur).filter(([, v]) => v)) };

  enteteEditeur(doc, ed);
  titre(doc, H ? "CONTRAT D'ABONNEMENT" : "CONTRAT DE LICENCE D'UTILISATION", `Plateforme Baobab Marchés  -  ${H ? "accès en ligne hébergé" : "version installée"}  -  N° ${contratRow.numero}`);

  section(doc, "Entre les soussignés");
  corps(doc, presentationPartie({ ...c.editeur }, "Éditeur") + ",", { align: "justify" });
  corps(doc, "ci-après dénommée « l'Éditeur »,", { gras: true });
  doc.moveDown(0.2);
  corps(doc, "d'une part,", { couleur: GRIS });
  doc.moveDown(0.4);
  corps(doc, "ET", { gras: true });
  doc.moveDown(0.4);
  corps(doc, presentationPartie({ ...c.client }, "Client") + ",", { align: "justify" });
  corps(doc, "ci-après dénommée « le Client »,", { gras: true });
  doc.moveDown(0.2);
  corps(doc, "d'autre part.", { couleur: GRIS });

  section(doc, "Préambule");
  corps(doc, `L'Éditeur conçoit, développe et exploite la plateforme logicielle « Baobab Marchés », solution de gestion des appels d'offres, des ventes, des achats, de la finance, de la comptabilité, de la fiscalité et des ressources humaines des entreprises, notamment du secteur du BTP. Le Client souhaite ${H ? "accéder à cette plateforme en mode hébergé" : "utiliser cette plateforme dans sa version installée"} pour ses besoins professionnels. Après avoir étudié l'offre n° ${c.offre_numero}, les parties se sont rapprochées et ont convenu ce qui suit.`, { align: "justify" });

  section(doc, "Il a été convenu ce qui suit");
  for (const a of c.articles) {
    asseoir(doc, 60);
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(PETROLE).text(`Article ${a.numero} - ${a.titre}`, x0, doc.y, { width: L });
    doc.moveDown(0.2);
    let k = 0;
    for (const p of a.paragraphes) {
      const liste = /^[a-i]\) /.test(p);
      if (liste) {
        corps(doc, p, { retrait: 16, align: "justify" });
      } else if (a.numero === 1) {
        corps(doc, p, { align: "justify" });
      } else {
        k += 1;
        corps(doc, `${a.numero}.${k}  ${p}`, { align: "justify" });
      }
      doc.moveDown(0.25);
    }
  }

  // Signatures
  asseoir(doc, 200);
  doc.moveDown(1);
  corps(doc, `Fait à ${ou(c.editeur.ville_signature, "Dakar")}, le ${dateLongue(c.date_contrat)}, en deux (2) exemplaires originaux, dont un pour chaque partie.`, { gras: true });
  doc.moveDown(0.8);
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(PETROLE).text("Pour le Client", x0, y, { width: L / 2 - 10 });
  doc.font("Helvetica").fontSize(9).fillColor("#000").text(`${ou(c.client.raison_sociale)}`, x0, doc.y, { width: L / 2 - 10 });
  doc.text(`${ou(c.client.representant_nom)}, ${ou(c.client.representant_fonction, "qualité")}`, x0, doc.y, { width: L / 2 - 10 });
  doc.font("Helvetica-Oblique").fontSize(8).fillColor(GRIS).text("Date, signature et cachet précédés de la mention « Lu et approuvé, bon pour accord »", x0, doc.y + 1, { width: L / 2 - 10 });
  doc.rect(x0, doc.y + 4, L / 2 - 10, 72).lineWidth(0.6).strokeColor(LIGNE).stroke();
  blocEditeur(doc, ed, x0 + L / 2 + 15, y, L / 2 - 15, { mention: "Pour l'Éditeur - lu et approuvé, bon pour accord" });

  // Annexe 1
  doc.addPage();
  doc.x = x0;
  titre(doc, "ANNEXE 1", "Conditions particulières et financières");
  const lignesCle = [
    ["Client", `${ou(c.client.raison_sociale)}${c.client.forme_juridique ? ` (${c.client.forme_juridique})` : ""}`],
    ["Offre de référence", `${c.offre_numero}${c.offre_date ? ` du ${dateCourte(c.offre_date)}` : ""}`],
    ["Formule", `${c.formule.nom || "-"}${c.formule.plafond_utilisateurs ? ` (jusqu'à ${c.formule.plafond_utilisateurs} utilisateurs)` : " (utilisateurs illimités)"}`],
    ["Mode", H ? "Abonnement - accès en ligne hébergé par l'Éditeur" : "Licence d'utilisation - version installée chez le Client"],
    ["Modules", ["Socle Baobab Marchés (marchés et ventes, achats, finance, ressources humaines)", ...(c.modules || [])].join(" ; ")],
    ["Date d'effet", dateLongue(c.date_effet)],
    ["Durée", `${c.duree_mois} mois, jusqu'au ${dateLongue(c.date_fin)}`],
    ["Clause pénale (article 15)", `${c.penalite_mois} mois de redevances hors taxes`],
  ];
  for (const [k, v] of lignesCle) {
    const y1 = doc.y;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(GRIS).text(k, x0, y1, { width: 140 });
    const yk = doc.y;
    doc.font("Helvetica").fontSize(9.5).fillColor("#000").text(v, x0 + 150, y1, { width: L - 150 });
    doc.y = Math.max(yk, doc.y) + 4;
    doc.moveTo(x0, doc.y - 1).lineTo(x0 + L, doc.y - 1).lineWidth(0.4).strokeColor(LIGNE).stroke();
    doc.y += 3;
  }
  section(doc, "Redevances et frais");
  tableauLignes(doc, c.lignes);
  doc.moveDown(0.4);
  const t = { sous_total: c.lignes.reduce((s, l) => s + l.montant, 0) };
  t.remise = Math.round((t.sous_total * c.remise_pct) / 100);
  t.total_ht = c.totaux.total_ht;
  t.total_tva = c.totaux.total_tva;
  t.total_ttc = c.totaux.total_ttc;
  totaux(doc, t, c.remise_pct, c.tva_pct);
  section(doc, "Modalités de paiement");
  corps(doc, c.conditions_paiement || "Paiement par virement bancaire ou mobile money, dans les quinze (15) jours de la date de la facture. Les frais d'installation sont dus en une seule fois.", { align: "justify" });
  if (c.editeur.coordonnees_bancaires) {
    doc.moveDown(0.3);
    corps(doc, `Coordonnées bancaires de l'Éditeur : ${c.editeur.coordonnees_bancaires}`, { taille: 9, couleur: GRIS });
  }
  if (c.editeur.email) {
    doc.moveDown(0.3);
    corps(doc, `Notifications à l'Éditeur : ${c.editeur.email}${c.client.email ? `  -  Notifications au Client : ${c.client.email}` : ""}`, { taille: 9, couleur: GRIS });
  }

  piedsDePage(doc, ed, { paraphes: true, reference: contratRow.numero });
  doc.end();
  return fini;
}

module.exports = {
  offrePdf,
  contratPdf,
  // Briques reutilisees par les PDF RH (contrats de travail, DMT).
  helpers: { nouveauDocument, largeurUtile, basPage, placerImage, image, titre, asseoir, section, corps, dateLongue, dateCourte, ou, fmt, PETROLE, ACCENT, GRIS, LIGNE, POINTS },
};
