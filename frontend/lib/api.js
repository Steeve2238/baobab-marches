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
    throw new Error(data.error || `Erreur ${res.status}`);
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
    throw new Error(data.error || `Erreur ${res.status}`);
  }
  return data;
}

export const api = {
  login: (email, mot_de_passe) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, mot_de_passe }) }),
  getDossiers: () => request("/dossiers"),
  getDossier: (id) => request(`/dossiers/${id}`),
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
};
