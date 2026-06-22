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

const feedbackTypes = ["Mejora de interfaz", "Error o problema", "Proceso confuso", "Nueva función"];
const roleOptions = ["administracion", "direccion", "supervisora", "constructora", "postventa", "invitado"];
const moduleOptions = ["calidad", "checklist", "evidencias", "reportes", "configuracion", "usuarios", "obras"];

const inputBase = {
  width: "100%",
  border: "1px solid rgba(60,60,67,0.16)",
  borderRadius: 16,
  padding: "12px 14px",
  background: "#fff",
  color: "#1d1d1f",
  outline: "none",
  boxSizing: "border-box",
};

const pillButton = {
  border: "1px solid rgba(60,60,67,0.12)",
  borderRadius: 999,
  padding: "10px 13px",
  fontWeight: 850,
  fontSize: 13,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const panelButtonStyle = {
  position: "fixed",
  right: 16,
  bottom: "calc(88px + env(safe-area-inset-bottom, 0px))",
  zIndex: 2147483647,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 9,
  minHeight: 52,
  border: "2px solid rgba(255,255,255,0.9)",
  borderRadius: 999,
  padding: "13px 18px",
  background: "linear-gradient(180deg, #007aff 0%, #005ecb 100%)",
  color: "#fff",
  fontWeight: 900,
  fontSize: 15,
  cursor: "pointer",
  boxShadow: "0 18px 48px rgba(0, 122, 255, 0.42), 0 4px 14px rgba(0,0,0,0.18)",
};

const appMenuButtonStyle = {
  position: "fixed",
  left: 16,
  top: "calc(16px + env(safe-area-inset-top, 0px))",
  zIndex: 2147483646,
  width: 46,
  height: 46,
  border: "1px solid rgba(60,60,67,0.14)",
  borderRadius: 16,
  background: "rgba(255,255,255,0.92)",
  color: "#1d1d1f",
  fontSize: 22,
  fontWeight: 950,
  cursor: "pointer",
  boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
  WebkitBackdropFilter: "blur(18px)",
  backdropFilter: "blur(18px)",
};

function getCurrentContext() {
  if (typeof window === "undefined") return "Sin contexto";
  return `${window.location.pathname}${window.location.search || ""}`;
}

function slugify(text = "") {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getHouseProgress(house) {
  const partidas = house.partidas || [];
  if (!partidas.length) return 0;
  return partidas.reduce((acc, partida) => acc + (partida.status === "Aprobada" ? Number(partida.weight || 0) : 0), 0);
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 850, color: "#1d1d1f", marginBottom: 7 }}>{label}</div>
      {children}
    </label>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 22, padding: 16, background: "rgba(255,255,255,0.82)" }}>
      {title ? <div style={{ fontSize: 17, fontWeight: 950, color: "#1d1d1f" }}>{title}</div> : null}
      {subtitle ? <div style={{ marginTop: 4, color: "#6e6e73", fontSize: 13, lineHeight: 1.45 }}>{subtitle}</div> : null}
      {children ? <div style={{ marginTop: title || subtitle ? 14 : 0 }}>{children}</div> : null}
    </div>
  );
}

function Metric({ label, value, helper }) {
  return (
    <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 20, padding: 16, background: "#fff" }}>
      <div style={{ color: "#6e6e73", fontSize: 12, fontWeight: 800 }}>{label}</div>
      <div style={{ color: "#1d1d1f", fontSize: 28, fontWeight: 950, marginTop: 4 }}>{value}</div>
      {helper ? <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{helper}</div> : null}
    </div>
  );
}

function ModalShell({ title, subtitle, children, onClose }) {
  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2147483647, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "18px 18px calc(18px + env(safe-area-inset-bottom, 0px))", background: "rgba(29,29,31,0.38)", WebkitBackdropFilter: "blur(16px)", backdropFilter: "blur(16px)" }}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: "min(100%, 720px)", maxHeight: "82vh", border: "1px solid rgba(255,255,255,0.64)", borderRadius: 28, background: "rgba(255,255,255,0.96)", boxShadow: "0 24px 70px rgba(0,0,0,0.18)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid rgba(60,60,67,0.12)", display: "flex", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontSize: 23, fontWeight: 950, color: "#1d1d1f", letterSpacing: -0.5 }}>{title}</div>
            {subtitle ? <div style={{ marginTop: 4, color: "#6e6e73", fontSize: 14 }}>{subtitle}</div> : null}
          </div>
          <button type="button" onClick={onClose} style={{ border: "1px solid rgba(60,60,67,0.12)", background: "#f2f2f7", borderRadius: 999, width: 36, height: 36, fontWeight: 950, cursor: "pointer" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DrawerShell({ children, onClose }) {
  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(29,29,31,0.30)", WebkitBackdropFilter: "blur(8px)", backdropFilter: "blur(8px)" }}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: "min(100%, 360px)", height: "100%", background: "rgba(255,255,255,0.97)", borderRight: "1px solid rgba(60,60,67,0.12)", boxShadow: "20px 0 60px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}

function ModulePage({ title, subtitle, children, onBack }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2147483645, background: "#f5f5f7", overflow: "auto" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "calc(24px + env(safe-area-inset-top, 0px)) 18px 36px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
          <div style={{ paddingLeft: 54 }}>
            <div style={{ fontSize: 34, fontWeight: 950, color: "#1d1d1f", letterSpacing: -0.7, lineHeight: 1.05 }}>{title}</div>
            {subtitle ? <div style={{ color: "#6e6e73", fontSize: 16, marginTop: 7, lineHeight: 1.35 }}>{subtitle}</div> : null}
          </div>
          <button type="button" onClick={onBack} style={{ ...pillButton, background: "#fff", color: "#1d1d1f" }}>Volver a Calidad</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function FeedbackWidget() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelTab, setPanelTab] = useState("notificaciones");
  const [activeModule, setActiveModule] = useState("");
  const [type, setType] = useState(feedbackTypes[0]);
  const [message, setMessage] = useState("");
  const [savedState, setSavedState] = useState("");
  const [houses, setHouses] = useState([]);
  const [users, setUsers] = useState([]);
  const [loadingPanelData, setLoadingPanelData] = useState(false);
  const [userForm, setUserForm] = useState({ firstName: "", lastName: "", email: "", role: "constructora", obras: defaultObraId, modules: ["calidad", "checklist", "evidencias"] });
  const [obraForm, setObraForm] = useState({ name: "", code: "", location: "", totalUnits: "", status: "planeacion" });

  const feedbackText = useMemo(() => {
    const createdAt = new Date().toLocaleString("es-MX");
    return ["Feedback para mejorar Control de Calidad", `Tipo: ${type}`, `Fecha: ${createdAt}`, `Pantalla: ${getCurrentContext()}`, "", "Comentario:", message.trim() || "Sin comentario todavía"].join("\n");
  }, [type, message]);

  const reports = useMemo(() => {
    const partidas = houses.flatMap((house) => (house.partidas || []).map((partida) => ({ ...partida, houseName: house.name })));
    const approved = partidas.filter((partida) => partida.status === "Aprobada").length;
    const review = partidas.filter((partida) => partida.status === "Lista para revisión").length;
    const rejected = partidas.filter((partida) => partida.status === "Rechazada").length;
    const evidencePending = partidas.filter((partida) => (partida.checklist || []).some((item) => !item.photos || item.photos.length === 0)).length;
    const avgProgress = houses.length ? Math.round(houses.reduce((acc, house) => acc + getHouseProgress(house), 0) / houses.length) : 0;
    const riskPartidas = partidas.filter((partida) => partida.status === "Rechazada" || partida.status === "Lista para revisión").slice(0, 18);
    return { approved, review, rejected, evidencePending, avgProgress, riskPartidas };
  }, [houses]);

  useEffect(() => {
    if (!activeModule) return;
    loadPanelData();
  }, [activeModule]);

  async function loadPanelData() {
    setLoadingPanelData(true);
    try {
      const housesSnap = await getDocs(query(collection(db, "obras", defaultObraId, "casas"), orderBy("number", "asc")));
      const nextHouses = await Promise.all(
        housesSnap.docs.map(async (houseDoc) => {
          const partidasSnap = await getDocs(query(collection(db, "obras", defaultObraId, "casas", houseDoc.id, "partidas"), orderBy("weight", "asc")));
          return { id: houseDoc.id, ...houseDoc.data(), partidas: partidasSnap.docs.map((partidaDoc) => ({ id: partidaDoc.id, ...partidaDoc.data() })) };
        })
      );
      setHouses(nextHouses);
      const usersSnap = await getDocs(collection(db, "users"));
      setUsers(usersSnap.docs.map((userDoc) => ({ id: userDoc.id, ...userDoc.data() })));
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingPanelData(false);
    }
  }

  function openModule(moduleId) {
    setActiveModule(moduleId);
    setMenuOpen(false);
  }

  async function copyFeedback() {
    if (!message.trim()) return;
    try {
      await navigator.clipboard.writeText(feedbackText);
      setSavedState("Copiado");
      setTimeout(() => setSavedState(""), 1800);
    } catch (error) {
      console.error(error);
      window.prompt("Copia este feedback:", feedbackText);
    }
  }

  function saveFeedback() {
    if (!message.trim()) return;
    const nextFeedback = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, message: message.trim(), context: getCurrentContext(), createdAt: new Date().toISOString() };
    const previous = JSON.parse(localStorage.getItem("triton_feedback") || "[]");
    localStorage.setItem("triton_feedback", JSON.stringify([nextFeedback, ...previous].slice(0, 50)));
    setSavedState("Guardado");
    setTimeout(() => setSavedState(""), 1800);
    setMessage("");
  }

  async function saveUserInvite() {
    if (!userForm.email.trim() || !userForm.firstName.trim()) {
      alert("Agrega nombre y correo del usuario.");
      return;
    }
    const id = slugify(userForm.email.trim());
    const obras = userForm.obras.split(",").map((item) => slugify(item.trim())).filter(Boolean);
    await setDoc(doc(db, "userInvites", id), { ...userForm, email: userForm.email.trim().toLowerCase(), displayName: `${userForm.firstName.trim()} ${userForm.lastName.trim()}`.trim(), obras, status: "pendiente_alta_auth", createdAt: serverTimestamp() }, { merge: true });
    alert("Usuario preparado. Falta crear su acceso Auth desde Firebase o Cloud Function admin.");
    setUserForm({ firstName: "", lastName: "", email: "", role: "constructora", obras: defaultObraId, modules: ["calidad", "checklist", "evidencias"] });
  }

  async function saveObra() {
    if (!obraForm.name.trim()) {
      alert("Agrega el nombre de la obra.");
      return;
    }
    const id = slugify(obraForm.code || obraForm.name);
    await setDoc(doc(db, "obras", id), { id, name: obraForm.name.trim(), code: obraForm.code.trim() || id, location: obraForm.location.trim(), totalUnits: Number(obraForm.totalUnits || 0), status: obraForm.status, createdAt: serverTimestamp() }, { merge: true });
    alert("Obra guardada en configuración.");
    setObraForm({ name: "", code: "", location: "", totalUnits: "", status: "planeacion" });
  }

  function toggleModule(moduleName) {
    setUserForm((prev) => ({ ...prev, modules: prev.modules.includes(moduleName) ? prev.modules.filter((item) => item !== moduleName) : [...prev.modules, moduleName] }));
  }

  const storedFeedback = JSON.parse(localStorage.getItem("triton_feedback") || "[]");
  const notifications = JSON.parse(localStorage.getItem("triton_notifications") || "[]");

  return (
    <>
      <button type="button" onClick={() => setMenuOpen(true)} aria-label="Abrir menú" style={appMenuButtonStyle}>☰</button>
      <button type="button" onClick={() => setPanelOpen(true)} aria-label="Abrir panel" style={panelButtonStyle}>● Panel</button>

      {panelOpen ? (
        <ModalShell title="Panel" subtitle="Notificaciones y feedback del sistema." onClose={() => setPanelOpen(false)}>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "12px 16px", borderBottom: "1px solid rgba(60,60,67,0.10)" }}>
            {[["notificaciones", "Notificaciones"], ["feedback", "Feedback"]].map(([id, label]) => <button key={id} type="button" onClick={() => setPanelTab(id)} style={{ ...pillButton, background: panelTab === id ? "#007aff" : "#fff", color: panelTab === id ? "#fff" : "#1d1d1f", borderColor: panelTab === id ? "#007aff" : "rgba(60,60,67,0.12)" }}>{label}</button>)}
          </div>
          <div style={{ overflow: "auto", padding: 18 }}>
            {panelTab === "notificaciones" ? <Card title="Centro de notificaciones" subtitle="Aquí aparecerán menciones con @nombre, observaciones, partidas rechazadas y tareas pendientes.">{notifications.length ? notifications.map((item) => <div key={item.id} style={{ padding: 12, border: "1px solid rgba(60,60,67,0.12)", borderRadius: 16, background: "#fff", marginBottom: 8 }}><div style={{ fontWeight: 900 }}>{item.title || "Notificación"}</div><div style={{ color: "#6e6e73", fontSize: 13, marginTop: 4 }}>{item.message}</div></div>) : <div style={{ color: "#6e6e73", fontSize: 14 }}>Sin notificaciones nuevas. Siguiente paso: conectar menciones reales desde comentarios.</div>}</Card> : null}
            {panelTab === "feedback" ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}><Card title="Generar feedback" subtitle="Registra ideas, errores o mejoras para el sistema."><Field label="Tipo de feedback"><select value={type} onChange={(event) => setType(event.target.value)} style={inputBase}>{feedbackTypes.map((option) => <option key={option} value={option}>{option}</option>)}</select></Field><Field label="¿Qué debería mejorar?"><textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={5} placeholder="Ej. En checklist debería verse primero lo pendiente..." style={{ ...inputBase, minHeight: 128, resize: "vertical" }} /></Field><div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}><button type="button" onClick={copyFeedback} disabled={!message.trim()} style={{ ...pillButton, background: "#fff", color: message.trim() ? "#007aff" : "#8e8e93" }}>{savedState === "Copiado" ? "Copiado" : "Copiar"}</button><button type="button" onClick={saveFeedback} disabled={!message.trim()} style={{ ...pillButton, background: message.trim() ? "#007aff" : "#e5e5ea", color: message.trim() ? "#fff" : "#8e8e93" }}>{savedState === "Guardado" ? "Guardado" : "Guardar"}</button></div></Card><Card title="Feedback guardado" subtitle="Últimos comentarios en este navegador.">{storedFeedback.length ? storedFeedback.slice(0, 6).map((item) => <div key={item.id} style={{ padding: 12, borderRadius: 16, background: "#fff", border: "1px solid rgba(60,60,67,0.12)", marginBottom: 8 }}><div style={{ fontWeight: 900 }}>{item.type}</div><div style={{ fontSize: 13, color: "#6e6e73", marginTop: 4 }}>{item.message}</div></div>) : <div style={{ color: "#6e6e73", fontSize: 14 }}>Todavía no hay feedback guardado.</div>}</Card></div> : null}
          </div>
        </ModalShell>
      ) : null}

      {menuOpen ? (
        <DrawerShell onClose={() => setMenuOpen(false)}>
          <div style={{ padding: "calc(18px + env(safe-area-inset-top, 0px)) 18px 16px", borderBottom: "1px solid rgba(60,60,67,0.12)", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div><div style={{ fontSize: 24, fontWeight: 950, color: "#1d1d1f", letterSpacing: -0.5 }}>Menú</div><div style={{ color: "#6e6e73", fontSize: 13, marginTop: 3 }}>Módulos del sistema</div></div>
            <button type="button" onClick={() => setMenuOpen(false)} style={{ border: "1px solid rgba(60,60,67,0.12)", background: "#f2f2f7", borderRadius: 999, width: 36, height: 36, fontWeight: 950, cursor: "pointer" }}>×</button>
          </div>
          <div style={{ padding: 14, display: "grid", gap: 8 }}>
            {[["reportes", "Reportes", "Dashboard y métricas"], ["administracion", "Administración", "Usuarios, roles y permisos"], ["obras", "Obras", "Alta y configuración de obras"]].map(([id, label, helper]) => <button key={id} type="button" onClick={() => openModule(id)} style={{ textAlign: "left", border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, padding: 14, background: "#fff", color: "#1d1d1f", cursor: "pointer" }}><div style={{ fontWeight: 950, fontSize: 15 }}>{label}</div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 3 }}>{helper}</div></button>)}
          </div>
        </DrawerShell>
      ) : null}

      {activeModule === "reportes" ? (
        <ModulePage title="Reportes" subtitle="Dashboard ejecutivo de avance, revisión, evidencias y problemáticas por obra." onBack={() => setActiveModule("")}>
          {loadingPanelData ? <div style={{ color: "#6e6e73", marginBottom: 14 }}>Actualizando información...</div> : null}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 18 }}>
            <Metric label="Avance general" value={`${reports.avgProgress}%`} helper="Promedio por vivienda" />
            <Metric label="Partidas aprobadas" value={reports.approved} />
            <Metric label="En revisión" value={reports.review} />
            <Metric label="Rechazadas" value={reports.rejected} />
            <Metric label="Riesgo evidencia" value={reports.evidencePending} helper="Partidas con fotos faltantes" />
          </div>
          <Card title="Problemáticas activas" subtitle="Partidas rechazadas o esperando revisión que requieren seguimiento.">{reports.riskPartidas.length ? reports.riskPartidas.map((partida) => <div key={`${partida.houseName}-${partida.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 14, border: "1px solid rgba(60,60,67,0.12)", borderRadius: 16, background: "#fff", marginBottom: 10 }}><div><div style={{ fontWeight: 900 }}>{partida.houseName} · {partida.name}</div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 3 }}>Fotos {partida.evidenceCount?.photos || 0} · Videos {partida.evidenceCount?.videos || 0}</div></div><div style={{ color: partida.status === "Rechazada" ? "#ff3b30" : "#9a6700", fontWeight: 900, fontSize: 12 }}>{partida.status}</div></div>) : <div style={{ color: "#6e6e73", fontSize: 14 }}>No hay partidas críticas detectadas.</div>}</Card>
        </ModulePage>
      ) : null}

      {activeModule === "administracion" ? (
        <ModulePage title="Administración" subtitle="Gestión de usuarios, roles, permisos, obras y módulos del sistema." onBack={() => setActiveModule("")}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            <Card title="Alta de usuarios" subtitle="Prepara usuarios con rol, módulos y acceso a obras. El alta real de contraseña requiere Firebase Auth Admin/Cloud Function."><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><Field label="Nombre"><input value={userForm.firstName} onChange={(event) => setUserForm({ ...userForm, firstName: event.target.value })} style={inputBase} /></Field><Field label="Apellido"><input value={userForm.lastName} onChange={(event) => setUserForm({ ...userForm, lastName: event.target.value })} style={inputBase} /></Field></div><Field label="Correo"><input type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} placeholder="correo@empresa.com" style={inputBase} /></Field><Field label="Rol"><select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })} style={inputBase}>{roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}</select></Field><Field label="Obras permitidas"><input value={userForm.obras} onChange={(event) => setUserForm({ ...userForm, obras: event.target.value })} style={inputBase} /></Field><div style={{ marginBottom: 14 }}><div style={{ fontSize: 13, fontWeight: 850, marginBottom: 8 }}>Módulos</div><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{moduleOptions.map((moduleName) => <button key={moduleName} type="button" onClick={() => toggleModule(moduleName)} style={{ ...pillButton, background: userForm.modules.includes(moduleName) ? "#007aff" : "#fff", color: userForm.modules.includes(moduleName) ? "#fff" : "#1d1d1f" }}>{moduleName}</button>)}</div></div><button type="button" onClick={saveUserInvite} style={{ ...pillButton, background: "#007aff", color: "#fff", width: "100%" }}>Guardar usuario</button></Card>
            <Card title="Usuarios actuales" subtitle="Perfiles encontrados en Firestore.">{loadingPanelData ? <div style={{ color: "#6e6e73" }}>Cargando usuarios...</div> : users.length ? users.slice(0, 20).map((user) => <div key={user.id} style={{ padding: 12, borderRadius: 16, background: "#fff", border: "1px solid rgba(60,60,67,0.12)", marginBottom: 8 }}><div style={{ fontWeight: 900 }}>{user.name || user.displayName || user.email || user.id}</div><div style={{ color: "#6e6e73", fontSize: 13, marginTop: 3 }}>{user.role || "sin rol"}</div></div>) : <div style={{ color: "#6e6e73", fontSize: 14 }}>No se encontraron perfiles cargados.</div>}</Card>
          </div>
        </ModulePage>
      ) : null}

      {activeModule === "obras" ? (
        <ModulePage title="Obras" subtitle="Alta y configuración de obras nuevas para operar el sistema multiobra." onBack={() => setActiveModule("")}>
          <Card title="Configuración de obras" subtitle="Carga obras nuevas para preparar el sistema multiobra."><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}><Field label="Nombre de obra"><input value={obraForm.name} onChange={(event) => setObraForm({ ...obraForm, name: event.target.value })} placeholder="Ej. Residente" style={inputBase} /></Field><Field label="Código"><input value={obraForm.code} onChange={(event) => setObraForm({ ...obraForm, code: event.target.value })} placeholder="residente" style={inputBase} /></Field><Field label="Ubicación"><input value={obraForm.location} onChange={(event) => setObraForm({ ...obraForm, location: event.target.value })} placeholder="Montecristo, Mérida" style={inputBase} /></Field><Field label="Unidades"><input type="number" value={obraForm.totalUnits} onChange={(event) => setObraForm({ ...obraForm, totalUnits: event.target.value })} style={inputBase} /></Field><Field label="Estatus"><select value={obraForm.status} onChange={(event) => setObraForm({ ...obraForm, status: event.target.value })} style={inputBase}><option value="planeacion">Planeación</option><option value="activa">Activa</option><option value="pausada">Pausada</option><option value="cerrada">Cerrada</option></select></Field></div><button type="button" onClick={saveObra} style={{ ...pillButton, background: "#007aff", color: "#fff", marginTop: 4 }}>Guardar obra</button></Card>
        </ModulePage>
      ) : null}
    </>
  );
}
