import React, { useEffect, useMemo, useState } from "react";
import { getApps } from "firebase/app";
import { collection, doc, getDocs, getFirestore, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";

const defaultObraId = "arenna";
const inputBase = { width: "100%", minHeight: 42, border: "1px solid rgba(60,60,67,0.16)", borderRadius: 14, padding: "9px 11px", background: "#fff", color: "#1d1d1f", outline: "none", boxSizing: "border-box" };
const buttonBase = { border: "1px solid rgba(60,60,67,0.12)", borderRadius: 999, padding: "10px 14px", fontWeight: 850, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" };
const th = { padding: "10px", fontSize: 11, fontWeight: 950, color: "#6e6e73", textTransform: "uppercase", letterSpacing: 0.35, background: "rgba(242,242,247,0.96)", borderBottom: "1px solid rgba(60,60,67,0.10)", position: "sticky", top: 0, zIndex: 2 };
const td = { padding: "10px", borderBottom: "1px solid rgba(60,60,67,0.10)", verticalAlign: "top", fontSize: 13, color: "#1d1d1f" };

const statusLabel = {
  borrador: "Borrador",
  borrador_observado: "Borrador observado",
  en_aprobacion: "En revisión ingeniería",
  lista_administracion: "Lista para administración",
  administracion_revision: "En revisión administración",
  pago_programado: "Pago programado",
  pagada: "Pagada",
};
const draftStatuses = ["borrador", "borrador_observado"];
const adminStatuses = ["lista_administracion", "administracion_revision", "pago_programado", "pagada"];
const approvedLotStatuses = adminStatuses;
const statusOptions = Object.entries(statusLabel);

function getDb() {
  const app = getApps()[0];
  return app ? getFirestore(app) : null;
}
function money(value) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value || 0));
}
function parseNumber(value) {
  const parsed = Number(String(value ?? "").replace(/\$/g, "").replace(/,/g, "").replace(/\s/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}
function clampPercent(value) {
  return Math.min(100, Math.max(0, parseNumber(value)));
}
function slugify(text = "") {
  return String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
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
    fechaEntrega: item.fechaEntrega || item.fecha_entrega || item["Fecha Entrega"] || item["Fecha compromiso"] || "",
    rowNumber,
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
function statusStyle(status) {
  const colors = {
    borrador: ["#eef2f7", "#475467"],
    borrador_observado: ["#fff3cd", "#9a6700"],
    en_aprobacion: ["#eef2ff", "#3730a3"],
    lista_administracion: ["#e8f7ed", "#157347"],
    administracion_revision: ["#eef2ff", "#3730a3"],
    pago_programado: ["#e8f7ed", "#157347"],
    pagada: ["#e8f7ed", "#157347"],
  };
  const [bg, color] = colors[status] || colors.borrador;
  return { display: "inline-flex", borderRadius: 999, padding: "6px 10px", background: bg, color, fontSize: 12, fontWeight: 900 };
}
function todayDelay(fechaEntrega) {
  if (!fechaEntrega) return 0;
  const today = new Date();
  const entrega = new Date(fechaEntrega);
  return today > entrega ? Math.ceil((today - entrega) / (1000 * 60 * 60 * 24)) : 0;
}
function appendHistory(lot, action, detail, by = "Sistema") {
  const entry = { at: new Date().toISOString(), by, action, detail };
  return [...(lot?.history || []), entry];
}
function Field({ label, children }) {
  return <label style={{ display: "block", marginBottom: 12 }}><div style={{ fontSize: 13, fontWeight: 850, color: "#1d1d1f", marginBottom: 6 }}>{label}</div>{children}</label>;
}
function Card({ title, subtitle, children, style }) {
  return <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 22, padding: 16, background: "rgba(255,255,255,0.92)", boxShadow: "0 8px 28px rgba(0,0,0,0.055)", marginBottom: 16, ...style }}>{title ? <div style={{ fontSize: 18, fontWeight: 950, color: "#1d1d1f" }}>{title}</div> : null}{subtitle ? <div style={{ marginTop: 4, color: "#6e6e73", fontSize: 13, lineHeight: 1.45 }}>{subtitle}</div> : null}{children ? <div style={{ marginTop: title || subtitle ? 14 : 0 }}>{children}</div> : null}</div>;
}
function Metric({ label, value, helper }) {
  return <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 20, padding: 15, background: "#fff" }}><div style={{ color: "#6e6e73", fontSize: 12, fontWeight: 800 }}>{label}</div><div style={{ color: "#1d1d1f", fontSize: 23, fontWeight: 950, marginTop: 4 }}>{value}</div>{helper ? <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{helper}</div> : null}</div>;
}
function FilterBar({ search, setSearch, status, setStatus, house, setHouse, houses, partida, setPartida, partidas, showStatus = false, showHouse = false, showPartida = false }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por lote, casa, partida, clave, concepto o comentario" style={inputBase} />
    {showStatus ? <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputBase}><option value="todos">Todos los estatus</option>{statusOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select> : null}
    {showHouse ? <select value={house} onChange={(e) => setHouse(e.target.value)} style={inputBase}><option value="todas">Todas las casas</option>{houses.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select> : null}
    {showPartida ? <select value={partida} onChange={(e) => setPartida(e.target.value)} style={inputBase}><option value="todas">Todas las partidas</option>{partidas.map((item) => <option key={item} value={item}>{item}</option>)}</select> : null}
  </div>;
}

export default function EstimacionesWidget() {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState("constructora");
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

  const contractTotal = useMemo(() => catalog.reduce((acc, item) => acc + Number(item.importe || 0), 0) * Math.max(houses.length || 1, 1), [catalog, houses.length]);
  const approvedTotal = useMemo(() => houses.reduce((houseAcc, house) => houseAcc + catalog.reduce((acc, concept) => acc + approvedAmountFor(concept, house.id), 0), 0), [houses, catalog, approvedProgress]);

  function allowedTabs() {
    if (profile === "constructora") return ["captura", "borradores"];
    if (profile === "supervision") return ["aprobacion", "borradores"];
    return ["estatus", "borradores"];
  }
  function tabLabel(tab) {
    return { captura: "Captura", borradores: "Borradores y seguimiento", aprobacion: "Aprobación ingeniería", estatus: "Administración" }[tab] || tab;
  }
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
    const baseRows = onlyApproved ? rows.filter((row) => row.status === "aprobada_supervision") : rows.filter((row) => row.status !== "observada_supervision" && row.status !== "quitada_constructora");
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
  function rowSearchText(row, house, lot) {
    return `${lot?.nombre || ""} ${statusLabel[lot?.status] || lot?.status || ""} ${house?.houseName || ""} ${row.partida || ""} ${row.clave || ""} ${row.concepto || ""} ${row.comentarioConstructora || ""} ${row.comentarioSupervision || ""} ${row.respuestaConstructora || ""}`.toLowerCase();
  }
  function lotMatches(lot, search = "", status = "todos", houseFilter = "todas") {
    if (status !== "todos" && lot.status !== status) return false;
    if (houseFilter !== "todas" && !lot.houses?.[houseFilter]) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    if (`${lot.nombre || ""} ${lot.numero || ""} ${statusLabel[lot.status] || lot.status || ""}`.toLowerCase().includes(q)) return true;
    return Object.values(lot.houses || {}).some((house) => (house.rows || []).some((row) => rowSearchText(row, house, lot).includes(q)));
  }
  const draftSummary = useMemo(() => {
    const rows = catalog.map((concept) => draftPercent(concept) > 0 ? { multa: todayDelay(concept.fechaEntrega) * multaDiaria } : null).filter(Boolean);
    const subtotal = catalog.reduce((acc, concept) => acc + plannedAmount(concept), 0);
    return { subtotal, ...computeDeductions(subtotal, rows), count: Object.values(draftRows).filter((row) => parseNumber(row.percent) > 0).length };
  }, [catalog, draftRows, selectedHouseId, approvedProgress, anticipoPorcentaje, retencionPorcentaje, multaDiaria]);

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
  useEffect(() => { const tabs = allowedTabs(); if (!tabs.includes(activeTab)) setActiveTab(tabs[0]); }, [profile]);

  async function loadData() {
    const db = getDb();
    if (!db) return;
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
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
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
      return { rowId: `${concept.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, conceptId: concept.id, clave: concept.clave, partida: concept.partida, concepto: concept.concepto, unidad: concept.unidad, cantidad: Number(concept.cantidad || 0), precioUnitario: Number(concept.precioUnitario || 0), importeConcepto: Number(concept.importe || 0), avancePrevioAprobado: previo, avanceDisponibleAntes: Math.max(0, 100 - previo), avanceSolicitado: percent, avanceAprobado: 0, importeSolicitado: Number(concept.importe || 0) * (percent / 100), importeAprobado: 0, comentarioConstructora: draftRows[concept.id]?.comment || "", respuestaConstructora: "", fechaEntrega: concept.fechaEntrega || "", diasAtraso: todayDelay(concept.fechaEntrega), multa, status: "borrador" };
    }).filter(Boolean);
  }
  async function saveDraftLot() {
    const db = getDb();
    if (!db) return;
    if (!selectedHouse) { alert("Selecciona una casa base."); return; }
    const rows = buildRowsFromDraft();
    if (!rows.length) { alert("Captura al menos un porcentaje de avance."); return; }
    const numero = Number(lotForm.numero || nextNumber);
    const id = `estimacion-${numero}-${Date.now()}`;
    const nombre = lotForm.nombre || autoLotName(numero, lotForm.periodo);
    const houseData = housePayload(selectedHouse, rows, "borrador");
    const housesObject = { [selectedHouse.id]: houseData };
    const lot = { id, obraId: selectedObraId, obraName: selectedObra.name || selectedObraId, numero, nombre, periodo: lotForm.periodo, status: "borrador", estimationConfig: { anticipoPorcentaje, retencionPorcentaje, multaDiaria }, houses: housesObject, totals: lotTotals(housesObject), history: [{ at: new Date().toISOString(), by: "Constructora", action: "Borrador creado", detail: `${nombre} creado con ${rows.length} conceptos.` }], createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", id), lot, { merge: true });
    setSelectedLotId(id);
    alert("Borrador guardado. Ahora se trabaja desde Borradores y seguimiento.");
    setDraftRows({});
    localStorage.removeItem(draftStorageKey);
    await loadData();
    setActiveTab("borradores");
  }
  async function saveLotPatch(lot, housesObject, status, action, detail) {
    const db = getDb();
    if (!db || !lot) return;
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", lot.id), { houses: housesObject, status, totals: lotTotals(housesObject), history: appendHistory(lot, action, detail, profile === "supervision" ? "Ingeniería" : profile === "admin" ? "Administración" : "Constructora"), updatedAt: serverTimestamp() }, { merge: true });
    await loadData();
  }
  async function updateLotRow(lot, houseId, rowId, patch) {
    if (!lot || !draftStatuses.includes(lot.status)) return;
    const housesObject = { ...(lot.houses || {}) };
    const house = housesObject[houseId];
    const rows = (house.rows || []).map((row) => {
      const id = row.rowId || row.conceptId;
      if (id !== rowId) return row;
      const concept = catalog.find((item) => item.id === row.conceptId) || row;
      const max = Number(row.avanceDisponibleAntes || 100);
      const nextPercent = patch.avanceSolicitado !== undefined ? Math.min(max, clampPercent(patch.avanceSolicitado)) : Number(row.avanceSolicitado || 0);
      return { ...row, ...patch, avanceSolicitado: nextPercent, importeSolicitado: Number(concept.importeConcepto || concept.importe || row.importeConcepto || 0) * (nextPercent / 100), status: row.status === "observada_supervision" ? "borrador" : row.status };
    });
    housesObject[houseId] = { ...house, rows, status: "borrador", totals: computeRowsTotals(rows, false) };
    await saveLotPatch(lot, housesObject, "borrador", "Borrador editado", `Se editó ${house.houseName || houseId}.`);
  }
  async function removeObservedRows(lot) {
    const housesObject = {};
    Object.entries(lot.houses || {}).forEach(([houseId, house]) => {
      const rows = (house.rows || []).map((row) => row.status === "observada_supervision" ? { ...row, status: "quitada_constructora", avanceSolicitado: 0, importeSolicitado: 0, respuestaConstructora: row.respuestaConstructora || "Se acepta avanzar sin esta partida/concepto observado." } : row);
      housesObject[houseId] = { ...house, rows, status: "borrador", totals: computeRowsTotals(rows, false) };
    });
    await saveLotPatch(lot, housesObject, "borrador", "Observaciones aceptadas sin estimar", "La constructora decidió avanzar sin partidas/conceptos observados.");
  }
  async function copyLotToHouses(lot, targetIds = copyHouseIds) {
    if (!lot || !targetIds.length) { alert("Selecciona casas destino."); return; }
    const sourceHouse = Object.values(lot.houses || {})[0];
    if (!sourceHouse) return;
    const housesObject = { ...(lot.houses || {}) };
    targetIds.forEach((houseId) => {
      const house = houses.find((item) => item.id === houseId);
      if (!house) return;
      const copiedRows = (sourceHouse.rows || []).filter((row) => !["observada_supervision", "quitada_constructora"].includes(row.status)).map((row) => ({ ...row, rowId: `${row.conceptId}-${houseId}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, status: "borrador", avanceAprobado: 0, importeAprobado: 0, comentarioSupervision: "", respuestaConstructora: "" }));
      housesObject[houseId] = housePayload(house, copiedRows, "borrador");
    });
    await saveLotPatch(lot, housesObject, "borrador", "Lote copiado a casas", `Se copió a ${targetIds.length} casa(s).`);
    setCopyHouseIds([]);
  }
  async function sendLotToApproval(lot) {
    if (!lot) return;
    const housesObject = {};
    Object.entries(lot.houses || {}).forEach(([houseId, house]) => {
      const rows = (house.rows || []).filter((row) => !["observada_supervision", "quitada_constructora"].includes(row.status)).map((row) => ({ ...row, status: "en_aprobacion" }));
      housesObject[houseId] = { ...house, rows, status: "en_aprobacion", totals: computeRowsTotals(rows, false) };
    });
    await saveLotPatch(lot, housesObject, "en_aprobacion", "Enviado a aprobación", "El lote fue enviado a revisión de ingeniería.");
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
    const hasObservedInHouse = rows.some((row) => row.status === "observada_supervision");
    housesObject[houseId] = { ...house, rows, status: hasObservedInHouse ? "borrador_observado" : "en_aprobacion", comentarioSupervision: comment, reviewedAt: new Date().toISOString(), totals: computeRowsTotals(rows, false) };
    const allRows = Object.values(housesObject).flatMap((item) => item.rows || []);
    const nextStatus = allRows.some((row) => row.status === "observada_supervision") ? "borrador_observado" : allRows.every((row) => row.status === "aprobada_supervision") ? "lista_administracion" : "en_aprobacion";
    await saveLotPatch(lot, housesObject, nextStatus, approved ? "Conceptos aprobados" : "Lote observado", approved ? `${rowIds.length} concepto(s) aprobado(s).` : comment);
    setSelectedReviewRowIds((prev) => ({ ...prev, [houseId]: [] }));
  }
  async function setAdminStatus(lot, status) {
    const db = getDb();
    if (!db || !lot) return;
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", lot.id), { status, history: appendHistory(lot, statusLabel[status] || status, "Actualización de administración.", "Administración"), adminUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    await loadData();
  }

  function renderSummaryMetrics(summary, title = "Resumen") {
    return <Card title={title} subtitle={`Anticipo ${anticipoPorcentaje}% · Retención ${retencionPorcentaje}% · Multa diaria ${money(multaDiaria)}`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <Metric label="Bruto" value={money(summary.subtotal)} />
        <Metric label="Amortización anticipo" value={`-${money(summary.amortizacion)}`} helper="Se descuenta proporcional al % de anticipo." />
        <Metric label="Retención" value={`-${money(summary.retencion)}`} />
        <Metric label="Multas" value={`-${money(summary.multas)}`} />
        <Metric label="Neto" value={money(summary.neto)} />
      </div>
    </Card>;
  }
  function renderCapture() {
    const q = filters.captura.trim().toLowerCase();
    const partidaFilter = filters.partida;
    return <>
      <Card title="Captura de borrador" subtitle="Esta pantalla solo sirve para generar un borrador inicial. Después el lote se trabaja desde Borradores y seguimiento.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <Field label="Obra"><select value={selectedObraId} onChange={(e) => setSelectedObraId(e.target.value)} style={inputBase}>{obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.name || obra.id}</option>)}</select></Field>
          <Field label="Casa base"><select value={selectedHouseId} onChange={(e) => setSelectedHouseId(e.target.value)} style={inputBase}>{houses.map((house) => <option key={house.id} value={house.id}>{house.name || house.id}</option>)}</select></Field>
          <Field label="Periodo"><input type="month" value={lotForm.periodo} onChange={(e) => setLotForm((prev) => ({ ...prev, periodo: e.target.value, nombre: prev.nombre || autoLotName(prev.numero || nextNumber, e.target.value) }))} style={inputBase} /></Field>
          <Field label="Número"><input value={lotForm.numero || nextNumber} onChange={(e) => setLotForm((prev) => ({ ...prev, numero: e.target.value }))} style={inputBase} /></Field>
        </div>
        <Field label="Nombre del borrador"><input value={lotForm.nombre || autoLotName(lotForm.numero || nextNumber, lotForm.periodo)} onChange={(e) => setLotForm((prev) => ({ ...prev, nombre: e.target.value }))} style={inputBase} /></Field>
        <button type="button" onClick={saveDraftLot} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Guardar borrador</button>
      </Card>
      {renderSummaryMetrics(draftSummary, "Total del borrador en captura")}
      <Card title="Catálogo por partidas" subtitle="Captura el porcentaje a estimar. El disponible descuenta lo ya aprobado en estimaciones anteriores.">
        <FilterBar search={filters.captura} setSearch={(value) => setFilters((prev) => ({ ...prev, captura: value }))} partida={filters.partida} setPartida={(value) => setFilters((prev) => ({ ...prev, partida: value }))} partidas={partidas} showPartida />
        {partidas.map((partida) => {
          if (partidaFilter !== "todas" && partida !== partidaFilter) return null;
          const concepts = (catalogByPartida[partida] || []).filter((concept) => !q || `${concept.partida} ${concept.clave} ${concept.concepto} ${concept.unidad}`.toLowerCase().includes(q));
          if (!concepts.length) return null;
          const collapsed = collapsedPartidas[partida];
          const partidaSubtotal = concepts.reduce((acc, concept) => acc + plannedAmount(concept), 0);
          return <div key={partida} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, overflow: "hidden", marginBottom: 12, background: "#fff" }}>
            <button type="button" onClick={() => setCollapsedPartidas((prev) => ({ ...prev, [partida]: !prev[partida] }))} style={{ width: "100%", border: 0, background: "#fff", padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}><strong>{collapsed ? "▸" : "▾"} {partida}</strong><span>{money(partidaSubtotal)}</span></button>
            {!collapsed ? <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}><thead><tr><th style={th}>Clave</th><th style={th}>Concepto</th><th style={th}>Unidad</th><th style={th}>Unidades</th><th style={th}>P.U.</th><th style={th}>Total</th><th style={th}>Aprobado</th><th style={th}>Disponible</th><th style={th}>% estimar</th><th style={th}>A estimar</th><th style={th}>Comentario</th></tr></thead><tbody>{concepts.map((concept) => {
              const approved = approvedFor(selectedHouseId, concept.id);
              const available = availableFor(concept);
              return <tr key={concept.id}><td style={td}>{concept.clave}</td><td style={{ ...td, minWidth: 280 }}>{concept.concepto}</td><td style={td}>{concept.unidad}</td><td style={td}>{concept.cantidad}</td><td style={td}>{money(concept.precioUnitario)}</td><td style={td}>{money(concept.importe)}</td><td style={td}>{approved}%</td><td style={td}>{available}%</td><td style={td}><input type="number" min="0" max={available} value={draftRows[concept.id]?.percent || ""} onChange={(e) => updateDraft(concept.id, { percent: e.target.value })} style={{ ...inputBase, width: 95 }} /></td><td style={td}><strong>{money(plannedAmount(concept))}</strong></td><td style={td}><input value={draftRows[concept.id]?.comment || ""} onChange={(e) => updateDraft(concept.id, { comment: e.target.value })} style={{ ...inputBase, minWidth: 190 }} /></td></tr>;
            })}</tbody></table></div> : null}
          </div>;
        })}
      </Card>
    </>;
  }
  function renderLotList(lotPool) {
    const filtered = lotPool.filter((lot) => lotMatches(lot, filters.borradores, filters.status, filters.house));
    return <Card title="Lista de lotes" subtitle="Aquí se trabaja la estimación: edición, respuestas a observaciones, copia a casas y seguimiento.">
      <FilterBar search={filters.borradores} setSearch={(value) => setFilters((prev) => ({ ...prev, borradores: value }))} status={filters.status} setStatus={(value) => setFilters((prev) => ({ ...prev, status: value }))} house={filters.house} setHouse={(value) => setFilters((prev) => ({ ...prev, house: value }))} houses={houses} showStatus showHouse />
      <div style={{ display: "grid", gap: 10 }}>{filtered.map((lot) => <button key={lot.id} type="button" onClick={() => setSelectedLotId(lot.id)} style={{ border: selectedLotId === lot.id ? "2px solid #111827" : "1px solid rgba(60,60,67,0.12)", borderRadius: 18, padding: 14, background: "#fff", textAlign: "left", cursor: "pointer" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><strong>{lot.nombre}</strong><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>Estimación {lot.numero} · {lot.obraName || selectedObraId} · {lot.periodo} · {Object.keys(lot.houses || {}).length} casa(s)</div></div><div style={{ textAlign: "right" }}><span style={statusStyle(lot.status)}>{statusLabel[lot.status] || lot.status}</span><div style={{ fontWeight: 950, marginTop: 6 }}>{money(lot.totals?.neto)}</div></div></div></button>)}</div>
    </Card>;
  }
  function renderLotEditor(lot) {
    if (!lot) return <Card title="Selecciona un lote" subtitle="Abre un borrador o lote enviado para revisar su detalle." />;
    const editable = draftStatuses.includes(lot.status) && profile === "constructora";
    const observedCount = Object.values(lot.houses || {}).flatMap((house) => house.rows || []).filter((row) => row.status === "observada_supervision").length;
    return <>
      <Card title={lot.nombre} subtitle={`Estimación ${lot.numero} · ${statusLabel[lot.status] || lot.status}`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <Metric label="Bruto" value={money(lot.totals?.subtotal)} />
          <Metric label="Amortización" value={`-${money(lot.totals?.amortizacion)}`} />
          <Metric label="Retención" value={`-${money(lot.totals?.retencion)}`} />
          <Metric label="Multas" value={`-${money(lot.totals?.multas)}`} />
          <Metric label="Neto lote" value={money(lot.totals?.neto)} />
        </div>
        {editable ? <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <button type="button" onClick={() => sendLotToApproval(lot)} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Enviar a aprobación</button>
          {observedCount ? <button type="button" onClick={() => removeObservedRows(lot)} style={{ ...buttonBase, background: "#fff3cd", color: "#9a6700" }}>Aceptar sin partidas observadas</button> : null}
        </div> : null}
        {editable ? <div style={{ marginTop: 14, padding: 12, borderRadius: 16, background: "#f5f5f7" }}><strong>Copiar lote a otras casas</strong><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>{houses.filter((house) => !lot.houses?.[house.id]).map((house) => <label key={house.id} style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "8px 10px", background: "#fff", borderRadius: 999, border: "1px solid rgba(60,60,67,0.12)" }}><input type="checkbox" checked={copyHouseIds.includes(house.id)} onChange={(e) => setCopyHouseIds((prev) => e.target.checked ? [...prev, house.id] : prev.filter((id) => id !== house.id))} />{house.name || house.id}</label>)}</div><button type="button" onClick={() => copyLotToHouses(lot)} style={{ ...buttonBase, marginTop: 10, background: "#fff", color: "#1d1d1f" }}>Guardar copia en casas seleccionadas</button></div> : null}
      </Card>
      {Object.entries(lot.houses || {}).map(([houseId, house]) => <Card key={houseId} title={house.houseName || houseId} subtitle={`Estatus casa: ${statusLabel[house.status] || house.status || lot.status}`}>
        {Object.entries(groupByPartida(house.rows || [])).map(([partida, rows]) => <div key={partida} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, overflow: "hidden", marginBottom: 12, background: "#fff" }}><div style={{ padding: 12, fontWeight: 950, background: "#f5f5f7" }}>{partida}</div><div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1200 }}><thead><tr><th style={th}>Clave</th><th style={th}>Concepto</th><th style={th}>% solicitado</th><th style={th}>Importe</th><th style={th}>Estatus</th><th style={th}>Comentario constructora</th><th style={th}>Observación ingeniería</th><th style={th}>Respuesta / ajuste</th></tr></thead><tbody>{rows.map((row) => {
          const rowId = row.rowId || row.conceptId;
          return <tr key={rowId}><td style={td}>{row.clave}</td><td style={{ ...td, minWidth: 280 }}>{row.concepto}</td><td style={td}>{editable ? <input type="number" value={row.avanceSolicitado || ""} onBlur={(e) => updateLotRow(lot, houseId, rowId, { avanceSolicitado: e.target.value })} onChange={() => {}} style={{ ...inputBase, width: 95 }} /> : `${row.avanceSolicitado}%`}</td><td style={td}>{money(row.importeSolicitado)}</td><td style={td}><span style={statusStyle(row.status)}>{row.status === "observada_supervision" ? "Observada" : row.status === "quitada_constructora" ? "Quitada" : row.status === "aprobada_supervision" ? "Aprobada" : statusLabel[row.status] || row.status}</span></td><td style={td}>{editable ? <input defaultValue={row.comentarioConstructora || ""} onBlur={(e) => updateLotRow(lot, houseId, rowId, { comentarioConstructora: e.target.value })} style={{ ...inputBase, minWidth: 180 }} /> : row.comentarioConstructora}</td><td style={td}>{row.comentarioSupervision || "—"}</td><td style={td}>{editable ? <input defaultValue={row.respuestaConstructora || ""} placeholder="Respuesta o comentario de corrección" onBlur={(e) => updateLotRow(lot, houseId, rowId, { respuestaConstructora: e.target.value })} style={{ ...inputBase, minWidth: 220 }} /> : row.respuestaConstructora || "—"}</td></tr>;
        })}</tbody></table></div></div>)}
      </Card>)}
      <Card title="Historial del lote" subtitle="Bitácora automática de movimientos.">
        <div style={{ display: "grid", gap: 8 }}>{(lot.history || []).slice().reverse().map((item, index) => <div key={`${item.at}-${index}`} style={{ padding: 12, borderRadius: 14, background: "#fff", border: "1px solid rgba(60,60,67,0.10)" }}><strong>{item.action}</strong><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 3 }}>{item.by} · {item.at ? new Date(item.at).toLocaleString("es-MX") : ""}</div><div style={{ marginTop: 5 }}>{item.detail}</div></div>)}</div>
      </Card>
    </>;
  }
  function renderBorradores() {
    const lotPool = lots.filter((lot) => profile === "constructora" ? true : true);
    return <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 0.85fr) minmax(0, 1.35fr)", gap: 16 }} className="triton-estimaciones-two-col">{renderLotList(lotPool)}<div>{renderLotEditor(selectedLot)}</div></div>;
  }
  function renderAprobacion() {
    const approvalLots = lots.filter((lot) => lot.status === "en_aprobacion").filter((lot) => lotMatches(lot, filters.aprobacion, "todos", filters.house));
    const lot = selectedLot && selectedLot.status === "en_aprobacion" ? selectedLot : approvalLots[0];
    return <>
      <Card title="Aprobación ingeniería" subtitle="Revisa por casa y por concepto. Si observas algo, el lote completo regresa a borrador observado con seguimiento.">
        <FilterBar search={filters.aprobacion} setSearch={(value) => setFilters((prev) => ({ ...prev, aprobacion: value }))} house={filters.house} setHouse={(value) => setFilters((prev) => ({ ...prev, house: value }))} houses={houses} showHouse />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{approvalLots.map((item) => <button key={item.id} onClick={() => setSelectedLotId(item.id)} style={{ ...buttonBase, background: item.id === lot?.id ? "#111827" : "#fff", color: item.id === lot?.id ? "#fff" : "#1d1d1f" }}>{item.nombre}</button>)}</div>
      </Card>
      {lot ? Object.entries(lot.houses || {}).map(([houseId, house]) => <Card key={houseId} title={house.houseName || houseId} subtitle="Selecciona conceptos para aprobar u observar.">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}><button type="button" onClick={() => reviewRows(lot, houseId, selectedReviewRowIds[houseId] || [], true)} style={{ ...buttonBase, background: "#e8f7ed", color: "#157347" }}>Aprobar selección</button><button type="button" onClick={() => reviewRows(lot, houseId, selectedReviewRowIds[houseId] || [], false)} style={{ ...buttonBase, background: "#fff3cd", color: "#9a6700" }}>Observar selección</button><button type="button" onClick={() => reviewRows(lot, houseId, (house.rows || []).filter((row) => row.status === "en_aprobacion").map((row) => row.rowId || row.conceptId), true)} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Aprobar casa completa</button></div>
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}><thead><tr><th style={th}>Sel.</th><th style={th}>Partida</th><th style={th}>Clave</th><th style={th}>Concepto</th><th style={th}>Casa</th><th style={th}>%</th><th style={th}>Importe</th><th style={th}>Comentario</th></tr></thead><tbody>{(house.rows || []).map((row) => { const id = row.rowId || row.conceptId; const selected = (selectedReviewRowIds[houseId] || []).includes(id); return <tr key={id}><td style={td}><input type="checkbox" checked={selected} disabled={row.status !== "en_aprobacion"} onChange={(e) => setSelectedReviewRowIds((prev) => ({ ...prev, [houseId]: e.target.checked ? [...(prev[houseId] || []), id] : (prev[houseId] || []).filter((item) => item !== id) }))} /></td><td style={td}>{row.partida}</td><td style={td}>{row.clave}</td><td style={{ ...td, minWidth: 300 }}>{row.concepto}</td><td style={td}>{house.houseName}</td><td style={td}>{row.avanceSolicitado}%</td><td style={td}>{money(row.importeSolicitado)}</td><td style={td}>{row.comentarioConstructora || "—"}</td></tr>; })}</tbody></table></div>
      </Card>) : <Card title="Sin lotes en revisión" subtitle="No hay estimaciones enviadas a aprobación." />}
    </>;
  }
  function renderAdmin() {
    const filtered = lots.filter((lot) => adminStatuses.includes(lot.status)).filter((lot) => lotMatches(lot, filters.estatus, filters.status, filters.house));
    return <Card title="Estatus administración" subtitle="Vista de lotes aprobados que viajan a revisión y pago.">
      <FilterBar search={filters.estatus} setSearch={(value) => setFilters((prev) => ({ ...prev, estatus: value }))} status={filters.status} setStatus={(value) => setFilters((prev) => ({ ...prev, status: value }))} house={filters.house} setHouse={(value) => setFilters((prev) => ({ ...prev, house: value }))} houses={houses} showStatus showHouse />
      <div style={{ display: "grid", gap: 12 }}>{filtered.map((lot) => <div key={lot.id} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, padding: 14, background: "#fff" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><strong>{lot.nombre}</strong><div style={{ color: "#6e6e73", fontSize: 12 }}>Estimación {lot.numero} · {lot.periodo} · {Object.keys(lot.houses || {}).length} casa(s)</div></div><div style={{ textAlign: "right" }}><span style={statusStyle(lot.status)}>{statusLabel[lot.status]}</span><div style={{ fontWeight: 950, marginTop: 6 }}>{money(lot.totals?.neto)}</div></div></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><button onClick={() => setAdminStatus(lot, "administracion_revision")} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>En revisión administración</button><button onClick={() => setAdminStatus(lot, "pago_programado")} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>Pago programado</button><button onClick={() => setAdminStatus(lot, "pagada")} style={{ ...buttonBase, background: "#e8f7ed", color: "#157347" }}>Pagada</button><button onClick={() => setSelectedLotId(lot.id)} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Ver detalle en seguimiento</button></div></div>)}</div>
    </Card>;
  }

  if (!open) return null;
  const tabs = allowedTabs();
  return <div className="triton-estimaciones-module" style={{ position: "fixed", left: "var(--triton-shell-offset, 84px)", top: 0, right: 0, bottom: 0, zIndex: 2147483645, background: "#f5f5f7", overflow: "auto" }}>
    <style>{`@media (max-width: 900px) { .triton-estimaciones-module { left: 0 !important; z-index: 2147483647 !important; } .triton-estimaciones-two-col { grid-template-columns: 1fr !important; } }`}</style>
    <div style={{ maxWidth: 1480, margin: "0 auto", padding: "calc(24px + env(safe-area-inset-top, 0px)) 18px 42px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap" }}><div><div style={{ fontSize: 34, fontWeight: 950, color: "#1d1d1f", letterSpacing: -0.7 }}>Estimaciones</div><div style={{ color: "#6e6e73", fontSize: 16, marginTop: 6 }}>Captura, borradores, seguimiento, aprobación y pago por lote formal.</div></div><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><select value={profile} onChange={(e) => setProfile(e.target.value)} style={{ ...inputBase, width: 220 }}><option value="constructora">Perfil constructora</option><option value="supervision">Perfil supervisión</option><option value="admin">Perfil administración</option></select><button type="button" onClick={() => setOpen(false)} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>Volver</button></div></div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>{tabs.map((tab) => <button key={tab} type="button" onClick={() => setActiveTab(tab)} style={{ ...buttonBase, background: activeTab === tab ? "#111827" : "#fff", color: activeTab === tab ? "#fff" : "#1d1d1f" }}>{tabLabel(tab)}</button>)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}><Metric label="Obra" value={selectedObra.name || selectedObraId} helper={loading ? "Cargando..." : `${catalog.length} conceptos`} /><Metric label="Contrato base" value={money(contractTotal)} helper="Catálogo × unidades" /><Metric label="Aprobado acumulado" value={money(approvedTotal)} /><Metric label="Anticipo" value={`${anticipoPorcentaje}%`} helper="Configurado en Obras" /></div>
      {activeTab === "captura" ? renderCapture() : null}
      {activeTab === "borradores" ? renderBorradores() : null}
      {activeTab === "aprobacion" ? renderAprobacion() : null}
      {activeTab === "estatus" ? renderAdmin() : null}
    </div>
  </div>;
}
