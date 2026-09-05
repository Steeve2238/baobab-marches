const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

function getToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("baobab_token");
}

export function setToken(token) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("baobab_token", token);
}

export function clearToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("baobab_token");
}

// Profil utilisateur courant (nom, roles...) - stocke cote client uniquement
// pour l'affichage (masquer les menus Roles/Utilisateurs pour les non-admins,
// afficher le prenom...). Le controle d'acces reel reste fait par le backend
// a chaque requete (voir middleware/auth.js) : ce profil peut etre legerement
// perime si les roles ont change depuis la derniere connexion.
export function setUtilisateurCourant(user) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("baobab_user", JSON.stringify(user || {}));
}

/**
 * Decode la charge utile (payload) du token JWT courant, sans verifier la
 * signature (deja verifiee par le backend a chaque requete - ceci est
 * uniquement une lecture cote client pour l'affichage). Contient au moins
 * sub/tenantId/email/roles (voir utils/jwt.js et routes/auth.js cote
 * backend), mais PAS nom/prenom (absents du token).
 */
function decoderPayloadToken() {
  const token = getToken();
  if (!token) return null;
  try {
    const partiePayload = token.split(".")[1];
    const normalise = partiePayload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalise));
  } catch {
    return null;
  }
}

/**
 * Profil affichable de l'utilisateur connecte. Priorite au profil complet
 * enregistre a la connexion (setUtilisateurCourant, avec nom/prenom) ; si
 * absent - typiquement une session ouverte AVANT l'introduction de ce profil
 * (baobab_user n'existe pas encore dans le localStorage de cette personne,
 * meme si son token reste valide) - on retombe sur le contenu du token
 * (email + roles, sans nom/prenom) plutot que de ne rien afficher du tout.
 * Une reconnexion normale reconstitue le profil complet automatiquement.
 */
export function getUtilisateurCourant() {
  if (typeof window === "undefined") return null;
  let stocke = null;
  try {
    stocke = JSON.parse(window.localStorage.getItem("baobab_user") || "null");
  } catch {
    stocke = null;
  }
  if (stocke && Array.isArray(stocke.roles)) return stocke;

  const payload = decoderPayloadToken();
  if (!payload) return null;
  return {
    email: payload.email,
    roles: payload.roles || [],
    prenom: null,
    nom: null,
  };
}

export function clearUtilisateurCourant() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("baobab_user");
}

export function estAdmin() {
  const user = getUtilisateurCourant();
  return Array.isArray(user?.roles) && user.roles.includes("ADMIN");
}

// Langue de l'interface : stockee cote client, envoyee a chaque requete via
// l'en-tete Accept-Language pour que le backend traduise ses messages.
export function getLangueLocale() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("baobab_langue");
}

export function setLangueLocale(langue) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("baobab_langue", langue);
}

async function request(path, options = {}) {
  const token = getToken();
  const langue = getLangueLocale() || "fr";
  const headers = {
    "Content-Type": "application/json",
    "Accept-Language": langue,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const erreur = new Error(data.error || `Erreur ${res.status}`);
    erreur.status = res.status;
    throw erreur;
  }
  return data;
}

// Requete d'upload (multipart/form-data) : pas de Content-Type explicite,
// le navigateur pose lui-meme le boundary du FormData.
async function requestUpload(path, formData) {
  const token = getToken();
  const langue = getLangueLocale() || "fr";
  const headers = {
    "Accept-Language": langue,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE_URL}${path}`, { method: "POST", headers, body: formData });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const erreur = new Error(data.error || `Erreur ${res.status}`);
    erreur.status = res.status;
    throw erreur;
  }
  return data;
}

// Telechargement d'un fichier binaire (export/modele Excel) : la reponse
// n'est pas du JSON, on la traite comme un Blob et on declenche un
// telechargement navigateur classique via un lien temporaire.
async function requestDownload(path, nomFichierParDefaut) {
  const token = getToken();
  const langue = getLangueLocale() || "fr";
  const headers = {
    "Accept-Language": langue,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const erreur = new Error(data.error || `Erreur ${res.status}`);
    erreur.status = res.status;
    throw erreur;
  }
  const blob = await res.blob();
  const entete = res.headers.get("Content-Disposition") || "";
  const correspondance = /filename="?([^"]+)"?/.exec(entete);
  const nomFichier = correspondance ? correspondance[1] : nomFichierParDefaut;

  const url = window.URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  window.URL.revokeObjectURL(url);
}

export const api = {
  login: (email, mot_de_passe) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, mot_de_passe }) }),
  changerMotDePasse: (nouveau_mot_de_passe) =>
    request("/auth/changer-mot-de-passe", {
      method: "POST",
      body: JSON.stringify({ nouveau_mot_de_passe }),
    }),
  getDossiers: () => request("/dossiers"),
  createDossier: (data) => request("/dossiers", { method: "POST", body: JSON.stringify(data) }),
  getDossier: (id) => request(`/dossiers/${id}`),
  // Permissions agregees du role de l'utilisateur connecte (voir
  // middleware/auth.js cote backend) - consomme par AppShell pour construire
  // dynamiquement le menu de gauche selon le profil.
  getPermissions: () => request("/auth/permissions"),
  getSignaux: () => request("/signaux"),
  acquitterSignal: (id) => request(`/signaux/${id}/acquitter`, { method: "PATCH" }),

  // Module 1 - Extraction DAO & chronogramme
  analyserDao: (dossierId, fichier) => {
    const formData = new FormData();
    formData.append("fichier", fichier);
    return requestUpload(`/extraction/dossiers/${dossierId}/analyser`, formData);
  },
  patchClause: (clauseId, data) =>
    request(`/extraction/clauses/${clauseId}`, { method: "PATCH", body: JSON.stringify(data) }),
  supprimerClause: (clauseId) => request(`/extraction/clauses/${clauseId}`, { method: "DELETE" }),
  genererChronogramme: (dossierId, force) =>
    request(`/chronogramme/${dossierId}/generer${force ? "?force=true" : ""}`, { method: "POST" }),
  createTacheChronogramme: (dossierId, data) =>
    request(`/chronogramme/${dossierId}/taches`, { method: "POST", body: JSON.stringify(data) }),
  patchTacheStatut: (tacheId, statut) =>
    request(`/chronogramme/taches/${tacheId}`, { method: "PATCH", body: JSON.stringify({ statut }) }),
  patchTacheAffectation: (tacheId, { role_porteur_id, assigne_utilisateur_id }) =>
    request(`/chronogramme/taches/${tacheId}`, {
      method: "PATCH",
      body: JSON.stringify({ role_porteur_id, assigne_utilisateur_id }),
    }),
  getMesTaches: (tous) => request(`/chronogramme/mes-taches${tous ? "?tous=true" : ""}`),

  // Roles & utilisateurs (gestion des acces)
  getRoles: () => request("/roles"),
  createRole: (data) => request("/roles", { method: "POST", body: JSON.stringify(data) }),
  patchRole: (id, data) => request(`/roles/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  supprimerRole: (id) => request(`/roles/${id}`, { method: "DELETE" }),
  getUtilisateurs: () => request("/utilisateurs"),
  createUtilisateur: (data) => request("/utilisateurs", { method: "POST", body: JSON.stringify(data) }),
  patchUtilisateur: (id, data) =>
    request(`/utilisateurs/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  supprimerUtilisateur: (id) => request(`/utilisateurs/${id}`, { method: "DELETE" }),
  reinitialiserMotDePasse: (id) =>
    request(`/utilisateurs/${id}/reinitialiser-mot-de-passe`, { method: "POST" }),
  setLangue: (langue_preferee) =>
    request("/auth/langue", { method: "PATCH", body: JSON.stringify({ langue_preferee }) }),

  // Module 2 - Financement
  getPartenaires: () => request("/financement/partenaires"),
  createPartenaire: (data) =>
    request("/financement/partenaires", { method: "POST", body: JSON.stringify(data) }),
  getGrilles: (partenaireId) => request(`/financement/partenaires/${partenaireId}/grilles`),
  createGrille: (partenaireId, data) =>
    request(`/financement/partenaires/${partenaireId}/grilles`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  patchGrilleStatut: (grilleId, statut) =>
    request(`/financement/grilles/${grilleId}/statut`, {
      method: "PATCH",
      body: JSON.stringify({ statut }),
    }),
  getLignes: (grilleId) => request(`/financement/grilles/${grilleId}/lignes`),
  createLigne: (grilleId, data) =>
    request(`/financement/grilles/${grilleId}/lignes`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getSimulations: (dossierId) => request(`/financement/dossiers/${dossierId}/simulations`),
  createSimulation: (dossierId, data) =>
    request(`/financement/dossiers/${dossierId}/simulations`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  patchSimulationRetenue: (simulationId, option_retenue_id) =>
    request(`/financement/simulations/${simulationId}/retenue`, {
      method: "PATCH",
      body: JSON.stringify({ option_retenue_id }),
    }),

  // Module 4 - Marge
  getCalculsMarge: (dossierId) => request(`/marge/dossiers/${dossierId}`),
  createCalculMarge: (dossierId, data) =>
    request(`/marge/dossiers/${dossierId}`, { method: "POST", body: JSON.stringify(data) }),
  patchCalculMarge: (id, data) =>
    request(`/marge/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // Module 3 - Incoterms & logistique
  getIncoterms: () => request("/logistique/incoterms"),
  createIncoterm: (data) =>
    request("/logistique/incoterms", { method: "POST", body: JSON.stringify(data) }),
  simulerLogistique: (data) =>
    request("/logistique/simulations", { method: "POST", body: JSON.stringify(data) }),
  getTransitaires: () => request("/logistique/transitaires"),
  createTransitaire: (data) =>
    request("/logistique/transitaires", { method: "POST", body: JSON.stringify(data) }),
  getHistoriqueTransitaire: (transitaireId) => request(`/logistique/transitaires/${transitaireId}/historique`),
  createHistoriqueTransitaire: (transitaireId, data) =>
    request(`/logistique/transitaires/${transitaireId}/historique`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getSuivisLogistiques: (dossierId) => request(`/logistique/dossiers/${dossierId}/suivis`),
  createSuiviLogistique: (dossierId, data) =>
    request(`/logistique/dossiers/${dossierId}/suivis`, { method: "POST", body: JSON.stringify(data) }),
  patchSuiviLogistique: (id, data) =>
    request(`/logistique/suivis/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // Module 6 - Courriers types
  getModelesCourrier: (type_courrier) =>
    request(`/courriers/modeles${type_courrier ? `?type_courrier=${type_courrier}` : ""}`),
  createModeleCourrier: (data) =>
    request("/courriers/modeles", { method: "POST", body: JSON.stringify(data) }),
  genererCourrier: (dossierId, data) =>
    request(`/courriers/dossiers/${dossierId}/generer`, { method: "POST", body: JSON.stringify(data) }),
  getSuggestionsCourrier: (dossierId) => request(`/courriers/dossiers/${dossierId}/suggestions`),

  // Parametres - entete de structure
  getEntete: () => request("/parametres/entete"),
  updateEntete: (data) => request("/parametres/entete", { method: "PATCH", body: JSON.stringify(data) }),

  // Module 5 - Comparateur fournisseurs
  getFournisseurs: () => request("/fournisseurs"),
  createFournisseur: (data) => request("/fournisseurs", { method: "POST", body: JSON.stringify(data) }),
  getOffresFournisseur: (dossierId) => request(`/fournisseurs/dossiers/${dossierId}/offres`),
  createOffreFournisseur: (dossierId, data) =>
    request(`/fournisseurs/dossiers/${dossierId}/offres`, { method: "POST", body: JSON.stringify(data) }),
  retenirOffreFournisseur: (offreId) =>
    request(`/fournisseurs/offres/${offreId}/retenue`, { method: "PATCH" }),

  // Maitres d'ouvrage (donnee de reference partagee par Module 1 et Module 7)
  getMaitresOuvrage: () => request("/maitres-ouvrage"),
  createMaitreOuvrage: (data) =>
    request("/maitres-ouvrage", { method: "POST", body: JSON.stringify(data) }),

  // Module 7 - Intelligence concurrentielle & juridique
  getHistoriqueConcurrent: (maitre_ouvrage_id) =>
    request(`/concurrence/historique${maitre_ouvrage_id ? `?maitre_ouvrage_id=${maitre_ouvrage_id}` : ""}`),
  createHistoriqueConcurrent: (data) =>
    request("/concurrence/historique", { method: "POST", body: JSON.stringify(data) }),
  patchHistoriqueConcurrent: (id, data) =>
    request(`/concurrence/historique/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  supprimerHistoriqueConcurrent: (id) => request(`/concurrence/historique/${id}`, { method: "DELETE" }),

  getClausesRisque: (maitre_ouvrage_id) =>
    request(`/concurrence/clauses-risque${maitre_ouvrage_id ? `?maitre_ouvrage_id=${maitre_ouvrage_id}` : ""}`),
  createClauseRisque: (data) =>
    request("/concurrence/clauses-risque", { method: "POST", body: JSON.stringify(data) }),
  patchClauseRisque: (id, data) =>
    request(`/concurrence/clauses-risque/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  supprimerClauseRisque: (id) => request(`/concurrence/clauses-risque/${id}`, { method: "DELETE" }),
  signalerClauseRecurrente: (data) =>
    request("/concurrence/clauses-risque/signaler", { method: "POST", body: JSON.stringify(data) }),

  // Module 8 - Parc auto (etape 1/3 : vehicules + sorties)
  getVehicules: () => request("/parc-auto/vehicules"),
  getVehicule: (id) => request(`/parc-auto/vehicules/${id}`),
  createVehicule: (data) => request("/parc-auto/vehicules", { method: "POST", body: JSON.stringify(data) }),
  patchVehicule: (id, data) =>
    request(`/parc-auto/vehicules/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  getSorties: (params) => {
    const query = new URLSearchParams(params || {}).toString();
    return request(`/parc-auto/sorties${query ? `?${query}` : ""}`);
  },
  getSortie: (id) => request(`/parc-auto/sorties/${id}`),
  createSortie: (data) => request("/parc-auto/sorties", { method: "POST", body: JSON.stringify(data) }),
  cloturerSortie: (id, data) =>
    request(`/parc-auto/sorties/${id}/cloturer`, { method: "PATCH", body: JSON.stringify(data) }),

  // Module 8 - Parc auto (etape 2/3 : entretiens + alertes)
  getEntretiens: (params) => {
    const query = new URLSearchParams(params || {}).toString();
    return request(`/parc-auto/entretiens${query ? `?${query}` : ""}`);
  },
  getEntretien: (id) => request(`/parc-auto/entretiens/${id}`),
  createEntretien: (data) => request("/parc-auto/entretiens", { method: "POST", body: JSON.stringify(data) }),
  patchEntretien: (id, data) =>
    request(`/parc-auto/entretiens/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  getAlertesParcAuto: () => request("/parc-auto/alertes"),

  // Module 8 - Parc auto (etape 3/3 : statistiques)
  getStatistiquesParcAuto: () => request("/parc-auto/statistiques"),

  // Module 9 - RH (etape 1/5 : Dossiers du personnel)
  getPersonnel: () => request("/rh/personnel"),
  getMaFicheEmploye: () => request("/rh/personnel/moi"),
  getUtilisateursDisponiblesRH: () => request("/rh/personnel/utilisateurs-disponibles"),
  getFicheEmploye: (id) => request(`/rh/personnel/${id}`),
  createFicheEmploye: (data) => request("/rh/personnel", { method: "POST", body: JSON.stringify(data) }),
  patchFicheEmploye: (id, data) =>
    request(`/rh/personnel/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // Module 9 - RH (etape 2/5 : moteur de demandes RH + circuit d'approbation)
  getReglesApprobationRH: () => request("/rh/regles-approbation"),
  patchReglesApprobationRH: (regles) =>
    request("/rh/regles-approbation", { method: "PUT", body: JSON.stringify({ regles }) }),
  // Circuit a plusieurs etapes (enrichissement de l'etape 2/5, cf. modeles
  // OGAA envoyes par Steeve) : configure par type_demande, independant du
  // role du demandeur. etapes: [] efface la chaine (repli sur
  // regles-approbation ci-dessus pour ce type).
  getEtapesApprobationRH: (typeDemande) =>
    request(`/rh/etapes-approbation?type_demande=${encodeURIComponent(typeDemande)}`),
  putEtapesApprobationRH: (typeDemande, etapes) =>
    request("/rh/etapes-approbation", { method: "PUT", body: JSON.stringify({ type_demande: typeDemande, etapes }) }),
  getMesDemandesRH: () => request("/rh/demandes/mes"),
  getDemandesRHAValider: () => request("/rh/demandes/a-valider"),
  getDemandeRH: (id) => request(`/rh/demandes/${id}`),
  createDemandeRH: (data) => request("/rh/demandes", { method: "POST", body: JSON.stringify(data) }),
  patchDemandeRH: (id, data) => request(`/rh/demandes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  soumettreDemandeRH: (id) => request(`/rh/demandes/${id}/soumettre`, { method: "PATCH" }),
  annulerDemandeRH: (id) => request(`/rh/demandes/${id}/annuler`, { method: "PATCH" }),
  validerDemandeRH: (id, data) =>
    request(`/rh/demandes/${id}/valider`, { method: "PATCH", body: JSON.stringify(data) }),

  // Module 9 - RH (etape 3/5 : planning des conges + statistiques RH)
  getPlanningCongesRH: (annee) => request(`/rh/planning-conges?annee=${annee}`),
  getStatistiquesRH: (periode, mois) => request(`/rh/statistiques?periode=${periode}&mois=${mois}`),

  // Module 9 - RH (etape 4/5 : fiches de temps v2)
  getDossiersDisponiblesFichesTemps: () => request("/rh/fiches-temps/dossiers-disponibles"),
  getFicheTempsSemaine: (semaineDebut) => request(`/rh/fiches-temps/semaine?semaine_debut=${semaineDebut}`),
  getMesFichesTempsAnnee: (annee) => request(`/rh/fiches-temps/mes?annee=${annee}`),
  getFichesTempsAValider: () => request("/rh/fiches-temps/a-valider"),
  getFicheTemps: (id) => request(`/rh/fiches-temps/${id}`),
  enregistrerLignesFicheTemps: (id, lignes) =>
    request(`/rh/fiches-temps/${id}/lignes`, { method: "PUT", body: JSON.stringify({ lignes }) }),
  soumettreFicheTemps: (id) => request(`/rh/fiches-temps/${id}/soumettre`, { method: "PATCH" }),
  validerFicheTemps: (id, data) =>
    request(`/rh/fiches-temps/${id}/valider`, { method: "PATCH", body: JSON.stringify(data) }),
  telechargerModeleFicheTemps: () => requestDownload("/rh/fiches-temps/modele-import", "modele_fiche_temps.xlsx"),
  exporterFicheTemps: (id, semaineDebut) =>
    requestDownload(`/rh/fiches-temps/${id}/export`, `fiche_temps_${semaineDebut}.xlsx`),
  importerFicheTemps: (id, fichier) => {
    const formData = new FormData();
    formData.append("fichier", fichier);
    return requestUpload(`/rh/fiches-temps/${id}/importer`, formData);
  },

  // Module Ventes/Negoce (Consultation -> Devis -> Facture -> Bon de livraison)
  getParametresVentes: () => request("/parametres/ventes"),
  patchParametresVentes: (data) => request("/parametres/ventes", { method: "PATCH", body: JSON.stringify(data) }),
  uploaderLogoVentes: (fichier) => {
    const formData = new FormData();
    formData.append("logo", fichier);
    return requestUpload("/parametres/ventes/logo", formData);
  },
  supprimerLogoVentes: () => request("/parametres/ventes/logo", { method: "DELETE" }),

  getClientsCommerciaux: () => request("/ventes/clients"),
  createClientCommercial: (data) => request("/ventes/clients", { method: "POST", body: JSON.stringify(data) }),
  patchClientCommercial: (id, data) => request(`/ventes/clients/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  getConsultations: (statut) => request(`/ventes/consultations${statut ? `?statut=${statut}` : ""}`),
  createConsultation: (data) => request("/ventes/consultations", { method: "POST", body: JSON.stringify(data) }),
  patchConsultation: (id, data) => request(`/ventes/consultations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  getDevisListe: (statut) => request(`/ventes/devis${statut ? `?statut=${statut}` : ""}`),
  getDevis: (id) => request(`/ventes/devis/${id}`),
  createDevis: (data) => request("/ventes/devis", { method: "POST", body: JSON.stringify(data) }),
  patchDevis: (id, data) => request(`/ventes/devis/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  changerStatutDevis: (id, statut) => request(`/ventes/devis/${id}/statut`, { method: "PATCH", body: JSON.stringify({ statut }) }),
  validerDevis: (id) => request(`/ventes/devis/${id}/valider`, { method: "POST" }),
  genererFactureDepuisDevis: (id, data) => request(`/ventes/devis/${id}/generer-facture`, { method: "POST", body: JSON.stringify(data || {}) }),

  getFacturesVente: (statut) => request(`/ventes/factures${statut ? `?statut=${statut}` : ""}`),
  getFactureVente: (id) => request(`/ventes/factures/${id}`),
  patchFactureVente: (id, data) => request(`/ventes/factures/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  marquerFactureVentePayee: (id, data) => request(`/ventes/factures/${id}/marquer-payee`, { method: "PATCH", body: JSON.stringify(data) }),
  annulerFactureVente: (id) => request(`/ventes/factures/${id}/annuler`, { method: "PATCH" }),
  genererBlDepuisFacture: (id) => request(`/ventes/factures/${id}/generer-bl`, { method: "POST" }),

  getBlListe: (statut) => request(`/ventes/bl${statut ? `?statut=${statut}` : ""}`),
  getBl: (id) => request(`/ventes/bl/${id}`),
  patchBl: (id, data) => request(`/ventes/bl/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  marquerBlLivre: (id) => request(`/ventes/bl/${id}/marquer-livre`, { method: "PATCH" }),

  getStatistiquesVentes: () => request(`/ventes/statistiques`),
  getSuiviVentes: () => request(`/ventes/suivi`),
};
