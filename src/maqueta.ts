/**
 * QUÉ MAQUETA USA CADA PUBLICACIÓN (Sam, 2026-10-27). Núcleo puro: las reglas son dato (`intel.platform_previews`) y
 * llegan con el catálogo; aquí sólo se elige. Una regla de formato manda sobre la de la plataforma; sin ninguna, null
 * (la tarjeta se ve sin maqueta). Ninguna plataforma se nombra en este archivo.
 */

export type FormaMaqueta = 'feed_imagen' | 'feed_texto' | 'feed_breve' | 'vertical' | 'articulo';
export type Proporcion = 'natural' | '1:1' | '4:5' | '9:16' | '16:9' | '1.91:1';
export interface ReglaMaqueta { platform: string; media_format: string | null; layout: FormaMaqueta; aspect: Proporcion }

const REGLAS: ReglaMaqueta[] = [];
/** Se llama con el catálogo, igual que los colores de plataforma. */
export function registrarMaquetas(xs: readonly ReglaMaqueta[] | undefined): void {
  REGLAS.splice(0, REGLAS.length, ...(xs ?? []));
}
/** La maqueta de una plataforma y formato: la del formato si existe; si no, la de la plataforma; si no, ninguna. */
export function maquetaDe(platform: string | null | undefined, formato: string | null | undefined, reglas: readonly ReglaMaqueta[] = REGLAS):
  { layout: FormaMaqueta; aspect: Proporcion } | null {
  if (!platform) return null;
  const r = reglas.find((x) => x.platform === platform && formato && x.media_format === formato)
    ?? reglas.find((x) => x.platform === platform && x.media_format === null);
  return r ? { layout: r.layout, aspect: r.aspect } : null;
}

