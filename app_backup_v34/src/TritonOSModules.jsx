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
const normalizeAttachments = (value) => {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? { name: item, url: "", source: "manual" } : item).filter(Boolean);
  if (!value) return [];
  return String(value).split(",").map((x) => x.trim()).filter(Boolean).map((name) => ({ name, url: "", source: "manual" }));
};
const attachmentCount = (value) => normalizeAttachments(value).length;
const attachmentNames = (value) => normalizeAttachments(value).map((a) => a.name || a.url || "Anexo").join(", ");
async function uploadFinanceAttachments(fileList, folder = "finanzas/anexos") {
  const files = Array.from(fileList || []);
  const user = firebaseAuth.currentUser;
  const uploaded = [];
  for (const file of files) {
    const path = `${folder}/${todayIso()}/${uid("file")}_${safeFileName(file.name)}`;
    try {
      const fileRef = storageRef(firebaseStorage, path);
      await uploadBytes(fileRef, file, {
        contentType: file.type || "application/octet-stream",
        customMetadata: { uploadedBy: user?.email || "sin_usuario", originalName: file.name || "archivo" },
      });
      const url = await getDownloadURL(fileRef);
      uploaded.push({ name: file.name, type: file.type || "archivo", size: file.size || 0, path, url, source: "firebase-storage", uploadedBy: user?.email || "", uploadedAt: new Date().toISOString() });
    } catch (error) {
      uploaded.push({ name: file.name, type: file.type || "archivo", size: file.size || 0, path: "", url: "", source: "pendiente_storage", uploadError: error?.message || String(error), uploadedBy: user?.email || "", uploadedAt: new Date().toISOString() });
    }
  }
  return uploaded;
}
function AttachmentUploader({ label = "Subir anexos", value, onChange, folder, helper }) {
  const [busy, setBusy] = useState(false);
  const list = normalizeAttachments(value);
  return <div style={{ display: "grid", gap: 8 }}>
    <Field label={label}>
      <input type="file" multiple accept=".pdf,.xml,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.doc,.docx,image/*,application/pdf,text/xml,application/xml" style={inputStyle({ padding: 10 })} disabled={busy} onChange={async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        setBusy(true);
        const newFiles = await uploadFinanceAttachments(files, folder);
        onChange([ ...list, ...newFiles ]);
        e.target.value = "";
        setBusy(false);
      }} />
    </Field>
    <div style={{ fontSize: 12, color: c.muted }}>{busy ? "Subiendo anexos..." : (helper || "PDF, XML, imágenes, Excel o Word. Cada archivo queda ligado al registro.")}</div>
    {list.length ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{list.map((a, i) => <span key={`${a.name}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 9px", borderRadius: 999, border: `1px solid ${c.border}`, background: a.uploadError ? c.redSoft : c.soft, fontSize: 12, maxWidth: 260 }}>
      {a.url ? <a href={a.url} target="_blank" rel="noreferrer" style={{ color: c.primary, fontWeight: 800, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</a> : <span title={a.uploadError || "Anexo registrado"} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>}
      <button type="button" onClick={() => onChange(list.filter((_, idx) => idx !== i))} style={{ border: 0, background: "transparent", cursor: "pointer", fontWeight: 900 }}>×</button>
    </span>)}</div> : <div style={{ fontSize: 12, color: c.orange, fontWeight: 800 }}>Sin anexos cargados.</div>}
  </div>;
}
function AttachmentViewer({ value }) {
  const list = normalizeAttachments(value);
  if (!list.length) return <Pill tone="warn">Sin anexos</Pill>;
  return <div style={{ minWidth: 180, display: "grid", gap: 4 }}>{list.slice(0, 3).map((a, i) => a.url ? <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ color: c.primary, fontSize: 12, fontWeight: 800 }}>{a.name}</a> : <span key={i} style={{ color: a.uploadError ? c.red : c.text, fontSize: 12 }}>{a.name}</span>)}{list.length > 3 ? <span style={{ color: c.muted, fontSize: 12 }}>+{list.length - 3} más</span> : null}</div>;
}


function PaymentContextModal({ row, data, projectMap, categoryMap, onClose, onAuthorize, onCorrection, onReject }) {
  if (!row) return null;
  const supplier = data.suppliers.find((s) => s.id === row.supplierId);
  const contract = (data.financeContracts || []).find((ct) => ct.id === row.contractId);
  const budget = budgetCheck(data, row);
  const contractInfo = contractCheck(data, row);
  const total = payableTotal(row);
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{onCorrection ? <Button variant="secondary" onClick={() => onCorrection(row)}>Solicitar corrección</Button> : null}{onReject ? <Button variant="danger" onClick={() => onReject(row)}>Rechazar</Button> : null}{onAuthorize ? <Button onClick={() => onAuthorize(row)}>Autorizar</Button> : null}</div>
      </footer>
    </aside>
  </div>;
}

function EntityLink({ children, onClick, title }) {
  return <button type="button" title={title || "Ver detalle"} onClick={onClick} style={{ border: 0, background: "transparent", padding: 0, margin: 0, color: c.primary, fontWeight: 950, cursor: "pointer", textAlign: "left", textDecoration: "underline", textDecorationThickness: 1, textUnderlineOffset: 3 }}>{children}</button>;
}

function SupplierContextModal({ supplier, data, projectMap, categoryMap, onClose, onEdit }) {
  if (!supplier) return null;
  const relatedPayables = (data.payables || []).filter((p) => p.supplierId === supplier.id);
  const relatedContracts = (data.financeContracts || []).filter((ct) => ct.supplierId === supplier.id);
  const relatedPayments = (data.payments || []).filter((pay) => relatedPayables.some((p) => p.id === pay.payableId));
  const totalRequested = relatedPayables.reduce((a, p) => a + payableTotal(p), 0);
  const totalPaid = relatedPayments.reduce((a, p) => a + Number(p.amount || 0), 0);
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
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Documentos del proveedor" helper="Constancia fiscal, carátula bancaria, contrato marco y soportes." />{Array.isArray(supplier.documents) && supplier.documents.length ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{supplier.documents.map((d, i) => <Pill key={i} tone="idle">{typeof d === "string" ? d : d.name}</Pill>)}</div> : <Pill tone="warn">Sin documentos</Pill>}</Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Contratos ligados" helper="Techo autorizado, pagos parciales, anticipos y saldos." />{relatedContracts.length ? <MiniTable columns={[{ key: "name", label: "Contrato" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "amount", label: "Monto", render: (r) => money(r.amount) }, { key: "status", label: "Estatus", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }]} rows={relatedContracts} /> : <div style={{ color: c.muted }}>Sin contratos ligados.</div>}</Card>
        <Card style={{ boxShadow: "none" }}><SectionTitle title="Solicitudes y pagos anteriores" helper="Contexto para detectar duplicados, recurrencias o patrones fuera de operación." />{relatedPayables.length ? <MiniTable columns={[{ key: "concept", label: "Concepto" }, { key: "categoryId", label: "Partida", render: (r) => categoryMap[r.categoryId]?.name || r.categoryId }, { key: "amount", label: "Total", render: (r) => money(payableTotal(r)) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }]} rows={relatedPayables} /> : <div style={{ color: c.muted }}>Sin solicitudes registradas.</div>}</Card>
      </main>
      <footer style={{ padding: 16, borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><Button variant="secondary" onClick={onClose}>Cerrar</Button>{onEdit ? <Button onClick={() => onEdit(supplier)}>Editar proveedor</Button> : null}</footer>
    </aside>
  </div>;
}

function PaymentEditModal({ row, data, onClose, onSave }) {
  const [draft, setDraft] = useState(row || {});
  if (!row) return null;
  const supplier = data.suppliers.find((s) => s.id === draft.supplierId) || data.suppliers[0];
  const activeContracts = (data.financeContracts || []).filter((ct) => !draft.supplierId || ct.supplierId === draft.supplierId);
  return <div style={{ position: "fixed", inset: 0, zIndex: 2147483642, pointerEvents: "none" }}>
    <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.16)", backdropFilter: "blur(2px)", pointerEvents: "auto" }} onClick={onClose} />
    <aside style={{ position: "absolute", right: 18, top: 18, bottom: 18, width: "min(680px, calc(100vw - 36px))", background: "rgba(255,255,255,0.99)", border: `1px solid ${c.border}`, borderRadius: 28, boxShadow: "0 24px 80px rgba(0,0,0,.18)", overflow: "hidden", pointerEvents: "auto", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <header style={{ padding: 20, borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 12 }}><div><Pill tone="primary">Editar solicitud</Pill><h2 style={{ margin: "10px 0 4px", fontSize: 22 }}>Datos del pago</h2><div style={{ color: c.muted, fontSize: 13 }}>Los cambios quedan en el expediente para revisión administrativa.</div></div><button onClick={onClose} style={{ border: 0, background: c.soft, borderRadius: 14, width: 40, height: 40, cursor: "pointer", fontWeight: 950 }}>×</button></header>
      <main style={{ padding: 20, overflow: "auto", display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
          <Field label="Proyecto"><select style={inputStyle()} value={draft.projectId || ""} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Proveedor"><select style={inputStyle()} value={draft.supplierId || ""} onChange={(e) => { const s = data.suppliers.find((x) => x.id === e.target.value); setDraft({ ...draft, supplierId: e.target.value, supplier: s?.tradeName || draft.supplier, categoryId: s?.categoryId || draft.categoryId }); }}>{data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.tradeName}</option>)}</select></Field>
          <Field label="Partida"><select style={inputStyle()} value={draft.categoryId || supplier?.categoryId || "construccion"} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>{data.categories.filter((cat) => cat.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field>
          <Field label="Contrato"><select style={inputStyle()} value={draft.contractId || ""} onChange={(e) => setDraft({ ...draft, contractId: e.target.value })}><option value="">Sin contrato</option>{activeContracts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}</select></Field>
          <Field label="Etapa"><select style={inputStyle()} value={draft.paymentStage || "Pago parcial"} onChange={(e) => setDraft({ ...draft, paymentStage: e.target.value })}><option>Anticipo</option><option>Pago parcial</option><option>Estimación</option><option>Saldo</option><option>Recurrente</option><option>Reembolso</option></select></Field>
          <Field label="Monto antes IVA"><input type="number" style={inputStyle()} value={draft.amount || ""} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value || 0) })} /></Field>
          <Field label="IVA"><input type="number" style={inputStyle()} value={draft.iva || ""} onChange={(e) => setDraft({ ...draft, iva: Number(e.target.value || 0) })} /></Field>
          <Field label="Retención"><input type="number" style={inputStyle()} value={draft.retention || ""} onChange={(e) => setDraft({ ...draft, retention: Number(e.target.value || 0) })} /></Field>
          <Field label="Fecha requerida"><input type="date" style={inputStyle()} value={draft.requiredDate || todayIso()} onChange={(e) => setDraft({ ...draft, requiredDate: e.target.value })} /></Field>
        </div>
        <Field label="Concepto"><input style={inputStyle()} value={draft.concept || ""} onChange={(e) => setDraft({ ...draft, concept: e.target.value })} /></Field>
        <Field label="Comentario administrativo / notas"><textarea style={inputStyle({ minHeight: 84 })} value={draft.adminComment || draft.notes || ""} onChange={(e) => setDraft({ ...draft, adminComment: e.target.value, notes: e.target.value })} /></Field>
        <AttachmentUploader label="Anexos de la solicitud" value={draft.attachments} folder="finanzas/solicitudes-pago" onChange={(attachments) => setDraft({ ...draft, attachments })} />
      </main>
      <footer style={{ padding: 16, borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => onSave({ ...draft, updatedAt: todayIso() })}>Guardar cambios</Button></footer>
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
    { id: "sup-arq", tradeName: "Despacho Arquitectónico", legalName: "Despacho Arquitectónico Demo S.A. de C.V.", rfc: "DAD260101XXX", type: "Servicios profesionales", contact: "Coordinación", email: "facturacion@despacho.demo", phone: "", status: "Activo", fiscalStatus: "Validado", bankStatus: "Validado", bank: "BBVA", clabe: "012180000000000000", categoryId: "proyecto", requiresContract: true, documents: ["Constancia fiscal", "Carátula bancaria", "Contrato marco"] },
    { id: "sup-cons", tradeName: "Constructora Base", legalName: "Constructora Base S.A. de C.V.", rfc: "CBA260101XXX", type: "Constructora", contact: "Residente externo", email: "pagos@constructora.demo", phone: "", status: "Pendiente revisión", fiscalStatus: "Pendiente", bankStatus: "Pendiente", bank: "", clabe: "", categoryId: "construccion", requiresContract: true, documents: ["Contrato pendiente"] },
    { id: "sup-mun", tradeName: "Municipio de Mérida", legalName: "Municipio de Mérida", rfc: "MMM000000XXX", type: "Dependencia", contact: "Ventanilla", email: "", phone: "", status: "Activo", fiscalStatus: "Validado", bankStatus: "No aplica", bank: "", clabe: "", categoryId: "tramites", requiresContract: false, documents: ["Recibo oficial"] },
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
  users: [
    { id: "master-rodrigo", name: "Rodrigo Herrera", role: "master", email: "rodrigo@tritondesarrollos.com", permissions: "Acceso total" },
    { id: "finanzas-admin", name: "Administración / Finanzas", role: "finanzas_pagos", email: "admin@tritondesarrollos.com", permissions: "Finanzas, proveedores, pagos, caja chica y reportes" },
    { id: "supervision-calidad", name: "Supervisión Calidad y Obra", role: "supervisora", email: "supervision@tritondesarrollos.com", permissions: "Obra, calidad, estimaciones, trámites y equipo de construcción" },
  ],
};

const moduleMeta = {
  dashboard: { title: "Dashboard", subtitle: "Vista directiva de toda la operación", icon: "▦" },
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
  caja_chica: { title: "Caja chica", subtitle: "Fondos, comprobantes, liquidación y reposición", icon: "▣" },
  cobranza: { title: "Cobranza / rentas", subtitle: "Contratos, INPC, rentas mensuales, facturación y conciliación", icon: "↙" },
  tramites: { title: "Trámites", subtitle: "Permisos, dependencias, responsables y siguientes acciones", icon: "◷" },
  equipo_obra: { title: "Equipo de construcción", subtitle: "Alta y baja de usuarios de constructoras por obra", icon: "👷" },
  reportes_os: { title: "Reportes", subtitle: "Indicadores consolidados por proyecto", icon: "▤" },
  config_os: { title: "Configuración", subtitle: "Catálogos, roles y reglas de operación", icon: "⚙" },
};

function readData() {
  try {
    const raw = localStorage.getItem("triton_os_v34") || localStorage.getItem("triton_os_v32");
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

  useEffect(() => { localStorage.setItem("triton_os_v34", JSON.stringify(data)); }, [data]);
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
    if (window.confirm("¿Restablecer datos demo de TRITON OS?")) { localStorage.removeItem("triton_os_v34"); setData(initialData); }
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
        {active === "finanzas" && <Finance data={data} projectMap={projectMap} categoryMap={categoryMap} projectFilter={projectFilter} setActive={setActive} />}
        {active === "proveedores" && <Suppliers data={data} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "presupuestos" && <Budgets data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "contratos_financieros" && <FinanceContracts data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "pagos_recurrentes" && <RecurringPayments data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "cxp" && <Payables data={data} projectMap={projectMap} categoryMap={categoryMap} rows={filteredPayables} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "autorizaciones" && <Authorizations data={data} projectMap={projectMap} categoryMap={categoryMap} updateRecord={updateRecord} />}
        {active === "pagos_programados" && <ScheduledPayments data={data} projectMap={projectMap} categoryMap={categoryMap} updateRecord={updateRecord} addRecord={addRecord} />}
        {active === "pagos_realizados" && <PaidPayments data={data} projectMap={projectMap} categoryMap={categoryMap} />}
        {active === "conciliacion" && <BankReconciliation data={data} projectMap={projectMap} updateRecord={updateRecord} />}
        {active === "caja_chica" && <PettyCash data={data} projectMap={projectMap} categoryMap={categoryMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "cobranza" && <Rentals data={data} projectMap={projectMap} tenantMap={tenantMap} assetMap={assetMap} contractMap={contractMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "tramites" && <Permits data={data} projectMap={projectMap} rows={filteredPermits} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
        {active === "equipo_obra" && <ConstructionTeam data={data} projectMap={projectMap} addRecord={addRecord} updateRecord={updateRecord} showForm={showForm} setShowForm={setShowForm} form={form} setForm={setForm} />}
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
  const budgetRows = data.budgets.map((b) => { const committed = committedFor(data, b.projectId, b.categoryId); return { ...b, committed, available: Number(b.budget || 0) - committed }; });
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Presupuestos por proyecto" helper="La partida presupuestal es obligatoria para cualquier pago. Administración puede justificar sobregiro, pero dirección debe autorizarlo." /><ProgressLine items={[{ label: "Proyecto" , done: true }, { label: "Partida", done: true }, { label: "Presupuesto" , active: true }, { label: "Comprometido" }, { label: "Disponible" }]} /></Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Nueva / ajuste de partida" helper="Carga presupuesto autorizado por categoría. Los pagos toman esta base para validar disponibilidad." /><Button onClick={() => setShowForm(showForm === "budget" ? null : "budget")}>Nueva partida</Button></div>
      {showForm === "budget" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Categoría"><select style={inputStyle()} value={form.categoryId || "construccion"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((c) => c.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field><Field label="Presupuesto autorizado"><input type="number" style={inputStyle()} value={form.budget || ""} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></Field><Field label="Responsable autorización"><input style={inputStyle()} value={form.authorizedBy || ""} onChange={(e) => setForm({ ...form, authorizedBy: e.target.value })} /></Field></div><Field label="Comentario / soporte"><input style={inputStyle()} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field><Button onClick={() => addRecord("budgets", { projectId: form.projectId || "arenna", categoryId: form.categoryId || "construccion", budget: Number(form.budget || 0), authorizedBy: form.authorizedBy || "Dirección", notes: form.notes || "", updatedAt: todayIso() })}>Guardar presupuesto</Button></div> : null}
    </Card>
    <Card><MiniTable columns={[{ key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "categoryId", label: "Categoría", render: (r) => categoryMap[r.categoryId]?.name }, { key: "budget", label: "Presupuesto", render: (r) => money(r.budget) }, { key: "committed", label: "Comprometido", render: (r) => money(r.committed) }, { key: "available", label: "Disponible", render: (r) => <Pill tone={r.available >= 0 ? "ok" : "danger"}>{money(r.available)}</Pill> }, { key: "notes", label: "Soporte" }, { key: "actions", label: "Ajustar", render: (r) => <Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => { const value = window.prompt("Nuevo presupuesto autorizado", r.budget); if (value !== null) updateRecord("budgets", r.id, { budget: Number(value || 0), updatedAt: todayIso() }); }}>Editar</Button> }]} rows={budgetRows} /></Card>
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
  const statuses = ["Borrador", "Solicitado", "En revisión", "Observado", "Listo para autorización", "Autorizado", "Programado", "Pagado", "Conciliado", "Rechazado", "Cancelado"];
  const docTypes = ["Factura PDF", "XML", "Contrato", "Orden de compra", "Estimación autorizada", "Cotización", "Carátula bancaria", "Comprobante", "Otro"];
  const supplier = data.suppliers.find((s) => s.id === (form.supplierId || data.suppliers[0]?.id));
  const previewRow = { projectId: form.projectId || "arenna", categoryId: form.categoryId || supplier?.categoryId || "construccion", amount: Number(form.amount || 0), iva: Number(form.iva || 0), retention: Number(form.retention || 0), contractId: form.contractId || "" };
  const previewBudget = budgetCheck(data, previewRow);
  const previewContract = contractCheck(data, previewRow);
  const activeContracts = (data.financeContracts || []).filter((ct) => !form.supplierId || ct.supplierId === form.supplierId);
  function addPayable() {
    const supplier = data.suppliers.find((s) => s.id === (form.supplierId || data.suppliers[0]?.id));
    if (!supplier) { alert("Selecciona un proveedor."); return; }
    const anexos = normalizeAttachments(form.attachments);
    const payload = { projectId: form.projectId || "arenna", supplierId: supplier.id, supplier: supplier.tradeName, concept: form.concept || "Solicitud de pago", categoryId: form.categoryId || supplier.categoryId || "construccion", contractId: form.contractId || "", paymentStage: form.paymentStage || "Pago parcial", amount: Number(form.amount || 0), iva: Number(form.iva || 0), retention: Number(form.retention || 0), requestedBy: form.requestedBy || "Solicitante", requiredDate: form.requiredDate || todayIso(), status: "Solicitado", priority: form.priority || "Media", documentStatus: anexos.length ? "Soporte cargado" : "Pendiente anexos", attachments: anexos, attachmentTypes: form.attachmentTypes || docTypes.slice(0, 2).join(", "), adminReviewed: false, overspendApprovedByAdmin: false, contractOverrunApprovedByAdmin: false, overspendReason: "", adminComment: "", notes: form.notes || "" };
    const b = budgetCheck(data, payload);
    if (!b.hasBudget) payload.status = "Observado";
    addRecord("payables", payload);
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Solicitudes de pago" helper="Flujo operativo: solicitante captura → administración valida presupuesto/documentos → se envía a autorización con expediente completo." />
      <ProgressLine items={[{ label: "Solicitud", done: true }, { label: "Revisión admin", active: true }, { label: "Autorización" }, { label: "Programación" }, { label: "Pago" }, { label: "Conciliación" }]} />
    </Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Nueva solicitud" helper="No avanza si no hay proveedor válido, presupuesto, anexos o justificación de sobregiro." /><Button onClick={() => setShowForm(showForm === "payable" ? null : "payable")}>Nueva solicitud</Button></div>
      {showForm === "payable" ? <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
          <Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Proveedor"><select style={inputStyle()} value={form.supplierId || data.suppliers[0]?.id || ""} onChange={(e) => { const s = data.suppliers.find((x) => x.id === e.target.value); setForm({ ...form, supplierId: e.target.value, categoryId: s?.categoryId || form.categoryId }); }}>{data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.tradeName} · {s.status}</option>)}</select></Field>
          <Field label="Categoría / partida"><select style={inputStyle()} value={form.categoryId || supplier?.categoryId || "construccion"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((cat) => cat.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field>
          <Field label="Contrato ligado"><select style={inputStyle()} value={form.contractId || ""} onChange={(e) => setForm({ ...form, contractId: e.target.value })}><option value="">Sin contrato</option>{activeContracts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}</select></Field>
          <Field label="Etapa de pago"><select style={inputStyle()} value={form.paymentStage || "Pago parcial"} onChange={(e) => setForm({ ...form, paymentStage: e.target.value })}><option>Anticipo</option><option>Pago parcial</option><option>Estimación</option><option>Saldo</option><option>Recurrente</option><option>Reembolso</option></select></Field>
          <Field label="Monto antes IVA"><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="IVA"><input type="number" style={inputStyle()} value={form.iva || ""} onChange={(e) => setForm({ ...form, iva: e.target.value })} /></Field>
          <Field label="Retención"><input type="number" style={inputStyle()} value={form.retention || ""} onChange={(e) => setForm({ ...form, retention: e.target.value })} /></Field>
          <Field label="Fecha requerida"><input type="date" style={inputStyle()} value={form.requiredDate || todayIso()} onChange={(e) => setForm({ ...form, requiredDate: e.target.value })} /></Field>
          <Field label="Prioridad"><select style={inputStyle()} value={form.priority || "Media"} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>Baja</option><option>Media</option><option>Alta</option><option>Urgente</option></select></Field>
        </div>
        <Field label="Concepto"><input style={inputStyle()} value={form.concept || ""} onChange={(e) => setForm({ ...form, concept: e.target.value })} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(280px,.55fr)", gap: 12 }}>
          <div style={{ display: "grid", gap: 10 }}><Field label="Tipos de anexo"><select multiple style={inputStyle({ minHeight: 105 })} value={String(form.attachmentTypes || "").split(", ").filter(Boolean)} onChange={(e) => setForm({ ...form, attachmentTypes: Array.from(e.target.selectedOptions).map((x) => x.value).join(", ") })}>{docTypes.map((d) => <option key={d} value={d}>{d}</option>)}</select></Field><AttachmentUploader label="Subir factura / contrato / soporte" value={form.attachments} folder="finanzas/solicitudes-pago" onChange={(attachments) => setForm({ ...form, attachments })} helper="Sube PDF, XML, contrato, cotización, carátula bancaria o evidencia. No escribas nombres manualmente." /></div>
          <Card style={{ boxShadow: "none", padding: 12 }}><SectionTitle title="Validación previa" helper={`Total solicitud: ${money(payableTotal(previewRow))}`} /><ValidationList checks={[{ label: "Proveedor pagable", ok: supplierReady(supplier), fix: "Proveedor" }, { label: "Tiene presupuesto", ok: previewBudget.hasBudget, fix: "Sin presupuesto" }, { label: "Disponible / sobregiro justificado", ok: !previewBudget.over, fix: `Sobregiro ${money(Math.max(0, previewBudget.overspend))}` }, { label: "Contrato no excedido", ok: !previewContract.contract || !previewContract.over, fix: "Excede contrato" }, { label: "Anexos cargados", ok: attachmentCount(form.attachments) > 0, fix: "Anexos" }]} /></Card>
        </div>
        <Button onClick={addPayable}>Guardar solicitud</Button>
      </div> : null}
    </Card>
    <Card><SectionTitle title="Solicitudes" helper="Administración debe marcar revisión, justificar sobregiro y dejar expediente completo antes de enviarlo a dirección." /><MiniTable columns={[{ key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "supplier", label: "Proveedor", render: (r) => { const s = data.suppliers.find((x) => x.id === r.supplierId); return <EntityLink onClick={() => setSelectedSupplier(s)}>{supplierDisplayName(r, data)}</EntityLink>; } }, { key: "concept", label: "Concepto", render: (r) => <EntityLink onClick={() => setSelectedPayment(r)}>{r.concept}</EntityLink> }, { key: "paymentStage", label: "Etapa" }, { key: "categoryId", label: "Partida", render: (r) => categoryMap[r.categoryId]?.name }, { key: "amount", label: "Total", render: (r) => money(payableTotal(r)) }, { key: "budget", label: "Presupuesto", render: (r) => { const b = budgetCheck(data, r); return <Pill tone={!b.hasBudget || (b.over && !r.overspendApprovedByAdmin) ? "danger" : "ok"}>{!b.hasBudget ? "Sin presupuesto" : b.over ? `Sobregiro ${money(b.overspend)}` : `Disp. ${money(b.available)}`}</Pill>; } }, { key: "docs", label: "Anexos", render: (r) => <Pill tone={attachmentCount(r.attachments) ? "ok" : "warn"}>{attachmentCount(r.attachments)}</Pill> }, { key: "status", label: "Estado", render: (r) => <select value={r.status} onChange={(e) => updateRecord("payables", r.id, { status: e.target.value })} style={inputStyle({ padding: 8, minWidth: 170 })}>{statuses.map((s) => <option key={s}>{s}</option>)}</select> }, { key: "actions", label: "Admin", render: (r) => { const check = canSendToAuthorization(data, r); return <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => { const b = budgetCheck(data, r); updateRecord("payables", r.id, { adminReviewed: true, status: b.over && !r.overspendApprovedByAdmin ? "Observado" : "En revisión", adminReviewedAt: todayIso() }); }}>Revisar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => { const reason = window.prompt("Motivo administrativo del sobregiro / excepción", r.overspendReason || ""); if (reason !== null) updateRecord("payables", r.id, { overspendApprovedByAdmin: true, overspendReason: reason, adminComment: reason }); }}>Justificar sobregiro</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => setSelectedPayment(r)}>Revisar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => setEditingPayment(r)}>Editar</Button><Button variant="success" style={{ padding: "7px 9px", fontSize: 12 }} disabled={!check.ok} onClick={() => updateRecord("payables", r.id, { status: "Listo para autorización", readyForApprovalAt: todayIso() })}>Enviar a Autorización</Button></div>; } }]} rows={rows} /></Card>
    <PaymentContextModal row={selectedPayment} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedPayment(null)} />
    <PaymentEditModal row={editingPayment} data={data} onClose={() => setEditingPayment(null)} onSave={(patch) => { updateRecord("payables", editingPayment.id, patch); setEditingPayment(null); }} />
    <SupplierContextModal supplier={selectedSupplier} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedSupplier(null)} />
  </div>;
}

function Authorizations({ data, projectMap, categoryMap, updateRecord }) {
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const rows = data.payables.filter((p) => p.status === "Listo para autorización");
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Autorización final" helper="La autorización final solo revisa solicitudes completas: proveedor validado, presupuesto revisado, anexos y comentario administrativo." />
      <ProgressLine items={[{ label: "Capturado", done: true }, { label: "Admin revisó", done: true }, { label: "Dirección", active: true }, { label: "Pago" }, { label: "Conciliado" }]} />
    </Card>
    <Card><MiniTable columns={[{ key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "supplier", label: "Proveedor", render: (r) => { const s = data.suppliers.find((x) => x.id === r.supplierId); return <EntityLink onClick={() => setSelectedSupplier(s)}>{supplierDisplayName(r, data)}</EntityLink>; } }, { key: "concept", label: "Concepto", render: (r) => <EntityLink onClick={() => setSelectedPayment(r)}>{r.concept}</EntityLink> }, { key: "categoryId", label: "Partida", render: (r) => categoryMap[r.categoryId]?.name }, { key: "amount", label: "Total", render: (r) => money(payableTotal(r)) }, { key: "summary", label: "Resumen", render: (r) => { const b = budgetCheck(data, r); const ctc = contractCheck(data, r); return <div style={{ minWidth: 230, display: "grid", gap: 4 }}><span>Presupuesto: {b.hasBudget ? money(b.budget) : "Sin presupuesto"}</span><span>Disponible antes: {money(b.available)}</span>{b.over ? <span style={{ color: c.red, fontWeight: 900 }}>Sobregiro: {money(b.overspend)}</span> : <span style={{ color: "#166534", fontWeight: 900 }}>Sin sobregiro</span>}{ctc.contract ? <span>Contrato: {money(ctc.contract.amount)} · saldo {money(ctc.remaining)}</span> : <span>Sin contrato ligado</span>}</div>; } }, { key: "docs", label: "Anexos", render: (r) => <AttachmentViewer value={r.attachments} /> }, { key: "admin", label: "Admin", render: (r) => <div style={{ minWidth: 190 }}>{r.adminReviewed ? <Pill tone="ok">Revisado</Pill> : <Pill tone="warn">Sin revisión</Pill>}<div style={{ color: c.muted, fontSize: 12, marginTop: 5 }}>{r.adminComment || r.overspendReason || "Sin comentario"}</div></div> }, { key: "actions", label: "Decisión", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => setSelectedPayment(r)}>Revisar expediente</Button><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("payables", r.id, { status: "Autorizado", authorizedBy: "rodrigo@tritondesarrollos.com", authorizedAt: todayIso() })}>Autorizar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("payables", r.id, { status: "Observado", directorComment: window.prompt("¿Qué se debe corregir?", "") || "Corrección solicitada" })}>Solicitar corrección</Button><Button variant="danger" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("payables", r.id, { status: "Rechazado", rejectedAt: todayIso() })}>Rechazar</Button></div> }]} rows={rows} empty="No hay solicitudes listas para autorización final." /></Card>
    <PaymentContextModal row={selectedPayment} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedPayment(null)} onAuthorize={(r) => { updateRecord("payables", r.id, { status: "Autorizado", authorizedBy: "rodrigo@tritondesarrollos.com", authorizedAt: todayIso() }); setSelectedPayment(null); }} onCorrection={(r) => updateRecord("payables", r.id, { status: "Observado", directorComment: window.prompt("¿Qué se debe corregir?", "") || "Corrección solicitada" })} onReject={(r) => { updateRecord("payables", r.id, { status: "Rechazado", rejectedAt: todayIso() }); setSelectedPayment(null); }} />
    <SupplierContextModal supplier={selectedSupplier} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedSupplier(null)} />
  </div>;
}

function ScheduledPayments({ data, projectMap, categoryMap, updateRecord, addRecord }) {
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [batchDate, setBatchDate] = useState(todayIso());
  const rows = data.payables.filter((p) => ["Autorizado", "Programado"].includes(p.status));
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
      <MiniTable columns={[{ key: "select", label: "", render: (r) => <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggle(r.id)} /> }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "supplier", label: "Proveedor", render: (r) => { const s = data.suppliers.find((x) => x.id === r.supplierId); return <EntityLink onClick={() => setSelectedSupplier(s)}>{supplierDisplayName(r, data)}</EntityLink>; } }, { key: "concept", label: "Concepto", render: (r) => <EntityLink onClick={() => setSelectedPayment(r)}>{r.concept}</EntityLink> }, { key: "requiredDate", label: "Fecha requerida" }, { key: "scheduledDate", label: "Fecha programada", render: (r) => r.scheduledDate || "Sin programar" }, { key: "amount", label: "Total", render: (r) => money(payableTotal(r)) }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => setSelectedPayment(r)}>Revisar</Button><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("payables", r.id, { status: "Programado", scheduledDate: batchDate })}>Programar uno</Button><Button variant="success" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => pay(r)}>Registrar pago</Button></div> }]} rows={rows} />
    </Card>
    <PaymentContextModal row={selectedPayment} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedPayment(null)} />
    <SupplierContextModal supplier={selectedSupplier} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedSupplier(null)} />
  </div>;
}

function PaidPayments({ data, projectMap, categoryMap }) {
  const [selectedPayment, setSelectedPayment] = useState(null);
  return <div style={{ display: "grid", gap: 16 }}><Card><SectionTitle title="Pagos realizados" helper="Comprobantes de transferencia, referencia bancaria y relación con solicitud. Da clic en la solicitud para ver expediente completo." /><MiniTable columns={[{ key: "date", label: "Fecha" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "payableId", label: "Solicitud", render: (r) => { const payable = data.payables.find((p) => p.id === r.payableId); return payable ? <EntityLink onClick={() => setSelectedPayment(payable)}>{payable.concept}</EntityLink> : r.payableId; } }, { key: "amount", label: "Monto", render: (r) => money(r.amount) }, { key: "bank", label: "Banco" }, { key: "reference", label: "Referencia" }, { key: "reconciled", label: "Conciliado", render: (r) => <Pill tone={r.reconciled ? "ok" : "warn"}>{r.reconciled ? "Sí" : "Pendiente"}</Pill> }]} rows={data.payments} /></Card><PaymentContextModal row={selectedPayment} data={data} projectMap={projectMap} categoryMap={categoryMap} onClose={() => setSelectedPayment(null)} /></div>;
}
function BankReconciliation({ data, projectMap, updateRecord }) {
  return <div style={{ display: "grid", gap: 16 }}><Card><SectionTitle title="Conciliación bancaria" helper="Cruce contra estado de cuenta. Marca diferencia si el importe bancario no coincide con el pago." /><MiniTable columns={[{ key: "date", label: "Fecha" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "amount", label: "Monto sistema", render: (r) => money(r.amount) }, { key: "bank", label: "Banco" }, { key: "reference", label: "Referencia" }, { key: "reconciled", label: "Estatus", render: (r) => <Pill tone={r.reconciled ? "ok" : "danger"}>{r.reconciled ? "Conciliado" : "Pendiente"}</Pill> }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button style={{ padding: "7px 9px", fontSize: 12 }} disabled={r.reconciled} onClick={() => { const bankAmount = Number(window.prompt("Monto en banco", r.amount) || r.amount); updateRecord("payments", r.id, { reconciled: true, reconciledAt: todayIso(), bankAmount, difference: bankAmount - Number(r.amount || 0) }); }}>Conciliar</Button><Button variant="secondary" style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("payments", r.id, { reconciled: false, difference: Number(window.prompt("Diferencia detectada", r.difference || 0) || 0) })}>Marcar diferencia</Button></div> }]} rows={data.payments} /></Card></div>;
}

function PettyCash({ data, projectMap, categoryMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const openByResponsible = (responsible) => data.pettyCash.some((cc) => cc.responsible?.toLowerCase() === String(responsible || "").toLowerCase() && !["Cerrada", "Cancelada"].includes(cc.status));
  const cashRows = data.pettyCash.map((cc) => {
    const expenses = data.pettyExpenses.filter((e) => e.cashId === cc.id);
    const spent = expenses.reduce((a, e) => a + Number(e.amount || 0), 0);
    const observed = expenses.filter((e) => ["Observado", "Rechazado", "Pendiente comprobante", "Pendiente factura/XML"].includes(e.status)).length;
    const pending = expenses.filter((e) => !["Aceptado", "Rechazado"].includes(e.status)).length;
    return { ...cc, spent, balance: Number(cc.amount || 0) - spent, observed, pending };
  });
  function createCash() {
    if (openByResponsible(form.responsible)) { alert("Este responsable tiene una caja chica abierta o en revisión. Primero debe liquidarse o cerrarse."); return; }
    addRecord("pettyCash", { projectId: form.projectId || "arenna", name: form.name || "Caja chica", responsible: form.responsible || "Responsable", amount: Number(form.amount || 0), status: "Abierta", openedAt: todayIso(), originAccount: form.originAccount || "Banco por definir", notes: form.notes || "" });
  }
  function addExpense() {
    const cash = data.pettyCash.find((cc) => cc.id === (form.cashId || data.pettyCash[0]?.id));
    if (!cash) { alert("Primero crea una caja chica."); return; }
    addRecord("pettyExpenses", { cashId: cash.id, projectId: cash.projectId, date: form.date || todayIso(), concept: form.concept || "Gasto menor", categoryId: form.categoryId || "caja_chica", amount: Number(form.amount || 0), supplier: form.supplier || "", status: form.hasReceipt === "No" ? "Pendiente comprobante" : "Por revisar", hasReceipt: form.hasReceipt !== "No", invoiceRequired: form.invoiceRequired === "Sí", attachments: normalizeAttachments(form.attachments), comment: form.comment || "" });
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Caja chica operativa" helper="Mini flujo de cuentas por pagar: apertura → comprobantes → revisión → liquidación → cierre financiero." />
      <ProgressLine items={[{ label: "Crear caja", done: true }, { label: "Cargar gastos", active: true }, { label: "Revisión admin" }, { label: "Liquidar" }, { label: "Cerrar" }]} />
    </Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Cajas abiertas" helper="No se permite abrir otra caja al mismo responsable si tiene una sin liquidar." /><Button onClick={() => setShowForm(showForm === "cash" ? null : "cash")}>Crear caja</Button></div>
      {showForm === "cash" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Responsable"><input style={inputStyle()} value={form.responsible || ""} onChange={(e) => setForm({ ...form, responsible: e.target.value })} /></Field><Field label="Monto asignado"><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Cuenta / origen"><input style={inputStyle()} value={form.originAccount || ""} onChange={(e) => setForm({ ...form, originAccount: e.target.value })} /></Field></div><Field label="Nombre / motivo"><input style={inputStyle()} value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Button onClick={createCash}>Guardar caja chica</Button></div> : null}
    </Card>
    <Card><MiniTable columns={[{ key: "name", label: "Caja" }, { key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "responsible", label: "Responsable" }, { key: "amount", label: "Asignado", render: (r) => money(r.amount) }, { key: "spent", label: "Comprobado", render: (r) => money(r.spent) }, { key: "balance", label: "Saldo", render: (r) => <Pill tone={r.balance >= 0 ? "ok" : "danger"}>{money(r.balance)}</Pill> }, { key: "pending", label: "Pendientes", render: (r) => <Pill tone={r.pending || r.observed ? "warn" : "ok"}>{r.pending} / obs {r.observed}</Pill> }, { key: "status", label: "Estado", render: (r) => <Pill tone={statusTone(r.status)}>{r.status}</Pill> }, { key: "actions", label: "Acción", render: (r) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Button style={{ padding: "7px 9px", fontSize: 12 }} onClick={() => updateRecord("pettyCash", r.id, { status: "En revisión" })}>Solicitar liquidación</Button><Button variant="success" style={{ padding: "7px 9px", fontSize: 12 }} disabled={r.pending > 0 || r.observed > 0} onClick={() => updateRecord("pettyCash", r.id, { status: "Cerrada", closedAt: todayIso() })}>Cerrar</Button></div> }]} rows={cashRows} /></Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Comprobantes / gastos" helper="Cada gasto se revisa individualmente. Observados o sin comprobante bloquean el cierre de caja." /><Button onClick={() => setShowForm(showForm === "cashExpense" ? null : "cashExpense")}>Agregar gasto</Button></div>
      {showForm === "cashExpense" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Caja"><select style={inputStyle()} value={form.cashId || data.pettyCash[0]?.id || ""} onChange={(e) => setForm({ ...form, cashId: e.target.value })}>{data.pettyCash.map((cc) => <option key={cc.id} value={cc.id}>{cc.name} · {cc.responsible}</option>)}</select></Field><Field label="Fecha"><input type="date" style={inputStyle()} value={form.date || todayIso()} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field><Field label="Categoría"><select style={inputStyle()} value={form.categoryId || "caja_chica"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((cat) => cat.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field><Field label="Monto"><input type="number" style={inputStyle()} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Comprobante"><select style={inputStyle()} value={form.hasReceipt || "Sí"} onChange={(e) => setForm({ ...form, hasReceipt: e.target.value })}><option>Sí</option><option>No</option></select></Field><Field label="Factura/XML requerido"><select style={inputStyle()} value={form.invoiceRequired || "No"} onChange={(e) => setForm({ ...form, invoiceRequired: e.target.value })}><option>No</option><option>Sí</option></select></Field></div><Field label="Concepto"><input style={inputStyle()} value={form.concept || ""} onChange={(e) => setForm({ ...form, concept: e.target.value })} /></Field><AttachmentUploader label="Subir ticket / factura / XML" value={form.attachments} folder="finanzas/caja-chica" onChange={(attachments) => setForm({ ...form, attachments })} helper="Carga ticket, factura PDF, XML o foto del comprobante." /><Button onClick={addExpense}>Guardar gasto</Button></div> : null}
    </Card>
    <Card><MiniTable columns={[{ key: "date", label: "Fecha" }, { key: "concept", label: "Concepto" }, { key: "categoryId", label: "Categoría", render: (r) => categoryMap[r.categoryId]?.name }, { key: "amount", label: "Monto", render: (r) => money(r.amount) }, { key: "attachments", label: "Anexos", render: (r) => <AttachmentViewer value={r.attachments} /> }, { key: "status", label: "Estado", render: (r) => <select value={r.status} onChange={(e) => updateRecord("pettyExpenses", r.id, { status: e.target.value })} style={inputStyle({ padding: 8, minWidth: 160 })}>{["Por revisar", "Aceptado", "Observado", "Rechazado", "Pendiente comprobante", "Pendiente factura/XML"].map((x) => <option key={x}>{x}</option>)}</select> }]} rows={data.pettyExpenses} /></Card>
  </div>;
}

function supplierDisplayName(row, data) {
  const supplier = data.suppliers.find((s) => s.id === row.supplierId);
  return supplier?.tradeName || row.supplier || "Proveedor";
}

function Suppliers({ data, categoryMap, addRecord, updateRecord, showForm, setShowForm, form, setForm }) {
  const statuses = ["Pendiente revisión", "Activo", "Bloqueado", "Inactivo"];
  function createSupplier() {
    addRecord("suppliers", { tradeName: form.tradeName || "Proveedor", legalName: form.legalName || form.tradeName || "Razón social", rfc: form.rfc || "", type: form.type || "Proveedor", contact: form.contact || "", email: form.email || "", phone: form.phone || "", status: "Pendiente revisión", fiscalStatus: form.fiscalStatus || "Pendiente", bankStatus: form.bankStatus || "Pendiente", bank: form.bank || "", clabe: form.clabe || "", accountHolder: form.accountHolder || form.legalName || "", categoryId: form.categoryId || "construccion", requiresContract: form.requiresContract === "Sí", documents: String(form.documents || "").split(",").map((x) => x.trim()).filter(Boolean), createdAt: todayIso(), reviewedBy: "" });
  }
  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Proveedores" helper="Alta segura de proveedores. No se puede pagar si el proveedor no está activo, si fiscal/banco no están validados o si está bloqueado." />
      <ProgressLine items={[{ label: "Alta", done: true }, { label: "Documentos" }, { label: "Validación fiscal" }, { label: "Validación bancaria" }, { label: "Activo" }]} />
    </Card>
    <Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><SectionTitle title="Alta de proveedor" helper="Captura solo lo mínimo; administración completa documentos y validaciones." /><Button onClick={() => setShowForm(showForm === "supplier" ? null : "supplier")}>Nuevo proveedor</Button></div>
      {showForm === "supplier" ? <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
          <Field label="Nombre comercial"><input style={inputStyle()} value={form.tradeName || ""} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} /></Field>
          <Field label="Razón social"><input style={inputStyle()} value={form.legalName || ""} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></Field>
          <Field label="RFC"><input style={inputStyle()} value={form.rfc || ""} onChange={(e) => setForm({ ...form, rfc: e.target.value.toUpperCase() })} /></Field>
          <Field label="Tipo"><select style={inputStyle()} value={form.type || "Proveedor"} onChange={(e) => setForm({ ...form, type: e.target.value })}><option>Constructora</option><option>Servicios profesionales</option><option>Materiales</option><option>Dependencia</option><option>Arrendador</option><option>Proveedor</option></select></Field>
          <Field label="Contacto"><input style={inputStyle()} value={form.contact || ""} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
          <Field label="Correo"><input style={inputStyle()} value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Categoría default"><select style={inputStyle()} value={form.categoryId || "construccion"} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{data.categories.filter((cat) => cat.budgetable).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></Field>
          <Field label="Requiere contrato"><select style={inputStyle()} value={form.requiresContract || "No"} onChange={(e) => setForm({ ...form, requiresContract: e.target.value })}><option>No</option><option>Sí</option></select></Field>
          <Field label="Banco"><input style={inputStyle()} value={form.bank || ""} onChange={(e) => setForm({ ...form, bank: e.target.value })} /></Field>
          <Field label="CLABE"><input style={inputStyle()} value={form.clabe || ""} onChange={(e) => setForm({ ...form, clabe: e.target.value })} /></Field>
          <Field label="Beneficiario"><input style={inputStyle()} value={form.accountHolder || ""} onChange={(e) => setForm({ ...form, accountHolder: e.target.value })} /></Field>
        </div>
        <Field label="Documentos cargados"><textarea style={inputStyle({ minHeight: 72 })} placeholder="Constancia fiscal, carátula bancaria, opinión cumplimiento, contrato..." value={form.documents || ""} onChange={(e) => setForm({ ...form, documents: e.target.value })} /></Field>
        <Button onClick={createSupplier}>Guardar proveedor</Button>
      </div> : null}
    </Card>
    <Card><SectionTitle title="Validación administrativa" helper="Activa proveedores solo cuando documentos fiscales y datos bancarios estén revisados." /><MiniTable columns={[{ key: "tradeName", label: "Proveedor" }, { key: "rfc", label: "RFC" }, { key: "type", label: "Tipo" }, { key: "categoryId", label: "Categoría", render: (r) => categoryMap[r.categoryId]?.name }, { key: "fiscalStatus", label: "Fiscal", render: (r) => <select value={r.fiscalStatus || "Pendiente"} onChange={(e) => updateRecord("suppliers", r.id, { fiscalStatus: e.target.value })} style={inputStyle({ padding: 8, minWidth: 125 })}>{["Pendiente", "Validado", "Observado", "No aplica"].map((x) => <option key={x}>{x}</option>)}</select> }, { key: "bankStatus", label: "Banco", render: (r) => <select value={r.bankStatus || "Pendiente"} onChange={(e) => updateRecord("suppliers", r.id, { bankStatus: e.target.value })} style={inputStyle({ padding: 8, minWidth: 125 })}>{["Pendiente", "Validado", "Observado", "No aplica"].map((x) => <option key={x}>{x}</option>)}</select> }, { key: "documents", label: "Anexos", render: (r) => (r.documents || []).join(", ") || "Pendiente" }, { key: "ready", label: "Listo", render: (r) => <Pill tone={supplierReady(r) ? "ok" : "warn"}>{supplierReady(r) ? "Pagable" : "Bloquea pago"}</Pill> }, { key: "status", label: "Estatus", render: (r) => <select value={r.status} onChange={(e) => updateRecord("suppliers", r.id, { status: e.target.value, reviewedBy: "admin@tritondesarrollos.com" })} style={inputStyle({ padding: 8, minWidth: 150 })}>{statuses.map((s) => <option key={s}>{s}</option>)}</select> }]} rows={data.suppliers} /></Card>
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
  const statuses = ["No iniciado", "Preparando documentos", "Ingresado", "En revisión", "Observado", "En corrección", "Aprobado", "Rechazado", "Vencido", "Cerrado"];
  return <div style={{ display: "grid", gap: 16 }}><Card><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><SectionTitle title="Trámites por proyecto" helper="Cada trámite debe tener responsable, siguiente acción y fecha compromiso. Evita el estatus genérico “en proceso”." /><Button onClick={() => setShowForm(showForm === "permit" ? null : "permit")}>Nuevo trámite</Button></div>{showForm === "permit" ? <div style={{ marginTop: 12 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}><Field label="Proyecto"><select style={inputStyle()} value={form.projectId || "arenna"} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Nombre"><input style={inputStyle()} value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Dependencia"><input style={inputStyle()} value={form.agency || ""} onChange={(e) => setForm({ ...form, agency: e.target.value })} /></Field><Field label="Responsable"><input style={inputStyle()} value={form.owner || ""} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></Field><Field label="Fecha compromiso"><input style={inputStyle()} type="date" value={form.dueDate || todayIso()} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field></div><Field label="Siguiente acción"><textarea style={inputStyle({ minHeight: 70 })} value={form.nextAction || ""} onChange={(e) => setForm({ ...form, nextAction: e.target.value })} /></Field><Button style={{ marginTop: 10 }} onClick={() => addRecord("permits", { projectId: form.projectId || "arenna", name: form.name || "Trámite", agency: form.agency || "Dependencia", status: "No iniciado", priority: "Media", owner: form.owner || "Responsable", nextAction: form.nextAction || "Definir siguiente acción", dueDate: form.dueDate || todayIso(), documents: "" })}>Guardar trámite</Button></div> : null}</Card><Card><MiniTable columns={[{ key: "projectId", label: "Proyecto", render: (r) => projectMap[r.projectId]?.name }, { key: "name", label: "Trámite" }, { key: "agency", label: "Dependencia" }, { key: "owner", label: "Responsable" }, { key: "nextAction", label: "Siguiente acción" }, { key: "dueDate", label: "Fecha compromiso" }, { key: "status", label: "Estado", render: (r) => <select value={r.status} onChange={(e) => updateRecord("permits", r.id, { status: e.target.value })} style={inputStyle({ padding: 8, minWidth: 150 })}>{statuses.map((s) => <option key={s}>{s}</option>)}</select> }, { key: "priority", label: "Prioridad", render: (r) => <Pill tone={r.priority === "Alta" ? "danger" : "primary"}>{r.priority}</Pill> }]} rows={rows} /></Card></div>;
}

function Reports({ totals, data, projectMap, categoryMap }) {
  return <div style={{ display: "grid", gap: 16 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 14 }}><Card><Pill tone="primary">Rentas esperadas</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totals.rentExpected)}</div></Card><Card><Pill tone="ok">Rentas cobradas</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totals.rentPaid)}</div></Card><Card><Pill tone="danger">Cartera vencida</Pill><div style={{ fontSize: 28, fontWeight: 950, marginTop: 10 }}>{money(totals.rentOverdue)}</div></Card></div><Card><SectionTitle title="Reporte directivo" helper="Consolidado para revisión semanal: pagos, rentas, caja chica y trámites." /><MiniTable columns={[{ key: "name", label: "Proyecto" }, { key: "type", label: "Tipo" }, { key: "payables", label: "Cuentas por pagar", render: (r) => money(data.payables.filter((p) => p.projectId === r.id).reduce((a, p) => a + Number(p.amount || 0) + Number(p.iva || 0), 0)) }, { key: "permits", label: "Trámites abiertos", render: (r) => data.permits.filter((p) => p.projectId === r.id && !["Aprobado", "Cerrado"].includes(p.status)).length }, { key: "status", label: "Estatus", render: (r) => <Pill tone="primary">{r.status}</Pill> }]} rows={data.projects} /></Card></div>;
}

function Config({ data, setData, resetDemo }) {
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState("");

  async function initializeLaunchUsers() {
    if (!window.confirm("Esto creará los usuarios base de lanzamiento y eliminará usuarios demo conocidos de Firestore. Las cuentas de acceso en Firebase Authentication deben existir con contraseña. ¿Continuar?")) return;
    setSeeding(true);
    setSeedMessage("");
    try {
      await Promise.all(legacyDemoUserIds.map((id) => deleteDoc(doc(firestore, "users", id)).catch(() => null)));

      const buildUserPayload = (user) => ({
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: user.permissions,
        mentionHandle: user.mentionHandle,
        active: true,
        isSystemUser: true,
        modules: user.modules,
        createdBySetup: true,
        updatedAt: serverTimestamp(),
      });

      await Promise.all(launchUsers.map((user) => setDoc(doc(firestore, "users", user.email.toLowerCase()), buildUserPayload(user), { merge: true })));

      const currentEmail = firebaseAuth.currentUser?.email?.toLowerCase();
      const currentUid = firebaseAuth.currentUser?.uid;
      const currentLaunchUser = launchUsers.find((user) => user.email.toLowerCase() === currentEmail);
      if (currentUid && currentLaunchUser) {
        await setDoc(doc(firestore, "users", currentUid), buildUserPayload(currentLaunchUser), { merge: true });
      }

      setData((prev) => ({ ...prev, users: launchUsers }));
      setSeedMessage("Usuarios base listos en Firestore por correo. La app ya puede leer esos permisos al iniciar sesión. Si estás dentro con Rodrigo, también se creó/espejó su documento por UID automáticamente.");
    } catch (error) {
      console.error(error);
      setSeedMessage(`No se pudieron inicializar los usuarios: ${error.message || error}`);
    } finally {
      setSeeding(false);
    }
  }

  return <div style={{ display: "grid", gap: 16 }}>
    <Card><SectionTitle title="Catálogos base" helper="Se cargaron categorías derivadas de tus hojas de gastos/presupuestos y tipos de rentas: locales, terrenos, casas, departamentos y oficinas." /><MiniTable columns={[{ key: "name", label: "Categoría" }, { key: "group", label: "Grupo" }, { key: "budgetable", label: "Presupuestable", render: (r) => r.budgetable ? "Sí" : "No" }]} rows={data.categories} /></Card>
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <SectionTitle title="Usuarios base del sistema" helper="Usuarios de lanzamiento. Constructoras se gestionan en Operación → Equipo construcción, no en configuración general." />
        <Button onClick={initializeLaunchUsers} disabled={seeding}>{seeding ? "Creando usuarios..." : "Inicializar usuarios base"}</Button>
      </div>
      {seedMessage ? <div style={{ margin: "10px 0", padding: 12, borderRadius: 14, background: seedMessage.startsWith("No se") ? c.redSoft : c.greenSoft, color: seedMessage.startsWith("No se") ? c.red : "#166534", fontWeight: 800 }}>{seedMessage}</div> : null}
      <div style={{ marginBottom: 12, padding: 12, borderRadius: 16, background: c.primarySoft, color: c.text, fontSize: 13, lineHeight: 1.45 }}>
        Este botón crea los perfiles y permisos en Firestore. Por seguridad, las contraseñas se crean en Firebase Authentication. Usa correos reales: rodrigo@tritondesarrollos.com, admin@tritondesarrollos.com y supervision@tritondesarrollos.com.
      </div>
      <MiniTable columns={[{ key: "name", label: "Nombre" }, { key: "role", label: "Rol" }, { key: "email", label: "Correo" }, { key: "permissions", label: "Permisos" }]} rows={data.users} />
    </Card>
    <Card><SectionTitle title="Mantenimiento" helper="Solo para pruebas locales o cuando quieras restaurar la información demo de TRITON OS." /><Button variant="danger" onClick={resetDemo}>Restablecer datos demo</Button></Card>
  </div>;
}

function SimpleForm({ fields, labels, form, setForm, onSubmit }) {
  return <div style={{ marginTop: 14, display: "grid", gap: 10 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>{fields.map((field) => <Field key={field} label={labels[field] || field}><input style={inputStyle()} value={form[field] || ""} onChange={(e) => setForm({ ...form, [field]: e.target.value })} /></Field>)}</div><Button onClick={onSubmit} style={{ justifySelf: "start" }}>Guardar</Button></div>;
}
