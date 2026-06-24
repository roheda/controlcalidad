import React, { useEffect, useMemo, useState } from "react";
import { getApps } from "firebase/app";
import { collection, deleteDoc, doc, getDocs, getFirestore, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

const defaultObraId = "";
const inputBase = { width: "100%", minHeight: 44, border: "1px solid rgba(60,60,67,0.16)", borderRadius: 14, padding: "10px 12px", background: "#fff", color: "#1d1d1f", outline: "none", boxSizing: "border-box" };
const buttonBase = { border: "1px solid rgba(60,60,67,0.12)", borderRadius: 999, padding: "10px 14px", fontWeight: 850, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" };
const th = { padding: "10px", fontSize: 11, fontWeight: 950, color: "#6e6e73", textTransform: "uppercase", letterSpacing: 0.35, background: "rgba(242,242,247,0.96)", borderBottom: "1px solid rgba(60,60,67,0.10)" };
const td = { padding: "10px", borderBottom: "1px solid rgba(60,60,67,0.10)", verticalAlign: "top", fontSize: 13, color: "#1d1d1f" };

function getDb() { const app = getApps()[0]; return app ? getFirestore(app) : null; }
function getStorageClient() { const app = getApps()[0]; return app ? getStorage(app) : null; }
function money(value) { return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function parseNumber(value) { const parsed = Number(String(value ?? "").replace(/\$/g, "").replace(/,/g, "").replace(/\s/g, "").trim()); return Number.isFinite(parsed) ? parsed : 0; }
function slugify(text = "") { return String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function cleanText(text = "") { return String(text).replace(/Ã“/g, "Ó").replace(/Ã‰/g, "É").replace(/Ã/g, "Á").replace(/Ã/g, "Í").replace(/Ãš/g, "Ú").replace(/Ã‘/g, "Ñ").replace(/Ã³/g, "ó").replace(/Ã©/g, "é").replace(/Ã¡/g, "á").replace(/Ã­/g, "í").replace(/Ãº/g, "ú").replace(/Ã±/g, "ñ").replace(/Â/g, "").trim(); }
function parseCsv(text) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') { if (inQuotes && next === '"') { current += '"'; i += 1; } else inQuotes = !inQuotes; continue; }
    if (char === "," && !inQuotes) { row.push(current); current = ""; continue; }
    if ((char === "\n" || char === "\r") && !inQuotes) { if (char === "\r" && next === "\n") i += 1; row.push(current); if (row.some((cell) => String(cell).trim() !== "")) rows.push(row); row = []; current = ""; continue; }
    current += char;
  }
  row.push(current);
  if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
  return rows;
}
function normalizeCatalogItem(item, index = 0) {
  const cantidad = parseNumber(item.cantidad ?? item.Unidades ?? item.unidades ?? item.cantidadContratada ?? 1);
  const precioUnitario = parseNumber(item.precioUnitario ?? item["P.U."] ?? item.pu ?? item.PU ?? item.precio_unitario ?? 0);
  const clave = cleanText(item.clave || item.Clave || item.id || `CON-${index + 1}`);
  const partida = cleanText(item.partida || item.PARTIDA || item.capitulo || "General");
  const concepto = cleanText(item.concepto || item.descripcion || item.Descripcion || item.descripción || item.description || "Concepto sin nombre");
  const unidad = cleanText(item.unidad || item.Unidad || "lote");
  const rowNumber = Number(item.rowNumber || index + 1);
  return { id: item.id || `${slugify(partida)}-${slugify(clave)}-${String(rowNumber).padStart(4, "0")}`, clave, partida, concepto, descripcion: concepto, unidad, cantidad, precioUnitario, importe: cantidad * precioUnitario, fechaEntrega: item.fechaEntrega || item.fecha_entrega || item["Fecha Entrega"] || item["Fecha compromiso"] || "", rowNumber, sourceFileName: item.sourceFileName || "" };
}
function rowsToCatalog(rows, sourceFileName = "") {
  if (!rows.length) return [];
  const headers = rows[0].map((header) => cleanText(header));
  return rows.slice(1).map((row, index) => {
    const raw = {};
    headers.forEach((header, columnIndex) => { raw[header] = row[columnIndex] ?? ""; });
    return normalizeCatalogItem({ PARTIDA: raw.PARTIDA, clave: raw.clave || raw.Clave, descripcion: raw.descripcion || raw.Descripcion || raw.DESCRIPCION || raw.DESCRIPCIÓN, Unidades: raw.Unidades || raw.unidades || raw.Cantidad || raw.cantidad, unidad: raw.unidad || raw.Unidad, "P.U.": raw["P.U."] || raw.PU || raw["Precio Unitario"] || raw.precioUnitario, fechaEntrega: raw["Fecha Entrega"] || raw.fechaEntrega || raw["Fecha compromiso"] || raw["fecha compromiso"] || raw.fecha_entrega, rowNumber: index + 2, sourceFileName }, index);
  }).filter((item) => item.clave && item.concepto && item.precioUnitario > 0);
}
function downloadTextFile(fileName, content, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function downloadCatalogTemplate() {
  const rows = [
    ["PARTIDA", "clave", "descripcion", "Unidades", "unidad", "P.U.", "Fecha Entrega"],
    ["CIMENTACION", "CIM-001", "Descripción del concepto conforme al catálogo autorizado", "1", "lote", "0", "2026-12-31"],
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadTextFile("plantilla-catalogo-conceptos-triton.csv", csv);
}

const qualityManualSeed = [
  {
    "clave": "AC-PL-01",
    "partida": "Preliminares",
    "concepto": "El trazo coincide con planos autorizados",
    "criterioAceptacion": "El trazo deberá corresponder exactamente a la ubicación, ejes, dimensiones y alineaciones indicadas en planos arquitectónicos y estructurales vigentes.",
    "puntosAceptables": "Las dimensiones coinciden con plano. La escuadra es correcta. Los ejes están claramente definidos y alineados.",
    "puntosNoAceptables": "Existen desviaciones dimensionales respecto al plano. La escuadra no coincide. Los ejes no están correctamente alineados. Se detectan diferencias en ubicación del desplante.",
    "formaVerificacion": "Medir distancias entre ejes principales. Confirmar escuadra general mediante verificación diagonal. Comparar medidas críticas con plano autorizado.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-PL-01.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-PL-01.jpg",
    "catalogKeywords": "El trazo coincide con planos autorizados"
  },
  {
    "clave": "AC-PL-02",
    "partida": "Preliminares",
    "concepto": "Los niveles de desplante fueron verificados",
    "criterioAceptacion": "El nivel de desplante deberá coincidir con la cota establecida en proyecto, considerando referencia topográfica o banco de nivel autorizado.",
    "puntosAceptables": "El nivel coincide con la cota indicada. Se mantiene referencia clara de banco de nivel. Las pendientes proyectadas están correctamente ejecutadas.",
    "puntosNoAceptables": "Existe diferencia significativa respecto a la cota de proyecto. No se cuenta con referencia de nivel confiable. Se detectan pendientes no contempladas.",
    "formaVerificacion": "Comprobar nivel mediante equipo de medición. Verificar relación entre nivel natural del terreno y nivel proyectado.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-PL-02.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-PL-02.jpg",
    "catalogKeywords": "Los niveles de desplante fueron verificados"
  },
  {
    "clave": "AC-PL-03",
    "partida": "Preliminares",
    "concepto": "Ejes y referencias se encuentran protegidos",
    "criterioAceptacion": "Las referencias de trazo deberán permanecer visibles y protegidas durante la ejecución para evitar pérdida de alineación estructural.",
    "puntosAceptables": "Las referencias están claramente marcadas. Permanecen protegidas y visibles. No presentan alteraciones.",
    "puntosNoAceptables": "Las referencias han sido borradas o desplazadas. No existen puntos de control activos. Se pierde alineación original.",
    "formaVerificacion": "Inspeccionar puntos de control. Confirmar que no hayan sido alterados por movimiento de maquinaria o material.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-PL-03.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-PL-03.jpg",
    "catalogKeywords": "Ejes y referencias se encuentran protegidos"
  },
  {
    "clave": "AC-EX-01",
    "partida": "Excavación",
    "concepto": "Profundidad y dimensiones de excavación cumplen especificación",
    "criterioAceptacion": "Las excavaciones deberán ejecutarse conforme a dimensiones y profundidad establecidas en planos estructurales.",
    "puntosAceptables": "Dimensiones coinciden con plano. La excavación es uniforme. Las paredes se encuentran estables.",
    "puntosNoAceptables": "La profundidad es menor a la especificada. Existen variaciones dimensionales no autorizadas. Se detectan paredes inestables o colapsadas.",
    "formaVerificacion": "Medir profundidad en distintos puntos. Verificar ancho y longitud de zanjas o dados antes de armado.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-EX-01.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-EX-01.jpg",
    "catalogKeywords": "Profundidad y dimensiones de excavación cumplen especificación"
  },
  {
    "clave": "AC-EX-02",
    "partida": "Excavación",
    "concepto": "Fondo de excavación firme y libre de material suelto",
    "criterioAceptacion": "El fondo deberá estar limpio, compacto y libre de material orgánico o suelto antes de colocar plantilla o armado.",
    "puntosAceptables": "El fondo está firme y compacto. Se encuentra limpio. No hay material inadecuado presente.",
    "puntosNoAceptables": "Existen capas de material suelto. Se observa humedad excesiva no controlada. Hay presencia de raíces o residuos orgánicos.",
    "formaVerificacion": "Inspección visual y comprobación de firmeza. Confirmar retiro de material suelto previo a colado de plantilla.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-EX-02.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-EX-02.jpg",
    "catalogKeywords": "Fondo de excavación firme y libre de material suelto"
  },
  {
    "clave": "AC-CI-01",
    "partida": "Cimentación",
    "concepto": "Plantilla de concreto aplicada antes de armado",
    "criterioAceptacion": "La plantilla deberá aplicarse con espesor uniforme antes de colocar acero de refuerzo, garantizando separación adecuada del suelo natural.",
    "puntosAceptables": "La plantilla está presente y uniforme. El acero no tiene contacto directo con el suelo. La superficie es adecuada para el armado.",
    "puntosNoAceptables": "No existe plantilla. El espesor es irregular o insuficiente. El acero queda en contacto directo con el terreno.",
    "formaVerificacion": "Confirmar presencia de plantilla y revisar espesor aproximado antes del armado.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-CI-01.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-CI-01.jpg",
    "catalogKeywords": "Plantilla de concreto aplicada antes de armado"
  },
  {
    "clave": "AC-CI-02",
    "partida": "Cimentación",
    "concepto": "Acero de refuerzo conforme a diámetro y separación especificados",
    "criterioAceptacion": "El acero de refuerzo deberá corresponder al diámetro, cantidad, ubicación y separación indicados en planos estructurales.",
    "puntosAceptables": "El diámetro es el especificado. La separación cumple con plano. El armado coincide en cantidad y ubicación.",
    "puntosNoAceptables": "El diámetro no coincide con el especificado. La separación entre barras es distinta a la indicada. Existen barras faltantes. La colocación no corresponde al plano estructural.",
    "formaVerificacion": "Revisar visualmente el diámetro de varillas. Medir separación entre barras. Confirmar ubicación correcta antes del colado.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-CI-02.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-CI-02.jpg",
    "catalogKeywords": "Acero de refuerzo conforme a diámetro y separación especificados"
  },
  {
    "clave": "AC-CI-03",
    "partida": "Cimentación",
    "concepto": "Traslapes y amarres correctamente ejecutados",
    "criterioAceptacion": "Los traslapes deberán cumplir con la longitud mínima requerida y los amarres deberán asegurar estabilidad del armado previo al colado.",
    "puntosAceptables": "Los traslapes cumplen longitud mínima. Los amarres aseguran estabilidad. El armado se mantiene firme.",
    "puntosNoAceptables": "La longitud de traslape es insuficiente. Los amarres son escasos o inexistentes. El armado presenta inestabilidad.",
    "formaVerificacion": "Medir longitud de traslapes en puntos representativos. Verificar firmeza del amarre y continuidad estructural.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-CI-03.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-CI-03.jpg",
    "catalogKeywords": "Traslapes y amarres correctamente ejecutados"
  },
  {
    "clave": "AC-CI-04",
    "partida": "Cimentación",
    "concepto": "Recubrimiento mínimo de concreto respetado",
    "criterioAceptacion": "El acero deberá mantener el recubrimiento mínimo especificado para evitar exposición o corrosión futura.",
    "puntosAceptables": "El acero mantiene separación uniforme. Existen separadores correctamente colocados. El recubrimiento cumple con especificación.",
    "puntosNoAceptables": "El acero se encuentra en contacto con la cimbra o terreno. No existen separadores. El recubrimiento es insuficiente.",
    "formaVerificacion": "Confirmar colocación de separadores. Medir distancia aproximada entre acero y cimbra o plantilla.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-CI-04.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-CI-04.jpg",
    "catalogKeywords": "Recubrimiento mínimo de concreto respetado"
  },
  {
    "clave": "AC-CI-05",
    "partida": "Cimentación",
    "concepto": "Instalaciones cruzando cimentación protegidas",
    "criterioAceptacion": "Las tuberías o ductos que atraviesen elementos de cimentación deberán encontrarse correctamente protegidos y ubicados conforme a plano.",
    "puntosAceptables": "La ubicación coincide con plano. Se encuentran protegidas. Están firmemente fijadas.",
    "puntosNoAceptables": "Las instalaciones no coinciden con ubicación proyectada. No cuentan con protección. Presentan desplazamiento previo al colado.",
    "formaVerificacion": "Confirmar ubicación previa al colado. Verificar protección y fijación adecuada.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-CI-05.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-CI-05.jpg",
    "catalogKeywords": "Instalaciones cruzando cimentación protegidas"
  },
  {
    "clave": "AC-CO-01",
    "partida": "Colado",
    "concepto": "Concreto con revenimiento adecuado",
    "criterioAceptacion": "El concreto deberá presentar consistencia adecuada conforme a especificación técnica, sin exceso de agua.",
    "puntosAceptables": "La consistencia es uniforme. No hay segregación visible. Se respeta la dosificación indicada.",
    "puntosNoAceptables": "Se observa segregación. Se adiciona agua en exceso. La mezcla es excesivamente fluida o seca.",
    "formaVerificacion": "Observar consistencia al momento del vaciado. Confirmar que no se agregue agua adicional en obra sin autorización técnica.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-CO-01.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-CO-01.jpg",
    "catalogKeywords": "Concreto con revenimiento adecuado"
  },
  {
    "clave": "AC-CO-02",
    "partida": "Colado",
    "concepto": "Vibrado correcto sin segregación",
    "criterioAceptacion": "El concreto deberá vibrarse adecuadamente para evitar vacíos, sin provocar segregación de materiales.",
    "puntosAceptables": "El concreto se compacta adecuadamente. No existen vacíos visibles. La superficie presenta acabado uniforme posterior al colado.",
    "puntosNoAceptables": "Se observan vacíos o nidos de grava. El vibrado es insuficiente. Se produce segregación por vibrado excesivo.",
    "formaVerificacion": "Supervisar proceso de vibrado durante colado. Confirmar que el vibrador se utilice correctamente y sin sobreexposición en un solo punto.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-CO-02.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-CO-02.jpg",
    "catalogKeywords": "Vibrado correcto sin segregación"
  },
  {
    "clave": "AC-CO-03",
    "partida": "Colado",
    "concepto": "Curado aplicado posterior al colado",
    "criterioAceptacion": "Los elementos colados deberán recibir curado adecuado para evitar fisuración prematura y pérdida de resistencia.",
    "puntosAceptables": "Se aplica método de curado adecuado. Se mantiene humedad superficial controlada. No existen fisuras atribuibles a secado prematuro.",
    "puntosNoAceptables": "No se aplica ningún método de curado. La superficie presenta fisuras por secado prematuro. El curado se interrumpe antes del tiempo mínimo recomendado.",
    "formaVerificacion": "Confirmar aplicación de método de curado (agua, membrana o equivalente) durante el periodo inicial posterior al colado.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-CO-03.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-CO-03.jpg",
    "catalogKeywords": "Curado aplicado posterior al colado"
  },
  {
    "clave": "AC-ES-01",
    "partida": "Estructura",
    "concepto": "Columnas y castillos se encuentran plomados",
    "criterioAceptacion": "Los elementos verticales estructurales deberán mantener alineación vertical conforme a tolerancias aceptables.",
    "puntosAceptables": "El elemento mantiene verticalidad adecuada. No existen desviaciones perceptibles. Se verificó antes de cierre de cimbra.",
    "puntosNoAceptables": "Se detectan desviaciones visibles de verticalidad. El elemento presenta inclinación perceptible. No se realizó verificación antes de fraguar.",
    "formaVerificacion": "Comprobar plomo mediante herramienta de medición. Revisar alineación antes del fraguado final.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-ES-01.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-ES-01.jpg",
    "catalogKeywords": "Columnas y castillos se encuentran plomados"
  },
  {
    "clave": "AC-ES-02",
    "partida": "Estructura",
    "concepto": "Dalas y trabes respetan dimensiones de proyecto",
    "criterioAceptacion": "Las dimensiones de sección deberán corresponder a lo indicado en planos estructurales.",
    "puntosAceptables": "Las dimensiones coinciden con plano. La sección es uniforme. No existen deformaciones.",
    "puntosNoAceptables": "Las dimensiones son menores a las especificadas. Existen variaciones no autorizadas. La cimbra presenta deformaciones.",
    "formaVerificacion": "Medir ancho y peralte antes del colado o durante la cimbra.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-ES-02.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-ES-02.jpg",
    "catalogKeywords": "Dalas y trabes respetan dimensiones de proyecto"
  },
  {
    "clave": "AC-ES-03",
    "partida": "Estructura",
    "concepto": "Cimbra alineada y firme antes de colado",
    "criterioAceptacion": "La cimbra deberá encontrarse correctamente alineada, nivelada y firmemente apuntalada antes del vaciado de concreto.",
    "puntosAceptables": "La cimbra está firme y estable. Se encuentra correctamente alineada. El apuntalamiento es adecuado.",
    "puntosNoAceptables": "La cimbra presenta movimiento. Existe desalineación visible. El apuntalamiento es insuficiente.",
    "formaVerificacion": "Inspeccionar alineación, fijación y estabilidad general antes del colado.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-ES-03.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-ES-03.jpg",
    "catalogKeywords": "Cimbra alineada y firme antes de colado"
  },
  {
    "clave": "AC-LO-01",
    "partida": "Losa",
    "concepto": "Instalaciones colocadas antes de colado de losa",
    "criterioAceptacion": "Las instalaciones que deban quedar embebidas en losa deberán colocarse y fijarse antes del colado.",
    "puntosAceptables": "Están correctamente ubicadas. Se encuentran firmemente fijadas. Coinciden con planos.",
    "puntosNoAceptables": "Las instalaciones no están colocadas. Se encuentran sueltas o desplazadas. No coinciden con proyecto.",
    "formaVerificacion": "Confirmar ubicación y fijación previa al vaciado. Verificar coincidencia con plano.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-LO-01.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-LO-01.jpg",
    "catalogKeywords": "Instalaciones colocadas antes de colado de losa"
  },
  {
    "clave": "AC-LO-02",
    "partida": "Losa",
    "concepto": "Espesor de losa conforme a proyecto",
    "criterioAceptacion": "El espesor de losa deberá respetar el valor indicado en planos estructurales.",
    "puntosAceptables": "El espesor es uniforme. Coincide con proyecto. No existen reducciones no autorizadas.",
    "puntosNoAceptables": "El espesor es menor al especificado. Existen variaciones significativas. Se detectan zonas con reducción de sección.",
    "formaVerificacion": "Medir espesor en puntos representativos durante el proceso de colado.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-LO-02.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-LO-02.jpg",
    "catalogKeywords": "Espesor de losa conforme a proyecto"
  },
  {
    "clave": "AC-AL-01",
    "partida": "Albañilería",
    "concepto": "Muros alineados y plomados",
    "criterioAceptacion": "Los muros deberán ejecutarse respetando alineación horizontal y vertical conforme a proyecto arquitectónico.",
    "puntosAceptables": "El muro mantiene alineación uniforme. No existen desviaciones visibles. El plomo es consistente en toda la altura.",
    "puntosNoAceptables": "Se observan desviaciones visibles de verticalidad. Existen desplomes perceptibles. La alineación horizontal presenta irregularidades.",
    "formaVerificacion": "Comprobar alineación con hilo guía o herramienta de medición. Verificar plomo en distintos puntos del muro antes de continuar con niveles superiores.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-AL-01.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-AL-01.jpg",
    "catalogKeywords": "Muros alineados y plomados"
  },
  {
    "clave": "AC-AL-02",
    "partida": "Albañilería",
    "concepto": "Juntas uniformes y correctamente rellenas",
    "criterioAceptacion": "Las juntas entre piezas de muro de block deberán presentar espesor uniforme y relleno completo de mortero.",
    "puntosAceptables": "Las juntas son continuas y uniformes. El mortero rellena completamente el espacio. No existen vacíos visibles.",
    "puntosNoAceptables": "Existen juntas vacías o parcialmente rellenas. El espesor varía significativamente. Se observan huecos visibles.",
    "formaVerificacion": "Inspeccionar visualmente continuidad del mortero y uniformidad del espesor en distintos tramos del muro.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-AL-02.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-AL-02.jpg",
    "catalogKeywords": "Juntas uniformes y correctamente rellenas"
  },
  {
    "clave": "AC-AL-03",
    "partida": "Albañilería",
    "concepto": "Vanos conforme a dimensiones de proyecto",
    "criterioAceptacion": "Los vanos de puertas y ventanas deberán ejecutarse respetando ancho, altura y alineación indicados en planos.",
    "puntosAceptables": "Las dimensiones coinciden con proyecto. El vano se encuentra alineado y nivelado. No existen desviaciones.",
    "puntosNoAceptables": "Las dimensiones no coinciden con plano. Existe desalineación en el vano. No se respeta nivel o escuadra.",
    "formaVerificacion": "Medir dimensiones del vano antes de colocar marcos o continuar con acabados.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-AL-03.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-AL-03.jpg",
    "catalogKeywords": "Vanos conforme a dimensiones de proyecto"
  },
  {
    "clave": "AC-IH-01",
    "partida": "Instalaciones hidráulicas",
    "concepto": "Prueba de presión en instalaciones hidráulicas antes de tapar",
    "criterioAceptacion": "Las instalaciones hidráulicas deberán someterse a una prueba de presión antes de ser cubiertas con aplanados, concreto o cualquier acabado. La prueba deberá realizarse bajo las siguientes condiciones: Presión de prueba: 90 PSI (6 kg/cm²) Duración mínima: 24 horas Durante este periodo, el sistema deberá mantener presión constante sin presentar fugas ni caídas. Adicionalmente, deberá generarse un reporte escrito de la prueba, el cual deberá estar firmado por el responsable de supervisión. Nota: La operación normal de la vivienda no deberá superar 60 PSI.",
    "puntosAceptables": "La prueba se realizó conforme a presión y tiempo establecidos. No existen fugas ni caídas de presión. El sistema se mantiene estable durante 24 horas. Existe reporte documentado firmado por supervisión.",
    "puntosNoAceptables": "No se realizó la prueba de presión. La presión es menor a la especificada o el tiempo es insuficiente. Existe caída de presión durante el periodo de prueba. Se detectan fugas visibles. No existe reporte o no está firmado por supervisión.",
    "formaVerificacion": "Presurizar el sistema conforme a los valores establecidos. Monitorear estabilidad de presión durante 24 horas. Inspeccionar visualmente posibles fugas en conexiones y tuberías. Confirmar existencia de reporte documentado firmado por supervisión.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-IH-01.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-IH-01.jpg",
    "catalogKeywords": "Prueba de presión en instalaciones hidráulicas antes de tapar"
  },
  {
    "clave": "AC-IH-02",
    "partida": "Instalaciones hidráulicas",
    "concepto": "Pendientes de drenaje verificadas",
    "criterioAceptacion": "Las tuberías de drenaje deberán contar con pendiente suficiente para permitir desalojo adecuado.",
    "puntosAceptables": "La pendiente es continua. No existen contrapendientes. La instalación está correctamente alineada.",
    "puntosNoAceptables": "Existen tramos sin pendiente. Se detectan contrapendientes. La alineación es irregular.",
    "formaVerificacion": "Confirmar pendiente visualmente antes de cubrir. Verificar alineación y continuidad de la instalación.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-IH-02.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-IH-02.jpg",
    "catalogKeywords": "Pendientes de drenaje verificadas"
  },
  {
    "clave": "AC-IE-01",
    "partida": "Instalaciones eléctricas",
    "concepto": "Canalizaciones eléctricas completas antes de aplanado",
    "criterioAceptacion": "Todas las canalizaciones eléctricas deberán encontrarse colocadas y fijadas antes de iniciar aplanados.",
    "puntosAceptables": "Todas las canalizaciones están instaladas. Se encuentran firmemente fijadas. Coinciden con plano autorizado.",
    "puntosNoAceptables": "Faltan canalizaciones. Existen ductos sueltos. No coinciden con proyecto.",
    "formaVerificacion": "Revisar recorridos conforme a plano eléctrico. Confirmar fijación y ubicación correcta.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-IE-01.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-IE-01.jpg",
    "catalogKeywords": "Canalizaciones eléctricas completas antes de aplanado"
  },
  {
    "clave": "AC-IE-02",
    "partida": "Instalaciones eléctricas",
    "concepto": "Centro de carga correctamente instalado y señalizado",
    "criterioAceptacion": "El centro de carga deberá colocarse conforme a la ubicación proyectada, encontrarse firmemente instalado, alineado y con fijación adecuada, además de contar con nombres en pastillas de cada circuito. Adicionalmente, deberá contar con señalización preventiva visible que indique consideraciones para futuras instalaciones, incluyendo: Aires acondicionados Paneles solares Equipos eléctricos adicionales La señalización deberá proporcionar información clara que permita evitar sobrecargas o intervenciones incorrectas en el sistema eléctrico.",
    "puntosAceptables": "El centro de carga está correctamente ubicado, alineado y fijado. Cuenta con señalización preventiva visible. La información es clara, legible y completa. Permite orientar correctamente futuras intervenciones.",
    "puntosNoAceptables": "El centro de carga no coincide con ubicación proyectada. Presenta fijación deficiente o desalineación. No existe señalización preventiva. La señalización es ilegible, incompleta o inexistente.",
    "formaVerificacion": "Confirmar ubicación conforme a plano eléctrico. Verificar fijación, alineación y estabilidad del centro de carga. Inspeccionar presencia de señalización preventiva. Validar que la información sea clara, legible y visible.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-IE-02.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-IE-02.jpg",
    "catalogKeywords": "Centro de carga correctamente instalado y señalizado"
  },
  {
    "clave": "AC-AP-01",
    "partida": "Aplanados",
    "concepto": "Superficie preparada antes de aplicar aplanados",
    "criterioAceptacion": "Las superficies deberán encontrarse limpias, libres de polvo, grasa o material suelto antes de la aplicación de aplanados.",
    "puntosAceptables": "La superficie está limpia. No hay material suelto. Se aplicó preparación conforme al procedimiento.",
    "puntosNoAceptables": "Existen residuos sueltos. La superficie está contaminada. No se realizó preparación previa.",
    "formaVerificacion": "Inspección visual previa a la aplicación. Confirmar humectación adecuada cuando el procedimiento lo requiera.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-AP-01.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-AP-01.jpg",
    "catalogKeywords": "Superficie preparada antes de aplicar aplanados"
  },
  {
    "clave": "AC-AP-02",
    "partida": "Aplanados",
    "concepto": "Plomos y niveles verificados en aplanados",
    "criterioAceptacion": "Los aplanados deberán ejecutarse manteniendo alineación vertical y horizontal conforme a tolerancias aceptables.",
    "puntosAceptables": "El acabado es uniforme. Se mantiene plomo y nivel. No existen irregularidades perceptibles.",
    "puntosNoAceptables": "Existen desplomes visibles. Se observan ondulaciones significativas. El espesor es irregular.",
    "formaVerificacion": "Comprobar plomo y nivel durante la ejecución. Revisar continuidad y uniformidad del espesor.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-AP-02.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-AP-02.jpg",
    "catalogKeywords": "Plomos y niveles verificados en aplanados"
  },
  {
    "clave": "AC-PI-01",
    "partida": "Pisos",
    "concepto": "Base nivelada antes de colocación de piso",
    "criterioAceptacion": "La superficie base deberá encontrarse limpia, firme y nivelada antes de colocar recubrimientos.",
    "puntosAceptables": "La superficie es uniforme. Está limpia y firme. Se encuentra lista para recibir el recubrimiento.",
    "puntosNoAceptables": "Existen desniveles notorios. Hay residuos sueltos. La base presenta fracturas o humedad excesiva.",
    "formaVerificacion": "Inspeccionar visualmente la base. Confirmar ausencia de polvo o irregularidades.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-PI-01.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-PI-01.jpg",
    "catalogKeywords": "Base nivelada antes de colocación de piso"
  },
  {
    "clave": "AC-PI-02",
    "partida": "Pisos",
    "concepto": "Adhesivo aplicado uniformemente en colocación de piso",
    "criterioAceptacion": "El adhesivo deberá aplicarse de forma homogénea, garantizando adherencia adecuada de las piezas.",
    "puntosAceptables": "La aplicación es uniforme. Se garantiza contacto adecuado. No existen vacíos bajo piezas.",
    "puntosNoAceptables": "La aplicación es discontinua. Existen huecos sin adhesivo. Se observa exceso irregular.",
    "formaVerificacion": "Supervisar aplicación durante instalación. Confirmar cobertura suficiente bajo piezas representativas.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-PI-02.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-PI-02.jpg",
    "catalogKeywords": "Adhesivo aplicado uniformemente en colocación de piso"
  },
  {
    "clave": "AC-PI-03",
    "partida": "Pisos",
    "concepto": "Colocación de mármol conforme a especificación técnica",
    "criterioAceptacion": "La colocación de mármol deberá ejecutarse conforme a las siguientes especificaciones técnicas obligatorias: Uso de llana dentada de 10 a 12 mm para la aplicación del adhesivo. El adhesivo deberá aplicarse de manera uniforme, garantizando contacto completo entre pieza y base. El adhesivo no deberá ser excesivo. El adhesivo no deberá utilizarse como medio para nivelar el firme. Estas condiciones son críticas para asegurar la correcta adherencia, evitar movimientos de piezas y prevenir fallas futuras en el recubrimiento.",
    "puntosAceptables": "Se utiliza llana dentada de 10 a 12 mm. La aplicación del adhesivo es uniforme. No existe exceso de material. El firme está previamente nivelado y el adhesivo se usa únicamente para adherencia. Se garantiza contacto completo entre pieza y base.",
    "puntosNoAceptables": "No se utiliza llana dentada o es distinta a la especificada. El adhesivo se aplica de forma irregular o discontinua. Se utiliza adhesivo en exceso. Se emplea adhesivo para nivelar el firme. Existen huecos o falta de contacto entre pieza y base.",
    "formaVerificacion": "Inspección directa durante la colocación. Confirmar uso de herramienta adecuada (llana dentada). Verificar uniformidad en la aplicación del adhesivo. Validar que no se utilice adhesivo para corregir desniveles del firme.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-PI-03.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-PI-03.jpg",
    "catalogKeywords": "Colocación de mármol conforme a especificación técnica"
  },
  {
    "clave": "AC-PI-04",
    "partida": "Pisos",
    "concepto": "Preparación de superficies para colocación de mármol",
    "criterioAceptacion": "La superficie base deberá prepararse previamente a la colocación de mármol conforme a las siguientes condiciones: En áreas húmedas (baños, regaderas): o Aplicar Sellotex en todo el firme previo a la instalación. En planta baja: o Aplicar Sellotex en escuadras perimetrales de 40 cm en contacto con muros. La preparación deberá ejecutarse de forma uniforme, cubriendo completamente las áreas indicadas, con el objetivo de evitar la aparición de salitre y humedad.",
    "puntosAceptables": "Se aplicó Sellotex en todas las áreas indicadas. La cobertura es uniforme y completa. Se respetan los 40 cm perimetrales en planta baja. La preparación se realizó antes de la colocación del mármol.",
    "puntosNoAceptables": "No se aplicó Sellotex en las áreas requeridas. La aplicación es parcial o incompleta. No se respetan los 40 cm perimetrales en planta baja. Se realizó la colocación sin preparación previa.",
    "formaVerificacion": "Inspección visual antes de la colocación del mármol. Confirmar aplicación de Sellotex en las áreas correspondientes. Verificar cobertura completa y uniforme del producto. Validar que la aplicación se realizó previo a la instalación del recubrimiento.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-PI-04.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-PI-04.jpg",
    "catalogKeywords": "Preparación de superficies para colocación de mármol"
  },
  {
    "clave": "AC-PI-05",
    "partida": "Pisos",
    "concepto": "Aplicación de boquilla en recubrimientos de mármol",
    "criterioAceptacion": "La aplicación de boquilla en recubrimientos de mármol deberá realizarse 48 horas después de la colocación, asegurando que el adhesivo haya alcanzado un fraguado adecuado. El tiempo de aplicación es crítico para garantizar la correcta adherencia y desempeño del sistema. Nota técnica: Si se aplica antes: puede haber movimiento de piezas por falta de fraguado del adhesivo. Si se aplica después: las juntas pueden contaminarse con polvo. Consecuencias de una mala aplicación: Mala adherencia de la boquilla. Filtración de humedad. Deterioro prematuro del recubrimiento.",
    "puntosAceptables": "La aplicación se realiza después de 48 horas. El adhesivo se encuentra completamente seco. Las piezas están firmes y sin movimiento. Las juntas están limpias previo a la aplicación. La boquilla presenta correcta adherencia y acabado uniforme.",
    "puntosNoAceptables": "La boquilla se aplica antes de 48 horas. El adhesivo no ha terminado de secar al momento de aplicar. Existen movimientos en las piezas al momento de la aplicación. Las juntas presentan polvo o suciedad previa a la aplicación. La boquilla no logra adherencia adecuada.",
    "formaVerificacion": "Confirmar tiempo transcurrido desde la colocación del mármol. Verificar que el adhesivo haya secado antes de la aplicación. Inspeccionar que las juntas se encuentren limpias previo a la aplicación. Supervisar correcta ejecución durante el proceso.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-PI-05.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-PI-05.jpg",
    "catalogKeywords": "Aplicación de boquilla en recubrimientos de mármol"
  },
  {
    "clave": "AC-IM-01",
    "partida": "Impermeabilización",
    "concepto": "Superficie preparada antes de impermeabilización",
    "criterioAceptacion": "La superficie deberá encontrarse limpia, seca y libre de polvo antes de aplicar sistema impermeabilizante.",
    "puntosAceptables": "La superficie está limpia y seca. No existen fisuras sin tratar. Está lista para aplicación.",
    "puntosNoAceptables": "Existen residuos o humedad excesiva. No se corrigieron fisuras previas. Se aplica sobre superficie sucia.",
    "formaVerificacion": "Inspección visual previa a la aplicación. Confirmar retiro de residuos y corrección de fisuras previas.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-IM-01.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-IM-01.jpg",
    "catalogKeywords": "Superficie preparada antes de impermeabilización"
  },
  {
    "clave": "AC-IM-02",
    "partida": "Impermeabilización",
    "concepto": "Traslapes y sellos correctamente ejecutados en impermeabilización",
    "criterioAceptacion": "La impermeabilización deberá ejecutarse mediante sistema de malla de refuerzo con aplicación de impermeabilizante líquido, garantizando continuidad, adherencia y sellado adecuado en toda la superficie. Se deberá cumplir con lo siguiente: La malla de refuerzo deberá colocarse continua, sin interrupciones. Los traslapes entre paños de malla deberán ser uniformes y suficientes para garantizar la continuidad del sistema. El impermeabilizante líquido deberá aplicarse cubriendo completamente la malla, sin dejar zonas expuestas. Se deberá asegurar correcto sellado en juntas, cambios de dirección, esquinas y encuentros con elementos verticales.",
    "puntosAceptables": "La malla es continua en toda la superficie. Los traslapes son uniformes y garantizan continuidad del sistema. La malla se encuentra completamente cubierta por el impermeabilizante. Los puntos críticos están correctamente sellados. El sistema presenta acabado uniforme y continuo.",
    "puntosNoAceptables": "La malla presenta discontinuidades o cortes sin tratamiento. Los traslapes son insuficientes o inexistentes. Existen zonas donde la malla queda expuesta. Se observan áreas sin sellado en puntos críticos. La aplicación del impermeabilizante es irregular o incompleta.",
    "formaVerificacion": "Inspección visual de continuidad en la malla. Verificar traslapes adecuados entre paños. Confirmar cobertura total del sistema líquido sobre la malla. Revisar sellos en puntos críticos (juntas, esquinas, bajantes, pretiles).",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-IM-02.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-IM-02.jpg",
    "catalogKeywords": "Traslapes y sellos correctamente ejecutados en impermeabilización"
  },
  {
    "clave": "AC-CA-01",
    "partida": "Cancelería",
    "concepto": "Marcos de cancelería alineados antes de fijación definitiva",
    "criterioAceptacion": "Los marcos deberán instalarse respetando alineación, nivel y escuadra antes de fijación final.",
    "puntosAceptables": "El marco está alineado. Se respeta nivel y escuadra. La fijación es correcta.",
    "puntosNoAceptables": "Existe desalineación visible. El marco no respeta escuadra. Se fija sin verificación previa.",
    "formaVerificacion": "Comprobar alineación y ajuste dentro del vano antes de sellar o fijar definitivamente.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-CA-01.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-CA-01.jpg",
    "catalogKeywords": "Marcos de cancelería alineados antes de fijación definitiva"
  },
  {
    "clave": "AC-CA-02",
    "partida": "Cancelería",
    "concepto": "Preinstalaciones verificadas antes de cerrar muros",
    "criterioAceptacion": "Todas las preinstalaciones hidráulicas y eléctricas deberán revisarse antes de cubrirse con aplanados o concreto.",
    "puntosAceptables": "Coinciden con proyecto. Están correctamente fijadas. Fueron verificadas antes del cierre.",
    "puntosNoAceptables": "Faltan elementos proyectados. Existen desplazamientos. No se realizó revisión previa.",
    "formaVerificacion": "Confirmar ubicación y fijación conforme a planos antes del cierre.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-CA-02.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-CA-02.jpg",
    "catalogKeywords": "Preinstalaciones verificadas antes de cerrar muros"
  },
  {
    "clave": "AC-CA-03",
    "partida": "Cancelería",
    "concepto": "Vano y elementos de cancelería conforme a especificación técnica",
    "criterioAceptacion": "Los vanos destinados a cancelería deberán cumplir con tolerancias dimensionales controladas, y los elementos instalados deberán incluir componentes necesarios para evitar filtraciones. Se deberá cumplir con lo siguiente: Tolerancia máxima de descuadre en vano: 1 cm Los canceles deberán incluir sardinel con altura mínima de 2.5 cm Estas condiciones son obligatorias para garantizar el correcto funcionamiento del sistema y evitar filtraciones de agua.",
    "puntosAceptables": "El vano cumple con la tolerancia máxima de 1 cm. El sardinel está presente y cumple con altura mínima de 2.5 cm. El sistema permite correcta instalación del cancel. No existen condiciones que comprometan la estanqueidad.",
    "puntosNoAceptables": "El vano presenta descuadre mayor a 1 cm. No existe sardinel o su altura es menor a 2.5 cm. El vano no permite correcta instalación del cancel. Se detectan condiciones que favorezcan filtraciones.",
    "formaVerificacion": "Medir escuadra y dimensiones del vano previo a instalación. Confirmar que el descuadre no exceda 1 cm. Verificar la existencia y dimensión del sardinel. Inspeccionar correcta integración del sistema antes de cierre o sellado final.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-CA-03.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-CA-03.jpg",
    "catalogKeywords": "Vano y elementos de cancelería conforme a especificación técnica"
  },
  {
    "clave": "AC-GE-01",
    "partida": "General",
    "concepto": "Limpieza del área previa a cada partida",
    "criterioAceptacion": "Cada partida deberá ejecutarse sobre área limpia y libre de residuos que comprometan calidad del trabajo siguiente.",
    "puntosAceptables": "El área está limpia. No hay interferencias. La superficie está preparada.",
    "puntosNoAceptables": "Existen residuos que afecten la ejecución. No se retiró material sobrante. Se inicia trabajo sobre superficie contaminada.",
    "formaVerificacion": "Inspección visual previa al inicio de cada actividad.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-GE-01.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-GE-01.jpg",
    "catalogKeywords": "Limpieza del área previa a cada partida"
  },
  {
    "clave": "AC-GE-02",
    "partida": "General",
    "concepto": "Evidencia fotográfica y registro documental realizado",
    "criterioAceptacion": "Cada etapa deberá documentarse mediante registro fotográfico y anotación en checklist antes de cerrar partida.",
    "puntosAceptables": "Existe registro completo. Se documentó antes de continuar y la partida quedó formalmente liberada.",
    "puntosNoAceptables": "No existe registro. No se documentó la verificación. La partida se cerró sin evidencia.",
    "formaVerificacion": "Confirmar existencia de evidencia y registro correspondiente.",
    "imagenCorrecto": "/quality-base/TR-AC-M01/AC-GE-02.jpg",
    "imagenIncorrecto": "/quality-base/TR-AC-M01/AC-GE-02.jpg",
    "catalogKeywords": "Evidencia fotográfica y registro documental realizado"
  }
];
const qualityPartidaAliases = { PL: "preliminares", EX: "excavacion", CI: "cimentacion", CO: "colado", ES: "estructura", LO: "losa", AL: "albanileria", IH: "hidraulicas", IE: "electricas", AP: "aplanados", PI: "pisos", IM: "impermeabilizante", CA: "canceleria", GE: "general" };
const qualityEmptyForm = { clave: "", partida: "", concepto: "", criterioAceptacion: "", puntosAceptables: "", puntosNoAceptables: "", imagenIncorrecto: "", imagenCorrecto: "", formaVerificacion: "", catalogKeywords: "", evidenceRequired: 1, stagePercent: 100, active: true };
function qualityPartidaIdFromSpec(spec = {}) {
  const codePrefix = String(spec.clave || spec.code || "").split("-")[1];
  if (qualityPartidaAliases[codePrefix]) return qualityPartidaAliases[codePrefix];
  const raw = cleanText(spec.partida || "");
  const slug = slugify(raw).replace(/-/g, "_");
  const map = { preliminares: "preliminares", excavacion: "excavacion", cimentacion: "cimentacion", colado: "colado", estructura: "estructura", losa: "losa", albanileria: "albanileria", albañileria: "albanileria", hidraulicas: "hidraulicas", instalaciones_hidraulicas: "hidraulicas", electricas: "electricas", instalaciones_electricas: "electricas", aplanados: "aplanados", pisos: "pisos", impermeabilizacion: "impermeabilizante", impermeabilizante: "impermeabilizante", canceleria: "canceleria", general: "general" };
  return map[slug] || slug || "general";
}
function normalizeQualitySpec(raw = {}, index = 0) {
  const clave = cleanText(raw.clave || raw.Clave || raw.Codigo || raw.Código || raw.code || `AC-GE-${String(index + 1).padStart(2, "0")}`);
  const partida = cleanText(raw.partida || raw.Partida || raw.PARTIDA || "General");
  const concepto = cleanText(raw.concepto || raw.Concepto || raw.Punto || raw["Punto de verificación"] || "Punto de calidad sin nombre");
  return {
    id: raw.id || slugify(`${clave}-${partida}-${concepto}`) || `quality-${index + 1}`,
    clave,
    code: clave,
    partida,
    partidaId: raw.partidaId || qualityPartidaIdFromSpec({ clave, partida }),
    concepto,
    label: concepto,
    criterioAceptacion: cleanText(raw.criterioAceptacion || raw["Criterio de aceptación"] || raw.criterio || raw.Criterio || ""),
    puntosAceptables: cleanText(raw.puntosAceptables || raw["Puntos aceptables"] || raw.aceptable || raw.Aceptable || ""),
    puntosNoAceptables: cleanText(raw.puntosNoAceptables || raw["Puntos no aceptables"] || raw.noAceptable || raw["No aceptable"] || ""),
    imagenIncorrecto: cleanText(raw.imagenIncorrecto || raw["Imagen incorrecto"] || raw["imagen incorrecto"] || ""),
    imagenCorrecto: cleanText(raw.imagenCorrecto || raw["Imagen correcto"] || raw["imagen correcto"] || ""),
    formaVerificacion: cleanText(raw.formaVerificacion || raw["Forma de verificación"] || raw.Verificación || raw.verificacion || ""),
    catalogKeywords: cleanText(raw.catalogKeywords || raw["Palabras catálogo"] || raw.keywords || concepto),
    evidenceRequired: Math.max(0, parseNumber(raw.evidenceRequired || raw["Fotos requeridas"] || 1)),
    stagePercent: Math.min(100, Math.max(0, parseNumber(raw.stagePercent || raw["Hito %"] || 100))),
    active: raw.active === false || raw.activo === "false" ? false : true,
  };
}
function rowsToQualitySpecs(rows, sourceFileName = "") {
  if (!rows.length) return [];
  const headers = rows[0].map((header) => cleanText(header));
  return rows.slice(1).map((row, index) => {
    const raw = {};
    headers.forEach((header, columnIndex) => { raw[header] = row[columnIndex] ?? ""; });
    return normalizeQualitySpec({ ...raw, sourceFileName, rowNumber: index + 2 }, index);
  }).filter((item) => item.clave && item.concepto);
}
function downloadQualitySpecTemplate() {
  const rows = [
    ["Clave", "Partida", "Concepto", "Criterio de aceptación", "Puntos aceptables", "Puntos no aceptables", "Imagen incorrecto", "Imagen correcto", "Forma de verificación", "Palabras catálogo", "Fotos requeridas", "Hito %"],
    ["AC-PL-01", "Preliminares", "El trazo coincide con planos autorizados", "El trazo corresponde a ubicación, ejes, dimensiones y alineaciones indicadas en planos.", "Dimensiones coinciden con plano; escuadra correcta; ejes alineados.", "Desviaciones dimensionales; escuadra incorrecta; ejes desalineados.", "", "", "Medir distancias, confirmar escuadra y comparar contra plano autorizado.", "trazo ejes desplante", "1", "100"],
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadTextFile("plantilla-checklist-calidad-triton.csv", csv);
}
const documentCategories = ["Planos del proyecto", "Renders", "Detalles de arquitectura", "Ingenierías", "Especificaciones", "Acabados", "Control de cambios", "Autorizaciones", "Minutas", "Garantías / manuales", "Otros"];
const documentScopes = ["Toda la obra", "Modelo específico", "Bloque específico", "Unidades específicas"];
const defaultDocBatchMeta = { category: "Planos del proyecto", version: "", scope: "Toda la obra", model: "", units: "", status: "vigente", authorizedBy: "", authorizationDate: "", description: "" };
const blockTypes = ["Bloque de obra", "Residente", "Frente de trabajo", "Etapa", "Torre / edificio", "Modelo", "Otro"];
const blockColors = ["#007aff", "#34c759", "#ff9500", "#af52de", "#ff3b30", "#5856d6", "#111827"];
const defaultBlockForm = { name: "", type: "Bloque de obra", responsible: "", units: "", color: "#007aff", notes: "", status: "activo" };
function splitUnits(value = "") { return String(value).split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean); }
function Field({ label, children }) { return <label style={{ display: "block", marginBottom: 12 }}><div style={{ fontSize: 13, fontWeight: 850, color: "#1d1d1f", marginBottom: 6 }}>{label}</div>{children}</label>; }
function Card({ title, subtitle, children }) { return <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 22, padding: 16, background: "rgba(255,255,255,0.92)", boxShadow: "0 8px 28px rgba(0,0,0,0.055)", marginBottom: 16 }}>{title ? <div style={{ fontSize: 18, fontWeight: 950, color: "#1d1d1f" }}>{title}</div> : null}{subtitle ? <div style={{ marginTop: 4, color: "#6e6e73", fontSize: 13, lineHeight: 1.45 }}>{subtitle}</div> : null}{children ? <div style={{ marginTop: title || subtitle ? 14 : 0 }}>{children}</div> : null}</div>; }
function Metric({ label, value, helper }) { return <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 20, padding: 15, background: "#fff" }}><div style={{ color: "#6e6e73", fontSize: 12, fontWeight: 800 }}>{label}</div><div style={{ color: "#1d1d1f", fontSize: 24, fontWeight: 950, marginTop: 4 }}>{value}</div>{helper ? <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{helper}</div> : null}</div>; }

export default function ObrasConfigWidget() {
  const [open, setOpen] = useState(false);
  const [obras, setObras] = useState([]);
  const [selectedObraId, setSelectedObraId] = useState(defaultObraId);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importInfo, setImportInfo] = useState(null);
  const [configForm, setConfigForm] = useState({ anticipoPorcentaje: 0, retencionPorcentaje: 0, multaDiaria: 0 });
  const [obraForm, setObraForm] = useState({ name: "", code: "", location: "", totalUnits: "", status: "activa" });
  const [catalogSearch, setCatalogSearch] = useState("");
  const [docBatchRows, setDocBatchRows] = useState([]);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [unitBlocks, setUnitBlocks] = useState([]);
  const [blockForm, setBlockForm] = useState(defaultBlockForm);
  const [qualitySpecs, setQualitySpecs] = useState([]);
  const [qualitySpecSearch, setQualitySpecSearch] = useState("");
  const [qualitySpecPartidaFilter, setQualitySpecPartidaFilter] = useState("todas");
  const [qualitySpecForm, setQualitySpecForm] = useState(qualityEmptyForm);
  const [importingQualitySpecs, setImportingQualitySpecs] = useState(false);

  const selectedObra = obras.find((obra) => obra.id === selectedObraId) || {};
  const catalogTotal = useMemo(() => catalog.reduce((acc, item) => acc + Number(item.importe || 0), 0), [catalog]);
  const partidasCount = useMemo(() => new Set(catalog.map((item) => item.partida)).size, [catalog]);
  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((item) => `${item.partida} ${item.clave} ${item.concepto} ${item.unidad} ${item.fechaEntrega || ""}`.toLowerCase().includes(q));
  }, [catalog, catalogSearch]);
  const qualitySpecPartidas = useMemo(() => Array.from(new Set(qualitySpecs.map((item) => item.partida).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es")), [qualitySpecs]);
  const filteredQualitySpecs = useMemo(() => {
    const q = qualitySpecSearch.trim().toLowerCase();
    return qualitySpecs.filter((item) => {
      const matchesPartida = qualitySpecPartidaFilter === "todas" || item.partida === qualitySpecPartidaFilter;
      const matchesSearch = !q || `${item.clave} ${item.partida} ${item.concepto} ${item.criterioAceptacion} ${item.catalogKeywords}`.toLowerCase().includes(q);
      return matchesPartida && matchesSearch;
    });
  }, [qualitySpecs, qualitySpecSearch, qualitySpecPartidaFilter]);
  const assignedUnits = useMemo(() => new Set(unitBlocks.flatMap((block) => Array.isArray(block.units) ? block.units : [])), [unitBlocks]);
  const blockUnitsPreview = useMemo(() => splitUnits(blockForm.units), [blockForm.units]);

  useEffect(() => { const handler = () => setOpen(true); window.addEventListener("triton-open-obras-config", handler); window.addEventListener("triton-module-obras", handler); return () => { window.removeEventListener("triton-open-obras-config", handler); window.removeEventListener("triton-module-obras", handler); }; }, []);
  useEffect(() => { if (!open) return; loadData(); }, [open, selectedObraId]);
  useEffect(() => { const estimationConfig = selectedObra.estimationConfig || {}; setConfigForm({ anticipoPorcentaje: estimationConfig.anticipoPorcentaje ?? 0, retencionPorcentaje: estimationConfig.retencionPorcentaje ?? 0, multaDiaria: estimationConfig.multaDiaria ?? 0 }); }, [selectedObraId, selectedObra.estimationConfig]);

  async function loadData() {
    const db = getDb();
    if (!db) return;
    setLoading(true);
    try {
      const obrasSnap = await getDocs(collection(db, "obras"));
      const nextObras = obrasSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
      setObras(nextObras);
      const activeObraId = selectedObraId || nextObras[0]?.id || "";
      if (activeObraId && activeObraId !== selectedObraId) setSelectedObraId(activeObraId);
      if (!activeObraId) { setCatalog([]); setUnitBlocks([]); return; }
      const catalogSnap = await getDocs(query(collection(db, "obras", activeObraId, "catalogoConceptos"), orderBy("partida", "asc")));
      setCatalog(catalogSnap.docs.map((item, index) => normalizeCatalogItem({ id: item.id, ...item.data() }, index)));
      const blocksSnap = await getDocs(query(collection(db, "obras", activeObraId, "unitBlocks"), orderBy("name", "asc")));
      setUnitBlocks(blocksSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
      const qualitySnap = await getDocs(query(collection(db, "obras", activeObraId, "qualitySpecs"), orderBy("partida", "asc")));
      setQualitySpecs(qualitySnap.docs.map((item, index) => normalizeQualitySpec({ id: item.id, ...item.data() }, index)));
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  }
  async function saveObra() {
    const db = getDb();
    if (!db) return;
    if (!obraForm.name.trim()) { alert("Agrega el nombre de la obra."); return; }
    const id = slugify(obraForm.code || obraForm.name);
    await setDoc(doc(db, "obras", id), { id, name: obraForm.name.trim(), code: obraForm.code.trim() || id, location: obraForm.location.trim(), totalUnits: Number(obraForm.totalUnits || 0), status: obraForm.status, estimationConfig: { anticipoPorcentaje: 0, retencionPorcentaje: 0, multaDiaria: 0 }, createdAt: serverTimestamp() }, { merge: true });
    setObraForm({ name: "", code: "", location: "", totalUnits: "", status: "activa" });
    setSelectedObraId(id);
    await loadData();
  }
  async function saveEstimationConfig() {
    const db = getDb();
    if (!db || !selectedObraId) return;
    await setDoc(doc(db, "obras", selectedObraId), { estimationConfig: { anticipoPorcentaje: parseNumber(configForm.anticipoPorcentaje), retencionPorcentaje: parseNumber(configForm.retencionPorcentaje), multaDiaria: parseNumber(configForm.multaDiaria) }, updatedAt: serverTimestamp() }, { merge: true });
    alert("Configuración de estimaciones guardada en la obra.");
    await loadData();
  }
  async function importCatalogFile(file) {
    const db = getDb();
    if (!db || !file || !selectedObraId) return;
    setImporting(true);
    try {
      const imported = rowsToCatalog(parseCsv(await file.text()), file.name);
      if (!imported.length) { alert("No pude leer conceptos válidos. Revisa columnas: PARTIDA, clave, descripcion, Unidades, unidad, P.U. y opcional Fecha Entrega."); return; }
      for (const concept of imported) await setDoc(doc(db, "obras", selectedObraId, "catalogoConceptos", concept.id), { ...concept, sourceFileName: file.name, importedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
      const total = imported.reduce((acc, item) => acc + Number(item.importe || 0), 0);
      setImportInfo({ rows: imported.length, total, partidas: Array.from(new Set(imported.map((item) => item.partida))).length, fileName: file.name });
      alert(`Catálogo importado en obra: ${imported.length} conceptos · ${money(total)} por unidad/casa.`);
      await loadData();
    } catch (error) { console.error(error); alert("Ocurrió un error al importar el catálogo."); }
    finally { setImporting(false); }
  }
  async function updateConceptFechaEntrega(concept, fechaEntrega) {
    const db = getDb();
    if (!db || !selectedObraId || !concept?.id) return;
    setCatalog((prev) => prev.map((item) => item.id === concept.id ? { ...item, fechaEntrega } : item));
    await setDoc(doc(db, "obras", selectedObraId, "catalogoConceptos", concept.id), { fechaEntrega, updatedAt: serverTimestamp() }, { merge: true });
  }

  async function saveQualitySpec() {
    const db = getDb();
    if (!db || !selectedObraId) return;
    const normalized = normalizeQualitySpec(qualitySpecForm, qualitySpecs.length);
    if (!normalized.clave || !normalized.concepto) { alert("Agrega clave y concepto de calidad."); return; }
    await setDoc(doc(db, "obras", selectedObraId, "qualitySpecs", normalized.id), { ...normalized, updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
    await setDoc(doc(db, "qualityConcepts", normalized.id), { ...normalized, lastProjectId: selectedObraId, updatedAt: serverTimestamp() }, { merge: true });
    setQualitySpecForm(qualityEmptyForm);
    await loadData();
  }
  function editQualitySpec(spec) { setQualitySpecForm({ ...qualityEmptyForm, ...spec }); }
  async function deleteQualitySpec(spec) {
    const db = getDb();
    if (!db || !selectedObraId || !spec?.id) return;
    if (!window.confirm(`¿Eliminar el punto de calidad ${spec.clave} de esta obra? Esta acción no borra la biblioteca general.`)) return;
    try {
      await deleteDoc(doc(db, "obras", selectedObraId, "qualitySpecs", spec.id));
      setQualitySpecs((prev) => prev.filter((item) => item.id !== spec.id));
      if (qualitySpecForm.id === spec.id) setQualitySpecForm(qualityEmptyForm);
    } catch (error) {
      console.error(error);
      alert("No se pudo eliminar el punto de calidad.");
    }
  }
  async function importQualitySpecFile(file) {
    const db = getDb();
    if (!db || !file || !selectedObraId) return;
    setImportingQualitySpecs(true);
    try {
      const imported = rowsToQualitySpecs(parseCsv(await file.text()), file.name);
      if (!imported.length) { alert("No pude leer puntos de calidad válidos. Revisa la plantilla."); return; }
      for (const spec of imported) {
        await setDoc(doc(db, "obras", selectedObraId, "qualitySpecs", spec.id), { ...spec, sourceFileName: file.name, importedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
        await setDoc(doc(db, "qualityConcepts", spec.id), { ...spec, lastProjectId: selectedObraId, sourceFileName: file.name, updatedAt: serverTimestamp() }, { merge: true });
      }
      alert(`${imported.length} puntos de calidad importados.`);
      await loadData();
    } catch (error) { console.error(error); alert("Ocurrió un error al importar el checklist de calidad."); }
    finally { setImportingQualitySpecs(false); }
  }
  async function seedManualQualitySpecs() {
    const db = getDb();
    if (!db || !selectedObraId) return;
    if (!window.confirm(`Se cargarán ${qualityManualSeed.length} puntos del manual TR-AC-M01 con imágenes de referencia como base de calidad. ¿Continuar?`)) return;
    try {
      for (const raw of qualityManualSeed) {
        const spec = normalizeQualitySpec(raw);
        await setDoc(doc(db, "obras", selectedObraId, "qualitySpecs", spec.id), { ...spec, sourceFileName: "TR-AC-M01", importedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
        await setDoc(doc(db, "qualityConcepts", spec.id), { ...spec, lastProjectId: selectedObraId, sourceFileName: "TR-AC-M01", updatedAt: serverTimestamp() }, { merge: true });
      }
      alert("Base inicial de calidad cargada desde TR-AC-M01 con imágenes de referencia.");
      await loadData();
    } catch (error) { console.error(error); alert("No se pudo cargar la base inicial del manual."); }
  }

  async function saveUnitBlock() {
    const db = getDb();
    if (!db || !selectedObraId) return;
    const name = cleanText(blockForm.name);
    const units = splitUnits(blockForm.units);
    if (!name) { alert("Agrega el nombre del bloque."); return; }
    if (!units.length) { alert("Agrega al menos una unidad al bloque."); return; }
    const id = slugify(`${name}-${blockForm.responsible || "bloque"}`) || `bloque-${Date.now()}`;
    await setDoc(doc(db, "obras", selectedObraId, "unitBlocks", id), {
      id,
      name,
      type: blockForm.type || "Bloque de obra",
      responsible: cleanText(blockForm.responsible || ""),
      units,
      color: blockForm.color || "#007aff",
      notes: cleanText(blockForm.notes || ""),
      status: blockForm.status || "activo",
      unitCount: units.length,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }, { merge: true });
    setBlockForm(defaultBlockForm);
    await loadData();
  }
  function editUnitBlock(block) {
    setBlockForm({
      name: block.name || "",
      type: block.type || "Bloque de obra",
      responsible: block.responsible || "",
      units: Array.isArray(block.units) ? block.units.join(", ") : "",
      color: block.color || "#007aff",
      notes: block.notes || "",
      status: block.status || "activo",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function handleTechnicalDocBatch(files) {
    const nextFiles = Array.from(files || []);
    if (!nextFiles.length) return;
    setDocBatchRows((prev) => [
      ...prev,
      ...nextFiles.map((file, index) => ({
        id: `${Date.now()}-${index}-${slugify(file.name)}`,
        file,
        title: file.name.replace(/\.[^.]+$/, ""),
        ...defaultDocBatchMeta,
      })),
    ]);
  }
  function updateDocBatchRow(id, patch) {
    setDocBatchRows((prev) => prev.map((row) => row.id === id ? { ...row, ...patch } : row));
  }
  function removeDocBatchRow(id) {
    setDocBatchRows((prev) => prev.filter((row) => row.id !== id));
  }
  function applyDocBatchMetaToAll(patch) {
    setDocBatchRows((prev) => prev.map((row) => ({ ...row, ...patch })));
  }
  async function saveTechnicalDocBatch() {
    const db = getDb();
    const storage = getStorageClient();
    if (!db || !storage || !selectedObraId) return;
    if (!docBatchRows.length) { alert("Selecciona archivos técnicos para cargar."); return; }
    const missingTitle = docBatchRows.find((row) => !String(row.title || "").trim());
    if (missingTitle) { alert("Todos los documentos deben tener nombre/título."); return; }
    setUploadingDocs(true);
    try {
      for (const row of docBatchRows) {
        const file = row.file;
        const safeName = `${Date.now()}-${slugify(row.title || file.name)}-${file.name}`;
        const storagePath = `obras/${selectedObraId}/documentos-tecnicos/${safeName}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        const documentId = `${Date.now()}-${slugify(row.title || file.name)}`;
        await setDoc(doc(db, "obras", selectedObraId, "technicalDocuments", documentId), {
          id: documentId,
          title: cleanText(row.title),
          category: row.category || "Otros",
          version: cleanText(row.version || ""),
          scope: row.scope || "Toda la obra",
          model: cleanText(row.model || ""),
          units: String(row.units || "").split(",").map((x) => x.trim()).filter(Boolean),
          status: row.status || "vigente",
          authorizedBy: cleanText(row.authorizedBy || ""),
          authorizationDate: row.authorizationDate || "",
          description: cleanText(row.description || ""),
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          storagePath,
          url,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      alert(`${docBatchRows.length} documentos técnicos cargados correctamente.`);
      setDocBatchRows([]);
    } catch (error) {
      console.error(error);
      alert("Ocurrió un error al cargar el lote de documentos técnicos.");
    } finally {
      setUploadingDocs(false);
    }
  }

  if (!open) return null;

  return <div className="triton-obras-config-module" style={{ position: "fixed", left: "var(--triton-shell-offset, 84px)", top: 0, right: 0, bottom: 0, zIndex: 2147483645, background: "#f5f5f7", overflow: "auto" }}>
    <style>{`@media (max-width: 900px) { .triton-obras-config-module { left: 0 !important; z-index: 2147483647 !important; } }`}</style>
    <div style={{ maxWidth: 1420, margin: "0 auto", padding: "calc(24px + env(safe-area-inset-top, 0px)) 18px 42px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap" }}><div><div style={{ fontSize: 34, fontWeight: 950, color: "#1d1d1f", letterSpacing: -0.7 }}>Obras</div><div style={{ color: "#6e6e73", fontSize: 16, marginTop: 6 }}>Alta de obra, catálogo de conceptos, Fecha Entrega y configuración económica para estimaciones.</div></div><button type="button" onClick={() => setOpen(false)} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>Volver</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <Card title="Obras actuales" subtitle="Selecciona la obra que vas a configurar."><Field label="Obra"><select value={selectedObraId} onChange={(e) => setSelectedObraId(e.target.value)} style={inputBase}>{obras.length ? obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.name || obra.id} · {obra.status || "sin estatus"}</option>) : <option value="">Sin obras cargadas</option>}</select></Field>{selectedObra ? <div style={{ padding: 12, borderRadius: 16, background: "#fff", border: "1px solid rgba(60,60,67,0.12)" }}><div style={{ fontWeight: 950 }}>{selectedObra.name || selectedObra.id}</div><div style={{ color: "#6e6e73", fontSize: 13, marginTop: 4 }}>{selectedObra.location || "Sin ubicación"}</div></div> : null}</Card>
        <Card title="Alta rápida de obra" subtitle="Crea una obra base para después cargar catálogo."><Field label="Nombre"><input value={obraForm.name} onChange={(e) => setObraForm((prev) => ({ ...prev, name: e.target.value }))} style={inputBase} /></Field><Field label="Código"><input value={obraForm.code} onChange={(e) => setObraForm((prev) => ({ ...prev, code: e.target.value }))} style={inputBase} /></Field><Field label="Ubicación"><input value={obraForm.location} onChange={(e) => setObraForm((prev) => ({ ...prev, location: e.target.value }))} style={inputBase} /></Field><Field label="Unidades"><input type="number" value={obraForm.totalUnits} onChange={(e) => setObraForm((prev) => ({ ...prev, totalUnits: e.target.value }))} style={inputBase} /></Field><button type="button" onClick={saveObra} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Guardar obra</button></Card>
        <Card title="Configuración económica" subtitle="Estos datos se consumen en Estimaciones de forma informativa y para cálculo de neto."><Field label="Anticipo a amortizar (%)"><input type="number" value={configForm.anticipoPorcentaje} onChange={(e) => setConfigForm((prev) => ({ ...prev, anticipoPorcentaje: e.target.value }))} style={inputBase} /></Field><Field label="Retención (%)"><input type="number" value={configForm.retencionPorcentaje} onChange={(e) => setConfigForm((prev) => ({ ...prev, retencionPorcentaje: e.target.value }))} style={inputBase} /></Field><Field label="Multa diaria"><input type="number" value={configForm.multaDiaria} onChange={(e) => setConfigForm((prev) => ({ ...prev, multaDiaria: e.target.value }))} style={inputBase} /></Field><button type="button" onClick={saveEstimationConfig} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Guardar configuración</button></Card>
      </div>
      <Card title="Catálogo de conceptos" subtitle="Carga el CSV desde alta/configuración de obra. Columnas esperadas: PARTIDA, clave, descripcion, Unidades, unidad, P.U. Opcional: Fecha Entrega.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}><Metric label="Conceptos" value={catalog.length} helper={loading ? "Cargando..." : "cargados"} /><Metric label="Partidas" value={partidasCount} /><Metric label="Total por unidad/casa" value={money(catalogTotal)} /></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <button type="button" onClick={downloadCatalogTemplate} style={{ ...buttonBase, background: "#fff", color: "#007aff" }}>Descargar plantilla CSV</button>
          <div style={{ color: "#6e6e73", fontSize: 13 }}>Usa la plantilla para evitar errores de columnas al subir el catálogo.</div>
        </div>
        <input type="file" accept=".csv,text/csv" disabled={importing} onChange={(e) => importCatalogFile(e.target.files?.[0])} style={inputBase} />
        {importInfo ? <div style={{ marginTop: 10, color: "#157347", fontWeight: 850 }}>Última carga: {importInfo.rows} conceptos · {importInfo.partidas} partidas · {money(importInfo.total)}</div> : null}
      </Card>
      <Card title="Bloques de unidades / responsables" subtitle="Configura grupos de unidades para residentes, frentes de trabajo, etapas o bloques. Sirve para filtrar calidad, estimaciones, documentos y seguimiento por responsable.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <Field label="Nombre del bloque"><input value={blockForm.name} onChange={(e) => setBlockForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Ej. Townhouses norte / Residente Juan" style={inputBase} /></Field>
          <Field label="Tipo"><select value={blockForm.type} onChange={(e) => setBlockForm((prev) => ({ ...prev, type: e.target.value }))} style={inputBase}>{blockTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field>
          <Field label="Responsable / residente"><input value={blockForm.responsible} onChange={(e) => setBlockForm((prev) => ({ ...prev, responsible: e.target.value }))} placeholder="Nombre del responsable" style={inputBase} /></Field>
          <Field label="Estatus"><select value={blockForm.status} onChange={(e) => setBlockForm((prev) => ({ ...prev, status: e.target.value }))} style={inputBase}><option value="activo">Activo</option><option value="pausado">Pausado</option><option value="cerrado">Cerrado</option></select></Field>
        </div>
        <Field label="Unidades del bloque"><textarea value={blockForm.units} onChange={(e) => setBlockForm((prev) => ({ ...prev, units: e.target.value }))} rows={3} placeholder="Ej. TH01, TH02, TH03 o una unidad por línea" style={{ ...inputBase, resize: "vertical", lineHeight: 1.45 }} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <Field label="Color"><select value={blockForm.color} onChange={(e) => setBlockForm((prev) => ({ ...prev, color: e.target.value }))} style={inputBase}>{blockColors.map((color) => <option key={color} value={color}>{color}</option>)}</select></Field>
          <Field label="Notas"><input value={blockForm.notes} onChange={(e) => setBlockForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Notas internas del bloque" style={inputBase} /></Field>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <button type="button" onClick={saveUnitBlock} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Guardar bloque</button>
          <button type="button" onClick={() => setBlockForm(defaultBlockForm)} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>Limpiar formulario</button>
          <div style={{ color: "#6e6e73", fontSize: 13 }}>{blockUnitsPreview.length} unidades en el formulario · {assignedUnits.size} unidades asignadas en bloques</div>
        </div>
        {unitBlocks.length ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          {unitBlocks.map((block) => <div key={block.id} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, padding: 14, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
              <div><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 99, background: block.color || "#007aff", display: "inline-block" }} /><strong>{block.name}</strong></div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 4 }}>{block.type || "Bloque"} · {block.status || "activo"}</div></div>
              <button type="button" onClick={() => editUnitBlock(block)} style={{ ...buttonBase, background: "#fff", color: "#007aff", padding: "8px 10px" }}>Editar</button>
            </div>
            <div style={{ marginTop: 10, color: "#1d1d1f", fontSize: 13 }}><strong>Responsable:</strong> {block.responsible || "Sin responsable"}</div>
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>{(Array.isArray(block.units) ? block.units : []).slice(0, 18).map((unit) => <span key={unit} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 999, padding: "4px 8px", fontSize: 12, background: "rgba(242,242,247,0.82)" }}>{unit}</span>)}{Array.isArray(block.units) && block.units.length > 18 ? <span style={{ color: "#6e6e73", fontSize: 12 }}>+{block.units.length - 18} más</span> : null}</div>
            {block.notes ? <div style={{ marginTop: 8, color: "#6e6e73", fontSize: 12 }}>{block.notes}</div> : null}
          </div>)}
        </div> : <div style={{ padding: 14, borderRadius: 16, background: "rgba(242,242,247,0.82)", color: "#6e6e73", fontSize: 13 }}>Todavía no hay bloques configurados para esta obra.</div>}
      </Card>
      <Card title="Checklist de calidad por obra" subtitle="Define los puntos técnicos que aplican a esta obra. Puedes subirlos por CSV, cargarlos del manual TR-AC-M01 con imágenes de referencia o capturarlos uno por uno. Estos puntos alimentan la vista de Calidad y se vinculan por partida/concepto.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 12 }}>
          <Metric label="Puntos de calidad" value={qualitySpecs.length} helper="configurados en esta obra" />
          <Metric label="Partidas" value={new Set(qualitySpecs.map((item) => item.partida)).size} />
          <Metric label="Activos" value={qualitySpecs.filter((item) => item.active !== false).length} />
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <button type="button" onClick={downloadQualitySpecTemplate} style={{ ...buttonBase, background: "#fff", color: "#007aff" }}>Descargar plantilla checklist</button>
          <button type="button" onClick={seedManualQualitySpecs} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Cargar base TR-AC-M01 con imágenes</button>
          <label style={{ ...buttonBase, background: importingQualitySpecs ? "#e5e5ea" : "#fff", color: importingQualitySpecs ? "#8e8e93" : "#007aff" }}>
            {importingQualitySpecs ? "Importando..." : "Subir CSV de calidad"}
            <input type="file" accept=".csv,text/csv" disabled={importingQualitySpecs} onChange={(e) => importQualitySpecFile(e.target.files?.[0])} style={{ display: "none" }} />
          </label>
        </div>
        <div style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, padding: 14, background: "#fff", marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 950, marginBottom: 10 }}>{qualitySpecForm.id ? "Editar punto de calidad" : "Capturar punto de calidad"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
            <Field label="Clave"><input value={qualitySpecForm.clave} onChange={(e) => setQualitySpecForm((prev) => ({ ...prev, clave: e.target.value }))} placeholder="AC-PL-01" style={inputBase} /></Field>
            <Field label="Partida"><input value={qualitySpecForm.partida} onChange={(e) => setQualitySpecForm((prev) => ({ ...prev, partida: e.target.value }))} placeholder="Preliminares" style={inputBase} /></Field>
            <Field label="Concepto"><input value={qualitySpecForm.concepto} onChange={(e) => setQualitySpecForm((prev) => ({ ...prev, concepto: e.target.value }))} placeholder="Punto de verificación" style={inputBase} /></Field>
            <Field label="Palabras catálogo"><input value={qualitySpecForm.catalogKeywords} onChange={(e) => setQualitySpecForm((prev) => ({ ...prev, catalogKeywords: e.target.value }))} placeholder="trazo, ejes, desplante" style={inputBase} /></Field>
          </div>
          <Field label="Criterio de aceptación"><textarea value={qualitySpecForm.criterioAceptacion} onChange={(e) => setQualitySpecForm((prev) => ({ ...prev, criterioAceptacion: e.target.value }))} rows={2} style={{ ...inputBase, resize: "vertical" }} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
            <Field label="Puntos aceptables"><textarea value={qualitySpecForm.puntosAceptables} onChange={(e) => setQualitySpecForm((prev) => ({ ...prev, puntosAceptables: e.target.value }))} rows={2} style={{ ...inputBase, resize: "vertical" }} /></Field>
            <Field label="Puntos no aceptables"><textarea value={qualitySpecForm.puntosNoAceptables} onChange={(e) => setQualitySpecForm((prev) => ({ ...prev, puntosNoAceptables: e.target.value }))} rows={2} style={{ ...inputBase, resize: "vertical" }} /></Field>
          </div>
          <Field label="Forma de verificación"><textarea value={qualitySpecForm.formaVerificacion} onChange={(e) => setQualitySpecForm((prev) => ({ ...prev, formaVerificacion: e.target.value }))} rows={2} style={{ ...inputBase, resize: "vertical" }} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
            <Field label="Imagen incorrecto (URL)"><input value={qualitySpecForm.imagenIncorrecto} onChange={(e) => setQualitySpecForm((prev) => ({ ...prev, imagenIncorrecto: e.target.value }))} placeholder="https://..." style={inputBase} /></Field>
            <Field label="Imagen correcto (URL)"><input value={qualitySpecForm.imagenCorrecto} onChange={(e) => setQualitySpecForm((prev) => ({ ...prev, imagenCorrecto: e.target.value }))} placeholder="https://..." style={inputBase} /></Field>
            <Field label="Fotos requeridas"><input type="number" min="0" value={qualitySpecForm.evidenceRequired} onChange={(e) => setQualitySpecForm((prev) => ({ ...prev, evidenceRequired: e.target.value }))} style={inputBase} /></Field>
            <Field label="Hito %"><input type="number" min="0" max="100" value={qualitySpecForm.stagePercent} onChange={(e) => setQualitySpecForm((prev) => ({ ...prev, stagePercent: e.target.value }))} style={inputBase} /></Field>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={saveQualitySpec} style={{ ...buttonBase, background: "#111827", color: "#fff" }}>Guardar punto</button>
            <button type="button" onClick={() => setQualitySpecForm(qualityEmptyForm)} style={{ ...buttonBase, background: "#fff", color: "#1d1d1f" }}>Limpiar</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) minmax(220px, 320px)", gap: 10, alignItems: "end", marginBottom: 12 }}>
          <Field label="Buscar punto de calidad">
            <input value={qualitySpecSearch} onChange={(e) => setQualitySpecSearch(e.target.value)} placeholder="Clave, concepto, criterio o palabra catálogo" style={inputBase} />
          </Field>
          <Field label="Filtrar por partida">
            <select value={qualitySpecPartidaFilter} onChange={(e) => setQualitySpecPartidaFilter(e.target.value)} style={inputBase}>
              <option value="todas">Todas las partidas</option>
              {qualitySpecPartidas.map((partida) => <option key={partida} value={partida}>{partida}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ marginBottom: 10, color: "#6e6e73", fontSize: 12, fontWeight: 800 }}>Mostrando {filteredQualitySpecs.length} de {qualitySpecs.length} puntos configurados.</div>
        <div style={{ display: "grid", gap: 10 }}>
          {filteredQualitySpecs.slice(0, 120).map((spec) => <div key={spec.id} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 16, padding: 12, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div><div style={{ fontWeight: 950 }}>{spec.clave} · {spec.concepto}</div><div style={{ color: "#6e6e73", fontSize: 12, marginTop: 3 }}>{spec.partida} · Hito {spec.stagePercent || 100}% · {spec.evidenceRequired || 0} foto(s) requeridas</div></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => editQualitySpec(spec)} style={{ ...buttonBase, background: "#fff", color: "#007aff", padding: "8px 10px" }}>Editar</button>
                <button type="button" onClick={() => deleteQualitySpec(spec)} style={{ ...buttonBase, background: "#fff", color: "#ff3b30", padding: "8px 10px" }}>Eliminar</button>
              </div>
            </div>
            {spec.criterioAceptacion ? <div style={{ marginTop: 8, color: "#1d1d1f", fontSize: 13 }}><strong>Criterio:</strong> {spec.criterioAceptacion}</div> : null}
          </div>)}
          {!filteredQualitySpecs.length ? <div style={{ padding: 14, borderRadius: 16, background: "rgba(242,242,247,0.82)", color: "#6e6e73", fontSize: 13 }}>Todavía no hay puntos de calidad configurados.</div> : null}
        </div>
      </Card>
      <Card title="Documentos técnicos por lote" subtitle="Selecciona varios archivos a la vez y luego captura o ajusta sus datos antes de subirlos a la obra.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 12 }}>
          <Field label="Categoría para aplicar a todos"><select value={defaultDocBatchMeta.category} onChange={(e) => applyDocBatchMetaToAll({ category: e.target.value })} style={inputBase}>{documentCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></Field>
          <Field label="Estatus para aplicar a todos"><select value={defaultDocBatchMeta.status} onChange={(e) => applyDocBatchMetaToAll({ status: e.target.value })} style={inputBase}><option value="vigente">Vigente</option><option value="en_revision">En revisión</option><option value="autorizado">Autorizado</option><option value="sustituido">Sustituido</option></select></Field>
          <Field label="Alcance para aplicar a todos"><select value={defaultDocBatchMeta.scope} onChange={(e) => applyDocBatchMetaToAll({ scope: e.target.value })} style={inputBase}>{documentScopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}</select></Field>
        </div>
        <input type="file" multiple onChange={(e) => handleTechnicalDocBatch(e.target.files)} style={inputBase} />
        {docBatchRows.length ? <div style={{ marginTop: 14, border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, overflow: "hidden", background: "#fff" }}>
          <div style={{ padding: 12, background: "rgba(242,242,247,0.96)", fontSize: 13, fontWeight: 950, color: "#1d1d1f" }}>{docBatchRows.length} archivos listos para clasificar</div>
          <div style={{ display: "grid", gap: 10, padding: 12 }}>
            {docBatchRows.map((row) => <div key={row.id} style={{ border: "1px solid rgba(60,60,67,0.12)", borderRadius: 16, padding: 12, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}><div><div style={{ fontWeight: 950 }}>{row.file.name}</div><div style={{ color: "#6e6e73", fontSize: 12 }}>{Math.round((row.file.size || 0) / 1024)} KB · {row.file.type || "archivo"}</div></div><button type="button" onClick={() => removeDocBatchRow(row.id)} style={{ ...buttonBase, background: "#fff", color: "#ff3b30" }}>Quitar</button></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <Field label="Nombre"><input value={row.title} onChange={(e) => updateDocBatchRow(row.id, { title: e.target.value })} style={inputBase} /></Field>
                <Field label="Categoría"><select value={row.category} onChange={(e) => updateDocBatchRow(row.id, { category: e.target.value })} style={inputBase}>{documentCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></Field>
                <Field label="Versión"><input value={row.version} onChange={(e) => updateDocBatchRow(row.id, { version: e.target.value })} placeholder="V1, Rev. 02" style={inputBase} /></Field>
                <Field label="Estatus"><select value={row.status} onChange={(e) => updateDocBatchRow(row.id, { status: e.target.value })} style={inputBase}><option value="vigente">Vigente</option><option value="en_revision">En revisión</option><option value="autorizado">Autorizado</option><option value="sustituido">Sustituido</option></select></Field>
                <Field label="Alcance"><select value={row.scope} onChange={(e) => updateDocBatchRow(row.id, { scope: e.target.value })} style={inputBase}>{documentScopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}</select></Field>
                <Field label="Unidades"><input value={row.units} onChange={(e) => updateDocBatchRow(row.id, { units: e.target.value })} placeholder="TH01, TH02" style={inputBase} /></Field>
                <Field label="Autorizó"><input value={row.authorizedBy} onChange={(e) => updateDocBatchRow(row.id, { authorizedBy: e.target.value })} style={inputBase} /></Field>
                <Field label="Fecha autorización"><input type="date" value={row.authorizationDate} onChange={(e) => updateDocBatchRow(row.id, { authorizationDate: e.target.value })} style={inputBase} /></Field>
              </div>
              <Field label="Descripción / nota"><textarea value={row.description} onChange={(e) => updateDocBatchRow(row.id, { description: e.target.value })} rows={2} style={{ ...inputBase, resize: "vertical" }} /></Field>
            </div>)}
          </div>
        </div> : <div style={{ marginTop: 10, color: "#6e6e73", fontSize: 13 }}>Todavía no hay archivos seleccionados.</div>}
        <button type="button" onClick={saveTechnicalDocBatch} disabled={uploadingDocs || !docBatchRows.length} style={{ ...buttonBase, marginTop: 12, background: uploadingDocs || !docBatchRows.length ? "#e5e5ea" : "#111827", color: uploadingDocs || !docBatchRows.length ? "#8e8e93" : "#fff" }}>{uploadingDocs ? "Subiendo lote..." : "Guardar lote de documentos"}</button>
      </Card>
      <Card title="Vista previa del catálogo" subtitle="Aquí puedes definir o ajustar Fecha Entrega por concepto. Después se podrá especializar por casa para multas automáticas.">
        <input value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)} placeholder="Buscar por partida, clave, concepto o fecha" style={{ ...inputBase, marginBottom: 12 }} />
        <div style={{ overflowX: "auto", border: "1px solid rgba(60,60,67,0.12)", borderRadius: 18, background: "#fff" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}><thead><tr><th style={th}>Partida</th><th style={th}>Clave</th><th style={th}>Concepto</th><th style={th}>Unidad</th><th style={th}>Unidades</th><th style={th}>P.U.</th><th style={th}>Total</th><th style={th}>Fecha Entrega</th></tr></thead><tbody>{filteredCatalog.slice(0, 250).map((item) => <tr key={item.id}><td style={td}>{item.partida}</td><td style={td}>{item.clave}</td><td style={{ ...td, minWidth: 300 }}>{item.concepto}</td><td style={td}>{item.unidad}</td><td style={td}>{item.cantidad}</td><td style={td}>{money(item.precioUnitario)}</td><td style={td}>{money(item.importe)}</td><td style={td}><input type="date" value={item.fechaEntrega || ""} onChange={(e) => updateConceptFechaEntrega(item, e.target.value)} style={{ ...inputBase, minWidth: 150 }} /></td></tr>)}</tbody></table></div>
        {filteredCatalog.length > 250 ? <div style={{ marginTop: 10, color: "#6e6e73", fontSize: 13 }}>Mostrando 250 de {filteredCatalog.length} conceptos. Usa el buscador para filtrar.</div> : null}
      </Card>
    </div>
  </div>;
}
