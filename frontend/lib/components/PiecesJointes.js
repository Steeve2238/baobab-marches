"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useLangue } from "../i18n/LanguageContext";

/**
 * Pieces jointes d'un element (scan du BC client sur un devis, BC fournisseur signe retourne).
 * Props : type ("DEVIS_BC_CLIENT" | "COMMANDE_FOURNISSEUR"), id, lectureSeule, titre.
 */
export default function PiecesJointes({ type, id, lectureSeule = false, titre }) {
  const { t } = useLangue();
  const [pieces, setPieces] = useState([]);
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const champ = useRef(null);

  const charger = useCallback(() => {
    api.bcPieces(type, id).then((r) => setPieces(r.pieces || [])).catch((e) => setErreur(e.message));
  }, [type, id]);
  useEffect(() => { if (id) charger(); }, [id, charger]);

  async function ajouter(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setErreur("");
    setEnvoi(true);
    try {
      await api.bcAjouterPiece(type, id, f);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
      if (champ.current) champ.current.value = "";
    }
  }

  async function supprimer(p) {
    if (!window.confirm(t("pjSupprimerConfirm"))) return;
    try {
      await api.bcSupprimerPiece(p.id);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  const taille = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6 }}>{titre || t("pjTitre")}</div>
      {pieces.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--sub)", margin: "0 0 8px" }}>{t("pjAucune")}</p>
      ) : (
        <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
          {pieces.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8, background: "var(--bg)", fontSize: 12.5 }}>
              <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{p.nom_fichier}</span>
              <span style={{ color: "var(--sub)", fontSize: 11.5 }}>{taille(p.taille)}</span>
              <button type="button" onClick={() => api.bcOuvrirPiece(p.id, p.nom_fichier).catch((e) => setErreur(e.message))} style={lien}>{t("pjOuvrir")}</button>
              {!lectureSeule && <button type="button" onClick={() => supprimer(p)} style={{ ...lien, color: "var(--brique)" }}>{t("pjSupprimer")}</button>}
            </div>
          ))}
        </div>
      )}
      {!lectureSeule && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ background: "transparent", color: "var(--petrol)", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: envoi ? "wait" : "pointer" }}>
            {envoi ? t("pjEnvoi") : t("pjAjouter")}
            <input ref={champ} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={ajouter} disabled={envoi} style={{ display: "none" }} />
          </label>
          <span style={{ fontSize: 11, color: "var(--sub)" }}>{t("pjFormats")}</span>
        </div>
      )}
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12, margin: "6px 0 0" }}>{erreur}</p>}
    </div>
  );
}

const lien = { background: "none", border: "none", color: "var(--petrol)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, textDecoration: "underline" };
