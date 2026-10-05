"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import { useLangue } from "../i18n/LanguageContext";
import { analyserSaisiePrix, champsLigneDepuisProduit, margeEffectiveLigne, prixVenteDepuisCout } from "../prixLigne";

// Catalogue charge une seule fois par page (cache de module, 30 s) : le
// composant est rendu sur chaque ligne du devis.
let cache = { date: 0, promesse: null };
function chargerProduits() {
  const maintenant = Date.now();
  if (!cache.promesse || maintenant - cache.date > 30000) {
    cache = { date: maintenant, promesse: api.getProduits().catch(() => []) };
  }
  return cache.promesse;
}

/**
 * Outils "catalogue produits" d'une ligne de devis (05/10/2026) :
 *  - liste deroulante des produits ; le choix remplit designation, unite et
 *    prix de vente (cout de revient x (1 + marge), arrondi a 100 XOF) ;
 *  - pour une ligne liee a un produit : cout de revient (lecture seule) et
 *    marge modifiable (la marge recalcule le prix, le prix recalcule la marge).
 * Le serveur reste maitre des montants : seul le prix saisi est enregistre.
 * onPatch(champs) fusionne des champs dans la ligne.
 */
export default function LigneProduitOutils({ ligne, onPatch }) {
  const { t } = useLangue();
  const [produits, setProduits] = useState([]);

  useEffect(() => {
    let actif = true;
    chargerProduits().then((p) => actif && setProduits(p));
    return () => {
      actif = false;
    };
  }, []);

  const lie = !!ligne.produit_id;
  const marge = margeEffectiveLigne(ligne);
  const [margeSaisie, setMargeSaisie] = useState(null);

  function choisir(e) {
    const produit = produits.find((p) => p.id === e.target.value);
    if (produit) {
      setMargeSaisie(null);
      onPatch(champsLigneDepuisProduit(produit));
    }
  }

  function changerMarge(valeur) {
    setMargeSaisie(valeur);
    const a = analyserSaisiePrix(valeur);
    if (a.chiffre && a.valeur >= 0) {
      onPatch({ prix_unitaire_ht: String(prixVenteDepuisCout(ligne.cout_revient_unitaire_ht, a.valeur / 100)) });
    }
  }

  function detacher() {
    setMargeSaisie(null);
    onPatch({ produit_id: null, cout_revient_unitaire_ht: null });
  }

  if (produits.length === 0 && !lie) return null;

  return (
    <div style={{ marginTop: 4, display: "grid", gap: 4 }}>
      {produits.length > 0 && (
        <select value="" onChange={choisir} style={selectStyle} aria-label={t("venteProduitChoisir")}>
          <option value="">{t("venteProduitChoisir")}</option>
          {produits.map((p) => (
            <option key={p.id} value={p.id}>
              {p.reference ? `${p.reference} · ` : ""}
              {p.designation} — {Number(p.prix_vente_xof).toLocaleString()}
            </option>
          ))}
        </select>
      )}
      {lie && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 11.5, color: "var(--sub)" }}>
          <span>
            {t("venteProduitCout")} : <span className="mono">{Number(ligne.cout_revient_unitaire_ht || 0).toLocaleString()}</span>
          </span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {t("venteProduitMarge")}
            <input
              type="text"
              inputMode="decimal"
              value={margeSaisie !== null ? margeSaisie : marge === null ? "" : String(Math.round(marge * 1000) / 10)}
              onChange={(e) => changerMarge(e.target.value)}
              onBlur={() => setMargeSaisie(null)}
              style={{ ...selectStyle, width: 64, padding: "3px 6px" }}
            />
            %
          </label>
          <button type="button" onClick={detacher} style={lienBoutonStyle}>
            {t("venteProduitDetacher")}
          </button>
        </div>
      )}
    </div>
  );
}

const selectStyle = {
  width: "100%",
  padding: "4px 6px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 11.5,
  fontFamily: "inherit",
  background: "var(--card, #fff)",
};
const lienBoutonStyle = {
  background: "transparent",
  border: "none",
  color: "var(--petrol)",
  fontSize: 11.5,
  textDecoration: "underline",
  cursor: "pointer",
  padding: 0,
};
