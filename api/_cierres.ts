/**
 * CIERRES DE COMENTARIOS (Sam, 2026-10-26) — la E/S de `content.post_comment_closures` (unrlvl-iid-functions #499).
 *
 * «Si se marca como descartado o hecho o respondido, por estatus no debería aparecer en el siguiente barrido.» Un
 * comentario se cierra sin responderlo desde el tablero —`hecho`, `descartado`, `contestado_fuera`— y sale de la
 * bandeja; `social-advisor` deja de proponerlo. Al cerrarlo o responderlo, sus recomendaciones abiertas caducan: el
 * consejo de algo ya atendido no se queda en Acciones.
 *
 * Antes de la migración la tabla no existe: leer devuelve «sin cierres» (la bandeja sigue) y cerrar responde con el
 * motivo, nunca en silencio.
 */
import { sbGet, enLista, esTablaInexistente, LecturaFallida, SB_URL, SB_KEY } from './_opsShared.js';
import type { TipoCierre } from './_commentsCore.js';

export interface Cierre { post_comment_id: number; kind: TipoCierre; closed_by: string; closed_at: string }

const TROZO = 100;

async function sbEscribir(metodo: 'POST' | 'PATCH' | 'DELETE', ruta: string, perfil: string, cuerpo?: unknown): Promise<Response> {
  return fetch(`${SB_URL()}/rest/v1/${ruta}`, {
    method: metodo,
    headers: {
      apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Profile': perfil, 'Accept-Profile': perfil,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
}

/** Los cierres de estos comentarios. Sin la tabla (antes de la migración), ninguno. */
export async function leerCierres(ids: readonly number[]): Promise<Map<number, Cierre>> {
  const out = new Map<number, Cierre>();
  try {
    for (let i = 0; i < ids.length; i += TROZO) {
      const filas = await sbGet<Cierre>(
        `post_comment_closures?select=post_comment_id,kind,closed_by,closed_at&post_comment_id=${enLista(ids.slice(i, i + TROZO).map(String))}`,
        'content');
      for (const f of filas) out.set(Number(f.post_comment_id), { ...f, post_comment_id: Number(f.post_comment_id) });
    }
  } catch (err) {
    if (esTablaInexistente(err)) return out;
    throw err;
  }
  return out;
}

export type ResultadoCierre = { ok: true; cierre: Cierre } | { ok: false; status: number; error: string };

/** Cierra un comentario. Ya cerrado → 409 con el cierre vigente en el mensaje. */
export async function cerrar(postCommentId: number, kind: TipoCierre, sub: string, recommendationId: string | null = null): Promise<ResultadoCierre> {
  const res = await sbEscribir('POST', 'post_comment_closures', 'content',
    { post_comment_id: postCommentId, kind, closed_by: sub, ...(recommendationId ? { recommendation_id: recommendationId } : {}) });
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    if (res.status === 409 || detalle.includes('23505')) return { ok: false, status: 409, error: 'ese comentario ya está cerrado' };
    if (detalle.includes('PGRST205') || detalle.includes('42P01')) {
      return { ok: false, status: 503, error: 'cerrar comentarios todavía no está disponible: falta aplicar la migración de cierres' };
    }
    throw new LecturaFallida('post_comment_closures (POST)', `HTTP ${res.status} ${detalle.slice(0, 300)}`);
  }
  const [cierre] = (await res.json().catch(() => [])) as Cierre[];
  await caducarRecomendaciones(postCommentId, `sistema: comentario cerrado (${kind}) por ${sub}`, recommendationId);
  return { ok: true, cierre };
}

/** Reabre un comentario: borra su cierre. Sin cierre → 404. */
export async function reabrir(postCommentId: number): Promise<ResultadoCierre | { ok: true; cierre: null }> {
  const res = await sbEscribir('DELETE', `post_comment_closures?post_comment_id=eq.${postCommentId}`, 'content');
  if (!res.ok) throw new LecturaFallida('post_comment_closures (DELETE)', `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const filas = (await res.json().catch(() => [])) as unknown[];
  return filas.length ? { ok: true, cierre: null } : { ok: false, status: 404, error: 'ese comentario no estaba cerrado' };
}

/**
 * Las recomendaciones abiertas (`nueva`) de un comentario ya atendido pasan a `caducada`, con el motivo en `status_by`
 * (estado que pone el sistema, nunca el operador). `excepto`: la que se acaba de seguir. Un fallo aquí se registra y
 * no deshace el cierre ni la respuesta: lo atendido ya está atendido.
 */
export async function caducarRecomendaciones(postCommentId: number, motivo: string, excepto: string | null = null): Promise<void> {
  try {
    const res = await sbEscribir('PATCH',
      `social_advisor_recommendations?post_comment_id=eq.${postCommentId}&status=eq.nueva${excepto ? `&id=neq.${excepto}` : ''}`,
      'intel', { status: 'caducada', status_by: motivo, status_at: new Date().toISOString() });
    if (!res.ok) console.error(`[cierres] caducar recomendaciones de ${postCommentId}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  } catch (err) {
    console.error(`[cierres] caducar recomendaciones de ${postCommentId}: ${err instanceof Error ? err.message : err}`);
  }
}
