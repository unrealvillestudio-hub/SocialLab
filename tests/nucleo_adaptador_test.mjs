/**
 * Fase 6c (2026-10-27) — EL ADAPTADOR ES DE SOCIALLAB, Y SUS PRUEBAS TAMBIÉN.
 *
 * Hasta la 6c el adaptador vivía en `unrlvl-iid-functions/supabase/functions/content-run-stage/index.ts` y lo vigilaban
 * tests de aquel repo. Se mudaron con él, con las MISMAS expresiones, ahora sobre `api/_adaptCore.ts`:
 *   1 · su cuerpo (de adaptador_genoma, generation_ceiling, firma_cabe, sign_firma, tag_ajeno, techo_cumple y
 *       autofix_titulo_canal): el prompt recibe restricciones, directiva, presupuesto y nombres propios; el idioma no se
 *       re-resuelve; el fail-loud va antes del bucle; techo, truncado y reintento; la firma no entra al modelo; el
 *       barrido de ajenos y el recorte corren sobre el texto final; la medición se persiste siempre.
 *   2 · `adaptTitleAndHook` REAL con `fetch` simulado (de autofix_titulo_canal): ok, parte ausente, truncado, HTTP, red,
 *       canal que no adapta, sin clave, sin maestro.
 *   3 · `runSocialLabDirect` REAL con `fetch` simulado (de hashtag_policy): lo que se juzga y se publica ya cumple.
 *
 * Marcas, plataformas y textos INVENTADOS. Sin dependencias. Node >= 22.18 (type stripping).
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CORE = readFileSync(new URL('../api/_adaptCore.ts', import.meta.url), 'utf8');
const codigo = CORE.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const fnIni = CORE.indexOf('export async function runSocialLabDirect(');
const AD = CORE.slice(fnIni, CORE.indexOf('\nexport {', fnIni));
assert.ok(fnIni > 0, 'no existe runSocialLabDirect');

// Dos módulos: con clave y sin clave (`ANT_KEY` se lee al cargar, como en producción).
async function cargar(clave) {
  process.env.ANTHROPIC_API_KEY = clave;
  const p = join(mkdtempSync(join(tmpdir(), 'nucleo-')), 'core.mts');
  writeFileSync(p, CORE, 'utf8');
  return await import(pathToFileURL(p).href);
}
const M = await cargar('clave-de-prueba');
const M0 = await cargar('');

let fallos = 0, ok = 0;
async function test(nombre, fn) {
  const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try { await fn(); Object.assign(console, o); ok++; console.log(`  ok  ${nombre}`); }
  catch (e) { Object.assign(console, o); fallos++; console.error(`  FALLA  ${nombre}\n        ${e.message}`); }
}

console.log('── 1 · el cuerpo del adaptador ──');

await test('recibe las restricciones y arma el system con directiva, presupuesto y nombres propios', () => {
  assert.match(CORE, /constraints: Record<string, VoiceConstraints> = \{\}/);
  assert.match(CORE, /system: buildAdapterSystemPrompt\(ruleKey, rule, vc, languageDirective, presupuesto, nombresPropios\)/);
  assert.ok(!/system: `Adaptador de copy de SocialLab UNRLVL\. Reglas/.test(CORE), 'el prompt viejo, sin restricciones');
});

await test('LANG-03 · el adaptador no re-resuelve el idioma, y sin directiva se detiene ANTES del bucle', () => {
  const cuerpo = AD.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/readDispatchAxis|language_primary|builder_input/.test(cuerpo), 'una segunda resolución de idioma');
  assert.match(AD, /if \(languageDirectiveSource !== "table"\) \{/);
  assert.match(AD, /throw new Error\(\s*`ADAPT_LANGUAGE_DIRECTIVE_MISSING/);
  const iThrow = AD.indexOf('ADAPT_LANGUAGE_DIRECTIVE_MISSING'), iBucle = AD.indexOf('for (const platform of platforms)');
  assert.ok(iThrow > 0 && iBucle > iThrow, 'el fail-loud va antes del bucle: cero llamadas a ciegas');
});

await test('la medición de hashtags se persiste SIEMPRE y el exceso grita sin recortar por posición', () => {
  assert.match(CORE, /hashtags_in: hashtagsIn, hashtags_out: hashtagsOut/);
  assert.match(CORE, /over_ceiling: overCeiling/);
  assert.match(CORE, /platform, adapted: adapt,/);
  assert.match(CORE, /if \(overCeiling && adapt\)/);
  assert.match(CORE, /const overCeiling = vc\.max_hashtags !== null && hashtagsOut > vc\.max_hashtags/);
  assert.match(CORE, /\[SOCIALLAB\]\[ADAPT-01\] platform=\$\{platform\} el adaptado escribe/);
  assert.ok(!/\.slice\(0, vc\.max_hashtags\)/.test(CORE));
});

await test('F1 / SIGN-02 · techo resuelto, truncado visible y UN reintento; un segundo corte se descarta', () => {
  assert.match(CORE, /const maxTokens = ceiling\.max_tokens \?\? ADAPTER_MAX_TOKENS_DEFAULT;/);
  assert.match(CORE, /model: modelo, max_tokens: techo,/);
  assert.match(CORE, /let r = await adaptarUnaVez\(maxTokens\);/);
  assert.equal((CORE.match(/max_tokens: 800/g) ?? []).length, 0);
  assert.match(CORE, /const ADAPTER_MAX_TOKENS_DEFAULT = 800;/);
  assert.match(CORE, /truncated: d\.stop_reason === "max_tokens"/);
  assert.match(CORE, /\[SOCIALLAB\]\[SIGN-02\] platform=\$\{platform\} adaptación TRUNCADA/);
  assert.match(CORE, /const ADAPTER_TRUNCATION_RETRY_FACTOR = 1\.5;/);
  assert.match(CORE, /const techoReintento = Math\.ceil\(maxTokens \* ADAPTER_TRUNCATION_RETRY_FACTOR\);/);
  assert.match(CORE, /truncated = true; degraded = true; adaptedCopy = inputCopy;/);
  assert.match(CORE, /adapted: adapt, truncated, degraded \}\);/);
  assert.equal((CORE.match(/await adaptarUnaVez\((maxTokens\)|techoReintento\))/g) ?? []).length, 2);
  assert.equal((CORE.match(/await adaptarUnaVez\(/g) ?? []).length, 3);
});

await test('FIRMA-CABE · el presupuesto usa el tope del canal y el techo de la marca; mide y reintenta UNA vez', () => {
  const i = CORE.indexOf('= presupuestoDeCuerpo(');
  assert.notStrictEqual(i, -1);
  const llamada = CORE.slice(i, CORE.indexOf(';', i));
  assert.ok(/charLimits\.get\(/.test(llamada) && /ceiling\.max_chars/.test(llamada));
  assert.match(CORE, /excedePresupuesto\(r\.text, presupuesto\)/);
  assert.match(CORE, /buildBudgetRetryMessage\(largo, presupuesto as number\)/);
  assert.equal((CORE.match(/adaptarUnaVez\(maxTokens, \{ previo/g) ?? []).length, 1);
  assert.ok(!/from\("platform_configs"\)/.test(AD), 'el adaptador no consulta tablas');
});

await test('SIGN-02 · la firma no entra al modelo', () => {
  assert.match(CORE, /const inputCopy = stripSignatureOccurrences\(rawCopy, signatureText\);/);
  assert.match(CORE, /content: `Adapta para \$\{ruleKey\}:\\n\\n\$\{inputCopy\}`/);
});

await test('TAG-AJENO y TECHO-CUMPLE · barrido y recorte sobre el texto FINAL, y queda escrito', () => {
  const barrido = codigo.indexOf('quitarTagsAjenos(adaptedCopy');
  assert.ok(barrido > 0 && codigo.indexOf('adapted.push({', barrido) > barrido);
  assert.ok(/tags_ajenos:\s*barrido\.quitados/.test(CORE));
  const i = codigo.indexOf('hashtagPolicyApplied.push(registroDePolitica(platform, politicaHashtags, hp));');
  const j = codigo.indexOf('recortarPorFrase(adaptedCopy, presupuesto, null, terminosProtegidos)');
  const k = codigo.indexOf('adapted.push({', j);
  assert.ok(i > 0 && j > i && k > j, 'política → recorte → fila');
  assert.match(codigo, /applied\.push\(\{ platform, max_tokens: maxTokens,[\s\S]{0,300}budget: presupuesto, budget_outcome:/);
});

await test('AUTOFIX-6 · el bucle usa adaptTitleAndHook y suma sus tokens; la llamada de título existe una vez', () => {
  assert.ok(AD.includes('await adaptTitleAndHook({ platform, ruleKey, rule, adapt, masterTitle, masterHook, languageDirective, model: modelo })'));
  assert.ok(/total_in\s+\+= tp\.input_tokens;/.test(AD) && /total_out \+= tp\.output_tokens;/.test(AD));
  assert.ok(AD.includes('title: adaptedTitle, image_hook: adaptedHook,'));
  assert.ok(AD.includes('const masterTitle = masterPartOf(rawTitle);'));
  assert.equal((CORE.match(/max_tokens: TITLE_ADAPTER_MAX_TOKENS/g) ?? []).length, 1);
  assert.equal((CORE.match(/(?<!function )buildTitleAdapterSystemPrompt\(/g) ?? []).length, 1);
  assert.equal((CORE.match(/parseAdaptedTitleBlock\(/g) ?? []).length, 2);
});

console.log('── 2 · adaptTitleAndHook REAL con fetch simulado ──');

let llamadas = [];
const simular = (responder) => { llamadas = []; globalThis.fetch = async (url, init) => { llamadas.push({ url, body: JSON.parse(init.body) }); return responder(llamadas.length); }; };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const okText = (text, extra = {}) => json(200, { content: [{ text }], usage: { input_tokens: 120, output_tokens: 30 }, stop_reason: 'end_turn', ...extra });
const base = { platform: 'canal_xx', ruleKey: 'CANALXX', rule: 'máx 90 chars.', adapt: true, languageDirective: null, model: 'modelo-de-prueba' };

await test('partes en orden fijo y con su rótulo', () => {
  assert.deepEqual(M.titleAdapterParts('T', 'G'), ['title', 'image_hook']);
  assert.deepEqual(M.titleAdapterParts(null, null), []);
  assert.equal(M.buildTitleAdapterUserMessage(['title', 'image_hook'], 'Un título', 'Un gancho'), 'TITULO: Un título\nIMAGEN: Un gancho');
});
await test('ok con las dos partes → canal_adaptado, y la petición es la de siempre', async () => {
  simular(() => okText('TITULO: Título del canal\nIMAGEN: Gancho del canal'));
  const r = await M.adaptTitleAndHook({ ...base, masterTitle: 'Título maestro', masterHook: 'Gancho maestro' });
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(llamadas[0].body.model, 'modelo-de-prueba');
  assert.equal(llamadas[0].body.max_tokens, M.TITLE_ADAPTER_MAX_TOKENS);
  assert.match(llamadas[0].body.system, /Reglas de formato de CANALXX: máx 90 chars\./);
  assert.equal(llamadas[0].body.messages[0].content, 'TITULO: Título maestro\nIMAGEN: Gancho maestro');
  assert.deepEqual([r.title, r.image_hook, r.title_source, r.image_hook_source], ['Título del canal', 'Gancho del canal', 'canal_adaptado', 'canal_adaptado']);
  assert.deepEqual([r.called, r.ok, r.input_tokens, r.output_tokens, r.usage_reported, r.http_status], [true, true, 120, 30, true, 200]);
});
await test('una parte que no vuelve cae al maestro y lo declara', async () => {
  simular(() => okText('TITULO: Título del canal'));
  const r = await M.adaptTitleAndHook({ ...base, masterTitle: 'Título maestro', masterHook: 'Gancho maestro' });
  assert.deepEqual([r.title_source, r.image_hook, r.image_hook_source], ['canal_adaptado', 'Gancho maestro', 'maestro_por_fallo']);
  assert.deepEqual(r.missing, ['image_hook']);
});
await test('truncada → maestro_por_fallo, pero los tokens se cuentan', async () => {
  simular(() => okText('TITULO: Títu', { stop_reason: 'max_tokens' }));
  const r = await M.adaptTitleAndHook({ ...base, masterTitle: 'Título maestro', masterHook: 'Gancho maestro' });
  assert.deepEqual([r.title_source, r.image_hook_source, r.called, r.ok, r.input_tokens, r.output_tokens], ['maestro_por_fallo', 'maestro_por_fallo', true, false, 120, 30]);
  assert.match(r.error, /truncada/);
});
await test('HTTP fuera de 2xx → maestro_por_fallo, cero tokens y el código del proveedor', async () => {
  simular(() => json(429, { error: 'límite' }));
  const r = await M.adaptTitleAndHook({ ...base, masterTitle: 'Título maestro', masterHook: null });
  assert.deepEqual([r.title_source, r.image_hook_source, r.input_tokens, r.usage_reported, r.http_status], ['maestro_por_fallo', 'sin_maestro', 0, false, 429]);
});
await test('la red falla → maestro_por_fallo y sin código de proveedor', async () => {
  globalThis.fetch = async () => { throw new Error('sin red'); };
  const r = await M.adaptTitleAndHook({ ...base, masterTitle: 'Título maestro', masterHook: 'Gancho maestro' });
  assert.deepEqual([r.title_source, r.http_status, r.called], ['maestro_por_fallo', null, true]);
});
await test('canal que no adapta, sin clave o sin maestro → no se llama', async () => {
  simular(() => { throw new Error('no debía llamar'); });
  const a = await M.adaptTitleAndHook({ ...base, adapt: false, masterTitle: 'T', masterHook: 'G' });
  const b = await M0.adaptTitleAndHook({ ...base, masterTitle: 'T', masterHook: null });
  const c = await M.adaptTitleAndHook({ ...base, masterTitle: null, masterHook: null });
  assert.equal(llamadas.length, 0);
  assert.deepEqual([a.title_source, b.title_source, b.image_hook_source, c.title_source], ['maestro_sin_adaptacion', 'maestro_sin_adaptacion', 'sin_maestro', 'sin_maestro']);
});

console.log('── 3 · runSocialLabDirect REAL con fetch simulado ──');

const DECL = { fijos: ['#PanaderiaAurora', '#Valparaiso', '#MasaMadre'], permitidos_por_tema: ['#AuroraDulce', '#PanDeCampo'],
  prefijos_de_marca: ['aurora'], vetados_patrones: ['^promo\\d', 'competidorx'] };
const DIR = { directive: { language_code: 'es', label: 'es', directive_block: 'x', register_constraints: null }, source: 'table' };
const regla = () => ({ key: 'CANAL_A', rule: 'máx 500 chars.', adapt: true });

await test('HASHTAGS-01 · lo que se juzga y se publica ya cumple la política; sin política, byte por byte', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ usage: { input_tokens: 10, output_tokens: 20 }, stop_reason: 'end_turn',
    content: [{ text: 'Texto adaptado.\n\n#Hornear #AuroraPanes #Promo3x2 #Uno #Dos #Tres #Cuatro #Cinco #Seis #Siete #Ocho #Nueve' }] }) });
  const politicas = { canal_a: M.resolverPoliticaDeHashtags(DECL, { techoGenoma: 5, techoPlataforma: 5, dominio: null }) };
  const r = await M.runSocialLabDirect('Maestro.', ['canal_a'], {}, {}, 'es', null, new Map(), null, null,
    { maquinaria: [], marcas: [] }, 'MarcaInventada', politicas, [], 'modelo-de-prueba', DIR, regla);
  assert.equal(r.adapted[0].copy, 'Texto adaptado.\n\n#PanaderiaAurora #Valparaiso #MasaMadre #Hornear #Uno');
  assert.equal(r.hashtag_policy.length, 1);
  assert.equal(r.hashtag_policy[0].resultado.techo_fuente, 'genoma_y_plataforma');
  assert.equal(r.voice_constraints[0].hashtags_out, 5);
  const r0 = await M.runSocialLabDirect('Maestro.', ['canal_a'], {}, {}, 'es', null, new Map(), null, null,
    { maquinaria: [], marcas: [] }, 'MarcaInventada', {}, [], 'modelo-de-prueba', DIR, regla);
  assert.ok(r0.adapted[0].copy.endsWith('#Ocho #Nueve'));
  assert.deepEqual(r0.hashtag_policy, []);
});

console.log(fallos ? `\nnucleo_adaptador: ${fallos} fallo(s) · ${ok} ok` : `\nnucleo_adaptador: OK (${ok})`);
process.exit(fallos ? 1 : 0);
