const db = require("../db");
const { v4: uuidv4 } = require("uuid");

const CODE_INDICATEUR_ECART_MARGE = "ECART_MARGE";
const SEUILS_DEFAUT_ECART_MARGE = { alerte: 2, critique: 5 }; // en points de pourcentage

/**
 * Recupere la definition de l'indicateur "ecart de marge" pour le tenant,
 * et la cree avec des seuils par defaut si elle n'existe pas encore. Les
 * seuils vivent en base (indicateur_definition.seuil_alerte_json) et restent
 * modifiables par l'utilisateur - jamais codes en dur dans la logique.
 */
async function obtenirIndicateurEcartMarge(tenantId) {
  const existant = await db.query(
    `SELECT * FROM indicateur_definition WHERE tenant_id = $1 AND code = $2`,
    [tenantId, CODE_INDICATEUR_ECART_MARGE]
  );
  if (existant.rows[0]) return existant.rows[0];

  const cree = await db.query(
    `INSERT INTO indicateur_definition (id, tenant_id, code, libelle, domaine, seuil_alerte_json)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      uuidv4(),
      tenantId,
      CODE_INDICATEUR_ECART_MARGE,
      "Ecart entre marge visee et marge reelle",
      "MARGE",
      JSON.stringify(SEUILS_DEFAUT_ECART_MARGE),
    ]
  );
  return cree.rows[0];
}

/**
 * A appeler apres tout calcul/mise a jour de calcul_marge. Enregistre la
 * valeur de l'ecart dans l'historique (indicateur_valeur) et, si l'ecart
 * depasse les seuils parametres, cree ou met a jour un signal d'anticipation
 * (Radar). Ne referme jamais un signal automatiquement : seul un humain
 * l'acquitte, meme si la marge s'est amelioree depuis.
 */
async function evaluerEcartMarge({ tenantId, dossierId, dossierIntitule, margePctVisee, margePctReelle }) {
  if (margePctVisee == null || margePctReelle == null) return null;

  const indicateur = await obtenirIndicateurEcartMarge(tenantId);
  const ecart = Number(margePctVisee) - Number(margePctReelle); // >0 = marge en dessous de la cible

  await db.query(
    `INSERT INTO indicateur_valeur (id, indicateur_definition_id, dossier_ao_id, valeur)
     VALUES ($1, $2, $3, $4)`,
    [uuidv4(), indicateur.id, dossierId, ecart]
  );

  const seuils = indicateur.seuil_alerte_json || SEUILS_DEFAUT_ECART_MARGE;
  let severite = null;
  if (ecart >= Number(seuils.critique ?? SEUILS_DEFAUT_ECART_MARGE.critique)) {
    severite = "CRITIQUE";
  } else if (ecart >= Number(seuils.alerte ?? SEUILS_DEFAUT_ECART_MARGE.alerte)) {
    severite = "ALERTE";
  }

  if (!severite) return null; // ecart dans la tolerance : pas de signal

  const message = `Marge reelle ${Number(margePctReelle).toFixed(1)}% vs ${Number(margePctVisee).toFixed(
    1
  )}% visee sur "${dossierIntitule}" - ecart de ${ecart.toFixed(1)} points.`;

  const signalExistant = await db.query(
    `SELECT id FROM signal_anticipation
     WHERE dossier_ao_id = $1 AND indicateur_definition_id = $2 AND accuse_reception = false`,
    [dossierId, indicateur.id]
  );

  if (signalExistant.rows[0]) {
    const maj = await db.query(
      `UPDATE signal_anticipation
       SET severite = $1, message = $2, date_detection = now()
       WHERE id = $3
       RETURNING *`,
      [severite, message, signalExistant.rows[0].id]
    );
    return maj.rows[0];
  }

  const cree = await db.query(
    `INSERT INTO signal_anticipation (id, tenant_id, dossier_ao_id, indicateur_definition_id, severite, message)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [uuidv4(), tenantId, dossierId, indicateur.id, severite, message]
  );
  return cree.rows[0];
}

const CODE_INDICATEUR_RISQUE_LOGISTIQUE = "RISQUE_LOGISTIQUE";

/**
 * Recupere ou cree la definition de l'indicateur "risque logistique"
 * (retard de livraison / penalite encourue).
 */
async function obtenirIndicateurRisqueLogistique(tenantId) {
  const existant = await db.query(
    `SELECT * FROM indicateur_definition WHERE tenant_id = $1 AND code = $2`,
    [tenantId, CODE_INDICATEUR_RISQUE_LOGISTIQUE]
  );
  if (existant.rows[0]) return existant.rows[0];

  const cree = await db.query(
    `INSERT INTO indicateur_definition (id, tenant_id, code, libelle, domaine, seuil_alerte_json)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      uuidv4(),
      tenantId,
      CODE_INDICATEUR_RISQUE_LOGISTIQUE,
      "Risque de retard / penalite logistique",
      "DELAI",
      JSON.stringify({}),
    ]
  );
  return cree.rows[0];
}

/**
 * A appeler apres tout creation/mise a jour de suivi_logistique. Cree ou
 * met a jour un signal d'anticipation si le statut de penalite est RISQUE
 * (retard detecte, penalite pas encore certaine) ou ENCOURUE (livraison
 * confirmee en retard). Ne referme jamais un signal automatiquement.
 */
async function evaluerRisqueLogistique({
  tenantId,
  dossierId,
  dossierIntitule,
  statutPenalite,
  dateArriveePrevue,
  dateArriveeReelle,
}) {
  if (statutPenalite === "AUCUNE" || !statutPenalite) return null;

  const indicateur = await obtenirIndicateurRisqueLogistique(tenantId);
  const severite = statutPenalite === "ENCOURUE" ? "CRITIQUE" : "ALERTE";

  const message =
    statutPenalite === "ENCOURUE"
      ? `Livraison recue en retard sur "${dossierIntitule}" (prevue le ${formatDate(
          dateArriveePrevue
        )}, arrivee le ${formatDate(dateArriveeReelle)}) - penalite de retard potentiellement encourue.`
      : `Retard detecte sur "${dossierIntitule}" (arrivee prevue le ${formatDate(
          dateArriveePrevue
        )}, non encore receptionnee) - risque de penalite si la livraison n'est pas imminente.`;

  await db.query(
    `INSERT INTO indicateur_valeur (id, indicateur_definition_id, dossier_ao_id, valeur)
     VALUES ($1, $2, $3, $4)`,
    [uuidv4(), indicateur.id, dossierId, statutPenalite === "ENCOURUE" ? 1 : 0.5]
  );

  const signalExistant = await db.query(
    `SELECT id FROM signal_anticipation
     WHERE dossier_ao_id = $1 AND indicateur_definition_id = $2 AND accuse_reception = false`,
    [dossierId, indicateur.id]
  );

  if (signalExistant.rows[0]) {
    const maj = await db.query(
      `UPDATE signal_anticipation
       SET severite = $1, message = $2, date_detection = now()
       WHERE id = $3
       RETURNING *`,
      [severite, message, signalExistant.rows[0].id]
    );
    return maj.rows[0];
  }

  const cree = await db.query(
    `INSERT INTO signal_anticipation (id, tenant_id, dossier_ao_id, indicateur_definition_id, severite, message)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [uuidv4(), tenantId, dossierId, indicateur.id, severite, message]
  );
  return cree.rows[0];
}

function formatDate(d) {
  if (!d) return "date inconnue";
  return new Date(d).toLocaleDateString("fr-FR");
}

module.exports = { evaluerEcartMarge, evaluerRisqueLogistique };
