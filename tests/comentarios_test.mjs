/**
 * BANDEJA DE COMENTARIOS — el núcleo puro (`api/_commentsCore.ts`) y las garantías del handler
 * (`api/comments.ts`). SignalLab Fase 3, 2026-10-25.
 *
 * Cubre:
 *   1 · lo que espera respuesta va primero; un comentario de la propia marca no espera nada;
 *   2 · cuenta como respondido si hay respuesta verificada O la marca contestó después en el hilo;
 *   3 · se responde al comentario de primer nivel del hilo;
 *   4 · un mensaje vacío no es respuesta; dos envíos seguidos al mismo comentario se bloquean;
 *   5 · verificada = la plataforma devuelve el mismo id al leerla;
 *   6 · el handler: comprueba alcance antes de escribir, asienta `requested` ANTES de llamar a la
 *       plataforma, marca `failed` con el error y no nombra ninguna plataforma.
 *
 * Sin dependencias. Requiere Node >= 22.18 (type stripping nativo).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  estados, ordenar, objetivoDeRespuesta, mensajeValido, hayEnVuelo, verificada, MINUTOS_EN_VUELO,
} from '../api/_commentsCore.ts';

let fallos = 0;
function test(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  FALLA  ${nombre}\n        ${e.message}`); }
}

const c = (id, extra = {}) => ({
  id, platform: 'P', platform_comment_id: `c${id}`, brand_id: 'B', platform_post_id: 'post',
  parent_comment_id: null, from_brand: false, commented_at: `2026-10-25T10:0${id}:00Z`, ...extra,
});
const r = (post_comment_id, status, requested_at = '2026-10-25T11:00:00Z') => ({ id: `r${post_comment_id}${status}`, post_comment_id, status, requested_at });

test('1 · sin responder primero; lo de la marca al final', () => {
  const cs = [c(1), c(2, { from_brand: true, parent_comment_id: 'otro' }), c(3)];
  const e = estados(cs, [r(1, 'verified')]);
  assert.equal(e.get(1), 'respondido');
  assert.equal(e.get(2), 'de_la_marca');
  assert.equal(e.get(3), 'sin_responder');
  const orden = ordenar(cs.map((x) => ({ ...x, estado: e.get(x.id) }))).map((x) => x.id);
  assert.deepEqual(orden, [3, 1, 2]);
});

test('2 · la marca contestó después en el mismo hilo = respondido; antes, no', () => {
  const cs = [
    c(1), c(2, { from_brand: true, parent_comment_id: 'c1' }),       // 10:02, después de c1
    c(5), c(4, { from_brand: true, parent_comment_id: 'c5' }),       // 10:04, antes de c5 (10:05)
  ];
  const e = estados(cs, []);
  assert.equal(e.get(1), 'respondido');
  assert.equal(e.get(5), 'sin_responder');
});

test('2b · la última respuesta manda: fallida, en curso', () => {
  assert.equal(estados([c(1)], [r(1, 'failed')]).get(1), 'fallida');
  assert.equal(estados([c(1)], [r(1, 'failed', '2026-10-25T10:00:00Z'), r(1, 'sent', '2026-10-25T11:00:00Z')]).get(1), 'en_curso');
});

test('3 · se responde al primer nivel del hilo', () => {
  assert.equal(objetivoDeRespuesta(c(1)), 'c1');
  assert.equal(objetivoDeRespuesta(c(2, { parent_comment_id: 'c1' })), 'c1');
});

test('4 · mensaje vacío rechazado; doble envío bloqueado sólo en la ventana', () => {
  assert.throws(() => mensajeValido('   '), /MENSAJE_VACIO/);
  assert.throws(() => mensajeValido(undefined), /MENSAJE_VACIO/);
  assert.equal(mensajeValido('  gracias  '), 'gracias');
  const t = Date.parse('2026-10-25T11:00:00Z');
  assert.equal(hayEnVuelo([r(1, 'requested')], t + 60_000), true);
  assert.equal(hayEnVuelo([r(1, 'requested')], t + (MINUTOS_EN_VUELO + 1) * 60_000), false);
  assert.equal(hayEnVuelo([r(1, 'failed')], t + 60_000), false);
  assert.equal(hayEnVuelo([r(1, 'verified')], t + 60_000), false);
});

test('5 · verificada sólo con el mismo id', () => {
  assert.equal(verificada({ id: 'x' }, 'x'), true);
  assert.equal(verificada({ id: 'y' }, 'x'), false);
  assert.equal(verificada(null, 'x'), false);
  assert.equal(verificada({ id: 'x' }, null), false);
});

const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const H = sinComentarios(readFileSync(new URL('../api/comments.ts', import.meta.url), 'utf8'));

test('6 · handler: alcance antes de escribir; requested antes de la plataforma; failed con el error', () => {
  const alcance = H.indexOf('enAlcance(alcance, c.brand_id)');
  const insert = H.indexOf("sbEscribir<FilaRespuesta>('POST', 'comment_replies'");
  const llamada = H.indexOf('mcpLeer(p.reply_tool');
  assert.ok(alcance > 0 && insert > alcance, 'se escribe antes de comprobar el alcance');
  assert.ok(llamada > insert, 'se llama a la plataforma antes de asentar la petición');
  assert.ok(/status: 'failed', error/.test(H), 'un fallo de la plataforma no queda asentado');
  assert.ok(/requested_by: sub/.test(H), 'no se registra quién pidió la respuesta');
  assert.ok(H.indexOf('hayEnVuelo(') > 0 && H.indexOf('hayEnVuelo(') < insert, 'no se bloquea el doble envío');
  assert.ok(/status: 'verified'/.test(H) && /verificada\(leida, idRespuesta\)/.test(H), 'verified sin leer la respuesta');
});

test('6b · ninguna plataforma escrita en el handler ni en el núcleo', () => {
  const N = sinComentarios(readFileSync(new URL('../api/_commentsCore.ts', import.meta.url), 'utf8'));
  for (const src of [H, N]) {
    assert.ok(!/instagram|facebook|\big_|\bfb_/i.test(src), 'una plataforma escrita en código');
  }
});

if (fallos) { console.error(`\n${fallos} fallo(s)`); process.exit(1); }
console.log('\ncomentarios_test: OK');
