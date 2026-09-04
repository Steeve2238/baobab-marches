"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";

const LIGNE_VIDE = { designation: "", unite: "U", quantite: 1, prix_unitaire_ht: "" };

// useSearchParams() impose que le composant qui l'utilise soit rendu a
// l'interieur d'un <Suspense> - sinon "npm run build" echoue au moment du
// prerendering statique de cette page (erreur constatee sur Railway).
// Voir le composant wrapper NouveauDevisPage plus bas.
function NouveauDevisFormulaire() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLangue();
  const [clients, setClients] = useState([]);
  const [tauxTva, setTauxTva] = useState(18);
  const [erreur, setErreur] = useState("");
  const [enregistrement, setEnregistrement] = useState(false);
  const [form, setForm] = useState({
    client_commercial_id: searchParams.get("client_commercial_id") || "",
    consultation_id: searchParams.get("consultation_id") || "",
    objet: "",
    conditions_paiement: "",
    delai_livraison: "",
    validite_offre: "",
  });
  const [lignes, setLignes] = useState([{ ...LIGNE_VIDE }]);

  useEffect(() => {
    api.getClientsCommerciaux().then((data) => setClients(data.filter((c) => c.actif))).catch(() => {});
    api.getParametresVentes().then((p) => setTauxTva(Number(p.taux_tva_pourcentage))).catch(() => {});
  }, []);

  function majLigne(index, champ, valeur) {
    setLignes((prev) => prev.map((l, i) => (i === index ? { ...l, [champ]: valeur } : l)));
  }

  function ajouterLigne() {
    setLignes((prev) => [...prev, { ...LIGNE_VIDE }]);
  }

  function supprimerLigne(index) {
    setLignes((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  // Calcul en direct cote client, uniquement pour l'affichage immediat -
  // les montants effectivement enregistres sont toujours recalcules par le
  // serveur a partir des memes lignes (jamais fait confiance a un total
  // envoye par le frontend).
  const lignesCalculees = lignes.map((l) => {
    const quantite = Number(l.quantite) || 0;
    const prixUnitaire = Number(l.prix_unitaire_ht) || 0;
    return { ...l, montant_ht: quantite * prixUnitaire };
  });
  const totalHt = lignesCalculees.reduce((acc, l) => acc + l.montant_ht, 0);
  const montantTva = totalHt * (tauxTva / 100);
  const totalTtc = totalHt + montantTva;

  async function handleSubmit(e) {
    e.preventDefault();
    setErreur("");
    setEnregistrement(true);
    try {
      const nouveau = await api.createDevis({
        ...form,
        consultation_id: form.consultation_id || null,
        lignes: lignes.map((l) => ({
          designation: l.designation,
          unite: l.unite,
          quantite: Number(l.quantite),
          prix_unitaire_ht: Number(l.prix_unitaire_ht),
        })),
      });
      router.push(`/ventes/devis/${nouveau.id}`);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrement(false);
    }
  }

  return (
    <AppShell title={t("venteNewDevisPageTitle")} backHref="/ventes/devis">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 780 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("venteClientLabel")}</label>
            <select
              required
              value={form.client_commercial_id}
              onChange={(e) => setForm((f) => ({ ...f, client_commercial_id: e.target.value }))}
              style={inputStyle}
            >
              <option value="">—</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.nom}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t("venteObjetLabel")}</label>
            <input value={form.objet} onChange={(e) => setForm((f) => ({ ...f, objet: e.target.value }))} style={inputStyle} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
          <div>
            <label style={labelStyle}>{t("venteConditionsPaiementLabel")}</label>
            <input
              value={form.conditions_paiement}
              onChange={(e) => setForm((f) => ({ ...f, conditions_paiement: e.target.value }))}
              style={inputStyle}
              placeholder={t("venteConditionsPaiementPlaceholder")}
            />
          </div>
          <div>
            <label style={labelStyle}>{t("venteDelaiLivraisonLabel")}</label>
            <input
              value={form.delai_livraison}
              onChange={(e) => setForm((f) => ({ ...f, delai_livraison: e.target.value }))}
              style={inputStyle}
              placeholder={t("venteDelaiLivraisonPlaceholder")}
            />
          </div>
          <div>
            <label style={labelStyle}>{t("venteValiditeOffreLabel")}</label>
            <input
              value={form.validite_offre}
              onChange={(e) => setForm((f) => ({ ...f, validite_offre: e.target.value }))}
              style={inputStyle}
              placeholder={t("venteValiditeOffrePlaceholder")}
            />
          </div>
        </div>

        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginTop: 22, marginBottom: 10 }}>{t("venteLignesSection")}</h3>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
            <thead>
              <tr style={{ fontSize: 11, color: "var(--sub)", textAlign: "left" }}>
                <th style={{ padding: "4px 6px" }}>{t("venteDesignationLabel")}</th>
                <th style={{ padding: "4px 6px", width: 70 }}>{t("venteUniteLabel")}</th>
                <th style={{ padding: "4px 6px", width: 90 }}>{t("venteQuantiteLabel")}</th>
                <th style={{ padding: "4px 6px", width: 130 }}>{t("ventePrixUnitaireLabel")}</th>
                <th style={{ padding: "4px 6px", width: 130 }}>{t("venteMontantLabel")}</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {lignesCalculees.map((ligne, index) => (
                <tr key={index}>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      required
                      value={ligne.designation}
                      onChange={(e) => majLigne(index, "designation", e.target.value)}
                      style={inputStyleCompact}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input value={ligne.unite} onChange={(e) => majLigne(index, "unite", e.target.value)} style={inputStyleCompact} />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      required
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={ligne.quantite}
                      onChange={(e) => majLigne(index, "quantite", e.target.value)}
                      style={inputStyleCompact}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      required
                      type="number"
                      min="0"
                      step="1"
                      value={ligne.prix_unitaire_ht}
                      onChange={(e) => majLigne(index, "prix_unitaire_ht", e.target.value)}
                      style={inputStyleCompact}
                    />
                  </td>
                  <td className="mono" style={{ padding: "4px 6px", fontSize: 12.5, textAlign: "right" }}>
                    {ligne.montant_ht.toLocaleString()}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <button type="button" onClick={() => supprimerLigne(index)} style={boutonSupprimerStyle} title={t("removeLine")}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="button" onClick={ajouterLigne} style={{ ...boutonSecondaireStyle, marginTop: 8 }}>
          {t("venteAddLineButton")}
        </button>

        <div style={{ marginTop: 18, marginLeft: "auto", maxWidth: 280, display: "grid", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <span>{t("venteTotalHtLabel")}</span>
            <span className="mono">{totalHt.toLocaleString()} XOF</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--sub)" }}>
            <span>{t("venteTvaLabel")} ({tauxTva}%)</span>
            <span className="mono">{montantTva.toLocaleString()} XOF</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, color: "var(--petrol)" }}>
            <span>{t("venteTotalTtcLabel")}</span>
            <span className="mono">{totalTtc.toLocaleString()} XOF</span>
          </div>
        </div>

        <button type="submit" disabled={enregistrement} style={{ ...boutonPrincipalStyle, marginTop: 20 }}>
          {enregistrement ? t("saCreating") : t("venteCreateDevisButton")}
        </button>
      </form>
    </AppShell>
  );
}

export default function NouveauDevisPage() {
  return (
    <Suspense fallback={null}>
      <NouveauDevisFormulaire />
    </Suspense>
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
const inputStyleCompact = { ...inputStyle, padding: "6px 8px", fontSize: 12.5 };
const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "9px 18px",
  fontSize: 12.5,
  fontWeight: 600,
};
const boutonSecondaireStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 12,
  fontWeight: 600,
};
const boutonSupprimerStyle = {
  background: "transparent",
  color: "var(--brique)",
  border: "none",
  fontSize: 16,
  fontWeight: 700,
  cursor: "pointer",
  lineHeight: 1,
};
