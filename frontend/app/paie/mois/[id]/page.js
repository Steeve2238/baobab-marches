"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import PaieSousNav from "../../../../lib/components/PaieSousNav";
import BulletinVue from "../../../../lib/components/paie/BulletinVue";
import ArchivePeriode from "../../../../lib/components/paie/ArchivePeriode";
import { Pastille, Champ, inputStyle, boutonPrincipal, boutonLeger, boutonDanger, cellule, enteteCellule, droite, fmt, fmtDec, useStatut, Statut, tonStatut } from "../../../../lib/components/paieUi";

const tonNiveau = { BLOQUANT: "erreur", ATTENTION: "alerte", INFO: "neutre" };

function Contenu() {
  const { t, langue } = useLangue();
  const { id } = useParams();
  const params = useSearchParams();
  const router = useRouter();
  const [d, setD] = useState(null);
  const [onglet, setOnglet] = useState(params.get("tab") || "synthese");
  const [choisi, setChoisi] = useState(params.get("employe") || "");
  const [panneau, setPanneau] = useState(null);
  const [motif, setMotif] = useState("");
  const s = useStatut();

  const charger = () => api.paiePeriode(id).then(setD).catch(s.ko);
  useEffect(() => { charger(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!d) return <AppShell title={t("paiePeriodesTitre")} subNav={<PaieSousNav />}><Statut s={s} /><p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p></AppShell>;
  const p = d.periode;
  const ouverte = p.statut === "OUVERTE";
  const validee = p.statut === "VALIDEE";
  const cloturee = p.statut === "CLOTUREE";
  const titre = `${t(`paieMoisNom_${p.mois}`)} ${p.annee}`;

  async function recalculer() {
    s.raz();
    try { await api.paieGenerer(id); s.ok(t("paieRecalcule")); await charger(); } catch (e) { s.ko(e); }
  }
  async function annuler() {
    if (!window.confirm(t("paieAnnulerConfirme"))) return;
    s.raz();
    try { await api.paieAnnulerPeriode(id); router.push("/paie/mois"); } catch (e) { s.ko(e); }
  }

  async function action(fn, message) {
    s.raz();
    try { const r = await fn(); setPanneau(null); setMotif(""); s.ok(message(r)); await charger(); } catch (e) { s.ko(e); setPanneau(null); }
  }
  const valider = () => action(() => api.paieValider(id), () => t("paieValidee"));
  const rouvrir = () => action(() => api.paieRouvrir(id, motif), () => t("paieRouverte"));
  const cloturer = () => action(() => api.paieCloturer(id), (r) => t("paieCloturee").replace("{n}", r.nb_fichiers) + (r.comptabilite && r.comptabilite.statut === "ECHEC" ? " " + t("paieComptaEchec") : r.comptabilite && r.comptabilite.statut === "CREEE" ? " " + t("paieComptaCreee") : ""));

  const onglets = [["synthese", t("paieOngSynthese")], ["bulletins", t("paieOngBulletins")], ["etats", t("paieOngEtats")], ["virement", t("paieOngVirement")], ...(cloturee ? [["archive", t("paieOngArchive")]] : [])];
  const ov = d.ordre_virement;
  const ovPret = !ov || !ov.requis || (ov.present && ov.coherent);
  const bloque = d.controles.bloquants > 0 || d.controles.nb_bulletins === 0;

  return (
    <AppShell title={`${t("paiePeriodesTitre")} — ${titre}`} subNav={<PaieSousNav />}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <Link href="/paie/mois" style={{ fontSize: 12.5, color: "var(--petrol)" }}>← {t("paiePeriodesTitre")}</Link>
        <Pastille ton={tonStatut[p.statut]}>{t(`paieStatutPeriode_${p.statut}`)}</Pastille>
        <span style={{ flex: 1 }} />
        {ouverte && <Link href={`/paie/variables?periode=${id}`} style={{ ...boutonLeger, textDecoration: "none" }}>{t("paieSaisirVariables")}</Link>}
        {ouverte && <button style={boutonLeger} onClick={recalculer}>{t("paieRecalculer")}</button>}
        {ouverte && d.droit_validation && <button style={boutonDanger} onClick={annuler}>{t("paieAnnulerOuverture")}</button>}
        {ouverte && d.droit_validation && <button style={{ ...boutonPrincipal, opacity: bloque ? 0.5 : 1 }} disabled={bloque} title={bloque ? t("paieValiderBloque") : ""} onClick={() => setPanneau("valider")}>{t("paieValider")}</button>}
        {validee && d.droit_validation && <button style={boutonLeger} onClick={() => setPanneau("rouvrir")}>{t("paieRouvrir")}</button>}
        {validee && d.droit_validation && <button style={{ ...boutonPrincipal, opacity: ovPret ? 1 : 0.5 }} disabled={!ovPret} title={ovPret ? "" : t(ov && ov.present ? "paieOvObsolete" : "paieOvAGenerer")} onClick={() => setPanneau("cloturer")}>{t("paieCloturer")}</button>}
      </div>
      <Statut s={s} />
      {panneau === "valider" && (
        <div className="card" style={{ marginBottom: 14, maxWidth: 760 }}>
          <h3 style={{ fontSize: 13.5, margin: "0 0 6px" }}>{t("paieValiderConfirme")}</h3>
          <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "0 0 10px", lineHeight: 1.5 }}>{t("paieValiderAide")}</p>
          <div style={{ display: "flex", gap: 8 }}><button style={boutonPrincipal} onClick={valider}>{t("paieValider")}</button><button style={boutonLeger} onClick={() => setPanneau(null)}>{t("paieAnnulerAction")}</button></div>
        </div>
      )}
      {panneau === "rouvrir" && (
        <div className="card" style={{ marginBottom: 14, maxWidth: 760 }}>
          <h3 style={{ fontSize: 13.5, margin: "0 0 6px" }}>{t("paieRouvrirTitre")}</h3>
          <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "0 0 10px", lineHeight: 1.5 }}>{t("paieRouvrirAide")}</p>
          <Champ label={t("paieMotif")}><textarea style={{ ...inputStyle, minHeight: 60 }} value={motif} onChange={(e) => setMotif(e.target.value)} /></Champ>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button style={boutonPrincipal} disabled={motif.trim().length < 5} onClick={rouvrir}>{t("paieConfirmerRouvrir")}</button><button style={boutonLeger} onClick={() => setPanneau(null)}>{t("paieAnnulerAction")}</button></div>
        </div>
      )}
      {panneau === "cloturer" && (
        <div className="card" style={{ marginBottom: 14, maxWidth: 760, borderColor: "var(--petrol)" }}>
          <h3 style={{ fontSize: 13.5, margin: "0 0 6px" }}>{t("paieCloturerTitre")}</h3>
          <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "0 0 10px", lineHeight: 1.5 }}>{t("paieCloturerAide")}</p>
          <div style={{ display: "flex", gap: 8 }}><button style={boutonPrincipal} onClick={cloturer}>{t("paieConfirmerCloture")}</button><button style={boutonLeger} onClick={() => setPanneau(null)}>{t("paieAnnulerAction")}</button></div>
        </div>
      )}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: "1px solid var(--line-soft)", marginBottom: 14 }}>
        {onglets.map(([k, l]) => <button key={k} onClick={() => setOnglet(k)} style={{ border: "none", background: "none", padding: "8px 14px", fontSize: 13, cursor: "pointer", fontWeight: onglet === k ? 700 : 500, color: onglet === k ? "var(--petrol)" : "var(--sub)", borderBottom: onglet === k ? "2px solid var(--petrol)" : "2px solid transparent" }}>{l}</button>)}
      </div>

      {onglet === "synthese" && <Synthese d={d} t={t} periodeId={id} s={s} />}
      {onglet === "archive" && <ArchivePeriode periodeId={id} t={t} />}
      {onglet === "bulletins" && <Bulletins d={d} periodeId={id} choisi={choisi} setChoisi={setChoisi} t={t} />}
      {onglet === "etats" && <Etats periodeId={id} p={p} t={t} langue={langue} />}
      {onglet === "virement" && <Virement periodeId={id} ouverte={ouverte || validee} p={p} ov={ov} t={t} recharger={charger} />}
    </AppShell>
  );
}

function Synthese({ d, t, periodeId, s }) {
  const c = d.controles;
  const carte = (libelle, valeur) => (
    <div className="card" style={{ minWidth: 150 }}><div style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 4 }}>{libelle}</div><div style={{ fontSize: 19, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{valeur}</div></div>
  );
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        {carte(t("paieSalariesPayes"), `${c.nb_bulletins} / ${c.nb_salaries}`)}
        {carte(t("paieBrutTotal"), fmt(d.totaux.brut))}
        {carte(t("paieNetTotal"), `${fmt(d.totaux.net)} F`)}
        {carte(t("paieIrTrimfTotal"), fmt(d.totaux.ir + d.totaux.trimf))}
        {carte(t("paieChargesTotal"), fmt(d.totaux.charges))}
      </div>
      <div className="card">
        <h3 style={{ fontSize: 13.5, margin: "0 0 8px" }}>{t("paieControles")}</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <Pastille ton={c.bloquants ? "erreur" : "ok"}>{c.bloquants} {t("paieAvert_BLOQUANT").toLowerCase()}</Pastille>
          <Pastille ton={c.attentions ? "alerte" : "ok"}>{c.attentions} {t("paieAvert_ATTENTION").toLowerCase()}</Pastille>
          <Pastille ton="neutre">{c.infos} {t("paieAvert_INFO").toLowerCase()}</Pastille>
        </div>
        {c.items.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("paieControlesOk")}</p> : c.items.map((i, k) => (
          <div key={k} style={{ fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--line-soft)", display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <Pastille ton={tonNiveau[i.niveau]}>{t(`paieAvert_${i.niveau}`)}</Pastille>
            {i.nom && <b>{i.nom}</b>}
            <span>{t(`paieAvert_${i.code}`)}{i.valeur ? ` (${i.valeur})` : ""}</span>
            {i.code === "DOSSIER_INCOMPLET" && <Link href={`/paie/dossiers/${i.employe_id}`} style={{ color: "var(--petrol)", fontSize: 12 }}>{t("paieCompleterDossier")}</Link>}
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0, lineHeight: 1.5 }}>
        {d.periode.statut === "OUVERTE" && (c.bloquants ? t("paieValiderBloque") : t("paieValiderAide"))}
        {d.periode.statut === "VALIDEE" && t("paieValideeAide")}
        {d.periode.statut === "CLOTUREE" && t("paieClotureeAide").replace("{date}", d.periode.date_cloture ? new Date(d.periode.date_cloture).toLocaleDateString() : "")}
      </p>
      {d.periode.statut === "VALIDEE" && d.ordre_virement && d.ordre_virement.requis && (
        <Pastille ton={d.ordre_virement.present && d.ordre_virement.coherent ? "ok" : "alerte"}>
          {!d.ordre_virement.present ? t("paieOvAGenerer") : !d.ordre_virement.coherent ? t("paieOvObsolete") : `${t("paieOvPret")} (${d.ordre_virement.numero})`}
        </Pastille>
      )}
      {d.periode.statut !== "OUVERTE" && <ComptaPaie periodeId={periodeId} t={t} droit={d.droit_validation} s={s} />}
      {d.periode.motif_reouverture && d.periode.statut === "OUVERTE" && <p style={{ fontSize: 12, color: "var(--sub)", margin: 0 }}>{t("paieMotifReouverture")} : {d.periode.motif_reouverture}</p>}
    </div>
  );
}

function ComptaPaie({ periodeId, t, droit, s }) {
  const [a, setA] = useState(null);
  const charger = () => api.paieComptabilite(periodeId).then(setA).catch(() => {});
  useEffect(() => { charger(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodeId]);
  if (!a) return null;
  const e = a.comptabilite.ecriture;
  async function comptabiliser() {
    s.raz();
    try { await api.paieComptabiliser(periodeId); s.ok(t("paieComptabilisee")); await charger(); } catch (x) { s.ko(x); }
  }
  return (
    <div className="card">
      <h3 style={{ fontSize: 13.5, margin: "0 0 6px" }}>{t("paieCompta")}</h3>
      <p style={{ fontSize: 12, color: "var(--sub)", margin: "0 0 10px", lineHeight: 1.5 }}>{t("paieComptaAide")}</p>
      {!a.comptabilite.actif ? <p style={{ fontSize: 12.5, margin: 0 }}>{t("paieComptaInactive")}</p> : (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            {e ? <Pastille ton={e.statut === "VALIDEE" ? "ok" : "alerte"}>{t("paieComptaEcriture")} {e.numero_piece} — {e.statut === "VALIDEE" ? t("paieComptaValidee") : t("paieComptaEnInstance")}</Pastille>
               : droit && <button style={boutonPrincipal} onClick={comptabiliser}>{t("paieComptabiliser")}</button>}
            {a.ecart_arrondi !== 0 && <span style={{ fontSize: 12, color: "var(--sub)" }}>{t("paieEcartArrondi").replace("{n}", fmt(a.ecart_arrondi))}</span>}
          </div>
          {!e && a.comptes_manquants.length > 0 && <p style={{ fontSize: 12.5, color: "var(--brique, #b42318)", margin: "0 0 10px" }}>{t("paieComptaManquants").replace("{liste}", a.comptes_manquants.join(", "))}</p>}
          <details>
            <summary style={{ fontSize: 12.5, cursor: "pointer", color: "var(--petrol)" }}>{t("paieComptaApercu")}</summary>
            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                <thead><tr><th style={enteteCellule}>{t("paieComptaCompte")}</th><th style={enteteCellule}>{t("paieComptaLibelle")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieComptaDebit")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieComptaCredit")}</th></tr></thead>
                <tbody>
                  {a.lignes.map((l) => <tr key={l.cle + l.debit + l.credit}><td style={cellule}>{l.numero || l.compte}</td><td style={cellule}>{l.libelle}</td><td style={{ ...cellule, ...droite }}>{l.debit ? fmt(l.debit) : ""}</td><td style={{ ...cellule, ...droite }}>{l.credit ? fmt(l.credit) : ""}</td></tr>)}
                  <tr><td style={{ ...cellule, fontWeight: 700 }} colSpan={2}>{t("paieTotal")}</td><td style={{ ...cellule, ...droite, fontWeight: 700 }}>{fmt(a.total)}</td><td style={{ ...cellule, ...droite, fontWeight: 700 }}>{fmt(a.total)}</td></tr>
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function Bulletins({ d, periodeId, choisi, setChoisi, t }) {
  const [b, setB] = useState(null);
  const s = useStatut();
  useEffect(() => {
    setB(null);
    if (choisi) api.paieBulletin(periodeId, choisi).then(setB).catch(s.ko);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choisi, periodeId]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: choisi ? "minmax(340px, 1fr) minmax(420px, 1.3fr)" : "1fr", gap: 14, alignItems: "start" }} className="paie-bul">
      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        {d.bulletins.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--sub)", padding: 14, margin: 0 }}>{t("paieAucunBulletin")}</p> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={enteteCellule}>{t("paieSalarie")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieBullBrut")}</th>
              <th style={{ ...enteteCellule, ...droite }}>{t("paieBullTotalRetenues")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieBullNet")}</th><th style={enteteCellule}></th>
            </tr></thead>
            <tbody>
              {d.bulletins.map((x) => (
                <tr key={x.id} style={{ background: choisi === x.employe_id ? "rgba(15,76,92,0.07)" : "transparent", cursor: "pointer" }} onClick={() => setChoisi(x.employe_id)}>
                  <td style={cellule}><b>{x.nom} {x.prenom}</b><div style={{ fontSize: 11, color: "var(--sub)" }}>{x.matricule}</div></td>
                  <td style={{ ...cellule, ...droite }}>{fmt(x.brut)}</td><td style={{ ...cellule, ...droite }}>{fmt(x.total_retenues)}</td>
                  <td style={{ ...cellule, ...droite, fontWeight: 700 }}>{fmt(x.net_a_payer)}</td>
                  <td style={cellule}>{x.avertissements.some((a) => a.niveau !== "INFO") && <Pastille ton="alerte">!</Pastille>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {choisi && (
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            {b && b.identite && <b style={{ fontSize: 14 }}>{b.identite.prenom} {b.identite.nom} <span style={{ fontWeight: 400, color: "var(--sub)", fontSize: 12 }}>{b.identite.matricule}</span></b>}
            <button style={boutonLeger} onClick={() => setChoisi("")}>{t("paieFermer")}</button>
          </div>
          <Statut s={s} />
          {b ? <BulletinVue b={b} t={t} /> : <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}
        </div>
      )}
      <style>{`@media (max-width: 1000px) { .paie-bul { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function Etats({ periodeId, p, t, langue }) {
  const [e, setE] = useState(null);
  const [vue, setVue] = useState("journal");
  const s = useStatut();
  useEffect(() => { api.paieEtats(periodeId).then(setE).catch(s.ko); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodeId]);
  if (!e) return <><Statut s={s} /><p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p></>;
  const vues = [["journal", t("paieEtatJournal")], ...e.organismes.map((o) => [`org:${o.section}`, orgLabel(t, o.section)]), ["impots", t("paieEtatImpots")], ["synthese", t("paieEtatSynthese")]];
  const org = vue.startsWith("org:") ? e.organismes.find((o) => `org:${o.section}` === vue) : null;
  const th = (txt, droit) => <th style={{ ...enteteCellule, ...(droit ? droite : {}) }}>{txt}</th>;
  const tot = { ...cellule, fontWeight: 700, background: "rgba(15,76,92,0.05)" };
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        {vues.map(([k, l]) => <button key={k} onClick={() => setVue(k)} style={{ ...boutonLeger, ...(vue === k ? { background: "var(--petrol)", color: "#fff", borderColor: "var(--petrol)" } : {}) }}>{l}</button>)}
        <span style={{ flex: 1 }} />
        <button style={boutonPrincipal} onClick={() => api.paieExporterEtats(periodeId, langue).catch(s.ko)}>{t("paieExporterEtats")}</button>
      </div>
      <Statut s={s} />
      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        {vue === "journal" && (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead><tr>{th(t("paieSalarie"))}{th(t("paieBullBrut"), 1)}{th(t("paieBullImposable"), 1)}{th(t("paieEtatCotSalarie"), 1)}{th("IR", 1)}{th("TRIMF", 1)}{th(t("paieEtatAutresRet"), 1)}{th(t("paieBullNet"), 1)}{th(t("paieBullTotalPatronales"), 1)}{th(t("paieBullCoutEmployeur"), 1)}</tr></thead>
            <tbody>
              {e.journal.map((x) => <tr key={x.employe_id}><td style={cellule}>{x.nom}</td>{[x.brut, x.imposable, x.cotisations_salarie, x.ir, x.trimf, x.autres_retenues, x.net_a_payer, x.charges_patronales, x.cout_employeur].map((v, i) => <td key={i} style={{ ...cellule, ...droite }}>{fmt(v)}</td>)}</tr>)}
              <tr><td style={tot}>{t("paieTotal")}</td>{["brut", "imposable", "cotisations_salarie", "ir", "trimf", "autres_retenues", "net_a_payer", "charges_patronales", "cout_employeur"].map((k) => <td key={k} style={{ ...tot, ...droite }}>{fmt(e.totaux_journal[k])}</td>)}</tr>
            </tbody>
          </table>
        )}
        {org && (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead>
              <tr><th style={enteteCellule} rowSpan={2}>{t("paieSalarie")}</th><th style={enteteCellule} rowSpan={2}>{org.section === "RETRAITE" ? t("paieNumIpresSalarie") : t("paieNumCssSalarie")}</th>{org.colonnes.map((c) => <th key={c.code} colSpan={3} style={{ ...enteteCellule, textAlign: "center" }} title={c.libelle}>{c.code}</th>)}</tr>
              <tr>{org.colonnes.map((c) => [<th key={c.code + "b"} style={{ ...enteteCellule, ...droite }}>{t("paieBase")}</th>, <th key={c.code + "s"} style={{ ...enteteCellule, ...droite }}>{t("paieSalarieCol")}</th>, <th key={c.code + "p"} style={{ ...enteteCellule, ...droite }}>{t("paiePatronal")}</th>])}</tr>
            </thead>
            <tbody>
              {org.salaries.map((x) => <tr key={x.employe_id}><td style={cellule}>{x.nom}</td><td style={cellule}>{(org.section === "RETRAITE" ? x.numero_ipres : x.numero_css) || "—"}</td>{org.colonnes.map((c) => [<td key={c.code + "b"} style={{ ...cellule, ...droite }}>{fmt(x.cotisations[c.code].base)}</td>, <td key={c.code + "s"} style={{ ...cellule, ...droite }}>{fmt(x.cotisations[c.code].salarie)}</td>, <td key={c.code + "p"} style={{ ...cellule, ...droite }}>{fmt(x.cotisations[c.code].patronal)}</td>])}</tr>)}
              <tr><td style={tot} colSpan={2}>{t("paieTotal")}</td>{org.colonnes.map((c) => [<td key={c.code + "b"} style={{ ...tot, ...droite }}>{fmt(org.totaux[c.code].base)}</td>, <td key={c.code + "s"} style={{ ...tot, ...droite }}>{fmt(org.totaux[c.code].salarie)}</td>, <td key={c.code + "p"} style={{ ...tot, ...droite }}>{fmt(org.totaux[c.code].patronal)}</td>])}</tr>
            </tbody>
          </table>
        )}
        {vue === "impots" && (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead><tr>{th(t("paieSalarie"))}{th(t("paieBullImposable"), 1)}{th(t("paiePartsIr"), 1)}{th("IR", 1)}{th(t("paiePartsTrimf"), 1)}{th("TRIMF", 1)}</tr></thead>
            <tbody>
              {e.impots.map((x) => <tr key={x.employe_id}><td style={cellule}>{x.nom}</td><td style={{ ...cellule, ...droite }}>{fmt(x.imposable)}</td><td style={{ ...cellule, ...droite }}>{fmtDec(x.parts_ir, 1)}</td><td style={{ ...cellule, ...droite }}>{fmt(x.ir)}</td><td style={{ ...cellule, ...droite }}>{fmtDec(x.parts_trimf, 1)}</td><td style={{ ...cellule, ...droite }}>{fmt(x.trimf)}</td></tr>)}
              <tr><td style={tot}>{t("paieTotal")}</td><td style={{ ...tot, ...droite }}>{fmt(e.totaux_impots.imposable)}</td><td style={tot}></td><td style={{ ...tot, ...droite }}>{fmt(e.totaux_impots.ir)}</td><td style={tot}></td><td style={{ ...tot, ...droite }}>{fmt(e.totaux_impots.trimf)}</td></tr>
            </tbody>
          </table>
        )}
        {vue === "synthese" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{th(t("paieEtatOrganisme"))}{th(t("paieEtatAPayer"), 1)}</tr></thead>
            <tbody>{e.synthese.map((x) => <tr key={x.code}><td style={cellule}>{x.code === "IR" ? t("paieEtatIrRetenu") : x.code === "TRIMF" ? "TRIMF" : orgLabel(t, x.code)}</td><td style={{ ...cellule, ...droite, fontWeight: 700 }}>{fmt(x.a_payer)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
const orgLabel = (t, section) => { const k = `paieOrg_${section}`; const v = t(k); return v === k ? section : v; };

function Virement({ periodeId, ouverte, p, ov, t, recharger }) {
  const [f, setF] = useState({ date_execution: "", banque_donneur: "", compte_donneur: "" });
  const [res, setRes] = useState(null);
  const s = useStatut();
  useEffect(() => {
    api.paieReglages().then((r) => setF((x) => ({ ...x, banque_donneur: r.banque_donneur || "", compte_donneur: r.compte_donneur || "" }))).catch(() => {});
  }, []);
  async function generer() {
    s.raz();
    try { const r = await api.paieOrdreVirement(periodeId, { date_execution: f.date_execution || undefined, banque_donneur: f.banque_donneur, compte_donneur: f.compte_donneur }); setRes(r); s.ok(t("paieOvGenere")); recharger && recharger(); } catch (e) { s.ko(e); }
  }
  const maj = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h3 style={{ fontSize: 13.5, margin: "0 0 6px" }}>{t("paieOvTitre")}</h3>
      <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "0 0 12px", lineHeight: 1.5 }}>{t("paieOvAide")}</p>
      <Statut s={s} />
      {p.ordre_virement_id && !res && <p style={{ fontSize: 12.5, margin: "0 0 10px" }}>{t("paieOvExiste")} <Link href={`/rh/ordres-virement/${p.ordre_virement_id}`} style={{ color: "var(--petrol)" }}>{t("paieOvVoir")} →</Link></p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, marginBottom: 12 }}>
        <Champ label={t("paieOvDate")}><input type="date" style={inputStyle} value={f.date_execution} onChange={maj("date_execution")} /></Champ>
        <Champ label={t("paieOvBanque")}><input style={inputStyle} value={f.banque_donneur} onChange={maj("banque_donneur")} /></Champ>
        <Champ label={t("paieOvCompte")}><input style={inputStyle} value={f.compte_donneur} onChange={maj("compte_donneur")} /></Champ>
      </div>
      {ouverte ? <button style={boutonPrincipal} onClick={generer}>{p.ordre_virement_id || res ? t("paieOvRegenerer") : t("paieOvGenerer")}</button> : null}
      {res && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line-soft)", fontSize: 12.5 }}>
          <div><b>{res.ordre.numero}</b> — {res.ordre.nb_lignes} {t("paieOvLignes")} — <b>{fmt(res.ordre.total)} F</b> <Link href={`/rh/ordres-virement/${res.ordre.id}`} style={{ color: "var(--petrol)", marginLeft: 8 }}>{t("paieOvVoir")} →</Link></div>
          {res.exclus.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ color: "var(--sub)", marginBottom: 4 }}>{t("paieOvExclus")}</div>
              {res.exclus.map((x, i) => <div key={i}>{x.nom} — {x.raison === "NET_NUL" ? t("paieOvNetNul") : `${t("paieOvModePaiement")} : ${x.valeur}`}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PeriodePage() {
  return (
    <Suspense fallback={null}>
      <Contenu />
    </Suspense>
  );
}
