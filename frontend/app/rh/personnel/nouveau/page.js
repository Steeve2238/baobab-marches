"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import FicheEmployeForm, { formInitial, formVersCorps } from "../../../../lib/components/FicheEmployeForm";

export default function NouvelleFicheEmployePage() {
  const router = useRouter();
  const { t } = useLangue();
  const [form, setForm] = useState(() => formInitial(null));
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function handleCreer(e) {
    e.preventDefault();
    setEnCours(true);
    setErreur("");
    try {
      const nouvelle = await api.createFicheEmploye(formVersCorps(form));
      router.push(`/rh/personnel/${nouvelle.id}`);
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  }

  return (
    <AppShell title={t("rhdCreerTitre")}>
      <Link href="/rh/personnel" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>
        {t("rhdRetour")}
      </Link>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <form onSubmit={handleCreer} style={{ maxWidth: 980 }}>
        <FicheEmployeForm form={form} setForm={setForm} t={t} />
        <button
          type="submit"
          disabled={enCours}
          style={{
            marginTop: 16,
            background: "var(--petrol)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "9px 20px",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {enCours ? t("rhdCreation") : t("rhdCreer")}
        </button>
      </form>
    </AppShell>
  );
}
