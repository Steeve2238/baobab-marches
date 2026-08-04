"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

const TYPE_FACILITE_CODES = [
  "CAUTION_BANCAIRE",
  "AVANCE_MARCHE",
  "LC_INTERNATIONAL",
  "CREDIT_TRESORERIE",
  "AVAL_TRAITE",
  "CREDIT_RELAIS",
];

export default function FinancementPage() {
  const { t, grilleStatutLabel, typeFaciliteLabel, dict } = useLangue();

  const [partenaires, setPartenaires] = useState([]);
  const [selectedPartenaireId, setSelectedPartenaireId] = useState(null);
  const [grilles, setGrilles] = useState([]);
  const [selectedGrilleId, setSelectedGrilleId] = useState(null);
  const [lignes, setLignes] = useState([]);
  const [erreur, setErreur] = useState("");

  const [formPartenaire, setFormPartenaire] = useState({ nom: "", type_partenaire: "BANQUE" });
  const [formGrille, setFormGrille] = useState({ version_label: "", date_effet: "" });
  const [formLigne, setFormLigne] = useState({
    type_facilite: TYPE_FACILITE_CODES[0],
    taux_annuel: "",
    commission_pct: "",
    taf_pct: "",
    plafond_montant: "",
  });

  useEffect(() => {
    api
      .getPartenaires()
      .then(setPartenaires)
      .catch((err) => setErreur(err.message));
  }, []);

  useEffect(() => {
    if (!selectedPartenaireId) {
      setGrilles([]);
      setSelectedGrilleId(null);
      return;
    }
    api
      .getGrilles(selectedPartenaireId)
      .then(setGrilles)
      .catch((err) => setErreur(err.message));
  }, [selectedPartenaireId]);

  useEffect(() => {
    if (!selectedGrilleId) {
      setLignes([]);
      return;
    }
    api
      .getLignes(selectedGrilleId)
      .then(setLignes)
      .catch((err) => setErreur(err.message));
  }, [selectedGrilleId]);

  async function handleAjouterPartenaire(e) {
    e.preventDefault();
    try {
      const nouveau = await api.createPartenaire(formPartenaire);
      setPartenaires((prev) => [...prev, nouveau]);
      setFormPartenaire({ nom: "", type_partenaire: "BANQUE" });
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleAjouterGrille(e) {
    e.preventDefault();
    try {
      const nouvelle = await api.createGrille(selectedPartenaireId, formGrille);
      setGrilles((prev) => [nouvelle, ...prev]);
      setFormGrille({ version_label: "", date_effet: "" });
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleChangerStatutGrille(grilleId, statut) {
    try {
      const maj = await api.patchGrilleStatut(grilleId, statut);
      setGrilles((prev) => prev.map((g) => (g.id === grilleId ? maj : g)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleAjouterLigne(e) {
    e.preventDefault();
    try {
      const payload = {
        ...formLigne,
        taux_annuel: formLigne.taux_annuel ? Number(formLigne.taux_annuel) : null,
        commission_pct: formLigne.commission_pct ? Number(formLigne.commission_pct) : null,
        taf_pct: formLigne.taf_pct ? Number(formLigne.taf_pct) : null,
        plafond_montant: formLigne.plafond_montant ? Number(formLigne.plafond_montant) : null,
      };
      const nouvelle = await api.createLigne(selectedGrilleId, payload);
      setLignes((prev) => [...prev, nouvelle]);
      setFormLigne({
        type_facilite: TYPE_FACILITE_CODES[0],
        taux_annuel: "",
        commission_pct: "",
        taf_pct: "",
        plafond_montant: "",
      });
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <AppShell title={t("partnersPageTitle")}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, alignItems: "start" }}>
        {/* Colonne 1 : Partenaires */}
        <div>
          <h2 style={colTitleStyle}>{t("partnersPageTitle")}</h2>
          <form onSubmit={handleAjouterPartenaire} className="card" style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t("partnerNameLabel")}</label>
            <input
              required
              value={formPartenaire.nom}
              onChange={(e) => setFormPartenaire((f) => ({ ...f, nom: e.target.value }))}
              style={inputStyle}
            />
            <label style={{ ...labelStyle, marginTop: 10 }}>{t("partnerTypeLabel")}</label>
            <select
              value={formPartenaire.type_partenaire}
              onChange={(e) => setFormPartenaire((f) => ({ ...f, type_partenaire: e.target.value }))}
              style={inputStyle}
            >
              <option value="BANQUE">{t("bankOption")}</option>
              <option value="ASSURANCE">{t("insuranceOption")}</option>
            </select>
            <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12, width: "100%" }}>
              {t("addPartner")}
            </button>
          </form>

          {partenaires.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noPartners")}</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {partenaires.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedPartenaireId(p.id);
                    setSelectedGrilleId(null);
                  }}
                  style={{
                    ...ligneListeStyle,
                    background: selectedPartenaireId === p.id ? "var(--petrol)" : "#fff",
                    color: selectedPartenaireId === p.id ? "#fff" : "var(--ink)",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{p.nom}</div>
                  <div style={{ fontSize: 10.5, opacity: 0.75 }}>
                    {p.type_partenaire === "BANQUE" ? t("bankOption") : t("insuranceOption")}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Colonne 2 : Grilles tarifaires */}
        <div>
          <h2 style={colTitleStyle}>{t("gridsSection")}</h2>
          {!selectedPartenaireId ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("selectPartner")}</p>
          ) : (
            <>
              <form onSubmit={handleAjouterGrille} className="card" style={{ marginBottom: 12 }}>
                <label style={labelStyle}>{t("versionLabelLabel")}</label>
                <input
                  required
                  value={formGrille.version_label}
                  onChange={(e) => setFormGrille((f) => ({ ...f, version_label: e.target.value }))}
                  style={inputStyle}
                />
                <label style={{ ...labelStyle, marginTop: 10 }}>{t("effectiveDateLabel")}</label>
                <input
                  type="date"
                  value={formGrille.date_effet}
                  onChange={(e) => setFormGrille((f) => ({ ...f, date_effet: e.target.value }))}
                  style={inputStyle}
                />
                <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12, width: "100%" }}>
                  {t("newGrid")}
                </button>
              </form>

              <div style={{ display: "grid", gap: 6 }}>
                {grilles.map((g) => (
                  <div
                    key={g.id}
                    style={{
                      ...ligneListeStyle,
                      background: selectedGrilleId === g.id ? "var(--petrol)" : "#fff",
                      color: selectedGrilleId === g.id ? "#fff" : "var(--ink)",
                      cursor: "pointer",
                    }}
                    onClick={() => setSelectedGrilleId(g.id)}
                  >
                    <div style={{ fontWeight: 600 }}>{g.version_label}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                      {["EN_NEGOCIATION", "ACTIVE", "ARCHIVEE"].map((s) => (
                        <button
                          key={s}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleChangerStatutGrille(g.id, s);
                          }}
                          style={{
                            fontSize: 9.5,
                            padding: "2px 6px",
                            borderRadius: 10,
                            border: "1px solid rgba(0,0,0,0.15)",
                            background: g.statut === s ? "var(--ocre)" : "transparent",
                            color: g.statut === s ? "#fff" : "inherit",
                          }}
                        >
                          {grilleStatutLabel(s)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Colonne 3 : Lignes tarifaires */}
        <div>
          <h2 style={colTitleStyle}>{t("linesSection")}</h2>
          {!selectedGrilleId ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)" }}>—</p>
          ) : (
            <>
              <form onSubmit={handleAjouterLigne} className="card" style={{ marginBottom: 12 }}>
                <label style={labelStyle}>{t("facilityTypeLabel")}</label>
                <select
                  value={formLigne.type_facilite}
                  onChange={(e) => setFormLigne((f) => ({ ...f, type_facilite: e.target.value }))}
                  style={inputStyle}
                >
                  {TYPE_FACILITE_CODES.map((code) => (
                    <option key={code} value={code}>
                      {typeFaciliteLabel(code)}
                    </option>
                  ))}
                </select>
                <label style={{ ...labelStyle, marginTop: 10 }}>{t("annualRateLabel")}</label>
                <input
                  type="number"
                  step="any"
                  value={formLigne.taux_annuel}
                  onChange={(e) => setFormLigne((f) => ({ ...f, taux_annuel: e.target.value }))}
                  style={inputStyle}
                />
                <label style={{ ...labelStyle, marginTop: 10 }}>{t("commissionLabel")}</label>
                <input
                  type="number"
                  step="any"
                  value={formLigne.commission_pct}
                  onChange={(e) => setFormLigne((f) => ({ ...f, commission_pct: e.target.value }))}
                  style={inputStyle}
                />
                <label style={{ ...labelStyle, marginTop: 10 }}>{t("tafLabel")}</label>
                <input
                  type="number"
                  step="any"
                  value={formLigne.taf_pct}
                  onChange={(e) => setFormLigne((f) => ({ ...f, taf_pct: e.target.value }))}
                  style={inputStyle}
                />
                <label style={{ ...labelStyle, marginTop: 10 }}>{t("capLabel")}</label>
                <input
                  type="number"
                  step="any"
                  value={formLigne.plafond_montant}
                  onChange={(e) => setFormLigne((f) => ({ ...f, plafond_montant: e.target.value }))}
                  style={inputStyle}
                />
                <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12, width: "100%" }}>
                  {t("addLine")}
                </button>
              </form>

              <div style={{ display: "grid", gap: 6 }}>
                {lignes.map((l) => (
                  <div key={l.id} style={ligneListeStyle}>
                    <div style={{ fontWeight: 600 }}>{typeFaciliteLabel(l.type_facilite)}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--sub)" }}>
                      {l.taux_annuel != null ? `${l.taux_annuel}%/an` : ""}
                      {l.commission_pct != null ? ` · ${l.commission_pct}% comm.` : ""}
                      {l.taf_pct != null ? ` · ${l.taf_pct}% TAF` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

const colTitleStyle = { fontSize: 13.5, color: "var(--petrol)", marginBottom: 10, fontWeight: 700 };
const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
};
const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
};
const ligneListeStyle = {
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12.5,
  textAlign: "left",
  width: "100%",
};
