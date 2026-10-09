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
    erreur.data = data;
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

// Ouvre un PDF genere par l'API dans un nouvel onglet (la requete porte le jeton, d'ou le passage par un Blob).
async function ouvrirPdf(path) {
  const token = getToken();
  const langue = getLangueLocale() || "fr";
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Accept-Language": langue, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erreur ${res.status}`);
  }
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => window.URL.revokeObjectURL(url), 60000);
}

export const api = {
  login: (email, mot_de_passe) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, mot_de_passe }) }),
  changerMotDePasse: (nouveau_mot_de_passe) =>
    request("/auth/changer-mot-de-passe", {
      method: "POST",
      body: JSON.stringify({ nouveau_mot_de_passe }),
    }),
  demanderReinitialisationMotDePasse: (email) =>
    request("/auth/mot-de-passe-oublie", { method: "POST", body: JSON.stringify({ email }) }),
  reinitialiserMotDePasse: (jeton, nouveau_mot_de_passe) =>
    request("/auth/reinitialiser-mot-de-passe", {
      method: "POST",
      body: JSON.stringify({ jeton, nouveau_mot_de_passe }),
    }),
  getDossiers: () => request("/dossiers"),
  // Liste fusionnee Dossiers AO + Consultations restreintes, une seule
  // chronologie (chantier du 02/10/2026, demande de Steeve : "l'interface
  // dossier doit aussi bien faire apparaitre les marches restreint que les
  // appels d'offres"). Chaque ligne porte type_dossier: "AO" | "CONSULTATION".
  getDossiersUnifies: () => request("/dossiers/unifies"),
  createDossier: (data) => request("/dossiers", { method: "POST", body: JSON.stringify(data) }),
  getDossier: (id) => request(`/dossiers/${id}`),
  updateDossier: (id, data) => request(`/dossiers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  // Permissions agregees du role de l'utilisateur connecte (voir
  // middleware/auth.js cote backend) - consomme par AppShell pour construire
  // dynamiquement le menu de gauche selon le profil.
  getPermissions: () => request("/auth/permissions"),
  getSignaux: () => request("/signaux"),
  getEcheancesTableauBord: (jours = 30) => request(`/tableau-bord/echeances?jours=${jours}`),
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

  // Module 2 - Financement (v2, 06/10/2026)
  finCatalogue: () => request("/financement/catalogue"),
  finBanques: () => request("/financement/banques"),
  finPlan: (type, id) => request(`/financement/plans/${type}/${id}`),
  finPlanCalculer: (type, id, data) => request(`/financement/plans/${type}/${id}/calculer`, { method: "POST", body: JSON.stringify(data) }),
  finCompte: (type, id, params = {}) => request(`/financement/comptes/${type}/${id}?${new URLSearchParams(params).toString()}`),
  finCompteExporter: (type, id, format, params = {}) =>
    requestDownload(`/financement/comptes/${type}/${id}/export?${new URLSearchParams({ ...params, format }).toString()}`, `compte_exploitation.${format}`),
  finPlanExporter: (type, id, format) => requestDownload(`/financement/plans/${type}/${id}/export?format=${format}`, `plan_tresorerie.${format}`),
  finChargeAjouter: (type, id, data, params = {}) =>
    request(`/financement/comptes/${type}/${id}/charges?${new URLSearchParams(params).toString()}`, { method: "POST", body: JSON.stringify(data) }),
  finChargeModifier: (type, id, chargeId, data, params = {}) =>
    request(`/financement/comptes/${type}/${id}/charges/${chargeId}?${new URLSearchParams(params).toString()}`, { method: "PATCH", body: JSON.stringify(data) }),
  finChargeSupprimer: (type, id, chargeId, params = {}) =>
    request(`/financement/comptes/${type}/${id}/charges/${chargeId}?${new URLSearchParams(params).toString()}`, { method: "DELETE" }),
  finPlanEnregistrer: (type, id, data) => request(`/financement/plans/${type}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  finBanque: (id) => request(`/financement/banques/${id}`),
  finCreerBanque: (data) => request("/financement/banques", { method: "POST", body: JSON.stringify(data) }),
  finMajBanque: (id, data) => request(`/financement/banques/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  finSupprimerBanque: (id) => request(`/financement/banques/${id}`, { method: "DELETE" }),
  finConditions: (params = {}) => request(`/financement/conditions?${new URLSearchParams(params).toString()}`),
  finCondition: (id) => request(`/financement/conditions/${id}`),
  finCreerCondition: (data) => request("/financement/conditions", { method: "POST", body: JSON.stringify(data) }),
  finMajCondition: (id, data) => request(`/financement/conditions/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  finDupliquerCondition: (id) => request(`/financement/conditions/${id}/dupliquer`, { method: "POST" }),
  finSupprimerCondition: (id) => request(`/financement/conditions/${id}`, { method: "DELETE" }),
  finCalculer: (data) => request("/financement/simulations/calculer", { method: "POST", body: JSON.stringify(data) }),
  finEnregistrerSimulation: (data) => request("/financement/simulations", { method: "POST", body: JSON.stringify(data) }),
  finSimulations: (params = {}) => request(`/financement/simulations?${new URLSearchParams(params).toString()}`),
  finSimulation: (id) => request(`/financement/simulations/${id}`),
  finSupprimerSimulation: (id) => request(`/financement/simulations/${id}`, { method: "DELETE" }),
  finRetenir: (id, data) => request(`/financement/simulations/${id}/retenir`, { method: "POST", body: JSON.stringify(data) }),
  finAnnulerChoix: (id) => request(`/financement/simulations/${id}/annuler-choix`, { method: "POST" }),
  finLier: (id, data) => request(`/financement/simulations/${id}/lier`, { method: "POST", body: JSON.stringify(data) }),
  finControler: (id, data) => request(`/financement/simulations/${id}/controles`, { method: "POST", body: JSON.stringify(data) }),
  finControleDirect: (data) => request("/financement/controle-direct", { method: "POST", body: JSON.stringify(data) }),
  finSupprimerControle: (id) => request(`/financement/controles/${id}`, { method: "DELETE" }),
  finSynthese: () => request("/financement/synthese"),
  finDossier: (type, id) => request(`/financement/dossiers/${type}/${id}`),

  // Module 4 - Marge
  getCalculsMarge: (dossierId) => request(`/marge/dossiers/${dossierId}`),
  createCalculMarge: (dossierId, data) =>
    request(`/marge/dossiers/${dossierId}`, { method: "POST", body: JSON.stringify(data) }),
  patchCalculMarge: (id, data) =>
    request(`/marge/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // Module 3 - Incoterms & logistique
  getIncoterms: () => request("/logistique/incoterms"),
  // Catalogue unique d'incoterms (lecture pour toute l'application) + edition des couts "inclus" (Logistique).
  getCatalogueIncoterms: () => request("/incoterms"),
  updateIncoterm: (id, data) => request(`/logistique/incoterms/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
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

  // Generation unifiee + historique numerote (chantier du 02/10/2026, demande
  // de Steeve : courriers disponibles aussi bien pour les dossiers AO que
  // pour les consultations restreintes, avec une seule chronologie de
  // numeros) - remplace genererCourrier/getSuggestionsCourrier ci-dessus pour
  // tout nouvel usage (conservees inchangees pour compatibilite).
  genererCourrierUnifie: (data) => request("/courriers/generer", { method: "POST", body: JSON.stringify(data) }),
  getHistoriqueCourriers: ({ dossierType, dossierId } = {}) => {
    const params = new URLSearchParams();
    if (dossierType && dossierId) {
      params.set("dossier_type", dossierType);
      params.set("dossier_id", dossierId);
    }
    const requete = params.toString();
    return request(`/courriers/historique${requete ? `?${requete}` : ""}`);
  },
  marquerCourrierEnvoye: (id) =>
    request(`/courriers/generes/${id}/statut`, { method: "PATCH", body: JSON.stringify({ statut: "ENVOYE" }) }),

  // Parametres - entete de structure
  getEntete: () => request("/parametres/entete"),
  updateEntete: (data) => request("/parametres/entete", { method: "PATCH", body: JSON.stringify(data) }),

  // Module 5 - Comparateur fournisseurs
  getFournisseurs: () => request("/fournisseurs"),
  echeancierModeles: (sens) => request(`/echeanciers/modeles?sens=${sens}`),
  patchFournisseur: (id, data) => request(`/fournisseurs/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
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
  // RH lot 2 : contrats de travail, modeles, DMT
  getModelesContrats: () => request("/rh/modeles-contrats"),
  putModeleContrat: (type, articles) =>
    request(`/rh/modeles-contrats/${type}`, { method: "PUT", body: JSON.stringify({ articles }) }),
  deleteModeleContrat: (type) => request(`/rh/modeles-contrats/${type}`, { method: "DELETE" }),
  getContrats: (employeId) => request(`/rh/contrats${employeId ? `?employe_id=${employeId}` : ""}`),
  getContratPrefill: (employeId, type) => request(`/rh/contrats/prefill?employe_id=${employeId}&type=${type}`),
  getContrat: (id) => request(`/rh/contrats/${id}`),
  createContrat: (data) => request("/rh/contrats", { method: "POST", body: JSON.stringify(data) }),
  patchContrat: (id, data) => request(`/rh/contrats/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteContrat: (id) => request(`/rh/contrats/${id}`, { method: "DELETE" }),
  validerContrat: (id) => request(`/rh/contrats/${id}/valider`, { method: "POST" }),
  annulerContrat: (id) => request(`/rh/contrats/${id}/annuler`, { method: "POST" }),
  // Fiche de renseignements du salarie : modeles, export, import (apercu puis confirmation).
  rhModeleImportPersonnel: () => requestDownload("/rh/personnel/modele-import", "modele_import_salaries.xlsx"),
  rhExporterPersonnel: () => requestDownload("/rh/personnel/export", "salaries.xlsx"),
  rhFicheViergeExcel: () => requestDownload("/rh/personnel/fiche-vierge.xlsx", "fiche_renseignements.xlsx"),
  rhFicheViergePdf: () => ouvrirPdf("/rh/personnel/fiche-vierge.pdf"),
  rhFicheSalarieExcel: (id, nom) => requestDownload(`/rh/personnel/${id}/fiche-renseignements.xlsx`, `fiche_${nom || "salarie"}.xlsx`),
  rhFicheSalariePdf: (id) => ouvrirPdf(`/rh/personnel/${id}/fiche-renseignements.pdf`),
  rhImporterPersonnel: (fichier, apercu) => {
    const formData = new FormData();
    formData.append("fichier", fichier);
    return requestUpload(`/rh/personnel/import${apercu ? "?apercu=1" : ""}`, formData);
  },
  ouvrirPdfRH: (chemin) => ouvrirPdf(chemin),
  telechargerPdfRH: (chemin, nom) => requestDownload(chemin, nom),
  getDmts: (employeId) => request(`/rh/dmt${employeId ? `?employe_id=${employeId}` : ""}`),
  getDmtPrefill: (employeId, objet, contratId) =>
    request(`/rh/dmt/prefill?employe_id=${employeId}&objet=${objet}${contratId ? `&contrat_id=${contratId}` : ""}`),
  getDmt: (id) => request(`/rh/dmt/${id}`),
  createDmt: (data) => request("/rh/dmt", { method: "POST", body: JSON.stringify(data) }),
  patchDmt: (id, data) => request(`/rh/dmt/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteDmt: (id) => request(`/rh/dmt/${id}`, { method: "DELETE" }),
  envoyerContratSalarie: (id) => request(`/rh/contrats/${id}/envoyer`, { method: "POST" }),
  transmettreContratInspection: (id, date) =>
    request(`/rh/contrats/${id}/transmettre-inspection`, { method: "POST", body: JSON.stringify({ date }) }),
  viserContrat: (id, data) => request(`/rh/contrats/${id}/viser`, { method: "POST", body: JSON.stringify(data) }),
  putScanContrat: (id, fichier) => request(`/rh/contrats/${id}/scan`, { method: "PUT", body: JSON.stringify(fichier) }),
  // RH lot 4 : courriers RH et ordres de virement
  getCourrierTypes: () => request("/rh/courriers/types"),
  putModeleCourrier: (type, data) => request(`/rh/modeles-courriers/${type}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteModeleCourrier: (type) => request(`/rh/modeles-courriers/${type}`, { method: "DELETE" }),
  getCourriers: (filtres = {}) => {
    const q = new URLSearchParams(Object.entries(filtres).filter(([, v]) => v)).toString();
    return request(`/rh/courriers${q ? `?${q}` : ""}`);
  },
  getCourrierPrefill: (employeId, type) => request(`/rh/courriers/prefill?employe_id=${employeId}&type=${type}`),
  getCourrier: (id) => request(`/rh/courriers/${id}`),
  createCourrier: (data) => request("/rh/courriers", { method: "POST", body: JSON.stringify(data) }),
  patchCourrier: (id, data) => request(`/rh/courriers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteCourrierRH: (id) => request(`/rh/courriers/${id}`, { method: "DELETE" }),
  emettreCourrier: (id) => request(`/rh/courriers/${id}/emettre`, { method: "POST" }),
  annulerCourrierRH: (id) => request(`/rh/courriers/${id}/annuler`, { method: "POST" }),
  publierCourrier: (id, publier) => request(`/rh/courriers/${id}/publier`, { method: "POST", body: JSON.stringify({ publier }) }),
  remiseCourrier: (id, data) => request(`/rh/courriers/${id}/remise`, { method: "POST", body: JSON.stringify(data) }),
  getOrdresVirement: () => request("/rh/ordres-virement"),
  getOrdreVirementPrefill: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/rh/ordres-virement/prefill${q ? `?${q}` : ""}`);
  },
  getOrdreVirement: (id) => request(`/rh/ordres-virement/${id}`),
  createOrdreVirement: (data) => request("/rh/ordres-virement", { method: "POST", body: JSON.stringify(data) }),
  patchOrdreVirement: (id, data) => request(`/rh/ordres-virement/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteOrdreVirement: (id) => request(`/rh/ordres-virement/${id}`, { method: "DELETE" }),
  validerOrdreVirement: (id) => request(`/rh/ordres-virement/${id}/valider`, { method: "POST" }),
  executerOrdreVirement: (id, date) => request(`/rh/ordres-virement/${id}/executer`, { method: "POST", body: JSON.stringify({ date }) }),
  annulerOrdreVirement: (id) => request(`/rh/ordres-virement/${id}/annuler`, { method: "POST" }),
  // RH lot 3 : espace employe
  getEspaceCourriers: () => request("/rh/espace/courriers"),
  getEspaceCourrier: (id) => request(`/rh/espace/courriers/${id}`),
  accuserCourrier: (id) => request(`/rh/espace/courriers/${id}/accuse`, { method: "POST" }),
  repondreCourrier: (id, texte) => request(`/rh/espace/courriers/${id}/reponse`, { method: "POST", body: JSON.stringify({ texte }) }),
  getEspaceBulletins: () => request("/rh/espace/bulletins"),
  ouvrirBulletinPaie: (periodeId) => ouvrirPdf(`/rh/espace/bulletins/${periodeId}/pdf`),
  telechargerBulletinPaie: (periodeId, nom) => requestDownload(`/rh/espace/bulletins/${periodeId}/pdf?telecharger=1`, nom),
  accuserBulletinPaie: (periodeId) => request(`/rh/espace/bulletins/${periodeId}/accuse`, { method: "POST" }),
  getEspaceMoi: () => request("/rh/espace/moi"),
  getEspaceSignature: () => request("/rh/espace/signature"),
  demanderCodeSignature: () => request("/rh/espace/signature/code", { method: "POST" }),
  enregistrerSignature: (data) => request("/rh/espace/signature", { method: "PUT", body: JSON.stringify(data) }),
  getEspaceContrats: () => request("/rh/espace/contrats"),
  getEspaceContrat: (id) => request(`/rh/espace/contrats/${id}`),
  demanderCodeContrat: (id) => request(`/rh/espace/contrats/${id}/code`, { method: "POST" }),
  signerContrat: (id, data) => request(`/rh/espace/contrats/${id}/signer`, { method: "POST", body: JSON.stringify(data) }),
  lierCompteEmploye: (id, utilisateur_id) =>
    request(`/rh/personnel/${id}/compte`, { method: "PATCH", body: JSON.stringify({ utilisateur_id }) }),

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
  getNumerotation: () => request("/parametres/numerotation"),
  patchNumerotation: (data) => request("/parametres/numerotation", { method: "PATCH", body: JSON.stringify(data) }),
  uploaderLogoVentes: (fichier) => {
    const formData = new FormData();
    formData.append("logo", fichier);
    return requestUpload("/parametres/ventes/logo", formData);
  },
  supprimerLogoVentes: () => request("/parametres/ventes/logo", { method: "DELETE" }),
  uploaderSignatureCachetVentes: (fichier) => {
    const formData = new FormData();
    formData.append("signature_cachet", fichier);
    return requestUpload("/parametres/ventes/signature-cachet", formData);
  },
  supprimerSignatureCachetVentes: () => request("/parametres/ventes/signature-cachet", { method: "DELETE" }),

  getClientsCommerciaux: () => request("/ventes/clients"),
  createClientCommercial: (data) => request("/ventes/clients", { method: "POST", body: JSON.stringify(data) }),
  patchClientCommercial: (id, data) => request(`/ventes/clients/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  // "Compte client" (30/09/2026) : total facture/paye/du tous devis
  // confondus, plus le detail devis par devis et facture par facture - voir
  // GET /api/ventes/clients/:id/compte.
  getCompteClient: (id) => request(`/ventes/clients/${id}/compte`),

  getConsultations: (statut, type) => {
    const q = [statut ? `statut=${statut}` : "", type ? `type=${type}` : ""].filter(Boolean).join("&");
    return request(`/ventes/consultations${q ? `?${q}` : ""}`);
  },
  getConsultation: (id) => request(`/ventes/consultations/${id}`),
  createConsultation: (data) => request("/ventes/consultations", { method: "POST", body: JSON.stringify(data) }),
  patchConsultation: (id, data) => request(`/ventes/consultations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // Chronogramme d'une consultation (meme principe que le chronogramme d'un
  // dossier d'AO ci-dessus, mais retro-planning proportionnel - voir
  // backend/src/services/chronogrammeConsultationEngine.js)
  genererChronogrammeConsultation: (consultationId, force) =>
    request(`/ventes/consultations/${consultationId}/chronogramme/generer${force ? "?force=true" : ""}`, {
      method: "POST",
    }),
  createTacheConsultation: (consultationId, data) =>
    request(`/ventes/consultations/${consultationId}/chronogramme/taches`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  patchTacheConsultationStatut: (tacheId, statut) =>
    request(`/ventes/consultations/chronogramme-taches/${tacheId}`, {
      method: "PATCH",
      body: JSON.stringify({ statut }),
    }),
  patchTacheConsultationAffectation: (tacheId, { role_porteur_id, assigne_utilisateur_id }) =>
    request(`/ventes/consultations/chronogramme-taches/${tacheId}`, {
      method: "PATCH",
      body: JSON.stringify({ role_porteur_id, assigne_utilisateur_id }),
    }),

  getDevisListe: (statut) => request(`/ventes/devis${statut ? `?statut=${statut}` : ""}`),
  getDevis: (id) => request(`/ventes/devis/${id}`),
  createDevis: (data) => request("/ventes/devis", { method: "POST", body: JSON.stringify(data) }),
  patchDevis: (id, data) => request(`/ventes/devis/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  // Correction du client sur un devis deja cree (chantier du 02/10/2026) -
  // route dediee et separee de patchDevis ci-dessus (reservee au DG/
  // Directeur Financier ou ADMIN, voir PATCH /devis/:id/client).
  changerClientDevis: (id, clientCommercialId) =>
    request(`/ventes/devis/${id}/client`, { method: "PATCH", body: JSON.stringify({ client_commercial_id: clientCommercialId }) }),
  // Suppression definitive (chantier du 02/10/2026) - reservee au DG/
  // Directeur Financier ou ADMIN, bloquee des qu'une facture existe deja sur
  // ce devis (voir DELETE /devis/:id).
  supprimerDevis: (id) => request(`/ventes/devis/${id}`, { method: "DELETE" }),
  // Import des devis historiques (30/09/2026) - meme pattern que
  // telechargerModeleFicheTemps/importerFicheTemps (module RH) ci-dessus.
  telechargerModeleImportDevis: () => requestDownload("/ventes/devis/modele-import", "modele_import_devis_historiques.xlsx"),
  importerDevisHistoriques: (fichier) => {
    const formData = new FormData();
    formData.append("fichier", fichier);
    return requestUpload("/ventes/devis/importer", formData);
  },
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

  // Parametres du "Dossier de calcul" (prix de revient et marge) - voir
  // GET/PATCH /api/parametres/calcul-prix cote backend. La TVA de vente
  // n'est PAS ici : elle reste getParametresVentes/patchParametresVentes
  // ci-dessus (meme taux que le reste de la plateforme).
  getProfilActivite: () => request("/parametres/profil-activite"),
  patchProfilActivite: (profil_activite) =>
    request("/parametres/profil-activite", { method: "PATCH", body: JSON.stringify({ profil_activite }) }),
  getParametresCalculPrix: () => request("/parametres/calcul-prix"),
  patchParametresCalculPrix: (data) =>
    request("/parametres/calcul-prix", { method: "PATCH", body: JSON.stringify(data) }),

  // "Dossier de calcul" (prix de revient et marge, module calcul-prix) -
  // atelier autonome rattache SOIT a un dossier d'AO SOIT a une consultation
  // (jamais les deux). Un seul article = une ligne, plusieurs offres
  // comparees par article (voir routes/calculPrix.js + services/
  // calculPrixEngine.js cote backend, confirme avec Steeve le 07/09/2026 a
  // partir de son propre tableau Excel).
  getDossiersCalcul: (params) => {
    const query = new URLSearchParams(params || {}).toString();
    return request(`/calcul-prix/dossiers${query ? `?${query}` : ""}`);
  },
  getDossierCalcul: (id) => request(`/calcul-prix/dossiers/${id}`),
  createDossierCalcul: (data) => request("/calcul-prix/dossiers", { method: "POST", body: JSON.stringify(data) }),
  supprimerDossierCalcul: (id) => request(`/calcul-prix/dossiers/${id}`, { method: "DELETE" }),

  createArticleCalcul: (dossierCalculId, data) =>
    request(`/calcul-prix/dossiers/${dossierCalculId}/articles`, { method: "POST", body: JSON.stringify(data) }),
  patchArticleCalcul: (id, data) =>
    request(`/calcul-prix/articles/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  supprimerArticleCalcul: (id) => request(`/calcul-prix/articles/${id}`, { method: "DELETE" }),

  createOffreCalcul: (articleId, data) =>
    request(`/calcul-prix/articles/${articleId}/offres`, { method: "POST", body: JSON.stringify(data) }),
  patchOffreCalcul: (id, data) => request(`/calcul-prix/offres/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  supprimerOffreCalcul: (id) => request(`/calcul-prix/offres/${id}`, { method: "DELETE" }),

  // Registres partenaires dupliques (memes tables fournisseur/transitaire),
  // accessibles avec seulement le module "marches" ou "dossiers" - voir
  // commentaire dans routes/calculPrix.js.
  getFournisseursCalcul: () => request("/calcul-prix/fournisseurs"),
  createFournisseurCalcul: (data) =>
    request("/calcul-prix/fournisseurs", { method: "POST", body: JSON.stringify(data) }),
  getTransitairesCalcul: () => request("/calcul-prix/transitaires"),
  createTransitaireCalcul: (data) =>
    request("/calcul-prix/transitaires", { method: "POST", body: JSON.stringify(data) }),
  // Parents possibles d'un nouveau dossier de calcul (AO / consultations).
  getParentsDossierCalcul: () => request("/calcul-prix/parents"),

  // Catalogue "Produits" (base de calcul globale, 05/10/2026) : cout de
  // revient + marge par produit, alimente depuis les offres retenues des
  // dossiers de calcul ou saisi a la main, propose dans les devis.
  getProduits: (params) => {
    const query = new URLSearchParams(params || {}).toString();
    return request(`/produits${query ? `?${query}` : ""}`);
  },
  createProduit: (data) => request("/produits", { method: "POST", body: JSON.stringify(data) }),
  patchProduit: (id, data) => request(`/produits/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  supprimerProduit: (id) => request(`/produits/${id}`, { method: "DELETE" }),
  actualiserProduit: (id) => request(`/produits/${id}/actualiser`, { method: "POST" }),
  getProduitsCandidats: (params) => {
    const query = new URLSearchParams(params || {}).toString();
    return request(`/produits/candidats${query ? `?${query}` : ""}`);
  },
  importerProduits: (offreIds) => request("/produits/importer", { method: "POST", body: JSON.stringify({ offre_ids: offreIds }) }),

  // Receptions de marchandises + stock (05/10/2026) : la facture fournisseur
  // (Excel ou saisie) est la porte d'entree des articles et du stock.
  getReceptions: (params) => {
    const query = new URLSearchParams(params || {}).toString();
    return request(`/receptions${query ? `?${query}` : ""}`);
  },
  getReception: (id) => request(`/receptions/${id}`),
  // Facturation comptable d'une reception validee (Lot 7, module Comptabilite requis).
  getFacturationReception: (id) => request(`/comptabilite/receptions/${id}/facturation`),
  creerFactureFournisseurReception: (id, data) => request(`/comptabilite/receptions/${id}/facture-fournisseur`, { method: "POST", body: JSON.stringify(data || {}) }),
  creerFactureTransitaireReception: (id, data) => request(`/comptabilite/receptions/${id}/facture-transitaire`, { method: "POST", body: JSON.stringify(data || {}) }),
  createReception: (data) => request("/receptions", { method: "POST", body: JSON.stringify(data) }),
  patchReception: (id, data) => request(`/receptions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  supprimerReception: (id) => request(`/receptions/${id}`, { method: "DELETE" }),
  validerReception: (id) => request(`/receptions/${id}/valider`, { method: "POST" }),
  annulerReception: (id) => request(`/receptions/${id}/annuler`, { method: "POST" }),
  importerExcelReception: (fichier) => {
    const formData = new FormData();
    formData.append("fichier", fichier);
    return requestUpload("/receptions/importer-excel", formData);
  },
  getPrixFournisseurs: (params) => {
    const query = new URLSearchParams(params || {}).toString();
    return request(`/prix-fournisseurs${query ? `?${query}` : ""}`);
  },
  getPrixProduit: (id) => request(`/prix-fournisseurs/produit/${id}`),
  comparerOffreExcel: (fichier, fournisseurId, devise, cours) => {
    const formData = new FormData();
    formData.append("fichier", fichier);
    formData.append("fournisseur_id", fournisseurId);
    formData.append("devise", devise);
    formData.append("cours_devise", cours);
    return requestUpload("/prix-fournisseurs/comparer-excel", formData);
  },
  getFournisseursReception: () => request("/receptions/fournisseurs"),
  estimerCoutsApprocheReception: (data) => request("/receptions/estimer-couts-approche", { method: "POST", body: JSON.stringify(data) }),
  enregistrerCoutsApprocheReception: (id, couts, transport) =>
    request(`/receptions/${id}/couts-approche`, { method: "PUT", body: JSON.stringify({ ...(transport || {}), couts_approche: couts }) }),
  // Commandes fournisseur et livraisons de dossier (Lot 5, 05/10/2026)
  getCommandes: (params) => {
    const query = new URLSearchParams(params || {}).toString();
    return request(`/commandes${query ? `?${query}` : ""}`);
  },
  getCommande: (id) => request(`/commandes/${id}`),
  getCommandePourReception: (id) => request(`/commandes/${id}/pour-reception`),
  createCommande: (data) => request("/commandes", { method: "POST", body: JSON.stringify(data) }),
  patchCommande: (id, data) => request(`/commandes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  corrigerCommande: (id, data) => request(`/commandes/${id}/corriger`, { method: "POST", body: JSON.stringify(data) }),
  confirmerCommande: (id) => request(`/commandes/${id}/confirmer`, { method: "POST" }),
  annulerCommande: (id) => request(`/commandes/${id}/annuler`, { method: "POST" }),
  supprimerCommande: (id) => request(`/commandes/${id}`, { method: "DELETE" }),
  getIndicePrixCalcul: (articleId, fournisseurId) => request(`/calcul-prix/indice-prix?article_id=${articleId}&fournisseur_id=${fournisseurId}`),
  commandesDepuisCalcul: (dossierCalculId) => request("/commandes/depuis-calcul", { method: "POST", body: JSON.stringify({ dossier_calcul_id: dossierCalculId }) }),
  getSyntheseDossier: (params) => request(`/commandes/synthese-dossier?${new URLSearchParams(params).toString()}`),
  getLivraisonsDossier: (params) => {
    const query = new URLSearchParams(params || {}).toString();
    return request(`/livraisons-dossier${query ? `?${query}` : ""}`);
  },
  getLivraisonDossier: (id) => request(`/livraisons-dossier/${id}`),
  getALivrerDossier: (dossierId) => request(`/livraisons-dossier/a-livrer?dossier_ao_id=${dossierId}`),
  createLivraisonDossier: (data) => request("/livraisons-dossier", { method: "POST", body: JSON.stringify(data) }),
  patchLivraisonDossier: (id, data) => request(`/livraisons-dossier/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  validerLivraisonDossier: (id) => request(`/livraisons-dossier/${id}/valider`, { method: "POST" }),
  annulerLivraisonDossier: (id) => request(`/livraisons-dossier/${id}/annuler`, { method: "POST" }),
  supprimerLivraisonDossier: (id) => request(`/livraisons-dossier/${id}`, { method: "DELETE" }),
  // Transitaires, cotations et performance (Lot 4, 05/10/2026)
  getTransitairesPerf: () => request("/transitaires"),
  createTransitairePerf: (data) => request("/transitaires", { method: "POST", body: JSON.stringify(data) }),
  patchTransitairePerf: (id, data) => request(`/transitaires/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  getFicheTransitaire: (id) => request(`/transitaires/${id}`),
  getCotationsTransitaires: (params) => {
    const query = new URLSearchParams(params || {}).toString();
    return request(`/transitaires/cotations${query ? `?${query}` : ""}`);
  },
  comparerCotationsTransitaires: (params) => {
    const query = new URLSearchParams(params || {}).toString();
    return request(`/transitaires/cotations/comparer${query ? `?${query}` : ""}`);
  },
  createCotationTransitaire: (data) => request("/transitaires/cotations", { method: "POST", body: JSON.stringify(data) }),
  patchCotationTransitaire: (id, data) => request(`/transitaires/cotations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  statutCotationTransitaire: (id, statut) => request(`/transitaires/cotations/${id}/statut`, { method: "POST", body: JSON.stringify({ statut }) }),
  supprimerCotationTransitaire: (id) => request(`/transitaires/cotations/${id}`, { method: "DELETE" }),
  getCoutsCotation: (id, devise) => request(`/transitaires/cotations/${id}/couts?devise=${encodeURIComponent(devise || "XOF")}`),
  createFournisseurReception: (data) => request("/receptions/fournisseurs", { method: "POST", body: JSON.stringify(data) }),
  ajusterStockProduit: (id, data) => request(`/produits/${id}/ajustement-stock`, { method: "POST", body: JSON.stringify(data) }),
  getMouvementsProduit: (id) => request(`/produits/${id}/mouvements`),
  getReferencesFournisseursProduit: (id) => request(`/produits/${id}/references-fournisseurs`),

  // --- Comptabilite SYSCOHADA (chantier E, phase 1 - 04/10/2026) ---
  comptaStatut: () => request("/comptabilite/statut"),
  comptaInitialiser: (data) => request("/comptabilite/initialiser", { method: "POST", body: JSON.stringify(data || {}) }),
  comptaModifierParametres: (data) => request("/comptabilite/parametres", { method: "PATCH", body: JSON.stringify(data) }),
  comptaExercices: () => request("/comptabilite/exercices"),
  comptaCreerExercice: (data) => request("/comptabilite/exercices", { method: "POST", body: JSON.stringify(data) }),
  comptaCloturerExercice: (id) => request(`/comptabilite/exercices/${id}/cloturer`, { method: "POST" }),
  comptaRouvrirExercice: (id) => request(`/comptabilite/exercices/${id}/rouvrir`, { method: "POST" }),
  comptaJournaux: () => request("/comptabilite/journaux"),
  comptaCreerJournal: (data) => request("/comptabilite/journaux", { method: "POST", body: JSON.stringify(data) }),
  comptaModifierJournal: (id, data) => request(`/comptabilite/journaux/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  comptaComptes: (params = {}) => request(`/comptabilite/comptes?${new URLSearchParams(params).toString()}`),
  comptaProchainNumero: (parent) => request(`/comptabilite/comptes/prochain-numero?parent=${encodeURIComponent(parent)}`),
  comptaCreerCompte: (data) => request("/comptabilite/comptes", { method: "POST", body: JSON.stringify(data) }),
  comptaModifierCompte: (id, data) => request(`/comptabilite/comptes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  comptaTiers: (params = {}) => request(`/comptabilite/tiers?${new URLSearchParams(params).toString()}`),
  comptaSynchroniserTiers: () => request("/comptabilite/tiers/synchroniser", { method: "POST" }),
  comptaEcritures: (params = {}) => request(`/comptabilite/ecritures?${new URLSearchParams(params).toString()}`),
  comptaEcriture: (id) => request(`/comptabilite/ecritures/${id}`),
  comptaCreerEcriture: (data) => request("/comptabilite/ecritures", { method: "POST", body: JSON.stringify(data) }),
  comptaModifierEcriture: (id, data) => request(`/comptabilite/ecritures/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  comptaSupprimerEcriture: (id) => request(`/comptabilite/ecritures/${id}`, { method: "DELETE" }),
  comptaValiderEcriture: (id) => request(`/comptabilite/ecritures/${id}/valider`, { method: "POST" }),
  comptaValiderLot: (ids) => request("/comptabilite/ecritures/valider-lot", { method: "POST", body: JSON.stringify({ ids }) }),
  comptaExtourner: (id, data) => request(`/comptabilite/ecritures/${id}/extourner`, { method: "POST", body: JSON.stringify(data || {}) }),
  comptaGrandLivre: (params = {}) => request(`/comptabilite/grand-livre?${new URLSearchParams(params).toString()}`),
  comptaBalance: (params = {}) => request(`/comptabilite/balance?${new URLSearchParams(params).toString()}`),
  // --- Fiscalite (module payant, migration 049) ---
  fiscaliteProfil: () => request("/fiscalite/profil"),
  fiscaliteEnregistrerProfil: (data) => request("/fiscalite/profil", { method: "PUT", body: JSON.stringify(data) }),
  fiscaliteRegime: (annee) => request(`/fiscalite/regime${annee ? `?annee=${annee}` : ""}`),
  fiscaliteDecoderCofi: (ninea, cofi) =>
    request(`/fiscalite/cofi/decoder?${new URLSearchParams({ ninea: ninea || "", cofi: cofi || "" }).toString()}`),
  fiscaliteTiers: () => request("/fiscalite/tiers"),
  fiscaliteMajTiers: (type, id, data) => request(`/fiscalite/tiers/${type}/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  fiscaliteDeduireRegimes: () => request("/fiscalite/tiers/deduire-regimes", { method: "POST" }),
  fiscaliteTvaAnnee: (annee) => request(`/fiscalite/tva/${annee}`),
  fiscaliteTvaPeriode: (annee, mois, saisies = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(saisies)) if (v !== undefined && v !== null && v !== "") p.set(k, v);
    const q = p.toString();
    return request(`/fiscalite/tva/${annee}/${mois}${q ? `?${q}` : ""}`);
  },
  fiscalitePreparerTva: (annee, mois, saisies = {}) =>
    request(`/fiscalite/tva/${annee}/${mois}/preparer`, { method: "POST", body: JSON.stringify(saisies) }),
  fiscaliteStatutTva: (annee, mois, data) =>
    request(`/fiscalite/tva/${annee}/${mois}/statut`, { method: "POST", body: JSON.stringify(data) }),
  fiscaliteExporterTva: (annee, mois, format) =>
    requestDownload(`/fiscalite/tva/${annee}/${mois}/export?format=${format}`, `declaration_tva_${annee}_${String(mois).padStart(2, "0")}.${format}`),
  fiscaliteMajVente: (id, data) => request(`/fiscalite/ventes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  fiscaliteMajAchat: (id, data) => request(`/fiscalite/achats/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  fiscaliteIs: () => request("/fiscalite/is"),
  fiscaliteIsAnnee: (annee) => request(`/fiscalite/is/${annee}`),
  fiscaliteIsSimuler: (annee, saisies) => request(`/fiscalite/is/${annee}/simuler`, { method: "POST", body: JSON.stringify({ saisies }) }),
  fiscaliteIsSaisies: (annee, saisies) => request(`/fiscalite/is/${annee}/saisies`, { method: "PUT", body: JSON.stringify({ saisies }) }),
  fiscaliteIsPreparer: (annee, saisies) => request(`/fiscalite/is/${annee}/preparer`, { method: "POST", body: JSON.stringify({ saisies }) }),
  fiscaliteIsStatut: (annee, data) => request(`/fiscalite/is/${annee}/statut`, { method: "POST", body: JSON.stringify(data) }),
  fiscaliteIsAjouterPaiement: (annee, data) => request(`/fiscalite/is/${annee}/paiements`, { method: "POST", body: JSON.stringify(data) }),
  fiscaliteIsSupprimerPaiement: (id) => request(`/fiscalite/is/paiements/${id}`, { method: "DELETE" }),
  fiscaliteIsAjouterDeficit: (data) => request("/fiscalite/is/deficits", { method: "POST", body: JSON.stringify(data) }),
  fiscaliteIsSupprimerDeficit: (id) => request(`/fiscalite/is/deficits/${id}`, { method: "DELETE" }),
  fiscaliteIsExporter: (annee, format) => requestDownload(`/fiscalite/is/${annee}/export?format=${format}`, `calcul_is_${annee}.${format}`),
  fiscaliteImports: () => request("/fiscalite/import"),
  fiscaliteImportModele: (type) => requestDownload(`/fiscalite/import/modele/${type}`, `modele_${type}_fiscalite.xlsx`),
  fiscaliteImportApercu: (type, formData) => requestUpload(`/fiscalite/import/${type}/apercu`, formData),
  // ---- Paie (module payant) : parametres, dossiers de paie, simulateur ----
  paieEtat: () => request("/paie/etat"),
  paieReglages: () => request("/paie/reglages"),
  paieEnregistrerReglages: (d) => request("/paie/reglages", { method: "PUT", body: JSON.stringify(d) }),
  paieCotisations: () => request("/paie/cotisations"),
  paieSauverCotisation: (d) => request("/paie/cotisations", { method: "POST", body: JSON.stringify(d) }),
  paieSupprimerCotisation: (id) => request(`/paie/cotisations/${id}`, { method: "DELETE" }),
  paieFormuleIr: () => request("/paie/formule-ir"),
  paieEnregistrerFormuleIr: (d) => request("/paie/formule-ir", { method: "PUT", body: JSON.stringify(d) }),
  paieSupprimerFormuleIr: (id) => request(`/paie/formule-ir/${id}`, { method: "DELETE" }),
  paieBaremes: () => request("/paie/baremes"),
  paieImporterBareme: (formData) => requestUpload("/paie/baremes/import", formData),
  paieSupprimerBareme: (id) => request(`/paie/baremes/${id}`, { method: "DELETE" }),
  paieControleBareme: (q) => request(`/paie/baremes/controle?${new URLSearchParams(q).toString()}`),
  paieConventions: () => request("/paie/conventions"),
  paieCreerConvention: (d) => request("/paie/conventions", { method: "POST", body: JSON.stringify(d) }),
  paieModifierConvention: (id, d) => request(`/paie/conventions/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  paieSupprimerConvention: (id) => request(`/paie/conventions/${id}`, { method: "DELETE" }),
  paieGrille: (id, date) => request(`/paie/conventions/${id}/grille${date ? `?date=${date}` : ""}`),
  paieSauverCategorie: (id, d) => request(`/paie/conventions/${id}/categories`, { method: "POST", body: JSON.stringify(d) }),
  paieSupprimerCategorie: (id) => request(`/paie/categories/${id}`, { method: "DELETE" }),
  paieRevaloriser: (id, d) => request(`/paie/conventions/${id}/revalorisation`, { method: "POST", body: JSON.stringify(d) }),
  paieTelechargerGabarit: (id, code) => requestDownload(`/paie/conventions/${id}/gabarit`, `convention_${code || "grille"}.xlsx`),
  paieImporterGrille: (id, formData) => requestUpload(`/paie/conventions/${id}/import`, formData),
  paieRubriques: () => request("/paie/rubriques"),
  paieCreerRubrique: (d) => request("/paie/rubriques", { method: "POST", body: JSON.stringify(d) }),
  paieModifierRubrique: (id, d) => request(`/paie/rubriques/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  paieSupprimerRubrique: (id) => request(`/paie/rubriques/${id}`, { method: "DELETE" }),
  paieTypesAbsence: () => request("/paie/types-absence"),
  paieCreerTypeAbsence: (d) => request("/paie/types-absence", { method: "POST", body: JSON.stringify(d) }),
  paieModifierTypeAbsence: (id, d) => request(`/paie/types-absence/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  paieSupprimerTypeAbsence: (id) => request(`/paie/types-absence/${id}`, { method: "DELETE" }),
  paieComptes: () => request("/paie/comptes"),
  paieEnregistrerComptes: (d) => request("/paie/comptes", { method: "PUT", body: JSON.stringify(d) }),
  paieDossiers: () => request("/paie/dossiers"),
  paieDossier: (employeId) => request(`/paie/dossiers/${employeId}`),
  paieEnregistrerDossier: (employeId, d) => request(`/paie/dossiers/${employeId}`, { method: "PUT", body: JSON.stringify(d) }),
  paieAjouterElement: (employeId, d) => request(`/paie/dossiers/${employeId}/elements`, { method: "POST", body: JSON.stringify(d) }),
  paieModifierElement: (id, d) => request(`/paie/elements/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  paieSupprimerElement: (id) => request(`/paie/elements/${id}`, { method: "DELETE" }),
  paieSimuler: (d) => request("/paie/simulation", { method: "POST", body: JSON.stringify(d) }),
  paieSimulerInverse: (d) => request("/paie/simulation-inverse", { method: "POST", body: JSON.stringify(d) }),
  // ---- Paie : periodes, variables du mois, generation, etats, ordre de virement (PAIE-2) ----
  paiePeriodes: () => request("/paie/periodes"),
  paieOuvrirPeriode: (d) => request("/paie/periodes", { method: "POST", body: JSON.stringify(d || {}) }),
  paiePeriode: (id) => request(`/paie/periodes/${id}`),
  paieAnnulerPeriode: (id) => request(`/paie/periodes/${id}`, { method: "DELETE" }),
  paieGenerer: (id) => request(`/paie/periodes/${id}/generer`, { method: "POST" }),
  paieReferentielsVariables: () => request("/paie/referentiels-variables"),
  paiePeriodeEmployes: (id) => request(`/paie/periodes/${id}/employes`),
  paieVariablesEmploye: (id, employeId) => request(`/paie/periodes/${id}/variables/${employeId}`),
  paieEnregistrerVariables: (id, employeId, d) => request(`/paie/periodes/${id}/variables/${employeId}`, { method: "PUT", body: JSON.stringify(d) }),
  paieGabaritVariables: (id) => requestDownload(`/paie/periodes/${id}/variables-gabarit`, "variables_paie.xlsx"),
  paieImporterVariables: (id, formData) => requestUpload(`/paie/periodes/${id}/variables-import`, formData),
  paieCopierVariables: (id, types) => request(`/paie/periodes/${id}/variables-copie`, { method: "POST", body: JSON.stringify({ types }) }),
  paieDemandesRh: (id) => request(`/paie/periodes/${id}/demandes-rh`),
  paieAppliquerDemandesRh: (id, codeHs) => request(`/paie/periodes/${id}/demandes-rh`, { method: "POST", body: JSON.stringify({ code_hs: codeHs }) }),
  paieBulletin: (id, employeId) => request(`/paie/periodes/${id}/bulletins/${employeId}`),
  paieControles: (id) => request(`/paie/periodes/${id}/controles`),
  paieEtats: (id) => request(`/paie/periodes/${id}/etats`),
  paieExporterEtats: (id, langue) => requestDownload(`/paie/periodes/${id}/etats.xlsx?lang=${langue === "en" ? "en" : "fr"}`, "etats_paie.xlsx"),
  paieOrdreVirement: (id, d) => request(`/paie/periodes/${id}/ordre-virement`, { method: "POST", body: JSON.stringify(d || {}) }),
  paieValider: (id) => request(`/paie/periodes/${id}/valider`, { method: "POST" }),
  paieRouvrir: (id, motif) => request(`/paie/periodes/${id}/rouvrir`, { method: "POST", body: JSON.stringify({ motif }) }),
  paieCloturer: (id) => request(`/paie/periodes/${id}/cloturer`, { method: "POST", body: JSON.stringify({}) }),
  paieComptabilite: (id) => request(`/paie/periodes/${id}/comptabilite`),
  paieComptabiliser: (id) => request(`/paie/periodes/${id}/comptabiliser`, { method: "POST" }),
  paieEtatPeriodique: (annee, trimestre) => request(`/paie/etats-periodiques/${annee}?trimestre=${trimestre || 0}`),
  paieExporterEtatPeriodique: (annee, trimestre, langue) => requestDownload(`/paie/etats-periodiques/${annee}/export.xlsx?trimestre=${trimestre || 0}&lang=${langue === "en" ? "en" : "fr"}`, `etat_paie_${annee}.xlsx`),
  paieOuvrirEtatPeriodiquePdf: (annee, trimestre) => ouvrirPdf(`/paie/etats-periodiques/${annee}/export.pdf?trimestre=${trimestre || 0}`),
  paieProvision: (q) => request(`/paie/retraite/provision?${new URLSearchParams(q).toString()}`),
  paieSauverProvisionLigne: (d) => request("/paie/retraite/provision/ligne", { method: "PUT", body: JSON.stringify(d) }),
  paieSupprimerProvisionLigne: (id) => request(`/paie/retraite/provision/ligne/${id}`, { method: "DELETE" }),
  paieModeleBaremeRetraite: () => request("/paie/retraite/baremes/modele", { method: "POST", body: "{}" }),
  paieExporterProvision: (q, langue) => requestDownload(`/paie/retraite/provision/export.xlsx?${new URLSearchParams({ ...q, lang: langue === "en" ? "en" : "fr" }).toString()}`, `provision_retraite_${q.date_arrete}.xlsx`),
  paieOuvrirProvisionPdf: (q) => ouvrirPdf(`/paie/retraite/provision/export.pdf?${new URLSearchParams(q).toString()}`),
  paieBaremesRetraite: () => request("/paie/retraite/baremes"),
  paieSauverBaremeRetraite: (d) => request("/paie/retraite/baremes", { method: "PUT", body: JSON.stringify(d) }),
  paieSupprimerBaremeRetraite: (id) => request(`/paie/retraite/baremes/${id}`, { method: "DELETE" }),
  paieCalculRetraite: (d) => request("/paie/retraite/calcul", { method: "POST", body: JSON.stringify(d) }),
  paieAppliquerRetraite: (d) => request("/paie/retraite/appliquer", { method: "POST", body: JSON.stringify(d) }),
  paieArchives: () => request("/paie/archives"),
  paieArchive: (id) => request(`/paie/periodes/${id}/archive`),
  paieVerifierArchive: (id) => request(`/paie/periodes/${id}/archive/verification`),
  paieTelechargerArchiveZip: (id) => requestDownload(`/paie/periodes/${id}/archive.zip`, "archive_paie.zip"),
  paieTelechargerFichierArchive: (id, fid, nom) => requestDownload(`/paie/periodes/${id}/archive/fichiers/${fid}?telecharger=1`, nom || "document"),
  fiscaliteImporter: (type, formData) => requestUpload(`/fiscalite/import/${type}`, formData),
  fiscaliteImportSupprimer: (id) => request(`/fiscalite/import/${id}`, { method: "DELETE" }),
  fiscaliteImportAssociesApercu: (formData) => requestUpload("/fiscalite/import/associes/apercu", formData),
  fiscaliteCcaReports: () => request("/fiscalite/cca/reports"),
  fiscaliteCcaAjouterReport: (data) => request("/fiscalite/cca/reports", { method: "POST", body: JSON.stringify(data) }),
  fiscaliteCcaSupprimerReport: (id) => request(`/fiscalite/cca/reports/${id}`, { method: "DELETE" }),
  fiscaliteCalendrier: (annee) => request(`/fiscalite/calendrier/${annee}`),
  fiscaliteSynthese: (annee) => request(`/fiscalite/synthese${annee ? `?annee=${annee}` : ""}`),
  fiscaliteMajSuivi: (cle, data) => request(`/fiscalite/calendrier/suivi/${encodeURIComponent(cle)}`, { method: "PUT", body: JSON.stringify(data) }),
  fiscaliteCel: () => request("/fiscalite/cel"),
  fiscaliteCelAnnee: (annee) => request(`/fiscalite/cel/${annee}`),
  fiscaliteCelSimuler: (annee, saisies) => request(`/fiscalite/cel/${annee}/simuler`, { method: "POST", body: JSON.stringify({ saisies }) }),
  fiscaliteCelSaisies: (annee, saisies) => request(`/fiscalite/cel/${annee}/saisies`, { method: "PUT", body: JSON.stringify({ saisies }) }),
  fiscaliteCelPreparer: (annee, saisies) => request(`/fiscalite/cel/${annee}/preparer`, { method: "POST", body: JSON.stringify({ saisies }) }),
  fiscaliteCelStatut: (annee, data) => request(`/fiscalite/cel/${annee}/statut`, { method: "POST", body: JSON.stringify(data) }),
  fiscaliteCelExporter: (annee, format) => requestDownload(`/fiscalite/cel/${annee}/export?format=${format}`, `cel_${annee}.${format}`),
  fiscaliteCelAjouterLocal: (data) => request("/fiscalite/cel/locaux", { method: "POST", body: JSON.stringify(data) }),
  fiscaliteCelModifierLocal: (id, data) => request(`/fiscalite/cel/locaux/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  fiscaliteCelSupprimerLocal: (id) => request(`/fiscalite/cel/locaux/${id}`, { method: "DELETE" }),
  fiscaliteVehicules: () => request("/fiscalite/vehicules"),
  fiscaliteVehiculesAnnee: (annee) => request(`/fiscalite/vehicules/annee/${annee}`),
  fiscaliteVehiculesPreparer: (annee) => request(`/fiscalite/vehicules/annee/${annee}/preparer`, { method: "POST" }),
  fiscaliteVehiculesStatut: (annee, data) => request(`/fiscalite/vehicules/annee/${annee}/statut`, { method: "POST", body: JSON.stringify(data) }),
  fiscaliteVehiculesExporter: (annee, format) => requestDownload(`/fiscalite/vehicules/annee/${annee}/export?format=${format}`, `taxe_voitures_${annee}.${format}`),
  fiscaliteVehiculeAjouter: (data) => request("/fiscalite/vehicules", { method: "POST", body: JSON.stringify(data) }),
  fiscaliteVehiculeModifier: (id, data) => request(`/fiscalite/vehicules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  fiscaliteVehiculeSupprimer: (id) => request(`/fiscalite/vehicules/${id}`, { method: "DELETE" }),
  fiscaliteConformite: (annee) => request(`/fiscalite/conformite/${annee}`),
  fiscalitePenalitesEstimer: (data) => request("/fiscalite/penalites/estimer", { method: "POST", body: JSON.stringify(data) }),
  // Retenues a la source (lot 4)
  fiscaliteRetenuesResume: (annee) => request(`/fiscalite/retenues/resume/${annee}`),
  fiscaliteRetenuesPeriode: (annee, mois) => request(`/fiscalite/retenues/periode/${annee}/${mois}`),
  fiscaliteRetenuesPreparer: (annee, mois) => request(`/fiscalite/retenues/periode/${annee}/${mois}/preparer`, { method: "POST", body: JSON.stringify({}) }),
  fiscaliteRetenuesStatut: (annee, mois, data) => request(`/fiscalite/retenues/periode/${annee}/${mois}/statut`, { method: "POST", body: JSON.stringify(data) }),
  fiscaliteRetenuesPropositions: (annee, mois) => request(`/fiscalite/retenues/periode/${annee}/${mois}/propositions`, { method: "POST", body: JSON.stringify({}) }),
  fiscaliteRetenuesPropositionsCompta: (annee, mois) => request(`/fiscalite/retenues/periode/${annee}/${mois}/propositions-compta`, { method: "POST", body: JSON.stringify({}) }),
  fiscaliteRetenuesConfirmerCoherentes: (annee, mois) => request(`/fiscalite/retenues/periode/${annee}/${mois}/confirmer-coherentes`, { method: "POST", body: JSON.stringify({}) }),
  fiscaliteComptes: () => request("/fiscalite/comptes"),
  fiscaliteComptesEnregistrer: (data) => request("/fiscalite/comptes", { method: "PUT", body: JSON.stringify(data) }),
  fiscaliteRetenuesParametres: () => request("/fiscalite/retenues/parametres"),
  fiscaliteRetenuesParametresEnregistrer: (data) => request("/fiscalite/retenues/parametres", { method: "PUT", body: JSON.stringify(data) }),
  fiscaliteRetenuesPropositionsCca: (annee) => request(`/fiscalite/retenues/propositions-cca/${annee}`, { method: "POST", body: JSON.stringify({}) }),
  fiscaliteRetenuesRapprochement: (annee, mois) => request(`/fiscalite/retenues/periode/${annee}/${mois}/rapprochement`),
  fiscaliteRetenuesExporter: (annee, mois, format) =>
    requestDownload(`/fiscalite/retenues/periode/${annee}/${mois}/export?format=${format}`, `retenues_${annee}_${String(mois).padStart(2, "0")}.${format}`),
  fiscaliteRetenuesTrimestre: (annee, trimestre) => request(`/fiscalite/retenues/trimestre/${annee}/${trimestre}`),
  fiscaliteRetenuesTrimestreExporter: (annee, trimestre, format) =>
    requestDownload(`/fiscalite/retenues/trimestre/${annee}/${trimestre}/export?format=${format}`, `etat_trimestriel_retenues_${annee}_T${trimestre}.${format}`),
  fiscaliteRetenueCreer: (data) => request("/fiscalite/retenues/operations", { method: "POST", body: JSON.stringify(data) }),
  fiscaliteRetenueModifier: (id, data) => request(`/fiscalite/retenues/operations/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  fiscaliteRetenueSupprimer: (id) => request(`/fiscalite/retenues/operations/${id}`, { method: "DELETE" }),
  fiscaliteRetenuesModele: () => requestDownload("/fiscalite/retenues/modele", "modele_retenues_a_la_source.xlsx"),
  fiscaliteRetenuesImportApercu: (formData) => requestUpload("/fiscalite/retenues/import/apercu", formData),
  fiscaliteRetenuesImporter: (formData) => requestUpload("/fiscalite/retenues/import", formData),
  fiscalitePenalites: (params) => request(`/fiscalite/penalites?${new URLSearchParams(params).toString()}`),
  comptaExporter: (etat, format, params = {}) =>
    requestDownload(
      `/comptabilite/${etat}/export?${new URLSearchParams({ ...params, format }).toString()}`,
      `${String(etat).replace(/\//g, "_")}.${format}`
    ),
  comptaAudit: () => request("/comptabilite/audit"),
  // --- Comptabilite phase 2 : ecritures en instance (ventes automatiques) ---
  comptaInstance: (params = {}) => request(`/comptabilite/instance?${new URLSearchParams(params).toString()}`),
  comptaInstanceResume: () => request("/comptabilite/instance/resume"),
  comptaValiderInstance: (ids) => request("/comptabilite/instance/valider", { method: "POST", body: JSON.stringify(ids ? { ids } : {}) }),
  comptaRattrapage: (depuis) => request("/comptabilite/instance/rattrapage", { method: "POST", body: JSON.stringify(depuis ? { depuis } : {}) }),
  comptaChangerCompte: (ligneId, data) => request(`/comptabilite/lignes/${ligneId}/compte`, { method: "PATCH", body: JSON.stringify(data) }),
  // --- Comptabilite : import Sage (grand livre, balance) ---
  comptaImportModele: (type) => requestDownload(`/comptabilite/import/modele/${type}`, `modele_import_${type}.xlsx`),
  comptaImportApercu: (type, formData) => requestUpload(`/comptabilite/import/${type}/apercu`, formData),
  comptaImporter: (type, formData) => requestUpload(`/comptabilite/import/${type}`, formData),
  comptaImportLots: () => request("/comptabilite/import/lots"),
  comptaImportAnnuler: (id) => request(`/comptabilite/import/lots/${id}/annuler`, { method: "POST" }),
  comptaRegles: () => request("/comptabilite/regles-compte-vente"),
  comptaSupprimerRegle: (id) => request(`/comptabilite/regles-compte-vente/${id}`, { method: "DELETE" }),
  comptaAchatsFournisseurs: () => request("/comptabilite/achats/fournisseurs"),
  comptaAchatsCreerFournisseur: (data) => request("/comptabilite/achats/fournisseurs", { method: "POST", body: JSON.stringify(data) }),
  comptaAchatsFactures: (params = {}) => request(`/comptabilite/achats/factures?${new URLSearchParams(params).toString()}`),
  comptaAchatsFacture: (id) => request(`/comptabilite/achats/factures/${id}`),
  comptaAchatsCreerFacture: (data) => request("/comptabilite/achats/factures", { method: "POST", body: JSON.stringify(data) }),
  comptaAchatsAnnulerFacture: (id) => request(`/comptabilite/achats/factures/${id}/annuler`, { method: "POST" }),
  comptaAchatsReglements: (params = {}) => request(`/comptabilite/achats/reglements?${new URLSearchParams(params).toString()}`),
  comptaAchatsReglement: (id) => request(`/comptabilite/achats/reglements/${id}`),
  comptaAchatsCreerReglement: (data) => request("/comptabilite/achats/reglements", { method: "POST", body: JSON.stringify(data) }),
  comptaAchatsAnnulerReglement: (id) => request(`/comptabilite/achats/reglements/${id}/annuler`, { method: "POST" }),
  // --- Comptabilite phase 3B : encaissements clients, lettrage, balances tiers, balance agee ---
  comptaEncaissementsClients: () => request("/comptabilite/encaissements/clients"),
  comptaEncaissementsFactures: (tiersId) => request(`/comptabilite/encaissements/factures?${new URLSearchParams({ tiers_id: tiersId }).toString()}`),
  comptaEncaissementsReglements: (params = {}) => request(`/comptabilite/encaissements/reglements?${new URLSearchParams(params).toString()}`),
  comptaEncaissementsReglement: (id) => request(`/comptabilite/encaissements/reglements/${id}`),
  comptaEncaissementsCreerReglement: (data) => request("/comptabilite/encaissements/reglements", { method: "POST", body: JSON.stringify(data) }),
  comptaEncaissementsAnnulerReglement: (id) => request(`/comptabilite/encaissements/reglements/${id}/annuler`, { method: "POST" }),
  comptaLettrageLignes: (params = {}) => request(`/comptabilite/lettrage/lignes?${new URLSearchParams(params).toString()}`),
  comptaLettrer: (ligneIds) => request("/comptabilite/lettrage/lettrer", { method: "POST", body: JSON.stringify({ ligne_ids: ligneIds }) }),
  comptaDelettrer: (code) => request("/comptabilite/lettrage/delettrer", { method: "POST", body: JSON.stringify({ code }) }),
  comptaLettrageAuto: () => request("/comptabilite/lettrage/automatique", { method: "POST" }),
  comptaBalanceTiers: (params = {}) => request(`/comptabilite/balance-tiers?${new URLSearchParams(params).toString()}`),
  comptaFacturesEmises: (params = {}) => request(`/comptabilite/factures-emises?${new URLSearchParams(params).toString()}`),
  comptaBalanceAgee: (params = {}) => request(`/comptabilite/balance-agee?${new URLSearchParams(params).toString()}`),
  // --- Comptabilite phase 3C : analytique par dossier ---
  comptaAnalytiqueSections: (params = {}) => request(`/comptabilite/analytique/sections?${new URLSearchParams(params).toString()}`),
  comptaAnalytiqueCreerSection: (data) => request("/comptabilite/analytique/sections", { method: "POST", body: JSON.stringify(data) }),
  comptaAnalytiqueModifierSection: (id, data) => request(`/comptabilite/analytique/sections/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  comptaAnalytiqueResultats: (params = {}) => request(`/comptabilite/analytique/resultats?${new URLSearchParams(params).toString()}`),
  comptaAnalytiqueDossier: (params = {}) => request(`/comptabilite/analytique/dossier?${new URLSearchParams(params).toString()}`),
  comptaAnalytiqueGrandLivre: (params = {}) => request(`/comptabilite/analytique/grand-livre?${new URLSearchParams(params).toString()}`),
  comptaAnalytiqueAVentiler: (params = {}) => request(`/comptabilite/analytique/a-ventiler?${new URLSearchParams(params).toString()}`),
  comptaAnalytiqueVentilerLigne: (ligneId, ventilations) => request(`/comptabilite/analytique/lignes/${ligneId}`, { method: "PUT", body: JSON.stringify({ ventilations }) }),
  comptaAnalytiqueVentilerLot: (data) => request("/comptabilite/analytique/ventiler-lot", { method: "POST", body: JSON.stringify(data) }),
  comptaAnalytiqueHeritageVentes: () => request("/comptabilite/analytique/heritage-ventes", { method: "POST" }),
  // --- Comptabilite phase 4 : etats financiers (bilan, compte de resultat) et immobilisations ---
  comptaEtatBilan: (params = {}) => request(`/comptabilite/etats/bilan?${new URLSearchParams(params).toString()}`),
  comptaEtatResultat: (params = {}) => request(`/comptabilite/etats/resultat?${new URLSearchParams(params).toString()}`),
  comptaImmobilisations: (params = {}) => request(`/comptabilite/immobilisations?${new URLSearchParams(params).toString()}`),
  comptaImmoAImmobiliser: (params = {}) => request(`/comptabilite/immobilisations/a-immobiliser?${new URLSearchParams(params).toString()}`),
  comptaImmoIgnorerLigne: (ligneId, ignorer = true) => request(`/comptabilite/immobilisations/lignes/${ligneId}/ignorer`, { method: "POST", body: JSON.stringify({ ignorer }) }),
  comptaImmoDetail: (id) => request(`/comptabilite/immobilisations/${id}`),
  comptaImmoCreer: (data) => request("/comptabilite/immobilisations", { method: "POST", body: JSON.stringify(data) }),
  comptaImmoModifier: (id, data) => request(`/comptabilite/immobilisations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  comptaImmoSupprimer: (id) => request(`/comptabilite/immobilisations/${id}`, { method: "DELETE" }),
  comptaImmoApercuDotations: (params = {}) => request(`/comptabilite/immobilisations/dotations/apercu?${new URLSearchParams(params).toString()}`),
  comptaImmoGenererDotations: (exerciceId) => request("/comptabilite/immobilisations/dotations/generer", { method: "POST", body: JSON.stringify({ exercice_id: exerciceId }) }),
  comptaImmoAnnulerDotations: (exerciceId) => request("/comptabilite/immobilisations/dotations/annuler", { method: "POST", body: JSON.stringify({ exercice_id: exerciceId }) }),
  comptaImmoSortie: (id, data) => request(`/comptabilite/immobilisations/${id}/sortie`, { method: "POST", body: JSON.stringify(data) }),
  comptaImmoAnnulerSortie: (id) => request(`/comptabilite/immobilisations/${id}/annuler-sortie`, { method: "POST" }),
  comptaImmoTableau: (params = {}) => request(`/comptabilite/immobilisations/tableau?${new URLSearchParams(params).toString()}`),
  ventesSectionsAnalytiques: () => request("/ventes/sections-analytiques"),
  modifierDevisSectionAnalytique: (id, sectionId) => request(`/ventes/devis/${id}/section-analytique`, { method: "PATCH", body: JSON.stringify({ section_analytique_id: sectionId || null }) }),
  comptaTresorerieComptes: () => request("/comptabilite/tresorerie/comptes"),
  comptaTresorerieCreerCompte: (data) => request("/comptabilite/tresorerie/comptes", { method: "POST", body: JSON.stringify(data) }),
  comptaTresorerieMouvement: (data) => request("/comptabilite/tresorerie/mouvements", { method: "POST", body: JSON.stringify(data) }),
};
