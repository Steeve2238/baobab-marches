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

export const api = {
  login: (email, mot_de_passe) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, mot_de_passe }) }),
  getDossiers: () => request("/dossiers"),
  getDossier: (id) => request(`/dossiers/${id}`),
  getSignaux: () => request("/signaux"),
  acquitterSignal: (id) => request(`/signaux/${id}/acquitter`, { method: "PATCH" }),
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
};
