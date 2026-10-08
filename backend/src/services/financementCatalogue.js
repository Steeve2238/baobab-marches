/**
 * Catalogue des facilites bancaires (Financement v2, 06/10/2026).
 *
 * Chaque type de facilite fournit un MODELE de lignes de frais : la structure
 * est deja prete, le client n'a plus qu'a saisir les taux de sa banque. Une
 * ligne sans taux est conservee (visible, a renseigner) mais comptee a 0 dans
 * les simulations, avec un avertissement.
 *
 * famille :
 *   CREANCE  : la banque rachete / avance sur une creance (affacturage, escompte).
 *              Le client recoit une avance, le reste de la creance revient plus tard.
 *   PRET     : la banque prete un montant a rembourser (tresorerie, relais, avance).
 *   GARANTIE : la banque ne verse rien, elle s'engage (caution, aval, lettre de
 *              credit, assurance) : seuls des frais sont dus.
 *
 * Les libelles affiches viennent du frontend (lib/i18n/financementDictionary.js) ;
 * le backend fournit des libelles par defaut pour les lignes creees depuis un modele.
 */

const LIGNE = (code, libelle, extra = {}) => ({
  code,
  libelle,
  nature: "COUT",
  mode_calcul: "POURCENT_FLAT",
  base: "CREANCE",
  periode: null,
  prelevement: "A_LA_MISE_EN_PLACE",
  soumis_taxe: true,
  frequence: "PAR_OPERATION",
  ...extra,
});

const FRAIS_DOSSIER = LIGNE("FRAIS_DOSSIER", "Frais de dossier", { mode_calcul: "FORFAIT" });
// Affacturage : frais de dossier et d'avenant, en general factures UNE fois par contrat (a confirmer avec la banque).
const FRAIS_DOSSIER_UNIQUE = LIGNE("FRAIS_DOSSIER", "Frais de dossier", { mode_calcul: "FORFAIT", frequence: "UNIQUE_CONTRAT" });
const FRAIS_AVENANT = LIGNE("FRAIS_AVENANT", "Frais sur avenant au contrat", { mode_calcul: "FORFAIT", frequence: "UNIQUE_CONTRAT" });
const TIMBRE = LIGNE("TIMBRE", "Droits de timbre", { mode_calcul: "FORFAIT", soumis_taxe: false });
const DEPOT_GARANTIE = LIGNE("DEPOT_GARANTIE", "Dépôt de garantie (somme bloquée)", {
  nature: "RETENUE",
  soumis_taxe: false,
});

const CAUTION = (libelle) => ({
  famille: "GARANTIE",
  champs: { avance: false, retenue: false, recours: false, debiteurs: false, domiciliation: true },
  lignes: [
    LIGNE("COM_CAUTION", "Commission de caution", {
      mode_calcul: "POURCENT_PAR_PERIODE",
      periode: "TRIMESTRE",
    }),
    LIGNE("COM_MISE_EN_PLACE", "Commission de mise en place", { mode_calcul: "POURCENT_FLAT" }),
    FRAIS_DOSSIER,
    TIMBRE,
    DEPOT_GARANTIE,
  ],
  libelle_defaut: libelle,
});

const TYPES = {
  AFFACTURAGE: {
    famille: "CREANCE",
    champs: { avance: true, retenue: true, recours: true, debiteurs: true, domiciliation: true },
    defauts: { taux_avance_pct: 90, retenue_incluse_avance: "A_CONFIRMER", recours: "AVEC_RECOURS_NOTIFIE", domiciliation_exigee: true, restreindre_debiteurs: true },
    lignes: [
      LIGNE("FONDS_GARANTIE", "Fonds de garantie", { nature: "RETENUE", soumis_taxe: false }),
      LIGNE("COM_AFFACTURAGE", "Commission d'affacturage", { mode_calcul: "POURCENT_FLAT" }),
      LIGNE("COM_FINANCEMENT", "Commission de financement", {
        mode_calcul: "POURCENT_ANNUEL",
        base: "AVANCE",
        prelevement: "A_L_ECHEANCE",
      }),
      LIGNE("FRAIS_GESTION", "Frais de gestion / recouvrement", { mode_calcul: "FORFAIT" }),
      FRAIS_DOSSIER_UNIQUE,
      FRAIS_AVENANT,
      TIMBRE,
    ],
  },
  ESCOMPTE: {
    famille: "CREANCE",
    champs: { avance: true, retenue: false, recours: true, debiteurs: true, domiciliation: true },
    defauts: { taux_avance_pct: 100, retenue_incluse_avance: "EN_PLUS" },
    lignes: [
      LIGNE("AGIO", "Agios d'escompte", { mode_calcul: "POURCENT_ANNUEL", base: "CREANCE" }),
      LIGNE("COM_ENDOSSEMENT", "Commission d'endos", { mode_calcul: "POURCENT_FLAT" }),
      LIGNE("COM_ENCAISSEMENT", "Commission d'encaissement", { mode_calcul: "POURCENT_FLAT", prelevement: "A_L_ECHEANCE" }),
      FRAIS_DOSSIER,
      TIMBRE,
    ],
  },
  CREDIT_TRESORERIE: {
    famille: "PRET",
    champs: { avance: true, retenue: false, recours: false, debiteurs: false, domiciliation: true },
    defauts: { taux_avance_pct: 100 },
    lignes: [
      LIGNE("INTERETS", "Intérêts", { mode_calcul: "POURCENT_ANNUEL", base: "AVANCE", prelevement: "A_L_ECHEANCE" }),
      LIGNE("COM_ENGAGEMENT", "Commission d'engagement", { mode_calcul: "POURCENT_FLAT" }),
      LIGNE("COM_MOUVEMENT", "Commission de plus fort découvert", { mode_calcul: "POURCENT_PAR_PERIODE", periode: "TRIMESTRE" }),
      FRAIS_DOSSIER,
      TIMBRE,
      DEPOT_GARANTIE,
    ],
  },
  CREDIT_RELAIS: {
    famille: "PRET",
    champs: { avance: true, retenue: false, recours: false, debiteurs: false, domiciliation: true },
    defauts: { taux_avance_pct: 100 },
    lignes: [
      LIGNE("INTERETS", "Intérêts", { mode_calcul: "POURCENT_ANNUEL", base: "AVANCE", prelevement: "A_L_ECHEANCE" }),
      LIGNE("COM_ENGAGEMENT", "Commission d'engagement", { mode_calcul: "POURCENT_FLAT" }),
      FRAIS_DOSSIER,
      TIMBRE,
      DEPOT_GARANTIE,
    ],
  },
  AVANCE_MARCHE: {
    famille: "PRET",
    champs: { avance: true, retenue: false, recours: false, debiteurs: false, domiciliation: true },
    defauts: { taux_avance_pct: 100, domiciliation_exigee: true },
    lignes: [
      LIGNE("INTERETS", "Intérêts", { mode_calcul: "POURCENT_ANNUEL", base: "AVANCE", prelevement: "A_L_ECHEANCE" }),
      LIGNE("COM_ENGAGEMENT", "Commission d'engagement", { mode_calcul: "POURCENT_FLAT" }),
      LIGNE("COM_SUIVI", "Commission de suivi du marché", { mode_calcul: "POURCENT_PAR_PERIODE", periode: "TRIMESTRE" }),
      FRAIS_DOSSIER,
      TIMBRE,
      DEPOT_GARANTIE,
    ],
  },
  LC_INTERNATIONAL: {
    famille: "GARANTIE",
    champs: { avance: false, retenue: false, recours: false, debiteurs: false, domiciliation: false },
    lignes: [
      LIGNE("COM_OUVERTURE", "Commission d'ouverture", { mode_calcul: "POURCENT_FLAT" }),
      LIGNE("COM_ENGAGEMENT", "Commission d'engagement", { mode_calcul: "POURCENT_PAR_PERIODE", periode: "TRIMESTRE" }),
      LIGNE("COM_CONFIRMATION", "Commission de confirmation", { mode_calcul: "POURCENT_PAR_PERIODE", periode: "TRIMESTRE" }),
      LIGNE("COM_LEVEE_DOCUMENTS", "Commission de levée des documents", { mode_calcul: "POURCENT_FLAT", prelevement: "A_L_ECHEANCE" }),
      LIGNE("SWIFT", "Frais SWIFT / télex", { mode_calcul: "FORFAIT" }),
      FRAIS_DOSSIER,
      DEPOT_GARANTIE,
    ],
  },
  AVAL_TRAITE: {
    famille: "GARANTIE",
    champs: { avance: false, retenue: false, recours: false, debiteurs: false, domiciliation: false },
    lignes: [
      LIGNE("COM_AVAL", "Commission d'aval", { mode_calcul: "POURCENT_PAR_PERIODE", periode: "TRIMESTRE" }),
      FRAIS_DOSSIER,
      TIMBRE,
      DEPOT_GARANTIE,
    ],
  },
  CAUTION_SOUMISSION: CAUTION("Caution de soumission"),
  CAUTION_BONNE_EXECUTION: CAUTION("Caution de bonne exécution"),
  CAUTION_AVANCE_DEMARRAGE: CAUTION("Caution d'avance de démarrage"),
  CAUTION_RETENUE_GARANTIE: CAUTION("Caution de retenue de garantie"),
  ASSURANCE_CREDIT: {
    famille: "GARANTIE",
    champs: { avance: false, retenue: false, recours: false, debiteurs: true, domiciliation: false },
    lignes: [
      LIGNE("PRIME", "Prime d'assurance", { mode_calcul: "POURCENT_FLAT" }),
      LIGNE("ACCESSOIRES", "Accessoires de police", { mode_calcul: "FORFAIT" }),
      FRAIS_DOSSIER,
    ],
  },
};

const CODES_TYPES = Object.keys(TYPES);

function famille(typeFacilite) {
  return TYPES[typeFacilite] ? TYPES[typeFacilite].famille : "PRET";
}

/** Catalogue envoye au frontend : code, famille, champs utiles, modele de lignes, valeurs par defaut. */
function catalogue() {
  return CODES_TYPES.map((code) => {
    const t = TYPES[code];
    return {
      code,
      famille: t.famille,
      champs: t.champs,
      defauts: t.defauts || {},
      libelle_defaut: t.libelle_defaut || null,
      lignes: t.lignes.map((l, i) => ({
        ordre: i,
        code: l.code,
        libelle: l.libelle,
        nature: l.nature,
        mode_calcul: l.mode_calcul,
        base: l.base,
        periode: l.periode,
        periode_entamee: true,
        prelevement: l.prelevement,
        soumis_taxe: l.soumis_taxe,
        frequence: l.frequence || "PAR_OPERATION",
        taxe_taux_pct: null,
        actif: true,
        taux_pct: null,
        montant_fixe: null,
        minimum: null,
        maximum: null,
        observation: null,
      })),
    };
  });
}

function modele(typeFacilite) {
  return catalogue().find((c) => c.code === typeFacilite) || null;
}

module.exports = { TYPES, CODES_TYPES, famille, catalogue, modele };
