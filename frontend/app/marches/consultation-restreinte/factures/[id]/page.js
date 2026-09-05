"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, estAdmin, getUtilisateurCourant } from "../../../../../lib/api";
import { useLangue } from "../../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../../lib/components/AppShell";

const STATUT_STYLE = {
  IMPAYEE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  PAYEE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  ANNULEE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};

function possedeRole(codes) {
  if (estAdmin()) return true;
  const user = getUtilisateurCourant();
  return Array.isArray(user?.roles) && user.roles.some((r) => codes.includes(r));
}

function numeroAffiche(numero, mois) {
  const [annee, sequence] = numero.split("-");
  return `${annee}-${String(mois).padStart(2, "0")}-${sequence}`;
}

export default function FactureVenteDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useLangue();
  const [facture, setFacture] = useState(null);
  const [entete, setEntete] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [action, setAction] = useState(false);
  const [modePaiement, setModePaiement] = useState("");

  function charger() {
    Promise.all([api.getFactureVente(params.id), api.getEntete(), api.getParametresVentes()])
      .then(([factureData, enteteData, parametresData]) => {
        setFacture(factureData);
        setEntete({ ...enteteData, ...parametresData });
      })
      .catch((err) => {
        if (err.status === 401) {
          router.push("/login");
          return;
        }
        setErreur(err.message);
      })
      .finally(() => setChargement(false));
  }

  useEffect(charger, [params.id]);

  async function handleMarquerPayee() {
    setAction(true);
    setErreur("");
    try {
      const maj = await api.marquerFactureVentePayee(facture.id, { mode_paiement: modePaiement });
      setFacture((prev) => ({ ...prev, ...maj }));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setAction(false);
    }
  }

  async function handleAnnuler() {
    setAction(true);
    setErreur("");
    try {
      const maj = await api.annulerFactureVente(facture.id);
      setFacture((prev) => ({ ...prev, ...maj }));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setAction(false);
    }
  }

  async function handleGenererBl() {
    setAction(true);
    setErreur("");
    try {
      const bl = await api.genererBlDepuisFacture(facture.id);
      router.push(`/marches/consultation-restreinte/bl/${bl.id}`);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setAction(false);
    }
  }

  if (chargement) {
    return (
      <AppShell title={t("venteFactureDetailTitle")} backHref="/marches/consultation-restreinte/factures">
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </AppShell>
    );
  }
  if (!facture) {
    return (
      <AppShell title={t("venteFactureDetailTitle")} backHref="/marches/consultation-restreinte/factures">
        {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      </AppShell>
    );
  }

  const style = STATUT_STYLE[facture.statut] || {};
  const peutFacturer = possedeRole(["COMPTABLE", "FINANCIER"]);
  const numeroComplet = numeroAffiche(facture.numero, facture.mois_emission);

  return (
    <AppShell title={numeroComplet} backHref="/marches/consultation-restreinte/factures">
      {erreur && <p className="no-print" style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, ...style }}>
          {t(`venteFactureStatut_${facture.statut}`)}
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {facture.statut === "IMPAYEE" && peutFacturer && (
            <>
              <input
                placeholder={t("saPaymentModePlaceholder")}
                value={modePaiement}
                onChange={(e) => setModePaiement(e.target.value)}
                style={{ ...inputStyleCompact, width: 160 }}
              />
              <button onClick={handleMarquerPayee} disabled={action} style={boutonPrincipalStyle}>
                {t("saMarkPaidButton")}
              </button>
              <button onClick={handleAnnuler} disabled={action} style={boutonDangerStyle}>
                {t("venteCancelInvoiceButton")}
              </button>
            </>
          )}
          {facture.bon_livraison ? (
            <Link href={`/marches/consultation-restreinte/bl/${facture.bon_livraison.id}`} style={boutonSecondaireStyle}>
              {t("venteViewBlButton")} ({numeroAffiche(facture.bon_livraison.numero, facture.mois_emission)})
            </Link>
          ) : (
            peutFacturer &&
            facture.statut !== "ANNULEE" && (
              <button onClick={handleGenererBl} disabled={action} style={boutonPrincipalStyle}>
                {t("venteGenerateBlButton")}
              </button>
            )
          )}
          <button onClick={() => window.print()} style={boutonSecondaireStyle}>
            {t("print")}
          </button>
        </div>
      </div>

      <div className="card print-letter" style={{ padding: "28px 32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 24, borderBottom: "2px solid var(--petrol)", paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            {entete?.logo_base64 && (
              <img
                src={`data:${entete.logo_type_mime};base64,${entete.logo_base64}`}
                alt="logo"
                style={{ maxWidth: 90, maxHeight: 70, objectFit: "contain" }}
              />
            )}
            <div>
              <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 14, color: "var(--petrol)" }}>
                {entete?.raison_sociale || "—"}
              </div>
              <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>{entete?.adresse}</div>
              <div style={{ fontSize: 11, color: "var(--sub)" }}>{entete?.telephone}</div>
              <div style={{ fontSize: 11, color: "var(--sub)" }}>{entete?.email}</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>
              {t("venteInvoiceNumberLabel")} {numeroComplet}
              {facture.reference_bc_client ? `/${facture.reference_bc_client}` : ""}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{new Date(facture.date_facture).toLocaleDateString()}</div>
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--sub)", textTransform: "uppercase" }}>{t("venteBillToLabel")}</div>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{facture.client_nom}</div>
          {facture.client_adresse && <div style={{ fontSize: 12, color: "var(--sub)" }}>{facture.client_adresse}</div>}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ fontSize: 11, textAlign: "left", borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "6px 4px" }}>{t("venteDesignationLabel")}</th>
              <th style={{ padding: "6px 4px" }}>{t("venteUniteLabel")}</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>{t("venteQuantiteLabel")}</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>{t("ventePrixUnitaireLabel")}</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>{t("venteMontantLabel")}</th>
            </tr>
          </thead>
          <tbody>
            {facture.lignes.map((l) => (
              <tr key={l.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                <td style={{ padding: "6px 4px", fontSize: 12.5 }}>{l.designation}</td>
                <td style={{ padding: "6px 4px", fontSize: 12.5 }}>{l.unite}</td>
                <td className="mono" style={{ padding: "6px 4px", fontSize: 12.5, textAlign: "right" }}>{Number(l.quantite).toLocaleString()}</td>
                <td className="mono" style={{ padding: "6px 4px", fontSize: 12.5, textAlign: "right" }}>{Number(l.prix_unitaire_ht).toLocaleString()}</td>
                <td className="mono" style={{ padding: "6px 4px", fontSize: 12.5, textAlign: "right" }}>{Number(l.montant_ht).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 14, marginLeft: "auto", maxWidth: 260, display: "grid", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <span>{t("venteTotalHtLabel")}</span>
            <span className="mono">{Number(facture.total_ht).toLocaleString()} XOF</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--sub)" }}>
            <span>{t("venteTvaLabel")} ({Number(facture.taux_tva_pourcentage)}%)</span>
            <span className="mono">{Number(facture.montant_tva).toLocaleString()} XOF</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, color: "var(--petrol)" }}>
            <span>{t("venteTotalTtcLabel")}</span>
            <span className="mono">{Number(facture.total_ttc).toLocaleString()} XOF</span>
          </div>
        </div>

        {facture.statut === "PAYEE" && (
          <div className="no-print" style={{ marginTop: 14, fontSize: 11.5, color: "var(--sub)" }}>
            {t("saPaidOn")} {new Date(facture.date_paiement).toLocaleDateString()}
            {facture.mode_paiement ? ` · ${facture.mode_paiement}` : ""}
          </div>
        )}

        <div style={{ marginTop: 40, textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 12.5 }}>{entete?.signataire_nom}</div>
          <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{entete?.signataire_titre}</div>
        </div>
      </div>
    </AppShell>
  );
}

const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const boutonSecondaireStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
  textDecoration: "none",
  display: "inline-block",
};
const boutonDangerStyle = {
  background: "transparent",
  color: "var(--brique)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const inputStyleCompact = {
  padding: "7px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 12.5,
  fontFamily: "inherit",
};
