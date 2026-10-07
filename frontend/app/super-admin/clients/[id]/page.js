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
  const [licences, setLicences] = useState([]);
  const [etatLicences, setEtatLicences] = useState(null);
  const [licForm, setLicForm] = useState({ date_debut: new Date().toISOString().slice(0, 10), duree_mois: 12, generer_facture: true });
  const [licResultat, setLicResultat] = useState(null);
  const [copie, setCopie] = useState("");

  function charger() {
    Promise.all([
      superAdminApi.getClient(params.id),
      superAdminApi.getFormules(),
      superAdminApi.getFacturesClient(params.id),
      superAdminApi.getLicencesClient(params.id).catch(() => []),
      superAdminApi.getEtatLicences().catch(() => null),
    ])
      .then(([clientData, formulesData, facturesData, licencesData, etatData]) => {
        setLicences(licencesData || []);
        setEtatLicences(etatData);
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

  async function handleChangerMode(mode) {
    if (mode === client.mode_hebergement) return;
    const message = mode === "LOCAL" ? t("saModeSwitchToLocalConfirm") : t("saModeSwitchToHebergeConfirm");
    if (typeof window !== "undefined" && !window.confirm(message)) return;
    setErreur("");
    try {
      const maj = await superAdminApi.patchModeHebergement(client.id, mode);
      setClient((prev) => ({ ...prev, ...maj }));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleGenererLicence() {
    setErreur("");
    setLicResultat(null);
    try {
      const lic = await superAdminApi.genererLicence(client.id, {
        date_debut: licForm.date_debut,
        duree_mois: Number(licForm.duree_mois),
        generer_facture: licForm.generer_facture,
      });
      setLicResultat(lic);
      setLicences((prev) => [lic, ...prev]);
      const [facturesData, clientData] = await Promise.all([
        superAdminApi.getFacturesClient(client.id),
        superAdminApi.getClient(client.id),
      ]);
      setFactures(facturesData);
      setClient(clientData);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function copierTexte(texte, repere) {
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(repere);
      setTimeout(() => setCopie(""), 2000);
    } catch (_err) {
      setErreur(t("saLicenceCopyFailed"));
    }
  }

  function telechargerLicence(lic) {
    const blob = new Blob([lic.cle], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const lien = document.createElement("a");
    lien.href = url;
    lien.download = `${lic.numero_serie}.lic`;
    lien.click();
    URL.revokeObjectURL(url);
  }

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)" }}>{t("saModeHebergementLabel")}</h3>
          <span
            style={{
              fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap",
              color: client.mode_hebergement === "LOCAL" ? "var(--ocre)" : "var(--petrol)",
              background: client.mode_hebergement === "LOCAL" ? "rgba(224,149,76,0.12)" : "rgba(20,79,85,0.1)",
            }}
          >
            {client.mode_hebergement === "LOCAL" ? t("saModeLocalBadge") : t("saModeHebergeBadge")}
          </span>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 0, marginBottom: 10 }}>
          {client.mode_hebergement === "LOCAL" ? t("saModeLocalHelp") : t("saModeHebergeHelp")}
        </p>
        <select value={client.mode_hebergement} onChange={(e) => handleChangerMode(e.target.value)} style={inputStyle}>
          <option value="HEBERGE">{t("saModeHeberge")}</option>
          <option value="LOCAL">{t("saModeLocal")}</option>
        </select>
      </div>

      {client.mode_hebergement === "LOCAL" && (
        <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 6 }}>{t("saLicenceSection")}</h3>
          <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 0, marginBottom: 12 }}>{t("saLicenceDescription")}</p>
          {etatLicences && !etatLicences.cle_signature_configuree && (
            <p style={{ fontSize: 12, color: "var(--brique)", marginBottom: 12 }}>{t("saLicenceNoSigningKey")}</p>
          )}
          {client.licence_date_fin && (
            <p style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>
              {t("saLicenceValidUntil")} <strong>{String(client.licence_date_fin).slice(0, 10)}</strong>
            </p>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 4 }}>{t("saLicenceStartLabel")}</label>
              <input type="date" value={licForm.date_debut} onChange={(e) => setLicForm((f) => ({ ...f, date_debut: e.target.value }))} style={{ ...inputStyle, width: 160 }} />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 4 }}>{t("saLicenceDurationLabel")}</label>
              <input type="number" min="1" max="60" value={licForm.duree_mois} onChange={(e) => setLicForm((f) => ({ ...f, duree_mois: e.target.value }))} style={{ ...inputStyle, width: 90 }} />
            </div>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, paddingBottom: 8 }}>
              <input type="checkbox" checked={licForm.generer_facture} onChange={(e) => setLicForm((f) => ({ ...f, generer_facture: e.target.checked }))} />
              {t("saLicenceWithInvoice")}
            </label>
            <button
              onClick={handleGenererLicence}
              disabled={!client.formule_abonnement_id || (etatLicences && !etatLicences.cle_signature_configuree)}
              style={boutonPrincipalStyle}
            >
              {licences.length === 0 ? t("saLicenceGenerateButton") : t("saLicenceRenewButton")}
            </button>
          </div>
          {!client.formule_abonnement_id && (
            <p style={{ fontSize: 11.5, color: "var(--brique)", marginTop: 8 }}>{t("saClientSansFormuleNote")}</p>
          )}

          {licResultat && (
            <div style={{ marginTop: 16, padding: 12, border: "1px solid var(--ocre)", borderRadius: 8, background: "rgba(224,149,76,0.08)" }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                {t("saLicenceGeneratedTitle")} — {licResultat.numero_serie}
              </div>
              {licResultat.premier_administrateur && (
                <div style={{ fontSize: 12.5, marginBottom: 10 }}>
                  <div>
                    <strong>{t("saLicenceFirstAdmin")}:</strong> {licResultat.premier_administrateur.prenom} {licResultat.premier_administrateur.nom} — {licResultat.premier_administrateur.email}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <strong>{t("saTempPasswordLabel")}:</strong>{" "}
                    <span className="mono" style={{ fontWeight: 700 }}>{licResultat.premier_administrateur.mot_de_passe_temporaire}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--brique)", marginTop: 4 }}>{t("saLicenceTempPasswordOnce")}</div>
                </div>
              )}
              <textarea readOnly value={licResultat.cle} rows={5} className="mono" style={{ ...inputStyle, fontSize: 11, wordBreak: "break-all" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => copierTexte(licResultat.cle, "nouvelle")} style={boutonSecondaireStyle}>
                  {copie === "nouvelle" ? t("saLicenceCopied") : t("saLicenceCopyButton")}
                </button>
                <button onClick={() => telechargerLicence(licResultat)} style={boutonSecondaireStyle}>{t("saLicenceDownloadButton")}</button>
              </div>
            </div>
          )}

          {licences.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{t("saLicenceHistory")}</div>
              <div style={{ display: "grid", gap: 6 }}>
                {licences.map((l) => (
                  <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12.5, padding: "6px 0", borderBottom: "1px solid var(--line-soft)", flexWrap: "wrap" }}>
                    <span>
                      <strong>{l.numero_serie}</strong> · {String(l.date_debut).slice(0, 10)} → {String(l.date_fin).slice(0, 10)}
                      {l.max_utilisateurs ? ` · ${l.max_utilisateurs} ${t("saUsersCount")}` : ""}
                      {l.modules_json && l.modules_json.comptabilite ? ` · ${t("saModuleComptaSection")}` : ""}
                    </span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => copierTexte(l.cle, l.id)} style={boutonSecondaireStyle}>
                        {copie === l.id ? t("saLicenceCopied") : t("saLicenceCopyButton")}
                      </button>
                      <button onClick={() => telechargerLicence(l)} style={boutonSecondaireStyle}>{t("saLicenceDownloadButton")}</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
            {client.mode_hebergement !== "LOCAL" && (
              <button onClick={handleGenererFacture} style={boutonSecondaireStyle}>
                {t("saGenerateInvoiceButton")}
              </button>
            )}
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
                          : facture.type_facture === "LICENCE"
                          ? t("saInvoiceTypeLicence")
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
