"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { superAdminApi } from "../../../../lib/superAdminApi";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import SuperAdminShell from "../../../../lib/components/SuperAdminShell";

const FORM_VIDE = {
  raison_sociale: "",
  secteur_activite: "",
  pays: "Senegal",
  formule_abonnement_id: "",
  admin_nom: "",
  admin_prenom: "",
  admin_email: "",
};

// Creation d'un client - Steeve seul cree chaque entreprise cliente (pas
// d'inscription publique, decision actee le 04/09/2026). Cree en une seule
// operation l'entreprise ET son premier compte administrateur (voir
// backend POST /api/super-admin/clients) : le mot de passe temporaire
// genere n'est renvoye qu'une seule fois par le backend (aucun service
// d'email configure), il faut le communiquer manuellement avant de fermer
// la fenetre - meme convention que la creation d'utilisateur cote client.
export default function SuperAdminNouveauClientPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [formules, setFormules] = useState([]);
  const [form, setForm] = useState(FORM_VIDE);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);
  const [resultat, setResultat] = useState(null);
  const formuleSelectionnee = formules.find((f) => f.id === form.formule_abonnement_id) || null;

  useEffect(() => {
    superAdminApi
      .getFormules()
      .then((data) => setFormules(data.filter((f) => f.actif)))
      .catch((err) => {
        if (err.status === 401) {
          router.push("/super-admin/login");
        }
      });
  }, [router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErreur("");
    setChargement(true);
    try {
      const data = await superAdminApi.createClient({
        ...form,
        formule_abonnement_id: form.formule_abonnement_id || null,
      });
      setResultat(data);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChargement(false);
    }
  }

  if (resultat) {
    return (
      <SuperAdminShell title={t("saNewClientPageTitle")} backHref="/super-admin/clients">
        <div className="card" style={{ maxWidth: 520, border: "1px solid var(--ocre)", background: "rgba(224,149,76,0.08)" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
            {t("saClientCreatedTitle")} — {resultat.raison_sociale}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 12 }}>
            {t("saClientCreatedDescription")}
          </div>
          <div style={{ fontSize: 12.5, marginBottom: 4 }}>
            <strong>{t("emailLabel")}:</strong> {resultat.premier_administrateur.email}
          </div>
          <div style={{ fontSize: 12.5, marginBottom: 10 }}>
            <strong>{t("saTempPasswordLabel")}:</strong>
          </div>
          <div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>
            {resultat.premier_administrateur.mot_de_passe_temporaire}
          </div>
          {resultat.premiere_facture_installation && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
              <div style={{ fontSize: 12.5 }}>
                <strong>{t("saFirstInvoiceGeneratedNote")}</strong>{" "}
                {Number(resultat.premiere_facture_installation.montant_xof).toLocaleString()} XOF (
                {t("saInvoiceTypeInstallation")}, {resultat.premiere_facture_installation.periode})
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={() => router.push(`/super-admin/clients/${resultat.id}`)} style={boutonPrincipalStyle}>
              {t("saViewClientButton")}
            </button>
            <button
              onClick={() => {
                setResultat(null);
                setForm(FORM_VIDE);
              }}
              style={boutonSecondaireStyle}
            >
              {t("saCreateAnotherButton")}
            </button>
          </div>
        </div>
      </SuperAdminShell>
    );
  }

  return (
    <SuperAdminShell title={t("saNewClientPageTitle")} backHref="/super-admin/clients">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 520 }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 12 }}>{t("saCompanySection")}</h3>
        <label style={labelStyle}>{t("saCompanyNameLabel")}</label>
        <input
          required
          value={form.raison_sociale}
          onChange={(e) => setForm((f) => ({ ...f, raison_sociale: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("saSectorLabel")}</label>
        <input
          value={form.secteur_activite}
          onChange={(e) => setForm((f) => ({ ...f, secteur_activite: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("saCountryLabel")}</label>
        <input
          value={form.pays}
          onChange={(e) => setForm((f) => ({ ...f, pays: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("saFormuleLabel")}</label>
        <select
          value={form.formule_abonnement_id}
          onChange={(e) => setForm((f) => ({ ...f, formule_abonnement_id: e.target.value }))}
          style={inputStyle}
        >
          <option value="">{t("saNoFormule")}</option>
          {formules.map((formule) => (
            <option key={formule.id} value={formule.id}>
              {formule.nom} ({Number(formule.prix_mensuel_xof).toLocaleString()} XOF/{t("saMonthAbbrev")})
            </option>
          ))}
        </select>
        {formuleSelectionnee && (
          <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 6 }}>
            {t("saInstallationFeeLabel")}:{" "}
            {Number(formuleSelectionnee.frais_installation_xof) > 0
              ? `${Number(formuleSelectionnee.frais_installation_xof).toLocaleString()} XOF ${t("saInstallationFeeAutoNote")}`
              : t("saNoInstallationFee")}
          </div>
        )}

        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginTop: 20, marginBottom: 12 }}>
          {t("saFirstAdminSection")}
        </h3>
        <label style={labelStyle}>{t("firstNameLabel")}</label>
        <input
          required
          value={form.admin_prenom}
          onChange={(e) => setForm((f) => ({ ...f, admin_prenom: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("lastNameLabel")}</label>
        <input
          required
          value={form.admin_nom}
          onChange={(e) => setForm((f) => ({ ...f, admin_nom: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("userEmailLabel")}</label>
        <input
          required
          type="email"
          value={form.admin_email}
          onChange={(e) => setForm((f) => ({ ...f, admin_email: e.target.value }))}
          style={inputStyle}
        />

        <button type="submit" disabled={chargement} style={{ ...boutonPrincipalStyle, marginTop: 18 }}>
          {chargement ? t("saCreating") : t("saCreateClientButton")}
        </button>
      </form>
    </SuperAdminShell>
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
  background: "#1E1508",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "9px 16px",
  fontSize: 12.5,
  fontWeight: 600,
};
const boutonSecondaireStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
};
