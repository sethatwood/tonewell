// Draws Tonewell's icons from their sources:
//   - the menu-bar icons: template PNGs at 18 and 36 px for macOS (the
//     system tints them), and colour ones at 32 px on a disc for Windows and
//     Linux, where nothing does;
//   - the app icon, src-tauri/icons/app-icon.png, from app-icon.svg.
//
// Usage: node scripts/make-icons.mjs
// Then:  npx tauri icon src-tauri/icons/app-icon.png

import { webkit } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const icons = fileURLToPath(new URL('../src-tauri/icons/', import.meta.url));

// 18 pt grid. Ready: a point in one ring. Playing: a second ring.
// Resting: only the lower half of the ring, like the light settling.
const TRAY = {
  ready: '<circle cx="9" cy="9" r="2" fill="currentColor" stroke="none"/><circle cx="9" cy="9" r="6" stroke-width="1.4"/>',
  playing: '<circle cx="9" cy="9" r="2.6" fill="currentColor" stroke="none"/><circle cx="9" cy="9" r="5.3" stroke-width="1.3"/><circle cx="9" cy="9" r="8" stroke-width="1.1"/>',
  resting: '<circle cx="9" cy="9" r="2" fill="currentColor" stroke="none"/><path d="M3 9a6 6 0 0 0 12 0" stroke-width="1.4" stroke-linecap="round"/>',
};

const browser = await webkit.launch();
async function render(svg, size, scale, path) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: scale });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path, omitBackground: true });
  await page.close();
}

try {
  for (const [state, body] of Object.entries(TRAY)) {
    const template = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#000" style="color:#000">${body}</svg>`;
    await render(template, 18, 1, `${icons}tray/${state}-1x.png`);
    await render(template, 18, 2, `${icons}tray/${state}.png`);
    const colour = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" style="color:#C3D0FF"><circle cx="16" cy="16" r="16" fill="#1C2246"/><g transform="translate(3.4 3.4) scale(1.4)" fill="none" stroke="#C3D0FF">${body}</g></svg>`;
    await render(colour, 32, 1, `${icons}tray/${state}-color.png`);
  }
  const app = readFileSync(`${icons}app-icon.svg`, 'utf8');
  await render(app, 1024, 1, `${icons}app-icon.png`);
} finally {
  await browser.close();
}
console.log('icons drawn; now: npx tauri icon src-tauri/icons/app-icon.png');
