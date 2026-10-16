"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

// Ancienne fiche facture du module Ventes (13/10/2026) : redirigee vers la fiche actuelle (acompte / solde, remise ligne
// par ligne, lien vers le devis d'origine et facturation de la suite).
export default function AncienneFicheFacture() {
  const router = useRouter();
  const params = useParams();
  useEffect(() => {
    router.replace(`/marches/consultation-restreinte/factures/${params.id}`);
  }, [params.id, router]);
  return null;
}
