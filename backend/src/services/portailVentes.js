/**
 * Portail de remise tracee : documents des entreprises clientes (factures et devis envoyes a leurs propres clients).
 * Charge le document complet, fige l'en-tete de l'entreprise et calcule les contacts du client pour pre-remplir l'envoi.
 */
const db = require("../db");

class VenteDocError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const COLONNES_ENTETE = `raison_sociale, adresse, telephone, email, signataire_nom, signataire_titre, rccm, ninea, site_web, coordonnees_bancaires,
  logo_base64, logo_type_mime, signature_cachet_base64, signature_cachet_type_mime`;

async function enteteTenant(tenantId) {
  const r = await db.query(`SELECT ${COLONNES_ENTETE} FROM tenant WHERE id = $1`, [tenantId]);
  if (!r.rows[0]) throw new VenteDocError("PORTAIL_INTROUVABLE", 404);
  return r.rows[0];
}

/** Facture ou devis du tenant, avec ses lignes et les informations du client (meme contenu que l'ecran d'impression). */
async function chargerDocumentVente(type, id, tenantId) {
  if (type === "BON_LIVRAISON") return chargerBonLivraison(id, tenantId);
  if (type === "AVOIR") return chargerAvoir(id, tenantId);
  if (type === "COMMANDE_FOURNISSEUR") return chargerCommandeFournisseur(id, tenantId);
  const table = type === "FACTURE" ? "facture_vente" : "devis";
  const lignesSql = type === "FACTURE"
    ? `SELECT id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht, non_chiffre, mention_prix, reference FROM facture_vente_ligne WHERE facture_vente_id = $1 ORDER BY ordre ASC`
    : `SELECT id, ordre, designation, unite, quantite, prix_unitaire_ht, montant_ht, non_chiffre, mention_prix, reference FROM devis_ligne WHERE devis_id = $1 ORDER BY ordre ASC`;
  let r;
  try {
    r = await db.query(
      `SELECT d.*, cl.nom AS client_nom, cl.adresse AS client_adresse, cl.email AS client_email, cl.telephone AS client_telephone,
              cl.exonere_tva AS client_exonere_tva, cl.motif_exoneration_tva AS client_motif_exoneration_tva
       FROM ${table} d JOIN client_commercial cl ON cl.id = d.client_commercial_id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [id, tenantId]
    );
  } catch (e) {
    if (e && e.code === "22P02") throw new VenteDocError("PORTAIL_DOCUMENT_INTROUVABLE", 404);
    throw e;
  }
  const d = r.rows[0];
  if (!d) throw new VenteDocError("PORTAIL_DOCUMENT_INTROUVABLE", 404);
  const lignes = (await db.query(lignesSql, [id])).rows;
  const { client_email, client_telephone, ...document } = d;
  const numero = type === "FACTURE" ? require("./ventesPdf").numeroFacture(d.numero, d.mois_emission) : d.numero;
  return {
    document: { ...document, lignes },
    params: await enteteTenant(tenantId),
    numero,
    contact: { nom: d.client_nom, email: client_email || "", telephone: client_telephone || "" },
  };
}


/** Bon de livraison du tenant (lignes livrees, client, facture d'origine, Incoterm de la facture). */
async function chargerBonLivraison(id, tenantId) {
  let r;
  try {
    r = await db.query(
      `SELECT bl.*, cl.nom AS client_nom, cl.adresse AS client_adresse, cl.email AS client_email, cl.telephone AS client_telephone,
              f.numero AS facture_numero, f.incoterm, f.incoterm_lieu
       FROM bon_livraison bl JOIN client_commercial cl ON cl.id = bl.client_commercial_id JOIN facture_vente f ON f.id = bl.facture_vente_id
       WHERE bl.id = $1 AND bl.tenant_id = $2`,
      [id, tenantId]
    );
  } catch (e) {
    if (e && e.code === "22P02") throw new VenteDocError("PORTAIL_DOCUMENT_INTROUVABLE", 404);
    throw e;
  }
  const bl = r.rows[0];
  if (!bl) throw new VenteDocError("PORTAIL_DOCUMENT_INTROUVABLE", 404);
  const lignes = (await db.query(`SELECT id, ordre, designation, unite, quantite_livree, reference FROM bon_livraison_ligne WHERE bon_livraison_id = $1 ORDER BY ordre ASC`, [id])).rows;
  const { client_email, client_telephone, ...document } = bl;
  const { numeroFacture } = require("./ventesPdf");
  const numero = `BL-${numeroFacture(bl.numero, bl.mois_emission)}${Number(bl.rang) > 1 ? `/${bl.rang}` : ""}`;
  return { document: { ...document, lignes, numero_complet: numero }, params: await enteteTenant(tenantId), numero, contact: { nom: bl.client_nom, email: client_email || "", telephone: client_telephone || "" } };
}

/** Avoir client du tenant (meme contenu que l'ecran d'impression). */
async function chargerAvoir(id, tenantId) {
  const avoirs = require("./avoirs");
  let a;
  try {
    a = await avoirs.detail(tenantId, id);
  } catch (e) {
    if (e && e.status === 404) throw new VenteDocError("PORTAIL_DOCUMENT_INTROUVABLE", 404);
    if (e && e.code === "22P02") throw new VenteDocError("PORTAIL_DOCUMENT_INTROUVABLE", 404);
    throw e;
  }
  const { client_email, client_telephone, ecritures, ...document } = a;
  return { document, params: await enteteTenant(tenantId), numero: a.numero, contact: { nom: a.client_nom, email: client_email || "", telephone: client_telephone || "" } };
}

/** Commande fournisseur du tenant, envoyee au FOURNISSEUR (contact = fournisseur) pour acceptation du bon de commande. */
async function chargerCommandeFournisseur(id, tenantId) {
  let r;
  try {
    r = await db.query(
      `SELECT c.*, f.nom AS fournisseur_nom, f.pays AS fournisseur_pays, f.adresse AS fournisseur_adresse, f.email AS fournisseur_email,
              f.telephone AS fournisseur_telephone, f.contact_nom AS fournisseur_contact, tr.nom AS transitaire_nom
       FROM commande_fournisseur c JOIN fournisseur f ON f.id = c.fournisseur_id LEFT JOIN transitaire tr ON tr.id = c.transitaire_id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [id, tenantId]
    );
  } catch (e) {
    if (e && e.code === "22P02") throw new VenteDocError("PORTAIL_DOCUMENT_INTROUVABLE", 404);
    throw e;
  }
  const c = r.rows[0];
  if (!c) throw new VenteDocError("PORTAIL_DOCUMENT_INTROUVABLE", 404);
  const lignes = (await db.query(`SELECT id, ordre, reference_fournisseur, designation, unite, quantite, prix_unitaire_devise FROM commande_fournisseur_ligne WHERE commande_id = $1 ORDER BY ordre ASC`, [id])).rows
    .map((l) => ({ ...l, quantite: Number(l.quantite), prix_unitaire_devise: Number(l.prix_unitaire_devise) }));
  const totalDevise = Math.round(lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_devise, 0) * 100) / 100;
  const cours = Number(c.cours_devise) || 1;
  const { fournisseur_email, fournisseur_telephone, ...document } = c;
  return {
    document: { ...document, fournisseur_email, fournisseur_telephone, cours_devise: cours, lignes, total_devise: totalDevise, total_xof: Math.round(totalDevise * cours * 100) / 100 },
    params: await enteteTenant(tenantId),
    numero: c.numero,
    contact: { nom: c.fournisseur_contact || c.fournisseur_nom, email: fournisseur_email || "", telephone: fournisseur_telephone || "" },
  };
}

/** Controle du statut : une facture annulee, un devis refuse ou expire ne se partagent pas. */
function verifierPartageable(type, document) {
  if (type === "FACTURE" && document.statut === "ANNULEE") throw new VenteDocError("PORTAIL_DOCUMENT_NON_PARTAGEABLE", 409);
  if (type === "DEVIS" && ["REFUSE", "EXPIRE"].includes(document.statut)) throw new VenteDocError("PORTAIL_DOCUMENT_NON_PARTAGEABLE", 409);
  if (type === "COMMANDE_FOURNISSEUR") {
    if (document.statut === "ANNULEE") throw new VenteDocError("PORTAIL_DOCUMENT_NON_PARTAGEABLE", 409);
    if (document.statut !== "CONFIRMEE") throw new VenteDocError("PORTAIL_COMMANDE_A_CONFIRMER", 409);
  }
}

/** Un devis brouillon passe a « envoye » (les autres statuts ne bougent pas). */
async function marquerDevisEnvoye(id, tenantId) {
  await db.query(`UPDATE devis SET statut = 'ENVOYE' WHERE id = $1 AND tenant_id = $2 AND statut = 'BROUILLON'`, [id, tenantId]);
}

async function utilisateurEmail(userId) {
  if (!userId) return null;
  const r = await db.query(`SELECT email FROM utilisateur WHERE id = $1`, [userId]);
  return (r.rows[0] && r.rows[0].email) || null;
}

/**
 * Facture d'abonnement, d'installation ou de licence emise par l'editeur (Super Admin) a une entreprise cliente.
 * Meme contenu que l'ecran d'impression ; numero = periode (c'est l'identifiant affiche a l'ecran).
 */
async function chargerFactureAbonnement(id) {
  const r = await db.query(
    `SELECT f.id, f.tenant_id, f.formule_nom, f.periode, f.montant_xof, f.plafond_utilisateurs_facture, f.supplement_comptabilite_xof,
            f.supplement_fiscalite_xof, f.supplement_paie_xof, f.type_facture, f.statut, f.date_generation, f.date_paiement, f.mode_paiement,
            te.raison_sociale AS client_nom, te.adresse AS client_adresse
     FROM facture_abonnement f JOIN tenant te ON te.id = f.tenant_id WHERE f.id = $1`,
    [id]
  );
  if (!r.rows[0]) throw new VenteDocError("PORTAIL_DOCUMENT_INTROUVABLE", 404);
  const f = r.rows[0];
  return { ...f, numero: f.periode, date_generation: f.date_generation && new Date(f.date_generation).toISOString() };
}

/** Contact a pre-remplir : coordonnees de l'entreprise, a defaut l'e-mail du destinataire de sa derniere offre. */
async function contactEntrepriseCliente(tenantId) {
  const t = (await db.query(`SELECT raison_sociale, email, telephone FROM tenant WHERE id = $1`, [tenantId])).rows[0] || {};
  let email = t.email || null;
  let nom = null;
  if (!email) {
    const o = (await db.query(`SELECT destinataire_email, representant_nom FROM offre_commerciale WHERE tenant_id = $1 AND destinataire_email IS NOT NULL ORDER BY date_creation DESC LIMIT 1`, [tenantId])).rows[0];
    if (o) {
      email = o.destinataire_email;
      nom = o.representant_nom || null;
    }
  }
  return { email: email || "", telephone: t.telephone || "", nom: nom || "" };
}

module.exports = { VenteDocError, chargerDocumentVente, verifierPartageable, marquerDevisEnvoye, utilisateurEmail, enteteTenant, chargerFactureAbonnement, contactEntrepriseCliente };
