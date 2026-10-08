"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import PaieSousNav from "../../../../lib/components/PaieSousNav";
import DmtForm, { donneesVersApi } from "../../../../lib/components/DmtForm";
import { boutonPrincipal } from "../../../../lib/components/rhUi";

export default function NouvelleDmtPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [pre, setPre] = useState(null);
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    api
      .getDmtPrefill(q.get("employe_id") || "", q.get("objet") || "EMBAUCHE", q.get("contrat_id"))
      .then((p) => {
        setPre(p);
        setDonnees(p.donnees);
      })
      .catch((e) => setErreur(e.message));
  }, []);

  async function creer(e) {
    e.preventDefault();
    setEnCours(true);
    setErreur("");
    try {
      const d = await api.createDmt({ employe_id: pre.employe_id, contrat_id: pre.contrat_id, date_dmt: pre.date_dmt, donnees: donneesVersApi(donnees) });
      router.push(`/rh/dmt/${d.id}`);
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  }

  return (
    <AppShell title={t("rhdmNouvelleTitre")} subNav={<PaieSousNav />}>
      <Link href="/rh/dmt" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("rhdmRetour")}</Link>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {donnees ? (
        <form onSubmit={creer} style={{ maxWidth: 980 }}>
          {pre.contrat_id && <p style={{ fontSize: 12, color: "var(--sub)", marginTop: 0 }}>{t("rhdmGenererDepuis")}</p>}
          <DmtForm donnees={donnees} setDonnees={setDonnees} t={t} />
          <button type="submit" disabled={enCours} style={{ ...boutonPrincipal, marginTop: 16, padding: "9px 20px", fontSize: 13 }}>{enCours ? t("rhcCreation") : t("rhdmCreer")}</button>
        </form>
      ) : (
        !erreur && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      )}
    </AppShell>
  );
}
