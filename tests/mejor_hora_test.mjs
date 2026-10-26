/**
 * MEJOR HORA — el núcleo puro (`api/_mejorHoraCore.ts`) y la vista (`api/ops.ts`, vista `mejorhora`). Sam, 2026-10-26.
 *
 * Cubre: la hora en el huso de la marca; la franja; el valor a la misma edad; que con menos de dos franjas comparables
 * NO hay mejor hora y se dice cuántas faltan; que con dos o más gana la mediana más alta; y que la vista lee la métrica,
 * la edad y los umbrales del dato, sin nombrar plataformas, métricas ni marcas.
 *
 * Sin dependencias. Requiere Node >= 22.18 (type stripping nativo).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { horaEn, inicioDeFranja, valorAEdad, mejorHora, etiquetaFranja } from '../api/_mejorHoraCore.ts';

let fallos = 0;
function test(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  FALLA  ${nombre}\n        ${e.message}`); }
}
const CFG = { banda_horas: 3, minimo_por_franja: 5 };
const p = (published_at, valor) => ({ brand_id: 'B', platform: 'P', published_at, valor });

test('la hora es la de la marca: 23:00 UTC es 19 h en Nueva York (horario de verano) y 23 h sin huso', () => {
  assert.equal(horaEn('2026-10-26T23:00:00Z', 'America/New_York'), 19);
  assert.equal(horaEn('2026-10-26T23:00:00Z', null), 23);
  assert.equal(horaEn('ilegible', 'America/New_York'), null);
  assert.equal(inicioDeFranja(19, 3), 18);
  assert.equal(etiquetaFranja({ inicio: 21, fin: 0 }), '21–24 h');
});
test('el valor a la edad de comparación: la primera lectura dentro de la tolerancia; fuera, nada', () => {
  assert.equal(valorAEdad([{ age_minutes: 1500, value: 30 }, { age_minutes: 1440, value: 20 }, { age_minutes: 3000, value: 99 }], 1440, 1440), 20);
  assert.equal(valorAEdad([{ age_minutes: 3000, value: 99 }], 1440, 1440), null);
  assert.equal(valorAEdad([{ age_minutes: 1440, value: null }], 1440, 1440), null);
});
test('todas a la misma hora: datos insuficientes, sin nombrar una hora, y lo dice', () => {
  const ps = Array.from({ length: 7 }, (_, i) => p(`2026-10-${10 + i}T23:00:00Z`, 10 + i));
  const r = mejorHora(ps, 'America/New_York', 'reach', CFG);
  assert.equal(r.estado, 'datos_insuficientes'); assert.equal(r.mejor, null);
  assert.equal(r.franjas.length, 1); assert.equal(r.franjas[0].inicio, 18); assert.equal(r.franjas[0].comparable, true);
  assert.match(r.motivo, /sólo la franja de 18–21 h .* hace falta otra franja con 5, y todas las publicaciones salen a esa hora/);
});
test('pocas publicaciones: ninguna franja llega al mínimo', () => {
  const r = mejorHora([p('2026-10-10T23:00:00Z', 5), p('2026-10-11T16:00:00Z', 9)], 'America/New_York', 'reach', CFG);
  assert.equal(r.estado, 'datos_insuficientes');
  assert.match(r.motivo, /2 publicaciones medidas, ninguna franja llega a 5/);
  const vacio = mejorHora([p('2026-10-10T23:00:00Z', null)], null, 'reach', CFG);
  assert.match(vacio.motivo, /todavía no hay publicaciones con lectura/);
});
test('dos franjas comparables: gana la mediana más alta y se dice cuánto supera a la siguiente', () => {
  const tarde = [10, 12, 14, 16, 18].map((v, i) => p(`2026-10-${10 + i}T23:00:00Z`, v));      // 19 h NY → 18–21
  const mediodia = [20, 21, 22, 23, 24].map((v, i) => p(`2026-10-${10 + i}T16:30:00Z`, v));   // 12:30 NY → 12–15
  const r = mejorHora([...tarde, ...mediodia], 'America/New_York', 'reach', CFG);
  assert.equal(r.estado, 'comparable');
  assert.deepEqual(r.mejor, { inicio: 12, fin: 15, mediana: 22, ventaja_pct: 57 });
  assert.match(r.motivo, /entre 2 franjas con 5 o más publicaciones, la de 12–15 h rinde más \(\+57% sobre la siguiente\)/);
});

const OPS = readFileSync(new URL('../api/ops.ts', import.meta.url), 'utf8');
const VISTA = OPS.slice(OPS.indexOf('async function mejorHoraVista'), OPS.indexOf('const VISTAS'));
test('la vista: métrica, edad y umbrales del dato; sin la migración lo dice; sin nombres de plataformas ni marcas', () => {
  assert.ok(/signal_platforms\?select=platform,best_time_metric/.test(VISTA));
  assert.ok(/signal_collector_config\?select=key,value&key=like\.best_time_\*/.test(VISTA));
  for (const k of ['best_time_age_minutes', 'best_time_age_tolerance_minutes', 'best_time_band_hours', 'best_time_min_posts_per_band', 'best_time_window_days']) {
    assert.ok(VISTA.includes(`'${k}'`), `falta ${k}`);
  }
  assert.ok(/disponible: false, motivo: 'la comparación por franjas todavía no está configurada/.test(VISTA));
  assert.ok(!/INSTAGRAM|FACEBOOK|'reach'|post_total_media_view_unique|NeuroneSCF|ForumPHs|LucienSael|UnrealvilleStudio/.test(VISTA));
  assert.ok(/mejorhora: mejorHoraVista/.test(OPS));
});

if (fallos) { console.error(`\n${fallos} fallo(s)`); process.exit(1); }
console.log('\nmejor_hora_test: OK');
