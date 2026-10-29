const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeImage,
  net,
  powerSaveBlocker,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
} = require('electron');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { startModelServer } = require('./model-server.cjs');
const { createModelState, adoptLegacyFiles } = require('./models/state.cjs');
const { createModelManager } = require('./models/downloads.cjs');
const { probeHardware } = require('./models/hardware.cjs');
const { createSidecarSupervisor } = require('./models/sidecar.cjs');
const { createRuntimeManager } = require('./models/runtimes.cjs');
const { loadManifests, getModel } = require('./models/registry.cjs');

const IS_DEV = Boolean(process.env.VITE_DEV_SERVER_URL);
const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const APP_ID = 'com.voxarium.app';

// Playwright runs several profiles side by side; this keeps every run out of the
// user's real %APPDATA% folder. It must be set before the app is ready.
if (process.env.VOXARIUM_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.VOXARIUM_USER_DATA));
}

const VOICES_REPO = 'gradium/phonon-voices';
const VOICES_REVISION = '0ee17205f254b5abc43b266c8a0f215565c352f7';

// Voice files are tiny (256 KB each) and there are 102 of them in the catalog.
const VOICE_FILE_SIZE = 256136;

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {{ port: number, url: string, close: () => Promise<void> } | null} */
let modelServer = null;

let activeDownload = null;
let quitAfterServerClose = false;
/** @type {ReturnType<typeof createModelState> | null} */
let modelState = null;
/** @type {ReturnType<typeof createModelManager> | null} */
let modelManager = null;
/** @type {ReturnType<typeof createSidecarSupervisor> | null} */
let sidecars = null;
/** @type {ReturnType<typeof createRuntimeManager> | null} */
let runtimeManager = null;
let hardwareCache = null;
let modelsInitialized = false;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const DATA_DIR = () => app.getPath('userData');

// Before the rename this app stored everything in `%APPDATA%\Phonon Studio`.
// Adopt that folder once so existing models, voices and history keep working.
const LEGACY_DATA_DIR = () => path.join(app.getPath('appData'), 'Phonon Studio');

function migrateLegacyDataDir() {
  try {
    const target = DATA_DIR();
    const legacy = LEGACY_DATA_DIR();
    if (path.resolve(target).toLowerCase() === path.resolve(legacy).toLowerCase()) return;
    if (!fs.existsSync(legacy)) return;
    // Never overwrite a Voxarium profile that already has its own settings.
    if (fs.existsSync(path.join(target, 'settings.json'))) return;
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(legacy, { withFileTypes: true })) {
      const from = path.join(legacy, entry.name);
      const to = path.join(target, entry.name);
      if (fs.existsSync(to)) continue;
      try {
        fs.renameSync(from, to);
      } catch {
        fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
      }
    }
    console.log('[voxarium] adopted data from', legacy);
  } catch (error) {
    console.warn('[voxarium] could not adopt the previous data folder', error);
  }
}

/** History stores absolute take paths, so repoint anything still under the old folder. */
function retargetLegacyHistory() {
  try {
    const file = HISTORY_FILE();
    const history = readJson(file, null);
    if (!Array.isArray(history)) return;
    const legacy = LEGACY_DATA_DIR();
    const prefix = legacy.toLowerCase() + path.sep;
    let changed = false;
    for (const entry of history) {
      if (!entry || typeof entry.filePath !== 'string') continue;
      if (!entry.filePath.toLowerCase().startsWith(prefix)) continue;
      entry.filePath = path.join(DATA_DIR(), path.relative(legacy, entry.filePath));
      changed = true;
    }
    if (changed) fs.writeFileSync(file, JSON.stringify(history, null, 2), 'utf8');
  } catch (error) {
    console.warn('[voxarium] could not repoint the recording history', error);
  }
}

const DIRS = () => ({
  data: DATA_DIR(),
  models: path.join(DATA_DIR(), 'models'),
  runtimes: path.join(DATA_DIR(), 'runtimes'),
  voices: path.join(DATA_DIR(), 'voices'),
  audio: path.join(DATA_DIR(), 'audio'),
});
const SETTINGS_FILE = () => path.join(DATA_DIR(), 'settings.json');
const HISTORY_FILE = () => path.join(DATA_DIR(), 'history.json');
const WINDOW_FILE = () => path.join(DATA_DIR(), 'window.json');
const CUSTOM_VOICES_FILE = () => path.join(DATA_DIR(), 'custom-voices.json');
const CUSTOM_VOICES_DIR = () => path.join(DIRS().voices, 'custom');
const CLONE_KEY_FILE = () => path.join(DATA_DIR(), 'gradium-key.json');

const GRADIUM_API = 'https://api.gradium.ai/api';
const CLONE_LANGUAGES = ['en', 'fr', 'de', 'es', 'pt'];
const VOICE_SHAPE = [1, 512, 125];

function ensureDirs() {
  for (const dir of Object.values(DIRS())) fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

function initModelServices() {
  if (modelsInitialized) return;
  modelState = createModelState({
    dataDir: DATA_DIR(),
    dirs: DIRS(),
    readJson,
    writeJsonAtomic,
  });
  modelManager = createModelManager({
    dirs: DIRS(),
    appVersion: app.getVersion(),
    state: modelState,
    broadcast: (payload) => send('models:progress', payload),
    log: (...args) => console.log(...args),
  });
  runtimeManager = createRuntimeManager({
    dirs: DIRS(),
    appVersion: app.getVersion(),
    readJson,
    writeJsonAtomic,
    broadcast: (payload) => send('models:progress', payload),
    log: (...args) => console.log(...args),
  });
  sidecars = createSidecarSupervisor({ dirs: DIRS(), send, runtimes: runtimeManager });
  modelsInitialized = true;
}

function activeModelId() {
  return modelState ? modelState.read().activeModelId : getModel(null).id;
}

function modelRuntime(model) {
  initModelServices();
  return runtimeManager.modelRuntime(model);
}

function requiresLicenseAck(model) {
  return Boolean(model.license.restricted || model.license.review || model.license.commercial === false);
}

async function hardware(force = false) {
  if (!hardwareCache || force) {
    hardwareCache = await probeHardware({
      app,
      dataDir: DATA_DIR(),
      gpuPreference: getSettings().gpuPreference,
    });
  }
  return hardwareCache;
}

async function modelsSnapshot({ forceHardware = false } = {}) {
  initModelServices();
  const state = modelState.read();
  return {
    activeModelId: state.activeModelId,
    generatedAt: loadManifests().document.generatedAt,
    hardware: await hardware(forceHardware),
    models: modelManager.statusAll(),
    licenses: state.licenses,
    sidecars: sidecars.statusAll(),
    runtimes: runtimeManager.statusAll(),
  };
}

function notifyModels() {
  send('models:changed');
}

const defaultSettings = () => ({
  theme: 'dark',
  accent: 'violet',
  outputDir: app.getPath('downloads'),
  autoSave: true,
  autoPlay: true,
  streaming: true,
  allowCloudCloning: true,
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
  filenameTemplate: 'voxarium-{date}-{voice}',
  temperature: 0.3,
  seed: '4242424242424242',
  pronunciations: [],
  setupComplete: false,
  onboardingDismissed: false,
});

function getSettings() {
  return { ...defaultSettings(), ...readJson(SETTINGS_FILE(), {}) };
}

async function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  if (next.conditions && typeof next.conditions === 'object') {
    next.conditions = { ...defaultSettings().conditions, ...next.conditions };
  }
  await writeJsonAtomic(SETTINGS_FILE(), next);
  return next;
}

function sanitizeName(value, fallback = 'voxarium-audio') {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 110);
  return cleaned || fallback;
}

function uniquePath(dir, baseName, ext) {
  let candidate = path.join(dir, `${baseName}${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${baseName}-${index}${ext}`);
    index += 1;
  }
  return candidate;
}

function isInside(parent, child) {
  const relative = path.relative(parent, path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function broadcastProgress(payload) {
  send('download:progress', payload);
}

function modelStatus() {
  initModelServices();
  const dirs = DIRS();
  const id = activeModelId();
  const model = getModel(id);
  const status = modelManager.status(id);
  const voiceIds = [];
  try {
    for (const name of fs.readdirSync(dirs.voices)) {
      if (!name.endsWith('.safetensors')) continue;
      try {
        if (fs.statSync(path.join(dirs.voices, name)).size >= 100000) voiceIds.push(name.slice(0, -'.safetensors'.length));
      } catch {}
    }
  } catch {}
  return {
    ...status,
    modelId: id,
    name: model.shortName,
    runtime: model.runtime,
    q8Ready: status.qualities.includes('q8'),
    f32Ready: status.qualities.includes('f32'),
    voicesDownloaded: voiceIds.length,
    voiceIds,
    dirs: dirs,
  };
}

function dirSize(dir) {
  let bytes = 0;
  let files = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        try {
          bytes += fs.statSync(full).size;
          files += 1;
        } catch {}
      } else if (entry.isDirectory()) {
        const nested = dirSize(full);
        bytes += nested.bytes;
        files += nested.files;
      }
    }
  } catch {}
  return { bytes, files };
}

async function storageStats() {
  const dirs = DIRS();
  const models = dirSize(dirs.models);
  const runtimes = dirSize(dirs.runtimes);
  const voices = dirSize(dirs.voices);
  const audio = dirSize(dirs.audio);
  let historyBytes = 0;
  try {
    historyBytes = fs.statSync(HISTORY_FILE()).size;
  } catch {}
  let freeDisk = null;
  try {
    const stats = await fsp.statfs(dirs.data);
    freeDisk = Number(stats.bsize) * Number(stats.bavail);
  } catch {}
  return {
    models,
    runtimes,
    voices,
    audio,
    historyBytes,
    totalBytes: models.bytes + runtimes.bytes + voices.bytes + audio.bytes,
    freeDisk,
  };
}

async function downloadToFile(url, destination, expectedSize, { signal, onProgress } = {}) {
  if (fs.existsSync(destination)) {
    const size = fs.statSync(destination).size;
    if (!expectedSize || size === expectedSize) {
      onProgress?.({ loaded: size, total: expectedSize || size, cached: true });
      return { cached: true, bytes: size };
    }
    await fsp.rm(destination, { force: true });
  }
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const response = await fetch(url, {
    signal,
    headers: { 'user-agent': `Voxarium/${app.getVersion()}` },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status} ${response.statusText}) for ${path.basename(destination)}`);
  }
  const total = Number(response.headers.get('content-length')) || expectedSize || 0;
  const temp = `${destination}.part`;
  await fsp.rm(temp, { force: true });
  const handle = await fsp.open(temp, 'w');
  let loaded = 0;
  let lastEmit = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await handle.write(value);
      loaded += value.byteLength;
      const now = Date.now();
      if (now - lastEmit > 120) {
        lastEmit = now;
        onProgress?.({ loaded, total, cached: false });
      }
    }
  } catch (error) {
    await handle.close().catch(() => {});
    await fsp.rm(temp, { force: true });
    throw error;
  }
  await handle.close();
  const actual = (await fsp.stat(temp)).size;
  if (expectedSize && actual !== expectedSize) {
    await fsp.rm(temp, { force: true });
    throw new Error(`Incomplete download for ${path.basename(destination)} (${actual} of ${expectedSize} bytes)`);
  }
  await fsp.rm(destination, { force: true });
  await fsp.rename(temp, destination);
  onProgress?.({ loaded: actual, total: total || actual, cached: false });
  return { cached: false, bytes: actual };
}

async function downloadModelFiles(id, quality) {
  initModelServices();
  const model = getModel(id);
  const runtime = modelRuntime(model);
  if (!runtime.ready) {
    return { ok: false, code: 'runtime', error: runtime.reason || 'This model has no installed runtime pack.' };
  }
  if (!model.files.length) {
    return { ok: false, error: 'This model has no verified files pinned yet.' };
  }
  if (requiresLicenseAck(model) && !modelState.acknowledged(model.id)) {
    return { ok: false, code: 'license', error: `Acknowledge the ${model.license.name} before installing ${model.shortName}.` };
  }
  const result = await modelManager.download(model.id, quality);
  if (result.ok) {
    await saveSettings({ quality, setupComplete: true });
    broadcastProgress({ kind: 'model', done: true });
    notifyModels();
  }
  return result;
}

function voiceUrl(id) {
  return `https://huggingface.co/${VOICES_REPO}/resolve/${VOICES_REVISION}/voices/${id}.safetensors`;
}

async function ensureVoiceFile(id, { signal, onProgress, index, count } = {}) {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) throw new Error('Invalid voice id');
  const dirs = DIRS();
  fs.mkdirSync(dirs.voices, { recursive: true });
  const destination = path.join(dirs.voices, `${id}.safetensors`);
  const result = await downloadToFile(voiceUrl(id), destination, VOICE_FILE_SIZE, {
    signal,
    onProgress: (progress) =>
      onProgress?.({ ...progress, file: `${id}.safetensors`, index, count, voiceId: id }),
  });
  return { ...result, path: destination };
}

async function downloadVoices(ids) {
  const controller = new AbortController();
  activeDownload = { controller, kind: 'voices' };
  try {
    const queue = [...ids];
    let completed = 0;
    const worker = async () => {
      while (queue.length) {
        if (controller.signal.aborted) throw new Error('Download cancelled');
        const id = queue.shift();
        await ensureVoiceFile(id, {
          signal: controller.signal,
          index: completed,
          count: ids.length,
          onProgress: (progress) => {
            broadcastProgress({
              kind: 'voice',
              file: progress.file,
              loaded: progress.loaded,
              total: progress.total,
              cached: progress.cached,
              voiceId: id,
              index: completed,
              count: ids.length,
              percent: progress.total ? (progress.loaded / progress.total) * 100 : null,
            });
          },
        });
        completed += 1;
        broadcastProgress({
          kind: 'voice',
          file: `${id}.safetensors`,
          voiceId: id,
          loaded: VOICE_FILE_SIZE,
          total: VOICE_FILE_SIZE,
          index: completed,
          count: ids.length,
          percent: 100,
          completed: true,
        });
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    return { ok: true, downloaded: ids.length };
  } finally {
    activeDownload = null;
  }
}

// ---------------------------------------------------------------------------
// Custom voices: imported .safetensors files and Gradium voice clones
// ---------------------------------------------------------------------------

function voiceDisplayName(value, fallback = 'My voice') {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || fallback;
}

/** Validates the single-tensor safetensors layout every Phonon voice uses. */
function readVoiceSafetensors(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) {
    throw new Error('That file is too small to be a Phonon voice file.');
  }
  if (buffer.length > 64 * 1024 * 1024) {
    throw new Error('That file is larger than any Phonon voice file.');
  }
  const headerLength = Number(buffer.readBigUInt64LE(0));
  if (!Number.isSafeInteger(headerLength) || headerLength <= 0 || headerLength > 4 * 1024 * 1024) {
    throw new Error('That file is not a valid .safetensors file.');
  }
  if (8 + headerLength > buffer.length) {
    throw new Error('That voice file is truncated.');
  }
  let header;
  try {
    header = JSON.parse(buffer.subarray(8, 8 + headerLength).toString('utf8'));
  } catch {
    throw new Error('That file is not a valid .safetensors file.');
  }
  const tensor = header && typeof header === 'object' ? header.speaker_wavs : null;
  if (!tensor || typeof tensor !== 'object') {
    throw new Error('That .safetensors file has no “speaker_wavs” tensor, so it is not a Phonon voice.');
  }
  if (tensor.dtype !== 'F32') {
    throw new Error('That voice uses an unsupported dtype. Phonon voices are stored as F32.');
  }
  const shape = Array.isArray(tensor.shape) ? tensor.shape.map(Number) : [];
  if (shape.length !== VOICE_SHAPE.length || shape.some((size, index) => size !== VOICE_SHAPE[index])) {
    throw new Error(`That voice has shape [${shape.join(' × ')}]. Phonon voices are 1 × 512 × 125.`);
  }
  const offsets = Array.isArray(tensor.data_offsets) ? tensor.data_offsets.map(Number) : [];
  const [start, end] = offsets;
  if (
    offsets.length !== 2 ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    8 + headerLength + end > buffer.length
  ) {
    throw new Error('That voice file is corrupt or incomplete.');
  }
  return { headerLength, bytes: buffer.length };
}

function customVoiceEntries() {
  const entries = readJson(CUSTOM_VOICES_FILE(), []);
  return Array.isArray(entries) ? entries : [];
}

function listCustomVoices() {
  const valid = [];
  for (const entry of customVoiceEntries()) {
    if (!entry || typeof entry !== 'object' || !/^c_[a-f0-9]{12}$/.test(String(entry.id || ''))) continue;
    const filePath = path.join(CUSTOM_VOICES_DIR(), `${entry.id}.safetensors`);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      valid.push({
        id: entry.id,
        name: voiceDisplayName(entry.name),
        source: entry.source === 'clone' ? 'clone' : 'import',
        language: CLONE_LANGUAGES.includes(entry.language) ? entry.language : 'en',
        createdAt: Number(entry.createdAt) || 0,
        bytes: stat.size,
        fileName: path.basename(filePath),
        sha256: typeof entry.sha256 === 'string' ? entry.sha256 : '',
      });
    } catch {
      // A missing file simply means the voice is gone; it will be dropped on the next save.
    }
  }
  return valid.sort((a, b) => b.createdAt - a.createdAt);
}

async function saveCustomVoice(buffer, { name, source, language, consentAt } = {}) {
  const info = readVoiceSafetensors(buffer);
  const entries = customVoiceEntries();
  const id = `c_${crypto.randomBytes(6).toString('hex')}`;
  fs.mkdirSync(CUSTOM_VOICES_DIR(), { recursive: true });
  await fsp.writeFile(path.join(CUSTOM_VOICES_DIR(), `${id}.safetensors`), buffer);

  const base = voiceDisplayName(name, source === 'clone' ? 'My voice' : 'Imported voice');
  const taken = new Set(entries.map((entry) => String(entry.name || '').toLowerCase()));
  let finalName = base;
  let suffix = 2;
  while (taken.has(finalName.toLowerCase())) {
    finalName = `${base} (${suffix})`;
    suffix += 1;
  }

  const entry = {
    id,
    name: finalName,
    source: source === 'clone' ? 'clone' : 'import',
    language: CLONE_LANGUAGES.includes(language) ? language : 'en',
    createdAt: Date.now(),
    bytes: info.bytes,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
  if (entry.source === 'clone') {
    entry.consentAt = Number.isFinite(Number(consentAt)) ? Number(consentAt) : Date.now();
  }
  // Drop metadata for files that no longer exist while saving.
  const alive = entries.filter((item) => {
    try {
      return fs.statSync(path.join(CUSTOM_VOICES_DIR(), `${item.id}.safetensors`)).isFile();
    } catch {
      return false;
    }
  });
  await writeJsonAtomic(CUSTOM_VOICES_FILE(), [entry, ...alive]);
  return { ...entry, fileName: `${id}.safetensors` };
}

async function removeCustomVoice(id) {
  if (!/^c_[a-f0-9]{12}$/.test(String(id || ''))) return false;
  const entries = customVoiceEntries();
  const entry = entries.find((item) => item.id === id);
  if (!entry) return false;
  await fsp.rm(path.join(CUSTOM_VOICES_DIR(), `${id}.safetensors`), { force: true });
  await writeJsonAtomic(
    CUSTOM_VOICES_FILE(),
    entries.filter((item) => item.id !== id),
  );
  return true;
}

function readCloneKey() {
  const stored = readJson(CLONE_KEY_FILE(), null);
  if (!stored || typeof stored.data !== 'string') return '';
  try {
    const raw = Buffer.from(stored.data, 'base64');
    if (stored.encrypted) {
      if (!safeStorage.isEncryptionAvailable()) return '';
      return safeStorage.decryptString(raw).trim();
    }
    return raw.toString('utf8').trim();
  } catch {
    return '';
  }
}

async function writeCloneKey(key) {
  if (!key) {
    await fsp.rm(CLONE_KEY_FILE(), { force: true });
    return;
  }
  const encrypted = safeStorage.isEncryptionAvailable();
  const data = encrypted ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8');
  await writeJsonAtomic(CLONE_KEY_FILE(), {
    v: 1,
    encrypted,
    data: data.toString('base64'),
  });
}

function cloneKeyStatus() {
  return {
    hasKey: Boolean(readCloneKey()),
    encrypted: safeStorage.isEncryptionAvailable(),
  };
}

function gradiumError(body, response) {
  const detail = body?.detail ?? body?.error ?? body?.message;
  if (typeof detail === 'string' && detail.trim()) return `Gradium: ${detail.trim()}`;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => (typeof item === 'string' ? item : item?.msg))
      .filter(Boolean);
    if (parts.length) return `Gradium: ${parts.join('; ')}`;
  }
  return `Gradium API error ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cloneVoiceWithGradium({ audio, name, language, startS, consentAt }) {
  const apiKey = readCloneKey();
  if (!apiKey) {
    return { ok: false, code: 'no-key', error: 'Add a Gradium API key to clone a voice.' };
  }
  const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio || []);
  if (buffer.length < 4096) {
    return { ok: false, error: 'The recording is too short. Record at least a few seconds of speech.' };
  }
  const lang = CLONE_LANGUAGES.includes(language) ? language : 'en';
  const start = Number.isFinite(Number(startS)) ? Math.max(0, Number(startS)) : 0;

  const progress = (stage, message, extra = {}) => send('clone:progress', { stage, message, ...extra });

  progress('upload', 'Uploading your recording to Gradium…');
  const form = new FormData();
  form.append('name', voiceDisplayName(name, 'My voice'));
  form.append('language', lang);
  form.append('start_s', String(start));
  form.append('audio_file', new Blob([buffer], { type: 'audio/wav' }), 'recording.wav');

  let created;
  try {
    created = await fetch(`${GRADIUM_API}/voices/`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: form,
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    return { ok: false, error: `Gradium could not be reached. ${error instanceof Error ? error.message : ''}`.trim() };
  }
  const createdBody = await created.json().catch(() => null);
  if (!created.ok) return { ok: false, error: gradiumError(createdBody, created) };
  const voiceUid = createdBody?.uid;
  if (!voiceUid) return { ok: false, error: createdBody?.error || 'Gradium did not return a voice id.' };

  progress('wait', 'Gradium is building the voice embedding…');
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(attempt === 0 ? 600 : 2000);
    let response;
    try {
      response = await fetch(`${GRADIUM_API}/voices/embeddings/${encodeURIComponent(voiceUid)}/default`, {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      continue;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: 'Gradium rejected the API key. Check it in Settings.' };
      }
      continue;
    }
    const body = await response.json().catch(() => null);
    if (body?.found) {
      ready = true;
      break;
    }
  }
  if (!ready) {
    return {
      ok: false,
      error: 'Gradium is still preparing this voice. Try again in a minute — it is saved in your Gradium account.',
    };
  }

  progress('download', 'Downloading the voice file…');
  let blobResponse;
  try {
    blobResponse = await fetch(
      `${GRADIUM_API}/voices/embeddings/${encodeURIComponent(voiceUid)}/default/blob?as_safetensors=1`,
      { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(60000) },
    );
  } catch (error) {
    return { ok: false, error: `The voice file could not be downloaded. ${error instanceof Error ? error.message : ''}`.trim() };
  }
  if (!blobResponse.ok) {
    const body = await blobResponse.json().catch(() => null);
    return { ok: false, error: gradiumError(body, blobResponse) };
  }
  const voiceBuffer = Buffer.from(await blobResponse.arrayBuffer());
  try {
    readVoiceSafetensors(voiceBuffer);
  } catch (error) {
    return { ok: false, error: `Gradium returned an unexpected voice file. ${error instanceof Error ? error.message : ''}`.trim() };
  }
  const saved = await saveCustomVoice(voiceBuffer, { name, source: 'clone', language: lang, consentAt });
  progress('done', 'Voice ready.', { voiceId: saved.id });
  return { ok: true, voice: saved };
}

function applyWindowTheme(win, theme) {  if (!win || win.isDestroyed()) return;
  const dark = theme !== 'light';
  win.setBackgroundColor(dark ? '#080a0f' : '#f2f3f7');
  try {
    win.setTitleBarOverlay({
      color: dark ? '#0b0d12' : '#f2f3f7',
      symbolColor: dark ? '#cfd6e6' : '#3b4152',
      height: 44,
    });
  } catch {
    // Older runtimes without custom titlebar overlays simply keep the default chrome.
  }
}

function appIconPath() {
  const candidates = [
    path.join(__dirname, '..', 'dist', 'icon.png'),
    path.join(__dirname, '..', 'public', 'icon.png'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[1];
}

function createWindow() {
  const saved = readJson(WINDOW_FILE(), null);
  let bounds = saved && Number.isFinite(saved.width) ? saved : null;
  const dark = getSettings().theme !== 'light';
  if (bounds) {
    const visible = screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      return (
        bounds.x < area.x + area.width &&
        bounds.x + bounds.width > area.x &&
        bounds.y < area.y + area.height &&
        bounds.y + bounds.height > area.y
      );
    });
    if (!visible) bounds = null;
  }
  const windowOptions = {
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: dark ? '#080a0f' : '#f2f3f7',
    title: 'Voxarium',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: dark ? '#0b0d12' : '#f2f3f7',
      symbolColor: dark ? '#cfd6e6' : '#3b4152',
      height: 44,
    },
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
    ...(bounds ? { ...bounds } : {}),
  };
  const win = new BrowserWindow(windowOptions);
  mainWindow = win;

  win.once('ready-to-show', () => {
    win.show();
  });

  const saveBounds = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
    writeJsonAtomic(WINDOW_FILE(), win.getBounds()).catch(() => {});
  };
  win.on('resize', debounce(saveBounds, 400));
  win.on('move', debounce(saveBounds, 400));

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = IS_DEV ? url.startsWith(DEV_URL) : url.startsWith('app://bundle');
    if (!allowed) {
      event.preventDefault();
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  if (IS_DEV) {
    win.loadURL(DEV_URL);
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  } else {
    win.loadURL('app://bundle/index.html');
  }
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New script',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('menu:action', { action: 'new-script' }),
        },
        {
          label: 'Import text file…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('menu:action', { action: 'import-text' }),
        },
        {
          label: 'Import voice file…',
          click: () => send('menu:action', { action: 'import-voice' }),
        },
        {
          label: 'Clone a voice…',
          click: () => send('menu:action', { action: 'clone-voice' }),
        },
        { type: 'separator' },
        {
          label: 'Open audio folder',
          click: () => shell.openPath(DIRS().audio),
        },
        {
          label: 'Open model folder',
          click: () => shell.openPath(DIRS().models),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Studio', accelerator: 'CmdOrCtrl+1', click: () => send('menu:action', { action: 'go', page: 'studio' }) },
        { label: 'Voices', accelerator: 'CmdOrCtrl+2', click: () => send('menu:action', { action: 'go', page: 'voices' }) },
        { label: 'History', accelerator: 'CmdOrCtrl+3', click: () => send('menu:action', { action: 'go', page: 'history' }) },
        { label: 'Batch', accelerator: 'CmdOrCtrl+4', click: () => send('menu:action', { action: 'go', page: 'batch' }) },
        { label: 'Settings', accelerator: 'CmdOrCtrl+5', click: () => send('menu:action', { action: 'go', page: 'settings' }) },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(IS_DEV ? [{ role: 'toggleDevTools' }, { role: 'reload' }] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Phonon model card',
          click: () => shell.openExternal('https://huggingface.co/gradium/phonon-31m-en'),
        },
        {
          label: 'Phonon by Gradium',
          click: () => shell.openExternal('https://gradium.ai/phonon'),
        },
        {
          label: 'Runtime source',
          click: () => shell.openExternal('https://github.com/gradium-ai/xn-ptts'),
        },
        { type: 'separator' },
        {
          label: 'Open data folder',
          click: () => shell.openPath(DIRS().data),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function registerAppProtocol() {
  const dist = path.join(__dirname, '..', 'dist');
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'bundle') return new Response('Not found', { status: 404 });
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    let filePath = path.join(dist, pathname);
    if (!isInside(dist, filePath) && path.resolve(filePath) !== path.resolve(dist)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      if (!path.extname(filePath)) filePath = path.join(dist, 'index.html');
      else return new Response('Not found', { status: 404 });
    }
    let data;
    try {
      data = await fsp.readFile(filePath);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = new Headers({
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': String(data.byteLength),
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-resource-policy': 'cross-origin',
      'cache-control': 'no-cache',
    });
    if (ext === '.html') headers.set('content-security-policy', CSP);
    return new Response(request.method === 'HEAD' ? null : data, { status: 200, headers });
  });
}

function registerIpc() {
  const dirs = DIRS();

  ipcMain.handle('app:info', async () => {
    const model = getModel(activeModelId());
    return {
      version: app.getVersion(),
      name: app.getName(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      isDev: IS_DEV,
      paths: dirs,
      serverUrl: modelServer ? modelServer.url : null,
      model: {
        id: model.id,
        name: model.name,
        repo: model.repo,
        revision: model.revision,
        runtime: model.runtime,
        license: model.license.id,
        voicesRepo: VOICES_REPO,
        voicesRevision: VOICES_REVISION,
        files: Object.fromEntries(
          model.files.map((file) => [file.name, { size: file.size, required: file.required, quality: file.quality }]),
        ),
      },
    };
  });

  ipcMain.handle('app:keepAwake', (event, on) => {
    try {
      if (on) {
        if (!global.__keepAwakeId) {
          global.__keepAwakeId = powerSaveBlocker.start('prevent-display-sleep');
        }
      } else if (global.__keepAwakeId) {
        powerSaveBlocker.stop(global.__keepAwakeId);
        global.__keepAwakeId = null;
      }
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('app:openExternal', async (event, url) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('app:restart', async () => {
    app.relaunch();
    app.quit();
    return true;
  });

  ipcMain.handle('gpu:info', async () => {
    const preference = getSettings().gpuPreference || 'auto';
    let devices = [];
    let featureStatus = {};
    try {
      const info = await app.getGPUInfo('complete');
      devices = Array.isArray(info?.gpuDevice) ? info.gpuDevice : [];
      featureStatus = info?.featureStatus && typeof info.featureStatus === 'object' ? info.featureStatus : {};
    } catch (error) {
      console.warn('[voxarium] GPU info unavailable', error);
    }
    return {
      preference,
      platform: process.platform,
      active: devices.find((device) => device?.active)?.deviceString || '',
      devices,
      featureStatus,
    };
  });

  ipcMain.handle('gpu:openSettings', async () => {
    if (process.platform !== 'win32') return false;
    try {
      await shell.openExternal('ms-settings:display-advancedgraphics');
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('settings:get', async () => getSettings());
  ipcMain.handle('settings:save', async (event, patch) => {
    if (!patch || typeof patch !== 'object') return getSettings();
    const next = await saveSettings(patch);
    if (patch.theme) applyWindowTheme(BrowserWindow.fromWebContents(event.sender), patch.theme);
    return next;
  });

  ipcMain.handle('models:snapshot', async (event, options = {}) => modelsSnapshot({ forceHardware: Boolean(options?.forceHardware) }));

  ipcMain.handle('models:hardware', async () => {
    const profile = await hardware(true);
    return profile;
  });

  ipcMain.handle('models:download', async (event, { id, quality } = {}) => {
    initModelServices();
    const model = getModel(id || activeModelId());
    const fit = await hardware();
    if (fit.freeDiskGb != null && fit.freeDiskGb < model.hardware.diskGb * 1.1) {
      return {
        ok: false,
        error: `Not enough free disk space: ${model.hardware.diskGb} GB is needed and ${fit.freeDiskGb} GB is free.`,
      };
    }
    const result = await downloadModelFiles(model.id, quality === 'f32' ? 'f32' : 'q8');
    notifyModels();
    return result;
  });

  ipcMain.handle('models:cancel', async () => {
    await modelManager?.cancel();
    return true;
  });

  ipcMain.handle('models:verify', async (event, { id } = {}) => {
    initModelServices();
    const result = await modelManager.verify(id || activeModelId());
    notifyModels();
    return result;
  });

  ipcMain.handle('models:uninstall', async (event, { id } = {}) => {
    initModelServices();
    if (sidecars) await sidecars.stop(id || activeModelId());
    const status = await modelManager.uninstall(id || activeModelId());
    notifyModels();
    return { ok: true, status };
  });

  ipcMain.handle('models:activate', async (event, { id } = {}) => {
    initModelServices();
    const model = getModel(id);
    const status = modelManager.status(model.id);
    if (!status.installed) {
      return { ok: false, error: `${model.shortName} is not installed yet.` };
    }
    if (!model.runtimePack.available) {
      const runtime = modelRuntime(model);
      if (!runtime.ready) {
        return { ok: false, code: 'runtime', error: runtime.reason || `${model.shortName} needs its runtime pack before it can run.` };
      }
    }
    if (requiresLicenseAck(model) && !modelState.acknowledged(model.id)) {
      return { ok: false, error: `Acknowledge the ${model.license.name} before activating ${model.shortName}.` };
    }
    if (sidecars) await sidecars.stopAll();
    await modelState.setActive(model.id);
    await saveSettings({ activeModelId: model.id });
    notifyModels();
    return { ok: true, snapshot: await modelsSnapshot() };
  });

  ipcMain.handle('models:acknowledge', async (event, { id } = {}) => {
    initModelServices();
    const model = getModel(id);
    await modelState.acknowledge(model.id);
    notifyModels();
    return { ok: true, license: model.license, acknowledgedAt: Date.now() };
  });

  ipcMain.handle('models:import', async (event, { id } = {}) => {
    initModelServices();
    const model = getModel(id || activeModelId());
    if (requiresLicenseAck(model) && !modelState.acknowledged(model.id)) {
      return { ok: false, code: 'license', error: `Acknowledge the ${model.license.name} before importing ${model.shortName}.` };
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Locate ${model.shortName} files`,
      message: `Select a folder containing ${model.files.map((file) => file.name).join(', ')}`,
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    const imported = await modelManager.importFolder(model.id, result.filePaths[0]);
    if (imported.ok) notifyModels();
    return imported;
  });

  ipcMain.handle('models:openFolder', async (event, { id, target = 'model' } = {}) => {
    initModelServices();
    const model = getModel(id || activeModelId());
    const dir = target === 'staging' ? path.join(DIRS().models, '.staging', model.id) : path.join(DIRS().models, model.id);
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return true;
  });

  ipcMain.handle('models:sidecar:start', async (event, { id } = {}) => {
    initModelServices();
    return sidecars.start(getModel(id || activeModelId()).id);
  });
  ipcMain.handle('models:sidecar:stop', async (event, { id } = {}) => {
    initModelServices();
    return { ok: await sidecars.stop(getModel(id || activeModelId()).id) };
  });
  ipcMain.handle('models:sidecar:status', async (event, { id } = {}) => {
    initModelServices();
    return sidecars.status(getModel(id || activeModelId()).id);
  });
  ipcMain.handle('models:sidecar:logs', async (event, { id } = {}) => {
    initModelServices();
    return sidecars.logs(getModel(id || activeModelId()).id);
  });

  ipcMain.handle('runtimes:download', async (event, { id } = {}) => {
    initModelServices();
    const pack = runtimeManager.getPack(id);
    if (!pack) return { ok: false, error: 'Unknown runtime pack.' };
    const fit = await hardware();
    const neededGb = (Number(pack.installedBytes || pack.sizeBytes || 0) * 1.2) / 1_000_000_000;
    if (fit.freeDiskGb != null && fit.freeDiskGb < neededGb) {
      return {
        ok: false,
        error: `Not enough free disk space: ${pack.name} needs about ${neededGb.toFixed(1)} GB and ${fit.freeDiskGb.toFixed(1)} GB are free.`,
      };
    }
    const result = await runtimeManager.download(pack.id);
    notifyModels();
    return result;
  });

  ipcMain.handle('runtimes:cancel', async () => {
    await runtimeManager?.cancel();
    return true;
  });

  ipcMain.handle('runtimes:verify', async (event, { id } = {}) => {
    initModelServices();
    const result = await runtimeManager.verify(id);
    notifyModels();
    return result;
  });

  ipcMain.handle('runtimes:uninstall', async (event, { id } = {}) => {
    initModelServices();
    const pack = runtimeManager.getPack(id);
    if (!pack) return { ok: false, error: 'Unknown runtime pack.' };
    if (sidecars) {
      const running = sidecars.statusAll().filter((status) => status.state === 'ready' || status.state === 'starting');
      for (const status of running) {
        const model = getModel(status.modelId);
        if (model.runtimePack?.packId === pack.id || (pack.requires || []).includes(model.runtimePack?.packId)) {
          await sidecars.stop(model.id);
        }
      }
    }
    const result = await runtimeManager.uninstall(pack.id);
    notifyModels();
    return result;
  });

  ipcMain.handle('runtimes:import', async (event, { id } = {}) => {
    initModelServices();
    const pack = runtimeManager.getPack(id);
    if (!pack) return { ok: false, error: 'Unknown runtime pack.' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Locate the ${pack.name} folder`,
      message: `Select the folder that contains ${Object.values(pack.entry || {}).join(' and ') || 'the runtime entry point'}.`,
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    const imported = await runtimeManager.importFolder(pack.id, result.filePaths[0]);
    if (imported.ok) notifyModels();
    return imported;
  });

  ipcMain.handle('runtimes:openFolder', async (event, { id } = {}) => {
    initModelServices();
    const pack = runtimeManager.getPack(id);
    if (!pack) return false;
    const dir = path.join(DIRS().runtimes, pack.id);
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return true;
  });

  ipcMain.handle('model:status', async () => modelStatus());
  ipcMain.handle('model:download', async (event, { quality } = {}) =>
    downloadModelFiles(activeModelId(), quality === 'f32' ? 'f32' : 'q8'),
  );
  ipcMain.handle('model:cancel', async () => {
    activeDownload?.controller.abort();
    await modelManager?.cancel();
    return true;
  });
  ipcMain.handle('model:clear', async () => {
    initModelServices();
    const status = await modelManager.uninstall(activeModelId());
    notifyModels();
    return { ...modelStatus(), ...status };
  });
  ipcMain.handle('model:verify', async () => {
    initModelServices();
    const result = await modelManager.verify(activeModelId());
    notifyModels();
    return { ...modelStatus(), mismatched: result.mismatched };
  });
  ipcMain.handle('model:import', async (event) => {
    initModelServices();
    const model = getModel(activeModelId());
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Locate Phonon model files',
      message: 'Select a folder containing config.json, tokenizer.json and model.q8.gguf',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    const imported = await modelManager.importFolder(model.id, result.filePaths[0]);
    if (!imported.ok) return imported;
    const hasF32 = model.files.some((file) => file.quality === 'f32' && imported.found.includes(file.name));
    const hasQ8 = model.files.some((file) => file.quality === 'q8' && imported.found.includes(file.name));
    await saveSettings({ quality: hasQ8 || !hasF32 ? 'q8' : 'f32', setupComplete: true });
    notifyModels();
    return { ...imported, status: modelStatus() };
  });

  ipcMain.handle('voices:download', async (event, { id } = {}) => {
    if (activeDownload) return { ok: false, error: 'Another download is already running.' };
    const controller = new AbortController();
    activeDownload = { controller, kind: 'voices' };
    try {
      const result = await ensureVoiceFile(id, {
        signal: controller.signal,
        onProgress: (progress) =>
          broadcastProgress({
            kind: 'voice',
            file: progress.file,
            voiceId: id,
            loaded: progress.loaded,
            total: progress.total,
            percent: progress.total ? (progress.loaded / progress.total) * 100 : null,
          }),
      });
      broadcastProgress({ kind: 'voice', voiceId: id, completed: true, percent: 100, done: true });
      return { ok: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      broadcastProgress({ kind: 'voice', voiceId: id, error: message, done: true });
      return { ok: false, error: message };
    } finally {
      activeDownload = null;
    }
  });
  ipcMain.handle('voices:downloadAll', async (event, { ids } = {}) => {
    if (activeDownload) return { ok: false, error: 'Another download is already running.' };
    const list = Array.isArray(ids) ? ids : [];
    if (!list.length) return { ok: false, error: 'No voices requested.' };
    const result = await downloadVoices(list);
    broadcastProgress({ kind: 'voice', done: true });
    return result;
  });
  ipcMain.handle('voices:cancel', async () => {
    activeDownload?.controller.abort();
    return true;
  });
  ipcMain.handle('voices:clear', async () => {
    // Only catalog voice files live directly in the voices folder; custom voices are in
    // voices/custom and must survive "clear downloaded voices".
    fs.mkdirSync(DIRS().voices, { recursive: true });
    for (const name of fs.readdirSync(DIRS().voices)) {
      if (!name.endsWith('.safetensors')) continue;
      await fsp.rm(path.join(DIRS().voices, name), { force: true });
    }
    return modelStatus();
  });

  ipcMain.handle('voices:listCustom', async () => listCustomVoices());

  ipcMain.handle('voices:importCustom', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import a Phonon voice',
      message: 'Choose a .safetensors voice file downloaded from Gradium Studio.',
      properties: ['openFile'],
      filters: [
        { name: 'Phonon voice', extensions: ['safetensors'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    const source = result.filePaths[0];
    let buffer;
    try {
      buffer = await fsp.readFile(source);
      readVoiceSafetensors(buffer);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const existing = listCustomVoices().find((voice) => voice.sha256 === sha256);
    if (existing) return { ok: true, duplicate: true, voice: existing };
    const base = path.basename(source, path.extname(source)).replace(/[-_]+/g, ' ');
    try {
      const voice = await saveCustomVoice(buffer, { name: base, source: 'import' });
      return { ok: true, voice };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('voices:renameCustom', async (event, { id, name } = {}) => {
    if (!/^c_[a-f0-9]{12}$/.test(String(id || ''))) return { ok: false, error: 'Unknown voice.' };
    const entries = customVoiceEntries();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) return { ok: false, error: 'Unknown voice.' };
    const clean = voiceDisplayName(name);
    if (!clean) return { ok: false, error: 'Give the voice a name.' };
    const clash = entries.some(
      (entry, position) => position !== index && String(entry.name || '').toLowerCase() === clean.toLowerCase(),
    );
    if (clash) return { ok: false, error: 'Another voice already has that name.' };
    entries[index] = { ...entries[index], name: clean };
    await writeJsonAtomic(CUSTOM_VOICES_FILE(), entries);
    return { ok: true, voice: listCustomVoices().find((voice) => voice.id === id) || null };
  });

  ipcMain.handle('voices:deleteCustom', async (event, { id } = {}) => {
    const ok = await removeCustomVoice(id);
    return { ok, voices: listCustomVoices() };
  });

  ipcMain.handle('clone:keyStatus', async () => cloneKeyStatus());
  ipcMain.handle('clone:setKey', async (event, { key } = {}) => {
    const clean = String(key || '').trim();
    if (clean && !/^[A-Za-z0-9._-]{8,200}$/.test(clean)) {
      return { ok: false, error: 'That does not look like a Gradium API key.', ...cloneKeyStatus() };
    }
    await writeCloneKey(clean);
    return { ok: true, ...cloneKeyStatus() };
  });
  ipcMain.handle('clone:create', async (event, { audio, name, language, startS, consentAt } = {}) => {
    try {
      if (!Number.isFinite(Number(consentAt))) {
        return { ok: false, error: 'Confirm the speaker permission checkbox before cloning a voice.' };
      }
      return await cloneVoiceWithGradium({ audio, name, language, startS, consentAt: Number(consentAt) });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('history:list', async () => readJson(HISTORY_FILE(), []));
  ipcMain.handle('history:upsert', async (event, entry) => {
    if (!entry || typeof entry !== 'object' || !entry.id) throw new Error('Invalid history entry');
    const history = readJson(HISTORY_FILE(), []);
    const clean = {
      ...entry,
      title: String(entry.title || '').slice(0, 300),
      text: String(entry.text || '').slice(0, 50000),
      voiceName: String(entry.voiceName || '').slice(0, 120),
      stats: entry.stats && typeof entry.stats === 'object' ? entry.stats : null,
    };
    const index = history.findIndex((item) => item.id === clean.id);
    if (index >= 0) history[index] = clean;
    else history.unshift(clean);
    await writeJsonAtomic(HISTORY_FILE(), history.slice(0, 2000));
    return clean;
  });
  ipcMain.handle('history:patch', async (event, { id, patch } = {}) => {
    const history = readJson(HISTORY_FILE(), []);
    const index = history.findIndex((item) => item.id === id);
    if (index < 0) return null;
    history[index] = { ...history[index], ...patch, id };
    await writeJsonAtomic(HISTORY_FILE(), history);
    return history[index];
  });
  ipcMain.handle('history:remove', async (event, { id, deleteFile = true } = {}) => {
    const history = readJson(HISTORY_FILE(), []);
    const entry = history.find((item) => item.id === id);
    if (entry?.filePath && deleteFile && isInside(DIRS().audio, entry.filePath)) {
      await fsp.rm(entry.filePath, { force: true });
    }
    await writeJsonAtomic(
      HISTORY_FILE(),
      history.filter((item) => item.id !== id),
    );
    return true;
  });
  ipcMain.handle('history:clear', async (event, { deleteFiles = true } = {}) => {
    const history = readJson(HISTORY_FILE(), []);
    if (deleteFiles) {
      for (const entry of history) {
        if (entry.filePath && isInside(DIRS().audio, entry.filePath)) {
          await fsp.rm(entry.filePath, { force: true });
        }
      }
    }
    await writeJsonAtomic(HISTORY_FILE(), []);
    return true;
  });

  ipcMain.handle('audio:save', async (event, payload) => {
    const { pcm, sampleRate = 24000, baseName = 'voxarium-audio' } = payload || {};
    const data = pcm instanceof Float32Array ? pcm : new Float32Array(pcm || []);
    if (!data.length) throw new Error('No audio to save');
    fs.mkdirSync(dirs.audio, { recursive: true });
    const destination = uniquePath(dirs.audio, sanitizeName(baseName), '.wav');
    const wav = encodeWav(data, sampleRate);
    await fsp.writeFile(destination, wav);
    return {
      filePath: destination,
      fileName: path.basename(destination),
      bytes: wav.byteLength,
      duration: data.length / sampleRate,
      sampleRate,
    };
  });
  ipcMain.handle('audio:read', async (event, { filePath } = {}) => {
    if (typeof filePath !== 'string' || !isInside(DIRS().audio, filePath)) throw new Error('Access denied');
    const buffer = await fsp.readFile(filePath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  });
  ipcMain.handle('audio:exists', async (event, { filePath } = {}) => {
    if (typeof filePath !== 'string' || !isInside(DIRS().audio, filePath)) return false;
    return fs.existsSync(filePath);
  });
  ipcMain.handle('audio:export', async (event, { sourcePath, bytes, format = 'wav', defaultName = 'voxarium-audio' } = {}) => {
    const ext = format === 'mp3' ? 'mp3' : 'wav';
    const filters =
      ext === 'mp3'
        ? [{ name: 'MP3 audio', extensions: ['mp3'] }]
        : [{ name: 'WAV audio', extensions: ['wav'] }];
    const base = sanitizeName(String(defaultName || '').replace(/\.(wav|mp3)$/i, ''), 'voxarium-audio');
    const settings = getSettings();
    const startDir = fs.existsSync(settings.outputDir) ? settings.outputDir : app.getPath('downloads');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `Export ${ext.toUpperCase()}`,
      defaultPath: path.join(startDir, `${base}.${ext}`),
      filters,
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    if (bytes) {
      await fsp.writeFile(result.filePath, Buffer.from(bytes));
    } else if (sourcePath) {
      if (!isInside(DIRS().audio, sourcePath)) throw new Error('Access denied');
      await fsp.copyFile(sourcePath, result.filePath);
    } else {
      throw new Error('Nothing to export');
    }
    return { ok: true, filePath: result.filePath };
  });
  ipcMain.handle('audio:exportMany', async (event, { files = [] } = {}) => {
    if (!Array.isArray(files) || !files.length) return { ok: false, error: 'No files to export' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder for the exported audio',
      buttonLabel: 'Export here',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    const target = result.filePaths[0];
    let count = 0;
    for (const file of files) {
      if (!file?.path || !isInside(DIRS().audio, file.path)) continue;
      const rawName = String(file.name || path.basename(file.path, '.wav')).replace(/\.wav$/i, '');
      const destination = uniquePath(target, sanitizeName(rawName), '.wav');
      await fsp.copyFile(file.path, destination);
      count += 1;
    }
    return { ok: true, directory: target, count };
  });
  ipcMain.handle('audio:reveal', async (event, { filePath } = {}) => {
    if (typeof filePath !== 'string') return false;
    if (!isInside(DIRS().audio, filePath) && !isInside(DIRS().models, filePath) && !isInside(DIRS().voices, filePath)) {
      return false;
    }
    if (!fs.existsSync(filePath)) return false;
    shell.showItemInFolder(filePath);
    return true;
  });
  ipcMain.handle('audio:open', async (event, { filePath } = {}) => {
    if (typeof filePath !== 'string' || !isInside(DIRS().audio, filePath)) return false;
    if (!fs.existsSync(filePath)) return false;
    const error = await shell.openPath(filePath);
    return !error;
  });

  ipcMain.handle('paths:reveal', async (event, { target } = {}) => {
    const dirMap = {
      data: dirs.data,
      models: dirs.models,
      voices: dirs.voices,
      audio: dirs.audio,
      output: getSettings().outputDir,
    };
    const dir = dirMap[target];
    if (!dir) return false;
    fs.mkdirSync(dir, { recursive: true });
    const error = await shell.openPath(dir);
    return !error;
  });
  ipcMain.handle('paths:chooseOutputDir', async () => {
    const settings = getSettings();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose default export folder',
      defaultPath: fs.existsSync(settings.outputDir) ? settings.outputDir : app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return settings.outputDir;
    await saveSettings({ outputDir: result.filePaths[0] });
    return result.filePaths[0];
  });

  ipcMain.handle('storage:stats', async () => storageStats());

  ipcMain.handle('ui:confirm', async (event, options = {}) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: options.danger ? 'warning' : 'question',
      title: String(options.title || 'Voxarium'),
      message: String(options.message || 'Are you sure?'),
      detail: options.detail ? String(options.detail) : undefined,
      buttons: [String(options.confirmLabel || 'Confirm'), 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    return result.response === 0;
  });
  ipcMain.handle('ui:openTextFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import text',
      properties: ['openFile'],
      filters: [
        { name: 'Text files', extensions: ['txt', 'md', 'srt', 'csv'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    const filePath = result.filePaths[0];
    const content = await fsp.readFile(filePath, 'utf8');
    return { ok: true, name: path.basename(filePath), content };
  });
  ipcMain.handle('ui:saveText', async (event, { content = '', defaultName = 'voxarium-export.txt' } = {}) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save file',
      defaultPath: path.join(getSettings().outputDir, sanitizeName(defaultName, 'voxarium-export.txt')),
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    await fsp.writeFile(result.filePath, String(content), 'utf8');
    return { ok: true, filePath: result.filePath };
  });
  ipcMain.handle('clipboard:write', async (event, text) => {
    const { clipboard } = require('electron');
    clipboard.writeText(String(text || ''));
    return true;
  });
}

function encodeWav(pcm, sampleRate) {
  const length = pcm.length;
  const buffer = Buffer.alloc(44 + length * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + length * 2, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(length * 2, 40);
  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    const sample = Math.max(-1, Math.min(1, pcm[i]));
    buffer.writeInt16LE(Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), offset);
    offset += 2;
  }
  return buffer;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Chromium picks the adapter for WebGPU at GPU-process start. High-performance is the only
  // adapter preference Chromium exposes as a switch; "low-power" is applied through
  // `requestAdapter({ powerPreference })` in the worker wrapper instead.
  if (getSettings().gpuPreference === 'high-performance') {
    app.commandLine.appendSwitch('force-high-performance-gpu');
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    migrateLegacyDataDir();
    retargetLegacyHistory();
    ensureDirs();
    app.setAppUserModelId(APP_ID);
    registerAppProtocol();
    initModelServices();
    try {
      const adopted = await adoptLegacyFiles({
        dirs: DIRS(),
        state: modelState,
        verifyFile: (file, sha) => modelManager.sha256File(file).then((hash) => hash === sha).catch(() => false),
      });
      if (adopted.files.length) notifyModels();
      modelServer = await startModelServer({
        dirs: DIRS(),
        resolveModelFile: (id, name) => modelManager.resolveFile(id, name),
        defaultModelId: getModel(null).id,
      });
      console.log(`[voxarium] local model server on ${modelServer.url}`);
    } catch (error) {
      console.error('[voxarium] failed to start model server', error);
    }
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const url = webContents?.getURL() || '';
      const trusted = IS_DEV ? url.startsWith(DEV_URL) : url.startsWith('app://bundle');
      const audioOnly =
        !details?.mediaTypes || details.mediaTypes.length === 0 || details.mediaTypes.every((type) => type === 'audio');
      // Microphone access is only used by the optional voice-cloning recorder.
      callback(Boolean(trusted && permission === 'media' && audioOnly));
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      if (permission !== 'media') return false;
      const origin = requestingOrigin || webContents?.getURL() || '';
      return IS_DEV ? origin.startsWith(DEV_URL) : origin.startsWith('app://bundle');
    });
    if (!nativeImage.createFromPath(appIconPath()).isEmpty()) {
      // The icon is also supplied per-window; this makes the taskbar group correctly.
    }
    registerIpc();
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', async (event) => {
    if ((!modelServer && !sidecars) || quitAfterServerClose) return;
    event.preventDefault();
    quitAfterServerClose = true;
    try {
      await sidecars?.cleanup();
    } catch {}
    try {
      await runtimeManager?.cancel();
    } catch {}
    try {
      await modelServer?.close();
    } catch {}
    app.quit();
  });
}
