/**
 * Paie (lot PAIE-3A) : validation, reouverture et cloture d'une periode de paie, archives verrouillees.
 *
 * Cycle : OUVERTE -> (valider) -> VALIDEE -> (cloturer) -> CLOTUREE.
 *  - valider : aucun controle bloquant ; les bulletins passent a VALIDE ; la periode n'est plus modifiable (variables, calcul).
 *  - rouvrir : VALIDEE -> OUVERTE (motif obligatoire), tant que la periode n'est pas cloturee.
 *  - cloturer : genere tous les imprimables (bulletins PDF, journal, etats sociaux et fiscaux, etats Excel, ordre de virement),
 *    les range dans l'archive (BYTEA, empreinte SHA-256 par fichier et globale) et verrouille la periode (declencheurs SQL).
 * La periode suivante ne peut s'ouvrir qu'apres la cloture (voir paiePeriodes.ouvrir).
 */
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const P = require("./paieParametres");
const PER = require("./paiePeriodes");
const PDF = require("./paiePdf");
const { ordreVirementPdf } = require("./rhDocumentsPdf");
const { chargerEntete } = require("./rhCommun");
const { creerZip } = require("../utils/zipSimple");
const COMPTA = require("./paieCompta");

const { PaieError } = P;
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const refPeriode = (p) => `PAIE-${p.annee}-${String(p.mois).padStart(2, "0")}`;
const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "X";
const DOSSIER = { BULLETIN: "Bulletins", JOURNAL_PAIE: "Etats", ETATS_SOCIAUX_FISCAUX: "Etats", ETATS_EXCEL: "Etats", ORDRE_VIREMENT: "Virement" };

function empreinteGlobale(fichiers) {
  const lignes = fichiers.map((f) => `${f.type}|${f.employe_id || ""}|${f.sha256}`).sort();
  return sha256(Buffer.from(lignes.join("\n"), "utf8"));
}

// ------------------------------------------------------------------------------------------------ validation
async function valider(tid, userId, periodeId) {
  let p = await PER.chargerPeriode(tid, periodeId);
  if (p.statut !== "OUVERTE") throw new PaieError("PAIE_PERIODE_FIGEE", 409);
  // Dernier calcul a jour avant controle (variables ou dossiers modifies depuis).
  await PER.generer(tid, userId, p.id);
  p = await PER.chargerPeriode(tid, periodeId);
  const c = await PER.controles(tid, p);
  if (!c.nb_bulletins) throw new PaieError("PAIE_AUCUN_BULLETIN", 409);
  if (c.bloquants > 0) throw new PaieError("PAIE_VALIDATION_BLOQUEE", 409, { bloquants: c.bloquants });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const cur = (await client.query(`SELECT statut FROM paie_periode WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [p.id, tid])).rows[0];
    if (!cur || cur.statut !== "OUVERTE") throw new PaieError("PAIE_PERIODE_FIGEE", 409);
    await client.query(`UPDATE paie_bulletin SET statut = 'VALIDE' WHERE periode_id = $1 AND tenant_id = $2`, [p.id, tid]); // periode encore ouverte
    await client.query(`UPDATE paie_periode SET statut = 'VALIDEE', date_validation = now(), valide_par = $3, motif_reouverture = NULL WHERE id = $1 AND tenant_id = $2`, [p.id, tid, userId || null]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return PER.chargerPeriode(tid, periodeId);
}

async function rouvrir(tid, userId, periodeId, motif) {
  const p = await PER.chargerPeriode(tid, periodeId);
  if (p.statut === "CLOTUREE") throw new PaieError("PAIE_PERIODE_CLOTUREE", 409);
  if (p.statut !== "VALIDEE") throw new PaieError("PAIE_REOUVERTURE_IMPOSSIBLE", 409);
  const m = String(motif || "").trim();
  if (m.length < 5) throw new PaieError("PAIE_MOTIF_REQUIS", 400);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const cur = (await client.query(`SELECT statut FROM paie_periode WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [p.id, tid])).rows[0];
    if (!cur || cur.statut !== "VALIDEE") throw new PaieError("PAIE_REOUVERTURE_IMPOSSIBLE", 409);
    await client.query(`UPDATE paie_periode SET statut = 'OUVERTE', date_validation = NULL, valide_par = NULL, motif_reouverture = $3 WHERE id = $1 AND tenant_id = $2`, [p.id, tid, m.slice(0, 500)]);
    await client.query(`UPDATE paie_bulletin SET statut = 'BROUILLON' WHERE periode_id = $1 AND tenant_id = $2`, [p.id, tid]); // periode rouverte d'abord
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return PER.chargerPeriode(tid, periodeId);
}

// ------------------------------------------------------------------------------------------------ ordre de virement : coherence
/** L'ordre de virement lie a la periode est-il present et conforme aux bulletins ? */
async function etatOrdreVirement(tid, p) {
  const calc = await PER.lignesOrdreVirement(tid, p);
  const total = calc.lignes.reduce((s, l) => s + l.montant, 0);
  if (!calc.lignes.length) return { requis: false, present: !!p.ordre_virement_id, coherent: true, total: 0, nb_lignes: 0 };
  if (!p.ordre_virement_id) return { requis: true, present: false, coherent: false, total, nb_lignes: calc.lignes.length };
  const ov = (await db.query(`SELECT id, numero, statut, total, lignes_json FROM rh_ordre_virement WHERE id = $1 AND tenant_id = $2`, [p.ordre_virement_id, tid])).rows[0];
  if (!ov || ov.statut === "ANNULE") return { requis: true, present: false, coherent: false, total, nb_lignes: calc.lignes.length };
  const actuel = new Map((ov.lignes_json || []).map((l) => [l.employe_id, Math.round(Number(l.montant) || 0)]));
  const coherent = actuel.size === calc.lignes.length && calc.lignes.every((l) => actuel.get(l.employe_id) === l.montant);
  return { requis: true, present: true, coherent, total, nb_lignes: calc.lignes.length, numero: ov.numero, statut: ov.statut };
}

// ------------------------------------------------------------------------------------------------ cloture
async function cumulsAnnuels(tid, employeId, annee, mois) {
  const r = await db.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(b.brut),0) AS brut, COALESCE(SUM(b.imposable),0) AS imposable, COALESCE(SUM(b.ir),0) AS ir, COALESCE(SUM(b.trimf),0) AS trimf, COALESCE(SUM(b.net_a_payer),0) AS net
     FROM paie_bulletin b JOIN paie_periode q ON q.id = b.periode_id
     WHERE b.tenant_id = $1 AND b.employe_id = $2 AND q.annee = $3 AND q.mois <= $4`,
    [tid, employeId, annee, mois]
  );
  const x = r.rows[0];
  return { mois: Number(x.n), brut: Number(x.brut), imposable: Number(x.imposable), ir: Number(x.ir), trimf: Number(x.trimf), net: Number(x.net) };
}

/** Fabrique tous les imprimables d'une periode VALIDEE (sans rien ecrire en base). */
async function fabriquerImprimables(tid, p, { ov = null, options = {} } = {}) {
  const entete = await chargerEntete(tid);
  const reglages = await P.getReglages(tid);
  const ref = refPeriode(p);
  const base = `${p.annee}-${String(p.mois).padStart(2, "0")}`;
  const fichiers = [];
  const ajouter = (type, nom, mime, contenu, employeId = null) => fichiers.push({ type, employe_id: employeId, nom_fichier: nom, mime, contenu, taille: contenu.length, sha256: sha256(contenu) });
  const lieu = options.lieu || "Dakar";

  const lignes = (await db.query(`SELECT employe_id, matricule, nom, prenom, calcul_json FROM paie_bulletin WHERE tenant_id = $1 AND periode_id = $2 ORDER BY nom, prenom`, [tid, p.id])).rows;
  for (const l of lignes) {
    const cumuls = await cumulsAnnuels(tid, l.employe_id, p.annee, p.mois);
    const buf = await PDF.bulletinPdf(l.calcul_json, entete, { annee: p.annee, mois: p.mois, reglages, cumuls, reference: `${ref}-${l.matricule || l.employe_id.slice(0, 8)}`, brouillon: false, lieu });
    ajouter("BULLETIN", `Bulletin_${base}_${slug(l.matricule)}_${slug(l.nom)}_${slug(l.prenom)}.pdf`, "application/pdf", buf, l.employe_id);
  }
  const etats = await PER.etats(tid, p);
  ajouter("JOURNAL_PAIE", `Journal_de_paie_${base}.pdf`, "application/pdf", await PDF.journalPdf(etats, entete, { annee: p.annee, mois: p.mois, reference: ref }));
  ajouter("ETATS_SOCIAUX_FISCAUX", `Etats_sociaux_fiscaux_${base}.pdf`, "application/pdf", await PDF.etatsSociauxFiscauxPdf(etats, entete, { annee: p.annee, mois: p.mois, reference: ref }));
  ajouter("ETATS_EXCEL", `Etats_paie_${base}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Buffer.from(await PER.exportEtatsXlsx(tid, p, "fr")));
  if (ov) {
    ajouter("ORDRE_VIREMENT", `Ordre_de_virement_${slug(ov.numero)}_${base}.pdf`, "application/pdf", await ordreVirementPdf({ ...ov, statut: "VALIDE", date_creation: ov.date_creation }, entete));
  }
  return fichiers;
}

async function cloturer(tid, userId, periodeId, options = {}) {
  const p = await PER.chargerPeriode(tid, periodeId);
  if (p.statut === "CLOTUREE") throw new PaieError("PAIE_PERIODE_CLOTUREE", 409);
  if (p.statut !== "VALIDEE") throw new PaieError("PAIE_CLOTURE_PERIODE_NON_VALIDEE", 409);
  const eov = await etatOrdreVirement(tid, p);
  if (eov.requis && !eov.present) throw new PaieError("PAIE_CLOTURE_OV_REQUIS", 409);
  if (eov.requis && !eov.coherent) throw new PaieError("PAIE_CLOTURE_OV_OBSOLETE", 409);
  let ov = null;
  if (eov.requis) ov = (await db.query(`SELECT * FROM rh_ordre_virement WHERE id = $1 AND tenant_id = $2`, [p.ordre_virement_id, tid])).rows[0];

  const fichiers = await fabriquerImprimables(tid, p, { ov, options });
  const empreinte = empreinteGlobale(fichiers);

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const cur = (await client.query(`SELECT statut FROM paie_periode WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [p.id, tid])).rows[0];
    if (!cur || cur.statut !== "VALIDEE") throw new PaieError("PAIE_CLOTURE_PERIODE_NON_VALIDEE", 409);
    for (const f of fichiers) {
      await client.query(
        `INSERT INTO paie_archive_fichier (id, tenant_id, periode_id, type, employe_id, nom_fichier, mime, taille, sha256, contenu) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [uuidv4(), tid, p.id, f.type, f.employe_id, f.nom_fichier, f.mime, f.taille, f.sha256, f.contenu]
      );
    }
    if (ov) await client.query(`UPDATE rh_ordre_virement SET statut = 'VALIDE', date_validation = now(), date_modification = now() WHERE id = $1 AND tenant_id = $2 AND statut = 'BROUILLON'`, [ov.id, tid]);
    await client.query(
      `UPDATE paie_periode SET statut = 'CLOTUREE', date_cloture = now(), cloture_par = $3, empreinte_archive = $4, nb_fichiers_archive = $5 WHERE id = $1 AND tenant_id = $2`,
      [p.id, tid, userId || null, empreinte, fichiers.length]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  // Ecriture comptable de paie (OD en instance) : ne bloque jamais la cloture.
  const comptabilite = await COMPTA.genererSilencieux(tid, userId, periodeId);
  return { periode: await PER.chargerPeriode(tid, periodeId), nb_fichiers: fichiers.length, empreinte, comptabilite };
}

// ------------------------------------------------------------------------------------------------ archives
async function listerArchive(tid, periodeId) {
  const p = await PER.chargerPeriode(tid, periodeId);
  const r = await db.query(
    `SELECT a.id, a.type, a.employe_id, a.nom_fichier, a.mime, a.taille, a.sha256, a.date_creation, e.matricule, COALESCE(e.nom, '') AS nom, COALESCE(e.prenom, '') AS prenom,
            ac.date_consultation, ac.date_accuse
     FROM paie_archive_fichier a LEFT JOIN employe e ON e.id = a.employe_id
     LEFT JOIN paie_bulletin_accuse ac ON ac.periode_id = a.periode_id AND ac.employe_id = a.employe_id
     WHERE a.tenant_id = $1 AND a.periode_id = $2 ORDER BY a.type, e.nom, e.prenom, a.nom_fichier`,
    [tid, p.id]
  );
  return { periode: { id: p.id, annee: p.annee, mois: p.mois, statut: p.statut, date_cloture: p.date_cloture, empreinte_archive: p.empreinte_archive, nb_fichiers_archive: p.nb_fichiers_archive }, fichiers: r.rows.map((f) => ({ ...f, taille: Number(f.taille) })) };
}

async function fichierArchive(tid, periodeId, fid) {
  if (!/^[0-9a-f-]{36}$/i.test(String(fid))) throw new PaieError("PAIE_ARCHIVE_INTROUVABLE", 404);
  const r = await db.query(`SELECT * FROM paie_archive_fichier WHERE id = $1 AND tenant_id = $2 AND periode_id = $3`, [fid, tid, periodeId]);
  if (!r.rows[0]) throw new PaieError("PAIE_ARCHIVE_INTROUVABLE", 404);
  return r.rows[0];
}

async function zipArchive(tid, periodeId) {
  const p = await PER.chargerPeriode(tid, periodeId);
  const r = await db.query(`SELECT type, nom_fichier, contenu, sha256 FROM paie_archive_fichier WHERE tenant_id = $1 AND periode_id = $2 ORDER BY type, nom_fichier`, [tid, p.id]);
  if (!r.rows.length) throw new PaieError("PAIE_ARCHIVE_VIDE", 404);
  const base = `Paie_${p.annee}-${String(p.mois).padStart(2, "0")}`;
  const entrees = r.rows.map((f) => ({ nom: `${base}/${DOSSIER[f.type] || "Divers"}/${f.nom_fichier}`, contenu: f.contenu }));
  const manifeste = ["Archive de paie - " + base, `Empreinte globale SHA-256 : ${p.empreinte_archive || "(periode non cloturee)"}`, ""]
    .concat(r.rows.map((f) => `${f.sha256}  ${DOSSIER[f.type] || "Divers"}/${f.nom_fichier}`)).join("\n");
  entrees.push({ nom: `${base}/EMPREINTES.txt`, contenu: Buffer.from(manifeste, "utf8") });
  return { nom: `${base}.zip`, contenu: creerZip(entrees) };
}

/** Controle d'integrite : recalcule l'empreinte de chaque fichier et l'empreinte globale, compare a la cloture. */
async function verifierArchive(tid, periodeId) {
  const p = await PER.chargerPeriode(tid, periodeId);
  const r = await db.query(`SELECT id, type, employe_id, nom_fichier, sha256, contenu FROM paie_archive_fichier WHERE tenant_id = $1 AND periode_id = $2 ORDER BY nom_fichier`, [tid, p.id]);
  const anomalies = [];
  const recalcules = r.rows.map((f) => {
    const h = sha256(f.contenu);
    if (h !== f.sha256) anomalies.push({ fichier: f.nom_fichier, code: "EMPREINTE_FICHIER" });
    return { type: f.type, employe_id: f.employe_id, sha256: h };
  });
  const globale = empreinteGlobale(recalcules);
  if (p.statut !== "CLOTUREE") return { ok: false, cloturee: false, nb_fichiers: r.rows.length, anomalies };
  if (globale !== p.empreinte_archive) anomalies.push({ code: "EMPREINTE_GLOBALE" });
  if (r.rows.length !== Number(p.nb_fichiers_archive)) anomalies.push({ code: "NOMBRE_FICHIERS", attendu: Number(p.nb_fichiers_archive), trouve: r.rows.length });
  return { ok: anomalies.length === 0, cloturee: true, nb_fichiers: r.rows.length, empreinte: globale, empreinte_cloture: p.empreinte_archive, anomalies };
}

/** Archives de toutes les periodes (liste des mois clotures avec leurs empreintes). */
async function listerArchives(tid) {
  const r = await db.query(
    `SELECT p.id, p.annee, p.mois, p.statut, p.date_cloture, p.empreinte_archive, p.nb_fichiers_archive,
            (SELECT COUNT(*) FROM paie_bulletin b WHERE b.periode_id = p.id) AS nb_bulletins,
            (SELECT COALESCE(SUM(b.net_a_payer),0) FROM paie_bulletin b WHERE b.periode_id = p.id) AS total_net
     FROM paie_periode p WHERE p.tenant_id = $1 AND p.statut = 'CLOTUREE' ORDER BY p.annee DESC, p.mois DESC`,
    [tid]
  );
  return r.rows.map((x) => ({ ...x, nb_bulletins: Number(x.nb_bulletins), total_net: Number(x.total_net), nb_fichiers_archive: Number(x.nb_fichiers_archive) }));
}

module.exports = { valider, rouvrir, cloturer, etatOrdreVirement, listerArchive, listerArchives, fichierArchive, zipArchive, verifierArchive, fabriquerImprimables, empreinteGlobale };
