// Simulateur de remise sur devis (09/10/2026).
// Calcule, sans rien ecrire, l'effet d'une remise sur le total du devis et sur la marge, a partir des
// lignes du devis (prix de vente) et de l'instantane du cout de revient unitaire pris au chiffrage.
// La remise est globale (comme a la facturation) et se repartit au prorata sur chaque ligne.

const MODES = ["POURCENTAGE", "MONTANT", "NET_TTC"];

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const r8 = (x) => Math.round(x * 1e8) / 1e8;

// Convertit la saisie (pourcentage, montant de remise HT, ou net TTC vise) en pourcentage de remise.
// Retourne { pourcentage } ou { erreur }.
function pourcentageDepuisSaisie(totalHt, tauxTva, mode, valeurBrute) {
  if (!MODES.includes(mode)) return { erreur: "MODE" };
  const valeur = Number(valeurBrute);
  if (valeurBrute === "" || valeurBrute === null || valeurBrute === undefined || !Number.isFinite(valeur) || valeur < 0) {
    return { erreur: "VALEUR" };
  }
  let pct;
  if (mode === "POURCENTAGE") pct = valeur;
  else if (totalHt <= 0) return { erreur: "TOTAL_NUL" };
  else if (mode === "MONTANT") pct = (valeur / totalHt) * 100;
  else {
    const netHt = valeur / (1 + Number(tauxTva) / 100);
    pct = ((totalHt - netHt) / totalHt) * 100;
  }
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { erreur: "BORNES" };
  return { pourcentage: r8(pct) };
}

function totauxPourPourcentage(totalHt, tauxTva, pct) {
  const montantRemise = r2(totalHt * (pct / 100));
  const totalHtNet = r2(totalHt - montantRemise);
  const montantTva = r2(totalHtNet * (Number(tauxTva) / 100));
  return { pourcentage_remise: pct, montant_remise: montantRemise, total_ht_net: totalHtNet, montant_tva: montantTva, total_ttc: r2(totalHtNet + montantTva) };
}

// lignes : lignes du devis (avec produit_id, cout_revient_unitaire_ht) ; produits : Map id -> { cout, marge_pct, reference }.
function analyserMarge(lignes, produits, pct, pctActuel) {
  const facteur = 1 - pct / 100;
  const facteurActuel = 1 - pctActuel / 100;
  let htCouvertActuel = 0, htCouvertNet = 0, coutTotal = 0, nbChiffrees = 0, nbAvecCout = 0;
  const detail = lignes.map((l) => {
    const chiffree = !l.non_chiffre;
    if (chiffree) nbChiffrees += 1;
    const cout = l.cout_revient_unitaire_ht === null || l.cout_revient_unitaire_ht === undefined ? null : Number(l.cout_revient_unitaire_ht);
    const quantite = Number(l.quantite);
    const ht = Number(l.montant_ht);
    const htNet = r2(ht * facteur);
    const htActuel = r2(ht * facteurActuel);
    const produit = l.produit_id ? produits.get(l.produit_id) : null;
    const base = {
      id: l.id, ordre: l.ordre, designation: l.designation, unite: l.unite, quantite, reference: l.reference || null,
      non_chiffre: !!l.non_chiffre, mention_prix: l.mention_prix || null,
      prix_unitaire_ht: Number(l.prix_unitaire_ht), montant_ht: ht, montant_ht_net: htNet,
      produit_id: l.produit_id || null, produit_actif: !!produit,
    };
    if (!chiffree || cout === null) return { ...base, cout_calculable: false };
    nbAvecCout += 1;
    const coutLigne = r2(cout * quantite);
    htCouvertActuel += htActuel; htCouvertNet += htNet; coutTotal += coutLigne;
    const coutActuel = produit && produit.cout !== null ? Number(produit.cout) : null;
    // marge_pct du catalogue = taux de marque sur le cout (0.25 = cout x 1.25) ; converti en marge sur prix de vente.
    const cible = produit && Number(produit.marge_pct) > 0 ? (Number(produit.marge_pct) / (1 + Number(produit.marge_pct))) * 100 : null;
    const margeActuelle = r2(htActuel - coutLigne);
    const margeApres = r2(htNet - coutLigne);
    return {
      ...base, cout_calculable: true,
      cout_unitaire: cout, cout_total: coutLigne,
      montant_ht_actuel: htActuel,
      marge_actuelle: margeActuelle, marge_apres: margeApres,
      marge_pct_actuelle: htActuel > 0 ? r2((margeActuelle / htActuel) * 100) : null,
      marge_pct_apres: htNet > 0 ? r2((margeApres / htNet) * 100) : null,
      cout_actuel_unitaire: coutActuel,
      ecart_cout_actuel_pct: coutActuel !== null && cout > 0 ? r2(((coutActuel - cout) / cout) * 100) : null,
      marge_cible_pct: cible === null ? null : r2(cible),
    };
  });
  const margeActuelle = r2(htCouvertActuel - coutTotal);
  const margeApres = r2(htCouvertNet - coutTotal);
  const resume = (marge, ht) => ({ marge, marge_pct: ht > 0 ? r2((marge / ht) * 100) : null });
  return {
    couverture: { lignes_chiffrees: nbChiffrees, lignes_avec_cout: nbAvecCout, ht_couvert: r2(htCouvertActuel / (facteurActuel || 1)) },
    cout_total: r2(coutTotal),
    actuel: nbAvecCout ? resume(margeActuelle, htCouvertActuel) : null,
    apres: nbAvecCout ? resume(margeApres, htCouvertNet) : null,
    lignes: detail,
  };
}

function simuler({ devis, lignes, produits, mode, valeur }) {
  const tauxTva = Number(devis.taux_tva_pourcentage);
  const totalHt = Number(devis.total_ht);
  const demande = pourcentageDepuisSaisie(totalHt, tauxTva, mode, valeur);
  if (demande.erreur) return { erreur: demande.erreur };
  const actuelPct = Number(devis.pourcentage_remise) || 0;
  const avantTotaux = totauxPourPourcentage(totalHt, tauxTva, actuelPct);
  const apresTotaux = totauxPourPourcentage(totalHt, tauxTva, demande.pourcentage);
  const marge = analyserMarge(lignes, produits, demande.pourcentage, actuelPct);
  return {
    mode, valeur: Number(valeur),
    total_ht: totalHt, taux_tva: tauxTva,
    actuel: { ...avantTotaux, marge: marge.actuel ? marge.actuel.marge : null, marge_pct: marge.actuel ? marge.actuel.marge_pct : null },
    simule: { ...apresTotaux, marge: marge.apres ? marge.apres.marge : null, marge_pct: marge.apres ? marge.apres.marge_pct : null },
    couverture: marge.couverture,
    cout_total: marge.cout_total,
    lignes: marge.lignes,
  };
}

// Marge brute (19/10/2026, analyse de marge a la validation du devis) : prix de vente net - cout d'ACHAT de la marchandise seul
// (composante ACHAT du detail du cout de revient). La marge « nette » est celle deja calculee : prix de vente net - cout de
// revient complet (achat + fret, assurance, douane, transit, frais de paiement...). Le detail n'existe que pour les articles dont
// le cout vient d'une reception validee ; une ligne dont le detail ne colle pas au cout du devis (a 1 XOF pres) est ecartee.
// A appeler apres l'ajout de detail_cout sur chaque ligne.
function ajouterMargeBrute(sim) {
  let htActuel = 0, htNet = 0, achat = 0, n = 0, nCout = 0;
  sim.lignes = sim.lignes.map((l) => {
    if (!l.cout_calculable) return l;
    nCout += 1;
    const d = l.detail_cout;
    if (!d || !d.composantes || d.composantes.ACHAT === undefined || Math.abs(Number(d.total) - Number(l.cout_unitaire)) > 1) return { ...l, cout_achat_unitaire: null };
    const achatUnitaire = Number(d.composantes.ACHAT);
    const achatLigne = r2(achatUnitaire * l.quantite);
    n += 1;
    htActuel += l.montant_ht_actuel; htNet += l.montant_ht_net; achat += achatLigne;
    return {
      ...l, cout_achat_unitaire: achatUnitaire,
      marge_brute_pct_actuelle: l.montant_ht_actuel > 0 ? r2(((l.montant_ht_actuel - achatLigne) / l.montant_ht_actuel) * 100) : null,
      marge_brute_pct_apres: l.montant_ht_net > 0 ? r2(((l.montant_ht_net - achatLigne) / l.montant_ht_net) * 100) : null,
    };
  });
  const resume = (ht) => ({ marge: r2(ht - achat), marge_pct: ht > 0 ? r2(((ht - achat) / ht) * 100) : null, ht_net: r2(ht) });
  sim.brute = n === 0 ? null : { lignes_avec_detail: n, lignes_avec_cout: nCout, cout_achat_total: r2(achat), actuel: resume(htActuel), simule: resume(htNet) };
  return sim;
}

module.exports = { MODES, simuler, pourcentageDepuisSaisie, totauxPourPourcentage, ajouterMargeBrute };
