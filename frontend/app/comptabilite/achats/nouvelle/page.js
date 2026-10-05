"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import ComptaSousNav from "../../../../lib/components/ComptaSousNav";
import { useComptaStatut, labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, thStyle, tdStyle, numStyle, formaterMontant } from "../../../../lib/comptaUi";

const LIGNE_VIDE = () => ({ cle: Math.random().toString(36).slice(2), libelle: "", compte_numero: "", montant_ht: "", taux_tva: "18" });
const nombre = (v) => Number(String(v || "").replace(/\s/g, "").replace(",", ".")) || 0;
const arrondi = (n) => Math.round(n * 100) / 100;

// Saisie d'une facture fournisseur : les totaux HT / TVA / TTC se calculent en
// direct ; le serveur refait le calcul (centimes entiers) et genere l'ecriture
// d'achat en instance.
export default function NouvelleFactureFournisseurPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const router = useRouter();
  const { statut } = useComptaStatut();
  const [fournisseurs, setFournisseurs] = useState([]);
  const [comptes, setComptes] = useState([]);
  const [entete, setEntete] = useState({ tiers_id: "", reference_fournisseur: "", date_facture: new Date().toISOString().slice(0, 10), date_echeance: "", libelle: "" });
  const [lignes, setLignes] = useState([LIGNE_VIDE()]);
  const [nouveau, setNouveau] = useState(null);
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    api.comptaAchatsFournisseurs().then(setFournisseurs).catch((e) => setErreur(e.message));
    api.comptaComptes({ limit: 5000, actif: "true" }).then((c) => setComptes(c.filter((x) => [2, 3, 6].includes(x.classe)))).catch(() => {});
  }, []);

  const defaut = statut?.parametre?.compte_achat_defaut || "";
  const totaux = useMemo(() => {
    let ht = 0;
    let tva = 0;
    for (const l of lignes) {
      const h = nombre(l.montant_ht);
      ht += h;
      tva += arrondi((h * nombre(l.taux_tva)) / 100);
    }
    return { ht: arrondi(ht), tva: arrondi(tva), ttc: arrondi(ht + tva) };
  }, [lignes]);
  const m = (v) => formaterMontant(v, locale);
  const majLigne = (cle, patch) => setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, ...patch } : l)));

  async function creerFournisseur() {
    setErreur("");
    try {
      const f = await api.comptaAchatsCreerFournisseur({ nom: nouveau.nom, delai_reglement_jours: nouveau.delai });
      setFournisseurs((fs) => [...fs, f].sort((a, b) => a.nom.localeCompare(b.nom)));
      setEntete((h) => ({ ...h, tiers_id: f.id }));
      setNouveau(null);
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function enregistrer() {
    setErreur("");
    setEnvoi(true);
    try {
      const f = await api.comptaAchatsCreerFacture({
        ...entete,
        date_echeance: entete.date_echeance || undefined,
        lignes: lignes.map((l) => ({ libelle: l.libelle, compte_numero: l.compte_numero || undefined, montant_ht: l.montant_ht, taux_tva: l.taux_tva })),
      });
      router.push(`/comptabilite/achats/${f.id}?cree=1`);
    } catch (e) {
      setErreur(e.message);
      setEnvoi(false);
    }
  }

  const peutEnregistrer = entete.tiers_id && entete.reference_fournisseur.trim() && totaux.ttc > 0 && lignes.every((l) => l.libelle.trim() && nombre(l.montant_ht) > 0);

  return (
    <AppShell title={t("comptaAchatsNouvelle")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("comptaAchatsFournisseur")}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={entete.tiers_id} onChange={(e) => setEntete((h) => ({ ...h, tiers_id: e.target.value }))} style={inputStyle}>
                <option value="">{t("comptaChoisir")}</option>
                {fournisseurs.map((f) => (
                  <option key={f.id} value={f.id}>{f.code} — {f.nom}</option>
                ))}
              </select>
              <button type="button" style={boutonSecondaireStyle} onClick={() => setNouveau({ nom: "", delai: "30" })}>+</button>
            </div>
          </div>
          <div>
            <label style={labelStyle}>{t("comptaAchatsReference")}</label>
            <input value={entete.reference_fournisseur} onChange={(e) => setEntete((h) => ({ ...h, reference_fournisseur: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("comptaAchatsDateFacture")}</label>
            <input type="date" value={entete.date_facture} onChange={(e) => setEntete((h) => ({ ...h, date_facture: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("comptaAchatsEcheance")}</label>
            <input type="date" value={entete.date_echeance} onChange={(e) => setEntete((h) => ({ ...h, date_echeance: e.target.value }))} style={inputStyle} />
            <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 3 }}>{t("comptaAchatsEcheanceAide")}</div>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>{t("comptaAchatsLibelle")}</label>
            <input value={entete.libelle} onChange={(e) => setEntete((h) => ({ ...h, libelle: e.target.value }))} style={inputStyle} />
          </div>
        </div>
        {nouveau && (
          <div style={{ marginTop: 14, padding: 12, background: "var(--line-soft)", borderRadius: 8, display: "grid", gridTemplateColumns: "2fr 1fr auto auto", gap: 10, alignItems: "end" }}>
            <div>
              <label style={labelStyle}>{t("comptaAchatsNomFournisseur")}</label>
              <input value={nouveau.nom} onChange={(e) => setNouveau((n) => ({ ...n, nom: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("comptaAchatsDelai")}</label>
              <input value={nouveau.delai} onChange={(e) => setNouveau((n) => ({ ...n, delai: e.target.value }))} style={inputStyle} />
            </div>
            <button type="button" disabled={!nouveau.nom.trim()} style={boutonPrincipalStyle} onClick={creerFournisseur}>{t("comptaAchatsCreerFournisseur")}</button>
            <button type="button" style={boutonSecondaireStyle} onClick={() => setNouveau(null)}>{t("comptaAnnuler")}</button>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 14 }}>
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", fontWeight: 700, fontSize: 13 }}>{t("comptaAchatsLignes")}</div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("comptaAchatsLigneLibelle")}</th>
              <th style={{ ...thStyle, width: 250 }}>{t("comptaAchatsLigneCompte")}</th>
              <th style={{ ...thStyle, width: 150, textAlign: "right" }}>{t("comptaAchatsLigneHt")}</th>
              <th style={{ ...thStyle, width: 80, textAlign: "right" }}>{t("comptaAchatsLigneTva")}</th>
              <th style={{ ...thStyle, width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.cle}>
                <td style={tdStyle}><input value={l.libelle} onChange={(e) => majLigne(l.cle, { libelle: e.target.value })} style={inputStyle} /></td>
                <td style={tdStyle}>
                  <input list="comptes-charge" placeholder={defaut} value={l.compte_numero} onChange={(e) => majLigne(l.cle, { compte_numero: e.target.value })} style={{ ...inputStyle, fontFamily: "IBM Plex Mono, monospace" }} />
                </td>
                <td style={tdStyle}><input inputMode="decimal" value={l.montant_ht} onChange={(e) => majLigne(l.cle, { montant_ht: e.target.value })} style={{ ...inputStyle, textAlign: "right" }} /></td>
                <td style={tdStyle}><input inputMode="decimal" value={l.taux_tva} onChange={(e) => majLigne(l.cle, { taux_tva: e.target.value })} style={{ ...inputStyle, textAlign: "right" }} /></td>
                <td style={tdStyle}>
                  {lignes.length > 1 && <button type="button" onClick={() => setLignes((ls) => ls.filter((x) => x.cle !== l.cle))} style={{ border: "none", background: "transparent", color: "var(--brique)", fontSize: 16 }}>×</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="comptes-charge">
          {comptes.map((c) => (
            <option key={c.id} value={c.numero}>{c.libelle}</option>
          ))}
        </datalist>
        <div style={{ padding: 12, display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <button type="button" style={boutonSecondaireStyle} onClick={() => setLignes((ls) => [...ls, LIGNE_VIDE()])}>+ {t("comptaAchatsAjouterLigne")}</button>
          <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "4px 24px", fontSize: 13 }}>
            <span style={{ color: "var(--sub)" }}>{t("comptaAchatsHt")}</span><span style={numStyle}>{m(totaux.ht)}</span>
            <span style={{ color: "var(--sub)" }}>{t("comptaAchatsTva")}</span><span style={numStyle}>{m(totaux.tva)}</span>
            <strong>{t("comptaAchatsTtc")}</strong><strong style={numStyle}>{m(totaux.ttc)}</strong>
          </div>
        </div>
      </div>
      <button disabled={!peutEnregistrer || envoi} style={{ ...boutonPrincipalStyle, opacity: !peutEnregistrer || envoi ? 0.5 : 1 }} onClick={enregistrer}>
        {t("comptaAchatsEnregistrer")}
      </button>
    </AppShell>
  );
}
