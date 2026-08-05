import React, { useEffect, useMemo, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

const money = (value) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value || 0));
const numberFmt = (value) => new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(Number(value || 0));
const todayIso = () => new Date().toISOString().slice(0, 10);
const uid = (prefix = "id") => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const safeFileName = (name = "archivo") => String(name).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const DOC_TYPES = ["Factura PDF", "XML", "Contrato", "Orden de compra", "Estimación autorizada", "Cotización", "Carátula bancaria", "Comprobante de pago", "Ticket", "Foto / evidencia", "Otro soporte"];
const TAXPAYER_TYPES = ["Persona moral", "Persona física", "Dependencia / gobierno", "Extranjero", "No aplica"];
function readTextFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsText(file);
  });
}
function xmlAttr(text, attr) {
  const m = String(text || "").match(new RegExp(`${attr}=[\"']([^\"']+)[\"']`, "i"));
  return m ? m[1] : "";
}
function parseCfdiXml(text) {
  if (!text || !String(text).includes("Comprobante")) return null;
  const issuerBlock = String(text).match(/<cfdi:Emisor[^>]*>|<Emisor[^>]*>/i)?.[0] || "";
  const receiverBlock = String(text).match(/<cfdi:Receptor[^>]*>|<Receptor[^>]*>/i)?.[0] || "";
  const subtotal = Number(xmlAttr(text, "SubTotal") || 0);
  const total = Number(xmlAttr(text, "Total") || 0);
  const taxes = Math.max(0, total - subtotal);
  return {
    issuerRfc: xmlAttr(issuerBlock, "Rfc") || xmlAttr(issuerBlock, "RFC"),
    issuerName: xmlAttr(issuerBlock, "Nombre"),
    receiverRfc: xmlAttr(receiverBlock, "Rfc") || xmlAttr(receiverBlock, "RFC"),
    subtotal: roundMoney(subtotal),
    total: roundMoney(total),
    iva: roundMoney(taxes),
    uuid: xmlAttr(text, "UUID"),
  };
}
function taxProfileForSupplier(supplier = {}) {
  const taxpayerType = supplier.taxpayerType || supplier.personType || "Persona moral";
  const ivaRate = Number(supplier.ivaRate ?? 0.16);
  let isrRetentionRate = Number(supplier.isrRetentionRate ?? 0);
  let ivaRetentionRate = Number(supplier.ivaRetentionRate ?? 0);
  if (taxpayerType === "Persona física" && !supplier.taxProfileCustomized) {
    isrRetentionRate = 0.10;
    ivaRetentionRate = 0.106667;
  }
  if (["Dependencia / gobierno", "Extranjero", "No aplica"].includes(taxpayerType)) {
    isrRetentionRate = Number(supplier.isrRetentionRate ?? 0);
    ivaRetentionRate = Number(supplier.ivaRetentionRate ?? 0);
  }
  return { taxpayerType, ivaRate, isrRetentionRate, ivaRetentionRate, retentionRate: isrRetentionRate + ivaRetentionRate };
}
function calcTaxValues(value, supplier, mode = "base") {
  const profile = taxProfileForSupplier(supplier);
  const factor = Math.max(0.01, 1 + profile.ivaRate - profile.retentionRate);
  const base = roundMoney(mode === "total" ? Number(value || 0) / factor : Number(value || 0));
  const iva = roundMoney(base * profile.ivaRate);
  const isrRetention = roundMoney(base * profile.isrRetentionRate);
  const ivaRetention = roundMoney(base * profile.ivaRetentionRate);
  const retention = roundMoney(isrRetention + ivaRetention);
  const total = roundMoney(base + iva - retention);
  return { amount: base, iva, retention, totalInput: total, isrRetention, ivaRetention, taxProfile: profile };
}
const normalizeAttachments = (value) => {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? { name: item, url: "", source: "manual", docType: "Otro soporte" } : { docType: item.docType || item.attachmentType || "Sin clasificar", ...item }).filter(Boolean);
  if (!value) return [];
  return String(value).split(",").map((x) => x.trim()).filter(Boolean).map((name) => ({ name, url: "", source: "manual", docType: "Otro soporte" }));
};
const attachmentCount = (value) => normalizeAttachments(value).length;
const attachmentNames = (value) => normalizeAttachments(value).map((a) => a.name || a.url || "Anexo").join(", ");
async function uploadFinanceAttachments(fileList, folder = "finanzas/anexos") {
  const files = Array.from(fileList || []);
  const user = firebaseAuth.currentUser;
  const uploaded = [];
  for (const file of files) {
    const path = `${folder}/${todayIso()}/${uid("file")}_${safeFileName(file.name)}`;
    const isXml = /\.xml$/i.test(file.name || "") || String(file.type || "").includes("xml");
    let cfdi = null;
    if (isXml) {
      const text = await readTextFile(file);
      cfdi = parseCfdiXml(text);
    }
    try {
      const fileRef = storageRef(firebaseStorage, path);
      await uploadBytes(fileRef, file, {
        contentType: file.type || "application/octet-stream",
        customMetadata: { uploadedBy: user?.email || "sin_usuario", originalName: file.name || "archivo" },
      });
      const url = await getDownloadURL(fileRef);
      uploaded.push({ name: file.name, type: file.type || "archivo", docType: isXml ? "XML" : "Sin clasificar", size: file.size || 0, path, url, cfdi, source: "firebase-storage", uploadedBy: user?.email || "", uploadedAt: new Date().toISOString() });
    } catch (error) {
      uploaded.push({ name: file.name, type: file.type || "archivo", docType: isXml ? "XML" : "Sin clasificar", size: file.size || 0, path: "", url: "", cfdi, source: "pendiente_storage", uploadError: error?.message || String(error), uploadedBy: user?.email || "", uploadedAt: new Date().toISOString() });
    }
  }
  return uploaded;
}
function AttachmentUploader({ label = "Subir anexos", value, onChange, folder, helper, docTypes = DOC_TYPES, enableTypeSelect = true, onFilesUploaded }) {
  const [busy, setBusy] = useState(false);
  const list = normalizeAttachments(value);
  const updateItem = (idx, patch) => onChange(list.map((item, i) => i === idx ? { ...item, ...patch } : item));
  return <div style={{ display: "grid", gap: 8 }}>
    <Field label={label}>
      <input type="file" multiple accept=".pdf,.xml,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.doc,.docx,image/*,application/pdf,text/xml,application/xml" style={inputStyle({ padding: 10 })} disabled={busy} onChange={async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        setBusy(true);
        const newFiles = await uploadFinanceAttachments(files, folder);
        const merged = [ ...list, ...newFiles ];
        onChange(merged);
        if (typeof onFilesUploaded === "function") onFilesUploaded(newFiles, merged);
        e.target.value = "";
        setBusy(false);
      }} />
    </Field>
    <div style={{ fontSize: 12, color: c.muted }}>{busy ? "Subiendo anexos..." : (helper || "PDF, XML, imágenes, Excel o Word. Cada archivo queda ligado al registro.")}</div>
    {list.length ? <div style={{ display: "grid", gap: 8 }}>{list.map((a, i) => <div key={`${a.name}-${i}`} style={{ display: "grid", gridTemplateColumns: enableTypeSelect ? "minmax(120px,190px) minmax(0,1fr) auto" : "minmax(0,1fr) auto", gap: 8, alignItems: "center", padding: 8, borderRadius: 16, border: `1px solid ${c.border}`, background: a.uploadError ? c.redSoft : "white" }}>
      {enableTypeSelect ? <select style={inputStyle({ padding: "8px 9px", fontSize: 12 })} value={a.docType || "Sin clasificar"} onChange={(e) => updateItem(i, { docType: e.target.value })}><option>Sin clasificar</option>{docTypes.map((d) => <option key={d}>{d}</option>)}</select> : null}
      <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
        {a.url ? <a href={a.url} target="_blank" rel="noreferrer" style={{ color: c.primary, fontWeight: 900, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</a> : <span title={a.uploadError || "Anexo registrado"} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 850 }}>{a.name}</span>}
        {a.cfdi ? <span style={{ color: c.muted, fontSize: 11 }}>XML: {a.cfdi.issuerName || a.cfdi.issuerRfc || "Emisor"} · subtotal {money(a.cfdi.subtotal)} · total {money(a.cfdi.total)}</span> : null}
      </div>
      <button type="button" onClick={() => onChange(list.filter((_, idx) => idx !== i))} style={{ border: 0, background: c.soft, borderRadius: 12, cursor: "pointer", fontWeight: 950, width: 34, height: 34 }}>×</button>
    </div>)}</div> : <div style={{ fontSize: 12, color: c.orange, fontWeight: 800 }}>Sin anexos cargados.</div>}
  </div>;
}
function AttachmentViewer({ value }) {
  const list = normalizeAttachments(value);
  if (!list.length) return <Pill tone="warn">Sin anexos</Pill>;
  return <div style={{ minWidth: 180, display: "grid", gap: 4 }}>{list.slice(0, 3).map((a, i) => <div key={i} style={{ display: "grid", gap: 1 }}>{a.url ? <a href={a.url} target="_blank" rel="noreferrer" style={{ color: c.primary, fontSize: 12, fontWeight: 850 }}>{a.name}</a> : <span style={{ color: a.uploadError ? c.red : c.text, fontSize: 12 }}>{a.name}</span>}<span style={{ color: c.muted, fontSize: 10 }}>{a.docType || "Sin clasificar"}</span></div>)}{list.length > 3 ? <span style={{ color: c.muted, fontSize: 12 }}>+{list.length - 3} más</span> : null}</div>;
}

function currentFinanceUser() {
  const email = firebaseAuth.currentUser?.email?.toLowerCase?.() || "";
  if (email === "rodrigo@tritondesarrollos.com") return { email, role: "master", name: "Rodrigo Herrera" };
  if (email === "admin@tritondesarrollos.com") return { email, role: "finanzas_pagos", name: "Administración / Finanzas" };
  if (email === "supervision@tritondesarrollos.com") return { email, role: "supervisora", name: "Supervisión" };
  return { email, role: email ? "usuario" : "demo", name: email || "Sesión demo" };
}
function canFinanceAction(action) {
  const { role } = currentFinanceUser();
  if (role === "master") return true;
  const financeOps = new Set(["view", "create", "edit", "adminReview", "sendToAuthorization", "schedule", "batchSchedule", "pay", "reconcile", "supplierValidate", "pettyReview", "budgetManage", "contractManage", "recurringManage"]);
  if (role === "finanzas_pagos") return financeOps.has(action);
  return action === "view";
}
function ActionCell({ children }) {
  return <div style={{ display: "grid", gap: 6, minWidth: 96 }}>{children}</div>;
}
function StatusFilter({ value, onChange, options = [], total = 0, shown = 0, label = "Estado" }) {
  const unique = Array.from(new Set(options.filter(Boolean)));
  return <div style={{ display: "flex", alignItems: "end", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
    <Field label={label}><select value={value || "todos"} onChange={(e) => onChange(e.target.value)} style={inputStyle({ width: 210, padding: "9px 10px" })}><option value="todos">Todos los estados</option>{unique.map((st) => <option key={st} value={st}>{st}</option>)}</select></Field>
    <div style={{ fontSize: 12, color: c.muted, fontWeight: 850, paddingBottom: 10 }}>{shown} de {total} registro(s)</div>
  </div>;
}
function filterByStatus(rows, statusFilter) {
  if (!statusFilter || statusFilter === "todos") return rows;
  return rows.filter((row) => String(row.status || "") === statusFilter);
}
function sortableValue(row, col) {
  const raw = typeof col.sortValue === "function" ? col.sortValue(row) : row[col.key];
  if (typeof raw === "number") return raw;
  const asNumber = Number(raw);
  if (raw !== null && raw !== undefined && raw !== "" && !Number.isNaN(asNumber)) return asNumber;
  return String(raw ?? "").toLowerCase();
}


function PaymentContextModal({ row, data, projectMap, categoryMap, onClose, onAuthorize, onCorrection, onReject }) {
  if (!row) return null;
  const supplier = data.suppliers.find((s) => s.id === row.supplierId);
  const contract = (data.financeContracts || []).find((ct) => ct.id === row.contractId);
  const budget = budgetCheck(data, row);
  const contractInfo = contractCheck(data, row);
  const total = payableTotal(row);
  const canAuthorizeFinal = canFinanceAction("authorize");
  const relatedPayments = data.payables
    .filter((p) => p.id !== row.id && (p.supplierId === row.supplierId || p.categoryId === row.categoryId || p.contractId === row.contractId))
    .slice(0, 6);
  const paymentsMade = data.payments.filter((pay) => pay.payableId === row.id || relatedPayments.some((p) => p.id === pay.payableId));
  const log = [
    { label: "Solicitud creada", value: row.requestedBy || "Solicitante", date: row.requiredDate || row.createdAt || "—" },
    row.adminReviewed ? { label: "Revisión administrativa", value: row.adminComment || row.overspendReason || "Expediente revisado", date: row.adminReviewedAt || "—" } : { label: "Revisión administrativa", value: "Pendiente", date: "—" },
    row.readyForApprovalAt ? { label: "Enviado a autorización", value: "Listo para autorización", date: row.readyForApprovalAt } : null,
    row.authorizedAt ? { label: "Autorizado", value: row.authorizedBy || "Dirección", date: row.authorizedAt } : null,
    row.scheduledDate ? { label: "Programado", value: row.paymentBank || "Banco por definir", date: row.scheduledDate } : null,
    row.paidAt ? { label: "Pagado", value: row.paymentReference || "Referencia pendiente", date: row.paidAt } : null,
  ].filter(Boolean);
  return <div style={{ position: "fixed", inset: 0, zIndex: 2147483640, pointerEvents: "none" }}>
    <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.18)", backdropFilter: "blur(2px)", pointerEvents: "auto" }} onClick={onClose} />
    <aside style={{ position: "absolute", right: 18, top: 18, bottom: 18, width: "min(760px, calc(100vw - 36px))", background: "rgba(255,255,255,0.98)", border: `1px solid ${c.border}`, borderRadius: 28, boxShadow: "0 24px 80px rgba(0,0,0,.18)", overflow: "hidden", pointerEvents: "auto", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <header style={{ padding: 20, borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div><Pill tone="primary">Expediente de pago</Pill><h2 style={{ margin: "10px 0 4px", fontSize: 23, letterSpacing: -.4 }}>{row.concept}</h2><div style={{ color: c.muted, fontSize: 13 }}>{projectMap[row.projectId]?.name || row.projectId} · {supplierDisplayName(row, data)} · {money(total)}</div></div>
        <button onClick={onClose} style={{ border: 0, background: c.soft, borderRadius: 14, width: 40, height: 40, cursor: "pointer", fontWeight: 950 }}>×</button>
      </header>
      <main style={{ padding: 20, overflow: "auto", display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone={supplierReady(supplier) ? "ok" : "danger"}>Proveedor</Pill><b style={{ display: "block", marginTop: 8 }}>{supplier?.tradeName || row.supplier || "Proveedor"}</b><small style={{ color: c.muted }}>{supplier?.rfc || "RFC pendiente"} · {supplier?.status || "Sin estatus"}</small></Card>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone={budget.hasBudget && !budget.over ? "ok" : budget.over ? "danger" : "warn"}>Presupuesto</Pill><b style={{ display: "block", marginTop: 8 }}>{budget.hasBudget ? money(budget.budget) : "Sin presupuesto"}</b><small style={{ color: budget.over ? c.red : c.muted }}>Disponible antes: {money(budget.available)}{budget.over ? ` · Sobregiro ${money(budget.overspend)}` : ""}</small></Card>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone={contract ? (contractInfo.over ? "danger" : "ok") : "warn"}>Contrato</Pill><b style={{ display: "block", marginTop: 8 }}>{contract?.name || "Sin contrato ligado"}</b><small style={{ color: c.muted }}>{contract ? `Total ${money(contract.amount)} · saldo ${money(contractInfo.remaining)}` : "Pago sin techo contractual"}</small></Card>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone={attachmentCount(row.attachments) ? "ok" : "warn"}>Anexos</Pill><b style={{ display: "block", marginTop: 8 }}>{attachmentCount(row.attachments)} archivo(s)</b><small style={{ color: c.muted }}>{row.attachmentTypes || "Sin clasificación"}</small></Card>
        </div>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Documentos y anexos" helper="Factura, XML, contrato, cotización, carátula bancaria, comprobantes y soporte." /><AttachmentViewer value={row.attachments} /></Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Contexto administrativo" helper="La autorización final debe recibir el expediente completo, no datos sueltos." />
          <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
            <div><b>Partida:</b> {categoryMap[row.categoryId]?.name || row.categoryId}</div>
            <div><b>Etapa:</b> {row.paymentStage || "Pago"}</div>
            <div><b>Comentario administrativo:</b> {row.adminComment || row.overspendReason || row.notes || "Sin comentario"}</div>
            <div><b>Estatus:</b> <Pill tone={statusTone(row.status)}>{row.status}</Pill></div>
          </div>
        </Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Historial / log" helper="Rastro de quién hizo qué y cuándo dentro del flujo." />
          <div style={{ display: "grid", gap: 8 }}>{log.map((x, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10, padding: 10, borderRadius: 14, background: c.soft }}><b>{x.label}</b><span>{x.value}<br/><small style={{ color: c.muted }}>{x.date}</small></span></div>)}</div>
        </Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Pagos o solicitudes similares" helper="Ayuda a detectar duplicados, pagos recurrentes o montos fuera de patrón." />
          {relatedPayments.length ? <MiniTable columns={[{ key: "concept", label: "Concepto" }, { key: "supplier", label: "Proveedor", render: (r) => supplierDisplayName(r, data) }, { key: "amount", label: "Total", render: (r) => money(payableTotal(r)) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }]} rows={relatedPayments} /> : <div style={{ color: c.muted }}>No se encontraron pagos similares.</div>}
          {paymentsMade.length ? <div style={{ marginTop: 10, color: c.muted, fontSize: 12 }}>Pagos realizados relacionados: {paymentsMade.map((p) => `${money(p.amount)} ${p.reference || ""}`).join(" · ")}</div> : null}
        </Card>
      </main>
      <footer style={{ padding: 16, borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <Button variant="secondary" onClick={onClose}>Cerrar expediente</Button>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{canAuthorizeFinal && onCorrection ? <Button variant="secondary" onClick={() => onCorrection(row)}>Solicitar corrección</Button> : null}{canAuthorizeFinal && onReject ? <Button variant="danger" onClick={() => onReject(row)}>Rechazar</Button> : null}{canAuthorizeFinal && onAuthorize ? <Button onClick={() => onAuthorize(row)}>Autorizar</Button> : onAuthorize ? <Pill tone="warn">Solo master autoriza</Pill> : null}</div>
      </footer>
    </aside>
  </div>;
}

function EntityLink({ children, onClick, title }) {
  return <button type="button" title={title || "Ver detalle"} onClick={onClick} style={{ border: 0, background: "transparent", padding: 0, margin: 0, color: c.primary, fontWeight: 950, cursor: "pointer", textAlign: "left", textDecoration: "underline", textDecorationThickness: 1, textUnderlineOffset: 3 }}>{children}</button>;
}

function useSyncedDraft(record) {
  const [draft, setDraft] = useState(record || {});
  useEffect(() => {
    setDraft(record ? { ...record } : {});
  }, [record?.id]);
  return [draft, setDraft];
}

function changeSummary(before = {}, after = {}, labels = {}) {
  const skip = new Set(["communicationLog", "documents", "updatedAt", "reviewedBy"]);
  const fields = Object.keys(after || {}).filter((key) => !skip.has(key) && JSON.stringify(before?.[key] ?? "") !== JSON.stringify(after?.[key] ?? ""));
  if (!fields.length) return "Sin cambios críticos.";
  return fields.slice(0, 8).map((key) => labels[key] || key).join(", ") + (fields.length > 8 ? ` +${fields.length - 8}` : "");
}

function ValidationBanner({ title = "Controles ERP", checks = [] }) {
  const pending = checks.filter((check) => !check.ok);
  return <div style={{ border: `1px solid ${pending.length ? c.orange : c.border}`, borderRadius: 18, padding: 12, background: pending.length ? c.orangeSoft : c.greenSoft, display: "grid", gap: 8 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><b>{title}</b><Pill tone={pending.length ? "warn" : "ok"}>{pending.length ? `${pending.length} pendiente(s)` : "Sin riesgos"}</Pill></div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{checks.map((check) => <Pill key={check.label} tone={check.ok ? "ok" : "warn"}>{check.label}</Pill>)}</div>
  </div>;
}

function SupplierContextModal({ supplier, data, projectMap, categoryMap, onClose, onEdit }) {
  if (!supplier) return null;
  const relatedPayables = (data.payables || []).filter((p) => p.supplierId === supplier.id);
  const relatedContracts = (data.financeContracts || []).filter((ct) => ct.supplierId === supplier.id);
  const relatedPayments = (data.payments || []).filter((pay) => relatedPayables.some((p) => p.id === pay.payableId));
  const totalRequested = relatedPayables.reduce((a, p) => a + payableTotal(p), 0);
  const totalPaid = relatedPayments.reduce((a, p) => a + Number(p.amount || 0), 0);
  const communicationLog = [
    ...(supplier.communicationLog || []),
    ...relatedPayables.map((pay) => ({ date: pay.requiredDate || pay.createdAt || todayIso(), channel: supplier.notifyEmail ? "Correo" : supplier.notifyWhatsapp ? "WhatsApp" : "Sistema", event: `Solicitud ${pay.status || "registrada"}`, detail: `${pay.concept} · ${money(payableTotal(pay))}` })),
    ...relatedPayments.map((pay) => ({ date: pay.date || pay.paidAt || todayIso(), channel: "Sistema", event: pay.reconciled ? "Pago conciliado" : "Pago registrado", detail: `${pay.reference || "Sin referencia"} · ${money(pay.amount)}` })),
  ].slice(-10).reverse();
  return <div style={{ position: "fixed", inset: 0, zIndex: 2147483641, pointerEvents: "none" }}>
    <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.14)", backdropFilter: "blur(2px)", pointerEvents: "auto" }} onClick={onClose} />
    <aside style={{ position: "absolute", right: 18, top: 18, bottom: 18, width: "min(760px, calc(100vw - 36px))", background: "rgba(255,255,255,0.99)", border: `1px solid ${c.border}`, borderRadius: 28, boxShadow: "0 24px 80px rgba(0,0,0,.18)", overflow: "hidden", pointerEvents: "auto", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <header style={{ padding: 20, borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div><Pill tone={supplierReady(supplier) ? "ok" : supplier.status === "Bloqueado" ? "danger" : "warn"}>Proveedor</Pill><h2 style={{ margin: "10px 0 4px", fontSize: 23, letterSpacing: -.4 }}>{supplier.tradeName}</h2><div style={{ color: c.muted, fontSize: 13 }}>{supplier.legalName} · {supplier.rfc || "RFC pendiente"}</div></div>
        <button onClick={onClose} style={{ border: 0, background: c.soft, borderRadius: 14, width: 40, height: 40, cursor: "pointer", fontWeight: 950 }}>×</button>
      </header>
      <main style={{ padding: 20, overflow: "auto", display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone={supplier.status === "Activo" ? "ok" : supplier.status === "Bloqueado" ? "danger" : "warn"}>Estatus</Pill><b style={{ display: "block", marginTop: 8 }}>{supplier.status}</b><small style={{ color: c.muted }}>{supplier.type || "Tipo pendiente"}</small></Card>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone={supplier.fiscalStatus === "Validado" ? "ok" : "warn"}>Fiscal</Pill><b style={{ display: "block", marginTop: 8 }}>{supplier.fiscalStatus || "Pendiente"}</b><small style={{ color: c.muted }}>{supplier.email || "correo pendiente"}</small></Card>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone={supplier.bankStatus === "Validado" || supplier.bankStatus === "No aplica" ? "ok" : "warn"}>Banco</Pill><b style={{ display: "block", marginTop: 8 }}>{supplier.bankStatus || "Pendiente"}</b><small style={{ color: c.muted }}>{supplier.bank || "Banco pendiente"} · {supplier.clabe || "CLABE pendiente"}</small></Card>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone="primary">Histórico</Pill><b style={{ display: "block", marginTop: 8 }}>{money(totalPaid)}</b><small style={{ color: c.muted }}>Solicitado {money(totalRequested)}</small></Card>
        </div>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Canales de aviso al proveedor" helper="Estos datos se usan para avisos de solicitud, programación, pago y observaciones. El envío real por correo/WhatsApp requiere integración posterior, pero el expediente ya deja el canal y el log." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}>
            <div><b>Correo</b><div style={{ color: c.muted, fontSize: 13 }}>{supplier.email || "Sin correo"}</div><Pill tone={supplier.notifyEmail ? "ok" : "idle"}>{supplier.notifyEmail ? "Avisos activos" : "Sin aviso"}</Pill></div>
            <div><b>WhatsApp</b><div style={{ color: c.muted, fontSize: 13 }}>{supplier.whatsapp || supplier.phone || "Sin WhatsApp"}</div><Pill tone={supplier.notifyWhatsapp ? "ok" : "idle"}>{supplier.notifyWhatsapp ? "Avisos activos" : "Sin aviso"}</Pill></div>
            <div><b>Eventos</b><div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>{supplier.notifyOnRequested ? <Pill tone="primary">Solicitud</Pill> : null}{supplier.notifyOnScheduled ? <Pill tone="primary">Programación</Pill> : null}{supplier.notifyOnPaid ? <Pill tone="primary">Pago</Pill> : null}</div></div>
          </div>
        </Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Documentos del proveedor" helper="Constancia fiscal, carátula bancaria, contrato marco, opinión de cumplimiento y soportes." /><AttachmentViewer value={supplier.documents} /></Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Contratos ligados" helper="Techo autorizado, pagos parciales, anticipos y saldos." />{relatedContracts.length ? <MiniTable columns={[{ key: "name", label: "Contrato" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "amount", label: "Monto", render: (r) => money(r.amount) }, { key: "status", label: "Estatus", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }]} rows={relatedContracts} /> : <div style={{ color: c.muted }}>Sin contratos ligados.</div>}</Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Solicitudes y pagos anteriores" helper="Contexto para detectar duplicados, recurrencias o patrones fuera de operación." />{relatedPayables.length ? <MiniTable columns={[{ key: "concept", label: "Concepto" }, { key: "categoryId", label: "Partida", render: (r) => categoryMap[r.categoryId]?.name || r.categoryId }, { key: "amount", label: "Total", render: (r) => money(payableTotal(r)) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }]} rows={relatedPayables} /> : <div style={{ color: c.muted }}>Sin solicitudes registradas.</div>}</Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Log de proveedor" helper="Historial de avisos, solicitudes y pagos relacionados para contexto operativo." />{communicationLog.length ? <div style={{ display: "grid", gap: 8 }}>{communicationLog.map((item, idx) => <div key={idx} style={{ padding: 10, border: `1px solid ${c.border}`, borderRadius: 14, background: c.soft }}><div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><b>{item.event}</b><Pill tone="idle">{item.channel}</Pill></div><div style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>{item.date} · {item.detail}</div></div>)}</div> : <div style={{ color: c.muted }}>Sin actividad registrada.</div>}</Card>
      </main>
      <footer style={{ padding: 16, borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><Button variant="secondary" onClick={onClose}>Cerrar</Button>{onEdit ? <Button onClick={() => onEdit(supplier)}>Editar proveedor</Button> : null}</footer>
    </aside>
  </div>;
}


function SupplierEditModal({ supplier, data, categoryMap, onClose, onSave }) {
  const [draft, setDraft] = useSyncedDraft(supplier);
  if (!supplier) return null;
  const notificationEvents = [
    { key: "notifyOnRequested", label: "Solicitud recibida" },
    { key: "notifyOnScheduled", label: "Pago programado" },
    { key: "notifyOnPaid", label: "Pago realizado" },
  ];
  const addLog = (channel, event, detail) => {
    const item = { date: todayIso(), channel, event, detail };
    setDraft((current) => ({ ...current, communicationLog: [item, ...(current.communicationLog || [])] }));
  };
  return <div style={{ position: "fixed", inset: 0, zIndex: 2147483643, pointerEvents: "none" }}>
    <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.16)", backdropFilter: "blur(2px)", pointerEvents: "auto" }} onClick={onClose} />
    <aside style={{ position: "absolute", right: 18, top: 18, bottom: 18, width: "min(780px, calc(100vw - 36px))", background: "rgba(255,255,255,0.99)", border: `1px solid ${c.border}`, borderRadius: 28, boxShadow: "0 24px 80px rgba(0,0,0,.18)", overflow: "hidden", pointerEvents: "auto", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <header style={{ padding: 20, borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div><Pill tone="primary">Editar proveedor</Pill><h2 style={{ margin: "10px 0 4px", fontSize: 22 }}>Ficha 360 del proveedor</h2><div style={{ color: c.muted, fontSize: 13 }}>Datos fiscales, bancarios, documentación, avisos y log de comunicación.</div></div>
        <button onClick={onClose} style={{ border: 0, background: c.soft, borderRadius: 14, width: 40, height: 40, cursor: "pointer", fontWeight: 950 }}>×</button>
      </header>
      <main style={{ padding: 20, overflow: "auto", display: "grid", gap: 14 }}>
        <ValidationBanner title="Validación del proveedor antes de poder pagar" checks={[{ label: "Datos fiscales", ok: !!draft.rfc && !!draft.legalName }, { label: "Correo de pagos", ok: !!draft.email }, { label: "Banco/CLABE", ok: draft.bankStatus === "No aplica" || (!!draft.bank && !!draft.clabe) }, { label: "Documentos", ok: attachmentCount(draft.documents) > 0 }, { label: "Estatus activo", ok: draft.status === "Activo" }]} />
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Datos generales" helper="Esta información aparece en solicitudes, contratos, autorizaciones y pagos históricos." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
            <Field label="Nombre comercial"><input style={inputStyle()} value={draft.tradeName || ""} onChange={(e) => setDraft({ ...draft, tradeName: e.target.value })} /></Field>
            <Field label="Razón social"><input style={inputStyle()} value={draft.legalName || ""} onChange={(e) => setDraft({ ...draft, legalName: e.target.value })} /></Field>
            <Field label="RFC"><input style={inputStyle()} value={draft.rfc || ""} onChange={(e) => setDraft({ ...draft, rfc: e.target.value.toUpperCase() })} /></Field>
            <Field label="Tipo"><select style={inputStyle()} value={draft.type || "Proveedor"} onChange={(e) => setDraft({ ...draft, type: e.target.value })}><option>Constructora</option><option>Servicios profesionales</option><option>Materiales</option><option>Dependencia</option><option>Arrendador</option><option>Proveedor</option></select></Field>
            <Field label="Persona fiscal"><select style={inputStyle()} value={draft.taxpayerType || "Persona moral"} onChange={(e) => { const profile = taxProfileForSupplier({ taxpayerType: e.target.value }); setDraft({ ...draft, taxpayerType: e.target.value, ivaRate: profile.ivaRate, isrRetentionRate: profile.isrRetentionRate, ivaRetentionRate: profile.ivaRetentionRate, taxProfileCustomized: false }); }}>{TAXPAYER_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Contacto"><input style={inputStyle()} value={draft.contact || ""} onChange={(e) => setDraft({ ...draft, contact: e.target.value })} /></Field>
            <Field label="Categoría default"><select style={inputStyle()} value={draft.categoryId || "construccion"} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>{data.categories.filter((cat) => cat.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field>
            <Field label="Requiere contrato"><select style={inputStyle()} value={draft.requiresContract ? "Sí" : "No"} onChange={(e) => setDraft({ ...draft, requiresContract: e.target.value === "Sí" })}><option>No</option><option>Sí</option></select></Field>
            <Field label="Estatus"><select style={inputStyle()} value={draft.status || "Pendiente revisión"} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option>Pendiente revisión</option><option>Activo</option><option>Bloqueado</option><option>Inactivo</option></select></Field>
          </div>
        </Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Contacto y avisos" helper="El proveedor podrá recibir avisos por correo o WhatsApp cuando haya cambios en sus pagos. El envío automático se conectará a un servicio de correo/WhatsApp; por ahora queda configurado y registrado en el log." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
            <Field label="Correo de pagos"><input type="email" style={inputStyle()} value={draft.email || ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
            <Field label="Teléfono"><input style={inputStyle()} value={draft.phone || ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></Field>
            <Field label="WhatsApp"><input style={inputStyle()} placeholder="521999..." value={draft.whatsapp || ""} onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value })} /></Field>
            <Field label="Avisar por correo"><select style={inputStyle()} value={draft.notifyEmail ? "Sí" : "No"} onChange={(e) => setDraft({ ...draft, notifyEmail: e.target.value === "Sí" })}><option>Sí</option><option>No</option></select></Field>
            <Field label="Avisar por WhatsApp"><select style={inputStyle()} value={draft.notifyWhatsapp ? "Sí" : "No"} onChange={(e) => setDraft({ ...draft, notifyWhatsapp: e.target.value === "Sí" })}><option>No</option><option>Sí</option></select></Field>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>{notificationEvents.map((ev) => <label key={ev.key} style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${c.border}`, borderRadius: 999, padding: "8px 10px", fontSize: 12, fontWeight: 900 }}><input type="checkbox" checked={!!draft[ev.key]} onChange={(e) => setDraft({ ...draft, [ev.key]: e.target.checked })} />{ev.label}</label>)}</div>
        </Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Datos bancarios y fiscales" helper="No se debe pagar si banco/fiscal no están validados, salvo dependencia o excepción controlada." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
            <Field label="Banco"><input style={inputStyle()} value={draft.bank || ""} onChange={(e) => setDraft({ ...draft, bank: e.target.value })} /></Field>
            <Field label="CLABE"><input style={inputStyle()} value={draft.clabe || ""} onChange={(e) => setDraft({ ...draft, clabe: e.target.value })} /></Field>
            <Field label="Beneficiario"><input style={inputStyle()} value={draft.accountHolder || draft.legalName || ""} onChange={(e) => setDraft({ ...draft, accountHolder: e.target.value })} /></Field>
            <Field label="Validación fiscal"><select style={inputStyle()} value={draft.fiscalStatus || "Pendiente"} onChange={(e) => setDraft({ ...draft, fiscalStatus: e.target.value })}>{["Pendiente", "Validado", "Observado", "No aplica"].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Validación bancaria"><select style={inputStyle()} value={draft.bankStatus || "Pendiente"} onChange={(e) => setDraft({ ...draft, bankStatus: e.target.value })}>{["Pendiente", "Validado", "Observado", "No aplica"].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="IVA %"><input type="number" step="0.0001" style={inputStyle()} value={draft.ivaRate ?? 0.16} onChange={(e) => setDraft({ ...draft, ivaRate: Number(e.target.value || 0), taxProfileCustomized: true })} /></Field>
            <Field label="ISR retenido %"><input type="number" step="0.0001" style={inputStyle()} value={draft.isrRetentionRate ?? taxProfileForSupplier(draft).isrRetentionRate} onChange={(e) => setDraft({ ...draft, isrRetentionRate: Number(e.target.value || 0), taxProfileCustomized: true })} /></Field>
            <Field label="IVA retenido %"><input type="number" step="0.0001" style={inputStyle()} value={draft.ivaRetentionRate ?? taxProfileForSupplier(draft).ivaRetentionRate} onChange={(e) => setDraft({ ...draft, ivaRetentionRate: Number(e.target.value || 0), taxProfileCustomized: true })} /></Field>
          </div>
        </Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Documentación del proveedor" helper="Agrega o reemplaza constancia fiscal, carátula bancaria, opinión de cumplimiento, contratos marco u otros soportes." /><AttachmentUploader label="Subir documentos del proveedor" value={draft.documents} folder="finanzas/proveedores" onChange={(documents) => setDraft({ ...draft, documents })} /></Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Notas internas y log" helper="Útil para auditoría y para entender lo que ha pasado con el proveedor." /><Field label="Notas internas"><textarea style={inputStyle({ minHeight: 76 })} value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}><Button variant="secondary" onClick={() => addLog("Correo", "Aviso registrado", "Se registró aviso por correo al proveedor.")}>Registrar aviso correo</Button><Button variant="secondary" onClick={() => addLog("WhatsApp", "Aviso registrado", "Se registró aviso por WhatsApp al proveedor.")}>Registrar aviso WhatsApp</Button></div>
          {(draft.communicationLog || []).length ? <div style={{ display: "grid", gap: 8, marginTop: 12 }}>{(draft.communicationLog || []).slice(0, 5).map((item, idx) => <div key={idx} style={{ padding: 10, borderRadius: 14, background: c.soft, border: `1px solid ${c.border}` }}><b>{item.event}</b><div style={{ color: c.muted, fontSize: 12 }}>{item.date} · {item.channel} · {item.detail}</div></div>)}</div> : <div style={{ color: c.muted, fontSize: 13, marginTop: 10 }}>Sin log todavía.</div>}
        </Card>
      </main>
      <footer style={{ padding: 16, borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => {
        const detail = changeSummary(supplier, draft, { tradeName: "nombre comercial", legalName: "razón social", rfc: "RFC", email: "correo", whatsapp: "WhatsApp", bank: "banco", clabe: "CLABE", bankStatus: "validación bancaria", fiscalStatus: "validación fiscal", status: "estatus" });
        const auditItem = { date: todayIso(), channel: "Sistema", event: "Proveedor actualizado", detail };
        onSave({ ...supplier, ...draft, communicationLog: [auditItem, ...(draft.communicationLog || supplier.communicationLog || [])], updatedAt: todayIso(), reviewedBy: draft.status === "Activo" ? "admin@tritondesarrollos.com" : draft.reviewedBy });
      }}>Guardar proveedor</Button></footer>
    </aside>
  </div>;
}

function PaymentEditModal({ row, data, onClose, onSave }) {
  const [draft, setDraft] = useSyncedDraft(row);
  if (!row) return null;
  const supplier = data.suppliers.find((s) => s.id === draft.supplierId) || data.suppliers[0];
  const activeContracts = (data.financeContracts || []).filter((ct) => !draft.supplierId || ct.supplierId === draft.supplierId);
  function patchAmount(value, mode) {
    setDraft({ ...draft, ...calcTaxValues(value, supplier, mode) });
  }
  function applyXml(newFiles) {
    const xml = newFiles.find((a) => a.cfdi)?.cfdi;
    if (xml) setDraft({ ...draft, amount: xml.subtotal || draft.amount, iva: xml.iva || draft.iva, totalInput: xml.total || draft.totalInput });
  }
  return <div style={{ position: "fixed", inset: 0, zIndex: 2147483642, pointerEvents: "none" }}>
    <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.16)", backdropFilter: "blur(2px)", pointerEvents: "auto" }} onClick={onClose} />
    <aside style={{ position: "absolute", right: 18, top: 18, bottom: 18, width: "min(680px, calc(100vw - 36px))", background: "rgba(255,255,255,0.99)", border: `1px solid ${c.border}`, borderRadius: 28, boxShadow: "0 24px 80px rgba(0,0,0,.18)", overflow: "hidden", pointerEvents: "auto", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <header style={{ padding: 20, borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 12 }}><div><Pill tone="primary">Editar solicitud</Pill><h2 style={{ margin: "10px 0 4px", fontSize: 22 }}>Datos del pago</h2><div style={{ color: c.muted, fontSize: 13 }}>Los cambios quedan en el expediente para revisión administrativa.</div></div><button onClick={onClose} style={{ border: 0, background: c.soft, borderRadius: 14, width: 40, height: 40, cursor: "pointer", fontWeight: 950 }}>×</button></header>
      <main style={{ padding: 20, overflow: "auto", display: "grid", gap: 12 }}>
        <ValidationBanner title="Validación antes de enviar a autorización" checks={[{ label: "Proveedor activo", ok: supplierReady(data.suppliers.find((s) => s.id === draft.supplierId)) }, { label: "Presupuesto", ok: budgetCheck(data, draft).hasBudget }, { label: "Sin sobregiro o justificado", ok: !budgetCheck(data, draft).over || draft.overspendApprovedByAdmin }, { label: "Anexos", ok: attachmentCount(draft.attachments) > 0 }, { label: "Revisión admin", ok: !!draft.adminReviewed }]} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
          <Field label="Proyecto"><select style={inputStyle()} value={draft.projectId || ""} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Proveedor"><SearchableSupplierSelect data={data} value={draft.supplierId || ""} onChange={(s) => setDraft({ ...draft, supplierId: s.id, supplier: s.tradeName, categoryId: s.categoryId || draft.categoryId, ...calcTaxValues(draft.amount || 0, s, "base") })} /></Field>
          <Field label="Partida"><select style={inputStyle()} value={draft.categoryId || supplier?.categoryId || "construccion"} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>{data.categories.filter((cat) => cat.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field>
          <Field label="Contrato"><select style={inputStyle()} value={draft.contractId || ""} onChange={(e) => setDraft({ ...draft, contractId: e.target.value })}><option value="">Sin contrato</option>{activeContracts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}</select></Field>
          <Field label="Etapa"><select style={inputStyle()} value={draft.paymentStage || "Pago parcial"} onChange={(e) => setDraft({ ...draft, paymentStage: e.target.value })}><option>Anticipo</option><option>Pago parcial</option><option>Estimación</option><option>Saldo</option><option>Recurrente</option><option>Reembolso</option></select></Field>
          <Field label="Monto antes IVA"><input type="number" style={inputStyle()} value={draft.amount || ""} onChange={(e) => patchAmount(e.target.value, "base")} /></Field>
          <Field label="Monto total a pagar"><input type="number" style={inputStyle()} value={draft.totalInput || payableTotal(draft)} onChange={(e) => patchAmount(e.target.value, "total")} /></Field>
          <Field label="IVA"><input type="number" style={inputStyle()} value={draft.iva || ""} onChange={(e) => setDraft({ ...draft, iva: Number(e.target.value || 0) })} /></Field>
          <Field label="Retención"><input type="number" style={inputStyle()} value={draft.retention || ""} onChange={(e) => setDraft({ ...draft, retention: Number(e.target.value || 0) })} /></Field>
          <Field label="Fecha requerida"><input type="date" style={inputStyle()} value={draft.requiredDate || todayIso()} onChange={(e) => setDraft({ ...draft, requiredDate: e.target.value })} /></Field>
        </div>
        <Field label="Concepto"><input style={inputStyle()} value={draft.concept || ""} onChange={(e) => setDraft({ ...draft, concept: e.target.value })} /></Field>
        <Field label="Comentario administrativo / notas"><textarea style={inputStyle({ minHeight: 84 })} value={draft.adminComment || draft.notes || ""} onChange={(e) => setDraft({ ...draft, adminComment: e.target.value, notes: e.target.value })} /></Field>
        <AttachmentUploader label="Anexos de la solicitud" value={draft.attachments} folder="finanzas/solicitudes-pago" onChange={(attachments) => setDraft({ ...draft, attachments })} onFilesUploaded={applyXml} />
      </main>
      <footer style={{ padding: 16, borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => { const auditItem = { date: todayIso(), channel: "Sistema", event: "Solicitud actualizada", detail: changeSummary(row, draft, { supplierId: "proveedor", projectId: "proyecto", categoryId: "partida", amount: "monto", iva: "IVA", retention: "retención", requiredDate: "fecha requerida", attachments: "anexos" }) }; onSave({ ...row, ...draft, auditLog: [auditItem, ...(draft.auditLog || row.auditLog || [])], updatedAt: todayIso() }); }}>Guardar cambios</Button></footer>
    </aside>
  </div>;
}




const firebaseConfig = {
  apiKey: "AIzaSyBzk_jZfpv4j7PxroeTISwx11LffEB3TWQ",
  authDomain: "control-de-calidad-triton.firebaseapp.com",
  projectId: "control-de-calidad-triton",
  storageBucket: "control-de-calidad-triton.firebasestorage.app",
  messagingSenderId: "41329486719",
  appId: "1:41329486719:web:1bf7ff827d3b60227f084a",
};

const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const firestore = getFirestore(firebaseApp);
const firebaseAuth = getAuth(firebaseApp);
const firebaseStorage = getStorage(firebaseApp);

const launchUsers = [
  {
    id: "rodrigo@tritondesarrollos.com",
    uid: "rodrigo@tritondesarrollos.com",
    email: "rodrigo@tritondesarrollos.com",
    name: "Rodrigo Herrera",
    role: "master",
    permissions: "Acceso total",
    mentionHandle: "rodrigo",
    active: true,
    modules: { dashboard: true, operacion: true, finanzas: true, cobranza: true, reportes: true, configuracion: true },
  },
  {
    id: "admin@tritondesarrollos.com",
    uid: "admin@tritondesarrollos.com",
    email: "admin@tritondesarrollos.com",
    name: "Administración Triton",
    role: "finanzas_pagos",
    permissions: "Finanzas, proveedores, pagos, caja chica y reportes",
    mentionHandle: "admin",
    active: true,
    modules: { dashboard: true, operacion: false, finanzas: true, cobranza: false, reportes: true, configuracion: false },
  },
  {
    id: "supervision@tritondesarrollos.com",
    uid: "supervision@tritondesarrollos.com",
    email: "supervision@tritondesarrollos.com",
    name: "Supervisión Triton",
    role: "supervisora",
    permissions: "Obra, calidad, estimaciones, trámites y equipo construcción",
    mentionHandle: "supervision",
    active: true,
    modules: { dashboard: true, operacion: true, finanzas: false, cobranza: false, reportes: true, configuracion: false },
  },
];

const legacyDemoUserIds = [
  "constructora@triton.local",
  "residente@triton.local",
  "supervision@triton.local",
  "admin@triton.local",
  "master-rodrigo",
  "finanzas-admin",
  "supervision-calidad",
  "demo-constructora",
  "demo-residente",
  "demo-supervision",
  "demo-admin",
];

const c = {
  text: "#242322",
  muted: "#6B6862",
  border: "rgba(88,84,76,0.16)",
  soft: "#F6F3EE",
  warmSoft: "#F3EEE4",
  card: "rgba(255,255,255,0.94)",
  primary: "#F5B21A",
  primaryDark: "#8A6400",
  primarySoft: "rgba(245,178,26,0.14)",
  green: "#F5B21A",
  greenSoft: "rgba(245,178,26,0.14)",
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
    { id: "p1", projectId: "arenna", supplierId: "sup-mun", supplier: "MUNICIPIO DE MÉRIDA", concept: "Derecho de factibilidad de uso de suelo", categoryId: "tramites", amount: 519, iva: 0, requestedBy: "Residente", requiredDate: todayIso(), status: "Solicitado", priority: "Alta", documentStatus: "Soporte cargado", notes: "Base importada del control de gastos." },
    { id: "p2", projectId: "arenna", supplierId: "sup-cons", supplier: "Constructora", concept: "Estimación de obra", categoryId: "construccion", amount: 3400000, iva: 0, requestedBy: "Obra", requiredDate: todayIso(), status: "En revisión", priority: "Alta", documentStatus: "Pendiente factura", notes: "Debe relacionarse con estimaciones." },
    { id: "p3", projectId: "residente", supplierId: "sup-arq", supplier: "Despacho arquitectónico", concept: "Anteproyecto y coordinación", categoryId: "proyecto", amount: 180000, iva: 28800, requestedBy: "Dirección", requiredDate: todayIso(), status: "Autorizado", priority: "Media", documentStatus: "Factura OK", notes: "Pago programable." },
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
  clients: [
    { id: "cli1", name: "Cliente Demo Arenna", type: "Comprador", email: "cliente@demo.mx", phone: "9990001000", projectId: "arenna", unit: "TH01", contractRef: "CV-TH01", status: "Activo" },
    { id: "cli2", name: "Inversionista Residente", type: "Comprador", email: "inversionista@demo.mx", phone: "9990002000", projectId: "residente", unit: "Depto 101", contractRef: "CV-D101", status: "Activo" },
  ],
  incomes: [
    { id: "inc1", projectId: "arenna", clientId: "cli1", type: "Enganche", concept: "Enganche TH01", amount: 450000, date: todayIso(), unit: "TH01", contractRef: "CV-TH01", status: "Recibido", bank: "VEPORMAS", reference: "ING-DEMO-01", attachments: [] },
    { id: "inc2", projectId: "residente", clientId: "cli2", type: "Apartado", concept: "Apartado Depto 101", amount: 50000, date: todayIso(), unit: "Depto 101", contractRef: "CV-D101", status: "Pendiente conciliación", bank: "VEPORMAS", reference: "ING-DEMO-02", attachments: [] },
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
  suppliers: [
    { id: "sup-arq", tradeName: "Despacho Arquitectónico", legalName: "Despacho Arquitectónico Demo S.A. de C.V.", rfc: "DAD260101XXX", type: "Servicios profesionales", taxpayerType: "Persona física", contact: "Coordinación", email: "facturacion@despacho.demo", phone: "9990000001", whatsapp: "5219990000001", status: "Activo", fiscalStatus: "Validado", bankStatus: "Validado", bank: "BBVA", clabe: "012180000000000000", accountHolder: "Despacho Arquitectónico Demo S.A. de C.V.", categoryId: "proyecto", requiresContract: true, notifyEmail: true, notifyWhatsapp: true, notifyOnRequested: true, notifyOnScheduled: true, notifyOnPaid: true, documents: [{ name: "Constancia fiscal", source: "manual" }, { name: "Carátula bancaria", source: "manual" }, { name: "Contrato marco", source: "manual" }], notes: "Proveedor demo validado para pruebas.", communicationLog: [{ date: todayIso(), channel: "Correo", event: "Alta de proveedor", detail: "Proveedor registrado y validado." }] },
    { id: "sup-cons", tradeName: "Constructora Base", legalName: "Constructora Base S.A. de C.V.", rfc: "CBA260101XXX", type: "Constructora", taxpayerType: "Persona moral", contact: "Residente externo", email: "pagos@constructora.demo", phone: "9990000002", whatsapp: "5219990000002", status: "Pendiente revisión", fiscalStatus: "Pendiente", bankStatus: "Pendiente", bank: "", clabe: "", accountHolder: "Constructora Base S.A. de C.V.", categoryId: "construccion", requiresContract: true, notifyEmail: true, notifyWhatsapp: false, notifyOnRequested: true, notifyOnScheduled: true, notifyOnPaid: true, documents: [{ name: "Contrato pendiente", source: "manual" }], notes: "Pendiente validación fiscal y bancaria.", communicationLog: [] },
    { id: "sup-mun", tradeName: "Municipio de Mérida", legalName: "Municipio de Mérida", rfc: "MMM000000XXX", type: "Dependencia", contact: "Ventanilla", email: "", phone: "", whatsapp: "", status: "Activo", fiscalStatus: "Validado", bankStatus: "No aplica", bank: "", clabe: "", accountHolder: "Municipio de Mérida", categoryId: "tramites", requiresContract: false, notifyEmail: false, notifyWhatsapp: false, notifyOnRequested: false, notifyOnScheduled: false, notifyOnPaid: false, documents: [{ name: "Recibo oficial", source: "manual" }], notes: "Dependencia / pago oficial.", communicationLog: [] },
  ],
  financeContracts: [
    { id: "fc1", supplierId: "sup-arq", projectId: "residente", name: "Contrato anteproyecto Residente", amount: 580000, startDate: "2026-01-01", endDate: "2026-12-31", status: "Vigente", categoryId: "proyecto", paymentPlan: "Anticipo 30%, avance 40%, saldo 30%", documents: ["Contrato firmado PDF"] },
    { id: "fc2", supplierId: "sup-cons", projectId: "arenna", name: "Contrato obra Arenna", amount: 60710338, startDate: "2026-01-01", endDate: "2026-12-31", status: "Pendiente firma", categoryId: "construccion", paymentPlan: "Estimaciones contra avance autorizado", documents: ["Borrador contrato"] },
  ],
  recurringPayments: [
    { id: "rec1", supplierId: "sup-arq", projectId: "residente", categoryId: "proyecto", concept: "Honorarios mensuales coordinación", amount: 45000, iva: 7200, retention: 0, frequency: "Mensual", day: 5, status: "Activo", authorizedBy: "rodrigo@tritondesarrollos.com", requiresInvoice: true, nextDate: todayIso(), notes: "Autorización base recurrente; cada cargo requiere factura/comprobante." },
    { id: "rec2", supplierId: "sup-mun", projectId: "arenna", categoryId: "tramites", concept: "Pagos oficiales recurrentes / derechos", amount: 15000, iva: 0, retention: 0, frequency: "Variable", day: 15, status: "Activo", authorizedBy: "rodrigo@tritondesarrollos.com", requiresInvoice: false, nextDate: todayIso(), notes: "Se genera como solicitud autorizada base, pendiente de soporte oficial." },
  ],
  paymentDocuments: [
    { id: "doc1", payableId: "p3", type: "Factura PDF", fileName: "factura-demo.pdf", uploadedBy: "admin@tritondesarrollos.com", status: "Válido", uploadedAt: todayIso() },
    { id: "doc2", payableId: "p3", type: "XML", fileName: "factura-demo.xml", uploadedBy: "admin@tritondesarrollos.com", status: "Válido", uploadedAt: todayIso() },
  ],
  auditTrail: [
    { id: "audit1", module: "Cuentas por pagar", itemId: "p3", action: "Solicitud autorizada", user: "rodrigo@tritondesarrollos.com", date: todayIso(), comment: "Demo de bitácora ERP." },
  ],
  constructionTeam: [
    { id: "ct1", name: "Constructora Base", contact: "Encargado de obra", email: "constructora@tritondesarrollos.com", role: "constructora", projectId: "arenna", status: "Activo", createdBy: "supervision@tritondesarrollos.com" },
  ],
  users: launchUsers,
};

const moduleMeta = {
  dashboard: { title: "Reportes", subtitle: "Reportes ejecutivos, obra, finanzas, ingresos, egresos e IA", icon: "▤" },
  proyectos: { title: "Proyectos", subtitle: "Base para cruzar obra, pagos, rentas y trámites", icon: "⌂" },
  finanzas: { title: "Finanzas", subtitle: "Resumen ERP: presupuesto, proveedores, contratos, pagos y conciliación", icon: "$" },
  proveedores: { title: "Proveedores", subtitle: "Alta, documentos, validación fiscal y cuentas bancarias", icon: "◧" },
  presupuestos: { title: "Presupuestos", subtitle: "Partidas autorizadas por proyecto y control de sobregiros", icon: "▥" },
  contratos_financieros: { title: "Contratos", subtitle: "Monto total autorizado, anticipos, parciales y saldos", icon: "□" },
  pagos_recurrentes: { title: "Pagos recurrentes", subtitle: "Servicios, rentas y honorarios ya autorizados por base", icon: "↻" },
  cxp: { title: "Solicitudes de pago", subtitle: "Solicitud → revisión administrativa → autorización final → pago", icon: "↗" },
  autorizaciones: { title: "Autorizaciones", subtitle: "Última revisión con información completa para dirección", icon: "✓" },
  pagos_programados: { title: "Pagos programados", subtitle: "Tesorería y calendario de egresos", icon: "◷" },
  pagos_realizados: { title: "Pagos realizados", subtitle: "Comprobantes, referencias y bancos", icon: "▣" },
  conciliacion: { title: "Conciliación bancaria", subtitle: "Cruce contra movimientos bancarios", icon: "≋" },
  ingresos: { title: "Ingresos", subtitle: "Ingresos por proyecto, cliente, contrato y unidad", icon: "↙" },
  clientes: { title: "Clientes", subtitle: "Pagadores, compradores y contratos de compraventa", icon: "◧" },
  caja_chica: { title: "Caja chica", subtitle: "Fondos, comprobantes, liquidación y reposición", icon: "▣" },
  cobranza: { title: "Arrendamientos / Cobranza", subtitle: "Contratos, INPC, rentas mensuales, facturación y conciliación", icon: "↙" },
  arr_contratos: { title: "Arrendamientos / Contratos", subtitle: "Vigencias, INPC, cédulas y documentación", icon: "□" },
  arr_conciliacion: { title: "Arrendamientos / Conciliación", subtitle: "Cruce de pagos de renta contra banco", icon: "≋" },
  arr_facturacion: { title: "Arrendamientos / Facturación", subtitle: "Facturas mensuales y automatización", icon: "▣" },
  arr_reportes: { title: "Arrendamientos / Reportes", subtitle: "Cartera vencida, ocupación y rentas", icon: "▤" },
  tramites: { title: "Trámites", subtitle: "Permisos, dependencias, responsables y siguientes acciones", icon: "◷" },
  tramites_timeline: { title: "Trámites / Línea del tiempo", subtitle: "Avance por proyecto, etapa y estatus", icon: "◷" },
  tramites_expediente: { title: "Trámites / Expediente documental", subtitle: "Archivos, soportes y exportación PDF", icon: "▤" },
  equipo_obra: { title: "Equipo de construcción", subtitle: "Alta y baja de usuarios de constructoras por obra", icon: "👷" },
  reportes_os: { title: "Reportes", subtitle: "Reportes ejecutivos, obra, finanzas, ingresos, egresos e IA", icon: "▤" },
  reporte_obra: { title: "Reportes de obra", subtitle: "Calidad, estimaciones, pendientes y liberaciones", icon: "✓" },
  reporte_finanzas: { title: "Reportes financieros", subtitle: "Estado de resultados, presupuesto y flujo", icon: "$" },
  reporte_egresos: { title: "Reportes de egresos", subtitle: "Pagos, proveedores, caja chica y conciliaciones", icon: "↗" },
  reporte_ingresos: { title: "Reportes de ingresos", subtitle: "Clientes, contratos, unidades e ingresos", icon: "↙" },
  reporte_ia: { title: "IA / análisis cruzado", subtitle: "Lectura financiera vs avance de obra y recomendaciones", icon: "IA" },
  config_os: { title: "Configuración", subtitle: "Catálogos y reglas de operación", icon: "⚙" },
  usuarios_os: { title: "Usuarios", subtitle: "Permisos por módulo, rol y acción", icon: "👤" },
};

function readData() {
  try {
    const raw = localStorage.getItem("triton_os_v37") || localStorage.getItem("triton_os_v36") || localStorage.getItem("triton_os_v35") || localStorage.getItem("triton_os_v34") || localStorage.getItem("triton_os_v32");
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
    primary: { bg: c.primarySoft, color: "#8A6400" },
    purple: { bg: c.purpleSoft, color: c.purple },
    idle: { bg: c.soft, color: c.text },
  };
  const style = map[tone] || map.idle;
  return <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 999, padding: "5px 9px", fontSize: 12, fontWeight: 900, background: style.bg, color: style.color, whiteSpace: "nowrap" }}>{children}</span>;
}

function Card({ children, style, className }) {
  return <div className={className} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 24, padding: 18, boxShadow: "0 10px 30px rgba(0,0,0,0.04)", ...style }}>{children}</div>;
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
  const [sort, setSort] = useState({ key: "", direction: "asc" });
  const sortedRows = useMemo(() => {
    if (!sort.key) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    return [...rows].sort((a, b) => {
      const av = sortableValue(a, col);
      const bv = sortableValue(b, col);
      if (av < bv) return sort.direction === "asc" ? -1 : 1;
      if (av > bv) return sort.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, columns, sort.key, sort.direction]);
  function handleSort(col) {
    if (col.sortable === false) return;
    setSort((prev) => prev.key === col.key ? { key: col.key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key: col.key, direction: "asc" });
  }
  return <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 760 }}><thead><tr>{columns.map((col) => {
    const active = sort.key === col.key;
    return <th key={col.key} onClick={() => handleSort(col)} title={col.sortable === false ? "" : "Ordenar"} style={{ textAlign: "left", color: active ? c.primary : c.muted, fontSize: 12, padding: "10px 9px", borderBottom: `1px solid ${c.border}`, whiteSpace: "nowrap", cursor: col.sortable === false ? "default" : "pointer", userSelect: "none" }}>{col.label}{col.sortable === false ? null : <span style={{ marginLeft: 5, opacity: active ? 1 : .35 }}>{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span>}</th>;
  })}</tr></thead><tbody>{sortedRows.length ? sortedRows.map((row, idx) => <tr key={row.id || idx}>{columns.map((col) => <td key={col.key} style={{ padding: "12px 9px", borderBottom: `1px solid rgba(60,60,67,0.08)`, verticalAlign: "top", fontSize: 13, color: c.text }}>{typeof col.render === "function" ? col.render(row) : row[col.key]}</td>)}</tr>) : <tr><td colSpan={columns.length} style={{ padding: 18, color: c.muted, textAlign: "center" }}>{empty}</td></tr>}</tbody></table></div>;
}


export default function TritonOSModules() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("reportes_os");
  const [data, setData] = useState(readData);
  const [projectFilter, setProjectFilter] = useState("todos");
  const [showForm, setShowForm] = useState(null);
  const [form, setForm] = useState({});

  useEffect(() => { localStorage.setItem("triton_os_v37", JSON.stringify(data)); }, [data]);
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
  const modulesWithProjectFilter = new Set(["dashboard", "finanzas", "presupuestos", "contratos_financieros", "pagos_recurrentes", "cxp", "autorizaciones", "pagos_programados", "pagos_realizados", "conciliacion", "caja_chica", "cobranza", "tramites", "equipo_obra", "reportes_os"]);
  const showProjectFilter = modulesWithProjectFilter.has(active);

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
    const recordId = uid(collectionName);
    const now = todayIso();
    setData((prev) => ({
      ...prev,
      [collectionName]: [{ id: recordId, createdAt: now, updatedAt: now, ...payload }, ...(prev[collectionName] || [])],
      auditTrail: collectionName === "auditTrail" ? prev.auditTrail : [{ id: uid("audit"), module: collectionName, itemId: recordId, action: "Crear registro", user: firebaseAuth.currentUser?.email || "sistema", date: now, comment: payload.concept || payload.name || payload.tradeName || "Registro creado" }, ...(prev.auditTrail || [])].slice(0, 200),
    }));
    setShowForm(null); setForm({});
  }
  function updateRecord(collectionName, id, patch) {
    const now = todayIso();
    setData((prev) => {
      const before = (prev[collectionName] || []).find((item) => item.id === id) || {};
      const changed = changeSummary(before, { ...before, ...patch });
      return {
        ...prev,
        [collectionName]: (prev[collectionName] || []).map((item) => item.id === id ? { ...item, ...patch, updatedAt: patch.updatedAt || now } : item),
        auditTrail: collectionName === "auditTrail" ? prev.auditTrail : [{ id: uid("audit"), module: collectionName, itemId: id, action: "Actualizar registro", user: firebaseAuth.currentUser?.email || "sistema", date: now, comment: changed }, ...(prev.auditTrail || [])].slice(0, 200),
      };
    });
  }
  function resetDemo() {
    if (window.confirm("¿Restablecer datos demo de TRITON OS?")) { localStorage.removeItem("triton_os_v37"); localStorage.removeItem("triton_os_v36"); localStorage.removeItem("triton_os_v35"); localStorage.removeItem("triton_os_v34"); setData(initialData); }
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
          <Pill tone="primary">TRITON OS</Pill>
        </div>
      </header>
      <main style={{ overflow: "auto", padding: 22 }}>
        {active === "dashboard" && <Reports totals={totals} data={data} projectMap={projectMap} categoryMap={categoryMap} active="general" />}
        {active === "proyectos" && <Projects data={data} addRecord={addRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "finanzas" && <Finance data={data} projectMap={projectMap} categoryMap={categoryMap} projectFilter={projectFilter} setActive={setActive} />}
        {active === "proveedores" && <Suppliers data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "presupuestos" && <Budgets data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "contratos_financieros" && <FinanceContracts data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "pagos_recurrentes" && <RecurringPayments data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "cxp" && <Payables data={data} projectMap={projectMap} categoryMap={categoryMap} rows={filteredPayables} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "autorizaciones" && <Authorizations data={data} projectMap={projectMap} categoryMap={categoryMap} updateRecord={updateRecord} />}
        {active === "pagos_programados" && <ScheduledPayments data={data} projectMap={projectMap} categoryMap={categoryMap} updateRecord={updateRecord} addRecord={addRecord} />}
        {active === "pagos_realizados" && <PaidPayments data={data} projectMap={projectMap} categoryMap={categoryMap} />}
        {active === "conciliacion" && <BankReconciliation data={data} projectMap={projectMap} updateRecord={updateRecord} />}
        {active === "ingresos" && <Incomes data={data} projectMap={projectMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "clientes" && <Clients data={data} projectMap={projectMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "caja_chica" && <PettyCash data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {["cobranza","arr_contratos","arr_conciliacion","arr_facturacion","arr_reportes"].includes(active) && <Rentals data={data} projectMap={projectMap} tenantMap={tenantMap} assetMap={assetMap} contractMap={contractMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} mode={active} />}
        {active === "tramites" && <Permits data={data} projectMap={projectMap} rows={filteredPermits} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {["tramites_timeline","tramites_expediente"].includes(active) && <PermitsTimeline data={data} projectMap={projectMap} rows={data.permits} mode={active} updateRecord={updateRecord} />}
        {active === "equipo_obra" && <ConstructionTeam data={data} projectMap={projectMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {["reportes_os","reporte_obra","reporte_finanzas","reporte_egresos","reporte_ingresos","reporte_ia"].includes(active) && <Reports totals={totals} data={data} projectMap={projectMap} categoryMap={categoryMap} active={active} />}
        {active === "config_os" && <Config data={data} />}
        {active === "usuarios_os" && <UsersAdmin data={data} setData={setData} />}
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
  return <div style={{ display: "grid", gap: 16 }}><Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><SectionTitle title="Proyectos" helper="Cada módulo debe cruzarse por proyecto para tener estado de resultados, trámites, pagos y cobranza." /><Button onClick={() => setShowForm(showForm === "project" ? null : "project")}>Nuevo proyecto</Button></div>{showForm === "project" ? <SimpleForm fields={["name", "type", "status", "budget", "incomeTarget"]} labels={{ name: "Nombre", type: "Tipo", status: "Estatus", budget: "Presupuesto", incomeTarget: "Ingresos proyectados" }} form={form} setForm={setForm} onSubmit={() => addRecord("projects", { ...form, budget: Number(form.budget || 0), incomeTarget: Number(form.incomeTarget || 0), owner: "TRITON" })} /> : null}</Card><Card><MiniTable columns={[{ key: "name", label: "Proyecto" }, { key: "type", label: "Tipo", render: (r) => <div><b>{r.type}</b><div style={{ color: c.muted, fontSize: 11 }}>{r.taxpayerType || "Persona moral"}</div></div> }, { key: "status", label: "Estatus", render: (r) => <Pill tone="primary">{r.status}</Pill> }, { key: "budget", label: "Presupuesto", render: (r) => money(r.budget) }, { key: "incomeTarget", label: "Ingresos proyectados", render: (r) => money(r.incomeTarget) }]} rows={data.projects} /></Card></div>;
}

function payableTotal(row) {
  return Number(row.amount || 0) + Number(row.iva || 0) - Number(row.retention || 0);
}
function budgetFor(data, projectId, categoryId) {
  return Number((data.budgets || []).find((b) => b.projectId === projectId && b.categoryId === categoryId)?.budget || 0);
}
function committedFor(data, projectId, categoryId, ignoreId = null) {
  return (data.payables || []).filter((p) => p.id !== ignoreId && p.projectId === projectId && p.categoryId === categoryId && !["Rechazado", "Cancelado"].includes(p.status)).reduce((a, p) => a + payableTotal(p), 0);
}
function budgetCheck(data, row) {
  const budget = budgetFor(data, row.projectId, row.categoryId);
  const committed = committedFor(data, row.projectId, row.categoryId, row.id);
  const total = payableTotal(row);
  const available = budget - committed;
  const overspend = total - available;
  return { budget, committed, total, available, overspend, hasBudget: budget > 0, over: overspend > 0 };
}
function contractCheck(data, row) {
  const contract = (data.financeContracts || []).find((c) => c.id === row.contractId);
  if (!contract) return { contract: null, paid: 0, requested: 0, remaining: 0, over: false };
  const related = (data.payables || []).filter((p) => p.contractId === contract.id && p.id !== row.id && !["Rechazado", "Cancelado"].includes(p.status));
  const paid = related.filter((p) => ["Pagado", "Conciliado"].includes(p.status)).reduce((a, p) => a + payableTotal(p), 0);
  const requested = related.reduce((a, p) => a + payableTotal(p), 0);
  const remaining = Number(contract.amount || 0) - requested;
  return { contract, paid, requested, remaining, over: payableTotal(row) > remaining };
}
function canSendToAuthorization(data, row) {
  const b = budgetCheck(data, row);
  const ctc = contractCheck(data, row);
  const supplier = data.suppliers.find((s) => s.id === row.supplierId);
  const hasDocs = attachmentCount(row.attachments) > 0 || String(row.documentStatus || "").toLowerCase().includes("cargado") || String(row.documentStatus || "").toLowerCase().includes("ok");
  const supplierOk = supplier ? supplier.status === "Activo" && supplier.status !== "Bloqueado" : true;
  const budgetOk = b.hasBudget && (!b.over || row.overspendApprovedByAdmin);
  const contractOk = !ctc.contract || !ctc.over || row.contractOverrunApprovedByAdmin;
  return { ok: supplierOk && hasDocs && row.adminReviewed && budgetOk && contractOk, supplierOk, hasDocs, budgetOk, contractOk, budget: b, contract: ctc };
}
function statusTone(status) {
  if (["Activo", "Vigente", "Validado", "Conciliado", "Cerrada", "Liquidada", "Pagado", "Autorizado", "Cumple"].includes(status)) return "ok";
  if (["Observado", "Sobregiro", "Vencido", "Bloqueado", "Rechazado", "Cancelado"].includes(status)) return "danger";
  if (["En revisión", "Pendiente revisión", "Pendiente factura", "Programado", "Solicitado", "Por revisar"].includes(status)) return "warn";
  if (["Listo para autorización", "Solventado", "Abierta"].includes(status)) return "primary";
  return "idle";
}
function ProgressLine({ items }) {
  return <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{items.map((item, idx) => <React.Fragment key={item.label}><span style={{ padding: "8px 10px", borderRadius: 999, background: item.done ? c.greenSoft : item.active ? c.primarySoft : c.soft, color: item.done ? "#166534" : item.active ? c.primary : c.muted, fontSize: 12, fontWeight: 900 }}>{item.label}</span>{idx < items.length - 1 ? <span style={{ color: c.muted }}>›</span> : null}</React.Fragment>)}</div>;
}
function ValidationList({ checks }) {
  return <div style={{ display: "grid", gap: 8 }}>{checks.map((ch) => <div key={ch.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 10, borderRadius: 14, background: ch.ok ? c.greenSoft : c.redSoft }}><span style={{ fontWeight: 850, color: c.text }}>{ch.label}</span><Pill tone={ch.ok ? "ok" : "danger"}>{ch.ok ? "OK" : ch.fix || "Revisar"}</Pill></div>)}</div>;
}
function addAuditRecord(addRecord, payload) {
  addRecord("auditTrail", { module: payload.module || "Finanzas", itemId: payload.itemId || "", action: payload.action, user: payload.user || "admin@tritondesarrollos.com", date: todayIso(), comment: payload.comment || "" });
}
function supplierReady(supplier) {
  if (!supplier) return false;
  return supplier.status === "Activo" && supplier.fiscalStatus === "Validado" && (supplier.bankStatus === "Validado" || supplier.bankStatus === "No aplica");
}
function SmallAction({ label, helper, onClick }) {
  return <button onClick={onClick} style={{ border: `1px solid ${c.border}`, borderRadius: 18, padding: 14, background: "white", textAlign: "left", cursor: "pointer" }}><b>{label}</b><div style={{ color: c.muted, fontSize: 12, marginTop: 5 }}>{helper}</div></button>;
}
function SearchableSupplierSelect({ data, value, onChange, placeholder = "Buscar proveedor por nombre, RFC o contacto" }) {
  const current = data.suppliers.find((s) => s.id === value);
  const [query, setQuery] = useState(current?.tradeName || "");
  const [open, setOpen] = useState(false);
  useEffect(() => { setQuery(current?.tradeName || ""); }, [value]);
  const options = data.suppliers
    .filter((s) => `${s.tradeName} ${s.legalName} ${s.rfc} ${s.contact}`.toLowerCase().includes(String(query || "").toLowerCase()))
    .slice(0, 8);
  return <div style={{ position: "relative" }}>
    <input style={inputStyle()} placeholder={placeholder} value={query} onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} />
    {open ? <div style={{ position: "absolute", zIndex: 20, top: "calc(100% + 6px)", left: 0, right: 0, background: "white", border: `1px solid ${c.border}`, borderRadius: 16, boxShadow: c.shadow, overflow: "hidden", maxHeight: 260, overflowY: "auto" }}>
      {options.length ? options.map((s) => <button key={s.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(s); setQuery(s.tradeName); setOpen(false); }} style={{ width: "100%", border: 0, background: value === s.id ? c.primarySoft : "white", textAlign: "left", padding: 12, cursor: "pointer", borderBottom: `1px solid ${c.border}` }}><b>{s.tradeName}</b><div style={{ color: c.muted, fontSize: 12 }}>{s.legalName || "Sin razón social"} · {s.rfc || "Sin RFC"} · {s.taxpayerType || "Persona moral"}</div></button>) : <div style={{ padding: 12, color: c.muted, fontSize: 12 }}>No se encontró proveedor. Puedes darlo de alta en Proveedores.</div>}
    </div> : null}
  </div>;
}

function TaxSummary({ supplier, values }) {
  const profile = taxProfileForSupplier(supplier);
  return <div style={{ display: "grid", gap: 6, padding: 12, borderRadius: 16, background: c.soft, border: `1px solid ${c.border}` }}>
    <b>Tratamiento fiscal: {profile.taxpayerType}</b>
    <span style={{ color: c.muted, fontSize: 12 }}>IVA {Math.round(profile.ivaRate * 10000) / 100}% · ISR retenido {Math.round(profile.isrRetentionRate * 10000) / 100}% · IVA retenido {Math.round(profile.ivaRetentionRate * 10000) / 100}%</span>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Pill tone="primary">Base {money(values.amount)}</Pill><Pill tone="primary">IVA {money(values.iva)}</Pill><Pill tone={values.retention ? "warn" : "idle"}>Retención {money(values.retention)}</Pill><Pill tone="ok">Total {money(values.totalInput)}</Pill></div>
  </div>;
}

function PayableReviewModal({ row, data, projectMap, categoryMap, onClose, onConfirm }) {
  if (!row) return null;
  const supplier = data.suppliers.find((s) => s.id === row.supplierId);
  const budget = budgetCheck(data, row);
  const ctc = contractCheck(data, row);
  const checks = canSendToAuthorization(data, { ...row, adminReviewed: true });
  const similar = data.payables
    .filter((p) => p.supplierId === row.supplierId || p.contractId === row.contractId || (p.categoryId === row.categoryId && Math.abs(payableTotal(p) - payableTotal(row)) < Math.max(1000, payableTotal(row) * 0.08)))
    .slice(0, 8);
  return <div style={{ position: "fixed", inset: 0, zIndex: 2147483644, pointerEvents: "none" }}>
    <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.18)", backdropFilter: "blur(2px)", pointerEvents: "auto" }} onClick={onClose} />
    <aside style={{ position: "absolute", right: 18, top: 18, bottom: 18, width: "min(760px, calc(100vw - 36px))", background: "rgba(255,255,255,.99)", border: `1px solid ${c.border}`, borderRadius: 28, boxShadow: "0 24px 80px rgba(0,0,0,.18)", overflow: "hidden", pointerEvents: "auto", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <header style={{ padding: 20, borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 12 }}><div><Pill tone="primary">Revisión antes de solicitar</Pill><h2 style={{ margin: "10px 0 4px", fontSize: 22 }}>{row.concept}</h2><div style={{ color: c.muted, fontSize: 13 }}>Antes de enviar, revisa proveedor, presupuesto, anexos y pagos similares para evitar duplicados.</div></div><button onClick={onClose} style={{ border: 0, background: c.soft, borderRadius: 14, width: 40, height: 40, cursor: "pointer", fontWeight: 950 }}>×</button></header>
      <main style={{ padding: 20, overflow: "auto", display: "grid", gap: 14 }}>
        <ValidationBanner title="Controles previos" checks={[{ label: "Proveedor pagable", ok: checks.supplierOk }, { label: "Presupuesto asignado", ok: checks.budget.hasBudget }, { label: "Sin sobregiro o será revisado por administración", ok: !checks.budget.over || row.overspendApprovedByAdmin }, { label: "Contrato no excedido", ok: checks.contractOk }, { label: "Anexos cargados", ok: checks.hasDocs }]} />
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Resumen" helper="Esta es la información que recibirá administración para revisión." /><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><div><b>Proyecto</b><div>{projectMap[row.projectId]?.name || row.projectId}</div></div><div><b>Proveedor</b><div>{supplier?.tradeName || row.supplier}</div></div><div><b>Partida</b><div>{categoryMap[row.categoryId]?.name || row.categoryId}</div></div><div><b>Solicitante</b><div>{row.requestedBy}</div></div><div><b>Total</b><div>{money(payableTotal(row))}</div></div><div><b>Fecha requerida</b><div>{row.requiredDate}</div></div></div></Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Presupuesto y contrato" /><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Pill tone={budget.hasBudget ? "ok" : "danger"}>{budget.hasBudget ? `Presupuesto ${money(budget.budget)}` : "Sin presupuesto"}</Pill><Pill tone={budget.over ? "danger" : "ok"}>{budget.over ? `Sobregiro ${money(budget.overspend)}` : `Disponible ${money(budget.available)}`}</Pill>{ctc.contract ? <Pill tone={ctc.over ? "danger" : "primary"}>Contrato saldo {money(ctc.remaining)}</Pill> : <Pill tone="idle">Sin contrato</Pill>}</div></Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Anexos clasificados" /><AttachmentViewer value={row.attachments} /></Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Pagos o solicitudes similares" helper="Información para detectar si ya se solicitó algo parecido o si falta ligar contrato/recurrente." />{similar.length ? <MiniTable columns={[{ key: "concept", label: "Concepto" }, { key: "supplier", label: "Proveedor", render: (r) => supplierDisplayName(r, data) }, { key: "amount", label: "Total", render: (r) => money(payableTotal(r)) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }]} rows={similar} /> : <div style={{ color: c.muted }}>No se encontraron pagos similares.</div>}</Card>
      </main>
      <footer style={{ padding: 16, borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><Button variant="secondary" onClick={onClose}>Regresar a editar</Button><Button onClick={() => onConfirm(row)}>Enviar solicitud</Button></footer>
    </aside>
  </div>;
}

function PettyReplenishmentModal({ cash, data, categoryMap, onClose, onSaveExpense, onSendReplenishment }) {
  const [line, setLine] = useState({ date: todayIso(), categoryId: "caja_chica", taxpayerType: "Persona moral", amount: "", iva: 0, retention: 0, totalInput: 0, attachments: [] });
  const [lines, setLines] = useState([]);
  if (!cash) return null;
  const supplierLike = { taxpayerType: line.taxpayerType, ivaRate: 0.16 };
  function applyAmount(value, mode) { setLine((prev) => ({ ...prev, ...calcTaxValues(value, supplierLike, mode) })); }
  function applyXml(newFiles) {
    const xml = newFiles.find((a) => a.cfdi)?.cfdi;
    if (xml) setLine((prev) => ({ ...prev, establishment: xml.issuerName || prev.establishment, amount: xml.subtotal || prev.amount, iva: xml.iva || prev.iva, retention: 0, totalInput: xml.total || prev.totalInput }));
  }
  function addLine() {
    if (!line.concept && !line.establishment) { alert("Agrega concepto o establecimiento."); return; }
    const item = { ...line, id: uid("cashLine"), amount: Number(line.amount || 0), iva: Number(line.iva || 0), retention: Number(line.retention || 0), totalInput: Number(line.totalInput || (Number(line.amount || 0) + Number(line.iva || 0) - Number(line.retention || 0))) };
    setLines((prev) => [...prev, item]);
    setLine({ date: todayIso(), categoryId: "caja_chica", taxpayerType: "Persona moral", amount: "", iva: 0, retention: 0, totalInput: 0, attachments: [] });
  }
  const total = lines.reduce((a, x) => a + Number(x.totalInput || 0), 0);
  return <div style={{ position: "fixed", inset: 0, zIndex: 2147483644, pointerEvents: "none" }}>
    <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.18)", backdropFilter: "blur(2px)", pointerEvents: "auto" }} onClick={onClose} />
    <aside style={{ position: "absolute", right: 18, top: 18, bottom: 18, width: "min(860px, calc(100vw - 36px))", background: "rgba(255,255,255,.99)", border: `1px solid ${c.border}`, borderRadius: 28, boxShadow: "0 24px 80px rgba(0,0,0,.18)", overflow: "hidden", pointerEvents: "auto", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <header style={{ padding: 20, borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 12 }}><div><Pill tone="primary">Reposición de caja chica</Pill><h2 style={{ margin: "10px 0 4px", fontSize: 22 }}>{cash.name}</h2><div style={{ color: c.muted, fontSize: 13 }}>Carga varios gastos rápido. Si adjuntas XML, intentamos jalar emisor, subtotal, IVA y total.</div></div><button onClick={onClose} style={{ border: 0, background: c.soft, borderRadius: 14, width: 40, height: 40, cursor: "pointer", fontWeight: 950 }}>×</button></header>
      <main style={{ padding: 20, overflow: "auto", display: "grid", gap: 14 }}>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Nuevo gasto" helper="Establecimiento es la tienda/proveedor donde se compró. Puedes capturar base o total." /><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}><Field label="Fecha"><input type="date" style={inputStyle()} value={line.date || todayIso()} onChange={(e) => setLine({ ...line, date: e.target.value })} /></Field><Field label="Establecimiento / proveedor"><input style={inputStyle()} value={line.establishment || ""} onChange={(e) => setLine({ ...line, establishment: e.target.value })} /></Field><Field label="Concepto"><input style={inputStyle()} value={line.concept || ""} onChange={(e) => setLine({ ...line, concept: e.target.value })} /></Field><Field label="Categoría"><select style={inputStyle()} value={line.categoryId || "caja_chica"} onChange={(e) => setLine({ ...line, categoryId: e.target.value })}>{data.categories.filter((cat) => cat.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field><Field label="Tipo fiscal"><select style={inputStyle()} value={line.taxpayerType || "Persona moral"} onChange={(e) => setLine({ ...line, taxpayerType: e.target.value })}>{TAXPAYER_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field><Field label="Base antes IVA"><input type="number" style={inputStyle()} value={line.amount || ""} onChange={(e) => applyAmount(e.target.value, "base")} /></Field><Field label="Total pagado"><input type="number" style={inputStyle()} value={line.totalInput || ""} onChange={(e) => applyAmount(e.target.value, "total")} /></Field><Field label="IVA"><input type="number" style={inputStyle()} value={line.iva || ""} onChange={(e) => setLine({ ...line, iva: Number(e.target.value || 0) })} /></Field><Field label="Retención"><input type="number" style={inputStyle()} value={line.retention || ""} onChange={(e) => setLine({ ...line, retention: Number(e.target.value || 0) })} /></Field></div><div style={{ marginTop: 10 }}><AttachmentUploader label="Factura PDF / XML / ticket" value={line.attachments} folder="finanzas/caja-chica" onChange={(attachments) => setLine({ ...line, attachments })} onFilesUploaded={applyXml} /></div><div style={{ marginTop: 10 }}><Button onClick={addLine}>Agregar gasto al lote</Button></div></Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Gastos del lote" helper={`Total a reponer: ${money(total)}`} />{lines.length ? <MiniTable columns={[{ key: "establishment", label: "Establecimiento" }, { key: "concept", label: "Concepto" }, { key: "amount", label: "Base", render: (r) => money(r.amount) }, { key: "iva", label: "IVA", render: (r) => money(r.iva) }, { key: "retention", label: "Ret.", render: (r) => money(r.retention) }, { key: "totalInput", label: "Total", render: (r) => money(r.totalInput) }, { key: "attachments", label: "Anexos", render: (r) => <AttachmentViewer value={r.attachments} /> }, { key: "remove", label: "", sortable: false, render: (r) => <button onClick={() => setLines(lines.filter((x) => x.id !== r.id))} style={{ border: 0, background: c.redSoft, color: c.red, borderRadius: 10, padding: "6px 8px", cursor: "pointer", fontWeight: 900 }}>Quitar</button> }]} rows={lines} /> : <div style={{ color: c.muted }}>Agrega uno o varios gastos para pedir reposición.</div>}</Card>
      </main>
      <footer style={{ padding: 16, borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><Button variant="secondary" onClick={onClose}>Cancelar</Button><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button variant="secondary" disabled={!lines.length} onClick={() => { lines.forEach(onSaveExpense); onClose(); }}>Guardar gastos</Button><Button disabled={!lines.length} onClick={() => onSendReplenishment(lines)}>Enviar a pagos como reposición</Button></div></footer>
    </aside>
  </div>;
}

function Finance({ data, projectMap, categoryMap, projectFilter, setActive }) {
  const projectIds = projectFilter === "todos" ? data.projects.map((p) => p.id) : [projectFilter];
  const rows = [];
  for (const projectId of projectIds) {
    const budgets = data.budgets.filter((b) => b.projectId === projectId);
    const cats = [...new Set([...budgets.map((b) => b.categoryId), ...data.payables.filter((p) => p.projectId === projectId).map((p) => p.categoryId)])];
    for (const categoryId of cats) {
      const budget = budgetFor(data, projectId, categoryId);
      const committed = committedFor(data, projectId, categoryId);
      rows.push({ id: `${projectId}-${categoryId}`, project: projectMap[projectId]?.name, category: categoryMap[categoryId]?.name || categoryId, budget, committed, variance: budget - committed });
    }
  }
  const totalBudget = rows.reduce((a, r) => a + r.budget, 0);
  const totalCommitted = rows.reduce((a, r) => a + r.committed, 0);
  const authorized = data.payables.filter((p) => ["Autorizado", "Programado"].includes(p.status)).reduce((a, p) => a + payableTotal(p), 0);
  const paid = data.payments.reduce((a, p) => a + Number(p.amount || 0), 0);
  const needsRodrigo = data.payables.filter((p) => p.status === "Listo para autorización").length;
  const overs = data.payables.filter((p) => budgetCheck(data, p).over && !p.overspendApprovedByAdmin).length;
  return <div style={{ display: "grid", gap: 16 }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 14 }}>
      <Card><Pill tone="primary">Presupuesto</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totalBudget)}</div></Card>
      <Card><Pill tone="warn">Comprometido</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totalCommitted)}</div></Card>
      <Card><Pill tone="purple">Autorizado pendiente</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(authorized)}</div></Card>
      <Card><Pill tone="ok">Pagado</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(paid)}</div></Card>
    </div>
    <Card><SectionTitle title="Flujo financiero tipo ERP" helper="Todo pago debe salir de proveedor + presupuesto + soporte + revisión administrativa. Dirección recibe la autorización final cuando la información ya está completa." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
        <SmallAction label="Proveedores" helper={`${data.suppliers.filter((s) => s.status === "Activo").length} activos · datos fiscales/bancarios`} onClick={() => setActive("proveedores")} />
        <SmallAction label="Presupuestos" helper={`${data.budgets.length} partidas presupuestales`} onClick={() => setActive("presupuestos")} />
        <SmallAction label="Contratos" helper={`${data.financeContracts?.length || 0} contratos / soportes`} onClick={() => setActive("contratos_financieros")} />
        <SmallAction label="Pagos recurrentes" helper={`${data.recurringPayments?.filter((x) => x.status === "Activo").length || 0} activos`} onClick={() => setActive("pagos_recurrentes")} />
        <SmallAction label="Solicitudes" helper={`${data.payables.length} solicitudes · ${overs} sobregiros sin revisar`} onClick={() => setActive("cxp")} />
        <SmallAction label="Autorizaciones" helper={`${needsRodrigo} listas para autorización`} onClick={() => setActive("autorizaciones")} />
      </div>
    </Card>
    <Card><SectionTitle title="Presupuesto vs comprometido" helper="Si una solicitud rebasa presupuesto, administración debe justificar sobregiro antes de que llegue a autorización final." /><MiniTable columns={[{ key: "project", label: "Proyecto" }, { key: "category", label: "Categoría" }, { key: "budget", label: "Presupuesto", render: (r) => money(r.budget) }, { key: "committed", label: "Comprometido", render: (r) => money(r.committed) }, { key: "variance", label: "Disponible", render: (r) => <Pill tone={r.variance >= 0 ? "ok" : "danger"}>{money(r.variance)}</Pill> }]} rows={rows} /></Card>
  </div>;
}
function Budgets({ data, projectMap, categoryMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const [projectLocalFilter, setProjectLocalFilter] = useState("todos");
  const [categoryLocalFilter, setCategoryLocalFilter] = useState("todos");
  const [detail, setDetail] = useState(null);
  const budgetRows = data.budgets
    .map((b) => { const committed = committedFor(data, b.projectId, b.categoryId); return { ...b, committed, available: Number(b.budget || 0) - committed }; })
    .filter((b) => projectLocalFilter === "todos" || b.projectId === projectLocalFilter)
    .filter((b) => categoryLocalFilter === "todos" || b.categoryId === categoryLocalFilter);
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Presupuestos por proyecto" helper="La partida presupuestal es obligatoria para cualquier pago. Los filtros viven sobre la tabla donde se usan." /><ProgressLine items={[{ label: "Proyecto" , done: true }, { label: "Partida", done: true }, { label: "Presupuesto" , active: true }, { label: "Comprometido" }, { label: "Disponible" }]} /></Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Nueva / ajuste de partida" helper="Carga presupuesto autorizado por categoría. Los pagos toman esta base para validar disponibilidad." /><Button onClick={() => setShowForm(showForm === "budget" ? null : "budget")}>Nueva partida</Button></div>
      {showForm === "budget" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Categoría"><select style={inputStyle()} value={form.categoryId || "construccion"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((c) => c.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field><Field label="Presupuesto autorizado"><input type="number" style={inputStyle()} value={form.budget || ""} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></Field><Field label="Responsable autorización"><input style={inputStyle()} value={form.authorizedBy || ""} onChange={(e) => setForm({ ...form, authorizedBy: e.target.value })} /></Field></div><Field label="Comentario / soporte"><input style={inputStyle()} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field><Button onClick={() => addRecord("budgets", { projectId: form.projectId || "arenna", categoryId: form.categoryId || "construccion", budget: Number(form.budget || 0), authorizedBy: form.authorizedBy || "Dirección", notes: form.notes || "", updatedAt: todayIso() })}>Guardar presupuesto</Button></div> : null}
    </Card>
    <Card><div style={{ display: "flex", alignItems: "end", gap: 10, flexWrap: "wrap", marginBottom: 12 }}><Field label="Filtrar proyecto"><select value={projectLocalFilter} onChange={(e) => setProjectLocalFilter(e.target.value)} style={inputStyle({ width: 220 })}><option value="todos">Todos los proyectos</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Filtrar categoría"><select value={categoryLocalFilter} onChange={(e) => setCategoryLocalFilter(e.target.value)} style={inputStyle({ width: 260 })}><option value="todos">Todas las categorías</option>{data.categories.filter((c) => c.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field><div style={{ paddingBottom: 10, color: c.muted, fontSize: 12, fontWeight: 850 }}>{budgetRows.length} partida(s)</div></div><MiniTable columns={[{ key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "categoryId", label: "Categoría", render: (r) => <EntityLink onClick={() => setDetail(r)} title="Abrir hoja de ayuda de la partida">{categoryMap[r.categoryId]?.name}</EntityLink> }, { key: "budget", label: "Presupuesto", render: (r) => money(r.budget) }, { key: "committed", label: "Comprometido", render: (r) => money(r.committed) }, { key: "available", label: "Disponible", render: (r) => <Pill tone={r.available >= 0 ? "ok" : "danger"}>{money(r.available)}</Pill> }, { key: "notes", label: "Soporte" }, { key: "help", label: "Hoja de ayuda", render: (r) => <Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => setDetail(r)}>Ver gastos</Button> }, { key: "actions", label: "Ajustar", render: (r) => <Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => { const value = window.prompt("Nuevo presupuesto autorizado", r.budget); if (value !== null) updateRecord("budgets", r.id, { budget: Number(value || 0), updatedAt: todayIso() }); }}>Editar</Button> }]} rows={budgetRows} /></Card>
    {detail ? <BudgetDetailDrawer row={detail} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setDetail(null)} /> : null}
  </div>;
}

function BudgetDetailDrawer({ row, data, projectMap, categoryMap, onClose }) {
  const payables = data.payables.filter((p) => p.projectId === row.projectId && p.categoryId === row.categoryId);
  const payments = data.payments.filter((payment) => payables.some((p) => p.id === payment.payableId));
  const contracts = (data.financeContracts || []).filter((ct) => ct.projectId === row.projectId && ct.categoryId === row.categoryId);
  const committed = payables.reduce((a, p) => a + payableTotal(p), 0);
  const paid = payments.reduce((a, p) => a + Number(p.amount || 0), 0);
  return <div style={{ position: "fixed", inset: 0, zIndex: 2147483642, pointerEvents: "none" }}>
    <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,.15)", pointerEvents: "auto" }} onClick={onClose} />
    <aside style={{ position: "absolute", right: 20, top: 20, bottom: 20, width: "min(880px, calc(100vw - 40px))", background: "#fff", border: `1px solid ${c.border}`, borderRadius: 28, boxShadow: "0 26px 90px rgba(0,0,0,.18)", pointerEvents: "auto", overflow: "hidden", display: "grid", gridTemplateRows: "auto 1fr" }}>
      <header style={{ padding: 20, borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 12 }}><div><Pill tone="primary">Hoja de ayuda presupuestal</Pill><h2 style={{ margin: "10px 0 4px", fontSize: 24 }}>{categoryMap[row.categoryId]?.name || row.categoryId}</h2><div style={{ color: c.muted }}>{projectMap[row.projectId]?.name || row.projectId} · presupuesto {money(row.budget)} · disponible {money(row.available)}</div></div><button onClick={onClose} style={{ border: 0, borderRadius: 14, background: c.soft, width: 40, height: 40, fontWeight: 950, cursor: "pointer" }}>×</button></header>
      <main style={{ padding: 20, overflow: "auto", display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}><Card style={{ boxShadow: "none" }}><Pill tone="primary">Presupuesto</Pill><div style={{ fontSize: 24, fontWeight: 950, marginTop: 8 }}>{money(row.budget)}</div></Card><Card style={{ boxShadow: "none" }}><Pill tone="warn">Comprometido</Pill><div style={{ fontSize: 24, fontWeight: 950, marginTop: 8 }}>{money(committed)}</div></Card><Card style={{ boxShadow: "none" }}><Pill tone="ok">Pagado</Pill><div style={{ fontSize: 24, fontWeight: 950, marginTop: 8 }}>{money(paid)}</div></Card><Card style={{ boxShadow: "none" }}><Pill tone={row.available >= 0 ? "ok" : "danger"}>Disponible</Pill><div style={{ fontSize: 24, fontWeight: 950, marginTop: 8 }}>{money(row.available)}</div></Card></div>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Gastos, solicitudes y pagos de esta partida" helper="Consulta rápida para evitar pagos duplicados, sobregiros o solicitudes incompletas." /><MiniTable columns={[{ key: "concept", label: "Concepto" }, { key: "supplier", label: "Proveedor", render: (r) => supplierDisplayName(r, data) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "amount", label: "Total", render: (r) => money(payableTotal(r)) }, { key: "requestedBy", label: "Solicitó" }, { key: "requiredDate", label: "Fecha" }, { key: "attachments", label: "Anexos", render: (r) => <AttachmentViewer value={r.attachments} /> }]} rows={payables} empty="No hay solicitudes ligadas a esta partida." /></Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Contratos relacionados" helper="Techo contractual y pagos ligados a la misma partida." /><MiniTable columns={[{ key: "name", label: "Contrato" }, { key: "supplierId", label: "Proveedor", render: (r) => data.suppliers.find((s) => s.id === r.supplierId)?.tradeName || "—" }, { key: "amount", label: "Monto", render: (r) => money(r.amount) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "paymentPlan", label: "Plan" }]} rows={contracts} empty="Sin contratos ligados." /></Card>
      </main>
    </aside>
  </div>;
}


function FinanceContracts({ data, projectMap, categoryMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  function contractRows() { return (data.financeContracts || []).map((ct) => { const related = data.payables.filter((p) => p.contractId === ct.id && !["Rechazado", "Cancelado"].includes(p.status)); const requested = related.reduce((a, p) => a + payableTotal(p), 0); const paid = related.filter((p) => ["Pagado", "Conciliado"].includes(p.status)).reduce((a, p) => a + payableTotal(p), 0); return { ...ct, requested, paid, balance: Number(ct.amount || 0) - requested }; }); }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Contratos y soportes autorizados" helper="Un contrato es el techo autorizado. Anticipo, parcialidades, estimaciones y saldo quedan ligados para no pagar doble ni exceder monto." /><ProgressLine items={[{ label: "Contrato", done: true }, { label: "Anticipo" }, { label: "Parcialidades" }, { label: "Saldo" }, { label: "Cierre" }]} /></Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Nuevo contrato" helper="Define monto total, plan de pagos y anexos. Las solicitudes pueden ligarse a este contrato." /><Button onClick={() => setShowForm(showForm === "contract" ? null : "contract")}>Nuevo contrato</Button></div>
      {showForm === "contract" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Proveedor"><select style={inputStyle()} value={form.supplierId || data.suppliers[0]?.id || ""} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>{data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.tradeName}</option>)}</select></Field><Field label="Categoría"><select style={inputStyle()} value={form.categoryId || "construccion"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((c) => c.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field><Field label="Monto total autorizado"><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Anticipo autorizado"><input type="number" style={inputStyle()} value={form.advanceAmount || ""} onChange={(e) => setForm({ ...form, advanceAmount: e.target.value })} /></Field><Field label="Estatus"><select style={inputStyle()} value={form.status || "Vigente"} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>Vigente</option><option>Pendiente firma</option><option>Cerrado</option><option>Cancelado</option></select></Field></div><Field label="Nombre del contrato"><input style={inputStyle()} value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Plan de pagos"><textarea style={inputStyle({ minHeight: 68 })} placeholder="Anticipo 30%, avance 40%, saldo 30%" value={form.paymentPlan || ""} onChange={(e) => setForm({ ...form, paymentPlan: e.target.value })} /></Field><AttachmentUploader label="Subir contrato / cotización / carátula" value={form.documents} folder="finanzas/contratos" onChange={(documents) => setForm({ ...form, documents })} helper="Carga el contrato firmado, cotización autorizada, carátula bancaria y cualquier soporte." /><Button onClick={() => addRecord("financeContracts", { projectId: form.projectId || "arenna", supplierId: form.supplierId || data.suppliers[0]?.id || "", categoryId: form.categoryId || "construccion", name: form.name || "Contrato", amount: Number(form.amount || 0), advanceAmount: Number(form.advanceAmount || 0), status: form.status || "Vigente", startDate: todayIso(), endDate: "", paymentPlan: form.paymentPlan || "Anticipo / parcialidades / saldo", documents: normalizeAttachments(form.documents) })}>Guardar contrato</Button></div> : null}
    </Card>
    <Card><MiniTable columns={[{ key: "name", label: "Contrato" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "supplierId", label: "Proveedor", render: (r) => data.suppliers.find((s) => s.id === r.supplierId)?.tradeName }, { key: "categoryId", label: "Categoría", render: (r) => categoryMap[r.categoryId]?.name }, { key: "amount", label: "Monto autorizado", render: (r) => money(r.amount) }, { key: "requested", label: "Solicitado ligado", render: (r) => money(r.requested) }, { key: "paid", label: "Pagado", render: (r) => money(r.paid) }, { key: "balance", label: "Saldo", render: (r) => <Pill tone={r.balance >= 0 ? "ok" : "danger"}>{money(r.balance)}</Pill> }, { key: "documents", label: "Anexos", render: (r) => <AttachmentViewer value={r.documents} /> }, { key: "paymentPlan", label: "Plan" }]} rows={contractRows()} /></Card>
  </div>;
}

function RecurringPayments({ data, projectMap, categoryMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const recs = data.recurringPayments || [];
  function generate(rec) {
    const supplier = data.suppliers.find((s) => s.id === rec.supplierId);
    addRecord("payables", { projectId: rec.projectId, supplierId: rec.supplierId, supplier: supplier?.tradeName || "Proveedor", concept: rec.concept, categoryId: rec.categoryId, contractId: rec.contractId || "", paymentStage: "Recurrente", amount: Number(rec.amount || 0), iva: Number(rec.iva || 0), retention: Number(rec.retention || 0), requestedBy: "Pago recurrente", requiredDate: rec.nextDate || todayIso(), status: "En revisión", priority: "Media", documentStatus: rec.requiresInvoice ? "Pendiente factura" : "Soporte recurrente", recurringPaymentId: rec.id, adminReviewed: false, recurringAuthorized: true, attachments: [], notes: `Generado desde pago recurrente autorizado por ${rec.authorizedBy || "Dirección"}.` });
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Pagos recurrentes" helper="Autorización base para pagos repetitivos. Cada periodo genera solicitud y administración valida monto/documento antes de pagar." /><ProgressLine items={[{ label: "Autorización base", done: true }, { label: "Generar periodo", active: true }, { label: "Factura/soporte" }, { label: "Pago" }, { label: "Conciliación" }]} /></Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Nuevo recurrente" helper="Servicios, rentas, software, honorarios, intereses o pagos oficiales recurrentes." /><Button onClick={() => setShowForm(showForm === "recurring" ? null : "recurring")}>Nuevo recurrente</Button></div>
      {showForm === "recurring" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Proveedor"><select style={inputStyle()} value={form.supplierId || data.suppliers[0]?.id || ""} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>{data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.tradeName}</option>)}</select></Field><Field label="Categoría"><select style={inputStyle()} value={form.categoryId || "admin_obra"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((c) => c.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field><Field label="Monto"><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="IVA"><input type="number" style={inputStyle()} value={form.iva || ""} onChange={(e) => setForm({ ...form, iva: e.target.value })} /></Field><Field label="Periodicidad"><select style={inputStyle()} value={form.frequency || "Mensual"} onChange={(e) => setForm({ ...form, frequency: e.target.value })}><option>Semanal</option><option>Quincenal</option><option>Mensual</option><option>Anual</option><option>Variable</option></select></Field><Field label="Día de generación"><input type="number" style={inputStyle()} value={form.day || "5"} onChange={(e) => setForm({ ...form, day: e.target.value })} /></Field><Field label="Requiere factura"><select style={inputStyle()} value={form.requiresInvoice || "Sí"} onChange={(e) => setForm({ ...form, requiresInvoice: e.target.value })}><option>Sí</option><option>No</option></select></Field></div><Field label="Concepto"><input style={inputStyle()} value={form.concept || ""} onChange={(e) => setForm({ ...form, concept: e.target.value })} /></Field><Button onClick={() => addRecord("recurringPayments", { projectId: form.projectId || "arenna", supplierId: form.supplierId || data.suppliers[0]?.id || "", categoryId: form.categoryId || "admin_obra", concept: form.concept || "Pago recurrente", amount: Number(form.amount || 0), iva: Number(form.iva || 0), retention: 0, frequency: form.frequency || "Mensual", day: Number(form.day || 5), status: "Activo", authorizedBy: "rodrigo@tritondesarrollos.com", requiresInvoice: form.requiresInvoice !== "No", nextDate: todayIso(), notes: "Autorización base registrada." })}>Guardar recurrente</Button></div> : null}
    </Card>
    <Card><MiniTable columns={[{ key: "concept", label: "Concepto" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "supplierId", label: "Proveedor", render: (r) => data.suppliers.find((s) => s.id === r.supplierId)?.tradeName }, { key: "amount", label: "Monto", render: (r) => money(Number(r.amount || 0) + Number(r.iva || 0) - Number(r.retention || 0)) }, { key: "frequency", label: "Frecuencia" }, { key: "nextDate", label: "Siguiente" }, { key: "requiresInvoice", label: "Factura", render: (r) => r.requiresInvoice ? "Sí" : "No" }, { key: "status", label: "Estatus", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => generate(r)}>Generar solicitud</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("recurringPayments", r.id, { status: r.status === "Activo" ? "Pausado" : "Activo" })}>{r.status === "Activo" ? "Pausar" : "Activar"}</Button></div> }]} rows={recs} /></Card>
  </div>;
}

function Payables({ data, projectMap, categoryMap, rows, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [editingPayment, setEditingPayment] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [statusFilter, setStatusFilter] = useState("todos");
  const [reviewDraft, setReviewDraft] = useState(null);
  const currentUser = currentFinanceUser();
  const displayedRows = filterByStatus(rows, statusFilter);
  const canAdminOperate = canFinanceAction("adminReview");
  const supplier = data.suppliers.find((s) => s.id === (form.supplierId || data.suppliers[0]?.id));
  const activeContracts = (data.financeContracts || []).filter((ct) => !form.supplierId || ct.supplierId === form.supplierId);
  const previewRow = { projectId: form.projectId || "arenna", categoryId: form.categoryId || supplier?.categoryId || "construccion", amount: Number(form.amount || 0), iva: Number(form.iva || 0), retention: Number(form.retention || 0), contractId: form.contractId || "" };
  const previewBudget = budgetCheck(data, previewRow);
  const previewContract = contractCheck(data, previewRow);
  const taxValues = calcTaxValues(form.amount || 0, supplier, "base");
  function patchWithTax(value, mode) {
    const next = calcTaxValues(value, supplier, mode);
    setForm({ ...form, ...next });
  }
  function applyUploadedXml(newFiles) {
    const xml = newFiles.find((a) => a.cfdi)?.cfdi;
    if (xml) {
      const next = { ...form, amount: xml.subtotal || form.amount, iva: xml.iva || form.iva, totalInput: xml.total || form.totalInput, retention: form.retention || 0 };
      if (xml.issuerName && !form.concept) next.concept = `Pago a ${xml.issuerName}`;
      setForm(next);
    }
  }
  function buildPayablePayload() {
    const selected = data.suppliers.find((s) => s.id === (form.supplierId || data.suppliers[0]?.id));
    if (!selected) { alert("Selecciona un proveedor."); return null; }
    const anexos = normalizeAttachments(form.attachments);
    const payload = {
      projectId: form.projectId || "arenna",
      supplierId: selected.id,
      supplier: selected.tradeName,
      concept: form.concept || "Solicitud de pago",
      categoryId: form.categoryId || selected.categoryId || "construccion",
      contractId: form.contractId || "",
      paymentStage: form.paymentStage || "Pago parcial",
      amount: Number(form.amount || 0),
      iva: Number(form.iva || 0),
      retention: Number(form.retention || 0),
      isrRetention: Number(form.isrRetention || 0),
      ivaRetention: Number(form.ivaRetention || 0),
      taxpayerType: selected.taxpayerType || "Persona moral",
      requestedBy: currentUser.email || form.requestedBy || "Solicitante",
      requestedByName: currentUser.name || "",
      requiredDate: form.requiredDate || todayIso(),
      status: "Solicitado",
      priority: form.priority || "Media",
      documentStatus: anexos.length ? "Soporte cargado" : "Pendiente anexos",
      attachments: anexos,
      adminReviewed: false,
      overspendApprovedByAdmin: false,
      contractOverrunApprovedByAdmin: false,
      overspendReason: "",
      adminComment: "",
      notes: form.notes || "",
      createdAt: todayIso(),
    };
    const b = budgetCheck(data, payload);
    if (!b.hasBudget) payload.status = "Observado";
    return payload;
  }
  function preparePayableReview() {
    const payload = buildPayablePayload();
    if (payload) setReviewDraft(payload);
  }
  function confirmPayable(payload) {
    addRecord("payables", payload);
    setReviewDraft(null);
    setShowForm(null);
    setForm({});
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Solicitudes de pago" helper="Captura → revisión previa → administración valida presupuesto/documentos → autorización → programación → pago." />
      <ProgressLine items={[{ label: "Solicitud", done: true }, { label: "Revisión previa", active: true }, { label: "Revisión admin" }, { label: "Autorización" }, { label: "Programación" }, { label: "Pago" }, { label: "Conciliación" }]} />
    </Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Nueva solicitud" helper="Busca proveedor por nombre/RFC. Puedes capturar base o total; IVA y retenciones se calculan según persona física/moral del proveedor." /><Button onClick={() => setShowForm(showForm === "payable" ? null : "payable")}>Nueva solicitud</Button></div>
      {showForm === "payable" ? <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}>
          <Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Proveedor"><SearchableSupplierSelect data={data} value={form.supplierId || data.suppliers[0]?.id || ""} onChange={(s) => { const tax = form.amount ? calcTaxValues(form.amount, s, "base") : {}; setForm({ ...form, supplierId: s.id, categoryId: s.categoryId || form.categoryId, taxpayerType: s.taxpayerType || "Persona moral", ...tax }); }} /></Field>
          <Field label="Categoría / partida"><select style={inputStyle()} value={form.categoryId || supplier?.categoryId || "construccion"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((cat) => cat.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field>
          <Field label="Contrato ligado"><select style={inputStyle()} value={form.contractId || ""} onChange={(e) => setForm({ ...form, contractId: e.target.value })}><option value="">Sin contrato</option>{activeContracts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}</select></Field>
          <Field label="Etapa de pago"><select style={inputStyle()} value={form.paymentStage || "Pago parcial"} onChange={(e) => setForm({ ...form, paymentStage: e.target.value })}><option>Anticipo</option><option>Pago parcial</option><option>Estimación</option><option>Saldo</option><option>Recurrente</option><option>Reembolso</option><option>Reposición caja chica</option></select></Field>
          <Field label="Fecha requerida"><input type="date" style={inputStyle()} value={form.requiredDate || todayIso()} onChange={(e) => setForm({ ...form, requiredDate: e.target.value })} /></Field>
          <Field label="Prioridad"><select style={inputStyle()} value={form.priority || "Media"} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>Baja</option><option>Media</option><option>Alta</option><option>Urgente</option></select></Field>
        </div>
        <Field label="Concepto"><input style={inputStyle()} value={form.concept || ""} onChange={(e) => setForm({ ...form, concept: e.target.value })} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(280px,.55fr)", gap: 12 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
              <Field label="Monto antes IVA"><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => patchWithTax(e.target.value, "base")} /></Field>
              <Field label="Monto total a pagar"><input type="number" style={inputStyle()} value={form.totalInput || ""} onChange={(e) => patchWithTax(e.target.value, "total")} /></Field>
              <Field label="IVA"><input type="number" style={inputStyle()} value={form.iva || ""} onChange={(e) => setForm({ ...form, iva: e.target.value })} /></Field>
              <Field label="Retenciones"><input type="number" style={inputStyle()} value={form.retention || ""} onChange={(e) => setForm({ ...form, retention: e.target.value })} /></Field>
            </div>
            <TaxSummary supplier={supplier} values={{ ...taxValues, ...form }} />
            <AttachmentUploader label="Subir factura / contrato / soporte" value={form.attachments} folder="finanzas/solicitudes-pago" onChange={(attachments) => setForm({ ...form, attachments })} onFilesUploaded={applyUploadedXml} helper="Sube varios archivos; después clasifica cada anexo para que viaje con la solicitud y sea consultable." />
          </div>
          <Card style={{ boxShadow: "none", padding: 12 }}><SectionTitle title="Validación previa" helper={`Total solicitud: ${money(payableTotal(previewRow))}`} /><ValidationList checks={[{ label: "Proveedor pagable", ok: supplierReady(supplier), fix: "Proveedor" }, { label: "Tiene presupuesto", ok: previewBudget.hasBudget, fix: "Sin presupuesto" }, { label: "Disponible / sobregiro justificado", ok: !previewBudget.over, fix: `Sobregiro ${money(Math.max(0, previewBudget.overspend))}` }, { label: "Contrato no excedido", ok: !previewContract.contract || !previewContract.over, fix: "Excede contrato" }, { label: "Anexos cargados", ok: attachmentCount(form.attachments) > 0, fix: "Anexos" }]} /></Card>
        </div>
        <Button onClick={preparePayableReview}>Revisar y enviar solicitud</Button>
      </div> : null}
    </Card>
    <Card><SectionTitle title="Solicitudes" helper="Administración debe revisar, justificar sobregiro y dejar expediente completo antes de enviar a autorización." />
      <StatusFilter value={statusFilter} onChange={setStatusFilter} options={rows.map((r) => r.status)} total={rows.length} shown={displayedRows.length} />
      <MiniTable columns={[{ key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "requestedBy", label: "Solicitó", render: (r) => <div><b>{r.requestedByName || r.requestedBy || "—"}</b><div style={{ color: c.muted, fontSize: 11 }}>{r.requestedBy || "sin usuario"}</div></div> }, { key: "supplier", label: "Proveedor", render: (r) => { const s = data.suppliers.find((x) => x.id === r.supplierId); return <EntityLink onClick={() => setSelectedSupplier(s)}>{supplierDisplayName(r, data)}</EntityLink>; } }, { key: "concept", label: "Concepto", render: (r) => <EntityLink onClick={() => setSelectedPayment(r)}>{r.concept}</EntityLink> }, { key: "paymentStage", label: "Etapa" }, { key: "categoryId", label: "Partida", render: (r) => categoryMap[r.categoryId]?.name }, { key: "amount", label: "Total", sortValue: (r) => payableTotal(r), render: (r) => money(payableTotal(r)) }, { key: "budget", label: "Presupuesto", render: (r) => { const b = budgetCheck(data, r); return <Pill tone={!b.hasBudget || (b.over && !r.overspendApprovedByAdmin) ? "danger" : "ok"}>{!b.hasBudget ? "Sin presupuesto" : b.over ? `Sobregiro ${money(b.overspend)}` : `Disp. ${money(b.available)}`}</Pill>; } }, { key: "docs", label: "Anexos", render: (r) => <AttachmentViewer value={r.attachments} /> }, { key: "status", label: "Estado", render: (r) => <div style={{ minWidth: 170 }}><Pill tone={statusTone(r.status)}>{r.status}</Pill><div style={{ color: c.muted, fontSize: 11, marginTop: 5 }}>Automático por flujo</div></div> }, { key: "context", label: "Expediente", sortable: false, render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => setSelectedPayment(r)}>Revisar</Button>{canFinanceAction("edit") ? <Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => setEditingPayment(r)}>Editar</Button> : null}</ActionCell> }, { key: "adminActions", label: "Revisión admin", sortable: false, render: (r) => { const check = canSendToAuthorization(data, r); if (!canAdminOperate) return <Pill tone="idle">Solo consulta</Pill>; return <ActionCell><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => { const b = budgetCheck(data, r); updateRecord("payables", r.id, { adminReviewed: true, status: b.over && !r.overspendApprovedByAdmin ? "Observado" : "En revisión", adminReviewedAt: todayIso(), adminReviewedBy: currentUser.email }); }}>Revisar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => { const reason = window.prompt("Motivo administrativo del sobregiro / excepción", r.overspendReason || ""); if (reason !== null) updateRecord("payables", r.id, { overspendApprovedByAdmin: true, overspendReason: reason, adminComment: reason }); }}>Justificar sobregiro</Button><Button variant="success" style={{ padding: "7px 9px", fontSize: 12 }} disabled={!check.ok} onClick={() => updateRecord("payables", r.id, { status: "Listo para autorización", readyForApprovalAt: todayIso() })}>Enviar a Autorización</Button></ActionCell>; } }]} rows={displayedRows} />
    </Card>
    <PayableReviewModal row={reviewDraft} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setReviewDraft(null)} onConfirm={confirmPayable} />
    <PaymentContextModal row={selectedPayment} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedPayment(null)} />
    <PaymentEditModal row={editingPayment} data={data} onClose={() => setEditingPayment(null)} onSave={(patch) => { updateRecord("payables", editingPayment.id, patch); setEditingPayment(null); }} />
    <SupplierContextModal supplier={selectedSupplier} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedSupplier(null)} />
  </div>;
}

function Authorizations({ data, projectMap, categoryMap, updateRecord }) {
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [statusFilter, setStatusFilter] = useState("Listo para autorización");
  const canAuthorize = canFinanceAction("authorize");
  const baseRows = data.payables.filter((p) => ["Listo para autorización", "Autorizado", "Observado", "Rechazado"].includes(p.status));
  const rows = filterByStatus(baseRows, statusFilter);
  const selectedRows = rows.filter((r) => selectedIds.includes(r.id));
  function toggle(id) { setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]); }
  function authorizeRow(r) { updateRecord("payables", r.id, { status: "Autorizado", authorizedBy: currentFinanceUser().email || "rodrigo@tritondesarrollos.com", authorizedAt: todayIso() }); }
  function authorizeBatch() {
    if (!canAuthorize) { alert("Solo el usuario master puede autorizar pagos."); return; }
    if (!selectedRows.length) { alert("Selecciona al menos una solicitud."); return; }
    if (!window.confirm(`Autorizar ${selectedRows.length} solicitud(es) seleccionada(s)?`)) return;
    selectedRows.forEach(authorizeRow);
    setSelectedIds([]);
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Autorización final" helper="La autorización final solo la ve/ejecuta el master. Administración puede dejar el expediente listo, pero no puede autorizar." />
      <ProgressLine items={[{ label: "Capturado", done: true }, { label: "Admin revisó", done: true }, { label: "Autorización master", active: true }, { label: "Pago" }, { label: "Conciliado" }]} />
      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <StatusFilter value={statusFilter} onChange={(v) => { setStatusFilter(v); setSelectedIds([]); }} options={baseRows.map((r) => r.status)} total={baseRows.length} shown={rows.length} />
        {canAuthorize ? <Button onClick={authorizeBatch} disabled={!selectedRows.length}>Autorizar lote ({selectedRows.length})</Button> : <Pill tone="warn">Solo master puede autorizar</Pill>}
        <Button variant="secondary" onClick={() => setSelectedIds(rows.filter((r) => r.status === "Listo para autorización").map((r) => r.id))}>Seleccionar autorizables</Button>
        <Button variant="secondary" onClick={() => setSelectedIds([])}>Limpiar</Button>
        <div style={{ color: c.muted, fontSize: 13, fontWeight: 850, paddingBottom: 10 }}>Total seleccionado: {money(selectedRows.reduce((a, r) => a + payableTotal(r), 0))}</div>
      </div>
    </Card>
    <Card><MiniTable columns={[
      { key: "select", label: "Sel.", sortable: false, render: (r) => <input type="checkbox" disabled={!canAuthorize || r.status !== "Listo para autorización"} checked={selectedIds.includes(r.id)} onChange={() => toggle(r.id)} /> },
      { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name },
      { key: "supplier", label: "Proveedor", sortValue: (r) => supplierDisplayName(r, data), render: (r) => { const s = data.suppliers.find((x) => x.id === r.supplierId); return <EntityLink onClick={() => setSelectedSupplier(s)}>{supplierDisplayName(r, data)}</EntityLink>; } },
      { key: "concept", label: "Concepto", render: (r) => <EntityLink onClick={() => setSelectedPayment(r)}>{r.concept}</EntityLink> },
      { key: "categoryId", label: "Partida", render: (r) => categoryMap[r.categoryId]?.name },
      { key: "amount", label: "Total", sortValue: (r) => payableTotal(r), render: (r) => money(payableTotal(r)) },
      { key: "summary", label: "Resumen", sortable: false, render: (r) => { const b = budgetCheck(data, r); const ctc = contractCheck(data, r); return <div style={{ minWidth: 230, display: "grid", gap: 4 }}><span>Presupuesto: {b.hasBudget ? money(b.budget) : "Sin presupuesto"}</span><span>Disponible antes: {money(b.available)}</span>{b.over ? <span style={{ color: c.red, fontWeight: 900 }}>Sobregiro: {money(b.overspend)}</span> : <span style={{ color: "#166534", fontWeight: 900 }}>Sin sobregiro</span>}{ctc.contract ? <span>Contrato: {money(ctc.contract.amount)} · saldo {money(ctc.remaining)}</span> : <span>Sin contrato ligado</span>}</div>; } },
      { key: "docs", label: "Anexos", sortable: false, render: (r) => <AttachmentViewer value={r.attachments} /> },
      { key: "admin", label: "Admin", sortable: false, render: (r) => <div style={{ minWidth: 190 }}>{r.adminReviewed ? <Pill tone="ok">Revisado</Pill> : <Pill tone="warn">Sin revisión</Pill>}<div style={{ color: c.muted, fontSize: 12, marginTop: 5 }}>{r.adminComment || r.overspendReason || "Sin comentario"}</div></div> },
      { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> },
      { key: "view", label: "Revisar", sortable: false, render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => setSelectedPayment(r)}>Expediente</Button></ActionCell> },
      { key: "approve", label: "Autorizar", sortable: false, render: (r) => canAuthorize && r.status === "Listo para autorización" ? <ActionCell><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => authorizeRow(r)}>Autorizar</Button></ActionCell> : <Pill tone="idle">—</Pill> },
      { key: "correction", label: "Corrección", sortable: false, render: (r) => canAuthorize ? <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("payables", r.id, { status: "Observado", directorComment: window.prompt("¿Qué se debe corregir?", "") || "Corrección solicitada" })}>Solicitar</Button></ActionCell> : <Pill tone="idle">—</Pill> },
      { key: "reject", label: "Rechazar", sortable: false, render: (r) => canAuthorize ? <ActionCell><Button variant="danger" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("payables", r.id, { status: "Rechazado", rejectedAt: todayIso() })}>Rechazar</Button></ActionCell> : <Pill tone="idle">—</Pill> },
    ]} rows={rows} empty="No hay solicitudes para este filtro." /></Card>
    <PaymentContextModal row={selectedPayment} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedPayment(null)} onAuthorize={canAuthorize ? (r) => { authorizeRow(r); setSelectedPayment(null); } : undefined} onCorrection={canAuthorize ? (r) => updateRecord("payables", r.id, { status: "Observado", directorComment: window.prompt("¿Qué se debe corregir?", "") || "Corrección solicitada" }) : undefined} onReject={canAuthorize ? (r) => { updateRecord("payables", r.id, { status: "Rechazado", rejectedAt: todayIso() }); setSelectedPayment(null); } : undefined} />
    <SupplierContextModal supplier={selectedSupplier} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedSupplier(null)} />
  </div>;
}

function ScheduledPayments({ data, projectMap, categoryMap, updateRecord, addRecord }) {
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [batchDate, setBatchDate] = useState(todayIso());
  const [statusFilter, setStatusFilter] = useState("todos");
  const baseRows = data.payables.filter((p) => ["Autorizado", "Programado"].includes(p.status));
  const rows = filterByStatus(baseRows, statusFilter);
  const selectedRows = rows.filter((r) => selectedIds.includes(r.id));
  function toggle(id) { setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]); }
  function scheduleSelected() {
    if (!selectedRows.length) { alert("Selecciona al menos un pago para programar."); return; }
    selectedRows.forEach((r) => updateRecord("payables", r.id, { status: "Programado", scheduledDate: batchDate, scheduledBatchAt: todayIso() }));
    setSelectedIds([]);
  }
  function pay(row) {
    const bank = window.prompt("Banco / cuenta de salida", row.paymentBank || "Banco por definir") || "Banco por definir";
    const reference = window.prompt("Referencia bancaria / SPEI", `SPEI-${Date.now()}`) || `SPEI-${Date.now()}`;
    updateRecord("payables", row.id, { status: "Pagado", paidAt: todayIso(), paymentBank: bank, paymentReference: reference });
    addRecord("payments", { payableId: row.id, projectId: row.projectId, amount: payableTotal(row), bank, date: todayIso(), reference, reconciled: false, proof: "Comprobante pendiente de adjuntar" });
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Programación de pagos" helper="Selecciona uno o varios pagos autorizados y programa un lote con fecha única, sin ventanas emergentes." />
      <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <Field label="Fecha de programación del lote"><input type="date" style={inputStyle({ width: 220 })} value={batchDate} onChange={(e) => setBatchDate(e.target.value)} /></Field>
        <Button onClick={scheduleSelected} disabled={!selectedRows.length}>Programar lote ({selectedRows.length})</Button>
        <Button variant="secondary" onClick={() => setSelectedIds(rows.map((r) => r.id))}>Seleccionar todos</Button>
        <Button variant="secondary" onClick={() => setSelectedIds([])}>Limpiar</Button>
        <div style={{ color: c.muted, fontSize: 13, fontWeight: 800 }}>Total seleccionado: {money(selectedRows.reduce((a, r) => a + payableTotal(r), 0))}</div>
      </div>
    </Card>
    <Card><SectionTitle title="Pagos autorizados / programados" helper="Cada pago conserva su expediente, anexos, presupuesto, proveedor, contrato e histórico." />
      <StatusFilter value={statusFilter} onChange={(v) => { setStatusFilter(v); setSelectedIds([]); }} options={baseRows.map((r) => r.status)} total={baseRows.length} shown={rows.length} />
      <MiniTable columns={[{ key: "select", label: "", render: (r) => <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggle(r.id)} /> }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "supplier", label: "Proveedor", render: (r) => { const s = data.suppliers.find((x) => x.id === r.supplierId); return <EntityLink onClick={() => setSelectedSupplier(s)}>{supplierDisplayName(r, data)}</EntityLink>; } }, { key: "concept", label: "Concepto", render: (r) => <EntityLink onClick={() => setSelectedPayment(r)}>{r.concept}</EntityLink> }, { key: "requiredDate", label: "Fecha requerida" }, { key: "scheduledDate", label: "Fecha programada", render: (r) => r.scheduledDate || "Sin programar" }, { key: "amount", label: "Total", render: (r) => money(payableTotal(r)) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => setSelectedPayment(r)}>Revisar</Button><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("payables", r.id, { status: "Programado", scheduledDate: batchDate })}>Programar uno</Button><Button variant="success" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => pay(r)}>Registrar pago</Button></div> }]} rows={rows} />
    </Card>
    <PaymentContextModal row={selectedPayment} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedPayment(null)} />
    <SupplierContextModal supplier={selectedSupplier} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedSupplier(null)} />
  </div>;
}

function PaidPayments({ data, projectMap, categoryMap }) {
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [statusFilter, setStatusFilter] = useState("todos");
  const rows = filterByStatus(data.payments.map((p) => ({ ...p, status: p.reconciled ? "Conciliado" : "Pendiente" })), statusFilter);
  return <div style={{ display: "grid", gap: 16 }}><Card><SectionTitle title="Pagos realizados" helper="Comprobantes de transferencia, referencia bancaria y relación con solicitud. Da clic en la solicitud para ver expediente completo." /><StatusFilter value={statusFilter} onChange={setStatusFilter} options={["Conciliado", "Pendiente"]} total={data.payments.length} shown={rows.length} /><MiniTable columns={[{ key: "date", label: "Fecha" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "payableId", label: "Solicitud", render: (r) => { const payable = data.payables.find((p) => p.id === r.payableId); return payable ? <EntityLink onClick={() => setSelectedPayment(payable)}>{payable.concept}</EntityLink> : r.payableId; } }, { key: "amount", label: "Monto", render: (r) => money(r.amount) }, { key: "bank", label: "Banco" }, { key: "reference", label: "Referencia" }, { key: "reconciled", label: "Conciliado", render: (r) => <Pill tone={r.reconciled ? "ok" : "warn"}>{r.reconciled ? "Sí" : "Pendiente"}</Pill> }]} rows={rows} /></Card><PaymentContextModal row={selectedPayment} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedPayment(null)} /></div>;
}
function BankReconciliation({ data, projectMap, updateRecord }) {
  const [statusFilter, setStatusFilter] = useState("todos");
  const rows = filterByStatus(data.payments.map((p) => ({ ...p, status: p.reconciled ? "Conciliado" : "Pendiente" })), statusFilter);
  return <div style={{ display: "grid", gap: 16 }}><Card><SectionTitle title="Conciliación bancaria" helper="Cruce contra estado de cuenta. Marca diferencia si el importe bancario no coincide con el pago." /><StatusFilter value={statusFilter} onChange={setStatusFilter} options={["Conciliado", "Pendiente"]} total={data.payments.length} shown={rows.length} /><MiniTable columns={[{ key: "date", label: "Fecha" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "amount", label: "Monto sistema", render: (r) => money(r.amount) }, { key: "bank", label: "Banco" }, { key: "reference", label: "Referencia" }, { key: "reconciled", label: "Estatus", render: (r) => <Pill tone={r.reconciled ? "ok" : "danger"}>{r.reconciled ? "Conciliado" : "Pendiente"}</Pill> }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button style={{ padding: "7px 9px", fontSize: 12 }} disabled={r.reconciled} onClick={() => { const bankAmount = Number(window.prompt("Monto en banco", r.amount) || r.amount); updateRecord("payments", r.id, { reconciled: true, reconciledAt: todayIso(), bankAmount, difference: bankAmount - Number(r.amount || 0) }); }}>Conciliar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("payments", r.id, { reconciled: false, difference: Number(window.prompt("Diferencia detectada", r.difference || 0) || 0) })}>Marcar diferencia</Button></div> }]} rows={rows} /></Card></div>;
}

function PettyCash({ data, projectMap, categoryMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const [cashStatusFilter, setCashStatusFilter] = useState("todos");
  const [expenseStatusFilter, setExpenseStatusFilter] = useState("todos");
  const [replenishCash, setReplenishCash] = useState(null);
  const openByResponsible = (responsible) => data.pettyCash.some((cc) => cc.responsible?.toLowerCase() === String(responsible || "").toLowerCase() && !["Cerrada", "Cancelada"].includes(cc.status));
  const baseCashRows = data.pettyCash.map((cc) => {
    const expenses = data.pettyExpenses.filter((e) => e.cashId === cc.id);
    const spent = expenses.reduce((a, e) => a + Number(e.amount || 0), 0);
    const observed = expenses.filter((e) => ["Observado", "Rechazado", "Pendiente comprobante", "Pendiente factura/XML"].includes(e.status)).length;
    const pending = expenses.filter((e) => !["Aceptado", "Rechazado"].includes(e.status)).length;
    return { ...cc, spent, balance: Number(cc.amount || 0) - spent, observed, pending };
  });
  const cashRows = filterByStatus(baseCashRows, cashStatusFilter);
  const expenseRows = filterByStatus(data.pettyExpenses || [], expenseStatusFilter);
  function createCash() {
    if (openByResponsible(form.responsible)) { alert("Este responsable tiene una caja chica abierta o en revisión. Primero debe liquidarse o cerrarse."); return; }
    addRecord("pettyCash", { projectId: form.projectId || "arenna", name: form.name || "Caja chica", responsible: form.responsible || "Responsable", amount: Number(form.amount || 0), status: "Abierta", openedAt: todayIso(), originAccount: form.originAccount || "Banco por definir", notes: form.notes || "" });
  }
  function addExpense() {
    const cash = data.pettyCash.find((cc) => cc.id === (form.cashId || data.pettyCash[0]?.id));
    if (!cash) { alert("Primero crea una caja chica."); return; }
    addRecord("pettyExpenses", { cashId: cash.id, projectId: cash.projectId, date: form.date || todayIso(), concept: form.concept || "Gasto menor", categoryId: form.categoryId || "caja_chica", amount: Number(form.amount || 0), iva: Number(form.iva || 0), retention: Number(form.retention || 0), totalInput: Number(form.totalInput || form.amount || 0), establishment: form.establishment || form.supplier || "", supplier: form.supplier || form.establishment || "", taxpayerType: form.taxpayerType || "Persona moral", status: form.hasReceipt === "No" ? "Pendiente comprobante" : "Por revisar", hasReceipt: form.hasReceipt !== "No", invoiceRequired: form.invoiceRequired === "Sí", attachments: normalizeAttachments(form.attachments), comment: form.comment || "" });
  }
  function saveReplenishmentExpense(line) {
    addRecord("pettyExpenses", { cashId: replenishCash.id, projectId: replenishCash.projectId, date: line.date || todayIso(), concept: line.concept || "Gasto de caja chica", categoryId: line.categoryId || "caja_chica", amount: Number(line.amount || 0), iva: Number(line.iva || 0), retention: Number(line.retention || 0), totalInput: Number(line.totalInput || 0), establishment: line.establishment || "", supplier: line.establishment || "", taxpayerType: line.taxpayerType || "Persona moral", status: "Por revisar", hasReceipt: attachmentCount(line.attachments) > 0, invoiceRequired: false, attachments: normalizeAttachments(line.attachments), comment: "Cargado desde reposición de caja chica" });
  }
  function sendReplenishment(lines) {
    if (!replenishCash) return;
    lines.forEach(saveReplenishmentExpense);
    const totalBase = lines.reduce((a, x) => a + Number(x.amount || 0), 0);
    const totalIva = lines.reduce((a, x) => a + Number(x.iva || 0), 0);
    const totalRetention = lines.reduce((a, x) => a + Number(x.retention || 0), 0);
    const attachments = lines.flatMap((x) => normalizeAttachments(x.attachments).map((a) => ({ ...a, relatedConcept: x.concept, relatedEstablishment: x.establishment })));
    addRecord("payables", { projectId: replenishCash.projectId, supplierId: "", supplier: `Reposición caja chica - ${replenishCash.responsible}`, concept: `Reposición de caja chica · ${replenishCash.name}`, categoryId: "caja_chica", contractId: "", paymentStage: "Reposición caja chica", amount: roundMoney(totalBase), iva: roundMoney(totalIva), retention: roundMoney(totalRetention), requestedBy: currentFinanceUser().email || replenishCash.responsible, requestedByName: currentFinanceUser().name || replenishCash.responsible, requiredDate: todayIso(), status: "Solicitado", priority: "Media", documentStatus: attachments.length ? "Soporte cargado" : "Pendiente anexos", attachments, adminReviewed: false, notes: `Reposición ligada a caja ${replenishCash.name}`, pettyCashId: replenishCash.id, pettyCashResponsible: replenishCash.responsible, createdAt: todayIso() });
    updateRecord("pettyCash", replenishCash.id, { status: "Reposición solicitada", lastReplenishmentAt: todayIso() });
    setReplenishCash(null);
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Caja chica operativa" helper="Mini flujo de cuentas por pagar: apertura → comprobantes → revisión → liquidación → cierre financiero." />
      <ProgressLine items={[{ label: "Crear caja", done: true }, { label: "Cargar gastos", active: true }, { label: "Revisión admin" }, { label: "Liquidar" }, { label: "Cerrar" }]} />
    </Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Cajas abiertas" helper="No se permite abrir otra caja al mismo responsable si tiene una sin liquidar." /><Button onClick={() => setShowForm(showForm === "cash" ? null : "cash")}>Crear caja</Button></div>
      {showForm === "cash" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Responsable"><input style={inputStyle()} value={form.responsible || ""} onChange={(e) => setForm({ ...form, responsible: e.target.value })} /></Field><Field label="Monto asignado"><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Cuenta / origen"><input style={inputStyle()} value={form.originAccount || ""} onChange={(e) => setForm({ ...form, originAccount: e.target.value })} /></Field></div><Field label="Nombre / motivo"><input style={inputStyle()} value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Button onClick={createCash}>Guardar caja chica</Button></div> : null}
    </Card>
    <Card><StatusFilter value={cashStatusFilter} onChange={setCashStatusFilter} options={baseCashRows.map((r) => r.status)} total={baseCashRows.length} shown={cashRows.length} /><MiniTable columns={[{ key: "name", label: "Caja" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "responsible", label: "Responsable" }, { key: "amount", label: "Asignado", render: (r) => money(r.amount) }, { key: "spent", label: "Comprobado", render: (r) => money(r.spent) }, { key: "balance", label: "Saldo", render: (r) => <Pill tone={r.balance >= 0 ? "ok" : "danger"}>{money(r.balance)}</Pill> }, { key: "pending", label: "Pendientes", render: (r) => <Pill tone={r.pending || r.observed ? "warn" : "ok"}>{r.pending} / obs {r.observed}</Pill> }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => setReplenishCash(r)}>Reponer caja</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("pettyCash", r.id, { status: "En revisión" })}>Solicitar liquidación</Button><Button variant="success" style={{ padding: "7px 9px", fontSize: 12 }} disabled={r.pending > 0 || r.observed > 0} onClick={() => updateRecord("pettyCash", r.id, { status: "Cerrada", closedAt: todayIso() })}>Cerrar</Button></div> }]} rows={cashRows} /></Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Comprobantes / gastos" helper="Cada gasto se revisa individualmente. Observados o sin comprobante bloquean el cierre de caja." /><Button onClick={() => setShowForm(showForm === "cashExpense" ? null : "cashExpense")}>Agregar gasto</Button></div>
      {showForm === "cashExpense" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Caja"><select style={inputStyle()} value={form.cashId || data.pettyCash[0]?.id || ""} onChange={(e) => setForm({ ...form, cashId: e.target.value })}>{data.pettyCash.map((cc) => <option key={cc.id} value={cc.id}>{cc.name} · {cc.responsible}</option>)}</select></Field><Field label="Fecha"><input type="date" style={inputStyle()} value={form.date || todayIso()} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field><Field label="Categoría"><select style={inputStyle()} value={form.categoryId || "caja_chica"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((cat) => cat.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field><Field label="Establecimiento / proveedor"><input style={inputStyle()} value={form.establishment || ""} onChange={(e) => setForm({ ...form, establishment: e.target.value })} /></Field><Field label="Persona fiscal"><select style={inputStyle()} value={form.taxpayerType || "Persona moral"} onChange={(e) => setForm({ ...form, taxpayerType: e.target.value })}>{TAXPAYER_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field><Field label="Monto antes IVA"><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => { const v = calcTaxValues(e.target.value, { taxpayerType: form.taxpayerType || "Persona moral" }, "base"); setForm({ ...form, ...v }); }} /></Field><Field label="Total pagado"><input type="number" style={inputStyle()} value={form.totalInput || ""} onChange={(e) => { const v = calcTaxValues(e.target.value, { taxpayerType: form.taxpayerType || "Persona moral" }, "total"); setForm({ ...form, ...v }); }} /></Field><Field label="IVA"><input type="number" style={inputStyle()} value={form.iva || ""} onChange={(e) => setForm({ ...form, iva: e.target.value })} /></Field><Field label="Retención"><input type="number" style={inputStyle()} value={form.retention || ""} onChange={(e) => setForm({ ...form, retention: e.target.value })} /></Field><Field label="Comprobante"><select style={inputStyle()} value={form.hasReceipt || "Sí"} onChange={(e) => setForm({ ...form, hasReceipt: e.target.value })}><option>Sí</option><option>No</option></select></Field><Field label="Factura/XML requerido"><select style={inputStyle()} value={form.invoiceRequired || "No"} onChange={(e) => setForm({ ...form, invoiceRequired: e.target.value })}><option>No</option><option>Sí</option></select></Field></div><Field label="Concepto"><input style={inputStyle()} value={form.concept || ""} onChange={(e) => setForm({ ...form, concept: e.target.value })} /></Field><AttachmentUploader label="Subir ticket / factura / XML" value={form.attachments} folder="finanzas/caja-chica" onChange={(attachments) => setForm({ ...form, attachments })} helper="Carga ticket, factura PDF, XML o foto del comprobante." /><Button onClick={addExpense}>Guardar gasto</Button></div> : null}
    </Card>
    <Card><StatusFilter value={expenseStatusFilter} onChange={setExpenseStatusFilter} options={(data.pettyExpenses || []).map((r) => r.status)} total={(data.pettyExpenses || []).length} shown={expenseRows.length} /><MiniTable columns={[{ key: "date", label: "Fecha" }, { key: "establishment", label: "Establecimiento", render: (r) => r.establishment || r.supplier || "—" }, { key: "concept", label: "Concepto" }, { key: "categoryId", label: "Categoría", render: (r) => categoryMap[r.categoryId]?.name }, { key: "amount", label: "Total", render: (r) => money(r.totalInput || r.amount) }, { key: "attachments", label: "Anexos", render: (r) => <AttachmentViewer value={r.attachments} /> }, { key: "status", label: "Estado", render: (r) => <div><Pill tone={statusTone(r.status)}>{r.status}</Pill><div style={{ color: c.muted, fontSize: 11, marginTop: 5 }}>Automático por revisión</div></div> }, { key: "expenseActions", label: "Acciones", sortable: false, render: (r) => <ActionCell><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("pettyExpenses", r.id, { status: "Aceptado", reviewedAt: todayIso(), reviewedBy: currentFinanceUser().email })}>Aceptar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("pettyExpenses", r.id, { status: "Observado", reviewComment: window.prompt("Observación", r.reviewComment || "") || "Observado" })}>Observar</Button><Button variant="danger" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("pettyExpenses", r.id, { status: "Rechazado", rejectedAt: todayIso() })}>Rechazar</Button></ActionCell> }]} rows={expenseRows} /></Card>
    <PettyReplenishmentModal cash={replenishCash} data={data} categoryMap={categoryMap} onClose={() => setReplenishCash(null)} onSaveExpense={saveReplenishmentExpense} onSendReplenishment={sendReplenishment} />
  </div>;
}

function supplierDisplayName(row, data) {
  const supplier = data.suppliers.find((s) => s.id === row.supplierId);
  return supplier?.tradeName || row.supplier || "Proveedor";
}

function Suppliers({ data, projectMap, categoryMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [statusFilter, setStatusFilter] = useState("todos");
  const statuses = ["Pendiente revisión", "Activo", "Bloqueado", "Inactivo"];
  function createSupplier() {
    addRecord("suppliers", {
      tradeName: form.tradeName || "Proveedor",
      legalName: form.legalName || form.tradeName || "Razón social",
      rfc: form.rfc || "",
      type: form.type || "Proveedor",
      taxpayerType: form.taxpayerType || "Persona moral",
      ivaRate: Number(form.ivaRate || 0.16),
      isrRetentionRate: Number(form.isrRetentionRate || 0),
      ivaRetentionRate: Number(form.ivaRetentionRate || 0),
      taxProfileCustomized: true,
      contact: form.contact || "",
      email: form.email || "",
      phone: form.phone || "",
      whatsapp: form.whatsapp || "",
      status: "Pendiente revisión",
      fiscalStatus: form.fiscalStatus || "Pendiente",
      bankStatus: form.bankStatus || "Pendiente",
      bank: form.bank || "",
      clabe: form.clabe || "",
      accountHolder: form.accountHolder || form.legalName || "",
      categoryId: form.categoryId || "construccion",
      requiresContract: form.requiresContract === "Sí",
      notifyEmail: form.notifyEmail !== "No",
      notifyWhatsapp: form.notifyWhatsapp === "Sí",
      notifyOnRequested: true,
      notifyOnScheduled: true,
      notifyOnPaid: true,
      documents: normalizeAttachments(form.documents),
      notes: form.notes || "",
      createdAt: todayIso(),
      reviewedBy: "",
      communicationLog: [{ date: todayIso(), channel: "Sistema", event: "Alta de proveedor", detail: "Proveedor creado desde Finanzas." }],
    });
  }
  const allRows = data.suppliers || [];
  const rows = filterByStatus(allRows, statusFilter);
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Proveedores" helper="Ficha 360: alta, edición, datos fiscales, bancos, documentos, canales de aviso, historial y pagos ligados." />
      <ProgressLine items={[{ label: "Alta", done: true }, { label: "Documentos" }, { label: "Validación fiscal" }, { label: "Validación bancaria" }, { label: "Activo" }]} />
    </Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Alta de proveedor" helper="Captura lo mínimo; después abre la ficha del proveedor para completar datos, documentación y canales de aviso." /><Button onClick={() => setShowForm(showForm === "supplier" ? null : "supplier")}>Nuevo proveedor</Button></div>
      {showForm === "supplier" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
          <Field label="Nombre comercial"><input style={inputStyle()} value={form.tradeName || ""} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} /></Field>
          <Field label="Razón social"><input style={inputStyle()} value={form.legalName || ""} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></Field>
          <Field label="RFC"><input style={inputStyle()} value={form.rfc || ""} onChange={(e) => setForm({ ...form, rfc: e.target.value.toUpperCase() })} /></Field>
          <Field label="Tipo"><select style={inputStyle()} value={form.type || "Proveedor"} onChange={(e) => setForm({ ...form, type: e.target.value })}><option>Constructora</option><option>Servicios profesionales</option><option>Materiales</option><option>Dependencia</option><option>Arrendador</option><option>Proveedor</option></select></Field>
          <Field label="Persona fiscal"><select style={inputStyle()} value={form.taxpayerType || "Persona moral"} onChange={(e) => { const profile = taxProfileForSupplier({ taxpayerType: e.target.value }); setForm({ ...form, taxpayerType: e.target.value, ivaRate: profile.ivaRate, isrRetentionRate: profile.isrRetentionRate, ivaRetentionRate: profile.ivaRetentionRate }); }}>{TAXPAYER_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Contacto"><input style={inputStyle()} value={form.contact || ""} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
          <Field label="Correo de pagos"><input type="email" style={inputStyle()} value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="WhatsApp"><input style={inputStyle()} placeholder="521999..." value={form.whatsapp || ""} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></Field>
          <Field label="Categoría default"><select style={inputStyle()} value={form.categoryId || "construccion"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((cat) => cat.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field>
          <Field label="Requiere contrato"><select style={inputStyle()} value={form.requiresContract || "No"} onChange={(e) => setForm({ ...form, requiresContract: e.target.value })}><option>No</option><option>Sí</option></select></Field>
          <Field label="Banco"><input style={inputStyle()} value={form.bank || ""} onChange={(e) => setForm({ ...form, bank: e.target.value })} /></Field>
          <Field label="CLABE"><input style={inputStyle()} value={form.clabe || ""} onChange={(e) => setForm({ ...form, clabe: e.target.value })} /></Field>
          <Field label="Beneficiario"><input style={inputStyle()} value={form.accountHolder || ""} onChange={(e) => setForm({ ...form, accountHolder: e.target.value })} /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Avisar por correo"><select style={inputStyle()} value={form.notifyEmail || "Sí"} onChange={(e) => setForm({ ...form, notifyEmail: e.target.value })}><option>Sí</option><option>No</option></select></Field><Field label="Avisar por WhatsApp"><select style={inputStyle()} value={form.notifyWhatsapp || "No"} onChange={(e) => setForm({ ...form, notifyWhatsapp: e.target.value })}><option>No</option><option>Sí</option></select></Field></div>
        <AttachmentUploader label="Subir documentos iniciales" value={form.documents} folder="finanzas/proveedores" onChange={(documents) => setForm({ ...form, documents })} helper="Constancia fiscal, carátula bancaria, opinión de cumplimiento, contrato marco u otros soportes." />
        <Button onClick={createSupplier}>Guardar proveedor</Button>
      </div> : null}
    </Card>
    <Card><SectionTitle title="Validación administrativa" helper="Da clic en el nombre para consultar histórico. Usa Editar para cambiar datos, agregar documentos o configurar avisos por correo/WhatsApp." /><StatusFilter value={statusFilter} onChange={setStatusFilter} options={allRows.map((r) => r.status)} total={allRows.length} shown={rows.length} /><MiniTable columns={[{ key: "tradeName", label: "Proveedor", render: (r) => <EntityLink onClick={() => setSelectedSupplier(r)}>{r.tradeName}</EntityLink> }, { key: "rfc", label: "RFC" }, { key: "type", label: "Tipo", render: (r) => <div><b>{r.type}</b><div style={{ color: c.muted, fontSize: 11 }}>{r.taxpayerType || "Persona moral"}</div></div> }, { key: "contact", label: "Contacto", render: (r) => <div><b>{r.contact || "—"}</b><div style={{ color: c.muted, fontSize: 12 }}>{r.email || "sin correo"}{r.whatsapp ? ` · WA ${r.whatsapp}` : ""}</div></div> }, { key: "categoryId", label: "Categoría", render: (r) => categoryMap[r.categoryId]?.name }, { key: "fiscalStatus", label: "Fiscal", render: (r) => <select value={r.fiscalStatus || "Pendiente"} onChange={(e) => updateRecord("suppliers", r.id, { fiscalStatus: e.target.value })} style={inputStyle({ padding: 8, minWidth: 125 })}>{["Pendiente", "Validado", "Observado", "No aplica"].map((x) => <option key={x}>{x}</option>)}</select> }, { key: "bankStatus", label: "Banco", render: (r) => <select value={r.bankStatus || "Pendiente"} onChange={(e) => updateRecord("suppliers", r.id, { bankStatus: e.target.value })} style={inputStyle({ padding: 8, minWidth: 125 })}>{["Pendiente", "Validado", "Observado", "No aplica"].map((x) => <option key={x}>{x}</option>)}</select> }, { key: "documents", label: "Docs", render: (r) => <Pill tone={attachmentCount(r.documents) ? "ok" : "warn"}>{attachmentCount(r.documents)}</Pill> }, { key: "ready", label: "Listo", render: (r) => <Pill tone={supplierReady(r) ? "ok" : "warn"}>{supplierReady(r) ? "Pagable" : "Bloquea pago"}</Pill> }, { key: "status", label: "Estatus", render: (r) => <select value={r.status} onChange={(e) => updateRecord("suppliers", r.id, { status: e.target.value, reviewedBy: "admin@tritondesarrollos.com" })} style={inputStyle({ padding: 8, minWidth: 150 })}>{statuses.map((s) => <option key={s}>{s}</option>)}</select> }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => setSelectedSupplier(r)}>Ficha</Button><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => setEditingSupplier(r)}>Editar</Button></div> }]} rows={rows} /></Card>
    <SupplierContextModal supplier={selectedSupplier} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedSupplier(null)} onEdit={(s) => { setSelectedSupplier(null); setEditingSupplier(s); }} />
    <SupplierEditModal supplier={editingSupplier} data={data} categoryMap={categoryMap} onClose={() => setEditingSupplier(null)} onSave={(patch) => { updateRecord("suppliers", editingSupplier.id, patch); setSelectedSupplier(patch); setEditingSupplier(null); }} />
  </div>;
}

function ConstructionTeam({ data, projectMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><SectionTitle title="Alta de equipo de construcción" helper="Este módulo vive dentro de Operación/Calidad. Sirve para dar acceso operativo a constructoras sin mezclarlas con usuarios del sistema completo." /><Button onClick={() => setShowForm(showForm === "constructionTeam" ? null : "constructionTeam")}>Agregar constructora</Button></div>
      {showForm === "constructionTeam" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
          <Field label="Obra / proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Empresa"><input style={inputStyle()} value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Contacto"><input style={inputStyle()} value={form.contact || ""} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
          <Field label="Correo"><input style={inputStyle()} value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        </div>
        <Button onClick={() => addRecord("constructionTeam", { projectId: form.projectId || "arenna", name: form.name || "Constructora", contact: form.contact || "", email: form.email || "", role: "constructora", status: "Activo", createdBy: "supervision@tritondesarrollos.com" })}>Guardar acceso operativo</Button>
      </div> : null}
    </Card>
    <Card><MiniTable columns={[{ key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "name", label: "Empresa" }, { key: "contact", label: "Contacto" }, { key: "email", label: "Correo" }, { key: "status", label: "Estatus", render: (r) => <Pill tone={r.status === "Activo" ? "ok" : "danger"}>{r.status}</Pill> }, { key: "actions", label: "Acción", render: (r) => <Button variant={r.status === "Activo" ? "danger" : "secondary"} style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("constructionTeam", r.id, { status: r.status === "Activo" ? "Baja" : "Activo" })}>{r.status === "Activo" ? "Dar baja" : "Reactivar"}</Button> }]} rows={data.constructionTeam} /></Card>
  </div>;
}

function tenantName(charge, data) { const contract = data.contracts.find((c) => c.id === charge.contractId); return data.tenants.find((t) => t.id === contract?.tenantId)?.name || "Arrendatario"; }
function Rentals({ data, projectMap, tenantMap, assetMap, contractMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  return <div style={{ display: "grid", gap: 16 }}><Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><SectionTitle title="Cobranza de rentas" helper="Control mensual de locales, terrenos, casas, departamentos, contratos, INPC, cédulas, facturación y conciliación." /><Button onClick={() => setShowForm(showForm === "rent" ? null : "rent")}>Generar renta manual</Button></div>{showForm === "rent" ? <div style={{ display: "grid", gap: 10, marginTop: 12 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Contrato"><select style={inputStyle()} value={form.contractId || "r1"} onChange={(e) => setForm({ ...form, contractId: e.target.value })}>{data.contracts.map((r) => <option key={r.id} value={r.id}>{tenantMap[r.tenantId]?.name} · {assetMap[r.assetId]?.name}</option>)}</select></Field><Field label="Periodo"><input style={inputStyle()} value={form.period || "2026-03"} onChange={(e) => setForm({ ...form, period: e.target.value })} /></Field></div><Button onClick={() => { const ct = data.contracts.find((x) => x.id === (form.contractId || "r1")); addRecord("rentCharges", { contractId: ct?.id || "r1", period: form.period || "2026-03", rent: Number(ct?.rentBase || 0), maintenance: Number(ct?.rentBase || 0) * Number(ct?.maintenancePct || 0) / 100, status: "Pendiente", paidAmount: 0, dueDate: `${form.period || "2026-03"}-${String(ct?.paymentDay || 10).padStart(2, "0")}`, bankReference: ct?.reference || "", invoiceStatus: ct?.autoInvoice ? "Por emitir" : "No automática" }); }}>Generar cargo</Button></div> : null}</Card><Card><MiniTable columns={[{ key: "contractId", label: "Cliente", render: (r) => tenantName(r, data) }, { key: "contractId2", label: "Inmueble", render: (r) => assetMap[contractMap[r.contractId]?.assetId]?.name }, { key: "period", label: "Periodo" }, { key: "rent", label: "Renta base", render: (r) => money(r.rent) }, { key: "maintenance", label: "Mantto", render: (r) => money(r.maintenance) }, { key: "paidAmount", label: "Pagado", render: (r) => money(r.paidAmount) }, { key: "status", label: "Estado", render: (r) => <Pill tone={r.status === "Pagado" ? "ok" : r.status === "Vencido" ? "danger" : "warn"}>{r.status}</Pill> }, { key: "bankReference", label: "Referencia" }, { key: "invoiceStatus", label: "Factura" }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6 }}><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("rentCharges", r.id, { status: "Pagado", paidAmount: Number(r.rent || 0) + Number(r.maintenance || 0), invoiceStatus: "Emitida" })}>Marcar pagado</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("rentCharges", r.id, { status: "Vencido" })}>Vencido</Button></div> }]} rows={data.rentCharges} /></Card><Card><SectionTitle title="Contratos" helper="Incluye INPC, fecha de última actualización, cédula vigente y facturación automática." /><MiniTable columns={[{ key: "tenantId", label: "Arrendatario", render: (r) => tenantMap[r.tenantId]?.name }, { key: "assetId", label: "Inmueble", render: (r) => assetMap[r.assetId]?.name }, { key: "rentBase", label: "Renta", render: (r) => money(r.rentBase) }, { key: "maintenancePct", label: "Mantto %", render: (r) => `${r.maintenancePct || 0}%` }, { key: "paymentDay", label: "Día pago" }, { key: "inpcMonth", label: "INPC" }, { key: "lastIncreaseDate", label: "Última act." }, { key: "status", label: "Estado", render: (r) => <Pill tone="primary">{r.status}</Pill> }]} rows={data.contracts} /></Card></div>;
}

function Permits({ data, projectMap, rows, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const [statusFilter, setStatusFilter] = useState("todos");
  const statuses = ["No iniciado", "Preparando documentos", "Ingresado", "En revisión", "Observado", "En corrección", "Aprobado", "Rechazado", "Vencido", "Cerrado"];
  const displayedRows = filterByStatus(rows, statusFilter);
  return <div style={{ display: "grid", gap: 16 }}><Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><SectionTitle title="Trámites por proyecto" helper="Cada trámite debe tener responsable, siguiente acción y fecha compromiso. Evita el estatus genérico “en proceso”." /><Button onClick={() => setShowForm(showForm === "permit" ? null : "permit")}>Nuevo trámite</Button></div>{showForm === "permit" ? <div style={{ marginTop: 12 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Nombre"><input style={inputStyle()} value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Dependencia"><input style={inputStyle()} value={form.agency || ""} onChange={(e) => setForm({ ...form, agency: e.target.value })} /></Field><Field label="Responsable"><input style={inputStyle()} value={form.owner || ""} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></Field><Field label="Fecha compromiso"><input style={inputStyle()} type="date" value={form.dueDate || todayIso()} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field></div><Field label="Siguiente acción"><textarea style={inputStyle({ minHeight: 70 })} value={form.nextAction || ""} onChange={(e) => setForm({ ...form, nextAction: e.target.value })} /></Field><Button style={{ marginTop: 10 }} onClick={() => addRecord("permits", { projectId: form.projectId || "arenna", name: form.name || "Trámite", agency: form.agency || "Dependencia", status: "No iniciado", priority: "Media", owner: form.owner || "Responsable", nextAction: form.nextAction || "Definir siguiente acción", dueDate: form.dueDate || todayIso(), documents: "" })}>Guardar trámite</Button></div> : null}</Card><Card><StatusFilter value={statusFilter} onChange={setStatusFilter} options={rows.map((r) => r.status)} total={rows.length} shown={displayedRows.length} /><MiniTable columns={[{ key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "name", label: "Trámite" }, { key: "agency", label: "Dependencia" }, { key: "owner", label: "Responsable" }, { key: "nextAction", label: "Siguiente acción" }, { key: "dueDate", label: "Fecha compromiso" }, { key: "status", label: "Estado", render: (r) => <select value={r.status} onChange={(e) => updateRecord("permits", r.id, { status: e.target.value })} style={inputStyle({ padding: 8, minWidth: 150 })}>{statuses.map((s) => <option key={s}>{s}</option>)}</select> }, { key: "priority", label: "Prioridad", render: (r) => <Pill tone={r.priority === "Alta" ? "danger" : "primary"}>{r.priority}</Pill> }]} rows={displayedRows} /></Card></div>;
}

function Clients({ data, projectMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const [search, setSearch] = useState("");
  const rows = (data.clients || []).filter((c) => [c.name, c.email, c.phone, c.unit, c.contractRef].join(" ").toLowerCase().includes(search.toLowerCase()));
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Clientes" helper="Compradores, pagadores y contratos de compraventa relacionados a ingresos." /><Button onClick={() => setShowForm(showForm === "client" ? null : "client")}>Nuevo cliente</Button></div>{showForm === "client" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Nombre"><input style={inputStyle()} value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Tipo"><select style={inputStyle()} value={form.type || "Comprador"} onChange={(e) => setForm({ ...form, type: e.target.value })}><option>Comprador</option><option>Inversionista</option><option>Socio</option><option>Otro</option></select></Field><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Unidad"><input style={inputStyle()} value={form.unit || ""} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field><Field label="Contrato"><input style={inputStyle()} value={form.contractRef || ""} onChange={(e) => setForm({ ...form, contractRef: e.target.value })} /></Field><Field label="Correo"><input style={inputStyle()} value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field><Field label="Teléfono"><input style={inputStyle()} value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field></div><Button onClick={() => addRecord("clients", { name: form.name || "Cliente", type: form.type || "Comprador", projectId: form.projectId || "arenna", unit: form.unit || "", contractRef: form.contractRef || "", email: form.email || "", phone: form.phone || "", status: "Activo" })}>Guardar cliente</Button></div> : null}</Card>
    <Card><div style={{ marginBottom: 12 }}><Field label="Buscar cliente"><input style={inputStyle({ maxWidth: 380 })} placeholder="Nombre, correo, unidad o contrato" value={search} onChange={(e) => setSearch(e.target.value)} /></Field></div><MiniTable columns={[{ key: "name", label: "Cliente", render: (r) => <EntityLink onClick={() => setForm(r) || setShowForm("client")}>{r.name}</EntityLink> }, { key: "type", label: "Tipo" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "unit", label: "Unidad" }, { key: "contractRef", label: "Contrato" }, { key: "email", label: "Correo" }, { key: "phone", label: "Teléfono" }, { key: "status", label: "Estado", render: (r) => <Pill tone="primary">{r.status}</Pill> }]} rows={rows} /></Card>
  </div>;
}

function Incomes({ data, projectMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const [statusFilter, setStatusFilter] = useState("todos");
  const rows = filterByStatus(data.incomes || [], statusFilter);
  const clientMap = Object.fromEntries((data.clients || []).map((c) => [c.id, c]));
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Ingresos" helper="Registro de ingresos por proyecto, cliente, contrato de compraventa y unidad." /><Button onClick={() => setShowForm(showForm === "income" ? null : "income")}>Nuevo ingreso</Button></div>{showForm === "income" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Cliente"><select style={inputStyle()} value={form.clientId || data.clients?.[0]?.id || ""} onChange={(e) => { const cl = (data.clients || []).find((x) => x.id === e.target.value); setForm({ ...form, clientId: e.target.value, unit: cl?.unit || form.unit, contractRef: cl?.contractRef || form.contractRef, projectId: cl?.projectId || form.projectId }); }}>{(data.clients || []).map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}</select></Field><Field label="Tipo de ingreso"><select style={inputStyle()} value={form.type || "Enganche"} onChange={(e) => setForm({ ...form, type: e.target.value })}><option>Apartado</option><option>Enganche</option><option>Mensualidad</option><option>Escrituración</option><option>Aportación</option><option>Otro</option></select></Field><Field label="Unidad"><input style={inputStyle()} value={form.unit || ""} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field><Field label="Contrato CV"><input style={inputStyle()} value={form.contractRef || ""} onChange={(e) => setForm({ ...form, contractRef: e.target.value })} /></Field><Field label="Monto"><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Banco"><input style={inputStyle()} value={form.bank || ""} onChange={(e) => setForm({ ...form, bank: e.target.value })} /></Field><Field label="Referencia"><input style={inputStyle()} value={form.reference || ""} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field></div><Field label="Concepto"><input style={inputStyle()} value={form.concept || ""} onChange={(e) => setForm({ ...form, concept: e.target.value })} /></Field><AttachmentUploader label="Anexos del ingreso" value={form.attachments} folder="finanzas/ingresos" onChange={(attachments) => setForm({ ...form, attachments })} /><Button onClick={() => addRecord("incomes", { projectId: form.projectId || "arenna", clientId: form.clientId || data.clients?.[0]?.id || "", type: form.type || "Enganche", concept: form.concept || "Ingreso", amount: Number(form.amount || 0), date: todayIso(), unit: form.unit || "", contractRef: form.contractRef || "", status: "Recibido", bank: form.bank || "", reference: form.reference || "", attachments: normalizeAttachments(form.attachments) })}>Guardar ingreso</Button></div> : null}</Card>
    <Card><StatusFilter value={statusFilter} onChange={setStatusFilter} options={(data.incomes || []).map((r) => r.status)} total={(data.incomes || []).length} shown={rows.length} /><MiniTable columns={[{ key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "clientId", label: "Cliente", render: (r) => clientMap[r.clientId]?.name || "—" }, { key: "type", label: "Tipo" }, { key: "concept", label: "Concepto" }, { key: "unit", label: "Unidad" }, { key: "contractRef", label: "Contrato" }, { key: "amount", label: "Monto", render: (r) => money(r.amount) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "attachments", label: "Anexos", render: (r) => <AttachmentViewer value={r.attachments} /> }]} rows={rows} /></Card>
  </div>;
}

function PermitsTimeline({ data, projectMap, rows, mode, updateRecord }) {
  const [projectId, setProjectId] = useState(data.projects[0]?.id || "arenna");
  const projectRows = rows.filter((r) => r.projectId === projectId);
  const stages = Array.from(new Set(projectRows.map((r) => r.stage || r.group || (r.name?.toLowerCase().includes("uso") ? "Licencia de uso de suelo" : "Licencia de construcción"))));
  function exportPdf() { window.print(); }
  if (mode === "tramites_expediente") return <div style={{ display: "grid", gap: 16 }}><Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Expediente documental de trámites" helper="Archiva soportes y genera respaldo en PDF cuando se necesite documentación." /><Button onClick={exportPdf}>Exportar / imprimir PDF</Button></div><Field label="Proyecto"><select style={inputStyle({ width: 260 })} value={projectId} onChange={(e) => setProjectId(e.target.value)}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></Card><Card><MiniTable columns={[{ key: "name", label: "Trámite" }, { key: "agency", label: "Dependencia" }, { key: "documents", label: "Documentos" }, { key: "nextAction", label: "Último comentario" }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }]} rows={projectRows} /></Card></div>;
  return <div style={{ display: "grid", gap: 16 }}><Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Línea del tiempo de trámites" helper="Cada proyecto muestra etapas, estatus, responsables y próxima acción." /><Button onClick={exportPdf}>Exportar / imprimir PDF</Button></div><Field label="Proyecto"><select style={inputStyle({ width: 260 })} value={projectId} onChange={(e) => setProjectId(e.target.value)}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></Card><div style={{ display: "grid", gap: 14 }}>{stages.map((stage) => <Card key={stage}><SectionTitle title={stage} helper={projectMap[projectId]?.name || projectId} /><div style={{ display: "grid", gap: 8 }}>{projectRows.filter((r) => (r.stage || r.group || (r.name?.toLowerCase().includes("uso") ? "Licencia de uso de suelo" : "Licencia de construcción")) === stage).map((r) => <div key={r.id} style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) 150px minmax(220px,1.4fr)", gap: 10, alignItems: "center", padding: 10, border: `1px solid ${c.border}`, borderRadius: 16 }}><b>{r.name}</b><Pill tone={statusTone(r.status)}>{r.status}</Pill><span style={{ color: c.muted, fontSize: 12 }}>{r.nextAction || r.documents || "Sin comentario"}</span></div>)}</div></Card>)}</div></div>;
}

function Reports({ totals, data, projectMap, categoryMap, active = "reportes_os" }) {
  const incomeTotal = (data.incomes || []).reduce((a, r) => a + Number(r.amount || 0), 0);
  const payablesTotal = data.payables.reduce((a, p) => a + payableTotal(p), 0);
  const paidTotal = data.payments.reduce((a, p) => a + Number(p.amount || 0), 0);
  if (active === "reporte_ia") return <div style={{ display: "grid", gap: 16 }}><Card><Pill tone="primary">IA / análisis cruzado</Pill><h3 style={{ margin: "12px 0 4px" }}>Lectura financiera vs operación</h3><p style={{ color: c.muted }}>Aquí se concentrarán análisis automáticos de flujo, calidad, avance de obra, pagos y trámites. Por ahora muestra alertas de ejemplo para pruebas operativas.</p></Card><Card><SectionTitle title="Hallazgos sugeridos" helper="Pistas que el sistema puede generar automáticamente." /><div style={{ display: "grid", gap: 10 }}><div style={{ padding: 12, borderRadius: 16, background: c.orangeSoft }}><b>Presupuesto vs avance:</b> revisar partidas con alto comprometido y baja liberación de calidad.</div><div style={{ padding: 12, borderRadius: 16, background: c.soft }}><b>Flujo:</b> programar pagos autorizados por lote para evitar dispersión de tesorería.</div><div style={{ padding: 12, borderRadius: 16, background: c.greenSoft }}><b>Ingresos:</b> conciliar ingresos contra contratos y unidades para evitar omisiones.</div></div></Card></div>;
  const titleMap = { reporte_obra: "Reportes de obra", reporte_finanzas: "Reportes financieros", reporte_egresos: "Reportes de egresos", reporte_ingresos: "Reportes de ingresos", reportes_os: "Resumen ejecutivo" };
  return <div style={{ display: "grid", gap: 16 }}><Card><SectionTitle title={titleMap[active] || "Reportes"} helper="Submenú directivo por módulo. Cada reporte debe poder exportarse, consultarse y cruzarse con IA." /></Card><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 14 }}><Card><Pill tone="warn">Egresos solicitados</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(payablesTotal)}</div></Card><Card><Pill tone="ok">Pagado</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(paidTotal)}</div></Card><Card><Pill tone="primary">Ingresos</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(incomeTotal)}</div></Card><Card><Pill tone="danger">Cartera rentas</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totals.rentOverdue)}</div></Card></div><Card><MiniTable columns={[{ key: "name", label: "Proyecto" }, { key: "type", label: "Tipo" }, { key: "payables", label: "Egresos", render: (r) => money(data.payables.filter((p) => p.projectId === r.id).reduce((a, p) => a + payableTotal(p), 0)) }, { key: "incomes", label: "Ingresos", render: (r) => money((data.incomes || []).filter((i) => i.projectId === r.id).reduce((a, i) => a + Number(i.amount || 0), 0)) }, { key: "permits", label: "Trámites abiertos", render: (r) => data.permits.filter((p) => p.projectId === r.id && !["Aprobado", "Cerrado"].includes(p.status)).length }, { key: "status", label: "Estatus", render: (r) => <Pill tone="primary">{r.status}</Pill> }]} rows={data.projects} /></Card></div>;
}


const permissionActions = [
  { key: "view", label: "Ver" },
  { key: "create", label: "Crear" },
  { key: "edit", label: "Editar" },
  { key: "delete", label: "Eliminar" },
  { key: "review", label: "Revisar" },
  { key: "approve", label: "Aprobar" },
  { key: "schedule", label: "Programar" },
  { key: "pay", label: "Pagar" },
  { key: "reconcile", label: "Conciliar" },
  { key: "configure", label: "Configurar" },
];

const permissionModules = [
  { id: "dashboard", label: "Dashboard", helper: "Resumen general de la operación", actions: ["view"] },
  { id: "proyectos", label: "Proyectos", helper: "Alta y edición de proyectos", actions: ["view", "create", "edit", "delete", "configure"] },
  { id: "obras_calidad", label: "Obras / Calidad", helper: "Checklist, evidencias, bitácora y liberaciones", actions: ["view", "create", "edit", "review", "approve", "configure"] },
  { id: "estimaciones", label: "Estimaciones", helper: "Captura, revisión y autorización de avances", actions: ["view", "create", "edit", "review", "approve"] },
  { id: "tramites", label: "Trámites", helper: "Permisos, dependencias y seguimiento", actions: ["view", "create", "edit", "review", "approve"] },
  { id: "equipo_obra", label: "Equipo construcción", helper: "Altas y bajas de constructoras por obra", actions: ["view", "create", "edit", "delete", "configure"] },
  { id: "finanzas", label: "Finanzas / Resumen", helper: "Indicadores financieros y estado de resultados", actions: ["view", "configure"] },
  { id: "clientes", label: "Clientes", helper: "Compradores, pagadores, unidades y contratos", actions: ["view", "create", "edit", "delete", "review"] },
  { id: "ingresos", label: "Ingresos", helper: "Entradas de dinero por proyecto, cliente y unidad", actions: ["view", "create", "edit", "review", "reconcile"] },
  { id: "proveedores", label: "Proveedores", helper: "Ficha 360, fiscal, bancos, documentos y avisos", actions: ["view", "create", "edit", "delete", "review", "approve", "configure"] },
  { id: "presupuestos", label: "Presupuestos", helper: "Partidas autorizadas, sobregiros y ajustes", actions: ["view", "create", "edit", "review", "approve", "configure"] },
  { id: "contratos", label: "Contratos", helper: "Monto autorizado, anticipo, parciales y saldos", actions: ["view", "create", "edit", "delete", "review", "approve"] },
  { id: "pagos_recurrentes", label: "Pagos recurrentes", helper: "Autorización base y generación periódica", actions: ["view", "create", "edit", "delete", "review", "approve", "schedule"] },
  { id: "solicitudes_pago", label: "Solicitudes de pago", helper: "Solicitud, anexos, presupuesto y revisión admin", actions: ["view", "create", "edit", "delete", "review", "approve"] },
  { id: "autorizaciones", label: "Autorizaciones", helper: "Aprobación individual o por lote", actions: ["view", "review", "approve"] },
  { id: "pagos_programados", label: "Pagos programados", helper: "Calendario, lotes y tesorería", actions: ["view", "edit", "schedule", "pay"] },
  { id: "pagos_realizados", label: "Pagos realizados", helper: "Comprobantes, SPEI y trazabilidad", actions: ["view", "edit", "reconcile"] },
  { id: "conciliacion", label: "Conciliación bancaria", helper: "Cruce contra movimientos bancarios", actions: ["view", "create", "edit", "review", "approve", "reconcile"] },
  { id: "caja_chica", label: "Caja chica", helper: "Fondos, gastos, comprobantes y liquidación", actions: ["view", "create", "edit", "review", "approve", "pay", "reconcile"] },
  { id: "arrendamientos", label: "Arrendamientos", helper: "Contratos, cobranza, facturación y conciliación", actions: ["view", "create", "edit", "delete", "review", "approve", "reconcile", "configure"] },
  { id: "cobranza", label: "Arrendamientos / Cobranza", helper: "Rentas mensuales y cartera", actions: ["view", "create", "edit", "review", "reconcile"] },
  { id: "reportes", label: "Reportes", helper: "Estados, cartera, presupuestos y auditoría", actions: ["view", "create"] },
  { id: "configuracion", label: "Configuración", helper: "Catálogos, reglas, bancos y parámetros", actions: ["view", "create", "edit", "delete", "configure"] },
  { id: "usuarios", label: "Usuarios", helper: "Roles, permisos, accesos y auditoría", actions: ["view", "create", "edit", "delete", "approve", "configure"] },
];

function emptyPermissionMatrix() {
  return Object.fromEntries(permissionModules.map((module) => [module.id, Object.fromEntries(permissionActions.map((action) => [action.key, false]))]));
}
function matrixWith(modules = {}, allowedModules = [], actions = ["view"]) {
  const matrix = emptyPermissionMatrix();
  allowedModules.forEach((moduleId) => {
    actions.forEach((action) => { if (matrix[moduleId]) matrix[moduleId][action] = true; });
  });
  Object.entries(modules || {}).forEach(([moduleId, enabled]) => {
    if (enabled && matrix[moduleId]) matrix[moduleId].view = true;
  });
  return matrix;
}
function permissionTemplate(role = "usuario", modules = {}) {
  if (role === "master") return matrixWith(modules, permissionModules.map((m) => m.id), permissionActions.map((a) => a.key));
  if (role === "finanzas_pagos") return matrixWith(modules, ["dashboard", "finanzas", "clientes", "ingresos", "proveedores", "presupuestos", "contratos", "pagos_recurrentes", "solicitudes_pago", "pagos_programados", "pagos_realizados", "conciliacion", "caja_chica", "reportes"], ["view", "create", "edit", "review", "schedule", "pay", "reconcile"]);
  if (role === "supervisora") return matrixWith(modules, ["dashboard", "obras_calidad", "estimaciones", "tramites", "equipo_obra", "reportes"], ["view", "create", "edit", "review", "approve", "configure"]);
  if (role === "cobranza") return matrixWith(modules, ["dashboard", "arrendamientos", "cobranza", "reportes"], ["view", "create", "edit", "review", "reconcile"]);
  if (role === "gestoria") return matrixWith(modules, ["dashboard", "tramites", "reportes"], ["view", "create", "edit", "review"]);
  return matrixWith(modules, ["dashboard"], ["view"]);
}
function normalizePermissionMatrix(user = {}) {
  const base = user.permissionsMatrix || user.permissionMatrix || permissionTemplate(user.role, user.modules);
  const normalized = emptyPermissionMatrix();
  permissionModules.forEach((module) => {
    permissionActions.forEach((action) => {
      normalized[module.id][action.key] = !!base?.[module.id]?.[action.key];
    });
  });
  return normalized;
}
function modulesFromMatrix(matrix) {
  return {
    dashboard: !!matrix.dashboard?.view,
    operacion: ["obras_calidad", "estimaciones", "tramites", "equipo_obra"].some((id) => matrix[id]?.view),
    finanzas: ["finanzas", "clientes", "ingresos", "proveedores", "presupuestos", "contratos", "pagos_recurrentes", "solicitudes_pago", "autorizaciones", "pagos_programados", "pagos_realizados", "conciliacion", "caja_chica"].some((id) => matrix[id]?.view),
    cobranza: !!matrix.cobranza?.view || !!matrix.arrendamientos?.view,
    reportes: !!matrix.reportes?.view,
    configuracion: ["configuracion", "usuarios", "proyectos"].some((id) => matrix[id]?.view),
  };
}
function roleLabel(role) {
  const labels = { master: "Master", finanzas_pagos: "Finanzas / pagos", supervisora: "Supervisión", cobranza: "Cobranza", gestoria: "Gestoría", usuario: "Usuario consulta" };
  return labels[role] || role || "Usuario";
}
function toggleChipStyle(active, disabled = false) {
  return {
    border: `1px solid ${active ? c.primary : c.border}`,
    background: disabled ? "#f7f7f8" : active ? "linear-gradient(180deg, #FFD46A, #F5B21A)" : "white",
    color: disabled ? "#b8b8bd" : active ? "#3B2A00" : c.muted,
    borderRadius: 999,
    padding: "8px 13px",
    minWidth: 54,
    fontWeight: 950,
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: active && !disabled ? "0 0 0 4px rgba(245,178,26,.22)" : "none",
  };
}

function UsersAdmin({ data, setData }) {
  const [editingUserId, setEditingUserId] = useState(null);
  const [message, setMessage] = useState("");
  const [userForm, setUserForm] = useState(() => ({ active: true, role: "usuario", permissionMatrix: permissionTemplate("usuario") }));

  function beginEditUser(user) {
    setEditingUserId(user.id || user.email);
    setUserForm({
      id: user.id || user.email,
      uid: user.uid || user.id || user.email,
      email: user.email || "",
      name: user.name || "",
      role: user.role || "usuario",
      mentionHandle: user.mentionHandle || "",
      active: user.active !== false,
      accessScope: user.accessScope || "total",
      allowedProjects: user.allowedProjects || user.obras || "",
      assignedBlocks: user.assignedBlocks || "",
      assignedUnits: user.assignedUnits || "",
      permissionMatrix: normalizePermissionMatrix(user),
    });
  }
  function resetUserForm() {
    setEditingUserId(null);
    setUserForm({ active: true, role: "usuario", accessScope: "total", permissionMatrix: permissionTemplate("usuario") });
  }
  function applyRole(role) {
    setUserForm((prev) => ({ ...prev, role, permissionMatrix: permissionTemplate(role, modulesFromMatrix(prev.permissionMatrix || {})) }));
  }
  function togglePermission(moduleId, actionKey) {
    const module = permissionModules.find((item) => item.id === moduleId);
    if (!module?.actions.includes(actionKey)) return;
    setUserForm((prev) => ({
      ...prev,
      permissionMatrix: {
        ...prev.permissionMatrix,
        [moduleId]: { ...(prev.permissionMatrix?.[moduleId] || {}), [actionKey]: !prev.permissionMatrix?.[moduleId]?.[actionKey] },
      },
    }));
  }
  function toggleRow(moduleId, value) {
    const module = permissionModules.find((item) => item.id === moduleId);
    if (!module) return;
    setUserForm((prev) => ({
      ...prev,
      permissionMatrix: {
        ...prev.permissionMatrix,
        [moduleId]: Object.fromEntries(permissionActions.map((action) => [action.key, module.actions.includes(action.key) ? value : false])),
      },
    }));
  }
  async function saveUserProfile() {
    const email = String(userForm.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) { alert("Captura un correo válido."); return; }
    const matrix = normalizePermissionMatrix(userForm);
    const payload = {
      id: email,
      uid: userForm.uid || email,
      email,
      name: userForm.name || email,
      role: userForm.role || "usuario",
      mentionHandle: userForm.mentionHandle || email.split("@")[0].replace(/[^a-z0-9_.-]/gi, "").toLowerCase(),
      active: userForm.active !== false,
      accessScope: userForm.accessScope || "total",
      allowedProjects: userForm.allowedProjects || "",
      assignedBlocks: userForm.assignedBlocks || "",
      assignedUnits: userForm.assignedUnits || "",
      modules: modulesFromMatrix(matrix),
      permissionMatrix: matrix,
      permissions: permissionModules.filter((module) => permissionActions.some((action) => matrix[module.id]?.[action.key])).map((module) => module.label).join(", "),
      updatedAt: todayIso(),
      updatedBy: firebaseAuth.currentUser?.email || "sistema",
    };
    setData((prev) => {
      const exists = (prev.users || []).some((u) => (u.id || u.email) === (editingUserId || email) || u.email === email);
      const users = exists ? (prev.users || []).map((u) => ((u.id || u.email) === (editingUserId || email) || u.email === email) ? { ...u, ...payload } : u) : [payload, ...(prev.users || [])];
      return { ...prev, users };
    });
    try {
      await setDoc(doc(firestore, "users", email), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
      setMessage(`Usuario ${email} guardado en Firestore con permisos por módulo y acción.`);
    } catch (error) {
      setMessage(`Usuario guardado localmente, pero Firestore marcó error: ${error.message || error}`);
    }
    resetUserForm();
  }
  const matrix = normalizePermissionMatrix(userForm);
  const users = data.users || [];
  return <div className="triton-users-workspace">
    <Card>
      <SectionTitle title="Usuarios y permisos" helper="Administra seguridad de TRITON OS por usuario, módulo y acción. Usuarios vive separado de Catálogos para no mezclar permisos con configuración operativa." />
      {message ? <div style={{ marginBottom: 12, padding: 12, borderRadius: 16, background: message.includes("error") ? c.redSoft : c.greenSoft, color: message.includes("error") ? c.red : c.primaryDark, fontWeight: 850, border: `1px solid ${message.includes("error") ? c.red : c.primary}` }}>{message}</div> : null}
      <div className="triton-users-top">
        <Card style={{ boxShadow: "none" }}>
          <SectionTitle title={editingUserId ? "Editar usuario" : "Agregar usuario"} helper="Al editar, los datos existentes se cargan completos. La contraseña se administra en Firebase Authentication." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}>
            <Field label="Nombre"><input style={inputStyle()} value={userForm.name || ""} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} placeholder="Nombre completo" /></Field>
            <Field label="Correo"><input type="email" style={inputStyle()} value={userForm.email || ""} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} placeholder="correo@tritondesarrollos.com" /></Field>
            <Field label="Rol base"><select style={inputStyle()} value={userForm.role || "usuario"} onChange={(e) => applyRole(e.target.value)}><option value="master">Master</option><option value="finanzas_pagos">Finanzas / pagos</option><option value="supervisora">Supervisión</option><option value="cobranza">Cobranza</option><option value="gestoria">Gestoría</option><option value="usuario">Usuario consulta</option></select></Field>
            <Field label="Estatus"><select style={inputStyle()} value={userForm.active === false ? "Inactivo" : "Activo"} onChange={(e) => setUserForm({ ...userForm, active: e.target.value === "Activo" })}><option>Activo</option><option>Inactivo</option></select></Field>
            <Field label="Alcance de visibilidad"><select style={inputStyle()} value={userForm.accessScope || "total"} onChange={(e) => setUserForm({ ...userForm, accessScope: e.target.value })}><option value="total">Total</option><option value="proyectos_asignados">Proyectos asignados</option><option value="obra_asignada">Obra asignada</option><option value="bloques_asignados">Bloques asignados</option><option value="unidades_asignadas">Unidades asignadas</option></select></Field>
            <Field label="@ usuario"><input style={inputStyle()} value={userForm.mentionHandle || ""} onChange={(e) => setUserForm({ ...userForm, mentionHandle: e.target.value.replace(/^@/, "") })} placeholder="rodrigo" /></Field>
            <Field label="Proyectos permitidos"><input style={inputStyle()} value={userForm.allowedProjects || ""} onChange={(e) => setUserForm({ ...userForm, allowedProjects: e.target.value })} placeholder="arenna, residente" /></Field>
            <Field label="Bloques asignados"><input style={inputStyle()} value={userForm.assignedBlocks || ""} onChange={(e) => setUserForm({ ...userForm, assignedBlocks: e.target.value })} placeholder="A, B, C" /></Field>
            <Field label="Unidades asignadas"><input style={inputStyle()} value={userForm.assignedUnits || ""} onChange={(e) => setUserForm({ ...userForm, assignedUnits: e.target.value })} placeholder="Casa 1, TH09" /></Field>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <Button onClick={saveUserProfile}>{editingUserId ? "Guardar cambios" : "Agregar usuario"}</Button>
            {editingUserId ? <Button variant="secondary" onClick={resetUserForm}>Cancelar edición</Button> : <Button variant="secondary" onClick={resetUserForm}>Limpiar</Button>}
          </div>
        </Card>
        <Card style={{ boxShadow: "none" }}>
          <SectionTitle title="Usuarios actuales" helper="Haz clic en el nombre o en Editar para abrirlo en el formulario con toda la información precargada." />
          <MiniTable columns={[
            { key: "name", label: "Usuario", render: (r) => <button type="button" onClick={() => beginEditUser(r)} style={{ border: 0, background: "transparent", padding: 0, color: c.primaryDark, fontWeight: 950, cursor: "pointer", textAlign: "left" }}>{r.name || r.email}</button> },
            { key: "role", label: "Rol", render: (r) => roleLabel(r.role) },
            { key: "active", label: "Estado", render: (r) => <Pill tone={r.active === false ? "danger" : "ok"}>{r.active === false ? "Inactivo" : "Activo"}</Pill> },
            { key: "actions", label: "Acciones", sortable: false, render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => beginEditUser(r)}>Editar</Button><Button variant={r.active === false ? "success" : "danger"} style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => { const active = r.active === false; setData((prev) => ({ ...prev, users: (prev.users || []).map((u) => (u.id || u.email) === (r.id || r.email) ? { ...u, active } : u) })); }}>{r.active === false ? "Activar" : "Desactivar"}</Button></ActionCell> }
          ]} rows={users} />
        </Card>
      </div>
    </Card>
    <Card className="triton-permission-card" style={{ overflow: "hidden" }}>
      <SectionTitle title="Matriz de permisos" helper="Cada fila es un módulo y cada columna una acción. Las acciones que no aplican se bloquean con — para evitar permisos ambiguos." />
      <div className="triton-permission-table-wrap" style={{ border: `1px solid ${c.border}` }}>
        <table className="triton-permission-table">
          <thead><tr style={{ background: c.warmSoft }}><th style={{ textAlign: "left", padding: 14, fontSize: 12, color: c.muted, letterSpacing: .5 }}>MÓDULO</th>{permissionActions.map((action) => <th key={action.key} style={{ textAlign: "center", padding: 12, fontSize: 12, color: c.muted, letterSpacing: .5, minWidth: 88 }}>{action.label.toUpperCase()}</th>)}<th style={{ textAlign: "center", padding: 12, fontSize: 12, color: c.muted }}>TODO</th></tr></thead>
          <tbody>{permissionModules.map((module) => {
            const allActive = module.actions.every((action) => matrix[module.id]?.[action]);
            return <tr key={module.id}><td style={{ padding: "16px 14px", borderTop: `1px solid ${c.border}`, minWidth: 280, background: "rgba(255,255,255,.7)" }}><div style={{ fontWeight: 950 }}>{module.label}</div><div style={{ color: c.muted, fontSize: 12, marginTop: 4, lineHeight: 1.35 }}>{module.helper}</div></td>{permissionActions.map((action) => {
              const allowed = module.actions.includes(action.key);
              const active = !!matrix[module.id]?.[action.key];
              return <td key={action.key} style={{ textAlign: "center", padding: "13px 8px", borderTop: `1px solid ${c.border}` }}>{allowed ? <button type="button" onClick={() => togglePermission(module.id, action.key)} style={toggleChipStyle(active)}>{active ? "Sí" : "No"}</button> : <span style={{ color: "#c7c1b3", fontWeight: 950 }}>—</span>}</td>;
            })}<td style={{ textAlign: "center", padding: "13px 8px", borderTop: `1px solid ${c.border}` }}><button type="button" onClick={() => toggleRow(module.id, !allActive)} style={toggleChipStyle(allActive)}>{allActive ? "Sí" : "No"}</button></td></tr>;
          })}</tbody>
        </table>
      </div>
    </Card>
  </div>;
}

function Config({ data }) {
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Catálogos y reglas" helper="Configuración operativa del sistema. La administración de usuarios vive en Configuración → Usuarios para mantener separada la seguridad." /><MiniTable columns={[{ key: "name", label: "Categoría" }, { key: "group", label: "Grupo" }, { key: "budgetable", label: "Presupuestable", render: (r) => r.budgetable ? "Sí" : "No" }]} rows={data.categories} /></Card>
    <Card><SectionTitle title="Parámetros pendientes" helper="Aquí quedarán catálogos editables de bancos, cuentas, partidas presupuestales, tipos de inmueble, plantillas de trámites y reglas de autorización." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        {["Categorías financieras", "Partidas presupuestales", "Bancos y cuentas", "Tipos de inmueble", "Plantillas de trámites", "Reglas de autorización"].map((item) => <div key={item} style={{ padding: 14, border: `1px solid ${c.border}`, borderRadius: 18, background: "white" }}><b>{item}</b><p style={{ margin: "6px 0 0", color: c.muted, fontSize: 12 }}>Configuración separada de usuarios y permisos.</p></div>)}
      </div>
    </Card>
  </div>;
}

function SimpleForm({ fields, labels, form, setForm, onSubmit }) {
  return <div style={{ marginTop: 14, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>{fields.map((field) => <Field key={field} label={labels[field] || field}><input style={inputStyle()} value={form[field] || ""} onChange={(e) => setForm({ ...form, [field]: e.target.value })} /></Field>)}</div><Button onClick={onSubmit} style={{ justifySelf: "start" }}>Guardar</Button></div>;
}
