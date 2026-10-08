"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import PaieSousNav from "../../../../lib/components/PaieSousNav";
import ContratForm, { contratFormInitial, contratFormVersCorps } from "../../../../lib/components/ContratForm";
import { boutonPrincipal, boutonLeger, Section, fmtMontant } from "../../../../lib/components/rhUi";
import CircuitContrat from "../../../../lib/components/CircuitContrat";

export default function ContratPage() {
  const { id } = useParams();
  const router = useRouter();
  const { t } = useLangue();
  const [contrat, setContrat] = useState(null);
  const [form, setForm] = useState(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);

  function appliquer(c) {
    setContrat(c);
    setForm(contratFormInitial(c));
  }
  useEffect(() => {
    api.getContrat(id).then(appliquer).catch((e) => setErreur(e.message));
  }, [id]);

  const brouillon = contrat && contrat.statut === "BROUILLON";

  async function action(fn, msg) {
    setEnCours(true);
    setErreur("");
    setMessage("");
    try {
      const r = await fn();
      if (r) appliquer(r);
      if (msg) setMessage(msg);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }
  const enregistrer = (e) => {
    e.preventDefault();
    return action(() => api.patchContrat(id, contratFormVersCorps(form)), t("rhcEnregistre"));
  };
  const valider = async () => {
    if (!window.confirm(t("rhcValiderConfirm"))) return;
    // Enregistre d'abord les dernieres modifications puis valide.
    await action(async () => {
      await api.patchContrat(id, contratFormVersCorps(form));
      return api.validerContrat(id);
    });
  };
  const supprimer = async () => {
    if (!window.confirm(t("rhcSupprimerConfirm"))) return;
    try {
      await api.deleteContrat(id);
      router.push("/rh/contrats");
    } catch (e) {
      setErreur(e.message);
    }
  };
  const annuler = async () => {
    if (!window.confirm(t("rhcAnnulerConfirm"))) return;
    action(() => api.annulerContrat(id));
  };
  const apercu = async () => {
    try {
      if (brouillon) await api.patchContrat(id, contratFormVersCorps(form));
      await api.ouvrirPdfRH(`/rh/contrats/${id}/pdf`);
    } catch (e) {
      setErreur(e.message);
    }
  };

  if (erreur && !contrat) {
    return <AppShell title={t("rhcTitre")} subNav={<PaieSousNav />}><p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p></AppShell>;
  }
  if (!contrat || !form) {
    return <AppShell title={t("rhcTitre")} subNav={<PaieSousNav />}><p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p></AppShell>;
  }

  const contenu = contrat.contenu;
  return (
    <AppShell title={contrat.numero} subNav={<PaieSousNav />}>
      <Link href="/rh/contrats" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("rhcRetour")}</Link>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}

      <div style={{ maxWidth: 980, display: "grid", gap: 16 }}>
        <div className="card" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{contrat.employe.prenom} {contrat.employe.nom}</div>
            <div style={{ fontSize: 12, color: "var(--sub)" }}>{t(`rhcType_${contrat.type}`)} · {contrat.numero}</div>
          </div>
          <span className={contrat.statut === "ANNULE" ? "chip risk" : brouillon ? "chip" : "chip ok"}>{t(`rhcStatut_${contrat.statut}`)}</span>
          <Link href={`/rh/personnel/${contrat.employe.id}`} style={{ ...boutonLeger, marginLeft: "auto" }}>{t("rhcOuvrirFiche")}</Link>
        </div>

        {brouillon && contrat.avertissements.length > 0 && (
          <Section titre={t("rhcAvertissements")}>
            <div style={{ display: "grid", gap: 6 }}>
              {contrat.avertissements.map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5 }}>
                  <span className={a.niveau === "BLOQUANT" ? "chip risk" : "chip"} style={{ flexShrink: 0 }}>{a.niveau === "BLOQUANT" ? t("rhcBloquant") : t("rhcAttention")}</span>
                  <span>{t(`rhcAv_${a.code}`)}{a.valeur ? ` (${a.valeur})` : ""}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        <form onSubmit={enregistrer}>
          <ContratForm form={form} setForm={setForm} t={t} lectureSeule={!brouillon} typeFige />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            {brouillon && (
              <button type="submit" disabled={enCours} style={boutonPrincipal}>{enCours ? t("rhcEnregistrement") : t("rhcEnregistrer")}</button>
            )}
            <button type="button" style={boutonLeger} onClick={apercu}>{brouillon ? t("rhcApercuPdf") : t("rhcApercuPdf")}</button>
            {!brouillon && (
              <button type="button" style={boutonLeger} onClick={() => api.telechargerPdfRH(`/rh/contrats/${id}/pdf`, `${contrat.numero}.pdf`).catch((e) => setErreur(e.message))}>{t("rhcTelechargerPdf")}</button>
            )}
            {brouillon && (
              <button type="button" disabled={enCours} style={{ ...boutonPrincipal, background: "var(--accent, #C8742B)" }} onClick={valider}>{t("rhcValider")}</button>
            )}
            {brouillon && <button type="button" style={{ ...boutonLeger, color: "var(--brique)" }} onClick={supprimer}>{t("rhcSupprimer")}</button>}
            {!brouillon && contrat.statut !== "ANNULE" && contrat.statut !== "VISE" && (
              <button type="button" style={{ ...boutonLeger, color: "var(--brique)" }} onClick={annuler}>{t("rhcAnnuler")}</button>
            )}
          </div>
        </form>

        {!brouillon && (
          <CircuitContrat contrat={contrat} t={t} onChange={() => api.getContrat(id).then(appliquer)} onErreur={setErreur} onMessage={setMessage} />
        )}

        <Section titre={t("rhcTexte")} aide={brouillon ? t("rhcTexteAide") : null}>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, display: "grid", gap: 10 }}>
            {contenu.identite && (
              <div style={{ display: "grid", gap: 2 }}>
                {contenu.identite.map(([k, v]) => (
                  <div key={k} style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 8 }}>
                    <span style={{ color: "var(--sub)", fontWeight: 600 }}>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            )}
            {contenu.articles.map((a) => (
              <div key={a.numero}>
                <div style={{ fontWeight: 700, color: "var(--petrol)", marginBottom: 3 }}>Article {a.numero} : {a.titre}</div>
                {a.paragraphes.map((p, i) => (
                  <p key={i} style={{ margin: "0 0 5px" }}>{p}</p>
                ))}
                {a.remuneration && (
                  <div style={{ margin: "4px 0 6px" }}>
                    {a.remuneration.lignes.map((l, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", maxWidth: 480, borderBottom: "1px solid var(--line)", padding: "2px 0" }}>
                        <span>{l.libelle}{l.essai === false ? " *" : ""}</span>
                        <span className="mono">{fmtMontant(l.montant)} F CFA</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", maxWidth: 480, fontWeight: 700, padding: "3px 0" }}>
                      <span>{a.remuneration.libelle_total}</span>
                      <span className="mono">{fmtMontant(a.remuneration.total)} F CFA</span>
                    </div>
                    <div style={{ color: "var(--sub)", fontStyle: "italic" }}>Soit : {a.remuneration.total_lettres}.</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </AppShell>
  );
}
