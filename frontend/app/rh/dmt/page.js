"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import PaieSousNav from "../../../lib/components/PaieSousNav";
import { OBJETS } from "../../../lib/components/DmtForm";
import { boutonPrincipal, inputStyle } from "../../../lib/components/rhUi";

export default function DmtListePage() {
  const router = useRouter();
  const { t } = useLangue();
  const [liste, setListe] = useState([]);
  const [employes, setEmployes] = useState([]);
  const [employe, setEmploye] = useState("");
  const [objet, setObjet] = useState("EMBAUCHE");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    api.getDmts().then(setListe).catch((e) => setErreur(e.message)).finally(() => setChargement(false));
    api.getPersonnel().then(setEmployes).catch(() => {});
  }, []);

  return (
    <AppShell title={t("rhdmTitre")} subNav={<PaieSousNav />}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16, maxWidth: 780 }}>{t("rhdmAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <select value={employe} onChange={(e) => setEmploye(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 260 }}>
          <option value="">{t("rhcChoisirEmploye")}</option>
          {employes.map((p) => (
            <option key={p.id} value={p.id}>{p.prenom} {p.nom}{p.matricule ? ` (${p.matricule})` : ""}</option>
          ))}
        </select>
        <select value={objet} onChange={(e) => setObjet(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          {OBJETS.map((o) => (
            <option key={o} value={o}>{t(`rhdmObjet_${o}`)}</option>
          ))}
        </select>
        <button type="button" disabled={!employe} style={{ ...boutonPrincipal, opacity: employe ? 1 : 0.5 }} onClick={() => router.push(`/rh/dmt/nouvelle?employe_id=${employe}&objet=${objet}`)}>
          + {t("rhdmNouvelle")}
        </button>
      </div>
      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : liste.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("rhdmAucune")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {liste.map((d) => (
            <Link key={d.id} href={`/rh/dmt/${d.id}`} className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1.4fr 1fr auto", gap: 12, alignItems: "center", textDecoration: "none", color: "inherit" }}>
              <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{d.numero}</div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{d.employe_prenom} {d.employe_nom}</div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>{t(`rhdmObjet_${d.objet}`)}</div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>{String(d.date_dmt).slice(0, 10)}</div>
              <span className={d.statut === "ANNULEE" ? "chip risk" : d.statut === "BROUILLON" ? "chip" : "chip ok"}>{t(`rhdmStatut_${d.statut}`)}</span>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
