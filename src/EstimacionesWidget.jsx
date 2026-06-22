import React, { useEffect, useMemo, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

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

const inputBase = {
  width: "100%",
  minHeight: 44,
  border: "1px solid rgba(60,60,67,0.16)",
  borderRadius: 14,
  padding: "10px 12px",
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

const tableHeaderCell = {
  padding: "10px 10px",
  fontSize: 11,
  fontWeight: 950,
  color: "#6e6e73",
  textTransform: "uppercase",
  letterSpacing: 0.45,
  background: "rgba(242,242,247,0.92)",
  borderBottom: "1px solid rgba(60,60,67,0.10)",
  position: "sticky",
  top: 0,
  zIndex: 2,
};

const tableCell = {
  padding: "10px 10px",
  borderBottom: "1px solid rgba(60,60,67,0.10)",
  verticalAlign: "top",
  fontSize: 13,
  color: "#1d1d1f",
};

const conceptSeed = [
  { clave: "PRE-001", partida: "Preliminares", concepto: "Trazo y nivelación", unidad: "lote", cantidad: 1, precioUnitario: 8500, fechaEntrega: "" },
  { clave: "CIM-001", partida: "Cimentación", concepto: "Excavación, acero, cimbra y colado de cimentación", unidad: "lote", cantidad: 1, precioUnitario: 145000, fechaEntrega: "" },
  { clave: "EST-001", partida: "Estructura", concepto: "Castillos, dalas, trabes y losa", unidad: "lote", cantidad: 1, precioUnitario: 230000, fechaEntrega: "" },
  { clave: "ALB-001", partida: "Albañilería", concepto: "Muros, cerramientos y resanes", unidad: "lote", cantidad: 1, precioUnitario: 120000, fechaEntrega: "" },
  { clave: "ACA-001", partida: "Acabados", concepto: "Pisos, aplanados, pintura y detalles finales", unidad: "lote", cantidad: 1, precioUnitario: 190000, fechaEntrega: "" },
];

function money(value) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function parseNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function slugify(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanText(text = "") {
  return String(text)
    .replace(/Ã“/g, "Ó")
    .replace(/Ã‰/g, "É")
    .replace(/Ã/g, "Á")
    .replace(/Ã/g, "Í")
    .replace(/Ãš/g, "Ú")
    .replace(/Ã‘/g, "Ñ")
    .replace(/Ã³/g, "ó")
    .replace(/Ã©/g, "é")
    .replace(/Ã¡/g, "á")
    .replace(/Ã­/g, "í")
    .replace(/Ãº/g, "ú")
    .replace(/Ã±/g, "ñ")
    .replace(/Â´/g, "´")
    .replace(/Â/g, "")
    .trim();
}

function normalizeCatalogItem(item, index = 0) {
  const cantidad = parseNumber(item.cantidad ?? item.Unidades ?? item.unidades ?? item.cantidadContratada ?? 1);
  const precioUnitario = parseNumber(item.precioUnitario ?? item["P.U."] ?? item.pu ?? item.PU ?? item.precio_unitario ?? 0);
  const clave = cleanText(item.clave || item.Clave || item.id || `CON-${index + 1}`);
  const partida = cleanText(item.partida || item.PARTIDA || item.capitulo || "General");
  const concepto = cleanText(item.concepto || item.descripcion || item.Descripcion || item.descripción || item.description || "Concepto sin nombre");
  const unidad = cleanText(item.unidad || item.Unidad || "lote");
  const rowNumber = Number(item.rowNumber || index + 1);
  return {
    id: item.id || `${slugify(partida || "general")}-${slugify(clave || "concepto")}-${String(rowNumber).padStart(4, "0")}`,
    clave,
    partida,
    concepto,
    descripcion: concepto,
    unidad,
    cantidad,
    precioUnitario,
    importe: cantidad * precioUnitario,
    fechaEntrega: item.fechaEntrega || item.fecha_entrega || "",
    rowNumber,
    sourceFileName: item.sourceFileName || "",
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
      row = [];
      current = "";
      continue;
    }
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
    headers.forEach((header, columnIndex) => {
      raw[header] = row[columnIndex] ?? "";
    });
    return normalizeCatalogItem({
      PARTIDA: raw.PARTIDA,
      clave: raw.clave || raw.Clave,
      descripcion: raw.descripcion || raw.Descripcion || raw.DESCRIPCION || raw.DESCRIPCIÓN,
      Unidades: raw.Unidades || raw.unidades || raw.Cantidad || raw.cantidad,
      unidad: raw.unidad || raw.Unidad,
      "P.U.": raw["P.U."] || raw.PU || raw["Precio Unitario"] || raw.precioUnitario,
      rowNumber: index + 2,
      sourceFileName,
    }, index);
  }).filter((item) => item.clave && item.concepto && item.precioUnitario > 0);
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 850, color: "#1d1d1f", marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 22, padding: 16, background: "rgba(255,255,255,0.88)", boxShadow: "0 8px 28px rgba(0,0,0,0.055)" }}>
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
      <div style={{ color: "#1d1d1f", fontSize: 25, fontWeight: 950, marginTop: 4 }}>{value}</div>
      {helper ? <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{helper}</div> : null}
    </div>
  );
}

function groupByPartida(items) {
  return items.reduce((acc, item) => {
    const partida = item.partida || "General";
    if (!acc[partida]) acc[partida] = [];
    acc[partida].push(item);
    return acc;
  }, {});
}

export default function EstimacionesWidget() {
  const [open, setOpen] = useState(false);
  const [obras, setObras] = useState([]);
  const [houses, setHouses] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [estimaciones, setEstimaciones] = useState([]);
  const [selectedObraId, setSelectedObraId] = useState(defaultObraId);
  const [selectedHouseId, setSelectedHouseId] = useState("");
  const [selectedCopyHouseIds, setSelectedCopyHouseIds] = useState([]);
  const [activeTab, setActiveTab] = useState("captura");
  const [loading, setLoading] = useState(false);
  const [importingCatalog, setImportingCatalog] = useState(false);
  const [catalogImportInfo, setCatalogImportInfo] = useState(null);
  const [advanceDrafts, setAdvanceDrafts] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [collapsedPartidas, setCollapsedPartidas] = useState({});
  const [periodForm, setPeriodForm] = useState({ periodo: new Date().toISOString().slice(0, 7), anticipoPorcentaje: 30, multaDiaria: 0, retencionPorcentaje: 0 });
  const [manualConcept, setManualConcept] = useState({ clave: "", partida: "", concepto: "", unidad: "", cantidad: "", precioUnitario: "", fechaEntrega: "" });

  const selectedHouse = houses.find((house) => house.id === selectedHouseId) || null;
  const houseEstimaciones = useMemo(() => estimaciones.filter((item) => item.houseId === selectedHouseId), [estimaciones, selectedHouseId]);
  const catalogByPartida = useMemo(() => groupByPartida(catalog), [catalog]);
  const pendingReviewByPartida = useMemo(() => groupByPartida(estimaciones.filter((item) => item.status === "enviado_supervision")), [estimaciones]);

  function currentRow(concept) {
    return houseEstimaciones.find((item) => item.conceptId === concept.id);
  }

  function draftPercent(concept) {
    const draft = advanceDrafts[concept.id];
    if (draft !== undefined && draft !== "") return Math.min(100, Math.max(0, parseNumber(draft)));
    return Math.min(100, Math.max(0, Number(currentRow(concept)?.avanceSolicitado || 0)));
  }

  function plannedAmount(concept) {
    return Number(concept.importe || 0) * (draftPercent(concept) / 100);
  }

  const captureSummary = useMemo(() => {
    const subtotal = catalog.reduce((acc, concept) => acc + plannedAmount(concept), 0);
    const multas = houseEstimaciones.reduce((acc, item) => acc + Number(item.multa || 0), 0);
    const amortizacion = subtotal * (Number(periodForm.anticipoPorcentaje || 0) / 100);
    const retencion = subtotal * (Number(periodForm.retencionPorcentaje || 0) / 100);
    const neto = Math.max(0, subtotal - amortizacion - retencion - multas);
    const batchCount = 1 + selectedCopyHouseIds.length;
    return { subtotal, multas, amortizacion, retencion, neto, batchCount, batchNeto: neto * batchCount };
  }, [catalog, advanceDrafts, houseEstimaciones, periodForm, selectedCopyHouseIds.length]);

  const summary = useMemo(() => {
    const totalContrato = catalog.reduce((acc, item) => acc + Number(item.importe || 0), 0) * Math.max(houses.length || 1, 1);
    const totalCasa = catalog.reduce((acc, item) => acc + Number(item.importe || 0), 0);
    const estimadoCasa = catalog.reduce((acc, concept) => {
      const row = houseEstimaciones.find((item) => item.conceptId === concept.id);
      const avance = Math.min(100, Math.max(0, Number(row?.avanceSolicitado || 0)));
      return acc + Number(concept.importe || 0) * (avance / 100);
    }, 0);
    const estimadoGlobal = estimaciones.reduce((acc, item) => acc + Number(item.importeSolicitado || 0), 0);
    const amortizacionCasa = Math.min(totalCasa * (Number(periodForm.anticipoPorcentaje || 0) / 100), estimadoCasa * (Number(periodForm.anticipoPorcentaje || 0) / 100));
    const retencionCasa = estimadoCasa * (Number(periodForm.retencionPorcentaje || 0) / 100);
    const multasCasa = houseEstimaciones.reduce((acc, item) => acc + Number(item.multa || 0), 0);
    const netoCasa = Math.max(0, estimadoCasa - amortizacionCasa - retencionCasa - multasCasa);
    const avanceGlobal = totalContrato ? (estimadoGlobal / totalContrato) * 100 : 0;
    const avanceCasa = totalCasa ? (estimadoCasa / totalCasa) * 100 : 0;
    return { totalContrato, totalCasa, estimadoCasa, estimadoGlobal, amortizacionCasa, retencionCasa, multasCasa, netoCasa, avanceGlobal, avanceCasa };
  }, [catalog, houses.length, houseEstimaciones, estimaciones, periodForm]);

  useEffect(() => {
    const handler = () => {
      setOpen(true);
      setActiveTab((previous) => previous || "captura");
    };
    window.addEventListener("triton-open-estimaciones", handler);
    window.addEventListener("triton-module-estimaciones", handler);
    return () => {
      window.removeEventListener("triton-open-estimaciones", handler);
      window.removeEventListener("triton-module-estimaciones", handler);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    loadData();
  }, [open, selectedObraId]);

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
      setSelectedCopyHouseIds((prev) => prev.filter((id) => nextHouses.some((house) => house.id === id)));

      const catalogSnap = await getDocs(query(collection(db, "obras", selectedObraId, "catalogoConceptos"), orderBy("partida", "asc")));
      const nextCatalog = catalogSnap.docs.map((item, index) => normalizeCatalogItem({ id: item.id, ...item.data() }, index));
      setCatalog(nextCatalog.length ? nextCatalog : conceptSeed.map(normalizeCatalogItem));

      const estimacionesSnap = await getDocs(collection(db, "obras", selectedObraId, "estimaciones"));
      setEstimaciones(estimacionesSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function seedCatalog() {
    for (const concept of conceptSeed.map(normalizeCatalogItem)) {
      await setDoc(doc(db, "obras", selectedObraId, "catalogoConceptos", concept.id), { ...concept, createdAt: serverTimestamp() }, { merge: true });
    }
    await loadData();
  }

  async function importCatalogFile(file) {
    if (!file) return;
    setImportingCatalog(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const imported = rowsToCatalog(rows, file.name);
      if (!imported.length) {
        alert("No pude leer conceptos válidos. Revisa que el CSV tenga columnas: PARTIDA, clave, descripcion, Unidades, unidad, P.U.");
        return;
      }
      for (const concept of imported) {
        await setDoc(doc(db, "obras", selectedObraId, "catalogoConceptos", concept.id), {
          ...concept,
          sourceFileName: file.name,
          importedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        }, { merge: true });
      }
      const total = imported.reduce((acc, item) => acc + Number(item.importe || 0), 0);
      const partidas = Array.from(new Set(imported.map((item) => item.partida))).length;
      setCatalogImportInfo({ rows: imported.length, total, partidas, fileName: file.name });
      alert(`Catálogo importado: ${imported.length} conceptos · ${money(total)} por unidad/casa.`);
      await loadData();
    } catch (error) {
      console.error(error);
      alert("Ocurrió un error al importar el catálogo.");
    } finally {
      setImportingCatalog(false);
    }
  }

  async function addManualConcept() {
    if (!manualConcept.clave.trim() || !manualConcept.concepto.trim()) {
      alert("Agrega clave y concepto.");
      return;
    }
    const item = normalizeCatalogItem(manualConcept, catalog.length);
    await setDoc(doc(db, "obras", selectedObraId, "catalogoConceptos", item.id), { ...item, createdAt: serverTimestamp() }, { merge: true });
    setManualConcept({ clave: "", partida: "", concepto: "", unidad: "", cantidad: "", precioUnitario: "", fechaEntrega: "" });
    await loadData();
  }

  function targetHouses() {
    const ids = Array.from(new Set([selectedHouseId, ...selectedCopyHouseIds])).filter(Boolean);
    return ids.map((id) => houses.find((house) => house.id === id)).filter(Boolean);
  }

  async function saveAdvance(concept) {
    const targets = targetHouses();
    if (!targets.length) return;
    const avance = Math.min(100, Math.max(0, parseNumber(advanceDrafts[concept.id] ?? draftPercent(concept))));
    const today = new Date();
    const entrega = concept.fechaEntrega ? new Date(concept.fechaEntrega) : null;
    const diasAtraso = entrega && today > entrega ? Math.ceil((today - entrega) / (1000 * 60 * 60 * 24)) : 0;
    const multa = diasAtraso * parseNumber(periodForm.multaDiaria);
    const importeSolicitado = Number(concept.importe || 0) * (avance / 100);

    for (const house of targets) {
      const id = `${house.id}-${concept.id}`;
      await setDoc(doc(db, "obras", selectedObraId, "estimaciones", id), {
        id,
        obraId: selectedObraId,
        houseId: house.id,
        houseName: house.name || house.id,
        conceptId: concept.id,
        clave: concept.clave,
        partida: concept.partida,
        concepto: concept.concepto,
        unidad: concept.unidad,
        cantidad: Number(concept.cantidad || 0),
        precioUnitario: Number(concept.precioUnitario || 0),
        importeConcepto: Number(concept.importe || 0),
        periodo: periodForm.periodo,
        avanceSolicitado: avance,
        importeSolicitado,
        status: "enviado_supervision",
        comentarioConstructora: commentDrafts[concept.id] || "",
        diasAtraso,
        multa,
        batchCopiedTo: targets.map((target) => target.id),
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      }, { merge: true });
    }

    setAdvanceDrafts((prev) => ({ ...prev, [concept.id]: "" }));
    setCommentDrafts((prev) => ({ ...prev, [concept.id]: "" }));
    await loadData();
  }

  async function savePartidaAdvance(partida, concepts) {
    const targets = targetHouses();
    if (!targets.length) return;
    for (const concept of concepts) {
      const draft = advanceDrafts[concept.id];
      if (draft === undefined || draft === "") continue;
      await saveAdvance(concept);
    }
    alert(`Avance de ${partida} enviado a supervisión para ${targets.length} casa(s).`);
  }

  async function reviewEstimate(item, approved) {
    const comment = window.prompt(approved ? "Comentario de aprobación" : "Motivo de rechazo", "") || "";
    await updateDoc(doc(db, "obras", selectedObraId, "estimaciones", item.id), {
      status: approved ? "aprobado_supervision" : "rechazado_supervision",
      comentarioSupervision: comment,
      reviewedAt: serverTimestamp(),
    });
    await loadData();
  }

  async function closeMonthlyEstimate() {
    const id = `${periodForm.periodo}-${selectedObraId}`;
    const approvedItems = estimaciones.filter((item) => item.periodo === periodForm.periodo && item.status === "aprobado_supervision");
    const subtotal = approvedItems.reduce((acc, item) => acc + Number(item.importeSolicitado || 0), 0);
    const multas = approvedItems.reduce((acc, item) => acc + Number(item.multa || 0), 0);
    const amortizacion = subtotal * (Number(periodForm.anticipoPorcentaje || 0) / 100);
    const retencion = subtotal * (Number(periodForm.retencionPorcentaje || 0) / 100);
    const neto = Math.max(0, subtotal - amortizacion - retencion - multas);
    await setDoc(doc(db, "obras", selectedObraId, "cierresEstimacion", id), {
      id,
      obraId: selectedObraId,
      periodo: periodForm.periodo,
      subtotal,
      amortizacion,
      retencion,
      multas,
      neto,
      status: "lista_administracion",
      itemCount: approvedItems.length,
      createdAt: serverTimestamp(),
    }, { merge: true });
    alert(`Estimación mensual lista para administración. Neto: ${money(neto)}`);
  }

  function toggleCopyHouse(houseId) {
    setSelectedCopyHouseIds((prev) => prev.includes(houseId) ? prev.filter((id) => id !== houseId) : [...prev, houseId]);
  }

  function togglePartida(partida) {
    setCollapsedPartidas((prev) => ({ ...prev, [partida]: !prev[partida] }));
  }

  const statusLabel = {
    enviado_supervision: "En supervisión",
    aprobado_supervision: "Aprobado",
    rechazado_supervision: "Rechazado",
    lista_administracion: "Lista administración",
  };

  return (
    <>
      {open ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483645, background: "#f5f5f7", overflow: "auto" }}>
          <div style={{ maxWidth: 1480, margin: "0 auto", padding: "calc(24px + env(safe-area-inset-top, 0px)) 18px 40px", paddingLeft: "clamp(96px, 12vw, 264px)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 34, fontWeight: 950, color: "#1d1d1f", letterSpacing: -0.7 }}>Estimaciones</div>
                <div style={{ color: "#6e6e73", fontSize: 16, marginTop: 6 }}>Catálogo de conceptos, avance por casa, aprobación de supervisión y cierre mensual para pago.</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>Volver a Calidad</button>
            </div>

            <Card title="Contexto de estimación" subtitle="Selecciona obra, casa base, casas a copiar y periodo de corte.">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
                <Field label="Obra"><select value={selectedObraId} onChange={(e) => { setSelectedObraId(e.target.value); setSelectedHouseId(""); setSelectedCopyHouseIds([]); }} style={inputBase}>{obras.length ? obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.name || obra.id}</option>) : <option value={defaultObraId}>Arenna</option>}</select></Field>
                <Field label="Casa / unidad base"><select value={selectedHouseId} onChange={(e) => setSelectedHouseId(e.target.value)} style={inputBase}>{houses.map((house) => <option key={house.id} value={house.id}>{house.name || house.id} · Bloque {house.block || "-"}</option>)}</select></Field>
                <Field label="Periodo"><input type="month" value={periodForm.periodo} onChange={(e) => setPeriodForm({ ...periodForm, periodo: e.target.value })} style={inputBase} /></Field>
                <Field label="Anticipo a amortizar %"><input type="number" value={periodForm.anticipoPorcentaje} onChange={(e) => setPeriodForm({ ...periodForm, anticipoPorcentaje: e.target.value })} style={inputBase} /></Field>
                <Field label="Retención %"><input type="number" value={periodForm.retencionPorcentaje} onChange={(e) => setPeriodForm({ ...periodForm, retencionPorcentaje: e.target.value })} style={inputBase} /></Field>
                <Field label="Multa diaria"><input type="number" value={periodForm.multaDiaria} onChange={(e) => setPeriodForm({ ...periodForm, multaDiaria: e.target.value })} style={inputBase} /></Field>
              </div>
              <div style={{ marginTop: 12, padding: 12, borderRadius: 18, background: "rgba(0,122,255,0.06)", border: "1px solid rgba(0,122,255,0.14)" }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: "#1d1d1f", marginBottom: 8 }}>Copiar esta misma captura a otras casas</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {houses.filter((house) => house.id !== selectedHouseId).map((house) => (
                    <button key={house.id} type="button" onClick={() => toggleCopyHouse(house.id)} style={{ ...buttonBase, background: selectedCopyHouseIds.includes(house.id) ? "#007aff" : "#fff", color: selectedCopyHouseIds.includes(house.id) ? "#fff" : "#1d1d1f" }}>
                      {selectedCopyHouseIds.includes(house.id) ? "✓ " : ""}{house.name || house.id}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 8, color: "#6e6e73", fontSize: 12 }}>Se enviará a supervisión para {captureSummary.batchCount} casa(s): la base y las seleccionadas.</div>
              </div>
            </Card>

            <div style={{ display: "flex", gap: 8, overflowX: "auto", margin: "14px 0" }}>
              {[["captura", "Captura constructora"], ["supervision", "Revisión supervisión"], ["cierre", "Cierre mensual"], ["catalogo", "Catálogo"]].map(([id, label]) => <button key={id} type="button" onClick={() => setActiveTab(id)} style={{ ...buttonBase, background: activeTab === id ? "#007aff" : "#fff", color: activeTab === id ? "#fff" : "#1d1d1f" }}>{label}</button>)}
            </div>

            {loading ? <div style={{ color: "#6e6e73", marginBottom: 12 }}>Cargando estimaciones...</div> : null}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 12, marginBottom: 16 }}>
              <Metric label="Contrato estimado" value={money(summary.totalContrato)} helper="Catálogo × unidades" />
              <Metric label="Avance global" value={`${summary.avanceGlobal.toFixed(1)}%`} helper={money(summary.estimadoGlobal)} />
              <Metric label="Avance casa" value={`${summary.avanceCasa.toFixed(1)}%`} helper={selectedHouse?.name || "Sin casa"} />
              <Metric label="Estimado casa" value={money(summary.estimadoCasa)} />
              <Metric label="Amortización" value={money(summary.amortizacionCasa)} helper={`${periodForm.anticipoPorcentaje}%`} />
              <Metric label="Neto casa" value={money(summary.netoCasa)} helper="Después de descuentos" />
            </div>

            {activeTab === "captura" ? (
              <>
                <div style={{ position: "sticky", top: 12, zIndex: 15, marginBottom: 14 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, padding: 12, borderRadius: 22, background: "rgba(255,255,255,0.92)", border: "1px solid rgba(60,60,67,0.12)", boxShadow: "0 12px 34px rgba(0,0,0,0.08)", backdropFilter: "blur(18px) saturate(180%)" }}>
                    <Metric label="Planeado a estimar" value={money(captureSummary.subtotal)} helper="Según % capturado" />
                    <Metric label="Amortización" value={money(captureSummary.amortizacion)} helper={`${periodForm.anticipoPorcentaje}%`} />
                    <Metric label="Retención" value={money(captureSummary.retencion)} helper={`${periodForm.retencionPorcentaje}%`} />
                    <Metric label="Multas" value={money(captureSummary.multas)} />
                    <Metric label="Neto planeado" value={money(captureSummary.neto)} helper="Una casa" />
                    <Metric label="Neto lote" value={money(captureSummary.batchNeto)} helper={`${captureSummary.batchCount} casa(s)`} />
                  </div>
                </div>

                <Card title="Avance por concepto" subtitle="Captura por partida. Cada bloque se puede minimizar para trabajar más rápido.">
                  {Object.entries(catalogByPartida).map(([partida, concepts]) => {
                    const partidaTotal = concepts.reduce((acc, concept) => acc + Number(concept.importe || 0), 0);
                    const partidaPlaneada = concepts.reduce((acc, concept) => acc + plannedAmount(concept), 0);
                    const collapsed = collapsedPartidas[partida];
                    return (
                      <div key={partida} style={{ border: "1px solid rgba(60,60,67,0.13)", borderRadius: 20, overflow: "hidden", background: "#fff", marginBottom: 14 }}>
                        <button type="button" onClick={() => togglePartida(partida)} style={{ width: "100%", border: 0, background: "rgba(242,242,247,0.78)", padding: 14, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", cursor: "pointer", textAlign: "left" }}>
                          <div>
                            <div style={{ fontWeight: 950, fontSize: 16, color: "#1d1d1f" }}>{collapsed ? "▸" : "▾"} {partida}</div>
                            <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 3 }}>{concepts.length} conceptos · Total partida {money(partidaTotal)}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontWeight: 950, color: "#007aff" }}>{money(partidaPlaneada)}</div>
                            <div style={{ color: "#6e6e73", fontSize: 12 }}>planeado</div>
                          </div>
                        </button>
                        {!collapsed ? (
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", minWidth: 1120, borderCollapse: "collapse" }}>
                              <thead>
                                <tr>
                                  <th style={{ ...tableHeaderCell, textAlign: "left", width: 115 }}>Clave</th>
                                  <th style={{ ...tableHeaderCell, textAlign: "left", minWidth: 300 }}>Concepto</th>
                                  <th style={{ ...tableHeaderCell, textAlign: "left", width: 85 }}>Unidad</th>
                                  <th style={{ ...tableHeaderCell, textAlign: "right", width: 95 }}>Unidades</th>
                                  <th style={{ ...tableHeaderCell, textAlign: "right", width: 130 }}>P.U.</th>
                                  <th style={{ ...tableHeaderCell, textAlign: "right", width: 135 }}>Total</th>
                                  <th style={{ ...tableHeaderCell, textAlign: "center", width: 110 }}>% avance</th>
                                  <th style={{ ...tableHeaderCell, textAlign: "right", width: 145 }}>A estimar</th>
                                  <th style={{ ...tableHeaderCell, textAlign: "left", width: 180 }}>Comentario</th>
                                  <th style={{ ...tableHeaderCell, textAlign: "left", width: 130 }}>Estado</th>
                                  <th style={{ ...tableHeaderCell, textAlign: "center", width: 130 }}>Enviar</th>
                                </tr>
                              </thead>
                              <tbody>
                                {concepts.map((concept) => {
                                  const current = currentRow(concept);
                                  const percent = draftPercent(concept);
                                  return (
                                    <tr key={concept.id}>
                                      <td style={{ ...tableCell, fontWeight: 900 }}>{concept.clave}</td>
                                      <td style={tableCell}>{concept.concepto}</td>
                                      <td style={tableCell}>{concept.unidad}</td>
                                      <td style={{ ...tableCell, textAlign: "right" }}>{Number(concept.cantidad || 0).toLocaleString("es-MX")}</td>
                                      <td style={{ ...tableCell, textAlign: "right" }}>{money(concept.precioUnitario)}</td>
                                      <td style={{ ...tableCell, textAlign: "right", fontWeight: 850 }}>{money(concept.importe)}</td>
                                      <td style={{ ...tableCell, textAlign: "center" }}><input type="number" min="0" max="100" placeholder={current ? `${current.avanceSolicitado}%` : "%"} value={advanceDrafts[concept.id] || ""} onChange={(e) => setAdvanceDrafts({ ...advanceDrafts, [concept.id]: e.target.value })} style={{ ...inputBase, width: 88, textAlign: "center" }} /></td>
                                      <td style={{ ...tableCell, textAlign: "right", fontWeight: 950, color: percent > 0 ? "#007aff" : "#6e6e73" }}>{money(plannedAmount(concept))}</td>
                                      <td style={tableCell}><input placeholder="Soporte" value={commentDrafts[concept.id] || ""} onChange={(e) => setCommentDrafts({ ...commentDrafts, [concept.id]: e.target.value })} style={{ ...inputBase, minHeight: 38, padding: "8px 10px" }} /></td>
                                      <td style={{ ...tableCell, color: current?.status === "rechazado_supervision" ? "#ff3b30" : "#1d1d1f", fontWeight: 850 }}>{statusLabel[current?.status] || "Sin enviar"}{current?.comentarioSupervision ? <div style={{ color: "#6e6e73", fontSize: 11, marginTop: 4 }}>Sup: {current.comentarioSupervision}</div> : null}</td>
                                      <td style={{ ...tableCell, textAlign: "center" }}><button type="button" onClick={() => saveAdvance(concept)} style={{ ...buttonBase, background: "#007aff", color: "#fff", padding: "8px 12px" }}>Enviar</button></td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: 12, background: "rgba(0,122,255,0.05)", borderTop: "1px solid rgba(60,60,67,0.10)", flexWrap: "wrap" }}>
                              <div style={{ fontWeight: 900, color: "#1d1d1f" }}>Subtotal partida: {money(partidaPlaneada)} / {money(partidaTotal)}</div>
                              <button type="button" onClick={() => savePartidaAdvance(partida, concepts)} style={{ ...buttonBase, background: "#1d1d1f", color: "#fff" }}>Enviar avances capturados de esta partida</button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </Card>
              </>
            ) : null}

            {activeTab === "supervision" ? (
              <Card title="Revisión de supervisión" subtitle="Supervisión valida por partida que los conceptos estén concluidos antes del cierre mensual.">
                {Object.keys(pendingReviewByPartida).length ? Object.entries(pendingReviewByPartida).map(([partida, items]) => {
                  const collapsed = collapsedPartidas[`rev-${partida}`];
                  const partidaSubtotal = items.reduce((acc, item) => acc + Number(item.importeSolicitado || 0), 0);
                  return (
                    <div key={partida} style={{ border: "1px solid rgba(60,60,67,0.13)", borderRadius: 20, overflow: "hidden", background: "#fff", marginBottom: 14 }}>
                      <button type="button" onClick={() => setCollapsedPartidas((prev) => ({ ...prev, [`rev-${partida}`]: !prev[`rev-${partida}`] }))} style={{ width: "100%", border: 0, background: "rgba(242,242,247,0.78)", padding: 14, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", cursor: "pointer", textAlign: "left" }}>
                        <div><div style={{ fontWeight: 950, fontSize: 16 }}>{collapsed ? "▸" : "▾"} {partida}</div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 3 }}>{items.length} renglones pendientes</div></div>
                        <div style={{ fontWeight: 950, color: "#007aff" }}>{money(partidaSubtotal)}</div>
                      </button>
                      {!collapsed ? (
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse" }}>
                            <thead><tr><th style={{ ...tableHeaderCell, textAlign: "left" }}>Casa</th><th style={{ ...tableHeaderCell, textAlign: "left" }}>Clave</th><th style={{ ...tableHeaderCell, textAlign: "left" }}>Concepto</th><th style={{ ...tableHeaderCell, textAlign: "right" }}>%</th><th style={{ ...tableHeaderCell, textAlign: "right" }}>Importe</th><th style={{ ...tableHeaderCell, textAlign: "right" }}>Multa</th><th style={{ ...tableHeaderCell, textAlign: "left" }}>Comentario</th><th style={{ ...tableHeaderCell, textAlign: "center" }}>Acción</th></tr></thead>
                            <tbody>{items.map((item) => <tr key={item.id}><td style={tableCell}>{item.houseName}</td><td style={{ ...tableCell, fontWeight: 900 }}>{item.clave}</td><td style={tableCell}>{item.concepto}</td><td style={{ ...tableCell, textAlign: "right" }}>{item.avanceSolicitado}%</td><td style={{ ...tableCell, textAlign: "right", fontWeight: 900 }}>{money(item.importeSolicitado)}</td><td style={{ ...tableCell, textAlign: "right" }}>{money(item.multa)}</td><td style={tableCell}>{item.comentarioConstructora || "Sin comentario"}</td><td style={{ ...tableCell, textAlign: "center" }}><div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}><button type="button" onClick={() => reviewEstimate(item, false)} style={{ ...buttonBase, background: "#ff3b30", color: "#fff", padding: "8px 12px" }}>Rechazar</button><button type="button" onClick={() => reviewEstimate(item, true)} style={{ ...buttonBase, background: "#34c759", color: "#fff", padding: "8px 12px" }}>Aprobar</button></div></td></tr>)}</tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  );
                }) : <div style={{ color: "#6e6e73" }}>No hay avances pendientes de supervisión.</div>}
              </Card>
            ) : null}

            {activeTab === "cierre" ? (
              <Card title="Cierre mensual" subtitle="Cuando supervisión aprueba los conceptos, se prepara la estimación para administración y programación de pago.">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                  <Metric label="Subtotal aprobado" value={money(estimaciones.filter((item) => item.periodo === periodForm.periodo && item.status === "aprobado_supervision").reduce((acc, item) => acc + Number(item.importeSolicitado || 0), 0))} />
                  <Metric label="Pendientes supervisión" value={estimaciones.filter((item) => item.status === "enviado_supervision").length} />
                  <Metric label="Rechazados" value={estimaciones.filter((item) => item.status === "rechazado_supervision").length} />
                </div>
                <button type="button" onClick={closeMonthlyEstimate} style={{ ...buttonBase, background: "#007aff", color: "#fff", marginTop: 16 }}>Cerrar estimación mensual</button>
              </Card>
            ) : null}

            {activeTab === "catalogo" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
                <Card title="Importar catálogo CSV" subtitle="Formato esperado: PARTIDA, clave, descripcion, Unidades, unidad, P.U. Las claves repetidas se conservan por renglón.">
                  <input type="file" accept=".csv,text/csv" onChange={(event) => importCatalogFile(event.target.files?.[0])} disabled={importingCatalog} style={{ marginBottom: 12 }} />
                  <div style={{ color: "#6e6e73", fontSize: 13, marginBottom: 12 }}>Este importador está ajustado al catálogo de prueba que compartiste. Calcula el importe como Unidades × P.U.</div>
                  {catalogImportInfo ? <div style={{ padding: 12, borderRadius: 14, background: "rgba(52,199,89,0.10)", color: "#157347", fontSize: 13, fontWeight: 850 }}>{catalogImportInfo.rows} conceptos importados · {catalogImportInfo.partidas} partidas · {money(catalogImportInfo.total)}</div> : null}
                  <button type="button" onClick={seedCatalog} style={{ ...buttonBase, background: "#fff", color: "#007aff", marginTop: 12 }}>Cargar catálogo demo</button>
                </Card>
                <Card title="Agregar concepto manual" subtitle="Usa esto para ajustes rápidos o conceptos extraordinarios.">
                  {[ ["clave", "Clave"], ["partida", "Partida"], ["concepto", "Concepto"], ["unidad", "Unidad"], ["cantidad", "Cantidad"], ["precioUnitario", "Precio unitario"], ["fechaEntrega", "Fecha oficial de entrega"] ].map(([key, label]) => <Field key={key} label={label}><input type={key === "fechaEntrega" ? "date" : key === "cantidad" || key === "precioUnitario" ? "number" : "text"} value={manualConcept[key]} onChange={(e) => setManualConcept({ ...manualConcept, [key]: e.target.value })} style={inputBase} /></Field>)}
                  <button type="button" onClick={addManualConcept} style={{ ...buttonBase, background: "#007aff", color: "#fff" }}>Guardar concepto</button>
                </Card>
                <Card title="Conceptos cargados" subtitle={`${catalog.length} conceptos activos`}>
                  {Object.entries(catalogByPartida).map(([partida, concepts]) => <div key={`cat-${partida}`} style={{ padding: 10, border: "1px solid rgba(60,60,67,0.12)", borderRadius: 14, marginBottom: 8, background: "#fff" }}><div style={{ fontWeight: 950 }}>{partida}</div><div style={{ color: "#6e6e73", fontSize: 12 }}>{concepts.length} conceptos · {money(concepts.reduce((acc, item) => acc + Number(item.importe || 0), 0))}</div></div>)}
                </Card>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
