/**
 * SocialLab — EL CÍRCULO: los documentos de cada marca, como página.
 *
 *   https://circulo.<dominio de la marca>/guia | /crear | /operador   ← el enlace que reciben las personas
 *   GET /api/circle-kit?t=<doc_token>&doc=guia|crear|operador|kit       ← enlace largo, para una marca sin subdominio
 *   https://circulo.<dominio de la marca>/p/<id del envío>             ← 2026-10-28: la TARJETA de una publicación
 *   GET /api/circle-kit?p=<id del envío>                                ← la misma tarjeta, sin subdominio
 *   POST https://circulo.<dominio>/p/<id>/toque  ·  POST /api/circle-kit?p=<id>&toque=1
 *                                                                       ← 2026-10-28: el toque al botón de la tarjeta
 *
 * LA TARJETA (Sam, 2026-10-28): el enlace de una publicación de Facebook no abría en iPhone. El mensaje del grupo
 * lleva ahora esta página: sus etiquetas og llevan la imagen del post —WhatsApp la dibuja en el mensaje— y un
 * botón a la página de la marca, donde la publicación es la primera. La compone la EF (modo `card`); aquí se sirve.
 *
 * Por qué vive aquí (Sam, 2026-10-21): el Círculo amplifica cada publicación en redes, y SocialLab es la
 * salida a redes del ecosistema. Antes lo servía `unrlvl-context` (`api/circle-kit.js`), que es el sistema
 * de contexto, no una superficie pública de las marcas. Se movió entero; allí queda sólo la nota que remite
 * aquí.
 *
 * LO QUE SE MIDE (Sam, 2026-10-28: «métricas al menos de apertura»). Cada apertura de la tarjeta y cada toque a
 * su botón llegan a la EF con el TIPO de visita y nada más: el lector de vistas previas (WhatsApp y otros, que
 * leen la página para dibujar la imagen), un iPhone, un Android u otro. El navegador se mira aquí para
 * clasificar y no sale de aquí: ni el navegador, ni la IP, ni ningún dato de la persona llegan a la base.
 *
 * QUÉ HACE Y QUÉ NO. Este archivo NO compone el documento: lo pide a la EF `circle-dispatch` (modo `doc`),
 * que rellena la plantilla ÚNICA de `circle_templates` con el dato vivo de la marca. Aquí sólo se sirve el
 * HTML, porque Supabase no sirve HTML desde una EF.
 *   · No toca la base: llama a la EF con `IID_CRON_SECRET`.
 *   · La llave es el subdominio (`circle_circles.public_base_url`) o el token de 36 hex (`doc_token`).
 *     Un token o un host mal formados no llegan a la EF.
 *   · Fallo en voz alta: sin la variable, o si la EF falla, la respuesta lo dice con su código.
 *
 * `vercel.json` reescribe /guia, /crear y /operador a este archivo cuando el host empieza por `circulo.`,
 * y redirige a /guia cualquier otra ruta de ese host: el subdominio de una marca nunca sirve la app.
 *
 * TEST DE LA MARCA N+1: este archivo no nombra ninguna marca; la marca sale del host o del token.
 *
 * Env vars: SUPABASE_URL, IID_CRON_SECRET.
 */

declare const process: { env: Record<string, string | undefined> };

const EF_URL = () => `${process.env.SUPABASE_URL || 'https://amlvyycfepwhiindxgzw.supabase.co'}/functions/v1/circle-dispatch`;
const CRON_SECRET = () => process.env.IID_CRON_SECRET ?? '';

// ── CIRCULO-KIT:BEGIN ── bloque PURO. Lo prueba `tests/circulo_kit_test.mjs`.
const TOKEN = /^[0-9a-f]{36}$/;
const DOCS = new Set(['guia', 'crear', 'operador', 'kit']);
const HOST_CIRCULO = /^circulo\.[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const ID_ENVIO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Qué pide la llamada —un documento, la tarjeta de un envío o el toque a su botón— y con qué llave.
 *  `null` = enlace no válido. */
export function pedidoDoc(
  query: { t?: unknown; doc?: unknown; p?: unknown; toque?: unknown }, cabeceraHost: unknown,
): { mode: 'doc'; doc: string; host?: string; token?: string } | { mode: 'card' | 'card_tap'; id: string; host?: string } | null {
  const t = String(query.t ?? '');
  const doc = String(query.doc ?? 'guia');
  const host = String(cabeceraHost ?? '').toLowerCase().split(',')[0].trim().split(':')[0];
  // La tarjeta: un id de envío con forma de uuid. En el subdominio de una marca, la EF comprueba que sea suyo.
  if (query.p !== undefined) {
    const id = String(query.p).toLowerCase();
    if (!ID_ENVIO.test(id)) return null;
    const mode = query.toque === undefined ? 'card' as const : String(query.toque) === '1' ? 'card_tap' as const : null;
    if (!mode) return null;
    return HOST_CIRCULO.test(host) ? { mode, id, host } : { mode, id };
  }
  if (!DOCS.has(doc)) return null;
  if (!t && HOST_CIRCULO.test(host)) return { mode: 'doc', host, doc };
  if (TOKEN.test(t)) return { mode: 'doc', token: t, doc };
  return null;
}

/** El tipo de visita, sin ningún dato de la persona. Los lectores de vistas previas van primero: el de WhatsApp
 *  se presenta como «WhatsApp/2.x», y no es una persona abriendo la tarjeta. */
const LECTOR = /WhatsApp\/|facebookexternalhit|Facebot|TelegramBot|Twitterbot|Slackbot|Discordbot|LinkedInBot|SkypeUriPreview|Googlebot|bingbot|\bbot\b|crawler|spider/i;
export function claseDeVisita(ua: unknown): 'preview' | 'ios' | 'android' | 'other' {
  const s = String(ua ?? '');
  if (LECTOR.test(s)) return 'preview';
  if (/iPhone|iPad|iPod/.test(s)) return 'ios';
  if (/Android/.test(s)) return 'android';
  return 'other';
}

/** El método que admite cada pedido: el toque llega por `sendBeacon` (POST); lo demás se abre (GET). */
export const metodoDe = (mode: string) => (mode === 'card_tap' ? 'POST' : 'GET');
// ── CIRCULO-KIT:END ──

function texto(res: any, status: number, cuerpo: string) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).send(cuerpo);
}

export default async function handler(req: any, res: any) {
  const pedido = pedidoDoc(req.query ?? {}, req.headers['x-forwarded-host'] ?? req.headers.host);
  if (!pedido) return texto(res, req.method === 'GET' || req.method === 'POST' ? 400 : 405, 'enlace no válido');
  if (req.method !== metodoDe(pedido.mode)) return texto(res, 405, 'método no admitido');
  if (!CRON_SECRET()) {
    console.error('[circle-kit] CIRCLE_KIT_NO_SECRET: IID_CRON_SECRET no definida en el entorno');
    return texto(res, 503, 'CIRCLE_KIT_NO_SECRET: falta IID_CRON_SECRET en el entorno de Vercel');
  }

  let r: Response;
  try {
    r = await fetch(EF_URL(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET() },
      body: JSON.stringify(pedido.mode === 'doc' ? pedido : { ...pedido, visita: claseDeVisita(req.headers['user-agent']) }),
    });
  } catch (e) {
    console.error('[circle-kit] CIRCLE_KIT_EF_UNREACHABLE', e instanceof Error ? e.message : String(e));
    return texto(res, 502, 'CIRCLE_KIT_EF_UNREACHABLE');
  }
  const data: any = await r.json().catch(() => ({}));
  if (pedido.mode === 'card_tap') {
    if (!r.ok || !data?.ok) console.error('[circle-kit] CIRCLE_KIT_TAP_FAILED', String(data?.error ?? `EF ${r.status}`).slice(0, 160));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(r.ok && data?.ok ? 204 : 502).end();
  }
  if (!r.ok || !data?.ok || typeof data.html !== 'string') {
    const codigo = String(data?.error ?? `EF ${r.status}`).slice(0, 160);
    console.error('[circle-kit] CIRCLE_KIT_EF_FAILED', codigo);
    return texto(res, codigo.startsWith('CIRCLE_NOT_FOUND') ? 404 : 502, codigo);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.status(200).send(data.html);
}
