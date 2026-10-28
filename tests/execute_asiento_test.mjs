// /api/execute ASIENTA SU COSTO (2026-10-28) — Sam: «sí instrumenta».
//
// QUÉ AFIRMA.
//   1. El costo sale de las dos tarifas resueltas (dato); sin una de ellas es null, nunca una estimación.
//   2. `rate_source` separa lo cobrado (ops_lab_rates:…), lo no cobrado por error del proveedor (NOT_BILLED:…), lo
//      que el proveedor no reportó (USAGE_UNREPORTED) y lo que no tiene tarifa sembrada (UNSEEDED).
//   3. Cada llamada al proveedor en `api/execute.ts` va seguida de su asiento: el archivo llama a
//      `ops_log_generation` y a `ops_resolve_rate`, y no lleva ninguna tarifa escrita.
//
// Ejecutar:  node tests/execute_asiento_test.mjs     (o `npm test`)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { costoDe, fuenteDeTarifa } from "../api/execute.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
const fails = [];
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fails.push([name, e]); console.log(`  FAIL ${name}\n       ${e.message}`); }
}

test("el costo sale de las dos tarifas; sin una, null", () => {
  assert.equal(costoDe(1_000_000, 500_000, 3, 15), 10.5);
  assert.equal(costoDe(1000, 1000, null, 15), null);
  assert.equal(costoDe(1000, 1000, 3, null), null);
});

test("rate_source dice de dónde sale el costo", () => {
  assert.equal(fuenteDeTarifa(200, true, { id: "a" }, { id: "b" }), "ops_lab_rates:a+b");
  assert.equal(fuenteDeTarifa(200, true, null, { id: "b" }), "UNSEEDED");
  assert.equal(fuenteDeTarifa(200, false, null, null), "USAGE_UNREPORTED");
  assert.equal(fuenteDeTarifa(429, true, null, null), "NOT_BILLED:PROVIDER_HTTP_429");
});

test("api/execute.ts asienta cada llamada y no escribe tarifas", () => {
  const src = readFileSync(join(ROOT, "api", "execute.ts"), "utf8");
  const llamadas = src.match(/api\.anthropic\.com\/v1\/messages/g) ?? [];
  const asientos = src.match(/await asentar\(/g) ?? [];
  assert.ok(llamadas.length >= 1, "no se encontró la llamada al proveedor");
  assert.equal(asientos.length, llamadas.length, "cada llamada al proveedor necesita su asiento");
  assert.ok(src.includes("'ops_log_generation'") && src.includes("'ops_resolve_rate'"));
  assert.ok(!/rate_?(in|out)\s*[:=]\s*\d/i.test(src), "una tarifa escrita en el código");
});

console.log(`\n${pass} ok, ${fails.length} fallos`);
if (fails.length) process.exit(1);
