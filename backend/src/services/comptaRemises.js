/**
 * Remise de cheques en banque (Pack Commerce, lot 1b).
 *
 * Un cheque recu est comptabilise sur le COMPTE D'ATTENTE du mode de reglement (ex. 513 "Cheques a encaisser").
 * La remise en banque transfere les cheques choisis vers la banque : debit compte de banque du journal choisi /
 * credit compte(s) d'attente. Le portefeuille = lignes au debit de ces comptes d'attente, non encore remises
 * (quelle que soit l'origine : reglement client, caisse, facture), hors ecritures extournees.
 * L'ecriture est creee EN_INSTANCE (validee par le comptable) ; la remise ne peut etre annulee que tant que son
 * ecriture n'est pas validee.
 */
const { v4: uuidv4 } = require("uuid");
const compta = require("./comptaService");

const { versCentimes, centimesVersDecimal, ComptaError } = compta;
const ORIGINE = "REMISE_BANQUE";
const dateValide = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());
const iso = (d) => (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d).slice(0, 10));

async function comptesAttenteCheques(client, tenantId) {
  const r = await client.query(
    `SELECT DISTINCT compte_attente FROM mode_reglement WHERE tenant_id = $1 AND type_mode = 'CHEQUE' AND compte_attente IS NOT NULL AND compte_attente <> ''`,
    [tenantId]
  );
  return r.rows.map((x) => x.compte_attente);
}

/** Cheques en portefeuille (a remettre en banque). */
async function portefeuille(client, tenantId) {
  const comptes = await comptesAttenteCheques(client, tenantId);
  if (comptes.length === 0) return { parametre: false, comptes, cheques: [], total: 0 };
  const r = await client.query(
    `SELECT l.id AS ligne_id, l.debit AS montant, l.libelle AS ligne_libelle, c.numero AS compte, e.id AS ecriture_id, e.date_ecriture,
            e.libelle, e.numero_piece, e.origine, e.statut
     FROM ligne_ecriture l
     JOIN ecriture_comptable e ON e.id = l.ecriture_id
     JOIN compte_comptable c ON c.id = l.compte_id
     WHERE l.tenant_id = $1 AND l.debit > 0 AND c.numero = ANY($2::text[])
       AND e.extournee_par_id IS NULL AND e.extourne_de_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM remise_banque_ligne rl WHERE rl.ligne_ecriture_id = l.id)
     ORDER BY e.date_ecriture, e.date_creation`,
    [tenantId, comptes]
  );
  const cheques = r.rows.map((x) => ({
    ligne_id: x.ligne_id, montant: Number(x.montant), compte: x.compte, ecriture_id: x.ecriture_id, date: iso(x.date_ecriture),
    libelle: x.libelle, reference: x.numero_piece, origine: x.origine, statut: x.statut,
  }));
  return { parametre: true, comptes, cheques, total: Math.round(cheques.reduce((s, c) => s + c.montant, 0) * 100) / 100 };
}

async function prochainNumero(client, tenantId, annee) {
  await client.query(
    `INSERT INTO compteur_numerotation (tenant_id, type_compteur, annee, dernier_numero) VALUES ($1, 'REMISE_BANQUE', $2, 0)
     ON CONFLICT (tenant_id, type_compteur, annee) DO NOTHING`,
    [tenantId, annee]
  );
  const r = await client.query(
    `UPDATE compteur_numerotation SET dernier_numero = dernier_numero + 1 WHERE tenant_id = $1 AND type_compteur = 'REMISE_BANQUE' AND annee = $2 RETURNING dernier_numero`,
    [tenantId, annee]
  );
  return `RB-${annee}-${String(r.rows[0].dernier_numero).padStart(4, "0")}`;
}

async function idCompte(client, tenantId, numero) {
  const r = await client.query(`SELECT id FROM compte_comptable WHERE tenant_id = $1 AND numero = $2`, [tenantId, String(numero)]);
  if (!r.rows[0]) throw new ComptaError("COMPTA_COMPTE_INTROUVABLE", 400, { numero });
  return r.rows[0].id;
}

async function creerRemise(client, tenantId, utilisateurId, data) {
  await compta.exigerInitialise(client, tenantId);
  if (!dateValide(data.date_remise)) throw new ComptaError("COMPTA_DATE_INVALIDE");
  const ids = Array.isArray(data.ligne_ids) ? [...new Set(data.ligne_ids.map(String))] : [];
  if (ids.length === 0) throw new ComptaError("REMISE_AUCUN_CHEQUE");
  const j = await client.query(`SELECT * FROM journal_comptable WHERE id = $1 AND tenant_id = $2 AND actif = true AND type_journal = 'BANQUE'`, [data.journal_id, tenantId]);
  const journal = j.rows[0];
  if (!journal) throw new ComptaError("REMISE_JOURNAL_INVALIDE");
  const compteBanque = (data.compte_banque && String(data.compte_banque).trim()) || journal.compte_tresorerie;
  if (!compteBanque) throw new ComptaError("REMISE_COMPTE_BANQUE_REQUIS");
  const exercice = await compta.exerciceDeLaDate(client, tenantId, data.date_remise);
  if (!exercice) throw new ComptaError("COMPTA_EXERCICE_INTROUVABLE", 400);
  if (exercice.statut === "CLOTURE") throw new ComptaError("COMPTA_EXERCICE_CLOTURE", 409);

  // Verrou + controle : les cheques doivent etre toujours en portefeuille (pas deja remis ni extournes).
  const pf = await portefeuille(client, tenantId);
  const dispo = new Map(pf.cheques.map((c) => [c.ligne_id, c]));
  const choisis = [];
  for (const id of ids) {
    const c = dispo.get(id);
    if (!c) throw new ComptaError("REMISE_CHEQUE_INDISPONIBLE", 409);
    if (c.date > data.date_remise) throw new ComptaError("REMISE_DATE_ANTERIEURE", 400);
    choisis.push(c);
  }
  const parCompte = new Map();
  let totalC = 0;
  for (const c of choisis) {
    const m = versCentimes(c.montant);
    totalC += m;
    parCompte.set(c.compte, (parCompte.get(c.compte) || 0) + m);
  }
  const annee = Number(data.date_remise.slice(0, 4));
  const numero = await prochainNumero(client, tenantId, annee);
  const reference = data.reference ? String(data.reference).trim().slice(0, 60) : null;
  const remiseId = uuidv4();
  const libelle = `Remise de ${choisis.length} chèque${choisis.length > 1 ? "s" : ""} en banque${reference ? ` - ${reference}` : ""}`;
  const ecr = await client.query(
    `INSERT INTO ecriture_comptable (id, tenant_id, exercice_id, journal_id, numero_piece, date_ecriture, libelle, statut, origine, origine_id, origine_role, cree_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'EN_INSTANCE',$8,$9,'REMISE',$10) RETURNING id`,
    [uuidv4(), tenantId, exercice.id, journal.id, reference || numero, data.date_remise, libelle, ORIGINE, remiseId, utilisateurId]
  );
  const lignes = [{ compte_id: await idCompte(client, tenantId, compteBanque), tiers_id: null, libelle, debit_c: totalC, credit_c: 0, date_echeance: null, compte_modifiable: "TRESORERIE" }];
  for (const [compte, m] of parCompte) {
    lignes.push({ compte_id: await idCompte(client, tenantId, compte), tiers_id: null, libelle: `Remise ${numero}`, debit_c: 0, credit_c: m, date_echeance: null });
  }
  await compta.insererLignes(client, tenantId, ecr.rows[0].id, lignes);
  await client.query(
    `INSERT INTO remise_banque (id, tenant_id, numero, date_remise, journal_id, compte_banque, montant, nb_cheques, reference, ecriture_id, cree_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [remiseId, tenantId, numero, data.date_remise, journal.id, String(compteBanque), centimesVersDecimal(totalC), choisis.length, reference, ecr.rows[0].id, utilisateurId]
  );
  for (const c of choisis) {
    await client.query(`INSERT INTO remise_banque_ligne (id, tenant_id, remise_id, ligne_ecriture_id, montant) VALUES ($1,$2,$3,$4,$5)`, [uuidv4(), tenantId, remiseId, c.ligne_id, c.montant]);
  }
  await compta.audit(client, tenantId, utilisateurId, "CREATION_REMISE_BANQUE", "remise_banque", remiseId, null, { numero, montant: centimesVersDecimal(totalC), nb_cheques: choisis.length });
  return { id: remiseId, numero, montant: totalC / 100, nb_cheques: choisis.length, ecriture_id: ecr.rows[0].id };
}

async function listerRemises(client, tenantId) {
  const r = await client.query(
    `SELECT r.id, r.numero, r.date_remise, r.compte_banque, r.montant, r.nb_cheques, r.reference, r.statut, r.date_creation,
            j.code AS journal_code, e.id AS ecriture_id, e.statut AS ecriture_statut, e.numero_ecriture
     FROM remise_banque r JOIN journal_comptable j ON j.id = r.journal_id
     LEFT JOIN ecriture_comptable e ON e.id = r.ecriture_id
     WHERE r.tenant_id = $1 ORDER BY r.date_remise DESC, r.numero DESC LIMIT 200`,
    [tenantId]
  );
  return r.rows.map((x) => ({ ...x, date_remise: iso(x.date_remise), montant: Number(x.montant) }));
}

async function lireRemise(client, tenantId, id) {
  const r = (await client.query(`SELECT * FROM remise_banque WHERE id = $1 AND tenant_id = $2`, [id, tenantId])).rows[0];
  if (!r) throw new ComptaError("REMISE_INTROUVABLE", 404);
  const lignes = await client.query(
    `SELECT rl.montant, e.date_ecriture, e.libelle, e.numero_piece FROM remise_banque_ligne rl
     JOIN ligne_ecriture l ON l.id = rl.ligne_ecriture_id JOIN ecriture_comptable e ON e.id = l.ecriture_id
     WHERE rl.remise_id = $1 ORDER BY e.date_ecriture`,
    [id]
  );
  return { ...r, date_remise: iso(r.date_remise), montant: Number(r.montant), cheques: lignes.rows.map((x) => ({ montant: Number(x.montant), date: iso(x.date_ecriture), libelle: x.libelle, reference: x.numero_piece })) };
}

/** Annulation : possible tant que l'ecriture de remise n'est pas validee ; les cheques retournent en portefeuille. */
async function annulerRemise(client, tenantId, utilisateurId, id) {
  const r = (await client.query(`SELECT * FROM remise_banque WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [id, tenantId])).rows[0];
  if (!r) throw new ComptaError("REMISE_INTROUVABLE", 404);
  if (r.statut === "ANNULEE") throw new ComptaError("REMISE_DEJA_ANNULEE", 409);
  if (r.ecriture_id) {
    const e = (await client.query(`SELECT statut FROM ecriture_comptable WHERE id = $1`, [r.ecriture_id])).rows[0];
    if (e && e.statut === "VALIDEE") throw new ComptaError("REMISE_ECRITURE_VALIDEE", 409);
    await client.query(`DELETE FROM remise_banque_ligne WHERE remise_id = $1`, [id]);
    await client.query(`UPDATE remise_banque SET statut = 'ANNULEE', ecriture_id = NULL WHERE id = $1`, [id]);
    await client.query(`DELETE FROM ligne_ecriture WHERE ecriture_id = $1`, [r.ecriture_id]);
    await client.query(`DELETE FROM ecriture_comptable WHERE id = $1`, [r.ecriture_id]);
  } else {
    await client.query(`DELETE FROM remise_banque_ligne WHERE remise_id = $1`, [id]);
    await client.query(`UPDATE remise_banque SET statut = 'ANNULEE' WHERE id = $1`, [id]);
  }
  await compta.audit(client, tenantId, utilisateurId, "ANNULATION_REMISE_BANQUE", "remise_banque", id, null, { numero: r.numero });
  return { annulee: true };
}

module.exports = { portefeuille, creerRemise, listerRemises, lireRemise, annulerRemise };
