"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

export default function PersonnelPage() {
  const { t, statutEmployeLabel } = useLangue();
  const [personnel, setPersonnel] = useState([]);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [recherche, setRecherche] = useState("");

  useEffect(() => {
    api
      .getPersonnel()
      .then(setPersonnel)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  const filtre = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return personnel;
    return personnel.filter((p) =>
      [p.nom, p.prenom, p.matricule, p.poste, p.categorie, p.convention_collective].some((v) =>
        String(v || "").toLowerCase().includes(q)
      )
    );
  }, [personnel, recherche]);

  const lienBouton = {
    display: "inline-block",
    padding: "8px 16px",
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--petrol)",
  };

  return (
    <AppShell title={t("rhdListTitre")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16, maxWidth: 760 }}>
        {t("rhdListAide")}
      </p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Link
          href="/rh/personnel/nouveau"
          style={{
            background: "var(--petrol)",
            color: "#fff",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 12.5,
            fontWeight: 600,
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          + {t("rhdNouveau")}
        </Link>
        <Link href="/rh/circuit-approbation" className="card" style={lienBouton}>{t("navCircuitApprobation")} →</Link>
        <Link href="/rh/planning-conges" className="card" style={lienBouton}>{t("navPlanningConges")} →</Link>
        <Link href="/rh/statistiques" className="card" style={lienBouton}>{t("navStatistiquesRH")} →</Link>
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder={t("rhdRecherche")}
          style={{ marginLeft: "auto", minWidth: 240, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, fontFamily: "inherit" }}
        />
      </div>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : filtre.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("rhdAucun")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {filtre.map((p) => (
            <Link
              key={p.id}
              href={`/rh/personnel/${p.id}`}
              className="card"
              style={{
                display: "grid",
                gridTemplateColumns: "1.5fr 1.2fr 1fr auto auto",
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
                <div className="mono" style={{ fontSize: 11.5, color: "var(--sub)" }}>
                  {p.matricule || "—"}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>
                {p.poste || "—"}
                {p.categorie ? <div style={{ fontSize: 11 }}>{p.categorie}</div> : null}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--sub)" }}>
                {p.a_compte ? t("rhdAvecCompte") : t("rhdSansCompte")}
              </div>
              <span className={p.completude && p.completude.pourcentage === 100 ? "chip ok" : "chip risk"}>
                {p.completude ? `${p.completude.pourcentage} %` : "—"}
              </span>
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
