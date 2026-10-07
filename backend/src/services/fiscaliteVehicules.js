/**
 * Module Fiscalite, lot 5 : taxe speciale sur les voitures particulieres des personnes morales (CGI art. 550 a 554).
 *
 *  - assujettis : voitures particulieres (Code de la route) detenues, utilisees ou entretenues au Senegal par des societes ;
 *  - tarif annuel selon la puissance fiscale : <= 4 CV 50 000 F ; 5 a 11 CV 100 000 F ; > 11 CV 200 000 F ;
 *  - liquidation par TRIMESTRE civil : un quart du tarif annuel par vehicule detenu pendant une duree quelconque du trimestre ;
 *  - vehicules pris en location : liquidation distincte par categorie de puissance, un quart du tarif multiplie par le nombre de
 *    periodes de 90 jours de la duree totale des locations du trimestre (une fraction superieure a 15 jours compte pour une periode) ;
 *  - exonerations : negociants (vente / essais, 3 mois), transport public (taxis), auto-ecoles, competitions sportives, location sans chauffeur ;
 *  - declaration et paiement avant le 1er fevrier de l'annee suivante (art. 553-554) ; la taxe n'est pas deductible du resultat (art. 9-7).
 * Les vehicules viennent d'un tableau propre au module (puissance et categorie y sont portees) alimente depuis le Parc auto
 * de la plateforme si le client l'utilise.
 */
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { FiscaliteError } = require("./fiscaliteTva");
const dossiers = require("./fiscaliteDossierAnnuel");

const num = (v) => Number(v || 0);
const arrondi = (v) => Math.round(num(v));

const TARIFS = [
  { classe: "CV_4_MAX", libelle_cle: "VEH_CLASSE_1", max: 4, annuel: 50000 },
  { classe: "CV_5_11", libelle_cle: "VEH_CLASSE_2", max: 11, annuel: 100000 },
  { classe: "CV_12_PLUS", libelle_cle: "VEH_CLASSE_3", max: 999, annuel: 200000 },
];
const MODES = ["PROPRIETE", "LOCATION", "AUTRE"];
const EXONERATIONS = ["NEGOCIANT", "TRANSPORT_PUBLIC", "AUTO_ECOLE", "COMPETITION", "LOCATION_SANS_CHAUFFEUR"];

const classeDe = (cv) => TARIFS.find((t) => cv <= t.max);

function validerAnnee(annee) {
  const a = Number(annee);
  if (!Number.isInteger(a) || a < 2000 || a > 2100) throw new FiscaliteError("FISCALITE_PERIODE_INVALIDE");
  return a;
}

const dateOuNull = (v) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
  return v;
};
const dateIso = (d) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);

function nettoyerVehicule(c) {
  const immat = String((c && c.immatriculation) || "").trim().toUpperCase().slice(0, 30);
  if (!immat) throw new FiscaliteError("FISCALITE_VEHICULE_INVALIDE");
  let cv = null;
  if (c.puissance_cv !== undefined && c.puissance_cv !== null && c.puissance_cv !== "") {
    cv = Number(c.puissance_cv);
    if (!Number.isInteger(cv) || cv < 1 || cv > 99) throw new FiscaliteError("FISCALITE_VEHICULE_INVALIDE");
  }
  const debut = dateOuNull(c.date_debut);
  const fin = dateOuNull(c.date_fin);
  if (debut && fin && fin < debut) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
  return {
    parc_vehicule_id: c.parc_vehicule_id || null,
    immatriculation: immat,
    marque_modele: String(c.marque_modele || "").trim().slice(0, 100) || null,
    puissance_cv: cv,
    categorie: c.categorie === "AUTRE" ? "AUTRE" : "VP",
    mode_detention: MODES.includes(c.mode_detention) ? c.mode_detention : "PROPRIETE",
    date_debut: debut,
    date_fin: fin,
    exoneration: EXONERATIONS.includes(c.exoneration) ? c.exoneration : null,
    note: String(c.note || "").trim().slice(0, 500) || null,
  };
}

function versVehicule(x) {
  return {
    id: x.id,
    parc_vehicule_id: x.parc_vehicule_id,
    immatriculation: x.immatriculation,
    marque_modele: x.marque_modele,
    puissance_cv: x.puissance_cv,
    categorie: x.categorie,
    mode_detention: x.mode_detention,
    date_debut: dateIso(x.date_debut),
    date_fin: dateIso(x.date_fin),
    exoneration: x.exoneration,
    note: x.note,
  };
}

async function listerVehicules(tenantId) {
  const r = await db.query(`SELECT * FROM fiscalite_vehicule WHERE tenant_id = $1 AND actif ORDER BY immatriculation`, [tenantId]);
  return r.rows.map(versVehicule);
}

/** Vehicules du Parc auto pas encore repris dans le tableau fiscal. */
async function suggestionsParcAuto(tenantId) {
  const r = await db.query(
    `SELECT v.id, v.immatriculation, v.marque_modele FROM vehicule v
     WHERE v.tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM fiscalite_vehicule f WHERE f.tenant_id = v.tenant_id AND f.parc_vehicule_id = v.id AND f.actif)
     ORDER BY v.immatriculation`,
    [tenantId]
  );
  return r.rows;
}

async function ajouterVehicule(tenantId, corps) {
  const v = nettoyerVehicule(corps || {});
  if (v.parc_vehicule_id) {
    const ok = await db.query(`SELECT 1 FROM vehicule WHERE id = $1 AND tenant_id = $2`, [v.parc_vehicule_id, tenantId]);
    if (ok.rowCount === 0) throw new FiscaliteError("FISCALITE_VEHICULE_INTROUVABLE", 404);
  }
  const id = uuidv4();
  await db.query(
    `INSERT INTO fiscalite_vehicule (id, tenant_id, parc_vehicule_id, immatriculation, marque_modele, puissance_cv, categorie, mode_detention, date_debut, date_fin, exoneration, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, tenantId, v.parc_vehicule_id, v.immatriculation, v.marque_modele, v.puissance_cv, v.categorie, v.mode_detention, v.date_debut, v.date_fin, v.exoneration, v.note]
  );
  return { id, ...v };
}

async function modifierVehicule(tenantId, id, corps) {
  const v = nettoyerVehicule(corps || {});
  const r = await db.query(
    `UPDATE fiscalite_vehicule SET parc_vehicule_id=$3, immatriculation=$4, marque_modele=$5, puissance_cv=$6, categorie=$7, mode_detention=$8, date_debut=$9, date_fin=$10, exoneration=$11, note=$12, date_modification = now()
     WHERE tenant_id = $1 AND id = $2 AND actif`,
    [tenantId, id, v.parc_vehicule_id, v.immatriculation, v.marque_modele, v.puissance_cv, v.categorie, v.mode_detention, v.date_debut, v.date_fin, v.exoneration, v.note]
  );
  if (r.rowCount === 0) throw new FiscaliteError("FISCALITE_VEHICULE_INTROUVABLE", 404);
  return { id, ...v };
}

async function supprimerVehicule(tenantId, id) {
  const r = await db.query(`UPDATE fiscalite_vehicule SET actif = FALSE, date_modification = now() WHERE tenant_id = $1 AND id = $2 AND actif`, [tenantId, id]);
  if (r.rowCount === 0) throw new FiscaliteError("FISCALITE_VEHICULE_INTROUVABLE", 404);
}

// ---------------------------------------------------------------------------
// Moteur pur
// ---------------------------------------------------------------------------

const TRIMESTRES = (annee) => [
  { n: 1, debut: `${annee}-01-01`, fin: `${annee}-03-31` },
  { n: 2, debut: `${annee}-04-01`, fin: `${annee}-06-30` },
  { n: 3, debut: `${annee}-07-01`, fin: `${annee}-09-30` },
  { n: 4, debut: `${annee}-10-01`, fin: `${annee}-12-31` },
];

const ms = (d) => Date.parse(`${d}T00:00:00Z`);
/** Nombre de jours (bornes incluses) de recouvrement entre la detention du vehicule et un trimestre. */
function joursDansTrimestre(v, t) {
  const debut = v.date_debut && v.date_debut > t.debut ? v.date_debut : t.debut;
  const fin = v.date_fin && v.date_fin < t.fin ? v.date_fin : t.fin;
  if (fin < debut) return 0;
  return Math.round((ms(fin) - ms(debut)) / 86400000) + 1;
}

/** Periodes de 90 jours d'une duree totale de location : une fraction de plus de 15 jours compte pour une periode. */
function periodes90(jours) {
  const entieres = Math.floor(jours / 90);
  const reste = jours - entieres * 90;
  return entieres + (reste > 15 ? 1 : 0);
}

/**
 * Taxe de l'annee `annee` pour une liste de vehicules.
 * @returns {{vehicules: object[], trimestres: object[], total: number}}
 */
function moteur(vehicules, annee) {
  const trimestres = TRIMESTRES(annee);
  const lignes = [];
  const parTrimestre = trimestres.map((t) => ({ trimestre: t.n, debut: t.debut, fin: t.fin, montant: 0, details: [] }));

  for (const v of vehicules) {
    const base = { id: v.id, immatriculation: v.immatriculation, marque_modele: v.marque_modele, puissance_cv: v.puissance_cv, mode_detention: v.mode_detention };
    if (v.categorie !== "VP") {
      lignes.push({ ...base, assujetti: false, motif: "HORS_CATEGORIE", classe: null, trimestres: [], taxe: 0 });
      continue;
    }
    if (v.exoneration) {
      lignes.push({ ...base, assujetti: false, motif: `EXONERE_${v.exoneration}`, classe: null, trimestres: [], taxe: 0 });
      continue;
    }
    if (v.puissance_cv === null || v.puissance_cv === undefined) {
      lignes.push({ ...base, assujetti: true, motif: "PUISSANCE_ABSENTE", classe: null, trimestres: [], taxe: 0 });
      continue;
    }
    const classe = classeDe(v.puissance_cv);
    const detail = trimestres.map((t) => {
      const jours = joursDansTrimestre(v, t);
      if (v.mode_detention === "LOCATION") return { trimestre: t.n, jours, montant: 0 };
      return { trimestre: t.n, jours, montant: jours > 0 ? classe.annuel / 4 : 0 };
    });
    lignes.push({ ...base, assujetti: true, motif: null, classe: classe.classe, trimestres: detail, taxe: detail.reduce((s, x) => s + x.montant, 0), jours_location: null });
  }

  // Vehicules detenus (propriete / autre) : un quart du tarif par trimestre
  for (const l of lignes) {
    for (const t of l.trimestres) {
      if (t.montant > 0) {
        parTrimestre[t.trimestre - 1].montant += t.montant;
        parTrimestre[t.trimestre - 1].details.push({ type: "DETENU", classe: l.classe, immatriculation: l.immatriculation, montant: t.montant });
      }
    }
  }

  // Locations : liquidation distincte par categorie de puissance, duree totale des locations du trimestre
  const locations = vehicules.filter((v) => v.categorie === "VP" && !v.exoneration && v.mode_detention === "LOCATION" && v.puissance_cv !== null && v.puissance_cv !== undefined);
  const classesLocation = [];
  for (const tarif of TARIFS) {
    const deClasse = locations.filter((v) => classeDe(v.puissance_cv).classe === tarif.classe);
    if (deClasse.length === 0) continue;
    for (const t of trimestres) {
      const jours = deClasse.reduce((s, v) => s + joursDansTrimestre(v, t), 0);
      if (jours <= 0) continue;
      const p = periodes90(jours);
      const montant = (tarif.annuel / 4) * p;
      classesLocation.push({ trimestre: t.n, classe: tarif.classe, jours, periodes: p, montant });
      parTrimestre[t.n - 1].montant += montant;
      parTrimestre[t.n - 1].details.push({ type: "LOCATION", classe: tarif.classe, jours, periodes: p, montant });
    }
    // Repartition indicative sur les lignes (pas de calcul par vehicule pour les locations : liquidation par categorie)
    for (const l of lignes) {
      if (l.mode_detention === "LOCATION" && l.classe === tarif.classe) l.taxe = null;
    }
  }

  const total = parTrimestre.reduce((s, t) => s + t.montant, 0);
  return { vehicules: lignes, trimestres: parTrimestre, locations: classesLocation, total };
}

// ---------------------------------------------------------------------------
// Calcul de l'annee
// ---------------------------------------------------------------------------

async function calculer(tenantId, annee) {
  const a = validerAnnee(annee);
  const tous = await listerVehicules(tenantId);
  const debutAnnee = `${a}-01-01`;
  const finAnnee = `${a}-12-31`;
  const concernes = tous.filter((v) => !(v.date_fin && v.date_fin < debutAnnee) && !(v.date_debut && v.date_debut > finAnnee));
  const m = moteur(concernes, a);
  const avertissements = [];
  const avert = (code, details = {}) => avertissements.push({ code, ...details });
  if (tous.length === 0) avert("VEH_AUCUN_VEHICULE");
  const sansPuissance = m.vehicules.filter((x) => x.motif === "PUISSANCE_ABSENTE");
  if (sansPuissance.length > 0) avert("VEH_PUISSANCE_ABSENTE", { nombre: sansPuissance.length });
  const sansDate = concernes.filter((v) => v.categorie === "VP" && !v.exoneration && v.mode_detention === "LOCATION" && !v.date_debut);
  if (sansDate.length > 0) avert("VEH_LOCATION_SANS_DATES", { nombre: sansDate.length });
  const suggestions = await suggestionsParcAuto(tenantId);
  if (suggestions.length > 0) avert("VEH_PARC_AUTO_A_REPRENDRE", { nombre: suggestions.length });
  if (m.total > 0) avert("VEH_NON_DEDUCTIBLE", { montant: m.total });
  avert("VEH_CATEGORIE_A_VERIFIER");
  const montant = arrondi(m.total);
  return {
    annee: a,
    vehicules: m.vehicules,
    trimestres: m.trimestres.map((t) => ({ ...t, montant: arrondi(t.montant) })),
    locations: m.locations,
    total: montant,
    montant_du: montant,
    tarifs: TARIFS,
    echeance: `${a + 1}-01-31`,
    suggestions_parc_auto: suggestions,
    saisies: {},
    avertissements,
  };
}

async function listerAnnees(tenantId) {
  const r = await dossiers.listerAnnees(tenantId, "VEHICULES");
  return r.map((d) => ({ annee: d.annee, statut: d.statut, montant_du: d.montant_du, date_depot: d.date_depot, date_paiement: d.date_paiement }));
}

async function getAnnee(tenantId, annee) {
  const a = validerAnnee(annee);
  const dossier = await dossiers.getDossier(tenantId, "VEHICULES", a);
  const gele = !!dossier && (dossier.statut === "DEPOSEE" || dossier.statut === "PAYEE");
  const live = await calculer(tenantId, a);
  const calcul = gele && dossier.calcul ? dossier.calcul : live;
  return { dossier, calcul, vehicules: await listerVehicules(tenantId), live_differe_du_depot: gele && live.montant_du !== calcul.montant_du };
}

async function preparer(tenantId, userId, annee) {
  const a = validerAnnee(annee);
  return dossiers.preparer(tenantId, userId, "VEHICULES", a, await calculer(tenantId, a));
}

const changerStatut = (tenantId, annee, corps) => dossiers.changerStatut(tenantId, "VEHICULES", validerAnnee(annee), corps);

module.exports = {
  TARIFS,
  MODES,
  EXONERATIONS,
  periodes90,
  moteur,
  listerVehicules,
  suggestionsParcAuto,
  ajouterVehicule,
  modifierVehicule,
  supprimerVehicule,
  calculer,
  listerAnnees,
  getAnnee,
  preparer,
  changerStatut,
};
