// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { extractArchive, safePath } = require('../electron/models/archive.cjs');
const runtimeCatalog = require('../electron/models/runtimes.json');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tarHeader(name, size, type = '0') {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'utf8');
  header.write('0000000\0', 108, 8, 'utf8');
  header.write('0000000\0', 116, 8, 'utf8');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
  header.write('00000000000\0', 136, 12, 'utf8');
  header.write('        ', 148, 8, 'utf8');
  header.write(type, 156, 1, 'utf8');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
  return header;
}

function buildTarGz(entries) {
  const chunks = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.data || '');
    chunks.push(tarHeader(entry.name, body.length, entry.type || '0'));
    chunks.push(body);
    chunks.push(Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}

/** Unit checks for the model layer. Vite's SSR loader is used so TypeScript,
 * extensionless imports and JSON manifests resolve exactly as they do in the app
 * without adding a second test runtime to the project.
 */
const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

try {
  const registry = await server.ssrLoadModule('/src/models/registry.ts');
  const fit = await server.ssrLoadModule('/src/models/fit.ts');
  const license = await server.ssrLoadModule('/src/models/license.ts');
  const compat = await server.ssrLoadModule('/src/models/compat.ts');
  const preferences = await server.ssrLoadModule('/src/models/preferences.ts');
  const catalog = await server.ssrLoadModule('/src/data/catalog.ts');
  const runtime = await server.ssrLoadModule('/src/models/runtime.ts');
const bridge = await server.ssrLoadModule('/src/lib/engineBridge.ts');
const expression = await server.ssrLoadModule('/src/models/expression.ts');

  const { MODELS, DEFAULT_MODEL_ID, getModel, qualitiesFor, defaultQualityFor } = registry;
  const { normalizePreferences, switchModelSettings, rememberPreferences } = preferences;
  const { assessFit } = fit;
  const { requiresLicenseAck, licenseAcknowledged, canInstallModel, licenseBadge, licenseSummary } = license;
  const { runtimeReadiness, visibleRuntimePacks } = runtime;
  const {
    modelHasArabic,
    arabicVarietiesFor,
    supportsLanguage,
    resolveLanguage,
    voiceCompatibleWithModel,
    voiceCompatibilityNote,
    voicesForModel,
    ARABIC_VARIETIES,
  } = compat;

  const hardware = (overrides = {}) => ({
    platform: 'win32',
    arch: 'x64',
    cpuModel: 'Test CPU',
    cpuCores: 12,
    totalRamGb: 32,
    freeRamGb: 20,
    freeDiskGb: 200,
    gpus: [{ vendor: 'Test', device: 'Test GPU', vramGb: 12, active: true }],
    gpuPreference: 'auto',
    webgpuLikely: true,
    ...overrides,
  });

  const makeSettings = (overrides = {}) => ({
    theme: 'dark',
    accent: 'amber',
    outputDir: '',
    autoSave: true,
    autoPlay: true,
    streaming: true,
    allowCloudCloning: false,
    gpuPreference: 'auto',
    defaultVoice: 'default',
    lastVoice: 'default',
    activeModelId: 'phonon-31m-en',
    modelSettings: {},
    arabicVariety: 'arb',
    quality: 'q8',
    device: 'auto',
    threads: 'auto',
    language: 'en',
    rewrites: 'default',
    conditions: { num_speakers: '1', duration_delta: 0 },
    filenameTemplate: '',
    temperature: 0.7,
    seed: '42',
    pronunciations: [],
    setupComplete: true,
    onboardingDismissed: true,
    ...overrides,
  });

  await test('manifest registry has the selected 15 models and a valid default', () => {
    assert.equal(MODELS.length, 15);
    assert.equal(new Set(MODELS.map((model) => model.id)).size, MODELS.length);
    assert.equal(getModel(DEFAULT_MODEL_ID).id, 'phonon-31m-en');
    assert.equal(getModel('does-not-exist').id, 'phonon-31m-en');
  });

  await test('every manifest file is pinned by size and a verifiable hash', () => {
    for (const model of MODELS) {
      assert.ok(model.files.length > 0, `${model.id} has no files`);
      assert.ok(model.filesVerified, `${model.id} files are not verified`);
      assert.match(model.revision || '', /^[a-f0-9]{40}$/, `${model.id} revision`);
      for (const file of model.files) {
        // LFS files carry SHA-256 (or, in gated repos, the git id of their pointer);
        // small git files carry their blob SHA-1.
        if (file.sha256) assert.match(file.sha256, /^[a-f0-9]{64}$/, `${model.id}/${file.name}`);
        else assert.match(file.gitSha1 || file.lfsPointerSha1 || '', /^[a-f0-9]{40}$/, `${model.id}/${file.name}`);
        assert.ok(Number.isInteger(file.size) && file.size >= 0, `${model.id}/${file.name} size`);
        assert.ok(!file.name.includes('..') && !file.name.startsWith('/'), `${model.id}/${file.name} path`);
      }
    }
  });

  await test('every model is installable: Phonon in-app, the rest through a buildable sidecar pack', () => {
    const inApp = MODELS.filter((model) => model.runtimePack.available).map((model) => model.id);
    assert.deepEqual(inApp.sort(), ['phonon-31m-en', 'phonon-40m-multilingual']);
    for (const model of MODELS.filter((item) => !item.runtimePack.available)) {
      assert.equal(model.runtime, 'sidecar', model.id);
      const pack = runtimeCatalog.packs.find((entry) => entry.id === model.runtimePack.packId);
      assert.ok(pack?.available && pack.build, `${model.id} has no buildable pack`);
      assert.ok(model.files.some((file) => file.quality), `${model.id} has no weight file`);
    }
  });

  await test('gated repositories are pinned and flagged for a token', () => {
    const gated = MODELS.filter((model) => model.gated).map((model) => model.id).sort();
    assert.deepEqual(gated, ['openaudio-s1-mini', 'phonon-40m-multilingual']);
    const phonon40 = getModel('phonon-40m-multilingual');
    assert.deepEqual(phonon40.files.map((file) => file.name), getModel('phonon-31m-en').files.map((file) => file.name));
    assert.equal(phonon40.license.restricted, true);
    assert.equal(phonon40.license.commercial, false);
  });

  await test('qualities come from manifest files', () => {
    const phonon = getModel('phonon-31m-en');
    assert.deepEqual(qualitiesFor(phonon).sort(), ['f32', 'q8']);
    assert.ok(['q8', 'f32'].includes(defaultQualityFor(phonon)));
    assert.deepEqual(qualitiesFor(getModel('kokoro-82m')), ['f32']);
    assert.equal(defaultQualityFor(getModel('kokoro-82m')), 'f32');
  });

  await test('fit scoring meets or misses RAM and disk requirements', () => {
    const phonon = getModel('phonon-31m-en');
    assert.equal(assessFit(phonon, hardware()).level, 'great');
    const lowRam = assessFit(phonon, hardware({ totalRamGb: 1 }));
    assert.equal(lowRam.level, 'too-heavy');
    assert.ok(lowRam.reasons.some((reason) => reason.kind === 'block' && /RAM/i.test(reason.text)));
    const lowDisk = assessFit(phonon, hardware({ freeDiskGb: 0.01 }));
    assert.equal(lowDisk.level, 'too-heavy');
    assert.ok(lowDisk.reasons.some((reason) => reason.kind === 'block' && /disk/i.test(reason.text)));
  });

  await test('sidecar fit flags missing VRAM as CPU-only', () => {
    const chatterbox = getModel('chatterbox');
    const noGpu = hardware({ gpus: [], webgpuLikely: false });
    const assessment = assessFit(chatterbox, noGpu);
    assert.ok(['cpu', 'runs'].includes(assessment.level));
    assert.ok(assessment.reasons.some((reason) => /VRAM|CPU/i.test(reason.text)));
  });

  await test('restricted licenses require a fresh, matching acknowledgment', () => {
    const model = getModel('phonon-40m-multilingual');
    assert.equal(requiresLicenseAck(model), true);
    assert.equal(licenseAcknowledged(model, {}), false);
    assert.equal(licenseAcknowledged(model, { [model.id]: { id: model.id, acknowledgedAt: 1, licenseId: 'old' } }), false);
    assert.equal(
      licenseAcknowledged(model, { [model.id]: { id: model.id, acknowledgedAt: 1, licenseId: model.license.id } }),
      true,
    );
    assert.equal(licenseBadge(model.license).tone, 'warn');
    assert.match(licenseSummary(model), /Non-commercial/i);
  });

  await test('install gate blocks unavailable runtimes and unacknowledged licenses', () => {
    const phonon = getModel('phonon-31m-en');
    const ack = { [phonon.id]: { id: phonon.id, acknowledgedAt: 1, licenseId: phonon.license.id } };
    assert.equal(canInstallModel(phonon, ack).ok, true);
    // Without readiness information a sidecar model cannot claim its runtime.
    assert.equal(canInstallModel(getModel('kokoro-82m'), {}).ok, false);
    const gated = getModel('phonon-40m-multilingual');
    assert.equal(canInstallModel(gated, {}).ok, false);
    assert.match(canInstallModel(gated, {}).reason, /Acknowledge/i);
    const restricted = {
      ...phonon,
      id: 'phonon-test-restricted',
      license: { ...phonon.license, id: 'TEST-NC', restricted: true, commercial: false },
    };
    assert.equal(canInstallModel(restricted, {}).ok, false);
    assert.match(canInstallModel(restricted, {}).reason, /Acknowledge/i);
  });

  await test('runtime catalog pins uv and Python, and every sidecar pack is a pinned recipe', () => {
    const packs = runtimeCatalog.packs;
    assert.equal(packs.length, 15);
    assert.equal(new Set(packs.map((pack) => pack.id)).size, packs.length);

    const uv = packs.find((pack) => pack.kind === 'tool');
    assert.equal(uv.id, 'uv-win-x64');
    assert.match(uv.archive.sha256, /^[a-f0-9]{64}$/);
    assert.match(uv.archive.url, /^https:\/\/github\.com\/astral-sh\/uv\/releases\/download\//);

    const python = packs.find((pack) => pack.kind === 'python');
    assert.equal(python.id, 'python-3.12-win-x64');
    assert.equal(python.available, true);
    assert.equal(python.entry.python, 'python/python.exe');
    assert.equal(python.archive.size, 47113364);
    assert.match(python.archive.sha256, /^[a-f0-9]{64}$/);
    assert.match(python.archive.url, /^https:\/\/github\.com\/astral-sh\/python-build-standalone\//);

    const sidecars = packs.filter((pack) => pack.kind === 'sidecar');
    assert.equal(sidecars.length, 13);
    for (const pack of sidecars) {
      assert.equal(pack.available, true, pack.id);
      assert.equal(pack.importable, true, pack.id);
      assert.equal(pack.entry.server, 'start.py', pack.id);
      assert.equal(pack.entry.python, 'venv/Scripts/python.exe', pack.id);
      assert.ok(pack.requires.includes(uv.id), pack.id);
      assert.ok(pack.license?.id, pack.id);
      const build = pack.build;
      assert.ok(build, `${pack.id} has no recipe`);
      assert.match(build.python, /^3\.1[12]$/, pack.id);
      if (build.python === '3.12') assert.ok(pack.requires.includes(python.id), pack.id);
      // Requirements are pinned to a version or to an immutable commit/release URL.
      for (const requirement of build.requirements) {
        if (/^(soxr|soundfile|numpy|jaconv|mojimoji|imageio-ffmpeg|cachetools|safetensors|pydub|ormsgpack|silero-vad|descript-audio(codec|tools)|descript-audio-codec|descript-audiotools|accelerate)$/.test(requirement)) continue;
        assert.match(requirement, /==|>=|<=|<|@ https:\/\/github\.com\/[^ ]+\/(archive\/[a-f0-9]{40}\.zip|releases\/download\/)/, `${pack.id}: ${requirement}`);
      }
      if (build.torch) assert.match(build.torch.packages.torch, /^\d+\.\d+\.\d+$/, pack.id);
      for (const source of build.sources || []) {
        assert.match(source.url, /\/archive\/[a-f0-9]{40}\.zip$/, `${pack.id}: ${source.name}`);
        assert.match(source.sha256, /^[a-f0-9]{64}$/, `${pack.id}: ${source.name}`);
      }
    }
  });

  await test('every sidecar model points at a catalog pack whose adapter ships with the app', () => {
    const packs = runtimeCatalog.packs;
    const sidecars = MODELS.filter((model) => model.runtime === 'sidecar');
    assert.equal(sidecars.length, 13);
    for (const model of sidecars) {
      assert.match(model.runtimePack.packId || '', /-sidecar$/, model.id);
      const pack = packs.find((entry) => entry.id === model.runtimePack.packId);
      assert.ok(pack, `${model.id} has no catalog pack`);
      assert.ok(pack.provides.includes(model.id), `${pack.id} does not list ${model.id}`);
      const adapter = path.join(projectRoot, 'electron', 'sidecars', 'adapters', `${pack.build.adapter}.py`);
      assert.ok(fs.existsSync(adapter), `${pack.id} adapter ${pack.build.adapter}.py is missing`);
      for (const shim of pack.build.shims || []) {
        assert.ok(fs.existsSync(path.join(projectRoot, 'electron', 'sidecars', 'shims', shim)), `${pack.id} shim ${shim}`);
      }
    }
  });

  await test('runtime readiness follows installed packs instead of static flags', () => {
    const empty = {};
    assert.equal(runtimeReadiness(getModel('phonon-31m-en'), empty).ready, true);

    const kokoro = runtimeReadiness(getModel('kokoro-82m'), empty);
    assert.equal(kokoro.ready, false);
    assert.equal(kokoro.packId, 'kokoro-82m-sidecar');

    const silma = getModel('silma-tts');
    const missing = runtimeReadiness(silma, empty);
    assert.equal(missing.ready, false);
    assert.equal(missing.available, false);
    assert.equal(missing.packId, 'silma-tts-sidecar');

    const buildable = runtimeReadiness(silma, {
      'silma-tts-sidecar': { id: 'silma-tts-sidecar', name: 'SILMA runtime', installed: false, available: true, buildable: true, reason: null, error: undefined },
    });
    assert.equal(buildable.ready, false);
    assert.equal(buildable.available, true);
    assert.match(buildable.reason, /Install sets up/i);

    const installed = {
      'silma-tts-sidecar': {
        id: 'silma-tts-sidecar',
        name: 'SILMA sidecar runtime',
        installed: true,
        available: true,
        reason: null,
        error: undefined,
      },
    };
    const ready = runtimeReadiness(silma, installed);
    assert.equal(ready.ready, true);
    assert.equal(ready.reason, null);

    const sorted = visibleRuntimePacks([
      { id: 'a', name: 'B sidecar', kind: 'sidecar', installed: false, available: false },
      { id: 'b', name: 'A python', kind: 'python', installed: false, available: true },
      { id: 'c', name: 'C installed', kind: 'sidecar', installed: true, available: true },
    ]);
    assert.deepEqual(sorted.map((pack) => pack.id), ['c', 'b', 'a']);
  });

  await test('license gate accepts dynamic runtime readiness', () => {
    const silma = getModel('silma-tts');
    const blocked = canInstallModel(silma, {}, { ready: false, available: false, reason: 'Install the SILMA runtime pack first.' });
    assert.equal(blocked.ok, false);
    assert.match(blocked.reason, /SILMA runtime pack/);

    // A buildable runtime is installed together with the model.
    assert.equal(canInstallModel(silma, {}, { ready: false, available: true }).ok, true);
    assert.equal(canInstallModel(silma, {}, { ready: true }).ok, true);
    const xtts = getModel('xtts-v2');
    assert.match(canInstallModel(xtts, {}, { ready: true }).reason, /Acknowledge/i);
  });

  await test('OmniVoice weights are CC-BY-NC and require acknowledgment', () => {
    const omni = getModel('omnivoice');
    assert.equal(omni.license.id, 'CC-BY-NC-4.0');
    assert.equal(omni.license.commercial, false);
    assert.equal(omni.license.restricted, true);
    assert.equal(requiresLicenseAck(omni), true);
    assert.equal(licenseAcknowledged(omni, {}), false);
    assert.notEqual(licenseBadge(omni.license).tone, 'ok');
    assert.match(licenseSummary(omni), /Non-commercial/i);

    const runnableOmni = {
      ...getModel('phonon-31m-en'),
      id: 'omnivoice-test',
      license: omni.license,
      runtimePack: { available: true },
    };
    assert.match(canInstallModel(runnableOmni, {}, { ready: true }).reason, /Acknowledge/i);
    assert.equal(
      canInstallModel(
        runnableOmni,
        { 'omnivoice-test': { id: 'omnivoice-test', acknowledgedAt: 1, licenseId: omni.license.id } },
        { ready: true },
      ).ok,
      true,
    );
  });

  await test('archive path validation rejects traversal and absolute entries', () => {
    const root = path.join(os.tmpdir(), 'voxarium-safe-path');
    assert.equal(safePath(root, 'python/python.exe'), path.join(root, 'python', 'python.exe'));
    for (const name of [
      '../escape.txt',
      'a/../../escape.txt',
      '/etc/passwd',
      'C:/Windows/system32/x.dll',
      '\\\\server\\share\\x',
    ]) {
      assert.throws(
        () => safePath(root, name),
        /escapes the install folder|absolute path/i,
        name,
      );
    }
  });

  await test('tar.gz runtime packs extract safely and reject traversal', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voxarium-archive-'));
    try {
      const good = path.join(dir, 'good.tar.gz');
      fs.writeFileSync(
        good,
        buildTarGz([
          { name: 'python/', type: '5' },
          { name: 'python/python.exe', data: 'stub-interpreter' },
        ]),
      );
      const out = path.join(dir, 'good');
      const kind = await extractArchive(good, out);
      assert.equal(kind, 'tar.gz');
      assert.equal(fs.readFileSync(path.join(out, 'python', 'python.exe'), 'utf8'), 'stub-interpreter');

      const evil = path.join(dir, 'evil.tar.gz');
      fs.writeFileSync(evil, buildTarGz([{ name: '../escaped.txt', data: 'nope' }]));
      const evilOut = path.join(dir, 'evil');
      await assert.rejects(() => extractArchive(evil, evilOut), /escapes the install folder/);
      assert.equal(fs.existsSync(path.join(dir, 'escaped.txt')), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('Arabic is inferred only from declared language codes', () => {
    assert.equal(modelHasArabic(getModel('phonon-31m-en')), false);
    assert.equal(modelHasArabic(getModel('kokoro-82m')), false);
    assert.equal(modelHasArabic(getModel('omnivoice')), true);
    assert.equal(modelHasArabic(getModel('supertonic-3')), true);
    // The Arabic capability always matches the declared languages (UI chips read it).
    for (const model of MODELS) {
      assert.equal(model.capabilities.arabic, modelHasArabic(model), `${model.id} Arabic flag`);
      assert.equal(compat.capabilityEnabled(model, 'arabic'), modelHasArabic(model), `${model.id} Arabic chip`);
    }
    assert.equal(getModel('supertonic-3').capabilities.nonVerbal, true, 'Supertonic accepts <laugh>/<sigh>/<breath> tags');
    assert.equal(arabicVarietiesFor(getModel('omnivoice')).length, ARABIC_VARIETIES.length);
    assert.deepEqual(
      arabicVarietiesFor(getModel('supertonic-3')).map((variety) => variety.code),
      ['arb'],
    );
    assert.equal(supportsLanguage(getModel('phonon-31m-en'), 'ar'), false);
    assert.equal(supportsLanguage(getModel('omnivoice'), 'ar'), true);
    assert.equal(resolveLanguage(getModel('phonon-31m-en'), 'ar'), 'en');
  });

  await test('voice compatibility follows model format and locale', () => {
    const phonon = getModel('phonon-31m-en');
    const defaultVoice = catalog.getVoice('default');
    const englishVoice = catalog.VOICES.find((voice) => voice.locale === 'en-us' && voice.id !== 'default');
    const frenchVoice = catalog.VOICES.find((voice) => voice.locale === 'fr-fr');
    assert.equal(voiceCompatibleWithModel(phonon, defaultVoice), true);
    assert.equal(voiceCompatibleWithModel(phonon, englishVoice), true);
    if (frenchVoice) {
      assert.equal(voiceCompatibleWithModel(phonon, frenchVoice), false);
      assert.match(voiceCompatibilityNote(phonon, frenchVoice), /FR-FR|does not support/i);
    }
    const silent = getModel('chatterbox');
    assert.equal(voiceCompatibleWithModel(silent, defaultVoice), false);
    assert.match(voiceCompatibilityNote(silent, defaultVoice), /Phonon voice/i);
    assert.equal(voicesForModel(silent).voices.length, 0);
    assert.ok(voicesForModel(silent).reason);
  });

  await test('custom Phonon voices follow the model language', () => {
    const phonon = getModel('phonon-31m-en');
    const english = { ...catalog.getVoice('default'), id: 'c_en', source: 'custom', language: 'en' };
    const french = { ...catalog.getVoice('default'), id: 'c_fr', source: 'custom', language: 'fr' };
    assert.equal(voiceCompatibleWithModel(phonon, english), true);
    assert.equal(voiceCompatibleWithModel(phonon, french), false);
    assert.equal(voiceCompatibleWithModel(getModel('phonon-40m-multilingual'), french), true);
  });

  await test('normalization coerces saved preferences to what the model supports', () => {
    const phonon = getModel('phonon-31m-en');
    const normalized = normalizePreferences(phonon, {
      quality: 'f32',
      language: 'fr',
      device: 'webgpu',
      threads: 'auto',
      temperature: 1.6,
      seed: 'take-42',
      lastVoice: 'missing-voice',
      arabicVariety: 'ar-eg',
    });
    assert.equal(normalized.quality, 'f32');
    assert.equal(normalized.language, 'en');
    assert.equal(normalized.device, 'webgpu');
    assert.equal(normalized.temperature, 1);
    assert.equal(normalized.seed, '42');
    assert.equal(normalized.lastVoice, 'default');
    assert.equal(normalized.arabicVariety, 'arb');

    const kokoro = getModel('kokoro-82m');
    const kokoroPrefs = normalizePreferences(kokoro, { quality: 'f32', language: 'ar', threads: 64 });
    assert.equal(kokoroPrefs.quality, defaultQualityFor(kokoro));
    assert.equal(kokoroPrefs.language, kokoro.defaults.language);
    assert.equal(kokoroPrefs.threads, 32);

    const omni = getModel('omnivoice');
    const omniPrefs = normalizePreferences(omni, { language: 'ar', arabicVariety: 'arz' });
    assert.equal(omniPrefs.language, 'ar');
    assert.equal(omniPrefs.arabicVariety, 'arz');
    assert.equal(normalizePreferences(omni, { arabicVariety: 'xx' }).arabicVariety, 'arb');
    assert.equal(normalizePreferences(phonon, { threads: 'oops' }).threads, 1);
  });

  await test('switching models archives outgoing preferences and restores incoming ones', () => {
    const phonon = getModel('phonon-31m-en');
    const omni = getModel('omnivoice');
    const base = makeSettings({ quality: 'f32', language: 'en', temperature: 0.2 });

    const firstSwitch = switchModelSettings(base, phonon, omni);
    assert.equal(firstSwitch.activeModelId, omni.id);
    assert.equal(firstSwitch.modelSettings[phonon.id].quality, 'f32');
    assert.equal(firstSwitch.modelSettings[phonon.id].temperature, 0.2);
    assert.equal(firstSwitch.language, omni.defaults.language);
    assert.equal(firstSwitch.quality, omni.defaults.quality);

    const omniEdited = {
      ...base,
      ...firstSwitch,
      language: 'ar',
      arabicVariety: 'arz',
      modelSettings: firstSwitch.modelSettings,
    };
    const back = switchModelSettings(omniEdited, omni, phonon);
    assert.equal(back.activeModelId, phonon.id);
    assert.equal(back.quality, 'f32');
    assert.equal(back.temperature, 0.2);
    assert.equal(back.language, 'en');
    assert.equal(back.modelSettings[omni.id].language, 'ar');
    assert.equal(back.modelSettings[omni.id].arabicVariety, 'arz');
    assert.equal(back.modelSettings[phonon.id].quality, 'f32');
  });

  await test('API names resolve to models and voices loosely but safely', () => {
    const kokoro = getModel('kokoro-82m');
    assert.equal(bridge.resolveModel(MODELS, 'kokoro-82m').id, 'kokoro-82m');
    assert.equal(bridge.resolveModel(MODELS, 'Kokoro').id, 'kokoro-82m');
    assert.equal(bridge.resolveModel(MODELS, 'Phonon 31M English').id, 'phonon-31m-en');
    assert.equal(bridge.resolveModel(MODELS, 'tts-1'), null);
    const voices = [
      { id: 'kokoro-82m:af_heart', name: 'Heart', source: 'model', modelId: kokoro.id },
      { id: 'kokoro-82m:ref:my_voice', name: 'My Voice', source: 'model', modelId: kokoro.id },
    ];
    assert.equal(bridge.resolveVoice(kokoro, voices, 'kokoro-82m:af_heart').id, 'kokoro-82m:af_heart');
    assert.equal(bridge.resolveVoice(kokoro, voices, 'af_heart').id, 'kokoro-82m:af_heart');
    assert.equal(bridge.resolveVoice(kokoro, voices, 'heart').id, 'kokoro-82m:af_heart');
    assert.equal(bridge.resolveVoice(kokoro, voices, 'nobody'), null);
    assert.equal(bridge.isReferenceVoice(voices[1]), true, 'reference clips are recognised for the opt-in gate');
    assert.equal(bridge.isReferenceVoice(voices[0]), false);
  });

  await test('API speech requests are validated and OpenAI defaults map to Voxarium', () => {
    const { speechRequest } = require('../electron/integrations/api-server.cjs');
    const openai = speechRequest({ model: 'tts-1', input: 'Hi', voice: 'alloy' }, { openai: true });
    assert.equal(openai.model, undefined, 'OpenAI model names use the active model');
    assert.equal(openai.voice, undefined, 'OpenAI voice names use the current voice');
    assert.equal(openai.format, 'mp3', 'OpenAI defaults to mp3');
    const native = speechRequest({ text: 'Hi', model: 'kokoro-82m', voice: 'af_heart', seed: 7, speed: 1.2 }, { openai: false });
    assert.deepEqual([native.model, native.voice, native.format, native.seed, native.speed], ['kokoro-82m', 'af_heart', 'wav', '7', 1.2]);
    for (const [body, pattern] of [
      [{ text: '' }, /required/],
      [{ text: '   ' }, /no text/],
      [{ text: 'x', format: 'ogg' }, /Unsupported format/],
      [{ text: 'x', speed: 9 }, /speed/],
      [{ text: 'x', seed: '-1' }, /seed/],
      [{ text: 'x'.repeat(20001) }, /too long/],
    ]) {
      assert.throws(() => speechRequest(body, { openai: false }), pattern);
    }
  });

  await test('expression specs are well formed and drive the emotion/non-verbal flags', () => {
    for (const model of MODELS) {
      const spec = model.expression;
      const tags = spec?.tags || [];
      for (const item of tags) {
        assert.ok(item.token && item.label, `${model.id} tag`);
        assert.ok(['sound', 'emotion', 'pause'].includes(item.kind), `${model.id} tag kind`);
      }
      if (spec?.intensity) {
        const { min, max, default: value, step } = spec.intensity;
        assert.ok(min < max && value >= min && value <= max && step > 0, `${model.id} intensity range`);
      }
      if (spec?.instruction) assert.ok(spec.instruction.maxLength > 0 && spec.instruction.examples.length > 0, `${model.id} instruction`);
      const emotion = Boolean(spec && (spec.instruction || spec.attributes || spec.intensity || tags.some((item) => item.kind === 'emotion')));
      assert.equal(model.capabilities.emotion, emotion, `${model.id} emotion flag matches its Expression controls`);
      assert.equal(model.capabilities.nonVerbal, tags.some((item) => item.kind === 'sound'), `${model.id} non-verbal flag`);
    }
    assert.deepEqual(getModel('supertonic-3').expression.tags.map((item) => item.token), ['<laugh>', '<breath>', '<sigh>']);
    assert.equal(expression.hasExpression(getModel('kokoro-82m')), false);
    assert.equal(expression.hasExpression(getModel('omnivoice')), true);
  });

  await test('expression values resolve to what each model receives', () => {
    const omni = getModel('omnivoice');
    assert.deepEqual(expression.resolveExpression(omni, { attributes: { gender: 'female', accent: 'british accent', age: '' } }), {
      instruction: 'female, british accent',
    });
    const vox = getModel('voxcpm2');
    assert.deepEqual(expression.resolveExpression(vox, { instruction: '  A calm narrator  ' }), { instruction: 'A calm narrator' });
    assert.deepEqual(expression.resolveExpression(vox, { instruction: 'saved' }, { instruction: 'from the API' }), { instruction: 'from the API' });
    assert.equal(expression.resolveExpression(vox, { instruction: 'x'.repeat(999) }).instruction.length, vox.expression.instruction.maxLength);
    const chatter = getModel('chatterbox');
    assert.deepEqual(expression.resolveExpression(chatter, undefined), { intensity: 0.5 });
    assert.deepEqual(expression.resolveExpression(chatter, { intensity: 9 }), { intensity: 2 });
    assert.deepEqual(expression.resolveExpression(getModel('kokoro-82m'), { instruction: 'ignored' }, { instruction: 'ignored' }), {});
    assert.deepEqual(expression.resolveExpression(getModel('supertonic-3'), { instruction: 'tags only' }), {});
  });

  await test('tags are inserted at the cursor with natural spacing', () => {
    assert.deepEqual(expression.insertTag('Hello world', 5, 5, '<laugh>'), { text: 'Hello <laugh> world', cursor: 13 });
    assert.deepEqual(expression.insertTag('', 0, 0, '[pause 1.0s]'), { text: '[pause 1.0s]', cursor: 12 });
    assert.equal(expression.insertTag('Wait.', 4, 4, '<sigh>').text, 'Wait <sigh>.');
    assert.equal(expression.insertTag('Replace me', 0, 7, '(sigh)').text, '(sigh) me');
  });

  await test('API requests carry expression fields, including OpenAI "instructions"', () => {
    const { speechRequest } = require('../electron/integrations/api-server.cjs');
    assert.equal(speechRequest({ input: 'Hi', instructions: 'calm and slow' }, { openai: true }).instruction, 'calm and slow');
    const native = speechRequest({ text: 'Hi', instruction: 'female, elderly', intensity: 1.2 }, { openai: false });
    assert.deepEqual([native.instruction, native.intensity], ['female, elderly', 1.2]);
    assert.throws(() => speechRequest({ text: 'Hi', instruction: 'x'.repeat(501) }, { openai: false }), /too long/);
    assert.throws(() => speechRequest({ text: 'Hi', intensity: 9 }, { openai: false }), /intensity/);
  });
  await test('rememberPreferences mirrors only model-scoped edits', () => {
    const phonon = getModel('phonon-31m-en');
    const base = makeSettings({ quality: 'q8', language: 'en' });

    const mirror = rememberPreferences(base, phonon, { quality: 'f32', temperature: 0.9 });
    assert.deepEqual(Object.keys(mirror), ['modelSettings']);
    assert.equal(mirror.modelSettings[phonon.id].quality, 'f32');
    assert.equal(mirror.modelSettings[phonon.id].temperature, 0.9);

    const unsupported = rememberPreferences(base, phonon, { language: 'fr' });
    assert.equal(unsupported.modelSettings[phonon.id].language, 'en');

    assert.equal(rememberPreferences(base, phonon, { theme: 'light' }), null);
  });
} finally {
  await server.close();
}

const failed = results.filter((result) => !result.ok);
for (const result of results) {
  if (result.ok) console.log(`  ok  ${result.name}`);
  else console.error(`  FAIL ${result.name}\n       ${result.error?.stack || result.error}`);
}
console.log(`\n${results.length - failed.length}/${results.length} model tests passed`);
if (failed.length) process.exitCode = 1;
