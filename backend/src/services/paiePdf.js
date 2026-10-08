/**
 * Paie (PAIE-3A) : imprimables d'une periode - bulletin de paie, journal de paie, etats sociaux et fiscaux.
 * pdfkit, memes en-tetes et signature/cachet de l'entreprise que les documents RH.
 */
const PDFDocument = require("pdfkit");
const { helpers: H } = require("./offresContratsPdf");
const { helpersRh: R } = require("./rhDocumentsPdf");

const { PETROLE, ACCENT, GRIS, LIGNE, nouveauDocument, largeurUtile, placerImage, image, asseoir, dateCourte, fmt } = H;
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const dec = (n, d = 2) => (n == null || n === "" ? "" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: d }).replace(/[  ]/g, " "));
const num = (v) => Number(v) || 0;
const montant = (n) => (num(n) === 0 ? "" : fmt(n));
const nomMois = (annee, mois) => `${MOIS[mois - 1]} ${annee}`;
const nomComplet = (id) => [id.prenom, String(id.nom || "").toUpperCase()].filter(Boolean).join(" ");

const LIBELLES_CLASSIF = { OUVRIER: "Ouvrier", EMPLOYE: "Employé", AGENT_MAITRISE: "Agent de maîtrise", CADRE: "Cadre" };

// ------------------------------------------------------------------------------------------------ bulletin de paie
/**
 * @param b calcul_json du bulletin (avec identite)
 * @param entete ligne tenant
 * @param o { annee, mois, reglages, cumuls: {mois, brut, imposable, ir, trimf, net}, reference, brouillon }
 */
async function bulletinPdf(b, entete, o) {
  const { doc, fini } = nouveauDocument();
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const id = b.identite || {};
  R.enteteClient(doc, entete);
  R.titreDoc(doc, "BULLETIN DE PAIE", `Période : ${nomMois(o.annee, o.mois)}  (du ${dateCourte(b.periode.debut)} au ${dateCourte(b.periode.fin)})`);

  // Employeur / salarie
  const w2 = (L - 12) / 2;
  const yb = doc.y;
  const boite = (x, titre, lignes) => {
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(PETROLE).text(titre, x + 6, yb + 5, { width: w2 - 12 });
    let y = doc.y + 1;
    doc.font("Helvetica").fontSize(8.4).fillColor("#000");
    for (const [k, v] of lignes) {
      if (v == null || v === "") continue;
      doc.fillColor(GRIS).text(`${k} : `, x + 6, y, { width: w2 - 12, continued: true }).fillColor("#000").text(String(v));
      y = doc.y + 0.5;
    }
    return y;
  };
  const regl = o.reglages || {};
  const yE = boite(x0, "EMPLOYEUR", [
    ["Raison sociale", entete.raison_sociale], ["Adresse", entete.adresse], ["NINEA", entete.ninea], ["RCCM", entete.rccm],
    ["N° employeur CSS", regl.numero_employeur_css], ["N° employeur IPRES", regl.numero_employeur_ipres],
  ]);
  const ancien = b.anciennete && b.anciennete.annees ? `${b.anciennete.annees} an(s)` : null;
  const yS = boite(x0 + w2 + 12, "SALARIÉ", [
    ["Nom", nomComplet(id)], ["Matricule", id.matricule], ["Emploi", id.poste],
    ["Convention", id.convention], ["Catégorie", id.categorie ? `${id.categorie}${id.classification ? ` (${LIBELLES_CLASSIF[id.classification] || id.classification})` : ""}` : null],
    ["Date d'embauche", id.date_embauche ? dateCourte(id.date_embauche) : null], ["Ancienneté", ancien],
    ["N° CSS", id.numero_css], ["N° IPRES", id.numero_ipres], ["Parts IR / TRIMF", id.parts_ir != null ? `${dec(id.parts_ir, 1)} / ${dec(id.parts_trimf, 1)}` : null],
  ]);
  const yFin = Math.max(yE, yS) + 5;
  doc.rect(x0, yb, w2, yFin - yb).lineWidth(0.5).strokeColor(LIGNE).stroke();
  doc.rect(x0 + w2 + 12, yb, w2, yFin - yb).lineWidth(0.5).strokeColor(LIGNE).stroke();
  doc.y = yFin + 8;
  doc.x = x0;

  const heuresSup = (b.lignes || []).filter((l) => l.origine === "VARIABLE" && l.taux != null && l.quantite != null && /^HS/.test(l.code)).reduce((s, l) => s + num(l.quantite), 0);
  const info = [`Jours du mois : ${b.jours.mois}`, `Jours payés : ${dec(b.jours.payes, 1)}`];
  if (b.jours.absences_retenues > 0) info.push(`Absences retenues : ${dec(b.jours.absences_retenues, 1)} j`);
  if (heuresSup > 0) info.push(`Heures supplémentaires : ${dec(heuresSup, 2)} h`);
  info.push(`Paiement : ${id.mode_paiement === "VIREMENT" || !id.mode_paiement ? "virement" : String(id.mode_paiement).toLowerCase().replace(/_/g, " ")}`);
  doc.font("Helvetica").fontSize(8.3).fillColor(GRIS).text(info.join("   -   "), x0, doc.y, { width: L });
  doc.moveDown(0.5);

  // Table des lignes
  const cols = [
    { k: "des", t: "Désignation", w: 168, a: "left" },
    { k: "base", t: "Base", w: 58, a: "right" },
    { k: "taux", t: "Taux / Qté", w: 52, a: "right" },
    { k: "gain", t: "Gains", w: 56, a: "right" },
    { k: "ret", t: "Retenues", w: 56, a: "right" },
    { k: "tp", t: "Taux pat.", w: 34, a: "right" },
    { k: "pat", t: "Charges patronales", w: L - 424, a: "right" },
  ];
  const enteteTable = () => {
    const y = doc.y;
    doc.rect(x0, y - 2, L, 17).fillColor("#EEF2F3").fill();
    let x = x0;
    doc.font("Helvetica-Bold").fontSize(7.6).fillColor(PETROLE);
    for (const c of cols) { doc.text(c.t, x + 3, y + 1, { width: c.w - 6, align: c.a, lineBreak: false }); x += c.w; }
    doc.y = y + 18;
  };
  const ligne = (v, o2 = {}) => {
    const seul = Object.keys(v).length === 1; // ligne de titre : le libelle occupe toute la largeur
    doc.font(o2.gras ? "Helvetica-Bold" : "Helvetica").fontSize(8.3);
    const wDes = (seul ? L : cols[0].w) - 6;
    const h = Math.max(13.5, doc.heightOfString(String(v.des || ""), { width: wDes }) + 2.5);
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 40) { doc.addPage(); doc.x = x0; enteteTable(); }
    const y = doc.y;
    let x = x0;
    doc.font(o2.gras ? "Helvetica-Bold" : "Helvetica").fontSize(8.3).fillColor("#000");
    if (o2.fond) doc.rect(x0, y - 1.5, L, h + 1).fillColor(o2.fond).fill().fillColor("#000");
    for (const c of cols) {
      if (seul && c.k !== "des") { x += c.w; continue; }
      doc.text(v[c.k] == null ? "" : String(v[c.k]), x + 3, y, { width: c.k === "des" ? wDes : c.w - 6, align: c.a, lineBreak: c.k === "des" });
      x += c.w;
    }
    doc.y = y + h;
    doc.moveTo(x0, doc.y - 1).lineTo(x0 + L, doc.y - 1).lineWidth(0.25).strokeColor(LIGNE).stroke();
  };
  const titreSection = (t) => { ligne({ des: t }, { gras: true, fond: "#F6F8F9" }); };
  enteteTable();

  titreSection("ÉLÉMENTS DE SALAIRE ET INDEMNITÉS");
  const jm = b.jours.mois || 30;
  for (const l of b.lignes || []) {
    let des = l.libelle, base = l.base != null ? dec(l.base, 2) : "", tq = "";
    if (l.code === "SALAIRE_BASE" || l.code === "SURSALAIRE") { tq = `${dec(num(l.quantite) * jm, 1)}/${jm}`; base = fmt(l.base); }
    else if (l.origine === "VARIABLE" && l.taux != null) { des = `${l.libelle} (${dec(l.quantite)} h)`; tq = `${dec(l.taux)} %`; }
    else if (l.code === "ANCIENNETE") { base = fmt(l.base); tq = `${dec(l.taux)} %`; }
    else if (l.quantite != null && l.base != null) { base = fmt(l.base); tq = dec(l.quantite); }
    else base = "";
    if (l.imposable_montant < l.montant && l.imposable) des += `  (dont ${fmt(l.montant - l.imposable_montant)} non imposable)`;
    else if (!l.imposable) des += "  (non imposable)";
    ligne({ des, base, taux: tq, gain: fmt(l.montant) });
  }
  ligne({ des: "SALAIRE BRUT", gain: fmt(b.totaux.brut) }, { gras: true, fond: "#EEF2F3" });

  titreSection("COTISATIONS ET RETENUES");
  const chargesParCode = new Map((b.charges_patronales || []).map((c) => [c.code, c]));
  const vus = new Set();
  for (const r of (b.retenues || []).filter((x) => x.section !== "IMPOT")) {
    const p = chargesParCode.get(r.code);
    vus.add(r.code);
    ligne({ des: r.libelle, base: fmt(r.base), taux: `${dec(r.taux, 3)} %`, ret: fmt(r.montant), tp: p ? `${dec(p.taux, 3)}` : "", pat: p ? fmt(p.montant) : "" });
  }
  for (const c of b.charges_patronales || []) {
    if (vus.has(c.code)) continue;
    ligne({ des: c.libelle, base: fmt(c.base), tp: `${dec(c.taux, 3)}`, pat: fmt(c.montant) });
  }
  for (const r of (b.retenues || []).filter((x) => x.section === "IMPOT")) {
    ligne({ des: r.code === "IR" ? `Impôt sur le revenu (${dec(r.parts, 1)} part(s))` : `TRIMF (${dec(r.parts, 1)} part(s))`, base: fmt(r.base), ret: fmt(r.montant) });
  }
  for (const r of b.retenues_saisies || []) ligne({ des: r.libelle, ret: fmt(r.montant) });
  ligne({ des: "TOTAL RETENUES ET CHARGES", ret: fmt(b.total_retenues), pat: fmt(b.total_charges_patronales) }, { gras: true, fond: "#EEF2F3" });
  if ((b.remboursements || []).length) {
    titreSection("REMBOURSEMENTS (HORS SALAIRE)");
    for (const r of b.remboursements) ligne({ des: r.libelle, gain: fmt(r.montant) });
  }

  // Net a payer
  doc.moveDown(0.6);
  asseoir(doc, 120);
  const yN = doc.y;
  doc.roundedRect(x0, yN, L, 30, 4).fillColor(PETROLE).fill();
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#FFFFFF").text("NET À PAYER", x0 + 12, yN + 10, { width: 200, lineBreak: false });
  doc.fontSize(15).text(`${fmt(b.net_a_payer)} F CFA`, x0 + L - 230, yN + 8, { width: 218, align: "right", lineBreak: false });
  doc.y = yN + 36;
  doc.font("Helvetica").fontSize(8).fillColor(GRIS).text(`Net imposable : ${fmt(b.totaux.imposable)} F   -   Coût employeur : ${fmt(b.cout_employeur)} F`, x0, doc.y, { width: L });
  if (num(b.net_avant_arrondi) !== num(b.net_a_payer)) doc.text(`Net avant arrondi : ${fmt(b.net_avant_arrondi)} F`, x0, doc.y, { width: L });

  if (o.cumuls) {
    doc.moveDown(0.5);
    const c = o.cumuls;
    doc.font("Helvetica-Bold").fontSize(8.3).fillColor(PETROLE).text(`Cumuls de l'année ${o.annee} (${c.mois} mois de paie)`, x0, doc.y, { width: L });
    doc.font("Helvetica").fontSize(8.3).fillColor("#000").text(`Brut : ${fmt(c.brut)}   -   Imposable : ${fmt(c.imposable)}   -   IR : ${fmt(c.ir)}   -   TRIMF : ${fmt(c.trimf)}   -   Net payé : ${fmt(c.net)}`, x0, doc.y + 1, { width: L });
  }

  // Signatures
  doc.moveDown(0.5);
  asseoir(doc, 118);
  const wSig = 215;
  const yS2 = doc.y;
  doc.y = yS2;
  R.signatureEmployeur(doc, entete, { employeur: entete.raison_sociale, signataire: { nom: entete.signataire_nom, titre: entete.signataire_titre } }, x0, wSig, !o.brouillon, `Pour ${entete.raison_sociale || "l'employeur"}`);
  const yFinG = doc.y;
  doc.y = yS2;
  const bas = R.cadreSignature(doc, x0 + L - wSig, yS2, wSig, 62, { titre: "Reçu pour acquit - le salarié", mention: o.lieu ? `${o.lieu}, le ____ / ____ / ________` : "Date et signature" });
  doc.y = Math.max(yFinG, bas) + 4;
  doc.x = x0;
  doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(GRIS).text("Pour vous aider à faire valoir vos droits, conservez ce bulletin de paie sans limitation de durée.", x0, doc.y, { width: L, align: "center" });

  R.pieds(doc, entete, { reference: o.reference, projet: !!o.brouillon, mention: false });
  doc.end();
  return fini;
}

// ------------------------------------------------------------------------------------------------ tableaux paysage
function nouveauPaysage() {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margins: { top: 40, bottom: 52, left: 36, right: 36 }, bufferPages: true });
  const morceaux = [];
  doc.on("data", (m) => morceaux.push(m));
  const fini = new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(morceaux))); doc.on("error", reject); });
  return { doc, fini };
}
function piedsPaysage(doc, entete, reference) {
  const range = doc.bufferedPageRange();
  const x0 = doc.page.margins.left;
  const L = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const marge = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 34;
    doc.moveTo(x0, y).lineTo(x0 + L, y).lineWidth(0.5).strokeColor(LIGNE).stroke();
    doc.font("Helvetica").fontSize(7).fillColor(GRIS);
    doc.text(entete.raison_sociale || "", x0, y + 5, { width: L - 150, lineBreak: false });
    doc.text(`${reference}  -  Page ${i + 1} / ${range.count}`, x0, y + 5, { width: L, align: "right", lineBreak: false });
    doc.page.margins.bottom = marge;
  }
}
/** Tableau generique : cols [{t, w (relatif), a}], rows [[...]], total [...] */
function tableau(doc, cols, rows, total, { titre } = {}) {
  const x0 = doc.page.margins.left;
  const L = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const somme = cols.reduce((s, c) => s + c.w, 0);
  const ech = somme > L ? L / somme : 1; // largeurs fixes (alignement d'un tableau a l'autre), reduites seulement si trop larges
  const ws = cols.map((c) => c.w * ech);
  const bas = () => doc.page.height - doc.page.margins.bottom;
  const entetes = () => {
    const y = doc.y;
    doc.rect(x0, y - 2, L, 18).fillColor("#EEF2F3").fill();
    let x = x0;
    doc.font("Helvetica-Bold").fontSize(7.4).fillColor(PETROLE);
    cols.forEach((c, i) => { doc.text(c.t, x + 2, y + 1, { width: ws[i] - 4, align: c.a || "left", lineBreak: false }); x += ws[i]; });
    doc.y = y + 19;
  };
  if (doc.y + (titre ? 24 : 0) + 19 + 15 * Math.min(2, rows.length + (total ? 1 : 0)) > bas()) { doc.addPage(); doc.x = x0; }
  if (titre) { doc.font("Helvetica-Bold").fontSize(11).fillColor(PETROLE).text(titre, x0, doc.y, { width: L }); doc.moveDown(0.4); }
  entetes();
  const rang = (vals, gras) => {
    if (doc.y + 15 > bas()) { doc.addPage(); doc.x = x0; entetes(); }
    const y = doc.y;
    let x = x0;
    doc.font(gras ? "Helvetica-Bold" : "Helvetica").fontSize(7.9).fillColor("#000");
    if (gras) doc.rect(x0, y - 1.5, L, 14.5).fillColor("#EEF2F3").fill().fillColor("#000");
    vals.forEach((v, i) => { doc.text(v == null ? "" : String(v), x + 2, y, { width: ws[i] - 4, align: cols[i].a || "left", lineBreak: false }); x += ws[i]; });
    doc.y = y + 13.5;
    doc.moveTo(x0, doc.y - 1).lineTo(x0 + L, doc.y - 1).lineWidth(0.25).strokeColor(LIGNE).stroke();
  };
  for (const r of rows) rang(r, false);
  if (total) rang(total, true);
  doc.moveDown(0.8);
}
function enteteSimple(doc, entete, titre, sous) {
  const x0 = doc.page.margins.left;
  const L = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font("Helvetica-Bold").fontSize(12).fillColor(PETROLE).text(entete.raison_sociale || "Entreprise", x0, doc.y, { width: L });
  doc.font("Helvetica").fontSize(8.3).fillColor(GRIS).text([entete.adresse, entete.ninea ? `NINEA ${entete.ninea}` : null].filter(Boolean).join(" - "), x0, doc.y, { width: L });
  doc.moveDown(0.3);
  doc.moveTo(x0, doc.y).lineTo(x0 + L, doc.y).lineWidth(1.2).strokeColor(ACCENT).stroke();
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(14).fillColor(PETROLE).text(titre, x0, doc.y, { width: L, align: "center" });
  if (sous) doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(sous, x0, doc.y + 1, { width: L, align: "center" });
  doc.moveDown(0.8);
}

async function journalPdf(e, entete, o) {
  const { doc, fini } = nouveauPaysage();
  enteteSimple(doc, entete, "JOURNAL DE PAIE", `Période : ${nomMois(o.annee, o.mois)}`);
  const cols = [
    { t: "Matricule", w: 50 }, { t: "Salarié", w: 130 }, { t: "Brut", w: 62, a: "right" }, { t: "Imposable", w: 62, a: "right" }, { t: "Cotisations salarié", w: 66, a: "right" },
    { t: "IR", w: 50, a: "right" }, { t: "TRIMF", w: 44, a: "right" }, { t: "Autres retenues", w: 56, a: "right" }, { t: "Remb.", w: 44, a: "right" },
    { t: "Net à payer", w: 66, a: "right" }, { t: "Charges patronales", w: 66, a: "right" }, { t: "Coût employeur", w: 66, a: "right" },
  ];
  const rows = e.journal.map((x) => [x.matricule || "", x.nom, fmt(x.brut), fmt(x.imposable), fmt(x.cotisations_salarie), montant(x.ir), montant(x.trimf), montant(x.autres_retenues), montant(x.remboursements), fmt(x.net_a_payer), fmt(x.charges_patronales), fmt(x.cout_employeur)]);
  const t = e.totaux_journal;
  tableau(doc, cols, rows, ["", `TOTAL (${e.journal.length} salarié${e.journal.length > 1 ? "s" : ""})`, fmt(t.brut), fmt(t.imposable), fmt(t.cotisations_salarie), fmt(t.ir), fmt(t.trimf), fmt(t.autres_retenues), fmt(t.remboursements), fmt(t.net_a_payer), fmt(t.charges_patronales), fmt(t.cout_employeur)]);
  piedsPaysage(doc, entete, o.reference);
  doc.end();
  return fini;
}

const LIB_ORG = { RETRAITE: "Retraite (IPRES)", SOCIAL: "Sécurité sociale (CSS)", TAXE: "Taxes (CFCE)" };
async function etatsSociauxFiscauxPdf(e, entete, o) {
  const { doc, fini } = nouveauPaysage();
  enteteSimple(doc, entete, "ÉTATS SOCIAUX ET FISCAUX", `Période : ${nomMois(o.annee, o.mois)}`);
  for (const org of e.organismes) {
    const cols = [{ t: "Matricule", w: 50 }, { t: "Salarié", w: 130 }, { t: org.section === "RETRAITE" ? "N° IPRES" : org.section === "SOCIAL" ? "N° CSS" : "", w: 70 }];
    for (const c of org.colonnes) cols.push({ t: `${c.code} base`, w: 60, a: "right" }, { t: "Salarié", w: 50, a: "right" }, { t: "Patronal", w: 54, a: "right" });
    const rows = org.salaries.map((s) => [s.matricule || "", s.nom, (org.section === "RETRAITE" ? s.numero_ipres : org.section === "SOCIAL" ? s.numero_css : "") || "", ...org.colonnes.flatMap((c) => [fmt(s.cotisations[c.code].base), montant(s.cotisations[c.code].salarie), montant(s.cotisations[c.code].patronal)])]);
    const tot = ["", "TOTAL", "", ...org.colonnes.flatMap((c) => [fmt(org.totaux[c.code].base), fmt(org.totaux[c.code].salarie), fmt(org.totaux[c.code].patronal)])];
    tableau(doc, cols, rows, tot, { titre: LIB_ORG[org.section] || org.section });
  }
  tableau(doc, [{ t: "Matricule", w: 50 }, { t: "Salarié", w: 150 }, { t: "Imposable", w: 70, a: "right" }, { t: "Parts IR", w: 40, a: "right" }, { t: "IR", w: 60, a: "right" }, { t: "Parts TRIMF", w: 50, a: "right" }, { t: "TRIMF", w: 60, a: "right" }],
    e.impots.map((x) => [x.matricule || "", x.nom, fmt(x.imposable), dec(x.parts_ir, 1), fmt(x.ir), dec(x.parts_trimf, 1), fmt(x.trimf)]),
    ["", "TOTAL", fmt(e.totaux_impots.imposable), "", fmt(e.totaux_impots.ir), "", fmt(e.totaux_impots.trimf)], { titre: "Impôt sur le revenu et TRIMF retenus" });
  tableau(doc, [{ t: "Organisme", w: 200 }, { t: "À payer (F CFA)", w: 90, a: "right" }],
    e.synthese.map((x) => [x.code === "IR" ? "Impôt sur le revenu (DGID)" : x.code === "TRIMF" ? "TRIMF" : LIB_ORG[x.code] || x.code, fmt(x.a_payer)]),
    ["TOTAL", fmt(e.synthese.reduce((s, x) => s + num(x.a_payer), 0))], { titre: "Synthèse des montants à payer" });
  piedsPaysage(doc, entete, o.reference);
  doc.end();
  return fini;
}

/** Etat annuel / trimestriel des salaires : recapitulatif par salarie, par mois, organismes, impots. */
async function etatPeriodiquePdf(e, entete, o) {
  const { doc, fini } = nouveauPaysage();
  const titre = e.trimestre ? `ÉTAT TRIMESTRIEL DES SALAIRES - T${e.trimestre} ${e.annee}` : `ÉTAT ANNUEL DES SALAIRES - ${e.annee}`;
  enteteSimple(doc, entete, titre, `Périodes clôturées : ${e.mois.filter((m) => m.statut === "CLOTUREE").map((m) => MOIS[m.mois - 1]).join(", ") || "aucune"}${e.complet ? "" : "  (état incomplet : certains mois ne sont pas clôturés)"}`);
  const cols = [
    { t: "Matricule", w: 46 }, { t: "Salarié", w: 112 }, { t: "Mois", w: 26, a: "right" }, { t: "Brut", w: 62, a: "right" }, { t: "Imposable", w: 62, a: "right" }, { t: "Cotis. salarié", w: 58, a: "right" },
    { t: "IR", w: 54, a: "right" }, { t: "TRIMF", w: 44, a: "right" }, { t: "Autres ret.", w: 50, a: "right" }, { t: "Remb.", w: 44, a: "right" }, { t: "Net payé", w: 64, a: "right" }, { t: "Charges pat.", w: 58, a: "right" }, { t: "Coût employeur", w: 64, a: "right" },
  ];
  const ligne = (x, debut) => [...debut, fmt(x.brut), fmt(x.imposable), fmt(x.cotis_salarie), montant(x.ir), montant(x.trimf), montant(x.autres_retenues), montant(x.remboursements), fmt(x.net), fmt(x.charges_patronales), fmt(x.cout_employeur)];
  tableau(doc, cols, e.salaries.map((x) => ligne(x, [x.matricule || "", x.nom, String(x.mois_travailles)])), ligne(e.totaux, ["", `TOTAL (${e.salaries.length} salarié${e.salaries.length > 1 ? "s" : ""})`, ""]), { titre: "Récapitulatif par salarié" });
  const colsM = [{ t: "Mois", w: 90 }, { t: "Bulletins", w: 40, a: "right" }, ...cols.slice(3)];
  tableau(doc, colsM, e.par_mois.map((x) => ligne(x, [nomMois(e.annee, x.mois), String(x.nb)])), ligne(e.totaux, ["TOTAL", ""]), { titre: "Par mois" });
  for (const org of e.organismes) {
    const c2 = [{ t: "Matricule", w: 50 }, { t: "Salarié", w: 130 }, { t: org.section === "RETRAITE" ? "N° IPRES" : org.section === "SOCIAL" ? "N° CSS" : "", w: 70 }];
    for (const c of org.colonnes) c2.push({ t: `${c.code} base`, w: 62, a: "right" }, { t: "Salarié", w: 52, a: "right" }, { t: "Patronal", w: 56, a: "right" });
    const rows = org.salaries.map((s) => [s.matricule || "", s.nom, (org.section === "RETRAITE" ? s.numero_ipres : org.section === "SOCIAL" ? s.numero_css : "") || "", ...org.colonnes.flatMap((c) => [fmt(s.cotisations[c.code].base), montant(s.cotisations[c.code].salarie), montant(s.cotisations[c.code].patronal)])]);
    tableau(doc, c2, rows, ["", "TOTAL", "", ...org.colonnes.flatMap((c) => [fmt(org.totaux[c.code].base), fmt(org.totaux[c.code].salarie), fmt(org.totaux[c.code].patronal)])], { titre: LIB_ORG[org.section] || org.section });
  }
  tableau(doc, [{ t: "Organisme", w: 200 }, { t: "À payer (F CFA)", w: 90, a: "right" }],
    e.synthese.map((x) => [x.code === "IR" ? "Impôt sur le revenu (DGID)" : x.code === "TRIMF" ? "TRIMF" : LIB_ORG[x.code] || x.code, fmt(x.a_payer)]),
    ["TOTAL", fmt(e.synthese.reduce((t, x) => t + num(x.a_payer), 0))], { titre: "Synthèse des montants à payer" });
  piedsPaysage(doc, entete, o.reference);
  doc.end();
  return fini;
}


const dfr = (d) => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}/${String(d).slice(0, 4)}` : "");
const avertTexte = { SANS_BRUT: "aucun brut disponible (saisir le brut des 12 derniers mois)", BULLETINS_INCOMPLETS: "bulletins validés incomplets sur la période (brut à vérifier)", MOIS_INVALIDE: "nombre de mois invalide" };

/** Etat de provision pour indemnites de depart a la retraite (paysage), meme presentation que le fichier de calcul. */
async function provisionRetraitePdf(e, entete, o) {
  const { doc, fini } = nouveauPaysage();
  const x0 = doc.page.margins.left;
  const Lg = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  enteteSimple(doc, entete, "CALCUL DE PROVISION POUR RETRAITE", `Arrêté au ${dfr(e.date_arrete)}`);
  const bar = e.bareme.tranches.map((t) => `${t.de_annees} à ${t.a_annees === null ? "plus" : t.a_annees} ans : ${t.pourcentage_par_an} %`).join("  |  ");
  doc.font("Helvetica").fontSize(8).fillColor("#000");
  doc.text(`Préparé par : ${o.preparePar || ""}    Date : ${dfr(new Date().toISOString().slice(0, 10))}    Base : ${e.base === "BRUT" ? "brut" : "brut imposable"} des 12 derniers mois civils (${dfr(e.fenetre.debut)} au ${dfr(e.fenetre.fin)})`, x0, doc.y, { width: Lg });
  doc.text(`Barème : ${e.bareme.libelle}  -  ${bar}${e.bareme.plafond_mois != null ? `  -  plafond ${e.bareme.plafond_mois} mois` : ""}`, x0, doc.y, { width: Lg });
  doc.moveDown(0.6);
  const tr = e.bareme.tranches;
  const cols = [
    { t: "N° Mle", w: 54 }, { t: "Entrée", w: 48 }, { t: "Nom du salarié", w: 104 }, { t: e.base === "BRUT" ? "Brut 12 mois" : "Brut imposable 12 mois", w: 62, a: "right" }, { t: "Mois", w: 26, a: "right" },
    { t: "Base mensuelle", w: 52, a: "right" }, { t: "Anc. jours", w: 34, a: "right" }, { t: "Anc. ans", w: 30, a: "right" },
    ...tr.map((t, i) => ({ t: `T${i + 1} (${t.pourcentage_par_an} %)`, w: 36, a: "right" })),
    { t: "Indemnité recalculée", w: 62, a: "right" }, { t: "Calculée par le client", w: 58, a: "right" }, { t: "Écart", w: 50, a: "right" },
  ];
  const dec = (n) => (n === null || n === undefined ? "" : String(Math.round(n * 100) / 100).replace(".", ","));
  const rows = e.lignes.map((l) => [l.matricule || "", dfr(l.date_entree), l.nom + (l.alertes.length ? " *" : ""), l.brut_12m === null ? "" : fmt(l.brut_12m), dec(l.nb_mois), l.base_mensuelle === null ? "" : fmt(l.base_mensuelle),
    String(l.anciennete_jours), dec(l.anciennete_ans), ...l.tranches.map((t) => (t.annees ? dec(t.annees) : "")), l.indemnite === null ? "" : fmt(l.indemnite), l.indemnite_client === null ? "" : fmt(l.indemnite_client), l.ecart === null ? "" : fmt(l.ecart)]);
  const total = ["", "", `TOTAL (${e.totaux.nb} salarié${e.totaux.nb > 1 ? "s" : ""})`, fmt(e.totaux.brut_12m), "", "", "", "", ...tr.map(() => ""), fmt(e.totaux.indemnite), e.totaux.indemnite_client ? fmt(e.totaux.indemnite_client) : "", e.totaux.ecart === null ? "" : fmt(e.totaux.ecart)];
  tableau(doc, cols, rows, total, {});
  const alertes = e.lignes.filter((l) => l.alertes.length);
  if (alertes.length) {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(PETROLE).text("* Points d'attention", x0, doc.y, { width: Lg });
    doc.font("Helvetica").fontSize(7.6).fillColor("#000");
    for (const l of alertes) doc.text(`${l.matricule || ""} ${l.nom} : ${l.alertes.map((a) => avertTexte[a] || a).join(" ; ")}`, x0, doc.y, { width: Lg });
    doc.moveDown(0.5);
  }
  doc.font("Helvetica").fontSize(7.4).fillColor(GRIS).text("Méthode : base mensuelle = brut des 12 derniers mois / mois pris en compte (prorata si entrée dans la période) ; ancienneté = (arrêté - date d'entrée) en jours / 365 ; indemnité = somme par tranche des années x % par année x base mensuelle. Taux à confirmer avec la convention collective applicable.", x0, doc.y, { width: Lg });
  piedsPaysage(doc, entete, o.reference);
  doc.end();
  return fini;
}

module.exports = { bulletinPdf, journalPdf, etatsSociauxFiscauxPdf, etatPeriodiquePdf, provisionRetraitePdf };
