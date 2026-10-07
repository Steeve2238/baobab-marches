"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, estAdmin, getUtilisateurCourant } from "../../../../../lib/api";
import { useLangue } from "../../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../../lib/components/AppShell";
import MontantLettresBloc from "../../../../../lib/components/MontantLettresBloc";

// Formate une date "YYYY-MM-DD" en "JJ/MM/AAAA" sans jamais passer par un
// objet Date JS (qui reintroduirait une conversion de fuseau horaire cote
// navigateur) - voir le correctif equivalent cote serveur dans db.js.
function formaterDateAffichage(valeur) {
  if (!valeur) return "";
  const [annee, mois, jour] = String(valeur).slice(0, 10).split("-");
  return `${jour}/${mois}/${annee}`;
}

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
  // Numero manuel (ADMIN, chantier du 01/10/2026) : peut ne pas suivre le
  // format "AAAA-NNN" genere automatiquement - dans ce cas on l'affiche tel
  // quel, sans tenter d'y inserer le mois.
  if (!/^\d{4}-\d+$/.test(numero)) return numero;
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

  // Personnalise dynamiquement document.title (numero de facture + entreprise
  // du tenant) car document.title est injecte par le navigateur dans
  // l'en-tete/pied de page natif de l'impression - voir metadata globale
  // dans app/layout.js (titre "Baobab Marches" par defaut, ne pas modifier).
  useEffect(() => {
    if (!facture || !entete) return;
    const titrePrecedent = document.title;
    document.title = `${entete.raison_sociale || ""} - ${facture.numero}`.trim();
    return () => {
      document.title = titrePrecedent;
    };
  }, [facture, entete]);

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
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, ...style }}>
            {t(`venteFactureStatut_${facture.statut}`)}
          </span>
          {facture.type_facturation !== "INTEGRALE" && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, color: "var(--petrol)", background: "rgba(20,79,85,0.1)" }}>
              {t(`venteFactureType_${facture.type_facturation}`)}
              {facture.type_facturation === "ACOMPTE" ? ` ${Number(facture.pourcentage_acompte)}%` : ""}
            </span>
          )}
        </div>
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
          {(facture.bons_livraison || []).map((b) => (
            <Link key={b.id} href={`/marches/consultation-restreinte/bl/${b.id}`} style={boutonSecondaireStyle}>
              {t("venteViewBlButton")} ({numeroAffiche(b.numero, facture.mois_emission)}{b.rang > 1 ? `/${b.rang}` : ""} · {t(`venteBlStatut_${b.statut}`)})
            </Link>
          ))}
          {peutFacturer && facture.statut !== "ANNULEE" && facture.peut_generer_bl && (
            <button onClick={handleGenererBl} disabled={action} style={boutonPrincipalStyle}>
              {(facture.bons_livraison || []).length === 0 ? t("venteGenerateBlButton") : t("venteGenerateNextBlButton")}
            </button>
          )}
          <button onClick={() => window.print()} style={boutonSecondaireStyle}>
            {t("print")}
          </button>
        </div>
      </div>

      {(facture.bons_livraison || []).length > 0 && (
        <div className="card no-print" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{t("venteLivraisonSuiviTitre")}</div>
            <span
              style={{
                fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
                ...(facture.livraison_statut === "LIVREE"
                  ? { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" }
                  : { color: "var(--ocre)", background: "rgba(224,149,76,0.12)" }),
              }}
            >
              {t(`venteLivraisonStatut_${facture.livraison_statut}`)}
              {facture.livraison_statut === "PARTIELLE" ? ` · ${t("venteResteALivrerLabel")} ${Number(facture.reste_a_livrer_total).toLocaleString()}` : ""}
            </span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ fontSize: 11, textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                <th style={{ padding: "6px 4px" }}>{t("venteDesignationLabel")}</th>
                <th style={{ padding: "6px 4px", textAlign: "right" }}>{t("venteQuantiteFactureeLabel")}</th>
                <th style={{ padding: "6px 4px", textAlign: "right" }}>{t("venteDejaLivreeLabel")}</th>
                <th style={{ padding: "6px 4px", textAlign: "right" }}>{t("venteResteALivrerLabel")}</th>
              </tr>
            </thead>
            <tbody>
              {facture.lignes.map((l) => (
                <tr key={l.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                  <td style={{ padding: "6px 4px", fontSize: 12.5 }}>{l.designation}</td>
                  <td className="mono" style={{ padding: "6px 4px", fontSize: 12.5, textAlign: "right" }}>{Number(l.quantite).toLocaleString()}</td>
                  <td className="mono" style={{ padding: "6px 4px", fontSize: 12.5, textAlign: "right" }}>{Number(l.deja_livree).toLocaleString()}</td>
                  <td className="mono" style={{ padding: "6px 4px", fontSize: 12.5, textAlign: "right", fontWeight: 700, color: Number(l.reste_a_livrer) > 0 ? "var(--ocre)" : "#2E7D5B" }}>
                    {Number(l.reste_a_livrer).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
            <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{formaterDateAffichage(facture.date_facture)}</div>
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
              {(facture.lignes || []).some((l) => l.reference) && <th style={{ padding: "6px 4px" }}>{t("venteReferenceLabel")}</th>}
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
                {(facture.lignes || []).some((l) => l.reference) && <td className="mono" style={{ padding: "6px 4px", fontSize: 12 }}>{l.reference || ""}</td>}
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
          {Number(facture.pourcentage_remise) > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--brique)" }}>
                <span>{t("venteRemiseLabel")} ({Number(facture.pourcentage_remise)}%)</span>
                <span className="mono">-{Number(facture.montant_remise).toLocaleString()} XOF</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span>{t("venteTotalHtNetLabel")}</span>
                <span className="mono">{(Number(facture.total_ht) - Number(facture.montant_remise)).toLocaleString()} XOF</span>
              </div>
            </>
          )}
          {Number(facture.taux_tva_pourcentage) > 0 ? (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--sub)" }}>
              <span>{t("venteTvaLabel")} ({Number(facture.taux_tva_pourcentage)}%)</span>
              <span className="mono">{Number(facture.montant_tva).toLocaleString()} XOF</span>
            </div>
          ) : (
            facture.client_exonere_tva && (
              <div style={{ fontSize: 12, color: "var(--sub)", textAlign: "right" }}>
                {t("venteExonereTvaMention")}
                {facture.client_motif_exoneration_tva ? ` (${facture.client_motif_exoneration_tva})` : ""}
              </div>
            )
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, color: "var(--petrol)" }}>
            <span>{t("venteTotalTtcLabel")}</span>
            <span className="mono">{Number(facture.total_ttc).toLocaleString()} XOF</span>
          </div>
        </div>

        {/* Mention acompte/solde + net a payer (migration 024, demande de
            Steeve du 30/09/2026) : le detail ci-dessus reste TOUJOURS le
            detail complet et inchange du devis (valeur de reference du
            marche) - c'est ce bloc, place en bas de facture, qui indique le
            pourcentage applique et ce qui est reellement du sur CE document
            precis, distinct du total TTC du devis entier. Absent pour une
            facture INTEGRALE (le net a payer y est deja egal au total TTC
            affiche ci-dessus). */}
        {facture.type_facturation !== "INTEGRALE" && (
          <div
            style={{
              marginTop: 14,
              marginLeft: "auto",
              maxWidth: 260,
              display: "grid",
              gap: 4,
              padding: "10px 14px",
              borderRadius: 8,
              background: "rgba(20,79,85,0.06)",
              border: "1px solid var(--line)",
            }}
          >
            <div style={{ fontSize: 11.5, color: "var(--sub)" }}>
              {facture.type_facturation === "ACOMPTE"
                ? `${t("venteAcompteMentionLabel")} ${Number(facture.pourcentage_acompte)}%`
                : t("venteSoldeMentionLabel")}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5, fontWeight: 700, color: "var(--petrol)" }}>
              <span>{t("venteNetAPayerLabel")}</span>
              <span className="mono">{Number(facture.montant_net_a_payer).toLocaleString()} XOF</span>
            </div>
          </div>
        )}

        <MontantLettresBloc
          label={
            facture.type_facturation === "ACOMPTE"
              ? t("venteFactureArreteAcompteLabel")
              : facture.type_facturation === "SOLDE"
                ? t("venteFactureArreteSoldeLabel")
                : t("venteFactureArreteLabel")
          }
          montant={facture.type_facturation && facture.type_facturation !== "INTEGRALE" ? facture.montant_net_a_payer : facture.total_ttc}
        />

        {facture.statut === "PAYEE" && (
          <div className="no-print" style={{ marginTop: 14, fontSize: 11.5, color: "var(--sub)" }}>
            {t("saPaidOn")} {new Date(facture.date_paiement).toLocaleDateString()}
            {facture.mode_paiement ? ` · ${facture.mode_paiement}` : ""}
          </div>
        )}

        <div style={{ marginTop: 110, textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 12.5 }}>{entete?.signataire_nom}</div>
          <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{entete?.signataire_titre}</div>
          {entete?.signature_cachet_base64 && (
            <img
              src={`data:${entete.signature_cachet_type_mime};base64,${entete.signature_cachet_base64}`}
              alt="signature et cachet"
              style={{ maxWidth: 150, maxHeight: 100, objectFit: "contain", marginTop: 8 }}
            />
          )}
        </div>

        {piedDePage(entete).length > 0 && (
          <div
            style={{
              marginTop: 40,
              paddingTop: 12,
              borderTop: "1px solid var(--line)",
              textAlign: "center",
              fontSize: 10.5,
              color: "var(--sub)",
            }}
          >
            {piedDePage(entete).join(" · ")}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// Pied de page (mentions legales) des documents imprimables - RCCM, NINEA,
// site web, coordonnees bancaires (voir migration
// 018_facturation_entete_pied_de_page.sql) : seuls les champs renseignes par
// l'entreprise s'affichent, rien n'est obligatoire.
function piedDePage(entete) {
  return [
    entete?.rccm ? `RCCM ${entete.rccm}` : null,
    entete?.ninea ? `NINEA ${entete.ninea}` : null,
    entete?.site_web || null,
    entete?.coordonnees_bancaires || null,
  ].filter(Boolean);
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
