/**
 * Ventilation analytique d'une ligne d'ecriture (phase 3C) : primitives
 * appelees par comptaService.insererLignes. Le montant ventile est SIGNE comme
 * (debit - credit) de la ligne : charge > 0, produit < 0.
 *
 * Module separe (et require "paresseux" de comptaService) pour eviter une
 * dependance circulaire.
 */
const { v4: uuidv4 } = require("uuid");

const compta = () => require("./comptaService");

/**
 * Convertit une ventilation saisie [{ section_id, montant | montant_c | pourcentage }]
 * en parts SIGNEES (centimes). Sans montant ni pourcentage, une ventilation a
 * une seule section porte 100 % de la ligne. La somme ne peut pas depasser la
 * ligne ; si les pourcentages font 100 %, la derniere part absorbe l'arrondi.
 */
function calculerParts(items, debitC, creditC) {
  const { ComptaError, versCentimes } = compta();
  if (!Array.isArray(items)) throw new ComptaError("COMPTA_ANALYTIQUE_INVALIDE", 400);
  const net = debitC - creditC;
  const total = Math.abs(net);
  const signe = net >= 0 ? 1 : -1;
  const parts = [];
  const vus = new Set();
  let sommePct = 0;
  let toutEnPct = items.length > 0;
  for (const it of items) {
    if (!it || !it.section_id) throw new ComptaError("COMPTA_ANALYTIQUE_SECTION_INTROUVABLE", 400);
    if (vus.has(it.section_id)) throw new ComptaError("COMPTA_ANALYTIQUE_INVALIDE", 400);
    vus.add(it.section_id);
    let part;
    if (it.pourcentage !== undefined && it.pourcentage !== null && it.pourcentage !== "") {
      const p = Number(String(it.pourcentage).replace(",", "."));
      if (!Number.isFinite(p) || p <= 0 || p > 100) throw new ComptaError("COMPTA_ANALYTIQUE_INVALIDE", 400);
      sommePct += p;
      part = Math.round((total * p) / 100);
    } else {
      toutEnPct = false;
      if (it.montant_c !== undefined && it.montant_c !== null) part = Math.abs(Math.round(it.montant_c));
      else if (it.montant !== undefined && it.montant !== null && it.montant !== "") part = Math.abs(versCentimes(it.montant));
      else if (items.length === 1) part = total;
      else throw new ComptaError("COMPTA_ANALYTIQUE_INVALIDE", 400);
      if (Number.isNaN(part)) throw new ComptaError("COMPTA_MONTANT_INVALIDE", 400);
    }
    parts.push({ section_id: it.section_id, part });
  }
  if (toutEnPct && Math.abs(sommePct - 100) < 1e-9 && parts.length > 0) {
    const autres = parts.slice(0, -1).reduce((a, p) => a + p.part, 0);
    parts[parts.length - 1].part = total - autres;
  }
  const somme = parts.reduce((a, p) => a + p.part, 0);
  if (somme > total) throw new ComptaError("COMPTA_ANALYTIQUE_DEPASSE", 400);
  return parts.filter((p) => p.part > 0).map((p) => ({ section_id: p.section_id, montant_c: signe * p.part }));
}

/** Enregistre la ventilation d'une ligne (compte analytique, sections actives de l'entreprise). */
async function ventilerLigne(client, tenantId, ligneId, compteId, debitC, creditC, items) {
  const { ComptaError, centimesVersDecimal } = compta();
  if (!items || items.length === 0) return;
  const c = await client.query(`SELECT analytique FROM compte_comptable WHERE id = $1 AND tenant_id = $2`, [compteId, tenantId]);
  if (!c.rows[0] || !c.rows[0].analytique) throw new ComptaError("COMPTA_ANALYTIQUE_COMPTE_NON_ANALYTIQUE", 400);
  const parts = calculerParts(items, debitC, creditC);
  if (parts.length === 0) return;
  const ids = parts.map((p) => p.section_id);
  const s = await client.query(
    `SELECT id FROM section_analytique WHERE tenant_id = $1 AND actif = true AND id::text = ANY($2::text[])`,
    [tenantId, ids.map(String)]
  );
  if (s.rows.length !== ids.length) throw new ComptaError("COMPTA_ANALYTIQUE_SECTION_INTROUVABLE", 400);
  for (const p of parts) {
    await client.query(
      `INSERT INTO ventilation_analytique (id, tenant_id, ligne_ecriture_id, section_id, montant) VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), tenantId, ligneId, p.section_id, centimesVersDecimal(p.montant_c)]
    );
  }
}

/** Recopie, en sens inverse (contre-passation / extourne), la ventilation d'une ligne source. */
async function copierInverse(client, tenantId, ligneSourceId, ligneCibleId) {
  await client.query(
    `INSERT INTO ventilation_analytique (id, tenant_id, ligne_ecriture_id, section_id, montant)
     SELECT gen_random_uuid(), tenant_id, $2, section_id, -montant FROM ventilation_analytique
     WHERE ligne_ecriture_id = $1 AND tenant_id = $3`,
    [ligneSourceId, ligneCibleId, tenantId]
  );
}

module.exports = { calculerParts, ventilerLigne, copierInverse };
