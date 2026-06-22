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

const statusLabel = {
  borrador: "Borrador",
  borrador_observado: "Borrador observado",
  en_aprobacion: "En aprobación",
  lista_administracion: "Lista para administración",
  administracion_revision: "En revisión administración",
  pago_programado: "Pago programado",
  pagada: "Pagada",
};
const adminStatuses = ["lista_administracion", "administracion_revision", "pago_programado", "pagada"];
const approvedLotStatuses = adminStatuses;
const draftStatuses = ["borrador", "borrador_observado"];

function money(value) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value || 0));
}
function parseNumber(value) {
  const parsed = Number(String(value ?? "").replace(/\$/g, "").replace(/,/g, "").replace(/\s/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}
function clampPercent(value) { return Math.min(100, Math.max(0, parseNumber(value))); }
function slugify(text = "") { return String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function normalizeCatalogItem(item, index = 0) {
  const cantidad = parseNumber(item.cantidad ?? item.Unidades ?? item.unidades ?? item.cantidadContratada ?? 1);
  const precioUnitario = parseNumber(item.precioUnitario ?? item["P.U."] ?? item.pu ?? item.PU ?? item.precio_unitario ?? 0);
  const clave = String(item.clave || item.Clave || item.id || `CON-${index + 1}`).trim();
  const partida = String(item.partida || item.PARTIDA || item.capitulo || "General").trim();
  const concepto = String(item.concepto || item.descripcion || item.Descripcion || item.descripción || item.description || "Concepto sin nombre").trim();
  const unidad = String(item.unidad || item.Unidad || "lote").trim();
  const rowNumber = Number(item.rowNumber || index + 1);
  return {
    id: item.id || `${slugify(partida)}-${slugify(clave)}-${String(rowNumber).padStart(4, "0")}`,
    clave,
    partida,
    concepto,
    descripcion: concepto,
    unidad,
    cantidad,
    precioUnitario,
    importe: cantidad * precioUnitario,
    fechaEntrega: item.fechaEntrega || item.fecha_entrega || item["Fecha compromiso"] || "",
    rowNumber,
    sourceFileName: item.sourceFileName || "",
  };
}
function groupByPartida(items) {
  return (items || []).reduce((acc, item) => {
    const key = item.partida || "General";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}
function todayDelay(fechaEntrega) {
  if (!fechaEntrega) return 0;
  const today = new Date();
  const entrega = new Date(fechaEntrega);
  return today > entrega ? Math.ceil((today - entrega) / (1000 * 60 * 60 * 24)) : 0;
}
function statusStyle(status) {
  const colors = {
    borrador: ["#eef2f7", "#475467"],
    borrador_observado: ["#fff3cd", "#9a6700"],
    en_aprobacion: ["#eef2ff", "#3730a3"],
    lista_administracion: ["#e8f7ed", "#157347"],
    administracion_revision: ["#eef2ff", "#3730a3"],
    pago_programado: ["#e8f7ed", "#157347"],
    pagada: ["#e8f7ed", "#157347"],
    observada_supervision: ["#fff3cd", "#9a6700"],
    aprobada_supervision: ["#e8f7ed", "#157347"],
  };
  const [bg, color] = colors[status] || colors.borrador;
  return { display: "inline-flex", borderRadius: 999, padding: "6px 10px", background: bg, color, fontSize: 12, fontWeight: 900 };
}
function Field({ label, children }) {
  return <label style={{ display: "block", marginBottom: 12 }}><div style={{ fontSize: 13, fontWeight: 850, color: "#1d1d1f", marginBottom: 6 }}>{label}</div>{children}</label>;
}
function Card({ title, subtitle, children }) {
  return <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 22, padding: 16, background: "rgba(255,255,255,0.90)", boxShadow: "0 8px 28px rgba(0,0,0,0.055)", marginBottom: 16 }}>{title ? <div style={{ fontSize: 18, fontWeight: 950, color: "#1d1d1f" }}>{title}</div> : null}{subtitle ? <div style={{ marginTop: 4, color: "#6e6e73", fontSize: 13, lineHeight: 1.45 }}>{subtitle}</div> : null}{children ? <div style={{ marginTop: title || subtitle ? 14 : 0 }}>{children}</div> : null}</div>;
}
function Metric({ label, value, helper }) {
  return <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 20, padding: 15, background: "#fff" }}><div style={{ color: "#6e6e73", fontSize: 12, fontWeight: 800 }}>{label}</div><div style={{ color: "#1d1d1f", fontSize: 24, fontWeight: 950, marginTop: 4 }}>{value}</div>{helper ? <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{helper}</div> : null}</div>;
}
function FilterBar({ search, setSearch, status, setStatus, house, setHouse, houses, partida, setPartida, partidas, showStatus = false, showHouse = false, showPartida = false }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por estimación, casa, partida, clave o concepto" style={inputBase} />
    {showStatus ? <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputBase}><option value="todos">Todos los estatus</option>{Object.entries(statusLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select> : null}
    {showHouse ? <select value={house} onChange={(e) => setHouse(e.target.value)} style={inputBase}><option value="todas">Todas las casas</option>{houses.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select> : null}
    {showPartida ? <select value={partida} onChange={(e) => setPartida(e.target.value)} style={inputBase}><option value="todas">Todas las partidas</option>{partidas.map((item) => <option key={item} value={item}>{item}</option>)}</select> : null}
  </div>;
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
  const [draftRows, setDraftRows] = useState({});
  const [collapsedPartidas, setCollapsedPartidas] = useState({});
  const [currentLotId, setCurrentLotId] = useState("");
  const [selectedLotId, setSelectedLotId] = useState("");
  const [selectedReviewRowIds, setSelectedReviewRowIds] = useState({});
  const [lotForm, setLotForm] = useState({ numero: "", nombre: "", periodo: new Date().toISOString().slice(0, 7) });
  const [filters, setFilters] = useState({ captura: "", borradores: "", aprobacion: "", estatus: "", status: "todos", house: "todas", partida: "todas" });

  const selectedObra = obras.find((obra) => obra.id === selectedObraId) || {};
  const selectedHouse = houses.find((house) => house.id === selectedHouseId) || null;
  const selectedLot = lots.find((lot) => lot.id === selectedLotId) || null;
  const catalogByPartida = useMemo(() => groupByPartida(catalog), [catalog]);
  const partidas = useMemo(() => Object.keys(catalogByPartida), [catalogByPartida]);
  const config = selectedObra.estimationConfig || {};
  const anticipoPorcentaje = parseNumber(config.anticipoPorcentaje ?? config.advancePercent ?? 0);
  const retencionPorcentaje = parseNumber(config.retencionPorcentaje ?? 0);
  const multaDiaria = parseNumber(config.multaDiaria ?? 0);
  const nextNumber = useMemo(() => {
    const numbers = lots.map((lot) => Number(lot.numero || 0)).filter(Boolean);
    return numbers.length ? Math.max(...numbers) + 1 : 1;
  }, [lots]);
  const draftStorageKey = `triton_estimacion_draft_${selectedObraId}_${selectedHouseId}_${lotForm.periodo}`;

  const draftLots = lots.filter((lot) => draftStatuses.includes(lot.status));
  const approvalLots = lots.filter((lot) => lot.status === "en_aprobacion");
  const adminLots = lots.filter((lot) => adminStatuses.includes(lot.status));
  const visibleLot = selectedLot || approvalLots[0] || lots[0] || null;

  const approvedProgress = useMemo(() => {
    const map = {};
    lots.forEach((lot) => {
      if (!approvedLotStatuses.includes(lot.status)) return;
      Object.values(lot.houses || {}).forEach((house) => {
        (house.rows || []).forEach((row) => {
          if (row.status !== "aprobada_supervision") return;
          const key = `${house.houseId || house.id}::${row.conceptId}`;
          map[key] = (map[key] || 0) + Number(row.avanceAprobado ?? row.avanceSolicitado ?? 0);
        });
      });
    });
    return map;
  }, [lots]);

  function autoLotName(numero = lotForm.numero || nextNumber, periodo = lotForm.periodo) {
    const obraName = selectedObra.name || selectedObraId;
    const stamp = new Date().toISOString().slice(0, 10);
    return `Borrador estimación ${String(numero).padStart(2, "0")} · ${obraName} · ${periodo || stamp}`;
  }
  function approvedFor(houseId, conceptId) { return Math.min(100, Number(approvedProgress[`${houseId}::${conceptId}`] || 0)); }
  function availableFor(concept, houseId = selectedHouseId) { return Math.max(0, 100 - approvedFor(houseId, concept.id)); }
  function draftPercent(concept) { return Math.min(availableFor(concept), clampPercent(draftRows[concept.id]?.percent)); }
  function plannedAmount(concept) { return Number(concept.importe || 0) * (draftPercent(concept) / 100); }
  function approvedAmountFor(concept, houseId = selectedHouseId) { return Number(concept.importe || 0) * (approvedFor(houseId, concept.id) / 100); }
  function computeDeductions(subtotal, rows = []) {
    const amortizacion = subtotal * (anticipoPorcentaje / 100);
    const retencion = subtotal * (retencionPorcentaje / 100);
    const multas = rows.reduce((acc, row) => acc + Number(row.multa || 0), 0);
    const neto = Math.max(0, subtotal - amortizacion - retencion - multas);
    return { amortizacion, retencion, multas, neto };
  }
  function computeRowsTotals(rows, onlyApproved = false) {
    const baseRows = onlyApproved ? rows.filter((row) => row.status === "aprobada_supervision") : rows.filter((row) => row.status !== "observada_supervision");
    const subtotal = baseRows.reduce((acc, row) => acc + Number(row.importeAprobado || row.importeSolicitado || 0), 0);
    return { subtotal, ...computeDeductions(subtotal, baseRows) };
  }
  function housePayload(house, rows, houseStatus = "borrador") {
    return { id: house.id, houseId: house.id, houseName: house.name || house.id, block: house.block || "", status: houseStatus, rows, totals: computeRowsTotals(rows, false) };
  }
  function lotTotals(housesObject) {
    return Object.values(housesObject || {}).reduce((acc, house) => ({
      subtotal: acc.subtotal + Number(house.totals?.subtotal || 0),
      amortizacion: acc.amortizacion + Number(house.totals?.amortizacion || 0),
      retencion: acc.retencion + Number(house.totals?.retencion || 0),
      multas: acc.multas + Number(house.totals?.multas || 0),
      neto: acc.neto + Number(house.totals?.neto || 0),
      houses: acc.houses + 1,
    }), { subtotal: 0, amortizacion: 0, retencion: 0, multas: 0, neto: 0, houses: 0 });
  }

  const draftSummary = useMemo(() => {
    const rows = catalog.map((concept) => draftPercent(concept) > 0 ? { multa: todayDelay(concept.fechaEntrega) * multaDiaria } : null).filter(Boolean);
    const subtotal = catalog.reduce((acc, concept) => acc + plannedAmount(concept), 0);
    return { subtotal, ...computeDeductions(subtotal, rows), count: Object.values(draftRows).filter((row) => parseNumber(row.percent) > 0).length };
  }, [catalog, draftRows, selectedHouseId, approvedProgress, anticipoPorcentaje, retencionPorcentaje, multaDiaria]);
  const contractTotal = useMemo(() => catalog.reduce((acc, item) => acc + Number(item.importe || 0), 0) * Math.max(houses.length || 1, 1), [catalog, houses.length]);
  const approvedTotal = useMemo(() => houses.reduce((houseAcc, house) => houseAcc + catalog.reduce((acc, concept) => acc + approvedAmountFor(concept, house.id), 0), 0), [houses, catalog, approvedProgress]);

  useEffect(() => {
    const handler = () => { setOpen(true); setActiveTab("captura"); };
    window.addEventListener("triton-open-estimaciones", handler);
    window.addEventListener("triton-module-estimaciones", handler);
    return () => { window.removeEventListener("triton-open-estimaciones", handler); window.removeEventListener("triton-module-estimaciones", handler); };
  }, []);
  useEffect(() => { if (!open) return; loadData(); }, [open, selectedObraId]);
  useEffect(() => { if (!lotForm.numero && nextNumber) setLotForm((prev) => ({ ...prev, numero: nextNumber, nombre: prev.nombre || autoLotName(nextNumber, prev.periodo) })); }, [nextNumber, selectedObraId]);
  useEffect(() => { if (!open || !selectedHouseId) return; const raw = localStorage.getItem(draftStorageKey); setDraftRows(raw ? JSON.parse(raw) : {}); }, [open, draftStorageKey, selectedHouseId]);
  useEffect(() => { if (!open || !selectedHouseId) return; localStorage.setItem(draftStorageKey, JSON.stringify(draftRows)); }, [draftRows, draftStorageKey, open, selectedHouseId]);

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
      setCatalog(catalogSnap.docs.map((item, index) => normalizeCatalogItem({ id: item.id, ...item.data() }, index)));
      const lotsSnap = await getDocs(query(collection(db, "obras", selectedObraId, "estimacionLotes"), orderBy("createdAt", "desc")));
      setLots(lotsSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }
  function updateDraft(conceptId, patch) {
    const concept = catalog.find((item) => item.id === conceptId);
    const available = concept ? availableFor(concept) : 100;
    setDraftRows((prev) => ({ ...prev, [conceptId]: { ...(prev[conceptId] || {}), ...patch, percent: patch.percent !== undefined ? Math.min(available, clampPercent(patch.percent)) : (prev[conceptId]?.percent || "") } }));
  }
  function buildRowsFromDraft() {
    return catalog.map((concept) => {
      const percent = draftPercent(concept);
      if (percent <= 0) return null;
      const previo = approvedFor(selectedHouseId, concept.id);
      const multa = todayDelay(concept.fechaEntrega) * multaDiaria;
      return { rowId: `${concept.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, conceptId: concept.id, clave: concept.clave, partida: concept.partida, concepto: concept.concepto, unidad: concept.unidad, cantidad: Number(concept.cantidad || 0), precioUnitario: Number(concept.precioUnitario || 0), importeConcepto: Number(concept.importe || 0), avancePrevioAprobado: previo, avanceDisponibleAntes: Math.max(0, 100 - previo), avanceSolicitado: percent, avanceAprobado: 0, importeSolicitado: Number(concept.importe || 0) * (percent / 100), importeAprobado: 0, comentarioConstructora: draftRows[concept.id]?.comment || "", fechaEntrega: concept.fechaEntrega || "", diasAtraso: todayDelay(concept.fechaEntrega), multa, status: "borrador" };
    }).filter(Boolean);
  }
  async function saveDraftLot() {
    if (!selectedHouse) { alert("Selecciona una casa base."); return; }
    const rows = buildRowsFromDraft();
    if (!rows.length) { alert("Captura al menos un porcentaje de avance."); return; }
    const numero = Number(lotForm.numero || nextNumber);
    const id = currentLotId || `estimacion-${numero}-${Date.now()}`;
    const nombre = lotForm.nombre || autoLotName(numero, lotForm.periodo);
    const houseData = housePayload(selectedHouse, rows, "borrador");
    const housesObject = { [selectedHouse.id]: houseData };
    const lot = { id, obraId: selectedObraId, obraName: selectedObra.name || selectedObraId, numero, nombre, periodo: lotForm.periodo, status: "borrador", estimationConfig: { anticipoPorcentaje, retencionPorcentaje, multaDiaria }, houses: housesObject, totals: lotTotals(housesObject), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", id), lot, { merge: true });
    setCurrentLotId(id);
    alert("Borrador guardado como lote formal.");
    await loadData();
    setActiveTab("borradores");
  }
  async function copyLotToHouses(lot, targetIds = copyHouseIds) {
    if (!lot || !targetIds.length) { alert("Selecciona casas destino."); return; }
    const sourceHouse = Object.values(lot.houses || {})[0];
    if (!sourceHouse) return;
    const housesObject = { ...(lot.houses || {}) };
    targetIds.forEach((houseId) => {
      const house = houses.find((item) => item.id === houseId);
      if (!house) return;
      const copiedRows = (sourceHouse.rows || []).filter((row) => row.status !== "observada_supervision").map((row) => ({ ...row, rowId: `${row.conceptId}-${houseId}-${Date.now()}`, status: "borrador", avanceAprobado: 0, importeAprobado: 0, comentarioSupervision: "" }));
      housesObject[houseId] = housePayload(house, copiedRows, "borrador");
    });
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", lot.id), { houses: housesObject, totals: lotTotals(housesObject), updatedAt: serverTimestamp() }, { merge: true });
    setCopyHouseIds([]);
    await loadData();
  }
  async function sendLotToApproval(lot) {
    const housesObject = {};
    Object.entries(lot.houses || {}).forEach(([houseId, house]) => {
      const rows = (house.rows || []).filter((row) => row.status !== "observada_supervision").map((row) => ({ ...row, status: "en_aprobacion" }));
      housesObject[houseId] = { ...house, rows, status: "en_aprobacion", totals: computeRowsTotals(rows, false) };
    });
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", lot.id), { houses: housesObject, status: "en_aprobacion", totals: lotTotals(housesObject), submittedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    await loadData();
    setActiveTab("aprobacion");
  }
  function loadLotToCapture(lot) {
    const firstHouse = Object.values(lot.houses || {})[0];
    if (!firstHouse) return;
    setSelectedHouseId(firstHouse.houseId);
    const nextDraft = {};
    (firstHouse.rows || []).filter((row) => row.status !== "observada_supervision").forEach((row) => { nextDraft[row.conceptId] = { percent: row.avanceSolicitado, comment: row.comentarioConstructora || "" }; });
    setDraftRows(nextDraft);
    setCurrentLotId(lot.id);
    setLotForm({ numero: lot.numero, nombre: lot.nombre, periodo: lot.periodo });
    setActiveTab("captura");
  }
  async function acceptLotWithoutObserved(lot) {
    const housesObject = {};
    Object.entries(lot.houses || {}).forEach(([houseId, house]) => {
      const rows = (house.rows || []).filter((row) => row.status !== "observada_supervision").map((row) => ({ ...row, status: "borrador", avanceAprobado: 0, importeAprobado: 0 }));
      housesObject[houseId] = { ...house, rows, status: "borrador", totals: computeRowsTotals(rows, false) };
    });
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", lot.id), { houses: housesObject, status: "borrador", totals: lotTotals(housesObject), acceptedWithoutObservedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    await loadData();
  }
  async function reviewRows(lot, houseId, rowIds, approved) {
    if (!lot || !houseId || !rowIds.length) return;
    let comment = "";
    if (!approved) {
      comment = window.prompt("Comentario obligatorio para regresar el lote a borrador observado:") || "";
      if (!comment.trim()) { alert("Agrega un comentario para poder observar/rechazar."); return; }
    }
    const housesObject = { ...(lot.houses || {}) };
    const house = housesObject[houseId];
    const rows = (house.rows || []).map((row) => {
      const id = row.rowId || row.conceptId;
      if (!rowIds.includes(id)) return row;
      return { ...row, status: approved ? "aprobada_supervision" : "observada_supervision", avanceAprobado: approved ? Number(row.avanceSolicitado || 0) : 0, importeAprobado: approved ? Number(row.importeSolicitado || 0) : 0, comentarioSupervision: comment, reviewedAt: new Date().toISOString() };
    });
    const hasObserved = rows.some((row) => row.status === "observada_supervision");
    housesObject[houseId] = { ...house, rows, status: hasObserved ? "borrador_observado" : "en_aprobacion", comentarioSupervision: comment, reviewedAt: new Date().toISOString(), totals: computeRowsTotals(rows, false) };
    const allRows = Object.values(housesObject).flatMap((item) => item.rows || []);
    const nextStatus = allRows.some((row) => row.status === "observada_supervision") ? "borrador_observado" : allRows.every((row) => row.status === "aprobada_supervision") ? "lista_administracion" : "en_aprobacion";
    const updatePayload = { houses: housesObject, status: nextStatus, totals: lotTotals(housesObject), reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() };
    if (nextStatus === "borrador_observado") updatePayload.returnedToDraftAt = serverTimestamp();
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", lot.id), updatePayload, { merge: true });
    setSelectedReviewRowIds((prev) => ({ ...prev, [houseId]: [] }));
    await loadData();
  }
  async function reviewHouse(lot, houseId, approved) {
    const house = lot.houses?.[houseId];
    const rowIds = (house?.rows || []).filter((row) => row.status === "en_aprobacion").map((row) => row.rowId || row.conceptId);
    await reviewRows(lot, houseId, rowIds, approved);
  }
  async function setAdminStatus(lot, status) {
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", lot.id), { status, adminUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    await loadData();
  }
  function togglePartida(key) { setCollapsedPartidas((prev) => ({ ...prev, [key]: !prev[key] })); }
  function toggleCopyHouse(id) { setCopyHouseIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]); }
  function toggleReviewRow(houseId, rowId) { setSelectedReviewRowIds((prev) => { const current = prev[houseId] || []; return { ...prev, [houseId]: current.includes(rowId) ? current.filter((item) => item !== rowId) : [...current, rowId] }; }); }
  function selectAllRowsForHouse(house) { setSelectedReviewRowIds((prev) => ({ ...prev, [house.houseId]: (house.rows || []).filter((row) => row.status === "en_aprobacion").map((row) => row.rowId || row.conceptId) })); }
  function setFilter(key, value) { setFilters((prev) => ({ ...prev, [key]: value })); }
  function lotMatches(lot, search) {
    const q = String(search || "").toLowerCase().trim();
    if (!q) return true;
    const text = [lot.nombre, lot.numero, lot.periodo, lot.obraName, statusLabel[lot.status], ...Object.values(lot.houses || {}).flatMap((house) => [house.houseName, ...(house.rows || []).flatMap((row) => [row.partida, row.clave, row.concepto, row.comentarioSupervision])])].join(" ").toLowerCase();
    return text.includes(q);
  }

  const filteredCatalogByPartida = useMemo(() => {
    const q = filters.captura.toLowerCase().trim();
    const partidaFilter = filters.partida;
    const filtered = catalog.filter((item) => (partidaFilter === "todas" || item.partida === partidaFilter) && (!q || [item.partida, item.clave, item.concepto, item.unidad].join(" ").toLowerCase().includes(q)));
    return groupByPartida(filtered);
  }, [catalog, filters.captura, filters.partida]);
  const filteredDraftLots = draftLots.filter((lot) => lotMatches(lot, filters.borradores) && (filters.status === "todos" || lot.status === filters.status) && (filters.house === "todas" || Boolean(lot.houses?.[filters.house])));
  const filteredApprovalLots = approvalLots.filter((lot) => lotMatches(lot, filters.aprobacion) && (filters.house === "todas" || Boolean(lot.houses?.[filters.house])));
  const filteredAdminLots = (adminLots.length ? adminLots : lots).filter((lot) => lotMatches(lot, filters.estatus) && (filters.status === "todos" || lot.status === filters.status) && (filters.house === "todas" || Boolean(lot.houses?.[filters.house])));

  if (!open) return null;

  return <div className="triton-estimaciones-module" style={{ position: "fixed", left: "var(--triton-shell-offset, 84px)", top: 0, right: 0, bottom: 0, zIndex: 2147483644, background: "#f5f5f7", overflow: "auto" }}>
    <style>{`@media (max-width: 900px) { .triton-estimaciones-module { left: 0 !important; z-index: 2147483647 !important; } }`}</style>
    <div style={{ maxWidth: 1480, margin: "0 auto", padding: "calc(24px + env(safe-area-inset-top, 0px)) 18px 42px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap" }}>
        <div><div style={{ fontSize: 34, fontWeight: 950, color: "#1d1d1f", letterSpacing: -0.7 }}>Estimaciones</div><div style={{ color: "#6e6e73", fontSize: 16, marginTop: 6 }}>Borradores observados, aprobación completa por lote y seguimiento formal hasta pago.</div></div>
        <button type="button" onClick={() => setOpen(false)} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>Volver a Calidad</button>
      </div>

      <Card title="Contexto del lote" subtitle="El catálogo y el anticipo se configuran en Obras. Aquí se captura y controla el viaje formal de la estimación.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))", gap: 12 }}>
          <Field label="Obra"><select value={selectedObraId} onChange={(e) => { setSelectedObraId(e.target.value); setSelectedHouseId(""); setCurrentLotId(""); }} style={inputBase}>{obras.length ? obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.name || obra.id}</option>) : <option value={defaultObraId}>Arenna</option>}</select></Field>
          <Field label="Casa base"><select value={selectedHouseId} onChange={(e) => { setSelectedHouseId(e.target.value); setCurrentLotId(""); }} style={inputBase}>{houses.map((house) => <option key={house.id} value={house.id}>{house.name || house.id} · Bloque {house.block || "-"}</option>)}</select></Field>
          <Field label="No. estimación"><input type="number" value={lotForm.numero} onChange={(e) => setLotForm({ ...lotForm, numero: e.target.value, nombre: lotForm.nombre || autoLotName(e.target.value, lotForm.periodo) })} style={inputBase} /></Field>
          <Field label="Nombre automático / editable"><input value={lotForm.nombre} onChange={(e) => setLotForm({ ...lotForm, nombre: e.target.value })} placeholder={autoLotName()} style={inputBase} /></Field>
          <Field label="Periodo"><input type="month" value={lotForm.periodo} onChange={(e) => setLotForm({ ...lotForm, periodo: e.target.value, nombre: lotForm.nombre || autoLotName(lotForm.numero || nextNumber, e.target.value) })} style={inputBase} /></Field>
          <div style={{ padding: 12, borderRadius: 16, background: "#fff", border: "1px solid rgba(60,60,67,0.12)" }}><div style={{ color: "#6e6e73", fontSize: 12, fontWeight: 800 }}>Anticipo configurado</div><div style={{ fontWeight: 950, marginTop: 4 }}>{anticipoPorcentaje}%</div></div>
          <div style={{ padding: 12, borderRadius: 16, background: "#fff", border: "1px solid rgba(60,60,67,0.12)" }}><div style={{ color: "#6e6e73", fontSize: 12, fontWeight: 800 }}>Retención</div><div style={{ fontWeight: 950, marginTop: 4 }}>{retencionPorcentaje}%</div></div>
          <div style={{ padding: 12, borderRadius: 16, background: "#fff", border: "1px solid rgba(60,60,67,0.12)" }}><div style={{ color: "#6e6e73", fontSize: 12, fontWeight: 800 }}>Multa diaria</div><div style={{ fontWeight: 950, marginTop: 4 }}>{money(multaDiaria)}</div></div>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", margin: "14px 0" }}>{[["captura", "1. Captura borrador"], ["borradores", "2. Borradores / observados"], ["aprobacion", "3. Aprobación ingeniería"], ["estatus", "4. Estatus administración"]].map(([id, label]) => <button key={id} type="button" onClick={() => setActiveTab(id)} style={{ ...buttonBase, background: activeTab === id ? "#007aff" : "#fff", color: activeTab === id ? "#fff" : "#1d1d1f" }}>{label}</button>)}</div>
      {loading ? <div style={{ color: "#6e6e73", marginBottom: 12 }}>Cargando estimaciones...</div> : null}
      {!catalog.length ? <div style={{ marginBottom: 14, padding: 14, borderRadius: 18, background: "#fff3cd", color: "#9a6700", fontWeight: 850 }}>Esta obra todavía no tiene catálogo de conceptos. Súbelo desde Obras &gt; Configuración de estimaciones.</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Metric label="Contrato estimado" value={money(contractTotal)} helper="Catálogo × unidades" />
        <Metric label="Aprobado acumulado" value={money(approvedTotal)} helper="Solo estimaciones ya aceptadas para pago" />
        <Metric label="Borrador bruto" value={money(draftSummary.subtotal)} helper={`${draftSummary.count} conceptos`} />
        <Metric label="Amortización anticipo" value={money(draftSummary.amortizacion)} helper={`${anticipoPorcentaje}% del bruto`} />
        <Metric label="Retención" value={money(draftSummary.retencion)} helper={`${retencionPorcentaje}%`} />
        <Metric label="Neto borrador" value={money(draftSummary.neto)} helper="Bruto - amortización - retención - multas" />
      </div>

      {activeTab === "captura" ? <Card title="Captura por partidas" subtitle="Si un lote observado se vuelve a abrir, puedes ajustar los conceptos o guardar una nueva versión del borrador.">
        <FilterBar search={filters.captura} setSearch={(v) => setFilter("captura", v)} partida={filters.partida} setPartida={(v) => setFilter("partida", v)} partidas={partidas} showPartida />
        {Object.entries(filteredCatalogByPartida).map(([partida, concepts]) => {
          const collapsed = collapsedPartidas[partida];
          const partidaTotal = concepts.reduce((acc, concept) => acc + Number(concept.importe || 0), 0);
          const partidaPlaneada = concepts.reduce((acc, concept) => acc + plannedAmount(concept), 0);
          const partidaAprobada = concepts.reduce((acc, concept) => acc + approvedAmountFor(concept), 0);
          return <div key={partida} style={{ border: "1px solid rgba(60,60,67,0.13)", borderRadius: 20, overflow: "hidden", background: "#fff", marginBottom: 14 }}>
            <button type="button" onClick={() => togglePartida(partida)} style={{ width: "100%", border: 0, background: "rgba(242,242,247,0.78)", padding: 14, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", cursor: "pointer", textAlign: "left" }}><div><div style={{ fontWeight: 950, fontSize: 16 }}>{collapsed ? "▸" : "▾"} {partida}</div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 3 }}>{concepts.length} conceptos · Total {money(partidaTotal)} · Aprobado {money(partidaAprobada)}</div></div><div style={{ textAlign: "right" }}><div style={{ fontWeight: 950, color: "#007aff" }}>{money(partidaPlaneada)}</div><div style={{ color: "#6e6e73", fontSize: 12 }}>a estimar</div></div></button>
            {!collapsed ? <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 1260, borderCollapse: "collapse" }}><thead><tr><th style={{ ...th, textAlign: "left" }}>Clave</th><th style={{ ...th, textAlign: "left" }}>Concepto</th><th style={{ ...th, textAlign: "left" }}>Unidad</th><th style={{ ...th, textAlign: "right" }}>Unidades</th><th style={{ ...th, textAlign: "right" }}>P.U.</th><th style={{ ...th, textAlign: "right" }}>Total</th><th style={{ ...th, textAlign: "right" }}>Aprobado</th><th style={{ ...th, textAlign: "right" }}>Disponible</th><th style={{ ...th, textAlign: "center" }}>% estimar</th><th style={{ ...th, textAlign: "right" }}>A estimar</th><th style={{ ...th, textAlign: "left" }}>Fecha compromiso</th><th style={{ ...th, textAlign: "left" }}>Comentario</th></tr></thead><tbody>{concepts.map((concept) => { const approved = approvedFor(selectedHouseId, concept.id); const available = availableFor(concept); return <tr key={concept.id}><td style={{ ...td, fontWeight: 900 }}>{concept.clave}</td><td style={{ ...td, minWidth: 300 }}>{concept.concepto}</td><td style={td}>{concept.unidad}</td><td style={{ ...td, textAlign: "right" }}>{Number(concept.cantidad || 0).toLocaleString("es-MX")}</td><td style={{ ...td, textAlign: "right" }}>{money(concept.precioUnitario)}</td><td style={{ ...td, textAlign: "right", fontWeight: 850 }}>{money(concept.importe)}</td><td style={{ ...td, textAlign: "right", color: approved > 0 ? "#157347" : "#6e6e73", fontWeight: 850 }}>{approved.toFixed(1)}%</td><td style={{ ...td, textAlign: "right", color: available <= 0 ? "#b42318" : "#005ecb", fontWeight: 850 }}>{available.toFixed(1)}%</td><td style={{ ...td, textAlign: "center" }}><input type="number" min="0" max={available} value={draftRows[concept.id]?.percent || ""} disabled={available <= 0} onChange={(e) => updateDraft(concept.id, { percent: e.target.value })} style={{ ...inputBase, width: 88, textAlign: "center", opacity: available <= 0 ? 0.55 : 1 }} /></td><td style={{ ...td, textAlign: "right", fontWeight: 950, color: draftPercent(concept) > 0 ? "#007aff" : "#6e6e73" }}>{money(plannedAmount(concept))}</td><td style={td}>{concept.fechaEntrega || "Opcional"}</td><td style={td}><input value={draftRows[concept.id]?.comment || ""} onChange={(e) => updateDraft(concept.id, { comment: e.target.value })} placeholder="Soporte" style={{ ...inputBase, minHeight: 38, padding: "8px 10px" }} /></td></tr>; })}</tbody></table><div style={{ padding: 12, background: "rgba(0,122,255,0.05)", borderTop: "1px solid rgba(60,60,67,0.10)", fontWeight: 900 }}>Subtotal partida: {money(partidaPlaneada)} / {money(partidaTotal)}</div></div> : null}
          </div>;
        })}
        <div style={{ position: "sticky", bottom: 12, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", padding: 14, borderRadius: 22, background: "rgba(255,255,255,0.94)", border: "1px solid rgba(60,60,67,0.12)", boxShadow: "0 14px 40px rgba(0,0,0,0.12)" }}><div><div style={{ fontWeight: 950 }}>Bruto {money(draftSummary.subtotal)} · Amortización {money(draftSummary.amortizacion)} · Neto {money(draftSummary.neto)}</div><div style={{ color: "#6e6e73", fontSize: 12 }}>El nombre se genera automático por número, obra y periodo. Se guarda respaldo local mientras capturas.</div></div><button type="button" onClick={saveDraftLot} style={{ ...buttonBase, background: "#007aff", color: "#fff" }}>Guardar borrador</button></div>
      </Card> : null}

      {activeTab === "borradores" ? <Card title="Borradores y lotes observados" subtitle="Si ingeniería observa una partida, el lote regresa aquí. Puedes ajustar, reenviar o aceptar avanzar sin esas partidas.">
        <FilterBar search={filters.borradores} setSearch={(v) => setFilter("borradores", v)} status={filters.status} setStatus={(v) => setFilter("status", v)} house={filters.house} setHouse={(v) => setFilter("house", v)} houses={houses} showStatus showHouse />
        {filteredDraftLots.length ? filteredDraftLots.map((lot) => <div key={lot.id} style={{ padding: 14, borderRadius: 18, border: "1px solid rgba(60,60,67,0.12)", background: "#fff", marginBottom: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><div style={{ fontWeight: 950 }}>{lot.nombre || `Estimación ${lot.numero}`}</div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{lot.periodo} · {Object.keys(lot.houses || {}).length} casa(s) · Bruto {money(lot.totals?.subtotal)} · Amortización {money(lot.totals?.amortizacion)} · Neto {money(lot.totals?.neto)}</div></div><span style={statusStyle(lot.status)}>{statusLabel[lot.status] || lot.status}</span></div>{lot.status === "borrador_observado" ? <div style={{ marginTop: 10, padding: 12, borderRadius: 14, background: "#fff3cd", color: "#9a6700", fontSize: 13, fontWeight: 750 }}>Este lote tiene observaciones de ingeniería. Revisa comentarios por concepto, corrige el borrador o acepta continuar sin los conceptos observados.</div> : null}<div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><button type="button" onClick={() => loadLotToCapture(lot)} style={{ ...buttonBase, background: "#fff" }}>Abrir / editar</button>{lot.status === "borrador_observado" ? <button type="button" onClick={() => acceptLotWithoutObserved(lot)} style={{ ...buttonBase, background: "#fff3cd", color: "#9a6700" }}>Aceptar sin partidas observadas</button> : null}<button type="button" onClick={() => copyLotToHouses(lot)} disabled={!copyHouseIds.length} style={{ ...buttonBase, background: copyHouseIds.length ? "#007aff" : "#e5e5ea", color: copyHouseIds.length ? "#fff" : "#8e8e93" }}>Copiar a casas seleccionadas</button><button type="button" onClick={() => sendLotToApproval(lot)} style={{ ...buttonBase, background: "#34c759", color: "#fff" }}>Enviar lote a aprobación</button></div><div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>{houses.filter((house) => !lot.houses?.[house.id]).map((house) => <button key={house.id} type="button" onClick={() => toggleCopyHouse(house.id)} style={{ ...buttonBase, background: copyHouseIds.includes(house.id) ? "#007aff" : "#fff", color: copyHouseIds.includes(house.id) ? "#fff" : "#1d1d1f" }}>{house.name || house.id}</button>)}</div></div>) : <div style={{ color: "#6e6e73" }}>No hay borradores guardados.</div>}
      </Card> : null}

      {activeTab === "aprobacion" ? <Card title="Aprobación ingeniería" subtitle="Si se observa cualquier concepto, el lote completo regresa a borrador observado con comentarios.">
        <FilterBar search={filters.aprobacion} setSearch={(v) => setFilter("aprobacion", v)} house={filters.house} setHouse={(v) => setFilter("house", v)} houses={houses} showHouse />
        {filteredApprovalLots.length ? filteredApprovalLots.map((lot) => <div key={lot.id} style={{ marginBottom: 18 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}><div><div style={{ fontWeight: 950, fontSize: 18 }}>{lot.nombre}</div><div style={{ color: "#6e6e73", fontSize: 12 }}>{Object.keys(lot.houses || {}).length} casa(s) · Neto {money(lot.totals?.neto)}</div></div><span style={statusStyle(lot.status)}>{statusLabel[lot.status]}</span></div>{Object.values(lot.houses || {}).filter((house) => filters.house === "todas" || house.houseId === filters.house).map((house) => { const rowsByPartida = groupByPartida(house.rows || []); const selectedRows = selectedReviewRowIds[house.houseId] || []; return <div key={house.houseId} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, background: "#fff", marginBottom: 12, overflow: "hidden" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 14, background: "rgba(242,242,247,0.8)", flexWrap: "wrap" }}><div><div style={{ fontWeight: 950 }}>{house.houseName}</div><div style={{ color: "#6e6e73", fontSize: 12 }}>Subtotal solicitado: {money(house.totals?.subtotal)} · Estado {house.status}</div></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" onClick={() => selectAllRowsForHouse(house)} style={{ ...buttonBase, background: "#fff" }}>Seleccionar pendientes</button><button type="button" onClick={() => reviewRows(lot, house.houseId, selectedRows, true)} disabled={!selectedRows.length} style={{ ...buttonBase, background: selectedRows.length ? "#34c759" : "#e5e5ea", color: selectedRows.length ? "#fff" : "#8e8e93" }}>Aprobar selección</button><button type="button" onClick={() => reviewRows(lot, house.houseId, selectedRows, false)} disabled={!selectedRows.length} style={{ ...buttonBase, background: selectedRows.length ? "#ff3b30" : "#e5e5ea", color: selectedRows.length ? "#fff" : "#8e8e93" }}>Observar selección</button><button type="button" onClick={() => reviewHouse(lot, house.houseId, true)} style={{ ...buttonBase, background: "#e8f7ed", color: "#157347" }}>Aprobar casa completa</button></div></div>{Object.entries(rowsByPartida).map(([partida, rows]) => <div key={`${house.houseId}-${partida}`} style={{ padding: 12, borderTop: "1px solid rgba(60,60,67,0.10)" }}><div style={{ fontWeight: 950, marginBottom: 8 }}>{partida}</div><div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse" }}><thead><tr><th style={{ ...th, textAlign: "center" }}>Sel.</th><th style={{ ...th, textAlign: "left" }}>Clave</th><th style={{ ...th, textAlign: "left" }}>Concepto</th><th style={{ ...th, textAlign: "right" }}>Previo</th><th style={{ ...th, textAlign: "right" }}>Solicitado</th><th style={{ ...th, textAlign: "right" }}>Importe</th><th style={{ ...th, textAlign: "left" }}>Comentario constructora</th><th style={{ ...th, textAlign: "left" }}>Comentario ingeniería</th><th style={{ ...th, textAlign: "left" }}>Estatus</th></tr></thead><tbody>{rows.map((row) => { const rowId = row.rowId || row.conceptId; const disabled = row.status !== "en_aprobacion"; return <tr key={rowId}><td style={{ ...td, textAlign: "center" }}><input type="checkbox" disabled={disabled} checked={selectedRows.includes(rowId)} onChange={() => toggleReviewRow(house.houseId, rowId)} /></td><td style={{ ...td, fontWeight: 900 }}>{row.clave}</td><td style={{ ...td, minWidth: 300 }}>{row.concepto}</td><td style={{ ...td, textAlign: "right" }}>{Number(row.avancePrevioAprobado || 0).toFixed(1)}%</td><td style={{ ...td, textAlign: "right", fontWeight: 900 }}>{Number(row.avanceSolicitado || 0).toFixed(1)}%</td><td style={{ ...td, textAlign: "right", fontWeight: 950 }}>{money(row.importeSolicitado)}</td><td style={td}>{row.comentarioConstructora || "-"}</td><td style={td}>{row.comentarioSupervision || "-"}</td><td style={td}><span style={statusStyle(row.status || "en_aprobacion")}>{row.status || "en_aprobacion"}</span></td></tr>; })}</tbody></table></div></div>)}</div>; })}</div>) : <div style={{ color: "#6e6e73" }}>No hay lotes enviados a aprobación.</div>}
      </Card> : null}

      {activeTab === "estatus" ? <Card title="Estatus de estimaciones" subtitle="Administración y constructora ven el mismo lote, monto y estado.">
        <FilterBar search={filters.estatus} setSearch={(v) => setFilter("estatus", v)} status={filters.status} setStatus={(v) => setFilter("status", v)} house={filters.house} setHouse={(v) => setFilter("house", v)} houses={houses} showStatus showHouse />
        {filteredAdminLots.length ? filteredAdminLots.map((lot) => <div key={lot.id} style={{ padding: 14, borderRadius: 18, border: "1px solid rgba(60,60,67,0.12)", background: "#fff", marginBottom: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><div style={{ fontWeight: 950 }}>{lot.nombre || `Estimación ${lot.numero} · ${selectedObraId}`}</div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{lot.periodo} · {Object.keys(lot.houses || {}).length} casa(s) · Bruto {money(lot.totals?.subtotal)} · Amortización {money(lot.totals?.amortizacion)} · Neto {money(lot.totals?.neto)}</div></div><span style={statusStyle(lot.status)}>{statusLabel[lot.status] || lot.status}</span></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><button type="button" onClick={() => setAdminStatus(lot, "administracion_revision")} style={{ ...buttonBase, background: "#fff" }}>Revisar administración</button><button type="button" onClick={() => setAdminStatus(lot, "pago_programado")} style={{ ...buttonBase, background: "#eef2ff", color: "#3730a3" }}>Programar pago</button><button type="button" onClick={() => setAdminStatus(lot, "pagada")} style={{ ...buttonBase, background: "#34c759", color: "#fff" }}>Marcar pagada</button></div>{Object.values(lot.houses || {}).filter((house) => filters.house === "todas" || house.houseId === filters.house).map((house) => <details key={house.houseId} style={{ marginTop: 10, borderTop: "1px solid rgba(60,60,67,0.10)", paddingTop: 10 }}><summary style={{ cursor: "pointer", fontWeight: 900 }}>{house.houseName} · {money(house.totals?.neto)}</summary><div style={{ color: "#6e6e73", fontSize: 13, marginTop: 8 }}>{(house.rows || []).filter((row) => row.status !== "observada_supervision").length} conceptos en el lote.</div></details>)}</div>) : <div style={{ color: "#6e6e73" }}>No hay lotes que coincidan con los filtros.</div>}
      </Card> : null}
    </div>
  </div>;
}
