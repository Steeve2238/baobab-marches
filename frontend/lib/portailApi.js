import { getLangueLocale } from "./api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

// Client API de la page publique de remise des documents (aucun compte de la plateforme) : l'acces repose sur le lien,
// l'identifiant et le code ; la session obtenue (jeton court) est passee en parametre, jamais stockee dans lib/api.js.
async function requete(path, { session, method = "GET", body, blob = false } = {}) {
  const headers = { "Accept-Language": getLangueLocale() || "fr", ...(body ? { "Content-Type": "application/json" } : {}), ...(session ? { Authorization: `Bearer ${session}` } : {}) };
  const res = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const erreur = new Error(data.error || `Erreur ${res.status}`);
    erreur.status = res.status;
    erreur.code = data.code;
    erreur.details = data.details;
    throw erreur;
  }
  return blob ? res.blob() : res.json();
}

export const portailApi = {
  info: (token) => requete(`/portail/${token}`),
  acces: (token, identifiant, code) => requete(`/portail/${token}/acces`, { method: "POST", body: { identifiant, code } }),
  document: (token, session) => requete(`/portail/${token}/document`, { session }),
  pdf: (token, session, telecharger = false) => requete(`/portail/${token}/pdf${telecharger ? "?dl=1" : ""}`, { session, blob: true }),
  signer: (token, session, data) => requete(`/portail/${token}/signer`, { session, method: "POST", body: data }),
};
