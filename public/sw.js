/*
 * SocialLab — service worker de la app instalable (Sam, 2026-11-17).
 *
 * Sólo guarda la ESTRUCTURA de la app, nunca los datos:
 *   · `/assets/*` (los archivos de Vite llevan el hash en el nombre: una versión nueva tiene otro nombre) → primero la copia.
 *   · La página (`navigate`) → primero la red; la copia sólo si no hay conexión, para que la app abra en vez de dar error.
 *   · Todo lo demás —`/api/*`, Supabase, otras webs— no se toca: va siempre a la red. Un dato viejo mostrado como actual
 *     sería peor que un error.
 * Push (avisos) queda para la fase 2.
 */
const CACHE = 'sociallab-estructura-v1';

// La página se guarda ya al instalar, para que la app abra sin conexión desde la primera vez.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try { const c = await caches.open(CACHE); await c.add('/'); } catch { /* se guardará en la próxima apertura */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const nombre of await caches.keys()) if (nombre !== CACHE) await caches.delete(nombre);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const c = await caches.open(CACHE); await c.put('/', res.clone()); }
        return res;
      } catch {
        const copia = await caches.match('/');
        return copia ?? Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith((async () => {
      const copia = await caches.match(req);
      if (copia) return copia;
      const res = await fetch(req);
      if (res.ok) { const c = await caches.open(CACHE); await c.put(req, res.clone()); }
      return res;
    })());
  }
});
