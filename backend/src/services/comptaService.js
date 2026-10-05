/**
 * Couche metier du module Comptabilite (SYSCOHADA revise) - phase 1, chantier
 * du 04/10/2026. Toutes les fonctions qui ecrivent prennent un `client` pg
 * DEJA dans une transaction (BEGIN/COMMIT geres par l'appelant, voir
 * avecTransaction ci-dessous) ; celles qui ne font que lire acceptent aussi
 * le module `db`.
 *
 * Les erreurs metier sont levees sous forme de ComptaError(code, statut) : le
 * `code` est une cle du dictionnaire des messages API (locales/messages.js),
 * traduite par la route.
 */
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { comptesImputables, natureCompte, sensNormal } = require("../data/planSyscohada");

class ComptaError extends Error {
  constructor(code, status = 400, details = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Execute `fn(client)` dans une transaction ; annule tout en cas d'erreur. */
async function avecTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const resultat = await fn(client);
    await client.query("COMMIT");
    return resultat;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------------
// Montants : tout le calcul se fait en CENTIMES entiers (jamais en virgule
// flottante) pour que l'equilibre debit = credit soit exact.
// ----------------------------------------------------------------------------

/** Convertit une saisie ("1 250,50", 1250.5, "") en centimes entiers ; null si vide, NaN si invalide. */
function versCentimes(valeur) {
  if (valeur === null || valeur === undefined || valeur === "") return 0;
  if (typeof valeur === "number") {
    if (!Number.isFinite(valeur)) return NaN;
    return Math.round(valeur * 100);
  }
  const texte = String(valeur).replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(texte)) return NaN;
  const [entier, decimales = ""] = texte.split(".");
  const signe = entier.startsWith("-") ? -1 : 1;
  const e = Math.abs(Number(entier));
  const d = Number((decimales + "00").slice(0, 2));
  return signe * (e * 100 + d);
}

function centimesVersDecimal(centimes) {
  const signe = centimes < 0 ? "-" : "";
  const abs = Math.abs(centimes);
  return `${signe}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// ----------------------------------------------------------------------------
// Audit
// ----------------------------------------------------------------------------

async function audit(client, tenantId, utilisateurId, action, objetType, objetId, avant = null, apres = null) {
  await client.query(
    `INSERT INTO compta_audit (id, tenant_id, utilisateur_id, action, objet_type, objet_id, avant, apres)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      uuidv4(),
      tenantId,
      utilisateurId || null,
      action,
      objetType,
      objetId ? String(objetId) : null,
      avant ? JSON.stringify(avant) : null,
      apres ? JSON.stringify(apres) : null,
    ]
  );
}

// ----------------------------------------------------------------------------
// Parametres, initialisation
// ----------------------------------------------------------------------------

const JOURNAUX_PAR_DEFAUT = [
  { code: "VTE", libelle: "Journal des ventes", type_journal: "VENTES", compte_tresorerie: null },
  { code: "ACH", libelle: "Journal des achats", type_journal: "ACHATS", compte_tresorerie: null },
  { code: "BQ1", libelle: "Banque principale", type_journal: "BANQUE", compte_tresorerie: "52110000" },
  { code: "CAI", libelle: "Caisse", type_journal: "CAISSE", compte_tresorerie: "57110000" },
  { code: "OD", libelle: "Opérations diverses", type_journal: "OPERATIONS_DIVERSES", compte_tresorerie: null },
  { code: "AN", libelle: "À-nouveaux", type_journal: "A_NOUVEAUX", compte_tresorerie: null },
];

async function getParametre(client, tenantId) {
  const r = await client.query(`SELECT * FROM compta_parametre WHERE tenant_id = $1`, [tenantId]);
  return r.rows[0] || null;
}

/** Le module doit avoir ete initialise (plan comptable charge) avant tout usage. */
async function exigerInitialise(client, tenantId) {
  const p = await getParametre(client, tenantId);
  if (!p || !p.initialisee) throw new ComptaError("COMPTA_NON_INITIALISEE", 409);
  return p;
}

function completerNumero(numero, longueur) {
  return String(numero).padEnd(longueur, "0");
}

/**
 * Initialise (ou complete) la comptabilite d'une entreprise : parametres par
 * defaut, plan comptable SYSCOHADA (comptes manquants uniquement - rejouable
 * sans ecraser les modifications de l'entreprise), journaux par defaut, premier
 * exercice si aucun n'existe, tiers des clients/fournisseurs existants.
 */
async function initialiserComptabilite(client, tenantId, utilisateurId, options = {}) {
  let parametre = await getParametre(client, tenantId);
  if (!parametre) {
    const longueur = options.longueur_compte || 8;
    if (!Number.isInteger(longueur) || longueur < 6 || longueur > 10) {
      throw new ComptaError("COMPTA_LONGUEUR_INVALIDE");
    }
    await client.query(
      `INSERT INTO compta_parametre (tenant_id, longueur_compte, date_debut_comptabilite,
         compte_vente_defaut, compte_client_collectif, compte_fournisseur_collectif,
         compte_acompte_client, compte_acompte_fournisseur, compte_tva_collectee,
         compte_tva_recuperable, compte_achat_defaut)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        tenantId,
        longueur,
        options.date_debut || null,
        completerNumero("7061", longueur),
        completerNumero("4111", longueur),
        completerNumero("4011", longueur),
        completerNumero("4191", longueur),
        completerNumero("4091", longueur),
        completerNumero("4431", longueur),
        completerNumero("4452", longueur),
        completerNumero("6011", longueur),
      ]
    );
    parametre = await getParametre(client, tenantId);
  }
  const longueur = parametre.longueur_compte;

  // Plan comptable : on n'ajoute que les numeros manquants.
  const comptes = comptesImputables(longueur);
  await client.query(
    `INSERT INTO compte_comptable
       (id, tenant_id, numero, libelle, classe, nature, sens_normal, lettrable, tiers_obligatoire, analytique, est_systeme)
     SELECT md5(random()::text || clock_timestamp()::text || x.numero)::uuid, $1, x.numero, x.libelle, x.classe,
            x.nature, NULLIF(x.sens, ''), x.lettrable, x.tiers_obligatoire, x.analytique, true
     FROM unnest($2::text[], $3::text[], $4::int[], $5::text[], $6::text[], $7::bool[], $8::bool[], $9::bool[])
          AS x(numero, libelle, classe, nature, sens, lettrable, tiers_obligatoire, analytique)
     ON CONFLICT (tenant_id, numero) DO NOTHING`,
    [
      tenantId,
      comptes.map((c) => c.numero),
      comptes.map((c) => c.libelle),
      comptes.map((c) => c.classe),
      comptes.map((c) => c.nature),
      comptes.map((c) => c.sens_normal || ""),
      comptes.map((c) => c.lettrable),
      comptes.map((c) => c.tiers_obligatoire),
      comptes.map((c) => c.analytique),
    ]
  );

  // Journaux par defaut (comptes de tresorerie completes a la bonne longueur)
  for (const j of JOURNAUX_PAR_DEFAUT) {
    await client.query(
      `INSERT INTO journal_comptable (id, tenant_id, code, libelle, type_journal, compte_tresorerie)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [
        uuidv4(),
        tenantId,
        j.code,
        j.libelle,
        j.type_journal,
        j.compte_tresorerie ? completerNumero(j.compte_tresorerie.slice(0, 4), longueur) : null,
      ]
    );
  }

  // Premier exercice : annee civile de date_debut (ou de l'annee courante).
  const existants = await client.query(`SELECT 1 FROM exercice_comptable WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  if (existants.rows.length === 0) {
    const debut = options.date_debut || `${new Date().getFullYear()}-01-01`;
    const annee = Number(String(debut).slice(0, 4));
    const fin = options.date_fin || `${annee}-12-31`;
    await creerExercice(client, tenantId, utilisateurId, {
      libelle: options.libelle_exercice || `Exercice ${annee}`,
      date_debut: debut,
      date_fin: fin,
    });
  }

  await client.query(
    `UPDATE compta_parametre
     SET initialisee = true,
         date_initialisation = COALESCE(date_initialisation, now()),
         date_debut_comptabilite = COALESCE(date_debut_comptabilite, $2),
         date_modification = now()
     WHERE tenant_id = $1`,
    [tenantId, options.date_debut || null]
  );

  await synchroniserTiers(client, tenantId);
  await audit(client, tenantId, utilisateurId, "INITIALISATION", "compta_parametre", tenantId, null, {
    longueur_compte: longueur,
    comptes_plan: comptes.length,
  });
  return getParametre(client, tenantId);
}

const CHAMPS_PARAMETRE_COMPTES = [
  "compte_vente_defaut",
  "compte_client_collectif",
  "compte_fournisseur_collectif",
  "compte_acompte_client",
  "compte_acompte_fournisseur",
  "compte_tva_collectee",
  "compte_tva_recuperable",
  "compte_achat_defaut",
];

async function modifierParametre(client, tenantId, utilisateurId, patch) {
  const avant = await exigerInitialise(client, tenantId);
  const sets = [];
  const valeurs = [tenantId];
  for (const champ of CHAMPS_PARAMETRE_COMPTES) {
    if (patch[champ] !== undefined) {
      const numero = String(patch[champ]).trim();
      const c = await client.query(
        `SELECT 1 FROM compte_comptable WHERE tenant_id = $1 AND numero = $2 AND actif = true`,
        [tenantId, numero]
      );
      if (c.rows.length === 0) throw new ComptaError("COMPTA_COMPTE_INTROUVABLE", 400, { numero });
      valeurs.push(numero);
      sets.push(`${champ} = $${valeurs.length}`);
    }
  }
  if (patch.tranches_balance_agee !== undefined) {
    const t = patch.tranches_balance_agee;
    const valide =
      Array.isArray(t) &&
      t.length >= 1 &&
      t.length <= 8 &&
      t.every((n, i) => Number.isInteger(n) && n >= 0 && (i === 0 || n > t[i - 1]));
    if (!valide) throw new ComptaError("COMPTA_TRANCHES_INVALIDES");
    valeurs.push(JSON.stringify(t));
    sets.push(`tranches_balance_agee = $${valeurs.length}::jsonb`);
  }
  if (patch.date_debut_comptabilite !== undefined) {
    valeurs.push(patch.date_debut_comptabilite || null);
    sets.push(`date_debut_comptabilite = $${valeurs.length}`);
  }
  if (sets.length === 0) return avant;
  await client.query(
    `UPDATE compta_parametre SET ${sets.join(", ")}, date_modification = now() WHERE tenant_id = $1`,
    valeurs
  );
  const apres = await getParametre(client, tenantId);
  await audit(client, tenantId, utilisateurId, "MODIFICATION_PARAMETRE", "compta_parametre", tenantId, avant, apres);
  return apres;
}

// ----------------------------------------------------------------------------
// Exercices
// ----------------------------------------------------------------------------

async function creerExercice(client, tenantId, utilisateurId, { libelle, date_debut, date_fin }) {
  if (!libelle || !String(libelle).trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date_debut || "") || !/^\d{4}-\d{2}-\d{2}$/.test(date_fin || "")) {
    throw new ComptaError("COMPTA_EXERCICE_CHAMPS_REQUIS");
  }
  if (date_fin <= date_debut) throw new ComptaError("COMPTA_EXERCICE_DATES_INVALIDES");
  const chevauche = await client.query(
    `SELECT libelle FROM exercice_comptable
     WHERE tenant_id = $1 AND date_debut <= $3::date AND date_fin >= $2::date`,
    [tenantId, date_debut, date_fin]
  );
  if (chevauche.rows.length > 0) {
    throw new ComptaError("COMPTA_EXERCICE_CHEVAUCHE", 409, { libelle: chevauche.rows[0].libelle });
  }
  const doublon = await client.query(
    `SELECT 1 FROM exercice_comptable WHERE tenant_id = $1 AND libelle = $2`,
    [tenantId, String(libelle).trim()]
  );
  if (doublon.rows.length > 0) throw new ComptaError("COMPTA_EXERCICE_LIBELLE_EXISTE", 409);
  const r = await client.query(
    `INSERT INTO exercice_comptable (id, tenant_id, libelle, date_debut, date_fin)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [uuidv4(), tenantId, String(libelle).trim(), date_debut, date_fin]
  );
  await audit(client, tenantId, utilisateurId, "CREATION_EXERCICE", "exercice_comptable", r.rows[0].id, null, r.rows[0]);
  return r.rows[0];
}

async function cloturerExercice(client, tenantId, utilisateurId, exerciceId) {
  const r = await client.query(
    `SELECT * FROM exercice_comptable WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [exerciceId, tenantId]
  );
  const ex = r.rows[0];
  if (!ex) throw new ComptaError("COMPTA_EXERCICE_INTROUVABLE", 404);
  if (ex.statut === "CLOTURE") throw new ComptaError("COMPTA_EXERCICE_DEJA_CLOTURE", 409);
  const attente = await client.query(
    `SELECT COUNT(*)::int AS n FROM ecriture_comptable
     WHERE tenant_id = $1 AND exercice_id = $2 AND statut <> 'VALIDEE'`,
    [tenantId, exerciceId]
  );
  if (attente.rows[0].n > 0) {
    throw new ComptaError("COMPTA_CLOTURE_ECRITURES_EN_ATTENTE", 409, { nombre: attente.rows[0].n });
  }
  const m = await client.query(
    `UPDATE exercice_comptable SET statut = 'CLOTURE', date_cloture = now(), cloture_par = $3
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [exerciceId, tenantId, utilisateurId]
  );
  await audit(client, tenantId, utilisateurId, "CLOTURE_EXERCICE", "exercice_comptable", exerciceId, ex, m.rows[0]);
  return m.rows[0];
}

async function rouvrirExercice(client, tenantId, utilisateurId, exerciceId) {
  const r = await client.query(
    `SELECT * FROM exercice_comptable WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [exerciceId, tenantId]
  );
  const ex = r.rows[0];
  if (!ex) throw new ComptaError("COMPTA_EXERCICE_INTROUVABLE", 404);
  if (ex.statut !== "CLOTURE") throw new ComptaError("COMPTA_EXERCICE_PAS_CLOTURE", 409);
  const m = await client.query(
    `UPDATE exercice_comptable SET statut = 'OUVERT', date_cloture = NULL, cloture_par = NULL
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [exerciceId, tenantId]
  );
  await audit(client, tenantId, utilisateurId, "REOUVERTURE_EXERCICE", "exercice_comptable", exerciceId, ex, m.rows[0]);
  return m.rows[0];
}

/** Exercice contenant une date, ou null. */
async function exerciceDeLaDate(client, tenantId, date) {
  const r = await client.query(
    `SELECT * FROM exercice_comptable WHERE tenant_id = $1 AND date_debut <= $2::date AND date_fin >= $2::date`,
    [tenantId, date]
  );
  return r.rows[0] || null;
}

// ----------------------------------------------------------------------------
// Journaux
// ----------------------------------------------------------------------------

const TYPES_JOURNAL = ["VENTES", "ACHATS", "BANQUE", "CAISSE", "OPERATIONS_DIVERSES", "A_NOUVEAUX"];

async function creerJournal(client, tenantId, utilisateurId, { code, libelle, type_journal, compte_tresorerie }) {
  const codeNet = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{1,5}$/.test(codeNet) || !libelle || !String(libelle).trim() || !TYPES_JOURNAL.includes(type_journal)) {
    throw new ComptaError("COMPTA_JOURNAL_CHAMPS_INVALIDES");
  }
  if (compte_tresorerie) await exigerCompteActif(client, tenantId, compte_tresorerie);
  const doublon = await client.query(`SELECT 1 FROM journal_comptable WHERE tenant_id = $1 AND code = $2`, [tenantId, codeNet]);
  if (doublon.rows.length > 0) throw new ComptaError("COMPTA_JOURNAL_CODE_EXISTE", 409);
  const r = await client.query(
    `INSERT INTO journal_comptable (id, tenant_id, code, libelle, type_journal, compte_tresorerie)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [uuidv4(), tenantId, codeNet, String(libelle).trim(), type_journal, compte_tresorerie || null]
  );
  await audit(client, tenantId, utilisateurId, "CREATION_JOURNAL", "journal_comptable", r.rows[0].id, null, r.rows[0]);
  return r.rows[0];
}

async function modifierJournal(client, tenantId, utilisateurId, id, patch) {
  const r = await client.query(`SELECT * FROM journal_comptable WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  const avant = r.rows[0];
  if (!avant) throw new ComptaError("COMPTA_JOURNAL_INTROUVABLE", 404);
  if (patch.compte_tresorerie) await exigerCompteActif(client, tenantId, patch.compte_tresorerie);
  const m = await client.query(
    `UPDATE journal_comptable
     SET libelle = COALESCE($3, libelle),
         compte_tresorerie = CASE WHEN $4::boolean THEN $5 ELSE compte_tresorerie END,
         actif = COALESCE($6, actif)
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [
      id,
      tenantId,
      patch.libelle && String(patch.libelle).trim() ? String(patch.libelle).trim() : null,
      patch.compte_tresorerie !== undefined,
      patch.compte_tresorerie || null,
      typeof patch.actif === "boolean" ? patch.actif : null,
    ]
  );
  await audit(client, tenantId, utilisateurId, "MODIFICATION_JOURNAL", "journal_comptable", id, avant, m.rows[0]);
  return m.rows[0];
}

// ----------------------------------------------------------------------------
// Plan comptable
// ----------------------------------------------------------------------------

async function exigerCompteActif(client, tenantId, numero) {
  const r = await client.query(
    `SELECT id FROM compte_comptable WHERE tenant_id = $1 AND numero = $2 AND actif = true`,
    [tenantId, String(numero)]
  );
  if (r.rows.length === 0) throw new ComptaError("COMPTA_COMPTE_INTROUVABLE", 400, { numero });
  return r.rows[0].id;
}

/**
 * Prochain numero libre "en dessous" d'un compte : on garde les chiffres
 * significatifs du compte parent (41110000 -> 4111) et on prend le plus grand
 * numero deja present sous ce prefixe + 1 (ex 41110001, puis 41110002...).
 */
async function prochainNumeroCompte(client, tenantId, numeroParent) {
  const p = await exigerInitialise(client, tenantId);
  const longueur = p.longueur_compte;
  const parent = String(numeroParent || "").trim();
  if (!/^\d+$/.test(parent)) throw new ComptaError("COMPTA_NUMERO_INVALIDE");
  const significatif = parent.replace(/0+$/, "") || parent.slice(0, 1);
  const r = await client.query(
    `SELECT MAX(numero::bigint) AS max FROM compte_comptable
     WHERE tenant_id = $1 AND numero LIKE $2 AND length(numero) = $3`,
    [tenantId, `${significatif}%`, longueur]
  );
  const base = r.rows[0].max !== null ? BigInt(r.rows[0].max) : BigInt(significatif.padEnd(longueur, "0"));
  const suivant = String(base + 1n).padStart(longueur, "0");
  if (!suivant.startsWith(significatif)) throw new ComptaError("COMPTA_COMPTE_PLEIN", 409);
  return suivant;
}

async function creerCompte(client, tenantId, utilisateurId, data) {
  const p = await exigerInitialise(client, tenantId);
  const longueur = p.longueur_compte;
  let numero = data.numero ? String(data.numero).trim() : null;
  if (!numero && data.numero_parent) numero = await prochainNumeroCompte(client, tenantId, data.numero_parent);
  const libelle = data.libelle ? String(data.libelle).trim() : "";
  if (!numero || !libelle) throw new ComptaError("COMPTA_COMPTE_CHAMPS_REQUIS");
  if (!/^[1-9]\d*$/.test(numero) || numero.length !== longueur) {
    throw new ComptaError("COMPTA_NUMERO_LONGUEUR", 400, { longueur });
  }
  const doublon = await client.query(`SELECT 1 FROM compte_comptable WHERE tenant_id = $1 AND numero = $2`, [tenantId, numero]);
  if (doublon.rows.length > 0) throw new ComptaError("COMPTA_COMPTE_EXISTE", 409);

  const prefixe = numero.replace(/0+$/, "");
  const nature = data.nature || natureCompte(prefixe);
  const natures = ["GENERAL", "COLLECTIF_CLIENT", "COLLECTIF_FOURNISSEUR", "TRESORERIE"];
  if (!natures.includes(nature)) throw new ComptaError("COMPTA_COMPTE_CHAMPS_REQUIS");
  const classe = Number(numero[0]);
  const p2 = numero.slice(0, 2);
  const r = await client.query(
    `INSERT INTO compte_comptable
       (id, tenant_id, numero, libelle, classe, nature, sens_normal, lettrable, tiers_obligatoire, analytique, est_systeme)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false) RETURNING *`,
    [
      uuidv4(),
      tenantId,
      numero,
      libelle,
      classe,
      nature,
      data.sens_normal || sensNormal(prefixe),
      typeof data.lettrable === "boolean" ? data.lettrable : ["40", "41", "42", "43", "44", "45", "46", "47", "48"].includes(p2),
      typeof data.tiers_obligatoire === "boolean" ? data.tiers_obligatoire : nature === "COLLECTIF_CLIENT" || nature === "COLLECTIF_FOURNISSEUR",
      typeof data.analytique === "boolean" ? data.analytique : classe === 6 || classe === 7,
    ]
  );
  await audit(client, tenantId, utilisateurId, "CREATION_COMPTE", "compte_comptable", r.rows[0].id, null, r.rows[0]);
  return r.rows[0];
}

async function compteEstUtilise(client, tenantId, compteId) {
  const r = await client.query(`SELECT 1 FROM ligne_ecriture WHERE tenant_id = $1 AND compte_id = $2 LIMIT 1`, [tenantId, compteId]);
  return r.rows.length > 0;
}

async function compteEstReference(client, tenantId, numero) {
  const r = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM compta_parametre WHERE tenant_id = $1 AND $2 IN
          (compte_vente_defaut, compte_client_collectif, compte_fournisseur_collectif, compte_acompte_client, compte_acompte_fournisseur, compte_tva_collectee))
     + (SELECT COUNT(*) FROM compta_regle_compte_vente WHERE tenant_id = $1 AND compte_numero = $2)
     + (SELECT COUNT(*) FROM journal_comptable WHERE tenant_id = $1 AND compte_tresorerie = $2)
     + (SELECT COUNT(*) FROM tiers_comptable WHERE tenant_id = $1 AND compte_collectif = $2) AS n`,
    [tenantId, numero]
  );
  return Number(r.rows[0].n) > 0;
}

/**
 * Modification d'un compte. Regles (decision de Steeve : le Directeur
 * Financier doit pouvoir donner son accord sur toute modification du plan) :
 *  - le NUMERO et la NATURE ne changent que si le compte n'a aucune ecriture
 *    et n'est reference ni par les parametres, ni par un journal, ni par un
 *    tiers ;
 *  - le libelle et les attributs (lettrable, analytique, sens...) restent
 *    modifiables meme si le compte est utilise ;
 *  - desactiver un compte reference par les parametres/journaux/tiers est
 *    refuse.
 * La verification du niveau d'autorisation (validation) est faite par la route.
 */
async function modifierCompte(client, tenantId, utilisateurId, id, patch) {
  const r = await client.query(`SELECT * FROM compte_comptable WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  const avant = r.rows[0];
  if (!avant) throw new ComptaError("COMPTA_COMPTE_INTROUVABLE", 404);
  const p = await exigerInitialise(client, tenantId);

  const nouveauNumero = patch.numero !== undefined ? String(patch.numero).trim() : avant.numero;
  const changeNumero = nouveauNumero !== avant.numero;
  const changeNature = patch.nature !== undefined && patch.nature !== avant.nature;
  if (changeNumero || changeNature) {
    if ((await compteEstUtilise(client, tenantId, id)) || (await compteEstReference(client, tenantId, avant.numero))) {
      throw new ComptaError("COMPTA_COMPTE_VERROUILLE", 409);
    }
  }
  if (changeNumero) {
    if (!/^[1-9]\d*$/.test(nouveauNumero) || nouveauNumero.length !== p.longueur_compte) {
      throw new ComptaError("COMPTA_NUMERO_LONGUEUR", 400, { longueur: p.longueur_compte });
    }
    const doublon = await client.query(`SELECT 1 FROM compte_comptable WHERE tenant_id = $1 AND numero = $2`, [tenantId, nouveauNumero]);
    if (doublon.rows.length > 0) throw new ComptaError("COMPTA_COMPTE_EXISTE", 409);
  }
  if (patch.actif === false && avant.actif && (await compteEstReference(client, tenantId, avant.numero))) {
    throw new ComptaError("COMPTA_COMPTE_REFERENCE", 409);
  }
  const natures = ["GENERAL", "COLLECTIF_CLIENT", "COLLECTIF_FOURNISSEUR", "TRESORERIE"];
  if (patch.nature !== undefined && !natures.includes(patch.nature)) throw new ComptaError("COMPTA_COMPTE_CHAMPS_REQUIS");
  if (patch.libelle !== undefined && !String(patch.libelle).trim()) throw new ComptaError("COMPTA_COMPTE_CHAMPS_REQUIS");

  const m = await client.query(
    `UPDATE compte_comptable
     SET numero = $3,
         libelle = COALESCE($4, libelle),
         classe = $5,
         nature = COALESCE($6, nature),
         sens_normal = CASE WHEN $7::boolean THEN $8 ELSE sens_normal END,
         lettrable = COALESCE($9, lettrable),
         tiers_obligatoire = COALESCE($10, tiers_obligatoire),
         analytique = COALESCE($11, analytique),
         actif = COALESCE($12, actif)
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [
      id,
      tenantId,
      nouveauNumero,
      patch.libelle !== undefined ? String(patch.libelle).trim() : null,
      Number(nouveauNumero[0]),
      patch.nature || null,
      patch.sens_normal !== undefined,
      patch.sens_normal || null,
      typeof patch.lettrable === "boolean" ? patch.lettrable : null,
      typeof patch.tiers_obligatoire === "boolean" ? patch.tiers_obligatoire : null,
      typeof patch.analytique === "boolean" ? patch.analytique : null,
      typeof patch.actif === "boolean" ? patch.actif : null,
    ]
  );
  await audit(client, tenantId, utilisateurId, "MODIFICATION_COMPTE", "compte_comptable", id, avant, m.rows[0]);
  return m.rows[0];
}

// ----------------------------------------------------------------------------
// Tiers (codes auxiliaires style Sage : CA001 clients, FB007 fournisseurs)
// ----------------------------------------------------------------------------

function initialeDuNom(nom) {
  const normalise = String(nom || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  const m = normalise.match(/[A-Z]/);
  return m ? m[0] : "X";
}

async function genererCodeTiers(client, tenantId, typeTiers, nom) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`tiers:${tenantId}`]);
  const lettre = typeTiers === "CLIENT" ? "C" : typeTiers === "FOURNISSEUR" ? "F" : "T";
  const prefixe = `${lettre}${initialeDuNom(nom)}`;
  const r = await client.query(`SELECT code FROM tiers_comptable WHERE tenant_id = $1 AND code LIKE $2`, [tenantId, `${prefixe}%`]);
  let max = 0;
  const re = new RegExp(`^${prefixe}(\\d+)$`);
  for (const row of r.rows) {
    const m = re.exec(row.code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefixe}${String(max + 1).padStart(3, "0")}`;
}

async function creerTiers(client, tenantId, { type_tiers, nom, client_commercial_id = null, fournisseur_id = null }) {
  const p = await exigerInitialise(client, tenantId);
  const collectif = type_tiers === "FOURNISSEUR" ? p.compte_fournisseur_collectif : p.compte_client_collectif;
  const code = await genererCodeTiers(client, tenantId, type_tiers, nom);
  const r = await client.query(
    `INSERT INTO tiers_comptable (id, tenant_id, type_tiers, code, nom, compte_collectif, client_commercial_id, fournisseur_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [uuidv4(), tenantId, type_tiers, code, String(nom).trim(), collectif, client_commercial_id, fournisseur_id]
  );
  return r.rows[0];
}

/** Cree (si absent) le tiers du client commercial et suit son nom. Idempotent. */
async function assurerTiersClient(client, tenantId, clientCommercial) {
  const e = await client.query(`SELECT * FROM tiers_comptable WHERE tenant_id = $1 AND client_commercial_id = $2`, [tenantId, clientCommercial.id]);
  if (e.rows[0]) {
    if (e.rows[0].nom !== clientCommercial.nom) {
      await client.query(`UPDATE tiers_comptable SET nom = $2 WHERE id = $1`, [e.rows[0].id, clientCommercial.nom]);
    }
    return e.rows[0];
  }
  return creerTiers(client, tenantId, { type_tiers: "CLIENT", nom: clientCommercial.nom, client_commercial_id: clientCommercial.id });
}

async function assurerTiersFournisseur(client, tenantId, fournisseur) {
  const e = await client.query(`SELECT * FROM tiers_comptable WHERE tenant_id = $1 AND fournisseur_id = $2`, [tenantId, fournisseur.id]);
  if (e.rows[0]) {
    if (e.rows[0].nom !== fournisseur.nom) {
      await client.query(`UPDATE tiers_comptable SET nom = $2 WHERE id = $1`, [e.rows[0].id, fournisseur.nom]);
    }
    return e.rows[0];
  }
  return creerTiers(client, tenantId, { type_tiers: "FOURNISSEUR", nom: fournisseur.nom, fournisseur_id: fournisseur.id });
}

/** Cree les tiers manquants pour tous les clients et fournisseurs de l'entreprise. */
async function synchroniserTiers(client, tenantId) {
  const clients = await client.query(`SELECT id, nom FROM client_commercial WHERE tenant_id = $1 ORDER BY date_creation, nom`, [tenantId]);
  let crees = 0;
  for (const c of clients.rows) {
    const avant = await client.query(`SELECT 1 FROM tiers_comptable WHERE client_commercial_id = $1`, [c.id]);
    await assurerTiersClient(client, tenantId, c);
    if (avant.rows.length === 0) crees++;
  }
  const fournisseurs = await client.query(`SELECT id, nom FROM fournisseur WHERE tenant_id = $1 ORDER BY nom`, [tenantId]);
  for (const f of fournisseurs.rows) {
    const avant = await client.query(`SELECT 1 FROM tiers_comptable WHERE fournisseur_id = $1`, [f.id]);
    await assurerTiersFournisseur(client, tenantId, f);
    if (avant.rows.length === 0) crees++;
  }
  return crees;
}

/**
 * Appel "au fil de l'eau" depuis les modules Ventes/Fournisseurs a la creation
 * ou au renommage d'un client/fournisseur : ne fait rien si la comptabilite
 * n'est pas initialisee, et ne fait JAMAIS echouer l'operation appelante.
 */
/**
 * Module Comptabilite vendu en option (migration 032) : vrai si le Super Admin
 * l'a active pour ce client. Les automatismes (ecritures de ventes, tiers)
 * ne font RIEN tant qu'il est verrouille ; le rattrapage des ventes
 * manquantes se fait a la reactivation (ecran "En instance").
 */
async function moduleComptabiliteActif(tenantId) {
  const r = await db.query(`SELECT module_comptabilite_actif FROM tenant WHERE id = $1`, [tenantId]);
  return !!r.rows[0]?.module_comptabilite_actif;
}

async function assurerTiersPourClientSilencieux(tenantId, clientCommercial) {
  try {
    if (!(await moduleComptabiliteActif(tenantId))) return;
    await avecTransaction(async (client) => {
      const p = await getParametre(client, tenantId);
      if (!p || !p.initialisee) return;
      await assurerTiersClient(client, tenantId, clientCommercial);
    });
  } catch (err) {
    console.error("Comptabilite : creation du tiers client impossible", err.message);
  }
}

async function assurerTiersPourFournisseurSilencieux(tenantId, fournisseur) {
  try {
    if (!(await moduleComptabiliteActif(tenantId))) return;
    await avecTransaction(async (client) => {
      const p = await getParametre(client, tenantId);
      if (!p || !p.initialisee) return;
      await assurerTiersFournisseur(client, tenantId, fournisseur);
    });
  } catch (err) {
    console.error("Comptabilite : creation du tiers fournisseur impossible", err.message);
  }
}

// ----------------------------------------------------------------------------
// Ecritures
// ----------------------------------------------------------------------------

/**
 * Normalise et controle les lignes saisies. Retourne la liste de lignes
 * { compte_id, tiers_id, libelle, debit_c, credit_c, date_echeance } (montants
 * en centimes). `strict` (validation) exige >= 2 lignes, un montant par
 * ligne et l'equilibre ; un brouillon peut etre incomplet.
 */
async function normaliserLignes(client, tenantId, lignesSaisies) {
  if (!Array.isArray(lignesSaisies)) throw new ComptaError("COMPTA_LIGNES_REQUISES");
  const lignes = [];
  for (let i = 0; i < lignesSaisies.length; i++) {
    const l = lignesSaisies[i] || {};
    let compteId = l.compte_id || null;
    if (!compteId && l.compte_numero) {
      const c = await client.query(`SELECT id FROM compte_comptable WHERE tenant_id = $1 AND numero = $2`, [tenantId, String(l.compte_numero).trim()]);
      compteId = c.rows[0]?.id || null;
      if (!compteId) throw new ComptaError("COMPTA_COMPTE_INTROUVABLE", 400, { numero: l.compte_numero });
    }
    if (!compteId) throw new ComptaError("COMPTA_LIGNE_COMPTE_REQUIS", 400, { ligne: i + 1 });
    const debit = versCentimes(l.debit);
    const credit = versCentimes(l.credit);
    if (Number.isNaN(debit) || Number.isNaN(credit) || debit < 0 || credit < 0) {
      throw new ComptaError("COMPTA_MONTANT_INVALIDE", 400, { ligne: i + 1 });
    }
    if (debit > 0 && credit > 0) throw new ComptaError("COMPTA_LIGNE_DEBIT_ET_CREDIT", 400, { ligne: i + 1 });
    if (l.date_echeance && !/^\d{4}-\d{2}-\d{2}$/.test(l.date_echeance)) {
      throw new ComptaError("COMPTA_DATE_INVALIDE", 400, { ligne: i + 1 });
    }
    lignes.push({
      compte_id: compteId,
      tiers_id: l.tiers_id || null,
      libelle: l.libelle ? String(l.libelle).trim() : null,
      debit_c: debit,
      credit_c: credit,
      date_echeance: l.date_echeance || null,
      analytique: Array.isArray(l.analytique) && l.analytique.length > 0 ? l.analytique : null,
    });
  }
  return lignes;
}

async function insererLignes(client, tenantId, ecritureId, lignes) {
  const ventilation = require("./comptaVentilation");
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    const ligneId = uuidv4();
    await client.query(
      `INSERT INTO ligne_ecriture (id, tenant_id, ecriture_id, ordre, compte_id, tiers_id, libelle, debit, credit, date_echeance, compte_modifiable)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        ligneId,
        tenantId,
        ecritureId,
        i + 1,
        l.compte_id,
        l.tiers_id,
        l.libelle,
        centimesVersDecimal(l.debit_c),
        centimesVersDecimal(l.credit_c),
        l.date_echeance,
        l.compte_modifiable || null,
      ]
    );
    // Analytique (phase 3C) : ventilation saisie, ou recopie inversee d'une ligne d'origine (extourne, annulation).
    if (l.analytique_inverse_de) await ventilation.copierInverse(client, tenantId, l.analytique_inverse_de, ligneId);
    else if (Array.isArray(l.analytique) && l.analytique.length > 0) {
      await ventilation.ventilerLigne(client, tenantId, ligneId, l.compte_id, l.debit_c, l.credit_c, l.analytique);
    }
  }
}

async function resoudreJournalEtExercice(client, tenantId, data) {
  if (!data.journal_id) throw new ComptaError("COMPTA_JOURNAL_REQUIS");
  if (!data.date_ecriture || !/^\d{4}-\d{2}-\d{2}$/.test(data.date_ecriture)) throw new ComptaError("COMPTA_DATE_INVALIDE");
  if (!data.libelle || !String(data.libelle).trim()) throw new ComptaError("COMPTA_LIBELLE_REQUIS");
  const j = await client.query(`SELECT * FROM journal_comptable WHERE id = $1 AND tenant_id = $2 AND actif = true`, [data.journal_id, tenantId]);
  const journal = j.rows[0];
  if (!journal) throw new ComptaError("COMPTA_JOURNAL_INTROUVABLE", 404);
  const exercice = await exerciceDeLaDate(client, tenantId, data.date_ecriture);
  if (!exercice) throw new ComptaError("COMPTA_EXERCICE_INTROUVABLE", 400);
  if (exercice.statut === "CLOTURE") throw new ComptaError("COMPTA_EXERCICE_CLOTURE", 409);
  return { journal, exercice };
}

async function creerBrouillon(client, tenantId, utilisateurId, data) {
  await exigerInitialise(client, tenantId);
  const { journal, exercice } = await resoudreJournalEtExercice(client, tenantId, data);
  const lignes = await normaliserLignes(client, tenantId, data.lignes || []);
  const r = await client.query(
    `INSERT INTO ecriture_comptable (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'BROUILLON', 'SAISIE', $8) RETURNING *`,
    [uuidv4(), tenantId, exercice.id, journal.id, data.numero_piece ? String(data.numero_piece).trim() : null, data.date_ecriture, String(data.libelle).trim(), utilisateurId]
  );
  await insererLignes(client, tenantId, r.rows[0].id, lignes);
  return r.rows[0];
}

async function modifierBrouillon(client, tenantId, utilisateurId, id, data) {
  const r = await client.query(`SELECT * FROM ecriture_comptable WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  const ecriture = r.rows[0];
  if (!ecriture) throw new ComptaError("COMPTA_ECRITURE_INTROUVABLE", 404);
  if (ecriture.statut !== "BROUILLON") throw new ComptaError("COMPTA_ECRITURE_NON_MODIFIABLE", 409);
  const { journal, exercice } = await resoudreJournalEtExercice(client, tenantId, data);
  const lignes = await normaliserLignes(client, tenantId, data.lignes || []);
  await client.query(
    `UPDATE ecriture_comptable
     SET exercice_id = $3, journal_id = $4, numero_piece = $5, date_ecriture = $6, libelle = $7
     WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId, exercice.id, journal.id, data.numero_piece ? String(data.numero_piece).trim() : null, data.date_ecriture, String(data.libelle).trim()]
  );
  await client.query(`DELETE FROM ligne_ecriture WHERE ecriture_id = $1`, [id]);
  await insererLignes(client, tenantId, id, lignes);
  return (await client.query(`SELECT * FROM ecriture_comptable WHERE id = $1`, [id])).rows[0];
}

async function supprimerBrouillon(client, tenantId, utilisateurId, id) {
  const r = await client.query(`SELECT * FROM ecriture_comptable WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  const ecriture = r.rows[0];
  if (!ecriture) throw new ComptaError("COMPTA_ECRITURE_INTROUVABLE", 404);
  if (ecriture.statut !== "BROUILLON") throw new ComptaError("COMPTA_ECRITURE_NON_SUPPRIMABLE", 409);
  await client.query(`DELETE FROM ecriture_comptable WHERE id = $1`, [id]);
}

/** Prochain numero d'ecriture continu pour (exercice, journal), dans la transaction courante. */
async function tirerNumeroEcriture(client, tenantId, exerciceId, journalCode) {
  const type = `ECR:${exerciceId}:${journalCode}`;
  await client.query(
    `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero)
     VALUES ($1, $2, 0, 0) ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
    [tenantId, type]
  );
  const r = await client.query(
    `UPDATE compteur_numerotation SET dernier_numero = dernier_numero + 1
     WHERE tenant_id = $1 AND type_compteur = $2 AND annee = 0 RETURNING dernier_numero`,
    [tenantId, type]
  );
  return r.rows[0].dernier_numero;
}

/**
 * Valide une ecriture : controles complets puis attribution du numero continu.
 * Accepte BROUILLON et EN_INSTANCE (ecritures automatiques des phases suivantes).
 */
async function validerEcriture(client, tenantId, utilisateurId, id) {
  const r = await client.query(`SELECT * FROM ecriture_comptable WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  const ecriture = r.rows[0];
  if (!ecriture) throw new ComptaError("COMPTA_ECRITURE_INTROUVABLE", 404);
  if (ecriture.statut === "VALIDEE") throw new ComptaError("COMPTA_ECRITURE_DEJA_VALIDEE", 409);

  const ex = await client.query(`SELECT * FROM exercice_comptable WHERE id = $1`, [ecriture.exercice_id]);
  const exercice = ex.rows[0];
  if (exercice.statut === "CLOTURE") throw new ComptaError("COMPTA_EXERCICE_CLOTURE", 409);
  if (ecriture.date_ecriture < exercice.date_debut || ecriture.date_ecriture > exercice.date_fin) {
    throw new ComptaError("COMPTA_DATE_HORS_EXERCICE", 409);
  }
  const jr = await client.query(`SELECT * FROM journal_comptable WHERE id = $1`, [ecriture.journal_id]);
  const journal = jr.rows[0];
  if (!journal.actif) throw new ComptaError("COMPTA_JOURNAL_INACTIF", 409);

  const lr = await client.query(
    `SELECT l.*, c.numero AS compte_numero, c.actif AS compte_actif, c.nature AS compte_nature,
            c.tiers_obligatoire, t.type_tiers
     FROM ligne_ecriture l
     JOIN compte_comptable c ON c.id = l.compte_id
     LEFT JOIN tiers_comptable t ON t.id = l.tiers_id
     WHERE l.ecriture_id = $1 ORDER BY l.ordre`,
    [id]
  );
  const lignes = lr.rows;
  if (lignes.length < 2) throw new ComptaError("COMPTA_ECRITURE_MIN_DEUX_LIGNES", 409);
  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of lignes) {
    const d = versCentimes(l.debit);
    const c = versCentimes(l.credit);
    if (d === 0 && c === 0) throw new ComptaError("COMPTA_LIGNE_MONTANT_REQUIS", 409, { ligne: l.ordre });
    if (!l.compte_actif) throw new ComptaError("COMPTA_COMPTE_INACTIF", 409, { numero: l.compte_numero });
    if (l.tiers_obligatoire) {
      if (!l.tiers_id) throw new ComptaError("COMPTA_TIERS_REQUIS", 409, { numero: l.compte_numero, ligne: l.ordre });
      const attendu = l.compte_nature === "COLLECTIF_CLIENT" ? "CLIENT" : "FOURNISSEUR";
      if (l.type_tiers !== attendu && l.type_tiers !== "AUTRE") {
        throw new ComptaError("COMPTA_TIERS_INCOHERENT", 409, { numero: l.compte_numero, ligne: l.ordre });
      }
    }
    totalDebit += d;
    totalCredit += c;
  }
  if (totalDebit !== totalCredit) {
    throw new ComptaError("COMPTA_ECRITURE_DESEQUILIBREE", 409, {
      debit: centimesVersDecimal(totalDebit),
      credit: centimesVersDecimal(totalCredit),
    });
  }
  if (totalDebit === 0) throw new ComptaError("COMPTA_ECRITURE_MONTANT_NUL", 409);

  const numero = await tirerNumeroEcriture(client, tenantId, ecriture.exercice_id, journal.code);
  const m = await client.query(
    `UPDATE ecriture_comptable
     SET statut = 'VALIDEE', numero_ecriture = $3, valide_par = $4, date_validation = now()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenantId, numero, utilisateurId]
  );
  await audit(client, tenantId, utilisateurId, "VALIDATION_ECRITURE", "ecriture_comptable", id, { statut: ecriture.statut }, {
    statut: "VALIDEE",
    journal: journal.code,
    numero_ecriture: numero,
  });
  return m.rows[0];
}

/** Extourne (contre-passation) d'une ecriture validee : nouvelle ecriture inversee, validee immediatement. */
async function extournerEcriture(client, tenantId, utilisateurId, id, { date_ecriture, libelle } = {}) {
  const r = await client.query(`SELECT * FROM ecriture_comptable WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  const orig = r.rows[0];
  if (!orig) throw new ComptaError("COMPTA_ECRITURE_INTROUVABLE", 404);
  if (orig.statut !== "VALIDEE") throw new ComptaError("COMPTA_EXTOURNE_NON_VALIDEE", 409);
  if (orig.extournee_par_id) throw new ComptaError("COMPTA_EXTOURNE_DEJA_FAITE", 409);
  if (orig.extourne_de_id) throw new ComptaError("COMPTA_EXTOURNE_IMPOSSIBLE", 409);

  const date = date_ecriture || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ComptaError("COMPTA_DATE_INVALIDE");
  const exercice = await exerciceDeLaDate(client, tenantId, date);
  if (!exercice) throw new ComptaError("COMPTA_EXERCICE_INTROUVABLE", 400);
  if (exercice.statut === "CLOTURE") throw new ComptaError("COMPTA_EXERCICE_CLOTURE", 409);

  const ex = await client.query(
    `INSERT INTO ecriture_comptable
       (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, extourne_de_id, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'BROUILLON', 'EXTOURNE', $8, 'EXTOURNE', $8, $9)
     RETURNING *`,
    [
      uuidv4(),
      tenantId,
      exercice.id,
      orig.journal_id,
      orig.numero_piece,
      date,
      libelle && String(libelle).trim() ? String(libelle).trim() : `Extourne : ${orig.libelle}`,
      orig.id,
      utilisateurId,
    ]
  );
  const lignes = await client.query(`SELECT * FROM ligne_ecriture WHERE ecriture_id = $1 ORDER BY ordre`, [id]);
  await insererLignes(
    client,
    tenantId,
    ex.rows[0].id,
    lignes.rows.map((l) => ({
      compte_id: l.compte_id,
      tiers_id: l.tiers_id,
      libelle: l.libelle,
      debit_c: versCentimes(l.credit),
      credit_c: versCentimes(l.debit),
      date_echeance: l.date_echeance ? String(l.date_echeance).slice(0, 10) : null,
      analytique_inverse_de: l.id,
    }))
  );
  const validee = await validerEcriture(client, tenantId, utilisateurId, ex.rows[0].id);
  await client.query(`UPDATE ecriture_comptable SET extournee_par_id = $2 WHERE id = $1`, [id, validee.id]);
  await audit(client, tenantId, utilisateurId, "EXTOURNE_ECRITURE", "ecriture_comptable", id, null, { extourne_id: validee.id });
  return validee;
}

async function lireEcriture(client, tenantId, id) {
  const r = await client.query(
    `SELECT e.*, j.code AS journal_code, j.libelle AS journal_libelle, x.libelle AS exercice_libelle,
            x.statut AS exercice_statut
     FROM ecriture_comptable e
     JOIN journal_comptable j ON j.id = e.journal_id
     JOIN exercice_comptable x ON x.id = e.exercice_id
     WHERE e.id = $1 AND e.tenant_id = $2`,
    [id, tenantId]
  );
  const ecriture = r.rows[0];
  if (!ecriture) return null;
  const l = await client.query(
    `SELECT l.*, c.numero AS compte_numero, c.libelle AS compte_libelle, c.nature AS compte_nature,
            t.code AS tiers_code, t.nom AS tiers_nom
     FROM ligne_ecriture l
     JOIN compte_comptable c ON c.id = l.compte_id
     LEFT JOIN tiers_comptable t ON t.id = l.tiers_id
     WHERE l.ecriture_id = $1 ORDER BY l.ordre`,
    [id]
  );
  // Ventilation analytique de chaque ligne (phase 3C) : [{ section_id, code, libelle, montant (positif) }]
  const v = await client.query(
    `SELECT v.ligne_ecriture_id, v.section_id, v.montant, s.code, s.libelle
     FROM ventilation_analytique v JOIN section_analytique s ON s.id = v.section_id
     JOIN ligne_ecriture l ON l.id = v.ligne_ecriture_id
     WHERE l.ecriture_id = $1 ORDER BY s.code`,
    [id]
  );
  for (const ligne of l.rows) {
    ligne.analytique = v.rows
      .filter((x) => x.ligne_ecriture_id === ligne.id)
      .map((x) => ({ section_id: x.section_id, code: x.code, libelle: x.libelle, montant: Math.abs(Number(x.montant)) }));
  }
  ecriture.lignes = l.rows;
  return ecriture;
}

module.exports = {
  ComptaError,
  avecTransaction,
  versCentimes,
  centimesVersDecimal,
  audit,
  getParametre,
  exigerInitialise,
  initialiserComptabilite,
  modifierParametre,
  creerExercice,
  cloturerExercice,
  rouvrirExercice,
  exerciceDeLaDate,
  creerJournal,
  modifierJournal,
  prochainNumeroCompte,
  creerCompte,
  modifierCompte,
  synchroniserTiers,
  assurerTiersClient,
  assurerTiersFournisseur,
  moduleComptabiliteActif,
  assurerTiersPourClientSilencieux,
  assurerTiersPourFournisseurSilencieux,
  creerBrouillon,
  insererLignes,
  completerNumero,
  creerTiers,
  tirerNumeroEcriture,
  modifierBrouillon,
  supprimerBrouillon,
  validerEcriture,
  extournerEcriture,
  lireEcriture,
  TYPES_JOURNAL,
};
