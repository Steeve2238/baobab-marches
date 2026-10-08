"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import PaieSousNav from "../../../lib/components/PaieSousNav";
import ArchivePeriode from "../../../lib/components/paie/ArchivePeriode";
import { boutonLeger, cellule, enteteCellule, droite, fmt, useStatut, Statut } from "../../../lib/components/paieUi";

export default function ArchivesPaiePage() {
  const { t } = useLangue();
  const [liste, setListe] = useState(null);
  const [ouvert, setOuvert] = useState(null);
  const s = useStatut();
  useEffect(() => { api.paieArchives().then((r) => setListe(r.archives)).catch(s.ko); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <AppShell title={t("paieArchiveTitre")} subNav={<PaieSousNav />}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14, maxWidth: 780, lineHeight: 1.5 }}>{t("paieArchiveAide")}</p>
      <Statut s={s} />
      {!liste ? <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p> : liste.length === 0 ? <div className="card"><p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("paieArchiveAucune")}</p></div> : (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ overflowX: "auto", padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead><tr>
                <th style={enteteCellule}>{t("paiePeriode")}</th><th style={enteteCellule}>{t("paieArchiveCloturee")}</th>
                <th style={{ ...enteteCellule, ...droite }}>{t("paieNbBulletins")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieNetTotal")}</th>
                <th style={{ ...enteteCellule, ...droite }}>{t("paieArchiveFichiers")}</th><th style={enteteCellule}></th>
              </tr></thead>
              <tbody>
                {liste.map((x) => (
                  <tr key={x.id} style={{ background: ouvert === x.id ? "rgba(15,76,92,0.07)" : "transparent" }}>
                    <td style={{ ...cellule, fontWeight: 600 }}>{t(`paieMoisNom_${x.mois}`)} {x.annee}</td>
                    <td style={cellule}>{x.date_cloture ? new Date(x.date_cloture).toLocaleDateString() : ""}</td>
                    <td style={{ ...cellule, ...droite }}>{x.nb_bulletins}</td>
                    <td style={{ ...cellule, ...droite }}>{fmt(x.total_net)}</td>
                    <td style={{ ...cellule, ...droite }}>{x.nb_fichiers_archive}</td>
                    <td style={{ ...cellule, textAlign: "right" }}><button style={boutonLeger} onClick={() => setOuvert(ouvert === x.id ? null : x.id)}>{ouvert === x.id ? t("paieFermer") : t("paieOuvrir")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ouvert && <ArchivePeriode periodeId={ouvert} t={t} />}
        </div>
      )}
    </AppShell>
  );
}
