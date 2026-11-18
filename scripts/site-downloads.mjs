// Points tonewell.space's download links at a release: every element with a
// data-dl attribute gets that file's URL, and data-dl-version shows the
// version. Run by scripts/release.sh.
//
//   node scripts/site-downloads.mjs <version> mac=<url> windows=<url> appimage=<url> deb=<url>

import { readFileSync, writeFileSync } from 'node:fs';

const [version, ...pairs] = process.argv.slice(2);
const page = new URL('../site/index.html', import.meta.url);
let html = readFileSync(page, 'utf8');

for (const pair of pairs) {
  const [name, url] = pair.split(/=(.*)/s);
  const link = new RegExp(`(<a\\b[^>]*\\bdata-dl="${name}"[^>]*\\bhref=")[^"]*(")`, 'g');
  const found = html.match(link)?.length ?? 0;
  if (found === 0) throw new Error(`site/index.html has no data-dl="${name}" link`);
  html = html.replace(link, `$1${url}$2`);
}
const versions = /(<span data-dl-version>)[^<]*(<\/span>)/g;
if (!versions.test(html)) throw new Error('site/index.html has no data-dl-version');
html = html.replace(versions, `$1${version}$2`);
writeFileSync(page, html);
console.log(`site/index.html now offers ${version}`);
