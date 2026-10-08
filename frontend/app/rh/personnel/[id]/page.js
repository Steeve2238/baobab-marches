"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import FicheEmployeForm, { formInitial, formVersCorps, inputStyle } from "../../../../lib/components/FicheEmployeForm";

export default function FicheEmployePage() {
  const { id } = useParams();
  const { t } = useLangue();
  const [fiche, setFiche] = useState(null);
  const [form, setForm] = useState(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [comptes, setComptes] = useState([]);
  const [compteChoisi, setCompteChoisi] = useState("");
  const [contrats, setContrats] = useState([]);
  const [courriers, setCourriers] = useState([]);
  const [dmts, setDmts] = useState([]);

  function appliquer(f) {
    setFiche(f);
    setForm(formInitial(f));
  }

  useEffect(() => {
    api.getFicheEmploye(id).then(appliquer).catch((err) => setErreur(err.message));
    api.getUtilisateursDisponiblesRH().then(setComptes).catch(() => {});
    api.getContrats(id).then(setContrats).catch(() => {});
    api.getCourriers({ employe_id: id }).then(setCourriers).catch(() => {});
    api.getDmts(id).then(setDmts).catch(() => {});
  }, [id]);

  const estSalarieSeul = fiche && fiche.historique === undefined;

  async function handleEnregistrer(e) {
    e.preventDefault();
    setEnCours(true);
    setMessage("");
    setErreur("");
    try {
      const maj = await api.patchFicheEmploye(id, formVersCorps(form, { salarieSeul: estSalarieSeul }));
      appliquer(maj);
      setMessage(t("rhdEnregistre"));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  async function changerCompte(utilisateurId) {
    setErreur("");
    try {
      const maj = await api.lierCompteEmploye(id, utilisateurId);
      appliquer(maj);
      setCompteChoisi("");
      setMessage(t("rhdCompteMaj"));
      api.getUtilisateursDisponiblesRH().then(setComptes).catch(() => {});
    } catch (err) {
      setErreur(err.message);
    }
  }

  if (erreur && !fiche) {
    return (
      <AppShell title={t("rhdListTitre")}>
        <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>
      </AppShell>
    );
  }
  if (!fiche || !form) {
    return (
      <AppShell title={t("rhdListTitre")}>
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </AppShell>
    );
  }

  const parts = fiche.parts;
  const comp = fiche.completude;

  return (
    <AppShell title={`${fiche.prenom || ""} ${fiche.nom || ""}`}>
      <Link href="/rh/personnel" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>
        {t("rhdRetour")}
      </Link>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}

      <div style={{ maxWidth: 980, display: "grid", gap: 16 }}>
        <div className="card" style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{fiche.prenom} {fiche.nom}</div>
            <div className="mono" style={{ fontSize: 12, color: "var(--sub)" }}>{fiche.matricule || "—"}</div>
          </div>
          {parts && (
            <>
              <Stat label={t("rhdPartsIR")} valeur={parts.parts_ir} note={parts.manuel_ir ? t("rhdPartsImposees") : t("rhdPartsCalculees")} />
              <Stat label={t("rhdPartsTrimf")} valeur={parts.parts_trimf} note={parts.manuel_trimf ? t("rhdPartsImposees") : t("rhdPartsCalculees")} />
              <Stat label={t("rhdEnfantsCharge")} valeur={parts.enfants_a_charge} note={String(parts.annee)} />
            </>
          )}
          {comp && (
            <span className={comp.pourcentage === 100 ? "chip ok" : "chip risk"} style={{ marginLeft: "auto" }}>
              {comp.pourcentage === 100 ? t("rhdFicheComplete") : `${t("rhdFicheIncomplete")} · ${comp.pourcentage} %`}
            </span>
          )}
        </div>

        {comp && comp.manquants.length > 0 && !estSalarieSeul && (
          <div className="card">
            <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>{t("rhdSecCompletude")}</h2>
            <p style={{ fontSize: 12, color: "var(--sub)", margin: "0 0 8px" }}>{t("rhdCompletudeAide")}</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {comp.manquants.map((m) => (
                <span key={m} className="chip risk">{t(`rhd_${m}`)}</span>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleEnregistrer}>
          <FicheEmployeForm form={form} setForm={setForm} t={t} salarieSeul={estSalarieSeul} />
          <button
            type="submit"
            disabled={enCours}
            style={{
              marginTop: 16,
              background: "var(--petrol)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "9px 20px",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {enCours ? t("rhdEnregistrement") : t("rhdEnregistrer")}
          </button>
        </form>

        {!estSalarieSeul && (
          <section className="card">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              <h2 style={{ fontSize: 14, margin: 0 }}>{t("rhcDocs")}</h2>
              <Link href={`/rh/contrats/nouveau?employe_id=${id}&type=${fiche.type_contrat === "CDD" || fiche.type_contrat === "JOURNALIER" ? fiche.type_contrat : "CDI"}`} style={{ ...boutonLeger, marginLeft: "auto" }}>
                + {t("rhcGenererContrat")}
              </Link>
              <Link href={`/rh/dmt/nouvelle?employe_id=${id}&objet=EMBAUCHE`} style={boutonLeger}>
                + {t("rhcGenererDmt")}
              </Link>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {contrats.map((c) => (
                <Link key={c.id} href={`/rh/contrats/${c.id}`} style={{ display: "flex", gap: 12, fontSize: 12.5, textDecoration: "none", color: "inherit", borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{c.numero}</span>
                  <span>{t(`rhcType_${c.type}`)}</span>
                  <span style={{ color: "var(--sub)" }}>{String(c.date_effet || "").slice(0, 10)}</span>
                  <span className="chip" style={{ marginLeft: "auto" }}>{t(`rhcStatut_${c.statut}`)}</span>
                </Link>
              ))}
              {dmts.map((d) => (
                <Link key={d.id} href={`/rh/dmt/${d.id}`} style={{ display: "flex", gap: 12, fontSize: 12.5, textDecoration: "none", color: "inherit", borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{d.numero}</span>
                  <span>{t(`rhdmObjet_${d.objet}`)}</span>
                  <span className="chip" style={{ marginLeft: "auto" }}>{t(`rhdmStatut_${d.statut}`)}</span>
                </Link>
              ))}
              {contrats.length === 0 && dmts.length === 0 && (
                <p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("rhcAucun")}</p>
              )}
            </div>
          </section>
        )}

        {!estSalarieSeul && (
          <section className="card">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              <h2 style={{ fontSize: 14, margin: 0 }}>{t("rhkCourriersFiche")}</h2>
              <Link href={`/rh/courriers?employe_id=${id}`} style={{ ...boutonLeger, marginLeft: "auto" }}>+ {t("rhkNouveau")}</Link>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {courriers.map((c) => (
                <Link key={c.id} href={`/rh/courriers/${c.id}`} style={{ display: "flex", gap: 12, fontSize: 12.5, textDecoration: "none", color: "inherit", borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                  <span className="mono" style={{ fontWeight: 600 }}>{c.numero}</span>
                  <span>{t(`rhkType_${c.type}`)}</span>
                  <span style={{ color: "var(--sub)" }}>{String(c.date_courrier || "").slice(0, 10)}</span>
                  <span className="chip" style={{ marginLeft: "auto" }}>{t(`rhkStatut_${c.statut}`)}</span>
                </Link>
              ))}
              {courriers.length === 0 && <p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("rhkAucun")}</p>}
            </div>
          </section>
        )}

        {!estSalarieSeul && (
          <section className="card">
            <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>{t("rhdSecCompte")}</h2>
            <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "0 0 10px" }}>{t("rhdCompteAide")}</p>
            {fiche.utilisateur_id ? (
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13 }}>{t("rhdCompteLie")} <strong>{fiche.email}</strong></span>
                {(fiche.roles || []).map((r) => (
                  <span key={r.code} className="chip ok">{r.libelle}</span>
                ))}
                <button type="button" onClick={() => changerCompte(null)} style={boutonLeger}>
                  {t("rhdCompteDelier")}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("rhdCompteAucun")}</span>
                <select value={compteChoisi} onChange={(e) => setCompteChoisi(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 260 }}>
                  <option value="">{t("rhdCompteChoisir")}</option>
                  {comptes.map((u) => (
                    <option key={u.id} value={u.id}>{u.prenom} {u.nom} ({u.email})</option>
                  ))}
                </select>
                <button type="button" disabled={!compteChoisi} onClick={() => changerCompte(compteChoisi)} style={boutonLeger}>
                  {t("rhdCompteLier")}
                </button>
              </div>
            )}
          </section>
        )}

        {!estSalarieSeul && (
          <section className="card">
            <h2 style={{ fontSize: 14, margin: "0 0 10px" }}>{t("rhdSecHistorique")}</h2>
            {(fiche.historique || []).length === 0 ? (
              <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("rhdHistAucun")}</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--sub)" }}>
                      <th style={th}>{t("rhdHistDate")}</th>
                      <th style={th}>{t("rhdHistChamp")}</th>
                      <th style={th}>{t("rhdHistAvant")}</th>
                      <th style={th}>{t("rhdHistApres")}</th>
                      <th style={th}>{t("rhdHistPar")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fiche.historique.map((h, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                        <td style={td}>{String(h.date_modification).slice(0, 10)}</td>
                        <td style={td}>{t(`rhd_${h.champ}`)}</td>
                        <td style={td}>{h.ancienne_valeur || "—"}</td>
                        <td style={td}>{h.nouvelle_valeur || "—"}</td>
                        <td style={td}>{[h.auteur_prenom, h.auteur_nom].filter(Boolean).join(" ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ label, valeur, note }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{valeur}</div>
      <div style={{ fontSize: 10.5, color: "var(--sub)" }}>{note}</div>
    </div>
  );
}

const th = { padding: "6px 8px", fontWeight: 600 };
const td = { padding: "6px 8px" };
const boutonLeger = {
  background: "transparent",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "6px 14px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
};
