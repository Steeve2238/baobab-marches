"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

export default function CircuitApprobationPage() {
  const { t } = useLangue();
  const [roles, setRoles] = useState([]);
  const [mapping, setMapping] = useState({}); // role_demandeur_id -> role_approbateur_id ("" = pas de regle)
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    Promise.all([api.getRoles(), api.getReglesApprobationRH()])
      .then(([rolesData, regles]) => {
        setRoles(rolesData);
        const m = {};
        for (const r of regles) {
          m[r.role_demandeur_id] = r.role_approbateur_id;
        }
        setMapping(m);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  async function handleEnregistrer() {
    setEnCours(true);
    setErreur("");
    setMessage("");
    try {
      const regles = Object.entries(mapping)
        .filter(([, approbateurId]) => approbateurId)
        .map(([role_demandeur_id, role_approbateur_id]) => ({ role_demandeur_id, role_approbateur_id }));
      await api.patchReglesApprobationRH(regles);
      setMessage(t("reglesUpdated"));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  const rolesNonAdmin = roles.filter((r) => r.code !== "ADMIN");

  return (
    <AppShell title={t("circuitApprobationPageTitle")}>
      <Link href="/rh/personnel" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>
        {t("backToPersonnel")}
      </Link>

      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 16, maxWidth: 640 }}>
        {t("circuitApprobationPageSubtitle")}
      </p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : (
        <div className="card" style={{ maxWidth: 560 }}>
          {rolesNonAdmin.map((role) => (
            <div key={role.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>
                  {t("roleDemandeurLabel")}
                </div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{role.libelle}</div>
              </div>
              <select
                value={mapping[role.id] || ""}
                onChange={(e) => setMapping((m) => ({ ...m, [role.id]: e.target.value }))}
                style={inputStyle}
              >
                <option value="">{t("selectRoleApprobateur")}</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.libelle}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <button onClick={handleEnregistrer} disabled={enCours} style={{ ...boutonPrincipalStyle, marginTop: 8 }}>
            {enCours ? t("savingRegles") : t("saveReglesButton")}
          </button>
        </div>
      )}
    </AppShell>
  );
}

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
