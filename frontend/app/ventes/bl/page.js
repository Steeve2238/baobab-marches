"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import VentesSousNav from "../../../lib/components/VentesSousNav";

const STATUT_STYLE = {
  BROUILLON: { color: "var(--ocre)", background: "rgba(224,149,76,0.12)" },
  LIVRE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
};
const FILTRES = ["BROUILLON", "LIVRE", "TOUTES"];

function numeroAffiche(numero, mois) {
  const [annee, sequence] = numero.split("-");
  return `${annee}-${String(mois).padStart(2, "0")}-${sequence}`;
}

export default function BlListePage() {
  const { t } = useLangue();
  const [blListe, setBlListe] = useState([]);
  const [filtre, setFiltre] = useState("BROUILLON");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    setChargement(true);
    api
      .getBlListe(filtre === "TOUTES" ? undefined : filtre)
      .then(setBlListe)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, [filtre]);

  return (
    <AppShell title={t("venteBlPageTitle")} subNav={<VentesSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
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
            {f === "TOUTES" ? t("saFilterAll") : t(`venteBlStatut_${f}`)}
          </button>
        ))}
      </div>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : blListe.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("venteNoBl")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {blListe.map((bl) => {
            const style = STATUT_STYLE[bl.statut] || {};
            return (
              <Link key={bl.id} href={`/ventes/bl/${bl.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                      BL-{numeroAffiche(bl.numero, bl.mois_emission)} — {bl.client_nom}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>
                      {new Date(bl.date_bl).toLocaleDateString()} · {t("venteInvoiceLinkedLabel")} {numeroAffiche(bl.facture_numero, bl.mois_emission)}
                    </div>
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", ...style }}>
                    {t(`venteBlStatut_${bl.statut}`)}
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
