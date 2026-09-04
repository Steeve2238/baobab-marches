"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { superAdminApi } from "../../../lib/superAdminApi";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import SuperAdminShell from "../../../lib/components/SuperAdminShell";

const STATUT_FACTURE_STYLE = {
  IMPAYEE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  PAYEE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  ANNULEE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};

const FILTRES = ["IMPAYEE", "PAYEE", "ANNULEE", "TOUTES"];

// Vue globale de toutes les factures (toutes entreprises confondues) - sert
// principalement a reperer d'un coup d'oeil les impayes a relancer.
// L'action elle-meme (generer une facture, marquer payee) reste sur la
// page detail de chaque client (voir clients/[id]/page.js) ; ici on garde
// une action rapide "marquer payee" pour aller vite sur les relances.
export default function SuperAdminFacturesPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [factures, setFactures] = useState([]);
  const [filtre, setFiltre] = useState("IMPAYEE");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [modePaiementFacture, setModePaiementFacture] = useState({});

  function charger(statutFiltre) {
    setChargement(true);
    superAdminApi
      .getFactures(statutFiltre === "TOUTES" ? undefined : statutFiltre)
      .then(setFactures)
      .catch((err) => {
        if (err.status === 401) {
          router.push("/super-admin/login");
          return;
        }
        setErreur(err.message);
      })
      .finally(() => setChargement(false));
  }

  useEffect(() => charger(filtre), [filtre, router]);

  async function handleMarquerPayee(factureId) {
    setErreur("");
    try {
      const maj = await superAdminApi.marquerFacturePayee(factureId, {
        mode_paiement: modePaiementFacture[factureId] || "",
      });
      setFactures((prev) =>
        filtre === "TOUTES" ? prev.map((f) => (f.id === factureId ? maj : f)) : prev.filter((f) => f.id !== factureId)
      );
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <SuperAdminShell title={t("saFacturesPageTitle")} backHref="/super-admin">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {FILTRES.map((f) => (
          <button
            key={f}
            onClick={() => setFiltre(f)}
            style={{
              ...filtreBtnStyle,
              background: filtre === f ? "#1E1508" : "transparent",
              color: filtre === f ? "#fff" : "var(--petrol)",
            }}
          >
            {f === "TOUTES" ? t("saFilterAll") : t(`saFactureStatut_${f}`)}
          </button>
        ))}
      </div>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : factures.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("saNoInvoices")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {factures.map((facture) => {
            const style = STATUT_FACTURE_STYLE[facture.statut] || {};
            return (
              <div key={facture.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <Link
                      href={`/super-admin/clients/${facture.tenant_id}`}
                      style={{ fontWeight: 600, fontSize: 13.5, color: "var(--petrol)" }}
                    >
                      {facture.client_raison_sociale}
                    </Link>
                    <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>
                      {facture.periode} — {facture.formule_nom} —{" "}
                      {Number(facture.montant_xof).toLocaleString()} XOF
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      padding: "3px 8px",
                      borderRadius: 20,
                      whiteSpace: "nowrap",
                      ...style,
                    }}
                  >
                    {t(`saFactureStatut_${facture.statut}`)}
                  </span>
                </div>
                {facture.statut === "IMPAYEE" && (
                  <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                    <input
                      placeholder={t("saPaymentModePlaceholder")}
                      value={modePaiementFacture[facture.id] || ""}
                      onChange={(e) =>
                        setModePaiementFacture((prev) => ({ ...prev, [facture.id]: e.target.value }))
                      }
                      style={{ ...inputStyle, width: 180 }}
                    />
                    <button onClick={() => handleMarquerPayee(facture.id)} style={boutonSecondaireStyle}>
                      {t("saMarkPaidButton")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SuperAdminShell>
  );
}

const filtreBtnStyle = {
  border: "1px solid var(--line)",
  borderRadius: 20,
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 600,
};
const inputStyle = {
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
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
