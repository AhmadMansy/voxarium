// SPDX-License-Identifier: AGPL-3.0-or-later
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copies only the ONNX Runtime Web assets the app actually serves. The renderer
 * loads the entry module from /ort and the runtime fetches the matching .wasm
 * file beside it, so both plain WASM and WebGPU/JSEP variants are needed.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const target = join(root, 'public', 'ort');

const files = [
  'ort.min.mjs',
  'ort.webgpu.min.mjs',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
];

await mkdir(target, { recursive: true });

let copied = 0;
for (const name of files) {
  const from = join(source, name);
  const to = join(target, name);
  try {
    const [a, b] = await Promise.all([stat(from), stat(to)]).catch(() => [null, null]);
    if (a && b && a.size === b.size && b.mtimeMs >= a.mtimeMs) continue;
    await copyFile(from, to);
    copied += 1;
  } catch (error) {
    console.error(`[voxarium] could not copy ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

console.log(copied ? `[voxarium] synced ${copied} ONNX Runtime asset(s) to public/ort` : '[voxarium] ONNX Runtime assets already in sync');
