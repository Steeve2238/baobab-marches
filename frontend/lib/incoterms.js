"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { INCOTERM_INCLUS } from "./receptionCouts";

// Catalogue d'incoterms de l'entreprise (source unique : scenarios Logistique).
// Tant que l'API n'a pas repondu (ou si elle echoue), on affiche la liste standard.
export function useIncoterms() {
  const [catalogue, setCatalogue] = useState(null);
  useEffect(() => {
    let vivant = true;
    api.getCatalogueIncoterms().then((c) => vivant && Array.isArray(c) && setCatalogue(c)).catch(() => {});
    return () => {
      vivant = false;
    };
  }, []);
  if (!catalogue) return { codes: Object.keys(INCOTERM_INCLUS), table: INCOTERM_INCLUS };
  const table = {};
  for (const i of catalogue) table[String(i.code).toUpperCase()] = Array.isArray(i.inclus) ? i.inclus : [];
  return { codes: catalogue.map((i) => i.code), table };
}

// Ajoute le code deja choisi s'il n'est plus au catalogue (ancienne saisie).
export function codesAvec(codes, valeur) {
  return valeur && !codes.includes(valeur) ? [...codes, valeur] : codes;
}
