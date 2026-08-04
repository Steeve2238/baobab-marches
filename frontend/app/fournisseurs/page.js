"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import { PAYS } from "../../lib/constants/pays";

export default function FournisseursPage() {
  const { t } = useLangue();
  const [fournisseurs, setFournisseurs] = useState([]);
  const [erreur, setErreur] = useState("");
  const [form, setForm] = useState({ nom: "", pays: "" });

  useEffect(() => {
    api.getFournisseurs().then(setFournisseurs).catch((err) => setErreur(err.message));
  }, []);

  async function handleAjouter(e) {
    e.preventDefault();
    try {
      const nouveau = await api.createFournisseur(form);
      setFournisseurs((prev) => [...prev, nouveau]);
      setForm({ nom: "", pays: "" });
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <AppShell title={t("suppliersPageTitle")}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <form onSubmit={handleAjouter} className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
        <label style={labelStyle}>{t("supplierNameLabel")}</label>
        <input
          required
          value={form.nom}
          onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("supplierCountryLabel")}</label>
        <select
          value={form.pays}
          onChange={(e) => setForm((f) => ({ ...f, pays: e.target.value }))}
          style={inputStyle}
        >
          <option value="">—</option>
          {PAYS.map((pays) => (
            <option key={pays} value={pays}>
              {pays}
            </option>
          ))}
        </select>
        <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12 }}>
          {t("newSupplier")}
        </button>
      </form>

      {fournisseurs.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noSuppliers")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {fournisseurs.map((f) => (
            <div
              key={f.id}
              className="card"
              style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", alignItems: "center" }}
            >
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{f.nom}</div>
              <div style={{ fontSize: 12.5, color: "var(--sub)" }}>{f.pays || "—"}</div>
              <div>
                <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>
                  {t("reliabilityScoreLabel")}
                </div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
                  {f.score_fiabilite != null ? `${f.score_fiabilite}%` : "—"}
                </div>
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
