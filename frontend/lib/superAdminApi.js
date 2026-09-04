import { getLangueLocale } from "./api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

// Client API dedie a l'espace Super Admin (proprietaire de la plateforme,
// Steeve) - entierement independant de lib/api.js (utilise par les
// personnes des entreprises clientes). Cle de stockage du token differente
// pour que les deux sessions (Super Admin / client) puissent coexister sans
// jamais se melanger dans le meme navigateur. Voir cote backend
// routes/superAdmin.js et middleware/auth.js (requireSuperAdmin) pour le
// pendant serveur de cette separation.
const TOKEN_KEY = "baobab_super_admin_token";
const PROFIL_KEY = "baobab_super_admin_profil";

function getToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setSuperAdminToken(token) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearSuperAdminToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
}

export function estSuperAdminConnecte() {
  return !!getToken();
}

export function setSuperAdminCourant(admin) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROFIL_KEY, JSON.stringify(admin || {}));
}

export function getSuperAdminCourant() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(PROFIL_KEY) || "null");
  } catch {
    return null;
  }
}

export function clearSuperAdminCourant() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PROFIL_KEY);
}

async function request(path, options = {}) {
  const token = getToken();
  // La preference de langue (baobab_langue) reste volontairement partagee
  // avec lib/api.js : c'est un simple reglage d'affichage du navigateur,
  // pas une donnee de session - aucun risque a la partager entre les deux
  // espaces.
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

export const superAdminApi = {
  login: (email, mot_de_passe) =>
    request("/super-admin/auth/login", { method: "POST", body: JSON.stringify({ email, mot_de_passe }) }),
  changerMotDePasse: (nouveau_mot_de_passe) =>
    request("/super-admin/auth/changer-mot-de-passe", {
      method: "POST",
      body: JSON.stringify({ nouveau_mot_de_passe }),
    }),

  getStatistiques: () => request("/super-admin/statistiques"),

  getClients: () => request("/super-admin/clients"),
  getClient: (id) => request(`/super-admin/clients/${id}`),
  createClient: (data) => request("/super-admin/clients", { method: "POST", body: JSON.stringify(data) }),
  patchClient: (id, data) =>
    request(`/super-admin/clients/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  suspendreClient: (id) => request(`/super-admin/clients/${id}/suspendre`, { method: "PATCH" }),
  reactiverClient: (id) => request(`/super-admin/clients/${id}/reactiver`, { method: "PATCH" }),

  getFormules: () => request("/super-admin/formules"),
  createFormule: (data) => request("/super-admin/formules", { method: "POST", body: JSON.stringify(data) }),
  patchFormule: (id, data) =>
    request(`/super-admin/formules/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  getFactures: (statut) => request(`/super-admin/factures${statut ? `?statut=${statut}` : ""}`),
  getFacturesClient: (clientId) => request(`/super-admin/clients/${clientId}/factures`),
  genererFacture: (clientId, periode) =>
    request(`/super-admin/clients/${clientId}/factures/generer`, {
      method: "POST",
      body: JSON.stringify(periode ? { periode } : {}),
    }),
  genererFactureInstallation: (clientId, periode) =>
    request(`/super-admin/clients/${clientId}/factures/generer-installation`, {
      method: "POST",
      body: JSON.stringify(periode ? { periode } : {}),
    }),
  marquerFacturePayee: (id, data) =>
    request(`/super-admin/factures/${id}/marquer-payee`, { method: "PATCH", body: JSON.stringify(data) }),
  annulerFacture: (id) => request(`/super-admin/factures/${id}/annuler`, { method: "PATCH" }),
};
