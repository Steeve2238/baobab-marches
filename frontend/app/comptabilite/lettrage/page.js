"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import { useComptaStatut, labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, thStyle, tdStyle, numStyle, formaterMontant, centimes, STATUT_COULEURS, statutLibelleCle } from "../../../lib/comptaUi";

const jour = (d) => String(d || "").slice(0, 10);

// Lettrage : on coche des lignes d'un meme tiers et d'un meme compte dont le
// total debit egale le total credit ; elles recoivent un code (AA, AB...).
export default function ComptaLettragePage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const { statut } = useComptaStatut();
  const [type, setType] = useState("CLIENT");
  const [tiersListe, setTiersListe] = useState([]);
  const [tiersId, setTiersId] = useState("");
  const [etat, setEtat] = useState("NON_LETTREES");
  const [lignes, setLignes] = useState([]);
  const [coches, setCoches] = useState({});
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    setTiersId("");
    setLignes([]);
    setCoches({});
    api.comptaTiers({ type }).then(setTiersListe).catch((e) => setErreur(e.message));
  }, [type]);

  async function charger(id = tiersId, e = etat) {
    setCoches({});
    if (!id) return setLignes([]);
    try {
      const r = await api.comptaLettrageLignes({ tiers_id: id, etat: e });
      setLignes(r.lignes);
    } catch (err) {
      setErreur(err.message);
    }
  }
  useEffect(() => {
    charger();
  }, [tiersId, etat]); // eslint-disable-line react-hooks/exhaustive-deps

  const selection = useMemo(() => lignes.filter((l) => coches[l.id]), [lignes, coches]);
  const totalD = selection.reduce((a, l) => a + centimes(l.debit), 0);
  const totalC = selection.reduce((a, l) => a + centimes(l.credit), 0);
  const comptes = new Set(selection.map((l) => l.compte_id));
  const toutesValidees = selection.every((l) => l.statut === "VALIDEE" && !l.lettrage);
  const equilibre = selection.length >= 2 && totalD === totalC && comptes.size === 1 && toutesValidees;
  const m = (v) => formaterMontant(v, locale, true);
  const mc = (c) => formaterMontant(c / 100, locale, false);
  const peutEcrire = !!statut?.droits?.ecriture && statut?.initialisee;

  async function lettrer() {
    setErreur("");
    setInfo("");
    setEnvoi(true);
    try {
      const r = await api.comptaLettrer(selection.map((l) => l.id));
      setInfo(`${t("comptaLettrageFait")} ${r.code} (${r.nb_lignes})`);
      await charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnvoi(false);
    }
  }

  async function delettrer(code) {
    if (!window.confirm(`${t("comptaLettrageDelettrerConfirm")} ${code} ?`)) return;
    setErreur("");
    try {
      await api.comptaDelettrer(code);
      setInfo(`${t("comptaLettrageDelettre")} ${code}`);
      await charger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function automatique() {
    setErreur("");
    setInfo("");
    setEnvoi(true);
    try {
      const r = await api.comptaLettrageAuto();
      setInfo(r.groupes > 0 ? `${r.groupes} ${t("comptaLettrageAutoGroupes")} (${r.lignes})` : t("comptaLettrageAutoRien"));
      await charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <AppShell title={t("comptaLettrageTitre")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 780, lineHeight: 1.5 }}>{t("comptaLettrageAide")}</p>

      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: 6 }} role="tablist">
          {[["CLIENT", "comptaCoteClients"], ["FOURNISSEUR", "comptaCoteFournisseurs"]].map(([c, cle]) => (
            <button key={c} role="tab" aria-selected={type === c} onClick={() => setType(c)} style={{ ...boutonSecondaireStyle, ...(type === c ? { background: "var(--petrol)", color: "#fff", borderColor: "var(--petrol)" } : {}) }}>{t(cle)}</button>
          ))}
        </div>
        <div style={{ minWidth: 240 }}>
          <label style={labelStyle}>{t(type === "CLIENT" ? "comptaEncClient" : "comptaAchatsFournisseur")}</label>
          <select value={tiersId} onChange={(e) => setTiersId(e.target.value)} style={inputStyle}>
            <option value="">{t("comptaChoisir")}</option>
            {tiersListe.map((x) => (
              <option key={x.id} value={x.id}>{x.code} — {x.nom}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("comptaLettrageEtat")}</label>
          <select value={etat} onChange={(e) => setEtat(e.target.value)} style={{ ...inputStyle, width: 170 }}>
            <option value="NON_LETTREES">{t("comptaLettrageNonLettrees")}</option>
            <option value="LETTREES">{t("comptaLettrageLettrees")}</option>
            <option value="TOUTES">{t("comptaLettrageToutes")}</option>
          </select>
        </div>
        <span style={{ flex: 1 }} />
        {peutEcrire && <button style={boutonSecondaireStyle} disabled={envoi} onClick={automatique}>{t("comptaLettrageAuto")}</button>}
      </div>

      {tiersId && (
        <>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
              <thead>
                <tr>
                  <th style={thStyle}></th>
                  <th style={thStyle}>{t("comptaDate")}</th>
                  <th style={thStyle}>{t("comptaJournal")}</th>
                  <th style={thStyle}>{t("comptaLettragePiece")}</th>
                  <th style={thStyle}>{t("comptaLettrageLibelle")}</th>
                  <th style={thStyle}>{t("comptaAchatsEcheance")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaDebit")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaCredit")}</th>
                  <th style={thStyle}>{t("comptaLettrageCode")}</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => {
                  const lettrable = !l.lettrage && l.statut === "VALIDEE";
                  return (
                    <tr key={l.id} style={{ background: coches[l.id] ? "var(--vert-bg)" : undefined }}>
                      <td style={tdStyle}>
                        <input type="checkbox" disabled={!lettrable || !peutEcrire} checked={!!coches[l.id]} onChange={(e) => setCoches((c) => ({ ...c, [l.id]: e.target.checked }))} aria-label={l.numero_piece || l.ecriture_libelle} />
                      </td>
                      <td style={tdStyle}>{jour(l.date_ecriture)}</td>
                      <td style={tdStyle}>{l.journal_code}</td>
                      <td style={tdStyle}>
                        <Link href={`/comptabilite/ecritures/${l.ecriture_id}`} style={{ color: "var(--petrol)" }}>{l.numero_piece || l.numero_ecriture || "—"}</Link>
                        {l.statut !== "VALIDEE" && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 20, ...STATUT_COULEURS[l.statut] }}>{t(statutLibelleCle(l.statut))}</span>}
                      </td>
                      <td style={tdStyle}>{l.ecriture_libelle}</td>
                      <td style={tdStyle}>{jour(l.date_echeance)}</td>
                      <td style={{ ...tdStyle, ...numStyle }}>{m(l.debit)}</td>
                      <td style={{ ...tdStyle, ...numStyle }}>{m(l.credit)}</td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                        {l.lettrage && (
                          <>
                            <strong style={{ fontFamily: "IBM Plex Mono, monospace" }}>{l.lettrage}</strong>
                            {peutEcrire && <button style={{ ...boutonSecondaireStyle, padding: "2px 8px", marginLeft: 8 }} onClick={() => delettrer(l.lettrage)}>{t("comptaLettrageDelettrer")}</button>}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ ...tdStyle, color: "var(--sub)" }}>{t("comptaLettrageAucune")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {peutEcrire && (
            <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap", marginTop: 12, fontSize: 12.5 }}>
              <span>{t("comptaLettrageSelection")} : <strong>{selection.length}</strong></span>
              <span>{t("comptaDebit")} : <strong>{mc(totalD)}</strong></span>
              <span>{t("comptaCredit")} : <strong>{mc(totalC)}</strong></span>
              <span>{t("comptaLettrageEcart")} : <strong style={{ color: totalD === totalC ? "var(--vert)" : "var(--brique)" }}>{mc(totalD - totalC)}</strong></span>
              <button disabled={!equilibre || envoi} style={{ ...boutonPrincipalStyle, opacity: !equilibre || envoi ? 0.5 : 1 }} onClick={lettrer}>{t("comptaLettrageLettrer")}</button>
              {selection.length > 0 && !toutesValidees && <span style={{ color: "var(--ocre)" }}>{t("comptaLettrageValideesSeules")}</span>}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
