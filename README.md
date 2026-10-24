# SocialLab — Unreal>ille Studio

**Rol (decisión de Sam, 2026-10-24):** SocialLab **actúa**. Es la vía única de publicación al público y el **tablero de
operadores** de redes. Lee las métricas que escribe SignalLab; no las mide.

**Producción:** `unrlvl-social-lab.vercel.app` (proyecto de Vercel `prj_AyV22kS0NqRkqH5MeOlaLSWJwOGT`).

## Qué hay en este repo

| Pieza | Qué hace |
|---|---|
| `api/publish.ts` + `api/_igContainer.ts` | Publica en Instagram y Facebook por el MCP de Meta. La llama `content-scheduler` cada 15 min. **Vía única al público** |
| `api/execute.ts` | Crea filas en `scheduled_posts` desde un stage del Orchestrator (se revisa en la Fase 6) |
| `api/circle-kit.ts` | Documentos del Círculo (`circulo.<dominio de la marca>`) |
| `api/session.ts` | Entrada al tablero: reenvía la contraseña a `iid-inbound`, la misma puerta del Orchestrator |
| `api/ops.ts` | El tablero, sólo lectura: `catalogo`, `publicado`, `envivo`, `calendario`, `ahora` |
| `api/_opsCore.ts` / `api/_opsShared.ts` | Núcleo puro (sesión, alcance, ventanas, conteos, lectores por plataforma) y E/S |
| `src/` | La interfaz del tablero: Hoy, Publicado (grid cruzado con la lectura en vivo) y Calendario |

## Tablero de operadores (Fase 2)

- **Identidad:** el JWT HS256 que emite `iid-inbound` (`sub`, `role`, `brand_scope`). La API lo verifica con
  `OPERATOR_SESSION_JWT_SECRET`, que tiene el **mismo valor** que el secreto con el que firma `iid-inbound`.
- **Alcance:** `admin` ve todas las marcas. Un operador ve las marcas de sus filas en `intel.operator_review_scope`
  con la vista `social_ops` (o con `views` NULL), dentro de su `brand_scope`. Sin filas, 403. Dar o quitar una marca
  es un `UPDATE`, nunca un despliegue.
- **Datos:** todo se lee desde el servidor con `service_role`; el navegador no toca la base ni las plataformas.
  - Publicado: `public.scheduled_posts` (`status='published'`), últimos 7 días por defecto.
  - En vivo: el MCP de Meta (`ig_get_media`, `fb_get_posts`) para cada cuenta de `public.meta_accounts`; se cruza
    con el registro por `platform_post_id`. Lo que está en la plataforma y no en el registro se muestra aparte.
  - Calendario: `intel.brand_publish_slots` + `scheduled_posts`.
  - Métricas: `content.post_metric_snapshots` (SignalLab). Mientras no existan, «sin medir»: nunca un cero.
- **Multimarca:** ninguna marca en el código. `tests/sin_marcas_test.mjs` falla si vuelve a aparecer una.

## Variables de entorno

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `META_MCP_URL` (publicación y lectura en vivo),
`OPERATOR_SESSION_JWT_SECRET` (tablero), `ANTHROPIC_API_KEY` (`api/execute.ts`), `IID_CRON_SECRET` (`api/circle-kit.ts`).

## Desarrollo

```bash
npm install
npm test          # tests de api/ y barreras de idioma y multimarca
npm run build
```

## Changelog

| Fecha | Cambio |
|---|---|
| 2026-10-24 | Fase 2: tablero de operadores de sólo lectura; se retira la maqueta (marcas en el código, publicación simulada, generador de copy) |
| 2026-03-20 | README actualizado con arquitectura de ecosistema |
