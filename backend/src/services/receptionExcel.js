const XLSX = require("xlsx");

// Lecture d'une facture fournisseur au format Excel : detection de la ligne
// d'en-tete et des colonnes (reference, designation, unite, quantite, prix
// unitaire, montant) par leurs intitules usuels, en francais et en anglais.

function normaliser(v) {
  return String(v === undefined || v === null ? "" : v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function nombre(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v === undefined || v === null ? "" : v).replace(/[\s  ]/g, "").replace(/[^\d,.\-]/g, "");
  if (!s) return null;
  // "1.234,56" (europeen) ou "1,234.56" : le dernier separateur est le decimal
  const dernierVirgule = s.lastIndexOf(",");
  const dernierPoint = s.lastIndexOf(".");
  let propre = s;
  if (dernierVirgule > -1 && dernierPoint > -1) {
    propre = dernierVirgule > dernierPoint ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (dernierVirgule > -1) {
    propre = s.replace(",", ".");
  }
  const n = Number(propre);
  return Number.isFinite(n) ? n : null;
}

function typeColonne(cellule) {
  const c = normaliser(cellule);
  if (!c) return null;
  if (/^(montant|total|valeur|amount|totalht|montantht|prixtotal|totalprice|linetotal)/.test(c)) return "montant";
  if (/^(pu|puht|prixunitaire|prixunit|prixu|prixunitaireht|unitprice|priceunit|unitcost|prixdachat|prixachat|price|prix)/.test(c)) return "pu";
  if (/^(quantite|qte|qty|quantity|nombre|nb)/.test(c)) return "quantite";
  if (/^(unite|unit|um|uom|u)$/.test(c)) return "unite";
  if (/^(ref|reference|refarticle|refproduit|code|codearticle|codeproduit|partnumber|pn|sku|partno|itemcode)/.test(c)) return "reference";
  if (/^(designation|libelle|description|produit|article|intitule|designationarticle|item|nom)/.test(c)) return "designation";
  return null;
}

/**
 * @returns {{ lignes: Array, avertissements: Array<{code:string, ligne?:number, calcule?:number, montant?:number}> }}
 * ou { erreur: "COLONNES" | "FICHIER" }
 */
function lireFactureExcel(buffer) {
  let feuille;
  try {
    const classeur = XLSX.read(buffer, { type: "buffer" });
    feuille = classeur.Sheets[classeur.SheetNames[0]];
  } catch (e) {
    return { erreur: "FICHIER" };
  }
  if (!feuille) return { erreur: "FICHIER" };
  const lignesBrutes = XLSX.utils.sheet_to_json(feuille, { header: 1, defval: "", raw: true });

  let indexEntete = -1;
  let colonnes = {};
  for (let i = 0; i < Math.min(lignesBrutes.length, 25); i++) {
    const trouve = {};
    lignesBrutes[i].forEach((cell, j) => {
      const type = typeColonne(cell);
      if (type && trouve[type] === undefined) trouve[type] = j;
    });
    if (trouve.designation !== undefined && trouve.quantite !== undefined) {
      indexEntete = i;
      colonnes = trouve;
      break;
    }
  }
  if (indexEntete === -1) return { erreur: "COLONNES" };

  const lignes = [];
  const avertissements = [];
  for (let i = indexEntete + 1; i < lignesBrutes.length; i++) {
    const row = lignesBrutes[i];
    const designation = String(row[colonnes.designation] ?? "").trim();
    const reference = colonnes.reference !== undefined ? String(row[colonnes.reference] ?? "").trim() : "";
    if (!designation && !reference) continue;
    if (/^(total|sommetotale|soustotal|subtotal)/.test(normaliser(designation)) || /^(total|soustotal|subtotal)/.test(normaliser(reference))) continue;
    const numeroLigne = i + 1; // numero de ligne dans le fichier
    const quantite = nombre(row[colonnes.quantite]);
    if (!designation || !(quantite > 0)) {
      avertissements.push({ code: "LIGNE_IGNOREE", ligne: numeroLigne });
      continue;
    }
    let pu = colonnes.pu !== undefined ? nombre(row[colonnes.pu]) : null;
    const montant = colonnes.montant !== undefined ? nombre(row[colonnes.montant]) : null;
    if ((pu === null || pu === 0) && montant !== null && quantite > 0) {
      pu = Math.round((montant / quantite) * 10000) / 10000;
    }
    if (pu === null) {
      avertissements.push({ code: "PRIX_MANQUANT", ligne: numeroLigne });
      pu = 0;
    } else if (montant !== null) {
      const calcule = Math.round(quantite * pu * 100) / 100;
      if (Math.abs(calcule - montant) > Math.max(0.05, Math.abs(montant) * 0.005)) {
        avertissements.push({ code: "ECART_MONTANT", ligne: numeroLigne, calcule, montant });
      }
    }
    lignes.push({
      reference_fournisseur: reference,
      designation,
      unite: colonnes.unite !== undefined ? String(row[colonnes.unite] ?? "").trim() || "U" : "U",
      quantite,
      prix_unitaire_devise: pu,
    });
  }
  return { lignes, avertissements };
}

module.exports = { lireFactureExcel };
