"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { superAdminApi } from "../../lib/superAdminApi";
import { useLangue } from "../../lib/i18n/LanguageContext";
import SuperAdminShell from "../../lib/components/SuperAdminShell";

export default function SuperAdminDashboardPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [stats, setStats] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    superAdminApi
      .getStatistiques()
      .then(setStats)
      .catch((err) => {
        if (err.status === 401) {
          router.push("/super-admin/login");
          return;
        }
        setErreur(err.message);
      })
      .finally(() => setChargement(false));
  }, [router]);

  return (
    <SuperAdminShell title={t("saDashboardTitle")}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {!chargement && stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
          <div className="card">
            <div style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 6 }}>{t("saActiveClients")}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--vert)" }}>{stats.clients_actifs}</div>
          </div>
          <div className="card">
            <div style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 6 }}>{t("saInactiveClients")}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--brique)" }}>{stats.clients_inactifs}</div>
          </div>
          <div className="card">
            <div style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 6 }}>{t("saTotalClients")}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--petrol)" }}>{stats.clients_total}</div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <Link href="/super-admin/clients" className="card" style={quickLinkStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--petrol)", marginBottom: 4 }}>
            {t("saNavClients")}
          </div>
          <div style={{ fontSize: 12, color: "var(--sub)" }}>{t("saQuickLinkClients")}</div>
        </Link>
        <Link href="/super-admin/formules" className="card" style={quickLinkStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--petrol)", marginBottom: 4 }}>
            {t("saNavFormules")}
          </div>
          <div style={{ fontSize: 12, color: "var(--sub)" }}>{t("saQuickLinkFormules")}</div>
        </Link>
        <Link href="/super-admin/factures" className="card" style={quickLinkStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--petrol)", marginBottom: 4 }}>
            {t("saNavFactures")}
          </div>
          <div style={{ fontSize: 12, color: "var(--sub)" }}>{t("saQuickLinkFactures")}</div>
        </Link>
      </div>
    </SuperAdminShell>
  );
}

const quickLinkStyle = { display: "block", cursor: "pointer" };
