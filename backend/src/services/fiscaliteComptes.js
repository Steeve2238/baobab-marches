/**
 * Comptes comptables lus par le module Fiscalite, parametrables par entreprise selon le plan comptable adopte.
 * Chaque entree du catalogue est une liste de prefixes de comptes ; la valeur par defaut s'applique tant que l'entreprise
 * n'a rien enregistre (table fiscalite_compte_param).
 */
const db = require("../db");

const CATALOGUE = [
  { cle: "RET_PRESTATIONS", groupe: "RETENUES", defaut: ["6057", "63"] },
  { cle: "RET_LOYERS", groupe: "RETENUES", defaut: ["622"] },
  { cle: "RET_A_PAYER", groupe: "RETENUES", defaut: ["4478"] },
  { cle: "TVA_COLLECTEE", groupe: "TVA", defaut: ["443"] },
  { cle: "TVA_RECUPERABLE", groupe: "TVA", defaut: ["4451", "4452", "4453", "4454"] },
  { cle: "TVA_VENTES", groupe: "TVA", defaut: ["70"] },
  { cle: "IS_IMPOT", groupe: "IS", defaut: ["89"] },
  { cle: "IS_AMENDES", groupe: "IS", defaut: ["647"] },
  { cle: "IS_DONS", groupe: "IS", defaut: ["6582", "6583"] },
  { cle: "IS_PROVISIONS", groupe: "IS", defaut: ["691", "697"] },
  { cle: "IS_REPRISES", groupe: "IS", defaut: ["791", "797"] },
  { cle: "CEL_IMMEUBLES", groupe: "CEL", defaut: ["22", "23"] },
  { cle: "CEL_LOYERS", groupe: "CEL", defaut: ["622"] },
];
const PAR_CLE = Object.fromEntries(CATALOGUE.map((c) => [c.cle, c]));

/** Nettoie une saisie : chiffres seulement, 1 a 10 caracteres, sans doublon, 20 prefixes au plus. */
function listePrefixes(v, defaut) {
  const brut = Array.isArray(v) ? v : String(v === undefined || v === null ? "" : v).split(/[\s,;]+/);
  const liste = [...new Set(brut.map((x) => String(x).replace(/[^0-9]/g, "")).filter((x) => x.length >= 1 && x.length <= 10))].slice(0, 20);
  return liste.length ? liste : defaut;
}

/** { CLE: [prefixes] } pour l'entreprise (valeur enregistree, sinon valeur par defaut). */
async function getComptes(tenantId, client = db) {
  const r = await client.query(`SELECT cle, prefixes FROM fiscalite_compte_param WHERE tenant_id = $1`, [tenantId]);
  const enregistres = Object.fromEntries(r.rows.map((x) => [x.cle, x.prefixes]));
  const out = {};
  for (const c of CATALOGUE) out[c.cle] = enregistres[c.cle] && enregistres[c.cle].length ? enregistres[c.cle] : c.defaut;
  return out;
}

/** Idem avec l'indication « personnalise » pour l'ecran de parametrage. */
async function getDetail(tenantId) {
  const r = await db.query(`SELECT cle, prefixes FROM fiscalite_compte_param WHERE tenant_id = $1`, [tenantId]);
  const enregistres = Object.fromEntries(r.rows.map((x) => [x.cle, x.prefixes]));
  return CATALOGUE.map((c) => {
    const perso = !!(enregistres[c.cle] && enregistres[c.cle].length);
    return { cle: c.cle, groupe: c.groupe, defaut: c.defaut, prefixes: perso ? enregistres[c.cle] : c.defaut, personnalise: perso && enregistres[c.cle].join(",") !== c.defaut.join(",") };
  });
}

/** Enregistre les cles fournies ({ CLE: "4478, 4471" } ou tableau). Une valeur vide revient au defaut. */
async function enregistrer(tenantId, corps) {
  const { FiscaliteError } = require("./fiscaliteTva"); // chargement tardif : fiscaliteTva lit lui-meme ces comptes
  const c = corps || {};
  for (const cle of Object.keys(c)) {
    if (!PAR_CLE[cle]) throw new FiscaliteError("FISCALITE_COMPTE_INCONNU", 400, { cle });
  }
  for (const cle of Object.keys(c)) {
    const liste = listePrefixes(c[cle], null);
    if (!liste || liste.join(",") === PAR_CLE[cle].defaut.join(",")) {
      await db.query(`DELETE FROM fiscalite_compte_param WHERE tenant_id = $1 AND cle = $2`, [tenantId, cle]);
    } else {
      await db.query(
        `INSERT INTO fiscalite_compte_param (tenant_id, cle, prefixes) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, cle) DO UPDATE SET prefixes = EXCLUDED.prefixes, date_modification = now()`,
        [tenantId, cle, liste]
      );
    }
  }
  return getDetail(tenantId);
}

/** Expression reguliere PostgreSQL « commence par l'un des prefixes » (prefixes deja nettoyes : chiffres seulement). */
const regex = (prefixes) => `^(${prefixes.join("|")})`;

module.exports = { CATALOGUE, listePrefixes, getComptes, getDetail, enregistrer, regex };
