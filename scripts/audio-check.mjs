// Renders the real audio engine offline inside WebKit (the engine macOS uses
// for Tonewell's windows) and checks levels, beats, ramps and fades.
// Usage: npm run test:audio

import { createServer } from 'vite';
import { webkit } from 'playwright';

const server = await createServer({ server: { port: 1430, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = `${server.resolvedUrls.local[0]}tests/audio/harness.html`;

const browser = await webkit.launch();
let failed = 0;
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => typeof window.tonewellChecks === 'function', null, { timeout: 30000 });
  const results = await page.evaluate(() => window.tonewellChecks(), null);
  for (const r of results) {
    if (!r.pass) failed++;
    const detail = Object.entries(r.detail).map(([k, v]) => `${k}=${v}`).join('  ');
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      ${detail}`);
  }
  console.log(`\n${results.length - failed}/${results.length} audio checks passed`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
