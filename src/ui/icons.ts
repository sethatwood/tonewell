// Interface icons on a 24 px grid, drawn in currentColor. Stroked unless
// listed in FILLED. Each value is the inside of an <svg viewBox="0 0 24 24">.

export const UI_ICONS = {
  play: '<path d="M8.5 5.5v13l10-6.5z"/>',
  hum: '<path d="M4 12c2.7-1.8 5.3-1.8 8 0s5.3 1.8 8 0"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  'open-ended': '<path d="M12 12c-2-3-3.5-4.5-5.5-4.5a4.5 4.5 0 0 0 0 9C8.5 16.5 10 15 12 12s3.5-4.5 5.5-4.5a4.5 4.5 0 0 1 0 9c-2 0-3.5-1.5-5.5-4.5z"/>',
  beat: '<path d="M3 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0"/>',
  'beat-off': '<path d="M3 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0"/><path d="M4 20 20 4"/>',
  shape: '<circle cx="12" cy="12" r="8.5" stroke-opacity=".45"/><circle cx="12" cy="12" r="4.5"/><circle cx="14.5" cy="9.5" r="1.6" fill="currentColor"/>',
  visuals: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.6a2.4 2.4 0 1 1 3.3 2.2c-.6.3-1 .8-1 1.5v.3"/><circle cx="12" cy="16.6" r=".5" fill="currentColor"/>',
  headphones: '<path d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.6"/><rect x="16.5" y="14" width="4" height="6" rx="1.6"/>',
  speaker: '<rect x="6" y="3.5" width="12" height="17" rx="2.5"/><circle cx="12" cy="14" r="3"/><circle cx="12" cy="7.5" r=".6" fill="currentColor"/>',
  volume: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  'volume-low': '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/>',
  'chevron-down': '<path d="M7 10l5 5 5-5"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  end: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  'wind-down': '<path d="M4 8c3 0 4.5 4 8 4s5 4 8 4"/>',
  close: '<path d="M7 7l10 10M17 7 7 17"/>',
  learn: '<path d="M12 6.5C10 5 7.5 4.5 4 4.8v13c3.5-.3 6 .2 8 1.7 2-1.5 4.5-2 8-1.7v-13c-3.5-.3-6 .2-8 1.7z"/><path d="M12 6.5v13"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>',
  // Shrink to the light alone: corners drawn inward around a point.
  mini: '<path d="M9 4.5V9H4.5M15 4.5V9h4.5M19.5 15H15v4.5M9 19.5V15H4.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
} as const;

export type UiIcon = keyof typeof UI_ICONS;

const FILLED = new Set<UiIcon>(['play']);
const NS = 'http://www.w3.org/2000/svg';

/** An inline icon, decorative (aria-hidden): the control carries the words. */
export function uiIcon(name: UiIcon): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', FILLED.has(name) ? 'icon icon--fill' : 'icon');
  svg.innerHTML = UI_ICONS[name];
  return svg;
}
