"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import { boutonPrincipal, boutonLeger, inputStyle } from "../../../lib/components/rhUi";

export default function CourriersRHPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [courriers, setCourriers] = useState([]);
  const [types, setTypes] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [fEmploye, setFEmploye] = useState("");
  const [fType, setFType] = useState("");
  const [employe, setEmploye] = useState("");
  const [type, setType] = useState("ATTESTATION_TRAVAIL");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    api.getCourrierTypes().then(setTypes).catch((e) => setErreur(e.message));
    api.getPersonnel().then(setEmployes).catch(() => {});
    const q = new URLSearchParams(window.location.search).get("employe_id");
    if (q) { setFEmploye(q); setEmploye(q); }
  }, []);
  useEffect(() => {
    setChargement(true);
    api.getCourriers({ employe_id: fEmploye, type: fType }).then(setCourriers).catch((e) => setErreur(e.message)).finally(() => setChargement(false));
  }, [fEmploye, fType]);

  const optionsEmployes = employes.map((p) => (
    <option key={p.id} value={p.id}>{p.prenom} {p.nom}{p.matricule ? ` (${p.matricule})` : ""}</option>
  ));

  return (
    <AppShell title={t("rhkTitre")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16, maxWidth: 780 }}>{t("rhkAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select value={employe} onChange={(e) => setEmploye(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 240 }}>
          <option value="">{t("rhkChoisirEmploye")}</option>
          {optionsEmployes}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 230 }}>
          {types.map((x) => <option key={x.type} value={x.type}>{t(`rhkType_${x.type}`)}</option>)}
        </select>
        <button type="button" disabled={!employe} style={{ ...boutonPrincipal, opacity: employe ? 1 : 0.5 }} onClick={() => router.push(`/rh/courriers/nouveau?employe_id=${employe}&type=${type}`)}>
          + {t("rhkNouveau")}
        </button>
        <Link href="/rh/modeles-courriers" style={{ ...boutonLeger, marginLeft: "auto" }}>{t("rhkModeles")} →</Link>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14, fontSize: 12 }}>
        <select value={fEmploye} onChange={(e) => setFEmploye(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 200 }} aria-label={t("rhkEmployeLabel")}>
          <option value="">{t("rhkEmployeLabel")} : {t("rhkTous")}</option>
          {optionsEmployes}
        </select>
        <select value={fType} onChange={(e) => setFType(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 200 }} aria-label={t("rhkTypeLabel")}>
          <option value="">{t("rhkTypeLabel")} : {t("rhkTous")}</option>
          {types.map((x) => <option key={x.type} value={x.type}>{t(`rhkType_${x.type}`)}</option>)}
        </select>
      </div>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : courriers.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("rhkAucun")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {courriers.map((c) => (
            <Link key={c.id} href={`/rh/courriers/${c.id}`} className="card" style={{ display: "grid", gridTemplateColumns: "110px 1.3fr 1.4fr 100px 290px", gap: 12, alignItems: "center", textDecoration: "none", color: "inherit" }}>
              <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{c.numero}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.employe_prenom} {c.employe_nom}</div>
                <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{c.employe_matricule || ""}</div>
              </div>
              <div style={{ fontSize: 12.5 }}>{t(`rhkType_${c.type}`)}</div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>{String(c.date_courrier).slice(0, 10)}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {c.visible_employe && <span className="chip">{t("rhkPublie")}</span>}
                {c.date_lecture && <span className="chip">{t("rhkLu")}</span>}
                {c.date_accuse && <span className="chip ok">{t("rhkAccuse")}</span>}
                {c.date_reponse && <span className="chip ok">{t("rhkReponseRecue")}</span>}
                <span className={c.statut === "ANNULE" ? "chip risk" : c.statut === "BROUILLON" ? "chip" : "chip ok"}>{t(`rhkStatut_${c.statut}`)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
