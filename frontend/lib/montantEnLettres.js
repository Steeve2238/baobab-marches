// Montant en lettres (francais) pour les devis et factures - chantier du
// 04/10/2026. Orthographe traditionnelle des documents commerciaux :
// "vingt et un", "soixante et onze", "quatre-vingts", "quatre-vingt-un",
// "deux cents" / "deux cent un", "mille" invariable, "millions" accordes.
// Le calcul se fait sur des entiers (BigInt-free : montants < 10^15).

const UNITES = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
  "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf",
];
const DIZAINES = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

// 0 < n < 100. "final" = le nombre termine le groupe (accord de quatre-vingts).
function moinsDeCent(n, final) {
  if (n < 20) return UNITES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d <= 6) {
    if (u === 0) return DIZAINES[d];
    if (u === 1) return `${DIZAINES[d]} et un`;
    return `${DIZAINES[d]}-${UNITES[u]}`;
  }
  if (d === 7) {
    // soixante-dix ... soixante-dix-neuf
    if (u === 1) return "soixante et onze";
    return `soixante-${UNITES[10 + u]}`;
  }
  // 80..99
  if (d === 8) {
    if (u === 0) return final ? "quatre-vingts" : "quatre-vingt";
    return `quatre-vingt-${UNITES[u]}`;
  }
  return `quatre-vingt-${UNITES[10 + u]}`;
}

// 0 < n < 1000
function moinsDeMille(n, final) {
  const c = Math.floor(n / 100);
  const reste = n % 100;
  let texte = "";
  if (c === 1) texte = "cent";
  else if (c > 1) texte = `${UNITES[c]} cent${reste === 0 && final ? "s" : ""}`;
  if (reste === 0) return texte;
  const suite = moinsDeCent(reste, final);
  return texte ? `${texte} ${suite}` : suite;
}

// Entier >= 0 -> lettres (sans devise).
export function entierEnLettres(nombre) {
  let n = Math.floor(Math.abs(Number(nombre)));
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "zéro";
  const groupes = [];
  while (n > 0) {
    groupes.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const NOMS = ["", "mille", "million", "milliard", "billion"];
  if (groupes.length > NOMS.length) return "";
  const parties = [];
  for (let i = groupes.length - 1; i >= 0; i--) {
    const g = groupes[i];
    if (g === 0) continue;
    if (i === 0) {
      parties.push(moinsDeMille(g, true));
    } else if (i === 1) {
      // "mille" invariable ; pas de "un mille" ; "cent" et "vingt" sans s devant mille
      parties.push(g === 1 ? "mille" : `${moinsDeMille(g, false)} mille`);
    } else {
      const nom = NOMS[i];
      // million / milliard sont des noms : "deux cents millions", "quatre-vingts millions"
      parties.push(`${moinsDeMille(g, true)} ${nom}${g > 1 ? "s" : ""}`);
    }
  }
  return parties.join(" ");
}

function derniereGroupeEstZero(n) {
  return Math.floor(Math.abs(n)) % 1000000 === 0;
}

// Montant en francs CFA, en lettres. Ex : 1 200 000 -> "un million deux cent mille francs CFA".
// Les centimes (rares en FCFA) sont ajoutes si le montant n'est pas entier.
// "million(s)" / "milliard(s)" exacts prennent "de" : "un million de francs CFA".
export function montantEnLettres(montant, options = {}) {
  const devise = options.devise || { singulier: "franc CFA", pluriel: "francs CFA" };
  const valeur = Number(montant);
  if (!Number.isFinite(valeur)) return "";
  const arrondi = Math.round(Math.abs(valeur) * 100) / 100;
  let entier = Math.floor(arrondi);
  let centimes = Math.round((arrondi - entier) * 100);
  if (centimes === 100) { entier += 1; centimes = 0; }
  let texte = entierEnLettres(entier);
  if (!texte) return "";
  const de = entier >= 1000000 && derniereGroupeEstZero(entier) ? "de " : "";
  texte += ` ${de}${entier > 1 ? devise.pluriel : devise.singulier}`;
  if (centimes > 0) {
    texte += ` et ${entierEnLettres(centimes)} ${centimes > 1 ? "centimes" : "centime"}`;
  }
  if (valeur < 0) texte = `moins ${texte}`;
  return texte;
}

export function premiereLettreMajuscule(texte) {
  return texte ? texte.charAt(0).toUpperCase() + texte.slice(1) : texte;
}
