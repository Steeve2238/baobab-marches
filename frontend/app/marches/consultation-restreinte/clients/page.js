"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import EcheancierEditor, { EcheancierFiche } from "../../../../lib/components/EcheancierEditor";
import { echeancierValide, pourApi } from "../../../../lib/echeancier";
import AppShell from "../../../../lib/components/AppShell";
import ConsultationRestreinteSousNav from "../../../../lib/components/ConsultationRestreinteSousNav";

// Clients COMMERCIAUX du tenant (ex: ses propres clients a lui, comme SETER,
// DKM...) - a ne pas confondre avec les "tenants" de la plateforme Baobab.
// Utilises par les Consultations/Devis/Factures/BL du module Ventes.
export default function ClientsCommerciauxPage() {
  const { t } = useLangue();
  const [clients, setClients] = useState([]);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [form, setForm] = useState({ nom: "", adresse: "", telephone: "", email: "", echeancier: [], exonere_tva: false, motif_exoneration_tva: "" });
  // Edition des coordonnees d'un client existant (chantier du 02/10/2026,
  // demande de Steeve : "pas le stylo qui nous permet de modifier... un
  // client dont le nom aurait ete mal saisi"). PATCH /clients/:id acceptait
  // deja nom/adresse/telephone/email cote backend - il manquait juste ce
  // bouton. Ouvert a tout utilisateur ayant acces a cette page (meme
  // perimetre que la creation d'un client ci-dessus), pas de restriction
  // DG/Directeur Financier ici - Steeve n'en a pas demande pour ce champ.
  const [clientEnEdition, setClientEnEdition] = useState(null);
  const [formEdition, setFormEdition] = useState(null);
  const [enregistrementEdition, setEnregistrementEdition] = useState(false);

  function charger() {
    api
      .getClientsCommerciaux()
      .then(setClients)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  useEffect(charger, []);

  async function handleAjouter(e) {
    e.preventDefault();
    setErreur("");
    if (!echeancierValide(form.echeancier)) {
      setErreur(t("echObligatoire"));
      return;
    }
    try {
      const nouveau = await api.createClientCommercial({ ...form, echeancier: pourApi(form.echeancier) });
      setClients((prev) => [...prev, nouveau].sort((a, b) => a.nom.localeCompare(b.nom)));
      setForm({ nom: "", adresse: "", telephone: "", email: "", echeancier: [], exonere_tva: false, motif_exoneration_tva: "" });
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleToggleActif(client) {
    try {
      const maj = await api.patchClientCommercial(client.id, { actif: !client.actif });
      setClients((prev) => prev.map((c) => (c.id === client.id ? maj : c)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  function handleOuvrirEdition(client) {
    setClientEnEdition(client.id);
    setFormEdition({
      nom: client.nom || "",
      adresse: client.adresse || "",
      telephone: client.telephone || "",
      email: client.email || "",
      exonere_tva: !!client.exonere_tva,
      motif_exoneration_tva: client.motif_exoneration_tva || "",
    });
    setErreur("");
  }

  async function handleEnregistrerEdition(e) {
    e.preventDefault();
    setEnregistrementEdition(true);
    setErreur("");
    try {
      const maj = await api.patchClientCommercial(clientEnEdition, formEdition);
      setClients((prev) => prev.map((c) => (c.id === clientEnEdition ? maj : c)).sort((a, b) => a.nom.localeCompare(b.nom)));
      setClientEnEdition(null);
      setFormEdition(null);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementEdition(false);
    }
  }

  return (
    <AppShell title={t("venteClientsPageTitle")} subNav={<ConsultationRestreinteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {clients.filter((c) => !Array.isArray(c.echeancier_json) || c.echeancier_json.length === 0).length > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--brique)", marginBottom: 12 }}>
          {t("echFicheManquantes").replace("{n}", clients.filter((c) => !Array.isArray(c.echeancier_json) || c.echeancier_json.length === 0).length)}
        </p>
      )}

      <form onSubmit={handleAjouter} className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
        <label style={labelStyle}>{t("venteClientNomLabel")}</label>
        <input
          required
          value={form.nom}
          onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("adresseLabel")}</label>
        <input
          value={form.adresse}
          onChange={(e) => setForm((f) => ({ ...f, adresse: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("telephoneLabel")}</label>
        <input
          value={form.telephone}
          onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("emailLabel2")}</label>
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 12.5, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={!!form.exonere_tva}
            onChange={(e) => setForm((f) => ({ ...f, exonere_tva: e.target.checked }))}
          />
          <span style={{ fontWeight: 600 }}>{t("venteClientExonereTva")}</span>
        </label>
        {form.exonere_tva && (
          <input
            placeholder={t("venteClientMotifExoneration")}
            value={form.motif_exoneration_tva}
            onChange={(e) => setForm((f) => ({ ...f, motif_exoneration_tva: e.target.value }))}
            style={{ ...inputStyle, marginTop: 6 }}
          />
        )}
        <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 4 }}>{t("venteClientExonereTvaAide")}</p>
        <div style={{ marginTop: 12 }}>
          <EcheancierEditor sens="CLIENT" valeur={form.echeancier} onChange={(v) => setForm((f) => ({ ...f, echeancier: v }))} />
        </div>
        <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12 }}>
          {t("venteNewClientButton")}
        </button>
      </form>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : clients.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("venteNoClients")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {clients.map((c) =>
            clientEnEdition === c.id ? (
              <form key={c.id} onSubmit={handleEnregistrerEdition} className="card" style={{ display: "grid", gap: 10 }}>
                <div>
                  <label style={labelStyle}>{t("venteClientNomLabel")}</label>
                  <input
                    required
                    value={formEdition.nom}
                    onChange={(e) => setFormEdition((f) => ({ ...f, nom: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{t("adresseLabel")}</label>
                  <input
                    value={formEdition.adresse}
                    onChange={(e) => setFormEdition((f) => ({ ...f, adresse: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{t("telephoneLabel")}</label>
                  <input
                    value={formEdition.telephone}
                    onChange={(e) => setFormEdition((f) => ({ ...f, telephone: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{t("emailLabel2")}</label>
                  <input
                    type="email"
                    value={formEdition.email}
                    onChange={(e) => setFormEdition((f) => ({ ...f, email: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!formEdition.exonere_tva}
                      onChange={(e) => setFormEdition((f) => ({ ...f, exonere_tva: e.target.checked }))}
                    />
                    <span style={{ fontWeight: 600 }}>{t("venteClientExonereTva")}</span>
                  </label>
                  {formEdition.exonere_tva && (
                    <input
                      placeholder={t("venteClientMotifExoneration")}
                      value={formEdition.motif_exoneration_tva}
                      onChange={(e) => setFormEdition((f) => ({ ...f, motif_exoneration_tva: e.target.value }))}
                      style={{ ...inputStyle, marginTop: 6 }}
                    />
                  )}
                  <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 4 }}>{t("venteClientExonereTvaAide")}</p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" disabled={enregistrementEdition} style={boutonPrincipalStyle}>
                    {t("save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setClientEnEdition(null);
                      setFormEdition(null);
                    }}
                    style={boutonSecondaireStyle}
                  >
                    {t("cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <div key={c.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {c.nom}
                    {c.exonere_tva && (
                      <span
                        title={c.motif_exoneration_tva || ""}
                        style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, color: "var(--petrol)", background: "rgba(20,79,85,0.1)" }}
                      >
                        {t("venteClientExonereBadge")}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>
                    {[c.adresse, c.telephone, c.email].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      padding: "3px 8px",
                      borderRadius: 20,
                      color: c.actif ? "#2E7D5B" : "var(--sub)",
                      background: c.actif ? "rgba(46,125,91,0.12)" : "rgba(91,106,108,0.1)",
                    }}
                  >
                    {c.actif ? t("activeLabel") : t("inactiveLabel")}
                  </span>
                  <Link href={`/marches/consultation-restreinte/clients/${c.id}`} style={boutonSecondaireStyle}>
                    {t("venteAccountButton")}
                  </Link>
                  <button onClick={() => handleOuvrirEdition(c)} style={boutonSecondaireStyle} title={t("venteEditClientButton")}>
                    ✎
                  </button>
                  <button onClick={() => handleToggleActif(c)} style={boutonSecondaireStyle}>
                    {c.actif ? t("venteDeactivateClientButton") : t("venteReactivateClientButton")}
                  </button>
                </div>
              </div>
              <EcheancierFiche
                sens="CLIENT"
                echeancier={c.echeancier_json}
                onSave={async (lignes) => {
                  const maj = await api.patchClientCommercial(c.id, { echeancier: lignes });
                  setClients((prev) => prev.map((x) => (x.id === c.id ? maj : x)));
                }}
              />
              </div>
            )
          )}
        </div>
      )}
    </AppShell>
  );
}

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
};
const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
};
const boutonSecondaireStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
  textDecoration: "none",
  display: "inline-block",
};
