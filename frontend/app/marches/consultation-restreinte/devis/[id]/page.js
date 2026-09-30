"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../../lib/api";
import { useLangue } from "../../../../../lib/i18n/LanguageContext";
import { estAdmin, getUtilisateurCourant } from "../../../../../lib/api";
import AppShell from "../../../../../lib/components/AppShell";

// Formate une date "YYYY-MM-DD" en "JJ/MM/AAAA" sans jamais passer par un
// objet Date JS (qui reintroduirait une conversion de fuseau horaire cote
// navigateur) - voir le correctif equivalent cote serveur dans db.js.
function formaterDateAffichage(valeur) {
  if (!valeur) return "";
  const [annee, mois, jour] = String(valeur).slice(0, 10).split("-");
  return `${jour}/${mois}/${annee}`;
}

const STATUT_STYLE = {
  BROUILLON: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
  ENVOYE: { color: "var(--ocre)", background: "rgba(224,149,76,0.12)" },
  VALIDE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  REFUSE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  EXPIRE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};

// Meme palette que la page de liste des factures (factures/page.js) - reprise
// ici pour afficher le statut de chaque facture dans la liste "Factures de ce
// devis" (section ajoutee avec la facturation en plusieurs fois, migration
// 024).
const FACTURE_STATUT_STYLE = {
  IMPAYEE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  PAYEE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  ANNULEE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};

function possedeRole(codes) {
  if (estAdmin()) return true;
  const user = getUtilisateurCourant();
  return Array.isArray(user?.roles) && user.roles.some((r) => codes.includes(r));
}

export default function DevisDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useLangue();
  const [devis, setDevis] = useState(null);
  const [entete, setEntete] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [action, setAction] = useState(false);
  const [referenceBc, setReferenceBc] = useState("");
  // Facturation en plusieurs fois (acompte/solde) - demande de Steeve du
  // 30/09/2026 : un devis VALIDE peut desormais etre facture plusieurs fois
  // (un ou plusieurs acomptes a pourcentage variable selon la demande du
  // client, puis un solde), au lieu d'une seule facture integrale comme
  // avant. Voir migration 024 et POST /devis/:id/generer-facture.
  const [typeFacturation, setTypeFacturation] = useState("INTEGRALE");
  const [pourcentageAcompte, setPourcentageAcompte] = useState("");
  const [permissions, setPermissions] = useState(null);
  const [formOuvert, setFormOuvert] = useState(false);
  const [formDevis, setFormDevis] = useState(null);
  const [lignesEdition, setLignesEdition] = useState([]);
  const [enregistrementEdition, setEnregistrementEdition] = useState(false);

  function charger() {
    Promise.all([
      api.getDevis(params.id),
      api.getEntete(),
      api.getParametresVentes(),
      api.getPermissions().catch(() => null),
    ])
      .then(([devisData, enteteData, parametresData, permissionsData]) => {
        setDevis(devisData);
        setEntete({ ...enteteData, ...parametresData });
        setPermissions(permissionsData);
      })
      .catch((err) => {
        if (err.status === 401) {
          router.push("/login");
          return;
        }
        setErreur(err.message);
      })
      .finally(() => setChargement(false));
  }

  useEffect(charger, [params.id]);

  // Personnalise dynamiquement document.title (numero du devis + entreprise
  // du tenant) car document.title est injecte par le navigateur dans
  // l'en-tete/pied de page natif de l'impression - voir metadata globale
  // dans app/layout.js (titre "Baobab Marches" par defaut, ne pas modifier).
  useEffect(() => {
    if (!devis || !entete) return;
    const titrePrecedent = document.title;
    document.title = `${entete.raison_sociale || ""} - ${devis.numero}`.trim();
    return () => {
      document.title = titrePrecedent;
    };
  }, [devis, entete]);

  async function handleValider() {
    setAction(true);
    setErreur("");
    try {
      const maj = await api.validerDevis(devis.id);
      setDevis((prev) => ({ ...prev, ...maj }));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setAction(false);
    }
  }

  async function handleChangerStatut(statut) {
    setAction(true);
    setErreur("");
    try {
      const maj = await api.changerStatutDevis(devis.id, statut);
      setDevis((prev) => ({ ...prev, ...maj }));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setAction(false);
    }
  }

  async function handleGenererFacture() {
    setAction(true);
    setErreur("");
    try {
      const facture = await api.genererFactureDepuisDevis(devis.id, {
        reference_bc_client: referenceBc || null,
        type_facturation: typeFacturation,
        pourcentage_acompte: typeFacturation === "ACOMPTE" ? Number(pourcentageAcompte) : undefined,
      });
      router.push(`/marches/consultation-restreinte/factures/${facture.id}`);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setAction(false);
    }
  }

  function handleOuvrirEdition() {
    setFormDevis({
      objet: devis.objet || "",
      date_devis: (devis.date_devis || "").slice(0, 10),
      conditions_paiement: devis.conditions_paiement || "",
      delai_livraison: devis.delai_livraison || "",
      validite_offre: devis.validite_offre || "",
    });
    setLignesEdition(devis.lignes.map((l) => ({ ...l })));
    setFormOuvert(true);
  }

  function majLigneEdition(index, champ, valeur) {
    setLignesEdition((prev) => prev.map((l, i) => (i === index ? { ...l, [champ]: valeur } : l)));
  }

  function ajouterLigneEdition() {
    setLignesEdition((prev) => [...prev, { designation: "", unite: "U", quantite: 1, prix_unitaire_ht: "" }]);
  }

  function supprimerLigneEdition(index) {
    setLignesEdition((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleEnregistrerDevis(e) {
    e.preventDefault();
    setEnregistrementEdition(true);
    setErreur("");
    try {
      const maj = await api.patchDevis(devis.id, {
        ...formDevis,
        lignes: lignesEdition.map((l) => ({
          designation: l.designation,
          unite: l.unite,
          quantite: Number(l.quantite),
          prix_unitaire_ht: Number(l.prix_unitaire_ht),
        })),
      });
      setDevis(maj);
      setFormOuvert(false);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementEdition(false);
    }
  }

  if (chargement) {
    return (
      <AppShell title={t("venteDevisDetailTitle")} backHref="/marches/consultation-restreinte/devis">
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </AppShell>
    );
  }
  if (!devis) {
    return (
      <AppShell title={t("venteDevisDetailTitle")} backHref="/marches/consultation-restreinte/devis">
        {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      </AppShell>
    );
  }

  const style = STATUT_STYLE[devis.statut] || {};
  // Un devis Valide reste modifiable (chantier du 06/10/2026 avec Steeve :
  // corriger un devis deja entierement facture, ex avenant/ligne oubliee) -
  // seul un devis Expire reste fige. Voir PATCH /devis/:id : toute
  // modification d'un devis Valide le refait systematiquement repasser en
  // Brouillon, il doit etre revalide avant de pouvoir generer une nouvelle
  // facture dessus.
  const peutEditer = ["BROUILLON", "ENVOYE", "REFUSE", "VALIDE"].includes(devis.statut);
  // Boutons "Marquer envoye"/"Marquer refuse" (PATCH /devis/:id/statut) :
  // restes limites a leur perimetre d'origine, jamais un devis Valide - ce
  // sont des transitions manuelles simples sans le garde-fou de
  // PATCH /devis/:id (repassage en Brouillon + controle du deja facture),
  // le backend les refuse d'ailleurs explicitement pour un devis Valide.
  const peutChangerStatutSimple = ["BROUILLON", "ENVOYE", "REFUSE"].includes(devis.statut);
  // Validateur universel (Directeur General ou Directeur Financier - Phase 2
  // du systeme de permissions par role, 05/09/2026) : peut valider un devis
  // meme sans porter le code de role DIRECTION, en plus/back-up de celui-ci
  // (voir requireRoleOuValidateurUniversel cote backend). La validation reste
  // limitee a BROUILLON/ENVOYE (pas REFUSE - il faut d'abord repasser par
  // ENVOYE via un renvoi manuel), meme si peutEditer inclut desormais REFUSE.
  const peutValider =
    ["BROUILLON", "ENVOYE"].includes(devis.statut) &&
    (possedeRole(["DIRECTION"]) || !!permissions?.validateurUniversel);
  // "Reste a facturer" (calcule cote serveur, voir GET /devis/:id) plutot que
  // "pas encore de facture" : un devis VALIDE peut desormais avoir plusieurs
  // factures (acompte(s) + solde, migration 024) - on peut continuer a en
  // generer tant qu'il reste un montant non facture.
  const resteAFacturer = Number(devis.reste_a_facturer ?? devis.total_ttc);
  const peutFacturer = devis.statut === "VALIDE" && resteAFacturer > 0.009 && possedeRole(["COMPTABLE", "FINANCIER"]);

  return (
    <AppShell title={devis.numero} backHref="/marches/consultation-restreinte/devis">
      {erreur && <p className="no-print" style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, ...style }}>
            {t(`venteDevisStatut_${devis.statut}`)}
          </span>
          {devis.importe && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, color: "var(--sub)", background: "rgba(91,106,108,0.1)" }}>
              {t("venteDevisHistoriqueBadge")}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {peutChangerStatutSimple && (
            <button onClick={() => handleChangerStatut("ENVOYE")} disabled={action || devis.statut === "ENVOYE"} style={boutonSecondaireStyle}>
              {t("venteMarkSentButton")}
            </button>
          )}
          {peutChangerStatutSimple && devis.statut !== "REFUSE" && (
            <button onClick={() => handleChangerStatut("REFUSE")} disabled={action} style={boutonDangerStyle}>
              {t("venteMarkRefusedButton")}
            </button>
          )}
          {peutValider && (
            <button onClick={handleValider} disabled={action} style={boutonPrincipalStyle}>
              {t("venteValidateDevisButton")}
            </button>
          )}
          {peutEditer && (
            <button onClick={handleOuvrirEdition} style={boutonSecondaireStyle}>
              {t("venteDevisEditButton")}
            </button>
          )}
          <button onClick={() => window.print()} style={boutonSecondaireStyle}>
            {t("print")}
          </button>
        </div>
      </div>

      {devis.statut === "VALIDE" && (
        <div className="no-print card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 12 }}>
            <h3 style={{ fontSize: 13.5, color: "var(--petrol)", margin: 0 }}>{t("venteFacturesDevisSection")}</h3>
            <div style={{ display: "flex", gap: 20, fontSize: 12.5 }}>
              <div>
                <span style={{ color: "var(--sub)" }}>{t("venteDejaFactureLabel")} : </span>
                <span className="mono" style={{ fontWeight: 600 }}>{Number(devis.deja_facture || 0).toLocaleString()} XOF</span>
              </div>
              <div>
                <span style={{ color: "var(--sub)" }}>{t("venteResteAFacturerLabel")} : </span>
                <span className="mono" style={{ fontWeight: 600, color: resteAFacturer > 0.009 ? "var(--ocre)" : "#2E7D5B" }}>
                  {resteAFacturer.toLocaleString()} XOF
                </span>
              </div>
            </div>
          </div>

          {devis.factures && devis.factures.length > 0 ? (
            <div style={{ display: "grid", gap: 6, marginBottom: peutFacturer ? 16 : 0 }}>
              {devis.factures.map((f) => (
                <Link
                  key={f.id}
                  href={`/marches/consultation-restreinte/factures/${f.id}`}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 8, background: "var(--bg)" }}>
                    <div style={{ fontSize: 12.5 }}>
                      <span style={{ fontWeight: 600 }}>{f.numero}</span>
                      {f.type_facturation !== "INTEGRALE" && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: "var(--sub)" }}>
                          {t(`venteFactureType_${f.type_facturation}`)}
                          {f.type_facturation === "ACOMPTE" ? ` ${Number(f.pourcentage_acompte)}%` : ""}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <span className="mono" style={{ fontSize: 12.5 }}>{Number(f.montant_net_a_payer).toLocaleString()} XOF</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, ...FACTURE_STATUT_STYLE[f.statut] }}>
                        {t(`venteFactureStatut_${f.statut}`)}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: peutFacturer ? 16 : 0 }}>{t("venteAucuneFactureDevis")}</p>
          )}

          {peutFacturer ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", borderTop: "1px solid var(--line)", paddingTop: 14 }}>
              <div>
                <label style={labelStyle}>{t("venteTypeFacturationLabel")}</label>
                <select value={typeFacturation} onChange={(e) => setTypeFacturation(e.target.value)} style={inputStyleCompact}>
                  <option value="INTEGRALE">{t("venteTypeFacturationIntegrale")}</option>
                  <option value="ACOMPTE">{t("venteTypeFacturationAcompte")}</option>
                  <option value="SOLDE">{t("venteTypeFacturationSolde")}</option>
                </select>
              </div>
              {typeFacturation === "ACOMPTE" && (
                <div>
                  <label style={labelStyle}>{t("ventePourcentageAcompteLabel")}</label>
                  <input
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={pourcentageAcompte}
                    onChange={(e) => setPourcentageAcompte(e.target.value)}
                    style={{ ...inputStyleCompact, width: 90 }}
                  />
                </div>
              )}
              <div>
                <label style={labelStyle}>{t("venteReferenceBcPlaceholder")}</label>
                <input
                  value={referenceBc}
                  onChange={(e) => setReferenceBc(e.target.value)}
                  style={{ ...inputStyleCompact, width: 140 }}
                />
              </div>
              <button
                onClick={handleGenererFacture}
                disabled={action || (typeFacturation === "ACOMPTE" && (!pourcentageAcompte || Number(pourcentageAcompte) <= 0 || Number(pourcentageAcompte) > 100))}
                style={boutonPrincipalStyle}
              >
                {t("venteGenerateInvoiceButton")}
              </button>
            </div>
          ) : (
            resteAFacturer <= 0.009 && <p style={{ fontSize: 12.5, color: "#2E7D5B", fontWeight: 600, margin: 0 }}>{t("venteDevisEntierementFacture")}</p>
          )}
        </div>
      )}

      {formOuvert && (
        <form onSubmit={handleEnregistrerDevis} className="no-print card" style={{ marginBottom: 16 }}>
          {devis.statut === "VALIDE" && (
            <p
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--ocre)",
                background: "rgba(224,149,76,0.12)",
                borderRadius: 8,
                padding: "8px 12px",
                marginBottom: 14,
              }}
            >
              {t("venteDevisEditionRepasseBrouillonAvertissement")}
            </p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>{t("venteObjetLabel")}</label>
              <input value={formDevis.objet} onChange={(e) => setFormDevis((f) => ({ ...f, objet: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("venteDateDevisLabel")}</label>
              <input type="date" value={formDevis.date_devis} onChange={(e) => setFormDevis((f) => ({ ...f, date_devis: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("venteValiditeOffreLabel")}</label>
              <input value={formDevis.validite_offre} onChange={(e) => setFormDevis((f) => ({ ...f, validite_offre: e.target.value }))} style={inputStyle} placeholder={t("venteValiditeOffrePlaceholder")} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div>
              <label style={labelStyle}>{t("venteConditionsPaiementLabel")}</label>
              <input value={formDevis.conditions_paiement} onChange={(e) => setFormDevis((f) => ({ ...f, conditions_paiement: e.target.value }))} style={inputStyle} placeholder={t("venteConditionsPaiementPlaceholder")} />
            </div>
            <div>
              <label style={labelStyle}>{t("venteDelaiLivraisonLabel")}</label>
              <input value={formDevis.delai_livraison} onChange={(e) => setFormDevis((f) => ({ ...f, delai_livraison: e.target.value }))} style={inputStyle} placeholder={t("venteDelaiLivraisonPlaceholder")} />
            </div>
          </div>

          <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginTop: 18, marginBottom: 10 }}>{t("venteLignesSection")}</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead>
                <tr style={{ fontSize: 11, color: "var(--sub)", textAlign: "left" }}>
                  <th style={{ padding: "4px 6px" }}>{t("venteDesignationLabel")}</th>
                  <th style={{ padding: "4px 6px", width: 70 }}>{t("venteUniteLabel")}</th>
                  <th style={{ padding: "4px 6px", width: 90 }}>{t("venteQuantiteLabel")}</th>
                  <th style={{ padding: "4px 6px", width: 130 }}>{t("ventePrixUnitaireLabel")}</th>
                  <th style={{ padding: "4px 6px", width: 130 }}>{t("venteMontantLabel")}</th>
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {lignesEdition.map((ligne, index) => {
                  const montant = (Number(ligne.quantite) || 0) * (Number(ligne.prix_unitaire_ht) || 0);
                  return (
                    <tr key={index}>
                      <td style={{ padding: "4px 6px" }}>
                        <input required value={ligne.designation} onChange={(e) => majLigneEdition(index, "designation", e.target.value)} style={inputStyleCompact} />
                      </td>
                      <td style={{ padding: "4px 6px" }}>
                        <input value={ligne.unite} onChange={(e) => majLigneEdition(index, "unite", e.target.value)} style={inputStyleCompact} />
                      </td>
                      <td style={{ padding: "4px 6px" }}>
                        <input required type="number" min="0.01" step="0.01" value={ligne.quantite} onChange={(e) => majLigneEdition(index, "quantite", e.target.value)} style={inputStyleCompact} />
                      </td>
                      <td style={{ padding: "4px 6px" }}>
                        <input required type="number" min="0" step="1" value={ligne.prix_unitaire_ht} onChange={(e) => majLigneEdition(index, "prix_unitaire_ht", e.target.value)} style={inputStyleCompact} />
                      </td>
                      <td className="mono" style={{ padding: "4px 6px", fontSize: 12.5, textAlign: "right" }}>{montant.toLocaleString()}</td>
                      <td style={{ padding: "4px 6px" }}>
                        <button type="button" onClick={() => supprimerLigneEdition(index)} style={boutonSupprimerStyle} title={t("removeLine")}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={ajouterLigneEdition} style={{ ...boutonSecondaireStyle, marginTop: 8 }}>{t("venteAddLineButton")}</button>

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button type="submit" disabled={enregistrementEdition} style={boutonPrincipalStyle}>{t("save")}</button>
            <button type="button" onClick={() => setFormOuvert(false)} style={boutonSecondaireStyle}>{t("cancel")}</button>
          </div>
        </form>
      )}

      <div className="card print-letter" style={{ padding: "28px 32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 24, borderBottom: "2px solid var(--petrol)", paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            {entete?.logo_base64 && (
              <img
                src={`data:${entete.logo_type_mime};base64,${entete.logo_base64}`}
                alt="logo"
                style={{ maxWidth: 90, maxHeight: 70, objectFit: "contain" }}
              />
            )}
            <div>
              <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 14, color: "var(--petrol)" }}>
                {entete?.raison_sociale || "—"}
              </div>
              <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>{entete?.adresse}</div>
              <div style={{ fontSize: 11, color: "var(--sub)" }}>{entete?.telephone}</div>
              <div style={{ fontSize: 11, color: "var(--sub)" }}>{entete?.email}</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{devis.numero}</div>
            <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{formaterDateAffichage(devis.date_devis)}</div>
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--sub)", textTransform: "uppercase" }}>{t("venteBillToLabel")}</div>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{devis.client_nom}</div>
          {devis.client_adresse && <div style={{ fontSize: 12, color: "var(--sub)" }}>{devis.client_adresse}</div>}
          {devis.objet && <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>{t("venteObjetLabel")} : {devis.objet}</div>}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ fontSize: 11, textAlign: "left", borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "6px 4px" }}>{t("venteDesignationLabel")}</th>
              <th style={{ padding: "6px 4px" }}>{t("venteUniteLabel")}</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>{t("venteQuantiteLabel")}</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>{t("ventePrixUnitaireLabel")}</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>{t("venteMontantLabel")}</th>
            </tr>
          </thead>
          <tbody>
            {devis.lignes.map((l) => (
              <tr key={l.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                <td style={{ padding: "6px 4px", fontSize: 12.5 }}>{l.designation}</td>
                <td style={{ padding: "6px 4px", fontSize: 12.5 }}>{l.unite}</td>
                <td className="mono" style={{ padding: "6px 4px", fontSize: 12.5, textAlign: "right" }}>{Number(l.quantite).toLocaleString()}</td>
                <td className="mono" style={{ padding: "6px 4px", fontSize: 12.5, textAlign: "right" }}>{Number(l.prix_unitaire_ht).toLocaleString()}</td>
                <td className="mono" style={{ padding: "6px 4px", fontSize: 12.5, textAlign: "right" }}>{Number(l.montant_ht).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 14, marginLeft: "auto", maxWidth: 260, display: "grid", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <span>{t("venteTotalHtLabel")}</span>
            <span className="mono">{Number(devis.total_ht).toLocaleString()} XOF</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--sub)" }}>
            <span>{t("venteTvaLabel")} ({Number(devis.taux_tva_pourcentage)}%)</span>
            <span className="mono">{Number(devis.montant_tva).toLocaleString()} XOF</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, color: "var(--petrol)" }}>
            <span>{t("venteTotalTtcLabel")}</span>
            <span className="mono">{Number(devis.total_ttc).toLocaleString()} XOF</span>
          </div>
        </div>

        {(devis.conditions_paiement || devis.delai_livraison || devis.validite_offre) && (
          <div style={{ marginTop: 18, fontSize: 11.5, color: "var(--sub)", display: "grid", gap: 3 }}>
            {devis.conditions_paiement && <div>{t("venteConditionsPaiementLabel")} : {devis.conditions_paiement}</div>}
            {devis.delai_livraison && <div>{t("venteDelaiLivraisonLabel")} : {devis.delai_livraison}</div>}
            {devis.validite_offre && <div>{t("venteValiditeOffreLabel")} : {devis.validite_offre}</div>}
          </div>
        )}

        <div style={{ marginTop: 110, textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 12.5 }}>{entete?.signataire_nom}</div>
          <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{entete?.signataire_titre}</div>
          {entete?.signature_cachet_base64 && (
            <img
              src={`data:${entete.signature_cachet_type_mime};base64,${entete.signature_cachet_base64}`}
              alt="signature et cachet"
              style={{ maxWidth: 150, maxHeight: 100, objectFit: "contain", marginTop: 8 }}
            />
          )}
        </div>

        {piedDePage(entete).length > 0 && (
          <div
            style={{
              marginTop: 40,
              paddingTop: 12,
              borderTop: "1px solid var(--line)",
              textAlign: "center",
              fontSize: 10.5,
              color: "var(--sub)",
            }}
          >
            {piedDePage(entete).join(" · ")}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// Pied de page (mentions legales) des documents imprimables - RCCM, NINEA,
// site web, coordonnees bancaires (voir migration
// 018_facturation_entete_pied_de_page.sql) : seuls les champs renseignes par
// l'entreprise s'affichent, rien n'est obligatoire.
function piedDePage(entete) {
  return [
    entete?.rccm ? `RCCM ${entete.rccm}` : null,
    entete?.ninea ? `NINEA ${entete.ninea}` : null,
    entete?.site_web || null,
    entete?.coordonnees_bancaires || null,
  ].filter(Boolean);
}

const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12,
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
};
const boutonSecondaireStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
  textDecoration: "none",
  display: "inline-block",
};
const boutonDangerStyle = {
  background: "transparent",
  color: "var(--brique)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const inputStyleCompact = {
  padding: "7px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 12.5,
  fontFamily: "inherit",
};
const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
};
const boutonSupprimerStyle = {
  background: "transparent",
  color: "var(--brique)",
  border: "none",
  fontSize: 16,
  fontWeight: 700,
  cursor: "pointer",
  lineHeight: 1,
};
