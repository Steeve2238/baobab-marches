"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import BarreRecherche from "../../../lib/components/BarreRecherche";
import { filtrerRecherche } from "../../../lib/rechercheUtil";
import AppShell from "../../../lib/components/AppShell";
import VentesSousNav from "../../../lib/components/VentesSousNav";

const STATUT_STYLE = {
  IMPAYEE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  PAYEE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  ANNULEE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};
const FILTRES = ["IMPAYEE", "PAYEE", "ANNULEE", "TOUTES"];

// Affiche le numero avec le mois inclus (ex "2026-08-096"), comme sur les
// documents imprimes - stocke sans le mois en base (voir routes/ventes.js).
function numeroAffiche(numero, mois) {
  const [annee, sequence] = numero.split("-");
  return `${annee}-${String(mois).padStart(2, "0")}-${sequence}`;
}

export default function FacturesVentePage() {
  const { t } = useLangue();
  const [factures, setFactures] = useState([]);
  const [filtre, setFiltre] = useState("IMPAYEE");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [recherche, setRecherche] = useState("");
  // Une recherche porte sur tous les statuts.
  const filtreEffectif = recherche.trim() ? "TOUTES" : filtre;

  useEffect(() => {
    setChargement(true);
    api
      .getFacturesVente(filtreEffectif === "TOUTES" ? undefined : filtreEffectif)
      .then(setFactures)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, [filtreEffectif]);

  // On cherche aussi sur le numero affiche (2026-10-0005) et sur le numero brut (2026-0005).
  const affichees = useMemo(
    () => filtrerRecherche(factures, recherche, (f) => [f.numero, numeroAffiche(f.numero, f.mois_emission), f.client_nom, f.reference_bc_client, f.total_ttc, f.objet, t(`venteFactureStatut_${f.statut}`)]),
    [factures, recherche, t]
  );

  return (
    <AppShell title={t("venteFacturesPageTitle")} subNav={<VentesSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <BarreRecherche valeur={recherche} onChange={setRecherche} placeholder={t("rechPlaceholderFactures")} total={factures.length} affiche={affichees.length} note={filtre !== "TOUTES" ? t("rechToutesSituations") : ""} />

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {FILTRES.map((f) => (
          <button
            key={f}
            onClick={() => { setFiltre(f); setRecherche(""); }}
            style={{
              ...filtreBtnStyle,
              background: filtreEffectif === f ? "var(--petrol)" : "transparent",
              color: filtreEffectif === f ? "#fff" : "var(--petrol)",
            }}
          >
            {f === "TOUTES" ? t("saFilterAll") : t(`venteFactureStatut_${f}`)}
          </button>
        ))}
      </div>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : factures.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("venteNoInvoices")}</p>
      ) : affichees.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("rechAucunResultat").replace("{q}", recherche)}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {affichees.map((f) => {
            const style = STATUT_STYLE[f.statut] || {};
            return (
              <Link key={f.id} href={`/ventes/factures/${f.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                      {numeroAffiche(f.numero, f.mois_emission)} — {f.client_nom}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>
                      {Number(f.total_ttc).toLocaleString()} XOF TTC
                      {f.reference_bc_client ? ` · ${f.reference_bc_client}` : ""}
                      {f.bl_id ? ` · BL ${t(`venteBlStatut_${f.bl_statut}`)}` : ` · ${t("venteNoBlYet")}`}
                    </div>
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", ...style }}>
                    {t(`venteFactureStatut_${f.statut}`)}
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
