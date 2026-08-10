"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

const FORM_VIDE = { nom: "", prenom: "", email: "", role_ids: [] };

// Gestion des utilisateurs du tenant (reserve ADMIN cote backend). Le mot de
// passe temporaire genere a la creation ou lors d'une reinitialisation n'est
// jamais renvoye par le backend apres son affichage initiale (aucun service
// d'email configure sur Railway) : il faut le communiquer manuellement a la
// personne concernee avant de fermer la fenetre.
export default function UtilisateursPage() {
  const { t } = useLangue();
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [roles, setRoles] = useState([]);
  const [erreur, setErreur] = useState("");
  const [form, setForm] = useState(FORM_VIDE);
  const [motDePasseAffiche, setMotDePasseAffiche] = useState(null); // { nom, mot_de_passe }

  useEffect(() => {
    api.getUtilisateurs().then(setUtilisateurs).catch((err) => setErreur(err.message));
    api.getRoles().then(setRoles).catch((err) => setErreur(err.message));
  }, []);

  function toggleRole(roleId) {
    setForm((f) => ({
      ...f,
      role_ids: f.role_ids.includes(roleId)
        ? f.role_ids.filter((id) => id !== roleId)
        : [...f.role_ids, roleId],
    }));
  }

  async function handleCreer(e) {
    e.preventDefault();
    setErreur("");
    if (form.role_ids.length === 0) {
      setErreur(t("selectAtLeastOneRole"));
      return;
    }
    try {
      const nouveau = await api.createUtilisateur(form);
      setUtilisateurs((prev) => [...prev, nouveau]);
      setMotDePasseAffiche({
        nom: `${nouveau.prenom} ${nouveau.nom}`,
        mot_de_passe: nouveau.mot_de_passe_temporaire_genere,
      });
      setForm(FORM_VIDE);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleToggleActif(utilisateur) {
    setErreur("");
    try {
      const maj = await api.patchUtilisateur(utilisateur.id, { actif: !utilisateur.actif });
      setUtilisateurs((prev) => prev.map((u) => (u.id === utilisateur.id ? { ...u, ...maj } : u)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleReinitialiser(utilisateur) {
    setErreur("");
    try {
      const { mot_de_passe_temporaire_genere } = await api.reinitialiserMotDePasse(utilisateur.id);
      setMotDePasseAffiche({
        nom: `${utilisateur.prenom} ${utilisateur.nom}`,
        mot_de_passe: mot_de_passe_temporaire_genere,
      });
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSupprimer(utilisateur) {
    if (typeof window !== "undefined" && !window.confirm(t("userDeleteConfirm"))) return;
    setErreur("");
    try {
      await api.supprimerUtilisateur(utilisateur.id);
      setUtilisateurs((prev) => prev.filter((u) => u.id !== utilisateur.id));
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <AppShell title={t("usersPageTitle")}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {motDePasseAffiche && (
        <div
          className="card"
          style={{ marginBottom: 16, border: "1px solid var(--ocre)", background: "rgba(224,149,76,0.08)" }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
            {t("tempPasswordGenerated")} — {motDePasseAffiche.nom}
          </div>
          <div style={{ fontSize: 12, color: "var(--sub)", marginBottom: 6 }}>{t("tempPasswordWarning")}</div>
          <div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>
            {motDePasseAffiche.mot_de_passe}
          </div>
          <button
            onClick={() => setMotDePasseAffiche(null)}
            style={{ ...boutonSecondaireStyle, marginTop: 10 }}
          >
            {t("close")}
          </button>
        </div>
      )}

      <form onSubmit={handleCreer} className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
        <label style={labelStyle}>{t("firstNameLabel")}</label>
        <input
          required
          value={form.prenom}
          onChange={(e) => setForm((f) => ({ ...f, prenom: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("lastNameLabel")}</label>
        <input
          required
          value={form.nom}
          onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("userEmailLabel")}</label>
        <input
          required
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("userRolesLabel")}</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {roles.map((role) => (
            <label
              key={role.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: "5px 8px",
              }}
            >
              <input
                type="checkbox"
                checked={form.role_ids.includes(role.id)}
                onChange={() => toggleRole(role.id)}
              />
              {role.libelle}
            </label>
          ))}
        </div>
        <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12 }}>
          {t("createUserButton")}
        </button>
      </form>

      {utilisateurs.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noUsers")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {utilisateurs.map((utilisateur) => (
            <div key={utilisateur.id} className="card" style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {utilisateur.prenom} {utilisateur.nom}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--sub)" }}>{utilisateur.email}</div>
                </div>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: 20,
                    color: utilisateur.actif ? "#2E7D5B" : "var(--brique)",
                    background: utilisateur.actif ? "rgba(46,125,91,0.12)" : "rgba(196,74,58,0.1)",
                  }}
                >
                  {utilisateur.actif ? t("activeLabel") : t("inactiveLabel")}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--sub)" }}>
                {utilisateur.roles.map((r) => r.libelle).join(", ") || "—"}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => handleToggleActif(utilisateur)} style={boutonSecondaireStyle}>
                  {utilisateur.actif ? t("deactivateUser") : t("reactivateUser")}
                </button>
                <button onClick={() => handleReinitialiser(utilisateur)} style={boutonSecondaireStyle}>
                  {t("resetPasswordAction")}
                </button>
                <button onClick={() => handleSupprimer(utilisateur)} style={boutonDangerStyle}>
                  {t("deleteUser")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
};
const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
};
const boutonSecondaireStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const boutonDangerStyle = {
  background: "transparent",
  color: "var(--brique)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
