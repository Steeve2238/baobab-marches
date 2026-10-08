"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import CourrierForm, { courrierFormInitial, courrierFormVersCorps } from "../../../../lib/components/CourrierForm";
import { boutonPrincipal } from "../../../../lib/components/rhUi";

export default function NouveauCourrierPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [form, setForm] = useState(null);
  const [def, setDef] = useState(null);
  const [ids, setIds] = useState({ employe_id: "", type: "" });
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const eid = q.get("employe_id") || "";
    const type = q.get("type") || "";
    setIds({ employe_id: eid, type });
    Promise.all([api.getCourrierTypes(), api.getCourrierPrefill(eid, type)])
      .then(([types, p]) => {
        setDef(types.find((x) => x.type === type));
        setForm(courrierFormInitial(p));
      })
      .catch((e) => setErreur(e.message));
  }, []);

  async function creer(e) {
    e.preventDefault();
    setEnCours(true);
    setErreur("");
    try {
      const c = await api.createCourrier({ ...ids, ...courrierFormVersCorps(form) });
      router.push(`/rh/courriers/${c.id}`);
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  }

  return (
    <AppShell title={t("rhkNouveau")}>
      <Link href="/rh/courriers" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("rhkRetour")}</Link>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {!form || !def ? (
        !erreur && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : (
        <form onSubmit={creer} style={{ maxWidth: 900, display: "grid", gap: 14 }}>
          <CourrierForm t={t} def={def} form={form} setForm={setForm} />
          <div><button type="submit" disabled={enCours} style={boutonPrincipal}>{t("rhkCreer")}</button></div>
        </form>
      )}
    </AppShell>
  );
}
