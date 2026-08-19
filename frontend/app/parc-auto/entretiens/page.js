"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

export default function EntretiensPage() {
  const { t, dict, statutEntretienLabel, typeEntretienLabel } = useLangue();
  const [entretiens, setEntretiens] = useState([]);
  const [vehicules, setVehicules] = useState([]);
  const [filtreVehicule, setFiltreVehicule] = useState("");
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    api.getVehicules().then(setVehicules).catch((err) => setErreur(err.message));
  }, []);

  useEffect(() => {
    const params = filtreVehicule ? { vehicule_id: filtreVehicule } : {};
    api.getEntretiens(params).then(setEntretiens).catch((err) => setErreur(err.message));
  }, [filtreVehicule]);

  function chipClasse(statut) {
    if (statut === "TERMINE") return "chip ok";
    if (statut === "EN_COURS") return "chip warn";
    return "chip";
  }

  return (
    <AppShell title={t("entretiensPageTitle")}>
      <Link href="/parc-auto" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>
        {t("backToVehicules")}
      </Link>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, marginRight: 8 }}>{t("filterByVehicule")}</label>
          <select value={filtreVehicule} onChange={(e) => setFiltreVehicule(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 12.5 }}>
            <option value="">{t("allVehicules")}</option>
            {vehicules.map((v) => (
              <option key={v.id} value={v.id}>
                {v.immatriculation}
              </option>
            ))}
          </select>
        </div>
        <Link href="/parc-auto/entretiens/nouveau" className="card" style={{ padding: "8px 16px", fontSize: 12.5, fontWeight: 600, color: "var(--petrol)" }}>
          {t("newEntretien")}
        </Link>
      </div>

      {entretiens.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noEntretiens")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {entretiens.map((entr) => (
            <Link
              key={entr.id}
              href={`/parc-auto/entretiens/${entr.id}`}
              className="card"
              style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr auto", gap: 12, alignItems: "center", textDecoration: "none", color: "inherit" }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{entr.vehicule_immatriculation}</div>
                <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{typeEntretienLabel(entr.type_entretien)}</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>
                {new Date(entr.date_entretien).toLocaleDateString(dict.dateLocale)}
              </div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>{entr.prestataire || "—"}</div>
              <span className={chipClasse(entr.statut)}>{statutEntretienLabel(entr.statut)}</span>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
