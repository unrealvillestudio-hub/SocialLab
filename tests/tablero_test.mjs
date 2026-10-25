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
  lectorDe, ultimasMetricas, viasPorCanal, viaDe, formatoDeFila, enlaceDeId, estadisticas, ORIGEN_DETECTADO, TODAS, VISTA_TABLERO, FORMATO_SIN_TIPO,
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

// ── 7 · El libro: vía y formato de cada fila ──────────────────────────────────

const CANALES = [
  { brand_id: A, platform_key: 'red_drenada', publication_path: 'drained', provider: 'RED_UNO' },
  { brand_id: A, platform_key: 'red_manual', publication_path: 'manual', provider: 'RED_DOS' },
  { brand_id: A, platform_key: 'web', publication_path: 'external', provider: null },
];

test('la vía sale del canal, cruzado por la plataforma que declara (o su clave en mayúsculas)', () => {
  const v = viasPorCanal(CANALES);
  assert.equal(viaDe(v, A, 'RED_UNO'), 'carril');
  assert.equal(viaDe(v, A, 'red_dos'), 'manual');
  assert.equal(viaDe(v, A, 'WEB'), 'externa', 'sin provider_platform, la clave del canal en mayúsculas');
  assert.equal(viaDe(v, B, 'RED_UNO'), 'sin_canal', 'otra marca sin canal: se dice, no se adivina');
});

test('media_type NULL es «una imagen» sólo en el carril; en lo manual manda el formato de la pieza', () => {
  assert.equal(formatoDeFila(null, 'carril', 'post'), FORMATO_SIN_TIPO);
  assert.equal(formatoDeFila(null, 'manual', 'article'), 'ARTICLE');
  assert.equal(formatoDeFila(null, 'manual', 'post'), 'POST');
  assert.equal(formatoDeFila(null, 'externa', null), '', 'sin pieza no se inventa un formato');
  assert.equal(formatoDeFila('CAROUSEL', 'manual', 'post'), 'CAROUSEL', 'un media_type declarado manda');
});

test('una misma pieza manual cuenta UNA vez, con su formato real', () => {
  // El caso del 2026-10-25: la fila del libro y la franja se pintaban como dos tarjetas
  // («una imagen» y «post»). Con una sola fuente, es una fila y un formato.
  const v = viasPorCanal(CANALES);
  const fila = { brand_id: A, platform: 'RED_DOS', media_type: null };
  const formato = formatoDeFila(fila.media_type, viaDe(v, fila.brand_id, fila.platform), 'post');
  assert.deepEqual(contar([{ ...fila, formato }]), [{ brand_id: A, platform: 'RED_DOS', formato: 'POST', total: 1 }]);
});

test('el enlace de una fila manual o externa es su platform_post_id cuando es una URL', () => {
  assert.equal(enlaceDeId('https://ejemplo/p/1'), 'https://ejemplo/p/1');
  assert.equal(enlaceDeId('18114924758028321'), null);
  assert.equal(enlaceDeId(null), null);
});

// ── 8 · Vía detectada y estadísticas ──────────────────────────────────────────

test('una fila detectada en la plataforma es «detectada», aunque su canal sea del carril', () => {
  const v = viasPorCanal(CANALES);
  assert.equal(viaDe(v, A, 'RED_UNO', ORIGEN_DETECTADO), 'detectada');
  assert.equal(viaDe(v, A, 'RED_UNO', 'otra_fuente'), 'carril');
  assert.equal(viaDe(v, A, 'RED_UNO'), 'carril');
});

test('estadísticas: totales y medianas sólo de los posts medidos; el top ordena por la métrica de mayor total', () => {
  const met = (o) => Object.entries(o).map(([metric, value]) => ({ metric, value }));
  const e = estadisticas([
    { id: 'p1', brand_id: A, platform: 'RED_UNO', formato: 'SINGLE_IMAGE', published_at: '2026-10-20T10:00:00Z', metricas: met({ m_alta: 100, m_baja: 1 }) },
    { id: 'p2', brand_id: A, platform: 'RED_UNO', formato: 'CAROUSEL', published_at: '2026-10-20T18:00:00Z', metricas: met({ m_alta: 300, m_baja: 2 }) },
    { id: 'p3', brand_id: A, platform: 'RED_UNO', formato: 'SINGLE_IMAGE', published_at: '2026-10-21T10:00:00Z', metricas: [] },
    { id: 'p4', brand_id: B, platform: 'RED_UNO', formato: 'SINGLE_IMAGE', published_at: '2026-10-21T10:00:00Z', metricas: met({ m_alta: 5 }) },
  ]);
  assert.equal(e.length, 2, 'una tarjeta por (marca, plataforma)');
  const a = e[0];
  assert.deepEqual([a.publicaciones, a.medidas], [3, 2], 'el post sin medir cuenta como publicado, no como medido');
  assert.deepEqual(a.metricas[0], { metric: 'm_alta', total: 400, mediana: 200, posts: 2 }, 'p3 no suma un cero ni baja la mediana');
  assert.equal(a.metricaTop, 'm_alta');
  assert.deepEqual(a.top, ['p2', 'p1'], 'el post sin medir no entra al top');
  assert.deepEqual(a.porFormato, [{ formato: 'SINGLE_IMAGE', publicaciones: 2 }, { formato: 'CAROUSEL', publicaciones: 1 }]);
  assert.deepEqual(a.porDia, [{ dia: '2026-10-20', publicaciones: 2 }, { dia: '2026-10-21', publicaciones: 1 }]);
});

if (fallos) { console.error(`\ntablero: ${fallos} fallo(s)`); process.exit(1); }
console.log('\ntablero: todo en verde');
