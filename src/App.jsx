import React, { useEffect, useMemo, useState } from "react";
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

const obraId = "arenna";

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

function buildChecklist(partidaId, currentChecklist = null) {
  const template = checklistByPartida[partidaId] || [];

  return template.map((item) => {
    const id = item.code;
    const existing = currentChecklist?.find((i) => i.id === id);

    return {
      id,
      code: item.code,
      label: item.label,
      checked: existing?.checked ?? false,
      note: existing?.note || "",
      photos: existing?.photos || [],
      comments: existing?.comments || [],
    };
  });
}

function normalizePartida(partida) {
  return {
    ...partida,
    checklist: buildChecklist(partida.id, partida.checklist, partida.checkedItems || []),
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

function CommentThread({ comments }) {
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
        </div>
      ))}
    </div>
  );
}

async function seedProject() {
  const obraRef = doc(db, "obras", obraId);
  const obraSnap = await getDoc(obraRef);

  if (!obraSnap.exists()) {
    await setDoc(obraRef, {
      name: "Arenna",
      totalHouses: 26,
      createdAt: serverTimestamp(),
    });
  }

  const tasks = Array.from({ length: 26 }, async (_, i) => {
    const n = i + 1;
    const block = i < 5 ? "A" : i < 10 ? "B" : i < 15 ? "C" : i < 20 ? "D" : "E";
    const houseId = `casa-${String(n).padStart(2, "0")}`;
    const houseRef = doc(db, "obras", obraId, "casas", houseId);

    await setDoc(
      houseRef,
      {
        id: houseId,
        number: n,
        name: `Casa ${n}`,
        block,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );

    await Promise.all(
      partidaTemplates.map((partida) => {
        const partidaRef = doc(db, "obras", obraId, "casas", houseId, "partidas", partida.id);
        return setDoc(
          partidaRef,
          {
            ...partida,
            status: "Pendiente",
            checkedItems: [],
            checklist: buildChecklist(partida.id),
            notes: "",
generalComments: [],
evidenceCount: { photos: 0, videos: 0 },
            createdAt: serverTimestamp(),
            lastUpdatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      })
    );
  });

  await Promise.all(tasks);
  alert("Arenna demo cargado");
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
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [houses, setHouses] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [selectedHouseId, setSelectedHouseId] = useState("");
  const [selectedPartidaId, setSelectedPartidaId] = useState("cimentacion");
  const [tab, setTab] = useState("evidencia");
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
    if (!authUser) return;

    const housesRef = collection(db, "obras", obraId, "casas");
    const q = query(housesRef, orderBy("number", "asc"));

    const unsub = onSnapshot(q, async (snapshot) => {
      const data = await Promise.all(
        snapshot.docs.map(async (houseDoc) => {
          const partidasRef = collection(db, "obras", obraId, "casas", houseDoc.id, "partidas");
          const partidasSnap = await getDocs(query(partidasRef, orderBy("weight", "asc")));
          return {
            id: houseDoc.id,
            ...houseDoc.data(),
            partidas: partidasSnap.docs.map((p) => normalizePartida({ id: p.id, ...p.data() })),
          };
        })
      );

      setHouses(data);
      setLoadingData(false);
      if (!selectedHouseId && data.length) setSelectedHouseId(data[0].id);
    });

    return () => unsub();
  }, [authUser, selectedHouseId]);

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
                })
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

  async function toggleChecklistItem(itemId) {
    const item = selectedPartida?.checklist?.find((entry) => entry.id === itemId);
    if (!item) return;
    await updateChecklistItem(itemId, { checked: !item.checked });
  }
function buildNewComment(textValue) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text: textValue.trim(),
    authorUid: authUser?.uid || null,
    authorName: profile?.name || authUser?.email || "Usuario",
    authorRole: profile?.role || "usuario",
    createdAt: new Date().toISOString(),
  };
}

async function addChecklistComment(itemId) {
  const draft = (checklistCommentDrafts[itemId] || "").trim();
  if (!draft) return;

  const checklistItem = (selectedPartida?.checklist || []).find((item) => item.id === itemId);
  if (!checklistItem) return;

  const nextComments = [...(checklistItem.comments || []), buildNewComment(draft)];
  await updateChecklistItem(itemId, { comments: nextComments });

  setChecklistCommentDrafts((prev) => ({
    ...prev,
    [itemId]: "",
  }));
}

async function addGeneralComment() {
  const draft = generalCommentDraft.trim();
  if (!draft) return;

  const nextComments = [...(selectedPartida?.generalComments || []), buildNewComment(draft)];
  await updatePartida({ generalComments: nextComments });
  setGeneralCommentDraft("");
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
    try {
      setActionLoading(true);
      await updatePartida({ status: "Rechazada" });
      alert("Partida rechazada");
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

  if (loadingData) {
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
            Si todavía no existe la estructura, crea Arenna con un clic.
          </div>
          <button onClick={seedProject} style={buttonStyle("secondary")}>
            Cargar demo Arenna
          </button>
        </div>
      </div>
    );
  }

  const checklistCompleted = (selectedPartida?.checklist || []).filter((item) => item.checked).length;
  const checklistTotal = (selectedPartida?.checklist || []).length;
  const checklistWithPhotos = (selectedPartida?.checklist || []).filter((item) => (item.photos || []).length > 0).length;
const checklistItems = selectedPartida?.checklist || [];

const incompleteChecklistItems = checklistItems.filter((item) => !item.checked);
const checklistItemsWithoutPhotos = checklistItems.filter((item) => !item.photos || item.photos.length === 0);

const canSendToReview =
  checklistItems.length > 0 &&
  incompleteChecklistItems.length === 0 &&
  checklistItemsWithoutPhotos.length === 0;

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
              Arenna · Control de calidad
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

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={badgeStyle(profile?.role || "Pendiente")}>Rol: {profile?.role || "sin rol"}</span>
            <span style={badgeStyle("Pendiente")}>{authUser.email}</span>
            <button onClick={seedProject} style={buttonStyle("secondary")}>
              Cargar demo Arenna
            </button>
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
          <StatCard title="Obra" value="Arenna" />
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
                            disabled={actionLoading}
                            style={buttonStyle("danger", {
                              opacity: actionLoading ? 0.6 : 1,
                              cursor: actionLoading ? "not-allowed" : "pointer",
                            })}
                          >
                            {actionLoading ? "Procesando..." : "Rechazar"}
                          </button>
                          <button
                            onClick={approvePartida}
                            disabled={actionLoading}
                            style={buttonStyle("primary", {
                              opacity: actionLoading ? 0.6 : 1,
                              cursor: actionLoading ? "not-allowed" : "pointer",
                            })}
                          >
                            {actionLoading ? "Procesando..." : "Aprobar"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))",
                      gap: 14,
                      marginTop: 18,
                    }}
                  >
                    <StatCard title="Estado" value={<span style={badgeStyle(selectedPartida.status)}>{selectedPartida.status}</span>} />
                    <StatCard title="Fotos generales" value={selectedPartida.evidenceCount?.photos || 0} />
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
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        marginBottom: 16,
                        flexDirection: isMobile ? "column" : "row",
                      }}
                    >
                      <TabButton active={tab === "evidencia"} onClick={() => setTab("evidencia")}>
                        Evidencia
                      </TabButton>
                      <TabButton active={tab === "checklist"} onClick={() => setTab("checklist")}>
                        Checklist
                      </TabButton>
                      <TabButton active={tab === "notas"} onClick={() => setTab("notas")}>
                        Notas
                      </TabButton>
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
            </button>

            <div style={{ color: c.muted, fontSize: 12, marginTop: 8 }}>
              {item.photos?.length || 0} foto(s) · {item.checked ? "Punto atendido" : "Pendiente"}
            </div>
          </div>

          {isConstructora ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label style={buttonStyle("secondary", { display: "inline-flex", alignItems: "center" })}>
                {checklistUploading[item.id] ? "Subiendo..." : "Tomar foto"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: "none" }}
                  onChange={(e) => handleChecklistPhotoUpload(item.id, e.target.files)}
                />
              </label>

              <label style={buttonStyle("secondary", { display: "inline-flex", alignItems: "center" })}>
                {checklistUploading[item.id] ? "Subiendo..." : "Subir fotos"}
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

        <div style={{ marginTop: 14 }}>
          <CommentThread comments={item.comments || []} />
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
            <button onClick={() => addChecklistComment(item.id)} style={buttonStyle("primary")}>
              Agregar comentario
            </button>
          </div>
        </div>

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
                          <div style={{ color: c.muted, fontSize: 13 }}>Puntos con evidencia</div>
                          <div style={{ color: c.text, fontWeight: 800, marginTop: 4 }}>{checklistWithPhotos} / {checklistTotal}</div>
                        </div>
                      </div>
                    </div>

                    <div style={{ ...cardStyle(), padding: 20 }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: c.text, marginBottom: 14 }}>Regla operativa</div>
                      <div style={{ color: c.muted, lineHeight: 1.6 }}>
                        La aprobación sigue siendo por partida, pero ahora cada punto de control puede documentarse con nota y evidencia fotográfica.
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

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
