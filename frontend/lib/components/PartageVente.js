"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import PartageDocument, { PASSERELLE_ENTREPRISE, GENRE_PAR_TYPE } from "./PartageDocument";

/**
 * Carte « Envoi sécurisé au client » d'une facture ou d'un devis : lien + code, suivi des étapes, signature facultative.
 * Charge d'abord le contact du client (e-mail, téléphone) pour pré-remplir l'envoi.
 * @param type "FACTURE" | "DEVIS" | "BON_LIVRAISON" | "AVOIR" | "COMMANDE_FOURNISSEUR"  @param document facture ou devis affiché  @param peutCreer statut compatible avec l'envoi
 */
export default function PartageVente({ type, document, peutCreer, onChange }) {
  const [prep, setPrep] = useState(null);
  const genre = GENRE_PAR_TYPE[type] || "devis";

  useEffect(() => {
    let annule = false;
    api
      .preparationPartageVente(genre, document.id)
      .then((p) => !annule && setPrep(p))
      .catch(() => !annule && setPrep({ numero: document.numero, contact: null, signature_par_defaut: type !== "FACTURE" && type !== "AVOIR" }));
    return () => {
      annule = true;
    };
  }, [genre, document.id, document.numero, type]);

  if (!prep) return null;
  return (
    <div className="no-print">
      <PartageDocument
        type={type}
        documentId={document.id}
        numero={prep.numero}
        contact={prep.contact}
        peutCreer={peutCreer}
        onChange={onChange}
        passerelle={PASSERELLE_ENTREPRISE}
      />
    </div>
  );
}
