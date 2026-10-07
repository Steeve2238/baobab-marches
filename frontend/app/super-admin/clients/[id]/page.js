"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { superAdminApi } from "../../../../lib/superAdminApi";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import SuperAdminShell from "../../../../lib/components/SuperAdminShell";
import { STYLE_STATUT_OFFRE } from "../../offres/page";

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
  const [prixFisc, setPrixFisc] = useState("");
  const [licences, setLicences] = useState([]);
  const [etatLicences, setEtatLicences] = useState(null);
  const [licForm, setLicForm] = useState({ date_debut: new Date().toISOString().slice(0, 10), duree_mois: 12, generer_facture: true });
  const [licResultat, setLicResultat] = useState(null);
  const [copie, setCopie] = useState("");
  const [offres, setOffres] = useState([]);

  function charger() {
    Promise.all([
      superAdminApi.getClient(params.id),
      superAdminApi.getFormules(),
      superAdminApi.getFacturesClient(params.id),
      superAdminApi.getLicencesClient(params.id).catch(() => []),
      superAdminApi.getEtatLicences().catch(() => null),
      superAdminApi.getOffres(`?client=${encodeURIComponent(params.id)}`).catch(() => []),
    ])
      .then(([clientData, formulesData, facturesData, licencesData, etatData, offresData]) => {
        setOffres(offresData || []);
        setLicences(licencesData || []);
        setEtatLicences(etatData);
        setClient(clientData);
        setFormuleSelectionnee(clientData.formule_abonnement_id || "");
        setPrixCompta(String(Number(clientData.module_comptabilite_prix_mensuel_xof || 0)));
        setPrixFisc(String(Number(clientData.module_fiscalite_prix_mensuel_xof || 0)));
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

  // Module Fiscalite vendu en option (migration 049) : meme mecanique que la Comptabilite.
  async function handleModuleFisc(actif) {
    if (!actif && typeof window !== "undefined" && !window.confirm(t("saModuleFiscLockConfirm"))) return;
    setErreur("");
    try {
      const maj = await superAdminApi.patchModuleFiscalite(client.id, {
        actif,
        prix_mensuel_xof: prixFisc === "" ? 0 : Number(prixFisc),
      });
      setClient((prev) => ({ ...prev, ...maj }));
      setPrixFisc(String(Number(maj.module_fiscalite_prix_mensuel_xof || 0)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleEnregistrerPrixFisc() {
    setErreur("");
    try {
      const maj = await superAdminApi.patchModuleFiscalite(client.id, {
        actif: !!client.module_fiscalite_actif,
        prix_mensuel_xof: prixFisc === "" ? 0 : Number(prixFisc),
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
                      {l.modules_json && l.modules_json.fiscalite ? ` · ${t("saModuleFiscSection")}` : ""}
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

      <div className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)" }}>{t("saModuleFiscSection")}</h3>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 20,
              color: client.module_fiscalite_actif ? "#2E7D5B" : "var(--brique)",
              background: client.module_fiscalite_actif ? "rgba(46,125,91,0.12)" : "rgba(196,74,58,0.1)",
            }}
          >
            {client.module_fiscalite_actif ? t("saModuleComptaActive") : t("saModuleComptaVerrouille")}
          </span>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 0, marginBottom: 12 }}>{t("saModuleFiscDescription")}</p>
        <label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 }}>{t("saModuleComptaPrixLabel")}</label>
        <input
          type="number"
          min="0"
          step="1"
          value={prixFisc}
          onChange={(e) => setPrixFisc(e.target.value)}
          style={{ ...inputStyle, maxWidth: 200 }}
        />
        <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 6, marginBottom: 0 }}>{t("saModuleComptaFacturationAide")}</p>
        {client.module_fiscalite_actif && client.module_fiscalite_date_activation && (
          <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 4, marginBottom: 0 }}>
            {t("saModuleComptaSince")} {new Date(client.module_fiscalite_date_activation).toLocaleDateString()}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {client.module_fiscalite_actif ? (
            <>
              <button
                onClick={handleEnregistrerPrixFisc}
                disabled={prixFisc === String(Number(client.module_fiscalite_prix_mensuel_xof || 0))}
                style={boutonSecondaireStyle}
              >
                {t("saModuleComptaSavePrixButton")}
              </button>
              <button onClick={() => handleModuleFisc(false)} style={boutonDangerStyle}>
                {t("saModuleComptaLockButton")}
              </button>
            </>
          ) : (
            <button onClick={() => handleModuleFisc(true)} style={boutonPrincipalStyle}>
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
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--sub)", fontSize: 11.5 }}>
                  <th style={thUserStyle}>{t("saUserColName")}</th>
                  <th style={thUserStyle}>{t("saUserColEmail")}</th>
                  <th style={thUserStyle}>{t("saUserColRoles")}</th>
                  <th style={thUserStyle}>{t("saUserColStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {client.utilisateurs.map((u) => (
                  <tr key={u.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                    <td style={tdUserStyle}>
                      {u.prenom} {u.nom}
                    </td>
                    <td style={tdUserStyle}>{u.email}</td>
                    <td style={tdUserStyle}>
                      {u.roles && u.roles.length > 0 ? (
                        <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
                          {u.roles.map((r) => (
                            <span
                              key={r.code}
                              style={{
                                border: "1px solid var(--line)",
                                borderRadius: 10,
                                padding: "1px 8px",
                                fontSize: 11.5,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {r.libelle}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span style={{ color: "var(--brique)", fontSize: 11.5 }}>{t("saUserNoRole")}</span>
                      )}
                    </td>
                    <td style={{ ...tdUserStyle, color: u.actif ? "#2E7D5B" : "var(--brique)", whiteSpace: "nowrap" }}>
                      {u.actif ? t("activeLabel") : t("inactiveLabel")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)" }}>{t("saOffTitre")}</h3>
          <Link href={`/super-admin/offres/nouvelle?client=${client.id}`} style={{ ...boutonSecondaireStyle, textDecoration: "none", display: "inline-block" }}>
            {t("saOffPreparerPourClient")}
          </Link>
        </div>
        {offres.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("saOffAucune")}</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {offres.map((o) => (
                <tr key={o.id}>
                  <td style={{ padding: "7px 8px 7px 0", fontSize: 12.5, borderBottom: "1px solid var(--line)" }}>
                    <Link href={`/super-admin/offres/${o.id}`} style={{ color: "var(--petrol)", fontWeight: 600 }}>{o.numero}</Link>
                  </td>
                  <td style={{ padding: "7px 8px", fontSize: 12, borderBottom: "1px solid var(--line)" }}>{Math.round(Number(o.totaux?.total_ttc) || 0).toLocaleString("fr-FR")} XOF</td>
                  <td style={{ padding: "7px 8px", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", ...STYLE_STATUT_OFFRE[o.statut] }}>{t(`saOffStatut_${o.statut}`)}</span>
                  </td>
                  <td style={{ padding: "7px 0 7px 8px", fontSize: 12, borderBottom: "1px solid var(--line)" }}>{o.contrat_numero ? `${o.contrat_numero} · ${t(`saCtrStatut_${o.contrat_statut}`)}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
const thUserStyle = { fontWeight: 600, padding: "4px 10px 6px 0", borderBottom: "1px solid var(--line)" };
const tdUserStyle = { padding: "7px 10px 7px 0", verticalAlign: "top" };

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
