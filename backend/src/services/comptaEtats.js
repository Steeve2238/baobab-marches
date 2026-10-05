/**
 * Etats financiers SYSCOHADA (phase 4) : bilan et compte de resultat, calcules
 * a partir des ecritures. Chaque compte est rattache a une ligne de l'etat par
 * son prefixe (le plus long l'emporte), voir data/syscohadaEtats.js. Tous les
 * calculs sont en centimes entiers ; la sortie est en decimaux (centimes / 100).
 *
 * Controles : actif = passif ; resultat du bilan = resultat du compte de
 * resultat = - somme des soldes (debit - credit) des classes 6 a 8.
 */
const { REGLES_BILAN, ACTIF, PASSIF, REGLES_RESULTAT, RESULTAT } = require("../data/syscohadaEtats");
const { resoudrePeriode, statutsInclus } = require("./comptaRapports");

const dec = (c) => c / 100;
const CODES_ACTIF = new Set(ACTIF.filter((x) => x.code).map((x) => x.code));

const INDEX_BILAN = new Map(REGLES_BILAN.map((r) => [r.p, r]));
const INDEX_RESULTAT = new Map(REGLES_RESULTAT.map((r) => [r.p, r.l]));

function chercher(index, numero) {
  for (let n = Math.min(4, numero.length); n >= 1; n--) {
    const r = index.get(numero.slice(0, n));
    if (r !== undefined) return r;
  }
  return null;
}

/**
 * Soldes (debit - credit, centimes) par compte sur [from, to] de l'exercice.
 * `horsANouveaux` exclut les journaux d'a-nouveaux (utile pour le resultat de
 * la periode).
 */
async function chargerSoldes(client, tenantId, exerciceId, from, to, statuts, { horsANouveaux = false } = {}) {
  const r = await client.query(
    `SELECT c.numero, MAX(c.libelle) AS libelle,
            COALESCE(SUM(ROUND(l.debit * 100)), 0)::text AS d,
            COALESCE(SUM(ROUND(l.credit * 100)), 0)::text AS c
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN journal_comptable j ON j.id = e.journal_id
     JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.tenant_id = $1 AND e.exercice_id = $2
       AND e.date_ecriture >= $3::date AND e.date_ecriture <= $4::date
       AND e.statut = ANY($5::text[])
       ${horsANouveaux ? "AND j.type_journal <> 'A_NOUVEAUX'" : ""}
     GROUP BY c.numero
     ORDER BY c.numero`,
    [tenantId, exerciceId, from, to, statuts]
  );
  return r.rows.map((x) => ({ numero: String(x.numero), libelle: x.libelle, debit_c: Number(x.d), credit_c: Number(x.c), net_c: Number(x.d) - Number(x.c) }));
}

/** Resultat de la periode : contribution (produit +, charge -) par ligne. */
function calculerResultat(soldes) {
  const lignes = {};
  const nonClasses = [];
  let somme6a8 = 0;
  for (const s of soldes) {
    const cl = s.numero[0];
    if (cl !== "6" && cl !== "7" && cl !== "8") continue;
    const contribution = -s.net_c;
    somme6a8 += s.net_c;
    let code = chercher(INDEX_RESULTAT, s.numero);
    if (!code) {
      code = "NCR";
      if (s.net_c !== 0) nonClasses.push({ etat: "resultat", numero: s.numero, libelle: s.libelle, solde_debit: dec(Math.max(s.net_c, 0)), solde_credit: dec(Math.max(-s.net_c, 0)) });
    }
    lignes[code] = (lignes[code] || 0) + contribution;
  }
  const valeurs = { ...lignes };
  for (const it of RESULTAT) {
    if (it.type === "solde") valeurs[it.code] = it.somme.reduce((t, c) => t + (valeurs[c] || 0), 0);
  }
  return { valeurs, nonClasses, somme6a8, aImpot: (lignes.RS || 0) !== 0 };
}

/** Bilan : { actif: {code: {brut, amort, net}}, passif: {code: valeur} } en centimes. */
function calculerBilan(soldes, resultatXI) {
  const actif = {};
  const passif = {};
  const nonClasses = [];
  const A = (code) => (actif[code] = actif[code] || { brut: 0, amort: 0 });
  let totalNet = 0;

  for (const s of soldes) {
    const cl = s.numero[0];
    if (!"12345".includes(cl)) continue; // classes 6-8 -> resultat ; 0 et 9 hors bilan
    totalNet += s.net_c;
    if (s.net_c === 0) continue;
    const regle = chercher(INDEX_BILAN, s.numero);
    if (!regle) {
      if (s.net_c > 0) A("NCA").brut += s.net_c;
      else passif.NCP = (passif.NCP || 0) - s.net_c;
      nonClasses.push({ etat: "bilan", numero: s.numero, libelle: s.libelle, solde_debit: dec(Math.max(s.net_c, 0)), solde_credit: dec(Math.max(-s.net_c, 0)) });
      continue;
    }
    const ligne = s.net_c > 0 ? regle.d : regle.c;
    if (regle.amort) {
      A(ligne).amort += -s.net_c;
    } else if (CODES_ACTIF.has(ligne)) {
      A(ligne).brut += s.net_c;
    } else {
      passif[ligne] = (passif[ligne] || 0) - s.net_c;
    }
  }
  // Resultat de l'exercice (classes 6 a 8) au passif, en plus du compte 13 eventuel
  passif.CI = (passif.CI || 0) + resultatXI;
  return { actif, passif, nonClasses, totalNet };
}

/** Totaux (somme des lignes) pour un etat ordonne, par colonne. */
function totaliser(structure, valeursParCode, colonnes) {
  const vals = {};
  for (const it of structure) {
    if (!it.code) continue;
    if (it.type === "ligne") vals[it.code] = valeursParCode[it.code] || Object.fromEntries(colonnes.map((c) => [c, 0]));
  }
  for (const it of structure) {
    if (it.type !== "total") continue;
    const t = Object.fromEntries(colonnes.map((c) => [c, 0]));
    for (const c of it.somme) {
      const v = vals[c];
      if (v) for (const col of colonnes) t[col] += v[col] || 0;
    }
    vals[it.code] = t;
  }
  return vals;
}

function bilanChiffre(soldes, resultatXI) {
  const b = calculerBilan(soldes, resultatXI);
  const actifVals = {};
  for (const code of Object.keys(b.actif)) {
    const { brut, amort } = b.actif[code];
    actifVals[code] = { brut, amort, net: brut - amort };
  }
  const actifTot = totaliser(ACTIF, actifVals, ["brut", "amort", "net"]);
  const passifVals = {};
  for (const code of Object.keys(b.passif)) passifVals[code] = { net: b.passif[code] };
  const passifTot = totaliser(PASSIF, passifVals, ["net"]);
  return { actif: actifTot, passif: passifTot, nonClasses: b.nonClasses };
}

async function exercicePrecedent(client, tenantId, exercice) {
  const r = await client.query(
    `SELECT * FROM exercice_comptable WHERE tenant_id = $1 AND date_fin < $2::date ORDER BY date_fin DESC LIMIT 1`,
    [tenantId, exercice.date_debut]
  );
  return r.rows[0] || null;
}

const infoExercice = (e) => (e ? { id: e.id, libelle: e.libelle, date_debut: e.date_debut, date_fin: e.date_fin } : null);

async function contexte(client, tenantId, options) {
  const { exercice, debut, fin } = await resoudrePeriode(client, tenantId, options);
  const statuts = statutsInclus(options.inclure_instance);
  const prec = await exercicePrecedent(client, tenantId, exercice);
  return { exercice, debut, fin, statuts, prec };
}

async function avertissementsCommuns(client, tenantId, ctx, options) {
  const av = [];
  if (!options.inclure_instance) {
    const r = await client.query(
      `SELECT COUNT(*)::int AS n FROM ecriture_comptable
       WHERE tenant_id = $1 AND exercice_id = $2 AND statut = 'EN_INSTANCE' AND date_ecriture BETWEEN $3::date AND $4::date`,
      [tenantId, ctx.exercice.id, ctx.debut, ctx.fin]
    );
    if (r.rows[0].n > 0) av.push({ code: "ECRITURES_EN_INSTANCE_EXCLUES", nombre: r.rows[0].n });
  }
  return av;
}

/** BILAN a la date de fin (cumul depuis le debut de l'exercice). */
async function bilan(client, tenantId, options = {}) {
  const ctx = await contexte(client, tenantId, options);
  const { exercice, fin, statuts, prec } = ctx;
  const debEx = exercice.date_debut;

  const soldesN = await chargerSoldes(client, tenantId, exercice.id, debEx, fin, statuts);
  const resN = calculerResultat(await chargerSoldes(client, tenantId, exercice.id, debEx, fin, statuts, { horsANouveaux: true }));
  const n = bilanChiffre(soldesN, resN.valeurs.XI || 0);

  let n1 = null;
  if (prec) {
    const sPrec = await chargerSoldes(client, tenantId, prec.id, prec.date_debut, prec.date_fin, statuts);
    const rPrec = calculerResultat(await chargerSoldes(client, tenantId, prec.id, prec.date_debut, prec.date_fin, statuts, { horsANouveaux: true }));
    n1 = bilanChiffre(sPrec, rPrec.valeurs.XI || 0);
  }

  const zero = { brut: 0, amort: 0, net: 0 };
  const lignesActif = ACTIF.map((it) => {
    if (it.type === "titre") return { type: "titre", libelle: it.libelle };
    const a = n.actif[it.code] || zero;
    const b = n1 ? n1.actif[it.code] || zero : null;
    return {
      type: it.type,
      code: it.code,
      libelle: it.libelle,
      retrait: it.retrait || 0,
      fort: !!it.fort,
      sous_total: !!it.sousTotal,
      nc: !!it.nc,
      brut: dec(a.brut),
      amort: dec(a.amort),
      net: dec(a.net),
      net_n1: b ? dec(b.net) : null,
    };
  });
  const lignesPassif = PASSIF.map((it) => {
    if (it.type === "titre") return { type: "titre", libelle: it.libelle };
    const a = n.passif[it.code] || zero;
    const b = n1 ? n1.passif[it.code] || zero : null;
    return {
      type: it.type,
      code: it.code,
      libelle: it.libelle,
      retrait: it.retrait || 0,
      fort: !!it.fort,
      nc: !!it.nc,
      net: dec(a.net),
      net_n1: b ? dec(b.net) : null,
    };
  });

  const totalActif = n.actif.BZ.net;
  const totalPassif = n.passif.DZ.net;
  const ecart = totalActif - totalPassif;
  const avertissements = await avertissementsCommuns(client, tenantId, ctx, options);
  if (n.nonClasses.length) avertissements.push({ code: "COMPTES_NON_CLASSES", nombre: n.nonClasses.length });
  if (prec) {
    const r = await client.query(
      `SELECT COUNT(*)::int AS n FROM ecriture_comptable e JOIN journal_comptable j ON j.id = e.journal_id
       WHERE e.tenant_id = $1 AND e.exercice_id = $2 AND j.type_journal = 'A_NOUVEAUX' AND e.statut = ANY($3::text[])`,
      [tenantId, exercice.id, statuts]
    );
    if (r.rows[0].n === 0) avertissements.push({ code: "A_NOUVEAUX_ABSENTS" });
  }
  if (ecart !== 0) avertissements.push({ code: "BILAN_DESEQUILIBRE", ecart: dec(ecart) });

  return {
    exercice: infoExercice(exercice),
    exercice_n1: infoExercice(prec),
    periode: { debut: exercice.date_debut, fin },
    inclure_instance: !!options.inclure_instance,
    actif: lignesActif,
    passif: lignesPassif,
    resultat_net: dec(resN.valeurs.XI || 0),
    controles: {
      total_actif: dec(totalActif),
      total_passif: dec(totalPassif),
      ecart: dec(ecart),
      equilibre: ecart === 0,
      // somme (debit - credit) des classes 1 a 5 = - resultat : meme controle vu par la balance
      coherence_resultat: (resN.valeurs.XI || 0) === -resN.somme6a8,
    },
    non_classes: n.nonClasses,
    avertissements,
  };
}

/** COMPTE DE RESULTAT sur la periode (a-nouveaux exclus), N et N-1. */
async function compteResultat(client, tenantId, options = {}) {
  const ctx = await contexte(client, tenantId, options);
  const { exercice, debut, fin, statuts, prec } = ctx;
  const resN = calculerResultat(await chargerSoldes(client, tenantId, exercice.id, debut, fin, statuts, { horsANouveaux: true }));
  let resP = null;
  if (prec) resP = calculerResultat(await chargerSoldes(client, tenantId, prec.id, prec.date_debut, prec.date_fin, statuts, { horsANouveaux: true }));

  const lignes = RESULTAT.map((it) => ({
    type: it.type,
    code: it.code,
    libelle: it.libelle,
    fort: !!it.fort,
    nc: !!it.nc,
    n: dec(resN.valeurs[it.code] || 0),
    n1: resP ? dec(resP.valeurs[it.code] || 0) : null,
  }));
  const avertissements = await avertissementsCommuns(client, tenantId, ctx, options);
  if (!resN.aImpot) avertissements.push({ code: "IMPOT_NON_COMPTABILISE" });
  if (resN.nonClasses.length) avertissements.push({ code: "COMPTES_NON_CLASSES", nombre: resN.nonClasses.length });
  if (prec && (debut !== exercice.date_debut || fin !== exercice.date_fin)) avertissements.push({ code: "N1_EXERCICE_COMPLET" });

  return {
    exercice: infoExercice(exercice),
    exercice_n1: infoExercice(prec),
    periode: { debut, fin },
    inclure_instance: !!options.inclure_instance,
    lignes,
    resultat_net: dec(resN.valeurs.XI || 0),
    controles: { coherence_resultat: (resN.valeurs.XI || 0) === -resN.somme6a8 },
    non_classes: resN.nonClasses,
    avertissements,
  };
}

module.exports = { bilan, compteResultat };
