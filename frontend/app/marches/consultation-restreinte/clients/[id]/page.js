"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../../lib/api";
import { useLangue } from "../../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../../lib/components/AppShell";

// "Compte client" (30/09/2026, en complement de la facturation en plusieurs
// fois - acompte/solde - migration 024) : vue consolidee de ce qu'un client
// doit au total, tous devis confondus, plus le detail devis par devis
// (facture/reste a facturer) et facture par facture. Lecture seule - toutes
// les actions (marquer payee, generer une facture...) restent sur les fiches
// devis/facture elles-memes, cette page ne fait qu'agreger leur etat.
const DEVIS_STATUT_STYLE = {
  BROUILLON: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
  ENVOYE: { color: "var(--ocre)", background: "rgba(224,149,76,0.12)" },
  VALIDE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  REFUSE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  EXPIRE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};
const FACTURE_STATUT_STYLE = {
  IMPAYEE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  PAYEE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  ANNULEE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};

function numeroAffiche(numero, mois) {
  // Numero manuel (ADMIN, chantier du 01/10/2026) : peut ne pas suivre le
  // format "AAAA-NNN" genere automatiquement - dans ce cas on l'affiche tel
  // quel, sans tenter d'y inserer le mois.
  if (!/^\d{4}-\d+$/.test(numero)) return numero;
  const [annee, sequence] = numero.split("-");
  return `${annee}-${String(mois).padStart(2, "0")}-${sequence}`;
}

export default function CompteClientPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useLangue();
  const [compte, setCompte] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    api
      .getCompteClient(params.id)
      .then(setCompte)
      .catch((err) => {
        if (err.status === 401) {
          router.push("/login");
          return;
        }
        setErreur(err.message);
      })
      .finally(() => setChargement(false));
  }, [params.id]);

  if (chargement) {
    return (
      <AppShell title={t("venteCompteClientPageTitle")} backHref="/marches/consultation-restreinte/clients" backLabelKey="backToClients">
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </AppShell>
    );
  }
  if (!compte) {
    return (
      <AppShell title={t("venteCompteClientPageTitle")} backHref="/marches/consultation-restreinte/clients" backLabelKey="backToClients">
        {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      </AppShell>
    );
  }

  const { client, totaux, devis, factures } = compte;

  return (
    <AppShell title={client.nom} backHref="/marches/consultation-restreinte/clients" backLabelKey="backToClients">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--sub)", textTransform: "uppercase", fontWeight: 700 }}>{t("venteCompteTotalFactureLabel")}</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--petrol)", marginTop: 4 }}>
            {Number(totaux.total_facture).toLocaleString()} XOF
          </div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--sub)", textTransform: "uppercase", fontWeight: 700 }}>{t("venteCompteTotalPayeLabel")}</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "#2E7D5B", marginTop: 4 }}>
            {Number(totaux.total_paye).toLocaleString()} XOF
          </div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--sub)", textTransform: "uppercase", fontWeight: 700 }}>{t("venteCompteSoldeDuLabel")}</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: Number(totaux.solde_du) > 0 ? "var(--brique)" : "#2E7D5B", marginTop: 4 }}>
            {Number(totaux.solde_du).toLocaleString()} XOF
          </div>
        </div>
      </div>

      <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10 }}>{t("venteCompteDevisSection")}</h3>
      {devis.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 24 }}>{t("venteCompteNoDevis")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8, marginBottom: 24 }}>
          {devis.map((d) => {
            const style = DEVIS_STATUT_STYLE[d.statut] || {};
            const resteAFacturer = Number(d.reste_a_facturer);
            return (
              <Link key={d.id} href={`/marches/consultation-restreinte/devis/${d.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{d.numero}</div>
                    {d.objet && <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>{d.objet}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 12 }}>
                    <div>
                      <span style={{ color: "var(--sub)" }}>{t("venteDejaFactureLabel")} : </span>
                      <span className="mono">{Number(d.deja_facture).toLocaleString()}</span>
                    </div>
                    <div>
                      <span style={{ color: "var(--sub)" }}>{t("venteResteAFacturerLabel")} : </span>
                      <span className="mono" style={{ color: resteAFacturer > 0.009 ? "var(--ocre)" : "#2E7D5B" }}>
                        {resteAFacturer.toLocaleString()}
                      </span>
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", ...style }}>
                      {t(`venteDevisStatut_${d.statut}`)}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10 }}>{t("venteCompteFacturesSection")}</h3>
      {factures.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("venteCompteNoFactures")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {factures.map((f) => {
            const style = FACTURE_STATUT_STYLE[f.statut] || {};
            return (
              <Link key={f.id} href={`/marches/consultation-restreinte/factures/${f.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                      {numeroAffiche(f.numero, f.mois_emission)}
                      {f.type_facturation !== "INTEGRALE" && (
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "var(--petrol)" }}>
                          {t(`venteFactureType_${f.type_facturation}`)}
                          {f.type_facturation === "ACOMPTE" ? ` ${Number(f.pourcentage_acompte)}%` : ""}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>{f.devis_numero}</div>
                  </div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <span className="mono" style={{ fontSize: 12.5 }}>{Number(f.montant_net_a_payer).toLocaleString()} XOF</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", ...style }}>
                      {t(`venteFactureStatut_${f.statut}`)}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
