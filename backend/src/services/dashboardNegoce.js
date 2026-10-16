const db = require("../db");
const valoStock = require("./valorisationStock");

// ----------------------------------------------------------------------------
// Tableau de bord Negoce (Pack Commerce, lot 3, 16/10/2026).
// Chiffres lisibles dans les donnees existantes, sans regle inventee :
//  - ventes : factures non annulees de la periode (caisse + facturation classique) ;
//  - encaisse : encaissements de caisse + factures classiques marquees payees dans la periode ;
//  - creances : factures impayees (net a payer - encaisse), en retard si echeance depassee ;
//  - stock : somme des mouvements ; valeur au cout de revient courant du produit ;
//  - marge estimee : CA HT des lignes rattachees a un produit - quantite x cout de revient courant
//    (approximation ; la valorisation CMUP/FIFO du lot stock l'affinera).
// ----------------------------------------------------------------------------

const arr = (n) => Math.round(Number(n) || 0);
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ajouterJours = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function bornes(periode, ref = new Date()) {
  const fin = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let debut;
  if (periode === "JOUR") debut = fin;
  else if (periode === "SEMAINE") debut = ajouterJours(fin, -((fin.getDay() + 6) % 7)); // lundi
  else if (periode === "ANNEE") debut = new Date(fin.getFullYear(), 0, 1);
  else debut = new Date(fin.getFullYear(), fin.getMonth(), 1);
  // periode precedente de meme duree (pour la comparaison)
  const jours = Math.round((fin - debut) / 86400000) + 1;
  let precDebut, precFin;
  if (periode === "ANNEE") { precDebut = new Date(fin.getFullYear() - 1, 0, 1); precFin = new Date(fin.getFullYear() - 1, fin.getMonth(), fin.getDate()); }
  else if (periode === "MOIS") { precDebut = new Date(fin.getFullYear(), fin.getMonth() - 1, 1); precFin = new Date(fin.getFullYear(), fin.getMonth() - 1, Math.min(fin.getDate(), new Date(fin.getFullYear(), fin.getMonth(), 0).getDate())); }
  else { precFin = ajouterJours(debut, -1); precDebut = ajouterJours(precFin, -(jours - 1)); }
  return { debut: iso(debut), fin: iso(fin), prec_debut: iso(precDebut), prec_fin: iso(precFin), aujourdhui: iso(fin) };
}

async function calculer(tenantId, periodeBrute) {
  const periode = ["JOUR", "SEMAINE", "MOIS", "ANNEE"].includes(periodeBrute) ? periodeBrute : "MOIS";
  const b = bornes(periode);

  const ventes = (await db.query(
    `SELECT COUNT(*)::int AS nb, COALESCE(SUM(total_ht - montant_remise),0) AS ht, COALESCE(SUM(total_ttc),0) AS ttc,
            COALESCE(SUM(total_ttc) FILTER (WHERE origine = 'CAISSE'),0) AS ttc_caisse,
            COUNT(*) FILTER (WHERE origine = 'CAISSE')::int AS nb_caisse
     FROM facture_vente WHERE tenant_id = $1 AND statut <> 'ANNULEE' AND date_facture BETWEEN $2 AND $3`,
    [tenantId, b.debut, b.fin]
  )).rows[0];
  const prec = (await db.query(
    `SELECT COALESCE(SUM(total_ttc),0) AS ttc FROM facture_vente
     WHERE tenant_id = $1 AND statut <> 'ANNULEE' AND date_facture BETWEEN $2 AND $3`,
    [tenantId, b.prec_debut, b.prec_fin]
  )).rows[0];
  // Avoirs clients (lot 6c) : le chiffre d'affaires est net des avoirs emis dans la periode.
  const sommeAvoirs = async (d1, d2) => (await db.query(
    `SELECT COALESCE(SUM(total_ht),0) AS ht, COALESCE(SUM(total_ttc),0) AS ttc, COUNT(*)::int AS nb
     FROM avoir_vente WHERE tenant_id = $1 AND date_avoir BETWEEN $2 AND $3`, [tenantId, d1, d2])).rows[0];
  const av = await sommeAvoirs(b.debut, b.fin);
  const avPrec = await sommeAvoirs(b.prec_debut, b.prec_fin);
  ventes.ht = Number(ventes.ht) - Number(av.ht);
  ventes.ttc = Number(ventes.ttc) - Number(av.ttc);
  prec.ttc = Number(prec.ttc) - Number(avPrec.ttc);

  // Evolution : quotidienne (7 derniers jours minimum) ou mensuelle pour l'annee
  let evolution;
  if (periode === "ANNEE") {
    const r = await db.query(
      `SELECT EXTRACT(MONTH FROM date_facture)::int AS m, COALESCE(SUM(total_ttc),0) AS ttc
       FROM facture_vente WHERE tenant_id = $1 AND statut <> 'ANNULEE' AND date_facture BETWEEN $2 AND $3 GROUP BY 1`,
      [tenantId, b.debut, b.fin]
    );
    const map = new Map(r.rows.map((x) => [x.m, Number(x.ttc)]));
    const ra = await db.query(
      `SELECT EXTRACT(MONTH FROM date_avoir)::int AS m, COALESCE(SUM(total_ttc),0) AS ttc FROM avoir_vente WHERE tenant_id = $1 AND date_avoir BETWEEN $2 AND $3 GROUP BY 1`,
      [tenantId, b.debut, b.fin]
    );
    for (const x of ra.rows) map.set(x.m, (map.get(x.m) || 0) - Number(x.ttc));
    const moisFin = Number(b.fin.slice(5, 7));
    evolution = Array.from({ length: moisFin }, (_, i) => ({ cle: `${b.fin.slice(0, 4)}-${pad(i + 1)}`, libelle: pad(i + 1), valeur: arr(map.get(i + 1) || 0) }));
  } else {
    const debutSerie = periode === "JOUR" ? iso(ajouterJours(new Date(b.fin + "T12:00:00"), -6)) : b.debut;
    const r = await db.query(
      `SELECT to_char(date_facture,'YYYY-MM-DD') AS j, COALESCE(SUM(total_ttc),0) AS ttc
       FROM facture_vente WHERE tenant_id = $1 AND statut <> 'ANNULEE' AND date_facture BETWEEN $2 AND $3 GROUP BY 1`,
      [tenantId, debutSerie, b.fin]
    );
    const map = new Map(r.rows.map((x) => [x.j, Number(x.ttc)]));
    const ra = await db.query(
      `SELECT to_char(date_avoir,'YYYY-MM-DD') AS j, COALESCE(SUM(total_ttc),0) AS ttc FROM avoir_vente WHERE tenant_id = $1 AND date_avoir BETWEEN $2 AND $3 GROUP BY 1`,
      [tenantId, debutSerie, b.fin]
    );
    for (const x of ra.rows) map.set(x.j, (map.get(x.j) || 0) - Number(x.ttc));
    evolution = [];
    for (let d = new Date(debutSerie + "T12:00:00"); iso(d) <= b.fin; d = ajouterJours(d, 1)) {
      evolution.push({ cle: iso(d), libelle: pad(d.getDate()), valeur: arr(map.get(iso(d)) || 0) });
    }
  }

  // Encaissements (caisse par mode + factures classiques payees dans la periode)
  const caisse = (await db.query(
    `SELECT mode_libelle AS mode, COUNT(*)::int AS nb, COALESCE(SUM(montant),0) AS montant
     FROM encaissement_caisse WHERE tenant_id = $1 AND date_encaissement::date BETWEEN $2 AND $3
     GROUP BY mode_libelle ORDER BY 3 DESC`,
    [tenantId, b.debut, b.fin]
  )).rows;
  const manuel = (await db.query(
    `SELECT COALESCE(mode_paiement,'—') AS mode, COUNT(*)::int AS nb, COALESCE(SUM(montant_encaisse - montant_avoir_impute),0) AS montant
     FROM facture_vente WHERE tenant_id = $1 AND origine = 'MANUEL' AND statut = 'PAYEE' AND montant_encaisse > 0 AND date_paiement::date BETWEEN $2 AND $3
     GROUP BY 1 ORDER BY 3 DESC`,
    [tenantId, b.debut, b.fin]
  )).rows;
  const parMode = new Map();
  // Remboursements d'avoirs de la periode : sorties de tresorerie, deduites du mode utilise.
  const rembs = (await db.query(
    `SELECT COALESCE(mode_libelle,'—') AS mode, COUNT(*)::int AS nb, -COALESCE(SUM(montant_rembourse),0) AS montant
     FROM avoir_vente WHERE tenant_id = $1 AND montant_rembourse > 0 AND date_avoir BETWEEN $2 AND $3 GROUP BY 1`,
    [tenantId, b.debut, b.fin]
  )).rows.map((r) => ({ ...r, nb: 0 }));
  for (const r of [...caisse, ...manuel, ...rembs]) {
    const libelle = r.mode || "—";
    const k = libelle.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const x = parMode.get(k) || { mode: libelle.charAt(0).toUpperCase() + libelle.slice(1), nb: 0, montant: 0 };
    x.nb += r.nb; x.montant += Number(r.montant); parMode.set(k, x);
  }
  const encaissements = [...parMode.values()].map((x) => ({ ...x, montant: arr(x.montant) })).sort((a, c) => c.montant - a.montant);

  // Creances clients
  const cre = (await db.query(
    `SELECT f.id, f.numero, f.date_facture, COALESCE(f.date_echeance, f.date_facture) AS echeance, cl.nom AS client, cl.est_comptoir,
            f.montant_net_a_payer - f.montant_encaisse AS du
     FROM facture_vente f JOIN client_commercial cl ON cl.id = f.client_commercial_id
     WHERE f.tenant_id = $1 AND f.statut = 'IMPAYEE' AND f.montant_net_a_payer - f.montant_encaisse > 0.5`,
    [tenantId]
  )).rows;
  let total = 0, retard = 0;
  const tranches = { A_ECHOIR: 0, J0_30: 0, J31_60: 0, J60_PLUS: 0 };
  const parClient = new Map();
  for (const f of cre) {
    const du = Number(f.du);
    total += du;
    const ech = String(f.echeance instanceof Date ? iso(f.echeance) : f.echeance).slice(0, 10);
    const jours = Math.round((new Date(b.aujourdhui + "T12:00:00") - new Date(ech + "T12:00:00")) / 86400000);
    if (jours <= 0) tranches.A_ECHOIR += du;
    else { retard += du; if (jours <= 30) tranches.J0_30 += du; else if (jours <= 60) tranches.J31_60 += du; else tranches.J60_PLUS += du; }
    const c = parClient.get(f.client) || { client: f.client, du: 0, nb: 0, retard: 0 };
    c.du += du; c.nb++; if (jours > 0) c.retard += du; parClient.set(f.client, c);
  }
  const topDebiteurs = [...parClient.values()].sort((a, c) => c.du - a.du).slice(0, 5).map((c) => ({ ...c, du: arr(c.du), retard: arr(c.retard) }));

  // Stock (valorisation selon la methode de l'entreprise : CMUP / FIFO / dernier cout)
  const vs = await valoStock.valoriserTout(db, tenantId);
  let valeurStock = vs.total_valeur, ruptures = 0, faibles = 0, negatifs = 0;
  const alertes = [];
  for (const p of vs.lignes) {
    if (!p.actif) continue;
    if (p.quantite < 0) negatifs++;
    if (p.etat === "RUPTURE") { ruptures++; alertes.push({ id: p.produit_id, reference: p.reference, designation: p.designation, stock: p.quantite, etat: "RUPTURE" }); }
    else if (p.etat === "FAIBLE") { faibles++; alertes.push({ id: p.produit_id, reference: p.reference, designation: p.designation, stock: p.quantite, etat: "FAIBLE" }); }
  }
  const stockRows = vs.lignes.filter((p) => p.actif);
  alertes.sort((a, c) => a.stock - c.stock);

  // Top produits + marge estimee de la periode
  const lignes = (await db.query(
    `SELECT l.produit_id, MAX(l.designation) AS designation, SUM(l.quantite) AS qte, SUM(l.montant_ht) AS ca_ht,
            MAX(p.cout_revient_unitaire_xof) AS cout
     FROM facture_vente_ligne l JOIN facture_vente f ON f.id = l.facture_vente_id
     LEFT JOIN produit p ON p.id = l.produit_id
     WHERE f.tenant_id = $1 AND f.statut <> 'ANNULEE' AND f.date_facture BETWEEN $2 AND $3 AND l.non_chiffre = false
     GROUP BY l.produit_id, CASE WHEN l.produit_id IS NULL THEN l.designation END`,
    [tenantId, b.debut, b.fin]
  )).rows;
  let caCouvert = 0, coutCouvert = 0;
  const top = lignes.map((l) => {
    const ca = Number(l.ca_ht), qte = Number(l.qte);
    const cout = l.produit_id && l.cout !== null ? qte * Number(l.cout) : null;
    if (cout !== null && Number(l.cout) > 0) { caCouvert += ca; coutCouvert += cout; }
    return { designation: l.designation, qte: Math.round(qte * 100) / 100, ca_ht: arr(ca), marge: cout !== null && Number(l.cout) > 0 ? arr(ca - cout) : null };
  }).sort((a, c) => c.ca_ht - a.ca_ht).slice(0, 5);
  const marge = caCouvert > 0 ? { montant: arr(caCouvert - coutCouvert), taux: Math.round(((caCouvert - coutCouvert) / caCouvert) * 1000) / 10, ca_couvert: arr(caCouvert) } : null;

  // Livraisons en attente (BL brouillon) et achats en cours
  const bl = (await db.query(
    `SELECT COUNT(*)::int AS nb, MIN(date_bl) AS plus_ancien FROM bon_livraison WHERE tenant_id = $1 AND statut = 'BROUILLON'`,
    [tenantId]
  )).rows[0];
  const achats = (await db.query(
    `SELECT COUNT(*)::int AS nb, MIN(c.date_livraison_prevue) AS prochaine,
            COUNT(*) FILTER (WHERE c.date_livraison_prevue < CURRENT_DATE)::int AS en_retard
     FROM commande_fournisseur c
     WHERE c.tenant_id = $1 AND c.statut = 'CONFIRMEE' AND EXISTS (
       SELECT 1 FROM commande_fournisseur_ligne l WHERE l.commande_id = c.id AND l.quantite >
         COALESCE((SELECT SUM(rl.quantite) FROM reception_ligne rl JOIN reception_marchandise r ON r.id = rl.reception_id
                   WHERE rl.commande_ligne_id = l.id AND r.statut = 'VALIDEE'), 0))`,
    [tenantId]
  )).rows[0];

  const activite = (await db.query(`SELECT (EXISTS (SELECT 1 FROM facture_vente WHERE tenant_id = $1 AND origine = 'CAISSE') OR EXISTS (SELECT 1 FROM produit WHERE tenant_id = $1 AND actif = true)) AS a`, [tenantId])).rows[0].a;
  const evol = Number(prec.ttc) > 0 ? Math.round(((Number(ventes.ttc) - Number(prec.ttc)) / Number(prec.ttc)) * 1000) / 10 : null;
  return {
    periode, bornes: b, activite,
    ventes: { nb: ventes.nb, ht: arr(ventes.ht), ttc: arr(ventes.ttc), nb_caisse: ventes.nb_caisse, ttc_caisse: arr(ventes.ttc_caisse), ttc_precedent: arr(prec.ttc), evolution_pct: evol, panier_moyen: ventes.nb > 0 ? arr(Number(ventes.ttc) / ventes.nb) : 0 },
    evolution,
    encaissements: { total: encaissements.reduce((s, x) => s + x.montant, 0), par_mode: encaissements },
    creances: { total: arr(total), en_retard: arr(retard), nb: cre.length, tranches: Object.fromEntries(Object.entries(tranches).map(([k, v]) => [k, arr(v)])), top_debiteurs: topDebiteurs },
    stock: { nb_produits: stockRows.length, valeur: arr(valeurStock), ruptures, faibles, negatifs, alertes: alertes.slice(0, 8), seuil_faible: vs.seuil_defaut, methode_valorisation: vs.methode },
    top_produits: top,
    marge,
    livraisons_en_attente: { nb: bl.nb, plus_ancien: bl.plus_ancien ? iso(new Date(bl.plus_ancien)) : null },
    achats_en_cours: { nb: achats.nb, en_retard: achats.en_retard, prochaine: achats.prochaine ? iso(new Date(achats.prochaine)) : null },
  };
}

module.exports = { calculer, bornes };
