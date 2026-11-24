"use client";

import { useMemo, useRef, useState } from "react";
import { useLangue } from "../i18n/LanguageContext";
import { filtrerRecherche } from "../rechercheUtil";

const MAX_AFFICHES = 30;

/**
 * Choix d'un produit par saisie (remplace la longue liste deroulante) : on tape une partie de la reference ou de la
 * designation, la liste se reduit au fil de la frappe. Fleches + Entree au clavier, clic a la souris.
 * Props : produits (catalogue), onChoisir(produit), placeholder, style.
 */
export default function ProduitRecherche({ produits, onChoisir, placeholder, style }) {
  const { t } = useLangue();
  const [q, setQ] = useState("");
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(0);
  const refBoite = useRef(null);

  const trouves = useMemo(
    () => filtrerRecherche(produits, q, (p) => [p.reference, p.designation, p.categorie, p.unite]),
    [produits, q]
  );
  const affiches = trouves.slice(0, MAX_AFFICHES);

  function choisir(p) {
    if (!p) return;
    onChoisir(p);
    setQ("");
    setOuvert(false);
    setActif(0);
  }

  function touche(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOuvert(true);
      setActif((a) => Math.min(a + 1, affiches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActif((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (ouvert && affiches[actif]) {
        e.preventDefault(); // ne pas valider le formulaire du devis
        choisir(affiches[actif]);
      }
    } else if (e.key === "Escape") {
      setOuvert(false);
    }
  }

  return (
    <div ref={refBoite} style={{ position: "relative" }}>
      <input
        type="text"
        value={q}
        placeholder={placeholder || t("rechPlaceholderProduitPicker")}
        aria-label={placeholder || t("rechPlaceholderProduitPicker")}
        autoComplete="off"
        onChange={(e) => {
          setQ(e.target.value);
          setOuvert(true);
          setActif(0);
        }}
        onFocus={() => setOuvert(true)}
        onBlur={() => setTimeout(() => setOuvert(false), 150)}
        onKeyDown={touche}
        style={{ ...champStyle, ...style }}
      />
      {ouvert && (
        <div role="listbox" style={listeStyle}>
          {affiches.length === 0 ? (
            <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--sub)" }}>{t("rechProduitAucun")}</div>
          ) : (
            affiches.map((p, i) => (
              <div
                key={p.id}
                role="option"
                aria-selected={i === actif}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choisir(p);
                }}
                onMouseEnter={() => setActif(i)}
                style={{ ...optionStyle, background: i === actif ? "rgba(15,76,92,0.08)" : "transparent" }}
              >
                <span style={{ fontWeight: 600 }}>{p.reference ? `${p.reference} · ` : ""}{p.designation}</span>
                <span style={{ color: "var(--sub)", whiteSpace: "nowrap" }}>
                  {Number(p.prix_vente_xof || 0).toLocaleString()}
                  {p.stock_quantite !== undefined ? ` · ${t("produitsColStock")} ${Number(p.stock_quantite).toLocaleString()}` : ""}
                </span>
              </div>
            ))
          )}
          {trouves.length > MAX_AFFICHES && (
            <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--sub)", borderTop: "1px solid var(--line)" }}>
              {t("rechProduitPlus").replace("{n}", String(trouves.length - MAX_AFFICHES))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const champStyle = {
  width: "100%",
  padding: "4px 6px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 11.5,
  fontFamily: "inherit",
  background: "var(--card, #fff)",
  color: "inherit",
};
const listeStyle = {
  position: "absolute",
  zIndex: 30,
  left: 0,
  right: 0,
  top: "100%",
  marginTop: 2,
  maxHeight: 260,
  overflowY: "auto",
  background: "var(--card, #fff)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
};
const optionStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  padding: "7px 10px",
  fontSize: 12,
  cursor: "pointer",
};
