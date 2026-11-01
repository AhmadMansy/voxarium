// SPDX-License-Identifier: AGPL-3.0-or-later
import manifestData from '../../electron/models/manifests.json';
import type { ManifestDocument, ModelInstallState, ModelManifest } from './types';
import type { ModelFileState } from './types';

export const manifests = manifestData as unknown as ManifestDocument;
export const MODELS: ModelManifest[] = [...manifests.models].sort((a, b) => a.order - b.order);
export const DEFAULT_MODEL_ID = manifests.defaultModelId;
export const MODEL_BY_ID = new Map(MODELS.map((model) => [model.id, model]));
export const MODEL_IDS = MODELS.map((model) => model.id);

export function getModel(id: string | null | undefined): ModelManifest {
  return MODEL_BY_ID.get(id || '') || MODEL_BY_ID.get(DEFAULT_MODEL_ID) || MODELS[0];
}

export function modelFiles(model: ModelManifest, quality?: QualityLike): ModelManifest['files'] {
  return model.files.filter((file) => file.required || !quality || file.quality === quality);
}

type QualityLike = 'q8' | 'f32';

export function qualitiesFor(model: ModelManifest): QualityLike[] {
  const qualities: QualityLike[] = [];
  for (const file of model.files) {
    if (file.quality && !qualities.includes(file.quality)) qualities.push(file.quality);
  }
  return qualities;
}

export function defaultQualityFor(model: ModelManifest): QualityLike {
  const qualities = qualitiesFor(model);
  if (qualities.includes(model.defaults.quality)) return model.defaults.quality;
  return qualities[0] || 'q8';
}

export function installState(model: ModelManifest, state?: ModelInstallState | null): ModelInstallState {
  if (state) return state;
  const files: Record<string, ModelFileState> = {};
  for (const file of model.files) {
    files[file.name] = {
      ...file,
      exists: false,
      bytes: 0,
      verified: false,
      path: '',
    };
  }
  return {
    id: model.id,
    lifecycle: 'not-installed',
    installed: false,
    baseReady: false,
    qualities: [],
    files,
    bytes: 0,
    installedAt: null,
    verifiedAt: null,
    source: null,
  };
}
