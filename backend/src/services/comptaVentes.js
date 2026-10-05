/**
 * Ecritures comptables automatiques des ventes (chantier E, phase 2).
 *
 * Chaque piece commerciale genere UNE ecriture au statut EN_INSTANCE (jamais
 * validee automatiquement : le comptable / Directeur Financier la controle, peut
 * changer le compte de vente ou de tresorerie, puis la valide - voir
 * complement_04102026_decisions_compta_ecritures_en_instance.md) :
 *
 *   FACTURE INTEGRALE   Dr 411 (client, TTC)            Cr 70x (une ligne par produit, HT net de remise)
 *                                                       Cr 4431 (TVA)
 *   FACTURE D'ACOMPTE   Dr 411 (net a payer)            Cr 4191 (part HT)   Cr 4431 (part TVA)
 *   FACTURE DE SOLDE    Dr 411 (net a payer)            Cr 70x (HT net total) Cr 4431 (TVA restante)
 *                       Dr 4191 (HT des acomptes factures : regularisation)
 *   ENCAISSEMENT        Dr 52x banque / 57x caisse      Cr 411 (client)
 *   ANNULATION          ecriture en instance : supprimee ; ecriture deja validee : ecriture
 *                       inverse creee en instance (a valider), l'originale est marquee extournee.
 *
 * L'idempotence repose sur l'index unique (tenant, origine, origine_id,
 * origine_role) : une piece n'est jamais comptabilisee deux fois.
 *
 * Les fonctions "…Silencieux" sont appelees depuis les routes de ventes : elles
 * ne font JAMAIS echouer l'operation commerciale (l'erreur est journalisee et
 * la piece sera reprise par le "rattrapage").
 */
const { v4: uuidv4 } = require("uuid");
const compta = require("./comptaService");

const { versCentimes, centimesVersDecimal } = compta;

const ORIGINE = "FACTURE_VENTE";

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const dateSql = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/** Compte de vente a utiliser pour une ligne : regle designation, puis regle client, puis compte par defaut. */
async function compteDeVente(client, tenantId, parametre, clientCommercialId, designation) {
  const r = await client.query(
    `SELECT critere, compte_numero FROM compta_regle_compte_vente
     WHERE tenant_id = $1 AND ((critere = 'DESIGNATION' AND valeur = $2) OR (critere = 'CLIENT' AND valeur = $3))`,
    [tenantId, String(designation || "").trim().toLowerCase(), String(clientCommercialId)]
  );
  const parDesignation = r.rows.find((x) => x.critere === "DESIGNATION");
  const parClient = r.rows.find((x) => x.critere === "CLIENT");
  const numero = (parDesignation || parClient || {}).compte_numero || parametre.compte_vente_defaut;
  const c = await client.query(`SELECT id FROM compte_comptable WHERE tenant_id = $1 AND numero = $2 AND actif = true`, [tenantId, numero]);
  if (c.rows[0]) return { id: c.rows[0].id, numero };
  // Regle obsolete (compte desactive) : on retombe sur le compte par defaut.
  const d = await client.query(`SELECT id FROM compte_comptable WHERE tenant_id = $1 AND numero = $2`, [tenantId, parametre.compte_vente_defaut]);
  return { id: d.rows[0]?.id, numero: parametre.compte_vente_defaut };
}

async function idCompte(client, tenantId, numero) {
  const r = await client.query(`SELECT id FROM compte_comptable WHERE tenant_id = $1 AND numero = $2`, [tenantId, numero]);
  if (!r.rows[0]) throw new compta.ComptaError("COMPTA_COMPTE_INTROUVABLE", 400, { numero });
  return r.rows[0].id;
}

async function premierJournal(client, tenantId, type) {
  const r = await client.query(
    `SELECT * FROM journal_comptable WHERE tenant_id = $1 AND type_journal = $2 AND actif = true ORDER BY code LIMIT 1`,
    [tenantId, type]
  );
  return r.rows[0] || null;
}

async function ecritureExistante(client, tenantId, factureId, role) {
  const r = await client.query(
    `SELECT * FROM ecriture_comptable WHERE tenant_id = $1 AND origine = $2 AND origine_id = $3 AND origine_role = $4`,
    [tenantId, ORIGINE, factureId, role]
  );
  return r.rows[0] || null;
}

/** Repartit `total` (centimes) au prorata de `poids`, le reliquat d'arrondi allant a la derniere ligne. */
function repartir(total, poids) {
  const somme = poids.reduce((a, b) => a + b, 0);
  if (poids.length === 0) return [];
  if (somme === 0) return poids.map((_, i) => (i === poids.length - 1 ? total : 0));
  const parts = poids.map((p) => Math.round((total * p) / somme));
  const ecart = total - parts.reduce((a, b) => a + b, 0);
  parts[parts.length - 1] += ecart;
  return parts;
}

/** Part HT / TVA d'un montant TTC facture partiellement (acompte) au prorata du devis. */
function ventilerAcompte(netC, htNetC, ttcC) {
  const ht = ttcC === 0 ? netC : Math.round((netC * htNetC) / ttcC);
  return { ht, tva: netC - ht };
}

function echeanceFacture(facture, tiers) {
  if (facture.date_echeance) return dateSql(facture.date_echeance);
  const d = new Date(`${dateSql(facture.date_facture)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (tiers?.delai_reglement_jours ?? 30));
  return d.toISOString().slice(0, 10);
}

async function chargerFacture(client, tenantId, factureId) {
  const r = await client.query(
    `SELECT f.*, c.nom AS client_nom FROM facture_vente f
     JOIN client_commercial c ON c.id = f.client_commercial_id
     WHERE f.id = $1 AND f.tenant_id = $2`,
    [factureId, tenantId]
  );
  return r.rows[0] || null;
}

/**
 * Genere l'ecriture EN_INSTANCE d'une facture de vente. Retourne
 * { statut: 'CREEE' | 'EXISTANTE' | 'IGNOREE', ecriture?, raison? }.
 */
async function genererEcritureFacture(client, tenantId, utilisateurId, factureId) {
  const parametre = await compta.getParametre(client, tenantId);
  if (!parametre || !parametre.initialisee) return { statut: "IGNOREE", raison: "NON_INITIALISEE" };
  const facture = await chargerFacture(client, tenantId, factureId);
  if (!facture) return { statut: "IGNOREE", raison: "FACTURE_INTROUVABLE" };
  if (facture.statut === "ANNULEE") return { statut: "IGNOREE", raison: "ANNULEE" };

  const existante = await ecritureExistante(client, tenantId, factureId, "FACTURE");
  if (existante) return { statut: "EXISTANTE", ecriture: existante };

  const date = dateSql(facture.date_facture);
  const exercice = await compta.exerciceDeLaDate(client, tenantId, date);
  if (!exercice) return { statut: "IGNOREE", raison: "HORS_EXERCICE" };
  if (exercice.statut === "CLOTURE") return { statut: "IGNOREE", raison: "EXERCICE_CLOTURE" };
  const journal = await premierJournal(client, tenantId, "VENTES");
  if (!journal) return { statut: "IGNOREE", raison: "JOURNAL_ABSENT" };

  const tiers = await compta.assurerTiersClient(client, tenantId, { id: facture.client_commercial_id, nom: facture.client_nom });
  const idClient = await idCompte(client, tenantId, tiers.compte_collectif);
  const idTva = await idCompte(client, tenantId, parametre.compte_tva_collectee);

  const netC = versCentimes(facture.montant_net_a_payer);
  const ttcC = versCentimes(facture.total_ttc);
  const htNetC = versCentimes(facture.total_ht) - versCentimes(facture.montant_remise);
  const echeance = echeanceFacture(facture, tiers);

  const lignes = [{ compte_id: idClient, tiers_id: tiers.id, libelle: `Facture ${facture.numero}`, debit_c: netC, credit_c: 0, date_echeance: echeance }];
  let libelle = `Facture ${facture.numero} - ${facture.client_nom}`;

  if (facture.type_facturation === "ACOMPTE") {
    const { ht, tva } = ventilerAcompte(netC, htNetC, ttcC);
    const idAcompte = await idCompte(client, tenantId, parametre.compte_acompte_client);
    libelle += ` (acompte ${Number(facture.pourcentage_acompte)} %)`;
    lignes.push({ compte_id: idAcompte, tiers_id: tiers.id, libelle: `Acompte ${facture.numero}`, debit_c: 0, credit_c: ht, date_echeance: null });
    if (tva !== 0) lignes.push({ compte_id: idTva, tiers_id: null, libelle: `TVA ${facture.numero}`, debit_c: 0, credit_c: tva, date_echeance: null });
  } else {
    // INTEGRALE ou SOLDE : le chiffre d'affaires est constate, ligne par ligne.
    let htAcomptesC = 0;
    if (facture.type_facturation === "SOLDE") {
      libelle += " (solde)";
      const precedentes = await client.query(
        `SELECT montant_net_a_payer FROM facture_vente
         WHERE tenant_id = $1 AND devis_id = $2 AND id <> $3 AND type_facturation = 'ACOMPTE' AND statut <> 'ANNULEE'`,
        [tenantId, facture.devis_id, facture.id]
      );
      for (const p of precedentes.rows) {
        const v = ventilerAcompte(versCentimes(p.montant_net_a_payer), htNetC, ttcC);
        htAcomptesC += v.ht;
      }
    }
    const lignesFacture = await client.query(
      `SELECT designation, montant_ht FROM facture_vente_ligne WHERE facture_vente_id = $1 ORDER BY ordre`,
      [facture.id]
    );
    const produits = lignesFacture.rows.length > 0 ? lignesFacture.rows : [{ designation: `Facture ${facture.numero}`, montant_ht: facture.total_ht }];
    const montants = repartir(htNetC, produits.map((p) => Math.max(versCentimes(p.montant_ht), 0)));
    produits.forEach((p, i) => {
      if (montants[i] === 0) return;
      lignes.push({ designation: p.designation, produit: true, montant: montants[i] });
    });
    // Resolution des comptes de vente (regles memorisees) pour les lignes produit
    for (let i = 0; i < lignes.length; i++) {
      if (!lignes[i].produit) continue;
      const cv = await compteDeVente(client, tenantId, parametre, facture.client_commercial_id, lignes[i].designation);
      lignes[i] = { compte_id: cv.id, tiers_id: null, libelle: lignes[i].designation, debit_c: 0, credit_c: lignes[i].montant, date_echeance: null, compte_modifiable: "PRODUIT" };
    }
    if (htAcomptesC > 0) {
      const idAcompte = await idCompte(client, tenantId, parametre.compte_acompte_client);
      lignes.push({ compte_id: idAcompte, tiers_id: tiers.id, libelle: `Regularisation acomptes ${facture.numero}`, debit_c: htAcomptesC, credit_c: 0, date_echeance: null });
    }
    // La TVA est la ligne d'equilibre : TVA totale moins la TVA deja constatee sur les acomptes.
    const debits = lignes.reduce((a, l) => a + l.debit_c, 0);
    const credits = lignes.reduce((a, l) => a + l.credit_c, 0);
    const tva = debits - credits;
    if (tva !== 0) {
      lignes.push({ compte_id: idTva, tiers_id: null, libelle: `TVA ${facture.numero}`, debit_c: tva < 0 ? -tva : 0, credit_c: tva > 0 ? tva : 0, date_echeance: null });
    }
  }

  const ecriture = await client.query(
    `INSERT INTO ecriture_comptable
       (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'EN_INSTANCE', $8, $9, 'FACTURE', $10) RETURNING *`,
    [uuidv4(), tenantId, exercice.id, journal.id, facture.numero, date, libelle, ORIGINE, facture.id, utilisateurId || null]
  );
  await compta.insererLignes(client, tenantId, ecriture.rows[0].id, lignes);
  return { statut: "CREEE", ecriture: ecriture.rows[0] };
}

const estEspeces = (mode) => /esp|cash|caisse|liquide/i.test(String(mode || ""));

/** Genere l'ecriture d'encaissement (banque ou caisse selon le mode de paiement) d'une facture payee. */
async function genererEcritureEncaissement(client, tenantId, utilisateurId, factureId) {
  const parametre = await compta.getParametre(client, tenantId);
  if (!parametre || !parametre.initialisee) return { statut: "IGNOREE", raison: "NON_INITIALISEE" };
  const facture = await chargerFacture(client, tenantId, factureId);
  if (!facture || facture.statut !== "PAYEE") return { statut: "IGNOREE", raison: "NON_PAYEE" };
  const existante = await ecritureExistante(client, tenantId, factureId, "ENCAISSEMENT");
  if (existante) return { statut: "EXISTANTE", ecriture: existante };

  const date = facture.date_paiement ? dateSql(facture.date_paiement) : aujourdhui();
  const exercice = await compta.exerciceDeLaDate(client, tenantId, date);
  if (!exercice) return { statut: "IGNOREE", raison: "HORS_EXERCICE" };
  if (exercice.statut === "CLOTURE") return { statut: "IGNOREE", raison: "EXERCICE_CLOTURE" };

  const especes = estEspeces(facture.mode_paiement);
  const journal = (await premierJournal(client, tenantId, especes ? "CAISSE" : "BANQUE")) || (await premierJournal(client, tenantId, especes ? "BANQUE" : "CAISSE"));
  if (!journal) return { statut: "IGNOREE", raison: "JOURNAL_ABSENT" };
  const numeroTreso = journal.compte_tresorerie || compta.completerNumero(especes ? "5711" : "5211", parametre.longueur_compte);

  const tiers = await compta.assurerTiersClient(client, tenantId, { id: facture.client_commercial_id, nom: facture.client_nom });
  // Encaissements deja saisis dans la comptabilite (reglements clients partiels) : seul le reste est encaisse ici.
  const netC = versCentimes(facture.montant_net_a_payer) - versCentimes(facture.montant_encaisse);
  if (netC <= 0) return { statut: "IGNOREE", raison: "DEJA_ENCAISSEE" };
  const lignes = [
    { compte_id: await idCompte(client, tenantId, numeroTreso), tiers_id: null, libelle: `Encaissement facture ${facture.numero}`, debit_c: netC, credit_c: 0, date_echeance: null, compte_modifiable: "TRESORERIE" },
    { compte_id: await idCompte(client, tenantId, tiers.compte_collectif), tiers_id: tiers.id, libelle: `Reglement facture ${facture.numero}`, debit_c: 0, credit_c: netC, date_echeance: null },
  ];
  const ecriture = await client.query(
    `INSERT INTO ecriture_comptable
       (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'EN_INSTANCE', $8, $9, 'ENCAISSEMENT', $10) RETURNING *`,
    [uuidv4(), tenantId, exercice.id, journal.id, facture.numero, date, `Encaissement facture ${facture.numero} - ${facture.client_nom}`, ORIGINE, facture.id, utilisateurId || null]
  );
  await compta.insererLignes(client, tenantId, ecriture.rows[0].id, lignes);
  return { statut: "CREEE", ecriture: ecriture.rows[0] };
}

/**
 * Annulation d'une facture : une ecriture encore en instance est supprimee
 * (rien n'avait ete valide) ; une ecriture deja validee est contre-passee par
 * une ecriture inverse EN_INSTANCE (a valider), l'originale etant marquee
 * extournee pour empecher une seconde extourne manuelle.
 */
async function genererAnnulationFacture(client, tenantId, utilisateurId, factureId) {
  const parametre = await compta.getParametre(client, tenantId);
  if (!parametre || !parametre.initialisee) return { statut: "IGNOREE", raison: "NON_INITIALISEE" };
  const ecritures = await client.query(
    `SELECT * FROM ecriture_comptable WHERE tenant_id = $1 AND origine = $2 AND origine_id = $3 AND origine_role IN ('FACTURE', 'ENCAISSEMENT') FOR UPDATE`,
    [tenantId, ORIGINE, factureId]
  );
  const resultat = { statut: "OK", supprimees: 0, extournees: 0, ignorees: [] };
  for (const e of ecritures.rows) {
    if (e.statut !== "VALIDEE") {
      await client.query(`DELETE FROM ligne_ecriture WHERE ecriture_id = $1`, [e.id]);
      await client.query(`DELETE FROM ecriture_comptable WHERE id = $1`, [e.id]);
      resultat.supprimees++;
      continue;
    }
    if (e.extournee_par_id) continue;
    const date = aujourdhui();
    const exercice = await compta.exerciceDeLaDate(client, tenantId, date);
    if (!exercice || exercice.statut === "CLOTURE") {
      resultat.ignorees.push({ ecriture_id: e.id, raison: !exercice ? "HORS_EXERCICE" : "EXERCICE_CLOTURE" });
      continue;
    }
    const inverse = await client.query(
      `INSERT INTO ecriture_comptable
         (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, extourne_de_id, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'EN_INSTANCE', $8, $9, $10, $11, $12) RETURNING *`,
      [
        uuidv4(), tenantId, exercice.id, e.journal_id, e.numero_piece, date, `Annulation : ${e.libelle}`,
        ORIGINE, factureId, e.origine_role === "FACTURE" ? "ANNULATION" : "ANNULATION_ENCAISSEMENT", e.id, utilisateurId || null,
      ]
    );
    const lignes = await client.query(`SELECT * FROM ligne_ecriture WHERE ecriture_id = $1 ORDER BY ordre`, [e.id]);
    await compta.insererLignes(
      client, tenantId, inverse.rows[0].id,
      lignes.rows.map((l) => ({
        compte_id: l.compte_id, tiers_id: l.tiers_id, libelle: l.libelle,
        debit_c: versCentimes(l.credit), credit_c: versCentimes(l.debit),
        date_echeance: l.date_echeance ? dateSql(l.date_echeance) : null,
        compte_modifiable: l.compte_modifiable === "TRESORERIE" ? "TRESORERIE" : null,
      }))
    );
    await client.query(`UPDATE ecriture_comptable SET extournee_par_id = $2 WHERE id = $1`, [e.id, inverse.rows[0].id]);
    resultat.extournees++;
  }
  return resultat;
}

/** Met a jour la date d'echeance de la ligne client quand l'echeance de la facture est modifiee. */
async function synchroniserEcheance(client, tenantId, factureId) {
  const facture = await chargerFacture(client, tenantId, factureId);
  if (!facture) return;
  const e = await ecritureExistante(client, tenantId, factureId, "FACTURE");
  if (!e) return;
  const tiers = await client.query(`SELECT * FROM tiers_comptable WHERE tenant_id = $1 AND client_commercial_id = $2`, [tenantId, facture.client_commercial_id]);
  await client.query(
    `UPDATE ligne_ecriture SET date_echeance = $2 WHERE ecriture_id = $1 AND date_echeance IS NOT NULL`,
    [e.id, echeanceFacture(facture, tiers.rows[0])]
  );
}

/**
 * Rattrapage : genere les ecritures manquantes des factures (et encaissements)
 * existantes. Une transaction par facture : une piece en erreur n'empeche pas
 * les autres. `depuis` (AAAA-MM-JJ) borne les factures reprises.
 */
async function rattraperVentes(tenantId, utilisateurId, { depuis } = {}) {
  const liste = await compta.avecTransaction(async (client) => {
    const r = await client.query(
      `SELECT id, numero, statut, date_facture FROM facture_vente
       WHERE tenant_id = $1 AND statut <> 'ANNULEE' ${depuis ? "AND date_facture >= $2::date" : ""}
       ORDER BY date_facture, date_creation`,
      depuis ? [tenantId, depuis] : [tenantId]
    );
    return r.rows;
  });
  const resume = { factures: 0, encaissements: 0, ignorees: [] };
  for (const f of liste) {
    try {
      await compta.avecTransaction(async (client) => {
        const a = await genererEcritureFacture(client, tenantId, utilisateurId, f.id);
        if (a.statut === "CREEE") resume.factures++;
        else if (a.statut === "IGNOREE") resume.ignorees.push({ numero: f.numero, raison: a.raison });
        if (f.statut === "PAYEE" && a.statut !== "IGNOREE") {
          const b = await genererEcritureEncaissement(client, tenantId, utilisateurId, f.id);
          if (b.statut === "CREEE") resume.encaissements++;
          else if (b.statut === "IGNOREE" && b.raison !== "DEJA_ENCAISSEE") resume.ignorees.push({ numero: f.numero, raison: b.raison });
        }
      });
    } catch (err) {
      console.error("Rattrapage ventes : facture", f.numero, err.message);
      resume.ignorees.push({ numero: f.numero, raison: "ERREUR" });
    }
  }
  return resume;
}

/** Nombre de factures non annulees sans ecriture (et dont la date tombe dans un exercice) : alimente le bandeau de l'ecran. */
async function compterFacturesSansEcriture(client, tenantId) {
  const r = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE x.id IS NOT NULL AND e.id IS NULL)::int AS a_generer,
       COUNT(*) FILTER (WHERE x.id IS NULL AND e.id IS NULL)::int AS hors_exercice,
       COUNT(*) FILTER (WHERE x.id IS NOT NULL AND f.statut = 'PAYEE' AND p.id IS NULL AND f.montant_net_a_payer > f.montant_encaisse)::int AS encaissements_a_generer
     FROM facture_vente f
     LEFT JOIN exercice_comptable x ON x.tenant_id = f.tenant_id AND f.date_facture BETWEEN x.date_debut AND x.date_fin
     LEFT JOIN ecriture_comptable e ON e.tenant_id = f.tenant_id AND e.origine = 'FACTURE_VENTE' AND e.origine_id = f.id AND e.origine_role = 'FACTURE'
     LEFT JOIN ecriture_comptable p ON p.tenant_id = f.tenant_id AND p.origine = 'FACTURE_VENTE' AND p.origine_id = f.id AND p.origine_role = 'ENCAISSEMENT'
     WHERE f.tenant_id = $1 AND f.statut <> 'ANNULEE'`,
    [tenantId]
  );
  return r.rows[0];
}


// ----------------------------------------------------------------------------
// Ecran "Ecritures en instance"
// ----------------------------------------------------------------------------

/**
 * Liste des ecritures EN_INSTANCE avec leurs lignes et leur piece d'origine
 * (facture, client). Filtres : q (numero de piece / client / libelle), role
 * (FACTURE | ENCAISSEMENT | ANNULATION), client_id.
 */
async function listerInstance(client, tenantId, { limit = 100, offset = 0, q, role, client_id } = {}) {
  const params = [tenantId];
  let filtre = "";
  if (q) {
    params.push(`%${String(q).toLowerCase()}%`);
    filtre += ` AND (lower(e.libelle) LIKE $${params.length} OR lower(COALESCE(e.numero_piece, '')) LIKE $${params.length})`;
  }
  if (role) {
    params.push(String(role));
    filtre += ` AND e.origine_role LIKE $${params.length} || '%'`;
  }
  if (client_id) {
    params.push(String(client_id));
    filtre += ` AND f.client_commercial_id::text = $${params.length}`;
  }
  const base = `FROM ecriture_comptable e
     JOIN journal_comptable j ON j.id = e.journal_id
     LEFT JOIN facture_vente f ON e.origine = 'FACTURE_VENTE' AND f.id = e.origine_id
     LEFT JOIN client_commercial cc ON cc.id = f.client_commercial_id
     WHERE e.tenant_id = $1 AND e.statut = 'EN_INSTANCE' ${filtre}`;
  const total = await client.query(`SELECT COUNT(*)::int AS n ${base}`, params);
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 300);
  const off = Math.max(Number(offset) || 0, 0);
  const r = await client.query(
    `SELECT e.*, j.code AS journal_code, f.id AS facture_id, f.numero AS facture_numero, f.statut AS facture_statut,
            f.type_facturation, f.pourcentage_acompte, f.client_commercial_id, cc.nom AS client_nom
     ${base} ORDER BY e.date_ecriture, e.date_creation LIMIT ${lim} OFFSET ${off}`,
    params
  );
  const ids = r.rows.map((e) => e.id);
  let lignes = [];
  if (ids.length > 0) {
    lignes = (
      await client.query(
        `SELECT l.id, l.ecriture_id, l.ordre, l.libelle, l.debit, l.credit, l.compte_modifiable, l.date_echeance,
                c.numero AS compte_numero, c.libelle AS compte_libelle, t.code AS tiers_code, t.nom AS tiers_nom
         FROM ligne_ecriture l
         JOIN compte_comptable c ON c.id = l.compte_id
         LEFT JOIN tiers_comptable t ON t.id = l.tiers_id
         WHERE l.ecriture_id = ANY($1::uuid[]) ORDER BY l.ecriture_id, l.ordre`,
        [ids]
      )
    ).rows;
  }
  const parEcriture = new Map();
  for (const l of lignes) {
    if (!parEcriture.has(l.ecriture_id)) parEcriture.set(l.ecriture_id, []);
    parEcriture.get(l.ecriture_id).push(l);
  }
  return {
    total: total.rows[0].n,
    ecritures: r.rows.map((e) => {
      const ls = parEcriture.get(e.id) || [];
      return {
        ...e,
        lignes: ls,
        total_debit: ls.reduce((a, l) => a + Number(l.debit), 0),
        total_credit: ls.reduce((a, l) => a + Number(l.credit), 0),
      };
    }),
  };
}

const PORTEES = ["AUCUNE", "CLIENT", "DESIGNATION", "TOUS"];

/**
 * "Changer le compte" d'une ligne d'ecriture en instance. Seul le compte
 * change : montants, client, TVA et 411 restent verrouilles. `portee` etend le
 * changement aux ecritures similaires encore en instance (meme client, meme
 * designation de produit, ou toutes les lignes portant l'ancien compte) ;
 * `retenir` memorise la regle pour les prochaines factures.
 */
async function changerCompteLigne(client, tenantId, utilisateurId, ligneId, { compte_numero, portee = "AUCUNE", retenir = false } = {}) {
  if (!PORTEES.includes(portee)) throw new compta.ComptaError("COMPTA_PORTEE_INVALIDE");
  const r = await client.query(
    `SELECT l.*, e.statut AS ecriture_statut, e.origine, e.origine_id, c.numero AS ancien_numero
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.id = $1 AND l.tenant_id = $2 FOR UPDATE OF l`,
    [ligneId, tenantId]
  );
  const base = r.rows[0];
  if (!base) throw new compta.ComptaError("COMPTA_LIGNE_INTROUVABLE", 404);
  if (base.ecriture_statut !== "EN_INSTANCE" || !base.compte_modifiable) throw new compta.ComptaError("COMPTA_LIGNE_NON_MODIFIABLE", 409);

  const numero = String(compte_numero || "").trim();
  const c = await client.query(`SELECT * FROM compte_comptable WHERE tenant_id = $1 AND numero = $2`, [tenantId, numero]);
  const nouveau = c.rows[0];
  if (!nouveau) throw new compta.ComptaError("COMPTA_COMPTE_INTROUVABLE", 400, { numero });
  if (!nouveau.actif) throw new compta.ComptaError("COMPTA_COMPTE_INACTIF", 409, { numero });
  const compatible = base.compte_modifiable === "PRODUIT" ? nouveau.classe === 7 : nouveau.nature === "TRESORERIE" || nouveau.classe === 5;
  if (!compatible) throw new compta.ComptaError("COMPTA_COMPTE_INCOMPATIBLE", 409, { numero });
  if (nouveau.id === base.compte_id && portee === "AUCUNE") return { modifiees: 1, regle: false };

  // Lignes visees
  const params = [tenantId, base.compte_id, base.compte_modifiable, base.id];
  let critere = "";
  let clientBase = null;
  if (portee === "CLIENT") {
    const f = await client.query(`SELECT client_commercial_id FROM facture_vente WHERE id = $1`, [base.origine_id]);
    clientBase = f.rows[0]?.client_commercial_id;
    if (!clientBase) throw new compta.ComptaError("COMPTA_PORTEE_INVALIDE");
    params.push(clientBase);
    critere = ` AND e.origine = 'FACTURE_VENTE' AND EXISTS (SELECT 1 FROM facture_vente f WHERE f.id = e.origine_id AND f.client_commercial_id = $5)`;
  } else if (portee === "DESIGNATION") {
    params.push(String(base.libelle || "").trim().toLowerCase());
    critere = ` AND lower(trim(COALESCE(l.libelle, ''))) = $5`;
  }
  const similaires = portee === "AUCUNE"
    ? { rows: [] }
    : await client.query(
        `SELECT l.id FROM ligne_ecriture l JOIN ecriture_comptable e ON e.id = l.ecriture_id
         WHERE l.tenant_id = $1 AND l.compte_id = $2 AND l.compte_modifiable = $3 AND l.id <> $4
           AND e.statut = 'EN_INSTANCE' ${critere} FOR UPDATE OF l`,
        params
      );
  const ids = [base.id, ...similaires.rows.map((x) => x.id)];
  await client.query(`UPDATE ligne_ecriture SET compte_id = $2 WHERE id = ANY($1::uuid[])`, [ids, nouveau.id]);

  let regle = false;
  if (retenir && base.compte_modifiable === "PRODUIT" && (portee === "CLIENT" || portee === "DESIGNATION")) {
    const valeur = portee === "CLIENT" ? String(clientBase) : String(base.libelle || "").trim().toLowerCase();
    let libelleValeur = base.libelle;
    if (portee === "CLIENT") {
      const n = await client.query(`SELECT nom FROM client_commercial WHERE id = $1`, [clientBase]);
      libelleValeur = n.rows[0]?.nom || valeur;
    }
    await client.query(
      `INSERT INTO compta_regle_compte_vente (id, tenant_id, critere, valeur, libelle_valeur, compte_numero, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, critere, valeur) DO UPDATE SET compte_numero = EXCLUDED.compte_numero, cree_par = EXCLUDED.cree_par, libelle_valeur = EXCLUDED.libelle_valeur`,
      [uuidv4(), tenantId, portee, valeur, libelleValeur, numero, utilisateurId]
    );
    regle = true;
  }
  await compta.audit(client, tenantId, utilisateurId, "CHANGEMENT_COMPTE_INSTANCE", "ligne_ecriture", base.id,
    { compte: base.ancien_numero }, { compte: numero, portee, lignes: ids.length, regle_retenue: regle });
  return { modifiees: ids.length, regle };
}

async function listerRegles(client, tenantId) {
  const r = await client.query(`SELECT * FROM compta_regle_compte_vente WHERE tenant_id = $1 ORDER BY critere, libelle_valeur`, [tenantId]);
  return r.rows;
}

async function supprimerRegle(client, tenantId, utilisateurId, id) {
  const r = await client.query(`DELETE FROM compta_regle_compte_vente WHERE id = $1 AND tenant_id = $2 RETURNING *`, [id, tenantId]);
  if (!r.rows[0]) throw new compta.ComptaError("COMPTA_REGLE_INTROUVABLE", 404);
  await compta.audit(client, tenantId, utilisateurId, "SUPPRESSION_REGLE_COMPTE_VENTE", "compta_regle_compte_vente", id, r.rows[0], null);
}

// ----------------------------------------------------------------------------
// Appels "silencieux" depuis les routes de ventes
// ----------------------------------------------------------------------------

async function silencieux(tenantId, libelle, fn) {
  try {
    // Module vendu en option (migration 032) : rien n'est genere tant que le
    // Super Admin ne l'a pas active pour ce client.
    if (!(await compta.moduleComptabiliteActif(tenantId))) return null;
    return await compta.avecTransaction(fn);
  } catch (err) {
    console.error(`Comptabilite : ${libelle} impossible`, err.message);
    return null;
  }
}

const apresGenerationFacture = (tenantId, utilisateurId, factureId) =>
  silencieux(tenantId, "ecriture de facture", (client) => genererEcritureFacture(client, tenantId, utilisateurId, factureId));
const apresPaiementFacture = (tenantId, utilisateurId, factureId) =>
  silencieux(tenantId, "ecriture d'encaissement", (client) => genererEcritureEncaissement(client, tenantId, utilisateurId, factureId));
const apresAnnulationFacture = (tenantId, utilisateurId, factureId) =>
  silencieux(tenantId, "annulation d'ecriture", (client) => genererAnnulationFacture(client, tenantId, utilisateurId, factureId));
const apresModificationFacture = (tenantId, factureId) =>
  silencieux(tenantId, "mise a jour de l'echeance", (client) => synchroniserEcheance(client, tenantId, factureId));

module.exports = {
  genererEcritureFacture,
  genererEcritureEncaissement,
  genererAnnulationFacture,
  synchroniserEcheance,
  rattraperVentes,
  compterFacturesSansEcriture,
  listerInstance,
  changerCompteLigne,
  listerRegles,
  supprimerRegle,
  apresGenerationFacture,
  apresPaiementFacture,
  apresAnnulationFacture,
  apresModificationFacture,
  repartir,
  ventilerAcompte,
};
