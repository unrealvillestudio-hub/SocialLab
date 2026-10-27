// Corre todos los tests de `tests/*_test.mjs`, uno por uno, y falla si falla cualquiera.
//
// Por qué existe (2026-10-27): `npm test` era una cadena «node a && node b && …» en una sola línea de package.json,
// y cada PR que añadía un test añadía su eslabón en esa misma línea. Varias sesiones trabajan a la vez en este repo y
// dos PRs con un test nuevo chocaban SIEMPRE ahí (medido el 2026-10-27: los PRs #41, #42 y #43, uno detrás de otro).
// Ahora un test nuevo entra sólo con existir: no hay que tocar ningún archivo compartido.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(DIR).filter((f) => f.endsWith("_test.mjs")).sort();
if (!tests.length) { console.error("no se encontró ningún tests/*_test.mjs"); process.exit(1); }

const rojos = [];
for (const t of tests) {
  console.log(`\n══ ${t} ══`);
  const r = spawnSync(process.execPath, [join(DIR, t)], { stdio: "inherit" });
  if (r.status !== 0) rojos.push(t);
}
console.log(`\n${tests.length - rojos.length} de ${tests.length} archivos de test en verde.`);
if (rojos.length) { console.error(`En rojo: ${rojos.join(", ")}`); process.exit(1); }
