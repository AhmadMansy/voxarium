// SPDX-License-Identifier: AGPL-3.0-or-later
import catalogData from './voices.json';
import type { Catalog, CustomVoiceRecord, VoiceInfo } from '../types';

export const catalog = catalogData as Catalog;
export const VOICES: VoiceInfo[] = catalog.voices;

export const voiceById = new Map(VOICES.map((voice) => [voice.id, voice]));

/**
 * Custom (cloned or imported) voices are kept in a small mutable registry so every
 * component — including helpers outside React — can resolve them by id.
 */
let customVoices: VoiceInfo[] = [];

export function setCustomVoices(list: VoiceInfo[]) {
  customVoices = list;
}

export function getCustomVoices(): VoiceInfo[] {
  return customVoices;
}

export function allVoices(): VoiceInfo[] {
  return customVoices.length ? [...customVoices, ...VOICES] : VOICES;
}

/**
 * Voices reported by sidecar models (built-in speakers, voice-design presets and
 * the user's reference clips), keyed `<modelId>:<voice>` so they never collide
 * with catalog ids.
 */
let modelVoices: VoiceInfo[] = [];

export function setModelVoices(modelId: string, list: VoiceInfo[]) {
  modelVoices = [...modelVoices.filter((voice) => voice.modelId !== modelId), ...list];
}

export function getModelVoices(modelId: string): VoiceInfo[] {
  return modelVoices.filter((voice) => voice.modelId === modelId);
}

export function modelVoiceId(modelId: string, nativeId: string): string {
  return `${modelId}:${nativeId}`;
}

/** The id a sidecar understands, or null when the voice belongs to another model. */
export function nativeVoiceId(modelId: string, voiceId: string | undefined): string | null {
  const prefix = `${modelId}:`;
  return voiceId && voiceId.startsWith(prefix) ? voiceId.slice(prefix.length) : null;
}

export function getVoice(id: string | undefined): VoiceInfo {
  return (
    voiceById.get(id || '') ||
    customVoices.find((voice) => voice.id === id) ||
    modelVoices.find((voice) => voice.id === id) ||
    VOICES[0]
  );
}

export function isCustomVoice(id: string | undefined): boolean {
  return customVoices.some((voice) => voice.id === id);
}

const CUSTOM_LOCALES: Record<string, string> = {
  en: 'en-us',
  fr: 'fr-fr',
  de: 'de-de',
  es: 'es-es',
  pt: 'pt-br',
};

export function customVoiceToInfo(record: CustomVoiceRecord): VoiceInfo {
  const copied = record.source === 'clone';
  return {
    id: record.id,
    name: record.name,
    language: record.language,
    locale: CUSTOM_LOCALES[record.language] || 'en-us',
    gender: null,
    age: null,
    description: copied
      ? 'Cloned from your recording with Gradium, then stored on this device.'
      : 'Imported Phonon voice file. Works with every Phonon checkpoint.',
    file: record.fileName || `${record.id}.safetensors`,
    isDefault: false,
    source: 'custom',
    customKind: copied ? 'clone' : 'import',
    createdAt: record.createdAt,
    bytes: record.bytes,
  };
}

export const DEFAULT_VOICE_ID = 'default';

export const localeLabels: Record<string, string> = {
  'en-us': 'English (US)',
  'en-gb': 'English (UK)',
  characters: 'Characters',
  'es-es': 'Spanish (Spain)',
  'es-mx': 'Spanish (Mexico)',
  'de-de': 'German',
  'fr-fr': 'French',
  'pt-br': 'Portuguese (Brazil)',
};

export const localeFlags: Record<string, string> = {
  'en-us': '🇺🇸',
  'en-gb': '🇬🇧',
  characters: '✦',
  'es-es': '🇪🇸',
  'es-mx': '🇲🇽',
  'de-de': '🇩🇪',
  'fr-fr': '🇫🇷',
  'pt-br': '🇧🇷',
};

export const englishLocales = ['en-us', 'en-gb', 'characters'];

export function localeLabel(locale: string): string {
  return localeLabels[locale] || locale;
}

export function voiceInitials(name: string): string {
  return name
    .replace(/^(Captain|Sir|The|Old|Master|Fairy)\s+/i, '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

const HUES = [258, 190, 320, 28, 152, 220, 282, 348, 46, 168];

export function voiceHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return HUES[Math.abs(hash) % HUES.length];
}
