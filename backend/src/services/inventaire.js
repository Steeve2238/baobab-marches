/**
 * Inventaire physique (Pack Commerce, lot 6b) : comptage, ecarts, validation => ajustements de stock.
 * Etapes : BROUILLON (liste de comptage generee, saisie des quantites comptees) -> VALIDE (ajustements
 * de stock generes, un par produit presentant un ecart) ou ANNULE.
 */
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { enregistrerMouvement } = require("./stockService");
const valo = require("./valorisationStock");
const comptaStock = require("./comptaStock");

class InventaireError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const arr3 = (n) => Math.round(Number(n) * 1000) / 1000;
const arr2 = (n) => Math.round(Number(n) * 100) / 100;
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const dateValide = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const dateIso = (d) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

async function prochainNumero(client, tenantId, annee) {
  await client.query(
    `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero) VALUES ($1, 'INVENTAIRE', $2, 0)
     ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
    [tenantId, annee]
  );
  const r = await client.query(
    `UPDATE compteur_numerotation SET dernier_numero = dernier_numero + 1 WHERE tenant_id = $1 AND type_compteur = 'INVENTAIRE' AND annee = $2 RETURNING dernier_numero`,
    [tenantId, annee]
  );
  return `INV-${annee}-${String(r.rows[0].dernier_numero).padStart(4, "0")}`;
}

async function stockALaDate(client, tenantId, date) {
  const r = await client.query(
    `SELECT produit_id, COALESCE(SUM(quantite), 0) AS q FROM mouvement_stock WHERE tenant_id = $1 AND date_mouvement <= $2 GROUP BY produit_id`,
    [tenantId, date]
  );
  return new Map(r.rows.map((x) => [x.produit_id, Number(x.q)]));
}

async function lister(tenantId) {
  const r = await db.query(
    `SELECT i.id, i.numero, i.libelle, i.date_inventaire, i.categorie, i.statut, i.date_creation, i.date_validation,
            (SELECT COUNT(*)::int FROM inventaire_ligne l WHERE l.inventaire_id = i.id) AS nb_lignes,
            (SELECT COUNT(*)::int FROM inventaire_ligne l WHERE l.inventaire_id = i.id AND l.quantite_comptee IS NOT NULL) AS nb_comptees,
            (SELECT COUNT(*)::int FROM inventaire_ligne l WHERE l.inventaire_id = i.id AND COALESCE(l.ecart, 0) <> 0) AS nb_ecarts,
            COALESCE((SELECT SUM(l.valeur_ecart_xof) FROM inventaire_ligne l WHERE l.inventaire_id = i.id), 0) AS valeur_ecart
     FROM inventaire i WHERE i.tenant_id = $1 ORDER BY i.date_inventaire DESC, i.date_creation DESC LIMIT 200`,
    [tenantId]
  );
  return r.rows.map((x) => ({ ...x, date_inventaire: dateIso(x.date_inventaire), valeur_ecart: Number(x.valeur_ecart) }));
}

async function creer(utilisateur, data) {
  const { tenantId, sub: userId } = utilisateur;
  const date = data.date_inventaire || aujourdhui();
  if (!dateValide(date)) throw new InventaireError("INVENTAIRE_DATE_INVALIDE");
  if (date > aujourdhui()) throw new InventaireError("INVENTAIRE_DATE_FUTURE");
  const categorie = data.categorie && String(data.categorie).trim() ? String(data.categorie).trim().slice(0, 100) : null;
  const libelle = data.libelle && String(data.libelle).trim() ? String(data.libelle).trim().slice(0, 200) : null;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const ouvert = (await client.query(`SELECT COUNT(*)::int AS n FROM inventaire WHERE tenant_id = $1 AND statut = 'BROUILLON'`, [tenantId])).rows[0].n;
    if (ouvert >= 5) throw new InventaireError("INVENTAIRE_TROP_OUVERTS", 409);
    const produits = (
      await client.query(
        `SELECT id, cout_revient_unitaire_xof AS cout FROM produit WHERE tenant_id = $1 AND actif = true ${categorie ? "AND categorie = $2" : ""}`,
        categorie ? [tenantId, categorie] : [tenantId]
      )
    ).rows;
    if (produits.length === 0) throw new InventaireError("INVENTAIRE_AUCUN_PRODUIT", 409);
    const numero = await prochainNumero(client, tenantId, Number(date.slice(0, 4)));
    const id = uuidv4();
    await client.query(
      `INSERT INTO inventaire (id, tenant_id, numero, libelle, date_inventaire, categorie, cree_par) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, tenantId, numero, libelle, date, categorie, userId || null]
    );
    const stocks = await stockALaDate(client, tenantId, date);
    for (const p of produits) {
      const cout = await valo.coutValorisation(client, tenantId, p.id, p.cout);
      await client.query(
        `INSERT INTO inventaire_ligne (id, inventaire_id, produit_id, quantite_theorique, cout_unitaire_xof) VALUES ($1,$2,$3,$4,$5)`,
        [uuidv4(), id, p.id, arr3(stocks.get(p.id) || 0), cout]
      );
    }
    await client.query("COMMIT");
    return await detail(tenantId, id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function detail(tenantId, id) {
  const inv = (await db.query(`SELECT * FROM inventaire WHERE id = $1 AND tenant_id = $2`, [id, tenantId])).rows[0];
  if (!inv) throw new InventaireError("INVENTAIRE_INTROUVABLE", 404);
  const lignes = (
    await db.query(
      `SELECT l.id, l.produit_id, p.reference, p.designation, p.categorie, p.unite, l.quantite_theorique, l.quantite_comptee, l.ecart,
              l.cout_unitaire_xof, l.valeur_ecart_xof
       FROM inventaire_ligne l JOIN produit p ON p.id = l.produit_id WHERE l.inventaire_id = $1
       ORDER BY lower(COALESCE(p.categorie, '')), lower(p.designation)`,
      [id]
    )
  ).rows.map((l) => {
    const th = Number(l.quantite_theorique);
    const cpt = l.quantite_comptee === null ? null : Number(l.quantite_comptee);
    const ecart = inv.statut === "VALIDE" ? (l.ecart === null ? null : Number(l.ecart)) : cpt === null ? null : arr3(cpt - th);
    const cout = l.cout_unitaire_xof === null ? 0 : Number(l.cout_unitaire_xof);
    return {
      ...l, quantite_theorique: th, quantite_comptee: cpt, ecart, cout_unitaire_xof: cout,
      valeur_ecart_xof: inv.statut === "VALIDE" ? Number(l.valeur_ecart_xof || 0) : ecart === null ? null : arr2(ecart * cout),
    };
  });
  return {
    ...inv, date_inventaire: dateIso(inv.date_inventaire), lignes,
    resume: {
      nb_lignes: lignes.length,
      nb_comptees: lignes.filter((l) => l.quantite_comptee !== null).length,
      nb_ecarts: lignes.filter((l) => l.ecart !== null && Math.abs(l.ecart) > 0.0005).length,
      valeur_ecart: arr2(lignes.reduce((s, l) => s + (l.valeur_ecart_xof || 0), 0)),
    },
  };
}

async function saisir(tenantId, id, lignes) {
  const inv = (await db.query(`SELECT statut FROM inventaire WHERE id = $1 AND tenant_id = $2`, [id, tenantId])).rows[0];
  if (!inv) throw new InventaireError("INVENTAIRE_INTROUVABLE", 404);
  if (inv.statut !== "BROUILLON") throw new InventaireError("INVENTAIRE_NON_MODIFIABLE", 409);
  if (!Array.isArray(lignes)) throw new InventaireError("INVENTAIRE_SAISIE_INVALIDE");
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    for (const l of lignes) {
      const q = l.quantite_comptee === null || l.quantite_comptee === "" || l.quantite_comptee === undefined ? null : Number(l.quantite_comptee);
      if (q !== null && (!Number.isFinite(q) || q < 0 || q > 1e10)) throw new InventaireError("INVENTAIRE_QUANTITE_INVALIDE");
      await client.query(
        `UPDATE inventaire_ligne SET quantite_comptee = $1 WHERE inventaire_id = $2 AND produit_id = $3`,
        [q === null ? null : arr3(q), id, l.produit_id]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return await detail(tenantId, id);
}

async function valider(utilisateur, id) {
  const { tenantId, sub: userId } = utilisateur;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const inv = (await client.query(`SELECT * FROM inventaire WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId])).rows[0];
    if (!inv) throw new InventaireError("INVENTAIRE_INTROUVABLE", 404);
    if (inv.statut !== "BROUILLON") throw new InventaireError("INVENTAIRE_NON_MODIFIABLE", 409);
    const date = dateIso(inv.date_inventaire);
    const lignes = (
      await client.query(
        `SELECT l.*, p.cout_revient_unitaire_xof AS cout_ref FROM inventaire_ligne l JOIN produit p ON p.id = l.produit_id
         WHERE l.inventaire_id = $1 AND l.quantite_comptee IS NOT NULL`,
        [id]
      )
    ).rows;
    if (lignes.length === 0) throw new InventaireError("INVENTAIRE_RIEN_COMPTE", 409);
    const stocks = await stockALaDate(client, tenantId, date);
    let nbAjustements = 0;
    for (const l of lignes) {
      const theo = arr3(stocks.get(l.produit_id) || 0);
      const ecart = arr3(Number(l.quantite_comptee) - theo);
      const cout = await valo.coutValorisation(client, tenantId, l.produit_id, l.cout_ref);
      await client.query(
        `UPDATE inventaire_ligne SET quantite_theorique = $1, ecart = $2, cout_unitaire_xof = $3, valeur_ecart_xof = $4 WHERE id = $5`,
        [theo, ecart, cout, arr2(ecart * cout), l.id]
      );
      if (Math.abs(ecart) > 0.0005) {
        await enregistrerMouvement(client, {
          tenantId, produitId: l.produit_id, type: "AJUSTEMENT", quantite: ecart, coutUnitaire: cout, date,
          origineType: "INVENTAIRE", origineId: id, libelle: `Inventaire ${inv.numero}`, userId,
        });
        nbAjustements += 1;
      }
    }
    // Les produits non comptes sont laisses tels quels (inventaire partiel) : leur ligne est retiree.
    await client.query(`DELETE FROM inventaire_ligne WHERE inventaire_id = $1 AND quantite_comptee IS NULL`, [id]);
    await client.query(`UPDATE inventaire SET statut = 'VALIDE', valide_par = $2, date_validation = now() WHERE id = $1`, [id, userId || null]);
    await client.query("COMMIT");
    // Ecriture de variation de stock (stock initial / stock final) si le module Comptabilite est actif.
    await comptaStock.apresValidation(tenantId, userId, id);
    return { ...(await detail(tenantId, id)), nb_ajustements: nbAjustements };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function annuler(tenantId, id) {
  const r = await db.query(
    `UPDATE inventaire SET statut = 'ANNULE' WHERE id = $1 AND tenant_id = $2 AND statut = 'BROUILLON' RETURNING id`,
    [id, tenantId]
  );
  if (r.rows.length === 0) {
    const ex = (await db.query(`SELECT 1 FROM inventaire WHERE id = $1 AND tenant_id = $2`, [id, tenantId])).rows[0];
    throw new InventaireError(ex ? "INVENTAIRE_NON_MODIFIABLE" : "INVENTAIRE_INTROUVABLE", ex ? 409 : 404);
  }
  return await detail(tenantId, id);
}

module.exports = { InventaireError, lister, creer, detail, saisir, valider, annuler };
