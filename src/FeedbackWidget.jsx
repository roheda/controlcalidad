import React, { useMemo, useState } from "react";

const feedbackTypes = [
  "Mejora de interfaz",
  "Error o problema",
  "Proceso confuso",
  "Nueva función",
];

function getCurrentContext() {
  if (typeof window === "undefined") return "Sin contexto";
  return `${window.location.pathname}${window.location.search || ""}`;
}

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(feedbackTypes[0]);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const feedbackText = useMemo(() => {
    const context = getCurrentContext();
    const createdAt = new Date().toLocaleString("es-MX");

    return [
      "Feedback para mejorar Control de Calidad",
      `Tipo: ${type}`,
      `Fecha: ${createdAt}`,
      `Pantalla: ${context}`,
      "",
      "Comentario:",
      message.trim() || "Sin comentario todavía",
    ].join("\n");
  }, [type, message]);

  async function copyFeedback() {
    if (!message.trim()) return;

    try {
      await navigator.clipboard.writeText(feedbackText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      console.error(error);
      window.prompt("Copia este feedback:", feedbackText);
    }
  }

  function saveFeedback() {
    if (!message.trim()) return;

    const nextFeedback = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      message: message.trim(),
      context: getCurrentContext(),
      createdAt: new Date().toISOString(),
    };

    const previous = JSON.parse(localStorage.getItem("triton_feedback") || "[]");
    localStorage.setItem("triton_feedback", JSON.stringify([nextFeedback, ...previous].slice(0, 50)));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
    setMessage("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Generar feedback para mejorar"
        style={{
          position: "fixed",
          right: 22,
          bottom: 22,
          zIndex: 950,
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          border: "1px solid rgba(255,255,255,0.62)",
          borderRadius: 999,
          padding: "13px 18px",
          background: "linear-gradient(180deg, #007aff 0%, #005ecb 100%)",
          color: "#fff",
          fontWeight: 800,
          fontSize: 14,
          letterSpacing: -0.1,
          cursor: "pointer",
          boxShadow: "0 16px 40px rgba(0, 122, 255, 0.34)",
          backdropFilter: "blur(18px)",
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>✦</span>
        Feedback
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Feedback para mejorar"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: 18,
            background: "rgba(29, 29, 31, 0.38)",
            backdropFilter: "blur(16px)",
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(100%, 520px)",
              border: "1px solid rgba(255, 255, 255, 0.64)",
              borderRadius: 28,
              background: "rgba(255, 255, 255, 0.92)",
              boxShadow: "0 24px 70px rgba(0, 0, 0, 0.18)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "20px 22px 16px",
                borderBottom: "1px solid rgba(60, 60, 67, 0.12)",
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                alignItems: "flex-start",
              }}
            >
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "#1d1d1f", letterSpacing: -0.4 }}>
                  Feedback para mejorar
                </div>
                <div style={{ marginTop: 5, color: "#6e6e73", fontSize: 14, lineHeight: 1.45 }}>
                  Registra ideas, errores o mejoras de experiencia del sistema.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  border: "1px solid rgba(60, 60, 67, 0.12)",
                  background: "rgba(242, 242, 247, 0.9)",
                  color: "#1d1d1f",
                  borderRadius: 999,
                  width: 36,
                  height: 36,
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: 22 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 800, color: "#1d1d1f", marginBottom: 8 }}>
                Tipo de feedback
              </label>
              <select
                value={type}
                onChange={(event) => setType(event.target.value)}
                style={{
                  width: "100%",
                  minHeight: 46,
                  border: "1px solid rgba(60, 60, 67, 0.16)",
                  borderRadius: 16,
                  padding: "0 14px",
                  background: "#fff",
                  color: "#1d1d1f",
                  fontWeight: 700,
                  outline: "none",
                  marginBottom: 16,
                }}
              >
                {feedbackTypes.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              <label style={{ display: "block", fontSize: 13, fontWeight: 800, color: "#1d1d1f", marginBottom: 8 }}>
                ¿Qué debería mejorar?
              </label>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={5}
                placeholder="Ej. En la pantalla de checklist sería mejor ver primero los puntos pendientes..."
                style={{
                  width: "100%",
                  minHeight: 128,
                  border: "1px solid rgba(60, 60, 67, 0.16)",
                  borderRadius: 18,
                  padding: 14,
                  background: "#fff",
                  color: "#1d1d1f",
                  lineHeight: 1.5,
                  outline: "none",
                  resize: "vertical",
                }}
              />

              <div
                style={{
                  marginTop: 12,
                  padding: "12px 14px",
                  borderRadius: 18,
                  background: "rgba(0, 122, 255, 0.08)",
                  color: "#005ecb",
                  fontSize: 13,
                  lineHeight: 1.45,
                  fontWeight: 700,
                }}
              >
                El feedback se guarda en este navegador y también puedes copiarlo para enviarlo por WhatsApp, correo o Trello.
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{
                    border: "1px solid rgba(60, 60, 67, 0.14)",
                    background: "#fff",
                    color: "#1d1d1f",
                    borderRadius: 999,
                    padding: "11px 16px",
                    cursor: "pointer",
                    fontWeight: 800,
                  }}
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  onClick={copyFeedback}
                  disabled={!message.trim()}
                  style={{
                    border: "1px solid rgba(0, 122, 255, 0.28)",
                    background: "#fff",
                    color: message.trim() ? "#007aff" : "#8e8e93",
                    borderRadius: 999,
                    padding: "11px 16px",
                    cursor: message.trim() ? "pointer" : "not-allowed",
                    fontWeight: 800,
                  }}
                >
                  {copied ? "Copiado" : "Copiar"}
                </button>
                <button
                  type="button"
                  onClick={saveFeedback}
                  disabled={!message.trim()}
                  style={{
                    border: "1px solid rgba(0, 122, 255, 0.34)",
                    background: message.trim()
                      ? "linear-gradient(180deg, #007aff 0%, #005ecb 100%)"
                      : "rgba(142, 142, 147, 0.16)",
                    color: message.trim() ? "#fff" : "#8e8e93",
                    borderRadius: 999,
                    padding: "11px 16px",
                    cursor: message.trim() ? "pointer" : "not-allowed",
                    fontWeight: 900,
                    boxShadow: message.trim() ? "0 12px 28px rgba(0, 122, 255, 0.22)" : "none",
                  }}
                >
                  {copied ? "Guardado" : "Guardar feedback"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
