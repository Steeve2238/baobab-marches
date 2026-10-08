"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import { boutonPrincipal } from "../../../lib/components/rhUi";
import { fmtMontant } from "../../../lib/components/rhUi";

export default function OrdresVirementPage() {
  const { t } = useLangue();
  const [ordres, setOrdres] = useState([]);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    api.getOrdresVirement().then(setOrdres).catch((e) => setErreur(e.message)).finally(() => setChargement(false));
  }, []);

  return (
    <AppShell title={t("rhovTitre")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16, maxWidth: 780 }}>{t("rhovAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      <div style={{ marginBottom: 16 }}>
        <Link href="/rh/ordres-virement/nouveau" style={boutonPrincipal}>+ {t("rhovNouveau")}</Link>
      </div>
      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : ordres.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("rhovAucun")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {ordres.map((o) => (
            <Link key={o.id} href={`/rh/ordres-virement/${o.id}`} className="card" style={{ display: "grid", gridTemplateColumns: "110px 1.6fr 110px 90px 130px auto", gap: 12, alignItems: "center", textDecoration: "none", color: "inherit" }}>
              <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{o.numero}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{o.libelle}</div>
                <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{t(`rhovType_${o.type_paiement}`)}</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>{String(o.date_execution).slice(0, 10)}</div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>{o.nb_lignes} {t("rhovColLignes").toLowerCase()}</div>
              <div style={{ fontSize: 13, fontWeight: 600, textAlign: "right" }}>{fmtMontant(o.total)} F</div>
              <span className={o.statut === "ANNULE" ? "chip risk" : o.statut === "BROUILLON" ? "chip" : "chip ok"}>{t(`rhovStatut_${o.statut}`)}</span>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
