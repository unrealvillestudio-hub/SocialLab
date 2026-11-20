/**
 * SocialLab — EL OAUTH SÓLO SE INICIA PARA UNA MARCA CON CANAL DE ESE PROVEEDOR (2026-11-20).
 *
 * Ejecutar:  npm test   (o `node tests/oauth_marca_con_canal_test.mjs`)
 *
 * El 2026-11-20 quedó una fila de token huérfana: el OAuth de TikTok se abrió con el `brand_id` en minúsculas y
 * el endpoint lo aceptó sin comprobarlo (medido). Sam: «Corrige la causa». Se cargan `api/tiktok-oauth.ts` y
 * `api/linkedin-oauth.ts` TAL CUAL, con el almacén sustituido por uno en memoria, y se fija:
 *   · con canal del proveedor y el `brand_id` exacto → 302 al authorize, preguntando por ese proveedor;
 *   · sin canal (marca mal escrita o sin ese canal) → 404 con el motivo, SIN redirigir;
 *   · la base caída → 503, sin redirigir.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'oauth-canal-'));
for (const f of ['_oauthState.ts', '_tiktok.ts', '_linkedin.ts']) copyFileSync(join(ROOT, 'api', f), join(dir, f));
writeFileSync(join(dir, '_socialTokens.ts'), `
export interface SocialTokenRow { [k: string]: any }
export async function getPublishChannelConfig(brandId: string, providerPlatform: string) {
  (globalThis as any).__consultas.push({ brandId, providerPlatform });
  if ((globalThis as any).__baseCaida) throw new Error('lectura de intel.brand_publish_channels falló: HTTP 500');
  return (globalThis as any).__canales[providerPlatform + '|' + brandId] ?? null;
}
export async function upsertSocialToken() { return true; }
export function msToIso(ms: number) { return new Date(ms).toISOString(); }
`);
writeFileSync(join(dir, '_tiktokApi.ts'), `export async function exchangeCode() { throw new Error('no'); }\nexport async function storeToken() {}\n`);
const reescribir = (src) => src.replace(/from '\.\/(_[A-Za-z]+)\.js'/g, "from './$1.ts'");
for (const f of ['tiktok-oauth.ts', 'linkedin-oauth.ts']) writeFileSync(join(dir, f), reescribir(readFileSync(join(ROOT, 'api', f), 'utf8')));
for (const f of ['_oauthState.ts', '_tiktok.ts', '_linkedin.ts']) writeFileSync(join(dir, f), reescribir(readFileSync(join(dir, f), 'utf8')));

Object.assign(process.env, {
  TIKTOK_CLIENT_KEY: 'ck', TIKTOK_CLIENT_SECRET: 'cs', TIKTOK_REDIRECT_URI: 'https://app.test/api/tiktok-oauth',
  LINKEDIN_CLIENT_ID: 'li', LINKEDIN_CLIENT_SECRET: 'ls', LINKEDIN_REDIRECT_URI: 'https://app.test/api/linkedin-oauth',
});
const tiktok = (await import(pathToFileURL(join(dir, 'tiktok-oauth.ts')).href)).default;
const linkedin = (await import(pathToFileURL(join(dir, 'linkedin-oauth.ts')).href)).default;

function resFalso() {
  const r = { statusCode: 0, headers: {}, body: '' };
  r.status = (c) => { r.statusCode = c; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.end = () => r;
  return r;
}
async function llamar(h, brand_id) {
  const res = resFalso();
  await h({ method: 'GET', query: { brand_id } }, res);
  return res;
}

let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push(name); console.log(`FAIL  ${name}\n      ${err.message}`); }
}
const preparar = (canales, baseCaida = false) => { globalThis.__canales = canales; globalThis.__consultas = []; globalThis.__baseCaida = baseCaida; };

for (const [nombre, h, pp, host] of [['TikTok', tiktok, 'TIKTOK', 'www.tiktok.com'], ['LinkedIn', linkedin, 'LINKEDIN', 'www.linkedin.com']]) {
  await test(`${nombre}: marca con canal y brand_id exacto → 302 al authorize`, async () => {
    preparar({ [`${pp}|MarcaPrueba`]: { provider_platform: pp } });
    const r = await llamar(h, 'MarcaPrueba');
    assert.equal(r.statusCode, 302); assert.equal(new URL(r.headers.location).host, host);
    assert.deepEqual(globalThis.__consultas, [{ brandId: 'MarcaPrueba', providerPlatform: pp }]);
  });
  await test(`${nombre}: otras mayúsculas o sin canal → 404 con motivo, sin redirigir`, async () => {
    preparar({ [`${pp}|MarcaPrueba`]: { provider_platform: pp } });
    for (const b of ['marcaprueba', 'OtraMarca']) {
      const r = await llamar(h, b);
      assert.equal(r.statusCode, 404, b); assert.ok(!r.headers.location, b); assert.match(r.body, /no tiene un canal/);
    }
  });
  await test(`${nombre}: la base no responde → 503, sin redirigir`, async () => {
    preparar({}, true);
    const r = await llamar(h, 'MarcaPrueba');
    assert.equal(r.statusCode, 503); assert.ok(!r.headers.location);
  });
}

await test('el motivo no refleja HTML del brand_id', async () => {
  preparar({});
  const r = await llamar(tiktok, '<script>x</script>');
  assert.equal(r.statusCode, 404); assert.ok(!r.body.includes('<script>'));
});

console.log(`\n${passed} ok, ${failures.length} fail`);
if (failures.length) process.exit(1);
