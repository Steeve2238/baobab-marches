"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

// Modules geres par le systeme de permissions par role (04-05/09/2026) - ces
// cles correspondent EXACTEMENT a celles verifiees par requireModule() cote
// backend (voir middleware/auth.js) : toute cle ici doit avoir son miroir
// exact dans un appel router.use(requireModule("...")) d'un fichier de
// routes, sinon le module resterait affiche dans la sidebar sans jamais
// etre reellement protege (ou l'inverse). Reutilise les libelles de
// navigation deja traduits (navFinancing, navLogistics...) plutot que d'en
// dupliquer de nouveaux.
const MODULES_DISPONIBLES = [
  { key: "financement", labelKey: "navFinancing" },
  { key: "logistique", labelKey: "navLogistics" },
  { key: "fournisseurs", labelKey: "navSuppliers" },
  { key: "courriers", labelKey: "navLetters" },
  { key: "parc-auto", labelKey: "navParcAuto" },
  { key: "marches", labelKey: "navMarches" },
  { key: "dossiers", labelKey: "navDossiers" },
];

const FORM_VIDE = {
  code: "",
  libelle: "",
  modules: [],
  tableauDeBord: false,
  lectureSeule: false,
  validateurUniversel: false,
};

function toggleModule(modules, moduleKey) {
  return modules.includes(moduleKey) ? modules.filter((m) => m !== moduleKey) : [...modules, moduleKey];
}

// Gestion des roles du tenant (reserve ADMIN cote backend - voir
// requireRole("ADMIN") dans routes/roles.js). Les roles sont librement
// definis par chaque entreprise cliente : pas de liste figee, chaque
// tenant cree les siens (commercial, juridique, logistique...). Depuis le
// systeme de permissions par role (04-05/09/2026), chaque role porte aussi
// un perimetre (modules visibles + tableau de bord), un statut lecture seule
// et un statut validateur universel - voir migrations/017_permissions_roles.sql
// et middleware/auth.js pour comment ces champs sont ensuite appliques.
export default function RolesPage() {
  const { t } = useLangue();
  const [roles, setRoles] = useState([]);
  const [erreur, setErreur] = useState("");
  const [form, setForm] = useState(FORM_VIDE);
  const [enEdition, setEnEdition] = useState(null); // id du role en cours d'edition
  const [editionForm, setEditionForm] = useState(FORM_VIDE);

  useEffect(() => {
    charger();
  }, []);

  function charger() {
    api.getRoles().then(setRoles).catch((err) => setErreur(err.message));
  }

  async function handleCreer(e) {
    e.preventDefault();
    setErreur("");
    if (!form.code.trim() || !form.libelle.trim()) {
      setErreur(t("roleFormError"));
      return;
    }
    try {
      const nouveau = await api.createRole({
        code: form.code,
        libelle: form.libelle,
        perimetre_json: { modules: form.modules, tableauDeBord: form.tableauDeBord },
        lecture_seule: form.lectureSeule,
        validateur_universel: form.validateurUniversel,
      });
      setRoles((prev) => [...prev, nouveau].sort((a, b) => a.libelle.localeCompare(b.libelle)));
      setForm(FORM_VIDE);
    } catch (err) {
      setErreur(err.message);
    }
  }

  function commencerEdition(role) {
    setEnEdition(role.id);
    const perimetre = role.perimetre_json || {};
    setEditionForm({
      code: role.code,
      libelle: role.libelle,
      modules: perimetre.modules || [],
      tableauDeBord: !!perimetre.tableauDeBord,
      lectureSeule: !!role.lecture_seule,
      validateurUniversel: !!role.validateur_universel,
    });
  }

  async function handleEnregistrerEdition(roleId) {
    setErreur("");
    try {
      const maj = await api.patchRole(roleId, {
        libelle: editionForm.libelle,
        perimetre_json: { modules: editionForm.modules, tableauDeBord: editionForm.tableauDeBord },
        lecture_seule: editionForm.lectureSeule,
        validateur_universel: editionForm.validateurUniversel,
      });
      setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, ...maj } : r)));
      setEnEdition(null);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSupprimer(roleId) {
    if (typeof window !== "undefined" && !window.confirm(t("roleDeleteConfirm"))) return;
    setErreur("");
    try {
      await api.supprimerRole(roleId);
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <AppShell title={t("rolesPageTitle")}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <form onSubmit={handleCreer} className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
        <label style={labelStyle}>{t("roleCodeLabel")}</label>
        <input
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          placeholder="EX: JURIDIQUE"
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("roleLabelLabel")}</label>
        <input
          value={form.libelle}
          onChange={(e) => setForm((f) => ({ ...f, libelle: e.target.value }))}
          style={inputStyle}
        />

        <PerimetreEditor form={form} setForm={setForm} t={t} />

        <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12 }}>
          {t("newRole")}
        </button>
      </form>

      {roles.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noRoles")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {roles.map((role) => (
            <div key={role.id} className="card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--sub)" }}>
                    {role.code}
                  </div>
                  {enEdition === role.id ? (
                    <input
                      autoFocus
                      value={editionForm.libelle}
                      onChange={(e) => setEditionForm((f) => ({ ...f, libelle: e.target.value }))}
                      style={{ ...inputStyle, marginTop: 4, maxWidth: 260 }}
                    />
                  ) : (
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{role.libelle}</div>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--sub)", whiteSpace: "nowrap" }}>
                  {role.nombre_utilisateurs} {t("usersCountLabel")}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {enEdition === role.id ? (
                    <button onClick={() => handleEnregistrerEdition(role.id)} style={boutonSecondaireStyle}>
                      {t("save")}
                    </button>
                  ) : (
                    <button onClick={() => commencerEdition(role)} style={boutonSecondaireStyle}>
                      {t("editRole")}
                    </button>
                  )}
                  <button onClick={() => handleSupprimer(role.id)} style={boutonDangerStyle}>
                    {t("deleteRole")}
                  </button>
                </div>
              </div>

              {/* ADMIN a toujours acces a tout au niveau du middleware (voir
                  requireModule/requireAuth cote backend, qui court-circuitent
                  des qu'un role ADMIN est present) - le perimetre_json de ce
                  role precis n'est donc jamais consulte : on l'indique
                  plutot que d'exposer des cases a cocher sans aucun effet. */}
              {role.code === "ADMIN" ? (
                <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 10, marginBottom: 0 }}>
                  {t("roleAdminAccesTotal")}
                </p>
              ) : enEdition === role.id ? (
                <PerimetreEditor form={editionForm} setForm={setEditionForm} t={t} />
              ) : (
                <PerimetreResume role={role} t={t} />
              )}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

// Cases a cocher partagees entre le formulaire de creation et le mode
// edition inline - le composant ne connait pas la difference entre les deux,
// il recoit juste form/setForm (React setState classique, meme forme dans
// les deux cas).
function PerimetreEditor({ form, setForm, t }) {
  return (
    <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", marginTop: 12 }}>
      <legend style={{ fontSize: 11.5, fontWeight: 600, padding: "0 4px" }}>{t("rolePerimetreLegend")}</legend>

      <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 6 }}>{t("roleModulesLabel")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6, marginBottom: 10 }}>
        {MODULES_DISPONIBLES.map((m) => (
          <label key={m.key} style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={form.modules.includes(m.key)}
              onChange={() => setForm((f) => ({ ...f, modules: toggleModule(f.modules, m.key) }))}
            />
            {t(m.labelKey)}
          </label>
        ))}
      </div>

      <label style={checkboxLabelStyle}>
        <input
          type="checkbox"
          checked={form.tableauDeBord}
          onChange={(e) => setForm((f) => ({ ...f, tableauDeBord: e.target.checked }))}
        />
        {t("roleTableauDeBordLabel")}
      </label>
      <label style={checkboxLabelStyle}>
        <input
          type="checkbox"
          checked={form.lectureSeule}
          onChange={(e) => setForm((f) => ({ ...f, lectureSeule: e.target.checked }))}
        />
        {t("roleLectureSeuleLabel")}
      </label>
      <label style={checkboxLabelStyle}>
        <input
          type="checkbox"
          checked={form.validateurUniversel}
          onChange={(e) => setForm((f) => ({ ...f, validateurUniversel: e.target.checked }))}
        />
        {t("roleValidateurUniverselLabel")}
      </label>
    </fieldset>
  );
}

// Resume en lecture seule du perimetre d'un role (hors mode edition) - une
// simple liste de badges plutot que de re-rendre les cases a cocher
// desactivees, pour une lecture plus rapide en un coup d'oeil.
function PerimetreResume({ role, t }) {
  const perimetre = role.perimetre_json || {};
  const modules = perimetre.modules || [];
  const badges = [
    ...modules.map((m) => MODULES_DISPONIBLES.find((d) => d.key === m)?.labelKey).filter(Boolean).map((k) => t(k)),
    perimetre.tableauDeBord ? t("roleTableauDeBordLabel") : null,
    role.lecture_seule ? t("roleLectureSeuleLabel") : null,
    role.validateur_universel ? t("roleValidateurUniverselLabel") : null,
  ].filter(Boolean);

  if (badges.length === 0) {
    return <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 10, marginBottom: 0 }}>—</p>;
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
      {badges.map((b) => (
        <span key={b} className="chip" style={{ fontSize: 10.5 }}>
          {b}
        </span>
      ))}
    </div>
  );
}

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
};
const checkboxLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  marginBottom: 6,
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
const boutonSecondaireStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const boutonDangerStyle = {
  background: "transparent",
  color: "var(--brique)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
