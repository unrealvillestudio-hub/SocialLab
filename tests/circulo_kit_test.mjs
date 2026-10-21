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
const { pedidoDoc } = await import(pathToFileURL(tmp).href);
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

test('vercel.json: el subdominio sólo sirve /guia, /crear y /operador, y el resto redirige a /guia', () => {
  const host = (r) => r.has?.[0]?.type === 'host' && r.has[0].value?.pre === 'circulo.';
  const reescritura = (vercel.rewrites ?? []).find(host);
  assert.equal(reescritura?.source, '/:doc(guia|crear|operador)');
  assert.equal(reescritura?.destination, '/api/circle-kit?doc=:doc');
  const redir = (vercel.redirects ?? []).filter(host);
  assert.deepEqual(redir.map((r) => [r.source, r.destination, r.permanent]), [
    ['/', '/guia', false],
    ['/:path((?!guia$|crear$|operador$|api/circle-kit$).+)', '/guia', false],
  ], 'la app de SocialLab nunca se sirve en el subdominio de una marca');
  assert.equal(vercel.functions?.['api/publish.ts']?.maxDuration, 300, 'las funciones de SocialLab no cambian');
});

test('el archivo no nombra ninguna marca', () => {
  assert.doesNotMatch(fuente.replace(/^\s*(\*|\/\/).*$/gm, ''), /forumphs|neurone|unrealville|lucien/i);
});

console.log(`\n${pass} ok, ${fails.length} fail`);
if (fails.length) process.exit(1);
