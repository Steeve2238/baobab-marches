"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import VentesSousNav from "../../../lib/components/VentesSousNav";

const STATUT_STYLE = {
  BROUILLON: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
  ENVOYE: { color: "var(--ocre)", background: "rgba(224,149,76,0.12)" },
  VALIDE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  REFUSE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  EXPIRE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};
const FILTRES = ["BROUILLON", "ENVOYE", "VALIDE", "REFUSE", "EXPIRE", "TOUTES"];

export default function DevisListePage() {
  const { t } = useLangue();
  const [devisListe, setDevisListe] = useState([]);
  const [filtre, setFiltre] = useState("TOUTES");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    setChargement(true);
    api
      .getDevisListe(filtre === "TOUTES" ? undefined : filtre)
      .then(setDevisListe)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, [filtre]);

  return (
    <AppShell title={t("venteDevisPageTitle")} subNav={<VentesSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {FILTRES.map((f) => (
            <button
              key={f}
              onClick={() => setFiltre(f)}
              style={{
                ...filtreBtnStyle,
                background: filtre === f ? "var(--petrol)" : "transparent",
                color: filtre === f ? "#fff" : "var(--petrol)",
              }}
            >
              {f === "TOUTES" ? t("saFilterAll") : t(`venteDevisStatut_${f}`)}
            </button>
          ))}
        </div>
        <Link href="/ventes/devis/nouveau" style={boutonPrincipalStyle}>
          {t("venteNewDevisButton")}
        </Link>
      </div>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : devisListe.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("venteNoDevis")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {devisListe.map((d) => {
            const style = STATUT_STYLE[d.statut] || {};
            return (
              <Link key={d.id} href={`/ventes/devis/${d.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{d.numero} — {d.client_nom}</div>
                    <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>
                      {d.objet || "—"} · {Number(d.total_ttc).toLocaleString()} XOF TTC
                    </div>
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", ...style }}>
                    {t(`venteDevisStatut_${d.statut}`)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

const filtreBtnStyle = {
  border: "1px solid var(--line)",
  borderRadius: 20,
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 600,
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
