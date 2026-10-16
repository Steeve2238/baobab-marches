/**
 * Valorisation du stock (Pack Commerce, lot 6a).
 *
 * Le stock reste la somme des mouvements (stockService). La valorisation est CALCULEE a partir du
 * journal des mouvements, selon la methode choisie par l'entreprise :
 *  - CMUP : cout moyen unitaire pondere apres chaque entree (methode admise par le SYSCOHADA) ;
 *  - FIFO : premier entre, premier sorti, par couches d'entree (methode admise) ;
 *  - DERNIER_COUT : cout de revient courant du produit (comportement historique ; NON admis comme
 *    methode de valorisation d'inventaire par le SYSCOHADA : a faire valider par l'expert-comptable).
 *
 * La methode s'applique aux sorties datees a partir de la date d'effet : les sorties deja enregistrees
 * gardent leur cout (pas de retroactivite).
 */
const db = require("./../db");

const METHODES = ["DERNIER_COUT", "CMUP", "FIFO"];

const arr2 = (n) => Math.round(Number(n) * 100) / 100;

async function lireMethode(queryable, tenantId) {
  const r = await queryable.query(
    `SELECT methode_valorisation_stock AS methode, valorisation_date_effet AS date_effet, seuil_stock_defaut FROM tenant WHERE id = $1`,
    [tenantId]
  );
  const row = r.rows[0] || {};
  const d = row.date_effet;
  const dateEffet = d ? (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d).slice(0, 10)) : null;
  return { methode: row.methode || "DERNIER_COUT", date_effet: dateEffet, seuil_defaut: row.seuil_stock_defaut !== undefined ? Number(row.seuil_stock_defaut) : 5 };
}

function dateIso(d) {
  if (!d) return null;
  if (d instanceof Date) return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

/**
 * Rejoue le journal d'un produit. mouvements : [{quantite, cout_unitaire_xof, type_mouvement}] ordonnes.
 * coutRef : cout de revient courant du produit (repli quand un mouvement n'a pas de cout).
 * Retourne { quantite, valeur, cout_unitaire, couches } - cout_unitaire = cout de la prochaine unite sortie.
 */
function rejouer(mouvements, methode, coutRef) {
  const ref = Number(coutRef) || 0;
  if (methode === "FIFO") {
    const couches = []; // { q, c }
    let dette = 0; // quantite sortie au-dela du stock disponible
    let dernierCout = ref;
    for (const m of mouvements) {
      const q = Number(m.quantite);
      const c = m.cout_unitaire_xof === null || m.cout_unitaire_xof === undefined ? ref : Number(m.cout_unitaire_xof);
      if (q > 0) {
        dernierCout = c;
        let reste = q;
        if (dette > 0) {
          const absorbe = Math.min(dette, reste);
          dette -= absorbe;
          reste -= absorbe;
        }
        if (reste > 0) couches.push({ q: reste, c });
      } else if (q < 0) {
        let aSortir = -q;
        while (aSortir > 1e-9 && couches.length) {
          const t = couches[0];
          const pris = Math.min(t.q, aSortir);
          t.q -= pris;
          aSortir -= pris;
          dernierCout = t.c;
          if (t.q <= 1e-9) couches.shift();
        }
        if (aSortir > 1e-9) dette += aSortir;
      }
    }
    const quantite = couches.reduce((s, t) => s + t.q, 0) - dette;
    const valeur = couches.reduce((s, t) => s + t.q * t.c, 0);
    const prochain = couches.length ? couches[0].c : dernierCout;
    return { quantite: arr3(quantite), valeur: arr2(valeur), cout_unitaire: arr2(prochain), couches: couches.map((t) => ({ quantite: arr3(t.q), cout: arr2(t.c) })) };
  }
  // CMUP (et valorisation de reference pour le calcul des ecarts)
  let Q = 0;
  let V = 0;
  let moyen = ref;
  for (const m of mouvements) {
    const q = Number(m.quantite);
    const c = m.cout_unitaire_xof === null || m.cout_unitaire_xof === undefined ? ref : Number(m.cout_unitaire_xof);
    if (q > 0) {
      V += q * c;
      Q += q;
      if (Q > 1e-9) moyen = V / Q;
    } else if (q < 0) {
      V += q * moyen;
      Q += q;
      if (Math.abs(Q) < 1e-9) { Q = 0; V = 0; }
    }
  }
  return { quantite: arr3(Q), valeur: arr2(Q > 0 ? V : 0), cout_unitaire: arr2(moyen), couches: [] };
}

const arr3 = (n) => Math.round(Number(n) * 1000) / 1000;

async function mouvementsProduit(queryable, tenantId, produitId) {
  const r = await queryable.query(
    `SELECT quantite, cout_unitaire_xof, type_mouvement FROM mouvement_stock WHERE tenant_id = $1 AND produit_id = $2
     ORDER BY date_mouvement ASC, date_creation ASC, id ASC`,
    [tenantId, produitId]
  );
  return r.rows;
}

/**
 * Cout unitaire a retenir pour une SORTIE de stock a la date donnee (avant insertion du mouvement).
 * coutRef = cout de revient courant du produit (utilise par la methode DERNIER_COUT et avant la date d'effet).
 */
async function coutSortie(queryable, tenantId, produitId, date, coutRef) {
  const cfg = await lireMethode(queryable, tenantId);
  if (cfg.methode === "DERNIER_COUT") return Number(coutRef) || 0;
  const jour = dateIso(date) || new Date().toISOString().slice(0, 10);
  if (cfg.date_effet && jour < cfg.date_effet) return Number(coutRef) || 0;
  const mv = await mouvementsProduit(queryable, tenantId, produitId);
  if (mv.length === 0) return Number(coutRef) || 0;
  const res = rejouer(mv, cfg.methode, coutRef);
  return res.cout_unitaire > 0 ? res.cout_unitaire : Number(coutRef) || 0;
}

/**
 * Valorisation de tout le stock (produits actifs ou ayant du stock).
 * Retourne { methode, date_effet, lignes: [{produit_id, reference, designation, categorie, unite, quantite,
 * cout_unitaire, valeur, seuil, etat}], total_valeur, nb_produits }.
 */
async function valoriserTout(queryable, tenantId, options = {}) {
  const cfg = await lireMethode(queryable, tenantId);
  const methode = options.methode || cfg.methode;
  const produits = (
    await queryable.query(
      `SELECT id, reference, designation, categorie, unite, cout_revient_unitaire_xof AS cout, seuil_alerte, actif
       FROM produit WHERE tenant_id = $1 ORDER BY lower(designation)`,
      [tenantId]
    )
  ).rows;
  const au = options.au && /^\d{4}-\d{2}-\d{2}$/.test(options.au) ? options.au : null;
  const mv = (
    await queryable.query(
      `SELECT produit_id, quantite, cout_unitaire_xof, type_mouvement FROM mouvement_stock WHERE tenant_id = $1
       ${au ? "AND date_mouvement <= $2" : ""}
       ORDER BY date_mouvement ASC, date_creation ASC, id ASC`,
      au ? [tenantId, au] : [tenantId]
    )
  ).rows;
  const parProduit = new Map();
  for (const m of mv) {
    if (!parProduit.has(m.produit_id)) parProduit.set(m.produit_id, []);
    parProduit.get(m.produit_id).push(m);
  }
  const lignes = [];
  let total = 0;
  for (const p of produits) {
    const mouvs = parProduit.get(p.id) || [];
    if (!p.actif && mouvs.length === 0) continue;
    let quantite, cout, valeur;
    if (methode === "DERNIER_COUT") {
      quantite = arr3(mouvs.reduce((s, m) => s + Number(m.quantite), 0));
      cout = Number(p.cout) || 0;
      valeur = quantite > 0 ? arr2(quantite * cout) : 0;
    } else {
      const r = rejouer(mouvs, methode, p.cout);
      quantite = r.quantite;
      cout = quantite > 0 && r.valeur > 0 ? arr2(r.valeur / quantite) : r.cout_unitaire;
      valeur = r.valeur;
    }
    const seuil = p.seuil_alerte === null || p.seuil_alerte === undefined ? cfg.seuil_defaut : Number(p.seuil_alerte);
    const etat = quantite <= 0 ? "RUPTURE" : quantite <= seuil ? "FAIBLE" : "OK";
    total += valeur;
    lignes.push({
      produit_id: p.id, reference: p.reference, designation: p.designation, categorie: p.categorie, unite: p.unite,
      actif: p.actif, quantite, cout_unitaire: cout, valeur, seuil, seuil_personnalise: p.seuil_alerte !== null && p.seuil_alerte !== undefined, etat,
    });
  }
  return { methode, au, date_effet: cfg.date_effet, seuil_defaut: cfg.seuil_defaut, lignes, total_valeur: arr2(total), nb_produits: lignes.length };
}

/** Cout unitaire de valorisation d'un produit (utilise par l'inventaire et les retours). */
async function coutValorisation(queryable, tenantId, produitId, coutRef) {
  const cfg = await lireMethode(queryable, tenantId);
  if (cfg.methode === "DERNIER_COUT") return Number(coutRef) || 0;
  const mv = await mouvementsProduit(queryable, tenantId, produitId);
  if (mv.length === 0) return Number(coutRef) || 0;
  const r = rejouer(mv, cfg.methode, coutRef);
  return r.cout_unitaire > 0 ? r.cout_unitaire : Number(coutRef) || 0;
}

async function changerMethode(tenantId, userId, methode, dateEffet) {
  if (!METHODES.includes(methode)) { const e = new Error("STOCK_METHODE_INVALIDE"); e.code = "STOCK_METHODE_INVALIDE"; throw e; }
  const date = dateEffet || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { const e = new Error("STOCK_DATE_INVALIDE"); e.code = "STOCK_DATE_INVALIDE"; throw e; }
  const { v4: uuidv4 } = require("uuid");
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE tenant SET methode_valorisation_stock = $2, valorisation_date_effet = $3 WHERE id = $1`, [tenantId, methode, date]);
    await client.query(
      `INSERT INTO stock_valorisation_historique (id, tenant_id, methode, date_effet, cree_par) VALUES ($1,$2,$3,$4,$5)`,
      [uuidv4(), tenantId, methode, date, userId || null]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { METHODES, lireMethode, rejouer, coutSortie, coutValorisation, valoriserTout, changerMethode, mouvementsProduit };
