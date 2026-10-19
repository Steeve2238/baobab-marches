"use client";

import { Champ, Section, grille, inputStyle, boutonLeger, fmtMontant } from "./rhUi";

const MODES = ["FORFAIT", "TAUX_JOUR", "TAUX_HORAIRE", "MENSUEL"];
const DEVISES = ["XOF", "EUR", "USD"];
const jour = (v) => (v ? String(v).slice(0, 10) : "");
const txt = (v) => (v == null ? "" : String(v));

export function prestationFormInitial(c) {
  const f = c || {};
  return {
    fournisseur_id: f.fournisseur_id || "",
    forme: f.forme || "PERSONNE_PHYSIQUE",
    prestataire_nom: txt(f.prestataire_nom),
    prestataire_adresse: txt(f.prestataire_adresse),
    prestataire_ninea: txt(f.prestataire_ninea),
    prestataire_rccm: txt(f.prestataire_rccm),
    prestataire_piece: txt(f.prestataire_piece),
    prestataire_qualification: txt(f.prestataire_qualification),
    representant: txt(f.representant),
    qualite_representant: txt(f.qualite_representant),
    prestataire_telephone: txt(f.prestataire_telephone),
    prestataire_email: txt(f.prestataire_email),
    prestataire_paiement: txt(f.prestataire_paiement),
    objet: txt(f.objet),
    missions: txt(f.missions),
    livrables: txt(f.livrables),
    lieu_execution: txt(f.lieu_execution),
    date_contrat: jour(f.date_contrat),
    date_effet: jour(f.date_effet),
    date_fin: jour(f.date_fin),
    tacite_reconduction: !!f.tacite_reconduction,
    preavis_jours: String(f.preavis_jours != null ? f.preavis_jours : 30),
    sous_traitance_autorisee: !!f.sous_traitance_autorisee,
    propriete_livrables: f.propriete_livrables || "ENTREPRISE",
    mode_honoraires: f.mode_honoraires || "FORFAIT",
    montant: f.montant != null ? String(Number(f.montant)) : "",
    quantite_estimee: f.quantite_estimee != null ? String(Number(f.quantite_estimee)) : "",
    devise: f.devise || "XOF",
    montants_ttc: !!f.montants_ttc,
    tva_applicable: !!f.tva_applicable,
    retenue_taux: f.retenue_taux != null ? String(Number(f.retenue_taux)) : "",
    frais_remboursables: !!f.frais_remboursables,
    delai_paiement_jours: String(f.delai_paiement_jours != null ? f.delai_paiement_jours : 30),
    penalite_retard_pct: f.penalite_retard_pct != null ? String(Number(f.penalite_retard_pct)) : "",
    echeancier: (f.echeancier_json || f.echeancier || []).map((l) => ({ libelle: l.libelle, date: jour(l.date), montant: String(l.montant) })),
    clauses_particulieres: txt(f.clauses_particulieres),
    juridiction: txt(f.juridiction),
    lieu_signature: txt(f.lieu_signature),
    notes: txt(f.notes),
  };
}

export function prestationFormVersCorps(form) {
  const nombreOuNull = (v) => (v === "" || v == null ? null : Number(v));
  return {
    ...form,
    fournisseur_id: form.fournisseur_id || null,
    date_fin: form.date_fin || null,
    preavis_jours: Number(form.preavis_jours) || 0,
    delai_paiement_jours: Number(form.delai_paiement_jours) || 0,
    montant: Number(form.montant) || 0,
    quantite_estimee: form.mode_honoraires === "FORFAIT" ? null : nombreOuNull(form.quantite_estimee),
    retenue_taux: nombreOuNull(form.retenue_taux),
    penalite_retard_pct: nombreOuNull(form.penalite_retard_pct),
    echeancier: form.echeancier.filter((l) => l.libelle.trim()).map((l) => ({ libelle: l.libelle, date: l.date || null, montant: Number(l.montant) || 0 })),
  };
}

function Case({ label, checked, onChange, disabled }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: disabled ? "default" : "pointer" }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export default function PrestationForm({ form, setForm, t, lectureSeule, fournisseurs = [] }) {
  const maj = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dis = !!lectureSeule;
  const pp = form.forme === "PERSONNE_PHYSIQUE";
  const forfait = form.mode_honoraires === "FORFAIT";
  const totalEch = form.echeancier.reduce((s, l) => s + (Number(l.montant) || 0), 0);
  const estime = forfait ? Number(form.montant) || 0 : form.quantite_estimee !== "" ? Math.round((Number(form.montant) || 0) * Number(form.quantite_estimee)) : null;
  const inp = (k, extra) => <input style={inputStyle} disabled={dis} value={form[k]} onChange={(e) => maj(k, e.target.value)} {...extra} />;

  function changerForme(valeur) {
    setForm((f) => {
      const n = { ...f, forme: valeur };
      // Proposition de retenue : 5 % pour une personne physique ; aucune pour une societe (modifiable).
      if (valeur === "PERSONNE_PHYSIQUE" && (f.retenue_taux === "" || f.retenue_taux === "0")) n.retenue_taux = "5";
      if (valeur === "SOCIETE" && f.retenue_taux === "5") n.retenue_taux = "";
      return n;
    });
  }
  function choisirFournisseur(id) {
    const f = fournisseurs.find((x) => x.id === id);
    setForm((cur) => ({ ...cur, fournisseur_id: id, prestataire_nom: f && !cur.prestataire_nom ? f.nom : cur.prestataire_nom }));
  }
  const majEch = (i, k, v) => setForm((f) => ({ ...f, echeancier: f.echeancier.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Section titre={t("prsSecPrestataire")}>
        <div style={grille}>
          <Champ label={t("prsForme")}>
            <select style={inputStyle} disabled={dis} value={form.forme} onChange={(e) => changerForme(e.target.value)}>
              <option value="PERSONNE_PHYSIQUE">{t("prsForme_PERSONNE_PHYSIQUE")}</option>
              <option value="SOCIETE">{t("prsForme_SOCIETE")}</option>
            </select>
          </Champ>
          {fournisseurs.length > 0 && (
            <Champ label={t("prsFournisseur")}>
              <select style={inputStyle} disabled={dis} value={form.fournisseur_id} onChange={(e) => choisirFournisseur(e.target.value)}>
                <option value="">{t("prsAucunFournisseur")}</option>
                {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
              </select>
            </Champ>
          )}
          <Champ label={t("prsNom")} requis large>{inp("prestataire_nom")}</Champ>
          {pp ? (
            <>
              <Champ label={t("prsQualification")}>{inp("prestataire_qualification")}</Champ>
              <Champ label={t("prsPiece")}>{inp("prestataire_piece")}</Champ>
            </>
          ) : (
            <>
              <Champ label={t("prsRepresentant")} requis>{inp("representant")}</Champ>
              <Champ label={t("prsQualiteRepresentant")}>{inp("qualite_representant")}</Champ>
              <Champ label={t("prsRccm")}>{inp("prestataire_rccm")}</Champ>
            </>
          )}
          <Champ label={t("prsNinea")}>{inp("prestataire_ninea")}</Champ>
          <Champ label={t("prsAdresse")} large>{inp("prestataire_adresse")}</Champ>
          <Champ label={t("prsTelephone")}>{inp("prestataire_telephone")}</Champ>
          <Champ label={t("prsEmail")}>{inp("prestataire_email", { type: "email" })}</Champ>
          <Champ label={t("prsPaiement")} large>{inp("prestataire_paiement")}</Champ>
        </div>
      </Section>

      <Section titre={t("prsSecMission")}>
        <div style={grille}>
          <Champ label={t("prsObjet")} requis large>{inp("objet")}</Champ>
          <Champ label={t("prsMissions")} large>
            <textarea style={{ ...inputStyle, minHeight: 80 }} disabled={dis} value={form.missions} onChange={(e) => maj("missions", e.target.value)} />
          </Champ>
          <Champ label={t("prsLivrables")} large>
            <textarea style={{ ...inputStyle, minHeight: 60 }} disabled={dis} value={form.livrables} onChange={(e) => maj("livrables", e.target.value)} />
          </Champ>
          <Champ label={t("prsLieuExecution")}>{inp("lieu_execution")}</Champ>
          <Champ label={t("prsDateContrat")}>{inp("date_contrat", { type: "date" })}</Champ>
          <Champ label={t("prsDateEffet")} requis>{inp("date_effet", { type: "date" })}</Champ>
          <Champ label={t("prsDateFin")}>{inp("date_fin", { type: "date" })}</Champ>
          <Champ label={t("prsPreavis")}>{inp("preavis_jours", { type: "number", min: 0 })}</Champ>
          <Champ label={t("prsPropriete")}>
            <select style={inputStyle} disabled={dis} value={form.propriete_livrables} onChange={(e) => maj("propriete_livrables", e.target.value)}>
              <option value="ENTREPRISE">{t("prsPropriete_ENTREPRISE")}</option>
              <option value="PRESTATAIRE_LICENCE">{t("prsPropriete_PRESTATAIRE_LICENCE")}</option>
            </select>
          </Champ>
          <div style={{ display: "grid", gap: 8, alignContent: "end" }}>
            <Case label={t("prsTacite")} checked={form.tacite_reconduction} disabled={dis || !form.date_fin} onChange={(v) => maj("tacite_reconduction", v)} />
            <Case label={t("prsSousTraitance")} checked={form.sous_traitance_autorisee} disabled={dis} onChange={(v) => maj("sous_traitance_autorisee", v)} />
          </div>
        </div>
      </Section>

      <Section titre={t("prsSecHonoraires")}>
        <div style={grille}>
          <Champ label={t("prsMode")}>
            <select style={inputStyle} disabled={dis} value={form.mode_honoraires} onChange={(e) => maj("mode_honoraires", e.target.value)}>
              {MODES.map((m) => <option key={m} value={m}>{t(`prsMode_${m}`)}</option>)}
            </select>
          </Champ>
          <Champ label={forfait ? t("prsMontantForfait") : t("prsMontantUnitaire")} requis>{inp("montant", { type: "number", min: 0, step: 1 })}</Champ>
          {!forfait && <Champ label={t(`prsQuantite_${form.mode_honoraires}`)}>{inp("quantite_estimee", { type: "number", min: 0, step: "0.5" })}</Champ>}
          <Champ label={t("prsDevise")}>
            <select style={inputStyle} disabled={dis} value={form.devise} onChange={(e) => maj("devise", e.target.value)}>
              {DEVISES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Champ>
          <Champ label={t("prsRetenue")}>{inp("retenue_taux", { type: "number", min: 0, max: 100, step: "0.5" })}</Champ>
          <Champ label={t("prsDelaiPaiement")}>{inp("delai_paiement_jours", { type: "number", min: 0 })}</Champ>
          <Champ label={t("prsPenalite")}>{inp("penalite_retard_pct", { type: "number", min: 0, max: 100, step: "0.5" })}</Champ>
          <div style={{ display: "grid", gap: 8, alignContent: "end" }}>
            <Case label={t("prsTtc")} checked={form.montants_ttc} disabled={dis} onChange={(v) => maj("montants_ttc", v)} />
            <Case label={t("prsTva")} checked={form.tva_applicable} disabled={dis} onChange={(v) => maj("tva_applicable", v)} />
            <Case label={t("prsFrais")} checked={form.frais_remboursables} disabled={dis} onChange={(v) => maj("frais_remboursables", v)} />
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "8px 0 0" }}>{t("prsRetenueAide")}</p>
        {estime != null && estime > 0 && !forfait && (
          <p style={{ fontSize: 12.5, margin: "8px 0 0" }}>{t("prsEstime")} : <b className="mono">{fmtMontant(estime)} {form.devise}</b></p>
        )}

        <h3 style={{ fontSize: 12.5, margin: "16px 0 8px" }}>{t("prsEchSection")}</h3>
        <div style={{ display: "grid", gap: 8 }}>
          {form.echeancier.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, alignItems: "center" }}>
              <input style={inputStyle} disabled={dis} placeholder={t("prsEchLibelle")} value={l.libelle} onChange={(e) => majEch(i, "libelle", e.target.value)} />
              <input style={inputStyle} disabled={dis} type="date" value={l.date} onChange={(e) => majEch(i, "date", e.target.value)} />
              <input style={inputStyle} disabled={dis} type="number" min={0} placeholder={t("prsEchMontant")} value={l.montant} onChange={(e) => majEch(i, "montant", e.target.value)} />
              {!dis && <button type="button" style={{ ...boutonLeger, color: "var(--brique)" }} onClick={() => setForm((f) => ({ ...f, echeancier: f.echeancier.filter((_, j) => j !== i) }))}>×</button>}
            </div>
          ))}
          {form.echeancier.length > 0 && (
            <div style={{ fontSize: 12.5, display: "flex", justifyContent: "space-between", maxWidth: 520, fontWeight: 700 }}>
              <span>{t("prsEchTotal")}</span><span className="mono">{fmtMontant(totalEch)} {form.devise}</span>
            </div>
          )}
          {!dis && (
            <div>
              <button type="button" style={boutonLeger} onClick={() => setForm((f) => ({ ...f, echeancier: [...f.echeancier, { libelle: "", date: "", montant: "" }] }))}>{t("prsEchAjouter")}</button>
            </div>
          )}
        </div>
      </Section>

      <Section titre={t("prsSecAutres")}>
        <div style={grille}>
          <Champ label={t("prsClauses")} large>
            <textarea style={{ ...inputStyle, minHeight: 80 }} disabled={dis} value={form.clauses_particulieres} onChange={(e) => maj("clauses_particulieres", e.target.value)} />
          </Champ>
          <Champ label={t("prsJuridiction")}>{inp("juridiction")}</Champ>
          <Champ label={t("prsLieuSignature")}>{inp("lieu_signature")}</Champ>
          <Champ label={t("prsNotes")} large>
            <textarea style={{ ...inputStyle, minHeight: 50 }} disabled={dis} value={form.notes} onChange={(e) => maj("notes", e.target.value)} />
          </Champ>
        </div>
      </Section>
    </div>
  );
}
