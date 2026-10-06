/**
 * Documents imprimables du financement d'un dossier (compte d'exploitation,
 * plan de tresorerie) en PDF et Excel, avec la meme presentation formelle que
 * les devis, factures et bons de livraison : en-tete de l'entreprise (logo,
 * adresse, contacts) en haut, bloc signature + cachet du signataire en bas,
 * pied de page (RCCM, NINEA...).
 */
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");
const db = require("../db");

const FR = {
  titreCompte: "COMPTE D'EXPLOITATION PRÉVISIONNEL",
  titrePlan: "PLAN DE TRÉSORERIE PRÉVISIONNEL",
  versionBanque: "Version destinée à la banque",
  versionInterne: "Version interne",
  dossier: "Dossier",
  reference: "Référence",
  client: "Client",
  devise: "Montants en F CFA, hors taxes",
  poste: "Poste",
  prev: "Prévisionnel",
  engage: "Engagé",
  reel: "Réel",
  ecart: "Écart",
  pctCa: "% du CA",
  pctRevient: "% revient",
  montant: "Montant",
  edite: "Édité le",
  page: "Page",
  signataire: "Le signataire",
  notes: "Notes",
  pageDemande: "PRÉSENTATION DE LA DEMANDE",
  demande: "La demande",
  facilite: "Type de facilité",
  banque: "Banque",
  montantDemande: "Montant demandé",
  datePrise: "Date de mise en place",
  dateEcheance: "Date d'échéance",
  duree: "Durée",
  jours: "jours",
  remboursement: "Remboursement",
  source: "Source de remboursement",
  sourceTexte: "Encaissement du marché auprès du client",
  debiteur: "Débiteur final",
  dateEncaissement: "Dernier encaissement attendu",
  couverture: "Couverture",
  margeCom: "Marge commerciale",
  coutFin: "Coût du financement",
  coutFinPct: "Coût du financement en % du chiffre d'affaires",
  tauxAnnuel: "Taux annualisé équivalent",
  couvre: "La marge commerciale couvre le coût du financement",
  fois: "fois",
  besoin: "Besoin de trésorerie",
  besoinMax: "Besoin de financement maximal",
  dateBesoin: "Atteint le",
  portage: "Durée d'avance de trésorerie",
  pointBas: "Point bas avec la ligne",
  apport: "Trésorerie propre affectée",
  garanties: "Garanties et conditions",
  domiciliation: "Domiciliation des règlements du client exigée",
  oui: "Oui",
  aucune: "Aucune condition particulière renseignée",
  planBase: "Base des montants",
  planTtc: "TTC (droits, taxes de douane et TVA à l'importation compris)",
  planHt: "Hors taxes",
  planHorsDouane: "hors taxes, hors douane",
  dateT: "Date d'engagement (T)",
  horizon: "Horizon du plan",
  cles: "Chiffres clés",
  commentaire: "Lecture du plan",
  alertes: "Points d'attention",
  periode: "Période",
  encaissements: "Encaissements",
  decaissements: "Décaissements",
  ligneFin: "Ligne",
  soldeSans: "Solde fin de période (sans ligne)",
  soldeAvec: "Solde fin de période (avec ligne)",
  pointBasPeriode: "Point bas (sans ligne)",
  courbe: "Trésorerie cumulée dans le temps",
  sansFin: "Sans financement",
  avecFin: "Avec la ligne",
  flux: "Détail des flux",
  date: "Date",
  libelle: "Flux",
  entree: "Entrée",
  sortie: "Sortie",
  soldeFinalSans: "Solde final sans financement",
  soldeFinalAvec: "Solde final avec la ligne",
  incomplet: "Le plan ne peut pas être calculé : des informations manquent.",
  faitA: "Fait le",
};

const TYPES_FACILITE = {
  AFFACTURAGE: "Affacturage",
  ESCOMPTE: "Escompte d'effets",
  CREDIT_TRESORERIE: "Crédit de trésorerie",
  CREDIT_RELAIS: "Crédit relais",
  AVANCE_MARCHE: "Avance sur marché",
  LC_INTERNATIONAL: "Lettre de crédit (import)",
  AVAL_TRAITE: "Aval de traite",
  CAUTION_SOUMISSION: "Caution de soumission",
  CAUTION_BONNE_EXECUTION: "Caution de bonne exécution",
  CAUTION_AVANCE_DEMARRAGE: "Caution d'avance de démarrage",
  CAUTION_RETENUE_GARANTIE: "Caution de retenue de garantie",
  ASSURANCE_CREDIT: "Assurance-crédit",
};
const nf = (n, { zero = true } = {}) => {
  if (n === null || n === undefined || n === "") return "";
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  if (v === 0 && !zero) return "";
  const r = Math.round(v);
  return (r < 0 ? "-" : "") + String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};
const pc = (n) => (n === null || n === undefined ? "" : `${String(Math.round(Number(n) * 10) / 10).replace(".", ",")} %`);
const ddmmyyyy = (iso) => {
  if (!iso) return "";
  const [a, m, j] = String(iso).slice(0, 10).split("-");
  return `${j}/${m}/${a}`;
};
const aujourdhui = () => ddmmyyyy(new Date().toISOString().slice(0, 10));

async function chargerEntete(tenantId) {
  const r = await db.query(
    `SELECT raison_sociale, adresse, telephone, email, signataire_nom, signataire_titre, rccm, ninea, site_web, coordonnees_bancaires,
            logo_base64, logo_type_mime, signature_cachet_base64, signature_cachet_type_mime
     FROM tenant WHERE id = $1`,
    [tenantId]
  );
  return r.rows[0] || {};
}

const piedLignes = (e) => [e.rccm ? `RCCM ${e.rccm}` : null, e.ninea ? `NINEA ${e.ninea}` : null, e.site_web || null, e.coordonnees_bancaires || null].filter(Boolean);
const imageBuffer = (b64) => {
  try {
    return b64 ? Buffer.from(b64, "base64") : null;
  } catch (e) {
    return null;
  }
};

// --------------------------------------------------------------------------- PDF
class Pdf {
  constructor(entete, { titre, sousTitre, versionLibelle }) {
    this.e = entete;
    this.titre = titre;
    this.sousTitre = sousTitre;
    this.versionLibelle = versionLibelle;
    this.doc = new PDFDocument({ size: "A4", margins: { top: 30, bottom: 46, left: 36, right: 36 }, bufferPages: true });
    const morceaux = [];
    this.doc.on("data", (m) => morceaux.push(m));
    this.fini = new Promise((resolve, reject) => {
      this.doc.on("end", () => resolve(Buffer.concat(morceaux)));
      this.doc.on("error", reject);
    });
    this.gauche = 36;
    this.largeur = this.doc.page.width - 72;
    this.bas = this.doc.page.height - 58;
    this.logo = imageBuffer(entete.logo_base64);
    this.signature = imageBuffer(entete.signature_cachet_base64);
    this.y = this.enteteEntreprise(true);
  }

  enteteEntreprise(premiere) {
    const d = this.doc;
    const e = this.e;
    let y = 30;
    let x = this.gauche;
    if (this.logo) {
      try {
        d.image(this.logo, x, y, { fit: [70, 54] });
        x += 80;
      } catch (err) {
        /* logo illisible : on continue sans */
      }
    }
    d.font("Helvetica-Bold").fontSize(12).fillColor("#111").text(e.raison_sociale || "", x, y, { width: this.largeur - (x - this.gauche), lineBreak: false });
    d.font("Helvetica").fontSize(8).fillColor("#444");
    let yy = y + 16;
    for (const t of [e.adresse, [e.telephone ? `Tél : ${e.telephone}` : null, e.email].filter(Boolean).join("  ·  ")]) {
      if (t) {
        d.text(t, x, yy, { width: this.largeur - (x - this.gauche), lineBreak: false });
        yy += 11;
      }
    }
    y = Math.max(yy, y + 56) + 4;
    d.moveTo(this.gauche, y).lineTo(this.gauche + this.largeur, y).lineWidth(0.8).stroke("#111");
    y += 10;
    if (premiere) {
      d.font("Helvetica-Bold").fontSize(14).fillColor("#111").text(this.titre, this.gauche, y, { width: this.largeur, align: "center", lineBreak: false });
      y += 19;
      if (this.sousTitre) {
        d.font("Helvetica-Bold").fontSize(9).fillColor("#222").text(this.sousTitre, this.gauche, y, { width: this.largeur, align: "center", lineBreak: false });
        y += 13;
      }
      if (this.versionLibelle) {
        d.font("Helvetica").fontSize(8).fillColor("#555").text(this.versionLibelle, this.gauche, y, { width: this.largeur, align: "center", lineBreak: false });
        y += 12;
      }
      y += 4;
    }
    return y;
  }

  nouvellePage(titreSection) {
    this.doc.addPage();
    this.y = this.enteteEntreprise(false);
    if (titreSection) {
      this.doc.font("Helvetica-Bold").fontSize(12).fillColor("#111").text(titreSection, this.gauche, this.y, { width: this.largeur, align: "center", lineBreak: false });
      this.y += 22;
    }
  }

  assurer(h, titreSuite) {
    if (this.y + h > this.bas) this.nouvellePage(titreSuite);
  }

  texte(txt, { gras = false, taille = 8.5, couleur = "#111", x, largeur, align = "left", espace = 3 } = {}) {
    const d = this.doc;
    d.font(gras ? "Helvetica-Bold" : "Helvetica").fontSize(taille).fillColor(couleur);
    const w = largeur || this.largeur;
    const h = d.heightOfString(String(txt), { width: w, align });
    this.assurer(h + espace);
    d.text(String(txt), x === undefined ? this.gauche : x, this.y, { width: w, align });
    this.y += h + espace;
  }

  titreSection(t) {
    this.assurer(26);
    this.y += 4;
    this.doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0B3B47").text(t, this.gauche, this.y, { width: this.largeur, lineBreak: false });
    this.y += 13;
    this.doc.moveTo(this.gauche, this.y - 2).lineTo(this.gauche + this.largeur, this.y - 2).lineWidth(0.4).stroke("#9aa");
  }

  /** Tableau : colonnes [{titre, poids, align}], lignes [{cellules, gras, indent, fond, separateur, italique}]. */
  tableau(colonnes, lignes, { taille = 7.8, lh = 11.5, sansEntete = false } = {}) {
    const d = this.doc;
    const total = colonnes.reduce((s, c) => s + c.poids, 0);
    const xs = [];
    const ws = [];
    let x = this.gauche;
    for (const c of colonnes) {
      const w = (this.largeur * c.poids) / total;
      xs.push(x);
      ws.push(w);
      x += w;
    }
    const entete = () => {
      d.font("Helvetica-Bold").fontSize(taille).fillColor("#111");
      d.rect(this.gauche, this.y - 2, this.largeur, lh + 2).fill("#E8EEF0");
      d.fillColor("#111");
      colonnes.forEach((c, i) => d.text(c.titre, xs[i] + 2, this.y + 1, { width: ws[i] - 5, align: c.align || "left", lineBreak: false }));
      this.y += lh + 3;
    };
    this.assurer(lh * 3);
    if (!sansEntete) entete();
    for (const l of lignes) {
      if (this.y + lh > this.bas) {
        this.nouvellePage();
        if (!sansEntete) entete();
      }
      if (l.fond) d.rect(this.gauche, this.y - 2, this.largeur, lh).fill(l.fond);
      if (l.separateur) d.moveTo(this.gauche, this.y - 2).lineTo(this.gauche + this.largeur, this.y - 2).lineWidth(0.4).stroke("#777");
      d.font(l.gras ? "Helvetica-Bold" : l.italique ? "Helvetica-Oblique" : "Helvetica").fontSize(taille).fillColor(l.couleur || "#111");
      l.cellules.forEach((v, i) => {
        const c = colonnes[i];
        let txt = String(v ?? "");
        const pad = i === 0 ? (l.indent || 0) * 10 : 0;
        const w = ws[i] - 5 - pad;
        while (txt.length > 1 && d.widthOfString(txt) > w) txt = txt.slice(0, -1);
        d.text(txt, xs[i] + 2 + pad, this.y, { width: w + 1, align: c.align || "left", lineBreak: false });
      });
      this.y += lh;
    }
    this.y += 4;
  }

  blocSignature() {
    const d = this.doc;
    const e = this.e;
    this.assurer(130);
    this.y += 14;
    const w = 220;
    const x = this.gauche + this.largeur - w;
    d.font("Helvetica").fontSize(8.5).fillColor("#111").text(`${FR.faitA} ${aujourdhui()}`, x, this.y, { width: w, align: "center", lineBreak: false });
    this.y += 14;
    if (e.signataire_titre) {
      d.font("Helvetica").fontSize(8.5).text(e.signataire_titre, x, this.y, { width: w, align: "center", lineBreak: false });
      this.y += 12;
    }
    if (e.signataire_nom) {
      d.font("Helvetica-Bold").fontSize(9).text(e.signataire_nom, x, this.y, { width: w, align: "center", lineBreak: false });
      this.y += 13;
    }
    if (this.signature) {
      try {
        d.image(this.signature, x + (w - 150) / 2, this.y, { fit: [150, 75] });
      } catch (err) {
        /* image illisible */
      }
    }
    this.y += 80;
  }

  async terminer() {
    const d = this.doc;
    const range = d.bufferedPageRange();
    const pied = piedLignes(this.e);
    for (let i = 0; i < range.count; i++) {
      d.switchToPage(range.start + i);
      const marge = d.page.margins.bottom;
      d.page.margins.bottom = 0;
      const yb = d.page.height - 40;
      d.moveTo(this.gauche, yb).lineTo(this.gauche + this.largeur, yb).lineWidth(0.4).stroke("#777");
      d.font("Helvetica").fontSize(7).fillColor("#555");
      if (pied.length) d.text(pied.join("  ·  "), this.gauche, yb + 4, { width: this.largeur, align: "center", lineBreak: false });
      d.text(`${FR.edite} ${aujourdhui()}`, this.gauche, yb + 15, { width: this.largeur / 2, lineBreak: false });
      d.text(`${FR.page} ${i + 1} / ${range.count}`, this.gauche, yb + 15, { width: this.largeur, align: "right", lineBreak: false });
      d.page.margins.bottom = marge;
    }
    d.end();
    return this.fini;
  }
}

function infosDossier(pdf, data) {
  const d = data.dossier;
  pdf.texte(`${FR.dossier} : ${d.libelle || ""}${d.reference ? `  (${FR.reference} ${d.reference})` : ""}`, { gras: true, taille: 9 });
  if (d.client_nom) pdf.texte(`${FR.client} : ${d.client_nom}`, { taille: 8.5 });
  pdf.texte(FR.devise, { taille: 8, couleur: "#555", espace: 6 });
}

function pagesBanque(pdf, data, plan) {
  const s = data.synthese;
  const f = data.financements[0] || null;
  pdf.nouvellePage(FR.pageDemande);
  infosDossier(pdf, data);
  const kv = (rows) =>
    pdf.tableau(
      [{ titre: "", poids: 58 }, { titre: "", poids: 42, align: "right" }],
      rows.map(([k, v]) => ({ cellules: [k, v] })),
      { lh: 12.5, sansEntete: true }
    );
  pdf.titreSection(FR.demande);
  if (f) {
    kv([
      [FR.facilite, f.type_facilite ? (TYPES_FACILITE[f.type_facilite] || f.type_facilite) : ""],
      [FR.banque, f.banque || ""],
      [FR.montantDemande, `${nf(f.montant)} F CFA`],
      [FR.datePrise, ddmmyyyy(f.date_prise)],
      [FR.dateEcheance, ddmmyyyy(f.date_echeance)],
      [FR.duree, f.duree_jours ? `${f.duree_jours} ${FR.jours}` : ""],
    ]);
  } else {
    pdf.texte("—");
  }
  pdf.titreSection(FR.remboursement);
  const ps = plan ? plan.synthese : null;
  kv([
    [FR.source, FR.sourceTexte],
    [FR.debiteur, data.dossier.client_nom || ""],
    [FR.dateEncaissement, ps ? ddmmyyyy(ps.dernier_encaissement) : ""],
  ]);
  pdf.titreSection(FR.couverture);
  kv([
    [FR.margeCom, `${nf(s.marge_commerciale)} F CFA`],
    [FR.coutFin, `${nf(s.cout_financement)} F CFA`],
    [FR.couvre, s.couverture !== null ? `${String(s.couverture).replace(".", ",")} ${FR.fois}` : "—"],
    [FR.coutFinPct, s.cout_financement_pct_ca !== null ? pc(s.cout_financement_pct_ca) : "—"],
    [FR.tauxAnnuel, f && f.taux_effectif_annuel_pct !== null ? pc(f.taux_effectif_annuel_pct) : "—"],
  ]);
  if (ps) {
    pdf.titreSection(FR.besoin);
    kv([
      [FR.dateT, ddmmyyyy(plan.date_t)],
      [FR.besoinMax, `${nf(ps.besoin_max)} F CFA`],
      [FR.dateBesoin, ps.date_besoin_max ? `${ddmmyyyy(ps.date_besoin_max)} (T + ${ps.jour_besoin_max})` : "—"],
      [FR.portage, `${ps.portage_jours} ${FR.jours}`],
      [FR.pointBas, ps.point_bas_avec !== null ? `${nf(ps.point_bas_avec)} F CFA` : "—"],
      ...(plan.apport_xof > 0 ? [[FR.apport, `${nf(plan.apport_xof)} F CFA`]] : []),
    ]);
  }
  pdf.titreSection(FR.garanties);
  const g = [];
  if (f && f.domiciliation_exigee) g.push(`${FR.domiciliation} : ${FR.oui}`);
  if (f && f.conditions_particulieres) g.push(String(f.conditions_particulieres));
  if (g.length === 0) g.push(FR.aucune);
  g.forEach((t) => pdf.texte(t, { taille: 8.3 }));
}

async function compteExploitationPdf(data, entete, plan) {
  const banque = data.version === "BANQUE";
  const pdf = new Pdf(entete, {
    titre: FR.titreCompte,
    sousTitre: data.dossier.libelle || "",
    versionLibelle: banque ? FR.versionBanque : FR.versionInterne,
  });
  infosDossier(pdf, data);
  const colonnes = banque
    ? [
        { titre: FR.poste, poids: 56 },
        { titre: FR.montant, poids: 18, align: "right" },
        { titre: FR.pctCa, poids: 12, align: "right" },
        { titre: FR.pctRevient, poids: 14, align: "right" },
      ]
    : [
        { titre: FR.poste, poids: 38 },
        { titre: FR.prev, poids: 15, align: "right" },
        { titre: FR.pctCa, poids: 8, align: "right" },
        { titre: FR.engage, poids: 13, align: "right" },
        { titre: FR.reel, poids: 14, align: "right" },
        { titre: FR.ecart, poids: 12, align: "right" },
      ];
  const lignes = data.lignes.map((l) => {
    const gras = l.type === "total" || l.type === "resultat" || l.type === "section";
    const base = {
      gras,
      indent: l.type === "detail" ? 2 : l.type === "ligne" ? 1 : 0,
      fond: l.type === "resultat" ? "#E3EFE9" : l.type === "section" ? "#F2F4F5" : null,
      separateur: l.type === "total",
      italique: l.type === "detail",
      couleur: l.type === "detail" ? "#444" : null,
    };
    if (l.type === "section") return { ...base, cellules: banque ? [l.libelle, "", "", ""] : [l.libelle, "", "", "", "", ""] };
    const mont = l.note ? "" : nf(l.previsionnel);
    if (banque) return { ...base, cellules: [l.libelle, mont, l.pct_ca !== null && !l.note ? pc(l.pct_ca) : "", l.pct_revient !== null ? pc(l.pct_revient) : ""] };
    return { ...base, cellules: [l.libelle, mont, l.pct_ca !== null && !l.note ? pc(l.pct_ca) : "", nf(l.engage), nf(l.reel), l.ecart !== null ? nf(l.ecart) : ""] };
  });
  pdf.tableau(colonnes, lignes);
  const s = data.synthese;
  pdf.texte(
    `${data.libelles.MARGE_COM} : ${nf(s.marge_commerciale)} F CFA — ${pc(s.marge_commerciale_pct_ca)} du chiffre d'affaires, ${pc(s.marge_commerciale_pct_revient)} du coût de revient.`,
    { taille: 8.3 }
  );
  pdf.texte(
    `${data.libelles.MARGE_GLOBALE} : ${nf(s.marge_globale)} F CFA — ${pc(s.marge_globale_pct_ca)} du chiffre d'affaires, ${pc(s.marge_globale_pct_revient)} du coût de revient.`,
    { taille: 8.3, gras: true }
  );
  if (!banque) {
    if (data.reel_partiel) pdf.texte("Réel : réceptions partielles ; les totaux réels ne sont affichés qu'une fois toutes les commandes reçues.", { taille: 7.5, couleur: "#555" });
    pdf.texte("Frais bancaires réels : valeurs retenues (frais de paiement estimés, coût de la ligne retenue).", { taille: 7.5, couleur: "#555" });
  }
  pdf.texte("La TVA à l'importation est comptée en charge, comme dans le Dossier de calcul.", { taille: 7.5, couleur: "#555" });
  if (banque && plan) {
    pagesBanque(pdf, data, plan);
    pdf.nouvellePage(FR.titrePlan);
    corpsPlan(pdf, plan, { synthese: false, alertes: false, flux: false });
  }
  pdf.blocSignature();
  return pdf.terminer();
}

// --------------------------------------------------------------------------- plan
function corpsPlan(pdf, plan, { synthese = true, alertes = true, flux = true } = {}) {
  const d = pdf.doc;
  const s = plan.synthese;
  const baseTxt = plan.base === "HT" ? (plan.hors_douane ? FR.planHorsDouane : FR.planHt) : FR.planTtc;
  pdf.texte(`${FR.planBase} : ${baseTxt}`, { taille: 8.2 });
  pdf.texte(`${FR.dateT} : ${ddmmyyyy(plan.date_t)}   ·   ${FR.horizon} : ${plan.horizon_jours || s.horizon_jours} ${FR.jours} (${ddmmyyyy(plan.date_t)} au ${ddmmyyyy(s.date_fin)})`, { taille: 8.2, espace: 6 });
  if (synthese !== false) {
    pdf.titreSection(FR.cles);
    const kv = [
      [FR.besoinMax, `${nf(s.besoin_max)} F CFA${s.date_besoin_max ? ` (${ddmmyyyy(s.date_besoin_max)}, T + ${s.jour_besoin_max})` : ""}`],
      [FR.portage, `${s.portage_jours} ${FR.jours}`],
      [FR.soldeFinalSans, `${nf(s.solde_final_sans)} F CFA`],
    ];
    if (s.solde_final_avec !== null) {
      kv.push([FR.soldeFinalAvec, `${nf(s.solde_final_avec)} F CFA`]);
      kv.push([FR.coutFin, `${nf(s.cout_financement)} F CFA`]);
      kv.push([FR.pointBas, `${nf(s.point_bas_avec)} F CFA`]);
    }
    pdf.tableau([{ titre: "", poids: 60 }, { titre: "", poids: 40, align: "right" }], kv.map(([k, v]) => ({ cellules: [k, v] })), { lh: 12.5, sansEntete: true });
  }
  if (plan.commentaire && plan.commentaire.length) {
    pdf.titreSection(FR.commentaire);
    plan.commentaire.forEach((c) => pdf.texte(`•  ${c}`, { taille: 8.3 }));
  }
  const al = alertes ? (plan.alertes || []).filter((a) => a.niveau !== "INFO") : [];
  if (al.length) {
    pdf.titreSection(FR.alertes);
    al.forEach((a) => pdf.texte(`•  ${a.texte}`, { taille: 8.1 }));
  }
  // Courbe
  pdf.titreSection(FR.courbe);
  courbe(pdf, plan);
  pdf.titreSection(`${FR.periode} — ${plan.pas === "JOUR" ? "jour" : plan.pas === "SEMAINE" ? "semaine" : "mois de 30 jours"}`);
  const avec = !!plan.avec;
  const colonnes = [
    { titre: FR.periode, poids: 20 },
    { titre: FR.encaissements, poids: 13, align: "right" },
    { titre: FR.decaissements, poids: 13, align: "right" },
    ...(avec ? [{ titre: FR.ligneFin, poids: 12, align: "right" }] : []),
    { titre: avec ? "Solde sans ligne" : FR.soldeSans, poids: 14, align: "right" },
    ...(avec ? [{ titre: "Solde avec ligne", poids: 14, align: "right" }] : []),
    { titre: "Point bas", poids: 14, align: "right" },
  ];
  const lignes = plan.periodes.map((p) => ({
    cellules: [
      `${ddmmyyyy(p.debut)}${p.fin !== p.debut ? ` au ${ddmmyyyy(p.fin)}` : ""}`,
      nf(p.encaissements, { zero: false }),
      nf(p.decaissements, { zero: false }),
      ...(avec ? [nf(p.financement_entrees - p.financement_sorties, { zero: false })] : []),
      nf(p.cloture_sans),
      ...(avec ? [nf(p.cloture_avec)] : []),
      nf(avec ? p.min_avec : p.min_sans),
    ],
    couleur: (avec ? p.min_avec : p.min_sans) < 0 ? "#B23A2E" : null,
  }));
  pdf.tableau(colonnes, lignes, { taille: 7.5 });
  if (!flux) return;
  pdf.titreSection(FR.flux);
  pdf.tableau(
    [
      { titre: FR.date, poids: 14 },
      { titre: "T+", poids: 7, align: "right" },
      { titre: FR.libelle, poids: 47 },
      { titre: FR.entree, poids: 16, align: "right" },
      { titre: FR.sortie, poids: 16, align: "right" },
    ],
    plan.flux.map((f) => ({ cellules: [ddmmyyyy(f.date), String(f.jour), f.libelle, f.sens === "ENTREE" ? nf(f.montant) : "", f.sens === "SORTIE" ? nf(f.montant) : ""] })),
    { taille: 7.3, lh: 10.5 }
  );
  void d;
}

function courbe(pdf, plan) {
  const d = pdf.doc;
  const h = 150;
  pdf.assurer(h + 30);
  const x0 = pdf.gauche + 46;
  const w = pdf.largeur - 56;
  const y0 = pdf.y + 4;
  const sans = plan.sans.points;
  const avec = plan.avec ? plan.avec.points : null;
  const fin = plan.synthese.date_fin;
  const jours = (iso) => Math.max(0, Math.round((Date.parse(iso) - Date.parse(plan.date_t)) / 86400000));
  const horizon = Math.max(1, jours(fin));
  const toutes = [...sans, ...(avec || [])].map((p) => p.solde);
  let max = Math.max(0, ...toutes);
  let min = Math.min(0, ...toutes);
  if (max === min) max = min + 1;
  const marge = (max - min) * 0.05;
  max += marge;
  if (min < 0) min -= marge;
  const X = (j) => x0 + (j / horizon) * w;
  const Y = (v) => y0 + h - ((v - min) / (max - min)) * h;
  d.save();
  d.lineWidth(0.3).strokeColor("#ccc");
  const brut = (max - min) / 4;
  const puiss = Math.pow(10, Math.floor(Math.log10(brut)));
  const pasY = [1, 2, 2.5, 5, 10].map((m) => m * puiss).find((v) => v >= brut) || brut;
  for (let v = Math.ceil(min / pasY) * pasY; v <= max + 1e-6; v += pasY) {
    d.moveTo(x0, Y(v)).lineTo(x0 + w, Y(v)).stroke();
    d.font("Helvetica").fontSize(6.5).fillColor("#555").text(nf(v), pdf.gauche, Y(v) - 3, { width: 42, align: "right", lineBreak: false });
  }
  d.lineWidth(0.7).strokeColor("#111").moveTo(x0, Y(0)).lineTo(x0 + w, Y(0)).stroke();
  const pas = (pts, couleur, tirets) => {
    d.lineWidth(1.3).strokeColor(couleur);
    if (tirets) d.dash(4, { space: 3 });
    let prev = null;
    pts.forEach((p) => {
      const j = Math.min(horizon, jours(p.date));
      if (prev === null) d.moveTo(X(j), Y(p.solde));
      else {
        d.lineTo(X(j), Y(prev));
        d.lineTo(X(j), Y(p.solde));
      }
      prev = p.solde;
    });
    if (prev !== null) d.lineTo(X(horizon), Y(prev));
    d.stroke();
    d.undash();
  };
  pas(sans, "#B23A2E", true);
  if (avec) pas(avec, "#0A8CA3", false);
  d.font("Helvetica").fontSize(6.5).fillColor("#555");
  for (let i = 0; i <= 5; i++) {
    const j = Math.round((horizon * i) / 5);
    d.text(`T+${j}`, X(j) - 14, y0 + h + 3, { width: 28, align: "center", lineBreak: false });
  }
  // legende
  const yl = y0 + h + 14;
  d.lineWidth(1.3).strokeColor("#B23A2E").dash(4, { space: 3 }).moveTo(x0, yl + 3).lineTo(x0 + 18, yl + 3).stroke().undash();
  d.fillColor("#111").text(FR.sansFin, x0 + 22, yl, { lineBreak: false });
  if (avec) {
    d.lineWidth(1.3).strokeColor("#0A8CA3").moveTo(x0 + 110, yl + 3).lineTo(x0 + 128, yl + 3).stroke();
    d.fillColor("#111").text(FR.avecFin, x0 + 132, yl, { lineBreak: false });
  }
  d.restore();
  pdf.y = yl + 16;
}

async function planPdf(info, entete) {
  // info : résultat de planSvc.charger
  const plan = info.plan;
  const pdf = new Pdf(entete, { titre: FR.titrePlan, sousTitre: info.dossier.libelle || "", versionLibelle: null });
  pdf.texte(`${FR.dossier} : ${info.dossier.libelle || ""}${info.dossier.reference ? `  (${FR.reference} ${info.dossier.reference})` : ""}`, { gras: true, taille: 9 });
  if (info.dossier.client_nom) pdf.texte(`${FR.client} : ${info.dossier.client_nom}`, { taille: 8.5 });
  if (plan.incomplet && plan.incomplet.length) {
    pdf.texte(FR.incomplet, { gras: true, taille: 9, couleur: "#B23A2E" });
  } else {
    corpsPlan(pdf, { ...plan, date_t: info.params.date_t, base: info.params.base, hors_douane: info.params.hors_douane, apport_xof: info.params.apport_xof });
  }
  pdf.blocSignature();
  return pdf.terminer();
}

// --------------------------------------------------------------------------- Excel
function enteteXlsx(aoa, entete, titre, sousTitre) {
  aoa.push([entete.raison_sociale || ""]);
  if (entete.adresse) aoa.push([entete.adresse]);
  const contact = [entete.telephone ? `Tél : ${entete.telephone}` : null, entete.email].filter(Boolean).join("  ·  ");
  if (contact) aoa.push([contact]);
  aoa.push([]);
  aoa.push([titre]);
  if (sousTitre) aoa.push([sousTitre]);
  aoa.push([]);
}
function pieds(aoa, entete) {
  aoa.push([]);
  aoa.push([`${FR.faitA} ${aujourdhui()}`]);
  if (entete.signataire_titre) aoa.push([entete.signataire_titre]);
  if (entete.signataire_nom) aoa.push([entete.signataire_nom]);
  const p = piedLignes(entete);
  if (p.length) {
    aoa.push([]);
    aoa.push([p.join("  ·  ")]);
  }
}
const nombresXlsx = (ws, colonnes, depuis) => {
  const plage = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = depuis; r <= plage.e.r; r++)
    for (const c of colonnes) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") cell.z = "#,##0;-#,##0";
    }
};

function compteExploitationXlsx(data, entete, plan) {
  const banque = data.version === "BANQUE";
  const aoa = [];
  enteteXlsx(aoa, entete, FR.titreCompte, `${data.dossier.libelle || ""}${data.dossier.reference ? ` (${data.dossier.reference})` : ""}`);
  if (data.dossier.client_nom) aoa.push([`${FR.client} : ${data.dossier.client_nom}`]);
  aoa.push([banque ? FR.versionBanque : FR.versionInterne, null, null, null, null, FR.devise]);
  aoa.push([]);
  const debut = aoa.length;
  aoa.push(banque ? [FR.poste, FR.montant, FR.pctCa, FR.pctRevient] : [FR.poste, FR.prev, FR.pctCa, FR.engage, FR.reel, FR.ecart]);
  for (const l of data.lignes) {
    const lib = `${"   ".repeat(l.type === "detail" ? 2 : l.type === "ligne" ? 1 : 0)}${l.libelle}`;
    if (l.type === "section") {
      aoa.push([lib]);
      continue;
    }
    const prev = l.note ? null : l.previsionnel;
    const p = l.pct_ca !== null && !l.note ? l.pct_ca / 100 : null;
    aoa.push(banque ? [lib, prev, p, l.pct_revient !== null ? l.pct_revient / 100 : null] : [lib, prev, p, l.engage, l.reel, l.ecart]);
  }
  pieds(aoa, entete);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 62 }, { wch: 18 }, { wch: 11 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  nombresXlsx(ws, banque ? [1] : [1, 3, 4, 5], debut);
  const plageP = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = debut; r <= plageP.e.r; r++)
    for (const c of banque ? [2, 3] : [2]) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === "number") cell.z = "0.0%";
    }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Compte d'exploitation");
  if (plan && plan.periodes) XLSX.utils.book_append_sheet(wb, feuillePlan(plan, entete, data.dossier), "Plan de trésorerie");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function feuillePlan(plan, entete, dossier, params) {
  const aoa = [];
  enteteXlsx(aoa, entete, FR.titrePlan, dossier.libelle || "");
  const s = plan.synthese;
  const date_t = (params && params.date_t) || plan.date_t;
  aoa.push([FR.dateT, ddmmyyyy(date_t)]);
  aoa.push([FR.besoinMax, s.besoin_max, s.date_besoin_max ? ddmmyyyy(s.date_besoin_max) : ""]);
  aoa.push([FR.portage, `${s.portage_jours} ${FR.jours}`]);
  aoa.push([FR.soldeFinalSans, s.solde_final_sans]);
  if (s.solde_final_avec !== null) {
    aoa.push([FR.soldeFinalAvec, s.solde_final_avec]);
    aoa.push([FR.coutFin, s.cout_financement]);
  }
  aoa.push([]);
  aoa.push([FR.periode, FR.encaissements, FR.decaissements, FR.ligneFin, "Solde fin (sans ligne)", "Solde fin (avec ligne)", "Point bas"]);
  for (const p of plan.periodes) {
    aoa.push([
      `${ddmmyyyy(p.debut)}${p.fin !== p.debut ? ` au ${ddmmyyyy(p.fin)}` : ""}`,
      p.encaissements,
      p.decaissements,
      p.financement_entrees - p.financement_sorties,
      p.cloture_sans,
      p.cloture_avec,
      plan.avec ? p.min_avec : p.min_sans,
    ]);
  }
  aoa.push([]);
  aoa.push([FR.date, "T+", FR.libelle, FR.entree, FR.sortie]);
  for (const f of plan.flux) aoa.push([ddmmyyyy(f.date), f.jour, f.libelle, f.sens === "ENTREE" ? f.montant : null, f.sens === "SORTIE" ? f.montant : null]);
  pieds(aoa, entete);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 36 }, { wch: 16 }, { wch: 40 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 16 }];
  nombresXlsx(ws, [1, 2, 3, 4, 5, 6], 0);
  return ws;
}

function planXlsx(info, entete) {
  const wb = XLSX.utils.book_new();
  if (info.plan.incomplet && info.plan.incomplet.length) {
    const ws = XLSX.utils.aoa_to_sheet([[FR.incomplet]]);
    XLSX.utils.book_append_sheet(wb, ws, "Plan de trésorerie");
  } else {
    XLSX.utils.book_append_sheet(wb, feuillePlan(info.plan, entete, info.dossier, info.params), "Plan de trésorerie");
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

module.exports = { chargerEntete, compteExploitationPdf, compteExploitationXlsx, planPdf, planXlsx };
