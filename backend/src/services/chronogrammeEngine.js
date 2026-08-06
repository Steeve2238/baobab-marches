/**
 * Service de generation automatique du chronogramme retro-planifie d'un
 * dossier d'AO (Module 1, section 1 du cahier des charges : "retro-planning
 * J-7 -> J0 -> J+X"). Ne remplace pas la saisie manuelle (toujours possible
 * via POST /api/chronogramme/:dossierId/taches) : produit un jeu de taches
 * de depart coherent, que l'utilisateur peut ensuite ajuster ou completer.
 */

/**
 * Ajoute (ou soustrait) un nombre de jours a une date, retourne une date
 * ISO (YYYY-MM-DD) ou null si la date de depart est absente.
 */
function ajouterJours(dateBase, jours) {
  if (!dateBase) return null;
  const d = new Date(dateBase);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/**
 * Genere la liste des taches du chronogramme pour un dossier, a partir de :
 * - dossier.date_limite_soumission (J0 de la phase AVANT_SOUMISSION)
 * - dossier.date_notification_attribution si deja connue (J0 de la phase
 *   ATTRIBUTION_EXECUTION) ; sinon les taches de cette phase sont creees
 *   sans date_echeance (jalon relatif seulement, a dater plus tard une fois
 *   la notification recue)
 * - les clauses deja extraites du dossier (delai d'execution, avance de
 *   demarrage...) pour enrichir certains intitules de taches
 *
 * @param {object} dossier - ligne dossier_ao (date_limite_soumission, date_notification_attribution)
 * @param {Array} clauses - lignes clause_extraite du dossier (optionnel, [] par defaut)
 * @returns {Array<{phase: string, intitule: string, jalon_relatif: string, date_echeance: string|null, ordre_affichage: number}>}
 * @throws {Error} DATE_LIMITE_SOUMISSION_REQUISE si le dossier n'a pas de date_limite_soumission
 */
function genererChronogrammeStandard(dossier, clauses = []) {
  const j0Soumission = dossier.date_limite_soumission;
  if (!j0Soumission) {
    throw new Error("DATE_LIMITE_SOUMISSION_REQUISE");
  }

  const taches = [];

  // ---- Phase AVANT_SOUMISSION (retro-planning depuis J0 = depot de l'offre) ----
  const etapesAvantSoumission = [
    { offset: -7, jalon: "J-7", intitule: "Finalisation du dossier administratif et technique" },
    { offset: -5, jalon: "J-5", intitule: "Validation interne de l'offre financière" },
    { offset: -3, jalon: "J-3", intitule: "Dépôt des garanties bancaires (caution de soumission)" },
    { offset: -1, jalon: "J-1", intitule: "Vérification finale, impression et signature du dossier" },
    { offset: 0, jalon: "J0", intitule: "Dépôt de l'offre" },
  ];
  etapesAvantSoumission.forEach((etape, idx) => {
    taches.push({
      phase: "AVANT_SOUMISSION",
      intitule: etape.intitule,
      jalon_relatif: etape.jalon,
      date_echeance: ajouterJours(j0Soumission, etape.offset),
      ordre_affichage: idx,
    });
  });

  // ---- Phase ATTRIBUTION_EXECUTION (retro-planning depuis la notification) ----
  const j0Notification = dossier.date_notification_attribution || null;
  const delaiExecutionClause = clauses.find(
    (c) => c.type_clause === "DELAI_EXECUTION" && c.valeur_numerique != null
  );
  const avanceDemarrageClause = clauses.find(
    (c) => c.type_clause === "AVANCE_DEMARRAGE" && c.valeur_numerique != null
  );

  const etapesExecution = [
    { offset: 0, jalon: "J0", intitule: "Réception de la notification d'attribution" },
    { offset: 15, jalon: "J+15", intitule: "Signature du marché / ordre de service" },
    {
      offset: 20,
      jalon: "J+20",
      intitule: avanceDemarrageClause
        ? `Demande d'avance de démarrage (${avanceDemarrageClause.valeur_numerique}% prévus au DAO)`
        : "Demande d'avance de démarrage (si prévue au DAO)",
    },
    { offset: 30, jalon: "J+30", intitule: "Constitution de la garantie de bonne exécution" },
    { offset: 30, jalon: "J+30", intitule: "Démarrage effectif de l'exécution" },
  ];

  if (delaiExecutionClause) {
    const offsetFinExecution = 30 + Number(delaiExecutionClause.valeur_numerique);
    etapesExecution.push({
      offset: offsetFinExecution,
      jalon: `J+${offsetFinExecution}`,
      intitule: `Échéance contractuelle d'exécution (délai extrait du DAO : ${delaiExecutionClause.valeur_numerique} jours)`,
    });
  }

  etapesExecution.forEach((etape, idx) => {
    taches.push({
      phase: "ATTRIBUTION_EXECUTION",
      intitule: etape.intitule,
      jalon_relatif: etape.jalon,
      date_echeance: j0Notification ? ajouterJours(j0Notification, etape.offset) : null,
      ordre_affichage: etapesAvantSoumission.length + idx,
    });
  });

  return taches;
}

module.exports = { genererChronogrammeStandard, ajouterJours };
