"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";

const fmt = (n) => (Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Carte "Comptabilite" d'une reception validee : creation de la facture du
// fournisseur (marchandises) et d'une facture par transitaire (couts d'approche).
// Les ecritures sont creees "en instance" (a valider par le Directeur Financier).
// Masquee sans bruit si le module Comptabilite n'est pas actif / pas autorise.
export default function ReceptionCompta({ reception, onChange }) {
  const { t } = useLangue();
  const [apercu, setApercu] = useState(null);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [march, setMarch] = useState({ reference_fournisseur: "", date_facture: "", taux_tva: "" });
  const [trans, setTrans] = useState({}); // transitaire_id -> { reference_fournisseur, date_facture, taux: {coutId: valeur} }

  const id = reception.id;

  const charger = useCallback(() => {
    api
      .getFacturationReception(id)
      .then((a) => {
        setApercu(a && a.disponible ? a : null);
        if (a && a.disponible) {
          setMarch((m) => ({
            reference_fournisseur: m.reference_fournisseur || a.reference_facture || "",
            date_facture: m.date_facture || a.date_facture || String(reception.date_reception || "").slice(0, 10),
            taux_tva: m.taux_tva !== "" ? m.taux_tva : String(a.marchandises.taux_tva_defaut),
          }));
        }
      })
      .catch(() => setApercu(null));
  }, [id, reception.date_reception]);

  useEffect(() => {
    charger();
  }, [charger]);

  if (!apercu || !apercu.peut_facturer) return null;

  const aujourdhui = new Date().toISOString().slice(0, 10);
  const etatTrans = (tid) => trans[tid] || { reference_fournisseur: "", date_facture: aujourdhui, taux: {} };
  const majTrans = (tid, patch) => setTrans((s) => ({ ...s, [tid]: { ...etatTrans(tid), ...patch } }));

  async function executer(fn, message) {
    setErreur("");
    setInfo("");
    setEnCours(true);
    try {
      const f = await fn();
      setInfo(message.replace("{numero}", f.numero));
      charger();
      if (onChange) onChange();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  const facturerMarchandises = () =>
    executer(
      () =>
        api.creerFactureFournisseurReception(id, {
          reference_fournisseur: march.reference_fournisseur,
          date_facture: march.date_facture,
          taux_tva: march.taux_tva === "" ? undefined : Number(String(march.taux_tva).replace(",", ".")),
        }),
      t("rcpComptaCree")
    );

  const facturerTransitaire = (g) => {
    const e = etatTrans(g.transitaire_id);
    const taux = {};
    for (const [k, v] of Object.entries(e.taux)) if (v !== "") taux[k] = Number(String(v).replace(",", "."));
    return executer(
      () => api.creerFactureTransitaireReception(id, { transitaire_id: g.transitaire_id, reference_fournisseur: e.reference_fournisseur, date_facture: e.date_facture, taux }),
      t("rcpComptaCree")
    );
  };

  const m = apercu.marchandises;
  const sansTransitaire = apercu.couts_sans_transitaire.filter((c) => c.montant > 0);

  return (
    <section className="card" style={{ marginBottom: 16 }} data-testid="reception-compta">
      <h2 style={{ fontSize: 14.5, color: "var(--petrol)", margin: "0 0 4px" }}>{t("rcpComptaTitre")}</h2>
      <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "0 0 12px" }}>
        {t("rcpComptaAide")}
        {apercu.analytique_dossier ? ` ${t("rcpComptaAnalytique")}` : ""}
      </p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 10 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 10 }}>{info}</p>}

      {/* Marchandises */}
      <div style={blocStyle}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
          <strong style={{ fontSize: 13 }}>{t("rcpComptaMarchandises")}</strong>
          <span style={{ fontSize: 12, color: "var(--sub)" }}>{apercu.fournisseur_nom}</span>
          <span style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 13 }}>
            {fmt(m.total_ht)} {t("rcpComptaHt")}
          </span>
        </div>
        {m.facture_id ? (
          <p style={{ fontSize: 12, margin: "8px 0 0" }}>
            {t("rcpComptaFacturee")} <span className="mono">{m.facture_numero}</span>
          </p>
        ) : m.total_ht > 0 ? (
          <div style={grilleStyle}>
            <div>
              <label style={labelStyle}>{t("rcpComptaReference")}</label>
              <input value={march.reference_fournisseur} onChange={(e) => setMarch((s) => ({ ...s, reference_fournisseur: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("rcpComptaDate")}</label>
              <input type="date" value={march.date_facture} onChange={(e) => setMarch((s) => ({ ...s, date_facture: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("rcpComptaTva")}</label>
              <input inputMode="decimal" value={march.taux_tva} onChange={(e) => setMarch((s) => ({ ...s, taux_tva: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ alignSelf: "end" }}>
              <button type="button" disabled={enCours || !march.reference_fournisseur.trim()} onClick={facturerMarchandises} style={boutonStyle}>
                {t("rcpComptaCreerMarchandises")}
              </button>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: "var(--sub)", margin: "8px 0 0" }}>{t("rcpComptaRien")}</p>
        )}
      </div>

      {/* Transitaires */}
      {apercu.transitaires.map((g) => {
        const e = etatTrans(g.transitaire_id);
        return (
          <div key={g.transitaire_id} style={blocStyle}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
              <strong style={{ fontSize: 13 }}>{g.transitaire_nom}</strong>
              <span style={{ fontSize: 12, color: "var(--sub)" }}>{t("rcpComptaFraisApproche")}</span>
              <span style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 13 }}>
                {fmt(g.total_a_facturer)} {t("rcpComptaHt")}
              </span>
            </div>
            <table style={{ width: "100%", fontSize: 12, marginTop: 8, borderCollapse: "collapse" }}>
              <tbody>
                {g.couts.map((c) => (
                  <tr key={c.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={td}>{t(`receptionsCoutType${c.type_cout}`)}{c.libelle ? ` — ${c.libelle}` : ""}</td>
                    <td style={{ ...td, textAlign: "right" }} className="mono">{fmt(c.montant)}</td>
                    <td style={{ ...td, textAlign: "right", width: 150 }}>
                      {c.facture_id ? (
                        <span className="mono" style={{ color: "var(--petrol)" }}>{c.facture_numero}</span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <span style={{ color: "var(--sub)" }}>{t("rcpComptaTva")}</span>
                          <input
                            inputMode="decimal"
                            aria-label={t("rcpComptaTva")}
                            value={e.taux[c.id] !== undefined ? e.taux[c.id] : String(c.taux_tva_defaut)}
                            onChange={(ev) => majTrans(g.transitaire_id, { taux: { ...e.taux, [c.id]: ev.target.value } })}
                            style={{ ...inputStyle, width: 56, padding: "4px 6px", fontSize: 12 }}
                          />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {g.a_facturer > 0 ? (
              <div style={grilleStyle}>
                <div>
                  <label style={labelStyle}>{t("rcpComptaReferenceTransitaire")}</label>
                  <input value={e.reference_fournisseur} onChange={(ev) => majTrans(g.transitaire_id, { reference_fournisseur: ev.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>{t("rcpComptaDate")}</label>
                  <input type="date" value={e.date_facture} onChange={(ev) => majTrans(g.transitaire_id, { date_facture: ev.target.value })} style={inputStyle} />
                </div>
                <div />
                <div style={{ alignSelf: "end" }}>
                  <button type="button" disabled={enCours || !e.reference_fournisseur.trim()} onClick={() => facturerTransitaire(g)} style={boutonStyle}>
                    {t("rcpComptaCreerTransitaire")}
                  </button>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "var(--sub)", margin: "8px 0 0" }}>{t("rcpComptaToutFacture")}</p>
            )}
          </div>
        );
      })}

      {sansTransitaire.length > 0 && (
        <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "4px 0 10px" }}>
          {t("rcpComptaSansTransitaire").replace("{montant}", fmt(sansTransitaire.reduce((s, c) => s + c.montant, 0)))}
        </p>
      )}

      <a href="/comptabilite/instance" style={{ fontSize: 12, color: "var(--petrol)", fontWeight: 600 }}>
        {t("rcpComptaVoirInstance")}
      </a>
    </section>
  );
}

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, fontFamily: "inherit" };
const boutonStyle = { background: "var(--petrol)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const blocStyle = { border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 10 };
const grilleStyle = { display: "grid", gridTemplateColumns: "1.4fr 1fr 0.6fr auto", gap: 10, marginTop: 10, alignItems: "start" };
const td = { padding: "5px 6px", verticalAlign: "middle" };
