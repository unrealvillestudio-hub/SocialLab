/**
 * APP INSTALABLE (Sam, 2026-11-17: «SocialLab también ya como app … perfectamente funcional tanto para desktop como
 * para móviles, incluyendo iPhone»).
 *
 * Cubre lo que hace instalable a SocialLab y lo que no puede romperse sin que nadie lo note:
 *   · el manifiesto declara lo que Chrome, Android e iPhone piden, y sus íconos existen con el tamaño que dicen;
 *   · `index.html` enlaza manifiesto e ícono de iPhone, y `main.tsx` registra el service worker;
 *   · el service worker NUNCA guarda `/api/*` ni nada de otro origen (un dato viejo como actual es peor que un error);
 *   · la sesión guardada caduca, se borra al salir y no sobrevive a un valor dañado (`src/sesionGuardada.ts`);
 *   · ni el manifiesto ni el service worker nombran una marca: la app es del sistema.
 *
 * Sin dependencias. Requiere Node >= 22.18 (type stripping nativo).
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardarSesion, leerSesion, borrarSesion, CLAVE_SESION, MARGEN_CADUCIDAD_MS } from '../src/sesionGuardada.ts';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (r) => readFileSync(join(RAIZ, r), 'utf8');
let fallos = 0;
function test(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  FALLA  ${nombre}\n        ${e.message}`); }
}

/** Ancho y alto de un PNG, leídos de su cabecera IHDR. */
function ladoPng(ruta) {
  const b = readFileSync(join(RAIZ, 'public', ruta));
  assert.equal(b.toString('ascii', 1, 4), 'PNG', `${ruta} no es PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const manifiesto = JSON.parse(leer('public/manifest.webmanifest'));

test('el manifiesto declara lo que exige la instalación', () => {
  assert.equal(manifiesto.display, 'standalone');
  assert.equal(manifiesto.start_url, '/');
  assert.equal(manifiesto.scope, '/');
  assert.ok(manifiesto.name && manifiesto.short_name, 'falta name o short_name');
  assert.match(manifiesto.theme_color, /^#[0-9a-fA-F]{6}$/);
  assert.match(manifiesto.background_color, /^#[0-9a-fA-F]{6}$/);
});

test('íconos de 192, 512 y adaptable, con el tamaño que declaran', () => {
  const tamanos = new Set();
  for (const i of manifiesto.icons) {
    assert.ok(existsSync(join(RAIZ, 'public', i.src)), `no existe public${i.src}`);
    const [w, h] = ladoPng(i.src);
    assert.equal(`${w}x${h}`, i.sizes, `${i.src} mide ${w}x${h} y declara ${i.sizes}`);
    tamanos.add(`${i.sizes}:${i.purpose}`);
  }
  for (const t of ['192x192:any', '512x512:any', '512x512:maskable']) assert.ok(tamanos.has(t), `falta el ícono ${t}`);
});

test('index.html enlaza manifiesto, ícono de iPhone y metas de app', () => {
  const html = leer('index.html');
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
  const m = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/);
  assert.ok(m, 'falta apple-touch-icon');
  assert.deepEqual(ladoPng(m[1]), [180, 180]);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /viewport-fit=cover/);
});

test('main.tsx registra el service worker', () => {
  assert.match(leer('src/main.tsx'), /serviceWorker\.register\('\/sw\.js'\)/);
});

test('el service worker no guarda la API ni otros orígenes', () => {
  const sw = leer('public/sw.js');
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)\) return;/, 'debe dejar pasar /api/* sin tocarlo');
  assert.match(sw, /url\.origin !== self\.location\.origin\) return;/, 'debe dejar pasar otros orígenes sin tocarlos');
  assert.match(sw, /req\.method !== 'GET'\) return;/, 'sólo GET');
  // Lo único que se guarda: la página (para abrir sin conexión) y los archivos con hash.
  const puts = [...sw.matchAll(/c\.put\(([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(puts.sort(), ["'/'", 'req']);
});

test('ni el manifiesto ni el service worker nombran una marca', () => {
  const MARCAS = /NeuroneSCF|ForumPHs|LucienSael|SamPublisher|D7Herbal|VivoseMask|VizosCosmetics|DiamondDetails|PatriciaOsorio/i;
  for (const r of ['public/manifest.webmanifest', 'public/sw.js', 'src/sesionGuardada.ts']) assert.doesNotMatch(leer(r), MARCAS, r);
});

/** Almacén en memoria con la misma forma que localStorage. */
function almacen() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const SESION = { session_token: 'tok', sub: 'operadora', role: 'operator', brand_scope: ['*'], expires_in: 3600 };

test('la sesión guardada vuelve mientras está vigente', () => {
  const a = almacen();
  guardarSesion(SESION, 1_000, a);
  assert.deepEqual(leerSesion(1_000 + 3600_000 - MARGEN_CADUCIDAD_MS - 1, a), SESION);
});

test('la sesión caducada no vuelve y se borra', () => {
  const a = almacen();
  guardarSesion(SESION, 1_000, a);
  assert.equal(leerSesion(1_000 + 3600_000 - MARGEN_CADUCIDAD_MS, a), null);
  assert.equal(a.m.has(CLAVE_SESION), false);
});

test('«Salir» la borra', () => {
  const a = almacen();
  guardarSesion(SESION, 1_000, a);
  borrarSesion(a);
  assert.equal(leerSesion(1_000, a), null);
});

test('un valor dañado o sin caducidad no abre sesión', () => {
  const a = almacen();
  a.setItem(CLAVE_SESION, '{no es json');
  assert.equal(leerSesion(0, a), null);
  guardarSesion({ ...SESION, expires_in: 0 }, 0, a);
  assert.equal(a.m.has(CLAVE_SESION), false, 'una sesión sin caducidad no se guarda');
});

test('App.tsx usa la sesión guardada y la borra al salir', () => {
  const app = leer('src/App.tsx');
  assert.match(app, /useState<Sesion \| null>\(\(\) => leerSesion\(\)\)/);
  assert.match(app, /const salir = \(\) => \{ borrarSesion\(\); setSesion\(null\); \}/);
});

if (fallos) { console.error(`\n${fallos} test(s) en rojo`); process.exit(1); }
console.log('\napp instalable: todo en verde');
