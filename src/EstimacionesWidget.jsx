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

const launcherStyle = {
  position: "fixed",
  left: 16,
  top: "calc(76px + env(safe-area-inset-top, 0px))",
  zIndex: 2147483644,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  minHeight: 46,
  border: "1px solid rgba(60,60,67,0.14)",
  borderRadius: 16,
  padding: "10px 13px",
  background: "rgba(255,255,255,0.94)",
  color: "#1d1d1f",
  fontWeight: 950,
  cursor: "pointer",
  boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
  WebkitBackdropFilter: "blur(18px)",
  backdropFilter: "blur(18px)",
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
  const parsed = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCatalogItem(item, index = 0) {
  const cantidad = parseNumber(item.cantidad ?? item.cantidadContratada ?? 1);
  const precioUnitario = parseNumber(item.precioUnitario ?? item.precio_unitario ?? item.pu ?? 0);
  return {
    id: item.id || item.clave || `concepto-${index + 1}`,
    clave: item.clave || item.id || `CON-${index + 1}`,
    partida: item.partida || item.capitulo || "General",
    concepto: item.concepto || item.descripcion || item.description || "Concepto sin nombre",
    unidad: item.unidad || "lote",
    cantidad,
    precioUnitario,
    importe: cantidad * precioUnitario,
    fechaEntrega: item.fechaEntrega || item.fecha_entrega || "",
  };
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

export default function EstimacionesWidget() {
  const [open, setOpen] = useState(false);
  const [obras, setObras] = useState([]);
  const [houses, setHouses] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [estimaciones, setEstimaciones] = useState([]);
  const [selectedObraId, setSelectedObraId] = useState(defaultObraId);
  const [selectedHouseId, setSelectedHouseId] = useState("");
  const [activeTab, setActiveTab] = useState("captura");
  const [loading, setLoading] = useState(false);
  const [advanceDrafts, setAdvanceDrafts] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [periodForm, setPeriodForm] = useState({ periodo: new Date().toISOString().slice(0, 7), anticipoPorcentaje: 30, multaDiaria: 0, retencionPorcentaje: 0 });
  const [manualConcept, setManualConcept] = useState({ clave: "", partida: "", concepto: "", unidad: "", cantidad: "", precioUnitario: "", fechaEntrega: "" });

  const selectedHouse = houses.find((house) => house.id === selectedHouseId) || null;

  const houseEstimaciones = useMemo(() => estimaciones.filter((item) => item.houseId === selectedHouseId), [estimaciones, selectedHouseId]);

  const summary = useMemo(() => {
    const totalContrato = catalog.reduce((acc, item) => acc + Number(item.importe || 0), 0) * Math.max(houses.length || 1, 1);
    const totalCasa = catalog.reduce((acc, item) => acc + Number(item.importe || 0), 0);
    const estimadoCasa = catalog.reduce((acc, concept) => {
      const row = houseEstimaciones.find((item) => item.conceptId === concept.id);
      const avance = Math.min(100, Math.max(0, Number(row?.avanceSolicitado || 0)));
      return acc + Number(concept.importe || 0) * (avance / 100);
    }, 0);
    const estimadoGlobal = estimaciones.reduce((acc, item) => acc + Number(item.importeSolicitado || 0), 0);
    const anticipoCasa = totalCasa * (Number(periodForm.anticipoPorcentaje || 0) / 100);
    const amortizacionCasa = Math.min(anticipoCasa, estimadoCasa * (Number(periodForm.anticipoPorcentaje || 0) / 100));
    const retencionCasa = estimadoCasa * (Number(periodForm.retencionPorcentaje || 0) / 100);
    const multasCasa = houseEstimaciones.reduce((acc, item) => acc + Number(item.multa || 0), 0);
    const netoCasa = Math.max(0, estimadoCasa - amortizacionCasa - retencionCasa - multasCasa);
    const avanceGlobal = totalContrato ? (estimadoGlobal / totalContrato) * 100 : 0;
    const avanceCasa = totalCasa ? (estimadoCasa / totalCasa) * 100 : 0;
    return { totalContrato, totalCasa, estimadoCasa, estimadoGlobal, anticipoCasa, amortizacionCasa, retencionCasa, multasCasa, netoCasa, avanceGlobal, avanceCasa };
  }, [catalog, houses.length, houseEstimaciones, estimaciones, periodForm]);

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

  async function saveAdvance(concept) {
    if (!selectedHouse) return;
    const draftValue = advanceDrafts[concept.id] ?? "";
    const avance = Math.min(100, Math.max(0, parseNumber(draftValue)));
    const today = new Date();
    const entrega = concept.fechaEntrega ? new Date(concept.fechaEntrega) : null;
    const diasAtraso = entrega && today > entrega ? Math.ceil((today - entrega) / (1000 * 60 * 60 * 24)) : 0;
    const multa = diasAtraso * parseNumber(periodForm.multaDiaria);
    const importeSolicitado = Number(concept.importe || 0) * (avance / 100);
    const id = `${selectedHouse.id}-${concept.id}`;
    const payload = {
      id,
      obraId: selectedObraId,
      houseId: selectedHouse.id,
      houseName: selectedHouse.name || selectedHouse.id,
      conceptId: concept.id,
      clave: concept.clave,
      partida: concept.partida,
      concepto: concept.concepto,
      periodo: periodForm.periodo,
      avanceSolicitado: avance,
      importeSolicitado,
      status: "enviado_supervision",
      comentarioConstructora: commentDrafts[concept.id] || "",
      diasAtraso,
      multa,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };
    await setDoc(doc(db, "obras", selectedObraId, "estimaciones", id), payload, { merge: true });
    setAdvanceDrafts((prev) => ({ ...prev, [concept.id]: "" }));
    setCommentDrafts((prev) => ({ ...prev, [concept.id]: "" }));
    await loadData();
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

  const statusLabel = {
    enviado_supervision: "En supervisión",
    aprobado_supervision: "Aprobado",
    rechazado_supervision: "Rechazado",
    lista_administracion: "Lista administración",
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={launcherStyle}>Σ Estimaciones</button>
      {open ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483645, background: "#f5f5f7", overflow: "auto" }}>
          <div style={{ maxWidth: 1240, margin: "0 auto", padding: "calc(24px + env(safe-area-inset-top, 0px)) 18px 40px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap" }}>
              <div style={{ paddingLeft: 54 }}>
                <div style={{ fontSize: 34, fontWeight: 950, color: "#1d1d1f", letterSpacing: -0.7 }}>Estimaciones</div>
                <div style={{ color: "#6e6e73", fontSize: 16, marginTop: 6 }}>Catálogo de conceptos, avance por casa, aprobación de supervisión y cierre mensual para pago.</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>Volver a Calidad</button>
            </div>

            <Card title="Contexto de estimación" subtitle="Selecciona obra, casa y periodo de corte.">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
                <Field label="Obra"><select value={selectedObraId} onChange={(e) => { setSelectedObraId(e.target.value); setSelectedHouseId(""); }} style={inputBase}>{obras.length ? obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.name || obra.id}</option>) : <option value={defaultObraId}>Arenna</option>}</select></Field>
                <Field label="Casa / unidad"><select value={selectedHouseId} onChange={(e) => setSelectedHouseId(e.target.value)} style={inputBase}>{houses.map((house) => <option key={house.id} value={house.id}>{house.name || house.id} · Bloque {house.block || "-"}</option>)}</select></Field>
                <Field label="Periodo"><input type="month" value={periodForm.periodo} onChange={(e) => setPeriodForm({ ...periodForm, periodo: e.target.value })} style={inputBase} /></Field>
                <Field label="Anticipo a amortizar %"><input type="number" value={periodForm.anticipoPorcentaje} onChange={(e) => setPeriodForm({ ...periodForm, anticipoPorcentaje: e.target.value })} style={inputBase} /></Field>
                <Field label="Retención %"><input type="number" value={periodForm.retencionPorcentaje} onChange={(e) => setPeriodForm({ ...periodForm, retencionPorcentaje: e.target.value })} style={inputBase} /></Field>
                <Field label="Multa diaria"><input type="number" value={periodForm.multaDiaria} onChange={(e) => setPeriodForm({ ...periodForm, multaDiaria: e.target.value })} style={inputBase} /></Field>
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
              <Card title="Avance por concepto" subtitle="La constructora captura el avance por casa. Supervisión aprueba o rechaza cada renglón.">
                {catalog.map((concept) => {
                  const current = houseEstimaciones.find((item) => item.conceptId === concept.id);
                  return <div key={concept.id} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, padding: 14, background: "#fff", marginBottom: 10 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) 110px 110px 160px", gap: 12, alignItems: "center" }}>
                      <div><div style={{ fontWeight: 950 }}>{concept.clave} · {concept.concepto}</div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{concept.partida} · {concept.unidad} · {money(concept.importe)}</div></div>
                      <input type="number" min="0" max="100" placeholder={current ? `${current.avanceSolicitado}%` : "% avance"} value={advanceDrafts[concept.id] || ""} onChange={(e) => setAdvanceDrafts({ ...advanceDrafts, [concept.id]: e.target.value })} style={inputBase} />
                      <div style={{ fontSize: 12, fontWeight: 850, color: current?.status === "rechazado_supervision" ? "#ff3b30" : "#1d1d1f" }}>{statusLabel[current?.status] || "Sin enviar"}</div>
                      <button type="button" onClick={() => saveAdvance(concept)} style={{ ...buttonBase, background: "#007aff", color: "#fff" }}>Enviar avance</button>
                    </div>
                    <textarea placeholder="Comentario de constructora / soporte del avance" value={commentDrafts[concept.id] || ""} onChange={(e) => setCommentDrafts({ ...commentDrafts, [concept.id]: e.target.value })} style={{ ...inputBase, marginTop: 10, resize: "vertical" }} />
                    {current?.comentarioSupervision ? <div style={{ marginTop: 8, color: "#6e6e73", fontSize: 12 }}>Supervisión: {current.comentarioSupervision}</div> : null}
                  </div>;
                })}
              </Card>
            ) : null}

            {activeTab === "supervision" ? (
              <Card title="Revisión de supervisión" subtitle="Supervisión valida que los conceptos efectivamente estén concluidos antes del cierre mensual.">
                {estimaciones.filter((item) => item.status === "enviado_supervision").length ? estimaciones.filter((item) => item.status === "enviado_supervision").map((item) => <div key={item.id} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, padding: 14, background: "#fff", marginBottom: 10 }}><div style={{ fontWeight: 950 }}>{item.houseName} · {item.clave} · {item.concepto}</div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>Avance {item.avanceSolicitado}% · {money(item.importeSolicitado)} · Multa {money(item.multa)}</div><div style={{ marginTop: 8, color: "#1d1d1f", fontSize: 13 }}>Constructora: {item.comentarioConstructora || "Sin comentario"}</div><div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}><button type="button" onClick={() => reviewEstimate(item, false)} style={{ ...buttonBase, background: "#ff3b30", color: "#fff" }}>Rechazar</button><button type="button" onClick={() => reviewEstimate(item, true)} style={{ ...buttonBase, background: "#34c759", color: "#fff" }}>Aprobar</button></div></div>) : <div style={{ color: "#6e6e73" }}>No hay avances pendientes de revisión.</div>}
              </Card>
            ) : null}

            {activeTab === "cierre" ? (
              <Card title="Cierre mensual para administración" subtitle="Al cierre de mes, genera la estimación aprobada con amortización, retenciones, multas y neto a pagar.">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
                  <Metric label="Aprobado del periodo" value={money(estimaciones.filter((item) => item.periodo === periodForm.periodo && item.status === "aprobado_supervision").reduce((acc, item) => acc + Number(item.importeSolicitado || 0), 0))} />
                  <Metric label="Pendiente revisión" value={estimaciones.filter((item) => item.periodo === periodForm.periodo && item.status === "enviado_supervision").length} />
                  <Metric label="Rechazados" value={estimaciones.filter((item) => item.periodo === periodForm.periodo && item.status === "rechazado_supervision").length} />
                </div>
                <button type="button" onClick={closeMonthlyEstimate} style={{ ...buttonBase, background: "#1d1d1f", color: "#fff" }}>Cerrar estimación y enviar a administración</button>
              </Card>
            ) : null}

            {activeTab === "catalogo" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
                <Card title="Catálogo de conceptos" subtitle="Puedes sembrar una base o capturar conceptos. La carga real desde Excel se conecta en el alta de obra.">
                  <button type="button" onClick={seedCatalog} style={{ ...buttonBase, background: "#007aff", color: "#fff", marginBottom: 12 }}>Cargar catálogo base demo</button>
                  {catalog.map((item) => <div key={item.id} style={{ padding: 10, border: "1px solid rgba(60,60,67,0.12)", borderRadius: 14, background: "#fff", marginBottom: 8 }}><div style={{ fontWeight: 900 }}>{item.clave} · {item.concepto}</div><div style={{ color: "#6e6e73", fontSize: 12 }}>{item.partida} · {item.cantidad} {item.unidad} · {money(item.precioUnitario)} PU · {money(item.importe)}</div></div>)}
                </Card>
                <Card title="Agregar concepto manual" subtitle="Estructura esperada del Excel: clave, partida, concepto, unidad, cantidad, precio unitario, fecha entrega.">
                  <Field label="Clave"><input value={manualConcept.clave} onChange={(e) => setManualConcept({ ...manualConcept, clave: e.target.value })} style={inputBase} /></Field>
                  <Field label="Partida"><input value={manualConcept.partida} onChange={(e) => setManualConcept({ ...manualConcept, partida: e.target.value })} style={inputBase} /></Field>
                  <Field label="Concepto"><textarea value={manualConcept.concepto} onChange={(e) => setManualConcept({ ...manualConcept, concepto: e.target.value })} style={{ ...inputBase, resize: "vertical" }} /></Field>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><Field label="Cantidad"><input type="number" value={manualConcept.cantidad} onChange={(e) => setManualConcept({ ...manualConcept, cantidad: e.target.value })} style={inputBase} /></Field><Field label="Precio unitario"><input type="number" value={manualConcept.precioUnitario} onChange={(e) => setManualConcept({ ...manualConcept, precioUnitario: e.target.value })} style={inputBase} /></Field></div>
                  <Field label="Unidad"><input value={manualConcept.unidad} onChange={(e) => setManualConcept({ ...manualConcept, unidad: e.target.value })} style={inputBase} /></Field>
                  <Field label="Fecha entrega oficial"><input type="date" value={manualConcept.fechaEntrega} onChange={(e) => setManualConcept({ ...manualConcept, fechaEntrega: e.target.value })} style={inputBase} /></Field>
                  <button type="button" onClick={addManualConcept} style={{ ...buttonBase, background: "#007aff", color: "#fff" }}>Agregar concepto</button>
                </Card>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
