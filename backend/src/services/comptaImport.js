/**
 * Import des donnees comptables depuis Sage (SYSCOHADA) - chantier du
 * 04/10/2026 (demande de Steeve : reprendre en cours d'exercice les ecritures
 * d'une structure a partir de ses exports Sage, "exactement comme ca").
 *
 * Deux types de fichiers, au format EXACT des exports Sage Saari :
 *   - GRAND LIVRE : colonnes N° COMPTE, DATE, CODE J, N° PIECES, LIBELLE,
 *     (lettrage), DEBIT, CREDIT, SOLDES [+ TIERS facultatif] ;
 *   - BALANCE GENERALE : compte, libelle, puis 3 blocs Debit / Credit
 *     (Solde au 01/01 = a-nouveaux, Mouvements, Soldes cumules) ; les balances
 *     auxiliaires clients / fournisseurs (CODE, NOM, memes 6 colonnes) peuvent
 *     detailler les comptes collectifs 411 / 401.
 *
 * Le meme code sert a l'APERCU et a l'IMPORT : l'apercu execute tout l'import
 * dans une transaction qu'il annule a la fin (le rapport est donc exactement
 * celui de l'import reel). Toute erreur annule l'import complet.
 *
 * Les ecritures importees sont creees directement VALIDEES (numerotation
 * continue par journal, dans l'ordre chronologique) ou EN_INSTANCE sur demande.
 * Un lot d'import peut etre annule tant qu'il porte les derniers numeros de
 * ses journaux.
 */
const crypto = require("crypto");
const XLSX = require("xlsx");
const { v4: uuidv4 } = require("uuid");
const compta = require("./comptaService");

const { ComptaError, versCentimes, centimesVersDecimal } = compta;

class ImportRapportError extends Error {
  constructor(rapport) {
    super("IMPORT_ERREURS");
    this.rapport = rapport;
  }
}
class SimulationTerminee extends Error {
  constructor(rapport) {
    super("SIMULATION");
    this.rapport = rapport;
  }
}

// ----------------------------------------------------------------------------
// Lecture des fichiers et conversions
// ----------------------------------------------------------------------------

function lireClasseur(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: true });
  } catch (e) {
    throw new ComptaError("COMPTA_IMPORT_FORMAT", 400);
  }
  // Feuille la plus fournie
  let meilleure = null;
  for (const nom of wb.SheetNames) {
    const lignes = XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: null, blankrows: false });
    if (!meilleure || lignes.length > meilleure.length) meilleure = lignes;
  }
  if (!meilleure || meilleure.length === 0) throw new ComptaError("COMPTA_IMPORT_FORMAT", 400);
  return meilleure;
}

const sansAccents = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
const cleEntete = (s) => sansAccents(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const texte = (v) => (v === null || v === undefined ? "" : String(v).trim());

function normaliserNom(s) {
  return sansAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Numero de compte -> chaine de `longueur` chiffres, ou null si invalide. */
function normaliserCompte(valeur, longueur, minimum = 1) {
  let s = typeof valeur === "number" ? String(Math.round(valeur)) : texte(valeur);
  s = s.replace(/\s/g, "").replace(/\.0+$/, "");
  if (!/^\d+$/.test(s) || s.length < minimum) return null;
  if (s[0] === "0") return null;
  if (s.length > longueur) return null;
  return s.padEnd(longueur, "0");
}

function iso(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function lireDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const s = String(v).trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return iso(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s))) return iso(+m[3], +m[2], +m[1]);
  if ((m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2})$/.exec(s))) return iso(2000 + +m[3], +m[2], +m[1]);
  if ((m = /^(\d{2})(\d{2})(\d{2})$/.exec(s))) return iso(2000 + +m[3], +m[2], +m[1]); // JJMMAA (impressions Sage)
  if ((m = /^(\d{2})(\d{2})(\d{4})$/.exec(s))) return iso(+m[3], +m[2], +m[1]);
  return null;
}

/** Montant -> centimes ; 0 si vide ; NaN si illisible. */
function lireMontant(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : NaN;
  return versCentimes(String(v).replace(/ /g, " "));
}

// ----------------------------------------------------------------------------
// Grand livre
// ----------------------------------------------------------------------------

const ENTETES_GL = {
  compte: /^(ncompte|numerocompte|numcompte|compte|account|nodecompte)$/,
  date: /^(date|datepiece|dateecriture)$/,
  journal: /^(codej|cj|journal|codejournal|j)$/,
  piece: /^(npieces?|npiece|piece|pieces|numeropiece|numpiece|ndepiece|nopiece)$/,
  libelle: /^(libelle|libelleecriture|label|designation)$/,
  lettrage: /^(let|lettrage|lettre)$/,
  debit: /^(debit|mouvementdebit|montantdebit)$/,
  credit: /^(credit|mouvementcredit|montantcredit)$/,
  tiers: /^(tiers|codetiers|auxiliaire|compteauxiliaire|ntiers)$/,
  nomTiers: /^(nomtiers|libelletiers|intitulétiers|intituletiers)$/,
};

function parserGrandLivre(rows, longueur) {
  const erreurs = [];
  const avertissements = [];
  // 1. ligne d'en-tete
  let idxEntete = -1;
  let cols = null;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const m = {};
    (rows[i] || []).forEach((cellule, c) => {
      const k = cleEntete(cellule);
      if (!k) return;
      for (const [nom, re] of Object.entries(ENTETES_GL)) if (m[nom] === undefined && re.test(k)) m[nom] = c;
    });
    if (m.compte !== undefined && m.date !== undefined && m.debit !== undefined && m.credit !== undefined) {
      idxEntete = i;
      cols = m;
      break;
    }
  }
  if (idxEntete < 0) throw new ComptaError("COMPTA_IMPORT_FORMAT_GL", 400);
  // Colonne de lettrage sans titre (export Sage) : entre le libelle et le debit
  if (cols.lettrage === undefined && cols.libelle !== undefined && cols.debit - cols.libelle === 2) {
    cols.lettrage = cols.libelle + 1;
  }
  if (cols.journal === undefined || cols.piece === undefined) throw new ComptaError("COMPTA_IMPORT_FORMAT_GL", 400);

  const lignes = [];
  let ignoreesSansMontant = 0;
  let ignoreesAutres = 0;
  for (let i = idxEntete + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const get = (k) => (cols[k] === undefined ? null : r[cols[k]]);
    if (r.every((x) => x === null || x === "")) continue;
    const ligneSource = i + 1;
    const brutCompte = get("compte");
    const debitBrut = get("debit");
    const creditBrut = get("credit");
    const aucunMontant = (debitBrut === null || debitBrut === "") && (creditBrut === null || creditBrut === "");
    const compte = normaliserCompte(brutCompte, longueur, 2);
    if (!compte) {
      // lignes de total / titres de l'impression Sage : ignorees si sans montant
      if (aucunMontant) {
        ignoreesAutres++;
        continue;
      }
      erreurs.push({ code: "COMPTE_INVALIDE", ligne: ligneSource, valeur: texte(brutCompte) });
      continue;
    }
    const d = lireMontant(debitBrut);
    const c = lireMontant(creditBrut);
    if (Number.isNaN(d) || Number.isNaN(c)) {
      erreurs.push({ code: "MONTANT_INVALIDE", ligne: ligneSource });
      continue;
    }
    const net = d - c; // un montant negatif est un montant de l'autre colonne
    if (net === 0) {
      ignoreesSansMontant++;
      continue;
    }
    const date = lireDate(get("date"));
    if (!date) {
      erreurs.push({ code: "DATE_INVALIDE", ligne: ligneSource, valeur: texte(get("date")) });
      continue;
    }
    const journal = texte(get("journal")).toUpperCase();
    if (!/^[A-Z0-9]{1,5}$/.test(journal)) {
      erreurs.push({ code: "JOURNAL_INVALIDE", ligne: ligneSource, valeur: texte(get("journal")) });
      continue;
    }
    const pieceBrute = get("piece");
    const piece = typeof pieceBrute === "number" ? String(Math.round(pieceBrute)) : texte(pieceBrute);
    lignes.push({
      ligneSource,
      compte,
      date,
      journal,
      piece,
      libelle: texte(get("libelle")),
      lettrage: texte(get("lettrage")) || null,
      debit_c: net > 0 ? net : 0,
      credit_c: net < 0 ? -net : 0,
      tiers: texte(get("tiers")) || null,
      nomTiers: texte(get("nomTiers")) || null,
    });
  }
  if (lignes.length === 0 && erreurs.length === 0) throw new ComptaError("COMPTA_IMPORT_VIDE", 400);
  return { lignes, erreurs, avertissements, ignorees: ignoreesSansMontant + ignoreesAutres, ignoreesSansMontant };
}

/** Regroupe les lignes en pieces : (journal, n° piece), eclatees par date si la piece en porte plusieurs. */
function grouperPieces(lignes) {
  const parCle = new Map();
  lignes.forEach((l, ordre) => {
    const cle = `${l.journal}|${l.piece}`;
    if (!parCle.has(cle)) parCle.set(cle, []);
    parCle.get(cle).push({ ...l, ordre });
  });
  const pieces = [];
  let piecesMultiDates = 0;
  for (const [cle, ls] of parCle) {
    const dates = [...new Set(ls.map((l) => l.date))];
    if (dates.length === 1) {
      pieces.push({ journal: ls[0].journal, piece: ls[0].piece, date: dates[0], lignes: ls });
    } else {
      piecesMultiDates++;
      for (const d of dates) pieces.push({ journal: ls[0].journal, piece: ls[0].piece, date: d, lignes: ls.filter((l) => l.date === d) });
    }
  }
  return { pieces, piecesMultiDates };
}

// ----------------------------------------------------------------------------
// Balances (generale et auxiliaires)
// ----------------------------------------------------------------------------

const POSITIONS_COLONNES = { AN: [2, 3], MOUVEMENTS: [4, 5], SOLDES: [6, 7] };

/** Balance generale Sage : [compte, libelle, AN D, AN C, Mvt D, Mvt C, Solde D, Solde C]. */
function parserBalanceGenerale(rows, longueur, colonnes) {
  const [cd, cc] = POSITIONS_COLONNES[colonnes] || POSITIONS_COLONNES.AN;
  const erreurs = [];
  const lignes = [];
  let ignorees = 0;
  let vue = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r.length < 8 && r.filter((x) => x !== null && x !== "").length < 3) continue;
    const brut = r[0];
    const compte = normaliserCompte(brut, longueur, 3);
    if (!compte) {
      ignorees++;
      continue;
    }
    vue++;
    const d = lireMontant(r[cd]);
    const c = lireMontant(r[cc]);
    if (Number.isNaN(d) || Number.isNaN(c)) {
      erreurs.push({ code: "MONTANT_INVALIDE", ligne: i + 1 });
      continue;
    }
    const net = d - c;
    lignes.push({ ligneSource: i + 1, compte, libelle: texte(r[1]), net_c: net });
  }
  if (vue === 0 || (erreurs.length > 0 && erreurs.length >= vue / 2)) throw new ComptaError("COMPTA_IMPORT_FORMAT_BALANCE", 400);
  return { lignes, erreurs, ignorees };
}

/** Balance auxiliaire Sage : [code, nom, AN D, AN C, Mvt D, Mvt C, Solde D, Solde C]. */
function parserBalanceTiers(rows, colonnes) {
  const [cd, cc] = POSITIONS_COLONNES[colonnes] || POSITIONS_COLONNES.AN;
  const erreurs = [];
  const tiers = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const code = texte(r[0]);
    if (!/^[A-Za-z][A-Za-z0-9]{1,9}$/.test(code)) continue; // en-tetes, totaux
    if (/^totaux?$/i.test(code)) continue;
    const d = lireMontant(r[cd]);
    const c = lireMontant(r[cc]);
    if (Number.isNaN(d) || Number.isNaN(c)) {
      erreurs.push({ code: "MONTANT_INVALIDE", ligne: i + 1 });
      continue;
    }
    tiers.push({ ligneSource: i + 1, code: code.toUpperCase(), nom: texte(r[1]), net_c: d - c });
  }
  return { tiers, erreurs };
}

// ----------------------------------------------------------------------------
// Resolution des comptes, journaux, exercices, tiers
// ----------------------------------------------------------------------------

function typeJournalPourCode(code) {
  if (/^(ACH|HA)/.test(code)) return ["ACHATS", "Journal des achats"];
  if (/^(VTE|VE|VT)/.test(code)) return ["VENTES", "Journal des ventes"];
  if (/^(CAI|CA|CS)/.test(code)) return ["CAISSE", "Caisse"];
  if (/^(BQ|BNK|BA|BP|BAN)/.test(code)) return ["BANQUE", "Banque"];
  if (/^(AN|RAN)$/.test(code)) return ["A_NOUVEAUX", "A-nouveaux"];
  return ["OPERATIONS_DIVERSES", `Journal ${code}`];
}

class Contexte {
  constructor(client, tenantId, utilisateurId, parametre, options, rapport) {
    this.client = client;
    this.tenantId = tenantId;
    this.utilisateurId = utilisateurId;
    this.parametre = parametre;
    this.options = options;
    this.rapport = rapport;
    this.comptes = new Map(); // numero -> ligne compte
    this.journaux = new Map(); // code -> journal
    this.exercices = new Map(); // date -> exercice | null
    this.tiersCache = new Map();
    this.tiersExistants = null;
    this.libellesComptes = new Map();
  }

  erreur(e) {
    this.rapport.erreurs.push(e);
  }
  avertir(e) {
    this.rapport.avertissements.push(e);
  }

  async charger() {
    const c = await this.client.query(`SELECT * FROM compte_comptable WHERE tenant_id = $1`, [this.tenantId]);
    for (const r of c.rows) this.comptes.set(r.numero, r);
    const j = await this.client.query(`SELECT * FROM journal_comptable WHERE tenant_id = $1`, [this.tenantId]);
    for (const r of j.rows) this.journaux.set(r.code, r);
    const t = await this.client.query(`SELECT * FROM tiers_comptable WHERE tenant_id = $1`, [this.tenantId]);
    this.tiersExistants = t.rows;
  }

  /** Verifie / cree les comptes demandes ; retourne true si tous disponibles. */
  async assurerComptes(numeros) {
    let ok = true;
    const manquants = [...new Set(numeros)].filter((n) => !this.comptes.has(n)).sort();
    for (const n of manquants) {
      if (!this.options.creer_comptes) {
        this.erreur({ code: "COMPTE_INCONNU", compte: n });
        ok = false;
        continue;
      }
      const libelle = this.libellesComptes.get(n) || `Compte ${n} (import)`;
      try {
        const cree = await compta.creerCompte(this.client, this.tenantId, this.utilisateurId, { numero: n, libelle });
        this.comptes.set(n, cree);
        this.rapport.comptes_crees.push({ numero: n, libelle });
      } catch (e) {
        if (e instanceof ComptaError) {
          this.erreur({ code: "COMPTE_CREATION_IMPOSSIBLE", compte: n });
          ok = false;
        } else throw e;
      }
    }
    for (const n of new Set(numeros)) {
      const c = this.comptes.get(n);
      if (c && !c.actif) {
        this.erreur({ code: "COMPTE_INACTIF", compte: n });
        ok = false;
      }
    }
    return ok;
  }

  async assurerJournal(code, typeForce = null) {
    if (this.journaux.has(code)) {
      if (!this.journaux.get(code).actif) {
        this.erreur({ code: "JOURNAL_INACTIF", journal: code });
        return null;
      }
      return this.journaux.get(code);
    }
    if (!this.options.creer_journaux) {
      this.erreur({ code: "JOURNAL_INCONNU", journal: code });
      return null;
    }
    const [type, libelle] = typeForce ? [typeForce, `Journal ${code}`] : typeJournalPourCode(code);
    const cree = await compta.creerJournal(this.client, this.tenantId, this.utilisateurId, { code, libelle, type_journal: type });
    this.journaux.set(code, cree);
    this.rapport.journaux_crees.push({ code, libelle, type_journal: type });
    return cree;
  }

  async exerciceDe(date) {
    if (this.exercices.has(date)) return this.exercices.get(date);
    let ex = await compta.exerciceDeLaDate(this.client, this.tenantId, date);
    if (!ex && this.options.creer_exercices) {
      const annee = Number(date.slice(0, 4));
      try {
        ex = await compta.creerExercice(this.client, this.tenantId, this.utilisateurId, {
          libelle: `Exercice ${annee}`,
          date_debut: `${annee}-01-01`,
          date_fin: `${annee}-12-31`,
        });
        this.rapport.exercices_crees.push({ libelle: ex.libelle });
        // memoriser pour toutes les dates de cette annee
        for (const [d, v] of this.exercices) if (v === null && d.startsWith(String(annee))) this.exercices.set(d, ex);
      } catch (e) {
        if (!(e instanceof ComptaError)) throw e;
        ex = null;
      }
    }
    if (ex && ex.statut === "CLOTURE") {
      this.erreur({ code: "EXERCICE_CLOTURE", libelle: ex.libelle });
      ex = null;
      this.exercices.set(date, null);
      return null;
    }
    this.exercices.set(date, ex || null);
    if (!ex) this.erreur({ code: "EXERCICE_INTROUVABLE", date });
    return ex || null;
  }

  collectifType(compteNumero) {
    const c = this.comptes.get(compteNumero);
    if (!c) return null;
    if (c.nature === "COLLECTIF_CLIENT") return "CLIENT";
    if (c.nature === "COLLECTIF_FOURNISSEUR") return "FOURNISSEUR";
    return null;
  }

  async tiersGenerique(type) {
    const cle = `GEN:${type}`;
    if (this.tiersCache.has(cle)) return this.tiersCache.get(cle);
    const code = type === "CLIENT" ? "CREPRISE" : "FREPRISE";
    let t = this.tiersExistants.find((x) => x.code === code);
    if (!t) {
      const collectif = type === "CLIENT" ? this.parametre.compte_client_collectif : this.parametre.compte_fournisseur_collectif;
      const nom = type === "CLIENT" ? "Reprise Sage - clients non detailles" : "Reprise Sage - fournisseurs non detailles";
      const r = await this.client.query(
        `INSERT INTO tiers_comptable (id, tenant_id, type_tiers, code, nom, compte_collectif) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [uuidv4(), this.tenantId, type, code, nom, collectif]
      );
      t = r.rows[0];
      this.tiersExistants.push(t);
      this.rapport.tiers_crees.push({ code, nom });
    }
    this.tiersCache.set(cle, t);
    this.rapport.tiers_generiques[type] = true;
    return t;
  }

  /** Tiers de reprise : rapproche par code (+ nom), puis par nom, sinon cree. */
  async tiersPourCode(type, code, nom) {
    const cle = `${type}:${code}`;
    if (this.tiersCache.has(cle)) return this.tiersCache.get(cle);
    const nomN = normaliserNom(nom);
    let t = this.tiersExistants.find((x) => x.code === code);
    if (t) {
      const memeNom = !nomN || normaliserNom(t.nom) === nomN || normaliserNom(t.nom).includes(nomN) || nomN.includes(normaliserNom(t.nom));
      if (t.type_tiers === type && memeNom) {
        this.tiersCache.set(cle, t);
        return t;
      }
      t = null;
      this.rapport.stats.tiers_conflits_code++;
    }
    if (nomN) {
      t = this.tiersExistants.find((x) => x.type_tiers === type && normaliserNom(x.nom) === nomN);
      if (t) {
        this.rapport.stats.tiers_rapproches_nom++;
        this.tiersCache.set(cle, t);
        return t;
      }
    }
    // Creation : on garde le code Sage s'il est libre, sinon code genere
    const codeLibre = !this.tiersExistants.some((x) => x.code === code);
    const collectif = type === "CLIENT" ? this.parametre.compte_client_collectif : this.parametre.compte_fournisseur_collectif;
    const nomFinal = nom || code;
    let nouveau;
    if (codeLibre) {
      const r = await this.client.query(
        `INSERT INTO tiers_comptable (id, tenant_id, type_tiers, code, nom, compte_collectif) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [uuidv4(), this.tenantId, type, code, nomFinal, collectif]
      );
      nouveau = r.rows[0];
    } else {
      nouveau = await compta.creerTiers(this.client, this.tenantId, { type_tiers: type, nom: nomFinal });
    }
    this.tiersExistants.push(nouveau);
    this.tiersCache.set(cle, nouveau);
    this.rapport.stats.tiers_crees++;
    if (this.rapport.tiers_crees.length < 30) this.rapport.tiers_crees.push({ code: nouveau.code, nom: nouveau.nom, code_source: code });
    return nouveau;
  }
}

function nouveauRapport() {
  return {
    ok: false,
    erreurs: [],
    avertissements: [],
    comptes_crees: [],
    journaux_crees: [],
    exercices_crees: [],
    tiers_crees: [],
    tiers_generiques: {},
    par_journal: [],
    stats: {
      lignes_lues: 0,
      lignes_ignorees: 0,
      ecritures: 0,
      ecritures_ignorees_doublon: 0,
      lignes: 0,
      total_debit: "0.00",
      total_credit: "0.00",
      tiers_crees: 0,
      tiers_rapproches_nom: 0,
      tiers_conflits_code: 0,
      date_min: null,
      date_max: null,
    },
  };
}

const OPTIONS_PAR_DEFAUT = {
  creer_comptes: true,
  creer_journaux: true,
  creer_exercices: true,
  statut: "VALIDEE",
};

function normaliserOptions(o = {}) {
  const vrai = (v, def) => (v === undefined || v === null || v === "" ? def : v === true || v === "true" || v === "1");
  return {
    creer_comptes: vrai(o.creer_comptes, OPTIONS_PAR_DEFAUT.creer_comptes),
    creer_journaux: vrai(o.creer_journaux, OPTIONS_PAR_DEFAUT.creer_journaux),
    creer_exercices: vrai(o.creer_exercices, OPTIONS_PAR_DEFAUT.creer_exercices),
    statut: o.statut === "EN_INSTANCE" ? "EN_INSTANCE" : "VALIDEE",
    colonnes: ["AN", "MOUVEMENTS", "SOLDES"].includes(o.colonnes) ? o.colonnes : "AN",
    date_ecriture: o.date_ecriture || null,
    journal_code: o.journal_code ? String(o.journal_code).trim().toUpperCase() : null,
    libelle: o.libelle ? String(o.libelle).trim() : null,
  };
}

// ----------------------------------------------------------------------------
// Ecriture en base des pieces
// ----------------------------------------------------------------------------

async function lotDejaImporte(client, tenantId, type, empreinte) {
  const r = await client.query(
    `SELECT id FROM compta_import_lot WHERE tenant_id = $1 AND type_import = $2 AND empreinte = $3 AND statut = 'ACTIF'`,
    [tenantId, type, empreinte]
  );
  return r.rows.length > 0;
}

/**
 * Insere les pieces (deja controlees et equilibrees) : ordre chronologique,
 * numerotation continue par (exercice, journal) quand l'import est valide.
 */
async function ecrirePieces(ctx, lot, pieces) {
  const { client, tenantId, utilisateurId, options, rapport } = ctx;
  const ordonnees = [...pieces].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const na = Number(a.piece);
    const nb = Number(b.piece);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.ordre - b.ordre;
  });
  const parJournal = new Map();
  let totalD = 0;
  let totalC = 0;
  let nbLignes = 0;
  for (const p of ordonnees) {
    const ecritureId = uuidv4();
    const libelle = (p.libelle || p.lignes.find((l) => l.libelle)?.libelle || `Import ${p.journal} ${p.piece}`).slice(0, 250);
    let numero = null;
    if (options.statut === "VALIDEE") numero = await compta.tirerNumeroEcriture(client, tenantId, p.exercice.id, p.journalObj.code);
    await client.query(
      `INSERT INTO ecriture_comptable
         (id, tenant_id, exercice_id, journal_id, numero_ecriture, numero_piece, date_ecriture, libelle, statut,
          origine, origine_id, origine_role, cree_par, valide_par, date_validation, import_lot_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'IMPORT', $10, $11, $12, $13, $14, $10)`,
      [
        ecritureId,
        tenantId,
        p.exercice.id,
        p.journalObj.id,
        numero,
        p.piece || null,
        p.date,
        libelle,
        options.statut,
        lot.id,
        `${p.journal}:${p.piece}:${p.date}`,
        utilisateurId,
        options.statut === "VALIDEE" ? utilisateurId : null,
        options.statut === "VALIDEE" ? new Date() : null,
      ]
    );
    const lignes = p.lignes.map((l) => ({
      compte_id: ctx.comptes.get(l.compte).id,
      tiers_id: l.tiers_id || null,
      libelle: l.libelle || null,
      debit_c: l.debit_c,
      credit_c: l.credit_c,
      date_echeance: null,
      lettrage: l.lettrage || null,
    }));
    for (let i = 0; i < lignes.length; i++) {
      const l = lignes[i];
      await client.query(
        `INSERT INTO ligne_ecriture (id, tenant_id, ecriture_id, ordre, compte_id, tiers_id, libelle, debit, credit, lettrage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [uuidv4(), tenantId, ecritureId, i + 1, l.compte_id, l.tiers_id, l.libelle, centimesVersDecimal(l.debit_c), centimesVersDecimal(l.credit_c), l.lettrage]
      );
      totalD += l.debit_c;
      totalC += l.credit_c;
      nbLignes++;
    }
    const pj = parJournal.get(p.journal) || { code: p.journal, ecritures: 0, debit_c: 0, credit_c: 0 };
    pj.ecritures++;
    for (const l of lignes) {
      pj.debit_c += l.debit_c;
      pj.credit_c += l.credit_c;
    }
    parJournal.set(p.journal, pj);
  }
  rapport.stats.ecritures = ordonnees.length;
  rapport.stats.lignes = nbLignes;
  rapport.stats.total_debit = centimesVersDecimal(totalD);
  rapport.stats.total_credit = centimesVersDecimal(totalC);
  rapport.par_journal = [...parJournal.values()].map((j) => ({
    code: j.code,
    ecritures: j.ecritures,
    debit: centimesVersDecimal(j.debit_c),
    credit: centimesVersDecimal(j.credit_c),
  }));
  return { totalD, totalC, nbLignes, nbEcritures: ordonnees.length };
}

async function creerLot(client, tenantId, utilisateurId, { type, nomFichier, empreinte, options }) {
  const id = uuidv4();
  await client.query(
    `INSERT INTO compta_import_lot (id, tenant_id, type_import, nom_fichier, empreinte, statut_ecritures, parametres, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, tenantId, type, nomFichier || null, empreinte, options.statut, JSON.stringify(options), utilisateurId]
  );
  return { id };
}

async function finaliserLot(client, tenantId, utilisateurId, lot, type, resume, rapport) {
  await client.query(
    `UPDATE compta_import_lot SET nb_ecritures = $2, nb_lignes = $3, total_debit = $4, total_credit = $5, rapport = $6 WHERE id = $1`,
    [lot.id, resume.nbEcritures, resume.nbLignes, centimesVersDecimal(resume.totalD), centimesVersDecimal(resume.totalC), JSON.stringify(rapport)]
  );
  await compta.audit(client, tenantId, utilisateurId, type === "GRAND_LIVRE" ? "IMPORT_GRAND_LIVRE" : "IMPORT_BALANCE", "compta_import_lot", lot.id, null, {
    ecritures: resume.nbEcritures,
    lignes: resume.nbLignes,
  });
}

const MAX_ERREURS_AFFICHEES = 100;

function terminer(rapport, simulation) {
  rapport.ok = rapport.erreurs.length === 0;
  rapport.nb_erreurs = rapport.erreurs.length;
  if (rapport.erreurs.length > MAX_ERREURS_AFFICHEES) rapport.erreurs = rapport.erreurs.slice(0, MAX_ERREURS_AFFICHEES);
  if (!rapport.ok) throw new ImportRapportError(rapport);
  if (simulation) throw new SimulationTerminee(rapport);
  return rapport;
}

// ----------------------------------------------------------------------------
// Import du grand livre
// ----------------------------------------------------------------------------

async function importerGrandLivre(client, tenantId, utilisateurId, { buffer, nomFichier, options: optionsBrutes, simulation }) {
  const options = normaliserOptions(optionsBrutes);
  const parametre = await compta.exigerInitialise(client, tenantId);
  const rapport = nouveauRapport();
  const empreinte = crypto.createHash("sha256").update(buffer).digest("hex");
  if (await lotDejaImporte(client, tenantId, "GRAND_LIVRE", empreinte)) throw new ComptaError("COMPTA_IMPORT_DEJA_IMPORTE", 409);

  const rows = lireClasseur(buffer);
  const parse = parserGrandLivre(rows, parametre.longueur_compte);
  rapport.erreurs.push(...parse.erreurs);
  rapport.stats.lignes_lues = parse.lignes.length;
  rapport.stats.lignes_ignorees = parse.ignorees;

  const ctx = new Contexte(client, tenantId, utilisateurId, parametre, options, rapport);
  await ctx.charger();
  await ctx.assurerComptes(parse.lignes.map((l) => l.compte));

  const { pieces, piecesMultiDates } = grouperPieces(parse.lignes);
  if (piecesMultiDates > 0) rapport.avertissements.push({ code: "PIECES_DATES_MULTIPLES", nombre: piecesMultiDates });

  // Controle d'equilibre par piece
  const valides = [];
  for (const p of pieces) {
    const d = p.lignes.reduce((s, l) => s + l.debit_c, 0);
    const c = p.lignes.reduce((s, l) => s + l.credit_c, 0);
    if (d !== c) {
      rapport.erreurs.push({ code: "PIECE_DESEQUILIBREE", journal: p.journal, piece: p.piece, debit: centimesVersDecimal(d), credit: centimesVersDecimal(c) });
      continue;
    }
    p.total_c = d;
    valides.push(p);
  }

  // Journaux, exercices
  for (const code of [...new Set(valides.map((p) => p.journal))]) await ctx.assurerJournal(code);
  for (const date of [...new Set(valides.map((p) => p.date))].sort()) await ctx.exerciceDe(date);

  // Tiers des comptes collectifs
  for (const p of valides) {
    p.journalObj = ctx.journaux.get(p.journal);
    p.exercice = ctx.exercices.get(p.date);
    for (const l of p.lignes) {
      const type = ctx.collectifType(l.compte);
      if (!type) continue;
      const compte = ctx.comptes.get(l.compte);
      if (!compte.tiers_obligatoire && !l.tiers) continue;
      let tiers = null;
      if (l.tiers) tiers = await ctx.tiersPourCode(type, l.tiers.toUpperCase(), l.nomTiers);
      else tiers = await ctx.tiersGenerique(type);
      l.tiers_id = tiers.id;
    }
  }
  if (rapport.tiers_generiques.CLIENT || rapport.tiers_generiques.FOURNISSEUR) {
    const nb = valides.reduce((s, p) => s + p.lignes.filter((l) => l.tiers_id && !l.tiers).length, 0);
    rapport.avertissements.push({ code: "LIGNES_SANS_TIERS", nombre: nb });
  }

  if (rapport.erreurs.length > 0) return terminer(rapport, simulation);

  // Doublons : pieces deja presentes (meme journal, piece, date, montant)
  const exoIds = [...new Set(valides.map((p) => p.exercice.id))];
  const existantes = await client.query(
    `SELECT e.journal_id, e.numero_piece, e.date_ecriture::text AS d,
            COALESCE(SUM(l.debit), 0) AS total
     FROM ecriture_comptable e JOIN ligne_ecriture l ON l.ecriture_id = e.id
     WHERE e.tenant_id = $1 AND e.exercice_id = ANY($2) AND e.numero_piece IS NOT NULL
     GROUP BY e.id`,
    [tenantId, exoIds]
  );
  const cles = new Set(existantes.rows.map((r) => `${r.journal_id}|${r.numero_piece}|${r.d}|${versCentimes(r.total)}`));
  const aEcrire = valides.filter((p) => {
    const dup = cles.has(`${p.journalObj.id}|${p.piece}|${p.date}|${p.total_c}`);
    if (dup) rapport.stats.ecritures_ignorees_doublon++;
    return !dup;
  });
  if (rapport.stats.ecritures_ignorees_doublon > 0) {
    rapport.avertissements.push({ code: "ECRITURES_DEJA_PRESENTES", nombre: rapport.stats.ecritures_ignorees_doublon });
  }
  if (aEcrire.length === 0) {
    rapport.erreurs.push({ code: "RIEN_A_IMPORTER" });
    return terminer(rapport, simulation);
  }

  const dates = aEcrire.map((p) => p.date).sort();
  rapport.stats.date_min = dates[0];
  rapport.stats.date_max = dates[dates.length - 1];
  if (options.statut === "VALIDEE") {
    const apres = await client.query(
      `SELECT COUNT(*)::int AS n FROM ecriture_comptable
       WHERE tenant_id = $1 AND statut = 'VALIDEE' AND exercice_id = ANY($2) AND journal_id = ANY($3) AND date_ecriture > $4::date`,
      [tenantId, exoIds, [...new Set(aEcrire.map((p) => p.journalObj.id))], dates[0]]
    );
    if (apres.rows[0].n > 0) rapport.avertissements.push({ code: "IMPORT_NON_CHRONOLOGIQUE", nombre: apres.rows[0].n });
  }

  const lot = await creerLot(client, tenantId, utilisateurId, { type: "GRAND_LIVRE", nomFichier, empreinte, options });
  const resume = await ecrirePieces(ctx, lot, aEcrire);
  rapport.lot_id = lot.id;
  await finaliserLot(client, tenantId, utilisateurId, lot, "GRAND_LIVRE", resume, rapport);
  return terminer(rapport, simulation);
}

// ----------------------------------------------------------------------------
// Import d'une balance (a-nouveaux, mouvements ou soldes a une date)
// ----------------------------------------------------------------------------

async function importerBalance(client, tenantId, utilisateurId, { buffer, nomFichier, tiersClients, tiersFournisseurs, options: optionsBrutes, simulation }) {
  const options = normaliserOptions(optionsBrutes);
  const parametre = await compta.exigerInitialise(client, tenantId);
  const rapport = nouveauRapport();

  const hash = crypto.createHash("sha256").update(buffer);
  if (tiersClients) hash.update(tiersClients);
  if (tiersFournisseurs) hash.update(tiersFournisseurs);
  hash.update(JSON.stringify([options.colonnes, options.date_ecriture, options.journal_code]));
  const empreinte = hash.digest("hex");
  if (await lotDejaImporte(client, tenantId, "BALANCE", empreinte)) throw new ComptaError("COMPTA_IMPORT_DEJA_IMPORTE", 409);

  if (!options.date_ecriture || !lireDate(options.date_ecriture)) throw new ComptaError("COMPTA_IMPORT_DATE_REQUISE", 400);
  const dateEcriture = lireDate(options.date_ecriture);
  const journalCode = options.journal_code || (options.colonnes === "MOUVEMENTS" ? "OD" : "AN");

  const parse = parserBalanceGenerale(lireClasseur(buffer), parametre.longueur_compte, options.colonnes);
  rapport.erreurs.push(...parse.erreurs);
  rapport.stats.lignes_lues = parse.lignes.length;
  rapport.stats.lignes_ignorees = parse.ignorees;

  const ctx = new Contexte(client, tenantId, utilisateurId, parametre, options, rapport);
  for (const l of parse.lignes) if (l.libelle) ctx.libellesComptes.set(l.compte, l.libelle);
  await ctx.charger();

  // Comptes a mouvementer (net non nul)
  const utiles = parse.lignes.filter((l) => l.net_c !== 0);
  // Fusion des doublons de compte
  const parCompte = new Map();
  for (const l of utiles) parCompte.set(l.compte, (parCompte.get(l.compte) || 0) + l.net_c);
  const comptesNets = [...parCompte.entries()].filter(([, v]) => v !== 0);
  if (comptesNets.length === 0) {
    rapport.erreurs.push({ code: "RIEN_A_IMPORTER" });
    return terminer(rapport, simulation);
  }
  await ctx.assurerComptes(comptesNets.map(([n]) => n));

  const journal = await ctx.assurerJournal(journalCode, journalCode === "AN" ? "A_NOUVEAUX" : journalCode === "OD" ? "OPERATIONS_DIVERSES" : null);
  const exercice = await ctx.exerciceDe(dateEcriture);

  // Equilibre de la balance
  let totalD = 0;
  let totalC = 0;
  for (const [, v] of comptesNets) {
    if (v > 0) totalD += v;
    else totalC += -v;
  }
  if (totalD !== totalC) {
    rapport.erreurs.push({ code: "BALANCE_DESEQUILIBREE", debit: centimesVersDecimal(totalD), credit: centimesVersDecimal(totalC), ecart: centimesVersDecimal(totalD - totalC) });
  }
  if (options.colonnes === "AN") {
    const m = comptesNets.filter(([n]) => n[0] === "6" || n[0] === "7");
    if (m.length > 0) rapport.avertissements.push({ code: "AN_CLASSES_6_7", nombre: m.length });
  }

  // Detail par tiers (balances auxiliaires)
  const detailTiers = new Map(); // compte collectif -> [{type, code, nom, net_c}]
  async function lireTiers(buf, type) {
    if (!buf) return;
    const p = parserBalanceTiers(lireClasseur(buf), options.colonnes);
    rapport.erreurs.push(...p.erreurs);
    const collectif = type === "CLIENT" ? parametre.compte_client_collectif : parametre.compte_fournisseur_collectif;
    const liste = p.tiers.filter((t) => t.net_c !== 0);
    detailTiers.set(collectif, liste.map((t) => ({ ...t, type })));
  }
  await lireTiers(tiersClients, "CLIENT");
  await lireTiers(tiersFournisseurs, "FOURNISSEUR");

  const lignes = [];
  for (const [numero, net] of comptesNets.sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const type = ctx.collectifType(numero);
    const compte = ctx.comptes.get(numero);
    const libelle = compte ? compte.libelle : numero;
    if (type && compte && compte.tiers_obligatoire) {
      const detail = detailTiers.get(numero);
      let reste = net;
      if (detail && detail.length) {
        for (const t of detail) {
          const tiers = await ctx.tiersPourCode(type, t.code, t.nom);
          lignes.push({ compte: numero, libelle: t.nom || libelle, tiers_id: tiers.id, debit_c: t.net_c > 0 ? t.net_c : 0, credit_c: t.net_c < 0 ? -t.net_c : 0 });
          reste -= t.net_c;
        }
        if (reste !== 0) {
          rapport.avertissements.push({ code: "TIERS_ECART_COLLECTIF", compte: numero, ecart: centimesVersDecimal(reste) });
        }
      }
      if (reste !== 0) {
        const g = await ctx.tiersGenerique(type);
        lignes.push({ compte: numero, libelle, tiers_id: g.id, debit_c: reste > 0 ? reste : 0, credit_c: reste < 0 ? -reste : 0 });
      }
    } else {
      lignes.push({ compte: numero, libelle, tiers_id: null, debit_c: net > 0 ? net : 0, credit_c: net < 0 ? -net : 0 });
    }
  }
  if ((rapport.tiers_generiques.CLIENT || rapport.tiers_generiques.FOURNISSEUR) && !tiersClients && !tiersFournisseurs) {
    rapport.avertissements.push({ code: "COLLECTIFS_SANS_DETAIL" });
  }

  if (rapport.erreurs.length > 0 || !journal || !exercice) return terminer(rapport, simulation);

  const libelle =
    options.libelle ||
    (options.colonnes === "AN"
      ? `A.N. au ${dateEcriture.split("-").reverse().join("/")}`
      : options.colonnes === "SOLDES"
      ? `Reprise des soldes au ${dateEcriture.split("-").reverse().join("/")}`
      : `Reprise des mouvements au ${dateEcriture.split("-").reverse().join("/")}`);
  const piece = {
    journal: journal.code,
    piece: "",
    date: dateEcriture,
    libelle,
    ordre: 0,
    journalObj: journal,
    exercice,
    lignes,
  };
  rapport.stats.date_min = dateEcriture;
  rapport.stats.date_max = dateEcriture;

  const lot = await creerLot(client, tenantId, utilisateurId, { type: "BALANCE", nomFichier, empreinte, options });
  const resume = await ecrirePieces(ctx, lot, [piece]);
  rapport.lot_id = lot.id;
  await finaliserLot(client, tenantId, utilisateurId, lot, "BALANCE", resume, rapport);
  return terminer(rapport, simulation);
}

// ----------------------------------------------------------------------------
// Point d'entree commun (apercu = import annule a la fin)
// ----------------------------------------------------------------------------

async function lancer(fn, tenantId, utilisateurId, params, simulation) {
  try {
    const rapport = await compta.avecTransaction((client) => fn(client, tenantId, utilisateurId, { ...params, simulation }));
    return { rapport, simulation: false };
  } catch (e) {
    if (e instanceof SimulationTerminee) return { rapport: e.rapport, simulation: true };
    if (e instanceof ImportRapportError) return { rapport: e.rapport, simulation };
    throw e;
  }
}

const apercuGrandLivre = (tenantId, userId, params) => lancer(importerGrandLivre, tenantId, userId, params, true);
const executerGrandLivre = (tenantId, userId, params) => lancer(importerGrandLivre, tenantId, userId, params, false);
const apercuBalance = (tenantId, userId, params) => lancer(importerBalance, tenantId, userId, params, true);
const executerBalance = (tenantId, userId, params) => lancer(importerBalance, tenantId, userId, params, false);

// ----------------------------------------------------------------------------
// Lots : liste et annulation
// ----------------------------------------------------------------------------

async function listerLots(client, tenantId) {
  const r = await client.query(
    `SELECT l.id, l.type_import, l.nom_fichier, l.statut_ecritures, l.nb_ecritures, l.nb_lignes, l.total_debit, l.total_credit,
            l.statut, l.date_creation, l.date_annulation, COALESCE(u.prenom || ' ', '') || u.nom AS cree_par_nom,
            (SELECT MIN(e.date_ecriture) FROM ecriture_comptable e WHERE e.import_lot_id = l.id) AS date_min,
            (SELECT MAX(e.date_ecriture) FROM ecriture_comptable e WHERE e.import_lot_id = l.id) AS date_max
     FROM compta_import_lot l LEFT JOIN utilisateur u ON u.id = l.cree_par
     WHERE l.tenant_id = $1 ORDER BY l.date_creation DESC LIMIT 100`,
    [tenantId]
  );
  return r.rows;
}

/**
 * Annule un lot : supprime ses ecritures et rend les numeros consommes, a
 * condition que ces numeros soient les derniers de leur (exercice, journal)
 * - sinon un trou apparaitrait dans la numerotation continue.
 */
async function annulerLot(client, tenantId, utilisateurId, lotId) {
  const l = await client.query(`SELECT * FROM compta_import_lot WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [lotId, tenantId]);
  const lot = l.rows[0];
  if (!lot) throw new ComptaError("COMPTA_IMPORT_LOT_INTROUVABLE", 404);
  if (lot.statut === "ANNULE") throw new ComptaError("COMPTA_IMPORT_LOT_ANNULE", 409);

  const ecritures = await client.query(
    `SELECT e.id, e.exercice_id, e.journal_id, e.numero_ecriture, e.statut, e.extournee_par_id, e.extourne_de_id, j.code AS journal_code, x.statut AS exercice_statut
     FROM ecriture_comptable e JOIN journal_comptable j ON j.id = e.journal_id JOIN exercice_comptable x ON x.id = e.exercice_id
     WHERE e.import_lot_id = $1 AND e.tenant_id = $2`,
    [lotId, tenantId]
  );
  if (ecritures.rows.some((e) => e.exercice_statut === "CLOTURE")) throw new ComptaError("COMPTA_IMPORT_ANNULATION_EXERCICE_CLOTURE", 409);
  if (ecritures.rows.some((e) => e.extournee_par_id || e.extourne_de_id)) throw new ComptaError("COMPTA_IMPORT_ANNULATION_IMPOSSIBLE", 409);

  // Numeros : les ecritures du lot doivent etre les dernieres de chaque (exercice, journal)
  const groupes = new Map();
  for (const e of ecritures.rows) {
    if (e.numero_ecriture === null) continue;
    const cle = `${e.exercice_id}|${e.journal_id}`;
    if (!groupes.has(cle)) groupes.set(cle, { exercice_id: e.exercice_id, journal_id: e.journal_id, code: e.journal_code, numeros: [] });
    groupes.get(cle).numeros.push(e.numero_ecriture);
  }
  for (const g of groupes.values()) {
    const autres = await client.query(
      `SELECT COALESCE(MAX(numero_ecriture), 0) AS max FROM ecriture_comptable
       WHERE tenant_id = $1 AND exercice_id = $2 AND journal_id = $3 AND numero_ecriture IS NOT NULL
         AND (import_lot_id IS NULL OR import_lot_id <> $4)`,
      [tenantId, g.exercice_id, g.journal_id, lotId]
    );
    const max = Number(autres.rows[0].max);
    if (g.numeros.some((n) => n < max)) throw new ComptaError("COMPTA_IMPORT_ANNULATION_NUMEROS", 409, { libelle: g.code });
    g.nouveauDernier = max;
  }
  await client.query(`DELETE FROM ecriture_comptable WHERE import_lot_id = $1 AND tenant_id = $2`, [lotId, tenantId]);
  for (const g of groupes.values()) {
    await client.query(
      `UPDATE compteur_numerotation SET dernier_numero = $3 WHERE tenant_id = $1 AND type_compteur = $2 AND annee = 0`,
      [tenantId, `ECR:${g.exercice_id}:${g.code}`, g.nouveauDernier]
    );
  }
  await client.query(`UPDATE compta_import_lot SET statut = 'ANNULE', annule_par = $2, date_annulation = now() WHERE id = $1`, [lotId, utilisateurId]);
  await compta.audit(client, tenantId, utilisateurId, "ANNULATION_IMPORT", "compta_import_lot", lotId, { ecritures: ecritures.rows.length }, null);
  return { ecritures_supprimees: ecritures.rows.length };
}

// ----------------------------------------------------------------------------
// Modeles Excel (format Sage)
// ----------------------------------------------------------------------------

function modeleGrandLivre() {
  const wb = XLSX.utils.book_new();
  const donnees = [
    ["N° COMPTE", "DATE", "CODE J", "N° PIECES", "LIBELLE", "LETTRAGE", "DEBIT", "CREDIT", "SOLDES", "TIERS", "NOM TIERS"],
    ["40110000", "02/01/2026", "ACH", "1", "Achat matiere premiere", "A", null, 118000, -118000, "F2001", "Fournisseur exemple"],
    ["44520000", "02/01/2026", "ACH", "1", "TVA recuperable", null, 18000, null, 18000, null],
    ["60210000", "02/01/2026", "ACH", "1", "Achat matiere premiere", null, 100000, null, 100000, null],
    ["40110000", "03/01/2026", "CAI", "1", "Reglement fournisseur", "A", 118000, null, 0, "F2001", "Fournisseur exemple"],
    ["57110000", "03/01/2026", "CAI", "1", "Reglement fournisseur", null, null, 118000, -118000, null],
  ];
  const ws = XLSX.utils.aoa_to_sheet(donnees);
  ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 32 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, ws, "Grand livre");
  const aide = XLSX.utils.aoa_to_sheet([
    ["Modele d'import du grand livre (format des exports Sage)"],
    ["Une ligne par mouvement ; les lignes d'une meme piece (code journal + n° de piece) doivent s'equilibrer."],
    ["Colonnes obligatoires : N° COMPTE, DATE, CODE J, N° PIECES, DEBIT, CREDIT. LIBELLE et LETTRAGE sont repris."],
    ["Colonnes TIERS et NOM TIERS (facultatives) : code et nom auxiliaire des lignes 411 / 401 ; sans elles, ces lignes vont sur un tiers de reprise."],
    ["Les numeros de compte sont completes a droite par des zeros jusqu'a la longueur du plan comptable (ex. 4011 -> 40110000)."],
    ["Dates : jj/mm/aaaa, aaaa-mm-jj ou dates Excel. La colonne SOLDES n'est pas utilisee (recalculee)."],
  ]);
  ws["!cols"] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, aide, "Aide");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function modeleBalance() {
  const wb = XLSX.utils.book_new();
  const donnees = [
    ["Nom de l'entreprise"],
    [null, null, "Solde au 01/01/26", null, "Mouvements", null, "Soldes cumules", null],
    ["compte", null, "Debit", "Credit", "Debit", "Credit", "Debit", "Credit"],
    ["10100000", "Capital social", null, 5000000, null, null, null, 5000000],
    ["22200000", "Terrains", 3000000, null, null, null, 3000000, null],
    ["41110000", "Clients", 1500000, null, 250000, 100000, 1650000, null],
    ["52110000", "Banque", 500000, null, 0, 150000, 350000, null],
  ];
  const ws = XLSX.utils.aoa_to_sheet(donnees);
  ws["!cols"] = [{ wch: 12 }, { wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, "Balance");
  const tiers = XLSX.utils.aoa_to_sheet([
    ["CA001", "Client exemple", 1000000, null, 250000, 100000, 1150000, null],
    ["CA002", "Autre client", 500000, null, null, null, 500000, null],
  ]);
  tiers["!cols"] = [{ wch: 10 }, { wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, tiers, "Balance clients (facultatif)");
  const aide = XLSX.utils.aoa_to_sheet([
    ["Modele d'import d'une balance generale (format des exports Sage)"],
    ["Colonnes : compte, libelle, puis Solde au 01/01 (Debit, Credit), Mouvements (Debit, Credit), Soldes cumules (Debit, Credit)."],
    ["On choisit a l'import le bloc a reprendre : a-nouveaux, mouvements ou soldes cumules, et la date de l'ecriture."],
    ["Les balances auxiliaires clients / fournisseurs (code tiers, nom, memes 6 colonnes) sont facultatives et detaillent les comptes 411 / 401."],
    ["La balance doit etre equilibree (total debit = total credit) pour le bloc choisi."],
  ]);
  aide["!cols"] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, aide, "Aide");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

module.exports = {
  apercuGrandLivre,
  executerGrandLivre,
  apercuBalance,
  executerBalance,
  listerLots,
  annulerLot,
  modeleGrandLivre,
  modeleBalance,
  // pour les tests et pour l'import du module Fiscalite (lecture des memes fichiers Sage)
  lireClasseur,
  lireMontant,
  cleEntete,
  lireDate,
  normaliserCompte,
  parserGrandLivre,
  parserBalanceGenerale,
};
