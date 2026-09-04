"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

// Clients COMMERCIAUX du tenant (ex: ses propres clients a lui, comme SETER,
// DKM...) - a ne pas confondre avec les "tenants" de la plateforme Baobab.
// Utilises par les Consultations/Devis/Factures/BL du module Ventes.
export default function ClientsCommerciauxPage() {
  const { t } = useLangue();
  const [clients, setClients] = useState([]);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [form, setForm] = useState({ nom: "", adresse: "", telephone: "", email: "" });

  function charger() {
    api
      .getClientsCommerciaux()
      .then(setClients)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  async function handleAjouter(e) {
    e.preventDefault();
    setErreur("");
    try {
      const nouveau = await api.createClientCommercial(form);
      setClients((prev) => [...prev, nouveau].sort((a, b) => a.nom.localeCompare(b.nom)));
      setForm({ nom: "", adresse: "", telephone: "", email: "" });
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleToggleActif(client) {
    try {
      const maj = await api.patchClientCommercial(client.id, { actif: !client.actif });
      setClients((prev) => prev.map((c) => (c.id === client.id ? maj : c)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <AppShell title={t("venteClientsPageTitle")}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <form onSubmit={handleAjouter} className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
        <label style={labelStyle}>{t("venteClientNomLabel")}</label>
        <input
          required
          value={form.nom}
          onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("adresseLabel")}</label>
        <input
          value={form.adresse}
          onChange={(e) => setForm((f) => ({ ...f, adresse: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("telephoneLabel")}</label>
        <input
          value={form.telephone}
          onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("emailLabel2")}</label>
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          style={inputStyle}
        />
        <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12 }}>
          {t("venteNewClientButton")}
        </button>
      </form>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : clients.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("venteNoClients")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {clients.map((c) => (
            <div key={c.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.nom}</div>
                <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>
                  {[c.adresse, c.telephone, c.email].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: 20,
                    color: c.actif ? "#2E7D5B" : "var(--sub)",
                    background: c.actif ? "rgba(46,125,91,0.12)" : "rgba(91,106,108,0.1)",
                  }}
                >
                  {c.actif ? t("activeLabel") : t("inactiveLabel")}
                </span>
                <button onClick={() => handleToggleActif(c)} style={boutonSecondaireStyle}>
                  {c.actif ? t("venteDeactivateClientButton") : t("venteReactivateClientButton")}
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
