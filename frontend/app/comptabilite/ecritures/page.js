"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import {
  useComptaStatut,
  inputStyle,
  boutonPrincipalStyle,
  boutonSecondaireStyle,
  thStyle,
  tdStyle,
  numStyle,
  formaterMontant,
  statutLibelleCle,
  STATUT_COULEURS,
} from "../../../lib/comptaUi";

const PAR_PAGE = 50;

export default function EcrituresPage() {
  return (
    <Suspense fallback={null}>
      <EcrituresContenu />
    </Suspense>
  );
}

// Liste des ecritures (filtres, pagination), validation individuelle ou en lot
// (niveau "validation"), acces a la saisie et au detail.
function EcrituresContenu() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const { statut } = useComptaStatut();
  const recherche = useSearchParams();
  const [filtres, setFiltres] = useState({ statut: recherche.get("statut") || "", journal_id: recherche.get("journal_id") || "", exercice_id: "", q: "", date_debut: "", date_fin: "", compte_numero: "" });
  const [journaux, setJournaux] = useState([]);
  const [exercices, setExercices] = useState([]);
  const [donnees, setDonnees] = useState({ total: 0, ecritures: [] });
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState([]);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");

  const valid = !!statut?.droits?.validation;

  useEffect(() => {
    api.comptaJournaux().then(setJournaux).catch(() => {});
    api.comptaExercices().then(setExercices).catch(() => {});
  }, []);

  function charger() {
    const params = { limit: PAR_PAGE, offset: page * PAR_PAGE };
    for (const [k, v] of Object.entries(filtres)) if (v) params[k] = v;
    api
      .comptaEcritures(params)
      .then((d) => {
        setDonnees(d);
        setSelection([]);
      })
      .catch((e) => setErreur(e.message));
  }
  useEffect(charger, [filtres, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const majFiltre = (cle, valeur) => {
    setPage(0);
    setFiltres((f) => ({ ...f, [cle]: valeur }));
  };

  async function validerSelection() {
    setErreur("");
    setInfo("");
    try {
      const r = await api.comptaValiderLot(selection);
      setInfo(`${r.valides.length} ${t("comptaEcrituresValidees")}`);
      if (r.erreurs.length) setErreur(r.erreurs.map((x) => x.error).join(" | "));
      charger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  const validables = donnees.ecritures.filter((e) => e.statut !== "VALIDEE");
  const toutCoche = validables.length > 0 && validables.every((e) => selection.includes(e.id));
  const pages = Math.max(1, Math.ceil(donnees.total / PAR_PAGE));

  return (
    <AppShell title={t("comptaNavEcritures")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      {statut && !statut.initialisee && <p style={{ fontSize: 12.5, color: "var(--ocre)" }}>{t("comptaNonInitialisee")}</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select value={filtres.exercice_id} onChange={(e) => majFiltre("exercice_id", e.target.value)} style={{ ...inputStyle, width: 150 }}>
          <option value="">{t("comptaTousExercices")}</option>
          {exercices.map((x) => (
            <option key={x.id} value={x.id}>
              {x.libelle}
            </option>
          ))}
        </select>
        <select value={filtres.journal_id} onChange={(e) => majFiltre("journal_id", e.target.value)} style={{ ...inputStyle, width: 140 }}>
          <option value="">{t("comptaTousJournaux")}</option>
          {journaux.map((j) => (
            <option key={j.id} value={j.id}>
              {j.code} — {j.libelle}
            </option>
          ))}
        </select>
        <select value={filtres.statut} onChange={(e) => majFiltre("statut", e.target.value)} style={{ ...inputStyle, width: 150 }}>
          <option value="">{t("comptaTousStatuts")}</option>
          {["BROUILLON", "EN_INSTANCE", "VALIDEE"].map((s) => (
            <option key={s} value={s}>
              {t(statutLibelleCle(s))}
            </option>
          ))}
        </select>
        <input type="date" value={filtres.date_debut} onChange={(e) => majFiltre("date_debut", e.target.value)} style={{ ...inputStyle, width: 140 }} />
        <input type="date" value={filtres.date_fin} onChange={(e) => majFiltre("date_fin", e.target.value)} style={{ ...inputStyle, width: 140 }} />
        <input placeholder={t("comptaCompteDebutPlaceholder")} value={filtres.compte_numero} onChange={(e) => majFiltre("compte_numero", e.target.value.replace(/\D/g, ""))} style={{ ...inputStyle, width: 130 }} />
        <input placeholder={t("comptaPlanRecherche")} value={filtres.q} onChange={(e) => majFiltre("q", e.target.value)} style={{ ...inputStyle, width: 200 }} />
        {statut?.droits?.ecriture && statut?.initialisee && (
          <Link href="/comptabilite/ecritures/nouvelle" style={{ ...boutonPrincipalStyle, display: "inline-block" }}>
            {t("comptaNouvelleEcriture")}
          </Link>
        )}
        {valid && selection.length > 0 && (
          <button style={boutonSecondaireStyle} onClick={validerSelection}>
            {t("comptaValiderSelection")} ({selection.length})
          </button>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {valid && (
                <th style={thStyle}>
                  <input type="checkbox" checked={toutCoche} onChange={(e) => setSelection(e.target.checked ? validables.map((x) => x.id) : [])} />
                </th>
              )}
              <th style={thStyle}>{t("comptaDate")}</th>
              <th style={thStyle}>{t("comptaJournal")}</th>
              <th style={thStyle}>{t("comptaNumeroEcriture")}</th>
              <th style={thStyle}>{t("comptaPiece")}</th>
              <th style={thStyle}>{t("comptaLibelle")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaDebit")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaCredit")}</th>
              <th style={thStyle}>{t("comptaStatut")}</th>
            </tr>
          </thead>
          <tbody>
            {donnees.ecritures.map((e) => (
              <tr key={e.id}>
                {valid && (
                  <td style={tdStyle}>
                    {e.statut !== "VALIDEE" && (
                      <input type="checkbox" checked={selection.includes(e.id)} onChange={(ev) => setSelection((s) => (ev.target.checked ? [...s, e.id] : s.filter((x) => x !== e.id)))} />
                    )}
                  </td>
                )}
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{e.date_ecriture}</td>
                <td style={{ ...tdStyle, fontWeight: 700 }}>{e.journal_code}</td>
                <td style={tdStyle}>{e.numero_ecriture ?? "—"}</td>
                <td style={tdStyle}>{e.numero_piece || ""}</td>
                <td style={tdStyle}>
                  <Link href={`/comptabilite/ecritures/${e.id}`} style={{ color: "var(--petrol)", fontWeight: 600 }}>
                    {e.libelle}
                  </Link>
                  {e.origine !== "SAISIE" && <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--sub)" }}>[{e.origine}]</span>}
                </td>
                <td style={{ ...tdStyle, ...numStyle }}>{formaterMontant(e.total_debit, locale)}</td>
                <td style={{ ...tdStyle, ...numStyle }}>{formaterMontant(e.total_credit, locale)}</td>
                <td style={tdStyle}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, ...STATUT_COULEURS[e.statut] }}>{t(statutLibelleCle(e.statut))}</span>
                </td>
              </tr>
            ))}
            {donnees.ecritures.length === 0 && (
              <tr>
                <td colSpan={9} style={{ ...tdStyle, color: "var(--sub)" }}>
                  {t("comptaAucuneEcriture")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, fontSize: 12.5 }}>
        <button style={boutonSecondaireStyle} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          ←
        </button>
        <span>
          {page + 1} / {pages} — {donnees.total} {t("comptaEcrituresMot")}
        </span>
        <button style={boutonSecondaireStyle} disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
          →
        </button>
      </div>
    </AppShell>
  );
}
