// Learn: a reading window. Contents on the left, one card at a time on the
// right, sources with links you can check.

import '../styles/pages.css';
import { CARDS, GROUPS, type Block, type Card } from './content';
import { h } from '../ui/controls';
import { listen, openExternal } from '../platform/bridge';

document.title = 'Learn';
document.documentElement.dataset.mode = 'meditate';

const nav = h('nav', { class: 'learn-nav', 'aria-label': 'Topics' });
const article = h('article', { class: 'learn-article', tabindex: '-1' });
const intro = h(
  'p',
  { class: 'learn-intro' },
  'Short, plain-language notes on what Tonewell does and what the research says. Every card lists its sources; where the evidence is thin, it says so.',
);
nav.append(h('h1', { class: 'learn-title voice' }, 'Learn'), intro);
const links = new Map<string, HTMLAnchorElement>();
for (const g of GROUPS) {
  nav.append(h('h2', { class: 'learn-group' }, g.label));
  const ul = h('ul', {});
  for (const id of g.ids) {
    const card = CARDS.find((c) => c.id === id);
    if (!card) continue;
    const a = h('a', { href: `#${id}` }, card.title);
    links.set(id, a);
    ul.append(h('li', {}, a));
  }
  nav.append(ul);
}
document.body.append(h('div', { class: 'learn' }, nav, h('main', { class: 'learn-main' }, article)));

/** Render text with [n] citation markers turned into links to the source list. */
function withCitations(text: string, card: Card): Node[] {
  const out: Node[] = [];
  const re = /\[(\d+)\]/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > lastIndex) out.push(document.createTextNode(text.slice(lastIndex, m.index)));
    const n = Number(m[1]);
    const a = h('a', { class: 'cite', href: `#${card.id}-source-${n}`, 'aria-label': `Source ${n}` }, `[${n}]`);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById(`${card.id}-source-${n}`)?.focus();
    });
    out.push(a);
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
  article.replaceChildren(
    h('h2', { class: 'learn-card-title voice' }, card.title),
    h('p', { class: 'learn-lead' }, card.short),
    ...card.body.map((b) => block(b, card)),
    h('h3', { class: 'learn-sources-title' }, 'Sources'),
    sources,
  );
  article.scrollTop = 0;
  document.querySelector('.learn-main')?.scrollTo({ top: 0 });
  if (focus) article.focus();
}

addEventListener('hashchange', () => show(location.hash.slice(1), true));
show(location.hash.slice(1) || CARDS[0].id);
void listen<string>('learn-open', (id) => {
  location.hash = id;
});
