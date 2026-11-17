// Usage: node scripts/audio-perf.mjs  — rough DSP cost per layer, rendered in WebKit.
import { createServer } from 'vite';
import { webkit } from 'playwright';
const server = await createServer({ server: { port: 1433, strictPort: false }, logLevel: 'error' });
await server.listen();
const browser = await webkit.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${server.resolvedUrls.local[0]}tests/audio/perf.html`);
  await page.waitForFunction(() => typeof window.tonewellPerf === 'function');
  const mode = process.argv[2] ?? '';
  const r = await page.evaluate((m) => (m === '--micro' ? window.tonewellMicro() : m === '--variants' ? window.tonewellVariants() : window.tonewellPerf()), mode);
  for (const [k, v] of Object.entries(r)) console.log(`${v.padStart(22)}  ${k}`);
} finally {
  await browser.close();
  await server.close();
}
