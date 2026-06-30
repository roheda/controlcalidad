import React, { useEffect, useMemo, useRef, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBzk_jZfpv4j7PxroeTISwx11LffEB3TWQ",
  authDomain: "control-de-calidad-triton.firebaseapp.com",
  projectId: "control-de-calidad-triton",
  storageBucket: "control-de-calidad-triton.firebasestorage.app",
  messagingSenderId: "41329486719",
  appId: "1:41329486719:web:1bf7ff827d3b60227f084a",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const defaultObraId = "";

const sampleMentionUsers = [
  { id: "demo-constructora", uid: "demo-constructora", name: "Constructora ABC", role: "constructora", email: "constructora@triton.local", mentionHandle: "constructoraabc", isSample: true },
  { id: "demo-residente", uid: "demo-residente", name: "Juan Residente", role: "residente", email: "residente@triton.local", mentionHandle: "juanresidente", isSample: true },
  { id: "demo-supervision", uid: "demo-supervision", name: "María Supervisión", role: "supervisora", email: "supervision@triton.local", mentionHandle: "mariasupervision", isSample: true },
  { id: "demo-admin", uid: "demo-admin", name: "Administración Triton", role: "admin", email: "admin@triton.local", mentionHandle: "admintriton", isSample: true },
];


const partidaTemplates = [
  { id: "preliminares", name: "Preliminares", weight: 5 },
  { id: "excavacion", name: "Excavación", weight: 5 },
  { id: "cimentacion", name: "Cimentación", weight: 10 },
  { id: "colado", name: "Colado", weight: 5 },
  { id: "estructura", name: "Estructura", weight: 10 },
  { id: "losa", name: "Losa", weight: 5 },
  { id: "albanileria", name: "Albañilería", weight: 10 },
  { id: "hidraulicas", name: "Hidráulicas", weight: 5 },
  { id: "electricas", name: "Eléctricas", weight: 5 },
  { id: "aplanados", name: "Aplanados", weight: 5 },
  { id: "pisos", name: "Pisos", weight: 10 },
  { id: "impermeabilizante", name: "Impermeabilizante", weight: 5 },
  { id: "canceleria", name: "Cancelería", weight: 5 },
  { id: "general", name: "General", weight: 5 },
];

const checklistByPartida = {
  preliminares: [
    { code: "AC-PL-01", label: "El trazo coincide con planos autorizados." },
    { code: "AC-PL-02", label: "Los niveles de desplante fueron verificados." },
    { code: "AC-PL-03", label: "Ejes y referencias se encuentran protegidos." },
  ],
  excavacion: [
    { code: "AC-EX-01", label: "Profundidad y dimensiones cumplen especificación." },
    { code: "AC-EX-02", label: "Fondo firme y libre de material suelto." },
  ],
  cimentacion: [
    { code: "AC-CI-01", label: "Plantilla de concreto aplicada antes de armado." },
    { code: "AC-CI-02", label: "Acero de refuerzo conforme a diámetro y separación." },
    { code: "AC-CI-03", label: "Traslapes y amarres correctamente ejecutados." },
    { code: "AC-CI-04", label: "Recubrimiento mínimo respetado." },
    { code: "AC-CI-05", label: "Instalaciones cruzando cimentación protegidas." },
  ],
  colado: [
    { code: "AC-CO-01", label: "Concreto con revenimiento adecuado." },
    { code: "AC-CO-02", label: "Vibrado correcto sin segregación." },
    { code: "AC-CO-03", label: "Curado aplicado posterior al colado." },
  ],
  estructura: [
    { code: "AC-ES-01", label: "Columnas y castillos plomados." },
    { code: "AC-ES-02", label: "Dalas y trabes con dimensiones correctas." },
    { code: "AC-ES-03", label: "Cimbra alineada y firme antes de colado." },
  ],
  losa: [
    { code: "AC-LO-01", label: "Instalaciones colocadas antes de colado de losa." },
    { code: "AC-LO-02", label: "Espesor de losa conforme a proyecto." },
  ],
  albanileria: [
    { code: "AC-AL-01", label: "Muros alineados y plomados." },
    { code: "AC-AL-02", label: "Juntas uniformes y correctamente rellenas." },
    { code: "AC-AL-03", label: "Vanos conforme a dimensiones de proyecto." },
  ],
  hidraulicas: [
    { code: "AC-IH-01", label: "Prueba de presión en instalaciones hidráulicas antes de tapar." },
    { code: "AC-IH-02", label: "Pendientes de drenaje verificadas." },
  ],
  electricas: [
    { code: "AC-IE-01", label: "Canalizaciones completas antes de aplanado." },
    { code: "AC-IE-02", label: "Centro de carga correctamente instalado y señalizado." },
  ],
  aplanados: [
    { code: "AC-AP-01", label: "Superficie limpia antes de aplicar." },
    { code: "AC-AP-02", label: "Plomos y niveles verificados." },
  ],
  pisos: [
    { code: "AC-PI-01", label: "Base nivelada antes de colocación." },
    { code: "AC-PI-02", label: "Adhesivo adecuado aplicado uniformemente." },
    { code: "AC-PI-03", label: "Colocación de mármol conforme a especificación técnica." },
    { code: "AC-PI-04", label: "Preparación de superficies para colocación de mármol." },
    { code: "AC-PI-05", label: "Aplicación de boquilla en recubrimientos de mármol." },
  ],
  impermeabilizante: [
    { code: "AC-IM-01", label: "Superficie preparada antes de aplicación." },
    { code: "AC-IM-02", label: "Traslapes y sellos correctamente ejecutados." },
  ],
  canceleria: [
    { code: "AC-CA-01", label: "Marcos alineados antes de fijación definitiva." },
    { code: "AC-CA-02", label: "Preinstalaciones verificadas antes de cerrar muros." },
    { code: "AC-CA-03", label: "Vano y elementos de cancelería conforme a especificación técnica." },
  ],
  general: [
    { code: "AC-GE-01", label: "Limpieza de área previa a cada partida." },
    { code: "AC-GE-02", label: "Evidencia fotográfica y registro documental realizado." },
  ],
};

const qualityPartidaAliases = { PL: "preliminares", EX: "excavacion", CI: "cimentacion", CO: "colado", ES: "estructura", LO: "losa", AL: "albanileria", IH: "hidraulicas", IE: "electricas", AP: "aplanados", PI: "pisos", IM: "impermeabilizante", CA: "canceleria", GE: "general" };
function qualityPartidaIdFromSpec(spec = {}) {
  const codePrefix = String(spec.clave || spec.code || "").split("-")[1];
  if (qualityPartidaAliases[codePrefix]) return qualityPartidaAliases[codePrefix];
  const raw = slugify(spec.partida || "").replace(/-/g, "_");
  const map = { preliminares: "preliminares", excavacion: "excavacion", cimentacion: "cimentacion", colado: "colado", estructura: "estructura", losa: "losa", albanileria: "albanileria", hidraulicas: "hidraulicas", instalaciones_hidraulicas: "hidraulicas", electricas: "electricas", instalaciones_electricas: "electricas", aplanados: "aplanados", pisos: "pisos", impermeabilizacion: "impermeabilizante", impermeabilizante: "impermeabilizante", canceleria: "canceleria", general: "general" };
  return map[raw] || raw || "general";
}
function qualitySpecsForPartida(partidaId, specs = []) {
  return (specs || []).filter((spec) => (spec.partidaId || qualityPartidaIdFromSpec(spec)) === partidaId && spec.active !== false);
}

const c = {
  bg: "#f5f7fb",
  panelSoft: "#f8fafc",
  surface: "#ffffff",
  border: "#e7ebf3",
  text: "#101828",
  muted: "#667085",
  dark: "#0f172a",
  primary: "#111827",
  primarySoft: "#eef2ff",
  primaryText: "#3730a3",
  successBg: "#e8f7ed",
  successText: "#157347",
  warnBg: "#fff3cd",
  warnText: "#9a6700",
  dangerBg: "#fdecec",
  dangerText: "#b42318",
  idleBg: "#eef2f6",
  idleText: "#475467",
  shadow: "0 8px 24px rgba(16,24,40,0.06)",
  radius: 22,
};

function slugify(text = "") {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildChecklist(partidaId, currentChecklist = null, checkedItems = [], qualitySpecs = []) {
  const dynamicSpecs = qualitySpecsForPartida(partidaId, qualitySpecs);
  const template = dynamicSpecs.length
    ? dynamicSpecs.map((spec) => ({
        code: spec.clave || spec.code,
        label: spec.concepto || spec.label,
        criterioAceptacion: spec.criterioAceptacion || "",
        puntosAceptables: spec.puntosAceptables || "",
        puntosNoAceptables: spec.puntosNoAceptables || "",
        formaVerificacion: spec.formaVerificacion || "",
        imagenIncorrecto: spec.imagenIncorrecto || "",
        imagenCorrecto: spec.imagenCorrecto || "",
        catalogKeywords: spec.catalogKeywords || "",
        requiresPhotos: spec.requiresPhotos === false ? false : true,
        evidenceRequired: spec.requiresPhotos === false ? 0 : Number(spec.evidenceRequired ?? 1),
        evidenceLevel: spec.evidenceLevel || spec.nivelEvidencia || "alcance",
        stagePercent: Number(spec.stagePercent ?? 100),
        clasificacion: spec.clasificacion || "menor",
        peso: spec.peso || 1,
      }))
    : (checklistByPartida[partidaId] || []);

  return template.map((item) => {
    const id = item.code;
    const existing = currentChecklist?.find((i) => i.id === id || i.code === item.code || i.label === item.label);

    return {
      id,
      code: item.code,
      label: item.label,
      criterioAceptacion: item.criterioAceptacion || existing?.criterioAceptacion || "",
      puntosAceptables: item.puntosAceptables || existing?.puntosAceptables || "",
      puntosNoAceptables: item.puntosNoAceptables || existing?.puntosNoAceptables || "",
      formaVerificacion: item.formaVerificacion || existing?.formaVerificacion || "",
      imagenIncorrecto: item.imagenIncorrecto || existing?.imagenIncorrecto || "",
      imagenCorrecto: item.imagenCorrecto || existing?.imagenCorrecto || "",
      catalogKeywords: item.catalogKeywords || existing?.catalogKeywords || "",
      requiresPhotos: item.requiresPhotos === false || existing?.requiresPhotos === false ? false : true,
      evidenceRequired: item.requiresPhotos === false || existing?.requiresPhotos === false ? 0 : Number(item.evidenceRequired ?? existing?.evidenceRequired ?? 1),
      evidenceLevel: item.evidenceLevel || existing?.evidenceLevel || "alcance",
      stagePercent: Number(item.stagePercent ?? existing?.stagePercent ?? 100),
      clasificacion: item.clasificacion || existing?.clasificacion || "menor",
      peso: item.peso || existing?.peso || 1,
      resultado: existing?.resultado || "",
      checked: existing?.checked ?? checkedItems.includes(item.label) ?? false,
      note: existing?.note || "",
      photos: existing?.photos || [],
      scopeResults: existing?.scopeResults || {},
      comments: existing?.comments || [],
    };
  });
}

function evaluarPartida(partida) {
  let totalPeso = 0;
  let puntos = 0;
  let pendientes = 0;
  let criticosNC = 0;
  let criticosObs = 0;
  let faltanFotos = 0;

  (partida.checklist || []).forEach((item) => {
    if (!item.resultado) {
      pendientes++;
      return;
    }

    if (item.resultado === "na") return;

    const factor = {
      cumple: 1,
      observacion: 0.7,
      no_cumple: 0,
    }[item.resultado] ?? 0;

    const peso = item.peso || 1;
    const clasificacion = item.clasificacion || "menor";

    totalPeso += peso;
    puntos += peso * factor;

    if (clasificacion === "critico") {
      if (item.resultado === "no_cumple") criticosNC++;
      if (item.resultado === "observacion") criticosObs++;
    }

    const requiredPhotos = item.requiresPhotos === false ? 0 : Number(item.evidenceRequired || 0);
    if (requiredPhotos > 0 && (item.photos?.length || 0) < requiredPhotos) {
      faltanFotos++;
    }
  });

  const score = totalPeso > 0 ? (puntos / totalPeso) * 100 : 0;

  if (criticosNC > 0) return { status: "bloqueada", score };
  if (pendientes > 0) return { status: "pendiente_revision", score };
  if (faltanFotos > 0) return { status: "pendiente_evidencia", score };
  if (criticosObs > 0) return { status: "condicionada", score };
  if (score >= 95) return { status: "liberada", score };
  if (score >= 90) return { status: "liberada_condicionada", score };

  return { status: "no_liberada", score };
}

function hasSupervisorComment(item) {
  return (item.comments || []).some((comment) => comment.authorRole === "supervisora" && comment.text?.trim());
}

function normalizePartida(partida, qualitySpecs = []) {
  return {
    ...partida,
    checklist: buildChecklist(partida.id, partida.checklist, partida.checkedItems || [], qualitySpecs),
    evidenceCount: partida.evidenceCount || { photos: 0, videos: 0 },
    generalComments: Array.isArray(partida.generalComments) ? partida.generalComments : [],
  };
}

function cardStyle(selected = false) {
  return {
    background: c.surface,
    border: selected ? "2px solid #111827" : `1px solid ${c.border}`,
    borderRadius: c.radius,
    boxShadow: c.shadow,
  };
}

function badgeStyle(status) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 11px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
  };
  switch (status) {
    case "Aprobada":
      return { ...base, background: c.successBg, color: c.successText };
    case "Lista para revisión":
      return { ...base, background: c.warnBg, color: c.warnText };
    case "Rechazada":
      return { ...base, background: c.dangerBg, color: c.dangerText };
    case "En proceso":
      return { ...base, background: c.primarySoft, color: c.primaryText };
    default:
      return { ...base, background: c.idleBg, color: c.idleText };
  }
}

function inputStyle(extra = {}) {
  return {
    width: "100%",
    border: `1px solid ${c.border}`,
    borderRadius: 14,
    padding: "12px 14px",
    outline: "none",
    fontSize: 14,
    color: c.text,
    background: "#fff",
    boxSizing: "border-box",
    ...extra,
  };
}

function buttonStyle(kind = "primary", extra = {}) {
  const common = {
    borderRadius: 14,
    padding: "11px 16px",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
    border: "1px solid transparent",
  };

  if (kind === "secondary") {
    return {
      ...common,
      background: "#fff",
      color: c.text,
      border: `1px solid ${c.border}`,
      ...extra,
    };
  }

  if (kind === "danger") {
    return {
      ...common,
      background: "#fff",
      color: c.dangerText,
      border: `1px solid ${c.dangerBg}`,
      ...extra,
    };
  }

  return {
    ...common,
    background: c.primary,
    color: "#fff",
    ...extra,
  };
}

function ProgressBar({ value }) {
  const safe = Math.max(0, Math.min(100, value || 0));
  return (
    <div
      style={{
        width: "100%",
        height: 9,
        borderRadius: 999,
        background: "#edf1f7",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${safe}%`,
          height: "100%",
          background: "linear-gradient(90deg, #111827 0%, #374151 100%)",
          borderRadius: 999,
        }}
      />
    </div>
  );
}

function getHouseProgress(house) {
  if (!house?.partidas?.length) return 0;
  return house.partidas.reduce((acc, p) => acc + (p.status === "Aprobada" ? p.weight : 0), 0);
}

function getProjectProgress(houses) {
  if (!houses?.length) return 0;
  return Math.round(houses.reduce((acc, h) => acc + getHouseProgress(h), 0) / houses.length);
}

function ChecklistPhotoGrid({ photos, onPreview }) {
  if (!photos?.length) {
    return (
      <div
        style={{
          border: `1px dashed ${c.border}`,
          borderRadius: 14,
          padding: 14,
          color: c.muted,
          fontSize: 13,
          background: c.panelSoft,
        }}
      >
        Sin fotos en este punto
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))",
        gap: 10,
      }}
    >
      {photos.map((photo, index) => (
        <button
          key={photo.id || `${photo.url}-${index}`}
          onClick={() => onPreview(photo, photos)}
          style={{
            border: `1px solid ${c.border}`,
            borderRadius: 14,
            padding: 6,
            background: "#fff",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <img
            src={photo.url}
            alt={photo.fileName || `Foto ${index + 1}`}
            style={{
              width: "100%",
              height: 90,
              objectFit: "cover",
              borderRadius: 10,
              display: "block",
            }}
          />
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: c.muted,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {photo.fileName || `Foto ${index + 1}`}
          </div>
        </button>
      ))}
    </div>
  );
}


function normalizeMentionHandle(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

function userMentionHandle(user = {}) {
  const base = user.mentionHandle || user.handle || user.name || user.email || user.id || "usuario";
  return normalizeMentionHandle(String(base).split("@")[0]);
}

function extractMentionsFromText(text = "", users = []) {
  const handles = Array.from(String(text || "").matchAll(/@([a-zA-Z0-9._-]+)/g)).map((match) => normalizeMentionHandle(match[1]));
  const uniqueHandles = [...new Set(handles)].filter(Boolean);
  const matchedUsers = users.filter((user) => {
    const options = [
      userMentionHandle(user),
      normalizeMentionHandle(user.name),
      normalizeMentionHandle(String(user.email || "").split("@")[0]),
    ].filter(Boolean);
    return uniqueHandles.some((handle) => options.includes(handle));
  });
  return {
    mentionHandles: uniqueHandles,
    mentionUids: [...new Set(matchedUsers.map((user) => user.uid || user.id).filter(Boolean))],
    mentionNames: matchedUsers.map((user) => user.name || user.email || user.id).filter(Boolean),
  };
}

function mergeMentionUsers(realUsers = [], currentUser = null) {
  const combined = [...(realUsers || [])];
  if (currentUser?.uid || currentUser?.email) combined.unshift(currentUser);
  sampleMentionUsers.forEach((sample) => {
    const sampleHandle = userMentionHandle(sample);
    const exists = combined.some((user) => userMentionHandle(user) === sampleHandle || (user.email && sample.email && user.email === sample.email));
    if (!exists) combined.push(sample);
  });

  const seen = new Set();
  return combined.filter((user) => {
    const key = user.uid || user.id || user.email || userMentionHandle(user);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getMentionQuery(value = "", caret = 0) {
  const left = String(value || "").slice(0, caret);
  const atIndex = left.lastIndexOf("@");
  if (atIndex < 0) return null;
  const fragment = left.slice(atIndex + 1);
  if (/\s/.test(fragment)) return null;
  return { start: atIndex, query: normalizeMentionHandle(fragment) };
}

function MentionTextarea({ value, onChange, users = [], placeholder, rows = 4, style }) {
  const textareaRef = useRef(null);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const mentionQuery = getMentionQuery(value, caret);
  const suggestions = mentionQuery
    ? users
        .filter((user) => {
          const handle = userMentionHandle(user);
          const name = normalizeMentionHandle(user.name || user.email || "");
          return !mentionQuery.query || handle.includes(mentionQuery.query) || name.includes(mentionQuery.query);
        })
        .slice(0, 7)
    : [];

  function insertMention(user) {
    if (!mentionQuery) return;
    const handle = userMentionHandle(user);
    const before = String(value || "").slice(0, mentionQuery.start);
    const after = String(value || "").slice(caret);
    const nextValue = `${before}@${handle} ${after}`;
    const nextCaret = `${before}@${handle} `.length;
    onChange(nextValue);
    setActiveIndex(0);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
    }, 0);
  }

  function updateCaret(event) {
    setCaret(event.target.selectionStart || 0);
  }

  return (
    <div style={{ position: "relative" }}>
      <textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart || 0);
          setActiveIndex(0);
        }}
        onClick={updateCaret}
        onKeyUp={updateCaret}
        onKeyDown={(event) => {
          if (!suggestions.length) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((prev) => (prev + 1) % suggestions.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            insertMention(suggestions[activeIndex] || suggestions[0]);
          } else if (event.key === "Escape") {
            setCaret(0);
          }
        }}
        placeholder={placeholder}
        style={style}
      />

      {suggestions.length > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 10,
            right: 10,
            top: "calc(100% + 6px)",
            zIndex: 50,
            background: "#fff",
            border: `1px solid ${c.border}`,
            borderRadius: 14,
            boxShadow: "0 18px 45px rgba(15, 23, 42, 0.18)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "8px 10px", fontSize: 12, color: c.muted, borderBottom: `1px solid ${c.border}` }}>
            Enter para etiquetar · ↑ ↓ para cambiar opción
          </div>
          {suggestions.map((user, index) => {
            const handle = userMentionHandle(user);
            const active = index === activeIndex;
            return (
              <button
                key={user.uid || user.id || handle}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertMention(user);
                }}
                style={{
                  width: "100%",
                  border: 0,
                  borderBottom: index === suggestions.length - 1 ? 0 : `1px solid ${c.border}`,
                  background: active ? c.panelSoft : "#fff",
                  padding: "10px 12px",
                  textAlign: "left",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <span>
                  <strong style={{ color: c.text }}>{user.name || user.email || handle}</strong>
                  <span style={{ color: c.muted, marginLeft: 8 }}>@{handle}</span>
                </span>
                <span style={{ ...badgeStyle(user.role || "usuario"), fontSize: 10, padding: "3px 7px" }}>
                  {user.isSample ? "Ejemplo" : user.role || "usuario"}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CommentThread({ comments, onPreview, onStatusChange, canValidate = false, users = [] }) {
  if (!comments?.length) {
    return (
      <div
        style={{
          border: `1px dashed ${c.border}`,
          borderRadius: 14,
          padding: 14,
          color: c.muted,
          fontSize: 13,
          background: c.panelSoft,
        }}
      >
        Sin comentarios todavía
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {comments.map((comment) => (
        <div
          key={comment.id}
          style={{
            border: `1px solid ${c.border}`,
            borderRadius: 14,
            padding: 12,
            background: "#fff",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800, color: c.text }}>
              {comment.authorName || "Usuario"}
              <span style={{ color: c.muted, fontWeight: 600 }}> · {comment.authorRole || "rol"}</span>
            </div>
            <div style={{ fontSize: 12, color: c.muted }}>
              {comment.createdAt ? new Date(comment.createdAt).toLocaleString() : ""}
            </div>
          </div>

          <div style={{ color: c.text, marginTop: 8, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {comment.text}
          </div>
          {(comment.mentionNames || comment.mentionHandles || []).length > 0 ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {(comment.mentionNames?.length ? comment.mentionNames : comment.mentionHandles || []).map((mention) => (
                <span key={mention} style={{ ...badgeStyle("Pendiente"), fontSize: 11, padding: "4px 8px" }}>@{String(mention).replace(/^@/, "")}</span>
              ))}
            </div>
          ) : null}


          {comment.blocksRelease ? (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={badgeStyle(comment.status === "validado" || comment.status === "cerrado" ? "Aprobada" : comment.status === "solventado" ? "Lista para revisión" : "Observada")}>
                {comment.status === "validado" || comment.status === "cerrado" ? "Validado" : comment.status === "solventado" ? "Solventado" : "Pendiente"}
              </span>
              {comment.lastStatusBy ? (
                <span style={{ fontSize: 12, color: c.muted }}>Último cambio: {comment.lastStatusBy} · {comment.lastStatusAt ? new Date(comment.lastStatusAt).toLocaleString() : ""}</span>
              ) : null}
              {onStatusChange ? (
                <>
                  <button type="button" onClick={() => onStatusChange(comment.id, { status: "solventado", statusLabel: "Solventado" })} style={buttonStyle("secondary", { padding: "7px 9px", fontSize: 12 })}>Marcar solventado</button>
                  {canValidate ? (
                    <button type="button" onClick={() => onStatusChange(comment.id, { status: "validado", statusLabel: "Validado" })} style={buttonStyle("primary", { padding: "7px 9px", fontSize: 12 })}>Validar cierre</button>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              <span style={badgeStyle("Pendiente")}>Informativo</span>
            </div>
          )}

          {(comment.photos || []).length > 0 ? (
            <div
              style={{
                marginTop: 10,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))",
                gap: 8,
              }}
            >
              {(comment.photos || []).map((photo, index) => (
                <button
                  key={photo.id || `${photo.url}-${index}`}
                  onClick={() => onPreview?.(photo, comment.photos || [])}
                  style={{
                    border: `1px solid ${c.border}`,
                    borderRadius: 12,
                    padding: 4,
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <img
                    src={photo.url}
                    alt={photo.fileName || `Foto ${index + 1}`}
                    style={{
                      width: "100%",
                      height: 88,
                      objectFit: "cover",
                      borderRadius: 8,
                      display: "block",
                    }}
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(err?.message || "No se pudo iniciar sesión");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: c.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ ...cardStyle(), width: "100%", maxWidth: 410, padding: 30 }}>
        <div style={{ fontSize: 32, fontWeight: 800, color: c.text, marginBottom: 8 }}>Control de obra</div>
        <div style={{ color: c.muted, marginBottom: 22 }}>Acceso para supervisora y constructora</div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: c.text }}>Correo</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@empresa.com"
              style={inputStyle()}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: c.text }}>Contraseña</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={inputStyle()}
            />
          </div>

          {error ? (
            <div
              style={{
                marginBottom: 14,
                padding: "12px 14px",
                borderRadius: 14,
                background: c.dangerBg,
                color: c.dangerText,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          ) : null}

          <button type="submit" disabled={busy} style={buttonStyle("primary", { width: "100%" })}>
            {busy ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}

function StatCard({ title, value, children }) {
  return (
    <div style={{ ...cardStyle(), padding: 20 }}>
      <div style={{ fontSize: 14, color: c.muted, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: c.text }}>{value}</div>
      {children ? <div style={{ marginTop: 12 }}>{children}</div> : null}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...buttonStyle(active ? "primary" : "secondary", {
          flex: 1,
          borderRadius: 16,
        }),
      }}
    >
      {children}
    </button>
  );
}

export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [users, setUsers] = useState([]);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [obras, setObras] = useState([]);
  const [selectedObraId, setSelectedObraId] = useState(defaultObraId);
  const [houses, setHouses] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [qualityInitializing, setQualityInitializing] = useState(false);
  const [qualitySpecs, setQualitySpecs] = useState([]);
  const [qualityScopes, setQualityScopes] = useState([]);
  const [checklistDetailOpen, setChecklistDetailOpen] = useState({});
  const [selectedHouseId, setSelectedHouseId] = useState("");
  const [selectedPartidaId, setSelectedPartidaId] = useState("cimentacion");
  const [tab, setTab] = useState("checklist");
  const [queryText, setQueryText] = useState("");
  const [evidencias, setEvidencias] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [checklistUploading, setChecklistUploading] = useState({});
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isTablet, setIsTablet] = useState(window.innerWidth >= 768 && window.innerWidth < 1100);
  const [actionLoading, setActionLoading] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [previewGallery, setPreviewGallery] = useState([]);
const [checklistCommentDrafts, setChecklistCommentDrafts] = useState({});
const [generalCommentDraft, setGeneralCommentDraft] = useState("");
  const [generalCommentPhotoDrafts, setGeneralCommentPhotoDrafts] = useState([]);
  const [generalCommentBlocksRelease, setGeneralCommentBlocksRelease] = useState(true);
  const [generalCommentUploading, setGeneralCommentUploading] = useState(false);
  const [checklistCommentPhotoDrafts, setChecklistCommentPhotoDrafts] = useState({});
  const [checklistCommentUploading, setChecklistCommentUploading] = useState({});
  const selectedObra = obras.find((obra) => obra.id === selectedObraId) || null;
  const obraId = selectedObraId || selectedObra?.id || "";

  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth < 768);
      setIsTablet(window.innerWidth >= 768 && window.innerWidth < 1100);
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);

      if (!user) {
        setProfile(null);
        setLoadingAuth(false);
        return;
      }

      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        setProfile(snap.data());
      } else {
        setProfile({ role: "constructora", name: user.email });
      }
      setLoadingAuth(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authUser) {
      setUsers([]);
      return;
    }
    const unsub = onSnapshot(collection(db, "users"), (snapshot) => {
      setUsers(snapshot.docs.map((item) => ({ id: item.id, uid: item.id, ...item.data() })));
    });
    return () => unsub();
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const unsub = onSnapshot(collection(db, "obras"), (snapshot) => {
      const nextObras = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      setObras(nextObras);
      if (!nextObras.length) {
        setSelectedObraId("");
        setHouses([]);
        setLoadingData(false);
        return;
      }
      setSelectedObraId((current) => {
        if (current && nextObras.some((obra) => obra.id === current)) return current;
        return (nextObras.find((obra) => obra.status === "activa") || nextObras[0]).id;
      });
    });
    return () => unsub();
  }, [authUser]);

  useEffect(() => {
    if (!authUser || !obraId) {
      setQualitySpecs([]);
      return;
    }
    const specsRef = collection(db, "obras", obraId, "qualitySpecs");
    const unsub = onSnapshot(specsRef, (snapshot) => {
      const specs = snapshot.docs.map((item) => ({ id: item.id, ...item.data(), partidaId: item.data().partidaId || qualityPartidaIdFromSpec(item.data()) }));
      setQualitySpecs(specs);
    });
    return () => unsub();
  }, [authUser, obraId]);

  useEffect(() => {
    if (!authUser || !obraId) {
      setQualityScopes([]);
      return;
    }
    const scopesRef = collection(db, "obras", obraId, "qualityScopes");
    const unsub = onSnapshot(scopesRef, (snapshot) => {
      const scopes = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      setQualityScopes(scopes);
    });
    return () => unsub();
  }, [authUser, obraId]);

  async function initializeQualityChecklistForObra(obra) {
    if (!obra?.id || qualityInitializing) return;
    const totalUnits = Math.max(0, Number(obra.totalUnits || 0));
    if (!totalUnits) return;
    setQualityInitializing(true);
    try {
      for (let index = 1; index <= totalUnits; index += 1) {
        const houseId = `unidad_${String(index).padStart(2, "0")}`;
        const houseRef = doc(db, "obras", obra.id, "casas", houseId);
        await setDoc(houseRef, {
          id: houseId,
          name: `Unidad ${String(index).padStart(2, "0")}`,
          number: index,
          block: obra.name || obra.id,
          model: "",
          createdFromObra: true,
          createdAt: serverTimestamp(),
        }, { merge: true });
        for (const template of partidaTemplates) {
          await setDoc(doc(db, "obras", obra.id, "casas", houseId, "partidas", template.id), {
            id: template.id,
            name: template.name,
            weight: template.weight,
            status: "Pendiente",
            progress: 0,
            checklist: buildChecklist(template.id, null, [], qualitySpecs),
            evidenceCount: { photos: 0, videos: 0 },
            createdFromTemplate: true,
            createdAt: serverTimestamp(),
          }, { merge: true });
        }
      }
    } catch (error) {
      console.error(error);
      alert("No se pudieron activar automáticamente los checklist de calidad para la obra.");
    } finally {
      setQualityInitializing(false);
    }
  }

  useEffect(() => {
    if (!authUser || !obraId) {
      setHouses([]);
      setLoadingData(false);
      return;
    }

    setLoadingData(true);
    const housesRef = collection(db, "obras", obraId, "casas");
    const q = query(housesRef, orderBy("number", "asc"));

    const unsub = onSnapshot(q, async (snapshot) => {
      if (snapshot.empty && selectedObra && Number(selectedObra.totalUnits || 0) > 0 && !qualityInitializing) {
        await initializeQualityChecklistForObra(selectedObra);
        return;
      }
      const data = await Promise.all(
        snapshot.docs.map(async (houseDoc) => {
          const partidasRef = collection(db, "obras", obraId, "casas", houseDoc.id, "partidas");
          const partidasSnap = await getDocs(query(partidasRef, orderBy("weight", "asc")));
          return {
            id: houseDoc.id,
            ...houseDoc.data(),
            partidas: partidasSnap.docs.map((p) => normalizePartida({ id: p.id, ...p.data() }, qualitySpecs)),
          };
        })
      );

      setHouses(data);
      setLoadingData(false);
      if (!selectedHouseId && data.length) setSelectedHouseId(data[0].id);
      if (selectedHouseId && data.length && !data.some((house) => house.id === selectedHouseId)) setSelectedHouseId(data[0].id);
    });

    return () => unsub();
  }, [authUser, obraId, selectedObra?.id, selectedObra?.totalUnits, selectedHouseId, qualityInitializing, qualitySpecs.length]);

  const filteredHouses = useMemo(() => {
    return houses.filter((house) => {
      const q = queryText.trim().toLowerCase();
      if (!q) return true;
      return (
        house.name?.toLowerCase().includes(q) ||
        String(house.number || "").includes(queryText) ||
        String(house.block || "").toLowerCase().includes(q)
      );
    });
  }, [houses, queryText]);

  const selectedHouse = houses.find((h) => h.id === selectedHouseId) || null;
  const selectedPartida =
    selectedHouse?.partidas?.find((p) => p.id === selectedPartidaId) || selectedHouse?.partidas?.[0] || null;

  const isSupervisora = profile?.role === "supervisora";
  const isConstructora = profile?.role === "constructora";
  const currentUserMentionHandle = userMentionHandle({ id: authUser?.uid, uid: authUser?.uid, name: profile?.name, email: authUser?.email });
  const allMentionUsers = useMemo(
    () => mergeMentionUsers(users, {
      id: authUser?.uid,
      uid: authUser?.uid,
      name: profile?.name || authUser?.email || "Yo",
      email: authUser?.email,
      role: profile?.role || "usuario",
      mentionHandle: currentUserMentionHandle,
    }),
    [users, authUser?.uid, authUser?.email, profile?.name, profile?.role, currentUserMentionHandle]
  );

  const myMentions = useMemo(() => {
    const currentHandles = [
      currentUserMentionHandle,
      normalizeMentionHandle(profile?.name),
      normalizeMentionHandle(String(authUser?.email || "").split("@")[0]),
    ].filter(Boolean);

    const items = [];
    houses.forEach((house) => {
      (house.partidas || []).forEach((partida) => {
        (partida.generalComments || []).forEach((comment) => {
          const mentionedByUid = (comment.mentionUids || []).includes(authUser?.uid);
          const mentionedByHandle = (comment.mentionHandles || []).some((handle) => currentHandles.includes(normalizeMentionHandle(handle)));
          if (!mentionedByUid && !mentionedByHandle) return;
          const open = Boolean(comment.blocksRelease && !["validado", "cerrado"].includes(comment.status));
          items.push({
            id: `${house.id}-${partida.id}-${comment.id}`,
            houseId: house.id,
            houseName: house.name,
            partidaId: partida.id,
            partidaName: partida.name,
            comment,
            open,
            createdAt: comment.createdAt || "",
          });
        });
      });
    });

    return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [houses, authUser?.uid, authUser?.email, profile?.name, currentUserMentionHandle]);

  const myOpenMentions = useMemo(() => myMentions.filter((item) => item.open), [myMentions]);

  function openMentionItem(item) {
    if (!item) return;
    setSelectedHouseId(item.houseId);
    setSelectedPartidaId(item.partidaId);
    setTab("checklist");
    setNotificationPanelOpen(false);
    window.setTimeout(() => {
      document.getElementById("bitacora-partida")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  useEffect(() => {
    if (!selectedHouse || !selectedPartida) {
      setEvidencias([]);
      return;
    }

    const evidenciasRef = collection(
      db,
      "obras",
      obraId,
      "casas",
      selectedHouse.id,
      "partidas",
      selectedPartida.id,
      "evidencias"
    );
    const q = query(evidenciasRef, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(q, (snapshot) => {
      setEvidencias(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => unsub();
  }, [selectedHouse, selectedPartida]);

  async function updatePartida(payload) {
    if (!selectedHouse || !selectedPartida) return;

    const previousHouses = houses;

    setHouses((prev) =>
      prev.map((house) => {
        if (house.id !== selectedHouse.id) return house;

        return {
          ...house,
          partidas: (house.partidas || []).map((partida) =>
            partida.id === selectedPartida.id
              ? normalizePartida({
                  ...partida,
                  ...payload,
                }, qualitySpecs)
              : partida
          ),
        };
      })
    );

    try {
      const partidaRef = doc(db, "obras", obraId, "casas", selectedHouse.id, "partidas", selectedPartida.id);
      await updateDoc(partidaRef, {
        ...payload,
        lastUpdatedAt: serverTimestamp(),
        lastUpdatedBy: authUser?.uid || null,
      });
    } catch (error) {
      setHouses(previousHouses);
      throw error;
    }
  }

  async function updateChecklistItem(itemId, patch) {
    if (!selectedPartida) return;
    const nextChecklist = (selectedPartida.checklist || []).map((item) =>
      item.id === itemId ? { ...item, ...patch } : item
    );
    const checkedItems = nextChecklist.filter((item) => item.checked).map((item) => item.label);
    await updatePartida({ checklist: nextChecklist, checkedItems });
  }


  function scopesForChecklistItem(item) {
    if (!item) return [];
    const code = String(item.code || item.id || "").trim();
    return (qualityScopes || [])
      .filter((scope) => {
        const scopeCode = String(scope.qualityCode || "").trim();
        const scopeSpec = String(scope.qualitySpecId || "").trim();
        return scopeCode === code || scopeSpec === String(item.id || "").trim();
      })
      .sort((a, b) => String(a.elementType || "").localeCompare(String(b.elementType || ""), "es") || String(a.elementName || "").localeCompare(String(b.elementName || ""), "es"));
  }

  function scopeProgressForItem(item) {
    const scopes = scopesForChecklistItem(item);
    const results = item?.scopeResults || {};
    const complete = scopes.filter((scope) => ["cumple", "na"].includes(results[scope.id]?.resultado)).length;
    const observed = scopes.filter((scope) => results[scope.id]?.resultado === "no_cumple" || results[scope.id]?.resultado === "observacion").length;
    const pending = Math.max(0, scopes.length - complete - observed);
    return { scopes, total: scopes.length, complete, observed, pending };
  }

  async function updateChecklistScopeResult(itemId, scopeId, patch) {
    const item = selectedPartida?.checklist?.find((entry) => entry.id === itemId);
    if (!item) return;
    const current = item.scopeResults || {};
    const previousScopeResult = current[scopeId] || {};
    const requiredPhotos = item.requiresPhotos === false || item.evidenceLevel === "punto" ? 0 : Number(item.evidenceRequired || 0);
    if (patch?.resultado === "cumple" && requiredPhotos > 0 && (previousScopeResult.photos?.length || 0) < requiredPhotos) {
      alert(`Este punto requiere ${requiredPhotos} foto(s) para poder marcar el elemento como Cumple.`);
      return;
    }
    const nextScopeResult = {
      ...previousScopeResult,
      ...patch,
      updatedAt: new Date().toISOString(),
      updatedBy: profile?.name || authUser?.email || "Usuario",
      updatedByRole: profile?.role || "usuario",
    };
    await updateChecklistItem(itemId, {
      scopeResults: {
        ...current,
        [scopeId]: nextScopeResult,
      },
    });
  }

  async function toggleChecklistItem(itemId) {
    const item = selectedPartida?.checklist?.find((entry) => entry.id === itemId);
    if (!item) return;
    await updateChecklistItem(itemId, { checked: !item.checked });
  }
function buildNewComment(textValue, extra = {}) {
  const mentionData = extractMentionsFromText(textValue, allMentionUsers);
  return {
    id: extra.id || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text: textValue.trim(),
    authorUid: authUser?.uid || null,
    authorName: profile?.name || authUser?.email || "Usuario",
    authorRole: profile?.role || "usuario",
    createdAt: new Date().toISOString(),
    ...mentionData,
    ...extra,
  };
}

async function addChecklistComment(itemId) {
  const draft = (checklistCommentDrafts[itemId] || "").trim();
  if (!draft) return;

  const checklistItem = (selectedPartida?.checklist || []).find((item) => item.id === itemId);
  if (!checklistItem) return;

  const draftPhotos = checklistCommentPhotoDrafts[itemId] || [];
  const commentId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  setChecklistCommentUploading((prev) => ({ ...prev, [itemId]: true }));

  try {
    const uploadedPhotos = [];
    for (const draftPhoto of draftPhotos) {
      const file = draftPhoto.file;
      if (!file) continue;
      const filePath = `obras/${obraId}/${selectedHouse.id}/${selectedPartida.id}/checklist-comments/${itemId}/${commentId}/${Date.now()}-${file.name}`;
      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      uploadedPhotos.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        url,
        fileName: file.name,
        size: file.size,
        storagePath: filePath,
        uploadedAt: new Date().toISOString(),
        uploadedBy: authUser?.uid || null,
        uploadedByName: profile?.name || authUser?.email || "Usuario",
      });
    }

    const nextComments = [
      ...(checklistItem.comments || []),
      buildNewComment(draft, {
        id: commentId,
        photos: uploadedPhotos,
      }),
    ];

    const nextChecklistPhotos = [...(checklistItem.photos || []), ...uploadedPhotos];
    await updateChecklistItem(itemId, { comments: nextComments, photos: nextChecklistPhotos });

    draftPhotos.forEach((photo) => {
      if (photo.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(photo.previewUrl);
      }
    });

    setChecklistCommentPhotoDrafts((prev) => ({
      ...prev,
      [itemId]: [],
    }));
  } finally {
    setChecklistCommentUploading((prev) => ({ ...prev, [itemId]: false }));
  }

  setChecklistCommentDrafts((prev) => ({
    ...prev,
    [itemId]: "",
  }));
}

function onPickChecklistCommentPhotos(itemId, fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const previews = files.map((file) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    file,
    fileName: file.name,
    previewUrl: URL.createObjectURL(file),
  }));

  setChecklistCommentPhotoDrafts((prev) => ({
    ...prev,
    [itemId]: [...(prev[itemId] || []), ...previews],
  }));
}

function removeDraftChecklistCommentPhoto(itemId, draftPhotoId) {
  setChecklistCommentPhotoDrafts((prev) => {
    const draftPhotos = prev[itemId] || [];
    const target = draftPhotos.find((photo) => photo.id === draftPhotoId);
    if (target?.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(target.previewUrl);
    }

    return {
      ...prev,
      [itemId]: draftPhotos.filter((photo) => photo.id !== draftPhotoId),
    };
  });
}

function onPickGeneralCommentPhotos(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const previews = files.map((file) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    file,
    fileName: file.name,
    previewUrl: URL.createObjectURL(file),
  }));

  setGeneralCommentPhotoDrafts((prev) => [...prev, ...previews]);
}

function removeDraftGeneralCommentPhoto(draftPhotoId) {
  setGeneralCommentPhotoDrafts((prev) => {
    const target = prev.find((photo) => photo.id === draftPhotoId);
    if (target?.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(target.previewUrl);
    }
    return prev.filter((photo) => photo.id !== draftPhotoId);
  });
}

async function addGeneralComment() {
  const draft = generalCommentDraft.trim();
  if (!draft && generalCommentPhotoDrafts.length === 0) return;
  if (!selectedHouse || !selectedPartida) return;

  const commentId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  setGeneralCommentUploading(true);

  try {
    const uploadedPhotos = [];
    for (const draftPhoto of generalCommentPhotoDrafts) {
      const file = draftPhoto.file;
      if (!file) continue;
      const filePath = `obras/${obraId}/${selectedHouse.id}/${selectedPartida.id}/bitacora-partida/${commentId}/${Date.now()}-${file.name}`;
      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      uploadedPhotos.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        url,
        fileName: file.name,
        size: file.size,
        storagePath: filePath,
        uploadedAt: new Date().toISOString(),
        uploadedBy: authUser?.uid || null,
        uploadedByName: profile?.name || authUser?.email || "Usuario",
      });
    }

    const nextComments = [
      ...(selectedPartida?.generalComments || []),
      buildNewComment(draft || "Evidencia agregada a la bitácora de la partida.", {
        id: commentId,
        photos: uploadedPhotos,
        blocksRelease: generalCommentBlocksRelease,
        status: generalCommentBlocksRelease ? "pendiente" : "informativo",
        statusLabel: generalCommentBlocksRelease ? "Pendiente" : "Informativo",
      }),
    ];

    await updatePartida({ generalComments: nextComments });

    generalCommentPhotoDrafts.forEach((photo) => {
      if (photo.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(photo.previewUrl);
    });
    setGeneralCommentPhotoDrafts([]);
    setGeneralCommentDraft("");
    setGeneralCommentBlocksRelease(true);
  } finally {
    setGeneralCommentUploading(false);
  }
}

async function updateGeneralCommentStatus(commentId, patch) {
  const nextComments = (selectedPartida?.generalComments || []).map((comment) =>
    comment.id === commentId
      ? {
          ...comment,
          ...patch,
          lastStatusBy: profile?.name || authUser?.email || "Usuario",
          lastStatusByRole: profile?.role || "usuario",
          lastStatusAt: new Date().toISOString(),
        }
      : comment
  );
  await updatePartida({ generalComments: nextComments });
}

async function deleteChecklistPhoto(itemId, photoId) {
  const checklistItem = (selectedPartida?.checklist || []).find((item) => item.id === itemId);
  const photo = (checklistItem?.photos || []).find((p) => p.id === photoId);

  if (!checklistItem || !photo) return;

  const ok = window.confirm(`¿Borrar la foto ${photo.fileName || ""}?`);
  if (!ok) return;

  if (photo.storagePath) {
    try {
      await deleteObject(ref(storage, photo.storagePath));
    } catch (error) {
      console.error(error);
    }
  }

  const nextPhotos = (checklistItem.photos || []).filter((p) => p.id !== photoId);
  await updateChecklistItem(itemId, { photos: nextPhotos });
}

async function deleteGeneralEvidence(file) {
  if (!selectedHouse || !selectedPartida || !file?.id) return;

  const ok = window.confirm(`¿Borrar el archivo ${file.fileName || ""}?`);
  if (!ok) return;

  if (file.storagePath) {
    try {
      await deleteObject(ref(storage, file.storagePath));
    } catch (error) {
      console.error(error);
    }
  }

  await deleteDoc(
    doc(
      db,
      "obras",
      obraId,
      "casas",
      selectedHouse.id,
      "partidas",
      selectedPartida.id,
      "evidencias",
      file.id
    )
  );

  const evidenciasRef = collection(
    db,
    "obras",
    obraId,
    "casas",
    selectedHouse.id,
    "partidas",
    selectedPartida.id,
    "evidencias"
  );

  const snapshot = await getDocs(evidenciasRef);
  const photos = snapshot.docs.filter((d) => d.data().type === "photo").length;
  const videos = snapshot.docs.filter((d) => d.data().type === "video").length;

  await updatePartida({
    evidenceCount: { photos, videos },
  });
}
  async function handleUpload(type, files) {
    if (!files?.length || !selectedHouse || !selectedPartida) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const filePath = `obras/${obraId}/${selectedHouse.id}/${selectedPartida.id}/${type}/${Date.now()}-${file.name}`;
        const storageRef = ref(storage, filePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        const evidenceRef = doc(
          collection(db, "obras", obraId, "casas", selectedHouse.id, "partidas", selectedPartida.id, "evidencias")
        );

        await setDoc(evidenceRef, {
          type,
          fileName: file.name,
          size: file.size,
          url,
          storagePath: filePath,
          createdAt: serverTimestamp(),
          createdBy: authUser?.uid || null,
          createdByName: profile?.name || authUser?.email || "Usuario",
        });
      }

      const evidenciasRef = collection(
        db,
        "obras",
        obraId,
        "casas",
        selectedHouse.id,
        "partidas",
        selectedPartida.id,
        "evidencias"
      );
      const snapshot = await getDocs(evidenciasRef);
      const photos = snapshot.docs.filter((d) => d.data().type === "photo").length;
      const videos = snapshot.docs.filter((d) => d.data().type === "video").length;

      await updatePartida({
        evidenceCount: { photos, videos },
        status: selectedPartida.status === "Pendiente" ? "En proceso" : selectedPartida.status,
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleChecklistPhotoUpload(itemId, files) {
    if (!files?.length || !selectedHouse || !selectedPartida) return;
    setChecklistUploading((prev) => ({ ...prev, [itemId]: true }));

    try {
      const checklistItem = (selectedPartida.checklist || []).find((item) => item.id === itemId);
      if (!checklistItem) return;

      const uploadedPhotos = [];
      for (const file of Array.from(files)) {
        const filePath = `obras/${obraId}/${selectedHouse.id}/${selectedPartida.id}/checklist/${itemId}/${Date.now()}-${file.name}`;
        const storageRef = ref(storage, filePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        uploadedPhotos.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          url,
          fileName: file.name,
          size: file.size,
          storagePath: filePath,
          uploadedAt: new Date().toISOString(),
          uploadedBy: authUser?.uid || null,
          uploadedByName: profile?.name || authUser?.email || "Usuario",
        });
      }

      const nextPhotos = [...(checklistItem.photos || []), ...uploadedPhotos];
      const nextStatus = selectedPartida.status === "Pendiente" ? "En proceso" : selectedPartida.status;
      const nextChecklist = (selectedPartida.checklist || []).map((item) =>
        item.id === itemId ? { ...item, photos: nextPhotos } : item
      );
      const checkedItems = nextChecklist.filter((item) => item.checked).map((item) => item.label);

      await updatePartida({ checklist: nextChecklist, checkedItems, status: nextStatus });
    } finally {
      setChecklistUploading((prev) => ({ ...prev, [itemId]: false }));
    }
  }


  async function handleChecklistScopePhotoUpload(itemId, scopeId, files) {
    if (!files?.length || !selectedHouse || !selectedPartida) return;
    const uploadKey = `${itemId}-${scopeId}`;
    setChecklistUploading((prev) => ({ ...prev, [uploadKey]: true }));
    try {
      const checklistItem = (selectedPartida.checklist || []).find((item) => item.id === itemId);
      if (!checklistItem) return;
      const uploadedPhotos = [];
      for (const file of Array.from(files)) {
        const filePath = `obras/${obraId}/${selectedHouse.id}/${selectedPartida.id}/checklist/${itemId}/scopes/${scopeId}/${Date.now()}-${file.name}`;
        const storageRef = ref(storage, filePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        uploadedPhotos.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          url,
          fileName: file.name,
          size: file.size,
          storagePath: filePath,
          uploadedAt: new Date().toISOString(),
          uploadedBy: authUser?.uid || null,
          uploadedByName: profile?.name || authUser?.email || "Usuario",
        });
      }
      const current = checklistItem.scopeResults || {};
      const currentScope = current[scopeId] || {};
      await updateChecklistItem(itemId, {
        scopeResults: {
          ...current,
          [scopeId]: {
            ...currentScope,
            photos: [...(currentScope.photos || []), ...uploadedPhotos],
            updatedAt: new Date().toISOString(),
            updatedBy: profile?.name || authUser?.email || "Usuario",
          },
        },
      });
    } finally {
      setChecklistUploading((prev) => ({ ...prev, [uploadKey]: false }));
    }
  }

  function openPhotoPreview(photo, gallery = []) {
    setPreviewPhoto(photo);
    setPreviewGallery(gallery);
  }

  function goPreview(direction) {
    if (!previewPhoto || !previewGallery.length) return;
    const currentIndex = previewGallery.findIndex((photo) => photo.id === previewPhoto.id);
    if (currentIndex === -1) return;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= previewGallery.length) return;
    setPreviewPhoto(previewGallery[nextIndex]);
  }

 async function markReadyForReview() {
  if (!canSendToReview) {
    alert(reviewBlockMessage || "Completa el checklist y sube evidencias antes de enviar a revisión.");
    return;
  }

  try {
    setActionLoading(true);
    await updatePartida({ status: "Lista para revisión" });
    alert("Partida enviada a revisión");
  } catch (error) {
    console.error(error);
    alert("No se pudo enviar a revisión");
  } finally {
    setActionLoading(false);
  }
}

  async function approvePartida() {
    if (!canSupervisorApprove) {
      alert(supervisorApproveBlockMessage || "Primero revisa todos los puntos antes de aprobar.");
      return;
    }

    try {
      setActionLoading(true);
      await updatePartida({ status: "Aprobada" });
      alert("Partida aprobada correctamente");
    } catch (error) {
      console.error(error);
      alert("No se pudo aprobar la partida");
    } finally {
      setActionLoading(false);
    }
  }

  async function rejectPartida() {
    if (!canSupervisorRequestFixes) {
      alert("Para solicitar subsanación revisa al menos un punto con 'No cumple'.");
      return;
    }

    try {
      setActionLoading(true);
      await updatePartida({ status: "Rechazada" });
      alert("Se solicitó subsanación a la constructora");
    } catch (error) {
      console.error(error);
      alert("No se pudo rechazar la partida");
    } finally {
      setActionLoading(false);
    }
  }

  if (loadingAuth) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: c.bg,
          color: c.text,
          fontWeight: 700,
        }}
      >
        Cargando...
      </div>
    );
  }

  if (!authUser) return <LoginScreen />;

  if (!selectedObraId && !loadingData) {
    return (
      <div style={{ minHeight: "100vh", background: c.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ ...cardStyle(), width: "100%", maxWidth: 460, padding: 30, textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: c.text, marginBottom: 8 }}>Sin obra activa</div>
          <div style={{ color: c.muted, marginBottom: 18 }}>Da de alta una obra desde el módulo Obras para activar los checklist de calidad.</div>
        </div>
      </div>
    );
  }

  if (loadingData || qualityInitializing) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: c.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div style={{ ...cardStyle(), width: "100%", maxWidth: 420, padding: 30, textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: c.text, marginBottom: 8 }}>Cargando obra...</div>
          <div style={{ color: c.muted, marginBottom: 18 }}>
            {qualityInitializing ? "Activando unidades y checklist de calidad de la obra..." : "Cargando unidades y checklist de calidad de la obra activa."}
          </div>
        </div>
      </div>
    );
  }

  const checklistCompleted = (selectedPartida?.checklist || []).filter((item) => item.checked).length;
  const checklistTotal = (selectedPartida?.checklist || []).length;
  const checklistWithPhotos = (selectedPartida?.checklist || []).filter((item) => (item.photos || []).length > 0).length;
  const evaluacion = selectedPartida ? evaluarPartida(selectedPartida) : null;
const checklistItems = selectedPartida?.checklist || [];

const incompleteChecklistItems = checklistItems.filter((item) => !item.checked);
const checklistItemsWithoutPhotos = checklistItems.filter((item) => !item.photos || item.photos.length === 0);
const bitacoraPendientes = (selectedPartida?.generalComments || []).filter(
  (comment) => comment.blocksRelease && !["validado", "cerrado"].includes(comment.status)
);
const bitacoraPendientesSinSolventar = bitacoraPendientes.filter((comment) => comment.status !== "solventado");

const canSendToReview =
  checklistItems.length > 0 &&
  incompleteChecklistItems.length === 0 &&
  checklistItemsWithoutPhotos.length === 0;

const checklistWithoutResult = checklistItems.filter((item) => !item.resultado);
const allChecklistItemsEvaluated = checklistItems.length > 0 && checklistWithoutResult.length === 0;
const checklistNoCumple = checklistItems.filter((item) => item.resultado === "no_cumple");
const checklistObservacionWithoutComment = checklistItems.filter(
  (item) => item.resultado === "observacion" && !hasSupervisorComment(item)
);
const checklistReadyForApproval = checklistItems.filter(
  (item) =>
    item.resultado === "cumple" || item.resultado === "observacion" || item.resultado === "na"
);

const canSupervisorApprove =
  selectedPartida?.status === "Lista para revisión" &&
  allChecklistItemsEvaluated &&
  checklistNoCumple.length === 0 &&
  checklistObservacionWithoutComment.length === 0 &&
  bitacoraPendientes.length === 0 &&
  checklistReadyForApproval.length === checklistItems.length;

const canSupervisorRequestFixes =
  selectedPartida?.status === "Lista para revisión" &&
  checklistItems.length > 0 &&
  checklistNoCumple.length > 0;

const supervisorApproveBlockMessage =
  !allChecklistItemsEvaluated
    ? "La supervisora debe evaluar cada punto del checklist antes de aprobar."
    : checklistNoCumple.length > 0
    ? "No puedes aprobar porque hay puntos en 'No cumple'. Solicita subsanación."
    : checklistObservacionWithoutComment.length > 0
    ? "Cada punto con 'Cumple con observación' debe incluir comentario de la supervisora."
    : bitacoraPendientes.length > 0
    ? `No puedes aprobar porque hay ${bitacoraPendientes.length} pendiente(s) abierto(s) en la bitácora de la partida.`
    : checklistReadyForApproval.length !== checklistItems.length
    ? "Solo puedes aprobar si todos los puntos están en 'Cumple', 'Cumple con observación' o 'No aplica'."
    : "";

const reviewBlockMessage =
  incompleteChecklistItems.length > 0
    ? "Debes completar todos los puntos del checklist antes de enviar a revisión."
    : checklistItemsWithoutPhotos.length > 0
    ? "Debes subir al menos una foto en cada punto del checklist antes de enviar a revisión."
    : "";
  return (
    <div style={{ minHeight: "100vh", background: c.bg, padding: 24 }}>
      <div style={{ maxWidth: 1480, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            alignItems: "flex-start",
            marginBottom: 22,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <img src="/triton-logo.png" alt="Triton" style={{ width: isMobile ? 48 : 60, height: isMobile ? 48 : 60, objectFit: "contain", borderRadius: 18, background: "#111", padding: 6, boxShadow: "0 10px 24px rgba(0,0,0,0.12)" }} />
            <div>
            <div
              style={{
                fontSize: isMobile ? 28 : 34,
                fontWeight: 900,
                color: c.dark,
                letterSpacing: -0.6,
                lineHeight: 1.1,
              }}
            >
              Control de calidad
            </div>
            <div
              style={{
                color: c.muted,
                fontSize: isMobile ? 15 : 18,
                marginTop: 6,
                lineHeight: 1.35,
              }}
            >
              Sistema de evidencia, revisión de partidas y checklist por punto de control
            </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {obras.length > 1 ? (
              <select value={selectedObraId} onChange={(event) => { setSelectedObraId(event.target.value); setSelectedHouseId(""); }} style={{ ...inputStyle(), minWidth: 220, padding: "10px 12px" }}>
                {obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.name || obra.id}</option>)}
              </select>
            ) : null}
            <button onClick={() => setNotificationPanelOpen(true)} style={buttonStyle("primary", { position: "relative" })}>
              Mi panel
              {myOpenMentions.length > 0 ? (
                <span style={{ position: "absolute", top: -8, right: -8, background: c.danger, color: "#fff", borderRadius: 999, padding: "2px 7px", fontSize: 11, fontWeight: 900 }}>{myOpenMentions.length}</span>
              ) : null}
            </button>
            <span style={badgeStyle(profile?.role || "Pendiente")}>Rol: {profile?.role || "sin rol"}</span>
            <span style={badgeStyle("Pendiente")}>{authUser.email}</span>
            <button onClick={() => signOut(auth)} style={buttonStyle("secondary")}>
              Salir
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))",
            gap: 18,
            marginBottom: 22,
          }}
        >
          <StatCard title="Obra" value={selectedObra?.name || selectedObraId || "Sin obra activa"} />
          <StatCard title="Casas" value={houses.length} />
          <StatCard
            title="Partidas aprobadas"
            value={houses.flatMap((h) => h.partidas || []).filter((p) => p.status === "Aprobada").length}
          />
          <StatCard title="Avance general" value={`${getProjectProgress(houses)}%`}>
            <ProgressBar value={getProjectProgress(houses)} />
          </StatCard>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "340px 1fr",
            gap: 20,
          }}
        >
          <div style={{ ...cardStyle(), padding: 18 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.text, marginBottom: 14 }}>Casas</div>

            <input
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Buscar por número o bloque"
              style={inputStyle({ marginBottom: 16 })}
            />

            <div style={{ maxHeight: 660, overflow: "auto", paddingRight: 4 }}>
              {filteredHouses.length === 0 ? (
                <div style={{ color: c.muted, fontSize: 14 }}>No hay casas cargadas todavía.</div>
              ) : (
                filteredHouses.map((house) => (
                  <button
                    key={house.id}
                    onClick={() => setSelectedHouseId(house.id)}
                    style={{
                      ...cardStyle(selectedHouseId === house.id),
                      width: "100%",
                      textAlign: "left",
                      padding: 16,
                      marginBottom: 10,
                      cursor: "pointer",
                      background: selectedHouseId === house.id ? "#fff" : c.surface,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <div style={{ fontWeight: 800, color: c.text }}>{house.name}</div>
                      <span style={badgeStyle("Pendiente")}>Bloque {house.block || "-"}</span>
                    </div>
                    <div style={{ color: c.muted, fontSize: 12, marginTop: 10, marginBottom: 6 }}>
                      Avance {getHouseProgress(house)}%
                    </div>
                    <ProgressBar value={getHouseProgress(house)} />
                  </button>
                ))
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ ...cardStyle(), padding: 20 }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: c.text }}>{selectedHouse?.name || "Selecciona una casa"}</div>
              <div style={{ color: c.muted, marginTop: 4 }}>
                Bloque {selectedHouse?.block || "-"} · Avance {selectedHouse ? getHouseProgress(selectedHouse) : 0}%
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))",
                  gap: 12,
                  marginTop: 18,
                }}
              >
                {(selectedHouse?.partidas || []).map((partida) => (
                  <button
                    key={partida.id}
                    onClick={() => setSelectedPartidaId(partida.id)}
                    style={{
                      ...cardStyle(selectedPartidaId === partida.id),
                      textAlign: "left",
                      padding: 16,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 800, color: c.text }}>{partida.name}</div>
                        <div style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>Peso {partida.weight}%</div>
                      </div>
                      <span style={badgeStyle(partida.status)}>{partida.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: c.muted, marginTop: 14 }}>
                      Fotos {partida.evidenceCount?.photos || 0} · Videos {partida.evidenceCount?.videos || 0}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {selectedPartida ? (
              <>
                <div style={{ ...cardStyle(), padding: 20 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 16,
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 24, fontWeight: 900, color: c.text }}>{selectedPartida.name}</div>
                      <div style={{ color: c.muted, marginTop: 4 }}>
                        Aprobación final por partida · checklist con notas y fotos por punto de control
                      </div>
                      {evaluacion ? (
  <div style={{ marginTop: 10, fontWeight: 800, color: c.text }}>
    Estatus de calidad: {evaluacion.status} · {evaluacion.score.toFixed(1)}%
  </div>
) : null}
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {isConstructora ? (
  <button
    onClick={markReadyForReview}
    disabled={actionLoading || !canSendToReview}
    style={buttonStyle("primary", {
      opacity: actionLoading || !canSendToReview ? 0.6 : 1,
      cursor: actionLoading || !canSendToReview ? "not-allowed" : "pointer",
    })}
    title={!canSendToReview ? reviewBlockMessage : "Enviar partida a revisión"}
  >
    {actionLoading ? "Enviando..." : "Lista para revisión"}
  </button>
) : null}
{isConstructora && !canSendToReview ? (
  <div
    style={{
      marginTop: 12,
      padding: "12px 14px",
      borderRadius: 14,
      background: c.warnBg,
      color: c.warnText,
      fontSize: 13,
      fontWeight: 600,
    }}
  >
    {reviewBlockMessage}
  </div>
) : null}

                      {isSupervisora ? (
                        <>
                          <button
                            onClick={rejectPartida}
                            disabled={actionLoading || !canSupervisorRequestFixes}
                            style={buttonStyle("danger", {
                              opacity: actionLoading || !canSupervisorRequestFixes ? 0.6 : 1,
                              cursor: actionLoading || !canSupervisorRequestFixes ? "not-allowed" : "pointer",
                            })}
                            title={
                              !canSupervisorRequestFixes
                                ? "Para solicitar subsanación marca al menos un punto como 'No cumple'."
                                : "Solicitar correcciones a la constructora"
                            }
                          >
                            {actionLoading ? "Procesando..." : "Solicitar subsanación"}
                          </button>
                          <button
                            onClick={approvePartida}
                            disabled={actionLoading || !canSupervisorApprove}
                            style={buttonStyle("primary", {
                              opacity: actionLoading || !canSupervisorApprove ? 0.6 : 1,
                              cursor: actionLoading || !canSupervisorApprove ? "not-allowed" : "pointer",
                            })}
                            title={!canSupervisorApprove ? supervisorApproveBlockMessage : "Aprobar partida completa"}
                          >
                            {actionLoading ? "Procesando..." : "Aprobar"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {isSupervisora && !canSupervisorApprove ? (
                    <div
                      style={{
                        marginTop: 12,
                        padding: "12px 14px",
                        borderRadius: 14,
                        background: c.warnBg,
                        color: c.warnText,
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {supervisorApproveBlockMessage}
                    </div>
                  ) : null}

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))",
                      gap: 14,
                      marginTop: 18,
                    }}
                  >
                    <StatCard title="Estado" value={<span style={badgeStyle(selectedPartida.status)}>{selectedPartida.status}</span>} />
                    <StatCard title="Bitácora pendiente" value={bitacoraPendientes.length} />
                    <StatCard title="Puntos completos" value={`${checklistCompleted} / ${checklistTotal}`} />
                    <StatCard title="Puntos con fotos" value={`${checklistWithPhotos} / ${checklistTotal}`} />
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1.12fr 0.88fr",
                    gap: 20,
                    alignItems: "start",
                  }}
                >
                  <div style={{ ...cardStyle(), padding: 20 }}>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 24, fontWeight: 900, color: c.text }}>Checklist de la partida</div>
                      <div style={{ color: c.muted, fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>
                        Revisa punto por punto. Usa “Ver detalle” solo cuando necesites criterios, elementos o fotos por alcance.
                      </div>
                    </div>

                    {tab === "evidencia" ? (
                      <>
                        {isConstructora ? (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                              gap: 14,
                              marginBottom: 18,
                            }}
                          >
                            <label
                              style={{
                                border: `2px dashed ${c.border}`,
                                borderRadius: 18,
                                padding: 24,
                                background: c.panelSoft,
                                textAlign: "center",
                                cursor: "pointer",
                              }}
                            >
                              <div style={{ fontSize: 18, fontWeight: 800, color: c.text }}>Subir fotos generales</div>
                              <div style={{ color: c.muted, fontSize: 13, marginTop: 6 }}>JPG, PNG o HEIC</div>
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                style={{ display: "none" }}
                                onChange={(e) => handleUpload("photo", e.target.files)}
                              />
                            </label>

                            <label
                              style={{
                                border: `2px dashed ${c.border}`,
                                borderRadius: 18,
                                padding: 24,
                                background: c.panelSoft,
                                textAlign: "center",
                                cursor: "pointer",
                              }}
                            >
                              <div style={{ fontSize: 18, fontWeight: 800, color: c.text }}>Subir videos</div>
                              <div style={{ color: c.muted, fontSize: 13, marginTop: 6 }}>Recorrido continuo</div>
                              <input
                                type="file"
                                accept="video/*"
                                multiple
                                style={{ display: "none" }}
                                onChange={(e) => handleUpload("video", e.target.files)}
                              />
                            </label>
                          </div>
                        ) : null}

                        {uploading ? (
                          <div
                            style={{
                              marginBottom: 16,
                              padding: "12px 14px",
                              borderRadius: 14,
                              background: c.idleBg,
                              color: c.idleText,
                              fontSize: 14,
                              fontWeight: 700,
                            }}
                          >
                            Subiendo archivos...
                          </div>
                        ) : null}

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                            gap: 16,
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: c.text, marginBottom: 10 }}>Fotos generales</div>
                            {evidencias.filter((e) => e.type === "photo").length === 0 ? (
                              <div
                                style={{
                                  border: `1px solid ${c.border}`,
                                  borderRadius: 16,
                                  padding: 14,
                                  background: c.panelSoft,
                                  color: c.muted,
                                }}
                              >
                                No hay fotos cargadas
                              </div>
                            ) : (
                              <>
  <ChecklistPhotoGrid
    photos={evidencias.filter((e) => e.type === "photo")}
    onPreview={openPhotoPreview}
  />

  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
    {evidencias
      .filter((e) => e.type === "photo")
      .map((file) => (
        <button
          key={`delete-general-${file.id}`}
          onClick={() => deleteGeneralEvidence(file)}
          style={buttonStyle("danger", { padding: "8px 12px", fontSize: 12 })}
        >
          Borrar {file.fileName || "foto"}
        </button>
      ))}
  </div>
</>
                            )}
                          </div>

                          <div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: c.text, marginBottom: 10 }}>Videos</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              {evidencias.filter((e) => e.type === "video").length === 0 ? (
                                <div
                                  style={{
                                    border: `1px solid ${c.border}`,
                                    borderRadius: 16,
                                    padding: 14,
                                    background: c.panelSoft,
                                    color: c.muted,
                                  }}
                                >
                                  No hay videos cargados
                                </div>
                              ) : (
                                evidencias
                                  .filter((e) => e.type === "video")
                                  .map((file) => (
                                    <a
                                      key={file.id}
                                      href={file.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{
                                        border: `1px solid ${c.border}`,
                                        borderRadius: 16,
                                        padding: 14,
                                        background: "#fff",
                                        textDecoration: "none",
                                      }}
                                    >
                                      <div style={{ fontWeight: 700, color: c.text }}>{file.fileName}</div>
                                      <div style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>{file.createdByName}</div>
                                    </a>
                                  ))
                              )}
                            </div>
                          </div>
                        </div>
                      </>
                    ) : null}

                    {tab === "checklist" ? (
  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    {(selectedPartida.checklist || []).map((item) => (
      <div key={item.id} style={{ ...cardStyle(), padding: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 220 }}>
            <button
              onClick={() => toggleChecklistItem(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                border: "none",
                background: "transparent",
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 20 }}>{item.checked ? "✅" : "⬜"}</span>
              <span style={{ fontWeight: 800, color: c.text }}>{item.code} · {item.label}</span>
              {isSupervisora ? (
  <div style={{ marginTop: 10, maxWidth: 280 }}>
    <select
      value={item.resultado || ""}
      onChange={(e) => updateChecklistItem(item.id, { resultado: e.target.value })}
      style={inputStyle()}
    >
      <option value="">Pendiente de evaluar</option>
      <option value="cumple">Cumple</option>
      <option value="observacion">Cumple con observación</option>
      <option value="no_cumple">No cumple</option>
      <option value="na">No aplica</option>
    </select>
  </div>
) : (
  <div style={{ marginTop: 8, fontSize: 13, color: c.muted }}>
    Resultado: {item.resultado || "Pendiente de evaluar"}
  </div>
)}
            </button>

            <div style={{ color: c.muted, fontSize: 12, marginTop: 8 }}>
              {item.photos?.length || 0} foto(s) · {item.checked ? "Punto atendido" : "Pendiente"} · Hito {item.stagePercent || 100}%
            </div>
            {(() => {
              const progress = scopeProgressForItem(item);
              if (!progress.total) return null;
              return (
                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ border: `1px solid ${c.border}`, borderRadius: 999, padding: "6px 10px", background: "#fff", fontSize: 12, fontWeight: 900, color: c.text }}>
                    Alcance: {progress.complete}/{progress.total} elementos revisados
                  </span>
                  {progress.pending ? <span style={{ borderRadius: 999, padding: "6px 10px", background: c.warnBg, color: c.warnText, fontSize: 12, fontWeight: 900 }}>{progress.pending} pendientes</span> : null}
                  {progress.observed ? <span style={{ borderRadius: 999, padding: "6px 10px", background: c.dangerBg, color: c.dangerText, fontSize: 12, fontWeight: 900 }}>{progress.observed} observados</span> : null}
                </div>
              );
            })()}
            {(() => {
              const progress = scopeProgressForItem(item);
              if (!progress.total || item.requiresPhotos === false) return null;
              return (
                <div style={{ marginTop: 8, fontSize: 12, color: c.muted, fontWeight: 800 }}>
                  Fotos configuradas: {item.evidenceLevel === "punto" ? "a nivel punto del checklist" : "por cada elemento / zona del alcance"}.
                </div>
              );
            })()}
            <button
              type="button"
              onClick={() => setChecklistDetailOpen((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
              style={{ ...buttonStyle("secondary", { marginTop: 10, padding: "8px 12px", fontSize: 12 }) }}
            >
              {checklistDetailOpen[item.id] ? "Ocultar detalle" : "Ver detalle del criterio"}
            </button>
          </div>

          {isConstructora ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label style={buttonStyle("secondary", { display: "inline-flex", alignItems: "center" })}>
                {checklistUploading[item.id] ? "Subiendo..." : ((scopeProgressForItem(item).total && item.evidenceLevel !== "punto") ? "Foto general opcional" : "Tomar foto del punto")}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: "none" }}
                  onChange={(e) => handleChecklistPhotoUpload(item.id, e.target.files)}
                />
              </label>

              <label style={buttonStyle("secondary", { display: "inline-flex", alignItems: "center" })}>
                {checklistUploading[item.id] ? "Subiendo..." : ((scopeProgressForItem(item).total && item.evidenceLevel !== "punto") ? "Subir fotos generales" : "Subir fotos del punto")}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => handleChecklistPhotoUpload(item.id, e.target.files)}
                />
              </label>
            </div>
          ) : null}
        </div>

        {checklistDetailOpen[item.id] ? (
          <div style={{ marginTop: 14, border: `1px solid ${c.border}`, borderRadius: 18, padding: 14, background: "#fff" }}>
            <div style={{ fontWeight: 900, color: c.text, marginBottom: 8 }}>Detalle técnico del punto</div>
            {(() => {
              const progress = scopeProgressForItem(item);
              const scopes = progress.scopes;
              if (!scopes.length) return null;
              return (
                <div style={{ border: `1px solid ${c.border}`, borderRadius: 18, padding: 14, background: "#f8fafc", marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 950, color: c.text }}>Alcance por elementos / zonas</div>
                      <div style={{ color: c.muted, fontSize: 12, marginTop: 3 }}>
                        Relación generada desde Configuración inteligente de obra. Si el punto está configurado "por alcance", la evidencia debe subirse en cada elemento/zona.
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ borderRadius: 999, padding: "6px 10px", background: "#fff", border: `1px solid ${c.border}`, fontSize: 12, fontWeight: 900 }}>{progress.complete}/{progress.total} completos</span>
                      {progress.pending ? <span style={{ borderRadius: 999, padding: "6px 10px", background: c.warnBg, color: c.warnText, fontSize: 12, fontWeight: 900 }}>{progress.pending} pendientes</span> : null}
                      {progress.observed ? <span style={{ borderRadius: 999, padding: "6px 10px", background: c.dangerBg, color: c.dangerText, fontSize: 12, fontWeight: 900 }}>{progress.observed} observados</span> : null}
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {scopes.map((scope) => {
                      const result = item.scopeResults?.[scope.id] || {};
                      const status = result.resultado || "pendiente";
                      const statusMap = {
                        cumple: { label: "Cumple", bg: c.successBg, color: c.successText },
                        no_cumple: { label: "No cumple", bg: c.dangerBg, color: c.dangerText },
                        observacion: { label: "Observación", bg: c.warnBg, color: c.warnText },
                        na: { label: "No aplica", bg: c.idleBg, color: c.idleText },
                        pendiente: { label: "Pendiente", bg: "#fff", color: c.muted },
                      }[status] || { label: "Pendiente", bg: "#fff", color: c.muted };
                      return (
                        <div key={scope.id} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.3fr 1fr 1.1fr", gap: 10, alignItems: "center", border: `1px solid ${c.border}`, borderRadius: 14, padding: 10, background: "#fff" }}>
                          <div>
                            <div style={{ fontWeight: 900, color: c.text }}>{scope.elementName || scope.zone || "Elemento"}</div>
                            <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{scope.elementType || "Tipo"}{scope.zone ? ` · ${scope.zone}` : ""}</div>
                          </div>
                          <div>
                            <span style={{ display: "inline-flex", borderRadius: 999, padding: "6px 10px", background: statusMap.bg, color: statusMap.color, fontWeight: 900, fontSize: 12 }}>{statusMap.label}</span>
                            {result.updatedBy ? <div style={{ fontSize: 11, color: c.muted, marginTop: 4 }}>Actualizó: {result.updatedBy} · {result.updatedByRole || "rol"}</div> : null}
                            {item.requiresPhotos === false ? (
                              <div style={{ fontSize: 11, color: c.muted, marginTop: 4 }}>Fotos no obligatorias en este punto.</div>
                            ) : item.evidenceLevel === "punto" ? (
                              <div style={{ fontSize: 11, color: c.muted, marginTop: 4 }}>La foto se sube a nivel punto del checklist, no por elemento.</div>
                            ) : (
                              <div style={{ fontSize: 11, color: (result.photos?.length || 0) >= Number(item.evidenceRequired || 0) ? c.successText : c.warnText, marginTop: 4 }}>
                                Fotos: {result.photos?.length || 0}/{Number(item.evidenceRequired || 0)} requeridas
                              </div>
                            )}
                            {result.photos?.length ? (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                                {result.photos.slice(0, 4).map((photo, pIndex) => (
                                  <button key={photo.id || pIndex} type="button" onClick={() => openPhotoPreview(photo, result.photos)} style={{ border: 0, background: "transparent", padding: 0, cursor: "zoom-in" }}>
                                    <img src={photo.url} alt={photo.fileName || "Evidencia"} style={{ width: 42, height: 42, objectFit: "cover", borderRadius: 10, border: `1px solid ${c.border}` }} />
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: isMobile ? "flex-start" : "flex-end" }}>
                            {item.requiresPhotos !== false && item.evidenceLevel !== "punto" ? (
                              <label style={{ ...buttonStyle("secondary", { padding: "7px 9px", fontSize: 12, display: "inline-flex", alignItems: "center" }) }}>
                                {checklistUploading[`${item.id}-${scope.id}`] ? "Subiendo..." : "Subir foto del elemento"}
                                <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => handleChecklistScopePhotoUpload(item.id, scope.id, e.target.files)} />
                              </label>
                            ) : null}
                            <button type="button" onClick={() => updateChecklistScopeResult(item.id, scope.id, { resultado: "cumple" })} style={{ ...buttonStyle("secondary", { padding: "7px 9px", fontSize: 12, background: status === "cumple" ? c.successBg : "#fff", color: status === "cumple" ? c.successText : c.text }) }}>Cumple</button>
                            <button type="button" onClick={() => updateChecklistScopeResult(item.id, scope.id, { resultado: "no_cumple" })} style={{ ...buttonStyle("secondary", { padding: "7px 9px", fontSize: 12, background: status === "no_cumple" ? c.dangerBg : "#fff", color: status === "no_cumple" ? c.dangerText : c.text }) }}>No cumple</button>
                            <button type="button" onClick={() => updateChecklistScopeResult(item.id, scope.id, { resultado: "na" })} style={{ ...buttonStyle("secondary", { padding: "7px 9px", fontSize: 12, background: status === "na" ? c.idleBg : "#fff" }) }}>N/A</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            {item.criterioAceptacion ? <div style={{ marginBottom: 8 }}><strong>Criterio de aceptación:</strong><div style={{ color: c.muted, marginTop: 4 }}>{item.criterioAceptacion}</div></div> : null}
            {item.formaVerificacion ? <div style={{ marginBottom: 8 }}><strong>Forma de verificación:</strong><div style={{ color: c.muted, marginTop: 4 }}>{item.formaVerificacion}</div></div> : null}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
              {item.puntosAceptables ? <div style={{ border: "1px solid #c7eed8", borderRadius: 14, padding: 12, background: "#f0fff6" }}><strong style={{ color: c.successText }}>Aceptable</strong><div style={{ color: c.text, marginTop: 6 }}>{item.puntosAceptables}</div></div> : null}
              {item.puntosNoAceptables ? <div style={{ border: "1px solid #ffd2d2", borderRadius: 14, padding: 12, background: "#fff5f5" }}><strong style={{ color: c.dangerText }}>No aceptable</strong><div style={{ color: c.text, marginTop: 6 }}>{item.puntosNoAceptables}</div></div> : null}
            </div>
            {(() => {
              const imgs = [
                item.imagenIncorrecto ? { kind: "incorrecto", url: item.imagenIncorrecto, label: "Ejemplo incorrecto", color: c.dangerText } : null,
                item.imagenCorrecto ? { kind: "correcto", url: item.imagenCorrecto, label: "Ejemplo correcto", color: c.successText } : null,
              ].filter(Boolean);
              const uniqueImgs = imgs.filter((img, index, arr) => arr.findIndex((candidate) => candidate.url === img.url) === index);
              if (!uniqueImgs.length) return null;
              const singleReference = uniqueImgs.length === 1;
              const previewItems = uniqueImgs.map((img, idx) => ({
                id: `${item.id}-ref-${idx}`,
                url: img.url,
                fileName: `${item.codigo || item.label || "Criterio"} · ${singleReference ? "Imagen de referencia" : img.label}`,
                uploadedByName: "Manual de calidad",
              }));
              return (
                <div style={{ display: "grid", gridTemplateColumns: isMobile || singleReference ? "1fr" : "1fr 1fr", gap: 12, marginTop: 12 }}>
                  {uniqueImgs.map((img, idx) => (
                    <button
                      key={`${img.kind}-${idx}`}
                      type="button"
                      onClick={() => openPhotoPreview(previewItems[idx], previewItems)}
                      title="Haz clic para ampliar la imagen"
                      style={{ border: 0, background: "transparent", padding: 0, margin: 0, textAlign: "left", cursor: "zoom-in" }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 900, color: singleReference ? c.text : img.color, marginBottom: 6 }}>
                        {singleReference ? "Imagen de referencia del criterio" : img.label}
                      </div>
                      <img src={img.url} alt={singleReference ? "Imagen de referencia del criterio" : img.label} style={{ width: "100%", maxHeight: 520, objectFit: "contain", borderRadius: 14, border: `1px solid ${c.border}`, display: "block", background: "#fff" }} />
                      <div style={{ fontSize: 11, color: c.muted, marginTop: 6 }}>Clic para ampliar</div>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        ) : null}
        <div style={{ marginTop: 14 }}>
          <CommentThread comments={item.comments || []} onPreview={openPhotoPreview} />
        </div>

        <div style={{ marginTop: 14 }}>
          <textarea
            rows={3}
            value={checklistCommentDrafts[item.id] || ""}
            onChange={(e) =>
              setChecklistCommentDrafts((prev) => ({
                ...prev,
                [item.id]: e.target.value,
              }))
            }
            placeholder={
              isSupervisora
                ? "Escribe una observación oficial de este punto"
                : "Escribe una respuesta o aclaración de este punto"
            }
            style={inputStyle({ minHeight: 90, resize: "vertical", lineHeight: 1.5 })}
          />

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <label style={buttonStyle("secondary", { display: "inline-flex", alignItems: "center" })}>
                Adjuntar fotos
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => onPickChecklistCommentPhotos(item.id, e.target.files)}
                />
              </label>
              <button
                onClick={() => addChecklistComment(item.id)}
                disabled={checklistCommentUploading[item.id]}
                style={buttonStyle("primary", {
                  opacity: checklistCommentUploading[item.id] ? 0.6 : 1,
                  cursor: checklistCommentUploading[item.id] ? "not-allowed" : "pointer",
                })}
              >
                {checklistCommentUploading[item.id] ? "Guardando..." : "Agregar comentario"}
              </button>
            </div>
          </div>
        </div>

        {(checklistCommentPhotoDrafts[item.id] || []).length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: c.muted, marginBottom: 8 }}>
              Fotos por publicar (se suben al dar clic en “Agregar comentario”)
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))",
                gap: 8,
              }}
            >
              {(checklistCommentPhotoDrafts[item.id] || []).map((draftPhoto) => (
                <div
                  key={draftPhoto.id}
                  style={{
                    border: `1px solid ${c.border}`,
                    borderRadius: 12,
                    padding: 6,
                    background: "#fff",
                  }}
                >
                  <img
                    src={draftPhoto.previewUrl}
                    alt={draftPhoto.fileName}
                    style={{ width: "100%", height: 84, objectFit: "cover", borderRadius: 8, display: "block" }}
                  />
                  <button
                    onClick={() => removeDraftChecklistCommentPhoto(item.id, draftPhoto.id)}
                    style={buttonStyle("danger", { marginTop: 6, width: "100%", padding: "6px 8px", fontSize: 12 })}
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: 14 }}>
          <ChecklistPhotoGrid photos={item.photos || []} onPreview={openPhotoPreview} />

          {(item.photos || []).length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {(item.photos || []).map((photo) => (
                <button
                  key={`delete-${photo.id}`}
                  onClick={() => deleteChecklistPhoto(item.id, photo.id)}
                  style={buttonStyle("danger", { padding: "8px 12px", fontSize: 12 })}
                >
                  Borrar {photo.fileName || "foto"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    ))}
  </div>
) : null}

                    <div id="bitacora-partida" style={{ marginTop: 18, borderTop: `1px solid ${c.border}`, paddingTop: 18 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 22, fontWeight: 900, color: c.text }}>Bitácora de la partida</div>
                          <div style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>
                            Aquí se concentran comentarios, fotos generales, acuerdos y pendientes de la partida. Sustituye Evidencia y Notas.
                          </div>
                        </div>
                        <span style={badgeStyle(bitacoraPendientes.length > 0 ? "Observada" : "Aprobada")}>
                          {bitacoraPendientes.length > 0 ? `${bitacoraPendientes.length} pendiente(s)` : "Sin pendientes"}
                        </span>
                      </div>

                      <CommentThread
                        comments={selectedPartida.generalComments || []}
                        onPreview={openPhotoPreview}
                        onStatusChange={updateGeneralCommentStatus}
                        canValidate={isSupervisora}
                        users={allMentionUsers}
                      />

                      <div style={{ marginTop: 14, padding: 14, border: `1px solid ${c.border}`, borderRadius: 16, background: c.panelSoft }}>
                        <MentionTextarea
                          rows={4}
                          value={generalCommentDraft}
                          onChange={setGeneralCommentDraft}
                          users={allMentionUsers}
                          placeholder={isSupervisora ? "Escribe observación o acuerdo. Usa @ y selecciona con Enter para etiquetar." : "Escribe comentario, avance o respuesta. Usa @ y selecciona con Enter para etiquetar."}
                          style={inputStyle({ minHeight: 110, resize: "vertical", lineHeight: 1.5, background: "#fff" })}
                        />

                        {allMentionUsers.length > 0 ? (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: 12, color: c.muted, marginBottom: 6 }}>Etiquetar rápido</div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {allMentionUsers.slice(0, 12).map((user) => {
                                const handle = userMentionHandle(user);
                                return (
                                  <button
                                    key={user.id || user.uid || handle}
                                    type="button"
                                    onClick={() => setGeneralCommentDraft((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}@${handle} `)}
                                    style={buttonStyle("secondary", { padding: "6px 9px", fontSize: 12 })}
                                  >
                                    @{handle}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, color: c.text, fontWeight: 700 }}>
                          <input
                            type="checkbox"
                            checked={generalCommentBlocksRelease}
                            onChange={(e) => setGeneralCommentBlocksRelease(e.target.checked)}
                          />
                          Este comentario requiere seguimiento y bloquea la liberación hasta validarse
                        </label>

                        {(generalCommentPhotoDrafts || []).length > 0 ? (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ fontSize: 12, color: c.muted, marginBottom: 8 }}>Fotos por publicar en la bitácora</div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))", gap: 8 }}>
                              {(generalCommentPhotoDrafts || []).map((draftPhoto) => (
                                <div key={draftPhoto.id} style={{ border: `1px solid ${c.border}`, borderRadius: 12, padding: 6, background: "#fff" }}>
                                  <img src={draftPhoto.previewUrl} alt={draftPhoto.fileName} style={{ width: "100%", height: 84, objectFit: "cover", borderRadius: 8, display: "block" }} />
                                  <button onClick={() => removeDraftGeneralCommentPhoto(draftPhoto.id)} style={buttonStyle("danger", { marginTop: 6, width: "100%", padding: "6px 8px", fontSize: 12 })}>Quitar</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                          <label style={buttonStyle("secondary", { display: "inline-flex", alignItems: "center" })}>
                            Adjuntar fotos
                            <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => onPickGeneralCommentPhotos(e.target.files)} />
                          </label>
                          <button onClick={addGeneralComment} disabled={generalCommentUploading} style={buttonStyle("primary", { opacity: generalCommentUploading ? 0.6 : 1 })}>
                            {generalCommentUploading ? "Guardando..." : "Agregar a bitácora"}
                          </button>
                        </div>
                      </div>
                    </div>

                            
                    {tab === "notas" ? (
  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <CommentThread comments={selectedPartida.generalComments || []} />

    <textarea
      rows={5}
      value={generalCommentDraft}
      onChange={(e) => setGeneralCommentDraft(e.target.value)}
      placeholder={
        isSupervisora
          ? "Escribe una observación general de la partida"
          : "Escribe una respuesta o comentario general de la partida"
      }
      style={{
        ...inputStyle({
          minHeight: 120,
          resize: "vertical",
          lineHeight: 1.5,
        }),
      }}
    />

    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <button onClick={addGeneralComment} style={buttonStyle("primary")}>
        Agregar comentario
      </button>
    </div>
  </div>
) : null}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    <div style={{ ...cardStyle(), padding: 20 }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: c.text, marginBottom: 14 }}>Resumen rápido</div>
                      <div style={{ display: "grid", gap: 12 }}>
                        <div
                          style={{
                            border: `1px solid ${c.border}`,
                            borderRadius: 16,
                            padding: 14,
                            background: c.panelSoft,
                          }}
                        >
                          <div style={{ color: c.muted, fontSize: 13 }}>Casa</div>
                          <div style={{ color: c.text, fontWeight: 800, marginTop: 4 }}>{selectedHouse?.name || "-"}</div>
                        </div>

                        <div
                          style={{
                            border: `1px solid ${c.border}`,
                            borderRadius: 16,
                            padding: 14,
                            background: c.panelSoft,
                          }}
                        >
                          <div style={{ color: c.muted, fontSize: 13 }}>Partida</div>
                          <div style={{ color: c.text, fontWeight: 800, marginTop: 4 }}>{selectedPartida?.name || "-"}</div>
                        </div>

                        <div
                          style={{
                            border: `1px solid ${c.border}`,
                            borderRadius: 16,
                            padding: 14,
                            background: c.panelSoft,
                          }}
                        >
                          <div style={{ color: c.muted, fontSize: 13 }}>Checklist completado</div>
                          <div style={{ color: c.text, fontWeight: 800, marginTop: 4 }}>{checklistCompleted} / {checklistTotal}</div>
                        </div>

                        <div
                          style={{
                            border: `1px solid ${c.border}`,
                            borderRadius: 16,
                            padding: 14,
                            background: c.panelSoft,
                          }}
                        >
                          <div style={{ color: c.muted, fontSize: 13 }}>Pendientes de bitácora</div>
                          <div style={{ color: c.text, fontWeight: 800, marginTop: 4 }}>{bitacoraPendientes.length}</div>
                        </div>
                      </div>
                    </div>

                    <div style={{ ...cardStyle(), padding: 20 }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: c.text, marginBottom: 14 }}>Regla operativa</div>
                      <div style={{ color: c.muted, lineHeight: 1.6 }}>
                        La partida solo se puede liberar cuando todos los puntos aplicables estén evaluados y la bitácora general no tenga pendientes abiertos. La constructora sube evidencia y marca solventado; supervisión valida el cierre.
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {notificationPanelOpen ? (
        <div
          style={{
            position: "fixed",
            right: isMobile ? 12 : 24,
            top: isMobile ? 12 : 24,
            bottom: isMobile ? 12 : 24,
            width: isMobile ? "calc(100vw - 24px)" : 430,
            background: "#fff",
            border: `1px solid ${c.border}`,
            borderRadius: 24,
            boxShadow: "0 24px 80px rgba(15, 23, 42, 0.22)",
            zIndex: 900,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 18, borderBottom: `1px solid ${c.border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, color: c.text }}>Mi panel</div>
              <div style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>Comentarios donde te etiquetaron con @. La pantalla de atrás queda activa.</div>
            </div>
            <button onClick={() => setNotificationPanelOpen(false)} style={buttonStyle("secondary", { padding: "8px 10px" })}>Cerrar</button>
          </div>

          <div style={{ padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ border: `1px solid ${c.border}`, borderRadius: 16, padding: 12, background: c.panelSoft }}>
              <div style={{ fontSize: 12, color: c.muted }}>Abiertos</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: c.text }}>{myOpenMentions.length}</div>
            </div>
            <div style={{ border: `1px solid ${c.border}`, borderRadius: 16, padding: 12, background: c.panelSoft }}>
              <div style={{ fontSize: 12, color: c.muted }}>Total etiquetas</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: c.text }}>{myMentions.length}</div>
            </div>
          </div>

          <div style={{ padding: "0 14px 14px", overflow: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            {myMentions.length === 0 ? (
              <div style={{ border: `1px dashed ${c.border}`, borderRadius: 16, padding: 14, color: c.muted, background: c.panelSoft }}>
                No tienes etiquetas todavía. Cuando alguien escriba tu @usuario en la bitácora de una partida, aparecerá aquí.
              </div>
            ) : myMentions.map((item) => (
              <button
                key={item.id}
                onClick={() => openMentionItem(item)}
                style={{
                  border: `1px solid ${item.open ? c.warn : c.border}`,
                  borderRadius: 16,
                  padding: 14,
                  background: item.open ? c.warnBg : "#fff",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div style={{ fontWeight: 900, color: c.text }}>{item.houseName || item.houseId} · {item.partidaName || item.partidaId}</div>
                  <span style={badgeStyle(item.open ? "Observada" : "Aprobada")}>{item.open ? "Abierto" : "Cerrado"}</span>
                </div>
                <div style={{ fontSize: 12, color: c.muted, marginTop: 6 }}>{item.comment.authorName || "Usuario"} · {item.comment.createdAt ? new Date(item.comment.createdAt).toLocaleString() : ""}</div>
                <div style={{ color: c.text, marginTop: 8, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.comment.text}</div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {previewPhoto ? (
        <div
          onClick={() => setPreviewPhoto(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.82)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(100%, 980px)",
              background: "#fff",
              borderRadius: 24,
              overflow: "hidden",
              boxShadow: c.shadow,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottom: `1px solid ${c.border}` }}>
              <div>
                <div style={{ fontWeight: 800, color: c.text }}>{previewPhoto.fileName || "Foto"}</div>
                <div style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>{previewPhoto.uploadedByName || previewPhoto.createdByName || "Sin autor"}</div>
              </div>
              <button onClick={() => setPreviewPhoto(null)} style={buttonStyle("secondary")}>Cerrar</button>
            </div>

            <div style={{ position: "relative", background: "#0f172a" }}>
              <img
                src={previewPhoto.url}
                alt={previewPhoto.fileName || "Foto"}
                style={{ width: "100%", maxHeight: "72vh", objectFit: "contain", display: "block" }}
              />
              <button
                onClick={() => goPreview(-1)}
                disabled={previewGallery.findIndex((p) => p.id === previewPhoto.id) <= 0}
                style={buttonStyle("secondary", { position: "absolute", top: "50%", left: 16, transform: "translateY(-50%)", opacity: 0.95 })}
              >
                ←
              </button>
              <button
                onClick={() => goPreview(1)}
                disabled={previewGallery.findIndex((p) => p.id === previewPhoto.id) >= previewGallery.length - 1}
                style={buttonStyle("secondary", { position: "absolute", top: "50%", right: 16, transform: "translateY(-50%)", opacity: 0.95 })}
              >
                →
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
