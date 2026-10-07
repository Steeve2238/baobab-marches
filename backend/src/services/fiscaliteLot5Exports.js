/**
 * Exports du lot 5 (module Fiscalite) : contribution economique locale (CEL) et taxe speciale
 * sur les voitures particulieres des personnes morales. Excel + PDF, filigrane BROUILLON tant que la declaration n'est pas deposee.
 */
const XLSX = require("xlsx");
const { fmt, nouveauPdf, tronquer, dateJJMMAAbarre, feuilleAvecLargeurs, formaterNombres } = require("./comptaExports");

const NATURE_FR = { LOUE: "Local loué", ACTIF: "Local à l'actif", GRATUIT: "Occupé à titre gratuit", DISPOSITION: "Mis à disposition" };
const MOTIF_FR = {
  HORS_PERIODE: "hors période",
  EXONERE: "exonéré",
  DONNE_EN_LOCATION: "actif donné en location (non imposé)",
  HORS_CATEGORIE: "hors catégorie (non voiture particulière)",
  EXONERE_NEGOCIANT: "exonéré — négociant",
  EXONERE_TRANSPORT_PUBLIC: "exonéré — transport public",
  EXONERE_AUTO_ECOLE: "exonéré — auto-école",
  EXONERE_COMPETITION: "exonéré — compétition",
  EXONERE_LOCATION_SANS_CHAUFFEUR: "exonéré — location sans chauffeur",
  PUISSANCE_ABSENTE: "puissance fiscale à renseigner",
};
const BASE_CVA_FR = {
  CALCULEE: "1 % de la valeur ajoutée retenue",
  MINIMUM: "minimum de perception",
  MINIMUM_SIMPLIFIE: "minimum (régime réel simplifié)",
  EXONEREE_CREATION: "non due l'année de création",
};
const CLASSE_FR = { CV_4_MAX: "4 CV et moins", CV_5_11: "5 à 11 CV", CV_12_PLUS: "plus de 11 CV" };
const AVERT_FR = {
  CEL_SOURCE_IMPORT: "données de l'exercice précédent issues de la balance / du grand livre importés",
  CEL_EXERCICE_PRECEDENT_ABSENT: "aucune donnée comptable pour l'exercice précédent",
  CEL_IMMEUBLES_ACTIF_A_SAISIR: "immeubles à l'actif sans local « à l'actif » saisi",
  CEL_LOYERS_A_SAISIR: "loyers comptabilisés sans local loué saisi",
  CEL_LOYERS_ECART: "écart entre loyers comptabilisés et loyers des locaux saisis",
  CEL_AUCUN_LOCAL: "aucun local saisi",
  CEL_REGIME_CGU: "contribuable à la CGU : CEL hors champ",
  CEL_VA_A_SAISIR: "valeur ajoutée à saisir",
  CEL_VA_PLAFONNEE: "valeur ajoutée plafonnée à 70 % du chiffre d'affaires",
  CEL_VA_NEGATIVE: "valeur ajoutée négative",
  CEL_CVA_MINIMUM: "minimum de perception appliqué",
  CEL_CVA_SIMPLIFIE: "régime réel simplifié : minimum de perception",
  CEL_CVA_CREATION: "année de création : CVA non due",
  CEL_LOYERS_ET_AJUSTEMENTS: "loyers de plus de 3 mois et ajustements à contrôler",
  CEL_REGIMES_SPECIAUX: "régimes spéciaux (hôtels, SPI) à confirmer",
  CEL_HORS_CHAMP: "contribuable déclaré hors champ",
  PROFIL_NON_RENSEIGNE: "profil fiscal non renseigné",
  ECRITURES_EN_INSTANCE: "écritures en instance non retenues",
  VEH_AUCUN_VEHICULE: "aucun véhicule saisi",
  VEH_PUISSANCE_ABSENTE: "véhicules sans puissance fiscale",
  VEH_LOCATION_SANS_DATES: "véhicules loués sans dates",
  VEH_PARC_AUTO_A_REPRENDRE: "véhicules du Parc auto non repris",
  VEH_NON_DEDUCTIBLE: "taxe non déductible du résultat fiscal (art. 9-7)",
  VEH_CATEGORIE_A_VERIFIER: "catégorie « voiture particulière » à vérifier",
};
const avert = (a) => AVERT_FR[a.code] || a.code;
const fr = (v) => String(v).replace(".", ",");
const dj = (d) => (d ? dateJJMMAAbarre(d) : "");

// ---------------------------------------------------------------------------
// CEL
// ---------------------------------------------------------------------------

function celXlsx(calcul, contribuable, dossier) {
  const c = calcul;
  const wb = XLSX.utils.book_new();
  const statut = dossier ? dossier.statut : "BROUILLON";
  const aoa = [
    [contribuable.raison_sociale],
    [`Contribution économique locale ${c.annee} — ${statut}`],
    [],
    ["Récapitulatif", "Montant (XOF)", "Échéance"],
    ["Contribution sur les locaux professionnels", c.locaux.total, dj(c.echeances.declaration_locaux)],
    [`Contribution sur la valeur ajoutée (${BASE_CVA_FR[c.cva.base] || c.cva.base})`, c.hors_champ ? 0 : c.cva.cva, dj(c.echeances.paiement_cva)],
    ["TOTAL CEL", c.total_cel, ""],
  ];
  const ws = feuilleAvecLargeurs(aoa, [64, 18, 16]);
  formaterNombres(ws, [1], 4);
  XLSX.utils.book_append_sheet(wb, ws, "Récapitulatif");

  const l = [["Local", "Commune", "Nature", "Base brute", "% pro.", "Base retenue", "Taux %", "Prorata", "Contribution", "Observation"]];
  for (const x of c.locaux.lignes) {
    l.push([x.libelle, x.commune || "", NATURE_FR[x.nature] || x.nature, x.base_brute, x.part_professionnelle_pct ?? "", x.base, x.taux, x.prorata, x.contribution, x.motif ? MOTIF_FR[x.motif] || x.motif : ""]);
  }
  const wl = feuilleAvecLargeurs(l, [34, 18, 24, 16, 8, 16, 8, 9, 16, 36]);
  formaterNombres(wl, [3, 5, 8], 1);
  XLSX.utils.book_append_sheet(wb, wl, "Locaux");

  const k = c.cva;
  const v = [
    ["Valeur ajoutée de l'exercice " + (c.annee - 1), "Montant (XOF)"],
    ["Produits retenus", k.produits.total],
    ["Charges retenues", k.charges.total],
    ["Ajustement saisi", c.saisies.va_ajustement || 0],
    ["Valeur ajoutée", k.va_brute],
    ["Chiffre d'affaires", k.chiffre_affaires],
    [`Plafond (${fr(c.parametres.plafond_va_pct_ca)} % du CA)`, k.plafond_va],
    ["Valeur ajoutée retenue", k.va_retenue],
    [`CVA calculée (${fr(k.taux)} %)`, k.cva_calculee],
    [`Minimum de perception (${fr(k.taux_minimum)} % du CA)`, k.minimum],
    ["CVA due", c.hors_champ ? 0 : k.cva],
    [],
    ["Détail produits", "Montant"],
    ...k.produits.detail.filter((x) => x.montant !== 0).map((x) => [`Comptes ${x.prefixe}`, x.montant]),
    [],
    ["Détail charges", "Montant"],
    ...k.charges.detail.filter((x) => x.montant !== 0).map((x) => [`Comptes ${x.prefixe}`, x.montant]),
  ];
  const wv = feuilleAvecLargeurs(v, [56, 18]);
  formaterNombres(wv, [1], 1);
  XLSX.utils.book_append_sheet(wb, wv, "CVA");

  const a = [["Points d'attention"], ...c.avertissements.map((x) => [avert(x)])];
  XLSX.utils.book_append_sheet(wb, feuilleAvecLargeurs(a, [90]), "Avertissements");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function pdfBase(titrePrincipal, sousTitre, contribuable, brouillon) {
  const { doc, fini } = nouveauPdf({ margins: { top: 36, bottom: 30, left: 40, right: 40 } });
  const x0 = doc.page.margins.left;
  const largeur = doc.page.width - x0 - doc.page.margins.right;
  const etat = { y: 36 };
  function filigrane() {
    if (!brouillon) return;
    doc.save();
    doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font("Helvetica-Bold").fontSize(70).fillColor("#cfcfcf").opacity(0.3);
    doc.text("BROUILLON", 0, doc.page.height / 2 - 40, { width: doc.page.width, align: "center", lineBreak: false });
    doc.restore();
    doc.opacity(1);
  }
  function titre(t) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text(t, x0, etat.y, { width: largeur, lineBreak: false });
    etat.y += 15;
    doc.moveTo(x0, etat.y - 2).lineTo(x0 + largeur, etat.y - 2).lineWidth(0.5).stroke("#000");
  }
  function saut(h) {
    if (etat.y + h > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      filigrane();
      etat.y = doc.page.margins.top;
    }
  }
  filigrane();
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#000").text("RÉPUBLIQUE DU SÉNÉGAL", x0, etat.y, { lineBreak: false });
  doc.font("Helvetica").fontSize(8).text("Un Peuple - Un But - Une Foi", x0, etat.y + 11, { lineBreak: false });
  etat.y += 36;
  doc.font("Helvetica-Bold").fontSize(14).text(titrePrincipal, x0, etat.y, { width: largeur, align: "center", lineBreak: false });
  etat.y += 17;
  doc.font("Helvetica-Oblique").fontSize(8).fillColor("#555").text(sousTitre, x0, etat.y, { width: largeur, align: "center", lineBreak: false });
  etat.y += 18;
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#000").text("Contribuable", x0, etat.y, { width: 80, lineBreak: false });
  doc.font("Helvetica").text(tronquer(doc, contribuable.raison_sociale || "—", 220), x0 + 80, etat.y, { width: 220, lineBreak: false });
  doc.font("Helvetica-Bold").text("NINEA", x0 + 320, etat.y, { width: 50, lineBreak: false });
  doc.font("Helvetica").text(contribuable.ninea || "—", x0 + 370, etat.y, { width: 140, lineBreak: false });
  etat.y += 20;
  return { doc, fini, x0, largeur, etat, titre, saut };
}

function ligneMontant(p, libelle, montant, { fort = false, ref = "" } = {}) {
  const { doc, x0, largeur, etat, saut } = p;
  saut(14);
  doc.font(fort ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor("#000").text(tronquer(doc, libelle, 330), x0, etat.y, { width: 335, lineBreak: false });
  if (ref) doc.font("Helvetica").fontSize(7).fillColor("#666").text(tronquer(doc, ref, 80), x0 + 340, etat.y + 1, { width: 80, lineBreak: false });
  doc.font(fort ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor("#000").text(fmt(montant, { zero: true }), x0 + 420, etat.y, { width: largeur - 420, align: "right", lineBreak: false });
  etat.y += 14;
}

function pied(p, texte, avertissements) {
  const { doc, x0, largeur, etat, saut } = p;
  if (avertissements && avertissements.length > 0) {
    saut(30);
    doc.font("Helvetica-Oblique").fontSize(7).fillColor("#555").text(`Points d'attention : ${avertissements.map(avert).join(" ; ")}.`, x0, etat.y, { width: largeur });
  }
  doc.font("Helvetica-Oblique").fontSize(7).fillColor("#555").text(texte, x0, doc.page.height - 46, { width: largeur, lineBreak: false });
  doc.end();
}

function celPdf(calcul, contribuable, dossier) {
  const c = calcul;
  const brouillon = !dossier || dossier.statut === "BROUILLON" || dossier.statut === "PREPAREE";
  const p = pdfBase(`CONTRIBUTION ÉCONOMIQUE LOCALE ${c.annee}`, "Aide à la déclaration — locaux professionnels (31 janvier) et valeur ajoutée (30 avril)", contribuable, brouillon);
  const { doc, x0, largeur, etat, titre, saut } = p;

  titre("1. Récapitulatif");
  ligneMontant(p, "Contribution sur les locaux professionnels", c.locaux.total, { ref: `avant le ${dj(c.echeances.declaration_locaux)}` });
  ligneMontant(p, `Contribution sur la valeur ajoutée — ${BASE_CVA_FR[c.cva.base] || c.cva.base}`, c.hors_champ ? 0 : c.cva.cva, { ref: `paiement ${dj(c.echeances.paiement_cva)}` });
  ligneMontant(p, "TOTAL CEL", c.total_cel, { fort: true });
  etat.y += 6;

  titre("2. Locaux professionnels");
  if (c.locaux.lignes.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#555").text("Aucun local saisi.", x0, etat.y, { lineBreak: false });
    etat.y += 14;
  }
  for (const x of c.locaux.lignes) {
    saut(24);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000").text(tronquer(doc, `${x.libelle}${x.commune ? ` — ${x.commune}` : ""}`, 300), x0, etat.y, { width: 305, lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor("#444").text(NATURE_FR[x.nature] || x.nature, x0 + 310, etat.y + 1, { width: 120, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000").text(fmt(x.contribution, { zero: true }), x0 + 420, etat.y, { width: largeur - 420, align: "right", lineBreak: false });
    etat.y += 11;
    const detail = x.motif ? MOTIF_FR[x.motif] || x.motif : `base ${fmt(x.base)} × ${fr(x.taux)} %${x.prorata < 1 ? ` × prorata ${fr(x.prorata)}` : ""}`;
    doc.font("Helvetica").fontSize(7).fillColor("#666").text(detail, x0 + 10, etat.y, { width: largeur - 10, lineBreak: false });
    etat.y += 12;
  }
  etat.y += 6;

  const k = c.cva;
  titre(`3. Contribution sur la valeur ajoutée (exercice ${c.annee - 1})`);
  ligneMontant(p, "Produits retenus", k.produits.total);
  ligneMontant(p, "Charges retenues", k.charges.total);
  if (c.saisies.va_ajustement) ligneMontant(p, "Ajustement saisi", c.saisies.va_ajustement);
  ligneMontant(p, "Valeur ajoutée", k.va_brute, { fort: true, ref: "art. 336" });
  ligneMontant(p, "Chiffre d'affaires", k.chiffre_affaires);
  ligneMontant(p, `Plafond (${fr(c.parametres.plafond_va_pct_ca)} % du chiffre d'affaires)`, k.plafond_va);
  ligneMontant(p, "Valeur ajoutée retenue", k.va_retenue, { fort: true });
  ligneMontant(p, `CVA calculée (${fr(k.taux)} %)`, k.cva_calculee, { ref: "art. 337" });
  ligneMontant(p, `Minimum de perception (${fr(k.taux_minimum)} % du CA)`, k.minimum);
  ligneMontant(p, "CVA due", c.hors_champ ? 0 : k.cva, { fort: true });
  etat.y += 4;
  pied(p, "Document d'aide établi par Baobab Marchés : à contrôler et valider par le comptable avant tout dépôt. Taux et seuils : CGI 2025.", c.avertissements);
  return p.fini;
}

// ---------------------------------------------------------------------------
// Taxe sur les voitures particulieres
// ---------------------------------------------------------------------------

function vehXlsx(calcul, contribuable, dossier) {
  const c = calcul;
  const wb = XLSX.utils.book_new();
  const statut = dossier ? dossier.statut : "BROUILLON";
  const aoa = [
    [contribuable.raison_sociale],
    [`Taxe spéciale sur les voitures particulières des personnes morales ${c.annee} — ${statut}`],
    [],
    ["Trimestre", "Période", "Montant (XOF)"],
    ...c.trimestres.map((t) => [`T${t.trimestre}`, `${dj(t.debut)} au ${dj(t.fin)}`, t.montant]),
    ["TOTAL", "", c.total],
    [],
    ["À déclarer et payer avant le", dj(c.echeance)],
  ];
  const ws = feuilleAvecLargeurs(aoa, [32, 30, 18]);
  formaterNombres(ws, [2], 3);
  XLSX.utils.book_append_sheet(wb, ws, "Taxe");

  const l = [["Immatriculation", "Marque / modèle", "CV", "Détention", "Catégorie tarifaire", "T1", "T2", "T3", "T4", "Taxe", "Observation"]];
  for (const x of c.vehicules) {
    const tr = [1, 2, 3, 4].map((n) => {
      const t = (x.trimestres || []).find((y) => y.trimestre === n);
      return t ? t.montant : "";
    });
    l.push([x.immatriculation, x.marque_modele || "", x.puissance_cv ?? "", x.mode_detention, x.classe ? CLASSE_FR[x.classe] : "", ...tr, x.taxe === null ? "(par catégorie)" : x.taxe, x.motif ? MOTIF_FR[x.motif] || x.motif : ""]);
  }
  const wl = feuilleAvecLargeurs(l, [16, 26, 6, 12, 18, 12, 12, 12, 12, 16, 36]);
  formaterNombres(wl, [5, 6, 7, 8, 9], 1);
  XLSX.utils.book_append_sheet(wb, wl, "Véhicules");

  if (c.locations.length > 0) {
    const loc = [["Trimestre", "Catégorie", "Jours de location", "Périodes de 90 j", "Montant"]];
    for (const x of c.locations) loc.push([`T${x.trimestre}`, CLASSE_FR[x.classe] || x.classe, x.jours, x.periodes, x.montant]);
    const wloc = feuilleAvecLargeurs(loc, [12, 20, 18, 16, 16]);
    formaterNombres(wloc, [4], 1);
    XLSX.utils.book_append_sheet(wb, wloc, "Locations");
  }
  const a = [["Points d'attention"], ...c.avertissements.map((x) => [avert(x)])];
  XLSX.utils.book_append_sheet(wb, feuilleAvecLargeurs(a, [90]), "Avertissements");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function vehPdf(calcul, contribuable, dossier) {
  const c = calcul;
  const brouillon = !dossier || dossier.statut === "BROUILLON" || dossier.statut === "PREPAREE";
  const p = pdfBase(`TAXE SUR LES VOITURES PARTICULIÈRES ${c.annee}`, "Aide à la déclaration — personnes morales (art. 550 à 554 CGI) — à déposer avant le 1er février", contribuable, brouillon);
  const { doc, x0, largeur, etat, titre, saut } = p;

  titre("1. Liquidation par trimestre");
  for (const t of c.trimestres) ligneMontant(p, `Trimestre ${t.trimestre} (${dj(t.debut)} au ${dj(t.fin)})`, t.montant);
  ligneMontant(p, `TOTAL À PAYER avant le ${dj(c.echeance)}`, c.total, { fort: true });
  etat.y += 6;

  titre("2. Véhicules");
  if (c.vehicules.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#555").text("Aucun véhicule saisi.", x0, etat.y, { lineBreak: false });
    etat.y += 14;
  }
  for (const x of c.vehicules) {
    saut(14);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000").text(tronquer(doc, x.immatriculation, 80), x0, etat.y, { width: 85, lineBreak: false });
    doc.font("Helvetica").text(tronquer(doc, x.marque_modele || "", 120), x0 + 90, etat.y, { width: 120, lineBreak: false });
    doc.text(x.puissance_cv !== null && x.puissance_cv !== undefined ? `${x.puissance_cv} CV` : "—", x0 + 215, etat.y, { width: 35, lineBreak: false });
    doc.text(tronquer(doc, x.motif ? MOTIF_FR[x.motif] || x.motif : x.classe ? CLASSE_FR[x.classe] : "", 150), x0 + 255, etat.y, { width: 150, lineBreak: false });
    doc.font("Helvetica-Bold").text(x.taxe === null ? "par catégorie" : fmt(x.taxe, { zero: true }), x0 + 420, etat.y, { width: largeur - 420, align: "right", lineBreak: false });
    etat.y += 12;
  }
  etat.y += 4;
  if (c.locations.length > 0) {
    saut(30);
    titre("3. Véhicules en location (liquidation par catégorie)");
    for (const x of c.locations) ligneMontant(p, `T${x.trimestre} — ${CLASSE_FR[x.classe] || x.classe} : ${x.jours} jours = ${x.periodes} période(s) de 90 jours`, x.montant);
  }
  pied(p, "Document d'aide établi par Baobab Marchés : à contrôler et valider par le comptable avant tout dépôt. La taxe n'est pas déductible du résultat.", c.avertissements);
  return p.fini;
}

module.exports = { celXlsx, celPdf, vehXlsx, vehPdf, pdfBase, ligneMontant };
