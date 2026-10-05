"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

// Livraison d'un dossier d'appel d'offres au maitre d'ouvrage (Lot 5).
// Brouillon modifiable ; "Valider" sort les quantites du stock (jamais bloquant :
// un stock negatif est signale, pas refuse). Back : routes/livraisonsDossier.js.
const num = (v) => {
  const n = Number(String(v ?? "").replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const LIGNE_VIDE = { produit_id: "", quantite: "", restant: null };

export default function LivraisonEditeur({ id }) {
  const { t } = useLangue();
  const router = useRouter();
  const [livraison, setLivraison] = useState(null);
  const [chargement, setChargement] = useState(!!id);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [avertissements, setAvertissements] = useState([]);
  const [enCours, setEnCours] = useState(false);
  const [parents, setParents] = useState({ dossiers_ao: [], consultations: [] });
  const [produits, setProduits] = useState([]);
  const [form, setForm] = useState({ dossier_ao_id: "", date_livraison: new Date().toISOString().slice(0, 10), notes: "" });
  const [lignes, setLignes] = useState([{ ...LIGNE_VIDE }]);

  const statut = livraison ? livraison.statut : "BROUILLON";
  const modifiable = statut === "BROUILLON";

  function appliquer(l) {
    setLivraison(l);
    setForm({ dossier_ao_id: l.dossier_ao_id, date_livraison: l.date_livraison ? String(l.date_livraison).slice(0, 10) : "", notes: l.notes || "" });
    setLignes(l.lignes.length ? l.lignes.map((x) => ({ produit_id: x.produit_id, quantite: x.quantite, restant: null, stock_actuel: x.stock_actuel })) : [{ ...LIGNE_VIDE }]);
  }

  useEffect(() => {
    api.getParentsDossierCalcul().then(setParents).catch(() => {});
    api.getProduits().then(setProduits).catch(() => {});
    if (id) {
      api
        .getLivraisonDossier(id)
        .then(appliquer)
        .catch((e) => setErreur(e.message))
        .finally(() => setChargement(false));
    } else {
      try {
        const d = new URLSearchParams(window.location.search).get("dossier");
        if (d) {
          setForm((f) => ({ ...f, dossier_ao_id: d }));
          reprendre(d);
        }
      } catch (e) {}
    }
  }, [id]);

  async function reprendre(dossierId) {
    const d = dossierId || form.dossier_ao_id;
    if (!d) {
      setErreur(t("livDossierRequis"));
      return;
    }
    setErreur("");
    setInfo("");
    try {
      const rows = (await api.getALivrerDossier(d)).filter((r) => r.restant > 0);
      if (rows.length === 0) {
        setInfo(t("livReprendreRien"));
        return;
      }
      setLignes(rows.map((r) => ({ produit_id: r.produit_id, quantite: r.restant, restant: r.restant, stock_actuel: r.stock_actuel })));
      setInfo(t("livReprendreOk").replace("{n}", rows.length));
    } catch (e) {
      setErreur(e.message);
    }
  }

  const maj = (index, champ, valeur) => setLignes((prev) => prev.map((l, i) => (i === index ? { ...l, [champ]: valeur } : l)));

  function charge() {
    return {
      dossier_ao_id: form.dossier_ao_id,
      date_livraison: form.date_livraison || undefined,
      notes: form.notes,
      lignes: lignes.filter((l) => l.produit_id).map((l) => ({ produit_id: l.produit_id, quantite: num(l.quantite) })),
    };
  }

  async function enregistrer() {
    if (!form.dossier_ao_id) {
      setErreur(t("livDossierRequis"));
      return null;
    }
    const data = charge();
    if (data.lignes.length === 0 || data.lignes.some((l) => l.quantite <= 0)) {
      setErreur(t("livLigneRequise"));
      return null;
    }
    setErreur("");
    setInfo("");
    return id ? api.patchLivraisonDossier(id, data) : api.createLivraisonDossier(data);
  }

  async function handleEnregistrer() {
    setEnCours(true);
    try {
      const l = await enregistrer();
      if (!l) return;
      if (!id) router.replace(`/livraisons-dossier/${l.id}`);
      else appliquer(l);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }

  async function handleValider() {
    if (!window.confirm(t("livValiderConfirm"))) return;
    setEnCours(true);
    try {
      const l = await enregistrer();
      if (!l) return;
      const v = await api.validerLivraisonDossier(l.id);
      setAvertissements(v.avertissements_stock || []);
      setInfo(t("livValideeOk"));
      if (!id) router.replace(`/livraisons-dossier/${l.id}`);
      else appliquer(v);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }

  async function handleAnnuler() {
    if (!window.confirm(t("livAnnulerConfirm"))) return;
    setEnCours(true);
    try {
      appliquer(await api.annulerLivraisonDossier(id));
      setAvertissements([]);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }

  async function handleSupprimer() {
    if (!window.confirm(t("livSupprimerConfirm"))) return;
    try {
      await api.supprimerLivraisonDossier(id);
      router.push("/livraisons-dossier");
    } catch (e) {
      setErreur(e.message);
    }
  }

  if (chargement) {
    return (
      <AppShell title={t("livTitle")} backHref="/livraisons-dossier" backLabelKey="livRetour">
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </AppShell>
    );
  }

  const produitDe = (pid) => produits.find((p) => p.id === pid);

  return (
    <AppShell title={livraison ? livraison.numero : t("livNouvelle")} backHref="/livraisons-dossier" backLabelKey="livRetour">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      {avertissements.map((a, i) => (
        <p key={i} style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 6 }}>
          {t("livAvertStock").replace("{d}", a.designation).replace("{s}", a.stock)}
        </p>
      ))}
      {!modifiable && <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 12 }}>{t("livLectureSeule")} ({t(`livStatut${statut}`)})</p>}

      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("livDossier")}</label>
            <select disabled={!modifiable || !!id} value={form.dossier_ao_id} onChange={(e) => setForm((f) => ({ ...f, dossier_ao_id: e.target.value }))} style={inputStyle}>
              <option value="">{t("livDossierChoisir")}</option>
              {parents.dossiers_ao.map((d) => (
                <option key={d.id} value={d.id}>{[d.reference_externe, d.intitule].filter(Boolean).join(" · ")}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t("livDate")}</label>
            <input disabled={!modifiable} type="date" value={form.date_livraison} onChange={(e) => setForm((f) => ({ ...f, date_livraison: e.target.value }))} style={inputStyle} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={labelStyle}>{t("livNotes")}</label>
          <input disabled={!modifiable} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} style={inputStyle} />
        </div>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ fontSize: 14.5, color: "var(--petrol)", margin: 0 }}>{t("livLignes")}</h2>
          <span style={{ flex: 1 }} />
          {modifiable && (
            <button type="button" onClick={() => reprendre()} style={boutonSecondaireStyle}>{t("livReprendre")}</button>
          )}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr style={{ fontSize: 11, color: "var(--sub)", textAlign: "left" }}>
                <th style={th}>{t("livColArticle")}</th>
                <th style={{ ...th, width: 110 }}>{t("livColQuantite")}</th>
                <th style={{ ...th, width: 120, textAlign: "right" }}>{t("livColRestant")}</th>
                <th style={{ ...th, width: 110, textAlign: "right" }}>{t("livColStock")}</th>
                {modifiable && <th style={{ width: 28 }}></th>}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, index) => {
                const p = produitDe(l.produit_id);
                const stock = l.stock_actuel ?? (p ? Number(p.stock_quantite ?? 0) : null);
                const insuffisant = modifiable && stock !== null && num(l.quantite) > stock;
                return (
                  <tr key={index} style={{ borderTop: "1px solid var(--line-soft, var(--line))" }}>
                    <td style={td}>
                      <select disabled={!modifiable} value={l.produit_id} onChange={(e) => maj(index, "produit_id", e.target.value)} style={inputCompact}>
                        <option value="">{t("livArticleChoisir")}</option>
                        {produits.map((pr) => (
                          <option key={pr.id} value={pr.id}>{pr.reference ? `${pr.reference} · ` : ""}{pr.designation}</option>
                        ))}
                      </select>
                    </td>
                    <td style={td}>
                      <input disabled={!modifiable} inputMode="decimal" value={l.quantite} onChange={(e) => maj(index, "quantite", e.target.value)} style={inputCompact} />
                    </td>
                    <td className="mono" style={{ ...td, textAlign: "right", fontSize: 12.5, paddingTop: 11 }}>{l.restant === null ? "—" : l.restant}</td>
                    <td className="mono" style={{ ...td, textAlign: "right", fontSize: 12.5, paddingTop: 11, color: insuffisant ? "var(--brique)" : undefined }}>
                      {stock === null ? "—" : stock}
                      {insuffisant && <div style={{ fontSize: 10.5, fontWeight: 600 }}>{t("livStockInsuffisant")}</div>}
                    </td>
                    {modifiable && (
                      <td style={td}>
                        <button type="button" onClick={() => setLignes((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))} style={boutonSupprimerStyle}>×</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {modifiable && (
          <button type="button" onClick={() => setLignes((prev) => [...prev, { ...LIGNE_VIDE }])} style={{ ...boutonSecondaireStyle, marginTop: 10 }}>{t("livAjouterLigne")}</button>
        )}
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {modifiable && (
          <>
            <button type="button" disabled={enCours} onClick={handleEnregistrer} style={boutonSecondaireStyle}>{t("livEnregistrer")}</button>
            <button type="button" disabled={enCours} onClick={handleValider} style={boutonPrincipalStyle}>{t("livValider")}</button>
            {id && <button type="button" onClick={handleSupprimer} style={{ ...boutonSecondaireStyle, color: "var(--brique)" }}>{t("livSupprimer")}</button>}
          </>
        )}
        {statut === "LIVREE" && (
          <button type="button" disabled={enCours} onClick={handleAnnuler} style={{ ...boutonSecondaireStyle, color: "var(--brique)" }}>{t("livAnnuler")}</button>
        )}
      </div>
    </AppShell>
  );
}

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, fontFamily: "inherit" };
const inputCompact = { ...inputStyle, padding: "6px 8px", fontSize: 12.5 };
const boutonPrincipalStyle = { background: "var(--petrol)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const boutonSecondaireStyle = { background: "transparent", color: "var(--petrol)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const boutonSupprimerStyle = { background: "transparent", color: "var(--brique)", border: "none", fontSize: 16, fontWeight: 700, cursor: "pointer", lineHeight: 1 };
const th = { padding: "4px 6px", fontWeight: 600 };
const td = { padding: "4px 6px", verticalAlign: "top" };
