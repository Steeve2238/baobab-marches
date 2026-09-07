/**
 * Moteur de calcul du "Dossier de calcul" (prix de revient et marge).
 * Reproduit fidelement, colonne par colonne, la chaine de formules du
 * tableau Excel de Steeve (dossier CONSULTATION 26000/536/537 DN, prototype
 * approuve le 07/09/2026 - "le tableau me convient") : achat -> assurance ->
 * valeur en douane -> droits et taxes -> cout de revient -> marge cible ->
 * prix de vente -> frais bancaires sur le paiement fournisseur -> marge
 * nette reelle.
 *
 * Comme pour le reste de la plateforme (HT/TVA/TTC du module Ventes/Negoce),
 * RIEN de tout cela n'est stocke en base : seules les donnees d'ENTREE de
 * chaque offre (prix, devise, cours, quantite, fret, transit...) sont
 * persistees (voir migrations/021_dossier_calcul.sql) - cette fonction est
 * appelee a chaque lecture pour reconstruire l'integralite des colonnes
 * calculees, jamais fait confiance a un total envoye par le frontend.
 *
 * @param {object} offre - ligne calcul_offre : prix_unitaire_devise,
 *   cours_devise, quantite, fret_alloue_xof, frais_transit_xof,
 *   marge_cible_pct (peut etre null -> utilise le parametre tenant).
 * @param {object} parametres - tenant.parametres_calcul_prix_json (taux en
 *   decimal, ex 0.20 pour 20%) + tauxTvaVente (decimal, copie de
 *   tenant.taux_tva_pourcentage / 100 - le MEME taux que sur les devis).
 * @returns {object} toutes les colonnes calculees (voir noms ci-dessous),
 *   valeurs numeriques deja arrondies au centime le plus proche sauf
 *   prixUnitaireArrondi (arrondi au multiple de 100 XOF superieur, comme
 *   ROUNDUP(...,-2) dans Excel) et les deux pourcentages de marge (non
 *   arrondis, affichage en % cote frontend).
 */
function calculerOffre(offre, parametres) {
  const prixUnitaireDevise = Number(offre.prix_unitaire_devise) || 0;
  const coursDevise = Number(offre.cours_devise) || 0;
  const quantite = Number(offre.quantite) || 0;
  const fretAlloue = Number(offre.fret_alloue_xof) || 0;
  const fraisTransit = Number(offre.frais_transit_xof) || 0;
  const margeCible =
    offre.marge_cible_pct !== null && offre.marge_cible_pct !== undefined
      ? Number(offre.marge_cible_pct)
      : Number(parametres.margeCibleDefaut) || 0;

  // ACHAT
  const prixAchatUnitaireXof = prixUnitaireDevise * coursDevise;
  const prixAchatTotalXof = prixAchatUnitaireXof * quantite;

  // TRANSPORT, ASSURANCE & DOUANE
  const assurance = Number(parametres.tauxAssuranceFret) * (prixAchatTotalXof + fretAlloue);
  const valeurEnDouane = prixAchatTotalXof + fretAlloue + assurance;
  const droitDouane = valeurEnDouane * Number(parametres.tauxDroitDouane);
  const redevanceStatistique = valeurEnDouane * Number(parametres.tauxRedevanceStatistique);
  const pcs = valeurEnDouane * Number(parametres.tauxPCS);
  const pccCosec = valeurEnDouane * (Number(parametres.tauxPCC) + Number(parametres.tauxCOSEC));
  const baseTvaImport = valeurEnDouane + droitDouane + redevanceStatistique + pcs + pccCosec;
  const tvaImport = baseTvaImport * Number(parametres.tauxTvaImport);
  const totalDroitsTaxesDouane = droitDouane + redevanceStatistique + pcs + pccCosec + tvaImport;

  // COUT DE REVIENT & MARGE CIBLE
  const coutDeRevientHt = prixAchatTotalXof + fretAlloue + totalDroitsTaxesDouane + fraisTransit;
  const margeBrute = coutDeRevientHt * margeCible;
  const prixVenteTotalHt = coutDeRevientHt + margeBrute;

  // PRIX DE VENTE (DEVIS)
  const prixUnitaireHt = quantite > 0 ? prixVenteTotalHt / quantite : 0;
  const prixUnitaireArrondi = Math.ceil(prixUnitaireHt / 100) * 100;
  const montantTotalArrondiHt = prixUnitaireArrondi * quantite;
  const tvaVente = montantTotalArrondiHt * Number(parametres.tauxTvaVente);
  const totalTtc = montantTotalArrondiHt + tvaVente;

  // FRAIS BANCAIRES & CHANGE (paiement fournisseur)
  const montantATransfererFournisseur = prixAchatTotalXof;
  const commissionTthu = montantATransfererFournisseur * Number(parametres.tauxCommissionTTHU);
  const commissionDbs = Math.max(
    montantATransfererFournisseur * Number(parametres.tauxCommissionDBS),
    Number(parametres.commissionDbsMinimum)
  );
  const tafDbs = commissionDbs * Number(parametres.tauxTAF);
  const swift = Number(parametres.forfaitSwift);
  const tafSwift = swift * Number(parametres.tauxTAF);
  const timbre = Number(parametres.forfaitTimbre);
  const totalFraisBancaires = commissionTthu + commissionDbs + tafDbs + swift + tafSwift + timbre;

  // DECISION
  const margeNetteReelle = margeBrute - totalFraisBancaires;
  const margeNetteReellePct = coutDeRevientHt > 0 ? margeNetteReelle / coutDeRevientHt : 0;

  const arr2 = (n) => Math.round(n * 100) / 100;

  return {
    prixAchatUnitaireXof: arr2(prixAchatUnitaireXof),
    prixAchatTotalXof: arr2(prixAchatTotalXof),
    assurance: arr2(assurance),
    valeurEnDouane: arr2(valeurEnDouane),
    droitDouane: arr2(droitDouane),
    redevanceStatistique: arr2(redevanceStatistique),
    pcs: arr2(pcs),
    pccCosec: arr2(pccCosec),
    baseTvaImport: arr2(baseTvaImport),
    tvaImport: arr2(tvaImport),
    totalDroitsTaxesDouane: arr2(totalDroitsTaxesDouane),
    coutDeRevientHt: arr2(coutDeRevientHt),
    margeCiblePct: margeCible,
    margeBrute: arr2(margeBrute),
    prixVenteTotalHt: arr2(prixVenteTotalHt),
    prixUnitaireHt: arr2(prixUnitaireHt),
    prixUnitaireArrondi: arr2(prixUnitaireArrondi),
    montantTotalArrondiHt: arr2(montantTotalArrondiHt),
    tvaVente: arr2(tvaVente),
    totalTtc: arr2(totalTtc),
    montantATransfererFournisseur: arr2(montantATransfererFournisseur),
    commissionTthu: arr2(commissionTthu),
    commissionDbs: arr2(commissionDbs),
    tafDbs: arr2(tafDbs),
    swift: arr2(swift),
    tafSwift: arr2(tafSwift),
    timbre: arr2(timbre),
    totalFraisBancaires: arr2(totalFraisBancaires),
    margeNetteReelle: arr2(margeNetteReelle),
    margeNetteReellePct: margeNetteReellePct,
  };
}

module.exports = { calculerOffre };
