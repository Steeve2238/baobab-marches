"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../lib/components/FiscaliteSousNav";
import { thStyle, tdStyle, boutonSecondaireStyle, pastilleStyle, formaterXof, dateCourte, texteAlerte } from "../../../lib/fiscaliteUi";

const STYLE_GRAVITE = {
  ELEVEE: { color: "#9B2C2C", background: "rgba(178,58,58,0.12)" },
  MOYENNE: { color: "#8A6200", background: "rgba(214,160,40,0.16)" },
  INFO: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};

export default function FiscaliteConformitePage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const mm = (v) => formaterXof(v, locale);
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState("");
  const [ouvert, setOuvert] = useState({});

  const charger = useCallback(() => {
    setData(null);
    setErreur("");
    api.fiscaliteConformite(annee).then(setData).catch((e) => setErreur(e.message));
  }, [annee]);
  useEffect(() => {
    charger();
  }, [charger]);

  const exemple = (c, x) => {
    if (c.code === "ECHEANCES_EN_RETARD") return `${t(`fiscEch${x.type}`)} ${x.periode} — ${t("fiscLimite")} ${dateCourte(x.date_limite, locale)}${x.penalites ? ` — ${t("fiscPenalitesEstimees")} ${mm(x.penalites)}` : ""}`;
    if (c.code === "TVA_CREDIT_RECURRENT" || c.code === "GL_TVA_COLLECTEE_FAIBLE") return `${t("fiscConfMois")} ${x.mois} — ${mm(x.montant)} XOF`;
    if (x.numero && !x.tiers) return x.numero;
    return `${x.numero || ""}${x.date ? ` (${dateCourte(x.date, locale)})` : ""}${x.tiers ? ` — ${x.tiers}` : ""}${x.montant ? ` — ${mm(x.montant)} XOF` : ""}`;
  };

  const ef = data?.facturation_electronique;
  const carte = (titre, valeur, couleur) => (
    <div className="card" style={couleur ? { borderLeft: `3px solid ${couleur}` } : undefined}>
      <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{titre}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{valeur}</div>
    </div>
  );

  return (
    <AppShell title={t("fiscConfTitre")} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 840, lineHeight: 1.5 }}>{t("fiscConfAide")}</p>

      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button style={boutonSecondaireStyle} onClick={() => setAnnee(annee - 1)}>‹ {annee - 1}</button>
        <strong style={{ fontSize: 14 }}>{annee}</strong>
        <button style={boutonSecondaireStyle} onClick={() => setAnnee(annee + 1)}>{annee + 1} ›</button>
        <button style={boutonSecondaireStyle} onClick={charger}>{t("fiscRecalculer")}</button>
        <span style={{ flex: 1 }} />
        {data && <span style={{ fontSize: 12, color: "var(--sub)" }}>{data.donnees.ventes} {t("fiscConfFacturesVente")} · {data.donnees.achats} {t("fiscConfFacturesAchat")}</span>}
      </div>

      {!data && !erreur && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 14 }}>
            {carte(t("fiscConfElevee"), data.resume.elevee, data.resume.elevee ? "#B23A3A" : "#2E7D5B")}
            {carte(t("fiscConfMoyenne"), data.resume.moyenne, data.resume.moyenne ? "var(--ocre)" : "#2E7D5B")}
            {carte(t("fiscConfControles"), `${data.resume.controles_ok} / ${data.resume.controles}`, "var(--petrol)")}
            {carte(t("fiscConfPenalitesEnCours"), `${mm(data.penalites_en_cours.total)} XOF`, data.penalites_en_cours.nombre ? "#B23A3A" : undefined)}
          </div>

          {data.constats.length === 0 && <div className="card" style={{ marginBottom: 14, fontSize: 12.5, color: "#2E7D5B" }}>{t("fiscConfRien")}</div>}
          {data.constats.map((c) => (
            <div className="card" key={c.code} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                <span style={pastilleStyle(STYLE_GRAVITE[c.gravite])}>{t(`fiscConfGravite_${c.gravite}`)}</span>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{t(`fiscConf_${c.code}`)}</div>
                  <div style={{ fontSize: 12.3, lineHeight: 1.55, marginTop: 3 }}>{texteAlerte(t, "fiscConfTxt_", { code: c.code, nombre: c.nombre, montant: c.montant ?? 0, clients: c.clients ?? 0 }, locale)}</div>
                  {c.reference ? <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 3 }}>{c.reference}</div> : null}
                </div>
                {c.exemples.length > 0 && (
                  <button style={boutonSecondaireStyle} onClick={() => setOuvert({ ...ouvert, [c.code]: !ouvert[c.code] })}>
                    {ouvert[c.code] ? t("fiscConfMasquer") : `${t("fiscConfVoirExemples")} (${c.exemples.length})`}
                  </button>
                )}
              </div>
              {ouvert[c.code] && (
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
                  {c.exemples.map((x, i) => <li key={i}>{exemple(c, x)}</li>)}
                  {c.nombre > c.exemples.length && <li style={{ color: "var(--sub)" }}>… {c.nombre - c.exemples.length} {t("fiscConfAutres")}</li>}
                </ul>
              )}
            </div>
          ))}

          <div className="card" style={{ marginTop: 14, marginBottom: 14 }}>
            <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscConfEfacture")}</h3>
            <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscConfEfactureAide")}</p>
            {ef.total === 0 ? (
              <p style={{ fontSize: 12.5, margin: 0, color: "var(--sub)" }}>{t("fiscConfEfactureAucune")}</p>
            ) : (
              <>
                <div style={{ height: 10, background: "var(--line-soft)", borderRadius: 6, overflow: "hidden", maxWidth: 420 }}>
                  <div style={{ width: `${ef.pourcentage}%`, height: "100%", background: ef.pourcentage >= 90 ? "#2E7D5B" : ef.pourcentage >= 60 ? "var(--ocre)" : "#B23A3A" }} />
                </div>
                <p style={{ fontSize: 12.5, margin: "6px 0 10px" }}>{ef.pretes} / {ef.total} {t("fiscConfFacturesPretes")} ({ef.pourcentage} %)</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.3, lineHeight: 1.65 }}>
                  <li>{t("fiscConfEfNineaEmetteur")} : <strong>{ef.ninea_emetteur ? t("fiscOui") : t("fiscNon")}</strong></li>
                  <li>{t("fiscConfEfAdresseEmetteur")} : <strong>{ef.adresse_emetteur ? t("fiscOui") : t("fiscNon")}</strong></li>
                  <li>{t("fiscConfEfClientNinea")} : <strong>{ef.manques.client_ninea}</strong></li>
                  <li>{t("fiscConfEfClientAdresse")} : <strong>{ef.manques.client_adresse}</strong></li>
                  <li>{t("fiscConfEfMontants")} : <strong>{ef.manques.montants}</strong></li>
                </ul>
              </>
            )}
            <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 10, marginBottom: 0 }}>{t("fiscConfEfactureReserve")}</p>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscConfListeControles")}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "4px 18px" }}>
              {data.controles.map((c) => (
                <div key={c.code} style={{ fontSize: 12.3, display: "flex", gap: 8 }}>
                  <span style={{ color: c.ok ? "#2E7D5B" : "#B23A3A", fontWeight: 700, width: 14 }}>{c.ok ? "✓" : "✗"}</span>
                  <span>{t(`fiscConf_${c.code}`)}</span>
                </div>
              ))}
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--sub)" }}>
            <Link href="/fiscalite/penalites" style={{ color: "var(--petrol)", fontWeight: 600 }}>{t("fiscConfVersPenalites")}</Link>
          </p>
        </>
      )}
    </AppShell>
  );
}
