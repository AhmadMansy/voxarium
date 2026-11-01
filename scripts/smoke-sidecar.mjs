// SPDX-License-Identifier: AGPL-3.0-or-later
// Headless end-to-end check of the install pipeline for one sidecar model, without
// Electron: toolchain (uv + Python) -> environment -> weights -> first start -> test
// synthesis. It uses the same managers as the app, so a pass on an operating system
// is real evidence for that system's support tier.
//
// Usage: node scripts/smoke-sidecar.mjs <modelId> [--keep] [--json]
//   e.g. node scripts/smoke-sidecar.mjs supertonic-3
// Needs network access and several GB of disk. Models that need a Hugging Face token
// (gated) or a license acknowledgment cannot be smoke-tested here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelId = process.argv[2];
const keep = process.argv.includes('--keep');
const asJson = process.argv.includes('--json');
if (!modelId) {
  console.error('Usage: node scripts/smoke-sidecar.mjs <modelId> [--keep] [--json]');
  process.exit(2);
}

const { getModel } = require(path.join(root, 'electron/models/registry.cjs'));
const { createModelState } = require(path.join(root, 'electron/models/state.cjs'));
const { createModelManager } = require(path.join(root, 'electron/models/downloads.cjs'));
const { createRuntimeManager } = require(path.join(root, 'electron/models/runtimes.cjs'));
const { createSidecarSupervisor } = require(path.join(root, 'electron/models/sidecar.cjs'));
const { goldenSynthesis } = require(path.join(root, 'electron/models/verify.cjs'));
const { platformKey } = require(path.join(root, 'electron/models/platform.cjs'));

const model = getModel(modelId);
if (model.id !== modelId) {
  console.error(`Unknown model: ${modelId}`);
  process.exit(2);
}
if (model.runtime !== 'sidecar') {
  console.error(`${modelId} runs in the app, not in a sidecar.`);
  process.exit(2);
}
if (model.gated) {
  console.error(`${modelId} is gated on Hugging Face and needs a token, so it cannot be smoke-tested headlessly.`);
  process.exit(2);
}

const data = process.env.VOXARIUM_SMOKE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'voxarium-smoke-'));
const dirs = {
  data,
  models: path.join(data, 'models'),
  runtimes: path.join(data, 'runtimes'),
  voices: path.join(data, 'voices'),
  audio: path.join(data, 'audio'),
};
for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJsonAtomic = async (file, value) => {
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.promises.rename(tmp, file);
};

const started = Date.now();
const step = (message) => {
  if (!asJson) console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s] ${message}`);
};
let lastLine = '';
const broadcast = (event) => {
  const text = event.file || '';
  if (text && text !== lastLine && event.stage === 'installing') {
    lastLine = text;
    if (!asJson) console.log(`        ${String(text).slice(0, 110)}`);
  }
};

const state = createModelState({ dataDir: data, dirs, readJson, writeJsonAtomic });
const modelManager = createModelManager({ dirs, appVersion: 'smoke', state, broadcast, getToken: () => '', log: () => {} });
const runtimes = createRuntimeManager({ dirs, appVersion: 'smoke', readJson, writeJsonAtomic, broadcast, log: () => {} });
const sidecars = createSidecarSupervisor({ dirs, send: () => {}, runtimes, getSettings: () => ({ activeModelId: modelId }) });

const report = { model: modelId, platform: platformKey(), ok: false, stages: {} };
async function stage(name, fn) {
  const t0 = Date.now();
  step(`${name}…`);
  try {
    const value = await fn();
    report.stages[name] = { ok: true, seconds: Math.round((Date.now() - t0) / 1000) };
    return value;
  } catch (error) {
    report.stages[name] = { ok: false, seconds: Math.round((Date.now() - t0) / 1000), error: error instanceof Error ? error.message : String(error) };
    throw error;
  }
}

try {
  const packId = model.runtimePack.packId;
  const pack = runtimes.status(packId);
  report.tier = pack?.tier || null;
  if (!pack || !pack.available) throw new Error(pack?.reason || `No runtime pack for ${platformKey()}.`);
  step(`${model.name} on ${platformKey()} (tier ${pack.tier})`);

  await stage('toolchain and environment', async () => {
    const result = await runtimes.download(packId);
    if (result && result.ok === false) throw new Error(result.error || 'The runtime could not be installed.');
    if (!runtimes.status(packId).installed) throw new Error('The runtime pack is not installed after the build.');
  });

  await stage('model files', async () => {
    const quality = model.files.some((file) => file.quality === 'q8') ? 'q8' : undefined;
    const result = await modelManager.download(modelId, quality);
    if (!result.ok) throw new Error(result.error || 'The model files could not be downloaded.');
  });

  const check = await stage('first start and test synthesis', async () => {
    const result = await sidecars.start(modelId);
    if (!result.ok) throw new Error(result.error || 'The sidecar did not start.');
    const current = sidecars.status(modelId);
    const synthesis = await goldenSynthesis({ url: current.url, token: current.token });
    if (!synthesis.ok) throw new Error(synthesis.error || 'The test synthesis failed.');
    return synthesis;
  });
  report.synthesis = check;
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await sidecars.stopAll().catch(() => {});
  if (!keep && !process.env.VOXARIUM_SMOKE_DIR) fs.rmSync(data, { recursive: true, force: true });
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else if (report.ok) {
  console.log(`\nPASS ${modelId} on ${report.platform}: ${report.synthesis.durationSec} s of audio, peak ${report.synthesis.peak}, rms ${report.synthesis.rms}, ${(report.synthesis.elapsedMs / 1000).toFixed(1)} s to generate.`);
} else {
  console.error(`\nFAIL ${modelId} on ${report.platform}: ${report.error}`);
}
process.exit(report.ok ? 0 : 1);
