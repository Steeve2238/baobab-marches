/**
 * Fiche de renseignements du salarie : modeles Excel (en masse et individuel), export des salaries existants,
 * lecture / analyse / application d'un fichier rempli, et fiche imprimable PDF.
 *
 * Principe (decision du 08/10/2026) : le module RH de base sert a collecter les renseignements du personnel ; le salarie
 * remplit sa fiche (Excel ou papier), le RH la reimporte. Les contrats, DMT et ordres de virement relevent du module Paie.
 */
const XLSX = require("xlsx");
const { CHAMPS, normaliser } = require("./rhFiche");
const { helpers: H } = require("./offresContratsPdf");
const { helpersRh: R } = require("./rhDocumentsPdf");

const { PETROLE, GRIS, LIGNE, nouveauDocument, largeurUtile, asseoir } = H;

// ------------------------------------------------------------------------------------------------ libelles
// [cle, libelle FR, libelle EN]
const SECTIONS = [
  {
    id: "IDENTITE", fr: "Identité", en: "Identity",
    champs: [
      ["matricule", "Matricule (laisser vide pour un nouveau salarié)", "Employee no. (leave empty for a new employee)"],
      ["civilite", "Civilité", "Title"], ["nom", "Nom", "Last name"], ["prenom", "Prénom(s)", "First name(s)"],
      ["nom_naissance", "Nom de naissance", "Birth name"], ["sexe", "Sexe", "Sex"],
      ["date_naissance", "Date de naissance", "Date of birth"], ["lieu_naissance", "Lieu de naissance", "Place of birth"],
      ["pays_naissance", "Pays de naissance", "Country of birth"], ["nationalite", "Nationalité", "Nationality"],
      ["pere_nom", "Nom du père", "Father's name"], ["mere_nom", "Nom de la mère", "Mother's name"],
      ["groupe_ethnique", "Groupe ethnique", "Ethnic group"],
    ],
  },
  {
    id: "PIECE", fr: "Pièce d'identité et numéros sociaux", en: "ID document and social security numbers",
    champs: [
      ["piece_type", "Type de pièce", "Document type"], ["piece_numero", "N° de la pièce", "Document no."],
      ["piece_lieu", "Lieu de délivrance", "Place of issue"], ["piece_date", "Date de délivrance", "Date of issue"],
      ["numero_css", "N° Sécurité sociale (CSS)", "Social security no. (CSS)"], ["numero_ipres", "N° IPRES", "IPRES no."],
    ],
  },
  {
    id: "COORD", fr: "Coordonnées", en: "Contact details",
    champs: [
      ["adresse", "Adresse", "Address"], ["ville", "Ville", "City"],
      ["email_personnel", "E-mail personnel", "Personal e-mail"], ["telephone", "Téléphone", "Phone"],
      ["contact_urgence_nom", "Personne à prévenir (nom)", "Emergency contact (name)"],
      ["contact_urgence_telephone", "Personne à prévenir (téléphone)", "Emergency contact (phone)"],
    ],
  },
  {
    id: "FAMILLE", fr: "Situation personnelle et familiale", en: "Personal and family situation",
    champs: [
      ["resident_senegal", "Résident au Sénégal (oui/non)", "Resident in Senegal (yes/no)"],
      ["date_entree_senegal", "Date d'entrée au Sénégal (si non résident)", "Date of entry in Senegal (if non-resident)"],
      ["statut_militaire", "Situation militaire", "Military status"],
      ["precedent_employeur", "Dernier employeur", "Previous employer"],
      ["situation_familiale", "Situation familiale", "Marital status"],
      ["conjoint_nom", "Conjoint(e) : nom", "Spouse: last name"], ["conjoint_prenom", "Conjoint(e) : prénom", "Spouse: first name"],
      ["conjoint_date_naissance", "Conjoint(e) : date de naissance", "Spouse: date of birth"],
      ["conjoint_profession", "Conjoint(e) : profession", "Spouse: occupation"],
      ["conjoint_a_revenus", "Conjoint(e) a des revenus (oui/non)", "Spouse has income (yes/no)"],
      ["nombre_epouses", "Nombre d'épouses", "Number of wives"],
      ["titulaire_invalidite_40", "Invalidité d'au moins 40 % (oui/non)", "Disability of at least 40% (yes/no)"],
      ["enfant_decede", "Enfant décédé (oui/non)", "Deceased child (yes/no)"],
    ],
  },
  {
    id: "PAIEMENT", fr: "Paiement du salaire", en: "Salary payment",
    champs: [
      ["mode_paiement", "Mode de paiement", "Payment method"], ["banque", "Banque", "Bank"],
      ["numero_compte", "N° de compte (RIB / IBAN)", "Account no. (RIB / IBAN)"],
      ["mobile_money_numero", "N° Mobile money", "Mobile money no."],
    ],
  },
  {
    id: "ENTREPRISE", fr: "Réservé à l'entreprise", en: "For the company's use",
    champs: [
      ["poste", "Poste", "Job title"], ["qualification", "Qualification", "Qualification"], ["service", "Service", "Department"],
      ["lieu_travail", "Lieu de travail", "Workplace"], ["convention_collective", "Convention collective", "Collective agreement"],
      ["categorie", "Catégorie", "Category"], ["echelon", "Échelon", "Step"], ["classification", "Classification", "Classification"],
      ["type_contrat", "Type de contrat (CDI, CDD, JOURNALIER...)", "Contract type (CDI, CDD, DAILY...)"],
      ["date_embauche", "Date d'embauche", "Hire date"], ["date_fin_contrat", "Date de fin de contrat", "Contract end date"],
      ["periode_essai_mois", "Période d'essai (mois)", "Probation (months)"], ["heures_hebdo", "Heures par semaine", "Hours per week"],
      ["numero_declaration_embauche", "N° de déclaration d'embauche", "Hiring declaration no."],
      ["date_declaration_embauche", "Date de déclaration d'embauche", "Hiring declaration date"],
      ["date_sortie", "Date de sortie", "Exit date"], ["motif_sortie", "Motif de sortie", "Exit reason"],
      ["solde_conges", "Solde de congés (jours)", "Leave balance (days)"], ["statut", "Statut", "Status"],
      ["nationalite_categorie", "Catégorie de nationalité (S, A, F, L, E)", "Nationality category (S, A, F, L, E)"],
      ["parts_ir_manuel", "Parts IR (forcées)", "Income tax shares (override)"],
      ["parts_trimf_manuel", "Parts TRIMF (forcées)", "TRIMF shares (override)"],
    ],
  },
];

const LABELS = {};
for (const s of SECTIONS) for (const [k, fr, en] of s.champs) LABELS[k] = { fr, en };
const DEFS = Object.fromEntries(CHAMPS.map((c) => [c.name, c]));
const TOUS = SECTIONS.flatMap((s) => s.champs.map(([k]) => k)).filter((k) => DEFS[k]);

// Valeurs d'enumeration : code -> [FR, EN, synonymes...]
const ENUMS = {
  civilite: { M: ["Monsieur", "Mr", "M.", "Mr."], MME: ["Madame", "Mrs", "Mme"], MLLE: ["Mademoiselle", "Miss", "Mlle"] },
  sexe: { M: ["Masculin", "Male", "Homme", "H"], F: ["Féminin", "Female", "Femme"] },
  piece_type: { CNI: ["CNI", "ID card", "Carte nationale d'identité"], PASSEPORT: ["Passeport", "Passport"], CARTE_SEJOUR: ["Carte de séjour", "Residence permit"], AUTRE: ["Autre", "Other"] },
  situation_familiale: { CELIBATAIRE: ["Célibataire", "Single"], MARIE: ["Marié(e)", "Married", "Marié", "Mariée"], DIVORCE: ["Divorcé(e)", "Divorced", "Divorcé", "Divorcée"], VEUF: ["Veuf(ve)", "Widowed", "Veuf", "Veuve"] },
  classification: { OUVRIER: ["Ouvrier", "Worker"], EMPLOYE: ["Employé", "Employee"], AGENT_MAITRISE: ["Agent de maîtrise", "Supervisor"], CADRE: ["Cadre", "Executive"] },
  mode_paiement: { VIREMENT: ["Virement", "Transfer", "Bank transfer"], ESPECES: ["Espèces", "Cash"], CHEQUE: ["Chèque", "Cheque", "Check"], MOBILE_MONEY: ["Mobile money", "Wave", "Orange Money"] },
  statut: { ACTIF: ["Actif", "Active"], INACTIF: ["Inactif", "Inactive"] },
  nationalite_categorie: { S: ["S"], A: ["A"], F: ["F"], L: ["L"], E: ["E"] },
};

const sansAccent = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const lab = (cle, lang) => (LABELS[cle] ? LABELS[cle][lang === "en" ? "en" : "fr"] : cle);
const libEnum = (cle, code, lang) => {
  const e = ENUMS[cle] && ENUMS[cle][code];
  if (!e) return code;
  return lang === "en" ? e[1] || e[0] : e[0];
};

const ENFANT_COLS = [
  ["cle", "Salarié (matricule ou NOM Prénom)", "Employee (no. or LAST First name)"],
  ["nom", "Nom de l'enfant", "Child's last name"], ["prenom", "Prénom de l'enfant", "Child's first name"],
  ["sexe", "Sexe", "Sex"], ["date_naissance", "Date de naissance", "Date of birth"],
  ["etudiant", "Étudiant (oui/non)", "Student (yes/no)"], ["infirme", "Infirme (oui/non)", "Disabled (yes/no)"],
  ["revenus_propres", "A des revenus propres (oui/non)", "Has own income (yes/no)"], ["adopte", "Adopté (oui/non)", "Adopted (yes/no)"],
];
const ENFANT_TYPES = { sexe: "enum", date_naissance: "date", etudiant: "bool", infirme: "bool", revenus_propres: "bool", adopte: "bool" };

// ------------------------------------------------------------------------------------------------ conversions
const MS_JOUR = 86400000;
function serialVersISO(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * MS_JOUR);
  return d.toISOString().slice(0, 10);
}
function isoVersSerial(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / MS_JOUR);
}
function dateLocaleISO(v) {
  if (!v) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
}
const vide = (v) => v == null || (typeof v === "string" && v.trim() === "");

/** Convertit une cellule brute en valeur canonique pour `normaliser`. Retourne { v } ou { erreur: true }. */
function convertir(type, cle, brut) {
  if (vide(brut)) return { vide: true };
  if (type === "date") {
    if (brut instanceof Date) return { v: dateLocaleISO(brut) };
    if (typeof brut === "number") return brut > 1 && brut < 80000 ? { v: serialVersISO(brut) } : { erreur: true };
    const s = String(brut).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? { v: iso } : { erreur: true };
    }
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/);
    if (m) {
      const an = m[3].length === 2 ? (Number(m[3]) > 30 ? 1900 + Number(m[3]) : 2000 + Number(m[3])) : Number(m[3]);
      const iso = `${an}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      return Number.isNaN(Date.parse(iso)) || new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso ? { erreur: true } : { v: iso };
    }
    return { erreur: true };
  }
  if (type === "bool") {
    if (typeof brut === "boolean") return { v: brut };
    if (typeof brut === "number") return { v: brut !== 0 };
    const s = sansAccent(brut);
    if (["oui", "o", "yes", "y", "vrai", "true", "x", "1"].includes(s)) return { v: true };
    if (["non", "n", "no", "faux", "false", "0"].includes(s)) return { v: false };
    return { erreur: true };
  }
  if (type === "int" || type === "num") {
    if (typeof brut === "number") return { v: brut };
    const n = Number(String(brut).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? { v: n } : { erreur: true };
  }
  if (type === "enum") {
    const s = sansAccent(brut);
    const table = (cle === "sexe" || ENFANT_TYPES[cle] === "enum" ? ENUMS.sexe : ENUMS[cle]) || {};
    for (const [code, noms] of Object.entries(table)) {
      if (sansAccent(code) === s || noms.some((n) => sansAccent(n) === s)) return { v: code };
    }
    return { erreur: true };
  }
  // texte
  if (typeof brut === "number") return { v: Number.isInteger(brut) ? String(brut) : String(brut) };
  if (brut instanceof Date) return { v: dateLocaleISO(brut) };
  return { v: String(brut).trim() };
}

// ------------------------------------------------------------------------------------------------ ecriture Excel
function cellule(def, valeur) {
  if (valeur == null || valeur === "") return { t: "s", v: "" };
  if (def && def.type === "date") {
    const iso = valeur instanceof Date ? dateLocaleISO(valeur) : String(valeur).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { t: "s", v: String(valeur) };
    return { t: "n", v: isoVersSerial(iso), z: "dd/mm/yyyy" };
  }
  if (def && def.type === "bool") return { t: "s", v: valeur === true || valeur === "true" ? "oui" : "non" };
  if (def && def.type === "enum") return { t: "s", v: String(valeur) };
  if (def && (def.type === "int" || def.type === "num")) return { t: "n", v: Number(valeur) };
  return { t: "s", v: String(valeur) };
}

function feuille(lignes, largeurs) {
  const ws = XLSX.utils.aoa_to_sheet(lignes.map((l) => l.map((c) => (c && typeof c === "object" && "t" in c ? c.v : c))));
  // re-applique les types (dates, nombres) apres aoa_to_sheet
  lignes.forEach((l, r) => l.forEach((c, k) => {
    if (c && typeof c === "object" && "t" in c) ws[XLSX.utils.encode_cell({ r, c: k })] = c.v === "" ? { t: "s", v: "" } : c;
  }));
  if (largeurs) ws["!cols"] = largeurs.map((w) => ({ wch: w }));
  return ws;
}

function feuilleListes(lang) {
  const lignes = [[lang === "en" ? "Field" : "Rubrique", lang === "en" ? "Accepted values" : "Valeurs acceptées"]];
  for (const [cle, valeurs] of Object.entries(ENUMS)) {
    if (cle === "nationalite_categorie") continue;
    lignes.push([lab(cle, lang), Object.keys(valeurs).map((c) => libEnum(cle, c, lang)).join(" | ")]);
  }
  lignes.push([lang === "en" ? "Yes/No fields" : "Champs oui/non", lang === "en" ? "yes | no" : "oui | non"]);
  lignes.push([lang === "en" ? "Dates" : "Dates", "jj/mm/aaaa (31/12/1990)"]);
  return feuille(lignes.map((l) => l.map((x) => ({ t: "s", v: x }))), [34, 70]);
}

function feuilleInstructions(lang, individuel) {
  const fr = lang !== "en";
  const L = fr
    ? [
        individuel ? "FICHE DE RENSEIGNEMENTS DU SALARIÉ" : "MODÈLE D'IMPORT DES SALARIÉS",
        "",
        individuel
          ? "1. Remplissez la colonne « Valeur » de l'onglet « Fiche » (les cases grises sont facultatives)."
          : "1. Une ligne par salarié dans l'onglet « Salariés » ; une ligne par enfant dans l'onglet « Enfants ».",
        "2. Ne modifiez pas les titres des colonnes. Les listes de valeurs acceptées sont dans l'onglet « Listes ».",
        "3. Dates au format jj/mm/aaaa. Champs oui/non : écrire oui ou non.",
        "4. Obligatoires pour créer un salarié : Nom, Prénom(s), Sexe, Date de naissance.",
        "5. Un salarié déjà connu (même matricule, ou même n° de pièce, ou mêmes nom/prénom/date de naissance) est mis à jour : seules les cases remplies sont modifiées, une case vide ne supprime rien.",
        "6. Renvoyez le fichier au service RH : il l'importe dans Baobab après un aperçu des changements.",
        "",
        "La partie « Réservé à l'entreprise » est complétée par l'employeur (poste, convention, catégorie, contrat...).",
      ]
    : [
        individuel ? "EMPLOYEE INFORMATION SHEET" : "EMPLOYEE IMPORT TEMPLATE",
        "",
        individuel
          ? "1. Fill in the \"Value\" column of the \"Fiche\" sheet (grey cells are optional)."
          : "1. One row per employee in the \"Salariés\" sheet; one row per child in the \"Enfants\" sheet.",
        "2. Do not change the column titles. Accepted values are listed in the \"Listes\" sheet.",
        "3. Dates as dd/mm/yyyy. Yes/No fields: write yes or no.",
        "4. Required to create an employee: Last name, First name, Sex, Date of birth.",
        "5. An existing employee (same employee no., or same ID number, or same name and date of birth) is updated: only filled cells change, an empty cell deletes nothing.",
        "6. Send the file back to HR: it is imported into Baobab after a preview of the changes.",
        "",
        "The \"For the company's use\" part is completed by the employer (job, agreement, category, contract...).",
      ];
  return feuille(L.map((x) => [{ t: "s", v: x }]), [120]);
}

function feuilleEnfants(lang, enfants) {
  const entete = ENFANT_COLS.map(([, fr, en]) => ({ t: "s", v: lang === "en" ? en : fr }));
  const lignes = [entete];
  for (const e of enfants || []) {
    lignes.push(ENFANT_COLS.map(([k]) => {
      if (k === "cle") return { t: "s", v: e.cle || "" };
      const type = ENFANT_TYPES[k];
      return cellule(type ? { type } : null, e[k]);
    }));
  }
  if (!enfants || !enfants.length) lignes.push(ENFANT_COLS.map(() => ({ t: "s", v: "" })));
  return feuille(lignes, [30, 22, 22, 10, 14, 14, 14, 22, 12]);
}

function versBuffer(wb) {
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/** Modele en masse (vide) ou export des salaries existants : onglets Instructions, Salariés, Enfants, Listes. */
function classeurMasse({ lang = "fr", employes = [], enfantsParEmploye = {}, modele = false }) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, feuilleInstructions(lang, false), lang === "en" ? "Instructions" : "Instructions");
  const entete = TOUS.map((k) => ({ t: "s", v: lab(k, lang) }));
  const lignes = [entete];
  for (const e of employes) lignes.push(TOUS.map((k) => cellule(DEFS[k], k === "statut" || ENUMS[k] ? (e[k] && ENUMS[k] ? libEnum(k, e[k], lang) : e[k]) : e[k])));
  if (!employes.length) lignes.push(TOUS.map(() => ({ t: "s", v: "" })));
  XLSX.utils.book_append_sheet(wb, feuille(lignes, TOUS.map((k) => Math.min(34, Math.max(14, lab(k, lang).length + 2)))), "Salariés");
  const enf = [];
  for (const e of employes) for (const c of enfantsParEmploye[e.id] || []) enf.push({ ...c, cle: e.matricule || `${e.nom} ${e.prenom}` });
  XLSX.utils.book_append_sheet(wb, feuilleEnfants(lang, enf), "Enfants");
  XLSX.utils.book_append_sheet(wb, feuilleListes(lang), "Listes");
  return versBuffer(wb);
}

/** Fiche individuelle (verticale) : Rubrique | Valeur | Aide | cle technique (masquee). */
function classeurIndividuel({ lang = "fr", employe = null, enfants = [] }) {
  const fr = lang !== "en";
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, feuilleInstructions(lang, true), "Instructions");
  const lignes = [[{ t: "s", v: fr ? "Rubrique" : "Item" }, { t: "s", v: fr ? "Valeur" : "Value" }, { t: "s", v: fr ? "Aide" : "Help" }, { t: "s", v: "cle" }]];
  for (const s of SECTIONS) {
    lignes.push([{ t: "s", v: (fr ? s.fr : s.en).toUpperCase() }, { t: "s", v: "" }, { t: "s", v: "" }, { t: "s", v: "" }]);
    for (const [k] of s.champs) {
      if (!DEFS[k]) continue;
      let aide = "";
      if (DEFS[k].type === "date") aide = "jj/mm/aaaa";
      else if (DEFS[k].type === "bool") aide = fr ? "oui / non" : "yes / no";
      else if (ENUMS[k] && k !== "nationalite_categorie") aide = Object.keys(ENUMS[k]).map((c) => libEnum(k, c, lang)).join(" | ");
      const v = employe ? employe[k] : null;
      const val = employe && ENUMS[k] && v ? libEnum(k, v, lang) : v;
      lignes.push([{ t: "s", v: lab(k, lang) }, cellule(DEFS[k], val), { t: "s", v: aide }, { t: "s", v: k }]);
    }
  }
  const ws = feuille(lignes, [58, 34, 40, 4]);
  ws["!cols"][3] = { hidden: true, wch: 4 };
  XLSX.utils.book_append_sheet(wb, ws, "Fiche");
  const cleEmp = employe ? employe.matricule || "" : "";
  XLSX.utils.book_append_sheet(wb, feuilleEnfants(lang, (enfants || []).map((c) => ({ ...c, cle: cleEmp }))), "Enfants");
  XLSX.utils.book_append_sheet(wb, feuilleListes(lang), "Listes");
  return versBuffer(wb);
}

// ------------------------------------------------------------------------------------------------ lecture
function indexLibelles() {
  const idx = new Map();
  for (const k of TOUS) {
    idx.set(sansAccent(k), k);
    for (const l of ["fr", "en"]) idx.set(sansAccent(LABELS[k][l]), k);
  }
  // titres FR/EN abreges acceptes
  const alias = { "nom": "nom", "last name": "nom", "prenom": "prenom", "prenoms": "prenom", "first name": "prenom", "matricule": "matricule", "telephone": "telephone", "email": "email_personnel", "sexe": "sexe", "adresse": "adresse" };
  for (const [a, k] of Object.entries(alias)) if (!idx.has(a)) idx.set(a, k);
  return idx;
}
function indexEnfants() {
  const idx = new Map();
  for (const [k, fr, en] of ENFANT_COLS) { idx.set(sansAccent(k), k); idx.set(sansAccent(fr), k); idx.set(sansAccent(en), k); }
  return idx;
}

function lireEnfants(wb, nomsFeuilles) {
  const nom = nomsFeuilles.find((n) => sansAccent(n) === "enfants");
  if (!nom) return [];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: "" });
  if (!rows.length) return [];
  const idx = indexEnfants();
  const cols = rows[0].map((h) => idx.get(sansAccent(h)) || null);
  const res = [];
  rows.slice(1).forEach((r, i) => {
    const o = { ligne: i + 2 };
    cols.forEach((k, j) => { if (k && !vide(r[j])) o[k] = r[j]; });
    if (o.prenom || o.nom) res.push(o);
  });
  return res;
}

/** Lit un classeur rempli : { lignes: [{ ligne, brut: {cle: valeur}, enfantsBruts: [] }], individuel } */
function lireClasseur(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const noms = wb.SheetNames;
  const enfantsFeuille = lireEnfants(wb, noms);
  const nomFiche = noms.find((n) => sansAccent(n) === "fiche");
  const nomMasse = noms.find((n) => sansAccent(n) === "salaries");
  const lignes = [];
  if (nomFiche) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nomFiche], { header: 1, raw: true, defval: "" });
    const idx = indexLibelles();
    const brut = {};
    rows.slice(1).forEach((r) => {
      const cle = !vide(r[3]) && TOUS.includes(String(r[3]).trim()) ? String(r[3]).trim() : idx.get(sansAccent(r[0]));
      if (cle && !vide(r[1])) brut[cle] = r[1];
    });
    lignes.push({ ligne: 2, brut, enfantsBruts: enfantsFeuille });
    return { lignes, individuel: true };
  }
  if (!nomMasse) return { lignes: [], individuel: false, erreur: "FEUILLE_INTROUVABLE" };
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[nomMasse], { header: 1, raw: true, defval: "" });
  if (!rows.length) return { lignes: [], individuel: false };
  const idx = indexLibelles();
  const cols = rows[0].map((h) => idx.get(sansAccent(h)) || null);
  rows.slice(1).forEach((r, i) => {
    const brut = {};
    cols.forEach((k, j) => { if (k && !vide(r[j])) brut[k] = r[j]; });
    if (Object.keys(brut).length) lignes.push({ ligne: i + 2, brut, enfantsBruts: [] });
  });
  // rattache les enfants par cle (matricule ou NOM Prenom)
  for (const e of enfantsFeuille) {
    const cle = sansAccent(e.cle);
    if (!cle) continue;
    const l = lignes.find((x) => sansAccent(x.brut.matricule) === cle || sansAccent(`${x.brut.nom} ${x.brut.prenom}`) === cle || sansAccent(`${x.brut.prenom} ${x.brut.nom}`) === cle);
    if (l) l.enfantsBruts.push(e);
  }
  return { lignes, individuel: false };
}

// ------------------------------------------------------------------------------------------------ analyse / application
const ctrl = (v) => (v == null ? null : v instanceof Date ? dateLocaleISO(v) : typeof v === "boolean" ? String(v) : String(v));

function convertirLigne(brut, lang) {
  const corps = {};
  const erreurs = [];
  for (const [cle, raw] of Object.entries(brut)) {
    const def = DEFS[cle];
    if (!def) continue;
    const r = convertir(def.type, cle, raw);
    if (r.vide) continue;
    if (r.erreur) { erreurs.push({ champ: cle, libelle: lab(cle, lang) }); continue; }
    corps[cle] = r.v;
  }
  return { corps, erreurs };
}

function convertirEnfants(bruts, lang) {
  const enfants = [];
  const erreurs = [];
  for (const b of bruts) {
    const e = {};
    for (const [k, , ] of ENFANT_COLS) {
      if (k === "cle" || b[k] === undefined) continue;
      const type = ENFANT_TYPES[k] || "text";
      const r = convertir(type, k, b[k]);
      if (r.vide) continue;
      if (r.erreur) { erreurs.push({ champ: `enfant:${k}`, libelle: `${lang === "en" ? "Child" : "Enfant"} (${b.prenom || b.nom || ""}) : ${ENFANT_COLS.find((c) => c[0] === k)[lang === "en" ? 2 : 1]}` }); continue; }
      e[k] = r.v;
    }
    if (e.prenom || e.nom) enfants.push({ ...e, prenom: e.prenom || e.nom });
  }
  return { enfants, erreurs };
}

/**
 * Analyse (sans rien ecrire) : pour chaque ligne, CREER / MAJ / INCHANGE / ERREUR et le detail des changements.
 * `db` : module db ; retourne { lignes: [...], resume }.
 */
async function analyser(db, tenantId, lues, lang) {
  const emp = await db.query(
    `SELECT e.*, COALESCE(e.nom, u.nom) AS nom_c, COALESCE(e.prenom, u.prenom) AS prenom_c
     FROM employe e LEFT JOIN utilisateur u ON u.id = e.utilisateur_id WHERE e.tenant_id = $1`,
    [tenantId]
  );
  const enf = await db.query(`SELECT employe_id, nom, prenom, sexe, date_naissance, etudiant, infirme, revenus_propres, adopte FROM employe_enfant WHERE tenant_id = $1`, [tenantId]);
  const nbEnfants = new Map();
  const sigEnfants = new Map();
  const sig = (e) => [sansAccent(e.nom), sansAccent(e.prenom), e.sexe || "", dateLocaleISO(e.date_naissance) || "", e.etudiant ? 1 : 0, e.infirme ? 1 : 0, e.revenus_propres ? 1 : 0, e.adopte ? 1 : 0].join("|");
  for (const e of enf.rows) {
    nbEnfants.set(e.employe_id, (nbEnfants.get(e.employe_id) || 0) + 1);
    sigEnfants.set(e.employe_id, [...(sigEnfants.get(e.employe_id) || []), sig(e)]);
  }
  const parMat = new Map(), parPiece = new Map(), parNom = new Map();
  for (const e of emp.rows) {
    if (e.matricule) parMat.set(sansAccent(e.matricule), e);
    if (e.piece_numero) parPiece.set(sansAccent(e.piece_numero), e);
    parNom.set(`${sansAccent(e.nom_c)}|${sansAccent(e.prenom_c)}|${dateLocaleISO(e.date_naissance) || ""}`, e);
  }
  const vus = new Set();
  const resultats = [];
  for (const l of lues) {
    const { corps, erreurs } = convertirLigne(l.brut, lang);
    const ce = convertirEnfants(l.enfantsBruts || [], lang);
    erreurs.push(...ce.erreurs);
    const norm = normaliser(corps);
    for (const c of norm.erreurs) if (!erreurs.some((x) => x.champ === c)) erreurs.push({ champ: c, libelle: lab(c, lang) });
    const valeurs = norm.valeurs;
    // les booleens/entiers absents ne doivent pas etre reecrits : normaliser n'a vu que les cles presentes
    const existant =
      (corps.matricule && parMat.get(sansAccent(corps.matricule))) ||
      (corps.piece_numero && parPiece.get(sansAccent(corps.piece_numero))) ||
      parNom.get(`${sansAccent(corps.nom)}|${sansAccent(corps.prenom)}|${corps.date_naissance || ""}`) ||
      null;
    const r = {
      ligne: l.ligne, action: "ERREUR", employe_id: existant ? existant.id : null,
      matricule: (existant && existant.matricule) || corps.matricule || null,
      nom: corps.nom || (existant && existant.nom_c) || "", prenom: corps.prenom || (existant && existant.prenom_c) || "",
      changements: [], erreurs, avertissements: [],
      enfants: { fichier: ce.enfants.length, actuel: existant ? nbEnfants.get(existant.id) || 0 : 0, remplace: ce.enfants.length > 0 },
      valeurs, enfants_valeurs: ce.enfants,
    };
    if (existant && vus.has(existant.id)) { r.erreurs.push({ champ: "doublon", libelle: lang === "en" ? "Employee present twice in the file" : "Salarié présent deux fois dans le fichier" }); }
    if (existant) vus.add(existant.id);
    if (!existant) {
      const manquants = ["nom", "prenom", "sexe", "date_naissance"].filter((c) => !valeurs[c]);
      for (const c of manquants.filter((m) => !r.erreurs.some((x) => x.champ === m))) r.erreurs.push({ champ: c, libelle: `${lab(c, lang)} (${lang === "en" ? "required" : "obligatoire"})` });
      if (!r.erreurs.length) r.action = "CREER";
    } else if (!r.erreurs.length) {
      for (const [c, v] of Object.entries(valeurs)) {
        const a = ctrl(DEF_VAL(existant, c));
        const n = ctrl(v);
        const num = DEFS[c] && (DEFS[c].type === "num" || DEFS[c].type === "int");
        const identique = num && a != null && n != null ? Number(a) === Number(n) : a === n;
        if (!identique) r.changements.push({ champ: c, libelle: lab(c, lang), ancien: a, nouveau: n });
      }
      const attendus = (sigEnfants.get(existant.id) || []).slice().sort().join("#");
      const recus = ce.enfants.map((e) => sig({ ...e, nom: e.nom || null })).sort().join("#");
      r.enfants.remplace = ce.enfants.length > 0 && attendus !== recus;
      r.action = r.changements.length || r.enfants.remplace ? "MAJ" : "INCHANGE";
    }
    resultats.push(r);
  }
  const resume = { creer: 0, maj: 0, inchange: 0, erreur: 0 };
  for (const r of resultats) resume[{ CREER: "creer", MAJ: "maj", INCHANGE: "inchange", ERREUR: "erreur" }[r.action]] += 1;
  return { lignes: resultats, resume };
}
function DEF_VAL(existant, c) {
  const v = existant[c];
  if (c === "nom") return existant.nom_c;
  if (c === "prenom") return existant.prenom_c;
  return v;
}

/** Applique les lignes CREER / MAJ de l'analyse. `outils` : { genererMatricule, enregistrerHistorique, remplacerEnfants, uuid }. */
async function appliquer(db, tenantId, userId, analyse, outils) {
  const sortie = { crees: 0, mis_a_jour: 0, ignores: 0, erreurs: [] };
  for (const r of analyse.lignes) {
    if (r.action !== "CREER" && r.action !== "MAJ") { sortie.ignores += 1; continue; }
    try {
      if (r.action === "CREER") {
        const valeurs = { ...r.valeurs };
        if (!valeurs.matricule) valeurs.matricule = await outils.genererMatricule(tenantId);
        if (!valeurs.nationalite) valeurs.nationalite = "Sénégalaise";
        if (!valeurs.nationalite_categorie && valeurs.nationalite === "Sénégalaise") valeurs.nationalite_categorie = "S";
        const id = outils.uuid();
        const colonnes = ["id", "tenant_id", ...Object.keys(valeurs)];
        await db.query(`INSERT INTO employe (${colonnes.join(", ")}) VALUES (${colonnes.map((_, i) => `$${i + 1}`).join(", ")})`, [id, tenantId, ...Object.values(valeurs)]);
        if (r.enfants_valeurs.length) await outils.remplacerEnfants(tenantId, id, outils.enfantsComplets(r.enfants_valeurs));
        sortie.crees += 1;
      } else {
        const cles = Object.keys(r.valeurs);
        if (cles.length) {
          const ancien = (await db.query(`SELECT * FROM employe WHERE id = $1 AND tenant_id = $2`, [r.employe_id, tenantId])).rows[0];
          await db.query(`UPDATE employe SET ${cles.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = $${cles.length + 1} AND tenant_id = $${cles.length + 2}`, [...Object.values(r.valeurs), r.employe_id, tenantId]);
          await outils.enregistrerHistorique(tenantId, r.employe_id, ancien, r.valeurs, userId);
        }
        if (r.enfants.remplace) await outils.remplacerEnfants(tenantId, r.employe_id, outils.enfantsComplets(r.enfants_valeurs));
        sortie.mis_a_jour += 1;
      }
    } catch (err) {
      console.error(err);
      sortie.erreurs.push({ ligne: r.ligne, message: err.code === "23505" ? "matricule" : "erreur" });
    }
  }
  return sortie;
}

// ------------------------------------------------------------------------------------------------ PDF
function sectionPdf(doc, titre) {
  asseoir(doc, 60);
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(PETROLE).text(titre.toUpperCase(), doc.page.margins.left, doc.y, { width: largeurUtile(doc) });
  const y = doc.y + 1;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + largeurUtile(doc), y).lineWidth(0.5).strokeColor(LIGNE).stroke();
  doc.y = y + 5;
}

/** Cases en grille de 2 colonnes : libelle + valeur (ou ligne a remplir a la main). */
function grillePdf(doc, paires) {
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const w = (L - 14) / 2;
  for (let i = 0; i < paires.length; i += 2) {
    asseoir(doc, 32);
    const y = doc.y;
    let bas = y;
    [paires[i], paires[i + 1]].forEach((p, k) => {
      if (!p) return;
      const x = x0 + k * (w + 14);
      doc.font("Helvetica").fontSize(7.2).fillColor(GRIS).text(p[0], x, y, { width: w, lineBreak: false, ellipsis: true });
      if (p[1]) doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#000").text(p[1], x, y + 9, { width: w, lineBreak: false, ellipsis: true });
      doc.moveTo(x, y + 22).lineTo(x + w, y + 22).lineWidth(0.4).strokeColor(LIGNE).stroke();
      bas = Math.max(bas, y + 26);
    });
    doc.y = bas;
    doc.x = x0;
  }
}

async function fichePdf(entete, { lang = "fr", employe = null, enfants = [] } = {}) {
  const fr = lang !== "en";
  const { doc, fini } = nouveauDocument();
  R.enteteClient(doc, entete);
  R.titreDoc(doc, fr ? "FICHE DE RENSEIGNEMENTS DU SALARIÉ" : "EMPLOYEE INFORMATION SHEET",
    fr ? "À remplir en lettres majuscules et à remettre au service RH, avec une copie de la pièce d'identité." : "Fill in block letters and return to HR with a copy of your ID document.");
  for (const s of SECTIONS) {
    if (s.id === "ENTREPRISE") continue;
    sectionPdf(doc, fr ? s.fr : s.en);
    const paires = s.champs.filter(([k]) => DEFS[k] && k !== "matricule").map(([k]) => {
      let v = employe ? employe[k] : null;
      if (v != null && ENUMS[k]) v = libEnum(k, v, lang);
      else if (v != null && DEFS[k].type === "date") v = String(dateLocaleISO(v)).split("-").reverse().join("/");
      else if (v != null && DEFS[k].type === "bool") v = v ? (fr ? "oui" : "yes") : (fr ? "non" : "no");
      return [lab(k, lang), v == null ? "" : String(v)];
    });
    grillePdf(doc, paires);
  }
  sectionPdf(doc, fr ? "Enfants" : "Children");
  const lignes = Math.max(5, (enfants || []).length);
  const x0 = doc.page.margins.left;
  const L = largeurUtile(doc);
  const cols = fr ? ["Nom", "Prénom", "Sexe", "Date de naissance", "À charge / étudiant / infirme"] : ["Last name", "First name", "Sex", "Date of birth", "Dependent / student / disabled"];
  const cw = [L * 0.22, L * 0.22, L * 0.08, L * 0.18, L * 0.3];
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GRIS);
  let x = x0;
  cols.forEach((c, i) => { doc.text(c, x + 2, doc.y, { width: cw[i], lineBreak: false }); x += cw[i]; });
  doc.moveDown(0.9);
  for (let i = 0; i < lignes; i++) {
    asseoir(doc, 20);
    const y = doc.y;
    const e = (enfants || [])[i];
    if (e) {
      const val = [e.nom, e.prenom, e.sexe, e.date_naissance ? String(dateLocaleISO(e.date_naissance)).split("-").reverse().join("/") : "", [e.etudiant ? (fr ? "étudiant" : "student") : "", e.infirme ? (fr ? "infirme" : "disabled") : ""].filter(Boolean).join(", ")];
      let xx = x0;
      doc.font("Helvetica").fontSize(9).fillColor("#000");
      val.forEach((v, k) => { doc.text(String(v || ""), xx + 2, y + 3, { width: cw[k] - 4, lineBreak: false, ellipsis: true }); xx += cw[k]; });
    }
    doc.moveTo(x0, y + 17).lineTo(x0 + L, y + 17).lineWidth(0.4).strokeColor(LIGNE).stroke();
    doc.y = y + 19;
  }
  asseoir(doc, 80);
  doc.moveDown(1.2);
  doc.font("Helvetica").fontSize(9).fillColor("#000").text(
    fr ? "Je certifie l'exactitude des renseignements ci-dessus et m'engage à signaler tout changement à l'employeur."
       : "I certify that the information above is accurate and undertake to report any change to the employer.",
    x0, doc.y, { width: L });
  doc.moveDown(1.2);
  doc.text(fr ? "Fait à ______________________, le ____ / ____ / ________" : "Done at ______________________, on ____ / ____ / ________", x0, doc.y, { width: L / 2 });
  doc.text(fr ? "Signature du salarié :" : "Employee's signature:", x0 + L / 2, doc.y - 11, { width: L / 2 });
  R.pieds(doc, entete, { reference: fr ? "Fiche de renseignements" : "Information sheet", mention: false });
  doc.end();
  return fini;
}

module.exports = { classeurMasse, classeurIndividuel, lireClasseur, analyser, appliquer, fichePdf, TOUS, lab, convertir, serialVersISO };
