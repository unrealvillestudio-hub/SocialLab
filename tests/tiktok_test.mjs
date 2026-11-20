/**
 * SocialLab — EL BLOQUE PURO DE TIKTOK, CASO POR CASO.
 *
 * Ejecutar:  npm test   (o `node tests/tiktok_test.mjs`)
 * Sin dependencias. Node >= 22.18 (type stripping nativo) importa `_tiktok.ts` sin toolchain.
 *
 * Qué protege: el authorize URL, la firma del `state` (CSRF sin almacén), la lectura de la respuesta
 * de token —incluido el refresh_token que PUEDE cambiar—, la lectura del init del inbox (sólo
 * `error.code === 'ok'` publica), la caducidad del access token y la elección de la URL de video.
 *
 * Lo que este test NO puede hacer: hablar con TikTok. Eso exige credenciales y una cuenta real y se
 * verifica en el cuerpo del PR. Aquí se fija la DECISIÓN. Identificadores de fixtura sintéticos.
 */

import assert from 'node:assert/strict';
import {
  TIKTOK_AUTHORIZE_URL, TIKTOK_SCOPES,
  resolvePostMode, readCreatorInfo, buildDirectPostInfo, buildDirectPostInitBody, truncateUtf16,
  buildAuthorizeUrl,
  parseTokenResponse, isAccessTokenExpired,
  buildInboxInitBody, readInboxInitResult, readStatusResult,
  tiktokVideoUrlOf, planChunks, contentRangeOf, uploadContentTypeOf, videoSizeFromHeaders,
  TIKTOK_CHUNK_MIN_BYTES, TIKTOK_CHUNK_MAX_BYTES, TIKTOK_FINAL_CHUNK_MAX_BYTES, TIKTOK_MAX_CHUNKS, TIKTOK_MAX_VIDEO_BYTES,
  inboxInitErrorMessage, chunkStatusRetryable,
} from '../api/_tiktok.ts';
import { signState, verifyState } from '../api/_oauthState.ts';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`FAIL  ${name}\n      ${err.message}`); }
}
const json = (o) => o; // las funciones leen objetos ya parseados

// ── 1 · Authorize URL ──────────────────────────────────────────────────────────

test('el authorize URL lleva client_key, code, scope CSV, redirect_uri y state', () => {
  const url = buildAuthorizeUrl({
    clientKey: 'ck_test', redirectUri: 'https://x.test/api/tiktok-oauth',
    scope: TIKTOK_SCOPES, state: 's.m',
  });
  assert.ok(url.startsWith(TIKTOK_AUTHORIZE_URL), 'base distinta del authorize oficial');
  const u = new URL(url);
  assert.equal(u.searchParams.get('client_key'), 'ck_test');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('scope'), 'user.info.basic,video.upload,video.publish');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://x.test/api/tiktok-oauth');
  assert.equal(u.searchParams.get('state'), 's.m');
});

test('el OAuth pide upload y publish: cambiar de modo es cambiar un dato, sin reautorizar', () => {
  assert.deepEqual([...TIKTOK_SCOPES], ['user.info.basic', 'video.upload', 'video.publish']);
});

// ── 2 · State firmado (CSRF) ─────────────────────────────────────────────────────

test('un state firmado se verifica y devuelve su marca', () => {
  const s = signState({ brand_id: 'marcaX', nonce: 'abc' }, 'secret');
  const p = verifyState(s, 'secret');
  assert.deepEqual(p, { brand_id: 'marcaX', nonce: 'abc' });
});

test('un state con otro secreto NO verifica (firma distinta)', () => {
  const s = signState({ brand_id: 'marcaX', nonce: 'abc' }, 'secret');
  assert.equal(verifyState(s, 'otro'), null);
});

test('un state manipulado NO verifica', () => {
  const s = signState({ brand_id: 'marcaX', nonce: 'abc' }, 'secret');
  const [body] = s.split('.');
  const falso = `${body}.ZmFsc2E`;
  assert.equal(verifyState(falso, 'secret'), null);
  assert.equal(verifyState('sinpunto', 'secret'), null);
  assert.equal(verifyState('', 'secret'), null);
});

// ── 3 · Lectura de la respuesta de token ─────────────────────────────────────────

test('un token válido se normaliza con épocas en ms', () => {
  const now = 1_000_000;
  const r = parseTokenResponse(json({
    access_token: 'at', refresh_token: 'rt', open_id: 'oid', scope: 'user.info.basic,video.upload,video.publish',
    expires_in: 86400, refresh_expires_in: 31536000,
  }), now);
  assert.ok(r.ok);
  assert.equal(r.record.access_token, 'at');
  assert.equal(r.record.access_token_expires_at, now + 86400 * 1000);
  assert.equal(r.record.refresh_token_expires_at, now + 31536000 * 1000);
});

test('una respuesta de error de OAuth se lee como fallo, no como token', () => {
  const r = parseTokenResponse(json({ error: 'invalid_grant', error_description: 'bad code' }), 0);
  assert.ok(!r.ok);
  assert.match(r.error, /invalid_grant/);
});

test('sin access_token o sin refresh_token es fallo', () => {
  assert.ok(!parseTokenResponse(json({ refresh_token: 'rt' }), 0).ok);
  assert.ok(!parseTokenResponse(json({ access_token: 'at' }), 0).ok);
});

// ── 4 · Caducidad del access token ───────────────────────────────────────────────

test('caduca con margen: un token que vence dentro del skew ya se considera caduco', () => {
  const now = 1_000_000;
  assert.equal(isAccessTokenExpired(now + 120_000, now, 60_000), false, 'faltan 2 min: vigente');
  assert.equal(isAccessTokenExpired(now + 30_000, now, 60_000), true, 'faltan 30 s < skew: caduco');
  assert.equal(isAccessTokenExpired(0, now), true, 'sin fecha: caduco por prudencia');
});

// ── 5 · Inbox init (FILE_UPLOAD) ──────────────────────────────────────────────────

const MB = 1024 * 1024;
/** Comprueba las reglas de las partes sobre un plan. */
function cumpleReglas(p) {
  assert.ok(p.ok, p.error);
  assert.equal(p.ranges.length, p.total_chunk_count);
  assert.ok(p.total_chunk_count >= 1 && p.total_chunk_count <= TIKTOK_MAX_CHUNKS);
  assert.equal(p.ranges[0].start, 0);
  assert.equal(p.ranges.at(-1).end, p.video_size - 1);
  for (let i = 1; i < p.ranges.length; i++) assert.equal(p.ranges[i].start, p.ranges[i - 1].end + 1, 'hueco o solape');
  if (p.total_chunk_count === 1) { assert.equal(p.chunk_size, p.video_size); return; }
  assert.ok(p.chunk_size >= TIKTOK_CHUNK_MIN_BYTES && p.chunk_size <= TIKTOK_CHUNK_MAX_BYTES);
  assert.equal(p.total_chunk_count, Math.floor(p.video_size / p.chunk_size));
  for (const r of p.ranges.slice(0, -1)) assert.equal(r.end - r.start + 1, p.chunk_size);
  const ultima = p.ranges.at(-1);
  assert.ok(ultima.end - ultima.start + 1 >= p.chunk_size && ultima.end - ultima.start + 1 <= TIKTOK_FINAL_CHUNK_MAX_BYTES);
}

test('el cuerpo del init es FILE_UPLOAD con tamaño, parte y número de partes', () => {
  assert.deepEqual(buildInboxInitBody({ video_size: 30 * MB, chunk_size: 10 * MB, total_chunk_count: 3 }),
    { source_info: { source: 'FILE_UPLOAD', video_size: 30 * MB, chunk_size: 10 * MB, total_chunk_count: 3 } });
});

test('menos de 5 MB, o hasta una parte preferida: se sube entero en 1 parte', () => {
  for (const n of [1, 4 * MB, 5 * MB, 10 * MB]) {
    const p = planChunks(n); cumpleReglas(p);
    assert.equal(p.total_chunk_count, 1);
  }
});

test('un video grande se parte con las reglas: partes iguales y la última recoge el resto', () => {
  for (const n of [10 * MB + 1, 25 * MB + 123, 64 * MB, 200 * MB + 7, 1024 * MB]) cumpleReglas(planChunks(n));
  const p = planChunks(25 * MB + 123);
  assert.equal(p.total_chunk_count, 2);
  assert.equal(p.ranges[1].end - p.ranges[1].start + 1, 15 * MB + 123);
});

test('el tope de TikTok: 4 GB se parte; un byte más se rechaza', () => {
  const p = planChunks(TIKTOK_MAX_VIDEO_BYTES); cumpleReglas(p);
  assert.ok(p.total_chunk_count <= TIKTOK_MAX_CHUNKS);
  assert.equal(planChunks(TIKTOK_MAX_VIDEO_BYTES + 1).ok, false);
});

test('lo que no cabe o no es un tamaño se dice, no se intenta', () => {
  assert.equal(planChunks(0).ok, false);
  assert.equal(planChunks(-5).ok, false);
  assert.equal(planChunks(1.5).ok, false);
});

test('Content-Range, tipo de contenido y tamaño del origen', () => {
  assert.equal(contentRangeOf({ start: 0, end: 9 }, 30), 'bytes 0-9/30');
  assert.equal(uploadContentTypeOf('video/quicktime'), 'video/quicktime');
  assert.equal(uploadContentTypeOf('application/octet-stream'), 'video/mp4');
  assert.equal(uploadContentTypeOf(null), 'video/mp4');
  assert.equal(videoSizeFromHeaders({ contentRange: 'bytes 0-0/12345' }), 12345);
  assert.equal(videoSizeFromHeaders({ contentLength: '999' }), 999);
  assert.equal(videoSizeFromHeaders({ contentRange: 'bytes 0-0/*' }), null);
  assert.equal(videoSizeFromHeaders({}), null);
});

test('el init devuelve el upload_url https, o null si no viene', () => {
  const r = readInboxInitResult(json({ data: { publish_id: 'p1', upload_url: 'https://up.test/u' }, error: { code: 'ok' } }));
  assert.equal(r.uploadUrl, 'https://up.test/u');
  assert.equal(readInboxInitResult(json({ data: { publish_id: 'p1' }, error: { code: 'ok' } })).uploadUrl, null);
});

test('error.code=ok con publish_id es el único éxito', () => {
  const r = readInboxInitResult(json({ data: { publish_id: 'v_inbox_file~v2.1' }, error: { code: 'ok' } }));
  assert.ok(r.ok);
  assert.equal(r.publishId, 'v_inbox_file~v2.1');
});

test('un error.code distinto de ok es fallo DICHO con su código', () => {
  const r = readInboxInitResult(json({ error: { code: 'access_token_invalid', message: 'token' } }));
  assert.ok(!r.ok);
  assert.equal(r.code, 'access_token_invalid');
  assert.match(r.message, /token/);
});

test('error.code=ok SIN publish_id no se da por publicado', () => {
  const r = readInboxInitResult(json({ error: { code: 'ok' }, data: {} }));
  assert.ok(!r.ok);
  assert.equal(r.code, 'no_publish_id');
});

// ── 6 · Lectura de estado ────────────────────────────────────────────────────────

test('los estados conocidos se leen por su nombre; lo demás es UNKNOWN', () => {
  for (const s of ['PROCESSING_DOWNLOAD', 'SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE', 'FAILED']) {
    assert.equal(readStatusResult(json({ data: { status: s } })).status, s);
  }
  assert.equal(readStatusResult(json({ data: { status: 'ALGO_NUEVO' } })).status, 'UNKNOWN');
  assert.equal(readStatusResult(json({})).status, 'UNKNOWN');
});

test('un FAILED conserva el fail_reason', () => {
  const r = readStatusResult(json({ data: { status: 'FAILED', fail_reason: 'download timeout' } }));
  assert.equal(r.status, 'FAILED');
  assert.equal(r.failReason, 'download timeout');
});

// ── 7 · La URL de video ──────────────────────────────────────────────────────────

test('toma la primera URL https de media_urls; nunca cae a image_url', () => {
  assert.equal(tiktokVideoUrlOf({ media_urls: ['http://x/x.mp4', 'https://v.test/y.mp4'] }), 'https://v.test/y.mp4');
  assert.equal(tiktokVideoUrlOf({ media_urls: [], image_url: 'https://v.test/foto.jpg' }), null);
  assert.equal(tiktokVideoUrlOf({ video_url: 'https://v.test/z.mp4' }), 'https://v.test/z.mp4');
  assert.equal(tiktokVideoUrlOf({}), null);
});

test('reintento sólo en 5xx; el aviso de borradores pendientes explica qué hacer', () => {
  for (const c of [500, 502, 503, 599]) assert.equal(chunkStatusRetryable(c), true);
  for (const c of [200, 206, 400, 403, 404, 416]) assert.equal(chunkStatusRetryable(c), false);
  assert.match(inboxInitErrorMessage('spam_risk_too_many_pending_share', ''), /5 borradores pendientes/);
  assert.equal(inboxInitErrorMessage('access_token_invalid', 'x'), 'TikTok init falló (access_token_invalid): x');
});

// ── 7 bis · Direct Post ──────────────────────────────────────────────────────────

const CREATOR = { privacyOptions: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'], commentDisabled: false, duetDisabled: true, stitchDisabled: false, maxVideoPostDurationSec: 600 };

test('el modo sale del dato: sin declarar es inbox; direct e inbox se leen; lo demás se dice', () => {
  assert.deepEqual(resolvePostMode(null), { ok: true, mode: 'inbox' });
  assert.deepEqual(resolvePostMode({}), { ok: true, mode: 'inbox' });
  assert.deepEqual(resolvePostMode({ post_mode: 'DIRECT' }), { ok: true, mode: 'direct' });
  assert.deepEqual(resolvePostMode({ post_mode: 'inbox' }), { ok: true, mode: 'inbox' });
  assert.equal(resolvePostMode({ post_mode: 'publicar' }).ok, false);
});

test('creator_info: opciones de privacidad y desactivados de la cuenta; sin opciones es fallo', () => {
  const r = readCreatorInfo({ error: { code: 'ok' }, data: { privacy_level_options: ['SELF_ONLY'], duet_disabled: true, max_video_post_duration_sec: 300 } });
  assert.ok(r.ok); assert.deepEqual(r.info.privacyOptions, ['SELF_ONLY']); assert.equal(r.info.duetDisabled, true); assert.equal(r.info.maxVideoPostDurationSec, 300);
  assert.equal(readCreatorInfo({ error: { code: 'ok' }, data: {} }).ok, false);
  assert.equal(readCreatorInfo({ error: { code: 'access_token_invalid' } }).code, 'access_token_invalid');
});

test('post_info: SELF_ONLY por defecto, manda la cuenta en los desactivados, is_aigc salvo false explícito', () => {
  const r = buildDirectPostInfo({ config: {}, creator: CREATOR, title: 'Hola' });
  assert.ok(r.ok);
  assert.deepEqual(r.postInfo, { title: 'Hola', privacy_level: 'SELF_ONLY', disable_comment: false, disable_duet: true, disable_stitch: false, is_aigc: true });
  assert.equal(buildDirectPostInfo({ config: { is_aigc: false, disable_comment: true }, creator: CREATOR, title: '' }).postInfo.disable_comment, true);
  assert.equal(buildDirectPostInfo({ config: { is_aigc: false }, creator: CREATOR, title: '' }).postInfo.is_aigc, false);
  assert.equal(buildDirectPostInfo({ config: { privacy_level: 'public_to_everyone' }, creator: CREATOR, title: '' }).postInfo.privacy_level, 'PUBLIC_TO_EVERYONE');
});

test('una privacidad que la cuenta no ofrece se dice; no se cambia por otra', () => {
  const r = buildDirectPostInfo({ config: { privacy_level: 'FOLLOWER_OF_CREATOR' }, creator: CREATOR, title: '' });
  assert.equal(r.ok, false); assert.match(r.error, /FOLLOWER_OF_CREATOR/);
});

test('el título se corta a 2200 unidades UTF-16 sin partir un emoji', () => {
  assert.equal(truncateUtf16('a'.repeat(2300), 2200).length, 2200);
  const conEmoji = 'a'.repeat(2199) + '😀';
  assert.equal(truncateUtf16(conEmoji, 2200), 'a'.repeat(2199));
  assert.equal(buildDirectPostInfo({ config: {}, creator: CREATOR, title: 'b'.repeat(3000) }).postInfo.title.length, 2200);
});

test('el init de Direct Post lleva post_info y el mismo source_info FILE_UPLOAD', () => {
  const b = buildDirectPostInitBody({ title: 't', privacy_level: 'SELF_ONLY', disable_comment: false, disable_duet: false, disable_stitch: false, is_aigc: true },
    { video_size: 100, chunk_size: 100, total_chunk_count: 1 });
  assert.equal(b.post_info.privacy_level, 'SELF_ONLY');
  assert.deepEqual(b.source_info, { source: 'FILE_UPLOAD', video_size: 100, chunk_size: 100, total_chunk_count: 1 });
});

// ── 8 · Cero marcas en el módulo ─────────────────────────────────────────────────

test('el módulo puro no nombra ninguna marca', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = readFileSync(join(root, 'api', '_tiktok.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').toLowerCase();
  for (const marca of ['unrealvillestudio', 'neuronescf', 'forumphs', 'luciensael', 'patriciaosorio', 'd7herbal']) {
    assert.ok(!src.includes(marca), `se nombra la marca «${marca}» fuera de un comentario`);
  }
});

console.log(`\n${passed} ok, ${failures.length} fail`);
if (failures.length > 0) process.exit(1);
