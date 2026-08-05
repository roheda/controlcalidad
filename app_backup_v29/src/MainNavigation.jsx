import React, { useEffect, useMemo, useState } from "react";

const desktopBreakpoint = 901;

const groups = [
  { id: "dashboard", label: "Dashboard", helper: "Vista directiva", icon: "▦", module: "dashboard", os: true },
  { id: "operacion", label: "Operación", helper: "Obra, calidad y trámites", icon: "✓", children: [
    { id: "calidad", label: "Checklist / Calidad" },
    { id: "obras", label: "Configurar obra" },
    { id: "estimaciones", label: "Estimaciones" },
    { id: "equipo_obra", label: "Equipo construcción", os: true },
    { id: "tramites", label: "Trámites", os: true },
    { id: "consulta_tecnica", label: "Consulta técnica" },
  ]},
  { id: "finanzas_group", label: "Finanzas", helper: "Proveedores, pagos y caja", icon: "$", children: [
    { id: "finanzas", label: "Resumen financiero", os: true },
    { id: "proveedores", label: "Proveedores", os: true },
    { id: "cxp", label: "Cuentas por pagar", os: true },
    { id: "caja_chica", label: "Caja chica", os: true },
  ]},
  { id: "comercial", label: "Comercial / Cobranza", helper: "Rentas y contratos", icon: "↙", children: [
    { id: "cobranza", label: "Rentas / contratos", os: true },
  ]},
  { id: "reportes", label: "Reportes", helper: "Dirección", icon: "▤", module: "reportes_os", os: true },
  { id: "config", label: "Configuración", helper: "Sistema", icon: "⚙", module: "config_os", os: true },
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
  if (menuButton) { menuButton.click(); window.setTimeout(() => clickButtonByText(label), 90); }
}

function closeAllModuleScreens() {
  window.dispatchEvent(new Event("triton-close-estimaciones"));
  window.dispatchEvent(new Event("triton-close-obras-config"));
  window.dispatchEvent(new Event("triton-close-feedback-module"));
  window.dispatchEvent(new Event("triton-close-os-module"));
  clickButtonByText("Volver a Calidad");
  clickButtonByText("Volver");
}

function isGroupActive(group, activeModule) {
  const target = group.module || group.id;
  return target === activeModule || (group.children || []).some((child) => child.id === activeModule);
}

export default function MainNavigation() {
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeModule, setActiveModule] = useState("calidad");
  const [openGroups, setOpenGroups] = useState({ operacion: true, finanzas_group: true, comercial: false });
  const sidebarWidth = isDesktop ? (collapsed ? 84 : 286) : 0;

  useEffect(() => {
    document.documentElement.style.setProperty("--triton-shell-offset", `${sidebarWidth}px`);
    return () => document.documentElement.style.removeProperty("--triton-shell-offset");
  }, [sidebarWidth]);

  const styleTag = useMemo(() => `
    .triton-desktop-sidebar, .triton-mobile-est-menu, button[aria-label='Abrir menú']:not(.triton-shell-menu-button) { display: none !important; }
    @media (min-width: ${desktopBreakpoint}px) { #root > div:first-child { padding-left: calc(var(--triton-shell-offset, 84px) + 24px) !important; transition: padding-left 220ms ease; } }
    @media (max-width: ${desktopBreakpoint - 1}px) { .triton-shell-sidebar { display: none !important; } .triton-shell-menu-button { display: inline-flex !important; } }
    @media (min-width: ${desktopBreakpoint}px) { .triton-shell-menu-button { display: none !important; } }
  `, []);

  function goTo(moduleId, isOs) {
    setActiveModule(moduleId); setMobileOpen(false); closeAllModuleScreens();
    if (moduleId === "calidad") return;
    window.setTimeout(() => {
      if (isOs) { window.dispatchEvent(new CustomEvent("triton-open-os-module", { detail: { module: moduleId } })); return; }
      if (moduleId === "estimaciones") { window.dispatchEvent(new Event("triton-open-estimaciones")); return; }
      if (moduleId === "obras") { window.dispatchEvent(new Event("triton-open-obras-config")); return; }
      openFeedbackModule(moduleId);
    }, 80);
  }

  function handleGroup(group) {
    if (group.children?.length) {
      if (collapsed && isDesktop) { setCollapsed(false); setOpenGroups((v) => ({ ...v, [group.id]: true })); return; }
      setOpenGroups((v) => ({ ...v, [group.id]: !v[group.id] }));
      return;
    }
    goTo(group.module || group.id, group.os);
  }

  const navContent = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", gap: 10, marginBottom: 16 }}>
        {!collapsed ? <div style={{ display: "flex", alignItems: "center", gap: 10 }}><img src="/triton-logo.png" alt="Triton" style={{ width: 36, height: 36, objectFit: "contain", borderRadius: 10, background: "#111" }} /><div><div style={{ fontSize: 20, fontWeight: 950, color: "#1d1d1f", letterSpacing: -0.3 }}>TRITON OS</div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 2 }}>Operación integral</div></div></div> : <img src="/triton-logo.png" alt="Triton" style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 16, background: "#111", padding: 5 }} />}
        {isDesktop ? <button type="button" onClick={() => setCollapsed((value) => !value)} title={collapsed ? "Expandir menú" : "Minimizar menú"} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 999, width: 36, height: 36, background: "#fff", cursor: "pointer", fontWeight: 950 }}>{collapsed ? "›" : "‹"}</button> : null}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {groups.map((group) => {
          const active = isGroupActive(group, activeModule);
          const opened = !!openGroups[group.id] || active;
          return <div key={group.id}>
            <button type="button" onClick={() => handleGroup(group)} title={collapsed ? group.label : undefined} style={{ width: "100%", border: active ? "2px solid #007aff" : "1px solid rgba(60,60,67,0.12)", borderRadius: 18, padding: collapsed ? "12px 0" : 13, background: active ? "rgba(0,122,255,0.10)" : "rgba(255,255,255,0.86)", color: active ? "#005ecb" : "#1d1d1f", cursor: "pointer", display: "grid", gridTemplateColumns: collapsed ? "1fr" : "34px 1fr 18px", gap: 10, alignItems: "center", textAlign: "left" }}>
              <span style={{ width: 34, height: 34, borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", background: active ? "#007aff" : "#f2f2f7", color: active ? "#fff" : "#1d1d1f", fontWeight: 950, justifySelf: "center" }}>{group.icon}</span>
              {!collapsed ? <span><span style={{ display: "block", fontWeight: 950, fontSize: 14 }}>{group.label}</span><span style={{ display: "block", color: "#6e6e73", fontSize: 12, marginTop: 3 }}>{group.helper}</span></span> : null}
              {!collapsed && group.children?.length ? <span style={{ color: "#6e6e73", fontWeight: 950 }}>{opened ? "⌃" : "⌄"}</span> : null}
            </button>
            {!collapsed && group.children?.length && opened ? <div style={{ margin: "6px 0 2px 46px", display: "grid", gap: 5 }}>{group.children.map((child) => <button key={child.id} type="button" onClick={() => goTo(child.id, child.os)} style={{ textAlign: "left", border: activeModule === child.id ? "1px solid #007aff" : "1px solid rgba(60,60,67,0.10)", borderRadius: 14, padding: "9px 11px", background: activeModule === child.id ? "rgba(0,122,255,0.09)" : "rgba(255,255,255,0.62)", color: activeModule === child.id ? "#005ecb" : "#1d1d1f", cursor: "pointer", fontWeight: activeModule === child.id ? 950 : 750, fontSize: 13 }}>{child.label}</button>)}</div> : null}
          </div>;
        })}
      </div>
    </>
  );

  return <>
    <style>{styleTag}</style>
    <aside className="triton-shell-sidebar" style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: sidebarWidth, zIndex: 2147483646, padding: collapsed ? "18px 10px" : "22px 14px", background: "rgba(255,255,255,0.94)", borderRight: "1px solid rgba(60,60,67,0.12)", boxShadow: "18px 0 50px rgba(0,0,0,0.08)", WebkitBackdropFilter: "blur(22px) saturate(180%)", backdropFilter: "blur(22px) saturate(180%)", transition: "width 220ms ease, padding 220ms ease", overflow: "auto" }}>{navContent}</aside>
    <button className="triton-shell-menu-button" type="button" onClick={() => setMobileOpen(true)} aria-label="Abrir navegación" style={{ display: "none", position: "fixed", left: 16, top: "calc(16px + env(safe-area-inset-top, 0px))", zIndex: 2147483646, width: 48, height: 48, border: "1px solid rgba(60,60,67,0.14)", borderRadius: 16, background: "rgba(255,255,255,0.94)", boxShadow: "0 10px 28px rgba(0,0,0,0.12)", fontSize: 22, fontWeight: 950, alignItems: "center", justifyContent: "center" }}>☰</button>
    {mobileOpen ? <div onClick={() => setMobileOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(29,29,31,0.32)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)" }}><div onClick={(event) => event.stopPropagation()} style={{ width: "min(88vw, 340px)", height: "100%", background: "rgba(255,255,255,0.98)", borderRight: "1px solid rgba(60,60,67,0.12)", boxShadow: "20px 0 60px rgba(0,0,0,0.18)", padding: "calc(18px + env(safe-area-inset-top, 0px)) 14px 18px", overflow: "auto" }}>{navContent}</div></div> : null}
  </>;
}
