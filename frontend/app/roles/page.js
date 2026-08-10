"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

// Gestion des roles du tenant (reserve ADMIN cote backend - voir
// requireRole("ADMIN") dans routes/roles.js). Les roles sont librement
// definis par chaque entreprise cliente : pas de liste figee, chaque
// tenant cree les siens (commercial, juridique, logistique...).
export default function RolesPage() {
  const { t } = useLangue();
  const [roles, setRoles] = useState([]);
  const [erreur, setErreur] = useState("");
  const [form, setForm] = useState({ code: "", libelle: "" });
  const [enEdition, setEnEdition] = useState(null); // id du role en cours d'edition
  const [libelleEdition, setLibelleEdition] = useState("");

  useEffect(() => {
    charger();
  }, []);

  function charger() {
    api.getRoles().then(setRoles).catch((err) => setErreur(err.message));
  }

  async function handleCreer(e) {
    e.preventDefault();
    setErreur("");
    if (!form.code.trim() || !form.libelle.trim()) {
      setErreur(t("roleFormError"));
      return;
    }
    try {
      const nouveau = await api.createRole(form);
      setRoles((prev) => [...prev, nouveau].sort((a, b) => a.libelle.localeCompare(b.libelle)));
      setForm({ code: "", libelle: "" });
    } catch (err) {
      setErreur(err.message);
    }
  }

  function commencerEdition(role) {
    setEnEdition(role.id);
    setLibelleEdition(role.libelle);
  }

  async function handleEnregistrerEdition(roleId) {
    setErreur("");
    try {
      const maj = await api.patchRole(roleId, { libelle: libelleEdition });
      setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, ...maj } : r)));
      setEnEdition(null);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSupprimer(roleId) {
    if (typeof window !== "undefined" && !window.confirm(t("roleDeleteConfirm"))) return;
    setErreur("");
    try {
      await api.supprimerRole(roleId);
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <AppShell title={t("rolesPageTitle")}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <form onSubmit={handleCreer} className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
        <label style={labelStyle}>{t("roleCodeLabel")}</label>
        <input
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          placeholder="EX: JURIDIQUE"
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("roleLabelLabel")}</label>
        <input
          value={form.libelle}
          onChange={(e) => setForm((f) => ({ ...f, libelle: e.target.value }))}
          style={inputStyle}
        />
        <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12 }}>
          {t("newRole")}
        </button>
      </form>

      {roles.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noRoles")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {roles.map((role) => (
            <div
              key={role.id}
              className="card"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
            >
              <div style={{ flex: 1 }}>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--sub)" }}>
                  {role.code}
                </div>
                {enEdition === role.id ? (
                  <input
                    autoFocus
                    value={libelleEdition}
                    onChange={(e) => setLibelleEdition(e.target.value)}
                    style={{ ...inputStyle, marginTop: 4, maxWidth: 260 }}
                  />
                ) : (
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{role.libelle}</div>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--sub)", whiteSpace: "nowrap" }}>
                {role.nombre_utilisateurs} {t("usersCountLabel")}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {enEdition === role.id ? (
                  <button onClick={() => handleEnregistrerEdition(role.id)} style={boutonSecondaireStyle}>
                    {t("save")}
                  </button>
                ) : (
                  <button onClick={() => commencerEdition(role)} style={boutonSecondaireStyle}>
                    {t("editRole")}
                  </button>
                )}
                <button onClick={() => handleSupprimer(role.id)} style={boutonDangerStyle}>
                  {t("deleteRole")}
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
