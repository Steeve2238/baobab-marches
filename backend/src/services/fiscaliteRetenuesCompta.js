/**
 * Module Fiscalite, lot 4 (suite) : retenues a la source recherchees dans le grand livre.
 *
 * Principe (pratique comptable courante) : la prestation est enregistree au BRUT en charge (6057, 63...), la retenue au credit
 * du 447 et le fournisseur (401) au NET. La base de la retenue est donc le brut de la charge, jamais le solde du 401.
 * Analyse piece par piece, source = comptabilite de la plateforme ou grand livre importe :
 *   - charge de prestation (ou de loyer) au debit, retenue au credit du 447, 401 au credit ;
 *   - la retenue se fait au PAIEMENT : les reglements (debit du 401) sont affectes aux factures les plus anciennes du meme
 *     tiers (FIFO) et la ligne est rattachee au mois du reglement, au prorata du montant regle ;
 *   - une retenue comptabilisee au moment du reglement (credit du 447 dans la piece de paiement) est rapprochee de la facture ;
 *   - paiement comptant (charge au debit, banque ou caisse au credit, sans 401) : rattache a la date de la piece.
 * Situations : COMPLETE (447 = retenue attendue), RETENUE_NON_COMPTABILISEE (pas de 447), ECART_447, SANS_CHARGE (447 sans
 * charge analysee : brut presume = retenue / 5 %). Toute ligne est proposee, jamais retenue d'office : base brute presumee,
 * alerte tant que l'utilisateur n'a pas confirme.
 */
const db = require("../db");
const { FiscaliteError } = require("./fiscaliteTva");
const base = require("./fiscaliteRetenues");

const num = (v) => Number(v || 0);
const arrondi = (v) => Math.round(num(v));
const pad = (n) => String(n).padStart(2, "0");
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const PAYS_LOCAUX = new Set(["", "sn", "sen", "senegal"]);
const TOLERANCE = 1;
const FENETRE_MOIS = 24;

const commence = (compte, prefixes) => prefixes.some((p) => String(compte).startsWith(p));

function dateMoinsMois(iso, mois) {
  const [a, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
  const total = a * 12 + (m - 1) - mois;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`;
}

/** Lignes du grand livre sur la fenetre : comptabilite de la plateforme en priorite, sinon grand livre importe. */
async function chargerLignes(tenantId, debut, fin, parametres) {
  const prefixes = ["401", ...(parametres.comptes_tva || ["445"]), "66", "42", "43", ...parametres.comptes_prestations, ...parametres.comptes_loyers, ...parametres.comptes_retenue, "52", "57", "53"];
  const regex = `^(${[...new Set(prefixes)].join("|")})`;
  const t = await db.query(`SELECT module_comptabilite_actif AS a FROM tenant WHERE id = $1`, [tenantId]);
  if (t.rows[0] && t.rows[0].a) {
    const r = await db.query(
      `SELECT e.id AS piece_id, e.numero_piece, e.libelle AS libelle_piece, e.date_ecriture::text AS d, c.numero AS compte, l.debit, l.credit,
              COALESCE(tc.nom, '') AS tiers_nom, fo.pays, fo.regime_fiscal, fo.ninea
       FROM ligne_ecriture l
       JOIN ecriture_comptable e ON e.id = l.ecriture_id
       JOIN compte_comptable c ON c.id = l.compte_id
       LEFT JOIN tiers_comptable tc ON tc.id = l.tiers_id
       LEFT JOIN fournisseur fo ON fo.id = tc.fournisseur_id
       WHERE l.tenant_id = $1 AND e.statut = 'VALIDEE' AND e.date_ecriture BETWEEN $2 AND $3 AND c.numero ~ $4
       ORDER BY e.date_ecriture, e.numero_ecriture, l.ordre`,
      [tenantId, debut, fin, regex]
    );
    if (r.rows.length > 0) {
      return {
        source: "COMPTABILITE",
        lignes: r.rows.map((x) => ({
          piece_key: `E:${x.piece_id}`,
          numero: x.numero_piece || "",
          libelle: x.libelle_piece || "",
          date: x.d,
          compte: String(x.compte),
          debit: num(x.debit),
          credit: num(x.credit),
          tiers_nom: x.tiers_nom || "",
          profil: x.pays !== null || x.regime_fiscal ? { pays: x.pays, regime: x.regime_fiscal, ninea: x.ninea } : null,
        })),
      };
    }
  }
  const r = await db.query(
    `SELECT l.id, l.journal, l.piece, l.libelle, l.date_ecriture::text AS d, l.compte, l.debit, l.credit, COALESCE(l.tiers, '') AS tiers_nom
     FROM fiscalite_import_ligne l JOIN fiscalite_import_jeu j ON j.id = l.jeu_id AND j.actif AND j.nature = 'GRAND_LIVRE'
     WHERE l.tenant_id = $1 AND l.date_ecriture BETWEEN $2 AND $3 AND l.compte ~ $4
     ORDER BY l.date_ecriture, l.id`,
    [tenantId, debut, fin, regex]
  );
  if (r.rows.length > 0) {
    return {
      source: "IMPORT",
      lignes: r.rows.map((x) => ({
        piece_key: x.piece ? `I:${x.journal || ""}|${x.piece}` : `I:ligne${x.id}`,
        numero: x.piece || "",
        libelle: x.libelle || "",
        date: x.d,
        compte: String(x.compte),
        debit: num(x.debit),
        credit: num(x.credit),
        tiers_nom: x.tiers_nom || "",
        profil: null,
      })),
    };
  }
  return { source: "AUCUNE", lignes: [] };
}

/** Regroupe les lignes par piece et en extrait les montants utiles. */
function construirePieces(lignes, parametres) {
  const pieces = new Map();
  for (const l of lignes) {
    if (!pieces.has(l.piece_key)) pieces.set(l.piece_key, { key: l.piece_key, numero: l.numero, libelle: l.libelle, date: l.date, lignes: [] });
    pieces.get(l.piece_key).lignes.push(l);
  }
  for (const p of pieces.values()) {
    p.brut_prestation = 0;
    p.brut_loyer = 0;
    p.credit401 = 0;
    p.debit401 = 0;
    p.retenue447 = 0;
    p.tva = 0;
    p.tresorerie = 0;
    p.personnel = false;
    p.tiers401 = "";
    p.compte401 = "";
    p.tiers_nom = "";
    p.profil = null;
    for (const l of p.lignes) {
      if (l.tiers_nom && !p.tiers_nom) p.tiers_nom = l.tiers_nom;
      if (l.profil && !p.profil) p.profil = l.profil;
      if (commence(l.compte, parametres.comptes_loyers)) p.brut_loyer += l.debit - l.credit;
      else if (commence(l.compte, parametres.comptes_prestations)) p.brut_prestation += l.debit - l.credit;
      if (commence(l.compte, ["401"])) {
        p.credit401 += l.credit;
        p.debit401 += l.debit;
        if (l.tiers_nom && !p.tiers401) p.tiers401 = l.tiers_nom;
        if (!p.compte401) p.compte401 = l.compte;
      }
      if (commence(l.compte, parametres.comptes_retenue)) p.retenue447 += l.credit - l.debit;
      if (commence(l.compte, parametres.comptes_tva || ["445"])) p.tva += l.debit - l.credit;
      if (commence(l.compte, ["52", "53", "57"])) p.tresorerie += l.credit - l.debit;
      if (commence(l.compte, ["66", "42", "43"])) p.personnel = true;
    }
    p.cle_tiers = norm(p.tiers401) || p.compte401 || "";
    p.nom = p.tiers401 || p.tiers_nom || p.compte401 || "";
  }
  return pieces;
}

/**
 * Affecte chaque reglement (debit du 401) aux factures les plus anciennes du meme tiers.
 * Renvoie, par piece de facture, la liste des affectations { piece_paiement, date, montant, part447 }.
 */
function affecterReglements(pieces) {
  const parTiers = new Map();
  for (const p of pieces.values()) {
    if (!p.cle_tiers) continue;
    if (!parTiers.has(p.cle_tiers)) parTiers.set(p.cle_tiers, { factures: [], reglements: [] });
    const g = parTiers.get(p.cle_tiers);
    const estFacture = p.credit401 - p.debit401 > TOLERANCE;
    const estReglement = p.debit401 - p.credit401 > TOLERANCE;
    if (estFacture) g.factures.push({ piece: p, reste: p.credit401 - p.debit401 });
    else if (estReglement) g.reglements.push({ piece: p, reste: p.debit401 - p.credit401 });
  }
  const affectations = new Map();
  const consomme447 = new Map();
  for (const g of parTiers.values()) {
    g.factures.sort((a, b) => (a.piece.date < b.piece.date ? -1 : a.piece.date > b.piece.date ? 1 : 0));
    g.reglements.sort((a, b) => (a.piece.date < b.piece.date ? -1 : a.piece.date > b.piece.date ? 1 : 0));
    for (const r of g.reglements) {
      const total = r.reste;
      for (const f of g.factures) {
        if (r.reste <= TOLERANCE) break;
        if (f.reste <= TOLERANCE) continue;
        const montant = Math.min(r.reste, f.reste);
        r.reste -= montant;
        f.reste -= montant;
        const part447 = total > 0 ? (r.piece.retenue447 * montant) / total : 0;
        if (!affectations.has(f.piece.key)) affectations.set(f.piece.key, []);
        affectations.get(f.piece.key).push({ piece_paiement: r.piece, date: r.piece.date, montant, part447 });
        // La retenue du paiement n'est « consommee » que si la facture est analysee (charge dans les comptes retenus).
        if (f.piece.brut_prestation > TOLERANCE || f.piece.brut_loyer > TOLERANCE) consomme447.set(r.piece.key, (consomme447.get(r.piece.key) || 0) + part447);
      }
    }
  }
  return { affectations, consomme447 };
}

function profilBeneficiaire(profil, type) {
  const etranger = profil && profil.pays && !PAYS_LOCAUX.has(norm(profil.pays));
  if (etranger) return { type: type === "LOYER" ? "LOYER" : "NON_RESIDENT", statut: "NON_RESIDENT" };
  if (profil && ["REEL", "REEL_SIMPLIFIE", "REEL_NORMAL"].includes(profil.regime)) return { type, statut: "PP_REEL" };
  return { type, statut: type === "LOYER" ? "PP_SANS_REEL" : "PP_SANS_REEL" };
}

/**
 * Analyse le grand livre pour un mois et enregistre les lignes comme propositions (une seule fois par piece et par reglement).
 */
async function analyserMois(tenantId, userId, annee, mois) {
  const p = base.periodeValide(annee, mois);
  const verrou = await db.query(`SELECT statut FROM fiscalite_retenue_periode WHERE tenant_id = $1 AND annee = $2 AND mois = $3`, [tenantId, p.annee, p.mois]);
  if (verrou.rows[0] && ["DEPOSEE", "PAYEE"].includes(verrou.rows[0].statut)) throw new FiscaliteError("FISCALITE_DECLARATION_DEJA_DEPOSEE", 409);
  const doublon = await base.autreSourcePresente(tenantId, p, "PLATEFORME");
  if (doublon > 0) return { crees: 0, deja_traitees: 0, ignores: 0, analyses: 0, sans_paiement: 0, bloque: "PLATEFORME_PRESENTE", nombre: doublon };

  const parametres = await base.getParametres(tenantId);
  const { source, lignes } = await chargerLignes(tenantId, dateMoinsMois(p.fin, FENETRE_MOIS), p.fin, parametres);
  if (source === "AUCUNE") return { crees: 0, deja_traitees: 0, ignores: 0, analyses: 0, sans_paiement: 0, source };
  const pieces = construirePieces(lignes, parametres);
  const { affectations, consomme447 } = affecterReglements(pieces);

  const existantes = await db.query(`SELECT source_ref FROM fiscalite_retenue WHERE tenant_id = $1 AND source = 'COMPTA' AND source_ref IS NOT NULL`, [tenantId]);
  const deja = new Set(existantes.rows.map((x) => x.source_ref));
  let crees = 0;
  let dejaTraitees = 0;
  let ignores = 0;
  let analyses = 0;
  let sansPaiement = 0;

  async function proposer({ ref, type, date, nom, statutBenef, ninea, reference, libelle, brutPart, factureTtc, loyerMensuel, booked, controle }) {
    if (deja.has(ref)) {
      dejaTraitees++;
      return;
    }
    const op = { type, montant_brut: brutPart, montant_facture: factureTtc, loyer_mensuel: loyerMensuel, beneficiaire_statut: statutBenef, beneficiaire_ninea: ninea || "", beneficiaire_piece: "" };
    const calcul = base.evaluer(op);
    if (!calcul.due && booked < TOLERANCE) {
      ignores++;
      return;
    }
    const attendue = calcul.retenue;
    let situation = controle.situation;
    if (!situation) {
      if (booked < TOLERANCE) situation = "RETENUE_NON_COMPTABILISEE";
      else if (Math.abs(booked - attendue) <= TOLERANCE) situation = "COMPLETE";
      else situation = "ECART_447";
    }
    const taux = base.TYPES[type].taux;
    await base.creer(
      tenantId,
      userId,
      {
        type,
        date_operation: date,
        beneficiaire_nom: nom || "—",
        beneficiaire_ninea: ninea || "",
        beneficiaire_statut: statutBenef,
        reference,
        libelle,
        montant_brut: brutPart,
        montant_facture: factureTtc,
        loyer_mensuel: loyerMensuel,
        retenue_effectuee: Math.round(booked),
        statut: "PROPOSEE",
      },
      { source: "COMPTA", source_ref: ref, controle: { ...controle, situation, retenue_attendue: attendue, retenue_comptabilisee: Math.round(booked), brut_si_net: taux < 100 ? Math.round(brutPart / (1 - taux / 100)) : null } }
    );
    crees++;
  }

  for (const piece of pieces.values()) {
    const categories = [];
    if (piece.brut_prestation > TOLERANCE) categories.push(["PRESTATION_PP", piece.brut_prestation]);
    if (piece.brut_loyer > TOLERANCE) categories.push(["LOYER", piece.brut_loyer]);
    const factureAnalysee = categories.length > 0;

    if (factureAnalysee) {
      const brutTotal = categories.reduce((t, c) => t + c[1], 0);
      const comptant = piece.credit401 - piece.debit401 <= TOLERANCE && piece.tresorerie > TOLERANCE;
      // Chunks de paiement : affectations FIFO, ou piece unique pour un paiement comptant
      let chunks;
      if (comptant) chunks = [{ piece_paiement: piece, date: piece.date, montant: piece.tresorerie, part447: 0, comptant: true, part: 1 }];
      else chunks = (affectations.get(piece.key) || []).map((c) => ({ ...c, part: Math.min(1, c.montant / Math.max(piece.credit401 - piece.debit401, 1)) }));
      const factureTtc = arrondi(brutTotal + Math.max(piece.tva, 0));
      const enMois = chunks.filter((c) => c.date >= p.debut && c.date <= p.fin);
      if (chunks.length === 0 && piece.date >= p.debut && piece.date <= p.fin) sansPaiement++;
      for (const c of enMois) {
        analyses++;
        for (const [type, brut] of categories) {
          const profil = profilBeneficiaire(piece.profil, type);
          const part = c.part * (brut / brutTotal);
          const brutPart = arrondi(brut * c.part);
          const booked = piece.retenue447 * c.part * (brut / brutTotal) + c.part447 * (brut / brutTotal);
          void part;
          await proposer({
            ref: `C:${piece.key}:${type}:${c.comptant ? "comptant" : c.piece_paiement.key}`,
            type: profil.type,
            date: c.date,
            nom: piece.nom,
            statutBenef: profil.statut,
            ninea: piece.profil && piece.profil.ninea,
            reference: piece.numero || null,
            libelle: [piece.numero, piece.libelle].filter(Boolean).join(" — "),
            brutPart,
            factureTtc,
            loyerMensuel: type === "LOYER" ? arrondi(brut) : null,
            booked,
            controle: {
              piece: piece.numero,
              piece_paiement: c.comptant ? null : c.piece_paiement.numero,
              brut_charge: arrondi(brut),
              part_reglee: Math.round(c.part * 10000) / 10000,
              net_401: arrondi(piece.credit401),
              comptant: !!c.comptant,
            },
          });
        }
      }
    } else if (piece.retenue447 > TOLERANCE && !piece.personnel) {
      // 447 sans charge analysee : piece de retenue seule, ou piece de paiement dont la facture n'est pas dans les comptes analyses.
      const reste = piece.retenue447 - (consomme447.get(piece.key) || 0);
      if (reste > TOLERANCE && piece.date >= p.debut && piece.date <= p.fin) {
        analyses++;
        const taux = base.TYPES.PRESTATION_PP.taux;
        await proposer({
          ref: `C447:${piece.key}`,
          type: "PRESTATION_PP",
          date: piece.date,
          nom: piece.nom || piece.tiers_nom,
          statutBenef: "PP_SANS_REEL",
          ninea: piece.profil && piece.profil.ninea,
          reference: piece.numero || null,
          libelle: [piece.numero, piece.libelle].filter(Boolean).join(" — "),
          brutPart: arrondi((reste * 100) / taux),
          factureTtc: null,
          loyerMensuel: null,
          booked: reste,
          controle: { situation: "SANS_CHARGE", piece: piece.numero, net_401: arrondi(piece.credit401), brut_charge: null },
        });
      }
    }
  }
  return { source, crees, deja_traitees: dejaTraitees, ignores, analyses, sans_paiement: sansPaiement };
}

/** Confirme d'un coup les lignes de la comptabilite dont la retenue comptabilisee est conforme au calcul. */
async function confirmerCoherentes(tenantId, annee, mois) {
  const p = base.periodeValide(annee, mois);
  const verrou = await db.query(`SELECT statut FROM fiscalite_retenue_periode WHERE tenant_id = $1 AND annee = $2 AND mois = $3`, [tenantId, p.annee, p.mois]);
  if (verrou.rows[0] && ["DEPOSEE", "PAYEE"].includes(verrou.rows[0].statut)) throw new FiscaliteError("FISCALITE_DECLARATION_DEJA_DEPOSEE", 409);
  const r = await db.query(
    `UPDATE fiscalite_retenue SET statut = 'CONFIRMEE', date_modification = now()
     WHERE tenant_id = $1 AND source = 'COMPTA' AND statut = 'PROPOSEE' AND controle_json->>'situation' = 'COMPLETE' AND date_operation BETWEEN $2 AND $3`,
    [tenantId, p.debut, p.fin]
  );
  return { confirmees: r.rowCount };
}

module.exports = { analyserMois, confirmerCoherentes, construirePieces, affecterReglements };
