"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

// Ancienne fiche devis du module Ventes (13/10/2026) : elle ne gerait qu'UNE facture par devis (pas d'acompte ni de
// solde, pas de negociation de remise). Toutes les fonctions vivent desormais dans la fiche du module Marche / Ventes :
// les anciens liens et favoris y sont simplement rediriges.
export default function AncienneFicheDevis() {
  const router = useRouter();
  const params = useParams();
  useEffect(() => {
    router.replace(`/marches/consultation-restreinte/devis/${params.id}`);
  }, [params.id, router]);
  return null;
}
