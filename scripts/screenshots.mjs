// Captures the interface in WebKit at its real window sizes, for review and
// for the README. Usage: node scripts/screenshots.mjs [outDir]

import { createServer } from 'vite';
import { webkit } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'docs/screenshots');
mkdirSync(out, { recursive: true });

const server = await createServer({ server: { port: 1432, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await webkit.launch();

async function page(width, height, path, colorScheme = 'dark') {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error') console.log(`[console] ${m.text()}`);
  });
  await p.goto(base + path);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);
  return p;
}

const shot = (p, name) => p.screenshot({ path: `${out}/${name}.png` });

try {
  // The player: ready, playing (once the colours have settled), resting, Focus
  let p = await page(380, 156, 'index.html');
  await shot(p, 'mini-ready');
  await p.click('.ripple');
  await p.mouse.move(370, 150);
  await p.waitForTimeout(9000);
  await shot(p, 'mini-playing');
  await p.click('.chip--action');
  await p.mouse.move(370, 150);
  await p.waitForTimeout(15000);
  await shot(p, 'mini-resting');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(7000);
  await p.keyboard.press('Meta+2');
  await p.waitForTimeout(600);
  await shot(p, 'mini-focus');
  await p.close();

  // The full controls under the player
  p = await page(380, 744, 'index.html');
  await p.click('[aria-label="Shape the sound"]');
  await p.mouse.move(370, 700);
  await p.waitForTimeout(400);
  await shot(p, 'panel-sound');
  await p.click('.layer .disclosure');
  await p.waitForTimeout(200);
  await shot(p, 'panel-sound-drone');
  await p.click('#tab-beat');
  await p.waitForTimeout(200);
  await shot(p, 'panel-beat');
  await p.click('#tab-session');
  await p.waitForTimeout(200);
  await shot(p, 'panel-session');
  await p.close();

  for (const [name, path, w, hgt] of [
    ['learn', 'learn.html', 760, 780],
    ['learn-safety', 'learn.html#safety', 760, 780],
    ['settings', 'settings.html', 560, 640],
    ['visuals-note', 'visuals.html', 1100, 700],
  ]) {
    const q = await page(w, hgt, path);
    await q.waitForTimeout(1500);
    await shot(q, name);
    if (name === 'visuals-note') {
      await q.click('text=Show visuals');
      for (const [i, key] of [[0, null], [1, 'ArrowRight'], [2, 'ArrowRight'], [3, 'ArrowRight'], [4, 'ArrowRight'], [5, 'ArrowRight'], [6, 'ArrowRight'], [7, 'ArrowRight'], [8, 'ArrowRight'], [9, 'ArrowRight'], [10, 'ArrowRight'], [11, 'ArrowRight'], [12, 'ArrowRight'], [13, 'ArrowRight'], [14, 'e']]) {
        if (key) await q.keyboard.press(key);
        await q.waitForTimeout(key ? 10500 : 4000);
        await q.mouse.move(5 + i, 5);
        await shot(q, `visuals-scene-${i}`);
      }
    }
    await q.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`screenshots in ${out}`);
