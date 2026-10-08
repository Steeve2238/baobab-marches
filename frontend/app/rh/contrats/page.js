"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import PaieSousNav from "../../../lib/components/PaieSousNav";
import { boutonPrincipal, boutonLeger, inputStyle } from "../../../lib/components/rhUi";

export default function ContratsPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [contrats, setContrats] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [employe, setEmploye] = useState("");
  const [type, setType] = useState("CDI");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    api.getContrats().then(setContrats).catch((e) => setErreur(e.message)).finally(() => setChargement(false));
    api.getPersonnel().then(setEmployes).catch(() => {});
  }, []);

  return (
    <AppShell title={t("rhcTitre")} subNav={<PaieSousNav />}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16, maxWidth: 760 }}>{t("rhcAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <select value={employe} onChange={(e) => setEmploye(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 260 }}>
          <option value="">{t("rhcChoisirEmploye")}</option>
          {employes.map((p) => (
            <option key={p.id} value={p.id}>{p.prenom} {p.nom}{p.matricule ? ` (${p.matricule})` : ""}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          {["CDI", "CDD", "JOURNALIER"].map((x) => (
            <option key={x} value={x}>{t(`rhcType_${x}`)}</option>
          ))}
        </select>
        <button type="button" disabled={!employe} style={{ ...boutonPrincipal, opacity: employe ? 1 : 0.5 }} onClick={() => router.push(`/rh/contrats/nouveau?employe_id=${employe}&type=${type}`)}>
          + {t("rhcNouveau")}
        </button>
        <Link href="/rh/modeles-contrats" style={{ ...boutonLeger, marginLeft: "auto" }}>{t("rhcModeles")} →</Link>
      </div>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : contrats.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("rhcAucun")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {contrats.map((c) => (
            <Link key={c.id} href={`/rh/contrats/${c.id}`} className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr 1fr auto", gap: 12, alignItems: "center", textDecoration: "none", color: "inherit" }}>
              <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{c.numero}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.employe_prenom} {c.employe_nom}</div>
                <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{c.poste || "—"}</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>{t(`rhcType_${c.type}`)}</div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>{String(c.date_effet).slice(0, 10)}</div>
              <span className={c.statut === "ANNULE" ? "chip risk" : c.statut === "BROUILLON" ? "chip" : "chip ok"}>{t(`rhcStatut_${c.statut}`)}</span>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
