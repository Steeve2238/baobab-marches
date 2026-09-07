"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";

const STATUT_STYLE = {
  RECUE: { color: "var(--ocre)", background: "rgba(224,149,76,0.12)" },
  DEVIS_EN_COURS: { color: "var(--petrol)", background: "rgba(11,61,64,0.1)" },
  CONVERTIE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  SANS_SUITE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};
const DEVIS_LIEN_BASE = "/ventes/devis";

// Fiche detaillee d'une consultation : infos client + edition (statut, date
// limite de reponse, notes), chronogramme propre a cette consultation (voir
// backend/src/services/chronogrammeConsultationEngine.js, confirme avec
// Steeve le 07/09/2026 - retro-planning proportionnel a la fenetre
// [date_reception -> date_limite_reponse], pas d'offsets fixes comme pour un
// dossier d'AO) et devis deja lies. Meme structure que la fiche
// /marches/consultation-restreinte/consultations/[id] (les deux entrees de
// navigation partagent exactement les memes routes API et tables, voir
// resume_reprise_projet.md).
export default function ConsultationDetailPage() {
  const { id } = useParams();
  const { t, tacheStatutLabel, dict } = useLangue();

  const [consultation, setConsultation] = useState(null);
  const [roles, setRoles] = useState([]);
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const [formInfo, setFormInfo] = useState({ statut: "", date_limite_reponse: "", notes: "" });
  const [infoEnCours, setInfoEnCours] = useState(false);

  const [formTacheOuvert, setFormTacheOuvert] = useState(false);
  const [formTache, setFormTache] = useState({
    intitule: "",
    jalon_relatif: "",
    date_echeance: "",
    role_porteur_id: "",
    assigne_utilisateur_id: "",
  });
  const [tacheEnCours, setTacheEnCours] = useState(false);
  const [genererEnCours, setGenererEnCours] = useState(false);

  useEffect(() => {
    async function charger() {
      try {
        const [consultationData, rolesData, utilisateursData] = await Promise.all([
          api.getConsultation(id),
          api.getRoles(),
          api.getUtilisateurs(),
        ]);
        setConsultation(consultationData);
        setRoles(rolesData);
        setUtilisateurs(utilisateursData);
        setFormInfo({
          statut: consultationData.statut,
          date_limite_reponse: consultationData.date_limite_reponse
            ? consultationData.date_limite_reponse.slice(0, 10)
            : "",
          notes: consultationData.notes || "",
        });
      } catch (err) {
        setErreur(err.message || t("defaultLoadError"));
      } finally {
        setChargement(false);
      }
    }
    if (id) charger();
  }, [id, t]);

  async function handleEnregistrerInfo(e) {
    e.preventDefault();
    setInfoEnCours(true);
    try {
      const maj = await api.patchConsultation(id, {
        statut: formInfo.statut,
        date_limite_reponse: formInfo.date_limite_reponse || null,
        notes: formInfo.notes,
      });
      setConsultation((prev) => ({ ...prev, ...maj }));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setInfoEnCours(false);
    }
  }

  async function handleGenererChronogramme(force = false) {
    setGenererEnCours(true);
    try {
      const nouvelles = await api.genererChronogrammeConsultation(id, force);
      setConsultation((prev) => ({ ...prev, taches: nouvelles }));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setGenererEnCours(false);
    }
  }

  async function handleAjouterTache(e) {
    e.preventDefault();
    setTacheEnCours(true);
    try {
      const nouvelle = await api.createTacheConsultation(id, {
        intitule: formTache.intitule,
        jalon_relatif: formTache.jalon_relatif || null,
        date_echeance: formTache.date_echeance || null,
        role_porteur_id: formTache.role_porteur_id || null,
        assigne_utilisateur_id: formTache.assigne_utilisateur_id || null,
      });
      setConsultation((prev) => ({ ...prev, taches: [...prev.taches, nouvelle] }));
      setFormTacheOuvert(false);
      setFormTache({
        intitule: "",
        jalon_relatif: "",
        date_echeance: "",
        role_porteur_id: "",
        assigne_utilisateur_id: "",
      });
    } catch (err) {
      setErreur(err.message);
    } finally {
      setTacheEnCours(false);
    }
  }

  async function handlePatchTacheStatut(tacheId, statut) {
    try {
      const maj = await api.patchTacheConsultationStatut(tacheId, statut);
      setConsultation((prev) => ({
        ...prev,
        taches: prev.taches.map((tache) => (tache.id === tacheId ? maj : tache)),
      }));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handlePatchTacheAffectation(tacheId, champ, valeur) {
    try {
      const tacheActuelle = consultation.taches.find((tache) => tache.id === tacheId);
      const maj = await api.patchTacheConsultationAffectation(tacheId, {
        role_porteur_id: tacheActuelle.role_porteur_id,
        assigne_utilisateur_id: tacheActuelle.assigne_utilisateur_id,
        [champ]: valeur || null,
      });
      setConsultation((prev) => ({
        ...prev,
        taches: prev.taches.map((tache) => (tache.id === tacheId ? maj : tache)),
      }));
    } catch (err) {
      setErreur(err.message);
    }
  }

  if (chargement) {
    return <div style={{ padding: 28 }}>{t("loading")}</div>;
  }

  if (erreur && !consultation) {
    return <div style={{ padding: 28, color: "var(--brique)" }}>{erreur}</div>;
  }

  const style = STATUT_STYLE[consultation.statut] || {};

  return (
    <AppShell backHref="/ventes/consultations" backLabelKey="backToConsultations">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 19, color: "var(--petrol)" }}>{consultation.objet}</h1>
        <div className="mono" style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 2 }}>
          {consultation.client_nom}
          {" · "}
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 20,
              whiteSpace: "nowrap",
              ...style,
            }}
          >
            {t(`venteConsultationStatut_${consultation.statut}`)}
          </span>
        </div>
      </div>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {/* ---------------- INFORMATIONS ---------------- */}
      <section style={{ marginBottom: 30 }}>
        <h2 style={{ fontSize: 15.5, color: "var(--petrol)", marginBottom: 12 }}>{t("venteInfoSectionTitle")}</h2>
        <form onSubmit={handleEnregistrerInfo} className="card">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>{t("venteDateReceptionLabel")}</label>
              <div style={{ ...inputStyle, background: "var(--line-soft)" }}>
                {consultation.date_reception
                  ? new Date(consultation.date_reception).toLocaleDateString(dict.dateLocale)
                  : "—"}
              </div>
            </div>
            <div>
              <label style={labelStyle}>{t("venteDateLimiteReponseLabel")}</label>
              <input
                type="date"
                value={formInfo.date_limite_reponse}
                onChange={(e) => setFormInfo((f) => ({ ...f, date_limite_reponse: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>{t("venteStatutLabel")}</label>
              <select
                value={formInfo.statut}
                onChange={(e) => setFormInfo((f) => ({ ...f, statut: e.target.value }))}
                style={inputStyle}
              >
                {Object.keys(STATUT_STYLE).map((code) => (
                  <option key={code} value={code}>
                    {t(`venteConsultationStatut_${code}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label style={{ ...labelStyle, marginTop: 10 }}>{t("notesLabel")}</label>
          <textarea
            value={formInfo.notes}
            onChange={(e) => setFormInfo((f) => ({ ...f, notes: e.target.value }))}
            style={{ ...inputStyle, minHeight: 60 }}
          />
          <button type="submit" disabled={infoEnCours} style={{ ...boutonPrincipalStyle, marginTop: 12 }}>
            {t("save")}
          </button>
        </form>
      </section>

      {/* ---------------- DEVIS LIES ---------------- */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("venteDevisSectionTitle")}</h2>
          <Link
            href={`${DEVIS_LIEN_BASE}/nouveau?consultation_id=${consultation.id}&client_commercial_id=${consultation.client_commercial_id}`}
            style={boutonSecondaireStyle}
          >
            {t("venteCreateDevisFromConsultation")}
          </Link>
        </div>
        {consultation.devis.length === 0 ? (
          <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>
            {t("venteNoLinkedDevis")}
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {consultation.devis.map((d) => (
              <Link
                key={d.id}
                href={`${DEVIS_LIEN_BASE}/${d.id}`}
                className="card"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
                  {d.numero}
                </span>
                <span className={`chip ${d.statut === "VALIDE" ? "ok" : d.statut === "REFUSE" ? "risk" : "warn"}`}>
                  {t(`venteDevisStatut_${d.statut}`)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- CHRONOGRAMME ---------------- */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("chronogramSection")}</h2>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => handleGenererChronogramme(consultation.taches.length > 0)}
              disabled={genererEnCours || !consultation.date_limite_reponse}
              style={boutonSecondaireStyle}
            >
              {consultation.taches.length > 0 ? t("regenerateChronogram") : t("generateChronogram")}
            </button>
            <button onClick={() => setFormTacheOuvert((v) => !v)} style={boutonPrincipalStyle}>
              {formTacheOuvert ? t("cancel") : t("addTask")}
            </button>
          </div>
        </div>

        {!consultation.date_limite_reponse && (
          <p style={{ fontSize: 11.5, color: "var(--ocre)", marginBottom: 10 }}>{t("missingResponseDeadline")}</p>
        )}

        {formTacheOuvert && (
          <form onSubmit={handleAjouterTache} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>{t("taskTitleLabel")}</label>
                <input
                  required
                  value={formTache.intitule}
                  onChange={(e) => setFormTache((f) => ({ ...f, intitule: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("taskMilestoneLabel")}</label>
                <input
                  value={formTache.jalon_relatif}
                  onChange={(e) => setFormTache((f) => ({ ...f, jalon_relatif: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("taskDueDateLabel")}</label>
                <input
                  type="date"
                  value={formTache.date_echeance}
                  onChange={(e) => setFormTache((f) => ({ ...f, date_echeance: e.target.value }))}
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div>
                <label style={labelStyle}>{t("assignRoleLabel")}</label>
                <select
                  value={formTache.role_porteur_id}
                  onChange={(e) => setFormTache((f) => ({ ...f, role_porteur_id: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="">{t("noRoleOption")}</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.libelle}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t("assignPersonLabel")}</label>
                <select
                  value={formTache.assigne_utilisateur_id}
                  onChange={(e) => setFormTache((f) => ({ ...f, assigne_utilisateur_id: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="">{t("noPersonOption")}</option>
                  {utilisateurs.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.prenom} {u.nom}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button type="submit" disabled={tacheEnCours} style={{ ...boutonPrincipalStyle, marginTop: 14 }}>
              {t("save")}
            </button>
          </form>
        )}

        {consultation.taches.length === 0 ? (
          <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>
            {t("noTasks")}
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {consultation.taches.map((tache) => (
              <div key={tache.id} className="card" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 10.5, color: "var(--sub)", textTransform: "uppercase" }}>
                      {tache.jalon_relatif || ""}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>{tache.intitule}</div>
                    <div className="mono" style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 2 }}>
                      {tache.date_echeance
                        ? new Date(tache.date_echeance).toLocaleDateString(dict.dateLocale)
                        : "—"}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <span
                      className={`chip ${
                        tache.statut === "FAIT"
                          ? "ok"
                          : tache.statut === "EN_RETARD"
                          ? "risk"
                          : tache.statut === "EN_COURS"
                          ? "warn"
                          : ""
                      }`}
                      style={tache.statut === "A_FAIRE" ? { background: "var(--line-soft)", color: "var(--sub)" } : {}}
                    >
                      {tacheStatutLabel(tache.statut)}
                    </span>
                    {tache.statut !== "FAIT" && (
                      <button
                        onClick={() =>
                          handlePatchTacheStatut(tache.id, tache.statut === "A_FAIRE" ? "EN_COURS" : "FAIT")
                        }
                        style={boutonSecondaireStyle}
                      >
                        {tache.statut === "A_FAIRE" ? t("markAsInProgress") : t("markAsDone")}
                      </button>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    borderTop: "1px solid var(--line)",
                    paddingTop: 8,
                  }}
                >
                  <span style={{ fontSize: 10.5, color: "var(--sub)", textTransform: "uppercase", flexShrink: 0 }}>
                    {t("assignedToLabel")}
                  </span>
                  <select
                    value={tache.role_porteur_id || ""}
                    onChange={(e) => handlePatchTacheAffectation(tache.id, "role_porteur_id", e.target.value)}
                    style={{ ...inputStyle, fontSize: 11.5, padding: "5px 8px" }}
                  >
                    <option value="">{t("noRoleOption")}</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.libelle}
                      </option>
                    ))}
                  </select>
                  <select
                    value={tache.assigne_utilisateur_id || ""}
                    onChange={(e) =>
                      handlePatchTacheAffectation(tache.id, "assigne_utilisateur_id", e.target.value)
                    }
                    style={{ ...inputStyle, fontSize: 11.5, padding: "5px 8px" }}
                  >
                    <option value="">{t("noPersonOption")}</option>
                    {utilisateurs.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.prenom} {u.nom}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
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
const boutonSecondaireStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
  textDecoration: "none",
  display: "inline-block",
};
