const { v4: uuidv4 } = require("uuid");
const { INCOTERM_INCLUS } = require("./receptionCouts");

// Catalogue d'incoterms UNIQUE du client (Lot 7, 05/10/2026) : les scenarios du
// module Logistique (table incoterm_scenario). Les 11 codes Incoterms 2020 y sont
// ajoutes au premier usage ; "inclus" (couts deja compris dans le prix du
// fournisseur) est stocke dans repartition_couts_json.inclus et modifiable. Les
// receptions, commandes, cotations de transitaires et simulations de logistique
// lisent tous ce catalogue.
const CODES_STANDARD = Object.keys(INCOTERM_INCLUS);

async function assurerCatalogue(db, tenantId) {
  const existants = (await db.query(`SELECT code FROM incoterm_scenario WHERE tenant_id = $1`, [tenantId])).rows.map((r) => String(r.code).toUpperCase());
  for (const code of CODES_STANDARD) {
    if (existants.includes(code)) continue;
    await db.query(
      `INSERT INTO incoterm_scenario (id, tenant_id, code, repartition_couts_json) VALUES ($1, $2, $3, $4)`,
      [uuidv4(), tenantId, code, JSON.stringify({ inclus: INCOTERM_INCLUS[code] })]
    );
  }
}

function inclusDe(scenario) {
  const j = scenario.repartition_couts_json;
  if (j && Array.isArray(j.inclus)) return j.inclus;
  return INCOTERM_INCLUS[String(scenario.code).toUpperCase()] || [];
}

// Catalogue complet : [{ id, code, inclus, standard, regle_calcul_id }], trie par code.
async function lireCatalogue(db, tenantId) {
  await assurerCatalogue(db, tenantId);
  const rows = (await db.query(`SELECT * FROM incoterm_scenario WHERE tenant_id = $1 ORDER BY code ASC`, [tenantId])).rows;
  const vus = new Set();
  const liste = [];
  for (const r of rows) {
    const code = String(r.code).toUpperCase();
    if (vus.has(code)) continue; // doublon historique : on garde la premiere ligne
    vus.add(code);
    liste.push({ id: r.id, code, inclus: inclusDe(r), standard: CODES_STANDARD.includes(code), regle_calcul_id: r.regle_calcul_id || null, repartition_couts_json: r.repartition_couts_json || {} });
  }
  return liste;
}

// Table { CODE: [types de cout deja inclus] } passee aux calculs de couts d'approche.
async function tableInclus(db, tenantId) {
  const liste = await lireCatalogue(db, tenantId);
  return Object.fromEntries(liste.map((i) => [i.code, i.inclus]));
}

const TYPES_INCLUS_VALIDES = ["FRET", "ASSURANCE", "TRANSPORT_LOCAL", "DOUANE", "TRANSIT"];
function nettoyerInclus(valeur) {
  if (!Array.isArray(valeur)) return null;
  return [...new Set(valeur.map((v) => String(v).toUpperCase()).filter((v) => TYPES_INCLUS_VALIDES.includes(v)))];
}

module.exports = { CODES_STANDARD, TYPES_INCLUS_VALIDES, assurerCatalogue, lireCatalogue, tableInclus, nettoyerInclus, inclusDe };
