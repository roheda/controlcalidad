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
import { zonaTemplates, zonaAliases, aseguramientoManualSpecs, entregaManualSpecs } from "./qualityManualSeed";

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

const baseSystemUsers = [
  { id: "master-rodrigo", uid: "master-rodrigo", name: "Rodrigo Herrera", role: "master", email: "rodrigo@tritondesarrollos.com", mentionHandle: "rodrigo", isSystem: true },
  { id: "finanzas-admin", uid: "finanzas-admin", name: "Administración / Finanzas", role: "finanzas_pagos", email: "admin@tritondesarrollos.com", mentionHandle: "admin", isSystem: true },
  { id: "supervision-calidad", uid: "supervision-calidad", name: "Supervisión Calidad y Obra", role: "supervisora", email: "supervision@tritondesarrollos.com", mentionHandle: "supervision", isSystem: true },
];

const systemProfileByEmail = {
  "rodrigo@tritondesarrollos.com": { name: "Rodrigo Herrera", role: "master", permissions: "all" },
  "admin@tritondesarrollos.com": { name: "Administración / Finanzas", role: "finanzas_pagos", permissions: "finanzas_pagos" },
  "supervision@tritondesarrollos.com": { name: "Supervisión Calidad y Obra", role: "supervisora", permissions: "obra_calidad" },
};


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

const partidaOrderIndex = Object.fromEntries(partidaTemplates.map((t, i) => [t.id, i]));
const zonaOrderIndex = Object.fromEntries(zonaTemplates.map((t, i) => [t.id, i]));

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
  if (spec.checklistType === "entrega") return spec.partidaId || zonaAliases[codePrefix] || "general";
  if (qualityPartidaAliases[codePrefix]) return qualityPartidaAliases[codePrefix];
  if (zonaAliases[codePrefix]) return zonaAliases[codePrefix];
  const raw = slugify(spec.partida || "").replace(/-/g, "_");
  const map = { preliminares: "preliminares", excavacion: "excavacion", cimentacion: "cimentacion", colado: "colado", estructura: "estructura", losa: "losa", albanileria: "albanileria", hidraulicas: "hidraulicas", instalaciones_hidraulicas: "hidraulicas", electricas: "electricas", instalaciones_electricas: "electricas", aplanados: "aplanados", pisos: "pisos", impermeabilizacion: "impermeabilizante", impermeabilizante: "impermeabilizante", canceleria: "canceleria", general: "general" };
  return map[raw] || raw || "general";
}
function qualitySpecsForPartida(partidaId, specs = []) {
  return (specs || []).filter((spec) => (spec.partidaId || qualityPartidaIdFromSpec(spec)) === partidaId && spec.active !== false);
}

const c = {
  bg: "#F6F3EE",
  panelSoft: "#F3EEE4",
  surface: "#ffffff",
  border: "rgba(60,60,67,0.14)",
  text: "#242322",
  muted: "#6B6862",
  dark: "#1c1b1a",
  primary: "#F5B21A",
  primaryContrast: "#242322",
  primarySoft: "rgba(245,178,26,0.14)",
  primaryText: "#8A6400",
  successBg: "#e8f7ed",
  successText: "#157347",
  warnBg: "#fff3cd",
  warnText: "#9a6700",
  danger: "#ff3b30",
  dangerBg: "#fdecec",
  dangerText: "#b42318",
  idleBg: "#eef2f6",
  idleText: "#475467",
  shadow: "0 8px 28px rgba(0,0,0,0.055)",
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

const roleLabels = {
  master: "Administrador",
  finanzas_pagos: "Finanzas",
  supervisora: "Supervisión",
  constructora: "Constructora",
};
function roleLabel(role) {
  return roleLabels[role] || (role ? "Usuario" : "Cargando…");
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
    color: c.primaryContrast,
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
        background: "rgba(60,60,67,0.10)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${safe}%`,
          height: "100%",
          background: "linear-gradient(90deg, #F5B21A 0%, #8A6400 100%)",
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

function getHouseQualityScore(house, key) {
  const stages = house?.[key] || [];
  let totalItems = 0;
  let doneItems = 0;
  let sumScore = 0;
  let scoredStages = 0;
  let stagesComplete = 0;
  stages.forEach((stage) => {
    const items = stage.checklist || [];
    totalItems += items.length;
    doneItems += items.filter((item) => item.resultado).length;
    if (items.length && items.every((item) => item.resultado)) stagesComplete += 1;
    if (items.some((item) => item.resultado)) {
      sumScore += evaluarPartida(stage).score;
      scoredStages += 1;
    }
  });
  return {
    avance: totalItems ? Math.round((doneItems / totalItems) * 100) : 0,
    calidad: scoredStages ? Math.round(sumScore / scoredStages) : 0,
    stagesTotal: stages.length,
    stagesComplete,
  };
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
  baseSystemUsers.forEach((sample) => {
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
                  {user.isSample ? "Ejemplo" : roleLabel(user.role)}
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
              {comment.authorRole ? <span style={{ color: c.muted, fontWeight: 600 }}> · {roleLabel(comment.authorRole)}</span> : null}
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
        <div style={{ fontSize: 32, fontWeight: 800, color: c.text, marginBottom: 8 }}>TRITON OS</div>
        <div style={{ color: c.muted, marginBottom: 22 }}>Acceso operativo, calidad, finanzas y supervisión</div>

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

function ZonaResultButtons({ item, onSetResultado }) {
  const options = [
    { value: "cumple", label: "✅ Cumple", bg: c.successBg, text: c.successText },
    { value: "observacion", label: "⚠️ Observación", bg: c.warnBg, text: c.warnText },
    { value: "no_cumple", label: "❌ No cumple", bg: c.dangerBg, text: c.dangerText },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
      {options.map((opt) => {
        const active = item.resultado === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSetResultado(item.id, opt.value)}
            style={{
              ...buttonStyle("secondary", { padding: "12px 8px", fontSize: 13, fontWeight: 800 }),
              background: active ? opt.bg : "#fff",
              color: active ? opt.text : c.text,
              border: active ? `2px solid ${opt.text}` : `1px solid ${c.border}`,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ZonaChecklistItemCard({ item, uploading, onSetResultado, onNoteChange, onUploadPhoto, onDeletePhoto, onPreviewPhoto }) {
  const requiredPhotos = Number(item.evidenceRequired || 0);
  const photosNeeded = Math.max(0, requiredPhotos - (item.photos?.length || 0));
  const statusColor = item.resultado === "cumple" ? c.successText : item.resultado === "no_cumple" ? c.dangerText : item.resultado === "observacion" ? c.warnText : c.muted;
  return (
    <div style={{ ...cardStyle(), padding: 16, borderLeft: `6px solid ${statusColor}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, color: c.text, fontSize: 15 }}>{item.code} · {item.label}</div>
        {item.resultado ? <span style={badgeStyle(item.resultado === "cumple" ? "Aprobada" : item.resultado === "no_cumple" ? "Rechazada" : "Pendiente")}>{item.resultado === "cumple" ? "Cumple" : item.resultado === "no_cumple" ? "No cumple" : "Observación"}</span> : <span style={badgeStyle("Pendiente")}>Pendiente</span>}
      </div>

      {item.criterioAceptacion ? (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 14, background: c.panelSoft, color: c.text, fontSize: 13.5, lineHeight: 1.5 }}>
          {item.criterioAceptacion}
        </div>
      ) : null}

      {item.formaVerificacion ? (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", color: c.primaryText, fontWeight: 700, fontSize: 13 }}>¿Cómo revisar este punto?</summary>
          <div style={{ marginTop: 6, color: c.muted, fontSize: 13, lineHeight: 1.5 }}>{item.formaVerificacion}</div>
        </details>
      ) : null}

      {item.imagenCorrecto || item.imagenIncorrecto ? (
        <button
          type="button"
          onClick={() => onPreviewPhoto(
            { id: `${item.id}-ref`, url: item.imagenCorrecto || item.imagenIncorrecto, fileName: `${item.code} · Imagen de referencia`, uploadedByName: "Manual de calidad" },
            [{ id: `${item.id}-ref`, url: item.imagenCorrecto || item.imagenIncorrecto, fileName: `${item.code} · Imagen de referencia`, uploadedByName: "Manual de calidad" }]
          )}
          title="Haz clic para ampliar la imagen"
          style={{ border: 0, background: "transparent", padding: 0, margin: "12px 0 0", textAlign: "left", cursor: "zoom-in", display: "block", width: "100%" }}
        >
          <div style={{ fontSize: 12, fontWeight: 900, color: c.text, marginBottom: 6 }}>Imagen de referencia del criterio</div>
          <img src={item.imagenCorrecto || item.imagenIncorrecto} alt="Imagen de referencia del criterio" style={{ width: "100%", maxHeight: 480, objectFit: "contain", borderRadius: 14, border: `1px solid ${c.border}`, display: "block", background: "#fff" }} />
          <div style={{ fontSize: 11, color: c.muted, marginTop: 6 }}>Clic para ampliar</div>
        </button>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <ChecklistPhotoGrid photos={item.photos || []} onPreview={onPreviewPhoto} />
        {(item.photos || []).length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {(item.photos || []).map((photo) => (
              <button key={`del-${photo.id}`} onClick={() => onDeletePhoto(item.id, photo.id)} style={buttonStyle("danger", { padding: "6px 10px", fontSize: 11 })}>
                Borrar {photo.fileName || "foto"}
              </button>
            ))}
          </div>
        ) : null}
        <label style={buttonStyle("secondary", { display: "inline-flex", alignItems: "center", marginTop: 8 })}>
          {uploading ? "Subiendo..." : photosNeeded > 0 ? `Agregar foto (faltan ${photosNeeded})` : "Agregar foto"}
          <input type="file" accept="image/*" multiple style={{ display: "none" }} disabled={uploading} onChange={(e) => { onUploadPhoto(item.id, e.target.files); e.target.value = ""; }} />
        </label>
        {photosNeeded > 0 ? (
          <div style={{ fontSize: 11, color: c.warnText, marginTop: 6 }}>Este punto requiere {requiredPhotos} foto(s) de evidencia.</div>
        ) : null}
      </div>

      <div style={{ marginTop: 12 }}>
        <ZonaResultButtons item={item} onSetResultado={onSetResultado} />
      </div>

      <textarea
        value={item.note || ""}
        onChange={(e) => onNoteChange(item.id, e.target.value)}
        placeholder="Observaciones (opcional)"
        style={inputStyle({ marginTop: 10, minHeight: 56, resize: "vertical" })}
      />
    </div>
  );
}

function ZonaDetailPanel({ isMobile, selectedHouse, zona, onBack, showCompletedItems, setShowCompletedItems, onSetResultado, onNoteChange, onUploadPhoto, onDeletePhoto, uploading, onPreviewPhoto }) {
  const evaluacion = evaluarPartida(zona);
  const checklist = zona.checklist || [];
  const pending = checklist.filter((item) => item.resultado !== "cumple");
  const itemsToShow = showCompletedItems ? checklist : pending;
  const completedCount = checklist.length - pending.length;

  return (
    <div style={{ ...cardStyle(), padding: 20 }}>
      {isMobile ? (
        <>
          <button onClick={onBack} style={buttonStyle("secondary", { marginBottom: 14, padding: "8px 14px" })}>← Otra zona</button>
          <div style={{ fontSize: 13, fontWeight: 800, color: c.primaryText, marginBottom: 4 }}>Paso 3 de 3 · {selectedHouse?.name}</div>
        </>
      ) : (
        <>
          <button onClick={onBack} style={buttonStyle("secondary", { marginBottom: 14, padding: "8px 14px" })}>▲ Ocultar checklist</button>
          <div style={{ fontSize: 13, fontWeight: 800, color: c.primaryText, marginBottom: 4 }}>3. Checklist de {selectedHouse?.name}</div>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 900, color: c.text }}>{zona.name}</div>
          <div style={{ color: c.muted, marginTop: 4 }}>Revisión de entrega por zona · fotos de evidencia obligatorias por punto</div>
          <div style={{ marginTop: 10, fontWeight: 800, color: c.text }}>
            Calificación: {evaluacion.score.toFixed(0)}% · {checklist.length - checklist.filter((i) => !i.resultado).length}/{checklist.length} puntos revisados
          </div>
        </div>
        <span style={badgeStyle(zona.status)}>{zona.status}</span>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <button onClick={() => setShowCompletedItems((v) => !v)} style={buttonStyle("secondary", { padding: "7px 12px", fontSize: 12.5 })}>
          {showCompletedItems ? "Ocultar puntos cumplidos" : `Ver puntos cumplidos (${completedCount})`}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
        {itemsToShow.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: c.successText, fontWeight: 700 }}>✅ Todos los puntos de esta zona están cumplidos.</div>
        ) : (
          itemsToShow.map((item) => (
            <ZonaChecklistItemCard
              key={item.id}
              item={item}
              uploading={uploading[item.id]}
              onSetResultado={onSetResultado}
              onNoteChange={onNoteChange}
              onUploadPhoto={onUploadPhoto}
              onDeletePhoto={onDeletePhoto}
              onPreviewPhoto={onPreviewPhoto}
            />
          ))
        )}
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
  const [bloques, setBloques] = useState([]);
  const [bloquesManagerOpen, setBloquesManagerOpen] = useState(false);
  const [bloqueForm, setBloqueForm] = useState(null);
  const [mobileStep, setMobileStep] = useState("unidad");
  const [desktopHouseOpened, setDesktopHouseOpened] = useState(false);
  const [desktopStageOpened, setDesktopStageOpened] = useState(false);
  const [checklistDetailOpen, setChecklistDetailOpen] = useState({});
  const [selectedHouseId, setSelectedHouseId] = useState("");
  const [selectedPartidaId, setSelectedPartidaId] = useState("cimentacion");
  const [qualityMode, setQualityMode] = useState("aseguramiento");
  const [selectedZonaId, setSelectedZonaId] = useState(zonaTemplates[0]?.id || "fachada");
  const [showCompletedStages, setShowCompletedStages] = useState(false);
  const [showCompletedItems, setShowCompletedItems] = useState(false);
  const [zonaUploading, setZonaUploading] = useState({});
  const [specsManagerOpen, setSpecsManagerOpen] = useState(false);
  const [specForm, setSpecForm] = useState(null);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportSelection, setReportSelection] = useState({ aseguramiento: true, entrega: false, scope: "all", houseIds: [] });
  const [printReport, setPrintReport] = useState(null);
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
  const seededSpecsObrasRef = useRef(new Set());

  useEffect(() => {
    const handler = () => setPrintReport(null);
    window.addEventListener("afterprint", handler);
    return () => window.removeEventListener("afterprint", handler);
  }, []);

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

      const emailKey = String(user.email || "").toLowerCase();
      let resolvedProfile = null;

      try {
        const uidSnap = await getDoc(doc(db, "users", user.uid));
        if (uidSnap.exists()) {
          resolvedProfile = { id: user.uid, uid: user.uid, ...uidSnap.data() };
        }

        if (!resolvedProfile && emailKey) {
          const emailSnap = await getDoc(doc(db, "users", emailKey));
          if (emailSnap.exists()) {
            resolvedProfile = { id: emailKey, uid: user.uid, ...emailSnap.data() };
          }
        }
      } catch (error) {
        console.warn("No se pudo leer perfil de usuario en Firestore", error);
      }

      setProfile(resolvedProfile || systemProfileByEmail[emailKey] || { role: "constructora", name: user.email });
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
    const unsub = onSnapshot(specsRef, async (snapshot) => {
      const specs = snapshot.docs.map((item) => ({ id: item.id, ...item.data(), partidaId: item.data().partidaId || qualityPartidaIdFromSpec(item.data()) }));
      setQualitySpecs(specs);
      const seedKey = `${obraId}`;
      if (snapshot.empty && !seededSpecsObrasRef.current.has(seedKey)) {
        seededSpecsObrasRef.current.add(seedKey);
        try {
          for (const spec of [...aseguramientoManualSpecs, ...entregaManualSpecs]) {
            await setDoc(doc(db, "obras", obraId, "qualitySpecs", spec.clave), spec, { merge: true });
          }
        } catch (error) {
          console.error("No se pudo precargar el checklist de calidad desde los manuales.", error);
        }
      } else if (!snapshot.empty && !seededSpecsObrasRef.current.has(`${seedKey}-images`)) {
        seededSpecsObrasRef.current.add(`${seedKey}-images`);
        const byClave = Object.fromEntries([...aseguramientoManualSpecs, ...entregaManualSpecs].map((s) => [s.clave, s]));
        try {
          for (const existing of specs) {
            const seedSpec = byClave[existing.clave];
            if (seedSpec?.imagenCorrecto && !existing.imagenCorrecto) {
              await setDoc(doc(db, "obras", obraId, "qualitySpecs", existing.id), { imagenCorrecto: seedSpec.imagenCorrecto }, { merge: true });
            }
          }
        } catch (error) {
          console.error("No se pudieron completar las imágenes de referencia del checklist.", error);
        }
      }
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

  useEffect(() => {
    if (!authUser || !obraId) {
      setBloques([]);
      return;
    }
    const bloquesRef = collection(db, "obras", obraId, "bloques");
    const unsub = onSnapshot(bloquesRef, (snapshot) => {
      setBloques(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
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
        for (const zona of zonaTemplates) {
          await setDoc(doc(db, "obras", obra.id, "casas", houseId, "entrega", zona.id), {
            id: zona.id,
            name: zona.name,
            weight: zona.weight,
            status: "Pendiente",
            progress: 0,
            checklist: buildChecklist(zona.id, null, [], qualitySpecs),
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

  async function saveBloqueForm() {
    if (!bloqueForm || !obraId) return;
    const name = String(bloqueForm.name || "").trim();
    if (!name) { alert("Captura el nombre del bloque."); return; }
    if (!(bloqueForm.houseIds || []).length) { alert("Selecciona al menos una casa para este bloque."); return; }
    let id = bloqueForm.id;
    if (!id) {
      const existingIds = new Set(bloques.map((b) => b.id));
      const base = slugify(name) || "bloque";
      id = base;
      let n = 2;
      while (existingIds.has(id)) { id = `${base}-${n}`; n += 1; }
    }
    const assignedEmails = String(bloqueForm.emailsText || "").split(",").map((email) => email.trim()).filter(Boolean);
    await setDoc(doc(db, "obras", obraId, "bloques", id), {
      id,
      name,
      houseIds: bloqueForm.houseIds || [],
      assignedEmails,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setBloqueForm(null);
  }

  async function deleteBloque(bloqueId) {
    if (!obraId || !window.confirm("¿Eliminar este bloque? Las casas quedarán sin bloque asignado hasta que crees otro.")) return;
    await deleteDoc(doc(db, "obras", obraId, "bloques", bloqueId));
  }

  async function saveSpecForm() {
    if (!specForm || !obraId) return;
    const clave = String(specForm.clave || "").trim().toUpperCase();
    const concepto = String(specForm.concepto || "").trim();
    if (!clave || !concepto) { alert("Captura al menos el código y el punto de verificación."); return; }
    const payload = {
      checklistType: specForm.checklistType,
      partidaId: specForm.partidaId,
      clave,
      concepto,
      criterioAceptacion: String(specForm.criterioAceptacion || "").trim(),
      formaVerificacion: String(specForm.formaVerificacion || "").trim(),
      evidenceRequired: Math.max(0, Number(specForm.evidenceRequired ?? 1)),
      clasificacion: specForm.clasificacion || "menor",
      peso: Math.max(1, Number(specForm.peso ?? 1)),
      active: true,
    };
    const docId = specForm.id || clave;
    await setDoc(doc(db, "obras", obraId, "qualitySpecs", docId), payload, { merge: true });
    setSpecForm(null);
  }

  async function deleteSpec(specId) {
    if (!obraId || !window.confirm("¿Eliminar este punto del checklist? Ya no aparecerá para las casas de esta obra.")) return;
    await deleteDoc(doc(db, "obras", obraId, "qualitySpecs", specId));
  }

  function generateQualityReport() {
    const tipos = [];
    if (reportSelection.aseguramiento) tipos.push("aseguramiento");
    if (reportSelection.entrega) tipos.push("entrega");
    if (!tipos.length) { alert("Elige al menos un tipo de reporte (Aseguramiento y/o Entrega)."); return; }
    const houseIds = reportSelection.scope === "all" ? visibleHouses.map((h) => h.id) : reportSelection.houseIds;
    if (!houseIds.length) { alert("Elige al menos una casa para el reporte."); return; }
    setPrintReport({ tipos, houseIds, obraName: selectedObra?.name || selectedObraId, generatedAt: new Date().toLocaleString("es-MX"), generatedBy: profile?.name || authUser?.email || "" });
    setReportModalOpen(false);
    window.setTimeout(() => window.print(), 200);
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
          const entregaRef = collection(db, "obras", obraId, "casas", houseDoc.id, "entrega");
          const entregaSnap = await getDocs(entregaRef);
          if (entregaSnap.empty) {
            zonaTemplates.forEach((zona) => {
              setDoc(doc(db, "obras", obraId, "casas", houseDoc.id, "entrega", zona.id), {
                id: zona.id,
                name: zona.name,
                weight: zona.weight,
                status: "Pendiente",
                progress: 0,
                checklist: buildChecklist(zona.id, null, [], qualitySpecs),
                evidenceCount: { photos: 0, videos: 0 },
                createdFromTemplate: true,
                createdAt: serverTimestamp(),
              }, { merge: true }).catch(() => {});
            });
          }
          const entregas = entregaSnap.empty
            ? zonaTemplates.map((zona) => normalizePartida({ id: zona.id, name: zona.name, weight: zona.weight, status: "Pendiente", evidenceCount: { photos: 0, videos: 0 } }, qualitySpecs))
            : entregaSnap.docs.map((p) => normalizePartida({ id: p.id, ...p.data() }, qualitySpecs));
          return {
            id: houseDoc.id,
            ...houseDoc.data(),
            partidas: partidasSnap.docs.map((p) => normalizePartida({ id: p.id, ...p.data() }, qualitySpecs)),
            entregas,
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

  const isSupervisora = ["supervisora", "master"].includes(profile?.role);
  const isConstructora = profile?.role === "constructora";

  const myEmail = String(authUser?.email || "").toLowerCase();
  const myBloques = useMemo(
    () => bloques.filter((b) => (b.assignedEmails || []).some((email) => String(email || "").toLowerCase() === myEmail)),
    [bloques, myEmail]
  );
  const visibleHouses = useMemo(() => {
    if (isSupervisora || !bloques.length || !myBloques.length) return houses;
    const allowedIds = new Set(myBloques.flatMap((b) => b.houseIds || []));
    return houses.filter((house) => allowedIds.has(house.id));
  }, [houses, isSupervisora, bloques.length, myBloques]);

  const filteredHouses = useMemo(() => {
    return visibleHouses.filter((house) => {
      const q = queryText.trim().toLowerCase();
      if (!q) return true;
      return (
        house.name?.toLowerCase().includes(q) ||
        String(house.number || "").includes(queryText) ||
        String(house.block || "").toLowerCase().includes(q)
      );
    });
  }, [visibleHouses, queryText]);

  useEffect(() => {
    if (!visibleHouses.length) return;
    if (!visibleHouses.some((house) => house.id === selectedHouseId)) setSelectedHouseId(visibleHouses[0].id);
  }, [visibleHouses, selectedHouseId]);

  const selectedHouse = visibleHouses.find((h) => h.id === selectedHouseId) || null;
  const selectedPartida =
    selectedHouse?.partidas?.find((p) => p.id === selectedPartidaId) || selectedHouse?.partidas?.[0] || null;
  const selectedZona =
    selectedHouse?.entregas?.find((z) => z.id === selectedZonaId) || selectedHouse?.entregas?.[0] || null;
  const aseguramientoScore = selectedHouse ? getHouseQualityScore(selectedHouse, "partidas") : { avance: 0, calidad: 0, stagesTotal: 0, stagesComplete: 0 };
  const entregaScore = selectedHouse ? getHouseQualityScore(selectedHouse, "entregas") : { avance: 0, calidad: 0, stagesTotal: 0, stagesComplete: 0 };
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

  function zonaStatusFromChecklist(checklist = []) {
    if (!checklist.length) return "Pendiente";
    const pendientes = checklist.filter((item) => !item.resultado);
    if (pendientes.length === checklist.length) return "Pendiente";
    if (pendientes.length > 0) return "En proceso";
    if (checklist.some((item) => item.resultado === "no_cumple")) return "Con observaciones";
    return "Aprobada";
  }

  async function updateZona(payload) {
    if (!selectedHouse || !selectedZona) return;
    const previousHouses = houses;
    setHouses((prev) =>
      prev.map((house) => {
        if (house.id !== selectedHouse.id) return house;
        return {
          ...house,
          entregas: (house.entregas || []).map((zona) =>
            zona.id === selectedZona.id ? normalizePartida({ ...zona, ...payload }, qualitySpecs) : zona
          ),
        };
      })
    );
    try {
      const zonaRef = doc(db, "obras", obraId, "casas", selectedHouse.id, "entrega", selectedZona.id);
      await setDoc(zonaRef, payload, { merge: true });
    } catch (error) {
      console.error(error);
      setHouses(previousHouses);
      alert("No se pudo guardar el cambio en el checklist de entrega.");
    }
  }

  async function updateChecklistItemZona(itemId, patch) {
    if (!selectedZona) return;
    const nextChecklist = (selectedZona.checklist || []).map((item) =>
      item.id === itemId ? { ...item, ...patch } : item
    );
    await updateZona({ checklist: nextChecklist, status: zonaStatusFromChecklist(nextChecklist) });
  }

  async function handleZonaChecklistPhotoUpload(itemId, files) {
    if (!files?.length || !selectedHouse || !selectedZona) return;
    setZonaUploading((prev) => ({ ...prev, [itemId]: true }));
    try {
      const checklistItem = (selectedZona.checklist || []).find((item) => item.id === itemId);
      if (!checklistItem) return;
      const uploadedPhotos = [];
      for (const file of Array.from(files)) {
        const filePath = `obras/${obraId}/${selectedHouse.id}/entrega/${selectedZona.id}/checklist/${itemId}/${Date.now()}-${file.name}`;
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
      const nextChecklist = (selectedZona.checklist || []).map((item) =>
        item.id === itemId ? { ...item, photos: nextPhotos } : item
      );
      await updateZona({ checklist: nextChecklist, status: zonaStatusFromChecklist(nextChecklist) });
    } finally {
      setZonaUploading((prev) => ({ ...prev, [itemId]: false }));
    }
  }

  async function deleteZonaChecklistPhoto(itemId, photoId) {
    const checklistItem = (selectedZona?.checklist || []).find((item) => item.id === itemId);
    const photo = (checklistItem?.photos || []).find((p) => p.id === photoId);
    if (!checklistItem || !photo) return;
    if (!window.confirm(`¿Borrar la foto ${photo.fileName || ""}?`)) return;
    if (photo.storagePath) {
      try {
        await deleteObject(ref(storage, photo.storagePath));
      } catch (error) {
        console.error(error);
      }
    }
    const nextPhotos = (checklistItem.photos || []).filter((p) => p.id !== photoId);
    await updateChecklistItemZona(itemId, { photos: nextPhotos });
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
          <div style={{ fontSize: 28, fontWeight: 900, color: c.text, marginBottom: 8 }}>TRITON OS</div>
          <div style={{ color: c.muted, marginBottom: 18 }}>No hay obra activa para el módulo de calidad. El sistema operativo sigue disponible desde el menú principal.</div>
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
          <div style={{ fontSize: 28, fontWeight: 900, color: c.text, marginBottom: 8 }}>TRITON OS</div>
          <div style={{ color: c.muted, marginBottom: 18 }}>
            {qualityInitializing ? "Preparando información operativa del sistema..." : "Cargando información necesaria. El módulo de calidad seguirá disponible desde Operación."}
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
    <div style={{ minHeight: "100vh", background: c.bg, padding: 22 }}>
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
              Checklist / Calidad
            </div>
            <div
              style={{
                color: c.muted,
                fontSize: isMobile ? 15 : 18,
                marginTop: 6,
                lineHeight: 1.35,
              }}
            >
              Liberaciones, evidencias y bitácora de obra
            </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {obras.length > 1 ? (
              <select value={selectedObraId} onChange={(event) => { setSelectedObraId(event.target.value); setSelectedHouseId(""); setDesktopHouseOpened(false); setDesktopStageOpened(false); }} style={{ ...inputStyle(), minWidth: 220, padding: "10px 12px" }}>
                {obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.name || obra.id}</option>)}
              </select>
            ) : null}
            <button onClick={() => setNotificationPanelOpen(true)} style={buttonStyle("primary", { position: "relative" })}>
              Mi panel
              {myOpenMentions.length > 0 ? (
                <span style={{ position: "absolute", top: -8, right: -8, background: c.danger, color: "#fff", borderRadius: 999, padding: "2px 7px", fontSize: 11, fontWeight: 900 }}>{myOpenMentions.length}</span>
              ) : null}
            </button>
            {isSupervisora ? (
              <button onClick={() => setBloquesManagerOpen(true)} style={buttonStyle("secondary")}>
                Bloques y equipos
              </button>
            ) : null}
            {isSupervisora ? (
              <button onClick={() => setSpecsManagerOpen(true)} style={buttonStyle("secondary")}>
                Configurar checklist
              </button>
            ) : null}
            <button onClick={() => setReportModalOpen(true)} style={buttonStyle("secondary")}>
              Generar reporte PDF
            </button>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "6px 14px 6px 6px",
                borderRadius: 999,
                background: c.primarySoft,
                border: `1px solid ${c.border}`,
              }}
              title={authUser.email}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: c.primary,
                  color: c.primaryContrast,
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 900,
                  fontSize: 13,
                  flexShrink: 0,
                }}
              >
                {(authUser.email || "?")[0].toUpperCase()}
              </div>
              <div style={{ lineHeight: 1.25 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: c.text }}>{roleLabel(profile?.role)}</div>
                <div style={{ fontSize: 11, color: c.muted }}>{authUser.email}</div>
              </div>
            </div>
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
            gridTemplateColumns: "1fr",
            gap: 20,
          }}
        >
          {!isMobile || mobileStep === "unidad" ? (
          <div style={{ ...cardStyle(), padding: 18 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.text, marginBottom: 4 }}>{isMobile ? "Paso 1 de 3 · ¿Qué casa vas a revisar?" : "1. Elige la casa"}</div>
            {isMobile && isConstructora && myBloques.length ? (
              <div style={{ color: c.muted, fontSize: 13, marginBottom: 10 }}>Tu bloque asignado: <b style={{ color: c.text }}>{myBloques.map((b) => b.name).join(", ")}</b></div>
            ) : null}

            <input
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Buscar por número o bloque"
              style={inputStyle({ marginBottom: 16, marginTop: isMobile ? 10 : 0, maxWidth: isMobile ? "none" : 420 })}
            />

            {isMobile && isConstructora && bloques.length > 0 && myBloques.length === 0 ? (
              <div style={{ padding: 16, borderRadius: 16, background: c.warnBg, color: c.warnText, fontWeight: 700, fontSize: 14 }}>
                Todavía no tienes un bloque asignado. Pide a tu supervisor que te agregue a un bloque en "Bloques y equipos".
              </div>
            ) : (
            <div
              style={{
                display: isMobile ? "block" : "grid",
                gridTemplateColumns: isMobile ? undefined : "repeat(auto-fill, minmax(210px, 1fr))",
                gap: isMobile ? 0 : 12,
                maxHeight: isMobile ? "none" : 460,
                overflow: isMobile ? "visible" : "auto",
                paddingRight: 4,
              }}
            >
              {filteredHouses.length === 0 ? (
                <div style={{ color: c.muted, fontSize: 14 }}>No hay casas cargadas todavía.</div>
              ) : (
                filteredHouses.map((house) => {
                  const isSelected = selectedHouseId === house.id;
                  const isOpen = isSelected && (isMobile || desktopHouseOpened);
                  return (
                  <button
                    key={house.id}
                    onClick={() => {
                      if (isMobile) { setSelectedHouseId(house.id); setMobileStep("partidas"); return; }
                      if (isSelected && desktopHouseOpened) { setDesktopHouseOpened(false); setDesktopStageOpened(false); return; }
                      setSelectedHouseId(house.id);
                      setDesktopHouseOpened(true);
                      setDesktopStageOpened(false);
                    }}
                    style={{
                      ...cardStyle(isOpen),
                      width: "100%",
                      textAlign: "left",
                      padding: 16,
                      marginBottom: isMobile ? 10 : 0,
                      cursor: "pointer",
                      background: isOpen ? "#fff" : c.surface,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <div style={{ fontWeight: 800, color: c.text, fontSize: isMobile ? 17 : 14 }}>{house.name}</div>
                      {isMobile ? <span style={{ fontSize: 22, color: c.muted }}>›</span> : <span style={{ fontSize: 16, color: c.muted, transition: "transform 150ms ease", transform: isOpen ? "rotate(90deg)" : "none" }}>›</span>}
                    </div>
                    <div style={{ marginTop: 8 }}><span style={badgeStyle("Pendiente")}>Bloque {house.block || "-"}</span></div>
                    <div style={{ color: c.muted, fontSize: 12, marginTop: 10, marginBottom: 6 }}>
                      Avance {getHouseProgress(house)}%
                    </div>
                    <ProgressBar value={getHouseProgress(house)} />
                  </button>
                  );
                })
              )}
            </div>
            )}
          </div>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {((isMobile && mobileStep === "partidas") || (!isMobile && desktopHouseOpened)) && selectedHouse ? (
            <div style={{ ...cardStyle(), padding: 20 }}>
              {isMobile ? (
                <button onClick={() => setMobileStep("unidad")} style={buttonStyle("secondary", { marginBottom: 14, padding: "8px 14px" })}>← Cambiar casa</button>
              ) : (
                <button onClick={() => { setDesktopHouseOpened(false); setDesktopStageOpened(false); }} style={buttonStyle("secondary", { marginBottom: 14, padding: "8px 14px" })}>▲ Ocultar</button>
              )}
              <div style={{ fontSize: 13, fontWeight: 800, color: c.primaryText }}>{isMobile ? "Paso 2 de 3" : "2. Elige qué revisar"}</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: c.text }}>{selectedHouse?.name}</div>
              <div style={{ color: c.muted, marginTop: 4 }}>
                Bloque {selectedHouse?.block || "-"}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                  gap: 12,
                  marginTop: 18,
                }}
              >
                <button
                  onClick={() => { setQualityMode("aseguramiento"); setDesktopStageOpened(false); }}
                  style={{
                    ...cardStyle(qualityMode === "aseguramiento"),
                    textAlign: "left",
                    padding: 16,
                    cursor: "pointer",
                    background: qualityMode === "aseguramiento" ? "#fff" : c.surface,
                  }}
                >
                  <div style={{ fontWeight: 900, color: c.text, fontSize: 15 }}>🔧 Aseguramiento</div>
                  <div style={{ fontSize: 12, color: c.muted, marginTop: 2, marginBottom: 8 }}>Calidad durante la obra, por etapa</div>
                  <ProgressBar value={aseguramientoScore.avance} />
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12.5, color: c.muted }}>
                    <span>Avance {aseguramientoScore.avance}%</span>
                    <span style={{ fontWeight: 800, color: aseguramientoScore.calidad >= 90 ? c.successText : aseguramientoScore.calidad >= 70 ? c.warnText : c.dangerText }}>Calidad {aseguramientoScore.calidad}%</span>
                  </div>
                </button>
                <button
                  onClick={() => { setQualityMode("entrega"); setDesktopStageOpened(false); }}
                  style={{
                    ...cardStyle(qualityMode === "entrega"),
                    textAlign: "left",
                    padding: 16,
                    cursor: "pointer",
                    background: qualityMode === "entrega" ? "#fff" : c.surface,
                  }}
                >
                  <div style={{ fontWeight: 900, color: c.text, fontSize: 15 }}>🏁 Control de Calidad · Entrega</div>
                  <div style={{ fontSize: 12, color: c.muted, marginTop: 2, marginBottom: 8 }}>Revisión final por zona, antes de entregar</div>
                  <ProgressBar value={entregaScore.avance} />
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12.5, color: c.muted }}>
                    <span>Avance {entregaScore.avance}%</span>
                    <span style={{ fontWeight: 800, color: entregaScore.calidad >= 90 ? c.successText : entregaScore.calidad >= 70 ? c.warnText : c.dangerText }}>Calificación {entregaScore.calidad}%</span>
                  </div>
                </button>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, flexWrap: "wrap", gap: 8 }}>
                <div style={{ color: c.muted, fontSize: 13 }}>{isMobile ? "Toca un punto pendiente para revisarlo." : "Las áreas pendientes aparecen primero."}</div>
                <button
                  onClick={() => setShowCompletedStages((v) => !v)}
                  style={buttonStyle("secondary", { padding: "7px 12px", fontSize: 12.5 })}
                >
                  {showCompletedStages ? "Ocultar completadas" : "Ver completadas"}
                </button>
              </div>

              {qualityMode === "aseguramiento" ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))",
                  gap: 12,
                  marginTop: 14,
                }}
              >
                {[...(selectedHouse?.partidas || [])]
                  .filter((partida) => showCompletedStages || partida.status !== "Aprobada")
                  .sort((a, b) => (partidaOrderIndex[a.id] ?? 999) - (partidaOrderIndex[b.id] ?? 999))
                  .map((partida) => {
                  const isSelected = selectedPartidaId === partida.id;
                  const isOpen = isSelected && (isMobile || desktopStageOpened);
                  return (
                  <button
                    key={partida.id}
                    onClick={() => {
                      if (isMobile) { setSelectedPartidaId(partida.id); setMobileStep("detalle"); return; }
                      if (isSelected && desktopStageOpened) { setDesktopStageOpened(false); return; }
                      setSelectedPartidaId(partida.id);
                      setDesktopStageOpened(true);
                    }}
                    style={{
                      ...cardStyle(isOpen),
                      textAlign: "left",
                      padding: 16,
                      cursor: "pointer",
                      borderLeft: isMobile ? `6px solid ${partida.status === "Aprobada" ? c.successText : partida.status === "Rechazada" ? c.dangerText : c.warnText}` : cardStyle(isOpen).border,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 800, color: c.text, fontSize: isMobile ? 16 : 14 }}>{isMobile ? (partida.status === "Aprobada" ? "✅ " : "🕓 ") : ""}{partida.name}</div>
                        <div style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>Peso {partida.weight}%</div>
                      </div>
                      <span style={badgeStyle(partida.status)}>{partida.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: c.muted, marginTop: 14 }}>
                      Fotos {partida.evidenceCount?.photos || 0} · Videos {partida.evidenceCount?.videos || 0}
                    </div>
                  </button>
                  );
                })}
                {!showCompletedStages && (selectedHouse?.partidas || []).every((p) => p.status !== "Aprobada") === false && (selectedHouse?.partidas || []).filter((p) => p.status !== "Aprobada").length === 0 ? (
                  <div style={{ gridColumn: "1 / -1", color: c.successText, fontWeight: 700, padding: 12 }}>✅ Todas las etapas están aprobadas.</div>
                ) : null}
              </div>
              ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))",
                  gap: 12,
                  marginTop: 14,
                }}
              >
                {[...(selectedHouse?.entregas || [])]
                  .filter((zona) => showCompletedStages || zona.status !== "Aprobada")
                  .sort((a, b) => (zonaOrderIndex[a.id] ?? 999) - (zonaOrderIndex[b.id] ?? 999))
                  .map((zona) => {
                  const isSelected = selectedZonaId === zona.id;
                  const isOpen = isSelected && (isMobile || desktopStageOpened);
                  return (
                  <button
                    key={zona.id}
                    onClick={() => {
                      if (isMobile) { setSelectedZonaId(zona.id); setMobileStep("detalle"); return; }
                      if (isSelected && desktopStageOpened) { setDesktopStageOpened(false); return; }
                      setSelectedZonaId(zona.id);
                      setDesktopStageOpened(true);
                    }}
                    style={{
                      ...cardStyle(isOpen),
                      textAlign: "left",
                      padding: 16,
                      cursor: "pointer",
                      borderLeft: isMobile ? `6px solid ${zona.status === "Aprobada" ? c.successText : zona.status === "Con observaciones" ? c.dangerText : c.warnText}` : cardStyle(isOpen).border,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 800, color: c.text, fontSize: isMobile ? 16 : 14 }}>{isMobile ? (zona.status === "Aprobada" ? "✅ " : "🕓 ") : ""}{zona.name}</div>
                        <div style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>{(zona.checklist || []).filter((i) => i.resultado).length}/{(zona.checklist || []).length} puntos revisados</div>
                      </div>
                      <span style={badgeStyle(zona.status)}>{zona.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: c.muted, marginTop: 14 }}>
                      Fotos {zona.evidenceCount?.photos || 0}
                    </div>
                  </button>
                  );
                })}
                {!showCompletedStages && (selectedHouse?.entregas || []).filter((z) => z.status !== "Aprobada").length === 0 ? (
                  <div style={{ gridColumn: "1 / -1", color: c.successText, fontWeight: 700, padding: 12 }}>✅ Todas las zonas están aprobadas. La casa está lista para entrega.</div>
                ) : null}
              </div>
              )}
            </div>
            ) : null}

            {((isMobile && mobileStep === "detalle") || (!isMobile && desktopStageOpened)) && qualityMode === "aseguramiento" && selectedPartida ? (
              <>
                <div style={{ ...cardStyle(), padding: 20 }}>
                  {isMobile ? (
                    <>
                      <button onClick={() => setMobileStep("partidas")} style={buttonStyle("secondary", { marginBottom: 14, padding: "8px 14px" })}>← Otra etapa</button>
                      <div style={{ fontSize: 13, fontWeight: 800, color: c.primaryText, marginBottom: 4 }}>Paso 3 de 3 · {selectedHouse?.name}</div>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setDesktopStageOpened(false)} style={buttonStyle("secondary", { marginBottom: 14, padding: "8px 14px" })}>▲ Ocultar checklist</button>
                      <div style={{ fontSize: 13, fontWeight: 800, color: c.primaryText, marginBottom: 4 }}>3. Checklist de {selectedHouse?.name}</div>
                    </>
                  )}
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
    {(selectedPartida.checklist || []).map((item) => {
      const resultColors = {
        cumple: { text: c.successText, bg: c.successBg, label: "✅ Cumple" },
        observacion: { text: c.warnText, bg: c.warnBg, label: "⚠️ Observación" },
        no_cumple: { text: c.dangerText, bg: c.dangerBg, label: "❌ No cumple" },
        na: { text: c.idleText, bg: c.idleBg, label: "➖ No aplica" },
      };
      const resultInfo = resultColors[item.resultado] || { text: c.muted, bg: "#fff", label: "🕓 Pendiente de evaluar" };
      const scopeProgress = scopeProgressForItem(item);
      const simplePhotosNeeded = !scopeProgress.total && item.requiresPhotos !== false ? Math.max(0, Number(item.evidenceRequired || 0) - (item.photos?.length || 0)) : 0;
      return (
      <div key={item.id} style={{ ...cardStyle(), padding: 16, borderLeft: isMobile ? `6px solid ${resultInfo.text}` : cardStyle().border }}>
        {isMobile ? (
          <div style={{ display: "inline-flex", padding: "6px 12px", borderRadius: 999, background: resultInfo.bg, color: resultInfo.text, fontWeight: 900, fontSize: 13, marginBottom: 10 }}>
            {resultInfo.label}
          </div>
        ) : null}
        {isMobile && simplePhotosNeeded > 0 ? (
          <div style={{ padding: "10px 14px", borderRadius: 12, background: c.warnBg, color: c.warnText, fontWeight: 800, fontSize: 13, marginBottom: 10 }}>
            📸 Faltan {simplePhotosNeeded} foto(s) para este punto
          </div>
        ) : null}
        {isMobile && !simplePhotosNeeded && !scopeProgress.total && item.requiresPhotos !== false && Number(item.evidenceRequired || 0) > 0 ? (
          <div style={{ padding: "10px 14px", borderRadius: 12, background: c.successBg, color: c.successText, fontWeight: 800, fontSize: 13, marginBottom: 10 }}>
            📸 Evidencia fotográfica completa
          </div>
        ) : null}
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
              <span style={{ fontWeight: 800, color: c.text, fontSize: isMobile ? 16 : 14 }}>{item.code} · {item.label}</span>
            </button>
            {isSupervisora && isMobile ? (
  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
    {[["cumple", "✅ Cumple"], ["observacion", "⚠️ Observación"], ["no_cumple", "❌ No cumple"], ["na", "➖ No aplica"]].map(([value, label]) => (
      <button
        key={value}
        type="button"
        onClick={() => updateChecklistItem(item.id, { resultado: value })}
        style={{
          padding: "12px 10px",
          borderRadius: 12,
          border: item.resultado === value ? `2px solid ${c.primary}` : `1px solid ${c.border}`,
          background: item.resultado === value ? c.primarySoft : "#fff",
          fontWeight: 800,
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        {label}
      </button>
    ))}
  </div>
) : isSupervisora ? (
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
                            {result.updatedBy ? <div style={{ fontSize: 11, color: c.muted, marginTop: 4 }}>Actualizó: {result.updatedBy}{result.updatedByRole ? ` · ${roleLabel(result.updatedByRole)}` : ""}</div> : null}
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
      );
    })}
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

            {((isMobile && mobileStep === "detalle") || (!isMobile && desktopStageOpened)) && qualityMode === "entrega" && selectedZona ? (
              <ZonaDetailPanel
                isMobile={isMobile}
                selectedHouse={selectedHouse}
                zona={selectedZona}
                onBack={() => (isMobile ? setMobileStep("partidas") : setDesktopStageOpened(false))}
                showCompletedItems={showCompletedItems}
                setShowCompletedItems={setShowCompletedItems}
                onSetResultado={(itemId, resultado) => updateChecklistItemZona(itemId, { resultado })}
                onNoteChange={(itemId, note) => updateChecklistItemZona(itemId, { note })}
                onUploadPhoto={handleZonaChecklistPhotoUpload}
                onDeletePhoto={deleteZonaChecklistPhoto}
                uploading={zonaUploading}
                onPreviewPhoto={openPhotoPreview}
              />
            ) : null}
          </div>
        </div>

      {bloquesManagerOpen ? (
        <div
          onClick={() => { setBloquesManagerOpen(false); setBloqueForm(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 1100 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle(), width: "100%", maxWidth: 700, maxHeight: "88vh", overflow: "auto", padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: c.text }}>Bloques y equipos</div>
              <button onClick={() => { setBloquesManagerOpen(false); setBloqueForm(null); }} style={buttonStyle("secondary", { padding: "8px 12px" })}>Cerrar</button>
            </div>
            <div style={{ color: c.muted, fontSize: 13, marginBottom: 18, lineHeight: 1.5 }}>
              Divide las casas de esta obra en bloques (por ejemplo, Bloque A = casas 1 a 4) y asigna el correo de cada residente de obra de la constructora. Cada persona solo verá y trabajará las casas de su bloque; supervisión siempre ve todas las casas.
            </div>

            {!bloqueForm ? (
              <>
                <button onClick={() => setBloqueForm({ name: "", houseIds: [], emailsText: "" })} style={buttonStyle("primary", { marginBottom: 18 })}>+ Nuevo bloque</button>
                {bloques.length === 0 ? (
                  <div style={{ border: `1px dashed ${c.border}`, borderRadius: 16, padding: 16, color: c.muted, fontSize: 13 }}>
                    Todavía no hay bloques en esta obra. Sin bloques, cualquier persona con rol de constructora puede ver todas las casas.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {bloques.map((b) => (
                      <div key={b.id} style={{ border: `1px solid ${c.border}`, borderRadius: 16, padding: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <div>
                            <div style={{ fontWeight: 900, color: c.text }}>{b.name}</div>
                            <div style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>{(b.houseIds || []).length} casa(s) · {(b.assignedEmails || []).length} persona(s) en el equipo</div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => setBloqueForm({ ...b, emailsText: (b.assignedEmails || []).join(", ") })} style={buttonStyle("secondary", { padding: "8px 12px", fontSize: 12 })}>Editar</button>
                            <button onClick={() => deleteBloque(b.id)} style={buttonStyle("danger", { padding: "8px 12px", fontSize: 12 })}>Eliminar</button>
                          </div>
                        </div>
                        {(b.assignedEmails || []).length ? (
                          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {b.assignedEmails.map((email) => <span key={email} style={badgeStyle("Pendiente")}>{email}</span>)}
                          </div>
                        ) : (
                          <div style={{ marginTop: 8, color: c.warnText, fontSize: 12, fontWeight: 700 }}>Sin nadie asignado todavía.</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, color: c.text }}>Nombre del bloque</div>
                  <input value={bloqueForm.name} onChange={(e) => setBloqueForm({ ...bloqueForm, name: e.target.value })} placeholder="Bloque A" style={inputStyle()} />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, color: c.text }}>Casas de este bloque</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8, maxHeight: 220, overflow: "auto", border: `1px solid ${c.border}`, borderRadius: 14, padding: 10 }}>
                    {houses.length === 0 ? <div style={{ color: c.muted, fontSize: 13 }}>Esta obra todavía no tiene casas.</div> : houses.map((h) => {
                      const checked = (bloqueForm.houseIds || []).includes(h.id);
                      return (
                        <label key={h.id} style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${checked ? c.primary : c.border}`, borderRadius: 10, padding: "6px 8px", cursor: "pointer", background: checked ? c.primarySoft : "#fff", fontSize: 12, fontWeight: 700, color: c.text }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked ? [...(bloqueForm.houseIds || []), h.id] : (bloqueForm.houseIds || []).filter((id) => id !== h.id);
                              setBloqueForm({ ...bloqueForm, houseIds: next });
                            }}
                          />
                          {h.name}
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, color: c.text }}>Equipo asignado (correos separados por coma)</div>
                  <textarea value={bloqueForm.emailsText} onChange={(e) => setBloqueForm({ ...bloqueForm, emailsText: e.target.value })} placeholder="residente1@constructora.com, residente2@constructora.com" style={inputStyle({ minHeight: 70 })} />
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={saveBloqueForm} style={buttonStyle("primary")}>Guardar bloque</button>
                  <button onClick={() => setBloqueForm(null)} style={buttonStyle("secondary")}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {specsManagerOpen ? (
        <div
          onClick={() => { setSpecsManagerOpen(false); setSpecForm(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 1100 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle(), width: "100%", maxWidth: 820, maxHeight: "88vh", overflow: "auto", padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: c.text }}>Configurar checklist de calidad</div>
              <button onClick={() => { setSpecsManagerOpen(false); setSpecForm(null); }} style={buttonStyle("secondary", { padding: "8px 12px" })}>Cerrar</button>
            </div>
            <div style={{ color: c.muted, fontSize: 13, marginBottom: 18, lineHeight: 1.5 }}>
              Estos son los puntos que verá cada casa de esta obra: los 39 puntos de Aseguramiento (por etapa, manual TR-AC-M01) y los 36 de Control de Calidad para Entrega (por zona, manual TR-CC-M01). Puedes editar el texto, agregar puntos nuevos o quitar los que no apliquen a este proyecto.
            </div>

            {!specForm ? (
              <>
                <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
                  <button onClick={() => setSpecForm({ checklistType: "aseguramiento", partidaId: partidaTemplates[0].id, clave: "", concepto: "", criterioAceptacion: "", formaVerificacion: "", evidenceRequired: 1, clasificacion: "menor", peso: 1 })} style={buttonStyle("primary", { fontSize: 13 })}>+ Punto de Aseguramiento</button>
                  <button onClick={() => setSpecForm({ checklistType: "entrega", partidaId: zonaTemplates[0].id, clave: "", concepto: "", criterioAceptacion: "", formaVerificacion: "", evidenceRequired: 1, clasificacion: "menor", peso: 1 })} style={buttonStyle("primary", { fontSize: 13 })}>+ Punto de Entrega</button>
                </div>

                <div style={{ fontSize: 16, fontWeight: 900, color: c.text, marginBottom: 8 }}>🔧 Aseguramiento (por etapa)</div>
                {partidaTemplates.map((template) => {
                  const items = qualitySpecs.filter((s) => s.checklistType !== "entrega" && (s.partidaId || qualityPartidaIdFromSpec(s)) === template.id);
                  if (!items.length) return null;
                  return (
                    <details key={template.id} style={{ marginBottom: 8, border: `1px solid ${c.border}`, borderRadius: 14, padding: "8px 12px" }}>
                      <summary style={{ cursor: "pointer", fontWeight: 800, color: c.text }}>{template.name} <span style={{ color: c.muted, fontWeight: 600 }}>({items.length})</span></summary>
                      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                        {items.map((spec) => (
                          <div key={spec.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", padding: 10, border: `1px solid ${c.border}`, borderRadius: 12, background: c.panelSoft }}>
                            <div>
                              <div style={{ fontWeight: 800, fontSize: 13, color: c.text }}>{spec.clave} · {spec.concepto}</div>
                              {spec.criterioAceptacion ? <div style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>{spec.criterioAceptacion}</div> : null}
                            </div>
                            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                              <button onClick={() => setSpecForm({ ...spec })} style={buttonStyle("secondary", { padding: "6px 10px", fontSize: 11 })}>Editar</button>
                              <button onClick={() => deleteSpec(spec.id)} style={buttonStyle("danger", { padding: "6px 10px", fontSize: 11 })}>Eliminar</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })}

                <div style={{ fontSize: 16, fontWeight: 900, color: c.text, marginTop: 20, marginBottom: 8 }}>🏁 Control de Calidad · Entrega (por zona)</div>
                {zonaTemplates.map((zona) => {
                  const items = qualitySpecs.filter((s) => s.checklistType === "entrega" && (s.partidaId || qualityPartidaIdFromSpec(s)) === zona.id);
                  if (!items.length) return null;
                  return (
                    <details key={zona.id} style={{ marginBottom: 8, border: `1px solid ${c.border}`, borderRadius: 14, padding: "8px 12px" }}>
                      <summary style={{ cursor: "pointer", fontWeight: 800, color: c.text }}>{zona.name} <span style={{ color: c.muted, fontWeight: 600 }}>({items.length})</span></summary>
                      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                        {items.map((spec) => (
                          <div key={spec.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", padding: 10, border: `1px solid ${c.border}`, borderRadius: 12, background: c.panelSoft }}>
                            <div>
                              <div style={{ fontWeight: 800, fontSize: 13, color: c.text }}>{spec.clave} · {spec.concepto}</div>
                              {spec.criterioAceptacion ? <div style={{ fontSize: 12, color: c.muted, marginTop: 4 }}>{spec.criterioAceptacion}</div> : null}
                            </div>
                            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                              <button onClick={() => setSpecForm({ ...spec })} style={buttonStyle("secondary", { padding: "6px 10px", fontSize: 11 })}>Editar</button>
                              <button onClick={() => deleteSpec(spec.id)} style={buttonStyle("danger", { padding: "6px 10px", fontSize: 11 })}>Eliminar</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })}
                {qualitySpecs.length === 0 ? (
                  <div style={{ border: `1px dashed ${c.border}`, borderRadius: 16, padding: 16, color: c.muted, fontSize: 13 }}>
                    Cargando el checklist de los manuales por primera vez… si esto no cambia en unos segundos, recarga la página.
                  </div>
                ) : null}
              </>
            ) : (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: c.text }}>Tipo de checklist</div>
                    <select value={specForm.checklistType} onChange={(e) => { const checklistType = e.target.value; setSpecForm({ ...specForm, checklistType, partidaId: checklistType === "entrega" ? zonaTemplates[0].id : partidaTemplates[0].id }); }} style={inputStyle()}>
                      <option value="aseguramiento">Aseguramiento (obra en proceso)</option>
                      <option value="entrega">Control de Calidad (entrega)</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: c.text }}>{specForm.checklistType === "entrega" ? "Zona" : "Etapa"}</div>
                    <select value={specForm.partidaId} onChange={(e) => setSpecForm({ ...specForm, partidaId: e.target.value })} style={inputStyle()}>
                      {(specForm.checklistType === "entrega" ? zonaTemplates : partidaTemplates).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: c.text }}>Código (ej. AC-CI-01 o CC-BA-01)</div>
                  <input value={specForm.clave} onChange={(e) => setSpecForm({ ...specForm, clave: e.target.value })} style={inputStyle()} />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: c.text }}>Punto de verificación (título corto)</div>
                  <input value={specForm.concepto} onChange={(e) => setSpecForm({ ...specForm, concepto: e.target.value })} style={inputStyle()} />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: c.text }}>Criterio de aceptación</div>
                  <textarea value={specForm.criterioAceptacion} onChange={(e) => setSpecForm({ ...specForm, criterioAceptacion: e.target.value })} style={inputStyle({ minHeight: 80 })} />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: c.text }}>Forma de verificación (cómo revisarlo)</div>
                  <textarea value={specForm.formaVerificacion} onChange={(e) => setSpecForm({ ...specForm, formaVerificacion: e.target.value })} style={inputStyle({ minHeight: 80 })} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 14, marginBottom: 18 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: c.text }}>Fotos requeridas</div>
                    <input type="number" min={0} value={specForm.evidenceRequired} onChange={(e) => setSpecForm({ ...specForm, evidenceRequired: e.target.value })} style={inputStyle()} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: c.text }}>Clasificación</div>
                    <select value={specForm.clasificacion} onChange={(e) => setSpecForm({ ...specForm, clasificacion: e.target.value })} style={inputStyle()}>
                      <option value="menor">Menor</option>
                      <option value="critico">Crítico</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: c.text }}>Peso</div>
                    <input type="number" min={1} value={specForm.peso} onChange={(e) => setSpecForm({ ...specForm, peso: e.target.value })} style={inputStyle()} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={saveSpecForm} style={buttonStyle("primary")}>Guardar punto</button>
                  <button onClick={() => setSpecForm(null)} style={buttonStyle("secondary")}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {reportModalOpen ? (
        <div
          onClick={() => setReportModalOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 1100 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle(), width: "100%", maxWidth: 560, maxHeight: "88vh", overflow: "auto", padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: c.text }}>Generar reporte de calidad</div>
              <button onClick={() => setReportModalOpen(false)} style={buttonStyle("secondary", { padding: "8px 12px" })}>Cerrar</button>
            </div>
            <div style={{ color: c.muted, fontSize: 13, marginBottom: 18, lineHeight: 1.5 }}>
              Se abrirá el diálogo de impresión de tu navegador; ahí puedes elegir "Guardar como PDF" para descargarlo.
            </div>

            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: c.text }}>¿Qué checklist incluir?</div>
            <div style={{ display: "flex", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: c.text, cursor: "pointer" }}>
                <input type="checkbox" checked={reportSelection.aseguramiento} onChange={(e) => setReportSelection({ ...reportSelection, aseguramiento: e.target.checked })} />
                🔧 Aseguramiento
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: c.text, cursor: "pointer" }}>
                <input type="checkbox" checked={reportSelection.entrega} onChange={(e) => setReportSelection({ ...reportSelection, entrega: e.target.checked })} />
                🏁 Control de Calidad (Entrega)
              </label>
            </div>

            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: c.text }}>¿Qué casas?</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: c.text, cursor: "pointer" }}>
                <input type="radio" name="reportScope" checked={reportSelection.scope === "all"} onChange={() => setReportSelection({ ...reportSelection, scope: "all" })} />
                Todas las casas ({visibleHouses.length})
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: c.text, cursor: "pointer" }}>
                <input type="radio" name="reportScope" checked={reportSelection.scope === "select"} onChange={() => setReportSelection({ ...reportSelection, scope: "select" })} />
                Elegir casas
              </label>
            </div>

            {reportSelection.scope === "select" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8, maxHeight: 220, overflow: "auto", border: `1px solid ${c.border}`, borderRadius: 14, padding: 10, marginBottom: 18 }}>
                {visibleHouses.map((h) => {
                  const checked = reportSelection.houseIds.includes(h.id);
                  return (
                    <label key={h.id} style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${checked ? c.primary : c.border}`, borderRadius: 10, padding: "6px 8px", cursor: "pointer", background: checked ? c.primarySoft : "#fff", fontSize: 12, fontWeight: 700, color: c.text }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked ? [...reportSelection.houseIds, h.id] : reportSelection.houseIds.filter((id) => id !== h.id);
                          setReportSelection({ ...reportSelection, houseIds: next });
                        }}
                      />
                      {h.name}
                    </label>
                  );
                })}
              </div>
            ) : null}

            <button onClick={generateQualityReport} style={buttonStyle("primary", { width: "100%" })}>Generar e imprimir / guardar PDF</button>
          </div>
        </div>
      ) : null}

      {printReport ? (
        <div className="print-only">
          {printReport.houseIds.map((houseId) => {
            const house = houses.find((h) => h.id === houseId);
            if (!house) return null;
            return printReport.tipos.map((tipo) => {
              const stages = tipo === "entrega" ? house.entregas || [] : house.partidas || [];
              const score = getHouseQualityScore(house, tipo === "entrega" ? "entregas" : "partidas");
              return (
                <div key={`${houseId}-${tipo}`} className="print-page" style={{ padding: 32, fontFamily: "Montserrat, Arial, sans-serif", color: "#242322" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #242322", paddingBottom: 12, marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 900 }}>{tipo === "entrega" ? "Control de Calidad · Reporte de Entrega" : "Aseguramiento de Calidad · Reporte de Avance"}</div>
                      <div style={{ fontSize: 13, marginTop: 4 }}>Obra: {printReport.obraName} · Casa: {house.name} · Bloque: {house.block || "-"}</div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 11, color: "#555" }}>
                      <div>Generado: {printReport.generatedAt}</div>
                      <div>Por: {printReport.generatedBy}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 24, marginBottom: 18 }}>
                    <div><b>Avance:</b> {score.avance}%</div>
                    <div><b>{tipo === "entrega" ? "Calificación de entrega" : "Calidad"}:</b> {score.calidad}%</div>
                    <div><b>Etapas/zonas completas:</b> {score.stagesComplete}/{score.stagesTotal}</div>
                  </div>
                  {stages.map((stage) => (
                    <div key={stage.id} className="print-avoid-break" style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 14, fontWeight: 900, background: "#f2f2f2", padding: "6px 10px", borderRadius: 6 }}>{stage.name} — {stage.status}</div>
                      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, fontSize: 11 }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid #999", textAlign: "left" }}>
                            <th style={{ padding: "4px 6px" }}>Código</th>
                            <th style={{ padding: "4px 6px" }}>Punto de verificación</th>
                            <th style={{ padding: "4px 6px" }}>Resultado</th>
                            <th style={{ padding: "4px 6px" }}>Fotos</th>
                            <th style={{ padding: "4px 6px" }}>Observación</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(stage.checklist || []).map((item) => (
                            <tr key={item.id} style={{ borderBottom: "1px solid #ddd" }}>
                              <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>{item.code}</td>
                              <td style={{ padding: "4px 6px" }}>{item.label}</td>
                              <td style={{ padding: "4px 6px", fontWeight: 700 }}>
                                {item.resultado === "cumple" ? "Cumple" : item.resultado === "no_cumple" ? "No cumple" : item.resultado === "observacion" ? "Observación" : item.resultado === "na" ? "No aplica" : "Pendiente"}
                              </td>
                              <td style={{ padding: "4px 6px" }}>{(item.photos || []).length}</td>
                              <td style={{ padding: "4px 6px" }}>{item.note || ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              );
            });
          })}
        </div>
      ) : null}

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
