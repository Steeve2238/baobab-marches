"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import FinancementSousNav from "../../../../lib/components/financement/FinancementSousNav";
import BanqueForm from "../../../../lib/components/financement/BanqueForm";
import { TYPES_ORDRE, jour, Pastille, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, boutonDangerStyle } from "../../../../lib/financementUi";

// Fiche d'une banque : identification + une ligne de conditions par type de
// financement. La creation d'une condition ouvre l'editeur, deja pre-rempli avec
// les lignes du type choisi (il ne reste qu'a saisir les taux).
export default function FinancementBanqueFichePage() {
  const { t } = useLangue();
  const { id } = useParams();
  const router = useRouter();
  const [banque, setBanque] = useState(null);
  const [form, setForm] = useState(null);
  const [typeNouveau, setTypeNouveau] = useState("");
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function charger() {
    try {
      const b = await api.finBanque(id);
      setBanque(b);
      setForm(b);
    } catch (e) {
      setErreur(e.message);
    }
  }
  useEffect(() => {
    charger();
  }, [id]);

  async function enregistrer(e) {
    e.preventDefault();
    setErreur("");
    setMessage("");
    setEnvoi(true);
    try {
      await api.finMajBanque(id, form);
      setMessage(t("finSaved"));
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  async function creerConditions() {
    if (!typeNouveau) return;
    setErreur("");
    try {
      const c = await api.finCreerCondition({ partenaire_id: id, type_facilite: typeNouveau });
      router.push(`/financement/conditions/${c.id}`);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function supprimer() {
    if (!window.confirm(t("finConfirmDelete"))) return;
    try {
      await api.finSupprimerBanque(id);
      router.push("/financement/banques");
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <AppShell title={t("finTitle")} subNav={<FinancementSousNav />} backHref="/financement/banques">
      {!banque ? (
        <p style={{ fontSize: 12.5, color: erreur ? "var(--brique)" : "var(--sub)" }}>{erreur || t("finLoading")}</p>
      ) : (
        <>
          <h2 style={{ fontSize: 16, color: "var(--petrol)", marginBottom: 12 }}>{banque.nom}</h2>
          <form onSubmit={enregistrer} className="card" style={{ marginBottom: 18 }}>
            <h3 style={{ fontSize: 14, color: "var(--petrol)", marginBottom: 10 }}>{t("finBanqueFiche")}</h3>
            <BanqueForm valeur={form} onChange={setForm} />
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
              <button type="submit" disabled={envoi} style={boutonPrincipalStyle}>
                {envoi ? t("finSaving") : t("finSave")}
              </button>
              <button type="button" onClick={supprimer} style={boutonDangerStyle}>
                {t("finBanqueSupprimer")}
              </button>
              {message && <span style={{ color: "var(--vert)", fontSize: 12.5 }}>{message}</span>}
              {erreur && <span style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</span>}
            </div>
          </form>

          <h3 style={{ fontSize: 14, color: "var(--petrol)", marginBottom: 8 }}>{t("finBanqueConditions")}</h3>
          <div className="card" style={{ marginBottom: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select value={typeNouveau} onChange={(e) => setTypeNouveau(e.target.value)} style={{ ...inputStyle, maxWidth: 360 }}>
              <option value="">{t("finBanqueChoisirType")}</option>
              {TYPES_ORDRE.map((code) => (
                <option key={code} value={code}>
                  {t(`finType_${code}`)}
                </option>
              ))}
            </select>
            <button type="button" disabled={!typeNouveau} onClick={creerConditions} style={boutonPrincipalStyle}>
              + {t("finBanqueAjouterConditions")}
            </button>
          </div>
          {banque.conditions.length === 0 ? (
            <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("finBanqueAucuneCondition")}</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {banque.conditions.map((c) => (
                <div key={c.id} className="card" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", opacity: c.statut === "ARCHIVEE" ? 0.6 : 1 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t(`finType_${c.type_facilite}`)}</div>
                    <div style={{ fontSize: 12, color: "var(--sub)" }}>
                      {c.libelle}
                      {c.reference_proposition ? ` — ${c.reference_proposition}` : ""}
                      {c.date_proposition ? ` — ${jour(c.date_proposition)}` : ""}
                    </div>
                    <div style={{ fontSize: 11.5, marginTop: 3, color: c.nb_lignes_a_renseigner > 0 ? "var(--ocre)" : "var(--vert)" }}>
                      {c.nb_lignes_a_renseigner > 0 ? `${c.nb_lignes_a_renseigner} ${t("finBanqueLignesARenseigner")}` : t("finBanqueLignesOk")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Pastille couleur={c.statut === "ACTIVE" ? "var(--vert)" : c.statut === "ARCHIVEE" ? "var(--sub)" : "var(--ocre)"}>{t(`finStatut_${c.statut}`)}</Pastille>
                    <Link href={`/financement/conditions/${c.id}`} style={{ ...boutonSecondaireStyle, textDecoration: "none" }}>
                      {t("finEdit")}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
