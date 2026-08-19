"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";

export default function FicheEmployePage() {
  const { id } = useParams();
  const { t, statutEmployeLabel } = useLangue();
  const [fiche, setFiche] = useState(null);
  const [form, setForm] = useState(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    api
      .getFicheEmploye(id)
      .then((f) => {
        setFiche(f);
        setForm({
          poste: f.poste || "",
          type_contrat: f.type_contrat || "",
          date_embauche: f.date_embauche ? f.date_embauche.slice(0, 10) : "",
          date_fin_contrat: f.date_fin_contrat ? f.date_fin_contrat.slice(0, 10) : "",
          telephone: f.telephone || "",
          contact_urgence_nom: f.contact_urgence_nom || "",
          contact_urgence_telephone: f.contact_urgence_telephone || "",
          solde_conges: f.solde_conges != null ? String(f.solde_conges) : "0",
          statut: f.statut || "ACTIF",
        });
      })
      .catch((err) => setErreur(err.message));
  }, [id]);

  async function handleEnregistrer(e) {
    e.preventDefault();
    setEnCours(true);
    setMessage("");
    try {
      const maj = await api.patchFicheEmploye(id, {
        ...form,
        date_embauche: form.date_embauche || null,
        date_fin_contrat: form.date_fin_contrat || null,
        solde_conges: form.solde_conges !== "" ? Number(form.solde_conges) : null,
      });
      setFiche(maj);
      setMessage(t("ficheUpdated"));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  if (erreur && !fiche) {
    return (
      <AppShell title={t("ficheEmployePageTitle")}>
        <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>
      </AppShell>
    );
  }

  if (!fiche || !form) {
    return (
      <AppShell title={t("ficheEmployePageTitle")}>
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </AppShell>
    );
  }

  return (
    <AppShell title={`${fiche.prenom} ${fiche.nom}`}>
      <Link href="/rh/personnel" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>
        {t("backToPersonnel")}
      </Link>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}

      <div className="card" style={{ maxWidth: 560, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          {fiche.prenom} {fiche.nom}
        </div>
        <div style={{ fontSize: 12, color: "var(--sub)", marginBottom: 8 }}>{fiche.email}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(fiche.roles || []).length === 0 ? (
            <span style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("aucunRole")}</span>
          ) : (
            fiche.roles.map((r) => (
              <span key={r.code} className="chip ok">
                {r.libelle}
              </span>
            ))
          )}
        </div>
      </div>

      <form onSubmit={handleEnregistrer} className="card" style={{ maxWidth: 560 }}>
        <label style={labelStyle}>{t("posteLabel")}</label>
        <input
          value={form.poste}
          onChange={(e) => setForm((f) => ({ ...f, poste: e.target.value }))}
          style={inputStyle}
        />

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("typeContratLabel")}</label>
        <input
          value={form.type_contrat}
          onChange={(e) => setForm((f) => ({ ...f, type_contrat: e.target.value }))}
          style={inputStyle}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
          <div>
            <label style={labelStyle}>{t("dateEmbaucheLabel")}</label>
            <input
              type="date"
              value={form.date_embauche}
              onChange={(e) => setForm((f) => ({ ...f, date_embauche: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>{t("dateFinContratLabel")}</label>
            <input
              type="date"
              value={form.date_fin_contrat}
              onChange={(e) => setForm((f) => ({ ...f, date_fin_contrat: e.target.value }))}
              style={inputStyle}
            />
          </div>
        </div>

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("telephoneLabel")}</label>
        <input
          value={form.telephone}
          onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))}
          style={inputStyle}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
          <div>
            <label style={labelStyle}>{t("contactUrgenceNomLabel")}</label>
            <input
              value={form.contact_urgence_nom}
              onChange={(e) => setForm((f) => ({ ...f, contact_urgence_nom: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>{t("contactUrgenceTelephoneLabel")}</label>
            <input
              value={form.contact_urgence_telephone}
              onChange={(e) => setForm((f) => ({ ...f, contact_urgence_telephone: e.target.value }))}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
          <div>
            <label style={labelStyle}>{t("soldeCongesLabel")}</label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={form.solde_conges}
              onChange={(e) => setForm((f) => ({ ...f, solde_conges: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>{t("statutEmployeLabel")}</label>
            <select
              value={form.statut}
              onChange={(e) => setForm((f) => ({ ...f, statut: e.target.value }))}
              style={inputStyle}
            >
              <option value="ACTIF">{statutEmployeLabel("ACTIF")}</option>
              <option value="INACTIF">{statutEmployeLabel("INACTIF")}</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={enCours}
          style={{
            marginTop: 14,
            background: "var(--petrol)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          {enCours ? t("savingFiche") : t("saveFicheButton")}
        </button>
      </form>
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
