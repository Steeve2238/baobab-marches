"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ConsultationRestreinteSousNav from "../../../lib/components/ConsultationRestreinteSousNav";
import { EtapesPartage, JournalPartage, pastilleEtat, cleTypeDocument } from "../../../lib/components/PartageDocument";
import { boutonSecondaireStyle, thStyle, tdStyle } from "../../../lib/comptaUi";

const FILTRES = ["TOUS", "ACTIF", "SIGNE", "EXPIRE", "REVOQUE", "BLOQUE"];
const TYPES = ["TOUS", "FACTURE", "DEVIS"];

function Compteur({ libelle, valeur }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 16px", background: "#fff", minWidth: 120 }}>
      <div style={{ fontSize: 11, color: "var(--sub)" }}>{libelle}</div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--petrol)" }}>{valeur}</div>
    </div>
  );
}

// Suivi de tous les devis et factures envoyes aux clients par lien securise : etat, etapes franchies (envoye, ouvert, consulte,
// telecharge, signe) avec leur date, et journal complet de chaque envoi.
export default function SuiviEnvoisPage() {
  const router = useRouter();
  const { t, langue } = useLangue();
  const [liste, setListe] = useState([]);
  const [filtre, setFiltre] = useState("TOUS");
  const [type, setType] = useState("TOUS");
  const [ouvert, setOuvert] = useState(null);
  const [detail, setDetail] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    setChargement(true);
    const q = new URLSearchParams();
    if (filtre !== "TOUS") q.set("statut", filtre);
    if (type !== "TOUS") q.set("type", type);
    api
      .getPartagesVente(q.toString() ? `?${q.toString()}` : "")
      .then(setListe)
      .catch((err) => {
        if (err.status === 401) return router.push("/login");
        setErreur(err.message);
      })
      .finally(() => setChargement(false));
  }, [filtre, type, router]);

  const compteurs = useMemo(
    () => ({
      total: liste.length,
      ouverts: liste.filter((p) => p.premiere_ouverture).length,
      telecharges: liste.filter((p) => p.date_telechargement).length,
      signes: liste.filter((p) => p.date_signature).length,
    }),
    [liste]
  );

  async function basculer(p) {
    if (ouvert === p.id) {
      setOuvert(null);
      setDetail(null);
      return;
    }
    setOuvert(p.id);
    setDetail(null);
    try {
      setDetail(await api.getPartageVente(p.id));
    } catch (e) {
      setErreur(e.message);
    }
  }

  const lienDocument = (p) => `/marches/consultation-restreinte/${p.type_document === "FACTURE" ? "factures" : "devis"}/${p.document_id}`;
  const pill = (actif) => ({ border: "1px solid var(--line)", borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 600, background: actif ? "var(--petrol)" : "transparent", color: actif ? "#fff" : "var(--petrol)" });

  return (
    <AppShell title={t("prtSuiviEnvoisTitre")} subNav={<ConsultationRestreinteSousNav />}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", maxWidth: 720, marginBottom: 14 }}>{t("prtSuiviEnvoisAide")}</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <Compteur libelle={t("prtEtapeCree")} valeur={compteurs.total} />
        <Compteur libelle={t("prtEtapeOuvert")} valeur={compteurs.ouverts} />
        <Compteur libelle={t("prtEtapeTelecharge")} valeur={compteurs.telecharges} />
        <Compteur libelle={t("prtEtapeSigne")} valeur={compteurs.signes} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {TYPES.map((x) => (
          <button key={x} onClick={() => setType(x)} style={pill(type === x)}>
            {x === "TOUS" ? t("prtFiltreTous") : t(cleTypeDocument(x))}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {FILTRES.map((f) => (
          <button key={f} onClick={() => setFiltre(f)} style={pill(filtre === f)}>
            {f === "TOUS" ? t("prtFiltreTous") : t(`prtStatut_${f}`)}
          </button>
        ))}
      </div>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 13 }}>{erreur}</p>}
      {chargement ? (
        <p>…</p>
      ) : liste.length === 0 ? (
        <p style={{ color: "var(--sub)" }}>{t("prtAucunEnvoiListe")}</p>
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
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <strong>{p.numero_document}</strong>
                      <div style={{ fontSize: 11, color: "var(--sub)" }}>{t(cleTypeDocument(p.type_document))}</div>
                    </td>
                    <td style={tdStyle}>{p.client_raison_sociale}</td>
                    <td style={tdStyle}>{p.destinataire_nom || ""}<div style={{ fontSize: 11, color: "var(--sub)" }}>{p.destinataire_email || p.destinataire_tel}</div></td>
                    <td style={tdStyle}><span style={pastilleEtat(p.statut)}>{t(`prtStatut_${p.statut}`)}</span></td>
                    <td style={{ ...tdStyle, minWidth: 320 }}><EtapesPartage p={p} t={t} langue={langue} /></td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button style={boutonSecondaireStyle} onClick={() => basculer(p)}>{ouvert === p.id ? t("prtMasquer") : t("prtDetail")}</button>
                        <button style={boutonSecondaireStyle} onClick={() => api.telechargerPartageVente(p.id).catch((e) => setErreur(e.message))}>PDF</button>
                        <Link href={lienDocument(p)} style={{ ...boutonSecondaireStyle, textDecoration: "none", display: "inline-block" }}>{t("prtOuvrirDocument")}</Link>
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
    </AppShell>
  );
}
