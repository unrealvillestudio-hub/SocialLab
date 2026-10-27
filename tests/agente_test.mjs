/**
 * AGENTES DEL ECOSISTEMA EN SOCIALLAB (Ayra, Sam 2026-10-27: «Ayra es una operadora del ecosystem con privilegios y
 * roles muy distintos… ve y puede ver todas las marcas y también puede ejecutar acciones»).
 *
 * Fija: que la sesión que SocialLab firma a una agente la verifica la misma puerta que la de un operador; que mirar
 * pide `leer` y escribir pide `actuar`; que sin alcance no hay tablero (fail-closed); y que la credencial se verifica en
 * la base, nunca en el código.
 *
 * Sin dependencias. Requiere Node >= 22.18 (type stripping nativo).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firmarSesion, verificarSesion, capacidadDe, alcanceDeAgente, ROL_AGENTE, TODAS } from '../api/_opsCore.ts';

let fallos = 0;
function test(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  FALLA  ${nombre}\n        ${e.message}`); }
}
const SECRETO = 'secreto-de-prueba-que-no-es-el-de-produccion';
const AHORA = 1_800_000_000;

test('la sesión firmada a una agente la verifica la misma puerta, con su rol, y caduca', () => {
  const t = firmarSesion({ sub: 'ayra', role: ROL_AGENTE, brand_scope: ['*'] }, SECRETO, AHORA, 8);
  assert.deepEqual(verificarSesion(t, SECRETO, AHORA + 60), { sub: 'ayra', role: 'agente', brand_scope: ['*'] });
  assert.equal(verificarSesion(t, SECRETO, AHORA + 8 * 3600 + 1), null, 'caducada');
  assert.equal(verificarSesion(t, 'otro-secreto', AHORA + 60), null, 'otro secreto');
  const [h, p, f] = t.split('.');
  const otraCarga = Buffer.from(JSON.stringify({ sub: 'ayra', role: 'admin', exp: AHORA + 999 })).toString('base64url');
  assert.equal(verificarSesion(`${h}.${otraCarga}.${f}`, SECRETO, AHORA), null, 'una carga cambiada no pasa');
  assert.throws(() => firmarSesion({ sub: 'x', role: ROL_AGENTE, brand_scope: [] }, ''), /SESSION_SECRET_MISSING/);
});
test('mirar es leer; todo lo que escribe es actuar', () => {
  assert.equal(capacidadDe('GET'), 'leer');
  assert.equal(capacidadDe(undefined), 'leer');
  for (const m of ['POST', 'PATCH', 'DELETE', 'post']) assert.equal(capacidadDe(m), 'actuar');
});
test('el alcance de una agente: {*} son todas; una lista, esas; vacío o ilegible, ninguna', () => {
  assert.equal(alcanceDeAgente(['*']), TODAS);
  assert.equal(alcanceDeAgente(['B1', '*']), TODAS);
  assert.deepEqual(alcanceDeAgente(['B1', 'B2', 'B1']), ['B1', 'B2']);
  assert.equal(alcanceDeAgente([]), null);
  assert.equal(alcanceDeAgente(null), null, 'si la lectura falla, fuera (fail-closed)');
});
test('la credencial se verifica en la base y el alcance se decide en cada petición', () => {
  const SES = readFileSync(new URL('../api/session.ts', import.meta.url), 'utf8');
  const SH = readFileSync(new URL('../api/_opsShared.ts', import.meta.url), 'utf8');
  assert.match(SES, /rpc\/agente_verificar_credencial/);
  assert.match(SES, /firmarSesion\(sesion, SESSION_SECRET\(\)\)/);
  assert.doesNotMatch(SES, /bcrypt|compareSync/, 'el hash no se compara en SocialLab');
  assert.match(SH, /rpc\/agente_alcance/);
  assert.match(SH, /alcanceDeAgente\(await alcanceDeLaAgente\(sesion\.sub, capacidad\)\)/);
  assert.match(SH, /const capacidad = capacidadDe\(req\.method\)/);
});

console.log(fallos ? `\n${fallos} falla(s)` : '\nTodo verde.');
if (fallos) process.exit(1);
