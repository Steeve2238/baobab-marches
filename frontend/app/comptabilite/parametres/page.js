"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import { useComptaStatut, labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, thStyle, tdStyle } from "../../../lib/comptaUi";

const TYPES_JOURNAL = ["VENTES", "ACHATS", "BANQUE", "CAISSE", "OPERATIONS_DIVERSES", "A_NOUVEAUX"];
const COMPTES_PARAM = [
  { cle: "compte_vente_defaut", label: "comptaParamVenteDefaut" },
  { cle: "compte_tva_collectee", label: "comptaParamTvaCollectee" },
  { cle: "compte_tva_recuperable", label: "comptaParamTvaRecuperable" },
  { cle: "compte_achat_defaut", label: "comptaParamAchatDefaut" },
  { cle: "compte_client_collectif", label: "comptaParamClientCollectif" },
  { cle: "compte_fournisseur_collectif", label: "comptaParamFournisseurCollectif" },
  { cle: "compte_acompte_client", label: "comptaParamAcompteClient" },
  { cle: "compte_acompte_fournisseur", label: "comptaParamAcompteFournisseur" },
];

// Parametres du module : comptes par defaut, tranches de la balance agee,
// exercices (creation / cloture / reouverture), journaux, tiers, audit.
// Tout ce qui modifie la configuration est reserve au niveau "validation".
export default function ComptaParametresPage() {
  const { t } = useLangue();
  const { statut, recharger } = useComptaStatut();
  const [exercices, setExercices] = useState([]);
  const [journaux, setJournaux] = useState([]);
  const [audit, setAudit] = useState([]);
  const [regles, setRegles] = useState([]);
  const [params, setParams] = useState(null);
  const [tranches, setTranches] = useState("");
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [nvExercice, setNvExercice] = useState({ libelle: "", date_debut: "", date_fin: "" });
  const [nvJournal, setNvJournal] = useState({ code: "", libelle: "", type_journal: "OPERATIONS_DIVERSES", compte_tresorerie: "" });

  const valid = !!statut?.droits?.validation;

  function charger() {
    api.comptaExercices().then(setExercices).catch((e) => setErreur(e.message));
    api.comptaJournaux().then(setJournaux).catch((e) => setErreur(e.message));
    api.comptaRegles().then(setRegles).catch(() => {});
  }
  useEffect(charger, []);
  useEffect(() => {
    if (statut?.parametre) {
      setParams(statut.parametre);
      setTranches((statut.parametre.tranches_balance_agee || []).join(", "));
    }
  }, [statut]);
  useEffect(() => {
    if (valid) api.comptaAudit().then(setAudit).catch(() => {});
  }, [valid]);

  async function action(fn, messageOk) {
    setErreur("");
    setInfo("");
    try {
      await fn();
      if (messageOk) setInfo(t(messageOk));
      charger();
      recharger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  const enregistrerParams = (e) => {
    e.preventDefault();
    const patch = {};
    for (const c of COMPTES_PARAM) patch[c.cle] = params[c.cle];
    patch.tranches_balance_agee = tranches
      .split(/[,;\s]+/)
      .filter(Boolean)
      .map(Number);
    action(() => api.comptaModifierParametres(patch), "comptaParametresEnregistres");
  };

  if (statut && !statut.initialisee) {
    return (
      <AppShell title={t("comptaNavParametres")} subNav={<ComptaSousNav />}>
        <p style={{ fontSize: 12.5, color: "var(--ocre)" }}>{t("comptaNonInitialisee")}</p>
      </AppShell>
    );
  }

  return (
    <AppShell title={t("comptaNavParametres")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      {!valid && <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12 }}>{t("comptaParametresLectureSeule")}</p>}

      {params && (
        <form onSubmit={enregistrerParams} className="card" style={{ marginBottom: 18, maxWidth: 720 }}>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10 }}>{t("comptaParamComptesTitre")}</h3>
          <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10 }}>
            {t("comptaParamLongueurInfo")} : <strong>{params.longueur_compte}</strong>
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
            {COMPTES_PARAM.map((c) => (
              <div key={c.cle}>
                <label style={labelStyle}>{t(c.label)}</label>
                <input
                  disabled={!valid}
                  value={params[c.cle] || ""}
                  onChange={(e) => setParams((p) => ({ ...p, [c.cle]: e.target.value.replace(/\D/g, "") }))}
                  style={{ ...inputStyle, fontFamily: "IBM Plex Mono, monospace" }}
                />
              </div>
            ))}
            <div>
              <label style={labelStyle}>{t("comptaParamTranches")}</label>
              <input disabled={!valid} value={tranches} onChange={(e) => setTranches(e.target.value)} style={inputStyle} />
              <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 3 }}>{t("comptaParamTranchesAide")}</p>
            </div>
          </div>
          {valid && (
            <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12 }}>
              {t("comptaEnregistrer")}
            </button>
          )}
        </form>
      )}

      <div className="card" style={{ marginBottom: 18, overflowX: "auto" }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 4 }}>{t("comptaReglesTitre")}</h3>
        <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 10 }}>{t("comptaReglesAide")}</p>
        {regles.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("comptaReglesVide")}</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("comptaPortee")}</th>
                <th style={thStyle}>{t("comptaLibelle")}</th>
                <th style={thStyle}>{t("comptaCompte")}</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {regles.map((r) => (
                <tr key={r.id}>
                  <td style={tdStyle}>{t(`comptaRegleCritere_${r.critere}`)}</td>
                  <td style={tdStyle}>{r.libelle_valeur || r.valeur}</td>
                  <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace" }}>{r.compte_numero}</td>
                  <td style={tdStyle}>
                    {valid && (
                      <button style={boutonSecondaireStyle} onClick={() => action(() => api.comptaSupprimerRegle(r.id))}>
                        {t("comptaSupprimerRegle")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 18, overflowX: "auto" }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10 }}>{t("comptaExercicesTitre")}</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("comptaLibelle")}</th>
              <th style={thStyle}>{t("comptaExerciceDebut")}</th>
              <th style={thStyle}>{t("comptaExerciceFin")}</th>
              <th style={thStyle}>{t("comptaStatut")}</th>
              <th style={thStyle}>{t("comptaEcrituresMot")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {exercices.map((x) => (
              <tr key={x.id}>
                <td style={tdStyle}>{x.libelle}</td>
                <td style={tdStyle}>{x.date_debut}</td>
                <td style={tdStyle}>{x.date_fin}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: x.statut === "OUVERT" ? "var(--vert)" : "var(--sub)" }}>
                  {x.statut === "OUVERT" ? t("comptaExerciceOuvert") : t("comptaExerciceCloture")}
                </td>
                <td style={tdStyle}>
                  {x.nb_ecritures}
                  {x.nb_en_attente > 0 ? ` (${x.nb_en_attente} ${t("comptaEnAttenteMot")})` : ""}
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  {valid &&
                    (x.statut === "OUVERT" ? (
                      <button
                        style={{ ...boutonSecondaireStyle, padding: "3px 8px" }}
                        onClick={() => window.confirm(t("comptaConfirmCloture")) && action(() => api.comptaCloturerExercice(x.id), "comptaExerciceClotureOk")}
                      >
                        {t("comptaCloturer")}
                      </button>
                    ) : (
                      <button style={{ ...boutonSecondaireStyle, padding: "3px 8px" }} onClick={() => action(() => api.comptaRouvrirExercice(x.id), "comptaExerciceRouvertOk")}>
                        {t("comptaRouvrir")}
                      </button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {valid && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                await api.comptaCreerExercice(nvExercice);
                setNvExercice({ libelle: "", date_debut: "", date_fin: "" });
              }, "comptaExerciceCreeOk");
            }}
            style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 }}
          >
            <div>
              <label style={labelStyle}>{t("comptaLibelle")}</label>
              <input required value={nvExercice.libelle} onChange={(e) => setNvExercice((f) => ({ ...f, libelle: e.target.value }))} style={{ ...inputStyle, width: 170 }} />
            </div>
            <div>
              <label style={labelStyle}>{t("comptaExerciceDebut")}</label>
              <input required type="date" value={nvExercice.date_debut} onChange={(e) => setNvExercice((f) => ({ ...f, date_debut: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("comptaExerciceFin")}</label>
              <input required type="date" value={nvExercice.date_fin} onChange={(e) => setNvExercice((f) => ({ ...f, date_fin: e.target.value }))} style={inputStyle} />
            </div>
            <button type="submit" style={boutonPrincipalStyle}>
              {t("comptaNouvelExercice")}
            </button>
          </form>
        )}
      </div>

      <div className="card" style={{ marginBottom: 18, overflowX: "auto" }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10 }}>{t("comptaJournauxTitre")}</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("comptaCode")}</th>
              <th style={thStyle}>{t("comptaLibelle")}</th>
              <th style={thStyle}>{t("comptaTypeJournal")}</th>
              <th style={thStyle}>{t("comptaCompteTresorerie")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {journaux.map((j) => (
              <tr key={j.id} style={{ opacity: j.actif ? 1 : 0.5 }}>
                <td style={{ ...tdStyle, fontWeight: 700 }}>{j.code}</td>
                <td style={tdStyle}>{j.libelle}</td>
                <td style={tdStyle}>{t("comptaTypeJournal_" + j.type_journal)}</td>
                <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace" }}>{j.compte_tresorerie || ""}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  {valid && (
                    <button style={{ ...boutonSecondaireStyle, padding: "3px 8px" }} onClick={() => action(() => api.comptaModifierJournal(j.id, { actif: !j.actif }))}>
                      {j.actif ? t("comptaDesactiver") : t("comptaReactiver")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {valid && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                await api.comptaCreerJournal({ ...nvJournal, compte_tresorerie: nvJournal.compte_tresorerie || null });
                setNvJournal({ code: "", libelle: "", type_journal: "OPERATIONS_DIVERSES", compte_tresorerie: "" });
              }, "comptaJournalCreeOk");
            }}
            style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 }}
          >
            <div>
              <label style={labelStyle}>{t("comptaCode")}</label>
              <input required maxLength={6} value={nvJournal.code} onChange={(e) => setNvJournal((f) => ({ ...f, code: e.target.value.toUpperCase() }))} style={{ ...inputStyle, width: 90 }} />
            </div>
            <div>
              <label style={labelStyle}>{t("comptaLibelle")}</label>
              <input required value={nvJournal.libelle} onChange={(e) => setNvJournal((f) => ({ ...f, libelle: e.target.value }))} style={{ ...inputStyle, width: 220 }} />
            </div>
            <div>
              <label style={labelStyle}>{t("comptaTypeJournal")}</label>
              <select value={nvJournal.type_journal} onChange={(e) => setNvJournal((f) => ({ ...f, type_journal: e.target.value }))} style={inputStyle}>
                {TYPES_JOURNAL.map((x) => (
                  <option key={x} value={x}>
                    {t("comptaTypeJournal_" + x)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t("comptaCompteTresorerie")}</label>
              <input value={nvJournal.compte_tresorerie} onChange={(e) => setNvJournal((f) => ({ ...f, compte_tresorerie: e.target.value.replace(/\D/g, "") }))} style={{ ...inputStyle, width: 130, fontFamily: "IBM Plex Mono, monospace" }} />
            </div>
            <button type="submit" style={boutonPrincipalStyle}>
              {t("comptaNouveauJournal")}
            </button>
          </form>
        )}
      </div>

      {valid && audit.length > 0 && (
        <div className="card" style={{ overflowX: "auto" }}>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10 }}>{t("comptaAuditTitre")}</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("comptaDate")}</th>
                <th style={thStyle}>{t("comptaUtilisateur")}</th>
                <th style={thStyle}>{t("comptaAction")}</th>
              </tr>
            </thead>
            <tbody>
              {audit.slice(0, 50).map((a) => (
                <tr key={a.id}>
                  <td style={tdStyle}>{new Date(a.date_action).toLocaleString(t("dateLocale"))}</td>
                  <td style={tdStyle}>{[a.prenom, a.nom].filter(Boolean).join(" ")}</td>
                  <td style={tdStyle}>
                    {a.action} <span style={{ color: "var(--sub)" }}>{a.objet_type}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
