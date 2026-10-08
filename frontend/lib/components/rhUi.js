// Styles et petits composants partages par les ecrans RH (contrats, modeles, DMT).
export const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
export const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
};
export const boutonPrincipal = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  textDecoration: "none",
  display: "inline-block",
};
export const boutonLeger = {
  background: "transparent",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
  color: "inherit",
  textDecoration: "none",
  display: "inline-block",
};
export const grille = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 };

export function Champ({ label, children, large, requis }) {
  return (
    <div style={large ? { gridColumn: "1 / -1" } : undefined}>
      <label style={labelStyle}>
        {label}
        {requis ? <span style={{ color: "var(--brique)" }}> *</span> : null}
      </label>
      {children}
    </div>
  );
}

export function Section({ titre, aide, children }) {
  return (
    <section className="card">
      <h2 style={{ fontSize: 14, margin: "0 0 12px" }}>{titre}</h2>
      {aide ? <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "-4px 0 10px" }}>{aide}</p> : null}
      {children}
    </section>
  );
}

export const fmtMontant = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
