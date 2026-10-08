"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import PaieSousNav from "../../../lib/components/PaieSousNav";
import { Pastille, inputStyle, cellule, enteteCellule, droite, fmt } from "../../../lib/components/paieUi";

export default function DossiersPaiePage() {
  const { t } = useLangue();
  const [lignes, setLignes] = useState(null);
  const [erreur, setErreur] = useState("");
  const [q, setQ] = useState("");
  const [filtre, setFiltre] = useState("TOUS");

  useEffect(() => {
    api.paieDossiers().then(setLignes).catch((e) => setErreur(e.message));
  }, []);

  const visibles = useMemo(() => {
    if (!lignes) return [];
    const n = q.trim().toLowerCase();
    return lignes.filter((l) => {
      if (filtre === "INCOMPLETS" && l.complet) return false;
      if (filtre === "COMPLETS" && !l.complet) return false;
      return !n || `${l.nom || ""} ${l.prenom || ""} ${l.matricule || ""}`.toLowerCase().includes(n);
    });
  }, [lignes, q, filtre]);

  return (
    <AppShell title={t("paieDossiersTitre")} subNav={<PaieSousNav />}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14, maxWidth: 780, lineHeight: 1.5 }}>{t("paieDossiersAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <input style={{ ...inputStyle, maxWidth: 280 }} placeholder={t("paieRechercher")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ ...inputStyle, width: 200 }} value={filtre} onChange={(e) => setFiltre(e.target.value)}>
          <option value="TOUS">{t("paieFiltreTous")}</option>
          <option value="INCOMPLETS">{t("paieFiltreIncomplets")}</option>
          <option value="COMPLETS">{t("paieFiltreComplets")}</option>
        </select>
      </div>
      {!lignes ? <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p> : (
        <div className="card" style={{ overflowX: "auto", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>
              <th style={enteteCellule}>{t("paieSalarie")}</th><th style={enteteCellule}>{t("paieConvention")}</th><th style={enteteCellule}>{t("paieCategorie")}</th>
              <th style={{ ...enteteCellule, ...droite }}>{t("paieSalaireBase")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieSursalaire")}</th><th style={enteteCellule}>{t("paieStatutDossier")}</th>
            </tr></thead>
            <tbody>
              {visibles.map((l) => (
                <tr key={l.id}>
                  <td style={cellule}><Link href={`/paie/dossiers/${l.id}`} style={{ color: "var(--petrol)", fontWeight: 600 }}>{l.nom} {l.prenom}</Link><div className="mono" style={{ fontSize: 11, color: "var(--sub)" }}>{l.matricule}</div></td>
                  <td style={cellule}>{l.convention_libelle || "—"}</td>
                  <td style={cellule}>{l.categorie_libelle || l.categorie_code || "—"}</td>
                  <td style={{ ...cellule, ...droite }}>{fmt(l.salaire_base)}</td>
                  <td style={{ ...cellule, ...droite }}>{fmt(l.sursalaire)}</td>
                  <td style={cellule}>{l.complet ? <Pastille ton="ok">{t("paieDossierComplet")}</Pastille> : <Pastille ton="alerte">{t("paieDossierAComplet")}</Pastille>}{l.actif_paie === false && <> <Pastille ton="neutre">{t("paieHorsPaie")}</Pastille></>}</td>
                </tr>
              ))}
              {visibles.length === 0 && <tr><td colSpan={6} style={{ ...cellule, color: "var(--sub)" }}>{t("paieAucunSalarie")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
