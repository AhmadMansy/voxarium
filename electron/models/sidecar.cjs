// Generic loopback-only sidecar supervisor. Model-specific runtime packs live
// outside the app and are opt-in; this build ships the supervisor, health check,
// token handling, log ring and guaranteed shutdown. Nothing here opens a port on
// a public interface or talks to the network.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { getModel, modelDir } = require('./registry.cjs');

const LOG_LIMIT = 600;
const READY_TIMEOUT_MS = 60_000;

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

function createSidecarSupervisor({ dirs, send, runtimes, logger = console }) {
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

  function status(modelId) {
    const entry = running.get(modelId);
    if (!entry) {
      return { modelId, state: 'stopped', url: null, token: null, pid: null };
    }
    return {
      modelId,
      state: entry.state,
      url: entry.port ? `http://127.0.0.1:${entry.port}` : null,
      token: entry.token,
      pid: entry.child.pid || null,
      error: entry.error,
      startedAt: entry.startedAt,
    };
  }

  function statusAll() {
    return require('./registry.cjs').loadManifests().models.map((model) => status(model.id));
  }

  async function start(modelId) {
    const existing = running.get(modelId);
    if (existing && existing.state !== 'error') return { ok: true, status: status(modelId) };
    const { model, root, entry, python, pack, error } = entryFor(dirs, modelId, runtimes);
    if (error) return { ok: false, error };
    if (!python) {
      return {
        ok: false,
        error: `${model.shortName} needs the Python runtime pack. Download or import it from the Models page first.`,
      };
    }
    if (!entry) {
      return {
        ok: false,
        error: `${model.shortName} has no sidecar server in ${root || 'its runtime pack'}. Publish or import a sidecar runtime pack that contains ${ENTRY_NAMES[0]}.`,
      };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const pythonDir = path.dirname(python);
    const child = spawn(python, ['-u', entry, '--host', '127.0.0.1', '--port', '0', '--model-dir', modelDir(dirs, model.id)], {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${pythonDir}${path.delimiter}${process.env.PATH || ''}`,
        VOXARIUM_SIDECAR_TOKEN: token,
        VOXARIUM_MODEL_ID: model.id,
        VOXARIUM_RUNTIME_PACK: pack?.id || '',
        VOXARIUM_LOOPBACK_ONLY: '1',
        PYTHONUNBUFFERED: '1',
        PYTHONNOUSERSITE: '1',
        PIP_DISABLE_PIP_VERSION_CHECK: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const record = {
      child,
      token,
      port: null,
      state: 'starting',
      error: null,
      startedAt: Date.now(),
      buffer: '',
    };
    running.set(model.id, record);
    pushLog(model.id, 'system', `sidecar starting (pid ${child.pid || '?'})`);
    send?.('sidecar:status', status(model.id));

    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const onLine = (stream, line) => {
      if (!line) return;
      pushLog(model.id, stream, line);
      if (line.startsWith('VOXARIUM_READY')) {
        try {
          const payload = JSON.parse(line.slice('VOXARIUM_READY'.length).trim() || '{}');
          const port = Number(payload.port);
          if (Number.isInteger(port) && port > 0 && port < 65536) {
            record.port = port;
            resolveReady?.();
          }
        } catch {}
      }
    };

    const capture = (stream) => (chunk) => {
      const text = `${record.buffer}${chunk.toString('utf8')}`;
      const lines = text.split(/\r?\n/);
      record.buffer = lines.pop() || '';
      for (const line of lines) onLine(stream, line);
    };
    child.stdout.on('data', capture('stdout'));
    child.stderr.on('data', capture('stderr'));
    child.on('error', (error) => {
      record.state = 'error';
      record.error = error.message;
      record.buffer = '';
      pushLog(model.id, 'system', `sidecar failed: ${error.message}`);
      send?.('sidecar:status', status(model.id));
      rejectReady?.(error);
    });
    child.on('exit', (code) => {
      if (record.buffer) onLine('stdout', record.buffer);
      record.state = record.state === 'error' ? 'error' : 'stopped';
      record.error = record.error || (code ? `Sidecar exited with code ${code}.` : undefined);
      record.buffer = '';
      pushLog(model.id, 'system', `sidecar exited${code == null ? '' : ` (code ${code})`}`);
      running.delete(model.id);
      send?.('sidecar:status', status(model.id));
    });

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`The ${model.shortName} sidecar did not report a port in time.`)), READY_TIMEOUT_MS);
    });

    try {
      await Promise.race([ready, timeout]);
    } catch (error) {
      record.state = 'error';
      record.error = error instanceof Error ? error.message : String(error);
      await stop(model.id).catch(() => {});
      return { ok: false, error: record.error };
    }

    // The pack must answer its own health probe before we claim it is ready.
    const startedAt = Date.now();
    while (Date.now() - startedAt < 20_000) {
      try {
        const response = await fetch(`http://127.0.0.1:${record.port}/health`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok) {
          record.state = 'ready';
          pushLog(model.id, 'system', `sidecar ready on 127.0.0.1:${record.port}`);
          send?.('sidecar:status', status(model.id));
          return { ok: true, status: status(model.id) };
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    record.state = 'error';
    record.error = 'The sidecar did not pass its health check.';
    await stop(model.id).catch(() => {});
    return { ok: false, error: record.error };
  }

  async function stop(modelId) {
    const record = running.get(modelId);
    if (!record) return true;
    record.state = 'stopped';
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
