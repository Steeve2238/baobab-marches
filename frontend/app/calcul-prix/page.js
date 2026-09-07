"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

// Portefeuille de tous les "Dossiers de calcul" (prix de revient et marge),
// tous modules confondus (dossiers d'AO et consultations restreintes mèlés -
// voir routes/calculPrix.js cote backend, dossier_calcul.dossier_ao_id XOR
// consultation_id). Point d'entree complementaire aux liens directs "Ouvrir
// le dossier de calcul" places sur chaque fiche dossier/consultation (voir
// app/dossiers/[id]/page.js et app/ventes/consultations/[id]/page.js) - utile
// pour retrouver un dossier de calcul sans repasser par son dossier/
// consultation d'origine.
export default function CalculPrixListePage() {
  const { t, dict } = useLangue();
  const [dossiers, setDossiers] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    api
      .getDossiersCalcul()
      .then(setDossiers)
      .catch((err) => setErreur(err.message || t("defaultLoadError")))
      .finally(() => setChargement(false));
  }, [t]);

  return (
    <AppShell title={t("calcPrixListTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 16 }}>{t("calcPrixListSubtitle")}</p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : dossiers.length === 0 ? (
        <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>
          {t("calcPrixEmptyList")}
        </p>
      ) : (
        <div className="card" style={{ overflowX: "auto", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 640 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("calcPrixColNom")}</th>
                <th style={thStyle}>{t("calcPrixColRattachement")}</th>
                <th style={thStyle}>{t("calcPrixColDate")}</th>
              </tr>
            </thead>
            <tbody>
              {dossiers.map((d) => (
                <tr key={d.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ ...tdStyle, textAlign: "left" }}>
                    <Link href={`/calcul-prix/${d.id}`} style={{ color: "var(--petrol)", fontWeight: 600 }}>
                      {d.nom}
                    </Link>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "left", color: "var(--sub)" }}>
                    {d.dossier_ao_id ? (
                      <>
                        {t("calcPrixRattachementAo")}
                        {" · "}
                        <span className="mono">{d.dossier_ao_reference || d.dossier_ao_intitule}</span>
                      </>
                    ) : (
                      <>
                        {t("calcPrixRattachementConsultation")}
                        {" · "}
                        {d.consultation_client_nom} {d.consultation_objet ? `— ${d.consultation_objet}` : ""}
                      </>
                    )}
                  </td>
                  <td className="mono" style={tdStyle}>
                    {d.date_creation ? new Date(d.date_creation).toLocaleDateString(dict.dateLocale) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

const thStyle = {
  padding: "8px 10px",
  textAlign: "left",
  color: "var(--sub)",
  fontWeight: 600,
  fontSize: 11,
  borderBottom: "1px solid var(--line)",
  whiteSpace: "nowrap",
};
const tdStyle = { padding: "8px 10px", textAlign: "center", verticalAlign: "top" };
