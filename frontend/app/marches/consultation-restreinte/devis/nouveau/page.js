"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, estAdmin } from "../../../../../lib/api";
import { useLangue } from "../../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../../lib/components/AppShell";
import LigneProduitOutils from "../../../../../lib/components/LigneProduitOutils";
import { MENTIONS_PRIX_SUGGEREES, analyserSaisiePrix, montantLigneSaisie, totauxPrevisualises } from "../../../../../lib/prixLigne";

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
    // Remise en pourcentage (chantier du 01/10/2026, demande ecrite du
    // client) : appliquee sur le HT avant TVA, voir calcul ci-dessous.
    pourcentage_remise: "",
    // Numero personnalise (meme chantier) : reserve a l'ADMIN, voir
    // affichage conditionne par estAdmin() plus bas. Laisse vide = numero
    // automatique habituel (comportement inchange).
    numero: "",
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
  // Lignes non chiffrees (NC...) : montant null, exclues du total (04/10/2026).
  const lignesCalculees = lignes.map((l) => ({ ...l, montant_ht: montantLigneSaisie(l) }));
  const pourcentageRemise = Number(form.pourcentage_remise) || 0;
  const { totalHt, montantRemise, htNet: totalHtNet, tva: montantTva, totalTtc, nbNonChiffrees } =
    totauxPrevisualises(lignes, tauxTva, pourcentageRemise);
  const totalPartiel = nbNonChiffrees > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    setErreur("");
    setEnregistrement(true);
    try {
      const nouveau = await api.createDevis({
        ...form,
        consultation_id: form.consultation_id || null,
        pourcentage_remise: form.pourcentage_remise || 0,
        numero: form.numero.trim() || undefined,
        lignes: lignes.map((l) => ({
          designation: l.designation,
          unite: l.unite,
          quantite: Number(l.quantite),
          // Nombre OU mention texte (NC...) : le serveur tranche et recalcule.
          prix_unitaire_ht: String(l.prix_unitaire_ht ?? "").trim(),
          produit_id: l.produit_id || undefined,
          cout_revient_unitaire_ht: l.produit_id ? l.cout_revient_unitaire_ht : undefined,
        })),
      });
      router.push(`/marches/consultation-restreinte/devis/${nouveau.id}`);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrement(false);
    }
  }

  return (
    <AppShell title={t("venteNewDevisPageTitle")} backHref="/marches/consultation-restreinte/devis">
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

        {estAdmin() && (
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>{t("venteNumeroPersonnaliseLabel")}</label>
            <input
              value={form.numero}
              onChange={(e) => setForm((f) => ({ ...f, numero: e.target.value }))}
              style={{ ...inputStyle, maxWidth: 240 }}
              placeholder={t("venteNumeroPersonnalisePlaceholder")}
            />
            <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 4, marginBottom: 0 }}>{t("venteNumeroPersonnaliseAide")}</p>
          </div>
        )}

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
<LigneProduitOutils ligne={ligne} onPatch={(champs) => Object.entries(champs).forEach(([k, v]) => majLigne(index, k, v))} />
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
                      type="text"
                      inputMode="decimal"
                      list="mentions-prix"
                      maxLength={80}
                      value={ligne.prix_unitaire_ht}
                      onChange={(e) => majLigne(index, "prix_unitaire_ht", e.target.value)}
                      style={inputStyleCompact}
                      placeholder={t("venteMentionNcPlaceholder")}
                    />
                  </td>
                  <td className="mono" style={{ padding: "4px 6px", fontSize: 12.5, textAlign: "right" }}>
                    {ligne.montant_ht === null ? (
                      <span style={{ fontStyle: "italic", color: "var(--brique)" }}>
                        {analyserSaisiePrix(ligne.prix_unitaire_ht).mention || "NC"}
                      </span>
                    ) : (
                      ligne.montant_ht.toLocaleString()
                    )}
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

        <datalist id="mentions-prix">
          {MENTIONS_PRIX_SUGGEREES.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>

        <button type="button" onClick={ajouterLigne} style={{ ...boutonSecondaireStyle, marginTop: 8 }}>
          {t("venteAddLineButton")}
        </button>
        <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 6, marginBottom: 0 }}>{t("venteMentionNcAide")}</p>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <div style={{ maxWidth: 200 }}>
            <label style={labelStyle}>{t("venteRemisePourcentageLabel")}</label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.pourcentage_remise}
              onChange={(e) => setForm((f) => ({ ...f, pourcentage_remise: e.target.value }))}
              style={inputStyleCompact}
              placeholder="0"
            />
          </div>
        </div>

        <div style={{ marginTop: 10, marginLeft: "auto", maxWidth: 280, display: "grid", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <span>{totalPartiel ? t("venteTotalHtPartielLabel") : t("venteTotalHtLabel")}</span>
            <span className="mono">{totalHt.toLocaleString()} XOF</span>
          </div>
          {pourcentageRemise > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--brique)" }}>
                <span>{t("venteRemiseLabel")} ({pourcentageRemise}%)</span>
                <span className="mono">-{montantRemise.toLocaleString()} XOF</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span>{t("venteTotalHtNetLabel")}</span>
                <span className="mono">{totalHtNet.toLocaleString()} XOF</span>
              </div>
            </>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--sub)" }}>
            <span>{t("venteTvaLabel")} ({tauxTva}%)</span>
            <span className="mono">{montantTva.toLocaleString()} XOF</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, color: "var(--petrol)" }}>
            <span>{totalPartiel ? t("venteTotalTtcPartielLabel") : t("venteTotalTtcLabel")}</span>
            <span className="mono">{totalTtc.toLocaleString()} XOF</span>
          </div>
        </div>
        {totalPartiel && (
          <p style={{ fontSize: 12, color: "var(--brique)", marginTop: 10, marginBottom: 0, textAlign: "right" }}>
            {t("venteTotalPartielAvertissement").replace("{n}", String(nbNonChiffrees))}
          </p>
        )}

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
