"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";

export default function NouvelleFicheEmployePage() {
  const router = useRouter();
  const { t } = useLangue();
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [form, setForm] = useState({
    utilisateur_id: "",
    poste: "",
    type_contrat: "",
    date_embauche: "",
    telephone: "",
    contact_urgence_nom: "",
    contact_urgence_telephone: "",
    solde_conges: "",
  });

  useEffect(() => {
    api.getUtilisateursDisponiblesRH().then(setUtilisateurs).catch((err) => setErreur(err.message));
  }, []);

  async function handleCreer(e) {
    e.preventDefault();
    setEnCours(true);
    try {
      const nouvelle = await api.createFicheEmploye({
        ...form,
        date_embauche: form.date_embauche || null,
        solde_conges: form.solde_conges ? Number(form.solde_conges) : 0,
      });
      router.push(`/rh/personnel/${nouvelle.id}`);
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  }

  return (
    <AppShell title={t("newFicheEmploye")}>
      <Link href="/rh/personnel" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>
        {t("backToPersonnel")}
      </Link>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <form onSubmit={handleCreer} className="card" style={{ maxWidth: 560 }}>
        <label style={labelStyle}>{t("utilisateurLabel")}</label>
        <select
          required
          value={form.utilisateur_id}
          onChange={(e) => setForm((f) => ({ ...f, utilisateur_id: e.target.value }))}
          style={inputStyle}
        >
          <option value="">{t("selectUtilisateur")}</option>
          {utilisateurs.map((u) => (
            <option key={u.id} value={u.id}>
              {u.prenom} {u.nom} ({u.email})
            </option>
          ))}
        </select>
        {utilisateurs.length === 0 && (
          <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 6 }}>{t("noUtilisateursDisponibles")}</p>
        )}

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("posteLabel")}</label>
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
            <label style={labelStyle}>{t("telephoneLabel")}</label>
            <input
              value={form.telephone}
              onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))}
              style={inputStyle}
            />
          </div>
        </div>

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

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("soldeCongesLabel")}</label>
        <input
          type="number"
          step="0.5"
          min="0"
          value={form.solde_conges}
          onChange={(e) => setForm((f) => ({ ...f, solde_conges: e.target.value }))}
          style={inputStyle}
        />

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
          {enCours ? t("creatingFiche") : t("creerFicheButton")}
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
