"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import { boutonPrincipal, inputStyle, fmtMontant } from "../../lib/components/rhUi";

const STATUTS = ["BROUILLON", "VALIDE", "SIGNE", "TERMINE", "RESILIE", "ANNULE"];
const SUFFIXE = { TAUX_JOUR: "prsParJour", TAUX_HORAIRE: "prsParHeure", MENSUEL: "prsParMois" };

function classeStatut(s) {
  if (s === "ANNULE" || s === "RESILIE") return "chip risk";
  if (s === "SIGNE" || s === "TERMINE") return "chip ok";
  return "chip";
}

export default function ContratsPrestationPage() {
  const { t } = useLangue();
  const [liste, setListe] = useState([]);
  const [statut, setStatut] = useState("");
  const [q, setQ] = useState("");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => {
      api.prestationsListe({ statut, q }).then(setListe).catch((e) => setErreur(e.message)).finally(() => setChargement(false));
    }, 200);
    return () => clearTimeout(id);
  }, [statut, q]);

  return (
    <AppShell title={t("prsTitre")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16, maxWidth: 760 }}>{t("prsAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <input style={{ ...inputStyle, width: "auto", minWidth: 280 }} placeholder={t("prsRecherche")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ ...inputStyle, width: "auto" }} value={statut} onChange={(e) => setStatut(e.target.value)}>
          <option value="">{t("prsFiltreTous")}</option>
          {STATUTS.map((s) => <option key={s} value={s}>{t(`prsStatut_${s}`)}</option>)}
        </select>
        <Link href="/contrats-prestation/nouveau" style={{ ...boutonPrincipal, marginLeft: "auto" }}>+ {t("prsNouveau")}</Link>
      </div>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : liste.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("prsAucun")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {liste.map((c) => (
            <Link key={c.id} href={`/contrats-prestation/${c.id}`} className="card" style={{ display: "grid", gridTemplateColumns: "0.9fr 2fr 1.2fr 1.2fr auto", gap: 12, alignItems: "center", textDecoration: "none", color: "inherit" }}>
              <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{c.numero}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.prestataire_nom}</div>
                <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{c.objet}</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>
                {String(c.date_effet).slice(0, 10)}{c.date_fin ? ` → ${String(c.date_fin).slice(0, 10)}` : ""}
              </div>
              <div className="mono" style={{ fontSize: 12 }}>
                {fmtMontant(c.montant)} {c.devise} {SUFFIXE[c.mode_honoraires] ? t(SUFFIXE[c.mode_honoraires]) : ""}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {c.expire && <span className="chip risk">{t("prsExpire")}</span>}
                {c.fin_proche && <span className="chip">{t("prsFinProche")}</span>}
                <span className={classeStatut(c.statut)}>{t(`prsStatut_${c.statut}`)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
