"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import FinancementSousNav from "../../../lib/components/financement/FinancementSousNav";
import BanqueForm from "../../../lib/components/financement/BanqueForm";
import { fmtXof, Pastille, boutonPrincipalStyle, boutonSecondaireStyle } from "../../../lib/financementUi";

// Liste des banques du client. Chaque banque mene a sa fiche, ou l'on saisit ses
// conditions par type de financement (aval de traite, affacturage, cautions...).
export default function FinancementBanquesPage() {
  const { t, dict } = useLangue();
  const router = useRouter();
  const locale = dict.dateLocale || "fr-FR";
  const [banques, setBanques] = useState(null);
  const [ouvert, setOuvert] = useState(false);
  const [form, setForm] = useState({ type_partenaire: "BANQUE", actif: true });
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  const charger = () => api.finBanques().then(setBanques).catch((e) => setErreur(e.message));
  useEffect(() => {
    charger();
  }, []);

  async function creer(e) {
    e.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const b = await api.finCreerBanque(form);
      router.push(`/financement/banques/${b.id}`);
    } catch (err) {
      setErreur(err.message);
      setEnvoi(false);
    }
  }

  return (
    <AppShell title={t("finTitle")} subNav={<FinancementSousNav />}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, color: "var(--petrol)", marginBottom: 4 }}>{t("finBanquesTitre")}</h2>
          <p style={{ fontSize: 12.5, color: "var(--sub)", maxWidth: 760, lineHeight: 1.55 }}>{t("finBanquesIntro")}</p>
        </div>
        <button type="button" onClick={() => setOuvert((v) => !v)} style={boutonPrincipalStyle}>
          {ouvert ? t("finCancel") : `+ ${t("finBanqueNouvelle")}`}
        </button>
      </div>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 10 }}>{erreur}</p>}

      {ouvert && (
        <form onSubmit={creer} className="card" style={{ marginBottom: 16 }}>
          <BanqueForm valeur={form} onChange={setForm} />
          <button type="submit" disabled={envoi} style={{ ...boutonPrincipalStyle, marginTop: 14 }}>
            {envoi ? t("finSaving") : t("finSave")}
          </button>
        </form>
      )}

      {banques === null ? (
        !erreur && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("finLoading")}</p>
      ) : banques.length === 0 ? (
        <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("finBanqueAucune")}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {banques.map((b) => (
            <div key={b.id} className="card" style={{ opacity: b.actif ? 1 : 0.65 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                    {b.nom}
                    {b.sigle ? ` (${b.sigle})` : ""}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--sub)" }}>
                    {t(`finTypePartenaire_${b.type_partenaire}`)}
                    {b.agence ? ` — ${b.agence}` : ""}
                  </div>
                </div>
                {!b.actif && <Pastille>{t("finBanqueInactive")}</Pastille>}
              </div>
              <div style={{ fontSize: 12.5, marginTop: 10 }}>
                <b>{b.nb_conditions}</b> {t("finBanqueNbConditions")}
                {b.nb_conditions_actives > 0 && <span style={{ color: "var(--vert)" }}> ({b.nb_conditions_actives} {t("finStatut_ACTIVE").toLowerCase()})</span>}
              </div>
              {Number(b.cout_retenu_xof) > 0 && (
                <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>
                  {t("finBanqueCoutRetenu")} : <b className="mono">{fmtXof(b.cout_retenu_xof, locale)} {t("finXof")}</b>
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <Link href={`/financement/banques/${b.id}`} style={{ ...boutonSecondaireStyle, textDecoration: "none", display: "inline-block" }}>
                  {t("finOpen")}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
