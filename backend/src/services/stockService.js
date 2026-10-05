const { v4: uuidv4 } = require("uuid");

// Stock = somme des mouvements (jamais stocke ailleurs). Voir migration 038.

async function stockProduit(queryable, tenantId, produitId) {
  const r = await queryable.query(
    `SELECT COALESCE(SUM(quantite), 0) AS stock FROM mouvement_stock WHERE tenant_id = $1 AND produit_id = $2`,
    [tenantId, produitId]
  );
  return Number(r.rows[0].stock);
}

async function enregistrerMouvement(client, m) {
  await client.query(
    `INSERT INTO mouvement_stock (id, tenant_id, produit_id, type_mouvement, quantite, cout_unitaire_xof, date_mouvement,
                                  origine_type, origine_id, libelle, cree_par)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, CURRENT_DATE),$8,$9,$10,$11)`,
    [uuidv4(), m.tenantId, m.produitId, m.type, m.quantite, m.coutUnitaire ?? null, m.date || null,
     m.origineType || null, m.origineId || null, m.libelle || null, m.userId || null]
  );
}

// Reference interne automatique ART-00001, ART-00002... (le tenant peut
// toujours saisir la sienne). Verrou transactionnel par tenant pour eviter deux
// attributions simultanees de la meme reference.
async function genererReferenceInterne(client, tenantId) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ["refart:" + tenantId]);
  const r = await client.query(
    `SELECT COALESCE(MAX(substring(reference from '^ART-([0-9]+)$')::int), 0) AS max
     FROM produit WHERE tenant_id = $1 AND reference ~ '^ART-[0-9]+$'`,
    [tenantId]
  );
  return `ART-${String(Number(r.rows[0].max) + 1).padStart(5, "0")}`;
}

module.exports = { stockProduit, enregistrerMouvement, genererReferenceInterne };
