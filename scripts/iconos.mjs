// Genera los íconos de la app instalable de SocialLab (2026-11-17) en `public/icons/`.
//
// Por qué un script y no PNG sueltos: el ícono se vuelve a sacar igual cuando cambie el logotipo, sin depender de que
// alguien recuerde cómo se hizo. Usa Playwright y Chromium del entorno de CC (no es dependencia del repo):
//   node scripts/iconos.mjs
//
// Diseño: logotipo de los labs (`unrlvl-context` → `ecosystem.json` → `labs._logotipo`): chevron «>» cian #00FFD1 sobre
// void #080808 y el nombre en chalk #F2F0EC, Bebas Neue. El Orchestrator usa el chevron solo; SocialLab lleva además
// «SL» para que en la pantalla de inicio no se confundan los dos íconos.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

/** `escala`: fracción del lado que ocupa el dibujo. Maskable: el sistema recorta hasta un círculo del 80 %. */
const pagina = (lado, escala) => `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=block" rel="stylesheet">
<style>html,body{margin:0;background:#080808}
.c{width:${lado}px;height:${lado}px;display:flex;align-items:center;justify-content:center}
.l{font-family:'Bebas Neue';line-height:1;font-size:${Math.round(lado * escala * 0.62)}px;letter-spacing:0.02em;white-space:nowrap}
.ch{color:#00FFD1;display:inline-block;transform:scaleY(1.45) scaleX(0.72);margin-right:0.02em}
.un{color:#F2F0EC}</style></head>
<body><div class="c"><span class="l"><span class="ch">&gt;</span><span class="un">SL</span></span></div></body></html>`;

const salidas = [
  ['icon-192.png', 192, 0.86],
  ['icon-512.png', 512, 0.86],
  ['icon-maskable-512.png', 512, 0.62],
  ['apple-touch-icon.png', 180, 0.8],
  ['favicon-32.png', 32, 0.95],
];

const browser = await chromium.launch();
for (const [nombre, lado, escala] of salidas) {
  const page = await browser.newPage({ viewport: { width: lado, height: lado }, deviceScaleFactor: 1 });
  await page.setContent(pagina(lado, escala), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.evaluate(() => document.fonts.check("40px 'Bebas Neue'"));
  if (!ok) throw new Error('Bebas Neue no cargó: el ícono saldría con otra fuente');
  await page.screenshot({ path: join(OUT, nombre), clip: { x: 0, y: 0, width: lado, height: lado } });
  await page.close();
  console.log('ok', nombre);
}
await browser.close();
