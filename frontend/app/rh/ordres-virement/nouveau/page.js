"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import OrdreVirementForm, { ovFormInitial, ovFormVersCorps } from "../../../../lib/components/OrdreVirementForm";
import { boutonPrincipal } from "../../../../lib/components/rhUi";

export default function NouvelOrdreVirementPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [form, setForm] = useState(null);
  const [meta, setMeta] = useState({ coordonnees: "", exclus: [] });
  const [employes, setEmployes] = useState([]);
  const [courrierId, setCourrierId] = useState("");
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);

  function prefill(params) {
    return api.getOrdreVirementPrefill(params).then((p) => {
      setForm((f) => ({ ...ovFormInitial(p), banque_donneur: (f && f.banque_donneur) || p.banque_donneur || "", compte_donneur: (f && f.compte_donneur) || p.compte_donneur || "" }));
      setMeta({ coordonnees: p.coordonnees_bancaires || "", exclus: p.exclus || [] });
    });
  }
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const cid = q.get("courrier_id") || "";
    setCourrierId(cid);
    api.getPersonnel().then(setEmployes).catch(() => {});
    prefill(cid ? { courrier_id: cid } : { type_paiement: "SALAIRE" }).catch((e) => setErreur(e.message));
  }, []);

  async function creer(e) {
    e.preventDefault();
    setEnCours(true);
    setErreur("");
    try {
      const o = await api.createOrdreVirement(ovFormVersCorps(form));
      router.push(`/rh/ordres-virement/${o.id}`);
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  }

  return (
    <AppShell title={t("rhovNouveau")}>
      <Link href="/rh/ordres-virement" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("rhovRetour")}</Link>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {!form ? (
        !erreur && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : (
        <form onSubmit={creer} style={{ maxWidth: 1000, display: "grid", gap: 14 }}>
          <OrdreVirementForm
            t={t} form={form} setForm={setForm} employes={employes} coordonnees={meta.coordonnees} exclus={meta.exclus}
            onCharger={courrierId ? null : () => prefill({ type_paiement: form.type_paiement, periode: form.periode }).catch((e) => setErreur(e.message))}
          />
          <div><button type="submit" disabled={enCours} style={boutonPrincipal}>{t("rhovCreer")}</button></div>
        </form>
      )}
    </AppShell>
  );
}
