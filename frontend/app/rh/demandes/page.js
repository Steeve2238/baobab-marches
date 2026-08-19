"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

const TYPES = ["CONGE", "AVANCE", "ORDRE_MISSION", "HEURES_SUP"];

const FORM_VIDE = {
  date_debut: "",
  date_fin: "",
  nb_jours: "",
  montant: "",
  destination: "",
  date: "",
  nb_heures: "",
  motif: "",
};

function detailsPourType(type_demande, form) {
  if (type_demande === "CONGE") {
    return { date_debut: form.date_debut, date_fin: form.date_fin, nb_jours: Number(form.nb_jours), motif: form.motif };
  }
  if (type_demande === "AVANCE") {
    return { montant: Number(form.montant), motif: form.motif };
  }
  if (type_demande === "ORDRE_MISSION") {
    return { destination: form.destination, date_debut: form.date_debut, date_fin: form.date_fin, motif: form.motif };
  }
  if (type_demande === "HEURES_SUP") {
    return { date: form.date, nb_heures: Number(form.nb_heures), motif: form.motif };
  }
  return {};
}

function ResumeDetails({ demande }) {
  const d = demande.details || {};
  if (demande.type_demande === "CONGE") {
    return (
      <span>
        {d.date_debut} → {d.date_fin} ({d.nb_jours} j) {d.motif ? `— ${d.motif}` : ""}
      </span>
    );
  }
  if (demande.type_demande === "AVANCE") {
    return <span>{d.montant} {d.motif ? `— ${d.motif}` : ""}</span>;
  }
  if (demande.type_demande === "ORDRE_MISSION") {
    return (
      <span>
        {d.destination} — {d.date_debut} → {d.date_fin} {d.motif ? `— ${d.motif}` : ""}
      </span>
    );
  }
  if (demande.type_demande === "HEURES_SUP") {
    return <span>{d.date} — {d.nb_heures}h {d.motif ? `— ${d.motif}` : ""}</span>;
  }
  return null;
}

function chipClasseStatut(statut) {
  if (statut === "APPROUVEE") return "chip ok";
  if (statut === "REJETEE" || statut === "ANNULEE") return "chip risk";
  if (statut === "SOUMISE") return "chip warn";
  return "chip";
}

export default function DemandesRHPage() {
  const { t, typeDemandeRHLabel, statutDemandeRHLabel } = useLangue();
  const [onglet, setOnglet] = useState("mes");
  const [mesDemandes, setMesDemandes] = useState([]);
  const [aValider, setAValider] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [pasDeFiche, setPasDeFiche] = useState(false);
  const [form, setForm] = useState({ type_demande: "", ...FORM_VIDE });
  const [enCours, setEnCours] = useState(false);
  const [rejetEnCoursId, setRejetEnCoursId] = useState(null);
  const [motifRejet, setMotifRejet] = useState("");

  useEffect(() => {
    chargerTout();
  }, []);

  async function chargerTout() {
    setErreur("");
    try {
      const mes = await api.getMesDemandesRH();
      setMesDemandes(mes);
      setPasDeFiche(false);
    } catch (err) {
      if (err.status === 404) {
        setPasDeFiche(true);
      } else {
        setErreur(err.message);
      }
    }
    try {
      const val = await api.getDemandesRHAValider();
      setAValider(val);
    } catch (err) {
      // silencieux : la plupart des utilisateurs n'ont rien a valider
    }
    setChargement(false);
  }

  async function handleCreer(e) {
    e.preventDefault();
    setEnCours(true);
    setErreur("");
    try {
      await api.createDemandeRH({ type_demande: form.type_demande, details: detailsPourType(form.type_demande, form) });
      setForm({ type_demande: "", ...FORM_VIDE });
      await chargerTout();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  async function handleSoumettre(id) {
    setErreur("");
    try {
      await api.soumettreDemandeRH(id);
      await chargerTout();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleAnnuler(id) {
    setErreur("");
    try {
      await api.annulerDemandeRH(id);
      await chargerTout();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleApprouver(id) {
    setErreur("");
    try {
      await api.validerDemandeRH(id, { decision: "APPROUVEE" });
      await chargerTout();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleConfirmerRejet(id) {
    setErreur("");
    try {
      await api.validerDemandeRH(id, { decision: "REJETEE", motif_rejet: motifRejet });
      setRejetEnCoursId(null);
      setMotifRejet("");
      await chargerTout();
    } catch (err) {
      setErreur(err.message);
    }
  }

  const liste = onglet === "mes" ? mesDemandes : aValider;

  return (
    <AppShell title={t("demandesRHPageTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16 }}>
        {t("demandesRHPageSubtitle")}
      </p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setOnglet("mes")} style={ongletStyle(onglet === "mes")}>
          {t("tabMesDemandes")}
        </button>
        <button onClick={() => setOnglet("avalider")} style={ongletStyle(onglet === "avalider")}>
          {t("tabAValider")} {aValider.length > 0 && <span className="chip warn">{aValider.length}</span>}
        </button>
      </div>

      {onglet === "mes" && (
        <>
          {pasDeFiche ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 16 }}>{t("pasDeFicheEmployeMessage")}</p>
          ) : (
            <form onSubmit={handleCreer} className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
              <label style={labelStyle}>{t("typeDemandeLabel")}</label>
              <select
                required
                value={form.type_demande}
                onChange={(e) => setForm((f) => ({ ...FORM_VIDE, type_demande: e.target.value }))}
                style={inputStyle}
              >
                <option value="">{t("selectTypeDemande")}</option>
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {typeDemandeRHLabel(ty)}
                  </option>
                ))}
              </select>

              {form.type_demande === "CONGE" && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                    <div>
                      <label style={labelStyle}>{t("dateDebutLabel")}</label>
                      <input type="date" required value={form.date_debut} onChange={(e) => setForm((f) => ({ ...f, date_debut: e.target.value }))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>{t("dateFinLabel")}</label>
                      <input type="date" required value={form.date_fin} onChange={(e) => setForm((f) => ({ ...f, date_fin: e.target.value }))} style={inputStyle} />
                    </div>
                  </div>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("nbJoursLabel")}</label>
                  <input type="number" min="0.5" step="0.5" required value={form.nb_jours} onChange={(e) => setForm((f) => ({ ...f, nb_jours: e.target.value }))} style={inputStyle} />
                </>
              )}

              {form.type_demande === "AVANCE" && (
                <>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("montantLabel")}</label>
                  <input type="number" min="0" required value={form.montant} onChange={(e) => setForm((f) => ({ ...f, montant: e.target.value }))} style={inputStyle} />
                </>
              )}

              {form.type_demande === "ORDRE_MISSION" && (
                <>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("destinationLabel")}</label>
                  <input required value={form.destination} onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))} style={inputStyle} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                    <div>
                      <label style={labelStyle}>{t("dateDebutLabel")}</label>
                      <input type="date" required value={form.date_debut} onChange={(e) => setForm((f) => ({ ...f, date_debut: e.target.value }))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>{t("dateFinLabel")}</label>
                      <input type="date" required value={form.date_fin} onChange={(e) => setForm((f) => ({ ...f, date_fin: e.target.value }))} style={inputStyle} />
                    </div>
                  </div>
                </>
              )}

              {form.type_demande === "HEURES_SUP" && (
                <>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("dateDebutLabel")}</label>
                  <input type="date" required value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} style={inputStyle} />
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("nbHeuresLabel")}</label>
                  <input type="number" min="0.5" step="0.5" required value={form.nb_heures} onChange={(e) => setForm((f) => ({ ...f, nb_heures: e.target.value }))} style={inputStyle} />
                </>
              )}

              {form.type_demande && (
                <>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("motifLabel")}</label>
                  <input value={form.motif} onChange={(e) => setForm((f) => ({ ...f, motif: e.target.value }))} style={inputStyle} />
                  <button type="submit" disabled={enCours} style={{ ...boutonPrincipalStyle, marginTop: 12 }}>
                    {enCours ? t("creatingDemande") : t("creerDemandeButton")}
                  </button>
                </>
              )}
            </form>
          )}
        </>
      )}

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : liste.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>
          {onglet === "mes" ? t("noMesDemandes") : t("noDemandesAValider")}
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {liste.map((d) => (
            <div key={d.id} className="card" style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{typeDemandeRHLabel(d.type_demande)}</span>
                  <span className={chipClasseStatut(d.statut)}>{statutDemandeRHLabel(d.statut)}</span>
                </div>
                {onglet === "avalider" && (
                  <span style={{ fontSize: 11.5, color: "var(--sub)" }}>
                    {t("demandeurLabel")} : {d.employe_prenom} {d.employe_nom}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--sub)" }}>
                <ResumeDetails demande={d} />
              </div>
              {d.statut === "REJETEE" && d.motif_rejet && (
                <div style={{ fontSize: 11.5, color: "var(--brique)" }}>{t("motifRejetPrompt")} {d.motif_rejet}</div>
              )}

              {onglet === "mes" && d.statut === "BROUILLON" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => handleSoumettre(d.id)} style={boutonMiniStyle}>{t("soumettreButton")}</button>
                  <button onClick={() => handleAnnuler(d.id)} style={boutonMiniStyle}>{t("annulerButton")}</button>
                </div>
              )}
              {onglet === "mes" && d.statut === "SOUMISE" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => handleAnnuler(d.id)} style={boutonMiniStyle}>{t("annulerButton")}</button>
                </div>
              )}

              {onglet === "avalider" && d.statut === "SOUMISE" && (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => handleApprouver(d.id)} style={boutonMiniStyle}>{t("approuverButton")}</button>
                    <button
                      onClick={() => { setRejetEnCoursId(rejetEnCoursId === d.id ? null : d.id); setMotifRejet(""); }}
                      style={boutonMiniStyle}
                    >
                      {t("rejeterButton")}
                    </button>
                  </div>
                  {rejetEnCoursId === d.id && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        placeholder={t("motifRejetPrompt")}
                        value={motifRejet}
                        onChange={(e) => setMotifRejet(e.target.value)}
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button onClick={() => handleConfirmerRejet(d.id)} disabled={!motifRejet} style={boutonMiniStyle}>
                        {t("rejeterButton")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function ongletStyle(actif) {
  return {
    background: actif ? "var(--petrol)" : "transparent",
    color: actif ? "#fff" : "var(--petrol)",
    border: "1px solid var(--petrol)",
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    gap: 6,
    alignItems: "center",
  };
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
const boutonMiniStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--petrol)",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
