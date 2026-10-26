// ════════════════════════════════════════════════════════════════════════════════════════════════
// GENERADO por scripts/generar_adapt_core.mjs — NO EDITAR A MANO mientras dure la Fase 6.
// Origen: unrlvl-iid-functions@9487d3d · supabase/functions/content-run-stage/index.ts
// Bloques copiados sin reescribir (md5 del texto de origen):
//   SIGNCANON          e25195c61a3710340af474b43e206267
//   CT-PLATFORM        112e180404a4781628955d6b22db9ea2
//   VOICECONSTRAINTS   30293c28b084361fbf4692299164e7c5
//   HASHTAGPOLICY      66df19b6cbd330e28e9606dfcd03ead9
//   TITLEADAPT         c7f0b86889695db3394db3f3de23acdc
//   constantes         4d3fad611af0bb4792f3f51ca8d743f3
//   runSocialLabDirect 4a9d26107db702889746d6f99582c160
// Transformaciones (y sólo éstas): 5, descritas en el generador.
// ════════════════════════════════════════════════════════════════════════════════════════════════
/* eslint-disable */
// @ts-nocheck — el texto es el del carril, tipado y probado allí; aquí se prueba por equivalencia (tests/adapt_test.mjs).

import { AsyncLocalStorage } from "node:async_hooks";
declare const process: { env: Record<string, string | undefined> };
const ANT_KEY = process.env.ANTHROPIC_API_KEY ?? "";
type Llamador = (url: string, init: any) => Promise<any>;
// Quién responde por el proveedor, POR PETICIÓN: una instancia de Vercel puede atender varias a la vez, así que no se cambia
// nada global. Sin contexto, es `fetch`: idéntico al carril.
const contexto = new AsyncLocalStorage<Llamador>();
const llamarModelo: Llamador = (url, init) => (contexto.getStore() ?? ((u: string, i: any) => fetch(u, i)))(url, init);
/** Corre `fn` con otro llamador (modo replay de la comparación en sombra). */
export function conLlamador<T>(ll: Llamador, fn: () => Promise<T>): Promise<T> { return contexto.run(ll, fn); }

// ── SIGNCANON:BEGIN ── (SIGN-02, 2026-09-15) bloque PURO: UNA FIRMA, UNA SOLA, Y AL FINAL.
// Sin DB, sin red, sin estado. Lo extrae `tests/sign_firma_test.mjs` por estos sentinelas, y COMPARA
// las copias de las tres Edge Functions byte a byte: si divergen, el test falla en la comparación.
//
// EL DEFECTO QUE CIERRA, medido el 2026-09-15 sobre las piezas corregidas a mano. `stampSignature`
// comprobaba `t.endsWith(sig)` y nada más, así que sólo sabía reconocer la firma EN EL FINAL. Una
// firma que ya venía en el texto pero ANTES del bloque de hashtags no la veía, y añadía otra:
//
//   cuerpo … \n\n FIRMA \n\n #hashtags              ← lo que traía el adaptado
//   cuerpo … \n\n FIRMA \n\n #hashtags \n\n FIRMA   ← lo que dejaba el estampado
//
// Medido en `intel.piece_edits` el 2026-09-15: dos piezas con la firma dos veces, las dos con esa
// forma exacta. En una de ellas la firma ya venía en `social.adapted_pre_judgment`, o sea que la
// trajo el TEXTO DE ENTRADA del adaptador — el contrato lo prohíbe y nadie lo comprobaba.
//
// LA FORMA CORRECTA NO ES AÑADIR UN CASO MÁS. Comprobar «¿está al final?» y además «¿está antes de
// los hashtags?» deja fuera el tercer sitio donde aparezca. Así que no se comprueba dónde está: se
// QUITAN TODAS y se pone UNA, al final. El resultado no depende de por dónde venga el texto, que es
// lo que «constante para todas las marcas» significa.
//
// IDEMPOTENTE POR CONSTRUCCIÓN, no por una guarda: el paso que quita todas las apariciones quita
// también la que puso la llamada anterior. `f(f(x)) === f(x)` sin comparar finales con nada.
//
// CERO LITERALES DE MARCA. La firma llega como DATO —`builder_meta.signature_closer.text`, resuelto
// por marca y por voz desde el genoma—. Este bloque no conoce ninguna: las recibe. La forma del
// cierre varía por voz (una URL, un nombre con separadores, una frase con punto final) y ninguna de
// esas formas está escrita aquí.

/** Escapa un literal para incrustarlo en una expresión regular. Un cierre puede traer `.`, `(` o
 *  `|`: sin esto, el punto final de una firma casaría con cualquier carácter. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Quita TODAS las apariciones exactas de la firma, junto con el espacio en blanco que las precede.
 * Descontar ese espacio es lo que evita el hueco: quitar la firma de `cuerpo\n\nFIRMA\n\n#tags`
 * dejaría `cuerpo\n\n\n\n#tags`, con una línea en blanco de más que nadie escribió.
 *
 * Sólo la firma. Los hashtags y el CTA se conservan: decidir si un bloque de cierre es cuerpo o no
 * es el trabajo de `stripClosingFurniture`, y no es el de este bloque.
 */
function stripSignatureOccurrences(text: unknown, sig: unknown): string {
  const cuerpo = String(text ?? "");
  const firma  = String(sig ?? "").trim();
  if (!firma) return cuerpo;
  return cuerpo.replace(new RegExp(`\\s*${escapeForRegExp(firma)}`, "gu"), "");
}

/**
 * La firma de la voz, exactamente una vez, al final, detrás del bloque de hashtags.
 *
 * Sin firma declarada devuelve el texto SIN TOCAR: una pieza cuya voz no declara cierre nace sin
 * cierre, y no se le inventa uno. Es la misma decisión que ya tomaba `stampSignature`.
 */
function canonicalizeSignature(text: unknown, sig: unknown): string {
  const original = String(text ?? "");
  const firma    = String(sig ?? "").trim();
  if (!firma) return original;
  const cuerpo = stripSignatureOccurrences(original, firma).replace(/\s+$/u, "");
  return cuerpo ? `${cuerpo}\n\n${firma}` : firma;
}
// ── SIGNCANON:END ──

// ── CT-PLATFORM:BEGIN ── (F1, 2026-08-18) bloque PURO: el TECHO DE GENERACIÓN por (artefacto, voz,
// PLATAFORMA). Sin DB, sin red, sin estado (solo console.warn). Lo extrae
// `tests/generation_ceiling_test.mjs` por estos sentinelas.
//
// EL HALLAZGO. Corrida de 63 piezas (4 dominios × 3 plataformas): CopyLab produjo el MISMO rango para
// LinkedIn, Instagram y Facebook —1.685 / 1.766 / 1.780 caracteres— con un techo único de 640 tokens
// de salida en las 63 (máximo exacto 640, promedio 577). Las tres plataformas no se parecen: LinkedIn
// premia lo largo (límite 3.000, óptimo 1.300–2.500), Instagram corta a la vista en ~125 sobre un
// límite de 2.200, Facebook admite 63.206 caracteres y rinde breve. Un solo largo para las tres no es
// una decisión de marca: es la ausencia de una.
// Y ese 640 no lo declaró nadie. `unrlvl_default` no tiene fila en public.content_type_registry, cae a
// la fila BASE, y las 13 filas BASE tienen `max_tokens` en NULL: el techo es un default interno del
// generador operando POR AUSENCIA DE DECLARACIÓN. Lo que faltaba no era el valor — era la DIMENSIÓN.
// El registry no tenía plataforma, y un `social_post` de LinkedIn y uno de TikTok no son la misma
// pieza; hoy el sistema no podía distinguirlos.
//
// LA CASCADA (Cambio 1 del brief F1), en este orden:
//   1 · (voice_id, content_type, platform)  → "voice_platform"
//   2 · (voice_id, content_type, NULL)      → "voice_base"
//   3 · (NULL,     content_type, platform)  → "base_platform"
//   4 · (NULL,     content_type, NULL)      → "base"
//   5 · nadie declaró                       → "internal_default" — `max_tokens: null`, el techo lo
//                                             pone el generador, exactamente como hoy.
// RETROCOMPAT EXACTA: con `platform` NULL en TODAS las filas —el estado del registry el día de este
// PR— los niveles 1 y 3 no matchean nunca y la cascada colapsa a `voz ?? catálogo`, que es el `??`
// que corría antes de A3. Ninguna fila existente cambia de comportamiento.
//
// UNA FILA CON `max_tokens` NULL DECLARA LA FILA, NO EL TECHO: la cascada sigue bajando. Es lo que
// permite que `lucien_social` (fila de voz con max_tokens NULL) herede el techo de la fila BASE de su
// plataforma sin repetir el número en cada voz — y es el mismo `??` per-campo de antes de A3.
//
// POR QUÉ `max_tokens_source` Y NO SÓLO EL NÚMERO. Sin la procedencia no se puede distinguir una
// pieza corta porque la marca lo declaró de una pieza corta porque NADIE lo declaró — que es
// exactamente la confusión que produjo el brief que ordena este cambio. El número dice cuánto; la
// procedencia dice quién lo decidió, y sólo la segunda es accionable.
//
// TEST DE LA MARCA N+1. El eje es la CASCADA; los valores son dato en tabla. Una marca de otro rubro
// y otro país entra con su fila y su `voice_id`, sin tocar este archivo. La enumeración de aquí es de
// SUPERFICIES (editorial/social/email → artefacto), no de marcas, y una plataforma nueva no toca
// código: entra como fila.

// Superficie donde se publica → ARTEFACTO que se materializa en ella. Eje de función, sin vocabulario
// de marca.
const DESTINATION_TO_CONTENT_TYPE: Record<string, string> = {
  editorial: "editorial_post",
  social:    "social_post",
  email:     "email_divulgacion",
};

type CeilingSource = "voice_platform" | "voice_base" | "base_platform" | "base" | "internal_default";
type Ceiling = { max_tokens: number | null; max_tokens_source: CeilingSource;
  // BRIEF-N02 — el techo de ITEMS del catalogo, por la MISMA cascada y en la misma tabla. Opcional:
  // una fila que no lo declare deja `null` y el llamador aplica su arranque, igual que con el techo
  // de tokens. Son dos techos distintos: `max_tokens` gobierna la SALIDA y este el PROMPT.
  offer_catalog_max_items?: number | null;
  /**
   * EL TECHO DE CARACTERES DEL POST COMPLETO, por la MISMA cascada y en la misma tabla.
   *
   * NO es `max_tokens` con otras unidades: son dos techos que gobiernan cosas distintas. Medido el
   * 2026-09-22, la fila de (social_post, la voz de conversión de una marca, meta_ig) declara 900
   * tokens — que son unos 3400 caracteres— y sus piezas salen a 2035 de media sin rozarlo nunca. Un
   * techo de tokens gobierna el coste y el corte del modelo; éste gobierna lo que ve el lector.
   *
   * Y NO es el tope del canal: ése es el máximo que la plataforma acepta y vive en
   * `platform_configs.char_limit`. Éste es lo que la MARCA quiere, que siempre es menor o igual.
   *
   * `null` = sin techo declarado, y entonces manda el del canal a secas.
   */
  max_chars?: number | null;
  // LA INSTRUCCIÓN DE FORMATO, POR LA MISMA CASCADA Y EN LA MISMA TABLA.
  //
  // POR QUÉ ENTRA AHORA. La columna `format_instruction` existe en el registry desde el 2026-08-08 y
  // está sembrada —el PR #174 puso cinco valores—, pero NADIE LA LEÍA: medido el 2026-09-18 con un
  // barrido del repositorio entero, la única aparición era un comentario de intención, y el `select`
  // de esta misma función pedía `voice_id, platform, max_tokens, offer_catalog_max_items`. Una
  // instrucción sembrada que no llega al escritor no es una instrucción: es una nota.
  //
  // Es TEXTO, así que no puede salir del mismo `pick` que los techos —ese exige un número > 0— y va
  // por una cascada hermana con los MISMOS cinco niveles. Hermana y no compartida a propósito: la
  // condición de "fila que resuelve" es distinta (número usable vs texto no vacío), y forzar una
  // sola función pidiendo `unknown` habría hecho que un `max_tokens` de 0 y una instrucción vacía se
  // trataran igual sin que nadie lo notara.
  format_instruction?: string | null;
  format_instruction_source?: CeilingSource };

// El nivel 5, nombrado. `max_tokens: null` es la forma honesta de "el techo no lo puse yo".
const CEILING_UNDECLARED: Ceiling = {
  max_tokens: null, max_tokens_source: "internal_default", offer_catalog_max_items: null,
  format_instruction: null, format_instruction_source: "internal_default",
};

// NO fail-loud, y el cambio respecto de antes de A3 es deliberado: entonces este mapa gobernaba la
// generación local y un destino sin artefacto rompía la pieza (BUILDER_CONTENT_TYPE_DESCONOCIDO).
// Hoy gobierna un techo OPCIONAL — tumbar una pieza que se escribe bien, por una dimensión que nadie
// declaró todavía, sería peor que declarar la ausencia. Se avisa FUERTE y la ausencia queda dicha en
// `max_tokens_source: "internal_default"`, que es justamente el campo que este cambio agrega para que
// una ausencia se pueda leer en vez de adivinarse.
function contentTypeForDestination(destination: string | null | undefined): string | null {
  const d = String(destination ?? "").trim().toLowerCase();
  if (!d) return null;   // destino ausente (job anterior a este deploy): sin ruido, sin techo.
  const ct = DESTINATION_TO_CONTENT_TYPE[d];
  if (!ct) {
    console.warn(
      `[F1] destino '${destination}' sin artefacto declarado (conocidos: ` +
      `${Object.keys(DESTINATION_TO_CONTENT_TYPE).sort().join("|")}) → sin techo por plataforma; ` +
      `el generador aplica el suyo. Es una superficie nueva: mapearla en DESTINATION_TO_CONTENT_TYPE.`,
    );
    return null;
  }
  return ct;
}

// El vocabulario de plataformas es el de la DB (`intel.brand_topics.platforms`, `public.scheduled_posts`):
// linkedin · meta_ig · meta_fb · tiktok · x · blog. Se normaliza de los DOS lados para que una fila
// sembrada 'LinkedIn' y un job 'linkedin' sean la misma plataforma: un techo declarado no se pierde
// por una mayúscula.
function normalizePlatformKey(platform: string | null | undefined): string | null {
  const p = String(platform ?? "").trim().toLowerCase();
  return p === "" ? null : p;
}

// La cascada de cinco niveles sobre las filas YA traídas del content_type (la carga es I/O y vive
// fuera). Devuelve el techo y CUÁL de los cinco niveles lo resolvió.
function resolveContentTypeCeiling(
  rows: Array<{ voice_id?: string | null; platform?: string | null; max_tokens?: number | null;
                offer_catalog_max_items?: number | null; format_instruction?: string | null }>,
  voiceId: string | null | undefined,
  platform: string | null | undefined,
): Ceiling {
  const v = String(voiceId ?? "").trim();
  const p = normalizePlatformKey(platform);
  // Un nivel = una combinación (¿fila de voz o fila BASE?, ¿fila de plataforma o fila sin plataforma?).
  // Sólo resuelve si la fila trae un `max_tokens` usable: una fila sin número no declara techo.
  // BRIEF-N02 — el mismo `pick`, parametrizado por COLUMNA. Antes leia `max_tokens` a secas; ahora
  // resuelve cualquier techo de la fila por la misma cascada, que es lo que evita tener dos cascadas
  // que puedan divergir. El comportamiento para `max_tokens` es byte-identico.
  const pickCol = (col: "max_tokens" | "offer_catalog_max_items" | "max_chars") =>
    (wantVoice: boolean, wantPlatform: boolean): number | null => {
      for (const r of rows ?? []) {
        const rv = String(r?.voice_id ?? "").trim();
        const rp = normalizePlatformKey(r?.platform ?? null);
        const voiceOk    = wantVoice    ? (v !== "" && rv === v)    : rv === "";
        const platformOk = wantPlatform ? (p !== null && rp === p)  : rp === null;
        if (!voiceOk || !platformOk) continue;
        const raw = (r as Record<string, unknown>)?.[col];
        const n = Number(raw);
        if (raw != null && Number.isFinite(n) && n > 0) return n;
      }
      return null;
    };
  const pick = pickCol("max_tokens");
  const pickItems = pickCol("offer_catalog_max_items");
  const levels: Array<[CeilingSource, number | null]> = [
    ["voice_platform", pick(true,  true)],
    ["voice_base",     pick(true,  false)],
    ["base_platform",  pick(false, true)],
    ["base",           pick(false, false)],
  ];
  // BRIEF-N02 — los dos techos se resuelven POR SEPARADO en la misma cascada, y es deliberado: una
  // fila puede declarar el techo de tokens y no el de items, o al reves. Atarlos al mismo nivel
  // haria que declarar uno arrastrara al otro en silencio.
  const items = [pickItems(true, true), pickItems(true, false), pickItems(false, true), pickItems(false, false)]
    .find((n) => n != null) ?? null;
  // El techo de CARACTERES, por la misma cascada y con la misma independencia: una fila puede
  // declarar tokens y no caracteres, o al revés. Atarlos haría que declarar uno arrastrara al otro.
  const pickChars = pickCol("max_chars");
  const chars = [pickChars(true, true), pickChars(true, false), pickChars(false, true), pickChars(false, false)]
    .find((n) => n != null) ?? null;

  // LA INSTRUCCIÓN, POR SU PROPIA CASCADA Y CON SU PROPIA PROCEDENCIA. Se resuelve APARTE del techo,
  // por el mismo criterio que `offer_catalog_max_items`: una fila puede declarar el techo y no la
  // instrucción, o al revés. Atarlas al mismo nivel haría que declarar una arrastrara a la otra en
  // silencio — y ese silencio ya costó un mes con la instrucción sembrada y sin leer.
  const pickText = (wantVoice: boolean, wantPlatform: boolean): string | null => {
    for (const r of rows ?? []) {
      const rv = String(r?.voice_id ?? "").trim();
      const rp = normalizePlatformKey(r?.platform ?? null);
      const voiceOk    = wantVoice    ? (v !== "" && rv === v)    : rv === "";
      const platformOk = wantPlatform ? (p !== null && rp === p)  : rp === null;
      if (!voiceOk || !platformOk) continue;
      // Una fila con la columna vacía o en blanco NO declara instrucción: sigue bajando la cascada.
      // "" y NULL son la misma ausencia, y tratarlas distinto sería declarar por accidente.
      const t = typeof r?.format_instruction === "string" ? r.format_instruction.trim() : "";
      if (t !== "") return t;
    }
    return null;
  };
  const textLevels: Array<[CeilingSource, string | null]> = [
    ["voice_platform", pickText(true,  true)],
    ["voice_base",     pickText(true,  false)],
    ["base_platform",  pickText(false, true)],
    ["base",           pickText(false, false)],
  ];
  let fmt: string | null = null;
  let fmtSrc: CeilingSource = "internal_default";
  for (const [src, t] of textLevels) if (t != null) { fmt = t; fmtSrc = src; break; }

  for (const [src, mt] of levels) {
    if (mt != null) {
      return { max_tokens: mt, max_tokens_source: src, offer_catalog_max_items: items,
               max_chars: chars, format_instruction: fmt, format_instruction_source: fmtSrc };
    }
  }
  // El techo de CARACTERES viaja tambien por aqui, y es deliberado: una voz puede declarar cuanto
  // texto quiere SIN declarar techo de tokens. Atarlo al `return` de arriba lo perderia justo en el
  // caso de una marca que solo le importa el largo.
  return { ...CEILING_UNDECLARED, offer_catalog_max_items: items,
           max_chars: chars, format_instruction: fmt, format_instruction_source: fmtSrc };
}
// ── CT-PLATFORM:END ──

// ── VOICECONSTRAINTS:BEGIN ── (ADAPT-01, 2026-08-27) bloque PURO: las RESTRICCIONES DECLARADAS DE LA
// VOZ que el adaptador tiene que respetar. Sin DB, sin red, sin estado (solo console.warn). Lo extrae
// `tests/adaptador_genoma_test.mjs` por estos sentinelas, junto al bloque CT-PLATFORM del que depende
// (`normalizePlatformKey`: el mismo normalizador que usa el techo, para que una fila sembrada
// 'Meta_IG' y un job 'meta_ig' sean la misma plataforma también aquí).
//
// EL DEFECTO, MEDIDO en la corrida del 2026-08-27 16:30 UTC (5 piezas de LucienSael; las 4 sociales
// rechazadas, la de blog PASS). Contando sobre `assets` de `content.orchestrator_jobs`, hashtags en
// `copy.aife_filtered` vs. hashtags en `social.adapted[0].copy`:
//
//   job 77173871 meta_ig   2 → 13   #LucienSael #DefaultBias → +11, entre ellos #PaternalismoLibertario,
//                                   #NudgeTheory (HR-LUC-07) y #SlingTV (HR-GEN-03)
//   job c1b7e77b meta_ig   2 → 15   +13, entre ellos #DarkPatterns (HR-LUC-07) y #UNRLVL (HR-GEN-03)
//   job be24a1f9 tiktok    2 →  5   y REORDENADOS: la base #LucienSael queda ÚLTIMA
//   job b46eecf9 meta_fb   2 →  2   pero DISTINTOS: la base #LucienSael DESAPARECE
//   job 5d9fcd9e meta_fb   0 →  3   hashtags que el texto filtrado no tenía
//
// El bloque de hashtags lo escribe el ADAPTADOR, no CopyLab ni AIFE. Y no lo escribe por su cuenta:
// se lo pide `PLATFORM_RULES.INSTAGRAM`, veinte líneas más arriba — "8-15 hashtags al final". El
// adaptador obedeció la única instrucción que tenía. La que le faltaba —el techo de 5 que
// `brand_voice_genome.application_constraints` declara para `meta_ig`— nunca le llegó.
//
// QUÉ HACE ESTE BLOQUE. Resuelve, desde `application_constraints` y para UNA plataforma:
//   · `max_hashtags` — el número declarado para esa plataforma, y de qué nivel salió;
//   · `hashtag_composition` — el texto declarado para esa plataforma ("5 — marca, dominio y 3
//     tematicos"): dice CUÁLES son los 5, que es lo que el recorte por posición no puede saber;
//   · `hashtag_base` — la base obligatoria de la voz (la que el adaptador borró en 2 de 5 piezas);
//   · `prohibitions` — TODA restricción declarada en el genoma, tal cual está escrita.
//
// DE LA TABLA, NUNCA ENUMERADO. No hay una sola marca, voz ni plataforma en este bloque: las claves
// que se buscan son las del ESQUEMA del genoma (hashtags, plataforma, base, prohibido/forbidden/…),
// y los valores son instancia. La marca N+1 entra sembrando su genoma. `tests/adaptador_genoma_test.mjs`
// rechaza el bloque si nombra una.
//
// POR QUÉ SE BUSCA POR VOCABULARIO DE CLAVE Y NO POR RUTA FIJA. `application_constraints` es un jsonb
// libre y las siete voces sembradas hoy no comparten forma: `hashtags` sólo lo declaran las dos voces
// de una marca, y las prohibiciones viven en `hashtags.prohibido` (array), `signature.prohibido_geo`
// (string), `edge_safety_rail` (string) y `red_lines` (objeto), según la voz. Una ruta fija leería una
// de las cuatro y las otras tres serían silencio. El vocabulario de clave las alcanza a las cuatro sin
// nombrar a ninguna voz — y lo que NO alcanza queda VISIBLE, porque la lista resuelta se persiste en
// `assets.social.voice_constraints`: una restricción que no llegó se lee, no se adivina.
//
// LA FRONTERA. Este bloque RESUELVE Y DECLARA; no recorta ni reescribe. El recorte de hashtags por
// conteo no vive aquí y no vive en el corrector (ver ADAPT-01 §Vía B en el PR): elegir CUÁL de los 13
// se va exige saber cuál es la base y cuál el temático, y eso es entender el texto. Lo que sí se hace,
// y es determinista, es CONTAR lo que el adaptador escribió y decir cuando pasó el techo.

// El vocabulario de RESTRICCIÓN del esquema del genoma. Son nombres de clave, no de marca: `prohibido`,
// `prohibited`, `prohibido_geo`, `never_use`, `red_lines`, `edge_safety_rail` — las cuatro formas
// sembradas hoy y las de la marca N+1 que use el mismo vocabulario. Una restricción declarada bajo una
// clave fuera de este vocabulario NO se aplica, y eso se ve en el dato persistido en vez de suponerse.
const RESTRICTION_KEY_RE = /prohib|forbidden|never|safety|red_?line|restric/i;

// El contenedor de la política de hashtags dentro de `application_constraints`, y el mapa por
// plataforma dentro de él. `por_plataforma` es la forma sembrada; `by_platform` / `per_platform` caen
// bajo la misma expresión sin que haya que tocar nada.
const HASHTAG_KEY_RE  = /hashtag/i;
const PLATFORM_KEY_RE = /plataforma|platform/i;
const BASE_KEY_RE     = /^base$/i;

// Profundidad máxima del recorrido. `application_constraints` es jsonb de mano humana: seis niveles
// son más de los que ninguna voz sembrada usa (la más honda llega a tres) y acota el coste sin
// depender de que el dato sea sano.
const GENOME_WALK_MAX_DEPTH = 6;

type HashtagCeilingSource =
  | "genome_platform"        // el genoma declara un número para ESTA plataforma
  | "genome_no_platform"     // el genoma declara política de hashtags pero no para esta plataforma
  | "genome_no_hashtags"     // el genoma existe y no declara política de hashtags
  | "genome_absent";         // no hay genoma que leer

type VoiceConstraints = {
  max_hashtags: number | null;
  max_hashtags_source: HashtagCeilingSource;
  hashtag_composition: string | null;
  hashtag_base: string | null;
  prohibitions: string[];
};

const VOICE_CONSTRAINTS_ABSENT: VoiceConstraints = {
  max_hashtags: null, max_hashtags_source: "genome_absent",
  hashtag_composition: null, hashtag_base: null, prohibitions: [],
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Primer valor cuyo NOMBRE DE CLAVE matchea, recorriendo en anchura por nivel. Devuelve `undefined`
// cuando ninguna clave matchea: la ausencia se propaga, no se sustituye por un default.
function findByKey(node: unknown, keyRe: RegExp, depth = 0): unknown {
  if (depth > GENOME_WALK_MAX_DEPTH || !isPlainObject(node)) return undefined;
  for (const [k, v] of Object.entries(node)) if (keyRe.test(k)) return v;
  for (const v of Object.values(node)) {
    const hit = findByKey(v, keyRe, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

// Toda restricción declarada, en el orden en que el genoma la escribió. Un valor puede ser un string
// (`prohibido_geo`), una lista de strings (`prohibido`) o un objeto de strings (`red_lines`): las tres
// formas están sembradas hoy y las tres se aplanan igual. Se deduplica porque una misma prohibición
// suele estar dicha en dos sitios del genoma (la de geolocalización lo está), y repetirla en el prompt
// no la hace más fuerte.
function collectDeclaredProhibitions(node: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > GENOME_WALK_MAX_DEPTH || !isPlainObject(node)) return out;
  const push = (v: unknown) => {
    if (typeof v === "string") { const s = v.trim(); if (s && !out.includes(s)) out.push(s); return; }
    if (Array.isArray(v)) { for (const x of v) push(x); return; }
    if (isPlainObject(v)) { for (const x of Object.values(v)) push(x); }
  };
  for (const [k, v] of Object.entries(node)) {
    if (RESTRICTION_KEY_RE.test(k)) push(v);
    else collectDeclaredProhibitions(v, depth + 1, out);
  }
  return out;
}

// El número declarado. El genoma lo escribe como prosa con el número al frente ("5 — marca, dominio y
// 3 tematicos") porque el mismo campo tiene que decirle a un humano CUÁLES son los 5. Se lee el entero
// que abre; un `5` numérico también vale. Cero es un techo legítimo (el blog declara 0), así que el
// criterio es `>= 0`, no truthy — la diferencia entre "no lleva hashtags" y "nadie lo declaró".
function leadingHashtagCount(declared: unknown): number | null {
  if (typeof declared === "number" && Number.isInteger(declared) && declared >= 0) return declared;
  if (typeof declared !== "string") return null;
  const m = declared.trim().match(/^(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// `application_constraints` + plataforma → lo que el adaptador tiene que respetar.
// NO lanza: una voz sin política de hashtags declarada corre como hoy (sin techo), y la ausencia queda
// NOMBRADA en `max_hashtags_source` — el mismo criterio que F1 usa para el techo de tokens.
function resolveVoiceConstraints(
  applicationConstraints: unknown, platform: string | null | undefined,
): VoiceConstraints {
  if (!isPlainObject(applicationConstraints)) return { ...VOICE_CONSTRAINTS_ABSENT };

  const prohibitions = collectDeclaredProhibitions(applicationConstraints);
  const hashtags = findByKey(applicationConstraints, HASHTAG_KEY_RE);
  if (!isPlainObject(hashtags)) {
    return { ...VOICE_CONSTRAINTS_ABSENT, max_hashtags_source: "genome_no_hashtags", prohibitions };
  }

  const base = findByKey(hashtags, BASE_KEY_RE);
  const hashtag_base = typeof base === "string" && base.trim() ? base.trim() : null;

  const byPlatform = findByKey(hashtags, PLATFORM_KEY_RE);
  const wanted = normalizePlatformKey(platform);
  let declared: unknown = undefined;
  if (isPlainObject(byPlatform) && wanted !== null) {
    for (const [k, v] of Object.entries(byPlatform)) {
      if (normalizePlatformKey(k) === wanted) { declared = v; break; }
    }
  }
  const max_hashtags = leadingHashtagCount(declared);
  if (max_hashtags === null) {
    // La voz declara política de hashtags y esta plataforma no está en ella. Se avisa FUERTE, como el
    // fallback de plataforma de P-e: un techo que no existe no es lo mismo que un techo de infinito, y
    // el silencio fue exactamente lo que dejó pasar 13 hashtags sobre un techo de 5.
    console.warn(
      `[ADAPT-01] la voz declara política de hashtags y no declara techo para '${platform}' ` +
      `(claves declaradas: ${isPlainObject(byPlatform) ? Object.keys(byPlatform).sort().join("|") : "∅"}) ` +
      `→ el adaptador corre SIN techo de hashtags en esta plataforma.`,
    );
    return {
      max_hashtags: null, max_hashtags_source: "genome_no_platform",
      hashtag_composition: null, hashtag_base, prohibitions,
    };
  }
  return {
    max_hashtags,
    max_hashtags_source: "genome_platform",
    hashtag_composition: typeof declared === "string" && declared.trim() ? declared.trim() : null,
    hashtag_base, prohibitions,
  };
}

// EL CONTRATO DEL ADAPTADOR, ACOTADO. Es la mitad del defecto que el techo de hashtags no cubre: el
// adaptador venía reescribiendo el REGISTRO, no sólo el formato, y el texto que recibe ya pasó AIFE y
// el corrector determinista. Reescribir su variante de idioma deshace ese trabajo aguas arriba y es
// trabajo que el adaptador no tiene con qué juzgar: no vio las reglas de la marca.
//
// Escrito en español neutro a propósito — un prompt que pide variante neutra en voseo se contradice a
// sí mismo, y HR-GEN-05 es una de las reglas que este brief mide.
const ADAPTER_CONTRACT =
  "CONTRATO: adaptas FORMA, no VOZ. El texto que recibes ya pasó el filtro de la marca y su corrector: " +
  "su registro, su dialecto y su léxico son los que se publican. Ajusta longitud, corte y formato a la " +
  "plataforma. NO reescribas el registro ni cambies la variante del idioma, ni introduzcas regionalismos " +
  "que el texto recibido no tenga. Si el techo de la plataforma obliga a acortar, RECORTA — no reescribas.";

// ── FIRMA-CABE:BEGIN ── (2026-09-22) LA FIRMA SE INCRUSTA DESPUES, ASI QUE HAY QUE GUARDARLE SITIO.
//
// ── EL DEFECTO, MEDIDO ────────────────────────────────────────────────────────────────────────
//
// Dos piezas de Instagram murieron por pasarse del tope del canal:
//   ForumPHs · la-cuota-por-dentro   2206 / 2200  (+6)    sin la firma (75): 2131 → CABIA
//   NeuroneSCF · color-fade          2308 / 2200  (+108)  sin la firma (84): 2224 → no cabia igual
//
// La primera es exactamente el caso: el adaptador escribio un texto que cabia y la FIRMA lo
// desbordo por seis caracteres. La segunda dice que la firma no es la unica causa —ese texto ya
// venia largo—, pero tambien se habria salvado con sitio reservado y un techo expresado en
// caracteres.
//
// ── POR QUE NO EXISTIA NINGUNA RESERVA ────────────────────────────────────────────────────────
//
// Medido el 2026-09-22, los tres controles que hay y lo que hace cada uno:
//   · `resolveContentTypeCeiling` resuelve `max_tokens` — TOKENS de generacion, no caracteres. Un
//     techo en tokens no sabe cuantos caracteres saldran.
//   · `public.platform_configs.char_target` (Instagram 1200 frente a un `char_limit` de 2200) esta
//     sembrado y NO LO LEE NADIE: cero coincidencias en este repositorio, en SocialLab y en CopyLab.
//   · `captionsQueExcedenElTope`, en el drenaje, compara contra `char_limit` y RETIENE la pieza.
//     Es un freno al final del camino, no un presupuesto al principio.
//
// Es decir: el tope en caracteres solo existia para DECIR QUE NO. Nadie le decia al adaptador
// cuanto espacio tenia, y nadie descontaba la firma que se pega despues.
//
// ── LO QUE ESTE BLOQUE HACE, Y LO QUE NO ──────────────────────────────────────────────────────
//
// Calcula el presupuesto de caracteres del CUERPO: el tope del canal menos la firma, menos un
// margen. Se lo dice al adaptador en su prompt. No recorta nada — recortar por longitud es lo que
// partio `#CuidadoCapilar` en `#CuidadoC` el 2026-09-09. Pedir menos y comprobar despues es otra
// cosa que cortar a ciegas.
//
// EL MARGEN existe porque un presupuesto exacto no deja sitio a nada: el adaptador cumple «no mas
// de N» de forma aproximada, la firma puede llevar salto de linea propio, y `.length` cuenta
// unidades UTF-16 —un emoji cuenta dos—. Es un colchon declarado, no una cifra magica.
//
// Y ES PROPORCIONAL AL TECHO, no fijo. Cuarenta caracteres sobre 1200 son el 3%; sobre los 280 de
// un canal corto son el 14%, que ahi es una frase entera. Se toma el menor entre los 40 declarados
// y el 8% del techo, de modo que el colchon sea el mismo de verdad en canales de tamano distinto.
//
// CERO MARCAS Y CERO PLATAFORMAS: el tope llega como DATO desde `platform_configs` y la firma desde
// `builder_meta`. Un canal nuevo entra sembrando su fila.

/** Colchon sobre el presupuesto, en caracteres. Ver arriba por que no es cero. */
export const FIRMA_MARGEN_CHARS = 40;

/**
 * EL MISMO COLCHON, LEIDO COMO FRACCION DEL TECHO — y manda el MENOR de los dos.
 *
 * Sam, 2026-09-22: «en X el % deberia ser menor». Tenia razon y el numero lo dice: 40 caracteres
 * sobre el techo de Instagram son el 3%; sobre el de X, donde el techo duro son 280, son el 14%.
 * Un colchon fijo no es el mismo colchon en dos canales de tamano distinto: en el corto se come una
 * frase entera.
 *
 * 8% es la cifra que fijo Sam. Sobre un techo de 240 en X da 19 caracteres en vez de 40, y sobre
 * los 900 de Instagram da 72 — que es MAS que 40, y por eso se toma el menor: el colchon no crece
 * porque el canal sea largo; ahi 40 ya sobran.
 *
 * CERO CANALES NOMBRADOS. La fraccion se aplica al techo que resuelva el dato, sea cual sea el
 * canal y sea cual sea la marca. Un canal nuevo no necesita una rama: necesita su fila.
 */
export const FIRMA_MARGEN_RATIO = 0.08;

/**
 * LA MITAD DEL TECHO ES DEL CUERPO, O NO HAY PRESUPUESTO.
 *
 * El colchon dejo de ser fijo, y eso destapo un caso que el 40 tapaba por aritmetica: con una firma
 * de 252 sobre un techo de 280, el presupuesto salia 6. Antes salia 0 o negativo y se devolvia
 * `null`; ahora sale positivo, y «no pases de 6 caracteres» es tan absurdo como «no pases de -12».
 *
 * La regla que lo cierra no es un numero magico sino un limite explicable: si la firma y el colchon
 * se llevan MAS DE LA MITAD del techo, el problema no es el presupuesto — es que esa firma no cabe
 * en ese canal. Se devuelve `null`, se corre como hasta hoy y el freno del drenaje sigue detras.
 */
export const PRESUPUESTO_MINIMO_RATIO = 0.5;

/**
 * El presupuesto del CUERPO, ya descontada la firma. `null` = nadie declara tope.
 *
 * DOS TOPES, Y GANA EL MENOR — porque responden a preguntas distintas:
 *   `charLimit`  lo que la PLATAFORMA acepta (`platform_configs.char_limit`). Un maximo duro.
 *   `maxChars`   lo que la MARCA quiere en ese canal (`content_type_registry.max_chars`, por la
 *                cascada voz+plataforma). Un objetivo editorial, siempre menor o igual.
 *
 * Sam, 2026-09-22, sobre Instagram: «su publico no lee demasiado y menos en esa plataforma». Eso es
 * del publico de UNA marca, asi que vive en una fila de esa marca y no en el tope del canal.
 *
 * Los dos son OPCIONALES y por separado: una marca puede declarar su largo en un canal sin tope
 * duro declarado, y un canal puede tener tope sin que ninguna marca declare nada.
 *
 * `maxChars` es el POST COMPLETO, firma incluida — de ahi que se le reste igual que al otro.
 */
export function presupuestoDeCuerpo(
  charLimit: number | null | undefined,
  firma: string | null | undefined,
  margen: number = FIRMA_MARGEN_CHARS,
  maxChars: number | null | undefined = null,
): number | null {
  const util = (n: unknown): number | null => {
    const v = Number(n);
    return n === null || n === undefined || !Number.isFinite(v) || v <= 0 ? null : v;
  };
  const delCanal = util(charLimit);
  const deLaMarca = util(maxChars);
  // El menor de los dos declarados. Si solo hay uno, ese manda; si no hay ninguno, no hay tope.
  const tope = delCanal !== null && deLaMarca !== null ? Math.min(delCanal, deLaMarca)
             : (deLaMarca ?? delCanal);
  if (tope === null) return null;
  // La firma viaja con su separador: `canonicalizeSignature` la pega tras una linea en blanco, y
  // esos dos caracteres cuentan igual que los demas.
  const firmaLen = typeof firma === "string" && firma.trim() ? firma.trim().length + 2 : 0;
  // EL COLCHON, ACOTADO POR LOS DOS LADOS: nunca mas de lo declarado en caracteres, y nunca mas de
  // la fraccion del techo. `Math.floor` y no `round` porque redondear hacia arriba gasta un caracter
  // que el cuerpo podria usar, y aqui lo que se reparte es espacio de escritura.
  const margenEfectivo = Math.min(Math.max(0, margen), Math.floor(tope * FIRMA_MARGEN_RATIO));
  const presupuesto = tope - firmaLen - margenEfectivo;
  // UN PRESUPUESTO QUE NO DEJA ESCRIBIR NO ES UN PRESUPUESTO. Si la firma y el margen se llevan mas
  // de la mitad del tope —un canal de 280 con una firma de 250—, se devuelve `null`: mejor correr
  // como hasta hoy y que el freno del drenaje retenga la pieza, que mandarle un numero absurdo.
  return presupuesto >= tope * PRESUPUESTO_MINIMO_RATIO ? presupuesto : null;
}

/**
 * El presupuesto, dicho en el prompt. `""` cuando no hay tope declarado: una plataforma sin fila
 * corre con el prompt de hoy, byte por byte.
 *
 * Se le dice el numero y POR QUE es menor que el tope del canal. Sin el motivo, un adaptador —o
 * quien lea este prompt dentro de seis meses— concluye que el tope de Instagram son 2085.
 */
export function buildBudgetBlock(presupuesto: number | null): string {
  if (presupuesto === null) return "";
  return `PRESUPUESTO: el texto adaptado no puede pasar de ${presupuesto} caracteres. `
    + "Es MENOS que el tope del canal a proposito: la firma de la marca se incrusta DESPUES de esto "
    + "y tiene que caber. Si no entra, recorta contenido — nunca la firma, que no es tuya.";
}

// FIRMA-CABE-02 (2026-09-27) — EL PRESUPUESTO SE PEDIA Y NADIE LO COMPROBABA.
//
// Medido en la pieza IG `6bb3ebc0`: presupuesto de cuerpo 2076 (2200 − firma 84 − colchon 40), y el
// adaptador devolvio 2153. Con la firma, 2237: el drenaje la retiene y Meta la habria rechazado
// (codigo 36004, como el 2026-09-09). Pedir un largo a un modelo no garantiza el largo. Ahora se
// MIDE lo que vuelve y, si se pasa, se pide UNA vez mas con el numero exacto. No se corta nunca a
// ciegas: si el segundo intento tambien se pasa, gana el mas corto y el freno del drenaje sigue ahi.

/** `true` si el cuerpo adaptado no cabe en su presupuesto. Sin presupuesto declarado, nunca. */
export function excedePresupuesto(texto: string, presupuesto: number | null): boolean {
  return presupuesto !== null && typeof texto === "string" && texto.length > presupuesto;
}

/** El pedido del reintento: cuanto midio, cuanto cabe y cuanto hay que quitar. */
export function buildBudgetRetryMessage(largo: number, presupuesto: number): string {
  return `Tu version anterior media ${largo} caracteres y el presupuesto es ${presupuesto}. `
    + `Reescribela con ${largo - presupuesto} caracteres menos como minimo: quita frases enteras de `
    + "apoyo o hashtags, nunca la llamada a la accion ni el sentido. Devuelve solo el texto.";
}
// ── FIRMA-CABE:END ──

// ── TECHO-CUMPLE:BEGIN ── (2026-10-22) EL TECHO DE LA MARCA SE CUMPLE: SE QUITAN FRASES ENTERAS, NUNCA MEDIA.
//
// ── EL DEFECTO, MEDIDO EL 2026-10-22 ──────────────────────────────────────────────────────────
//
// `content_type_registry.max_chars` declara 900 para la voz de conversión de una marca en Instagram,
// y lo publicado de esa marca en ese canal tiene una mediana de 1.804 caracteres. El techo llegaba a
// todas partes y no frenaba en ninguna:
//   · al ESCRITOR le llega como regla (`HR-GEN-14`, `{{max_chars}}`) y, en el mismo prompt, CopyLab
//     le da un «PRESUPUESTO DE LONGITUD» derivado de `max_tokens` (1.200 × 3 = 3.600 caracteres), que
//     va después y tiene la última palabra. El maestro sale de 1.500 a 3.300 caracteres.
//   · al ADAPTADOR le llega como presupuesto (FIRMA-CABE) y FIRMA-CABE-02 le pide una reescritura
//     con el número; si la segunda versión también se pasa, «gana el más corto» y sigue de largo.
//     Medido en 7 piezas de esa voz: el adaptado salió entre 735 y 961 contra un presupuesto de 774.
//   · el AUTO-FIX repara el texto del canal con CopyLab y ese texto vuelve SIN presupuesto: la pieza
//     `8f8db518` pasó de 843 caracteres adaptados a 1.815 publicados. Nadie lo medía después.
//
// ── LO QUE HACE ESTE BLOQUE ───────────────────────────────────────────────────────────────────
//
// Una sola operación, determinista y sin modelo: si el texto del canal no cabe en su presupuesto, se
// QUITAN FRASES ENTERAS hasta que cabe. Nunca se corta una frase, nunca una palabra, nunca un hashtag
// —el corte por longitud es lo que partió `#CuidadoCapilar` en `#CuidadoC` el 2026-09-09—.
//
// QUÉ SE PROTEGE, en este orden:
//   1. el GANCHO: la primera frase del primer párrafo;
//   2. el CIERRE: el último párrafo entero (o la última frase, si la pieza tiene un solo párrafo),
//      que es donde viven la llamada y la conversión;
//   3. la COLA DE HASHTAGS y la FIRMA, que Sam quiere fijas.
//   4. toda frase que NOMBRA un término protegido —los productos y kits de la oferta de la pieza, que
//      llegan como dato—: medido en la simulación sobre 20 piezas reales, un recorte ciego se llevaba el
//      párrafo del producto, que el genoma prohíbe perder al adaptar («prohibido_al_adaptar»).
// Qué se quita: el desarrollo, desde el final hacia el principio. PRIMERO PÁRRAFOS ENTEROS (el
// penúltimo primero): un párrafo entero que sale deja el texto coherente; una frase suelta deja una
// premisa sin su remate. Sólo si quitando todos los párrafos del desarrollo que se pueden quitar sigue
// sin caber, se quitan frases sueltas de lo que queda, también desde el final. Si quitando todo lo que
// no está protegido sigue sin caber, NO se toca nada y se dice (`no_cabe_sin_romper`): un texto
// destripado que tampoco cabe es peor que el original, y el freno del drenaje (tope del canal) sigue
// detrás.
//
// LA FIRMA Y LOS HASHTAGS, DECIDIDO: el presupuesto que llega aquí es el de `presupuestoDeCuerpo`,
// que ya DESCUENTA la firma (su largo más un colchón). Por eso la firma no se mide aquí: si el texto
// la trae, se aparta, se mide sin ella y se devuelve al final. Los HASHTAGS SÍ cuentan contra el
// presupuesto —son texto que se publica y que el lector ve—, pero nunca se quitan: se quitan frases.
//
// COSTO: cero llamadas. La reescritura con el techo (una vez) ya la hace FIRMA-CABE-02 en el
// adaptador; esto es lo que pasa cuando esa reescritura no basta, y lo que pasa con el texto que
// devuelve el auto-fix, al que nadie le pedía largo.
//
// CERO MARCAS Y CERO PLATAFORMAS: el presupuesto llega resuelto desde el dato.

export type RecorteMotivo = "sin_presupuesto" | "cabe" | "recortado" | "no_cabe_sin_romper";
export type RecortePorFrase = {
  texto: string; cambio: boolean; motivo: RecorteMotivo;
  presupuesto: number | null; largo_antes: number; largo_despues: number; frases_quitadas: number;
};

/** Una línea que sólo trae hashtags (o está vacía) es cola: se protege y cuenta. */
function esColaDeHashtags(linea: string): boolean {
  const t = linea.trim();
  return t === "" || /^(?:#[\p{L}\p{N}_]+[\s,.·]*)+$/u.test(t);
}

/** Parte un párrafo en frases conservando el espacio que sigue a cada una. Una frase termina en
 *  `.`, `!`, `?` o `…` (con sus comillas o paréntesis de cierre) seguida de espacio y de algo que
 *  abre una frase nueva: mayúscula, cifra o signo de apertura. Un «3.5» o un «p. ej.» no parten. */
export function frasesDe(parrafo: string): Array<{ texto: string; sep: string }> {
  const out: Array<{ texto: string; sep: string }> = [];
  const re = /[.!?…]+["»”’)\]]*(\s+)(?=["«“¿¡(\[]?[\p{Lu}\p{N}])/gu;
  let desde = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(parrafo)) !== null) {
    const fin = m.index + m[0].length - m[1].length;
    // Un trozo sin letras («1.», «2)») no es una frase: es el número de un paso y va con lo que sigue.
    if (!/\p{L}/u.test(parrafo.slice(desde, fin))) continue;
    out.push({ texto: parrafo.slice(desde, fin), sep: m[1] });
    desde = m.index + m[0].length;
  }
  const resto = parrafo.slice(desde);
  if (resto.trim() !== "") out.push({ texto: resto, sep: "" });
  return out;
}

/** Los nombres de la oferta que la pieza recibió (`builder_input.offer_catalog.items[].name`): lo que el
 *  recorte protege. Lee el mismo sitio que `offerItemsOf`. Sin oferta, lista vacía. PURA. */
export function nombresDeLaOferta(assets: any): string[] {
  const oc = assets?.builder_input?.offer_catalog ?? assets?.offer_catalog ?? null;
  const items = Array.isArray(oc?.items) ? oc.items : [];
  return items.map((it: any) => (typeof it?.name === "string" ? it.name.trim() : "")).filter((x: string) => x.length >= 3);
}

/** El texto del canal sin frases de más. PURA. Ver la cabecera del bloque. */
export function recortarPorFrase(
  texto: string, presupuesto: number | null | undefined, firma: string | null | undefined = null,
  protegidos: string[] = [],
): RecortePorFrase {
  const original = typeof texto === "string" ? texto : "";
  const p = Number(presupuesto);
  const sinPresupuesto = presupuesto === null || presupuesto === undefined || !Number.isFinite(p) || p <= 0;
  const firmaT = typeof firma === "string" ? firma.trim() : "";
  const escFirma = firmaT ? firmaT.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") : "";
  const traeFirma = !!firmaT && original.includes(firmaT);
  const sinFirma = traeFirma ? original.replace(new RegExp(`\\s*${escFirma}`, "gu"), "").replace(/\s+$/u, "") : original.replace(/\s+$/u, "");
  const largoAntes = sinFirma.length;
  const igual = (motivo: RecorteMotivo): RecortePorFrase => ({
    texto: original, cambio: false, motivo, presupuesto: sinPresupuesto ? null : p,
    largo_antes: largoAntes, largo_despues: largoAntes, frases_quitadas: 0,
  });
  if (sinPresupuesto) return igual("sin_presupuesto");
  if (largoAntes <= p) return igual("cabe");

  // La cola: las líneas finales que sólo traen hashtags. Se protege entera y se mide.
  const lineas = sinFirma.split("\n");
  let corte = lineas.length;
  while (corte > 0 && esColaDeHashtags(lineas[corte - 1])) corte--;
  const cola = lineas.slice(corte).join("\n").trim();
  const prosa = lineas.slice(0, corte).join("\n").replace(/\s+$/u, "");

  const parrafos = prosa.split(/\n[ \t]*\n/u).map((x) => frasesDe(x.trim()));
  const vivas = parrafos.map((f) => f.map(() => true));
  const armar = (): string => {
    const ps = parrafos
      .map((fr, i) => fr.filter((_, j) => vivas[i][j]).map((x, k, arr) => x.texto + (k < arr.length - 1 ? (x.sep || " ") : "")).join(""))
      .filter((x) => x.trim() !== "");
    return ps.join("\n\n") + (cola ? `\n\n${cola}` : "");
  };
  // Lo que nombra un término protegido no se quita. Comparación sin mayúsculas ni tildes.
  const llano = (x: string) => x.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const terminos = (protegidos ?? []).filter((x) => typeof x === "string" && x.trim().length >= 3).map((x) => llano(x.trim()));
  const nombra = (frase: string) => { const f = llano(frase); return terminos.some((t) => f.includes(t)); };
  const n = parrafos.length;
  // Qué frases se pueden quitar: todo el desarrollo salvo el gancho, el cierre y lo que nombra un protegido.
  const quitable = (i: number, j: number): boolean => {
    if (i === 0 && j === 0) return false;
    if (n >= 2 && i === n - 1) return false;
    if (n === 1 && j === parrafos[0].length - 1) return false;
    return !nombra(parrafos[i][j].texto);
  };
  let quitadas = 0;
  let actual = armar();
  // 1 · párrafos enteros del desarrollo, del penúltimo hacia atrás (el primero no: lleva el gancho).
  for (let i = n - 2; i >= 1 && actual.length > p; i--) {
    if (!parrafos[i].every((_, j) => quitable(i, j))) continue;
    for (let j = 0; j < parrafos[i].length; j++) if (vivas[i][j]) { vivas[i][j] = false; quitadas++; }
    actual = armar();
  }
  // 2 · frases sueltas de lo que queda, desde el final hacia atrás.
  const candidatas: Array<[number, number]> = [];
  for (let i = n - 1; i >= 0; i--) for (let j = parrafos[i].length - 1; j >= 0; j--) if (vivas[i][j] && quitable(i, j)) candidatas.push([i, j]);
  for (const [i, j] of candidatas) {
    if (actual.length <= p) break;
    vivas[i][j] = false;
    quitadas++;
    actual = armar();
  }
  if (actual.length > p || quitadas === 0) return igual("no_cabe_sin_romper");
  const final = traeFirma ? `${actual}\n\n${firmaT}` : actual;
  return {
    texto: final, cambio: true, motivo: "recortado", presupuesto: p,
    largo_antes: largoAntes, largo_despues: actual.length, frases_quitadas: quitadas,
  };
}
// ── TECHO-CUMPLE:END ──

// ── ANTIRREPETICION:BEGIN ── (2026-10-22) LO QUE YA SE USÓ, EL ESCRITOR LO SABE ANTES DE ESCRIBIR.
//
// ── EL DEFECTO, MEDIDO EL 2026-10-22 ──────────────────────────────────────────────────────────
//
// En 97 copies de Meta de una marca: «En la silla» en 43, la llamada a pedir el diagnóstico a la persona
// de la marca en 57, «No es tu culpa» en 11, «Te digo algo» en 10; aperturas «En la silla…» 6, «Te
// miras al espejo» 5. En otra marca, «I read» (o su equivalente en español) en 24 de 45 y «as I see it
// / to me» en 17. La causa es de DATO y de MOTOR:
//   · el genoma pone esas frases en `lexicon_signature` como LÉXICO FIRMADO, sin decir que roten, y
//     `syntactic_signatures` exige alguna literal («te digo algo… y te digo más»);
//   · el escritor no sabe qué se publicó ayer: cada pieza nace sin memoria de las anteriores, así que
//     la fórmula que mejor encaja con la voz es la misma cada vez.
//
// ── LO QUE HACE ESTE BLOQUE ───────────────────────────────────────────────────────────────────
//
// Mide, sobre las últimas N piezas sociales de la marca, tres cosas, y se las dice al escritor:
//   · APERTURAS: las primeras palabras de la primera frase;
//   · CIERRES: las primeras palabras de la última frase;
//   · MULETILLAS: cada frase del REPERTORIO de la voz (`lexicon_signature.repertorio_rotativo`) que
//     apareció. `___` en una frase del repertorio es un hueco: «thats not ___. thats ___.» cuenta
//     aunque cambien las palabras de dentro.
// Una fórmula entra en la lista si salió en `umbral_piezas` piezas o más. Las que no salieron quedan
// libres: eso es lo que hace que el repertorio ROTE en vez de desaparecer.
//
// LO QUE NO SE MIDE NUNCA, por decisión de Sam (2026-10-22: «los patrones de firmas, hashtags
// permanentes, etc., son necesarios»): la FIRMA de la voz y los HASHTAGS. Los dos se quitan del texto
// antes de medir, así que no pueden entrar en la lista. Y tampoco lo que la propia pieza tiene que
// decir: una fórmula contenida en un texto PROTEGIDO —la instrucción de formato del canal, las
// exclusiones que declara la voz (`excluir`), la firma, los hashtags fijos— no se prohíbe, porque
// prohibir lo que otra regla exige deja al escritor sin salida.
//
// ── CUÁNDO CORRE ──────────────────────────────────────────────────────────────────────────────
//
// SÓLO si la voz lo declara, en `application_constraints.anti_repetition` (objeto). Sin declaración,
// el carril no lee nada y el prompt queda BYTE-IDÉNTICO. Los parámetros son dato, con su arranque:
//   ventana_piezas 20 · umbral_piezas 2 · palabras_por_formula 3 · excluir [].
//
// CERO MARCAS, CERO VOCES Y CERO FRASES EN EL CÓDIGO: el repertorio, las exclusiones y la ventana son
// del genoma; los textos medidos son de la base. Este bloque no conoce ninguna fórmula.

export type PoliticaAntirrepeticion = { ventana: number; umbral: number; palabras: number; excluir: string[] };
export type FormulaUsada = { formula: string; piezas: number };
export type MedicionAntirrepeticion = {
  piezas_medidas: number; aperturas: FormulaUsada[]; cierres: FormulaUsada[]; muletillas: FormulaUsada[];
};

const ANTIRREP_VENTANA_DEFECTO = 20;
const ANTIRREP_UMBRAL_DEFECTO = 2;
const ANTIRREP_PALABRAS_DEFECTO = 3;
/** Cuántas fórmulas de cada clase entran en el bloque, como mucho: una lista larga deja de leerse. */
export const ANTIRREP_MAX_POR_CLASE = 8;

/** La política de la voz, o `null` si no la declara. Un valor fuera de rango cae a su arranque. */
export function politicaAntirrepeticion(genome: any): PoliticaAntirrepeticion | null {
  const raw = genome?.application_constraints?.anti_repetition;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entero = (v: unknown, def: number, min: number, max: number): number => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : def;
  };
  const excluir = (Array.isArray(raw.excluir) ? raw.excluir : [])
    .filter((x: unknown) => typeof x === "string" && x.trim()).map((x: string) => x.trim());
  return {
    ventana: entero(raw.ventana_piezas, ANTIRREP_VENTANA_DEFECTO, 1, 100),
    umbral: entero(raw.umbral_piezas, ANTIRREP_UMBRAL_DEFECTO, 1, 100),
    palabras: entero(raw.palabras_por_formula, ANTIRREP_PALABRAS_DEFECTO, 2, 8),
    excluir,
  };
}

/** El repertorio que rota: `lexicon_signature.repertorio_rotativo`. Un léxico en forma de lista (la
 *  forma anterior) no declara qué es fórmula y qué es vocabulario de marca: no se mide. */
export function repertorioRotativo(genome: any): string[] {
  const lex = genome?.lexicon_signature;
  const r = lex && typeof lex === "object" && !Array.isArray(lex) ? lex.repertorio_rotativo : null;
  return (Array.isArray(r) ? r : []).filter((x: unknown) => typeof x === "string" && x.trim()).map((x: string) => x.trim());
}

/** Minúsculas, sin tildes y con el espacio aplanado: «Diagnóstico» y «diagnostico» son la misma fórmula. */
function plano(s: string): string {
  return String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** El texto que se mide: sin la firma y sin ningún hashtag. */
function textoMedible(texto: string, firma: string | null): string {
  let t = String(texto ?? "");
  const f = typeof firma === "string" ? firma.trim() : "";
  if (f) t = t.split(f).join(" ");
  return t.replace(/#[\p{L}\p{N}_]+/gu, " ").replace(/[ \t]+\n/gu, "\n").trim();
}

/** Las frases del texto, en orden, sin las vacías. */
function frasesDelTexto(t: string): string[] {
  return t.split(/\n[ \t]*\n|\n/u).flatMap((p) => p.split(/(?<=[.!?…]["»”’)\]]*)\s+(?=["«“¿¡(\[]?[\p{Lu}\p{N}])/u))
    .map((x) => x.trim()).filter((x) => /\p{L}/u.test(x));
}

/** Las primeras `n` palabras de una frase, tal como se escribieron (para mostrarlas) y planas (para contarlas). */
function cabezaDe(frase: string, n: number): { vista: string; clave: string } {
  const palabras = frase.replace(/^["«“¿¡(\[\s—-]+/u, "").split(/\s+/u).filter(Boolean).slice(0, n);
  const vista = palabras.join(" ").replace(/[,;:.!?…]+$/u, "");
  return { vista, clave: plano(vista).replace(/[^\p{L}\p{N} ]/gu, "").trim() };
}

/** Una frase del repertorio como patrón: `___` es un hueco de hasta cuarenta caracteres. */
function patronDe(frase: string): RegExp {
  const partes = plano(frase).split(/_{2,}/u).map((x) => x.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  return new RegExp(`(?<![\\p{L}\\p{N}])${partes.join(".{1,40}?")}(?![\\p{L}\\p{N}])`, "u");
}

/** ¿La fórmula está dentro de algo que la pieza tiene que decir? */
function protegida(formula: string, protegidos: string[]): boolean {
  const f = plano(formula).replace(/[^\p{L}\p{N} ]/gu, "").trim();
  if (!f) return true;
  return protegidos.some((p) => plano(p).replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/gu, " ").includes(f));
}

/** La medición. PURA: recibe los textos ya leídos, de la pieza más reciente a la más antigua. */
export function medirFormulasRecientes(
  textos: string[], repertorio: string[], politica: PoliticaAntirrepeticion,
  opts: { firma?: string | null; protegidos?: string[] } = {},
): MedicionAntirrepeticion {
  const firma = opts.firma ?? null;
  const protegidos = [...(opts.protegidos ?? []), ...politica.excluir, ...(firma ? [firma] : [])]
    .filter((x) => typeof x === "string" && x.trim());
  const ventana = (textos ?? []).filter((t) => typeof t === "string" && t.trim()).slice(0, politica.ventana);
  const contar = (m: Map<string, { vista: string; piezas: number }>, clave: string, vista: string) => {
    const e = m.get(clave);
    if (e) e.piezas++; else m.set(clave, { vista, piezas: 1 });
  };
  const aperturas = new Map<string, { vista: string; piezas: number }>();
  const cierres = new Map<string, { vista: string; piezas: number }>();
  const muletillas = new Map<string, { vista: string; piezas: number }>();
  const patrones = repertorio.map((r) => ({ frase: r, re: patronDe(r) }));
  for (const t of ventana) {
    const medible = textoMedible(t, firma);
    const frases = frasesDelTexto(medible);
    if (frases.length) {
      const a = cabezaDe(frases[0], politica.palabras);
      if (a.clave) contar(aperturas, a.clave, a.vista);
      if (frases.length > 1) {
        const c = cabezaDe(frases[frases.length - 1], politica.palabras);
        if (c.clave) contar(cierres, c.clave, c.vista);
      }
    }
    const pl = plano(medible);
    for (const p of patrones) if (p.re.test(pl)) contar(muletillas, plano(p.frase), p.frase);
  }
  const lista = (m: Map<string, { vista: string; piezas: number }>): FormulaUsada[] =>
    [...m.values()].filter((e) => e.piezas >= politica.umbral && !protegida(e.vista, protegidos))
      .sort((x, y) => y.piezas - x.piezas || x.vista.localeCompare(y.vista))
      .slice(0, ANTIRREP_MAX_POR_CLASE).map((e) => ({ formula: e.vista, piezas: e.piezas }));
  return { piezas_medidas: ventana.length, aperturas: lista(aperturas), cierres: lista(cierres), muletillas: lista(muletillas) };
}

/** El bloque para el escritor. `""` si no hay nada que decir: entonces nada cambia. */
export function bloqueAntirrepeticion(m: MedicionAntirrepeticion | null): string {
  if (!m || (!m.aperturas.length && !m.cierres.length && !m.muletillas.length)) return "";
  const linea = (titulo: string, xs: FormulaUsada[], suspensivos: boolean) => xs.length
    ? `· ${titulo}: ${xs.map((x) => `«${x.formula}${suspensivos ? "…" : ""}» (${x.piezas})`).join(", ")}.` : "";
  return [
    `NO REPITAS LO QUE YA SE USÓ. Estas fórmulas salieron en las últimas ${m.piezas_medidas} piezas sociales de la marca (entre paréntesis, en cuántas). Esta pieza no abre, no cierra ni usa ninguna de ellas, ni una variación cercana: busca otra entrada, otra salida y otras palabras dentro de la misma voz. La firma y los hashtags fijos no cuentan: se mantienen como siempre.`,
    linea("Aperturas ya usadas", m.aperturas, true),
    linea("Cierres ya usados", m.cierres, true),
    linea("Frases del repertorio ya usadas", m.muletillas, false),
  ].filter(Boolean).join("\n");
}

/** La instrucción de formato con el bloque al final. Sin bloque, la MISMA cadena (o el mismo `null`). */
export function conAntirrepeticion(formatInstruction: string | null, bloque: string): string | null {
  if (!bloque) return formatInstruction;
  const base = typeof formatInstruction === "string" ? formatInstruction.trim() : "";
  return base ? `${base}\n\n${bloque}` : bloque;
}
// ── ANTIRREPETICION:END ──

// La lectura de la ventana: las últimas piezas SOCIALES de la marca, vivas, una por hallazgo (las
// variantes de un mismo hallazgo en dos plataformas son una sola pieza para el lector que sigue a la
// marca, y contarlas dos veces inflaría la fórmula). El texto es el del CANAL, sin firma, por
// `corpusTextOf`: lo que se publica, no el maestro. FAIL-SOFT: una lectura caída deja la ventana vacía
// y se avisa; la pieza se escribe igual, como antes de este cambio.
async function loadRecentSocialTexts(brandId: string, ventana: number, trace: string): Promise<string[]> {
  if (!brandId || !(ventana > 0)) return [];
  const { data, error } = await sbContent().from("content_pieces")
    .select("id,finding_id,platform,assets,created_at")
    .eq("brand_id", brandId).is("discarded_at", null)
    .order("created_at", { ascending: false }).limit(Math.min(ventana * 6, 300));
  if (error) { console.warn(`[ANTIRREPETICION] ${trace} content_pieces SELECT falló: ${error.message} — sin ventana`); return []; }
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const r of (data ?? []) as any[]) {
    if (String(r?.assets?.builder_input?.destination ?? "") !== "social") continue;
    const clave = String(r?.finding_id ?? r?.id ?? "");
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const t = stripInlineImageMarks(corpusTextOf(r.assets, r.platform).text);
    if (bNonEmpty(t)) out.push(t);
    if (out.length >= ventana) break;
  }
  return out;
}

// ── TAG-AJENO:BEGIN ── (2026-09-22) UN HASHTAG NOMBRA A QUIEN PUBLICA, NO A QUIEN FABRICA.
//
// ── EL DEFECTO, MEDIDO ────────────────────────────────────────────────────────────────────────
//
// `#SocialLabUNRLVL`, `#SocialLab` y `#SocialLabTips` aparecian en NUEVE piezas vivas de DOS
// marcas, y una ya se habia publicado con el suyo. Es el nombre del lab que fabrica el post,
// colgado en la cuenta publica del cliente.
//
// No sale de ninguna linea de este repositorio: cero coincidencias de esos literales fuera de los
// comentarios. Lo escribe el modelo. `PLATFORM_RULES.INSTAGRAM` le pide «8-15 hashtags al final»,
// el nombre del lab esta en su contexto, y el modelo lo convierte en etiqueta como convertiria
// cualquier otro nombre propio que tuviera a mano.
//
// Sam, 2026-09-22: «los hashtags no son coherentes en esa marca ni en ninguna que no sea la propia».
//
// ── EL EJE, Y POR QUE NO ES UNA LISTA ─────────────────────────────────────────────────────────
//
// Un hashtag nombra a la marca que publica y a su tema. Nunca a otra marca del sistema, nunca a una
// pieza de nuestra maquinaria. Eso es del SISTEMA: vale para las cuatro marcas de hoy y para la que
// entre manana, y no depende del gusto de ninguna.
//
// Los NOMBRES no se escriben aqui. Llegan como DATO —`public.lab_configs` y `public.brands`— y este
// bloque no sabe cuantos son ni cuales. Un lab nuevo o una marca nueva quedan cubiertos el dia que
// se siembran, sin tocar una linea. Si la lista llega vacia no se barre nada y se declara: un
// barrido que no sabe que proteger no debe adivinarlo.
//
// ── POR QUE SE BORRA Y NO SE AVISA ────────────────────────────────────────────────────────────
//
// El resto de este archivo mide y declara sin tocar —el techo de hashtags se CUENTA, no se recorta,
// porque elegir cual de trece se va exige entender el texto—. Aqui es distinto y la diferencia es
// la que justifica el trato: no hay que elegir. Un tag que nombra nuestra maquinaria esta mal
// SIEMPRE, lo diga quien lo diga, y quitarlo no exige leer nada. Lo que se quita queda anotado en
// `assets.social.voice_constraints`, de modo que un barrido demasiado ancho se vea en el dato.
//
// ── TRES CAUTELAS, cada una por un caso que aparecio al medir ─────────────────────────────────
//   · `NOMBRE_MIN_CHARS` — `lab_key` incluye `meta`, y con cuatro letras cazaria `#Metabolismo`.
//   · la marca PROPIA nunca es ajena — `#UnrealvilleStudio` es correcto en su propia cuenta.
//   · se compara sin acentos y sin signos por los dos lados, para que `#VivoseMask` reconozca a
//     `Vivose Mask`.
//
// CERO MARCAS Y CERO LABS EN ESTE BLOQUE. `tests/tag_ajeno_test.mjs` lo rechaza si nombra uno.

/** Por debajo de esto un nombre es demasiado corto para distinguirse de una palabra cualquiera. */
export const NOMBRE_MIN_CHARS = 6;

/** Lo nuestro, tal como llega del dato. `maquinaria` no tiene dueño; una marca sí, y es el suyo. */
export type NombresPropios = {
  maquinaria: string[];
  marcas: Array<{ dueno: string; nombre: string }>;
};

/**
 * La forma comparable de un nombre: sin acentos, sin signos, en minúsculas. Se aplica IGUAL a los
 * dos lados —al hashtag y al nombre declarado— porque normalizar sólo uno es no normalizar.
 */
export function normalizarNombre(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();
}

/**
 * ¿Este hashtag nombra algo nuestro que no sea la marca que publica?
 *
 * Se compara por CONTENCIÓN y no por igualdad: `#SocialLabUNRLVL` y `#SocialLabTips` no son el
 * nombre del lab, lo LLEVAN DENTRO — y son exactamente los dos que aparecieron.
 */
export function esTagAjeno(
  tag: string, propios: NombresPropios, marcaPropia: unknown,
): boolean {
  const t = normalizarNombre(tag);
  if (!t) return false;
  const mia = normalizarNombre(marcaPropia);
  for (const nombre of propios?.maquinaria ?? []) {
    const n = normalizarNombre(nombre);
    if (n.length >= NOMBRE_MIN_CHARS && t.includes(n)) return true;
  }
  for (const m of propios?.marcas ?? []) {
    const n = normalizarNombre(m?.nombre);
    // La marca propia NO es ajena en su propia cuenta. Se compara por el DUEÑO declarado, no por el
    // nombre: una marca puede tener varios nombres y todos son suyos.
    if (normalizarNombre(m?.dueno) === mia && mia !== "") continue;
    if (n.length >= NOMBRE_MIN_CHARS && t.includes(n)) return true;
  }
  return false;
}

/** Los hashtags de un texto, con su posición, para poder quitarlos sin tocar nada más. */
const TAG_RE = /#[\p{L}\p{N}_]+/gu;

/**
 * Quita del texto los hashtags ajenos y devuelve cuáles eran.
 *
 * Se lleva el espacio horizontal que los precede y NO el salto de línea: comerse el salto juntaría
 * dos párrafos que el autor separó. Después se limpia el espacio que quedara al final de una línea,
 * que es lo único que el corte puede dejar sucio.
 */
export function quitarTagsAjenos(
  texto: unknown, propios: NombresPropios, marcaPropia: unknown,
): { texto: string; quitados: string[] } {
  const original = typeof texto === "string" ? texto : "";
  if (!original) return { texto: original, quitados: [] };
  const quitados: string[] = [];
  const limpio = original.replace(
    new RegExp(`[ \\t]*${TAG_RE.source}`, "gu"),
    (m) => {
      const tag = m.trim();
      if (!esTagAjeno(tag, propios, marcaPropia)) return m;
      if (!quitados.includes(tag)) quitados.push(tag);
      return "";
    },
  );
  if (quitados.length === 0) return { texto: original, quitados };
  return { texto: limpio.replace(/[ \t]+(\n|$)/g, "$1"), quitados };
}

/**
 * La línea del prompt que le pide al adaptador que no los escriba. `""` cuando no hay nada que
 * proteger: un prompt que prohíbe una lista vacía enseña a ignorar la instrucción.
 *
 * Se le dice EL PORQUÉ. Sin el motivo, un modelo que ve el nombre del lab en su contexto concluye
 * que es parte de la marca, que es exactamente como llegó a escribirlo.
 */
export function buildTagAjenoBlock(propios: NombresPropios): string {
  const hay = (propios?.maquinaria?.length ?? 0) + (propios?.marcas?.length ?? 0);
  if (hay === 0) return "";
  return "HASHTAGS: los que escribas nombran a la marca que publica y al tema del post, y nada mas. "
    + "Nunca el nombre de otra marca del sistema, nunca el de una herramienta que haya intervenido "
    + "en fabricarlo. Quien lee la cuenta es publico de esa marca: un nombre de nuestra maquinaria "
    + "ahi no le dice nada y delata de donde salio el post.";
}
// ── TAG-AJENO:END ──

// Las restricciones, en el prompt. Devuelve "" cuando la voz no declara ninguna: una voz sin genoma
// sembrado corre con el prompt de hoy, byte por byte salvo el contrato. Cero migración.
//
// LA PRECEDENCIA SE DICE. `PLATFORM_RULES` es lore genérico de plataforma ("8-15 hashtags al final") y
// el genoma es la declaración de la marca. Cuando difieren manda la marca, y hay que decirlo EN EL
// PROMPT: dejar las dos instrucciones juntas y en silencio es lo que produjo las 13 etiquetas.
function buildVoiceConstraintsBlock(vc: VoiceConstraints): string {
  const lines: string[] = [];
  if (vc.max_hashtags !== null) {
    lines.push(
      `· Hashtags: COMO MÁXIMO ${vc.max_hashtags} en esta plataforma. Es un techo de la voz y MANDA sobre ` +
      `cualquier cantidad que sugiera la regla de plataforma.` +
      (vc.hashtag_composition ? ` Composición declarada: "${vc.hashtag_composition}".` : ""),
    );
  }
  if (vc.hashtag_base) lines.push(`· Base obligatoria de hashtags: ${vc.hashtag_base}`);
  for (const p of vc.prohibitions) lines.push(`· Prohibido: ${p}`);
  if (lines.length === 0) return "";
  return `RESTRICCIONES DECLARADAS DE LA VOZ (mandan sobre la regla de plataforma si difieren):\n${lines.join("\n")}`;
}

// FIX-ADAPT-02 — la directiva del idioma declarado, tal como la sirve
// `public.language_directives`. MISMA TABLA que consume CopyLab: el adaptador no
// tiene una segunda fuente de la variante que tiene prohibido cambiar.
type LanguageDirective = {
  language_code: string;
  label: string;
  directive_block: string;
  register_constraints: string | null;
};

// LANG-03 (2026-09-19) — DE DONDE SALIO LA DIRECTIVA, O POR QUE NO SALIO.
//
// Hasta hoy habia dos valores: `table` y `absent`. `absent` confundia TRES estados distintos
// —la pieza no traia idioma, el idioma no tiene fila, la tabla no se pudo leer— y por eso
// 71 de 72 piezas vivas decian lo mismo sin decir nada. Un solo nombre para tres causas es
// la misma ambiguedad que `stripped: []` tenia antes de COPYLAB-03.
type LanguageDirectiveSource =
  /** hay fila activa y su bloque viaja al prompt */
  | "table"
  /** la pieza llego sin idioma efectivo: no hay nada que buscar */
  | "unresolved"
  /** el idioma esta resuelto pero `language_directives` no tiene fila activa para el */
  | "no_row"
  /** la lectura de la tabla fallo o devolvio error */
  | "unreadable";

// El código de idioma viaja sin forma canónica ('ES', 'es', ' es '). Se normaliza
// ANTES de buscar: el defecto de origen de FIX-LANG-01 fue exactamente una búsqueda
// sobre una forma no normalizada.
function normalizeLanguageCode(code: string | null | undefined): string {
  return String(code ?? "").trim().toLowerCase();
}

// FIX-ADAPT-02 · LA PROHIBICIÓN GANA SU REFERENTE.
//
// `ADAPTER_CONTRACT` prohíbe "cambiar la variante del idioma" sin decir nunca cuál es
// esa variante. Una prohibición sin referente no es verificable ni por el modelo ni por
// nosotros — y se incumplió en 6 de los 53 casos de HR-GEN-05 con texto conservado,
// donde el fragmento acusado aparece SÓLO en `social.adapted`.
//
// El bloque va DESPUÉS del contrato y ANTES de las reglas de plataforma: primero que no
// cambie la variante, después cuál es, y sólo entonces qué forma darle.
//
// `directive_block` viene REDACTADO EN LA LENGUA QUE INSTRUYE —es dato, no código—, así
// que aquí no se traduce ni se reformula: se coloca. Sin fila se devuelve "" y el prompt
// queda byte-idéntico al de hoy.
function buildAdapterLanguageBlock(directive: LanguageDirective | null): string {
  if (!directive) return "";
  const partes = [
    "VARIANTE CANÓNICA DEL TEXTO QUE RECIBES — es la que el contrato te prohíbe cambiar.",
    "La declaración que sigue es la MISMA que gobernó la escritura de este texto. No la reinterpretes " +
    "ni la vuelvas a aplicar: es la referencia de qué registro debe conservar el adaptado.",
    directive.directive_block.trim(),
  ];
  const rc = (directive.register_constraints ?? "").trim();
  if (rc) partes.push(rc);
  return partes.join("\n\n");
}

// El system prompt completo del adaptador. Puro: mismo input, mismo texto.
function buildAdapterSystemPrompt(
  ruleKey: string, rule: string, vc: VoiceConstraints,
  directive: LanguageDirective | null = null,
  // FIRMA-CABE — el presupuesto del cuerpo, ya descontada la firma. `null` = sin tope declarado, y
  // entonces el prompt sale byte por byte como hasta hoy. Ver el bloque FIRMA-CABE.
  presupuesto: number | null = null,
  // TAG-AJENO — los nombres que son nuestros. Listas vacias ⇒ el bloque sale "" y el prompt corre
  // como hasta hoy, byte por byte. Ver el bloque TAG-AJENO.
  nombresPropios: NombresPropios = { maquinaria: [], marcas: [] },
): string {
  const bloque = buildVoiceConstraintsBlock(vc);
  const idioma = buildAdapterLanguageBlock(directive);
  const presu = buildBudgetBlock(presupuesto);
  const tags = buildTagAjenoBlock(nombresPropios);
  return [
    // Sin nombre de marca: el adaptador corre para todas. Decirle que adapta "para UNRLVL" mientras
    // adapta una pieza de otra voz es una instruccion falsa, y el test de la marca N+1 la rechaza.
    //
    // Y SIN NOMBRE DE LAB, desde el 2026-09-22. Esta linea decia "Adaptador de copy de SocialLab.",
    // y era el unico sitio de toda la cadena donde el modelo veia ese nombre: el literal
    // `SocialLab` no aparece en ninguna otra parte del prompt. Salieron de ahi `#SocialLabUNRLVL`,
    // `#SocialLab` y `#SocialLabTips`, en nueve piezas vivas de dos marcas, una ya publicada.
    // [deducido: la coincidencia es exacta y no hay otra fuente del nombre en el contexto; lo
    // confirmara que ninguna pieza nueva los escriba, con el barrido desactivado o no.]
    //
    // El mismo principio que la linea de arriba, llevado hasta el final: el adaptador no necesita
    // saber COMO se llama la maquina que lo ejecuta para adaptar un texto, y todo nombre propio que
    // tenga a mano puede acabar en una etiqueta.
    "Adaptador de copy.",
    ADAPTER_CONTRACT,
    // FIX-ADAPT-02 — el referente de la prohibición. Sin directiva: "" y se omite, de modo
    // que una pieza sin idioma resuelto corre con el prompt de hoy, byte por byte.
    ...(idioma ? [idioma] : []),
    `Reglas de formato de ${ruleKey}: ${rule}`,
    ...(bloque ? [bloque] : []),
    // EL PRESUPUESTO VA DESPUES DE LAS REGLAS DE FORMATO Y ANTES DEL CIERRE, a proposito: las
    // reglas dicen COMO escribir y esto dice CUANTO cabe. Ponerlo antes lo dejaria compitiendo con
    // el contrato de voz, que es lo primero que no se negocia.
    ...(presu ? [presu] : []),
    // LA REGLA DE LOS HASHTAGS VA AL FINAL de las de contenido y antes del cierre: es una
    // prohibicion, y una prohibicion leida antes de las reglas que la necesitan se olvida.
    ...(tags ? [tags] : []),
    "Solo devuelve el copy adaptado, sin comentarios ni explicaciones.",
  ].join("\n\n");
}

// ── D-1a-i · EL TÍTULO Y EL GANCHO TAMBIÉN SE ADAPTAN ──────────────────────────────────────────
//
// EL DEFECTO [medido 2026-09-16]. `social.adapted[]` traía SÓLO `platform` y `copy` —175 de 175
// piezas, cero con `title`, cero con `image_hook`—. El cuerpo se adapta por canal; el título y el
// texto sobre la imagen salen del MAESTRO (`assets.copy`) y no se adaptan. Cuando la adaptación
// cambia de idioma, el lector ve título e imagen en el idioma anterior y cuerpo en el nuevo.
//
// POR QUÉ UNA LLAMADA APARTE Y NO DENTRO DE LA DEL CUERPO. Meter título y gancho en la respuesta
// del adaptador de cuerpo obligaría a parsear una respuesta estructurada donde hoy se lee texto
// plano, y un fallo de parseo degradaría EL CUERPO —lo único que hoy funciona—. Con llamada aparte
// los dos caminos fallan por separado: si ésta falla, el título cae al maestro y lo DECLARA, y el
// cuerpo sale byte por byte como hoy.
//
// NO INVENTA. Se piden sólo los campos que el maestro trae. Una pieza sin gancho no recibe gancho
// adaptado, igual que el compositor conserva su fail-loud y no sustituye el gancho por el título.
/**
 * DE DÓNDE SALIÓ cada parte del canal. Un texto sin su fuente no es comparable — es la misma
 * lección que dejaron `channelTextOf` y `bodyTextOf` en el Orchestrator, y la que el compositor
 * ya aplica con `source`. Sin este campo, «el título del canal es igual al maestro» no distingue
 * «se adaptó y quedó igual» de «no se adaptó», que son cosas distintas para el juez y para Sam.
 */
type AdaptedPartSource =
  /** el maestro no trae esta parte: no hay nada que adaptar y no se inventa */
  | "sin_maestro"
  /** se adaptó para este canal */
  | "canal_adaptado"
  /** la plataforma no adapta (`adapt=false`): el maestro ES el texto del canal, sin degradación */
  | "maestro_sin_adaptacion"
  /** se intentó y falló —API o parseo—: se cae al maestro Y SE DECLARA. Nunca en silencio */
  | "maestro_por_fallo";

/** Un elemento de `assets.social.adapted`. Hasta D-1a-i era `{ platform, copy }` y nada más. */
type AdaptedChannelPiece = {
  platform: string; copy: string;
  title: string | null; image_hook: string | null;
  title_source: AdaptedPartSource; image_hook_source: AdaptedPartSource;
};

// El techo de la llamada de título. Un título y un gancho son texto corto por definición; este techo
// no es una decisión de producto sino el margen para que una respuesta de dos líneas no se corte.
const TITLE_ADAPTER_MAX_TOKENS = 400;

/**
 * D-1a-i — EL TÍTULO Y EL GANCHO DE ESTE CANAL, con su fuente. Bloque PURO.
 *
 * Es el equivalente de `channelTextOf` del Orchestrator (`api/_calibrationShared.ts:599`) para las
 * partes que no son el cuerpo: resuelve por `platform` contra `social.adapted[]` y DECLARA de dónde
 * salió. Existe UNA sola función porque dos sitios que resuelvan «cuál es el título de este canal»
 * por su cuenta vuelven a divergir — que es exactamente lo que `bodyTextOf` y `channelTextOf` ya
 * enseñaron en el otro repo.
 *
 * Devuelve las partes ADAPTADAS. Quién las juzga es otra decisión, y en D-1a-i sigue siendo el
 * maestro: aquí sólo se resuelven y se declaran.
 */
function channelPartsOf(assets: any, platform: string | null | undefined): {
  title: string | null; image_hook: string | null;
  title_source: AdaptedPartSource | "sin_canal"; image_hook_source: AdaptedPartSource | "sin_canal";
} {
  const plat = typeof platform === "string" ? platform.trim() : "";
  const filas = assets?.social?.adapted;
  if (plat && Array.isArray(filas)) {
    for (const f of filas) {
      if (typeof f?.platform === "string" && f.platform.trim() === plat) {
        return {
          title: typeof f.title === "string" && f.title.trim() ? f.title.trim() : null,
          image_hook: typeof f.image_hook === "string" && f.image_hook.trim() ? f.image_hook.trim() : null,
          // Una fila anterior a D-1a-i no trae `*_source`. Se declara `sin_canal` en vez de
          // inventar una fuente: no saber de dónde salió es un estado, y tiene que poder decirse.
          title_source: (f.title_source ?? "sin_canal") as AdaptedPartSource | "sin_canal",
          image_hook_source: (f.image_hook_source ?? "sin_canal") as AdaptedPartSource | "sin_canal",
        };
      }
    }
  }
  return { title: null, image_hook: null, title_source: "sin_canal", image_hook_source: "sin_canal" };
}

const TITLE_ADAPTER_CONTRACT =
  "CONTRATO: adaptas FORMA, no VOZ. El título y el texto sobre la imagen que recibes ya pasaron el " +
  "filtro de la marca: su registro, su dialecto y su léxico son los que se publican. Ajusta longitud y " +
  "formato a la plataforma. NO reescribas el registro ni cambies la variante del idioma, ni introduzcas " +
  "regionalismos que el texto recibido no tenga. NO inventes: adapta únicamente las partes que recibes.";

/** Qué partes pide el adaptador de título, y con qué rótulos vuelven. Rótulo = clave, y se dicen. */
const TITLE_PART_LABELS = { title: "TITULO", image_hook: "IMAGEN" } as const;
type TitlePart = keyof typeof TITLE_PART_LABELS;

function buildTitleAdapterSystemPrompt(
  ruleKey: string, rule: string, parts: TitlePart[], directive: LanguageDirective | null = null,
): string {
  const idioma = buildAdapterLanguageBlock(directive);
  const rotulos = parts.map((k) => TITLE_PART_LABELS[k]);
  return [
    // Sin nombre de marca: corre para todas. Mismo criterio que `buildAdapterSystemPrompt`.
    "Adaptador de título y texto de imagen de SocialLab.",
    TITLE_ADAPTER_CONTRACT,
    ...(idioma ? [idioma] : []),
    `Reglas de formato de ${ruleKey}: ${rule}`,
    `Devuelve EXACTAMENTE ${rotulos.length} línea(s), una por parte, con este formato y nada más:\n` +
      rotulos.map((r) => `${r}: <texto adaptado>`).join("\n"),
    "Sin comentarios, sin explicaciones y sin líneas adicionales.",
  ].join("\n\n");
}

/**
 * Lee la respuesta del adaptador de título. Bloque PURO y fail-loud: una parte que no vuelve NO se
 * inventa ni se copia en silencio — se devuelve ausente, y quien llama declara que cayó al maestro.
 *
 * Un `title` vacío NO es una adaptación válida: un título en blanco no se publica, y aceptarlo
 * sería exactamente el fallo silencioso que este corte cierra.
 */
function parseAdaptedTitleBlock(out: string, parts: TitlePart[]): Partial<Record<TitlePart, string>> {
  const res: Partial<Record<TitlePart, string>> = {};
  const texto = String(out ?? "");
  for (const k of parts) {
    // El rótulo va sin acento en el prompt, pero un modelo puede devolverlo acentuado: se aceptan
    // las dos formas. Tolerar la tilde no es tolerar cualquier cosa — el rótulo sigue siendo exigido.
    const rot = TITLE_PART_LABELS[k] === "TITULO" ? "T[IÍ]TULO" : TITLE_PART_LABELS[k];
    // 🔴 ESPACIO HORIZONTAL, NO `\\s`. `\\s` incluye el salto de línea: con `TITULO:` vacío, el `\\s*`
    // posterior a los dos puntos se comía el salto y `(.+)` capturaba LA LÍNEA SIGUIENTE — el título
    // acababa valiendo el texto de la imagen. Un fallo silencioso que produce un título plausible es
    // peor que uno que no produce nada, y es justo el que este corte viene a cerrar.
    const m = texto.match(new RegExp(`^[ \\t]*${rot}[ \\t]*:[ \\t]*(.+)$`, "im"));
    const v = m ? m[1].trim() : "";
    if (v) res[k] = v;
  }
  return res;
}

// ── AUTOFIX-6 (2026-10-02) · LA ADAPTACIÓN DEL TÍTULO Y DEL GANCHO, EN PIEZAS REUTILIZABLES ─────────
//
// EL DEFECTO, MEDIDO en la pieza `fadfe938-50ac-4ad1-b305-c7548a6c8816`: el auto-fix cambió
// `copy.title` y `social.adapted[canal].title` siguió diciendo el título de antes. El título del canal
// sólo se derivaba DENTRO del bucle de `runSocialLabDirect`, así que nada que corriera después del
// stage `sociallab` podía volver a derivarlo sin copiar quince líneas — y una copia es una segunda
// resolución del mismo dato, que es justo la clase de defecto que D-1a-i vino a cerrar.
//
// Así que la lógica se EXTRAE, no se copia, y el stage `sociallab` corre exactamente lo mismo que
// antes: mismas partes pedidas, mismo mensaje, mismas fuentes declaradas, mismos fallos. Lo único
// impuro —la llamada— vive fuera del bloque, en `adaptTitleAndHook`; aquí queda la decisión.

/** Una parte del maestro, normalizada: texto recortado, o `null` si no hay. Nunca se inventa. */
function masterPartOf(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Qué partes se le piden al adaptador: SÓLO las que el maestro trae, y siempre en este orden. */
function titleAdapterParts(masterTitle: string | null, masterHook: string | null): TitlePart[] {
  const parts: TitlePart[] = [];
  if (masterTitle) parts.push("title");
  if (masterHook) parts.push("image_hook");
  return parts;
}

/** El mensaje que recibe el adaptador: una línea por parte, con el rótulo con el que debe volver. */
function buildTitleAdapterUserMessage(parts: TitlePart[], masterTitle: string | null, masterHook: string | null): string {
  return parts.map((k) => `${TITLE_PART_LABELS[k]}: ${k === "title" ? masterTitle : masterHook}`).join("\n");
}

/**
 * Lo que pasó con la llamada, sin la llamada. `not_called` cubre los tres motivos por los que hoy no
 * se llama —no hay partes, el canal no adapta, no hay clave— y en los tres el maestro ES el texto del
 * canal. `failed` es API, red, truncado o falta de un dato previo: cae al maestro y SE DECLARA.
 */
type TitleAdapterOutcome =
  | { kind: "not_called" }
  | { kind: "ok"; text: string }
  | { kind: "failed"; error: string };

type AdaptedTitleParts = {
  title: string | null; image_hook: string | null;
  title_source: AdaptedPartSource; image_hook_source: AdaptedPartSource;
  /** Partes pedidas que la respuesta NO trajo. Quien llama lo dice en el log, con nombre. */
  missing: TitlePart[];
};

/**
 * EL RESULTADO POR PARTE, con su fuente. Es la decisión que hasta hoy vivía mezclada con el `fetch`
 * dentro del bucle del adaptador, movida sin cambiarla: una parte devuelta es `canal_adaptado`; una
 * pedida que no volvió, o una llamada que falló, es `maestro_por_fallo` con el texto del maestro; sin
 * llamada es `maestro_sin_adaptacion`; sin maestro es `sin_maestro` y no se inventa.
 */
function resolveAdaptedTitleParts(
  masterTitle: string | null, masterHook: string | null, parts: TitlePart[], outcome: TitleAdapterOutcome,
): AdaptedTitleParts {
  let title: string | null = masterTitle;
  let image_hook: string | null = masterHook;
  let title_source: AdaptedPartSource = masterTitle ? "maestro_sin_adaptacion" : "sin_maestro";
  let image_hook_source: AdaptedPartSource = masterHook ? "maestro_sin_adaptacion" : "sin_maestro";
  const missing: TitlePart[] = [];
  if (outcome.kind === "ok") {
    const got = parseAdaptedTitleBlock(outcome.text, parts);
    for (const k of parts) {
      const v = got[k];
      if (v) {
        if (k === "title") { title = v; title_source = "canal_adaptado"; }
        else { image_hook = v; image_hook_source = "canal_adaptado"; }
      } else {
        if (k === "title") title_source = "maestro_por_fallo"; else image_hook_source = "maestro_por_fallo";
        missing.push(k);
      }
    }
  } else if (outcome.kind === "failed") {
    if (masterTitle) title_source = "maestro_por_fallo";
    if (masterHook)  image_hook_source = "maestro_por_fallo";
  }
  return { title, image_hook, title_source, image_hook_source, missing };
}

/**
 * Si el auto-fix cambió el TÍTULO o el GANCHO del maestro. `image_support` no cuenta: no tiene
 * versión por canal en `social.adapted[]`, así que su cambio no deja nada viejo que re-derivar.
 */
function masterTitlePartsChanged(before: any, after: any): boolean {
  return masterPartOf(before?.title) !== masterPartOf(after?.title)
    || masterPartOf(before?.image_hook) !== masterPartOf(after?.image_hook);
}

/**
 * Escribe el título y el gancho del canal en LA fila `index` de `social.adapted`, en el sitio, con sus
 * fuentes. Mismo estilo que `syncJudgedAdapted`: copia el arreglo, conserva `copy` y todo lo demás de
 * la fila, y no toca las filas de otras plataformas. Devuelve lo que había y lo que quedó, o `null` si
 * no hay fila que escribir —en cuyo caso no se inventa una—.
 */
function applyChannelTitleParts(
  assets: any, index: number, parts: AdaptedTitleParts,
): { before: { title: string | null; image_hook: string | null }; after: { title: string | null; image_hook: string | null } } | null {
  const rows = assets?.social?.adapted;
  if (!Array.isArray(rows) || !Number.isInteger(index) || index < 0 || !rows[index]) return null;
  const prev = rows[index];
  const next = rows.slice();
  next[index] = {
    ...prev,
    title: parts.title, image_hook: parts.image_hook,
    title_source: parts.title_source, image_hook_source: parts.image_hook_source,
  };
  assets.social = { ...(assets.social ?? {}), adapted: next };
  return {
    before: { title: typeof prev?.title === "string" ? prev.title : null, image_hook: typeof prev?.image_hook === "string" ? prev.image_hook : null },
    after: { title: parts.title, image_hook: parts.image_hook },
  };
}

// LA MEDICIÓN, determinista. Cuenta tokens que empiezan con `#`, que es literalmente lo que HR-LUC-10
// declara ("cada token que empieza con #"). No juzga cuáles son: eso es del juez.
function countHashtags(text: string): number {
  return (String(text ?? "").match(/#[^\s#]+/gu) ?? []).length;
}
// ── VOICECONSTRAINTS:END ──

// ── HASHTAGPOLICY:BEGIN ── (HASHTAGS-01, 2026-10-06) bloque PURO: LA POLÍTICA DE HASHTAGS DE LA VOZ,
// APLICADA DE FORMA DETERMINISTA AL TEXTO QUE SE PUBLICA. Sin DB, sin red, sin modelo, sin reloj. Lo
// extrae `tests/hashtag_policy_test.mjs` por estos sentinelas y corre la lógica REAL.
//
// EL DEFECTO, medido el 2026-10-06 sobre `content.content_pieces` y `public.brand_voice_genome`:
//   · ADAPT-01 sólo DECLARA el techo al adaptador (prompt) y CUENTA lo que escribió. No hay paso que
//     lo haga cumplir: el bloque de hashtags del texto publicable es el que escribe el modelo.
//   · `PLATFORM_RULES.INSTAGRAM` pedía «8-15 hashtags al final», e Instagram admite 5 por publicación.
//   · Una voz con su política en TEXTO LIBRE (`application_constraints.hashtags` como cadena) cae a
//     `genome_no_hashtags`: sin techo y sin base. Media medida en meta_ig de esa voz: 10,9 hashtags.
//   · Otra marca con tres voces activas con salida social no declaraba `hashtags` en ninguna.
//
// POR QUÉ AHORA SÍ SE PUEDE RECORTAR. ADAPT-01 decidió no recortar «porque elegir cuál de los trece se
// va exige saber cuál es la base y cuál el temático, y eso es entender el texto». Esa objeción era
// correcta mientras la voz no declaraba cuáles son los suyos. Con `fijos` ORDENADO en el dato, la
// elección ya no exige entender nada: los fijos van primero y en su orden (el orden es la prioridad),
// los temáticos que escribió el adaptador rellenan lo que quede, y si ni los fijos caben, el techo
// corta por el FINAL de la lista de fijos.
//
// EL CONTRATO DEL DATO — `application_constraints.hashtags`, un objeto. Claves por FUNCIÓN:
//   · `fijos`               — lista ORDENADA. Van siempre, en ese orden, sin traducir. Admite TOKENS
//                             de plantilla (`{dominio}`: el dominio de la pieza en CamelCase desde su
//                             slug). Su PRESENCIA como lista es lo que declara la política: una voz sin
//                             `fijos` corre como hoy, y la ausencia queda NOMBRADA en `motivo`.
//   · `permitidos_por_tema` — hashtags propios que NO son fijos: entran si el adaptador los escribió,
//                             con la grafía declarada.
//   · `prefijos_de_marca`   — formas normalizadas («marca» sin tildes ni signos, en minúsculas). Un
//                             hashtag que empieza así y no está ni en `fijos` ni en
//                             `permitidos_por_tema` es una variante inventada y se quita.
//   · `vetados_patrones`    — expresiones regulares sobre la forma NORMALIZADA del hashtag. Lo que casa
//                             no sale nunca. Se llaman «vetados» y no «prohibidos» a propósito: el
//                             recorrido de restricciones de ADAPT-01 (`RESTRICTION_KEY_RE`) llevaría las
//                             expresiones crudas al prompt del adaptador como si fueran prosa.
//   · `base`, `por_plataforma`, `prohibido` — las de ADAPT-01, intactas: siguen siendo la prosa que lee
//                             el adaptador y el techo declarado por plataforma.
//
// EL TECHO es el MENOR entre el del genoma (`por_plataforma`, resuelto por ADAPT-01) y el del canal
// (`public.platform_configs.hashtag_limit`). Llegan como números al resolver: este bloque no lee
// tablas. De qué nivel salió queda escrito en `techo_fuente`.
//
// LA IGUALDAD ES SIN MAYÚSCULAS NI TILDES: `#Panamá` y `#panama` son el mismo hashtag para deduplicar,
// y cuando un hashtag escrito coincide con uno declarado sale con la grafía DECLARADA. Así una variante
// que sólo cambia mayúsculas o la tilde de un hashtag propio no sobrevive, y el propio no se pierde.
//
// LO QUE NO TOCA. El cuerpo y el CTA no se reescriben: se extraen las líneas que son SÓLO hashtags y la
// cola de hashtags del último renglón, y se escribe UN bloque al final del cuerpo, antes de la firma.
// Un hashtag dentro de la prosa es prosa: no se mueve ni se borra, pero CUENTA para el techo y para
// deduplicar, y queda listado en `en_cuerpo`.
//
// IDEMPOTENTE: aplicar dos veces da lo mismo que aplicar una. CERO MARCAS: ni un hashtag, ni un
// prefijo, ni un patrón de cliente en este bloque — todos llegan como dato.

/** De qué nivel salió el techo. Son NIVELES de la cascada, no marcas ni plataformas. */
type HashtagTechoFuente = "genoma" | "plataforma" | "genoma_y_plataforma" | "sin_techo";

/** Por qué una voz NO tiene política aplicable. `null` cuando sí la tiene. */
type HashtagPoliticaAusente =
  | "genoma_sin_hashtags"        // la voz no declara `hashtags`
  | "hashtags_en_texto_libre"    // `hashtags` es prosa: no hay lista que aplicar
  | "sin_fijos_declarados";      // `hashtags` es objeto pero sin la lista `fijos`

export type PoliticaDeHashtags = {
  declarada: boolean;
  motivo: HashtagPoliticaAusente | null;
  /** Ya resueltos (tokens sustituidos), con su `#`, en el orden de prioridad declarado. */
  fijos: string[];
  permitidos: string[];
  /** Formas normalizadas. */
  prefijos: string[];
  /** Fuentes de expresión regular sobre la forma normalizada, ya validadas. */
  vetados: string[];
  /**
   * HASHTAGS-02 — los que van SÓLO cuando la pieza menciona un texto (`menciona`), con la misma prioridad
   * que los fijos, detrás de ellos. Opcional: una política guardada antes del 2026-10-19 no lo trae.
   */
  por_mencion?: Array<{ tag: string; menciona: string }>;
  /**
   * GEO-01 (2026-10-22) — los hashtags de LUGAR: los de una lista de rotación de la marca, por localidad y
   * condado. Opcional y AUSENTE cuando la marca no declara lista: la política guardada antes de este cambio,
   * o la de una marca sin lista, es exactamente la de siempre. Ver «LOS HASHTAGS DE LUGAR» más abajo.
   */
  por_lugar?: LugarDeHashtags[];
  techo: number | null;
  techo_fuente: HashtagTechoFuente;
  techo_genoma: number | null;
  techo_plataforma: number | null;
  /** Tokens de `fijos` que no se pudieron resolver para esta pieza (p. ej. sin dominio). */
  tokens_sin_resolver: string[];
  /** Patrones declarados que no compilan: no se aplican y se dicen. */
  vetados_invalidos: string[];
};

export type HashtagQuitado = {
  tag: string;
  // GEO-01 — `lugar_no_nombrado`: el hashtag de un lugar de la lista cuyo lugar el texto ya no nombra.
  motivo: "vetado" | "variante_de_marca" | "duplicado" | "techo" | "vacio" | "lugar_no_nombrado";
};

/**
 * GEO-01 — un lugar de la lista de rotación, en la forma que la política de hashtags necesita. `nombres` son
 * las formas en que el texto puede nombrar la localidad o el condado (sin `#`). `exige_condado`: el nombre de
 * la localidad es también una palabra común o el nombre de otra cosa (p. ej. una película, una persona), y
 * sólo cuenta como mención si el texto nombra además su condado.
 */
export type LugarDeHashtags = {
  localidad: { tag: string; nombres: string[] };
  condado: { tag: string; nombres: string[] } | null;
  exige_condado?: boolean;
};

export type ResultadoDeHashtags = {
  texto: string;
  cambio: boolean;
  aplicada: boolean;
  motivo: HashtagPoliticaAusente | null;
  /** Los hashtags del bloque tal como llegaron, en orden. */
  entrada: string[];
  /** Hashtags dentro de la prosa: no se tocan, cuentan para el techo. */
  en_cuerpo: string[];
  /** Hashtags vetados que están en la prosa: no se tocan (es cuerpo), y se dicen. */
  en_cuerpo_vetados: string[];
  /** El bloque que quedó. */
  salida: string[];
  quitados: HashtagQuitado[];
  /** Fijos que no cupieron bajo el techo (por el final de la lista). */
  fijos_recortados: string[];
  techo: number | null;
  techo_fuente: HashtagTechoFuente;
  /**
   * GEO-01 — SÓLO cuando la política declara `por_lugar`: qué lugares nombra el texto, qué hashtags de lugar
   * entraron al bloque y cuáles no cupieron. Ausente sin lista, para que el registro de siempre no cambie.
   */
  lugares?: { nombrados: string[]; agregados: string[]; sin_sitio: string[] };
};

/** La forma comparable de un hashtag: sin `#`, sin tildes, sin signos, en minúsculas. */
export function normalizarHashtag(tag: unknown): string {
  return String(tag ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
}

/** Un slug (`ciencia-de-datos`) en CamelCase (`CienciaDeDatos`). Cero vocabulario: sólo separadores. */
export function slugACamelCase(slug: unknown): string {
  return String(slug ?? "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

/** El hashtag limpio de un token (`#Foo,` → `#Foo`). `null` si no queda ninguno. */
function limpiarHashtag(token: unknown): string | null {
  const m = String(token ?? "").match(/#[\p{L}\p{N}_]+/u);
  return m ? m[0] : null;
}

const enteroNoNegativo = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

const listaDeTextos = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim()) : [];

// GEO-01 (2026-10-22) — QUÉ NOMBRES DE UNA LISTA APARECEN EN UN TEXTO, POR PALABRA ENTERA Y SIN SOLAPES.
// La comparación es sin tildes, sin mayúsculas y con el guion como espacio («Miami-Dade» = «Miami Dade»).
// Un nombre más largo gana sobre uno más corto que cae dentro de él: en «West Palm Beach» está la localidad
// y NO el condado «Palm Beach»; en «Miami Beach» no está «Miami». Devuelve el nombre normalizado → número de
// apariciones. PURO, y sin vocabulario: los nombres llegan como dato.
export function normalizarNombreDeLugar(t: unknown): string {
  return String(t ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[-‐‑‒–—_.,;:()¿?¡!"«»'’/]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
export function mencionesDeNombres(texto: unknown, nombres: unknown[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of ocurrenciasDeNombres(texto, nombres)) out.set(o.nombre, (out.get(o.nombre) ?? 0) + 1);
  return out;
}
// Frente 9 (2026-10-22) — LA MISMA BÚSQUEDA, CON DÓNDE CAE CADA APARICIÓN. `mencionesDeNombres` cuenta a partir de
// esto, así que las dos no pueden divergir. `desde`/`hasta` son posiciones en el texto YA normalizado
// (`normalizarNombreDeLugar(texto)`): es lo que necesita quien mira las palabras de alrededor de una mención.
export function ocurrenciasDeNombres(texto: unknown, nombres: unknown[]): Array<{ nombre: string; desde: number; hasta: number }> {
  const t = ` ${normalizarNombreDeLugar(texto)} `;
  const unicos = [...new Set(nombres.map(normalizarNombreDeLugar).filter(Boolean))]
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  const tomado = new Array<boolean>(t.length).fill(false);
  const out: Array<{ nombre: string; desde: number; hasta: number }> = [];
  for (const n of unicos) {
    const buscado = ` ${n} `;
    for (let i = t.indexOf(buscado); i >= 0; i = t.indexOf(buscado, i + 1)) {
      // El nombre ocupa [i+1, i+1+n.length): los espacios de los bordes no se reservan, así dos nombres
      // seguidos («Hialeah Miami-Dade») se encuentran los dos.
      let libre = true;
      for (let k = i + 1; k < i + 1 + n.length; k++) if (tomado[k]) { libre = false; break; }
      if (!libre) continue;
      for (let k = i + 1; k < i + 1 + n.length; k++) tomado[k] = true;
      // En el texto sin el espacio de relleno, el nombre empieza en `i`.
      out.push({ nombre: n, desde: i, hasta: i + n.length });
    }
  }
  return out.sort((a, b) => a.desde - b.desde);
}

// Los TOKENS de plantilla que `fijos` admite. Cada uno es un EJE de la pieza, no de una marca. Uno
// nuevo se añade aquí con su resolución; un token desconocido no se inventa: queda en
// `tokens_sin_resolver`.
const HASHTAG_TOKEN_RE = /^\{([a-z_]+)\}$/u;

/**
 * La política de hashtags de UNA voz para UNA plataforma y UNA pieza.
 *
 * `declaracion` es `application_constraints.hashtags` tal como está en el genoma. `techoGenoma` es el
 * que ADAPT-01 ya resolvió desde `por_plataforma` (`resolveVoiceConstraints`), y `techoPlataforma` el
 * `hashtag_limit` del canal. `dominio` es el slug de la pieza, para el token `{dominio}`.
 */
export function resolverPoliticaDeHashtags(
  declaracion: unknown,
  ctx: { techoGenoma?: number | null; techoPlataforma?: number | null; dominio?: string | null },
): PoliticaDeHashtags {
  const g = enteroNoNegativo(ctx?.techoGenoma);
  const p = enteroNoNegativo(ctx?.techoPlataforma);
  let techo: number | null = null;
  let techo_fuente: HashtagTechoFuente = "sin_techo";
  if (g !== null && p !== null) {
    techo = Math.min(g, p);
    techo_fuente = g === p ? "genoma_y_plataforma" : g < p ? "genoma" : "plataforma";
  } else if (g !== null) { techo = g; techo_fuente = "genoma"; }
  else if (p !== null) { techo = p; techo_fuente = "plataforma"; }

  const vacia = (motivo: HashtagPoliticaAusente): PoliticaDeHashtags => ({
    declarada: false, motivo, fijos: [], permitidos: [], prefijos: [], vetados: [], por_mencion: [],
    techo, techo_fuente, techo_genoma: g, techo_plataforma: p, tokens_sin_resolver: [], vetados_invalidos: [],
  });
  if (declaracion === undefined || declaracion === null) return vacia("genoma_sin_hashtags");
  if (typeof declaracion === "string") return vacia("hashtags_en_texto_libre");
  if (typeof declaracion !== "object" || Array.isArray(declaracion)) return vacia("genoma_sin_hashtags");
  const d = declaracion as Record<string, unknown>;
  if (!Array.isArray(d.fijos)) return vacia("sin_fijos_declarados");

  const tokens_sin_resolver: string[] = [];
  const fijos: string[] = [];
  const vistos = new Set<string>();
  for (const bruto of listaDeTextos(d.fijos)) {
    let tag: string | null = null;
    const tok = bruto.match(HASHTAG_TOKEN_RE);
    if (tok) {
      if (tok[1] === "dominio") {
        const camel = slugACamelCase(ctx?.dominio ?? "");
        tag = camel ? `#${camel}` : null;
      }
      if (!tag) { tokens_sin_resolver.push(bruto); continue; }
    } else {
      tag = limpiarHashtag(bruto.startsWith("#") ? bruto : `#${bruto}`);
    }
    if (!tag) continue;
    const n = normalizarHashtag(tag);
    if (!n || vistos.has(n)) continue;
    vistos.add(n);
    fijos.push(tag);
  }
  const permitidos = listaDeTextos(d.permitidos_por_tema)
    .map((t) => limpiarHashtag(t.startsWith("#") ? t : `#${t}`))
    .filter((t): t is string => !!t);
  const prefijos = listaDeTextos(d.prefijos_de_marca).map(normalizarHashtag).filter(Boolean);
  const vetados: string[] = [];
  const vetados_invalidos: string[] = [];
  for (const src of listaDeTextos(d.vetados_patrones)) {
    try { new RegExp(src, "u"); vetados.push(src); } catch { vetados_invalidos.push(src); }
  }
  // HASHTAGS-02 — `por_mencion`: [{ hashtag, menciona }]. Una entrada sin hashtag o sin texto que mencionar
  // no se aplica a medias: se descarta.
  const por_mencion: Array<{ tag: string; menciona: string }> = [];
  for (const e of Array.isArray(d.por_mencion) ? d.por_mencion : []) {
    const tag = limpiarHashtag(String((e as any)?.hashtag ?? "").trim().replace(/^(?!#)/u, "#"));
    const menciona = typeof (e as any)?.menciona === "string" ? (e as any).menciona.trim() : "";
    if (tag && menciona) por_mencion.push({ tag, menciona });
  }
  // GEO-01 — `por_lugar`: [{ localidad: { hashtag, nombres }, condado: { hashtag, nombres } | null,
  // exige_condado }]. Una entrada sin hashtag de localidad o sin un nombre que mencionar no se aplica a medias:
  // se descarta. Un condado sin hashtag o sin nombres queda en `null` y la localidad sigue valiendo.
  const parteDeLugar = (x: unknown): { tag: string; nombres: string[] } | null => {
    const o = (x && typeof x === "object" && !Array.isArray(x)) ? x as Record<string, unknown> : null;
    if (!o) return null;
    const tag = limpiarHashtag(String(o.hashtag ?? "").trim().replace(/^(?!#)/u, "#"));
    const nombres = listaDeTextos(o.nombres);
    return tag && nombres.length ? { tag, nombres } : null;
  };
  const por_lugar: LugarDeHashtags[] = [];
  for (const e of Array.isArray(d.por_lugar) ? d.por_lugar : []) {
    const localidad = parteDeLugar((e as any)?.localidad);
    if (!localidad) continue;
    por_lugar.push({ localidad, condado: parteDeLugar((e as any)?.condado), exige_condado: (e as any)?.exige_condado === true });
  }
  return {
    declarada: true, motivo: null, fijos, permitidos, prefijos, vetados, por_mencion,
    // GEO-01 — sólo con lista: sin ella, la política resuelta es la misma de antes, clave por clave.
    ...(por_lugar.length ? { por_lugar } : {}),
    techo, techo_fuente, techo_genoma: g, techo_plataforma: p, tokens_sin_resolver, vetados_invalidos,
  };
}

// HASHTAGS-02 (2026-10-19) — LOS HASHTAGS DE LA MARCA Y LOS DE LA VOZ, EN UNA SOLA DECLARACIÓN.
// Sam, 2026-10-18: «los fijos son por marca». Hasta hoy la política vivía sólo en el genoma de cada voz, y
// una voz que no la declaraba publicaba sin los fijos de su marca (medido el 2026-10-19 en cb85d923-…:
// `genoma_sin_hashtags` en la voz del podcast, con los fijos declarados en otra voz de la misma marca).
// La declaración de la marca (`public.brands.hashtag_policy`) tiene la MISMA forma que la de la voz. Las
// listas se SUMAN, marca primero; lo escalar (`base`, `prohibido`) y cada plataforma de `por_plataforma`
// los fija la voz si los declara, y si no, la marca. Sin declaración de marca, la de la voz tal cual.
const esObjetoPlano = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const HASHTAG_LISTAS_QUE_SE_SUMAN = ["fijos", "permitidos_por_tema", "prefijos_de_marca", "vetados_patrones", "por_mencion"] as const;

export function combinarHashtagsDeMarcaYVoz(marca: unknown, voz: unknown): unknown {
  if (!esObjetoPlano(marca)) return voz;
  if (!esObjetoPlano(voz)) return marca;
  const out: Record<string, unknown> = { ...marca, ...voz };
  for (const k of HASHTAG_LISTAS_QUE_SE_SUMAN) {
    const a = Array.isArray(marca[k]) ? marca[k] as unknown[] : [];
    const b = Array.isArray(voz[k]) ? voz[k] as unknown[] : [];
    if (a.length || b.length) out[k] = [...a, ...b];
  }
  if (esObjetoPlano(marca.por_plataforma) || esObjetoPlano(voz.por_plataforma))
    out.por_plataforma = { ...(esObjetoPlano(marca.por_plataforma) ? marca.por_plataforma : {}), ...(esObjetoPlano(voz.por_plataforma) ? voz.por_plataforma : {}) };
  return out;
}

/** Las restricciones de la voz con los hashtags ya combinados con los de la marca. PURA. */
export function restriccionesConHashtagsDeMarca(applicationConstraints: unknown, marca: unknown): any {
  if (!esObjetoPlano(marca)) return applicationConstraints ?? null;
  const ac = esObjetoPlano(applicationConstraints) ? applicationConstraints : {};
  return { ...ac, hashtags: combinarHashtagsDeMarcaYVoz(marca, ac.hashtags) };
}

// Un token de hashtag dentro del bloque: `#` seguido de algo que empieza por letra, número o `_`, o
// un `#` suelto (basura que el modelo deja al final, medido: «#JuntaDeCondominio #»). `##` NO casa:
// un encabezado de markdown no es un hashtag.
const HASHTAG_TOKEN_DEL_BLOQUE = /^#(?:[\p{L}\p{N}_]\S*)?$/u;
// Un hashtag en la PROSA. El lookbehind evita el fragmento de una URL (`/#seccion`) y una entidad
// HTML (`&#39;`).
const HASHTAG_EN_PROSA = /(?<![\p{L}\p{N}_\/&#])#[\p{L}\p{N}_]+/gu;

function esLineaDeHashtags(linea: string): boolean {
  const tokens = linea.trim().split(/\s+/u).filter(Boolean);
  return tokens.length > 0
    && tokens.every((t) => HASHTAG_TOKEN_DEL_BLOQUE.test(t))
    && tokens.some((t) => t.length > 1);
}

/**
 * Separa el cuerpo del bloque de hashtags: las líneas que son SÓLO hashtags y la cola de hashtags del
 * último renglón con contenido. Devuelve el cuerpo sin espacio final y los tokens en orden.
 */
function separarBloqueDeHashtags(texto: string): { cuerpo: string; tokens: string[] } {
  const lineas = texto.split("\n");
  const quitada = lineas.map((l) => esLineaDeHashtags(l));
  const tokens: Array<{ i: number; pos: number; t: string }> = [];
  lineas.forEach((l, i) => {
    if (!quitada[i]) return;
    let pos = 0;
    for (const t of l.trim().split(/\s+/u).filter(Boolean)) tokens.push({ i, pos: pos++, t });
  });
  // La cola del último renglón que queda con contenido.
  let ultima = -1;
  for (let i = lineas.length - 1; i >= 0; i--) {
    if (!quitada[i] && lineas[i].trim()) { ultima = i; break; }
  }
  if (ultima >= 0) {
    const l = lineas[ultima];
    const piezas = [...l.matchAll(/\S+/gu)];
    let k = piezas.length;
    while (k > 0 && HASHTAG_TOKEN_DEL_BLOQUE.test(piezas[k - 1][0])) k--;
    if (k < piezas.length && k > 0) {
      const cola = piezas.slice(k);
      cola.forEach((m, j) => tokens.push({ i: ultima, pos: 100000 + j, t: m[0] }));
      lineas[ultima] = l.slice(0, piezas[k].index).replace(/\s+$/u, "");
    }
  }
  tokens.sort((a, b) => a.i - b.i || a.pos - b.pos);
  // Reconstrucción: una línea quitada entre dos en blanco no deja dos en blanco seguidas.
  const out: string[] = [];
  let huboQuitada = false;
  lineas.forEach((l, i) => {
    if (quitada[i]) { huboQuitada = true; return; }
    const enBlanco = !l.trim();
    if (enBlanco && huboQuitada && out.length > 0 && !out[out.length - 1].trim()) return;
    out.push(l);
    if (!enBlanco) huboQuitada = false;
  });
  return { cuerpo: out.join("\n").replace(/\s+$/u, ""), tokens: tokens.map((x) => x.t) };
}

const escaparRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * Aplica la política a UN texto publicable. `firma` es la de la voz (dato): si el texto la trae, se
 * aparta antes y se devuelve al final, detrás del bloque; si no la trae, no se añade.
 *
 * Sin política declarada devuelve el texto SIN TOCAR y `aplicada: false` con su motivo.
 */
export function aplicarPoliticaDeHashtags(
  texto: unknown, politica: PoliticaDeHashtags | null | undefined, firma?: unknown,
): ResultadoDeHashtags {
  const original = typeof texto === "string" ? texto : String(texto ?? "");
  const base = (motivo: HashtagPoliticaAusente | null): ResultadoDeHashtags => ({
    texto: original, cambio: false, aplicada: false, motivo,
    entrada: [], en_cuerpo: [], en_cuerpo_vetados: [], salida: [], quitados: [], fijos_recortados: [],
    techo: politica?.techo ?? null, techo_fuente: politica?.techo_fuente ?? "sin_techo",
  });
  if (!politica || !politica.declarada) return base(politica?.motivo ?? "genoma_sin_hashtags");

  const f = String(firma ?? "").trim();
  const llevaFirma = !!f && original.includes(f);
  const sinFirma = llevaFirma ? original.replace(new RegExp(`\\s*${escaparRegExp(f)}`, "gu"), "") : original;
  const { cuerpo, tokens } = separarBloqueDeHashtags(sinFirma);
  const en_cuerpo = [...cuerpo.matchAll(HASHTAG_EN_PROSA)].map((m) => m[0]);

  const techo = politica.techo;
  const cabe = (usados: number) => techo === null || usados < techo;
  const vistos = new Set<string>(en_cuerpo.map(normalizarHashtag));
  let usados = en_cuerpo.length;
  const salida: string[] = [];
  const quitados: HashtagQuitado[] = [];
  const fijos_recortados: string[] = [];
  const vetados = politica.vetados.map((s) => new RegExp(s, "u"));
  const esVetado = (n: string) => vetados.some((re) => re.test(n));

  // 1 · Los fijos, en su orden. El techo corta por el FINAL de la lista.
  const fijosNorm = new Map<string, string>();
  for (const tag of politica.fijos) {
    const n = normalizarHashtag(tag);
    fijosNorm.set(n, tag);
    if (vistos.has(n)) continue;              // ya está en la prosa: cuenta, no se repite
    if (!cabe(usados)) { fijos_recortados.push(tag); continue; }
    salida.push(tag); vistos.add(n); usados++;
  }
  // 1b · HASHTAGS-02 — los que van por mención, sólo si la pieza nombra su texto (sin mayúsculas ni
  // tildes). Mismo trato que un fijo: detrás de los fijos, y el techo los recorta igual.
  const plano = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
  const cuerpoPlano = plano(cuerpo);
  for (const { tag, menciona } of politica.por_mencion ?? []) {
    if (!cuerpoPlano.includes(plano(menciona))) continue;
    const n = normalizarHashtag(tag);
    fijosNorm.set(n, tag);
    if (vistos.has(n)) continue;
    if (!cabe(usados)) { fijos_recortados.push(tag); continue; }
    salida.push(tag); vistos.add(n); usados++;
  }
  // 1c · GEO-01 — LOS HASHTAGS DE LUGAR (Sam, 2026-10-22: «cuando se mencionen otras ciudades, puedes
  // agregarlas al hashtag de la pieza»). Tres reglas, todas deterministas:
  //   · la LOCALIDAD que el texto nombra entra aquí, detrás de los fijos y ANTES de los temáticos: si no
  //     cabe, desplaza al temático menos prioritario (el último), y si ni así cabe, no entra. Un fijo no se
  //     desplaza nunca: va antes.
  //   · el CONDADO entra al final, SÓLO si sobra sitio (paso 3): nunca desplaza a un temático.
  //   · el hashtag de un lugar de la lista cuyo lugar el texto NO nombra se quita del bloque (paso 2): el
  //     bloque no puede hablar de un sitio del que el texto ya no habla (p. ej. después de variar el lugar).
  // La mención es por palabra entera y sin solapes (`mencionesDeNombres`). Sin `por_lugar`, nada de esto corre.
  const lugaresDeclarados = politica.por_lugar ?? [];
  const geoCanon = new Map<string, string>();
  const geoNombrados = new Set<string>();
  const geoNombres: string[] = [];
  const geoAgregados: string[] = [];
  const geoSinSitio: string[] = [];
  const condadosPendientes: string[] = [];
  if (lugaresDeclarados.length) {
    const menciones = mencionesDeNombres(cuerpo, lugaresDeclarados.flatMap((l) => [...l.localidad.nombres, ...(l.condado?.nombres ?? [])]));
    const nombra = (ns: string[]) => ns.some((x) => menciones.has(normalizarNombreDeLugar(x)));
    for (const l of lugaresDeclarados) {
      geoCanon.set(normalizarHashtag(l.localidad.tag), l.localidad.tag);
      if (l.condado) geoCanon.set(normalizarHashtag(l.condado.tag), l.condado.tag);
    }
    for (const l of lugaresDeclarados) {
      const condadoNombrado = !!l.condado && nombra(l.condado.nombres);
      const localidadNombrada = nombra(l.localidad.nombres) && (l.exige_condado !== true || condadoNombrado);
      if (localidadNombrada) {
        if (!geoNombres.includes(l.localidad.nombres[0])) geoNombres.push(l.localidad.nombres[0]);
        const n = normalizarHashtag(l.localidad.tag);
        geoNombrados.add(n);
        fijosNorm.set(n, l.localidad.tag);
        if (!vistos.has(n)) {
          if (cabe(usados)) { salida.push(l.localidad.tag); vistos.add(n); usados++; geoAgregados.push(l.localidad.tag); }
          else geoSinSitio.push(l.localidad.tag);
        }
      }
      if (l.condado && (localidadNombrada || condadoNombrado)) {
        if (condadoNombrado && !localidadNombrada && !geoNombres.includes(l.condado.nombres[0])) geoNombres.push(l.condado.nombres[0]);
        const nc = normalizarHashtag(l.condado.tag);
        geoNombrados.add(nc);
        if (!condadosPendientes.includes(l.condado.tag)) condadosPendientes.push(l.condado.tag);
      }
    }
  }
  // 2 · Los temáticos que escribió el adaptador, en su orden.
  const permitidosNorm = new Map<string, string>(politica.permitidos.map((t) => [normalizarHashtag(t), t]));
  const recortadosNorm = new Set(fijos_recortados.map(normalizarHashtag));
  for (const token of tokens) {
    const tag = limpiarHashtag(token);
    const n = normalizarHashtag(tag ?? "");
    if (!tag || !n) { quitados.push({ tag: token, motivo: "vacio" }); continue; }
    if (esVetado(n)) { quitados.push({ tag, motivo: "vetado" }); continue; }
    // GEO-01 — el hashtag de un lugar de la lista que el texto no nombra no se queda.
    if (geoCanon.has(n) && !geoNombrados.has(n)) { quitados.push({ tag, motivo: "lugar_no_nombrado" }); continue; }
    if (vistos.has(n)) {
      // Un fijo que el adaptador ya había escrito no es un quitado: está en el bloque, en su sitio.
      if (!(fijosNorm.has(n) && salida.includes(fijosNorm.get(n) as string)))
        quitados.push({ tag, motivo: "duplicado" });
      continue;
    }
    if (recortadosNorm.has(n)) { quitados.push({ tag, motivo: "techo" }); continue; }
    const canonico = fijosNorm.get(n) ?? permitidosNorm.get(n) ?? geoCanon.get(n) ?? null;
    if (!canonico && politica.prefijos.some((pfx) => n.startsWith(pfx))) {
      quitados.push({ tag, motivo: "variante_de_marca" }); continue;
    }
    if (!cabe(usados)) { quitados.push({ tag, motivo: "techo" }); continue; }
    salida.push(canonico ?? tag); vistos.add(n); usados++;
  }
  // 3 · GEO-01 — el condado, sólo con sitio libre: no desplaza a nadie.
  for (const tag of condadosPendientes) {
    const n = normalizarHashtag(tag);
    if (vistos.has(n)) continue;
    if (cabe(usados)) { salida.push(tag); vistos.add(n); usados++; geoAgregados.push(tag); }
    else geoSinSitio.push(tag);
  }

  const bloque = salida.join(" ");
  let nuevo = cuerpo;
  if (bloque) nuevo = cuerpo ? `${cuerpo}\n\n${bloque}` : bloque;
  if (llevaFirma) nuevo = nuevo ? `${nuevo}\n\n${f}` : f;
  return {
    texto: nuevo, cambio: nuevo !== original, aplicada: true, motivo: null,
    entrada: tokens, en_cuerpo, en_cuerpo_vetados: en_cuerpo.filter((t) => esVetado(normalizarHashtag(t))), salida, quitados, fijos_recortados,
    techo, techo_fuente: politica.techo_fuente,
    ...(lugaresDeclarados.length ? { lugares: { nombrados: geoNombres, agregados: geoAgregados, sin_sitio: geoSinSitio } } : {}),
  };
}

/** Lo que queda escrito en `assets.social.hashtag_policy[]` por plataforma. */
export type RegistroDePolitica = {
  platform: string;
  politica: PoliticaDeHashtags;
  resultado: Omit<ResultadoDeHashtags, "texto"> | null;
  aplicaciones?: Array<{ etapa: string } & Omit<ResultadoDeHashtags, "texto">>;
};

export function registroDePolitica(
  platform: string, politica: PoliticaDeHashtags, r: ResultadoDeHashtags | null,
): RegistroDePolitica {
  const { texto: _t, ...resto } = r ?? ({} as ResultadoDeHashtags);
  return { platform, politica, resultado: r ? resto : null };
}

/**
 * Re-aplica la política GUARDADA en `assets.social.hashtag_policy` a cada fila de `social.adapted`,
 * en el sitio. La usan los puntos donde el texto publicable se fija después del adaptador (el
 * estampado de la firma, que pasa también por el corrector y el bucle de reparación): lo que esos
 * pasos reescriban no puede devolver un hashtag que la política quitó.
 *
 * Una fila sin registro, o con política no declarada, no se toca. Devuelve las plataformas que
 * cambiaron. `etapa` queda en el registro de la fila.
 */
export function aplicarPoliticaEnAssets(assets: any, etapa: string): string[] {
  const registros = assets?.social?.hashtag_policy;
  const filas = assets?.social?.adapted;
  if (!Array.isArray(registros) || !Array.isArray(filas)) return [];
  const firma = assets?.builder_meta?.signature_closer?.text ?? null;
  const cambiaron: string[] = [];
  for (const fila of filas) {
    if (!fila || typeof fila.copy !== "string") continue;
    const plat = String(fila.platform ?? "").trim().toLowerCase();
    const reg = registros.find((x: any) => String(x?.platform ?? "").trim().toLowerCase() === plat);
    if (!reg?.politica?.declarada) continue;
    const r = aplicarPoliticaDeHashtags(fila.copy, reg.politica as PoliticaDeHashtags, firma);
    if (!r.cambio) continue;
    fila.copy = r.texto;
    const { texto: _t, ...resto } = r;
    reg.aplicaciones = [...(Array.isArray(reg.aplicaciones) ? reg.aplicaciones : []), { etapa, ...resto }].slice(-5);
    cambiaron.push(plat);
  }
  return cambiaron;
}
// ── HASHTAGPOLICY:END ──

// ── TITLEADAPT:BEGIN ── (AUTOFIX-6, 2026-10-02) LA LLAMADA DEL ADAPTADOR DE TÍTULO, EN UN SOLO SITIO.
// No es puro —llama a la API—, pero se extrae por sentinelas como EXECLAB: `tests/autofix_titulo_canal_test.mjs`
// lo corre con `fetch` simulado para fijar que el stage `sociallab` sigue haciendo lo mismo.
//
// DOS LLAMADORES, UNA FUNCIÓN: el bucle de `runSocialLabDirect` (el nacimiento de la adaptación) y
// `autofixRederiveChannelTitle` (el auto-fix cambió el maestro). El cuerpo es el que vivía inline en el
// bucle, movido tal cual: mismo modelo, mismo techo, mismo prompt, mismos logs, y los tokens se cuentan
// también cuando la respuesta vino truncada —se pagaron— aunque no se usen.
//
// Lo que añade es sólo información para quien asienta el coste fuera del stage: si hubo llamada, si la
// respuesta trajo `usage` y con qué código respondió el proveedor. El stage `sociallab` no lo lee y
// asienta como siempre, sumado a la adaptación del cuerpo.
async function adaptTitleAndHook(a: {
  platform: string; ruleKey: string; rule: string; adapt: boolean;
  masterTitle: string | null; masterHook: string | null;
  languageDirective: LanguageDirective | null;
  // MODELO-DATO — ya resuelto por quien llama (`modeloDeLab`): se PASA, no se re-resuelve.
  model: string;
}): Promise<AdaptedTitleParts & {
  called: boolean; ok: boolean; error: string | null;
  input_tokens: number; output_tokens: number; usage_reported: boolean; http_status: number | null;
  model: string;
}> {
  const parts = titleAdapterParts(a.masterTitle, a.masterHook);
  let input_tokens = 0, output_tokens = 0, usage_reported = false;
  let http_status: number | null = null;
  let outcome: TitleAdapterOutcome = { kind: "not_called" };
  if (parts.length > 0 && a.adapt && ANT_KEY) {
    try {
      const res = await llamarModelo("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANT_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: a.model, max_tokens: TITLE_ADAPTER_MAX_TOKENS, thinking: { type: "disabled" },
          system: buildTitleAdapterSystemPrompt(a.ruleKey, a.rule, parts, a.languageDirective),
          messages: [{ role: "user", content: buildTitleAdapterUserMessage(parts, a.masterTitle, a.masterHook) }],
        }),
      });
      http_status = res.status;
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 400)}`);
      const d = await res.json();
      input_tokens  += d.usage?.input_tokens  ?? 0;
      output_tokens += d.usage?.output_tokens ?? 0;
      usage_reported = Number.isFinite(d.usage?.input_tokens) && Number.isFinite(d.usage?.output_tokens);
      // Un texto cortado no se usa, igual que en el cuerpo: si la API cortó, no hay adaptación
      // fiable de partes que son cortas por definición, y se cae al maestro declarándolo.
      if (d.stop_reason === "max_tokens") throw new Error("truncada en el techo");
      outcome = { kind: "ok", text: d.content?.[0]?.text ?? "" };
    } catch (e) {
      outcome = { kind: "failed", error: e instanceof Error ? e.message : String(e) };
    }
  }
  const r = resolveAdaptedTitleParts(a.masterTitle, a.masterHook, parts, outcome);
  for (const k of r.missing) {
    console.error(
      `[D-1a-i] platform=${a.platform} el adaptador no devolvió la parte ` +
      `'${TITLE_PART_LABELS[k]}' — se conserva el maestro y queda declarado como ` +
      `maestro_por_fallo. NO se inventa ni se copia en silencio.`,
    );
  }
  if (outcome.kind === "failed") {
    console.error(
      `[D-1a-i] platform=${a.platform} falló la adaptación de título/gancho ` +
      `(${outcome.error}) — se conservan los del maestro, declarados.`,
    );
  }
  return {
    ...r,
    called: outcome.kind !== "not_called", ok: outcome.kind === "ok",
    error: outcome.kind === "failed" ? outcome.error : null,
    input_tokens, output_tokens, usage_reported, http_status, model: a.model,
  };
}
// ── TITLEADAPT:END ──

const ADAPTER_MAX_TOKENS_DEFAULT = 800;
// SIGN-02 §3.4 — con cuánto más techo se reintenta una adaptación que salió cortada. Un solo
// reintento: si con la mitad más de presupuesto vuelve a cortarse, el problema no es el techo y
// seguir pagando llamadas no lo arregla.
const ADAPTER_TRUNCATION_RETRY_FACTOR = 1.5;

//
// ADAPT-01 (2026-08-27) · EL ADAPTADOR RECIBE EL GENOMA. `constraints` trae, por plataforma, lo que
// `brand_voice_genome.application_constraints` declara para esta voz — techo de hashtags, composición,
// base obligatoria y prohibiciones— resuelto por el bloque PURO VOICECONSTRAINTS. Es el mismo
// movimiento que F1 hizo con el techo de tokens: el carril resuelve desde la tabla y se lo pasa; el
// adaptador no re-resuelve nada ni conoce ninguna marca. Sin genoma sembrado el mapa viene vacío y el
// prompt es el de siempre salvo el contrato: cero migración.
//
// Y el contrato queda ACOTADO en el system prompt: adapta forma, no voz. El adaptador venía cambiando
// el registro del texto —trabajo de AIFE y del corrector, deshecho después de hacerlo— sin haber visto
// nunca las reglas de la marca.
// FIX-ADAPT-02 — lee la directiva del idioma declarado de `public.language_directives`.
//
// ⛔ LA DECISION DE NO HACER FAIL-LOUD SE REVIERTE AQUI. LANG-03, 2026-09-19.
//
// La razon original se conserva porque era buena: «aquí ya existe un texto de entrada válido y
// detener la adaptación destruiría una pieza ya generada». Lo que la invalida es lo MEDIDO hoy:
// degradar no dejaba la pieza como estaba, la dejaba EN OTRO IDIOMA. El system prompt del
// adaptador esta redactado en espanol, asi que un cuerpo largo sin directiva no se queda quieto:
// deriva al idioma del prompt. Medido sobre `content.content_pieces`, 71 de 72 piezas vivas de
// siete dias corrieron con la directiva ausente, y las piezas en ingles llegaron a la bandeja con
// el titulo en ingles y el cuerpo en espanol.
//
// UNA PIEZA MAL TRADUCIDA ES PEOR QUE UN JOB FALLIDO, porque el job fallido se ve y la pieza
// traducida pasa por buena. El fail-loud vive en `runSocialLabDirect`, que es quien puede
// declararlo antes de gastar una sola llamada de adaptacion; esta funcion sigue siendo pura en su
// contrato —lee y declara la procedencia— y no decide por su llamador.
//
// Una query por adaptación, con la clave de servicio del carril (`SB_KEY`).

export async function runSocialLabDirect(
  rawCopy: string, platforms: string[], ceilings: Record<string, Ceiling> = {},
  constraints: Record<string, VoiceConstraints> = {},
  // LANG-03 (2026-09-19) — EL IDIOMA EFECTIVO DE LA PIEZA, no el del eje.
  //
  // EL DEFECTO QUE CIERRA. Hasta hoy aquí llegaba `readDispatchAxis(job).language`, que sale de
  // `intel.brand_topics.languages`. Esa columna estaba en null en 19 de 51 temas activos, asi que
  // el adaptador recibia null y corria sin directiva. El Builder NO tenia ese problema porque cae
  // a `language_primary` — pero esa caida es INTERNA suya: el valor de afuera seguia en null.
  // O sea que el idioma efectivo existia y estaba escrito en `builder_meta.language`, y el unico
  // que no lo veia era justamente el que tenia prohibido cambiar la variante.
  //
  // Se PASA ya resuelto, exactamente igual que la firma (SIGN-02 §3.3) y que el titulo y el gancho
  // (D-1a-i), y por el mismo motivo: dos resoluciones del mismo dato divergen. Es la leccion de
  // COPYLAB-03 de esta misma manana aplicada al idioma — un dato leido antes de escribirse no
  // falla, devuelve null, y el que lo consume no se apaga: se va en la direccion contraria.
  language: string | null = null,
  // SIGN-02 §3.3 — la firma de la voz, `builder_meta.signature_closer.text`, YA resuelta por el
  // stage del Builder. Se PASA, no se re-resuelve. Default `null` ⇒ no se descuenta nada y el
  // adaptador corre como hasta hoy, byte por byte.
  signatureText: string | null = null,
  // FIRMA-CABE — el tope de caracteres por canal, ya leido. Se PASA resuelto, igual que el techo,
  // la voz y la firma: el adaptador no consulta tablas. Mapa vacio = sin presupuesto, como hasta hoy.
  charLimits: Map<string, number | null> = new Map(),
  // D-1a-i — el TÍTULO y el TEXTO SOBRE LA IMAGEN del maestro (`assets.copy`). Se PASAN, no se
  // re-resuelven. Default `null` ⇒ no hay parte que adaptar y la función corre como hasta hoy,
  // byte por byte: ni una llamada más, ni un campo distinto en `adapted[]` salvo los declarados
  // como `sin_maestro`.
  rawTitle: string | null = null,
  rawImageHook: string | null = null,
  // TAG-AJENO — los nombres que son nuestros, ya leídos. Se PASAN resueltos, igual que el techo, la
  // voz, la firma y el idioma: el adaptador no consulta tablas. Listas vacías = sin barrido, como
  // hasta hoy, byte por byte.
  nombresPropios: NombresPropios = { maquinaria: [], marcas: [] },
  // La marca que publica, para que su propio nombre NO cuente como ajeno. `null` ⇒ cualquier nombre
  // de marca se trata como ajeno, que es el lado seguro de equivocarse.
  marcaPropia: string | null = null,
  // HASHTAGS-01 — la política de hashtags de la voz por plataforma, ya resuelta (fijos, permitidos,
  // vetados y techo). Se PASA resuelta, igual que el techo de tokens y las restricciones: el adaptador
  // no consulta tablas. Mapa vacío = sin política, como hasta hoy, byte por byte.
  hashtagPolicies: Record<string, PoliticaDeHashtags> = {},
  // TECHO-CUMPLE (2026-10-22) — los nombres de la oferta de la pieza: una frase que los nombra no se
  // quita al recortar. Al final y con default: sin él, el recorte protege gancho, cierre y hashtags.
  terminosProtegidos: string[] = [],
  // MODELO-DATO (2026-10-25) — el modelo de `ops_lab_models` (sociallab / sync), ya resuelto por quien
  // llama, que es quien lo asienta en el libro: el que adapta y el que cobra son el mismo valor.
  modelo: string = "",
  directivaResuelta: { directive: LanguageDirective | null; source: LanguageDirectiveSource } = { directive: null, source: "unresolved" },
  reglaDe: (platform: string) => { key: string; rule: string; adapt: boolean } = () => { throw new Error("REGLA_DE_PLATAFORMA_SIN_DATO"); },
): Promise<{
  output: string; adapted: Array<AdaptedChannelPiece>;
  ceilings: Array<{ platform: string; max_tokens: number; max_tokens_source: CeilingSource; adapted: boolean; truncated: boolean; degraded: boolean; budget?: number | null; budget_outcome?: string }>;
  voice_constraints: Array<{ platform: string; adapted: boolean; max_hashtags: number | null; max_hashtags_source: HashtagCeilingSource; prohibitions: number; hashtags_in: number; hashtags_out: number; over_ceiling: boolean; tags_ajenos: string[] }>;
  // HASHTAGS-01 — SIEMPRE presente (HRD-R18): una fila por plataforma, también cuando la voz no declara
  // política, con el motivo nombrado.
  hashtag_policy: RegistroDePolitica[];
  input_tokens: number; output_tokens: number;
  // FIX-ADAPT-02 — SIEMPRE presentes, vacíos cuando no aplica (HRD-R18): un campo que sólo
  // aparece cuando la lógica actuó no distingue "no aplicaba" de "no corrió".
  language: string | null; language_directive_source: LanguageDirectiveSource;
}> {
  // MODELO-DATO — sin modelo no se gasta ni una llamada.
  if (!modelo) throw new Error("MODELO_SIN_DATO: runSocialLabDirect sin modelo de ops_lab_models (sociallab/sync)");
  // FIX-ADAPT-02 — una sola lectura por adaptación, antes del bucle de plataformas: la
  // directiva es la misma para todas las plataformas de esta pieza.
  const { directive: languageDirective, source: languageDirectiveSource } =
    directivaResuelta;
  // LANG-03 · EL FAIL-LOUD, y va ANTES del bucle: sin directiva no se gasta ni una llamada.
  //
  // POR QUE DETENERSE Y NO DEGRADAR. El contrato del adaptador le prohibe «cambiar la variante del
  // idioma» y el bloque de la directiva es lo UNICO que dice cual es esa variante. Sin el, la
  // prohibicion no tiene referente y el prompt —redactado en espanol— arrastra el cuerpo a su
  // propio idioma. Degradar no devuelve la pieza intacta: la devuelve traducida, y traducida pasa
  // por buena en la bandeja mientras un job fallido se ve.
  //
  // NO PUEDE DISPARAR EN OPERACION NORMAL, y eso es lo que lo hace seguro. Medido el 2026-09-19:
  // 247 de 249 piezas de 60 dias traen idioma efectivo, y los 2 nulos son del 2026-07-31, el dia
  // en que nacio el eje. Los dos codigos que se usan hoy tienen fila activa. Si esto salta, salta
  // por una marca o un tema nuevo sin idioma declarado — que es exactamente lo que queremos ver.
  //
  // Cero marcas y cero idiomas en el mensaje: los nombra desde el dato que recibio.
  if (languageDirectiveSource !== "table") {
    const causa = {
      unresolved: "la pieza llego sin idioma efectivo (`builder_meta.language` y el eje de despacho, ambos vacios)",
      no_row:     "el idioma esta resuelto pero `public.language_directives` no tiene fila activa para el",
      unreadable: "`public.language_directives` no se pudo leer",
    }[languageDirectiveSource];
    throw new Error(
      `ADAPT_LANGUAGE_DIRECTIVE_MISSING: ${causa}. Idioma recibido: ` +
      `'${normalizeLanguageCode(language) || "(vacio)"}'. El adaptador no corre sin la variante ` +
      `canonica: su contrato prohibe cambiarla y sin la directiva no hay contra que compararla.`,
    );
  }
  // SIGN-02 §3.3 — EL ADAPTADOR NUNCA VE LA FIRMA. El contrato dice que el texto de entrada no la
  // trae, y medido el 2026-09-15 la traía: en una de las dos piezas duplicadas la firma ya venía en
  // `social.adapted_pre_judgment`, o sea que entró por aquí. Un adaptador que recibe la firma la
  // copia, la mueve o la reescribe, y después el estampado añade la suya. Se descuenta ANTES.
  // Sólo la firma: los hashtags y el CTA siguen entrando, porque son parte de lo que se adapta.
  const inputCopy = stripSignatureOccurrences(rawCopy, signatureText);
  const adapted: Array<AdaptedChannelPiece> = [];
  // D-1a-i — las partes que el MAESTRO trae. Una parte ausente no se pide y no se inventa.
  const masterTitle = masterPartOf(rawTitle);
  const masterHook  = masterPartOf(rawImageHook);
  const applied: Array<{ platform: string; max_tokens: number; max_tokens_source: CeilingSource; adapted: boolean; truncated: boolean; degraded: boolean; budget?: number | null; budget_outcome?: string }> = [];
  const constraintsApplied: Array<{ platform: string; adapted: boolean; max_hashtags: number | null; max_hashtags_source: HashtagCeilingSource; prohibitions: number; hashtags_in: number; hashtags_out: number; over_ceiling: boolean; tags_ajenos: string[] }> = [];
  const hashtagPolicyApplied: RegistroDePolitica[] = [];
  let total_in = 0, total_out = 0;
  for (const platform of platforms) {
    const { key: ruleKey, rule, adapt } = reglaDe(platform);
    // F1 — el MISMO techo que gobernó la generación. `?? ADAPTER_MAX_TOKENS_DEFAULT` es el nivel 5 de
    // la cascada aplicado aquí: nadie declaró, corre el default de hoy.
    const ceiling  = ceilings[platform] ?? CEILING_UNDECLARED;
    const maxTokens = ceiling.max_tokens ?? ADAPTER_MAX_TOKENS_DEFAULT;
    // FIRMA-CABE — cuanto cabe de CUERPO en este canal, ya descontada la firma que se pega despues.
    const presupuesto = presupuestoDeCuerpo(
      charLimits.get(String(platform).toLowerCase()), signatureText, FIRMA_MARGEN_CHARS,
      // Lo que ESTA marca quiere en ESTE canal, por la cascada del registry. Ver `presupuestoDeCuerpo`.
      ceiling.max_chars ?? null);
    // ADAPT-01 — las restricciones declaradas de la voz PARA ESTA PLATAFORMA. Sin entrada en el mapa
    // se corre como hasta hoy: sin techo de hashtags, con el contrato igual.
    const vc = constraints[platform] ?? { ...VOICE_CONSTRAINTS_ABSENT };
    let truncated = false;
    let degraded = false;
    let adaptedCopy = inputCopy;
    // SIGN-02 §3.4 — UNA ADAPTACIÓN, CON SU TECHO. Devuelve el texto y si la API lo cortó; el
    // consumo se asienta aquí dentro, para que un reintento cuente sus tokens y no los esconda.
    const adaptarUnaVez = async (techo: number, correccion: { previo: string; pedido: string } | null = null): Promise<{ ok: boolean; text: string; truncated: boolean }> => {
      const res = await llamarModelo("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": ANT_KEY, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: modelo, max_tokens: techo, thinking: { type: "disabled" },
            // Se nombra la plataforma por su clave canónica (`ruleKey`), no por el valor crudo
            // de DB: "FACEBOOK" es una plataforma que el modelo conoce; "meta_fb" no significa
            // nada fuera de esta base. La regla y el nombre dejan de poder contradecirse.
            // ADAPT-01 — el system prompt lo arma el bloque PURO: el techo de hashtags de la voz, su
            // composición, su base obligatoria y sus prohibiciones, más el contrato "adapta forma, no
            // voz", y la PRECEDENCIA dicha (la voz manda sobre la regla de plataforma cuando difieren).
            system: buildAdapterSystemPrompt(ruleKey, rule, vc, languageDirective, presupuesto, nombresPropios),
            messages: [
              { role: "user", content: `Adapta para ${ruleKey}:\n\n${inputCopy}` },
              // FIRMA-CABE-02 — el reintento ve su propia version y el numero que le falto cumplir.
              ...(correccion ? [{ role: "assistant", content: correccion.previo }, { role: "user", content: correccion.pedido }] : []),
            ],
          }),
        });
      // ADAPT-ERR (2026-09-27) — un 400 del proveedor se callaba: la pieza salía con el maestro sin
      // adaptar y nadie sabía por qué. Se registra el cuerpo del error (recortado; no lleva secretos).
      if (!res.ok) {
        console.error(`[SOCIALLAB][ADAPT-ERR] platform=${platform} HTTP ${res.status} — se usa el texto de entrada: ${(await res.text().catch(() => "")).slice(0, 400)}`);
        return { ok: false, text: inputCopy, truncated: false };
      }
      const d = await res.json();
      total_in  += d.usage?.input_tokens  ?? 0;
      total_out += d.usage?.output_tokens ?? 0;
      // F1 — la señal que la API ya daba y nadie miraba. Un adaptado cortado a la mitad se
      // propagaba como si fuera el output bueno, y es el texto que el Watcher juzga.
      return { ok: true, text: d.content?.[0]?.text ?? inputCopy, truncated: d.stop_reason === "max_tokens" };
    };
    if (!adapt) {
      console.log(`[P-e] platform=${platform} → ${ruleKey}, sin adaptación (copy del Builder tal cual)`);
    } else if (ANT_KEY) {
      try {
        let r = await adaptarUnaVez(maxTokens);
        // SIGN-02 §3.4 — UN TEXTO CORTADO NO SE USA. Hasta hoy el truncado se registraba y se
        // propagaba igual: quedaba en el log y en `ceilings`, y el texto mutilado seguía camino al
        // Watcher y al feed. Se reintenta UNA vez con más techo, porque el corte por presupuesto es
        // lo único que más presupuesto puede arreglar.
        if (r.ok && r.truncated) {
          const techoReintento = Math.ceil(maxTokens * ADAPTER_TRUNCATION_RETRY_FACTOR);
          console.error(
            `[SOCIALLAB][SIGN-02] platform=${platform} adaptación TRUNCADA en el techo ` +
            `(${maxTokens} tk, src=${ceiling.max_tokens_source}) — se reintenta una vez con ${techoReintento} tk.`,
          );
          const r2 = await adaptarUnaVez(techoReintento);
          if (r2.ok) r = r2;
        }
        // FIRMA-CABE-02 — el presupuesto se comprueba, no solo se pide. Un reintento, con el numero.
        if (r.ok && !r.truncated && excedePresupuesto(r.text, presupuesto)) {
          const largo = r.text.length;
          const r3 = await adaptarUnaVez(maxTokens, { previo: r.text, pedido: buildBudgetRetryMessage(largo, presupuesto as number) });
          const mejor = r3.ok && !r3.truncated && r3.text.trim() && r3.text.length < largo;
          console.error(
            `[SOCIALLAB][FIRMA-CABE-02] platform=${platform} cuerpo ${largo} > presupuesto ${presupuesto} — ` +
            `reintento: ${r3.ok ? r3.text.length : "fallo"}${mejor ? " (se usa)" : " (se conserva el primero)"}` +
            // El presupuesto puede venir del tope de la MARCA (más corto que el del canal): pasarse de
            // él no hace que el drenaje retenga nada. Se dice lo que es, no lo que parecía.
            `${mejor && excedePresupuesto(r3.text, presupuesto) ? " · SIGUE SOBRE EL PRESUPUESTO (el freno del drenaje sólo mira el tope del canal)" : ""}`,
          );
          if (mejor) r = r3;
        }
        if (r.ok && !r.truncated) {
          adaptedCopy = r.text;
        } else if (r.ok) {
          // SIGN-02 §3.4 — SEGUNDO CORTE: se cae al texto DE ENTRADA, sin adaptar. Es peor forma y
          // mejor pieza — un texto entero sin adaptar se puede leer; uno cortado a media palabra
          // no. Queda declarado en `ceilings.degraded`, no sólo en el log: un fallback invisible es
          // indistinguible de una adaptación que salió bien.
          truncated = true; degraded = true; adaptedCopy = inputCopy;
          console.error(
            `[SOCIALLAB][SIGN-02] platform=${platform} adaptación TRUNCADA otra vez tras el reintento ` +
            `— se publica el texto de entrada SIN adaptar (degraded). El texto cortado se descarta.`,
          );
        }
      } catch { /**/ }
    }
    // ── D-1a-i · LA MISMA PLATAFORMA, TAMBIÉN PARA EL TÍTULO Y EL GANCHO ──────────────────────
    // UNA llamada por canal para las dos partes juntas, y APARTE de la del cuerpo. Si ésta falla,
    // el cuerpo ya está resuelto y sale byte por byte como hoy; la parte que falló cae al maestro
    // Y LO DECLARA en su `*_source`. Un fallback invisible es indistinguible de una adaptación que
    // salió bien — es la lección de `ceilings.degraded`, aplicada aquí.
    //
    // AUTOFIX-6 (2026-10-02) — la llamada y la decisión viven en `adaptTitleAndHook` (bloque
    // TITLEADAPT) para que el auto-fix re-derive con ESTA misma lógica cuando cambia el maestro. Aquí
    // se corre igual que antes: los tokens, también los de una respuesta truncada, se suman a la
    // adaptación del cuerpo y se asientan juntos en la fila `adaptation`.
    const tp = await adaptTitleAndHook({ platform, ruleKey, rule, adapt, masterTitle, masterHook, languageDirective, model: modelo });
    total_in  += tp.input_tokens;
    total_out += tp.output_tokens;
    const adaptedTitle = tp.title;
    const adaptedHook  = tp.image_hook;
    const titleSource  = tp.title_source;
    const hookSource   = tp.image_hook_source;
    // TAG-AJENO — el barrido, aquí y no antes: sobre el texto FINAL, ya sea el adaptado o el maestro
    // degradado. Un barrido sobre la entrada dejaría pasar lo que el adaptador escriba después, que
    // es justamente de donde salieron los nueve casos medidos.
    const barrido = quitarTagsAjenos(adaptedCopy, nombresPropios, marcaPropia);
    if (barrido.quitados.length > 0) {
      adaptedCopy = barrido.texto;
      console.warn(
        `[TAG-AJENO] platform=${platform} retirados ${barrido.quitados.length} hashtag(s) que nombran ` +
        `algo nuestro o a otra marca: ${barrido.quitados.join(" ")} — quedan anotados en voice_constraints`,
      );
    }
    // HASHTAGS-01 — LA POLÍTICA DE LA VOZ, DETERMINISTA, sobre el texto final del canal (el adaptado o
    // el maestro degradado), después del barrido de ajenos y antes de la firma. El juez ve ya este
    // texto. Sin política declarada no se toca nada y la fila del registro dice por qué.
    const politicaHashtags = hashtagPolicies[platform] ?? null;
    if (politicaHashtags) {
      const hp = aplicarPoliticaDeHashtags(adaptedCopy, politicaHashtags, signatureText);
      if (hp.cambio) {
        adaptedCopy = hp.texto;
        console.log(
          `[HASHTAGS-01] platform=${platform} ${hp.entrada.length}→${hp.salida.length} hashtag(s) · ` +
          `techo=${hp.techo ?? "∅"} (${hp.techo_fuente}) · quitados=${hp.quitados.map((q) => `${q.tag}:${q.motivo}`).join(" ") || "∅"}` +
          (hp.fijos_recortados.length ? ` · fijos recortados por el techo: ${hp.fijos_recortados.join(" ")}` : ""),
        );
      }
      hashtagPolicyApplied.push(registroDePolitica(platform, politicaHashtags, hp));
    }
    // TECHO-CUMPLE (2026-10-22) — EL PRESUPUESTO SE CUMPLE, NO SÓLO SE PIDE. Sobre el texto FINAL del
    // canal: después de la reescritura de FIRMA-CABE-02, del barrido de ajenos y de la política de
    // hashtags (que puede añadir los fijos). Si no cabe, se quitan frases enteras del desarrollo; el
    // gancho, el cierre y los hashtags se quedan. Sólo en la plataforma que adapta: la que publica el
    // maestro tal cual no tiene presupuesto de cuerpo que cumplir aquí.
    const techo = adapt ? recortarPorFrase(adaptedCopy, presupuesto, null, terminosProtegidos) : null;
    if (techo?.cambio) {
      adaptedCopy = techo.texto;
      console.log(
        `[TECHO-CUMPLE] platform=${platform} ${techo.largo_antes} → ${techo.largo_despues} caracteres ` +
        `(presupuesto ${presupuesto}; ${techo.frases_quitadas} frase(s) del desarrollo fuera; gancho, cierre y hashtags intactos)`,
      );
    } else if (techo?.motivo === "no_cabe_sin_romper") {
      console.error(
        `[TECHO-CUMPLE] platform=${platform} ${techo.largo_antes} > presupuesto ${presupuesto} y no cabe quitando ` +
        `frases del desarrollo — se conserva el texto; queda asentado en social.ceilings`,
      );
    }
    adapted.push({
      platform, copy: adaptedCopy,
      title: adaptedTitle, image_hook: adaptedHook,
      title_source: titleSource, image_hook_source: hookSource,
    });
    applied.push({ platform, max_tokens: maxTokens, max_tokens_source: ceiling.max_tokens_source, adapted: adapt, truncated, degraded });
    // TECHO-CUMPLE — el presupuesto de cuerpo que rigió este canal y qué hizo con él. El auto-fix lo lee
    // de aquí para cumplir el MISMO número cuando reescribe: una sola resolución, un solo techo.
    Object.assign(applied[applied.length - 1], {
      budget: presupuesto, budget_outcome: techo?.motivo ?? (presupuesto === null ? "sin_presupuesto" : "no_adapta") });

    // ADAPT-01 · LA MEDICIÓN, determinista y siempre asentada. `hashtags_in` es el conteo del texto que
    // ENTRÓ y `hashtags_out` el del que SALIÓ: es la resta que fija de quién es el bloque de etiquetas,
    // y es la que hubo que reconstruir a mano para diagnosticar esto. `over_ceiling` sólo puede ser
    // true con un techo declarado — sin techo no hay exceso, hay ausencia de criterio.
    const hashtagsIn  = countHashtags(inputCopy);
    const hashtagsOut = countHashtags(adaptedCopy);
    const overCeiling = vc.max_hashtags !== null && hashtagsOut > vc.max_hashtags;
    constraintsApplied.push({
      platform, adapted: adapt,
      max_hashtags: vc.max_hashtags, max_hashtags_source: vc.max_hashtags_source,
      prohibitions: vc.prohibitions.length, hashtags_in: hashtagsIn, hashtags_out: hashtagsOut,
      over_ceiling: overCeiling,
      // LO QUE SE QUITÓ, ESCRITO. Un barrido demasiado ancho se lee en el dato en vez de suponerse;
      // sin esta lista, quitar de más y quitar de menos se ven exactamente igual desde fuera.
      tags_ajenos: barrido.quitados,
    });
    if (overCeiling && adapt) {
      // El techo llegó al prompt y el adaptador lo pasó igual. No se recorta aquí —elegir cuál de los
      // hashtags se va exige saber cuál es la base y cuál el temático, y eso es entender el texto— pero
      // deja de ser invisible: queda en el log, en `assets.social.voice_constraints` y a la vista del
      // veredicto, exactamente como F1 hizo con el truncado.
      console.error(
        `[SOCIALLAB][ADAPT-01] platform=${platform} el adaptado escribe ${hashtagsOut} hashtag(s) sobre ` +
        `un techo declarado de ${vc.max_hashtags} (src=${vc.max_hashtags_source}; el texto de entrada ` +
        `traía ${hashtagsIn}) — el texto que se juzga y se publica es éste.`,
      );
    } else if (overCeiling) {
      // Plataforma que NO se adapta (PLATFORM_NO_ADAPT): el exceso viene del texto recibido, no de aquí.
      // Se asienta igual —es un incumplimiento real del techo declarado— pero NO se le imputa al
      // adaptador. Atribuir mal un defecto medido es cómo se pierde una sesión persiguiendo al culpable
      // equivocado, que es exactamente lo que este brief vino a corregir.
      console.warn(
        `[SOCIALLAB][ADAPT-01] platform=${platform} sin adaptación y el texto recibido ya trae ` +
        `${hashtagsIn} hashtag(s) sobre un techo declarado de ${vc.max_hashtags} ` +
        `(src=${vc.max_hashtags_source}) — no es del adaptador; queda asentado.`,
      );
    } else if (adapt) {
      console.log(
        `[SOCIALLAB][ADAPT-01] platform=${platform} hashtags ${hashtagsIn}→${hashtagsOut} · ` +
        `techo=${vc.max_hashtags ?? "∅"} (src=${vc.max_hashtags_source}) · ` +
        `prohibiciones declaradas=${vc.prohibitions.length}`,
      );
    }
  }
  const output = `✅ ${adapted.length} copy(s) adaptado(s), a la espera del veredicto del Watcher.\n${adapted.map(a => `${a.platform}: ${a.copy.length} chars`).join("\n")}\n\n→ se encolan en scheduled_posts sólo si el Watcher da PASS (P-b).`;
  return {
    output, adapted, ceilings: applied, voice_constraints: constraintsApplied,
    hashtag_policy: hashtagPolicyApplied,
    input_tokens: total_in, output_tokens: total_out,
    // FIX-ADAPT-02 — bajo qué idioma corrió el adaptador y si su directiva salió de la tabla
    // o no había ninguna. Se emiten SIEMPRE, vacíos cuando no aplica.
    language: normalizeLanguageCode(language) || null,
    language_directive_source: languageDirectiveSource,
  };
}

export { adaptTitleAndHook, masterPartOf, normalizeLanguageCode, CEILING_UNDECLARED, VOICE_CONSTRAINTS_ABSENT };
