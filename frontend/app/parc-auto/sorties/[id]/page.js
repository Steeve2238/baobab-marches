"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";

export default function SortieDetailPage() {
  const { id } = useParams();
  const { t, statutSortieLabel, dict } = useLangue();
  const [sortie, setSortie] = useState(null);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [formCloture, setFormCloture] = useState({ kilometrage_retour: "", date_retour: "", observations: "" });

  useEffect(() => {
    api.getSortie(id).then(setSortie).catch((err) => setErreur(err.message));
  }, [id]);

  async function handleCloturer(e) {
    e.preventDefault();
    setEnCours(true);
    try {
      const maj = await api.cloturerSortie(id, {
        ...formCloture,
        kilometrage_retour: Number(formCloture.kilometrage_retour),
      });
      setSortie(maj);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  if (erreur && !sortie) {
    return (
      <AppShell title={t("sortieDetailTitle")}>
        <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>
      </AppShell>
    );
  }

  if (!sortie) {
    return (
      <AppShell title={t("sortieDetailTitle")}>
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </AppShell>
    );
  }

  return (
    <AppShell title={t("sortieDetailTitle")}>
      <Link href="/parc-auto/sorties" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>
        {t("backToSorties")}
      </Link>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {sortie.vehicule_immatriculation} {sortie.vehicule_marque_modele ? `— ${sortie.vehicule_marque_modele}` : ""}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 2 }}>
              {sortie.localite_depart || "—"} → {sortie.destination || "—"}
            </div>
          </div>
          <span className={sortie.statut === "CLOTUREE" ? "chip ok" : "chip warn"}>
            {statutSortieLabel(sortie.statut)}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 16 }}>
          <Champ label={t("chauffeurLabel")} value={sortie.chauffeur_nom} />
          <Champ label={t("chefMissionLabel")} value={sortie.chef_mission_nom} />
          <Champ label={t("passagersLabel")} value={sortie.passagers} />
          <Champ label={t("itineraireLabel")} value={sortie.itineraire} />
          <Champ label={t("dossierLieLabel")} value={sortie.dossier_reference} />
          <Champ label={t("niveauCarburantDepartLabel")} value={sortie.niveau_carburant_depart} />
          <Champ label={t("kilometrageDepartLabel")} value={sortie.kilometrage_depart} mono />
          <Champ
            label={t("kilometrageRetourLabel")}
            value={sortie.kilometrage_retour}
            mono
          />
          <Champ
            label={t("distanceParcourueLabel")}
            value={sortie.distance_parcourue != null ? `${Number(sortie.distance_parcourue).toLocaleString()} km` : null}
            mono
          />
        </div>
      </div>

      {sortie.statut === "CLOTUREE" ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("sortieClotureeConfirmation")}</p>
      ) : (
        <>
          <h2 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10, fontWeight: 700 }}>
            {t("cloturerSortieSection")}
          </h2>
          <form onSubmit={handleCloturer} className="card" style={{ maxWidth: 480 }}>
            <label style={labelStyle}>{t("kilometrageRetourLabel")}</label>
            <input
              required
              type="number"
              step="0.1"
              value={formCloture.kilometrage_retour}
              onChange={(e) => setFormCloture((f) => ({ ...f, kilometrage_retour: e.target.value }))}
              style={inputStyle}
            />
            <label style={{ ...labelStyle, marginTop: 10 }}>{t("dateRetourLabel")}</label>
            <input
              type="datetime-local"
              value={formCloture.date_retour}
              onChange={(e) => setFormCloture((f) => ({ ...f, date_retour: e.target.value }))}
              style={inputStyle}
            />
            <label style={{ ...labelStyle, marginTop: 10 }}>{t("observationsLabel")}</label>
            <input
              value={formCloture.observations}
              onChange={(e) => setFormCloture((f) => ({ ...f, observations: e.target.value }))}
              style={inputStyle}
            />
            <button type="submit" disabled={enCours} style={{ ...boutonPrincipalStyle, marginTop: 12, width: "100%" }}>
              {t("cloturerButton")}
            </button>
          </form>
        </>
      )}
    </AppShell>
  );
}

function Champ({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>{label}</div>
      <div className={mono ? "mono" : undefined} style={{ fontSize: 13 }}>
        {value != null && value !== "" ? String(value) : "—"}
      </div>
    </div>
  );
}

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
};
const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
};
