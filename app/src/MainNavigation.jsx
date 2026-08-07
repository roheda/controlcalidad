import React, { useEffect, useMemo, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBzk_jZfpv4j7PxroeTISwx11LffEB3TWQ",
  authDomain: "control-de-calidad-triton.firebaseapp.com",
  projectId: "control-de-calidad-triton",
  storageBucket: "control-de-calidad-triton.firebasestorage.app",
  messagingSenderId: "41329486719",
  appId: "1:41329486719:web:1bf7ff827d3b60227f084a",
};
const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const firebaseAuth = getAuth(firebaseApp);

const desktopBreakpoint = 901;

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
    { id: "operacion_os", label: "Resumen operación", helper: "Vista conectada de obra, calidad y finanzas", os: true },
    { id: "calidad", label: "Checklist / Calidad", helper: "Liberaciones, evidencias y bitácora", os: true },
    { id: "obras", label: "Configurar obra", helper: "Alta, edición, unidades y alcance", os: true },
    { id: "estimaciones", label: "Estimaciones", helper: "Catálogo, avance, checklist y pagos", os: true },
    { id: "equipo_obra", label: "Equipo construcción", helper: "Altas/bajas por obra", os: true },
    { id: "consulta_tecnica", label: "Consulta técnica", helper: "Dudas, criterios y soporte", os: true },
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
    { id: "arr_inmuebles", label: "Inmuebles", helper: "Predios, ubicación, m² y cédulas" },
    { id: "arr_contratos", label: "Contratos", helper: "Vigencia, incremento anual y cédulas" },
    { id: "cobranza", label: "Cobranza", helper: "Rentas mensuales" },
    { id: "arr_conciliacion", label: "Conciliación bancaria", helper: "Pagos de renta" },
    { id: "arr_facturacion", label: "Facturación", helper: "Facturas automáticas" },
    { id: "arr_predial", label: "Pago de predial", helper: "Vencimientos y comprobantes" },
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
  const [authUser, setAuthUser] = useState(undefined);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeModule, setActiveModule] = useState("reportes_os");
  const [hovered, setHovered] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [mobileGroups, setMobileGroups] = useState({ reportes: true, operacion: false, finanzas_group: false, tramites_group: false, arrendamientos: false, config: false });
  const sidebarWidth = isDesktop && authUser ? 86 : 0;
  const flyoutGroup = groups.find((g) => g.id === (pinned || hovered));
  const showFlyout = isDesktop && authUser && flyoutGroup?.children?.length;

  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, (user) => setAuthUser(user));
    return () => unsub();
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--triton-shell-offset", `${sidebarWidth}px`);
    return () => document.documentElement.style.removeProperty("--triton-shell-offset");
  }, [sidebarWidth]);

  useEffect(() => {
    if (!authUser) return;
    const timer = window.setTimeout(() => window.dispatchEvent(new CustomEvent("triton-open-os-module", { detail: { module: "reportes_os" } })), 250);
    return () => window.clearTimeout(timer);
  }, [authUser]);

  const styleTag = useMemo(() => `
    .triton-desktop-sidebar, .triton-mobile-est-menu, button[aria-label='Abrir menú']:not(.triton-shell-menu-button) { display: none !important; }
    @media (min-width: ${desktopBreakpoint}px) { #root > div:first-child { padding-left: calc(var(--triton-shell-offset, 84px) + 24px) !important; transition: padding-left 180ms ease; } }
    @media (max-width: ${desktopBreakpoint - 1}px) { .triton-shell-sidebar { display: none !important; } .triton-shell-menu-button { display: inline-flex !important; } }
    @media (min-width: ${desktopBreakpoint}px) { .triton-shell-menu-button { display: none !important; } }
  `, []);

  if (!authUser) return null;

  function goTo(moduleId, isOs = true) {
    setActiveModule(moduleId);
    setMobileOpen(false);
    setPinned(null);

    if (moduleId === "calidad") {
      closeAllModuleScreens();
      return;
    }

    if (isOs !== false) {
      window.dispatchEvent(new Event("triton-close-estimaciones"));
      window.dispatchEvent(new Event("triton-close-obras-config"));
      window.dispatchEvent(new Event("triton-close-feedback-module"));
      window.dispatchEvent(new CustomEvent("triton-open-os-module", { detail: { module: moduleId } }));
      return;
    }

    closeAllModuleScreens();
    window.setTimeout(() => {
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
      return (
        <div key={child.id} className={nested ? "my-0.5" : "my-1.5"}>
          <div className="px-3 pt-2.5 pb-1.5 text-xs font-black uppercase tracking-wide text-brand-gold-dark">
            {child.label}
          </div>
          <div className="grid gap-0.5 pl-2">{child.children.map((item) => renderChildButton(item, true))}</div>
        </div>
      );
    }
    const active = activeModule === child.id;
    return (
      <button
        key={child.id}
        type="button"
        onClick={() => goTo(child.id, child.os)}
        className={`grid grid-cols-[1fr_auto] items-center gap-2 rounded-2xl text-left transition-colors ${
          nested ? "px-3 py-2.5" : "px-3 py-2.5"
        } ${active ? "border border-brand-gold bg-brand-soft" : "border border-transparent hover:bg-black/5"}`}
      >
        <span>
          <span className={`block font-black ${nested ? "text-[13px]" : "text-sm"} ${active ? "text-brand-gold-dark" : "text-ink"}`}>
            {child.label}
          </span>
          <span className="mt-0.5 block text-xs text-ink-muted">{child.helper}</span>
        </span>
        <span className="font-black text-ink-muted/70">›</span>
      </button>
    );
  }

  const desktopNav = (
    <>
      <div className="mb-4 grid place-items-center">
        <img src="/triton-logo.png" alt="Triton" className="h-12 w-12 rounded-2xl bg-black object-contain p-[5px]" />
      </div>
      <div className="grid gap-2.5">
        {groups.map((group) => {
          const active = isGroupActive(group, activeModule);
          const open = (pinned || hovered) === group.id;
          return (
            <button
              key={group.id}
              type="button"
              onMouseEnter={() => setHovered(group.id)}
              onClick={() => handleGroup(group)}
              title={group.label}
              className={`grid h-14 w-14 place-items-center rounded-[20px] text-[19px] font-black transition-all ${
                active || open
                  ? "border-2 border-brand-gold bg-brand-soft text-brand-gold-dark shadow-[0_8px_20px_rgba(245,178,26,0.24)]"
                  : "border border-line bg-white/90 text-ink shadow-soft"
              }`}
            >
              {group.icon}
            </button>
          );
        })}
      </div>
    </>
  );

  const mobileNav = (
    <>
      <div className="mb-[18px] flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <img src="/triton-logo.png" alt="Triton" className="h-[38px] w-[38px] rounded-xl bg-black object-contain" />
          <div>
            <div className="text-xl font-black text-ink">TRITON OS</div>
            <div className="text-xs text-ink-muted">Operación integral</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="h-9 w-9 rounded-full border border-line bg-white font-black text-ink"
        >
          ×
        </button>
      </div>
      <div className="grid gap-2">
        {groups.map((group) => {
          const active = isGroupActive(group, activeModule);
          const opened = !!mobileGroups[group.id] || active;
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => (group.children?.length ? setMobileGroups((v) => ({ ...v, [group.id]: !v[group.id] })) : goTo(group.module || group.id, group.os))}
                className={`grid w-full grid-cols-[34px_1fr_18px] items-center gap-2.5 rounded-2xl p-3.5 text-left transition-colors ${
                  active ? "border-2 border-brand-gold bg-brand-soft" : "border border-line bg-white/85"
                }`}
              >
                <span
                  className={`grid h-[34px] w-[34px] place-items-center rounded-xl font-black ${
                    active ? "bg-brand-gold text-white" : "bg-black/5 text-ink"
                  }`}
                >
                  {group.icon}
                </span>
                <span>
                  <span className={`block text-sm font-black ${active ? "text-brand-gold-dark" : "text-ink"}`}>{group.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{group.helper}</span>
                </span>
                {group.children?.length ? <span className="font-black text-ink-muted">{opened ? "⌃" : "⌄"}</span> : null}
              </button>
              {group.children?.length && opened ? (
                <div className="mb-0.5 ml-11 mt-1.5 grid gap-1.5">
                  {flattenChildren(group.children).filter((child) => !child.children).map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => goTo(child.id, child.os)}
                      className={`rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors ${
                        activeModule === child.id
                          ? "border border-brand-gold bg-brand-soft font-black text-brand-gold-dark"
                          : "border border-line bg-white/60 font-bold text-ink"
                      }`}
                    >
                      {child.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <>
      <style>{styleTag}</style>
      <aside
        className="triton-shell-sidebar fixed bottom-0 left-0 top-0 overflow-visible bg-white/95 px-3.5 py-[18px] shadow-elevated backdrop-blur-2xl"
        style={{ width: sidebarWidth, zIndex: 2147483646, borderRight: "1px solid rgba(60,60,67,0.12)" }}
        onMouseLeave={() => { if (!pinned) setHovered(null); }}
      >
        {desktopNav}
      </aside>
      {showFlyout ? (
        <div
          onMouseEnter={() => setHovered(flyoutGroup.id)}
          onMouseLeave={() => { if (!pinned) setHovered(null); }}
          className="fixed max-h-[calc(100vh-40px)] w-[360px] max-w-[calc(100vw-120px)] overflow-auto rounded-[24px] border border-line bg-white/98 p-3 shadow-elevated backdrop-blur-xl"
          style={{ left: sidebarWidth + 12, top: Math.max(20, 70 + groups.findIndex((g) => g.id === flyoutGroup.id) * 66), zIndex: 2147483647 }}
        >
          <div className="mb-2 border-b border-line px-2.5 pb-3 pt-2">
            <div className="text-base font-black text-ink">{flyoutGroup.label}</div>
            <div className="mt-0.5 text-xs text-ink-muted">{flyoutGroup.helper}</div>
          </div>
          <div className="grid gap-1">{flyoutGroup.children.map((child) => renderChildButton(child))}</div>
        </div>
      ) : null}
      <button
        className="triton-shell-menu-button fixed hidden h-12 w-12 items-center justify-center rounded-2xl border border-line bg-white/95 text-2xl font-black shadow-soft"
        style={{ left: 16, top: "calc(16px + env(safe-area-inset-top, 0px))", zIndex: 2147483646 }}
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Abrir navegación"
      >
        ☰
      </button>
      {mobileOpen ? (
        <div
          className="fixed inset-0 bg-black/35 backdrop-blur-md"
          style={{ zIndex: 2147483647 }}
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="h-full w-[min(88vw,380px)] overflow-auto bg-white/98 p-4 shadow-elevated"
            style={{ borderRight: "1px solid rgba(60,60,67,0.12)" }}
            onClick={(event) => event.stopPropagation()}
          >
            {mobileNav}
          </div>
        </div>
      ) : null}
    </>
  );
}
