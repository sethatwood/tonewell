// Learn: a reading window. Contents on the left, one card at a time on the
// right, sources with links you can check. The reading size follows ⌘+, ⌘−
// and ⌘0 (or A− and A+ at the top right) and is remembered.

import '../styles/pages.css';
import { CARDS, GROUPS, type Block, type Card } from './content';
import { h } from '../ui/controls';
import { uiIcon } from '../ui/icons';
import { isTauri, listen, openExternal } from '../platform/bridge';
import { loadSettings, patchSettings } from '../settings/model';
import { keys } from '../platform/os';

document.title = 'Learn';
document.documentElement.dataset.mode = 'meditate';

const SCALES = [0.85, 1, 1.15, 1.3, 1.5, 1.75];

const nav = h('nav', { class: 'learn-nav', 'aria-label': 'Topics' });
const article = h('article', { class: 'learn-article', tabindex: '-1' });
nav.append(
  h(
    'p',
    { class: 'learn-intro' },
    'Short, plain-language notes on what Tonewell does and what the research says. Every card lists its sources; where the evidence is thin, it says so.',
  ),
);
const links = new Map<string, HTMLAnchorElement>();
const order: string[] = [];
const groupOf = new Map<string, string>();
for (const g of GROUPS) {
  nav.append(h('h2', { class: 'learn-group' }, g.label));
  const ul = h('ul', {});
  for (const id of g.ids) {
    const card = CARDS.find((c) => c.id === id);
    if (!card) continue;
    order.push(id);
    groupOf.set(id, g.label);
    const a = h('a', { href: `#${id}` }, card.title);
    links.set(id, a);
    ul.append(h('li', {}, a));
  }
  nav.append(ul);
}

// The drag strip, with the window's name and the reading size.
const smaller = h('button', { class: 'size-btn', type: 'button', 'aria-label': 'Smaller text', title: `Smaller text (${keys('⌘−')})` }, 'A', uiIcon('minus'));
const larger = h('button', { class: 'size-btn size-btn--large', type: 'button', 'aria-label': 'Larger text', title: `Larger text (${keys('⌘+')})` }, 'A', uiIcon('plus'));
const strip = h(
  'header',
  { class: 'win-strip', 'data-tauri-drag-region': '' },
  h('span', { class: 'win-strip__title', 'data-tauri-drag-region': '' }, 'Learn'),
  h('span', { class: 'win-strip__tools', role: 'group', 'aria-label': 'Text size' }, smaller, larger),
);
const main = h('main', { class: 'learn-main' }, article);
document.body.append(strip, h('div', { class: 'learn' }, nav, main));

let scale = 1;
function setScale(next: number, save = true): void {
  const i = SCALES.reduce((best, v, k) => (Math.abs(v - next) < Math.abs(SCALES[best] - next) ? k : best), 0);
  scale = SCALES[i];
  document.documentElement.style.setProperty('--read-scale', String(scale));
  smaller.disabled = i === 0;
  larger.disabled = i === SCALES.length - 1;
  if (save) void patchSettings({ learnScale: scale });
}
const step = (dir: 1 | -1) => setScale(SCALES[Math.min(SCALES.length - 1, Math.max(0, SCALES.indexOf(scale) + dir))]);
smaller.addEventListener('click', () => step(-1));
larger.addEventListener('click', () => step(1));
addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key === '=' || e.key === '+') step(1);
  else if (e.key === '-' || e.key === '_') step(-1);
  else if (e.key === '0') setScale(1);
  else return;
  e.preventDefault();
});

/** Render text with [n] citation markers turned into small numerals that jump to the source. */
function withCitations(text: string, card: Card): Node[] {
  const out: Node[] = [];
  const re = /\[(\d+)\]/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let sup: HTMLElement | null = null;
  while ((m = re.exec(text))) {
    if (m.index > lastIndex) {
      // A space before a citation would leave it hanging: keep it with the word.
      out.push(document.createTextNode(text.slice(lastIndex, m.index).replace(/\s+$/, '')));
      sup = null;
    }
    const n = Number(m[1]);
    const a = h('a', { class: 'cite', href: `#${card.id}-source-${n}`, 'aria-label': `Source ${n}` }, String(n));
    a.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById(`${card.id}-source-${n}`)?.focus();
    });
    // Neighbouring citations share one superscript, with commas, so 1 and 4 never read as 14.
    if (!sup) {
      sup = h('sup', { class: 'cites' });
      out.push(sup);
    } else sup.append(',');
    sup.append(a);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) out.push(document.createTextNode(text.slice(lastIndex)));
  return out;
}

function block(b: Block, card: Card): HTMLElement {
  if (typeof b === 'string') return h('p', {}, ...withCitations(b, card));
  if ('head' in b) return h('p', {}, h('strong', {}, `${b.head}.`), ' ', ...withCitations(b.text, card));
  if ('list' in b) return h('ul', { class: 'learn-list' }, ...b.list.map((li) => h('li', {}, ...withCitations(li, card))));
  return h('p', { class: 'learn-note' }, b.note);
}

function show(id: string, focus = false): void {
  const card = CARDS.find((c) => c.id === id) ?? CARDS[0];
  for (const [cid, a] of links) {
    if (cid === card.id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const sources = h('ol', { class: 'learn-sources' });
  card.sources.forEach((s, i) => {
    const link = h('a', { href: s.url, class: 'source-link' }, s.url.replace(/^https:\/\/(doi\.org\/)?/, ''));
    link.addEventListener('click', (e) => {
      e.preventDefault();
      void openExternal(s.url);
    });
    sources.append(h('li', { id: `${card.id}-source-${i + 1}`, tabindex: '-1' }, `${s.text} `, link));
  });
  const at = order.indexOf(card.id);
  const nextId = order[(at + 1) % order.length];
  const nextCard = CARDS.find((c) => c.id === nextId);
  const next = nextCard ? h('a', { class: 'learn-next', href: `#${nextCard.id}` }, `Next: ${nextCard.title} →`) : null;
  article.replaceChildren(
    h('p', { class: 'learn-eyebrow' }, `${groupOf.get(card.id) ?? 'Learn'} · ${at + 1} of ${order.length}`),
    h('h1', { class: 'learn-card-title' }, card.title),
    h('p', { class: 'learn-lead' }, card.short),
    ...card.body.map((b) => block(b, card)),
    h('section', { class: 'learn-sources-box' }, h('h2', { class: 'learn-sources-title' }, 'Sources'), h('p', { class: 'learn-sources-note' }, 'Links open in your browser.'), sources),
    ...(next ? [next] : []),
  );
  main.scrollTo({ top: 0 });
  if (focus) article.focus({ preventScroll: true });
}

addEventListener('hashchange', () => show(location.hash.slice(1), true));
show(location.hash.slice(1) || CARDS[0].id);
void loadSettings().then((s) => setScale(s.learnScale ?? 1, false));
void listen<string>('learn-open', (id) => {
  location.hash = id;
});
// The size changed in another Learn window, or was reset: follow it.
if (isTauri) {
  void listen('settings-changed', async () => {
    const { reloadDoc } = await import('../platform/store');
    await reloadDoc();
    const s = await loadSettings();
    if (s.learnScale !== scale) setScale(s.learnScale, false);
  });
}
