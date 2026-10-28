# Carril TikTok + esqueleto LinkedIn — SocialLab

Integración de código del carril social hacia TikTok (vía EXENTA de auditoría, `video.upload` →
borrador al inbox) y el esqueleto de OAuth de LinkedIn. Estado medido/reportado el 2026-10-28.

Este documento es la referencia operativa del carril. La regla de entrega vive en
`unrlvl-context/protocols/DELIVERY_AND_VERIFICATION_RULE.md`; aquí sólo se separa, con destinatario,
lo que tiene que hacer Sam de lo que ya está en el código.

---

## Cómo está modelado (resumen)

- **Worker de publicación:** `api/publish.ts` lee `scheduled_posts` con `status='pending_publish'` y
  despacha por `post.platform`. Ahora: `INSTAGRAM`/`FACEBOOK` → Meta MCP; `TIKTOK` →
  `publishTikTokInbox`; `LINKEDIN` → `publishLinkedInBlocked` (bloqueado, no simula).
- **Token por marca:** igual que el carril Meta resuelve el suyo en la tabla `meta_accounts`
  (`unrlvl-meta-mcp/lib/meta.ts → getBrand`), TikTok y LinkedIn resuelven el suyo en
  `social_oauth_tokens`, por `(provider, brand_id)`. **El eje** (un token OAuth por proveedor y
  marca) vive en el código; **la instancia** (cada fila) vive en el dato. Conectar otra marca o
  cuenta es un `INSERT`, nunca una edición de código.
- **Secreto de app vs token de usuario.** El secreto de app (client key/secret) va a env/Vault y lo
  carga Sam — eso es lo que CC no puede cargar (`CC_PROTOCOL.md` §13 P0-B). El token de usuario
  (access/refresh) se obtiene en runtime por OAuth y se guarda en `social_oauth_tokens`, porque el
  refresh de TikTok **puede devolver un refresh_token nuevo que hay que guardar** (doc oficial,
  `medido` 2026-10-28): un secreto de sólo lectura no puede rotar.

Archivos nuevos: `api/_tiktok.ts` (puro), `api/_oauthState.ts` (puro, `state` firmado),
`api/_socialTokens.ts` (almacén), `api/_tiktokApi.ts` (red TikTok), `api/tiktok-oauth.ts` (endpoint
OAuth), `api/_linkedin.ts` (puro + posteo bloqueado), `api/linkedin-oauth.ts` (endpoint OAuth),
`tests/tiktok_test.mjs`.

---

## ● PARA SAM — acciones manuales (sin esto el carril no envía)

**El color de esta línea es especificación: `#00FFD1` donde la superficie lo renderice.**

1. **Registra la REDIRECT URI de TikTok** en el portal de developers (app `UNRLVL Publisher`,
   App ID `7633589773165135879`) → Login Kit → Redirect URI:

   ```
   https://<dominio-de-produccion-de-SocialLab>/api/tiktok-oauth
   ```

   Debe coincidir **exactamente** con la env var `TIKTOK_REDIRECT_URI`. SocialLab aún no tiene
   dominio de producción declarado (`README.md`: «deploy pendiente`), por eso la URI se deja como
   env var en vez de cablearla: **decisión tuya** cuál es el dominio final (p. ej.
   `https://unrlvl-sociallab.vercel.app/api/tiktok-oauth`). TikTok exige que la redirect URI esté
   registrada; el host no tiene que ser el dominio verificado.

2. **Carga el secreto de app de TikTok** en las env vars del proyecto de Vercel (SocialLab):
   - `TIKTOK_CLIENT_KEY` — el Client Key de la app.
   - `TIKTOK_CLIENT_SECRET` — el Client Secret de la app (está en Credentials de la app).
   - `TIKTOK_REDIRECT_URI` — la URI del punto 1.
   - `TIKTOK_MEDIA_VERIFIED_HOSTS` *(opcional)* — hosts verificados para `video_url`, separados por
     coma, p. ej. `unrealvillestudio.com`. Si está vacío, el carril no lo comprueba localmente
     (TikTok lo exige igual con `url_ownership_unverified`).

3. **Crea la tabla `social_oauth_tokens`** en Supabase (el worker la lee con el service role). DDL:

   ```sql
   create table if not exists public.social_oauth_tokens (
     provider                  text        not null,
     brand_id                  text        not null,
     open_id                   text,
     access_token              text        not null,
     refresh_token             text        not null,
     scope                     text,
     access_token_expires_at   timestamptz,
     refresh_token_expires_at  timestamptz,
     updated_at                timestamptz not null default now(),
     primary key (provider, brand_id)
   );
   -- RLS: sin políticas para anon/authenticated. Sólo el service role (que las omite) la toca.
   alter table public.social_oauth_tokens enable row level security;
   ```

   Es una tabla nueva: la DDL va **antes** que el código que la lea (una tabla nueva no reinterpreta
   dato viejo, `MULTIBRAND_RULE` §5). Se ensaya antes de aplicar a producción (`CC_PROTOCOL` §20).

4. **Conecta la cuenta de TikTok de cada marca** (3-legged OAuth), una vez por marca, abriendo:

   ```
   https://<dominio>/api/tiktok-oauth?brand_id=<brand_id>
   ```

   Inicia sesión con la cuenta de TikTok de la marca y autoriza. El callback guarda el token en
   `social_oauth_tokens`. A partir de ahí el carril refresca solo el access token cuando caduca.

5. **LinkedIn (opcional, sólo identidad):** si quieres dejar el OAuth probado, carga
   `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI`
   (`https://<dominio>/api/linkedin-oauth`) y conecta con
   `.../api/linkedin-oauth?brand_id=<brand_id>`. **Esto NO habilita publicar** (ver abajo).

---

## LinkedIn — qué está BLOQUEADO y por qué

- **El posteo a la Página de empresa está bloqueado** y **no se simula**: `publishLinkedInBlocked`
  falla diciendo el motivo. Requiere la **Community Management API**, que exige **entidad legal
  registrada** + aprobación de LinkedIn. LinkedIn **no es flexible** con el requisito.
- Estado `reportado` 2026-10-28: la app `266664900` existe y está **verificada con la Página**; el
  formulario de la CMA quedó **desbloqueado pero NO enviado**.
- **Qué sí quedó listo** (no depende de la entidad legal): el esqueleto del OAuth
  (`api/linkedin-oauth.ts`) con scopes de identidad básica (`openid profile`, **no** los de posteo) y
  el almacenamiento del token en `social_oauth_tokens`. El día que se levante el bloqueo, el posteo
  se implementa en un solo sitio (`api/_linkedin.ts`), sobre un token ya guardado.

---

## TikTok — posteo público, pendiente de auditoría

La vía implementada (`video.upload`, borrador al inbox) es **exenta de auditoría** y usable hoy. El
posteo público directo (`video.publish`) **exige una auditoría con video demo** y queda fuera a
propósito: no se pide ese scope ni se cablea ese endpoint hasta que la auditoría pase.
