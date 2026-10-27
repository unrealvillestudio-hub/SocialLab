/**
 * Fase 6 (2026-10-26) — POST /api/adapt: la adaptación del carril como endpoint de SocialLab.
 *
 *   1 · autenticación: la clave de quien llama se prueba contra la base (lee ops_lab_models, que sólo lee el service_role);
 *       401/403 de la base → 401; sin Bearer, 401 sin llamar a nadie; modo desconocido, 400.
 *   2 · el modelo es el de ops_lab_models (sociallab/sync), leído con esa misma clave: otro, 409.
 *   3 · replay: no se llama a nadie; devuelve las peticiones que se habrían hecho, en orden, y el resultado.
 *   4 · el adaptador: la firma no entra al modelo, la regla de plataforma llega resuelta, un canal que no adapta no llama,
 *       el truncado se reintenta y, si vuelve a cortar, sale el texto de entrada declarado como degradado.
 *   5 · no escribe: ni scheduled_posts ni el libro; el núcleo generado declara su origen y no nombra marcas en código.
 *
 * Sin dependencias. Node >= 22.18 (type stripping).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://sb.prueba';
process.env.ANTHROPIC_API_KEY = 'ant-de-prueba';

let modeloEnBase = 'modelo-del-dato';
const peticionesDb = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://sb.prueba/rest/v1/')) {
    peticionesDb.push({ url: u, method: init?.method ?? 'GET', headers: init?.headers ?? {} });
    const apikey = init?.headers?.apikey;
    if (apikey === 'clave-autenticada') return { ok: false, status: 403, json: async () => ({}), text: async () => '{}' };
    if (apikey !== 'clave-de-prueba') return { ok: false, status: 401, json: async () => ({}), text: async () => '{}' };
    const filas = modeloEnBase ? [{ model_id: modeloEnBase }] : [];
    return { ok: true, status: 200, json: async () => filas, text: async () => JSON.stringify(filas) };
  }
  throw new Error(`red no simulada: ${u}`);
};

// El handler importa con `.js` (lo que resuelve Vercel); para Node se carga una copia con las rutas a los `.ts`.
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const API = fileURLToPath(new URL('../api/', import.meta.url));
function cargable(nombre) {
  const t = readFileSync(join(API, nombre), 'utf8').replace(/from '\.\/([A-Za-z_]+)\.js'/g, (_, m) => `from '${pathToFileURL(join(API, m + '.ts')).href}'`);
  const p = join(mkdtempSync(join(tmpdir(), 'adapt-')), nombre.replace(/\.ts$/, '.mts'));
  writeFileSync(p, t, 'utf8');
  return pathToFileURL(p).href;
}
const A = await import(cargable('adapt.ts'));
const H = A.default;

let fallos = 0;
async function test(nombre, fn) {
  const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try { await fn(); Object.assign(console, o); console.log(`  ok  ${nombre}`); }
  catch (e) { Object.assign(console, o); fallos++; console.error(`  FALLA  ${nombre}\n        ${e.message}`); }
}
function llamar(body, auth = 'Bearer clave-de-prueba') {
  return new Promise((resolve) => {
    const res = { code: 0, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    H({ method: 'POST', headers: { authorization: auth }, body }, res);
  });
}
const DIR = { directive: { language_code: 'es', label: 'Español', directive_block: 'Escribe en español neutro.', register_constraints: null }, source: 'table' };
const REGLAS = { canal_a: { key: 'CANAL_A', rule: 'máx 500 chars.', adapt: true }, canal_b: { key: 'CANAL_B', rule: '', adapt: false } };
const base = (extra = {}) => ({ builder_input: {
  modo: 'adaptar', modelo: 'modelo-del-dato', texto: 'Primera frase. Segunda frase.\n\nCierre con firma.\n— La Firma',
  plataformas: ['canal_a'], reglas: REGLAS, directiva: DIR, idioma: 'es', firma: '— La Firma', ...extra } });
const ok = (texto, stop = 'end_turn') => ({ status: 200, body: { content: [{ text: texto }], usage: { input_tokens: 100, output_tokens: 20 }, stop_reason: stop } });

await test('1 · la clave se prueba contra la base: 401/403 → 401; sin Bearer no llama; modo desconocido, 400', async () => {
  assert.equal((await llamar(base(), 'Bearer otra')).code, 401);
  assert.equal((await llamar(base(), 'Bearer clave-autenticada')).code, 401);
  const antes = peticionesDb.length;
  assert.equal((await llamar(base(), '')).code, 401);
  assert.equal((await llamar(base(), 'clave-de-prueba')).code, 401);
  assert.equal(peticionesDb.length, antes, 'sin Bearer no debe consultar la base');
  assert.equal((await llamar({ builder_input: { modo: 'otro' } })).code, 400);
  const ultima = peticionesDb[peticionesDb.length - 1];
  assert.deepEqual(Object.keys(ultima.headers), ['apikey'], 'una clave que no es JWT va sólo en apikey');
  await llamar(base(), 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.firma');
  const jwt = peticionesDb[peticionesDb.length - 1].headers;
  assert.equal(jwt.Authorization, 'Bearer ' + jwt.apikey, 'un JWT va también en Authorization');
  assert.ok(!/SUPABASE_SERVICE_ROLE_KEY/.test(readFileSync(new URL('../api/adapt.ts', import.meta.url), 'utf8')), 'no depende de una copia local de la clave');
});

await test('2 · el modelo es el de ops_lab_models: otro, 409', async () => {
  const r = await llamar({ ...base({ modelo: 'otro-modelo' }), replay: [] });
  assert.equal(r.code, 409); assert.match(r.body.error, /MODELO_DISTINTO/);
  assert.ok(peticionesDb.some((p) => /ops_lab_models\?select=model_id&lab=eq\.sociallab&role=eq\.sync&active=is\.true/.test(p.url)));
});

await test('3 · replay: sin red; devuelve las peticiones en orden y el resultado', async () => {
  const r = await llamar({ ...base(), replay: [ok('Texto adaptado. #Uno')] });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.llamadas.length, 1);
  const p = r.body.llamadas[0];
  assert.equal(p.model, 'modelo-del-dato');
  assert.match(p.messages[0].content, /^Adapta para CANAL_A:/);
  assert.ok(!p.messages[0].content.includes('— La Firma'), 'la firma entró al modelo');
  assert.match(p.system, /Escribe en español neutro\./);
  assert.equal(r.body.resultado.adapted[0].copy, 'Texto adaptado. #Uno');
  assert.equal(r.body.resultado.input_tokens, 100);
  assert.equal(r.body.replay_sin_usar, 0);
});

await test('4 · un canal que no adapta no llama; el truncado se reintenta y, si vuelve a cortar, sale degradado', async () => {
  const sinAdaptar = await llamar({ ...base({ plataformas: ['canal_b'] }), replay: [] });
  assert.equal(sinAdaptar.code, 200, JSON.stringify(sinAdaptar.body));
  assert.equal(sinAdaptar.body.llamadas.length, 0);
  const cortado = await llamar({ ...base(), replay: [ok('Corta', 'max_tokens'), ok('Corta otra', 'max_tokens')] });
  assert.equal(cortado.code, 200, JSON.stringify(cortado.body));
  assert.equal(cortado.body.llamadas.length, 2);
  assert.ok(cortado.body.llamadas[1].max_tokens > cortado.body.llamadas[0].max_tokens, 'el reintento no sube el techo');
  assert.equal(cortado.body.resultado.ceilings[0].degraded, true);
  assert.ok(!cortado.body.resultado.adapted[0].copy.includes('Corta'));
});

await test('4b · sin directiva de idioma no corre: 422 con el motivo', async () => {
  const r = await llamar({ ...base({ directiva: { directive: null, source: 'no_row' } }), replay: [] });
  assert.equal(r.code, 422); assert.match(r.body.error, /ADAPT_LANGUAGE_DIRECTIVE_MISSING/);
});

await test('4c · una plataforma sin su regla resuelta es 400, no un default', async () => {
  const r = await llamar({ ...base({ plataformas: ['canal_c'] }), replay: [] });
  assert.equal(r.code, 400); assert.match(r.body.error, /falta la regla resuelta de 'canal_c'/);
});

await test('4d · modo titulo: sólo título y gancho del canal', async () => {
  const r = await llamar({ builder_input: { modo: 'titulo', modelo: 'modelo-del-dato', titulo_canal: {
    platform: 'canal_a', ruleKey: 'CANAL_A', rule: 'máx 500 chars.', adapt: true, masterTitle: 'Un título', masterHook: 'Un gancho', languageDirective: DIR.directive } },
    replay: [ok('TITULO: Título del canal\nIMAGEN: Gancho del canal')] });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.resultado.title, 'Título del canal');
  assert.equal(r.body.resultado.image_hook, 'Gancho del canal');
});

await test('5 · no escribe; el núcleo declara su origen y no nombra marcas en código', async () => {
  assert.ok(peticionesDb.every((p) => p.method === 'GET'), 'el endpoint escribió en la base');
  const src = readFileSync(new URL('../api/adapt.ts', import.meta.url), 'utf8');
  assert.ok(!/scheduled_posts'|ops_generation_ledger|method: 'POST'/.test(src.replace(/^\s*(\/\/|\*).*$/gm, '')));
  const core = readFileSync(new URL('../api/_adaptCore.ts', import.meta.url), 'utf8');
  // Fase 6c (2026-10-27): el núcleo es la FUENTE y declara de dónde vino.
  assert.match(core, /^\/\/ FUENTE del adaptador de SocialLab desde la Fase 6c/m);
  assert.match(core, /^\/\/ Origen de la copia: unrlvl-iid-functions@[0-9a-f]{7,}/m);
  const codigo = core.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/NeuroneSCF|ForumPHs|FORUMPHS|Unrealville|UNRLVL|LucienSael|PROPIETARIOS/.test(codigo), 'una marca escrita en código');
  assert.ok(!/resolvePlatformRule\(|fetchAdapterLanguageDirective\(|PLATFORM_RULES/.test(codigo), 'el núcleo resuelve lo que debe llegar resuelto');
});

console.log(fallos ? `\nadapt_test: ${fallos} fallo(s)` : '\nadapt_test: OK');
process.exit(fallos ? 1 : 0);
