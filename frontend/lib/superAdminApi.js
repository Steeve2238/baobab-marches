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

// Variante pour l'upload de fichier (logo) : pas de "Content-Type" force a
// JSON, le navigateur doit fixer lui-meme le boundary multipart - meme
// principe que requestUpload() dans lib/api.js (espace client).
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

// Telechargement d'un fichier protege par le jeton (PDF d'offre ou de contrat, contrat signe) : fetch + blob + lien temporaire.
async function telecharger(path, nomParDefaut) {
  const token = getToken();
  const langue = getLangueLocale() || "fr";
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: { "Accept-Language": langue, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const erreur = new Error(data.error || `Erreur ${res.status}`);
    erreur.status = res.status;
    throw erreur;
  }
  const blob = await res.blob();
  const dispo = res.headers.get("content-disposition") || "";
  const m = /filename="?([^";]+)"?/i.exec(dispo);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (m && m[1]) || nomParDefaut;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export const superAdminApi = {
  login: (email, mot_de_passe) =>
    request("/super-admin/auth/login", { method: "POST", body: JSON.stringify({ email, mot_de_passe }) }),
  changerMotDePasse: (nouveau_mot_de_passe) =>
    request("/super-admin/auth/changer-mot-de-passe", {
      method: "POST",
      body: JSON.stringify({ nouveau_mot_de_passe }),
    }),
  demanderReinitialisationMotDePasse: (email) =>
    request("/super-admin/auth/mot-de-passe-oublie", { method: "POST", body: JSON.stringify({ email }) }),
  reinitialiserMotDePasse: (jeton, nouveau_mot_de_passe) =>
    request("/super-admin/auth/reinitialiser-mot-de-passe", {
      method: "POST",
      body: JSON.stringify({ jeton, nouveau_mot_de_passe }),
    }),

  getStatistiques: () => request("/super-admin/statistiques"),

  getClients: () => request("/super-admin/clients"),
  getClient: (id) => request(`/super-admin/clients/${id}`),
  createClient: (data) => request("/super-admin/clients", { method: "POST", body: JSON.stringify(data) }),
  patchClient: (id, data) =>
    request(`/super-admin/clients/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  suspendreClient: (id) => request(`/super-admin/clients/${id}/suspendre`, { method: "PATCH" }),
  reactiverClient: (id) => request(`/super-admin/clients/${id}/reactiver`, { method: "PATCH" }),
  patchModuleComptabilite: (id, data) =>
    request(`/super-admin/clients/${id}/module-comptabilite`, { method: "PATCH", body: JSON.stringify(data) }),
  patchModuleFiscalite: (id, data) =>
    request(`/super-admin/clients/${id}/module-fiscalite`, { method: "PATCH", body: JSON.stringify(data) }),
  patchModulePaie: (id, data) =>
    request(`/super-admin/clients/${id}/module-paie`, { method: "PATCH", body: JSON.stringify(data) }),

  patchProfilActivite: (id, profil_activite) =>
    request(`/super-admin/clients/${id}/profil-activite`, { method: "PATCH", body: JSON.stringify({ profil_activite }) }),
  patchModeHebergement: (id, mode) =>
    request(`/super-admin/clients/${id}/mode-hebergement`, { method: "PATCH", body: JSON.stringify({ mode }) }),
  getLicencesClient: (id) => request(`/super-admin/clients/${id}/licences`),
  genererLicence: (id, data) =>
    request(`/super-admin/clients/${id}/licence`, { method: "POST", body: JSON.stringify(data || {}) }),
  getEtatLicences: () => request("/super-admin/licences/etat"),

  getFormules: () => request("/super-admin/formules"),
  createFormule: (data) => request("/super-admin/formules", { method: "POST", body: JSON.stringify(data) }),
  patchFormule: (id, data) =>
    request(`/super-admin/formules/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  getParametresEntete: () => request("/super-admin/parametres/entete"),
  patchParametresEntete: (data) =>
    request("/super-admin/parametres/entete", { method: "PATCH", body: JSON.stringify(data) }),
  uploaderLogoEntete: (fichier) => {
    const formData = new FormData();
    formData.append("logo", fichier);
    return requestUpload("/super-admin/parametres/entete/logo", formData);
  },
  supprimerLogoEntete: () => request("/super-admin/parametres/entete/logo", { method: "DELETE" }),
  // Signature + cachet : une seule image combinee (le cachet est scanne avec
  // la signature dessus), affichee en bas a droite des factures sous la
  // mention "La Direction" - meme mecanisme d'upload que le logo ci-dessus.
  uploaderSignatureCachetEntete: (fichier) => {
    const formData = new FormData();
    formData.append("signature_cachet", fichier);
    return requestUpload("/super-admin/parametres/entete/signature-cachet", formData);
  },
  supprimerSignatureCachetEntete: () =>
    request("/super-admin/parametres/entete/signature-cachet", { method: "DELETE" }),

  getFactures: (statut) => request(`/super-admin/factures${statut ? `?statut=${statut}` : ""}`),
  getFacture: (id) => request(`/super-admin/factures/${id}`),
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

  // --- Offres commerciales et contrats ---
  getOffres: (query = "") => request(`/super-admin/offres${query}`),
  getOffre: (id) => request(`/super-admin/offres/${id}`),
  proposerLignesOffre: (query) => request(`/super-admin/offres/proposition?${query}`),
  creerOffre: (data) => request("/super-admin/offres", { method: "POST", body: JSON.stringify(data) }),
  modifierOffre: (id, data) => request(`/super-admin/offres/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  telechargerOffre: (id) => telecharger(`/super-admin/offres/${id}/pdf`, "offre.pdf"),
  envoyerOffre: (id, data) => request(`/super-admin/offres/${id}/envoyer`, { method: "POST", body: JSON.stringify(data) }),
  accepterOffre: (id, data) => request(`/super-admin/offres/${id}/accepter`, { method: "POST", body: JSON.stringify(data) }),
  refuserOffre: (id, data) => request(`/super-admin/offres/${id}/refuser`, { method: "POST", body: JSON.stringify(data) }),
  annulerOffre: (id) => request(`/super-admin/offres/${id}/annuler`, { method: "POST", body: JSON.stringify({}) }),
  getContrats: (query = "") => request(`/super-admin/contrats${query}`),
  getContrat: (id) => request(`/super-admin/contrats/${id}`),
  regenererContrat: (id, data) => request(`/super-admin/contrats/${id}/regenerer`, { method: "POST", body: JSON.stringify(data || {}) }),
  telechargerContrat: (id) => telecharger(`/super-admin/contrats/${id}/pdf`, "contrat.pdf"),
  envoyerContrat: (id, data) => request(`/super-admin/contrats/${id}/envoyer`, { method: "POST", body: JSON.stringify(data) }),
  deposerContratSigne: (id, fichier, dateSignature) => {
    const fd = new FormData();
    if (dateSignature) fd.append("date_signature", dateSignature);
    fd.append("fichier", fichier);
    return requestUpload(`/super-admin/contrats/${id}/signe`, fd);
  },
  telechargerContratSigne: (id) => telecharger(`/super-admin/contrats/${id}/signe`, "contrat-signe.pdf"),
};
