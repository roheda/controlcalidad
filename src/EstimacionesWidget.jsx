import React, { useEffect, useMemo, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import { collection, doc, getDocs, getFirestore, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBzk_jZfpv4j7PxroeTISwx11LffEB3TWQ",
  authDomain: "control-de-calidad-triton.firebaseapp.com",
  projectId: "control-de-calidad-triton",
  storageBucket: "control-de-calidad-triton.firebasestorage.app",
  messagingSenderId: "41329486719",
  appId: "1:41329486719:web:1bf7ff827d3b60227f084a",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const defaultObraId = "arenna";

const inputBase = { width: "100%", minHeight: 44, border: "1px solid rgba(60,60,67,0.16)", borderRadius: 14, padding: "10px 12px", background: "#fff", color: "#1d1d1f", outline: "none", boxSizing: "border-box" };
const buttonBase = { border: "1px solid rgba(60,60,67,0.12)", borderRadius: 999, padding: "10px 14px", fontWeight: 850, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" };
const th = { padding: "10px", fontSize: 11, fontWeight: 950, color: "#6e6e73", textTransform: "uppercase", letterSpacing: 0.45, background: "rgba(242,242,247,0.96)", borderBottom: "1px solid rgba(60,60,67,0.10)", position: "sticky", top: 0, zIndex: 2 };
const td = { padding: "10px", borderBottom: "1px solid rgba(60,60,67,0.10)", verticalAlign: "top", fontSize: 13, color: "#1d1d1f" };

const conceptSeed = [
  { clave: "PRE-001", partida: "Preliminares", concepto: "Trazo y nivelación", unidad: "lote", cantidad: 1, precioUnitario: 8500, fechaEntrega: "" },
  { clave: "CIM-001", partida: "Cimentación", concepto: "Excavación, acero, cimbra y colado de cimentación", unidad: "lote", cantidad: 1, precioUnitario: 145000, fechaEntrega: "" },
  { clave: "EST-001", partida: "Estructura", concepto: "Castillos, dalas, trabes y losa", unidad: "lote", cantidad: 1, precioUnitario: 230000, fechaEntrega: "" },
  { clave: "ALB-001", partida: "Albañilería", concepto: "Muros, cerramientos y resanes", unidad: "lote", cantidad: 1, precioUnitario: 120000, fechaEntrega: "" },
  { clave: "ACA-001", partida: "Acabados", concepto: "Pisos, aplanados, pintura y detalles finales", unidad: "lote", cantidad: 1, precioUnitario: 190000, fechaEntrega: "" },
];

const statusLabel = {
  borrador: "Borrador",
  en_aprobacion: "En aprobación",
  parcial_aprobada: "Aprobación parcial",
  lista_administracion: "Lista para administración",
  administracion_revision: "En revisión administración",
  pago_programado: "Pago programado",
  pagada: "Pagada",
  rechazada: "Rechazada",
};

function money(value) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value || 0));
}
function parseNumber(value) {
  const cleaned = String(value ?? "").replace(/\$/g, "").replace(/,/g, "").replace(/\s/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}
function slugify(text = "") {
  return String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function cleanText(text = "") {
  return String(text)
    .replace(/Ã“/g, "Ó").replace(/Ã‰/g, "É").replace(/Ã/g, "Á").replace(/Ã/g, "Í").replace(/Ãš/g, "Ú").replace(/Ã‘/g, "Ñ")
    .replace(/Ã³/g, "ó").replace(/Ã©/g, "é").replace(/Ã¡/g, "á").replace(/Ã­/g, "í").replace(/Ãº/g, "ú").replace(/Ã±/g, "ñ")
    .replace(/Â´/g, "´").replace(/Â/g, "").trim();
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
function parseCsv(text) {
  const rows = [];
  let row = [], current = "", inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i], next = text[i + 1];
    if (char === '"') { if (inQuotes && next === '"') { current += '"'; i += 1; } else inQuotes = !inQuotes; continue; }
    if (char === "," && !inQuotes) { row.push(current); current = ""; continue; }
    if ((char === "\n" || char === "\r") && !inQuotes) { if (char === "\r" && next === "\n") i += 1; row.push(current); if (row.some((cell) => String(cell).trim() !== "")) rows.push(row); row = []; current = ""; continue; }
    current += char;
  }
  row.push(current);
  if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
  return rows;
}
function rowsToCatalog(rows, sourceFileName = "") {
  if (!rows.length) return [];
  const headers = rows[0].map((header) => cleanText(header));
  return rows.slice(1).map((row, index) => {
    const raw = {};
    headers.forEach((header, columnIndex) => { raw[header] = row[columnIndex] ?? ""; });
    return normalizeCatalogItem({ PARTIDA: raw.PARTIDA, clave: raw.clave || raw.Clave, descripcion: raw.descripcion || raw.Descripcion || raw.DESCRIPCION || raw.DESCRIPCIÓN, Unidades: raw.Unidades || raw.unidades || raw.Cantidad || raw.cantidad, unidad: raw.unidad || raw.Unidad, "P.U.": raw["P.U."] || raw.PU || raw["Precio Unitario"] || raw.precioUnitario, rowNumber: index + 2, sourceFileName }, index);
  }).filter((item) => item.clave && item.concepto && item.precioUnitario > 0);
}
function groupByPartida(items) {
  return items.reduce((acc, item) => { const key = item.partida || "General"; if (!acc[key]) acc[key] = []; acc[key].push(item); return acc; }, {});
}
function todayDelay(fechaEntrega) {
  if (!fechaEntrega) return 0;
  const today = new Date();
  const entrega = new Date(fechaEntrega);
  return today > entrega ? Math.ceil((today - entrega) / (1000 * 60 * 60 * 24)) : 0;
}
function Field({ label, children }) {
  return <label style={{ display: "block", marginBottom: 12 }}><div style={{ fontSize: 13, fontWeight: 850, color: "#1d1d1f", marginBottom: 6 }}>{label}</div>{children}</label>;
}
function Card({ title, subtitle, children }) {
  return <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 22, padding: 16, background: "rgba(255,255,255,0.90)", boxShadow: "0 8px 28px rgba(0,0,0,0.055)" }}>{title ? <div style={{ fontSize: 18, fontWeight: 950, color: "#1d1d1f" }}>{title}</div> : null}{subtitle ? <div style={{ marginTop: 4, color: "#6e6e73", fontSize: 13, lineHeight: 1.45 }}>{subtitle}</div> : null}{children ? <div style={{ marginTop: title || subtitle ? 14 : 0 }}>{children}</div> : null}</div>;
}
function Metric({ label, value, helper }) {
  return <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 20, padding: 15, background: "#fff" }}><div style={{ color: "#6e6e73", fontSize: 12, fontWeight: 800 }}>{label}</div><div style={{ color: "#1d1d1f", fontSize: 24, fontWeight: 950, marginTop: 4 }}>{value}</div>{helper ? <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{helper}</div> : null}</div>;
}
function badge(status) {
  const colors = { borrador: ["#eef2f7", "#475467"], en_aprobacion: ["#fff3cd", "#9a6700"], parcial_aprobada: ["#fff3cd", "#9a6700"], lista_administracion: ["#e8f7ed", "#157347"], administracion_revision: ["#eef2ff", "#3730a3"], pago_programado: ["#e8f7ed", "#157347"], pagada: ["#e8f7ed", "#157347"], rechazada: ["#fdecec", "#b42318"] };
  const [bg, color] = colors[status] || colors.borrador;
  return { display: "inline-flex", borderRadius: 999, padding: "6px 10px", background: bg, color, fontSize: 12, fontWeight: 900 };
}

export default function EstimacionesWidget() {
  const [open, setOpen] = useState(false);
  const [obras, setObras] = useState([]);
  const [houses, setHouses] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [lots, setLots] = useState([]);
  const [selectedObraId, setSelectedObraId] = useState(defaultObraId);
  const [selectedHouseId, setSelectedHouseId] = useState("");
  const [copyHouseIds, setCopyHouseIds] = useState([]);
  const [activeTab, setActiveTab] = useState("captura");
  const [loading, setLoading] = useState(false);
  const [importingCatalog, setImportingCatalog] = useState(false);
  const [catalogImportInfo, setCatalogImportInfo] = useState(null);
  const [draftRows, setDraftRows] = useState({});
  const [collapsedPartidas, setCollapsedPartidas] = useState({});
  const [currentLotId, setCurrentLotId] = useState("");
  const [selectedLotId, setSelectedLotId] = useState("");
  const [selectedReviewHouseIds, setSelectedReviewHouseIds] = useState([]);
  const [lotForm, setLotForm] = useState({ numero: 1, nombre: "", periodo: new Date().toISOString().slice(0, 7), anticipoPorcentaje: 30, retencionPorcentaje: 0, multaDiaria: 0 });
  const [manualConcept, setManualConcept] = useState({ clave: "", partida: "", concepto: "", unidad: "", cantidad: "", precioUnitario: "", fechaEntrega: "" });

  const selectedHouse = houses.find((house) => house.id === selectedHouseId) || null;
  const selectedLot = lots.find((lot) => lot.id === selectedLotId) || null;
  const catalogByPartida = useMemo(() => groupByPartida(catalog), [catalog]);
  const draftStorageKey = `triton_estimacion_draft_${selectedObraId}_${selectedHouseId}_${lotForm.periodo}`;
  const draftLots = lots.filter((lot) => lot.status === "borrador");
  const approvalLots = lots.filter((lot) => ["en_aprobacion", "parcial_aprobada"].includes(lot.status));
  const adminLots = lots.filter((lot) => ["lista_administracion", "administracion_revision", "pago_programado", "pagada"].includes(lot.status));

  function draftPercent(concept) { return Math.min(100, Math.max(0, parseNumber(draftRows[concept.id]?.percent))); }
  function plannedAmount(concept) { return Number(concept.importe || 0) * (draftPercent(concept) / 100); }
  const draftSummary = useMemo(() => {
    const subtotal = catalog.reduce((acc, concept) => acc + plannedAmount(concept), 0);
    const multas = catalog.reduce((acc, concept) => draftPercent(concept) > 0 ? acc + todayDelay(concept.fechaEntrega) * parseNumber(lotForm.multaDiaria) : acc, 0);
    const amortizacion = subtotal * (parseNumber(lotForm.anticipoPorcentaje) / 100);
    const retencion = subtotal * (parseNumber(lotForm.retencionPorcentaje) / 100);
    const neto = Math.max(0, subtotal - amortizacion - retencion - multas);
    return { subtotal, multas, amortizacion, retencion, neto, count: Object.values(draftRows).filter((row) => parseNumber(row.percent) > 0).length };
  }, [catalog, draftRows, lotForm]);
  const contractTotal = useMemo(() => catalog.reduce((acc, item) => acc + Number(item.importe || 0), 0) * Math.max(houses.length || 1, 1), [catalog, houses.length]);
  const lotNumberOptions = lots.map((lot) => Number(lot.numero || 0)).filter(Boolean);
  const nextNumber = lotNumberOptions.length ? Math.max(...lotNumberOptions) + 1 : 1;

  useEffect(() => {
    const handler = () => { setOpen(true); setActiveTab((previous) => previous || "captura"); };
    window.addEventListener("triton-open-estimaciones", handler);
    window.addEventListener("triton-module-estimaciones", handler);
    return () => { window.removeEventListener("triton-open-estimaciones", handler); window.removeEventListener("triton-module-estimaciones", handler); };
  }, []);
  useEffect(() => { if (!open) return; loadData(); }, [open, selectedObraId]);
  useEffect(() => { setLotForm((prev) => ({ ...prev, numero: prev.numero || nextNumber })); }, [nextNumber]);
  useEffect(() => {
    if (!open || !selectedHouseId) return;
    const raw = localStorage.getItem(draftStorageKey);
    setDraftRows(raw ? JSON.parse(raw) : {});
  }, [open, draftStorageKey, selectedHouseId]);
  useEffect(() => {
    if (!open || !selectedHouseId) return;
    localStorage.setItem(draftStorageKey, JSON.stringify(draftRows));
  }, [draftRows, draftStorageKey, open, selectedHouseId]);

  async function loadData() {
    setLoading(true);
    try {
      const obrasSnap = await getDocs(collection(db, "obras"));
      const nextObras = obrasSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      setObras(nextObras);
      const housesSnap = await getDocs(query(collection(db, "obras", selectedObraId, "casas"), orderBy("number", "asc")));
      const nextHouses = housesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      setHouses(nextHouses);
      if (!selectedHouseId && nextHouses.length) setSelectedHouseId(nextHouses[0].id);
      const catalogSnap = await getDocs(query(collection(db, "obras", selectedObraId, "catalogoConceptos"), orderBy("partida", "asc")));
      const nextCatalog = catalogSnap.docs.map((item, index) => normalizeCatalogItem({ id: item.id, ...item.data() }, index));
      setCatalog(nextCatalog.length ? nextCatalog : conceptSeed.map(normalizeCatalogItem));
      const lotsSnap = await getDocs(query(collection(db, "obras", selectedObraId, "estimacionLotes"), orderBy("createdAt", "desc")));
      setLots(lotsSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
    } catch (error) { console.error(error); } finally { setLoading(false); }
  }

  async function importCatalogFile(file) {
    if (!file) return;
    setImportingCatalog(true);
    try {
      const imported = rowsToCatalog(parseCsv(await file.text()), file.name);
      if (!imported.length) { alert("No pude leer conceptos válidos. Revisa columnas: PARTIDA, clave, descripcion, Unidades, unidad, P.U."); return; }
      for (const concept of imported) await setDoc(doc(db, "obras", selectedObraId, "catalogoConceptos", concept.id), { ...concept, sourceFileName: file.name, importedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
      const total = imported.reduce((acc, item) => acc + Number(item.importe || 0), 0);
      setCatalogImportInfo({ rows: imported.length, total, partidas: Array.from(new Set(imported.map((item) => item.partida))).length, fileName: file.name });
      alert(`Catálogo importado: ${imported.length} conceptos · ${money(total)} por unidad/casa.`);
      await loadData();
    } catch (error) { console.error(error); alert("Ocurrió un error al importar el catálogo."); } finally { setImportingCatalog(false); }
  }
  async function seedCatalog() {
    for (const concept of conceptSeed.map(normalizeCatalogItem)) await setDoc(doc(db, "obras", selectedObraId, "catalogoConceptos", concept.id), { ...concept, createdAt: serverTimestamp() }, { merge: true });
    await loadData();
  }
  async function addManualConcept() {
    if (!manualConcept.clave.trim() || !manualConcept.concepto.trim()) { alert("Agrega clave y concepto."); return; }
    const item = normalizeCatalogItem(manualConcept, catalog.length);
    await setDoc(doc(db, "obras", selectedObraId, "catalogoConceptos", item.id), { ...item, createdAt: serverTimestamp() }, { merge: true });
    setManualConcept({ clave: "", partida: "", concepto: "", unidad: "", cantidad: "", precioUnitario: "", fechaEntrega: "" });
    await loadData();
  }

  function updateDraft(conceptId, patch) { setDraftRows((prev) => ({ ...prev, [conceptId]: { ...(prev[conceptId] || {}), ...patch } })); }
  function buildRowsFromDraft() {
    return catalog.map((concept) => {
      const percent = draftPercent(concept);
      if (percent <= 0) return null;
      const multa = todayDelay(concept.fechaEntrega) * parseNumber(lotForm.multaDiaria);
      return { conceptId: concept.id, clave: concept.clave, partida: concept.partida, concepto: concept.concepto, unidad: concept.unidad, cantidad: Number(concept.cantidad || 0), precioUnitario: Number(concept.precioUnitario || 0), importeConcepto: Number(concept.importe || 0), avanceSolicitado: percent, importeSolicitado: Number(concept.importe || 0) * (percent / 100), comentarioConstructora: draftRows[concept.id]?.comment || "", fechaEntrega: concept.fechaEntrega || "", diasAtraso: todayDelay(concept.fechaEntrega), multa, status: "borrador" };
    }).filter(Boolean);
  }
  function housePayload(house, rows, houseStatus = "borrador") {
    const subtotal = rows.reduce((acc, row) => acc + Number(row.importeSolicitado || 0), 0);
    const multas = rows.reduce((acc, row) => acc + Number(row.multa || 0), 0);
    const amortizacion = subtotal * (parseNumber(lotForm.anticipoPorcentaje) / 100);
    const retencion = subtotal * (parseNumber(lotForm.retencionPorcentaje) / 100);
    const neto = Math.max(0, subtotal - amortizacion - retencion - multas);
    return { id: house.id, houseId: house.id, houseName: house.name || house.id, block: house.block || "", status: houseStatus, rows, totals: { subtotal, amortizacion, retencion, multas, neto } };
  }
  function lotTotals(housesObject) {
    const list = Object.values(housesObject || {});
    return list.reduce((acc, house) => ({ subtotal: acc.subtotal + Number(house.totals?.subtotal || 0), amortizacion: acc.amortizacion + Number(house.totals?.amortizacion || 0), retencion: acc.retencion + Number(house.totals?.retencion || 0), multas: acc.multas + Number(house.totals?.multas || 0), neto: acc.neto + Number(house.totals?.neto || 0), houses: acc.houses + 1 }), { subtotal: 0, amortizacion: 0, retencion: 0, multas: 0, neto: 0, houses: 0 });
  }
  async function saveDraftLot() {
    if (!selectedHouse) { alert("Selecciona una casa base."); return; }
    const rows = buildRowsFromDraft();
    if (!rows.length) { alert("Captura al menos un porcentaje de avance."); return; }
    const id = currentLotId || `${selectedObraId}-estimacion-${lotForm.numero}-${Date.now()}`;
    const house = housePayload(selectedHouse, rows, "borrador");
    const existing = lots.find((lot) => lot.id === id);
    const housesObject = { ...(existing?.houses || {}), [selectedHouse.id]: house };
    const totals = lotTotals(housesObject);
    const name = lotForm.nombre.trim() || `Estimación ${lotForm.numero} ${selectedObraId}`;
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", id), { id, obraId: selectedObraId, numero: Number(lotForm.numero || 1), nombre: name, periodo: lotForm.periodo, status: "borrador", form: lotForm, baseHouseId: selectedHouse.id, houses: housesObject, totals, updatedAt: serverTimestamp(), createdAt: existing?.createdAt || serverTimestamp() }, { merge: true });
    setCurrentLotId(id); setSelectedLotId(id); localStorage.removeItem(draftStorageKey); alert("Borrador guardado. Puedes verlo en Borradores para copiarlo a otras casas o enviarlo a aprobación."); await loadData();
  }
  function loadLotToCapture(lot, houseId) {
    const targetHouseId = houseId || lot.baseHouseId || Object.keys(lot.houses || {})[0];
    const house = lot.houses?.[targetHouseId];
    const nextDraft = {};
    (house?.rows || []).forEach((row) => { nextDraft[row.conceptId] = { percent: row.avanceSolicitado, comment: row.comentarioConstructora || "" }; });
    setSelectedHouseId(targetHouseId); setCurrentLotId(lot.id); setSelectedLotId(lot.id); setLotForm({ ...lot.form, numero: lot.numero, nombre: lot.nombre, periodo: lot.periodo }); setDraftRows(nextDraft); setActiveTab("captura");
  }
  async function copyLotToHouses(lot, targetIds) {
    const sourceHouse = lot.houses?.[lot.baseHouseId] || Object.values(lot.houses || {})[0];
    if (!sourceHouse) return;
    const targets = houses.filter((house) => targetIds.includes(house.id));
    const housesObject = { ...(lot.houses || {}) };
    targets.forEach((house) => { housesObject[house.id] = housePayload(house, sourceHouse.rows || [], "borrador"); });
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", lot.id), { houses: housesObject, totals: lotTotals(housesObject), status: "borrador", updatedAt: serverTimestamp() }, { merge: true });
    setCopyHouseIds([]); alert(`Borrador copiado a ${targets.length} casa(s).`); await loadData();
  }
  async function sendLotToApproval(lot) {
    const housesObject = {};
    Object.values(lot.houses || {}).forEach((house) => { housesObject[house.houseId] = { ...house, status: "en_aprobacion", rows: (house.rows || []).map((row) => ({ ...row, status: "en_aprobacion" })) }; });
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", lot.id), { status: "en_aprobacion", houses: housesObject, sentAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    alert("Estimación enviada a aprobación de supervisión."); await loadData(); setActiveTab("aprobacion"); setSelectedLotId(lot.id);
  }
  async function reviewHouse(lot, houseId, approved) {
    const comment = window.prompt(approved ? "Comentario de aprobación" : "Motivo de rechazo", "") || "";
    const housesObject = { ...(lot.houses || {}) };
    const house = housesObject[houseId];
    if (!house) return;
    housesObject[houseId] = { ...house, status: approved ? "aprobada_supervision" : "rechazada_supervision", comentarioSupervision: comment, reviewedAt: new Date().toISOString(), rows: (house.rows || []).map((row) => ({ ...row, status: approved ? "aprobada_supervision" : "rechazada_supervision", comentarioSupervision: comment })) };
    const statuses = Object.values(housesObject).map((item) => item.status);
    const allApproved = statuses.length > 0 && statuses.every((status) => status === "aprobada_supervision");
    const anyApproved = statuses.some((status) => status === "aprobada_supervision");
    const nextStatus = allApproved ? "lista_administracion" : anyApproved ? "parcial_aprobada" : "en_aprobacion";
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", lot.id), { houses: housesObject, status: nextStatus, totals: lotTotals(housesObject), reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    await loadData();
  }
  async function reviewSelected(lot, approved) {
    for (const houseId of selectedReviewHouseIds) await reviewHouse(lot, houseId, approved);
    setSelectedReviewHouseIds([]);
  }
  async function setAdminStatus(lot, status) {
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", lot.id), { status, adminUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    await loadData();
  }
  function togglePartida(key) { setCollapsedPartidas((prev) => ({ ...prev, [key]: !prev[key] })); }
  function toggleCopyHouse(id) { setCopyHouseIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]); }
  function toggleReviewHouse(id) { setSelectedReviewHouseIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]); }

  const visibleLot = selectedLot || approvalLots[0] || lots[0] || null;

  if (!open) return null;

  return <div style={{ position: "fixed", inset: 0, zIndex: 2147483645, background: "#f5f5f7", overflow: "auto" }}>
    <div style={{ maxWidth: 1480, margin: "0 auto", padding: "calc(24px + env(safe-area-inset-top, 0px)) 18px 42px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ paddingLeft: 54 }}><div style={{ fontSize: 34, fontWeight: 950, color: "#1d1d1f", letterSpacing: -0.7 }}>Estimaciones</div><div style={{ color: "#6e6e73", fontSize: 16, marginTop: 6 }}>Borrador por partidas, lote formal, aprobación por casas y seguimiento hasta pago.</div></div>
        <button type="button" onClick={() => setOpen(false)} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>Volver a Calidad</button>
      </div>

      <Card title="Contexto del lote" subtitle="Primero captura una casa base. Después guarda el borrador, cópialo a otras casas y envía el lote a aprobación.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))", gap: 12 }}>
          <Field label="Obra"><select value={selectedObraId} onChange={(e) => { setSelectedObraId(e.target.value); setSelectedHouseId(""); setCurrentLotId(""); }} style={inputBase}>{obras.length ? obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.name || obra.id}</option>) : <option value={defaultObraId}>Arenna</option>}</select></Field>
          <Field label="Casa base"><select value={selectedHouseId} onChange={(e) => { setSelectedHouseId(e.target.value); setCurrentLotId(""); }} style={inputBase}>{houses.map((house) => <option key={house.id} value={house.id}>{house.name || house.id} · Bloque {house.block || "-"}</option>)}</select></Field>
          <Field label="No. estimación"><input type="number" value={lotForm.numero} onChange={(e) => setLotForm({ ...lotForm, numero: e.target.value })} style={inputBase} /></Field>
          <Field label="Nombre del lote"><input value={lotForm.nombre} onChange={(e) => setLotForm({ ...lotForm, nombre: e.target.value })} placeholder={`Estimación ${lotForm.numero} Arenna`} style={inputBase} /></Field>
          <Field label="Periodo"><input type="month" value={lotForm.periodo} onChange={(e) => setLotForm({ ...lotForm, periodo: e.target.value })} style={inputBase} /></Field>
          <Field label="Anticipo a amortizar %"><input type="number" value={lotForm.anticipoPorcentaje} onChange={(e) => setLotForm({ ...lotForm, anticipoPorcentaje: e.target.value })} style={inputBase} /></Field>
          <Field label="Retención %"><input type="number" value={lotForm.retencionPorcentaje} onChange={(e) => setLotForm({ ...lotForm, retencionPorcentaje: e.target.value })} style={inputBase} /></Field>
          <Field label="Multa diaria"><input type="number" value={lotForm.multaDiaria} onChange={(e) => setLotForm({ ...lotForm, multaDiaria: e.target.value })} style={inputBase} /></Field>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", margin: "14px 0" }}>{[["captura", "1. Captura borrador"], ["borradores", "2. Borradores y copias"], ["aprobacion", "3. Aprobación ingeniería"], ["estatus", "4. Estatus / administración"], ["catalogo", "Catálogo"]].map(([id, label]) => <button key={id} type="button" onClick={() => setActiveTab(id)} style={{ ...buttonBase, background: activeTab === id ? "#007aff" : "#fff", color: activeTab === id ? "#fff" : "#1d1d1f" }}>{label}</button>)}</div>
      {loading ? <div style={{ color: "#6e6e73", marginBottom: 12 }}>Cargando estimaciones...</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}><Metric label="Contrato estimado" value={money(contractTotal)} helper="Catálogo × unidades" /><Metric label="Borrador actual" value={money(draftSummary.subtotal)} helper={`${draftSummary.count} conceptos`} /><Metric label="Amortización" value={money(draftSummary.amortizacion)} helper={`${lotForm.anticipoPorcentaje}%`} /><Metric label="Retención" value={money(draftSummary.retencion)} helper={`${lotForm.retencionPorcentaje}%`} /><Metric label="Multas" value={money(draftSummary.multas)} /><Metric label="Neto borrador" value={money(draftSummary.neto)} /></div>

      {activeTab === "captura" ? <>
        <Card title="Captura por partidas" subtitle="Se guarda automáticamente un respaldo local mientras capturas. Al terminar, presiona Guardar borrador para que aparezca en la lista formal de borradores.">
          {Object.entries(catalogByPartida).map(([partida, concepts]) => {
            const collapsed = collapsedPartidas[partida];
            const partidaTotal = concepts.reduce((acc, concept) => acc + Number(concept.importe || 0), 0);
            const partidaPlaneada = concepts.reduce((acc, concept) => acc + plannedAmount(concept), 0);
            return <div key={partida} style={{ border: "1px solid rgba(60,60,67,0.13)", borderRadius: 20, overflow: "hidden", background: "#fff", marginBottom: 14 }}>
              <button type="button" onClick={() => togglePartida(partida)} style={{ width: "100%", border: 0, background: "rgba(242,242,247,0.78)", padding: 14, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", cursor: "pointer", textAlign: "left" }}><div><div style={{ fontWeight: 950, fontSize: 16 }}>{collapsed ? "▸" : "▾"} {partida}</div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 3 }}>{concepts.length} conceptos · Total partida {money(partidaTotal)}</div></div><div style={{ textAlign: "right" }}><div style={{ fontWeight: 950, color: "#007aff" }}>{money(partidaPlaneada)}</div><div style={{ color: "#6e6e73", fontSize: 12 }}>a estimar</div></div></button>
              {!collapsed ? <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 1080, borderCollapse: "collapse" }}><thead><tr><th style={{ ...th, textAlign: "left" }}>Clave</th><th style={{ ...th, textAlign: "left" }}>Concepto</th><th style={{ ...th, textAlign: "left" }}>Unidad</th><th style={{ ...th, textAlign: "right" }}>Unidades</th><th style={{ ...th, textAlign: "right" }}>P.U.</th><th style={{ ...th, textAlign: "right" }}>Total</th><th style={{ ...th, textAlign: "center" }}>% avance</th><th style={{ ...th, textAlign: "right" }}>A estimar</th><th style={{ ...th, textAlign: "left" }}>Comentario</th></tr></thead><tbody>{concepts.map((concept) => <tr key={concept.id}><td style={{ ...td, fontWeight: 900 }}>{concept.clave}</td><td style={{ ...td, minWidth: 300 }}>{concept.concepto}</td><td style={td}>{concept.unidad}</td><td style={{ ...td, textAlign: "right" }}>{Number(concept.cantidad || 0).toLocaleString("es-MX")}</td><td style={{ ...td, textAlign: "right" }}>{money(concept.precioUnitario)}</td><td style={{ ...td, textAlign: "right", fontWeight: 850 }}>{money(concept.importe)}</td><td style={{ ...td, textAlign: "center" }}><input type="number" min="0" max="100" value={draftRows[concept.id]?.percent || ""} onChange={(e) => updateDraft(concept.id, { percent: e.target.value })} style={{ ...inputBase, width: 88, textAlign: "center" }} /></td><td style={{ ...td, textAlign: "right", fontWeight: 950, color: draftPercent(concept) > 0 ? "#007aff" : "#6e6e73" }}>{money(plannedAmount(concept))}</td><td style={td}><input value={draftRows[concept.id]?.comment || ""} onChange={(e) => updateDraft(concept.id, { comment: e.target.value })} placeholder="Soporte" style={{ ...inputBase, minHeight: 38, padding: "8px 10px" }} /></td></tr>)}</tbody></table><div style={{ padding: 12, background: "rgba(0,122,255,0.05)", borderTop: "1px solid rgba(60,60,67,0.10)", fontWeight: 900 }}>Subtotal partida: {money(partidaPlaneada)} / {money(partidaTotal)}</div></div> : null}
            </div>;
          })}
          <div style={{ position: "sticky", bottom: 12, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", padding: 14, borderRadius: 22, background: "rgba(255,255,255,0.94)", border: "1px solid rgba(60,60,67,0.12)", boxShadow: "0 14px 40px rgba(0,0,0,0.12)" }}><div><div style={{ fontWeight: 950 }}>Borrador actual: {money(draftSummary.neto)}</div><div style={{ color: "#6e6e73", fontSize: 12 }}>Se guarda respaldo local; guarda borrador para convertirlo en lote formal.</div></div><button type="button" onClick={saveDraftLot} style={{ ...buttonBase, background: "#007aff", color: "#fff" }}>Guardar borrador</button></div>
        </Card>
      </> : null}

      {activeTab === "borradores" ? <Card title="Borradores de estimación" subtitle="Aquí puedes abrir el borrador, copiarlo a otras casas, guardar las copias y enviar el lote a aprobación.">{draftLots.length ? draftLots.map((lot) => <div key={lot.id} style={{ padding: 14, borderRadius: 18, border: "1px solid rgba(60,60,67,0.12)", background: "#fff", marginBottom: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><div style={{ fontWeight: 950 }}>{lot.nombre || `Estimación ${lot.numero}`}</div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{lot.periodo} · {Object.keys(lot.houses || {}).length} casa(s) · {money(lot.totals?.neto)}</div></div><span style={badge(lot.status)}>{statusLabel[lot.status]}</span></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><button type="button" onClick={() => loadLotToCapture(lot)} style={{ ...buttonBase, background: "#fff" }}>Abrir / editar</button><button type="button" onClick={() => copyLotToHouses(lot, copyHouseIds)} disabled={!copyHouseIds.length} style={{ ...buttonBase, background: copyHouseIds.length ? "#1d1d1f" : "#e5e5ea", color: copyHouseIds.length ? "#fff" : "#8e8e93" }}>Guardar copia en casas seleccionadas</button><button type="button" onClick={() => sendLotToApproval(lot)} style={{ ...buttonBase, background: "#007aff", color: "#fff" }}>Enviar a aprobación</button></div><div style={{ marginTop: 12 }}><div style={{ fontWeight: 900, fontSize: 13, marginBottom: 8 }}>Copiar este borrador a otras casas</div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{houses.filter((house) => !lot.houses?.[house.id]).map((house) => <button key={house.id} type="button" onClick={() => toggleCopyHouse(house.id)} style={{ ...buttonBase, background: copyHouseIds.includes(house.id) ? "#007aff" : "#fff", color: copyHouseIds.includes(house.id) ? "#fff" : "#1d1d1f" }}>{copyHouseIds.includes(house.id) ? "✓ " : ""}{house.name || house.id}</button>)}</div></div></div>) : <div style={{ color: "#6e6e73" }}>No hay borradores guardados.</div>}</Card> : null}

      {activeTab === "aprobacion" ? <Card title="Aprobación de ingeniería" subtitle="El ingeniero/supervisor revisa el lote casa por casa. Puede aprobar todas, algunas o rechazar casas con comentario.">{approvalLots.length ? <><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>{approvalLots.map((lot) => <button key={lot.id} type="button" onClick={() => { setSelectedLotId(lot.id); setSelectedReviewHouseIds([]); }} style={{ ...buttonBase, background: visibleLot?.id === lot.id ? "#007aff" : "#fff", color: visibleLot?.id === lot.id ? "#fff" : "#1d1d1f" }}>{lot.nombre || `Estimación ${lot.numero}`}</button>)}</div>{visibleLot ? <><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}><div><div style={{ fontWeight: 950, fontSize: 18 }}>{visibleLot.nombre}</div><div style={{ color: "#6e6e73", fontSize: 12 }}>{visibleLot.periodo} · Neto lote {money(visibleLot.totals?.neto)}</div></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" onClick={() => setSelectedReviewHouseIds(Object.keys(visibleLot.houses || {}))} style={{ ...buttonBase, background: "#fff" }}>Seleccionar todas</button><button type="button" onClick={() => reviewSelected(visibleLot, true)} disabled={!selectedReviewHouseIds.length} style={{ ...buttonBase, background: selectedReviewHouseIds.length ? "#34c759" : "#e5e5ea", color: selectedReviewHouseIds.length ? "#fff" : "#8e8e93" }}>Aprobar seleccionadas</button><button type="button" onClick={() => reviewSelected(visibleLot, false)} disabled={!selectedReviewHouseIds.length} style={{ ...buttonBase, background: selectedReviewHouseIds.length ? "#ff3b30" : "#e5e5ea", color: selectedReviewHouseIds.length ? "#fff" : "#8e8e93" }}>Rechazar seleccionadas</button></div></div>{Object.values(visibleLot.houses || {}).map((house) => <div key={house.houseId} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, background: "#fff", marginBottom: 12, overflow: "hidden" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 14, background: "rgba(242,242,247,0.8)", flexWrap: "wrap" }}><label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 950 }}><input type="checkbox" checked={selectedReviewHouseIds.includes(house.houseId)} onChange={() => toggleReviewHouse(house.houseId)} />{house.houseName}</label><div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span style={badge(house.status)}>{statusLabel[house.status] || house.status}</span><strong>{money(house.totals?.neto)}</strong><button type="button" onClick={() => reviewHouse(visibleLot, house.houseId, true)} style={{ ...buttonBase, background: "#34c759", color: "#fff" }}>Aprobar casa</button><button type="button" onClick={() => reviewHouse(visibleLot, house.houseId, false)} style={{ ...buttonBase, background: "#ff3b30", color: "#fff" }}>Rechazar</button></div></div><div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 920, borderCollapse: "collapse" }}><thead><tr><th style={{ ...th, textAlign: "left" }}>Partida</th><th style={{ ...th, textAlign: "left" }}>Clave</th><th style={{ ...th, textAlign: "left" }}>Concepto</th><th style={{ ...th, textAlign: "right" }}>%</th><th style={{ ...th, textAlign: "right" }}>Importe</th><th style={{ ...th, textAlign: "left" }}>Comentario</th></tr></thead><tbody>{(house.rows || []).map((row) => <tr key={`${house.houseId}-${row.conceptId}`}><td style={td}>{row.partida}</td><td style={{ ...td, fontWeight: 900 }}>{row.clave}</td><td style={td}>{row.concepto}</td><td style={{ ...td, textAlign: "right" }}>{row.avanceSolicitado}%</td><td style={{ ...td, textAlign: "right", fontWeight: 950 }}>{money(row.importeSolicitado)}</td><td style={td}>{row.comentarioConstructora || "-"}</td></tr>)}</tbody></table></div></div>)}</> : null}</> : <div style={{ color: "#6e6e73" }}>No hay lotes enviados a aprobación.</div>}</Card> : null}

      {activeTab === "estatus" ? <Card title="Estatus de estimaciones" subtitle="Administración y constructora pueden ver en qué etapa va cada lote formal. El monto total del lote es el monto de referencia para pago.">{lots.length ? lots.map((lot) => <div key={lot.id} style={{ padding: 14, borderRadius: 18, border: "1px solid rgba(60,60,67,0.12)", background: "#fff", marginBottom: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><div style={{ fontWeight: 950 }}>{lot.nombre || `Estimación ${lot.numero}`} · {selectedObraId}</div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>Periodo {lot.periodo} · Casas {Object.keys(lot.houses || {}).length} · Neto {money(lot.totals?.neto)}</div></div><span style={badge(lot.status)}>{statusLabel[lot.status] || lot.status}</span></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>{Object.values(lot.houses || {}).map((house) => <button key={house.houseId} type="button" onClick={() => setSelectedLotId(selectedLotId === lot.id ? "" : lot.id)} style={{ ...buttonBase, background: "#fff" }}>{house.houseName}: {money(house.totals?.neto)}</button>)}</div>{selectedLotId === lot.id ? <div style={{ marginTop: 12, display: "grid", gap: 8 }}>{Object.values(lot.houses || {}).map((house) => <div key={`detail-${house.houseId}`} style={{ padding: 12, borderRadius: 14, background: "#f8fafc", border: "1px solid rgba(60,60,67,0.10)" }}><strong>{house.houseName}</strong> · {house.status} · {money(house.totals?.neto)} · {(house.rows || []).length} conceptos</div>)}</div> : null}{lot.status === "lista_administracion" ? <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}><button type="button" onClick={() => setAdminStatus(lot, "administracion_revision")} style={{ ...buttonBase, background: "#007aff", color: "#fff" }}>Administración revisando</button><button type="button" onClick={() => setAdminStatus(lot, "pago_programado")} style={{ ...buttonBase, background: "#1d1d1f", color: "#fff" }}>Programar pago</button></div> : null}{lot.status === "pago_programado" ? <button type="button" onClick={() => setAdminStatus(lot, "pagada")} style={{ ...buttonBase, background: "#34c759", color: "#fff", marginTop: 12 }}>Marcar pagada</button> : null}</div>) : <div style={{ color: "#6e6e73" }}>No hay lotes de estimación.</div>}</Card> : null}

      {activeTab === "catalogo" ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}><Card title="Catálogo de conceptos" subtitle="Carga el CSV de obra. Formato esperado: PARTIDA, clave, descripcion, Unidades, unidad, P.U."><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><label style={{ ...buttonBase, background: "#007aff", color: "#fff", display: "inline-flex" }}>{importingCatalog ? "Importando..." : "Subir CSV"}<input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => importCatalogFile(e.target.files?.[0])} /></label><button type="button" onClick={seedCatalog} style={{ ...buttonBase, background: "#fff" }}>Cargar demo</button></div>{catalogImportInfo ? <div style={{ marginTop: 12, color: "#6e6e73", fontSize: 13 }}>Último archivo: {catalogImportInfo.fileName} · {catalogImportInfo.rows} conceptos · {money(catalogImportInfo.total)}</div> : null}<div style={{ marginTop: 12, color: "#6e6e73", fontSize: 13 }}>{catalog.length} conceptos cargados · {money(catalog.reduce((acc, item) => acc + Number(item.importe || 0), 0))} por casa</div></Card><Card title="Concepto manual" subtitle="Para agregar extraordinarios o conceptos no incluidos en catálogo."><Field label="Clave"><input value={manualConcept.clave} onChange={(e) => setManualConcept({ ...manualConcept, clave: e.target.value })} style={inputBase} /></Field><Field label="Partida"><input value={manualConcept.partida} onChange={(e) => setManualConcept({ ...manualConcept, partida: e.target.value })} style={inputBase} /></Field><Field label="Concepto"><textarea value={manualConcept.concepto} onChange={(e) => setManualConcept({ ...manualConcept, concepto: e.target.value })} rows={3} style={{ ...inputBase, resize: "vertical" }} /></Field><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}><Field label="Unidad"><input value={manualConcept.unidad} onChange={(e) => setManualConcept({ ...manualConcept, unidad: e.target.value })} style={inputBase} /></Field><Field label="Unidades"><input type="number" value={manualConcept.cantidad} onChange={(e) => setManualConcept({ ...manualConcept, cantidad: e.target.value })} style={inputBase} /></Field><Field label="P.U."><input type="number" value={manualConcept.precioUnitario} onChange={(e) => setManualConcept({ ...manualConcept, precioUnitario: e.target.value })} style={inputBase} /></Field></div><button type="button" onClick={addManualConcept} style={{ ...buttonBase, background: "#007aff", color: "#fff" }}>Agregar concepto</button></Card></div> : null}
    </div>
  </div>;
}
