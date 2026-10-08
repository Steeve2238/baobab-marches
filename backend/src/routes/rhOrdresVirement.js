const express = require("express");
const XLSX = require("xlsx");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { requireAuth, requireModuleAny, exigerModulePaieActif } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { chargerEntete, prochainNumero, dateOuNull } = require("../services/rhCommun");
const { ordreVirementPdf } = require("../services/rhDocumentsPdf");

/**
 * RH lot 4 : ordres de virement (salaires, soldes de tout compte, autres paiements).
 * Un ordre reprend la date d'execution souhaitee, le compte de chaque salarie (fiche employe) et le montant.
 * Les montants sont saisis a la main pour l'instant ; le module Paie les alimentera avec les nets a payer.
 */
const router = express.Router();
router.use(requireAuth);
// Ordres de virement : module Paie (payant). Verrou limite au chemin (routeur monte sur /api/rh).
router.use("/ordres-virement", exigerModulePaieActif);
router.use("/ordres-virement", requireModuleAny("rh", "paie", "paie-validation"));

const TYPES = ["SALAIRE", "SOLDE_TOUT_COMPTE", "AUTRE"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const erreur = (req, res, err) => { console.error(err); res.status(500).json({ error: t(req, "RH_OV_ERREUR") }); };

function lignesValides(brut) {
  if (!Array.isArray(brut) || brut.length > 500) return null;
  const out = [];
  for (const l of brut) {
    const montant = Number(l.montant);
    if (!Number.isFinite(montant) || montant < 0) return null;
    out.push({
      employe_id: l.employe_id || null,
      nom: String(l.nom || "").trim().slice(0, 150),
      matricule: l.matricule ? String(l.matricule).trim().slice(0, 40) : null,
      banque: l.banque ? String(l.banque).trim().slice(0, 120) : "",
      numero_compte: l.numero_compte ? String(l.numero_compte).replace(/\s+/g, " ").trim().slice(0, 60) : "",
      montant: Math.round(montant),
      motif: l.motif ? String(l.motif).trim().slice(0, 200) : null,
    });
  }
  return out;
}

const totalDe = (lignes) => lignes.reduce((s, l) => s + (Number(l.montant) || 0), 0);

function avertissements(ov, lignes) {
  const a = [];
  if (lignes.length === 0) a.push({ niveau: "BLOQUANT", code: "AUCUNE_LIGNE" });
  if (!ov.banque_donneur) a.push({ niveau: "BLOQUANT", code: "BANQUE_DONNEUR" });
  if (!ov.compte_donneur) a.push({ niveau: "BLOQUANT", code: "COMPTE_DONNEUR" });
  const sansCompte = lignes.filter((l) => !l.numero_compte).length;
  if (sansCompte) a.push({ niveau: "BLOQUANT", code: "LIGNE_SANS_COMPTE", valeur: String(sansCompte) });
  const sansMontant = lignes.filter((l) => !(l.montant > 0)).length;
  if (sansMontant) a.push({ niveau: "BLOQUANT", code: "LIGNE_SANS_MONTANT", valeur: String(sansMontant) });
  const vus = new Set();
  const doublons = lignes.filter((l) => l.employe_id && (vus.has(l.employe_id) ? true : (vus.add(l.employe_id), false))).length;
  if (doublons) a.push({ niveau: "ATTENTION", code: "DOUBLON", valeur: String(doublons) });
  const comptes = new Set();
  const comptesDoubles = lignes.filter((l) => l.numero_compte && (comptes.has(l.numero_compte) ? true : (comptes.add(l.numero_compte), false))).length;
  if (comptesDoubles) a.push({ niveau: "ATTENTION", code: "COMPTE_DOUBLE", valeur: String(comptesDoubles) });
  if (ov.date_execution && String(ov.date_execution).slice(0, 10) < new Date().toISOString().slice(0, 10)) a.push({ niveau: "ATTENTION", code: "DATE_PASSEE" });
  return a;
}

async function charger(req, res) {
  const r = await db.query(`SELECT * FROM rh_ordre_virement WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.user.tenantId]);
  if (r.rows.length === 0) { res.status(404).json({ error: t(req, "RH_OV_INTROUVABLE") }); return null; }
  return r.rows[0];
}
const vue = (row) => ({ ...row, total: Number(row.total), avertissements: avertissements(row, row.lignes_json || []), nb_lignes: (row.lignes_json || []).length });

// Propose les salaries a payer par virement, avec leur compte (fiche employe). Montants a saisir.
router.get("/ordres-virement/prefill", async (req, res) => {
  try {
    const type = TYPES.includes(req.query.type_paiement) ? req.query.type_paiement : "SALAIRE";
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const periode = /^\d{4}-\d{2}$/.test(req.query.periode || "") ? req.query.periode : aujourdhui.slice(0, 7);
    const entete = await chargerEntete(req.user.tenantId);
    const base = {
      type_paiement: type, periode, date_execution: aujourdhui, banque_donneur: "", compte_donneur: "",
      coordonnees_bancaires: entete.coordonnees_bancaires || "", lignes: [], exclus: [],
    };
    if (req.query.courrier_id) {
      const c = await db.query(`SELECT c.*, e.nom AS e_nom, e.prenom AS e_prenom, e.matricule, e.banque, e.numero_compte, e.mode_paiement FROM rh_courrier c JOIN employe e ON e.id = c.employe_id WHERE c.id = $1 AND c.tenant_id = $2`, [req.query.courrier_id, req.user.tenantId]);
      if (!c.rows[0]) return res.status(404).json({ error: t(req, "RH_OV_INTROUVABLE") });
      const r = c.rows[0];
      const total = ((r.contenu_json && r.contenu_json.total) != null ? r.contenu_json.total : (r.lignes_json || []).reduce((s, l) => s + (Number(l.montant) || 0), 0));
      return res.json({
        ...base, type_paiement: "SOLDE_TOUT_COMPTE", libelle: `Solde de tout compte - ${[r.e_prenom, r.e_nom].filter(Boolean).join(" ")}`,
        lignes: [{ employe_id: r.employe_id, nom: [r.e_prenom, String(r.e_nom || "").toUpperCase()].filter(Boolean).join(" "), matricule: r.matricule, banque: r.banque || "", numero_compte: r.numero_compte || "", montant: Number(total) || 0, motif: `Solde de tout compte ${r.numero}` }],
      });
    }
    const [annee, mois] = periode.split("-").map(Number);
    const debutMois = `${periode}-01`;
    const emps = await db.query(
      `SELECT e.id, COALESCE(e.nom, u.nom) AS nom, COALESCE(e.prenom, u.prenom) AS prenom, e.matricule, e.banque, e.numero_compte, e.mode_paiement, e.statut, e.date_sortie
       FROM employe e LEFT JOIN utilisateur u ON u.id = e.utilisateur_id
       WHERE e.tenant_id = $1 AND e.statut = 'ACTIF' AND (e.date_sortie IS NULL OR e.date_sortie >= $2)
       ORDER BY COALESCE(e.nom, u.nom), COALESCE(e.prenom, u.prenom)`,
      [req.user.tenantId, debutMois]
    );
    const libelle = type === "SALAIRE" ? `Salaires ${MOIS[mois - 1]} ${annee}` : type === "SOLDE_TOUT_COMPTE" ? "Soldes de tout compte" : "Paiements";
    const out = { ...base, libelle };
    for (const e of emps.rows) {
      const nom = [e.prenom, String(e.nom || "").toUpperCase()].filter(Boolean).join(" ");
      if (e.mode_paiement && e.mode_paiement !== "VIREMENT") out.exclus.push({ employe_id: e.id, nom, raison: "MODE_PAIEMENT", valeur: e.mode_paiement });
      else out.lignes.push({ employe_id: e.id, nom, matricule: e.matricule, banque: e.banque || "", numero_compte: e.numero_compte || "", montant: 0, motif: type === "SALAIRE" ? `Salaire ${MOIS[mois - 1]} ${annee}` : null });
    }
    res.json(out);
  } catch (err) { erreur(req, res, err); }
});

router.get("/ordres-virement", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, numero, libelle, type_paiement, periode, date_execution, statut, total, jsonb_array_length(lignes_json) AS nb_lignes, source, date_creation
       FROM rh_ordre_virement WHERE tenant_id = $1 ORDER BY date_creation DESC LIMIT 300`,
      [req.user.tenantId]
    );
    res.json(r.rows.map((x) => ({ ...x, total: Number(x.total) })));
  } catch (err) { erreur(req, res, err); }
});

function champs(body, partiel) {
  const o = {};
  const bad = () => ({ erreur: true });
  if (!partiel || "libelle" in body) { o.libelle = body.libelle ? String(body.libelle).trim().slice(0, 200) : ""; if (!o.libelle) return bad(); }
  if (!partiel || "type_paiement" in body) { o.type_paiement = TYPES.includes(body.type_paiement) ? body.type_paiement : "SALAIRE"; }
  if ("periode" in body) { o.periode = /^\d{4}-\d{2}$/.test(body.periode || "") ? body.periode : null; }
  if (!partiel || "date_execution" in body) { const d = dateOuNull(body.date_execution); if (!d) return bad(); o.date_execution = d; }
  if ("banque_donneur" in body) o.banque_donneur = body.banque_donneur ? String(body.banque_donneur).trim().slice(0, 150) : null;
  if ("compte_donneur" in body) o.compte_donneur = body.compte_donneur ? String(body.compte_donneur).trim().slice(0, 60) : null;
  if ("notes" in body) o.notes = body.notes ? String(body.notes).slice(0, 2000) : null;
  if (!partiel || "lignes" in body) { const l = lignesValides(body.lignes); if (!l) return bad(); o.lignes_json = JSON.stringify(l); o.total = totalDe(l); }
  return o;
}

router.post("/ordres-virement", async (req, res) => {
  try {
    const o = champs(req.body, false);
    if (o.erreur) return res.status(400).json({ error: t(req, "RH_OV_CHAMP_INVALIDE") });
    const numero = await prochainNumero(req.user.tenantId, "ORDRE_VIREMENT", "OV");
    const id = uuidv4();
    await db.query(
      `INSERT INTO rh_ordre_virement (id, tenant_id, numero, libelle, type_paiement, periode, date_execution, banque_donneur, compte_donneur, lignes_json, total, notes, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [id, req.user.tenantId, numero, o.libelle, o.type_paiement, o.periode || null, o.date_execution, o.banque_donneur || null, o.compte_donneur || null, o.lignes_json, o.total, o.notes || null, req.user.sub]
    );
    res.status(201).json(vue((await db.query(`SELECT * FROM rh_ordre_virement WHERE id = $1`, [id])).rows[0]));
  } catch (err) { erreur(req, res, err); }
});

router.get("/ordres-virement/:id", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (row) res.json(vue(row));
  } catch (err) { erreur(req, res, err); }
});

router.patch("/ordres-virement/:id", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (row.statut !== "BROUILLON") return res.status(409).json({ error: t(req, "RH_OV_FIGE") });
    const o = champs(req.body, true);
    if (o.erreur) return res.status(400).json({ error: t(req, "RH_OV_CHAMP_INVALIDE") });
    const cles = Object.keys(o);
    if (cles.length) await db.query(`UPDATE rh_ordre_virement SET ${cles.map((c, i) => `${c} = $${i + 1}`).join(", ")}, date_modification = now() WHERE id = $${cles.length + 1}`, [...Object.values(o), row.id]);
    res.json(vue((await db.query(`SELECT * FROM rh_ordre_virement WHERE id = $1`, [row.id])).rows[0]));
  } catch (err) { erreur(req, res, err); }
});

router.delete("/ordres-virement/:id", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (row.statut !== "BROUILLON") return res.status(409).json({ error: t(req, "RH_OV_FIGE") });
    await db.query(`DELETE FROM rh_ordre_virement WHERE id = $1`, [row.id]);
    res.json({ ok: true });
  } catch (err) { erreur(req, res, err); }
});

router.post("/ordres-virement/:id/valider", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (row.statut !== "BROUILLON") return res.status(409).json({ error: t(req, "RH_OV_FIGE") });
    const v = vue(row);
    if (v.avertissements.some((a) => a.niveau === "BLOQUANT")) return res.status(422).json({ error: t(req, "RH_OV_BLOQUANT"), avertissements: v.avertissements });
    await db.query(`UPDATE rh_ordre_virement SET statut = 'VALIDE', date_validation = now(), date_modification = now() WHERE id = $1`, [row.id]);
    res.json(vue((await db.query(`SELECT * FROM rh_ordre_virement WHERE id = $1`, [row.id])).rows[0]));
  } catch (err) { erreur(req, res, err); }
});

router.post("/ordres-virement/:id/executer", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (row.statut !== "VALIDE") return res.status(409).json({ error: t(req, "RH_OV_ETAPE_INVALIDE") });
    const d = dateOuNull(req.body.date) || new Date().toISOString().slice(0, 10);
    await db.query(`UPDATE rh_ordre_virement SET statut = 'EXECUTE', date_execution_reelle = $1, date_modification = now() WHERE id = $2`, [d, row.id]);
    res.json(vue((await db.query(`SELECT * FROM rh_ordre_virement WHERE id = $1`, [row.id])).rows[0]));
  } catch (err) { erreur(req, res, err); }
});

router.post("/ordres-virement/:id/annuler", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    if (row.statut === "EXECUTE") return res.status(409).json({ error: t(req, "RH_OV_FIGE") });
    await db.query(`UPDATE rh_ordre_virement SET statut = 'ANNULE', date_modification = now() WHERE id = $1`, [row.id]);
    res.json(vue((await db.query(`SELECT * FROM rh_ordre_virement WHERE id = $1`, [row.id])).rows[0]));
  } catch (err) { erreur(req, res, err); }
});

router.get("/ordres-virement/:id/pdf", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    const buf = await ordreVirementPdf(row, await chargerEntete(req.user.tenantId));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${row.numero}.pdf"`);
    res.send(buf);
  } catch (err) { erreur(req, res, err); }
});

// Fichier Excel pour la banque (comptes en texte pour conserver les zeros).
router.get("/ordres-virement/:id/excel", async (req, res) => {
  try {
    const row = await charger(req, res);
    if (!row) return;
    const lignes = row.lignes_json || [];
    const aoa = [
      [`Ordre de virement ${row.numero}`],
      ["Libellé", row.libelle],
      ["Date d'exécution", String(row.date_execution).slice(0, 10)],
      ["Compte à débiter", [row.banque_donneur, row.compte_donneur].filter(Boolean).join(" - ")],
      [],
      ["N°", "Matricule", "Bénéficiaire", "Banque", "N° de compte", "Montant (F CFA)", "Motif"],
      ...lignes.map((l, i) => [i + 1, l.matricule || "", l.nom, l.banque, String(l.numero_compte || ""), Number(l.montant) || 0, l.motif || ""]),
      [],
      ["", "", "", "", "TOTAL", totalDe(lignes), ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 5 }, { wch: 12 }, { wch: 30 }, { wch: 22 }, { wch: 30 }, { wch: 16 }, { wch: 34 }];
    lignes.forEach((l, i) => {
      const ref = XLSX.utils.encode_cell({ r: 6 + i, c: 4 });
      if (ws[ref]) { ws[ref].t = "s"; }
      const m = XLSX.utils.encode_cell({ r: 6 + i, c: 5 });
      if (ws[m]) ws[m].z = "#,##0";
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ordre de virement");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${row.numero}.xlsx"`);
    res.send(buf);
  } catch (err) { erreur(req, res, err); }
});

module.exports = router;
