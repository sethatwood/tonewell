// Checks updater signatures the way an installed copy will: each file's .sig
// must verify against the public key in src-tauri/tauri.conf.json, and its
// signed comment must name the version being released. A release signed
// with the wrong key would otherwise publish fine and then be refused by
// every installed copy, silently.
//
//   node scripts/check-update-signatures.mjs <version> <file>...
//
// Signatures are minisign's format, base64-wrapped by Tauri.

import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [version, ...files] = process.argv.slice(2);
if (!version || files.length === 0) {
  console.error('usage: check-update-signatures.mjs <version> <file>...');
  process.exit(2);
}

const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const lines = (b64) => Buffer.from(b64, 'base64').toString('utf8').split('\n');

// Public key: "Ed", an 8-byte key id, then the 32-byte Ed25519 key.
const pub = Buffer.from(lines(conf.plugins.updater.pubkey)[1], 'base64');
const keyId = pub.subarray(2, 10);
const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub.subarray(10, 42)]), format: 'der', type: 'spki' });

let failed = false;
for (const file of files) {
  const fail = (why) => {
    console.error(`${file}: ${why}`);
    failed = true;
  };
  const [, sigLine, trustedLine, globalLine] = lines(readFileSync(`${file}.sig`, 'utf8').trim());
  // Signature: "ED" (hashed with BLAKE2b-512 first) or "Ed", the key id, then 64 bytes.
  const sig = Buffer.from(sigLine, 'base64');
  const alg = sig.subarray(0, 2).toString('latin1');
  const signature = sig.subarray(10, 74);
  const data = readFileSync(file);
  const message = alg === 'ED' ? createHash('blake2b512').update(data).digest() : data;
  const trusted = trustedLine.replace(/^trusted comment: /, '');
  if (!sig.subarray(2, 10).equals(keyId)) fail('signed with a different key than tauri.conf.json names');
  else if (!verify(null, message, key, signature)) fail('the signature does not match the file');
  else if (!verify(null, Buffer.concat([signature, Buffer.from(trusted, 'utf8')]), key, Buffer.from(globalLine, 'base64'))) fail('the signed comment was altered');
  else if (!trusted.split('\t').includes(`version:${version}`)) fail(`not signed for version ${version} (${trusted})`);
  else console.log(`ok  ${file}`);
}
process.exit(failed ? 1 : 0);
