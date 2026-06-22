import React, { useEffect, useMemo, useState } from "react";
import { getApps } from "firebase/app";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

const defaultObraId = "arenna";

const inputBase = {
  width: "100%",
  minHeight: 42,
  border: "1px solid rgba(60,60,67,0.16)",
  borderRadius: 14,
  padding: "9px 11px",
  background: "#fff",
  color: "#1d1d1f",
  outline: "none",
  boxSizing: "border-box",
};

const buttonBase = {
  border: "1px solid rgba(60,60,67,0.12)",
  borderRadius: 999,
  padding: "10px 14px",
  fontWeight: 850,
  fontSize: 13,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const th = {
  padding: "10px",
  fontSize: 11,
  fontWeight: 950,
  color: "#6e6e73",
  textTransform: "uppercase",
  letterSpacing: 0.35,
  background: "rgba(242,242,247,0.96)",
  borderBottom: "1px solid rgba(60,60,67,0.10)",
  position: "sticky",
  top: 0,
  zIndex: 2,
};

const td = {
  padding: "10px",
  borderBottom: "1px solid rgba(60,60,67,0.10)",
  verticalAlign: "top",
  fontSize: 13,
  color: "#1d1d1f",
};

const statusLabel = {
  borrador: "Borrador",
  borrador_observado: "Borrador observado",
  en_aprobacion: "En revisión ingeniería",
  lista_administracion: "Lista para administración",
  administracion_revision: "En revisión administración",
  pago_programado: "Pago programado",
  pagada: "Pagada",
};

const rowStatusLabel = {
  borrador: "Borrador",
  en_aprobacion: "En revisión",
  aprobada_supervision: "Aprobada",
  observada_supervision: "Observada",
  quitada_constructora: "Quitada",
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
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shortId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function timeStamp(date = new Date()) {
  return date.toTimeString().slice(0, 8).replace(/:/g, "");
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
    aprobada_supervision: ["#e8f7ed", "#157347"],
    observada_supervision: ["#fff3cd", "#9a6700"],
    quitada_constructora: ["#f4f4f5", "#71717a"],
  };
  const [bg, color] = colors[status] || colors.borrador;
  return {
    display: "inline-flex",
    borderRadius: 999,
    padding: "6px 10px",
    background: bg,
    color,
    fontSize: 12,
    fontWeight: 900,
  };
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
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 850, color: "#1d1d1f", marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}

function Card({ title, subtitle, children, style }) {
  return (
    <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 22, padding: 16, background: "rgba(255,255,255,0.92)", boxShadow: "0 8px 28px rgba(0,0,0,0.055)", marginBottom: 16, ...style }}>
      {title ? <div style={{ fontSize: 18, fontWeight: 950, color: "#1d1d1f" }}>{title}</div> : null}
      {subtitle ? <div style={{ marginTop: 4, color: "#6e6e73", fontSize: 13, lineHeight: 1.45 }}>{subtitle}</div> : null}
      {children ? <div style={{ marginTop: title || subtitle ? 14 : 0 }}>{children}</div> : null}
    </div>
  );
}

function Metric({ label, value, helper }) {
  return (
    <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 20, padding: 15, background: "#fff" }}>
      <div style={{ color: "#6e6e73", fontSize: 12, fontWeight: 800 }}>{label}</div>
      <div style={{ color: "#1d1d1f", fontSize: 23, fontWeight: 950, marginTop: 4 }}>{value}</div>
      {helper ? <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{helper}</div> : null}
    </div>
  );
}

function FilterBar({ search, setSearch, status, setStatus, house, setHouse, houses, partida, setPartida, partidas, showStatus = false, showHouse = false, showPartida = false }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por lote, casa, partida, clave, concepto o comentario" style={inputBase} />
      {showStatus ? (
        <select value={status} onChange={(event) => setStatus(event.target.value)} style={inputBase}>
          <option value="todos">Todos los estatus</option>
          {statusOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      ) : null}
      {showHouse ? (
        <select value={house} onChange={(event) => setHouse(event.target.value)} style={inputBase}>
          <option value="todas">Todas las casas</option>
          {houses.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
        </select>
      ) : null}
      {showPartida ? (
        <select value={partida} onChange={(event) => setPartida(event.target.value)} style={inputBase}>
          <option value="todas">Todas las partidas</option>
          {partidas.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      ) : null}
    </div>
  );
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
  const [mergeLotIds, setMergeLotIds] = useState([]);
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

  function makeDraftCode() {
    return `BOR-${String(selectedObra.code || selectedObraId).toUpperCase()}-${dateStamp()}-${timeStamp()}-${shortId()}`;
  }

  function makeOfficialCode(numero) {
    return `EST-${String(selectedObra.code || selectedObraId).toUpperCase()}-${dateStamp()}-${String(numero || nextNumber).padStart(3, "0")}-${shortId()}`;
  }

  function autoLotName(numero = lotForm.numero || nextNumber, periodo = lotForm.periodo) {
    const obraName = selectedObra.name || selectedObraId;
    return `Borrador ${String(numero).padStart(2, "0")} · ${obraName} · ${periodo || new Date().toISOString().slice(0, 7)} · ${makeDraftCode()}`;
  }

  function approvedFor(houseId, conceptId) {
    return Math.min(100, Number(approvedProgress[`${houseId}::${conceptId}`] || 0));
  }

  function availableFor(concept, houseId = selectedHouseId) {
    return Math.max(0, 100 - approvedFor(houseId, concept.id || concept.conceptId));
  }

  function draftPercent(concept) {
    return Math.min(availableFor(concept), clampPercent(draftRows[concept.id]?.percent));
  }

  function plannedAmount(concept) {
    return Number(concept.importe || 0) * (draftPercent(concept) / 100);
  }

  function setDraftPercent(conceptId, value) {
    updateDraft(conceptId, { percent: String(value) });
  }

  function approvedAmountFor(concept, houseId = selectedHouseId) {
    return Number(concept.importe || 0) * (approvedFor(houseId, concept.id) / 100);
  }

  function computeDeductions(subtotal, rows = []) {
    const amortizacion = subtotal * (anticipoPorcentaje / 100);
    const retencion = subtotal * (retencionPorcentaje / 100);
    const multas = rows.reduce((acc, row) => acc + Number(row.multa || 0), 0);
    const neto = Math.max(0, subtotal - amortizacion - retencion - multas);
    return { amortizacion, retencion, multas, neto };
  }

  function computeRowsTotals(rows, onlyApproved = false) {
    const baseRows = onlyApproved
      ? rows.filter((row) => row.status === "aprobada_supervision")
      : rows.filter((row) => row.status !== "observada_supervision" && row.status !== "quitada_constructora");
    const subtotal = baseRows.reduce((acc, row) => acc + Number(row.importeAprobado || row.importeSolicitado || 0), 0);
    return { subtotal, ...computeDeductions(subtotal, baseRows) };
  }

  function housePayload(house, rows, houseStatus = "borrador") {
    return {
      id: house.id,
      houseId: house.id,
      houseName: house.name || house.id,
      block: house.block || "",
      status: houseStatus,
      rows,
      totals: computeRowsTotals(rows, false),
    };
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
    return `${lot?.nombre || ""} ${lot?.draftCode || ""} ${lot?.officialCode || ""} ${statusLabel[lot?.status] || lot?.status || ""} ${house?.houseName || ""} ${row.partida || ""} ${row.clave || ""} ${row.concepto || ""} ${row.comentarioConstructora || ""} ${row.comentarioSupervision || ""} ${row.respuestaConstructora || ""}`.toLowerCase();
  }

  function lotMatches(lot, search = "", status = "todos", houseFilter = "todas") {
    if (status !== "todos" && lot.status !== status) return false;
    if (houseFilter !== "todas" && !lot.houses?.[houseFilter]) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    if (`${lot.nombre || ""} ${lot.numero || ""} ${lot.draftCode || ""} ${lot.officialCode || ""} ${statusLabel[lot.status] || lot.status || ""}`.toLowerCase().includes(q)) return true;
    return Object.values(lot.houses || {}).some((house) => (house.rows || []).some((row) => rowSearchText(row, house, lot).includes(q)));
  }

  const draftSummary = useMemo(() => {
    const rows = catalog.map((concept) => draftPercent(concept) > 0 ? { multa: todayDelay(concept.fechaEntrega) * multaDiaria } : null).filter(Boolean);
    const subtotal = catalog.reduce((acc, concept) => acc + plannedAmount(concept), 0);
    return { subtotal, ...computeDeductions(subtotal, rows), count: Object.values(draftRows).filter((row) => parseNumber(row.percent) > 0).length };
  }, [catalog, draftRows, selectedHouseId, approvedProgress, anticipoPorcentaje, retencionPorcentaje, multaDiaria]);

  useEffect(() => {
    const openHandler = () => { setOpen(true); setActiveTab("captura"); };
    const closeHandler = () => setOpen(false);
    window.addEventListener("triton-open-estimaciones", openHandler);
    window.addEventListener("triton-module-estimaciones", openHandler);
    window.addEventListener("triton-close-estimaciones", closeHandler);
    return () => {
      window.removeEventListener("triton-open-estimaciones", openHandler);
      window.removeEventListener("triton-module-estimaciones", openHandler);
      window.removeEventListener("triton-close-estimaciones", closeHandler);
    };
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
      const nextLots = lotsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      setLots(nextLots);
      if (selectedLotId && !nextLots.some((item) => item.id === selectedLotId)) setSelectedLotId("");
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  function updateDraft(conceptId, patch) {
    const concept = catalog.find((item) => item.id === conceptId);
    const available = concept ? availableFor(concept) : 100;
    setDraftRows((prev) => ({
      ...prev,
      [conceptId]: {
        ...(prev[conceptId] || {}),
        ...patch,
        percent: patch.percent !== undefined ? Math.min(available, clampPercent(patch.percent)) : (prev[conceptId]?.percent || ""),
      },
    }));
  }

  function buildRowsFromDraft() {
    return catalog.map((concept) => {
      const percent = draftPercent(concept);
      if (percent <= 0) return null;
      const previo = approvedFor(selectedHouseId, concept.id);
      const multa = todayDelay(concept.fechaEntrega) * multaDiaria;
      return {
        rowId: `${concept.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        conceptId: concept.id,
        clave: concept.clave,
        partida: concept.partida,
        concepto: concept.concepto,
        unidad: concept.unidad,
        cantidad: Number(concept.cantidad || 0),
        precioUnitario: Number(concept.precioUnitario || 0),
        importeConcepto: Number(concept.importe || 0),
        avancePrevioAprobado: previo,
        avanceDisponibleAntes: Math.max(0, 100 - previo),
        avanceSolicitado: percent,
        avanceAprobado: 0,
        importeSolicitado: Number(concept.importe || 0) * (percent / 100),
        importeAprobado: 0,
        comentarioConstructora: draftRows[concept.id]?.comment || "",
        respuestaConstructora: "",
        fechaEntrega: concept.fechaEntrega || "",
        diasAtraso: todayDelay(concept.fechaEntrega),
        multa,
        status: "borrador",
      };
    }).filter(Boolean);
  }

  async function saveDraftLot() {
    const db = getDb();
    if (!db) return;
    if (!selectedHouse) { alert("Selecciona una casa base."); return; }
    const rows = buildRowsFromDraft();
    if (!rows.length) { alert("Captura al menos un porcentaje de avance."); return; }

    const numero = Number(lotForm.numero || nextNumber);
    const draftCode = makeDraftCode();
    const id = `estimacion-${numero}-${Date.now()}-${shortId().toLowerCase()}`;
    const nombre = lotForm.nombre || `Borrador ${String(numero).padStart(2, "0")} · ${selectedObra.name || selectedObraId} · ${lotForm.periodo} · ${draftCode}`;
    const houseData = housePayload(selectedHouse, rows, "borrador");
    const housesObject = { [selectedHouse.id]: houseData };
    const lot = {
      id,
      obraId: selectedObraId,
      obraName: selectedObra.name || selectedObraId,
      numero,
      draftCode,
      officialCode: "",
      nombre,
      periodo: lotForm.periodo,
      status: "borrador",
      estimationConfig: { anticipoPorcentaje, retencionPorcentaje, multaDiaria },
      houses: housesObject,
      totals: lotTotals(housesObject),
      history: [{ at: new Date().toISOString(), by: "Constructora", action: "Borrador creado", detail: `${nombre} creado con ${rows.length} conceptos en ${selectedHouse.name || selectedHouse.id}.` }],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", id), lot, { merge: true });
    setSelectedLotId(id);
    alert("Borrador guardado. Ahora se trabaja desde Borradores y seguimiento.");
    setDraftRows({});
    localStorage.removeItem(draftStorageKey);
    await loadData();
    setActiveTab("borradores");
  }

  async function saveLotPatch(lot, housesObject, status, action, detail, extra = {}) {
    const db = getDb();
    if (!db || !lot) return;
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", lot.id), {
      houses: housesObject,
      status,
      totals: lotTotals(housesObject),
      history: appendHistory(lot, action, detail, profile === "supervision" ? "Ingeniería" : profile === "admin" ? "Administración" : "Constructora"),
      updatedAt: serverTimestamp(),
      ...extra,
    }, { merge: true });
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
      return {
        ...row,
        ...patch,
        avanceSolicitado: nextPercent,
        importeSolicitado: Number(concept.importe || row.importeConcepto || 0) * (nextPercent / 100),
        status: row.status === "observada_supervision" ? "borrador" : row.status,
        correctedAt: row.status === "observada_supervision" ? new Date().toISOString() : row.correctedAt,
      };
    });
    housesObject[houseId] = { ...house, rows, status: "borrador", totals: computeRowsTotals(rows, false) };
    await saveLotPatch(lot, housesObject, "borrador", "Borrador editado", `Se editó ${house.houseName || houseId}.`);
  }

  async function removeObservedRows(lot) {
    const housesObject = {};
    Object.entries(lot.houses || {}).forEach(([houseId, house]) => {
      const rows = (house.rows || []).map((row) => row.status === "observada_supervision"
        ? { ...row, status: "quitada_constructora", avanceSolicitado: 0, importeSolicitado: 0, respuestaConstructora: row.respuestaConstructora || "Se acepta avanzar sin esta partida/concepto observado." }
        : row);
      housesObject[houseId] = { ...house, rows, status: "borrador", totals: computeRowsTotals(rows, false) };
    });
    await saveLotPatch(lot, housesObject, "borrador", "Observaciones aceptadas sin estimar", "La constructora decidió avanzar sin partidas/conceptos observados.");
  }

  function cloneRowsForHouse(sourceRows, targetHouseId) {
    return (sourceRows || [])
      .filter((row) => !["observada_supervision", "quitada_constructora"].includes(row.status))
      .map((row) => {
        const concept = catalog.find((item) => item.id === row.conceptId) || {};
        const available = Math.max(0, 100 - approvedFor(targetHouseId, row.conceptId));
        const percent = Math.min(available, clampPercent(row.avanceSolicitado));
        if (percent <= 0) return null;
        return {
          ...row,
          rowId: `${row.conceptId}-${targetHouseId}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          status: "borrador",
          avancePrevioAprobado: approvedFor(targetHouseId, row.conceptId),
          avanceDisponibleAntes: available,
          avanceSolicitado: percent,
          avanceAprobado: 0,
          importeSolicitado: Number(concept.importe || row.importeConcepto || 0) * (percent / 100),
          importeAprobado: 0,
          comentarioSupervision: "",
          respuestaConstructora: "",
          copiedAt: new Date().toISOString(),
        };
      })
      .filter(Boolean);
  }

  async function copyLotToHouses(lot, targetIds = copyHouseIds) {
    if (!lot || !targetIds.length) { alert("Selecciona casas destino."); return; }
    const sourceHouse = Object.values(lot.houses || {})[0];
    if (!sourceHouse) return;

    const housesObject = { ...(lot.houses || {}) };
    let copied = 0;
    targetIds.forEach((houseId) => {
      const house = houses.find((item) => item.id === houseId);
      if (!house || housesObject[houseId]) return;
      const copiedRows = cloneRowsForHouse(sourceHouse.rows || [], houseId);
      if (!copiedRows.length) return;
      housesObject[houseId] = housePayload(house, copiedRows, "borrador");
      copied += 1;
    });

    if (!copied) {
      alert("No se pudo copiar. Revisa si las casas ya existen en el lote o si no tienen porcentaje disponible.");
      return;
    }

    await saveLotPatch(lot, housesObject, "borrador", "Lote copiado a casas", `Se copió a ${copied} casa(s). El lote sigue en borrador.`);
    setCopyHouseIds([]);
    alert(`Copia guardada. El monto del borrador se actualizó con ${copied} casa(s).`);
  }

  async function mergeDraftLots() {
    const selectedLots = lots.filter((lot) => mergeLotIds.includes(lot.id) && draftStatuses.includes(lot.status));
    if (selectedLots.length < 2) { alert("Selecciona al menos dos borradores para unir."); return; }
    const duplicateHouseMap = {};
    selectedLots.forEach((lot) => {
      Object.entries(lot.houses || {}).forEach(([houseId, house]) => {
        duplicateHouseMap[houseId] = [...(duplicateHouseMap[houseId] || []), house.houseName || houseId];
      });
    });
    const duplicatedHouses = Object.entries(duplicateHouseMap)
      .filter(([, occurrences]) => occurrences.length > 1)
      .map(([, occurrences]) => occurrences[0]);
    if (duplicatedHouses.length) {
      alert(`No se pueden unir estos borradores porque repiten la misma unidad: ${duplicatedHouses.join(", ")}. Para evitar duplicidad de importes, elimina esa casa de uno de los borradores o ajusta el borrador antes de unir.`);
      return;
    }

    const db = getDb();
    if (!db) return;

    const numero = nextNumber;
    const draftCode = makeDraftCode();
    const id = `estimacion-${numero}-${Date.now()}-${shortId().toLowerCase()}`;
    const housesObject = {};
    const mergedNames = [];

    selectedLots.forEach((lot) => {
      mergedNames.push(lot.nombre || lot.draftCode || lot.id);
      Object.entries(lot.houses || {}).forEach(([houseId, house]) => {
        const existing = housesObject[houseId];
        const cleanRows = (house.rows || []).filter((row) => !["observada_supervision", "quitada_constructora"].includes(row.status)).map((row) => ({
          ...row,
          rowId: `${row.conceptId}-${houseId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          status: "borrador",
          mergedFrom: lot.draftCode || lot.id,
        }));
        housesObject[houseId] = { ...house, rows: cleanRows, status: "borrador", totals: computeRowsTotals(cleanRows, false) };
      });
    });

    const nombre = `Borrador unido ${String(numero).padStart(2, "0")} · ${selectedObra.name || selectedObraId} · ${lotForm.periodo} · ${draftCode}`;
    const lot = {
      id,
      obraId: selectedObraId,
      obraName: selectedObra.name || selectedObraId,
      numero,
      draftCode,
      officialCode: "",
      nombre,
      periodo: lotForm.periodo,
      status: "borrador",
      estimationConfig: { anticipoPorcentaje, retencionPorcentaje, multaDiaria },
      houses: housesObject,
      totals: lotTotals(housesObject),
      sourceDraftIds: mergeLotIds,
      history: [{ at: new Date().toISOString(), by: "Constructora", action: "Borradores unidos", detail: `Se unieron ${selectedLots.length} borradores: ${mergedNames.join(" / ")}` }],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", id), lot, { merge: true });
    setSelectedLotId(id);
    setMergeLotIds([]);
    await loadData();
    alert("Borradores unidos. Revisa el nuevo lote antes de enviarlo a aprobación.");
  }

  async function removeHouseFromLot(lot, houseId) {
    if (!lot || !houseId) return;
    if (!draftStatuses.includes(lot.status)) {
      alert("Solo se pueden quitar casas mientras el lote está en borrador u observado.");
      return;
    }
    const currentHouses = lot.houses || {};
    const house = currentHouses[houseId];
    if (!house) return;
    if (Object.keys(currentHouses).length <= 1) {
      alert("El borrador debe conservar al menos una casa. Si ya no necesitas este lote, usa Eliminar borrador.");
      return;
    }
    const confirmed = window.confirm(`¿Quitar ${house.houseName || houseId} de este borrador? El resto del lote se conserva.`);
    if (!confirmed) return;
    const housesObject = { ...currentHouses };
    delete housesObject[houseId];
    await saveLotPatch(lot, housesObject, "borrador", "Casa retirada del borrador", `Se retiró ${house.houseName || houseId} del lote.`);
  }

  async function deleteDraftLot(lot) {
    const db = getDb();
    if (!db || !lot) return;
    if (!draftStatuses.includes(lot.status)) {
      alert("Solo se pueden eliminar borradores que no han sido enviados a revisión.");
      return;
    }
    const confirmed = window.confirm(`¿Eliminar el borrador ${lot.nombre}? Esta acción elimina el lote de trabajo.`);
    if (!confirmed) return;
    await deleteDoc(doc(db, "obras", selectedObraId, "estimacionLotes", lot.id));
    setSelectedLotId("");
    await loadData();
  }

  async function sendLotToApproval(lot) {
    if (!lot) return;
    const housesObject = {};
    let totalRows = 0;
    Object.entries(lot.houses || {}).forEach(([houseId, house]) => {
      const rows = (house.rows || [])
        .filter((row) => !["observada_supervision", "quitada_constructora"].includes(row.status) && Number(row.avanceSolicitado || 0) > 0)
        .map((row) => ({ ...row, status: "en_aprobacion" }));
      totalRows += rows.length;
      housesObject[houseId] = { ...house, rows, status: "en_aprobacion", totals: computeRowsTotals(rows, false) };
    });

    if (!totalRows) {
      alert("No hay conceptos válidos para enviar a aprobación.");
      return;
    }

    const officialCode = lot.officialCode || makeOfficialCode(lot.numero);
    await saveLotPatch(
      lot,
      housesObject,
      "en_aprobacion",
      "Enviado a aprobación",
      `El lote fue enviado a revisión de ingeniería con folio ${officialCode}.`,
      { officialCode, sentToApprovalAt: serverTimestamp() }
    );
  }

  async function reviewRows(lot, houseId, rowIds, approved) {
    if (!lot || !houseId || !rowIds.length) return;
    let comment = "";
    if (!approved) {
      comment = window.prompt("Comentario específico de supervisión para la partida/concepto observado:") || "";
      if (!comment.trim()) { alert("Agrega un comentario específico para poder observar."); return; }
    }

    const housesObject = { ...(lot.houses || {}) };
    const house = housesObject[houseId];
    const rows = (house.rows || []).map((row) => {
      const id = row.rowId || row.conceptId;
      if (!rowIds.includes(id)) return row;
      return {
        ...row,
        status: approved ? "aprobada_supervision" : "observada_supervision",
        avanceAprobado: approved ? Number(row.avanceSolicitado || 0) : 0,
        importeAprobado: approved ? Number(row.importeSolicitado || 0) : 0,
        comentarioSupervision: approved ? row.comentarioSupervision || "" : comment,
        reviewedAt: new Date().toISOString(),
      };
    });

    housesObject[houseId] = {
      ...house,
      rows,
      status: "en_aprobacion",
      reviewedAt: new Date().toISOString(),
      totals: computeRowsTotals(rows, false),
    };

    await saveLotPatch(
      lot,
      housesObject,
      "en_aprobacion",
      approved ? "Conceptos aprobados en revisión" : "Conceptos observados en revisión",
      approved ? `${rowIds.length} concepto(s) aprobado(s).` : `${rowIds.length} concepto(s) observado(s): ${comment}`
    );
    setSelectedReviewRowIds((prev) => ({ ...prev, [houseId]: [] }));
  }

  async function finishEngineeringReview(lot) {
    if (!lot) return;
    const housesObject = { ...(lot.houses || {}) };
    const allRows = Object.values(housesObject).flatMap((house) => house.rows || []);
    const observedRows = allRows.filter((row) => row.status === "observada_supervision");
    const pendingRows = allRows.filter((row) => row.status === "en_aprobacion");

    if (pendingRows.length > 0) {
      alert(`No puedes terminar la revisión del lote. Faltan ${pendingRows.length} concepto(s) por aprobar u observar.`);
      return;
    }

    if (observedRows.length > 0) {
      Object.entries(housesObject).forEach(([houseId, house]) => {
        const hasObserved = (house.rows || []).some((row) => row.status === "observada_supervision");
        housesObject[houseId] = { ...house, status: hasObserved ? "borrador_observado" : "borrador" };
      });
      await saveLotPatch(lot, housesObject, "borrador_observado", "Revisión terminada con observaciones", `${observedRows.length} concepto(s) observados regresan a borrador para respuesta de constructora.`);
      return;
    }

    if (!allRows.length || allRows.some((row) => row.status !== "aprobada_supervision")) {
      alert("Para enviar a administración, todos los conceptos deben estar aprobados o el lote debe tener observaciones para regresarlo a borrador.");
      return;
    }

    await saveLotPatch(lot, housesObject, "lista_administracion", "Revisión terminada y aprobada", "Todos los conceptos del lote fueron aprobados por ingeniería.");
  }

  async function setAdminStatus(lot, status) {
    const db = getDb();
    if (!db || !lot) return;
    await setDoc(doc(db, "obras", selectedObraId, "estimacionLotes", lot.id), {
      status,
      history: appendHistory(lot, statusLabel[status] || status, "Actualización de administración.", "Administración"),
      adminUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    await loadData();
  }

  function renderSummaryMetrics(summary, title = "Resumen") {
    return (
      <Card title={title} subtitle={`Anticipo ${anticipoPorcentaje}% · Retención ${retencionPorcentaje}% · Multa diaria ${money(multaDiaria)}`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <Metric label="Bruto" value={money(summary.subtotal)} />
          <Metric label="Amortización anticipo" value={`-${money(summary.amortizacion)}`} helper="Se descuenta proporcional al % de anticipo." />
          <Metric label="Retención" value={`-${money(summary.retencion)}`} />
          <Metric label="Multas" value={`-${money(summary.multas)}`} />
          <Metric label="Neto" value={money(summary.neto)} />
        </div>
      </Card>
    );
  }

  function renderCapture() {
    const q = filters.captura.trim().toLowerCase();
    const partidaFilter = filters.partida;
    const captureOnlyPending = filters.status === "pendientes";
    
    

    return (
      <>
        <Card title="Captura de borrador" subtitle="Captura solo sirve para generar un borrador inicial. Si necesitas diferentes avances por grupos de casas, crea varios borradores y luego únelos desde Borradores y seguimiento.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <Field label="Obra"><select value={selectedObraId} onChange={(event) => setSelectedObraId(event.target.value)} style={inputBase}>{obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.name || obra.id}</option>)}</select></Field>
            <Field label="Casa base"><select value={selectedHouseId} onChange={(event) => setSelectedHouseId(event.target.value)} style={inputBase}>{houses.map((house) => <option key={house.id} value={house.id}>{house.name || house.id}</option>)}</select></Field>
            <Field label="Periodo"><input type="month" value={lotForm.periodo} onChange={(event) => setLotForm((prev) => ({ ...prev, periodo: event.target.value, nombre: "" }))} style={inputBase} /></Field>
            <Field label="Número interno"><input value={lotForm.numero || nextNumber} onChange={(event) => setLotForm((prev) => ({ ...prev, numero: event.target.value }))} style={inputBase} /></Field>
          </div>
          <Field label="Nombre del borrador">
            <input value={lotForm.nombre || ""} placeholder="Déjalo vacío para autonombre con código único" onChange={(event) => setLotForm((prev) => ({ ...prev, nombre: event.target.value }))} style={inputBase} />
          </Field>
          <button type="button" onClick={saveDraftLot} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Guardar borrador</button>
        </Card>
        {renderSummaryMetrics(draftSummary, "Total del borrador en captura")}
        <Card title="Catálogo por partidas" subtitle="Captura el porcentaje a estimar. El disponible descuenta lo ya aprobado en estimaciones anteriores.">
          <FilterBar search={filters.captura} setSearch={(value) => setFilters((prev) => ({ ...prev, captura: value }))} partida={filters.partida} setPartida={(value) => setFilters((prev) => ({ ...prev, partida: value }))} partidas={partidas} showPartida />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <button type="button" onClick={() => setFilters((prev) => ({ ...prev, status: "pendientes" }))} style={{ ...buttonBase, background: captureOnlyPending ? "#111827" : "#fff", color: captureOnlyPending ? "#fff" : "#1d1d1f" }}>Solo pendientes por estimar</button>
            <button type="button" onClick={() => setFilters((prev) => ({ ...prev, status: "todos" }))} style={{ ...buttonBase, background: !captureOnlyPending ? "#111827" : "#fff", color: !captureOnlyPending ? "#fff" : "#1d1d1f" }}>Ver todo</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <button type="button" onClick={() => setFilters((prev) => ({ ...prev, status: "pendientes" }))} style={{ ...buttonBase, background: captureOnlyPending ? "#111827" : "#fff", color: captureOnlyPending ? "#fff" : "#1d1d1f" }}>Solo pendientes por estimar</button>
            <button type="button" onClick={() => setFilters((prev) => ({ ...prev, status: "todos" }))} style={{ ...buttonBase, background: !captureOnlyPending ? "#111827" : "#fff", color: !captureOnlyPending ? "#fff" : "#1d1d1f" }}>Ver todo</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <button type="button" onClick={() => setFilters((prev) => ({ ...prev, status: "pendientes" }))} style={{ ...buttonBase, background: captureOnlyPending ? "#111827" : "#fff", color: captureOnlyPending ? "#fff" : "#1d1d1f" }}>Solo pendientes por estimar</button>
            <button type="button" onClick={() => setFilters((prev) => ({ ...prev, status: "todos" }))} style={{ ...buttonBase, background: !captureOnlyPending ? "#111827" : "#fff", color: !captureOnlyPending ? "#fff" : "#1d1d1f" }}>Ver todo</button>
          </div>
          {partidas.map((partida) => {
            if (partidaFilter !== "todas" && partida !== partidaFilter) return null;
            const concepts = (catalogByPartida[partida] || []).filter((concept) => {
              const available = availableFor(concept);
              if (captureOnlyPending && available <= 0) return false;
              return !q || `${concept.partida} ${concept.clave} ${concept.concepto} ${concept.unidad}`.toLowerCase().includes(q);
            });
            if (!concepts.length) return null;
            const collapsed = collapsedPartidas[partida];
            const partidaSubtotal = concepts.reduce((acc, concept) => acc + plannedAmount(concept), 0);
            return (
              <div key={partida} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, overflow: "hidden", marginBottom: 12, background: "#fff" }}>
                <button type="button" onClick={() => setCollapsedPartidas((prev) => ({ ...prev, [partida]: !prev[partida] }))} style={{ width: "100%", border: 0, background: "#fff", padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
                  <strong>{collapsed ? "▸" : "▾"} {partida}</strong>
                  <span>{money(partidaSubtotal)}</span>
                </button>
                {!collapsed ? (
                  <div style={{ overflowX: "visible" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                      <thead><tr><th style={th}>Clave</th><th style={th}>Concepto</th><th style={th}>Unidad</th><th style={th}>Unidades</th><th style={th}>P.U.</th><th style={th}>Total</th><th style={th}>Aprobado</th><th style={th}>Disponible</th><th style={th}>% estimar</th><th style={th}>A estimar</th></tr></thead>
                      <tbody>
                        {concepts.map((concept) => {
                          const approved = approvedFor(selectedHouseId, concept.id);
                          const available = availableFor(concept);
                          return (
                            <tr key={concept.id}>
                              <td style={td}>{concept.clave}</td>
                              <td style={{ ...td, wordBreak: "break-word" }}>{concept.concepto}</td>
                              <td style={td}>{concept.unidad}</td>
                              <td style={td}>{concept.cantidad}</td>
                              <td style={td}>{money(concept.precioUnitario)}</td>
                              <td style={td}>{money(concept.importe)}</td>
                              <td style={td}>{approved}%</td>
                              <td style={td}>{available}%</td>
                              <td style={td}>
                                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                  <button type="button" disabled={available <= 0} onClick={() => setDraftPercent(concept.id, Math.min(50, available))} style={{ ...buttonBase, padding: "7px 10px", background: available <= 0 ? "#f4f4f5" : draftPercent(concept) >= 50 ? "#dbeafe" : "#fff", color: available <= 0 ? "#a1a1aa" : "#1d1d1f", cursor: available <= 0 ? "not-allowed" : "pointer" }}>50%</button>
                                  <button type="button" disabled={available <= 0} onClick={() => setDraftPercent(concept.id, available)} style={{ ...buttonBase, padding: "7px 10px", background: available <= 0 ? "#f4f4f5" : draftPercent(concept) >= available ? "#dcfce7" : "#fff", color: available <= 0 ? "#a1a1aa" : "#1d1d1f", cursor: available <= 0 ? "not-allowed" : "pointer" }}>100%</button>
                                  <input type="text" inputMode="decimal" disabled={available <= 0} value={draftRows[concept.id]?.percent || ""} placeholder={available <= 0 ? "100%" : "Manual"} onChange={(event) => updateDraft(concept.id, { percent: event.target.value })} onWheel={(event) => event.currentTarget.blur()} style={{ ...inputBase, width: 86, minHeight: 36, background: available <= 0 ? "#f4f4f5" : "#fff", color: available <= 0 ? "#a1a1aa" : "#1d1d1f" }} />
                                </div>
                              </td>
                              <td style={td}><strong>{money(plannedAmount(concept))}</strong></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            );
          })}
        </Card>
        <div style={{ position: "sticky", bottom: 16, zIndex: 20, margin: "18px auto 0", maxWidth: 980, padding: "12px 14px", borderRadius: 22, background: "rgba(255,255,255,0.84)", border: "1px solid rgba(60,60,67,0.14)", boxShadow: "0 18px 45px rgba(0,0,0,0.14)", WebkitBackdropFilter: "blur(18px) saturate(180%)", backdropFilter: "blur(18px) saturate(180%)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <strong>{selectedHouse?.name || selectedHouseId || "Casa sin seleccionar"}</strong>
            <div style={{ color: "#6e6e73", fontSize: 12 }}>{draftSummary.count} concepto(s) capturado(s) · Bruto {money(draftSummary.subtotal)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "#6e6e73", fontSize: 12 }}>Neto estimado</div>
            <div style={{ fontSize: 24, fontWeight: 950 }}>{money(draftSummary.neto)}</div>
          </div>
        </div>
      </>
    );
  }

  function renderLotList(lotPool) {
    const filtered = lotPool.filter((lot) => lotMatches(lot, filters.borradores, filters.status, filters.house));
    const mergeable = filtered.filter((lot) => draftStatuses.includes(lot.status));

    return (
      <Card title="Lista de lotes" subtitle="Aquí se trabaja la estimación: edición, respuestas a observaciones, copia a casas, unión de borradores y seguimiento.">
        <FilterBar search={filters.borradores} setSearch={(value) => setFilters((prev) => ({ ...prev, borradores: value }))} status={filters.status} setStatus={(value) => setFilters((prev) => ({ ...prev, status: value }))} house={filters.house} setHouse={(value) => setFilters((prev) => ({ ...prev, house: value }))} houses={houses} showStatus showHouse />
        {mergeable.length > 1 ? (
          <div style={{ padding: 12, borderRadius: 18, background: "#f5f5f7", marginBottom: 12 }}>
            <strong>Unir borradores</strong>
            <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>Usa esto cuando haya casas con avances diferentes. Capturas varios borradores y aquí los unes antes de enviar a aprobación. El sistema no permite unir borradores que repitan la misma unidad.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {mergeable.map((lot) => (
                <label key={lot.id} style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "8px 10px", background: "#fff", borderRadius: 999, border: "1px solid rgba(60,60,67,0.12)" }}>
                  <input type="checkbox" checked={mergeLotIds.includes(lot.id)} onChange={(event) => setMergeLotIds((prev) => event.target.checked ? [...prev, lot.id] : prev.filter((id) => id !== lot.id))} />
                  {lot.draftCode || lot.nombre}
                </label>
              ))}
            </div>
            <button type="button" onClick={mergeDraftLots} style={{ ...buttonBase, marginTop: 10, background: "#111827", color: "#fff" }}>Unir seleccionados</button>
          </div>
        ) : null}
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map((lot) => (
            <button key={lot.id} type="button" onClick={() => setSelectedLotId(lot.id)} style={{ border: selectedLotId === lot.id ? "2px solid #111827" : "1px solid rgba(60,60,67,0.12)", borderRadius: 18, padding: 14, background: "#fff", textAlign: "left", cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <strong>{lot.nombre}</strong>
                  <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{lot.officialCode || lot.draftCode || `Estimación ${lot.numero}`} · {lot.obraName || selectedObraId} · {lot.periodo} · {Object.keys(lot.houses || {}).length} casa(s)</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={statusStyle(lot.status)}>{statusLabel[lot.status] || lot.status}</span>
                  <div style={{ fontWeight: 950, marginTop: 6 }}>{money(lot.totals?.neto)}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </Card>
    );
  }

  function renderLotEditor(lot) {
    if (!lot) return <Card title="Selecciona un lote" subtitle="Abre un borrador o lote enviado para revisar su detalle." />;
    const editable = draftStatuses.includes(lot.status) && profile === "constructora";
    const observedCount = Object.values(lot.houses || {}).flatMap((house) => house.rows || []).filter((row) => row.status === "observada_supervision").length;

    return (
      <>
        <Card title={lot.nombre} subtitle={`${lot.officialCode || lot.draftCode || `Estimación ${lot.numero}`} · ${statusLabel[lot.status] || lot.status}`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            <Metric label="Bruto" value={money(lot.totals?.subtotal)} />
            <Metric label="Amortización" value={`-${money(lot.totals?.amortizacion)}`} />
            <Metric label="Retención" value={`-${money(lot.totals?.retencion)}`} />
            <Metric label="Multas" value={`-${money(lot.totals?.multas)}`} />
            <Metric label="Neto lote" value={money(lot.totals?.neto)} />
          </div>
          {editable ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <button type="button" onClick={() => sendLotToApproval(lot)} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Enviar a aprobación</button>
              {observedCount ? <button type="button" onClick={() => removeObservedRows(lot)} style={{ ...buttonBase, background: "#fff3cd", color: "#9a6700" }}>Aceptar sin partidas observadas</button> : null}
              <button type="button" onClick={() => deleteDraftLot(lot)} style={{ ...buttonBase, background: "#fff", color: "#b42318" }}>Eliminar borrador</button>
            </div>
          ) : null}
          {editable ? (
            <div style={{ marginTop: 14, padding: 12, borderRadius: 16, background: "#f5f5f7" }}>
              <strong>Copiar lote a otras casas</strong>
              <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>La copia se queda en borrador. No se envía a aprobación hasta que tú lo decidas.</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {houses.filter((house) => !lot.houses?.[house.id]).map((house) => (
                  <label key={house.id} style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "8px 10px", background: "#fff", borderRadius: 999, border: "1px solid rgba(60,60,67,0.12)" }}>
                    <input type="checkbox" checked={copyHouseIds.includes(house.id)} onChange={(event) => setCopyHouseIds((prev) => event.target.checked ? [...prev, house.id] : prev.filter((id) => id !== house.id))} />
                    {house.name || house.id}
                  </label>
                ))}
              </div>
              <button type="button" onClick={() => copyLotToHouses(lot)} style={{ ...buttonBase, marginTop: 10, background: "#fff", color: "#1d1d1f" }}>Guardar copia en casas seleccionadas</button>
            </div>
          ) : null}
        </Card>
        {Object.entries(lot.houses || {}).sort(([, a], [, b]) => Number((b.rows || []).some((row) => row.status === "observada_supervision")) - Number((a.rows || []).some((row) => row.status === "observada_supervision"))).map(([houseId, house]) => (
          <Card key={houseId} title={house.houseName || houseId} subtitle={`Estatus casa: ${statusLabel[house.status] || house.status || lot.status}`}>
            {(house.rows || []).some((row) => row.status === "observada_supervision") ? (
              <div style={{ padding: 12, borderRadius: 16, background: "#fff3cd", color: "#7a4d00", marginBottom: 12, border: "1px solid rgba(154,103,0,0.20)" }}>
                <strong>Observaciones por corregir en esta casa</strong>
                <div style={{ fontSize: 12, marginTop: 4 }}>Las partidas observadas aparecen primero. Ajusta el porcentaje o escribe respuesta y se marcarán como borrador para reenviar.</div>
              </div>
            ) : null}
            {(house.rows || []).some((row) => row.status === "observada_supervision") ? (
              <div style={{ padding: 12, borderRadius: 16, background: "#fff3cd", color: "#7a4d00", marginBottom: 12, border: "1px solid rgba(154,103,0,0.20)" }}>
                <strong>Observaciones por corregir en esta casa</strong>
                <div style={{ fontSize: 12, marginTop: 4 }}>Las partidas observadas aparecen primero. Ajusta el porcentaje o escribe respuesta y se marcarán como borrador para reenviar.</div>
              </div>
            ) : null}
            {(house.rows || []).some((row) => row.status === "observada_supervision") ? (
              <div style={{ padding: 12, borderRadius: 16, background: "#fff3cd", color: "#7a4d00", marginBottom: 12, border: "1px solid rgba(154,103,0,0.20)" }}>
                <strong>Observaciones por corregir en esta casa</strong>
                <div style={{ fontSize: 12, marginTop: 4 }}>Las partidas observadas aparecen primero. Ajusta el porcentaje o escribe respuesta y se marcarán como borrador para reenviar.</div>
              </div>
            ) : null}
            {editable ? (
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                <button type="button" onClick={() => removeHouseFromLot(lot, houseId)} style={{ ...buttonBase, background: "#fff", color: "#b42318" }}>Quitar casa del borrador</button>
              </div>
            ) : null}
            {Object.entries(groupByPartida((house.rows || []).slice().sort((a, b) => Number(b.status === "observada_supervision") - Number(a.status === "observada_supervision")))).map(([partida, rows]) => (
              <div key={partida} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, overflow: "hidden", marginBottom: 12, background: "#fff" }}>
                <div style={{ padding: 12, fontWeight: 950, background: "#f5f5f7" }}>{partida}</div>
                <div style={{ overflowX: "visible" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                    <thead><tr><th style={th}>Clave</th><th style={th}>Concepto</th><th style={th}>% solicitado</th><th style={th}>Importe</th><th style={th}>Estatus</th><th style={th}>Comentario constructora</th><th style={th}>Observación ingeniería</th><th style={th}>Respuesta / ajuste</th></tr></thead>
                    <tbody>
                      {rows.map((row) => {
                        const rowId = row.rowId || row.conceptId;
                        return (
                          <tr key={rowId}>
                            <td style={td}>{row.clave}</td>
                            <td style={{ ...td, wordBreak: "break-word" }}>{row.concepto}</td>
                            <td style={td}>{editable ? <input type="text" inputMode="decimal" defaultValue={row.avanceSolicitado || ""} onWheel={(event) => event.currentTarget.blur()} onBlur={(event) => updateLotRow(lot, houseId, rowId, { avanceSolicitado: event.target.value })} style={{ ...inputBase, width: 95 }} /> : `${row.avanceSolicitado}%`}</td>
                            <td style={td}>{money(row.importeSolicitado)}</td>
                            <td style={td}><span style={statusStyle(row.status)}>{rowStatusLabel[row.status] || statusLabel[row.status] || row.status}</span></td>
                            <td style={td}>{editable ? <input defaultValue={row.comentarioConstructora || ""} onBlur={(event) => updateLotRow(lot, houseId, rowId, { comentarioConstructora: event.target.value })} style={{ ...inputBase, width: "100%" }} /> : row.comentarioConstructora}</td>
                            <td style={td}>{row.comentarioSupervision || "—"}</td>
                            <td style={td}>{editable ? <input defaultValue={row.respuestaConstructora || ""} placeholder="Respuesta o comentario de corrección" onBlur={(event) => updateLotRow(lot, houseId, rowId, { respuestaConstructora: event.target.value })} style={{ ...inputBase, width: "100%" }} /> : row.respuestaConstructora || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </Card>
        ))}
        <Card title="Historial del lote" subtitle="Bitácora automática de movimientos.">
          <div style={{ display: "grid", gap: 8 }}>
            {(lot.history || []).slice().reverse().map((item, index) => (
              <div key={`${item.at}-${index}`} style={{ padding: 12, borderRadius: 14, background: "#fff", border: "1px solid rgba(60,60,67,0.10)" }}>
                <strong>{item.action}</strong>
                <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 3 }}>{item.by} · {item.at ? new Date(item.at).toLocaleString("es-MX") : ""}</div>
                <div style={{ marginTop: 5 }}>{item.detail}</div>
              </div>
            ))}
          </div>
        </Card>
      </>
    );
  }

  function renderBorradores() {
    const lotPool = lots;
    return <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 0.85fr) minmax(0, 1.35fr)", gap: 16 }} className="triton-estimaciones-two-col">{renderLotList(lotPool)}<div>{renderLotEditor(selectedLot)}</div></div>;
  }

  function renderAprobacion() {
    const approvalLots = lots.filter((lot) => lot.status === "en_aprobacion").filter((lot) => lotMatches(lot, filters.aprobacion, "todos", filters.house));
    const lot = selectedLot && selectedLot.status === "en_aprobacion" ? selectedLot : approvalLots[0];

    return (
      <>
        <Card title="Aprobación ingeniería" subtitle="Revisa por casa y por concepto. Puedes observar partidas sin sacar el lote de revisión; al terminar, cierra la revisión para regresarlo a borrador o mandarlo a administración.">
          <FilterBar search={filters.aprobacion} setSearch={(value) => setFilters((prev) => ({ ...prev, aprobacion: value }))} house={filters.house} setHouse={(value) => setFilters((prev) => ({ ...prev, house: value }))} houses={houses} showHouse />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{approvalLots.map((item) => <button key={item.id} onClick={() => setSelectedLotId(item.id)} style={{ ...buttonBase, background: item.id === lot?.id ? "#111827" : "#fff", color: item.id === lot?.id ? "#fff" : "#1d1d1f" }}>{item.officialCode || item.nombre}</button>)}</div>
          {lot ? (
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" onClick={() => finishEngineeringReview(lot)} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Terminar revisión del lote</button>
              <span style={{ color: "#6e6e73", fontSize: 12 }}>Las observaciones se guardan por partida/concepto y regresan a Borradores al terminar la revisión.</span>
            </div>
          ) : null}
        </Card>
        {lot ? Object.entries(lot.houses || {}).map(([houseId, house]) => (
          <Card key={houseId} title={house.houseName || houseId} subtitle="Selecciona conceptos para aprobar u observar.">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <button type="button" onClick={() => reviewRows(lot, houseId, selectedReviewRowIds[houseId] || [], true)} style={{ ...buttonBase, background: "#e8f7ed", color: "#157347" }}>Aprobar selección</button>
              <button type="button" onClick={() => reviewRows(lot, houseId, selectedReviewRowIds[houseId] || [], false)} style={{ ...buttonBase, background: "#fff3cd", color: "#9a6700" }}>Observar selección</button>
              <button type="button" onClick={() => reviewRows(lot, houseId, (house.rows || []).filter((row) => row.status === "en_aprobacion").map((row) => row.rowId || row.conceptId), true)} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Aprobar casa completa</button>
            </div>
            <div style={{ overflowX: "visible" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                <thead><tr><th style={th}>Sel.</th><th style={th}>Estatus</th><th style={th}>Partida</th><th style={th}>Clave</th><th style={th}>Concepto</th><th style={th}>Casa</th><th style={th}>%</th><th style={th}>Importe</th><th style={th}>Comentario</th><th style={th}>Observación</th></tr></thead>
                <tbody>
                  {(house.rows || []).map((row) => {
                    const id = row.rowId || row.conceptId;
                    const selected = (selectedReviewRowIds[houseId] || []).includes(id);
                    return (
                      <tr key={id}>
                        <td style={td}><input type="checkbox" checked={selected} onChange={(event) => setSelectedReviewRowIds((prev) => ({ ...prev, [houseId]: event.target.checked ? [...(prev[houseId] || []), id] : (prev[houseId] || []).filter((item) => item !== id) }))} /></td>
                        <td style={td}><span style={statusStyle(row.status)}>{rowStatusLabel[row.status] || row.status}</span></td>
                        <td style={td}><span style={statusStyle(row.status)}>{rowStatusLabel[row.status] || row.status}</span></td>
                        <td style={td}><span style={statusStyle(row.status)}>{rowStatusLabel[row.status] || row.status}</span></td>
                        <td style={td}>{row.partida}</td>
                        <td style={td}>{row.clave}</td>
                        <td style={{ ...td, wordBreak: "break-word" }}>{row.concepto}</td>
                        <td style={td}>{house.houseName}</td>
                        <td style={td}>{row.avanceSolicitado}%</td>
                        <td style={td}>{money(row.importeSolicitado)}</td>
                        <td style={td}>{row.comentarioConstructora || "—"}</td>
                        <td style={td}>{row.comentarioSupervision || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )) : <Card title="Sin lotes en revisión" subtitle="No hay estimaciones enviadas a aprobación." />}
      </>
    );
  }

  function renderAdmin() {
    const filtered = lots.filter((lot) => adminStatuses.includes(lot.status)).filter((lot) => lotMatches(lot, filters.estatus, filters.status, filters.house));
    return (
      <Card title="Estatus administración" subtitle="Vista de lotes aprobados que viajan a revisión y pago.">
        <FilterBar search={filters.estatus} setSearch={(value) => setFilters((prev) => ({ ...prev, estatus: value }))} status={filters.status} setStatus={(value) => setFilters((prev) => ({ ...prev, status: value }))} house={filters.house} setHouse={(value) => setFilters((prev) => ({ ...prev, house: value }))} houses={houses} showStatus showHouse />
        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map((lot) => (
            <div key={lot.id} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, padding: 14, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div><strong>{lot.nombre}</strong><div style={{ color: "#6e6e73", fontSize: 12 }}>{lot.officialCode || `Estimación ${lot.numero}`} · {lot.periodo} · {Object.keys(lot.houses || {}).length} casa(s)</div></div>
                <div style={{ textAlign: "right" }}><span style={statusStyle(lot.status)}>{statusLabel[lot.status]}</span><div style={{ fontWeight: 950, marginTop: 6 }}>{money(lot.totals?.neto)}</div></div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button onClick={() => setAdminStatus(lot, "administracion_revision")} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>En revisión administración</button>
                <button onClick={() => setAdminStatus(lot, "pago_programado")} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>Pago programado</button>
                <button onClick={() => setAdminStatus(lot, "pagada")} style={{ ...buttonBase, background: "#e8f7ed", color: "#157347" }}>Pagada</button>
                <button onClick={() => { setSelectedLotId(lot.id); setActiveTab("borradores"); }} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Ver detalle en seguimiento</button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (!open) return null;
  const tabs = allowedTabs();

  return (
    <div className="triton-estimaciones-module" style={{ position: "fixed", left: "var(--triton-shell-offset, 84px)", top: 0, right: 0, bottom: 0, zIndex: 2147483645, background: "#f5f5f7", overflow: "auto" }}>
      <style>{`@media (max-width: 900px) { .triton-estimaciones-module { left: 0 !important; z-index: 2147483647 !important; } .triton-estimaciones-two-col { grid-template-columns: 1fr !important; } }`}</style>
      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "calc(24px + env(safe-area-inset-top, 0px)) 18px 42px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 34, fontWeight: 950, color: "#1d1d1f", letterSpacing: -0.7 }}>Estimaciones</div>
            <div style={{ color: "#6e6e73", fontSize: 16, marginTop: 6 }}>Captura crea borradores. Borradores da seguimiento, une lotes, copia casas y envía a aprobación.</div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <select value={profile} onChange={(event) => setProfile(event.target.value)} style={{ ...inputBase, width: 220 }}>
              <option value="constructora">Perfil constructora</option>
              <option value="supervision">Perfil supervisión</option>
              <option value="admin">Perfil administración</option>
            </select>
            <button type="button" onClick={() => setOpen(false)} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>Volver</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>{tabs.map((tab) => <button key={tab} type="button" onClick={() => setActiveTab(tab)} style={{ ...buttonBase, background: activeTab === tab ? "#111827" : "#fff", color: activeTab === tab ? "#fff" : "#1d1d1f" }}>{tabLabel(tab)}</button>)}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
          <Metric label="Obra" value={selectedObra.name || selectedObraId} helper={loading ? "Cargando..." : `${catalog.length} conceptos`} />
          <Metric label="Contrato base" value={money(contractTotal)} helper="Catálogo × unidades" />
          <Metric label="Aprobado acumulado" value={money(approvedTotal)} />
          <Metric label="Anticipo" value={`${anticipoPorcentaje}%`} helper="Configurado en Obras" />
        </div>
        {activeTab === "captura" ? renderCapture() : null}
        {activeTab === "borradores" ? renderBorradores() : null}
        {activeTab === "aprobacion" ? renderAprobacion() : null}
        {activeTab === "estatus" ? renderAdmin() : null}
      </div>
    </div>
  );
}
