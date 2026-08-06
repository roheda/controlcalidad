import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { getAuth, sendPasswordResetEmail } from "firebase/auth";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { importedInmuebles, importedPropertyOwners, importedDepositAccounts, importedInmueblesVersion } from "./importedInmuebles";
import { arennaThEstimateCatalogMeta, arennaThEstimateSections, arennaThEstimateConcepts, checklistForEstimateSection } from "./estimateCatalogArennaTH";
import { Button as UiButton, Card as UiCard, Badge as UiBadge, PromptProvider, usePrompt, Tooltip, HelpIcon } from "./ui/index.js";

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
  const requesterName = row.requestedByName || row.requestedBy || row.createdByName || "No capturado";
  const requesterEmail = row.requestedByEmail || row.createdByEmail || row.createdBy || "";
  const requesterText = `${requesterName}${requesterEmail && requesterEmail !== requesterName ? ` · ${requesterEmail}` : ""}`;
  const baseLog = [
    { label: "Solicitado por", value: requesterText, date: row.requestedAt || row.requiredDate || row.createdAt || "—" },
    row.adminReviewed ? { label: "Revisión administrativa", value: row.adminReviewedBy || row.adminComment || row.overspendReason || "Expediente revisado", date: row.adminReviewedAt || "—" } : { label: "Revisión administrativa", value: "Pendiente", date: "—" },
    row.readyForApprovalAt ? { label: "Enviado a autorización", value: row.readyForApprovalBy || "Listo para autorización", date: row.readyForApprovalAt } : null,
    row.authorizedAt ? { label: "Autorizado", value: row.authorizedBy || "Dirección", date: row.authorizedAt } : null,
    row.scheduledDate ? { label: "Programado", value: row.scheduledBy || row.paymentBank || "Banco por definir", date: row.scheduledDate } : null,
    row.paidAt ? { label: "Pagado", value: row.paidBy || row.paymentReference || "Referencia pendiente", date: row.paidAt } : null,
  ].filter(Boolean);
  const auditLog = (row.auditLog || []).map((item) => ({ label: item.event || item.action || "Movimiento", value: item.user || item.detail || "Sistema", date: item.date || item.createdAt || "—" }));
  const log = [...baseLog, ...auditLog];
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
            <div><b>Solicitó:</b> {requesterText}</div>
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
  green: "#1FA35C",
  greenSoft: "rgba(31,163,92,0.12)",
  orange: "#ff9500",
  orangeSoft: "rgba(255,149,0,0.14)",
  red: "#ff3b30",
  redSoft: "rgba(255,59,48,0.12)",
  purple: "#5856d6",
  purpleSoft: "rgba(88,86,214,0.12)",
  shadow: "0 18px 55px rgba(0,0,0,0.10)",
};


function mergeById(base = [], incoming = [], idKey = "id") {
  const seen = new Set((base || []).map((item) => item?.[idKey]).filter(Boolean));
  return [ ...(base || []), ...(incoming || []).filter((item) => item?.[idKey] && !seen.has(item[idKey])) ];
}
function withImportedInmuebles(data = {}) {
  const merged = {
    ...data,
    assets: mergeById(data.assets || [], importedInmuebles || []),
    propertyOwners: mergeById(data.propertyOwners || [], importedPropertyOwners || []),
    depositAccounts: mergeById(data.depositAccounts || [], importedDepositAccounts || []),
    assetImportVersion: data.assetImportVersion || importedInmueblesVersion,
  };
  return merged;
}

const defaultPermitTemplates = [
  { id: "pt-uso-suelo", name: "Factibilidad / uso de suelo", stage: "Preconstrucción", agency: "Municipio / Desarrollo Urbano", documents: "Escritura, predial, croquis, identificación, solicitud", defaultOwner: "Gestoría", defaultPriority: "Alta", projectTypes: "Desarrollo habitacional, Plaza comercial, Departamentos", initialAction: "Confirmar requisitos vigentes y preparar expediente de ingreso", status: "Activo", order: 1 },
  { id: "pt-alineamiento", name: "Alineamiento y número oficial", stage: "Preconstrucción", agency: "Municipio", documents: "Escritura, predial, plano de ubicación, solicitud", defaultOwner: "Gestoría", defaultPriority: "Media", projectTypes: "Todos", initialAction: "Validar clave catastral y documentos del predio", status: "Activo", order: 2 },
  { id: "pt-lic-construccion", name: "Licencia de construcción", stage: "Licencia de construcción", agency: "Municipio", documents: "Planos autorizados, memoria, responsiva, pago de derechos", defaultOwner: "Gestoría", defaultPriority: "Alta", projectTypes: "Desarrollo habitacional, Plaza comercial, Departamentos", initialAction: "Integrar planos finales y presupuesto de derechos", status: "Activo", order: 3 },
  { id: "pt-factibilidad-cfe", name: "Factibilidad CFE", stage: "Factibilidades", agency: "CFE", documents: "Carga estimada, ubicación, escritura, identificación", defaultOwner: "Gestoría / Proyecto eléctrico", defaultPriority: "Alta", projectTypes: "Todos", initialAction: "Preparar memoria de carga y solicitud", status: "Activo", order: 4 },
  { id: "pt-factibilidad-japay", name: "Factibilidad agua / drenaje", stage: "Factibilidades", agency: "JAPAY / organismo operador", documents: "Ubicación, escritura, anteproyecto, demanda estimada", defaultOwner: "Gestoría / Proyecto hidráulico", defaultPriority: "Alta", projectTypes: "Todos", initialAction: "Confirmar requisitos y capacidad de servicio", status: "Activo", order: 5 },
  { id: "pt-proteccion-civil", name: "Protección civil", stage: "Operación / apertura", agency: "Protección Civil", documents: "Planos, programa interno, dictámenes, señalética", defaultOwner: "Gestoría", defaultPriority: "Media", projectTypes: "Plaza comercial, Oficinas, Departamentos", initialAction: "Definir si aplica por tipo de inmueble y uso", status: "Activo", order: 6 },
  { id: "pt-regimen-condominio", name: "Régimen en condominio", stage: "Legal / cierre", agency: "Notaría / Registro Público", documents: "Planos, tablas de indivisos, cédulas, permisos, proyecto final", defaultOwner: "Legal", defaultPriority: "Alta", projectTypes: "Desarrollo habitacional, Departamentos", initialAction: "Preparar tablas y documentación final para notaría", status: "Activo", order: 7 },
  { id: "pt-terminacion-obra", name: "Terminación de obra", stage: "Cierre de obra", agency: "Municipio", documents: "Licencia, planos finales, evidencias, pagos", defaultOwner: "Gestoría / Obra", defaultPriority: "Alta", projectTypes: "Todos", initialAction: "Revisar condiciones para cierre y documentación pendiente", status: "Activo", order: 8 },
];

function normalizePermitHistory(permit) {
  const base = Array.isArray(permit.history) && permit.history.length ? permit.history : [{
    id: uid("ph"),
    date: permit.updatedAt || permit.createdAt || todayIso(),
    fromStatus: "—",
    toStatus: permit.status || "No iniciado",
    user: permit.owner || "Sistema",
    comment: permit.nextAction || "Alta inicial del trámite.",
    nextAction: permit.nextAction || "Definir siguiente acción",
    attachments: normalizeAttachments(permit.attachments || permit.documents),
  }];
  return { ...permit, history: base, attachments: normalizeAttachments(permit.attachments), documentsText: typeof permit.documents === "string" ? permit.documents : permit.documentsText || attachmentNames(permit.documents) };
}

function withTramitesDefaults(data = {}) {
  const templates = mergeById(data.permitTemplates || [], defaultPermitTemplates);
  return {
    ...data,
    permitTemplates: templates,
    permits: (data.permits || []).map(normalizePermitHistory),
  };
}

function withAppDefaults(data = {}) {
  const merged = withTramitesDefaults(withImportedInmuebles(data));
  return {
    ...merged,
    operationSettings: { defaultEstimateCatalogId: arennaThEstimateCatalogMeta.id, qualityGateForPayment: true, blankNewProjectFlow: true, backupsEveryHours: 6, firestoreConfigured: true, ...(merged.operationSettings || {}) },
    estimateCatalogs: merged.estimateCatalogs?.length ? merged.estimateCatalogs : [{ ...arennaThEstimateCatalogMeta, sectionsCount: arennaThEstimateSections.length, conceptsCount: arennaThEstimateConcepts.length }],
    estimateProgress: merged.estimateProgress || {},
    technicalQueries: merged.technicalQueries || [],
  };
}

const initialData = {
  projects: [
    { id: "arenna", name: "Arenna", type: "Desarrollo habitacional", status: "Activo", budget: 94806101, incomeTarget: 112517760, owner: "TRITON" },
    { id: "plaza-vias", name: "Plaza Las Vías", type: "Plaza comercial", status: "Operando", budget: 0, incomeTarget: 0, owner: "TRITON" },
    { id: "residente", name: "Residente", type: "Departamentos", status: "Planeación", budget: 120000000, incomeTarget: 0, owner: "TRITON" },
  ],
  operationSettings: {
    defaultEstimateCatalogId: arennaThEstimateCatalogMeta.id,
    qualityGateForPayment: true,
    blankNewProjectFlow: true,
    backupsEveryHours: 6,
    firestoreConfigured: true,
  },
  estimateCatalogs: [
    { ...arennaThEstimateCatalogMeta, sectionsCount: arennaThEstimateSections.length, conceptsCount: arennaThEstimateConcepts.length },
  ],
  estimateProgress: {},
  technicalQueries: [
    { id: "tech-demo-1", projectId: "arenna", title: "Criterio de liberación de instalación hidráulica", module: "Calidad", status: "Abierta", priority: "Media", requestedBy: "Supervisión", createdAt: todayIso(), question: "Confirmar evidencia mínima para liberar tubería antes de tapar.", response: "Cargar prueba 90 PSI/24h, fotos por zona y bitácora sin pendientes." },
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
  propertyOwners: importedPropertyOwners,
  depositAccounts: importedDepositAccounts,
  assets: [
    ...importedInmuebles,
    { id: "local-13", name: "Local 13", projectId: "plaza-vias", type: "Local comercial", area: 42, location: "Plaza Las Vías", address: "Plaza Las Vías, Mérida, Yucatán", cadastralId: "CED-LV-13", rentalPrice: 18121.75, pricePerM2: 431, coordinates: "20.9674,-89.5926", status: "Ocupado", legalStatus: "Cédula vigente", notes: "Local comercial con contrato vigente." },
    { id: "terreno-1", name: "Terreno renta", projectId: "plaza-vias", type: "Terreno", area: 300, location: "Mérida", address: "Mérida, Yucatán", cadastralId: "CED-TER-01", rentalPrice: 86599.43, pricePerM2: 289, coordinates: "20.9710,-89.6200", status: "Ocupado", legalStatus: "Cédula por actualizar", notes: "Predio para arrendamiento comercial." },
    { id: "casa-1", name: "Casa oficina", projectId: "plaza-vias", type: "Casa", area: 200, location: "Campestre", address: "Col. Campestre, Mérida", cadastralId: "CED-CASA-01", rentalPrice: 54102.58, pricePerM2: 271, coordinates: "21.0142,-89.6230", status: "Ocupado", legalStatus: "Cédula vigente", notes: "Casa/oficina arrendada." },
  ],
  tenants: [
    { id: "t1", name: "COCINAS DANFER", fiscalId: "", taxpayerType: "Persona moral", email: "pagos@danfer.demo", phone: "", whatsapp: "", certificateStatus: "Vigente", billingEmail: "facturacion@danfer.demo", paymentContact: "Administración", status: "Activo" },
    { id: "t2", name: "NOEMI MUÑOZ (ESCUELA DE INGLÉS)", fiscalId: "", taxpayerType: "Persona física", email: "noemi@demo.mx", phone: "", whatsapp: "", certificateStatus: "Por actualizar", billingEmail: "", paymentContact: "Noemí Muñoz", status: "Activo" },
    { id: "t3", name: "DAHE ELADIOS CENTRO", fiscalId: "", taxpayerType: "Persona moral", email: "pagos@dahe.demo", phone: "", whatsapp: "", certificateStatus: "Vigente", billingEmail: "facturacion@dahe.demo", paymentContact: "Administración DAHE", status: "Activo" },
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
    { id: "rc1", contractId: "r1", period: "2026-02", chargeType: "Renta", rent: 18121.75, maintenance: 0, status: "Vencido", paidAmount: 0, dueDate: "2026-02-10", bankReference: "FT260587JRVZ", invoiceStatus: "Pendiente" },
    { id: "rc1-mantto", contractId: "r1", period: "2026-02", chargeType: "Mantenimiento", rent: 0, maintenance: 1449.74, status: "Vencido", paidAmount: 0, dueDate: "2026-02-10", bankReference: "FT260587JRVZ-M", invoiceStatus: "Pendiente" },
    { id: "rc2", contractId: "r2", period: "2026-02", chargeType: "Renta", rent: 86599.43, maintenance: 0, status: "Vencido", paidAmount: 0, dueDate: "2026-02-15", bankReference: "", invoiceStatus: "Pendiente" },
    { id: "rc3", contractId: "r3", period: "2026-02", chargeType: "Renta", rent: 54102.58, maintenance: 0, status: "Conciliado", paidAmount: 54102.58, dueDate: "2026-02-23", bankReference: "FT260541NY8Q", invoiceStatus: "Emitida", reconciled: true, reconciledAt: todayIso() },
  ],
  propertyTaxes: [
    { id: "pred-local-13-2026", assetId: "local-13", year: "2026", dueDate: "2026-03-31", amount: 0, status: "Pendiente", paidAt: "", bankReference: "", attachments: [], notes: "Registrar predial y anexar comprobante." },
    { id: "pred-terreno-1-2026", assetId: "terreno-1", year: "2026", dueDate: "2026-03-31", amount: 0, status: "Pendiente", paidAt: "", bankReference: "", attachments: [], notes: "Predio independiente: revisar vigencia." },
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
  bankAccounts: [
    { id: "bank-vepormas", name: "VEPORMAS", bank: "VEPORMAS", account: "Principal", clabe: "", currency: "MXN", use: "Pagos y cobranza", status: "Activa" },
    { id: "bank-banorte", name: "Banorte Operación", bank: "Banorte", account: "Operación", clabe: "", currency: "MXN", use: "Pagos", status: "Activa" },
  ],
  approvalRules: [
    { id: "rule-1", module: "Cuentas por pagar", threshold: 10000, requiresAdminReview: true, requiresMaster: false, role: "Finanzas / pagos", description: "Revisión administrativa obligatoria antes de programar pagos menores." },
    { id: "rule-2", module: "Cuentas por pagar", threshold: 50000, requiresAdminReview: true, requiresMaster: true, role: "Master", description: "Autorización final master para pagos relevantes o sobregiros." },
    { id: "rule-3", module: "Arrendamientos", threshold: 0, requiresAdminReview: true, requiresMaster: false, role: "Cobranza", description: "Toda renta reportada debe estar conciliada antes de aparecer como cobrada." },
  ],
  requiredDocuments: [
    { id: "req-prov-1", module: "Proveedores", name: "Constancia de situación fiscal", required: true, appliesTo: "Persona física / moral", validityDays: 180 },
    { id: "req-prov-2", module: "Proveedores", name: "Carátula bancaria", required: true, appliesTo: "Pagos por transferencia", validityDays: 365 },
    { id: "req-pay-1", module: "Solicitudes de pago", name: "Factura PDF/XML o soporte autorizado", required: true, appliesTo: "Todos los pagos", validityDays: 0 },
    { id: "req-rent-1", module: "Arrendamientos", name: "Contrato firmado y cédula fiscal", required: true, appliesTo: "Contrato vigente", validityDays: 365 },
  ],
  assetTypes: ["Local comercial", "Terreno", "Casa", "Departamento", "Oficina", "Bodega", "Estacionamiento"],
  rentalContractTypes: ["Arrendamiento comercial", "Arrendamiento habitacional", "Uso temporal", "Terreno", "Oficina"],
  rentalRules: [
    { id: "rent-rule-1", name: "Incremento anual", value: "Anual", description: "Revisar cada contrato con incremento anual pendiente o vencido. El INPC puede usarse como índice de cálculo, pero la operación lo ve como incremento anual." },
    { id: "rent-rule-2", name: "Reporte mensual", value: "Solo conciliado", description: "Las rentas aparecen como cobradas solo cuando tienen conciliación bancaria." },
    { id: "rent-rule-3", name: "Facturación", value: "Automática si contrato lo permite", description: "Generar factura mensual con datos fiscales vigentes, con opción manual o por lote." },
  ],
  invoiceApiConfig: {
    provider: "Pendiente conectar",
    mode: "Manual / API preparada",
    endpoint: "",
    apiKeyAlias: "",
    autoSend: false,
    scheduleDay: 1,
    status: "Sin conectar",
    notes: "Listo para integrar proveedor de facturación. Las acciones manuales y por lote ya actualizan el flujo operativo."
  },
  paymentStatuses: ["Borrador", "Solicitado", "En revisión", "Listo para autorización", "Autorizado", "Programado", "Pagado", "Conciliado", "Observado", "Rechazado", "Cancelado"],
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
  operacion_os: { title: "Operación", subtitle: "Obra, calidad, estimaciones, equipo de construcción y consulta técnica", icon: "✓" },
  calidad: { title: "Checklist / Calidad", subtitle: "Liberación técnica de partidas, evidencias, bitácora y control previo a estimaciones", icon: "✓" },
  obras: { title: "Configurar obra", subtitle: "Alta y edición de obras, unidades, modelos, alcance y parámetros operativos", icon: "⌂" },
  estimaciones: { title: "Estimaciones", subtitle: "Catálogo de conceptos, checklist de liberación, avance de constructora y solicitudes de pago", icon: "▥" },
  consulta_tecnica: { title: "Consulta técnica", subtitle: "Dudas, criterios, documentos y respuestas de supervisión", icon: "?" },
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
  cobranza: { title: "Arrendamientos / Cobranza", subtitle: "Contratos, incremento anual, rentas mensuales, facturación y conciliación", icon: "↙" },
  arr_inmuebles: { title: "Arrendamientos / Inmuebles", subtitle: "Predios, locales, casas, departamentos, cédulas, m², ubicación y mapa", icon: "⌂" },
  arr_contratos: { title: "Arrendamientos / Contratos", subtitle: "Vigencias, incremento anual, cédulas y documentación", icon: "□" },
  arr_conciliacion: { title: "Arrendamientos / Conciliación", subtitle: "Cruce de pagos de renta contra banco", icon: "≋" },
  arr_facturacion: { title: "Arrendamientos / Facturación", subtitle: "Facturas mensuales, emisión manual, lotes y API", icon: "▣" },
  arr_predial: { title: "Arrendamientos / Pago de predial", subtitle: "Vencimientos, pagos, comprobantes y riesgo por predio", icon: "▥" },
  arr_reportes: { title: "Arrendamientos / Reportes", subtitle: "Cartera vencida, ocupación, rentas e impuestos", icon: "▤" },
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
    const raw = localStorage.getItem("triton_os_v44") || localStorage.getItem("triton_os_v43") || localStorage.getItem("triton_os_v37") || localStorage.getItem("triton_os_v36") || localStorage.getItem("triton_os_v35") || localStorage.getItem("triton_os_v34") || localStorage.getItem("triton_os_v32");
    if (!raw) return withAppDefaults(initialData);
    const parsed = JSON.parse(raw);
    return withAppDefaults({ ...initialData, ...parsed });
  } catch {
    return withAppDefaults(initialData);
  }
}

const pillToneMap = { ok: "success", warn: "warning", danger: "danger", primary: "brand", purple: "info", idle: "neutral" };
function Pill({ children, tone = "idle", help }) {
  const badge = <UiBadge tone={pillToneMap[tone] || "neutral"}>{children}</UiBadge>;
  return help ? <Tooltip text={help}><span>{badge}</span></Tooltip> : badge;
}

function Card({ children, style, className }) {
  return <UiCard style={style} className={className}>{children}</UiCard>;
}

const buttonVariantMap = { primary: "primary", secondary: "secondary", danger: "danger", success: "success" };
function Button({ children, onClick, variant = "primary", disabled, style, type = "button", help }) {
  const button = (
    <UiButton type={type} disabled={disabled} onClick={onClick} variant={buttonVariantMap[variant] || "primary"} style={style}>
      {children}
    </UiButton>
  );
  return help ? <Tooltip text={help}><span>{button}</span></Tooltip> : button;
}

function Field({ label, children, help }) {
  return <label className="grid gap-1.5 text-xs font-black text-ink-muted">{help ? <span className="inline-flex items-center">{label}<HelpIcon text={help} /></span> : label}{children}</label>;
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

async function createSystemBackup(data, reason = "Respaldo manual") {
  const id = `backup_${new Date().toISOString().slice(0,16).replace(/[^0-9]/g,"")}`;
  const payload = {
    id,
    reason,
    createdAt: new Date().toISOString(),
    createdBy: firebaseAuth.currentUser?.email || "sistema",
    appVersion: "v50",
    collections: {
      projects: data.projects?.length || 0,
      payables: data.payables?.length || 0,
      contracts: data.contracts?.length || 0,
      rentCharges: data.rentCharges?.length || 0,
      permits: data.permits?.length || 0,
      assets: data.assets?.length || 0,
    },
    data,
  };
  localStorage.setItem("triton_os_backup_latest", JSON.stringify(payload));
  localStorage.setItem("triton_os_last_backup_at", String(Date.now()));
  try {
    await setDoc(doc(firestore, "systemBackups", id), { ...payload, data: JSON.stringify(data), serverCreatedAt: serverTimestamp() }, { merge: true });
    return { ok: true, id };
  } catch (error) {
    return { ok: false, id, error: error?.message || String(error) };
  }
}

async function sendPasswordReset(email) {
  const clean = String(email || "").trim().toLowerCase();
  if (!clean) return { ok: false, message: "Correo requerido." };
  try {
    await sendPasswordResetEmail(firebaseAuth, clean);
    return { ok: true, message: `Se envió correo para restablecer contraseña a ${clean}.` };
  } catch (error) {
    return { ok: false, message: error?.message || String(error) };
  }
}


export default function TritonOSModules() {
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState("reportes_os");
  const [data, setData] = useState(readData);
  const [projectFilter, setProjectFilter] = useState("todos");
  const [showForm, setShowForm] = useState(null);
  const [form, setForm] = useState({});

  useEffect(() => { localStorage.setItem("triton_os_v44", JSON.stringify(data)); }, [data]);
  useEffect(() => {
    const hours = Number(data.operationSettings?.backupsEveryHours || 6);
    const last = Number(localStorage.getItem("triton_os_last_backup_at") || 0);
    const due = !last || (Date.now() - last) > hours * 60 * 60 * 1000;
    if (!due) return;
    const timer = window.setTimeout(() => createSystemBackup(data, "Respaldo automático programado"), 1400);
    return () => window.clearTimeout(timer);
  }, [data.operationSettings?.backupsEveryHours]);
  useEffect(() => {
    const openHandler = (event) => { setActive(event.detail?.module || "reportes_os"); setOpen(true); };
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
  const modulesWithProjectFilter = new Set(["dashboard", "operacion_os", "finanzas", "presupuestos", "contratos_financieros", "pagos_recurrentes", "cxp", "autorizaciones", "pagos_programados", "pagos_realizados", "conciliacion", "caja_chica", "cobranza", "tramites", "equipo_obra", "reportes_os"]);
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
  function deleteRecord(collectionName, id) {
    const now = todayIso();
    setData((prev) => {
      const before = (prev[collectionName] || []).find((item) => item.id === id);
      if (!before) return prev;
      return {
        ...prev,
        [collectionName]: (prev[collectionName] || []).filter((item) => item.id !== id),
        auditTrail: [{ id: uid("audit"), module: collectionName, itemId: id, action: "Eliminar registro", user: firebaseAuth.currentUser?.email || "sistema", date: now, comment: before.concept || before.name || before.tradeName || `Registro ${id} eliminado` }, ...(prev.auditTrail || [])].slice(0, 200),
      };
    });
  }
  function resetDemo() {
    if (window.confirm("¿Restablecer datos demo de TRITON OS?")) { localStorage.removeItem("triton_os_v44"); localStorage.removeItem("triton_os_v43"); localStorage.removeItem("triton_os_v37"); localStorage.removeItem("triton_os_v36"); localStorage.removeItem("triton_os_v35"); localStorage.removeItem("triton_os_v34"); setData(initialData); }
  }

  if (!open) return null;
  const meta = moduleMeta[active] || moduleMeta.dashboard;

  return <PromptProvider><div style={{ position: "fixed", inset: 0, zIndex: 2147483600, pointerEvents: "none" }}>
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
        {active === "operacion_os" && <OperationHub data={data} projectMap={projectMap} categoryMap={categoryMap} setActive={setActive} />}
        {active === "calidad" && <OperationQuality data={data} projectMap={projectMap} setActive={setActive} updateRecord={updateRecord} />}
        {active === "obras" && <OperationWorksConfig data={data} projectMap={projectMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "estimaciones" && <OperationEstimations data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} setData={setData} />}
        {active === "consulta_tecnica" && <OperationTechnical data={data} projectMap={projectMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "finanzas" && <Finance data={data} projectMap={projectMap} categoryMap={categoryMap} projectFilter={projectFilter} setActive={setActive} />}
        {active === "proveedores" && <Suppliers data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "presupuestos" && <Budgets data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "contratos_financieros" && <FinanceContracts data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "pagos_recurrentes" && <RecurringPayments data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "cxp" && <Payables data={data} projectMap={projectMap} categoryMap={categoryMap} rows={filteredPayables} addRecord={addRecord} updateRecord={updateRecord} deleteRecord={deleteRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "autorizaciones" && <Authorizations data={data} projectMap={projectMap} categoryMap={categoryMap} updateRecord={updateRecord} />}
        {active === "pagos_programados" && <ScheduledPayments data={data} projectMap={projectMap} categoryMap={categoryMap} updateRecord={updateRecord} addRecord={addRecord} />}
        {active === "pagos_realizados" && <PaidPayments data={data} projectMap={projectMap} categoryMap={categoryMap} />}
        {active === "conciliacion" && <BankReconciliation data={data} projectMap={projectMap} categoryMap={categoryMap} updateRecord={updateRecord} />}
        {active === "ingresos" && <Incomes data={data} projectMap={projectMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "clientes" && <Clients data={data} projectMap={projectMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "caja_chica" && <PettyCash data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {["arr_inmuebles","cobranza","arr_contratos","arr_conciliacion","arr_facturacion","arr_predial","arr_reportes"].includes(active) && <Rentals data={data} projectMap={projectMap} tenantMap={tenantMap} assetMap={assetMap} contractMap={contractMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} mode={active} />}
        {active === "tramites" && <Permits data={data} projectMap={projectMap} rows={filteredPermits} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {["tramites_timeline","tramites_expediente"].includes(active) && <PermitsTimeline data={data} projectMap={projectMap} rows={data.permits} mode={active} updateRecord={updateRecord} />}
        {active === "equipo_obra" && <ConstructionTeam data={data} projectMap={projectMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {["reportes_os","reporte_obra","reporte_finanzas","reporte_egresos","reporte_ingresos","reporte_ia"].includes(active) && <Reports totals={totals} data={data} projectMap={projectMap} categoryMap={categoryMap} active={active} />}
        {active === "config_os" && <Config data={data} setData={setData} />}
        {active === "usuarios_os" && <UsersAdmin data={data} setData={setData} />}
      </main>
    </div>
  </div></PromptProvider>;
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


function openLegacyOperationModule(moduleId) {
  window.dispatchEvent(new Event("triton-close-os-module"));
  window.setTimeout(() => {
    if (moduleId === "calidad") return;
    if (moduleId === "estimaciones") { window.dispatchEvent(new Event("triton-open-estimaciones")); return; }
    if (moduleId === "obras") { window.dispatchEvent(new Event("triton-open-obras-config")); return; }
    if (moduleId === "consulta_tecnica") {
      window.dispatchEvent(new Event("triton-open-feedback-module"));
      const buttons = Array.from(document.querySelectorAll("button"));
      const target = buttons.find((button) => button.textContent?.trim().includes("Consulta técnica"));
      if (target) target.click();
    }
  }, 90);
}

function OperationHub({ data, projectMap, categoryMap, setActive }) {
  const qualityRelated = (data.payables || []).filter((p) => String(p.concept || "").toLowerCase().includes("estimación") || p.categoryId === "construccion");
  const openPayables = qualityRelated.filter((p) => !["Pagado", "Conciliado", "Cancelado", "Rechazado"].includes(p.status));
  const constructionContracts = (data.financeContracts || []).filter((ct) => String(ct.paymentPlan || ct.name || "").toLowerCase().includes("obra") || ct.categoryId === "construccion");
  const openPermits = (data.permits || []).filter((t) => !["Aprobado", "Cerrado", "Finalizado"].includes(t.status));
  const team = data.constructionTeam || [];
  const actionCards = [
    { label: "Checklist / Calidad", helper: "Liberaciones, evidencias, bitácora de partida y cumplimiento técnico.", action: () => setActive("calidad") },
    { label: "Configurar obra", helper: "Alta/edición simple de obras, unidades, modelos, alcance y parámetros.", action: () => setActive("obras") },
    { label: "Estimaciones", helper: "Catálogo de conceptos, avance de constructora, checklist y solicitud de pago.", action: () => setActive("estimaciones") },
    { label: "Equipo construcción", helper: "Alta/baja de constructoras, responsables por obra y accesos operativos.", action: () => setActive("equipo_obra") },
    { label: "Consulta técnica", helper: "Dudas técnicas, criterios, documentos y soporte para supervisión.", action: () => setActive("consulta_tecnica") },
  ];
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Operación conectada" helper="Centro operativo de obra. Desde aquí se entra a los módulos trabajados previamente y se cruza la información con finanzas, trámites y reportes." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>{actionCards.map((item) => <button key={item.label} type="button" onClick={item.action} style={{ textAlign: "left", border: `1px solid ${c.border}`, borderRadius: 20, padding: 16, background: "white", cursor: "pointer" }}><b style={{ display: "block", color: c.text, fontSize: 16 }}>{item.label}</b><span style={{ display: "block", color: c.muted, fontSize: 12, marginTop: 6, lineHeight: 1.45 }}>{item.helper}</span><span style={{ display: "inline-block", marginTop: 12, color: c.primaryDark, fontWeight: 950 }}>Abrir ›</span></button>)}</div>
    </Card>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
      <MetricCard label="Estimaciones/pagos obra abiertos" value={openPayables.length} tone={openPayables.length ? "warn" : "ok"} />
      <MetricCard label="Contratos obra" value={constructionContracts.length} tone="primary" />
      <MetricCard label="Trámites activos" value={openPermits.length} tone={openPermits.length ? "warn" : "ok"} />
      <MetricCard label="Equipo construcción" value={team.length} tone="idle" />
    </div>
    <Card><SectionTitle title="Pendientes operativos ligados a pagos" helper="Estos registros ayudan a revisar que una estimación o gasto de obra no se pague sin soporte operativo." />
      <MiniTable columns={[{ key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name || r.projectId }, { key: "concept", label: "Concepto" }, { key: "supplier", label: "Proveedor", render: (r) => supplierDisplayName(r, data) }, { key: "categoryId", label: "Partida", render: (r) => categoryMap[r.categoryId]?.name || r.categoryId }, { key: "requestedBy", label: "Solicitó" }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "amount", label: "Total", render: (r) => money(payableTotal(r)) }]} rows={openPayables.slice(0, 12)} empty="No hay pagos/estimaciones de obra pendientes." />
    </Card>
    <Card><SectionTitle title="Trámites que pueden afectar operación" helper="Vista rápida para ligar avance de obra con permisos, gestoría y riesgos de cierre." />
      <MiniTable columns={[{ key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name || r.projectId }, { key: "name", label: "Trámite" }, { key: "stage", label: "Etapa" }, { key: "status", label: "Estatus", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "nextAction", label: "Siguiente acción" }, { key: "owner", label: "Responsable" }]} rows={openPermits.slice(0, 12)} empty="No hay trámites activos." />
    </Card>
  </div>;
}


function estimateSectionRows(data = {}) {
  const progress = data.estimateProgress || {};
  return arennaThEstimateSections.map((section) => {
    const concepts = arennaThEstimateConcepts.filter((cpt) => cpt.sectionId === section.id);
    const baseTotal = concepts.reduce((sum, cpt) => sum + Number(cpt.total || 0), 0);
    const requested = concepts.reduce((sum, cpt) => {
      const p = progress[cpt.id] || {};
      const pct = Math.min(100, Math.max(0, Number(p.progressPct || 0))) / 100;
      const qty = Number(p.estimateQuantity || 0);
      const amountByQty = qty > 0 ? qty * Number(cpt.unitPrice || 0) : Number(cpt.total || 0) * pct;
      return sum + amountByQty;
    }, 0);
    const ready = concepts.filter((cpt) => progress[cpt.id]?.qualityChecklistDone).length;
    const touched = concepts.filter((cpt) => Number(progress[cpt.id]?.progressPct || 0) > 0 || Number(progress[cpt.id]?.estimateQuantity || 0) > 0).length;
    return { ...section, conceptsCount: concepts.length, baseTotal, requested, ready, touched, progressPct: concepts.length ? Math.round((touched / concepts.length) * 100) : 0, qualityPct: concepts.length ? Math.round((ready / concepts.length) * 100) : 0 };
  });
}

function OperationWorksConfig({ data, projectMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const [selectedId, setSelectedId] = useState(data.projects[0]?.id || "");
  const selected = data.projects.find((p) => p.id === selectedId) || data.projects[0] || {};
  function blankProject() {
    setForm({ name: "", type: "", status: "Planeación", location: "", owner: "TRITON", budget: "", incomeTarget: "", totalUnits: "", unitsText: "", modelsText: "", estimateCatalogId: arennaThEstimateCatalogMeta.id, retentionPct: 10, advancePct: 0, notes: "" });
    setShowForm("operationProject");
  }
  function editProject(project) {
    setSelectedId(project.id);
    setForm({ ...project, unitsText: Array.isArray(project.units) ? project.units.join(", ") : project.unitsText || "", modelsText: Array.isArray(project.models) ? project.models.join(", ") : project.modelsText || "", retentionPct: project.retentionPct ?? 10, advancePct: project.advancePct ?? 0 });
    setShowForm("operationProject");
  }
  function saveProject() {
    if (!String(form.name || "").trim()) { alert("Captura el nombre de la obra."); return; }
    const payload = {
      name: form.name || "Obra sin nombre",
      type: form.type || "Desarrollo",
      status: form.status || "Planeación",
      location: form.location || "",
      owner: form.owner || "TRITON",
      budget: Number(form.budget || 0),
      incomeTarget: Number(form.incomeTarget || 0),
      totalUnits: Number(form.totalUnits || 0),
      units: String(form.unitsText || "").split(",").map((x) => x.trim()).filter(Boolean),
      models: String(form.modelsText || "").split(",").map((x) => x.trim()).filter(Boolean),
      estimateCatalogId: form.estimateCatalogId || arennaThEstimateCatalogMeta.id,
      retentionPct: Number(form.retentionPct ?? 10),
      advancePct: Number(form.advancePct ?? 0),
      notes: form.notes || "",
      updatedBy: firebaseAuth.currentUser?.email || "sistema",
    };
    if (form.id) updateRecord("projects", form.id, payload);
    else addRecord("projects", { ...payload, createdBy: firebaseAuth.currentUser?.email || "sistema" });
    setShowForm(null);
    setForm({});
  }
  const operations = [
    { label: "Alta nueva", helper: "Empieza en blanco, sin matriz predefinida ni información pesada.", done: true },
    { label: "Editar obra existente", helper: "Carga el proyecto actual para corregir unidades, presupuesto y alcance.", done: true },
    { label: "Checklist por etapa", helper: "Se activa después, cuando definas el catálogo o plantilla aplicable.", done: false },
    { label: "Estimaciones", helper: "Liga el catálogo de conceptos para liberar pagos por avance.", done: !!selected?.estimateCatalogId },
  ];
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}><SectionTitle title="Configuración de obra" helper="Proceso simple: primero alta/edición de obra, después se liga catálogo, unidades y reglas. Las nuevas obras empiezan en blanco para no saturar al usuario." /><Button onClick={blankProject}>Nueva obra en blanco</Button></div><ProgressLine items={operations.map((item) => ({ label: item.label, done: item.done, active: !item.done }))} /></Card>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,.75fr) minmax(0,1.25fr)", gap: 16 }}>
      <Card><SectionTitle title="Obras actuales" helper="Da clic para revisar o editar." />
        <div style={{ display: "grid", gap: 9 }}>{data.projects.map((project) => <button key={project.id} type="button" onClick={() => setSelectedId(project.id)} style={{ textAlign: "left", border: selectedId === project.id ? `2px solid ${c.primary}` : `1px solid ${c.border}`, borderRadius: 18, background: selectedId === project.id ? c.primarySoft : "white", padding: 12, cursor: "pointer" }}><b style={{ color: c.text }}>{project.name}</b><div style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>{project.type || "Sin tipo"} · {project.status || "Sin estatus"}</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}><Pill tone="primary">{money(project.budget)}</Pill><Pill>{Number(project.totalUnits || 0)} unidades</Pill></div></button>)}</div>
      </Card>
      <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title={selected?.name || "Selecciona una obra"} helper="Ficha editable conectada con presupuestos, estimaciones, trámites y equipo de construcción." /><Button variant="secondary" onClick={() => editProject(selected)}>Editar obra</Button></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
          <Info label="Tipo" value={selected.type || "Pendiente"} />
          <Info label="Ubicación" value={selected.location || "Pendiente"} />
          <Info label="Estatus" value={selected.status || "Pendiente"} />
          <Info label="Presupuesto" value={money(selected.budget)} />
          <Info label="Ingresos proyectados" value={money(selected.incomeTarget)} />
          <Info label="Catálogo estimación" value={selected.estimateCatalogId || arennaThEstimateCatalogMeta.name} />
        </div>
      </Card>
    </div>
    {showForm === "operationProject" ? <Card><SectionTitle title={form.id ? "Editar obra existente" : "Nueva obra"} helper="Campos limpios. No se carga matriz automática hasta que elijas una plantilla o catálogo." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}>
        <Field label="Nombre de obra"><input style={inputStyle()} value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Tipo"><select style={inputStyle()} value={form.type || ""} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="">Seleccionar</option><option>Desarrollo habitacional</option><option>Departamentos</option><option>Plaza comercial</option><option>Oficinas</option><option>Casa / remodelación</option><option>Otro</option></select></Field>
        <Field label="Estatus"><select style={inputStyle()} value={form.status || "Planeación"} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>Planeación</option><option>Activo</option><option>En construcción</option><option>Pausado</option><option>Cerrado</option></select></Field>
        <Field label="Ubicación"><input style={inputStyle()} value={form.location || ""} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
        <Field label="Unidades totales"><input type="number" style={inputStyle()} value={form.totalUnits || ""} onChange={(e) => setForm({ ...form, totalUnits: e.target.value })} /></Field>
        <Field label="Presupuesto"><input type="number" style={inputStyle()} value={form.budget || ""} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></Field>
        <Field label="Ingresos proyectados"><input type="number" style={inputStyle()} value={form.incomeTarget || ""} onChange={(e) => setForm({ ...form, incomeTarget: e.target.value })} /></Field>
        <Field label="Retención obra %" help="Porcentaje que se retiene de cada estimación como garantía de obra bien ejecutada; se libera al cierre del contrato."><input type="number" style={inputStyle()} value={form.retentionPct ?? 10} onChange={(e) => setForm({ ...form, retentionPct: e.target.value })} /></Field>
        <Field label="Anticipo %" help="Porcentaje del contrato que se puede pagar por adelantado antes de que exista avance físico."><input type="number" style={inputStyle()} value={form.advancePct ?? 0} onChange={(e) => setForm({ ...form, advancePct: e.target.value })} /></Field>
      </div>
      <Field label="Unidades / lotes" help="Lista separada por comas. Cada unidad podrá seleccionarse después al capturar estimaciones y checklist de calidad."><input style={inputStyle()} placeholder="TH01, TH02, Casa 1, Depto 101" value={form.unitsText || ""} onChange={(e) => setForm({ ...form, unitsText: e.target.value })} /></Field>
      <Field label="Modelos"><input style={inputStyle()} placeholder="TH, HAUS, Depto A" value={form.modelsText || ""} onChange={(e) => setForm({ ...form, modelsText: e.target.value })} /></Field>
      <Field label="Notas operativas"><textarea style={inputStyle({ minHeight: 80 })} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button onClick={saveProject}>Guardar obra</Button><Button variant="secondary" onClick={() => { setShowForm(null); setForm({}); }}>Cancelar</Button></div>
    </Card> : null}
  </div>;
}

function OperationQuality({ data, projectMap, setActive }) {
  const [projectId, setProjectId] = useState("arenna");
  const [status, setStatus] = useState("todos");
  const rows = estimateSectionRows(data).filter((row) => status === "todos" || (status === "listo" ? row.qualityPct === 100 : status === "pendiente" ? row.qualityPct < 100 : true));
  const readyAmount = rows.reduce((sum, row) => sum + (row.qualityPct === 100 ? row.baseTotal : 0), 0);
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Checklist / Calidad por partida" helper="Vista operativa moderna. La constructora solo puede avanzar estimación cuando la partida tenga checklist y bitácora sin pendientes." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
        <Field label="Proyecto"><select style={inputStyle()} value={projectId} onChange={(e) => setProjectId(e.target.value)}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Estatus calidad"><select style={inputStyle()} value={status} onChange={(e) => setStatus(e.target.value)}><option value="todos">Todos</option><option value="pendiente">Pendientes</option><option value="listo">Listos para estimar</option></select></Field>
      </div>
    </Card>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
      <MetricCard label="Proyecto" value={projectMap[projectId]?.name || projectId} tone="primary" />
      <MetricCard label="Partidas" value={arennaThEstimateSections.length} tone="idle" />
      <MetricCard label="Monto listo calidad" value={money(readyAmount)} tone="ok" />
      <MetricCard label="Pendientes calidad" value={rows.filter((r) => r.qualityPct < 100).length} tone="warn" />
    </div>
    <Card><MiniTable columns={[
      { key: "id", label: "Clave" },
      { key: "name", label: "Partida" },
      { key: "conceptsCount", label: "Conceptos" },
      { key: "baseTotal", label: "Importe catálogo", render: (r) => money(r.baseTotal) },
      { key: "qualityPct", label: "Checklist", render: (r) => <Pill tone={r.qualityPct === 100 ? "ok" : "warn"}>{r.qualityPct}%</Pill> },
      { key: "actions", label: "Acción", render: (r) => <Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => setActive("estimaciones")}>Ir a estimar</Button> },
    ]} rows={rows} /></Card>
  </div>;
}

function OperationEstimations({ data, projectMap, categoryMap, addRecord, updateRecord, setData }) {
  const [projectId, setProjectId] = useState("arenna");
  const [sectionId, setSectionId] = useState(arennaThEstimateSections[0]?.id || "");
  const [search, setSearch] = useState("");
  const progress = data.estimateProgress || {};
  const selectedSection = arennaThEstimateSections.find((s) => s.id === sectionId) || arennaThEstimateSections[0];
  const sectionConcepts = arennaThEstimateConcepts.filter((cpt) => cpt.sectionId === selectedSection?.id);
  const rows = sectionConcepts.filter((cpt) => [cpt.id, cpt.description, cpt.unit, cpt.sectionName].join(" ").toLowerCase().includes(search.toLowerCase())).map((cpt) => {
    const p = progress[cpt.id] || {};
    const pct = Math.min(100, Math.max(0, Number(p.progressPct || 0)));
    const estimateQuantity = Number(p.estimateQuantity || 0);
    const requestedAmount = estimateQuantity > 0 ? estimateQuantity * Number(cpt.unitPrice || 0) : Number(cpt.total || 0) * pct / 100;
    return { ...cpt, ...p, progressPct: pct, estimateQuantity, requestedAmount, status: p.sentToPayable ? "Solicitado" : p.qualityChecklistDone ? "Listo para solicitar" : pct > 0 ? "Checklist pendiente" : "Sin avance" };
  });
  const sectionSummary = estimateSectionRows(data).find((x) => x.id === selectedSection?.id) || {};
  function patchConcept(id, patch) {
    setData((prev) => ({ ...prev, estimateProgress: { ...(prev.estimateProgress || {}), [id]: { ...(prev.estimateProgress?.[id] || {}), ...patch, updatedAt: new Date().toISOString(), updatedBy: firebaseAuth.currentUser?.email || "sistema" } } }));
  }
  function markSectionQualityDone() {
    setData((prev) => {
      const next = { ...(prev.estimateProgress || {}) };
      sectionConcepts.forEach((cpt) => { next[cpt.id] = { ...(next[cpt.id] || {}), qualityChecklistDone: true, qualityChecklistAt: new Date().toISOString(), qualityChecklistBy: firebaseAuth.currentUser?.email || "sistema" }; });
      return { ...prev, estimateProgress: next };
    });
  }
  function requestEstimatePayment() {
    const readyRows = rows.filter((r) => r.qualityChecklistDone && Number(r.requestedAmount || 0) > 0 && !r.sentToPayable);
    const amount = readyRows.reduce((sum, r) => sum + Number(r.requestedAmount || 0), 0);
    if (!readyRows.length || amount <= 0) { alert("No hay conceptos listos con monto para solicitar. Captura avance y completa checklist."); return; }
    const supplier = data.suppliers.find((s) => s.id === "sup-cons") || data.suppliers.find((s) => String(s.type || "").toLowerCase().includes("constructora")) || data.suppliers[0];
    addRecord("payables", {
      folio: nextFolio(data, "payables", "SP"),
      projectId,
      supplierId: supplier?.id || "",
      supplier: supplier?.tradeName || "Constructora",
      concept: `Estimación ${selectedSection.id} · ${selectedSection.name}`,
      categoryId: "construccion",
      amount: roundMoney(amount),
      iva: 0,
      retention: 0,
      requestedBy: firebaseAuth.currentUser?.email || "Constructora",
      requiredDate: todayIso(),
      status: "Solicitado",
      priority: "Alta",
      documentStatus: "Checklist calidad liberado",
      notes: `${readyRows.length} concepto(s) desde catálogo ${arennaThEstimateCatalogMeta.name}. Checklist técnico completo. Conceptos: ${readyRows.slice(0, 8).map((r) => r.id).join(", ")}${readyRows.length > 8 ? "..." : ""}`,
      attachments: [],
      estimationCatalogId: arennaThEstimateCatalogMeta.id,
      estimationSectionId: selectedSection.id,
    });
    setData((prev) => {
      const next = { ...(prev.estimateProgress || {}) };
      readyRows.forEach((r) => { next[r.id] = { ...(next[r.id] || {}), sentToPayable: true, sentToPayableAt: new Date().toISOString() }; });
      return { ...prev, estimateProgress: next };
    });
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Estimaciones por catálogo de conceptos" helper="Catálogo importado desde el Excel de prueba. La constructora captura avance; el sistema muestra qué falta para liberar y enviar a pago." /><Pill tone="primary">{arennaThEstimateCatalogMeta.supplier}</Pill></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
        <Field label="Proyecto"><select style={inputStyle()} value={projectId} onChange={(e) => setProjectId(e.target.value)}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Partida"><select style={inputStyle()} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>{arennaThEstimateSections.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}</select></Field>
        <Field label="Buscar concepto"><input style={inputStyle()} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Clave, descripción, unidad" /></Field>
      </div>
    </Card>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
      <MetricCard label="Total catálogo TH" value={money(arennaThEstimateCatalogMeta.total)} tone="primary" />
      <MetricCard label="Partida seleccionada" value={money(sectionSummary.baseTotal)} tone="idle" />
      <MetricCard label="Estimado capturado" value={money(sectionSummary.requested)} tone="warn" />
      <MetricCard label="Checklist liberado" value={`${sectionSummary.qualityPct || 0}%`} tone={(sectionSummary.qualityPct || 0) === 100 ? "ok" : "warn"} />
    </div>
    <Card><SectionTitle title="Qué falta para liberar esta partida" helper="Reglas base derivadas del tipo de partida. Se podrá parametrizar en Catálogos y reglas." /><ValidationList checks={checklistForEstimateSection(selectedSection?.name).map((label) => ({ label, ok: (sectionSummary.qualityPct || 0) === 100, fix: "Pendiente" }))} /><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><Button variant="secondary" help="Marca TODOS los conceptos de esta partida como checklist completo de una vez. Úsalo solo si ya verificaste cada concepto; si no, márcalos uno por uno en la tabla." onClick={markSectionQualityDone}>Marcar checklist de partida como completo</Button><Button help="Crea una solicitud de pago con el importe estimado de los conceptos que ya tienen checklist completo y avance capturado." onClick={requestEstimatePayment}>Enviar estimación a pagos</Button></div></Card>
    <Card><div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}><ExportCsvButton filename="estimacion-conceptos.csv" rows={rows.map((r) => ({ Clave: r.id, Concepto: r.description, Unidad: r.unit, CantidadContrato: r.quantity, PrecioUnitario: r.unitPrice, AvancePct: r.progressPct, CantidadEstimar: r.estimateQuantity, ImporteEstimado: r.requestedAmount, Checklist: r.qualityChecklistDone ? "Listo" : "Pendiente", Estado: r.status }))} /></div><MiniTable columns={[
      { key: "id", label: "Clave" },
      { key: "description", label: "Concepto", render: (r) => <div style={{ maxWidth: 440, lineHeight: 1.35 }}>{r.description}</div> },
      { key: "unit", label: "Unidad" },
      { key: "quantity", label: "Cant. contrato", render: (r) => numberFmt(r.quantity) },
      { key: "unitPrice", label: "PU", render: (r) => money(r.unitPrice) },
      { key: "progressPct", label: "Avance %", render: (r) => <input type="number" min="0" max="100" style={inputStyle({ width: 92, padding: "7px 8px" })} value={r.progressPct || ""} onChange={(e) => patchConcept(r.id, { progressPct: Number(e.target.value || 0) })} /> },
      { key: "estimateQuantity", label: "Cant. a estimar", render: (r) => <input type="number" min="0" style={inputStyle({ width: 110, padding: "7px 8px" })} value={r.estimateQuantity || ""} onChange={(e) => patchConcept(r.id, { estimateQuantity: Number(e.target.value || 0) })} /> },
      { key: "requestedAmount", label: "Importe estimado", render: (r) => money(r.requestedAmount) },
      { key: "qualityChecklistDone", label: "Checklist", render: (r) => <button type="button" onClick={() => patchConcept(r.id, { qualityChecklistDone: !r.qualityChecklistDone })} style={toggleChipStyle(!!r.qualityChecklistDone)}>{r.qualityChecklistDone ? "Listo" : "Pendiente"}</button> },
      { key: "status", label: "Estado", render: (r) => <Pill tone={r.status === "Solicitado" ? "ok" : r.status === "Listo para solicitar" ? "primary" : "warn"}>{r.status}</Pill> },
    ]} rows={rows} /></Card>
  </div>;
}

function OperationTechnical({ data, projectMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const [projectId, setProjectId] = useState(data.projects[0]?.id || "arenna");
  const [search, setSearch] = useState("");
  const rows = (data.technicalQueries || []).filter((q) => (projectId === "todos" || q.projectId === projectId) && [q.title, q.question, q.response, q.status, q.module].join(" ").toLowerCase().includes(search.toLowerCase()));
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Consulta técnica" helper="Registro de dudas, criterios, respuestas y soporte documental. Evita que la información técnica se pierda en WhatsApp." /><Button onClick={() => setShowForm(showForm === "technicalQuery" ? null : "technicalQuery")}>Nueva consulta</Button></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
        <Field label="Proyecto"><select style={inputStyle()} value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="todos">Todos</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Buscar"><input style={inputStyle()} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Duda, respuesta, módulo" /></Field>
      </div>
    </Card>
    {showForm === "technicalQuery" ? <Card><SectionTitle title="Nueva consulta técnica" helper="La respuesta queda en historial y puede ligarse a calidad o estimaciones." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}>
        <Field label="Proyecto"><select style={inputStyle()} value={form.projectId || data.projects[0]?.id || ""} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Módulo"><select style={inputStyle()} value={form.module || "Calidad"} onChange={(e) => setForm({ ...form, module: e.target.value })}><option>Calidad</option><option>Estimaciones</option><option>Obra</option><option>Trámites</option><option>Finanzas</option></select></Field>
        <Field label="Prioridad"><select style={inputStyle()} value={form.priority || "Media"} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>Alta</option><option>Media</option><option>Baja</option></select></Field>
      </div>
      <Field label="Título"><input style={inputStyle()} value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
      <Field label="Consulta / duda"><textarea style={inputStyle({ minHeight: 92 })} value={form.question || ""} onChange={(e) => setForm({ ...form, question: e.target.value })} /></Field>
      <Field label="Respuesta / criterio"><textarea style={inputStyle({ minHeight: 92 })} value={form.response || ""} onChange={(e) => setForm({ ...form, response: e.target.value })} /></Field>
      <Button onClick={() => { if (!String(form.question || "").trim()) { alert("Escribe la duda o consulta antes de guardar."); return; } addRecord("technicalQueries", { projectId: form.projectId || data.projects[0]?.id || "", title: form.title || "Consulta técnica", module: form.module || "Calidad", status: form.response ? "Respondida" : "Abierta", priority: form.priority || "Media", requestedBy: firebaseAuth.currentUser?.email || "usuario", question: form.question || "", response: form.response || "", history: [{ id: uid("tech"), date: new Date().toISOString(), user: firebaseAuth.currentUser?.email || "sistema", comment: "Alta de consulta técnica" }] }); }}>Guardar consulta</Button>
    </Card> : null}
    <Card><div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}><ExportCsvButton filename="consultas-tecnicas.csv" rows={rows.map((r) => ({ Proyecto: projectMap[r.projectId]?.name || "", Consulta: r.title, Modulo: r.module, Prioridad: r.priority, Estado: r.status, Pregunta: r.question, Respuesta: r.response || "" }))} /></div><MiniTable columns={[
      { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name || r.projectId },
      { key: "title", label: "Consulta" },
      { key: "module", label: "Módulo" },
      { key: "priority", label: "Prioridad", render: (r) => <Pill tone={r.priority === "Alta" ? "danger" : "primary"}>{r.priority}</Pill> },
      { key: "status", label: "Estado", render: (r) => <Pill tone={r.status === "Respondida" ? "ok" : "warn"}>{r.status}</Pill> },
      { key: "question", label: "Detalle", render: (r) => <div style={{ maxWidth: 420 }}><b>{r.question}</b>{r.response ? <div style={{ color: c.muted, marginTop: 4 }}>{r.response}</div> : null}</div> },
      { key: "actions", label: "Acciones", render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("technicalQueries", r.id, { status: "Respondida", response: r.response || "Respuesta registrada por supervisión.", answeredBy: firebaseAuth.currentUser?.email || "sistema" })}>Marcar respondida</Button></ActionCell> },
    ]} rows={rows} /></Card>
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
      <Card><Pill tone="primary" help="Suma de todas las partidas presupuestales autorizadas por proyecto y categoría.">Presupuesto</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totalBudget)}</div></Card>
      <Card><Pill tone="warn" help="Total de solicitudes de pago activas (no rechazadas/canceladas), aunque todavía no se hayan pagado.">Comprometido</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totalCommitted)}</div></Card>
      <Card><Pill tone="purple" help="Pagos ya autorizados o programados que todavía no salen del banco.">Autorizado pendiente</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(authorized)}</div></Card>
      <Card><Pill tone="ok" help="Suma de todos los pagos ya realizados (registrados en Pagos realizados).">Pagado</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(paid)}</div></Card>
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
  const { prompt } = usePrompt();
  async function adjustBudget(row) {
    const value = await prompt({ title: "Ajustar presupuesto", label: "Nuevo presupuesto autorizado", defaultValue: row.budget, type: "number" });
    if (value !== null) updateRecord("budgets", row.id, { budget: Number(value || 0), updatedAt: todayIso() });
  }
  const budgetRows = data.budgets
    .map((b) => { const committed = committedFor(data, b.projectId, b.categoryId); return { ...b, committed, available: Number(b.budget || 0) - committed }; })
    .filter((b) => projectLocalFilter === "todos" || b.projectId === projectLocalFilter)
    .filter((b) => categoryLocalFilter === "todos" || b.categoryId === categoryLocalFilter);
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Presupuestos por proyecto" helper="La partida presupuestal es obligatoria para cualquier pago. Los filtros viven sobre la tabla donde se usan." /><ProgressLine items={[{ label: "Proyecto" , done: true }, { label: "Partida", done: true }, { label: "Presupuesto" , active: true }, { label: "Comprometido" }, { label: "Disponible" }]} /></Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Nueva / ajuste de partida" helper="Carga presupuesto autorizado por categoría. Los pagos toman esta base para validar disponibilidad." /><Button help="Da de alta el techo autorizado para una categoría dentro de un proyecto." onClick={() => setShowForm(showForm === "budget" ? null : "budget")}>Nueva partida</Button></div>
      {showForm === "budget" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Categoría"><select style={inputStyle()} value={form.categoryId || "construccion"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((c) => c.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field><Field label="Presupuesto autorizado" help="Monto máximo que se puede comprometer en esta categoría. Cualquier solicitud de pago que lo rebase se marca como sobregiro y necesita justificación."><input type="number" style={inputStyle()} value={form.budget || ""} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></Field><Field label="Responsable autorización" help="Quién autorizó este monto (referencia para auditoría, no cambia permisos del sistema)."><input style={inputStyle()} value={form.authorizedBy || ""} onChange={(e) => setForm({ ...form, authorizedBy: e.target.value })} /></Field></div><Field label="Comentario / soporte" help="Nota libre: de dónde sale el monto autorizado (correo, junta, contrato marco, etc.)."><input style={inputStyle()} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field><Button help="Guarda la partida; queda disponible de inmediato para validar solicitudes de pago." onClick={() => { if (!(Number(form.budget || 0) > 0)) { alert("Captura un presupuesto autorizado mayor a cero."); return; } addRecord("budgets", { projectId: form.projectId || "arenna", categoryId: form.categoryId || "construccion", budget: Number(form.budget || 0), authorizedBy: form.authorizedBy || "Dirección", notes: form.notes || "", updatedAt: todayIso() }); }}>Guardar presupuesto</Button></div> : null}
    </Card>
    <Card><div style={{ display: "flex", alignItems: "end", gap: 10, flexWrap: "wrap", marginBottom: 12 }}><Field label="Filtrar proyecto"><select value={projectLocalFilter} onChange={(e) => setProjectLocalFilter(e.target.value)} style={inputStyle({ width: 220 })}><option value="todos">Todos los proyectos</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Filtrar categoría"><select value={categoryLocalFilter} onChange={(e) => setCategoryLocalFilter(e.target.value)} style={inputStyle({ width: 260 })}><option value="todos">Todas las categorías</option>{data.categories.filter((c) => c.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field><div style={{ paddingBottom: 10, color: c.muted, fontSize: 12, fontWeight: 850 }}>{budgetRows.length} partida(s)</div><div style={{ marginLeft: "auto" }}><ExportCsvButton filename="presupuestos.csv" rows={budgetRows.map((r) => ({ Proyecto: projectMap[r.projectId]?.name || "", Categoria: categoryMap[r.categoryId]?.name || "", Presupuesto: r.budget, Comprometido: r.committed, Disponible: r.available, Soporte: r.notes || "" }))} /></div></div><MiniTable columns={[{ key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "categoryId", label: "Categoría", render: (r) => <EntityLink onClick={() => setDetail(r)} title="Abrir hoja de ayuda de la partida">{categoryMap[r.categoryId]?.name}</EntityLink> }, { key: "budget", label: "Presupuesto", render: (r) => money(r.budget) }, { key: "committed", label: "Comprometido", render: (r) => money(r.committed) }, { key: "available", label: "Disponible", render: (r) => <Pill tone={r.available >= 0 ? "ok" : "danger"} help={r.available >= 0 ? "Presupuesto menos comprometido: lo que aún se puede solicitar sin generar sobregiro." : "Ya se comprometió más de lo autorizado; las nuevas solicitudes requerirán justificación de sobregiro."}>{money(r.available)}</Pill> }, { key: "notes", label: "Soporte" }, { key: "help", label: "Hoja de ayuda", render: (r) => <Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help="Muestra las solicitudes, pagos y contratos que consumen esta partida." onClick={() => setDetail(r)}>Ver gastos</Button> }, { key: "actions", label: "Ajustar", render: (r) => <Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help="Cambia el monto autorizado de esta partida." onClick={() => adjustBudget(r)}>Editar</Button> }]} rows={budgetRows} /></Card>
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
  function createContract() {
    if (!String(form.name || "").trim()) { alert("Captura el nombre del contrato."); return; }
    if (!(Number(form.amount || 0) > 0)) { alert("Captura el monto total autorizado."); return; }
    addRecord("financeContracts", { folio: nextFolio(data, "financeContracts", "CT"), projectId: form.projectId || "arenna", supplierId: form.supplierId || data.suppliers[0]?.id || "", categoryId: form.categoryId || "construccion", name: form.name || "Contrato", amount: Number(form.amount || 0), advanceAmount: Number(form.advanceAmount || 0), status: form.status || "Vigente", startDate: todayIso(), endDate: "", paymentPlan: form.paymentPlan || "Anticipo / parcialidades / saldo", documents: normalizeAttachments(form.documents) });
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Contratos y soportes autorizados" helper="Un contrato es el techo autorizado. Anticipo, parcialidades, estimaciones y saldo quedan ligados para no pagar doble ni exceder monto." /><ProgressLine items={[{ label: "Contrato", done: true }, { label: "Anticipo" }, { label: "Parcialidades" }, { label: "Saldo" }, { label: "Cierre" }]} /></Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Nuevo contrato" helper="Define monto total, plan de pagos y anexos. Las solicitudes pueden ligarse a este contrato." /><Button onClick={() => setShowForm(showForm === "contract" ? null : "contract")}>Nuevo contrato</Button></div>
      {showForm === "contract" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Proveedor"><select style={inputStyle()} value={form.supplierId || data.suppliers[0]?.id || ""} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>{data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.tradeName}</option>)}</select></Field><Field label="Categoría"><select style={inputStyle()} value={form.categoryId || "construccion"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((c) => c.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field><Field label="Monto total autorizado" help="Techo máximo del contrato. Las solicitudes de pago ligadas a este contrato no pueden sumar más que este monto."><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Anticipo autorizado" help="Parte del monto total que se puede pagar por adelantado, antes de avance de obra."><input type="number" style={inputStyle()} value={form.advanceAmount || ""} onChange={(e) => setForm({ ...form, advanceAmount: e.target.value })} /></Field><Field label="Estatus" help="Vigente permite ligar nuevas solicitudes. Cerrado/Cancelado lo deja solo como consulta histórica."><select style={inputStyle()} value={form.status || "Vigente"} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>Vigente</option><option>Pendiente firma</option><option>Cerrado</option><option>Cancelado</option></select></Field></div><Field label="Nombre del contrato"><input style={inputStyle()} value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Plan de pagos" help="Describe cómo se libera el monto (anticipo, parcialidades, saldo). Es texto libre de referencia, no controla montos automáticamente."><textarea style={inputStyle({ minHeight: 68 })} placeholder="Anticipo 30%, avance 40%, saldo 30%" value={form.paymentPlan || ""} onChange={(e) => setForm({ ...form, paymentPlan: e.target.value })} /></Field><AttachmentUploader label="Subir contrato / cotización / carátula" value={form.documents} folder="finanzas/contratos" onChange={(documents) => setForm({ ...form, documents })} helper="Carga el contrato firmado, cotización autorizada, carátula bancaria y cualquier soporte." /><Button help="Guarda el contrato; a partir de aquí ya puede seleccionarse al capturar una solicitud de pago." onClick={createContract}>Guardar contrato</Button></div> : null}
    </Card>
    <Card><div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}><ExportCsvButton filename="contratos.csv" rows={contractRows().map((r) => ({ Folio: r.folio || r.id, Contrato: r.name, Proyecto: projectMap[r.projectId]?.name || "", Proveedor: data.suppliers.find((s) => s.id === r.supplierId)?.tradeName || "", Monto: r.amount, Solicitado: r.requested, Pagado: r.paid, Saldo: r.balance, Estado: r.status }))} /></div><MiniTable columns={[{ key: "folio", label: "Folio", render: (r) => <span style={{ fontFamily: "monospace", fontSize: 12, color: c.muted }}>{r.folio || "—"}</span> }, { key: "name", label: "Contrato" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "supplierId", label: "Proveedor", render: (r) => data.suppliers.find((s) => s.id === r.supplierId)?.tradeName }, { key: "categoryId", label: "Categoría", render: (r) => categoryMap[r.categoryId]?.name }, { key: "amount", label: "Monto autorizado", render: (r) => money(r.amount) }, { key: "requested", label: "Solicitado ligado", render: (r) => money(r.requested) }, { key: "paid", label: "Pagado", render: (r) => money(r.paid) }, { key: "balance", label: "Saldo", render: (r) => <Pill tone={r.balance >= 0 ? "ok" : "danger"} help={r.balance >= 0 ? "Lo que queda del contrato sin comprometer." : "Las solicitudes ligadas ya superaron el monto autorizado del contrato."}>{money(r.balance)}</Pill> }, { key: "documents", label: "Anexos", render: (r) => <AttachmentViewer value={r.documents} /> }, { key: "paymentPlan", label: "Plan" }]} rows={contractRows()} /></Card>
  </div>;
}

function RecurringPayments({ data, projectMap, categoryMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const recs = data.recurringPayments || [];
  function generate(rec) {
    const period = rec.nextDate || todayIso();
    const alreadyGenerated = data.payables.some((p) => p.recurringPaymentId === rec.id && p.requiredDate === period && !["Rechazado", "Cancelado"].includes(p.status));
    if (alreadyGenerated) { alert(`Ya existe una solicitud generada para "${rec.concept}" en este periodo (${period}). Revisa Solicitudes de pago antes de generar otra, para no duplicar el pago.`); return; }
    const supplier = data.suppliers.find((s) => s.id === rec.supplierId);
    addRecord("payables", { folio: nextFolio(data, "payables", "SP"), projectId: rec.projectId, supplierId: rec.supplierId, supplier: supplier?.tradeName || "Proveedor", concept: rec.concept, categoryId: rec.categoryId, contractId: rec.contractId || "", paymentStage: "Recurrente", amount: Number(rec.amount || 0), iva: Number(rec.iva || 0), retention: Number(rec.retention || 0), requestedBy: "Pago recurrente", requiredDate: period, status: "En revisión", priority: "Media", documentStatus: rec.requiresInvoice ? "Pendiente factura" : "Soporte recurrente", recurringPaymentId: rec.id, adminReviewed: false, recurringAuthorized: true, attachments: [], notes: `Generado desde pago recurrente autorizado por ${rec.authorizedBy || "Dirección"}.` });
  }
  function createRecurring() {
    if (!String(form.concept || "").trim()) { alert("Captura el concepto del pago recurrente."); return; }
    if (!(Number(form.amount || 0) > 0)) { alert("Captura un monto mayor a cero."); return; }
    addRecord("recurringPayments", { folio: nextFolio(data, "recurringPayments", "PR"), projectId: form.projectId || "arenna", supplierId: form.supplierId || data.suppliers[0]?.id || "", categoryId: form.categoryId || "admin_obra", concept: form.concept || "Pago recurrente", amount: Number(form.amount || 0), iva: Number(form.iva || 0), retention: 0, frequency: form.frequency || "Mensual", day: Number(form.day || 5), status: "Activo", authorizedBy: "rodrigo@tritondesarrollos.com", requiresInvoice: form.requiresInvoice !== "No", nextDate: todayIso(), notes: "Autorización base registrada." });
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Pagos recurrentes" helper="Autorización base para pagos repetitivos. Cada periodo genera solicitud y administración valida monto/documento antes de pagar." /><ProgressLine items={[{ label: "Autorización base", done: true }, { label: "Generar periodo", active: true }, { label: "Factura/soporte" }, { label: "Pago" }, { label: "Conciliación" }]} /></Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Nuevo recurrente" helper="Servicios, rentas, software, honorarios, intereses o pagos oficiales recurrentes." /><Button onClick={() => setShowForm(showForm === "recurring" ? null : "recurring")}>Nuevo recurrente</Button></div>
      {showForm === "recurring" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Proveedor"><select style={inputStyle()} value={form.supplierId || data.suppliers[0]?.id || ""} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>{data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.tradeName}</option>)}</select></Field><Field label="Categoría"><select style={inputStyle()} value={form.categoryId || "admin_obra"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((c) => c.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field><Field label="Monto" help="Monto base antes de IVA que se generará automáticamente en cada periodo."><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="IVA"><input type="number" style={inputStyle()} value={form.iva || ""} onChange={(e) => setForm({ ...form, iva: e.target.value })} /></Field><Field label="Periodicidad" help="Cada cuánto se debe generar la solicitud (no se genera sola: usa el botón Generar solicitud cuando toque)."><select style={inputStyle()} value={form.frequency || "Mensual"} onChange={(e) => setForm({ ...form, frequency: e.target.value })}><option>Semanal</option><option>Quincenal</option><option>Mensual</option><option>Anual</option><option>Variable</option></select></Field><Field label="Día de generación" help="Día del mes/periodo en que normalmente corresponde generar este pago. Es referencia para el equipo, no dispara nada automático."><input type="number" style={inputStyle()} value={form.day || "5"} onChange={(e) => setForm({ ...form, day: e.target.value })} /></Field><Field label="Requiere factura" help="Si es Sí, la solicitud generada queda marcada como Pendiente factura hasta que se suba el CFDI."><select style={inputStyle()} value={form.requiresInvoice || "Sí"} onChange={(e) => setForm({ ...form, requiresInvoice: e.target.value })}><option>Sí</option><option>No</option></select></Field></div><Field label="Concepto"><input style={inputStyle()} value={form.concept || ""} onChange={(e) => setForm({ ...form, concept: e.target.value })} /></Field><Button help="Registra la autorización base. Todavía no crea ninguna solicitud de pago: eso se hace con 'Generar solicitud' en cada periodo." onClick={createRecurring}>Guardar recurrente</Button></div> : null}
    </Card>
    <Card><div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}><ExportCsvButton filename="pagos-recurrentes.csv" rows={recs.map((r) => ({ Folio: r.folio || r.id, Concepto: r.concept, Proyecto: projectMap[r.projectId]?.name || "", Proveedor: data.suppliers.find((s) => s.id === r.supplierId)?.tradeName || "", Monto: Number(r.amount || 0) + Number(r.iva || 0) - Number(r.retention || 0), Frecuencia: r.frequency, Siguiente: r.nextDate, Estado: r.status }))} /></div><MiniTable columns={[{ key: "folio", label: "Folio", render: (r) => <span style={{ fontFamily: "monospace", fontSize: 12, color: c.muted }}>{r.folio || "—"}</span> }, { key: "concept", label: "Concepto" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "supplierId", label: "Proveedor", render: (r) => data.suppliers.find((s) => s.id === r.supplierId)?.tradeName }, { key: "amount", label: "Monto", render: (r) => money(Number(r.amount || 0) + Number(r.iva || 0) - Number(r.retention || 0)) }, { key: "frequency", label: "Frecuencia" }, { key: "nextDate", label: "Siguiente" }, { key: "requiresInvoice", label: "Factura", render: (r) => r.requiresInvoice ? "Sí" : "No" }, { key: "status", label: "Estatus", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button style={{ padding: "7px 9px", fontSize: 12 }} help="Crea una solicitud de pago en Solicitudes de pago con estos datos, lista para revisión administrativa." onClick={() => generate(r)}>Generar solicitud</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help={r.status === "Activo" ? "Deja de generar/permitir solicitudes de este recurrente hasta reactivarlo." : "Vuelve a habilitar este pago recurrente."} onClick={() => updateRecord("recurringPayments", r.id, { status: r.status === "Activo" ? "Pausado" : "Activo" })}>{r.status === "Activo" ? "Pausar" : "Activar"}</Button></div> }]} rows={recs} /></Card>
  </div>;
}

const lockedDeleteStatuses = new Set(["Pagado", "Conciliado"]);
const HIGH_VALUE_THRESHOLD = 150000;
const resolvedPayableStatuses = new Set(["Pagado", "Conciliado", "Rechazado", "Cancelado"]);
function paymentAging(row) {
  if (resolvedPayableStatuses.has(row.status)) return { label: "—", tone: "idle" };
  const overdueDays = daysBetweenDates(row.requiredDate, todayIso());
  if (overdueDays > 0) return { label: `Vencido ${overdueDays}d`, tone: "danger" };
  if (overdueDays === 0) return { label: "Vence hoy", tone: "warn" };
  return { label: `Faltan ${Math.abs(overdueDays)}d`, tone: "ok" };
}
function filterBySearch(rows, query, getText) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => getText(row).toLowerCase().includes(q));
}

function nextFolio(data, collectionName, prefix) {
  const year = new Date().getFullYear();
  const yearPrefix = `${prefix}-${year}-`;
  const max = (data[collectionName] || []).reduce((acc, row) => {
    if (typeof row.folio === "string" && row.folio.startsWith(yearPrefix)) {
      const n = parseInt(row.folio.slice(yearPrefix.length), 10);
      if (!Number.isNaN(n) && n > acc) return n;
    }
    return acc;
  }, 0);
  return `${yearPrefix}${String(max + 1).padStart(4, "0")}`;
}

function exportToCsv(filename, rows) {
  if (!rows.length) { alert("No hay registros para exportar con el filtro actual."); return; }
  const headers = Object.keys(rows[0]);
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(escape).join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportCsvButton({ filename, rows, help = "Descarga esta tabla, con el filtro/búsqueda actual, en un archivo .csv para Excel." }) {
  return <Button variant="secondary" help={help} onClick={() => exportToCsv(filename, rows)}>Exportar CSV</Button>;
}

const RFC_PATTERN = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
function rfcLooksValid(rfc) {
  return RFC_PATTERN.test(String(rfc || "").trim().toUpperCase());
}
function clabeLooksValid(clabe) {
  return /^\d{18}$/.test(String(clabe || "").trim());
}

function Payables({ data, projectMap, categoryMap, rows, addRecord, updateRecord, deleteRecord, showForm, setShowForm, form, setForm }) {
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [editingPayment, setEditingPayment] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [statusFilter, setStatusFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const [reviewDraft, setReviewDraft] = useState(null);
  const currentUser = currentFinanceUser();
  const statusFiltered = filterByStatus(rows, statusFilter);
  const displayedRows = filterBySearch(statusFiltered, search, (r) => `${supplierDisplayName(r, data)} ${r.concept} ${data.suppliers.find((s) => s.id === r.supplierId)?.rfc || ""}`);
  const canAdminOperate = canFinanceAction("adminReview");
  const lastProjectId = data.payables[0]?.projectId || "arenna";
  const { prompt, confirm } = usePrompt();
  async function justifyOverspend(row) {
    const reason = await prompt({ title: "Justificar sobregiro", label: "Motivo administrativo del sobregiro / excepción", defaultValue: row.overspendReason || "", multiline: true });
    if (reason !== null) updateRecord("payables", row.id, { overspendApprovedByAdmin: true, overspendReason: reason, adminComment: reason });
  }
  async function removePayable(row) {
    if (lockedDeleteStatuses.has(row.status)) { alert(`No se puede eliminar: este pago ya está "${row.status}". Para corregirlo, usa una nota de crédito o ajuste contable.`); return; }
    const advanced = ["Autorizado", "Programado"].includes(row.status);
    const ok = await confirm({
      title: "Eliminar solicitud de pago",
      message: advanced
        ? `Esta solicitud ya fue "${row.status}". Eliminarla borra el movimiento por completo y no se puede deshacer. ¿Continuar?`
        : `Se eliminará la solicitud "${row.concept}" por ${money(payableTotal(row))}. Esta acción no se puede deshacer. ¿Continuar?`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });
    if (ok) deleteRecord("payables", row.id);
  }
  function pickSupplier(s) {
    const tax = form.amount ? calcTaxValues(form.amount, s, "base") : {};
    const lastForSupplier = data.payables.find((p) => p.supplierId === s.id);
    setForm({
      ...form,
      supplierId: s.id,
      categoryId: lastForSupplier?.categoryId || s.categoryId || form.categoryId,
      contractId: lastForSupplier?.contractId || "",
      paymentStage: lastForSupplier?.paymentStage || form.paymentStage,
      taxpayerType: s.taxpayerType || "Persona moral",
      ...tax,
    });
  }
  const supplier = data.suppliers.find((s) => s.id === (form.supplierId || data.suppliers[0]?.id));
  const activeContracts = (data.financeContracts || []).filter((ct) => !form.supplierId || ct.supplierId === form.supplierId);
  const previewRow = { projectId: form.projectId || lastProjectId, categoryId: form.categoryId || supplier?.categoryId || "construccion", amount: Number(form.amount || 0), iva: Number(form.iva || 0), retention: Number(form.retention || 0), contractId: form.contractId || "" };
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
    if (!String(form.concept || "").trim()) { alert("Captura el concepto de la solicitud."); return null; }
    if (!(Number(form.amount || 0) > 0) && !(Number(form.totalInput || 0) > 0)) { alert("Captura un monto mayor a cero."); return null; }
    const anexos = normalizeAttachments(form.attachments);
    const payload = {
      folio: nextFolio(data, "payables", "SP"),
      projectId: form.projectId || lastProjectId,
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
          <Field label="Proyecto"><select style={inputStyle()} value={form.projectId || lastProjectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Proveedor"><SearchableSupplierSelect data={data} value={form.supplierId || data.suppliers[0]?.id || ""} onChange={pickSupplier} /></Field>
          <Field label="Categoría / partida"><select style={inputStyle()} value={form.categoryId || supplier?.categoryId || "construccion"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((cat) => cat.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field>
          <Field label="Contrato ligado" help="Si el pago corresponde a un contrato existente, ligarlo evita exceder el monto autorizado y deja el rastro completo en la ficha del contrato."><select style={inputStyle()} value={form.contractId || ""} onChange={(e) => setForm({ ...form, contractId: e.target.value })}><option value="">Sin contrato</option>{activeContracts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}</select></Field>
          <Field label="Etapa de pago" help="En qué punto del contrato u obra corresponde este pago (anticipo, avance, saldo, etc.). Es informativo para el expediente."><select style={inputStyle()} value={form.paymentStage || "Pago parcial"} onChange={(e) => setForm({ ...form, paymentStage: e.target.value })}><option>Anticipo</option><option>Pago parcial</option><option>Estimación</option><option>Saldo</option><option>Recurrente</option><option>Reembolso</option><option>Reposición caja chica</option></select></Field>
          <Field label="Fecha requerida" help="Fecha en la que el proveedor necesita el pago. Se usa para calcular la columna Vencimiento y priorizar."><input type="date" style={inputStyle()} value={form.requiredDate || todayIso()} onChange={(e) => setForm({ ...form, requiredDate: e.target.value })} /></Field>
          <Field label="Prioridad" help="Urgencia declarada por quien solicita; ayuda a administración a decidir qué revisar primero, no cambia el flujo automáticamente."><select style={inputStyle()} value={form.priority || "Media"} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>Baja</option><option>Media</option><option>Alta</option><option>Urgente</option></select></Field>
        </div>
        <Field label="Concepto"><input style={inputStyle()} value={form.concept || ""} onChange={(e) => setForm({ ...form, concept: e.target.value })} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(280px,.55fr)", gap: 12 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
              <Field label="Monto antes IVA" help="Captura aquí si conoces el subtotal (base). El sistema calcula IVA y total automáticamente según el proveedor."><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => patchWithTax(e.target.value, "base")} /></Field>
              <Field label="Monto total a pagar" help="O captura aquí si solo conoces el total con IVA incluido; el sistema calcula la base hacia atrás."><input type="number" style={inputStyle()} value={form.totalInput || ""} onChange={(e) => patchWithTax(e.target.value, "total")} /></Field>
              <Field label="IVA" help="Se calcula solo al capturar base o total, pero puedes ajustarlo manualmente si la factura trae un valor distinto."><input type="number" style={inputStyle()} value={form.iva || ""} onChange={(e) => setForm({ ...form, iva: e.target.value })} /></Field>
              <Field label="Retenciones" help="Suma de ISR e IVA retenido que se descuenta del pago al proveedor (aplica principalmente a personas físicas)."><input type="number" style={inputStyle()} value={form.retention || ""} onChange={(e) => setForm({ ...form, retention: e.target.value })} /></Field>
            </div>
            <TaxSummary supplier={supplier} values={{ ...taxValues, ...form }} />
            <AttachmentUploader label="Subir factura / contrato / soporte" value={form.attachments} folder="finanzas/solicitudes-pago" onChange={(attachments) => setForm({ ...form, attachments })} onFilesUploaded={applyUploadedXml} helper="Sube varios archivos; después clasifica cada anexo para que viaje con la solicitud y sea consultable." />
          </div>
          <Card style={{ boxShadow: "none", padding: 12 }}><SectionTitle title="Validación previa" helper={`Total solicitud: ${money(payableTotal(previewRow))}`} /><ValidationList checks={[{ label: "Proveedor pagable", ok: supplierReady(supplier), fix: "Proveedor" }, { label: "Tiene presupuesto", ok: previewBudget.hasBudget, fix: "Sin presupuesto" }, { label: "Disponible / sobregiro justificado", ok: !previewBudget.over, fix: `Sobregiro ${money(Math.max(0, previewBudget.overspend))}` }, { label: "Contrato no excedido", ok: !previewContract.contract || !previewContract.over, fix: "Excede contrato" }, { label: "Anexos cargados", ok: attachmentCount(form.attachments) > 0, fix: "Anexos" }]} /></Card>
        </div>
        <Button help="Muestra un resumen final antes de crear la solicitud; todavía puedes cancelar en la siguiente pantalla." onClick={preparePayableReview}>Revisar y enviar solicitud</Button>
      </div> : null}
    </Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}><SectionTitle title="Solicitudes" helper="Administración debe revisar, justificar sobregiro y dejar expediente completo antes de enviar a autorización." /><ExportCsvButton filename="solicitudes-de-pago.csv" rows={displayedRows.map((r) => ({ Folio: r.folio || r.id, Proyecto: projectMap[r.projectId]?.name || "", Proveedor: supplierDisplayName(r, data), Concepto: r.concept, Etapa: r.paymentStage, Partida: categoryMap[r.categoryId]?.name || "", Total: payableTotal(r), Estado: r.status, FechaRequerida: r.requiredDate }))} /></div>
      <StatusFilter value={statusFilter} onChange={setStatusFilter} options={rows.map((r) => r.status)} total={rows.length} shown={displayedRows.length} />
      <div style={{ marginTop: -6, marginBottom: 12 }}><input style={inputStyle({ maxWidth: 340 })} placeholder="Buscar por proveedor, RFC o concepto…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <MiniTable columns={[{ key: "folio", label: "Folio", render: (r) => <span style={{ fontFamily: "monospace", fontSize: 12, color: c.muted }}>{r.folio || "—"}</span> }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "requestedBy", label: "Solicitó", render: (r) => <div><b>{r.requestedByName || r.requestedBy || "—"}</b><div style={{ color: c.muted, fontSize: 11 }}>{r.requestedBy || "sin usuario"}</div></div> }, { key: "supplier", label: "Proveedor", render: (r) => { const s = data.suppliers.find((x) => x.id === r.supplierId); return <EntityLink onClick={() => setSelectedSupplier(s)}>{supplierDisplayName(r, data)}</EntityLink>; } }, { key: "concept", label: "Concepto", render: (r) => <EntityLink onClick={() => setSelectedPayment(r)}>{r.concept}</EntityLink> }, { key: "paymentStage", label: "Etapa" }, { key: "categoryId", label: "Partida", render: (r) => categoryMap[r.categoryId]?.name }, { key: "amount", label: "Total", sortValue: (r) => payableTotal(r), render: (r) => <div><b>{money(payableTotal(r))}</b>{payableTotal(r) >= HIGH_VALUE_THRESHOLD ? <div style={{ marginTop: 3 }}><Pill tone="purple" help={`Solicitudes de ${money(HIGH_VALUE_THRESHOLD)} o más quedan marcadas para que autorización les dé una revisión más detallada.`}>Alto monto</Pill></div> : null}</div> }, { key: "budget", label: "Presupuesto", render: (r) => { const b = budgetCheck(data, r); return <Pill tone={!b.hasBudget || (b.over && !r.overspendApprovedByAdmin) ? "danger" : "ok"}>{!b.hasBudget ? "Sin presupuesto" : b.over ? `Sobregiro ${money(b.overspend)}` : `Disp. ${money(b.available)}`}</Pill>; } }, { key: "aging", label: "Vencimiento", sortValue: (r) => daysBetweenDates(r.requiredDate, todayIso()), render: (r) => { const aging = paymentAging(r); return <Pill tone={aging.tone}>{aging.label}</Pill>; } }, { key: "docs", label: "Anexos", render: (r) => <AttachmentViewer value={r.attachments} /> }, { key: "status", label: "Estado", render: (r) => <div style={{ minWidth: 170 }}><Pill tone={statusTone(r.status)}>{r.status}</Pill><div style={{ color: c.muted, fontSize: 11, marginTop: 5 }}>Automático por flujo</div></div> }, { key: "context", label: "Expediente", sortable: false, render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help="Abre el expediente completo: proveedor, presupuesto, anexos e historial." onClick={() => setSelectedPayment(r)}>Revisar</Button>{canFinanceAction("edit") && !lockedDeleteStatuses.has(r.status) ? <Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help="Corrige monto, concepto u otros datos de la solicitud." onClick={() => setEditingPayment(r)}>Editar</Button> : null}{canFinanceAction("edit") ? <Button variant="danger" style={{ padding: "7px 9px", fontSize: 12 }} disabled={lockedDeleteStatuses.has(r.status)} help={lockedDeleteStatuses.has(r.status) ? `Ya está "${r.status}": el registro queda fijo para no romper la conciliación. Usa un ajuste contable si hay un error.` : "Borra la solicitud por completo. No disponible una vez pagada/conciliada."} onClick={() => removePayable(r)}>Eliminar</Button> : null}</ActionCell> }, { key: "adminActions", label: "Revisión admin", sortable: false, render: (r) => { const check = canSendToAuthorization(data, r); if (!canAdminOperate) return <Pill tone="idle" help="Tu rol solo puede consultar esta solicitud; no puede revisarla ni enviarla a autorización.">Solo consulta</Pill>; return <ActionCell><Button style={{ padding: "7px 9px", fontSize: 12 }} help="Marca que administración ya validó presupuesto y documentos de esta solicitud." onClick={() => { const b = budgetCheck(data, r); updateRecord("payables", r.id, { adminReviewed: true, status: b.over && !r.overspendApprovedByAdmin ? "Observado" : "En revisión", adminReviewedAt: todayIso(), adminReviewedBy: currentUser.email }); }}>Revisar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help="Documenta por qué se autoriza pagar aunque exceda el presupuesto de la partida." onClick={() => justifyOverspend(r)}>Justificar sobregiro</Button><Button variant="success" style={{ padding: "7px 9px", fontSize: 12 }} disabled={!check.ok} help={check.ok ? "Pasa la solicitud a la bandeja de autorización final (solo el master autoriza)." : "Faltan requisitos (revisión admin, presupuesto o sobregiro sin justificar) antes de poder enviarla."} onClick={() => updateRecord("payables", r.id, { status: "Listo para autorización", readyForApprovalAt: todayIso() })}>Enviar a Autorización</Button></ActionCell>; } }]} rows={displayedRows} />
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
  const { confirm, prompt } = usePrompt();
  function toggle(id) { setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]); }
  function authorizeRow(r) { updateRecord("payables", r.id, { status: "Autorizado", authorizedBy: currentFinanceUser().email || "rodrigo@tritondesarrollos.com", authorizedAt: todayIso() }); }
  async function authorizeBatch() {
    if (!canAuthorize) { alert("Solo el usuario master puede autorizar pagos."); return; }
    if (!selectedRows.length) { alert("Selecciona al menos una solicitud."); return; }
    const ok = await confirm({ title: "Autorizar lote", message: `¿Autorizar ${selectedRows.length} solicitud(es) seleccionada(s)?`, confirmLabel: "Autorizar" });
    if (!ok) return;
    selectedRows.forEach(authorizeRow);
    setSelectedIds([]);
  }
  async function requestCorrection(row) {
    const comment = await prompt({ title: "Solicitar corrección", label: "¿Qué se debe corregir?", multiline: true });
    if (comment === null) return;
    updateRecord("payables", row.id, { status: "Observado", directorComment: comment || "Corrección solicitada" });
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Autorización final" helper="La autorización final solo la ve/ejecuta el master. Administración puede dejar el expediente listo, pero no puede autorizar." />
      <ProgressLine items={[{ label: "Capturado", done: true }, { label: "Admin revisó", done: true }, { label: "Autorización master", active: true }, { label: "Pago" }, { label: "Conciliado" }]} />
      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <StatusFilter value={statusFilter} onChange={(v) => { setStatusFilter(v); setSelectedIds([]); }} options={baseRows.map((r) => r.status)} total={baseRows.length} shown={rows.length} />
        {canAuthorize ? <Button help="Autoriza de un solo clic todas las solicitudes marcadas con la casilla, previa confirmación." onClick={authorizeBatch} disabled={!selectedRows.length}>Autorizar lote ({selectedRows.length})</Button> : <Pill tone="warn" help="Solo la cuenta master ve habilitado el botón de autorizar; administración solo deja el expediente listo.">Solo master puede autorizar</Pill>}
        <Button variant="secondary" help="Marca automáticamente todas las solicitudes que ya están en estatus 'Listo para autorización'." onClick={() => setSelectedIds(rows.filter((r) => r.status === "Listo para autorización").map((r) => r.id))}>Seleccionar autorizables</Button>
        <Button variant="secondary" help="Quita todas las casillas seleccionadas." onClick={() => setSelectedIds([])}>Limpiar</Button>
        <div style={{ color: c.muted, fontSize: 13, fontWeight: 850, paddingBottom: 10 }}>Total seleccionado: {money(selectedRows.reduce((a, r) => a + payableTotal(r), 0))}</div>
      </div>
    </Card>
    <Card><MiniTable columns={[
      { key: "select", label: "Sel.", sortable: false, render: (r) => <input type="checkbox" disabled={!canAuthorize || r.status !== "Listo para autorización"} checked={selectedIds.includes(r.id)} onChange={() => toggle(r.id)} /> },
      { key: "folio", label: "Folio", render: (r) => <span style={{ fontFamily: "monospace", fontSize: 12, color: c.muted }}>{r.folio || "—"}</span> },
      { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name },
      { key: "supplier", label: "Proveedor", sortValue: (r) => supplierDisplayName(r, data), render: (r) => { const s = data.suppliers.find((x) => x.id === r.supplierId); return <EntityLink onClick={() => setSelectedSupplier(s)}>{supplierDisplayName(r, data)}</EntityLink>; } },
      { key: "concept", label: "Concepto", render: (r) => <EntityLink onClick={() => setSelectedPayment(r)}>{r.concept}</EntityLink> },
      { key: "categoryId", label: "Partida", render: (r) => categoryMap[r.categoryId]?.name },
      { key: "amount", label: "Total", sortValue: (r) => payableTotal(r), render: (r) => money(payableTotal(r)) },
      { key: "summary", label: "Resumen", sortable: false, render: (r) => { const b = budgetCheck(data, r); const ctc = contractCheck(data, r); return <div style={{ minWidth: 230, display: "grid", gap: 4 }}><span>Presupuesto: {b.hasBudget ? money(b.budget) : "Sin presupuesto"}</span><span>Disponible antes: {money(b.available)}</span>{b.over ? <span style={{ color: c.red, fontWeight: 900 }}>Sobregiro: {money(b.overspend)}</span> : <span style={{ color: "#166534", fontWeight: 900 }}>Sin sobregiro</span>}{ctc.contract ? <span>Contrato: {money(ctc.contract.amount)} · saldo {money(ctc.remaining)}</span> : <span>Sin contrato ligado</span>}</div>; } },
      { key: "docs", label: "Anexos", sortable: false, render: (r) => <AttachmentViewer value={r.attachments} /> },
      { key: "admin", label: "Admin", sortable: false, render: (r) => <div style={{ minWidth: 190 }}>{r.adminReviewed ? <Pill tone="ok" help="Administración ya validó presupuesto y documentos.">Revisado</Pill> : <Pill tone="warn" help="Administración todavía no ha revisado esta solicitud.">Sin revisión</Pill>}<div style={{ color: c.muted, fontSize: 12, marginTop: 5 }}>{r.adminComment || r.overspendReason || "Sin comentario"}</div></div> },
      { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> },
      { key: "view", label: "Revisar", sortable: false, render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help="Abre el expediente completo de esta solicitud." onClick={() => setSelectedPayment(r)}>Expediente</Button></ActionCell> },
      { key: "approve", label: "Autorizar", sortable: false, render: (r) => canAuthorize && r.status === "Listo para autorización" ? <ActionCell><Button style={{ padding: "7px 9px", fontSize: 12 }} help="Autoriza este pago para que pase a Programación." onClick={() => authorizeRow(r)}>Autorizar</Button></ActionCell> : <Pill tone="idle">—</Pill> },
      { key: "correction", label: "Corrección", sortable: false, render: (r) => canAuthorize ? <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help="Regresa la solicitud a Observado con un comentario de qué corregir." onClick={() => requestCorrection(r)}>Solicitar</Button></ActionCell> : <Pill tone="idle">—</Pill> },
      { key: "reject", label: "Rechazar", sortable: false, render: (r) => canAuthorize ? <ActionCell><Button variant="danger" style={{ padding: "7px 9px", fontSize: 12 }} help="Rechaza definitivamente la solicitud. Puede eliminarse después desde Solicitudes de pago." onClick={() => updateRecord("payables", r.id, { status: "Rechazado", rejectedAt: todayIso() })}>Rechazar</Button></ActionCell> : <Pill tone="idle">—</Pill> },
    ]} rows={rows} empty="No hay solicitudes para este filtro." /></Card>
    <PaymentContextModal row={selectedPayment} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedPayment(null)} onAuthorize={canAuthorize ? (r) => { authorizeRow(r); setSelectedPayment(null); } : undefined} onCorrection={canAuthorize ? (r) => requestCorrection(r) : undefined} onReject={canAuthorize ? (r) => { updateRecord("payables", r.id, { status: "Rechazado", rejectedAt: todayIso() }); setSelectedPayment(null); } : undefined} />
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
  const { prompt } = usePrompt();
  function toggle(id) { setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]); }
  function scheduleSelected() {
    if (!selectedRows.length) { alert("Selecciona al menos un pago para programar."); return; }
    selectedRows.forEach((r) => updateRecord("payables", r.id, { status: "Programado", scheduledDate: batchDate, scheduledBatchAt: todayIso() }));
    setSelectedIds([]);
  }
  async function pay(row) {
    const bank = await prompt({ title: "Registrar pago", label: "Banco / cuenta de salida", defaultValue: row.paymentBank || "Banco por definir" });
    if (bank === null) return;
    const reference = await prompt({ title: "Registrar pago", label: "Referencia bancaria / SPEI", defaultValue: `SPEI-${Date.now()}` });
    if (reference === null) return;
    updateRecord("payables", row.id, { status: "Pagado", paidAt: todayIso(), paymentBank: bank || "Banco por definir", paymentReference: reference || `SPEI-${Date.now()}` });
    addRecord("payments", { payableId: row.id, projectId: row.projectId, amount: payableTotal(row), bank: bank || "Banco por definir", date: todayIso(), reference: reference || `SPEI-${Date.now()}`, reconciled: false, proof: "Comprobante pendiente de adjuntar" });
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Programación de pagos" helper="Selecciona uno o varios pagos autorizados y programa un lote con fecha única, sin ventanas emergentes." />
      <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <Field label="Fecha de programación del lote" help="Fecha que se asignará a todos los pagos seleccionados al programarlos juntos."><input type="date" style={inputStyle({ width: 220 })} value={batchDate} onChange={(e) => setBatchDate(e.target.value)} /></Field>
        <Button help="Cambia el estatus de los pagos seleccionados a 'Programado' con la fecha de arriba." onClick={scheduleSelected} disabled={!selectedRows.length}>Programar lote ({selectedRows.length})</Button>
        <Button variant="secondary" help="Marca todos los pagos visibles en la tabla." onClick={() => setSelectedIds(rows.map((r) => r.id))}>Seleccionar todos</Button>
        <Button variant="secondary" help="Quita todas las casillas seleccionadas." onClick={() => setSelectedIds([])}>Limpiar</Button>
        <div style={{ color: c.muted, fontSize: 13, fontWeight: 800 }}>Total seleccionado: {money(selectedRows.reduce((a, r) => a + payableTotal(r), 0))}</div>
      </div>
    </Card>
    <Card><SectionTitle title="Pagos autorizados / programados" helper="Cada pago conserva su expediente, anexos, presupuesto, proveedor, contrato e histórico." />
      <StatusFilter value={statusFilter} onChange={(v) => { setStatusFilter(v); setSelectedIds([]); }} options={baseRows.map((r) => r.status)} total={baseRows.length} shown={rows.length} />
      <MiniTable columns={[{ key: "select", label: "", render: (r) => <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggle(r.id)} /> }, { key: "folio", label: "Folio", render: (r) => <span style={{ fontFamily: "monospace", fontSize: 12, color: c.muted }}>{r.folio || "—"}</span> }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "supplier", label: "Proveedor", render: (r) => { const s = data.suppliers.find((x) => x.id === r.supplierId); return <EntityLink onClick={() => setSelectedSupplier(s)}>{supplierDisplayName(r, data)}</EntityLink>; } }, { key: "concept", label: "Concepto", render: (r) => <EntityLink onClick={() => setSelectedPayment(r)}>{r.concept}</EntityLink> }, { key: "requiredDate", label: "Fecha requerida" }, { key: "scheduledDate", label: "Fecha programada", render: (r) => r.scheduledDate || "Sin programar" }, { key: "amount", label: "Total", render: (r) => money(payableTotal(r)) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help="Abre el expediente completo de este pago." onClick={() => setSelectedPayment(r)}>Revisar</Button><Button style={{ padding: "7px 9px", fontSize: 12 }} help="Programa solo este pago con la fecha de lote de arriba, sin afectar los demás." onClick={() => updateRecord("payables", r.id, { status: "Programado", scheduledDate: batchDate })}>Programar uno</Button><Button variant="success" style={{ padding: "7px 9px", fontSize: 12 }} help="Captura banco y referencia, marca el pago como Pagado y lo deja listo para conciliación bancaria." onClick={() => pay(r)}>Registrar pago</Button></div> }]} rows={rows} />
    </Card>
    <PaymentContextModal row={selectedPayment} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedPayment(null)} />
    <SupplierContextModal supplier={selectedSupplier} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedSupplier(null)} />
  </div>;
}

function PaidPayments({ data, projectMap, categoryMap }) {
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [statusFilter, setStatusFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const statusFilteredRows = filterByStatus(data.payments.map((p) => ({ ...p, status: p.reconciled ? "Conciliado" : "Pendiente" })), statusFilter);
  const rows = filterBySearch(statusFilteredRows, search, (r) => `${data.payables.find((p) => p.id === r.payableId)?.concept || ""} ${r.bank} ${r.reference}`);
  return <div style={{ display: "grid", gap: 16 }}><Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Pagos realizados" helper="Comprobantes de transferencia, referencia bancaria y relación con solicitud. Da clic en la solicitud para ver expediente completo." /><ExportCsvButton filename="pagos-realizados.csv" rows={rows.map((r) => ({ Fecha: r.date, Proyecto: projectMap[r.projectId]?.name || "", Solicitud: data.payables.find((p) => p.id === r.payableId)?.concept || r.payableId, Monto: r.amount, Banco: r.bank, Referencia: r.reference, Conciliado: r.reconciled ? "Sí" : "Pendiente" }))} /></div><StatusFilter value={statusFilter} onChange={setStatusFilter} options={["Conciliado", "Pendiente"]} total={data.payments.length} shown={rows.length} /><div style={{ marginTop: -6, marginBottom: 12 }}><input style={inputStyle({ maxWidth: 340 })} placeholder="Buscar por solicitud, banco o referencia…" value={search} onChange={(e) => setSearch(e.target.value)} /></div><MiniTable columns={[{ key: "date", label: "Fecha" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "payableId", label: "Solicitud", render: (r) => { const payable = data.payables.find((p) => p.id === r.payableId); return payable ? <EntityLink onClick={() => setSelectedPayment(payable)}>{payable.concept}</EntityLink> : r.payableId; } }, { key: "amount", label: "Monto", render: (r) => money(r.amount) }, { key: "bank", label: "Banco" }, { key: "reference", label: "Referencia" }, { key: "reconciled", label: "Conciliado", render: (r) => <Pill tone={r.reconciled ? "ok" : "warn"}>{r.reconciled ? "Sí" : "Pendiente"}</Pill> }]} rows={rows} /></Card><PaymentContextModal row={selectedPayment} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedPayment(null)} /></div>;
}

function ClientSalesDrawer({ client, data, projectMap, onClose }) {
  if (!client) return null;
  const incomes = (data.incomes || []).filter((r) => r.clientId === client.id || r.contractRef === client.contractRef || (client.unit && r.unit === client.unit));
  const total = incomes.reduce((a, r) => a + Number(r.amount || 0), 0);
  const reconciled = incomes.filter((r) => r.reconciled || r.status === "Conciliado").reduce((a, r) => a + Number(r.bankAmount ?? r.amount ?? 0), 0);
  const pending = incomes.filter((r) => !(r.reconciled || r.status === "Conciliado"));
  return <div style={{ position: "fixed", inset: 0, zIndex: 2147483641, pointerEvents: "none" }}>
    <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.14)", backdropFilter: "blur(2px)", pointerEvents: "auto" }} onClick={onClose} />
    <aside style={{ position: "absolute", right: 18, top: 18, bottom: 18, width: "min(760px, calc(100vw - 36px))", background: "rgba(255,255,255,0.99)", border: `1px solid ${c.border}`, borderRadius: 28, boxShadow: "0 24px 80px rgba(0,0,0,.18)", overflow: "hidden", pointerEvents: "auto", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <header style={{ padding: 20, borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div><Pill tone="primary">Cliente / comprador</Pill><h2 style={{ margin: "10px 0 4px", fontSize: 23, letterSpacing: -.4 }}>{client.name}</h2><div style={{ color: c.muted, fontSize: 13 }}>{projectMap[client.projectId]?.name || client.projectId || "Sin proyecto"} · {client.unit || "Sin unidad"} · {client.contractRef || "Sin contrato"}</div></div>
        <button onClick={onClose} style={{ border: 0, background: c.soft, borderRadius: 14, width: 40, height: 40, cursor: "pointer", fontWeight: 950 }}>×</button>
      </header>
      <main style={{ padding: 20, overflow: "auto", display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone="primary">Total registrado</Pill><b style={{ display: "block", marginTop: 8 }}>{money(total)}</b><small style={{ color: c.muted }}>{incomes.length} movimiento(s)</small></Card>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone="ok">Conciliado</Pill><b style={{ display: "block", marginTop: 8 }}>{money(reconciled)}</b><small style={{ color: c.muted }}>Base contra banco</small></Card>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone={pending.length ? "warn" : "ok"}>Pendiente</Pill><b style={{ display: "block", marginTop: 8 }}>{pending.length}</b><small style={{ color: c.muted }}>Por revisar/conciliar</small></Card>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone="idle">Contacto</Pill><b style={{ display: "block", marginTop: 8 }}>{client.email || "Sin correo"}</b><small style={{ color: c.muted }}>{client.phone || "Sin teléfono"}</small></Card>
        </div>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Estado de cuenta del cliente" helper="Pagos, referencias, unidades y estatus de conciliación." />
          <MiniTable columns={[{ key: "date", label: "Fecha" }, { key: "type", label: "Tipo" }, { key: "concept", label: "Concepto" }, { key: "unit", label: "Unidad" }, { key: "amount", label: "Monto", render: (r) => money(r.amount) }, { key: "reference", label: "Referencia" }, { key: "bankDate", label: "Fecha banco" }, { key: "status", label: "Estado", render: (r) => <Pill tone={r.reconciled || r.status === "Conciliado" ? "ok" : "warn"}>{r.reconciled || r.status === "Conciliado" ? "Conciliado" : (r.status || "Pendiente")}</Pill> }]} rows={incomes} />
        </Card>
      </main>
      <footer style={{ padding: 16, borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "flex-end" }}><Button variant="secondary" onClick={onClose}>Cerrar</Button></footer>
    </aside>
  </div>;
}

function UnitSalesDrawer({ unit, data, projectMap, clientMap, onClose }) {
  if (!unit) return null;
  const incomes = (data.incomes || []).filter((r) => String(r.unit || "").toLowerCase() === String(unit || "").toLowerCase());
  const clients = (data.clients || []).filter((c) => String(c.unit || "").toLowerCase() === String(unit || "").toLowerCase() || incomes.some((r) => r.clientId === c.id));
  const projectId = incomes[0]?.projectId || clients[0]?.projectId || "";
  const total = incomes.reduce((a, r) => a + Number(r.amount || 0), 0);
  const reconciled = incomes.filter((r) => r.reconciled || r.status === "Conciliado").reduce((a, r) => a + Number(r.bankAmount ?? r.amount ?? 0), 0);
  return <div style={{ position: "fixed", inset: 0, zIndex: 2147483641, pointerEvents: "none" }}>
    <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.14)", backdropFilter: "blur(2px)", pointerEvents: "auto" }} onClick={onClose} />
    <aside style={{ position: "absolute", right: 18, top: 18, bottom: 18, width: "min(760px, calc(100vw - 36px))", background: "rgba(255,255,255,0.99)", border: `1px solid ${c.border}`, borderRadius: 28, boxShadow: "0 24px 80px rgba(0,0,0,.18)", overflow: "hidden", pointerEvents: "auto", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <header style={{ padding: 20, borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div><Pill tone="primary">Unidad</Pill><h2 style={{ margin: "10px 0 4px", fontSize: 23, letterSpacing: -.4 }}>{unit}</h2><div style={{ color: c.muted, fontSize: 13 }}>{projectMap[projectId]?.name || projectId || "Sin proyecto"} · {clients.length} cliente(s) ligado(s)</div></div>
        <button onClick={onClose} style={{ border: 0, background: c.soft, borderRadius: 14, width: 40, height: 40, cursor: "pointer", fontWeight: 950 }}>×</button>
      </header>
      <main style={{ padding: 20, overflow: "auto", display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone="primary">Total registrado</Pill><b style={{ display: "block", marginTop: 8 }}>{money(total)}</b><small style={{ color: c.muted }}>{incomes.length} movimiento(s)</small></Card>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone="ok">Conciliado</Pill><b style={{ display: "block", marginTop: 8 }}>{money(reconciled)}</b><small style={{ color: c.muted }}>Ingresos validados contra banco</small></Card>
          <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone="idle">Contrato</Pill><b style={{ display: "block", marginTop: 8 }}>{incomes[0]?.contractRef || clients[0]?.contractRef || "Sin contrato"}</b><small style={{ color: c.muted }}>Referencia comercial</small></Card>
        </div>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Clientes ligados" helper="Compradores o pagadores vinculados a esta unidad." />
          <MiniTable columns={[{ key: "name", label: "Cliente" }, { key: "type", label: "Tipo" }, { key: "contractRef", label: "Contrato" }, { key: "email", label: "Correo" }, { key: "phone", label: "Teléfono" }, { key: "status", label: "Estado", render: (r) => <Pill tone="primary">{r.status}</Pill> }]} rows={clients} />
        </Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Pagos de la unidad" helper="Movimientos de ingreso relacionados a la unidad seleccionada." />
          <MiniTable columns={[{ key: "date", label: "Fecha" }, { key: "clientId", label: "Cliente", render: (r) => clientMap[r.clientId]?.name || r.clientId || "—" }, { key: "type", label: "Tipo" }, { key: "concept", label: "Concepto" }, { key: "amount", label: "Monto", render: (r) => money(r.amount) }, { key: "reference", label: "Referencia" }, { key: "status", label: "Estado", render: (r) => <Pill tone={r.reconciled || r.status === "Conciliado" ? "ok" : "warn"}>{r.reconciled || r.status === "Conciliado" ? "Conciliado" : (r.status || "Pendiente")}</Pill> }]} rows={incomes} />
        </Card>
      </main>
      <footer style={{ padding: 16, borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "flex-end" }}><Button variant="secondary" onClick={onClose}>Cerrar</Button></footer>
    </aside>
  </div>;
}

function BankReconciliation({ data, projectMap, categoryMap, updateRecord }) {
  const [mode, setMode] = useState("egresos");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [selected, setSelected] = useState([]);
  const [batchReference, setBatchReference] = useState("");
  const [batchBankDate, setBatchBankDate] = useState(todayIso());
  const [batchBank, setBatchBank] = useState("");
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const clientMap = useMemo(() => Object.fromEntries((data.clients || []).map((c) => [c.id, c])), [data.clients]);
  const payableMap = useMemo(() => Object.fromEntries((data.payables || []).map((p) => [p.id, p])), [data.payables]);
  const supplierMap = useMemo(() => Object.fromEntries((data.suppliers || []).map((s) => [s.id, s])), [data.suppliers]);

  const requestUser = (payable) => payable?.requestedByName || payable?.requestedByEmail || payable?.requestedBy || payable?.createdBy || "No capturado";
  const expenseRows = (data.payments || []).map((p) => {
    const payable = payableMap[p.payableId] || {};
    const supplier = supplierMap[payable.supplierId] || {};
    return {
      ...p,
      payable,
      supplier,
      supplierId: payable.supplierId || p.supplierId,
      supplierName: supplier.tradeName || payable.supplier || p.supplier || "Proveedor",
      requestedByText: requestUser(payable),
      movementType: "Egreso",
      status: p.reconciled ? "Conciliado" : "Pendiente",
      bankDate: p.bankDate || p.date || todayIso(),
      bankAmount: p.bankAmount ?? p.amount,
    };
  });
  const incomeRows = (data.incomes || []).map((r) => ({
    ...r,
    movementType: "Ingreso venta",
    status: (r.reconciled || r.status === "Conciliado") ? "Conciliado" : "Pendiente",
    bankDate: r.bankDate || r.date || todayIso(),
    bankAmount: r.bankAmount ?? r.amount,
  }));
  const baseRows = mode === "egresos" ? expenseRows : incomeRows;
  const rows = filterByStatus(baseRows, statusFilter);
  const selectedInMode = selected.filter((id) => baseRows.some((r) => r.id === id));
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const toggleOne = (id) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const toggleVisible = () => setSelected((prev) => allVisibleSelected ? prev.filter((id) => !rows.some((r) => r.id === id)) : Array.from(new Set([...prev, ...rows.map((r) => r.id)])));

  function reconcileRow(row) {
    if (mode === "egresos") {
      updateRecord("payments", row.id, {
        reference: row.reference || "",
        bankDate: row.bankDate || todayIso(),
        bank: row.bank || "",
        bankAmount: Number(row.bankAmount ?? row.amount ?? 0),
        difference: Number(row.bankAmount ?? row.amount ?? 0) - Number(row.amount || 0),
        reconciled: true,
        reconciledAt: todayIso(),
      });
      return;
    }
    updateRecord("incomes", row.id, {
      reference: row.reference || row.bankReference || "",
      bankDate: row.bankDate || todayIso(),
      bank: row.bank || "",
      bankAmount: Number(row.bankAmount ?? row.amount ?? 0),
      difference: Number(row.bankAmount ?? row.amount ?? 0) - Number(row.amount || 0),
      reconciled: true,
      reconciledAt: todayIso(),
      status: "Conciliado",
    });
  }

  function applyBatchReconciliation() {
    if (!selectedInMode.length) { alert("Selecciona al menos un movimiento visible para conciliar."); return; }
    if (!batchReference.trim()) { alert("Captura la referencia bancaria antes de conciliar el lote."); return; }
    if (!batchBankDate) { alert("Captura la fecha banco antes de conciliar el lote."); return; }
    selectedInMode.forEach((id) => {
      const row = baseRows.find((r) => r.id === id);
      if (!row) return;
      const patch = {
        reference: batchReference.trim(),
        bankDate: batchBankDate,
        bank: batchBank || row.bank || "",
        bankAmount: Number(row.bankAmount ?? row.amount ?? 0),
        difference: Number(row.bankAmount ?? row.amount ?? 0) - Number(row.amount || 0),
        reconciled: true,
        reconciledAt: todayIso(),
      };
      if (mode === "egresos") updateRecord("payments", id, patch);
      else updateRecord("incomes", id, { ...patch, status: "Conciliado" });
    });
    setSelected((prev) => prev.filter((id) => !selectedInMode.includes(id)));
    setBatchReference("");
  }

  const expenseColumns = [
    { key: "select", label: "", sortable: false, render: (r) => <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleOne(r.id)} /> },
    { key: "date", label: "Fecha sistema" },
    { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name || "—" },
    { key: "supplierName", label: "Proveedor", render: (r) => r.supplierId ? <EntityLink onClick={() => setSelectedSupplier(supplierMap[r.supplierId])}>{r.supplierName}</EntityLink> : r.supplierName },
    { key: "payableId", label: "Pago / solicitud", render: (r) => r.payable?.id ? <EntityLink onClick={() => setSelectedPayment(r.payable)}>{r.payable.concept}</EntityLink> : r.payableId || "—" },
    { key: "requestedByText", label: "Solicitó", render: (r) => <div><b>{r.requestedByText}</b><div style={{ color: c.muted, fontSize: 11 }}>registro obligatorio del expediente</div></div> },
    { key: "amount", label: "Monto sistema", render: (r) => money(r.amount) },
    { key: "bankAmount", label: "Monto banco", render: (r) => <input type="number" style={inputStyle({ minWidth: 130, padding: "8px 9px" })} defaultValue={r.bankAmount ?? r.amount} title="Monto que realmente aparece en el estado de cuenta. Si difiere del monto sistema, queda registrada la diferencia." onBlur={(e) => updateRecord("payments", r.id, { bankAmount: Number(e.target.value || 0), difference: Number(e.target.value || 0) - Number(r.amount || 0) })} /> },
    { key: "bank", label: "Banco", render: (r) => <input style={inputStyle({ minWidth: 140, padding: "8px 9px" })} defaultValue={r.bank || ""} onBlur={(e) => updateRecord("payments", r.id, { bank: e.target.value })} /> },
    { key: "reference", label: "Referencia escrita", render: (r) => <input style={inputStyle({ minWidth: 180, padding: "8px 9px" })} placeholder="SPEI / folio banco" defaultValue={r.reference || ""} onBlur={(e) => updateRecord("payments", r.id, { reference: e.target.value })} /> },
    { key: "bankDate", label: "Fecha banco", render: (r) => <input type="date" style={inputStyle({ minWidth: 140, padding: "8px 9px" })} defaultValue={r.bankDate || todayIso()} onBlur={(e) => updateRecord("payments", r.id, { bankDate: e.target.value })} /> },
    { key: "reconciled", label: "Estado", render: (r) => <Pill tone={r.reconciled ? "ok" : "warn"}>{r.reconciled ? "Conciliado" : "Pendiente"}</Pill> },
    { key: "actions", label: "Acciones", sortable: false, render: (r) => <ActionCell><Button style={{ padding: "7px 9px", fontSize: 12 }} disabled={r.reconciled} help="Marca este movimiento como conciliado con los datos de banco capturados en su fila." onClick={() => reconcileRow(r)}>Conciliar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help="Regresa el movimiento a Pendiente por si se concilió equivocadamente." onClick={() => updateRecord("payments", r.id, { reconciled: false, reconciledAt: "", status: "Pendiente", difference: Number(r.difference || 0) })}>Reabrir</Button></ActionCell> },
  ];
  const incomeColumns = [
    { key: "select", label: "", sortable: false, render: (r) => <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleOne(r.id)} /> },
    { key: "date", label: "Fecha sistema" },
    { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name || "—" },
    { key: "clientId", label: "Cliente", render: (r) => clientMap[r.clientId] ? <EntityLink onClick={() => setSelectedClient(clientMap[r.clientId])}>{clientMap[r.clientId].name}</EntityLink> : "—" },
    { key: "concept", label: "Ingreso / venta" },
    { key: "unit", label: "Unidad", render: (r) => r.unit ? <EntityLink onClick={() => setSelectedUnit(r.unit)}>{r.unit}</EntityLink> : "—" },
    { key: "amount", label: "Monto sistema", render: (r) => money(r.amount) },
    { key: "bankAmount", label: "Monto banco", render: (r) => <input type="number" style={inputStyle({ minWidth: 130, padding: "8px 9px" })} defaultValue={r.bankAmount ?? r.amount} title="Monto que realmente depositó el cliente según el estado de cuenta." onBlur={(e) => updateRecord("incomes", r.id, { bankAmount: Number(e.target.value || 0), difference: Number(e.target.value || 0) - Number(r.amount || 0) })} /> },
    { key: "bank", label: "Banco", render: (r) => <input style={inputStyle({ minWidth: 140, padding: "8px 9px" })} defaultValue={r.bank || ""} onBlur={(e) => updateRecord("incomes", r.id, { bank: e.target.value })} /> },
    { key: "reference", label: "Referencia escrita", render: (r) => <input style={inputStyle({ minWidth: 180, padding: "8px 9px" })} placeholder="SPEI / folio banco" defaultValue={r.reference || ""} onBlur={(e) => updateRecord("incomes", r.id, { reference: e.target.value })} /> },
    { key: "bankDate", label: "Fecha banco", render: (r) => <input type="date" style={inputStyle({ minWidth: 140, padding: "8px 9px" })} defaultValue={r.bankDate || todayIso()} onBlur={(e) => updateRecord("incomes", r.id, { bankDate: e.target.value })} /> },
    { key: "status", label: "Estado", render: (r) => <Pill tone={r.reconciled || r.status === "Conciliado" ? "ok" : "warn"}>{r.reconciled || r.status === "Conciliado" ? "Conciliado" : "Pendiente"}</Pill> },
    { key: "actions", label: "Acciones", sortable: false, render: (r) => <ActionCell><Button style={{ padding: "7px 9px", fontSize: 12 }} disabled={r.reconciled || r.status === "Conciliado"} help="Marca este ingreso como conciliado contra banco." onClick={() => reconcileRow(r)}>Conciliar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help="Regresa el ingreso a pendiente de conciliación." onClick={() => updateRecord("incomes", r.id, { reconciled: false, reconciledAt: "", status: "Pendiente conciliación" })}>Reabrir</Button></ActionCell> },
  ];

  return <div style={{ display: "grid", gap: 16 }}>
    <Card>
      <SectionTitle title="Conciliación bancaria" helper="Conciliación de desarrollos inmobiliarios de venta. Arrendamientos se concilia en su propio módulo para no mezclar rentas con ingresos de venta." />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" onClick={() => { setMode("egresos"); setSelected([]); }} style={{ border: `1px solid ${mode === "egresos" ? c.primary : c.border}`, background: mode === "egresos" ? c.primarySoft : "white", color: c.text, borderRadius: 999, padding: "9px 13px", fontWeight: 950, cursor: "pointer" }}>Egresos / pagos</button>
        <button type="button" onClick={() => { setMode("ingresos"); setSelected([]); }} style={{ border: `1px solid ${mode === "ingresos" ? c.primary : c.border}`, background: mode === "ingresos" ? c.primarySoft : "white", color: c.text, borderRadius: 999, padding: "9px 13px", fontWeight: 950, cursor: "pointer" }}>Ingresos / ventas</button>
        <StatusFilter value={statusFilter} onChange={setStatusFilter} options={["Conciliado", "Pendiente"]} total={baseRows.length} shown={rows.length} />
      </div>
    </Card>
    <Card>
      <SectionTitle title="Conciliación por lote" helper="Llena la referencia y fecha banco aquí mismo, selecciona varios movimientos y márcalos como conciliados sin abrir ventanas." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, alignItems: "end" }}>
        <Field label="Referencia bancaria para seleccionados" help="Se aplica igual a todos los movimientos marcados. Úsalo cuando varios pagos salieron en el mismo lote/SPEI."><input style={inputStyle()} value={batchReference} onChange={(e) => setBatchReference(e.target.value)} placeholder="Folio SPEI / referencia banco" /></Field>
        <Field label="Fecha banco"><input type="date" style={inputStyle()} value={batchBankDate} onChange={(e) => setBatchBankDate(e.target.value)} /></Field>
        <Field label="Banco"><input style={inputStyle()} value={batchBank} onChange={(e) => setBatchBank(e.target.value)} placeholder="Banco del movimiento" /></Field>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><Button variant="secondary" help="Marca o desmarca todos los movimientos que se ven en la tabla de abajo con el filtro actual." onClick={toggleVisible}>{allVisibleSelected ? "Quitar visibles" : "Seleccionar visibles"}</Button><Button help="Aplica la referencia/fecha/banco de arriba a todos los movimientos marcados y los pasa a Conciliado." onClick={applyBatchReconciliation} disabled={!selectedInMode.length}>Conciliar lote ({selectedInMode.length})</Button></div>
      </div>
    </Card>
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <SectionTitle title={mode === "egresos" ? "Egresos a conciliar" : "Ingresos de ventas a conciliar"} helper={mode === "egresos" ? "Pagos realizados por tesorería. Ahora muestran proveedor, solicitud y quién solicitó el pago." : "Ingresos de desarrollos inmobiliarios de venta. Da clic en cliente o unidad para consultar pagos y estado de cuenta."} />
        <ExportCsvButton filename={mode === "egresos" ? "conciliacion-egresos.csv" : "conciliacion-ingresos.csv"} rows={mode === "egresos"
          ? rows.map((r) => ({ Fecha: r.date, Proyecto: projectMap[r.projectId]?.name || "", Proveedor: r.supplierName, Solicitud: r.payable?.concept || "", MontoSistema: r.amount, MontoBanco: r.bankAmount, Banco: r.bank, Referencia: r.reference, Estado: r.status }))
          : rows.map((r) => ({ Fecha: r.date, Proyecto: projectMap[r.projectId]?.name || "", Cliente: clientMap[r.clientId]?.name || "", Concepto: r.concept, MontoSistema: r.amount, MontoBanco: r.bankAmount, Banco: r.bank, Referencia: r.reference, Estado: r.status }))}
        />
      </div>
      <MiniTable columns={mode === "egresos" ? expenseColumns : incomeColumns} rows={rows} />
    </Card>
    <PaymentContextModal row={selectedPayment} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedPayment(null)} />
    <SupplierContextModal supplier={selectedSupplier} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedSupplier(null)} />
    <ClientSalesDrawer client={selectedClient} data={data} projectMap={projectMap} onClose={() => setSelectedClient(null)} />
    <UnitSalesDrawer unit={selectedUnit} data={data} projectMap={projectMap} clientMap={clientMap} onClose={() => setSelectedUnit(null)} />
  </div>;
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
  const { prompt } = usePrompt();
  async function observeExpense(row) {
    const comment = await prompt({ title: "Observar gasto", label: "Observación", defaultValue: row.reviewComment || "", multiline: true });
    if (comment === null) return;
    updateRecord("pettyExpenses", row.id, { status: "Observado", reviewComment: comment || "Observado" });
  }
  function createCash() {
    if (!String(form.responsible || "").trim()) { alert("Captura el responsable de la caja chica."); return; }
    if (!(Number(form.amount || 0) > 0)) { alert("Captura el monto asignado a la caja."); return; }
    if (openByResponsible(form.responsible)) { alert("Este responsable tiene una caja chica abierta o en revisión. Primero debe liquidarse o cerrarse."); return; }
    addRecord("pettyCash", { folio: nextFolio(data, "pettyCash", "CC"), projectId: form.projectId || "arenna", name: form.name || "Caja chica", responsible: form.responsible || "Responsable", amount: Number(form.amount || 0), status: "Abierta", openedAt: todayIso(), originAccount: form.originAccount || "Banco por definir", notes: form.notes || "" });
  }
  function addExpense() {
    const cash = data.pettyCash.find((cc) => cc.id === (form.cashId || data.pettyCash[0]?.id));
    if (!cash) { alert("Primero crea una caja chica."); return; }
    if (!String(form.concept || "").trim()) { alert("Captura el concepto del gasto."); return; }
    if (!(Number(form.amount || 0) > 0) && !(Number(form.totalInput || 0) > 0)) { alert("Captura un monto mayor a cero."); return; }
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
      {showForm === "cash" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Responsable" help="Persona que resguarda el efectivo. No se puede abrir otra caja a nombre del mismo responsable hasta liquidar/cerrar esta."><input style={inputStyle()} value={form.responsible || ""} onChange={(e) => setForm({ ...form, responsible: e.target.value })} /></Field><Field label="Monto asignado" help="Efectivo total que se entrega al responsable. El saldo se calcula restando los gastos comprobados."><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Cuenta / origen" help="De qué cuenta bancaria salió el efectivo, para referencia de conciliación."><input style={inputStyle()} value={form.originAccount || ""} onChange={(e) => setForm({ ...form, originAccount: e.target.value })} /></Field></div><Field label="Nombre / motivo"><input style={inputStyle()} value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Button onClick={createCash}>Guardar caja chica</Button></div> : null}
    </Card>
    <Card><div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -4 }}><ExportCsvButton filename="cajas-chicas.csv" rows={cashRows.map((r) => ({ Folio: r.folio || r.id, Caja: r.name, Proyecto: projectMap[r.projectId]?.name || "", Responsable: r.responsible, Asignado: r.amount, Comprobado: r.spent, Saldo: r.balance, Estado: r.status }))} /></div><StatusFilter value={cashStatusFilter} onChange={setCashStatusFilter} options={baseCashRows.map((r) => r.status)} total={baseCashRows.length} shown={cashRows.length} /><MiniTable columns={[{ key: "folio", label: "Folio", render: (r) => <span style={{ fontFamily: "monospace", fontSize: 12, color: c.muted }}>{r.folio || "—"}</span> }, { key: "name", label: "Caja" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "responsible", label: "Responsable" }, { key: "amount", label: "Asignado", render: (r) => money(r.amount) }, { key: "spent", label: "Comprobado", render: (r) => money(r.spent) }, { key: "balance", label: "Saldo", render: (r) => <Pill tone={r.balance >= 0 ? "ok" : "danger"} help="Asignado menos gastos comprobados. Es lo que el responsable debe tener en efectivo o justificar.">{money(r.balance)}</Pill> }, { key: "pending", label: "Pendientes", render: (r) => <Pill tone={r.pending || r.observed ? "warn" : "ok"} help="Gastos que aún no se aceptan (pendientes) y gastos observados/rechazados. Deben quedar en 0 para poder cerrar la caja.">{r.pending} / obs {r.observed}</Pill> }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button style={{ padding: "7px 9px", fontSize: 12 }} help="Genera una solicitud de pago para reponer el efectivo gastado de esta caja." onClick={() => setReplenishCash(r)}>Reponer caja</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help="Marca la caja como lista para que administración revise antes de cerrarla." onClick={() => updateRecord("pettyCash", r.id, { status: "En revisión" })}>Solicitar liquidación</Button><Button variant="success" style={{ padding: "7px 9px", fontSize: 12 }} disabled={r.pending > 0 || r.observed > 0} help={r.pending > 0 || r.observed > 0 ? "No se puede cerrar mientras haya gastos pendientes u observados." : "Cierra definitivamente la caja chica."} onClick={() => updateRecord("pettyCash", r.id, { status: "Cerrada", closedAt: todayIso() })}>Cerrar</Button></div> }]} rows={cashRows} /></Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Comprobantes / gastos" helper="Cada gasto se revisa individualmente. Observados o sin comprobante bloquean el cierre de caja." /><Button onClick={() => setShowForm(showForm === "cashExpense" ? null : "cashExpense")}>Agregar gasto</Button></div>
      {showForm === "cashExpense" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Caja"><select style={inputStyle()} value={form.cashId || data.pettyCash[0]?.id || ""} onChange={(e) => setForm({ ...form, cashId: e.target.value })}>{data.pettyCash.map((cc) => <option key={cc.id} value={cc.id}>{cc.name} · {cc.responsible}</option>)}</select></Field><Field label="Fecha"><input type="date" style={inputStyle()} value={form.date || todayIso()} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field><Field label="Categoría"><select style={inputStyle()} value={form.categoryId || "caja_chica"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((cat) => cat.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field><Field label="Establecimiento / proveedor"><input style={inputStyle()} value={form.establishment || ""} onChange={(e) => setForm({ ...form, establishment: e.target.value })} /></Field><Field label="Persona fiscal"><select style={inputStyle()} value={form.taxpayerType || "Persona moral"} onChange={(e) => setForm({ ...form, taxpayerType: e.target.value })}>{TAXPAYER_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field><Field label="Monto antes IVA"><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => { const v = calcTaxValues(e.target.value, { taxpayerType: form.taxpayerType || "Persona moral" }, "base"); setForm({ ...form, ...v }); }} /></Field><Field label="Total pagado"><input type="number" style={inputStyle()} value={form.totalInput || ""} onChange={(e) => { const v = calcTaxValues(e.target.value, { taxpayerType: form.taxpayerType || "Persona moral" }, "total"); setForm({ ...form, ...v }); }} /></Field><Field label="IVA"><input type="number" style={inputStyle()} value={form.iva || ""} onChange={(e) => setForm({ ...form, iva: e.target.value })} /></Field><Field label="Retención"><input type="number" style={inputStyle()} value={form.retention || ""} onChange={(e) => setForm({ ...form, retention: e.target.value })} /></Field><Field label="Comprobante" help="Si marcas No, el gasto queda como Pendiente comprobante y bloquea el cierre de la caja hasta que se suba evidencia."><select style={inputStyle()} value={form.hasReceipt || "Sí"} onChange={(e) => setForm({ ...form, hasReceipt: e.target.value })}><option>Sí</option><option>No</option></select></Field><Field label="Factura/XML requerido"><select style={inputStyle()} value={form.invoiceRequired || "No"} onChange={(e) => setForm({ ...form, invoiceRequired: e.target.value })}><option>No</option><option>Sí</option></select></Field></div><Field label="Concepto"><input style={inputStyle()} value={form.concept || ""} onChange={(e) => setForm({ ...form, concept: e.target.value })} /></Field><AttachmentUploader label="Subir ticket / factura / XML" value={form.attachments} folder="finanzas/caja-chica" onChange={(attachments) => setForm({ ...form, attachments })} helper="Carga ticket, factura PDF, XML o foto del comprobante." /><Button onClick={addExpense}>Guardar gasto</Button></div> : null}
    </Card>
    <Card><div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -4 }}><ExportCsvButton filename="gastos-caja-chica.csv" rows={expenseRows.map((r) => ({ Fecha: r.date, Establecimiento: r.establishment || r.supplier || "", Concepto: r.concept, Categoria: categoryMap[r.categoryId]?.name || "", Total: r.totalInput || r.amount, Estado: r.status }))} /></div><StatusFilter value={expenseStatusFilter} onChange={setExpenseStatusFilter} options={(data.pettyExpenses || []).map((r) => r.status)} total={(data.pettyExpenses || []).length} shown={expenseRows.length} /><MiniTable columns={[{ key: "date", label: "Fecha" }, { key: "establishment", label: "Establecimiento", render: (r) => r.establishment || r.supplier || "—" }, { key: "concept", label: "Concepto" }, { key: "categoryId", label: "Categoría", render: (r) => categoryMap[r.categoryId]?.name }, { key: "amount", label: "Total", render: (r) => money(r.totalInput || r.amount) }, { key: "attachments", label: "Anexos", render: (r) => <AttachmentViewer value={r.attachments} /> }, { key: "status", label: "Estado", render: (r) => <div><Pill tone={statusTone(r.status)}>{r.status}</Pill><div style={{ color: c.muted, fontSize: 11, marginTop: 5 }}>Automático por revisión</div></div> }, { key: "expenseActions", label: "Acciones", sortable: false, render: (r) => <ActionCell><Button style={{ padding: "7px 9px", fontSize: 12 }} help="Confirma el gasto como válido; ya no bloquea el cierre de la caja." onClick={() => updateRecord("pettyExpenses", r.id, { status: "Aceptado", reviewedAt: todayIso(), reviewedBy: currentFinanceUser().email })}>Aceptar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help="Regresa el gasto al responsable con un comentario de qué falta corregir." onClick={() => observeExpense(r)}>Observar</Button><Button variant="danger" style={{ padding: "7px 9px", fontSize: 12 }} help="Rechaza el gasto; no se contará como comprobado." onClick={() => updateRecord("pettyExpenses", r.id, { status: "Rechazado", rejectedAt: todayIso() })}>Rechazar</Button></ActionCell> }]} rows={expenseRows} /></Card>
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
  const [search, setSearch] = useState("");
  const { confirm } = usePrompt();
  const statuses = ["Pendiente revisión", "Activo", "Bloqueado", "Inactivo"];
  const rfcInput = String(form.rfc || "").trim().toUpperCase();
  const duplicateSupplier = rfcInput ? (data.suppliers || []).find((s) => String(s.rfc || "").trim().toUpperCase() === rfcInput) : null;
  async function createSupplier() {
    if (!String(form.tradeName || "").trim()) { alert("Captura el nombre comercial del proveedor."); return; }
    if (!String(form.rfc || "").trim()) { alert("El RFC es obligatorio para poder generar pagos y comprobantes fiscales."); return; }
    if (!rfcLooksValid(form.rfc)) {
      const proceed = await confirm({
        title: "RFC con formato inusual",
        message: `"${form.rfc}" no tiene el formato típico de un RFC mexicano (letras + 6 dígitos + 3 caracteres). ¿Deseas guardarlo de todas formas?`,
        confirmLabel: "Guardar de todas formas",
        tone: "danger",
      });
      if (!proceed) return;
    }
    if (duplicateSupplier) {
      const proceed = await confirm({
        title: "RFC ya registrado",
        message: `"${duplicateSupplier.tradeName}" ya tiene este RFC (${duplicateSupplier.rfc}). ¿Deseas crear un proveedor nuevo de todas formas?`,
        confirmLabel: "Crear de todas formas",
        tone: "danger",
      });
      if (!proceed) return;
    }
    addRecord("suppliers", {
      folio: nextFolio(data, "suppliers", "PROV"),
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
  const statusFilteredRows = filterByStatus(allRows, statusFilter);
  const rows = filterBySearch(statusFilteredRows, search, (r) => `${r.tradeName} ${r.legalName} ${r.rfc} ${r.contact}`);
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
          <Field label="Persona fiscal" help="Define automáticamente las tasas de IVA e ISR retenido que se aplicarán en cada solicitud de pago a este proveedor."><select style={inputStyle()} value={form.taxpayerType || "Persona moral"} onChange={(e) => { const profile = taxProfileForSupplier({ taxpayerType: e.target.value }); setForm({ ...form, taxpayerType: e.target.value, ivaRate: profile.ivaRate, isrRetentionRate: profile.isrRetentionRate, ivaRetentionRate: profile.ivaRetentionRate }); }}>{TAXPAYER_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Contacto"><input style={inputStyle()} value={form.contact || ""} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
          <Field label="Correo de pagos"><input type="email" style={inputStyle()} value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="WhatsApp"><input style={inputStyle()} placeholder="521999..." value={form.whatsapp || ""} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></Field>
          <Field label="Categoría default"><select style={inputStyle()} value={form.categoryId || "construccion"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((cat) => cat.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field>
          <Field label="Requiere contrato" help="Si es Sí, se recomienda tener un contrato en Finanzas > Contratos antes de autorizar pagos grandes a este proveedor."><select style={inputStyle()} value={form.requiresContract || "No"} onChange={(e) => setForm({ ...form, requiresContract: e.target.value })}><option>No</option><option>Sí</option></select></Field>
          <Field label="Banco"><input style={inputStyle()} value={form.bank || ""} onChange={(e) => setForm({ ...form, bank: e.target.value })} /></Field>
          <Field label="CLABE" help="18 dígitos de la cuenta donde se depositará el pago. Verifica bien: un error aquí puede enviar el dinero a otra cuenta."><input style={inputStyle()} value={form.clabe || ""} onChange={(e) => setForm({ ...form, clabe: e.target.value })} /></Field>
          <Field label="Beneficiario"><input style={inputStyle()} value={form.accountHolder || ""} onChange={(e) => setForm({ ...form, accountHolder: e.target.value })} /></Field>
        </div>
        {duplicateSupplier ? <div style={{ padding: "10px 14px", borderRadius: 14, background: c.orangeSoft, color: "#9a5a00", fontSize: 13, fontWeight: 850 }}>Ya existe "{duplicateSupplier.tradeName}" con el RFC {duplicateSupplier.rfc}. Verifica antes de crear un duplicado.</div> : null}
        {form.clabe && !clabeLooksValid(form.clabe) ? <div style={{ padding: "10px 14px", borderRadius: 14, background: c.orangeSoft, color: "#9a5a00", fontSize: 13, fontWeight: 850 }}>La CLABE debe tener 18 dígitos numéricos. Revisa antes de guardar para no enviar pagos a una cuenta equivocada.</div> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Avisar por correo"><select style={inputStyle()} value={form.notifyEmail || "Sí"} onChange={(e) => setForm({ ...form, notifyEmail: e.target.value })}><option>Sí</option><option>No</option></select></Field><Field label="Avisar por WhatsApp"><select style={inputStyle()} value={form.notifyWhatsapp || "No"} onChange={(e) => setForm({ ...form, notifyWhatsapp: e.target.value })}><option>No</option><option>Sí</option></select></Field></div>
        <AttachmentUploader label="Subir documentos iniciales" value={form.documents} folder="finanzas/proveedores" onChange={(documents) => setForm({ ...form, documents })} helper="Constancia fiscal, carátula bancaria, opinión de cumplimiento, contrato marco u otros soportes." />
        <Button onClick={createSupplier}>Guardar proveedor</Button>
      </div> : null}
    </Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}><SectionTitle title="Validación administrativa" helper="Da clic en el nombre para consultar histórico. Usa Editar para cambiar datos, agregar documentos o configurar avisos por correo/WhatsApp." /><ExportCsvButton filename="proveedores.csv" rows={rows.map((r) => ({ Folio: r.folio || r.id, Proveedor: r.tradeName, RFC: r.rfc, Tipo: r.type, Persona: r.taxpayerType, Contacto: r.contact, Correo: r.email, Categoria: categoryMap[r.categoryId]?.name || "", Fiscal: r.fiscalStatus, Banco: r.bankStatus, Estatus: r.status }))} /></div><StatusFilter value={statusFilter} onChange={setStatusFilter} options={allRows.map((r) => r.status)} total={allRows.length} shown={rows.length} /><div style={{ marginTop: -6, marginBottom: 12 }}><input style={inputStyle({ maxWidth: 340 })} placeholder="Buscar por nombre, RFC o contacto…" value={search} onChange={(e) => setSearch(e.target.value)} /></div><MiniTable columns={[{ key: "folio", label: "Folio", render: (r) => <span style={{ fontFamily: "monospace", fontSize: 12, color: c.muted }}>{r.folio || "—"}</span> }, { key: "tradeName", label: "Proveedor", render: (r) => <EntityLink onClick={() => setSelectedSupplier(r)}>{r.tradeName}</EntityLink> }, { key: "rfc", label: "RFC" }, { key: "type", label: "Tipo", render: (r) => <div><b>{r.type}</b><div style={{ color: c.muted, fontSize: 11 }}>{r.taxpayerType || "Persona moral"}</div></div> }, { key: "contact", label: "Contacto", render: (r) => <div><b>{r.contact || "—"}</b><div style={{ color: c.muted, fontSize: 12 }}>{r.email || "sin correo"}{r.whatsapp ? ` · WA ${r.whatsapp}` : ""}</div></div> }, { key: "categoryId", label: "Categoría", render: (r) => categoryMap[r.categoryId]?.name }, { key: "fiscalStatus", label: "Fiscal", render: (r) => <select value={r.fiscalStatus || "Pendiente"} onChange={(e) => updateRecord("suppliers", r.id, { fiscalStatus: e.target.value })} style={inputStyle({ padding: 8, minWidth: 125 })} title="Validado = constancia fiscal y opinión de cumplimiento revisadas.">{["Pendiente", "Validado", "Observado", "No aplica"].map((x) => <option key={x}>{x}</option>)}</select> }, { key: "bankStatus", label: "Banco", render: (r) => <select value={r.bankStatus || "Pendiente"} onChange={(e) => updateRecord("suppliers", r.id, { bankStatus: e.target.value })} style={inputStyle({ padding: 8, minWidth: 125 })} title="Validado = CLABE y carátula bancaria confirmadas contra la cuenta real del proveedor.">{["Pendiente", "Validado", "Observado", "No aplica"].map((x) => <option key={x}>{x}</option>)}</select> }, { key: "documents", label: "Docs", render: (r) => <Pill tone={attachmentCount(r.documents) ? "ok" : "warn"} help="Número de documentos cargados en la ficha del proveedor (constancia fiscal, carátula bancaria, contratos, etc.).">{attachmentCount(r.documents)}</Pill> }, { key: "ready", label: "Listo", render: (r) => <Pill tone={supplierReady(r) ? "ok" : "warn"} help={supplierReady(r) ? "Cumple los requisitos mínimos (estatus activo, fiscal y banco validados) para recibir pagos." : "Falta activar el proveedor o validar sus datos fiscales/bancarios antes de poder pagarle."}>{supplierReady(r) ? "Pagable" : "Bloquea pago"}</Pill> }, { key: "status", label: "Estatus", render: (r) => <select value={r.status} onChange={(e) => updateRecord("suppliers", r.id, { status: e.target.value, reviewedBy: "admin@tritondesarrollos.com" })} style={inputStyle({ padding: 8, minWidth: 150 })} title="Solo los proveedores Activos pueden recibir nuevas solicitudes de pago.">{statuses.map((s) => <option key={s}>{s}</option>)}</select> }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help="Abre la ficha 360 del proveedor: historial, pagos y documentos." onClick={() => setSelectedSupplier(r)}>Ficha</Button><Button style={{ padding: "7px 9px", fontSize: 12 }} help="Edita datos fiscales, bancarios, contacto y canales de aviso." onClick={() => setEditingSupplier(r)}>Editar</Button></div> }]} rows={rows} /></Card>
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
function rentChargeTotal(charge = {}) { return Number(charge.rent || 0) + Number(charge.maintenance || 0) + Number(charge.otherCharges || 0) + Number(charge.vat || charge.iva || 0); }
function daysBetweenDates(from, to) {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 9999;
  return Math.ceil((b.getTime() - a.getTime()) / 86400000);
}
function addMonthsIso(date, months = 12) {
  const d = new Date(`${date || todayIso()}T00:00:00`);
  if (Number.isNaN(d.getTime())) return todayIso();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
function annualIncreaseInfo(contract = {}) {
  const base = contract.nextIncreaseDate || addMonthsIso(contract.lastIncreaseDate || contract.startDate || todayIso(), 12);
  const days = daysBetweenDates(todayIso(), base);
  const status = days < 0 ? "Vencido" : days <= 45 ? "Por vencer" : "Al día";
  return { nextDate: base, days, status, due: status !== "Al día" };
}
function invoiceActionLog(action) { return { at: new Date().toISOString(), user: firebaseAuth.currentUser?.email || "sistema", action }; }
function tenantStatement(data, tenantId) {
  const contracts = (data.contracts || []).filter((ct) => ct.tenantId === tenantId);
  const contractIds = new Set(contracts.map((ct) => ct.id));
  const charges = (data.rentCharges || []).filter((ch) => contractIds.has(ch.contractId));
  const billed = charges.reduce((a, ch) => a + rentChargeTotal(ch), 0);
  const paid = charges.reduce((a, ch) => a + Number(ch.paidAmount || 0), 0);
  const overdue = charges.filter((ch) => ["Vencido", "Parcial", "Pendiente"].includes(ch.status)).reduce((a, ch) => a + Math.max(0, rentChargeTotal(ch) - Number(ch.paidAmount || 0)), 0);
  return { contracts, charges, billed, paid, overdue };
}
function TenantDrawer({ tenant, data, assetMap, onClose, onEdit }) {
  if (!tenant) return null;
  const statement = tenantStatement(data, tenant.id);
  return <SideDrawer title={tenant.name} eyebrow="Arrendatario 360" subtitle={`${tenant.taxpayerType || "Tipo fiscal pendiente"} · ${tenant.fiscalId || "RFC pendiente"}`} onClose={onClose} width={760} footer={<><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button onClick={() => onEdit(tenant)}>Editar arrendatario</Button></>}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
      <MetricCard label="Facturado" value={money(statement.billed)} tone="primary" />
      <MetricCard label="Pagado" value={money(statement.paid)} tone="ok" />
      <MetricCard label="Adeudo" value={money(statement.overdue)} tone={statement.overdue > 0 ? "danger" : "ok"} />
      <MetricCard label="Contratos" value={statement.contracts.length} tone="idle" />
    </div>
    <Card style={{ boxShadow: "none" }}><SectionTitle title="Datos de contacto y facturación" helper="Se usan para avisos, cobranza, facturación y expediente del arrendatario." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
        <Info label="Correo" value={tenant.email || "Pendiente"} /><Info label="Correo facturación" value={tenant.billingEmail || "Pendiente"} /><Info label="WhatsApp" value={tenant.whatsapp || tenant.phone || "Pendiente"} /><Info label="Cédula fiscal" value={tenant.certificateStatus || "Pendiente"} />
      </div>
    </Card>
    <Card style={{ boxShadow: "none" }}><SectionTitle title="Contratos y vencimientos" helper="Da clic en el contrato desde la lista de contratos para abrir su expediente." />
      <MiniTable columns={[{ key: "assetId", label: "Inmueble", render: (r) => assetMap[r.assetId]?.name }, { key: "rentBase", label: "Renta", render: (r) => money(r.rentBase) }, { key: "endDate", label: "Vence" }, { key: "inpcMonth", label: "Incremento anual" }, { key: "status", label: "Estatus", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }]} rows={statement.contracts} />
    </Card>
    <Card style={{ boxShadow: "none" }}><SectionTitle title="Estado de cuenta" helper="Pagos, saldos, vencidos y conciliación bancaria." />
      <MiniTable columns={[{ key: "period", label: "Periodo" }, { key: "contractId", label: "Inmueble", render: (r) => assetMap[(data.contracts || []).find((ct) => ct.id === r.contractId)?.assetId]?.name }, { key: "total", label: "Cargo", render: (r) => money(rentChargeTotal(r)) }, { key: "paidAmount", label: "Pagado", render: (r) => money(r.paidAmount) }, { key: "balance", label: "Saldo", render: (r) => money(Math.max(0, rentChargeTotal(r) - Number(r.paidAmount || 0))) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "reconciled", label: "Conciliado", render: (r) => r.reconciled ? <Pill tone="ok">Sí</Pill> : <Pill tone="warn">No</Pill> }]} rows={statement.charges} />
    </Card>
  </SideDrawer>;
}
function AssetDrawer({ asset, data, tenantMap, onClose, onEdit, onOpenContract, onOpenTenant }) {
  if (!asset) return null;
  const contracts = (data.contracts || []).filter((ct) => ct.assetId === asset.id);
  const history = assetHistoryEntries(asset, data, tenantMap);
  const predials = (data.propertyTaxes || []).filter((p) => p.assetId === asset.id);
  return <SideDrawer title={asset.name} eyebrow="Inmueble / predio" subtitle={`${asset.type || "Tipo"} · ${assetGroupName(asset)}`} onClose={onClose} width={820} footer={<><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button onClick={() => onEdit(asset)}>Editar inmueble</Button></>}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
      <MetricCard label="Renta objetivo" value={money(asset.rentalPrice)} tone="primary" />
      <MetricCard label="m²" value={numberFmt(asset.area)} tone="idle" />
      <MetricCard label="Precio/m²" value={money(asset.pricePerM2)} tone="idle" />
      <MetricCard label="Estatus" value={asset.status || "Sin estatus"} tone={asset.status === "Ocupado" ? "ok" : "warn"} />
    </div>
    <Card style={{ boxShadow: "none" }}><SectionTitle title="Ficha del inmueble" helper="Información base para control patrimonial, rentas, contratos y cobranza." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
        <Info label="Agrupación / plaza" value={assetGroupName(asset)} />
        <Info label="Dirección" value={asset.address || asset.location || "Pendiente"} />
        <Info label="Propietario del predio" value={asset.ownerName || (data.propertyOwners || []).find((o) => o.id === asset.ownerId)?.name || "Pendiente"} />
        <Info label="Cuenta de depósito" value={asset.depositAccountAlias || (data.depositAccounts || []).find((a) => a.id === asset.depositAccountId)?.alias || "Pendiente asignar"} />
        <Info label="Cédula / clave catastral" value={asset.cadastralId || asset.hasCadastralCertificate || "Pendiente"} />
        <Info label="Situación documental" value={asset.legalStatus || asset.importStatus || "Pendiente"} />
        <Info label="Coordenadas" value={asset.coordinates || "Pendiente"} />
      </div>
    </Card>
    <Card style={{ boxShadow: "none" }}><SectionTitle title="Contratos ligados" helper="Da clic en el contrato o arrendatario para abrir el expediente correspondiente." />
      <MiniTable columns={[{ key: "tenantId", label: "Arrendatario", render: (r) => <EntityLink onClick={() => onOpenTenant?.(tenantMap[r.tenantId])}>{tenantMap[r.tenantId]?.name || "Arrendatario"}</EntityLink> }, { key: "id", label: "Contrato", render: (r) => <EntityLink onClick={() => onOpenContract?.(r)}>{r.contractType || "Arrendamiento"}</EntityLink> }, { key: "rentBase", label: "Renta", render: (r) => money(r.rentBase) }, { key: "startDate", label: "Inicio" }, { key: "endDate", label: "Fin" }, { key: "status", label: "Estatus", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }]} rows={contracts} />
    </Card>
    <Card style={{ boxShadow: "none" }}><SectionTitle title="Predial del inmueble" helper="Control de riesgo: mantener predial al día y conservar comprobantes." />
      <MiniTable columns={[{ key: "year", label: "Año" }, { key: "amount", label: "Importe", render: (r) => money(r.amount) }, { key: "dueDate", label: "Vence" }, { key: "status", label: "Estado", render: (r) => <Pill tone={r.status === "Pagado" ? "ok" : r.status === "Vencido" ? "danger" : "warn"}>{r.status}</Pill> }, { key: "bankReference", label: "Referencia" }, { key: "attachments", label: "Comprobante", render: (r) => <AttachmentViewer value={r.attachments} /> }]} rows={predials} />
    </Card>
    <Card style={{ boxShadow: "none" }}><SectionTitle title="Historial del inmueble" helper="Ocupación, desocupaciones, cambios de estatus y movimientos con usuario responsable." />
      <div style={{ display: "grid", gap: 9 }}>{history.length ? history.map((h) => <div key={h.id || `${h.date}-${h.action}`} style={{ padding: 12, borderRadius: 16, border: `1px solid ${c.border}`, background: c.soft }}><div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><Pill tone="primary">{h.action}</Pill><b>{h.user || "sistema"}</b><span style={{ color: c.muted, fontSize: 12 }}>{String(h.date || "").slice(0, 10)}</span><span style={{ color: c.muted, fontSize: 12 }}>{h.source}</span></div><div style={{ marginTop: 7, color: c.text }}>{h.comment || "Sin comentario"}</div></div>) : <div style={{ color: c.muted }}>Sin historial todavía.</div>}</div>
    </Card>
    <Card style={{ boxShadow: "none" }}><SectionTitle title="Documentos del inmueble" helper="Cédulas, predial, croquis, escrituras, fotos, contratos relacionados y soportes." /><AttachmentViewer value={asset.attachments} /></Card>
  </SideDrawer>;
}
function LeaseContractDrawer({ contract, data, tenantMap, assetMap, onClose, onEdit }) {
  if (!contract) return null;
  const tenant = tenantMap[contract.tenantId];
  const asset = assetMap[contract.assetId];
  const charges = (data.rentCharges || []).filter((ch) => ch.contractId === contract.id);
  const paid = charges.reduce((a, ch) => a + Number(ch.paidAmount || 0), 0);
  const billed = charges.reduce((a, ch) => a + rentChargeTotal(ch), 0);
  return <SideDrawer title={`Contrato · ${tenant?.name || "Arrendatario"}`} eyebrow="Expediente de contrato" subtitle={`${asset?.name || "Inmueble"} · Vigencia ${contract.startDate || "?"} a ${contract.endDate || "?"}`} onClose={onClose} width={820} footer={<><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button onClick={() => onEdit(contract)}>Editar contrato</Button></>}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
      <MetricCard label="Renta base" value={money(contract.rentBase)} tone="primary" />
      <MetricCard label="Mantenimiento" value={`${contract.maintenancePct || 0}%`} tone="idle" />
      <MetricCard label="Facturado" value={money(billed)} tone="warn" />
      <MetricCard label="Pagado conciliado" value={money(paid)} tone="ok" />
    </div>
    <Card style={{ boxShadow: "none" }}><SectionTitle title="Control del contrato" helper="Vigencia, incremento anual, cédula, banco, referencia y facturación." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
        <Info label="Arrendatario" value={tenant?.name || "Pendiente"} /><Info label="Inmueble" value={asset?.name || "Pendiente"} /><Info label="Día de pago" value={contract.paymentDay || "Pendiente"} /><Info label="Banco / referencia" value={`${contract.bank || "Banco"} · ${contract.reference || "Sin referencia"}`} /><Info label="Último incremento anual" value={contract.lastIncreaseDate || contract.inpcMonth || "Pendiente"} /><Info label="Facturación" value={contract.autoInvoice ? "Automática" : "Manual"} />
      </div>
    </Card>
    <Card style={{ boxShadow: "none" }}><SectionTitle title="Cargos mensuales" helper="El reporte de rentas cobradas debe basarse en cargos conciliados." />
      <MiniTable columns={[{ key: "period", label: "Periodo" }, { key: "total", label: "Cargo", render: (r) => money(rentChargeTotal(r)) }, { key: "paidAmount", label: "Pagado", render: (r) => money(r.paidAmount) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "reconciled", label: "Conciliado", render: (r) => r.reconciled ? <Pill tone="ok">Sí</Pill> : <Pill tone="warn">No</Pill> }, { key: "invoiceStatus", label: "Factura" }]} rows={charges} />
    </Card>
    <Card style={{ boxShadow: "none" }}><SectionTitle title="Anexos del contrato" helper="Contrato firmado, cédula fiscal, identificaciones, garantías, pólizas y soportes." /><AttachmentViewer value={contract.attachments} /></Card>
  </SideDrawer>;
}
function SideDrawer({ title, subtitle, eyebrow, onClose, children, footer, width = 720 }) {
  return <div style={{ position: "fixed", inset: 0, zIndex: 2147483642, pointerEvents: "none" }}><div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.16)", backdropFilter: "blur(2px)", pointerEvents: "auto" }} onClick={onClose} /><aside style={{ position: "absolute", right: 18, top: 18, bottom: 18, width: `min(${width}px, calc(100vw - 36px))`, background: "rgba(255,255,255,0.99)", border: `1px solid ${c.border}`, borderRadius: 28, boxShadow: "0 24px 80px rgba(0,0,0,.18)", overflow: "hidden", pointerEvents: "auto", display: "grid", gridTemplateRows: "auto 1fr auto" }}><header style={{ padding: 20, borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}><div>{eyebrow ? <Pill tone="primary">{eyebrow}</Pill> : null}<h2 style={{ margin: "10px 0 4px", fontSize: 23 }}>{title}</h2>{subtitle ? <div style={{ color: c.muted, fontSize: 13 }}>{subtitle}</div> : null}</div><button onClick={onClose} style={{ border: 0, background: c.soft, borderRadius: 14, width: 40, height: 40, cursor: "pointer", fontWeight: 950 }}>×</button></header><main style={{ padding: 20, overflow: "auto", display: "grid", gap: 14 }}>{children}</main>{footer ? <footer style={{ padding: 16, borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>{footer}</footer> : null}</aside></div>;
}
function MetricCard({ label, value, tone = "idle" }) { return <Card style={{ padding: 14, boxShadow: "none" }}><Pill tone={tone}>{label}</Pill><b style={{ display: "block", marginTop: 8, fontSize: 20 }}>{value}</b></Card>; }
function Info({ label, value }) { return <div style={{ padding: 12, border: `1px solid ${c.border}`, borderRadius: 16, background: "white" }}><b style={{ display: "block", fontSize: 12, color: c.muted }}>{label}</b><span style={{ display: "block", marginTop: 4, fontWeight: 850 }}>{value}</span></div>; }

function parseAssetCoordinates(asset = {}) {
  const lat = Number(asset.latitude ?? String(asset.coordinates || "").split(",")[0]);
  const lng = Number(asset.longitude ?? String(asset.coordinates || "").split(",")[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function assetGroupName(asset = {}) {
  const text = [asset.collection, asset.assetGroup, asset.propertyGroup, asset.location, asset.address, asset.name].join(" ").toLowerCase();
  if (text.includes("plaza las vias") || text.includes("plaza las vías")) return "Plaza Las Vías";
  if (text.includes("plaza faro") || text.includes("faro")) return "Plaza Faro";
  if (text.includes("aura caucel")) return "Locales Aura Caucel";
  if (text.includes("itzimna") || text.includes("itzimná")) return "Itzimná";
  if (text.includes("campestre")) return "Campestre";
  if (text.includes("sodzil")) return "Sodzil";
  if (text.includes("temozon") || text.includes("temozón")) return "Temozón";
  if (asset.location) return asset.location.split(",")[0].trim();
  if (asset.type === "Terreno") return "Terrenos independientes";
  return "Inmuebles independientes";
}
function isPlazaGroupName(groupName = "") {
  const text = String(groupName || "").toLowerCase();
  return text.includes("plaza") || text.includes("locales aura") || text.includes("centro comercial");
}
function metersBetween(a, b) {
  const R = 6371000;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function groupNearbyMappedAssets(mappedAssets = [], radiusMeters = 70) {
  const groups = [];
  mappedAssets.forEach((item) => {
    const match = groups.find((group) => metersBetween(group.center, item.coords) <= radiusMeters);
    if (match) {
      match.items.push(item);
      const n = match.items.length;
      match.center = { lat: (match.center.lat * (n - 1) + item.coords.lat) / n, lng: (match.center.lng * (n - 1) + item.coords.lng) / n };
    } else {
      groups.push({ id: `map-group-${groups.length + 1}`, center: item.coords, items: [item] });
    }
  });
  return groups;
}
function periodLabel(value = todayIso()) { return String(value || todayIso()).slice(0, 7); }
function rentChargeLabel(charge = {}) { return charge.chargeType || (Number(charge.maintenance || 0) && !Number(charge.rent || 0) ? "Mantenimiento" : "Renta"); }
function chargeNetAmount(charge = {}) { return Number(charge.rent || 0) + Number(charge.maintenance || 0) + Number(charge.otherCharges || 0); }
function chargeVatAmount(charge = {}) { return Number(charge.vat || charge.iva || 0); }
function chargeGrossAmount(charge = {}) { return chargeNetAmount(charge) + chargeVatAmount(charge); }
function assetHistoryEntries(asset = {}, data = {}, tenantMap = {}) {
  const manual = Array.isArray(asset.history) ? asset.history.map((h) => ({ ...h, source: "Historial manual" })) : [];
  const contracts = (data.contracts || []).filter((ct) => ct.assetId === asset.id).flatMap((ct) => {
    const tenant = tenantMap[ct.tenantId]?.name || "Arrendatario";
    return [
      { id: `${ct.id}-start`, date: ct.startDate, action: "Contrato iniciado", user: ct.createdBy || "sistema", comment: `${tenant} · renta ${money(ct.rentBase)}`, source: "Contrato" },
      { id: `${ct.id}-end`, date: ct.endDate, action: ct.status === "Activo" ? "Vencimiento programado" : "Contrato cerrado / desocupado", user: ct.updatedBy || "sistema", comment: `${tenant} · estatus ${ct.status || "Activo"}`, source: "Contrato" },
    ];
  });
  return [...manual, ...contracts].filter((h) => h.date).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function AssetMapView({ assets = [], onSelect }) {
  const mapId = React.useMemo(() => `triton-assets-map-${Math.random().toString(36).slice(2)}`, []);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const mappedAssets = useMemo(() => assets.map((asset) => ({ asset, coords: parseAssetCoordinates(asset) })).filter((x) => x.coords), [assets]);
  const markerGroups = useMemo(() => groupNearbyMappedAssets(mappedAssets, 70), [mappedAssets]);
  const missingAssets = assets.length - mappedAssets.length;
  const selectedMapped = mappedAssets.find((x) => x.asset.id === selectedAsset?.id) || mappedAssets[0] || null;
  const selectedGroup = markerGroups.find((group) => group.id === selectedGroupId) || markerGroups.find((group) => group.items.some((x) => x.asset.id === selectedMapped?.asset?.id)) || markerGroups[0] || null;

  useEffect(() => {
    if (!mappedAssets.length) { setSelectedAsset(null); setSelectedGroupId(""); return; }
    if (!selectedAsset || !mappedAssets.some((x) => x.asset.id === selectedAsset.id)) setSelectedAsset(mappedAssets[0].asset);
  }, [mappedAssets, selectedAsset]);

  useEffect(() => {
    if (!mapContainerRef.current || !mappedAssets.length) return undefined;
    const el = mapContainerRef.current;
    el.innerHTML = "";
    const first = mappedAssets[0].coords;
    const map = L.map(el, { scrollWheelZoom: false, zoomControl: true, attributionControl: true }).setView([first.lat, first.lng], mappedAssets.length === 1 ? 15 : 12);
    mapRef.current = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    const bounds = [];
    const iconForGroup = (group) => L.divIcon({
      className: "triton-map-pin-wrap",
      html: group.items.length > 1 ? `<div class="triton-map-cluster"><b>${group.items.length}</b></div>` : `<div class="triton-map-pin"><span></span></div>`,
      iconSize: group.items.length > 1 ? [44, 44] : [34, 42],
      iconAnchor: group.items.length > 1 ? [22, 22] : [17, 38],
      popupAnchor: [0, group.items.length > 1 ? -18 : -36],
    });
    markerGroups.forEach((group) => {
      bounds.push([group.center.lat, group.center.lng]);
      const marker = L.marker([group.center.lat, group.center.lng], { icon: iconForGroup(group) }).addTo(map);
      const listHtml = group.items.slice(0, 18).map(({ asset }) => `<button type="button" data-asset-id="${asset.id}" style="display:block;width:100%;text-align:left;margin-top:6px;border:1px solid rgba(88,84,76,.16);border-radius:12px;padding:8px 9px;background:#fff;color:#242322;font-weight:800;cursor:pointer;"><span style="display:block;white-space:normal;">${asset.name || "Inmueble"}</span><small style="color:#6B6862;">${asset.type || ""} · ${asset.status || ""}</small></button>`).join("");
      const title = group.items.length > 1 ? `${group.items.length} inmuebles en este punto/cerca` : (group.items[0]?.asset?.name || "Inmueble");
      marker.bindPopup(`<div style="min-width:260px;max-width:320px;font-family:Montserrat,Arial,sans-serif;"><strong style="font-size:14px;color:#242322;">${title}</strong><br/><span style="color:#6B6862;">Selecciona uno para abrir su expediente.</span>${listHtml}</div>`);
      marker.on("mouseover", () => marker.openPopup());
      marker.on("click", () => { setSelectedGroupId(group.id); setSelectedAsset(group.items[0]?.asset || null); marker.openPopup(); });
      marker.on("popupopen", () => {
        setTimeout(() => {
          group.items.forEach(({ asset }) => {
            const btn = document.querySelector(`[data-asset-id="${asset.id}"]`);
            if (btn) btn.onclick = () => { setSelectedGroupId(group.id); setSelectedAsset(asset); onSelect(asset); };
          });
        }, 0);
      });
    });
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    setTimeout(() => map.invalidateSize(), 220);
    return () => { map.remove(); mapRef.current = null; };
  }, [mapId, mappedAssets, markerGroups, onSelect]);

  function focusAsset(asset) {
    const coords = parseAssetCoordinates(asset);
    setSelectedAsset(asset);
    const group = markerGroups.find((g) => g.items.some((x) => x.asset.id === asset.id));
    if (group) setSelectedGroupId(group.id);
    if (coords && mapRef.current) mapRef.current.setView([coords.lat, coords.lng], 17, { animate: true });
  }

  return <Card style={{ boxShadow: "none" }}>
    <style>{`
      .triton-real-map .leaflet-container { font-family: Montserrat, Arial, sans-serif; background: #EFE9DD; }
      .triton-real-map .leaflet-control-attribution { font-size: 10px; }
      .triton-map-pin-wrap { background: transparent; border: 0; }
      .triton-map-pin { width: 30px; height: 30px; border-radius: 999px 999px 999px 4px; transform: rotate(-45deg); background: #B08A2E; border: 3px solid #fff; box-shadow: 0 10px 24px rgba(0,0,0,.24); display: grid; place-items: center; }
      .triton-map-pin span { width: 9px; height: 9px; border-radius: 50%; background: #fff; display: block; }
      .triton-map-cluster { width: 44px; height: 44px; border-radius: 999px; background: #B08A2E; color: white; border: 4px solid white; box-shadow: 0 12px 26px rgba(0,0,0,.24); display: grid; place-items: center; font-weight: 950; }
      .triton-real-map .leaflet-popup-content-wrapper { border-radius: 18px; box-shadow: 0 16px 40px rgba(0,0,0,.18); }
      .triton-real-map .leaflet-popup-content { margin: 14px; }
    `}</style>
    <SectionTitle title="Vista mapa real" helper="Los inmuebles en el mismo punto o muy cercanos se agrupan. Pasa el mouse por un pin agrupado para escoger el predio/local correcto." />
    {!mappedAssets.length ? <div style={{ padding: 16, border: `1px dashed ${c.border}`, borderRadius: 18, color: c.muted }}>No hay inmuebles con coordenadas para mostrar en mapa. Agrega latitud/longitud o coordenadas en el expediente del inmueble.</div> : <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(290px,390px)", gap: 14, alignItems: "stretch" }}>
      <div className="triton-real-map" style={{ minHeight: 590, borderRadius: 26, overflow: "hidden", border: `1px solid ${c.border}`, background: c.soft, position: "relative" }}><div ref={mapContainerRef} id={mapId} style={{ height: "100%", minHeight: 590, width: "100%" }} /></div>
      <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
        <Card style={{ boxShadow: "none", padding: 14, borderRadius: 20 }}>
          <Pill tone="primary">Punto seleccionado</Pill>
          <h3 style={{ margin: "10px 0 4px", fontSize: 20, color: c.text }}>{selectedGroup?.items?.length > 1 ? `${selectedGroup.items.length} inmuebles cercanos` : selectedMapped?.asset?.name || "Selecciona un inmueble"}</h3>
          <div style={{ color: c.muted, fontSize: 13, lineHeight: 1.45 }}>Puedes abrir directamente el expediente o escoger otro inmueble del mismo punto.</div>
          <div style={{ display: "grid", gap: 8, marginTop: 12, maxHeight: 210, overflow: "auto" }}>{(selectedGroup?.items || []).map(({ asset }) => <button key={asset.id} type="button" onClick={() => focusAsset(asset)} style={{ textAlign: "left", border: selectedAsset?.id === asset.id ? `2px solid ${c.primary}` : `1px solid ${c.border}`, background: selectedAsset?.id === asset.id ? c.primarySoft : "white", borderRadius: 14, padding: 10, cursor: "pointer" }}><b>{asset.name}</b><div style={{ color: c.muted, fontSize: 12 }}>{asset.type || "Inmueble"} · {asset.location || asset.address || "Sin ubicación"}</div></button>)}</div>
          {selectedMapped?.asset ? <Button style={{ width: "100%", marginTop: 12 }} onClick={() => onSelect(selectedMapped.asset)}>Abrir expediente seleccionado</Button> : null}
        </Card>
        <Card style={{ boxShadow: "none", padding: 14, borderRadius: 20, maxHeight: 280, overflow: "auto" }}>
          <SectionTitle title="Predios ubicados" helper="Da clic para centrar el mapa." />
          <div style={{ display: "grid", gap: 8 }}>{mappedAssets.map(({ asset }) => <button key={asset.id} type="button" onClick={() => focusAsset(asset)} style={{ textAlign: "left", border: selectedAsset?.id === asset.id ? `2px solid ${c.primary}` : `1px solid ${c.border}`, background: selectedAsset?.id === asset.id ? c.primarySoft : "white", borderRadius: 16, padding: 10, cursor: "pointer" }}><b style={{ color: c.text }}>{asset.name}</b><div style={{ color: c.muted, fontSize: 12, marginTop: 3 }}>{assetGroupName(asset)} · {asset.type || "Inmueble"}</div></button>)}</div>
        </Card>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Pill tone="primary">{mappedAssets.length} con ubicación</Pill><Pill tone="primary">{markerGroups.length} puntos en mapa</Pill>{missingAssets ? <Pill tone="warn">{missingAssets} sin coordenadas</Pill> : <Pill tone="ok">Todos ubicados</Pill>}</div>
      </div>
    </div>}
  </Card>;
}


function AssetGroupedTable({ rows = [], data, onOpen, onEdit }) {
  const [collapsed, setCollapsed] = useState({});
  const columns = [
    { key: "name", label: "Inmueble", render: (r) => <EntityLink onClick={() => onOpen(r)}>{r.name}</EntityLink> },
    { key: "type", label: "Tipo" },
    { key: "ownerName", label: "Propietario", render: (r) => r.ownerName || (data.propertyOwners || []).find((o) => o.id === r.ownerId)?.name || "Pendiente" },
    { key: "depositAccountAlias", label: "Cuenta depósito", render: (r) => r.depositAccountAlias || "Pendiente" },
    { key: "location", label: "Ubicación" },
    { key: "area", label: "m²" },
    { key: "rentalPrice", label: "Precio/renta", render: (r) => Number(r.rentalPrice || 0) ? money(r.rentalPrice) : "Por definir" },
    { key: "cadastralId", label: "Cédula" },
    { key: "status", label: "Estado", render: (r) => <Pill tone={r.status === "Ocupado" ? "ok" : r.status === "Revisión pendiente" ? "warn" : "primary"}>{r.status}</Pill> },
    { key: "actions", label: "Acciones", render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => onOpen(r)}>Abrir</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => onEdit(r)}>Editar</Button></ActionCell> },
  ];
  const { plazaGroups, normalRows } = useMemo(() => {
    const groupMap = new Map();
    const regular = [];
    rows.forEach((asset) => {
      const group = assetGroupName(asset);
      if (isPlazaGroupName(group)) {
        if (!groupMap.has(group)) groupMap.set(group, []);
        groupMap.get(group).push(asset);
      } else {
        regular.push(asset);
      }
    });
    return { plazaGroups: Array.from(groupMap.entries()).sort((a, b) => a[0].localeCompare(b[0])), normalRows: regular.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))) };
  }, [rows]);
  return <div style={{ display: "grid", gap: 12 }}>
    {plazaGroups.map(([groupName, groupRows]) => {
      const isCollapsed = collapsed[groupName];
      const occupied = groupRows.filter((a) => a.status === "Ocupado").length;
      return <Card key={groupName} style={{ padding: 0, overflow: "hidden" }}>
        <button type="button" onClick={() => setCollapsed((prev) => ({ ...prev, [groupName]: !prev[groupName] }))} style={{ width: "100%", border: 0, background: c.soft, padding: 14, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, textAlign: "left" }}>
          <div><b style={{ fontSize: 16, color: c.text }}>{groupName}</b><div style={{ color: c.muted, fontSize: 12, marginTop: 3 }}>{groupRows.length} local(es) / inmueble(s) · {occupied} ocupado(s)</div></div>
          <span style={{ fontWeight: 950, color: c.primaryDark }}>{isCollapsed ? "Mostrar" : "Minimizar"}</span>
        </button>
        {!isCollapsed ? <div style={{ padding: 12 }}><MiniTable columns={columns} rows={groupRows} /></div> : null}
      </Card>;
    })}
    <Card style={{ boxShadow: "none" }}>
      <SectionTitle title="Inmuebles independientes" helper="Terrenos, casas, departamentos, oficinas u otros predios que no pertenecen a una plaza. Estos no se agrupan ni se minimizan." />
      <MiniTable columns={columns} rows={normalRows} empty="No hay inmuebles independientes con los filtros actuales." />
    </Card>
  </div>;
}


function RentalContractForm({ data, tenantMap, assetMap, form, setForm, onSave, editing }) {
  const [tenantMode, setTenantMode] = useState(form.newTenantName ? "nuevo" : "existente");
  const selectedTenant = tenantMap[form.tenantId];
  return <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
    <ProgressLine items={[{ label: "Arrendatario", done: !!(form.tenantId || form.newTenantName) }, { label: "Inmueble", done: !!form.assetId }, { label: "Contrato", active: true }, { label: "Anexos", done: attachmentCount(form.attachments) > 0 }]} />
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button variant={tenantMode === "existente" ? "primary" : "secondary"} onClick={() => setTenantMode("existente")}>Usar arrendatario existente</Button><Button variant={tenantMode === "nuevo" ? "primary" : "secondary"} onClick={() => setTenantMode("nuevo")}>Alta de arrendatario + contrato</Button></div>
    {tenantMode === "existente" ? <Field label="Buscar / seleccionar arrendatario"><select style={inputStyle()} value={form.tenantId || data.tenants[0]?.id || ""} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}>{data.tenants.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.taxpayerType || "Tipo fiscal"}</option>)}</select></Field> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Nombre arrendatario"><input style={inputStyle()} value={form.newTenantName || ""} onChange={(e) => setForm({ ...form, newTenantName: e.target.value })} /></Field><Field label="Persona"><select style={inputStyle()} value={form.newTenantTaxpayerType || "Persona moral"} onChange={(e) => setForm({ ...form, newTenantTaxpayerType: e.target.value })}>{TAXPAYER_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field><Field label="RFC"><input style={inputStyle()} value={form.newTenantFiscalId || ""} onChange={(e) => setForm({ ...form, newTenantFiscalId: e.target.value })} /></Field><Field label="Correo facturación"><input style={inputStyle()} value={form.newTenantBillingEmail || ""} onChange={(e) => setForm({ ...form, newTenantBillingEmail: e.target.value })} /></Field></div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
      <Field label="Inmueble"><select style={inputStyle()} value={form.assetId || data.assets[0]?.id || ""} onChange={(e) => setForm({ ...form, assetId: e.target.value })}>{data.assets.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.type}</option>)}</select></Field>
      <Field label="Tipo contrato"><select style={inputStyle()} value={form.contractType || "Arrendamiento comercial"} onChange={(e) => setForm({ ...form, contractType: e.target.value })}>{(data.rentalContractTypes || ["Arrendamiento comercial", "Arrendamiento habitacional"]).map((x) => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Renta base" help="Monto mensual antes de IVA. Cada mes 'Generar mes completo' en Cobranza usa este valor para crear el cargo."><input type="number" style={inputStyle()} value={form.rentBase || ""} onChange={(e) => setForm({ ...form, rentBase: e.target.value })} /></Field>
      <Field label="Mantenimiento %" help="Porcentaje de la renta base que se cobra como mantenimiento. Si es mayor a 0, se genera un cargo separado cada mes."><input type="number" style={inputStyle()} value={form.maintenancePct ?? 0} onChange={(e) => setForm({ ...form, maintenancePct: e.target.value })} /></Field>
      <Field label="Inicio"><input type="date" style={inputStyle()} value={form.startDate || todayIso()} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
      <Field label="Fin"><input type="date" style={inputStyle()} value={form.endDate || todayIso()} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
      <Field label="Día de pago" help="Día del mes en que vence la renta; se usa para calcular la fecha de vencimiento de cada cargo mensual."><input type="number" style={inputStyle()} value={form.paymentDay || 10} onChange={(e) => setForm({ ...form, paymentDay: e.target.value })} /></Field>
      <Field label="Banco"><input style={inputStyle()} value={form.bank || "VEPORMAS"} onChange={(e) => setForm({ ...form, bank: e.target.value })} /></Field>
      <Field label="Referencia bancaria"><input style={inputStyle()} value={form.reference || ""} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
      <Field label="Base del incremento anual" help="Regla pactada para el aumento de renta cada año (ej. 'INPC + 2%' o 'Fijo 5% anual'). Es texto de referencia; el sistema solo avisa cuándo toca aplicarlo."><input style={inputStyle()} placeholder="Fijo %, índice pactado o regla según contrato" value={form.annualIncreaseBase || form.inpcMonth || ""} onChange={(e) => setForm({ ...form, annualIncreaseBase: e.target.value, inpcMonth: e.target.value })} /></Field>
      <Field label="Último incremento"><input type="date" style={inputStyle()} value={form.lastIncreaseDate || form.startDate || todayIso()} onChange={(e) => setForm({ ...form, lastIncreaseDate: e.target.value, nextIncreaseDate: addMonthsIso(e.target.value, 12) })} /></Field>
      <Field label="Próximo incremento" help="Se calcula 12 meses después del último incremento. Cuando se acerca, el contrato aparece como 'Por vencer' en Contratos y Reportes."><input type="date" style={inputStyle()} value={form.nextIncreaseDate || addMonthsIso(form.lastIncreaseDate || form.startDate || todayIso(), 12)} onChange={(e) => setForm({ ...form, nextIncreaseDate: e.target.value })} /></Field>
    </div>
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}><input type="checkbox" checked={!!form.autoInvoice} onChange={(e) => setForm({ ...form, autoInvoice: e.target.checked })} /> Facturación automática mensual<HelpIcon text="Si está marcado, cada cargo mensual nace con estatus 'Por emitir' en Facturación de rentas en vez de 'Manual'." /></label>
    <AttachmentUploader label="Anexos del contrato" value={form.attachments} folder="arrendamientos/contratos" onChange={(attachments) => setForm({ ...form, attachments })} />
    <ValidationBanner title="Validación de contrato" checks={[{ label: "Arrendatario", ok: !!(form.tenantId || form.newTenantName) }, { label: "Inmueble", ok: !!form.assetId }, { label: "Renta", ok: Number(form.rentBase || 0) > 0 }, { label: "Vigencia", ok: !!form.startDate && !!form.endDate }, { label: "Anexos", ok: attachmentCount(form.attachments) > 0 }]} />
    {selectedTenant ? <div style={{ color: c.muted, fontSize: 12 }}>Arrendatario seleccionado: {selectedTenant.name} · {selectedTenant.certificateStatus || "sin cédula"}</div> : null}
    <Button onClick={onSave}>{editing ? "Guardar cambios de contrato" : "Guardar contrato"}</Button>
  </div>;
}
function AssetForm({ data, form, setForm, onSave, editing }) {
  const ownerOptions = data.propertyOwners || [];
  const accountOptions = data.depositAccounts || [];
  const selectedOwner = ownerOptions.find((o) => o.id === form.ownerId);
  const accountsForOwner = accountOptions.filter((a) => !form.ownerId || a.ownerId === form.ownerId);
  return <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
      <Field label="Nombre del inmueble"><input style={inputStyle()} value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Tipo"><select style={inputStyle()} value={form.type || "Local comercial"} onChange={(e) => setForm({ ...form, type: e.target.value })}>{(data.assetTypes || ["Local comercial", "Terreno", "Casa", "Departamento", "Oficina"]).map((x) => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Proyecto relacionado (opcional)"><select style={inputStyle()} value={form.projectId || ""} onChange={(e) => setForm({ ...form, projectId: e.target.value })}><option value="">Sin proyecto / predio independiente</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Propietario del predio"><select style={inputStyle()} value={form.ownerId || ownerOptions[0]?.id || ""} onChange={(e) => { const owner = ownerOptions.find((o) => o.id === e.target.value); setForm({ ...form, ownerId: e.target.value, ownerName: owner?.name || "", depositAccountId: "", depositAccountAlias: "" }); }}>{ownerOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
      <Field label="Cuenta de depósito asignada"><select style={inputStyle()} value={form.depositAccountId || ""} onChange={(e) => { const account = accountOptions.find((a) => a.id === e.target.value); setForm({ ...form, depositAccountId: e.target.value, depositAccountAlias: account?.alias || account?.bank || "" }); }}><option value="">Pendiente asignar / definir en contrato</option>{accountsForOwner.map((a) => <option key={a.id} value={a.id}>{a.alias || a.bank || a.id} · {a.bank || "Banco pendiente"}</option>)}</select></Field>
      <Field label="Agrupación / plaza"><input style={inputStyle()} placeholder="Ej. Plaza Las Vías" value={form.collection || form.assetGroup || ""} onChange={(e) => setForm({ ...form, collection: e.target.value, assetGroup: e.target.value })} /></Field><Field label="Ubicación / zona"><input style={inputStyle()} value={form.location || ""} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
      <Field label="Dirección"><input style={inputStyle()} value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
      <Field label="m²"><input type="number" style={inputStyle()} value={form.area || ""} onChange={(e) => setForm({ ...form, area: e.target.value })} /></Field>
      <Field label="Precio/renta objetivo"><input type="number" style={inputStyle()} value={form.rentalPrice || ""} onChange={(e) => setForm({ ...form, rentalPrice: e.target.value })} /></Field>
      <Field label="Valor catastral"><input type="number" style={inputStyle()} value={form.cadastralValue || ""} onChange={(e) => setForm({ ...form, cadastralValue: e.target.value })} /></Field>
      <Field label="Cédula / clave"><input style={inputStyle()} value={form.cadastralId || ""} onChange={(e) => setForm({ ...form, cadastralId: e.target.value })} /></Field>
      <Field label="Coordenadas"><input style={inputStyle()} placeholder="20.97,-89.62" value={form.coordinates || ""} onChange={(e) => setForm({ ...form, coordinates: e.target.value })} /></Field>
      <Field label="Google Maps"><input style={inputStyle()} value={form.mapsUrl || ""} onChange={(e) => setForm({ ...form, mapsUrl: e.target.value })} /></Field>
      <Field label="Estatus"><select style={inputStyle()} value={form.status || "Disponible"} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>Disponible</option><option>Ocupado</option><option>En desarrollo</option><option>Revisión pendiente</option><option>Mantenimiento</option><option>Reservado</option><option>Inactivo</option></select></Field>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
      <Info label="Propietario seleccionado" value={selectedOwner?.name || form.ownerName || "Pendiente"} />
      <Info label="Regla de depósito" value="La cuenta se confirma en cada contrato; un propietario puede tener varias cuentas." />
      <Info label="Proyecto" value={form.projectId ? data.projects.find((p) => p.id === form.projectId)?.name : "No aplica / opcional"} />
    </div>
    <Field label="Notas / control documental"><textarea style={inputStyle({ minHeight: 80 })} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
    {form.reviewNotes ? <div style={{ padding: 12, borderRadius: 16, background: c.orangeSoft, color: c.orange, fontWeight: 850 }}>Pendiente de revisión: {form.reviewNotes}</div> : null}
    <AttachmentUploader label="Documentos del inmueble" value={form.attachments} folder="arrendamientos/inmuebles" onChange={(attachments) => setForm({ ...form, attachments })} />
    <Button onClick={onSave}>{editing ? "Guardar inmueble" : "Crear inmueble"}</Button>
  </div>;
}

function Rentals({ data, projectMap, tenantMap, assetMap, contractMap, addRecord, updateRecord, showForm, setShowForm, form, setForm, mode }) {
  const [tenantDetail, setTenantDetail] = useState(null);
  const [assetDetail, setAssetDetail] = useState(null);
  const [contractDetail, setContractDetail] = useState(null);
  const [assetView, setAssetView] = useState("tabla");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const [increaseFilter, setIncreaseFilter] = useState("todos");
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState([]);
  const [billingPeriod, setBillingPeriod] = useState(periodLabel(todayIso()));
  const [reportPeriod, setReportPeriod] = useState(periodLabel(todayIso()));
  const [reportTenantId, setReportTenantId] = useState("todos");
  const [reportStatus, setReportStatus] = useState("todos");
  const [predialStatus, setPredialStatus] = useState("todos");
  const charges = filterByStatus((data.rentCharges || []), statusFilter).filter((r) => [tenantName(r, data), assetMap[contractMap[r.contractId]?.assetId]?.name, r.period, r.bankReference].join(" ").toLowerCase().includes(search.toLowerCase()));
  function saveContract() {
    if (!(Number(form.rentBase || 0) > 0)) { alert("Captura la renta base del contrato."); return; }
    if (!form.assetId && !data.assets[0]?.id) { alert("Selecciona un inmueble para el contrato."); return; }
    let tenantId = form.tenantId || data.tenants[0]?.id;
    if (form.newTenantName) {
      tenantId = uid("tenant");
      addRecord("tenants", { id: tenantId, name: form.newTenantName, taxpayerType: form.newTenantTaxpayerType || "Persona moral", fiscalId: form.newTenantFiscalId || "", billingEmail: form.newTenantBillingEmail || "", email: form.newTenantBillingEmail || "", certificateStatus: "Pendiente", status: "Activo" });
    }
    const lastIncreaseDate = form.lastIncreaseDate || form.inpcMonth || todayIso();
    const payload = { folio: form.folio || nextFolio(data, "contracts", "ARR"), tenantId, assetId: form.assetId || data.assets[0]?.id, contractType: form.contractType || "Arrendamiento comercial", rentBase: Number(form.rentBase || 0), maintenancePct: Number(form.maintenancePct || 0), startDate: form.startDate || todayIso(), endDate: form.endDate || todayIso(), paymentDay: Number(form.paymentDay || 10), annualIncreaseBase: form.annualIncreaseBase || "Incremento anual según contrato", inpcMonth: form.inpcMonth || "", lastIncreaseDate, nextIncreaseDate: form.nextIncreaseDate || addMonthsIso(lastIncreaseDate, 12), bank: form.bank || "VEPORMAS", reference: form.reference || "", status: form.status || "Activo", autoInvoice: !!form.autoInvoice, attachments: normalizeAttachments(form.attachments), updatedAt: todayIso() };
    if (form.id) updateRecord("contracts", form.id, payload); else addRecord("contracts", payload);
    setShowForm(null); setForm({});
  }
  function saveAsset() {
    if (!String(form.name || "").trim()) { alert("Captura el nombre del inmueble."); return; }
    const owner = (data.propertyOwners || []).find((o) => o.id === form.ownerId);
    const account = (data.depositAccounts || []).find((a) => a.id === form.depositAccountId);
    const payload = {
      name: form.name || "Inmueble",
      type: form.type || "Local comercial",
      projectId: form.projectId || "",
      area: Number(form.area || 0),
      collection: form.collection || form.assetGroup || assetGroupName(form),
      location: form.location || "",
      address: form.address || "",
      cadastralId: form.cadastralId || "",
      rentalPrice: Number(form.rentalPrice || 0),
      cadastralValue: Number(form.cadastralValue || 0),
      pricePerM2: form.area ? roundMoney(Number(form.rentalPrice || 0) / Number(form.area || 1)) : Number(form.pricePerM2 || 0),
      coordinates: form.coordinates || "",
      mapsUrl: form.mapsUrl || "",
      status: form.status || "Disponible",
      legalStatus: form.legalStatus || form.importStatus || "Pendiente",
      ownerId: form.ownerId || "",
      ownerName: owner?.name || form.ownerName || "",
      depositAccountId: form.depositAccountId || "",
      depositAccountAlias: account?.alias || form.depositAccountAlias || "",
      reviewNotes: form.reviewNotes || "",
      requiresReview: !!form.reviewNotes || form.status === "Revisión pendiente",
      notes: form.notes || "",
      attachments: normalizeAttachments(form.attachments),
      history: [{ id: uid("asset-hist"), date: todayIso(), action: form.id ? "Actualización de inmueble" : "Alta de inmueble", user: firebaseAuth.currentUser?.email || "sistema", comment: form.notes || form.reviewNotes || "Movimiento registrado en expediente del inmueble." }, ...(form.history || [])],
      updatedAt: todayIso(),
    };
    if (form.id) updateRecord("assets", form.id, payload); else addRecord("assets", payload);
    setShowForm(null); setForm({});
  }
  function generateMonthlyCharges(period = billingPeriod) {
    const activeContracts = (data.contracts || []).filter((ct) => (ct.status || "Activo") === "Activo");
    const existingKeys = new Set((data.rentCharges || []).map((ch) => `${ch.contractId}-${ch.period}-${rentChargeLabel(ch)}`));
    let created = 0;
    activeContracts.forEach((ct) => {
      const dueDate = `${period}-${String(ct.paymentDay || 10).padStart(2, "0")}`;
      const rentKey = `${ct.id}-${period}-Renta`;
      if (!existingKeys.has(rentKey)) {
        const rent = Number(ct.rentBase || 0);
        addRecord("rentCharges", { contractId: ct.id, period, chargeType: "Renta", rent, maintenance: 0, vat: roundMoney(rent * 0.16), status: "Pendiente", paidAmount: 0, dueDate, bankReference: ct.reference || "", invoiceStatus: ct.autoInvoice ? "Por emitir" : "Manual", reconciled: false, remindersCount: 0, createdBy: firebaseAuth.currentUser?.email || "sistema" });
        created += 1;
      }
      const maintenance = roundMoney(Number(ct.rentBase || 0) * Number(ct.maintenancePct || 0) / 100);
      const maintenanceKey = `${ct.id}-${period}-Mantenimiento`;
      if (maintenance > 0 && !existingKeys.has(maintenanceKey)) {
        addRecord("rentCharges", { contractId: ct.id, period, chargeType: "Mantenimiento", rent: 0, maintenance, vat: roundMoney(maintenance * 0.16), status: "Pendiente", paidAmount: 0, dueDate, bankReference: ct.reference ? `${ct.reference}-M` : "", invoiceStatus: ct.autoInvoice ? "Por emitir" : "Manual", reconciled: false, remindersCount: 0, createdBy: firebaseAuth.currentUser?.email || "sistema" });
        created += 1;
      }
    });
    if (!created) alert("No se generaron cargos nuevos: el periodo ya existe para los contratos activos.");
  }
  if (mode === "arr_inmuebles") {
    const importedCount = (data.assets || []).filter((a) => a.source?.includes("Relación de Inmuebles") || a.importStatus).length;
    const reviewCount = (data.assets || []).filter((a) => a.requiresReview || a.status === "Revisión pendiente").length;
    const rows = (data.assets || []).filter((a) => [a.name, a.type, a.location, a.address, a.ownerName, a.depositAccountAlias, a.status].join(" ").toLowerCase().includes(search.toLowerCase()));
    return <div style={{ display: "grid", gap: 16 }}>
      <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Inmuebles / predios" helper="Alta y expediente de locales, terrenos, casas, departamentos y oficinas. El proyecto es opcional; propietario y cuenta de depósito se controlan por inmueble/contrato." /><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button onClick={() => { setForm({}); setShowForm(showForm === "asset" ? null : "asset"); }}>Nuevo inmueble</Button></div></div>{showForm === "asset" ? <AssetForm data={data} form={form} setForm={setForm} onSave={saveAsset} editing={!!form.id} /> : null}</Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}><MetricCard label="Inmuebles" value={(data.assets || []).length} tone="primary" /><MetricCard label="Importados" value={importedCount} tone="ok" /><MetricCard label="Por revisar" value={reviewCount} tone={reviewCount ? "warn" : "ok"} /></div>
      <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "end" }}><div><SectionTitle title="Consulta de inmuebles" helper="Usa vista tabla para control operativo o vista mapa real para ubicar predios y abrir su expediente." /></div><div style={{ display: "flex", gap: 8, background: c.soft, padding: 5, borderRadius: 16 }}><Button variant={assetView === "tabla" ? "primary" : "secondary"} style={{ padding: "9px 12px" }} onClick={() => setAssetView("tabla")}>Vista tabla</Button><Button variant={assetView === "mapa" ? "primary" : "secondary"} style={{ padding: "9px 12px" }} onClick={() => setAssetView("mapa")}>Vista mapa real</Button></div></div><div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginTop: 4 }}><Field label="Buscar inmueble"><input style={inputStyle({ maxWidth: 420 })} placeholder="Nombre, tipo, dirección, propietario, cuenta" value={search} onChange={(e) => setSearch(e.target.value)} /></Field><StatusFilter value={statusFilter} onChange={setStatusFilter} options={(data.assets || []).map((a) => a.status)} total={(data.assets || []).length} shown={filterByStatus(rows, statusFilter).length} /><div style={{ marginLeft: "auto" }}><ExportCsvButton filename="inmuebles.csv" rows={filterByStatus(rows, statusFilter).map((a) => ({ Nombre: a.name, Tipo: a.type, Ubicacion: a.location, Direccion: a.address, Propietario: a.ownerName, RentaMensual: a.rentalPrice, Estado: a.status }))} /></div></div></Card>
      {assetView === "mapa" ? <AssetMapView assets={filterByStatus(rows, statusFilter)} onSelect={setAssetDetail} /> : <AssetGroupedTable rows={filterByStatus(rows, statusFilter)} data={data} onOpen={setAssetDetail} onEdit={(asset) => { setForm({ ...asset }); setShowForm("asset"); }} />}
      {assetDetail ? <AssetDrawer asset={assetDetail} data={data} tenantMap={tenantMap} onClose={() => setAssetDetail(null)} onEdit={(asset) => { setForm({ ...asset }); setShowForm("asset"); setAssetDetail(null); }} onOpenContract={(ct) => { setAssetDetail(null); setContractDetail(ct); }} onOpenTenant={(tenant) => { setAssetDetail(null); setTenantDetail(tenant); }} /> : null}
      {tenantDetail ? <TenantDrawer tenant={tenantDetail} data={data} assetMap={assetMap} onClose={() => setTenantDetail(null)} onEdit={(tenant) => { setTenantDetail(null); setShowForm("leaseContract"); setForm({ tenantId: tenant.id }); }} /> : null}
      {contractDetail ? <LeaseContractDrawer contract={contractDetail} data={data} tenantMap={tenantMap} assetMap={assetMap} onClose={() => setContractDetail(null)} onEdit={(ct) => { setContractDetail(null); setForm({ ...ct }); setShowForm("leaseContract"); }} /> : null}
    </div>;
  }
  if (mode === "arr_contratos") {
    const contractRows = (data.contracts || []).filter((ct) => {
      const tenant = tenantMap[ct.tenantId];
      const asset = assetMap[ct.assetId];
      const inc = annualIncreaseInfo(ct);
      const matchesText = [tenant?.name, asset?.name, ct.contractType, ct.reference, ct.status].join(" ").toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "todos" || ct.status === statusFilter;
      const matchesIncrease = increaseFilter === "todos" || inc.status === increaseFilter;
      return matchesText && matchesStatus && matchesIncrease;
    });
    const dueCount = (data.contracts || []).filter((ct) => annualIncreaseInfo(ct).status === "Vencido").length;
    const soonCount = (data.contracts || []).filter((ct) => annualIncreaseInfo(ct).status === "Por vencer").length;
    return <div style={{ display: "grid", gap: 16 }}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <SectionTitle title="Contratos de arrendamiento" helper="Alta de arrendatario y contrato en un solo movimiento. Expediente con pagos, incremento anual, vigencia, anexos y facturación." />
          <Button onClick={() => { setForm({}); setShowForm(showForm === "leaseContract" ? null : "leaseContract"); }}>Nuevo contrato</Button>
        </div>
        {showForm === "leaseContract" ? <RentalContractForm data={data} tenantMap={tenantMap} assetMap={assetMap} form={form} setForm={setForm} onSave={saveContract} editing={!!form.id} /> : null}
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
        <MetricCard label="Incrementos vencidos" value={dueCount} tone={dueCount ? "danger" : "ok"} />
        <MetricCard label="Por vencer ≤45 días" value={soonCount} tone={soonCount ? "warn" : "ok"} />
        <MetricCard label="Contratos activos" value={(data.contracts || []).filter((ct) => ct.status === "Activo").length} tone="primary" />
      </div>
      <Card>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
          <Field label="Buscar"><input style={inputStyle({ width: 280 })} placeholder="Arrendatario, inmueble, referencia" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          <StatusFilter value={statusFilter} onChange={setStatusFilter} options={(data.contracts || []).map((r) => r.status)} total={(data.contracts || []).length} shown={contractRows.length} />
          <Field label="Incremento anual"><select style={inputStyle({ width: 210 })} value={increaseFilter} onChange={(e) => setIncreaseFilter(e.target.value)}><option value="todos">Todos</option><option value="Vencido">Vencidos</option><option value="Por vencer">Por vencer</option><option value="Al día">Al día</option></select></Field>
          <div style={{ marginLeft: "auto" }}><ExportCsvButton filename="contratos-arrendamiento.csv" rows={contractRows.map((r) => ({ Folio: r.folio || r.id, Arrendatario: tenantMap[r.tenantId]?.name || "", Inmueble: assetMap[r.assetId]?.name || "", Renta: r.rentBase, MantenimientoPct: r.maintenancePct, DiaPago: r.paymentDay, Vence: r.endDate, Estado: r.status }))} /></div>
        </div>
        <MiniTable columns={[{ key: "folio", label: "Folio", render: (r) => <span style={{ fontFamily: "monospace", fontSize: 12, color: c.muted }}>{r.folio || "—"}</span> }, { key: "tenantId", label: "Arrendatario", render: (r) => <EntityLink onClick={() => setTenantDetail(tenantMap[r.tenantId])}>{tenantMap[r.tenantId]?.name || "Arrendatario"}</EntityLink> }, { key: "assetId", label: "Inmueble", render: (r) => <EntityLink onClick={() => setAssetDetail(assetMap[r.assetId])}>{assetMap[r.assetId]?.name || "Inmueble"}</EntityLink> }, { key: "rentBase", label: "Renta", render: (r) => money(r.rentBase) }, { key: "maintenancePct", label: "Mantto %", render: (r) => `${r.maintenancePct || 0}%` }, { key: "paymentDay", label: "Día pago" }, { key: "annualIncrease", label: "Incremento anual", render: (r) => { const inc = annualIncreaseInfo(r); return <div><Pill tone={inc.status === "Vencido" ? "danger" : inc.status === "Por vencer" ? "warn" : "ok"}>{inc.status}</Pill><div style={{ color: c.muted, fontSize: 11, marginTop: 4 }}>{inc.nextDate}</div></div>; } }, { key: "endDate", label: "Vence" }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "view", label: "Consultar", render: (r) => <Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => setContractDetail(r)}>Abrir</Button> }, { key: "edit", label: "Editar", render: (r) => <Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => { setForm({ ...r }); setShowForm("leaseContract"); }}>Editar</Button> }]} rows={contractRows} />
      </Card>
      {tenantDetail ? <TenantDrawer tenant={tenantDetail} data={data} assetMap={assetMap} onClose={() => setTenantDetail(null)} onEdit={(tenant) => { setTenantDetail(null); setShowForm("leaseContract"); setForm({ tenantId: tenant.id }); }} /> : null}
      {assetDetail ? <AssetDrawer asset={assetDetail} data={data} tenantMap={tenantMap} onClose={() => setAssetDetail(null)} onEdit={(asset) => { setForm({ ...asset }); setShowForm("asset"); setAssetDetail(null); }} onOpenContract={(ct) => { setAssetDetail(null); setContractDetail(ct); }} onOpenTenant={(tenant) => { setAssetDetail(null); setTenantDetail(tenant); }} /> : null}
      {contractDetail ? <LeaseContractDrawer contract={contractDetail} data={data} tenantMap={tenantMap} assetMap={assetMap} onClose={() => setContractDetail(null)} onEdit={(ct) => { setContractDetail(null); setForm({ ...ct }); setShowForm("leaseContract"); }} /> : null}
    </div>;
  }
  if (mode === "arr_reportes") {
    const reportRows = (data.rentCharges || []).filter((r) => {
      const ct = contractMap[r.contractId];
      const tenantId = ct?.tenantId || "";
      const status = r.status || "Pendiente";
      return (!reportPeriod || r.period === reportPeriod) && (reportTenantId === "todos" || tenantId === reportTenantId) && (reportStatus === "todos" || status === reportStatus);
    });
    const reconciled = reportRows.filter((r) => r.reconciled || r.status === "Conciliado");
    const pending = reportRows.filter((r) => !(r.reconciled || r.status === "Conciliado"));
    const net = reconciled.reduce((a, r) => a + chargeNetAmount(r), 0);
    const taxes = reconciled.reduce((a, r) => a + chargeVatAmount(r), 0);
    const gross = net + taxes;
    const overdue = pending.filter((r) => ["Vencido", "Parcial", "Pendiente"].includes(r.status)).reduce((a, r) => a + Math.max(0, chargeGrossAmount(r) - Number(r.paidAmount || 0)), 0);
    const byGroup = Array.from(reportRows.reduce((map, r) => {
      const asset = assetMap[contractMap[r.contractId]?.assetId];
      const group = assetGroupName(asset || {});
      const prev = map.get(group) || { group, net: 0, taxes: 0, total: 0, pending: 0, count: 0 };
      prev.net += chargeNetAmount(r); prev.taxes += chargeVatAmount(r); prev.total += chargeGrossAmount(r); prev.pending += (r.reconciled || r.status === "Conciliado") ? 0 : Math.max(0, chargeGrossAmount(r) - Number(r.paidAmount || 0)); prev.count += 1;
      map.set(group, prev); return map;
    }, new Map()).values());
    const overdueIncreases = (data.contracts || []).filter((ct) => annualIncreaseInfo(ct).status === "Vencido");
    const soonIncreases = (data.contracts || []).filter((ct) => annualIncreaseInfo(ct).status === "Por vencer");
    return <div style={{ display: "grid", gap: 16 }}>
      <Card><SectionTitle title="Reportes de arrendamientos" helper="Reporte mensual exportable. Solo se reconoce como cobrado lo conciliado con banco; lo pendiente queda como adeudo." />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
          <Field label="Mes"><input type="month" style={inputStyle({ width: 180 })} value={reportPeriod} onChange={(e) => setReportPeriod(e.target.value)} /></Field>
          <Field label="Arrendatario"><select style={inputStyle({ width: 260 })} value={reportTenantId} onChange={(e) => setReportTenantId(e.target.value)}><option value="todos">Todos</option>{(data.tenants || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field label="Estado"><select style={inputStyle({ width: 200 })} value={reportStatus} onChange={(e) => setReportStatus(e.target.value)}><option value="todos">Todos</option>{Array.from(new Set((data.rentCharges || []).map((r) => r.status || "Pendiente"))).map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Button variant="secondary" onClick={() => window.print()}>Exportar PDF / imprimir</Button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
          <MetricCard label="Ingresos conciliados" value={money(gross)} tone="ok" />
          <MetricCard label="Importe neto" value={money(net)} tone="primary" />
          <MetricCard label="Impuestos cobrados" value={money(taxes)} tone="warn" />
          <MetricCard label="Adeudos vencidos/no cobrados" value={money(overdue)} tone={overdue > 0 ? "danger" : "ok"} />
        </div>
      </Card>
      <Card><SectionTitle title="Partidas por plaza / agrupación" helper="Totales por plaza, propiedad o grupo de inmuebles." /><MiniTable columns={[{ key: "group", label: "Plaza / grupo" }, { key: "count", label: "Movs." }, { key: "net", label: "Neto", render: (r) => money(r.net) }, { key: "taxes", label: "Impuestos", render: (r) => money(r.taxes) }, { key: "total", label: "Total", render: (r) => money(r.total) }, { key: "pending", label: "Adeudo", render: (r) => money(r.pending) }]} rows={byGroup} /></Card>
      <Card><SectionTitle title="Incrementos anuales por atender" helper="Vista rápida para aplicar incrementos antes de facturar o renovar." /><MiniTable columns={[{ key: "tenant", label: "Arrendatario", render: (r) => tenantMap[r.tenantId]?.name }, { key: "asset", label: "Inmueble", render: (r) => assetMap[r.assetId]?.name }, { key: "rentBase", label: "Renta actual", render: (r) => money(r.rentBase) }, { key: "next", label: "Próximo incremento", render: (r) => annualIncreaseInfo(r).nextDate }, { key: "status", label: "Estado", render: (r) => <Pill tone={annualIncreaseInfo(r).status === "Vencido" ? "danger" : "warn"}>{annualIncreaseInfo(r).status}</Pill> }]} rows={[...overdueIncreases, ...soonIncreases]} /></Card>
      <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Detalle de cobranza del mes" helper="Base para anexar al reporte PDF." /><ExportCsvButton filename="reporte-cobranza-mes.csv" rows={reportRows.map((r) => ({ Arrendatario: tenantName(r, data), Inmueble: assetMap[contractMap[r.contractId]?.assetId]?.name || "", Tipo: rentChargeLabel(r), Periodo: r.period, Neto: chargeNetAmount(r), IVA: chargeVatAmount(r), Total: chargeGrossAmount(r), Pagado: r.paidAmount, Estado: r.status }))} /></div><MiniTable columns={[{ key: "contractId", label: "Arrendatario", render: (r) => tenantName(r, data) }, { key: "asset", label: "Inmueble", render: (r) => assetMap[contractMap[r.contractId]?.assetId]?.name || "—" }, { key: "chargeType", label: "Tipo", render: (r) => rentChargeLabel(r) }, { key: "period", label: "Periodo" }, { key: "net", label: "Neto", render: (r) => money(chargeNetAmount(r)) }, { key: "vat", label: "IVA", render: (r) => money(chargeVatAmount(r)) }, { key: "total", label: "Total", render: (r) => money(chargeGrossAmount(r)) }, { key: "paidAmount", label: "Pagado", render: (r) => money(r.paidAmount) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "bankReference", label: "Referencia" }]} rows={reportRows} /></Card>
    </div>;
  }
  if (mode === "arr_predial") {
    const predialRows = (data.propertyTaxes || []).filter((r) => {
      const asset = assetMap[r.assetId];
      const matchesText = [asset?.name, asset?.location, asset?.address, r.year, r.status, r.bankReference].join(" ").toLowerCase().includes(search.toLowerCase());
      const matchesStatus = predialStatus === "todos" || (r.status || "Pendiente") === predialStatus;
      return matchesText && matchesStatus;
    });
    const overdue = predialRows.filter((r) => (r.status || "Pendiente") !== "Pagado" && r.dueDate && r.dueDate < todayIso()).length;
    return <div style={{ display: "grid", gap: 16 }}>
      <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Pago de predial" helper="Control por inmueble. El objetivo es detectar vencimientos, anexar comprobante y evitar riesgos por predios sin predial al día." /><Button onClick={() => setShowForm(showForm === "predial" ? null : "predial")}>Nuevo predial</Button></div>
        {showForm === "predial" ? <div style={{ display: "grid", gap: 10, marginTop: 12 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Inmueble"><select style={inputStyle()} value={form.assetId || data.assets[0]?.id || ""} onChange={(e) => setForm({ ...form, assetId: e.target.value })}>{(data.assets || []).map((a) => <option key={a.id} value={a.id}>{assetGroupName(a)} · {a.name}</option>)}</select></Field><Field label="Año"><input style={inputStyle()} value={form.year || new Date().getFullYear()} onChange={(e) => setForm({ ...form, year: e.target.value })} /></Field><Field label="Vencimiento"><input type="date" style={inputStyle()} value={form.dueDate || todayIso()} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field><Field label="Importe"><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Estado"><select style={inputStyle()} value={form.status || "Pendiente"} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>Pendiente</option><option>Pagado</option><option>Vencido</option><option>En revisión</option></select></Field><Field label="Referencia"><input style={inputStyle()} value={form.bankReference || ""} onChange={(e) => setForm({ ...form, bankReference: e.target.value })} /></Field></div><AttachmentUploader label="Comprobante predial" value={form.attachments} folder="arrendamientos/predial" onChange={(attachments) => setForm({ ...form, attachments })} /><Button onClick={() => { if (!(Number(form.amount || 0) > 0)) { alert("Captura el importe del predial."); return; } addRecord("propertyTaxes", { folio: nextFolio(data, "propertyTaxes", "PRE"), assetId: form.assetId || data.assets[0]?.id, year: form.year || String(new Date().getFullYear()), dueDate: form.dueDate || todayIso(), amount: Number(form.amount || 0), status: form.status || "Pendiente", bankReference: form.bankReference || "", paidAt: form.status === "Pagado" ? todayIso() : "", attachments: normalizeAttachments(form.attachments), createdBy: firebaseAuth.currentUser?.email || "sistema" }); }}>Guardar predial</Button></div> : null}
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}><MetricCard label="Registros" value={predialRows.length} tone="primary" /><MetricCard label="Vencidos" value={overdue} tone={overdue ? "danger" : "ok"} /><MetricCard label="Pagados" value={predialRows.filter((r) => r.status === "Pagado").length} tone="ok" /></div>
      <Card><div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}><Field label="Buscar"><input style={inputStyle({ width: 280 })} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Inmueble, año, referencia" /></Field><Field label="Estado"><select style={inputStyle({ width: 180 })} value={predialStatus} onChange={(e) => setPredialStatus(e.target.value)}><option value="todos">Todos</option><option>Pendiente</option><option>Pagado</option><option>Vencido</option><option>En revisión</option></select></Field><div style={{ marginLeft: "auto" }}><ExportCsvButton filename="predial.csv" rows={predialRows.map((r) => ({ Folio: r.folio || r.id, Inmueble: assetMap[r.assetId]?.name || "", Año: r.year, Importe: r.amount, Vence: r.dueDate, Estado: r.status || "Pendiente" }))} /></div></div><MiniTable columns={[{ key: "folio", label: "Folio", render: (r) => <span style={{ fontFamily: "monospace", fontSize: 12, color: c.muted }}>{r.folio || "—"}</span> }, { key: "assetId", label: "Inmueble", render: (r) => <EntityLink onClick={() => setAssetDetail(assetMap[r.assetId])}>{assetMap[r.assetId]?.name || "Inmueble"}</EntityLink> }, { key: "group", label: "Plaza / grupo", render: (r) => assetGroupName(assetMap[r.assetId] || {}) }, { key: "year", label: "Año" }, { key: "amount", label: "Importe", render: (r) => money(r.amount) }, { key: "dueDate", label: "Vence" }, { key: "status", label: "Estado", render: (r) => <Pill tone={r.status === "Pagado" ? "ok" : r.dueDate < todayIso() ? "danger" : "warn"}>{r.status || "Pendiente"}</Pill> }, { key: "bankReference", label: "Referencia" }, { key: "attachments", label: "Comprobante", render: (r) => <AttachmentViewer value={r.attachments} /> }, { key: "actions", label: "Acciones", render: (r) => <ActionCell><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("propertyTaxes", r.id, { status: "Pagado", paidAt: todayIso(), updatedBy: firebaseAuth.currentUser?.email || "sistema" })}>Marcar pagado</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("propertyTaxes", r.id, { status: "Vencido" })}>Vencido</Button></ActionCell> }]} rows={predialRows} /></Card>
      {assetDetail ? <AssetDrawer asset={assetDetail} data={data} tenantMap={tenantMap} onClose={() => setAssetDetail(null)} onEdit={(asset) => { setForm({ ...asset }); setShowForm("asset"); setAssetDetail(null); }} onOpenContract={(ct) => { setAssetDetail(null); setContractDetail(ct); }} onOpenTenant={(tenant) => { setAssetDetail(null); setTenantDetail(tenant); }} /> : null}
    </div>;
  }
  if (mode === "arr_conciliacion") return <div style={{ display: "grid", gap: 16 }}><Card><SectionTitle title="Conciliación bancaria de rentas" helper="Solo al conciliar un cargo de renta o mantenimiento puede entrar al reporte mensual de rentas cobradas." /><div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}><StatusFilter value={statusFilter} onChange={setStatusFilter} options={(data.rentCharges || []).map((r) => r.status)} total={(data.rentCharges || []).length} shown={charges.length} /><div style={{ marginLeft: "auto" }}><ExportCsvButton filename="conciliacion-rentas.csv" rows={charges.map((r) => ({ Arrendatario: tenantName(r, data), Inmueble: assetMap[contractMap[r.contractId]?.assetId]?.name || "", Tipo: rentChargeLabel(r), Periodo: r.period, Esperado: chargeGrossAmount(r), Pagado: r.paidAmount, Referencia: r.bankReference, Conciliado: r.reconciled || r.status === "Conciliado" ? "Sí" : "No" }))} /></div></div></Card><Card><MiniTable columns={[{ key: "contractId", label: "Arrendatario", render: (r) => <EntityLink onClick={() => setTenantDetail(tenantMap[contractMap[r.contractId]?.tenantId])}>{tenantName(r, data)}</EntityLink> }, { key: "asset", label: "Inmueble", render: (r) => <EntityLink onClick={() => setAssetDetail(assetMap[contractMap[r.contractId]?.assetId])}>{assetMap[contractMap[r.contractId]?.assetId]?.name || "—"}</EntityLink> }, { key: "chargeType", label: "Tipo", render: (r) => rentChargeLabel(r) }, { key: "period", label: "Periodo" }, { key: "expected", label: "Esperado", render: (r) => money(chargeGrossAmount(r)) }, { key: "paidAmount", label: "Pagado", render: (r) => money(r.paidAmount) }, { key: "bankReference", label: "Referencia" }, { key: "reconciled", label: "Conciliado", render: (r) => r.reconciled || r.status === "Conciliado" ? <Pill tone="ok">Sí</Pill> : <Pill tone="warn">No</Pill> }, { key: "actions", label: "Acciones", render: (r) => <Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("rentCharges", r.id, { status: "Conciliado", reconciled: true, paidAmount: Number(r.paidAmount || 0) || chargeGrossAmount(r), reconciledAt: todayIso(), reconciledBy: firebaseAuth.currentUser?.email || "sistema" })}>Conciliar</Button> }]} rows={charges} /></Card>{tenantDetail ? <TenantDrawer tenant={tenantDetail} data={data} assetMap={assetMap} onClose={() => setTenantDetail(null)} onEdit={(tenant) => { setTenantDetail(null); setShowForm("leaseContract"); setForm({ tenantId: tenant.id }); }} /> : null}{assetDetail ? <AssetDrawer asset={assetDetail} data={data} tenantMap={tenantMap} onClose={() => setAssetDetail(null)} onEdit={(asset) => { setForm({ ...asset }); setShowForm("asset"); setAssetDetail(null); }} onOpenContract={(ct) => { setAssetDetail(null); setContractDetail(ct); }} onOpenTenant={(tenant) => { setAssetDetail(null); setTenantDetail(tenant); }} /> : null}</div>;
  if (mode === "arr_facturacion") {
    const invoiceRows = (data.rentCharges || []).filter((r) => [tenantName(r, data), assetMap[contractMap[r.contractId]?.assetId]?.name, r.period, r.invoiceStatus, r.status].join(" ").toLowerCase().includes(search.toLowerCase()));
    const selectedRows = invoiceRows.filter((r) => selectedInvoiceIds.includes(r.id));
    const setInvoicePatch = (ids, patch) => ids.forEach((id) => updateRecord("rentCharges", id, patch));
    const allSelected = invoiceRows.length > 0 && invoiceRows.every((r) => selectedInvoiceIds.includes(r.id));
    const toggleAll = () => setSelectedInvoiceIds(allSelected ? [] : invoiceRows.map((r) => r.id));
    return <div style={{ display: "grid", gap: 16 }}>
      <Card>
        <SectionTitle title="Facturación de rentas" helper="Emisión manual, selección por lote y preparación para API/servicio de facturación. La factura queda ligada al cargo mensual y al contrato." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          <Info label="Proveedor/API" value={data.invoiceApiConfig?.provider || "Pendiente conectar"} />
          <Info label="Modo" value={data.invoiceApiConfig?.mode || "Manual / API preparada"} />
          <Info label="Programación" value={data.invoiceApiConfig?.autoSend ? `Día ${data.invoiceApiConfig?.scheduleDay || 1}` : "Manual o lote"} />
          <Info label="Seleccionadas" value={`${selectedRows.length} factura(s)`} />
        </div>
      </Card>
      <Card>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
          <Field label="Buscar"><input style={inputStyle({ width: 290 })} placeholder="Arrendatario, inmueble, periodo, factura" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          <StatusFilter value={statusFilter} onChange={setStatusFilter} options={(data.rentCharges || []).map((r) => r.invoiceStatus || "Pendiente")} total={(data.rentCharges || []).length} shown={invoiceRows.filter((r) => statusFilter === "todos" || (r.invoiceStatus || "Pendiente") === statusFilter).length} />
          <Button variant="secondary" onClick={toggleAll}>{allSelected ? "Quitar selección" : "Seleccionar visibles"}</Button>
          <Button disabled={!selectedRows.length} help="Marca como Emitida la factura de todos los cargos seleccionados." onClick={() => setInvoicePatch(selectedInvoiceIds, { invoiceStatus: "Emitida", invoicedAt: todayIso(), invoiceLog: [invoiceActionLog("Emisión por lote"), ...(selectedRows[0]?.invoiceLog || [])] })}>Emitir lote</Button>
          <Button disabled={!selectedRows.length} variant="secondary" help="Marca como Enviada la factura a los arrendatarios seleccionados." onClick={() => setInvoicePatch(selectedInvoiceIds, { invoiceStatus: "Enviada", invoiceSentAt: todayIso(), invoiceDelivery: "Correo programado/manual" })}>Enviar lote</Button>
          <Button disabled={!selectedRows.length} variant="secondary" help="Deja la factura marcada para enviarse después, sin enviarla todavía." onClick={() => setInvoicePatch(selectedInvoiceIds, { invoiceStatus: "Programada", invoiceScheduledAt: todayIso() })}>Programar envío</Button>
          <div style={{ marginLeft: "auto" }}><ExportCsvButton filename="facturacion-rentas.csv" rows={invoiceRows.map((r) => ({ Arrendatario: tenantName(r, data), Inmueble: assetMap[contractMap[r.contractId]?.assetId]?.name || "", Periodo: r.period, Importe: rentChargeTotal(r), Factura: r.invoiceStatus || "Pendiente", Cobranza: r.status }))} /></div>
        </div>
        <MiniTable columns={[{ key: "select", label: "Sel.", sortable: false, render: (r) => <input type="checkbox" checked={selectedInvoiceIds.includes(r.id)} onChange={(e) => setSelectedInvoiceIds((prev) => e.target.checked ? [...new Set([...prev, r.id])] : prev.filter((id) => id !== r.id))} /> }, { key: "contractId", label: "Arrendatario", render: (r) => tenantName(r, data) }, { key: "asset", label: "Inmueble", render: (r) => assetMap[contractMap[r.contractId]?.assetId]?.name || "—" }, { key: "period", label: "Periodo" }, { key: "total", label: "Importe", render: (r) => money(rentChargeTotal(r)) }, { key: "invoiceStatus", label: "Factura", render: (r) => <Pill tone={r.invoiceStatus === "Emitida" || r.invoiceStatus === "Enviada" ? "ok" : r.invoiceStatus === "Programada" ? "warn" : "primary"}>{r.invoiceStatus || "Pendiente"}</Pill> }, { key: "status", label: "Cobranza", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "actions", label: "Acciones", sortable: false, render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("rentCharges", r.id, { invoiceStatus: "Emitida", invoicedAt: todayIso(), invoiceLog: [invoiceActionLog("Emisión manual"), ...(r.invoiceLog || [])] })}>Emitir</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("rentCharges", r.id, { invoiceStatus: "Enviada", invoiceSentAt: todayIso(), invoiceDelivery: "Correo manual" })}>Enviar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("rentCharges", r.id, { invoiceStatus: "Programada", invoiceScheduledAt: todayIso() })}>Programar</Button></ActionCell> }]} rows={invoiceRows.filter((r) => statusFilter === "todos" || (r.invoiceStatus || "Pendiente") === statusFilter)} />
      </Card>
    </div>;
  }
  const monthRows = (data.rentCharges || []).filter((r) => r.period === billingPeriod).filter((r) => [tenantName(r, data), assetMap[contractMap[r.contractId]?.assetId]?.name, r.period, r.bankReference, rentChargeLabel(r)].join(" ").toLowerCase().includes(search.toLowerCase()));
  const cobranzaRows = filterByStatus(monthRows, statusFilter);
  const monthNet = monthRows.reduce((a, r) => a + chargeNetAmount(r), 0);
  const monthTaxes = monthRows.reduce((a, r) => a + chargeVatAmount(r), 0);
  const monthPaid = monthRows.reduce((a, r) => a + Number(r.paidAmount || 0), 0);
  const monthPending = monthRows.reduce((a, r) => a + Math.max(0, chargeGrossAmount(r) - Number(r.paidAmount || 0)), 0);
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "end" }}><SectionTitle title="Cobranza de rentas" helper="Genera cada mes los cargos de contratos activos. Renta y mantenimiento son movimientos separados porque normalmente llevan facturas diferentes." /><div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}><Field label="Mes de cobranza"><input type="month" style={inputStyle({ width: 170 })} value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)} /></Field><Button onClick={() => generateMonthlyCharges(billingPeriod)}>Generar mes completo</Button><Button variant="secondary" onClick={() => setShowForm(showForm === "rent" ? null : "rent")}>Cargo manual</Button></div></div>
      {showForm === "rent" ? <div style={{ display: "grid", gap: 10, marginTop: 12 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Contrato"><select style={inputStyle()} value={form.contractId || "r1"} onChange={(e) => setForm({ ...form, contractId: e.target.value })}>{data.contracts.map((r) => <option key={r.id} value={r.id}>{tenantMap[r.tenantId]?.name} · {assetMap[r.assetId]?.name}</option>)}</select></Field><Field label="Periodo"><input type="month" style={inputStyle()} value={form.period || billingPeriod} onChange={(e) => setForm({ ...form, period: e.target.value })} /></Field><Field label="Tipo"><select style={inputStyle()} value={form.chargeType || "Renta"} onChange={(e) => setForm({ ...form, chargeType: e.target.value })}><option>Renta</option><option>Mantenimiento</option><option>Otro cargo</option></select></Field><Field label="Importe neto"><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field></div><Button onClick={() => { const ct = data.contracts.find((x) => x.id === (form.contractId || "r1")); const amount = Number(form.amount || (form.chargeType === "Mantenimiento" ? Number(ct?.rentBase || 0) * Number(ct?.maintenancePct || 0) / 100 : ct?.rentBase || 0)); const type = form.chargeType || "Renta"; addRecord("rentCharges", { contractId: ct?.id || "r1", period: form.period || billingPeriod, chargeType: type, rent: type === "Renta" ? amount : 0, maintenance: type === "Mantenimiento" ? amount : 0, otherCharges: type === "Otro cargo" ? amount : 0, vat: roundMoney(amount * 0.16), status: "Pendiente", paidAmount: 0, dueDate: `${form.period || billingPeriod}-${String(ct?.paymentDay || 10).padStart(2, "0")}`, bankReference: type === "Mantenimiento" && ct?.reference ? `${ct.reference}-M` : ct?.reference || "", invoiceStatus: ct?.autoInvoice ? "Por emitir" : "Manual", reconciled: false, remindersCount: 0, createdBy: firebaseAuth.currentUser?.email || "sistema" }); }}>Generar cargo</Button></div> : null}
    </Card>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}><MetricCard label="Facturado neto" value={money(monthNet)} tone="primary" /><MetricCard label="IVA / impuestos" value={money(monthTaxes)} tone="warn" /><MetricCard label="Pagado" value={money(monthPaid)} tone="ok" /><MetricCard label="Por cobrar" value={money(monthPending)} tone={monthPending > 0 ? "danger" : "ok"} /></div>
    <Card><SectionTitle title="Seguimiento de cobranza mensual" helper="Desde aquí se emite factura, se envía aviso, se registra recordatorio y se marca vencido/conciliado." /><div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}><Field label="Buscar"><input style={inputStyle({ width: 260 })} placeholder="Arrendatario, inmueble, periodo, referencia" value={search} onChange={(e) => setSearch(e.target.value)} /></Field><StatusFilter value={statusFilter} onChange={setStatusFilter} options={(data.rentCharges || []).map((r) => r.status)} total={monthRows.length} shown={cobranzaRows.length} /><div style={{ marginLeft: "auto" }}><ExportCsvButton filename="cobranza-rentas.csv" rows={cobranzaRows.map((r) => ({ Cliente: tenantName(r, data), Inmueble: assetMap[contractMap[r.contractId]?.assetId]?.name || "", Tipo: rentChargeLabel(r), Periodo: r.period, Total: chargeGrossAmount(r), Pagado: r.paidAmount, Estado: r.status }))} /></div></div><MiniTable columns={[{ key: "contractId", label: "Cliente", render: (r) => <EntityLink onClick={() => setTenantDetail(tenantMap[contractMap[r.contractId]?.tenantId])}>{tenantName(r, data)}</EntityLink> }, { key: "asset", label: "Inmueble", render: (r) => <EntityLink onClick={() => setAssetDetail(assetMap[contractMap[r.contractId]?.assetId])}>{assetMap[contractMap[r.contractId]?.assetId]?.name}</EntityLink> }, { key: "chargeType", label: "Tipo", render: (r) => <Pill tone={rentChargeLabel(r) === "Mantenimiento" ? "warn" : "primary"}>{rentChargeLabel(r)}</Pill> }, { key: "period", label: "Periodo" }, { key: "net", label: "Neto", render: (r) => money(chargeNetAmount(r)) }, { key: "vat", label: "IVA", render: (r) => money(chargeVatAmount(r)) }, { key: "total", label: "Total", render: (r) => money(chargeGrossAmount(r)) }, { key: "paidAmount", label: "Pagado", render: (r) => money(r.paidAmount) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "invoiceStatus", label: "Factura" }, { key: "reminders", label: "Avisos", render: (r) => `${r.remindersCount || 0}` }, { key: "actions", label: "Acciones", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("rentCharges", r.id, { invoiceStatus: "Emitida", invoicedAt: todayIso(), invoiceLog: [invoiceActionLog("Emisión desde cobranza"), ...(r.invoiceLog || [])] })}>Factura</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("rentCharges", r.id, { lastReminderAt: todayIso(), remindersCount: Number(r.remindersCount || 0) + 1, reminderChannel: "Correo/WhatsApp preparado" })}>Recordatorio</Button><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("rentCharges", r.id, { status: "Pagado", paidAmount: chargeGrossAmount(r), invoiceStatus: r.invoiceStatus || "Emitida" })}>Registrar pago</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("rentCharges", r.id, { status: "Vencido" })}>Vencido</Button></div> }]} rows={cobranzaRows} /></Card>
    <Card><SectionTitle title="Buenas prácticas activas" helper="Flujo sugerido de cobranza recurrente." /><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}><Info label="1. Generación mensual" value="Un cargo de renta y otro de mantenimiento si aplica." /><Info label="2. Facturación" value="Manual, por lote o automática al día pactado." /><Info label="3. Notificación" value="Correo/WhatsApp al cliente y recordatorios si no concilia." /><Info label="4. Conciliación" value="Solo conciliado entra al reporte de rentas cobradas." /></div></Card>
    {tenantDetail ? <TenantDrawer tenant={tenantDetail} data={data} assetMap={assetMap} onClose={() => setTenantDetail(null)} onEdit={(tenant) => { setTenantDetail(null); setShowForm("leaseContract"); setForm({ tenantId: tenant.id }); }} /> : null}
    {assetDetail ? <AssetDrawer asset={assetDetail} data={data} tenantMap={tenantMap} onClose={() => setAssetDetail(null)} onEdit={(asset) => { setForm({ ...asset }); setShowForm("asset"); setAssetDetail(null); }} onOpenContract={(ct) => { setAssetDetail(null); setContractDetail(ct); }} onOpenTenant={(tenant) => { setAssetDetail(null); setTenantDetail(tenant); }} /> : null}
    {contractDetail ? <LeaseContractDrawer contract={contractDetail} data={data} tenantMap={tenantMap} assetMap={assetMap} onClose={() => setContractDetail(null)} onEdit={(ct) => { setContractDetail(null); setForm({ ...ct }); setShowForm("leaseContract"); }} /> : null}
  </div>;

}

function PermitDrawer({ permit, data, projectMap, onClose, onSave }) {
  const statuses = ["No iniciado", "Preparando documentos", "Ingresado", "En revisión", "Observado", "En corrección", "Aprobado", "Rechazado", "Vencido", "Cerrado"];
  const [draft, setDraft] = useState(() => ({
    status: permit?.status || "No iniciado",
    owner: permit?.owner || "",
    priority: permit?.priority || "Media",
    dueDate: permit?.dueDate || todayIso(),
    nextAction: permit?.nextAction || "",
    comment: "",
    attachments: normalizeAttachments(permit?.attachments),
  }));
  if (!permit) return null;
  const history = Array.isArray(permit.history) ? permit.history : [];
  function saveChange() {
    if (!draft.comment && draft.status !== permit.status) {
      alert("Agrega un comentario para dejar rastro del cambio de estatus.");
      return;
    }
    const entry = {
      id: uid("ph"),
      date: new Date().toISOString(),
      fromStatus: permit.status || "No iniciado",
      toStatus: draft.status,
      user: firebaseAuth.currentUser?.email || draft.owner || "usuario",
      comment: draft.comment || "Actualización de seguimiento.",
      nextAction: draft.nextAction || "Sin siguiente acción definida",
      attachments: normalizeAttachments(draft.attachments),
    };
    onSave(permit.id, {
      status: draft.status,
      owner: draft.owner,
      priority: draft.priority,
      dueDate: draft.dueDate,
      nextAction: draft.nextAction,
      attachments: normalizeAttachments(draft.attachments),
      lastComment: entry.comment,
      lastStatusChangeAt: entry.date,
      history: [entry, ...history],
    });
    onClose();
  }
  return <div style={{ position: "fixed", inset: 0, zIndex: 2147483641, pointerEvents: "none" }}>
    <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,.14)", backdropFilter: "blur(2px)", pointerEvents: "auto" }} onClick={onClose} />
    <aside style={{ position: "absolute", right: 18, top: 18, bottom: 18, width: "min(780px, calc(100vw - 36px))", background: "rgba(255,255,255,.98)", border: `1px solid ${c.border}`, borderRadius: 28, boxShadow: "0 24px 80px rgba(0,0,0,.18)", overflow: "hidden", pointerEvents: "auto", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <header style={{ padding: 20, borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div><Pill tone="primary">Expediente de trámite</Pill><h2 style={{ margin: "10px 0 4px", fontSize: 23 }}>{permit.name}</h2><div style={{ color: c.muted, fontSize: 13 }}>{projectMap[permit.projectId]?.name || permit.projectId} · {permit.agency || "Dependencia pendiente"}</div></div>
        <button onClick={onClose} style={{ border: 0, background: c.soft, borderRadius: 14, width: 40, height: 40, cursor: "pointer", fontWeight: 950 }}>×</button>
      </header>
      <main style={{ padding: 20, overflow: "auto", display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
          <Info label="Estado actual" value={permit.status || "No iniciado"} />
          <Info label="Responsable" value={permit.owner || "Pendiente"} />
          <Info label="Fecha compromiso" value={permit.dueDate || "Pendiente"} />
          <Info label="Prioridad" value={permit.priority || "Media"} />
        </div>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Información del trámite" helper="La información base viene de Catálogos y reglas. Aquí solo se da seguimiento operativo." />
          <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
            <div><b>Etapa:</b> {permit.stage || permit.group || "Sin etapa"}</div>
            <div><b>Dependencia:</b> {permit.agency || "Pendiente"}</div>
            <div><b>Documentos requeridos:</b> {permit.documentsText || permit.documents || "Sin documentos definidos"}</div>
            <div><b>Siguiente acción actual:</b> {permit.nextAction || "Sin siguiente acción"}</div>
          </div>
        </Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Registrar avance" helper="El estatus no se modifica directo desde la tabla. Guarda cada movimiento para conservar historial." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
            <Field label="Nuevo estatus"><select style={inputStyle()} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>{statuses.map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Responsable"><input style={inputStyle()} value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} /></Field>
            <Field label="Prioridad"><select style={inputStyle()} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}><option>Alta</option><option>Media</option><option>Baja</option></select></Field>
            <Field label="Fecha compromiso"><input type="date" style={inputStyle()} value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} /></Field>
          </div>
          <Field label="Siguiente acción"><textarea style={inputStyle({ minHeight: 70 })} value={draft.nextAction} onChange={(e) => setDraft({ ...draft, nextAction: e.target.value })} /></Field>
          <Field label="Comentario obligatorio para historial"><textarea style={inputStyle({ minHeight: 80 })} placeholder="Ej. Se ingresó expediente, quedó observado por plano faltante, se adjunta oficio, etc." value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} /></Field>
          <AttachmentUploader label="Documentos / evidencia del trámite" value={draft.attachments} folder="tramites/expedientes" onChange={(attachments) => setDraft({ ...draft, attachments })} />
        </Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Historial del trámite" helper="Bitácora completa de cambios, comentarios y documentos." />
          <div style={{ display: "grid", gap: 9 }}>{history.length ? history.map((h) => <div key={h.id || h.date} style={{ padding: 12, borderRadius: 16, border: `1px solid ${c.border}`, background: c.soft }}><div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><Pill tone="primary">{h.fromStatus || "—"} → {h.toStatus || h.status}</Pill><b>{h.user || "Usuario"}</b><span style={{ color: c.muted, fontSize: 12 }}>{String(h.date || "").slice(0, 16).replace("T", " ")}</span></div><div style={{ marginTop: 8 }}>{h.comment || "Sin comentario"}</div>{h.nextAction ? <div style={{ color: c.muted, fontSize: 12, marginTop: 4 }}><b>Siguiente acción:</b> {h.nextAction}</div> : null}{attachmentCount(h.attachments) ? <div style={{ marginTop: 8 }}><AttachmentViewer value={h.attachments} /></div> : null}</div>) : <div style={{ color: c.muted }}>Sin historial.</div>}</div>
        </Card>
      </main>
      <footer style={{ padding: 16, borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button onClick={saveChange}>Guardar avance</Button></footer>
    </aside>
  </div>;
}

function Permits({ data, projectMap, rows, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const [projectId, setProjectId] = useState(data.projects[0]?.id || "arenna");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const [selectedPermit, setSelectedPermit] = useState(null);
  const { confirm } = usePrompt();
  const projectRows = (data.permits || []).filter((r) => r.projectId === projectId);
  const textRows = projectRows.filter((r) => [r.name, r.agency, r.owner, r.nextAction, r.stage, r.status].join(" ").toLowerCase().includes(search.toLowerCase()));
  const displayedRows = filterByStatus(textRows, statusFilter);
  const activeTemplates = (data.permitTemplates || defaultPermitTemplates).filter((t) => (t.status || "Activo") !== "Inactivo").sort((a,b) => Number(a.order || 999) - Number(b.order || 999));
  const missingTemplates = activeTemplates.filter((tpl) => !projectRows.some((p) => p.templateId === tpl.id || p.name === tpl.name));
  async function preloadProjectPermits() {
    if (!missingTemplates.length) { alert("Este proyecto ya tiene cargados los trámites del catálogo."); return; }
    const ok = await confirm({ title: "Precargar trámites", message: `Se crearán ${missingTemplates.length} trámite(s) para ${projectMap[projectId]?.name || projectId}.`, confirmLabel: "Precargar" });
    if (!ok) return;
    missingTemplates.forEach((tpl) => addRecord("permits", {
      folio: nextFolio(data, "permits", "TR"),
      projectId,
      templateId: tpl.id,
      name: tpl.name,
      stage: tpl.stage || "General",
      agency: tpl.agency || "Dependencia",
      status: "No iniciado",
      priority: tpl.defaultPriority || "Media",
      owner: tpl.defaultOwner || "Responsable",
      nextAction: tpl.initialAction || "Definir siguiente acción",
      dueDate: todayIso(),
      documents: tpl.documents || "",
      documentsText: tpl.documents || "",
      attachments: [],
      history: [{ id: uid("ph"), date: new Date().toISOString(), fromStatus: "—", toStatus: "No iniciado", user: firebaseAuth.currentUser?.email || "sistema", comment: "Trámite precargado desde Catálogos y reglas.", nextAction: tpl.initialAction || "Definir siguiente acción", attachments: [] }],
    }));
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Trámites por proyecto" helper="Los trámites se precargan desde Catálogos y reglas. Aquí solo se da seguimiento, se registran avances y se conserva historial." /><Button variant="secondary" help="Crea automáticamente los trámites del catálogo que todavía no existen para este proyecto." onClick={preloadProjectPermits}>Precargar trámites del catálogo</Button></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, marginTop: 10 }}>
        <Field label="Proyecto"><select style={inputStyle()} value={projectId} onChange={(e) => setProjectId(e.target.value)}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Buscar"><input style={inputStyle()} placeholder="Trámite, dependencia, responsable, comentario" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
      </div>
    </Card>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}><MetricCard label="Trámites del proyecto" value={projectRows.length} tone="primary" /><MetricCard label="Pendientes" value={projectRows.filter((r) => !["Aprobado","Cerrado"].includes(r.status)).length} tone="warn" /><MetricCard label="Del catálogo por cargar" value={missingTemplates.length} tone={missingTemplates.length ? "danger" : "ok"} /></div>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><StatusFilter value={statusFilter} onChange={setStatusFilter} options={projectRows.map((r) => r.status)} total={projectRows.length} shown={displayedRows.length} /><ExportCsvButton filename="tramites.csv" rows={displayedRows.map((r) => ({ Folio: r.folio || r.id, Tramite: r.name, Etapa: r.stage, Dependencia: r.agency, Responsable: r.owner, SiguienteAccion: r.nextAction, FechaCompromiso: r.dueDate, Estado: r.status, Prioridad: r.priority }))} /></div>
      <MiniTable columns={[{ key: "folio", label: "Folio", render: (r) => <span style={{ fontFamily: "monospace", fontSize: 12, color: c.muted }}>{r.folio || "—"}</span> }, { key: "name", label: "Trámite", render: (r) => <EntityLink onClick={() => setSelectedPermit(r)}>{r.name}</EntityLink> }, { key: "stage", label: "Etapa" }, { key: "agency", label: "Dependencia" }, { key: "owner", label: "Responsable" }, { key: "nextAction", label: "Siguiente acción" }, { key: "dueDate", label: "Fecha compromiso" }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "priority", label: "Prioridad", render: (r) => <Pill tone={r.priority === "Alta" ? "danger" : "primary"}>{r.priority}</Pill> }, { key: "history", label: "Historial", render: (r) => `${(r.history || []).length} mov.` }, { key: "actions", label: "Acciones", sortable: false, render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} help="Abre el detalle del trámite para actualizar estatus, siguiente acción y ver historial completo." onClick={() => setSelectedPermit(r)}>Abrir / actualizar</Button></ActionCell> }]} rows={displayedRows} />
    </Card>
    {selectedPermit ? <PermitDrawer permit={(data.permits || []).find((p) => p.id === selectedPermit.id) || selectedPermit} data={data} projectMap={projectMap} onClose={() => setSelectedPermit(null)} onSave={(id, patch) => updateRecord("permits", id, patch)} /> : null}
  </div>;
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
  const [search, setSearch] = useState("");
  const statusFilteredRows = filterByStatus(data.incomes || [], statusFilter);
  const clientMap = Object.fromEntries((data.clients || []).map((c) => [c.id, c]));
  const rows = filterBySearch(statusFilteredRows, search, (r) => `${clientMap[r.clientId]?.name || ""} ${r.concept} ${r.unit} ${r.contractRef}`);
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Ingresos" helper="Registro de ingresos por proyecto, cliente, contrato de compraventa y unidad." /><Button onClick={() => setShowForm(showForm === "income" ? null : "income")}>Nuevo ingreso</Button></div>{showForm === "income" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Cliente" help="Al elegir cliente se autocompletan su unidad y contrato de compraventa si ya los tiene registrados."><select style={inputStyle()} value={form.clientId || data.clients?.[0]?.id || ""} onChange={(e) => { const cl = (data.clients || []).find((x) => x.id === e.target.value); setForm({ ...form, clientId: e.target.value, unit: cl?.unit || form.unit, contractRef: cl?.contractRef || form.contractRef, projectId: cl?.projectId || form.projectId }); }}>{(data.clients || []).map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}</select></Field><Field label="Tipo de ingreso"><select style={inputStyle()} value={form.type || "Enganche"} onChange={(e) => setForm({ ...form, type: e.target.value })}><option>Apartado</option><option>Enganche</option><option>Mensualidad</option><option>Escrituración</option><option>Aportación</option><option>Otro</option></select></Field><Field label="Unidad"><input style={inputStyle()} value={form.unit || ""} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field><Field label="Contrato CV"><input style={inputStyle()} value={form.contractRef || ""} onChange={(e) => setForm({ ...form, contractRef: e.target.value })} /></Field><Field label="Monto"><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Banco"><input style={inputStyle()} value={form.bank || ""} onChange={(e) => setForm({ ...form, bank: e.target.value })} /></Field><Field label="Referencia"><input style={inputStyle()} value={form.reference || ""} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field></div><Field label="Concepto"><input style={inputStyle()} value={form.concept || ""} onChange={(e) => setForm({ ...form, concept: e.target.value })} /></Field><AttachmentUploader label="Anexos del ingreso" value={form.attachments} folder="finanzas/ingresos" onChange={(attachments) => setForm({ ...form, attachments })} /><Button help="Registra el ingreso; queda disponible para conciliar contra banco en Conciliación bancaria." onClick={() => { if (!(Number(form.amount || 0) > 0)) { alert("Captura un monto mayor a cero."); return; } addRecord("incomes", { folio: nextFolio(data, "incomes", "IN"), projectId: form.projectId || "arenna", clientId: form.clientId || data.clients?.[0]?.id || "", type: form.type || "Enganche", concept: form.concept || "Ingreso", amount: Number(form.amount || 0), date: todayIso(), unit: form.unit || "", contractRef: form.contractRef || "", status: "Recibido", bank: form.bank || "", reference: form.reference || "", attachments: normalizeAttachments(form.attachments) }); }}>Guardar ingreso</Button></div> : null}</Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><StatusFilter value={statusFilter} onChange={setStatusFilter} options={(data.incomes || []).map((r) => r.status)} total={(data.incomes || []).length} shown={rows.length} /><ExportCsvButton filename="ingresos.csv" rows={rows.map((r) => ({ Folio: r.folio || r.id, Proyecto: projectMap[r.projectId]?.name || "", Cliente: clientMap[r.clientId]?.name || "", Tipo: r.type, Concepto: r.concept, Unidad: r.unit, Contrato: r.contractRef, Monto: r.amount, Estado: r.status }))} /></div><div style={{ marginTop: -6, marginBottom: 12 }}><input style={inputStyle({ maxWidth: 340 })} placeholder="Buscar por cliente, concepto, unidad o contrato…" value={search} onChange={(e) => setSearch(e.target.value)} /></div><MiniTable columns={[{ key: "folio", label: "Folio", render: (r) => <span style={{ fontFamily: "monospace", fontSize: 12, color: c.muted }}>{r.folio || "—"}</span> }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "clientId", label: "Cliente", render: (r) => clientMap[r.clientId]?.name || "—" }, { key: "type", label: "Tipo" }, { key: "concept", label: "Concepto" }, { key: "unit", label: "Unidad" }, { key: "contractRef", label: "Contrato" }, { key: "amount", label: "Monto", render: (r) => money(r.amount) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "attachments", label: "Anexos", render: (r) => <AttachmentViewer value={r.attachments} /> }]} rows={rows} /></Card>
  </div>;
}

function PermitsTimeline({ data, projectMap, rows, mode, updateRecord }) {
  const [projectId, setProjectId] = useState(data.projects[0]?.id || "arenna");
  const [selectedPermit, setSelectedPermit] = useState(null);
  const projectRows = (data.permits || rows || []).filter((r) => r.projectId === projectId);
  const stages = Array.from(new Set(projectRows.map((r) => r.stage || r.group || "General")));
  function exportPdf() { window.print(); }
  if (mode === "tramites_expediente") return <div style={{ display: "grid", gap: 16 }}>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Expediente documental de trámites" helper="Consulta los trámites precargados por proyecto, su historial, comentarios, anexos y soporte documental." /><div style={{ display: "flex", gap: 8 }}><ExportCsvButton filename="expediente-tramites.csv" rows={projectRows.map((r) => ({ Folio: r.folio || r.id, Tramite: r.name, Dependencia: r.agency, Documentos: r.documentsText || r.documents || "", UltimoComentario: r.lastComment || r.nextAction || "", Estado: r.status, Movimientos: (r.history || []).length }))} /><Button onClick={exportPdf}>Exportar / imprimir PDF</Button></div></div><Field label="Proyecto"><select style={inputStyle({ width: 280 })} value={projectId} onChange={(e) => setProjectId(e.target.value)}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></Card>
    <Card><MiniTable columns={[{ key: "folio", label: "Folio", render: (r) => <span style={{ fontFamily: "monospace", fontSize: 12, color: c.muted }}>{r.folio || "—"}</span> }, { key: "name", label: "Trámite", render: (r) => <EntityLink onClick={() => setSelectedPermit(r)}>{r.name}</EntityLink> }, { key: "agency", label: "Dependencia" }, { key: "documentsText", label: "Documentos requeridos", render: (r) => r.documentsText || r.documents || "—" }, { key: "lastComment", label: "Último comentario", render: (r) => r.lastComment || r.nextAction || "—" }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "history", label: "Historial", render: (r) => `${(r.history || []).length} mov.` }]} rows={projectRows} /></Card>
    {selectedPermit ? <PermitDrawer permit={(data.permits || []).find((p) => p.id === selectedPermit.id) || selectedPermit} data={data} projectMap={projectMap} onClose={() => setSelectedPermit(null)} onSave={(id, patch) => updateRecord("permits", id, patch)} /> : null}
  </div>;
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Línea del tiempo de trámites" helper="Vista por proyecto y etapa. El estatus se actualiza abriendo cada trámite para registrar comentario y evidencia." /><Button onClick={exportPdf}>Exportar / imprimir PDF</Button></div><Field label="Proyecto"><select style={inputStyle({ width: 280 })} value={projectId} onChange={(e) => setProjectId(e.target.value)}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></Card>
    <div style={{ display: "grid", gap: 14 }}>{stages.map((stage) => <Card key={stage}><SectionTitle title={stage} helper={projectMap[projectId]?.name || projectId} /><div style={{ display: "grid", gap: 8 }}>{projectRows.filter((r) => (r.stage || r.group || "General") === stage).map((r) => <button key={r.id} onClick={() => setSelectedPermit(r)} style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) 150px minmax(220px,1.4fr) 80px", gap: 10, alignItems: "center", padding: 10, border: `1px solid ${c.border}`, borderRadius: 16, background: "white", textAlign: "left", cursor: "pointer" }}><b>{r.name}</b><Pill tone={statusTone(r.status)}>{r.status}</Pill><span style={{ color: c.muted, fontSize: 12 }}>{r.nextAction || r.documentsText || "Sin comentario"}</span><span style={{ color: c.muted, fontSize: 12 }}>{(r.history || []).length} mov.</span></button>)}</div></Card>)}</div>
    {selectedPermit ? <PermitDrawer permit={(data.permits || []).find((p) => p.id === selectedPermit.id) || selectedPermit} data={data} projectMap={projectMap} onClose={() => setSelectedPermit(null)} onSave={(id, patch) => updateRecord("permits", id, patch)} /> : null}
  </div>;
}


function Reports({ totals, data, projectMap, categoryMap, active = "reportes_os" }) {
  const incomeTotal = (data.incomes || []).reduce((a, r) => a + Number(r.amount || 0), 0);
  const payablesTotal = data.payables.reduce((a, p) => a + payableTotal(p), 0);
  const paidTotal = data.payments.reduce((a, p) => a + Number(p.amount || 0), 0);
  if (active === "reporte_ia") return <div style={{ display: "grid", gap: 16 }}><Card><Pill tone="primary">IA / análisis cruzado</Pill><h3 style={{ margin: "12px 0 4px" }}>Lectura financiera vs operación</h3><p style={{ color: c.muted }}>Aquí se concentrarán análisis automáticos de flujo, calidad, avance de obra, pagos y trámites. Por ahora muestra alertas de ejemplo para pruebas operativas.</p></Card><Card><SectionTitle title="Hallazgos sugeridos" helper="Pistas que el sistema puede generar automáticamente." /><div style={{ display: "grid", gap: 10 }}><div style={{ padding: 12, borderRadius: 16, background: c.orangeSoft }}><b>Presupuesto vs avance:</b> revisar partidas con alto comprometido y baja liberación de calidad.</div><div style={{ padding: 12, borderRadius: 16, background: c.soft }}><b>Flujo:</b> programar pagos autorizados por lote para evitar dispersión de tesorería.</div><div style={{ padding: 12, borderRadius: 16, background: c.greenSoft }}><b>Ingresos:</b> conciliar ingresos contra contratos y unidades para evitar omisiones.</div></div></Card></div>;
  const titleMap = { reporte_obra: "Reportes de obra", reporte_finanzas: "Reportes financieros", reporte_egresos: "Reportes de egresos", reporte_ingresos: "Reportes de ingresos", reportes_os: "TRITON OS" };
  const helperMap = { reportes_os: "Sistema operativo de desarrollos inmobiliarios: obra, finanzas, ingresos, egresos, trámites y análisis ejecutivo.", reporte_obra: "Calidad, estimaciones, evidencias y avance de obra.", reporte_finanzas: "Estado financiero, presupuesto, comprometido, pagado y disponible.", reporte_egresos: "Pagos, proveedores, caja chica y conciliaciones.", reporte_ingresos: "Ventas, clientes, unidades y conciliación de ingresos." };
  return <div style={{ display: "grid", gap: 16 }}><Card><SectionTitle title={titleMap[active] || "Reportes"} helper={helperMap[active] || "Submenú directivo por módulo. Cada reporte debe poder exportarse, consultarse y cruzarse con IA."} /></Card><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 14 }}><Card><Pill tone="warn">Egresos solicitados</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(payablesTotal)}</div></Card><Card><Pill tone="ok">Pagado</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(paidTotal)}</div></Card><Card><Pill tone="primary">Ingresos</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(incomeTotal)}</div></Card><Card><Pill tone="danger">Cartera rentas</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totals.rentOverdue)}</div></Card></div><Card><MiniTable columns={[{ key: "name", label: "Proyecto" }, { key: "type", label: "Tipo" }, { key: "payables", label: "Egresos", render: (r) => money(data.payables.filter((p) => p.projectId === r.id).reduce((a, p) => a + payableTotal(p), 0)) }, { key: "incomes", label: "Ingresos", render: (r) => money((data.incomes || []).filter((i) => i.projectId === r.id).reduce((a, i) => a + Number(i.amount || 0), 0)) }, { key: "permits", label: "Trámites abiertos", render: (r) => data.permits.filter((p) => p.projectId === r.id && !["Aprobado", "Cerrado"].includes(p.status)).length }, { key: "status", label: "Estatus", render: (r) => <Pill tone="primary">{r.status}</Pill> }]} rows={data.projects} /></Card></div>;
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
            { key: "actions", label: "Acciones", sortable: false, render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => beginEditUser(r)}>Editar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={async () => { const res = await sendPasswordReset(r.email); setMessage(res.message); }}>Restablecer contraseña</Button><Button variant={r.active === false ? "success" : "danger"} style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => { const active = r.active === false; setData((prev) => ({ ...prev, users: (prev.users || []).map((u) => (u.id || u.email) === (r.id || r.email) ? { ...u, active, revokedAt: active ? "" : new Date().toISOString(), revokedBy: active ? "" : firebaseAuth.currentUser?.email || "sistema" } : u) })); }}>{r.active === false ? "Activar" : "Revocar acceso"}</Button></ActionCell> }
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

function Config({ data, setData }) {
  const [activeCatalog, setActiveCatalog] = useState("finanzas");
  const [localForm, setLocalForm] = useState({});
  const [editing, setEditing] = useState(null);
  const [securityMessage, setSecurityMessage] = useState("");
  const tabs = [
    { id: "finanzas", label: "Finanzas" }, { id: "arrendamientos", label: "Arrendamientos" }, { id: "tramites", label: "Trámites" }, { id: "documentos", label: "Documentos" }, { id: "bancos", label: "Bancos" }, { id: "reglas", label: "Reglas" }, { id: "seguridad", label: "Seguridad y respaldos" },
  ];
  function setCollection(name, rows) { setData((prev) => ({ ...prev, [name]: rows })); }
  function upsert(collectionName, payload) {
    const rows = data[collectionName] || [];
    if (editing?.collection === collectionName) {
      setCollection(collectionName, rows.map((r) => r.id === editing.id ? { ...r, ...payload, updatedAt: todayIso() } : r));
    } else {
      setCollection(collectionName, [{ id: uid(collectionName), ...payload, status: payload.status || "Activo", createdAt: todayIso(), updatedAt: todayIso() }, ...rows]);
    }
    setLocalForm({}); setEditing(null);
  }
  function editRow(collection, row) { setEditing({ collection, id: row.id }); setLocalForm({ ...row }); }
  function deactivateRow(collection, row) { setCollection(collection, (data[collection] || []).map((r) => r.id === row.id ? { ...r, status: r.status === "Inactivo" ? "Activo" : "Inactivo", updatedAt: todayIso() } : r)); }
  function addStringItem(collection, value) {
    const v = String(value || "").trim(); if (!v) return;
    if (!(data[collection] || []).includes(v)) setCollection(collection, [v, ...(data[collection] || [])]);
    setLocalForm({});
  }
  function removeStringItem(collection, value) { setCollection(collection, (data[collection] || []).filter((x) => x !== value)); }
  const categoryForm = <div style={{ display: "grid", gap: 10, marginBottom: 12 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Categoría / partida"><input style={inputStyle()} value={localForm.name || ""} onChange={(e) => setLocalForm({ ...localForm, name: e.target.value })} /></Field><Field label="Grupo"><input style={inputStyle()} value={localForm.group || ""} onChange={(e) => setLocalForm({ ...localForm, group: e.target.value })} /></Field><Field label="Presupuestable"><select style={inputStyle()} value={localForm.budgetable === false ? "No" : "Sí"} onChange={(e) => setLocalForm({ ...localForm, budgetable: e.target.value === "Sí" })}><option>Sí</option><option>No</option></select></Field></div><Button style={{ justifySelf: "start" }} onClick={() => upsert("categories", { name: localForm.name || "Categoría", group: localForm.group || "General", budgetable: localForm.budgetable !== false })}>{editing?.collection === "categories" ? "Guardar categoría" : "Agregar categoría"}</Button></div>;
  const genericStringEditor = (collection, label, helper) => <Card><SectionTitle title={label} helper={helper} /><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>{(data[collection] || []).map((item) => <span key={item} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c.soft, borderRadius: 999, padding: "6px 8px" }}><b>{item}</b><button onClick={() => removeStringItem(collection, item)} style={{ border: 0, background: "white", borderRadius: 999, cursor: "pointer" }}>×</button></span>)}</div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input style={inputStyle({ maxWidth: 320 })} value={localForm[collection] || ""} onChange={(e) => setLocalForm({ ...localForm, [collection]: e.target.value })} placeholder="Nuevo valor" /><Button onClick={() => addStringItem(collection, localForm[collection])}>Agregar</Button></div></Card>;
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Catálogos y reglas" helper="Parámetros operativos del ERP. Todo catálogo usado en movimientos debe desactivarse, no borrarse, para conservar historial." /><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{tabs.map((t) => <Button key={t.id} variant={activeCatalog === t.id ? "primary" : "secondary"} onClick={() => { setActiveCatalog(t.id); setLocalForm({}); setEditing(null); }}>{t.label}</Button>)}</div></Card>
    {activeCatalog === "finanzas" && <Card><SectionTitle title="Categorías y partidas presupuestales" helper="Base para que ningún pago avance sin presupuesto, partida y trazabilidad." />{categoryForm}<MiniTable columns={[{ key: "name", label: "Categoría" }, { key: "group", label: "Grupo" }, { key: "budgetable", label: "Presupuestable", render: (r) => r.budgetable ? <Pill tone="ok">Sí</Pill> : <Pill>No</Pill> }, { key: "status", label: "Estado", render: (r) => <Pill tone={r.status === "Inactivo" ? "warn" : "ok"}>{r.status || "Activo"}</Pill> }, { key: "actions", label: "Acciones", render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => editRow("categories", r)}>Editar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => deactivateRow("categories", r)}>{r.status === "Inactivo" ? "Activar" : "Desactivar"}</Button></ActionCell> }]} rows={data.categories || []} /></Card>}
    {activeCatalog === "arrendamientos" && <div style={{ display: "grid", gap: 16 }}>{genericStringEditor("assetTypes", "Tipos de inmueble", "Define locales, terrenos, casas, departamentos, oficinas y otros activos.")}{genericStringEditor("rentalContractTypes", "Tipos de contrato", "Tipos de arrendamiento y uso del inmueble.")}<Card><SectionTitle title="Reglas de arrendamientos" helper="Incremento anual, facturación y regla de reporte solo conciliado." /><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, marginBottom: 12 }}><Field label="Regla"><input style={inputStyle()} value={localForm.name || ""} onChange={(e) => setLocalForm({ ...localForm, name: e.target.value })} /></Field><Field label="Valor"><input style={inputStyle()} value={localForm.value || ""} onChange={(e) => setLocalForm({ ...localForm, value: e.target.value })} /></Field><Field label="Descripción"><input style={inputStyle()} value={localForm.description || ""} onChange={(e) => setLocalForm({ ...localForm, description: e.target.value })} /></Field></div><Button style={{ marginBottom: 12 }} onClick={() => upsert("rentalRules", { name: localForm.name || "Regla", value: localForm.value || "", description: localForm.description || "" })}>{editing?.collection === "rentalRules" ? "Guardar regla" : "Agregar regla"}</Button><MiniTable columns={[{ key: "name", label: "Regla" }, { key: "value", label: "Valor" }, { key: "description", label: "Descripción" }, { key: "actions", label: "Acciones", render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => editRow("rentalRules", r)}>Editar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => deactivateRow("rentalRules", r)}>Desactivar</Button></ActionCell> }]} rows={data.rentalRules || []} /></Card></div>}
    {activeCatalog === "arrendamientos" && <Card><SectionTitle title="Facturación / API" helper="Parámetros para conectar un servicio de facturación y controlar emisión manual, por lote o programada." /><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, marginBottom: 12 }}><Field label="Proveedor de facturación"><input style={inputStyle()} value={data.invoiceApiConfig?.provider || ""} onChange={(e) => setData((prev) => ({ ...prev, invoiceApiConfig: { ...(prev.invoiceApiConfig || {}), provider: e.target.value } }))} /></Field><Field label="Endpoint/API"><input style={inputStyle()} value={data.invoiceApiConfig?.endpoint || ""} onChange={(e) => setData((prev) => ({ ...prev, invoiceApiConfig: { ...(prev.invoiceApiConfig || {}), endpoint: e.target.value } }))} /></Field><Field label="Alias de API key"><input style={inputStyle()} value={data.invoiceApiConfig?.apiKeyAlias || ""} onChange={(e) => setData((prev) => ({ ...prev, invoiceApiConfig: { ...(prev.invoiceApiConfig || {}), apiKeyAlias: e.target.value } }))} /></Field><Field label="Día programación"><input type="number" style={inputStyle()} value={data.invoiceApiConfig?.scheduleDay || 1} onChange={(e) => setData((prev) => ({ ...prev, invoiceApiConfig: { ...(prev.invoiceApiConfig || {}), scheduleDay: Number(e.target.value || 1) } }))} /></Field></div><label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900 }}><input type="checkbox" checked={!!data.invoiceApiConfig?.autoSend} onChange={(e) => setData((prev) => ({ ...prev, invoiceApiConfig: { ...(prev.invoiceApiConfig || {}), autoSend: e.target.checked, status: e.target.checked ? "Programación activa" : "Manual / sin programación" } }))} /> Envío automático mensual si el contrato lo permite</label></Card>}

    {activeCatalog === "tramites" && <Card><SectionTitle title="Plantillas de trámites" helper="Catálogo maestro. Aquí se dan de alta los trámites que se precargan por proyecto; en el módulo Trámites solo se actualiza estatus con historial." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, marginBottom: 12 }}>
        <Field label="Trámite"><input style={inputStyle()} value={localForm.name || ""} onChange={(e) => setLocalForm({ ...localForm, name: e.target.value })} /></Field>
        <Field label="Etapa / línea de tiempo"><input style={inputStyle()} value={localForm.stage || ""} onChange={(e) => setLocalForm({ ...localForm, stage: e.target.value })} /></Field>
        <Field label="Dependencia"><input style={inputStyle()} value={localForm.agency || ""} onChange={(e) => setLocalForm({ ...localForm, agency: e.target.value })} /></Field>
        <Field label="Tipo de proyecto al que aplica"><input style={inputStyle()} placeholder="Todos / Casas / Plaza / Departamentos" value={localForm.projectTypes || ""} onChange={(e) => setLocalForm({ ...localForm, projectTypes: e.target.value })} /></Field>
        <Field label="Responsable sugerido"><input style={inputStyle()} value={localForm.defaultOwner || ""} onChange={(e) => setLocalForm({ ...localForm, defaultOwner: e.target.value })} /></Field>
        <Field label="Prioridad sugerida"><select style={inputStyle()} value={localForm.defaultPriority || "Media"} onChange={(e) => setLocalForm({ ...localForm, defaultPriority: e.target.value })}><option>Alta</option><option>Media</option><option>Baja</option></select></Field>
        <Field label="Orden"><input type="number" style={inputStyle()} value={localForm.order || ""} onChange={(e) => setLocalForm({ ...localForm, order: e.target.value })} /></Field>
        <Field label="Documentos requeridos"><input style={inputStyle()} value={localForm.documents || ""} onChange={(e) => setLocalForm({ ...localForm, documents: e.target.value })} /></Field>
      </div>
      <Field label="Siguiente acción inicial"><textarea style={inputStyle({ minHeight: 70 })} value={localForm.initialAction || ""} onChange={(e) => setLocalForm({ ...localForm, initialAction: e.target.value })} /></Field>
      <Button style={{ marginBottom: 12 }} onClick={() => upsert("permitTemplates", { name: localForm.name || "Trámite", stage: localForm.stage || "Etapa", agency: localForm.agency || "Dependencia", documents: localForm.documents || "", projectTypes: localForm.projectTypes || "Todos", defaultOwner: localForm.defaultOwner || "Gestoría", defaultPriority: localForm.defaultPriority || "Media", initialAction: localForm.initialAction || "Definir siguiente acción", order: Number(localForm.order || 999) })}>{editing?.collection === "permitTemplates" ? "Guardar plantilla" : "Agregar plantilla"}</Button>
      <MiniTable columns={[{ key: "order", label: "Orden" }, { key: "name", label: "Trámite" }, { key: "stage", label: "Etapa" }, { key: "agency", label: "Dependencia" }, { key: "projectTypes", label: "Aplica a" }, { key: "defaultOwner", label: "Responsable" }, { key: "defaultPriority", label: "Prioridad", render: (r) => <Pill tone={r.defaultPriority === "Alta" ? "danger" : "primary"}>{r.defaultPriority || "Media"}</Pill> }, { key: "documents", label: "Documentos" }, { key: "status", label: "Estado", render: (r) => <Pill tone={r.status === "Inactivo" ? "warn" : "ok"}>{r.status || "Activo"}</Pill> }, { key: "actions", label: "Acciones", render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => editRow("permitTemplates", r)}>Editar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => deactivateRow("permitTemplates", r)}>{r.status === "Inactivo" ? "Activar" : "Desactivar"}</Button></ActionCell> }]} rows={(data.permitTemplates || []).sort((a,b) => Number(a.order || 999) - Number(b.order || 999))} /></Card>}
        {activeCatalog === "documentos" && <Card><SectionTitle title="Documentos obligatorios" helper="Checklist documental para proveedores, solicitudes de pago, contratos de arrendamiento y trámites." /><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, marginBottom: 12 }}><Field label="Módulo"><input style={inputStyle()} value={localForm.module || ""} onChange={(e) => setLocalForm({ ...localForm, module: e.target.value })} /></Field><Field label="Documento"><input style={inputStyle()} value={localForm.name || ""} onChange={(e) => setLocalForm({ ...localForm, name: e.target.value })} /></Field><Field label="Aplica a"><input style={inputStyle()} value={localForm.appliesTo || ""} onChange={(e) => setLocalForm({ ...localForm, appliesTo: e.target.value })} /></Field><Field label="Vigencia días"><input type="number" style={inputStyle()} value={localForm.validityDays || 0} onChange={(e) => setLocalForm({ ...localForm, validityDays: e.target.value })} /></Field></div><label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900, marginBottom: 10 }}><input type="checkbox" checked={localForm.required !== false} onChange={(e) => setLocalForm({ ...localForm, required: e.target.checked })} /> Obligatorio</label><Button style={{ marginBottom: 12 }} onClick={() => upsert("requiredDocuments", { module: localForm.module || "General", name: localForm.name || "Documento", appliesTo: localForm.appliesTo || "Todos", required: localForm.required !== false, validityDays: Number(localForm.validityDays || 0) })}>{editing?.collection === "requiredDocuments" ? "Guardar documento" : "Agregar documento"}</Button><MiniTable columns={[{ key: "module", label: "Módulo" }, { key: "name", label: "Documento" }, { key: "appliesTo", label: "Aplica a" }, { key: "required", label: "Obligatorio", render: (r) => r.required ? <Pill tone="ok">Sí</Pill> : <Pill>No</Pill> }, { key: "validityDays", label: "Vigencia días" }, { key: "actions", label: "Acciones", render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => editRow("requiredDocuments", r)}>Editar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => deactivateRow("requiredDocuments", r)}>Desactivar</Button></ActionCell> }]} rows={data.requiredDocuments || []} /></Card>}
    {activeCatalog === "bancos" && <Card><SectionTitle title="Bancos y cuentas" helper="Cuentas origen/destino para pagos, ingresos, rentas y conciliación." /><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 12 }}><Field label="Nombre"><input style={inputStyle()} value={localForm.name || ""} onChange={(e) => setLocalForm({ ...localForm, name: e.target.value })} /></Field><Field label="Banco"><input style={inputStyle()} value={localForm.bank || ""} onChange={(e) => setLocalForm({ ...localForm, bank: e.target.value })} /></Field><Field label="Cuenta"><input style={inputStyle()} value={localForm.account || ""} onChange={(e) => setLocalForm({ ...localForm, account: e.target.value })} /></Field><Field label="CLABE"><input style={inputStyle()} value={localForm.clabe || ""} onChange={(e) => setLocalForm({ ...localForm, clabe: e.target.value })} /></Field><Field label="Uso"><input style={inputStyle()} value={localForm.use || ""} onChange={(e) => setLocalForm({ ...localForm, use: e.target.value })} /></Field></div><Button style={{ marginBottom: 12 }} onClick={() => upsert("bankAccounts", { name: localForm.name || "Cuenta", bank: localForm.bank || "Banco", account: localForm.account || "", clabe: localForm.clabe || "", currency: "MXN", use: localForm.use || "Operación", status: localForm.status || "Activa" })}>{editing?.collection === "bankAccounts" ? "Guardar cuenta" : "Agregar cuenta"}</Button><MiniTable columns={[{ key: "name", label: "Nombre" }, { key: "bank", label: "Banco" }, { key: "account", label: "Cuenta" }, { key: "use", label: "Uso" }, { key: "status", label: "Estatus", render: (r) => <Pill tone={r.status === "Inactivo" ? "warn" : "ok"}>{r.status}</Pill> }, { key: "actions", label: "Acciones", render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => editRow("bankAccounts", r)}>Editar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => deactivateRow("bankAccounts", r)}>{r.status === "Inactivo" ? "Activar" : "Desactivar"}</Button></ActionCell> }]} rows={data.bankAccounts || []} /></Card>}
    {activeCatalog === "reglas" && <Card><SectionTitle title="Reglas de autorización y control" helper="Estados por movimiento, autorizaciones por rol/monto, sobregiro justificado y conciliación antes de reporte." /><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, marginBottom: 12 }}><Field label="Módulo"><input style={inputStyle()} value={localForm.module || ""} onChange={(e) => setLocalForm({ ...localForm, module: e.target.value })} /></Field><Field label="Monto umbral"><input type="number" style={inputStyle()} value={localForm.threshold || 0} onChange={(e) => setLocalForm({ ...localForm, threshold: e.target.value })} /></Field><Field label="Rol"><input style={inputStyle()} value={localForm.role || ""} onChange={(e) => setLocalForm({ ...localForm, role: e.target.value })} /></Field><Field label="Descripción"><input style={inputStyle()} value={localForm.description || ""} onChange={(e) => setLocalForm({ ...localForm, description: e.target.value })} /></Field></div><div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}><label style={{ fontWeight: 900 }}><input type="checkbox" checked={!!localForm.requiresAdminReview} onChange={(e) => setLocalForm({ ...localForm, requiresAdminReview: e.target.checked })} /> Revisión admin</label><label style={{ fontWeight: 900 }}><input type="checkbox" checked={!!localForm.requiresMaster} onChange={(e) => setLocalForm({ ...localForm, requiresMaster: e.target.checked })} /> Master</label></div><Button style={{ marginBottom: 12 }} onClick={() => upsert("approvalRules", { module: localForm.module || "Cuentas por pagar", threshold: Number(localForm.threshold || 0), role: localForm.role || "Master", requiresAdminReview: !!localForm.requiresAdminReview, requiresMaster: !!localForm.requiresMaster, description: localForm.description || "Regla" })}>{editing?.collection === "approvalRules" ? "Guardar regla" : "Agregar regla"}</Button><MiniTable columns={[{ key: "module", label: "Módulo" }, { key: "threshold", label: "Monto", render: (r) => money(r.threshold) }, { key: "role", label: "Rol" }, { key: "requiresAdminReview", label: "Revisión admin", render: (r) => r.requiresAdminReview ? <Pill tone="ok">Sí</Pill> : <Pill>No</Pill> }, { key: "requiresMaster", label: "Master", render: (r) => r.requiresMaster ? <Pill tone="warn">Sí</Pill> : <Pill>No</Pill> }, { key: "description", label: "Regla" }, { key: "actions", label: "Acciones", render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => editRow("approvalRules", r)}>Editar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => deactivateRow("approvalRules", r)}>Desactivar</Button></ActionCell> }]} rows={data.approvalRules || []} /></Card>}

    {activeCatalog === "seguridad" && <div style={{ display: "grid", gap: 16 }}>
      <Card><SectionTitle title="Seguridad del sistema" helper="Configuración básica para pruebas con administración: Firestore, respaldos, revocación de accesos y restablecimiento de contraseñas." />
        {securityMessage ? <div style={{ padding: 12, borderRadius: 16, background: securityMessage.includes("error") || securityMessage.includes("Firestore") ? c.orangeSoft : c.greenSoft, color: securityMessage.includes("error") ? c.red : c.primaryDark, fontWeight: 850, marginBottom: 12 }}>{securityMessage}</div> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          <Info label="Base de datos" value="Firestore · control-de-calidad-triton" />
          <Info label="Storage" value="Firebase Storage para anexos" />
          <Info label="Último respaldo local" value={localStorage.getItem("triton_os_last_backup_at") ? new Date(Number(localStorage.getItem("triton_os_last_backup_at"))).toLocaleString("es-MX") : "Pendiente"} />
          <Info label="Versión" value="TRITON OS v50" />
        </div>
      </Card>
      <Card><SectionTitle title="Respaldos automáticos" helper="El cliente genera respaldo cuando hay sesión activa. Para producción se recomienda Cloud Function programada nocturna; esta base ya deja la colección systemBackups preparada." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, marginBottom: 12 }}>
          <Field label="Frecuencia respaldo activo (horas)"><input type="number" style={inputStyle()} value={data.operationSettings?.backupsEveryHours || 6} onChange={(e) => setData((prev) => ({ ...prev, operationSettings: { ...(prev.operationSettings || {}), backupsEveryHours: Number(e.target.value || 6) } }))} /></Field>
          <Field label="Estado Firestore"><select style={inputStyle()} value={data.operationSettings?.firestoreConfigured === false ? "Pendiente" : "Configurado"} onChange={(e) => setData((prev) => ({ ...prev, operationSettings: { ...(prev.operationSettings || {}), firestoreConfigured: e.target.value === "Configurado" } }))}><option>Configurado</option><option>Pendiente</option></select></Field>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button onClick={async () => { const res = await createSystemBackup(data, "Respaldo manual desde configuración"); setSecurityMessage(res.ok ? `Respaldo guardado: ${res.id}` : `Respaldo local guardado. Firestore: ${res.error}`); }}>Crear respaldo ahora</Button>
          <Button variant="secondary" onClick={() => { const raw = localStorage.getItem("triton_os_backup_latest") || JSON.stringify({ data, createdAt: new Date().toISOString() }); const blob = new Blob([raw], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `triton-os-backup-${todayIso()}.json`; a.click(); URL.revokeObjectURL(url); }}>Descargar último respaldo JSON</Button>
        </div>
      </Card>
      <Card><SectionTitle title="Contraseñas y accesos" helper="La contraseña real vive en Firebase Authentication. Desde Usuarios puedes revocar acceso lógico o enviar correo para restablecer contraseña." />
        <MiniTable columns={[{ key: "name", label: "Usuario" }, { key: "email", label: "Correo" }, { key: "role", label: "Rol" }, { key: "active", label: "Acceso", render: (r) => <Pill tone={r.active === false ? "danger" : "ok"}>{r.active === false ? "Revocado" : "Activo"}</Pill> }, { key: "actions", label: "Acciones", render: (r) => <ActionCell><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={async () => { const res = await sendPasswordReset(r.email); setSecurityMessage(res.message); }}>Enviar reset</Button></ActionCell> }]} rows={data.users || []} />
      </Card>
    </div>}

  </div>;
}

function SimpleForm({ fields, labels, form, setForm, onSubmit }) {
  return <div style={{ marginTop: 14, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>{fields.map((field) => <Field key={field} label={labels[field] || field}><input style={inputStyle()} value={form[field] || ""} onChange={(e) => setForm({ ...form, [field]: e.target.value })} /></Field>)}</div><Button onClick={onSubmit} style={{ justifySelf: "start" }}>Guardar</Button></div>;
}
