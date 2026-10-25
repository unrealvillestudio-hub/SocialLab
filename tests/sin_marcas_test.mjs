/**
 * NINGUNA MARCA EN EL CÓDIGO DE SOCIALLAB (MULTIBRAND_RULE §1, 2026-10-24).
 *
 * EL CASO. La maqueta anterior traía 10 marcas escritas en `src/config/brands.ts`, varias que ya no
 * existían, y un mapa de alias por marca en `src/services/socialLabLoader.ts`. Se retiraron con la
 * Fase 2 (tablero de operadores). Este test falla si una marca vuelve a escribirse en `api/` o `src/`
 * fuera de un comentario: las marcas, sus cuentas y la asignación de operadores son dato.
 *
 * LA LISTA DE ABAJO ES FIXTURE, no fuente: son los `brands.id` de `public.brands` medidos el
 * 2026-10-24, en minúsculas (MULTIBRAND §7.2: un fixture con marca real no es violación). El
 * verificador V-03 del contrato ICR la lee de la tabla; en CI no hay base, así que se fija aquí.
 * Una marca nueva que falte en la lista no rompe nada: sólo deja de vigilarse hasta que se añada.
 *
 * Ejecutar:  node tests/sin_marcas_test.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const CARPETAS = ['api', 'src'];
const EXTENSIONES = /\.(tsx?|jsx?|mjs|cjs|html|css)$/;
const MARCAS = [
  'airapersonal', 'studiooperations', 'luciensael', 'vivosemask', 'patriciaosoriopersonal', 'd7herbal',
  'patriciaosorioconectando', 'neuronescf', 'vizoscosmetics', 'unrealvillestores', 'diamonddetails',
  'sampublisher', 'unrealvillestudio', 'forumphs', 'patriciaosoriovizossalon', 'patriciaosoriocomunidad',
  // los alias camelCase de la maqueta retirada, para que no vuelvan por la puerta de atrás
  'neuronecosmetics', 'unrealillestudio',
];

function archivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    if (/node_modules|dist/.test(r)) return [];
    return statSync(r).isDirectory() ? archivos(r) : EXTENSIONES.test(n) ? [r] : [];
  });
}

/** Quita comentarios antes de buscar (CC_PROTOCOL §14.1): un comentario que documenta un caso no es código. */
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const todos = CARPETAS.flatMap((c) => archivos(join(RAIZ, c)));
assert.ok(todos.length >= 8, `sólo ${todos.length} archivos en ${CARPETAS.join(', ')}: el barrido no vigila nada`);

const hallazgos = [];
for (const f of todos) {
  const t = sinComentarios(readFileSync(f, 'utf8')).toLowerCase();
  for (const m of MARCAS) if (t.includes(m)) hallazgos.push(`${relative(RAIZ, f)}: «${m}»`);
}

// La barrera se prueba con su regresión inyectada (CC_PROTOCOL §14.2).
const inyectado = sinComentarios("const X = 'ForumPHs'; // ok\n/* NeuroneSCF */").toLowerCase();
assert.ok(inyectado.includes('forumphs'), 'la barrera no ve una marca en código');
assert.ok(!inyectado.includes('neuronescf'), 'la barrera se dispara sobre un comentario');

assert.deepEqual(hallazgos, [], `marcas escritas en el código:\n  ${hallazgos.join('\n  ')}`);
console.log(`sin_marcas: ${todos.length} archivos, ninguna marca en el código — todo en verde`);
