/**
 * SocialLab — NO SE PUBLICA UN CONTENEDOR QUE NO ESTA LISTO.
 *
 * Ejecutar:  npm test   (o `node tests/contenedor_9007_test.mjs`)
 * Sin dependencias. Requiere Node >= 22.18, que hace type stripping nativo y permite importar el
 * bloque puro de `api/publish.ts` sin toolchain.
 *
 * ── EL CASO, MEDIDO EL 2026-09-22 ─────────────────────────────────────────────
 * De los ultimos CINCO intentos de publicacion en Instagram, CUATRO fallaron con
 * `9007 · Media ID is not available` —15, 17, 18 y 21 de septiembre—, los cuatro entre 6 y 9
 * segundos despues de crear la fila. Facebook, en la misma ventana, publico 12 de 14.
 *
 * La causa estaba en este archivo: `ig_create_container` y `ig_publish_container` encadenados sin
 * nada en medio. Instagram procesa el medio de forma ASINCRONA — el id que vuelve todavia no sirve.
 *
 * ── LO QUE ESTE TEST PROTEGE ──────────────────────────────────────────────────
 * `leerEstadoContenedor` es el punto donde se decide si se publica. Es el sitio exacto donde un
 * texto inesperado podria colarse como «listo» y devolver el defecto con mejor disfraz — por eso
 * es puro, por eso esta exportado, y por eso se prueba aqui caso por caso.
 *
 * Lo que este test NO puede hacer: hablar con Graph. Eso exige credenciales y una cuenta real, y
 * se verifica en el cuerpo del PR. Aqui se fija la DECISION, que es lo que se puede ejecutar.
 *
 * Todos los identificadores de las fixturas son sinteticos.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { leerEstadoContenedor } from '../api/_igContainer.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Dos fuentes: el modulo puro tiene los plazos y la lectura; `publish.ts` tiene el ORDEN de las
 * llamadas. Se leen sin comentarios — la cabecera de los dos explica el 9007 citandolo, y un
 * barrido que leyera comentarios se dispararia sobre su propia documentacion.
 */
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const PURO   = sinComentarios(readFileSync(join(ROOT, 'api', '_igContainer.ts'), 'utf8'));
const CODIGO = sinComentarios(readFileSync(join(ROOT, 'api', 'publish.ts'), 'utf8'));

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

const respuesta = (o) => JSON.stringify(o);

// ── 1 · Los cinco estados de Graph, leidos ────────────────────────────────────

test('FINISHED es el unico que dice que se puede publicar', () => {
  assert.strictEqual(leerEstadoContenedor(respuesta({ id: '1', status_code: 'FINISHED' })).estado, 'FINISHED');
});

test('IN_PROGRESS, ERROR, EXPIRED y PUBLISHED se leen cada uno por su nombre', () => {
  for (const e of ['IN_PROGRESS', 'ERROR', 'EXPIRED', 'PUBLISHED']) {
    assert.strictEqual(leerEstadoContenedor(respuesta({ id: '1', status_code: e })).estado, e);
  }
});

test('el detalle de `status` viaja: un ERROR sin motivo no se puede arreglar', () => {
  const { detalle } = leerEstadoContenedor(
    respuesta({ status_code: 'ERROR', status: 'Media download failed' }));
  assert.strictEqual(detalle, 'Media download failed');
});

// ── 2 · Lo que no se entiende NO es «listo» ───────────────────────────────────
//
// Es la mitad que importa. Tratar un desconocido como FINISHED devolveria el 9007 exactamente
// igual que antes, pero con un paso de espera delante que haria creer que el problema se arreglo.

test('un texto que no parsea es UNKNOWN, nunca FINISHED', () => {
  const r = leerEstadoContenedor('<html>502 Bad Gateway</html>');
  assert.strictEqual(r.estado, 'UNKNOWN');
  assert.notStrictEqual(r.estado, 'FINISHED');
});

test('una respuesta vacia o nula es UNKNOWN', () => {
  assert.strictEqual(leerEstadoContenedor(null).estado, 'UNKNOWN');
  assert.strictEqual(leerEstadoContenedor('').estado, 'UNKNOWN');
});

test('un JSON valido SIN `status_code` es UNKNOWN', () => {
  // El caso mas traicionero: Graph respondio, parsea, y no trae la respuesta a la pregunta.
  assert.strictEqual(leerEstadoContenedor(respuesta({ id: '17900000000000000' })).estado, 'UNKNOWN');
});

test('un estado que Graph invente mañana es UNKNOWN, no listo', () => {
  assert.strictEqual(leerEstadoContenedor(respuesta({ status_code: 'PROCESSING_V2' })).estado, 'UNKNOWN');
});

test('un error de Graph en vez del estado es UNKNOWN y conserva el texto', () => {
  const r = leerEstadoContenedor(respuesta({ error: { message: 'Invalid OAuth token', code: 190 } }));
  assert.strictEqual(r.estado, 'UNKNOWN');
  assert.ok(r.detalle && r.detalle.includes('190'), 'se pierde el motivo del fallo');
});

test('mayusculas y minusculas no cambian la decision', () => {
  assert.strictEqual(leerEstadoContenedor(respuesta({ status_code: 'finished' })).estado, 'FINISHED');
});

// ── 3 · El orden de las llamadas, en la fuente ────────────────────────────────

test('se espera ENTRE crear y publicar, no despues', () => {
  const crear   = CODIGO.indexOf("'ig_create_container'");
  const esperar = CODIGO.indexOf('esperarContenedorListo(post.brand_id');
  const publicar = CODIGO.indexOf("'ig_publish_container'");
  assert.ok(crear > -1 && esperar > -1 && publicar > -1, 'falta alguno de los tres pasos');
  assert.ok(crear < esperar, 'se espera antes de crear el contenedor: no hay nada que esperar');
  assert.ok(esperar < publicar, 'se publica antes de esperar — es el defecto original intacto');
});

test('si la espera no da listo, NO se publica', () => {
  // El `return` temprano es lo que convierte la espera en una guarda. Sin el, esperar solo añadiria
  // latencia antes del mismo 9007.
  const i = CODIGO.indexOf('esperarContenedorListo(post.brand_id');
  const hasta = CODIGO.indexOf("'ig_publish_container'", i);
  const entre = CODIGO.slice(i, hasta);
  assert.ok(/if\s*\(!\s*\w+\.listo\s*\)/.test(entre), 'no se comprueba el resultado de la espera');
  assert.ok(/return\s*\{/.test(entre), 'se comprueba y se sigue igual: la guarda no corta');
});

test('PUBLISHED no vuelve a publicar: un duplicado no se deshace', () => {
  const i = CODIGO.indexOf('async function esperarContenedorListo');
  const cuerpo = CODIGO.slice(i);
  const j = cuerpo.indexOf("=== 'PUBLISHED'");
  assert.notStrictEqual(j, -1, 'PUBLISHED no se trata aparte');
  const rama = cuerpo.slice(j, j + 400);
  assert.ok(/listo:\s*false/.test(rama), 'PUBLISHED se trataria como publicable y duplicaria el post');
});

test('ERROR y EXPIRED cortan la espera en vez de agotar el plazo', () => {
  const cuerpo = CODIGO.slice(CODIGO.indexOf('async function esperarContenedorListo'));
  assert.ok(/'ERROR'\s*\|\|[\s\S]{0,40}'EXPIRED'/.test(cuerpo),
    'no se cortan los dos estados terminales: insistir sobre ellos gasta el plazo para nada');
});

// ── 4 · La espera esta acotada por los dos lados ──────────────────────────────

test('hay tope por contenedor Y tope de corrida', () => {
  assert.ok(/CONTAINER_TIMEOUT_MS\s*=\s*[\d_]+/.test(PURO), 'sin tope por contenedor, un IN_PROGRESS eterno cuelga la funcion');
  assert.ok(/PUBLISH_DEADLINE_MS\s*=\s*[\d_]+/.test(PURO), 'sin tope de corrida, varios pendientes lentos superan el maxDuration');
});

test('el tope de corrida queda por DEBAJO del maxDuration declarado en vercel.json', () => {
  // Si lo superara, Vercel cortaria la funcion a media publicacion y la fila quedaria sin motivo
  // escrito — que es justo lo que el tope existe para evitar.
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const maxMs = vercel.functions['api/publish.ts'].maxDuration * 1000;
  const deadline = Number(PURO.match(/PUBLISH_DEADLINE_MS\s*=\s*([\d_]+)/)[1].replace(/_/g, ''));
  assert.ok(deadline < maxMs, `el plazo (${deadline} ms) no cabe en maxDuration (${maxMs} ms)`);
});

test('cada post recibe lo que QUEDA del plazo, no el plazo entero', () => {
  assert.ok(/Math\.min\(\s*Date\.now\(\)\s*\+\s*CONTAINER_TIMEOUT_MS\s*,\s*deadline\s*\)/.test(CODIGO),
    'el tope por contenedor ignora el plazo de la corrida: el ultimo post podria pasarse solo');
});

// ── 5 · Cero marcas ───────────────────────────────────────────────────────────

test('nada de esto nombra una marca', () => {
  const t = CODIGO.toLowerCase();
  for (const marca of ['unrealvillestudio', 'neuronescf', 'forumphs', 'luciensael']) {
    assert.ok(!t.includes(marca), `se nombra la marca «${marca}» fuera de un comentario`);
  }
});

// ── Resumen ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} ok, ${failures.length} fail`);
if (failures.length > 0) process.exit(1);
