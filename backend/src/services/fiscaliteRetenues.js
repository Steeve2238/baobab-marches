/**
 * Module Fiscalite, lot 4 : retenues a la source (calcul et etats ; aucune ecriture comptable, aucun reglement modifie).
 *
 *  - PRESTATION_PP   art. 200 : 5 % du montant brut HT des sommes versees a des personnes physiques residentes, quand la facture
 *                    est de 25 000 F ou plus ; pas de retenue si le prestataire est a un regime reel (sauf option) ou est une
 *                    societe soumise a l'IS ; hotels et restaurants exclus ;
 *  - LOYER           art. 201 : 5 % du loyer brut HT, sauf loyer mensuel d'un meme local inferieur a 150 000 F ; pas de retenue
 *                    pour un bailleur personne morale a l'IS ;
 *  - NON_RESIDENT    art. 202 : 25 % du montant net, soit 25 % de (brut moins 20 %) ; conventions internationales reservees ;
 *  - IRVM_*          art. 173 et 203 : dividendes 10 %, creances et interets (dont comptes courants d'associes) 16 %,
 *                    obligations 13 % (6 % si duree d'au moins 5 ans).
 *  Versement : dans les 15 premiers jours du mois suivant (art. 185) ; trimestriel pour le reel simplifie / la CGU, ou si les
 *  retenues mensuelles n'excedent pas 20 000 F (le trimestre entier est du des qu'un mois depasse). Declaration signee (art. 186).
 *  Etat trimestriel des versements a des personnes physiques (art. 200-8).
 * Les operations viennent de la plateforme (reglements fournisseurs : propositions a confirmer ligne par ligne), du compte courant
 * d'associes (module IS), d'une saisie ou d'un fichier Excel. Le module fonctionne seul (fiscalite sans le module Comptabilite).
 */
const db = require("../db");
const comptesSvc = require("./fiscaliteComptes");
const XLSX = require("xlsx");
const { v4: uuidv4 } = require("uuid");
const { FiscaliteError, getProfil, dateLimite } = require("./fiscaliteTva");
const importCompta = require("./comptaImport");

const num = (v) => Number(v || 0);
const arrondi = (v) => Math.round(num(v));
const pad = (n) => String(n).padStart(2, "0");
const dateIso = (d) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d).slice(0, 10));
const texte = (v) => (v === null || v === undefined ? "" : String(v).trim());

const SEUIL_PRESTATION = 25000;
const SEUIL_LOYER_MENSUEL = 150000;
const SEUIL_VERSEMENT_TRIMESTRIEL = 20000;

const TYPES = {
  PRESTATION_PP: { taux: 5, article: "Art. 200", groupe: "PRESTATION" },
  LOYER: { taux: 5, article: "Art. 201", groupe: "LOYER" },
  NON_RESIDENT: { taux: 25, article: "Art. 202", groupe: "NON_RESIDENT", abattement: 20 },
  IRVM_DIVIDENDES: { taux: 10, article: "Art. 173", groupe: "IRVM" },
  IRVM_CREANCES: { taux: 16, article: "Art. 173", groupe: "IRVM" },
  IRVM_OBLIGATIONS: { taux: 13, article: "Art. 173", groupe: "IRVM" },
  IRVM_OBLIGATIONS_LONGUES: { taux: 6, article: "Art. 173", groupe: "IRVM" },
};
const STATUTS_BENEFICIAIRE = ["PP_SANS_REEL", "PP_REEL", "SOCIETE_IS", "NON_RESIDENT", "AUTRE"];
const SOURCES = ["PLATEFORME", "MANUEL", "IMPORT", "CCA", "COMPTA"];
// Comptes analyses par defaut (prefixes) : charge de prestations au brut, loyers, retenue a la source au credit du 447.
// Retenue a payer : 4478 par defaut ; tous ces comptes sont parametrables (fiscaliteComptes.js, ecran Comptes de la fiscalite).
const PARAMETRES_DEFAUT = { comptes_prestations: ["6057", "63"], comptes_loyers: ["622"], comptes_retenue: ["4478"] };

// ---------------------------------------------------------------------------
// Moteur de calcul (pur)
// ---------------------------------------------------------------------------

/** Evalue une operation : retenue due ou non, base, taux, montant, motifs et points d'attention. */
function evaluer(op) {
  const def = TYPES[op.type];
  if (!def) throw new FiscaliteError("FISCALITE_RETENUE_INVALIDE", 400, { champ: "type" });
  const brut = num(op.montant_brut);
  const motifs = [];
  const warnings = [];
  let due = true;
  let taux = def.taux;
  if (op.taux_applique !== null && op.taux_applique !== undefined && op.taux_applique !== "") {
    taux = num(op.taux_applique);
    if (taux !== def.taux) warnings.push("TAUX_MODIFIE");
  }
  let base = brut;
  const statut = op.beneficiaire_statut || "AUTRE";

  if (op.type === "PRESTATION_PP") {
    const facture = op.montant_facture === null || op.montant_facture === undefined || op.montant_facture === "" ? brut : num(op.montant_facture);
    if (statut === "PP_REEL" || statut === "SOCIETE_IS" || statut === "NON_RESIDENT") {
      due = false;
      motifs.push("BENEFICIAIRE_HORS_CHAMP");
    } else if (facture < SEUIL_PRESTATION) {
      due = false;
      motifs.push("SOUS_SEUIL");
    }
  } else if (op.type === "LOYER") {
    const mensuel = op.loyer_mensuel === null || op.loyer_mensuel === undefined || op.loyer_mensuel === "" ? null : num(op.loyer_mensuel);
    if (statut === "SOCIETE_IS") {
      due = false;
      motifs.push("BAILLEUR_IS");
    } else if ((mensuel === null ? brut : mensuel) < SEUIL_LOYER_MENSUEL) {
      due = false;
      motifs.push("SOUS_SEUIL");
    }
    if (mensuel === null) warnings.push("LOYER_MENSUEL_ABSENT");
  } else if (op.type === "NON_RESIDENT") {
    base = Math.round(brut * (100 - def.abattement)) / 100;
    warnings.push("CONVENTION_A_VERIFIER");
  } else {
    warnings.push("IRVM_EXONERATIONS_A_VERIFIER");
  }
  if (due && (op.type === "PRESTATION_PP" || op.type === "LOYER") && !texte(op.beneficiaire_ninea) && !texte(op.beneficiaire_piece)) warnings.push("IDENTITE_ABSENTE");

  const retenue = due ? arrondi((base * taux) / 100) : 0;
  const effectuee = op.retenue_effectuee === null || op.retenue_effectuee === undefined || op.retenue_effectuee === "" ? null : num(op.retenue_effectuee);
  let ecart = null;
  if (effectuee !== null) {
    ecart = effectuee - retenue;
    if (due && Math.abs(ecart) > 1) warnings.push("ECART_RETENUE_EFFECTUEE");
    if (!due && effectuee > 0) warnings.push("RETENUE_SANS_OBLIGATION");
  }
  return { due, base: arrondi(base), taux, retenue, motifs, warnings, retenue_effectuee: effectuee, ecart };
}

// ---------------------------------------------------------------------------
// Operations (CRUD)
// ---------------------------------------------------------------------------

function periodeValide(annee, mois) {
  const a = Number(annee);
  const m = Number(mois);
  if (!Number.isInteger(a) || a < 2000 || a > 2100 || !Number.isInteger(m) || m < 1 || m > 12) throw new FiscaliteError("FISCALITE_PERIODE_INVALIDE");
  return { annee: a, mois: m, debut: `${a}-${pad(m)}-01`, fin: `${a}-${pad(m)}-${pad(new Date(Date.UTC(a, m, 0)).getUTCDate())}` };
}

function montantOuNull(v, champ, { entier = true } = {}) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new FiscaliteError("FISCALITE_MONTANT_INVALIDE", 400, { champ });
  return entier ? Math.round(n) : Math.round(n * 100) / 100;
}

function nettoyer(corps) {
  const c = corps || {};
  if (!TYPES[c.type]) throw new FiscaliteError("FISCALITE_RETENUE_INVALIDE", 400, { champ: "type" });
  if (typeof c.date_operation !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(c.date_operation)) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
  const nom = texte(c.beneficiaire_nom).slice(0, 200);
  if (!nom) throw new FiscaliteError("FISCALITE_RETENUE_INVALIDE", 400, { champ: "beneficiaire_nom" });
  const brut = montantOuNull(c.montant_brut, "montant_brut");
  if (brut === null) throw new FiscaliteError("FISCALITE_MONTANT_INVALIDE", 400, { champ: "montant_brut" });
  const statutBenef = c.beneficiaire_statut || (c.type === "NON_RESIDENT" ? "NON_RESIDENT" : c.type === "PRESTATION_PP" ? "PP_SANS_REEL" : "AUTRE");
  if (!STATUTS_BENEFICIAIRE.includes(statutBenef)) throw new FiscaliteError("FISCALITE_RETENUE_INVALIDE", 400, { champ: "beneficiaire_statut" });
  const taux = montantOuNull(c.taux_applique, "taux_applique", { entier: false });
  if (taux !== null && taux > 100) throw new FiscaliteError("FISCALITE_MONTANT_INVALIDE", 400, { champ: "taux_applique" });
  const statut = ["PROPOSEE", "CONFIRMEE", "EXCLUE"].includes(c.statut) ? c.statut : "CONFIRMEE";
  return {
    type: c.type,
    date_operation: c.date_operation,
    beneficiaire_nom: nom,
    beneficiaire_ninea: texte(c.beneficiaire_ninea).replace(/\s/g, "").slice(0, 30) || null,
    beneficiaire_adresse: texte(c.beneficiaire_adresse).slice(0, 300) || null,
    beneficiaire_profession: texte(c.beneficiaire_profession).slice(0, 120) || null,
    beneficiaire_piece: texte(c.beneficiaire_piece).slice(0, 200) || null,
    beneficiaire_statut: statutBenef,
    reference: texte(c.reference).slice(0, 100) || null,
    libelle: texte(c.libelle).slice(0, 300) || null,
    montant_brut: brut,
    montant_facture: montantOuNull(c.montant_facture, "montant_facture"),
    loyer_mensuel: montantOuNull(c.loyer_mensuel, "loyer_mensuel"),
    taux_applique: taux,
    retenue_effectuee: montantOuNull(c.retenue_effectuee, "retenue_effectuee"),
    statut,
    motif_exclusion: texte(c.motif_exclusion).slice(0, 300) || null,
  };
}

function versOperation(row) {
  const op = {
    id: row.id,
    type: row.type,
    date_operation: dateIso(row.date_operation),
    beneficiaire_nom: row.beneficiaire_nom,
    beneficiaire_ninea: row.beneficiaire_ninea,
    beneficiaire_adresse: row.beneficiaire_adresse,
    beneficiaire_profession: row.beneficiaire_profession,
    beneficiaire_piece: row.beneficiaire_piece,
    beneficiaire_statut: row.beneficiaire_statut,
    reference: row.reference,
    libelle: row.libelle,
    montant_brut: num(row.montant_brut),
    montant_facture: row.montant_facture === null ? null : num(row.montant_facture),
    loyer_mensuel: row.loyer_mensuel === null ? null : num(row.loyer_mensuel),
    taux_applique: row.taux_applique === null ? null : num(row.taux_applique),
    retenue_effectuee: row.retenue_effectuee === null ? null : num(row.retenue_effectuee),
    statut: row.statut,
    motif_exclusion: row.motif_exclusion,
    source: row.source,
    source_ref: row.source_ref,
    controle: row.controle_json || null,
  };
  op.calcul = evaluer(op);
  return op;
}

async function periodeVerrouillee(tenantId, dateOperation) {
  const [a, m] = [Number(dateOperation.slice(0, 4)), Number(dateOperation.slice(5, 7))];
  const r = await db.query(`SELECT statut FROM fiscalite_retenue_periode WHERE tenant_id = $1 AND annee = $2 AND mois = $3`, [tenantId, a, m]);
  return !!(r.rows[0] && (r.rows[0].statut === "DEPOSEE" || r.rows[0].statut === "PAYEE"));
}

async function lister(tenantId, annee, mois) {
  const p = periodeValide(annee, mois);
  const r = await db.query(
    `SELECT * FROM fiscalite_retenue WHERE tenant_id = $1 AND date_operation BETWEEN $2 AND $3 ORDER BY date_operation, beneficiaire_nom, date_creation`,
    [tenantId, p.debut, p.fin]
  );
  return r.rows.map(versOperation);
}

async function creer(tenantId, userId, corps, { source = "MANUEL", source_ref = null, controle = null } = {}) {
  const o = nettoyer(corps);
  if (await periodeVerrouillee(tenantId, o.date_operation)) throw new FiscaliteError("FISCALITE_DECLARATION_DEJA_DEPOSEE", 409);
  const id = uuidv4();
  await db.query(
    `INSERT INTO fiscalite_retenue (id, tenant_id, type, date_operation, beneficiaire_nom, beneficiaire_ninea, beneficiaire_adresse, beneficiaire_profession, beneficiaire_piece,
       beneficiaire_statut, reference, libelle, montant_brut, montant_facture, loyer_mensuel, taux_applique, retenue_effectuee, statut, motif_exclusion, source, source_ref, cree_par, controle_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    [id, tenantId, o.type, o.date_operation, o.beneficiaire_nom, o.beneficiaire_ninea, o.beneficiaire_adresse, o.beneficiaire_profession, o.beneficiaire_piece, o.beneficiaire_statut,
      o.reference, o.libelle, o.montant_brut, o.montant_facture, o.loyer_mensuel, o.taux_applique, o.retenue_effectuee, o.statut, o.motif_exclusion, source, source_ref, userId, controle ? JSON.stringify(controle) : null]
  );
  return getOperation(tenantId, id);
}

async function getOperation(tenantId, id) {
  const r = await db.query(`SELECT * FROM fiscalite_retenue WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!r.rows[0]) throw new FiscaliteError("FISCALITE_RETENUE_INTROUVABLE", 404);
  return versOperation(r.rows[0]);
}

async function modifier(tenantId, id, corps) {
  const ancienne = await getOperation(tenantId, id);
  if (await periodeVerrouillee(tenantId, ancienne.date_operation)) throw new FiscaliteError("FISCALITE_DECLARATION_DEJA_DEPOSEE", 409);
  const o = nettoyer({ ...ancienne, ...(corps || {}) });
  if (o.date_operation !== ancienne.date_operation && (await periodeVerrouillee(tenantId, o.date_operation))) throw new FiscaliteError("FISCALITE_DECLARATION_DEJA_DEPOSEE", 409);
  await db.query(
    `UPDATE fiscalite_retenue SET type=$3, date_operation=$4, beneficiaire_nom=$5, beneficiaire_ninea=$6, beneficiaire_adresse=$7, beneficiaire_profession=$8, beneficiaire_piece=$9,
       beneficiaire_statut=$10, reference=$11, libelle=$12, montant_brut=$13, montant_facture=$14, loyer_mensuel=$15, taux_applique=$16, retenue_effectuee=$17, statut=$18,
       motif_exclusion=$19, date_modification = now()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, o.type, o.date_operation, o.beneficiaire_nom, o.beneficiaire_ninea, o.beneficiaire_adresse, o.beneficiaire_profession, o.beneficiaire_piece, o.beneficiaire_statut,
      o.reference, o.libelle, o.montant_brut, o.montant_facture, o.loyer_mensuel, o.taux_applique, o.retenue_effectuee, o.statut, o.motif_exclusion]
  );
  return getOperation(tenantId, id);
}

async function supprimer(tenantId, id) {
  const op = await getOperation(tenantId, id);
  if (await periodeVerrouillee(tenantId, op.date_operation)) throw new FiscaliteError("FISCALITE_DECLARATION_DEJA_DEPOSEE", 409);
  // Une proposition issue de la plateforme n'est pas effacee : elle est marquee exclue pour ne pas etre re-proposee.
  if (op.source === "PLATEFORME" || op.source === "CCA" || op.source === "COMPTA") {
    await db.query(`UPDATE fiscalite_retenue SET statut = 'EXCLUE', motif_exclusion = COALESCE(motif_exclusion, 'Supprimée'), date_modification = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  } else {
    await db.query(`DELETE FROM fiscalite_retenue WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  }
}

// ---------------------------------------------------------------------------
// Propositions : reglements fournisseurs de la plateforme et interets de comptes courants d'associes
// ---------------------------------------------------------------------------

/** Comptes analyses (prefixes de comptes) : valeurs du client, sinon valeurs par defaut. */
async function getParametres(tenantId) {
  const c = await comptesSvc.getComptes(tenantId);
  return { comptes_prestations: c.RET_PRESTATIONS, comptes_loyers: c.RET_LOYERS, comptes_retenue: c.RET_A_PAYER, comptes_tva: c.TVA_RECUPERABLE };
}

const listePrefixes = comptesSvc.listePrefixes;

async function enregistrerParametres(tenantId, corps) {
  const c = corps || {};
  const saisie = {};
  if (c.comptes_prestations !== undefined) saisie.RET_PRESTATIONS = c.comptes_prestations;
  if (c.comptes_loyers !== undefined) saisie.RET_LOYERS = c.comptes_loyers;
  if (c.comptes_retenue !== undefined) saisie.RET_A_PAYER = c.comptes_retenue;
  await comptesSvc.enregistrer(tenantId, saisie);
  return getParametres(tenantId);
}

/** Nombre de lignes non exclues d'une autre origine sur le mois (evite de proposer deux fois la meme depense). */
async function autreSourcePresente(tenantId, periode, source) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM fiscalite_retenue WHERE tenant_id = $1 AND source = $2 AND statut <> 'EXCLUE' AND date_operation BETWEEN $3 AND $4`,
    [tenantId, source, periode.debut, periode.fin]
  );
  return r.rows[0].n;
}

const PAYS_LOCAUX = new Set(["", "sn", "sen", "senegal", "sénégal"]);
const estLocal = (pays) => PAYS_LOCAUX.has(String(pays || "").trim().toLowerCase());

/**
 * Cherche dans les reglements fournisseurs du mois les paiements qui pourraient donner lieu a retenue et les enregistre comme
 * PROPOSEE (une seule fois par imputation). Rien n'est retenu sans confirmation de l'utilisateur : la plateforme ne sait pas
 * distinguer une prestation d'une livraison de marchandises.
 *  - fournisseur etranger, facture locale (pas d'importation douaniere) : candidat non-resident ;
 *  - fournisseur local a la CGU ou au regime non renseigne : candidat prestataire personne physique (art. 200).
 */
async function rechercherPropositionsPlateforme(tenantId, userId, annee, mois) {
  const p = periodeValide(annee, mois);
  if (await periodeVerrouillee(tenantId, p.debut)) throw new FiscaliteError("FISCALITE_DECLARATION_DEJA_DEPOSEE", 409);
  // Une meme depense ne doit pas etre proposee deux fois (comptabilite et reglements) : on s'arrete si la comptabilite a deja propose.
  const doublon = await autreSourcePresente(tenantId, p, "COMPTA");
  if (doublon > 0) return { crees: 0, ignores: 0, analyses: 0, bloque: "COMPTA_PRESENTE", nombre: doublon };
  const r = await db.query(
    `SELECT i.id AS imputation_id, i.montant AS montant_impute, rc.date_reglement, rc.numero AS numero_reglement,
            f.numero AS numero_facture, f.reference_fournisseur, f.libelle, f.montant_ht, f.montant_ttc, f.tva_type_operation,
            t.nom AS tiers_nom, fo.nom AS fournisseur_nom, fo.pays, fo.ninea, fo.regime_fiscal
     FROM reglement_fournisseur_imputation i
     JOIN reglement_fournisseur rc ON rc.id = i.reglement_id AND rc.statut = 'ENREGISTRE'
     JOIN facture_fournisseur f ON f.id = i.facture_id AND f.statut = 'ENREGISTREE'
     JOIN tiers_comptable t ON t.id = f.tiers_id
     JOIN fournisseur fo ON fo.id = t.fournisseur_id
     WHERE i.tenant_id = $1 AND rc.date_reglement BETWEEN $2 AND $3
     ORDER BY rc.date_reglement, f.numero`,
    [tenantId, p.debut, p.fin]
  );
  let crees = 0;
  let ignores = 0;
  for (const x of r.rows) {
    const local = estLocal(x.pays);
    let type = null;
    if (!local && x.tva_type_operation !== "IMPORT") type = "NON_RESIDENT";
    else if (local && (x.regime_fiscal === "CGU" || x.regime_fiscal === "NON_RENSEIGNE")) type = "PRESTATION_PP";
    if (!type) {
      ignores++;
      continue;
    }
    const ttc = num(x.montant_ttc);
    const brut = ttc > 0 ? Math.round((num(x.montant_impute) * num(x.montant_ht)) / ttc) : 0;
    if (brut <= 0) {
      ignores++;
      continue;
    }
    const existe = await db.query(`SELECT 1 FROM fiscalite_retenue WHERE tenant_id = $1 AND source = 'PLATEFORME' AND source_ref = $2`, [tenantId, x.imputation_id]);
    if (existe.rows[0]) continue;
    await creer(
      tenantId,
      userId,
      {
        type,
        date_operation: dateIso(x.date_reglement),
        beneficiaire_nom: x.fournisseur_nom || x.tiers_nom,
        beneficiaire_ninea: x.ninea,
        beneficiaire_statut: type === "NON_RESIDENT" ? "NON_RESIDENT" : "PP_SANS_REEL",
        reference: x.reference_fournisseur || x.numero_facture,
        libelle: `${x.numero_reglement} — ${x.numero_facture}${x.libelle ? ` — ${x.libelle}` : ""}`,
        montant_brut: brut,
        montant_facture: type === "PRESTATION_PP" ? Math.round(ttc) : null,
        statut: "PROPOSEE",
      },
      { source: "PLATEFORME", source_ref: x.imputation_id }
    );
    crees++;
  }
  return { crees, ignores, analyses: r.rows.length };
}

/** Interets de comptes courants d'associes (module IS) : propositions d'IRVM sur creances (16 %), a la date de cloture de l'exercice. */
async function rechercherPropositionsCca(tenantId, userId, annee) {
  const isSvc = require("./fiscaliteIs");
  let calcul;
  try {
    calcul = await isSvc.calculer(tenantId, annee);
  } catch (e) {
    return { crees: 0, ignores: 0, analyses: 0, indisponible: true };
  }
  const cca = calcul && calcul.cca;
  const date = calcul && calcul.exercice && calcul.exercice.date_fin ? dateIso(calcul.exercice.date_fin) : `${annee}-12-31`;
  if (!cca || !cca.actif) return { crees: 0, ignores: 0, analyses: 0 };
  let crees = 0;
  let ignores = 0;
  for (const a of cca.associes) {
    if (num(a.interets) <= 0) {
      ignores++;
      continue;
    }
    const ref = `CCA:${annee}:${a.cle}`;
    const existe = await db.query(`SELECT 1 FROM fiscalite_retenue WHERE tenant_id = $1 AND source = 'CCA' AND source_ref = $2`, [tenantId, ref]);
    if (existe.rows[0]) continue;
    if (await periodeVerrouillee(tenantId, date)) {
      ignores++;
      continue;
    }
    await creer(
      tenantId,
      userId,
      {
        type: "IRVM_CREANCES",
        date_operation: date,
        beneficiaire_nom: a.nom,
        beneficiaire_statut: "AUTRE",
        reference: `CCA ${annee}`,
        libelle: `Intérêts de compte courant d'associé — exercice ${annee}`,
        montant_brut: arrondi(a.interets),
        statut: "PROPOSEE",
      },
      { source: "CCA", source_ref: ref }
    );
    crees++;
  }
  return { crees, ignores, analyses: cca.associes.length, date };
}

// ---------------------------------------------------------------------------
// Calcul de la periode (etat de versement)
// ---------------------------------------------------------------------------

function agreger(operations) {
  const confirmees = operations.filter((o) => o.statut === "CONFIRMEE");
  const parType = new Map();
  const parBeneficiaire = new Map();
  const alertes = new Map();
  let total = 0;
  for (const o of confirmees) {
    const c = o.calcul;
    if (!parType.has(o.type)) parType.set(o.type, { type: o.type, article: TYPES[o.type].article, taux: TYPES[o.type].taux, nombre: 0, nombre_soumises: 0, montant_brut: 0, base: 0, retenue: 0 });
    const t = parType.get(o.type);
    t.nombre++;
    t.montant_brut += o.montant_brut;
    if (c.due) {
      t.nombre_soumises++;
      t.base += c.base;
      t.retenue += c.retenue;
      total += c.retenue;
      const cle = `${o.type}|${(o.beneficiaire_ninea || o.beneficiaire_nom).toLowerCase()}`;
      if (!parBeneficiaire.has(cle)) {
        parBeneficiaire.set(cle, { type: o.type, nom: o.beneficiaire_nom, ninea: o.beneficiaire_ninea, adresse: o.beneficiaire_adresse, profession: o.beneficiaire_profession, piece: o.beneficiaire_piece, nombre: 0, montant_brut: 0, retenue: 0 });
      }
      const b = parBeneficiaire.get(cle);
      b.nombre++;
      b.montant_brut += o.montant_brut;
      b.retenue += c.retenue;
    }
    for (const w of c.warnings) alertes.set(w, (alertes.get(w) || 0) + 1);
    for (const m of c.motifs) alertes.set(`MOTIF_${m}`, (alertes.get(`MOTIF_${m}`) || 0) + 1);
  }
  const compta = operations.filter((o) => o.source === "COMPTA" && o.statut !== "EXCLUE" && o.controle);
  const controle = {
    nb_lignes: compta.length,
    nb_coherentes: compta.filter((o) => o.controle.situation === "COMPLETE").length,
    nb_non_comptabilisees: compta.filter((o) => o.controle.situation === "RETENUE_NON_COMPTABILISEE").length,
    nb_ecarts: compta.filter((o) => o.controle.situation === "ECART_447").length,
    nb_sans_charge: compta.filter((o) => o.controle.situation === "SANS_CHARGE").length,
    manque: compta.filter((o) => o.statut === "CONFIRMEE").reduce((t, o) => t + Math.max(0, o.calcul.retenue - num(o.retenue_effectuee)), 0),
  };
  return {
    controle,
    par_type: [...parType.values()],
    par_beneficiaire: [...parBeneficiaire.values()].sort((x, y) => y.retenue - x.retenue),
    total_retenues: total,
    nb_confirmees: confirmees.length,
    nb_soumises: confirmees.filter((o) => o.calcul.due).length,
    nb_propositions: operations.filter((o) => o.statut === "PROPOSEE").length,
    nb_exclues: operations.filter((o) => o.statut === "EXCLUE").length,
    avertissements: [...alertes.entries()].map(([code, nombre]) => ({ code, nombre })),
  };
}

/** Regle de versement (art. 185) pour le mois : mensuel, ou trimestriel (reel simplifie / CGU, ou retenues du mois <= 20 000 F). */
async function regleVersement(tenantId, annee, mois, total) {
  const profil = await getProfil(db, tenantId);
  const echeanceMensuelle = dateLimite(annee, mois);
  const trimestriel = profil.regime_is === "REEL_SIMPLIFIE" || profil.regime_is === "CGU";
  const finTrimestre = [3, 6, 9, 12].find((m) => m >= mois);
  const echeanceTrimestrielle = dateLimite(annee, finTrimestre);
  let mode = "MENSUEL";
  if (trimestriel) mode = "TRIMESTRIEL_REGIME";
  else if (total > 0 && total <= SEUIL_VERSEMENT_TRIMESTRIEL) mode = "TRIMESTRIEL_OPTION";
  return { mode, regime: profil.regime_is, echeance_mensuelle: echeanceMensuelle, echeance_trimestrielle: echeanceTrimestrielle, seuil_option: SEUIL_VERSEMENT_TRIMESTRIEL };
}

async function getPeriodeRow(tenantId, annee, mois) {
  const r = await db.query(`SELECT * FROM fiscalite_retenue_periode WHERE tenant_id = $1 AND annee = $2 AND mois = $3`, [tenantId, annee, mois]);
  return r.rows[0] || null;
}

function versPeriode(row) {
  if (!row) return { statut: "BROUILLON", calcul: null, montant_du: null, date_depot: null, reference_depot: null, date_paiement: null, date_preparation: null };
  return {
    statut: row.statut,
    calcul: row.calcul_json || null,
    montant_du: row.montant_du === null ? null : num(row.montant_du),
    date_depot: row.date_depot ? dateIso(row.date_depot) : null,
    reference_depot: row.reference_depot,
    date_paiement: row.date_paiement ? dateIso(row.date_paiement) : null,
    date_preparation: row.date_preparation,
  };
}

/** Vue complete d'un mois : operations, totaux, regle de versement, dossier. */
async function getPeriode(tenantId, annee, mois) {
  const p = periodeValide(annee, mois);
  const operations = await lister(tenantId, p.annee, p.mois);
  const synthese = agreger(operations);
  const versement = await regleVersement(tenantId, p.annee, p.mois, synthese.total_retenues);
  const dossier = versPeriode(await getPeriodeRow(tenantId, p.annee, p.mois));
  return { annee: p.annee, mois: p.mois, debut: p.debut, fin: p.fin, operations, synthese, versement, dossier };
}

async function preparer(tenantId, userId, annee, mois) {
  const p = periodeValide(annee, mois);
  const ancien = await getPeriodeRow(tenantId, p.annee, p.mois);
  if (ancien && (ancien.statut === "DEPOSEE" || ancien.statut === "PAYEE")) throw new FiscaliteError("FISCALITE_DECLARATION_DEJA_DEPOSEE", 409);
  const vue = await getPeriode(tenantId, p.annee, p.mois);
  const calcul = { annee: p.annee, mois: p.mois, synthese: vue.synthese, versement: vue.versement, montant_du: vue.synthese.total_retenues, genere_le: new Date().toISOString() };
  await db.query(
    `INSERT INTO fiscalite_retenue_periode (tenant_id, annee, mois, statut, calcul_json, montant_du, prepare_par, date_preparation)
     VALUES ($1,$2,$3,'PREPAREE',$4,$5,$6, now())
     ON CONFLICT (tenant_id, annee, mois) DO UPDATE SET statut = 'PREPAREE', calcul_json = EXCLUDED.calcul_json, montant_du = EXCLUDED.montant_du,
       prepare_par = EXCLUDED.prepare_par, date_preparation = now(), date_modification = now()`,
    [tenantId, p.annee, p.mois, JSON.stringify(calcul), calcul.montant_du, userId]
  );
  return getPeriode(tenantId, p.annee, p.mois);
}

async function changerStatut(tenantId, annee, mois, corps) {
  const p = periodeValide(annee, mois);
  const d = await getPeriodeRow(tenantId, p.annee, p.mois);
  if (!d || !d.calcul_json) throw new FiscaliteError("FISCALITE_DECLARATION_INTROUVABLE", 404);
  const action = corps && corps.action;
  const estDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (action === "deposer") {
    if (d.statut !== "PREPAREE") throw new FiscaliteError("FISCALITE_ACTION_INVALIDE", 409);
    if (!estDate(corps.date_depot)) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
    await db.query(
      `UPDATE fiscalite_retenue_periode SET statut = 'DEPOSEE', date_depot = $4, reference_depot = $5, date_modification = now() WHERE tenant_id = $1 AND annee = $2 AND mois = $3`,
      [tenantId, p.annee, p.mois, corps.date_depot, texte(corps.reference_depot).slice(0, 100) || null]
    );
  } else if (action === "payer") {
    if (d.statut === "PREPAREE") throw new FiscaliteError("FISCALITE_DEPOT_AVANT_PAIEMENT", 409);
    if (!estDate(corps.date_paiement)) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
    await db.query(`UPDATE fiscalite_retenue_periode SET statut = 'PAYEE', date_paiement = $4, date_modification = now() WHERE tenant_id = $1 AND annee = $2 AND mois = $3`, [tenantId, p.annee, p.mois, corps.date_paiement]);
  } else if (action === "rouvrir") {
    await db.query(
      `UPDATE fiscalite_retenue_periode SET statut = 'PREPAREE', date_depot = NULL, reference_depot = NULL, date_paiement = NULL, date_modification = now() WHERE tenant_id = $1 AND annee = $2 AND mois = $3`,
      [tenantId, p.annee, p.mois]
    );
  } else {
    throw new FiscaliteError("FISCALITE_ACTION_INVALIDE");
  }
  return getPeriode(tenantId, p.annee, p.mois);
}

/** Resume des 12 mois d'une annee (tableau de suivi). */
async function resumeAnnee(tenantId, annee) {
  const a = Number(annee);
  if (!Number.isInteger(a) || a < 2000 || a > 2100) throw new FiscaliteError("FISCALITE_PERIODE_INVALIDE");
  const r = await db.query(`SELECT * FROM fiscalite_retenue WHERE tenant_id = $1 AND date_operation BETWEEN $2 AND $3`, [tenantId, `${a}-01-01`, `${a}-12-31`]);
  const parMois = new Map();
  for (const row of r.rows) {
    const op = versOperation(row);
    const m = Number(op.date_operation.slice(5, 7));
    if (!parMois.has(m)) parMois.set(m, []);
    parMois.get(m).push(op);
  }
  const d = await db.query(`SELECT * FROM fiscalite_retenue_periode WHERE tenant_id = $1 AND annee = $2`, [tenantId, a]);
  const dossiers = new Map(d.rows.map((x) => [x.mois, x]));
  const mois = [];
  for (let m = 1; m <= 12; m++) {
    const ops = parMois.get(m) || [];
    const s = agreger(ops);
    const dos = dossiers.get(m);
    mois.push({
      mois: m,
      statut: dos ? dos.statut : "BROUILLON",
      nb_confirmees: s.nb_confirmees,
      nb_propositions: s.nb_propositions,
      total_retenues: s.total_retenues,
      montant_prepare: dos && dos.montant_du !== null ? num(dos.montant_du) : null,
    });
  }
  return { annee: a, mois, total: mois.reduce((t, x) => t + x.total_retenues, 0) };
}

// ---------------------------------------------------------------------------
// Etat trimestriel des versements a des personnes physiques (art. 200-8)
// ---------------------------------------------------------------------------

async function etatTrimestriel(tenantId, annee, trimestre) {
  const a = Number(annee);
  const q = Number(trimestre);
  if (!Number.isInteger(a) || a < 2000 || a > 2100 || !Number.isInteger(q) || q < 1 || q > 4) throw new FiscaliteError("FISCALITE_PERIODE_INVALIDE");
  const m1 = (q - 1) * 3 + 1;
  const debut = `${a}-${pad(m1)}-01`;
  const fin = `${a}-${pad(m1 + 2)}-${pad(new Date(Date.UTC(a, m1 + 2, 0)).getUTCDate())}`;
  const r = await db.query(
    `SELECT * FROM fiscalite_retenue WHERE tenant_id = $1 AND date_operation BETWEEN $2 AND $3 AND type IN ('PRESTATION_PP', 'LOYER') AND statut = 'CONFIRMEE' ORDER BY date_operation`,
    [tenantId, debut, fin]
  );
  const ops = r.rows.map(versOperation).filter((o) => o.calcul.due || o.beneficiaire_statut === "PP_SANS_REEL");
  const groupes = new Map();
  for (const o of ops) {
    const cle = `${(o.beneficiaire_ninea || o.beneficiaire_nom).toLowerCase()}|${o.type}`;
    if (!groupes.has(cle)) {
      groupes.set(cle, {
        nom: o.beneficiaire_nom,
        ninea: o.beneficiaire_ninea,
        adresse: o.beneficiaire_adresse,
        profession: o.beneficiaire_profession,
        piece: o.beneficiaire_piece,
        type: o.type,
        nombre: 0,
        montant_brut: 0,
        retenue: 0,
        premiere: o.date_operation,
        derniere: o.date_operation,
        identite_incomplete: false,
      });
    }
    const g = groupes.get(cle);
    g.nombre++;
    g.montant_brut += o.montant_brut;
    g.retenue += o.calcul.retenue;
    if (o.date_operation < g.premiere) g.premiere = o.date_operation;
    if (o.date_operation > g.derniere) g.derniere = o.date_operation;
  }
  const lignes = [...groupes.values()].map((g) => ({ ...g, identite_incomplete: !g.ninea && !g.piece })).sort((x, y) => x.nom.localeCompare(y.nom));
  return {
    annee: a,
    trimestre: q,
    debut,
    fin,
    lignes,
    totaux: { beneficiaires: lignes.length, montant_brut: lignes.reduce((t, l) => t + l.montant_brut, 0), retenue: lignes.reduce((t, l) => t + l.retenue, 0) },
    identite_incomplete: lignes.filter((l) => l.identite_incomplete).length,
  };
}

// ---------------------------------------------------------------------------
// Rapprochement avec les retenues comptabilisees (comptes de retenue parametres, 4478 par defaut)
// ---------------------------------------------------------------------------

async function rapprochement(tenantId, annee, mois) {
  const p = periodeValide(annee, mois);
  const operations = await lister(tenantId, p.annee, p.mois);
  const calcule = agreger(operations).total_retenues;
  const parametres = await getParametres(tenantId);
  const regex = `^(${parametres.comptes_retenue.join("|")})`;
  const t = await db.query(`SELECT module_comptabilite_actif AS a FROM tenant WHERE id = $1`, [tenantId]);
  let source = "AUCUNE";
  let lignes = [];
  if (t.rows[0] && t.rows[0].a) {
    const r = await db.query(
      `SELECT c.numero, e.date_ecriture::text AS d, e.numero_piece AS piece, COALESCE(l.libelle, e.libelle) AS libelle, l.debit, l.credit
       FROM ligne_ecriture l JOIN ecriture_comptable e ON e.id = l.ecriture_id JOIN compte_comptable c ON c.id = l.compte_id
       WHERE l.tenant_id = $1 AND e.statut = 'VALIDEE' AND e.date_ecriture BETWEEN $2 AND $3 AND c.numero ~ $4
       ORDER BY e.date_ecriture, e.numero_ecriture`,
      [tenantId, p.debut, p.fin, regex]
    );
    if (r.rows.length > 0) {
      source = "COMPTABILITE";
      lignes = r.rows.map((x) => ({ compte: String(x.numero), date: x.d, piece: x.piece, libelle: x.libelle, debit: num(x.debit), credit: num(x.credit) }));
    }
  }
  if (source === "AUCUNE") {
    const r = await db.query(
      `SELECT l.compte, l.date_ecriture::text AS d, l.piece, l.libelle, l.debit, l.credit
       FROM fiscalite_import_ligne l JOIN fiscalite_import_jeu j ON j.id = l.jeu_id AND j.actif AND j.nature = 'GRAND_LIVRE'
       WHERE l.tenant_id = $1 AND l.date_ecriture BETWEEN $2 AND $3 AND l.compte ~ $4
       ORDER BY l.date_ecriture, l.id`,
      [tenantId, p.debut, p.fin, regex]
    );
    if (r.rows.length > 0) {
      source = "IMPORT";
      lignes = r.rows.map((x) => ({ compte: String(x.compte), date: x.d, piece: x.piece, libelle: x.libelle, debit: num(x.debit), credit: num(x.credit) }));
    }
  }
  // Retenue operee = credit du compte de dette ; un debit (versement au Tresor) ne se rapproche pas du calcul.
  const comptabilise = arrondi(lignes.reduce((s, l) => s + l.credit, 0));
  const verse = arrondi(lignes.reduce((s, l) => s + l.debit, 0));
  return {
    annee: p.annee,
    mois: p.mois,
    source,
    comptes: parametres.comptes_retenue,
    calcule,
    comptabilise,
    verse,
    ecart: comptabilise - calcule,
    lignes: lignes.slice(0, 200),
    nb_lignes: lignes.length,
  };
}

// ---------------------------------------------------------------------------
// Import Excel
// ---------------------------------------------------------------------------

const ENTETES = {
  type: /^(type|nature|retenue|typederetenue)$/,
  date: /^(date|dateoperation|datepaiement|datedupaiement)$/,
  nom: /^(beneficiaire|nom|prestataire|bailleur|tiers|nomprenom|nomprenoms)$/,
  ninea: /^(ninea)$/,
  adresse: /^(adresse)$/,
  profession: /^(profession|emploi)$/,
  piece: /^(pieceidentite|piecedidentite|piece|cni|identite)$/,
  statut: /^(statut|statutbeneficiaire|qualite|regimebeneficiaire)$/,
  reference: /^(reference|facture|numerofacture|nofacture|piecefacture)$/,
  libelle: /^(libelle|designation|objet)$/,
  brut: /^(montantbrut|brut|montantbrutht|montantht|ht|montant)$/,
  facture: /^(montantfacture|montantdelafacture|facturettc|ttc)$/,
  loyer: /^(loyermensuel|loyer)$/,
  taux: /^(taux|tauxapplique|tauxpct)$/,
  effectuee: /^(retenueeffectuee|retenueoperee|retenue|retenuecomptabilisee)$/,
};
const SYNONYMES_TYPE = [
  [/prestat|brs|honorair/, "PRESTATION_PP"],
  [/loyer|bail/, "LOYER"],
  [/non.?res|etranger|redevance/, "NON_RESIDENT"],
  [/dividende/, "IRVM_DIVIDENDES"],
  [/(obligation).*(5|longue|plus)|(5|longue).*(obligation)/, "IRVM_OBLIGATIONS_LONGUES"],
  [/obligation/, "IRVM_OBLIGATIONS"],
  [/creance|interet|compte.?courant|cca|irvm/, "IRVM_CREANCES"],
];
const SYNONYMES_STATUT = [
  [/non.?res/, "NON_RESIDENT"],
  [/societe|is\b|morale/, "SOCIETE_IS"],
  [/reel/, "PP_REEL"],
  [/physique|pp|cgu|individuel|sansreel/, "PP_SANS_REEL"],
];
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function lireType(v) {
  const s = norm(v);
  if (TYPES[String(v || "").trim().toUpperCase()]) return String(v).trim().toUpperCase();
  for (const [re, code] of SYNONYMES_TYPE) if (re.test(s)) return code;
  return null;
}
function lireStatut(v, type) {
  const brut = String(v || "").trim().toUpperCase();
  if (STATUTS_BENEFICIAIRE.includes(brut)) return brut;
  const s = norm(v);
  if (s) for (const [re, code] of SYNONYMES_STATUT) if (re.test(s)) return code;
  return type === "NON_RESIDENT" ? "NON_RESIDENT" : type === "PRESTATION_PP" ? "PP_SANS_REEL" : "AUTRE";
}
function lireNombre(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const n = Number(String(v).replace(/[\s ]/g, "").replace(",", ".").replace("%", ""));
  return Number.isFinite(n) ? n : NaN;
}

function analyserFichier(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: true });
  } catch (e) {
    throw new FiscaliteError("FISCALITE_RETENUE_IMPORT_FORMAT");
  }
  let rows = [];
  let idx = -1;
  let cols = null;
  // Premiere feuille dont une des 15 premieres lignes porte les en-tetes attendus (la feuille d'aide est ignoree).
  for (const nom of wb.SheetNames) {
    const candidates = XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: null, blankrows: false });
    for (let i = 0; i < Math.min(candidates.length, 15) && idx < 0; i++) {
      const m = {};
      (candidates[i] || []).forEach((c, k) => {
        const e = importCompta.cleEntete(c);
        if (!e) return;
        for (const [cle, re] of Object.entries(ENTETES)) if (m[cle] === undefined && re.test(e)) { m[cle] = k; break; }
      });
      if (m.type !== undefined && m.date !== undefined && m.nom !== undefined && m.brut !== undefined) {
        idx = i;
        cols = m;
        rows = candidates;
      }
    }
    if (idx >= 0) break;
  }
  if (idx < 0) throw new FiscaliteError("FISCALITE_RETENUE_IMPORT_FORMAT");
  const lignes = [];
  const erreurs = [];
  for (let i = idx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r.every((c) => c === null || c === "")) continue;
    const get = (cle) => (cols[cle] === undefined ? null : r[cols[cle]]);
    const type = lireType(get("type"));
    const date = importCompta.lireDate(get("date"));
    const brut = lireNombre(get("brut"));
    const facture = lireNombre(get("facture"));
    const loyer = lireNombre(get("loyer"));
    const taux = lireNombre(get("taux"));
    const effectuee = lireNombre(get("effectuee"));
    const nom = texte(get("nom"));
    const err = [];
    if (!type) err.push("TYPE");
    if (!date) err.push("DATE");
    if (!nom) err.push("BENEFICIAIRE");
    if (brut === null || Number.isNaN(brut) || brut < 0) err.push("MONTANT_BRUT");
    for (const [v, c] of [[facture, "MONTANT_FACTURE"], [loyer, "LOYER_MENSUEL"], [taux, "TAUX"], [effectuee, "RETENUE_EFFECTUEE"]]) if (v !== null && (Number.isNaN(v) || v < 0)) err.push(c);
    if (err.length) {
      erreurs.push({ ligne: i + 1, champs: err });
      continue;
    }
    const op = {
      type,
      date_operation: date,
      beneficiaire_nom: nom,
      beneficiaire_ninea: texte(get("ninea")),
      beneficiaire_adresse: texte(get("adresse")),
      beneficiaire_profession: texte(get("profession")),
      beneficiaire_piece: texte(get("piece")),
      beneficiaire_statut: lireStatut(get("statut"), type),
      reference: texte(get("reference")),
      libelle: texte(get("libelle")),
      montant_brut: brut,
      montant_facture: facture,
      loyer_mensuel: loyer,
      taux_applique: taux,
      retenue_effectuee: effectuee,
    };
    lignes.push({ ligne: i + 1, ...op, calcul: evaluer({ ...op, montant_brut: Math.round(brut) }) });
  }
  return { lignes, erreurs };
}

async function apercuImport(buffer) {
  const a = analyserFichier(buffer);
  return { nb_lignes: a.lignes.length, nb_erreurs: a.erreurs.length, erreurs: a.erreurs.slice(0, 50), lignes: a.lignes.slice(0, 100), total_retenues: a.lignes.reduce((t, l) => t + l.calcul.retenue, 0) };
}

async function importer(tenantId, userId, buffer) {
  const a = analyserFichier(buffer);
  if (a.lignes.length === 0) throw new FiscaliteError("FISCALITE_RETENUE_IMPORT_VIDE");
  let importees = 0;
  const verrouillees = [];
  for (const l of a.lignes) {
    try {
      const { ligne, calcul, ...op } = l;
      void calcul;
      await creer(tenantId, userId, { ...op, statut: "CONFIRMEE" }, { source: "IMPORT" });
      importees++;
    } catch (e) {
      if (e instanceof FiscaliteError && e.code === "FISCALITE_DECLARATION_DEJA_DEPOSEE") verrouillees.push(l.ligne);
      else throw e;
    }
  }
  return { importees, erreurs: a.erreurs, verrouillees };
}

function modeleImport() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Type", "Date", "Bénéficiaire", "NINEA", "Adresse", "Profession", "Pièce d'identité", "Statut", "Référence", "Libellé", "Montant brut HT", "Montant facture", "Loyer mensuel", "Taux", "Retenue effectuée"],
    ["Prestation", "2026-09-15", "Moussa Diop (consultant)", "0123456789", "Dakar Plateau", "Consultant", "", "Personne physique", "FAC-2026-014", "Mission de conseil", 400000, 472000, "", "", ""],
    ["Loyer", "2026-09-30", "Awa Ndiaye", "", "Almadies, Dakar", "", "CNI 1234567890123", "Personne physique", "QUIT-09", "Loyer bureau — septembre", 600000, "", 600000, "", ""],
    ["Non-résident", "2026-09-20", "Consulting Europe SAS", "", "Paris, France", "", "", "Non-résident", "INV-889", "Assistance technique", 2500000, "", "", "", ""],
    ["Dividendes", "2026-06-30", "Monsieur Exemple", "", "", "", "", "Autre", "AG 2026", "Dividendes de l'exercice 2025", 5000000, "", "", "", ""],
  ]);
  ws["!cols"] = [14, 12, 30, 14, 24, 16, 22, 18, 16, 30, 16, 16, 14, 8, 16].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, "Retenues");
  const aide = XLSX.utils.aoa_to_sheet([
    ["Retenues à la source — module Fiscalité (calcul et états seulement)"],
    ["Type : Prestation (art. 200), Loyer (art. 201), Non-résident (art. 202), Dividendes, Créances / intérêts, Obligations, Obligations 5 ans et plus (art. 173)."],
    ["Date : date du paiement (la retenue se rattache au mois du paiement). Montant brut HT : base de la retenue (hors taxes)."],
    ["Montant facture : montant indiqué sur la facture (seuil de 25 000 F pour les prestations). Loyer mensuel : loyer mensuel du local (seuil de 150 000 F)."],
    ["Statut : Personne physique (hors régime réel), Personne physique au réel, Société à l'IS, Non-résident, Autre. Une retenue n'est pas due pour une personne physique au réel ni pour une société à l'IS."],
    ["Taux : à renseigner seulement pour déroger au taux légal (convention internationale, par exemple). Retenue effectuée : montant réellement retenu, pour détecter les écarts."],
    ["Pièce d'identité : à défaut de NINEA, l'état trimestriel exige le numéro de pièce d'identité du bénéficiaire (art. 200-8)."],
  ]);
  aide["!cols"] = [{ wch: 150 }];
  XLSX.utils.book_append_sheet(wb, aide, "Aide");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ---------------------------------------------------------------------------
// Calendrier : montants et statuts des echeances RETENUES:YYYY-MM
// ---------------------------------------------------------------------------

/** Pour les mois couverts par une annee de calendrier : { "YYYY-MM": { statut, montant, date_depot, date_paiement, nb_propositions } }. */
async function suiviCalendrier(tenantId, annee) {
  const debut = `${annee - 1}-12-01`;
  const fin = `${annee}-11-30`;
  const r = await db.query(`SELECT * FROM fiscalite_retenue WHERE tenant_id = $1 AND date_operation BETWEEN $2 AND $3`, [tenantId, debut, fin]);
  const parMois = new Map();
  for (const row of r.rows) {
    const op = versOperation(row);
    const cle = op.date_operation.slice(0, 7);
    if (!parMois.has(cle)) parMois.set(cle, []);
    parMois.get(cle).push(op);
  }
  const d = await db.query(`SELECT * FROM fiscalite_retenue_periode WHERE tenant_id = $1 AND ((annee = $2 AND mois <= 11) OR (annee = $3 AND mois = 12))`, [tenantId, annee, annee - 1]);
  const dossiers = new Map(d.rows.map((x) => [`${x.annee}-${pad(x.mois)}`, x]));
  const sortie = new Map();
  const cles = new Set([...parMois.keys(), ...dossiers.keys()]);
  for (const cle of cles) {
    const s = agreger(parMois.get(cle) || []);
    const dos = dossiers.get(cle);
    sortie.set(cle, {
      calcule: s.total_retenues,
      nb_confirmees: s.nb_confirmees,
      nb_propositions: s.nb_propositions,
      statut: dos ? dos.statut : "BROUILLON",
      montant_du: dos && dos.montant_du !== null ? num(dos.montant_du) : null,
      date_depot: dos && dos.date_depot ? dateIso(dos.date_depot) : null,
      date_paiement: dos && dos.date_paiement ? dateIso(dos.date_paiement) : null,
    });
  }
  return sortie;
}

module.exports = {
  TYPES,
  STATUTS_BENEFICIAIRE,
  PARAMETRES_DEFAUT,
  getParametres,
  enregistrerParametres,
  autreSourcePresente,
  listePrefixes,
  nettoyer,
  SEUIL_PRESTATION,
  SEUIL_LOYER_MENSUEL,
  evaluer,
  agreger,
  lister,
  creer,
  modifier,
  supprimer,
  getOperation,
  getPeriode,
  preparer,
  changerStatut,
  resumeAnnee,
  etatTrimestriel,
  rapprochement,
  rechercherPropositionsPlateforme,
  rechercherPropositionsCca,
  apercuImport,
  importer,
  modeleImport,
  suiviCalendrier,
  periodeValide,
};
