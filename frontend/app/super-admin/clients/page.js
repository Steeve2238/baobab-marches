"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { superAdminApi } from "../../../lib/superAdminApi";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import SuperAdminShell from "../../../lib/components/SuperAdminShell";

export default function SuperAdminClientsPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [clients, setClients] = useState([]);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    superAdminApi
      .getClients()
      .then(setClients)
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
    <SuperAdminShell title={t("saClientsPageTitle")} backHref="/super-admin">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Link href="/super-admin/clients/nouveau" style={boutonPrincipalStyle}>
          {t("saNewClientButton")}
        </Link>
      </div>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : clients.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("saNoClients")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {clients.map((client) => (
            <Link
              key={client.id}
              href={`/super-admin/clients/${client.id}`}
              className="card"
              style={{ display: "block" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--ink)" }}>
                    {client.raison_sociale}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>
                    {client.secteur_activite || "—"} · {client.pays}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 4 }}>
                    {t("saFormuleLabel")}: {client.formule_nom || t("saNoFormule")} ·{" "}
                    {client.nombre_utilisateurs_actifs}/{client.nombre_utilisateurs} {t("saUsersCount")}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: 20,
                    whiteSpace: "nowrap",
                    color: client.actif ? "#2E7D5B" : "var(--brique)",
                    background: client.actif ? "rgba(46,125,91,0.12)" : "rgba(196,74,58,0.1)",
                  }}
                >
                  {client.actif ? t("activeLabel") : t("saSuspendedLabel")}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </SuperAdminShell>
  );
}

const boutonPrincipalStyle = {
  background: "#1E1508",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "9px 16px",
  fontSize: 12.5,
  fontWeight: 600,
  display: "inline-block",
};
