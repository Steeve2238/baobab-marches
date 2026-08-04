"use client";

import { useLangue } from "./LanguageContext";

/**
 * Petit toggle FR / EN.
 * variant="light" : pour fond fonce (page de login)
 * variant="default" : pour fond clair (dashboard)
 */
export default function LanguageSwitcher({ variant = "default", persistToBackend = false }) {
  const { langue, setLangue } = useLangue();

  const isLight = variant === "light";
  const baseColor = isLight ? "#fff" : "var(--petrol)";
  const inactiveColor = isLight ? "rgba(255,255,255,0.5)" : "var(--sub)";
  const borderColor = isLight ? "rgba(255,255,255,0.3)" : "var(--line)";

  function optionStyle(code) {
    return {
      background: "none",
      border: "none",
      padding: "2px 6px",
      fontSize: 11.5,
      fontWeight: 700,
      letterSpacing: "0.02em",
      color: langue === code ? baseColor : inactiveColor,
      cursor: "pointer",
    };
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        border: `1px solid ${borderColor}`,
        borderRadius: 20,
        padding: "2px 2px",
      }}
    >
      <button
        type="button"
        onClick={() => setLangue("fr", { persistToBackend })}
        style={optionStyle("fr")}
      >
        FR
      </button>
      <span style={{ color: inactiveColor, fontSize: 10 }}>|</span>
      <button
        type="button"
        onClick={() => setLangue("en", { persistToBackend })}
        style={optionStyle("en")}
      >
        EN
      </button>
    </div>
  );
}
