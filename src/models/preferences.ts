import type { Settings } from '../types';
import type { ModelManifest, ModelPreferences } from './types';
import {
  arabicVarietiesFor,
  defaultArabicVariety,
  modelHasArabic,
  supportsLanguage,
  voiceCompatibleWithModel,
} from './compat';
import { allVoices } from '../data/catalog';
import { defaultQualityFor, qualitiesFor } from './registry';

/**
 * The fields that belong to a model rather than to the app as a whole. They are
 * mirrored at the top level for the active model and archived under
 * `settings.modelSettings[id]` when another model takes over.
 */
export const MODEL_PREFERENCE_KEYS = [
  'quality',
  'device',
  'threads',
  'language',
  'rewrites',
  'conditions',
  'temperature',
  'seed',
  'lastVoice',
  'streaming',
  'arabicVariety',
] as const satisfies readonly (keyof ModelPreferences)[];

export function defaultPreferences(model: ModelManifest): ModelPreferences {
  return {
    quality: model.defaults.quality,
    device: model.defaults.device,
    threads: model.defaults.threads,
    language: model.defaults.language,
    rewrites: model.defaults.rewrites,
    conditions: { num_speakers: '1', duration_delta: 0 },
    temperature: model.defaults.temperature,
    seed: model.defaults.seed,
    lastVoice: 'default',
    streaming: true,
    arabicVariety: modelHasArabic(model) ? defaultArabicVariety(model) : 'arb',
  };
}

function compatibleVoice(model: ModelManifest, id: string | undefined): string {
  if (!id || id === 'default') return 'default';
  if (model.voices.format !== 'phonon-safetensors') return 'default';
  const voice = allVoices().find((item) => item.id === id);
  if (!voice) return 'default';
  return voiceCompatibleWithModel(model, voice) ? voice.id : 'default';
}

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

/** Coerces saved preferences into what the manifest actually supports. */
export function normalizePreferences(
  model: ModelManifest,
  preferences: Partial<ModelPreferences>,
  fallback?: Partial<ModelPreferences>,
): ModelPreferences {
  const defaults = { ...defaultPreferences(model), ...fallback };
  const merged: ModelPreferences = {
    ...defaults,
    ...preferences,
    conditions: { ...defaults.conditions, ...(preferences.conditions || {}) },
  };

  const qualities = qualitiesFor(model);
  if (qualities.length) {
    merged.quality = qualities.includes(merged.quality) ? merged.quality : defaultQualityFor(model);
  } else {
    merged.quality = model.defaults.quality;
  }

  merged.language = supportsLanguage(model, merged.language) ? merged.language : model.defaults.language;
  merged.device = ['auto', 'cpu', 'webgpu'].includes(merged.device) ? merged.device : model.defaults.device;
  merged.rewrites = ['default', 'all', 'none'].includes(merged.rewrites) ? merged.rewrites : model.defaults.rewrites;
  merged.threads =
    merged.threads === 'auto'
      ? 'auto'
      : Math.round(clamp(Number(merged.threads), 1, 32, 1));
  merged.temperature = clamp(Number(merged.temperature), 0, 1, model.defaults.temperature);
  merged.seed = String(merged.seed ?? model.defaults.seed).replace(/[^\d]/g, '').slice(0, 19);
  merged.lastVoice = compatibleVoice(model, merged.lastVoice);
  merged.streaming = Boolean(merged.streaming);

  const varieties = arabicVarietiesFor(model);
  merged.arabicVariety = varieties.length
    ? varieties.some((variety) => variety.code === merged.arabicVariety)
      ? merged.arabicVariety
      : varieties[0].code
    : 'arb';

  return merged;
}

/** Preferences saved for a model, merged with its defaults and the live app fallbacks. */
export function preferencesFor(model: ModelManifest, settings: Settings): ModelPreferences {
  const stored = settings.modelSettings?.[model.id] || {};
  return normalizePreferences(model, stored, defaultPreferences(model));
}

/** The preferences currently active in the UI for the given model. */
export function currentPreferences(settings: Settings, model: ModelManifest): ModelPreferences {
  return normalizePreferences(model, {
    quality: settings.quality,
    device: settings.device,
    threads: settings.threads,
    language: settings.language,
    rewrites: settings.rewrites,
    conditions: settings.conditions,
    temperature: settings.temperature,
    seed: settings.seed,
    lastVoice: settings.lastVoice,
    streaming: settings.streaming,
    arabicVariety: settings.arabicVariety,
  });
}

/**
 * Archives the outgoing model's settings and restores the incoming model's own
 * setup. The caller writes the returned patch in one go, so a switch never
 * leaves two models sharing a half-updated settings object.
 */
export function switchModelSettings(
  settings: Settings,
  from: ModelManifest,
  to: ModelManifest,
): Partial<Settings> {
  const outgoing = currentPreferences(settings, from);
  const modelSettings = { ...(settings.modelSettings || {}), [from.id]: outgoing };
  const incoming = preferencesFor(to, { ...settings, modelSettings });
  return { ...incoming, activeModelId: to.id, modelSettings };
}

/** Keep the active model's archive in sync when a preference is edited. */
export function rememberPreferences(
  settings: Settings,
  model: ModelManifest,
  patch: Partial<Settings>,
): Partial<Settings> | null {
  const touchesModel = MODEL_PREFERENCE_KEYS.some((key) => key in patch);
  if (!touchesModel) return null;
  const nextPreferences = currentPreferences({ ...settings, ...patch } as Settings, model);
  return {
    modelSettings: { ...(settings.modelSettings || {}), [model.id]: nextPreferences },
  };
}
