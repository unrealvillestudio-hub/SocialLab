/**
 * SocialLab — TIKTOK POR FILE_UPLOAD, DE PUNTA A PUNTA SIN RED (2026-11-20).
 *
 * Ejecutar:  npm test   (o `node tests/tiktok_file_upload_test.mjs`)
 *
 * Sam (2026-11-20): «SI al PR de TikTok FILE_UPLOAD». Un test de bloque puro no prueba el cableado
 * (HRD-R18), así que aquí se carga `api/_tiktokApi.ts` TAL CUAL en un directorio temporal —con el almacén
 * de tokens sustituido por uno en memoria— y `fetch` hace a la vez de origen del video y de TikTok.
 * Se comprueba la secuencia real: tamaño del origen → init FILE_UPLOAD → por cada parte, descarga con
 * `Range` y `PUT` con `Content-Range`, en orden, y que los bytes que llegan a TikTok son el video entero.
 * Nada habla con TikTok ni con Supabase. Identificadores de fixtura sintéticos.
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_SRC = readFileSync(join(ROOT, 'api', '_tiktokApi.ts'), 'utf8');
const MB = 1024 * 1024;

const ALMACEN = `
export interface SocialTokenRow { [k: string]: any }
export class SocialStoreError extends Error {}
export async function getSocialToken(provider: string, brandId: string) {
  return (globalThis as any).__tokenRow ?? null;
}
export async function upsertSocialToken(row: any) { return true; }
export async function getPublishChannelConfig(brandId: string, providerPlatform: string) {
  (globalThis as any).__configPedida = { brandId, providerPlatform };
  return (globalThis as any).__channelConfig ?? null;
}
export function isoToMs(iso: string | null): number { return iso ? Date.parse(iso) : 0; }
export function msToIso(ms: number): string | null { return ms ? new Date(ms).toISOString() : null; }
`;

let n = 0;
/** Carga `_tiktokApi.ts` (o una versión saboteada) en un directorio propio. */
async function cargar(src = API_SRC) {
  const dir = mkdtempSync(join(tmpdir(), 'tiktok-fu-'));
  copyFileSync(join(ROOT, 'api', '_tiktok.ts'), join(dir, '_tiktok.ts'));
  writeFileSync(join(dir, '_socialTokens.ts'), ALMACEN);
  const api = src.replace("from './_tiktok.js'", "from './_tiktok.ts'").replace("from './_socialTokens.js'", "from './_socialTokens.ts'");
  const f = join(dir, `_tiktokApi_${n++}.ts`);
  writeFileSync(f, api);
  return import(pathToFileURL(f).href);
}

/** Un escenario: el video del origen, lo que responde TikTok y lo que se registró. */
function escenario({ size, initSinUploadUrl = false, putFallaEn = null, putFallaCon = 500, saltoDeRelojTrasPut = 0, initError = null,
  config = null, privacidades = ['SELF_ONLY'] } = {}) {
  const video = Buffer.alloc(size);
  for (let i = 0; i < size; i += 4096) video[i] = (i / 4096) % 251;
  const reg = { inits: [], initUrls: [], creatorInfo: 0, puts: [], recibido: [], descargas: 0 };
  globalThis.__channelConfig = config;
  const relojReal = Date.now;
  let desfase = 0;
  globalThis.__tokenRow = {
    provider: 'tiktok', brand_id: 'MarcaPrueba', open_id: 'oid', access_token: 'tok', refresh_token: 'ref',
    access_token_expires_at: new Date(relojReal() + 3600_000).toISOString(),
    refresh_token_expires_at: new Date(relojReal() + 86_400_000).toISOString(),
  };
  Date.now = () => relojReal() + desfase;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const h = init.headers ?? {};
    if (u === 'https://origen.test/v.mp4') {
      const m = /^bytes=(\d+)-(\d+)$/.exec(h.Range ?? '');
      assert.ok(m, 'el origen se lee SIEMPRE por partes (Range)');
      const a = Number(m[1]); const b = Math.min(Number(m[2]), size - 1);
      if (!(a === 0 && b === 0)) reg.descargas++;
      return new Response(video.subarray(a, b + 1), { status: 206, headers: {
        'content-range': `bytes ${a}-${b}/${size}`, 'content-type': 'video/mp4' } });
    }
    if (u === 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/') {
      reg.creatorInfo++;
      return Response.json({ data: { privacy_level_options: privacidades, comment_disabled: false, duet_disabled: true, stitch_disabled: false }, error: { code: 'ok' } });
    }
    if (u === 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/' || u === 'https://open.tiktokapis.com/v2/post/publish/video/init/'
        || u === 'https://open.tiktokapis.com/v2/post/publish/content/init/') {
      reg.initUrls.push(u);
      reg.inits.push(JSON.parse(init.body));
      if (initError) return Response.json({ error: { code: initError, message: 'x' } }, { status: 403 });
      return Response.json({ data: { publish_id: 'pub_1', ...(initSinUploadUrl ? {} : { upload_url: 'https://up.test/u' }) },
        error: { code: 'ok' } });
    }
    if (u === 'https://up.test/u') {
      reg.puts.push({ method: init.method, headers: { ...h }, bytes: init.body.byteLength });
      reg.recibido.push(Buffer.from(init.body));
      desfase += saltoDeRelojTrasPut;
      if ((Array.isArray(putFallaEn) ? putFallaEn : [putFallaEn]).includes(reg.puts.length)) return new Response('boom', { status: putFallaCon });
      const ultima = /\/(\d+)$/.exec(h['Content-Range'] ?? '') && h['Content-Range'].includes(`-${size - 1}/`);
      return new Response('', { status: ultima ? 201 : 206 });
    }
    throw new Error(`fetch inesperado: ${u}`);
  };
  return { video, reg, restaurar: () => { Date.now = relojReal; } };
}

const POST = { id: 'post-1', brand_id: 'MarcaPrueba', platform: 'tiktok', copy_text: 'Texto de la pieza', media_type: 'REELS', media_urls: ['https://origen.test/v.mp4'] };
const SB = 'https://proyecto.supabase.co';
const FOTO = (n) => `${SB}/storage/v1/object/public/medios/permanent/m/foto-${n}.png`;
const POST_FOTO = { id: 'post-2', brand_id: 'MarcaPrueba', platform: 'tiktok', copy_text: 'Texto completo de la pieza', image_url: FOTO(0) };
const sha = (b) => createHash('sha256').update(b).digest('hex');

let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err.message}`); }
}

const api = await cargar();

/** Lo que tiene que ser cierto en una subida correcta. */
function subidaCorrecta(r, video, reg) {
  assert.equal(r.status, 'published', r.error);
  assert.equal(r.platform_post_id, 'pub_1');
  assert.equal(reg.inits.length, 1);
  const si = reg.inits[0].source_info;
  assert.equal(si.source, 'FILE_UPLOAD');
  assert.equal(si.video_size, video.length);
  assert.equal(si.total_chunk_count, reg.puts.length);
  let esperado = 0;
  for (const p of reg.puts) {
    assert.equal(p.method, 'PUT');
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(p.headers['Content-Range'] ?? '');
    assert.ok(m, `Content-Range ausente o mal formado: ${p.headers['Content-Range']}`);
    assert.equal(Number(m[1]), esperado, 'partes fuera de orden o con hueco');
    assert.equal(Number(m[3]), video.length);
    assert.equal(Number(p.headers['Content-Length']), p.bytes);
    assert.equal(p.headers['Content-Type'], 'video/mp4');
    esperado = Number(m[2]) + 1;
  }
  assert.equal(esperado, video.length, 'no se subió el video entero');
  assert.equal(sha(Buffer.concat(reg.recibido)), sha(video), 'los bytes que llegan a TikTok no son el video');
}

console.log('\n1 · subida correcta');
for (const size of [3 * MB, 25 * MB + 123]) {
  await test(`un video de ${size} bytes llega entero, en orden y por partes`, async () => {
    const { video, reg, restaurar } = escenario({ size });
    try { subidaCorrecta(await api.publishTikTok(POST), video, reg); } finally { restaurar(); }
  });
}
await test('nunca se descarga el video entero de una vez: una descarga por parte', async () => {
  const { reg, restaurar } = escenario({ size: 25 * MB + 123 });
  try { await api.publishTikTok(POST); assert.equal(reg.descargas, reg.puts.length); assert.ok(reg.puts.length >= 2); }
  finally { restaurar(); }
});

console.log('\n2 · fallos dichos');
await test('fila de imagen sin TIKTOK_MEDIA_BASE_URL: falla dicho, sin tocar TikTok', async () => {
  const { reg, restaurar } = escenario({ size: 10 });
  const antes = process.env.TIKTOK_MEDIA_BASE_URL; delete process.env.TIKTOK_MEDIA_BASE_URL;
  try {
    const r = await api.publishTikTok({ ...POST_FOTO });
    assert.equal(r.status, 'failed'); assert.match(r.error, /TIKTOK_MEDIA_BASE_URL/); assert.equal(reg.inits.length, 0);
  } finally { restaurar(); if (antes !== undefined) process.env.TIKTOK_MEDIA_BASE_URL = antes; }
});
await test('init sin upload_url: falla y no sube nada', async () => {
  const { reg, restaurar } = escenario({ size: 3 * MB, initSinUploadUrl: true });
  try {
    const r = await api.publishTikTok(POST);
    assert.equal(r.status, 'failed'); assert.match(r.error, /upload_url/); assert.equal(reg.puts.length, 0);
  } finally { restaurar(); }
});
await test('un 400 de una parte: falla diciendo cuál, sin reintentar y sin seguir', async () => {
  const { reg, restaurar } = escenario({ size: 25 * MB + 123, putFallaEn: 1, putFallaCon: 400 });
  try {
    const r = await api.publishTikTok(POST);
    assert.equal(r.status, 'failed'); assert.match(r.error, /parte 1\/2.*400/); assert.equal(reg.puts.length, 1);
  } finally { restaurar(); }
});
await test('un 5xx de una parte se reintenta UNA vez y la subida sigue', async () => {
  const { video, reg, restaurar } = escenario({ size: 25 * MB + 123, putFallaEn: 1, putFallaCon: 503 });
  try {
    const r = await api.publishTikTok(POST);
    assert.equal(r.status, 'published', r.error); assert.equal(reg.puts.length, 3);
    assert.equal(reg.puts[0].headers['Content-Range'], reg.puts[1].headers['Content-Range'], 'el reintento no es la misma parte');
  } finally { restaurar(); }
});
await test('dos 5xx seguidos en la misma parte: falla', async () => {
  const { reg, restaurar } = escenario({ size: 25 * MB + 123, putFallaEn: [1, 2], putFallaCon: 502 });
  try {
    const r = await api.publishTikTok(POST);
    assert.equal(r.status, 'failed'); assert.match(r.error, /parte 1\/2.*502/); assert.equal(reg.puts.length, 2);
  } finally { restaurar(); }
});
await test('5 borradores pendientes (spam_risk_too_many_pending_share): falla explicando qué hacer', async () => {
  const { reg, restaurar } = escenario({ size: 3 * MB, initError: 'spam_risk_too_many_pending_share' });
  try {
    const r = await api.publishTikTok(POST);
    assert.equal(r.status, 'failed'); assert.match(r.error, /5 borradores pendientes/); assert.equal(reg.puts.length, 0);
  } finally { restaurar(); }
});
await test('se agota el presupuesto de tiempo: TIKTOK_UPLOAD_TIME_BUDGET antes de la siguiente parte', async () => {
  const { reg, restaurar } = escenario({ size: 25 * MB + 123, saltoDeRelojTrasPut: 241_000 });
  try {
    const r = await api.publishTikTok(POST);
    assert.equal(r.status, 'failed'); assert.match(r.error, /TIKTOK_UPLOAD_TIME_BUDGET/); assert.equal(reg.puts.length, 1);
  } finally { restaurar(); }
});

console.log('\n2 bis · modo por dato del canal');
await test('sin post_mode: borrador al inbox, sin creator_info, y se busca el canal por la plataforma del proveedor', async () => {
  const { video, reg, restaurar } = escenario({ size: 3 * MB });
  try {
    subidaCorrecta(await api.publishTikTok(POST), video, reg);
    assert.equal(reg.initUrls[0], 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/');
    assert.equal(reg.creatorInfo, 0); assert.ok(!('post_info' in reg.inits[0]));
    assert.deepEqual(globalThis.__configPedida, { brandId: 'MarcaPrueba', providerPlatform: 'TIKTOK' });
  } finally { restaurar(); }
});
await test('post_mode=direct: creator_info primero, init de Direct Post con post_info SELF_ONLY y la subida igual', async () => {
  const { video, reg, restaurar } = escenario({ size: 25 * MB + 123, config: { post_mode: 'direct' } });
  try {
    subidaCorrecta(await api.publishTikTok(POST), video, reg);
    assert.equal(reg.creatorInfo, 1);
    assert.equal(reg.initUrls[0], 'https://open.tiktokapis.com/v2/post/publish/video/init/');
    const pi = reg.inits[0].post_info;
    assert.equal(pi.privacy_level, 'SELF_ONLY'); assert.equal(pi.title, 'Texto de la pieza');
    assert.equal(pi.disable_duet, true, 'manda lo que la cuenta tiene desactivado'); assert.equal(pi.is_aigc, false);
  } finally { restaurar(); }
});
await test('direct con una privacidad que la cuenta no ofrece: falla dicho, sin init ni subida', async () => {
  const { reg, restaurar } = escenario({ size: 3 * MB, config: { post_mode: 'direct', privacy_level: 'PUBLIC_TO_EVERYONE' } });
  try {
    const r = await api.publishTikTok(POST);
    assert.equal(r.status, 'failed'); assert.match(r.error, /PUBLIC_TO_EVERYONE/); assert.equal(reg.inits.length, 0); assert.equal(reg.puts.length, 0);
  } finally { restaurar(); }
});
await test('un post_mode desconocido: falla dicho, sin llamar a TikTok', async () => {
  const { reg, restaurar } = escenario({ size: 3 * MB, config: { post_mode: 'publicar' } });
  try {
    const r = await api.publishTikTok(POST);
    assert.equal(r.status, 'failed'); assert.match(r.error, /post_mode/); assert.equal(reg.inits.length, 0);
  } finally { restaurar(); }
});
await test('app sin auditar con otra privacidad: el 403 de TikTok se explica', async () => {
  const { restaurar } = escenario({ size: 3 * MB, config: { post_mode: 'direct' }, initError: 'unaudited_client_can_only_post_to_private_accounts' });
  try {
    const r = await api.publishTikTok(POST);
    assert.equal(r.status, 'failed'); assert.match(r.error, /SELF_ONLY/);
  } finally { restaurar(); }
});

console.log('\n2 ter · fotos (PULL_FROM_URL desde el dominio verificado)');
process.env.SUPABASE_URL = SB;
process.env.TIKTOK_MEDIA_BASE_URL = 'https://media.ejemplo.test';
await test('imagen en direct: creator_info, content/init PHOTO con la URL del dominio verificado y el texto en description', async () => {
  const { reg, restaurar } = escenario({ size: 10, config: { post_mode: 'direct' } });
  try {
    const r = await api.publishTikTok({ ...POST_FOTO });
    assert.equal(r.status, 'published', r.error); assert.equal(r.platform_post_id, 'pub_1');
    assert.equal(reg.creatorInfo, 1);
    assert.equal(reg.initUrls[0], 'https://open.tiktokapis.com/v2/post/publish/content/init/');
    const b = reg.inits[0];
    assert.equal(b.media_type, 'PHOTO'); assert.equal(b.post_mode, 'DIRECT_POST');
    assert.deepEqual(b.source_info, { source: 'PULL_FROM_URL', photo_cover_index: 0,
      photo_images: ['https://media.ejemplo.test/api/tiktok-media?o=medios%2Fpermanent%2Fm%2Ffoto-0.png'] });
    assert.equal(b.post_info.description, 'Texto completo de la pieza'); assert.equal(b.post_info.title, '');
    assert.equal(b.post_info.privacy_level, 'SELF_ONLY');
    assert.equal(reg.puts.length, 0, 'las fotos no se suben por partes'); assert.equal(reg.descargas, 0);
  } finally { restaurar(); }
});
await test('carrusel en borrador: MEDIA_UPLOAD con todas las imágenes, sin creator_info ni privacidad', async () => {
  const { reg, restaurar } = escenario({ size: 10 });
  try {
    const r = await api.publishTikTok({ ...POST_FOTO, media_type: 'CAROUSEL', media_urls: [FOTO(1), FOTO(2), FOTO(3)] });
    assert.equal(r.status, 'published', r.error);
    assert.equal(reg.creatorInfo, 0);
    const b = reg.inits[0];
    assert.equal(b.post_mode, 'MEDIA_UPLOAD'); assert.ok(!('privacy_level' in b.post_info));
    assert.equal(b.source_info.photo_images.length, 3);
  } finally { restaurar(); }
});
await test('el título de la fila llega a TikTok en title; el cuerpo, en description', async () => {
  const { reg, restaurar } = escenario({ size: 10 });
  try {
    const r = await api.publishTikTok({ ...POST_FOTO, title: "Crawlers don't read control files." });
    assert.equal(r.status, 'published', r.error);
    assert.equal(reg.inits[0].post_info.title, "Crawlers don't read control files.");
    assert.equal(reg.inits[0].post_info.description, 'Texto completo de la pieza');
  } finally { restaurar(); }
});
await test('una imagen que no es de nuestro almacenamiento: falla dicho, sin llamar a TikTok', async () => {
  const { reg, restaurar } = escenario({ size: 10, config: { post_mode: 'direct' } });
  try {
    const r = await api.publishTikTok({ ...POST_FOTO, image_url: 'https://otro.test/foto.png' });
    assert.equal(r.status, 'failed'); assert.match(r.error, /almacenamiento/); assert.equal(reg.inits.length, 0); assert.equal(reg.creatorInfo, 0);
  } finally { restaurar(); }
});
await test('dominio sin verificar en TikTok: el 403 url_ownership_unverified se explica', async () => {
  const { restaurar } = escenario({ size: 10, initError: 'url_ownership_unverified' });
  try {
    const r = await api.publishTikTok({ ...POST_FOTO });
    assert.equal(r.status, 'failed'); assert.match(r.error, /no está verificado/);
  } finally { restaurar(); }
});

console.log('\n3 · sabotajes (el test tiene que verlos)');
async function sabotaje(nombre, de, a, opciones = {}) {
  assert.ok(API_SRC.includes(de), `el sabotaje «${nombre}» ya no aplica: el código cambió`);
  const roto = await cargar(API_SRC.replace(de, a));
  await test(`sabotaje en rojo — ${nombre}`, async () => {
    const { video, reg, restaurar } = escenario({ size: 25 * MB + 123, ...opciones });
    try {
      let visto = false;
      try { subidaCorrecta(await roto.publishTikTok(POST), video, reg); } catch { visto = true; }
      assert.ok(visto, 'el test no detectó el sabotaje');
    } finally { restaurar(); }
  });
}
async function sabotajeDirecto() {
  const de = 'if (modo.mode === TIKTOK_POST_MODE.DIRECT) {';
  assert.ok(API_SRC.includes(de), 'el sabotaje del modo directo ya no aplica');
  const roto = await cargar(API_SRC.replace(de, 'if (false) {'));
  await test('sabotaje en rojo — el modo direct del canal se ignora', async () => {
    const { reg, restaurar } = escenario({ size: 3 * MB, config: { post_mode: 'direct' } });
    try {
      await roto.publishTikTok(POST);
      assert.notEqual(reg.initUrls[0], 'https://open.tiktokapis.com/v2/post/publish/video/init/', 'el test no detectó el sabotaje');
    } finally { restaurar(); }
  });
}
await sabotaje('sin Content-Range', "        'Content-Range': contentRangeOf(r, plan.video_size),\n", '');
await sabotaje('las partes al revés', 'const r = plan.ranges[i];', 'const r = plan.ranges[plan.ranges.length - 1 - i];');
await sabotaje('sin reintento ante 5xx', 'intento >= TIKTOK_CHUNK_RETRIES_5XX) break;', 'intento >= 0) break;',
  { putFallaEn: 1, putFallaCon: 503 });
await sabotajeDirecto();
{
  const de = '  if (!esVideo) return publishTikTokPhotos(post);';
  assert.ok(API_SRC.includes(de), 'el sabotaje de fotos ya no aplica');
  const roto = await cargar(API_SRC.replace(de, ''));
  await test('sabotaje en rojo — sin la rama de fotos, una imagen no se publica como foto', async () => {
    const { reg, restaurar } = escenario({ size: 10 });
    try {
      await roto.publishTikTok({ ...POST_FOTO });
      assert.notEqual(reg.initUrls[0], 'https://open.tiktokapis.com/v2/post/publish/content/init/', 'el test no detectó el sabotaje');
    } finally { restaurar(); }
  });
}
await sabotaje('se da por publicado sin subir', 'for (let i = 0; i < plan.ranges.length; i++) {', 'for (let i = 0; i < 0; i++) {');

{
  const de = "title: post.title ?? null, direct,";
  assert.ok(API_SRC.includes(de), 'el sabotaje del título ya no aplica');
  const roto = await cargar(API_SRC.replace(de, 'direct,'));
  await test('sabotaje en rojo — sin pasar el título, TikTok lo recibe vacío', async () => {
    const { reg, restaurar } = escenario({ size: 10 });
    try {
      await roto.publishTikTok({ ...POST_FOTO, title: 'T' });
      assert.equal(reg.inits[0].post_info.title, '');
    } finally { restaurar(); }
  });
}

console.log(`\n${passed} ok, ${failures.length} fallos`);
if (failures.length) process.exit(1);
