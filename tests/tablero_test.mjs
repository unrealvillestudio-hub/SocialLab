/**
 * TABLERO DE OPERADORES — el núcleo puro (`api/_opsCore.ts`), sin red ni base.
 *
 * Cubre lo que el tablero promete (Fase 2, 2026-10-24):
 *   1 · la sesión es el JWT de `iid-inbound`: firma, caducidad y forma;
 *   2 · un operador ve SÓLO sus marcas con la vista `social_ops`, dentro de su `brand_scope`, y
 *       fail-closed si el alcance no se pudo leer;
 *   3 · pedir una marca fuera del alcance es 403, no una lista vacía;
 *   4 · la ventana por defecto son 7 días y los conteos son por marca/plataforma/formato;
 *   5 · la lectura en vivo normaliza Instagram y Facebook y no inventa nada si la respuesta falla;
 *   6 · una métrica que no existe no es un cero.
 *
 * Sin dependencias. Requiere Node >= 22.18 (type stripping nativo).
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  verificarSesion, alcanceDe, marcasConsultadas, ventana, contar, formatoDe, normalizarRespuesta,
  lectorDe, ultimasMetricas, publicacionesManuales, TODAS, VISTA_TABLERO, FORMATO_SIN_TIPO,
} from '../api/_opsCore.ts';

let fallos = 0;
function test(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  FALLA  ${nombre}\n        ${e.message}`); }
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function firmar(carga, secreto) {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64(carga);
  return `${h}.${p}.${createHmac('sha256', secreto).update(`${h}.${p}`).digest('base64url')}`;
}
const SECRETO = 'secreto-de-prueba';
const AHORA = 1_800_000_000;

// Marcas de prueba: nombres inventados, para que ningún resultado dependa de una marca real.
const A = 'MarcaA', B = 'MarcaB', C = 'MarcaC';

// ── 1 · Sesión ────────────────────────────────────────────────────────────────

test('un JWT bien firmado y vigente da la sesión', () => {
  const s = verificarSesion(firmar({ sub: 'op1', role: 'seeder', brand_scope: [A], exp: AHORA + 60 }, SECRETO), SECRETO, AHORA);
  assert.deepEqual(s, { sub: 'op1', role: 'seeder', brand_scope: [A] });
});

test('firma con otro secreto, caducado, sin sub o mal formado → null', () => {
  assert.equal(verificarSesion(firmar({ sub: 'op1', role: 'admin', exp: AHORA + 60 }, 'otro'), SECRETO, AHORA), null);
  assert.equal(verificarSesion(firmar({ sub: 'op1', role: 'admin', exp: AHORA - 1 }, SECRETO), SECRETO, AHORA), null);
  assert.equal(verificarSesion(firmar({ role: 'admin', exp: AHORA + 60 }, SECRETO), SECRETO, AHORA), null);
  assert.equal(verificarSesion('a.b', SECRETO, AHORA), null);
  assert.equal(verificarSesion(undefined, SECRETO, AHORA), null);
  assert.equal(verificarSesion(firmar({ sub: 'x', role: 'admin' }, SECRETO), '', AHORA), null, 'sin secreto no hay sesión');
});

// ── 2 · Alcance ───────────────────────────────────────────────────────────────

const op = (brand_scope, role = 'seeder') => ({ sub: 'op1', role, brand_scope });

test('admin ve todas las marcas sin pasar por la tabla', () => {
  assert.equal(alcanceDe(op([], 'admin'), null), TODAS);
});

test('un operador con UNA marca asignada ve sólo esa marca', () => {
  const alcance = alcanceDe(op(['*']), [{ brand_id: A, views: [VISTA_TABLERO] }]);
  assert.deepEqual(alcance, [A]);
  assert.deepEqual(marcasConsultadas(alcance, B), { prohibida: true });
  assert.deepEqual(marcasConsultadas(alcance, null), { marcas: [A] });
});

test('sólo cuentan las concesiones con la vista del tablero, o sin vistas (= todas)', () => {
  const alcance = alcanceDe(op(['*']), [
    { brand_id: A, views: [VISTA_TABLERO] },
    { brand_id: B, views: ['publish_manual'] },
    { brand_id: C, views: null },
  ]);
  assert.deepEqual(alcance, [A, C]);
});

test('el brand_scope del JWT es el techo', () => {
  assert.deepEqual(alcanceDe(op([A]), [{ brand_id: A, views: null }, { brand_id: B, views: null }]), [A]);
  assert.equal(alcanceDe(op([B]), [{ brand_id: A, views: null }]), null);
});

test('fail-closed: sin concesiones o sin poder leerlas, ninguna marca', () => {
  assert.equal(alcanceDe(op(['*']), null), null);
  assert.equal(alcanceDe(op(['*']), []), null);
  assert.equal(alcanceDe(op(['*']), [{ brand_id: A, views: ['calibration'] }]), null);
});

// ── 3 y 4 · Ventana y conteos ─────────────────────────────────────────────────

test('la ventana por defecto son los últimos 7 días', () => {
  const ahora = Date.parse('2026-10-24T12:00:00Z');
  assert.deepEqual(ventana(null, null, ahora), { desde: '2026-10-17T12:00:00.000Z', hasta: '2026-10-24T12:00:00.000Z' });
});

test('una ventana invertida, ilegible o de más de un año se rechaza', () => {
  assert.throws(() => ventana('2026-10-24', '2026-10-01'), /VENTANA_INVALIDA/);
  assert.throws(() => ventana('ayer', null), /VENTANA_INVALIDA/);
  assert.throws(() => ventana('2024-01-01', '2026-01-01'), /VENTANA_INVALIDA/);
});

test('media_type NULL es una imagen sola; cualquier otro formato pasa tal cual', () => {
  assert.equal(formatoDe(null), FORMATO_SIN_TIPO);
  assert.equal(formatoDe('carousel'), 'CAROUSEL');
  assert.equal(formatoDe('REELS'), 'REELS');
});

test('los conteos separan marca, plataforma y formato, y suman el total', () => {
  const filas = [
    { brand_id: A, platform: 'INSTAGRAM', media_type: null },
    { brand_id: A, platform: 'INSTAGRAM', media_type: 'CAROUSEL' },
    { brand_id: A, platform: 'INSTAGRAM', media_type: null },
    { brand_id: B, platform: 'FACEBOOK', media_type: null },
  ];
  const c = contar(filas);
  assert.deepEqual(c, [
    { brand_id: A, platform: 'INSTAGRAM', formato: 'CAROUSEL', total: 1 },
    { brand_id: A, platform: 'INSTAGRAM', formato: FORMATO_SIN_TIPO, total: 2 },
    { brand_id: B, platform: 'FACEBOOK', formato: FORMATO_SIN_TIPO, total: 1 },
  ]);
  assert.equal(c.reduce((s, x) => s + x.total, 0), filas.length);
});

// ── 5 · Lectura en vivo ───────────────────────────────────────────────────────

test('Instagram: id, permalink, imagen, texto y formato del registro', () => {
  const [img, car, vid] = normalizarRespuesta('INSTAGRAM', { data: [
    { id: '1', permalink: 'https://www.instagram.com/p/x/', media_url: 'https://cdn/i.jpg', caption: 'hola', timestamp: '2026-10-24T00:00:15+0000', media_type: 'IMAGE' },
    { id: '2', media_url: 'https://cdn/c.jpg', media_type: 'CAROUSEL_ALBUM' },
    { id: '3', media_url: 'https://cdn/v.mp4', thumbnail_url: 'https://cdn/v.jpg', media_type: 'VIDEO' },
  ] });
  assert.equal(img.platform_post_id, '1');
  assert.equal(img.permalink, 'https://www.instagram.com/p/x/');
  assert.equal(img.formato, FORMATO_SIN_TIPO);
  assert.equal(car.formato, 'CAROUSEL');
  assert.equal(vid.imagen, 'https://cdn/v.jpg', 'en un video la imagen es la miniatura, no el archivo de video');
});

test('Facebook: id de página_post, permalink_url y full_picture', () => {
  const [p] = normalizarRespuesta('FACEBOOK', { data: [
    { id: '11_22', permalink_url: 'https://www.facebook.com/x/posts/22', full_picture: 'https://cdn/f.jpg', message: 'm', created_time: '2026-10-22T17:30:13+0000' },
  ] });
  assert.equal(p.platform_post_id, '11_22');
  assert.equal(p.imagen, 'https://cdn/f.jpg');
  assert.equal(p.texto, 'm');
});

test('una respuesta con error o sin «data» lanza: no se lee como «no publicó nada»', () => {
  assert.throws(() => normalizarRespuesta('INSTAGRAM', { error: 'token caducado' }), /LECTURA_EN_VIVO_FALLIDA/);
  assert.throws(() => normalizarRespuesta('FACEBOOK', {}), /LECTURA_EN_VIVO_ILEGIBLE/);
  assert.throws(() => normalizarRespuesta('TIKTOK', { data: [] }), /SIN_LECTOR_EN_VIVO/);
  assert.equal(lectorDe('tiktok'), null);
});

// ── 6 · Métricas ──────────────────────────────────────────────────────────────

test('la última lectura de cada métrica es la de mayor edad; sin instantáneas, nada (= sin medir)', () => {
  const m = ultimasMetricas([
    { scheduled_post_id: 'p1', age_minutes: 60, metric: 'reach', value: 10, fetched_at: '2026-10-24T01:00:00Z' },
    { scheduled_post_id: 'p1', age_minutes: 180, metric: 'reach', value: 30, fetched_at: '2026-10-24T03:00:00Z' },
    { scheduled_post_id: 'p1', age_minutes: 60, metric: 'likes', value: 2, fetched_at: '2026-10-24T01:00:00Z' },
  ]);
  assert.deepEqual(m.get('p1').map((x) => [x.metric, x.value]), [['likes', 2], ['reach', 30]]);
  assert.equal(m.get('p2'), undefined);
});

// ── 7 · Publicaciones manuales ────────────────────────────────────────────────

test('entran sólo las franjas publicadas de canales manuales, con su enlace y su formato', () => {
  const canales = [
    { brand_id: A, platform_key: 'red_manual', publication_path: 'manual' },
    { brand_id: A, platform_key: 'red_drenada', publication_path: 'drained' },
  ];
  const franjas = [
    { id: 's1', brand_id: A, platform_key: 'red_manual', published_at: '2026-10-23T22:42:32Z', piece_id: 'p1' },
    { id: 's2', brand_id: A, platform_key: 'red_drenada', published_at: '2026-10-23T22:00:00Z', piece_id: 'p2' },
    { id: 's3', brand_id: B, platform_key: 'red_manual', published_at: '2026-10-23T21:00:00Z', piece_id: 'p3' },
    { id: 's4', brand_id: A, platform_key: 'red_manual', published_at: null, piece_id: 'p4' },
  ];
  const piezas = [{ id: 'p1', post_url: 'https://ejemplo/p1', format: 'article', copy: 'texto', imagen: 'https://img/p1.png' }];
  const m = publicacionesManuales(canales, franjas, piezas);
  assert.equal(m.length, 1, 'ni el canal drenado (saldría dos veces), ni otra marca sin canal manual, ni una franja sin fecha');
  assert.deepEqual([m[0].platform, m[0].formato, m[0].enlace, m[0].via], ['RED_MANUAL', 'ARTICLE', 'https://ejemplo/p1', 'manual']);
});

test('una pieza manual sin formato no se cuenta como «una imagen» (ese contrato es de scheduled_posts)', () => {
  const m = publicacionesManuales(
    [{ brand_id: A, platform_key: 'x1', publication_path: 'manual' }],
    [{ id: 's1', brand_id: A, platform_key: 'x1', published_at: '2026-10-23T00:00:00Z', piece_id: null }], []);
  assert.equal(m[0].formato, '');
  assert.deepEqual(contar(m), [{ brand_id: A, platform: 'X1', formato: '', total: 1 }]);
});

if (fallos) { console.error(`\ntablero: ${fallos} fallo(s)`); process.exit(1); }
console.log('\ntablero: todo en verde');
