// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { loadManifests, getModel } = require('./registry.cjs');

const STATE_VERSION = 1;

function createModelState({ dataDir, dirs, readJson, writeJsonAtomic }) {
  const stateFile = () => path.join(dataDir, 'models-state.json');

  function read() {
    const raw = readJson(stateFile(), null);
    const { defaultModelId } = loadManifests();
    const state = {
      version: STATE_VERSION,
      activeModelId: defaultModelId,
      licenses: {},
      installs: {},
      updatedAt: 0,
      ...(raw && typeof raw === 'object' ? raw : {}),
    };
    if (state.activeModelId !== getModel(state.activeModelId).id) state.activeModelId = defaultModelId;
    if (!state.licenses || typeof state.licenses !== 'object') state.licenses = {};
    if (!state.installs || typeof state.installs !== 'object') state.installs = {};
    return state;
  }

  async function write(next) {
    const state = { ...read(), ...next, version: STATE_VERSION, updatedAt: Date.now() };
    await writeJsonAtomic(stateFile(), state);
    return state;
  }

  return {
    stateFile,
    read,
    write,
    activeModelId: () => read().activeModelId,
    async setActive(modelId) {
      return write({ activeModelId: getModel(modelId).id });
    },
    acknowledged(modelId) {
      const state = read();
      const ack = state.licenses[modelId];
      const model = getModel(modelId);
      return Boolean(ack && ack.licenseId === model.license.id);
    },
    async acknowledge(modelId) {
      const state = read();
      const model = getModel(modelId);
      state.licenses[modelId] = {
        id: modelId,
        licenseId: model.license.id,
        acknowledgedAt: Date.now(),
      };
      return write({ licenses: state.licenses });
    },
    async recordInstall(modelId, patch) {
      const state = read();
      state.installs[modelId] = {
        installedAt: Date.now(),
        source: 'download',
        verifiedAt: Date.now(),
        ...(state.installs[modelId] || {}),
        ...patch,
      };
      return write({ installs: state.installs });
    },
    async clearInstall(modelId) {
      const state = read();
      delete state.installs[modelId];
      return write({ installs: state.installs });
    },
    async loadInstalls() {
      return read().installs;
    },
  };
}

/** Moves legacy flat Phonon 31M files into models/phonon-31m-en/. */
async function adoptLegacyFiles({ dirs, state, verifyFile, log = console.log }) {
  const target = path.join(dirs.models, 'phonon-31m-en');
  const model = getModel('phonon-31m-en');
  const names = model.files.map((file) => file.name);
  const present = names.filter((name) => {
    try {
      return fs.statSync(path.join(dirs.models, name)).size > 0;
    } catch {
      return false;
    }
  });
  if (!present.length) return { adopted: false, files: [] };

  await fsp.mkdir(path.join(target), { recursive: true });
  const adopted = [];
  for (const name of present) {
    const from = path.join(dirs.models, name);
    const to = path.join(target, name);
    try {
      if (fs.existsSync(to)) continue;
      const declared = model.files.find((file) => file.name === name);
      if (declared && fs.statSync(from).size === declared.size) {
        const ok = await verifyFile(from, declared.sha256);
        if (!ok) {
          log(`[voxarium] legacy ${name} does not match its pinned hash; leaving it in place`);
          continue;
        }
      }
      try {
        await fsp.rename(from, to);
      } catch {
        await fsp.copyFile(from, to);
        await fsp.rm(from, { force: true });
      }
      adopted.push(name);
    } catch (error) {
      log(`[voxarium] could not adopt legacy ${name}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (adopted.length) {
    await state.recordInstall('phonon-31m-en', { source: 'legacy' });
    log(`[voxarium] adopted ${adopted.length} legacy Phonon 31M files`);
  }
  return { adopted: adopted.length > 0, files: adopted };
}

module.exports = { createModelState, adoptLegacyFiles };
