"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

const TYPES_DEMANDE = [
  "CONGE",
  "AVANCE",
  "ORDRE_MISSION",
  "HEURES_SUP",
  "DEMANDE_FONDS",
  "CARBURANT",
  "FOURNITURES",
  "PHOTOCOPIE",
  "EXPRESSION_BESOIN",
];

export default function CircuitApprobationPage() {
  const { t, typeDemandeRHLabel } = useLangue();
  const [roles, setRoles] = useState([]);
  const [mapping, setMapping] = useState({}); // role_demandeur_id -> role_approbateur_id ("" = pas de regle)
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [chargement, setChargement] = useState(true);

  // Circuit a plusieurs etapes (par type de demande) - enrichissement lie
  // aux modeles de fiches OGAA/ARED (Fournitures, Demande de fonds,
  // Carburant... ont plusieurs visas successifs).
  const [typeEtapes, setTypeEtapes] = useState(TYPES_DEMANDE[0]);
  const [etapes, setEtapes] = useState([]);
  const [chargementEtapes, setChargementEtapes] = useState(false);
  const [erreurEtapes, setErreurEtapes] = useState("");
  const [messageEtapes, setMessageEtapes] = useState("");
  const [enCoursEtapes, setEnCoursEtapes] = useState(false);

  useEffect(() => {
    Promise.all([api.getRoles(), api.getReglesApprobationRH()])
      .then(([rolesData, regles]) => {
        setRoles(rolesData);
        const m = {};
        for (const r of regles) {
          m[r.role_demandeur_id] = r.role_approbateur_id;
        }
        setMapping(m);
      })
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  useEffect(() => {
    chargerEtapes(typeEtapes);
  }, [typeEtapes]);

  async function chargerEtapes(type) {
    setChargementEtapes(true);
    setErreurEtapes("");
    setMessageEtapes("");
    try {
      const data = await api.getEtapesApprobationRH(type);
      setEtapes(data.map((e) => ({ libelle: e.libelle, role_approbateur_id: e.role_approbateur_id || "" })));
    } catch (err) {
      setErreurEtapes(err.message);
    } finally {
      setChargementEtapes(false);
    }
  }

  function ajouterEtape() {
    setEtapes((es) => [...es, { libelle: "", role_approbateur_id: "" }]);
  }

  function supprimerEtape(i) {
    setEtapes((es) => es.filter((_, idx) => idx !== i));
  }

  function majEtape(i, champ, valeur) {
    setEtapes((es) => es.map((e, idx) => (idx === i ? { ...e, [champ]: valeur } : e)));
  }

  function deplacerEtape(i, direction) {
    setEtapes((es) => {
      const j = i + direction;
      if (j < 0 || j >= es.length) return es;
      const copie = [...es];
      [copie[i], copie[j]] = [copie[j], copie[i]];
      return copie;
    });
  }

  async function handleEnregistrerEtapes() {
    setEnCoursEtapes(true);
    setErreurEtapes("");
    setMessageEtapes("");
    try {
      const payload = etapes.map((e) => ({ libelle: e.libelle, role_approbateur_id: e.role_approbateur_id || null }));
      const data = await api.putEtapesApprobationRH(typeEtapes, payload);
      setEtapes(data.map((e) => ({ libelle: e.libelle, role_approbateur_id: e.role_approbateur_id || "" })));
      setMessageEtapes(t("etapesUpdated"));
    } catch (err) {
      setErreurEtapes(err.message);
    } finally {
      setEnCoursEtapes(false);
    }
  }

  async function handleEnregistrer() {
    setEnCours(true);
    setErreur("");
    setMessage("");
    try {
      const regles = Object.entries(mapping)
        .filter(([, approbateurId]) => approbateurId)
        .map(([role_demandeur_id, role_approbateur_id]) => ({ role_demandeur_id, role_approbateur_id }));
      await api.patchReglesApprobationRH(regles);
      setMessage(t("reglesUpdated"));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  const rolesNonAdmin = roles.filter((r) => r.code !== "ADMIN");

  return (
    <AppShell title={t("circuitApprobationPageTitle")}>
      <Link href="/rh/personnel" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>
        {t("backToPersonnel")}
      </Link>

      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 16, maxWidth: 640 }}>
        {t("circuitApprobationPageSubtitle")}
      </p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : (
        <div className="card" style={{ maxWidth: 560 }}>
          {rolesNonAdmin.map((role) => (
            <div key={role.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>
                  {t("roleDemandeurLabel")}
                </div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{role.libelle}</div>
              </div>
              <select
                value={mapping[role.id] || ""}
                onChange={(e) => setMapping((m) => ({ ...m, [role.id]: e.target.value }))}
                style={inputStyle}
              >
                <option value="">{t("selectRoleApprobateur")}</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.libelle}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <button onClick={handleEnregistrer} disabled={enCours} style={{ ...boutonPrincipalStyle, marginTop: 8 }}>
            {enCours ? t("savingRegles") : t("saveReglesButton")}
          </button>
        </div>
      )}

      <h2 style={{ fontSize: 15, color: "var(--petrol)", marginTop: 28, marginBottom: 4 }}>{t("circuitEtapesTitle")}</h2>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14, maxWidth: 640 }}>{t("circuitEtapesSubtitle")}</p>

      <div className="card" style={{ maxWidth: 620 }}>
        <label style={labelStyle}>{t("typeDemandePourEtapesLabel")}</label>
        <select value={typeEtapes} onChange={(e) => setTypeEtapes(e.target.value)} style={inputStyle}>
          {TYPES_DEMANDE.map((ty) => (
            <option key={ty} value={ty}>
              {typeDemandeRHLabel(ty)}
            </option>
          ))}
        </select>

        {erreurEtapes && <p style={{ color: "var(--brique)", fontSize: 12.5, marginTop: 10 }}>{erreurEtapes}</p>}
        {messageEtapes && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginTop: 10 }}>{messageEtapes}</p>}

        {chargementEtapes ? (
          <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 12 }}>{t("loading")}</p>
        ) : (
          <div style={{ marginTop: 12 }}>
            {etapes.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10 }}>{t("noEtapesConfigurees")}</p>
            )}
            {etapes.map((etape, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11.5, color: "var(--sub)", width: 16, textAlign: "right" }}>{i + 1}.</span>
                <input
                  placeholder={t("libelleEtapeLabel")}
                  value={etape.libelle}
                  onChange={(e) => majEtape(i, "libelle", e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <select
                  value={etape.role_approbateur_id}
                  onChange={(e) => majEtape(i, "role_approbateur_id", e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  <option value="">{t("selectRoleApprobateur")}</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.libelle}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => deplacerEtape(i, -1)} disabled={i === 0} style={boutonMiniStyle} title={t("monterEtapeButton")}>
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => deplacerEtape(i, 1)}
                  disabled={i === etapes.length - 1}
                  style={boutonMiniStyle}
                  title={t("descendreEtapeButton")}
                >
                  ↓
                </button>
                <button type="button" onClick={() => supprimerEtape(i)} style={boutonMiniStyle} title={t("supprimerEtapeButton")}>
                  ✕
                </button>
              </div>
            ))}

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button type="button" onClick={ajouterEtape} style={boutonMiniStyle}>
                {t("ajouterEtapeButton")}
              </button>
              <button
                type="button"
                onClick={handleEnregistrerEtapes}
                disabled={enCoursEtapes || etapes.some((e) => !e.libelle.trim())}
                style={boutonPrincipalStyle}
              >
                {enCoursEtapes ? t("savingEtapes") : t("saveEtapesButton")}
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

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
const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const boutonMiniStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--petrol)",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
