// Renders the website's link preview (site/og.png, 1200 × 630): the lockup
// inside soft rings on night water, in the site's own tokens and font.
// Usage: node scripts/site-og.mjs

import { webkit } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const site = resolve(import.meta.dirname, '../site');
const origin = 'http://og.local';
const types = { '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const rings = [0, 70, 140, 210, 280]
  .map((inset, i) => `<span style="inset:${inset}px;border-color:rgba(var(--accent-rgb),${(0.05 + i * 0.045).toFixed(3)})"></span>`)
  .join('');

const card = `<!doctype html>
<html lang="en" data-mode="meditate">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/assets/tokens.css">
<link rel="stylesheet" href="/assets/components.css">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body {
    background:
      radial-gradient(ellipse 60% 70% at 50% 46%, rgba(var(--accent-rgb), 0.10), transparent 70%),
      var(--ground);
    display: grid; place-items: center;
  }
  .rings { position: absolute; width: 860px; height: 860px; left: 50%; top: 46%; transform: translate(-50%, -50%); }
  .rings span { position: absolute; border-radius: 50%; border: 1px solid; }
  .center { position: relative; text-align: center; transform: translateY(-14px); }
  .center img { height: 92px; display: block; margin: 0 auto; }
  .center p { margin: 30px 0 0; font-size: 30px; letter-spacing: 0.005em; color: var(--ink-2); }
</style>
</head>
<body class="tw">
<div class="rings" aria-hidden="true">${rings}</div>
<div class="center"><img src="/assets/tonewell-lockup.svg" alt=""><p>Endless, generated sound for meditation and deep focus.</p></div>
</body>
</html>`;

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.route(`${origin}/**`, async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/') return route.fulfill({ contentType: 'text/html', body: card });
  try {
    const body = await readFile(resolve(site, `.${path}`));
    return route.fulfill({ contentType: types[extname(path)] ?? 'application/octet-stream', body });
  } catch {
    return route.fulfill({ status: 404 });
  }
});
await page.goto(`${origin}/`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(200);
await page.screenshot({ path: resolve(site, 'og.png') });
await browser.close();
console.log(`Wrote ${resolve(site, 'og.png')}`);
