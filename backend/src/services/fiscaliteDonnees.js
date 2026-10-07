/**
 * Module Fiscalite : acces unique aux DONNEES COMPTABLES de l'exercice, quelle que soit leur origine.
 *
 *   COMPTABILITE : ecritures VALIDEES du module Comptabilite de la plateforme (EN_INSTANCE comptees pour avertir) ;
 *   IMPORT       : balance generale importee (et grand livre pour les soldes moyens) - fiscalite utilisee SANS la comptabilite ;
 *   MANUEL       : aucune donnee, l'utilisateur saisit resultat, chiffre d'affaires, amortissements...
 *
 * Les calculs (IS, comptes courants d'associes, controles de TVA) ne lisent que cette interface : un client qui n'a que le module
 * Fiscalite obtient exactement le meme traitement qu'un client qui tient sa comptabilite dans la plateforme.
 * Montants en francs (nets = debit - credit).
 */
const db = require("../db");

const num = (v) => Number(v || 0);
const dateIso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

function dureeMois(debut, fin) {
  const d = new Date(`${debut}T00:00:00Z`);
  const f = new Date(`${fin}T00:00:00Z`);
  return Math.max(1, Math.round(((f - d) / 86400000 + 1) / 30.4375));
}

const jours = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

async function trouverExercice(tenantId, annee, exerciceId) {
  const params = [tenantId];
  let filtre;
  if (exerciceId) {
    params.push(exerciceId);
    filtre = "id = $2";
  } else {
    params.push(annee);
    filtre = "EXTRACT(YEAR FROM date_fin) = $2";
  }
  const r = await db.query(
    `SELECT id, libelle, date_debut, date_fin, statut FROM exercice_comptable WHERE tenant_id = $1 AND ${filtre} ORDER BY date_fin DESC LIMIT 1`,
    params
  );
  return r.rows[0] || null;
}

async function moduleComptaActif(tenantId) {
  const r = await db.query(`SELECT module_comptabilite_actif AS a FROM tenant WHERE id = $1`, [tenantId]);
  return !!(r.rows[0] && r.rows[0].a);
}

async function jeuxImport(tenantId, annee) {
  const r = await db.query(
    `SELECT id, nature, role, nom_fichier, date_debut, date_fin, nb_lignes, avertissements, date_creation
     FROM fiscalite_import_jeu WHERE tenant_id = $1 AND annee = $2 AND actif`,
    [tenantId, annee]
  );
  const par = {};
  for (const x of r.rows) par[`${x.nature}:${x.role}`] = { ...x, date_debut: dateIso(x.date_debut), date_fin: dateIso(x.date_fin) };
  return par;
}

/** Soldes (debit - credit) par compte pour la COMPTABILITE : classes 1-5 cumul complet, classes 6-8 hors a-nouveaux. */
async function balanceCompta(tenantId, exercice) {
  const r = await db.query(
    `SELECT c.numero, MAX(c.libelle) AS libelle,
            COALESCE(SUM(CASE WHEN e.statut = 'VALIDEE' THEN ROUND(l.debit * 100) END), 0)::text AS d,
            COALESCE(SUM(CASE WHEN e.statut = 'VALIDEE' THEN ROUND(l.credit * 100) END), 0)::text AS c
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN journal_comptable j ON j.id = e.journal_id
     JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.tenant_id = $1 AND e.exercice_id = $2 AND e.statut IN ('VALIDEE', 'EN_INSTANCE')
       AND (c.numero ~ '^[1-5]' OR (c.numero ~ '^[678]' AND j.type_journal <> 'A_NOUVEAUX'))
     GROUP BY c.numero`,
    [tenantId, exercice.id]
  );
  const instance = await db.query(
    `SELECT COUNT(DISTINCT e.id)::int AS n
     FROM ligne_ecriture l JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN journal_comptable j ON j.id = e.journal_id JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.tenant_id = $1 AND e.exercice_id = $2 AND e.statut = 'EN_INSTANCE'
       AND (c.numero ~ '^[1-5]' OR (c.numero ~ '^[678]' AND j.type_journal <> 'A_NOUVEAUX'))`,
    [tenantId, exercice.id]
  );
  const comptes = r.rows
    .map((x) => ({ numero: String(x.numero), libelle: x.libelle, net: (Number(x.d) - Number(x.c)) / 100 }))
    .filter((x) => x.net !== 0 || true);
  return { comptes, nb_instance: instance.rows[0].n, nb_lignes: r.rows.length };
}

async function balanceImport(jeuBalanceId, jeuGlId, periode) {
  if (jeuBalanceId) {
    const r = await db.query(`SELECT compte, libelle, solde_net FROM fiscalite_import_balance WHERE jeu_id = $1`, [jeuBalanceId]);
    return { comptes: r.rows.map((x) => ({ numero: String(x.compte), libelle: x.libelle, net: num(x.solde_net) })), derive: false };
  }
  // Pas de balance : on la deduit du grand livre (classes 6-8 completes ; classes 1-5 sans a-nouveaux sauf lignes d'ouverture importees).
  const r = await db.query(
    `SELECT compte, SUM(debit - credit) AS net FROM fiscalite_import_ligne
     WHERE jeu_id = $1 AND date_ecriture BETWEEN $2 AND $3 GROUP BY compte`,
    [jeuGlId, periode.date_debut, periode.date_fin]
  );
  return { comptes: r.rows.map((x) => ({ numero: String(x.compte), libelle: null, net: num(x.net) })), derive: true };
}

/**
 * Charge les donnees comptables de l'exercice de l'annee de cloture `annee`.
 * @param {object} opts { source: 'AUTO'|'COMPTABILITE'|'IMPORT'|'MANUEL', exerciceId }
 */
async function charger(tenantId, annee, opts = {}) {
  const preference = opts.source && opts.source !== "AUTO" ? opts.source : "AUTO";
  const comptaActive = await moduleComptaActif(tenantId);
  const exerciceCompta = comptaActive ? await trouverExercice(tenantId, annee, opts.exerciceId) : null;
  const jeux = await jeuxImport(tenantId, annee);
  const jeuBalance = jeux["BALANCE:EXERCICE"] || null;
  const jeuGl = jeux["GRAND_LIVRE:EXERCICE"] || null;
  const importDispo = !!(jeuBalance || jeuGl);

  let comptaBalance = null;
  if (exerciceCompta && preference !== "MANUEL" && preference !== "IMPORT") comptaBalance = await balanceCompta(tenantId, exerciceCompta);
  const comptaUtilisable = !!(comptaBalance && comptaBalance.nb_lignes > 0);

  let source;
  if (preference === "MANUEL") source = "MANUEL";
  else if (preference === "COMPTABILITE") source = exerciceCompta ? "COMPTABILITE" : importDispo ? "IMPORT" : "MANUEL";
  else if (preference === "IMPORT") source = importDispo ? "IMPORT" : exerciceCompta ? "COMPTABILITE" : "MANUEL";
  else source = comptaUtilisable ? "COMPTABILITE" : importDispo ? "IMPORT" : exerciceCompta ? "COMPTABILITE" : "MANUEL";

  const resultat = {
    source,
    exercice: null,
    comptes: [],
    nb_instance: 0,
    import: null,
    sources_disponibles: { comptabilite: !!exerciceCompta, import: importDispo, import_balance: !!jeuBalance, import_grand_livre: !!jeuGl, compta_module_actif: comptaActive },
    jeux,
    avertissements: [],
  };

  if (source === "MANUEL" && exerciceCompta) {
    const debut = dateIso(exerciceCompta.date_debut);
    const fin = dateIso(exerciceCompta.date_fin);
    resultat.exercice = { id: exerciceCompta.id, libelle: exerciceCompta.libelle, date_debut: debut, date_fin: fin, duree_mois: dureeMois(debut, fin), statut: exerciceCompta.statut, origine: "COMPTABILITE" };
  }
  if (source === "COMPTABILITE") {
    const ex = exerciceCompta;
    const debut = dateIso(ex.date_debut);
    const fin = dateIso(ex.date_fin);
    resultat.exercice = { id: ex.id, libelle: ex.libelle, date_debut: debut, date_fin: fin, duree_mois: dureeMois(debut, fin), statut: ex.statut, origine: "COMPTABILITE" };
    const b = comptaBalance || (await balanceCompta(tenantId, ex));
    resultat.comptes = b.comptes;
    resultat.nb_instance = b.nb_instance;
  } else if (source === "IMPORT") {
    const jeu = jeuBalance || jeuGl;
    const periode = { date_debut: jeu.date_debut, date_fin: jeu.date_fin };
    resultat.exercice = {
      id: null,
      libelle: `Exercice ${annee}`,
      date_debut: periode.date_debut,
      date_fin: periode.date_fin,
      duree_mois: dureeMois(periode.date_debut, periode.date_fin),
      statut: "IMPORT",
      origine: "IMPORT",
    };
    const b = await balanceImport(jeuBalance && jeuBalance.id, jeuGl && jeuGl.id, periode);
    resultat.comptes = b.comptes;
    resultat.import = {
      balance: jeuBalance ? { id: jeuBalance.id, nom_fichier: jeuBalance.nom_fichier, date_creation: jeuBalance.date_creation } : null,
      grand_livre: jeuGl ? { id: jeuGl.id, nom_fichier: jeuGl.nom_fichier, date_creation: jeuGl.date_creation } : null,
      balance_deduite_du_grand_livre: b.derive,
    };
    if (b.derive) resultat.avertissements.push({ code: "BALANCE_DEDUITE_GRAND_LIVRE" });
    for (const a of (jeuBalance && jeuBalance.avertissements) || []) resultat.avertissements.push({ ...a, code: `IMPORT_${a.code}` });
  }
  resultat.annee = annee;
  resultat.tenantId = tenantId;
  return resultat;
}

// ---------------------------------------------------------------------------
// Aides de lecture sur la balance normalisee
// ---------------------------------------------------------------------------

function sommeNet(comptes, prefixes) {
  return comptes.filter((c) => prefixes.some((p) => c.numero.startsWith(p))).reduce((t, c) => t + c.net, 0);
}

/** Balance N-1 importee (pour le CA de reference, les comparatifs) : {comptes} ou null. */
async function balancePrecedente(tenantId, annee) {
  const jeux = await jeuxImport(tenantId, annee);
  const jeu = jeux["BALANCE:PRECEDENT"] || (await jeuxImport(tenantId, annee - 1))["BALANCE:EXERCICE"];
  if (!jeu) return null;
  const r = await db.query(`SELECT compte, libelle, solde_net FROM fiscalite_import_balance WHERE jeu_id = $1`, [jeu.id]);
  return { comptes: r.rows.map((x) => ({ numero: String(x.compte), libelle: x.libelle, net: num(x.solde_net) })), nom_fichier: jeu.nom_fichier };
}

// ---------------------------------------------------------------------------
// Soldes moyens (comptes courants d'associes, etc.)
// ---------------------------------------------------------------------------

/** Moyenne ponderee au jour d'un solde qui change aux dates d'une liste d'evenements triee. */
function moyennePonderee(ouverture, evenements, debut, fin) {
  const total = jours(debut, fin) + 1;
  if (total <= 0) return { moyen: ouverture, cloture: ouverture };
  let solde = ouverture;
  let courant = debut;
  let somme = 0;
  for (const ev of evenements) {
    const d = ev.date < debut ? debut : ev.date > fin ? fin : ev.date;
    somme += solde * Math.max(0, jours(courant, d));
    solde += ev.net;
    courant = d;
  }
  somme += solde * (jours(courant, fin) + 1);
  return { moyen: somme / total, cloture: solde };
}

/**
 * Soldes (credit positif : sommes mises a disposition) des comptes dont le numero commence par un des `prefixes`,
 * par compte et, si les lignes portent un tiers, par tiers. Chaque ligne : { cle, compte, tiers, libelle, cloture, moyen, methode }.
 * methode : MOYENNE_JOURNALIERE (dates connues) ou CLOTURE (balance seule).
 */
async function soldesCompte(data, prefixes) {
  const ex = data.exercice;
  if (!ex || data.source === "MANUEL") return [];
  const regex = `^(${prefixes.map((p) => p.replace(/[^0-9]/g, "")).join("|")})`;
  const sortie = [];
  if (data.source === "COMPTABILITE") {
    const r = await db.query(
      `SELECT c.numero, c.libelle AS compte_libelle, COALESCE(t.nom, '') AS tiers, e.date_ecriture::text AS d,
              ROUND(l.debit * 100)::bigint AS deb, ROUND(l.credit * 100)::bigint AS cre
       FROM ligne_ecriture l
       JOIN ecriture_comptable e ON e.id = l.ecriture_id
       JOIN compte_comptable c ON c.id = l.compte_id
       LEFT JOIN tiers_comptable t ON t.id = l.tiers_id
       WHERE l.tenant_id = $1 AND e.exercice_id = $2 AND e.statut = 'VALIDEE' AND c.numero ~ $3
       ORDER BY e.date_ecriture, l.ordre`,
      [data.tenantId, ex.id, regex]
    );
    const groupes = new Map();
    for (const x of r.rows) {
      const cle = `${x.numero}|${x.tiers}`;
      if (!groupes.has(cle)) groupes.set(cle, { compte: String(x.numero), tiers: x.tiers || null, libelle: x.tiers || x.compte_libelle, evenements: [] });
      groupes.get(cle).evenements.push({ date: x.d, net: (Number(x.deb) - Number(x.cre)) / 100 });
    }
    for (const [cle, g] of groupes) {
      const m = moyennePonderee(0, g.evenements, ex.date_debut, ex.date_fin);
      sortie.push({ cle, compte: g.compte, tiers: g.tiers, libelle: g.libelle, cloture: -m.cloture, moyen: -m.moyen, methode: "MOYENNE_JOURNALIERE" });
    }
    return sortie;
  }
  // IMPORT
  const gl = data.jeux["GRAND_LIVRE:EXERCICE"];
  const bal = data.jeux["BALANCE:EXERCICE"];
  const ouvertures = new Map();
  if (bal) {
    const o = await db.query(`SELECT compte, an_net FROM fiscalite_import_balance WHERE jeu_id = $1 AND compte ~ $2`, [bal.id, regex]);
    o.rows.forEach((x) => ouvertures.set(String(x.compte), num(x.an_net)));
  }
  if (gl) {
    const r = await db.query(
      `SELECT compte, COALESCE(tiers, '') AS tiers, date_ecriture::text AS d, debit, credit FROM fiscalite_import_ligne
       WHERE jeu_id = $1 AND compte ~ $2 AND date_ecriture BETWEEN $3 AND $4 ORDER BY date_ecriture, id`,
      [gl.id, regex, ex.date_debut, ex.date_fin]
    );
    const groupes = new Map();
    for (const x of r.rows) {
      const cle = `${x.compte}|${x.tiers}`;
      if (!groupes.has(cle)) groupes.set(cle, { compte: String(x.compte), tiers: x.tiers || null, evenements: [] });
      groupes.get(cle).evenements.push({ date: x.d, net: num(x.debit) - num(x.credit) });
    }
    // Ouverture : repartie sur le premier groupe du compte si le grand livre ne la porte pas deja (journal d'a-nouveaux)
    const dejaOuvert = new Set();
    for (const [cle, g] of groupes) {
      let ouverture = 0;
      if (!dejaOuvert.has(g.compte) && ouvertures.has(g.compte)) {
        ouverture = ouvertures.get(g.compte);
        dejaOuvert.add(g.compte);
      }
      const m = moyennePonderee(ouverture, g.evenements, ex.date_debut, ex.date_fin);
      sortie.push({ cle, compte: g.compte, tiers: g.tiers, libelle: g.tiers || null, cloture: -m.cloture, moyen: -m.moyen, methode: "MOYENNE_JOURNALIERE", ouverture_balance: ouverture !== 0 });
    }
    return sortie;
  }
  // Balance seule : solde de cloture
  for (const c of data.comptes.filter((x) => new RegExp(regex).test(x.numero))) {
    sortie.push({ cle: `${c.numero}|`, compte: c.numero, tiers: null, libelle: c.libelle || null, cloture: -c.net, moyen: -c.net, methode: "CLOTURE" });
  }
  return sortie;
}

module.exports = { charger, sommeNet, soldesCompte, balancePrecedente, trouverExercice, moyennePonderee, dateIso, dureeMois, jours };
