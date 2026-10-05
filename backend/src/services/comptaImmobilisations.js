/**
 * Immobilisations et amortissements (phase 4).
 *
 * - Fiches creees depuis une ligne d'ecriture de classe 2 ("A immobiliser") ou
 *   saisies en reprise (valeur d'origine + amortissements cumules a une date de
 *   situation).
 * - Amortissement lineaire au prorata des jours, base 360 (mois de 30 jours) :
 *   cumul theorique a une date = base amortissable x jours ecoules / (duree en
 *   mois x 30).
 * - Dotations en lot par exercice : UNE ecriture EN_INSTANCE (681x / 28xx) ;
 *   idempotent (immobilisation_dotation garantit qu'un bien n'est dote qu'une
 *   fois par exercice).
 * - Sortie (cession ou mise au rebut) : dotation complementaire jusqu'a la date
 *   de sortie, sortie du brut et des amortissements, valeur comptable (81x) et
 *   produit de cession (82x) ; plus ou moins-value = produit - VNC.
 * Montants en centimes entiers ; dates ISO (colonnes DATE renvoyees en texte).
 */
const { v4: uuidv4 } = require("uuid");
const compta = require("./comptaService");

const { ComptaError, versCentimes, centimesVersDecimal } = compta;
const dec = (c) => c / 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Calendrier 30/360
// ---------------------------------------------------------------------------

function parties(iso) {
  const [a, m, j] = String(iso).slice(0, 10).split("-").map(Number);
  return { a, m, j };
}
function dernierJourDuMois(a, m) {
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}
/** Jour retenu en base 360 : dernier jour du mois -> 30. */
function jour360(p) {
  return p.j >= 30 || p.j === dernierJourDuMois(p.a, p.m) ? 30 : p.j;
}
/** Jours 30/360 entre deux dates (debut inclus, fin exclue). */
function jours360(debut, fin) {
  const d = parties(debut);
  const f = parties(fin);
  return (f.a - d.a) * 360 + (f.m - d.m) * 30 + (jour360(f) - jour360(d));
}
function jourPrecedent(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function jourSuivant(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Cumul theorique d'amortissement (centimes) a la fin du jour `date` incluse. */
function cumulTheorique(fiche, date) {
  if (!fiche.duree_mois || !fiche.amortissable) return 0;
  const base = fiche.valeur_origine_c - fiche.valeur_residuelle_c;
  if (base <= 0 || date < fiche.date_mise_en_service) return 0;
  const total = fiche.duree_mois * 30;
  const ecoules = Math.min(jours360(fiche.date_mise_en_service, jourSuivant(date)), total);
  if (ecoules <= 0) return 0;
  return Number((BigInt(base) * BigInt(ecoules) + BigInt(Math.floor(total / 2))) / BigInt(total));
}

// ---------------------------------------------------------------------------
// Suggestions par compte (durees usuelles, comptes d'amortissement / dotation)
// ---------------------------------------------------------------------------

function suggestionPourCompte(numero) {
  const n = String(numero);
  const racine = n.slice(0, 3);
  let duree = null;
  if (n.startsWith("21")) {
    if (racine === "215" || racine === "216") duree = null;
    else if (racine === "213") duree = 36;
    else duree = 60;
  } else if (n.startsWith("23")) {
    duree = racine === "234" || racine === "235" || racine === "238" ? 120 : 240;
  } else if (n.startsWith("24")) {
    const q = n.slice(0, 4);
    duree = q === "2442" ? 36 : q === "2444" ? 120 : 60;
  }
  const amortissable = duree !== null;
  return {
    amortissable,
    duree_mois: duree,
    racine_amort: amortissable ? `28${n.slice(1, 3)}` : null,
    racine_dotation: amortissable ? (n.startsWith("21") ? "6812" : "6813") : null,
  };
}

async function trouverCompte(client, tenantId, racine, longueur) {
  if (!racine) return null;
  const exact = await client.query(`SELECT * FROM compte_comptable WHERE tenant_id = $1 AND numero = $2`, [tenantId, compta.completerNumero(racine, longueur)]);
  if (exact.rows[0]) return exact.rows[0];
  const like = await client.query(`SELECT * FROM compte_comptable WHERE tenant_id = $1 AND numero LIKE $2 AND actif = true ORDER BY numero LIMIT 1`, [tenantId, `${racine}%`]);
  return like.rows[0] || null;
}

const estCompteImmo = (numero) => /^2[1-7]/.test(numero);

// ---------------------------------------------------------------------------
// Lecture des fiches
// ---------------------------------------------------------------------------

const SELECT_FICHE = `
  SELECT i.*, ci.numero AS compte_immo_numero, ci.libelle AS compte_immo_libelle,
         ca.numero AS compte_amort_numero, cd.numero AS compte_dotation_numero
  FROM immobilisation i
  JOIN compte_comptable ci ON ci.id = i.compte_immo_id
  LEFT JOIN compte_comptable ca ON ca.id = i.compte_amort_id
  LEFT JOIN compte_comptable cd ON cd.id = i.compte_dotation_id`;

function normaliserFiche(r) {
  return {
    ...r,
    amortissable: !!r.compte_amort_id && !!r.duree_mois,
    valeur_origine_c: versCentimes(r.valeur_origine),
    valeur_residuelle_c: versCentimes(r.valeur_residuelle),
    amort_ouverture_c: versCentimes(r.amort_ouverture),
  };
}

async function chargerFiches(client, tenantId, { id, statut } = {}) {
  const params = [tenantId];
  let filtre = "";
  if (id) {
    params.push(id);
    filtre += ` AND i.id = $${params.length}`;
  }
  if (statut) {
    params.push(statut);
    filtre += ` AND i.statut = $${params.length}`;
  }
  const r = await client.query(`${SELECT_FICHE} WHERE i.tenant_id = $1 ${filtre} ORDER BY i.code`, params);
  return r.rows.map(normaliserFiche);
}

async function chargerDotations(client, tenantId, ficheIds) {
  if (ficheIds.length === 0) return [];
  const r = await client.query(
    `SELECT d.*, x.date_debut AS exercice_debut, x.date_fin AS exercice_fin, x.libelle AS exercice_libelle,
            e.statut AS ecriture_statut
     FROM immobilisation_dotation d
     JOIN exercice_comptable x ON x.id = d.exercice_id
     LEFT JOIN ecriture_comptable e ON e.id = d.ecriture_id
     WHERE d.tenant_id = $1 AND d.immobilisation_id = ANY($2::uuid[])`,
    [tenantId, ficheIds]
  );
  return r.rows.map((d) => ({ ...d, montant_c: versCentimes(d.montant) }));
}

function presenterFiche(f, dotations, aujourdhui) {
  const mes = dotations.filter((d) => d.immobilisation_id === f.id);
  const cumulBooked = (f.date_ouverture ? f.amort_ouverture_c : 0) + mes.reduce((a, d) => a + d.montant_c, 0);
  const cumulTheo = f.statut === "SORTIE" ? null : cumulTheorique(f, aujourdhui);
  return {
    id: f.id,
    code: f.code,
    libelle: f.libelle,
    compte_immo_numero: f.compte_immo_numero,
    compte_immo_libelle: f.compte_immo_libelle,
    compte_amort_numero: f.compte_amort_numero,
    compte_dotation_numero: f.compte_dotation_numero,
    date_acquisition: f.date_acquisition,
    date_mise_en_service: f.date_mise_en_service,
    valeur_origine: dec(f.valeur_origine_c),
    valeur_residuelle: dec(f.valeur_residuelle_c),
    duree_mois: f.duree_mois,
    amortissable: f.amortissable,
    amort_ouverture: dec(f.amort_ouverture_c),
    date_ouverture: f.date_ouverture,
    ligne_ecriture_id: f.ligne_ecriture_id,
    statut: f.statut,
    date_sortie: f.date_sortie,
    type_sortie: f.type_sortie,
    produit_cession: f.produit_cession === null ? null : Number(f.produit_cession),
    vnc_sortie: f.vnc_sortie === null ? null : Number(f.vnc_sortie),
    amort_comptabilise: dec(cumulBooked),
    vnc_comptable: dec(f.valeur_origine_c - cumulBooked),
    cumul_theorique: cumulTheo === null ? null : dec(cumulTheo),
    nb_dotations: mes.length,
    modifiable: mes.length === 0 && f.statut === "EN_SERVICE",
  };
}

async function listerFiches(client, tenantId, { statut, q } = {}) {
  const fiches = await chargerFiches(client, tenantId, { statut });
  const dots = await chargerDotations(client, tenantId, fiches.map((f) => f.id));
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const mot = q ? String(q).toLowerCase() : null;
  return fiches
    .filter((f) => !mot || f.libelle.toLowerCase().includes(mot) || f.code.toLowerCase().includes(mot) || f.compte_immo_numero.startsWith(mot))
    .map((f) => presenterFiche(f, dots, aujourdhui));
}

async function lireFiche(client, tenantId, id) {
  const fiches = await chargerFiches(client, tenantId, { id });
  if (fiches.length === 0) throw new ComptaError("COMPTA_IMMO_INTROUVABLE", 404);
  const f = fiches[0];
  const dots = await chargerDotations(client, tenantId, [f.id]);
  const fiche = presenterFiche(f, dots, new Date().toISOString().slice(0, 10));
  fiche.dotations = dots
    .sort((a, b) => (a.exercice_debut < b.exercice_debut ? -1 : 1))
    .map((d) => ({ exercice_libelle: d.exercice_libelle, nature: d.nature, montant: dec(d.montant_c), ecriture_id: d.ecriture_id, ecriture_statut: d.ecriture_statut }));
  return fiche;
}

// ---------------------------------------------------------------------------
// Lignes de classe 2 "A immobiliser"
// ---------------------------------------------------------------------------

async function listerAImmobiliser(client, tenantId, { inclure_ignorees = false } = {}) {
  const parametre = await compta.getParametre(client, tenantId);
  const longueur = parametre?.longueur_compte || 8;
  const r = await client.query(
    `SELECT l.id AS ligne_id, l.libelle AS ligne_libelle, l.debit, e.id AS ecriture_id, e.date_ecriture, e.numero_piece,
            e.libelle AS ecriture_libelle, e.statut, j.type_journal, c.numero, c.libelle AS compte_libelle,
            (g.ligne_ecriture_id IS NOT NULL) AS ignoree
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN journal_comptable j ON j.id = e.journal_id
     JOIN compte_comptable c ON c.id = l.compte_id
     LEFT JOIN immobilisation i ON i.ligne_ecriture_id = l.id AND i.tenant_id = l.tenant_id
     LEFT JOIN immobilisation_ligne_ignoree g ON g.ligne_ecriture_id = l.id AND g.tenant_id = l.tenant_id
     WHERE l.tenant_id = $1 AND l.debit > 0 AND e.statut <> 'BROUILLON'
       AND c.numero ~ '^2[1-7]' AND i.id IS NULL
       ${inclure_ignorees ? "" : "AND g.ligne_ecriture_id IS NULL"}
     ORDER BY e.date_ecriture, c.numero, l.ordre`,
    [tenantId]
  );
  const lignes = [];
  for (const x of r.rows) {
    const s = suggestionPourCompte(x.numero);
    const amort = s.amortissable ? await trouverCompte(client, tenantId, s.racine_amort, longueur) : null;
    const dot = s.amortissable ? await trouverCompte(client, tenantId, s.racine_dotation, longueur) : null;
    // Debut de l'exercice de l'ecriture : date de situation proposee pour une reprise (a-nouveaux)
    let exercice_debut = null;
    if (x.type_journal === "A_NOUVEAUX") {
      const ex = await compta.exerciceDeLaDate(client, tenantId, x.date_ecriture);
      exercice_debut = ex ? ex.date_debut : null;
    }
    lignes.push({
      ligne_id: x.ligne_id,
      ecriture_id: x.ecriture_id,
      date: x.date_ecriture,
      numero_piece: x.numero_piece,
      libelle: x.ligne_libelle || x.ecriture_libelle,
      statut: x.statut,
      a_nouveaux: x.type_journal === "A_NOUVEAUX",
      compte_numero: x.numero,
      compte_libelle: x.compte_libelle,
      montant: Number(x.debit),
      ignoree: x.ignoree,
      suggestion: {
        amortissable: s.amortissable,
        duree_mois: s.duree_mois,
        compte_amort_numero: amort ? amort.numero : null,
        compte_dotation_numero: dot ? dot.numero : null,
        date_ouverture: exercice_debut,
      },
    });
  }
  return lignes;
}

async function ignorerLigne(client, tenantId, utilisateurId, ligneId, ignorer = true) {
  const l = await client.query(`SELECT id FROM ligne_ecriture WHERE id = $1 AND tenant_id = $2`, [ligneId, tenantId]);
  if (!l.rows[0]) throw new ComptaError("COMPTA_LIGNE_INTROUVABLE", 404);
  if (ignorer) {
    await client.query(`INSERT INTO immobilisation_ligne_ignoree (tenant_id, ligne_ecriture_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [tenantId, ligneId]);
  } else {
    await client.query(`DELETE FROM immobilisation_ligne_ignoree WHERE tenant_id = $1 AND ligne_ecriture_id = $2`, [tenantId, ligneId]);
  }
  await compta.audit(client, tenantId, utilisateurId, ignorer ? "IMMO_LIGNE_IGNOREE" : "IMMO_LIGNE_RESTAUREE", "ligne_ecriture", ligneId);
}

// ---------------------------------------------------------------------------
// Creation / modification des fiches
// ---------------------------------------------------------------------------

async function prochainCode(client, tenantId) {
  const r = await client.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '\\D', '', 'g'), '')::int), 0) + 1 AS n FROM immobilisation WHERE tenant_id = $1 AND code ~ '^IMM\\d+$'`,
    [tenantId]
  );
  return `IMM${String(r.rows[0].n).padStart(4, "0")}`;
}

async function compteParNumero(client, tenantId, numero, erreur) {
  const r = await client.query(`SELECT * FROM compte_comptable WHERE tenant_id = $1 AND numero = $2 AND actif = true`, [tenantId, String(numero || "").trim()]);
  if (!r.rows[0]) throw new ComptaError(erreur, 400, { numero });
  return r.rows[0];
}

/** Valide et normalise les donnees d'une fiche (creation ou modification). */
async function preparerDonnees(client, tenantId, data, existant = null) {
  const d = { ...(existant || {}), ...data };
  const libelle = String(d.libelle || "").trim();
  if (!libelle) throw new ComptaError("COMPTA_IMMO_LIBELLE_REQUIS");
  const compteImmo = d.compte_immo_id
    ? (await client.query(`SELECT * FROM compte_comptable WHERE id = $1 AND tenant_id = $2`, [d.compte_immo_id, tenantId])).rows[0]
    : await compteParNumero(client, tenantId, d.compte_immo_numero, "COMPTA_COMPTE_INTROUVABLE");
  if (!compteImmo || !estCompteImmo(compteImmo.numero)) throw new ComptaError("COMPTA_IMMO_COMPTE_CLASSE2", 400, { numero: compteImmo?.numero || d.compte_immo_numero });
  for (const k of ["date_acquisition", "date_mise_en_service"]) {
    if (!DATE_RE.test(String(d[k] || ""))) throw new ComptaError("COMPTA_DATE_INVALIDE");
  }
  const origine = versCentimes(d.valeur_origine);
  const residuelle = versCentimes(d.valeur_residuelle);
  const ouverture = versCentimes(d.amort_ouverture);
  if (Number.isNaN(origine) || origine <= 0 || Number.isNaN(residuelle) || residuelle < 0 || Number.isNaN(ouverture) || ouverture < 0) {
    throw new ComptaError("COMPTA_MONTANT_INVALIDE");
  }
  if (residuelle >= origine) throw new ComptaError("COMPTA_IMMO_RESIDUELLE_INVALIDE");
  const amortissable = !!d.duree_mois && Number(d.duree_mois) > 0;
  let compteAmort = null;
  let compteDotation = null;
  let duree = null;
  if (amortissable) {
    duree = Number(d.duree_mois);
    if (!Number.isInteger(duree) || duree <= 0 || duree > 1200) throw new ComptaError("COMPTA_IMMO_DUREE_INVALIDE");
    compteAmort = d.compte_amort_id
      ? (await client.query(`SELECT * FROM compte_comptable WHERE id = $1 AND tenant_id = $2`, [d.compte_amort_id, tenantId])).rows[0]
      : await compteParNumero(client, tenantId, d.compte_amort_numero, "COMPTA_COMPTE_INTROUVABLE");
    compteDotation = d.compte_dotation_id
      ? (await client.query(`SELECT * FROM compte_comptable WHERE id = $1 AND tenant_id = $2`, [d.compte_dotation_id, tenantId])).rows[0]
      : await compteParNumero(client, tenantId, d.compte_dotation_numero, "COMPTA_COMPTE_INTROUVABLE");
    if (!compteAmort || !/^(28|29)/.test(compteAmort.numero)) throw new ComptaError("COMPTA_IMMO_COMPTE_AMORT_INVALIDE");
    if (!compteDotation || !/^6[89]/.test(compteDotation.numero)) throw new ComptaError("COMPTA_IMMO_COMPTE_DOTATION_INVALIDE");
  } else if (ouverture > 0) {
    throw new ComptaError("COMPTA_IMMO_AMORT_SANS_DUREE");
  }
  let dateOuverture = d.date_ouverture || null;
  if (ouverture > 0 && !dateOuverture) throw new ComptaError("COMPTA_IMMO_DATE_SITUATION_REQUISE");
  if (dateOuverture && !DATE_RE.test(String(dateOuverture))) throw new ComptaError("COMPTA_DATE_INVALIDE");
  if (ouverture > origine - residuelle) throw new ComptaError("COMPTA_IMMO_AMORT_SUPERIEUR");
  if (d.date_mise_en_service < d.date_acquisition) throw new ComptaError("COMPTA_IMMO_DATES_INCOHERENTES");
  return {
    libelle,
    compte_immo_id: compteImmo.id,
    compte_amort_id: compteAmort ? compteAmort.id : null,
    compte_dotation_id: compteDotation ? compteDotation.id : null,
    date_acquisition: d.date_acquisition,
    date_mise_en_service: d.date_mise_en_service,
    valeur_origine: centimesVersDecimal(origine),
    valeur_residuelle: centimesVersDecimal(residuelle),
    duree_mois: duree,
    amort_ouverture: centimesVersDecimal(ouverture),
    date_ouverture: dateOuverture,
  };
}

async function creerFiche(client, tenantId, utilisateurId, data) {
  await compta.exigerInitialise(client, tenantId);
  let ligneId = data.ligne_ecriture_id || null;
  const donnees = { ...data };
  let dateReprise = null;
  if (ligneId) {
    const l = await client.query(
      `SELECT l.id, l.debit, l.libelle, e.date_ecriture, e.libelle AS ecriture_libelle, c.id AS compte_id, c.numero, j.type_journal
       FROM ligne_ecriture l JOIN ecriture_comptable e ON e.id = l.ecriture_id JOIN journal_comptable j ON j.id = e.journal_id JOIN compte_comptable c ON c.id = l.compte_id
       WHERE l.id = $1 AND l.tenant_id = $2`,
      [ligneId, tenantId]
    );
    const ligne = l.rows[0];
    if (!ligne) throw new ComptaError("COMPTA_LIGNE_INTROUVABLE", 404);
    if (!estCompteImmo(ligne.numero) || !(Number(ligne.debit) > 0)) throw new ComptaError("COMPTA_IMMO_LIGNE_INVALIDE");
    const deja = await client.query(`SELECT 1 FROM immobilisation WHERE tenant_id = $1 AND ligne_ecriture_id = $2`, [tenantId, ligneId]);
    if (deja.rows[0]) throw new ComptaError("COMPTA_IMMO_LIGNE_DEJA_IMMOBILISEE", 409);
    // La ligne fournit les valeurs par defaut (modifiables par l'utilisateur)
    donnees.compte_immo_id = donnees.compte_immo_id || ligne.compte_id;
    donnees.valeur_origine = donnees.valeur_origine ?? ligne.debit;
    donnees.date_acquisition = donnees.date_acquisition || ligne.date_ecriture;
    donnees.libelle = donnees.libelle || ligne.libelle || ligne.ecriture_libelle;
    if (ligne.type_journal === "A_NOUVEAUX") dateReprise = ligne.date_ecriture;
  }
  donnees.date_mise_en_service = donnees.date_mise_en_service || donnees.date_acquisition;
  const p = await preparerDonnees(client, tenantId, donnees);
  if (!dateReprise && p.date_ouverture) dateReprise = p.date_ouverture;
  const id = uuidv4();
  const code = await prochainCode(client, tenantId);
  const r = await client.query(
    `INSERT INTO immobilisation (id, tenant_id, code, libelle, compte_immo_id, compte_amort_id, compte_dotation_id, date_acquisition,
        date_mise_en_service, valeur_origine, valeur_residuelle, duree_mois, amort_ouverture, date_ouverture, ligne_ecriture_id, date_reprise)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [id, tenantId, code, p.libelle, p.compte_immo_id, p.compte_amort_id, p.compte_dotation_id, p.date_acquisition, p.date_mise_en_service,
      p.valeur_origine, p.valeur_residuelle, p.duree_mois, p.amort_ouverture, p.date_ouverture, ligneId, dateReprise]
  );
  await compta.audit(client, tenantId, utilisateurId, "IMMO_CREATION", "immobilisation", id, null, r.rows[0]);
  return lireFiche(client, tenantId, id);
}

async function modifierFiche(client, tenantId, utilisateurId, id, patch) {
  const r = await client.query(`SELECT * FROM immobilisation WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  const actuelle = r.rows[0];
  if (!actuelle) throw new ComptaError("COMPTA_IMMO_INTROUVABLE", 404);
  const nbDot = (await client.query(`SELECT COUNT(*)::int AS n FROM immobilisation_dotation WHERE immobilisation_id = $1`, [id])).rows[0].n;
  if (nbDot > 0 || actuelle.statut !== "EN_SERVICE") {
    // Fiche deja amortie ou sortie : seul le libelle reste modifiable.
    const libelle = patch.libelle === undefined ? actuelle.libelle : String(patch.libelle || "").trim();
    if (!libelle) throw new ComptaError("COMPTA_IMMO_LIBELLE_REQUIS");
    await client.query(`UPDATE immobilisation SET libelle = $3 WHERE id = $1 AND tenant_id = $2`, [id, tenantId, libelle]);
    await compta.audit(client, tenantId, utilisateurId, "IMMO_MODIFICATION", "immobilisation", id, { libelle: actuelle.libelle }, { libelle });
    return lireFiche(client, tenantId, id);
  }
  const fusion = { ...actuelle, ...patch };
  if (patch.compte_immo_numero) delete fusion.compte_immo_id;
  if (patch.compte_amort_numero) delete fusion.compte_amort_id;
  if (patch.compte_dotation_numero) delete fusion.compte_dotation_id;
  if (patch.duree_mois === null || patch.duree_mois === "") {
    fusion.duree_mois = null;
    fusion.compte_amort_id = null;
    fusion.compte_dotation_id = null;
  }
  const p = await preparerDonnees(client, tenantId, fusion);
  await client.query(
    `UPDATE immobilisation SET libelle=$3, compte_immo_id=$4, compte_amort_id=$5, compte_dotation_id=$6, date_acquisition=$7,
        date_mise_en_service=$8, valeur_origine=$9, valeur_residuelle=$10, duree_mois=$11, amort_ouverture=$12, date_ouverture=$13
     WHERE id=$1 AND tenant_id=$2`,
    [id, tenantId, p.libelle, p.compte_immo_id, p.compte_amort_id, p.compte_dotation_id, p.date_acquisition, p.date_mise_en_service,
      p.valeur_origine, p.valeur_residuelle, p.duree_mois, p.amort_ouverture, p.date_ouverture]
  );
  await compta.audit(client, tenantId, utilisateurId, "IMMO_MODIFICATION", "immobilisation", id, actuelle, p);
  return lireFiche(client, tenantId, id);
}

async function supprimerFiche(client, tenantId, utilisateurId, id) {
  const r = await client.query(`SELECT * FROM immobilisation WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  const f = r.rows[0];
  if (!f) throw new ComptaError("COMPTA_IMMO_INTROUVABLE", 404);
  const nbDot = (await client.query(`SELECT COUNT(*)::int AS n FROM immobilisation_dotation WHERE immobilisation_id = $1`, [id])).rows[0].n;
  if (nbDot > 0 || f.statut !== "EN_SERVICE") throw new ComptaError("COMPTA_IMMO_NON_SUPPRIMABLE", 409);
  await client.query(`DELETE FROM immobilisation WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  await compta.audit(client, tenantId, utilisateurId, "IMMO_SUPPRESSION", "immobilisation", id, f, null);
}

// ---------------------------------------------------------------------------
// Dotations en lot
// ---------------------------------------------------------------------------

async function exerciceOuvert(client, tenantId, exerciceId) {
  const ex = exerciceId
    ? (await client.query(`SELECT * FROM exercice_comptable WHERE id = $1 AND tenant_id = $2`, [exerciceId, tenantId])).rows[0]
    : (
        await client.query(
          `SELECT * FROM exercice_comptable WHERE tenant_id = $1 ORDER BY (CURRENT_DATE BETWEEN date_debut AND date_fin) DESC, date_debut DESC LIMIT 1`,
          [tenantId]
        )
      ).rows[0];
  if (!ex) throw new ComptaError("COMPTA_EXERCICE_INTROUVABLE", 404);
  return ex;
}

/** Dotation de l'exercice pour une fiche (centimes), compte tenu du deja comptabilise. */
function dotationExercice(fiche, exercice, dotationsFiche) {
  if (fiche.statut === "SORTIE" && fiche.date_sortie && fiche.date_sortie <= exercice.date_fin) return 0; // sortie : traitee par la sortie elle-meme
  if (!fiche.amortissable) return 0;
  if (fiche.date_ouverture && exercice.date_debut < fiche.date_ouverture) return 0;
  const base = fiche.valeur_origine_c - fiche.valeur_residuelle_c;
  const theorique = cumulTheorique(fiche, exercice.date_fin) - cumulTheorique(fiche, jourPrecedent(exercice.date_debut));
  const dejaCumule =
    (fiche.date_ouverture ? fiche.amort_ouverture_c : 0) +
    dotationsFiche.filter((d) => d.exercice_debut < exercice.date_debut).reduce((a, d) => a + d.montant_c, 0);
  const restant = Math.max(base - dejaCumule, 0);
  return Math.max(Math.min(theorique, restant), 0);
}

async function apercuDotations(client, tenantId, { exercice_id } = {}) {
  const exercice = await exerciceOuvert(client, tenantId, exercice_id);
  const fiches = await chargerFiches(client, tenantId);
  const dots = await chargerDotations(client, tenantId, fiches.map((f) => f.id));
  const lignes = [];
  for (const f of fiches) {
    const mes = dots.filter((d) => d.immobilisation_id === f.id);
    const existante = mes.find((d) => d.exercice_id === exercice.id && d.nature === "EXERCICE");
    const sortieCetExercice = mes.find((d) => d.exercice_id === exercice.id && d.nature === "SORTIE");
    if (f.statut === "SORTIE" && f.date_sortie && f.date_sortie < exercice.date_debut) continue;
    if (f.date_mise_en_service > exercice.date_fin) continue;
    if (!f.amortissable) continue;
    const montantC = existante ? existante.montant_c : sortieCetExercice ? sortieCetExercice.montant_c : dotationExercice(f, exercice, mes);
    lignes.push({
      immobilisation_id: f.id,
      code: f.code,
      libelle: f.libelle,
      compte_immo_numero: f.compte_immo_numero,
      compte_amort_numero: f.compte_amort_numero,
      compte_dotation_numero: f.compte_dotation_numero,
      montant: dec(montantC),
      deja_comptabilisee: !!existante || !!sortieCetExercice,
      sortie: f.statut === "SORTIE" && f.date_sortie && f.date_sortie <= exercice.date_fin,
    });
  }
  const aGenerer = lignes.filter((l) => !l.deja_comptabilisee && !l.sortie && l.montant > 0);
  return {
    exercice: { id: exercice.id, libelle: exercice.libelle, date_debut: exercice.date_debut, date_fin: exercice.date_fin, statut: exercice.statut },
    lignes,
    total_a_generer: dec(aGenerer.reduce((a, l) => a + versCentimes(l.montant), 0)),
    nombre_a_generer: aGenerer.length,
  };
}

async function journalOD(client, tenantId) {
  const j = await client.query(
    `SELECT * FROM journal_comptable WHERE tenant_id = $1 AND type_journal = 'OPERATIONS_DIVERSES' AND actif = true ORDER BY code LIMIT 1`,
    [tenantId]
  );
  if (!j.rows[0]) throw new ComptaError("COMPTA_IMMO_JOURNAL_OD_ABSENT", 409);
  return j.rows[0];
}

async function ecritureInstance(client, tenantId, utilisateurId, { exercice, journal, date, libelle, lignes, origine_id, role, numero_piece = null }) {
  const e = await client.query(
    `INSERT INTO ecriture_comptable
       (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'EN_INSTANCE', 'IMMOBILISATION', $8, $9, $10) RETURNING *`,
    [uuidv4(), tenantId, exercice.id, journal.id, numero_piece, date, libelle, origine_id, role, utilisateurId || null]
  );
  await compta.insererLignes(client, tenantId, e.rows[0].id, lignes);
  return e.rows[0];
}

async function genererDotations(client, tenantId, utilisateurId, { exercice_id } = {}) {
  await compta.exigerInitialise(client, tenantId);
  const exercice = await exerciceOuvert(client, tenantId, exercice_id);
  if (exercice.statut === "CLOTURE") throw new ComptaError("COMPTA_EXERCICE_CLOTURE", 409);
  const apercu = await apercuDotations(client, tenantId, { exercice_id: exercice.id });
  const aGenerer = apercu.lignes.filter((l) => !l.deja_comptabilisee && !l.sortie && l.montant > 0);
  if (aGenerer.length === 0) return { statut: "RIEN_A_GENERER", exercice: apercu.exercice, nombre: 0, total: 0, ecriture: null };

  const fiches = await chargerFiches(client, tenantId);
  const parId = new Map(fiches.map((f) => [f.id, f]));
  const lignes = [];
  for (const l of aGenerer) {
    const f = parId.get(l.immobilisation_id);
    const c = versCentimes(l.montant);
    lignes.push({ compte_id: f.compte_dotation_id, tiers_id: null, libelle: `Dotation ${f.code} ${f.libelle}`.slice(0, 120), debit_c: c, credit_c: 0, date_echeance: null });
    lignes.push({ compte_id: f.compte_amort_id, tiers_id: null, libelle: `Amortissement ${f.code} ${f.libelle}`.slice(0, 120), debit_c: 0, credit_c: c, date_echeance: null });
  }
  const journal = await journalOD(client, tenantId);
  // Une piece d'origine ne se comptabilise qu'une fois par role : une 2e generation (bien acquis apres la
  // premiere) prend le role DOTATION-2, etc.
  const roles = new Set(
    (await client.query(`SELECT origine_role FROM ecriture_comptable WHERE tenant_id = $1 AND origine = 'IMMOBILISATION' AND origine_id = $2`, [tenantId, exercice.id])).rows.map((x) => x.origine_role)
  );
  let rang = 1;
  while (roles.has(rang === 1 ? "DOTATION" : `DOTATION-${rang}`)) rang++;
  const ecriture = await ecritureInstance(client, tenantId, utilisateurId, {
    exercice,
    journal,
    date: exercice.date_fin,
    libelle: `Dotations aux amortissements ${exercice.libelle}${rang > 1 ? ` (complément ${rang})` : ""}`,
    lignes,
    origine_id: exercice.id,
    role: rang === 1 ? "DOTATION" : `DOTATION-${rang}`,
    numero_piece: `DOT-${exercice.date_fin.slice(0, 4)}${rang > 1 ? `-${rang}` : ""}`,
  });
  for (const l of aGenerer) {
    await client.query(
      `INSERT INTO immobilisation_dotation (id, tenant_id, immobilisation_id, exercice_id, nature, montant, ecriture_id) VALUES ($1,$2,$3,$4,'EXERCICE',$5,$6)`,
      [uuidv4(), tenantId, l.immobilisation_id, exercice.id, centimesVersDecimal(versCentimes(l.montant)), ecriture.id]
    );
  }
  const total = aGenerer.reduce((a, l) => a + versCentimes(l.montant), 0);
  await compta.audit(client, tenantId, utilisateurId, "IMMO_DOTATIONS", "exercice_comptable", exercice.id, null, { ecriture_id: ecriture.id, nombre: aGenerer.length, total: dec(total) });
  return { statut: "GENEREE", exercice: apercu.exercice, nombre: aGenerer.length, total: dec(total), ecriture: { id: ecriture.id, numero_piece: ecriture.numero_piece, date_ecriture: ecriture.date_ecriture, statut: ecriture.statut } };
}

/** Supprime les dotations en lot d'un exercice tant que leur ecriture est encore EN_INSTANCE. */
async function annulerDotations(client, tenantId, utilisateurId, { exercice_id } = {}) {
  const exercice = await exerciceOuvert(client, tenantId, exercice_id);
  if (exercice.statut === "CLOTURE") throw new ComptaError("COMPTA_EXERCICE_CLOTURE", 409);
  const r = await client.query(
    `SELECT DISTINCT d.ecriture_id, e.statut FROM immobilisation_dotation d JOIN ecriture_comptable e ON e.id = d.ecriture_id
     WHERE d.tenant_id = $1 AND d.exercice_id = $2 AND d.nature = 'EXERCICE'`,
    [tenantId, exercice.id]
  );
  if (r.rows.length === 0) throw new ComptaError("COMPTA_IMMO_AUCUNE_DOTATION", 404);
  // Seules les ecritures encore en instance sont annulees ; les ecritures validees restent.
  const ids = r.rows.filter((x) => x.statut === "EN_INSTANCE").map((x) => x.ecriture_id);
  if (ids.length === 0) throw new ComptaError("COMPTA_IMMO_DOTATION_VALIDEE", 409);
  await client.query(`DELETE FROM immobilisation_dotation WHERE tenant_id = $1 AND ecriture_id = ANY($2::uuid[])`, [tenantId, ids]);
  await client.query(`DELETE FROM ecriture_comptable WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND statut = 'EN_INSTANCE'`, [tenantId, ids]);
  await compta.audit(client, tenantId, utilisateurId, "IMMO_DOTATIONS_ANNULEES", "exercice_comptable", exercice.id, { ecritures: ids }, null);
  return { annulees: ids.length };
}

// ---------------------------------------------------------------------------
// Sorties (cession / mise au rebut)
// ---------------------------------------------------------------------------

async function sortir(client, tenantId, utilisateurId, id, data = {}) {
  await compta.exigerInitialise(client, tenantId);
  const parametre = await compta.getParametre(client, tenantId);
  const longueur = parametre.longueur_compte || 8;
  const r = await client.query(`SELECT id FROM immobilisation WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  if (!r.rows[0]) throw new ComptaError("COMPTA_IMMO_INTROUVABLE", 404);
  const f = (await chargerFiches(client, tenantId, { id }))[0];
  if (f.statut === "SORTIE") throw new ComptaError("COMPTA_IMMO_DEJA_SORTIE", 409);
  const type = data.type_sortie === "CESSION" ? "CESSION" : data.type_sortie === "REBUT" ? "REBUT" : null;
  if (!type) throw new ComptaError("COMPTA_IMMO_TYPE_SORTIE_INVALIDE");
  const date = String(data.date_sortie || "");
  if (!DATE_RE.test(date)) throw new ComptaError("COMPTA_DATE_INVALIDE");
  if (date < f.date_mise_en_service) throw new ComptaError("COMPTA_IMMO_SORTIE_AVANT_SERVICE");
  const exercice = await compta.exerciceDeLaDate(client, tenantId, date);
  if (!exercice) throw new ComptaError("COMPTA_EXERCICE_INTROUVABLE", 400);
  if (exercice.statut === "CLOTURE") throw new ComptaError("COMPTA_EXERCICE_CLOTURE", 409);
  let produitC = 0;
  if (type === "CESSION") {
    produitC = versCentimes(data.produit_cession);
    if (Number.isNaN(produitC) || produitC <= 0) throw new ComptaError("COMPTA_IMMO_PRODUIT_REQUIS");
  }

  const dots = await chargerDotations(client, tenantId, [f.id]);
  // Dotation complementaire de l'exercice de sortie, jusqu'a la date de sortie incluse
  const dotsAvant = dots.filter((d) => d.exercice_debut < exercice.date_debut);
  const dotsExercice = dots.filter((d) => d.exercice_id === exercice.id);
  const cumulAvant = (f.date_ouverture && f.date_ouverture <= date ? f.amort_ouverture_c : 0) + dotsAvant.reduce((a, d) => a + d.montant_c, 0);
  const base = f.valeur_origine_c - f.valeur_residuelle_c;
  let complementC = 0;
  if (f.amortissable && !(f.date_ouverture && date < f.date_ouverture)) {
    const cibleCumul = Math.min(cumulTheorique(f, date), base);
    const dejaExercice = dotsExercice.reduce((a, d) => a + d.montant_c, 0);
    complementC = cibleCumul - cumulAvant - dejaExercice;
    if (complementC < 0) {
      // dotation annuelle deja passee pour l'exercice entier : a annuler d'abord, sauf si elle ne depasse pas la cible
      throw new ComptaError("COMPTA_IMMO_DOTATION_EXERCICE_EXISTANTE", 409);
    }
    complementC = Math.max(complementC, 0);
    // Ne jamais depasser la base amortissable
    complementC = Math.min(complementC, Math.max(base - cumulAvant - dejaExercice, 0));
  }
  const cumulTotalC = cumulAvant + dotsExercice.reduce((a, d) => a + d.montant_c, 0) + complementC;
  const vncC = f.valeur_origine_c - cumulTotalC;
  if (vncC < 0) throw new ComptaError("COMPTA_IMMO_AMORT_SUPERIEUR");

  // Comptes de sortie
  const num = f.compte_immo_numero;
  const racineVC = num.startsWith("21") ? "811" : num.startsWith("26") || num.startsWith("27") ? "816" : "812";
  const racineProduit = num.startsWith("21") ? "821" : num.startsWith("26") || num.startsWith("27") ? "826" : "822";
  const racineCreance = num.startsWith("21") ? "4851" : num.startsWith("26") || num.startsWith("27") ? "4858" : "4852";
  const compteVC = await trouverCompte(client, tenantId, racineVC, longueur);
  const compteProduit = await trouverCompte(client, tenantId, racineProduit, longueur);
  if (!compteVC || (type === "CESSION" && !compteProduit)) throw new ComptaError("COMPTA_COMPTE_INTROUVABLE", 400, { numero: !compteVC ? racineVC : racineProduit });
  let compteContrepartie = null;
  if (type === "CESSION") {
    compteContrepartie = data.compte_contrepartie_numero
      ? await compteParNumero(client, tenantId, data.compte_contrepartie_numero, "COMPTA_COMPTE_INTROUVABLE")
      : await trouverCompte(client, tenantId, racineCreance, longueur);
    if (!compteContrepartie) throw new ComptaError("COMPTA_COMPTE_INTROUVABLE", 400, { numero: racineCreance });
    if (compteContrepartie.tiers_obligatoire) throw new ComptaError("COMPTA_IMMO_CONTREPARTIE_TIERS", 400, { numero: compteContrepartie.numero });
  }

  const lib = type === "CESSION" ? `Cession ${f.code} ${f.libelle}` : `Mise au rebut ${f.code} ${f.libelle}`;
  const lignes = [];
  if (complementC > 0) {
    lignes.push({ compte_id: f.compte_dotation_id, tiers_id: null, libelle: `Dotation jusqu'à la sortie ${f.code}`, debit_c: complementC, credit_c: 0, date_echeance: null });
    lignes.push({ compte_id: f.compte_amort_id, tiers_id: null, libelle: `Amortissement ${f.code}`, debit_c: 0, credit_c: complementC, date_echeance: null });
  }
  if (cumulTotalC > 0) lignes.push({ compte_id: f.compte_amort_id, tiers_id: null, libelle: `Reprise des amortissements ${f.code}`, debit_c: cumulTotalC, credit_c: 0, date_echeance: null });
  if (vncC > 0) lignes.push({ compte_id: compteVC.id, tiers_id: null, libelle: `Valeur comptable ${f.code}`, debit_c: vncC, credit_c: 0, date_echeance: null });
  lignes.push({ compte_id: f.compte_immo_id, tiers_id: null, libelle: `Sortie du bien ${f.code}`, debit_c: 0, credit_c: f.valeur_origine_c, date_echeance: null });
  if (type === "CESSION") {
    lignes.push({ compte_id: compteContrepartie.id, tiers_id: null, libelle: `Prix de cession ${f.code}`, debit_c: produitC, credit_c: 0, date_echeance: null });
    lignes.push({ compte_id: compteProduit.id, tiers_id: null, libelle: `Produit de cession ${f.code}`, debit_c: 0, credit_c: produitC, date_echeance: null });
  }
  const journal = await journalOD(client, tenantId);
  const ecriture = await ecritureInstance(client, tenantId, utilisateurId, { exercice, journal, date, libelle: lib, lignes, origine_id: f.id, role: "SORTIE", numero_piece: f.code });
  if (complementC > 0) {
    await client.query(
      `INSERT INTO immobilisation_dotation (id, tenant_id, immobilisation_id, exercice_id, nature, montant, ecriture_id) VALUES ($1,$2,$3,$4,'SORTIE',$5,$6)`,
      [uuidv4(), tenantId, f.id, exercice.id, centimesVersDecimal(complementC), ecriture.id]
    );
  }
  await client.query(
    `UPDATE immobilisation SET statut = 'SORTIE', date_sortie = $3, type_sortie = $4, produit_cession = $5, vnc_sortie = $6, ecriture_sortie_id = $7
     WHERE id = $1 AND tenant_id = $2`,
    [f.id, tenantId, date, type, type === "CESSION" ? centimesVersDecimal(produitC) : null, centimesVersDecimal(vncC), ecriture.id]
  );
  const resultat = {
    ecriture_id: ecriture.id,
    dotation_complementaire: dec(complementC),
    amortissements_repris: dec(cumulTotalC),
    vnc: dec(vncC),
    produit_cession: dec(produitC),
    plus_ou_moins_value: dec(produitC - vncC),
  };
  await compta.audit(client, tenantId, utilisateurId, "IMMO_SORTIE", "immobilisation", f.id, null, { type, date, ...resultat });
  return { fiche: await lireFiche(client, tenantId, f.id), ...resultat };
}

/** Annule une sortie tant que son ecriture est EN_INSTANCE. */
async function annulerSortie(client, tenantId, utilisateurId, id) {
  const r = await client.query(`SELECT * FROM immobilisation WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId]);
  const f = r.rows[0];
  if (!f) throw new ComptaError("COMPTA_IMMO_INTROUVABLE", 404);
  if (f.statut !== "SORTIE") throw new ComptaError("COMPTA_IMMO_PAS_SORTIE", 409);
  const e = f.ecriture_sortie_id ? (await client.query(`SELECT * FROM ecriture_comptable WHERE id = $1 AND tenant_id = $2`, [f.ecriture_sortie_id, tenantId])).rows[0] : null;
  if (e && e.statut !== "EN_INSTANCE") throw new ComptaError("COMPTA_IMMO_SORTIE_VALIDEE", 409);
  const ex = e ? (await client.query(`SELECT statut FROM exercice_comptable WHERE id = $1`, [e.exercice_id])).rows[0] : null;
  if (ex && ex.statut === "CLOTURE") throw new ComptaError("COMPTA_EXERCICE_CLOTURE", 409);
  await client.query(`DELETE FROM immobilisation_dotation WHERE immobilisation_id = $1 AND nature = 'SORTIE'`, [id]);
  await client.query(
    `UPDATE immobilisation SET statut='EN_SERVICE', date_sortie=NULL, type_sortie=NULL, produit_cession=NULL, vnc_sortie=NULL, ecriture_sortie_id=NULL WHERE id=$1 AND tenant_id=$2`,
    [id, tenantId]
  );
  if (e) await client.query(`DELETE FROM ecriture_comptable WHERE id = $1 AND statut = 'EN_INSTANCE'`, [e.id]);
  await compta.audit(client, tenantId, utilisateurId, "IMMO_SORTIE_ANNULEE", "immobilisation", id, f, null);
  return lireFiche(client, tenantId, id);
}

// ---------------------------------------------------------------------------
// Tableau des immobilisations (brut, amortissements, VNC) d'un exercice
// ---------------------------------------------------------------------------

async function tableauImmobilisations(client, tenantId, options = {}) {
  const { resoudrePeriode, statutsInclus } = require("./comptaRapports");
  const { exercice } = await resoudrePeriode(client, tenantId, { exercice_id: options.exercice_id });
  const fiches = await chargerFiches(client, tenantId);
  const dots = await chargerDotations(client, tenantId, fiches.map((f) => f.id));
  const debut = exercice.date_debut;
  const fin = exercice.date_fin;
  const lignes = fiches
    .filter((f) => f.date_acquisition <= fin && !(f.statut === "SORTIE" && f.date_sortie && f.date_sortie < debut))
    .map((f) => {
      const mes = dots.filter((d) => d.immobilisation_id === f.id);
      const enReprise = !!f.date_reprise && f.date_reprise <= debut; // a-nouveaux : brut a l'ouverture, pas une acquisition
      const brutDebut = f.date_acquisition < debut || enReprise ? f.valeur_origine_c : 0;
      const acquisitions = brutDebut === 0 ? f.valeur_origine_c : 0;
      const sorti = f.statut === "SORTIE" && f.date_sortie && f.date_sortie >= debut && f.date_sortie <= fin;
      const amortDebut = (f.date_ouverture && f.date_ouverture <= debut ? f.amort_ouverture_c : 0) + mes.filter((d) => d.exercice_fin < debut).reduce((a, d) => a + d.montant_c, 0);
      const dotation = mes.filter((d) => d.exercice_id === exercice.id).reduce((a, d) => a + d.montant_c, 0);
      // Reprise d'ouverture comptabilisee dans l'exercice lui-meme (date de situation = debut de l'exercice)
      const amortFinAvantSortie = amortDebut + dotation + (f.date_ouverture && f.date_ouverture > debut && f.date_ouverture <= fin ? f.amort_ouverture_c : 0);
      const amortSortis = sorti ? amortFinAvantSortie : 0;
      const brutSortis = sorti ? f.valeur_origine_c : 0;
      return {
        immobilisation_id: f.id,
        code: f.code,
        libelle: f.libelle,
        compte_numero: f.compte_immo_numero,
        groupe: f.compte_immo_numero.slice(0, 3),
        statut: f.statut,
        brut_debut: brutDebut,
        acquisitions,
        sorties: brutSortis,
        brut_fin: brutDebut + acquisitions - brutSortis,
        amort_debut: amortDebut,
        dotations: dotation,
        amort_sorties: amortSortis,
        amort_fin: amortFinAvantSortie - amortSortis,
      };
    });
  for (const l of lignes) l.vnc_fin = l.brut_fin - l.amort_fin;
  const CHAMPS = ["brut_debut", "acquisitions", "sorties", "brut_fin", "amort_debut", "dotations", "amort_sorties", "amort_fin", "vnc_fin"];
  const somme = (ls) => Object.fromEntries(CHAMPS.map((c) => [c, ls.reduce((a, l) => a + l[c], 0)]));
  const versDec = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? dec(v) : v]));

  const groupesMap = new Map();
  for (const l of lignes) {
    if (!groupesMap.has(l.groupe)) groupesMap.set(l.groupe, []);
    groupesMap.get(l.groupe).push(l);
  }
  const libellesGroupe = {};
  const libs = await client.query(`SELECT numero, libelle FROM compte_comptable WHERE tenant_id = $1 AND numero ~ '^2[1-7][0-9]' ORDER BY numero`, [tenantId]);
  for (const c of libs.rows) {
    const g = c.numero.slice(0, 3);
    if (!libellesGroupe[g]) libellesGroupe[g] = c.libelle;
  }
  const groupes = [...groupesMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([g, ls]) => ({ groupe: g, libelle: libellesGroupe[g] || "", ...versDec(somme(ls)), lignes: ls.map(versDec) }));
  const totaux = versDec(somme(lignes));

  // Controle avec la comptabilite : classe 2 brute et amortissements 28 / 29
  const statuts = statutsInclus(options.inclure_instance);
  const c = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN c.numero ~ '^2[1-7]' THEN ROUND((l.debit - l.credit) * 100) ELSE 0 END), 0)::text AS brut,
            COALESCE(SUM(CASE WHEN c.numero ~ '^28' THEN ROUND((l.credit - l.debit) * 100) ELSE 0 END), 0)::text AS amort
     FROM ligne_ecriture l JOIN ecriture_comptable e ON e.id = l.ecriture_id JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.tenant_id = $1 AND e.exercice_id = $2 AND e.date_ecriture <= $3::date AND e.statut = ANY($4::text[])`,
    [tenantId, exercice.id, fin, statuts]
  );
  const brutCompta = Number(c.rows[0].brut);
  const amortCompta = Number(c.rows[0].amort);
  return {
    exercice: { id: exercice.id, libelle: exercice.libelle, date_debut: debut, date_fin: fin },
    inclure_instance: !!options.inclure_instance,
    groupes,
    totaux,
    controle: {
      brut_fiches: dec(totaux.brut_fin === undefined ? 0 : versCentimes(totaux.brut_fin)),
      brut_comptabilite: dec(brutCompta),
      ecart_brut: dec(versCentimes(totaux.brut_fin) - brutCompta),
      amort_fiches: dec(versCentimes(totaux.amort_fin)),
      amort_comptabilite: dec(amortCompta),
      ecart_amort: dec(versCentimes(totaux.amort_fin) - amortCompta),
    },
  };
}

module.exports = {
  suggestionPourCompte,
  cumulTheorique,
  jours360,
  listerFiches,
  lireFiche,
  listerAImmobiliser,
  ignorerLigne,
  creerFiche,
  modifierFiche,
  supprimerFiche,
  apercuDotations,
  genererDotations,
  annulerDotations,
  sortir,
  annulerSortie,
  tableauImmobilisations,
};
