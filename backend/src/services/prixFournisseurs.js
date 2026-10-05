const db = require("../db");

// Historique des prix par fournisseur (Lot 3, 05/10/2026).
// Source : lignes des receptions VALIDEES rattachees a un article. Rien n'est
// stocke a part : tout est recalcule a la lecture.
// - prix_achat_xof : prix unitaire de la facture converti au cours de la reception
// - cout_revient_xof : prix d'achat + part des couts d'approche (fige a la
//   validation, Lot 2) ; repli sur le prix d'achat pour les receptions du Lot 1.

const arr2 = (n) => Math.round(n * 100) / 100;
const pct = (nouveau, ancien) => (ancien > 0 ? Math.round(((nouveau - ancien) / ancien) * 10000) / 100 : null);

const SELECT_ACHATS = `
  SELECT l.id AS ligne_id, r.id AS reception_id, r.numero, r.date_reception, r.date_validation,
         r.fournisseur_id, f.nom AS fournisseur_nom, r.devise, r.cours_devise, r.incoterm,
         l.produit_id, l.reference_fournisseur, l.designation, l.unite, l.quantite, l.prix_unitaire_devise,
         ROUND(l.prix_unitaire_devise * r.cours_devise, 2) AS prix_achat_xof,
         COALESCE(l.cout_revient_unitaire_xof, ROUND(l.prix_unitaire_devise * r.cours_devise, 2)) AS cout_revient_xof,
         ROUND(cl.prix_unitaire_devise * cf.cours_devise, 2) AS engage_xof,
         ROUND(co.prix_unitaire_devise * co.cours_devise, 2) AS offert_xof,
         cf.numero AS commande_numero
  FROM reception_ligne l
  JOIN reception_marchandise r ON r.id = l.reception_id
  JOIN fournisseur f ON f.id = r.fournisseur_id
  LEFT JOIN commande_fournisseur_ligne cl ON cl.id = l.commande_ligne_id
  LEFT JOIN commande_fournisseur cf ON cf.id = cl.commande_id
  LEFT JOIN calcul_offre co ON co.id = cl.calcul_offre_id`;

function formaterAchat(x) {
  return {
    ligne_id: x.ligne_id,
    reception_id: x.reception_id,
    numero: x.numero,
    date: x.date_reception,
    fournisseur_id: x.fournisseur_id,
    fournisseur_nom: x.fournisseur_nom,
    devise: x.devise,
    cours_devise: Number(x.cours_devise),
    incoterm: x.incoterm,
    produit_id: x.produit_id,
    quantite: Number(x.quantite),
    unite: x.unite,
    prix_unitaire_devise: Number(x.prix_unitaire_devise),
    prix_achat_xof: Number(x.prix_achat_xof),
    cout_revient_xof: Number(x.cout_revient_xof),
    // Prix unique : offert (Dossier de calcul) -> engage (commande) -> paye (= prix_achat_xof).
    offert_xof: x.offert_xof === null || x.offert_xof === undefined ? null : Number(x.offert_xof),
    engage_xof: x.engage_xof === null || x.engage_xof === undefined ? null : Number(x.engage_xof),
    commande_numero: x.commande_numero || null,
  };
}

// Achats valides de l'article (ou de tous les articles), du plus ancien au plus recent.
async function chargerAchats(tenantId, { produitId, produitIds, fournisseurId } = {}) {
  const valeurs = [tenantId];
  const cond = ["r.tenant_id = $1", "r.statut = 'VALIDEE'", "l.produit_id IS NOT NULL"];
  if (produitId) {
    valeurs.push(produitId);
    cond.push(`l.produit_id = $${valeurs.length}`);
  }
  if (produitIds) {
    valeurs.push(produitIds);
    cond.push(`l.produit_id = ANY($${valeurs.length}::uuid[])`);
  }
  if (fournisseurId) {
    valeurs.push(fournisseurId);
    cond.push(`r.fournisseur_id = $${valeurs.length}`);
  }
  const r = await db.query(
    `${SELECT_ACHATS} WHERE ${cond.join(" AND ")}
     ORDER BY r.date_reception ASC, r.date_validation ASC NULLS LAST, r.numero ASC, l.ordre ASC`,
    valeurs
  );
  return r.rows.map(formaterAchat);
}

// Ajoute a chaque achat la variation (%) par rapport a l'achat precedent du
// MEME fournisseur pour le MEME article (achats tries chronologiquement).
function ajouterVariations(achats) {
  const dernier = new Map();
  return achats.map((a) => {
    const cle = `${a.produit_id}|${a.fournisseur_id}`;
    const prec = dernier.get(cle);
    dernier.set(cle, a);
    return {
      ...a,
      variation_prix_pct: prec ? pct(a.prix_achat_xof, prec.prix_achat_xof) : null,
      variation_cout_pct: prec ? pct(a.cout_revient_xof, prec.cout_revient_xof) : null,
    };
  });
}

// Statistiques par couple (article, fournisseur).
function syntheseParFournisseur(achatsAvecVariation) {
  const groupes = new Map();
  for (const a of achatsAvecVariation) {
    const cle = `${a.produit_id}|${a.fournisseur_id}`;
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(a);
  }
  const lignes = [];
  for (const achats of groupes.values()) {
    const dernier = achats[achats.length - 1];
    const prix = achats.map((a) => a.prix_achat_xof);
    lignes.push({
      produit_id: dernier.produit_id,
      fournisseur_id: dernier.fournisseur_id,
      fournisseur_nom: dernier.fournisseur_nom,
      nb_achats: achats.length,
      dernier_achat: {
        date: dernier.date,
        numero: dernier.numero,
        reception_id: dernier.reception_id,
        prix_achat_xof: dernier.prix_achat_xof,
        cout_revient_xof: dernier.cout_revient_xof,
        devise: dernier.devise,
        prix_unitaire_devise: dernier.prix_unitaire_devise,
      },
      variation_prix_pct: dernier.variation_prix_pct,
      variation_cout_pct: dernier.variation_cout_pct,
      prix_min_xof: Math.min(...prix),
      prix_max_xof: Math.max(...prix),
      prix_moyen_xof: arr2(prix.reduce((s, p) => s + p, 0) / prix.length),
    });
  }
  return lignes;
}

// Marque, pour chaque article, le fournisseur dont le DERNIER prix d'achat est le plus bas.
function marquerMeilleurs(lignes) {
  const meilleur = new Map();
  for (const l of lignes) {
    const cur = meilleur.get(l.produit_id);
    if (!cur || l.dernier_achat.prix_achat_xof < cur) meilleur.set(l.produit_id, l.dernier_achat.prix_achat_xof);
  }
  return lignes.map((l) => {
    const m = meilleur.get(l.produit_id);
    return {
      ...l,
      est_meilleur: l.dernier_achat.prix_achat_xof === m,
      ecart_meilleur_pct: pct(l.dernier_achat.prix_achat_xof, m),
    };
  });
}

// Dernier achat valide (par article) chez un fournisseur donne ; sert a
// afficher l'ecart d'une nouvelle facture/offre par rapport au dernier achat.
// `avant` = { date, validation } pour ne regarder que ce qui precede une reception deja validee.
async function derniersAchatsFournisseur(tenantId, fournisseurId, produitIds, avant) {
  if (!produitIds.length) return new Map();
  const valeurs = [tenantId, fournisseurId, produitIds];
  let cond = "";
  if (avant && avant.date) {
    valeurs.push(avant.date, avant.validation || null);
    cond = ` AND (r.date_reception < $4 OR (r.date_reception = $4 AND r.date_validation < COALESCE($5, 'infinity'::timestamptz)))`;
  }
  const r = await db.query(
    `SELECT DISTINCT ON (l.produit_id) l.produit_id, r.numero, r.date_reception,
            ROUND(l.prix_unitaire_devise * r.cours_devise, 2) AS prix_achat_xof
     FROM reception_ligne l
     JOIN reception_marchandise r ON r.id = l.reception_id
     WHERE r.tenant_id = $1 AND r.fournisseur_id = $2 AND r.statut = 'VALIDEE' AND l.produit_id = ANY($3::uuid[])${cond}
     ORDER BY l.produit_id, r.date_reception DESC, r.date_validation DESC NULLS LAST, r.numero DESC`,
    valeurs
  );
  return new Map(r.rows.map((x) => [x.produit_id, { numero: x.numero, date: x.date_reception, prix_achat_xof: Number(x.prix_achat_xof) }]));
}

module.exports = { chargerAchats, ajouterVariations, syntheseParFournisseur, marquerMeilleurs, derniersAchatsFournisseur, pct, arr2 };
