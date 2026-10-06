"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import { useLangue } from "../i18n/LanguageContext";
import { EVENEMENTS, ligneVide, totalPct, echeancierValide, texteEcheancier, pourApi } from "../echeancier";
import { inputStyle, labelStyle, boutonSecondaireStyle } from "../comptaUi";

const cacheModeles = {};

/**
 * Editeur d'echeancier de paiement : choix d'un modele puis ajustement ligne par
 * ligne (part en %, evenement de depart, jours apres). `valeur` = tableau de lignes
 * (ou null/[] quand rien n'est renseigne), `onChange` recoit le nouveau tableau.
 * sens = "CLIENT" | "FOURNISSEUR".
 */
export default function EcheancierEditor({ sens, valeur, onChange, titre, aide, lectureSeule = false, compact = false }) {
  const { t } = useLangue();
  const [modeles, setModeles] = useState(cacheModeles[sens] || []);
  const lignes = Array.isArray(valeur) ? valeur : [];

  useEffect(() => {
    if (cacheModeles[sens]) return;
    api
      .echeancierModeles(sens)
      .then((r) => {
        cacheModeles[sens] = r.modeles || [];
        setModeles(cacheModeles[sens]);
      })
      .catch(() => {});
  }, [sens]);

  const total = totalPct(lignes);
  const ok = echeancierValide(lignes);

  function majLigne(i, champ, v) {
    onChange(lignes.map((l, k) => (k === i ? { ...l, [champ]: v } : l)));
  }
  function appliquerModele(code) {
    const m = modeles.find((x) => x.code === code);
    if (m) onChange(m.lignes.map((l) => ({ ...l })));
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: compact ? 10 : 14, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--petrol)" }}>{titre || (sens === "CLIENT" ? t("echTitreClient") : t("echTitreFournisseur"))}</div>
          {!compact && <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 2, maxWidth: 560 }}>{aide || (sens === "CLIENT" ? t("echAideClient") : t("echAideFournisseur"))}</div>}
        </div>
        {!lectureSeule && (
          <select defaultValue="" onChange={(e) => { appliquerModele(e.target.value); e.target.value = ""; }} style={{ ...inputStyle, width: "auto", minWidth: 220, fontSize: 12 }} aria-label={t("echModele")}>
            <option value="">{t("echModelePlaceholder")}</option>
            {modeles.map((m) => (
              <option key={m.code} value={m.code}>{m.nom}</option>
            ))}
          </select>
        )}
      </div>

      {lignes.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--brique)", margin: "4px 0 8px" }}>{t("echAucune")}</p>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 100px 32px", gap: 8 }}>
            <span style={labelStyle}>{t("echPct")}</span>
            <span style={labelStyle}>{t("echEvenement")}</span>
            <span style={labelStyle}>{t("echJours")}</span>
            <span />
          </div>
          {lignes.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "90px 1fr 100px 32px", gap: 8, alignItems: "center" }}>
              <input
                inputMode="decimal"
                value={l.pourcentage}
                disabled={lectureSeule}
                onChange={(e) => majLigne(i, "pourcentage", e.target.value)}
                style={inputStyle}
                aria-label={t("echPct")}
              />
              <select value={l.evenement} disabled={lectureSeule} onChange={(e) => majLigne(i, "evenement", e.target.value)} style={inputStyle} aria-label={t("echEvenement")}>
                {EVENEMENTS.map((ev) => (
                  <option key={ev} value={ev}>{t(`echEv_${ev}`)}</option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                max="720"
                value={l.jours}
                disabled={lectureSeule}
                onChange={(e) => majLigne(i, "jours", e.target.value)}
                style={inputStyle}
                aria-label={t("echJours")}
              />
              {!lectureSeule ? (
                <button type="button" onClick={() => onChange(lignes.filter((_, k) => k !== i))} title={t("echSupprimerLigne")} style={{ ...boutonSecondaireStyle, padding: "4px 0" }}>
                  ×
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {!lectureSeule ? (
          <button type="button" onClick={() => onChange([...lignes, ligneVide()])} style={boutonSecondaireStyle}>
            {t("echAjouterLigne")}
          </button>
        ) : (
          <span />
        )}
        {lignes.length > 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: ok ? "#2E7D5B" : "var(--brique)" }}>
            {t("echTotal")} : {String(Math.round(total * 100) / 100).replace(".", ",")} %
          </span>
        )}
      </div>
      {ok && <p style={{ fontSize: 12, color: "var(--sub)", marginTop: 8 }}>{texteEcheancier(lignes, t)}</p>}
    </div>
  );
}

/** Pastille « À renseigner » pour les fiches sans conditions de paiement. */
export function PastilleARenseigner({ t }) {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, color: "var(--brique)", background: "rgba(176,66,48,0.1)" }}>
      {t("echARenseigner")}
    </span>
  );
}

/**
 * Bloc compact pour une fiche (client ou fournisseur) : texte des conditions ou
 * pastille « A renseigner », bouton de modification, editeur et enregistrement.
 * `onSave(lignesApi)` doit retourner une promesse (rejetee en cas d'erreur).
 */
export function EcheancierFiche({ sens, echeancier, onSave }) {
  const { t } = useLangue();
  const [ouvert, setOuvert] = useState(false);
  const [lignes, setLignes] = useState([]);
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const ech = Array.isArray(echeancier) && echeancier.length > 0 ? echeancier : null;

  async function enregistrer() {
    setErreur("");
    if (!echeancierValide(lignes)) {
      setErreur(t("echObligatoire"));
      return;
    }
    setEnvoi(true);
    try {
      await onSave(pourApi(lignes));
      setOuvert(false);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "var(--sub)" }}>{ech ? texteEcheancier(ech, t) : <PastilleARenseigner t={t} />}</div>
        <button
          type="button"
          onClick={() => {
            setLignes(ech ? ech.map((l) => ({ ...l })) : []);
            setErreur("");
            setOuvert((o) => !o);
          }}
          style={{ background: "transparent", color: "var(--petrol)", border: "1px solid var(--line)", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600 }}
        >
          {ouvert ? t("echFermer") : t("echModifier")}
        </button>
      </div>
      {ouvert && (
        <div style={{ marginTop: 10 }}>
          <EcheancierEditor sens={sens} valeur={lignes} onChange={setLignes} />
          {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginTop: 8 }}>{erreur}</p>}
          <button type="button" disabled={envoi} onClick={enregistrer} style={{ background: "var(--petrol)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12.5, fontWeight: 600, marginTop: 10 }}>
            {t("echEnregistrer")}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Choix rapide d'un modele d'echeancier (creations « a la volee » d'un
 * fournisseur ou d'un client). Donne les lignes du modele choisi ; l'echeancier
 * reste modifiable ensuite sur la fiche.
 */
export function EcheancierModeleSelect({ sens, valeur, onChange, style }) {
  const { t } = useLangue();
  const [modeles, setModeles] = useState(cacheModeles[sens] || []);
  useEffect(() => {
    if (cacheModeles[sens]) return;
    api
      .echeancierModeles(sens)
      .then((r) => {
        cacheModeles[sens] = r.modeles || [];
        setModeles(cacheModeles[sens]);
      })
      .catch(() => {});
  }, [sens]);
  const courant = modeles.find((m) => JSON.stringify(m.lignes) === JSON.stringify(valeur));
  return (
    <select
      required
      value={courant ? courant.code : ""}
      onChange={(e) => {
        const m = modeles.find((x) => x.code === e.target.value);
        onChange(m ? m.lignes.map((l) => ({ ...l })) : []);
      }}
      style={{ ...inputStyle, fontSize: 11.5, padding: "5px 8px", ...(style || {}) }}
      aria-label={t("echModele")}
    >
      <option value="">{t("echModelePlaceholder")}</option>
      {modeles.map((m) => (
        <option key={m.code} value={m.code}>{m.nom}</option>
      ))}
    </select>
  );
}
