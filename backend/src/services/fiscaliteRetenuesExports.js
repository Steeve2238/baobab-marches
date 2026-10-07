/**
 * Exports du lot 4 (module Fiscalite) : etat mensuel de versement des retenues a la source et etat trimestriel des versements
 * a des personnes physiques (art. 200-8). Excel + PDF, filigrane BROUILLON tant que la declaration n'est pas deposee.
 */
const XLSX = require("xlsx");
const { fmt, tronquer, dateJJMMAAbarre, feuilleAvecLargeurs, formaterNombres } = require("./comptaExports");
const { pdfBase, ligneMontant } = require("./fiscaliteLot5Exports");

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const TYPE_FR = {
  PRESTATION_PP: "Prestataires personnes physiques",
  LOYER: "Loyers",
  NON_RESIDENT: "Non-résidents",
  IRVM_DIVIDENDES: "Dividendes",
  IRVM_CREANCES: "Créances, intérêts, comptes courants",
  IRVM_OBLIGATIONS: "Obligations",
  IRVM_OBLIGATIONS_LONGUES: "Obligations (5 ans et plus)",
};
const STATUT_BENEF_FR = { PP_SANS_REEL: "Personne physique", PP_REEL: "Personne physique au réel", SOCIETE_IS: "Société à l'IS", NON_RESIDENT: "Non-résident", AUTRE: "Autre" };
const AVERT_FR = {
  TAUX_MODIFIE: "taux différent du taux légal",
  IDENTITE_ABSENTE: "NINEA ou pièce d'identité absents",
  LOYER_MENSUEL_ABSENT: "loyer mensuel non renseigné",
  CONVENTION_A_VERIFIER: "convention internationale à vérifier",
  IRVM_EXONERATIONS_A_VERIFIER: "exonérations et taux réduits à vérifier",
  ECART_RETENUE_EFFECTUEE: "écart avec la retenue effectuée",
  RETENUE_SANS_OBLIGATION: "retenue effectuée alors qu'aucune retenue n'est due",
  MOTIF_SOUS_SEUIL: "opérations sous le seuil de retenue",
  MOTIF_BENEFICIAIRE_HORS_CHAMP: "bénéficiaires hors champ (régime réel, société à l'IS)",
  MOTIF_BAILLEUR_IS: "bailleurs personnes morales à l'IS",
};
const SITUATION_FR = {
  COMPLETE: "comptabilité cohérente (retenue conforme)",
  RETENUE_NON_COMPTABILISEE: "retenue non comptabilisée",
  ECART_447: "écart avec la retenue comptabilisée",
  SANS_CHARGE: "retenue comptabilisée sans charge analysée (brut déduit)",
};
const MODE_FR = {
  MENSUEL: "Versement mensuel : avant le 15 du mois suivant (art. 185).",
  TRIMESTRIEL_REGIME: "Régime réel simplifié ou CGU : versement trimestriel dans les 15 premiers jours de janvier, avril, juillet et octobre (art. 185).",
  TRIMESTRIEL_OPTION: "Retenues du mois de 20 000 F ou moins : versement possible par trimestre (art. 185) ; tout le trimestre est dû dès qu'un mois dépasse 20 000 F.",
};
const dj = (d) => (d ? dateJJMMAAbarre(d) : "");
const fr = (v) => String(v).replace(".", ",");
const avert = (a) => `${AVERT_FR[a.code] || a.code}${a.nombre > 1 ? ` (${a.nombre})` : ""}`;
const brouillon = (dossier) => !dossier || dossier.statut === "BROUILLON" || dossier.statut === "PREPAREE";

function libelleMois(annee, mois) {
  return `${MOIS_FR[mois - 1]} ${annee}`;
}

// ---------------------------------------------------------------------------
// Etat mensuel
// ---------------------------------------------------------------------------

function mensuelXlsx(vue, contribuable) {
  const wb = XLSX.utils.book_new();
  const s = vue.synthese;
  const aoa = [
    [contribuable.raison_sociale],
    [`Retenues à la source — ${libelleMois(vue.annee, vue.mois)} — ${vue.dossier.statut}`],
    [`NINEA : ${contribuable.ninea || "—"}`],
    [],
    ["Nature de la retenue", "Article", "Taux %", "Opérations", "Soumises", "Montant brut", "Base de calcul", "Retenue (XOF)"],
    ...s.par_type.map((t) => [TYPE_FR[t.type] || t.type, t.article, t.taux, t.nombre, t.nombre_soumises, t.montant_brut, t.base, t.retenue]),
    ["TOTAL À VERSER", "", "", s.nb_confirmees, s.nb_soumises, "", "", s.total_retenues],
    [],
    ["Échéance de versement", dj(vue.versement.echeance_mensuelle)],
    [MODE_FR[vue.versement.mode] || ""],
  ];
  const ws = feuilleAvecLargeurs(aoa, [40, 10, 8, 12, 10, 16, 16, 16]);
  formaterNombres(ws, [5, 6, 7], 5);
  XLSX.utils.book_append_sheet(wb, ws, "Récapitulatif");

  const o = [["Date", "Type", "Bénéficiaire", "NINEA", "Statut", "Référence", "Montant brut HT", "Base", "Taux %", "Retenue", "Retenue effectuée", "Observation"]];
  for (const x of vue.operations.filter((y) => y.statut === "CONFIRMEE")) {
    const c = x.calcul;
    const k = x.controle;
    const avertsTxt = c.due ? c.warnings.filter((w) => !(k && w === "ECART_RETENUE_EFFECTUEE")).map((w) => AVERT_FR[w] || w) : [`non soumise — ${c.motifs.map((m) => AVERT_FR[`MOTIF_${m}`] || m).join(", ")}`];
    const obs = [...(k && k.situation ? [SITUATION_FR[k.situation] || k.situation] : []), ...avertsTxt].join(" ; ");
    o.push([dj(x.date_operation), TYPE_FR[x.type] || x.type, x.beneficiaire_nom, x.beneficiaire_ninea || "", STATUT_BENEF_FR[x.beneficiaire_statut] || "", x.reference || "", x.montant_brut, c.base, c.taux, c.retenue, c.retenue_effectuee === null ? "" : c.retenue_effectuee, obs]);
  }
  const wo = feuilleAvecLargeurs(o, [12, 32, 30, 14, 22, 18, 16, 16, 8, 14, 16, 50]);
  formaterNombres(wo, [6, 7, 9, 10], 1);
  XLSX.utils.book_append_sheet(wb, wo, "Opérations");

  const b = [["Bénéficiaire", "NINEA", "Nature", "Opérations", "Montant brut", "Retenue"]];
  for (const x of s.par_beneficiaire) b.push([x.nom, x.ninea || "", TYPE_FR[x.type] || x.type, x.nombre, x.montant_brut, x.retenue]);
  const wb2 = feuilleAvecLargeurs(b, [34, 16, 36, 11, 16, 14]);
  formaterNombres(wb2, [4, 5], 1);
  XLSX.utils.book_append_sheet(wb, wb2, "Bénéficiaires");

  const a = [["Points d'attention"], ...s.avertissements.map((x) => [avert(x)])];
  XLSX.utils.book_append_sheet(wb, feuilleAvecLargeurs(a, [90]), "Avertissements");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function mensuelPdf(vue, contribuable) {
  const s = vue.synthese;
  const p = pdfBase(`RETENUES À LA SOURCE — ${libelleMois(vue.annee, vue.mois).toUpperCase()}`, "État de versement — à joindre au versement (art. 185 et 186 du CGI)", contribuable, brouillon(vue.dossier));
  const { doc, x0, largeur, etat, titre, saut } = p;

  titre("1. Récapitulatif par nature de retenue");
  if (s.par_type.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#555").text("Aucune retenue confirmée sur la période.", x0, etat.y, { lineBreak: false });
    etat.y += 14;
  }
  for (const t of s.par_type) ligneMontant(p, `${TYPE_FR[t.type] || t.type} — ${fr(t.taux)} % (${t.nombre_soumises} opération${t.nombre_soumises > 1 ? "s" : ""} soumise${t.nombre_soumises > 1 ? "s" : ""})`, t.retenue, { ref: t.article });
  ligneMontant(p, "TOTAL DES RETENUES À VERSER", s.total_retenues, { fort: true });
  etat.y += 4;
  doc.font("Helvetica").fontSize(8).fillColor("#000").text(`Échéance : ${dj(vue.versement.echeance_mensuelle)} (versement mensuel). ${MODE_FR[vue.versement.mode] || ""}`, x0, etat.y, { width: largeur });
  etat.y += 26;

  titre("2. Détail par bénéficiaire");
  saut(14);
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#333");
  doc.text("Bénéficiaire", x0, etat.y, { width: 165, lineBreak: false });
  doc.text("NINEA", x0 + 170, etat.y, { width: 70, lineBreak: false });
  doc.text("Nature", x0 + 245, etat.y, { width: 135, lineBreak: false });
  doc.text("Brut HT", x0 + 380, etat.y, { width: 65, align: "right", lineBreak: false });
  doc.text("Retenue", x0 + 450, etat.y, { width: largeur - 450, align: "right", lineBreak: false });
  etat.y += 11;
  for (const b of s.par_beneficiaire) {
    saut(12);
    doc.font("Helvetica").fontSize(7.5).fillColor("#000");
    doc.text(tronquer(doc, b.nom, 163), x0, etat.y, { width: 165, lineBreak: false });
    doc.text(b.ninea || "—", x0 + 170, etat.y, { width: 70, lineBreak: false });
    doc.text(tronquer(doc, TYPE_FR[b.type] || b.type, 130), x0 + 245, etat.y, { width: 135, lineBreak: false });
    doc.text(fmt(b.montant_brut, { zero: true }), x0 + 380, etat.y, { width: 65, align: "right", lineBreak: false });
    doc.text(fmt(b.retenue, { zero: true }), x0 + 450, etat.y, { width: largeur - 450, align: "right", lineBreak: false });
    etat.y += 11;
  }
  etat.y += 8;

  saut(60);
  doc.font("Helvetica").fontSize(8).fillColor("#000").text("Déclaration datée et signée par la partie versante :", x0, etat.y, { lineBreak: false });
  etat.y += 12;
  doc.text("Date : ____ / ____ / ________          Nom, qualité et signature : ______________________________", x0, etat.y, { lineBreak: false });
  etat.y += 20;

  if (s.avertissements.length > 0) {
    saut(30);
    doc.font("Helvetica-Oblique").fontSize(7).fillColor("#555").text(`Points d'attention : ${s.avertissements.map(avert).join(" ; ")}.`, x0, etat.y, { width: largeur });
  }
  doc.font("Helvetica-Oblique").fontSize(7).fillColor("#555").text("Document d'aide établi par Baobab Marchés : à contrôler et valider par le comptable avant tout versement. Taux et seuils : CGI 2025.", x0, doc.page.height - 46, { width: largeur, lineBreak: false });
  doc.end();
  return p.fini;
}

// ---------------------------------------------------------------------------
// Etat trimestriel (art. 200-8)
// ---------------------------------------------------------------------------

function trimestrielXlsx(etat, contribuable) {
  const wb = XLSX.utils.book_new();
  const aoa = [
    [contribuable.raison_sociale],
    [`État trimestriel des versements à des personnes physiques — T${etat.trimestre} ${etat.annee} (art. 200-8)`],
    [`NINEA : ${contribuable.ninea || "—"}`],
    [],
    ["Prénoms et nom", "Emploi", "Adresse", "NINEA", "Pièce d'identité", "Nature", "Période", "Sommes versées (brut HT)", "Impôt retenu"],
    ...etat.lignes.map((l) => [l.nom, l.profession || "", l.adresse || "", l.ninea || "", l.piece || "", TYPE_FR[l.type] || l.type, `${dj(l.premiere)} - ${dj(l.derniere)}`, l.montant_brut, l.retenue]),
    ["TOTAL", "", "", "", "", "", "", etat.totaux.montant_brut, etat.totaux.retenue],
  ];
  const ws = feuilleAvecLargeurs(aoa, [30, 18, 28, 14, 24, 28, 24, 20, 16]);
  formaterNombres(ws, [7, 8], 5);
  XLSX.utils.book_append_sheet(wb, ws, `T${etat.trimestre} ${etat.annee}`);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function trimestrielPdf(etat, contribuable) {
  const p = pdfBase(`ÉTAT TRIMESTRIEL DES VERSEMENTS — T${etat.trimestre} ${etat.annee}`, "Sommes versées à des personnes physiques (art. 200-8 du CGI) — retenue à la source", contribuable, true);
  const { doc, x0, largeur, etat: pos, titre, saut } = p;
  titre(`Période du ${dj(etat.debut)} au ${dj(etat.fin)}`);
  if (etat.lignes.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#555").text("Aucun versement à des personnes physiques sur la période.", x0, pos.y, { lineBreak: false });
    pos.y += 14;
  }
  for (const l of etat.lignes) {
    saut(34);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000").text(tronquer(doc, l.nom, 250), x0, pos.y, { width: 255, lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor("#444").text(TYPE_FR[l.type] || l.type, x0 + 260, pos.y + 1, { width: 140, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000").text(fmt(l.retenue, { zero: true }), x0 + 420, pos.y, { width: largeur - 420, align: "right", lineBreak: false });
    pos.y += 11;
    const identite = l.ninea ? `NINEA ${l.ninea}` : l.piece ? `Pièce d'identité : ${l.piece}` : "identité à compléter (NINEA ou pièce d'identité)";
    doc.font("Helvetica").fontSize(7).fillColor(l.identite_incomplete ? "#a00" : "#666").text(tronquer(doc, `${l.profession ? `${l.profession} — ` : ""}${l.adresse || "adresse non renseignée"} — ${identite}`, largeur - 10), x0 + 10, pos.y, { width: largeur - 10, lineBreak: false });
    pos.y += 10;
    doc.font("Helvetica").fontSize(7).fillColor("#666").text(`${l.nombre} versement${l.nombre > 1 ? "s" : ""} du ${dj(l.premiere)} au ${dj(l.derniere)} — sommes versées (brut HT) : ${fmt(l.montant_brut, { zero: true })}`, x0 + 10, pos.y, { width: largeur - 10, lineBreak: false });
    pos.y += 13;
  }
  pos.y += 4;
  ligneMontant(p, "Total des sommes versées (brut HT)", etat.totaux.montant_brut);
  ligneMontant(p, "Total de l'impôt retenu à la source", etat.totaux.retenue, { fort: true });
  doc.font("Helvetica-Oblique").fontSize(7).fillColor("#555").text("Document d'aide établi par Baobab Marchés : à contrôler et valider par le comptable avant tout dépôt.", x0, doc.page.height - 46, { width: largeur, lineBreak: false });
  doc.end();
  return p.fini;
}

module.exports = { mensuelXlsx, mensuelPdf, trimestrielXlsx, trimestrielPdf };
