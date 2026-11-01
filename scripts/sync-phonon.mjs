// SPDX-License-Identifier: AGPL-3.0-or-later
// Copies the plain-ESM phonon-tts browser runtime into public/phonon so it can be
// loaded verbatim (including its worker and both wasm builds) by Electron and Vite.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'node_modules', 'phonon-tts');
const target = join(root, 'public', 'phonon');

if (!existsSync(source)) {
  console.warn('[sync-phonon] node_modules/phonon-tts not found yet; skipping.');
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

const entries = [
  'index.js',
  'worker.js',
  'fetch.js',
  'hub.js',
  'wav.js',
  'threads.js',
  'device.js',
  'simd.js',
  'wasm',
  'wasm-threads',
  'LICENSE-MIT',
  'LICENSE-APACHE',
  'THIRD_PARTY_LICENSES.md',
];

for (const entry of entries) {
  const from = join(source, entry);
  if (!existsSync(from)) {
    console.warn(`[sync-phonon] missing ${entry}, skipped`);
    continue;
  }
  cpSync(from, join(target, entry), { recursive: true });
}

// App-owned shim, not part of the phonon-tts package: lets the engine pass the GPU
// adapter preference from Settings into `requestAdapter`.
cpSync(join(root, 'scripts', 'phonon-worker-gpu.js'), join(target, 'worker-gpu.js'));

console.log(`[sync-phonon] phonon-tts ${pkg.version} copied to public/phonon`);
