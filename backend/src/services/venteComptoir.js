/**
 * Caisse / vente comptoir (Pack Commerce, lot 2).
 *
 * Une vente comptoir est un document de vente comme les autres, cree en une seule transaction :
 *   devis technique (origine CAISSE, valide d'office, masque des listes) -> facture INTEGRALE (origine CAISSE)
 *   -> encaissements par mode de reglement (paiement multiple, rendu de monnaie, reste a credit)
 *   -> bon de livraison (LIVRE + sortie de stock si la marchandise est emportee, BROUILLON « a livrer » sinon).
 * Les ecritures comptables (facture + un encaissement par mode) sont generees ensuite, sans jamais bloquer la vente.
 */
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const modesReglement = require("./modesReglement");
const comptaVentes = require("./comptaVentes");
const { enregistrerMouvement, stockProduit } = require("./stockService");
const valoStock = require("./valorisationStock");
const { prixVenteDepuisCout } = require("./produitsCatalogue");

class CaisseError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const arr2 = (n) => Math.round(Number(n) * 100) / 100;
const SEUIL_STOCK_FAIBLE = 5;
const REMISE_MAX_VENDEUR = 10; // % ; ADMIN et DIRECTION : jusqu'a 100 %

const helpers = () => require("../routes/ventes").helpers;

/** Client anonyme « Client comptoir » (un par entreprise), cree au premier besoin. */
async function clientComptoir(queryable, tenantId) {
  const r = await queryable.query(`SELECT id, nom FROM client_commercial WHERE tenant_id = $1 AND est_comptoir = true`, [tenantId]);
  if (r.rows[0]) return r.rows[0];
  const c = await queryable.query(
    `INSERT INTO client_commercial (id, tenant_id, nom, est_comptoir) VALUES ($1, $2, 'Client comptoir', true)
     ON CONFLICT DO NOTHING RETURNING id, nom`,
    [uuidv4(), tenantId]
  );
  if (c.rows[0]) return c.rows[0];
  return (await queryable.query(`SELECT id, nom FROM client_commercial WHERE tenant_id = $1 AND est_comptoir = true`, [tenantId])).rows[0];
}

async function tauxTva(queryable, tenantId) {
  const r = await queryable.query(`SELECT taux_tva_pourcentage FROM tenant WHERE id = $1`, [tenantId]);
  return r.rows[0] ? Number(r.rows[0].taux_tva_pourcentage) : 0;
}

/** Catalogue de vente : produits actifs avec reference, prix (HT et TTC) et stock disponible. */
async function catalogue(tenantId, { q, categorie, limit = 400 } = {}) {
  const params = [tenantId];
  let filtre = "";
  if (q && String(q).trim()) {
    params.push(`%${String(q).trim()}%`);
    filtre += ` AND (p.designation ILIKE $${params.length} OR p.reference ILIKE $${params.length} OR p.categorie ILIKE $${params.length})`;
  }
  if (categorie) {
    params.push(String(categorie));
    filtre += ` AND p.categorie = $${params.length}`;
  }
  const lim = Math.min(Math.max(Number(limit) || 400, 1), 1000);
  const r = await db.query(
    `SELECT p.id, p.reference, p.designation, p.unite, p.categorie, p.cout_revient_unitaire_xof, p.marge_pct, p.seuil_alerte,
            COALESCE((SELECT SUM(m.quantite) FROM mouvement_stock m WHERE m.tenant_id = p.tenant_id AND m.produit_id = p.id), 0) AS stock
     FROM produit p WHERE p.tenant_id = $1 AND p.actif = true ${filtre}
     ORDER BY p.designation LIMIT ${lim}`,
    params
  );
  const tva = await tauxTva(db, tenantId);
  const seuilDefaut = Number((await db.query(`SELECT seuil_stock_defaut FROM tenant WHERE id = $1`, [tenantId])).rows[0]?.seuil_stock_defaut ?? SEUIL_STOCK_FAIBLE);
  const cats = await db.query(`SELECT DISTINCT categorie FROM produit WHERE tenant_id = $1 AND actif = true AND categorie IS NOT NULL AND categorie <> '' ORDER BY 1`, [tenantId]);
  return {
    produits: r.rows.map((p) => {
      const ht = prixVenteDepuisCout(p.cout_revient_unitaire_xof, p.marge_pct);
      const stock = Number(p.stock);
      return {
        id: p.id, reference: p.reference, designation: p.designation, unite: p.unite, categorie: p.categorie,
        prix_ht: ht, prix_ttc: Math.round(ht * (1 + tva / 100)), stock,
        etat_stock: stock <= 0 ? "RUPTURE" : stock <= (p.seuil_alerte === null ? seuilDefaut : Number(p.seuil_alerte)) ? "FAIBLE" : "OK",
        vendable: ht > 0,
      };
    }),
    categories: cats.rows.map((c) => c.categorie),
    taux_tva: tva,
    remise_max_vendeur_pct: REMISE_MAX_VENDEUR,
    seuil_stock_faible: seuilDefaut,
  };
}

/** Vente comptoir. `utilisateur` = { tenantId, sub, roles }. */
async function creerVente(utilisateur, data) {
  const { tenantId, sub: userId } = utilisateur;
  const roles = utilisateur.roles || [];
  const h = helpers();
  const livraison = data.livraison === "DIFFEREE" ? "DIFFEREE" : "EMPORTE";

  const lignesSaisies = Array.isArray(data.lignes) ? data.lignes : [];
  if (lignesSaisies.length === 0) throw new CaisseError("CAISSE_PANIER_VIDE");
  const qtes = new Map();
  for (const l of lignesSaisies) {
    const q = Number(l.quantite);
    if (!l.produit_id || !Number.isFinite(q) || q <= 0) throw new CaisseError("CAISSE_LIGNE_INVALIDE");
    qtes.set(l.produit_id, (qtes.get(l.produit_id) || 0) + q);
  }

  const pct = data.pourcentage_remise === undefined || data.pourcentage_remise === null || data.pourcentage_remise === "" ? 0 : Number(data.pourcentage_remise);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new CaisseError("CAISSE_REMISE_INVALIDE");
  const peutRemiseLibre = roles.includes("ADMIN") || roles.includes("DIRECTION");
  if (pct > REMISE_MAX_VENDEUR && !peutRemiseLibre) throw new CaisseError("CAISSE_REMISE_PLAFOND", 403, { plafond: REMISE_MAX_VENDEUR });

  const client = await db.pool.connect();
  let factureId;
  try {
    await client.query("BEGIN");

    // Produits du tenant, prix du catalogue (jamais celui envoye par le navigateur).
    const ids = [...qtes.keys()];
    const prods = (await client.query(
      `SELECT id, reference, designation, unite, cout_revient_unitaire_xof, marge_pct FROM produit WHERE tenant_id = $1 AND actif = true AND id = ANY($2::uuid[])`,
      [tenantId, ids]
    )).rows;
    if (prods.length !== ids.length) throw new CaisseError("CAISSE_PRODUIT_INTROUVABLE", 404);
    const lignesBrutes = [];
    for (const l of lignesSaisies.reduce((acc, x) => (acc.find((y) => y.produit_id === x.produit_id) ? acc : [...acc, x]), [])) {
      const p = prods.find((x) => x.id === l.produit_id);
      const prix = prixVenteDepuisCout(p.cout_revient_unitaire_xof, p.marge_pct);
      if (prix <= 0) throw new CaisseError("CAISSE_PRIX_INDEFINI", 409, { reference: p.reference || p.designation });
      lignesBrutes.push({
        designation: p.designation, unite: p.unite || "U", quantite: qtes.get(p.id), prix_unitaire_ht: prix,
        produit_id: p.id, cout_revient_unitaire_ht: Number(p.cout_revient_unitaire_xof),
      });
    }

    // Client : comptoir par defaut. Credit et livraison differee exigent un client identifie.
    let clientId = data.client_commercial_id || null;
    let clientNom;
    if (clientId) {
      const c = await client.query(`SELECT id, nom, est_comptoir FROM client_commercial WHERE id = $1 AND tenant_id = $2 AND actif = true`, [clientId, tenantId]);
      if (!c.rows[0]) throw new CaisseError("CAISSE_CLIENT_INTROUVABLE", 404);
      clientNom = c.rows[0].nom;
      if (c.rows[0].est_comptoir) clientId = c.rows[0].id;
    } else {
      const c = await clientComptoir(client, tenantId);
      clientId = c.id;
      clientNom = c.nom;
    }
    const estComptoir = !!(await client.query(`SELECT est_comptoir FROM client_commercial WHERE id = $1`, [clientId])).rows[0].est_comptoir;

    const taux = await h.tauxTvaApplicable(client, tenantId, clientId);
    const calcul = h.calculerLignesEtTotaux(lignesBrutes, taux, pct);
    if (calcul.erreur) throw new CaisseError("CAISSE_LIGNE_INVALIDE");
    const totalTtc = calcul.total_ttc;

    // Paiements (un ou plusieurs modes). Le rendu de monnaie ne vient que des especes.
    const paiementsBruts = Array.isArray(data.paiements) ? data.paiements : [];
    const paiements = [];
    let totalRemis = 0;
    for (const p of paiementsBruts) {
      const montant = arr2(p.montant);
      if (!Number.isFinite(montant) || montant <= 0) continue;
      if (!p.mode_reglement_id) throw new CaisseError("CAISSE_MODE_REQUIS");
      let res;
      try {
        res = await modesReglement.resoudre(client, tenantId, p.mode_reglement_id, { sens: "ENCAISSEMENT" });
      } catch (e) {
        if (e instanceof modesReglement.ModeError) throw new CaisseError(e.code, e.status);
        throw e;
      }
      paiements.push({ mode: res.mode, montant_remis: montant, montant, reference: p.reference ? String(p.reference).trim().slice(0, 80) : null });
      totalRemis = arr2(totalRemis + montant);
    }
    let rendu = 0;
    // Le franc CFA n'a pas de centime : un ecart de moins de 1 F entre le total (remise, TVA) et le montant remis est un arrondi.
    const ecartArrondi = arr2(totalRemis - totalTtc);
    if (paiements.length > 0 && Math.abs(ecartArrondi) < 1) {
      paiements[paiements.length - 1].montant = arr2(paiements[paiements.length - 1].montant - ecartArrondi);
      totalRemis = totalTtc;
    }
    if (totalRemis > totalTtc + 0.005) {
      rendu = arr2(totalRemis - totalTtc);
      let aRetirer = rendu;
      for (const p of [...paiements].reverse()) {
        if (aRetirer <= 0) break;
        if (p.mode.type_mode !== "ESPECES") continue;
        const retire = Math.min(aRetirer, p.montant);
        p.montant = arr2(p.montant - retire);
        aRetirer = arr2(aRetirer - retire);
      }
      if (aRetirer > 0.005) throw new CaisseError("CAISSE_RENDU_ESPECES_REQUIS");
    }
    const paiementsRetenus = paiements.filter((p) => p.montant > 0);
    const totalEncaisse = arr2(paiementsRetenus.reduce((a, p) => a + p.montant, 0));
    const reste = arr2(Math.max(0, totalTtc - totalEncaisse));
    if (estComptoir && (reste > 0.005 || livraison === "DIFFEREE")) {
      throw new CaisseError(reste > 0.005 ? "CAISSE_CLIENT_REQUIS_CREDIT" : "CAISSE_CLIENT_REQUIS_LIVRAISON");
    }

    // Numeros : devis technique (compteur propre), facture (sequence des ventes).
    const maintenant = new Date();
    const annee = maintenant.getFullYear();
    const mois = maintenant.getMonth() + 1;
    const seqDevis = await h.tirerProchainNumero(client, tenantId, "DEVIS_CAISSE", annee);
    const numeroDevis = `CPT-${annee}-${String(seqDevis).padStart(5, "0")}`;
    const seqFacture = await h.tirerProchainNumero(client, tenantId, "VENTE", annee);
    const numeroFacture = h.formaterNumeroVente(annee, seqFacture);

    const devis = (await client.query(
      `INSERT INTO devis (id, tenant_id, numero, consultation_id, client_commercial_id, objet, date_devis, taux_tva_pourcentage,
                          total_ht, pourcentage_remise, montant_remise, montant_tva, total_ttc, cree_par, nb_lignes_non_chiffrees,
                          statut, valide_par, date_validation, origine)
       VALUES ($1,$2,$3,NULL,$4,'Vente comptoir',CURRENT_DATE,$5,$6,$7,$8,$9,$10,$11,0,'VALIDE',$11,now(),'CAISSE') RETURNING id`,
      [uuidv4(), tenantId, numeroDevis, clientId, taux, calcul.total_ht, calcul.pourcentage_remise, calcul.montant_remise, calcul.montant_tva, totalTtc, userId]
    )).rows[0];
    let ordre = 0;
    for (const l of calcul.lignes) {
      await client.query(
        `INSERT INTO devis_ligne (id, devis_id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht, non_chiffre, mention_prix, produit_id, cout_revient_unitaire_ht, reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,NULL,$9,$10,$11)`,
        [uuidv4(), devis.id, ordre++, l.designation, l.unite, l.quantite, l.prix_unitaire_ht, l.montant_ht, l.produit_id, l.cout_revient_unitaire_ht,
         prods.find((p) => p.id === l.produit_id).reference || null]
      );
    }

    const modeTexte = paiementsRetenus.length === 0 ? null : [...new Set(paiementsRetenus.map((p) => p.mode.libelle))].join(" + ");
    const modeUnique = paiementsRetenus.length > 0 && new Set(paiementsRetenus.map((p) => p.mode.id)).size === 1 ? paiementsRetenus[0].mode.id : null;
    const solde = reste <= 0.005;
    const facture = (await client.query(
      `INSERT INTO facture_vente (id, tenant_id, numero, mois_emission, devis_id, client_commercial_id, taux_tva_pourcentage, total_ht,
                                  pourcentage_remise, montant_remise, montant_tva, total_ttc, cree_par, type_facturation, montant_net_a_payer,
                                  origine, vendeur_id, statut, montant_encaisse, date_paiement, mode_paiement, mode_reglement_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'INTEGRALE',$12,'CAISSE',$13,$14,$15,$16,$17,$18) RETURNING *`,
      [uuidv4(), tenantId, numeroFacture, mois, devis.id, clientId, taux, calcul.total_ht, calcul.pourcentage_remise, calcul.montant_remise,
       calcul.montant_tva, totalTtc, userId, solde ? "PAYEE" : "IMPAYEE", totalEncaisse, solde ? new Date() : null,
       modeTexte, modeUnique]
    )).rows[0];
    factureId = facture.id;

    const lignesFacture = [];
    ordre = 0;
    for (const l of calcul.lignes) {
      const ref = prods.find((p) => p.id === l.produit_id).reference || null;
      const fl = (await client.query(
        `INSERT INTO facture_vente_ligne (id, facture_vente_id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht, non_chiffre, reference, produit_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10) RETURNING id`,
        [uuidv4(), facture.id, ordre++, l.designation, l.unite, l.quantite, l.prix_unitaire_ht, l.montant_ht, ref, l.produit_id]
      )).rows[0];
      lignesFacture.push({ id: fl.id, ...l, reference: ref });
    }

    for (const p of paiementsRetenus) {
      await client.query(
        `INSERT INTO encaissement_caisse (id, tenant_id, facture_id, mode_reglement_id, mode_libelle, montant, montant_remis, reference, vendeur_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [uuidv4(), tenantId, facture.id, p.mode.id, p.mode.libelle, p.montant, p.montant_remis, p.reference, userId]
      );
    }

    // Bon de livraison : livre tout de suite (marchandise emportee) ou « a livrer » (livraison differee).
    const bl = (await client.query(
      `INSERT INTO bon_livraison (id, tenant_id, numero, mois_emission, facture_vente_id, client_commercial_id, cree_par, rang, statut)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8) RETURNING *`,
      [uuidv4(), tenantId, numeroFacture, mois, facture.id, clientId, userId, livraison === "EMPORTE" ? "LIVRE" : "BROUILLON"]
    )).rows[0];
    ordre = 0;
    for (const l of lignesFacture) {
      await client.query(
        `INSERT INTO bon_livraison_ligne (id, bon_livraison_id, ordre, designation, unite, quantite_livree, reference, produit_id, facture_ligne_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [uuidv4(), bl.id, ordre++, l.designation, l.unite, l.quantite, l.reference, l.produit_id, l.id]
      );
    }
    const avertissementsStock = [];
    if (livraison === "EMPORTE") {
      for (const l of lignesFacture) {
        await enregistrerMouvement(client, {
          tenantId, produitId: l.produit_id, type: "SORTIE", quantite: -Number(l.quantite),
          coutUnitaire: await valoStock.coutSortie(client, tenantId, l.produit_id, null, Number(l.cout_revient_unitaire_ht)), origineType: "BL", origineId: bl.id, libelle: `BL ${numeroFacture}`, userId,
        });
        const stock = await stockProduit(client, tenantId, l.produit_id);
        if (stock < 0) avertissementsStock.push({ produit_id: l.produit_id, designation: l.designation, reference: l.reference, stock });
      }
    }

    await client.query("COMMIT");
    // Ecritures comptables (facture + un encaissement par mode) : jamais bloquantes pour la vente.
    await comptaVentes.apresVenteCaisse(tenantId, userId, factureId);
    const ticket = await ticketVente(tenantId, factureId);
    return { ...ticket, rendu, reste, avertissements_stock: avertissementsStock, client_nom: clientNom };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { /* deja annule */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Donnees d'impression d'une vente comptoir : ticket de caisse (80 mm) ou facture / recu. */
async function ticketVente(tenantId, factureId) {
  const f = (await db.query(
    `SELECT f.*, c.nom AS client_nom, c.est_comptoir, u.prenom AS vendeur_prenom, u.nom AS vendeur_nom
     FROM facture_vente f JOIN client_commercial c ON c.id = f.client_commercial_id
     LEFT JOIN utilisateur u ON u.id = f.vendeur_id
     WHERE f.id = $1 AND f.tenant_id = $2 AND f.origine = 'CAISSE'`,
    [factureId, tenantId]
  )).rows[0];
  if (!f) throw new CaisseError("CAISSE_VENTE_INTROUVABLE", 404);
  const lignes = (await db.query(
    `SELECT designation, unite, quantite, prix_unitaire_ht, montant_ht, reference FROM facture_vente_ligne WHERE facture_vente_id = $1 ORDER BY ordre`,
    [factureId]
  )).rows;
  const paiements = (await db.query(
    `SELECT mode_libelle, montant, montant_remis, reference, date_encaissement FROM encaissement_caisse WHERE facture_id = $1 ORDER BY date_encaissement`,
    [factureId]
  )).rows;
  const bl = (await db.query(`SELECT id, statut FROM bon_livraison WHERE facture_vente_id = $1 ORDER BY rang LIMIT 1`, [factureId])).rows[0] || null;
  const t = (await db.query(
    `SELECT raison_sociale, adresse, telephone, email, rccm, ninea FROM tenant WHERE id = $1`, [tenantId]
  )).rows[0] || {};
  const taux = Number(f.taux_tva_pourcentage);
  return {
    facture: {
      id: f.id, numero: f.numero, date_facture: f.date_facture, date_creation: f.date_creation, statut: f.statut,
      total_ht: Number(f.total_ht), montant_remise: Number(f.montant_remise), pourcentage_remise: Number(f.pourcentage_remise),
      montant_tva: Number(f.montant_tva), total_ttc: Number(f.total_ttc), taux_tva: taux, montant_encaisse: Number(f.montant_encaisse),
      reste: arr2(Number(f.total_ttc) - Number(f.montant_encaisse)),
    },
    client: { nom: f.client_nom, comptoir: f.est_comptoir },
    vendeur: [f.vendeur_prenom, f.vendeur_nom].filter(Boolean).join(" ") || null,
    lignes: lignes.map((l) => ({
      designation: l.designation, unite: l.unite, reference: l.reference, quantite: Number(l.quantite),
      prix_unitaire_ht: Number(l.prix_unitaire_ht), montant_ht: Number(l.montant_ht),
      prix_unitaire_ttc: Math.round(Number(l.prix_unitaire_ht) * (1 + taux / 100)),
    })),
    paiements: paiements.map((p) => ({ mode: p.mode_libelle, montant: Number(p.montant), montant_remis: p.montant_remis === null ? null : Number(p.montant_remis), reference: p.reference })),
    livraison: bl ? { bl_id: bl.id, statut: bl.statut } : null,
    entreprise: t,
  };
}

/** Ventes comptoir d'une journee (reedition de ticket). */
async function ventesDuJour(tenantId, date) {
  const r = await db.query(
    `SELECT f.id, f.numero, f.date_creation, f.total_ttc, f.montant_encaisse, f.statut, f.mode_paiement, c.nom AS client_nom, c.est_comptoir,
            u.prenom AS vendeur_prenom, u.nom AS vendeur_nom
     FROM facture_vente f JOIN client_commercial c ON c.id = f.client_commercial_id LEFT JOIN utilisateur u ON u.id = f.vendeur_id
     WHERE f.tenant_id = $1 AND f.origine = 'CAISSE' AND f.date_facture = $2::date AND f.statut <> 'ANNULEE'
     ORDER BY f.date_creation DESC LIMIT 300`,
    [tenantId, date]
  );
  return r.rows.map((f) => ({
    id: f.id, numero: f.numero, heure: f.date_creation, total_ttc: Number(f.total_ttc), montant_encaisse: Number(f.montant_encaisse),
    statut: f.statut, mode: f.mode_paiement, client_nom: f.client_nom, comptoir: f.est_comptoir,
    vendeur: [f.vendeur_prenom, f.vendeur_nom].filter(Boolean).join(" ") || null,
  }));
}

/** Rapport de caisse d'une journee : encaissements par mode et par vendeur, ventes, credit accorde. */
async function rapportJour(tenantId, date) {
  const modes = (await db.query(
    `SELECT e.mode_libelle AS mode, COUNT(*)::int AS nb, SUM(e.montant) AS total
     FROM encaissement_caisse e JOIN facture_vente f ON f.id = e.facture_id
     WHERE e.tenant_id = $1 AND f.origine = 'CAISSE' AND f.date_facture = $2::date AND f.statut <> 'ANNULEE'
     GROUP BY e.mode_libelle ORDER BY total DESC`,
    [tenantId, date]
  )).rows;
  const vendeurs = (await db.query(
    `SELECT COALESCE(NULLIF(TRIM(COALESCE(u.prenom,'') || ' ' || COALESCE(u.nom,'')), ''), '—') AS vendeur, COUNT(*)::int AS nb_ventes,
            SUM(f.total_ttc) AS ca, SUM(f.montant_encaisse) AS encaisse
     FROM facture_vente f LEFT JOIN utilisateur u ON u.id = f.vendeur_id
     WHERE f.tenant_id = $1 AND f.origine = 'CAISSE' AND f.date_facture = $2::date AND f.statut <> 'ANNULEE'
     GROUP BY 1 ORDER BY ca DESC`,
    [tenantId, date]
  )).rows;
  const tot = (await db.query(
    `SELECT COUNT(*)::int AS nb_ventes, COALESCE(SUM(total_ttc),0) AS ca, COALESCE(SUM(montant_encaisse),0) AS encaisse,
            COALESCE(SUM(total_ttc - montant_encaisse),0) AS credit
     FROM facture_vente WHERE tenant_id = $1 AND origine = 'CAISSE' AND date_facture = $2::date AND statut <> 'ANNULEE'`,
    [tenantId, date]
  )).rows[0];
  // Avoirs / retours du jour (lot 6c) : sorties de tresorerie par mode de remboursement.
  const rembs = (await db.query(
    `SELECT COALESCE(mode_libelle, '—') AS mode, COUNT(*)::int AS nb, SUM(montant_rembourse) AS total
     FROM avoir_vente WHERE tenant_id = $1 AND date_avoir = $2::date AND montant_rembourse > 0 GROUP BY 1 ORDER BY total DESC`,
    [tenantId, date]
  )).rows;
  const avoirs = (await db.query(
    `SELECT COUNT(*)::int AS nb, COALESCE(SUM(total_ttc),0) AS ttc FROM avoir_vente WHERE tenant_id = $1 AND date_avoir = $2::date`,
    [tenantId, date]
  )).rows[0];
  return {
    date,
    totaux: { nb_ventes: tot.nb_ventes, ca: Number(tot.ca), encaisse: Number(tot.encaisse), credit: Number(tot.credit), nb_avoirs: avoirs.nb, avoirs_ttc: Number(avoirs.ttc), rembourse: rembs.reduce((x, r) => x + Number(r.total), 0) },
    remboursements: rembs.map((r) => ({ mode: r.mode, nb: r.nb, total: Number(r.total) })),
    par_mode: modes.map((m) => ({ mode: m.mode, nb: m.nb, total: Number(m.total) })),
    par_vendeur: vendeurs.map((v) => ({ vendeur: v.vendeur, nb_ventes: v.nb_ventes, ca: Number(v.ca), encaisse: Number(v.encaisse) })),
  };
}

module.exports = { CaisseError, catalogue, creerVente, ticketVente, ventesDuJour, rapportJour, clientComptoir };
