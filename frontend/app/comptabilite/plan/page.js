"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import { useComptaStatut, labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, thStyle, tdStyle } from "../../../lib/comptaUi";

const NATURES = ["GENERAL", "COLLECTIF_CLIENT", "COLLECTIF_FOURNISSEUR", "TRESORERIE"];

// Plan comptable SYSCOHADA du tenant : consultation, creation d'un compte
// (niveau saisie : le numero propose se place juste apres le dernier compte du
// compte parent), modification du libelle / des attributs (niveau validation).
export default function PlanComptablePage() {
  const { t } = useLangue();
  const { statut } = useComptaStatut();
  const [comptes, setComptes] = useState([]);
  const [q, setQ] = useState("");
  const [classe, setClasse] = useState("");
  const [masquerInactifs, setMasquerInactifs] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [edition, setEdition] = useState(null);
  const [creation, setCreation] = useState(null);

  function charger() {
    api
      .comptaComptes({ limit: 5000 })
      .then(setComptes)
      .catch((e) => setErreur(e.message));
  }
  useEffect(charger, []);

  const filtres = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return comptes.filter((c) => {
      if (classe && String(c.classe) !== classe) return false;
      if (masquerInactifs && !c.actif) return false;
      if (needle && !c.numero.includes(needle) && !c.libelle.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [comptes, q, classe, masquerInactifs]);

  const peutValider = !!statut?.droits?.validation;
  const peutEcrire = !!statut?.droits?.ecriture;

  async function proposerNumero(parent) {
    setErreur("");
    try {
      const r = await api.comptaProchainNumero(parent);
      setCreation((c) => ({ ...c, parent, numero: r.numero }));
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function creer(e) {
    e.preventDefault();
    setErreur("");
    try {
      const c = await api.comptaCreerCompte({ numero: creation.numero, libelle: creation.libelle, nature: creation.nature });
      setInfo(`${t("comptaCompteCree")} ${c.numero}`);
      setCreation(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function enregistrer(e) {
    e.preventDefault();
    setErreur("");
    try {
      const patch = { libelle: edition.libelle, actif: edition.actif };
      if (!edition.utilise) {
        patch.numero = edition.numero;
        patch.nature = edition.nature;
      }
      await api.comptaModifierCompte(edition.id, patch);
      setInfo(t("comptaCompteModifie"));
      setEdition(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  const champsNature = (valeur, onChange) => (
    <select value={valeur} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      {NATURES.map((n) => (
        <option key={n} value={n}>
          {t("comptaNature_" + n)}
        </option>
      ))}
    </select>
  );

  return (
    <AppShell title={t("comptaNavPlan")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      {statut && !statut.initialisee && <p style={{ fontSize: 12.5, color: "var(--ocre)" }}>{t("comptaNonInitialisee")}</p>}

      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 760, lineHeight: 1.5 }}>{t("comptaPlanAide")}</p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <input placeholder={t("comptaPlanRecherche")} value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inputStyle, width: 260 }} />
        <select value={classe} onChange={(e) => setClasse(e.target.value)} style={{ ...inputStyle, width: 150 }}>
          <option value="">{t("comptaToutesClasses")}</option>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <option key={n} value={n}>
              {t("comptaClasse")} {n}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={masquerInactifs} onChange={(e) => setMasquerInactifs(e.target.checked)} />
          {t("comptaMasquerInactifs")}
        </label>
        {peutEcrire && statut?.initialisee && (
          <button style={boutonPrincipalStyle} onClick={() => setCreation({ parent: "", numero: "", libelle: "", nature: "GENERAL" })}>
            {t("comptaNouveauCompte")}
          </button>
        )}
        <span style={{ fontSize: 12, color: "var(--sub)" }}>
          {filtres.length} / {comptes.length}
        </span>
      </div>

      {creation && (
        <form onSubmit={creer} className="card" style={{ marginBottom: 16, maxWidth: 640, display: "grid", gap: 10 }}>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)" }}>{t("comptaNouveauCompte")}</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={labelStyle}>{t("comptaCompteParent")}</label>
              <input value={creation.parent} onChange={(e) => setCreation((c) => ({ ...c, parent: e.target.value.replace(/\D/g, "") }))} placeholder="ex. 7061" style={inputStyle} />
            </div>
            <button type="button" style={boutonSecondaireStyle} disabled={!creation.parent} onClick={() => proposerNumero(creation.parent)}>
              {t("comptaProposerNumero")}
            </button>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ width: 170 }}>
              <label style={labelStyle}>{t("comptaNumero")}</label>
              <input required value={creation.numero} onChange={(e) => setCreation((c) => ({ ...c, numero: e.target.value.replace(/\D/g, "") }))} style={{ ...inputStyle, fontFamily: "IBM Plex Mono, monospace" }} />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={labelStyle}>{t("comptaLibelle")}</label>
              <input required value={creation.libelle} onChange={(e) => setCreation((c) => ({ ...c, libelle: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ width: 220 }}>
              <label style={labelStyle}>{t("comptaNature")}</label>
              {champsNature(creation.nature, (v) => setCreation((c) => ({ ...c, nature: v })))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" style={boutonPrincipalStyle}>
              {t("comptaCreer")}
            </button>
            <button type="button" style={boutonSecondaireStyle} onClick={() => setCreation(null)}>
              {t("comptaAnnuler")}
            </button>
          </div>
        </form>
      )}

      {edition && (
        <form onSubmit={enregistrer} className="card" style={{ marginBottom: 16, maxWidth: 640, display: "grid", gap: 10 }}>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)" }}>
            {t("comptaModifierCompte")} {edition.numero}
          </h3>
          <div>
            <label style={labelStyle}>{t("comptaLibelle")}</label>
            <input required value={edition.libelle} onChange={(e) => setEdition((c) => ({ ...c, libelle: e.target.value }))} style={inputStyle} />
          </div>
          {edition.utilise ? (
            <p style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("comptaCompteVerrouilleAide")}</p>
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ width: 170 }}>
                <label style={labelStyle}>{t("comptaNumero")}</label>
                <input value={edition.numero} onChange={(e) => setEdition((c) => ({ ...c, numero: e.target.value.replace(/\D/g, "") }))} style={{ ...inputStyle, fontFamily: "IBM Plex Mono, monospace" }} />
              </div>
              <div style={{ width: 220 }}>
                <label style={labelStyle}>{t("comptaNature")}</label>
                {champsNature(edition.nature, (v) => setEdition((c) => ({ ...c, nature: v })))}
              </div>
            </div>
          )}
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={edition.actif} onChange={(e) => setEdition((c) => ({ ...c, actif: e.target.checked }))} />
            {t("comptaCompteActif")}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" style={boutonPrincipalStyle}>
              {t("comptaEnregistrer")}
            </button>
            <button type="button" style={boutonSecondaireStyle} onClick={() => setEdition(null)}>
              {t("comptaAnnuler")}
            </button>
          </div>
        </form>
      )}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("comptaNumero")}</th>
              <th style={thStyle}>{t("comptaLibelle")}</th>
              <th style={thStyle}>{t("comptaNature")}</th>
              <th style={thStyle}>{t("comptaSens")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {filtres.slice(0, 600).map((c) => (
              <tr key={c.id} style={{ opacity: c.actif ? 1 : 0.5 }}>
                <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace" }}>{c.numero}</td>
                <td style={tdStyle}>{c.libelle}</td>
                <td style={{ ...tdStyle, color: "var(--sub)", fontSize: 11.5 }}>{c.nature === "GENERAL" ? "" : t("comptaNature_" + c.nature)}</td>
                <td style={{ ...tdStyle, color: "var(--sub)" }}>{c.sens_normal === "D" ? t("comptaDebit") : t("comptaCredit")}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap", textAlign: "right" }}>
                  {peutEcrire && (
                    <button
                      style={{ ...boutonSecondaireStyle, padding: "3px 8px", marginRight: 6 }}
                      onClick={() => setCreation({ parent: c.numero.replace(/0+$/, "") || c.numero.slice(0, 1), numero: "", libelle: "", nature: "GENERAL" })}
                    >
                      {t("comptaSousCompte")}
                    </button>
                  )}
                  {peutValider && (
                    <button style={{ ...boutonSecondaireStyle, padding: "3px 8px" }} onClick={() => setEdition({ ...c })}>
                      {t("comptaModifier")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtres.length > 600 && <p style={{ padding: 10, fontSize: 12, color: "var(--sub)" }}>{t("comptaAffinerRecherche")}</p>}
      </div>
    </AppShell>
  );
}
