import React, { useEffect, useMemo, useState } from "react";
import { getApps } from "firebase/app";
import { collection, doc, getDocs, getFirestore, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";

const defaultObraId = "arenna";
const inputBase = { width: "100%", minHeight: 44, border: "1px solid rgba(60,60,67,0.16)", borderRadius: 14, padding: "10px 12px", background: "#fff", color: "#1d1d1f", outline: "none", boxSizing: "border-box" };
const buttonBase = { border: "1px solid rgba(60,60,67,0.12)", borderRadius: 999, padding: "10px 14px", fontWeight: 850, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" };
const th = { padding: "10px", fontSize: 11, fontWeight: 950, color: "#6e6e73", textTransform: "uppercase", letterSpacing: 0.45, background: "rgba(242,242,247,0.96)", borderBottom: "1px solid rgba(60,60,67,0.10)" };
const td = { padding: "10px", borderBottom: "1px solid rgba(60,60,67,0.10)", verticalAlign: "top", fontSize: 13, color: "#1d1d1f" };

function getDb() { const app = getApps()[0]; return app ? getFirestore(app) : null; }
function money(value) { return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function parseNumber(value) { const cleaned = String(value ?? "").replace(/\$/g, "").replace(/,/g, "").replace(/\s/g, "").trim(); const parsed = Number(cleaned); return Number.isFinite(parsed) ? parsed : 0; }
function slugify(text = "") { return String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function cleanText(text = "") { return String(text).replace(/Ã“/g, "Ó").replace(/Ã‰/g, "É").replace(/Ã/g, "Á").replace(/Ã/g, "Í").replace(/Ãš/g, "Ú").replace(/Ã‘/g, "Ñ").replace(/Ã³/g, "ó").replace(/Ã©/g, "é").replace(/Ã¡/g, "á").replace(/Ã­/g, "í").replace(/Ãº/g, "ú").replace(/Ã±/g, "ñ").replace(/Â´/g, "´").replace(/Â/g, "").trim(); }
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
  return { id: item.id || `${slugify(partida)}-${slugify(clave)}-${String(rowNumber).padStart(4, "0")}`, clave, partida, concepto, descripcion: concepto, unidad, cantidad, precioUnitario, importe: cantidad * precioUnitario, fechaEntrega: item.fechaEntrega || item.fecha_entrega || "", rowNumber, sourceFileName: item.sourceFileName || "" };
}
function rowsToCatalog(rows, sourceFileName = "") {
  if (!rows.length) return [];
  const headers = rows[0].map((header) => cleanText(header));
  return rows.slice(1).map((row, index) => {
    const raw = {};
    headers.forEach((header, columnIndex) => { raw[header] = row[columnIndex] ?? ""; });
    return normalizeCatalogItem({ PARTIDA: raw.PARTIDA, clave: raw.clave || raw.Clave, descripcion: raw.descripcion || raw.Descripcion || raw.DESCRIPCION || raw.DESCRIPCIÓN, Unidades: raw.Unidades || raw.unidades || raw.Cantidad || raw.cantidad, unidad: raw.unidad || raw.Unidad, "P.U.": raw["P.U."] || raw.PU || raw["Precio Unitario"] || raw.precioUnitario, fechaEntrega: raw.fechaEntrega || raw["Fecha compromiso"] || raw["fecha compromiso"] || raw.fecha_entrega, rowNumber: index + 2, sourceFileName }, index);
  }).filter((item) => item.clave && item.concepto && item.precioUnitario > 0);
}
function Field({ label, children }) { return <label style={{ display: "block", marginBottom: 12 }}><div style={{ fontSize: 13, fontWeight: 850, color: "#1d1d1f", marginBottom: 6 }}>{label}</div>{children}</label>; }
function Card({ title, subtitle, children }) { return <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 22, padding: 16, background: "rgba(255,255,255,0.90)", boxShadow: "0 8px 28px rgba(0,0,0,0.055)" }}>{title ? <div style={{ fontSize: 18, fontWeight: 950, color: "#1d1d1f" }}>{title}</div> : null}{subtitle ? <div style={{ marginTop: 4, color: "#6e6e73", fontSize: 13, lineHeight: 1.45 }}>{subtitle}</div> : null}{children ? <div style={{ marginTop: title || subtitle ? 14 : 0 }}>{children}</div> : null}</div>; }
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

  const selectedObra = obras.find((obra) => obra.id === selectedObraId) || {};
  const catalogTotal = useMemo(() => catalog.reduce((acc, item) => acc + Number(item.importe || 0), 0), [catalog]);
  const partidasCount = useMemo(() => new Set(catalog.map((item) => item.partida)).size, [catalog]);

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
      if (!nextObras.some((obra) => obra.id === selectedObraId) && nextObras.length) setSelectedObraId(nextObras[0].id);
      const catalogSnap = await getDocs(query(collection(db, "obras", selectedObraId, "catalogoConceptos"), orderBy("partida", "asc")));
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
      if (!imported.length) { alert("No pude leer conceptos válidos. Revisa columnas: PARTIDA, clave, descripcion, Unidades, unidad, P.U."); return; }
      for (const concept of imported) await setDoc(doc(db, "obras", selectedObraId, "catalogoConceptos", concept.id), { ...concept, sourceFileName: file.name, importedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
      const total = imported.reduce((acc, item) => acc + Number(item.importe || 0), 0);
      setImportInfo({ rows: imported.length, total, partidas: Array.from(new Set(imported.map((item) => item.partida))).length, fileName: file.name });
      alert(`Catálogo importado en obra: ${imported.length} conceptos · ${money(total)} por unidad/casa.`);
      await loadData();
    } catch (error) { console.error(error); alert("Ocurrió un error al importar el catálogo."); }
    finally { setImporting(false); }
  }

  if (!open) return null;

  return <div className="triton-obras-config-module" style={{ position: "fixed", left: "var(--triton-shell-offset, 84px)", top: 0, right: 0, bottom: 0, zIndex: 2147483645, background: "#f5f5f7", overflow: "auto" }}>
    <style>{`@media (max-width: 900px) { .triton-obras-config-module { left: 0 !important; z-index: 2147483647 !important; } }`}</style>
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "calc(24px + env(safe-area-inset-top, 0px)) 18px 42px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap" }}><div><div style={{ fontSize: 34, fontWeight: 950, color: "#1d1d1f", letterSpacing: -0.7 }}>Obras</div><div style={{ color: "#6e6e73", fontSize: 16, marginTop: 6 }}>Alta de obra, catálogo de conceptos y configuración económica para estimaciones.</div></div><button type="button" onClick={() => setOpen(false)} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>Volver a Calidad</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}><Card title="Obras actuales" subtitle="Selecciona la obra que vas a configurar."><Field label="Obra"><select value={selectedObraId} onChange={(e) => setSelectedObraId(e.target.value)} style={inputBase}>{obras.length ? obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.name || obra.id} · {obra.status || "sin estatus"}</option>) : <option value={defaultObraId}>Arenna</option>}</select></Field>{selectedObra ? <div style={{ padding: 12, borderRadius: 16, background: "#fff", border: "1px solid rgba(60,60,67,0.12)" }}><div style={{ fontWeight: 950 }}>{selectedObra.name || selectedObra.id}</div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{selectedObra.location || "Sin ubicación"} · {selectedObra.totalUnits || 0} unidades</div></div> : null}</Card><Card title="Nueva obra" subtitle="El catálogo y anticipo se configuran después de crear la obra."><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}><Field label="Nombre"><input value={obraForm.name} onChange={(e) => setObraForm({ ...obraForm, name: e.target.value })} style={inputBase} /></Field><Field label="Código"><input value={obraForm.code} onChange={(e) => setObraForm({ ...obraForm, code: e.target.value })} placeholder="arenna" style={inputBase} /></Field><Field label="Ubicación"><input value={obraForm.location} onChange={(e) => setObraForm({ ...obraForm, location: e.target.value })} style={inputBase} /></Field><Field label="Unidades"><input type="number" value={obraForm.totalUnits} onChange={(e) => setObraForm({ ...obraForm, totalUnits: e.target.value })} style={inputBase} /></Field></div><button type="button" onClick={saveObra} style={{ ...buttonBase, background: "#007aff", color: "#fff" }}>Guardar obra</button></Card></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 16 }}><Card title="Configuración económica de estimaciones" subtitle="Estos datos pertenecen a la obra. En Estimaciones aparecen solo informativos y se aplican automáticamente."><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}><Field label="Anticipo a amortizar %"><input type="number" value={configForm.anticipoPorcentaje} onChange={(e) => setConfigForm({ ...configForm, anticipoPorcentaje: e.target.value })} style={inputBase} /></Field><Field label="Retención %"><input type="number" value={configForm.retencionPorcentaje} onChange={(e) => setConfigForm({ ...configForm, retencionPorcentaje: e.target.value })} style={inputBase} /></Field><Field label="Multa diaria"><input type="number" value={configForm.multaDiaria} onChange={(e) => setConfigForm({ ...configForm, multaDiaria: e.target.value })} style={inputBase} /></Field></div><button type="button" onClick={saveEstimationConfig} style={{ ...buttonBase, background: "#007aff", color: "#fff" }}>Guardar configuración económica</button></Card><Card title="Catálogo de conceptos" subtitle="Carga aquí el catálogo base de la obra. Estimaciones usará este catálogo para capturar casa por casa."><Field label="Archivo CSV"><input type="file" accept=".csv,text/csv" onChange={(e) => importCatalogFile(e.target.files?.[0])} /></Field>{importing ? <div style={{ color: "#6e6e73", marginTop: 8 }}>Importando catálogo...</div> : null}{importInfo ? <div style={{ marginTop: 12, padding: 12, borderRadius: 16, background: "#e8f7ed", color: "#157347", fontWeight: 850 }}>{importInfo.rows} conceptos importados · {importInfo.partidas} partidas · {money(importInfo.total)}</div> : null}</Card></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginTop: 16 }}><Metric label="Conceptos cargados" value={catalog.length} /><Metric label="Partidas" value={partidasCount} /><Metric label="Total catálogo por unidad" value={money(catalogTotal)} /><Metric label="Anticipo configurado" value={`${parseNumber(configForm.anticipoPorcentaje)}%`} /></div>
      <Card title="Vista previa del catálogo" subtitle="Primeros conceptos cargados en la obra.">{loading ? <div style={{ color: "#6e6e73" }}>Cargando configuración...</div> : null}<div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 920, borderCollapse: "collapse" }}><thead><tr><th style={{ ...th, textAlign: "left" }}>Partida</th><th style={{ ...th, textAlign: "left" }}>Clave</th><th style={{ ...th, textAlign: "left" }}>Concepto</th><th style={{ ...th, textAlign: "right" }}>Unidades</th><th style={{ ...th, textAlign: "left" }}>Unidad</th><th style={{ ...th, textAlign: "right" }}>P.U.</th><th style={{ ...th, textAlign: "right" }}>Total</th></tr></thead><tbody>{catalog.slice(0, 80).map((item) => <tr key={item.id}><td style={td}>{item.partida}</td><td style={{ ...td, fontWeight: 900 }}>{item.clave}</td><td style={{ ...td, minWidth: 300 }}>{item.concepto}</td><td style={{ ...td, textAlign: "right" }}>{Number(item.cantidad || 0).toLocaleString("es-MX")}</td><td style={td}>{item.unidad}</td><td style={{ ...td, textAlign: "right" }}>{money(item.precioUnitario)}</td><td style={{ ...td, textAlign: "right", fontWeight: 950 }}>{money(item.importe)}</td></tr>)}</tbody></table></div></Card>
    </div>
  </div>;
}
