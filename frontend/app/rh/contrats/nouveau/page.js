"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import PaieSousNav from "../../../../lib/components/PaieSousNav";
import ContratForm, { contratFormInitial, contratFormVersCorps } from "../../../../lib/components/ContratForm";
import { boutonPrincipal } from "../../../../lib/components/rhUi";

export default function NouveauContratPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [form, setForm] = useState(null);
  const [employeId, setEmployeId] = useState("");
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const eid = q.get("employe_id") || "";
    setEmployeId(eid);
    api
      .getContratPrefill(eid, q.get("type") || "CDI")
      .then((p) => setForm(contratFormInitial(p)))
      .catch((e) => setErreur(e.message));
  }, []);

  async function creer(e) {
    e.preventDefault();
    setEnCours(true);
    setErreur("");
    try {
      const c = await api.createContrat({ employe_id: employeId, ...contratFormVersCorps(form) });
      router.push(`/rh/contrats/${c.id}`);
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  }

  return (
    <AppShell title={t("rhcNouveauTitre")} subNav={<PaieSousNav />}>
      <Link href="/rh/contrats" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("rhcRetour")}</Link>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {form ? (
        <form onSubmit={creer} style={{ maxWidth: 980 }}>
          <ContratForm form={form} setForm={setForm} t={t} />
          <button type="submit" disabled={enCours} style={{ ...boutonPrincipal, marginTop: 16, padding: "9px 20px", fontSize: 13 }}>
            {enCours ? t("rhcCreation") : t("rhcCreer")}
          </button>
        </form>
      ) : (
        !erreur && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      )}
    </AppShell>
  );
}
