const { Parser } = require("expr-eval");

const parser = new Parser();

/**
 * Evalue une expression mathematique parametree (ex: "montant*(taux/100)")
 * stockee dans regle_formule.expression, avec les variables fournies.
 *
 * - N'utilise jamais eval() JS : parsing/evaluation surs via expr-eval.
 * - Toute variable absente est traitee comme 0 (les lignes tarifaires ont
 *   souvent des champs optionnels : commission_pct, taf_pct...).
 *
 * @param {string} expression - ex: "montant*(taux_annuel/100)*(duree_jours/365)"
 * @param {object} variables - ex: { montant: 50000000, taux_annuel: 8.5, duree_jours: 90 }
 * @returns {number}
 * @throws {Error} si l'expression est invalide (syntaxe incorrecte)
 */
function evaluerExpression(expression, variables = {}) {
  const varsAvecDefaut = new Proxy(variables, {
    get(target, prop) {
      const v = target[prop];
      return v === undefined || v === null ? 0 : Number(v);
    },
  });

  const expr = parser.parse(expression);
  const resultat = expr.evaluate(varsAvecDefaut);

  if (typeof resultat !== "number" || !Number.isFinite(resultat)) {
    throw new Error("Le resultat de l'expression n'est pas un nombre valide.");
  }
  return resultat;
}

/**
 * Verifie qu'une expression est syntaxiquement valide sans l'evaluer,
 * utile pour valider une formule au moment de sa creation/edition.
 */
function validerExpression(expression) {
  try {
    parser.parse(expression);
    return { valide: true };
  } catch (err) {
    return { valide: false, erreur: err.message };
  }
}

module.exports = { evaluerExpression, validerExpression };
