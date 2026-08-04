"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import LanguageSwitcher from "../../lib/i18n/LanguageSwitcher";

const TYPES_COURRIER = [
  "DEMANDE_CLARIFICATION",
  "DEMANDE_FINANCEMENT",
  "DEMANDE_GARANTIE",
  "DEMANDE_MAINLEVEE",
  "DEMANDE_PROROGATION",
  "RESERVE_ORDRE_SERVICE",
  "RELANCE_PAIEMENT",
  "RECOURS_GRACIEUX",
  "RECOURS_CONTENTIEUX",
  "NOTIFICATION_SOUS_TRAITANCE",
];

export default function CourriersPage() {
  const { t, typeCourrierLabel } = useLangue();
  const [modeles, setModeles] = useState([]);
  const [erreur, setErreur] = useState("");
  const [formOuvert, setFormOuvert] = useState(false);
  const [form, setForm] = useState({
    type_courrier: TYPES_COURRIER[0],
    titre: "",
    corps_template: "",
    declencheur_evenement: "",
  });

  useEffect(() => {
    api.getModelesCourrier().then(setModeles).catch((err) => setErreur(err.message));
  }, []);

  async function handleAjouter(e) {
    e.preventDefault();
    try {
      const nouveau = await api.createModeleCourrier(form);
      setModeles((prev) => [...prev, nouveau]);
      setFormOuvert(false);
      setForm({ type_courrier: TYPES_COURRIER[0], titre: "", corps_template: "", declencheur_evenement: "" });
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px 60px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <Link href="/dashboard" style={{ fontSize: 12.5, color: "var(--sub)" }}>
            ← {t("backToDashboard")}
          </Link>
          <h1 style={{ fontSize: 19, color: "var(--petrol)", marginTop: 6 }}>{t("lettersPageTitle")}</h1>
        </div>
        <LanguageSwitcher variant="default" persistToBackend />
      </header>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button onClick={() => setFormOuvert((v) => !v)} style={boutonPrincipalStyle}>
          {formOuvert ? t("cancel") : t("newLetterTemplate")}
        </button>
      </div>

      {formOuvert && (
        <form onSubmit={handleAjouter} className="card" style={{ marginBottom: 16 }}>
          <label style={labelStyle}>{t("letterTypeLabel")}</label>
          <select
            value={form.type_courrier}
            onChange={(e) => setForm((f) => ({ ...f, type_courrier: e.target.value }))}
            style={inputStyle}
          >
            {TYPES_COURRIER.map((code) => (
              <option key={code} value={code}>
                {typeCourrierLabel(code)}
              </option>
            ))}
          </select>

          <label style={{ ...labelStyle, marginTop: 10 }}>{t("letterTitleLabel")}</label>
          <input
            required
            value={form.titre}
            onChange={(e) => setForm((f) => ({ ...f, titre: e.target.value }))}
            style={inputStyle}
            placeholder="Demande de prorogation - {{dossier.reference}}"
          />

          <label style={{ ...labelStyle, marginTop: 10 }}>{t("letterBodyLabel")}</label>
          <textarea
            required
            rows={8}
            value={form.corps_template}
            onChange={(e) => setForm((f) => ({ ...f, corps_template: e.target.value }))}
            style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12.5 }}
            placeholder={
              "Monsieur le Directeur,\n\nConcernant le marché {{dossier.reference}} - {{dossier.intitule}}...\n\nCordialement."
            }
          />

          <label style={{ ...labelStyle, marginTop: 10 }}>{t("letterTriggerLabel")}</label>
          <input
            value={form.declencheur_evenement}
            onChange={(e) => setForm((f) => ({ ...f, declencheur_evenement: e.target.value }))}
            style={inputStyle}
            placeholder="Ex : tâche en retard sur le chronogramme"
          />

          <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 14 }}>
            {t("save")}
          </button>
        </form>
      )}

      {modeles.length === 0 ? (
        <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("noLetterTemplates")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {modeles.map((m) => (
            <div key={m.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{m.titre}</div>
                <span className="chip warn">{typeCourrierLabel(m.type_courrier)}</span>
              </div>
              {m.declencheur_evenement && (
                <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{m.declencheur_evenement}</div>
              )}
            </div>
          ))}
        </div>
      )}
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
