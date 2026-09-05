"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../../lib/api";
import { useLangue } from "../../../../../lib/i18n/LanguageContext";
import { estAdmin, getUtilisateurCourant } from "../../../../../lib/api";
import AppShell from "../../../../../lib/components/AppShell";

const STATUT_STYLE = {
  BROUILLON: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
  ENVOYE: { color: "var(--ocre)", background: "rgba(224,149,76,0.12)" },
  VALIDE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  REFUSE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  EXPIRE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};

function possedeRole(codes) {
  if (estAdmin()) return true;
  const user = getUtilisateurCourant();
  return Array.isArray(user?.roles) && user.roles.some((r) => codes.includes(r));
}

export default function DevisDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useLangue();
  const [devis, setDevis] = useState(null);
  const [entete, setEntete] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [action, setAction] = useState(false);
  const [referenceBc, setReferenceBc] = useState("");

  function charger() {
    Promise.all([api.getDevis(params.id), api.getEntete(), api.getParametresVentes()])
      .then(([devisData, enteteData, parametresData]) => {
        setDevis(devisData);
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

  async function handleValider() {
    setAction(true);
    setErreur("");
    try {
      const maj = await api.validerDevis(devis.id);
      setDevis((prev) => ({ ...prev, ...maj }));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setAction(false);
    }
  }

  async function handleChangerStatut(statut) {
    setAction(true);
    setErreur("");
    try {
      const maj = await api.changerStatutDevis(devis.id, statut);
      setDevis((prev) => ({ ...prev, ...maj }));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setAction(false);
    }
  }

  async function handleGenererFacture() {
    setAction(true);
    setErreur("");
    try {
      const facture = await api.genererFactureDepuisDevis(devis.id, { reference_bc_client: referenceBc || null });
      router.push(`/marches/consultation-restreinte/factures/${facture.id}`);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setAction(false);
    }
  }

  if (chargement) {
    return (
      <AppShell title={t("venteDevisDetailTitle")} backHref="/marches/consultation-restreinte/devis">
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </AppShell>
    );
  }
  if (!devis) {
    return (
      <AppShell title={t("venteDevisDetailTitle")} backHref="/marches/consultation-restreinte/devis">
        {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      </AppShell>
    );
  }

  const style = STATUT_STYLE[devis.statut] || {};
  const peutEditer = ["BROUILLON", "ENVOYE"].includes(devis.statut);
  const peutValider = peutEditer && possedeRole(["DIRECTION"]);
  const peutFacturer = devis.statut === "VALIDE" && !devis.facture && possedeRole(["COMPTABLE", "FINANCIER"]);

  return (
    <AppShell title={devis.numero} backHref="/marches/consultation-restreinte/devis">
      {erreur && <p className="no-print" style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, ...style }}>
          {t(`venteDevisStatut_${devis.statut}`)}
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {peutEditer && (
            <button onClick={() => handleChangerStatut("ENVOYE")} disabled={action || devis.statut === "ENVOYE"} style={boutonSecondaireStyle}>
              {t("venteMarkSentButton")}
            </button>
          )}
          {peutEditer && (
            <button onClick={() => handleChangerStatut("REFUSE")} disabled={action} style={boutonDangerStyle}>
              {t("venteMarkRefusedButton")}
            </button>
          )}
          {peutValider && (
            <button onClick={handleValider} disabled={action} style={boutonPrincipalStyle}>
              {t("venteValidateDevisButton")}
            </button>
          )}
          {devis.facture ? (
            <Link href={`/marches/consultation-restreinte/factures/${devis.facture.id}`} style={boutonSecondaireStyle}>
              {t("venteViewInvoiceButton")} ({devis.facture.numero})
            </Link>
          ) : (
            peutFacturer && (
              <>
                <input
                  placeholder={t("venteReferenceBcPlaceholder")}
                  value={referenceBc}
                  onChange={(e) => setReferenceBc(e.target.value)}
                  style={{ ...inputStyleCompact, width: 140 }}
                />
                <button onClick={handleGenererFacture} disabled={action} style={boutonPrincipalStyle}>
                  {t("venteGenerateInvoiceButton")}
                </button>
              </>
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
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{devis.numero}</div>
            <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{new Date(devis.date_devis).toLocaleDateString()}</div>
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--sub)", textTransform: "uppercase" }}>{t("venteBillToLabel")}</div>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{devis.client_nom}</div>
          {devis.client_adresse && <div style={{ fontSize: 12, color: "var(--sub)" }}>{devis.client_adresse}</div>}
          {devis.objet && <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>{t("venteObjetLabel")} : {devis.objet}</div>}
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
            {devis.lignes.map((l) => (
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
            <span className="mono">{Number(devis.total_ht).toLocaleString()} XOF</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--sub)" }}>
            <span>{t("venteTvaLabel")} ({Number(devis.taux_tva_pourcentage)}%)</span>
            <span className="mono">{Number(devis.montant_tva).toLocaleString()} XOF</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, color: "var(--petrol)" }}>
            <span>{t("venteTotalTtcLabel")}</span>
            <span className="mono">{Number(devis.total_ttc).toLocaleString()} XOF</span>
          </div>
        </div>

        {(devis.conditions_paiement || devis.delai_livraison || devis.validite_offre) && (
          <div style={{ marginTop: 18, fontSize: 11.5, color: "var(--sub)", display: "grid", gap: 3 }}>
            {devis.conditions_paiement && <div>{t("venteConditionsPaiementLabel")} : {devis.conditions_paiement}</div>}
            {devis.delai_livraison && <div>{t("venteDelaiLivraisonLabel")} : {devis.delai_livraison}</div>}
            {devis.validite_offre && <div>{t("venteValiditeOffreLabel")} : {devis.validite_offre}</div>}
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
  textDecoration: "none",
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
