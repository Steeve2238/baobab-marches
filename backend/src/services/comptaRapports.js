/**
 * Etats comptables calcules a partir des ecritures (phase 1) : grand livre et
 * balance generale, au format des exports Sage de reference (voir
 * architecture_module_comptabilite_v2 §3). Les montants sont manipules en
 * centimes entiers (voir comptaService.versCentimes) et renvoyes en nombres
 * decimaux (centimes / 100) pour l'affichage.
 */
const { versCentimes } = require("./comptaService");
const { libelleRegroupement } = require("../data/planSyscohada");

class RapportError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/**
 * Determine l'exercice et la periode du rapport. `exercice_id` explicite, sinon
 * l'exercice ouvert contenant la date du jour, sinon le plus recent.
 */
async function resoudrePeriode(client, tenantId, { exercice_id, date_debut, date_fin }) {
  let exercice;
  if (exercice_id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(exercice_id))) {
      throw new RapportError("COMPTA_EXERCICE_INTROUVABLE", 404);
    }
    exercice = (await client.query(`SELECT * FROM exercice_comptable WHERE id = $1 AND tenant_id = $2`, [exercice_id, tenantId])).rows[0];
  } else {
    exercice = (
      await client.query(
        `SELECT * FROM exercice_comptable WHERE tenant_id = $1
         ORDER BY (CURRENT_DATE BETWEEN date_debut AND date_fin) DESC, date_debut DESC LIMIT 1`,
        [tenantId]
      )
    ).rows[0];
  }
  if (!exercice) throw new RapportError("COMPTA_EXERCICE_INTROUVABLE", 404);
  const debut = date_debut || exercice.date_debut;
  const fin = date_fin || exercice.date_fin;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(debut) || !/^\d{4}-\d{2}-\d{2}$/.test(fin) || fin < debut) {
    throw new RapportError("COMPTA_PERIODE_INVALIDE");
  }
  if (debut < exercice.date_debut || fin > exercice.date_fin) throw new RapportError("COMPTA_PERIODE_HORS_EXERCICE");
  return { exercice, debut, fin };
}

function statutsInclus(inclureInstance) {
  return inclureInstance ? ["VALIDEE", "EN_INSTANCE"] : ["VALIDEE"];
}

const versDecimal = (c) => c / 100;

/**
 * Lignes d'ecritures de l'exercice jusqu'a `fin`, avec compte et journal,
 * filtrees par plage de comptes. Triees par compte puis date / journal /
 * numero d'ecriture / ordre.
 */
async function chargerLignes(client, tenantId, exerciceId, fin, { compte_de, compte_a, statuts }) {
  const params = [tenantId, exerciceId, fin, statuts];
  let filtre = "";
  if (compte_de) {
    params.push(String(compte_de));
    filtre += ` AND c.numero >= $${params.length}`;
  }
  if (compte_a) {
    params.push(String(compte_a));
    filtre += ` AND c.numero <= $${params.length}`;
  }
  const r = await client.query(
    `SELECT c.numero AS compte_numero, c.libelle AS compte_libelle,
            e.id AS ecriture_id, e.date_ecriture, e.numero_piece, e.numero_ecriture, e.statut,
            e.libelle AS ecriture_libelle, j.code AS journal_code, j.type_journal,
            l.libelle AS ligne_libelle, l.lettrage, l.debit, l.credit, l.ordre,
            t.code AS tiers_code
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN journal_comptable j ON j.id = e.journal_id
     JOIN compte_comptable c ON c.id = l.compte_id
     LEFT JOIN tiers_comptable t ON t.id = l.tiers_id
     WHERE l.tenant_id = $1 AND e.exercice_id = $2 AND e.date_ecriture <= $3::date
       AND e.statut = ANY($4::text[]) ${filtre}
     ORDER BY c.numero, e.date_ecriture, j.code, e.numero_ecriture NULLS LAST, l.ordre`,
    params
  );
  return r.rows;
}

/**
 * GRAND LIVRE : par compte, ecritures de la periode avec solde progressif
 * (debit - credit, negatif = credit, comme Sage). Si la periode ne commence pas
 * au debut de l'exercice, le solde anterieur est restitue en "report".
 */
async function grandLivre(client, tenantId, options = {}) {
  const { exercice, debut, fin } = await resoudrePeriode(client, tenantId, options);
  const lignes = await chargerLignes(client, tenantId, exercice.id, fin, {
    compte_de: options.compte_de,
    compte_a: options.compte_a,
    statuts: statutsInclus(options.inclure_instance),
  });

  const comptes = [];
  let courant = null;
  for (const l of lignes) {
    if (!courant || courant.numero !== l.compte_numero) {
      courant = {
        numero: l.compte_numero,
        libelle: l.compte_libelle,
        report_debit_c: 0,
        report_credit_c: 0,
        total_debit_c: 0,
        total_credit_c: 0,
        lignes: [],
      };
      comptes.push(courant);
    }
    const d = versCentimes(l.debit);
    const c = versCentimes(l.credit);
    if (l.date_ecriture < debut) {
      courant.report_debit_c += d;
      courant.report_credit_c += c;
      continue;
    }
    courant.total_debit_c += d;
    courant.total_credit_c += c;
    courant.lignes.push({ ...l, debit_c: d, credit_c: c });
  }

  const total = { debit_c: 0, credit_c: 0 };
  const resultat = [];
  for (const compte of comptes) {
    if (compte.lignes.length === 0) continue; // compte sans mouvement sur la periode : non imprime (comme Sage)
    let solde = compte.report_debit_c - compte.report_credit_c;
    const lignesSortie = compte.lignes.map((l) => {
      solde += l.debit_c - l.credit_c;
      return {
        ecriture_id: l.ecriture_id,
        date: l.date_ecriture,
        journal: l.journal_code,
        numero_ecriture: l.numero_ecriture,
        numero_piece: l.numero_piece,
        libelle: l.ligne_libelle || l.ecriture_libelle,
        lettrage: l.lettrage,
        tiers_code: l.tiers_code,
        statut: l.statut,
        debit: versDecimal(l.debit_c),
        credit: versDecimal(l.credit_c),
        solde_progressif: versDecimal(solde),
      };
    });
    total.debit_c += compte.total_debit_c;
    total.credit_c += compte.total_credit_c;
    resultat.push({
      numero: compte.numero,
      libelle: compte.libelle,
      report: {
        debit: versDecimal(compte.report_debit_c),
        credit: versDecimal(compte.report_credit_c),
        solde: versDecimal(compte.report_debit_c - compte.report_credit_c),
      },
      lignes: lignesSortie,
      total_debit: versDecimal(compte.total_debit_c),
      total_credit: versDecimal(compte.total_credit_c),
      solde: versDecimal(solde),
    });
  }

  return {
    exercice: { id: exercice.id, libelle: exercice.libelle, date_debut: exercice.date_debut, date_fin: exercice.date_fin },
    periode: { debut, fin },
    inclure_instance: !!options.inclure_instance,
    comptes: resultat,
    total: { debit: versDecimal(total.debit_c), credit: versDecimal(total.credit_c) },
  };
}

const ZERO = () => ({ ouv_d: 0, ouv_c: 0, mvt_d: 0, mvt_c: 0 });

function soldes(t) {
  const net = t.ouv_d + t.mvt_d - (t.ouv_c + t.mvt_c);
  return { sd: net > 0 ? net : 0, sc: net < 0 ? -net : 0 };
}

function versLigne(t) {
  const s = soldes(t);
  return {
    ouverture_debit: versDecimal(t.ouv_d),
    ouverture_credit: versDecimal(t.ouv_c),
    mouvement_debit: versDecimal(t.mvt_d),
    mouvement_credit: versDecimal(t.mvt_c),
    solde_debit: versDecimal(s.sd),
    solde_credit: versDecimal(s.sc),
  };
}

function ajouter(cible, t) {
  cible.ouv_d += t.ouv_d;
  cible.ouv_c += t.ouv_c;
  cible.mvt_d += t.mvt_d;
  cible.mvt_c += t.mvt_c;
}

/**
 * BALANCE GENERALE (trois blocs de colonnes, comme Sage) :
 *   - ouverture = a-nouveaux (journaux de type A_NOUVEAUX) + mouvements
 *     anterieurs a la periode ;
 *   - mouvements = ecritures de la periode (hors a-nouveaux) ;
 *   - soldes cumules = ouverture + mouvements.
 * Les lignes "compte" sont entrelacees de lignes de sous-total par famille
 * (3 chiffres si >= 2 comptes, 2 chiffres, classe), plus un total general.
 */
async function balanceGenerale(client, tenantId, options = {}) {
  const { exercice, debut, fin } = await resoudrePeriode(client, tenantId, options);
  const lignes = await chargerLignes(client, tenantId, exercice.id, fin, {
    compte_de: options.compte_de,
    compte_a: options.compte_a,
    statuts: statutsInclus(options.inclure_instance),
  });

  const parCompte = new Map();
  for (const l of lignes) {
    let t = parCompte.get(l.compte_numero);
    if (!t) {
      t = { numero: l.compte_numero, libelle: l.compte_libelle, ...ZERO() };
      parCompte.set(l.compte_numero, t);
    }
    const d = versCentimes(l.debit);
    const c = versCentimes(l.credit);
    const estAnouveau = l.type_journal === "A_NOUVEAUX";
    if (estAnouveau || l.date_ecriture < debut) {
      t.ouv_d += d;
      t.ouv_c += c;
    } else {
      t.mvt_d += d;
      t.mvt_c += c;
    }
  }

  const comptes = Array.from(parCompte.values()).sort((a, b) => (a.numero < b.numero ? -1 : a.numero > b.numero ? 1 : 0));
  const sortie = [];
  const general = ZERO();
  const soldesGeneral = { sd: 0, sc: 0 }; // somme des soldes debiteurs / crediteurs compte par compte
  const niveaux = [3, 2, 1];
  const groupes = {}; // niveau -> { prefixe, total, nb }

  function fermer(niveau) {
    const g = groupes[niveau];
    if (!g) return;
    if (niveau === 3 && g.nb < 2) {
      // un groupe a 3 chiffres ne contenant qu'un compte n'a pas de sous-total propre
    } else {
      sortie.push({
        type: "sous_total",
        niveau,
        prefixe: g.prefixe,
        libelle: libelleRegroupement(g.prefixe) || "",
        ...versLigne(g.total),
      });
    }
    groupes[niveau] = null;
  }

  for (let i = 0; i < comptes.length; i++) {
    const c = comptes[i];
    // Premier niveau (du plus general, 1 chiffre, au plus fin, 3 chiffres) dont
    // le prefixe change : on ferme ce niveau et tous les niveaux plus fins,
    // du plus fin au plus general (3, puis 2, puis 1).
    let niveauChange = null;
    for (const n of [1, 2, 3]) {
      const g = groupes[n];
      if (g && g.prefixe !== c.numero.slice(0, n)) {
        niveauChange = n;
        break;
      }
    }
    if (niveauChange !== null) {
      for (const m of niveaux.filter((x) => x >= niveauChange)) fermer(m);
    }
    for (const n of niveaux) {
      if (!groupes[n]) groupes[n] = { prefixe: c.numero.slice(0, n), total: ZERO(), nb: 0 };
      ajouter(groupes[n].total, c);
      groupes[n].nb += 1;
    }
    ajouter(general, c);
    const sc_ = soldes(c);
    soldesGeneral.sd += sc_.sd;
    soldesGeneral.sc += sc_.sc;
    sortie.push({ type: "compte", numero: c.numero, libelle: c.libelle, ...versLigne(c) });
  }
  for (const n of niveaux) fermer(n);

  return {
    exercice: { id: exercice.id, libelle: exercice.libelle, date_debut: exercice.date_debut, date_fin: exercice.date_fin },
    periode: { debut, fin },
    inclure_instance: !!options.inclure_instance,
    lignes: sortie,
    // Total general : les colonnes de solde totalisent les soldes debiteurs et
    // crediteurs de chaque compte (et non leur difference), pour controler l'equilibre.
    totaux: { ...versLigne(general), solde_debit: versDecimal(soldesGeneral.sd), solde_credit: versDecimal(soldesGeneral.sc) },
    nombre_comptes: comptes.length,
  };
}

module.exports = { grandLivre, balanceGenerale, RapportError, resoudrePeriode, statutsInclus };
