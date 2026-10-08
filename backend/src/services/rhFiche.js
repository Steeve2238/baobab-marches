/**
 * Dossier employe : liste des champs, normalisation, calcul indicatif des parts IR / TRIMF et completude.
 *
 * Parts IR (CGI 2025, art. 174-178) :
 *  - celibataire, divorce ou veuf sans enfant a charge : 1 ;
 *  - marie : 1 + 0,5 (un seul conjoint a des revenus, art. 174-3) ; si les deux conjoints ont des revenus : 1 ;
 *  - veuf avec enfant(s) a charge : 1,5 comme un marie sans autre revenu ;
 *  - + 0,5 par enfant a charge (art. 174-2) ;
 *  - art. 175 : celibataire/divorce/veuf sans enfant a charge : 1,5 si enfant decede ou invalidite >= 40 % ;
 *  - non-resident : 1,5 au maximum (art. 176) ; plafond general : 5 (art. 174-4).
 * Enfant a charge : sans revenus propres et (mineur, ou infirme, ou etudiant de moins de 25 ans), age apprecie
 * au 1er janvier de l'annee de reference (art. 177-178).
 * Ce calcul est INDICATIF : le RH peut saisir le nombre de parts a la main (parts_ir_manuel / parts_trimf_manuel).
 */

const T = (name) => ({ name, type: "text" });
const D = (name) => ({ name, type: "date" });
const B = (name) => ({ name, type: "bool" });
const I = (name) => ({ name, type: "int" });
const N = (name) => ({ name, type: "num" });
const E = (name, values) => ({ name, type: "enum", values });

const CHAMPS = [
  T("matricule"),
  E("civilite", ["M", "MME", "MLLE"]),
  T("nom"), T("prenom"), T("nom_naissance"),
  E("sexe", ["M", "F"]),
  D("date_naissance"), T("lieu_naissance"), T("pays_naissance"),
  T("nationalite"), E("nationalite_categorie", ["S", "A", "F", "L", "E"]),
  T("pere_nom"), T("mere_nom"), T("groupe_ethnique"),
  E("piece_type", ["CNI", "PASSEPORT", "CARTE_SEJOUR", "AUTRE"]),
  T("piece_numero"), T("piece_lieu"), D("piece_date"),
  T("numero_css"), T("numero_ipres"),
  T("adresse"), T("ville"), T("email_personnel"), T("telephone"),
  T("contact_urgence_nom"), T("contact_urgence_telephone"),
  B("resident_senegal"), D("date_entree_senegal"), T("statut_militaire"), T("precedent_employeur"),
  E("situation_familiale", ["CELIBATAIRE", "MARIE", "DIVORCE", "VEUF"]),
  T("conjoint_nom"), T("conjoint_prenom"), D("conjoint_date_naissance"), T("conjoint_profession"),
  B("conjoint_a_revenus"), I("nombre_epouses"), B("titulaire_invalidite_40"), B("enfant_decede"),
  N("parts_ir_manuel"), N("parts_trimf_manuel"),
  T("poste"), T("qualification"), T("service"), T("lieu_travail"),
  T("convention_collective"), T("categorie"), T("echelon"),
  E("classification", ["OUVRIER", "EMPLOYE", "AGENT_MAITRISE", "CADRE"]),
  T("type_contrat"), D("date_embauche"), D("date_fin_contrat"), I("periode_essai_mois"), N("heures_hebdo"),
  T("numero_declaration_embauche"), D("date_declaration_embauche"),
  D("date_sortie"), T("motif_sortie"),
  E("mode_paiement", ["VIREMENT", "ESPECES", "CHEQUE", "MOBILE_MONEY"]),
  T("banque"), T("numero_compte"), T("mobile_money_numero"),
  N("solde_conges"), E("statut", ["ACTIF", "INACTIF"]),
];

// Champs qu'un salarie peut corriger lui-meme dans son espace (coordonnees uniquement).
const CHAMPS_SALARIE = [
  "telephone", "adresse", "ville", "email_personnel", "contact_urgence_nom", "contact_urgence_telephone",
];

// Champs dont toute modification est tracee dans l'historique.
const CHAMPS_HISTORISES = [
  "nom", "prenom", "situation_familiale", "conjoint_a_revenus", "nombre_epouses", "adresse", "ville",
  "poste", "qualification", "convention_collective", "categorie", "echelon", "classification",
  "type_contrat", "date_embauche", "date_fin_contrat", "periode_essai_mois", "heures_hebdo",
  "mode_paiement", "banque", "numero_compte", "mobile_money_numero", "statut", "date_sortie", "matricule",
];

const DEFS = Object.fromEntries(CHAMPS.map((c) => [c.name, c]));

function dateISO(v) {
  if (v == null || v === "") return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) return undefined;
  // 1990-02-31 ne doit pas etre accepte (le moteur JS le decale au 3 mars).
  return new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s ? s : undefined;
}

/**
 * Transforme le corps de requete en { champ: valeurNormalisee }. Seuls les champs presents dans `body` et dans
 * `autorises` sont retenus. Retourne { valeurs, erreurs }.
 */
function normaliser(body, autorises) {
  const valeurs = {};
  const erreurs = [];
  const liste = autorises || CHAMPS.map((c) => c.name);
  for (const name of liste) {
    if (!(name in body)) continue;
    const def = DEFS[name];
    if (!def) continue;
    const brut = body[name];
    let v;
    switch (def.type) {
      case "text":
        v = brut == null || String(brut).trim() === "" ? null : String(brut).trim();
        break;
      case "date":
        v = dateISO(brut);
        if (v === undefined) { erreurs.push(name); continue; }
        break;
      case "bool":
        v = brut === true || brut === "true" || brut === 1 || brut === "1";
        break;
      case "int":
        if (brut == null || brut === "") v = name === "nombre_epouses" ? 0 : null;
        else { v = Number(brut); if (!Number.isInteger(v) || v < 0) { erreurs.push(name); continue; } }
        break;
      case "num":
        if (brut == null || brut === "") v = name === "heures_hebdo" ? 40 : name === "solde_conges" ? 0 : null;
        else { v = Number(brut); if (!Number.isFinite(v) || v < 0) { erreurs.push(name); continue; } }
        if (name === "parts_ir_manuel" && v != null && (v < 1 || v > 5)) { erreurs.push(name); continue; }
        break;
      case "enum":
        if (brut == null || brut === "") v = null;
        else if (def.values.includes(brut)) v = brut;
        else { erreurs.push(name); continue; }
        break;
      default:
        continue;
    }
    if (name === "statut" && v == null) continue;
    valeurs[name] = v;
  }
  return { valeurs, erreurs };
}

function ageAu(dateNaissance, dateRef) {
  if (!dateNaissance) return null;
  const n = new Date(dateNaissance), r = new Date(dateRef);
  let age = r.getUTCFullYear() - n.getUTCFullYear();
  const m = r.getUTCMonth() - n.getUTCMonth();
  if (m < 0 || (m === 0 && r.getUTCDate() < n.getUTCDate())) age -= 1;
  return age;
}

/** Enfant a charge au 1er janvier de `annee` (CGI art. 177-178). */
function enfantACharge(enfant, annee) {
  if (enfant.revenus_propres) return false;
  if (enfant.infirme) return true;
  const age = ageAu(enfant.date_naissance, `${annee}-01-01`);
  if (age == null) return false;
  if (age < 18) return true;
  return Boolean(enfant.etudiant) && age < 25;
}

function calculerParts(fiche, enfants, annee) {
  const an = annee || new Date().getUTCFullYear();
  const aCharge = (enfants || []).filter((e) => enfantACharge(e, an));
  const n = aCharge.length;
  const sit = fiche.situation_familiale || "CELIBATAIRE";
  let parts;
  if (sit === "MARIE") parts = fiche.conjoint_a_revenus ? 1 : 1.5;
  else if (sit === "VEUF") parts = n > 0 ? 1.5 : 1;
  else parts = 1;
  parts += 0.5 * n;
  if (n === 0 && sit !== "MARIE" && (fiche.titulaire_invalidite_40 || fiche.enfant_decede)) parts = 1.5;
  if (fiche.resident_senegal === false) parts = Math.min(parts, 1.5);
  parts = Math.min(parts, 5);

  // TRIMF : le salarie et, s'il est marie, son conjoint sans revenus (a confirmer avec le service fiscalite).
  const partsTrimf = 1 + (sit === "MARIE" && !fiche.conjoint_a_revenus ? 1 : 0);

  const partsIr = fiche.parts_ir_manuel != null ? Number(fiche.parts_ir_manuel) : parts;
  const trimf = fiche.parts_trimf_manuel != null ? Number(fiche.parts_trimf_manuel) : partsTrimf;
  return {
    annee: an,
    enfants_a_charge: n,
    parts_ir_calculees: parts,
    parts_trimf_calculees: partsTrimf,
    parts_ir: partsIr,
    parts_trimf: trimf,
    manuel_ir: fiche.parts_ir_manuel != null,
    manuel_trimf: fiche.parts_trimf_manuel != null,
  };
}

// Champs indispensables a la paie, aux contrats et a la DMT.
const CHAMPS_REQUIS_PAIE = [
  "matricule", "nom", "prenom", "sexe", "date_naissance", "date_embauche", "situation_familiale",
  "convention_collective", "categorie", "classification", "type_contrat", "poste", "adresse",
  "piece_numero", "numero_css", "mode_paiement",
];

function completude(fiche) {
  const manquants = CHAMPS_REQUIS_PAIE.filter((c) => fiche[c] == null || fiche[c] === "");
  const pct = Math.round(((CHAMPS_REQUIS_PAIE.length - manquants.length) / CHAMPS_REQUIS_PAIE.length) * 100);
  return { manquants, pourcentage: pct };
}

module.exports = {
  CHAMPS, CHAMPS_SALARIE, CHAMPS_HISTORISES, normaliser, enfantACharge, calculerParts, completude, ageAu,
};
