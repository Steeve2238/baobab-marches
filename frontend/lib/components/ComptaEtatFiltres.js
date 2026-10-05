"use client";

import { useEffect } from "react";
import Link from "next/link";
import { api } from "../api";
import { useLangue } from "../i18n/LanguageContext";
import { useComptaStatut, labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle } from "../comptaUi";

/**
 * Barre de filtres commune au grand livre et a la balance : exercice, periode,
 * plage de comptes, option "inclure les ecritures en instance", boutons
 * Afficher et exports PDF / Excel.
 */
export default function ComptaEtatFiltres({ etat, filtres, setFiltres, exercices, setExercices, onAfficher, onErreur, sansComptes = false, sansDebut = false, libelleFin = null }) {
  const { t } = useLangue();
  const { statut } = useComptaStatut();
  const enInstance = statut?.en_attente?.en_instance || 0;

  useEffect(() => {
    api
      .comptaExercices()
      .then((x) => {
        setExercices(x);
        if (!filtres.exercice_id && x.length > 0) {
          const courant = x.find((e) => e.statut === "OUVERT") || x[0];
          setFiltres((f) => ({ ...f, exercice_id: courant.id }));
        }
      })
      .catch((e) => onErreur(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const maj = (cle, valeur) => setFiltres((f) => ({ ...f, [cle]: valeur }));
  const parametres = () => {
    const p = {};
    for (const [k, v] of Object.entries(filtres)) if (v) p[k] = v === true ? "1" : v;
    return p;
  };

  async function exporter(format) {
    onErreur("");
    try {
      await api.comptaExporter(etat, format, parametres());
    } catch (e) {
      onErreur(e.message);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      {enInstance > 0 && !filtres.inclure_instance && (
        <p style={{ fontSize: 12, color: "var(--ocre)", marginBottom: 10 }}>
          {enInstance} — {t("comptaBandeauInstance")}{" "}
          <Link href="/comptabilite/instance" style={{ color: "var(--petrol)", fontWeight: 600 }}>
            {t("comptaVoirInstance")}
          </Link>
        </p>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={labelStyle}>{t("comptaExercice")}</label>
          <select value={filtres.exercice_id} onChange={(e) => setFiltres((f) => ({ ...f, exercice_id: e.target.value, date_debut: "", date_fin: "" }))} style={{ ...inputStyle, width: 160 }}>
            {exercices.map((x) => (
              <option key={x.id} value={x.id}>
                {x.libelle}
              </option>
            ))}
          </select>
        </div>
        {!sansDebut && (
          <div>
            <label style={labelStyle}>{t("comptaPeriodeDu")}</label>
            <input type="date" value={filtres.date_debut} onChange={(e) => maj("date_debut", e.target.value)} style={{ ...inputStyle, width: 145 }} />
          </div>
        )}
        <div>
          <label style={labelStyle}>{libelleFin ? t(libelleFin) : t("comptaPeriodeAu")}</label>
          <input type="date" value={filtres.date_fin} onChange={(e) => maj("date_fin", e.target.value)} style={{ ...inputStyle, width: 145 }} />
        </div>
        {!sansComptes && (
          <>
            <div>
              <label style={labelStyle}>{t("comptaCompteDe")}</label>
              <input value={filtres.compte_de} onChange={(e) => maj("compte_de", e.target.value.replace(/\D/g, ""))} style={{ ...inputStyle, width: 120, fontFamily: "IBM Plex Mono, monospace" }} />
            </div>
            <div>
              <label style={labelStyle}>{t("comptaCompteA")}</label>
              <input value={filtres.compte_a} onChange={(e) => maj("compte_a", e.target.value.replace(/\D/g, ""))} style={{ ...inputStyle, width: 120, fontFamily: "IBM Plex Mono, monospace" }} />
            </div>
          </>
        )}
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", paddingBottom: 8 }}>
          <input type="checkbox" checked={!!filtres.inclure_instance} onChange={(e) => maj("inclure_instance", e.target.checked)} />
          {t("comptaInclureInstance")}
        </label>
        <button style={boutonPrincipalStyle} onClick={onAfficher}>
          {t("comptaAfficher")}
        </button>
        <button style={boutonSecondaireStyle} onClick={() => exporter("pdf")}>
          PDF
        </button>
        <button style={boutonSecondaireStyle} onClick={() => exporter("xlsx")}>
          Excel
        </button>
      </div>
    </div>
  );
}
