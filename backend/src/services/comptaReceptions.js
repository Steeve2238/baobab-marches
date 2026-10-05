/**
 * Comptabilite - Lot 7 : facturation comptable d'une reception de marchandises.
 *
 * Depuis une reception VALIDEE, on cree :
 *   - la facture du FOURNISSEUR (marchandises : une ligne par ligne de reception) ;
 *   - une facture par TRANSITAIRE (couts d'approche rattaches a ce transitaire).
 * Ces factures sont de vraies factures fournisseurs du module comptable
 * (ecriture EN_INSTANCE, a valider par le Directeur Financier). La charge est
 * imputee a la section analytique du dossier (appel d'offres ou consultation)
 * de la commande. Les liens sont ecrits dans la reception
 * (facture_fournisseur_id) et dans chaque cout d'approche : une facture
 * ANNULEE est consideree comme non liee (on peut refacturer).
 */
const compta = require("./comptaService");
const achats = require("./comptaAchats");
const analytique = require("./comptaAnalytique");

const { ComptaError } = compta;

// Compte de charge propose par type de cout d'approche (prefixe SYSCOHADA,
// complete a la longueur des comptes de l'entreprise) ; repli : compte d'achat par defaut.
const COMPTE_PAR_TYPE = {
  FRET: "611",
  TRANSIT: "611",
  TRANSPORT_LOCAL: "611",
  ASSURANCE: "6258",
  DOUANE: null,
  AUTRE: null,
};
// TVA proposee : pas de TVA sur le fret et l'assurance internationaux ni sur les droits de douane.
const TVA_PAR_TYPE_DEFAUT_NULLE = ["FRET", "ASSURANCE", "DOUANE"];

const LIBELLE_TYPE = {
  FRET: "Fret",
  ASSURANCE: "Assurance",
  DOUANE: "Douane",
  TRANSIT: "Transit",
  TRANSPORT_LOCAL: "Transport local",
  AUTRE: "Autre frais",
};

const dateSql = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const aujourdhui = () => new Date().toISOString().slice(0, 10);

function tauxValide(v, defaut) {
  if (v === undefined || v === null || v === "") return defaut;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new ComptaError("COMPTA_FACTURE_FOURNISSEUR_TAUX_INVALIDE", 400);
  return n;
}

async function chargerReception(client, tenantId, id, verrou = false) {
  const r = await client.query(
    `SELECT r.*, f.nom AS fournisseur_nom,
            c.numero AS commande_numero, c.dossier_ao_id, c.consultation_id,
            ff.numero AS facture_numero, ff.statut AS facture_statut
     FROM reception_marchandise r
     JOIN fournisseur f ON f.id = r.fournisseur_id
     LEFT JOIN commande_fournisseur c ON c.id = r.commande_id
     LEFT JOIN facture_fournisseur ff ON ff.id = r.facture_fournisseur_id
     WHERE r.id = $1 AND r.tenant_id = $2 ${verrou ? "FOR UPDATE OF r" : ""}`,
    [id, tenantId]
  );
  if (!r.rows[0]) throw new ComptaError("COMPTA_RECEPTION_INTROUVABLE", 404);
  return r.rows[0];
}

async function sectionDeLaReception(client, tenantId, rec) {
  if (rec.dossier_ao_id) return analytique.sectionPourDossierAo(client, tenantId, rec.dossier_ao_id);
  if (rec.consultation_id) return analytique.sectionPourConsultation(client, tenantId, rec.consultation_id);
  return null;
}

async function tauxTenant(client, tenantId) {
  const r = await client.query(`SELECT taux_tva_pourcentage FROM tenant WHERE id = $1`, [tenantId]);
  const n = Number(r.rows[0]?.taux_tva_pourcentage);
  return Number.isFinite(n) ? n : 18;
}

async function lignesMarchandises(client, receptionId, cours) {
  const r = await client.query(
    `SELECT id, ordre, designation, reference_fournisseur, unite, quantite, prix_unitaire_devise
     FROM reception_ligne WHERE reception_id = $1 ORDER BY ordre`,
    [receptionId]
  );
  return r.rows.map((l) => ({
    id: l.id,
    designation: l.designation,
    reference_fournisseur: l.reference_fournisseur,
    quantite: Number(l.quantite),
    prix_unitaire_devise: Number(l.prix_unitaire_devise),
    montant_c: Math.round(Number(l.quantite) * Number(l.prix_unitaire_devise) * Number(cours) * 100),
  }));
}

async function coutsAvecFacture(client, receptionId, cours) {
  const r = await client.query(
    `SELECT c.*, tr.nom AS transitaire_nom, ff.numero AS facture_numero, ff.statut AS facture_statut
     FROM reception_cout_approche c
     LEFT JOIN transitaire tr ON tr.id = c.transitaire_id
     LEFT JOIN facture_fournisseur ff ON ff.id = c.facture_fournisseur_id
     WHERE c.reception_id = $1 ORDER BY c.ordre`,
    [receptionId]
  );
  return r.rows.map((c) => {
    const facture = c.facture_fournisseur_id && c.facture_statut === "ENREGISTREE";
    return {
      id: c.id,
      type_cout: c.type_cout,
      libelle: c.libelle,
      transitaire_id: c.transitaire_id,
      transitaire_nom: c.transitaire_nom,
      montant_c: Math.round(Number(c.montant) * (c.en_devise_facture ? Number(cours) : 1) * 100),
      facture_id: facture ? c.facture_fournisseur_id : null,
      facture_numero: facture ? c.facture_numero : null,
    };
  });
}

/** Etat de la facturation comptable d'une reception (lecture seule). */
async function apercuFacturation(client, tenantId, receptionId) {
  const parametre = await compta.getParametre(client, tenantId);
  if (!parametre || !parametre.initialisee) return { disponible: false };
  const rec = await chargerReception(client, tenantId, receptionId);
  const cours = Number(rec.cours_devise) || 1;
  const tvaTenant = await tauxTenant(client, tenantId);
  const lignes = await lignesMarchandises(client, rec.id, cours);
  const totalMarchandises = lignes.reduce((s, l) => s + l.montant_c, 0);
  const factureOk = rec.facture_fournisseur_id && rec.facture_statut === "ENREGISTREE";
  const couts = await coutsAvecFacture(client, rec.id, cours);

  const groupes = new Map();
  const sansTransitaire = [];
  for (const c of couts) {
    const vue = {
      ...c,
      montant: c.montant_c / 100,
      taux_tva_defaut: TVA_PAR_TYPE_DEFAUT_NULLE.includes(c.type_cout) ? 0 : tvaTenant,
    };
    delete vue.montant_c;
    if (!c.transitaire_id) {
      sansTransitaire.push(vue);
      continue;
    }
    if (!groupes.has(c.transitaire_id)) groupes.set(c.transitaire_id, { transitaire_id: c.transitaire_id, transitaire_nom: c.transitaire_nom, couts: [] });
    groupes.get(c.transitaire_id).couts.push(vue);
  }
  const transitaires = [...groupes.values()].map((g) => ({
    ...g,
    a_facturer: g.couts.filter((c) => !c.facture_id && c.montant > 0).length,
    total_a_facturer: g.couts.filter((c) => !c.facture_id).reduce((s, c) => s + c.montant, 0),
  }));

  return {
    disponible: true,
    reception_id: rec.id,
    numero: rec.numero,
    statut: rec.statut,
    peut_facturer: rec.statut === "VALIDEE",
    devise: rec.devise,
    cours_devise: cours,
    fournisseur_nom: rec.fournisseur_nom,
    reference_facture: rec.reference_facture,
    date_facture: dateSql(rec.date_facture),
    commande_numero: rec.commande_numero,
    analytique_dossier: !!(rec.dossier_ao_id || rec.consultation_id),
    marchandises: {
      facture_id: factureOk ? rec.facture_fournisseur_id : null,
      facture_numero: factureOk ? rec.facture_numero : null,
      total_ht: totalMarchandises / 100,
      nb_lignes: lignes.length,
      taux_tva_defaut: rec.devise && rec.devise !== "XOF" ? 0 : tvaTenant,
    },
    transitaires,
    couts_sans_transitaire: sansTransitaire,
  };
}

/** Facture du fournisseur (marchandises) pour une reception validee. */
async function creerFactureFournisseurReception(client, tenantId, utilisateurId, receptionId, data = {}) {
  const parametre = await compta.exigerInitialise(client, tenantId);
  const rec = await chargerReception(client, tenantId, receptionId, true);
  if (rec.statut !== "VALIDEE") throw new ComptaError("COMPTA_RECEPTION_NON_VALIDEE", 409);
  if (rec.facture_fournisseur_id && rec.facture_statut === "ENREGISTREE") {
    throw new ComptaError("COMPTA_RECEPTION_DEJA_FACTUREE", 409, { libelle: rec.facture_numero });
  }
  const cours = Number(rec.cours_devise) || 1;
  const lignes = (await lignesMarchandises(client, rec.id, cours)).filter((l) => l.montant_c > 0);
  if (lignes.length === 0) throw new ComptaError("COMPTA_RECEPTION_RIEN_A_FACTURER", 409);

  const tvaDefaut = rec.devise && rec.devise !== "XOF" ? 0 : await tauxTenant(client, tenantId);
  const taux = tauxValide(data.taux_tva, tvaDefaut);
  const sectionId = await sectionDeLaReception(client, tenantId, rec);
  const tiers = await compta.assurerTiersFournisseur(client, tenantId, { id: rec.fournisseur_id, nom: rec.fournisseur_nom });
  const reference = String(data.reference_fournisseur || rec.reference_facture || "").trim();
  const dateFacture = data.date_facture || dateSql(rec.date_facture) || dateSql(rec.date_reception) || aujourdhui();

  const facture = await achats.creerFactureFournisseur(client, tenantId, utilisateurId, {
    tiers_id: tiers.id,
    reference_fournisseur: reference,
    date_facture: dateFacture,
    date_echeance: data.date_echeance || undefined,
    libelle: `Réception ${rec.numero}${rec.commande_numero ? ` (commande ${rec.commande_numero})` : ""}`,
    lignes: lignes.map((l) => ({
      libelle: l.designation,
      montant_ht: l.montant_c / 100,
      taux_tva: taux,
      compte_numero: parametre.compte_achat_defaut,
      section_id: sectionId || undefined,
    })),
  });
  await client.query(`UPDATE reception_marchandise SET facture_fournisseur_id = $2 WHERE id = $1`, [rec.id, facture.id]);
  return facture;
}

async function numeroCompteExistant(client, tenantId, parametre, prefixe) {
  if (!prefixe) return parametre.compte_achat_defaut;
  const numero = String(prefixe).padEnd(parametre.longueur_compte || 8, "0");
  const r = await client.query(`SELECT 1 FROM compte_comptable WHERE tenant_id = $1 AND numero = $2 AND actif = true`, [tenantId, numero]);
  return r.rows.length ? numero : parametre.compte_achat_defaut;
}

/** Facture d'un transitaire pour les couts d'approche de la reception qui lui sont rattaches. */
async function creerFactureTransitaireReception(client, tenantId, utilisateurId, receptionId, data = {}) {
  const parametre = await compta.exigerInitialise(client, tenantId);
  const rec = await chargerReception(client, tenantId, receptionId, true);
  if (rec.statut !== "VALIDEE") throw new ComptaError("COMPTA_RECEPTION_NON_VALIDEE", 409);
  if (!data.transitaire_id) throw new ComptaError("COMPTA_RECEPTION_TRANSITAIRE_REQUIS", 400);
  const tr = await client.query(`SELECT id, nom FROM transitaire WHERE id = $1 AND tenant_id = $2`, [data.transitaire_id, tenantId]);
  if (!tr.rows[0]) throw new ComptaError("COMPTA_RECEPTION_TRANSITAIRE_INTROUVABLE", 404);

  const cours = Number(rec.cours_devise) || 1;
  const tvaTenant = await tauxTenant(client, tenantId);
  const couts = (await coutsAvecFacture(client, rec.id, cours)).filter((c) => c.transitaire_id === tr.rows[0].id && !c.facture_id && c.montant_c > 0);
  if (couts.length === 0) throw new ComptaError("COMPTA_RECEPTION_RIEN_A_FACTURER", 409);

  const sectionId = await sectionDeLaReception(client, tenantId, rec);
  const tiers = await compta.assurerTiersTransitaire(client, tenantId, tr.rows[0]);
  const tauxParCout = data.taux && typeof data.taux === "object" ? data.taux : {};
  const lignes = [];
  for (const c of couts) {
    const defaut = TVA_PAR_TYPE_DEFAUT_NULLE.includes(c.type_cout) ? 0 : tvaTenant;
    const global = data.taux_tva === undefined || data.taux_tva === null || data.taux_tva === "" ? defaut : data.taux_tva;
    lignes.push({
      libelle: c.libelle ? `${LIBELLE_TYPE[c.type_cout] || c.type_cout} - ${c.libelle}` : `${LIBELLE_TYPE[c.type_cout] || c.type_cout} - ${rec.numero}`,
      montant_ht: c.montant_c / 100,
      taux_tva: tauxValide(tauxParCout[c.id], tauxValide(global, defaut)),
      compte_numero: await numeroCompteExistant(client, tenantId, parametre, COMPTE_PAR_TYPE[c.type_cout]),
      section_id: sectionId || undefined,
    });
  }
  const dateFacture = data.date_facture || dateSql(rec.date_reception) || aujourdhui();
  const facture = await achats.creerFactureFournisseur(client, tenantId, utilisateurId, {
    tiers_id: tiers.id,
    reference_fournisseur: String(data.reference_fournisseur || "").trim(),
    date_facture: dateFacture,
    date_echeance: data.date_echeance || undefined,
    libelle: `Frais d'approche - réception ${rec.numero}`,
    lignes,
  });
  await client.query(`UPDATE reception_cout_approche SET facture_fournisseur_id = $2 WHERE id = ANY($1::uuid[])`, [couts.map((c) => c.id), facture.id]);
  return facture;
}

module.exports = { apercuFacturation, creerFactureFournisseurReception, creerFactureTransitaireReception };
