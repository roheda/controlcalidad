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
const desktopBreakpoint = 900;

const inputBase = {
  width: "100%",
  minHeight: 40,
  border: "1px solid rgba(60,60,67,0.16)",
  borderRadius: 14,
  padding: "9px 11px",
  background: "#fff",
  color: "#1d1d1f",
  outline: "none",
  boxSizing: "border-box",
  fontSize: 13,
};

const buttonBase = {
  border: "1px solid rgba(60,60,67,0.12)",
  borderRadius: 999,
  padding: "9px 13px",
  fontWeight: 850,
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
  background: "#fff",
  color: "#1d1d1f",
};

const cardStyle = {
  border: "1px solid rgba(60,60,67,0.12)",
  borderRadius: 22,
  padding: 16,
  background: "rgba(255,255,255,0.94)",
  boxShadow: "0 8px 28px rgba(0,0,0,0.055)",
  marginBottom: 16,
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
const followUpStatuses = ["en_aprobacion", ...adminStatuses];

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
    fontSize: 11,
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

function Card({ title, subtitle, children, style }) {
  return (
    <div style={{ ...cardStyle, ...style }}>
      {title ? <div style={{ fontSize: 18, fontWeight: 950, color: "#1d1d1f" }}>{title}</div> : null}
      {subtitle ? <div style={{ marginTop: 4, color: "#6e6e73", fontSize: 13, lineHeight: 1.45 }}>{subtitle}</div> : null}
      {children ? <div style={{ marginTop: title || subtitle ? 14 : 0 }}>{children}</div> : null}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 850, color: "#1d1d1f", marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}

function Metric({ label, value, helper }) {
  return (
    <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, padding: 14, background: "#fff" }}>
      <div style={{ color: "#6e6e73", fontSize: 12, fontWeight: 800 }}>{label}</div>
      <div style={{ color: "#1d1d1f", fontSize: 22, fontWeight: 950, marginTop: 4 }}>{value}</div>
      {helper ? <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{helper}</div> : null}
    </div>
  );
}

function ConceptText({ text }) {
  return (
    <span className="est-concept" title={text}>
      {text}
    </span>
  );
}

function FilterBar({ search, setSearch, status, setStatus, house, setHouse, houses, partida, setPartida, partidas, showStatus = false, showHouse = false, showPartida = false }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por lote, casa, partida, clave, concepto o comentario" style={inputBase} />
      {showStatus ? (
        <select value={status} onChange={(event) => setStatus(event.target.value)} style={inputBase}>
          <option value="todos">Todos los estatus</option>
          {Object.entries(statusLabel).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
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
  const [mergeLotIds, setMergeLotIds] = useState([]);
  const [lotForm, setLotForm] = useState({ numero: "", nombre: "", periodo: new Date().toISOString().slice(0, 7) });
  const [captureOnlyPending, setCaptureOnlyPending] = useState(true);
  const [filters, setFilters] = useState({ captura: "", borradores: "", seguimiento: "", aprobacion: "", estatus: "", status: "todos", house: "todas", partida: "todas" });

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
    if (profile === "constructora") return ["captura", "borradores", "seguimiento"];
    if (profile === "supervision") return ["aprobacion", "seguimiento"];
    return ["estatus", "seguimiento"];
  }

  function tabLabel(tab) {
    return {
      captura: "Captura",
      borradores: "Lista de borradores",
      seguimiento: "Seguimiento",
      aprobacion: "Aprobación ingeniería",
      estatus: "Administración",
    }[tab] || tab;
  }

  function makeDraftCode() {
    return `BOR-${String(selectedObra.code || selectedObraId).toUpperCase()}-${dateStamp()}-${timeStamp()}-${shortId()}`;
  }

  function makeOfficialCode(numero) {
    return `EST-${String(selectedObra.code || selectedObraId).toUpperCase()}-${dateStamp()}-${String(numero || nextNumber).padStart(3, "0")}-${shortId()}`;
  }

  function autoLotName(numero = lotForm.numero || nextNumber, periodo = lotForm.periodo) {
    const obraName = selectedObra.name || selectedObraId;
    return `Borrador ${String(numero).padStart(2, "0")} · ${obraName} · ${periodo || new Date().toISOString().slice(0, 7)}`;
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

  function summaryByPartida(rows = []) {
    return rows.reduce((acc, row) => {
      if (["observada_supervision", "quitada_constructora"].includes(row.status)) return acc;
      const key = row.partida || "General";
      acc[key] = (acc[key] || 0) + Number(row.importeSolicitado || row.importeAprobado || 0);
      return acc;
    }, {});
  }

  function summaryByHouse(housesObject = {}) {
    return Object.values(housesObject).reduce((acc, house) => {
      acc[house.houseName || house.houseId || house.id] = Number(house.totals?.neto || 0);
      return acc;
    }, {});
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
    const rows = catalog.map((concept) => draftPercent(concept) > 0 ? { ...concept, partida: concept.partida, multa: todayDelay(concept.fechaEntrega) * multaDiaria, importeSolicitado: plannedAmount(concept) } : null).filter(Boolean);
    const subtotal = rows.reduce((acc, row) => acc + Number(row.importeSolicitado || 0), 0);
    return { subtotal, ...computeDeductions(subtotal, rows), count: rows.length, rows, byPartida: summaryByPartida(rows) };
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
        comentarioConstructora: "",
        respuestaConstructora: "",
        comentarioSupervision: "",
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
    const nombre = lotForm.nombre || `${autoLotName(numero, lotForm.periodo)} · ${draftCode}`;
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
    alert("Borrador guardado. Ahora se trabaja desde Lista de borradores.");
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
      const wasObserved = row.status === "observada_supervision";
      return {
        ...row,
        ...patch,
        avanceSolicitado: nextPercent,
        importeSolicitado: Number(concept.importe || row.importeConcepto || 0) * (nextPercent / 100),
        status: wasObserved ? "borrador" : row.status,
        correctedAt: wasObserved ? new Date().toISOString() : row.correctedAt,
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
    if (selectedLotId === lot.id) setSelectedLotId("");
    await loadData();
  }

  async function sendLotToApproval(lot) {
    if (!lot || !draftStatuses.includes(lot.status)) return;
    const housesObject = {};
    Object.entries(lot.houses || {}).forEach(([houseId, house]) => {
      const rows = (house.rows || [])
        .filter((row) => row.status !== "quitada_constructora" && Number(row.avanceSolicitado || 0) > 0)
        .map((row) => ({ ...row, status: "en_aprobacion", avanceAprobado: 0, importeAprobado: 0 }));
      housesObject[houseId] = { ...house, rows, status: "en_aprobacion", totals: computeRowsTotals(rows, false) };
    });
    const activeRows = Object.values(housesObject).reduce((acc, house) => acc + (house.rows || []).length, 0);
    if (!activeRows) { alert("El lote no tiene partidas/conceptos activos para enviar."); return; }
    await saveLotPatch(lot, housesObject, "en_aprobacion", "Enviado a revisión", "La constructora envió el lote a aprobación de ingeniería.", {
      officialCode: lot.officialCode || makeOfficialCode(lot.numero),
      submittedAt: serverTimestamp(),
    });
    alert("Lote enviado a revisión de ingeniería.");
  }

  async function setReviewDecision(lot, houseId, rowId, decision, comment = "") {
    if (!lot || lot.status !== "en_aprobacion") return;
    const housesObject = { ...(lot.houses || {}) };
    const house = housesObject[houseId];
    const rows = (house.rows || []).map((row) => {
      const id = row.rowId || row.conceptId;
      if (id !== rowId) return row;
      if (decision === "aprobada_supervision") {
        return {
          ...row,
          status: "aprobada_supervision",
          avanceAprobado: Number(row.avanceSolicitado || 0),
          importeAprobado: Number(row.importeSolicitado || 0),
          comentarioSupervision: comment || row.comentarioSupervision || "Aprobado por ingeniería.",
          reviewedAt: new Date().toISOString(),
        };
      }
      return {
        ...row,
        status: "observada_supervision",
        avanceAprobado: 0,
        importeAprobado: 0,
        comentarioSupervision: comment || row.comentarioSupervision || "Observado por ingeniería.",
        reviewedAt: new Date().toISOString(),
      };
    });
    const hasObserved = rows.some((row) => row.status === "observada_supervision");
    const allReviewed = rows.filter((row) => row.status !== "quitada_constructora").every((row) => ["aprobada_supervision", "observada_supervision"].includes(row.status));
    housesObject[houseId] = { ...house, rows, status: hasObserved ? "borrador_observado" : allReviewed ? "lista_administracion" : "en_aprobacion", totals: computeRowsTotals(rows, false) };
    await saveLotPatch(lot, housesObject, "en_aprobacion", decision === "aprobada_supervision" ? "Concepto aprobado" : "Concepto observado", `${house.houseName || houseId}: ${decision === "aprobada_supervision" ? "aprobación" : "observación"} registrada.`);
  }

  async function finalizeReview(lot) {
    if (!lot || lot.status !== "en_aprobacion") return;
    const housesObject = lot.houses || {};
    const rows = Object.values(housesObject).flatMap((house) => house.rows || []).filter((row) => row.status !== "quitada_constructora");
    const pending = rows.filter((row) => !["aprobada_supervision", "observada_supervision"].includes(row.status));
    if (pending.length) {
      alert(`Faltan ${pending.length} concepto(s) por aprobar u observar. No puedes terminar la revisión hasta completar el lote.`);
      return;
    }
    const observed = rows.filter((row) => row.status === "observada_supervision");
    const nextStatus = observed.length ? "borrador_observado" : "lista_administracion";
    const nextHouses = {};
    Object.entries(housesObject).forEach(([houseId, house]) => {
      const houseRows = house.rows || [];
      const houseObserved = houseRows.some((row) => row.status === "observada_supervision");
      const totals = computeRowsTotals(houseRows, !houseObserved);
      nextHouses[houseId] = { ...house, status: houseObserved ? "borrador_observado" : "lista_administracion", totals };
    });
    await saveLotPatch(lot, nextHouses, nextStatus, nextStatus === "borrador_observado" ? "Lote observado" : "Lote aprobado", nextStatus === "borrador_observado" ? `El lote regresa a borrador con ${observed.length} observación(es).` : "Todos los conceptos del lote fueron aprobados por ingeniería.");
    alert(nextStatus === "borrador_observado" ? "El lote regresó a Borrador observado." : "Lote aprobado y enviado a Administración.");
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <Metric label="Bruto" value={money(summary.subtotal)} />
          <Metric label="Amortización anticipo" value={`-${money(summary.amortizacion)}`} helper="Se descuenta proporcional al % de anticipo." />
          <Metric label="Retención" value={`-${money(summary.retencion)}`} />
          <Metric label="Multas" value={`-${money(summary.multas)}`} />
          <Metric label="Neto a cobrar" value={money(summary.neto)} />
        </div>
      </Card>
    );
  }

  function renderMoneyBreakdown(title, data) {
    const entries = Object.entries(data || {}).filter(([, value]) => Number(value || 0) !== 0);
    if (!entries.length) return null;
    return (
      <div style={{ border: "1px solid rgba(60,60,67,0.10)", borderRadius: 18, padding: 12, background: "rgba(248,250,252,0.9)", marginBottom: 12 }}>
        <div style={{ fontWeight: 950, marginBottom: 8 }}>{title}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
          {entries.map(([key, value]) => (
            <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 8, border: "1px solid rgba(60,60,67,0.08)", background: "#fff", borderRadius: 14, padding: "8px 10px", fontSize: 12 }}>
              <span style={{ fontWeight: 800, color: "#475467" }}>{key}</span>
              <strong>{money(value)}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function ConceptGridHeader({ mode = "capture" }) {
    const template = mode === "capture"
      ? "86px minmax(300px, 2fr) 52px 64px 82px 90px 78px 82px 136px 92px"
      : mode === "review"
        ? "86px minmax(320px, 2fr) 88px 92px 110px minmax(190px, 1fr) 190px"
        : "86px minmax(320px, 2fr) 92px 92px 112px minmax(190px, 1fr) 190px";
    const labels = mode === "capture"
      ? ["Clave", "Concepto", "Unidad", "Unid.", "P.U.", "Total", "Aprob.", "Disp.", "% estimar", "A estimar"]
      : mode === "review"
        ? ["Clave", "Concepto", "% solicitado", "Importe", "Estatus", "Observación ingeniería", "Acciones"]
        : ["Clave", "Concepto", "% solicitado", "Importe", "Estatus", "Observación / respuesta", "Ajuste"];
    return <div className="est-grid est-grid-header" style={{ gridTemplateColumns: template }}>{labels.map((label) => <div key={label}>{label}</div>)}</div>;
  }

  function renderCapture() {
    const q = filters.captura.trim().toLowerCase();
    const partidaFilter = filters.partida;

    return (
      <>
        <Card title="Captura de borrador" subtitle="Captura solo sirve para generar un borrador inicial. Si necesitas diferentes avances por grupos de casas, crea varios borradores y luego únelos desde Lista de borradores.">
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
        {renderMoneyBreakdown("Monto por partida", draftSummary.byPartida)}
        <Card title="Catálogo por partidas" subtitle="Captura el porcentaje a estimar. El disponible descuenta lo ya aprobado en estimaciones anteriores.">
          <FilterBar search={filters.captura} setSearch={(value) => setFilters((prev) => ({ ...prev, captura: value }))} partida={filters.partida} setPartida={(value) => setFilters((prev) => ({ ...prev, partida: value }))} partidas={partidas} showPartida />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <button type="button" onClick={() => setCaptureOnlyPending(true)} style={{ ...buttonBase, background: captureOnlyPending ? "#111827" : "#fff", color: captureOnlyPending ? "#fff" : "#1d1d1f" }}>Solo pendientes por estimar</button>
            <button type="button" onClick={() => setCaptureOnlyPending(false)} style={{ ...buttonBase, background: !captureOnlyPending ? "#111827" : "#fff", color: !captureOnlyPending ? "#fff" : "#1d1d1f" }}>Ver todo</button>
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
                  <div>
                    <ConceptGridHeader mode="capture" />
                    {concepts.map((concept) => {
                      const approved = approvedFor(selectedHouseId, concept.id);
                      const available = availableFor(concept);
                      const current = draftPercent(concept);
                      const disabled = available <= 0;
                      return (
                        <div key={concept.id} className={`est-grid est-grid-row ${disabled ? "est-disabled-row" : ""}`} style={{ gridTemplateColumns: "86px minmax(300px, 2fr) 52px 64px 82px 90px 78px 82px 136px 92px" }}>
                          <div>{concept.clave}</div>
                          <div><ConceptText text={concept.concepto} /></div>
                          <div>{concept.unidad}</div>
                          <div>{concept.cantidad}</div>
                          <div>{money(concept.precioUnitario)}</div>
                          <div>{money(concept.importe)}</div>
                          <div>{approved}%</div>
                          <div>{available}%</div>
                          <div>
                            <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                              <button type="button" disabled={disabled} onClick={() => setDraftPercent(concept.id, Math.min(50, available))} style={{ ...buttonBase, padding: "7px 9px", background: disabled ? "#f4f4f5" : current === 50 ? "#dbeafe" : "#fff", color: disabled ? "#a1a1aa" : "#1d1d1f", cursor: disabled ? "not-allowed" : "pointer" }}>50%</button>
                              <button type="button" disabled={disabled} onClick={() => setDraftPercent(concept.id, available)} style={{ ...buttonBase, padding: "7px 9px", background: disabled ? "#f4f4f5" : current === available && current > 0 ? "#dcfce7" : "#fff", color: disabled ? "#a1a1aa" : "#1d1d1f", cursor: disabled ? "not-allowed" : "pointer" }}>100%</button>
                              <input type="text" inputMode="decimal" disabled={disabled} value={draftRows[concept.id]?.percent || ""} placeholder={disabled ? "100%" : "Manual"} onChange={(event) => updateDraft(concept.id, { percent: event.target.value })} onWheel={(event) => event.currentTarget.blur()} style={{ ...inputBase, width: 82, minHeight: 34, background: disabled ? "#f4f4f5" : "#fff", color: disabled ? "#a1a1aa" : "#1d1d1f" }} />
                            </div>
                          </div>
                          <div><strong>{money(plannedAmount(concept))}</strong></div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </Card>
        <div className="est-floating-summary">
          <div><strong>{selectedHouse?.name || selectedHouseId || "Casa"}</strong><br /><span>{draftSummary.count} concepto(s) capturado(s) · Bruto {money(draftSummary.subtotal)}</span></div>
          <div style={{ textAlign: "right" }}><span>Neto estimado</span><br /><strong>{money(draftSummary.neto)}</strong></div>
        </div>
      </>
    );
  }

  function renderLotCard(lot, editable = true) {
    const isSelected = selectedLotId === lot.id;
    const housesCount = Object.keys(lot.houses || {}).length;
    return (
      <div key={lot.id} style={{ border: isSelected ? "2px solid #007aff" : "1px solid rgba(60,60,67,0.12)", borderRadius: 18, padding: 14, background: "#fff", marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 950 }}>{lot.nombre || lot.draftCode || lot.id}</div>
            <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{lot.officialCode || lot.draftCode} · {housesCount} casa(s) · {lot.periodo}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={statusStyle(lot.status)}>{statusLabel[lot.status] || lot.status}</span>
            <div style={{ fontWeight: 950, marginTop: 8 }}>{money(lot.totals?.neto)} <span style={{ color: "#6e6e73", fontSize: 12 }}>neto a cobrar</span></div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button type="button" onClick={() => setSelectedLotId(isSelected ? "" : lot.id)} style={{ ...buttonBase, background: isSelected ? "#eef2ff" : "#fff" }}>{isSelected ? "Cerrar detalle" : "Abrir / revisar"}</button>
          {editable && draftStatuses.includes(lot.status) ? <button type="button" onClick={() => sendLotToApproval(lot)} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Enviar a aprobación</button> : null}
          {editable && draftStatuses.includes(lot.status) ? <button type="button" onClick={() => deleteDraftLot(lot)} style={{ ...buttonBase, color: "#b42318" }}>Eliminar borrador</button> : null}
        </div>
      </div>
    );
  }

  function sortedRowsForDraft(rows = []) {
    return [...rows].sort((a, b) => {
      const ao = a.status === "observada_supervision" ? 0 : 1;
      const bo = b.status === "observada_supervision" ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return String(a.partida || "").localeCompare(String(b.partida || ""));
    });
  }

  function renderSelectedLotEditor(lot, editable = true) {
    if (!lot) return null;
    const allRows = Object.values(lot.houses || {}).flatMap((house) => (house.rows || []).map((row) => ({ ...row, houseId: house.houseId || house.id, houseName: house.houseName || house.id })));
    const observedCount = allRows.filter((row) => row.status === "observada_supervision").length;
    const byPartida = summaryByPartida(allRows);
    const byHouse = summaryByHouse(lot.houses || {});
    return (
      <Card title={`Detalle · ${lot.nombre || lot.draftCode}`} subtitle={`${lot.officialCode || lot.draftCode || "Sin folio"} · ${statusLabel[lot.status] || lot.status}`}>
        {observedCount ? (
          <div style={{ border: "1px solid rgba(180,83,9,0.22)", background: "#fff7ed", color: "#9a3412", borderRadius: 18, padding: 12, marginBottom: 12, fontWeight: 850 }}>
            Hay {observedCount} observación(es) por corregir. Las partidas observadas aparecen arriba de cada casa.
          </div>
        ) : null}
        {renderMoneyBreakdown("Monto por partida", byPartida)}
        {renderMoneyBreakdown("Monto por casa", byHouse)}
        {editable && draftStatuses.includes(lot.status) ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Copiar estimación a casas</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {houses.filter((house) => !lot.houses?.[house.id]).map((house) => (
                  <label key={house.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid rgba(60,60,67,0.12)", borderRadius: 999, padding: "7px 10px", background: copyHouseIds.includes(house.id) ? "#eef2ff" : "#fff" }}>
                    <input type="checkbox" checked={copyHouseIds.includes(house.id)} onChange={(event) => setCopyHouseIds((prev) => event.target.checked ? [...prev, house.id] : prev.filter((id) => id !== house.id))} />
                    {house.name || house.id}
                  </label>
                ))}
                <button type="button" onClick={() => copyLotToHouses(lot)} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Copiar a casas seleccionadas</button>
              </div>
            </div>
            {observedCount ? <button type="button" onClick={() => removeObservedRows(lot)} style={{ ...buttonBase, background: "#fff7ed", color: "#9a3412" }}>Aceptar lote sin partidas observadas</button> : null}
          </div>
        ) : null}
        {Object.entries(lot.houses || {}).map(([houseId, house]) => (
          <div key={houseId} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, overflow: "hidden", marginBottom: 12, background: "#fff" }}>
            <div style={{ padding: 14, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", borderBottom: "1px solid rgba(60,60,67,0.10)" }}>
              <div><strong>{house.houseName || houseId}</strong><div style={{ color: "#6e6e73", fontSize: 12 }}>Neto a cobrar {money(house.totals?.neto)}</div></div>
              {editable && draftStatuses.includes(lot.status) ? <button type="button" onClick={() => removeHouseFromLot(lot, houseId)} style={{ ...buttonBase }}>Quitar casa del borrador</button> : null}
            </div>
            <ConceptGridHeader mode="draft" />
            {sortedRowsForDraft(house.rows || []).map((row) => {
              const rowId = row.rowId || row.conceptId;
              const isObserved = row.status === "observada_supervision";
              return (
                <div key={rowId} className={`est-grid est-grid-row ${isObserved ? "est-observed-row" : ""}`} style={{ gridTemplateColumns: "86px minmax(320px, 2fr) 92px 92px 112px minmax(190px, 1fr) 190px" }}>
                  <div>{row.clave}</div>
                  <div><ConceptText text={row.concepto} /><div style={{ color: "#6e6e73", fontSize: 11, marginTop: 4 }}>{row.partida}</div></div>
                  <div>{row.avanceSolicitado}%</div>
                  <div>{money(row.importeSolicitado)}</div>
                  <div><span style={statusStyle(row.status)}>{rowStatusLabel[row.status] || row.status}</span></div>
                  <div>
                    {row.comentarioSupervision ? <div style={{ color: "#9a3412", fontWeight: 850, marginBottom: 6 }}>Ing: {row.comentarioSupervision}</div> : <span style={{ color: "#6e6e73" }}>Sin observación</span>}
                    {row.respuestaConstructora ? <div style={{ color: "#157347", marginTop: 4 }}>Resp: {row.respuestaConstructora}</div> : null}
                  </div>
                  <div>
                    {editable && draftStatuses.includes(lot.status) ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <input type="text" inputMode="decimal" value={row.avanceSolicitado ?? ""} onChange={(event) => updateLotRow(lot, houseId, rowId, { avanceSolicitado: event.target.value })} style={{ ...inputBase, minHeight: 34 }} />
                        {isObserved ? <input value={row.respuestaConstructora || ""} onChange={(event) => updateLotRow(lot, houseId, rowId, { respuestaConstructora: event.target.value })} placeholder="Respuesta constructora" style={{ ...inputBase, minHeight: 34 }} /> : null}
                      </div>
                    ) : <span style={{ color: "#6e6e73" }}>Consulta</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <div style={{ borderTop: "1px solid rgba(60,60,67,0.10)", marginTop: 14, paddingTop: 14 }}>
          <div style={{ fontWeight: 950, marginBottom: 8 }}>Historial</div>
          <div style={{ display: "grid", gap: 8 }}>
            {(lot.history || []).slice().reverse().map((item, index) => (
              <div key={`${item.at}-${index}`} style={{ border: "1px solid rgba(60,60,67,0.10)", borderRadius: 14, padding: 10, background: "#fff" }}>
                <strong>{item.action}</strong> <span style={{ color: "#6e6e73" }}>· {item.by} · {item.at ? new Date(item.at).toLocaleString("es-MX") : ""}</span>
                <div style={{ color: "#475467", marginTop: 4 }}>{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  function renderDrafts() {
    const filtered = lots.filter((lot) => draftStatuses.includes(lot.status)).filter((lot) => lotMatches(lot, filters.borradores, filters.status, filters.house));
    return (
      <>
        <Card title="Lista de borradores" subtitle="Aquí se trabajan los borradores: revisar, corregir observaciones, copiar casas, unir borradores y enviar a aprobación.">
          <FilterBar search={filters.borradores} setSearch={(value) => setFilters((prev) => ({ ...prev, borradores: value }))} status={filters.status} setStatus={(value) => setFilters((prev) => ({ ...prev, status: value }))} house={filters.house} setHouse={(value) => setFilters((prev) => ({ ...prev, house: value }))} houses={houses} showStatus showHouse />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {filtered.map((lot) => renderLotCard(lot, true))}
          </div>
          {!filtered.length ? <div style={{ color: "#6e6e73" }}>No hay borradores con estos filtros.</div> : null}
        </Card>
        <Card title="Unir borradores" subtitle="Selecciona borradores con casas distintas. Si una casa se repite, el sistema bloquea la unión para evitar duplicar importes.">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {lots.filter((lot) => draftStatuses.includes(lot.status)).map((lot) => (
              <label key={lot.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid rgba(60,60,67,0.12)", borderRadius: 999, padding: "7px 10px", background: mergeLotIds.includes(lot.id) ? "#eef2ff" : "#fff" }}>
                <input type="checkbox" checked={mergeLotIds.includes(lot.id)} onChange={(event) => setMergeLotIds((prev) => event.target.checked ? [...prev, lot.id] : prev.filter((id) => id !== lot.id))} />
                {lot.draftCode || lot.nombre}
              </label>
            ))}
            <button type="button" onClick={mergeDraftLots} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Unir seleccionados</button>
          </div>
        </Card>
        {selectedLot && draftStatuses.includes(selectedLot.status) ? renderSelectedLotEditor(selectedLot, true) : null}
      </>
    );
  }

  function renderFollowUp() {
    const filtered = lots.filter((lot) => followUpStatuses.includes(lot.status)).filter((lot) => lotMatches(lot, filters.seguimiento, filters.status, filters.house));
    return (
      <>
        <Card title="Seguimiento de estimaciones" subtitle="Consulta los lotes que ya salieron de borrador: revisión, administración y pago.">
          <FilterBar search={filters.seguimiento} setSearch={(value) => setFilters((prev) => ({ ...prev, seguimiento: value }))} status={filters.status} setStatus={(value) => setFilters((prev) => ({ ...prev, status: value }))} house={filters.house} setHouse={(value) => setFilters((prev) => ({ ...prev, house: value }))} houses={houses} showStatus showHouse />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {filtered.map((lot) => renderLotCard(lot, false))}
          </div>
          {!filtered.length ? <div style={{ color: "#6e6e73" }}>No hay estimaciones en seguimiento con estos filtros.</div> : null}
        </Card>
        {selectedLot && followUpStatuses.includes(selectedLot.status) ? renderSelectedLotEditor(selectedLot, false) : null}
      </>
    );
  }

  function renderReview() {
    const filtered = lots.filter((lot) => lot.status === "en_aprobacion").filter((lot) => lotMatches(lot, filters.aprobacion, "todos", filters.house));
    return (
      <>
        <Card title="Aprobación ingeniería" subtitle="Revisa todos los conceptos. Puedes cambiar tu decisión antes de terminar la revisión del lote.">
          <FilterBar search={filters.aprobacion} setSearch={(value) => setFilters((prev) => ({ ...prev, aprobacion: value }))} house={filters.house} setHouse={(value) => setFilters((prev) => ({ ...prev, house: value }))} houses={houses} showHouse />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>{filtered.map((lot) => renderLotCard(lot, false))}</div>
          {!filtered.length ? <div style={{ color: "#6e6e73" }}>No hay lotes en revisión.</div> : null}
        </Card>
        {selectedLot && selectedLot.status === "en_aprobacion" ? (
          <Card title={`Revisión · ${selectedLot.nombre}`} subtitle="Cada concepto debe quedar Aprobado u Observado antes de terminar la revisión.">
            {Object.entries(selectedLot.houses || {}).map(([houseId, house]) => (
              <div key={houseId} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, overflow: "hidden", marginBottom: 12, background: "#fff" }}>
                <div style={{ padding: 14, borderBottom: "1px solid rgba(60,60,67,0.10)", fontWeight: 950 }}>{house.houseName || houseId}</div>
                <ConceptGridHeader mode="review" />
                {(house.rows || []).map((row) => {
                  const rowId = row.rowId || row.conceptId;
                  const reviewed = ["aprobada_supervision", "observada_supervision"].includes(row.status);
                  return (
                    <div key={rowId} className="est-grid est-grid-row" style={{ gridTemplateColumns: "86px minmax(320px, 2fr) 88px 92px 110px minmax(190px, 1fr) 190px" }}>
                      <div>{row.clave}</div>
                      <div><ConceptText text={row.concepto} /><div style={{ color: "#6e6e73", fontSize: 11, marginTop: 4 }}>{row.partida}</div></div>
                      <div>{row.avanceSolicitado}%</div>
                      <div>{money(row.importeSolicitado)}</div>
                      <div><span style={statusStyle(row.status)}>{reviewed ? rowStatusLabel[row.status] : "Pendiente"}</span></div>
                      <div><textarea defaultValue={row.comentarioSupervision || ""} placeholder="Observación o comentario" data-review-comment={`${houseId}::${rowId}`} style={{ ...inputBase, minHeight: 54, resize: "vertical" }} /></div>
                      <div style={{ display: "grid", gap: 7 }}>
                        <button type="button" onClick={() => {
                          const comment = document.querySelector(`[data-review-comment='${houseId}::${rowId}']`)?.value || "Aprobado por ingeniería.";
                          setReviewDecision(selectedLot, houseId, rowId, "aprobada_supervision", comment);
                        }} style={{ ...buttonBase, background: row.status === "aprobada_supervision" ? "#dcfce7" : "#fff" }}>Aprobar</button>
                        <button type="button" onClick={() => {
                          const comment = document.querySelector(`[data-review-comment='${houseId}::${rowId}']`)?.value || "";
                          if (!comment.trim()) { alert("Escribe la observación de ingeniería antes de observar."); return; }
                          setReviewDecision(selectedLot, houseId, rowId, "observada_supervision", comment);
                        }} style={{ ...buttonBase, background: row.status === "observada_supervision" ? "#fff7ed" : "#fff", color: "#9a3412" }}>Observar</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            <button type="button" onClick={() => finalizeReview(selectedLot)} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Terminar revisión del lote</button>
          </Card>
        ) : null}
      </>
    );
  }

  function renderAdmin() {
    const filtered = lots.filter((lot) => adminStatuses.includes(lot.status)).filter((lot) => lotMatches(lot, filters.estatus, filters.status, filters.house));
    return (
      <>
        <Card title="Estatus administración" subtitle="Lotes aprobados que viajan a revisión, programación y pago.">
          <FilterBar search={filters.estatus} setSearch={(value) => setFilters((prev) => ({ ...prev, estatus: value }))} status={filters.status} setStatus={(value) => setFilters((prev) => ({ ...prev, status: value }))} house={filters.house} setHouse={(value) => setFilters((prev) => ({ ...prev, house: value }))} houses={houses} showStatus showHouse />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {filtered.map((lot) => (
              <div key={lot.id} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, padding: 14, background: "#fff" }}>
                <div style={{ fontWeight: 950 }}>{lot.nombre}</div>
                <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{lot.officialCode || lot.draftCode} · Neto a cobrar {money(lot.totals?.neto)}</div>
                <div style={{ marginTop: 8 }}><span style={statusStyle(lot.status)}>{statusLabel[lot.status]}</span></div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  <button type="button" onClick={() => setAdminStatus(lot, "administracion_revision")} style={buttonBase}>En revisión administración</button>
                  <button type="button" onClick={() => setAdminStatus(lot, "pago_programado")} style={buttonBase}>Pago programado</button>
                  <button type="button" onClick={() => setAdminStatus(lot, "pagada")} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Pagada</button>
                </div>
              </div>
            ))}
          </div>
          {!filtered.length ? <div style={{ color: "#6e6e73" }}>No hay lotes administrativos.</div> : null}
        </Card>
      </>
    );
  }

  if (!open) return null;

  const tabs = allowedTabs();
  return (
    <div style={{ position: "fixed", inset: 0, left: "var(--triton-shell-offset, 84px)", zIndex: 2147483642, background: "linear-gradient(180deg, #f7f8fb 0%, #eef2f7 100%)", overflow: "auto", padding: "24px 24px 120px" }}>
      <style>{`
        .est-grid { display: grid; align-items: stretch; width: 100%; }
        .est-grid-header { background: rgba(242,242,247,0.98); color: #6e6e73; font-size: 10.5px; font-weight: 950; text-transform: uppercase; letter-spacing: .28px; border-bottom: 1px solid rgba(60,60,67,.10); }
        .est-grid-header > div { padding: 9px 10px; }
        .est-grid-row { min-height: 72px; border-bottom: 1px solid rgba(60,60,67,.09); font-size: 12.5px; color: #1d1d1f; }
        .est-grid-row > div { padding: 10px; min-width: 0; display: flex; align-items: center; }
        .est-concept { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.28; max-height: 4.1em; font-weight: 700; cursor: help; position: relative; }
        .est-concept:hover::after { content: attr(title); position: fixed; z-index: 2147483647; max-width: min(520px, 70vw); white-space: normal; left: min(28vw, 460px); top: 120px; padding: 14px 16px; background: #fff; color: #1d1d1f; border: 1px solid rgba(60,60,67,.14); border-radius: 16px; box-shadow: 0 18px 55px rgba(0,0,0,.18); line-height: 1.45; font-weight: 650; }
        .est-disabled-row { opacity: .64; background: #fafafa; }
        .est-observed-row { background: #fff7ed; }
        .est-floating-summary { position: fixed; left: calc(var(--triton-shell-offset, 84px) + 24px); right: 24px; bottom: 18px; z-index: 2147483644; display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 14px 18px; border-radius: 24px; background: rgba(255,255,255,.82); border: 1px solid rgba(60,60,67,.12); box-shadow: 0 18px 60px rgba(0,0,0,.16); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); }
        .est-floating-summary span { color: #6e6e73; font-size: 12px; }
        .est-floating-summary strong { color: #1d1d1f; font-size: 20px; }
        @media (max-width: ${desktopBreakpoint}px) {
          .est-grid { display: block; }
          .est-grid-header { display: none; }
          .est-grid-row { display: grid; grid-template-columns: 1fr; gap: 4px; padding: 12px; }
          .est-grid-row > div { padding: 4px 0; display: block; }
          .est-floating-summary { left: 12px; right: 12px; bottom: 12px; }
        }
      `}</style>
      <div style={{ maxWidth: 1480, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ color: "#6e6e73", fontSize: 13, fontWeight: 850 }}>Triton OS · Estimaciones</div>
            <h1 style={{ margin: "4px 0 0", fontSize: 34, lineHeight: 1.05, letterSpacing: -0.8 }}>Estimaciones de obra</h1>
            <p style={{ margin: "8px 0 0", color: "#6e6e73" }}>Borrador → revisión ingeniería → administración → pago.</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <select value={profile} onChange={(event) => setProfile(event.target.value)} style={{ ...inputBase, width: 180 }}>
              <option value="constructora">Constructora</option>
              <option value="supervision">Supervisión</option>
              <option value="admin">Administración</option>
            </select>
            <button type="button" onClick={() => { setOpen(false); window.dispatchEvent(new Event("triton-module-calidad")); }} style={buttonBase}>Volver</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
          <Metric label="Contrato estimado" value={money(contractTotal)} />
          <Metric label="Aprobado acumulado" value={money(approvedTotal)} />
          <Metric label="Pendiente" value={money(Math.max(0, contractTotal - approvedTotal))} />
          <Metric label="Lotes" value={lots.length} />
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {tabs.map((tab) => (
            <button key={tab} type="button" onClick={() => { setActiveTab(tab); setSelectedLotId(""); }} style={{ ...buttonBase, background: activeTab === tab ? "#111827" : "#fff", color: activeTab === tab ? "#fff" : "#1d1d1f" }}>{tabLabel(tab)}</button>
          ))}
          <button type="button" onClick={loadData} style={{ ...buttonBase, marginLeft: "auto" }}>{loading ? "Cargando..." : "Actualizar"}</button>
        </div>

        {activeTab === "captura" ? renderCapture() : null}
        {activeTab === "borradores" ? renderDrafts() : null}
        {activeTab === "seguimiento" ? renderFollowUp() : null}
        {activeTab === "aprobacion" ? renderReview() : null}
        {activeTab === "estatus" ? renderAdmin() : null}
      </div>
    </div>
  );
}
