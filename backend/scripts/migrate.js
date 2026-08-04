/**
 * Execute les migrations SQL du dossier /migrations qui n'ont pas encore
 * ete appliquees, dans l'ordre alphabetique des fichiers. Le suivi est
 * assure par la table technique _migrations_appliquees, ce qui permet de
 * relancer `npm run migrate` sans risque meme si certains fichiers ont
 * deja ete executes lors d'une session precedente.
 * Usage : npm run migrate
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { Pool } = require("pg");
 
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 
async function ensureTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations_appliquees (
      nom_fichier   TEXT PRIMARY KEY,
      date_execution TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
 
async function dejaAppliquee(nomFichier) {
  const result = await pool.query(
    `SELECT 1 FROM _migrations_appliquees WHERE nom_fichier = $1`,
    [nomFichier]
  );
  return result.rows.length > 0;
}
 
async function main() {
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
 
  if (files.length === 0) {
    console.log("Aucune migration trouvee dans", dir);
    return;
  }
 
  await ensureTrackingTable();
 
  for (const file of files) {
    if (await dejaAppliquee(file)) {
      console.log(`--> ${file} deja appliquee, ignoree.`);
      continue;
    }
 
    const fullPath = path.join(dir, file);
    const sql = fs.readFileSync(fullPath, "utf8");
    console.log(`--> Execution de ${file} ...`);
    try {
      await pool.query(sql);
      await pool.query(
        `INSERT INTO _migrations_appliquees (nom_fichier) VALUES ($1)`,
        [file]
      );
      console.log(`    OK (${file})`);
    } catch (err) {
      console.error(`    ECHEC sur ${file} :`, err.message);
      process.exitCode = 1;
      break;
    }
  }
 
  await pool.end();
}
 
main();
