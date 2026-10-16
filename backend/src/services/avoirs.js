/**
 * Avoirs et retours clients (Pack Commerce, lot 6c).
 *
 * Un avoir est toujours rattache a une facture de vente INTEGRALE (y compris les ventes de caisse). Il peut porter
 *  - sur des lignes de la facture (quantites <= quantites facturees non encore creditees), avec remise en stock
 *    optionnelle au cout de sortie d'origine ;
 *  - ou sur un montant libre (erreur de facturation, remise commerciale accordee apres coup).
 * Reglement : imputation sur le solde restant du de la facture, le surplus etant rembourse (mode de reglement de type
 * decaissement obligatoire). La facture elle-meme n'est jamais modifiee : l'imputation augmente montant_encaisse (et
 * montant_avoir_impute pour ne pas la confondre avec de la tresorerie).
 */
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const modesReglement = require("./modesReglement");
const { enregistrerMouvement } = require("./stockService");
const valo = require("./valorisationStock");
const comptaAvoirs = require("./comptaAvoirs");

class AvoirError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const MOTIFS = ["RETOUR_MARCHANDISE", "ERREUR_FACTURATION", "REMISE_COMMERCIALE", "ANNULATION_VENTE", "AUTRE"];
const arr2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const arr3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const dateValide = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const dateIso = (d) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const txt = (v, max) => (v && String(v).trim() ? String(v).trim().slice(0, max) : null);

async function prochainNumero(client, tenantId, annee) {
  await client.query(
    `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero) VALUES ($1, 'AVOIR_VENTE', $2, 0)
     ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
    [tenantId, annee]
  );
  const r = await client.query(
    `UPDATE compteur_numerotation SET dernier_numero = dernier_numero + 1 WHERE tenant_id = $1 AND type_compteur = 'AVOIR_VENTE' AND annee = $2 RETURNING dernier_numero`,
    [tenantId, annee]
  );
  return `AV-${annee}-${String(r.rows[0].dernier_numero).padStart(4, "0")}`;
}

/** Taux de remise (fraction) et taux de TVA effectif (fraction du HT net) d'une facture. */
function tauxFacture(f) {
  const remise = Number(f.pourcentage_remise || 0) / 100;
  const htNet = Number(f.total_ht) - Number(f.montant_remise || 0);
  const tva = htNet > 0 ? Number(f.montant_tva) / htNet : 0;
  return { remise, tva, htNet };
}

/** Etat de la facture vis-a-vis des avoirs : lignes, quantites deja creditees / livrees / retournees. */
async function situationFacture(queryable, tenantId, factureId, { verrou = false } = {}) {
  const f = (
    await queryable.query(
      `SELECT f.*, c.nom AS client_nom FROM facture_vente f JOIN client_commercial c ON c.id = f.client_commercial_id
       WHERE f.id = $1 AND f.tenant_id = $2 ${verrou ? "FOR UPDATE OF f" : ""}`,
      [factureId, tenantId]
    )
  ).rows[0];
  if (!f) throw new AvoirError("AVOIR_FACTURE_INTROUVABLE", 404);
  const lignes = (
    await queryable.query(
      `SELECT l.id, l.ordre, l.designation, l.reference, l.unite, l.quantite, l.prix_unitaire_ht, l.montant_ht, l.produit_id, l.non_chiffre,
              COALESCE((SELECT SUM(x.quantite) FROM avoir_vente_ligne x WHERE x.facture_ligne_id = l.id), 0) AS deja_credite,
              COALESCE((SELECT SUM(x.quantite) FROM avoir_vente_ligne x WHERE x.facture_ligne_id = l.id AND x.retour_stock), 0) AS deja_retourne
       FROM facture_vente_ligne l WHERE l.facture_vente_id = $1 ORDER BY l.ordre`,
      [factureId]
    )
  ).rows;
  // Livraisons (sorties de stock des BL de la facture) par produit, au cout moyen de sortie.
  const sorties = (
    await queryable.query(
      `SELECT m.produit_id, -SUM(m.quantite) AS livree, SUM(-m.quantite * COALESCE(m.cout_unitaire_xof, 0)) AS valeur
       FROM mouvement_stock m JOIN bon_livraison bl ON bl.id = m.origine_id AND bl.facture_vente_id = $2
       WHERE m.tenant_id = $1 AND m.origine_type = 'BL' AND m.quantite < 0 GROUP BY m.produit_id`,
      [tenantId, factureId]
    )
  ).rows;
  const retours = (
    await queryable.query(
      `SELECT m.produit_id, SUM(m.quantite) AS retournee
       FROM mouvement_stock m JOIN avoir_vente a ON a.id = m.origine_id AND a.facture_vente_id = $2
       WHERE m.tenant_id = $1 AND m.origine_type = 'AVOIR' GROUP BY m.produit_id`,
      [tenantId, factureId]
    )
  ).rows;
  const sortieMap = new Map(sorties.map((s) => [s.produit_id, { livree: Number(s.livree), valeur: Number(s.valeur) }]));
  const retourMap = new Map(retours.map((r) => [r.produit_id, Number(r.retournee)]));
  const { remise, tva, htNet } = tauxFacture(f);
  const deja = (await queryable.query(`SELECT COALESCE(SUM(total_ttc), 0) AS t, COALESCE(SUM(total_ht), 0) AS h FROM avoir_vente WHERE facture_vente_id = $1`, [factureId])).rows[0];
  return {
    facture: f, lignes, sortieMap, retourMap, remise, tva, htNet,
    ttcDejaCredite: Number(deja.t), htDejaCredite: Number(deja.h),
  };
}

/** Donnees pour l'ecran de creation d'un avoir. */
async function eligibilite(tenantId, factureId) {
  const s = await situationFacture(db, tenantId, factureId);
  const f = s.facture;
  const raisons = [];
  if (f.statut === "ANNULEE") raisons.push("AVOIR_FACTURE_ANNULEE");
  if (f.type_facturation !== "INTEGRALE") raisons.push("AVOIR_FACTURE_TYPE_NON_SUPPORTE");
  if (Number(f.tva_precompte_montant) > 0) raisons.push("AVOIR_PRECOMPTE_NON_SUPPORTE");
  const solde = arr2(Number(f.montant_net_a_payer) - Number(f.montant_encaisse));
  const reste = arr2(Number(f.montant_net_a_payer) - s.ttcDejaCredite);
  if (reste <= 0.5) raisons.push("AVOIR_FACTURE_DEJA_AVOIREE");
  // Livraison de la ligne : quantite sortie du stock pour ce produit, repartie sur les lignes du meme produit.
  const livreRestant = new Map();
  for (const [pid, v] of s.sortieMap) livreRestant.set(pid, v.livree - (s.retourMap.get(pid) || 0));
  const lignes = s.lignes.map((l) => {
    const facturee = Number(l.quantite);
    const credite = Number(l.deja_credite);
    const aCrediter = arr3(Math.max(facturee - credite, 0));
    let retournable = 0;
    if (l.produit_id && livreRestant.has(l.produit_id)) {
      retournable = Math.max(Math.min(aCrediter, livreRestant.get(l.produit_id)), 0);
      livreRestant.set(l.produit_id, livreRestant.get(l.produit_id) - retournable);
    }
    const unitNet = Number(l.prix_unitaire_ht) * (1 - s.remise);
    return {
      id: l.id, designation: l.designation, reference: l.reference, unite: l.unite, produit_id: l.produit_id,
      quantite_facturee: facturee, quantite_deja_creditee: credite, quantite_creditable: aCrediter, quantite_retournable: arr3(retournable),
      prix_unitaire_ht: Number(l.prix_unitaire_ht), prix_unitaire_ht_net: arr2(unitNet), non_chiffre: l.non_chiffre,
    };
  });
  return {
    facture: {
      id: f.id, numero: f.numero, date_facture: dateIso(f.date_facture), client_nom: f.client_nom, statut: f.statut, origine: f.origine,
      total_ht: Number(f.total_ht), montant_remise: Number(f.montant_remise), montant_tva: Number(f.montant_tva), total_ttc: Number(f.total_ttc),
      montant_net_a_payer: Number(f.montant_net_a_payer), montant_encaisse: Number(f.montant_encaisse), solde_du: solde,
      taux_tva_effectif_pct: arr2(s.tva * 100),
    },
    ttc_deja_credite: arr2(s.ttcDejaCredite), reste_creditable_ttc: Math.max(reste, 0),
    ht_deja_credite: arr2(s.htDejaCredite), reste_creditable_ht: arr2(Math.max(s.htNet - s.htDejaCredite, 0)),
    lignes, eligible: raisons.length === 0, raisons,
  };
}

/** Recherche de factures a crediter (numero ou client). */
async function chercherFactures(tenantId, q) {
  const motif = `%${String(q || "").trim().toLowerCase()}%`;
  const r = await db.query(
    `SELECT f.id, f.numero, f.date_facture, f.total_ttc, f.statut, f.origine, c.nom AS client_nom
     FROM facture_vente f JOIN client_commercial c ON c.id = f.client_commercial_id
     WHERE f.tenant_id = $1 AND f.statut <> 'ANNULEE' AND f.type_facturation = 'INTEGRALE'
       AND (lower(f.numero) LIKE $2 OR lower(c.nom) LIKE $2)
     ORDER BY f.date_facture DESC, f.date_creation DESC LIMIT 20`,
    [tenantId, motif]
  );
  return r.rows.map((x) => ({ ...x, date_facture: dateIso(x.date_facture), total_ttc: Number(x.total_ttc) }));
}

async function creerAvoir(utilisateur, data) {
  const { tenantId, sub: userId } = utilisateur;
  const date = data.date_avoir || aujourdhui();
  if (!dateValide(date)) throw new AvoirError("AVOIR_DATE_INVALIDE");
  if (date > aujourdhui()) throw new AvoirError("AVOIR_DATE_FUTURE");
  const motifType = MOTIFS.includes(data.motif_type) ? data.motif_type : null;
  if (!motifType) throw new AvoirError("AVOIR_MOTIF_REQUIS");
  const motif = txt(data.motif, 300);
  if (!data.facture_id) throw new AvoirError("AVOIR_FACTURE_INTROUVABLE", 404);
  const saisies = Array.isArray(data.lignes) ? data.lignes.filter((l) => l && l.facture_ligne_id && Number(l.quantite) > 0) : [];
  const montantLibre = data.montant_ht !== undefined && data.montant_ht !== null && data.montant_ht !== "" ? Number(data.montant_ht) : null;
  if (saisies.length === 0 && !(montantLibre > 0)) throw new AvoirError("AVOIR_RIEN_A_CREDITER");
  if (saisies.length > 0 && montantLibre > 0) throw new AvoirError("AVOIR_LIGNES_OU_MONTANT");

  const client = await db.pool.connect();
  let avoirId;
  try {
    await client.query("BEGIN");
    const s = await situationFacture(client, tenantId, data.facture_id, { verrou: true });
    const f = s.facture;
    if (f.statut === "ANNULEE") throw new AvoirError("AVOIR_FACTURE_ANNULEE", 409);
    if (f.type_facturation !== "INTEGRALE") throw new AvoirError("AVOIR_FACTURE_TYPE_NON_SUPPORTE", 409);
    if (Number(f.tva_precompte_montant) > 0) throw new AvoirError("AVOIR_PRECOMPTE_NON_SUPPORTE", 409);
    if (date < dateIso(f.date_facture)) throw new AvoirError("AVOIR_DATE_AVANT_FACTURE");

    const lignesAvoir = [];
    let htTotal = 0;
    const livreRestant = new Map();
    for (const [pid, v] of s.sortieMap) livreRestant.set(pid, v.livree - (s.retourMap.get(pid) || 0));
    if (saisies.length > 0) {
      const parId = new Map(s.lignes.map((l) => [l.id, l]));
      const vus = new Set();
      let ordre = 0;
      for (const sl of saisies) {
        const l = parId.get(sl.facture_ligne_id);
        if (!l || vus.has(sl.facture_ligne_id)) throw new AvoirError("AVOIR_LIGNE_INVALIDE");
        vus.add(sl.facture_ligne_id);
        const q = arr3(Number(sl.quantite));
        const restant = arr3(Number(l.quantite) - Number(l.deja_credite));
        if (!(q > 0) || q > restant + 0.0005) throw new AvoirError("AVOIR_QUANTITE_DEPASSE", 409, { designation: l.designation });
        const retour = !!sl.retour_stock;
        if (retour) {
          if (!l.produit_id) throw new AvoirError("AVOIR_RETOUR_SANS_PRODUIT", 409, { designation: l.designation });
          const dispo = livreRestant.get(l.produit_id) || 0;
          if (q > dispo + 0.0005) throw new AvoirError("AVOIR_RETOUR_NON_LIVRE", 409, { designation: l.designation });
          livreRestant.set(l.produit_id, dispo - q);
        }
        const unitNet = Number(l.prix_unitaire_ht) * (1 - s.remise);
        const ht = arr2(q * unitNet);
        htTotal += ht;
        lignesAvoir.push({
          id: uuidv4(), facture_ligne_id: l.id, produit_id: l.produit_id, ordre: ordre++, designation: l.designation, reference: l.reference,
          unite: l.unite, quantite: q, prix_unitaire_ht: arr2(unitNet), montant_ht: ht, retour_stock: retour,
          totalementCredite: Math.abs(q - restant) < 0.0005,
        });
      }
    } else {
      if (!["ERREUR_FACTURATION", "REMISE_COMMERCIALE", "AUTRE"].includes(motifType)) throw new AvoirError("AVOIR_MONTANT_MOTIF_INVALIDE");
      if (!Number.isFinite(montantLibre) || montantLibre > 1e12) throw new AvoirError("AVOIR_MONTANT_INVALIDE");
      htTotal = arr2(montantLibre);
    }
    htTotal = arr2(htTotal);
    let ttc = arr2(htTotal * (1 + s.tva));
    // Derniere tranche : l'avoir solde exactement la facture (absorbe l'arrondi).
    const resteTtc = arr2(Number(f.montant_net_a_payer) - s.ttcDejaCredite);
    const toutesLignesSoldees = saisies.length > 0 && s.lignes.every((l) => {
      const ligneAvoir = lignesAvoir.find((x) => x.facture_ligne_id === l.id);
      const restant = Number(l.quantite) - Number(l.deja_credite);
      return restant <= 0.0005 || (ligneAvoir && ligneAvoir.totalementCredite);
    });
    if (toutesLignesSoldees && Math.abs(ttc - resteTtc) <= 1) ttc = resteTtc;
    if (ttc > resteTtc + 0.5) throw new AvoirError("AVOIR_MONTANT_DEPASSE", 409, { reste: resteTtc });
    const tvaMontant = arr2(ttc - htTotal);

    // Reglement : imputation sur le solde du, surplus rembourse.
    const soldeDu = Math.max(arr2(Number(f.montant_net_a_payer) - Number(f.montant_encaisse)), 0);
    const imputation = arr2(Math.min(ttc, soldeDu));
    const rembourse = arr2(ttc - imputation);
    let res = null;
    if (rembourse > 0) {
      if (!data.mode_reglement_id) throw new AvoirError("AVOIR_MODE_REMBOURSEMENT_REQUIS");
      try {
        res = await modesReglement.resoudre(client, tenantId, data.mode_reglement_id, { sens: "DECAISSEMENT" });
      } catch (e) {
        if (e instanceof modesReglement.ModeError) throw new AvoirError("MODE_REGLEMENT_INTROUVABLE");
        throw e;
      }
      if (!res || !res.mode) throw new AvoirError("MODE_REGLEMENT_INTROUVABLE");
    }

    const numero = await prochainNumero(client, tenantId, Number(date.slice(0, 4)));
    avoirId = uuidv4();
    await client.query(
      `INSERT INTO avoir_vente (id, tenant_id, numero, facture_vente_id, client_commercial_id, date_avoir, motif_type, motif, taux_tva_pourcentage,
                                total_ht, montant_tva, total_ttc, montant_impute, montant_rembourse, mode_reglement_id, mode_libelle, reference, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [avoirId, tenantId, numero, f.id, f.client_commercial_id, date, motifType, motif, arr2(s.tva * 100), htTotal, tvaMontant, ttc, imputation, rembourse,
        res && res.mode ? res.mode.id : null, res ? res.libelle || res.mode.libelle || null : null, txt(data.reference, 100), userId || null]
    );
    if (lignesAvoir.length === 0) {
      lignesAvoir.push({ id: uuidv4(), facture_ligne_id: null, produit_id: null, ordre: 0, designation: motif || "Avoir sur facture " + f.numero, reference: null, unite: null, quantite: 1, prix_unitaire_ht: htTotal, montant_ht: htTotal, retour_stock: false });
    }
    for (const l of lignesAvoir) {
      await client.query(
        `INSERT INTO avoir_vente_ligne (id, avoir_id, facture_ligne_id, produit_id, ordre, designation, reference, unite, quantite, prix_unitaire_ht, montant_ht, retour_stock)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [l.id, avoirId, l.facture_ligne_id, l.produit_id, l.ordre, l.designation, l.reference, l.unite, l.quantite, l.prix_unitaire_ht, l.montant_ht, l.retour_stock]
      );
    }

    // Facture : l'imputation vaut regularisation (montant_encaisse), sans etre de la tresorerie (montant_avoir_impute).
    await client.query(
      `UPDATE facture_vente SET montant_encaisse = montant_encaisse + $2, montant_avoir_impute = montant_avoir_impute + $2,
              statut = CASE WHEN statut = 'IMPAYEE' AND montant_encaisse + $2 >= montant_net_a_payer - 0.005 THEN 'PAYEE' ELSE statut END
       WHERE id = $1`,
      [f.id, imputation]
    );

    // Remise en stock au cout de sortie d'origine (cout moyen des sorties de livraison de la facture).
    for (const l of lignesAvoir) {
      if (!l.retour_stock || !l.produit_id) continue;
      const so = s.sortieMap.get(l.produit_id);
      let cout = so && so.livree > 0 ? so.valeur / so.livree : 0;
      if (!(cout > 0)) {
        const p = (await client.query(`SELECT cout_revient_unitaire_xof FROM produit WHERE id = $1`, [l.produit_id])).rows[0];
        cout = await valo.coutValorisation(client, tenantId, l.produit_id, p ? p.cout_revient_unitaire_xof : 0);
      }
      await enregistrerMouvement(client, {
        tenantId, produitId: l.produit_id, type: "ENTREE", quantite: l.quantite, coutUnitaire: arr2(cout), date,
        origineType: "AVOIR", origineId: avoirId, libelle: `Retour ${numero} (facture ${f.numero})`, userId,
      });
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  comptaAvoirs.apresCreationAvoir(tenantId, userId, avoirId);
  return await detail(tenantId, avoirId);
}

async function lister(tenantId, { du, au, facture_id, q } = {}) {
  const cond = ["a.tenant_id = $1"];
  const val = [tenantId];
  if (du && dateValide(du)) { val.push(du); cond.push(`a.date_avoir >= $${val.length}`); }
  if (au && dateValide(au)) { val.push(au); cond.push(`a.date_avoir <= $${val.length}`); }
  if (facture_id) { val.push(facture_id); cond.push(`a.facture_vente_id = $${val.length}`); }
  if (q && String(q).trim()) { val.push(`%${String(q).trim().toLowerCase()}%`); cond.push(`(lower(a.numero) LIKE $${val.length} OR lower(f.numero) LIKE $${val.length} OR lower(c.nom) LIKE $${val.length})`); }
  const r = await db.query(
    `SELECT a.id, a.numero, a.date_avoir, a.motif_type, a.motif, a.total_ht, a.total_ttc, a.montant_impute, a.montant_rembourse, a.mode_libelle,
            f.numero AS facture_numero, f.id AS facture_id, c.nom AS client_nom
     FROM avoir_vente a JOIN facture_vente f ON f.id = a.facture_vente_id JOIN client_commercial c ON c.id = a.client_commercial_id
     WHERE ${cond.join(" AND ")} ORDER BY a.date_avoir DESC, a.date_creation DESC LIMIT 300`,
    val
  );
  const rows = r.rows.map((x) => ({
    ...x, date_avoir: dateIso(x.date_avoir), total_ht: Number(x.total_ht), total_ttc: Number(x.total_ttc),
    montant_impute: Number(x.montant_impute), montant_rembourse: Number(x.montant_rembourse),
  }));
  return { avoirs: rows, total_ttc: arr2(rows.reduce((s, x) => s + x.total_ttc, 0)), total_ht: arr2(rows.reduce((s, x) => s + x.total_ht, 0)) };
}

async function detail(tenantId, id) {
  const a = (
    await db.query(
      `SELECT a.*, f.numero AS facture_numero, f.date_facture, f.reference_bc_client, c.nom AS client_nom, c.adresse AS client_adresse, c.email AS client_email,
              c.telephone AS client_telephone
       FROM avoir_vente a JOIN facture_vente f ON f.id = a.facture_vente_id JOIN client_commercial c ON c.id = a.client_commercial_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [id, tenantId]
    )
  ).rows[0];
  if (!a) throw new AvoirError("AVOIR_INTROUVABLE", 404);
  const lignes = (await db.query(`SELECT * FROM avoir_vente_ligne WHERE avoir_id = $1 ORDER BY ordre`, [id])).rows.map((l) => ({
    ...l, quantite: Number(l.quantite), prix_unitaire_ht: Number(l.prix_unitaire_ht), montant_ht: Number(l.montant_ht),
  }));
  const ecritures = (
    await db.query(
      `SELECT id, statut, origine_role FROM ecriture_comptable WHERE tenant_id = $1 AND origine = 'AVOIR_VENTE' AND origine_id = $2`,
      [tenantId, id]
    )
  ).rows;
  return {
    ...a, date_avoir: dateIso(a.date_avoir), date_facture: dateIso(a.date_facture), taux_tva_pourcentage: Number(a.taux_tva_pourcentage),
    total_ht: Number(a.total_ht), montant_tva: Number(a.montant_tva), total_ttc: Number(a.total_ttc),
    montant_impute: Number(a.montant_impute), montant_rembourse: Number(a.montant_rembourse), lignes, ecritures,
  };
}

module.exports = { AvoirError, MOTIFS, eligibilite, chercherFactures, creerAvoir, lister, detail };
