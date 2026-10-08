"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import { boutonLeger, boutonPrincipal } from "../../../../lib/components/rhUi";

const TON = { CREER: "chip ok", MAJ: "chip", INCHANGE: "chip", ERREUR: "chip risk" };

export default function ImportPersonnelPage() {
  const { t } = useLangue();
  const [fichier, setFichier] = useState(null);
  const [apercu, setApercu] = useState(null);
  const [resultat, setResultat] = useState(null);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState("");

  async function analyser() {
    if (!fichier) return;
    setErreur(""); setResultat(null); setEnCours("analyse");
    try {
      setApercu(await api.rhImporterPersonnel(fichier, true));
    } catch (e) {
      setApercu(null); setErreur(e.message);
    } finally {
      setEnCours("");
    }
  }

  async function confirmer() {
    setErreur(""); setEnCours("import");
    try {
      const r = await api.rhImporterPersonnel(fichier, false);
      setResultat(r.resultat);
      setApercu(null);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours("");
    }
  }

  const aImporter = apercu ? apercu.resume.creer + apercu.resume.maj : 0;

  return (
    <AppShell title={t("rhiTitre")}>
      <Link href="/rh/personnel" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("rhiRetour")}</Link>
      <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "0 0 14px", maxWidth: 760, lineHeight: 1.5 }}>{t("rhiAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}

      {resultat ? (
        <div className="card" style={{ maxWidth: 560 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{t("rhiTermine")}</div>
          <p style={{ fontSize: 13, margin: "0 0 12px" }}>
            {t("rhiBilan").replace("{crees}", resultat.crees).replace("{maj}", resultat.mis_a_jour).replace("{ignores}", resultat.ignores)}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/rh/personnel" style={{ ...boutonPrincipal, textDecoration: "none" }}>{t("rhiVoirPersonnel")}</Link>
            <button type="button" style={boutonLeger} onClick={() => { setResultat(null); setFichier(null); }}>{t("rhiNouvelImport")}</button>
          </div>
        </div>
      ) : (
        <>
          <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>{t("rhiFichier")}</label>
            <input type="file" accept=".xlsx,.xlsm" onChange={(e) => { setFichier(e.target.files[0] || null); setApercu(null); }} />
            <button type="button" disabled={!fichier || enCours} style={{ ...boutonPrincipal, opacity: fichier && !enCours ? 1 : 0.5 }} onClick={analyser}>
              {enCours === "analyse" ? t("rhiAnalyse") : t("rhiAnalyser")}
            </button>
          </div>

          {apercu && (
            <>
              <div className="card" style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>{t("rhiResume")}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="chip ok">{apercu.resume.creer} {t("rhiCreer")}</span>
                  <span className="chip">{apercu.resume.maj} {t("rhiMaj")}</span>
                  <span className="chip">{apercu.resume.inchange} {t("rhiInchange")}</span>
                  <span className="chip risk">{apercu.resume.erreur} {t("rhiErreur")}</span>
                </div>
                <div style={{ marginTop: 12 }}>
                  {aImporter > 0 ? (
                    <button type="button" disabled={enCours === "import"} style={boutonPrincipal} onClick={confirmer}>
                      {enCours === "import" ? t("rhiEnCours") : `${t("rhiConfirmer")} (${aImporter})`}
                    </button>
                  ) : (
                    <p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("rhiRien")}</p>
                  )}
                </div>
              </div>

              <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720, fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--sub)", fontSize: 11 }}>
                      <th style={{ padding: "8px 10px" }}>{t("rhiLigne")}</th>
                      <th style={{ padding: "8px 10px" }}>{t("rhiSalarie")}</th>
                      <th style={{ padding: "8px 10px" }}>{t("rhiAction")}</th>
                      <th style={{ padding: "8px 10px" }}>{t("rhiDetail")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apercu.lignes.map((l) => (
                      <tr key={l.ligne} style={{ borderTop: "1px solid var(--line)", verticalAlign: "top" }}>
                        <td style={{ padding: "8px 10px" }} className="mono">{l.ligne}</td>
                        <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                          <b>{l.prenom} {l.nom}</b>
                          {l.matricule && <div className="mono" style={{ fontSize: 11, color: "var(--sub)" }}>{l.matricule}</div>}
                        </td>
                        <td style={{ padding: "8px 10px" }}><span className={TON[l.action]}>{t(`rhiAction_${l.action}`)}</span></td>
                        <td style={{ padding: "8px 10px", lineHeight: 1.5 }}>
                          {l.erreurs.map((e, i) => <div key={i} style={{ color: "var(--brique)" }}>{e.libelle}</div>)}
                          {l.changements.map((c) => (
                            <div key={c.champ}><span style={{ color: "var(--sub)" }}>{c.libelle} :</span> {c.ancien || "—"} → <b>{c.nouveau}</b></div>
                          ))}
                          {l.enfants.fichier > 0 && (
                            <div style={{ color: "var(--sub)" }}>
                              {l.enfants.fichier} {t("rhiEnfantsNb")}{l.enfants.remplace && l.action === "MAJ" ? ` — ${t("rhiEnfantsMaj")}` : ""}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
