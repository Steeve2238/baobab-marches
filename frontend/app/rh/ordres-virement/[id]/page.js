"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import OrdreVirementForm, { ovFormInitial, ovFormVersCorps } from "../../../../lib/components/OrdreVirementForm";
import { boutonPrincipal, boutonLeger, Section } from "../../../../lib/components/rhUi";

export default function OrdreVirementDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { t } = useLangue();
  const [o, setO] = useState(null);
  const [form, setForm] = useState(null);
  const [employes, setEmployes] = useState([]);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");

  function appliquer(x) {
    setO(x);
    setForm(ovFormInitial({ ...x, periode: x.periode }));
  }
  useEffect(() => {
    api.getOrdreVirement(id).then(appliquer).catch((e) => setErreur(e.message));
    api.getPersonnel().then(setEmployes).catch(() => {});
  }, [id]);

  async function agir(fn, ok) {
    setErreur("");
    setMessage("");
    try {
      appliquer(await fn());
      if (ok) setMessage(t(ok));
    } catch (e) { setErreur(e.message); }
  }

  if (!o || !form) {
    return <AppShell title={t("rhovTitre")}>{erreur ? <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p> : <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}</AppShell>;
  }
  const brouillon = o.statut === "BROUILLON";
  const jour = (d) => String(d).slice(0, 10);

  return (
    <AppShell title={o.numero}>
      <Link href="/rh/ordres-virement" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("rhovRetour")}</Link>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}

      <div style={{ maxWidth: 1000, display: "grid", gap: 14 }}>
        <div className="card" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{o.libelle}</div>
            <div style={{ fontSize: 12, color: "var(--sub)" }}>
              {t(`rhovType_${o.type_paiement}`)} · {t("rhovColDate")} {jour(o.date_execution)} · {t("rhovSource")} : {o.source === "PAIE" ? "Paie" : t("rhovSourceManuel")}
              {o.date_execution_reelle ? ` · ${t("rhovDateExecutionReelle")} ${jour(o.date_execution_reelle)}` : ""}
            </div>
          </div>
          <span className={o.statut === "ANNULE" ? "chip risk" : brouillon ? "chip" : "chip ok"}>{t(`rhovStatut_${o.statut}`)}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={boutonLeger} onClick={() => api.ouvrirPdfRH(`/rh/ordres-virement/${id}/pdf`).catch((e) => setErreur(e.message))}>{t("rhovPdf")}</button>
            <button type="button" style={boutonLeger} onClick={() => api.telechargerPdfRH(`/rh/ordres-virement/${id}/pdf`, `${o.numero}.pdf`).catch((e) => setErreur(e.message))}>{t("rhovPdfTelecharger")}</button>
            <button type="button" style={boutonLeger} onClick={() => api.telechargerPdfRH(`/rh/ordres-virement/${id}/excel`, `${o.numero}.xlsx`).catch((e) => setErreur(e.message))}>{t("rhovExcel")}</button>
          </div>
        </div>

        {brouillon && o.avertissements.length > 0 && (
          <Section titre={t("rhovAvertissements")}>
            <div style={{ display: "grid", gap: 6 }}>
              {o.avertissements.map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5 }}>
                  <span className={a.niveau === "BLOQUANT" ? "chip risk" : "chip"}>{a.niveau === "BLOQUANT" ? t("rhkBloquant") : t("rhkAttention")}</span>
                  <span>{a.valeur ? `${a.valeur} ` : ""}{t(`rhovAv_${a.code}`)}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
        {!brouillon && <p style={{ fontSize: 12, color: "var(--sub)", margin: 0 }}>{t("rhovFixe")}</p>}

        <OrdreVirementForm t={t} form={form} setForm={setForm} lecture={!brouillon} employes={employes} />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {brouillon && (
            <>
              <button type="button" style={boutonLeger} onClick={() => agir(() => api.patchOrdreVirement(id, ovFormVersCorps(form)), "rhovEnregistre")}>{t("rhovEnregistrer")}</button>
              <button type="button" style={boutonPrincipal} onClick={async () => {
                if (!window.confirm(t("rhovValiderConfirm"))) return;
                await agir(async () => { await api.patchOrdreVirement(id, ovFormVersCorps(form)); return api.validerOrdreVirement(id); }, "rhovValideOk");
              }}>{t("rhovValider")}</button>
              <button type="button" style={{ ...boutonLeger, color: "var(--brique)", marginLeft: "auto" }} onClick={async () => {
                if (!window.confirm(t("rhovSupprimerConfirm"))) return;
                try { await api.deleteOrdreVirement(id); router.push("/rh/ordres-virement"); } catch (e) { setErreur(e.message); }
              }}>{t("rhovSupprimer")}</button>
            </>
          )}
          {o.statut === "VALIDE" && (
            <button type="button" style={boutonPrincipal} onClick={() => agir(() => api.executerOrdreVirement(id, new Date().toISOString().slice(0, 10)), "rhovExecuteOk")}>{t("rhovExecuter")}</button>
          )}
          {o.statut === "VALIDE" && (
            <button type="button" style={{ ...boutonLeger, color: "var(--brique)", marginLeft: "auto" }} onClick={() => window.confirm(t("rhovAnnulerConfirm")) && agir(() => api.annulerOrdreVirement(id))}>{t("rhovAnnuler")}</button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
