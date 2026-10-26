/**
 * ASESOR — el núcleo puro de las tarjetas de acción (`api/_asesorCore.ts`).
 *   1 · una acción `interna` sólo la ve quien tiene alcance total;
 *   2 · orden: nuevas primero, luego atención → oportunidad → info, luego la más reciente;
 *   3 · el operador sólo pide vista · seguida · descartada; `resuelta` es del sistema; abrir dos veces no cambia nada.
 */
import assert from 'node:assert/strict';
import { visiblePara, ordenarTarjetas, cambioDeEstado, cambioDeRecomendacion, textoEnviado, estadoDePedidos, idDeComentario } from '../api/_asesorCore.ts';
import { agruparTarjetas, severidadMayor } from '../src/asesor.ts';

let fallos = 0;
function test(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  FALLA  ${nombre}\n        ${e.message}`); }
}

test('1 · la acción interna no la ve el operador del cliente', () => {
  assert.equal(visiblePara({ action_key: 'x', label: '', objective: '', via: 'interna' }, false), false);
  assert.equal(visiblePara({ action_key: 'x', label: '', objective: '', via: 'interna' }, true), true);
  assert.equal(visiblePara({ action_key: 'x', label: '', objective: '', via: 'api' }, false), true);
  assert.equal(visiblePara(undefined, false), true, 'una acción sin catálogo no se esconde');
});

test('2 · nuevas primero, luego por gravedad, luego la más reciente', () => {
  const t = (id, status, severity, created_at) => ({ id, status, severity, created_at });
  const o = ordenarTarjetas([
    t('a', 'vista', 'atencion', '2026-10-25T10:00:00Z'),
    t('b', 'nueva', 'info', '2026-10-25T09:00:00Z'),
    t('c', 'nueva', 'atencion', '2026-10-25T08:00:00Z'),
    t('d', 'nueva', 'atencion', '2026-10-25T11:00:00Z'),
    t('e', 'seguida', 'oportunidad', '2026-10-25T12:00:00Z'),
  ]);
  assert.deepEqual(o.map((x) => x.id), ['d', 'c', 'b', 'a', 'e']);
});

test('3 · cambios de estado del operador', () => {
  assert.deepEqual(cambioDeEstado('nueva', 'vista'), { ok: true });
  assert.deepEqual(cambioDeEstado('vista', 'vista'), { noop: true }, 'abrir dos veces no cambia nada');
  assert.deepEqual(cambioDeEstado('seguida', 'vista'), { noop: true }, 'abrir no deshace «seguida»');
  assert.deepEqual(cambioDeEstado('vista', 'seguida'), { ok: true });
  assert.deepEqual(cambioDeEstado('nueva', 'descartada'), { ok: true });
  assert.ok('error' in cambioDeEstado('vista', 'resuelta'), 'resuelta la pone el sistema');
  assert.ok('error' in cambioDeEstado('resuelta', 'seguida'));
  assert.ok('error' in cambioDeEstado('descartada', 'vista'));
});

test('4 · cada tarjeta viaja con su publicación; la de comentario, con el post del comentario; el resto, con su cuenta', () => {
  const t = (id, extra) => ({ id, brand_id: 'm', platform: 'INSTAGRAM', severity: 'info', status: 'nueva', scheduled_post_id: null, post_comment_id: null, ...extra });
  const { porPost, porCuenta } = agruparTarjetas([
    t('a', { scheduled_post_id: 'p1' }),
    t('b', { post_comment_id: 7 }),
    t('c', { post_comment_id: 8 }),
    t('d', {}),
  ], (id) => (id === 7 ? 'p1' : null));
  assert.deepEqual(porPost.get('p1').map((x) => x.id), ['a', 'b']);
  assert.deepEqual(porCuenta.get('m|INSTAGRAM').map((x) => x.id), ['c', 'd'], 'un comentario sin post conocido va a su cuenta, no se pierde');
  assert.equal(severidadMayor([{ severity: 'info' }, { severity: 'atencion' }, { severity: 'oportunidad' }]), 'atencion');
  assert.equal(severidadMayor([]), null);
});

test('5 · recomendaciones: el operador sólo sigue o descarta; caducada es del sistema; lo enviado se guarda tal cual', () => {
  assert.deepEqual(cambioDeRecomendacion('nueva', 'seguida'), { ok: true });
  assert.deepEqual(cambioDeRecomendacion('nueva', 'descartada'), { ok: true });
  assert.deepEqual(cambioDeRecomendacion('seguida', 'seguida'), { noop: true });
  assert.ok('error' in cambioDeRecomendacion('nueva', 'caducada'), 'caducada la pone el sistema');
  assert.ok('error' in cambioDeRecomendacion('caducada', 'seguida'));
  assert.ok('error' in cambioDeRecomendacion('descartada', 'seguida'));
  assert.equal(textoEnviado('  hola  '), 'hola');
  assert.equal(textoEnviado(''), null);
  assert.equal(textoEnviado(42), null);
  assert.equal(textoEnviado('x'.repeat(6000)).length, 5000);
});

test('consejo por comentario · el último pedido de cada comentario dice cómo va, sin nada del despertar', () => {
  const f = (id, status, recommendations, created_at) => ({ post_comment_id: id, status, recommendations, created_at });
  const r = estadoDePedidos([
    f(7, 'hecho', 0, '2026-10-26T10:00:00Z'), f(7, 'pendiente', 0, '2026-10-26T11:00:00Z'),
    f('8', 'hecho', 1, '2026-10-26T10:00:00Z'),
    f(9, 'omitido', 0, '2026-10-26T10:00:00Z'), f(10, 'fallido', 0, '2026-10-26T10:00:00Z'),
    f(null, 'pendiente', 0, '2026-10-26T12:00:00Z'),
  ]);
  const m = new Map(r.map((x) => [x.post_comment_id, x.estado]));
  assert.equal(m.get(7), 'pendiente', 'manda el más reciente');
  assert.equal(m.get(8), 'con_consejo');
  assert.equal(m.get(9), 'sin_consejo');
  assert.equal(m.get(10), 'sin_consejo');
  assert.equal(m.size, 4, 'un despertar de la marca (sin comentario) no es un pedido');
  for (const x of r) assert.deepEqual(Object.keys(x).sort(), ['estado', 'post_comment_id'], 'sale algo del despertar');
});

test('consejo por comentario · el id del cuerpo: entero positivo, ausente o inválido', () => {
  assert.equal(idDeComentario(undefined), null);
  assert.equal(idDeComentario(null), null);
  assert.equal(idDeComentario(''), null);
  assert.equal(idDeComentario(42), 42);
  assert.equal(idDeComentario('42'), 42);
  for (const v of [0, -1, 1.5, '4a', 'x', {}, Number.MAX_SAFE_INTEGER + 2]) assert.equal(idDeComentario(v), undefined, String(v));
});

if (fallos) { console.error(`\nasesor: ${fallos} fallo(s)`); process.exit(1); }
console.log('\nasesor: todo en verde');
