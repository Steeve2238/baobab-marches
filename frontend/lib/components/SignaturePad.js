"use client";

import { useEffect, useRef, useState } from "react";
import { boutonLeger } from "./rhUi";

/**
 * Saisie d'une signature : dessin (souris, doigt, stylet) ou import d'une image PNG/JPEG.
 * onChange recoit { image: "data:image/png;base64,...", mode: "DESSINEE" | "IMPORTEE" } ou null quand le cadre est vide.
 */
const LARGEUR = 520;
const HAUTEUR = 180;

export default function SignaturePad({ t, onChange }) {
  const [mode, setMode] = useState("DESSINEE");
  const [apercu, setApercu] = useState(null);
  const [erreur, setErreur] = useState("");
  const canvasRef = useRef(null);
  const dessin = useRef({ actif: false, trace: false });

  useEffect(() => {
    if (mode !== "DESSINEE") return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b1f3a";
  }, [mode]);

  function position(e) {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  }
  function debut(e) {
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    const p = position(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
    dessin.current.actif = true;
  }
  function trace(e) {
    if (!dessin.current.actif) return;
    e.preventDefault();
    const p = position(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    dessin.current.trace = true;
  }
  function fin() {
    if (!dessin.current.actif) return;
    dessin.current.actif = false;
    if (dessin.current.trace) onChange({ image: canvasRef.current.toDataURL("image/png"), mode: "DESSINEE" });
  }
  function effacer() {
    const c = canvasRef.current;
    if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height);
    dessin.current.trace = false;
    setApercu(null);
    setErreur("");
    onChange(null);
  }

  function importer(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) {
      setErreur(t("rheImportAide"));
      return;
    }
    const lecteur = new FileReader();
    lecteur.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Reduit l'image (largeur max 700 px) pour rester leger ; fond blanc conserve pour les JPEG.
        const ratio = Math.min(1, 700 / img.width);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * ratio);
        c.height = Math.round(img.height * ratio);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL("image/png");
        setErreur("");
        setApercu(data);
        onChange({ image: data, mode: "IMPORTEE" });
      };
      img.src = lecteur.result;
    };
    lecteur.readAsDataURL(f);
  }

  const onglet = (m) => ({
    ...boutonLeger,
    background: mode === m ? "var(--petrol)" : "transparent",
    color: mode === m ? "#fff" : "inherit",
    borderColor: mode === m ? "var(--petrol)" : "var(--line)",
  });

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={onglet("DESSINEE")} onClick={() => { setMode("DESSINEE"); setApercu(null); onChange(null); }}>{t("rheDessiner")}</button>
        <button type="button" style={onglet("IMPORTEE")} onClick={() => { setMode("IMPORTEE"); dessin.current.trace = false; onChange(null); }}>{t("rheImporter")}</button>
      </div>
      {mode === "DESSINEE" ? (
        <>
          <p style={{ fontSize: 11.5, color: "var(--sub)", margin: 0 }}>{t("rheDessinAide")}</p>
          <canvas
            ref={canvasRef}
            width={LARGEUR}
            height={HAUTEUR}
            onPointerDown={debut}
            onPointerMove={trace}
            onPointerUp={fin}
            onPointerLeave={fin}
            style={{ width: "100%", maxWidth: LARGEUR, aspectRatio: `${LARGEUR} / ${HAUTEUR}`, border: "1px dashed var(--line)", borderRadius: 8, background: "#fff", touchAction: "none", cursor: "crosshair" }}
          />
        </>
      ) : (
        <>
          <p style={{ fontSize: 11.5, color: "var(--sub)", margin: 0 }}>{t("rheImportAide")}</p>
          <input type="file" accept="image/png,image/jpeg" onChange={importer} style={{ fontSize: 12 }} />
          {apercu && <img src={apercu} alt="" style={{ maxWidth: 320, maxHeight: 140, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />}
        </>
      )}
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12, margin: 0 }}>{erreur}</p>}
      <div>
        <button type="button" style={boutonLeger} onClick={effacer}>{t("rheEffacer")}</button>
      </div>
    </div>
  );
}
