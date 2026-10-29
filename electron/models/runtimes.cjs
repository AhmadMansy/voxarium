// Runtime packs: separately downloaded, hash-verified runtimes that sidecar
// models need. A pack is installed under userData/runtimes/<id>/ and never
// shares a folder with model weights. The app ships no Python interpreter, so a
// sidecar cannot start until a runtime pack provides one.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { extractArchive } = require('./archive.cjs');
const { getModel } = require('./registry.cjs');

const MARKER = '.voxarium-runtime.json';
const STATE_VERSION = 1;
const MAX_REDIRECTS = 5;

function sizeOf(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function moveAtomic(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try {
    await fsp.rename(from, to);
  } catch (error) {
    if (error && (error.code === 'EXDEV' || error.code === 'EPERM' || error.code === 'EACCES')) {
      await fsp.cp(from, to, { recursive: true, force: true });
      await fsp.rm(from, { recursive: true, force: true });
      return;
    }
    throw error;
  }
}

function loadCatalog() {
  const file = path.join(__dirname, 'runtimes.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || !Array.isArray(parsed.packs)) throw new Error('runtimes.json is malformed');
  const byId = new Map(parsed.packs.map((pack) => [pack.id, pack]));
  return { document: parsed, packs: parsed.packs, byId };
}

let catalog = null;
function getCatalog() {
  if (!catalog) catalog = loadCatalog();
  return catalog;
}

function getPack(id) {
  return getCatalog().byId.get(id) || null;
}

function runtimeDir(dirs, id) {
  return path.join(dirs.runtimes, id);
}

function stagingDir(dirs, id) {
  return path.join(dirs.runtimes, '.staging', id);
}

function entryNames(pack) {
  return Object.values(pack.entry || {}).filter((name) => typeof name === 'string' && name);
}

function entryReady(root, pack) {
  const names = entryNames(pack);
  if (!names.length) return false;
  return names.every((name) => {
    try {
      return fs.statSync(path.join(root, name)).isFile();
    } catch {
      return false;
    }
  });
}

function createRuntimeManager({
  dirs,
  appVersion,
  readJson,
  writeJsonAtomic,
  broadcast,
  log = console.log,
}) {
  const stateFile = () => path.join(dirs.data || dirs.runtimes, 'runtimes-state.json');
  let activeDownload = null;

  const emit = (payload) => {
    try {
      broadcast?.(payload);
    } catch {}
  };

  const defaultRead = (file, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  };
  const defaultWrite = async (file, value) => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fsp.rename(temp, file);
  };
  const readStateFile = readJson || defaultRead;
  const writeStateFile = writeJsonAtomic || defaultWrite;

  function readState() {
    const raw = readStateFile(stateFile(), null);
    const state = {
      version: STATE_VERSION,
      installs: {},
      ...(raw && typeof raw === 'object' ? raw : {}),
    };
    if (!state.installs || typeof state.installs !== 'object') state.installs = {};
    return state;
  }

  async function writeState(patch) {
    const next = { ...readState(), ...patch, version: STATE_VERSION, updatedAt: Date.now() };
    await writeStateFile(stateFile(), next);
    return next;
  }

  async function recordInstall(packId, patch) {
    const state = readState();
    state.installs[packId] = {
      installedAt: Date.now(),
      source: 'download',
      verifiedAt: Date.now(),
      ...(state.installs[packId] || {}),
      ...patch,
    };
    return writeState({ installs: state.installs });
  }

  async function clearInstall(packId) {
    const state = readState();
    delete state.installs[packId];
    return writeState({ installs: state.installs });
  }

  function readMarker(packId) {
    return readStateFile(path.join(runtimeDir(dirs, packId), MARKER), null);
  }

  function status(packId) {
    const pack = getPack(packId);
    if (!pack) return null;
    const root = runtimeDir(dirs, pack.id);
    const marker = readMarker(pack.id);
    const hasEntry = entryReady(root, pack);
    const installed = Boolean(marker && marker.id === pack.id && hasEntry);
    const record = readState().installs[pack.id] || {};
    return {
      id: pack.id,
      name: pack.name,
      kind: pack.kind,
      version: pack.version,
      platform: pack.platform,
      arch: pack.arch,
      description: pack.description,
      homepage: pack.homepage,
      license: pack.license,
      available: Boolean(pack.available),
      importable: pack.importable !== false,
      reason: pack.reason || null,
      entry: pack.entry || {},
      requires: pack.requires || [],
      provides: pack.provides || [],
      archive: pack.archive || null,
      sizeBytes: Number(pack.sizeBytes || pack.archive?.size || 0),
      installedBytes: Number(pack.installedBytes || 0),
      lifecycle: installed ? 'installed' : pack.available ? 'not-installed' : 'not-published',
      installed,
      bytes: installed ? Number(record.installedBytes || pack.installedBytes || 0) : 0,
      installedAt: installed ? record.installedAt || marker?.installedAt || null : null,
      verifiedAt: installed ? record.verifiedAt || marker?.verifiedAt || null : null,
      source: installed ? record.source || marker?.source || null : null,
      error: activeDownload?.packId === pack.id ? undefined : record.error || (marker && !hasEntry ? 'The installed pack is missing its entry point.' : undefined),
    };
  }

  function statusAll() {
    return getCatalog().packs.map((pack) => status(pack.id));
  }

  function modelRuntime(model) {
    const declared = model.runtimePack || {};
    if (declared.available) return { ready: true, available: true, packId: null, reason: null };
    const pack = declared.packId ? getPack(declared.packId) : null;
    if (!pack) {
      return {
        ready: false,
        available: false,
        packId: declared.packId || null,
        reason: declared.reason || 'This model has no published runtime pack yet.',
      };
    }
    const packStatus = status(pack.id);
    return {
      ready: Boolean(packStatus?.installed),
      available: Boolean(pack.available || packStatus?.installed),
      packId: pack.id,
      reason: packStatus?.installed ? null : pack.reason || declared.reason || `${pack.name} is not installed.`,
    };
  }

  function resolvePython(pack) {
    if (!pack) return null;
    const installed = status(pack.id);
    if (!installed?.installed) return null;
    const relative = pack.entry?.python;
    if (!relative) return null;
    const file = path.join(runtimeDir(dirs, pack.id), relative);
    return fs.existsSync(file) ? file : null;
  }

  function pythonFor(packId) {
    const pack = getPack(packId);
    if (!pack) return null;
    if (pack.kind === 'python') return resolvePython(pack);
    const base = (pack.requires || []).map(getPack).find((item) => item && item.kind === 'python');
    return resolvePython(base || null);
  }

  function sidecarRuntime(model) {
    const declared = model.runtimePack || {};
    const pack = declared.packId ? getPack(declared.packId) : null;
    if (!pack) {
      return { ok: false, reason: declared.reason || 'This sidecar has no published runtime pack yet.' };
    }
    const installed = status(pack.id);
    if (!installed?.installed) {
      return { ok: false, reason: pack.reason || `${pack.name} is not installed. Download or import it first.` };
    }
    const python = pythonFor(pack.id);
    if (!python) {
      return {
        ok: false,
        reason: `${pack.name} needs the Python runtime pack. Install the Python 3.12 runtime first.`,
      };
    }
    const server = pack.entry?.server ? path.join(runtimeDir(dirs, pack.id), pack.entry.server) : null;
    return {
      ok: true,
      pack,
      python,
      server: server && fs.existsSync(server) ? server : null,
      root: runtimeDir(dirs, pack.id),
      reason: null,
    };
  }

  function sourceUrl(archive) {
    return archive.url;
  }

  async function fetchWithRedirects(url, options) {
    let current = url;
    for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
      const response = await fetch(current, { ...options, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`Download redirect had no location (${response.status}).`);
        current = new URL(location, current).toString();
        continue;
      }
      return response;
    }
    throw new Error('Too many download redirects.');
  }

  async function downloadArchive(pack, signal, index, count) {
    const stage = stagingDir(dirs, pack.id);
    const archive = pack.archive;
    const partPath = path.join(stage, `${archive.name}.part`);
    const finalPath = path.join(stage, archive.name);
    await fsp.mkdir(stage, { recursive: true });

    if (fs.existsSync(finalPath) && sizeOf(finalPath) === archive.size) {
      emit({ kind: 'runtime', runtimeId: pack.id, file: archive.name, loaded: archive.size, total: archive.size, percent: 100, index, count, stage: 'verifying', cached: true, at: Date.now() });
      const hash = await sha256File(finalPath);
      if (hash === archive.sha256) return finalPath;
      await fsp.rm(finalPath, { force: true });
    }

    const headers = { 'user-agent': `Voxarium/${appVersion || '1.0.0'}` };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let offset = sizeOf(partPath);
      if (offset > archive.size) {
        await fsp.rm(partPath, { force: true });
        offset = 0;
      }
      if (offset === archive.size) {
        const hash = await sha256File(partPath);
        if (hash === archive.sha256) {
          await moveAtomic(partPath, finalPath);
          return finalPath;
        }
        await fsp.rm(partPath, { force: true });
        offset = 0;
      }

      emit({ kind: 'runtime', runtimeId: pack.id, file: archive.name, loaded: offset, total: archive.size, percent: archive.size ? (offset / archive.size) * 100 : null, index, count, stage: 'downloading', at: Date.now() });
      const response = await fetchWithRedirects(sourceUrl(archive), {
        headers: { ...headers, ...(offset > 0 ? { range: `bytes=${offset}-` } : {}) },
        signal,
      });
      if (!response.ok || !response.body) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(`${pack.name} could not be downloaded (HTTP ${response.status}). The pack may be private or rate-limited.`);
        }
        throw new Error(`Download failed (${response.status} ${response.statusText}) for ${archive.name}`);
      }
      const isRange = response.status === 206;
      if (!isRange) offset = 0;
      const handle = await fsp.open(partPath, isRange && offset > 0 ? 'a' : 'w');
      let loaded = offset;
      let lastEmit = 0;
      try {
        const reader = response.body.getReader();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (signal?.aborted) throw Object.assign(new Error('Download cancelled'), { name: 'AbortError' });
          await handle.write(chunk.value);
          loaded += chunk.value.byteLength;
          const now = Date.now();
          if (now - lastEmit > 120) {
            lastEmit = now;
            emit({ kind: 'runtime', runtimeId: pack.id, file: archive.name, loaded, total: archive.size, percent: archive.size ? Math.min(100, (loaded / archive.size) * 100) : null, index, count, stage: 'downloading', at: now });
          }
        }
      } finally {
        await handle.close().catch(() => {});
      }

      const actual = sizeOf(partPath);
      if (actual !== archive.size) {
        log(`[voxarium] ${pack.id} archive incomplete (${actual}/${archive.size}); retrying`);
        continue;
      }
      emit({ kind: 'runtime', runtimeId: pack.id, file: archive.name, loaded: actual, total: archive.size, percent: 100, index, count, stage: 'verifying', at: Date.now() });
      const hash = await sha256File(partPath);
      if (hash !== archive.sha256) {
        await fsp.rm(partPath, { force: true });
        continue;
      }
      await moveAtomic(partPath, finalPath);
      return finalPath;
    }
    throw new Error(`${pack.name} failed SHA-256 verification twice. The download may be corrupted or the pack changed.`);
  }

  async function installArchive(pack, archivePath) {
    const stage = stagingDir(dirs, pack.id);
    const extractDir = path.join(stage, 'extract');
    await fsp.rm(extractDir, { recursive: true, force: true });
    await fsp.mkdir(extractDir, { recursive: true });
    await extractArchive(archivePath, extractDir);

    if (!entryReady(extractDir, pack)) {
      throw new Error(`${pack.name} did not contain its expected entry point (${entryNames(pack).join(', ')}).`);
    }

    const marker = {
      id: pack.id,
      version: pack.version,
      archive: pack.archive ? { name: pack.archive.name, size: pack.archive.size, sha256: pack.archive.sha256 } : null,
      entry: pack.entry,
      source: 'download',
      installedAt: Date.now(),
      verifiedAt: Date.now(),
    };
    await fsp.writeFile(path.join(extractDir, MARKER), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');

    const target = runtimeDir(dirs, pack.id);
    const backup = `${target}.old-${Date.now()}`;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) {
      try {
        await fsp.rename(target, backup);
      } catch {
        await fsp.rm(target, { recursive: true, force: true });
      }
    }
    try {
      await moveAtomic(extractDir, target);
    } catch (error) {
      if (fs.existsSync(backup)) await fsp.rename(backup, target).catch(() => {});
      throw error;
    }
    await fsp.rm(backup, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
    return target;
  }

  async function download(packId) {
    if (activeDownload) return { ok: false, error: 'Another download is already running.' };
    const pack = getPack(packId);
    if (!pack) return { ok: false, error: 'Unknown runtime pack.' };
    if (!pack.available || !pack.archive) {
      return { ok: false, error: pack.reason || `${pack.name} has not been published for download yet.` };
    }
    const controller = new AbortController();
    activeDownload = { controller, packId: pack.id };
    try {
      const archivePath = await downloadArchive(pack, controller.signal, 0, 1);
      emit({ kind: 'runtime', runtimeId: pack.id, file: pack.archive.name, loaded: pack.archive.size, total: pack.archive.size, percent: 100, index: 0, count: 1, stage: 'installing', at: Date.now() });
      await installArchive(pack, archivePath);
      await recordInstall(pack.id, {
        source: 'download',
        installedBytes: pack.installedBytes || 0,
        archive: { name: pack.archive.name, size: pack.archive.size, sha256: pack.archive.sha256 },
        error: null,
      });
      emit({ kind: 'runtime', runtimeId: pack.id, file: pack.archive.name, loaded: pack.archive.size, total: pack.archive.size, percent: 100, index: 1, count: 1, stage: 'installed', done: true, at: Date.now() });
      return { ok: true, status: status(pack.id) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = controller.signal.aborted || (error && error.name === 'AbortError');
      if (!aborted) await recordInstall(pack.id, { error: message }).catch(() => {});
      emit({ kind: 'runtime', runtimeId: pack.id, file: pack.archive?.name || '', loaded: 0, total: 0, percent: null, index: 0, count: 0, stage: 'error', error: aborted ? 'Download cancelled' : message, done: true, at: Date.now() });
      return { ok: false, error: aborted ? 'Download cancelled' : message };
    } finally {
      activeDownload = null;
    }
  }

  async function cancel() {
    activeDownload?.controller.abort();
    return true;
  }

  async function verify(packId) {
    const pack = getPack(packId);
    if (!pack) return { ok: false, error: 'Unknown runtime pack.' };
    const root = runtimeDir(dirs, pack.id);
    const marker = readMarker(pack.id);
    if (!marker) return { ok: false, error: `${pack.name} is not installed.` };
    if (!entryReady(root, pack)) return { ok: false, error: `${pack.name} is missing its entry point. Reinstall or import it again.` };
    const verifiedAt = Date.now();
    const nextMarker = { ...marker, verifiedAt };
    await fsp.writeFile(path.join(root, MARKER), `${JSON.stringify(nextMarker, null, 2)}\n`, 'utf8');
    await recordInstall(pack.id, { verifiedAt, error: null, installedBytes: pack.installedBytes || marker.installedBytes || 0 });
    return { ok: true, status: status(pack.id) };
  }

  async function importFolder(packId, folder) {
    const pack = getPack(packId);
    if (!pack) return { ok: false, error: 'Unknown runtime pack.' };
    if (pack.importable === false) return { ok: false, error: `${pack.name} cannot be imported.` };
    if (!fs.existsSync(folder)) return { ok: false, error: 'That folder does not exist.' };
    if (!entryReady(folder, pack)) {
      return { ok: false, error: `That folder is not a ${pack.name} pack. It must contain ${entryNames(pack).join(', ')}.` };
    }
    const stage = stagingDir(dirs, pack.id);
    const extractDir = path.join(stage, 'extract');
    await fsp.rm(stage, { recursive: true, force: true });
    await fsp.mkdir(extractDir, { recursive: true });
    try {
      await fsp.cp(folder, extractDir, { recursive: true, force: true, dereference: true });
      if (!entryReady(extractDir, pack)) throw new Error(`${pack.name} is missing its entry point after copying.`);
      const marker = {
        id: pack.id,
        version: pack.version,
        archive: null,
        entry: pack.entry,
        source: 'import',
        installedAt: Date.now(),
        verifiedAt: Date.now(),
      };
      await fsp.writeFile(path.join(extractDir, MARKER), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
      const target = runtimeDir(dirs, pack.id);
      if (fs.existsSync(target)) await fsp.rm(target, { recursive: true, force: true });
      await moveAtomic(extractDir, target);
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
      await recordInstall(pack.id, {
        source: 'import',
        installedBytes: pack.installedBytes || 0,
        archive: null,
        error: null,
      });
      return { ok: true, status: status(pack.id) };
    } catch (error) {
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function uninstall(packId) {
    const pack = getPack(packId);
    if (!pack) return { ok: false, error: 'Unknown runtime pack.' };
    if (activeDownload?.packId === pack.id) activeDownload.controller.abort();
    await fsp.rm(runtimeDir(dirs, pack.id), { recursive: true, force: true });
    await fsp.rm(stagingDir(dirs, pack.id), { recursive: true, force: true });
    await clearInstall(pack.id);
    return { ok: true, status: status(pack.id) };
  }

  function active() {
    return activeDownload ? { packId: activeDownload.packId } : null;
  }

  return {
    packs: () => getCatalog().packs,
    getPack,
    status,
    statusAll,
    modelRuntime,
    pythonFor,
    sidecarRuntime,
    download,
    cancel,
    verify,
    importFolder,
    uninstall,
    active,
  };
}

module.exports = {
  createRuntimeManager,
  getCatalog,
  getPack,
  loadCatalog,
  runtimeDir,
  stagingDir,
  sha256File,
  sizeOf,
};
