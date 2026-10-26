// Genera api/_adaptCore.ts copiando, SIN REESCRIBIR, los bloques del adaptador que vivían en
// unrlvl-iid-functions/supabase/functions/content-run-stage/index.ts (Fase 6, 2026-10-26).
//
//   node scripts/generar_adapt_core.mjs <ruta a content-run-stage/index.ts> <sha del commit de origen>
//
// Los bloques se cortan por sus sentinelas (`// ── NOMBRE:BEGIN ──` … `// ── NOMBRE:END ──`), igual que los tests del
// carril. Las ÚNICAS transformaciones son las de TRANSFORMACIONES, cada una con su motivo y comprobada (si el texto de
// origen no aparece exactamente una vez, el generador falla). La cabecera del archivo generado guarda el sha de origen y el
// md5 de cada bloque, para que la equivalencia se pueda volver a comprobar.
//
// Mientras dure la Fase 6 (6a → 6c) el origen sigue siendo el carril. En 6c el adaptador se borra de allí y este archivo
// pasa a ser la fuente: desde entonces se edita aquí y el generador se retira.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const [, , ruta, sha] = process.argv;
if (!ruta || !sha) { console.error("uso: node scripts/generar_adapt_core.mjs <content-run-stage/index.ts> <sha>"); process.exit(2); }
const src = readFileSync(ruta, "utf8");
const md5 = (t) => createHash("md5").update(t).digest("hex");

function cut(nombre) {
  const b = `// ── ${nombre}:BEGIN ──`, e = `// ── ${nombre}:END ──`;
  const i = src.indexOf(b), j = src.indexOf(e);
  if (i < 0 || j <= i) throw new Error(`no existe el bloque ${nombre}`);
  return src.slice(i, j + e.length);
}
function between(desde, hasta) {
  const i = src.indexOf(desde), j = src.indexOf(hasta, i);
  if (i < 0 || j <= i) throw new Error(`no existe el tramo ${desde.slice(0, 40)}`);
  return src.slice(i, j);
}

// Bloques puros que el adaptador usa. U3 NO se copia: la regla de plataforma la resuelve el carril y la PASA (lleva claves
// legacy de una marca que no deben entrar en una capa compartida nueva).
const BLOQUES = ["SIGNCANON", "CT-PLATFORM", "VOICECONSTRAINTS", "HASHTAGPOLICY", "TITLEADAPT"];
const bloques = BLOQUES.map((n) => ({ n, t: cut(n) }));
const constantes = between("const ADAPTER_MAX_TOKENS_DEFAULT = ", "async function fetchAdapterLanguageDirective(");
let adaptador = between("async function runSocialLabDirect(", "// P-b (PLACE-01 corte B)");

const TRANSFORMACIONES = [
  // 1 · La llamada al proveedor pasa por una función inyectable: en modo «replay» (la comparación en sombra de 6b) el
  //     carril manda las respuestas que recibió y aquí no se llama a nadie. En modo normal es `fetch`, idéntico.
  { donde: "todo", de: 'await fetch("https://api.anthropic.com/v1/messages"', a: 'await llamarModelo("https://api.anthropic.com/v1/messages"', veces: 2 },
  // 2 · La directiva de idioma la resolvía el adaptador leyendo la base; ahora llega RESUELTA (como el techo y la firma).
  { donde: "adaptador", de: "await fetchAdapterLanguageDirective(language);", a: "directivaResuelta;", veces: 1 },
  // 3 · La regla de plataforma llega RESUELTA por el carril, por plataforma.
  { donde: "adaptador", de: "const { key: ruleKey, rule, adapt } = resolvePlatformRule(platform);", a: "const { key: ruleKey, rule, adapt } = reglaDe(platform);", veces: 1 },
  // 4 · Nombre y parámetros nuevos al final de la firma: la directiva y las reglas resueltas.
  { donde: "adaptador", de: "async function runSocialLabDirect(", a: "export async function runSocialLabDirect(", veces: 1 },
  { donde: "adaptador", de: '  modelo: string = "",\n): Promise<{', a: '  modelo: string = "",\n  directivaResuelta: { directive: LanguageDirective | null; source: LanguageDirectiveSource } = { directive: null, source: "unresolved" },\n  reglaDe: (platform: string) => { key: string; rule: string; adapt: boolean } = () => { throw new Error("REGLA_DE_PLATAFORMA_SIN_DATO"); },\n): Promise<{', veces: 1 },
];
function aplicar(texto, donde) {
  for (const t of TRANSFORMACIONES.filter((x) => x.donde === donde || x.donde === "todo")) {
    const n = texto.split(t.de).length - 1;
    if (t.donde !== "todo" && n !== t.veces) throw new Error(`transformación «${t.de.slice(0, 50)}»: ${n} apariciones, se esperaban ${t.veces}`);
    texto = texto.split(t.de).join(t.a);
  }
  return texto;
}
const totalFetch = (bloques.map((b) => b.t).join("") + adaptador).split(TRANSFORMACIONES[0].de).length - 1;
if (totalFetch !== TRANSFORMACIONES[0].veces) throw new Error(`llamadas al proveedor: ${totalFetch}, se esperaban ${TRANSFORMACIONES[0].veces}`);
const bloquesT = bloques.map((b) => ({ ...b, t2: aplicar(b.t, "bloque") }));
adaptador = aplicar(adaptador, "adaptador");

const cabecera = `// ════════════════════════════════════════════════════════════════════════════════════════════════
// GENERADO por scripts/generar_adapt_core.mjs — NO EDITAR A MANO mientras dure la Fase 6.
// Origen: unrlvl-iid-functions@${sha} · supabase/functions/content-run-stage/index.ts
// Bloques copiados sin reescribir (md5 del texto de origen):
${bloquesT.map((b) => `//   ${b.n.padEnd(18)} ${md5(b.t)}`).join("\n")}
//   constantes         ${md5(constantes)}
//   runSocialLabDirect ${md5(between("async function runSocialLabDirect(", "// P-b (PLACE-01 corte B)"))}
// Transformaciones (y sólo éstas): ${TRANSFORMACIONES.length}, descritas en el generador.
// ════════════════════════════════════════════════════════════════════════════════════════════════
/* eslint-disable */
// @ts-nocheck — el texto es el del carril, tipado y probado allí; aquí se prueba por equivalencia (tests/adapt_test.mjs).

import { AsyncLocalStorage } from "node:async_hooks";
declare const process: { env: Record<string, string | undefined> };
const ANT_KEY = process.env.ANTHROPIC_API_KEY ?? "";
type Llamador = (url: string, init: any) => Promise<any>;
// Quién responde por el proveedor, POR PETICIÓN: una instancia de Vercel puede atender varias a la vez, así que no se cambia
// nada global. Sin contexto, es \`fetch\`: idéntico al carril.
const contexto = new AsyncLocalStorage<Llamador>();
const llamarModelo: Llamador = (url, init) => (contexto.getStore() ?? ((u: string, i: any) => fetch(u, i)))(url, init);
/** Corre \`fn\` con otro llamador (modo replay de la comparación en sombra). */
export function conLlamador<T>(ll: Llamador, fn: () => Promise<T>): Promise<T> { return contexto.run(ll, fn); }

`;
const salida = cabecera
  + bloquesT.map((b) => b.t2).join("\n\n")
  + "\n\n" + constantes.trimEnd() + "\n\n" + adaptador.trimEnd() + "\n\n"
  + "export { adaptTitleAndHook, masterPartOf, normalizeLanguageCode, CEILING_UNDECLARED, VOICE_CONSTRAINTS_ABSENT };\n";
writeFileSync(new URL("../api/_adaptCore.ts", import.meta.url), salida, "utf8");
console.log(`api/_adaptCore.ts: ${salida.split("\n").length} líneas`);
