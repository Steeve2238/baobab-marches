"use client";

import { useEffect, useState } from "react";
import { api } from "../../api";
import { Pastille, boutonPrincipal, boutonLeger, cellule, enteteCellule, droite, useStatut, Statut } from "../paieUi";

const taille = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : n >= 1024 ? `${Math.round(n / 1024)} Ko` : `${n} o`);

/** Contenu de l'archive verrouillee d'une periode cloturee : fichiers, empreintes, telechargement, verification d'integrite. */
export default function ArchivePeriode({ periodeId, t }) {
  const [a, setA] = useState(null);
  const [verif, setVerif] = useState(null);
  const s = useStatut();
  useEffect(() => { api.paieArchive(periodeId).then(setA).catch(s.ko); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodeId]);
  if (!a) return <><Statut s={s} /><p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p></>;
  if (a.periode.statut !== "CLOTUREE") return <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("paieArchiveNonCloturee")}</p>;

  async function verifier() {
    s.raz();
    try { setVerif(await api.paieVerifierArchive(periodeId)); } catch (e) { s.ko(e); }
  }
  const dateCloture = a.periode.date_cloture ? new Date(a.periode.date_cloture).toLocaleString() : "";
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Statut s={s} />
      <div className="card">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <Pastille ton="neutre">{t("paieArchiveVerrou")}</Pastille>
          <span style={{ fontSize: 12.5 }}>{t("paieArchiveCloturee")} {dateCloture}</span>
          <span style={{ flex: 1 }} />
          <button style={boutonLeger} onClick={verifier}>{t("paieArchiveVerifier")}</button>
          <button style={boutonPrincipal} onClick={() => api.paieTelechargerArchiveZip(periodeId).catch(s.ko)}>{t("paieArchiveZip")}</button>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("paieArchiveEmpreinteGlobale")}</div>
        <code style={{ fontSize: 11.5, wordBreak: "break-all" }}>{a.periode.empreinte_archive}</code>
        {verif && (
          <p style={{ margin: "10px 0 0", fontSize: 12.5, color: verif.ok ? "var(--ok, #1a7f4b)" : "var(--err, #b42318)", fontWeight: 600 }}>
            {verif.ok ? t("paieArchiveIntegreOk").replace("{n}", verif.nb_fichiers) : t("paieArchiveIntegreKo").replace("{n}", verif.anomalies.length)}
          </p>
        )}
      </div>
      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead><tr>
            <th style={enteteCellule}>{t("paieArchiveFichier")}</th><th style={enteteCellule}>{t("paieArchiveType")}</th>
            <th style={{ ...enteteCellule, ...droite }}>{t("paieArchiveTaille")}</th><th style={enteteCellule}>{t("paieArchiveEmpreinte")}</th><th style={enteteCellule}>{t("paieArchiveSalarie")}</th><th style={enteteCellule}></th>
          </tr></thead>
          <tbody>
            {a.fichiers.map((f) => (
              <tr key={f.id}>
                <td style={cellule}>{f.nom_fichier}</td>
                <td style={cellule}>{t(`paieArchiveType_${f.type}`)}</td>
                <td style={{ ...cellule, ...droite }}>{taille(f.taille)}</td>
                <td style={cellule}><code style={{ fontSize: 11 }} title={f.sha256}>{f.sha256.slice(0, 16)}…</code></td>
                <td style={cellule}>{f.type === "BULLETIN" ? (f.date_accuse ? <Pastille ton="ok">{t("paieArchiveAccuse")} {String(f.date_accuse).slice(0, 10)}</Pastille> : f.date_consultation ? <Pastille ton="neutre">{t("paieArchiveConsulte")}</Pastille> : <Pastille ton="alerte">{t("paieArchiveNonConsulte")}</Pastille>) : ""}</td>
                <td style={{ ...cellule, textAlign: "right" }}><button style={boutonLeger} onClick={() => api.paieTelechargerFichierArchive(periodeId, f.id, f.nom_fichier).catch(s.ko)}>{t("paieArchiveTelecharger")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
