"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { superAdminApi } from "../../../lib/superAdminApi";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import SuperAdminShell from "../../../lib/components/SuperAdminShell";
import { EtapesPartage, JournalPartage, pastilleEtat } from "../../../lib/components/PartageDocument";
import { boutonSecondaireStyle, thStyle, tdStyle } from "../../../lib/comptaUi";

const FILTRES = ["TOUS", "ACTIF", "SIGNE", "EXPIRE", "REVOQUE", "BLOQUE"];

// Suivi de tous les documents envoyes par lien securise : etat, etapes franchies et journal complet.
export default function SuperAdminSuiviPage() {
  const router = useRouter();
  const { t, langue } = useLangue();
  const [liste, setListe] = useState([]);
  const [filtre, setFiltre] = useState("TOUS");
  const [ouvert, setOuvert] = useState(null);
  const [detail, setDetail] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    setChargement(true);
    superAdminApi
      .getPartages(filtre === "TOUS" ? "" : `?statut=${filtre}`)
      .then(setListe)
      .catch((err) => {
        if (err.status === 401) return router.push("/super-admin/login");
        setErreur(err.message);
      })
      .finally(() => setChargement(false));
  }, [filtre, router]);

  async function basculer(p) {
    if (ouvert === p.id) {
      setOuvert(null);
      setDetail(null);
      return;
    }
    setOuvert(p.id);
    setDetail(null);
    try {
      setDetail(await superAdminApi.getPartage(p.id));
    } catch (e) {
      setErreur(e.message);
    }
  }

  const lienDocument = (p) => (p.offre_id ? `/super-admin/offres/${p.offre_id}` : null);

  return (
    <SuperAdminShell title={t("prtSuiviTitre")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", maxWidth: 700, marginBottom: 14 }}>{t("prtSuiviAide")}</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {FILTRES.map((f) => (
          <button key={f} onClick={() => setFiltre(f)} style={{ border: "1px solid var(--line)", borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 600, background: filtre === f ? "var(--petrol)" : "transparent", color: filtre === f ? "#fff" : "var(--petrol)" }}>
            {f === "TOUS" ? t("prtFiltreTous") : t(`prtStatut_${f}`)}
          </button>
        ))}
      </div>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 13 }}>{erreur}</p>}
      {chargement ? (
        <p>…</p>
      ) : liste.length === 0 ? (
        <p style={{ color: "var(--sub)" }}>{t("prtAucun")}</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("prtColDocument")}</th>
                <th style={thStyle}>{t("prtColClient")}</th>
                <th style={thStyle}>{t("prtColDestinataire")}</th>
                <th style={thStyle}>{t("prtColEtat")}</th>
                <th style={thStyle}>{t("prtColActivite")}</th>
                <th style={thStyle}>{t("prtColActions")}</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((p) => (
                <Fragment key={p.id}>
                  <tr>
                    <td style={tdStyle}>
                      <strong>{p.numero_document}</strong>
                      <div style={{ fontSize: 11, color: "var(--sub)" }}>{p.type_document === "OFFRE" ? t("prtTypeOffre") : t("prtTypeContrat")}</div>
                    </td>
                    <td style={tdStyle}>{p.client_raison_sociale}</td>
                    <td style={tdStyle}>{p.destinataire_nom || ""}<div style={{ fontSize: 11, color: "var(--sub)" }}>{p.destinataire_email || p.destinataire_tel}</div></td>
                    <td style={tdStyle}><span style={pastilleEtat(p.statut)}>{t(`prtStatut_${p.statut}`)}</span></td>
                    <td style={{ ...tdStyle, minWidth: 320 }}><EtapesPartage p={p} t={t} langue={langue} /></td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button style={boutonSecondaireStyle} onClick={() => basculer(p)}>{ouvert === p.id ? t("prtMasquer") : t("prtDetail")}</button>
                        <button style={boutonSecondaireStyle} onClick={() => superAdminApi.telechargerPartage(p.id).catch((e) => setErreur(e.message))}>PDF</button>
                        {lienDocument(p) && <Link href={lienDocument(p)} style={{ ...boutonSecondaireStyle, textDecoration: "none", display: "inline-block" }}>{t("prtOuvrirDocument")}</Link>}
                      </div>
                    </td>
                  </tr>
                  {ouvert === p.id && (
                    <tr>
                      <td colSpan={6} style={{ ...tdStyle, background: "var(--line-soft)" }}>
                        {detail ? (
                          <>
                            <JournalPartage evenements={detail.evenements} t={t} langue={langue} />
                            {detail.empreinte_document && <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 6, wordBreak: "break-all" }}>{t("prtEmpreinte")} (SHA-256) : {detail.empreinte_document}</p>}
                          </>
                        ) : (
                          "…"
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SuperAdminShell>
  );
}
