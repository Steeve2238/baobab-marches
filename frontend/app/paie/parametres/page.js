"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import PaieSousNav from "../../../lib/components/PaieSousNav";
import ParamGeneraux from "../../../lib/components/paie/ParamGeneraux";
import ParamCotisations from "../../../lib/components/paie/ParamCotisations";
import ParamImpot from "../../../lib/components/paie/ParamImpot";
import ParamConventions from "../../../lib/components/paie/ParamConventions";
import ParamRubriques from "../../../lib/components/paie/ParamRubriques";
import ParamAbsences from "../../../lib/components/paie/ParamAbsences";
import ParamComptes from "../../../lib/components/paie/ParamComptes";

const SECTIONS = ["generaux", "cotisations", "impot", "conventions", "rubriques", "absences", "comptes"];

function Contenu() {
  const { t } = useLangue();
  const router = useRouter();
  const params = useSearchParams();
  const section = SECTIONS.includes(params.get("section")) ? params.get("section") : "generaux";
  const [peutModifier, setPeutModifier] = useState(false);

  useEffect(() => {
    api.paieEtat().then((e) => setPeutModifier(!!e.droit_validation)).catch(() => setPeutModifier(false));
  }, []);

  return (
    <AppShell title={t("paieParamTitre")} subNav={<PaieSousNav />}>
      {!peutModifier && <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12 }}>{t("paieLectureSeule")}</p>}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 16 }}>
        {SECTIONS.map((x) => (
          <button key={x} onClick={() => router.replace(`/paie/parametres?section=${x}`)} style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid var(--line)", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: section === x ? 700 : 500, background: section === x ? "var(--petrol)" : "transparent", color: section === x ? "#fff" : "inherit" }}>
            {t(`paieSection_${x}`)}
          </button>
        ))}
      </div>
      {section === "generaux" && <ParamGeneraux peutModifier={peutModifier} />}
      {section === "cotisations" && <ParamCotisations peutModifier={peutModifier} />}
      {section === "impot" && <ParamImpot peutModifier={peutModifier} />}
      {section === "conventions" && <ParamConventions peutModifier={peutModifier} />}
      {section === "rubriques" && <ParamRubriques peutModifier={peutModifier} />}
      {section === "absences" && <ParamAbsences peutModifier={peutModifier} />}
      {section === "comptes" && <ParamComptes peutModifier={peutModifier} />}
    </AppShell>
  );
}

export default function ParametresPaiePage() {
  return (
    <Suspense fallback={null}>
      <Contenu />
    </Suspense>
  );
}
