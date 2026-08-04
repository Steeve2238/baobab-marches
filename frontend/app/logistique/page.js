"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

export default function LogistiquePage() {
  const { t, dict } = useLangue();

  const [incoterms, setIncoterms] = useState([]);
  const [transitaires, setTransitaires] = useState([]);
  const [erreur, setErreur] = useState("");

  const [formIncoterm, setFormIncoterm] = useState({ code: "" });
  const [formTransitaire, setFormTransitaire] = useState({ nom: "" });

  useEffect(() => {
    api.getIncoterms().then(setIncoterms).catch((err) => setErreur(err.message));
    api.getTransitaires().then(setTransitaires).catch((err) => setErreur(err.message));
  }, []);

  async function handleAjouterIncoterm(e) {
    e.preventDefault();
    try {
      const nouveau = await api.createIncoterm(formIncoterm);
      setIncoterms((prev) => [...prev, nouveau]);
      setFormIncoterm({ code: "" });
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleAjouterTransitaire(e) {
    e.preventDefault();
    try {
      const nouveau = await api.createTransitaire(formTransitaire);
      setTransitaires((prev) => [...prev, nouveau]);
      setFormTransitaire({ nom: "" });
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <AppShell title={t("logisticsPageTitle")}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 20, alignItems: "start" }}>
        {/* Incoterms */}
        <div>
          <h2 style={colTitleStyle}>{t("incotermsSection")}</h2>
          <form onSubmit={handleAjouterIncoterm} className="card" style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t("incotermCodeLabel")}</label>
            <input
              required
              placeholder="EXW, FOB, CIF, DAP, DDP..."
              value={formIncoterm.code}
              onChange={(e) => setFormIncoterm({ code: e.target.value.toUpperCase() })}
              style={inputStyle}
            />
            <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12, width: "100%" }}>
              {t("newIncoterm")}
            </button>
          </form>

          {incoterms.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noIncoterms")}</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {incoterms.map((inc) => (
                <div key={inc.id} style={ligneListeStyle}>
                  <span className="mono" style={{ fontWeight: 700 }}>
                    {inc.code}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transitaires + dashboard */}
        <div>
          <h2 style={colTitleStyle}>{t("transitairesSection")}</h2>
          <form onSubmit={handleAjouterTransitaire} className="card" style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t("transitaireNameLabel")}</label>
            <input
              required
              value={formTransitaire.nom}
              onChange={(e) => setFormTransitaire({ nom: e.target.value })}
              style={inputStyle}
            />
            <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12, width: "100%" }}>
              {t("newTransitaire")}
            </button>
          </form>

          {transitaires.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noTransitaires")}</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {transitaires.map((tr) => (
                <div key={tr.id} className="card" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{tr.nom}</div>
                  <div>
                    <div style={miniLabelStyle}>{t("shipmentsCountLabel")}</div>
                    <div className="mono" style={{ fontSize: 13 }}>{tr.nb_expeditions ?? 0}</div>
                  </div>
                  <div>
                    <div style={miniLabelStyle}>{t("avgDelayLabel")}</div>
                    <div className="mono" style={{ fontSize: 13 }}>{tr.delai_moyen_jours ?? "—"}</div>
                  </div>
                  <div>
                    <div style={miniLabelStyle}>{t("delayRateLabel")}</div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 13,
                        color: tr.taux_retard_pct > 20 ? "var(--brique)" : "inherit",
                      }}
                    >
                      {tr.taux_retard_pct != null ? `${tr.taux_retard_pct}%` : "—"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

const colTitleStyle = { fontSize: 13.5, color: "var(--petrol)", marginBottom: 10, fontWeight: 700 };
const miniLabelStyle = { fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" };
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
const ligneListeStyle = {
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12.5,
};
