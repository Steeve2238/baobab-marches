/**
 * Registre des factures de vente emises (module Comptabilite) : liste filtrable
 * (periode, client, statut, recherche), totaux, exports Excel et PDF.
 *
 * Source unique : la table facture_vente (memes montants que sur la facture
 * imprimee). Une facture ANNULEE reste visible dans la liste mais n'entre dans
 * aucun total. Aucune ecriture, aucun effet de bord : lecture seule.
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

const STATUTS = ["IMPAYEE", "PAYEE", "ANNULEE", "EN_RETARD"];
const LIBELLE_STATUT = { IMPAYEE: "Impayée", PAYEE: "Payée", ANNULEE: "Annulée" };
const LIBELLE_TYPE = { INTEGRALE: "Intégrale", ACOMPTE: "Acompte", SOLDE: "Solde" };

const estDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const num = (v) => Number(v || 0);
const arrondi = (v) => Math.round(v * 100) / 100;

/** Numero tel qu'imprime : "2026-08-096" (annee-mois-sequence), numero manuel tel quel. */
function numeroAffiche(numero, mois) {
  if (!/^\d{4}-\d+$/.test(numero)) return numero;
  const [annee, sequence] = numero.split("-");
  return `${annee}-${String(mois).padStart(2, "0")}-${sequence}`;
}

function typeAffiche(l) {
  const base = LIBELLE_TYPE[l.type_facturation] || l.type_facturation;
  return l.type_facturation === "ACOMPTE" && l.pourcentage_acompte ? `${base} ${num(l.pourcentage_acompte)} %` : base;
}

/**
 * Liste des factures emises.
 * opts : { debut, fin, client_id, statut, recherche } (tout est facultatif).
 */
async function lister(db, tenantId, opts = {}) {
  const params = [tenantId];
  let filtre = "";
  if (estDate(opts.debut)) {
    params.push(opts.debut);
    filtre += ` AND f.date_facture >= $${params.length}`;
  }
  if (estDate(opts.fin)) {
    params.push(opts.fin);
    filtre += ` AND f.date_facture <= $${params.length}`;
  }
  if (opts.client_id && /^[0-9a-f-]{36}$/i.test(opts.client_id)) {
    params.push(opts.client_id);
    filtre += ` AND f.client_commercial_id = $${params.length}`;
  }
  const statut = STATUTS.includes(opts.statut) ? opts.statut : null;
  if (statut === "EN_RETARD") {
    filtre += ` AND f.statut = 'IMPAYEE' AND f.date_echeance IS NOT NULL AND f.date_echeance < CURRENT_DATE`;
  } else if (statut) {
    params.push(statut);
    filtre += ` AND f.statut = $${params.length}`;
  }
  const recherche = String(opts.recherche || "").trim();
  if (recherche) {
    params.push(`%${recherche}%`);
    filtre += ` AND (f.numero ILIKE $${params.length} OR cl.nom ILIKE $${params.length} OR COALESCE(f.reference_bc_client, '') ILIKE $${params.length})`;
  }

  const r = await db.query(
    `SELECT f.id, f.numero, f.mois_emission, f.date_facture, f.date_echeance, f.statut,
            f.type_facturation, f.pourcentage_acompte, f.reference_bc_client,
            f.taux_tva_pourcentage, f.total_ht, f.montant_tva, f.total_ttc,
            f.montant_net_a_payer, f.montant_encaisse, f.mode_paiement, f.date_paiement,
            cl.id AS client_id, cl.nom AS client_nom,
            (f.statut = 'IMPAYEE' AND f.date_echeance IS NOT NULL AND f.date_echeance < CURRENT_DATE) AS en_retard,
            (SELECT e.statut FROM ecriture_comptable e
              WHERE e.tenant_id = f.tenant_id AND e.origine = 'FACTURE_VENTE' AND e.origine_id = f.id AND e.origine_role = 'FACTURE'
              ORDER BY e.date_creation DESC LIMIT 1) AS ecriture_statut
     FROM facture_vente f
     JOIN client_commercial cl ON cl.id = f.client_commercial_id
     WHERE f.tenant_id = $1 ${filtre}
     ORDER BY f.date_facture DESC, f.date_creation DESC`,
    params
  );

  const totaux = { nombre: 0, nombre_annulees: 0, total_ht: 0, montant_tva: 0, total_ttc: 0, net_a_payer: 0, encaisse: 0, reste_du: 0, echu: 0 };
  const lignes = r.rows.map((f) => {
    const net = num(f.montant_net_a_payer);
    const annulee = f.statut === "ANNULEE";
    const payee = f.statut === "PAYEE";
    const encaisse = annulee ? 0 : payee ? Math.max(num(f.montant_encaisse), net) : num(f.montant_encaisse);
    const reste = annulee || payee ? 0 : Math.max(arrondi(net - encaisse), 0);
    const ligne = {
      id: f.id,
      numero: f.numero,
      numero_affiche: numeroAffiche(f.numero, f.mois_emission),
      date_facture: f.date_facture,
      date_echeance: f.date_echeance,
      client_id: f.client_id,
      client_nom: f.client_nom,
      reference_bc_client: f.reference_bc_client,
      type_facturation: f.type_facturation,
      type_libelle: typeAffiche(f),
      pourcentage_acompte: f.pourcentage_acompte === null ? null : num(f.pourcentage_acompte),
      statut: f.statut,
      en_retard: Boolean(f.en_retard),
      mode_paiement: f.mode_paiement,
      date_paiement: f.date_paiement,
      taux_tva_pourcentage: num(f.taux_tva_pourcentage),
      total_ht: num(f.total_ht),
      montant_tva: num(f.montant_tva),
      total_ttc: num(f.total_ttc),
      net_a_payer: net,
      encaisse,
      reste_du: reste,
      comptabilisee: Boolean(f.ecriture_statut),
      ecriture_statut: f.ecriture_statut || null,
    };
    if (annulee) {
      totaux.nombre_annulees += 1;
    } else {
      totaux.nombre += 1;
      totaux.total_ht += ligne.total_ht;
      totaux.montant_tva += ligne.montant_tva;
      totaux.total_ttc += ligne.total_ttc;
      totaux.net_a_payer += net;
      totaux.encaisse += encaisse;
      totaux.reste_du += reste;
      if (ligne.en_retard) totaux.echu += reste;
    }
    return ligne;
  });
  for (const k of Object.keys(totaux)) if (k !== "nombre" && k !== "nombre_annulees") totaux[k] = arrondi(totaux[k]);

  return {
    periode: { debut: estDate(opts.debut) ? opts.debut : null, fin: estDate(opts.fin) ? opts.fin : null },
    filtres: { client_id: opts.client_id || null, statut, recherche: recherche || null },
    lignes,
    totaux,
  };
}

const libelleStatut = (l) => (l.en_retard ? "En retard" : LIBELLE_STATUT[l.statut] || l.statut);

function periodeTexte(data) {
  const { debut, fin } = data.periode;
  if (debut && fin) return `du ${dateJJMMAAbarre(debut)} au ${dateJJMMAAbarre(fin)}`;
  if (debut) return `à partir du ${dateJJMMAAbarre(debut)}`;
  if (fin) return `jusqu'au ${dateJJMMAAbarre(fin)}`;
  return "toutes périodes";
}

// ---- Excel -----------------------------------------------------------------

function facturesEmisesXlsx(data, entreprise) {
  const aoa = [];
  aoa.push([entreprise]);
  aoa.push([`Factures émises — ${periodeTexte(data)}`]);
  aoa.push([]);
  aoa.push(["N° facture", "Date", "Client", "Réf. BC client", "Type", "Total HT", "TVA", "Total TTC", "Net à payer", "Encaissé", "Reste dû", "Échéance", "Statut", "Comptabilisée"]);
  const debutDonnees = aoa.length;
  const d = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) : null);
  for (const l of data.lignes) {
    aoa.push([
      l.numero_affiche,
      d(l.date_facture),
      l.client_nom,
      l.reference_bc_client || null,
      l.type_libelle,
      l.total_ht,
      l.montant_tva,
      l.total_ttc,
      l.net_a_payer,
      l.encaisse,
      l.reste_du,
      d(l.date_echeance),
      libelleStatut(l),
      l.statut === "ANNULEE" ? null : l.comptabilisee ? (l.ecriture_statut === "VALIDEE" ? "Oui (validée)" : "Oui (en instance)") : "Non",
    ]);
  }
  const t = data.totaux;
  aoa.push([]);
  aoa.push([`TOTAL (${t.nombre} facture${t.nombre > 1 ? "s" : ""}, hors annulées)`, null, null, null, null, t.total_ht, t.montant_tva, t.total_ttc, t.net_a_payer, t.encaisse, t.reste_du]);
  if (t.echu > 0) aoa.push(["dont échu (en retard)", null, null, null, null, null, null, null, null, null, t.echu]);
  const ws = feuilleAvecLargeurs(aoa, [16, 11, 36, 18, 14, 15, 14, 15, 15, 15, 15, 11, 12, 18]);
  formaterNombres(ws, [5, 6, 7, 8, 9, 10], debutDonnees);
  const plage = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = debutDonnees; r <= plage.e.r; r++) {
    for (const c of [1, 11]) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "d") cell.z = "dd/mm/yyyy";
    }
  }
  ws["!freeze"] = { xSplit: 0, ySplit: 4 };
  ws["!autofilter"] = { ref: `A4:N${4 + data.lignes.length}` };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Factures émises");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true });
}

// ---- PDF -------------------------------------------------------------------

async function facturesEmisesPdf(data, entreprise) {
  const { doc, fini } = nouveauPdf({ layout: "landscape" });
  const tirage = maintenantTirage();
  const { left, right } = doc.page.margins;
  const largeur = doc.page.width - left - right;
  const cols = [
    ["num", "N° facture", 66, "left"],
    ["date", "Date", 48, "left"],
    ["client", "Client", 150, "left"],
    ["type", "Type", 72, "left"],
    ["ht", "Total HT", 66, "right"],
    ["tva", "TVA", 56, "right"],
    ["ttc", "Total TTC", 66, "right"],
    ["net", "Net à payer", 66, "right"],
    ["enc", "Encaissé", 66, "right"],
    ["reste", "Reste dû", 66, "right"],
    ["statut", "Statut", 60, "left"],
  ];
  const xs = {};
  let x = left;
  for (const [k, , w] of cols) {
    xs[k] = x;
    x += w;
  }
  const larg = Object.fromEntries(cols.map(([k, , w]) => [k, w]));
  const hauteurLigne = 11;
  const bas = doc.page.height - 34;
  const periode = { debut: data.periode.debut || data.lignes.reduce((m, l) => (!m || l.date_facture < m ? l.date_facture : m), null) || new Date().toISOString().slice(0, 10), fin: data.periode.fin || new Date().toISOString().slice(0, 10) };
  let page = 0;
  let y = 0;

  function nouvellePage(premiere = false) {
    if (!premiere) doc.addPage({ size: "A4", layout: "landscape", margins: doc.page.margins });
    page += 1;
    y = cadreEntete(doc, { entreprise, titre: "FACTURES ÉMISES", sousTitre: "Registre des factures de vente", periode, deviseLibelle: "Franc CFA (XOF)", numeroPage: page, tirage });
    doc.save();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
    for (const [k, lib, , al] of cols) doc.text(lib, xs[k] + (al === "right" ? 0 : 2), y, { width: larg[k] - 4, align: al, lineBreak: false });
    doc.moveTo(left - 4, y + 11).lineTo(left + largeur + 4, y + 11).lineWidth(0.5).stroke("#000");
    doc.restore();
    y += 16;
  }

  nouvellePage(true);
  for (const l of data.lignes) {
    if (y + hauteurLigne > bas) nouvellePage();
    const annulee = l.statut === "ANNULEE";
    doc.font("Helvetica").fontSize(7.5).fillColor(annulee ? "#888888" : l.en_retard ? "#a33a2a" : "#000");
    const t = (k, texte, al = "left") => doc.text(texte, xs[k] + (al === "right" ? 0 : 2), y, { width: larg[k] - 4, align: al, lineBreak: false });
    t("num", l.numero_affiche);
    t("date", dateJJMMAAbarre(l.date_facture));
    t("client", tronquer(doc, l.client_nom, larg.client - 6));
    t("type", tronquer(doc, l.type_libelle, larg.type - 4));
    t("ht", fmt(l.total_ht, { zero: true }), "right");
    t("tva", fmt(l.montant_tva, { zero: true }), "right");
    t("ttc", fmt(l.total_ttc, { zero: true }), "right");
    t("net", fmt(l.net_a_payer, { zero: true }), "right");
    t("enc", fmt(l.encaisse), "right");
    t("reste", fmt(l.reste_du), "right");
    t("statut", libelleStatut(l));
    y += hauteurLigne;
  }
  if (data.lignes.length === 0) {
    doc.font("Helvetica").fontSize(8).fillColor("#000").text("Aucune facture sur cette sélection.", left + 2, y, { lineBreak: false });
    y += hauteurLigne;
  }

  if (y + 40 > bas) nouvellePage();
  const tt = data.totaux;
  y += 4;
  doc.save();
  doc.moveTo(left - 4, y - 2).lineTo(left + largeur + 4, y - 2).lineWidth(0.5).stroke("#000");
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000");
  doc.text(`TOTAL — ${tt.nombre} facture${tt.nombre > 1 ? "s" : ""} (hors annulées${tt.nombre_annulees ? `, ${tt.nombre_annulees} annulée${tt.nombre_annulees > 1 ? "s" : ""} exclue${tt.nombre_annulees > 1 ? "s" : ""}` : ""})`, xs.num + 2, y + 1, { width: larg.num + larg.date + larg.client + larg.type - 4, lineBreak: false });
  const tot = (k, v) => doc.text(fmt(v, { zero: true }), xs[k], y + 1, { width: larg[k] - 4, align: "right", lineBreak: false });
  tot("ht", tt.total_ht);
  tot("tva", tt.montant_tva);
  tot("ttc", tt.total_ttc);
  tot("net", tt.net_a_payer);
  tot("enc", tt.encaisse);
  tot("reste", tt.reste_du);
  if (tt.echu > 0) {
    y += hauteurLigne;
    doc.font("Helvetica").fillColor("#a33a2a").text(`dont échu (en retard) : ${fmt(tt.echu, { zero: true })}`, xs.reste - 120, y + 1, { width: larg.reste + 116, align: "right", lineBreak: false });
  }
  doc.restore();
  doc.end();
  return fini;
}

module.exports = { lister, facturesEmisesXlsx, facturesEmisesPdf, STATUTS };
