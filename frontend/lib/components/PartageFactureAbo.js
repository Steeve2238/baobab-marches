"use client";

import { useEffect, useState } from "react";
import { superAdminApi } from "../superAdminApi";
import PartageDocument from "./PartageDocument";

/**
 * Carte « Envoi sécurisé au client » d'une facture d'abonnement, d'installation ou de licence (Super Admin = éditeur du logiciel).
 * Charge d'abord les coordonnées de l'entreprise cliente pour pré-remplir l'envoi.
 * @param facture la facture affichée  @param onChange rappelé après un envoi, un renouvellement ou une révocation
 */
export default function PartageFactureAbo({ facture, onChange }) {
  const [prep, setPrep] = useState(null);

  useEffect(() => {
    let annule = false;
    superAdminApi
      .preparationPartageFacture(facture.id)
      .then((p) => !annule && setPrep(p))
      .catch(() => !annule && setPrep({ numero: facture.periode, contact: null }));
    return () => {
      annule = true;
    };
  }, [facture.id, facture.periode]);

  if (!prep) return null;
  return (
    <div className="no-print" id="envoi">
      <PartageDocument
        type="FACTURE_ABO"
        documentId={facture.id}
        numero={prep.numero}
        contact={prep.contact}
        peutCreer={facture.statut !== "ANNULEE"}
        onChange={onChange}
      />
    </div>
  );
}
