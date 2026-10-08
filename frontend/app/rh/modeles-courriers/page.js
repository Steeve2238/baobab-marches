"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import { boutonPrincipal, boutonLeger, inputStyle, labelStyle, Section } from "../../../lib/components/rhUi";

const COMMUNES = ["employeur", "siege", "representant", "qualite_representant", "travailleur", "nom_complet", "civilite_long", "matricule", "fonction", "classification", "convention", "date_embauche", "date_naissance", "lieu_naissance", "ville", "date_courrier", "ne", "employe", "interesse", "il_elle", "il_elle_maj"];

export default function ModelesCourriersPage() {
  const { t } = useLangue();
  const [types, setTypes] = useState(null);
  const [type, setType] = useState("");
  const [objet, setObjet] = useState("");
  const [texte, setTexte] = useState("");
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");

  function charger(liste, tp) {
    const d = liste.find((x) => x.type === tp);
    setObjet(d.modele.objet);
    setTexte(d.modele.paragraphes.join("\n"));
  }
  function recharger(tp) {
    return api.getCourrierTypes().then((l) => {
      setTypes(l);
      const choix = tp || l[0].type;
      setType(choix);
      charger(l, choix);
    });
  }
  useEffect(() => { recharger().catch((e) => setErreur(e.message)); }, []);

  if (!types) {
    return <AppShell title={t("rhkModelesTitre")}>{erreur ? <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p> : <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}</AppShell>;
  }
  const def = types.find((x) => x.type === type);
  const perso = def.modele.personnalise;
  const vars = [...COMMUNES, ...def.champs.map((c) => c.name)];
  if (def.lignes) vars.push("total", "total_lettres", "LIGNES");

  async function enregistrer() {
    setErreur("");
    setMessage("");
    try {
      await api.putModeleCourrier(type, { objet, paragraphes: texte.split("\n").map((x) => x.trim()).filter(Boolean) });
      await recharger(type);
      setMessage(t("rhkModeleEnregistre"));
    } catch (e) { setErreur(e.message); }
  }
  async function restaurer() {
    if (!window.confirm(t("rhkRestaurerConfirm"))) return;
    try { await api.deleteModeleCourrier(type); await recharger(type); setMessage(""); } catch (e) { setErreur(e.message); }
  }

  return (
    <AppShell title={t("rhkModelesTitre")}>
      <Link href="/rh/courriers" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("rhkRetour")}</Link>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 0, maxWidth: 780 }}>{t("rhkModelesAide")}</p>
      <p style={{ fontSize: 12, color: "var(--brique)", marginTop: 0 }}>{t("rhkModelesAvertissement")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <select value={type} onChange={(e) => { setType(e.target.value); setMessage(""); charger(types, e.target.value); }} style={{ ...inputStyle, width: "auto", minWidth: 280 }}>
          {types.map((x) => <option key={x.type} value={x.type}>{t(`rhkType_${x.type}`)}</option>)}
        </select>
        <span className={perso ? "chip ok" : "chip"}>{perso ? t("rhkModelePerso") : t("rhkModeleDefaut")}</span>
      </div>

      <div style={{ maxWidth: 980, display: "grid", gap: 14 }}>
        <Section titre={t("rhkVariables")} aide={t("rhkVariablesAide")}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {vars.map((k) => <span key={k} className="chip" style={{ fontFamily: "monospace" }}>{`{${k}}`}</span>)}
          </div>
        </Section>
        <section className="card">
          <label style={labelStyle}>{t("rhkObjetModele")}</label>
          <input value={objet} onChange={(e) => setObjet(e.target.value)} style={inputStyle} />
          <label style={{ ...labelStyle, marginTop: 12 }}>{t("rhkParagraphesModele")}</label>
          <textarea rows={Math.min(24, Math.max(8, texte.split("\n").length * 2))} value={texte} onChange={(e) => setTexte(e.target.value)} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.45 }} />
        </section>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" style={boutonPrincipal} onClick={enregistrer}>{t("rhkEnregistrerModele")}</button>
          {perso && <button type="button" style={{ ...boutonLeger, color: "var(--brique)" }} onClick={restaurer}>{t("rhkRestaurer")}</button>}
        </div>
      </div>
    </AppShell>
  );
}
