const db = require("../db");

const arr2 = (n) => Math.round(n * 100) / 100;
const MODES_TRANSPORT = ["MER", "AIR", "ROUTE", "MIXTE", "AUTRE"];
const STATUTS_COTATION = ["RECUE", "RETENUE", "REFUSEE"];

// Validite d'une cotation, toujours calculee a la lecture (jamais stockee).
function validiteCotation(dateValidite, aujourdhui = new Date()) {
  if (!dateValidite) return { statut_validite: "SANS_ECHEANCE", jours_restants: null };
  const fin = new Date(String(dateValidite).slice(0, 10) + "T00:00:00Z");
  const jour = new Date(aujourdhui.toISOString().slice(0, 10) + "T00:00:00Z");
  const jours = Math.round((fin - jour) / 86400000);
  return { statut_validite: jours < 0 ? "EXPIREE" : "VALIDE", jours_restants: jours };
}

// Total d'une cotation en XOF (montants dans la devise de la cotation).
function totalCotationXof(cotation, lignes) {
  const cours = Number(cotation.cours_devise) || 1;
  return arr2(lignes.reduce((s, l) => s + (Number(l.montant) || 0) * cours, 0));
}

// Couts d'approche proposes pour une reception a partir d'une cotation.
// Meme devise que la facture (hors XOF) : montant conserve en devise ; sinon
// converti en XOF avec le cours de la cotation. montant_cote_xof est fige pour
// mesurer plus tard l'ecart entre la cotation et la facture reelle.
function coutsDepuisCotation(cotation, lignes, deviseReception) {
  const cours = Number(cotation.cours_devise) || 1;
  const memeDevise = cotation.devise !== "XOF" && cotation.devise === String(deviseReception || "XOF").toUpperCase();
  return lignes.map((l) => {
    const montant = Number(l.montant) || 0;
    return {
      type_cout: l.type_cout,
      libelle: l.libelle || null,
      montant: memeDevise ? arr2(montant) : arr2(montant * cours),
      en_devise_facture: memeDevise,
      repartition: l.repartition || "VALEUR",
      transitaire_id: cotation.transitaire_id,
      montant_cote_xof: arr2(montant * cours),
    };
  });
}

// Statistiques de performance : receptions validees rattachees au transitaire
// + historique des dossiers AO (transitaire_historique). Un seul calcul pour
// la page Transitaires, la page Logistique et la comparaison de cotations.
async function statsTransitaires(tenantId, transitaireId = null) {
  const params = [tenantId];
  let filtre = "";
  if (transitaireId) {
    params.push(transitaireId);
    filtre = " AND tr.id = $2";
  }
  const base = (
    await db.query(
      `SELECT tr.id, tr.nom, tr.email, tr.telephone, tr.notes, tr.actif, tr.contact_json
       FROM transitaire tr WHERE tr.tenant_id = $1${filtre} ORDER BY tr.nom ASC`,
      params
    )
  ).rows;
  if (base.length === 0) return [];
  const ids = base.map((b) => b.id);

  const rec = (
    await db.query(
      `SELECT r.transitaire_id AS id,
              COUNT(*)::int AS nb,
              COUNT(*) FILTER (WHERE r.date_expedition IS NOT NULL)::int AS nb_delai,
              COALESCE(SUM(r.date_reception - r.date_expedition) FILTER (WHERE r.date_expedition IS NOT NULL), 0)::int AS somme_delai,
              COUNT(*) FILTER (WHERE r.date_arrivee_prevue IS NOT NULL)::int AS nb_prevu,
              COUNT(*) FILTER (WHERE r.date_arrivee_prevue IS NOT NULL AND r.date_reception > r.date_arrivee_prevue)::int AS nb_retard
       FROM reception_marchandise r
       WHERE r.tenant_id = $1 AND r.statut = 'VALIDEE' AND r.transitaire_id = ANY($2)
       GROUP BY r.transitaire_id`,
      [tenantId, ids]
    )
  ).rows;
  const ao = (
    await db.query(
      `SELECT h.transitaire_id AS id,
              COUNT(*)::int AS nb,
              COUNT(h.delai_jours)::int AS nb_delai,
              COALESCE(SUM(h.delai_jours), 0)::int AS somme_delai,
              COUNT(*) FILTER (WHERE h.retard)::int AS nb_retard
       FROM transitaire_historique h
       WHERE h.transitaire_id = ANY($1)
       GROUP BY h.transitaire_id`,
      [ids]
    )
  ).rows;
  const couts = (
    await db.query(
      `SELECT c.transitaire_id AS id,
              COALESCE(SUM(c.montant * CASE WHEN c.en_devise_facture THEN r.cours_devise ELSE 1 END), 0) AS total_xof,
              COALESCE(SUM(c.montant * CASE WHEN c.en_devise_facture THEN r.cours_devise ELSE 1 END)
                       FILTER (WHERE c.montant_cote_xof IS NOT NULL), 0) AS reel_cote_xof,
              COALESCE(SUM(c.montant_cote_xof), 0) AS cote_xof
       FROM reception_cout_approche c
       JOIN reception_marchandise r ON r.id = c.reception_id
       WHERE c.tenant_id = $1 AND r.statut = 'VALIDEE' AND c.transitaire_id = ANY($2)
       GROUP BY c.transitaire_id`,
      [tenantId, ids]
    )
  ).rows;
  const cot = (
    await db.query(
      `SELECT transitaire_id AS id,
              COUNT(*)::int AS nb,
              COUNT(*) FILTER (WHERE statut = 'RETENUE')::int AS nb_retenues,
              COUNT(*) FILTER (WHERE statut <> 'REFUSEE' AND (date_validite IS NULL OR date_validite >= CURRENT_DATE))::int AS nb_valides
       FROM transitaire_cotation WHERE tenant_id = $1 AND transitaire_id = ANY($2) GROUP BY transitaire_id`,
      [tenantId, ids]
    )
  ).rows;
  const idx = (rows) => new Map(rows.map((r) => [r.id, r]));
  const mRec = idx(rec), mAo = idx(ao), mCout = idx(couts), mCot = idx(cot);

  return base.map((b) => {
    const r = mRec.get(b.id) || { nb: 0, nb_delai: 0, somme_delai: 0, nb_prevu: 0, nb_retard: 0 };
    const a = mAo.get(b.id) || { nb: 0, nb_delai: 0, somme_delai: 0, nb_retard: 0 };
    const c = mCout.get(b.id) || { total_xof: 0, reel_cote_xof: 0, cote_xof: 0 };
    const k = mCot.get(b.id) || { nb: 0, nb_retenues: 0, nb_valides: 0 };
    const nbDelai = r.nb_delai + a.nb_delai;
    const nbRetardBase = r.nb_prevu + a.nb;
    const cote = Number(c.cote_xof);
    return {
      ...b,
      nb_expeditions: r.nb + a.nb,
      nb_receptions: r.nb,
      nb_dossiers_ao: a.nb,
      delai_moyen_jours: nbDelai > 0 ? Math.round(((r.somme_delai + a.somme_delai) / nbDelai) * 10) / 10 : null,
      taux_retard_pct: nbRetardBase > 0 ? Math.round(((r.nb_retard + a.nb_retard) / nbRetardBase) * 1000) / 10 : null,
      total_couts_xof: arr2(Number(c.total_xof)),
      // Ecart entre ce qui a ete facture et ce qui avait ete cote (couts issus d'une cotation).
      ecart_cote_reel_pct: cote > 0 ? Math.round(((Number(c.reel_cote_xof) - cote) / cote) * 1000) / 10 : null,
      nb_cotations: k.nb,
      nb_cotations_retenues: k.nb_retenues,
      nb_cotations_valides: k.nb_valides,
    };
  });
}

module.exports = {
  MODES_TRANSPORT,
  STATUTS_COTATION,
  validiteCotation,
  totalCotationXof,
  coutsDepuisCotation,
  statsTransitaires,
};
