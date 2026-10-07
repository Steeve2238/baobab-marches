"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { superAdminApi } from "../../../../lib/superAdminApi";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import SuperAdminShell from "../../../../lib/components/SuperAdminShell";
import OffreFormulaire from "../../../../lib/components/OffreFormulaire";

export default function SuperAdminNouvelleOffrePage() {
  const router = useRouter();
  const { t } = useLangue();
  const [clients, setClients] = useState([]);
  const [formules, setFormules] = useState([]);
  const [clientImpose, setClientImpose] = useState("");
  const [erreur, setErreur] = useState("");
  const [pret, setPret] = useState(false);

  useEffect(() => {
    setClientImpose(new URLSearchParams(window.location.search).get("client") || "");
    Promise.all([superAdminApi.getClients(), superAdminApi.getFormules()])
      .then(([c, f]) => {
        setClients(c);
        setFormules(f);
        setPret(true);
      })
      .catch((err) => {
        if (err.status === 401) return router.push("/super-admin/login");
        setErreur(err.message);
      });
  }, [router]);

  return (
    <SuperAdminShell title={t("saOffNouvelle")} backHref="/super-admin/offres" backLabelKey="saOffRetourListe">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {pret && (
        <OffreFormulaire
          clients={clients}
          formules={formules}
          clientImpose={clientImpose}
          libelleBouton={t("saOffCreer")}
          onSubmit={async (data) => {
            const o = await superAdminApi.creerOffre(data);
            router.push(`/super-admin/offres/${o.id}`);
          }}
        />
      )}
    </SuperAdminShell>
  );
}
