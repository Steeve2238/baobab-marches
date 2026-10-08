"use client";

import { useState } from "react";
import { boutonLeger, boutonPrincipal, inputStyle } from "./rhUi";

/**
 * Etape "code de confirmation" : demande l'envoi du code par e-mail, puis saisie du code.
 * demanderCode() -> { envoye_a, code_test? } ; valider(code) execute l'action finale (peut lever une erreur).
 */
export default function CodeConfirmation({ t, demanderCode, valider, libelleValider, desactive, onErreur }) {
  const [envoye, setEnvoye] = useState(null);
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function envoyer() {
    setEnCours(true);
    onErreur("");
    try {
      setEnvoye(await demanderCode());
      setCode("");
    } catch (e) {
      onErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }
  async function confirmer() {
    setEnCours(true);
    onErreur("");
    try {
      await valider(code);
    } catch (e) {
      onErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {!envoye ? (
        <div>
          <button type="button" disabled={enCours || desactive} style={{ ...boutonLeger, opacity: desactive ? 0.5 : 1 }} onClick={envoyer}>
            {t("rheRecevoirCode")}
          </button>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "var(--sub)", margin: 0 }}>
            {t("rheCodeEnvoye")} <strong>{envoye.envoye_a}</strong> ({t("rheCodeValide")}).
            {envoye.code_test ? ` ${t("rheCodeTest")} ${envoye.code_test}.` : ""}
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 }}>{t("rheCodeLabel")}</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="mono"
                style={{ ...inputStyle, width: 160, letterSpacing: 4, fontSize: 16, textAlign: "center" }}
              />
            </div>
            <button type="button" disabled={enCours || code.length !== 6 || desactive} style={{ ...boutonPrincipal, opacity: code.length === 6 && !desactive ? 1 : 0.5 }} onClick={confirmer}>
              {libelleValider}
            </button>
            <button type="button" disabled={enCours} style={boutonLeger} onClick={envoyer}>{t("rheRecevoirCode")}</button>
          </div>
        </>
      )}
    </div>
  );
}
