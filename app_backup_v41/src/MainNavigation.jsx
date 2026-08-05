import React, { useEffect, useMemo, useState } from "react";

const desktopBreakpoint = 901;
const brand = { gold: "#F5B21A", goldDark: "#8A6400", text: "#242322", muted: "#6B6862", border: "rgba(88,84,76,0.16)", soft: "rgba(245,178,26,0.14)" };

const groups = [
  { id: "reportes", label: "Reportes", helper: "Obra, finanzas, ingresos, egresos e IA", icon: "▤", children: [
    { id: "reportes_os", label: "Resumen ejecutivo", helper: "Indicadores generales" },
    { id: "reporte_obra", label: "Reportes de obra", helper: "Calidad, estimaciones y pendientes" },
    { id: "reporte_finanzas", label: "Reportes financieros", helper: "Estado de resultados y presupuesto" },
    { id: "reporte_egresos", label: "Egresos", helper: "Pagos, proveedores y caja chica" },
    { id: "reporte_ingresos", label: "Ingresos", helper: "Ventas, clientes y cobranza" },
    { id: "reporte_ia", label: "IA / análisis cruzado", helper: "Finanzas vs obra y recomendaciones" },
  ]},
  { id: "operacion", label: "Operación", helper: "Obra, calidad y estimaciones", icon: "✓", children: [
    { id: "calidad", label: "Checklist / Calidad", helper: "Liberaciones, evidencias y bitácora" },
    { id: "obras", label: "Configurar obra", helper: "Unidades, elementos y checklist" },
    { id: "estimaciones", label: "Estimaciones", helper: "Avances y aprobaciones" },
    { id: "equipo_obra", label: "Equipo construcción", helper: "Altas/bajas por obra", os: true },
    { id: "consulta_tecnica", label: "Consulta técnica", helper: "Dudas y soporte" },
  ]},
  { id: "finanzas_group", label: "Finanzas", helper: "ERP financiero", icon: "$", children: [
    { id: "finanzas", label: "Resumen", helper: "Presupuesto, comprometido, pagado" },
    { id: "proveedores", label: "Proveedores", helper: "Alta, fiscales, bancos y anexos" },
    { id: "presupuestos", label: "Presupuestos", helper: "Partidas por proyecto" },
    { id: "contratos_financieros", label: "Contratos", helper: "Montos, anticipos, saldos" },
    { id: "pagos_group", label: "Pagos", helper: "CXP, autorización y tesorería", children: [
      { id: "pagos_recurrentes", label: "Pagos recurrentes", helper: "Servicios y honorarios" },
      { id: "cxp", label: "Solicitudes de pago", helper: "Solicitud con anexos" },
      { id: "autorizaciones", label: "Autorizaciones", helper: "Revisión final" },
      { id: "pagos_programados", label: "Pagos programados", helper: "Tesorería y lotes" },
      { id: "pagos_realizados", label: "Pagos realizados", helper: "Comprobantes" },
      { id: "caja_chica", label: "Caja chica", helper: "Reposiciones y liquidación" },
    ]},
    { id: "conciliacion", label: "Conciliación bancaria", helper: "Cruce contra banco" },
    { id: "ingresos", label: "Ingresos", helper: "Ventas, unidades y contratos" },
    { id: "clientes", label: "Clientes", helper: "Compradores y pagadores" },
  ]},
  { id: "tramites_group", label: "Trámites", helper: "Permisos y expediente por proyecto", icon: "◷", children: [
    { id: "tramites", label: "Seguimiento", helper: "Lista, estatus y responsables" },
    { id: "tramites_timeline", label: "Línea del tiempo", helper: "Avance por proyecto y etapa" },
    { id: "tramites_expediente", label: "Expediente documental", helper: "Archivos y exportación PDF" },
  ]},
  { id: "arrendamientos", label: "Arrendamientos", helper: "Rentas y contratos", icon: "↙", children: [
    { id: "arr_contratos", label: "Contratos", helper: "Vigencia, INPC y cédulas" },
    { id: "cobranza", label: "Cobranza", helper: "Rentas mensuales" },
    { id: "arr_conciliacion", label: "Conciliación bancaria", helper: "Pagos de renta" },
    { id: "arr_facturacion", label: "Facturación", helper: "Facturas automáticas" },
    { id: "arr_reportes", label: "Reportes", helper: "Cartera y ocupación" },
  ]},
  { id: "config", label: "Configuración", helper: "Sistema", icon: "⚙", children: [
    { id: "usuarios_os", label: "Usuarios", helper: "Permisos por módulo y acción" },
    { id: "config_os", label: "Catálogos y reglas", helper: "Categorías, partidas, bancos" },
    { id: "proyectos", label: "Proyectos", helper: "Alta y edición" },
  ]},
];

function flattenChildren(children = []) {
  return children.flatMap((child) => child.children?.length ? [child, ...child.children] : [child]);
}
function isGroupActive(group, activeModule) {
  const target = group.module || group.id;
  return target === activeModule || flattenChildren(group.children).some((child) => child.id === activeModule);
}
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
  const labels = { consulta_tecnica: "Consulta técnica" };
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
export default function MainNavigation() {
  const isDesktop = useIsDesktop();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeModule, setActiveModule] = useState("reportes_os");
  const [hovered, setHovered] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [mobileGroups, setMobileGroups] = useState({ reportes: true, operacion: false, finanzas_group: false, tramites_group: false, arrendamientos: false, config: false });
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

  function goTo(moduleId, isOs = true) {
    setActiveModule(moduleId); setMobileOpen(false); setPinned(null); closeAllModuleScreens();
    if (moduleId === "calidad") return;
    window.setTimeout(() => {
      if (isOs !== false) { window.dispatchEvent(new CustomEvent("triton-open-os-module", { detail: { module: moduleId } })); return; }
      if (moduleId === "estimaciones") { window.dispatchEvent(new Event("triton-open-estimaciones")); return; }
      if (moduleId === "obras") { window.dispatchEvent(new Event("triton-open-obras-config")); return; }
      openFeedbackModule(moduleId);
    }, 80);
  }
  function handleGroup(group) {
    if (group.children?.length) { setPinned(pinned === group.id ? null : group.id); setHovered(group.id); return; }
    goTo(group.module || group.id, group.os);
  }
  function renderChildButton(child, nested = false) {
    if (child.children?.length) {
      return <div key={child.id} style={{ margin: nested ? "2px 0" : "6px 0" }}>
        <div style={{ padding: "9px 12px 5px", color: brand.goldDark, fontWeight: 950, fontSize: 12, textTransform: "uppercase", letterSpacing: .6 }}>{child.label}</div>
        <div style={{ display: "grid", gap: 3, paddingLeft: 8 }}>{child.children.map((item) => renderChildButton(item, true))}</div>
      </div>;
    }
    const active = activeModule === child.id;
    return <button key={child.id} type="button" onClick={() => goTo(child.id, child.os)} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, textAlign: "left", border: active ? `1px solid ${brand.gold}` : "1px solid transparent", borderRadius: 16, padding: nested ? "9px 12px" : "11px 12px", background: active ? brand.soft : "transparent", cursor: "pointer", alignItems: "center" }}><span><span style={{ display: "block", fontWeight: 950, color: active ? brand.goldDark : brand.text, fontSize: nested ? 13 : 14 }}>{child.label}</span><span style={{ display: "block", color: brand.muted, fontSize: 12, marginTop: 2 }}>{child.helper}</span></span><span style={{ color: "#8e8e93", fontWeight: 950 }}>›</span></button>;
  }

  const desktopNav = <>
    <div style={{ display: "grid", placeItems: "center", marginBottom: 16 }}><img src="/triton-logo.png" alt="Triton" style={{ width: 48, height: 48, objectFit: "contain", borderRadius: 16, background: "#111", padding: 5 }} /></div>
    <div style={{ display: "grid", gap: 10 }}>{groups.map((group) => {
      const active = isGroupActive(group, activeModule); const open = (pinned || hovered) === group.id;
      return <button key={group.id} type="button" onMouseEnter={() => setHovered(group.id)} onClick={() => handleGroup(group)} title={group.label} style={{ width: 56, height: 56, border: active || open ? `2px solid ${brand.gold}` : `1px solid ${brand.border}`, borderRadius: 20, background: active || open ? brand.soft : "rgba(255,255,255,0.92)", color: active || open ? brand.goldDark : brand.text, cursor: "pointer", boxShadow: active ? "0 8px 20px rgba(245,178,26,0.24)" : "0 8px 18px rgba(0,0,0,0.06)", display: "grid", placeItems: "center", fontWeight: 950, fontSize: 19 }}>{group.icon}</button>;
    })}</div>
  </>;

  const mobileNav = <>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 18 }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><img src="/triton-logo.png" alt="Triton" style={{ width: 38, height: 38, objectFit: "contain", borderRadius: 12, background: "#111" }} /><div><div style={{ fontSize: 20, fontWeight: 950 }}>TRITON OS</div><div style={{ color: brand.muted, fontSize: 12 }}>Operación integral</div></div></div><button type="button" onClick={() => setMobileOpen(false)} style={{ border: `1px solid ${brand.border}`, borderRadius: 999, width: 36, height: 36, background: "#fff", fontWeight: 950 }}>×</button></div>
    <div style={{ display: "grid", gap: 9 }}>{groups.map((group) => {
      const active = isGroupActive(group, activeModule); const opened = !!mobileGroups[group.id] || active;
      return <div key={group.id}><button type="button" onClick={() => group.children?.length ? setMobileGroups((v) => ({ ...v, [group.id]: !v[group.id] })) : goTo(group.module || group.id, group.os)} style={{ width: "100%", border: active ? `2px solid ${brand.gold}` : `1px solid ${brand.border}`, borderRadius: 18, padding: 13, background: active ? brand.soft : "rgba(255,255,255,0.86)", color: active ? brand.goldDark : brand.text, cursor: "pointer", display: "grid", gridTemplateColumns: "34px 1fr 18px", gap: 10, alignItems: "center", textAlign: "left" }}><span style={{ width: 34, height: 34, borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", background: active ? brand.gold : "#f2f2f7", color: active ? "#fff" : brand.text, fontWeight: 950 }}>{group.icon}</span><span><span style={{ display: "block", fontWeight: 950, fontSize: 14 }}>{group.label}</span><span style={{ display: "block", color: brand.muted, fontSize: 12, marginTop: 3 }}>{group.helper}</span></span>{group.children?.length ? <span style={{ color: brand.muted, fontWeight: 950 }}>{opened ? "⌃" : "⌄"}</span> : null}</button>
        {group.children?.length && opened ? <div style={{ margin: "6px 0 2px 46px", display: "grid", gap: 5 }}>{flattenChildren(group.children).filter((child) => !child.children).map((child) => <button key={child.id} type="button" onClick={() => goTo(child.id, child.os)} style={{ textAlign: "left", border: activeModule === child.id ? `1px solid ${brand.gold}` : `1px solid ${brand.border}`, borderRadius: 14, padding: "9px 11px", background: activeModule === child.id ? brand.soft : "rgba(255,255,255,0.62)", color: activeModule === child.id ? brand.goldDark : brand.text, cursor: "pointer", fontWeight: activeModule === child.id ? 950 : 750, fontSize: 13 }}>{child.label}</button>)}</div> : null}</div>;
    })}</div>
  </>;

  return <>
    <style>{styleTag}</style>
    <aside className="triton-shell-sidebar" onMouseLeave={() => { if (!pinned) setHovered(null); }} style={{ position: "fixed", left: 0, top: 0, bottom: 0, width: sidebarWidth, zIndex: 2147483646, padding: "18px 14px", background: "rgba(255,255,255,0.94)", borderRight: "1px solid rgba(60,60,67,0.12)", boxShadow: "18px 0 50px rgba(0,0,0,0.08)", WebkitBackdropFilter: "blur(22px) saturate(180%)", backdropFilter: "blur(22px) saturate(180%)", overflow: "visible" }}>{desktopNav}</aside>
    {showFlyout ? <div onMouseEnter={() => setHovered(flyoutGroup.id)} onMouseLeave={() => { if (!pinned) setHovered(null); }} style={{ position: "fixed", left: sidebarWidth + 12, top: Math.max(20, 70 + groups.findIndex((g) => g.id === flyoutGroup.id) * 66), zIndex: 2147483647, width: 360, maxWidth: "calc(100vw - 120px)", maxHeight: "calc(100vh - 40px)", overflow: "auto", background: "rgba(255,255,255,0.98)", border: "1px solid rgba(60,60,67,0.16)", borderRadius: 24, boxShadow: "0 22px 70px rgba(0,0,0,0.18)", padding: 12, WebkitBackdropFilter: "blur(18px) saturate(180%)", backdropFilter: "blur(18px) saturate(180%)" }}><div style={{ padding: "8px 10px 12px", borderBottom: "1px solid rgba(60,60,67,0.10)", marginBottom: 8 }}><div style={{ fontWeight: 950, fontSize: 16 }}>{flyoutGroup.label}</div><div style={{ color: brand.muted, fontSize: 12, marginTop: 3 }}>{flyoutGroup.helper}</div></div><div style={{ display: "grid", gap: 4 }}>{flyoutGroup.children.map((child) => renderChildButton(child))}</div></div> : null}
    <button className="triton-shell-menu-button" type="button" onClick={() => setMobileOpen(true)} aria-label="Abrir navegación" style={{ display: "none", position: "fixed", left: 16, top: "calc(16px + env(safe-area-inset-top, 0px))", zIndex: 2147483646, width: 48, height: 48, border: `1px solid ${brand.border}`, borderRadius: 16, background: "rgba(255,255,255,0.94)", boxShadow: "0 10px 28px rgba(0,0,0,0.12)", fontSize: 22, fontWeight: 950, alignItems: "center", justifyContent: "center" }}>☰</button>
    {mobileOpen ? <div onClick={() => setMobileOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(29,29,31,0.32)", WebkitBackdropFilter: "blur(10px)", backdropFilter: "blur(10px)" }}><div onClick={(event) => event.stopPropagation()} style={{ width: "min(88vw, 380px)", height: "100%", background: "rgba(255,255,255,0.98)", borderRight: "1px solid rgba(60,60,67,0.12)", boxShadow: "20px 0 60px rgba(0,0,0,0.18)", padding: 16, overflow: "auto" }}>{mobileNav}</div></div> : null}
  </>;
}
