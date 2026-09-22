/**
 * SocialLab — api/_igContainer.ts
 *
 * EL BLOQUE PURO DEL CONTENEDOR DE INSTAGRAM: los plazos y la lectura del estado. Sin red, sin
 * Supabase y sin MCP, para que un test lo ejecute tal cual.
 *
 * Vive aparte de `api/publish.ts` por dos razones, y la segunda es la que manda:
 *   1 · aqui se decide SI SE PUBLICA, y esa decision merece probarse caso por caso;
 *   2 · `api/publish.ts` no se puede importar desde un test de Node — usa una propiedad de
 *       parametro en el constructor de `SbReadError`, que el type stripping nativo rechaza
 *       (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). Medido al escribir este test.
 *
 * El prefijo `_` marca modulo, NO ruta de Vercel.
 */

// ── ESPERAR A QUE EL CONTENEDOR DE INSTAGRAM ESTE LISTO · 9007 ────────────────
//
// ── EL CASO, MEDIDO EL 2026-09-22 ─────────────────────────────────────────────
// De los ultimos CINCO intentos de publicacion en Instagram, CUATRO fallaron con
// `9007 · Media ID is not available` —15, 17, 18 y 21 de septiembre—, los cuatro entre 6 y 9
// segundos despues de crear la fila. Facebook, en la misma ventana, publico 12 de 14.
//
// La diferencia no es la suerte. Facebook publica en UNA llamada. Instagram crea un contenedor que
// se procesa de forma ASINCRONA y solo despues se publica: al volver de `ig_create_container` el
// medio TODAVIA NO SIRVE, y publicarlo entonces devuelve 9007. Este archivo encadenaba las dos
// llamadas sin nada en medio.
//
// ── POR QUE SE ESPERA AQUI Y NO EN EL MCP ─────────────────────────────────────
// El MCP expone `ig_get_container_status` como una LECTURA: pregunta y responde. Meter la espera
// alli seria esconder un tiempo de respuesta impredecible dentro de una herramienta que dice leer,
// y todo el que la llamara —no solo este publicador— pagaria una espera que no pidio.
//
// La espera es una decision de QUIEN PUBLICA, porque es quien tiene el plazo: esta funcion corre
// con `maxDuration: 300` (vercel.json) y el drenaje la invoca con UN `post_id` por llamada
// (`content-scheduler`, `body: JSON.stringify({ post_id: postId })`), asi que el presupuesto de
// abajo cabe de sobra. `PUBLISH_DEADLINE_MS` existe igualmente para el caso manual —llamar con
// `brand_id` publica TODOS los pendientes de la marca— donde varios contenedores lentos podrian
// sumar mas de lo que dura la funcion.
//
// ── ANTE LA DUDA, NO PUBLICAR ─────────────────────────────────────────────────
// Los cinco estados de Graph se tratan por separado y solo UNO publica:
//   FINISHED     listo. Es el unico caso en que se llama a publicar.
//   IN_PROGRESS  se sigue esperando hasta agotar el presupuesto.
//   ERROR        el procesamiento fallo. Se para YA: insistir gasta el plazo para nada.
//   EXPIRED      el contenedor caduco. Igual.
//   PUBLISHED    ya salio. Se para y se dice, SIN volver a publicar: es el unico estado en el que
//                insistir no da un error sino un POST DUPLICADO en la cuenta de la marca.
// Un `status_code` que no se sepa leer NO se trata como listo: se sigue esperando y, si el plazo
// se acaba, se falla diciendo que nunca se supo. Interpretar un desconocido como FINISHED es
// exactamente el error de hoy, con un disfraz mejor.

/** Cuanto se espera, como mucho, a que UN contenedor este listo. */
export const CONTAINER_TIMEOUT_MS = 90_000;
/** Primera consulta: un contenedor de imagen suele estar listo antes de esto. */
export const FIRST_CHECK_MS = 2_000;
/** Entre consultas. Fijo y no exponencial: el plazo es corto y un backoff aqui solo añade latencia. */
export const CHECK_EVERY_MS = 3_000;
/**
 * Tope de TODA la corrida, por debajo del `maxDuration: 300` de `vercel.json`. Si se agota, los
 * posts que queden se dejan pendientes en vez de morir a medias: una funcion que Vercel corta deja
 * la fila en `pending_publish` sin decir por que, y este limite convierte eso en un motivo escrito.
 */
export const PUBLISH_DEADLINE_MS = 240_000;

export const dormir = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Los estados que Graph devuelve en `status_code`. */
export type ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED' | 'UNKNOWN';

/**
 * Lee el `status_code` de lo que respondio el MCP. PURA, y exportada para poder probarla: es el
 * punto donde un texto inesperado podria colarse como «listo».
 *
 * Todo lo que no sea uno de los cinco estados conocidos es `UNKNOWN`, incluido un texto que no
 * parsea. `UNKNOWN` NO publica.
 */
export function leerEstadoContenedor(texto: string | null): { estado: ContainerStatus; detalle: string | null } {
  if (!texto) return { estado: 'UNKNOWN', detalle: null };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    return { estado: 'UNKNOWN', detalle: texto.slice(0, 200) };
  }
  const crudo = typeof parsed.status_code === 'string' ? parsed.status_code.toUpperCase() : '';
  const detalle = typeof parsed.status === 'string' ? parsed.status : null;
  const conocidos: ContainerStatus[] = ['IN_PROGRESS', 'FINISHED', 'ERROR', 'EXPIRED', 'PUBLISHED'];
  return {
    estado: (conocidos as string[]).includes(crudo) ? (crudo as ContainerStatus) : 'UNKNOWN',
    detalle: detalle ?? (crudo ? null : texto.slice(0, 200)),
  };
}

