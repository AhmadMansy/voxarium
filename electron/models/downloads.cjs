// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { getModel, modelDir, stagingDir, filesFor, loadManifests } = require('./registry.cjs');

const HF = 'https://huggingface.co';

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

/** Git blob SHA-1, which Hugging Face publishes for files that are not stored in LFS. */
function gitSha1File(filePath, size) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    hash.update(`blob ${size}\0`);
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * The pinned digest for a file: SHA-256 for LFS files, git SHA-1 for small git
 * files, or the git id of the LFS pointer when a gated repo hides the SHA-256.
 */
function pinOf(file) {
  if (file.sha256) return file.sha256;
  if (file.gitSha1) return `git:${file.gitSha1}`;
  if (file.lfsPointerSha1) return `lfs-pointer:${file.lfsPointerSha1}`;
  return '';
}

/** Rebuilds the Git LFS pointer for a file and returns its git blob SHA-1. */
function lfsPointerSha1(sha256, size) {
  const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256}\nsize ${size}\n`;
  return crypto.createHash('sha1').update(`blob ${Buffer.byteLength(pointer)}\0`).update(pointer).digest('hex');
}

async function hashMatches(file, filePath) {
  if (file.sha256) return (await sha256File(filePath)) === file.sha256;
  if (file.gitSha1) return (await gitSha1File(filePath, file.size)) === file.gitSha1;
  if (file.lfsPointerSha1) return lfsPointerSha1(await sha256File(filePath), file.size) === file.lfsPointerSha1;
  return false;
}

async function moveAtomic(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try {
    await fsp.rename(from, to);
  } catch (error) {
    if (error && (error.code === 'EXDEV' || error.code === 'EPERM')) {
      await fsp.copyFile(from, to);
      await fsp.rm(from, { force: true });
      return;
    }
    throw error;
  }
}

function createModelManager({ dirs, appVersion, state, broadcast, getToken = () => '', log = console.log }) {
  let activeDownload = null;

  const emit = (payload) => {
    try {
      broadcast?.(payload);
    } catch {}
  };

  const cachedFile = (modelId, name) => {
    const install = state.read().installs?.[modelId];
    return install?.files?.[name] || null;
  };

  function inspectFile(model, modelId, file, { verifiedOnly = false } = {}) {
    const finalPath = path.join(modelDir(dirs, modelId), file.name);
    const bytes = sizeOf(finalPath);
    // Some repos ship empty files (e.g. __init__.py), so a size of 0 alone is not proof.
    const exists = bytes === Number(file.size) && (bytes > 0 || fs.existsSync(finalPath));
    const cached = cachedFile(modelId, file.name);
    const verified = Boolean(exists && cached && cached.bytes === bytes && cached.sha256 === pinOf(file));
    return {
      ...file,
      exists,
      bytes,
      verified: verifiedOnly ? verified : exists,
      path: finalPath,
    };
  }

  function status(modelId) {
    const model = getModel(modelId);
    const files = {};
    let baseReady = model.files.length > 0;
    let bytes = 0;
    const qualities = [];
    for (const file of model.files) {
      const inspected = inspectFile(model, model.id, file);
      files[file.name] = inspected;
      if (inspected.exists) bytes += inspected.bytes;
      if (file.required && !inspected.exists) baseReady = false;
      if (file.quality && inspected.exists) qualities.push(file.quality);
    }
    const installed = Boolean(baseReady && qualities.length);
    const install = state.read().installs?.[model.id] || null;
    return {
      id: model.id,
      lifecycle: installed ? 'installed' : 'not-installed',
      installed,
      baseReady,
      qualities,
      files,
      bytes,
      installedAt: install?.installedAt || null,
      verifiedAt: install?.verifiedAt || null,
      synthesisCheck: install?.synthesisCheck || null,
      source: install?.source || null,
      error: activeDownload?.modelId === model.id ? undefined : install?.error,
    };
  }

  function statusAll() {
    return loadManifests().models.map((model) => status(model.id));
  }

  function sourceUrl(model, name) {
    if (!model.revision) throw new Error(`${model.shortName} has no pinned revision.`);
    const encoded = name.split('/').map(encodeURIComponent).join('/');
    return `${HF}/${model.repo}/resolve/${model.revision}/${encoded}`;
  }

  async function downloadOne(model, file, quality, index, count, signal) {
    const finalPath = path.join(modelDir(dirs, model.id), file.name);
    const stage = stagingDir(dirs, model.id);
    const partPath = path.join(stage, `${file.name}.part`);
    await fsp.mkdir(path.dirname(partPath), { recursive: true });

    if (fs.existsSync(finalPath) && sizeOf(finalPath) === file.size) {
      const cached = cachedFile(model.id, file.name);
      if (cached && cached.sha256 === pinOf(file) && cached.bytes === file.size) {
        emit({ kind: 'model', modelId: model.id, file: file.name, loaded: file.size, total: file.size, percent: 100, index, count, stage: 'installed', quality, cached: true, at: Date.now() });
        return { cached: true };
      }
      const ok = await hashMatches(file, finalPath).catch(() => false);
      if (ok) {
        emit({ kind: 'model', modelId: model.id, file: file.name, loaded: file.size, total: file.size, percent: 100, index, count, stage: 'verifying', quality, cached: true, at: Date.now() });
        return { cached: true, verified: true };
      }
      log(`[voxarium] ${model.id}/${file.name} failed verification; downloading again`);
      await fsp.rm(finalPath, { force: true });
    }

    const baseHeaders = { 'user-agent': `Voxarium/${appVersion || '1.0.0'}` };
    let attempt = 0;
    for (;;) {
      attempt += 1;
      let offset = sizeOf(partPath);
      if (offset > file.size) {
        await fsp.rm(partPath, { force: true });
        offset = 0;
      }
      if (offset === file.size && fs.existsSync(partPath)) {
        if (await hashMatches(file, partPath)) {
          await moveAtomic(partPath, finalPath);
          return { cached: false, verified: true };
        }
        await fsp.rm(partPath, { force: true });
        offset = 0;
      }

      emit({ kind: 'model', modelId: model.id, file: file.name, loaded: offset, total: file.size, percent: file.size ? (offset / file.size) * 100 : null, index, count, stage: 'downloading', quality, at: Date.now() });
      const headers = { ...baseHeaders };
      if (offset > 0) headers.range = `bytes=${offset}-`;
      // Only sent to huggingface.co; fetch drops it on the cross-origin CDN redirect.
      const token = String(getToken() || '').trim();
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await fetch(sourceUrl(model, file.name), { headers, signal });
      if (!response.ok || !response.body) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            token
              ? `Hugging Face refused the download (HTTP ${response.status}). Open ${HF}/${model.repo}, accept the license with the account that owns your token, then try again.`
              : `${model.shortName} is gated on Hugging Face. Accept its license at ${HF}/${model.repo}, then add a Hugging Face access token in Settings › Models and try again.`,
          );
        }
        throw new Error(`Download failed (${response.status} ${response.statusText}) for ${file.name}`);
      }
      const isRange = response.status === 206;
      const append = isRange && offset > 0;
      if (!append) offset = 0;
      const contentLength = Number(response.headers.get('content-length')) || 0;
      const total = contentLength ? offset + contentLength : file.size;
      const handle = await fsp.open(partPath, append ? 'a' : 'w');
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
            emit({ kind: 'model', modelId: model.id, file: file.name, loaded, total: Math.max(total, file.size), percent: file.size ? Math.min(100, (loaded / file.size) * 100) : null, index, count, stage: 'downloading', quality, at: now });
          }
        }
      } finally {
        await handle.close().catch(() => {});
      }

      const actual = sizeOf(partPath);
      if (actual !== file.size) {
        if (attempt < 2) {
          log(`[voxarium] ${model.id}/${file.name} incomplete (${actual}/${file.size}); retrying`);
          continue;
        }
        throw new Error(`Incomplete download for ${file.name} (${actual} of ${file.size} bytes)`);
      }

      emit({ kind: 'model', modelId: model.id, file: file.name, loaded: actual, total: file.size, percent: 100, index, count, stage: 'verifying', quality, at: Date.now() });
      if (!(await hashMatches(file, partPath))) {
        await fsp.rm(partPath, { force: true });
        if (attempt < 2) {
          log(`[voxarium] ${model.id}/${file.name} failed hash verification; downloading again`);
          continue;
        }
        throw new Error(`${file.name} failed hash verification twice. The download may be corrupted or the mirror changed.`);
      }
      await moveAtomic(partPath, finalPath);
      return { cached: false, verified: true };
    }
  }

  async function download(modelId, quality) {
    if (activeDownload) return { ok: false, error: 'Another model download is already running.' };
    const model = getModel(modelId);
    if (!model.files.length) {
      return { ok: false, error: model.runtimePack.reason || 'This model has no verified files to download.' };
    }
    const wanted = model.files.filter((file) => file.required || file.quality === quality);
    if (!wanted.length) return { ok: false, error: `No ${quality} weights are pinned for ${model.shortName}.` };
    if (quality && !model.files.some((file) => file.quality === quality)) {
      return { ok: false, error: `${model.shortName} does not use ${quality} weights.` };
    }
    const controller = new AbortController();
    activeDownload = { controller, modelId: model.id, quality };
    try {
      const verified = {};
      for (let index = 0; index < wanted.length; index += 1) {
        const file = wanted[index];
        const result = await downloadOne(model, file, quality, index, wanted.length, controller.signal);
        verified[file.name] = { bytes: file.size, sha256: pinOf(file), verified: true, ...result };
      }
      const previous = state.read().installs?.[model.id] || {};
      await state.recordInstall(model.id, {
        source: previous.source || 'download',
        files: { ...(previous.files || {}), ...verified },
        error: null,
      });
      emit({ kind: 'model', modelId: model.id, file: '', loaded: wanted.reduce((total, file) => total + file.size, 0), total: wanted.reduce((total, file) => total + file.size, 0), percent: 100, index: wanted.length, count: wanted.length, stage: 'installed', quality, done: true, at: Date.now() });
      return { ok: true, status: status(model.id) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = controller.signal.aborted || (error && error.name === 'AbortError');
      if (!aborted) {
        await state.recordInstall(model.id, { error: message }).catch(() => {});
      }
      emit({ kind: 'model', modelId: model.id, file: '', loaded: 0, total: 0, percent: null, index: 0, count: 0, stage: 'error', quality, error: aborted ? 'Download cancelled' : message, done: true, at: Date.now() });
      return { ok: false, error: aborted ? 'Download cancelled' : message };
    } finally {
      activeDownload = null;
    }
  }

  async function cancel() {
    activeDownload?.controller.abort();
    return true;
  }

  async function uninstall(modelId) {
    if (activeDownload?.modelId === modelId) activeDownload.controller.abort();
    const model = getModel(modelId);
    await fsp.rm(modelDir(dirs, model.id), { recursive: true, force: true });
    await fsp.rm(stagingDir(dirs, model.id), { recursive: true, force: true });
    await state.clearInstall(model.id);
    return status(model.id);
  }

  async function verify(modelId) {
    const model = getModel(modelId);
    const mismatched = [];
    const entries = {};
    for (const file of model.files) {
      const filePath = path.join(modelDir(dirs, model.id), file.name);
      const size = sizeOf(filePath);
      if (!size) continue;
      if (size !== file.size) {
        mismatched.push(file.name);
        continue;
      }
      emit({ kind: 'model', modelId: model.id, file: file.name, loaded: size, total: size, percent: 100, index: 0, count: model.files.length, stage: 'verifying', at: Date.now() });
      if (!(await hashMatches(file, filePath))) mismatched.push(file.name);
      else entries[file.name] = { bytes: size, sha256: pinOf(file), verified: true };
    }
    if (!mismatched.length) {
      const previous = state.read().installs?.[model.id] || {};
      await state.recordInstall(model.id, { files: { ...(previous.files || {}), ...entries }, error: null, verifiedAt: Date.now() });
    }
    return { status: status(model.id), mismatched };
  }

  async function importFolder(modelId, folder) {
    const model = getModel(modelId);
    if (!model.files.length) return { ok: false, error: 'This model has no importable files pinned yet.' };
    const stage = stagingDir(dirs, model.id);
    await fsp.rm(stage, { recursive: true, force: true });
    await fsp.mkdir(stage, { recursive: true });
    const found = [];
    const verified = {};
    try {
      for (const file of model.files) {
        const from = path.join(folder, file.name);
        if (!fs.existsSync(from)) continue;
        const to = path.join(stage, file.name);
        await fsp.mkdir(path.dirname(to), { recursive: true });
        await fsp.copyFile(from, to);
        const bytes = sizeOf(to);
        if (bytes !== file.size) {
          throw new Error(`${file.name} has ${bytes} bytes; ${file.size} are expected.`);
        }
        emit({ kind: 'model', modelId: model.id, file: file.name, loaded: bytes, total: bytes, percent: 100, index: found.length, count: model.files.length, stage: 'verifying', at: Date.now() });
        if (!(await hashMatches(file, to))) throw new Error(`${file.name} does not match its pinned hash.`);
        found.push(file.name);
        verified[file.name] = { bytes, sha256: pinOf(file), verified: true };
      }
      if (!found.length) throw new Error('That folder does not contain any of the pinned model files.');
      const baseNames = model.files.filter((file) => file.required).map((file) => file.name);
      const missingBase = baseNames.filter((name) => !found.includes(name));
      if (missingBase.length) throw new Error(`That folder is missing ${missingBase.join(', ')}.`);
      if (!model.files.some((file) => file.quality && found.includes(file.name))) {
        throw new Error('That folder has no weights file.');
      }
      const target = modelDir(dirs, model.id);
      await fsp.mkdir(target, { recursive: true });
      for (const name of found) await moveAtomic(path.join(stage, name), path.join(target, name));
      const previous = state.read().installs?.[model.id] || {};
      await state.recordInstall(model.id, { source: 'import', files: { ...(previous.files || {}), ...verified }, error: null, verifiedAt: Date.now() });
      return { ok: true, found, status: status(model.id) };
    } catch (error) {
      await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function resolveFile(modelId, name) {
    const model = getModel(modelId);
    if (!model.files.some((file) => file.name === name)) return null;
    const finalPath = path.join(modelDir(dirs, model.id), name);
    if (fs.existsSync(finalPath)) return finalPath;
    return null;
  }

  function active() {
    return activeDownload ? { modelId: activeDownload.modelId, quality: activeDownload.quality } : null;
  }

  return { status, statusAll, download, cancel, uninstall, verify, importFolder, resolveFile, active, sha256File };
}

module.exports = { createModelManager, sha256File, gitSha1File, hashMatches, lfsPointerSha1, pinOf, sizeOf };
