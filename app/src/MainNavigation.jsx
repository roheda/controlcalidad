import React, { useEffect, useMemo, useState } from "react";

const desktopBreakpoint = 901;

const modules = [
  { id: "calidad", label: "Calidad", helper: "Checklist y evidencias", icon: "✓" },
  { id: "consulta_tecnica", label: "Consulta técnica", helper: "Planos, renders y cambios", icon: "⌕" },
  { id: "estimaciones", label: "Estimaciones", helper: "Avance, revisión y pago", icon: "Σ" },
  { id: "reportes", label: "Reportes", helper: "Dashboard y métricas", icon: "▦" },
  { id: "administracion", label: "Administración", helper: "Usuarios y permisos", icon: "⚙" },
  { id: "obras", label: "Obras", helper: "Catálogo, anticipo y configuración", icon: "⌂" },
];

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= desktopBreakpoint);
  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= desktopBreakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isDesktop;
}

function clickButtonByText(text) {
  const buttons = Array.from(document.querySelectorAll("button"));
  const target = buttons.find((button) => button.textContent?.trim().includes(text));
  if (target) target.click();
}

function openFeedbackModule(moduleId) {
  const labels = { consulta_tecnica: "Consulta técnica", reportes: "Reportes", administracion: "Administración" };
  const label = labels[moduleId];
  if (!label) return;
  const menuButton = Array.from(document.querySelectorAll("button[aria-label='Abrir menú']")).find((button) => !button.classList.contains("triton-shell-menu-button"));
  if (menuButton) {
    menuButton.click();
    window.setTimeout(() => clickButtonByText(label), 90);
  }
}

function closeAllModuleScreens() {
  window.dispatchEvent(new Event("triton-close-estimaciones"));
  window.dispatchEvent(new Event("triton-close-obras-config"));
  window.dispatchEvent(new Event("triton-close-feedback-module"));
  clickButtonByText("Volver a Calidad");
  clickButtonByText("Volver");
}

function NavButton({ module, active, collapsed, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? module.label : undefined}
      style={{
        width: "100%",
        border: active ? "2px solid #007aff" : "1px solid rgba(60,60,67,0.12)",
        borderRadius: 18,
        padding: collapsed ? "12px 0" : 13,
        background: active ? "rgba(0,122,255,0.10)" : "rgba(255,255,255,0.86)",
        color: active ? "#005ecb" : "#1d1d1f",
        cursor: "pointer",
        marginBottom: 8,
        display: "grid",
        gridTemplateColumns: collapsed ? "1fr" : "34px 1fr",
        gap: 10,
        alignItems: "center",
        textAlign: "left",
        boxShadow: active ? "0 0 0 4px rgba(0,122,255,0.08)" : "none",
      }}
    >
      <span style={{ width: 34, height: 34, borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", background: active ? "#007aff" : "#f2f2f7", color: active ? "#fff" : "#1d1d1f", fontWeight: 950, justifySelf: "center" }}>
        {module.icon}
      </span>
      {!collapsed ? (
        <span>
          <span style={{ display: "block", fontWeight: 950, fontSize: 14 }}>{module.label}</span>
          <span style={{ display: "block", color: "#6e6e73", fontSize: 12, marginTop: 3 }}>{module.helper}</span>
        </span>
      ) : null}
    </button>
  );
}

export default function MainNavigation() {
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeModule, setActiveModule] = useState("calidad");
  const sidebarWidth = isDesktop ? (collapsed ? 84 : 272) : 0;

  useEffect(() => {
    document.documentElement.style.setProperty("--triton-shell-offset", `${sidebarWidth}px`);
    return () => document.documentElement.style.removeProperty("--triton-shell-offset");
  }, [sidebarWidth]);

  const styleTag = useMemo(() => `
      .triton-desktop-sidebar,
      .triton-mobile-est-menu,
      button[aria-label='Abrir menú']:not(.triton-shell-menu-button) { display: none !important; }
      @media (min-width: ${desktopBreakpoint}px) {
        #root > div:first-child {
          padding-left: calc(var(--triton-shell-offset, 84px) + 24px) !important;
          transition: padding-left 220ms ease;
        }
      }
      @media (max-width: ${desktopBreakpoint - 1}px) {
        .triton-shell-sidebar { display: none !important; }
        .triton-shell-menu-button { display: inline-flex !important; }
      }
      @media (min-width: ${desktopBreakpoint}px) {
        .triton-shell-menu-button { display: none !important; }
      }
    `, []);

  function goTo(moduleId) {
    setActiveModule(moduleId);
    setMobileOpen(false);

    closeAllModuleScreens();

    if (moduleId === "calidad") return;

    window.setTimeout(() => {
      if (moduleId === "estimaciones") {
        window.dispatchEvent(new Event("triton-open-estimaciones"));
        return;
      }
      if (moduleId === "obras") {
        window.dispatchEvent(new Event("triton-open-obras-config"));
        return;
      }
      openFeedbackModule(moduleId);
    }, 80);
  }

  const navContent = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", gap: 10, marginBottom: 16 }}>
        {!collapsed ? (
          <div>
            <div style={{ fontSize: 20, fontWeight: 950, color: "#1d1d1f", letterSpacing: -0.3 }}>Triton OS</div>
            <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 2 }}>Módulos operativos</div>
          </div>
        ) : (
          <div style={{ width: 44, height: 44, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", background: "#f2f2f7", fontWeight: 950 }}>OS</div>
        )}
        {isDesktop ? (
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? "Expandir menú" : "Minimizar menú"}
            style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 999, width: 36, height: 36, background: "#fff", cursor: "pointer", fontWeight: 950 }}
          >
            {collapsed ? "›" : "‹"}
          </button>
        ) : null}
      </div>
      <div style={{ display: "grid", gap: 2 }}>{modules.map((module) => <NavButton key={module.id} module={module} active={activeModule === module.id} collapsed={collapsed && isDesktop} onClick={() => goTo(module.id)} />)}</div>
    </>
  );

  return (
    <>
      <style>{styleTag}</style>
      <aside className="triton-shell-sidebar" style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: sidebarWidth, zIndex: 2147483646, padding: collapsed ? "18px 10px" : "22px 14px", background: "rgba(255,255,255,0.94)", borderRight: "1px solid rgba(60,60,67,0.12)", boxShadow: "18px 0 50px rgba(0,0,0,0.08)", WebkitBackdropFilter: "blur(22px) saturate(180%)", backdropFilter: "blur(22px) saturate(180%)", transition: "width 220ms ease, padding 220ms ease", overflow: "hidden" }}>
        {navContent}
      </aside>
      <button className="triton-shell-menu-button" type="button" onClick={() => setMobileOpen(true)} aria-label="Abrir navegación" style={{ display: "none", position: "fixed", left: 16, top: "calc(16px + env(safe-area-inset-top, 0px))", zIndex: 2147483646, width: 48, height: 48, border: "1px solid rgba(60,60,67,0.14)", borderRadius: 16, background: "rgba(255,255,255,0.94)", boxShadow: "0 10px 28px rgba(0,0,0,0.12)", fontSize: 22, fontWeight: 950, alignItems: "center", justifyContent: "center" }}>☰</button>
      {mobileOpen ? (
        <div onClick={() => setMobileOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(29,29,31,0.32)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)" }}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: "min(88vw, 340px)", height: "100%", background: "rgba(255,255,255,0.98)", borderRight: "1px solid rgba(60,60,67,0.12)", boxShadow: "20px 0 60px rgba(0,0,0,0.18)", padding: "calc(18px + env(safe-area-inset-top, 0px)) 14px 18px", overflow: "auto" }}>
            {navContent}
          </div>
        </div>
      ) : null}
    </>
  );
}
