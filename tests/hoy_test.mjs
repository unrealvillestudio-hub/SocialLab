/**
 * HOY · EL CENTRO DE ATENCIÓN Y LOS OBJETIVOS SEMANALES (Sam, 2026-10-26 y 2026-10-27).
 *
 * EL CASO. «La tab de HOY … ¿qué quiere decir? ¿No se supone que aquí estaría lo que más atención deberíamos prestarle o
 * estar pendientes?» y «quiero que pongas un banner de estrategias semanales … se logró, no se logró, qué nos faltó y
 * cómo lo corregimos», «banner lo decido yo según sugerencia del asesor».
 *
 * Cubre `src/atencion.ts` (qué pide atención y en qué orden) y `api/_objetivosCore.ts` (qué decisión vale sobre un
 * objetivo, qué edición es legítima y cómo se agrupa la semana), y que la vista y el endpoint usan lo que dicen.
 *
 * Sin dependencias. Requiere Node >= 22.18 (type stripping nativo).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { itemsDeAtencion, franjasDeHoy, haceCuanto, diaEn, HORAS_VENTANA_URGENTE } from '../src/atencion.ts';
import { transicion, edicion, lunesLocal, semanasPorMarca } from '../api/_objetivosCore.ts';

let fallos = 0;
function test(nombre, fn) {
  try { fn(); console.log(`  ok  ${nombre}`); } catch (e) { fallos++; console.error(`  FALLA  ${nombre}\n        ${e.message}`); }
}
const AHORA = Date.parse('2026-10-27T15:00:00Z');   // martes, 11:00 en Nueva York
const hace = (min) => new Date(AHORA - min * 60_000).toISOString();
const en = (min) => new Date(AHORA + min * 60_000).toISOString();

const com = (id, estado, minutos, meta = 120, extra = {}) => ({
  id, platform: 'P', brand_id: 'B', estado, commented_at: hace(minutos), meta_min: meta, author_name: `a${id}`, text: 't',
  respuestas: [], from_brand: false, ...extra,
});
const hilo = (id, estado, minutosEspera, hastaMin, puede = true) => ({
  id, platform: 'P', brand_id: 'B', estado, participant_name: `p${id}`, espera_desde: hace(minutosEspera), ultimo_at: hace(minutosEspera),
  meta_min: 240, mensajes: [{ from_brand: false, sent_at: hace(minutosEspera), text: 'hola' }],
  responder: { puede, hasta: hastaMin === null ? null : en(hastaMin), motivo: puede ? null : 'cerrada' },
});

console.log('\n── 1 · QUÉ PIDE ATENCIÓN, Y EN QUÉ ORDEN ──');
test('lo fallido, lo fuera de meta y la ventana por cerrarse son urgentes; lo que espera dentro de meta, pendiente', () => {
  const it = itemsDeAtencion({
    comentarios: [com(1, 'sin_responder', 30), com(2, 'sin_responder', 300), com(3, 'fallida', 10), com(4, 'respondido', 500), com(5, 'allegado', 500)],
    hilos: [hilo(7, 'sin_responder', 60, 120), hilo(8, 'sin_responder', 60, 20 * 60), hilo(9, 'respondido', 60, 600)],
  }, AHORA);
  const por = Object.fromEntries(it.map((i) => [i.clave, i.nivel]));
  assert.deepEqual(por, { 'com:1': 'atencion', 'com:2': 'urgente', 'com:3': 'urgente', 'dm:7': 'urgente', 'dm:8': 'atencion' });
  assert.ok(it.find((i) => i.clave === 'dm:7').detalle.includes(`cierra en 2 h`), `ventana ≤ ${HORAS_VENTANA_URGENTE} h`);
  assert.deepEqual(it.map((i) => i.nivel), ['urgente', 'urgente', 'urgente', 'atencion', 'atencion'], 'urgente primero');
  const urgentes = it.filter((i) => i.nivel === 'urgente').map((i) => i.clave);
  assert.deepEqual(urgentes, ['com:2', 'dm:7', 'com:3'], 'dentro del nivel, lo que espera desde antes primero');
});
test('un mensaje cuya ventana ya cerró no se ofrece como tarea (no se puede responder desde aquí), salvo si falló', () => {
  const it = itemsDeAtencion({ hilos: [hilo(1, 'sin_responder', 3000, null, false), hilo(2, 'fallida', 3000, null, false)] }, AHORA);
  assert.deepEqual(it.map((i) => i.clave), ['dm:2']);
});
test('consejos, señales y objetivos por decidir se agrupan por marca; lleva a su pestaña', () => {
  const it = itemsDeAtencion({
    recomendaciones: [{ brand_id: 'B', status: 'nueva', created_at: hace(5), recommendation: 'r1' }, { brand_id: 'B', status: 'nueva', created_at: hace(50), recommendation: 'r2' },
      { brand_id: 'B', status: 'seguida', created_at: hace(5), recommendation: 'x' }],
    tarjetas: [{ brand_id: 'B', status: 'nueva', severity: 'atencion', created_at: hace(9), what_text: 'w' }, { brand_id: 'B', status: 'nueva', severity: 'info', created_at: hace(9), what_text: 'i' }],
    propuestas: [{ brand_id: 'B', n: 2 }, { brand_id: 'C', n: 0 }],
  }, AHORA);
  assert.deepEqual(it.map((i) => [i.clave, i.titulo, i.destino]), [
    ['reco:B', '2 consejos del asesor sin decidir', 'acciones'],
    ['tarjeta:B', '1 señal de SignalLab que pide atención', 'acciones'],
    ['obj:B', '2 objetivos propuestos para esta semana', 'hoy'],
  ]);
});
test('franjas: hueco de hoy (aviso), fallida de hoy y manual atrasada (urgente), manual de hoy (pendiente); en el huso de la marca', () => {
  const husos = new Map([['B', 'America/New_York']]);
  const f = (id, status, slot_at, extra = {}) => ({ id, brand_id: 'B', platform_key: 'meta_ig', slot_at, status, format: null, piece_id: null, published_at: null, failed_reason: null, ...extra });
  const it = itemsDeAtencion({
    franjas: [f('a', 'free', en(120)), f('b', 'free', hace(60)), f('c', 'failed', hace(30), { failed_reason: 'x' }),
      f('d', 'manual_pending', hace(26 * 60)), f('e', 'manual_pending', en(60)), f('g', 'reserved', en(30), { piece_id: 'p' }),
      f('h', 'free', '2026-10-28T03:30:00Z')],   // 23:30 del martes en Nueva York: es de hoy
    husos, plataformaDeCanal: () => 'INSTAGRAM',
  }, AHORA);
  assert.deepEqual(it.map((i) => [i.clave, i.nivel]), [
    ['franja:d', 'urgente'], ['franja:c', 'urgente'], ['franja:e', 'atencion'], ['franja:a', 'aviso'], ['franja:h', 'aviso'],
  ]);
  assert.ok(it.every((i) => i.platform === 'INSTAGRAM'), 'la plataforma sale del canal de la marca');
  assert.deepEqual(franjasDeHoy([f('x', 'free', hace(60 * 12)), f('y', 'free', en(60))], husos, AHORA).map((x) => x.id), ['y'],
    'hace 12 h ya era ayer en Nueva York');
});
test('haceCuanto y diaEn', () => {
  assert.equal(haceCuanto(hace(5), AHORA), 'hace 5 min');
  assert.equal(haceCuanto(hace(180), AHORA), 'hace 3 h');
  assert.equal(haceCuanto(hace(3 * 1440), AHORA), 'hace 3 d');
  assert.equal(diaEn('2026-10-28T03:30:00Z', 'America/New_York'), '2026-10-27');
  assert.equal(diaEn('2026-10-28T03:30:00Z', null), '2026-10-28');
});

console.log('\n── 2 · OBJETIVOS: EL ASESOR PROPONE, EL OPERADOR DECIDE ──');
test('transiciones: se aprueba una propuesta; se descarta propuesta o activa; lo cerrado no se toca', () => {
  assert.deepEqual(transicion('propuesta', 'aprobar'), { nuevo: 'activa' });
  assert.ok('error' in transicion('activa', 'aprobar'));
  assert.deepEqual(transicion('activa', 'descartar'), { nuevo: 'descartada' });
  assert.deepEqual(transicion('activa', 'editar'), { nuevo: 'activa' });
  assert.ok('error' in transicion('cerrada', 'editar'));
  assert.ok('error' in transicion('cerrada', 'descartar'));
  assert.ok('error' in transicion('propuesta', 'borrar'));
});
test('edición: frase de 1 a 200; meta numérica sólo si se mide, mayor que el punto de partida (nivel) o que cero (suma)', () => {
  const nivel = { metric: 'm', measure: 'nivel', baseline_value: 25 };
  assert.deepEqual(edicion(nivel, { objective: '  Vamos a 40  ', target_value: '40' }), { cambios: { objective: 'Vamos a 40', target_value: 40 } });
  assert.ok('error' in edicion(nivel, { target_value: 25 }), 'no mejora el punto de partida');
  assert.ok('error' in edicion(nivel, { target_value: 'mucho' }));
  assert.ok('error' in edicion(nivel, { objective: '' }));
  assert.ok('error' in edicion(nivel, { objective: 'x'.repeat(201) }));
  assert.ok('error' in edicion({ metric: null, measure: null, baseline_value: null }, { target_value: 5 }), 'sin métrica no hay meta');
  assert.ok('error' in edicion({ metric: 'r', measure: 'suma', baseline_value: null }, { target_value: 0 }));
  assert.deepEqual(edicion(nivel, {}), { cambios: {} });
});
test('la semana de cada marca es la de su huso, y la revisión es la de la semana anterior', () => {
  assert.equal(lunesLocal(Date.parse('2026-10-26T03:00:00Z'), 'America/New_York'), '2026-10-19', 'domingo por la noche en Nueva York');
  assert.equal(lunesLocal(AHORA, 'America/Panama'), '2026-10-26');
  const o = (id, brand_id, week_start, status, created_at = '2026-10-26T10:00:00Z') => ({ id, brand_id, week_start, status, created_at });
  const filas = [o('1', 'B', '2026-10-26', 'propuesta', '2026-10-26T09:00:00Z'), o('2', 'B', '2026-10-26', 'activa', '2026-10-26T10:00:00Z'),
    o('3', 'B', '2026-10-26', 'descartada'), o('4', 'B', '2026-10-19', 'cerrada'), o('5', 'B', '2026-10-12', 'cerrada'), o('6', 'C', '2026-10-26', 'activa')];
  const [b, c] = semanasPorMarca(filas, ['B', 'C'], new Map([['B', 'America/New_York'], ['C', null]]), AHORA);
  assert.equal(b.semana, '2026-10-26');
  assert.deepEqual(b.objetivos.map((x) => x.id), ['2', '1'], 'activos primero; lo descartado no se muestra');
  assert.deepEqual(b.revision.map((x) => x.id), ['4'], 'sólo la semana anterior');
  assert.deepEqual(c.objetivos.map((x) => x.id), ['6']);
});

console.log('\n── 3 · LA VISTA Y EL ENDPOINT USAN LO QUE DICEN ──');
const HOY = readFileSync(new URL('../src/views/Hoy.tsx', import.meta.url), 'utf8');
const API = readFileSync(new URL('../api/objetivos.ts', import.meta.url), 'utf8');
test('Hoy: atención, lo de hoy y lo publicado; cada fuente por separado', () => {
  // El banner salió de Hoy: lo dibuja App encima de todas las pestañas (Sam, 2026-10-27).
  assert.doesNotMatch(HOY, /<BannerObjetivos /);
  const APP = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(APP, /<EstrategiaDeLaSemana token=/, 'el banner encabeza todas las pestañas');
  assert.ok(APP.indexOf('<EstrategiaDeLaSemana') < APP.indexOf("{pestana === 'hoy'"), 'va antes de cualquier pestaña');
  assert.match(HOY, /itemsDeAtencion\(\{/);
  assert.match(HOY, /franjasDeHoy\(/);
  assert.match(HOY, /No se pudo leer: /, 'una fuente que falla se nombra y no tumba a las demás');
  assert.equal((HOY.match(/\blee\(/g) ?? []).length, 6, 'seis lecturas independientes');
});
test('el endpoint lee la vista de SignalLab, decide con el núcleo y escribe condicionado al estado', () => {
  assert.match(API, /v_growth_goals\?select=/);
  assert.match(API, /transicion\(o\.status/);
  assert.match(API, /growth_goals\?id=eq\.\$\{id\}&status=eq\./);
  assert.match(API, /reasons: \['a_pedido', 'semana'\]/);
  assert.match(API, /esTablaInexistente\(e\)/, 'antes de la migración, disponible: false, no un error');
});

console.log(fallos ? `\n${fallos} falla(s)` : '\nTodo verde.');
if (fallos) process.exit(1);
