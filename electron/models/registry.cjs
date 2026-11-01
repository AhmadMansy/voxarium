// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('node:fs');
const path = require('node:path');

let cached = null;

function loadManifests() {
  if (cached) return cached;
  const file = path.join(__dirname, 'manifests.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || !Array.isArray(parsed.models)) throw new Error('manifests.json is malformed');
  const byId = new Map(parsed.models.map((model) => [model.id, model]));
  if (!byId.has(parsed.defaultModelId)) throw new Error('manifests.json has no default model');
  cached = {
    document: parsed,
    models: parsed.models,
    byId,
    defaultModelId: parsed.defaultModelId,
  };
  return cached;
}

function getModel(id) {
  const { byId, defaultModelId } = loadManifests();
  return byId.get(id) || byId.get(defaultModelId);
}

function modelDir(dirs, id) {
  return path.join(dirs.models, id);
}

function stagingDir(dirs, id) {
  return path.join(dirs.models, '.staging', id);
}

/** Files needed to run a model at a chosen precision. */
function filesFor(id, quality) {
  const model = getModel(id);
  return model.files.filter((file) => file.required || !quality || file.quality === quality);
}

function hasPinnedFiles(id) {
  const model = getModel(id);
  return model.files.length > 0 && model.files.every((file) => /^[a-f0-9]{64}$/i.test(file.sha256 || ''));
}

module.exports = {
  loadManifests,
  getModel,
  modelDir,
  stagingDir,
  filesFor,
  hasPinnedFiles,
};
