"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import PrestationForm, { prestationFormInitial, prestationFormVersCorps } from "../../../lib/components/PrestationForm";
import { boutonPrincipal } from "../../../lib/components/rhUi";

export default function NouveauContratPrestationPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [form, setForm] = useState(null);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    api.prestationPrefill(q.get("fournisseur_id") || "").then((p) => setForm(prestationFormInitial(p))).catch((e) => setErreur(e.message));
    api.prestationFournisseurs().then(setFournisseurs).catch(() => {});
  }, []);

  async function creer(e) {
    e.preventDefault();
    setEnCours(true);
    setErreur("");
    try {
      const c = await api.prestationCreer(prestationFormVersCorps(form));
      router.push(`/contrats-prestation/${c.id}`);
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  }

  return (
    <AppShell title={t("prsNouveauTitre")}>
      <Link href="/contrats-prestation" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("prsRetour")}</Link>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {form ? (
        <form onSubmit={creer} style={{ maxWidth: 980 }}>
          <PrestationForm form={form} setForm={setForm} t={t} fournisseurs={fournisseurs} />
          <button type="submit" disabled={enCours} style={{ ...boutonPrincipal, marginTop: 16, padding: "9px 20px", fontSize: 13 }}>
            {enCours ? t("prsCreation") : t("prsCreer")}
          </button>
        </form>
      ) : (
        !erreur && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      )}
    </AppShell>
  );
}
