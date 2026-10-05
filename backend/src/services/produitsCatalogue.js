const db = require("../db");
const { calculerOffre } = require("./calculPrixEngine");

// Parametres de calcul du tenant (taux douaniers, TVA de vente...) - partages
// entre routes/calculPrix.js et le catalogue produits.
async function chargerParametres(tenantId) {
  const result = await db.query(`SELECT parametres_calcul_prix_json, taux_tva_pourcentage FROM tenant WHERE id = $1`, [
    tenantId,
  ]);
  const row = result.rows[0];
  return { ...row.parametres_calcul_prix_json, tauxTvaVente: Number(row.taux_tva_pourcentage) / 100 };
}

// Prix de vente unitaire HT = cout x (1 + marge), arrondi au multiple de 100
// superieur (meme regle que prixUnitaireArrondi du moteur de calcul).
function prixVenteDepuisCout(cout, marge) {
  const c = Number(cout) || 0;
  const m = Number(marge) || 0;
  if (c <= 0) return 0;
  return Math.ceil(Math.round(c * (1 + m) * 100) / 100 / 100) * 100;
}

// Offres retenues (une par article au maximum) avec leur contexte et leur
// cout de revient unitaire calcule par le moteur. Filtres optionnels :
// dossierCalculId, offreIds.
async function chargerOffresRetenues(tenantId, { dossierCalculId, offreIds } = {}) {
  const parametres = await chargerParametres(tenantId);
  const conditions = ["dc.tenant_id = $1", "co.retenue = true"];
  const valeurs = [tenantId];
  if (dossierCalculId) {
    valeurs.push(dossierCalculId);
    conditions.push(`dc.id = $${valeurs.length}`);
  }
  if (offreIds) {
    valeurs.push(offreIds);
    conditions.push(`co.id = ANY($${valeurs.length}::uuid[])`);
  }
  const result = await db.query(
    `SELECT co.*, ca.libelle AS article_libelle, dc.id AS dossier_calcul_id, dc.nom AS dossier_nom,
            f.nom AS fournisseur_nom, d.reference_externe AS dossier_ao_reference, d.intitule AS dossier_ao_intitule,
            cl.nom AS consultation_client_nom, cons.objet AS consultation_objet, p.id AS produit_id
     FROM calcul_offre co
     JOIN calcul_article ca ON ca.id = co.calcul_article_id
     JOIN dossier_calcul dc ON dc.id = ca.dossier_calcul_id
     LEFT JOIN fournisseur f ON f.id = co.fournisseur_id
     LEFT JOIN dossier_ao d ON d.id = dc.dossier_ao_id
     LEFT JOIN consultation cons ON cons.id = dc.consultation_id
     LEFT JOIN client_commercial cl ON cl.id = cons.client_commercial_id
     LEFT JOIN produit p ON p.source_offre_id = co.id AND p.tenant_id = dc.tenant_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY dc.date_creation DESC, ca.ordre_affichage ASC`,
    valeurs
  );
  return result.rows.map((o) => {
    const calcul = calculerOffre(o, parametres);
    const quantite = Number(o.quantite) || 0;
    const coutUnitaire = quantite > 0 ? Math.round((calcul.coutDeRevientHt / quantite) * 100) / 100 : 0;
    return {
      offre_id: o.id,
      libelle: o.article_libelle,
      dossier_calcul_id: o.dossier_calcul_id,
      dossier_nom: o.dossier_nom,
      rattachement: (o.dossier_ao_reference || o.dossier_ao_intitule)
        ? `AO ${o.dossier_ao_reference || o.dossier_ao_intitule}`
        : `${o.consultation_client_nom || ""}${o.consultation_objet ? ` - ${o.consultation_objet}` : ""}`.trim(),
      fournisseur_nom: o.fournisseur_nom,
      quantite,
      cout_revient_unitaire_xof: coutUnitaire,
      marge_pct: calcul.margeCiblePct,
      prix_vente_xof: prixVenteDepuisCout(coutUnitaire, calcul.margeCiblePct),
      deja_importe: !!o.produit_id,
      produit_id: o.produit_id || null,
    };
  });
}

function sourceLibelle(c) {
  const parties = [c.dossier_nom, c.fournisseur_nom].filter(Boolean);
  return parties.join(" · ").slice(0, 300);
}

module.exports = { chargerParametres, prixVenteDepuisCout, chargerOffresRetenues, sourceLibelle };
