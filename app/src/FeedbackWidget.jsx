import React, { useEffect, useMemo, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import { doc, getFirestore, serverTimestamp, setDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBzk_jZfpv4j7PxroeTISwx11LffEB3TWQ",
  authDomain: "control-de-calidad-triton.firebaseapp.com",
  projectId: "control-de-calidad-triton",
  storageBucket: "control-de-calidad-triton.firebasestorage.app",
  messagingSenderId: "41329486719",
  appId: "1:41329486719:web:1bf7ff827d3b60227f084a",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const feedbackTypes = ["Mejora", "Error", "Proceso confuso", "Nueva función", "Seguridad / acceso"];
const brand = { gold: "#F5B21A", goldDark: "#8A6400", text: "#242322", muted: "#6B6862", border: "rgba(88,84,76,.16)", soft: "rgba(245,178,26,.12)" };
const input = { width: "100%", border: `1px solid ${brand.border}`, borderRadius: 16, padding: "12px 14px", fontSize: 14, color: brand.text, background: "#fff", boxSizing: "border-box" };

function getContext() {
  const title = document.querySelector("h2")?.textContent || document.title || "TRITON OS";
  return `${title} · ${window.location.pathname}${window.location.search || ""}`;
}
function readFeedback() {
  try { return JSON.parse(localStorage.getItem("triton_feedback") || "[]"); } catch { return []; }
}
export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("Mejora");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [items, setItems] = useState(readFeedback);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("triton-open-feedback-module", handler);
    return () => window.removeEventListener("triton-open-feedback-module", handler);
  }, []);

  const context = useMemo(() => getContext(), [open]);

  async function saveFeedback() {
    const clean = message.trim();
    if (!clean) return;
    const item = {
      id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type,
      message: clean,
      context,
      status: "Nuevo",
      createdAt: new Date().toISOString(),
      createdBy: auth.currentUser?.email || "usuario",
      appVersion: "v50",
    };
    const next = [item, ...items].slice(0, 100);
    setItems(next);
    localStorage.setItem("triton_feedback", JSON.stringify(next));
    setMessage("");
    setStatus("Guardado localmente");
    try {
      await setDoc(doc(db, "feedback", item.id), { ...item, serverCreatedAt: serverTimestamp() }, { merge: true });
      setStatus("Guardado en feedback del sistema");
    } catch (error) {
      setStatus(`Guardado local. Firestore: ${error?.message || "sin conexión"}`);
    }
    window.setTimeout(() => setStatus(""), 2600);
  }

  return <>
    <button type="button" onClick={() => setOpen(true)} title="Enviar feedback" style={{ position: "fixed", right: 18, bottom: "calc(24px + env(safe-area-inset-bottom,0px))", zIndex: 2147483647, border: "2px solid rgba(255,255,255,.86)", borderRadius: 999, padding: "12px 16px", background: "linear-gradient(180deg,#F5B21A 0%,#8A6400 100%)", color: "#fff", fontWeight: 950, boxShadow: "0 18px 48px rgba(245,178,26,.34),0 4px 14px rgba(0,0,0,.18)", cursor: "pointer" }}>Feedback</button>
    {open ? <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, pointerEvents: "none" }}>
      <div onClick={() => setOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,.12)", backdropFilter: "blur(2px)", pointerEvents: "auto" }} />
      <aside style={{ position: "absolute", right: 18, bottom: 18, top: 18, width: "min(440px, calc(100vw - 36px))", background: "rgba(255,255,255,.99)", border: `1px solid ${brand.border}`, borderRadius: 28, boxShadow: "0 24px 80px rgba(0,0,0,.18)", overflow: "hidden", pointerEvents: "auto", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
        <header style={{ padding: 18, borderBottom: `1px solid ${brand.border}`, display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div><div style={{ fontSize: 12, fontWeight: 950, color: brand.goldDark, textTransform: "uppercase", letterSpacing: .8 }}>TRITON OS Feedback</div><h2 style={{ margin: "6px 0 0", fontSize: 22, color: brand.text }}>Mejoras de prueba</h2><div style={{ color: brand.muted, fontSize: 12, marginTop: 4 }}>Escribe como chat. Queda guardado para pulir cada versión.</div></div>
          <button onClick={() => setOpen(false)} style={{ border: 0, background: "rgba(88,84,76,.08)", borderRadius: 14, width: 38, height: 38, fontWeight: 950, cursor: "pointer" }}>×</button>
        </header>
        <main style={{ padding: 16, overflow: "auto", display: "grid", gap: 10, alignContent: "start", background: "linear-gradient(180deg,#fff 0%,#F7F2E8 100%)" }}>
          <div style={{ justifySelf: "start", maxWidth: "88%", padding: 12, borderRadius: "16px 16px 16px 4px", background: "#fff", border: `1px solid ${brand.border}`, color: brand.text }}>¿Qué mejorarías del sistema? Puedes reportar errores, flujos confusos o ideas para el siguiente deploy.</div>
          {items.slice(0, 12).reverse().map((item) => <div key={item.id} style={{ justifySelf: "end", maxWidth: "92%", padding: 12, borderRadius: "16px 16px 4px 16px", background: brand.soft, border: `1px solid rgba(245,178,26,.35)` }}><b style={{ color: brand.goldDark }}>{item.type}</b><div style={{ color: brand.text, marginTop: 4, fontSize: 13 }}>{item.message}</div><div style={{ color: brand.muted, fontSize: 11, marginTop: 6 }}>{String(item.createdAt || "").slice(0,16).replace("T"," ")} · {item.context}</div></div>)}
        </main>
        <footer style={{ padding: 14, borderTop: `1px solid ${brand.border}`, display: "grid", gap: 10 }}>
          <select value={type} onChange={(e) => setType(e.target.value)} style={input}>{feedbackTypes.map((x) => <option key={x}>{x}</option>)}</select>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Escribe tu feedback..." style={{ ...input, resize: "vertical" }} />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}><span style={{ color: brand.muted, fontSize: 12 }}>{status || context}</span><button type="button" onClick={saveFeedback} disabled={!message.trim()} style={{ border: 0, borderRadius: 14, padding: "11px 14px", background: message.trim() ? brand.gold : "#e5e1d8", color: message.trim() ? "#fff" : brand.muted, fontWeight: 950, cursor: message.trim() ? "pointer" : "not-allowed" }}>Enviar</button></div>
        </footer>
      </aside>
    </div> : null}
  </>;
}
