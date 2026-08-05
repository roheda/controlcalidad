import React, { useEffect, useMemo, useState } from "react";

const desktopBreakpoint = 901;
const brand = { gold: "#F5B21A", goldDark: "#8A6400", text: "#242322", muted: "#6B6862", border: "rgba(88,84,76,0.16)", soft: "rgba(245,178,26,0.14)" };

const groups = [
  { id: "dashboard", label: "Dashboard", helper: "Vista directiva", icon: "▦", module: "dashboard", os: true },
  { id: "operacion", label: "Operación", helper: "Obra, calidad y trámites", icon: "✓", children: [
    { id: "calidad", label: "Checklist / Calidad", helper: "Liberaciones, evidencias y bitácora" },
    { id: "obras", label: "Configurar obra", helper: "Unidades, elementos y checklist" },
    { id: "estimaciones", label: "Estimaciones", helper: "Avances y aprobaciones" },
    { id: "equipo_obra", label: "Equipo construcción", helper: "Altas/bajas por obra", os: true },
    { id: "tramites", label: "Trámites", helper: "Permisos y dependencias", os: true },
    { id: "consulta_tecnica", label: "Consulta técnica", helper: "Dudas y soporte" },
  ]},
  { id: "finanzas_group", label: "Finanzas", helper: "ERP financiero", icon: "$", children: [
    { id: "finanzas", label: "Resumen", helper: "Presupuesto, comprometido y pagado", os: true },
    { id: "proveedores", label: "Proveedores", helper: "Alta, fiscales, bancos y anexos", os: true },
    { id: "presupuestos", label: "Presupuestos", helper: "Partidas por proyecto", os: true },
    { id: "contratos_financieros", label: "Contratos", helper: "Montos autorizados, anticipos y saldos", os: true },
    { id: "pagos_recurrentes", label: "Pagos recurrentes", helper: "Rentas, servicios y honorarios", os: true },
    { id: "cxp", label: "Solicitudes de pago", helper: "Solicitud con anexos y presupuesto", os: true },
    { id: "autorizaciones", label: "Autorizaciones", helper: "Revisión final de dirección", os: true },
    { id: "pagos_programados", label: "Pagos programados", helper: "Tesorería y calendario", os: true },
    { id: "pagos_realizados", label: "Pagos realizados", helper: "Comprobantes y referencias", os: true },
    { id: "conciliacion", label: "Conciliación bancaria", helper: "Cruce contra banco", os: true },
    { id: "caja_chica", label: "Caja chica", helper: "Fondos y liquidaciones", os: true },
  ]},
  { id: "comercial", label: "Comercial / Cobranza", helper: "Rentas y contratos", icon: "↙", children: [
    { id: "cobranza", label: "Rentas / contratos", helper: "Locales, terrenos, casas y depas", os: true },
  ]},
  { id: "reportes", label: "Reportes", helper: "Dirección", icon: "▤", module: "reportes_os", os: true },
  { id: "config", label: "Configuración", helper: "Sistema", icon: "⚙", children: [
    { id: "usuarios_os", label: "Usuarios", helper: "Permisos por módulo y acción", os: true },
    { id: "config_os", label: "Catálogos y reglas", helper: "Categorías, partidas y parámetros", os: true },
    { id: "proyectos", label: "Proyectos", helper: "Alta y edición de proyectos", os: true },
  ]},
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeModule, setActiveModule] = useState("calidad");
  const [hovered, setHovered] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [mobileGroups, setMobileGroups] = useState({ operacion: true, finanzas_group: false, comercial: false, config: false });
  const sidebarWidth = isDesktop ? 86 : 0;
  const flyoutGroup = groups.find((g) => g.id === (pinned || hovered));
  const showFlyout = isDesktop && flyoutGroup?.children?.length;

  useEffect(() => {
    document.documentElement.style.setProperty("--triton-shell-offset", `${sidebarWidth}px`);
    return () => document.documentElement.style.removeProperty("--triton-shell-offset");
  }, [sidebarWidth]);

  const styleTag = useMemo(() => `
    .triton-desktop-sidebar, .triton-mobile-est-menu, button[aria-label='Abrir menú']:not(.triton-shell-menu-button) { display: none !important; }
    @media (min-width: ${desktopBreakpoint}px) { #root > div:first-child { padding-left: calc(var(--triton-shell-offset, 84px) + 24px) !important; transition: padding-left 180ms ease; } }
    @media (max-width: ${desktopBreakpoint - 1}px) { .triton-shell-sidebar { display: none !important; } .triton-shell-menu-button { display: inline-flex !important; } }
    @media (min-width: ${desktopBreakpoint}px) { .triton-shell-menu-button { display: none !important; } }
  `, []);

  function goTo(moduleId, isOs) {
    setActiveModule(moduleId); setMobileOpen(false); setPinned(null); closeAllModuleScreens();
    if (moduleId === "calidad") return;
    window.setTimeout(() => {
      if (isOs) { window.dispatchEvent(new CustomEvent("triton-open-os-module", { detail: { module: moduleId } })); return; }
      if (moduleId === "estimaciones") { window.dispatchEvent(new Event("triton-open-estimaciones")); return; }
      if (moduleId === "obras") { window.dispatchEvent(new Event("triton-open-obras-config")); return; }
      openFeedbackModule(moduleId);
    }, 80);
  }

  function handleGroup(group) {
    if (group.children?.length) { setPinned(pinned === group.id ? null : group.id); setHovered(group.id); return; }
    goTo(group.module || group.id, group.os);
  }

  const desktopNav = (
    <>
      <div style={{ display: "grid", placeItems: "center", marginBottom: 16 }}>
        <img src="/triton-logo.png" alt="Triton" style={{ width: 48, height: 48, objectFit: "contain", borderRadius: 16, background: "#111", padding: 5 }} />
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {groups.map((group) => {
          const active = isGroupActive(group, activeModule);
          const open = (pinned || hovered) === group.id;
          return <button key={group.id} type="button" onMouseEnter={() => setHovered(group.id)} onClick={() => handleGroup(group)} title={group.label} style={{ width: 56, height: 56, border: active || open ? `2px solid ${brand.gold}` : `1px solid ${brand.border}`, borderRadius: 20, background: active || open ? brand.soft : "rgba(255,255,255,0.92)", color: active || open ? brand.goldDark : brand.text, cursor: "pointer", boxShadow: active ? "0 8px 20px rgba(245,178,26,0.24)" : "0 8px 18px rgba(0,0,0,0.06)", display: "grid", placeItems: "center", fontWeight: 950, fontSize: 19 }}>{group.icon}</button>;
        })}
      </div>
    </>
  );

  const mobileNav = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><img src="/triton-logo.png" alt="Triton" style={{ width: 38, height: 38, objectFit: "contain", borderRadius: 12, background: "#111" }} /><div><div style={{ fontSize: 20, fontWeight: 950 }}>TRITON OS</div><div style={{ color: "#6B6862", fontSize: 12 }}>Operación integral</div></div></div>
        <button type="button" onClick={() => setMobileOpen(false)} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 999, width: 36, height: 36, background: "#fff", fontWeight: 950 }}>×</button>
      </div>
      <div style={{ display: "grid", gap: 9 }}>
        {groups.map((group) => {
          const active = isGroupActive(group, activeModule);
          const opened = !!mobileGroups[group.id] || active;
          return <div key={group.id}>
            <button type="button" onClick={() => group.children?.length ? setMobileGroups((v) => ({ ...v, [group.id]: !v[group.id] })) : goTo(group.module || group.id, group.os)} style={{ width: "100%", border: active ? `2px solid ${brand.gold}` : "1px solid rgba(60,60,67,0.12)", borderRadius: 18, padding: 13, background: active ? brand.soft : "rgba(255,255,255,0.86)", color: active ? brand.goldDark : brand.text, cursor: "pointer", display: "grid", gridTemplateColumns: "34px 1fr 18px", gap: 10, alignItems: "center", textAlign: "left" }}>
              <span style={{ width: 34, height: 34, borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", background: active ? "#F5B21A" : "#f2f2f7", color: active ? "#fff" : brand.text, fontWeight: 950 }}>{group.icon}</span>
              <span><span style={{ display: "block", fontWeight: 950, fontSize: 14 }}>{group.label}</span><span style={{ display: "block", color: "#6B6862", fontSize: 12, marginTop: 3 }}>{group.helper}</span></span>
              {group.children?.length ? <span style={{ color: "#6B6862", fontWeight: 950 }}>{opened ? "⌃" : "⌄"}</span> : null}
            </button>
            {group.children?.length && opened ? <div style={{ margin: "6px 0 2px 46px", display: "grid", gap: 5 }}>{group.children.map((child) => <button key={child.id} type="button" onClick={() => goTo(child.id, child.os)} style={{ textAlign: "left", border: activeModule === child.id ? "1px solid #F5B21A" : "1px solid rgba(60,60,67,0.10)", borderRadius: 14, padding: "9px 11px", background: activeModule === child.id ? "rgba(245,178,26,0.12)" : "rgba(255,255,255,0.62)", color: activeModule === child.id ? brand.goldDark : brand.text, cursor: "pointer", fontWeight: activeModule === child.id ? 950 : 750, fontSize: 13 }}>{child.label}</button>)}</div> : null}
          </div>;
        })}
      </div>
    </>
  );

  return <>
    <style>{styleTag}</style>
    <aside className="triton-shell-sidebar" onMouseLeave={() => { if (!pinned) setHovered(null); }} style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: sidebarWidth, zIndex: 2147483646, padding: "18px 14px", background: "rgba(255,255,255,0.94)", borderRight: "1px solid rgba(60,60,67,0.12)", boxShadow: "18px 0 50px rgba(0,0,0,0.08)", WebkitBackdropFilter: "blur(22px) saturate(180%)", backdropFilter: "blur(22px) saturate(180%)", overflow: "visible" }}>{desktopNav}</aside>
    {showFlyout ? <div onMouseEnter={() => setHovered(flyoutGroup.id)} onMouseLeave={() => { if (!pinned) setHovered(null); }} style={{ position: "fixed", left: sidebarWidth + 12, top: 70 + groups.findIndex((g) => g.id === flyoutGroup.id) * 66, zIndex: 2147483647, width: 330, maxWidth: "calc(100vw - 120px)", background: "rgba(255,255,255,0.98)", border: "1px solid rgba(60,60,67,0.16)", borderRadius: 24, boxShadow: "0 22px 70px rgba(0,0,0,0.18)", padding: 12, WebkitBackdropFilter: "blur(18px) saturate(180%)", backdropFilter: "blur(18px) saturate(180%)" }}>
      <div style={{ padding: "8px 10px 12px", borderBottom: "1px solid rgba(60,60,67,0.10)", marginBottom: 8 }}><div style={{ fontWeight: 950, fontSize: 16 }}>{flyoutGroup.label}</div><div style={{ color: "#6B6862", fontSize: 12, marginTop: 3 }}>{flyoutGroup.helper}</div></div>
      <div style={{ display: "grid", gap: 4 }}>{flyoutGroup.children.map((child) => <button key={child.id} type="button" onClick={() => goTo(child.id, child.os)} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, textAlign: "left", border: activeModule === child.id ? "1px solid #F5B21A" : "1px solid transparent", borderRadius: 16, padding: "11px 12px", background: activeModule === child.id ? "rgba(245,178,26,0.12)" : "transparent", cursor: "pointer", alignItems: "center" }}><span><span style={{ display: "block", fontWeight: 950, color: activeModule === child.id ? brand.goldDark : brand.text, fontSize: 14 }}>{child.label}</span><span style={{ display: "block", color: "#6B6862", fontSize: 12, marginTop: 2 }}>{child.helper}</span></span><span style={{ color: "#8e8e93", fontWeight: 950 }}>›</span></button>)}</div>
    </div> : null}
    <button className="triton-shell-menu-button" type="button" onClick={() => setMobileOpen(true)} aria-label="Abrir navegación" style={{ display: "none", position: "fixed", left: 16, top: "calc(16px + env(safe-area-inset-top, 0px))", zIndex: 2147483646, width: 48, height: 48, border: `1px solid ${brand.border}`, borderRadius: 16, background: "rgba(255,255,255,0.94)", boxShadow: "0 10px 28px rgba(0,0,0,0.12)", fontSize: 22, fontWeight: 950, alignItems: "center", justifyContent: "center" }}>☰</button>
    {mobileOpen ? <div onClick={() => setMobileOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(29,29,31,0.32)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)" }}><div onClick={(event) => event.stopPropagation()} style={{ width: "min(88vw, 380px)", height: "100%", background: "rgba(255,255,255,0.98)", borderRight: "1px solid rgba(60,60,67,0.12)", boxShadow: "20px 0 60px rgba(0,0,0,0.18)", padding: 16, overflow: "auto" }}>{mobileNav}</div></div> : null}
  </>;
}
