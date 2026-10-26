/**
 * BANDEJA DE MENSAJES DIRECTOS — el núcleo puro (`api/_mensajesCore.ts`) y las garantías del handler (`api/mensajes.ts`).
 * Sam, 2026-10-26 (mejora 5).
 *
 * Cubre:
 *   1 · cuándo una conversación espera respuesta: el último mensaje de la persona sin uno de la marca después (escrito
 *       en la app o enviado desde SocialLab); allegado no espera; una respuesta pedida está en curso un rato; una que
 *       falló deja la conversación como fallida;
 *   2 · la ventana de la plataforma: se cuenta desde el último mensaje de la persona y es dato;
 *   3 · lo que hay que contestar es lo que la persona escribió desde la última vez que habló la marca;
 *   4 · el orden: estado, intención y lo más reciente;
 *   5 · el handler: alcance antes de escribir, la ventana y el «en curso» antes de enviar, asienta `requested` ANTES de
 *       llamar a la plataforma, herramienta y lectora como dato, `failed` con el error, y no nombra plataformas ni marcas.
 *
 * Sin dependencias. Requiere Node >= 22.18 (type stripping nativo).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  estadoDeHilo, ventanaDeRespuesta, sinContestar, ultimoDeLaPersona, ordenarHilos, ESTADOS_HILO_PENDIENTES, MINUTOS_EN_VUELO,
} from '../api/_mensajesCore.ts';
import { MINUTOS_EN_VUELO as EN_VUELO_COMENTARIOS } from '../api/_commentsCore.ts';

let fallos = 0;
function test(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  FALLA  ${nombre}\n        ${e.message}`); }
}

const m = (id, from_brand, sent_at, text = 'hola') => ({ id, thread_id: 1, from_brand, author_name: null, author_platform_id: null, text, sent_at });
const r = (status, requested_at, sent_at = null) => ({ id: `r${requested_at}`, thread_id: 1, status, message: 'x', requested_by: 'sam', requested_at, sent_at, platform_message_id: null, error: null });
const AHORA = Date.parse('2026-10-26T22:00:00Z');

test('1 · la persona escribió y nadie contestó: sin responder', () => {
  assert.equal(estadoDeHilo([m(1, false, '2026-10-26T20:00:00Z')], [], false, AHORA), 'sin_responder');
});
test('1 · la marca contestó después (en la app): respondido; antes no cuenta', () => {
  assert.equal(estadoDeHilo([m(1, false, '2026-10-26T20:00:00Z'), m(2, true, '2026-10-26T20:30:00Z')], [], false, AHORA), 'respondido');
  assert.equal(estadoDeHilo([m(2, true, '2026-10-26T19:00:00Z'), m(1, false, '2026-10-26T20:00:00Z')], [], false, AHORA), 'sin_responder');
});
test('1 · una respuesta de SocialLab que salió cuenta; una pedida hace poco está en curso; una fallida, fallida', () => {
  const ms = [m(1, false, '2026-10-26T20:00:00Z')];
  assert.equal(estadoDeHilo(ms, [r('verified', '2026-10-26T20:10:00Z', '2026-10-26T20:10:05Z')], false, AHORA), 'respondido');
  assert.equal(estadoDeHilo(ms, [r('requested', '2026-10-26T21:55:00Z')], false, AHORA), 'en_curso');
  assert.equal(estadoDeHilo(ms, [r('requested', '2026-10-26T20:10:00Z')], false, AHORA), 'sin_responder', 'una pedida vieja no bloquea');
  assert.equal(estadoDeHilo(ms, [r('failed', '2026-10-26T20:10:00Z')], false, AHORA), 'fallida');
  assert.equal(estadoDeHilo(ms, [r('failed', '2026-10-26T19:00:00Z')], false, AHORA), 'sin_responder', 'un fallo anterior al mensaje no cuenta');
});
test('1 · allegado no espera; sin mensajes de la persona no hay nada que contestar', () => {
  assert.equal(estadoDeHilo([m(1, false, '2026-10-26T20:00:00Z')], [], true, AHORA), 'allegado');
  assert.equal(estadoDeHilo([m(2, true, '2026-10-26T20:00:00Z')], [], false, AHORA), 'respondido');
  assert.deepEqual(ESTADOS_HILO_PENDIENTES, ['sin_responder', 'fallida']);
});
test('1 · el margen de «en curso» es el mismo que en comentarios', () => {
  assert.equal(MINUTOS_EN_VUELO, EN_VUELO_COMENTARIOS);
});
test('2 · la ventana se cuenta desde el último mensaje de la persona, no desde el de la marca', () => {
  const ms = [m(1, false, '2026-10-26T20:00:00Z'), m(2, true, '2026-10-26T21:00:00Z')];
  const v = ventanaDeRespuesta(ms, 1440, AHORA);
  assert.equal(v.puede, true); assert.equal(v.hasta, '2026-10-27T20:00:00.000Z');
  const vieja = ventanaDeRespuesta([m(1, false, '2026-10-25T21:59:00Z')], 1440, AHORA);
  assert.equal(vieja.puede, false); assert.match(vieja.motivo, /24 h/);
  assert.equal(ventanaDeRespuesta(ms, null, AHORA).puede, false, 'sin ventana configurada no se responde');
  assert.equal(ventanaDeRespuesta([m(2, true, '2026-10-26T21:00:00Z')], 1440, AHORA).puede, false, 'si la persona no escribió, no');
});
test('3 · lo que hay que contestar: desde la última vez que habló la marca', () => {
  const ms = [m(3, false, '2026-10-26T20:05:00Z', 'b'), m(1, false, '2026-10-26T19:00:00Z', 'viejo'), m(2, true, '2026-10-26T19:30:00Z'), m(4, false, '2026-10-26T20:10:00Z', 'c')];
  assert.deepEqual(sinContestar(ms).map((x) => x.id), [3, 4]);
  assert.equal(ultimoDeLaPersona(ms), Date.parse('2026-10-26T20:10:00Z'));
});
test('4 · orden: pendientes primero, luego intención, luego lo más reciente', () => {
  const h = (id, estado, priority, ultimo_at) => ({ id, estado, intencion: priority == null ? null : { priority }, ultimo_at });
  const o = ordenarHilos([h(1, 'respondido', 10, '2026-10-26T21:00:00Z'), h(2, 'sin_responder', 60, '2026-10-26T21:00:00Z'),
    h(3, 'sin_responder', 10, '2026-10-26T18:00:00Z'), h(4, 'sin_responder', 10, '2026-10-26T19:00:00Z'), h(5, 'sin_responder', null, '2026-10-26T21:30:00Z')]).map((x) => x.id);
  assert.deepEqual(o, [4, 3, 2, 5, 1]);
});

const SRC = readFileSync(new URL('../api/mensajes.ts', import.meta.url), 'utf8');
const CODIGO = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
test('5 · responder: alcance, en curso y ventana antes de escribir; requested antes de llamar a la plataforma', () => {
  const b = CODIGO.slice(CODIGO.indexOf('async function responder('), CODIGO.indexOf('async function allegado('));
  const i = (x) => { const k = b.indexOf(x); assert.ok(k >= 0, `falta ${x}`); return k; };
  assert.ok(i('hiloDelAlcance(') < i("'en_curso'"), 'el alcance va primero');
  assert.ok(i("'en_curso'") < i("sbEscribir<RespuestaDM>('POST', 'dm_replies'"));
  assert.ok(i('ventanaDeRespuesta(') < i("sbEscribir<RespuestaDM>('POST', 'dm_replies'"), 'la ventana se comprueba antes de asentar');
  assert.ok(i("sbEscribir<RespuestaDM>('POST', 'dm_replies'") < i('mcpLeer(p.dm_send_tool'), 'se asienta antes de llamar');
  assert.ok(i('mcpLeer(p.dm_send_tool') < i('mcpLeer(p.message_read_tool'), 'se verifica después de enviar');
  assert.ok(/status: 'failed', error/.test(b) && /status: 'verified'/.test(b));
  assert.ok(/recipient_id: h\.participant_platform_id/.test(b), 'se responde a la otra persona de la conversación');
});
test('5 · la herramienta y la ventana son dato; el archivo no nombra plataformas ni marcas', () => {
  assert.ok(/signal_platforms\?select=\$\{COLUMNAS_PLATAFORMA\}/.test(CODIGO));
  assert.ok(/'platform,dm_send_tool,dm_reply_window_minutes,message_read_tool'/.test(CODIGO));
  assert.ok(!/INSTAGRAM|FACEBOOK|instagram|messenger|ig_send_message|fb_send_message/.test(CODIGO), 'nombra una plataforma o una herramienta');
  assert.ok(!/NeuroneSCF|ForumPHs|LucienSael|UnrealvilleStudio/.test(SRC), 'nombra una marca');
});
test('5 · sin la migración no se rompe: el GET dice por qué y el POST responde 503', () => {
  assert.ok(/disponible: false, motivo: 'los mensajes directos todavía no se leen/.test(CODIGO));
  assert.ok(/status: 503, body: \{ error: 'los mensajes directos todavía no están disponibles/.test(CODIGO));
});

if (fallos) { console.error(`\n${fallos} fallo(s)`); process.exit(1); }
console.log('\nmensajes_test: OK');
