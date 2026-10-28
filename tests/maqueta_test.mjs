/**
 * MAQUETAS POR PLATAFORMA (Sam, 2026-10-27: «una simulación real de cada plataforma, que se active en la tarjeta según
 * la plataforma que se proyecte en cada tarjeta, no un botón más»).
 *
 * Cubre `src/maqueta.ts` (qué maqueta usa cada publicación) y que la regla viene del dato: el catálogo la lee de
 * `intel.platform_previews` y ningún archivo de la maqueta nombra una plataforma.
 *
 * Sin dependencias. Requiere Node >= 22.18 (type stripping nativo).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cuentaDe, maquetaDe, registrarMaquetas } from '../src/maqueta.ts';

let fallos = 0;
function test(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  FALLA  ${nombre}\n        ${e.message}`); }
}
const REGLAS = [
  { platform: 'P1', media_format: null, layout: 'feed_imagen', aspect: 'natural' },
  { platform: 'P1', media_format: 'REELS', layout: 'vertical', aspect: '9:16' },
  { platform: 'P2', media_format: null, layout: 'feed_texto', aspect: 'natural' },
];

test('la regla del formato manda sobre la de la plataforma; sin ninguna, null', () => {
  assert.deepEqual(maquetaDe('P1', 'SINGLE_IMAGE', REGLAS), { layout: 'feed_imagen', aspect: 'natural' });
  assert.deepEqual(maquetaDe('P1', 'REELS', REGLAS), { layout: 'vertical', aspect: '9:16' });
  assert.deepEqual(maquetaDe('P2', 'REELS', REGLAS), { layout: 'feed_texto', aspect: 'natural' });
  assert.equal(maquetaDe('P3', null, REGLAS), null, 'una plataforma sin maqueta se ve como antes');
  assert.equal(maquetaDe(null, null, REGLAS), null);
});
test('las reglas registradas con el catálogo son las que usa la tarjeta', () => {
  registrarMaquetas(REGLAS);
  assert.deepEqual(maquetaDe('P1', 'REELS'), { layout: 'vertical', aspect: '9:16' });
  registrarMaquetas(undefined);
  assert.equal(maquetaDe('P1', 'REELS'), null, 'sin catálogo, sin maqueta');
});
test('el catálogo lee la tabla y degrada sin ella; ni la regla ni el componente nombran plataformas', () => {
  const OPS = readFileSync(new URL('../api/ops.ts', import.meta.url), 'utf8');
  assert.match(OPS, /platform_previews\?select=platform,media_format,layout,aspect&active=is\.true/);
  assert.match(OPS, /maquetas de plataforma sin leer/);
  for (const f of ['../src/maqueta.ts', '../src/ui/Maqueta.tsx']) {
    const codigo = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(codigo, /INSTAGRAM|FACEBOOK|LINKEDIN|TIKTOK|'X'|BLOG/, `${f} nombra una plataforma`);
  }
});
test('las tarjetas se dibujan con la maqueta, sin botón: Publicado y Acciones', () => {
  for (const f of ['../src/views/Publicado.tsx', '../src/views/Acciones.tsx']) {
    const v = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.match(v, /<Maqueta platform=/, f);
    assert.match(v, /maquetaDe\(/, f);
  }
});

const PERFILES = [
  { brand_id: 'B', platform: 'P2', username: 'b.texto', display_name: 'B Texto', picture_url: 'https://x/p2.jpg' },
  { brand_id: 'B', platform: 'P1', username: 'b.foto', display_name: 'B', picture_url: 'https://x/p1.jpg' },
  { brand_id: 'C', platform: 'P2', username: null, display_name: 'C Nombre', picture_url: null },
];
test('cuentaDe: el perfil propio de la plataforma; si no hay, el de la red donde la foto manda; si no, la marca', () => {
  assert.deepEqual(cuentaDe('B', 'P2', 'Marca B', PERFILES, REGLAS), { cuenta: 'b.texto', foto: 'https://x/p2.jpg' }, 'propio');
  assert.deepEqual(cuentaDe('B', 'P9', 'Marca B', PERFILES, REGLAS), { cuenta: 'b.foto', foto: 'https://x/p1.jpg' }, 'sin perfil: el de feed_imagen');
  assert.deepEqual(cuentaDe('C', 'P2', 'Marca C', PERFILES, REGLAS), { cuenta: 'C Nombre', foto: null }, 'sin usuario: el nombre');
  assert.deepEqual(cuentaDe('Z', 'P1', 'Marca Z', PERFILES, REGLAS), { cuenta: 'Marca Z', foto: null }, 'sin perfiles: como antes');
});
test('los perfiles vienen del dato: el catálogo lee intel.account_profiles y las tarjetas usan cuentaDe', () => {
  const ops = readFileSync(new URL('../api/ops.ts', import.meta.url), 'utf8');
  assert.match(ops, /account_profiles\?select=brand_id,platform,username,display_name,picture_url/);
  for (const f of ['../src/views/Publicado.tsx', '../src/views/Acciones.tsx']) {
    assert.match(readFileSync(new URL(f, import.meta.url), 'utf8'), /\.\.\.cuentaDe\(/, f);
  }
});

test('el catálogo (con los perfiles) se relee solo: cada pocos minutos y al volver a la pestaña', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /setInterval\(\(\) => leer\(false\), CATALOGO_RELECTURA_MS\)/);
  assert.match(app, /addEventListener\('visibilitychange'/);
  assert.match(app, /registrarPerfiles\(c\.perfiles\)/);
});

console.log(fallos ? `\n${fallos} falla(s)` : '\nTodo verde.');
if (fallos) process.exit(1);
