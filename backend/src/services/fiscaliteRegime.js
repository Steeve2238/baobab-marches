/**
 * Module Fiscalite - identite fiscale (NINEA + COFI) et detection du regime d'imposition.
 *
 * Deux detections complementaires, qui ne se melangent jamais :
 *
 *  1. A PARTIR DU COFI (tiers et entreprise elle-meme) : le COFI suit le NINEA (ex. "0001462 2G3") ; son
 *     premier caractere donne le regime (0 reel non assujetti TVA, 1 CGU, 2 reel assujetti TVA), le deuxieme le
 *     centre fiscal, le troisieme la forme juridique. Les tables de lecture sont dans data/cofiTables.js et le
 *     decodeur n'invente rien : un code absent des tables est signale "non reconnu". Le COFI ne distingue PAS le
 *     reel simplifie du reel normal.
 *
 *  2. A PARTIR DU CHIFFRE D'AFFAIRES (entreprise elle-meme seulement - on ne connait pas le CA des tiers) : regime
 *     auquel l'entreprise est tenue d'apres le CGI - personnes morales : reel normal au-dela de 100 M TTC, sinon reel
 *     simplifie (art. 26 a 28) ; personnes physiques : CGU jusqu'a 50 M TTC (art. 135), reel simplifie de 50 a
 *     100 M (art. 130), reel normal au-dela (art. 126) ; maintien du regime superieur tant que le CA n'est pas
 *     reste sous le seuil pendant 3 exercices consecutifs (art. 26 c, 126 c, 130 2).
 *     Ce resultat est compare au regime declare dans le profil fiscal et au regime lu dans le COFI.
 */
const db = require("../db");
const { REGIMES, CENTRES, FORMES_JURIDIQUES } = require("../data/cofiTables");
const { FiscaliteError } = require("./fiscaliteTva");

const SEUIL_CGU = 50000000;
const SEUIL_REEL_NORMAL = 100000000;

const LIBELLE_REGIME = {
  NON_RENSEIGNE: "Non renseigné",
  CGU: "CGU (contribution globale unique)",
  REEL: "Réel (simplifié ou normal)",
  REEL_SIMPLIFIE: "Réel simplifié",
  REEL_NORMAL: "Réel normal",
  AUTRE: "Autre (exonéré, association...)",
};

const num = (v) => Number(v || 0);
const nettoyer = (v) => String(v || "").replace(/[\s.-]/g, "").toUpperCase();

// ----------------------------------------------------------------------------
// NINEA / COFI : analyse et decodage
// ----------------------------------------------------------------------------

const RE_NINEA = /^[0-9]{7,9}$/;
const RE_COFI = /^[0-9][A-Z][0-9]$/;

/**
 * Accepte "0001462 2G3" saisi d'un seul bloc dans le champ NINEA : separe alors NINEA (7 a 9 chiffres) et COFI.
 * Retourne { ninea, cofi } normalises (ou null), sans rien valider d'autre.
 */
function separerIdentifiant(ninea, cofi) {
  let n = nettoyer(ninea);
  let c = nettoyer(cofi);
  const colle = n.match(/^([0-9]{7,9})([0-9][A-Z][0-9])$/);
  if (colle) {
    n = colle[1];
    if (!c) c = colle[2];
  }
  return { ninea: n || null, cofi: c || null };
}

function neaValide(n) {
  return !!n && RE_NINEA.test(n);
}

function cofiValide(c) {
  return !!c && RE_COFI.test(c);
}

/** Decode un COFI. Ne retient que ce que les tables connaissent. */
function decoderCofi(cofi) {
  const c = nettoyer(cofi);
  if (!c) return { present: false };
  if (!RE_COFI.test(c)) return { present: true, cofi: c, format_valide: false };
  const r = REGIMES[c[0]] || null;
  const centre = CENTRES[c[1]] || null;
  const forme = FORMES_JURIDIQUES[c[2]] || null;
  return {
    present: true,
    cofi: c,
    format_valide: true,
    regime: r ? { code: r.regime, assujetti_tva: r.assujetti_tva, libelle: r.libelle, confirme: r.confirme } : null,
    centre: { code: c[1], libelle: centre ? centre.libelle : null, confirme: centre ? centre.confirme : false },
    forme_juridique: { code: c[2], libelle: forme ? forme.libelle : null, confirme: forme ? forme.confirme : false },
  };
}

// ----------------------------------------------------------------------------
// Tiers (clients / fournisseurs)
// ----------------------------------------------------------------------------

function ligneTiers(x, type) {
  const d = decoderCofi(x.cofi);
  return {
    type,
    id: x.id,
    nom: x.nom,
    pays: x.pays || null,
    ninea: x.ninea || "",
    ninea_valide: x.ninea ? neaValide(nettoyer(x.ninea)) : null,
    cofi: x.cofi || "",
    cofi_decode: d,
    regime_fiscal: x.regime_fiscal || "NON_RENSEIGNE",
    regime_libelle: LIBELLE_REGIME[x.regime_fiscal || "NON_RENSEIGNE"],
    regime_source: x.regime_source || null,
    assujetti_tva: x.assujetti_tva === null || x.assujetti_tva === undefined ? null : x.assujetti_tva,
    exonere_tva: x.exonere_tva || false,
  };
}

async function listerTiers(tenantId) {
  const clients = await db.query(
    `SELECT id, nom, ninea, cofi, regime_fiscal, regime_source, assujetti_tva, exonere_tva
     FROM client_commercial WHERE tenant_id = $1 AND actif ORDER BY nom`,
    [tenantId]
  );
  const fournisseurs = await db.query(
    `SELECT id, nom, pays, ninea, cofi, regime_fiscal, regime_source, assujetti_tva FROM fournisseur WHERE tenant_id = $1 ORDER BY nom`,
    [tenantId]
  );
  return [...clients.rows.map((x) => ligneTiers(x, "CLIENT")), ...fournisseurs.rows.map((x) => ligneTiers(x, "FOURNISSEUR"))];
}

/**
 * Met a jour NINEA / COFI / regime d'un tiers. Si un COFI reconnu est fourni et qu'aucun regime n'est impose
 * explicitement (`regime_fiscal` absent), le regime et l'assujettissement a la TVA sont deduits du COFI.
 */
async function majIdentiteTiers(tenantId, type, id, corps) {
  const table = type === "CLIENT" ? "client_commercial" : type === "FOURNISSEUR" ? "fournisseur" : null;
  if (!table) throw new FiscaliteError("FISCALITE_CODE_INVALIDE");
  const c = corps || {};
  const { ninea, cofi } = separerIdentifiant(c.ninea, c.cofi);
  if (ninea && !neaValide(ninea)) throw new FiscaliteError("FISCALITE_NINEA_INVALIDE");
  if (cofi && !cofiValide(cofi)) throw new FiscaliteError("FISCALITE_COFI_INVALIDE");

  const actuel = await db.query(`SELECT regime_fiscal, regime_source, assujetti_tva FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (actuel.rows.length === 0) throw new FiscaliteError("FISCALITE_TIERS_INTROUVABLE", 404);
  let { regime_fiscal: regime, regime_source: source, assujetti_tva: assujetti } = actuel.rows[0];

  const regimesValides = ["NON_RENSEIGNE", "CGU", "REEL", "REEL_SIMPLIFIE", "REEL_NORMAL", "AUTRE"];
  if (c.regime_fiscal !== undefined && c.regime_fiscal !== null && c.regime_fiscal !== "") {
    if (!regimesValides.includes(c.regime_fiscal)) throw new FiscaliteError("FISCALITE_CODE_INVALIDE");
    regime = c.regime_fiscal;
    source = c.regime_fiscal === "NON_RENSEIGNE" ? null : c.regime_source === "ATTESTATION" ? "ATTESTATION" : "SAISIE";
    if (c.assujetti_tva === true || c.assujetti_tva === false) assujetti = c.assujetti_tva;
  } else if (cofi) {
    const d = decoderCofi(cofi);
    if (d.regime) {
      regime = d.regime.code;
      assujetti = d.regime.assujetti_tva;
      source = "COFI";
    }
  } else if (c.cofi === "" || c.cofi === null) {
    // COFI efface : un regime qui venait du COFI n'a plus de source
    if (source === "COFI") {
      regime = "NON_RENSEIGNE";
      assujetti = null;
      source = null;
    }
  }
  await db.query(
    `UPDATE ${table} SET ninea = $3, cofi = $4, regime_fiscal = $5, regime_source = $6, assujetti_tva = $7 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, ninea, cofi, regime, source, assujetti]
  );
  return { id, type, ninea, cofi, regime_fiscal: regime, regime_source: source, assujetti_tva: assujetti };
}

/** Applique le COFI deja saisi a tous les tiers dont le regime est encore vide ou deduit du COFI. */
async function deduireRegimesDepuisCofi(tenantId) {
  let nombre = 0;
  for (const [table, type] of [["client_commercial", "CLIENT"], ["fournisseur", "FOURNISSEUR"]]) {
    const r = await db.query(
      `SELECT id, cofi FROM ${table} WHERE tenant_id = $1 AND cofi IS NOT NULL AND (regime_fiscal = 'NON_RENSEIGNE' OR regime_source = 'COFI')`,
      [tenantId]
    );
    for (const x of r.rows) {
      const d = decoderCofi(x.cofi);
      if (!d.regime) continue;
      await db.query(`UPDATE ${table} SET regime_fiscal = $3, assujetti_tva = $4, regime_source = 'COFI' WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        x.id,
        d.regime.code,
        d.regime.assujetti_tva,
      ]);
      nombre += 1;
    }
  }
  return nombre;
}

// ----------------------------------------------------------------------------
// Entreprise elle-meme : regime attendu d'apres le chiffre d'affaires
// ----------------------------------------------------------------------------

/** CA TTC annuel (annees civiles) = somme des montants reellement factures, factures annulees exclues. */
async function caParAnnee(tenantId, profilHistorique = {}) {
  const r = await db.query(
    `SELECT EXTRACT(YEAR FROM date_facture)::int AS annee, COALESCE(SUM(CASE WHEN montant_net_a_payer > 0 THEN montant_net_a_payer ELSE total_ttc END), 0) AS ca
     FROM facture_vente WHERE tenant_id = $1 AND statut <> 'ANNULEE' GROUP BY 1 ORDER BY 1`,
    [tenantId]
  );
  const parAnnee = new Map(r.rows.map((x) => [x.annee, { annee: x.annee, ca_ttc: Math.round(num(x.ca)), source: "PLATEFORME" }]));
  for (const [a, v] of Object.entries(profilHistorique || {})) {
    const annee = Number(a);
    const valeur = Number(v);
    if (Number.isInteger(annee) && Number.isFinite(valeur) && valeur >= 0) {
      // Le CA saisi a la main prime : il couvre l'activite d'avant la plateforme (ou hors plateforme).
      parAnnee.set(annee, { annee, ca_ttc: Math.round(valeur), source: "SAISIE" });
    }
  }
  return Array.from(parAnnee.values()).sort((a, b) => a.annee - b.annee);
}

/**
 * Regime attendu pour `anneeRef` d'apres les CA des 3 exercices precedents.
 * @param forme PERSONNE_MORALE | PERSONNE_PHYSIQUE
 * @param ca    [{annee, ca_ttc}]
 */
function regimeAttendu(forme, ca, anneeRef) {
  const precedents = [anneeRef - 1, anneeRef - 2, anneeRef - 3].map((a) => ca.find((x) => x.annee === a) || null);
  const connus = precedents.filter(Boolean);
  const dernier = precedents[0];
  const max3 = connus.length ? Math.max(...connus.map((x) => x.ca_ttc)) : 0;
  const messages = [];
  if (!dernier) messages.push("CA_PRECEDENT_INCONNU");
  if (connus.length < 3) messages.push("HISTORIQUE_INCOMPLET");
  const base = dernier ? dernier.ca_ttc : 0;

  let regime;
  let article;
  if (forme === "PERSONNE_MORALE") {
    // Art. 26 a 28 : reel normal au-dela de 100 M TTC ; maintenu tant que le CA n'est pas reste sous 100 M pendant 3 exercices.
    if (base > SEUIL_REEL_NORMAL) {
      regime = "REEL_NORMAL";
      article = "art. 26-1 a";
    } else if (max3 > SEUIL_REEL_NORMAL) {
      regime = "REEL_NORMAL";
      article = "art. 26-1 c (maintien 3 exercices)";
      messages.push("MAINTIEN_TROIS_EXERCICES");
    } else {
      regime = "REEL_SIMPLIFIE";
      article = "art. 28";
    }
  } else {
    if (base > SEUIL_REEL_NORMAL) {
      regime = "REEL_NORMAL";
      article = "art. 126";
    } else if (max3 > SEUIL_REEL_NORMAL) {
      regime = "REEL_NORMAL";
      article = "art. 126 c (maintien 3 exercices)";
      messages.push("MAINTIEN_TROIS_EXERCICES");
    } else if (base > SEUIL_CGU || max3 > SEUIL_CGU) {
      regime = "REEL_SIMPLIFIE";
      article = max3 > SEUIL_CGU && base <= SEUIL_CGU ? "art. 130-2 (maintien 3 exercices)" : "art. 130";
    } else {
      regime = "CGU";
      article = "art. 135";
    }
  }
  return { regime, article, ca_reference: dernier ? dernier.ca_ttc : null, annee_reference: anneeRef - 1, messages };
}

async function getProfilBrut(tenantId) {
  const r = await db.query(`SELECT * FROM fiscalite_profil WHERE tenant_id = $1`, [tenantId]);
  return r.rows[0] || null;
}

/** Detection complete pour l'entreprise : regime declare, regime lu dans le COFI, regime attendu d'apres le CA. */
async function detecterEntreprise(tenantId, anneeRef) {
  const annee = anneeRef || new Date().getFullYear();
  const profil = await getProfilBrut(tenantId);
  const forme = profil ? profil.forme_juridique : "PERSONNE_MORALE";
  const declare = profil ? profil.regime_is : null;
  const t = await db.query(`SELECT ninea FROM tenant WHERE id = $1`, [tenantId]);
  const nineaEntreprise = t.rows[0]?.ninea || null;
  const brut = separerIdentifiant(nineaEntreprise, profil ? profil.cofi : null);
  const cofiEntreprise = brut.cofi;
  const cofi = decoderCofi(cofiEntreprise);

  const ca = await caParAnnee(tenantId, profil ? profil.ca_historique_json : {});
  const attendu = regimeAttendu(forme, ca, annee);
  const caCourant = ca.find((x) => x.annee === annee) || { annee, ca_ttc: 0, source: "PLATEFORME" };

  const alertes = [];
  const al = (code, details = {}) => alertes.push({ code, ...details });

  if (!brut.ninea || !neaValide(brut.ninea)) al("NINEA_ENTREPRISE_ABSENT_OU_INVALIDE");
  if (!cofiEntreprise) al("COFI_ENTREPRISE_ABSENT");
  else if (!cofi.format_valide) al("COFI_FORMAT_INVALIDE", { cofi: cofiEntreprise });
  else if (!cofi.regime) al("COFI_REGIME_NON_RECONNU", { cofi: cofiEntreprise });

  // 1. regime declare vs regime attendu d'apres le CA
  if (declare && declare !== attendu.regime) {
    if (declare === "CGU" && attendu.regime !== "CGU") al("CGU_PLUS_APPLICABLE", { attendu: attendu.regime, article: attendu.article });
    else if (declare === "REEL_SIMPLIFIE" && attendu.regime === "REEL_NORMAL") al("REEL_NORMAL_OBLIGATOIRE", { article: attendu.article });
    else if (declare === "REEL_NORMAL" && attendu.regime === "REEL_SIMPLIFIE") al("REEL_NORMAL_PAR_OPTION_POSSIBLE", { article: attendu.article });
    else al("REGIME_DECLARE_DIFFERENT", { declare, attendu: attendu.regime });
  }
  if (forme === "PERSONNE_MORALE" && declare === "CGU") al("CGU_PERSONNE_MORALE_IMPOSSIBLE");

  // 2. regime lu dans le COFI vs regime declare
  if (cofi.regime) {
    const coherent =
      (cofi.regime.code === "CGU" && declare === "CGU") ||
      (cofi.regime.code === "REEL" && (declare === "REEL_NORMAL" || declare === "REEL_SIMPLIFIE"));
    if (declare && !coherent) al("COFI_DIFFERENT_DU_REGIME_DECLARE", { cofi_regime: cofi.regime.code, declare });
    if (profil && cofi.regime.assujetti_tva !== profil.assujetti_tva) {
      al("COFI_TVA_DIFFERENT_PROFIL", { cofi_assujetti: cofi.regime.assujetti_tva, profil_assujetti: profil.assujetti_tva });
    }
  }

  // 3. CA en cours : proximite des seuils
  const seuilProche = forme === "PERSONNE_MORALE" ? [SEUIL_REEL_NORMAL] : [SEUIL_CGU, SEUIL_REEL_NORMAL];
  for (const s of seuilProche) {
    if (caCourant.ca_ttc > s) al("SEUIL_DEPASSE_EN_COURS", { seuil: s, ca: caCourant.ca_ttc, annee });
    else if (caCourant.ca_ttc > s * 0.8) al("SEUIL_PROCHE", { seuil: s, ca: caCourant.ca_ttc, annee, reste: s - caCourant.ca_ttc });
  }
  if (attendu.messages.includes("HISTORIQUE_INCOMPLET")) al("HISTORIQUE_INCOMPLET");

  return {
    annee,
    forme_juridique: forme,
    ninea: brut.ninea,
    cofi: cofiEntreprise,
    cofi_decode: cofi,
    regime_declare: declare,
    regime_declare_libelle: declare ? LIBELLE_REGIME[declare] : null,
    regime_attendu: attendu,
    regime_attendu_libelle: LIBELLE_REGIME[attendu.regime],
    ca_par_annee: ca,
    ca_en_cours: caCourant,
    seuils: { cgu: SEUIL_CGU, reel_normal: SEUIL_REEL_NORMAL },
    alertes,
  };
}

module.exports = {
  LIBELLE_REGIME,
  nettoyer,
  separerIdentifiant,
  neaValide,
  cofiValide,
  decoderCofi,
  listerTiers,
  majIdentiteTiers,
  deduireRegimesDepuisCofi,
  caParAnnee,
  regimeAttendu,
  detecterEntreprise,
};
