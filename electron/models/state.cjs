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

module.exports = { createModelState };
