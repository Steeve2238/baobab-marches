/**
 * Module Fiscalite, lot 5 : controles de conformite fiscale (lecture seule, rien n'est modifie).
 *
 * Sources : factures de vente et d'achat de la plateforme quand elles existent, grand livre importe pour un client qui n'utilise que
 * le module Fiscalite, calendrier fiscal, profil. Chaque constat porte une gravite (ELEVEE / MOYENNE / INFO), un nombre, un montant
 * eventuel, quelques exemples et la reference du CGI. Mentions obligatoires de la facture : art. 447 I-5 ; facturation electronique :
 * art. 447 II (modalites fixees par arrete du ministre des Finances - non verifiees ici) ; TVA mentionnee a tort : art. 673.
 */
const db = require("../db");
const comptesSvc = require("./fiscaliteComptes");
const { getProfil, getContribuable } = require("./fiscaliteTva");
const { neaValide } = require("./fiscaliteRegime");
const calendrier = require("./fiscaliteCalendrier");

const num = (v) => Number(v || 0);
const arrondi = (v) => Math.round(num(v));
const MAX_EXEMPLES = 8;

const exemples = (liste, fn) => liste.slice(0, MAX_EXEMPLES).map(fn);
const dateIso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

function constat(code, gravite, reference, lignes, extra = {}) {
  return { code, gravite, reference, nombre: lignes.length, exemples: lignes.slice(0, MAX_EXEMPLES), ...extra };
}

/** Numerotation continue : trous dans la suite des numeros se terminant par un entier (meme prefixe). */
function trousNumerotation(numeros) {
  const groupes = new Map();
  for (const n of numeros) {
    const m = String(n).match(/^(.*?)(\d+)$/);
    if (!m) continue;
    const cle = m[1];
    if (!groupes.has(cle)) groupes.set(cle, { largeur: m[2].length, valeurs: new Set() });
    groupes.get(cle).valeurs.add(Number(m[2]));
  }
  const trous = [];
  for (const [prefixe, g] of groupes) {
    const v = [...g.valeurs].sort((a, b) => a - b);
    for (let i = 1; i < v.length; i++) {
      for (let k = v[i - 1] + 1; k < v[i] && trous.length < 200; k++) trous.push(`${prefixe}${String(k).padStart(g.largeur, "0")}`);
    }
  }
  return trous;
}

async function analyser(tenantId, annee) {
  const constats = [];
  const controles = [];
  const verifie = (code, probleme) => controles.push({ code, ok: !probleme });
  const profil = await getProfil(db, tenantId);
  const contribuable = await getContribuable(tenantId);
  const t = await db.query(`SELECT module_comptabilite_actif AS compta FROM tenant WHERE id = $1`, [tenantId]);
  const comptaActive = !!(t.rows[0] && t.rows[0].compta);
  const aujourdhui = new Date().toISOString().slice(0, 10);

  // ---- Contribuable ---------------------------------------------------------------------------------
  const nineaOk = neaValide(String(contribuable.ninea || "").replace(/[\s.-]/g, ""));
  if (!nineaOk) constats.push(constat("CONTRIBUABLE_NINEA", "ELEVEE", "Art. 447 I-5", [], { nombre: 1, absent: !contribuable.ninea }));
  verifie("CONTRIBUABLE_NINEA", !nineaOk);
  if (!contribuable.adresse) constats.push(constat("CONTRIBUABLE_ADRESSE", "MOYENNE", "Art. 447 I-5", [], { nombre: 1 }));
  verifie("CONTRIBUABLE_ADRESSE", !contribuable.adresse);
  if (!profil.existe) constats.push(constat("PROFIL_FISCAL_ABSENT", "MOYENNE", "", [], { nombre: 1 }));
  verifie("PROFIL_FISCAL_ABSENT", !profil.existe);

  // ---- Factures de vente ------------------------------------------------------------------------------
  const ventes = (
    await db.query(
      `SELECT f.id, f.numero, f.date_facture, f.statut, f.taux_tva_pourcentage AS taux, f.total_ht, f.montant_tva, f.total_ttc, f.tva_code_operation AS code,
              c.id AS client_id, c.nom AS client_nom, c.ninea AS client_ninea, c.adresse AS client_adresse, c.exonere_tva, c.motif_exoneration_tva AS motif,
              (SELECT e.statut FROM ecriture_comptable e WHERE e.tenant_id = f.tenant_id AND e.origine = 'FACTURE_VENTE' AND e.origine_id = f.id AND e.origine_role = 'FACTURE' LIMIT 1) AS ecriture_statut
       FROM facture_vente f JOIN client_commercial c ON c.id = f.client_commercial_id
       WHERE f.tenant_id = $1 AND f.statut <> 'ANNULEE' AND EXTRACT(YEAR FROM f.date_facture) = $2
       ORDER BY f.date_facture, f.numero`,
      [tenantId, annee]
    )
  ).rows.map((x) => ({
    ...x,
    taux: num(x.taux),
    total_ht: num(x.total_ht),
    montant_tva: num(x.montant_tva),
    total_ttc: num(x.total_ttc),
    date: dateIso(x.date_facture),
    code_effectif: x.code || (num(x.taux) > 0 ? "TAXABLE" : "EXONERE"),
  }));
  const lienFacture = (x) => ({ numero: x.numero, date: x.date, tiers: x.client_nom, montant: arrondi(x.total_ttc) });

  if (ventes.length > 0) {
    const horsTaxe = (x) => x.code_effectif !== "TAXABLE" || x.exonere_tva || x.taux === 0;
    const exoneresSansNinea = ventes.filter((x) => horsTaxe(x) && !x.client_ninea);
    if (exoneresSansNinea.length) constats.push(constat("VENTE_EXONEREE_SANS_NINEA", "ELEVEE", "Art. 447 I-5", exemples(exoneresSansNinea, lienFacture), { nombre: exoneresSansNinea.length, montant: arrondi(exoneresSansNinea.reduce((s, x) => s + x.total_ht, 0)) }));
    verifie("VENTE_EXONEREE_SANS_NINEA", exoneresSansNinea.length);

    const sansReference = ventes.filter((x) => horsTaxe(x) && !x.motif);
    if (sansReference.length) constats.push(constat("VENTE_EXONEREE_SANS_REFERENCE", "ELEVEE", "Art. 447 I-5", exemples(sansReference, lienFacture), { nombre: sansReference.length }));
    verifie("VENTE_EXONEREE_SANS_REFERENCE", sansReference.length);

    const sansNinea = ventes.filter((x) => !horsTaxe(x) && !x.client_ninea);
    if (sansNinea.length) {
      const clients = new Set(sansNinea.map((x) => x.client_id));
      constats.push(constat("VENTE_CLIENT_SANS_NINEA", "MOYENNE", "Art. 447 I-6", exemples(sansNinea, lienFacture), { nombre: sansNinea.length, clients: clients.size }));
    }
    verifie("VENTE_CLIENT_SANS_NINEA", sansNinea.length);

    const incoherentes = ventes.filter((x) => {
      const ecartTaux = x.taux > 0 && Math.abs((x.total_ht * x.taux) / 100 - x.montant_tva) > 2;
      const tvaSansTaux = x.taux === 0 && x.montant_tva > 0;
      const somme = Math.abs(x.total_ht + x.montant_tva - x.total_ttc) > 2;
      return ecartTaux || tvaSansTaux || somme;
    });
    if (incoherentes.length) constats.push(constat("VENTE_MONTANTS_INCOHERENTS", "ELEVEE", "Art. 447 I-5", exemples(incoherentes, lienFacture), { nombre: incoherentes.length }));
    verifie("VENTE_MONTANTS_INCOHERENTS", incoherentes.length);

    const tvaSurExoneree = ventes.filter((x) => x.code_effectif !== "TAXABLE" && x.montant_tva > 0);
    if (tvaSurExoneree.length) constats.push(constat("VENTE_TVA_SUR_OPERATION_EXONEREE", "ELEVEE", "Art. 673", exemples(tvaSurExoneree, lienFacture), { nombre: tvaSurExoneree.length, montant: arrondi(tvaSurExoneree.reduce((s, x) => s + x.montant_tva, 0)) }));
    verifie("VENTE_TVA_SUR_OPERATION_EXONEREE", tvaSurExoneree.length);

    const trous = trousNumerotation(ventes.map((x) => x.numero));
    if (trous.length) constats.push(constat("VENTE_NUMEROTATION", "MOYENNE", "Art. 447 I-5", trous.slice(0, MAX_EXEMPLES).map((n) => ({ numero: n })), { nombre: trous.length }));
    verifie("VENTE_NUMEROTATION", trous.length);

    const futures = ventes.filter((x) => x.date > aujourdhui);
    if (futures.length) constats.push(constat("VENTE_DATE_FUTURE", "MOYENNE", "Art. 447 I-3", exemples(futures, lienFacture), { nombre: futures.length }));
    verifie("VENTE_DATE_FUTURE", futures.length);

    if (comptaActive) {
      const nonValidees = ventes.filter((x) => x.ecriture_statut !== "VALIDEE");
      if (nonValidees.length) constats.push(constat("VENTE_NON_VALIDEE_COMPTA", "MOYENNE", "", exemples(nonValidees, lienFacture), { nombre: nonValidees.length, montant: arrondi(nonValidees.reduce((s, x) => s + x.montant_tva, 0)) }));
      verifie("VENTE_NON_VALIDEE_COMPTA", nonValidees.length);
    }
  }

  // ---- Factures d'achat -----------------------------------------------------------------------------------
  const achats = (
    await db.query(
      `SELECT ff.id, ff.numero, ff.reference_fournisseur, ff.date_facture, ff.montant_ht, ff.montant_tva, ff.montant_ttc, ff.tva_deductible,
              t.nom AS fournisseur_nom, fo.ninea AS fournisseur_ninea, fo.regime_fiscal AS regime, fo.assujetti_tva
       FROM facture_fournisseur ff JOIN tiers_comptable t ON t.id = ff.tiers_id LEFT JOIN fournisseur fo ON fo.id = t.fournisseur_id
       WHERE ff.tenant_id = $1 AND ff.statut = 'ENREGISTREE' AND EXTRACT(YEAR FROM ff.date_facture) = $2 ORDER BY ff.date_facture`,
      [tenantId, annee]
    )
  ).rows.map((x) => ({ ...x, tva: num(x.montant_tva), ttc: num(x.montant_ttc), date: dateIso(x.date_facture) }));
  const lienAchat = (x) => ({ numero: x.numero, date: x.date, tiers: x.fournisseur_nom, montant: arrondi(x.ttc) });
  if (achats.length > 0) {
    const deduits = achats.filter((x) => x.tva > 0 && x.tva_deductible);
    const sansNinea = deduits.filter((x) => !x.fournisseur_ninea);
    if (sansNinea.length) constats.push(constat("ACHAT_TVA_SANS_NINEA", "MOYENNE", "Art. 447 I-6", exemples(sansNinea, lienAchat), { nombre: sansNinea.length, montant: arrondi(sansNinea.reduce((s, x) => s + x.tva, 0)) }));
    verifie("ACHAT_TVA_SANS_NINEA", sansNinea.length);
    const nonAssujettis = deduits.filter((x) => x.regime === "CGU" || x.assujetti_tva === false);
    if (nonAssujettis.length) constats.push(constat("ACHAT_TVA_FOURNISSEUR_NON_ASSUJETTI", "ELEVEE", "Art. 447 I-7", exemples(nonAssujettis, lienAchat), { nombre: nonAssujettis.length, montant: arrondi(nonAssujettis.reduce((s, x) => s + x.tva, 0)) }));
    verifie("ACHAT_TVA_FOURNISSEUR_NON_ASSUJETTI", nonAssujettis.length);
    const sansRef = deduits.filter((x) => !String(x.reference_fournisseur || "").trim());
    if (sansRef.length) constats.push(constat("ACHAT_SANS_REFERENCE", "MOYENNE", "Art. 447 I-2", exemples(sansRef, lienAchat), { nombre: sansRef.length }));
    verifie("ACHAT_SANS_REFERENCE", sansRef.length);
  }

  // ---- TVA : credit recurrent, controles sur grand livre importe ---------------------------------------------------
  const decl = (await db.query(`SELECT mois, statut, credit_a_reporter, solde_a_payer FROM fiscalite_declaration_tva WHERE tenant_id = $1 AND annee = $2 ORDER BY mois`, [tenantId, annee])).rows;
  let serie = 0;
  let maxSerie = 0;
  for (let m = 1; m <= 12; m++) {
    const d = decl.find((x) => x.mois === m);
    if (d && num(d.credit_a_reporter) > 0) {
      serie += 1;
      maxSerie = Math.max(maxSerie, serie);
    } else serie = 0;
  }
  if (maxSerie >= 3) constats.push(constat("TVA_CREDIT_RECURRENT", "MOYENNE", "", decl.filter((x) => num(x.credit_a_reporter) > 0).map((x) => ({ mois: x.mois, montant: arrondi(x.credit_a_reporter) })).slice(0, 12), { nombre: maxSerie }));
  verifie("TVA_CREDIT_RECURRENT", maxSerie >= 3);

  const cptTva = await comptesSvc.getComptes(tenantId);
  const jeuGl = (await db.query(`SELECT id FROM fiscalite_import_jeu WHERE tenant_id = $1 AND nature = 'GRAND_LIVRE' AND actif AND annee = $2 LIMIT 1`, [tenantId, annee])).rows[0];
  if (jeuGl && ventes.length === 0) {
    const mensuel = (
      await db.query(
        `SELECT EXTRACT(MONTH FROM date_ecriture)::int AS m,
                COALESCE(SUM(CASE WHEN compte ~ $4 THEN credit - debit ELSE 0 END), 0) AS collectee,
                COALESCE(SUM(CASE WHEN compte ~ $5 THEN debit - credit ELSE 0 END), 0) AS recuperable,
                COALESCE(SUM(CASE WHEN compte ~ $6 THEN credit - debit ELSE 0 END), 0) AS ventes
         FROM fiscalite_import_ligne WHERE jeu_id = $1 AND date_ecriture BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1`,
        [jeuGl.id, `${annee}-01-01`, `${annee}-12-31`, comptesSvc.regex(cptTva.TVA_COLLECTEE), comptesSvc.regex(cptTva.TVA_RECUPERABLE), comptesSvc.regex(cptTva.TVA_VENTES)]
      )
    ).rows.map((x) => ({ m: x.m, collectee: arrondi(x.collectee), recuperable: arrondi(x.recuperable), ventes: arrondi(x.ventes) }));
    const faibles = mensuel.filter((x) => x.ventes > 1000000 && x.collectee < 0.6 * (profil.taux_tva_normal / 100) * x.ventes);
    if (faibles.length) constats.push(constat("GL_TVA_COLLECTEE_FAIBLE", "MOYENNE", "", faibles.map((x) => ({ mois: x.m, montant: x.collectee, ventes: x.ventes })), { nombre: faibles.length }));
    verifie("GL_TVA_COLLECTEE_FAIBLE", faibles.length);
    let s = 0;
    let ms = 0;
    for (let m = 1; m <= 12; m++) {
      const x = mensuel.find((y) => y.m === m);
      if (x && x.recuperable > x.collectee) {
        s += 1;
        ms = Math.max(ms, s);
      } else s = 0;
    }
    if (ms >= 3) constats.push(constat("GL_CREDIT_RECURRENT", "MOYENNE", "", [], { nombre: ms }));
    verifie("GL_CREDIT_RECURRENT", ms >= 3);
  }

  // ---- Retenues a la source (lot 4) ----------------------------------------------------------------------------------------
  const ret = await db.query(
    `SELECT statut, type, date_operation, beneficiaire_nom, beneficiaire_ninea, beneficiaire_piece, beneficiaire_statut, montant_brut
     FROM fiscalite_retenue WHERE tenant_id = $1 AND date_operation BETWEEN $2 AND $3 ORDER BY date_operation`,
    [tenantId, `${annee}-01-01`, `${annee}-12-31`]
  );
  const enAttente = ret.rows.filter((x) => x.statut === "PROPOSEE");
  const ligneRet = (x) => ({ tiers: x.beneficiaire_nom, date: dateIso(x.date_operation), montant: num(x.montant_brut) });
  if (enAttente.length) constats.push(constat("RETENUES_PROPOSITIONS_EN_ATTENTE", "MOYENNE", "Art. 200 à 202", exemples(enAttente, ligneRet), { nombre: enAttente.length, montant: arrondi(enAttente.reduce((t, x) => t + num(x.montant_brut), 0)) }));
  verifie("RETENUES_PROPOSITIONS_EN_ATTENTE", enAttente.length);
  const sansIdentite = ret.rows.filter((x) => x.statut === "CONFIRMEE" && (x.type === "PRESTATION_PP" || x.type === "LOYER") && !["PP_REEL", "SOCIETE_IS"].includes(x.beneficiaire_statut) && !x.beneficiaire_ninea && !x.beneficiaire_piece);
  if (sansIdentite.length) constats.push(constat("RETENUES_IDENTITE_ABSENTE", "MOYENNE", "Art. 200-8", exemples(sansIdentite, ligneRet), { nombre: sansIdentite.length, montant: arrondi(sansIdentite.reduce((t, x) => t + num(x.montant_brut), 0)) }));
  verifie("RETENUES_IDENTITE_ABSENTE", sansIdentite.length);

  // ---- Echeances en retard et penalites estimees -----------------------------------------------------------------------
  const synthese = await calendrier.synthese(tenantId, annee);
  const retards = synthese.en_retard;
  const totalPenalites = retards.reduce((s, x) => s + (x.penalites_estimees ? x.penalites_estimees.total : 0), 0);
  if (retards.length) {
    constats.push(
      constat("ECHEANCES_EN_RETARD", "ELEVEE", "Art. 665, 667, 671", retards.map((x) => ({ cle: x.cle, type: x.type, periode: x.periode, date_limite: x.date_limite, montant: x.montant, penalites: x.penalites_estimees ? x.penalites_estimees.total : 0 })), {
        nombre: retards.length,
        montant: arrondi(totalPenalites),
      })
    );
  }
  verifie("ECHEANCES_EN_RETARD", retards.length);

  // ---- Preparation a la facturation electronique ---------------------------------------------------------------------------------
  const prete = (x) => !!x.client_ninea && !!x.client_adresse && !!x.numero && x.date <= aujourdhui && Math.abs(x.total_ht + x.montant_tva - x.total_ttc) <= 2 && (x.taux === 0 || x.montant_tva > 0 || x.code_effectif !== "TAXABLE");
  const efacture = {
    base_legale: "Art. 447 II",
    modalites: "ARRETE_A_VERIFIER",
    total: ventes.length,
    pretes: ventes.filter(prete).length,
    pourcentage: ventes.length ? Math.round((ventes.filter(prete).length / ventes.length) * 100) : null,
    manques: {
      client_ninea: ventes.filter((x) => !x.client_ninea).length,
      client_adresse: ventes.filter((x) => !x.client_adresse).length,
      montants: ventes.filter((x) => Math.abs(x.total_ht + x.montant_tva - x.total_ttc) > 2).length,
    },
    ninea_emetteur: nineaOk,
    adresse_emetteur: !!contribuable.adresse,
  };

  const ordre = { ELEVEE: 0, MOYENNE: 1, INFO: 2 };
  constats.sort((a, b) => ordre[a.gravite] - ordre[b.gravite]);
  return {
    annee,
    genere_le: new Date().toISOString(),
    donnees: { ventes: ventes.length, achats: achats.length, grand_livre: !!jeuGl, compta_active: comptaActive },
    resume: {
      elevee: constats.filter((x) => x.gravite === "ELEVEE").length,
      moyenne: constats.filter((x) => x.gravite === "MOYENNE").length,
      info: constats.filter((x) => x.gravite === "INFO").length,
      controles: controles.length,
      controles_ok: controles.filter((x) => x.ok).length,
    },
    constats,
    controles,
    facturation_electronique: efacture,
    penalites_en_cours: { nombre: retards.length, total: arrondi(totalPenalites) },
  };
}

module.exports = { analyser, trousNumerotation };
