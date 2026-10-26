/**
 * PDF des devis et factures des entreprises clientes (pdfkit, sans navigateur : compatible avec l'hebergement mutualise).
 * Meme contenu que l'impression de l'ecran (en-tete du tenant, remise par ligne, TVA ou exoneration, acompte/solde, net a payer,
 * montant en lettres, conditions, signature et cachet, mentions legales), construit a partir d'un document fige (snapshot).
 */
const pdfs = require("./offresContratsPdf");
const { montantEnLettres, premiereLettreMajuscule } = require("../utils/montantEnLettres");

const H = pdfs.helpers;
const { PETROLE, GRIS, LIGNE } = H;
const ROUGE = "#A8402B";

const nb = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const [e, d] = v.toFixed(2).split(".");
  const entier = e.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return d === "00" ? entier : `${entier},${d}`;
};
const xof = (n) => `${nb(n)} XOF`;
const qte = (n) => String(Number(n)).replace(".", ",");
const pct = (n) => String(Math.round(Number(n) * 100) / 100).replace(".", ",");
const jour = (d) => (d ? H.dateCourte(d) : "");

/** Meme repartition que frontend/lib/remiseLignes.js : plus fort reste, en centimes. */
function remisesParLigne(lignes, montantRemise) {
  const resultat = new Map();
  const cible = Math.round((Number(montantRemise) || 0) * 100);
  const chiffrees = (lignes || []).filter((l) => Number(l.montant_ht) > 0);
  const total = chiffrees.reduce((s, l) => s + Math.round(Number(l.montant_ht) * 100), 0);
  if (!(cible > 0) || !(total > 0)) return resultat;
  const brut = chiffrees.map((l) => (cible * Math.round(Number(l.montant_ht) * 100)) / total);
  const parts = brut.map((x) => Math.floor(x));
  let reste = cible - parts.reduce((s, p) => s + p, 0);
  const ordre = brut.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; reste > 0 && k < ordre.length; k++, reste--) parts[ordre[k].i] += 1;
  chiffrees.forEach((l, i) => {
    const ht = Math.round(Number(l.montant_ht) * 100);
    resultat.set(l.id, { remise: parts[i] / 100, net: (ht - parts[i]) / 100 });
  });
  return resultat;
}

/** Numero de facture tel qu'affiche a l'ecran : AAAA-MM-NNN pour les numeros automatiques. */
function numeroFacture(numero, mois) {
  if (!/^\d{4}-\d+$/.test(String(numero))) return numero;
  const [annee, seq] = String(numero).split("-");
  return `${annee}-${String(mois || 1).padStart(2, "0")}-${seq}`;
}

function enteteEntreprise(doc, e, droite) {
  const x0 = doc.page.margins.left;
  const L = H.largeurUtile(doc);
  const y0 = doc.y;
  const logo = H.image(e.logo_base64);
  const aLogo = H.placerImage(doc, logo, x0, y0, [96, 60]);
  const xT = x0 + (aLogo ? 106 : 0);
  const wT = L * 0.6 - (aLogo ? 106 : 0);
  doc.font("Helvetica-Bold").fontSize(12.5).fillColor(PETROLE).text(e.raison_sociale || "-", xT, y0, { width: wT });
  doc.font("Helvetica").fontSize(8.5).fillColor(GRIS);
  for (const l of [e.adresse, e.telephone, e.email]) if (l) doc.text(l, xT, doc.y, { width: wT });
  const yGauche = doc.y;
  // Colonne de droite : numero et date du document.
  const xD = x0 + L * 0.6 + 10;
  const wD = L * 0.4 - 10;
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#000").text(droite.titre, xD, y0, { width: wD, align: "right" });
  doc.font("Helvetica").fontSize(9.5).fillColor(GRIS);
  for (const l of droite.lignes) if (l) doc.text(l, xD, doc.y + 1, { width: wD, align: "right" });
  const yFin = Math.max(yGauche, y0 + (aLogo ? 62 : 0), doc.y) + 8;
  doc.moveTo(x0, yFin).lineTo(x0 + L, yFin).lineWidth(1.6).strokeColor(PETROLE).stroke();
  doc.x = x0;
  doc.y = yFin + 16;
}

function blocClient(doc, d, libelle, objet) {
  const x0 = doc.page.margins.left;
  const L = H.largeurUtile(doc);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(GRIS).text(libelle.toUpperCase(), x0, doc.y, { characterSpacing: 0.4 });
  doc.font("Helvetica-Bold").fontSize(11.5).fillColor("#000").text(d.client_nom || "-", x0, doc.y + 1, { width: L * 0.7 });
  if (d.client_adresse) doc.font("Helvetica").fontSize(9.5).fillColor(GRIS).text(d.client_adresse, x0, doc.y, { width: L * 0.7 });
  if (objet) doc.font("Helvetica").fontSize(9.5).fillColor(GRIS).text(`Objet : ${objet}`, x0, doc.y + 4, { width: L });
  doc.x = x0;
  doc.y += 14;
}

function tableau(doc, d, remises) {
  const x0 = doc.page.margins.left;
  const L = H.largeurUtile(doc);
  const lignes = d.lignes || [];
  const aRef = lignes.some((l) => l.reference);
  const aRemise = remises.size > 0;
  // Largeurs : designation prend le reste.
  const fixes = [];
  if (aRef) fixes.push(["ref", 50]);
  fixes.push(["unite", 32], ["qte", 38], ["pu", 58], ["montant", 66]);
  if (aRemise) fixes.push(["remise", 58], ["net", 64]);
  const largeurFixe = fixes.reduce((s, [, w]) => s + w, 0);
  const cols = [];
  if (aRef) cols.push({ k: "ref", w: 50, lib: "Réf.", al: "left" });
  cols.push({ k: "des", w: L - largeurFixe, lib: "Désignation", al: "left" });
  cols.push({ k: "unite", w: 32, lib: "Unité", al: "center" }, { k: "qte", w: 38, lib: "Qté", al: "right" }, { k: "pu", w: 58, lib: "Prix unit.", al: "right" }, { k: "montant", w: 66, lib: "Montant", al: "right" });
  if (aRemise) cols.push({ k: "remise", w: 58, lib: `Remise ${pct(d.pourcentage_remise)}%`, al: "right" }, { k: "net", w: 64, lib: "Net HT", al: "right" });
  const xs = [x0];
  cols.forEach((c, i) => xs.push(xs[i] + c.w));
  const entete = () => {
    const y = doc.y;
    doc.rect(x0, y, L, 20).fill(PETROLE);
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF");
    cols.forEach((c, i) => doc.text(c.lib, xs[i] + 3, y + 6.5, { width: c.w - 6, align: c.al, lineBreak: false }));
    doc.y = y + 20;
  };
  entete();
  for (const l of lignes) {
    const nc = l.non_chiffre === true;
    doc.font("Helvetica").fontSize(8.5);
    const h = Math.max(20, doc.heightOfString(l.designation || "", { width: cols[aRef ? 1 : 0].w - 6 }) + 10);
    if (doc.y + h > H.basPage(doc)) {
      doc.addPage();
      entete();
    }
    const y = doc.y;
    doc.font("Helvetica").fontSize(8.5).fillColor("#000");
    cols.forEach((c, i) => {
      const x = xs[i] + 3;
      const w = c.w - 6;
      const r = remises.get(l.id);
      let v = "";
      if (c.k === "ref") v = l.reference || "";
      else if (c.k === "des") v = l.designation || "";
      else if (c.k === "unite") v = l.unite || "";
      else if (c.k === "qte") v = qte(l.quantite);
      else if (c.k === "pu") v = nc ? "" : nb(l.prix_unitaire_ht);
      else if (c.k === "montant") v = nc ? "" : nb(l.montant_ht);
      else if (c.k === "remise") v = r ? `-${nb(r.remise)}` : "";
      else if (c.k === "net") v = r ? nb(r.net) : "";
      if (c.k === "remise") doc.fillColor(ROUGE);
      else doc.fillColor("#000");
      doc.text(v, x, y + 5, { width: w, align: c.al, lineBreak: c.k === "des" });
    });
    if (nc) {
      // Ligne non chiffree : mention a la place du prix et du montant (NC, sur devis...).
      const iPu = cols.findIndex((c) => c.k === "pu");
      doc.font("Helvetica-BoldOblique").fontSize(9).fillColor("#000").text(l.mention_prix || "NC", xs[iPu] + 3, y + 5, { width: cols[iPu].w + cols[iPu + 1].w - 6, align: "right", lineBreak: false });
    }
    doc.moveTo(x0, y + h).lineTo(x0 + L, y + h).lineWidth(0.4).strokeColor(LIGNE).stroke();
    doc.y = y + h;
  }
  doc.x = x0;
}

function ligneTotal(doc, lib, val, { fort, couleur } = {}) {
  H.asseoir(doc, 20);
  const x0 = doc.page.margins.left;
  const L = H.largeurUtile(doc);
  const y = doc.y + 3;
  doc.font(fort ? "Helvetica-Bold" : "Helvetica").fontSize(fort ? 11 : 9.5).fillColor(couleur || (fort ? PETROLE : "#000"));
  doc.text(lib, x0 + L - 330, y, { width: 190, align: "right", lineBreak: false });
  doc.text(val, x0 + L - 135, y, { width: 135, align: "right", lineBreak: false });
  doc.y = y + (fort ? 17 : 14);
  doc.x = x0;
}

function totaux(doc, d, partiel) {
  const remise = Number(d.pourcentage_remise) > 0;
  ligneTotal(doc, partiel ? "Total HT partiel" : "Total HT", xof(d.total_ht));
  if (remise) {
    ligneTotal(doc, `Remise (${pct(d.pourcentage_remise)}%)`, `-${xof(d.montant_remise)}`, { couleur: ROUGE });
    ligneTotal(doc, "Total HT net de remise", xof(Number(d.total_ht) - Number(d.montant_remise)));
  }
  if (Number(d.taux_tva_pourcentage) > 0) {
    ligneTotal(doc, `TVA (${pct(d.taux_tva_pourcentage)}%)`, xof(d.montant_tva), { couleur: GRIS });
  } else if (d.client_exonere_tva) {
    H.asseoir(doc, 18);
    const x0 = doc.page.margins.left;
    doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(`Exonéré de TVA${d.client_motif_exoneration_tva ? ` (${d.client_motif_exoneration_tva})` : ""}`, x0, doc.y + 3, { width: H.largeurUtile(doc), align: "right" });
    doc.y += 4;
  }
  ligneTotal(doc, partiel ? "Total TTC partiel" : "Total TTC", xof(d.total_ttc), { fort: true });
}

function blocArrete(doc, label, montant, partiel) {
  const v = Number(montant);
  if (!Number.isFinite(v) || v <= 0) return;
  const lettres = premiereLettreMajuscule(montantEnLettres(v));
  if (!lettres) return;
  const x0 = doc.page.margins.left;
  const L = H.largeurUtile(doc);
  doc.font("Helvetica-BoldOblique").fontSize(10);
  const h = doc.heightOfString(`${lettres} (${nb(v)} XOF)`, { width: L - 20 }) + 30;
  H.asseoir(doc, h + 8);
  const y = doc.y + 10;
  doc.roundedRect(x0, y, L, h, 4).lineWidth(0.7).strokeColor(partiel ? ROUGE : LIGNE).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(GRIS).text(label.toUpperCase(), x0 + 10, y + 7, { width: L - 20, characterSpacing: 0.3 });
  doc.font("Helvetica-BoldOblique").fontSize(10).fillColor("#000").text(`${lettres} `, x0 + 10, doc.y + 2, { width: L - 20, continued: true });
  doc.font("Helvetica").fillColor(GRIS).text(`(${nb(v)} XOF)`);
  doc.x = x0;
  doc.y = y + h + 4;
}

function piedEntreprise(e) {
  return [e.rccm ? `RCCM ${e.rccm}` : null, e.ninea ? `NINEA ${e.ninea}` : null, e.site_web || null, e.coordonnees_bancaires || null].filter(Boolean);
}

function pieds(doc, e, reference) {
  const range = doc.bufferedPageRange();
  const x0 = doc.page.margins.left;
  const L = H.largeurUtile(doc);
  const mentions = piedEntreprise(e).join("  ·  ");
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const mb = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 52;
    doc.moveTo(x0, y).lineTo(x0 + L, y).lineWidth(0.5).strokeColor(LIGNE).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(GRIS);
    if (mentions) doc.text(mentions, x0, y + 5, { width: L, align: "center", height: 20 });
    doc.text(`${reference}  -  Page ${i + 1} / ${range.count}`, x0, y + 28, { width: L, align: "right", lineBreak: false });
    doc.page.margins.bottom = mb;
  }
}

/** Signature de l'entreprise (nom, titre, signature et cachet) a droite ; cadre du client a gauche si une signature est demandee. */
function blocsSignature(doc, e, { cadre, titreCadre, aide, signature }) {
  const x0 = doc.page.margins.left;
  const L = H.largeurUtile(doc);
  H.asseoir(doc, 150);
  doc.moveDown(0.8);
  const y = doc.y;
  const wDemi = L / 2 - 10;
  if (cadre) {
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(PETROLE).text(titreCadre, x0, y, { width: wDemi });
    doc.font("Helvetica").fontSize(8).fillColor(GRIS).text(aide, x0, doc.y + 2, { width: wDemi });
    const yc = doc.y + 6;
    doc.rect(x0, yc, wDemi, 80).lineWidth(0.6).strokeColor(LIGNE).stroke();
    pdfs.helpers.signatureClient(doc, signature, x0, yc, wDemi, 80);
  }
  const xd = x0 + L / 2 + 15;
  const wd = L / 2 - 15;
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text(e.signataire_nom || "", xd, y, { width: wd, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(e.signataire_titre || "", xd, doc.y, { width: wd, align: "right" });
  const img = H.image(e.signature_cachet_base64);
  if (img) H.placerImage(doc, img, xd + wd - 150, doc.y + 6, [150, 90]);
  doc.x = x0;
  doc.y = y + 150;
}

async function ventePdf(type, d, e, opts = {}) {
  const { doc, fini } = H.nouveauDocument();
  const x0 = doc.page.margins.left;
  const estFacture = type === "FACTURE";
  const numero = estFacture ? numeroFacture(d.numero, d.mois_emission) : d.numero;
  const remises = Number(d.pourcentage_remise) > 0 ? remisesParLigne(d.lignes, d.montant_remise) : new Map();
  const nbNC = Number(d.nb_lignes_non_chiffrees) || 0;
  const partiel = !estFacture && nbNC > 0;

  enteteEntreprise(doc, e, {
    titre: estFacture ? `Facture N° ${numero}${d.reference_bc_client ? `/${d.reference_bc_client}` : ""}` : `Devis N° ${numero}`,
    lignes: estFacture ? [jour(d.date_facture), d.date_echeance ? `Échéance : ${jour(d.date_echeance)}` : ""] : [jour(d.date_devis)],
  });
  blocClient(doc, d, estFacture ? "Facturer à" : "Client", estFacture ? null : d.objet);
  tableau(doc, d, remises);
  doc.moveDown(0.5);
  totaux(doc, d, partiel);

  const typeFact = d.type_facturation && d.type_facturation !== "INTEGRALE" ? d.type_facturation : null;
  if (estFacture && typeFact) {
    H.asseoir(doc, 60);
    const y = doc.y + 10;
    const w = 260;
    const xr = x0 + H.largeurUtile(doc) - w;
    doc.roundedRect(xr, y, w, 48, 5).fillAndStroke("#EAF1F1", LIGNE);
    doc.font("Helvetica").fontSize(8.5).fillColor(GRIS).text(typeFact === "ACOMPTE" ? `Acompte de ${pct(d.pourcentage_acompte)}%` : "Solde (après acompte(s) déjà facturé(s) sur ce devis)", xr + 10, y + 8, { width: w - 20 });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(PETROLE).text("Net à payer", xr + 10, y + 28, { width: 110, lineBreak: false });
    doc.text(xof(d.montant_net_a_payer), xr + 110, y + 28, { width: w - 120, align: "right", lineBreak: false });
    doc.x = x0;
    doc.y = y + 54;
  }
  if (partiel) {
    H.asseoir(doc, 40);
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(ROUGE).text(`Total partiel : ${nbNC} ligne(s) non chiffrée(s) ne sont pas incluses. Ce montant ne constitue pas le montant définitif de la commande.`, x0, doc.y, { width: H.largeurUtile(doc) });
  }
  if (estFacture) {
    blocArrete(doc, typeFact === "ACOMPTE" ? "Arrêtée la présente facture d'acompte à la somme de" : typeFact === "SOLDE" ? "Arrêtée la présente facture de solde à la somme de" : "Arrêtée la présente facture à la somme de", typeFact ? d.montant_net_a_payer : d.total_ttc, false);
  } else {
    blocArrete(doc, partiel ? "Arrêté le présent devis, hors lignes non chiffrées, à la somme partielle de" : "Arrêté le présent devis à la somme de", d.total_ttc, partiel);
    const cond = [["Conditions de paiement", d.conditions_paiement], ["Délai de livraison", d.delai_livraison], ["Validité de l'offre", d.validite_offre]].filter(([, v]) => v && String(v).trim());
    if (cond.length) {
      H.asseoir(doc, 20 + cond.length * 14);
      doc.moveDown(0.8);
      for (const [k, v] of cond) doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(`${k} : ${v}`, x0, doc.y + 1, { width: H.largeurUtile(doc) });
    }
  }
  blocsSignature(doc, e, {
    cadre: !!opts.cadre,
    titreCadre: estFacture ? "ACCUSÉ DE RÉCEPTION (client)" : "BON POUR ACCORD (client)",
    aide: estFacture ? "Nom, qualité et signature du client, confirmant la réception de cette facture." : "Nom, qualité, signature et mention « Lu et approuvé, bon pour accord ».",
    signature: opts.signature,
  });
  if (opts.apres) {
    doc.addPage();
    doc.x = x0;
    opts.apres(doc);
  }
  pieds(doc, e, numero);
  doc.end();
  return fini;
}

module.exports = { facturePdf: (d, e, o) => ventePdf("FACTURE", d, e, o), devisPdf: (d, e, o) => ventePdf("DEVIS", d, e, o), remisesParLigne, numeroFacture };
