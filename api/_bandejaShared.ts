/**
 * LO QUE COMPARTEN LAS BANDEJAS (comentarios y mensajes directos, Sam 2026-10-26): escribir en PostgREST con
 * `service_role`, el catálogo de intenciones y la meta de respuesta. Un solo lugar, para que las dos bandejas
 * clasifiquen y midan igual.
 */
import { sbGet, enLista, SB_URL, SB_KEY } from './_opsShared.js';
import { TODAS } from './_opsCore.js';
import { clasificador, type Intencion, type PatronDeIntencion, type MetaDeRespuesta } from './_commentsCore.js';

export class EscrituraFallida extends Error {
  ruta: string;
  constructor(ruta: string, detalle: string) {
    super(`ESCRITURA_FALLIDA: ${ruta} — ${detalle}`);
    this.name = 'EscrituraFallida';
    this.ruta = ruta;
  }
}

/** POST o PATCH a PostgREST con `service_role`. Devuelve las filas escritas. */
export async function sbEscribir<T>(metodo: 'POST' | 'PATCH', ruta: string, cuerpo: unknown, perfil: string): Promise<T[]> {
  let res: Response;
  try {
    res = await fetch(`${SB_URL()}/rest/v1/${ruta}`, {
      method: metodo,
      headers: {
        apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Profile': perfil,
        'Content-Type': 'application/json', Prefer: 'return=representation',
      },
      body: JSON.stringify(cuerpo),
    });
  } catch (err) {
    throw new EscrituraFallida(ruta, `la petición no llegó: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new EscrituraFallida(ruta, `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const data = await res.json().catch(() => []);
  return (Array.isArray(data) ? data : [data]) as T[];
}

/**
 * El catálogo de intenciones (unrlvl-iid-functions, migración 20261026233000): las activas y los patrones comunes y de
 * las marcas consultadas. Sin la migración, no hay intenciones y la bandeja ordena como antes.
 */
export async function catalogoDeIntenciones(marcas: typeof TODAS | string[]) {
  const filtro = marcas === TODAS ? '' : `&or=(brand_id.is.null,brand_id.${enLista(marcas)})`;
  const [intenciones, patrones] = await Promise.all([
    sbGet<Intencion>('comment_intents?select=intent_key,label,priority,display_color,fallback&active=is.true', 'intel'),
    sbGet<PatronDeIntencion>(`comment_intent_patterns?select=intent_key,brand_id,pattern${filtro}`, 'intel'),
  ]).catch((e) => {
    console.error(`[bandeja] intenciones sin leer: ${e instanceof Error ? e.message : e}`);
    return [[], []] as [Intencion[], PatronDeIntencion[]];
  });
  const c = clasificador(intenciones, patrones);
  for (const p of c.invalidos) console.error(`[bandeja] patrón de intención que no compila (${p.intent_key}): ${p.pattern}`);
  return c;
}

/**
 * La meta de respuesta (unrlvl-iid-functions, migración 20261026230000): las de cada marca y la de por defecto. Sin la
 * migración no hay metas: el tablero mide igual, sin comparar.
 */
export async function metasDeRespuesta(marcas: typeof TODAS | string[]): Promise<{ metas: MetaDeRespuesta[]; porDefecto: number | null }> {
  const filtro = marcas === TODAS ? '' : `&brand_id=${enLista(marcas)}`;
  const [metas, conf] = await Promise.all([
    sbGet<MetaDeRespuesta>(`brand_response_targets?select=brand_id,platform,target_minutes${filtro}`, 'intel').catch((e) => {
      console.error(`[bandeja] metas de respuesta sin leer: ${e instanceof Error ? e.message : e}`); return [] as MetaDeRespuesta[];
    }),
    sbGet<{ value: unknown }>('signal_collector_config?key=eq.response_target_minutes&select=value', 'intel').catch(() => []),
  ]);
  const d = Number(conf[0]?.value);
  return { metas, porDefecto: Number.isFinite(d) && d > 0 ? d : null };
}
