"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import PaieSousNav from "../../../lib/components/PaieSousNav";
import { boutonPrincipal, boutonLeger, inputStyle, labelStyle, Section } from "../../../lib/components/rhUi";

const TYPES = ["CDI", "CDD", "JOURNALIER"];

const versEditeur = (articles) =>
  articles.map((a) => ({ titre: a.titre, texte: (a.paragraphes || []).join("\n"), remuneration: !!a.remuneration, si: a.si === "ESSAI" }));
const versApi = (arts) =>
  arts.map((a) => ({
    titre: a.titre,
    paragraphes: a.texte.split("\n").map((x) => x.trim()).filter(Boolean),
    ...(a.remuneration ? { remuneration: true } : {}),
    ...(a.si ? { si: "ESSAI" } : {}),
  }));

export default function ModelesContratsPage() {
  const { t } = useLangue();
  const [donnees, setDonnees] = useState(null);
  const [type, setType] = useState("CDI");
  const [arts, setArts] = useState([]);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");

  function charger(d, tp) {
    const m = d.modeles.find((x) => x.type === tp);
    setArts(versEditeur(m.articles));
  }
  useEffect(() => {
    api.getModelesContrats().then((d) => {
      setDonnees(d);
      charger(d, "CDI");
    }).catch((e) => setErreur(e.message));
  }, []);

  function choisir(tp) {
    setType(tp);
    setMessage("");
    charger(donnees, tp);
  }
  const maj = (i, k, v) => setArts((l) => l.map((a, j) => (j === i ? { ...a, [k]: v } : a)));
  const deplacer = (i, d) =>
    setArts((l) => {
      const n = [...l];
      const j = i + d;
      if (j < 0 || j >= n.length) return l;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  async function enregistrer() {
    setErreur("");
    setMessage("");
    try {
      const r = await api.putModeleContrat(type, versApi(arts));
      setDonnees((d) => ({ ...d, modeles: d.modeles.map((m) => (m.type === type ? r : m)) }));
      setMessage(t("rhmEnregistre"));
    } catch (e) {
      setErreur(e.message);
    }
  }
  async function reinitialiser() {
    if (!window.confirm(t("rhmReinitialiserConfirm"))) return;
    try {
      const r = await api.deleteModeleContrat(type);
      setDonnees((d) => ({ ...d, modeles: d.modeles.map((m) => (m.type === type ? r : m)) }));
      setArts(versEditeur(r.articles));
    } catch (e) {
      setErreur(e.message);
    }
  }

  if (!donnees) {
    return <AppShell title={t("rhmTitre")} subNav={<PaieSousNav />}>{erreur ? <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p> : <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}</AppShell>;
  }
  const modele = donnees.modeles.find((m) => m.type === type);

  return (
    <AppShell title={t("rhmTitre")} subNav={<PaieSousNav />}>
      <Link href="/rh/contrats" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("rhmRetour")}</Link>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 0, maxWidth: 780 }}>{t("rhmAide")}</p>
      <p style={{ fontSize: 12, color: "var(--brique)", marginTop: 0 }}>{t("rhmAvertissement")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {TYPES.map((x) => (
          <button key={x} type="button" onClick={() => choisir(x)} style={x === type ? boutonPrincipal : boutonLeger}>{t(`rhcType_${x}`)}</button>
        ))}
        <span className={modele.personnalise ? "chip ok" : "chip"} style={{ marginLeft: 8 }}>{modele.personnalise ? t("rhmPersonnalise") : t("rhmParDefaut")}</span>
      </div>

      <div style={{ maxWidth: 980, display: "grid", gap: 14 }}>
        <Section titre={t("rhmVariables")} aide={t("rhmBalises")}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {donnees.variables.map(([k, d]) => (
              <span key={k} className="chip" title={d} style={{ fontFamily: "monospace" }}>{`{${k}}`}</span>
            ))}
          </div>
        </Section>

        {arts.map((a, i) => (
          <section key={i} className="card">
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13 }}>Article {i + 1}</strong>
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button type="button" style={boutonLeger} onClick={() => deplacer(i, -1)}>{t("rhmMonter")}</button>
                <button type="button" style={boutonLeger} onClick={() => deplacer(i, 1)}>{t("rhmDescendre")}</button>
                <button type="button" style={{ ...boutonLeger, color: "var(--brique)" }} onClick={() => setArts((l) => l.filter((_, j) => j !== i))}>{t("rhmSupprimerArticle")}</button>
              </span>
            </div>
            <label style={labelStyle}>{t("rhmArticleTitre")}</label>
            <input value={a.titre} onChange={(e) => maj(i, "titre", e.target.value)} style={inputStyle} />
            <label style={{ ...labelStyle, marginTop: 10 }}>{t("rhmArticleTexte")}</label>
            <textarea rows={Math.max(3, a.texte.split("\n").length * 2)} value={a.texte} onChange={(e) => maj(i, "texte", e.target.value)} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.45 }} />
            <div style={{ display: "flex", gap: 18, marginTop: 8, flexWrap: "wrap", fontSize: 12 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={a.remuneration} onChange={(e) => setArts((l) => l.map((x, j) => ({ ...x, remuneration: j === i ? e.target.checked : e.target.checked ? false : x.remuneration })))} />
                {t("rhmRemunerationArticle")}
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={a.si} onChange={(e) => maj(i, "si", e.target.checked)} />
                {t("rhmSiEssai")}
              </label>
            </div>
          </section>
        ))}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" style={boutonLeger} onClick={() => setArts((l) => [...l, { titre: "", texte: "", remuneration: false, si: false }])}>+ {t("rhmAjouterArticle")}</button>
          <button type="button" style={boutonPrincipal} onClick={enregistrer}>{t("rhmEnregistrer")}</button>
          {modele.personnalise && <button type="button" style={{ ...boutonLeger, color: "var(--brique)" }} onClick={reinitialiser}>{t("rhmReinitialiser")}</button>}
        </div>
      </div>
    </AppShell>
  );
}
