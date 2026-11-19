/**
 * SocialLab — REELS Y STORIES: QUÉ SE PUBLICA SEGÚN LA FILA, Y CÓMO (2026-11-19).
 *
 * Ejecutar:  npm test   (o `node tests/reels_stories_test.mjs`)
 * Sin dependencias. Node >= 22.18 (type stripping nativo), como `contenedor_9007_test.mjs`.
 *
 * ── EL CASO ───────────────────────────────────────────────────────────────────
 * Sam (2026-10-31): 25 % imagen, 50 % reel, 25 % carrusel. Sam (2026-11-01 y 2026-11-08): cada
 * publicación de feed y cada reel generan su story, también en la Página de Facebook. Sam (2026-11-19):
 * «SI al MCP de Meta y al PR2». El publicador sólo sabía de imagen y carrusel [medido: `main` 1d733c5].
 *
 * ── LO QUE ESTE TEST FIJA ─────────────────────────────────────────────────────
 *   1. `mediaPlanOf` (ejecutado): cada tipo de fila tiene un único camino, y lo que no se puede
 *      publicar falla con un código nominal en vez de caer a otro formato.
 *   2. `leerEstadoVideoFb` (ejecutado): sólo `published` consta como publicado; un error en cualquier
 *      fase es error; lo ilegible queda pendiente, nunca publicado.
 *   3. `api/publish.ts` (lectura del código): el reel y la story usan las herramientas del MCP, esperan
 *      con los plazos del video, la story no lleva texto y un video de Facebook pendiente NO se marca
 *      `failed` (un reintento subiría un segundo reel).
 *   4. Imagen y carrusel siguen igual.
 *   5. Ninguna marca escrita en el código nuevo; sin voseo.
 *
 * Lo que no puede hacer: hablar con Graph. Sam pidió «no pruebes video aún»; la prueba real va con su
 * permiso, en la cuenta y la pieza que él elija.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  mediaPlanOf, leerEstadoVideoFb, VIDEO_CONTAINER_TIMEOUT_MS, FB_VIDEO_CONFIRM_TIMEOUT_MS,
} from '../api/_mediaPlan.ts';
import { PUBLISH_DEADLINE_MS, CONTAINER_TIMEOUT_MS } from '../api/_igContainer.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISH = readFileSync(join(ROOT, 'api', 'publish.ts'), 'utf8');
const PLAN_SRC = readFileSync(join(ROOT, 'api', '_mediaPlan.ts'), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PUB = sinComentarios(PUBLISH);

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (err) { failures.push({ name, err }); console.log(`FAIL  ${name}\n      ${err.message}`); }
}

const V = 'https://cdn.example.test/media/v.mp4';
const I = 'https://cdn.example.test/media/i.jpg';

// ── 1 · mediaPlanOf ───────────────────────────────────────────────────────────
console.log('\n1 · mediaPlanOf');

test('imagen y fila sin tipo: un solo camino, el de siempre', () => {
  assert.deepEqual(mediaPlanOf({ media_type: null, image_url: I }), { kind: 'single' });
  assert.deepEqual(mediaPlanOf({ media_type: 'IMAGE', image_url: I }), { kind: 'single' });
  assert.deepEqual(mediaPlanOf({}), { kind: 'single' });
});

test('carrusel: 2 a 10 láminas; con menos de 2, como antes, una imagen', () => {
  assert.deepEqual(mediaPlanOf({ media_type: 'CAROUSEL', media_urls: [I, I] }), { kind: 'carousel', urls: [I, I] });
  assert.equal(mediaPlanOf({ media_type: 'CAROUSEL', media_urls: Array(12).fill(I) }).urls.length, 10);
  assert.deepEqual(mediaPlanOf({ media_type: 'CAROUSEL', media_urls: [I] }), { kind: 'single' });
});

test('reel: el MP4 de media_urls[0] y la portada de image_url', () => {
  assert.deepEqual(mediaPlanOf({ media_type: 'REELS', media_urls: [V], image_url: I }), { kind: 'reel', videoUrl: V, coverUrl: I });
  assert.deepEqual(mediaPlanOf({ media_type: 'reels', media_urls: [V] }), { kind: 'reel', videoUrl: V, coverUrl: null });
});

test('reel sin video: falla, NO se publica como imagen', () => {
  const p = mediaPlanOf({ media_type: 'REELS', media_urls: [], image_url: I });
  assert.equal(p.kind, 'invalid');
  assert.match(p.error, /^MEDIA_PLAN_REEL_WITHOUT_VIDEO/);
  assert.equal(mediaPlanOf({ media_type: 'REELS', media_urls: ['http://inseguro/v.mp4'] }).kind, 'invalid');
});

test('story: video si lo hay, si no imagen; sin ninguno, falla', () => {
  assert.deepEqual(mediaPlanOf({ media_type: 'STORY', media_urls: [V], image_url: I }), { kind: 'story', videoUrl: V, imageUrl: null });
  assert.deepEqual(mediaPlanOf({ media_type: 'STORY', image_url: I }), { kind: 'story', videoUrl: null, imageUrl: I });
  assert.match(mediaPlanOf({ media_type: 'STORY' }).error, /^MEDIA_PLAN_STORY_WITHOUT_MEDIA/);
});

test('VIDEO y tipos desconocidos no se interpretan', () => {
  assert.match(mediaPlanOf({ media_type: 'VIDEO', media_urls: [V] }).error, /^MEDIA_PLAN_VIDEO_NOT_PUBLISHABLE/);
  assert.match(mediaPlanOf({ media_type: 'LIVE' }).error, /^MEDIA_PLAN_UNKNOWN_TYPE: media_type 'LIVE'/);
});

// ── 2 · leerEstadoVideoFb ─────────────────────────────────────────────────────
console.log('\n2 · leerEstadoVideoFb');

const st = (status) => JSON.stringify({ status, id: '1' });

test('publicado sólo cuando publishing_phase lo dice', () => {
  assert.equal(leerEstadoVideoFb(st({ video_status: 'ready', publishing_phase: { status: 'complete', publish_status: 'published' } })).estado, 'published');
  assert.equal(leerEstadoVideoFb(st({ video_status: 'ready', publishing_phase: { status: 'not_started', publish_status: 'not_published' } })).estado, 'pending');
  assert.equal(leerEstadoVideoFb(st({ video_status: 'processing', processing_phase: { status: 'in_progress' } })).estado, 'pending');
});

test('un error en cualquier fase es error, con su motivo', () => {
  const r = leerEstadoVideoFb(st({ video_status: 'processing', processing_phase: { status: 'error', error: { message: 'bad codec' } } }));
  assert.equal(r.estado, 'error');
  assert.match(r.detalle, /processing_phase: bad codec/);
  assert.equal(leerEstadoVideoFb(st({ video_status: 'upload_failed' })).estado, 'error');
  assert.equal(leerEstadoVideoFb(st({ video_status: 'expired' })).estado, 'error');
});

test('lo ilegible queda pendiente, nunca publicado', () => {
  for (const t of [null, '', 'no es json', '{}', '{"status":{}}']) {
    assert.equal(leerEstadoVideoFb(t).estado, 'pending', `«${t}» se leyó como algo distinto de pending`);
  }
});

// ── 3 · api/publish.ts ────────────────────────────────────────────────────────
console.log('\n3 · api/publish.ts');

test('el plan se decide antes que nada y un plan inválido falla con su motivo', () => {
  const ini = PUB.indexOf('async function publishPost(');
  const cuerpo = PUB.slice(ini);
  assert.ok(cuerpo.indexOf('mediaPlanOf(post)') >= 0, 'publishPost no consulta mediaPlanOf');
  assert.ok(cuerpo.indexOf('mediaPlanOf(post)') < cuerpo.indexOf("mcpCall("), 'el plan se decide después de llamar al MCP');
  assert.ok(/plan\.kind === 'invalid'\) \{\s*return \{[^}]*status: 'failed', error: plan\.error/.test(cuerpo), 'un plan inválido no falla con su motivo');
});

test('reel de Instagram: contenedor REELS con portada, en el feed, con los plazos del video', () => {
  assert.ok(/media_type: 'REELS', video_url: plan\.videoUrl, caption: post\.copy_text, share_to_feed: true/.test(PUB));
  assert.ok(/cover_url: plan\.coverUrl/.test(PUB));
  assert.ok(/timeoutMs: VIDEO_CONTAINER_TIMEOUT_MS, firstCheckMs: VIDEO_FIRST_CHECK_MS/.test(PUB), 'el video no espera con su plazo');
});

test('story de Instagram: contenedor STORIES sin texto', () => {
  const ini = PUB.indexOf("plan.kind === 'story' && platform === 'INSTAGRAM'");
  const tramo = PUB.slice(ini, PUB.indexOf("plan.kind === 'story' && platform === 'FACEBOOK'"));
  assert.ok(/media_type: 'STORIES'/.test(tramo));
  assert.ok(!/caption/.test(tramo), 'la story de Instagram lleva texto');
});

test('Facebook: reel y story por las herramientas del MCP; la story sin texto', () => {
  assert.ok(/'fb_publish_reel',\s*\{ video_url: plan\.videoUrl, description: post\.copy_text \}/.test(PUB));
  const ini = PUB.indexOf("plan.kind === 'story' && platform === 'FACEBOOK'");
  const tramo = PUB.slice(ini, PUB.indexOf('MEDIA_PLAN_PLATFORM_UNSUPPORTED'));
  assert.ok(/'fb_publish_story'/.test(tramo));
  assert.ok(!/copy_text|caption|message/.test(tramo), 'la story de Facebook lleva texto');
});

test('un video de Facebook pendiente NO se marca failed (evita el segundo reel)', () => {
  const ini = PUB.indexOf('async function publicarVideoFb(');
  const f = PUB.slice(ini, PUB.indexOf('\n}\n', ini));
  assert.ok(/estado\.estado === 'error'\) \{\s*return \{ \.\.\.base, status: 'failed'/.test(f), 'un error de Facebook no falla');
  const ini2 = f.indexOf("estado.estado === 'pending') {");
  assert.ok(ini2 >= 0, 'no hay rama para el video pendiente');
  const bloque = f.slice(ini2, f.indexOf('\n  }\n', ini2));
  assert.ok(!/return|status: 'failed'/.test(bloque), 'el video pendiente sale por otro camino que el de enviado');
  assert.ok(/status: 'published', platform_post_id: postId \?\? videoId/.test(f));
});

test('story y reel sin camino en otra plataforma fallan; TikTok sigue con su carril', () => {
  assert.ok(/plan\.kind === 'story' \|\| \(plan\.kind === 'reel' && platform !== 'TIKTOK'\)/.test(PUB));
  assert.ok(/MEDIA_PLAN_PLATFORM_UNSUPPORTED/.test(PUB));
  assert.ok(/return publishTikTokInbox\(post\)/.test(PUB), 'el carril de TikTok desapareció');
});

test('los plazos del video caben en la corrida', () => {
  assert.ok(VIDEO_CONTAINER_TIMEOUT_MS > CONTAINER_TIMEOUT_MS, 'el video no espera más que la imagen');
  assert.ok(VIDEO_CONTAINER_TIMEOUT_MS < PUBLISH_DEADLINE_MS && FB_VIDEO_CONFIRM_TIMEOUT_MS < PUBLISH_DEADLINE_MS);
});

// ── 4 · Lo existente sigue igual ──────────────────────────────────────────────
console.log('\n4 · imagen y carrusel');

test('imagen y carrusel conservan sus herramientas', () => {
  for (const t of ["'fb_publish_photo'", "'fb_publish_post'", "'fb_publish_photos'", "media_type: 'CAROUSEL'", "is_carousel_item: true"]) {
    assert.ok(PUB.includes(t), `desapareció ${t}`);
  }
  assert.ok(/export function carouselUrlsOf\(/.test(PUB), 'carouselUrlsOf ya no se exporta');
});

// ── 5 · Multimarca e idioma ───────────────────────────────────────────────────
console.log('\n5 · multimarca y voseo');

test('ninguna marca escrita en el código nuevo (test de la marca N+1)', () => {
  const nuevo = sinComentarios(PLAN_SRC) + PUB.slice(PUB.indexOf('type Resultado'), PUB.indexOf('async function publishPost('));
  for (const marca of ['NeuroneSCF', 'LucienSael', 'UnrealvilleStudio', 'ForumPHs', 'SamPublisher', 'IvetteFlores']) {
    assert.ok(!nuevo.includes(marca), `aparece la marca ${marca}`);
  }
});

test('el texto nuevo no usa voseo', () => {
  const texto = PLAN_SRC + PUBLISH.slice(PUBLISH.indexOf('// ── REELS Y STORIES'), PUBLISH.indexOf('// ── PUBLISH PER PLATFORM'));
  const voseo = /\b(vos|tenés|podés|querés|sabés|hacé|decí|mirá|fijate|usá|poné|tené)\b/i;
  assert.ok(!voseo.test(texto), `voseo: ${texto.match(voseo)?.[0]}`);
});

console.log(`\n${passed} ok, ${failures.length} fallos`);
if (failures.length) process.exit(1);
