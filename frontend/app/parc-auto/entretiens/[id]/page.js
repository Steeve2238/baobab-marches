"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";

export default function EntretienDetailPage() {
  const { id } = useParams();
  const { t, dict, typeEntretienLabel, statutEntretienLabel } = useLangue();
  const [entretien, setEntretien] = useState(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    api.getEntretien(id).then(setEntretien).catch((err) => setErreur(err.message));
  }, [id]);

  async function handleChangerStatut(nouveauStatut) {
    setEnCours(true);
    setMessage("");
    try {
      const maj = await api.patchEntretien(id, { statut: nouveauStatut });
      setEntretien(maj);
      setMessage(t("entretienUpdated"));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  function chipClasse(statut) {
    if (statut === "TERMINE") return "chip ok";
    if (statut === "EN_COURS") return "chip warn";
    return "chip";
  }

  if (erreur && !entretien) {
    return (
      <AppShell title={t("entretienDetailTitle")}>
        <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>
      </AppShell>
    );
  }

  if (!entretien) {
    return (
      <AppShell title={t("entretienDetailTitle")}>
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </AppShell>
    );
  }

  return (
    <AppShell title={t("entretienDetailTitle")}>
      <Link href="/parc-auto/entretiens" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>
        {t("backToEntretiens")}
      </Link>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {entretien.vehicule_immatriculation} {entretien.vehicule_marque_modele ? `— ${entretien.vehicule_marque_modele}` : ""}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 2 }}>{typeEntretienLabel(entretien.type_entretien)}</div>
          </div>
          <span className={chipClasse(entretien.statut)}>{statutEntretienLabel(entretien.statut)}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 16 }}>
          <Champ label={t("dateEntretienLabel")} value={new Date(entretien.date_entretien).toLocaleDateString(dict.dateLocale)} />
          <Champ label={t("kilometrageLabel")} value={entretien.kilometrage} mono />
          <Champ label={t("prestataireLabel")} value={entretien.prestataire} />
          <Champ label={t("descriptionLabel")} value={entretien.description} />
          <Champ label={t("piecesChangeesLabel")} value={entretien.pieces_changees} />
          <Champ label={t("coutLabel")} value={entretien.cout} mono />
          <Champ
            label={t("prochainEntretienDateLabel")}
            value={entretien.prochain_entretien_date ? new Date(entretien.prochain_entretien_date).toLocaleDateString(dict.dateLocale) : null}
          />
          <Champ label={t("prochainEntretienKmLabel")} value={entretien.prochain_entretien_km} mono />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        {entretien.statut === "PLANIFIE" && (
          <button disabled={enCours} onClick={() => handleChangerStatut("EN_COURS")} style={boutonPrincipalStyle}>
            {t("marquerEnCoursButton")}
          </button>
        )}
        {entretien.statut !== "TERMINE" && (
          <button disabled={enCours} onClick={() => handleChangerStatut("TERMINE")} style={boutonPrincipalStyle}>
            {t("marquerTermineButton")}
          </button>
        )}
      </div>
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

const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};
