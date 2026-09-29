const { Pool, types } = require("pg");
require("dotenv").config();

// Les colonnes DATE (type OID 1082, ex date_devis/date_facture/date_bl) ne
// doivent jamais transiter par un objet Date JS : le driver pg le construit
// avec les composants locaux du fuseau du SERVEUR, qui est ensuite serialise
// en ISO UTC par res.json() - ce qui decale la date affichee d'un jour des
// que le fuseau du serveur differe d'UTC (bug signale par un client le
// 29/09/2026 : devis imprime le 29/09 affichait le 28/09). En renvoyant la
// chaine brute "YYYY-MM-DD" telle que stockee, aucune conversion de fuseau
// horaire n'intervient.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Erreur inattendue sur le pool PostgreSQL", err);
  process.exit(1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
