/**
 * SocialLab — GET /api/tiktok-media, EL ENDPOINT DE IMÁGENES PARA TIKTOK (2026-11-20).
 *
 * Ejecutar:  npm test   (o `node tests/tiktok_media_test.mjs`)
 *
 * TikTok descarga las fotos desde el dominio verificado (Sam: `media.unrealvillestudio.com`, que apunta a este
 * proyecto). Se carga `api/tiktok-media.ts` TAL CUAL, con `fetch` simulado como almacenamiento, y se fija:
 *   · sólo sirve objetos públicos de NUESTRO almacenamiento, con bucket y ruta validados (no es un proxy abierto);
 *   · pide la transformación (WebP, ≤1080 px) y la entrega con 200, sin redirect, con su Content-Type;
 *   · un origen que no devuelve WebP/JPEG no se reenvía.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'api', 'tiktok-media.ts'), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'tiktok-media-'));
copyFileSync(join(ROOT, 'api', '_tiktok.ts'), join(dir, '_tiktok.ts'));
writeFileSync(join(dir, 'tiktok-media.ts'), SRC.replace("from './_tiktok.js'", "from './_tiktok.ts'"));
const { default: handler } = await import(pathToFileURL(join(dir, 'tiktok-media.ts')).href);

process.env.SUPABASE_URL = 'https://proyecto.supabase.co';
let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err.message}`); }
}
function resFalso() {
  const r = { statusCode: 0, headers: {}, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  return r;
}
let pedidas = [];
function origen(status, tipo, bytes = 7) {
  pedidas = [];
  globalThis.fetch = async (url, init = {}) => {
    pedidas.push({ url: String(url), accept: init.headers?.Accept });
    return new Response(new Uint8Array(bytes), { status, headers: { 'content-type': tipo } });
  };
}

await test('sirve la transformación WebP del objeto, con 200 y sin redirect', async () => {
  origen(200, 'image/webp', 1234);
  const res = resFalso();
  await handler({ method: 'GET', query: { o: 'medios/permanent/m/foto.png' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/webp');
  assert.equal(res.headers['content-length'], '1234');
  assert.ok(!('location' in res.headers));
  assert.equal(pedidas[0].url, 'https://proyecto.supabase.co/storage/v1/render/image/public/medios/permanent/m/foto.png?width=1080&resize=contain&quality=90');
  assert.equal(pedidas[0].accept, 'image/webp');
});

await test('no es un proxy abierto: parámetros inválidos dan 400 sin llamar a nada', async () => {
  for (const o of [undefined, '', 'medios', 'medios/../x', 'https://otro.test/x.png', 'medios/a b.png']) {
    origen(200, 'image/webp');
    const res = resFalso();
    await handler({ method: 'GET', query: { o } }, res);
    assert.equal(res.statusCode, 400, String(o)); assert.equal(pedidas.length, 0, String(o));
  }
});

await test('un origen que no devuelve WebP/JPEG no se reenvía; un 404 se dice 404', async () => {
  origen(200, 'image/png');
  let res = resFalso(); await handler({ method: 'GET', query: { o: 'medios/a.png' } }, res);
  assert.equal(res.statusCode, 502);
  origen(404, 'application/json');
  res = resFalso(); await handler({ method: 'GET', query: { o: 'medios/a.png' } }, res);
  assert.equal(res.statusCode, 404);
});

await test('sólo GET y HEAD; sin SUPABASE_URL, 503', async () => {
  let res = resFalso(); await handler({ method: 'POST', query: {} }, res); assert.equal(res.statusCode, 405);
  const antes = process.env.SUPABASE_URL; delete process.env.SUPABASE_URL;
  res = resFalso(); await handler({ method: 'GET', query: { o: 'medios/a.png' } }, res); assert.equal(res.statusCode, 503);
  process.env.SUPABASE_URL = antes;
});

console.log(`\n${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
