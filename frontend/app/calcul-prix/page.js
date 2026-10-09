"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [dossiers, setDossiers] = useState([]);
  // Creation d'un dossier de calcul depuis cette page (05/10/2026) : choix du
  // rattachement (AO ou consultation restreinte), jusque-la possible seulement
  // depuis la fiche du dossier ou de la consultation.
  const [formOuvert, setFormOuvert] = useState(false);
  const [parents, setParents] = useState(null);
  const [typeParent, setTypeParent] = useState("consultation");
  const [parentId, setParentId] = useState("");
  const [nomNouveau, setNomNouveau] = useState("");
  const [creation, setCreation] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    api
      .getDossiersCalcul()
      .then(setDossiers)
      .catch((err) => setErreur(err.message || t("defaultLoadError")))
      .finally(() => setChargement(false));
  }, [t]);

  async function ouvrirFormulaire() {
    setFormOuvert(true);
    setErreur("");
    if (!parents) {
      try {
        const p = await api.getParentsDossierCalcul();
        setParents(p);
        if (p.consultations.length === 0 && p.dossiers_ao.length > 0) setTypeParent("ao");
      } catch (err) {
        setErreur(err.message);
      }
    }
  }

  async function creer(e) {
    e.preventDefault();
    if (!parentId) {
      setErreur(t("calcPrixParentRequis"));
      return;
    }
    setCreation(true);
    setErreur("");
    try {
      const cree = await api.createDossierCalcul({
        nom: nomNouveau,
        ...(typeParent === "ao" ? { dossier_ao_id: parentId } : { consultation_id: parentId }),
      });
      router.push(`/calcul-prix/${cree.id}`);
    } catch (err) {
      setErreur(err.message);
      setCreation(false);
    }
  }

  const options = parents ? (typeParent === "ao" ? parents.dossiers_ao : parents.consultations) : [];

  return (
    <AppShell title={t("calcPrixListTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 12 }}>{t("calcPrixListSubtitle")}</p>

      {/* Aide : explique le dossier de calcul simplement ; ouverte tant qu'aucun dossier n'existe. */}
      <details className="card" open={!chargement && dossiers.length === 0} style={{ marginBottom: 14 }}>
        <summary style={{ cursor: "pointer", fontSize: 13.5, fontWeight: 700, color: "var(--petrol)" }}>{t("calcPrixAideTitre")}</summary>
        <p style={{ fontSize: 12.5, lineHeight: 1.55, margin: "10px 0 8px" }}>{t("calcPrixAideIntro")}</p>
        <ol style={{ fontSize: 12.5, lineHeight: 1.55, margin: "0 0 8px", paddingLeft: 20 }}>
          <li>{t("calcPrixAide1")}</li>
          <li>{t("calcPrixAide2")}</li>
          <li>{t("calcPrixAide3")}</li>
        </ol>
        <p style={{ fontSize: 12, color: "var(--sub)", margin: 0 }}>{t("calcPrixAideExemple")}</p>
      </details>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <button type="button" onClick={ouvrirFormulaire} style={boutonPrincipalStyle}>
          {t("calcPrixNouveauBouton")}
        </button>
        <Link href="/produits" style={{ ...boutonSecondaireStyle, textDecoration: "none" }}>
          {t("calcPrixLienProduits")}
        </Link>
      </div>

      {formOuvert && (
        <form onSubmit={creer} className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14.5, color: "var(--petrol)", marginBottom: 12 }}>{t("calcPrixNouveauTitre")}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div>
              <label style={labelStyle}>{t("calcPrixRattacherA")}</label>
              <select
                value={typeParent}
                onChange={(e) => {
                  setTypeParent(e.target.value);
                  setParentId("");
                }}
                style={inputStyle}
              >
                <option value="consultation">{t("calcPrixChoixConsultation")}</option>
                <option value="ao">{t("calcPrixChoixAo")}</option>
              </select>
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={labelStyle}>&nbsp;</label>
              <select required value={parentId} onChange={(e) => setParentId(e.target.value)} style={inputStyle}>
                <option value="">{t("calcPrixChoisirParent")}</option>
                {typeParent === "ao"
                  ? options.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.reference_externe ? `${d.reference_externe} — ` : ""}
                        {d.intitule}
                      </option>
                    ))
                  : options.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.client_nom ? `${c.client_nom} — ` : ""}
                        {c.objet}
                      </option>
                    ))}
              </select>
              {parents && options.length === 0 && (
                <p style={{ fontSize: 11.5, color: "var(--brique)", margin: "4px 0 0" }}>{t("calcPrixAucunParent")}</p>
              )}
            </div>
            <div>
              <label style={labelStyle}>{t("calcPrixNomLabel")}</label>
              <input required value={nomNouveau} onChange={(e) => setNomNouveau(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "8px 0 0" }}>{t("calcPrixAideConsultation")}</p>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button type="submit" disabled={creation} style={boutonPrincipalStyle}>
              {creation ? t("calcPrixCreating") : t("calcPrixCreerOuvrir")}
            </button>
            <button type="button" onClick={() => setFormOuvert(false)} style={boutonSecondaireStyle}>
              {t("cancel")}
            </button>
          </div>
        </form>
      )}

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

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, fontFamily: "inherit" };
const boutonPrincipalStyle = { background: "var(--petrol)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const boutonSecondaireStyle = { background: "transparent", color: "var(--petrol)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
