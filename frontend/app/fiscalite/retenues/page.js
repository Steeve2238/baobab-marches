"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../lib/components/FiscaliteSousNav";
import FiscDossierBarre from "../../../lib/components/FiscDossierBarre";
import { inputStyle, labelStyle, thStyle, tdStyle, boutonPrincipalStyle, boutonSecondaireStyle, formaterXof, dateCourte, nomMois } from "../../../lib/fiscaliteUi";

const TYPES = ["PRESTATION_PP", "LOYER", "NON_RESIDENT", "IRVM_DIVIDENDES", "IRVM_CREANCES", "IRVM_OBLIGATIONS", "IRVM_OBLIGATIONS_LONGUES"];
const STATUTS_BENEF = ["PP_SANS_REEL", "PP_REEL", "SOCIETE_IS", "NON_RESIDENT", "AUTRE"];
const pad = (n) => String(n).padStart(2, "0");
const trimestreDuMois = (m) => Math.ceil(m / 3);

const videForm = (annee, mois) => {
  const auj = new Date();
  const date = auj.getFullYear() === annee && auj.getMonth() + 1 === mois ? auj.toISOString().slice(0, 10) : `${annee}-${pad(mois)}-01`;
  return {
    id: null,
    type: "PRESTATION_PP",
    date_operation: date,
    beneficiaire_nom: "",
    beneficiaire_ninea: "",
    beneficiaire_statut: "PP_SANS_REEL",
    beneficiaire_adresse: "",
    beneficiaire_profession: "",
    beneficiaire_piece: "",
    reference: "",
    libelle: "",
    montant_brut: "",
    montant_facture: "",
    loyer_mensuel: "",
    taux_applique: "",
    retenue_effectuee: "",
    statut: "CONFIRMEE",
    source: "MANUEL",
  };
};

export default function FiscaliteRetenuesPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const mm = (v) => formaterXof(v, locale);
  const auj = new Date();
  const [annee, setAnnee] = useState(auj.getFullYear());
  const [mois, setMois] = useState(auj.getMonth() + 1);
  const [vue, setVue] = useState(null);
  const [resume, setResume] = useState(null);
  const [onglet, setOnglet] = useState("operations");
  const [form, setForm] = useState(null);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [rapprochement, setRapprochement] = useState(null);
  const [trimestre, setTrimestre] = useState(trimestreDuMois(auj.getMonth() + 1));
  const [etatTrim, setEtatTrim] = useState(null);
  const [fichier, setFichier] = useState(null);
  const [apercu, setApercu] = useState(null);
  const [resultatImport, setResultatImport] = useState(null);
  const [params, setParams] = useState(null);
  const [paramsOuvert, setParamsOuvert] = useState(false);

  // Ouverture depuis le calendrier : ?annee=2026&mois=9
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const a = Number(p.get("annee"));
    const m = Number(p.get("mois"));
    if (a >= 2000 && a <= 2100 && m >= 1 && m <= 12) {
      setAnnee(a);
      setMois(m);
      setTrimestre(trimestreDuMois(m));
    }
  }, []);

  const charger = useCallback(async () => {
    setErreur("");
    try {
      const [v, r] = await Promise.all([api.fiscaliteRetenuesPeriode(annee, mois), api.fiscaliteRetenuesResume(annee)]);
      setVue(v);
      setResume(r);
    } catch (e) {
      setErreur(e.message);
    }
  }, [annee, mois]);
  useEffect(() => {
    charger();
  }, [charger]);

  useEffect(() => {
    if (onglet === "propositions" && !params) api.fiscaliteRetenuesParametres().then(setParams).catch(() => {});
  }, [onglet, params]);

  useEffect(() => {
    if (onglet !== "rapprochement") return;
    setRapprochement(null);
    api.fiscaliteRetenuesRapprochement(annee, mois).then(setRapprochement).catch((e) => setErreur(e.message));
  }, [onglet, annee, mois, vue]);

  useEffect(() => {
    if (onglet !== "trimestre") return;
    setEtatTrim(null);
    api.fiscaliteRetenuesTrimestre(annee, trimestre).then(setEtatTrim).catch((e) => setErreur(e.message));
  }, [onglet, annee, trimestre, vue]);

  async function executer(fn, message) {
    setErreur("");
    setInfo("");
    try {
      const r = await fn();
      if (message) setInfo(message);
      await charger();
      return r;
    } catch (e) {
      setErreur(e.message);
      return null;
    }
  }

  const dossier = vue?.dossier || null;
  const gele = !!dossier && (dossier.statut === "DEPOSEE" || dossier.statut === "PAYEE");
  const confirmees = (vue?.operations || []).filter((o) => o.statut === "CONFIRMEE");
  const propositions = (vue?.operations || []).filter((o) => o.statut === "PROPOSEE");
  const exclues = (vue?.operations || []).filter((o) => o.statut === "EXCLUE");

  const preparer = () => executer(() => api.fiscaliteRetenuesPreparer(annee, mois), t("fiscInfoPreparee"));
  const changerStatut = (corps) => executer(() => api.fiscaliteRetenuesStatut(annee, mois, corps), corps.action === "deposer" ? t("fiscInfoDeposee") : corps.action === "payer" ? t("fiscInfoPayee") : t("fiscInfoRouverte"));
  async function exporter(format) {
    setErreur("");
    try {
      await api.fiscaliteRetenuesExporter(annee, mois, format);
    } catch (e) {
      setErreur(e.message);
    }
  }

  const versNombre = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  async function enregistrer(e) {
    e.preventDefault();
    const corps = {
      ...form,
      montant_brut: versNombre(form.montant_brut),
      montant_facture: versNombre(form.montant_facture),
      loyer_mensuel: versNombre(form.loyer_mensuel),
      taux_applique: versNombre(form.taux_applique),
      retenue_effectuee: versNombre(form.retenue_effectuee),
    };
    const ok = await executer(() => (form.id ? api.fiscaliteRetenueModifier(form.id, corps) : api.fiscaliteRetenueCreer(corps)), t("fiscRsInfoEnregistre"));
    if (ok) {
      const d = corps.date_operation;
      if (d && (Number(d.slice(0, 4)) !== annee || Number(d.slice(5, 7)) !== mois)) {
        setAnnee(Number(d.slice(0, 4)));
        setMois(Number(d.slice(5, 7)));
      }
      setForm(null);
    }
  }
  const editer = (o) =>
    setForm({
      ...videForm(annee, mois),
      ...o,
      beneficiaire_ninea: o.beneficiaire_ninea || "",
      beneficiaire_adresse: o.beneficiaire_adresse || "",
      beneficiaire_profession: o.beneficiaire_profession || "",
      beneficiaire_piece: o.beneficiaire_piece || "",
      reference: o.reference || "",
      libelle: o.libelle || "",
      montant_facture: o.montant_facture ?? "",
      loyer_mensuel: o.loyer_mensuel ?? "",
      taux_applique: o.taux_applique ?? "",
      retenue_effectuee: o.retenue_effectuee ?? "",
    });
  const changerLigne = (o, statut) => executer(() => api.fiscaliteRetenueModifier(o.id, { statut }));
  const supprimer = (o) => {
    if (window.confirm(t("fiscRsSupprimerConfirm"))) executer(() => api.fiscaliteRetenueSupprimer(o.id), t("fiscRsInfoSupprimee"));
  };

  async function rechercher(fn) {
    const res = await executer(fn);
    if (!res) return;
    if (res.bloque) {
      setInfo("");
      setErreur(t(`fiscRsBloque_${res.bloque}`).replace("{n}", res.nombre));
      return;
    }
    if (res.source) {
      setInfo(
        t("fiscRsResultatCompta")
          .replace("{source}", t(`fiscRsSourceCompta_${res.source}`))
          .replace("{crees}", res.crees)
          .replace("{deja}", res.deja_traitees)
          .replace("{ignores}", res.ignores)
          .replace("{sans}", res.sans_paiement)
      );
      return;
    }
    setInfo(t("fiscRsRechercheResultat").replace("{crees}", res.crees).replace("{analyses}", res.analyses));
    if (res.crees > 0 && res.date) {
      const a = Number(res.date.slice(0, 4));
      const m = Number(res.date.slice(5, 7));
      if (a !== annee || m !== mois) {
        setAnnee(a);
        setMois(m);
      }
    }
  }

  async function confirmerCoherentes() {
    const res = await executer(() => api.fiscaliteRetenuesConfirmerCoherentes(annee, mois));
    if (res) setInfo(t("fiscRsConfirmeesCoherentes").replace("{n}", res.confirmees));
  }
  async function enregistrerParams(e) {
    e.preventDefault();
    setErreur("");
    try {
      const joindre = (v) => (Array.isArray(v) ? v.join(", ") : v);
      const r = await api.fiscaliteRetenuesParametresEnregistrer({ comptes_prestations: joindre(params.comptes_prestations), comptes_loyers: joindre(params.comptes_loyers), comptes_retenue: joindre(params.comptes_retenue) });
      setParams(r);
      setParamsOuvert(false);
      setInfo(t("fiscRsParamEnregistres"));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function analyserFichier() {
    if (!fichier) return;
    setErreur("");
    setResultatImport(null);
    try {
      const fd = new FormData();
      fd.append("fichier", fichier);
      setApercu(await api.fiscaliteRetenuesImportApercu(fd));
    } catch (e) {
      setApercu(null);
      setErreur(e.message);
    }
  }
  async function importerFichier() {
    if (!fichier) return;
    setErreur("");
    try {
      const fd = new FormData();
      fd.append("fichier", fichier);
      const r = await api.fiscaliteRetenuesImporter(fd);
      setResultatImport(r);
      setApercu(null);
      setFichier(null);
      await charger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  const champ = (libelle, enfant) => (
    <div>
      <label style={labelStyle}>{libelle}</label>
      {enfant}
    </div>
  );
  const ongletBtn = (cle, libelle) => (
    <button
      key={cle}
      onClick={() => setOnglet(cle)}
      style={{ padding: "7px 14px", borderRadius: "8px 8px 0 0", border: "1px solid var(--line)", borderBottom: onglet === cle ? "1px solid #fff" : "1px solid var(--line)", background: onglet === cle ? "#fff" : "var(--line-soft)", fontSize: 12.5, fontWeight: onglet === cle ? 700 : 500, color: "var(--petrol)", marginBottom: -1 }}
    >
      {libelle}
    </button>
  );
  const observations = (o) => {
    const c = o.calcul;
    const k = o.controle;
    const lignes = [];
    if (k && k.situation) lignes.push({ texte: t(`fiscRsSit_${k.situation}`), alerte: k.situation !== "COMPLETE" });
    if (k && k.situation && k.situation !== "COMPLETE" && o.statut !== "CONFIRMEE") {
      lignes.push({ texte: `${t("fiscRsBaseAConfirmer")}${k.brut_si_net ? ` ${t("fiscRsBrutSiNet")} ${mm(k.brut_si_net)}.` : ""}`, alerte: false });
    }
    for (const m of c.motifs) lignes.push({ texte: t(`fiscRsMotif_${m}`), alerte: false });
    for (const w of c.warnings) {
      if (k && w === "ECART_RETENUE_EFFECTUEE") continue; // deja exprime par la situation du controle comptable
      lignes.push({ texte: w === "ECART_RETENUE_EFFECTUEE" ? `${t(`fiscRsAvert_${w}`)} (${c.ecart > 0 ? "+" : ""}${mm(c.ecart)})` : t(`fiscRsAvert_${w}`), alerte: w === "ECART_RETENUE_EFFECTUEE" || w === "RETENUE_SANS_OBLIGATION" });
    }
    return lignes;
  };
  const detailPieces = (k) => (k && (k.piece || k.piece_paiement) ? `${k.piece || ""}${k.piece_paiement ? ` → ${k.piece_paiement}` : ""}${k.part_reglee && k.part_reglee < 1 ? ` (${Math.round(k.part_reglee * 100)} %)` : ""}` : null);
  const texteGlobal = (a) => `${a.code.startsWith("MOTIF_") ? t(`fiscRsMotif_${a.code.slice(6)}`) : t(`fiscRsAvert_${a.code}`)}${a.nombre > 1 ? ` (${a.nombre})` : ""}`;

  const s = vue?.synthese;
  const v = vue?.versement;
  const bloc = (titre, valeur, couleur, sous) => (
    <div className="card" style={couleur ? { borderLeft: `3px solid ${couleur}` } : undefined}>
      <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{titre}</div>
      <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{valeur}</div>
      {sous && <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{sous}</div>}
    </div>
  );

  const ligneOperation = (o, { actions }) => (
    <tr key={o.id} style={{ opacity: o.statut === "EXCLUE" ? 0.6 : 1 }}>
      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{dateCourte(o.date_operation, locale)}</td>
      <td style={{ ...tdStyle, fontSize: 12, minWidth: 110 }}>{t(`fiscRsType_${o.type}`)}</td>
      <td style={{ ...tdStyle, minWidth: 190 }}>
        <div style={{ fontWeight: 700 }}>{o.beneficiaire_nom}</div>
        <div style={{ fontSize: 11, color: "var(--sub)" }}>
          {[o.beneficiaire_ninea ? `NINEA ${o.beneficiaire_ninea}` : null, t(`fiscRsStatut_${o.beneficiaire_statut}`), detailPieces(o.controle) || o.reference, t(`fiscRsSource_${o.source}`)].filter(Boolean).join(" · ")}
        </div>
        {o.libelle && <div style={{ fontSize: 11, color: "var(--sub)" }}>{o.libelle}</div>}
      </td>
      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(o.montant_brut)}</td>
      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{o.calcul.due ? mm(o.calcul.base) : "—"}</td>
      <td style={{ ...tdStyle, textAlign: "right" }}>{o.calcul.due ? `${String(o.calcul.taux).replace(".", ",")} %` : "—"}</td>
      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mm(o.calcul.retenue)}</td>
      <td style={{ ...tdStyle, fontSize: 11.5, lineHeight: 1.45, minWidth: 180, width: 230, maxWidth: 230 }}>
        {observations(o).map((x, i) => <div key={i} style={{ color: x.alerte ? "var(--brique)" : "var(--sub)" }}>{x.texte}</div>)}
      </td>
      <td style={{ ...tdStyle, textAlign: "right", width: 170, maxWidth: 170 }}><div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}>{actions}</div></td>
    </tr>
  );
  const enteteOperations = (
    <tr>
      <th style={thStyle}>{t("fiscRsColDate")}</th>
      <th style={thStyle}>{t("fiscRsColType")}</th>
      <th style={thStyle}>{t("fiscRsColBeneficiaire")}</th>
      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscRsColBrut")}</th>
      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscRsColBase")}</th>
      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscRsColTaux")}</th>
      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscRsColRetenue")}</th>
      <th style={thStyle}>{t("fiscRsColObs")}</th>
      <th style={thStyle}></th>
    </tr>
  );

  return (
    <AppShell title={t("fiscRsTitre")} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "#2E7D5B", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 840, lineHeight: 1.5 }}>{t("fiscRsAide")}</p>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <button style={boutonSecondaireStyle} onClick={() => setAnnee(annee - 1)}>‹ {annee - 1}</button>
          <strong style={{ fontSize: 14 }}>{annee}</strong>
          <button style={boutonSecondaireStyle} onClick={() => setAnnee(annee + 1)}>{annee + 1} ›</button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const r = resume?.mois?.find((x) => x.mois === m);
            const actif = m === mois;
            const st = r && r.statut !== "BROUILLON" ? r.statut : null;
            return (
              <button
                key={m}
                onClick={() => setMois(m)}
                style={{ minWidth: 74, padding: "6px 8px", borderRadius: 8, border: `1px solid ${actif ? "var(--petrol)" : "var(--line)"}`, background: actif ? "var(--petrol)" : "#fff", color: actif ? "#fff" : "var(--petrol)", fontSize: 12, fontWeight: 600, textAlign: "left", cursor: "pointer" }}
              >
                <div>{new Date(2000, m - 1, 1).toLocaleDateString(locale, { month: "short" })}{r && r.nb_propositions > 0 ? " •" : ""}</div>
                <div style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.85, fontVariantNumeric: "tabular-nums" }}>{r && r.total_retenues > 0 ? mm(r.total_retenues) : "—"}</div>
                {st && <div style={{ fontSize: 9.5, fontWeight: 700, opacity: 0.9 }}>{t(`fiscStatut_${st}`)}</div>}
              </button>
            );
          })}
        </div>
      </div>

      {!vue && !erreur && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}

      {vue && (
        <>
          <FiscDossierBarre dossier={dossier} onPreparer={preparer} onStatut={changerStatut} onExporter={exporter} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
            {bloc(t("fiscRsTotal"), `${mm(s.total_retenues)} XOF`, "var(--petrol)", `${nomMois(mois, locale)} ${annee}`)}
            {bloc(t("fiscRsOperationsSoumises"), `${s.nb_soumises} / ${s.nb_confirmees}`)}
            {bloc(t("fiscRsPropositionsAttente"), s.nb_propositions, s.nb_propositions ? "var(--ocre)" : undefined)}
            {s.controle.manque > 0 && bloc(t("fiscRsManque"), `${mm(s.controle.manque)} XOF`, "var(--brique)", t("fiscRsManqueAide"))}
            {bloc(t("fiscRsEcheance"), dateCourte(v.echeance_mensuelle, locale))}
          </div>

          <div className="card" style={{ marginBottom: 14, fontSize: 12.3, lineHeight: 1.55 }}>
            {t(`fiscRsVersement_${v.mode}`)}
            {v.mode !== "MENSUEL" ? ` ${dateCourte(v.echeance_trimestrielle, locale)}.` : ""}
          </div>

          {s.avertissements.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 13, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscRsAvertGlobal")} ({s.avertissements.length})</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.3, lineHeight: 1.6 }}>
                {s.avertissements.map((a, i) => <li key={i}>{texteGlobal(a)}</li>)}
              </ul>
            </div>
          )}

          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {ongletBtn("operations", `${t("fiscRsOngletOperations")} (${confirmees.length})`)}
            {ongletBtn("propositions", `${t("fiscRsOngletPropositions")} (${propositions.length})`)}
            {ongletBtn("trimestre", t("fiscRsOngletTrimestre"))}
            {ongletBtn("rapprochement", t("fiscRsOngletRapprochement"))}
            {ongletBtn("import", t("fiscRsOngletImport"))}
          </div>
          <div className="card" style={{ borderTopLeftRadius: 0, overflowX: "auto" }}>
            {onglet === "operations" && (
              <>
                {s.par_type.length > 0 && (
                  <>
                    <h3 style={{ fontSize: 13.5, color: "var(--petrol)", margin: "0 0 6px" }}>{t("fiscRsRecap")}</h3>
                    <table style={{ width: "100%", maxWidth: 820, borderCollapse: "collapse", marginBottom: 16 }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>{t("fiscRsColType")}</th>
                          <th style={thStyle}>{t("fiscRsColTaux")}</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscRsColNb")}</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscRsColBase")}</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscRsColRetenue")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.par_type.map((x) => (
                          <tr key={x.type}>
                            <td style={tdStyle}>{t(`fiscRsType_${x.type}`)}</td>
                            <td style={tdStyle}>{String(x.taux).replace(".", ",")} %</td>
                            <td style={{ ...tdStyle, textAlign: "right" }}>{x.nombre_soumises} / {x.nombre}</td>
                            <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(x.base)}</td>
                            <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mm(x.retenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12, minWidth: 900 }}>
                  <thead>{enteteOperations}</thead>
                  <tbody>
                    {confirmees.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={9}>{t("fiscRsAucuneOperation")}</td></tr>}
                    {confirmees.map((o) =>
                      ligneOperation(o, {
                        actions: gele ? null : (
                          <>
                            <button style={boutonSecondaireStyle} onClick={() => editer(o)}>{t("fiscModifier")}</button>{" "}
                            <button style={boutonSecondaireStyle} onClick={() => supprimer(o)}>{t("fiscSupprimer")}</button>
                          </>
                        ),
                      })
                    )}
                  </tbody>
                </table>
                {!form && !gele && <button style={boutonPrincipalStyle} onClick={() => setForm(videForm(annee, mois))}>{t("fiscRsAjouter")}</button>}
              </>
            )}

            {onglet === "propositions" && (
              <>
                <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscRsPropositionsAide")}</p>
                {!gele && (
                  <>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      <button style={boutonPrincipalStyle} onClick={() => rechercher(() => api.fiscaliteRetenuesPropositionsCompta(annee, mois))}>{t("fiscRsAnalyserCompta")}</button>
                      <button style={boutonSecondaireStyle} onClick={() => rechercher(() => api.fiscaliteRetenuesPropositions(annee, mois))}>{t("fiscRsRechercherPlateforme")}</button>
                      <button style={boutonSecondaireStyle} onClick={() => rechercher(() => api.fiscaliteRetenuesPropositionsCca(annee))}>{t("fiscRsRechercherCca")} ({annee})</button>
                      {propositions.some((o) => o.source === "COMPTA" && o.controle && o.controle.situation === "COMPLETE") && (
                        <button style={boutonSecondaireStyle} onClick={confirmerCoherentes}>
                          {t("fiscRsConfirmerCoherentes")} ({propositions.filter((o) => o.source === "COMPTA" && o.controle && o.controle.situation === "COMPLETE").length})
                        </button>
                      )}
                      <button style={boutonSecondaireStyle} onClick={() => setParamsOuvert(!paramsOuvert)}>{t("fiscRsComptesAnalyses")}</button>
                    </div>
                    <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 12, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscRsComptaAide")}</p>
                    {paramsOuvert && params && (
                      <form onSubmit={enregistrerParams} className="card" style={{ marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", background: "var(--line-soft)" }}>
                        {champ(t("fiscRsParamPrestations"), <input value={Array.isArray(params.comptes_prestations) ? params.comptes_prestations.join(", ") : params.comptes_prestations} onChange={(e) => setParams({ ...params, comptes_prestations: e.target.value })} style={{ ...inputStyle, width: 200 }} />)}
                        {champ(t("fiscRsParamLoyers"), <input value={Array.isArray(params.comptes_loyers) ? params.comptes_loyers.join(", ") : params.comptes_loyers} onChange={(e) => setParams({ ...params, comptes_loyers: e.target.value })} style={{ ...inputStyle, width: 160 }} />)}
                        {champ(t("fiscRsParamRetenue"), <input value={Array.isArray(params.comptes_retenue) ? params.comptes_retenue.join(", ") : params.comptes_retenue} onChange={(e) => setParams({ ...params, comptes_retenue: e.target.value })} style={{ ...inputStyle, width: 160 }} />)}
                        <button type="submit" style={boutonPrincipalStyle}>{t("fiscEnregistrer")}</button>
                        <p style={{ flexBasis: "100%", fontSize: 11.5, color: "var(--sub)", margin: 0 }}>{t("fiscRsParamAide")}</p>
                      </form>
                    )}
                  </>
                )}
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12, minWidth: 900 }}>
                  <thead>{enteteOperations}</thead>
                  <tbody>
                    {propositions.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={9}>{t("fiscRsAucuneProposition")}</td></tr>}
                    {propositions.map((o) =>
                      ligneOperation(o, {
                        actions: gele ? null : (
                          <>
                            <button style={boutonPrincipalStyle} onClick={() => changerLigne(o, "CONFIRMEE")}>{t("fiscRsConfirmer")}</button>{" "}
                            <button style={boutonSecondaireStyle} onClick={() => editer(o)}>{t("fiscModifier")}</button>{" "}
                            <button style={boutonSecondaireStyle} onClick={() => changerLigne(o, "EXCLUE")}>{t("fiscRsExclure")}</button>
                          </>
                        ),
                      })
                    )}
                  </tbody>
                </table>
                {exclues.length > 0 && (
                  <>
                    <h3 style={{ fontSize: 13, color: "var(--petrol)", margin: "14px 0 6px" }}>{t("fiscRsExclues")} ({exclues.length})</h3>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                      <thead>{enteteOperations}</thead>
                      <tbody>
                        {exclues.map((o) => ligneOperation(o, { actions: gele ? null : <button style={boutonSecondaireStyle} onClick={() => changerLigne(o, "PROPOSEE")}>{t("fiscRsRetablir")}</button> }))}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}

            {onglet === "trimestre" && (
              <>
                <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscRsEtatTrimAide")}</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--petrol)" }}>{t("fiscRsTrimestre")}</span>
                  {[1, 2, 3, 4].map((q) => (
                    <button key={q} style={q === trimestre ? boutonPrincipalStyle : boutonSecondaireStyle} onClick={() => setTrimestre(q)}>T{q}</button>
                  ))}
                  <span style={{ flex: 1 }} />
                  <button style={boutonSecondaireStyle} onClick={() => api.fiscaliteRetenuesTrimestreExporter(annee, trimestre, "pdf").catch((e) => setErreur(e.message))}>PDF</button>
                  <button style={boutonSecondaireStyle} onClick={() => api.fiscaliteRetenuesTrimestreExporter(annee, trimestre, "xlsx").catch((e) => setErreur(e.message))}>Excel</button>
                </div>
                {!etatTrim && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}
                {etatTrim && (
                  <>
                    {etatTrim.identite_incomplete > 0 && <p style={{ fontSize: 12.3, color: "var(--brique)", marginBottom: 8 }}>{etatTrim.identite_incomplete} {t("fiscRsIdentiteIncomplete")}</p>}
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>{t("fiscRsColBeneficiaire")}</th>
                          <th style={thStyle}>{t("fiscRsColProfession")}</th>
                          <th style={thStyle}>{t("fiscRsColAdresse")}</th>
                          <th style={thStyle}>{t("fiscRsColIdentite")}</th>
                          <th style={thStyle}>{t("fiscRsColType")}</th>
                          <th style={thStyle}>{t("fiscRsColPeriode")}</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscRsTotalVerse")}</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscRsImpotRetenu")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {etatTrim.lignes.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={8}>{t("fiscRsAucunVersement")}</td></tr>}
                        {etatTrim.lignes.map((l, i) => (
                          <tr key={i}>
                            <td style={{ ...tdStyle, fontWeight: 700 }}>{l.nom}</td>
                            <td style={tdStyle}>{l.profession || ""}</td>
                            <td style={tdStyle}>{l.adresse || ""}</td>
                            <td style={{ ...tdStyle, color: l.identite_incomplete ? "var(--brique)" : "inherit" }}>{l.ninea || l.piece || "—"}</td>
                            <td style={{ ...tdStyle, fontSize: 12 }}>{t(`fiscRsType_${l.type}`)}</td>
                            <td style={{ ...tdStyle, fontSize: 12, whiteSpace: "nowrap" }}>{dateCourte(l.premiere, locale)} → {dateCourte(l.derniere, locale)}</td>
                            <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(l.montant_brut)}</td>
                            <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mm(l.retenue)}</td>
                          </tr>
                        ))}
                        {etatTrim.lignes.length > 0 && (
                          <tr>
                            <td style={{ ...tdStyle, fontWeight: 700 }} colSpan={6}>Total</td>
                            <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mm(etatTrim.totaux.montant_brut)}</td>
                            <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mm(etatTrim.totaux.retenue)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}

            {onglet === "rapprochement" && (
              <>
                <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscRsRapproAide")}</p>
                {!rapprochement && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}
                {rapprochement && (
                  <>
                    <p style={{ fontSize: 12.3, marginBottom: 10 }}>{t(`fiscRsRapproSource_${rapprochement.source}`)}</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 14 }}>
                      {bloc(t("fiscRsCalcule"), mm(rapprochement.calcule))}
                      {bloc(t("fiscRsComptabilise"), mm(rapprochement.comptabilise))}
                      {bloc(t("fiscRsEcart"), mm(rapprochement.ecart), rapprochement.source !== "AUCUNE" && Math.abs(rapprochement.ecart) > 1 ? "var(--brique)" : "#2E7D5B")}
                      {bloc(t("fiscRsVerse"), mm(rapprochement.verse))}
                    </div>
                    {rapprochement.lignes.length > 0 && (
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                        <thead>
                          <tr>
                            <th style={thStyle}>{t("fiscRsColDate")}</th>
                            <th style={thStyle}>{t("fiscRsColCompte")}</th>
                            <th style={thStyle}>{t("fiscRsColPiece")}</th>
                            <th style={thStyle}>{t("fiscRsColLibelle")}</th>
                            <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscRsColDebit")}</th>
                            <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscRsColCredit")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rapprochement.lignes.map((l, i) => (
                            <tr key={i}>
                              <td style={tdStyle}>{dateCourte(l.date, locale)}</td>
                              <td style={tdStyle}>{l.compte}</td>
                              <td style={tdStyle}>{l.piece || ""}</td>
                              <td style={tdStyle}>{l.libelle || ""}</td>
                              <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.debit ? mm(l.debit) : ""}</td>
                              <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.credit ? mm(l.credit) : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </>
            )}

            {onglet === "import" && (
              <>
                <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscRsImportAide")}</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                  <button style={boutonSecondaireStyle} onClick={() => api.fiscaliteRetenuesModele().catch((e) => setErreur(e.message))}>{t("fiscRsModele")}</button>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { setFichier(e.target.files[0] || null); setApercu(null); setResultatImport(null); }} style={{ fontSize: 12 }} />
                  <button style={{ ...boutonSecondaireStyle, opacity: fichier ? 1 : 0.5 }} disabled={!fichier} onClick={analyserFichier}>{t("fiscRsApercu")}</button>
                  <button style={{ ...boutonPrincipalStyle, opacity: fichier && !gele ? 1 : 0.5 }} disabled={!fichier || gele} onClick={importerFichier}>{t("fiscRsImporter")}</button>
                </div>
                {resultatImport && (
                  <p style={{ fontSize: 12.5, color: "#2E7D5B", marginBottom: 10 }}>
                    {resultatImport.importees} {t("fiscRsImportResultat")}
                    {resultatImport.verrouillees.length > 0 ? ` ${resultatImport.verrouillees.length} ${t("fiscRsImportVerrouillees")}` : ""}
                  </p>
                )}
                {apercu && (
                  <>
                    <p style={{ fontSize: 12.5, marginBottom: 8 }}>
                      {apercu.nb_lignes} {t("fiscRsImportLignes")} · {t("fiscRsImportRetenue")} : <strong>{mm(apercu.total_retenues)} XOF</strong>
                    </p>
                    {apercu.erreurs.length > 0 && (
                      <div className="card" style={{ marginBottom: 10, borderLeft: "3px solid var(--brique)", fontSize: 12.3 }}>
                        <strong>{t("fiscRsImportErreurs")} ({apercu.nb_erreurs})</strong>
                        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                          {apercu.erreurs.map((e, i) => <li key={i}>{t("fiscRsColLigne")} {e.ligne} : {e.champs.join(", ")}</li>)}
                        </ul>
                      </div>
                    )}
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>{t("fiscRsColLigne")}</th>
                          <th style={thStyle}>{t("fiscRsColDate")}</th>
                          <th style={thStyle}>{t("fiscRsColType")}</th>
                          <th style={thStyle}>{t("fiscRsColBeneficiaire")}</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscRsColBrut")}</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscRsColRetenue")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apercu.lignes.map((l) => (
                          <tr key={l.ligne}>
                            <td style={tdStyle}>{l.ligne}</td>
                            <td style={tdStyle}>{dateCourte(l.date_operation, locale)}</td>
                            <td style={{ ...tdStyle, fontSize: 12 }}>{t(`fiscRsType_${l.type}`)}</td>
                            <td style={tdStyle}>{l.beneficiaire_nom}</td>
                            <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(l.montant_brut)}</td>
                            <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mm(l.calcul.retenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}

            {form && (onglet === "operations" || onglet === "propositions") && (
              <form onSubmit={enregistrer} style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                {champ(t("fiscRsChampType"), (
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, beneficiaire_statut: e.target.value === "NON_RESIDENT" ? "NON_RESIDENT" : e.target.value === "PRESTATION_PP" ? "PP_SANS_REEL" : form.beneficiaire_statut })} style={{ ...inputStyle, width: 290 }}>
                    {TYPES.map((x) => <option key={x} value={x}>{t(`fiscRsType_${x}`)}</option>)}
                  </select>
                ))}
                {champ(t("fiscRsChampDate"), <input type="date" value={form.date_operation} onChange={(e) => setForm({ ...form, date_operation: e.target.value })} style={{ ...inputStyle, width: 150 }} required />)}
                {champ(t("fiscRsChampBeneficiaire"), <input value={form.beneficiaire_nom} onChange={(e) => setForm({ ...form, beneficiaire_nom: e.target.value })} style={{ ...inputStyle, width: 220 }} required />)}
                {champ(t("fiscRsChampNinea"), <input value={form.beneficiaire_ninea} onChange={(e) => setForm({ ...form, beneficiaire_ninea: e.target.value })} style={{ ...inputStyle, width: 140 }} />)}
                {champ(t("fiscRsChampStatutBenef"), (
                  <select value={form.beneficiaire_statut} onChange={(e) => setForm({ ...form, beneficiaire_statut: e.target.value })} style={{ ...inputStyle, width: 250 }}>
                    {STATUTS_BENEF.map((x) => <option key={x} value={x}>{t(`fiscRsStatut_${x}`)}</option>)}
                  </select>
                ))}
                {champ(t("fiscRsChampPiece"), <input value={form.beneficiaire_piece} onChange={(e) => setForm({ ...form, beneficiaire_piece: e.target.value })} style={{ ...inputStyle, width: 200 }} />)}
                {champ(t("fiscRsChampProfession"), <input value={form.beneficiaire_profession} onChange={(e) => setForm({ ...form, beneficiaire_profession: e.target.value })} style={{ ...inputStyle, width: 160 }} />)}
                {champ(t("fiscRsChampAdresse"), <input value={form.beneficiaire_adresse} onChange={(e) => setForm({ ...form, beneficiaire_adresse: e.target.value })} style={{ ...inputStyle, width: 220 }} />)}
                {champ(t("fiscRsChampReference"), <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} style={{ ...inputStyle, width: 150 }} />)}
                {champ(t("fiscRsChampLibelle"), <input value={form.libelle} onChange={(e) => setForm({ ...form, libelle: e.target.value })} style={{ ...inputStyle, width: 240 }} />)}
                {champ(t("fiscRsChampBrut"), <input type="number" min="0" step="1" value={form.montant_brut} onChange={(e) => setForm({ ...form, montant_brut: e.target.value })} style={{ ...inputStyle, width: 140, textAlign: "right" }} required />)}
                {form.type === "PRESTATION_PP" && champ(t("fiscRsChampFacture"), <input type="number" min="0" step="1" value={form.montant_facture} onChange={(e) => setForm({ ...form, montant_facture: e.target.value })} style={{ ...inputStyle, width: 140, textAlign: "right" }} />)}
                {form.type === "LOYER" && champ(t("fiscRsChampLoyer"), <input type="number" min="0" step="1" value={form.loyer_mensuel} onChange={(e) => setForm({ ...form, loyer_mensuel: e.target.value })} style={{ ...inputStyle, width: 140, textAlign: "right" }} />)}
                {champ(t("fiscRsChampTaux"), <input type="number" min="0" max="100" step="0.01" value={form.taux_applique} onChange={(e) => setForm({ ...form, taux_applique: e.target.value })} style={{ ...inputStyle, width: 120, textAlign: "right" }} />)}
                {champ(t("fiscRsChampEffectuee"), <input type="number" min="0" step="1" value={form.retenue_effectuee} onChange={(e) => setForm({ ...form, retenue_effectuee: e.target.value })} style={{ ...inputStyle, width: 140, textAlign: "right" }} />)}
                {form.id && (form.source === "PLATEFORME" || form.source === "CCA") &&
                  champ(t("fiscRsChampStatutLigne"), (
                    <select value={form.statut} onChange={(e) => setForm({ ...form, statut: e.target.value })} style={{ ...inputStyle, width: 150 }}>
                      {["PROPOSEE", "CONFIRMEE", "EXCLUE"].map((x) => <option key={x} value={x}>{t(`fiscRsStatutLigne_${x}`)}</option>)}
                    </select>
                  ))}
                <button type="submit" style={boutonPrincipalStyle}>{t("fiscEnregistrer")}</button>
                <button type="button" style={boutonSecondaireStyle} onClick={() => setForm(null)}>{t("fiscAnnuler")}</button>
              </form>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
