"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, estAdmin, getUtilisateurCourant } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import ConsultationRestreinteSousNav from "../../../../lib/components/ConsultationRestreinteSousNav";

// Meme helper que la fiche devis (devis/[id]/page.js) - duplique ici faute
// d'un module de permissions partage pour ces deux pages.
function possedeRole(codes) {
  if (estAdmin()) return true;
  const user = getUtilisateurCourant();
  return Array.isArray(user?.roles) && user.roles.some((r) => codes.includes(r));
}

const STATUT_STYLE = {
  BROUILLON: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
  ENVOYE: { color: "var(--ocre)", background: "rgba(224,149,76,0.12)" },
  VALIDE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  REFUSE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  EXPIRE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};
const FILTRES = ["BROUILLON", "ENVOYE", "VALIDE", "REFUSE", "EXPIRE", "TOUTES"];

export default function DevisListePage() {
  const { t } = useLangue();
  const [devisListe, setDevisListe] = useState([]);
  const [filtre, setFiltre] = useState("TOUTES");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [permissions, setPermissions] = useState(null);
  const [suppressionEnCours, setSuppressionEnCours] = useState(null);

  useEffect(() => {
    setChargement(true);
    api
      .getDevisListe(filtre === "TOUTES" ? undefined : filtre)
      .then(setDevisListe)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, [filtre]);

  useEffect(() => {
    api.getPermissions().then(setPermissions).catch(() => {});
  }, []);

  // Changement de client et suppression (chantier du 02/10/2026, demande de
  // Steeve : "pouvoir supprimer les devis inutiles... quand c'est trop
  // encombre") - reserve au DG/Directeur Financier ou ADMIN, meme principe
  // que sur la fiche devis (devis/[id]/page.js).
  const peutSupprimer = possedeRole(["DIRECTION"]) || !!permissions?.validateurUniversel;

  async function handleSupprimer(e, devis) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof window !== "undefined" && !window.confirm(t("venteDevisDeleteConfirm"))) return;
    setSuppressionEnCours(devis.id);
    setErreur("");
    try {
      await api.supprimerDevis(devis.id);
      setDevisListe((prev) => prev.filter((d) => d.id !== devis.id));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setSuppressionEnCours(null);
    }
  }

  return (
    <AppShell title={t("venteDevisPageTitle")} subNav={<ConsultationRestreinteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {FILTRES.map((f) => (
            <button
              key={f}
              onClick={() => setFiltre(f)}
              style={{
                ...filtreBtnStyle,
                background: filtre === f ? "var(--petrol)" : "transparent",
                color: filtre === f ? "#fff" : "var(--petrol)",
              }}
            >
              {f === "TOUTES" ? t("saFilterAll") : t(`venteDevisStatut_${f}`)}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/marches/consultation-restreinte/devis/importer" style={boutonSecondaireStyle}>
            {t("venteImportDevisListeButton")}
          </Link>
          <Link href="/marches/consultation-restreinte/devis/nouveau" style={boutonPrincipalStyle}>
            {t("venteNewDevisButton")}
          </Link>
        </div>
      </div>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : devisListe.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("venteNoDevis")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {devisListe.map((d) => {
            const style = STATUT_STYLE[d.statut] || {};
            return (
              <div key={d.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <Link href={`/marches/consultation-restreinte/devis/${d.id}`} style={{ textDecoration: "none", color: "inherit", flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {d.numero} — {d.client_nom}
                    {d.importe && (
                      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20, color: "var(--sub)", background: "rgba(91,106,108,0.1)" }}>
                        {t("venteDevisHistoriqueBadge")}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>
                    {d.objet || "—"} · {Number(d.total_ttc).toLocaleString()} XOF TTC
                  </div>
                </Link>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", ...style }}>
                  {t(`venteDevisStatut_${d.statut}`)}
                </span>
                {peutSupprimer && !d.a_facture && (
                  <button
                    onClick={(e) => handleSupprimer(e, d)}
                    disabled={suppressionEnCours === d.id}
                    title={t("venteDevisDeleteButton")}
                    style={boutonSupprimerStyle}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

const filtreBtnStyle = {
  border: "1px solid var(--line)",
  borderRadius: 20,
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 600,
};
const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
  textDecoration: "none",
  display: "inline-block",
};
const boutonSecondaireStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 12.5,
  fontWeight: 600,
  textDecoration: "none",
  display: "inline-block",
  whiteSpace: "nowrap",
};
// Bouton de suppression par devis (chantier du 02/10/2026) - meme style que
// le "×" de suppression de ligne sur la fiche devis (devis/[id]/page.js).
const boutonSupprimerStyle = {
  background: "transparent",
  color: "var(--brique)",
  border: "none",
  fontSize: 18,
  fontWeight: 700,
  cursor: "pointer",
  lineHeight: 1,
  padding: "0 4px",
};
