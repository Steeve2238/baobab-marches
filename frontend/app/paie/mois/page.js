"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import PaieSousNav from "../../../lib/components/PaieSousNav";
import { Pastille, Champ, inputStyle, boutonPrincipal, boutonLeger, cellule, enteteCellule, droite, fmt, MOIS_FR, useStatut, Statut, tonStatut } from "../../../lib/components/paieUi";

export default function PaieDuMoisPage() {
  const { t } = useLangue();
  const [data, setData] = useState(null);
  const maintenant = new Date();
  const [premier, setPremier] = useState({ annee: String(maintenant.getFullYear()), mois: String(maintenant.getMonth() + 1) });
  const [enCours, setEnCours] = useState(false);
  const s = useStatut();

  const charger = () => api.paiePeriodes().then(setData).catch(s.ko);
  useEffect(() => { charger(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ouvrir() {
    s.raz();
    setEnCours(true);
    try {
      await api.paieOuvrirPeriode(data.prochaine.premiere ? { annee: Number(premier.annee), mois: Number(premier.mois) } : {});
      s.ok(t("paiePeriodeOuverte"));
      await charger();
    } catch (e) { s.ko(e); }
    setEnCours(false);
  }

  if (!data) return <AppShell title={t("paiePeriodesTitre")} subNav={<PaieSousNav />}><Statut s={s} /><p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p></AppShell>;
  const pro = data.prochaine;
  const nomMois = (a, m) => `${t(`paieMoisNom_${m}`)} ${a}`;

  return (
    <AppShell title={t("paiePeriodesTitre")} subNav={<PaieSousNav />}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14, maxWidth: 780, lineHeight: 1.5 }}>{t("paiePeriodesAide")}</p>
      <Statut s={s} />
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 13.5, margin: "0 0 8px" }}>{t("paieProchainePeriode")}</h3>
        {pro.premiere ? (
          <>
            <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "0 0 10px" }}>{t("paiePremierePeriodeAide")}</p>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Champ label={t("paieMois")}>
                <select style={{ ...inputStyle, width: 160 }} value={premier.mois} onChange={(e) => setPremier({ ...premier, mois: e.target.value })}>
                  {MOIS_FR.slice(1).map((m, i) => <option key={m} value={i + 1}>{t(`paieMoisNom_${i + 1}`)}</option>)}
                </select>
              </Champ>
              <Champ label={t("paieAnnee")}><input type="number" style={{ ...inputStyle, width: 100 }} value={premier.annee} onChange={(e) => setPremier({ ...premier, annee: e.target.value })} /></Champ>
              <button style={boutonPrincipal} onClick={ouvrir} disabled={enCours}>{t("paieOuvrirPremiere")}</button>
            </div>
          </>
        ) : pro.bloque ? (
          <p style={{ fontSize: 12.5, margin: 0, lineHeight: 1.55 }}>
            <Pastille ton="alerte">{t("paieBloque")}</Pastille>{" "}
            {t("paieSuivantBloque").replace("{prec}", nomMois(pro.derniere.annee, pro.derniere.mois)).replace("{suiv}", nomMois(pro.annee, pro.mois))}
          </p>
        ) : (
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13 }}>{nomMois(pro.annee, pro.mois)}</span>
            <button style={boutonPrincipal} onClick={ouvrir} disabled={enCours}>{t("paieOuvrirPeriode")} {nomMois(pro.annee, pro.mois)}</button>
          </div>
        )}
      </div>

      {data.periodes.length === 0 ? <div className="card"><p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("paieAucunePeriode")}</p></div> : (
        <div className="card" style={{ overflowX: "auto", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>
              <th style={enteteCellule}>{t("paiePeriode")}</th><th style={enteteCellule}>{t("paieStatut")}</th>
              <th style={{ ...enteteCellule, ...droite }}>{t("paieNbBulletins")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieBrutTotal")}</th>
              <th style={{ ...enteteCellule, ...droite }}>{t("paieNetTotal")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieChargesTotal")}</th><th style={enteteCellule}></th>
            </tr></thead>
            <tbody>
              {data.periodes.map((p) => (
                <tr key={p.id}>
                  <td style={{ ...cellule, fontWeight: 600 }}><Link href={`/paie/mois/${p.id}`} style={{ color: "var(--petrol)" }}>{nomMois(p.annee, p.mois)}</Link></td>
                  <td style={cellule}><Pastille ton={tonStatut[p.statut]}>{t(`paieStatutPeriode_${p.statut}`)}</Pastille></td>
                  <td style={{ ...cellule, ...droite }}>{p.nb_bulletins}</td>
                  <td style={{ ...cellule, ...droite }}>{fmt(p.total_brut)}</td>
                  <td style={{ ...cellule, ...droite }}>{fmt(p.total_net)}</td>
                  <td style={{ ...cellule, ...droite }}>{fmt(p.total_charges)}</td>
                  <td style={{ ...cellule, textAlign: "right", whiteSpace: "nowrap" }}>
                    {p.statut === "OUVERTE" && <Link href={`/paie/variables?periode=${p.id}`} style={{ ...boutonLeger, textDecoration: "none", marginRight: 6 }}>{t("paieSaisirVariables")}</Link>}
                    <Link href={`/paie/mois/${p.id}`} style={{ ...boutonLeger, textDecoration: "none" }}>{t("paieOuvrir")}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
