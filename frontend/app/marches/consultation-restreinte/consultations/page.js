"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import ConsultationRestreinteSousNav from "../../../../lib/components/ConsultationRestreinteSousNav";
import { useProfilActivite } from "../../../../lib/useProfilActivite";

const STATUT_STYLE = {
  RECUE: { color: "var(--ocre)", background: "rgba(224,149,76,0.12)" },
  DEVIS_EN_COURS: { color: "var(--petrol)", background: "rgba(11,61,64,0.1)" },
  CONVERTIE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  SANS_SUITE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};
const FILTRES = ["RECUE", "DEVIS_EN_COURS", "CONVERTIE", "SANS_SUITE", "TOUTES"];
const FILTRES_VENTE = ["DEVIS_EN_COURS", "CONVERTIE", "SANS_SUITE", "TOUTES"];

// Consultation = demande de prix recue d'un client, 1ere etape du flux
// commercial (Consultation -> Devis -> Facture -> BL). Le lien vers un
// devis se fait depuis la creation du devis (facultatif).
export default function ConsultationsPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [consultations, setConsultations] = useState([]);
  const [clients, setClients] = useState([]);
  const profil = useProfilActivite();
  // NEGOCE : uniquement des ventes ; MARCHES : uniquement des consultations ; LES_DEUX : les deux, au choix a la creation.
  // LES_DEUX arrivant de la carte « Vente directe » (?type=VENTE) : liste limitee aux ventes.
  const [typeUrl, setTypeUrl] = useState(null);
  const typeListe = profil === "NEGOCE" ? "VENTE" : profil === "MARCHES" ? "CONSULTATION" : typeUrl || undefined;
  const filtresDispo = typeListe === "VENTE" ? FILTRES_VENTE : FILTRES;
  const [filtre, setFiltre] = useState("RECUE");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [form, setForm] = useState({ client_commercial_id: "", objet: "", notes: "", type: "CONSULTATION" });
  const [afficherForm, setAfficherForm] = useState(false);

  function charger(statutFiltre) {
    if (profil === null) return;
    setChargement(true);
    api
      .getConsultations(statutFiltre === "TOUTES" ? undefined : statutFiltre, typeListe)
      .then(setConsultations)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  // Une fois le profil connu : NEGOCE demarre sur « Devis en cours » (une vente n'est jamais « Reçue »).
  useEffect(() => {
    if (typeListe === "VENTE" && filtre === "RECUE") setFiltre("DEVIS_EN_COURS");
  }, [profil, typeUrl]);
  useEffect(() => charger(filtre), [filtre, profil, typeUrl]);
  useEffect(() => {
    api.getClientsCommerciaux().then((data) => setClients(data.filter((c) => c.actif))).catch(() => {});
    // Arrivee depuis la fiche d'un client (« Nouvelle vente ») : formulaire ouvert avec le client prerempli.
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("type") === "VENTE") {
        setTypeUrl("VENTE");
        setForm((f) => ({ ...f, type: "VENTE" }));
      }
      if (q.get("nouveau") === "1") {
        const typeNouveau = q.get("type") === "CONSULTATION" ? "CONSULTATION" : "VENTE";
        setForm((f) => ({ ...f, client_commercial_id: q.get("client_id") || "", type: typeNouveau }));
        setAfficherForm(true);
      }
    } catch (e) {
      /* ignore */
    }
  }, []);

  // Type du dossier a creer : impose par le profil, sinon choix dans le formulaire.
  const typeCreation = profil === "NEGOCE" ? "VENTE" : profil === "MARCHES" ? "CONSULTATION" : form.type;
  const creationVente = typeCreation === "VENTE";

  async function handleCreer(e) {
    e.preventDefault();
    setErreur("");
    try {
      const nouvelle = await api.createConsultation({ ...form, type: typeCreation });
      if (filtre === "TOUTES" || filtre === nouvelle.statut) {
        setConsultations((prev) => [nouvelle, ...prev]);
      }
      setForm({ client_commercial_id: "", objet: "", notes: "", type: "CONSULTATION" });
      setAfficherForm(false);
      if (nouvelle.type === "VENTE") {
        router.push(`/marches/consultation-restreinte/consultations/${nouvelle.id}`);
      }
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSansSuite(id) {
    try {
      const maj = await api.patchConsultation(id, { statut: "SANS_SUITE" });
      setConsultations((prev) => (filtre === "TOUTES" ? prev.map((c) => (c.id === id ? maj : c)) : prev.filter((c) => c.id !== id)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <AppShell title={t(profil === "NEGOCE" ? "venteVentesPageTitle" : "venteConsultationsPageTitle")} subNav={<ConsultationRestreinteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {filtresDispo.map((f) => (
            <button
              key={f}
              onClick={() => setFiltre(f)}
              style={{
                ...filtreBtnStyle,
                background: filtre === f ? "var(--petrol)" : "transparent",
                color: filtre === f ? "#fff" : "var(--petrol)",
              }}
            >
              {f === "TOUTES" ? t("saFilterAll") : t(`${profil === "NEGOCE" ? "venteVenteStatut_" : "venteConsultationStatut_"}${f}`)}
            </button>
          ))}
        </div>
        <button onClick={() => setAfficherForm((v) => !v)} style={boutonPrincipalStyle}>
          {afficherForm ? t("cancel") : t(profil === "NEGOCE" || typeUrl === "VENTE" ? "venteNewVenteButton" : "venteNewConsultationButton")}
        </button>
      </div>

      {afficherForm && (
        <form onSubmit={handleCreer} className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
          {profil === "LES_DEUX" && (
            <>
              <label style={labelStyle}>{t("venteTypeLabel")}</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                style={{ ...inputStyle, marginBottom: 10 }}
              >
                <option value="CONSULTATION">{t("venteTypeConsultation")}</option>
                <option value="VENTE">{t("venteTypeVente")}</option>
              </select>
            </>
          )}
          <label style={labelStyle}>{t("venteClientLabel")}</label>
          <select
            required
            value={form.client_commercial_id}
            onChange={(e) => setForm((f) => ({ ...f, client_commercial_id: e.target.value }))}
            style={inputStyle}
          >
            <option value="">—</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.nom}</option>
            ))}
          </select>
          <label style={{ ...labelStyle, marginTop: 10 }}>{t(creationVente ? "venteVenteObjetLabel" : "venteObjetLabel")}</label>
          <input
            required
            value={form.objet}
            onChange={(e) => setForm((f) => ({ ...f, objet: e.target.value }))}
            style={inputStyle}
          />
          <label style={{ ...labelStyle, marginTop: 10 }}>{t("notesLabel")}</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            style={{ ...inputStyle, minHeight: 60 }}
          />
          <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12 }}>
            {t("save")}
          </button>
        </form>
      )}

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : consultations.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t(profil === "NEGOCE" ? "venteNoVentes" : "venteNoConsultations")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {consultations.map((c) => {
            const style = STATUT_STYLE[c.statut] || {};
            const vente = c.type === "VENTE";
            return (
              <div key={c.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                      {c.client_nom}
                      {profil === "LES_DEUX" && (
                        <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 8, color: "var(--sub)", textTransform: "uppercase" }}>
                          {t(vente ? "venteTypeVente" : "venteTypeConsultation")}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 2 }}>{c.objet}</div>
                    <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 4 }}>
                      {new Date(c.date_reception).toLocaleDateString()}
                    </div>
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", ...style }}>
                    {t(`${vente ? "venteVenteStatut_" : "venteConsultationStatut_"}${c.statut}`)}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <Link href={`/marches/consultation-restreinte/consultations/${c.id}`} style={boutonSecondaireStyle}>
                    {t("venteConsultationDetailsButton")}
                  </Link>
                  {(c.statut === "RECUE" || (vente && c.statut === "DEVIS_EN_COURS")) && (
                    <>
                      <Link
                        href={`/marches/consultation-restreinte/devis/nouveau?consultation_id=${c.id}&client_commercial_id=${c.client_commercial_id}`}
                        style={boutonSecondaireStyle}
                      >
                        {t("venteCreateDevisFromConsultation")}
                      </Link>
                      <button onClick={() => handleSansSuite(c.id)} style={boutonSecondaireStyle}>
                        {t("venteConsultationSansSuite")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
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
const filtreBtnStyle = {
  border: "1px solid var(--line)",
  borderRadius: 20,
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 600,
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
