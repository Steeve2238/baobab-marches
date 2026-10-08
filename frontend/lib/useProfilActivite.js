"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

// Profil d'activite du client (MARCHES | NEGOCE | LES_DEUX, migration 068), lu dans les permissions de
// l'utilisateur connecte. Renvoie null tant que non charge (les libelles ne basculent qu'une fois connu).
export function useProfilActivite() {
  const [profil, setProfil] = useState(null);
  useEffect(() => {
    let actif = true;
    api
      .getPermissions()
      .then((p) => actif && setProfil((p && p.profilActivite) || "LES_DEUX"))
      .catch(() => actif && setProfil("LES_DEUX"));
    return () => {
      actif = false;
    };
  }, []);
  return profil;
}
