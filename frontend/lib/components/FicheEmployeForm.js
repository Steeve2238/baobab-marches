"use client";

// Description des sections du dossier employe. Les libelles viennent du dictionnaire (rhd_<champ>).
const OPT = (prefix, values) => values.map((v) => ({ value: v, key: `${prefix}${v}` }));
const SEXE = OPT("rhdOpt_", ["M", "F"]);
const CIVILITE = OPT("rhdOptCiv_", ["M", "MME", "MLLE"]);
const PIECE = OPT("rhdOpt_", ["CNI", "PASSEPORT", "CARTE_SEJOUR", "AUTRE"]);
const NAT = OPT("rhdOptNat_", ["S", "A", "F", "L", "E"]);
const SITUATION = OPT("rhdOpt_", ["CELIBATAIRE", "MARIE", "DIVORCE", "VEUF"]);
const CLASSIF = OPT("rhdOpt_", ["OUVRIER", "EMPLOYE", "AGENT_MAITRISE", "CADRE"]);
const PAIEMENT = OPT("rhdOpt_", ["VIREMENT", "ESPECES", "CHEQUE", "MOBILE_MONEY"]);
const CONTRATS = OPT("rhdOptCtr_", ["CDI", "CDD", "ESSAI", "JOURNALIER", "STAGE", "CONSULTANT"]);
const STATUT = OPT("rhdOpt_", ["ACTIF", "INACTIF"]);

const SECTIONS = [
  {
    titre: "rhdSecIdentite",
    champs: [
      ["matricule", "text", { placeholder: "rhdMatriculeAuto" }],
      ["civilite", "select", { options: CIVILITE }],
      ["nom", "text", { requis: true }],
      ["prenom", "text", { requis: true }],
      ["nom_naissance", "text"],
      ["sexe", "select", { options: SEXE, requis: true }],
      ["date_naissance", "date", { requis: true }],
      ["lieu_naissance", "text"],
      ["pays_naissance", "text"],
      ["nationalite", "text"],
      ["nationalite_categorie", "select", { options: NAT }],
      ["pere_nom", "text"],
      ["mere_nom", "text"],
      ["groupe_ethnique", "text"],
    ],
  },
  {
    titre: "rhdSecPiece",
    champs: [
      ["piece_type", "select", { options: PIECE }],
      ["piece_numero", "text"],
      ["piece_lieu", "text"],
      ["piece_date", "date"],
      ["numero_css", "text"],
      ["numero_ipres", "text"],
    ],
  },
  {
    titre: "rhdSecContact",
    champs: [
      ["adresse", "text", { large: true }],
      ["ville", "text"],
      ["telephone", "text"],
      ["email_personnel", "text"],
      ["contact_urgence_nom", "text"],
      ["contact_urgence_telephone", "text"],
      ["resident_senegal", "bool"],
      ["date_entree_senegal", "date"],
      ["statut_militaire", "text"],
      ["precedent_employeur", "text"],
    ],
  },
  {
    titre: "rhdSecFamille",
    champs: [
      ["situation_familiale", "select", { options: SITUATION }],
      ["conjoint_nom", "text"],
      ["conjoint_prenom", "text"],
      ["conjoint_date_naissance", "date"],
      ["conjoint_profession", "text"],
      ["conjoint_a_revenus", "bool"],
      ["nombre_epouses", "number", { min: 0, step: 1 }],
      ["titulaire_invalidite_40", "bool"],
      ["enfant_decede", "bool"],
    ],
  },
  { titre: "rhdSecEnfants", enfants: true },
  {
    titre: "rhdSecEmploi",
    champs: [
      ["poste", "text"],
      ["qualification", "text"],
      ["service", "text"],
      ["lieu_travail", "text"],
      ["convention_collective", "text"],
      ["categorie", "text"],
      ["echelon", "text"],
      ["classification", "select", { options: CLASSIF }],
      ["type_contrat", "contrat"],
      ["date_embauche", "date", { requis: true }],
      ["date_fin_contrat", "date"],
      ["periode_essai_mois", "number", { min: 0, step: 1 }],
      ["heures_hebdo", "number", { min: 0, step: 0.5 }],
      ["numero_declaration_embauche", "text"],
      ["date_declaration_embauche", "date"],
      ["solde_conges", "number", { min: 0, step: 0.5 }],
      ["statut", "select", { options: STATUT, sansVide: true }],
    ],
  },
  {
    titre: "rhdSecPaiement",
    champs: [
      ["mode_paiement", "select", { options: PAIEMENT }],
      ["banque", "text"],
      ["numero_compte", "text"],
      ["mobile_money_numero", "text"],
    ],
  },
  {
    titre: "rhdSecSortie",
    champs: [
      ["date_sortie", "date"],
      ["motif_sortie", "text", { large: true }],
    ],
  },
  {
    titre: "rhdSecParts",
    champs: [
      ["parts_ir_manuel", "number", { min: 1, max: 5, step: 0.5 }],
      ["parts_trimf_manuel", "number", { min: 0, step: 1 }],
    ],
    aide: "rhdPartsAide",
  },
];

// Valeurs initiales du formulaire a partir d'une fiche (ou vide).
export function formInitial(fiche) {
  const f = fiche || {};
  const v = {};
  for (const s of SECTIONS) {
    for (const [name, type] of s.champs || []) {
      let x = f[name];
      if (type === "date") x = x ? String(x).slice(0, 10) : "";
      else if (type === "bool") x = x === true || (x == null && name === "resident_senegal");
      else if (type === "number") x = x != null ? String(x) : name === "heures_hebdo" ? "40" : name === "nombre_epouses" ? "0" : "";
      else if (name === "statut") x = x || "ACTIF";
      else x = x != null ? x : "";
      v[name] = x;
    }
  }
  if (!fiche) {
    v.nationalite = "Sénégalaise";
    v.nationalite_categorie = "S";
    v.pays_naissance = "Sénégal";
  }
  v.enfants = (f.enfants || []).map((e) => ({
    prenom: e.prenom || "",
    nom: e.nom || "",
    sexe: e.sexe || "",
    date_naissance: e.date_naissance ? String(e.date_naissance).slice(0, 10) : "",
    etudiant: !!e.etudiant,
    infirme: !!e.infirme,
    revenus_propres: !!e.revenus_propres,
    adopte: !!e.adopte,
  }));
  return v;
}

// Prepare le corps de requete : chaines vides conservees (le serveur les transforme en null).
export function formVersCorps(form, { salarieSeul } = {}) {
  const corps = {};
  const champsSalarie = ["telephone", "adresse", "ville", "email_personnel", "contact_urgence_nom", "contact_urgence_telephone"];
  for (const s of SECTIONS) {
    for (const [name, type] of s.champs || []) {
      if (salarieSeul && !champsSalarie.includes(name)) continue;
      corps[name] = type === "number" && form[name] === "" ? null : form[name];
    }
  }
  if (!salarieSeul) corps.enfants = form.enfants;
  return corps;
}

// Meme regle que le serveur (CGI art. 177-178) : age apprecie au 1er janvier.
function enfantACharge(e, annee) {
  if (e.revenus_propres) return false;
  if (e.infirme) return true;
  const n = new Date(e.date_naissance);
  if (Number.isNaN(n.getTime())) return false;
  let age = annee - n.getUTCFullYear();
  if (n.getUTCMonth() > 0 || n.getUTCDate() > 1) age -= 1;
  if (age < 18) return true;
  return !!e.etudiant && age < 25;
}

export default function FicheEmployeForm({ form, setForm, t, lectureSeule, salarieSeul }) {
  const maj = (name, valeur) => setForm((f) => ({ ...f, [name]: valeur }));
  const editable = (name) => {
    if (lectureSeule) return false;
    if (!salarieSeul) return true;
    return ["telephone", "adresse", "ville", "email_personnel", "contact_urgence_nom", "contact_urgence_telephone"].includes(name);
  };

  function champ([name, type, opts = {}]) {
    const label = t(`rhd_${name}`);
    const dis = !editable(name);
    const base = { disabled: dis, style: inputStyle };
    let input;
    if (type === "select") {
      input = (
        <select value={form[name]} onChange={(e) => maj(name, e.target.value)} {...base}>
          {!opts.sansVide && <option value="">{t("rhdChoisir")}</option>}
          {opts.options.map((o) => (
            <option key={o.value} value={o.value}>{t(o.key)}</option>
          ))}
        </select>
      );
    } else if (type === "contrat") {
      // Liste de valeurs usuelles, mais les valeurs deja saisies librement restent affichees.
      const connu = CONTRATS.some((o) => o.value === form[name]);
      input = (
        <select value={form[name]} onChange={(e) => maj(name, e.target.value)} {...base}>
          <option value="">{t("rhdChoisir")}</option>
          {!connu && form[name] ? <option value={form[name]}>{form[name]}</option> : null}
          {CONTRATS.map((o) => (
            <option key={o.value} value={o.value}>{t(o.key)}</option>
          ))}
        </select>
      );
    } else if (type === "bool") {
      input = (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "8px 0" }}>
          <input type="checkbox" checked={!!form[name]} disabled={dis} onChange={(e) => maj(name, e.target.checked)} />
          <span>{t("rhdOui")}</span>
        </label>
      );
    } else if (type === "number") {
      input = (
        <input type="number" min={opts.min} max={opts.max} step={opts.step} value={form[name]}
          onChange={(e) => maj(name, e.target.value)} {...base} />
      );
    } else {
      input = (
        <input type={type === "date" ? "date" : "text"} value={form[name]} required={!!opts.requis && !lectureSeule}
          placeholder={opts.placeholder ? t(opts.placeholder) : undefined}
          onChange={(e) => maj(name, e.target.value)} {...base} />
      );
    }
    return (
      <div key={name} style={opts.large ? { gridColumn: "1 / -1" } : undefined}>
        <label style={labelStyle}>
          {label}{opts.requis ? <span style={{ color: "var(--brique)" }}> *</span> : null}
        </label>
        {input}
      </div>
    );
  }

  function enfantsEditeur() {
    const liste = form.enfants || [];
    const majEnfant = (i, k, v) =>
      setForm((f) => ({ ...f, enfants: f.enfants.map((e, j) => (j === i ? { ...e, [k]: v } : e)) }));
    return (
      <div>
        <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "0 0 10px" }}>{t("rhdEnfantsAide")}</p>
        {liste.length === 0 && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("rhdEnfantAucun")}</p>}
        <div style={{ display: "grid", gap: 10 }}>
          {liste.map((e, i) => (
            <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                <div>
                  <label style={labelStyle}>{t("rhd_nom")}</label>
                  <input value={e.nom} disabled={lectureSeule || salarieSeul} onChange={(ev) => majEnfant(i, "nom", ev.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>{t("rhd_prenom")} *</label>
                  <input value={e.prenom} disabled={lectureSeule || salarieSeul} onChange={(ev) => majEnfant(i, "prenom", ev.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>{t("rhd_sexe")}</label>
                  <select value={e.sexe} disabled={lectureSeule || salarieSeul} onChange={(ev) => majEnfant(i, "sexe", ev.target.value)} style={inputStyle}>
                    <option value="">{t("rhdChoisir")}</option>
                    {SEXE.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>{t("rhd_date_naissance")}</label>
                  <input type="date" value={e.date_naissance} disabled={lectureSeule || salarieSeul} onChange={(ev) => majEnfant(i, "date_naissance", ev.target.value)} style={inputStyle} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginTop: 8, fontSize: 12.5 }}>
                {[["etudiant", "rhdEnfantEtudiant"], ["infirme", "rhdEnfantInfirme"], ["revenus_propres", "rhdEnfantRevenus"], ["adopte", "rhdEnfantAdopte"]].map(([k, lk]) => (
                  <label key={k} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={!!e[k]} disabled={lectureSeule || salarieSeul} onChange={(ev) => majEnfant(i, k, ev.target.checked)} />
                    {t(lk)}
                  </label>
                ))}
                {e.date_naissance && (
                  <span className={enfantACharge(e, new Date().getFullYear()) ? "chip ok" : "chip risk"}>
                    {enfantACharge(e, new Date().getFullYear()) ? t("rhdEnfantACharge") : t("rhdEnfantNonACharge")}
                  </span>
                )}
                {!lectureSeule && !salarieSeul && (
                  <button type="button" onClick={() => setForm((f) => ({ ...f, enfants: f.enfants.filter((_, j) => j !== i) }))}
                    style={{ ...boutonLeger, marginLeft: "auto", color: "var(--brique)" }}>
                    {t("rhdEnfantSupprimer")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {!lectureSeule && !salarieSeul && (
          <button type="button" style={{ ...boutonLeger, marginTop: 10 }}
            onClick={() => setForm((f) => ({ ...f, enfants: [...(f.enfants || []), { prenom: "", nom: f.nom || "", sexe: "", date_naissance: "", etudiant: false, infirme: false, revenus_propres: false, adopte: false }] }))}>
            + {t("rhdEnfantAjouter")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {SECTIONS.map((s) => (
        <section key={s.titre} className="card">
          <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>{t(s.titre)}</h2>
          {s.aide && <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "-4px 0 10px" }}>{t(s.aide)}</p>}
          {s.enfants ? (
            enfantsEditeur()
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
              {s.champs.map(champ)}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
export const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
};
const boutonLeger = {
  background: "transparent",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "5px 12px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
};
