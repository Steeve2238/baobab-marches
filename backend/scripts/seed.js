/**
 * Jeu de donnees de demonstration : un tenant, des roles, un utilisateur admin,
 * et un dossier d'AO exemple (inspire du dossier SENELEC AO 39/2021 utilise
 * pendant la conception) avec ses clauses extraites et son chronogramme.
 * Usage : npm run seed
 */
require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ROLES = [
  { code: "ADMIN", libelle: "Administrateur", lecture_seule: false },
  { code: "DIRECTION", libelle: "Direction", lecture_seule: true },
  { code: "COMMERCIAL", libelle: "Commercial", lecture_seule: false },
  { code: "FINANCIER", libelle: "Financier", lecture_seule: false },
  { code: "JURIDIQUE", libelle: "Juridique", lecture_seule: false },
  { code: "TRANSIT", libelle: "Transit / Logistique", lecture_seule: false },
  { code: "CONDUCTEUR_TRAVAUX", libelle: "Conducteur de travaux", lecture_seule: false },
  { code: "RH", libelle: "RH", lecture_seule: false },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tenantRes = await client.query(
      `INSERT INTO tenant (raison_sociale, secteur_activite, pays)
       VALUES ($1, $2, $3) RETURNING id`,
      ["Max Consulting - Demo", "Conseil / BTP / Fourniture", "Senegal"]
    );
    const tenantId = tenantRes.rows[0].id;
    console.log("Tenant demo cree:", tenantId);

    const roleIds = {};
    for (const r of ROLES) {
      const res = await client.query(
        `INSERT INTO role (tenant_id, code, libelle, lecture_seule)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, r.code, r.libelle, r.lecture_seule]
      );
      roleIds[r.code] = res.rows[0].id;
    }
    console.log("Roles crees:", Object.keys(roleIds).join(", "));

    const passwordHash = await bcrypt.hash("Admin@2026", 10);
    const userRes = await client.query(
      `INSERT INTO utilisateur (tenant_id, nom, prenom, email, mot_de_passe_hash, mot_de_passe_temporaire)
       VALUES ($1, $2, $3, $4, $5, false) RETURNING id`,
      [tenantId, "Yana", "Steeve", "admin@baobabmarches.sn", passwordHash]
    );
    const userId = userRes.rows[0].id;
    await client.query(
      `INSERT INTO utilisateur_role (utilisateur_id, role_id) VALUES ($1, $2), ($1, $3)`,
      [userId, roleIds.ADMIN, roleIds.DIRECTION]
    );
    console.log("Utilisateur admin cree : admin@baobabmarches.sn / Admin@2026");

    const moRes = await client.query(
      `INSERT INTO maitre_ouvrage (tenant_id, nom, categorie)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, "SENELEC", "Societe nationale"]
    );
    const maitreOuvrageId = moRes.rows[0].id;

    const dossierRes = await client.query(
      `INSERT INTO dossier_ao
         (tenant_id, reference_externe, intitule, maitre_ouvrage_id, secteur,
          montant_estime, devise, date_limite_soumission, statut)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '3 days', 'ANALYSE')
       RETURNING id`,
      [
        tenantId,
        "AO N 39/2021",
        "Travaux sur les turboalternateurs 301 et 303 de la centrale C3 de Cap des Biches",
        maitreOuvrageId,
        "BTP / Travaux",
        99693000,
        "XOF",
      ]
    );
    const dossierId = dossierRes.rows[0].id;
    console.log("Dossier exemple cree:", dossierId);

    const clauses = [
      ["GARANTIE_BONNE_EXECUTION", "Garantie de bonne execution", 0.05, "Art. 7.1.1 CCAG"],
      ["RETENUE_GARANTIE", "Retenue de garantie", 0.05, "Art. 7.2.1 CCAG"],
      ["AVANCE_DEMARRAGE", "Avance forfaitaire de demarrage", 0.20, "Art. 12.5 CCAP"],
      ["PENALITE_RETARD", "Penalite journaliere de retard (4/1000, plafond 10%)", 0.004, "Art. 21.1 CCAG"],
      ["DELAI_EXECUTION", "Delai d'execution Lot 1 : 6 mois", null, "Art. 20.1.1 CCAP"],
    ];
    for (const [type, libelle, valeur, article] of clauses) {
      await client.query(
        `INSERT INTO clause_extraite (dossier_ao_id, type_clause, libelle, valeur_numerique, article_reference, niveau_vigilance)
         VALUES ($1, $2, $3, $4, $5, 'STANDARD')`,
        [dossierId, type, libelle, valeur, article]
      );
    }
    console.log("Clauses extraites inserees:", clauses.length);

    const taches = [
      ["AVANT_SOUMISSION", "J-7", "Exploitation du DAO et calcul de marge", "COMMERCIAL", "FAIT", 1],
      ["AVANT_SOUMISSION", "J-4", "Cotation frais d'approche et choix transitaire", "TRANSIT", "FAIT", 2],
      ["AVANT_SOUMISSION", "J-3", "Calcul des marges et reunion strategie prix", "FINANCIER", "EN_COURS", 3],
      ["AVANT_SOUMISSION", "J-2", "Finalisation, impression, signature", "DIRECTION", "A_FAIRE", 4],
      ["AVANT_SOUMISSION", "J0", "Depot du dossier", "COMMERCIAL", "A_FAIRE", 5],
      ["AVANT_SOUMISSION", "J+2", "Reunion debrief et archivage", "COMMERCIAL", "A_FAIRE", 6],
    ];
    for (const [phase, jalon, intitule, roleCode, statut, ordre] of taches) {
      await client.query(
        `INSERT INTO chronogramme_tache (dossier_ao_id, phase, intitule, jalon_relatif, role_porteur_id, statut, ordre_affichage)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [dossierId, phase, intitule, jalon, roleIds[roleCode], statut, ordre]
      );
    }
    console.log("Chronogramme insere:", taches.length, "taches");

    const indicRes = await client.query(
      `INSERT INTO indicateur_definition (tenant_id, code, libelle, domaine)
       VALUES ($1, 'ECART_MARGE', 'Ecart marge visee / reelle', 'MARGE') RETURNING id`,
      [tenantId]
    );
    await client.query(
      `INSERT INTO signal_anticipation (tenant_id, dossier_ao_id, indicateur_definition_id, severite, message)
       VALUES ($1, $2, $3, 'ALERTE', $4)`,
      [
        tenantId,
        dossierId,
        indicRes.rows[0].id,
        "Marge reelle 11,2% vs 13,4% visee - derive liee au taux de change EXW sur le lot import.",
      ]
    );
    console.log("Signal d'anticipation exemple insere");

    await client.query("COMMIT");
    console.log("\nSeed termine avec succes.");
    console.log("Connexion demo : admin@baobabmarches.sn / Admin@2026");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erreur pendant le seed, rollback effectue :", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
