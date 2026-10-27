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


/**
 * CÓMO SE VE LA CUENTA EN LA MAQUETA (Sam, 2026-10-27: «de ahí utilizas el profile pic para las demás plataformas»).
 * Los perfiles son dato (`intel.account_profiles`, los lee SignalLab) y llegan con el catálogo.
 */
export interface PerfilDeCuenta { brand_id: string; platform: string; username: string | null; display_name: string | null; picture_url: string | null }

const PERFILES: PerfilDeCuenta[] = [];
/** Se llama con el catálogo, igual que las maquetas. */
export function registrarPerfiles(xs: readonly PerfilDeCuenta[] | undefined): void {
  PERFILES.splice(0, PERFILES.length, ...(xs ?? []));
}

/**
 * El usuario y la foto con que se dibuja la cuenta de una marca en una plataforma: los de su perfil en esa plataforma.
 * Una plataforma sin perfil leído toma los de la red donde la foto manda —la de maqueta `feed_imagen`— y, si no, los de
 * cualquier perfil de la marca con foto. Sin ninguno, el nombre de la marca y su inicial, como antes.
 */
export function cuentaDe(brandId: string, platform: string | null | undefined, nombreMarca: string,
  perfiles: readonly PerfilDeCuenta[] = PERFILES, reglas: readonly ReglaMaqueta[] = REGLAS): { cuenta: string; foto: string | null } {
  const deLaMarca = perfiles.filter((p) => p.brand_id === brandId);
  const propio = deLaMarca.find((p) => p.platform === platform);
  const conFoto = deLaMarca.filter((p) => p.picture_url)
    .sort((a, b) => Number(maquetaDe(b.platform, null, reglas)?.layout === 'feed_imagen') - Number(maquetaDe(a.platform, null, reglas)?.layout === 'feed_imagen'))[0];
  return {
    cuenta: propio?.username ?? propio?.display_name ?? conFoto?.username ?? conFoto?.display_name ?? nombreMarca,
    foto: propio?.picture_url ?? conFoto?.picture_url ?? null,
  };
}
