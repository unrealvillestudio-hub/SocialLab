/**
 * TABLERO DE OPERADORES — E/S compartida (Fase 2, 2026-10-24).
 *
 * Lecturas de la base con `service_role` (desde el servidor, nunca desde el navegador) y llamadas de
 * lectura al MCP de Meta. Las decisiones viven en `_opsCore.ts`.
 *
 * Ningún fallo de lectura se presenta como «no hay nada»: `LecturaFallida` sube hasta el handler,
 * que responde 503 con el detalle (mismo criterio que N11 en `api/publish.ts`).
 */
import { verificarSesion, alcanceDe, type Sesion, type Alcance, type Concesion } from './_opsCore.js';

declare const process: { env: Record<string, string | undefined> };

export const SB_URL = () => (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
export const SB_KEY = () => (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
/** El secreto con el que `iid-inbound` firma la sesión del operador. Nombre funcional en este repo; mismo valor. */
export const SESSION_SECRET = () => (process.env.OPERATOR_SESSION_JWT_SECRET ?? '').trim();
export const META_MCP = () => process.env.META_MCP_URL ?? 'https://unrlvl-meta-mcp.vercel.app/api/mcp/mcp';

export class LecturaFallida extends Error {
  constructor(public ruta: string, public detalle: string, public status?: number, public codigo?: string) {
    super(`LECTURA_FALLIDA: ${ruta} — ${detalle}`);
    this.name = 'LecturaFallida';
  }
}

/** GET a PostgREST. `perfil` es el esquema (`public`, `intel`, `content`). */
export async function sbGet<T>(ruta: string, perfil = 'public', timeoutMs = 15_000): Promise<T[]> {
  if (!SB_URL() || !SB_KEY()) throw new LecturaFallida(ruta, 'faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el runtime');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${SB_URL()}/rest/v1/${ruta}`, {
      headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Accept-Profile': perfil },
      signal: ctl.signal,
    });
  } catch (err) {
    throw new LecturaFallida(ruta, `la petición no llegó: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => '');
    let codigo: string | undefined;
    try { codigo = (JSON.parse(cuerpo) as { code?: string }).code; } catch { /* cuerpo no JSON */ }
    throw new LecturaFallida(ruta, `HTTP ${res.status} ${cuerpo.slice(0, 300)}`, res.status, codigo);
  }
  const data = await res.json().catch(() => { throw new LecturaFallida(ruta, 'respuesta 2xx ilegible'); });
  return (Array.isArray(data) ? data : [data]) as T[];
}

/** Una tabla que todavía no existe (o que PostgREST aún no tiene en caché) no es una tabla vacía. */
export function esTablaInexistente(err: unknown): boolean {
  return err instanceof LecturaFallida && (err.codigo === 'PGRST205' || err.codigo === '42P01' || err.status === 404);
}

/** `in.(...)` de PostgREST, con cada valor entre comillas. */
export function enLista(valores: readonly string[]): string {
  return `in.(${valores.map((v) => `"${String(v).replace(/["\\]/g, '')}"`).join(',')})`;
}

// ── Sesión y alcance ──────────────────────────────────────────────────────────

export function tokenDe(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const raw = req.headers['authorization'];
  const h = Array.isArray(raw) ? raw[0] : raw;
  return h && /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '').trim() : undefined;
}

async function concesionesDe(sub: string): Promise<Concesion[] | null> {
  try {
    const filas = await sbGet<{ brand_id?: unknown; views?: unknown }>(
      `operator_review_scope?operator_sub=eq.${encodeURIComponent(sub)}&select=brand_id,views`, 'intel');
    return filas
      .map((f) => ({ brand_id: String(f.brand_id ?? ''), views: Array.isArray(f.views) ? f.views.map(String) : null }))
      .filter((f) => f.brand_id);
  } catch (err) {
    console.error('[tablero] lectura de intel.operator_review_scope falló:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** La puerta del tablero. Responde y devuelve null si algo falla (503 configuración, 401 sesión, 403 alcance). */
export async function exigirOperador(req: any, res: any): Promise<{ sesion: Sesion; alcance: Alcance } | null> {
  if (!SB_URL() || !SB_KEY()) {
    res.status(503).json({ error: 'config_missing', message: 'Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el runtime' });
    return null;
  }
  if (!SESSION_SECRET()) {
    res.status(503).json({ error: 'config_missing', message: 'Falta OPERATOR_SESSION_JWT_SECRET en el runtime' });
    return null;
  }
  const sesion = verificarSesion(tokenDe(req), SESSION_SECRET());
  if (!sesion) { res.status(401).json({ error: 'sesión inválida o expirada, vuelve a entrar' }); return null; }
  const alcance = alcanceDe(sesion, sesion.role === 'admin' ? [] : await concesionesDe(sesion.sub));
  if (!alcance) {
    res.status(403).json({ error: `forbidden: '${sesion.sub}' no tiene marcas asignadas en el tablero` });
    return null;
  }
  return { sesion, alcance };
}

// ── MCP de Meta (sólo lectura) ────────────────────────────────────────────────

let idMensaje = 1;

/** Llama una tool del MCP y devuelve el JSON que trae su contenido de texto. Lanza ante cualquier fallo. */
export async function mcpLeer(tool: string, args: Record<string, unknown>, timeoutMs = 20_000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(META_MCP(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: idMensaje++, method: 'tools/call', params: { name: tool, arguments: args } }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    let sobre: any = null;
    if (ct.includes('event-stream')) {
      for (const linea of (await res.text()).split('\n')) {
        if (linea.startsWith('data:')) { try { sobre = JSON.parse(linea.slice(5).trim()); break; } catch { /* siguiente */ } }
      }
    } else {
      sobre = await res.json();
    }
    if (sobre?.error) throw new Error(`MCP: ${sobre.error.message ?? JSON.stringify(sobre.error)}`);
    const contenido = sobre?.result?.content;
    const texto = Array.isArray(contenido) ? contenido.find((c: any) => c?.type === 'text')?.text : null;
    if (sobre?.result?.isError) throw new Error(`MCP ${tool}: ${texto ?? 'error sin detalle'}`);
    if (typeof texto !== 'string') throw new Error(`MCP ${tool}: respuesta sin texto`);
    try { return JSON.parse(texto); } catch { throw new Error(`MCP ${tool}: ${texto.slice(0, 300)}`); }
  } finally {
    clearTimeout(t);
  }
}
