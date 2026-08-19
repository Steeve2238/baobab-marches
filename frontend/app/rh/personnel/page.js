"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

export default function PersonnelPage() {
  const { t, statutEmployeLabel } = useLangue();
  const [personnel, setPersonnel] = useState([]);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    api
      .getPersonnel()
      .then(setPersonnel)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  return (
    <AppShell title={t("rhPersonnelPageTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16 }}>
        {t("rhPersonnelPageSubtitle")}
      </p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ marginBottom: 16, display: "flex", gap: 10 }}>
        <Link
          href="/rh/personnel/nouveau"
          style={{
            background: "var(--petrol)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 12.5,
            fontWeight: 600,
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          {t("newFicheEmploye")}
        </Link>
        <Link
          href="/rh/circuit-approbation"
          className="card"
          style={{ display: "inline-block", padding: "8px 16px", fontSize: 12.5, fontWeight: 600, color: "var(--petrol)" }}
        >
          {t("navCircuitApprobation")} →
        </Link>
      </div>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : personnel.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noPersonnel")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {personnel.map((p) => (
            <Link
              key={p.id}
              href={`/rh/personnel/${p.id}`}
              className="card"
              style={{
                display: "grid",
                gridTemplateColumns: "1.6fr 1fr 1fr auto",
                gap: 12,
                alignItems: "center",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                  {p.prenom} {p.nom}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{p.email}</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>{p.poste || "—"}</div>
              <div>
                <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>
                  {t("soldeCongesLabel")}
                </div>
                <div className="mono" style={{ fontSize: 13 }}>
                  {p.solde_conges != null ? Number(p.solde_conges) : 0}
                </div>
              </div>
              <span className={p.statut === "ACTIF" ? "chip ok" : "chip risk"}>
                {statutEmployeLabel(p.statut)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
