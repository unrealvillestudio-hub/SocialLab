/**
 * SocialLab — POST /api/adapt (Fase 6, 2026-10-26)
 *
 * La adaptación por canal del carril, como endpoint del lab (regla LABS): el carril (`content-run-stage`) resuelve los datos
 * de la marca y llama aquí, igual que llama a CopyLab. NO ESCRIBE NADA: ni `scheduled_posts` ni el libro. Devuelve el texto
 * adaptado, su registro y los tokens; quien llama asienta el costo, como hasta hoy.
 *
 * Cuerpo (el de `execLab`): `{ brandId, stage, params, previousOutputs, builder_input }`, con `builder_input.modo`:
 *   · `"adaptar"` → corre el adaptador completo (cuerpo, título y gancho, barrido de ajenos, política de hashtags, techo).
 *   · `"titulo"`  → sólo el título y el gancho de un canal (lo usa el auto-fix cuando cambia el maestro).
 * y opcionalmente `replay`: las respuestas del proveedor que el carril ya recibió, en orden. Con `replay` no se llama a nadie:
 * se devuelven además las peticiones que se habrían hecho (`llamadas`), para la comparación en sombra (6b).
 *
 * TODO LLEGA RESUELTO: techo, restricciones de la voz, política de hashtags, idioma y su directiva, firma, límite de caracteres,
 * nombres propios, regla de cada plataforma y modelo. Aquí no se consulta ninguna tabla de marca. El modelo se contrasta con
 * `public.ops_lab_models` (`sociallab` / `sync`): quien llama no puede elegir otro.
 *
 * Autenticación: `Authorization: Bearer <service_role>` del mismo proyecto, comparado en tiempo constante. Nada de esto nombra
 * una marca ni una plataforma.
 */
import { runSocialLabDirect, adaptTitleAndHook, conLlamador } from './_adaptCore.js';

declare const process: { env: Record<string, string | undefined> };

const MODELO_LAB = 'sociallab';
const MODELO_ROL = 'sync';
const MODELO_TTL_MS = 60_000;
let modeloGuardado: { modelo: string; hasta: number } | null = null;

/** Lectura directa de PostgREST con el service_role. Una sola tabla, sólo lectura. */
async function sbGet<T>(ruta: string): Promise<T[]> {
  const url = process.env.SUPABASE_URL ?? '', clave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const res = await fetch(`${url}/rest/v1/${ruta}`, { headers: { apikey: clave, Authorization: `Bearer ${clave}` } });
  if (!res.ok) throw new Error(`MODELO_ILEGIBLE: ${ruta.split('?')[0]} HTTP ${res.status}`);
  const d = await res.json();
  return Array.isArray(d) ? d as T[] : [];
}

async function modeloVigente(): Promise<string> {
  if (modeloGuardado && modeloGuardado.hasta > Date.now()) return modeloGuardado.modelo;
  const filas = await sbGet<{ model_id: string }>(
    `ops_lab_models?select=model_id&lab=eq.${MODELO_LAB}&role=eq.${MODELO_ROL}&active=is.true&limit=2`);
  const modelo = filas.length === 1 ? String(filas[0].model_id ?? '').trim() : '';
  if (!modelo) throw new Error(`MODELO_SIN_DATO: ops_lab_models no tiene una fila activa para ${MODELO_LAB}/${MODELO_ROL} (${filas.length})`);
  modeloGuardado = { modelo, hasta: Date.now() + MODELO_TTL_MS };
  return modelo;
}

export function igualEnTiempoConstante(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export class EntradaInvalida extends Error {}

const lista = (v: unknown, campo: string): string[] => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new EntradaInvalida(`${campo}: se esperaba una lista de textos`);
  return v as string[];
};
const objeto = (v: unknown, campo: string): Record<string, any> => {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new EntradaInvalida(`${campo}: se esperaba un objeto`);
  return v as Record<string, any>;
};
const textoONulo = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Las reglas de plataforma, resueltas por el carril. Una plataforma sin regla es un error de quien llama, no un default. */
export function reglasDe(v: unknown, plataformas: string[]): (p: string) => { key: string; rule: string; adapt: boolean } {
  const r = objeto(v, 'reglas');
  for (const p of plataformas) {
    const x = r[p];
    if (!x || typeof x.key !== 'string' || typeof x.rule !== 'string' || typeof x.adapt !== 'boolean') {
      throw new EntradaInvalida(`reglas: falta la regla resuelta de '${p}' ({key, rule, adapt})`);
    }
  }
  return (p: string) => {
    const x = r[p];
    if (!x) throw new Error(`REGLA_DE_PLATAFORMA_SIN_DATO: '${p}'`);
    return { key: x.key, rule: x.rule, adapt: x.adapt };
  };
}

/** El llamador del modo replay: devuelve las respuestas recibidas, en orden, y anota lo que se le pidió. */
export function llamadorReplay(respuestas: Array<{ status: number; body: unknown }>) {
  const llamadas: Array<Record<string, unknown>> = [];
  let i = 0;
  const ll = async (_url: string, init: any) => {
    llamadas.push(JSON.parse(String(init?.body ?? '{}')));
    const r = respuestas[i++];
    if (!r) throw new Error(`REPLAY_AGOTADO: el adaptador pidió la llamada ${i} y el carril mandó ${respuestas.length}`);
    const texto = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return {
      ok: r.status >= 200 && r.status < 300, status: r.status,
      json: async () => (typeof r.body === 'string' ? JSON.parse(r.body) : r.body),
      text: async () => texto,
    };
  };
  return { ll, llamadas, usadas: () => i };
}

export async function adaptar(bi: Record<string, any>, modelo: string) {
  const plataformas = lista(bi.plataformas, 'plataformas');
  const limites = new Map<string, number | null>(Object.entries(objeto(bi.limites, 'limites')) as Array<[string, number | null]>);
  const directiva = objeto(bi.directiva, 'directiva');
  if (typeof directiva.source !== 'string') throw new EntradaInvalida('directiva: se esperaba {directive, source}');
  return runSocialLabDirect(
    String(bi.texto ?? ''), plataformas, objeto(bi.techos, 'techos'), objeto(bi.restricciones, 'restricciones'),
    textoONulo(bi.idioma), textoONulo(bi.firma), limites, textoONulo(bi.titulo), textoONulo(bi.gancho),
    { maquinaria: [], marcas: [], ...objeto(bi.nombres_propios, 'nombres_propios') }, textoONulo(bi.marca_propia),
    objeto(bi.politicas_hashtags, 'politicas_hashtags'), Array.isArray(bi.terminos_protegidos) ? bi.terminos_protegidos : [],
    modelo, { directive: directiva.directive ?? null, source: directiva.source }, reglasDe(bi.reglas, plataformas),
  );
}

export async function titulo(bi: Record<string, any>, modelo: string) {
  const t = objeto(bi.titulo_canal, 'titulo_canal');
  if (typeof t.platform !== 'string' || typeof t.ruleKey !== 'string' || typeof t.rule !== 'string' || typeof t.adapt !== 'boolean') {
    throw new EntradaInvalida('titulo_canal: se esperaba {platform, ruleKey, rule, adapt, masterTitle, masterHook, languageDirective}');
  }
  return adaptTitleAndHook({
    platform: t.platform, ruleKey: t.ruleKey, rule: t.rule, adapt: t.adapt,
    masterTitle: textoONulo(t.masterTitle), masterHook: textoONulo(t.masterHook),
    languageDirective: t.languageDirective ?? null, model: modelo,
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'método no admitido' });
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const auth = String(req.headers?.authorization ?? '');
  if (!clave || !igualEnTiempoConstante(auth, `Bearer ${clave}`)) return res.status(401).json({ error: 'no autorizado' });

  let body: any = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'JSON inválido' }); } }
  const bi = body?.builder_input;
  if (!bi || typeof bi !== 'object') return res.status(400).json({ error: 'falta builder_input' });
  const modo = bi.modo;
  if (modo !== 'adaptar' && modo !== 'titulo') return res.status(400).json({ error: `modo desconocido: ${String(modo)}` });

  try {
    const vigente = await modeloVigente();
    const pedido = typeof bi.modelo === 'string' ? bi.modelo.trim() : '';
    if (pedido !== vigente) {
      return res.status(409).json({ error: `MODELO_DISTINTO: el carril pide '${pedido || '(vacío)'}' y ops_lab_models ${MODELO_LAB}/${MODELO_ROL} dice '${vigente}'` });
    }
    const correr = () => (modo === 'adaptar' ? adaptar(bi, vigente) : titulo(bi, vigente));
    if (Array.isArray(body.replay)) {
      const r = llamadorReplay(body.replay);
      const resultado = await conLlamador(r.ll, correr);
      return res.status(200).json({ ok: true, modo, modelo: vigente, resultado, llamadas: r.llamadas, replay_sin_usar: body.replay.length - r.usadas() });
    }
    const resultado = await correr();
    return res.status(200).json({ ok: true, modo, modelo: vigente, resultado });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof EntradaInvalida ? 400 : /^ADAPT_LANGUAGE_DIRECTIVE_MISSING|^MODELO_SIN_DATO|^REGLA_DE_PLATAFORMA_SIN_DATO|^REPLAY_AGOTADO/.test(msg) ? 422 : 500;
    return res.status(status).json({ error: msg.slice(0, 600) });
  }
}
