import React, { useEffect, useMemo, useState } from "react";

const money = (value) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value || 0));
const numberFmt = (value) => new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(Number(value || 0));
const todayIso = () => new Date().toISOString().slice(0, 10);
const uid = (prefix = "id") => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const c = {
  text: "#1d1d1f",
  muted: "#6e6e73",
  border: "rgba(60,60,67,0.14)",
  soft: "#f5f5f7",
  card: "rgba(255,255,255,0.94)",
  primary: "#007aff",
  primarySoft: "rgba(0,122,255,0.10)",
  green: "#34c759",
  greenSoft: "rgba(52,199,89,0.13)",
  orange: "#ff9500",
  orangeSoft: "rgba(255,149,0,0.14)",
  red: "#ff3b30",
  redSoft: "rgba(255,59,48,0.12)",
  purple: "#5856d6",
  purpleSoft: "rgba(88,86,214,0.12)",
  shadow: "0 18px 55px rgba(0,0,0,0.10)",
};

const initialData = {
  projects: [
    { id: "arenna", name: "Arenna", type: "Desarrollo habitacional", status: "Activo", budget: 94806101, incomeTarget: 112517760, owner: "TRITON" },
    { id: "plaza-vias", name: "Plaza Las Vías", type: "Plaza comercial", status: "Operando", budget: 0, incomeTarget: 0, owner: "TRITON" },
    { id: "residente", name: "Residente", type: "Departamentos", status: "Planeación", budget: 120000000, incomeTarget: 0, owner: "TRITON" },
  ],
  categories: [
    { id: "terreno", name: "Terreno", group: "Costo de proyecto", budgetable: true },
    { id: "proyecto", name: "Proyecto / ingenierías", group: "Preconstrucción", budgetable: true },
    { id: "tramites", name: "Trámites, permisos y licencias", group: "Preconstrucción", budgetable: true },
    { id: "construccion", name: "Construcción", group: "Costo directo", budgetable: true },
    { id: "infraestructura", name: "Infraestructura", group: "Costo directo", budgetable: true },
    { id: "mkt", name: "Mercadotecnia y publicidad", group: "Comercialización", budgetable: true },
    { id: "comercializacion", name: "Comercialización / comisiones", group: "Comercialización", budgetable: true },
    { id: "gastos_notariales", name: "Gastos notariales", group: "Legal / fiscal", budgetable: true },
    { id: "honorarios_legales", name: "Honorarios legales", group: "Legal / fiscal", budgetable: true },
    { id: "gastos_adm_credito", name: "Gastos administrativos de crédito", group: "Financiamiento", budgetable: true },
    { id: "comisiones_bancarias", name: "Comisiones bancarias", group: "Financiamiento", budgetable: true },
    { id: "intereses", name: "Pago de intereses / ministración", group: "Financiamiento", budgetable: true },
    { id: "impuestos", name: "Impuestos y retenciones", group: "Legal / fiscal", budgetable: true },
    { id: "fee", name: "Fee desarrollador", group: "Indirectos", budgetable: true },
    { id: "admin_obra", name: "Administración de obra", group: "Indirectos", budgetable: true },
    { id: "caja_chica", name: "Caja chica", group: "Operación", budgetable: true },
    { id: "ingresos", name: "Ingresos", group: "Ingresos", budgetable: false },
  ],
  budgets: [
    { projectId: "arenna", categoryId: "proyecto", budget: 188574 },
    { projectId: "arenna", categoryId: "tramites", budget: 750000 },
    { projectId: "arenna", categoryId: "construccion", budget: 60710338 },
    { projectId: "arenna", categoryId: "infraestructura", budget: 2745455 },
    { projectId: "arenna", categoryId: "mkt", budget: 2020496 },
    { projectId: "arenna", categoryId: "terreno", budget: 13550000 },
    { projectId: "arenna", categoryId: "gastos_notariales", budget: 460000 },
    { projectId: "arenna", categoryId: "fee", budget: 2814371 },
    { projectId: "arenna", categoryId: "comercializacion", budget: 4516867 },
    { projectId: "arenna", categoryId: "gastos_adm_credito", budget: 183334 },
    { projectId: "arenna", categoryId: "intereses", budget: 4316666 },
  ],
  payables: [
    { id: "p1", projectId: "arenna", supplier: "MUNICIPIO DE MÉRIDA", concept: "Derecho de factibilidad de uso de suelo", categoryId: "tramites", amount: 519, iva: 0, requestedBy: "Residente", requiredDate: todayIso(), status: "Solicitado", priority: "Alta", documentStatus: "Soporte cargado", notes: "Base importada del control de gastos." },
    { id: "p2", projectId: "arenna", supplier: "Constructora", concept: "Estimación de obra", categoryId: "construccion", amount: 3400000, iva: 0, requestedBy: "Obra", requiredDate: todayIso(), status: "En revisión", priority: "Alta", documentStatus: "Pendiente factura", notes: "Debe relacionarse con estimaciones." },
    { id: "p3", projectId: "residente", supplier: "Despacho arquitectónico", concept: "Anteproyecto y coordinación", categoryId: "proyecto", amount: 180000, iva: 28800, requestedBy: "Dirección", requiredDate: todayIso(), status: "Autorizado", priority: "Media", documentStatus: "Factura OK", notes: "Pago programable." },
  ],
  payments: [
    { id: "pay1", payableId: "p1", projectId: "arenna", amount: 519, bank: "Banorte", date: todayIso(), reference: "SPEI-DEMO", reconciled: true },
  ],
  pettyCash: [
    { id: "cc1", projectId: "arenna", name: "Caja chica obra Arenna", responsible: "Residente Juan", amount: 20000, status: "Abierta", openedAt: todayIso() },
  ],
  pettyExpenses: [
    { id: "g1", cashId: "cc1", projectId: "arenna", date: todayIso(), concept: "Material menor y herramienta", categoryId: "caja_chica", amount: 1850, status: "Pendiente revisión", hasReceipt: true },
  ],
  assets: [
    { id: "local-13", name: "Local 13", projectId: "plaza-vias", type: "Local comercial", area: 42, location: "Plaza Las Vías", status: "Ocupado" },
    { id: "terreno-1", name: "Terreno renta", projectId: "plaza-vias", type: "Terreno", area: 300, location: "Mérida", status: "Ocupado" },
    { id: "casa-1", name: "Casa oficina", projectId: "plaza-vias", type: "Casa", area: 200, location: "Campestre", status: "Ocupado" },
  ],
  tenants: [
    { id: "t1", name: "COCINAS DANFER", fiscalId: "", email: "", phone: "", certificateStatus: "Vigente" },
    { id: "t2", name: "NOEMI MUÑOZ (ESCUELA DE INGLÉS)", fiscalId: "", email: "", phone: "", certificateStatus: "Por actualizar" },
    { id: "t3", name: "DAHE ELADIOS CENTRO", fiscalId: "", email: "", phone: "", certificateStatus: "Vigente" },
  ],
  contracts: [
    { id: "r1", assetId: "local-13", tenantId: "t1", rentBase: 18121.75, maintenancePct: 8, startDate: "2025-01-01", endDate: "2026-12-31", paymentDay: 10, inpcMonth: "mar-25", lastIncreaseDate: "2025-03-01", bank: "VEPORMAS", reference: "FT260587JRVZ", status: "Activo", autoInvoice: true },
    { id: "r2", assetId: "terreno-1", tenantId: "t2", rentBase: 86599.43, maintenancePct: 0, startDate: "2025-02-01", endDate: "2027-01-31", paymentDay: 15, inpcMonth: "feb-25", lastIncreaseDate: "2025-02-01", bank: "VEPORMAS", reference: "", status: "Activo", autoInvoice: true },
    { id: "r3", assetId: "casa-1", tenantId: "t3", rentBase: 54102.58, maintenancePct: 0, startDate: "2025-06-25", endDate: "2026-06-25", paymentDay: 23, inpcMonth: "jun-25", lastIncreaseDate: "2025-06-25", bank: "VEPORMAS", reference: "FT260541NY8Q", status: "Activo", autoInvoice: false },
  ],
  rentCharges: [
    { id: "rc1", contractId: "r1", period: "2026-02", rent: 18121.75, maintenance: 1449.74, status: "Vencido", paidAmount: 0, dueDate: "2026-02-10", bankReference: "FT260587JRVZ", invoiceStatus: "Pendiente" },
    { id: "rc2", contractId: "r2", period: "2026-02", rent: 86599.43, maintenance: 0, status: "Vencido", paidAmount: 0, dueDate: "2026-02-15", bankReference: "", invoiceStatus: "Pendiente" },
    { id: "rc3", contractId: "r3", period: "2026-02", rent: 54102.58, maintenance: 0, status: "Pagado", paidAmount: 54102.58, dueDate: "2026-02-23", bankReference: "FT260541NY8Q", invoiceStatus: "Emitida" },
  ],
  permits: [
    { id: "t1", projectId: "arenna", name: "Licencia de construcción", agency: "Municipio", status: "En revisión", priority: "Alta", owner: "Gestoría", nextAction: "Dar seguimiento a observaciones", dueDate: todayIso(), documents: "Planos, pago de derechos, memoria" },
    { id: "t2", projectId: "arenna", name: "Régimen en condominio", agency: "Notaría / Registro", status: "Preparando documentos", priority: "Alta", owner: "Legal", nextAction: "Integrar planos finales y tabla de indivisos", dueDate: todayIso(), documents: "Proyecto, cédulas, planos" },
    { id: "t3", projectId: "residente", name: "Factibilidad de uso de suelo", agency: "Municipio", status: "No iniciado", priority: "Media", owner: "Dirección", nextAction: "Confirmar alineamiento del predio", dueDate: todayIso(), documents: "Escritura, predial, croquis" },
  ],
  users: [
    { id: "u1", name: "Rodrigo Herrera", role: "Dirección", email: "rodri@triton.local" },
    { id: "u2", name: "Administración Triton", role: "Administración", email: "admin@triton.local" },
    { id: "u3", name: "Residente Juan", role: "Residente", email: "residente@triton.local" },
    { id: "u4", name: "Supervisión", role: "Supervisión", email: "supervision@triton.local" },
  ],
};

const moduleMeta = {
  dashboard: { title: "Dashboard", subtitle: "Vista directiva de toda la operación", icon: "▦" },
  proyectos: { title: "Proyectos", subtitle: "Base para cruzar obra, pagos, rentas y trámites", icon: "⌂" },
  finanzas: { title: "Finanzas", subtitle: "Presupuesto, egresos, ingresos y estado de resultados", icon: "$" },
  cxp: { title: "Cuentas por pagar", subtitle: "Solicitud → autorización → pago → conciliación", icon: "↗" },
  caja_chica: { title: "Caja chica", subtitle: "Fondos, comprobantes, liquidación y reposición", icon: "▣" },
  cobranza: { title: "Cobranza / rentas", subtitle: "Contratos, INPC, rentas mensuales, facturación y conciliación", icon: "↙" },
  tramites: { title: "Trámites", subtitle: "Permisos, dependencias, responsables y siguientes acciones", icon: "◷" },
  reportes_os: { title: "Reportes", subtitle: "Indicadores consolidados por proyecto", icon: "▤" },
  config_os: { title: "Configuración", subtitle: "Catálogos, roles y reglas de operación", icon: "⚙" },
};

function readData() {
  try {
    const raw = localStorage.getItem("triton_os_v27");
    if (!raw) return initialData;
    const parsed = JSON.parse(raw);
    return { ...initialData, ...parsed };
  } catch {
    return initialData;
  }
}

function Pill({ children, tone = "idle" }) {
  const map = {
    ok: { bg: c.greenSoft, color: "#1f7a35" },
    warn: { bg: c.orangeSoft, color: "#9a5a00" },
    danger: { bg: c.redSoft, color: "#b42318" },
    primary: { bg: c.primarySoft, color: "#005ecb" },
    purple: { bg: c.purpleSoft, color: c.purple },
    idle: { bg: c.soft, color: c.text },
  };
  const style = map[tone] || map.idle;
  return <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 999, padding: "5px 9px", fontSize: 12, fontWeight: 900, background: style.bg, color: style.color, whiteSpace: "nowrap" }}>{children}</span>;
}

function Card({ children, style }) {
  return <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 24, padding: 18, boxShadow: "0 10px 30px rgba(0,0,0,0.04)", ...style }}>{children}</div>;
}

function Button({ children, onClick, variant = "primary", disabled, style, type = "button" }) {
  const styles = {
    primary: { background: c.primary, color: "white", border: "none" },
    secondary: { background: "white", color: c.text, border: `1px solid ${c.border}` },
    danger: { background: c.red, color: "white", border: "none" },
    success: { background: c.green, color: "white", border: "none" },
  };
  return <button type={type} disabled={disabled} onClick={onClick} style={{ borderRadius: 14, padding: "11px 14px", fontWeight: 950, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, ...styles[variant], ...style }}>{children}</button>;
}

function Field({ label, children }) {
  return <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 900, color: c.muted }}>{label}{children}</label>;
}
function inputStyle(extra = {}) { return { width: "100%", border: `1px solid ${c.border}`, borderRadius: 14, padding: "11px 12px", fontSize: 14, color: c.text, background: "white", boxSizing: "border-box", ...extra }; }
function SectionTitle({ title, helper }) { return <div style={{ marginBottom: 14 }}><h3 style={{ margin: 0, fontSize: 18, color: c.text }}>{title}</h3>{helper ? <p style={{ margin: "4px 0 0", color: c.muted, fontSize: 13, lineHeight: 1.45 }}>{helper}</p> : null}</div>; }

function MiniTable({ columns, rows, empty = "Sin registros todavía." }) {
  return <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 760 }}><thead><tr>{columns.map((col) => <th key={col.key} style={{ textAlign: "left", color: c.muted, fontSize: 12, padding: "10px 9px", borderBottom: `1px solid ${c.border}`, whiteSpace: "nowrap" }}>{col.label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, idx) => <tr key={row.id || idx}>{columns.map((col) => <td key={col.key} style={{ padding: "12px 9px", borderBottom: `1px solid rgba(60,60,67,0.08)`, verticalAlign: "top", fontSize: 13, color: c.text }}>{typeof col.render === "function" ? col.render(row) : row[col.key]}</td>)}</tr>) : <tr><td colSpan={columns.length} style={{ padding: 18, color: c.muted, textAlign: "center" }}>{empty}</td></tr>}</tbody></table></div>;
}

export default function TritonOSModules() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("dashboard");
  const [data, setData] = useState(readData);
  const [projectFilter, setProjectFilter] = useState("todos");
  const [showForm, setShowForm] = useState(null);
  const [form, setForm] = useState({});

  useEffect(() => { localStorage.setItem("triton_os_v27", JSON.stringify(data)); }, [data]);
  useEffect(() => {
    const openHandler = (event) => { setActive(event.detail?.module || "dashboard"); setOpen(true); };
    const closeHandler = () => setOpen(false);
    window.addEventListener("triton-open-os-module", openHandler);
    window.addEventListener("triton-close-os-module", closeHandler);
    return () => { window.removeEventListener("triton-open-os-module", openHandler); window.removeEventListener("triton-close-os-module", closeHandler); };
  }, []);

  const projectMap = useMemo(() => Object.fromEntries(data.projects.map((p) => [p.id, p])), [data.projects]);
  const categoryMap = useMemo(() => Object.fromEntries(data.categories.map((p) => [p.id, p])), [data.categories]);
  const tenantMap = useMemo(() => Object.fromEntries(data.tenants.map((p) => [p.id, p])), [data.tenants]);
  const assetMap = useMemo(() => Object.fromEntries(data.assets.map((p) => [p.id, p])), [data.assets]);
  const contractMap = useMemo(() => Object.fromEntries(data.contracts.map((p) => [p.id, p])), [data.contracts]);

  const filteredPayables = data.payables.filter((p) => projectFilter === "todos" || p.projectId === projectFilter);
  const filteredPermits = data.permits.filter((p) => projectFilter === "todos" || p.projectId === projectFilter);
  const projectOptions = [{ id: "todos", name: "Todos los proyectos" }, ...data.projects];

  const totals = useMemo(() => {
    const payablesTotal = data.payables.reduce((a, p) => a + Number(p.amount || 0) + Number(p.iva || 0), 0);
    const paidTotal = data.payments.reduce((a, p) => a + Number(p.amount || 0), 0);
    const pendingPayables = data.payables.filter((p) => !["Pagado", "Conciliado", "Cancelado", "Rechazado"].includes(p.status));
    const rentExpected = data.rentCharges.reduce((a, r) => a + Number(r.rent || 0) + Number(r.maintenance || 0), 0);
    const rentPaid = data.rentCharges.reduce((a, r) => a + Number(r.paidAmount || 0), 0);
    const rentOverdue = data.rentCharges.filter((r) => ["Vencido", "Parcial"].includes(r.status)).reduce((a, r) => a + Math.max(0, Number(r.rent || 0) + Number(r.maintenance || 0) - Number(r.paidAmount || 0)), 0);
    const openPermits = data.permits.filter((t) => !["Aprobado", "Cerrado"].includes(t.status));
    const pettyOpen = data.pettyCash.filter((cc) => cc.status !== "Cerrada");
    return { payablesTotal, paidTotal, pendingPayables, rentExpected, rentPaid, rentOverdue, openPermits, pettyOpen };
  }, [data]);

  function addRecord(collectionName, payload) {
    setData((prev) => ({ ...prev, [collectionName]: [{ id: uid(collectionName), ...payload }, ...prev[collectionName]] }));
    setShowForm(null); setForm({});
  }
  function updateRecord(collectionName, id, patch) {
    setData((prev) => ({ ...prev, [collectionName]: prev[collectionName].map((item) => item.id === id ? { ...item, ...patch } : item) }));
  }
  function resetDemo() {
    if (window.confirm("¿Restablecer datos demo de TRITON OS?")) { localStorage.removeItem("triton_os_v27"); setData(initialData); }
  }

  if (!open) return null;
  const meta = moduleMeta[active] || moduleMeta.dashboard;

  return <div style={{ position: "fixed", inset: 0, zIndex: 2147483600, pointerEvents: "none" }}>
    <div style={{ position: "absolute", left: "calc(var(--triton-shell-offset, 84px) + 22px)", right: 22, top: 18, bottom: 18, pointerEvents: "auto", background: "rgba(245,245,247,0.96)", border: `1px solid ${c.border}`, borderRadius: 30, boxShadow: c.shadow, overflow: "hidden", display: "grid", gridTemplateRows: "auto 1fr" }}>
      <header style={{ padding: "18px 22px", background: "rgba(255,255,255,0.86)", borderBottom: `1px solid ${c.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ width: 44, height: 44, borderRadius: 16, background: c.primarySoft, color: c.primary, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 950 }}>{meta.icon}</span>
          <div><h2 style={{ margin: 0, color: c.text, fontSize: 24, letterSpacing: -0.5 }}>{meta.title}</h2><p style={{ margin: "3px 0 0", color: c.muted, fontSize: 13 }}>{meta.subtitle}</p></div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={inputStyle({ width: 220 })}>{projectOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cerrar</Button>
        </div>
      </header>
      <main style={{ overflow: "auto", padding: 22 }}>
        {active === "dashboard" && <Dashboard totals={totals} data={data} projectMap={projectMap} setActive={setActive} />}
        {active === "proyectos" && <Projects data={data} addRecord={addRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "finanzas" && <Finance data={data} projectMap={projectMap} categoryMap={categoryMap} projectFilter={projectFilter} />}
        {active === "cxp" && <Payables data={data} projectMap={projectMap} categoryMap={categoryMap} rows={filteredPayables} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "caja_chica" && <PettyCash data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "cobranza" && <Rentals data={data} projectMap={projectMap} tenantMap={tenantMap} assetMap={assetMap} contractMap={contractMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "tramites" && <Permits data={data} projectMap={projectMap} rows={filteredPermits} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "reportes_os" && <Reports totals={totals} data={data} projectMap={projectMap} categoryMap={categoryMap} />}
        {active === "config_os" && <Config data={data} setData={setData} resetDemo={resetDemo} />}
      </main>
    </div>
  </div>;
}

function Dashboard({ totals, data, projectMap, setActive }) {
  const cards = [
    { label: "Pagos por autorizar / revisar", value: totals.pendingPayables.length, helper: money(totals.pendingPayables.reduce((a, p) => a + Number(p.amount || 0) + Number(p.iva || 0), 0)), tone: "warn", go: "cxp" },
    { label: "Rentas vencidas", value: money(totals.rentOverdue), helper: `${data.rentCharges.filter((r) => ["Vencido", "Parcial"].includes(r.status)).length} registros abiertos`, tone: "danger", go: "cobranza" },
    { label: "Trámites activos", value: totals.openPermits.length, helper: `${totals.openPermits.filter((t) => t.priority === "Alta").length} prioridad alta`, tone: "purple", go: "tramites" },
    { label: "Caja chica abierta", value: totals.pettyOpen.length, helper: money(totals.pettyOpen.reduce((a, cc) => a + Number(cc.amount || 0), 0)), tone: "primary", go: "caja_chica" },
  ];
  return <div style={{ display: "grid", gap: 18 }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>{cards.map((kpi) => <button key={kpi.label} onClick={() => setActive(kpi.go)} style={{ textAlign: "left", border: `1px solid ${c.border}`, borderRadius: 22, background: "white", padding: 18, cursor: "pointer" }}><Pill tone={kpi.tone}>{kpi.label}</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 12, color: c.text }}>{kpi.value}</div><div style={{ color: c.muted, marginTop: 4, fontSize: 13 }}>{kpi.helper}</div></button>)}</div>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(320px, 0.85fr)", gap: 16 }}>
      <Card><SectionTitle title="Alertas operativas" helper="Lo que debe atenderse antes de que bloquee obra, pagos o cobranza." />
        <div style={{ display: "grid", gap: 10 }}>
          {totals.pendingPayables.slice(0, 4).map((p) => <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 13, borderRadius: 16, background: c.orangeSoft }}><div><b>{p.supplier}</b><div style={{ color: c.muted, fontSize: 12 }}>{projectMap[p.projectId]?.name} · {p.concept}</div></div><Pill tone="warn">{p.status}</Pill></div>)}
          {data.rentCharges.filter((r) => ["Vencido", "Parcial"].includes(r.status)).slice(0, 4).map((r) => <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 13, borderRadius: 16, background: c.redSoft }}><div><b>{tenantName(r, data)}</b><div style={{ color: c.muted, fontSize: 12 }}>{r.period} · saldo {money((r.rent + r.maintenance) - r.paidAmount)}</div></div><Pill tone="danger">{r.status}</Pill></div>)}
        </div>
      </Card>
      <Card><SectionTitle title="Proyectos" helper="Resumen ejecutivo por proyecto." />
        <div style={{ display: "grid", gap: 10 }}>{data.projects.map((p) => { const egresos = data.payables.filter((x) => x.projectId === p.id).reduce((a, x) => a + Number(x.amount || 0) + Number(x.iva || 0), 0); return <div key={p.id} style={{ border: `1px solid ${c.border}`, borderRadius: 16, padding: 13 }}><div style={{ display: "flex", justifyContent: "space-between" }}><b>{p.name}</b><Pill>{p.status}</Pill></div><div style={{ color: c.muted, fontSize: 12, marginTop: 6 }}>{p.type}</div><div style={{ marginTop: 10, height: 8, background: c.soft, borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${Math.min(100, p.budget ? (egresos / p.budget) * 100 : 0)}%`, height: "100%", background: c.primary }} /></div><div style={{ fontSize: 12, color: c.muted, marginTop: 5 }}>Egresos registrados: {money(egresos)}</div></div>; })}</div>
      </Card>
    </div>
  </div>;
}

function Projects({ data, addRecord, showForm, setShowForm, form, setForm }) {
  return <div style={{ display: "grid", gap: 16 }}><Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><SectionTitle title="Proyectos" helper="Cada módulo debe cruzarse por proyecto para tener estado de resultados, trámites, pagos y cobranza." /><Button onClick={() => setShowForm(showForm === "project" ? null : "project")}>Nuevo proyecto</Button></div>{showForm === "project" ? <SimpleForm fields={["name", "type", "status", "budget", "incomeTarget"]} labels={{ name: "Nombre", type: "Tipo", status: "Estatus", budget: "Presupuesto", incomeTarget: "Ingresos proyectados" }} form={form} setForm={setForm} onSubmit={() => addRecord("projects", { ...form, budget: Number(form.budget || 0), incomeTarget: Number(form.incomeTarget || 0), owner: "TRITON" })} /> : null}</Card><Card><MiniTable columns={[{ key: "name", label: "Proyecto" }, { key: "type", label: "Tipo" }, { key: "status", label: "Estatus", render: (r) => <Pill tone="primary">{r.status}</Pill> }, { key: "budget", label: "Presupuesto", render: (r) => money(r.budget) }, { key: "incomeTarget", label: "Ingresos proyectados", render: (r) => money(r.incomeTarget) }]} rows={data.projects} /></Card></div>;
}

function Finance({ data, projectMap, categoryMap, projectFilter }) {
  const projectIds = projectFilter === "todos" ? data.projects.map((p) => p.id) : [projectFilter];
  const rows = [];
  for (const projectId of projectIds) {
    const budgets = data.budgets.filter((b) => b.projectId === projectId);
    const cats = [...new Set([...budgets.map((b) => b.categoryId), ...data.payables.filter((p) => p.projectId === projectId).map((p) => p.categoryId)])];
    for (const categoryId of cats) {
      const budget = budgets.find((b) => b.categoryId === categoryId)?.budget || 0;
      const committed = data.payables.filter((p) => p.projectId === projectId && p.categoryId === categoryId).reduce((a, p) => a + Number(p.amount || 0) + Number(p.iva || 0), 0);
      const paid = data.payments.filter((p) => p.projectId === projectId).reduce((a, p) => a + Number(p.amount || 0), 0);
      rows.push({ id: `${projectId}-${categoryId}`, project: projectMap[projectId]?.name, category: categoryMap[categoryId]?.name || categoryId, budget, committed, paid: categoryId === rows[0]?.categoryId ? paid : 0, variance: budget - committed });
    }
  }
  const totalBudget = rows.reduce((a, r) => a + r.budget, 0), totalCommitted = rows.reduce((a, r) => a + r.committed, 0);
  return <div style={{ display: "grid", gap: 16 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 14 }}><Card><Pill tone="primary">Presupuesto</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totalBudget)}</div></Card><Card><Pill tone="warn">Comprometido</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totalCommitted)}</div></Card><Card><Pill tone={totalBudget - totalCommitted >= 0 ? "ok" : "danger"}>Saldo</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totalBudget - totalCommitted)}</div></Card></div><Card><SectionTitle title="Presupuesto vs real" helper="Base para estado de resultados al día por proyecto. Las categorías salen de tus hojas de gastos y presupuestos." /><MiniTable columns={[{ key: "project", label: "Proyecto" }, { key: "category", label: "Categoría" }, { key: "budget", label: "Presupuesto", render: (r) => money(r.budget) }, { key: "committed", label: "Solicitado / comprometido", render: (r) => money(r.committed) }, { key: "variance", label: "Saldo", render: (r) => <Pill tone={r.variance >= 0 ? "ok" : "danger"}>{money(r.variance)}</Pill> }]} rows={rows} /></Card></div>;
}

function Payables({ data, projectMap, categoryMap, rows, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const statuses = ["Solicitado", "En revisión", "Observado", "Autorizado", "Programado", "Pagado", "Conciliado", "Rechazado", "Cancelado"];
  const next = { "Solicitado": "En revisión", "En revisión": "Autorizado", "Observado": "En revisión", "Autorizado": "Programado", "Programado": "Pagado", "Pagado": "Conciliado" };
  return <div style={{ display: "grid", gap: 16 }}><Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><SectionTitle title="Solicitudes de pago" helper="Control completo: solicitud, revisión administrativa, autorización, programación, pago y conciliación." /><Button onClick={() => setShowForm(showForm === "payable" ? null : "payable")}>Nueva solicitud</Button></div>{showForm === "payable" ? <div style={{ marginTop: 12 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Proveedor"><input style={inputStyle()} value={form.supplier || ""} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></Field><Field label="Categoría"><select style={inputStyle()} value={form.categoryId || "construccion"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Monto"><input style={inputStyle()} type="number" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="IVA"><input style={inputStyle()} type="number" value={form.iva || ""} onChange={(e) => setForm({ ...form, iva: e.target.value })} /></Field><Field label="Fecha requerida"><input style={inputStyle()} type="date" value={form.requiredDate || todayIso()} onChange={(e) => setForm({ ...form, requiredDate: e.target.value })} /></Field></div><Field label="Concepto"><textarea style={inputStyle({ minHeight: 70 })} value={form.concept || ""} onChange={(e) => setForm({ ...form, concept: e.target.value })} /></Field><Button style={{ marginTop: 10 }} onClick={() => addRecord("payables", { projectId: form.projectId || "arenna", supplier: form.supplier || "Proveedor", concept: form.concept || "Solicitud de pago", categoryId: form.categoryId || "construccion", amount: Number(form.amount || 0), iva: Number(form.iva || 0), requestedBy: "Usuario", requiredDate: form.requiredDate || todayIso(), status: "Solicitado", priority: "Media", documentStatus: "Pendiente soporte", notes: "" })}>Guardar solicitud</Button></div> : null}</Card><Card><MiniTable columns={[{ key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "supplier", label: "Proveedor" }, { key: "concept", label: "Concepto" }, { key: "categoryId", label: "Categoría", render: (r) => categoryMap[r.categoryId]?.name }, { key: "amount", label: "Total", render: (r) => money(Number(r.amount || 0) + Number(r.iva || 0)) }, { key: "status", label: "Estado", render: (r) => <Pill tone={r.status === "Pagado" || r.status === "Conciliado" ? "ok" : r.status === "Observado" ? "danger" : "warn"}>{r.status}</Pill> }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{next[r.status] ? <Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("payables", r.id, { status: next[r.status] })}>{next[r.status]}</Button> : null}<Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("payables", r.id, { status: "Observado" })}>Observar</Button></div> }]} rows={rows} /></Card></div>;
}

function PettyCash({ data, projectMap, categoryMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  return <div style={{ display: "grid", gap: 16 }}><Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><SectionTitle title="Caja chica" helper="Fondos por responsable. Cada gasto exige comprobante o motivo de excepción y se liquida antes de abrir otra caja." /><Button onClick={() => setShowForm(showForm === "cash" ? null : "cash")}>Crear caja</Button></div>{showForm === "cash" ? <SimpleForm fields={["name", "responsible", "amount"]} labels={{ name: "Nombre de caja", responsible: "Responsable", amount: "Monto asignado" }} form={form} setForm={setForm} onSubmit={() => addRecord("pettyCash", { projectId: "arenna", name: form.name || "Caja chica", responsible: form.responsible || "Responsable", amount: Number(form.amount || 0), status: "Abierta", openedAt: todayIso() })} /> : null}</Card><Card><MiniTable columns={[{ key: "name", label: "Caja" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "responsible", label: "Responsable" }, { key: "amount", label: "Monto", render: (r) => money(r.amount) }, { key: "status", label: "Estado", render: (r) => <Pill tone={r.status === "Cerrada" ? "ok" : "primary"}>{r.status}</Pill> }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6 }}><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("pettyCash", r.id, { status: "En revisión" })}>Liquidar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("pettyCash", r.id, { status: "Cerrada" })}>Cerrar</Button></div> }]} rows={data.pettyCash} /></Card><Card><SectionTitle title="Comprobantes de caja" /><MiniTable columns={[{ key: "date", label: "Fecha" }, { key: "concept", label: "Concepto" }, { key: "categoryId", label: "Categoría", render: (r) => categoryMap[r.categoryId]?.name }, { key: "amount", label: "Monto", render: (r) => money(r.amount) }, { key: "status", label: "Estado", render: (r) => <Pill tone="warn">{r.status}</Pill> }, { key: "hasReceipt", label: "Comprobante", render: (r) => r.hasReceipt ? "Sí" : "No" }]} rows={data.pettyExpenses} /></Card></div>;
}

function tenantName(charge, data) { const contract = data.contracts.find((c) => c.id === charge.contractId); return data.tenants.find((t) => t.id === contract?.tenantId)?.name || "Arrendatario"; }
function Rentals({ data, projectMap, tenantMap, assetMap, contractMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  return <div style={{ display: "grid", gap: 16 }}><Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><SectionTitle title="Cobranza de rentas" helper="Control mensual de locales, terrenos, casas, departamentos, contratos, INPC, cédulas, facturación y conciliación." /><Button onClick={() => setShowForm(showForm === "rent" ? null : "rent")}>Generar renta manual</Button></div>{showForm === "rent" ? <div style={{ display: "grid", gap: 10, marginTop: 12 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Contrato"><select style={inputStyle()} value={form.contractId || "r1"} onChange={(e) => setForm({ ...form, contractId: e.target.value })}>{data.contracts.map((r) => <option key={r.id} value={r.id}>{tenantMap[r.tenantId]?.name} · {assetMap[r.assetId]?.name}</option>)}</select></Field><Field label="Periodo"><input style={inputStyle()} value={form.period || "2026-03"} onChange={(e) => setForm({ ...form, period: e.target.value })} /></Field></div><Button onClick={() => { const ct = data.contracts.find((x) => x.id === (form.contractId || "r1")); addRecord("rentCharges", { contractId: ct?.id || "r1", period: form.period || "2026-03", rent: Number(ct?.rentBase || 0), maintenance: Number(ct?.rentBase || 0) * Number(ct?.maintenancePct || 0) / 100, status: "Pendiente", paidAmount: 0, dueDate: `${form.period || "2026-03"}-${String(ct?.paymentDay || 10).padStart(2, "0")}`, bankReference: ct?.reference || "", invoiceStatus: ct?.autoInvoice ? "Por emitir" : "No automática" }); }}>Generar cargo</Button></div> : null}</Card><Card><MiniTable columns={[{ key: "contractId", label: "Cliente", render: (r) => tenantName(r, data) }, { key: "contractId2", label: "Inmueble", render: (r) => assetMap[contractMap[r.contractId]?.assetId]?.name }, { key: "period", label: "Periodo" }, { key: "rent", label: "Renta base", render: (r) => money(r.rent) }, { key: "maintenance", label: "Mantto", render: (r) => money(r.maintenance) }, { key: "paidAmount", label: "Pagado", render: (r) => money(r.paidAmount) }, { key: "status", label: "Estado", render: (r) => <Pill tone={r.status === "Pagado" ? "ok" : r.status === "Vencido" ? "danger" : "warn"}>{r.status}</Pill> }, { key: "bankReference", label: "Referencia" }, { key: "invoiceStatus", label: "Factura" }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6 }}><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("rentCharges", r.id, { status: "Pagado", paidAmount: Number(r.rent || 0) + Number(r.maintenance || 0), invoiceStatus: "Emitida" })}>Marcar pagado</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("rentCharges", r.id, { status: "Vencido" })}>Vencido</Button></div> }]} rows={data.rentCharges} /></Card><Card><SectionTitle title="Contratos" helper="Incluye INPC, fecha de última actualización, cédula vigente y facturación automática." /><MiniTable columns={[{ key: "tenantId", label: "Arrendatario", render: (r) => tenantMap[r.tenantId]?.name }, { key: "assetId", label: "Inmueble", render: (r) => assetMap[r.assetId]?.name }, { key: "rentBase", label: "Renta", render: (r) => money(r.rentBase) }, { key: "maintenancePct", label: "Mantto %", render: (r) => `${r.maintenancePct || 0}%` }, { key: "paymentDay", label: "Día pago" }, { key: "inpcMonth", label: "INPC" }, { key: "lastIncreaseDate", label: "Última act." }, { key: "status", label: "Estado", render: (r) => <Pill tone="primary">{r.status}</Pill> }]} rows={data.contracts} /></Card></div>;
}

function Permits({ data, projectMap, rows, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const statuses = ["No iniciado", "Preparando documentos", "Ingresado", "En revisión", "Observado", "En corrección", "Aprobado", "Rechazado", "Vencido", "Cerrado"];
  return <div style={{ display: "grid", gap: 16 }}><Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><SectionTitle title="Trámites por proyecto" helper="Cada trámite debe tener responsable, siguiente acción y fecha compromiso. Evita el estatus genérico “en proceso”." /><Button onClick={() => setShowForm(showForm === "permit" ? null : "permit")}>Nuevo trámite</Button></div>{showForm === "permit" ? <div style={{ marginTop: 12 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Nombre"><input style={inputStyle()} value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Dependencia"><input style={inputStyle()} value={form.agency || ""} onChange={(e) => setForm({ ...form, agency: e.target.value })} /></Field><Field label="Responsable"><input style={inputStyle()} value={form.owner || ""} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></Field><Field label="Fecha compromiso"><input style={inputStyle()} type="date" value={form.dueDate || todayIso()} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field></div><Field label="Siguiente acción"><textarea style={inputStyle({ minHeight: 70 })} value={form.nextAction || ""} onChange={(e) => setForm({ ...form, nextAction: e.target.value })} /></Field><Button style={{ marginTop: 10 }} onClick={() => addRecord("permits", { projectId: form.projectId || "arenna", name: form.name || "Trámite", agency: form.agency || "Dependencia", status: "No iniciado", priority: "Media", owner: form.owner || "Responsable", nextAction: form.nextAction || "Definir siguiente acción", dueDate: form.dueDate || todayIso(), documents: "" })}>Guardar trámite</Button></div> : null}</Card><Card><MiniTable columns={[{ key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "name", label: "Trámite" }, { key: "agency", label: "Dependencia" }, { key: "owner", label: "Responsable" }, { key: "nextAction", label: "Siguiente acción" }, { key: "dueDate", label: "Fecha compromiso" }, { key: "status", label: "Estado", render: (r) => <select value={r.status} onChange={(e) => updateRecord("permits", r.id, { status: e.target.value })} style={inputStyle({ padding: 8, minWidth: 150 })}>{statuses.map((s) => <option key={s}>{s}</option>)}</select> }, { key: "priority", label: "Prioridad", render: (r) => <Pill tone={r.priority === "Alta" ? "danger" : "primary"}>{r.priority}</Pill> }]} rows={rows} /></Card></div>;
}

function Reports({ totals, data, projectMap, categoryMap }) {
  return <div style={{ display: "grid", gap: 16 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 14 }}><Card><Pill tone="primary">Rentas esperadas</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totals.rentExpected)}</div></Card><Card><Pill tone="ok">Rentas cobradas</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totals.rentPaid)}</div></Card><Card><Pill tone="danger">Cartera vencida</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totals.rentOverdue)}</div></Card></div><Card><SectionTitle title="Reporte directivo" helper="Consolidado para revisión semanal: pagos, rentas, caja chica y trámites." /><MiniTable columns={[{ key: "name", label: "Proyecto" }, { key: "type", label: "Tipo" }, { key: "payables", label: "Cuentas por pagar", render: (r) => money(data.payables.filter((p) => p.projectId === r.id).reduce((a, p) => a + Number(p.amount || 0) + Number(p.iva || 0), 0)) }, { key: "permits", label: "Trámites abiertos", render: (r) => data.permits.filter((p) => p.projectId === r.id && !["Aprobado", "Cerrado"].includes(p.status)).length }, { key: "status", label: "Estatus", render: (r) => <Pill tone="primary">{r.status}</Pill> }]} rows={data.projects} /></Card></div>;
}

function Config({ data, setData, resetDemo }) {
  return <div style={{ display: "grid", gap: 16 }}><Card><SectionTitle title="Catálogos base" helper="Se cargaron categorías derivadas de tus hojas de gastos/presupuestos y tipos de rentas: locales, terrenos, casas, departamentos y oficinas." /><MiniTable columns={[{ key: "name", label: "Categoría" }, { key: "group", label: "Grupo" }, { key: "budgetable", label: "Presupuestable", render: (r) => r.budgetable ? "Sí" : "No" }]} rows={data.categories} /></Card><Card><SectionTitle title="Usuarios y roles ejemplo" helper="Después esto se debe conectar con Firebase Auth y permisos reales por módulo." /><MiniTable columns={[{ key: "name", label: "Nombre" }, { key: "role", label: "Rol" }, { key: "email", label: "Correo" }]} rows={data.users} /></Card><Card><SectionTitle title="Mantenimiento" /><Button variant="danger" onClick={resetDemo}>Restablecer datos demo</Button></Card></div>;
}

function SimpleForm({ fields, labels, form, setForm, onSubmit }) {
  return <div style={{ marginTop: 14, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>{fields.map((field) => <Field key={field} label={labels[field] || field}><input style={inputStyle()} value={form[field] || ""} onChange={(e) => setForm({ ...form, [field]: e.target.value })} /></Field>)}</div><Button onClick={onSubmit} style={{ justifySelf: "start" }}>Guardar</Button></div>;
}
