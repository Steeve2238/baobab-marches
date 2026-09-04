"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import VentesSousNav from "../../../lib/components/VentesSousNav";

const DEVIS_STYLE = {
  BROUILLON: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
  ENVOYE: { color: "var(--ocre)", background: "rgba(224,149,76,0.12)" },
  VALIDE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  REFUSE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  EXPIRE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};
const FACTURE_STYLE = {
  IMPAYEE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  PAYEE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  ANNULEE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};
const BL_STYLE = {
  BROUILLON: { color: "var(--ocre)", background: "rgba(224,149,76,0.12)" },
  LIVRE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
};

// Affiche le numero de facture/BL avec le mois inclus (ex "2026-08-096"),
// meme convention que les pages Factures/BL - le mois n'est pas stocke dans
// le numero lui-meme (voir mois_emission cote backend).
function numeroAffiche(numero, mois) {
  const [annee, sequence] = numero.split("-");
  return `${annee}-${String(mois).padStart(2, "0")}-${sequence}`;
}

// Jours restants avant echeance, calcule cote client (affichage uniquement,
// jamais transmis au serveur) - meme principe que le calcul de totaux en
// direct sur la page Nouveau devis.
function joursRestants(dateEcheance) {
  if (!dateEcheance) return null;
  const diff = new Date(dateEcheance).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(diff / 86400000);
}

export default function SuiviVentesPage() {
  const { t } = useLangue();
  const [lignes, setLignes] = useState([]);
  const [recherche, setRecherche] = useState("");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    api
      .getSuiviVentes()
      .then(setLignes)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  const lignesFiltrees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return lignes;
    return lignes.filter((l) =>
      [l.client_nom, l.objet, l.devis_numero, l.facture_numero, l.bl_numero, l.reference_bc_client]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q))
    );
  }, [lignes, recherche]);

  return (
    <AppShell title={t("venteSuiviPageTitle")} subNav={<VentesSousNav />}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16 }}>
        {t("venteSuiviPageSubtitle")}
      </p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <input
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        placeholder={t("venteSuiviSearchPlaceholder")}
        style={{ ...inputStyle, maxWidth: 320, marginBottom: 14 }}
      />

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : lignesFiltrees.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("venteSuiviEmpty")}</p>
      ) : (
        <div className="card" style={{ overflowX: "auto", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 900 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("venteClientLabel")}</th>
                <th style={thStyle}>{t("venteObjetLabel")}</th>
                <th style={thStyle}>{t("navVentesDevis")}</th>
                <th style={thStyle}>{t("navVentesFactures")}</th>
                <th style={thStyle}>{t("venteTotalTtcLabel")}</th>
                <th style={thStyle}>{t("navVentesBl")}</th>
                <th style={thStyle}>{t("venteEcheanceLabel")}</th>
              </tr>
            </thead>
            <tbody>
              {lignesFiltrees.map((l) => {
                const jours = l.facture_statut === "IMPAYEE" ? joursRestants(l.date_echeance) : null;
                return (
                  <tr key={l.devis_id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ ...tdStyle, textAlign: "left", fontWeight: 600 }}>{l.client_nom}</td>
                    <td style={{ ...tdStyle, textAlign: "left", color: "var(--sub)" }}>
                      {l.objet || "—"}
                      {l.reference_bc_client && (
                        <div style={{ fontSize: 11, color: "var(--sub)" }}>{l.reference_bc_client}</div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <Link href={`/ventes/devis/${l.devis_id}`} className="mono" style={{ color: "var(--petrol)" }}>
                        {l.devis_numero}
                      </Link>
                      <div>
                        <span style={{ ...badgeStyle, ...(DEVIS_STYLE[l.devis_statut] || {}) }}>
                          {t(`venteDevisStatut_${l.devis_statut}`)}
                        </span>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      {l.facture_id ? (
                        <>
                          <Link href={`/ventes/factures/${l.facture_id}`} className="mono" style={{ color: "var(--petrol)" }}>
                            {numeroAffiche(l.facture_numero, l.facture_mois_emission)}
                          </Link>
                          <div>
                            <span style={{ ...badgeStyle, ...(FACTURE_STYLE[l.facture_statut] || {}) }}>
                              {t(`venteFactureStatut_${l.facture_statut}`)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <span style={{ color: "var(--sub)" }}>{t("venteNoInvoiceYet")}</span>
                      )}
                    </td>
                    <td className="mono" style={tdStyle}>
                      {l.facture_id ? `${Number(l.facture_total_ttc).toLocaleString()} XOF` : `${Number(l.devis_total_ttc).toLocaleString()} XOF`}
                    </td>
                    <td style={tdStyle}>
                      {l.bl_id ? (
                        <>
                          <Link href={`/ventes/bl/${l.bl_id}`} className="mono" style={{ color: "var(--petrol)" }}>
                            BL-{numeroAffiche(l.bl_numero, l.facture_mois_emission)}
                          </Link>
                          <div>
                            <span style={{ ...badgeStyle, ...(BL_STYLE[l.bl_statut] || {}) }}>
                              {t(`venteBlStatut_${l.bl_statut}`)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <span style={{ color: "var(--sub)" }}>{t("venteNoBlYet")}</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {jours === null ? (
                        <span style={{ color: "var(--sub)" }}>—</span>
                      ) : (
                        <span style={{ color: jours < 0 ? "var(--brique)" : jours <= 7 ? "var(--ocre)" : "var(--sub)", fontWeight: jours < 0 ? 700 : 500 }}>
                          {jours < 0
                            ? `${Math.abs(jours)} ${t("venteJoursRetardLabel")}`
                            : jours === 0
                            ? t("venteEcheanceAujourdhui")
                            : `${jours} ${t("venteJoursRestantsLabel")}`}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
};
const thStyle = { padding: "8px 10px", textAlign: "left", color: "var(--sub)", fontWeight: 600, fontSize: 11, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const tdStyle = { padding: "8px 10px", textAlign: "center", verticalAlign: "top" };
const badgeStyle = { fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20, whiteSpace: "nowrap", display: "inline-block", marginTop: 3 };
