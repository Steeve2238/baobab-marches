"use client";

import { useEffect, useState } from "react";
import { api } from "../../api";
import { useLangue } from "../../i18n/LanguageContext";
import { Champ, Section, grille, inputStyle, boutonPrincipal, useStatut, Statut } from "../paieUi";

export default function ParamGeneraux({ peutModifier }) {
  const { t } = useLangue();
  const [f, setF] = useState(null);
  const s = useStatut();

  useEffect(() => {
    api.paieReglages().then(setF).catch(s.ko);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!f) return <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>;
  const maj = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function enregistrer() {
    try {
      const r = await api.paieEnregistrerReglages(f);
      setF(r);
      s.ok(t("paieEnregistre"));
    } catch (e) { s.ko(e); }
  }

  return (
    <Section titre={t("paieGenTitre")} aide={t("paieGenAide")}>
      <Statut s={s} />
      <div style={grille}>
        <Champ label={t("paieGenJours")}><input type="number" style={inputStyle} value={f.jours_mois} onChange={maj("jours_mois")} disabled={!peutModifier} /></Champ>
        <Champ label={t("paieGenHeures")}><input type="number" step="0.01" style={inputStyle} value={f.heures_mensuelles} onChange={maj("heures_mensuelles")} disabled={!peutModifier} /></Champ>
        <Champ label={t("paieGenArrondi")}>
          <select style={inputStyle} value={f.arrondi_net} onChange={maj("arrondi_net")} disabled={!peutModifier}>
            {[1, 5, 10, 25, 50, 100, 500, 1000].map((n) => <option key={n} value={n}>{n === 1 ? t("paieGenArrondiFranc") : `${n} F`}</option>)}
          </select>
        </Champ>
        <Champ label={t("paieGenBaseHoraire")}>
          <select style={inputStyle} value={f.base_taux_horaire} onChange={maj("base_taux_horaire")} disabled={!peutModifier}>
            <option value="BASE_SURSALAIRE">{t("paieGenBaseSursalaire")}</option>
            <option value="BASE">{t("paieGenBaseSeule")}</option>
          </select>
        </Champ>
        <Champ label={t("paieGenModeIr")}>
          <select style={inputStyle} value={f.mode_ir} onChange={maj("mode_ir")} disabled={!peutModifier}>
            <option value="BAREME">{t("paieGenIrBareme")}</option>
            <option value="FORMULE">{t("paieGenIrFormule")}</option>
            <option value="CUMUL">{t("paieGenIrCumul")}</option>
          </select>
        </Champ>
      </div>
      <h3 style={{ fontSize: 13, margin: "18px 0 8px" }}>{t("paieGenEmployeur")}</h3>
      <div style={grille}>
        <Champ label={t("paieGenNumCss")}><input style={inputStyle} value={f.numero_employeur_css || ""} onChange={maj("numero_employeur_css")} disabled={!peutModifier} /></Champ>
        <Champ label={t("paieGenNumIpres")}><input style={inputStyle} value={f.numero_employeur_ipres || ""} onChange={maj("numero_employeur_ipres")} disabled={!peutModifier} /></Champ>
        <Champ label={t("paieGenLieu")}><input style={inputStyle} value={f.lieu_signature || ""} onChange={maj("lieu_signature")} disabled={!peutModifier} /></Champ>
      </div>
      <h3 style={{ fontSize: 13, margin: "18px 0 4px" }}>{t("paieGenVirement")}</h3>
      <p style={{ fontSize: 12, color: "var(--sub)", margin: "0 0 8px" }}>{t("paieGenVirementAide")}</p>
      <div style={grille}>
        <Champ label={t("paieOvBanque")}><input style={inputStyle} value={f.banque_donneur || ""} onChange={maj("banque_donneur")} disabled={!peutModifier} /></Champ>
        <Champ label={t("paieOvCompte")}><input style={inputStyle} value={f.compte_donneur || ""} onChange={maj("compte_donneur")} disabled={!peutModifier} /></Champ>
        <Champ label={t("paieGenJourVirement")}><input type="number" min="1" max="31" style={inputStyle} value={f.jour_virement ?? ""} onChange={maj("jour_virement")} disabled={!peutModifier} placeholder={t("paieGenJourVirementDefaut")} /></Champ>
      </div>
      {peutModifier && <div style={{ marginTop: 14 }}><button style={boutonPrincipal} onClick={enregistrer}>{t("paieEnregistrer")}</button></div>}
    </Section>
  );
}
