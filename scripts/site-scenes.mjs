// Renders the website's scene stills (site/assets/scenes) with the app's own
// renderer, at the app's default brightness with Calm visuals off: a small
// image of every scene for the picker, and a large one for the panel.
// Usage: node scripts/site-scenes.mjs [outDir] [times...]

import { createServer } from 'vite';
import { webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(process.argv[2] ?? resolve(root, 'site/assets/scenes'));
/** The moment shown for each scene, in scene time; chosen by eye. */
const TIMES = [101, 66, 101, 101, 12, 66, 101, 66, 101, 66, 101, 66, 66, 66, 37];
const LARGE = 'liquid-jewel';
const override = process.argv.slice(3).map(Number).filter(Number.isFinite);

const slug = (name) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const harness = `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" style="display:block;width:8px;height:5px"></canvas>
<script type="module">
import { Visuals } from '/src/visuals/renderer.ts';
import { SCENES } from '/src/visuals/shader.ts';
const c = document.getElementById('c');
const v = Visuals.create(c);
const look = { fade: 1, dark: false, bright: 0.85 * 0.8, sat: 1.6, flow: 0, bass: 0, hi: 0, pacer: false };
window.SCENES = [...SCENES];
window.still = (scene, T, w, h) => {
  v.drift = false;
  v.scene = v.next = scene;
  v.mixing = false;
  c.style.width = '8px';
  c.style.height = '5px';
  v.resize();
  // Let the renderer's slow fades settle, on a tiny canvas so it's quick.
  for (let i = 0; i < 1500; i++) v.step(0.01, look);
  c.style.width = w + 'px';
  c.style.height = h + 'px';
  v.resize();
  v.T = T;
  v.step(0.0001, look);
  // Read back in the same task as the draw, before the browser clears the buffer.
  return c.toDataURL('image/jpeg', 0.84);
};
</script></body></html>`;

mkdirSync(out, { recursive: true });
const server = await createServer({ root, server: { port: 1434, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await webkit.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  await page.route(`${base}__stills.html`, (route) => route.fulfill({ contentType: 'text/html', body: harness }));
  await page.goto(`${base}__stills.html`);
  await page.waitForFunction(() => typeof window.still === 'function');
  const scenes = await page.evaluate(() => window.SCENES);
  const save = (file, dataUrl) => writeFileSync(resolve(out, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
  for (const [i, name] of scenes.entries()) {
    const T = override[i] ?? TIMES[i] ?? 40;
    save(`${slug(name)}.jpg`, await page.evaluate(([k, t]) => window.still(k, t, 480, 300), [i, T]));
    if (slug(name) === LARGE) save(`${slug(name)}-large.jpg`, await page.evaluate(([k, t]) => window.still(k, t, 1600, 1000), [i, T]));
  }
  console.log(`${scenes.length} scenes in ${out}`);
} finally {
  await browser.close();
  await server.close();
}
