/**
 * Service d'extraction automatique du contenu d'un DAO (Dossier d'Appel
 * d'Offres) : texte brut (PDF/Word) puis clauses cles par heuristique
 * (regles regex sur les formulations standard des CCAG/CCAP senegalais).
 *
 * IMPORTANT : cette extraction est une AIDE, jamais une verite absolue.
 * Chaque clause detectee est enregistree avec niveau_vigilance = 'A_VERIFIER'
 * et valide_par_juridique = false : elle doit etre validee (ou corrigee, ou
 * rejetee) par un humain avant d'etre consideree fiable (voir Module 7,
 * intelligence juridique, a venir). On ne code ici que la DETECTION ; la
 * decision finale reste humaine.
 */
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const MIMETYPE_PDF = "application/pdf";
const MIMETYPE_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIMETYPE_DOC = "application/msword";

/**
 * Extrait le texte brut d'un fichier DAO (PDF ou Word) a partir de son buffer.
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @returns {Promise<string>}
 */
async function extraireTexteFichier(buffer, mimetype) {
  if (mimetype === MIMETYPE_PDF) {
    const resultat = await pdfParse(buffer);
    return resultat.text || "";
  }
  if (mimetype === MIMETYPE_DOCX || mimetype === MIMETYPE_DOC) {
    const resultat = await mammoth.extractRawText({ buffer });
    return resultat.value || "";
  }
  throw new Error("FORMAT_NON_SUPPORTE");
}

// Regles d'extraction : chaque regle cible un type_clause parmi ceux prevus
// par le schema (table clause_extraite) et tente de capturer un pourcentage
// ou un nombre de jours associe. Les regex sont volontairement permissives
// (variantes d'ecriture frequentes dans les CCAG/CCAP) : mieux vaut un faux
// positif signale A_VERIFIER qu'une clause a risque totalement manquee.
const REGLES_EXTRACTION = [
  {
    type_clause: "GARANTIE_SOUMISSION",
    regex: /(?:caution|garantie)\s+de\s+soumission[^.\n]{0,100}?(\d{1,2}(?:[.,]\d+)?)\s?%/gi,
    libelle: (m) => `Garantie de soumission : ${m[1]}%`,
    valeurNumerique: (m) => Number(m[1].replace(",", ".")),
  },
  {
    type_clause: "GARANTIE_BONNE_EXECUTION",
    regex: /garantie\s+de\s+bonne\s+ex[eé]cution[^.\n]{0,100}?(\d{1,2}(?:[.,]\d+)?)\s?%/gi,
    libelle: (m) => `Garantie de bonne exécution : ${m[1]}%`,
    valeurNumerique: (m) => Number(m[1].replace(",", ".")),
  },
  {
    type_clause: "RETENUE_GARANTIE",
    regex: /retenue\s+de\s+garantie[^.\n]{0,100}?(\d{1,2}(?:[.,]\d+)?)\s?%/gi,
    libelle: (m) => `Retenue de garantie : ${m[1]}%`,
    valeurNumerique: (m) => Number(m[1].replace(",", ".")),
  },
  {
    type_clause: "AVANCE_DEMARRAGE",
    regex: /avance\s+de\s+d[eé]marrage[^.\n]{0,100}?(\d{1,2}(?:[.,]\d+)?)\s?%/gi,
    libelle: (m) => `Avance de démarrage : ${m[1]}%`,
    valeurNumerique: (m) => Number(m[1].replace(",", ".")),
  },
  {
    type_clause: "PENALITE_RETARD",
    regex: /p[eé]nalit[eé]s?\s+(?:de\s+|pour\s+)?retard[^.\n]{0,120}?(\d+(?:[.,]\d+)?)\s?(‰|pour\s+mille|%)/gi,
    libelle: (m) => `Pénalité de retard : ${m[1]}${m[2].includes("%") ? "%" : "‰"} / jour`,
    valeurNumerique: (m) => Number(m[1].replace(",", ".")),
  },
  {
    type_clause: "DELAI_EXECUTION",
    regex: /d[eé]lai\s+d['’]?ex[eé]cution[^.\n]{0,80}?(\d+)\s?(jours|mois)/gi,
    libelle: (m) => `Délai d'exécution : ${m[1]} ${m[2]}`,
    valeurNumerique: (m) => Number(m[1]) * (m[2].startsWith("mois") ? 30 : 1),
  },
  {
    type_clause: "ASSURANCE",
    regex: /(assurance\s+(?:tous\s+risques\s+chantier|responsabilit[eé]\s+civile|d[eé]cennale))/gi,
    libelle: (m) => `Assurance requise : ${m[1]}`,
    valeurNumerique: () => null,
  },
  {
    type_clause: "REGIME_FISCAL",
    regex: /(exon[eé]ration\s+(?:de\s+)?(?:tva|douane)|r[eé]gime\s+fiscal\s+de\s+faveur)/gi,
    libelle: (m) => `Régime fiscal : ${m[1]}`,
    valeurNumerique: () => null,
  },
  {
    type_clause: "CRITERE_ORIGINE",
    regex: /(pr[eé]f[eé]rence\s+(?:communautaire|nationale)|origine\s+(?:UEMOA|CEDEAO|s[eé]n[eé]galaise))/gi,
    libelle: (m) => `Critère d'origine : ${m[1]}`,
    valeurNumerique: () => null,
  },
  {
    type_clause: "JURIDICTION",
    regex:
      /(tribunal\s+(?:de\s+commerce\s+)?de\s+[A-ZÀ-Ý][\w-]+|comp[eé]tence\s+exclusive\s+des?\s+juridictions?\s+s[eé]n[eé]galaises?|arbitrage\s+(?:CCJA|CCI))/gi,
    libelle: (m) => `Juridiction compétente : ${m[1]}`,
    valeurNumerique: () => null,
  },
];

/**
 * Cherche une reference d'article ("Art. 7.1", "Article 12"...) dans les
 * ~150 caracteres qui precedent la clause detectee, frequent dans les CCAG.
 */
function detecterArticleProche(texte, index) {
  const debut = Math.max(0, index - 150);
  const contexte = texte.slice(debut, index);
  // Prend la DERNIERE occurrence dans la fenetre (donc la plus proche de la
  // clause), pas la premiere : un DAO contient plusieurs en-tetes d'article
  // dans une fenetre de 150 caracteres, le plus proche est le bon.
  const regex = /art(?:icle)?\.?\s?(\d+(?:\.\d+)*)/gi;
  let dernier = null;
  let m;
  while ((m = regex.exec(contexte)) !== null) {
    dernier = m;
  }
  return dernier ? `Art. ${dernier[1]}` : null;
}

/**
 * Applique les regles d'extraction au texte du DAO et retourne les clauses
 * candidates (jamais persistees ici : c'est a l'appelant de les inserer en
 * base, avec niveau_vigilance = 'A_VERIFIER' et valide_par_juridique = false).
 * Plafonne a 5 occurrences par regle pour eviter qu'une regle trop permissive
 * ne pollue la liste sur un document tres long.
 * @param {string} texte
 * @returns {Array<{type_clause: string, libelle: string, valeur_numerique: number|null, valeur_texte: string, article_reference: string|null}>}
 */
function extraireClauses(texte) {
  const clauses = [];
  const texteNormalise = (texte || "").replace(/\s+/g, " ");

  for (const regle of REGLES_EXTRACTION) {
    const regex = new RegExp(regle.regex.source, regle.regex.flags);
    let match;
    let occurrences = 0;
    while ((match = regex.exec(texteNormalise)) !== null && occurrences < 5) {
      occurrences += 1;
      clauses.push({
        type_clause: regle.type_clause,
        libelle: regle.libelle(match),
        valeur_numerique: regle.valeurNumerique(match),
        valeur_texte: match[0].trim().slice(0, 500),
        article_reference: detecterArticleProche(texteNormalise, match.index),
      });
    }
  }
  return clauses;
}

module.exports = { extraireTexteFichier, extraireClauses };
