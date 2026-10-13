// Detail du cout de revient des articles (Lot B du simulateur de remise, 13/10/2026).
// Pour chaque article, retrouve la derniere reception VALIDEE qui l'a approvisionne et decompose son
// cout de revient unitaire : prix d'achat, fret, assurance, douane, transit, transport local, frais de
// paiement fournisseur, autres. Rien n'est stocke : tout est recalcule a la lecture (comme la repartition
// des couts d'approche), donc jamais perime. Si le cout actuel de l'article ne vient pas de cette reception
// (saisi a la main, ou autre source), aucun detail n'est propose.
const { repartirCouts, estimerFraisPaiement } = require("./receptionCouts");

const arr2 = (n) => Math.round(n * 100) / 100;

async function detailsCoutProduits(queryable, tenantId, produits, parametres) {
  // produits : Map id -> { cout }
  const ids = [...produits.keys()];
  const resultat = new Map();
  if (ids.length === 0) return resultat;
  const dernieres = (
    await queryable.query(
      `SELECT DISTINCT ON (l.produit_id) l.produit_id, l.id AS ligne_id, l.reception_id, l.cout_revient_unitaire_xof,
              r.numero, r.date_reception, r.cours_devise, r.devise
       FROM reception_ligne l JOIN reception_marchandise r ON r.id = l.reception_id
       WHERE r.tenant_id = $1 AND r.statut = 'VALIDEE' AND l.produit_id = ANY($2::uuid[])
       ORDER BY l.produit_id, r.date_reception DESC, r.date_creation DESC`,
      [tenantId, ids]
    )
  ).rows;
  const cache = new Map(); // reception_id -> { repartition, lignes, totalAchatXof }
  for (const d of dernieres) {
    const produit = produits.get(d.produit_id);
    const coutProduit = produit && produit.cout !== null && produit.cout !== undefined ? Number(produit.cout) : null;
    // Le cout de l'article doit venir de cette reception (a 1 XOF pres), sinon le detail serait trompeur.
    if (coutProduit === null || Math.abs(Number(d.cout_revient_unitaire_xof) - coutProduit) > 1) continue;
    if (!cache.has(d.reception_id)) {
      const lignes = (await queryable.query(`SELECT id, quantite, prix_unitaire_devise, poids_unitaire_kg FROM reception_ligne WHERE reception_id = $1 ORDER BY ordre ASC`, [d.reception_id])).rows;
      const couts = (await queryable.query(`SELECT type_cout, libelle, montant, en_devise_facture, repartition FROM reception_cout_approche WHERE reception_id = $1 ORDER BY ordre ASC`, [d.reception_id])).rows;
      const repartition = repartirCouts(lignes, couts, Number(d.cours_devise) || 1);
      cache.set(d.reception_id, { lignes, repartition, aFraisPaiement: couts.some((c) => c.type_cout === "FRAIS_PAIEMENT" && Number(c.montant) > 0) });
    }
    const c = cache.get(d.reception_id);
    const i = c.lignes.findIndex((l) => l.id === d.ligne_id);
    if (i < 0) continue;
    const ligne = c.repartition.lignes[i];
    const q = Number(c.lignes[i].quantite) || 0;
    // Estimation (non incluse dans le cout) des frais de paiement quand ils n'ont pas ete saisis : part de la ligne
    // dans le montant vire, pour un fournisseur etranger uniquement.
    let fraisPaiementEstime = null;
    if (!c.aFraisPaiement && String(d.devise || "XOF").toUpperCase() !== "XOF" && parametres && q > 0 && c.repartition.total_achat_xof > 0) {
      const total = estimerFraisPaiement(c.repartition.total_achat_xof, parametres);
      fraisPaiementEstime = arr2((total * ligne.valeur_achat_xof) / c.repartition.total_achat_xof / q);
    }
    resultat.set(d.produit_id, {
      reception_numero: d.numero,
      date_reception: d.date_reception instanceof Date ? d.date_reception.toISOString().slice(0, 10) : String(d.date_reception).slice(0, 10),
      devise: d.devise,
      composantes: ligne.cout_detail_unitaire_xof,
      total: ligne.cout_revient_unitaire_xof,
      frais_paiement_saisis: c.aFraisPaiement,
      frais_paiement_estime_unitaire: fraisPaiementEstime,
    });
  }
  return resultat;
}

module.exports = { detailsCoutProduits };
