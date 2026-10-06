"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import { PAYS } from "../../lib/constants/pays";
import EcheancierEditor, { PastilleARenseigner } from "../../lib/components/EcheancierEditor";
import { echeancierValide, pourApi, texteEcheancier } from "../../lib/echeancier";

export default function FournisseursPage() {
  const { t } = useLangue();
  const [edition, setEdition] = useState(null); // { id, echeancier }
  const [fournisseurs, setFournisseurs] = useState([]);
  const [erreur, setErreur] = useState("");
  const [form, setForm] = useState({ nom: "", pays: "", echeancier: [] });

  useEffect(() => {
    api.getFournisseurs().then(setFournisseurs).catch((err) => setErreur(err.message));
  }, []);

  async function handleAjouter(e) {
    e.preventDefault();
    setErreur("");
    if (!echeancierValide(form.echeancier)) {
      setErreur(t("echObligatoire"));
      return;
    }
    try {
      const nouveau = await api.createFournisseur({ nom: form.nom, pays: form.pays, echeancier: pourApi(form.echeancier) });
      setFournisseurs((prev) => [...prev, nouveau]);
      setForm({ nom: "", pays: "", echeancier: [] });
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function enregistrerEcheancier() {
    setErreur("");
    if (!echeancierValide(edition.echeancier)) {
      setErreur(t("echObligatoire"));
      return;
    }
    try {
      const maj = await api.patchFournisseur(edition.id, { echeancier: pourApi(edition.echeancier) });
      setFournisseurs((prev) => prev.map((f) => (f.id === maj.id ? maj : f)));
      setEdition(null);
    } catch (err) {
      setErreur(err.message);
    }
  }

  const nbSansEcheancier = fournisseurs.filter((f) => !Array.isArray(f.echeancier_json) || f.echeancier_json.length === 0).length;

  return (
    <AppShell title={t("suppliersPageTitle")}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {nbSansEcheancier > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--brique)", marginBottom: 12 }}>{t("echFicheManquantes").replace("{n}", nbSansEcheancier)}</p>
      )}

      <form onSubmit={handleAjouter} className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
        <label style={labelStyle}>{t("supplierNameLabel")}</label>
        <input
          required
          value={form.nom}
          onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("supplierCountryLabel")}</label>
        <select
          value={form.pays}
          onChange={(e) => setForm((f) => ({ ...f, pays: e.target.value }))}
          style={inputStyle}
        >
          <option value="">—</option>
          {PAYS.map((pays) => (
            <option key={pays} value={pays}>
              {pays}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 12 }}>
          <EcheancierEditor sens="FOURNISSEUR" valeur={form.echeancier} onChange={(v) => setForm((f) => ({ ...f, echeancier: v }))} />
        </div>
        <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12 }}>
          {t("newSupplier")}
        </button>
      </form>

      {fournisseurs.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noSuppliers")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {fournisseurs.map((f) => {
            const ech = Array.isArray(f.echeancier_json) && f.echeancier_json.length > 0 ? f.echeancier_json : null;
            const enEdition = edition && edition.id === f.id;
            return (
              <div key={f.id} className="card">
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", alignItems: "center", gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{f.nom}</div>
                  <div style={{ fontSize: 12.5, color: "var(--sub)" }}>{f.pays || "—"}</div>
                  <div>
                    <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>{t("reliabilityScoreLabel")}</div>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
                      {f.score_fiabilite != null ? `${Math.round(Number(f.score_fiabilite))}%` : "—"}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, color: "var(--sub)" }}>
                    {ech ? texteEcheancier(ech, t) : <PastilleARenseigner t={t} />}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEdition(enEdition ? null : { id: f.id, echeancier: ech || [] })}
                    style={{ background: "transparent", color: "var(--petrol)", border: "1px solid var(--line)", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600 }}
                  >
                    {enEdition ? t("echFermer") : t("echModifier")}
                  </button>
                </div>
                {enEdition && (
                  <div style={{ marginTop: 10 }}>
                    <EcheancierEditor sens="FOURNISSEUR" valeur={edition.echeancier} onChange={(v) => setEdition((ed) => ({ ...ed, echeancier: v }))} />
                    <button type="button" onClick={enregistrerEcheancier} style={{ ...boutonPrincipalStyle, marginTop: 10 }}>
                      {t("echEnregistrer")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
};
const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
};
