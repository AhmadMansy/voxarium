import type { Quality } from '../types';
import type { ModelCapabilities, ModelLanguage, ModelManifest } from './types';
import { getModel, qualitiesFor } from './registry';
import { DEFAULT_VOICE_ID, VOICES, getModelVoices } from '../data/catalog';
import type { VoiceInfo } from '../types';

/** All Arabic varieties named in the expansion plan, MSA first. */
export const ARABIC_VARIETIES: { code: string; name: string }[] = [
  { code: 'arb', name: 'Modern Standard Arabic' },
  { code: 'arq', name: 'Algerian Arabic' },
  { code: 'ars', name: 'Najdi Arabic' },
  { code: 'ary', name: 'Moroccan Arabic' },
  { code: 'arz', name: 'Egyptian Arabic' },
  { code: 'acm', name: 'Mesopotamian Arabic' },
  { code: 'aeb', name: 'Tunisian Arabic' },
  { code: 'afb', name: 'Gulf Arabic' },
  { code: 'apc', name: 'North Levantine Arabic' },
  { code: 'apd', name: 'Sudanese Arabic' },
  { code: 'avl', name: 'Eastern Egyptian Arabic' },
  { code: 'ayl', name: 'Libyan Arabic' },
  { code: 'ayp', name: 'North Mesopotamian Arabic' },
  { code: 'shu', name: 'Chadian Arabic' },
];

export function isArabicLanguage(language: ModelLanguage): boolean {
  return Boolean(language.arabic || language.code === 'ar' || language.code.startsWith('ar-'));
}

export function modelHasArabic(model: ModelManifest): boolean {
  return model.languages.some(isArabicLanguage);
}

/**
 * OmniVoice is the only selected model with per-variety Arabic data. Every other
 * Arabic-capable model gets MSA only, per the plan's "do not overclaim" rule.
 */
export function arabicVarietiesFor(model: ModelManifest): { code: string; name: string }[] {
  if (!modelHasArabic(model)) return [];
  if (model.id === 'omnivoice') return ARABIC_VARIETIES;
  return [{ code: 'arb', name: 'Modern Standard Arabic' }];
}

export function defaultArabicVariety(model: ModelManifest): string {
  return arabicVarietiesFor(model)[0]?.code || 'arb';
}

export function supportsLanguage(model: ModelManifest, code: string | null | undefined): boolean {
  if (!code || code === 'none') return true;
  if (model.languages.some((language) => language.code === code)) return true;
  if (code === 'ar' || code === 'arb') return modelHasArabic(model);
  return false;
}

export function languageLabel(model: ModelManifest, code: string | null | undefined): string {
  if (!code) return 'No language';
  const language = model.languages.find((item) => item.code === code);
  return language?.name || code;
}

export function resolveLanguage(model: ModelManifest, code: string | null | undefined): string {
  if (supportsLanguage(model, code)) return code || model.defaults.language;
  return model.defaults.language;
}

export function qualityOptions(model: ModelManifest): { id: Quality; label: string; note: string; bytes: number }[] {
  const available = qualitiesFor(model);
  const all: { id: Quality; label: string; note: string; bytes: number }[] = [
    {
      id: 'q8',
      label: 'Q8',
      note: 'Quantized weights. Fastest start, ideal for laptops.',
      bytes: model.files.find((file) => file.quality === 'q8')?.size || 0,
    },
    {
      id: 'f32',
      label: 'F32',
      note: 'Full precision. Larger download, the most faithful detail.',
      bytes: model.files.find((file) => file.quality === 'f32')?.size || 0,
    },
  ];
  return all.filter((option) => available.includes(option.id));
}

export function capabilityLabel(capability: keyof ModelCapabilities): string {
  const labels: Record<keyof ModelCapabilities, string> = {
    voiceImport: 'Voice file import',
    voiceClone: 'Voice cloning',
    cloneKind: 'Cloning kind',
    multiSpeaker: 'Multi-speaker dialogue',
    emotion: 'Emotion control',
    nonVerbal: 'Non-verbal sounds',
    streaming: 'Streaming audio',
    phonemes: 'Phoneme input',
    normalization: 'Text normalization',
    speed: 'Speed control',
    seed: 'Deterministic seed',
    watermark: 'Watermark',
    arabic: 'Arabic',
  };
  return labels[capability];
}

export function capabilityEnabled(model: ModelManifest, capability: keyof ModelCapabilities): boolean {
  // The language list is the source of truth for Arabic, whatever the flag says.
  if (capability === 'arabic') return modelHasArabic(model);
  return Boolean(model.capabilities[capability]);
}

export function capabilityReason(model: ModelManifest, capability: keyof ModelCapabilities): string {
  if (capabilityEnabled(model, capability)) return '';
  if (capability === 'arabic') return `${model.shortName} does not declare Arabic support.`;
  if (capability === 'voiceClone') return `${model.shortName} does not support voice cloning.`;
  if (capability === 'voiceImport') return `${model.shortName} uses its own voice format; imported Phonon tensors are not compatible.`;
  if (capability === 'streaming') return `${model.shortName} renders in one pass.`;
  if (capability === 'emotion') return `${model.shortName} has no emotion or style controls.`;
  if (capability === 'multiSpeaker') return `${model.shortName} does not support multi-speaker dialogue.`;
  return `${capabilityLabel(capability)} is not supported by ${model.shortName}.`;
}

export function voiceCompatibleWithModel(model: ModelManifest, voice: VoiceInfo): boolean {
  if (voice.source === 'model') return voice.modelId === model.id;
  if (model.voices.format !== 'phonon-safetensors') return false;
  if (voice.id === DEFAULT_VOICE_ID) return true;
  if (voice.source === 'custom') {
    // Custom voices are Phonon tensors. They are usable when the model speaks the
    // language the voice was recorded in (31M is English-only).
    return supportsLanguage(model, voice.language);
  }
  const locales = model.voices.compatibleLocales;
  return !locales || locales.includes(voice.locale);
}

export interface ModelVoiceGroup {
  model: ModelManifest;
  voices: VoiceInfo[];
  reason?: string;
}

/** Groups the catalog by compatibility with the active model. */
export function voicesForModel(model: ModelManifest, customVoices: VoiceInfo[] = []): ModelVoiceGroup {
  if (model.voices.format !== 'phonon-safetensors') {
    const voices = getModelVoices(model.id);
    return {
      model,
      voices,
      reason: voices.length ? undefined : `${model.shortName} lists its voices once the model has started.`,
    };
  }
  const voices = [...customVoices, ...VOICES].filter((voice) => voiceCompatibleWithModel(model, voice));
  return { model, voices };
}

export function voiceCompatibilityNote(model: ModelManifest, voice: VoiceInfo): string | null {
  if (voiceCompatibleWithModel(model, voice)) return null;
  if (voice.source === 'model') return `${voice.name} is a ${getModel(voice.modelId || '').shortName} voice.`;
  if (model.voices.format !== 'phonon-safetensors') {
    return `${voice.name} is a Phonon voice and cannot be used with ${model.shortName}.`;
  }
  return `${voice.name} speaks ${voice.locale.toUpperCase()}, which ${model.shortName} does not support.`;
}
