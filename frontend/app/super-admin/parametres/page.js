"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { superAdminApi } from "../../../lib/superAdminApi";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import SuperAdminShell from "../../../lib/components/SuperAdminShell";

// Parametres d'entete + pied de page + logo du Super Admin lui-meme (Steeve /
// YMS Groupe), utilises sur les factures d'abonnement generees pour les
// clients (voir super-admin/factures/[id]/page.js) - demande explicite de
// Steeve le 05/09/2026, meme principe que l'entete du module Ventes cote
// client (voir app/parametres/entete/page.js) mais pour la plateforme
// elle-meme.
export default function SuperAdminParametresPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [form, setForm] = useState({
    raison_sociale: "",
    adresse: "",
    telephone: "",
    email: "",
    rccm: "",
    ninea: "",
    site_web: "",
    coordonnees_bancaires: "",
    forme_juridique: "",
    capital_social: "",
    representant_nom: "",
    representant_fonction: "",
    ville_signature: "",
    tribunal_competent: "",
    penalite_pi_mois: "",
    mention_propriete_intellectuelle: "",
  });
  const [logo, setLogo] = useState(null);
  // Signature + cachet : une seule image combinee (le cachet papier est
  // scanne avec la signature dessus), affichee en bas a droite des factures
  // sous la mention "La Direction" - voir super-admin/factures/[id]/page.js.
  const [signatureCachet, setSignatureCachet] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [enregistrement, setEnregistrement] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [televersementLogo, setTeleversementLogo] = useState(false);
  const [televersementSignature, setTeleversementSignature] = useState(false);
  const [erreur, setErreur] = useState("");
  const inputLogoRef = useRef(null);
  const inputSignatureRef = useRef(null);

  useEffect(() => {
    superAdminApi
      .getParametresEntete()
      .then((data) => {
        setForm({
          raison_sociale: data.raison_sociale || "",
          adresse: data.adresse || "",
          telephone: data.telephone || "",
          email: data.email || "",
          rccm: data.rccm || "",
          ninea: data.ninea || "",
          site_web: data.site_web || "",
          coordonnees_bancaires: data.coordonnees_bancaires || "",
          forme_juridique: data.forme_juridique === null || data.forme_juridique === undefined ? "" : String(data.forme_juridique),
          capital_social: data.capital_social === null || data.capital_social === undefined ? "" : String(data.capital_social),
          representant_nom: data.representant_nom === null || data.representant_nom === undefined ? "" : String(data.representant_nom),
          representant_fonction: data.representant_fonction === null || data.representant_fonction === undefined ? "" : String(data.representant_fonction),
          ville_signature: data.ville_signature === null || data.ville_signature === undefined ? "" : String(data.ville_signature),
          tribunal_competent: data.tribunal_competent === null || data.tribunal_competent === undefined ? "" : String(data.tribunal_competent),
          penalite_pi_mois: data.penalite_pi_mois === null || data.penalite_pi_mois === undefined ? "" : String(data.penalite_pi_mois),
          mention_propriete_intellectuelle: data.mention_propriete_intellectuelle === null || data.mention_propriete_intellectuelle === undefined ? "" : String(data.mention_propriete_intellectuelle),
        });
        setLogo(data.logo_base64 ? { base64: data.logo_base64, mime: data.logo_type_mime } : null);
        setSignatureCachet(
          data.signature_cachet_base64
            ? { base64: data.signature_cachet_base64, mime: data.signature_cachet_type_mime }
            : null
        );
      })
      .catch((err) => {
        if (err.status === 401) {
          router.push("/super-admin/login");
          return;
        }
        setErreur(err.message);
      })
      .finally(() => setChargement(false));
  }, [router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setEnregistrement(true);
    setConfirmation(false);
    setErreur("");
    try {
      await superAdminApi.patchParametresEntete(form);
      setConfirmation(true);
      setTimeout(() => setConfirmation(false), 2500);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrement(false);
    }
  }

  async function handleChoisirLogo(e) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    setTeleversementLogo(true);
    setErreur("");
    try {
      const maj = await superAdminApi.uploaderLogoEntete(fichier);
      setLogo(maj.logo_base64 ? { base64: maj.logo_base64, mime: maj.logo_type_mime } : null);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setTeleversementLogo(false);
      if (inputLogoRef.current) inputLogoRef.current.value = "";
    }
  }

  async function handleSupprimerLogo() {
    setTeleversementLogo(true);
    setErreur("");
    try {
      await superAdminApi.supprimerLogoEntete();
      setLogo(null);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setTeleversementLogo(false);
    }
  }

  async function handleChoisirSignatureCachet(e) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    setTeleversementSignature(true);
    setErreur("");
    try {
      const maj = await superAdminApi.uploaderSignatureCachetEntete(fichier);
      setSignatureCachet(
        maj.signature_cachet_base64
          ? { base64: maj.signature_cachet_base64, mime: maj.signature_cachet_type_mime }
          : null
      );
    } catch (err) {
      setErreur(err.message);
    } finally {
      setTeleversementSignature(false);
      if (inputSignatureRef.current) inputSignatureRef.current.value = "";
    }
  }

  async function handleSupprimerSignatureCachet() {
    setTeleversementSignature(true);
    setErreur("");
    try {
      await superAdminApi.supprimerSignatureCachetEntete();
      setSignatureCachet(null);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setTeleversementSignature(false);
    }
  }

  return (
    <SuperAdminShell title={t("saParametresPageTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 16 }}>{t("saParametresPageDescription")}</p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {!chargement && (
        <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 560 }}>
          <label style={labelStyle}>{t("venteLogoLabel")}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
            {logo ? (
              <img
                src={`data:${logo.mime};base64,${logo.base64}`}
                alt="logo"
                style={{ maxWidth: 100, maxHeight: 70, objectFit: "contain", border: "1px solid var(--line)", borderRadius: 8, padding: 4 }}
              />
            ) : (
              <span style={{ fontSize: 12, color: "var(--sub)" }}>{t("venteNoLogo")}</span>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => inputLogoRef.current?.click()}
                disabled={televersementLogo}
                style={boutonSecondaireStyle}
              >
                {televersementLogo ? t("saCreating") : t("venteUploadLogoButton")}
              </button>
              {logo && (
                <button type="button" onClick={handleSupprimerLogo} disabled={televersementLogo} style={boutonSecondaireStyle}>
                  {t("venteRemoveLogoButton")}
                </button>
              )}
            </div>
            <input ref={inputLogoRef} type="file" accept="image/png,image/jpeg" onChange={handleChoisirLogo} style={{ display: "none" }} />
          </div>

          <h3 style={{ fontSize: 12.5, color: "var(--petrol)", marginBottom: 10 }}>{t("enteteTitle")}</h3>

          <label style={labelStyle}>{t("raisonSocialeLabel")}</label>
          <input
            value={form.raison_sociale}
            onChange={(e) => setForm((f) => ({ ...f, raison_sociale: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("adresseLabel")}</label>
          <input
            value={form.adresse}
            onChange={(e) => setForm((f) => ({ ...f, adresse: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("telephoneLabel")}</label>
          <input
            value={form.telephone}
            onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("emailLabel2")}</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            style={inputStyle}
          />

          <h3 style={{ fontSize: 12.5, color: "var(--petrol)", marginTop: 20, marginBottom: 4 }}>
            {t("enteteFooterSection")}
          </h3>
          <p style={{ fontSize: 11, color: "var(--sub)", marginBottom: 10 }}>{t("enteteFooterDescription")}</p>

          <label style={labelStyle}>{t("enteteRccmLabel")}</label>
          <input
            value={form.rccm}
            onChange={(e) => setForm((f) => ({ ...f, rccm: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("enteteNineaLabel")}</label>
          <input
            value={form.ninea}
            onChange={(e) => setForm((f) => ({ ...f, ninea: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("enteteSiteWebLabel")}</label>
          <input
            value={form.site_web}
            onChange={(e) => setForm((f) => ({ ...f, site_web: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("enteteCoordonneesBancairesLabel")}</label>
          <input
            value={form.coordonnees_bancaires}
            onChange={(e) => setForm((f) => ({ ...f, coordonnees_bancaires: e.target.value }))}
            style={inputStyle}
          />

          <h3 style={{ fontSize: 12.5, color: "var(--petrol)", marginTop: 20, marginBottom: 4 }}>{t("saParContratsSection")}</h3>
          <p style={{ fontSize: 11, color: "var(--sub)", marginBottom: 10 }}>{t("saParContratsAide")}</p>

          <label style={{ ...labelStyle, marginTop: 0 }}>{t("saParFormeJuridique")}</label>
          <input
            value={form.forme_juridique}
            onChange={(e) => setForm((f) => ({ ...f, forme_juridique: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("saParCapital")}</label>
          <input
            value={form.capital_social}
            onChange={(e) => setForm((f) => ({ ...f, capital_social: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("saParRepresentantNom")}</label>
          <input
            value={form.representant_nom}
            onChange={(e) => setForm((f) => ({ ...f, representant_nom: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("saParRepresentantFonction")}</label>
          <input
            value={form.representant_fonction}
            onChange={(e) => setForm((f) => ({ ...f, representant_fonction: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("saParVilleSignature")}</label>
          <input
            value={form.ville_signature}
            onChange={(e) => setForm((f) => ({ ...f, ville_signature: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("saParTribunal")}</label>
          <input
            value={form.tribunal_competent}
            onChange={(e) => setForm((f) => ({ ...f, tribunal_competent: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("saParPenalite")}</label>
          <input
            value={form.penalite_pi_mois}
            onChange={(e) => setForm((f) => ({ ...f, penalite_pi_mois: e.target.value }))}
            style={inputStyle}
            inputMode="numeric"
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("saParMentionPi")}</label>
          <textarea
            rows={3}
            value={form.mention_propriete_intellectuelle}
            onChange={(e) => setForm((f) => ({ ...f, mention_propriete_intellectuelle: e.target.value }))}
            style={{ ...inputStyle, resize: "vertical" }}
            placeholder={t("saParMentionPiPlaceholder")}
          />
          <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 4 }}>{t("saParMentionPiAide")}</p>

          {/* Signature + cachet : une seule image (le cachet papier est
              scanne avec la signature dessus, usage reel). Televersee
              immediatement comme le logo, independamment du bouton
              "Enregistrer" qui ne concerne que les champs texte ci-dessus. */}
          <h3 style={{ fontSize: 12.5, color: "var(--petrol)", marginTop: 20, marginBottom: 4 }}>
            {t("saSignatureCachetLabel")}
          </h3>
          <p style={{ fontSize: 11, color: "var(--sub)", marginBottom: 10 }}>{t("saSignatureCachetDescription")}</p>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {signatureCachet ? (
              <img
                src={`data:${signatureCachet.mime};base64,${signatureCachet.base64}`}
                alt={t("saSignatureCachetLabel")}
                style={{
                  maxWidth: 140,
                  maxHeight: 90,
                  objectFit: "contain",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: 4,
                }}
              />
            ) : (
              <span style={{ fontSize: 12, color: "var(--sub)" }}>{t("saNoSignatureCachet")}</span>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => inputSignatureRef.current?.click()}
                disabled={televersementSignature}
                style={boutonSecondaireStyle}
              >
                {televersementSignature ? t("saCreating") : t("venteUploadLogoButton")}
              </button>
              {signatureCachet && (
                <button
                  type="button"
                  onClick={handleSupprimerSignatureCachet}
                  disabled={televersementSignature}
                  style={boutonSecondaireStyle}
                >
                  {t("venteRemoveLogoButton")}
                </button>
              )}
            </div>
            <input
              ref={inputSignatureRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleChoisirSignatureCachet}
              style={{ display: "none" }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
            <button type="submit" disabled={enregistrement} style={boutonPrincipalStyle}>
              {t("save")}
            </button>
            {confirmation && <span style={{ fontSize: 12.5, color: "var(--vert)" }}>{t("savedConfirmation")}</span>}
          </div>
        </form>
      )}

      <div className="card" style={{ maxWidth: 560, marginTop: 16 }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 4 }}>{t("securitySection")}</h3>
        <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 14 }}>{t("securityDescription")}</p>
        <Link
          href="/super-admin/changer-mot-de-passe"
          style={{ ...boutonSecondaireStyle, display: "inline-block", textDecoration: "none" }}
        >
          {t("securityChangePasswordLink")}
        </Link>
      </div>
    </SuperAdminShell>
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
  padding: "7px 14px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
