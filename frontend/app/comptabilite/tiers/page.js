"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import { useComptaStatut, inputStyle, boutonPrincipalStyle, thStyle, tdStyle } from "../../../lib/comptaUi";

// Comptes tiers (CAxxx clients / FBxxx fournisseurs) : crees automatiquement
// a la creation d'un client ou d'un fournisseur et rattaches a leur compte
// collectif (411 / 401). Le code ne peut pas etre modifie.
export default function ComptaTiersPage() {
  const { t } = useLangue();
  const { statut } = useComptaStatut();
  const [tiers, setTiers] = useState([]);
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");

  function charger() {
    const params = {};
    if (type) params.type = type;
    if (q) params.q = q;
    api.comptaTiers(params).then(setTiers).catch((e) => setErreur(e.message));
  }
  useEffect(charger, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  async function synchroniser() {
    setErreur("");
    try {
      const r = await api.comptaSynchroniserTiers();
      setInfo(`${r.crees} ${t("comptaTiersCrees")}`);
      charger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  return (
    <AppShell title={t("comptaNavTiers")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 760, lineHeight: 1.5 }}>{t("comptaTiersAide")}</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <input
          placeholder={t("comptaPlanRecherche")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && charger()}
          style={{ ...inputStyle, width: 260 }}
        />
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...inputStyle, width: 160 }}>
          <option value="">{t("comptaTousTypes")}</option>
          <option value="CLIENT">{t("comptaTiersClient")}</option>
          <option value="FOURNISSEUR">{t("comptaTiersFournisseur")}</option>
        </select>
        {statut?.droits?.ecriture && statut?.initialisee && (
          <button style={boutonPrincipalStyle} onClick={synchroniser}>
            {t("comptaSynchroniserTiers")}
          </button>
        )}
      </div>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("comptaCode")}</th>
              <th style={thStyle}>{t("comptaNom")}</th>
              <th style={thStyle}>{t("comptaType")}</th>
              <th style={thStyle}>{t("comptaCollectif")}</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((x) => (
              <tr key={x.id}>
                <td style={{ ...tdStyle, fontWeight: 700, fontFamily: "IBM Plex Mono, monospace" }}>{x.code}</td>
                <td style={tdStyle}>{x.nom}</td>
                <td style={tdStyle}>{x.type_tiers === "CLIENT" ? t("comptaTiersClient") : x.type_tiers === "FOURNISSEUR" ? t("comptaTiersFournisseur") : x.type_tiers}</td>
                <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace" }}>{x.compte_collectif}</td>
              </tr>
            ))}
            {tiers.length === 0 && (
              <tr>
                <td colSpan={4} style={{ ...tdStyle, color: "var(--sub)" }}>
                  {t("comptaAucunTiers")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
