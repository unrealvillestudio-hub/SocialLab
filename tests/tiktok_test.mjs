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
  TIKTOK_AUTHORIZE_URL, TIKTOK_SCOPES_INBOX,
  buildAuthorizeUrl,
  parseTokenResponse, isAccessTokenExpired,
  buildInboxInitBody, readInboxInitResult, readStatusResult,
  tiktokVideoUrlOf, videoUrlHostAllowed,
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
    scope: TIKTOK_SCOPES_INBOX, state: 's.m',
  });
  assert.ok(url.startsWith(TIKTOK_AUTHORIZE_URL), 'base distinta del authorize oficial');
  const u = new URL(url);
  assert.equal(u.searchParams.get('client_key'), 'ck_test');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('scope'), 'user.info.basic,video.upload');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://x.test/api/tiktok-oauth');
  assert.equal(u.searchParams.get('state'), 's.m');
});

test('los scopes son la vía exenta: upload sí, publish NO', () => {
  assert.deepEqual([...TIKTOK_SCOPES_INBOX], ['user.info.basic', 'video.upload']);
  assert.ok(!TIKTOK_SCOPES_INBOX.includes('video.publish'), 'video.publish exige auditoría, no va aquí');
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
    access_token: 'at', refresh_token: 'rt', open_id: 'oid', scope: 'user.info.basic,video.upload',
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

// ── 5 · Inbox init (PULL_FROM_URL) ───────────────────────────────────────────────

test('el cuerpo del init es PULL_FROM_URL con la URL del video', () => {
  assert.deepEqual(buildInboxInitBody('https://v.test/x.mp4'),
    { source_info: { source: 'PULL_FROM_URL', video_url: 'https://v.test/x.mp4' } });
});

test('error.code=ok con publish_id es el único éxito', () => {
  const r = readInboxInitResult(json({ data: { publish_id: 'v_inbox_file~v2.1' }, error: { code: 'ok' } }));
  assert.ok(r.ok);
  assert.equal(r.publishId, 'v_inbox_file~v2.1');
});

test('un error.code distinto de ok es fallo DICHO con su código', () => {
  const r = readInboxInitResult(json({ error: { code: 'url_ownership_unverified', message: 'verify domain' } }));
  assert.ok(!r.ok);
  assert.equal(r.code, 'url_ownership_unverified');
  assert.match(r.message, /verify domain/);
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

test('el host verificado se comprueba; lista vacía no bloquea', () => {
  assert.equal(videoUrlHostAllowed('https://cdn.unrealvillestudio.com/a.mp4', ['unrealvillestudio.com']), true);
  assert.equal(videoUrlHostAllowed('https://evil.test/a.mp4', ['unrealvillestudio.com']), false);
  assert.equal(videoUrlHostAllowed('https://cualquier.host/a.mp4', []), true);
  assert.equal(videoUrlHostAllowed('no-es-url', ['unrealvillestudio.com']), false);
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
