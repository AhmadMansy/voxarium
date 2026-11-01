// SPDX-License-Identifier: AGPL-3.0-or-later
// Generic loopback-only sidecar supervisor. Each sidecar model runs from its
// runtime pack (a venv built from a pinned recipe) with the bundled adapter.
// The supervisor owns the per-session token, health/readiness polling, the log
// ring and guaranteed shutdown. Servers bind to 127.0.0.1 only. A model's first
// start may fetch auxiliary assets; once it has prepared, it runs offline.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { getModel, modelDir } = require('./registry.cjs');

const LOG_LIMIT = 600;
const READY_TIMEOUT_MS = 60_000;
// Loading can be slow: large checkpoints on CPU, and the first run also fetches
// auxiliary assets (vocoders, tokenizers) before switching to offline mode.
const LOAD_TIMEOUT_MS = 30 * 60_000;
const PREPARE_TIMEOUT_MS = 90 * 60_000;
const PREPARED_MARKER = '.voxarium-prepared';
// Variables from the user's own Python setup must not leak into a pack.
const SCRUBBED_ENV = ['PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP', 'VIRTUAL_ENV', 'CONDA_PREFIX', 'CONDA_DEFAULT_ENV', 'PIP_REQUIRE_VIRTUALENV'];

const ENTRY_NAMES = ['start.py', 'main.py', 'server.py'];

function bundledServer(modelId) {
  const root = path.join(__dirname, '..', 'sidecars', modelId);
  for (const name of ENTRY_NAMES) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) return candidate;
    // electron-builder unpacks sidecar scripts next to app.asar because a
    // Python interpreter cannot read files from inside the asar virtual FS.
    const unpacked = candidate.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    if (unpacked !== candidate && fs.existsSync(unpacked)) return unpacked;
  }
  return null;
}

function entryFor(dirs, modelId, runtimes) {
  const model = getModel(modelId);
  const resolved = runtimes ? runtimes.sidecarRuntime(model) : null;
  if (resolved && !resolved.ok) return { model, root: null, entry: null, python: null, error: resolved.reason };
  if (!resolved) {
    return {
      model,
      root: null,
      entry: null,
      python: null,
      error: `${model.shortName} needs a runtime pack, and the runtime manager is unavailable.`,
    };
  }

  const candidates = [resolved.server, bundledServer(model.id)];
  const modelSidecar = path.join(modelDir(dirs, model.id), 'sidecar');
  for (const name of ENTRY_NAMES) candidates.push(path.join(modelSidecar, name));
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return { model, root: path.dirname(candidate), entry: candidate, python: resolved.python, pack: resolved.pack, error: null };
    }
  }
  return {
    model,
    root: modelSidecar,
    entry: null,
    python: resolved.python,
    pack: resolved.pack,
    error: null,
  };
}

function sidecarEnv({ base, model, dir, token, prepared, hfToken, pythonDir, pack }) {
  const env = { ...base };
  for (const name of SCRUBBED_ENV) delete env[name];
  const cache = path.join(dir, '.cache');
  Object.assign(env, {
    PATH: `${pythonDir}${path.delimiter}${base.PATH || ''}`,
    VOXARIUM_SIDECAR_TOKEN: token,
    VOXARIUM_MODEL_ID: model.id,
    VOXARIUM_RUNTIME_PACK: pack?.id || '',
    VOXARIUM_LOOPBACK_ONLY: '1',
    VOXARIUM_PARENT_PID: String(process.pid),
    PYTHONUNBUFFERED: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    // Every cache a model library might write lives inside the model folder, so
    // uninstalling the model removes it too.
    HF_HOME: path.join(cache, 'huggingface'),
    HF_HUB_CACHE: path.join(cache, 'huggingface', 'hub'),
    HF_HUB_DISABLE_TELEMETRY: '1',
    HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
    TORCH_HOME: path.join(cache, 'torch'),
    MODELSCOPE_CACHE: path.join(cache, 'modelscope'),
    XDG_CACHE_HOME: cache,
    NLTK_DATA: path.join(cache, 'nltk'),
    TOKENIZERS_PARALLELISM: 'false',
    DO_NOT_TRACK: '1',
  });
  if (prepared) {
    // After the first successful load everything is local; stay offline.
    env.HF_HUB_OFFLINE = '1';
    env.TRANSFORMERS_OFFLINE = '1';
    env.HF_DATASETS_OFFLINE = '1';
  }
  if (hfToken && !prepared) env.HF_TOKEN = hfToken;
  else delete env.HF_TOKEN;
  return env;
}

function createSidecarSupervisor({ dirs, send, runtimes, getSettings = () => ({}), logger = console }) {
  /** @type {Map<string, any>} */
  const running = new Map();
  /** @type {Map<string, {stream: string, line: string, at: number}[]>} */
  const logs = new Map();

  const pushLog = (modelId, stream, line) => {
    const entry = { stream, line: String(line).slice(0, 4000), at: Date.now() };
    const list = logs.get(modelId) || [];
    list.push(entry);
    if (list.length > LOG_LIMIT) list.splice(0, list.length - LOG_LIMIT);
    logs.set(modelId, list);
    try {
      send?.('sidecar:log', { modelId, ...entry });
    } catch {}
  };

  function isPrepared(modelId) {
    return fs.existsSync(path.join(modelDir(dirs, modelId), PREPARED_MARKER));
  }

  function status(modelId) {
    const entry = running.get(modelId);
    if (!entry) {
      return { modelId, state: 'stopped', url: null, token: null, pid: null, prepared: isPrepared(modelId) };
    }
    return {
      modelId,
      state: entry.state,
      // The URL and token are only handed out once the model can serve requests.
      url: entry.port && entry.state === 'ready' ? `http://127.0.0.1:${entry.port}` : null,
      token: entry.state === 'ready' ? entry.token : null,
      pid: entry.child.pid || null,
      error: entry.error,
      stage: entry.stage,
      device: entry.device,
      prepared: isPrepared(modelId),
      startedAt: entry.startedAt,
    };
  }

  function statusAll() {
    return require('./registry.cjs').loadManifests().models.map((model) => status(model.id));
  }

  function logTail(modelId, count = 6) {
    return (logs.get(modelId) || [])
      .filter((item) => item.stream !== 'system')
      .slice(-count)
      .map((item) => item.line)
      .join('\n');
  }

  const starting = new Map();

  async function start(modelId, options = {}) {
    const existing = running.get(modelId);
    if (existing && existing.state === 'ready') return { ok: true, status: status(modelId) };
    if (starting.has(modelId)) return starting.get(modelId);
    const task = startFresh(modelId, options).finally(() => starting.delete(modelId));
    starting.set(modelId, task);
    return task;
  }

  async function startFresh(modelId, options) {
    const { model, root, entry, python, pack, error } = entryFor(dirs, modelId, runtimes);
    if (error) return { ok: false, error };
    if (!python) {
      return { ok: false, error: `${model.shortName} has no Python environment. Install its runtime from the Models page.` };
    }
    if (!entry) {
      return { ok: false, error: `${model.shortName} has no sidecar server in ${root || 'its runtime pack'}. Reinstall the runtime from the Models page.` };
    }

    const settings = getSettings() || {};
    const dir = modelDir(dirs, model.id);
    const prepared = isPrepared(model.id);
    const device = options.device || (settings.modelSettings?.[model.id]?.device === 'cpu' || (model.id === settings.activeModelId && settings.device === 'cpu') ? 'cpu' : 'auto');
    const token = crypto.randomBytes(32).toString('hex');
    const args = ['-u', entry, '--host', '127.0.0.1', '--port', '0', '--model-dir', dir, '--device', device];
    if (dirs.voices) args.push('--references-dir', path.join(dirs.voices, 'references'));
    if (!prepared) args.push('--prepare');
    const child = spawn(python, args, {
      cwd: root,
      windowsHide: true,
      env: sidecarEnv({ base: process.env, model, dir, token, prepared, hfToken: settings.hfToken, pythonDir: path.dirname(python), pack }),
      // The server watches VOXARIUM_PARENT_PID and exits when Voxarium goes away.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const record = {
      child,
      token,
      port: null,
      state: 'starting',
      stage: prepared ? 'Starting' : 'First start: fetching extra assets and running a test generation',
      device,
      error: null,
      startedAt: Date.now(),
      buffer: { stdout: '', stderr: '' },
    };
    running.set(model.id, record);
    pushLog(model.id, 'system', `sidecar starting (pid ${child.pid || '?'}${prepared ? '' : ', first run'})`);
    send?.('sidecar:status', status(model.id));

    let resolvePort;
    let rejectPort;
    const portReady = new Promise((resolve, reject) => {
      resolvePort = resolve;
      rejectPort = reject;
    });
    let exited = false;

    const onLine = (stream, line) => {
      if (!line) return;
      pushLog(model.id, stream, line);
      if (line.startsWith('VOXARIUM_READY')) {
        try {
          const payload = JSON.parse(line.slice('VOXARIUM_READY'.length).trim() || '{}');
          const port = Number(payload.port);
          if (Number.isInteger(port) && port > 0 && port < 65536) {
            record.port = port;
            resolvePort?.();
          }
        } catch {}
      }
    };

    const capture = (stream) => (chunk) => {
      const text = `${record.buffer[stream]}${chunk.toString('utf8')}`;
      const lines = text.split(/\r?\n|\r/);
      record.buffer[stream] = lines.pop() || '';
      for (const line of lines) onLine(stream, line);
    };
    child.stdout.on('data', capture('stdout'));
    child.stderr.on('data', capture('stderr'));
    child.on('error', (spawnError) => {
      record.state = 'error';
      record.error = spawnError.message;
      pushLog(model.id, 'system', `sidecar failed: ${spawnError.message}`);
      send?.('sidecar:status', status(model.id));
      rejectPort?.(spawnError);
    });
    child.on('exit', (code) => {
      exited = true;
      for (const stream of ['stdout', 'stderr']) {
        if (record.buffer[stream]) onLine(stream, record.buffer[stream]);
        record.buffer[stream] = '';
      }
      if (record.state !== 'stopped') {
        record.state = 'error';
        record.error = record.error || (code ? `The ${model.shortName} sidecar exited with code ${code}.` : `The ${model.shortName} sidecar stopped.`);
      }
      pushLog(model.id, 'system', `sidecar exited${code == null ? '' : ` (code ${code})`}`);
      rejectPort?.(new Error(record.error || 'The sidecar exited.'));
      if (running.get(model.id) === record) running.delete(model.id);
      send?.('sidecar:status', status(model.id));
    });

    const fail = async (message) => {
      record.state = 'error';
      const tail = logTail(model.id);
      record.error = tail && !message.includes(tail) ? `${message}\n${tail}` : message;
      await stop(model.id, { keepError: true }).catch(() => {});
      return { ok: false, error: record.error };
    };

    try {
      await Promise.race([
        portReady,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`The ${model.shortName} sidecar did not open its port in time.`)), READY_TIMEOUT_MS)),
      ]);
    } catch (portError) {
      return fail(portError instanceof Error ? portError.message : String(portError));
    }

    // The server answers /health while it loads; wait until the model is ready.
    const deadline = Date.now() + (prepared ? LOAD_TIMEOUT_MS : PREPARE_TIMEOUT_MS);
    while (Date.now() < deadline && !exited && record.state === 'starting') {
      try {
        const response = await fetch(`http://127.0.0.1:${record.port}/health`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const health = await response.json();
          if (health.error) return fail(`${model.shortName} could not load: ${health.error}`);
          if (health.stage && health.stage !== record.stage) {
            record.stage = health.stage;
            send?.('sidecar:status', status(model.id));
          }
          if (health.ready) {
            record.state = 'ready';
            record.device = health.device || record.device;
            record.stage = 'Ready';
            pushLog(model.id, 'system', `sidecar ready on 127.0.0.1:${record.port} (${record.device})`);
            send?.('sidecar:status', status(model.id));
            return { ok: true, status: status(model.id) };
          }
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    if (record.state === 'stopped') return { ok: false, error: 'The sidecar was stopped while it was starting.' };
    if (exited) return fail(record.error || `The ${model.shortName} sidecar exited while loading.`);
    return fail(`${model.shortName} did not finish loading in time.`);
  }

  async function stop(modelId, { keepError = false } = {}) {
    const record = running.get(modelId);
    if (!record) return true;
    if (!keepError) record.state = 'stopped';
    try {
      record.child.kill();
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2500);
        record.child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } catch {}
    running.delete(modelId);
    pushLog(modelId, 'system', 'sidecar stopped');
    send?.('sidecar:status', status(modelId));
    return true;
  }

  async function stopAll() {
    await Promise.all([...running.keys()].map((modelId) => stop(modelId)));
  }

  function logsFor(modelId) {
    return logs.get(modelId) || [];
  }

  async function request(modelId, route, body, { signal } = {}) {
    const record = running.get(modelId);
    if (!record || record.state !== 'ready' || !record.port) throw new Error('The sidecar is not running.');
    const response = await fetch(`http://127.0.0.1:${record.port}${route}`, {
      method: body == null ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${record.token}`,
        ...(body == null ? {} : { 'content-type': 'application/json' }),
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`Sidecar request failed (${response.status}).`);
    return response;
  }

  async function cleanup() {
    await stopAll();
  }

  return { start, stop, stopAll, status, statusAll, logs: logsFor, request, cleanup };
}

module.exports = { createSidecarSupervisor };
