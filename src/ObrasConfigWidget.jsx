import React, { useEffect, useMemo, useState } from "react";
import { getApps } from "firebase/app";
import { collection, doc, getDocs, getFirestore, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

const defaultObraId = "";
const inputBase = { width: "100%", minHeight: 44, border: "1px solid rgba(60,60,67,0.16)", borderRadius: 14, padding: "10px 12px", background: "#fff", color: "#1d1d1f", outline: "none", boxSizing: "border-box" };
const buttonBase = { border: "1px solid rgba(60,60,67,0.12)", borderRadius: 999, padding: "10px 14px", fontWeight: 850, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" };
const th = { padding: "10px", fontSize: 11, fontWeight: 950, color: "#6e6e73", textTransform: "uppercase", letterSpacing: 0.35, background: "rgba(242,242,247,0.96)", borderBottom: "1px solid rgba(60,60,67,0.10)" };
const td = { padding: "10px", borderBottom: "1px solid rgba(60,60,67,0.10)", verticalAlign: "top", fontSize: 13, color: "#1d1d1f" };

function getDb() { const app = getApps()[0]; return app ? getFirestore(app) : null; }
function getStorageClient() { const app = getApps()[0]; return app ? getStorage(app) : null; }
function money(value) { return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function parseNumber(value) { const parsed = Number(String(value ?? "").replace(/\$/g, "").replace(/,/g, "").replace(/\s/g, "").trim()); return Number.isFinite(parsed) ? parsed : 0; }
function slugify(text = "") { return String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function cleanText(text = "") { return String(text).replace(/Ã“/g, "Ó").replace(/Ã‰/g, "É").replace(/Ã/g, "Á").replace(/Ã/g, "Í").replace(/Ãš/g, "Ú").replace(/Ã‘/g, "Ñ").replace(/Ã³/g, "ó").replace(/Ã©/g, "é").replace(/Ã¡/g, "á").replace(/Ã­/g, "í").replace(/Ãº/g, "ú").replace(/Ã±/g, "ñ").replace(/Â/g, "").trim(); }
function parseCsv(text) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') { if (inQuotes && next === '"') { current += '"'; i += 1; } else inQuotes = !inQuotes; continue; }
    if (char === "," && !inQuotes) { row.push(current); current = ""; continue; }
    if ((char === "\n" || char === "\r") && !inQuotes) { if (char === "\r" && next === "\n") i += 1; row.push(current); if (row.some((cell) => String(cell).trim() !== "")) rows.push(row); row = []; current = ""; continue; }
    current += char;
  }
  row.push(current);
  if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
  return rows;
}
function normalizeCatalogItem(item, index = 0) {
  const cantidad = parseNumber(item.cantidad ?? item.Unidades ?? item.unidades ?? item.cantidadContratada ?? 1);
  const precioUnitario = parseNumber(item.precioUnitario ?? item["P.U."] ?? item.pu ?? item.PU ?? item.precio_unitario ?? 0);
  const clave = cleanText(item.clave || item.Clave || item.id || `CON-${index + 1}`);
  const partida = cleanText(item.partida || item.PARTIDA || item.capitulo || "General");
  const concepto = cleanText(item.concepto || item.descripcion || item.Descripcion || item.descripción || item.description || "Concepto sin nombre");
  const unidad = cleanText(item.unidad || item.Unidad || "lote");
  const rowNumber = Number(item.rowNumber || index + 1);
  return { id: item.id || `${slugify(partida)}-${slugify(clave)}-${String(rowNumber).padStart(4, "0")}`, clave, partida, concepto, descripcion: concepto, unidad, cantidad, precioUnitario, importe: cantidad * precioUnitario, fechaEntrega: item.fechaEntrega || item.fecha_entrega || item["Fecha Entrega"] || item["Fecha compromiso"] || "", rowNumber, sourceFileName: item.sourceFileName || "" };
}
function rowsToCatalog(rows, sourceFileName = "") {
  if (!rows.length) return [];
  const headers = rows[0].map((header) => cleanText(header));
  return rows.slice(1).map((row, index) => {
    const raw = {};
    headers.forEach((header, columnIndex) => { raw[header] = row[columnIndex] ?? ""; });
    return normalizeCatalogItem({ PARTIDA: raw.PARTIDA, clave: raw.clave || raw.Clave, descripcion: raw.descripcion || raw.Descripcion || raw.DESCRIPCION || raw.DESCRIPCIÓN, Unidades: raw.Unidades || raw.unidades || raw.Cantidad || raw.cantidad, unidad: raw.unidad || raw.Unidad, "P.U.": raw["P.U."] || raw.PU || raw["Precio Unitario"] || raw.precioUnitario, fechaEntrega: raw["Fecha Entrega"] || raw.fechaEntrega || raw["Fecha compromiso"] || raw["fecha compromiso"] || raw.fecha_entrega, rowNumber: index + 2, sourceFileName }, index);
  }).filter((item) => item.clave && item.concepto && item.precioUnitario > 0);
}
function downloadTextFile(fileName, content, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function downloadCatalogTemplate() {
  const rows = [
    ["PARTIDA", "clave", "descripcion", "Unidades", "unidad", "P.U.", "Fecha Entrega"],
    ["CIMENTACION", "CIM-001", "Descripción del concepto conforme al catálogo autorizado", "1", "lote", "0", "2026-12-31"],
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadTextFile("plantilla-catalogo-conceptos-triton.csv", csv);
}
const documentCategories = ["Planos del proyecto", "Renders", "Detalles de arquitectura", "Ingenierías", "Especificaciones", "Acabados", "Control de cambios", "Autorizaciones", "Minutas", "Garantías / manuales", "Otros"];
const documentScopes = ["Toda la obra", "Modelo específico", "Bloque específico", "Unidades específicas"];
const defaultDocBatchMeta = { category: "Planos del proyecto", version: "", scope: "Toda la obra", model: "", units: "", status: "vigente", authorizedBy: "", authorizationDate: "", description: "" };
function Field({ label, children }) { return <label style={{ display: "block", marginBottom: 12 }}><div style={{ fontSize: 13, fontWeight: 850, color: "#1d1d1f", marginBottom: 6 }}>{label}</div>{children}</label>; }
function Card({ title, subtitle, children }) { return <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 22, padding: 16, background: "rgba(255,255,255,0.92)", boxShadow: "0 8px 28px rgba(0,0,0,0.055)", marginBottom: 16 }}>{title ? <div style={{ fontSize: 18, fontWeight: 950, color: "#1d1d1f" }}>{title}</div> : null}{subtitle ? <div style={{ marginTop: 4, color: "#6e6e73", fontSize: 13, lineHeight: 1.45 }}>{subtitle}</div> : null}{children ? <div style={{ marginTop: title || subtitle ? 14 : 0 }}>{children}</div> : null}</div>; }
function Metric({ label, value, helper }) { return <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 20, padding: 15, background: "#fff" }}><div style={{ color: "#6e6e73", fontSize: 12, fontWeight: 800 }}>{label}</div><div style={{ color: "#1d1d1f", fontSize: 24, fontWeight: 950, marginTop: 4 }}>{value}</div>{helper ? <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{helper}</div> : null}</div>; }

export default function ObrasConfigWidget() {
  const [open, setOpen] = useState(false);
  const [obras, setObras] = useState([]);
  const [selectedObraId, setSelectedObraId] = useState(defaultObraId);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importInfo, setImportInfo] = useState(null);
  const [configForm, setConfigForm] = useState({ anticipoPorcentaje: 0, retencionPorcentaje: 0, multaDiaria: 0 });
  const [obraForm, setObraForm] = useState({ name: "", code: "", location: "", totalUnits: "", status: "activa" });
  const [catalogSearch, setCatalogSearch] = useState("");
  const [docBatchRows, setDocBatchRows] = useState([]);
  const [uploadingDocs, setUploadingDocs] = useState(false);

  const selectedObra = obras.find((obra) => obra.id === selectedObraId) || {};
  const catalogTotal = useMemo(() => catalog.reduce((acc, item) => acc + Number(item.importe || 0), 0), [catalog]);
  const partidasCount = useMemo(() => new Set(catalog.map((item) => item.partida)).size, [catalog]);
  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((item) => `${item.partida} ${item.clave} ${item.concepto} ${item.unidad} ${item.fechaEntrega || ""}`.toLowerCase().includes(q));
  }, [catalog, catalogSearch]);

  useEffect(() => { const handler = () => setOpen(true); window.addEventListener("triton-open-obras-config", handler); window.addEventListener("triton-module-obras", handler); return () => { window.removeEventListener("triton-open-obras-config", handler); window.removeEventListener("triton-module-obras", handler); }; }, []);
  useEffect(() => { if (!open) return; loadData(); }, [open, selectedObraId]);
  useEffect(() => { const estimationConfig = selectedObra.estimationConfig || {}; setConfigForm({ anticipoPorcentaje: estimationConfig.anticipoPorcentaje ?? 0, retencionPorcentaje: estimationConfig.retencionPorcentaje ?? 0, multaDiaria: estimationConfig.multaDiaria ?? 0 }); }, [selectedObraId, selectedObra.estimationConfig]);

  async function loadData() {
    const db = getDb();
    if (!db) return;
    setLoading(true);
    try {
      const obrasSnap = await getDocs(collection(db, "obras"));
      const nextObras = obrasSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      setObras(nextObras);
      const activeObraId = selectedObraId || nextObras[0]?.id || "";
      if (activeObraId && activeObraId !== selectedObraId) setSelectedObraId(activeObraId);
      if (!activeObraId) { setCatalog([]); return; }
      const catalogSnap = await getDocs(query(collection(db, "obras", activeObraId, "catalogoConceptos"), orderBy("partida", "asc")));
      setCatalog(catalogSnap.docs.map((item, index) => normalizeCatalogItem({ id: item.id, ...item.data() }, index)));
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  }
  async function saveObra() {
    const db = getDb();
    if (!db) return;
    if (!obraForm.name.trim()) { alert("Agrega el nombre de la obra."); return; }
    const id = slugify(obraForm.code || obraForm.name);
    await setDoc(doc(db, "obras", id), { id, name: obraForm.name.trim(), code: obraForm.code.trim() || id, location: obraForm.location.trim(), totalUnits: Number(obraForm.totalUnits || 0), status: obraForm.status, estimationConfig: { anticipoPorcentaje: 0, retencionPorcentaje: 0, multaDiaria: 0 }, createdAt: serverTimestamp() }, { merge: true });
    setObraForm({ name: "", code: "", location: "", totalUnits: "", status: "activa" });
    setSelectedObraId(id);
    await loadData();
  }
  async function saveEstimationConfig() {
    const db = getDb();
    if (!db || !selectedObraId) return;
    await setDoc(doc(db, "obras", selectedObraId), { estimationConfig: { anticipoPorcentaje: parseNumber(configForm.anticipoPorcentaje), retencionPorcentaje: parseNumber(configForm.retencionPorcentaje), multaDiaria: parseNumber(configForm.multaDiaria) }, updatedAt: serverTimestamp() }, { merge: true });
    alert("Configuración de estimaciones guardada en la obra.");
    await loadData();
  }
  async function importCatalogFile(file) {
    const db = getDb();
    if (!db || !file || !selectedObraId) return;
    setImporting(true);
    try {
      const imported = rowsToCatalog(parseCsv(await file.text()), file.name);
      if (!imported.length) { alert("No pude leer conceptos válidos. Revisa columnas: PARTIDA, clave, descripcion, Unidades, unidad, P.U. y opcional Fecha Entrega."); return; }
      for (const concept of imported) await setDoc(doc(db, "obras", selectedObraId, "catalogoConceptos", concept.id), { ...concept, sourceFileName: file.name, importedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
      const total = imported.reduce((acc, item) => acc + Number(item.importe || 0), 0);
      setImportInfo({ rows: imported.length, total, partidas: Array.from(new Set(imported.map((item) => item.partida))).length, fileName: file.name });
      alert(`Catálogo importado en obra: ${imported.length} conceptos · ${money(total)} por unidad/casa.`);
      await loadData();
    } catch (error) { console.error(error); alert("Ocurrió un error al importar el catálogo."); }
    finally { setImporting(false); }
  }
  async function updateConceptFechaEntrega(concept, fechaEntrega) {
    const db = getDb();
    if (!db || !selectedObraId || !concept?.id) return;
    setCatalog((prev) => prev.map((item) => item.id === concept.id ? { ...item, fechaEntrega } : item));
    await setDoc(doc(db, "obras", selectedObraId, "catalogoConceptos", concept.id), { fechaEntrega, updatedAt: serverTimestamp() }, { merge: true });
  }
  function handleTechnicalDocBatch(files) {
    const nextFiles = Array.from(files || []);
    if (!nextFiles.length) return;
    setDocBatchRows((prev) => [
      ...prev,
      ...nextFiles.map((file, index) => ({
        id: `${Date.now()}-${index}-${slugify(file.name)}`,
        file,
        title: file.name.replace(/\.[^.]+$/, ""),
        ...defaultDocBatchMeta,
      })),
    ]);
  }
  function updateDocBatchRow(id, patch) {
    setDocBatchRows((prev) => prev.map((row) => row.id === id ? { ...row, ...patch } : row));
  }
  function removeDocBatchRow(id) {
    setDocBatchRows((prev) => prev.filter((row) => row.id !== id));
  }
  function applyDocBatchMetaToAll(patch) {
    setDocBatchRows((prev) => prev.map((row) => ({ ...row, ...patch })));
  }
  async function saveTechnicalDocBatch() {
    const db = getDb();
    const storage = getStorageClient();
    if (!db || !storage || !selectedObraId) return;
    if (!docBatchRows.length) { alert("Selecciona archivos técnicos para cargar."); return; }
    const missingTitle = docBatchRows.find((row) => !String(row.title || "").trim());
    if (missingTitle) { alert("Todos los documentos deben tener nombre/título."); return; }
    setUploadingDocs(true);
    try {
      for (const row of docBatchRows) {
        const file = row.file;
        const safeName = `${Date.now()}-${slugify(row.title || file.name)}-${file.name}`;
        const storagePath = `obras/${selectedObraId}/documentos-tecnicos/${safeName}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        const documentId = `${Date.now()}-${slugify(row.title || file.name)}`;
        await setDoc(doc(db, "obras", selectedObraId, "technicalDocuments", documentId), {
          id: documentId,
          title: cleanText(row.title),
          category: row.category || "Otros",
          version: cleanText(row.version || ""),
          scope: row.scope || "Toda la obra",
          model: cleanText(row.model || ""),
          units: String(row.units || "").split(",").map((x) => x.trim()).filter(Boolean),
          status: row.status || "vigente",
          authorizedBy: cleanText(row.authorizedBy || ""),
          authorizationDate: row.authorizationDate || "",
          description: cleanText(row.description || ""),
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          storagePath,
          url,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      alert(`${docBatchRows.length} documentos técnicos cargados correctamente.`);
      setDocBatchRows([]);
    } catch (error) {
      console.error(error);
      alert("Ocurrió un error al cargar el lote de documentos técnicos.");
    } finally {
      setUploadingDocs(false);
    }
  }

  if (!open) return null;

  return <div className="triton-obras-config-module" style={{ position: "fixed", left: "var(--triton-shell-offset, 84px)", top: 0, right: 0, bottom: 0, zIndex: 2147483645, background: "#f5f5f7", overflow: "auto" }}>
    <style>{`@media (max-width: 900px) { .triton-obras-config-module { left: 0 !important; z-index: 2147483647 !important; } }`}</style>
    <div style={{ maxWidth: 1420, margin: "0 auto", padding: "calc(24px + env(safe-area-inset-top, 0px)) 18px 42px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap" }}><div><div style={{ fontSize: 34, fontWeight: 950, color: "#1d1d1f", letterSpacing: -0.7 }}>Obras</div><div style={{ color: "#6e6e73", fontSize: 16, marginTop: 6 }}>Alta de obra, catálogo de conceptos, Fecha Entrega y configuración económica para estimaciones.</div></div><button type="button" onClick={() => setOpen(false)} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>Volver</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <Card title="Obras actuales" subtitle="Selecciona la obra que vas a configurar."><Field label="Obra"><select value={selectedObraId} onChange={(e) => setSelectedObraId(e.target.value)} style={inputBase}>{obras.length ? obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.name || obra.id} · {obra.status || "sin estatus"}</option>) : <option value="">Sin obras cargadas</option>}</select></Field>{selectedObra ? <div style={{ padding: 12, borderRadius: 16, background: "#fff", border: "1px solid rgba(60,60,67,0.12)" }}><div style={{ fontWeight: 950 }}>{selectedObra.name || selectedObra.id}</div><div style={{ color: "#6e6e73", fontSize: 13, marginTop: 4 }}>{selectedObra.location || "Sin ubicación"}</div></div> : null}</Card>
        <Card title="Alta rápida de obra" subtitle="Crea una obra base para después cargar catálogo."><Field label="Nombre"><input value={obraForm.name} onChange={(e) => setObraForm((prev) => ({ ...prev, name: e.target.value }))} style={inputBase} /></Field><Field label="Código"><input value={obraForm.code} onChange={(e) => setObraForm((prev) => ({ ...prev, code: e.target.value }))} style={inputBase} /></Field><Field label="Ubicación"><input value={obraForm.location} onChange={(e) => setObraForm((prev) => ({ ...prev, location: e.target.value }))} style={inputBase} /></Field><Field label="Unidades"><input type="number" value={obraForm.totalUnits} onChange={(e) => setObraForm((prev) => ({ ...prev, totalUnits: e.target.value }))} style={inputBase} /></Field><button type="button" onClick={saveObra} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Guardar obra</button></Card>
        <Card title="Configuración económica" subtitle="Estos datos se consumen en Estimaciones de forma informativa y para cálculo de neto."><Field label="Anticipo a amortizar (%)"><input type="number" value={configForm.anticipoPorcentaje} onChange={(e) => setConfigForm((prev) => ({ ...prev, anticipoPorcentaje: e.target.value }))} style={inputBase} /></Field><Field label="Retención (%)"><input type="number" value={configForm.retencionPorcentaje} onChange={(e) => setConfigForm((prev) => ({ ...prev, retencionPorcentaje: e.target.value }))} style={inputBase} /></Field><Field label="Multa diaria"><input type="number" value={configForm.multaDiaria} onChange={(e) => setConfigForm((prev) => ({ ...prev, multaDiaria: e.target.value }))} style={inputBase} /></Field><button type="button" onClick={saveEstimationConfig} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Guardar configuración</button></Card>
      </div>
      <Card title="Catálogo de conceptos" subtitle="Carga el CSV desde alta/configuración de obra. Columnas esperadas: PARTIDA, clave, descripcion, Unidades, unidad, P.U. Opcional: Fecha Entrega.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}><Metric label="Conceptos" value={catalog.length} helper={loading ? "Cargando..." : "cargados"} /><Metric label="Partidas" value={partidasCount} /><Metric label="Total por unidad/casa" value={money(catalogTotal)} /></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <button type="button" onClick={downloadCatalogTemplate} style={{ ...buttonBase, background: "#fff", color: "#007aff" }}>Descargar plantilla CSV</button>
          <div style={{ color: "#6e6e73", fontSize: 13 }}>Usa la plantilla para evitar errores de columnas al subir el catálogo.</div>
        </div>
        <input type="file" accept=".csv,text/csv" disabled={importing} onChange={(e) => importCatalogFile(e.target.files?.[0])} style={inputBase} />
        {importInfo ? <div style={{ marginTop: 10, color: "#157347", fontWeight: 850 }}>Última carga: {importInfo.rows} conceptos · {importInfo.partidas} partidas · {money(importInfo.total)}</div> : null}
      </Card>
      <Card title="Documentos técnicos por lote" subtitle="Selecciona varios archivos a la vez y luego captura o ajusta sus datos antes de subirlos a la obra.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 12 }}>
          <Field label="Categoría para aplicar a todos"><select value={defaultDocBatchMeta.category} onChange={(e) => applyDocBatchMetaToAll({ category: e.target.value })} style={inputBase}>{documentCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></Field>
          <Field label="Estatus para aplicar a todos"><select value={defaultDocBatchMeta.status} onChange={(e) => applyDocBatchMetaToAll({ status: e.target.value })} style={inputBase}><option value="vigente">Vigente</option><option value="en_revision">En revisión</option><option value="autorizado">Autorizado</option><option value="sustituido">Sustituido</option></select></Field>
          <Field label="Alcance para aplicar a todos"><select value={defaultDocBatchMeta.scope} onChange={(e) => applyDocBatchMetaToAll({ scope: e.target.value })} style={inputBase}>{documentScopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}</select></Field>
        </div>
        <input type="file" multiple onChange={(e) => handleTechnicalDocBatch(e.target.files)} style={inputBase} />
        {docBatchRows.length ? <div style={{ marginTop: 14, border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, overflow: "hidden", background: "#fff" }}>
          <div style={{ padding: 12, background: "rgba(242,242,247,0.96)", fontSize: 13, fontWeight: 950, color: "#1d1d1f" }}>{docBatchRows.length} archivos listos para clasificar</div>
          <div style={{ display: "grid", gap: 10, padding: 12 }}>
            {docBatchRows.map((row) => <div key={row.id} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 16, padding: 12, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}><div><div style={{ fontWeight: 950 }}>{row.file.name}</div><div style={{ color: "#6e6e73", fontSize: 12 }}>{Math.round((row.file.size || 0) / 1024)} KB · {row.file.type || "archivo"}</div></div><button type="button" onClick={() => removeDocBatchRow(row.id)} style={{ ...buttonBase, background: "#fff", color: "#ff3b30" }}>Quitar</button></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <Field label="Nombre"><input value={row.title} onChange={(e) => updateDocBatchRow(row.id, { title: e.target.value })} style={inputBase} /></Field>
                <Field label="Categoría"><select value={row.category} onChange={(e) => updateDocBatchRow(row.id, { category: e.target.value })} style={inputBase}>{documentCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></Field>
                <Field label="Versión"><input value={row.version} onChange={(e) => updateDocBatchRow(row.id, { version: e.target.value })} placeholder="V1, Rev. 02" style={inputBase} /></Field>
                <Field label="Estatus"><select value={row.status} onChange={(e) => updateDocBatchRow(row.id, { status: e.target.value })} style={inputBase}><option value="vigente">Vigente</option><option value="en_revision">En revisión</option><option value="autorizado">Autorizado</option><option value="sustituido">Sustituido</option></select></Field>
                <Field label="Alcance"><select value={row.scope} onChange={(e) => updateDocBatchRow(row.id, { scope: e.target.value })} style={inputBase}>{documentScopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}</select></Field>
                <Field label="Unidades"><input value={row.units} onChange={(e) => updateDocBatchRow(row.id, { units: e.target.value })} placeholder="TH01, TH02" style={inputBase} /></Field>
                <Field label="Autorizó"><input value={row.authorizedBy} onChange={(e) => updateDocBatchRow(row.id, { authorizedBy: e.target.value })} style={inputBase} /></Field>
                <Field label="Fecha autorización"><input type="date" value={row.authorizationDate} onChange={(e) => updateDocBatchRow(row.id, { authorizationDate: e.target.value })} style={inputBase} /></Field>
              </div>
              <Field label="Descripción / nota"><textarea value={row.description} onChange={(e) => updateDocBatchRow(row.id, { description: e.target.value })} rows={2} style={{ ...inputBase, resize: "vertical" }} /></Field>
            </div>)}
          </div>
        </div> : <div style={{ marginTop: 10, color: "#6e6e73", fontSize: 13 }}>Todavía no hay archivos seleccionados.</div>}
        <button type="button" onClick={saveTechnicalDocBatch} disabled={uploadingDocs || !docBatchRows.length} style={{ ...buttonBase, marginTop: 12, background: uploadingDocs || !docBatchRows.length ? "#e5e5ea" : "#111827", color: uploadingDocs || !docBatchRows.length ? "#8e8e93" : "#fff" }}>{uploadingDocs ? "Subiendo lote..." : "Guardar lote de documentos"}</button>
      </Card>
      <Card title="Vista previa del catálogo" subtitle="Aquí puedes definir o ajustar Fecha Entrega por concepto. Después se podrá especializar por casa para multas automáticas.">
        <input value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)} placeholder="Buscar por partida, clave, concepto o fecha" style={{ ...inputBase, marginBottom: 12 }} />
        <div style={{ overflowX: "auto", border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, background: "#fff" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}><thead><tr><th style={th}>Partida</th><th style={th}>Clave</th><th style={th}>Concepto</th><th style={th}>Unidad</th><th style={th}>Unidades</th><th style={th}>P.U.</th><th style={th}>Total</th><th style={th}>Fecha Entrega</th></tr></thead><tbody>{filteredCatalog.slice(0, 250).map((item) => <tr key={item.id}><td style={td}>{item.partida}</td><td style={td}>{item.clave}</td><td style={{ ...td, minWidth: 300 }}>{item.concepto}</td><td style={td}>{item.unidad}</td><td style={td}>{item.cantidad}</td><td style={td}>{money(item.precioUnitario)}</td><td style={td}>{money(item.importe)}</td><td style={td}><input type="date" value={item.fechaEntrega || ""} onChange={(e) => updateConceptFechaEntrega(item, e.target.value)} style={{ ...inputBase, minWidth: 150 }} /></td></tr>)}</tbody></table></div>
        {filteredCatalog.length > 250 ? <div style={{ marginTop: 10, color: "#6e6e73", fontSize: 13 }}>Mostrando 250 de {filteredCatalog.length} conceptos. Usa el buscador para filtrar.</div> : null}
      </Card>
    </div>
  </div>;
}
