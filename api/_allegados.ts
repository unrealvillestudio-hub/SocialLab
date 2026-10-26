/**
 * CUENTAS ALLEGADAS (Sam, 2026-10-26) — la E/S de `content.brand_close_accounts` (unrlvl-iid-functions, migración
 * 20261026220000). Las cuentas del equipo o allegadas (amigos y familia) de una marca: sus comentarios no esperan
 * respuesta, la bandeja los aparta y el asesor no los considera. No se restan de las métricas de la plataforma.
 *
 * Antes de la migración la tabla no existe: leer devuelve «ninguna» (la bandeja sigue) y marcar responde con el motivo.
 */
import { sbGet, enLista, esTablaInexistente, LecturaFallida, SB_URL, SB_KEY } from './_opsShared.js';
import { claveDeAutor, type Relacion } from './_commentsCore.js';
import { TODAS } from './_opsCore.js';

export interface CuentaAllegada { brand_id: string; platform: string; author_name: string; relation: Relacion; added_by: string; added_at: string }

/** Las cuentas allegadas de estas marcas, por clave (`claveDeAutor`). Sin la tabla, ninguna. */
export async function leerAllegados(marcas: typeof TODAS | string[]): Promise<Map<string, CuentaAllegada>> {
  const out = new Map<string, CuentaAllegada>();
  try {
    const filtro = marcas === TODAS ? '' : `&brand_id=${enLista(marcas)}`;
    const filas = await sbGet<CuentaAllegada>(`brand_close_accounts?select=brand_id,platform,author_name,relation,added_by,added_at${filtro}`, 'content');
    for (const f of filas) out.set(claveDeAutor(f.brand_id, f.platform, f.author_name), f);
  } catch (err) {
    if (esTablaInexistente(err)) return out;
    throw err;
  }
  return out;
}

async function escribir(metodo: 'POST' | 'DELETE', ruta: string, cuerpo?: unknown): Promise<Response> {
  return fetch(`${SB_URL()}/rest/v1/${ruta}`, {
    method: metodo,
    headers: {
      apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Profile': 'content', 'Accept-Profile': 'content',
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
}

export type Resultado = { ok: true } | { ok: false; status: number; error: string };

/** Marca la cuenta como allegada o del equipo. Ya marcada → 409. */
export async function marcarAllegado(c: { brand_id: string; platform: string; author_name: string }, relation: Relacion, sub: string): Promise<Resultado> {
  const res = await escribir('POST', 'brand_close_accounts', { ...c, relation, added_by: sub });
  if (res.ok) return { ok: true };
  const detalle = await res.text().catch(() => '');
  if (res.status === 409 || detalle.includes('23505')) return { ok: false, status: 409, error: 'esa cuenta ya está marcada' };
  if (detalle.includes('PGRST205') || detalle.includes('42P01')) {
    return { ok: false, status: 503, error: 'marcar allegados todavía no está disponible: falta aplicar su migración' };
  }
  throw new LecturaFallida('brand_close_accounts (POST)', `HTTP ${res.status} ${detalle.slice(0, 300)}`);
}

/** Quita la cuenta de las allegadas. No estaba → 404. */
export async function quitarAllegado(c: { brand_id: string; platform: string; author_name: string }): Promise<Resultado> {
  const res = await escribir('DELETE',
    `brand_close_accounts?brand_id=eq.${encodeURIComponent(c.brand_id)}&platform=eq.${encodeURIComponent(c.platform)}&author_name=eq.${encodeURIComponent(c.author_name)}`);
  if (!res.ok) throw new LecturaFallida('brand_close_accounts (DELETE)', `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const filas = (await res.json().catch(() => [])) as unknown[];
  return filas.length ? { ok: true } : { ok: false, status: 404, error: 'esa cuenta no estaba marcada' };
}
