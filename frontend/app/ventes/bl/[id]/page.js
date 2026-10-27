"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

// Ancienne fiche BL du module Ventes : elle ne gerait ni les livraisons partielles (rang, reste a livrer) ni l'envoi securise.
// Comme pour les devis et les factures, les anciens liens et favoris sont rediriges vers la fiche du module Marche / Ventes.
export default function AncienneFicheBl() {
  const router = useRouter();
  const params = useParams();
  useEffect(() => {
    router.replace(`/marches/consultation-restreinte/bl/${params.id}`);
  }, [params.id, router]);
  return null;
}
