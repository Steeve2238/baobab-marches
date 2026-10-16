/**
 * Import Excel de reprise (Pack Commerce, lot 7) : sortie d'un logiciel tiers (Odoo, Excel...).
 * Trois types : PRODUITS (avec stock d'ouverture facultatif), CLIENTS, FOURNISSEURS.
 *
 * Meme principe que l'import comptable : l'APERCU execute tout l'import dans une transaction annulee a la
 * fin, le rapport est donc exactement celui de l'import reel. Les colonnes sont reconnues par leurs
 * intitules usuels (francais / anglais, y compris les exports Odoo) ; l'ordre des colonnes est libre.
 * L'import est rejouable sans doublon : un element deja present (meme reference / NINEA / nom) est ignore
 * (ou complete, option "mettre_a_jour") et le stock d'ouverture n'est jamais ajoute a un produit qui a deja
 * des mouvements.
 */
const crypto = require("crypto");
const XLSX = require("xlsx");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const echeancier = require("./echeancier");
const { enregistrerMouvement, genererReferenceInterne } = require("./stockService");
const { assurerTiersPourClientSilencieux, assurerTiersPourFournisseurSilencieux } = require("./comptaService");

class ImportError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const TYPES = ["produits", "clients", "fournisseurs"];
const MAX_LIGNES = 5000;

const norm = (v) =>
  String(v === undefined || v === null ? "" : v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const txt = (v, max) => {
  const s = String(v === undefined || v === null ? "" : v).trim();
  return s ? s.slice(0, max) : null;
};
function nombre(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = String(v).replace(/[\s  ]/g, "").replace(/[^\d,.\-]/g, "");
  if (!s) return NaN;
  const vir = s.lastIndexOf(",");
  const pt = s.lastIndexOf(".");
  let p = s;
  if (vir > -1 && pt > -1) p = vir > pt ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (vir > -1) p = s.replace(",", ".");
  const n = Number(p);
  return Number.isFinite(n) ? n : NaN;
}
function dateIso(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return NaN;
    return `${String(d.y).padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return NaN;
}

// Colonnes reconnues par type : { cle: [regex sur l'intitule normalise] } ; la premiere regle qui matche gagne.
const COLONNES = {
  produits: {
    reference: /^(ref|reference|referenceinterne|refinterne|code|codearticle|codeproduit|sku|internalreference|defaultcode|codebarre)$/,
    designation: /^(designation|libelle|nom|nomduproduit|produit|article|name|productname|description)$/,
    unite: /^(unite|unitedemesure|um|uom|unit|unitofmeasure)$/,
    categorie: /^(categorie|categorieproduit|categoriedeproduits|famille|productcategory|category)$/,
    cout: /^(cout|coutderevient|coutunitaire|prixdachat|prixachat|cost|purchaseprice|standardprice|pump|cmup)$/,
    prix_vente: /^(prixdevente|prixvente|pvht|pv|salesprice|saleprice|prixhtvente)$/,
    quantite: /^(quantite|quantiteenstock|quantitedisponible|stock|stockinitial|qte|qty|quantity|quantityonhand|qtyonhand)$/,
    seuil: /^(seuil|seuilalerte|seuildalerte|stockminimum|stockmini|minimumstock|reorderingmin)$/,
    actif: /^(actif|active)$/,
  },
  clients: {
    nom: /^(nom|client|raisonsociale|nomduclient|name|displayname|nomaffiche)$/,
    adresse: /^(adresse|rue|address|street|siege)$/,
    telephone: /^(telephone|tel|mobile|phone|portable|gsm)$/,
    email: /^(email|courriel|mail|emailaddress|adressemail)$/,
    ninea: /^(ninea|numeroninea|nincea|vat|numerodetva|tva|nif|numerofiscal|taxid)$/,
    delai_jours: /^(delai|delaidepaiement|delaipaiement|jours|delaijours|conditionsdepaiement|paymentterms)$/,
    exonere_tva: /^(exonere|exonerationtva|exoneretva|exonere_tva)$/,
    actif: /^(actif|active)$/,
  },
  fournisseurs: {
    nom: /^(nom|fournisseur|raisonsociale|nomdufournisseur|name|displayname|nomaffiche)$/,
    pays: /^(pays|country)$/,
    adresse: /^(adresse|rue|address|street|siege)$/,
    telephone: /^(telephone|tel|mobile|phone|portable|gsm)$/,
    email: /^(email|courriel|mail|emailaddress|adressemail)$/,
    contact_nom: /^(contact|nomducontact|personnedecontact|contactname)$/,
    ninea: /^(ninea|numeroninea|vat|numerodetva|tva|nif|numerofiscal|taxid)$/,
    delai_jours: /^(delai|delaidepaiement|delaipaiement|jours|delaijours|conditionsdepaiement|paymentterms)$/,
  },
};
const OBLIGATOIRE = { produits: "designation", clients: "nom", fournisseurs: "nom" };

function lireClasseur(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: true });
  } catch (e) {
    throw new ImportError("IMPORT_FICHIER_INVALIDE");
  }
  let meilleure = null;
  for (const nom of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: null, blankrows: false });
    if (!meilleure || rows.length > meilleure.length) meilleure = rows;
  }
  if (!meilleure || meilleure.length < 2) throw new ImportError("IMPORT_FICHIER_VIDE");
  return meilleure;
}

/** Detecte la ligne d'en-tete (dans les 15 premieres lignes) et les colonnes. */
function detecterColonnes(rows, type) {
  const regles = COLONNES[type];
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const trouve = {};
    (rows[i] || []).forEach((cell, j) => {
      const n = norm(cell);
      if (!n) return;
      for (const [cle, re] of Object.entries(regles)) {
        if (trouve[cle] === undefined && re.test(n)) { trouve[cle] = j; break; }
      }
    });
    if (trouve[OBLIGATOIRE[type]] !== undefined) return { entete: i, colonnes: trouve };
  }
  throw new ImportError("IMPORT_COLONNES_INTROUVABLES");
}

function booleen(v) {
  const n = norm(v);
  if (!n) return null;
  if (["1", "oui", "o", "yes", "y", "true", "vrai", "x"].includes(n)) return true;
  if (["0", "non", "n", "no", "false", "faux"].includes(n)) return false;
  return null;
}

function lireLignes(buffer, type) {
  const rows = lireClasseur(buffer);
  const { entete, colonnes } = detecterColonnes(rows, type);
  const lignes = [];
  for (let i = entete + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;
    const brut = {};
    for (const [cle, j] of Object.entries(colonnes)) brut[cle] = r[j];
    lignes.push({ ligne: i + 1, brut });
  }
  if (lignes.length === 0) throw new ImportError("IMPORT_FICHIER_VIDE");
  if (lignes.length > MAX_LIGNES) throw new ImportError("IMPORT_TROP_LIGNES");
  return { lignes, colonnes: Object.keys(colonnes) };
}

function echeancierDefaut(type, code, delai) {
  if (delai !== null && delai !== undefined) {
    return [{ pourcentage: 100, evenement: "FACTURATION", jours: delai }];
  }
  const liste = type === "clients" ? echeancier.MODELES.CLIENT : echeancier.MODELES.FOURNISSEUR;
  const m = liste.find((x) => x.code === code) || liste.find((x) => x.code === (type === "clients" ? "CLI_COMMANDE" : "FOU_COMMANDE"));
  return m.lignes;
}

function diag(rapport, ligne, statut, code, extra = {}) {
  rapport.lignes.push({ ligne, statut, code, ...extra });
  rapport.stats[statut] = (rapport.stats[statut] || 0) + 1;
}

// ---------------------------------------------------------------------------------------------
// PRODUITS (+ stock d'ouverture)
// ---------------------------------------------------------------------------------------------
async function traiterProduits(client, ctx, lignes, rapport) {
  const { tenantId, userId, options } = ctx;
  const existants = (await client.query(`SELECT id, reference, designation FROM produit WHERE tenant_id = $1`, [tenantId])).rows;
  const parRef = new Map(existants.filter((p) => p.reference).map((p) => [p.reference.trim().toLowerCase(), p]));
  const parDes = new Map(existants.map((p) => [p.designation.trim().toLowerCase(), p]));
  const vus = new Set();
  const avecMouv = new Set((await client.query(`SELECT DISTINCT produit_id FROM mouvement_stock WHERE tenant_id = $1`, [tenantId])).rows.map((r) => r.produit_id));
  rapport.stats.stock_lignes = 0;
  rapport.stats.stock_valeur = 0;

  for (const { ligne, brut } of lignes) {
    const designation = txt(brut.designation, 300);
    if (!designation) { diag(rapport, ligne, "ERREUR", "IMPORT_DES_REQUISE"); continue; }
    const reference = txt(brut.reference, 80);
    const cout = brut.cout === undefined ? null : nombre(brut.cout);
    const pv = brut.prix_vente === undefined ? null : nombre(brut.prix_vente);
    const qte = brut.quantite === undefined ? null : nombre(brut.quantite);
    const seuil = brut.seuil === undefined ? null : nombre(brut.seuil);
    if ((cout !== null && (Number.isNaN(cout) || cout < 0)) || (pv !== null && (Number.isNaN(pv) || pv < 0))) { diag(rapport, ligne, "ERREUR", "IMPORT_MONTANT_INVALIDE", { nom: designation }); continue; }
    if (qte !== null && (Number.isNaN(qte) || qte < 0)) { diag(rapport, ligne, "ERREUR", "IMPORT_QUANTITE_INVALIDE", { nom: designation }); continue; }
    if (seuil !== null && (Number.isNaN(seuil) || seuil < 0)) { diag(rapport, ligne, "ERREUR", "IMPORT_SEUIL_INVALIDE", { nom: designation }); continue; }
    const cle = reference ? "r:" + reference.toLowerCase() : "d:" + designation.toLowerCase();
    if (vus.has(cle)) { diag(rapport, ligne, "IGNORE", "IMPORT_DOUBLON_FICHIER", { nom: designation }); continue; }
    vus.add(cle);

    const coutRef = cout !== null ? Math.round(cout * 100) / 100 : 0;
    // marge deduite du prix de vente (fraction) : pv = cout x (1 + marge)
    const marge = pv !== null && coutRef > 0 ? Math.min(10, Math.max(0, Math.round((pv / coutRef - 1) * 10000) / 10000)) : 0;
    const unite = txt(brut.unite, 20) || "U";
    const categorie = txt(brut.categorie, 120);
    const actif = booleen(brut.actif);
    const existant = (reference && parRef.get(reference.toLowerCase())) || (!reference && parDes.get(designation.toLowerCase())) || null;

    let produitId;
    let statut;
    if (existant) {
      produitId = existant.id;
      if (options.mettre_a_jour) {
        await client.query(
          `UPDATE produit SET unite = $3, categorie = COALESCE($4, categorie),
                  cout_revient_unitaire_xof = CASE WHEN $5::numeric IS NULL THEN cout_revient_unitaire_xof ELSE $5 END,
                  marge_pct = CASE WHEN $6::numeric IS NULL THEN marge_pct ELSE $6 END,
                  seuil_alerte = COALESCE($7, seuil_alerte), date_maj = now()
           WHERE id = $1 AND tenant_id = $2`,
          [produitId, tenantId, unite, categorie, cout !== null ? coutRef : null, pv !== null && coutRef > 0 ? marge : null, seuil]
        );
        statut = "MAJ";
      } else {
        statut = "IGNORE";
      }
    } else {
      produitId = uuidv4();
      const ref = reference || (await genererReferenceInterne(client, tenantId));
      await client.query(
        `INSERT INTO produit (id, tenant_id, reference, designation, unite, categorie, cout_revient_unitaire_xof, marge_pct,
                              date_cout, actif, seuil_alerte, cree_par)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE,$9,$10,$11)`,
        [produitId, tenantId, ref, designation, unite, categorie, coutRef, marge, actif === null ? true : actif, seuil, userId]
      );
      parRef.set(ref.toLowerCase(), { id: produitId, reference: ref, designation });
      parDes.set(designation.toLowerCase(), { id: produitId, reference: ref, designation });
      statut = "CREER";
    }

    // Stock d'ouverture : jamais ajoute a un produit qui a deja des mouvements (rejouabilite).
    let codeStock = null;
    if (qte !== null && qte > 0) {
      if (avecMouv.has(produitId)) codeStock = "IMPORT_STOCK_DEJA_PRESENT";
      else {
        await enregistrerMouvement(client, {
          tenantId, produitId, type: "ENTREE", quantite: Math.round(qte * 1000) / 1000, coutUnitaire: coutRef,
          date: options.date_stock, origineType: "IMPORT_OUVERTURE", libelle: "Stock d'ouverture (import)", userId,
        });
        avecMouv.add(produitId);
        rapport.stats.stock_lignes += 1;
        rapport.stats.stock_valeur += Math.round(qte * coutRef * 100) / 100;
      }
    }
    if (!codeStock && qte !== null && qte > 0 && coutRef === 0 && statut === "CREER") codeStock = "IMPORT_STOCK_SANS_COUT";
    diag(rapport, ligne, statut, codeStock, { nom: designation, reference: reference || undefined });
  }
  rapport.stats.stock_valeur = Math.round(rapport.stats.stock_valeur * 100) / 100;
}

// ---------------------------------------------------------------------------------------------
// CLIENTS / FOURNISSEURS
// ---------------------------------------------------------------------------------------------
async function traiterTiers(client, ctx, lignes, rapport, type) {
  const { tenantId, options } = ctx;
  const estClient = type === "clients";
  const table = estClient ? "client_commercial" : "fournisseur";
  const existants = (await client.query(`SELECT id, nom, ninea FROM ${table} WHERE tenant_id = $1${estClient ? " AND est_comptoir = false" : ""}`, [tenantId])).rows;
  const parNinea = new Map(existants.filter((e) => e.ninea).map((e) => [e.ninea.trim().toLowerCase(), e]));
  const parNom = new Map(existants.map((e) => [e.nom.trim().toLowerCase(), e]));
  const vus = new Set();
  rapport.crees = [];

  for (const { ligne, brut } of lignes) {
    const nom = txt(brut.nom, 200);
    if (!nom) { diag(rapport, ligne, "ERREUR", "IMPORT_NOM_REQUIS"); continue; }
    const ninea = txt(brut.ninea, 40);
    const email = txt(brut.email, 160);
    if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) { diag(rapport, ligne, "ERREUR", "IMPORT_EMAIL_INVALIDE", { nom }); continue; }
    let delai = null;
    if (brut.delai_jours !== undefined && brut.delai_jours !== null && brut.delai_jours !== "") {
      const d = nombre(brut.delai_jours);
      if (d === null || Number.isNaN(d) || d < 0 || d > 365) { diag(rapport, ligne, "ERREUR", "IMPORT_DELAI_INVALIDE", { nom }); continue; }
      delai = Math.round(d);
    }
    const cle = ninea ? "n:" + ninea.toLowerCase() : "m:" + nom.toLowerCase();
    if (vus.has(cle)) { diag(rapport, ligne, "IGNORE", "IMPORT_DOUBLON_FICHIER", { nom }); continue; }
    vus.add(cle);
    const existant = (ninea && parNinea.get(ninea.toLowerCase())) || parNom.get(nom.toLowerCase()) || null;
    const adresse = txt(brut.adresse, 300);
    const tel = txt(brut.telephone, 60);

    if (existant) {
      if (options.mettre_a_jour) {
        // complete uniquement les champs vides : ne remplace jamais une donnee saisie dans Baobab
        if (estClient) {
          await client.query(
            `UPDATE client_commercial SET adresse = COALESCE(NULLIF(adresse,''), $3), telephone = COALESCE(NULLIF(telephone,''), $4),
                    email = COALESCE(NULLIF(email,''), $5), ninea = COALESCE(NULLIF(ninea,''), $6) WHERE id = $1 AND tenant_id = $2`,
            [existant.id, tenantId, adresse, tel, email, ninea]
          );
        } else {
          await client.query(
            `UPDATE fournisseur SET adresse = COALESCE(NULLIF(adresse,''), $3), telephone = COALESCE(NULLIF(telephone,''), $4),
                    email = COALESCE(NULLIF(email,''), $5), ninea = COALESCE(NULLIF(ninea,''), $6),
                    pays = COALESCE(NULLIF(pays,''), $7), contact_nom = COALESCE(NULLIF(contact_nom,''), $8) WHERE id = $1 AND tenant_id = $2`,
            [existant.id, tenantId, adresse, tel, email, ninea, txt(brut.pays, 80), txt(brut.contact_nom, 120)]
          );
        }
        diag(rapport, ligne, "MAJ", null, { nom });
      } else {
        diag(rapport, ligne, "IGNORE", "IMPORT_DEJA_PRESENT", { nom });
      }
      continue;
    }
    const lignesEch = echeancier.normaliser(echeancierDefaut(type, options.echeancier_code, delai));
    if (lignesEch.erreur) { diag(rapport, ligne, "ERREUR", "IMPORT_DELAI_INVALIDE", { nom }); continue; }
    const id = uuidv4();
    if (estClient) {
      const exo = booleen(brut.exonere_tva) === true;
      const actif = booleen(brut.actif);
      const r = await client.query(
        `INSERT INTO client_commercial (id, tenant_id, nom, adresse, telephone, email, ninea, echeancier_json, exonere_tva, actif)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [id, tenantId, nom, adresse, tel, email, ninea, JSON.stringify(lignesEch.lignes), exo, actif === null ? true : actif]
      );
      rapport.crees.push(r.rows[0]);
    } else {
      const r = await client.query(
        `INSERT INTO fournisseur (id, tenant_id, nom, pays, adresse, telephone, email, ninea, contact_nom, echeancier_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [id, tenantId, nom, txt(brut.pays, 80), adresse, tel, email, ninea, txt(brut.contact_nom, 120), JSON.stringify(lignesEch.lignes)]
      );
      rapport.crees.push(r.rows[0]);
    }
    parNom.set(nom.toLowerCase(), { id, nom, ninea });
    if (ninea) parNinea.set(ninea.toLowerCase(), { id, nom, ninea });
    diag(rapport, ligne, "CREER", null, { nom });
  }
}

// ---------------------------------------------------------------------------------------------
function normaliserOptions(o = {}) {
  const bool = (v) => v === true || v === "1" || v === 1 || v === "true";
  let dateStock = null;
  if (o.date_stock) {
    dateStock = dateIso(o.date_stock);
    if (!dateStock || Number.isNaN(dateStock)) throw new ImportError("IMPORT_DATE_INVALIDE");
  }
  return { mettre_a_jour: bool(o.mettre_a_jour), date_stock: dateStock, echeancier_code: o.echeancier_code ? String(o.echeancier_code) : null };
}

async function lancer(type, { tenantId, userId, buffer, nomFichier, options: optionsBrutes }, simulation) {
  if (!TYPES.includes(type)) throw new ImportError("IMPORT_TYPE_INVALIDE", 404);
  const options = normaliserOptions(optionsBrutes);
  const { lignes, colonnes } = lireLignes(buffer, type);
  const empreinte = crypto.createHash("sha256").update(buffer).digest("hex");
  const rapport = { type, simulation, ok: true, colonnes, stats: { lus: lignes.length, CREER: 0, MAJ: 0, IGNORE: 0, ERREUR: 0 }, lignes: [], deja_importe: false };
  const client = await db.pool.connect();
  let crees = [];
  try {
    await client.query("BEGIN");
    const deja = await client.query(`SELECT 1 FROM import_donnees_lot WHERE tenant_id = $1 AND type = $2 AND empreinte = $3 LIMIT 1`, [tenantId, type.toUpperCase(), empreinte]);
    rapport.deja_importe = deja.rows.length > 0;
    const ctx = { tenantId, userId, options };
    if (type === "produits") await traiterProduits(client, ctx, lignes, rapport);
    else await traiterTiers(client, ctx, lignes, rapport, type);
    rapport.ok = rapport.stats.ERREUR === 0;
    crees = rapport.crees || [];
    delete rapport.crees;
    if (simulation || !rapport.ok) {
      await client.query("ROLLBACK");
      rapport.importe = false;
    } else {
      await client.query(
        `INSERT INTO import_donnees_lot (id, tenant_id, type, nom_fichier, empreinte, stats_json, cree_par) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uuidv4(), tenantId, type.toUpperCase(), (nomFichier || "").slice(0, 200), empreinte, JSON.stringify(rapport.stats), userId || null]
      );
      await client.query("COMMIT");
      rapport.importe = true;
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  // Comptes tiers comptables (sans jamais faire echouer l'import) : une fois les clients/fournisseurs enregistres.
  if (rapport.importe) {
    for (const c of crees) {
      if (type === "clients") await assurerTiersPourClientSilencieux(tenantId, c);
      else await assurerTiersPourFournisseurSilencieux(tenantId, c);
    }
  }
  // Rapport allege : erreurs d'abord, puis le reste (500 lignes max)
  const ordre = { ERREUR: 0, MAJ: 1, CREER: 2, IGNORE: 3 };
  rapport.lignes.sort((a, b) => ordre[a.statut] - ordre[b.statut] || a.ligne - b.ligne);
  rapport.lignes_tronquees = rapport.lignes.length > 500;
  rapport.lignes = rapport.lignes.slice(0, 500);
  return rapport;
}

const apercu = (type, params) => lancer(type, params, true);
const executer = (type, params) => lancer(type, params, false);

async function historique(tenantId) {
  const r = await db.query(
    `SELECT l.id, l.type, l.nom_fichier, l.stats_json, l.date_creation, u.email AS par FROM import_donnees_lot l
     LEFT JOIN utilisateur u ON u.id = l.cree_par WHERE l.tenant_id = $1 ORDER BY l.date_creation DESC LIMIT 50`,
    [tenantId]
  );
  return r.rows;
}

function modele(type) {
  const wb = XLSX.utils.book_new();
  let rows;
  if (type === "produits") {
    rows = [
      ["Référence", "Désignation", "Unité", "Catégorie", "Coût d'achat (XOF)", "Prix de vente HT (XOF)", "Quantité en stock", "Seuil d'alerte"],
      ["ART-0001", "Ciment CPJ 35 sac de 50 kg", "Sac", "Matériaux", 3800, 4500, 250, 50],
      ["ART-0002", "Fer à béton HA 10", "Barre", "Matériaux", 4200, 5000, 120, 30],
    ];
  } else if (type === "clients") {
    rows = [
      ["Nom", "Adresse", "Téléphone", "Email", "NINEA", "Délai de paiement (jours)", "Exonéré TVA (oui/non)"],
      ["Entreprise Diop & Fils", "Dakar, Médina", "77 000 00 00", "contact@diop.example", "00123456 2G3", 30, "non"],
    ];
  } else if (type === "fournisseurs") {
    rows = [
      ["Nom", "Pays", "Adresse", "Téléphone", "Email", "Contact", "NINEA", "Délai de paiement (jours)"],
      ["Sococim Industries", "Sénégal", "Rufisque", "33 000 00 00", "ventes@sococim.example", "M. Ndiaye", "00654321 2G3", 30],
    ];
  } else throw new ImportError("IMPORT_TYPE_INVALIDE", 404);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = rows[0].map((h) => ({ wch: Math.max(14, String(h).length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, type);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

module.exports = { TYPES, ImportError, apercu, executer, historique, modele };
