const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src', 'EstimacionesWidget.jsx');
if (!fs.existsSync(file)) {
  console.error('No encuentro src/EstimacionesWidget.jsx. Ejecuta este script desde la raíz del proyecto app.');
  process.exit(1);
}

let s = fs.readFileSync(file, 'utf8');
const original = s;

function replaceOnce(search, replacement, label) {
  if (!s.includes(search)) {
    console.warn(`No encontré bloque para: ${label}`);
    return;
  }
  s = s.replace(search, replacement);
  console.log(`OK: ${label}`);
}

function replaceAll(search, replacement, label) {
  const count = s.split(search).length - 1;
  if (!count) {
    console.warn(`No encontré bloque para: ${label}`);
    return;
  }
  s = s.split(search).join(replacement);
  console.log(`OK: ${label} (${count})`);
}

// 1) Captura: permitir filtro de pendientes y ocultar lo ya 100% estimado/aprobado.
replaceOnce(
`    const q = filters.captura.trim().toLowerCase();\n    const partidaFilter = filters.partida;`,
`    const q = filters.captura.trim().toLowerCase();\n    const partidaFilter = filters.partida;\n    const captureOnlyPending = filters.status === "pendientes";`,
'captura: estado de filtro pendientes'
);

replaceOnce(
`          <FilterBar search={filters.captura} setSearch={(value) => setFilters((prev) => ({ ...prev, captura: value }))} partida={filters.partida} setPartida={(value) => setFilters((prev) => ({ ...prev, partida: value }))} partidas={partidas} showPartida />`,
`          <FilterBar search={filters.captura} setSearch={(value) => setFilters((prev) => ({ ...prev, captura: value }))} partida={filters.partida} setPartida={(value) => setFilters((prev) => ({ ...prev, partida: value }))} partidas={partidas} showPartida />\n          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>\n            <button type="button" onClick={() => setFilters((prev) => ({ ...prev, status: "pendientes" }))} style={{ ...buttonBase, background: captureOnlyPending ? "#111827" : "#fff", color: captureOnlyPending ? "#fff" : "#1d1d1f" }}>Solo pendientes por estimar</button>\n            <button type="button" onClick={() => setFilters((prev) => ({ ...prev, status: "todos" }))} style={{ ...buttonBase, background: !captureOnlyPending ? "#111827" : "#fff", color: !captureOnlyPending ? "#fff" : "#1d1d1f" }}>Ver todo</button>\n          </div>`,
'captura: botones filtro pendientes/todo'
);

replaceOnce(
`            const concepts = (catalogByPartida[partida] || []).filter((concept) => !q || \`${'${concept.partida} ${concept.clave} ${concept.concepto} ${concept.unidad}'}\`.toLowerCase().includes(q));`,
`            const concepts = (catalogByPartida[partida] || []).filter((concept) => {\n              const available = availableFor(concept);\n              if (captureOnlyPending && available <= 0) return false;\n              return !q || \`${'${concept.partida} ${concept.clave} ${concept.concepto} ${concept.unidad}'}\`.toLowerCase().includes(q);\n            });`,
'captura: filtrar conceptos sin disponible'
);

// 2) Captura: botones 50/100 e input deshabilitados si ya está 100% estimado/aprobado. Tonos según estado.
replaceOnce(
`                                <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 210 }}>\n                                  <button type="button" onClick={() => setDraftPercent(concept.id, Math.min(50, available))} style={{ ...buttonBase, padding: "7px 10px", background: "#f5f5f7" }}>50%</button>\n                                  <button type="button" onClick={() => setDraftPercent(concept.id, available)} style={{ ...buttonBase, padding: "7px 10px", background: "#f5f5f7" }}>100%</button>\n                                  <input type="text" inputMode="decimal" value={draftRows[concept.id]?.percent || ""} onChange={(event) => updateDraft(concept.id, { percent: event.target.value })} onWheel={(event) => event.currentTarget.blur()} style={{ ...inputBase, width: 74, minHeight: 36 }} />\n                                </div>`,
`                                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>\n                                  <button type="button" disabled={available <= 0} onClick={() => setDraftPercent(concept.id, Math.min(50, available))} style={{ ...buttonBase, padding: "7px 10px", background: available <= 0 ? "#f4f4f5" : draftPercent(concept) >= 50 ? "#dbeafe" : "#fff", color: available <= 0 ? "#a1a1aa" : "#1d1d1f", cursor: available <= 0 ? "not-allowed" : "pointer" }}>50%</button>\n                                  <button type="button" disabled={available <= 0} onClick={() => setDraftPercent(concept.id, available)} style={{ ...buttonBase, padding: "7px 10px", background: available <= 0 ? "#f4f4f5" : draftPercent(concept) >= available ? "#dcfce7" : "#fff", color: available <= 0 ? "#a1a1aa" : "#1d1d1f", cursor: available <= 0 ? "not-allowed" : "pointer" }}>100%</button>\n                                  <input type="text" inputMode="decimal" disabled={available <= 0} value={draftRows[concept.id]?.percent || ""} placeholder={available <= 0 ? "100%" : "Manual"} onChange={(event) => updateDraft(concept.id, { percent: event.target.value })} onWheel={(event) => event.currentTarget.blur()} style={{ ...inputBase, width: 86, minHeight: 36, background: available <= 0 ? "#f4f4f5" : "#fff", color: available <= 0 ? "#a1a1aa" : "#1d1d1f" }} />\n                                </div>`,
'captura: botones 50/100 e input manual protegidos'
);

// 3) Barra flotante de total de captura.
replaceOnce(
`          })}\n        </Card>\n      </>`,
`          })}\n        </Card>\n        <div style={{ position: "sticky", bottom: 16, zIndex: 20, margin: "18px auto 0", maxWidth: 980, padding: "12px 14px", borderRadius: 22, background: "rgba(255,255,255,0.84)", border: "1px solid rgba(60,60,67,0.14)", boxShadow: "0 18px 45px rgba(0,0,0,0.14)", WebkitBackdropFilter: "blur(18px) saturate(180%)", backdropFilter: "blur(18px) saturate(180%)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>\n          <div>\n            <strong>{selectedHouse?.name || selectedHouseId || "Casa sin seleccionar"}</strong>\n            <div style={{ color: "#6e6e73", fontSize: 12 }}>{draftSummary.count} concepto(s) capturado(s) · Bruto {money(draftSummary.subtotal)}</div>\n          </div>\n          <div style={{ textAlign: "right" }}>\n            <div style={{ color: "#6e6e73", fontSize: 12 }}>Neto estimado</div>\n            <div style={{ fontSize: 24, fontWeight: 950 }}>{money(draftSummary.neto)}</div>\n          </div>\n        </div>\n      </>`,
'captura: barra flotante de total'
);

// 4) Supervisión: no permite terminar revisión si quedan conceptos pendientes.
replaceOnce(
`    if (pendingRows.length > 0) {\n      const proceed = window.confirm(\`Quedan ${'${pendingRows.length}'} concepto(s) sin revisar. ¿Quieres terminar la revisión de todos modos?\`);\n      if (!proceed) return;\n    }`,
`    if (pendingRows.length > 0) {\n      alert(\`No puedes terminar la revisión del lote. Faltan ${'${pendingRows.length}'} concepto(s) por aprobar u observar.\`);\n      return;\n    }`,
'revisión: cierre obligatorio completo'
);

// 5) Supervisión: checkboxes editables también para corregir decisión antes de terminar.
replaceOnce(
`<td style={td}><input type="checkbox" checked={selected} disabled={row.status !== "en_aprobacion"} onChange={(event) => setSelectedReviewRowIds((prev) => ({ ...prev, [houseId]: event.target.checked ? [...(prev[houseId] || []), id] : (prev[houseId] || []).filter((item) => item !== id) }))} /></td>`,
`<td style={td}><input type="checkbox" checked={selected} onChange={(event) => setSelectedReviewRowIds((prev) => ({ ...prev, [houseId]: event.target.checked ? [...(prev[houseId] || []), id] : (prev[houseId] || []).filter((item) => item !== id) }))} /></td>`,
'revisión: permitir modificar decisión seleccionando de nuevo'
);

replaceOnce(
`<thead><tr><th style={th}>Sel.</th><th style={th}>Partida</th><th style={th}>Clave</th><th style={th}>Concepto</th><th style={th}>Casa</th><th style={th}>%</th><th style={th}>Importe</th><th style={th}>Comentario</th><th style={th}>Observación</th></tr></thead>`,
`<thead><tr><th style={th}>Sel.</th><th style={th}>Estatus</th><th style={th}>Partida</th><th style={th}>Clave</th><th style={th}>Concepto</th><th style={th}>Casa</th><th style={th}>%</th><th style={th}>Importe</th><th style={th}>Comentario</th><th style={th}>Observación</th></tr></thead>`,
'revisión: columna estatus'
);

replaceOnce(
`                        <td style={td}>{row.partida}</td>`,
`                        <td style={td}><span style={statusStyle(row.status)}>{rowStatusLabel[row.status] || row.status}</span></td>\n                        <td style={td}>{row.partida}</td>`,
'revisión: celda estatus'
);

// 6) Borradores: observadas primero y más fácil editarlas.
replaceOnce(
`        {Object.entries(lot.houses || {}).map(([houseId, house]) => (`,
`        {Object.entries(lot.houses || {}).sort(([, a], [, b]) => Number((b.rows || []).some((row) => row.status === "observada_supervision")) - Number((a.rows || []).some((row) => row.status === "observada_supervision"))).map(([houseId, house]) => (`,
'borradores: casas con observaciones arriba'
);

replaceOnce(
`{Object.entries(groupByPartida(house.rows || [])).map(([partida, rows]) => (`,
`{Object.entries(groupByPartida((house.rows || []).slice().sort((a, b) => Number(b.status === "observada_supervision") - Number(a.status === "observada_supervision")))).map(([partida, rows]) => (`,
'borradores: partidas/filas observadas arriba'
);

replaceOnce(
`<Card key={houseId} title={house.houseName || houseId} subtitle={\`Estatus casa: ${'${statusLabel[house.status] || house.status || lot.status}'}\`}>`,
`<Card key={houseId} title={house.houseName || houseId} subtitle={\`Estatus casa: ${'${statusLabel[house.status] || house.status || lot.status}'}\`}>\n            {(house.rows || []).some((row) => row.status === "observada_supervision") ? (\n              <div style={{ padding: 12, borderRadius: 16, background: "#fff3cd", color: "#7a4d00", marginBottom: 12, border: "1px solid rgba(154,103,0,0.20)" }}>\n                <strong>Observaciones por corregir en esta casa</strong>\n                <div style={{ fontSize: 12, marginTop: 4 }}>Las partidas observadas aparecen primero. Ajusta el porcentaje o escribe respuesta y se marcarán como borrador para reenviar.</div>\n              </div>\n            ) : null}`, 
'borradores: aviso observaciones por casa'
);

// 7) Reducir scroll horizontal: tablas con layout fijo y textos envueltos.
replaceAll(`overflowX: "auto"`, `overflowX: "visible"`, 'tablas: quitar scroll horizontal');
replaceAll(`minWidth: 1100`, `tableLayout: "fixed"`, 'tablas: quitar minWidth 1100');
replaceAll(`minWidth: 1200`, `tableLayout: "fixed"`, 'tablas: quitar minWidth 1200');
replaceAll(`minWidth: 280`, `wordBreak: "break-word"`, 'concepto: permitir salto de línea 280');
replaceAll(`minWidth: 300`, `wordBreak: "break-word"`, 'concepto: permitir salto de línea 300');
replaceAll(`minWidth: 180`, `width: "100%"`, 'inputs: ancho responsive 180');
replaceAll(`minWidth: 220`, `width: "100%"`, 'inputs: ancho responsive 220');

if (s === original) {
  console.error('No se aplicó ningún cambio. Revisa que el archivo local sea la versión esperada.');
  process.exit(1);
}

fs.writeFileSync(file, s, 'utf8');
console.log('\nListo. Ahora corre: npm run build');
