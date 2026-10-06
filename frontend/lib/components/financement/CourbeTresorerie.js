"use client";

import { useMemo, useState } from "react";
import { useLangue } from "../../i18n/LanguageContext";

const COULEUR_SANS = "#B23A2E";
const COULEUR_AVEC = "#0A8CA3";
const DAY = 86400000;
const ms = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const jours = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function fmtCompact(n, locale = "fr-FR") {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString(locale, { maximumFractionDigits: 2 })} M`;
  if (a >= 1e3) return `${(v / 1e3).toLocaleString(locale, { maximumFractionDigits: 0 })} k`;
  return v.toLocaleString(locale, { maximumFractionDigits: 0 });
}

function soldeAu(points, iso) {
  let s = points.length ? points[0].solde : 0;
  for (const p of points) {
    if (p.date <= iso) s = p.solde;
    else break;
  }
  return s;
}

function echelleNice(min, max, n = 5) {
  const etendue = max - min || 1;
  const brut = etendue / n;
  const pow = Math.pow(10, Math.floor(Math.log10(brut)));
  const f = brut / pow;
  const pas = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  const lo = Math.floor(min / pas) * pas;
  const hi = Math.ceil(max / pas) * pas;
  const ticks = [];
  for (let v = lo; v <= hi + pas / 2; v += pas) ticks.push(Math.round(v));
  return { lo, hi, ticks };
}

/** Courbe de tresorerie cumulee : sans financement (pointille) et avec la ligne (trait plein). */
export default function CourbeTresorerie({ plan, locale = "fr-FR" }) {
  const { t } = useLangue();
  const [survol, setSurvol] = useState(null);
  const W = 920;
  const H = 320;
  const M = { g: 64, d: 18, h: 16, b: 40 };
  const dateT = plan.date_t;
  const fin = plan.synthese.date_fin;
  const horizon = Math.max(1, jours(dateT, fin));
  const sans = plan.sans.points;
  const avec = plan.avec ? plan.avec.points : null;

  const { lo, hi, ticks } = useMemo(() => {
    const vals = [0, ...sans.map((p) => p.solde), ...(avec ? avec.map((p) => p.solde) : [])];
    return echelleNice(Math.min(...vals), Math.max(...vals));
  }, [sans, avec]);

  const x = (iso) => M.g + (jours(dateT, iso) / horizon) * (W - M.g - M.d);
  const y = (v) => M.h + (1 - (v - lo) / (hi - lo || 1)) * (H - M.h - M.b);

  function chemin(points) {
    let d = `M ${x(points[0].date)} ${y(points[0].solde)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` H ${x(points[i].date)} V ${y(points[i].solde)}`;
    }
    d += ` H ${x(fin)}`;
    return d;
  }

  // graduations du temps : environ 8 reperes T + n jours
  const pasJours = [1, 2, 5, 7, 10, 15, 30, 60, 90][[1, 2, 5, 7, 10, 15, 30, 60, 90].findIndex((p) => horizon / p <= 9)] || 90;
  const reperes = [];
  for (let j = 0; j <= horizon; j += pasJours) {
    const iso = new Date(ms(dateT) + j * DAY).toISOString().slice(0, 10);
    reperes.push({ j, iso });
  }

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const j = Math.max(0, Math.min(horizon, Math.round(((px - M.g) / (W - M.g - M.d)) * horizon)));
    const iso = new Date(ms(dateT) + j * DAY).toISOString().slice(0, 10);
    setSurvol({ j, iso, sans: soldeAu(sans, iso), avec: avec ? soldeAu(avec, iso) : null });
  }

  const pb = plan.sans.besoin_max > 0 ? { date: plan.sans.date_min, solde: plan.sans.solde_min } : null;

  return (
    <figure style={{ margin: 0 }}>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, color: "var(--ink)", marginBottom: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke={COULEUR_SANS} strokeWidth="2" strokeDasharray="5 3" /></svg>
          {t("planSerieSans")}
        </span>
        {avec && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke={COULEUR_AVEC} strokeWidth="2" /></svg>
            {t("planSerieAvec")}
          </span>
        )}
      </div>
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("planGraphique")} style={{ width: "100%", height: "auto", display: "block" }} onMouseMove={onMove} onMouseLeave={() => setSurvol(null)}>
          {/* grille et axe des montants */}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={M.g} x2={W - M.d} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={v === 0 ? 0 : 1} />
              <text x={M.g - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--sub)">{fmtCompact(v, locale)}</text>
            </g>
          ))}
          {/* zone a financer : sous la ligne zero */}
          {lo < 0 && <rect x={M.g} y={y(0)} width={W - M.g - M.d} height={y(lo) - y(0)} fill={COULEUR_SANS} opacity="0.06" />}
          <line x1={M.g} x2={W - M.d} y1={y(0)} y2={y(0)} stroke="var(--ink)" strokeWidth="1.2" />
          {/* axe du temps */}
          {reperes.map((r) => (
            <g key={r.j}>
              <line x1={x(r.iso)} x2={x(r.iso)} y1={H - M.b} y2={H - M.b + 4} stroke="var(--sub)" />
              <text x={x(r.iso)} y={H - M.b + 16} textAnchor="middle" fontSize="11" fill="var(--sub)">T+{r.j}</text>
              <text x={x(r.iso)} y={H - M.b + 29} textAnchor="middle" fontSize="10" fill="var(--sub)">{ddmm(r.iso)}</text>
            </g>
          ))}
          {/* series */}
          <path d={chemin(sans)} fill="none" stroke={COULEUR_SANS} strokeWidth="2" strokeDasharray="6 4" />
          {avec && <path d={chemin(avec)} fill="none" stroke={COULEUR_AVEC} strokeWidth="2" />}
          {/* point bas */}
          {pb && (
            <g>
              <circle cx={x(pb.date)} cy={y(pb.solde)} r="5" fill={COULEUR_SANS} stroke="#fff" strokeWidth="2" />
              <text x={Math.min(x(pb.date) + 9, W - 150)} y={y(pb.solde) + (y(pb.solde) > H - M.b - 20 ? -10 : 16)} fontSize="11.5" fontWeight="700" fill="var(--ink)">
                {t("planPointBas")} : {fmtCompact(pb.solde, locale)}
              </text>
            </g>
          )}
          {/* reperage au survol */}
          {survol && (
            <g pointerEvents="none">
              <line x1={x(survol.iso)} x2={x(survol.iso)} y1={M.h} y2={H - M.b} stroke="var(--sub)" strokeDasharray="2 3" />
              <circle cx={x(survol.iso)} cy={y(survol.sans)} r="4" fill={COULEUR_SANS} stroke="#fff" strokeWidth="2" />
              {avec && <circle cx={x(survol.iso)} cy={y(survol.avec)} r="4" fill={COULEUR_AVEC} stroke="#fff" strokeWidth="2" />}
            </g>
          )}
        </svg>
        {survol && (
          <div
            style={{
              position: "absolute",
              top: 6,
              left: `${Math.min(78, Math.max(2, (x(survol.iso) / W) * 100 + 1))}%`,
              background: "#fff",
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              boxShadow: "0 2px 8px rgba(20,35,42,0.12)",
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            <div style={{ fontWeight: 700 }}>T + {survol.j} · {ddmm(survol.iso)}</div>
            <div><span style={{ display: "inline-block", width: 14, borderTop: `2px dashed ${COULEUR_SANS}`, marginRight: 6, verticalAlign: "middle" }} />{t("planSerieSans")} : {Math.round(survol.sans).toLocaleString(locale)}</div>
            {avec && <div><span style={{ display: "inline-block", width: 14, borderTop: "2px solid #0A8CA3", marginRight: 6, verticalAlign: "middle" }} />{t("planSerieAvec")} : {Math.round(survol.avec).toLocaleString(locale)}</div>}
          </div>
        )}
      </div>
      <figcaption style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 4 }}>{t("planGraphiqueAide")}</figcaption>
    </figure>
  );
}
