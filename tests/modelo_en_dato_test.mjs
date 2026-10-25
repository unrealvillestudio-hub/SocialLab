/**
 * MODELO-DATO (2026-10-25) — `api/execute.ts` no escribe el modelo: lee la fila activa de
 * `public.ops_lab_models` (lab `sociallab`, rol `sync`) una vez por petición y la pasa al adaptador.
 *
 * Sin dependencias. Node >= 22.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../api/execute.ts', import.meta.url), 'utf8');
const codigo = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

let fallos = 0;
function test(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  FALLA  ${nombre}\n        ${e.message}`); }
}

test('ningún modelo escrito en el código', () => {
  assert.ok(!/claude-|CLAUDE_MODEL|haiku|sonnet|opus/i.test(codigo), 'queda un modelo escrito');
});
test('lee ops_lab_models por lab, rol y active, sin respaldo', () => {
  assert.match(codigo, /ops_lab_models\?select=model_id&lab=eq\.\$\{MODELO_LAB\}&role=eq\.\$\{MODELO_ROL\}&active=is\.true/);
  assert.match(codigo, /MODELO_SIN_DATO/);
  assert.match(codigo, /const MODELO_LAB = 'sociallab';/);
  assert.match(codigo, /const MODELO_ROL = 'sync';/);
});
test('una lectura por petición, antes de adaptar, y el adaptador usa lo leído', () => {
  const i = codigo.indexOf('const modelo = await modeloDeLab();');
  const j = codigo.indexOf('await adaptForPlatform(rawCopy, platform, body.brandId!, modelo)');
  assert.ok(i > 0 && j > i, 'el modelo no se resuelve antes de adaptar');
  assert.equal((codigo.match(/await modeloDeLab\(\)/g) ?? []).length, 1);
  assert.match(codigo, /model: modelo,/);
});

console.log(fallos ? `\nmodelo_en_dato_test: ${fallos} fallo(s)` : '\nmodelo_en_dato_test: OK');
process.exit(fallos ? 1 : 0);
