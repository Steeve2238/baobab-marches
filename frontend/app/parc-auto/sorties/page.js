"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

const STATUTS = ["EN_COURS", "CLOTUREE"];

export default function SortiesPage() {
  const { t, statutSortieLabel, dict } = useLangue();
  const [sorties, setSorties] = useState([]);
  const [erreur, setErreur] = useState("");
  const [filtreStatut, setFiltreStatut] = useState("");

  useEffect(() => {
    api
      .getSorties(filtreStatut ? { statut: filtreStatut } : {})
      .then(setSorties)
      .catch((err) => setErreur(err.message));
  }, [filtreStatut]);

  return (
    <AppShell title={t("sortiesPageTitle")}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 220 }}>
          <label style={labelStyle}>{t("filterByStatut")}</label>
          <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)} style={inputStyle}>
            <option value="">{t("allStatuts")}</option>
            {STATUTS.map((s) => (
              <option key={s} value={s}>
                {statutSortieLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <Link href="/parc-auto/sorties/nouvelle" style={boutonPrincipalStyle}>
          {t("newSortie")}
        </Link>
      </div>

      {sorties.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noSorties")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {sorties.map((s) => (
            <Link
              key={s.id}
              href={`/parc-auto/sorties/${s.id}`}
              className="card"
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 12, alignItems: "center", textDecoration: "none", color: "inherit" }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{s.vehicule_immatriculation}</div>
                <div style={{ fontSize: 11, color: "var(--sub)" }}>{s.vehicule_marque_modele || "—"}</div>
              </div>
              <div style={{ fontSize: 12 }}>{s.destination || "—"}</div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>
                {new Date(s.date_depart).toLocaleDateString(dict.dateLocale)}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{s.dossier_reference || "—"}</div>
              <span className={s.statut === "CLOTUREE" ? "chip ok" : "chip warn"}>{statutSortieLabel(s.statut)}</span>
            </Link>
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
  textDecoration: "none",
  display: "inline-block",
};
