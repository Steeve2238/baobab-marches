"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { superAdminApi } from "../../../../lib/superAdminApi";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import SuperAdminShell from "../../../../lib/components/SuperAdminShell";

const STATUT_FACTURE_STYLE = {
  IMPAYEE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  PAYEE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  ANNULEE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};

export default function SuperAdminClientDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useLangue();
  const [client, setClient] = useState(null);
  const [formules, setFormules] = useState([]);
  const [factures, setFactures] = useState([]);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [formuleSelectionnee, setFormuleSelectionnee] = useState("");
  const [modePaiementFacture, setModePaiementFacture] = useState({});
  const [prixCompta, setPrixCompta] = useState("");

  function charger() {
    Promise.all([
      superAdminApi.getClient(params.id),
      superAdminApi.getFormules(),
      superAdminApi.getFacturesClient(params.id),
    ])
      .then(([clientData, formulesData, facturesData]) => {
        setClient(clientData);
        setFormuleSelectionnee(clientData.formule_abonnement_id || "");
        setPrixCompta(String(Number(clientData.module_comptabilite_prix_mensuel_xof || 0)));
        setFormules(formulesData);
        setFactures(facturesData);
      })
      .catch((err) => {
        if (err.status === 401) {
          router.push("/super-admin/login");
          return;
        }
        setErreur(err.message);
      })
      .finally(() => setChargement(false));
  }

  useEffect(charger, [params.id, router]);

  async function handleSuspendre() {
    setErreur("");
    try {
      const maj = await superAdminApi.suspendreClient(client.id);
      setClient((prev) => ({ ...prev, ...maj }));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleReactiver() {
    setErreur("");
    try {
      const maj = await superAdminApi.reactiverClient(client.id);
      setClient((prev) => ({ ...prev, ...maj }));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleEnregistrerFormule() {
    setErreur("");
    try {
      const maj = await superAdminApi.patchClient(client.id, {
        raison_sociale: client.raison_sociale,
        secteur_activite: client.secteur_activite,
        pays: client.pays,
        formule_abonnement_id: formuleSelectionnee || null,
      });
      setClient((prev) => ({ ...prev, ...maj }));
    } catch (err) {
      setErreur(err.message);
    }
  }

  // Module Comptabilite vendu en option (migration 032) : activer / verrouiller
  // et fixer le supplement mensuel. Verrouiller ne supprime aucune donnee.
  async function handleModuleCompta(actif) {
    if (!actif && typeof window !== "undefined" && !window.confirm(t("saModuleComptaLockConfirm"))) return;
    setErreur("");
    try {
      const maj = await superAdminApi.patchModuleComptabilite(client.id, {
        actif,
        prix_mensuel_xof: prixCompta === "" ? 0 : Number(prixCompta),
      });
      setClient((prev) => ({ ...prev, ...maj }));
      setPrixCompta(String(Number(maj.module_comptabilite_prix_mensuel_xof || 0)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleEnregistrerPrixCompta() {
    setErreur("");
    try {
      const maj = await superAdminApi.patchModuleComptabilite(client.id, {
        actif: !!client.module_comptabilite_actif,
        prix_mensuel_xof: prixCompta === "" ? 0 : Number(prixCompta),
      });
      setClient((prev) => ({ ...prev, ...maj }));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleGenererFacture() {
    setErreur("");
    try {
      const nouvelle = await superAdminApi.genererFacture(client.id);
      setFactures((prev) => [nouvelle, ...prev]);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleGenererFactureInstallation() {
    setErreur("");
    try {
      const nouvelle = await superAdminApi.genererFactureInstallation(client.id);
      setFactures((prev) => [nouvelle, ...prev]);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleMarquerPayee(factureId) {
    setErreur("");
    try {
      const maj = await superAdminApi.marquerFacturePayee(factureId, {
        mode_paiement: modePaiementFacture[factureId] || "",
      });
      setFactures((prev) => prev.map((f) => (f.id === factureId ? maj : f)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleAnnulerFacture(factureId) {
    if (typeof window !== "undefined" && !window.confirm(t("saCancelInvoiceConfirm"))) return;
    setErreur("");
    try {
      const maj = await superAdminApi.annulerFacture(factureId);
      setFactures((prev) => prev.map((f) => (f.id === factureId ? maj : f)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  if (chargement) {
    return (
      <SuperAdminShell title={t("saClientDetailTitle")} backHref="/super-admin/clients">
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </SuperAdminShell>
    );
  }

  if (!client) {
    return (
      <SuperAdminShell title={t("saClientDetailTitle")} backHref="/super-admin/clients">
        {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      </SuperAdminShell>
    );
  }

  return (
    <SuperAdminShell title={client.raison_sociale} backHref="/super-admin/clients">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--sub)" }}>
              {client.secteur_activite || "—"} · {client.pays}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 4 }}>
              {t("saCreatedOn")} {new Date(client.date_creation).toLocaleDateString()}
            </div>
          </div>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 20,
              whiteSpace: "nowrap",
              color: client.actif ? "#2E7D5B" : "var(--brique)",
              background: client.actif ? "rgba(46,125,91,0.12)" : "rgba(196,74,58,0.1)",
            }}
          >
            {client.actif ? t("activeLabel") : t("saSuspendedLabel")}
          </span>
        </div>
        <div style={{ marginTop: 14 }}>
          {client.actif ? (
            <button onClick={handleSuspendre} style={boutonDangerStyle}>
              {t("saSuspendClientButton")}
            </button>
          ) : (
            <button onClick={handleReactiver} style={boutonSecondaireStyle}>
              {t("saReactivateClientButton")}
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 12 }}>{t("saFormuleSection")}</h3>
        <select
          value={formuleSelectionnee}
          onChange={(e) => setFormuleSelectionnee(e.target.value)}
          style={inputStyle}
        >
          <option value="">{t("saNoFormule")}</option>
          {formules.map((formule) => (
            <option key={formule.id} value={formule.id}>
              {formule.nom} ({Number(formule.prix_mensuel_xof).toLocaleString()} XOF/{t("saMonthAbbrev")})
              {!formule.actif ? ` — ${t("saFormuleRetired")}` : ""}
            </option>
          ))}
        </select>
        <button
          onClick={handleEnregistrerFormule}
          disabled={formuleSelectionnee === (client.formule_abonnement_id || "")}
          style={{ ...boutonSecondaireStyle, marginTop: 10 }}
        >
          {t("save")}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)" }}>{t("saModuleComptaSection")}</h3>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 20,
              color: client.module_comptabilite_actif ? "#2E7D5B" : "var(--brique)",
              background: client.module_comptabilite_actif ? "rgba(46,125,91,0.12)" : "rgba(196,74,58,0.1)",
            }}
          >
            {client.module_comptabilite_actif ? t("saModuleComptaActive") : t("saModuleComptaVerrouille")}
          </span>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 0, marginBottom: 12 }}>{t("saModuleComptaDescription")}</p>
        <label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 }}>{t("saModuleComptaPrixLabel")}</label>
        <input
          type="number"
          min="0"
          step="1"
          value={prixCompta}
          onChange={(e) => setPrixCompta(e.target.value)}
          style={{ ...inputStyle, maxWidth: 200 }}
        />
        <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 6, marginBottom: 0 }}>{t("saModuleComptaFacturationAide")}</p>
        {client.module_comptabilite_actif && client.module_comptabilite_date_activation && (
          <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 4, marginBottom: 0 }}>
            {t("saModuleComptaSince")} {new Date(client.module_comptabilite_date_activation).toLocaleDateString()}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {client.module_comptabilite_actif ? (
            <>
              <button
                onClick={handleEnregistrerPrixCompta}
                disabled={prixCompta === String(Number(client.module_comptabilite_prix_mensuel_xof || 0))}
                style={boutonSecondaireStyle}
              >
                {t("saModuleComptaSavePrixButton")}
              </button>
              <button onClick={() => handleModuleCompta(false)} style={boutonDangerStyle}>
                {t("saModuleComptaLockButton")}
              </button>
            </>
          ) : (
            <button onClick={() => handleModuleCompta(true)} style={boutonPrincipalStyle}>
              {t("saModuleComptaActivateButton")}
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 12 }}>
          {t("saUsersSection")} ({client.nombre_utilisateurs_actifs}/{client.nombre_utilisateurs})
        </h3>
        {client.utilisateurs.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--sub)" }}>{t("saNoUsers")}</p>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {client.utilisateurs.map((u) => (
              <div
                key={u.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12.5,
                  padding: "6px 0",
                  borderBottom: "1px solid var(--line-soft)",
                }}
              >
                <span>
                  {u.prenom} {u.nom} — {u.email}
                </span>
                <span style={{ color: u.actif ? "#2E7D5B" : "var(--brique)" }}>
                  {u.actif ? t("activeLabel") : t("inactiveLabel")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)" }}>{t("saInvoicesSection")}</h3>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleGenererFactureInstallation} style={boutonSecondaireStyle}>
              {t("saGenerateInstallationInvoiceButton")}
            </button>
            <button onClick={handleGenererFacture} style={boutonSecondaireStyle}>
              {t("saGenerateInvoiceButton")}
            </button>
          </div>
        </div>
        {factures.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--sub)" }}>{t("saNoInvoices")}</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {factures.map((facture) => {
              const style = STATUT_FACTURE_STYLE[facture.statut] || {};
              return (
                <div
                  key={facture.id}
                  style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {facture.periode} —{" "}
                        {facture.type_facture === "INSTALLATION"
                          ? t("saInvoiceTypeInstallation")
                          : t("saInvoiceTypeAbonnement")}{" "}
                        ({facture.formule_nom})
                      </div>
                      <div style={{ fontSize: 12, color: "var(--sub)" }}>
                        {Number(facture.montant_xof).toLocaleString()} XOF
                      </div>
                      {facture.date_paiement && (
                        <div style={{ fontSize: 11, color: "var(--sub)" }}>
                          {t("saPaidOn")} {new Date(facture.date_paiement).toLocaleDateString()}
                          {facture.mode_paiement ? ` · ${facture.mode_paiement}` : ""}
                        </div>
                      )}
                    </div>
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
                      {t(`saFactureStatut_${facture.statut}`)}
                    </span>
                  </div>
                  {facture.statut === "IMPAYEE" && (
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      <input
                        placeholder={t("saPaymentModePlaceholder")}
                        value={modePaiementFacture[facture.id] || ""}
                        onChange={(e) =>
                          setModePaiementFacture((prev) => ({ ...prev, [facture.id]: e.target.value }))
                        }
                        style={{ ...inputStyle, width: 180 }}
                      />
                      <button onClick={() => handleMarquerPayee(facture.id)} style={boutonSecondaireStyle}>
                        {t("saMarkPaidButton")}
                      </button>
                      <button onClick={() => handleAnnulerFacture(facture.id)} style={boutonDangerStyle}>
                        {t("saCancelInvoiceButton")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SuperAdminShell>
  );
}

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
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const boutonSecondaireStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const boutonDangerStyle = {
  background: "transparent",
  color: "var(--brique)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
