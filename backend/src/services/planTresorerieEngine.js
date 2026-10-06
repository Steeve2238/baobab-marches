/**
 * Plan de tresorerie previsionnel d'un dossier (06/10/2026).
 *
 * Fonction pure : a partir de la date d'engagement T, des echeanciers de paiement
 * (client et fournisseurs), des frais d'approche, d'un financement eventuel et
 * d'autres flux saisis, construit
 *   - la liste datee des flux,
 *   - la tresorerie cumulee SANS financement et AVEC la ligne simulee,
 *   - le besoin de financement maximal (point bas) et sa date,
 *   - un tableau par periode (jour / semaine / mois),
 *   - des alertes de dimensionnement et un commentaire en langage simple.
 *
 * Base TTC par defaut (les droits et la TVA a l'import sont payes avant la vente) ;
 * base HT : hors TVA. `hors_douane` retire en plus tous les paiements a la douane.
 */

const JALONS_DEFAUT = {
  production_jours: 15, // commande -> expedition
  transport_jours: 30, // expedition -> arrivee de la marchandise
  livraison_jours: 10, // arrivee -> livraison au client (dedouanement et acheminement)
  facturation_jours: 0, // livraison -> emission de la facture
  reception_jours: 0, // livraison -> reception / recette par le client
};

const ARR = (n) => Math.round(Number(n) * 100) / 100;
const num = (v, d = 0) => {
  const n = Number(String(v === undefined || v === null || v === "" ? d : v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : d;
};

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
const DAY = 86400000;
function isoDe(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function ajouterJours(iso, n) {
  return isoDe(parseDate(iso) + n * DAY);
}
function ecartJours(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY);
}
function fmtN(n) {
  return Math.round(Number(n)).toLocaleString("fr-FR").replace(/ | /g, " ");
}
function fmtD(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

const TX = {
  fr: {
    cl: "Client",
    fo: (n) => `Fournisseur ${n}`,
    fret: "Fret",
    assurance: "Assurance transport",
    droits: "Droits et taxes de douane",
    tva_import: "TVA à l'importation",
    transit: "Frais de transit",
    frais_paiement: "Frais de paiement du fournisseur (change, virement)",
    deblocage: "Déblocage de la ligne (net des frais prélevés)",
    remboursement: "Remboursement de la ligne et frais à l'échéance",
    garantie_frais: "Frais de la garantie à la mise en place",
    garantie_echeance: "Frais de la garantie à l'échéance",
    apport: "Trésorerie propre du dossier",
    manqueClient: "Les conditions de paiement du client ne sont pas renseignées.",
    manqueFournisseur: (n) => `Les conditions de paiement du fournisseur « ${n} » ne sont pas renseignées.`,
    aucuneVente: "Aucun prix de vente n'est disponible : retenez des offres dans le Dossier de calcul.",
    aucunAchat: "Aucune offre fournisseur retenue : retenez des offres dans le Dossier de calcul.",
    insuffisant: (min, d) => `Même avec la ligne, la trésorerie reste négative : point bas de ${fmtN(Math.abs(min))} F CFA le ${fmtD(d)}.`,
    tropEleve: (av, bes) => `La ligne apporte ${fmtN(av)} F CFA alors que le besoin maximal est de ${fmtN(bes)} F CFA : une partie des frais est payée pour de l'argent inutilisé.`,
    priseTardive: (d1, d2) => `La ligne n'arrive que le ${fmtD(d2)} alors que la trésorerie devient négative dès le ${fmtD(d1)}.`,
    echeanceAvantEncaissement: (d1, d2) => `La ligne est à rembourser le ${fmtD(d1)}, avant le dernier encaissement du client (${fmtD(d2)}) : prévoir une échéance plus longue.`,
    dureeCourte: (duree, portage) => `La ligne dure ${duree} jours, alors que l'argent reste avancé environ ${portage} jours entre le premier décaissement et le dernier encaissement.`,
    sansFinancement: "Aucune ligne de financement n'est rattachée : le plan montre le besoin brut.",
    dateParDefaut: "Les dates de prise et d'échéance de la ligne ne sont pas renseignées : elles sont calées sur la date d'engagement et la durée de la simulation.",
    c_besoin: (b, d, j) => `Le besoin de financement atteint ${fmtN(b)} F CFA le ${fmtD(d)} (jour T + ${j}).`,
    c_aucun: "Le dossier se finance seul : la trésorerie ne devient jamais négative.",
    c_portage: (p, a, b) => `L'argent reste avancé environ ${p} jours, du premier décaissement (${fmtD(a)}) au dernier encaissement (${fmtD(b)}).`,
    c_ligne: (lib, cout, couvre) => `La ligne « ${lib} » coûte ${fmtN(cout)} F CFA et ${couvre ? "couvre le besoin" : "ne couvre pas tout le besoin"}.`,
    c_final: (s) => `Solde de trésorerie à la fin du plan : ${fmtN(s)} F CFA.`,
    baseTtc: "Base TTC : droits de douane et TVA à l'importation compris.",
    baseHt: "Base HT : hors TVA.",
    horsDouane: "Hors paiements à la douane.",
  },
  en: {
    cl: "Client",
    fo: (n) => `Supplier ${n}`,
    fret: "Freight",
    assurance: "Transport insurance",
    droits: "Customs duties and taxes",
    tva_import: "Import VAT",
    transit: "Forwarding fees",
    frais_paiement: "Supplier payment fees (exchange, transfer)",
    deblocage: "Facility drawdown (net of fees withheld)",
    remboursement: "Facility repayment and fees at maturity",
    garantie_frais: "Guarantee fees at set-up",
    garantie_echeance: "Guarantee fees at maturity",
    apport: "Own cash for the file",
    manqueClient: "The client's payment terms are not filled in.",
    manqueFournisseur: (n) => `The payment terms of supplier "${n}" are not filled in.`,
    aucuneVente: "No selling price is available: select offers in the Pricing file.",
    aucunAchat: "No supplier offer selected: select offers in the Pricing file.",
    insuffisant: (min, d) => `Even with the facility, cash stays negative: low point of ${fmtN(Math.abs(min))} XOF on ${fmtD(d)}.`,
    tropEleve: (av, bes) => `The facility brings ${fmtN(av)} XOF while the peak need is ${fmtN(bes)} XOF: part of the fees pays for unused money.`,
    priseTardive: (d1, d2) => `The facility only arrives on ${fmtD(d2)} while cash turns negative as early as ${fmtD(d1)}.`,
    echeanceAvantEncaissement: (d1, d2) => `The facility is due on ${fmtD(d1)}, before the client's last payment (${fmtD(d2)}): plan a longer maturity.`,
    dureeCourte: (duree, portage) => `The facility lasts ${duree} days, while the money is tied up for about ${portage} days between the first payment out and the last payment in.`,
    sansFinancement: "No financing facility is attached: the plan shows the gross need.",
    dateParDefaut: "The facility's start and maturity dates are not set: they follow the commitment date and the simulation duration.",
    c_besoin: (b, d, j) => `The financing need peaks at ${fmtN(b)} XOF on ${fmtD(d)} (day T + ${j}).`,
    c_aucun: "The file funds itself: cash never turns negative.",
    c_portage: (p, a, b) => `The money is tied up for about ${p} days, from the first payment out (${fmtD(a)}) to the last payment in (${fmtD(b)}).`,
    c_ligne: (lib, cout, couvre) => `The facility "${lib}" costs ${fmtN(cout)} XOF and ${couvre ? "covers the need" : "does not cover the whole need"}.`,
    c_final: (s) => `Cash balance at the end of the plan: ${fmtN(s)} XOF.`,
    baseTtc: "VAT-inclusive basis: customs duties and import VAT included.",
    baseHt: "VAT-exclusive basis.",
    horsDouane: "Excluding customs payments.",
  },
};

/** Dates des jalons du dossier a partir de T. */
function calculerJalons(dateT, jalonsEntree) {
  const j = { ...JALONS_DEFAUT };
  for (const k of Object.keys(JALONS_DEFAUT)) {
    if (jalonsEntree && jalonsEntree[k] !== undefined && jalonsEntree[k] !== null && jalonsEntree[k] !== "") {
      const n = Math.round(num(jalonsEntree[k], JALONS_DEFAUT[k]));
      j[k] = Math.max(0, Math.min(720, n));
    }
  }
  const COMMANDE = dateT;
  const EXPEDITION = ajouterJours(COMMANDE, j.production_jours);
  const ARRIVEE = ajouterJours(EXPEDITION, j.transport_jours);
  const LIVRAISON = ajouterJours(ARRIVEE, j.livraison_jours);
  const FACTURATION = ajouterJours(LIVRAISON, j.facturation_jours);
  const RECEPTION = ajouterJours(LIVRAISON, j.reception_jours);
  return { delais: j, dates: { COMMANDE, EXPEDITION, ARRIVEE, LIVRAISON, FACTURATION, RECEPTION } };
}

function lignesEcheancier(e) {
  return Array.isArray(e) && e.length > 0 ? e : null;
}

/**
 * @param {object} entree voir l'en-tete du fichier
 * @param {string} lang
 */
function construirePlan(entree, lang = "fr") {
  const T = TX[lang] || TX.fr;
  const dateT = String(entree.date_t || "").slice(0, 10);
  if (!parseDate(dateT)) throw new Error("DATE_T_INVALIDE");
  const base = entree.base === "HT" ? "HT" : "TTC";
  const horsDouane = !!entree.hors_douane;
  const apport = ARR(Math.max(0, num(entree.apport_xof, 0)));
  const { delais, dates: jalons } = calculerJalons(dateT, entree.jalons);

  const incomplet = [];
  const vente = entree.vente || null;
  const achats = Array.isArray(entree.achats) ? entree.achats : [];
  if (!vente || !(num(vente.ht) > 0)) incomplet.push({ code: "AUCUNE_VENTE", texte: T.aucuneVente });
  if (achats.length === 0) incomplet.push({ code: "AUCUN_ACHAT", texte: T.aucunAchat });
  if (vente && num(vente.ht) > 0 && !lignesEcheancier(vente.echeancier)) incomplet.push({ code: "ECHEANCIER_CLIENT", texte: T.manqueClient });
  for (const a of achats) {
    if (!lignesEcheancier(a.echeancier)) incomplet.push({ code: "ECHEANCIER_FOURNISSEUR", texte: T.manqueFournisseur(a.fournisseur_nom || "?"), fournisseur_id: a.fournisseur_id || null });
  }

  const note = [base === "TTC" ? T.baseTtc : T.baseHt];
  if (horsDouane) note.push(T.horsDouane);

  const base_info = { date_t: dateT, base, hors_douane: horsDouane, apport_xof: apport, jalons: delais, jalons_dates: jalons, notes: note };
  if (incomplet.length > 0) {
    return { ...base_info, incomplet, flux: [], periodes: [], sans: null, avec: null, synthese: null, alertes: [], commentaire: [] };
  }

  // ---------------------------------------------------------------- flux
  const flux = [];
  let seq = 0;
  const poser = (f) => flux.push({ id: ++seq, scenario: "BASE", ...f, montant: ARR(f.montant) });

  // Encaissements du client
  const montantVente = base === "TTC" ? num(vente.ttc, num(vente.ht) + num(vente.tva)) : num(vente.ht);
  for (const l of vente.echeancier) {
    const date = ajouterJours(jalons[l.evenement], Number(l.jours) || 0);
    poser({
      date,
      sens: "ENTREE",
      categorie: "CLIENT",
      libelle: `${vente.client_nom ? vente.client_nom + " : " : ""}${l.pourcentage} %`,
      montant: (montantVente * Number(l.pourcentage)) / 100,
      evenement: l.evenement,
      jours: Number(l.jours) || 0,
      part_pct: Number(l.pourcentage),
    });
  }

  // Decaissements fournisseurs + frais de paiement au prorata
  const totalAchats = achats.reduce((s, a) => s + num(a.montant_xof), 0);
  const fraisPaiementTotal = num(entree.frais && entree.frais.frais_paiement);
  for (const a of achats) {
    const part = totalAchats > 0 ? num(a.montant_xof) / totalAchats : 0;
    for (const l of a.echeancier) {
      const date = ajouterJours(jalons[l.evenement], Number(l.jours) || 0);
      poser({
        date,
        sens: "SORTIE",
        categorie: "FOURNISSEUR",
        libelle: `${T.fo(a.fournisseur_nom || "")} : ${l.pourcentage} %`,
        montant: (num(a.montant_xof) * Number(l.pourcentage)) / 100,
        evenement: l.evenement,
        jours: Number(l.jours) || 0,
        part_pct: Number(l.pourcentage),
      });
      if (fraisPaiementTotal > 0) {
        poser({
          date,
          sens: "SORTIE",
          categorie: "FRAIS_PAIEMENT",
          libelle: `${T.frais_paiement} (${a.fournisseur_nom || ""})`,
          montant: (fraisPaiementTotal * part * Number(l.pourcentage)) / 100,
          evenement: l.evenement,
          jours: Number(l.jours) || 0,
        });
      }
    }
  }

  // Frais d'approche
  const f = entree.frais || {};
  if (num(f.fret) > 0) poser({ date: jalons.EXPEDITION, sens: "SORTIE", categorie: "APPROCHE", libelle: T.fret, montant: num(f.fret), evenement: "EXPEDITION", jours: 0 });
  if (num(f.assurance) > 0) poser({ date: jalons.EXPEDITION, sens: "SORTIE", categorie: "APPROCHE", libelle: T.assurance, montant: num(f.assurance), evenement: "EXPEDITION", jours: 0 });
  if (num(f.transit) > 0) poser({ date: jalons.ARRIVEE, sens: "SORTIE", categorie: "APPROCHE", libelle: T.transit, montant: num(f.transit), evenement: "ARRIVEE", jours: 0 });
  if (!horsDouane) {
    if (num(f.droits_douane) > 0) poser({ date: jalons.ARRIVEE, sens: "SORTIE", categorie: "DOUANE", libelle: T.droits, montant: num(f.droits_douane), evenement: "ARRIVEE", jours: 0 });
    if (base === "TTC" && num(f.tva_import) > 0) poser({ date: jalons.ARRIVEE, sens: "SORTIE", categorie: "DOUANE", libelle: T.tva_import, montant: num(f.tva_import), evenement: "ARRIVEE", jours: 0 });
  }

  // Autres flux saisis
  for (const a of Array.isArray(entree.autres) ? entree.autres : []) {
    const montant = num(a.montant);
    if (!(montant > 0)) continue;
    let date = parseDate(a.date) ? String(a.date).slice(0, 10) : null;
    let evenement = null;
    let jours = 0;
    if (!date && a.evenement && jalons[a.evenement]) {
      evenement = a.evenement;
      jours = Math.max(0, Math.round(num(a.jours, 0)));
      date = ajouterJours(jalons[evenement], jours);
    }
    if (!date) date = dateT;
    poser({ date, sens: a.sens === "ENTREE" ? "ENTREE" : "SORTIE", categorie: "AUTRE", libelle: String(a.libelle || "").slice(0, 120) || "—", montant, evenement, jours });
  }

  // ---------------------------------------------------------------- financement
  const fin = entree.financement || null;
  const alertes = [];
  let financementInfo = null;
  const fluxFin = [];
  if (fin && fin.releve) {
    const r = fin.releve;
    const tot = r.totaux || {};
    let datePrise = parseDate(fin.date_prise) ? String(fin.date_prise).slice(0, 10) : null;
    let dateEch = parseDate(fin.date_echeance) ? String(fin.date_echeance).slice(0, 10) : null;
    const dureeSim = Math.max(1, Math.round(num(fin.duree_jours, r.duree_jours || 30)));
    let parDefaut = false;
    if (!datePrise) {
      datePrise = dateT;
      parDefaut = true;
    }
    if (!dateEch) {
      dateEch = ajouterJours(datePrise, dureeSim);
      parDefaut = true;
    }
    const famille = r.famille || fin.famille || "PRET";
    const avance = num(r.avance_montant);
    const fluxPrise = num(tot.flux_mise_en_place);
    const aPayer = num(tot.a_payer_echeance);
    const retenueDeduite = num(tot.retenue_deduite);
    const sortieEch = avance + aPayer - retenueDeduite;
    const libelleFin = fin.libelle || r.libelle || fin.type_facilite || "";
    if (Math.abs(fluxPrise) > 0.5) {
      fluxFin.push({ date: datePrise, sens: fluxPrise >= 0 ? "ENTREE" : "SORTIE", categorie: "FINANCEMENT", libelle: famille === "GARANTIE" ? T.garantie_frais : T.deblocage, montant: Math.abs(fluxPrise), evenement: null, jours: 0 });
    }
    if (Math.abs(sortieEch) > 0.5) {
      fluxFin.push({ date: dateEch, sens: sortieEch >= 0 ? "SORTIE" : "ENTREE", categorie: "FINANCEMENT", libelle: famille === "GARANTIE" ? T.garantie_echeance : T.remboursement, montant: Math.abs(sortieEch), evenement: null, jours: 0 });
    }
    financementInfo = {
      libelle: libelleFin,
      banque: r.partenaire_nom || fin.banque || "",
      type_facilite: r.type_facilite || fin.type_facilite,
      famille,
      montant_demande: num(fin.montant),
      avance_montant: ARR(avance),
      date_prise: datePrise,
      date_echeance: dateEch,
      duree_jours: ecartJours(datePrise, dateEch),
      cout_ttc: ARR(num(tot.cout_ttc)),
      flux_mise_en_place: ARR(fluxPrise),
      sortie_echeance: ARR(sortieEch),
      par_defaut: parDefaut,
    };
    if (parDefaut) alertes.push({ code: "DATES_PAR_DEFAUT", niveau: "INFO", texte: T.dateParDefaut });
    for (const x of fluxFin) poser({ ...x, scenario: "FINANCEMENT" });
  } else {
    alertes.push({ code: "SANS_FINANCEMENT", niveau: "INFO", texte: T.sansFinancement });
  }

  // ---------------------------------------------------------------- series
  // Tri chronologique (sorties avant entrees a date egale, pour l'affichage du detail).
  const tries = [...flux].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sens === b.sens ? a.id - b.id : a.sens === "SORTIE" ? -1 : 1));
  function serie(inclureFinancement) {
    let solde = apport;
    let min = apport;
    let dateMin = dateT;
    const points = [{ date: dateT, solde: ARR(solde), libelle: apport > 0 ? T.apport : null }];
    // Un seul point par date : les flux d'une meme journee se compensent (le solde est lu en fin de journee).
    const parDate = new Map();
    for (const x of tries) {
      if (x.scenario === "FINANCEMENT" && !inclureFinancement) continue;
      parDate.set(x.date, (parDate.get(x.date) || 0) + (x.sens === "ENTREE" ? x.montant : -x.montant));
    }
    for (const [date, net] of parDate) {
      solde += net;
      points.push({ date, solde: ARR(solde) });
      if (solde < min - 1e-9) {
        min = solde;
        dateMin = date;
      }
    }
    const premierNegatif = points.find((p) => p.solde < -0.5);
    return {
      points,
      solde_min: ARR(min),
      date_min: dateMin,
      besoin_max: ARR(Math.max(0, -min)),
      premier_negatif: premierNegatif ? premierNegatif.date : null,
      solde_final: ARR(solde),
    };
  }
  const sans = serie(false);
  const avec = financementInfo ? serie(true) : null;

  // ---------------------------------------------------------------- synthese
  const base_flux = tries.filter((x) => x.scenario === "BASE");
  const sorties = base_flux.filter((x) => x.sens === "SORTIE");
  const entrees = base_flux.filter((x) => x.sens === "ENTREE");
  const premierDecaissement = sorties.length ? sorties[0].date : dateT;
  const dernierEncaissement = entrees.length ? entrees[entrees.length - 1].date : premierDecaissement;
  const portage = Math.max(0, ecartJours(premierDecaissement, dernierEncaissement));
  const dernierFlux = tries.length ? tries[tries.length - 1].date : dateT;
  const fin_plan = ajouterJours(dernierFlux > dernierEncaissement ? dernierFlux : dernierEncaissement, Math.max(0, Math.round(num(entree.marge_jours, 15))));
  const horizon = ecartJours(dateT, fin_plan);

  const synthese = {
    besoin_max: sans.besoin_max,
    date_besoin_max: sans.besoin_max > 0 ? sans.date_min : null,
    jour_besoin_max: sans.besoin_max > 0 ? ecartJours(dateT, sans.date_min) : null,
    premier_decaissement: premierDecaissement,
    dernier_encaissement: dernierEncaissement,
    portage_jours: portage,
    horizon_jours: horizon,
    date_fin: fin_plan,
    total_encaissements: ARR(base_flux.filter((x) => x.sens === "ENTREE").reduce((s, x) => s + x.montant, 0)),
    total_decaissements: ARR(base_flux.filter((x) => x.sens === "SORTIE").reduce((s, x) => s + x.montant, 0)),
    solde_final_sans: sans.solde_final,
    solde_final_avec: avec ? avec.solde_final : null,
    cout_financement: financementInfo ? financementInfo.cout_ttc : null,
    point_bas_avec: avec ? avec.solde_min : null,
    financement_couvre: avec ? avec.solde_min >= -0.5 : null,
  };

  // ---------------------------------------------------------------- alertes
  if (financementInfo && avec) {
    if (avec.solde_min < -0.5) alertes.push({ code: "FINANCEMENT_INSUFFISANT", niveau: "ALERTE", texte: T.insuffisant(avec.solde_min, avec.date_min) });
    if (financementInfo.famille !== "GARANTIE" && sans.besoin_max > 0 && financementInfo.avance_montant > sans.besoin_max * 1.3) {
      alertes.push({ code: "FINANCEMENT_TROP_ELEVE", niveau: "ATTENTION", texte: T.tropEleve(financementInfo.avance_montant, sans.besoin_max) });
    }
    if (financementInfo.famille !== "GARANTIE" && sans.premier_negatif && financementInfo.date_prise > sans.premier_negatif) {
      alertes.push({ code: "PRISE_TARDIVE", niveau: "ALERTE", texte: T.priseTardive(sans.premier_negatif, financementInfo.date_prise) });
    }
    if (financementInfo.famille !== "GARANTIE" && entrees.length && financementInfo.date_echeance < dernierEncaissement) {
      alertes.push({ code: "ECHEANCE_AVANT_ENCAISSEMENT", niveau: "ATTENTION", texte: T.echeanceAvantEncaissement(financementInfo.date_echeance, dernierEncaissement) });
    }
    if (financementInfo.famille !== "GARANTIE" && financementInfo.duree_jours < portage - 1) {
      alertes.push({ code: "DUREE_COURTE", niveau: "ATTENTION", texte: T.dureeCourte(financementInfo.duree_jours, portage) });
    }
  }

  // ---------------------------------------------------------------- periodes
  let pas = entree.pas && ["JOUR", "SEMAINE", "MOIS"].includes(entree.pas) ? entree.pas : null;
  if (!pas) pas = horizon <= 21 ? "JOUR" : horizon <= 120 ? "SEMAINE" : "MOIS";
  const bornes = [];
  if (pas === "JOUR") {
    for (let d = 0; d <= horizon; d++) bornes.push({ debut: ajouterJours(dateT, d), fin: ajouterJours(dateT, d) });
  } else if (pas === "SEMAINE") {
    for (let d = 0; d <= horizon; d += 7) bornes.push({ debut: ajouterJours(dateT, d), fin: ajouterJours(dateT, Math.min(d + 6, horizon)) });
  } else {
    // mois glissants de 30 jours a partir de T (T+0..T+29, T+30..T+59...)
    for (let d = 0; d <= horizon; d += 30) bornes.push({ debut: ajouterJours(dateT, d), fin: ajouterJours(dateT, Math.min(d + 29, horizon)) });
  }
  function soldeAvant(points, date) {
    let s = apport;
    for (const p of points) {
      if (p.date < date) s = p.solde;
      else break;
    }
    return s;
  }
  const ptsSans = sans.points;
  const ptsAvec = avec ? avec.points : null;
  const periodes = bornes.map((b, i) => {
    const dans = tries.filter((x) => x.date >= b.debut && x.date <= b.fin);
    const e = dans.filter((x) => x.sens === "ENTREE" && x.scenario === "BASE").reduce((s, x) => s + x.montant, 0);
    const sOut = dans.filter((x) => x.sens === "SORTIE" && x.scenario === "BASE").reduce((s, x) => s + x.montant, 0);
    const eFin = dans.filter((x) => x.scenario === "FINANCEMENT" && x.sens === "ENTREE").reduce((s, x) => s + x.montant, 0);
    const sFin = dans.filter((x) => x.scenario === "FINANCEMENT" && x.sens === "SORTIE").reduce((s, x) => s + x.montant, 0);
    const minPeriode = (pts) => {
      let m = soldeAvant(pts, b.debut);
      for (const p of pts) if (p.date >= b.debut && p.date <= b.fin && p.solde < m) m = p.solde;
      return ARR(m);
    };
    const row = {
      indice: i,
      debut: b.debut,
      fin: b.fin,
      jour_debut: ecartJours(dateT, b.debut),
      jour_fin: ecartJours(dateT, b.fin),
      encaissements: ARR(e),
      decaissements: ARR(sOut),
      financement_entrees: ARR(eFin),
      financement_sorties: ARR(sFin),
      ouverture_sans: ARR(soldeAvant(ptsSans, b.debut)),
      cloture_sans: ARR(soldeAvant(ptsSans, ajouterJours(b.fin, 1))),
      min_sans: minPeriode(ptsSans),
      ouverture_avec: ptsAvec ? ARR(soldeAvant(ptsAvec, b.debut)) : null,
      cloture_avec: ptsAvec ? ARR(soldeAvant(ptsAvec, ajouterJours(b.fin, 1))) : null,
      min_avec: ptsAvec ? minPeriode(ptsAvec) : null,
    };
    return row;
  });

  // ---------------------------------------------------------------- commentaire
  const commentaire = [];
  if (sans.besoin_max > 0) commentaire.push(T.c_besoin(sans.besoin_max, sans.date_min, ecartJours(dateT, sans.date_min)));
  else commentaire.push(T.c_aucun);
  commentaire.push(T.c_portage(portage, premierDecaissement, dernierEncaissement));
  if (financementInfo && avec) commentaire.push(T.c_ligne(financementInfo.libelle || financementInfo.type_facilite, financementInfo.cout_ttc, avec.solde_min >= -0.5));
  commentaire.push(T.c_final(avec ? avec.solde_final : sans.solde_final));

  return {
    ...base_info,
    incomplet: [],
    flux: tries.map((x) => ({ ...x, jour: ecartJours(dateT, x.date) })),
    financement: financementInfo,
    sans: { ...sans },
    avec: avec ? { ...avec } : null,
    periodes,
    pas,
    synthese,
    alertes,
    commentaire,
  };
}

module.exports = { construirePlan, calculerJalons, JALONS_DEFAUT, ajouterJours, ecartJours };
