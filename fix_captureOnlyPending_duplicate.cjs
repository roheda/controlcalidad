const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src', 'EstimacionesWidget.jsx');
if (!fs.existsSync(file)) {
  console.error('No encontré src/EstimacionesWidget.jsx. Ejecuta este script desde la raíz del proyecto app.');
  process.exit(1);
}
let txt = fs.readFileSync(file, 'utf8');
const before = txt;
// El parche anterior pudo insertar varias veces esta misma constante.
// Deja solo la primera aparición dentro del bloque donde ya existe.
const target = 'const captureOnlyPending = filters.status === "pendientes";';
let count = 0;
txt = txt.replace(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), (m) => {
  count += 1;
  return count === 1 ? m : '';
});
// Limpia líneas vacías excesivas que puedan quedar juntas
while (txt.includes('\n\n\n\n')) txt = txt.replace(/\n\n\n\n/g, '\n\n\n');
if (txt === before) {
  console.log('No se hicieron cambios. No encontré duplicados de captureOnlyPending.');
} else {
  fs.writeFileSync(file, txt, 'utf8');
  console.log(`Listo. Encontré ${count} apariciones y dejé solo 1.`);
}
