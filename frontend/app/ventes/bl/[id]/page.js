"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, estAdmin, getUtilisateurCourant } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";

const STATUT_STYLE = {
  BROUILLON: { color: "var(--ocre)", background: "rgba(224,149,76,0.12)" },
  LIVRE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
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

export default function BlDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useLangue();
  const [bl, setBl] = useState(null);
  const [entete, setEntete] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [action, setAction] = useState(false);
  const [lignesEdition, setLignesEdition] = useState([]);

  function charger() {
    Promise.all([api.getBl(params.id), api.getEntete(), api.getParametresVentes()])
      .then(([blData, enteteData, parametresData]) => {
        setBl(blData);
        setLignesEdition(blData.lignes.map((l) => ({ ...l })));
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

  function majQuantite(index, valeur) {
    setLignesEdition((prev) => prev.map((l, i) => (i === index ? { ...l, quantite_livree: valeur } : l)));
  }

  async function handleEnregistrerLignes() {
    setAction(true);
    setErreur("");
    try {
      const maj = await api.patchBl(bl.id, {
        lignes: lignesEdition.map((l) => ({ designation: l.designation, unite: l.unite, quantite_livree: Number(l.quantite_livree) })),
      });
      setBl(maj);
      setLignesEdition(maj.lignes.map((l) => ({ ...l })));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setAction(false);
    }
  }

  async function handleMarquerLivre() {
    setAction(true);
    setErreur("");
    try {
      const maj = await api.marquerBlLivre(bl.id);
      setBl((prev) => ({ ...prev, ...maj }));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setAction(false);
    }
  }

  if (chargement) {
    return (
      <AppShell title={t("venteBlDetailTitle")} backHref="/ventes/bl">
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </AppShell>
    );
  }
  if (!bl) {
    return (
      <AppShell title={t("venteBlDetailTitle")} backHref="/ventes/bl">
        {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      </AppShell>
    );
  }

  const style = STATUT_STYLE[bl.statut] || {};
  const peutFacturer = possedeRole(["COMPTABLE", "FINANCIER"]);
  const modifiable = bl.statut === "BROUILLON" && peutFacturer;
  const numeroComplet = numeroAffiche(bl.numero, bl.mois_emission);

  return (
    <AppShell title={`BL-${numeroComplet}`} backHref="/ventes/bl">
      {erreur && <p className="no-print" style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, ...style }}>
          {t(`venteBlStatut_${bl.statut}`)}
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {modifiable && (
            <button onClick={handleEnregistrerLignes} disabled={action} style={boutonSecondaireStyle}>
              {t("save")}
            </button>
          )}
          {modifiable && (
            <button onClick={handleMarquerLivre} disabled={action} style={boutonPrincipalStyle}>
              {t("venteMarkDeliveredButton")}
            </button>
          )}
          <button onClick={() => window.print()} style={boutonSecondaireStyle}>
            {t("print")}
          </button>
        </div>
      </div>

      {modifiable && (
        <p className="no-print" style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 12 }}>{t("venteBlPartialNote")}</p>
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
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t("venteBlNumberLabel")} BL-{numeroComplet}</div>
            <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{new Date(bl.date_bl).toLocaleDateString()}</div>
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--sub)", textTransform: "uppercase" }}>{t("venteDeliverToLabel")}</div>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{bl.client_nom}</div>
          {bl.client_adresse && <div style={{ fontSize: 12, color: "var(--sub)" }}>{bl.client_adresse}</div>}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ fontSize: 11, textAlign: "left", borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "6px 4px" }}>{t("venteDesignationLabel")}</th>
              <th style={{ padding: "6px 4px" }}>{t("venteUniteLabel")}</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>{t("venteQuantiteLivreeLabel")}</th>
            </tr>
          </thead>
          <tbody>
            {(modifiable ? lignesEdition : bl.lignes).map((l, index) => (
              <tr key={l.id || index} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                <td style={{ padding: "6px 4px", fontSize: 12.5 }}>{l.designation}</td>
                <td style={{ padding: "6px 4px", fontSize: 12.5 }}>{l.unite}</td>
                <td style={{ padding: "6px 4px", fontSize: 12.5, textAlign: "right" }}>
                  {modifiable ? (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.quantite_livree}
                      onChange={(e) => majQuantite(index, e.target.value)}
                      style={{ ...inputStyleCompact, width: 90, textAlign: "right" }}
                    />
                  ) : (
                    <span className="mono">{Number(l.quantite_livree).toLocaleString()}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 40, display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("venteReceivedBySignature")}</div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>{entete?.signataire_nom}</div>
            <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{entete?.signataire_titre}</div>
          </div>
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
};
const inputStyleCompact = {
  padding: "5px 8px",
  border: "1px solid var(--line)",
  borderRadius: 6,
  fontSize: 12.5,
  fontFamily: "inherit",
};
