"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { superAdminApi } from "../../../lib/superAdminApi";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import SuperAdminShell from "../../../lib/components/SuperAdminShell";

const FORM_VIDE = { nom: "", plafond_utilisateurs: "", prix_mensuel_xof: "", ordre_affichage: "" };

// Catalogue des formules d'abonnement (plateforme, pas de tenant_id) - les 3
// formules de depart (Essentiel/Croissance/Entreprise) sont des valeurs
// initiales proposees par defaut (migration 014), modifiables ici a tout
// moment. Modifier une formule ne change jamais retroactivement les
// factures deja generees (nom/prix y sont figes au moment de la
// generation, voir backend routes/superAdmin.js).
export default function SuperAdminFormulesPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [formules, setFormules] = useState([]);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [form, setForm] = useState(FORM_VIDE);
  const [enEdition, setEnEdition] = useState(null);
  const [formEdition, setFormEdition] = useState(FORM_VIDE);

  function charger() {
    superAdminApi
      .getFormules()
      .then(setFormules)
      .catch((err) => {
        if (err.status === 401) {
          router.push("/super-admin/login");
          return;
        }
        setErreur(err.message);
      })
      .finally(() => setChargement(false));
  }

  useEffect(charger, [router]);

  async function handleCreer(e) {
    e.preventDefault();
    setErreur("");
    try {
      const nouvelle = await superAdminApi.createFormule({
        nom: form.nom,
        plafond_utilisateurs: form.plafond_utilisateurs ? Number(form.plafond_utilisateurs) : null,
        prix_mensuel_xof: Number(form.prix_mensuel_xof),
        ordre_affichage: form.ordre_affichage ? Number(form.ordre_affichage) : 0,
      });
      setFormules((prev) => [...prev, nouvelle]);
      setForm(FORM_VIDE);
    } catch (err) {
      setErreur(err.message);
    }
  }

  function commencerEdition(formule) {
    setEnEdition(formule.id);
    setFormEdition({
      nom: formule.nom,
      plafond_utilisateurs: formule.plafond_utilisateurs ?? "",
      prix_mensuel_xof: formule.prix_mensuel_xof,
      ordre_affichage: formule.ordre_affichage,
    });
  }

  async function handleEnregistrerEdition(id) {
    setErreur("");
    try {
      const maj = await superAdminApi.patchFormule(id, {
        nom: formEdition.nom,
        plafond_utilisateurs: formEdition.plafond_utilisateurs ? Number(formEdition.plafond_utilisateurs) : null,
        prix_mensuel_xof: Number(formEdition.prix_mensuel_xof),
        ordre_affichage: Number(formEdition.ordre_affichage),
      });
      setFormules((prev) => prev.map((f) => (f.id === id ? maj : f)));
      setEnEdition(null);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleToggleActif(formule) {
    setErreur("");
    try {
      const maj = await superAdminApi.patchFormule(formule.id, { actif: !formule.actif });
      setFormules((prev) => prev.map((f) => (f.id === formule.id ? maj : f)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <SuperAdminShell title={t("saFormulesPageTitle")} backHref="/super-admin">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <form onSubmit={handleCreer} className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 12 }}>{t("saNewFormuleSection")}</h3>
        <label style={labelStyle}>{t("saFormuleNameLabel")}</label>
        <input
          required
          value={form.nom}
          onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("saUserCapLabel")}</label>
        <input
          type="number"
          min="1"
          placeholder={t("saUnlimitedPlaceholder")}
          value={form.plafond_utilisateurs}
          onChange={(e) => setForm((f) => ({ ...f, plafond_utilisateurs: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("saMonthlyPriceLabel")}</label>
        <input
          required
          type="number"
          min="0"
          value={form.prix_mensuel_xof}
          onChange={(e) => setForm((f) => ({ ...f, prix_mensuel_xof: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("saDisplayOrderLabel")}</label>
        <input
          type="number"
          value={form.ordre_affichage}
          onChange={(e) => setForm((f) => ({ ...f, ordre_affichage: e.target.value }))}
          style={inputStyle}
        />
        <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12 }}>
          {t("saCreateFormuleButton")}
        </button>
      </form>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {formules.map((formule) => (
            <div key={formule.id} className="card">
              {enEdition === formule.id ? (
                <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
                  <div>
                    <label style={labelStyle}>{t("saFormuleNameLabel")}</label>
                    <input
                      value={formEdition.nom}
                      onChange={(e) => setFormEdition((f) => ({ ...f, nom: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>{t("saUserCapLabel")}</label>
                    <input
                      type="number"
                      min="1"
                      placeholder={t("saUnlimitedPlaceholder")}
                      value={formEdition.plafond_utilisateurs}
                      onChange={(e) => setFormEdition((f) => ({ ...f, plafond_utilisateurs: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>{t("saMonthlyPriceLabel")}</label>
                    <input
                      type="number"
                      min="0"
                      value={formEdition.prix_mensuel_xof}
                      onChange={(e) => setFormEdition((f) => ({ ...f, prix_mensuel_xof: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>{t("saDisplayOrderLabel")}</label>
                    <input
                      type="number"
                      value={formEdition.ordre_affichage}
                      onChange={(e) => setFormEdition((f) => ({ ...f, ordre_affichage: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => handleEnregistrerEdition(formule.id)} style={boutonSecondaireStyle}>
                      {t("save")}
                    </button>
                    <button onClick={() => setEnEdition(null)} style={boutonSecondaireStyle}>
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{formule.nom}</div>
                    <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>
                      {Number(formule.prix_mensuel_xof).toLocaleString()} XOF/{t("saMonthAbbrev")} ·{" "}
                      {formule.plafond_utilisateurs
                        ? `${formule.plafond_utilisateurs} ${t("saUsersCount")} max`
                        : t("saUnlimitedUsers")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        padding: "3px 8px",
                        borderRadius: 20,
                        color: formule.actif ? "#2E7D5B" : "var(--sub)",
                        background: formule.actif ? "rgba(46,125,91,0.12)" : "rgba(91,106,108,0.1)",
                      }}
                    >
                      {formule.actif ? t("activeLabel") : t("saFormuleRetired")}
                    </span>
                    <button onClick={() => commencerEdition(formule)} style={boutonSecondaireStyle}>
                      {t("saEditButton")}
                    </button>
                    <button onClick={() => handleToggleActif(formule)} style={boutonSecondaireStyle}>
                      {formule.actif ? t("saRetireFormuleButton") : t("saRestoreFormuleButton")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
};
