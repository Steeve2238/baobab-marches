"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import { TicketCaisse, FactureCaisse, STYLES_IMPRESSION } from "../../lib/components/caisse/DocumentsCaisse";

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ");
const sub = (txt, vars) => String(txt).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : `{${k}}`));
const aujourdhui = () => new Date().toISOString().slice(0, 10);

const S = {
  bouton: { background: "var(--petrol)", color: "#fff", border: "none", borderRadius: 10, padding: "12px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer" },
  boutonGris: { background: "var(--panel)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 16px", fontWeight: 600, fontSize: 13.5, cursor: "pointer" },
  champ: { width: "100%", padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 14, fontFamily: "inherit", background: "#fff" },
  th: { textAlign: "left", fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--sub)", padding: "8px 10px", borderBottom: "1px solid var(--line)" },
  td: { padding: "9px 10px", borderBottom: "1px solid var(--line-soft)", fontSize: 13.5 },
};

const COULEURS_STOCK = {
  OK: { bg: "var(--vert-bg)", fg: "var(--vert)" },
  FAIBLE: { bg: "var(--ocre-bg)", fg: "var(--ocre)" },
  RUPTURE: { bg: "var(--brique-bg)", fg: "var(--brique)" },
};

function PastilleStock({ etat, stock, t }) {
  const c = COULEURS_STOCK[etat];
  const label = etat === "RUPTURE" ? t("caiRupture") : sub(t("caiStockOk"), { n: fmt(stock) });
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: c.bg, color: c.fg, width: "max-content" }}>
      <i style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
      {label}
    </span>
  );
}

export default function CaissePage() {
  const { t } = useLangue();
  const [onglet, setOnglet] = useState("caisse");
  const [cat, setCat] = useState({ produits: [], categories: [], taux_tva: 18, remise_max_vendeur_pct: 10 });
  const [modes, setModes] = useState([]);
  const [clients, setClients] = useState([]);
  const [q, setQ] = useState("");
  const [categorie, setCategorie] = useState("");
  const [panier, setPanier] = useState({});
  const [remise, setRemise] = useState(0);
  const [clientId, setClientId] = useState("");
  const [livraison, setLivraison] = useState("EMPORTE");
  const [dateLivraison, setDateLivraison] = useState("");
  const [erreur, setErreur] = useState("");
  const [paiementOuvert, setPaiementOuvert] = useState(false);
  const [pays, setPays] = useState([]);
  const [envoi, setEnvoi] = useState(false);
  const [vente, setVente] = useState(null);
  const [doc, setDoc] = useState("ticket");
  const [nouveauClient, setNouveauClient] = useState(null);
  const rechercheRef = useRef(null);

  const charger = useCallback(() => {
    api.caisseProduits().then(setCat).catch((e) => setErreur(e.message));
  }, []);
  useEffect(() => {
    charger();
    api.modesReglement({ actifs: "1", sens: "ENCAISSEMENT" }).then((r) => setModes(r.modes || [])).catch(() => {});
    api.getClientsCommerciaux().then((c) => setClients((c || []).filter((x) => x.actif !== false))).catch(() => {});
  }, [charger]);

  const produitsParId = useMemo(() => new Map(cat.produits.map((p) => [p.id, p])), [cat.produits]);
  const filtres = useMemo(() => {
    const s = q.trim().toLowerCase();
    return cat.produits.filter((p) => (!categorie || p.categorie === categorie) && (!s || (p.reference || "").toLowerCase().includes(s) || p.designation.toLowerCase().includes(s)));
  }, [cat.produits, q, categorie]);

  const lignes = Object.keys(panier).map((id) => ({ p: produitsParId.get(id), n: panier[id] })).filter((l) => l.p);
  const sousTotal = lignes.reduce((a, l) => a + l.p.prix_ttc * l.n, 0);
  const remiseMontant = sousTotal * ((Number(remise) || 0) / 100);
  const total = Math.round(sousTotal - remiseMontant);
  const tva = (total * cat.taux_tva) / (100 + cat.taux_tva);

  function ajouter(id, d = 1) {
    setPanier((cur) => {
      const n = (cur[id] || 0) + d;
      const nxt = { ...cur };
      if (n <= 0) delete nxt[id]; else nxt[id] = n;
      return nxt;
    });
  }
  function toucherProduit(p) {
    if (!p.vendable) return;
    ajouter(p.id);
  }
  function entreeRecherche(e) {
    if (e.key !== "Enter") return;
    const s = q.trim().toLowerCase();
    if (!s) return;
    const p = cat.produits.find((x) => (x.reference || "").toLowerCase() === s) || filtres[0];
    if (p) { toucherProduit(p); setQ(""); }
  }
  function viderTicket() {
    setPanier({}); setRemise(0); setClientId(""); setLivraison("EMPORTE"); setDateLivraison(""); setErreur("");
  }

  // ---- encaissement ----
  const estComptoir = !clientId;
  const recu = pays.reduce((a, p) => a + (Number(p.montant) || 0), 0);
  const reste = Math.max(0, total - recu);
  const rendu = Math.max(0, recu - total);
  const especes = pays.some((p) => (modes.find((m) => m.id === p.mode_reglement_id) || {}).type_mode === "ESPECES");
  const nomClient = (clients.find((c) => c.id === clientId) || {}).nom || t("caiClientComptoir");
  let msgPaiement = null;
  let paiementValide = pays.length > 0 || !estComptoir;
  if (reste >= 1) {
    if (estComptoir) { msgPaiement = { type: "bad", txt: sub(t("caiMsgCreditComptoir"), { m: `${fmt(reste)} F` }) }; paiementValide = false; }
    else msgPaiement = { type: "warn", txt: sub(t("caiMsgCredit"), { m: `${fmt(reste)} F`, c: nomClient }) };
  }
  if (livraison === "DIFFEREE" && estComptoir) { msgPaiement = { type: "bad", txt: t("caiMsgLivraisonComptoir") }; paiementValide = false; }
  if (rendu >= 1 && !especes) { msgPaiement = { type: "bad", txt: t("caiMsgRenduEspeces") }; paiementValide = false; }

  function ouvrirPaiement() {
    if (lignes.length === 0) return;
    setErreur(""); setPays([]); setPaiementOuvert(true);
  }
  function ajouterMode(m) {
    setPays((cur) => {
      if (cur.find((p) => p.mode_reglement_id === m.id)) return cur;
      const dejaRecu = cur.reduce((a, p) => a + (Number(p.montant) || 0), 0);
      return [...cur, { mode_reglement_id: m.id, montant: Math.max(0, total - dejaRecu), reference: "" }];
    });
  }
  const majPaiement = (i, champ, v) => setPays((cur) => cur.map((p, k) => (k === i ? { ...p, [champ]: v } : p)));

  async function valider() {
    setEnvoi(true); setErreur("");
    try {
      const r = await api.caisseCreerVente({
        client_commercial_id: clientId || null,
        lignes: lignes.map((l) => ({ produit_id: l.p.id, quantite: l.n })),
        pourcentage_remise: Number(remise) || 0,
        livraison,
        date_livraison: dateLivraison || null,
        paiements: pays.filter((p) => Number(p.montant) > 0).map((p) => ({ mode_reglement_id: p.mode_reglement_id, montant: Number(p.montant), reference: p.reference || null })),
      });
      setPaiementOuvert(false);
      setVente(r);
      setDoc("ticket");
      charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnvoi(false);
    }
  }
  function nouvelleVente() {
    setVente(null); viderTicket();
    setTimeout(() => rechercheRef.current && rechercheRef.current.focus(), 50);
  }

  async function creerClient(e) {
    e.preventDefault();
    try {
      const c = await api.createClientCommercial({ nom: nouveauClient.nom, telephone: nouveauClient.telephone || undefined });
      setClients((cur) => [...cur, c]);
      setClientId(c.id);
      setNouveauClient(null);
    } catch (err) {
      setErreur(err.message);
    }
  }

  // Raccourcis clavier : F2 recherche, F9 encaisser, Echap ferme les fenetres.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "F2") { e.preventDefault(); rechercheRef.current && rechercheRef.current.focus(); }
      if (e.key === "F9") { e.preventDefault(); if (!paiementOuvert && !vente && onglet === "caisse") ouvrirPaiement(); }
      if (e.key === "Escape") { setPaiementOuvert(false); setNouveauClient(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <AppShell title={t("caiTitre")}>
      <style dangerouslySetInnerHTML={{ __html: STYLES_IMPRESSION }} />
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {[["caisse", "caiOngletCaisse"], ["ventes", "caiOngletVentes"], ["rapport", "caiOngletRapport"]].map(([k, cle]) => (
          <button key={k} onClick={() => setOnglet(k)} style={{ ...S.boutonGris, padding: "7px 14px", fontWeight: onglet === k ? 700 : 500, background: onglet === k ? "var(--petrol)" : "var(--panel)", color: onglet === k ? "#fff" : "var(--ink)" }}>{t(cle)}</button>
        ))}
      </div>

      {erreur && !paiementOuvert && <p style={{ color: "var(--brique)", fontSize: 13 }}>{erreur}</p>}

      {onglet === "caisse" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 380px", gap: 16, alignItems: "start" }} className="caisse-grille">
          <section className="card" style={{ padding: 14 }}>
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <input ref={rechercheRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={entreeRecherche} placeholder={t("caiRechercher")} autoComplete="off" style={{ ...S.champ, fontSize: 16, padding: "12px 14px" }} />
              <span style={{ alignSelf: "center", fontSize: 12, color: "var(--sub)", border: "1px solid var(--line)", borderRadius: 6, padding: "0 6px" }}>F2</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {["", ...cat.categories].map((c) => (
                <button key={c || "tous"} onClick={() => setCategorie(c)} style={{ border: "1px solid var(--line)", borderRadius: 99, padding: "5px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer", background: categorie === c ? "var(--petrol)" : "var(--panel)", color: categorie === c ? "#fff" : "var(--sub)" }}>{c || t("caiTous")}</button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(165px, 1fr))", gap: 10 }}>
              {filtres.map((p) => {
                const n = panier[p.id] || 0;
                return (
                  <button key={p.id} onClick={() => toucherProduit(p)} disabled={!p.vendable} style={{ position: "relative", textAlign: "left", border: `1px solid ${n ? "var(--petrol-3)" : "var(--line)"}`, background: "var(--panel)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 4, minHeight: 124, cursor: p.vendable ? "pointer" : "not-allowed", opacity: p.vendable ? 1 : 0.55 }}>
                    {n > 0 && <span style={{ position: "absolute", top: 8, right: 8, background: "var(--petrol)", color: "#fff", minWidth: 24, height: 24, borderRadius: 12, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, padding: "0 6px" }}>{n}</span>}
                    <span style={{ fontSize: 11.5, color: "var(--sub)", fontWeight: 700, letterSpacing: 0.5 }}>{p.reference || "—"}</span>
                    <span style={{ fontWeight: 600, lineHeight: 1.25, fontSize: 14 }}>{p.designation}</span>
                    <PastilleStock etat={p.etat_stock} stock={p.stock - n} t={t} />
                    <span style={{ marginTop: "auto", fontSize: 17, fontWeight: 700 }}>
                      {p.vendable ? <>{fmt(p.prix_ttc)} <small style={{ fontSize: 11.5, fontWeight: 600, color: "var(--sub)" }}>{t("caiPrixTtc")}</small></> : <small style={{ color: "var(--brique)" }}>{t("caiPrixNonDefini")}</small>}
                    </span>
                  </button>
                );
              })}
              {filtres.length === 0 && <p style={{ gridColumn: "1/-1", color: "var(--sub)", fontSize: 13 }}>{t("caiAucunProduit")}</p>}
            </div>
          </section>

          <aside className="card" style={{ padding: 0, position: "sticky", top: 12 }}>
            <div style={{ padding: "14px 16px 8px", fontSize: 12.5, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--sub)" }}>{t("caiTicketEnCours")}</div>
            <div style={{ padding: "0 16px 10px", display: "flex", gap: 8 }}>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={S.champ} aria-label={t("caiClient")}>
                <option value="">{t("caiClientComptoir")}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
              <button onClick={() => setNouveauClient({ nom: "", telephone: "" })} style={{ ...S.boutonGris, whiteSpace: "nowrap", padding: "8px 12px" }}>{t("caiNouveauClient")}</button>
            </div>
            <div style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", maxHeight: 340, overflowY: "auto", minHeight: 110 }}>
              {lignes.length === 0 && <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--sub)", fontSize: 13 }}>{t("caiTicketVide")}</div>}
              {lignes.map(({ p, n }) => (
                <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 10px", padding: "10px 16px", borderBottom: "1px solid var(--line-soft)" }}>
                  <div><div style={{ fontWeight: 600, fontSize: 14 }}>{p.designation}</div><div style={{ fontSize: 12, color: "var(--sub)" }}>{p.reference || "—"} · {fmt(p.prix_ttc)} F</div></div>
                  <div style={{ fontWeight: 700, textAlign: "right" }}>{fmt(p.prix_ttc * n)}</div>
                  <div />
                  <div style={{ display: "flex", alignItems: "center", gap: 6, justifySelf: "end" }}>
                    <button onClick={() => ajouter(p.id, -1)} style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg)", fontWeight: 700, fontSize: 16, cursor: "pointer" }}>−</button>
                    <b style={{ minWidth: 22, textAlign: "center" }}>{n}</b>
                    <button onClick={() => ajouter(p.id, 1)} style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg)", fontWeight: 700, fontSize: 16, cursor: "pointer" }}>+</button>
                  </div>
                  {n > p.stock && <div style={{ gridColumn: "1/3", fontSize: 12, color: "var(--ocre)", fontWeight: 600 }}>{sub(t("caiStockInsuffisant"), { n: fmt(Math.max(p.stock, 0)) })}</div>}
                </div>
              ))}
            </div>
            <div style={{ padding: "12px 16px", display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--sub)" }}><span>{t("caiSousTotal")}</span><span>{fmt(sousTotal)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "var(--sub)" }}>
                <span>{t("caiRemise")}</span>
                <input type="number" min="0" max="100" value={remise} onChange={(e) => setRemise(e.target.value)} style={{ width: 70, padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, textAlign: "right" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--sub)" }}><span>{sub(t("caiDontTva"), { t: cat.taux_tva })}</span><span>{fmt(tva)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 700, fontSize: 12.5, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--sub)" }}>{t("caiTotalAPayer")}</span>
                <b style={{ fontSize: 30, letterSpacing: -0.5 }}>{fmt(total)} F</b>
              </div>
            </div>
            <div style={{ padding: "0 16px 12px", display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                {[["EMPORTE", "caiEmporte"], ["DIFFEREE", "caiDiffere"]].map(([k, cle]) => (
                  <button key={k} onClick={() => setLivraison(k)} style={{ border: "none", padding: 8, fontWeight: 600, fontSize: 13, cursor: "pointer", background: livraison === k ? "var(--vert-bg)" : "var(--bg)", color: livraison === k ? "var(--vert)" : "var(--sub)" }}>{t(cle)}</button>
                ))}
              </div>
              {livraison === "DIFFEREE" && (
                <label style={{ fontSize: 12.5, color: "var(--sub)", display: "grid", gap: 4 }}>{t("caiDateLivraison")}
                  <input type="date" value={dateLivraison} onChange={(e) => setDateLivraison(e.target.value)} style={S.champ} />
                </label>
              )}
            </div>
            <button onClick={ouvrirPaiement} disabled={lignes.length === 0} style={{ ...S.bouton, margin: "0 16px 10px", width: "calc(100% - 32px)", fontSize: 18, padding: 16, display: "flex", justifyContent: "space-between", opacity: lignes.length === 0 ? 0.4 : 1 }}>
              <span>{t("caiEncaisser")}</span><span style={{ fontSize: 12, border: "1px solid rgba(255,255,255,.6)", borderRadius: 6, padding: "0 6px" }}>F9</span>
            </button>
            <button onClick={viderTicket} style={{ background: "none", border: "none", color: "var(--sub)", fontSize: 12.5, margin: "0 16px 14px", textDecoration: "underline", cursor: "pointer", padding: 0 }}>{t("caiViderTicket")}</button>
          </aside>
        </div>
      )}

      {onglet === "ventes" && <VentesDuJour t={t} onVoir={async (id) => { try { setVente(await api.caisseVente(id)); setDoc("ticket"); } catch (e) { setErreur(e.message); } }} />}
      {onglet === "rapport" && <RapportJour t={t} />}

      {/* ---- fenetre d'encaissement ---- */}
      {paiementOuvert && (
        <Fenetre onClose={() => setPaiementOuvert(false)} titre={t("caiEncaisser")} t={t}>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", background: "var(--vert-bg)", padding: "14px 16px", borderRadius: 12 }}>
              <span>{t("caiMontantAEncaisser")}</span><b style={{ fontSize: 28, color: "var(--vert)" }}>{fmt(total)} F</b>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("caiChoisirModes")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {modes.map((m) => (
                <button key={m.id} onClick={() => ajouterMode(m)} style={{ border: "1.5px solid var(--line)", background: "var(--panel)", borderRadius: 12, padding: 12, textAlign: "left", fontWeight: 700, cursor: "pointer" }}>{m.libelle}</button>
              ))}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {pays.map((p, i) => {
                const m = modes.find((x) => x.id === p.mode_reglement_id) || {};
                return (
                  <div key={p.mode_reglement_id} style={{ display: "grid", gridTemplateColumns: "1fr 150px 34px", gap: 10, alignItems: "center", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 10 }}>
                    <div><b>{m.libelle}</b>
                      {m.type_mode !== "ESPECES" && <input value={p.reference} onChange={(e) => majPaiement(i, "reference", e.target.value)} placeholder={t("caiReferencePaiement")} style={{ ...S.champ, marginTop: 4, fontSize: 12.5, padding: "5px 8px" }} />}
                    </div>
                    <input type="number" min="0" value={p.montant} onChange={(e) => majPaiement(i, "montant", e.target.value)} autoFocus={i === pays.length - 1} style={{ ...S.champ, textAlign: "right", fontWeight: 600, fontSize: 16 }} />
                    <button onClick={() => setPays((cur) => cur.filter((_, k) => k !== i))} aria-label={t("caiRetirer")} style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: "var(--bg)", cursor: "pointer" }}>✕</button>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Case label={t("caiRecu")} valeur={`${fmt(recu)} F`} />
              <Case label={t("caiResteAPayer")} valeur={`${fmt(reste)} F`} couleur={reste >= 1 ? "var(--brique)" : "var(--vert)"} />
              <Case label={t("caiMonnaieARendre")} valeur={`${fmt(rendu)} F`} couleur={rendu >= 1 ? "var(--vert)" : undefined} />
            </div>
            {msgPaiement && <div style={{ padding: "10px 14px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, background: msgPaiement.type === "bad" ? "var(--brique-bg)" : "var(--ocre-bg)", color: msgPaiement.type === "bad" ? "var(--brique)" : "var(--ocre)" }}>{msgPaiement.txt}</div>}
            {erreur && <div style={{ color: "var(--brique)", fontSize: 13 }}>{erreur}</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setPaiementOuvert(false)} style={S.boutonGris}>{t("caiRetour")}</button>
              <button onClick={valider} disabled={!paiementValide || envoi} style={{ ...S.bouton, opacity: !paiementValide || envoi ? 0.4 : 1 }}>{reste >= 1 ? t("caiValiderCredit") : t("caiValider")}</button>
            </div>
          </div>
        </Fenetre>
      )}

      {/* ---- vente enregistree : documents ---- */}
      {vente && (
        <Fenetre onClose={nouvelleVente} titre={sub(t("caiVenteEnregistree"), { n: vente.facture.numero, m: `${fmt(vente.facture.total_ttc)} F` })} large t={t}>
          <div style={{ display: "grid", gap: 14 }}>
            {(vente.avertissements_stock || []).length > 0 && (
              <div style={{ padding: "10px 14px", borderRadius: 10, fontSize: 13, background: "var(--ocre-bg)", color: "var(--ocre)", fontWeight: 600 }}>
                {sub(t("caiAvertStock"), { l: vente.avertissements_stock.map((a) => a.designation).join(", ") })}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {[["ticket", "caiDocTicket"], ["facture", "caiDocFacture"], ["both", "caiDocLesDeux"], ["none", "caiDocAucun"]].map(([k, cle]) => (
                <button key={k} onClick={() => setDoc(k)} style={{ border: `1.5px solid ${doc === k ? "var(--petrol)" : "var(--line)"}`, background: doc === k ? "var(--vert-bg)" : "var(--panel)", color: doc === k ? "var(--petrol)" : "var(--ink)", borderRadius: 10, padding: 10, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>{t(cle)}</button>
              ))}
            </div>
            <div id="zone-impression-caisse" style={{ display: "flex", gap: 18, flexWrap: "wrap", justifyContent: "center", background: "var(--bg)", padding: 18, borderRadius: 12 }}>
              {(doc === "ticket" || doc === "both") && <TicketCaisse vente={vente} />}
              {(doc === "facture" || doc === "both") && <FactureCaisse vente={vente} />}
              {doc === "none" && <div style={{ color: "var(--sub)", fontSize: 13 }}>{t("caiAucunDocument")}</div>}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <Link href={`/marches/consultation-restreinte/factures/${vente.facture.id}`} style={{ ...S.boutonGris, textDecoration: "none" }}>{t("caiOuvrirFacture")}</Link>
              <button onClick={() => window.print()} disabled={doc === "none"} style={{ ...S.boutonGris, opacity: doc === "none" ? 0.4 : 1 }}>{t("caiImprimer")}</button>
              <button onClick={nouvelleVente} style={S.bouton}>{t("caiNouvelleVente")}</button>
            </div>
          </div>
        </Fenetre>
      )}

      {nouveauClient && (
        <Fenetre onClose={() => setNouveauClient(null)} titre={t("caiNouveauClient")} t={t} petit>
          <form onSubmit={creerClient} style={{ display: "grid", gap: 10 }}>
            <input required autoFocus value={nouveauClient.nom} onChange={(e) => setNouveauClient({ ...nouveauClient, nom: e.target.value })} placeholder={t("caiNomClient")} style={S.champ} />
            <input value={nouveauClient.telephone} onChange={(e) => setNouveauClient({ ...nouveauClient, telephone: e.target.value })} placeholder={t("caiTelClient")} style={S.champ} />
            <button type="submit" style={S.bouton}>{t("caiCreerClient")}</button>
          </form>
        </Fenetre>
      )}
      <style>{`@media (max-width: 980px){ .caisse-grille{ grid-template-columns: 1fr !important; } }`}</style>
    </AppShell>
  );
}

function Case({ label, valeur, couleur }) {
  return (
    <div style={{ flex: 1, minWidth: 150, padding: "10px 14px", borderRadius: 10, background: "var(--bg)" }}>
      <span style={{ display: "block", fontSize: 12, color: "var(--sub)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
      <b style={{ fontSize: 20, color: couleur }}>{valeur}</b>
    </div>
  );
}

function Fenetre({ children, titre, onClose, large, petit, t }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,18,14,.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 14px", overflowY: "auto", zIndex: 50 }}>
      <div style={{ width: petit ? 420 : large ? "min(940px, 100%)" : "min(720px, 100%)", background: "var(--panel)", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,.35)", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>{titre}</h3>
          <button onClick={onClose} aria-label="close" style={{ border: "none", background: "var(--bg)", width: 34, height: 34, borderRadius: 8, fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

function VentesDuJour({ t, onVoir }) {
  const [date, setDate] = useState(aujourdhui());
  const [ventes, setVentes] = useState(null);
  useEffect(() => { api.caisseVentes(date).then((r) => setVentes(r.ventes)).catch(() => setVentes([])); }, [date]);
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: 12 }}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...S.champ, width: 180 }} /></div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead><tr><th style={S.th}>{t("caiNumero")}</th><th style={S.th}>{t("caiHeure")}</th><th style={S.th}>{t("caiClient")}</th><th style={S.th}>{t("caiVendeur")}</th><th style={S.th}>{t("caiMode")}</th><th style={{ ...S.th, textAlign: "right" }}>{t("caiTotal")}</th><th style={S.th}></th></tr></thead>
          <tbody>
            {ventes === null && <tr><td style={S.td} colSpan={7}>{t("caiChargement")}</td></tr>}
            {ventes && ventes.length === 0 && <tr><td style={S.td} colSpan={7}>{t("caiAucuneVente")}</td></tr>}
            {(ventes || []).map((v) => (
              <tr key={v.id}>
                <td style={S.td}><b>{v.numero}</b></td>
                <td style={S.td}>{new Date(v.heure).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</td>
                <td style={S.td}>{v.comptoir ? t("caiClientComptoir") : v.client_nom}</td>
                <td style={S.td}>{v.vendeur || "—"}</td>
                <td style={S.td}>{v.mode || "—"}</td>
                <td style={{ ...S.td, textAlign: "right" }}>{fmt(v.total_ttc)}{v.statut !== "PAYEE" ? <span style={{ color: "var(--brique)", fontSize: 11.5 }}> ({t("caiCredit")} {fmt(v.total_ttc - v.montant_encaisse)})</span> : null}</td>
                <td style={S.td}><button onClick={() => onVoir(v.id)} style={{ ...S.boutonGris, padding: "4px 10px", fontSize: 12.5 }}>{t("caiReimprimer")}</button>{" "}<a href={`/ventes/avoirs/nouveau?facture_id=${v.id}`} style={{ ...S.boutonGris, padding: "4px 10px", fontSize: 12.5, textDecoration: "none", display: "inline-block" }}>{t("caiRetourAvoir")}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RapportJour({ t }) {
  const [date, setDate] = useState(aujourdhui());
  const [r, setR] = useState(null);
  useEffect(() => { api.caisseRapport(date).then(setR).catch(() => setR(null)); }, [date]);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...S.champ, width: 180 }} />
      {!r ? <p style={{ color: "var(--sub)" }}>{t("caiChargement")}</p> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {[["caiNbVentes", r.totaux.nb_ventes], ["caiChiffreAffaires", `${fmt(r.totaux.ca)} F`], ["caiEncaisse", `${fmt(r.totaux.encaisse)} F`], ["caiCredit", `${fmt(r.totaux.credit)} F`]].map(([cle, v]) => (
              <div key={cle} className="card"><span style={{ fontSize: 12, color: "var(--sub)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{t(cle)}</span><b style={{ display: "block", fontSize: 24 }}>{v}</b></div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: "12px 14px", fontWeight: 700 }}>{t("caiParMode")}</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={S.th}>{t("caiMode")}</th><th style={{ ...S.th, textAlign: "right" }}>{t("caiNombre")}</th><th style={{ ...S.th, textAlign: "right" }}>{t("caiMontant")}</th></tr></thead>
                <tbody>{r.par_mode.length === 0 ? <tr><td style={S.td} colSpan={3}>{t("caiAucuneVente")}</td></tr> : r.par_mode.map((m) => <tr key={m.mode}><td style={S.td}>{m.mode}</td><td style={{ ...S.td, textAlign: "right" }}>{m.nb}</td><td style={{ ...S.td, textAlign: "right" }}>{fmt(m.total)}</td></tr>)}</tbody></table>
            </div>
            {r.remboursements && r.remboursements.length > 0 && (
              <div className="card" style={{ padding: 0 }}>
                <div style={{ padding: "12px 14px", fontWeight: 700 }}>{t("caiRemboursements")} · {fmt(r.totaux.rembourse)} F</div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={S.th}>{t("caiMode")}</th><th style={{ ...S.th, textAlign: "right" }}>{t("caiNombre")}</th><th style={{ ...S.th, textAlign: "right" }}>{t("caiMontant")}</th></tr></thead>
                  <tbody>{r.remboursements.map((m) => <tr key={m.mode}><td style={S.td}>{m.mode}</td><td style={{ ...S.td, textAlign: "right" }}>{m.nb}</td><td style={{ ...S.td, textAlign: "right", color: "var(--brique)" }}>-{fmt(m.total)}</td></tr>)}</tbody></table>
              </div>
            )}
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: "12px 14px", fontWeight: 700 }}>{t("caiParVendeur")}</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={S.th}>{t("caiVendeur")}</th><th style={{ ...S.th, textAlign: "right" }}>{t("caiNbVentes")}</th><th style={{ ...S.th, textAlign: "right" }}>{t("caiChiffreAffaires")}</th></tr></thead>
                <tbody>{r.par_vendeur.length === 0 ? <tr><td style={S.td} colSpan={3}>{t("caiAucuneVente")}</td></tr> : r.par_vendeur.map((v) => <tr key={v.vendeur}><td style={S.td}>{v.vendeur}</td><td style={{ ...S.td, textAlign: "right" }}>{v.nb_ventes}</td><td style={{ ...S.td, textAlign: "right" }}>{fmt(v.ca)}</td></tr>)}</tbody></table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
