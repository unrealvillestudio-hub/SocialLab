/**
 * SocialLab — GET /api/tiktok-media?o=<bucket>/<ruta>
 *
 * LA IMAGEN QUE DESCARGA TIKTOK. Las fotos de TikTok sólo entran por `PULL_FROM_URL` desde un dominio
 * VERIFICADO, en WebP o JPEG de hasta 1080p (`reportado`, doc de TikTok citada el 2026-11-20). Las piezas viven
 * como PNG en el almacenamiento de Supabase, que no es un dominio nuestro. Este endpoint, servido en el dominio
 * verificado (Sam 2026-11-20: `media.unrealvillestudio.com`, que apunta a este proyecto), lee la imagen de la
 * transformación del almacenamiento —WebP de hasta 1080 px— y la entrega tal cual: 200, sin redirect.
 *
 * NO ES UN PROXY ABIERTO: sólo sirve objetos PÚBLICOS del almacenamiento de `SUPABASE_URL`, con bucket y ruta
 * validados (`parseMediaParam`). Cualquier otra cosa: 400. Sin `SUPABASE_URL`: 503.
 */

import { parseMediaParam, storageRenderUrlOf } from './_tiktok.js';

declare const process: { env: Record<string, string | undefined> };

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed' });
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  if (!supabaseUrl) return res.status(503).json({ error: 'falta SUPABASE_URL en el runtime' });

  const o = typeof req.query?.o === 'string' ? req.query.o : Array.isArray(req.query?.o) ? req.query.o[0] : '';
  const ref = parseMediaParam(o);
  if (!ref) return res.status(400).json({ error: 'parámetro o inválido: se espera <bucket>/<ruta> de un objeto público' });

  let origen: Response;
  try {
    origen = await fetch(storageRenderUrlOf(supabaseUrl, ref), { headers: { Accept: 'image/webp' } });
  } catch (err) {
    return res.status(502).json({ error: `el almacenamiento no respondió: ${err instanceof Error ? err.message : String(err)}` });
  }
  const tipo = origen.headers.get('content-type') ?? '';
  if (!origen.ok || !/^image\/(webp|jpeg)$/i.test(tipo.split(';')[0].trim())) {
    return res.status(origen.ok ? 502 : origen.status === 404 ? 404 : 502)
      .json({ error: `el almacenamiento devolvió ${origen.status} ${tipo}` });
  }
  const bytes = Buffer.from(await origen.arrayBuffer());
  res.setHeader('Content-Type', tipo);
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(200).send(req.method === 'HEAD' ? '' : bytes);
}
