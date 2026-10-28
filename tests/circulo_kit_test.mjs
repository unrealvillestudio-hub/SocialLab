/**
 * SocialLab — EL CÍRCULO: el subdominio de una marca sólo sirve sus documentos, y sólo una llave bien
 * formada llega a la EF.
 *
 * Ejecutar:  npm test   (o `node tests/circulo_kit_test.mjs`)
 * Sin dependencias. Requiere Node >= 22.18 (type stripping nativo): importa el bloque puro de
 * `api/circle-kit.ts` entre `CIRCULO-KIT:BEGIN` y `CIRCULO-KIT:END`, y lee el `vercel.json` real.
 *
 * Los hosts y tokens de las fixturas son sintéticos.
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fuente = readFileSync(join(ROOT, 'api', 'circle-kit.ts'), 'utf8');
const i = fuente.indexOf('// ── CIRCULO-KIT:BEGIN ──');
const j = fuente.indexOf('// ── CIRCULO-KIT:END ──');
assert.ok(i >= 0 && j > i, 'sentinelas CIRCULO-KIT no encontrados en api/circle-kit.ts');
const tmp = join(mkdtempSync(join(tmpdir(), 'circulo-kit-')), 'kit.mts');
writeFileSync(tmp, fuente.slice(i, j), 'utf8');
const { pedidoDoc, claseDeVisita, metodoDe, imagenPermitida } = await import(pathToFileURL(tmp).href);
const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));

let pass = 0; const fails = [];
function test(nombre, fn) {
  try { fn(); pass++; console.log(`  ok   ${nombre}`); }
  catch (e) { fails.push(nombre); console.log(`  FAIL ${nombre}\n       ${e.message}`); }
}

const TOKEN = 'a'.repeat(36);

test('el subdominio de la marca es la llave: pide el documento por host', () => {
  assert.deepEqual(pedidoDoc({ doc: 'guia' }, 'circulo.marca-ejemplo.com'), { mode: 'doc', host: 'circulo.marca-ejemplo.com', doc: 'guia' });
  assert.deepEqual(pedidoDoc({ doc: 'crear' }, 'CIRCULO.Marca.co.uk:443'), { mode: 'doc', host: 'circulo.marca.co.uk', doc: 'crear' });
  assert.deepEqual(pedidoDoc({}, 'circulo.marca.com, proxy.interno'), { mode: 'doc', host: 'circulo.marca.com', doc: 'guia' }, 'sin doc, la guía');
});

test('sin subdominio, el token de 36 hex; el enlace viejo del kit sigue valiendo', () => {
  assert.deepEqual(pedidoDoc({ t: TOKEN, doc: 'kit' }, 'social-lab.vercel.app'), { mode: 'doc', token: TOKEN, doc: 'kit' });
});

test('una llave mal formada no llega a la EF', () => {
  for (const [q, h] of [
    [{ doc: 'guia' }, 'social-lab.vercel.app'],         // ni subdominio del Círculo ni token
    [{ t: 'x'.repeat(36), doc: 'guia' }, ''],             // token que no es hex
    [{ t: TOKEN + "'", doc: 'guia' }, ''],
    [{ doc: 'otro' }, 'circulo.marca.com'],               // documento que no existe
    [{ doc: 'guia' }, 'circulo.marca.com/../x'],
    [{ doc: 'guia' }, 'circulo.'],
  ]) assert.equal(pedidoDoc(q, h), null, JSON.stringify([q, h]));
});

const ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';

test('la tarjeta de un envío: un id de uuid, con el host del Círculo si lo hay', () => {
  assert.deepEqual(pedidoDoc({ p: ID }, 'circulo.marca-ejemplo.com'), { mode: 'card', id: ID, host: 'circulo.marca-ejemplo.com' });
  assert.deepEqual(pedidoDoc({ p: ID.toUpperCase() }, 'social-lab.vercel.app'), { mode: 'card', id: ID }, 'sin subdominio, sólo el id');
  for (const p of ['', 'x', ID + 'a', ID.replace(/-/g, ''), `${ID}' or 1=1`]) {
    assert.equal(pedidoDoc({ p }, 'circulo.marca.com'), null, JSON.stringify(p));
  }
});

test('vercel.json: el subdominio sólo sirve /guia, /crear, /operador, /p/<id>, /p/<id>/toque y /p/<id>/imagen, y el resto redirige a /guia', () => {
  const host = (r) => r.has?.[0]?.type === 'host' && r.has[0].value?.pre === 'circulo.';
  const reescrituras = (vercel.rewrites ?? []).filter(host).map((r) => [r.source, r.destination]);
  assert.deepEqual(reescrituras, [
    ['/:doc(guia|crear|operador)', '/api/circle-kit?doc=:doc'],
    ['/p/:id([0-9a-f-]{36})/imagen', '/api/circle-kit?p=:id&imagen=1'],
    ['/p/:id([0-9a-f-]{36})/toque', '/api/circle-kit?p=:id&toque=1'],
    ['/p/:id([0-9a-f-]{36})', '/api/circle-kit?p=:id'],
  ]);
  const redir = (vercel.redirects ?? []).filter(host);
  assert.deepEqual(redir.map((r) => [r.source, r.destination, r.permanent]), [
    ['/', '/guia', false],
    ['/:path((?!guia$|crear$|operador$|api/circle-kit$|p/[0-9a-f-]{36}$|p/[0-9a-f-]{36}/toque$|p/[0-9a-f-]{36}/imagen$).+)', '/guia', false],
  ], 'la app de SocialLab nunca se sirve en el subdominio de una marca');
  assert.equal(vercel.functions?.['api/publish.ts']?.maxDuration, 300, 'las funciones de SocialLab no cambian');
});

test('el toque al botón de la tarjeta: sólo con toque=1, y llega por POST', () => {
  assert.deepEqual(pedidoDoc({ p: ID, toque: '1' }, 'circulo.marca.com'), { mode: 'card_tap', id: ID, host: 'circulo.marca.com' });
  assert.deepEqual(pedidoDoc({ p: ID, toque: '1' }, 'social-lab.vercel.app'), { mode: 'card_tap', id: ID });
  assert.equal(pedidoDoc({ p: ID, toque: 'si' }, 'circulo.marca.com'), null);
  assert.equal(metodoDe('card_tap'), 'POST');
  assert.equal(metodoDe('card'), 'GET');
  assert.equal(metodoDe('doc'), 'GET');
});

test('el tipo de visita: el lector de vistas previas aparte, y del navegador no sale nada más', () => {
  assert.equal(claseDeVisita('WhatsApp/2.24.21.80 i'), 'preview');
  assert.equal(claseDeVisita('WhatsApp/2.24.21.80 A'), 'preview');
  assert.equal(claseDeVisita('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'), 'preview');
  assert.equal(claseDeVisita('TelegramBot (like TwitterBot)'), 'preview');
  assert.equal(claseDeVisita('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'), 'ios');
  assert.equal(claseDeVisita('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) [FBAN/FBIOS;FBAV/480.0]'), 'ios', 'el navegador de Facebook en iPhone es una persona');
  assert.equal(claseDeVisita('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36'), 'android');
  assert.equal(claseDeVisita('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'other');
  assert.equal(claseDeVisita(undefined), 'other');
  assert.match(fuente, /visita: claseDeVisita\(req\.headers\['user-agent'\]\)/, 'a la EF va la clase, no el navegador');
  assert.doesNotMatch(fuente.replace(/^\s*(\*|\/\/).*$/gm, ''), /user-agent'\]\s*[,}]|ua:\s*req/, 'el navegador no viaja a la EF');
});

test('la imagen liviana: sólo con imagen=1, por GET, y sólo de nuestro Storage', () => {
  assert.deepEqual(pedidoDoc({ p: ID, imagen: '1' }, 'circulo.marca.com'), { mode: 'card_image', id: ID, host: 'circulo.marca.com' });
  assert.equal(pedidoDoc({ p: ID, imagen: 'x' }, 'circulo.marca.com'), null);
  assert.equal(pedidoDoc({ p: ID, imagen: '1', toque: '1' }, 'circulo.marca.com'), null, 'una cosa o la otra');
  assert.equal(metodoDe('card_image'), 'GET');
  const SBU = 'https://proyecto.supabase.co';
  assert.ok(imagenPermitida(`${SBU}/storage/v1/render/image/public/m/a.png?width=720&resize=contain&quality=75`, SBU));
  assert.ok(imagenPermitida(`${SBU}/storage/v1/render/image/public/m/a.png`, `${SBU}/`));
  for (const u of [`${SBU}/storage/v1/object/public/m/a.png`, 'https://otro.example/storage/v1/render/image/public/a.png',
    `${SBU}/storage/v1/render/image/public/a.png" onerror="x`, null, 42]) assert.equal(imagenPermitida(u, SBU), false, String(u));
  assert.match(fuente, /fetch\(data\.url, \{ headers: \{ Accept: 'image\/webp' \} \}\)/, 'se pide en webp');
});

test('el archivo no nombra ninguna marca', () => {
  assert.doesNotMatch(fuente.replace(/^\s*(\*|\/\/).*$/gm, ''), /forumphs|neurone|unrealville|lucien/i);
});

console.log(`\n${pass} ok, ${fails.length} fail`);
if (fails.length) process.exit(1);
