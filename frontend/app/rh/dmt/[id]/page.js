"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import DmtForm, { donneesVersApi } from "../../../../lib/components/DmtForm";
import { boutonPrincipal, boutonLeger, Champ, Section, grille, inputStyle } from "../../../../lib/components/rhUi";

export default function DmtPage() {
  const { id } = useParams();
  const router = useRouter();
  const { t } = useLangue();
  const [dmt, setDmt] = useState(null);
  const [donnees, setDonnees] = useState(null);
  const [suivi, setSuivi] = useState({ statut: "BROUILLON", date_depot: "", numero_visa: "", date_visa: "", visa_section_locale: "" });
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);

  function appliquer(d) {
    setDmt(d);
    setDonnees({ ...d.donnees_json, elements: (d.donnees_json.elements || []).map((l) => ({ libelle: l.libelle, montant: String(l.montant) })) });
    setSuivi({
      statut: d.statut,
      date_depot: d.date_depot ? String(d.date_depot).slice(0, 10) : "",
      numero_visa: d.numero_visa || "",
      date_visa: d.date_visa ? String(d.date_visa).slice(0, 10) : "",
      visa_section_locale: d.visa_section_locale || "",
    });
  }
  useEffect(() => {
    api.getDmt(id).then(appliquer).catch((e) => setErreur(e.message));
  }, [id]);

  const brouillon = dmt && dmt.statut === "BROUILLON";

  async function enregistrer(e) {
    e.preventDefault();
    setEnCours(true);
    setErreur("");
    setMessage("");
    try {
      const corps = { ...suivi };
      for (const k of ["date_depot", "date_visa"]) if (!corps[k]) corps[k] = null;
      if (brouillon) corps.donnees = donneesVersApi(donnees);
      appliquer(await api.patchDmt(id, corps));
      setMessage(t("rhdmEnregistre"));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }
  async function supprimer() {
    if (!window.confirm(t("rhdmSupprimerConfirm"))) return;
    try {
      await api.deleteDmt(id);
      router.push("/rh/dmt");
    } catch (err) {
      setErreur(err.message);
    }
  }
  async function apercu() {
    try {
      if (brouillon) await api.patchDmt(id, { donnees: donneesVersApi(donnees) });
      await api.ouvrirPdfRH(`/rh/dmt/${id}/pdf`);
    } catch (err) {
      setErreur(err.message);
    }
  }

  if (erreur && !dmt) return <AppShell title={t("rhdmTitre")}><p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p></AppShell>;
  if (!dmt || !donnees) return <AppShell title={t("rhdmTitre")}><p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p></AppShell>;

  const majSuivi = (k, v) => setSuivi((s) => ({ ...s, [k]: v }));
  return (
    <AppShell title={dmt.numero}>
      <Link href="/rh/dmt" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("rhdmRetour")}</Link>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}
      <form onSubmit={enregistrer} style={{ maxWidth: 980, display: "grid", gap: 16 }}>
        <div className="card" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{dmt.employe.prenom} {dmt.employe.nom}</div>
            <div style={{ fontSize: 12, color: "var(--sub)" }}>{t(`rhdmObjet_${dmt.objet}`)} · {dmt.numero}</div>
          </div>
          <span className={dmt.statut === "ANNULEE" ? "chip risk" : brouillon ? "chip" : "chip ok"}>{t(`rhdmStatut_${dmt.statut}`)}</span>
          <Link href={`/rh/personnel/${dmt.employe.id}`} style={{ ...boutonLeger, marginLeft: "auto" }}>{t("rhcOuvrirFiche")}</Link>
        </div>

        {dmt.avertissements.length > 0 && (
          <Section titre={t("rhcAvertissements")}>
            <div style={{ display: "grid", gap: 6 }}>
              {dmt.avertissements.map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5 }}>
                  <span className={a.niveau === "BLOQUANT" ? "chip risk" : "chip"} style={{ flexShrink: 0 }}>{a.niveau === "BLOQUANT" ? t("rhcBloquant") : t("rhcAttention")}</span>
                  <span>{t(`rhcAv_${a.code}`)}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {!brouillon && <p style={{ fontSize: 12, color: "var(--sub)", margin: 0 }}>{t("rhdmFigee")}</p>}
        <DmtForm donnees={donnees} setDonnees={setDonnees} t={t} lectureSeule={!brouillon} />

        <Section titre={t("rhdmSuivi")}>
          <div style={grille}>
            <Champ label={t("rhdmStatut")}>
              <select value={suivi.statut} onChange={(e) => majSuivi("statut", e.target.value)} style={inputStyle}>
                {["BROUILLON", "SIGNEE", "DEPOSEE", "VISEE", "ANNULEE"].map((s) => (
                  <option key={s} value={s}>{t(`rhdmStatut_${s}`)}</option>
                ))}
              </select>
            </Champ>
            <Champ label={t("rhdmDateDepot")}><input type="date" value={suivi.date_depot} onChange={(e) => majSuivi("date_depot", e.target.value)} style={inputStyle} /></Champ>
            <Champ label={t("rhdmNumeroVisa")}><input value={suivi.numero_visa} onChange={(e) => majSuivi("numero_visa", e.target.value)} style={inputStyle} /></Champ>
            <Champ label={t("rhdmDateVisa")}><input type="date" value={suivi.date_visa} onChange={(e) => majSuivi("date_visa", e.target.value)} style={inputStyle} /></Champ>
            <Champ label={t("rhdmSection")} large><input value={suivi.visa_section_locale} onChange={(e) => majSuivi("visa_section_locale", e.target.value)} style={inputStyle} /></Champ>
          </div>
        </Section>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="submit" disabled={enCours} style={boutonPrincipal}>{enCours ? t("rhcEnregistrement") : t("rhdmEnregistrer")}</button>
          <button type="button" style={boutonLeger} onClick={apercu}>{t("rhdmApercuPdf")}</button>
          {!brouillon && <button type="button" style={boutonLeger} onClick={() => api.telechargerPdfRH(`/rh/dmt/${id}/pdf`, `${dmt.numero}.pdf`).catch((e) => setErreur(e.message))}>{t("rhdmTelechargerPdf")}</button>}
          {(brouillon || dmt.statut === "ANNULEE") && <button type="button" style={{ ...boutonLeger, color: "var(--brique)" }} onClick={supprimer}>{t("rhdmSupprimer")}</button>}
        </div>
      </form>
    </AppShell>
  );
}
