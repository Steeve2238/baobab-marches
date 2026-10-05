/**
 * Referentiel des etats financiers SYSCOHADA revise (systeme normal) : bilan
 * et compte de resultat. Phase 4 du module Comptabilite (05/10/2026).
 *
 * Principe (valide sur les balances reelles, voir complement_04102026_tests_
 * anam_moteur_etats) : chaque compte est rattache a une ligne de l'etat par
 * son PREFIXE, le prefixe le plus long l'emportant. Les numeros de compte
 * pouvant avoir 4 a 10 chiffres selon l'entreprise, aucune longueur n'est
 * supposee. Pour le bilan, le sens du solde choisit la ligne (ex : un client
 * crediteur passe au passif, "avances recues").
 *
 * Regle : [prefixe, ligne si solde debiteur, ligne si solde crediteur, amort?]
 * - amort = true : le compte est un amortissement / une depreciation, porte en
 *   colonne "Amortissements et depreciations" de la ligne d'actif.
 */

// ---------------------------------------------------------------------------
// BILAN
// ---------------------------------------------------------------------------
const REGLES_BILAN_BRUT = [
  // Actif immobilise
  ["211", "AE"], ["212", "AF"], ["213", "AF"], ["214", "AF"], ["215", "AG"], ["216", "AG"], ["217", "AH"], ["218", "AH"], ["219", "AH"], ["21", "AF"],
  ["22", "AJ"],
  ["231", "AK"], ["232", "AK"], ["233", "AK"], ["237", "AK"], ["239", "AK"], ["23", "AK"],
  ["234", "AL"], ["235", "AL"], ["238", "AL"], ["2392", "AL"], ["2393", "AL"], ["2394", "AL"], ["2395", "AL"], ["2399", "AL"],
  ["24", "AM"], ["245", "AN"],
  ["25", "AP"], ["26", "AR"], ["27", "AS"],
  // Actif circulant HAO, stocks, creances
  ["485", "BA", "DH"], ["486", "BA", "DH"], ["488", "BA", "DH"],
  ["3", "BB"],
  ["40", "BH", "DJ"],
  ["41", "BI", "DI"], ["419", "BI", "DI"],
  ["42", "BJ", "DK"], ["43", "BJ", "DK"], ["44", "BJ", "DK"],
  ["45", "BJ", "DM"], ["46", "BJ", "DM"], ["47", "BJ", "DM"],
  ["478", "BU", "DV"], ["479", "BU", "DV"],
  ["48", "BJ", "DH"],
  // Tresorerie
  ["50", "BQ", "DR"], ["51", "BR", "DR"],
  ["52", "BS", "DR"], ["53", "BS", "DR"], ["54", "BS", "DR"], ["55", "BS", "DR"], ["56", "BS", "DR"], ["564", "BS", "DQ"], ["565", "BS", "DQ"], ["57", "BS", "DR"], ["58", "BS", "DR"],
  // Capitaux propres et dettes financieres
  ["10", "CA"], ["101", "CA"], ["102", "CA"], ["103", "CA"], ["104", "CA"], ["105", "CD"], ["106", "CE"], ["109", "CB"],
  ["11", "CG"], ["111", "CF"], ["112", "CF"], ["113", "CF"], ["118", "CG"],
  ["12", "CH"], ["13", "CI"], ["14", "CL"], ["15", "CM"],
  ["16", "DA"], ["17", "DB"], ["18", "DA"], ["19", "DC"],
  // Provisions pour risques a court terme
  ["499", "DN"],
];

// Amortissements et depreciations (colonne "Amort. et deprec." de l'actif)
const AMORTS_BASE = [
  ["2811", "AE"], ["2812", "AF"], ["2813", "AF"], ["2814", "AF"], ["2815", "AG"], ["2816", "AG"], ["2817", "AH"], ["2818", "AH"], ["2819", "AH"], ["281", "AF"],
  ["282", "AJ"],
  ["2831", "AK"], ["2832", "AK"], ["2833", "AK"], ["2837", "AK"], ["2839", "AK"], ["283", "AK"],
  ["2834", "AL"], ["2835", "AL"], ["2838", "AL"],
  ["284", "AM"], ["2845", "AN"],
];
// Depreciations des immobilisations : meme ventilation avec le prefixe 29
const DEPREC_IMMO = AMORTS_BASE.map(([p, l]) => ["29" + p.slice(2), l]).concat([["295", "AP"], ["296", "AR"], ["297", "AS"]]);
const AUTRES_DEPREC = [["39", "BB"], ["490", "BH"], ["491", "BI"], ["492", "BJ"], ["493", "BJ"], ["494", "BJ"], ["495", "BJ"], ["496", "BJ"], ["497", "BJ"], ["498", "BJ"], ["59", "BQ"], ["590", "BQ"]];

const REGLES_BILAN = [
  ...REGLES_BILAN_BRUT.map(([p, d, c]) => ({ p, d, c: c || d, amort: false })),
  ...[...AMORTS_BASE, ...DEPREC_IMMO, ...AUTRES_DEPREC].map(([p, l]) => ({ p, d: l, c: l, amort: true })),
];

// Ordre et libelles de l'actif. type : titre | ligne | total (somme de "somme")
const ACTIF = [
  { type: "titre", libelle: "ACTIF IMMOBILISÉ" },
  { type: "total", code: "AD", libelle: "Immobilisations incorporelles", somme: ["AE", "AF", "AG", "AH"], sousTotal: true },
  { type: "ligne", code: "AE", libelle: "Frais de développement et de prospection", retrait: 1 },
  { type: "ligne", code: "AF", libelle: "Brevets, licences, logiciels et droits similaires", retrait: 1 },
  { type: "ligne", code: "AG", libelle: "Fonds commercial et droit au bail", retrait: 1 },
  { type: "ligne", code: "AH", libelle: "Autres immobilisations incorporelles", retrait: 1 },
  { type: "total", code: "AI", libelle: "Immobilisations corporelles", somme: ["AJ", "AK", "AL", "AM", "AN"], sousTotal: true },
  { type: "ligne", code: "AJ", libelle: "Terrains", retrait: 1 },
  { type: "ligne", code: "AK", libelle: "Bâtiments", retrait: 1 },
  { type: "ligne", code: "AL", libelle: "Aménagements, agencements et installations", retrait: 1 },
  { type: "ligne", code: "AM", libelle: "Matériel, mobilier et actifs biologiques", retrait: 1 },
  { type: "ligne", code: "AN", libelle: "Matériel de transport", retrait: 1 },
  { type: "ligne", code: "AP", libelle: "Avances et acomptes versés sur immobilisations" },
  { type: "total", code: "AQ", libelle: "Immobilisations financières", somme: ["AR", "AS"], sousTotal: true },
  { type: "ligne", code: "AR", libelle: "Titres de participation", retrait: 1 },
  { type: "ligne", code: "AS", libelle: "Autres immobilisations financières", retrait: 1 },
  { type: "total", code: "AZ", libelle: "TOTAL ACTIF IMMOBILISÉ", somme: ["AD", "AI", "AP", "AQ"], fort: true },
  { type: "titre", libelle: "ACTIF CIRCULANT" },
  { type: "ligne", code: "BA", libelle: "Actif circulant HAO" },
  { type: "ligne", code: "BB", libelle: "Stocks et encours" },
  { type: "total", code: "BG", libelle: "Créances et emplois assimilés", somme: ["BH", "BI", "BJ"], sousTotal: true },
  { type: "ligne", code: "BH", libelle: "Fournisseurs, avances versées", retrait: 1 },
  { type: "ligne", code: "BI", libelle: "Clients", retrait: 1 },
  { type: "ligne", code: "BJ", libelle: "Autres créances", retrait: 1 },
  { type: "total", code: "BK", libelle: "TOTAL ACTIF CIRCULANT", somme: ["BA", "BB", "BG"], fort: true },
  { type: "titre", libelle: "TRÉSORERIE-ACTIF" },
  { type: "ligne", code: "BQ", libelle: "Titres de placement" },
  { type: "ligne", code: "BR", libelle: "Valeurs à encaisser" },
  { type: "ligne", code: "BS", libelle: "Banques, chèques postaux, caisse et assimilés" },
  { type: "total", code: "BT", libelle: "TOTAL TRÉSORERIE-ACTIF", somme: ["BQ", "BR", "BS"], fort: true },
  { type: "ligne", code: "BU", libelle: "Écart de conversion-Actif" },
  { type: "ligne", code: "NCA", libelle: "Comptes non classés (à vérifier)", nc: true },
  { type: "total", code: "BZ", libelle: "TOTAL GÉNÉRAL", somme: ["AZ", "BK", "BT", "BU", "NCA"], fort: true },
];

const PASSIF = [
  { type: "titre", libelle: "CAPITAUX PROPRES ET RESSOURCES ASSIMILÉES" },
  { type: "ligne", code: "CA", libelle: "Capital" },
  { type: "ligne", code: "CB", libelle: "Apporteurs capital non appelé (−)" },
  { type: "ligne", code: "CD", libelle: "Primes liées au capital social" },
  { type: "ligne", code: "CE", libelle: "Écarts de réévaluation" },
  { type: "ligne", code: "CF", libelle: "Réserves indisponibles" },
  { type: "ligne", code: "CG", libelle: "Réserves libres" },
  { type: "ligne", code: "CH", libelle: "Report à nouveau (+ ou −)" },
  { type: "ligne", code: "CI", libelle: "Résultat net de l'exercice (bénéfice + ou perte −)" },
  { type: "ligne", code: "CL", libelle: "Subventions d'investissement" },
  { type: "ligne", code: "CM", libelle: "Provisions réglementées et fonds assimilés" },
  { type: "total", code: "CP", libelle: "TOTAL CAPITAUX PROPRES", somme: ["CA", "CB", "CD", "CE", "CF", "CG", "CH", "CI", "CL", "CM"], fort: true },
  { type: "titre", libelle: "DETTES FINANCIÈRES ET RESSOURCES ASSIMILÉES" },
  { type: "ligne", code: "DA", libelle: "Emprunts et dettes financières diverses" },
  { type: "ligne", code: "DB", libelle: "Dettes de location-acquisition" },
  { type: "ligne", code: "DC", libelle: "Provisions pour risques et charges" },
  { type: "total", code: "DD", libelle: "TOTAL DETTES FINANCIÈRES ET RESSOURCES ASSIMILÉES", somme: ["DA", "DB", "DC"], fort: true },
  { type: "total", code: "DF", libelle: "TOTAL RESSOURCES STABLES", somme: ["CP", "DD"], fort: true },
  { type: "titre", libelle: "PASSIF CIRCULANT" },
  { type: "ligne", code: "DH", libelle: "Dettes circulantes HAO" },
  { type: "ligne", code: "DI", libelle: "Clients, avances reçues" },
  { type: "ligne", code: "DJ", libelle: "Fournisseurs d'exploitation" },
  { type: "ligne", code: "DK", libelle: "Dettes fiscales et sociales" },
  { type: "ligne", code: "DM", libelle: "Autres dettes" },
  { type: "ligne", code: "DN", libelle: "Provisions pour risques à court terme" },
  { type: "total", code: "DP", libelle: "TOTAL PASSIF CIRCULANT", somme: ["DH", "DI", "DJ", "DK", "DM", "DN"], fort: true },
  { type: "titre", libelle: "TRÉSORERIE-PASSIF" },
  { type: "ligne", code: "DQ", libelle: "Banques, crédits d'escompte" },
  { type: "ligne", code: "DR", libelle: "Banques, établissements financiers et crédits de trésorerie" },
  { type: "total", code: "DT", libelle: "TOTAL TRÉSORERIE-PASSIF", somme: ["DQ", "DR"], fort: true },
  { type: "ligne", code: "DV", libelle: "Écart de conversion-Passif" },
  { type: "ligne", code: "NCP", libelle: "Comptes non classés (à vérifier)", nc: true },
  { type: "total", code: "DZ", libelle: "TOTAL GÉNÉRAL", somme: ["DF", "DP", "DT", "DV", "NCP"], fort: true },
];

// ---------------------------------------------------------------------------
// COMPTE DE RESULTAT : [prefixe, ligne]. Les produits (classe 7 et 82, 84, 86,
// 88) comptent en positif, les charges en negatif ("contribution" au resultat).
// ---------------------------------------------------------------------------
const REGLES_RESULTAT = [
  ["60", "RA"], ["601", "RA"], ["602", "RC"], ["603", "RB"], ["6031", "RB"], ["6032", "RD"], ["6033", "RF"], ["604", "RE"], ["605", "RE"], ["608", "RE"], ["609", "RE"],
  ["61", "RG"], ["62", "RH"], ["63", "RH"], ["64", "RI"], ["65", "RJ"], ["66", "RK"], ["67", "RM"],
  ["68", "RL"], ["681", "RL"], ["687", "RN"], ["69", "RL"], ["691", "RL"], ["697", "RN"],
  ["70", "TA"], ["701", "TA"], ["702", "TB"], ["703", "TB"], ["704", "TB"], ["705", "TC"], ["706", "TC"], ["707", "TD"], ["708", "TD"],
  ["71", "TG"], ["72", "TF"], ["73", "TE"], ["75", "TH"], ["77", "TK"],
  ["78", "TI"], ["781", "TI"], ["787", "TM"],
  ["79", "TJ"], ["791", "TJ"], ["797", "TL"], ["798", "TJ"], ["799", "TJ"],
  ["81", "RO"], ["82", "TN"], ["83", "RP"], ["84", "TO"], ["85", "RP"], ["86", "TO"], ["87", "RQ"], ["88", "TO"], ["89", "RS"],
].map(([p, l]) => ({ p, l }));

// Ordre du compte de resultat. calc : formule des soldes intermediaires.
const RESULTAT = [
  { type: "ligne", code: "TA", libelle: "Ventes de marchandises" },
  { type: "ligne", code: "RA", libelle: "Achats de marchandises" },
  { type: "ligne", code: "RB", libelle: "Variation de stocks de marchandises" },
  { type: "solde", code: "XA", libelle: "MARGE COMMERCIALE", somme: ["TA", "RA", "RB"] },
  { type: "ligne", code: "TB", libelle: "Ventes de produits fabriqués" },
  { type: "ligne", code: "TC", libelle: "Travaux, services vendus" },
  { type: "ligne", code: "TD", libelle: "Produits accessoires" },
  { type: "solde", code: "XB", libelle: "CHIFFRE D'AFFAIRES", somme: ["TA", "TB", "TC", "TD"] },
  { type: "ligne", code: "TE", libelle: "Production stockée (ou déstockage)" },
  { type: "ligne", code: "TF", libelle: "Production immobilisée" },
  { type: "ligne", code: "TG", libelle: "Subventions d'exploitation" },
  { type: "ligne", code: "TH", libelle: "Autres produits" },
  { type: "ligne", code: "TI", libelle: "Transferts de charges d'exploitation" },
  { type: "ligne", code: "RC", libelle: "Achats de matières premières et fournitures liées" },
  { type: "ligne", code: "RD", libelle: "Variation de stocks de matières premières et fournitures liées" },
  { type: "ligne", code: "RE", libelle: "Autres achats" },
  { type: "ligne", code: "RF", libelle: "Variation de stocks d'autres approvisionnements" },
  { type: "ligne", code: "RG", libelle: "Transports" },
  { type: "ligne", code: "RH", libelle: "Services extérieurs" },
  { type: "ligne", code: "RI", libelle: "Impôts et taxes" },
  { type: "ligne", code: "RJ", libelle: "Autres charges" },
  { type: "solde", code: "XC", libelle: "VALEUR AJOUTÉE", somme: ["XB", "RA", "RB", "TE", "TF", "TG", "TH", "TI", "RC", "RD", "RE", "RF", "RG", "RH", "RI", "RJ"] },
  { type: "ligne", code: "RK", libelle: "Charges de personnel" },
  { type: "solde", code: "XD", libelle: "EXCÉDENT BRUT D'EXPLOITATION (EBE)", somme: ["XC", "RK"] },
  { type: "ligne", code: "TJ", libelle: "Reprises d'amortissements, provisions et dépréciations" },
  { type: "ligne", code: "RL", libelle: "Dotations aux amortissements, aux provisions et dépréciations" },
  { type: "solde", code: "XE", libelle: "RÉSULTAT D'EXPLOITATION", somme: ["XD", "TJ", "RL"] },
  { type: "ligne", code: "TK", libelle: "Revenus financiers et assimilés" },
  { type: "ligne", code: "TL", libelle: "Reprises de provisions et dépréciations financières" },
  { type: "ligne", code: "TM", libelle: "Transferts de charges financières" },
  { type: "ligne", code: "RM", libelle: "Frais financiers et charges assimilées" },
  { type: "ligne", code: "RN", libelle: "Dotations aux provisions et aux dépréciations financières" },
  { type: "solde", code: "XF", libelle: "RÉSULTAT FINANCIER", somme: ["TK", "TL", "TM", "RM", "RN"] },
  { type: "solde", code: "XG", libelle: "RÉSULTAT DES ACTIVITÉS ORDINAIRES", somme: ["XE", "XF"] },
  { type: "ligne", code: "TN", libelle: "Produits des cessions d'immobilisations" },
  { type: "ligne", code: "TO", libelle: "Autres produits HAO" },
  { type: "ligne", code: "RO", libelle: "Valeurs comptables des cessions d'immobilisations" },
  { type: "ligne", code: "RP", libelle: "Autres charges HAO" },
  { type: "solde", code: "XH", libelle: "RÉSULTAT HORS ACTIVITÉS ORDINAIRES", somme: ["TN", "TO", "RO", "RP"] },
  { type: "ligne", code: "RQ", libelle: "Participation des travailleurs" },
  { type: "ligne", code: "RS", libelle: "Impôts sur le résultat" },
  { type: "ligne", code: "NCR", libelle: "Comptes non classés (à vérifier)", nc: true },
  { type: "solde", code: "XI", libelle: "RÉSULTAT NET", somme: ["XG", "XH", "RQ", "RS", "NCR"], fort: true },
];

module.exports = { REGLES_BILAN, ACTIF, PASSIF, REGLES_RESULTAT, RESULTAT };
