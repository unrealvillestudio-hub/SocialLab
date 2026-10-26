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
 *       plataforma (la herramienta elegida por clase: pública o privada), marca `failed` con el error
 *       y no nombra ninguna plataforma.
 *
 * Sin dependencias. Requiere Node >= 22.18 (type stripping nativo).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  estados, ordenar, objetivoDeRespuesta, mensajeValido, hayEnVuelo, verificada, MINUTOS_EN_VUELO,
  privadaDisponible, objetivoDePrivada, ESTADOS_PENDIENTES, esTipoDeCierre, esRelacion, claveDeAutor,
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
  const llamada = H.indexOf('mcpLeer(herramienta');
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

test('7 · privada: una vez, dentro de la ventana, nunca a la marca, y a la persona de ESE comentario', () => {
  const ahora = Date.parse('2026-10-25T12:00:00Z');
  const com = { from_brand: false, commented_at: '2026-10-24T12:00:00Z' };
  assert.equal(privadaDisponible(com, [], 10080, ahora).puede, true);
  assert.equal(privadaDisponible(com, [], 10080, ahora).hasta, '2026-10-31T12:00:00.000Z');
  assert.match(privadaDisponible(com, [], null, ahora).motivo, /no tiene respuesta privada/);
  assert.match(privadaDisponible({ ...com, from_brand: true }, [], 10080, ahora).motivo, /propia marca/);
  assert.match(privadaDisponible({ ...com, commented_at: '2026-10-10T12:00:00Z' }, [], 10080, ahora).motivo, /ventana/);
  const priv = (status) => ({ id: 'x', post_comment_id: 1, status, requested_at: '2026-10-25T11:00:00Z', kind: 'privada' });
  assert.match(privadaDisponible(com, [priv('verified')], 10080, ahora).motivo, /ya tiene/);
  assert.equal(privadaDisponible(com, [priv('failed')], 10080, ahora).puede, true, 'una fallida bloquea el reintento');
  assert.equal(privadaDisponible(com, [{ ...priv('verified'), kind: 'publica' }], 10080, ahora).puede, true, 'una pública bloquea la privada');
  assert.equal(objetivoDePrivada(c(2, { parent_comment_id: 'c1' })), 'c2');
  assert.equal(hayEnVuelo([priv('requested')], Date.parse('2026-10-25T11:01:00Z'), 'publica'), false, 'una privada en curso bloquea la pública');
});

test('7b · handler: la privada usa sus herramientas, lee por message_id y la base impide la segunda', () => {
  assert.ok(/clase === 'privada' \? p\?\.private_reply_tool : p\?\.reply_tool/.test(H));
  assert.ok(/clase === 'privada' \? p\?\.message_read_tool : p\?\.comment_read_tool/.test(H));
  assert.ok(/brand_id: c\.brand_id, message_id: idRespuesta/.test(H));
  assert.ok(/kind: clase/.test(H), 'la petición no registra si es privada');
  assert.ok(/23505\|duplicate key/.test(H) && /status: 409/.test(H), 'dos envíos a la vez no se frenan');
  assert.ok(H.indexOf('privadaDisponible(c, previas') < H.indexOf("sbEscribir<FilaRespuesta>('POST', 'comment_replies'"), 'se asienta antes de mirar la ventana');
});

test('7 · cerrado (Sam, 2026-10-26): un cierre saca el comentario de lo pendiente; respondido manda sobre cerrado', () => {
  const cs = [c(1), c(2), c(3)];
  const rs = [{ id: 'r', post_comment_id: 3, status: 'verified', requested_at: '2026-10-25T12:00:00Z' }];
  const e = estados(cs, rs, new Set([2, 3]));
  assert.equal(e.get(1), 'sin_responder');
  assert.equal(e.get(2), 'cerrado');
  assert.equal(e.get(3), 'respondido');
  assert.deepEqual([...ESTADOS_PENDIENTES], ['sin_responder', 'fallida'], 'respondido, en curso y cerrado salen de la bandeja');
  assert.deepEqual(ordenar([{ id: 2, estado: 'cerrado', commented_at: '2026-10-25T10:00:00Z' }, { id: 1, estado: 'sin_responder', commented_at: '2026-10-24T10:00:00Z' }]).map((x) => x.id), [1, 2]);
  assert.equal(estados(cs, []).get(2), 'sin_responder', 'sin cierres, nada cambia');
});
test('7 · tipos de cierre: sólo hecho, descartado y contestado_fuera', () => {
  for (const k of ['hecho', 'descartado', 'contestado_fuera']) assert.ok(esTipoDeCierre(k));
  for (const k of ['respondido', '', null, 'HECHO']) assert.ok(!esTipoDeCierre(k));
});
test('7 · handler: el cierre comprueba alcance y que no sea de la marca; responder caduca el consejo abierto', () => {
  const i = H.indexOf('async function cierre(');
  const cuerpo = H.slice(i, H.indexOf('export default'));
  assert.ok(cuerpo.indexOf('enAlcance(alcance, c.brand_id)') < cuerpo.indexOf('await cerrar('), 'cierra antes de comprobar el alcance');
  assert.ok(/c\.from_brand/.test(cuerpo));
  assert.ok(/caducarRecomendaciones\(id, `sistema: comentario respondido/.test(H));
});

test('8 · comentar en la publicación (Sam, 2026-10-26): alcance antes de escribir, herramienta de la tabla, verificación', () => {
  const i = H.indexOf('async function comentarEnPublicacion(');
  const f = H.slice(i, H.indexOf('export default'));
  const llamada = f.indexOf('mcpLeer(herramientas.post_comment_tool');
  assert.ok(llamada > 0, 'no llama la herramienta de la tabla');
  assert.ok(f.indexOf('enAlcance(alcance, p.brand_id)') > 0 && f.indexOf('enAlcance(alcance, p.brand_id)') < llamada, 'escribe antes de comprobar el alcance');
  assert.ok(f.indexOf('r.scheduled_post_id !== postId') < llamada, 'el consejo no se comprueba contra la publicación antes de escribir');
  assert.ok(/mcpLeer\(herramientas\.comment_read_tool/.test(f) && /verificada\(leida, id\)/.test(f), 'no verifica leyendo');
  assert.ok(f.indexOf('mcpLeer(herramientas.comment_read_tool') < f.indexOf("status: 'seguida'"), 'marca seguida antes de publicar');
  assert.ok(!/INSTAGRAM|FACEBOOK|ig_comment|fb_comment/.test(f), 'nombra una plataforma o una herramienta');
});

test('9 · allegados (Sam, 2026-10-26): su comentario queda allegado y fuera de lo pendiente; respondido y cerrado mandan', () => {
  const cs = [c(1, { author_name: 'amiga' }), c(2, { author_name: 'clienta' }), c(3, { author_name: 'amiga' }), c(4, { author_name: null })];
  const allegados = new Set([claveDeAutor('B', 'P', 'amiga')]);
  const e = estados(cs, [{ id: 'r', post_comment_id: 3, status: 'verified', requested_at: '2026-10-25T12:00:00Z' }], new Set(), allegados);
  assert.equal(e.get(1), 'allegado');
  assert.equal(e.get(2), 'sin_responder');
  assert.equal(e.get(3), 'respondido', 'respondido manda');
  assert.equal(e.get(4), 'sin_responder', 'sin autor no se reconoce');
  assert.equal(estados([c(1, { author_name: 'amiga', brand_id: 'OTRA' })], [], new Set(), allegados).get(1), 'sin_responder', 'la marca de otra marca no cuenta');
  assert.ok(!ESTADOS_PENDIENTES.includes('allegado'));
  assert.ok(esRelacion('equipo') && esRelacion('allegado') && !esRelacion('amigo'));
});
test('9 · handler: marcar allegado comprueba alcance y autor antes de escribir', () => {
  const i = H.indexOf('async function allegado(');
  const f = H.slice(i, H.indexOf('/**', i + 10));
  const escribe = f.search(/marcarAllegado\(cuenta|quitarAllegado\(cuenta/);
  assert.ok(f.indexOf('enAlcance(alcance, c.brand_id)') > 0 && f.indexOf('enAlcance(alcance, c.brand_id)') < escribe);
  assert.ok(f.indexOf('if (!autor)') > 0 && f.indexOf('if (!autor)') < escribe);
});

if (fallos) { console.error(`\n${fallos} fallo(s)`); process.exit(1); }
console.log('\ncomentarios_test: OK');
