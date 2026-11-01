// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds electron/models/manifests.json.
//
// The Phonon family is pinned to exact Hugging Face revisions and every file is
// verified by size + SHA-256. Models whose runtime pack is not bundled yet are
// still described (languages, license, capabilities, hardware floor) but carry
// no files and are marked as unavailable, so the UI can be honest about them.
//
// Run with: node scripts/build-manifests.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const output = path.join(root, 'electron', 'models', 'manifests.json');

const HF = 'https://huggingface.co';
const UA = { 'user-agent': 'Voxarium-manifest-builder' };

const lang = (code, name, extra = {}) => ({ code, name, locale: extra.locale, quality: extra.quality || 'high', arabic: Boolean(extra.arabic), ...extra });
const langs = (...items) => items.map((item) => (Array.isArray(item) ? lang(item[0], item[1], item[2] || {}) : lang(item[0], item[1])));

const ARABIC_VARIETIES = [
  ['arb', 'Modern Standard Arabic'],
  ['arq', 'Algerian Arabic'],
  ['ars', 'Najdi Arabic'],
  ['ary', 'Moroccan Arabic'],
  ['arz', 'Egyptian Arabic'],
  ['acm', 'Mesopotamian Arabic'],
  ['aeb', 'Tunisian Arabic'],
  ['afb', 'Gulf Arabic'],
  ['apc', 'North Levantine Arabic'],
  ['apd', 'Sudanese Arabic'],
  ['avl', 'Eastern Egyptian Arabic'],
  ['ayl', 'Libyan Arabic'],
  ['ayp', 'North Mesopotamian Arabic'],
  ['shu', 'Chadian Arabic'],
].map(([code, name]) => ({ code, name }));

const caps = (overrides = {}) => ({
  voiceImport: false,
  voiceClone: false,
  cloneKind: 'none',
  multiSpeaker: false,
  emotion: false,
  nonVerbal: false,
  streaming: false,
  phonemes: false,
  normalization: false,
  speed: false,
  seed: false,
  watermark: false,
  arabic: false,
  ...overrides,
});

const base = {
  ratingEvidence: 'https://artificialanalysis.ai/text-to-speech',
  ratingRubric:
    'Editorial 1–10 score: 40% naturalness and prosody, 25% cloning and expression, 20% language coverage, 15% efficiency. The score is a planning aid, not a benchmark.',
};

const phononFiles = {
  'phonon-31m-en': [
    ['config.json', 4634, null],
    ['tokenizer.json', 277967, null],
    ['model.q8.gguf', 64512352, 'q8'],
    ['model.safetensors', 102823920, 'f32'],
    ['default-voice.safetensors', 256136, 'voice'],
  ],
  'phonon-40m-multilingual': [
    ['config.json', 4674, null],
    ['tokenizer.json', 277749, null],
    ['model.q8.gguf', 74553568, 'q8'],
    ['model.safetensors', 121713400, 'f32'],
    ['default-voice.safetensors', 256136, 'voice'],
  ],
};

const phonon = {
  'phonon-31m-en': {
    name: 'Phonon 31M English',
    shortName: 'Phonon 31M',
    family: 'Phonon',
    description:
      'The original Voxarium checkpoint: 31M parameters, English narration, streaming 24 kHz audio and the full Gradium voice catalog.',
    runtime: 'phonon',
    runtimeLabel: 'phonon-tts · WASM / WebGPU',
    repo: 'gradium/phonon-31m-en',
    revision: '92741c5b07d085ff840e26fea8ce43110b87852f',
    rating: 7,
    ratingNotes: 'Excellent quality per byte; English only and not a multilingual model.',
    license: { id: 'Apache-2.0', name: 'Apache License 2.0', commercial: true, restricted: false, url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    languages: langs(['en', 'English', { locale: 'en-US' }]),
    capabilities: caps({
      voiceImport: true,
      voiceClone: true,
      cloneKind: 'cloud',
      streaming: true,
      phonemes: true,
      normalization: true,
      speed: true,
      seed: true,
    }),
    voices: {
      format: 'phonon-safetensors',
      shape: [1, 512, 125],
      catalog: 'gradium/phonon-voices',
      catalogRevision: '0ee17205f254b5abc43b266c8a0f215565c352f7',
      compatibleLocales: ['en-us', 'en-gb', 'characters'],
      note: '102 catalog voices plus local imports and Gradium cloud clones.',
    },
    hardware: { backend: 'wasm-webgpu', minRamGb: 4, recRamGb: 8, minVramGb: 0, recVramGb: 0, diskGb: 0.18 },
    defaults: { quality: 'q8', device: 'auto', temperature: 0.3, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['english', 'fast', 'cpu-friendly', 'commercial'],
    available: true,
  },
  'phonon-40m-multilingual': {
    name: 'Phonon 40M Multilingual',
    shortName: 'Phonon 40M',
    family: 'Phonon',
    description:
      'A five-language Phonon checkpoint (English, French, German, Spanish, Portuguese) with the same runtime, file layout and voice format as 31M.',
    runtime: 'phonon',
    runtimeLabel: 'phonon-tts · WASM / WebGPU',
    repo: 'gradium/phonon-40m-multilingual',
    revision: '1537ce46c64f42903e0d608b132ccb073dac46d2',
    rating: 7,
    ratingNotes: 'Good quality per byte and a huge convenience win; English-led and non-commercial weights.',
    license: { id: 'CC-BY-NC-4.0', name: 'Creative Commons BY-NC 4.0', commercial: false, restricted: true, url: 'https://creativecommons.org/licenses/by-nc/4.0/' },
    languages: langs(
      ['en', 'English', { locale: 'en-US' }],
      ['fr', 'French', { locale: 'fr-FR' }],
      ['de', 'German', { locale: 'de-DE' }],
      ['es', 'Spanish', { locale: 'es-ES' }],
      ['pt', 'Portuguese', { locale: 'pt-BR' }],
    ),
    capabilities: caps({
      voiceImport: true,
      voiceClone: true,
      cloneKind: 'cloud',
      streaming: true,
      phonemes: true,
      normalization: true,
      speed: true,
      seed: true,
    }),
    voices: {
      format: 'phonon-safetensors',
      shape: [1, 512, 125],
      catalog: 'gradium/phonon-voices',
      catalogRevision: '0ee17205f254b5abc43b266c8a0f215565c352f7',
      compatibleLocales: ['en-us', 'en-gb', 'fr-fr', 'de-de', 'es-es', 'es-mx', 'pt-br'],
      note: 'Reuses the Phonon voice catalog; non-English voices are intended for the 40M family.',
    },
    hardware: { backend: 'wasm-webgpu', minRamGb: 4, recRamGb: 8, minVramGb: 0, recVramGb: 0, diskGb: 0.2 },
    defaults: { quality: 'q8', device: 'auto', temperature: 0.3, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['multilingual', 'fast', 'non-commercial'],
    available: true,
  },
};

const unavailable = (reason) => ({ available: false, reason });

const models = [
  { ...phonon['phonon-31m-en'], id: 'phonon-31m-en' },
  { ...phonon['phonon-40m-multilingual'], id: 'phonon-40m-multilingual' },
  {
    id: 'kokoro-82m',
    name: 'Kokoro-82M',
    shortName: 'Kokoro',
    family: 'Kokoro',
    description:
      '82M ONNX model with 54 fixed voices across eight languages. Outstanding quality per byte and the best tiny browser-native narrator.',
    runtime: 'sidecar',
    runtimeLabel: 'Local sidecar · Python (kokoro + misaki)',
    repo: 'hexgrad/Kokoro-82M',
    revision: 'f3ff3571791e39611d31c381e3a41a3af07b4987',
    rating: 8,
    ratingNotes: 'Excellent quality per byte; some non-English voices are thin (French has one).',
    license: { id: 'Apache-2.0', name: 'Apache License 2.0', commercial: true, restricted: false, url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    languages: langs(
      ['en', 'English', { locale: 'en-US' }],
      ['en-GB', 'English (UK)', { locale: 'en-GB' }],
      ['ja', 'Japanese', { locale: 'ja-JP', quality: 'medium' }],
      ['zh', 'Mandarin Chinese', { locale: 'zh-CN', quality: 'medium' }],
      ['es', 'Spanish', { locale: 'es-ES', quality: 'medium' }],
      ['fr', 'French', { locale: 'fr-FR', quality: 'low' }],
      ['hi', 'Hindi', { locale: 'hi-IN', quality: 'medium' }],
      ['it', 'Italian', { locale: 'it-IT', quality: 'medium' }],
      ['pt', 'Portuguese (Brazil)', { locale: 'pt-BR', quality: 'medium' }],
    ),
    capabilities: caps({ streaming: true, normalization: true, speed: true, seed: true }),
    voices: { format: 'kokoro-voice-pack', note: '54 built-in voice packs grouped by locale.', compatibleLocales: ['en-us', 'en-gb', 'ja-jp', 'zh-cn', 'es-es', 'fr-fr', 'hi-in', 'it-it', 'pt-br'] },
    hardware: { backend: 'sidecar', minRamGb: 4, recRamGb: 8, minVramGb: 0, recVramGb: 0, diskGb: 0.4 },
    defaults: { quality: 'f32', device: 'auto', temperature: 0.3, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['english', 'multilingual', 'cpu-friendly', 'commercial'],
  },
  {
    id: 'supertonic-3',
    name: 'Supertonic 3',
    shortName: 'Supertonic',
    family: 'Supertonic',
    description:
      '31-language ONNX model that runs comfortably on CPU. Four small graphs, expression tags and full Arabic coverage.',
    runtime: 'sidecar',
    runtimeLabel: 'Local sidecar · ONNX Runtime (CPU)',
    repo: 'Supertone/supertonic-3',
    revision: '3cadd1ee6394adea1bd021217a0e650ede09a323',
    rating: 8,
    ratingNotes: 'Best CPU multilingual model; no zero-shot cloning, voices are style presets.',
    license: { id: 'OpenRAIL-M', name: 'OpenRAIL-M', commercial: true, restricted: false, url: 'https://huggingface.co/Supertone/supertonic-3' },
    languages: langs(
      ['ar', 'Arabic', { locale: 'ar-SA', arabic: true, varieties: ARABIC_VARIETIES.filter((item) => item.code === 'arb'), defaultVariety: 'arb' }],
      ['bg', 'Bulgarian'], ['cs', 'Czech'], ['da', 'Danish'], ['de', 'German'], ['el', 'Greek'],
      ['en', 'English', { locale: 'en-US' }],
      ['es', 'Spanish'], ['et', 'Estonian'], ['fi', 'Finnish'], ['fr', 'French'], ['hi', 'Hindi'],
      ['hr', 'Croatian'], ['hu', 'Hungarian'], ['id', 'Indonesian'], ['it', 'Italian'],
      ['ja', 'Japanese'], ['ko', 'Korean'], ['lt', 'Lithuanian'], ['lv', 'Latvian'],
      ['nl', 'Dutch'], ['pl', 'Polish'], ['pt', 'Portuguese'], ['ro', 'Romanian'],
      ['ru', 'Russian'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['sv', 'Swedish'],
      ['tr', 'Turkish'], ['uk', 'Ukrainian'], ['vi', 'Vietnamese'],
    ),
    // No emotion/style control (voices are fixed style presets), but the text accepts
    // expression tags such as <laugh>, <breath> and <sigh>.
    capabilities: caps({ streaming: true, nonVerbal: true, normalization: true, seed: true }),
    voices: { format: 'supertonic-style', note: 'Style presets instead of speaker embeddings.', compatibleLocales: ['ar-sa', 'en-us'] },
    hardware: { backend: 'sidecar', minRamGb: 4, recRamGb: 8, minVramGb: 0, recVramGb: 0, diskGb: 0.45 },
    defaults: { quality: 'f32', device: 'cpu', temperature: 0.3, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['multilingual', 'arabic', 'cpu-friendly', 'commercial'],
  },
  {
    id: 'silma-tts',
    name: 'SILMA TTS',
    shortName: 'SILMA',
    family: 'SILMA',
    description:
      'A 150M bilingual Arabic/English model built for fast local cloning and MSA narration. The best small Arabic-first option.',
    runtime: 'sidecar',
    runtimeLabel: 'Local sidecar · Python',
    repo: 'silma-ai/silma-tts',
    revision: null,
    rating: 7,
    ratingNotes: 'Arabic-first and very small; quality trails the flagships outside Arabic.',
    license: { id: 'Apache-2.0', name: 'Apache License 2.0', commercial: true, restricted: false, url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    languages: langs(
      ['ar', 'Arabic', { locale: 'ar-SA', arabic: true, varieties: ARABIC_VARIETIES.filter((item) => item.code === 'arb'), defaultVariety: 'arb' }],
      ['en', 'English', { locale: 'en-US' }],
    ),
    capabilities: caps({ voiceClone: true, cloneKind: 'local', streaming: true, speed: true, seed: true }),
    voices: { format: 'silma-reference', note: 'Local reference-audio clones; nothing leaves the machine.' },
    hardware: { backend: 'sidecar', minRamGb: 8, recRamGb: 16, minVramGb: 0, recVramGb: 4, diskGb: 0.4 },
    defaults: { quality: 'f32', device: 'auto', temperature: 0.6, seed: '4242424242424242', language: 'ar', rewrites: 'default', threads: 'auto' },
    tags: ['arabic', 'local-runtime', 'clone', 'commercial'],
    runtimePack: unavailable('The SILMA sidecar pack is not installed. Sidecar models are opt-in downloads; this build ships the supervisor only.'),
    estimatedBytes: 320000000,
  },
  {
    id: 'chatterbox',
    name: 'Chatterbox Multilingual',
    shortName: 'Chatterbox',
    family: 'Resemble AI',
    description:
      '0.5B multilingual model with 23 languages, zero-shot cloning and exaggeration control. Outputs carry a Perth watermark.',
    runtime: 'sidecar',
    runtimeLabel: 'Local sidecar · Python',
    repo: 'ResembleAI/chatterbox',
    revision: null,
    rating: 8,
    ratingNotes: 'Strong cloning and emotion for its size; watermark and a heavier runtime are the trade-offs.',
    license: { id: 'MIT', name: 'MIT License', commercial: true, restricted: false, watermark: true, url: 'https://opensource.org/licenses/MIT' },
    languages: langs(
      ['ar', 'Arabic', { locale: 'ar-SA', arabic: true }], ['da', 'Danish'], ['de', 'German'], ['el', 'Greek'],
      ['en', 'English', { locale: 'en-US' }], ['es', 'Spanish'], ['fi', 'Finnish'], ['fr', 'French'],
      ['he', 'Hebrew'], ['hi', 'Hindi'], ['it', 'Italian'], ['ja', 'Japanese'], ['ko', 'Korean'],
      ['ms', 'Malay'], ['nl', 'Dutch'], ['no', 'Norwegian'], ['pl', 'Polish'], ['pt', 'Portuguese'],
      ['ru', 'Russian'], ['sv', 'Swedish'], ['sw', 'Swahili'], ['tr', 'Turkish'], ['zh', 'Chinese'],
    ),
    capabilities: caps({ voiceClone: true, cloneKind: 'local', emotion: true, streaming: true, watermark: true, speed: true, seed: true }),
    voices: { format: 'chatterbox-reference', note: 'Local reference-audio clones.' },
    hardware: { backend: 'sidecar', minRamGb: 12, recRamGb: 24, minVramGb: 4, recVramGb: 8, diskGb: 3.4 },
    defaults: { quality: 'f32', device: 'auto', temperature: 0.8, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['local-runtime', 'clone', 'multilingual', 'arabic', 'commercial', 'watermark'],
    runtimePack: unavailable('The Chatterbox sidecar pack is not installed. Sidecar models are opt-in downloads; this build ships the supervisor only.'),
    estimatedBytes: 3400000000,
  },
  {
    id: 'openaudio-s1-mini',
    name: 'OpenAudio S1-mini',
    shortName: 'OpenAudio',
    family: 'Fish Audio',
    description:
      '0.5B model with 13 languages, zero-shot cloning and emotion tags. Non-commercial weights.',
    runtime: 'sidecar',
    runtimeLabel: 'Local sidecar · Python',
    repo: 'fishaudio/openaudio-s1-mini',
    revision: null,
    rating: 8,
    ratingNotes: 'Expressive and compact; the non-commercial share-alike license limits use.',
    license: { id: 'CC-BY-NC-SA-4.0', name: 'CC BY-NC-SA 4.0', commercial: false, restricted: true, url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' },
    languages: langs(
      ['ar', 'Arabic', { locale: 'ar-SA', arabic: true }], ['zh', 'Chinese'], ['en', 'English', { locale: 'en-US' }],
      ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['ja', 'Japanese'], ['ko', 'Korean'],
      ['nl', 'Dutch'], ['pl', 'Polish'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['es', 'Spanish'],
    ),
    capabilities: caps({ voiceClone: true, cloneKind: 'local', emotion: true, streaming: true, speed: true, seed: true }),
    voices: { format: 'openaudio-reference', note: 'Local reference-audio clones.' },
    hardware: { backend: 'sidecar', minRamGb: 12, recRamGb: 24, minVramGb: 4, recVramGb: 8, diskGb: 1.2 },
    defaults: { quality: 'f32', device: 'auto', temperature: 0.7, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['local-runtime', 'clone', 'multilingual', 'arabic', 'non-commercial'],
    runtimePack: unavailable('The OpenAudio sidecar pack is not installed. Sidecar models are opt-in downloads; this build ships the supervisor only.'),
    estimatedBytes: 1200000000,
  },
  {
    id: 'qwen3-tts',
    name: 'Qwen3-TTS 1.7B',
    shortName: 'Qwen3-TTS',
    family: 'Qwen',
    description:
      'A 1.93B multilingual flagship with streaming, local cloning and voice design in ten languages. No Arabic.',
    runtime: 'sidecar',
    runtimeLabel: 'Local sidecar · Python',
    repo: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base',
    revision: null,
    rating: 9,
    ratingNotes: 'Near state of the art; Apache-2.0 weights make it the strongest commercial-safe flagship.',
    license: { id: 'Apache-2.0', name: 'Apache License 2.0', commercial: true, restricted: false, url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    languages: langs(
      ['zh', 'Chinese'], ['en', 'English', { locale: 'en-US' }], ['ja', 'Japanese'], ['ko', 'Korean'],
      ['de', 'German'], ['fr', 'French'], ['ru', 'Russian'], ['pt', 'Portuguese'], ['es', 'Spanish'], ['it', 'Italian'],
    ),
    capabilities: caps({ voiceClone: true, cloneKind: 'local', emotion: true, streaming: true, speed: true, seed: true }),
    voices: { format: 'qwen-reference', note: 'Local voice-design prompts and reference clones.' },
    hardware: { backend: 'sidecar', minRamGb: 16, recRamGb: 32, minVramGb: 6, recVramGb: 12, diskGb: 3.8 },
    defaults: { quality: 'q8', device: 'auto', temperature: 0.7, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['flagship', 'local-runtime', 'clone', 'multilingual', 'commercial'],
    runtimePack: unavailable('The Qwen3-TTS sidecar pack is not installed. Sidecar models are opt-in downloads; this build ships the supervisor only.'),
    estimatedBytes: 3500000000,
  },
  {
    id: 'omnivoice',
    name: 'OmniVoice',
    shortName: 'OmniVoice',
    family: 'k2-fsa',
    description:
      '612M model covering 646 languages and dialects, including 14 Arabic varieties. Broad coverage with per-language quality that varies.',
    runtime: 'sidecar',
    runtimeLabel: 'Local sidecar · Python',
    repo: 'k2-fsa/OmniVoice',
    revision: null,
    rating: 8,
    ratingNotes: 'Unmatched language breadth and Arabic variety coverage; quality is uneven outside major languages. The inference code is Apache-2.0, but the published model weights are CC-BY-NC.',
    license: { id: 'CC-BY-NC-4.0', name: 'Creative Commons BY-NC 4.0 (model weights)', commercial: false, restricted: true, url: 'https://creativecommons.org/licenses/by-nc/4.0/' },
    languages: [
      lang('ar', 'Arabic', { locale: 'ar-SA', arabic: true, varieties: ARABIC_VARIETIES, defaultVariety: 'arb' }),
      ...langs(
        ['en', 'English', { locale: 'en-US' }], ['zh', 'Chinese'], ['fr', 'French'], ['de', 'German'],
        ['es', 'Spanish'], ['pt', 'Portuguese'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'],
        ['ru', 'Russian'], ['tr', 'Turkish'], ['it', 'Italian'], ['nl', 'Dutch'], ['pl', 'Polish'],
        ['uk', 'Ukrainian'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['id', 'Indonesian'], ['fa', 'Persian'],
        ['he', 'Hebrew'], ['sw', 'Swahili'], ['yo', 'Yoruba'], ['zu', 'Zulu'], ['am', 'Amharic'],
      ),
    ],
    languageCount: 646,
    languageNote: '646 languages/dialects. The UI lists major languages and the full Arabic variety set; the runtime index can be searched by ISO code.',
    capabilities: caps({ voiceClone: true, cloneKind: 'local', emotion: true, nonVerbal: true, streaming: true, speed: true, seed: true }),
    voices: { format: 'omnivoice-reference', note: 'Local clones and voice design.' },
    hardware: { backend: 'sidecar', minRamGb: 12, recRamGb: 24, minVramGb: 4, recVramGb: 8, diskGb: 1.4 },
    defaults: { quality: 'f32', device: 'auto', temperature: 0.7, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['local-runtime', 'clone', 'multilingual', 'arabic', 'non-commercial'],
    runtimePack: unavailable('The OmniVoice sidecar pack is not installed. Sidecar models are opt-in downloads; this build ships the supervisor only.'),
    estimatedBytes: 1300000000,
  },
  {
    id: 'voxcpm2',
    name: 'VoxCPM2',
    shortName: 'VoxCPM2',
    family: 'OpenBMB',
    description:
      '2.29B, 48 kHz, 30-language diffusion-autoregressive model with voice design and Arabic support.',
    runtime: 'sidecar',
    runtimeLabel: 'Local sidecar · Python',
    repo: 'openbmb/VoxCPM2',
    revision: null,
    rating: 9,
    ratingNotes: '48 kHz output and strong multilingual naturalness; a heavy local runtime.',
    license: { id: 'Apache-2.0', name: 'Apache License 2.0', commercial: true, restricted: false, url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    languages: langs(
      ['ar', 'Arabic', { locale: 'ar-SA', arabic: true, varieties: ARABIC_VARIETIES.filter((item) => item.code === 'arb'), defaultVariety: 'arb' }],
      ['my', 'Burmese'], ['zh', 'Chinese'], ['da', 'Danish'], ['nl', 'Dutch'], ['en', 'English', { locale: 'en-US' }],
      ['fi', 'Finnish'], ['fr', 'French'], ['de', 'German'], ['el', 'Greek'], ['he', 'Hebrew'], ['hi', 'Hindi'],
      ['id', 'Indonesian'], ['it', 'Italian'], ['ja', 'Japanese'], ['km', 'Khmer'], ['ko', 'Korean'],
      ['lo', 'Lao'], ['ms', 'Malay'], ['no', 'Norwegian'], ['pl', 'Polish'], ['pt', 'Portuguese'],
      ['ru', 'Russian'], ['es', 'Spanish'], ['sw', 'Swahili'], ['sv', 'Swedish'], ['tl', 'Tagalog'],
      ['th', 'Thai'], ['tr', 'Turkish'], ['vi', 'Vietnamese'],
    ),
    capabilities: caps({ voiceClone: true, cloneKind: 'local', emotion: true, streaming: true, speed: true, seed: true }),
    voices: { format: 'voxcpm-reference', note: 'Local reference clones and voice design.' },
    hardware: { backend: 'sidecar', minRamGb: 16, recRamGb: 32, minVramGb: 8, recVramGb: 12, diskGb: 5 },
    defaults: { quality: 'f32', device: 'auto', temperature: 0.7, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['flagship', 'local-runtime', 'clone', 'multilingual', 'arabic', 'commercial'],
    runtimePack: unavailable('The VoxCPM2 sidecar pack is not installed. Sidecar models are opt-in downloads; this build ships the supervisor only.'),
    estimatedBytes: 4600000000,
  },
  {
    id: 'moss-tts',
    name: 'MOSS-TTS v1.5',
    shortName: 'MOSS-TTS',
    family: 'OpenMOSS',
    description:
      'An 8.5B, 31-language heavyweight with local cloning and pause markers. Best when quality matters more than size.',
    runtime: 'sidecar',
    runtimeLabel: 'Local sidecar · Python',
    repo: 'OpenMOSS-Team/MOSS-TTS-v1.5',
    revision: null,
    rating: 9,
    ratingNotes: 'Flagship quality and Arabic support; 17 GB of weights put it out of reach for most machines.',
    license: { id: 'Apache-2.0', name: 'Apache License 2.0', commercial: true, restricted: false, url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    languages: langs(
      ['ar', 'Arabic', { locale: 'ar-SA', arabic: true }], ['yue', 'Cantonese'], ['zh', 'Chinese'], ['cs', 'Czech'],
      ['da', 'Danish'], ['nl', 'Dutch'], ['en', 'English', { locale: 'en-US' }], ['fi', 'Finnish'],
      ['fr', 'French'], ['de', 'German'], ['el', 'Greek'], ['he', 'Hebrew'], ['hi', 'Hindi'],
      ['hu', 'Hungarian'], ['it', 'Italian'], ['ja', 'Japanese'], ['ko', 'Korean'], ['mk', 'Macedonian'],
      ['ms', 'Malay'], ['fa', 'Persian'], ['pl', 'Polish'], ['pt', 'Portuguese'], ['ro', 'Romanian'],
      ['ru', 'Russian'], ['es', 'Spanish'], ['sw', 'Swahili'], ['sv', 'Swedish'], ['tl', 'Tagalog'],
      ['th', 'Thai'], ['tr', 'Turkish'], ['vi', 'Vietnamese'],
    ),
    capabilities: caps({ voiceClone: true, cloneKind: 'local', emotion: true, nonVerbal: true, streaming: true, speed: true, seed: true }),
    voices: { format: 'moss-reference', note: 'Local reference clones; pause markers are part of the text syntax.' },
    hardware: { backend: 'sidecar', minRamGb: 32, recRamGb: 64, minVramGb: 16, recVramGb: 24, diskGb: 17 },
    defaults: { quality: 'q4', device: 'auto', temperature: 0.7, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['flagship', 'local-runtime', 'clone', 'multilingual', 'arabic', 'commercial'],
    runtimePack: unavailable('The MOSS-TTS sidecar pack is not installed. Sidecar models are opt-in downloads; this build ships the supervisor only.'),
    estimatedBytes: 17000000000,
  },
  {
    id: 'breeze-tts2',
    name: 'Breeze TTS 2',
    shortName: 'Breeze',
    family: 'BreezeBlue',
    description:
      'The best-sounding open-weight English/Chinese model at release, with cloning, voice direction and vocal events. Non-commercial weights.',
    runtime: 'sidecar',
    runtimeLabel: 'Local sidecar · Python',
    repo: 'BreezeBlue/Breeze-TTS-2',
    revision: null,
    rating: 10,
    ratingNotes: 'Reference quality in English and Chinese; non-commercial and no Arabic.',
    license: { id: 'BreezeBlue-NC', name: 'BreezeBlue Research & Non-Commercial', commercial: false, restricted: true, url: 'https://huggingface.co/BreezeBlue/Breeze-TTS-2' },
    languages: langs(['en', 'English', { locale: 'en-US' }], ['zh', 'Chinese']),
    capabilities: caps({ voiceClone: true, cloneKind: 'local', emotion: true, nonVerbal: true, streaming: true, speed: true, seed: true }),
    voices: { format: 'breeze-reference', note: 'Local reference clones and voice direction.' },
    hardware: { backend: 'sidecar', minRamGb: 16, recRamGb: 32, minVramGb: 8, recVramGb: 12, diskGb: 7.5 },
    defaults: { quality: 'f32', device: 'auto', temperature: 0.7, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['flagship', 'local-runtime', 'clone', 'non-commercial'],
    runtimePack: unavailable('The Breeze TTS 2 sidecar pack is not installed. Sidecar models are opt-in downloads; this build ships the supervisor only.'),
    estimatedBytes: 7400000000,
  },
  {
    id: 'audio8-tts',
    name: 'Audio8 TTS',
    shortName: 'Audio8',
    family: 'Edge0',
    description:
      '601M, 44.1 kHz codec model with zero-shot cloning across 11 languages. No Arabic.',
    runtime: 'sidecar',
    runtimeLabel: 'Local sidecar · Python',
    repo: 'Edge0/Audio8-TTS-Preview-0.6b',
    revision: null,
    rating: 8,
    ratingNotes: 'High sample rate and compact cloning model; mid-tier naturalness.',
    license: { id: 'Apache-2.0', name: 'Apache License 2.0', commercial: true, restricted: false, url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    languages: langs(
      ['yue', 'Cantonese'], ['zh', 'Chinese'], ['nl', 'Dutch'], ['en', 'English', { locale: 'en-US' }],
      ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['ja', 'Japanese'], ['ko', 'Korean'],
      ['pl', 'Polish'], ['es', 'Spanish'],
    ),
    capabilities: caps({ voiceClone: true, cloneKind: 'local', streaming: true, speed: true, seed: true }),
    voices: { format: 'audio8-reference', note: 'Local reference clones.' },
    hardware: { backend: 'sidecar', minRamGb: 12, recRamGb: 24, minVramGb: 4, recVramGb: 8, diskGb: 1.4 },
    defaults: { quality: 'f32', device: 'auto', temperature: 0.7, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['local-runtime', 'clone', 'multilingual', 'commercial'],
    runtimePack: unavailable('The Audio8 TTS sidecar pack is not installed. Sidecar models are opt-in downloads; this build ships the supervisor only.'),
    estimatedBytes: 1400000000,
  },
  {
    id: 'indextts2',
    name: 'IndexTTS2',
    shortName: 'IndexTTS2',
    family: 'Bilibili',
    description:
      'Emotion and duration control with zero-shot cloning in English and Chinese. Custom license needs review before commercial use.',
    runtime: 'sidecar',
    runtimeLabel: 'Local sidecar · Python',
    repo: 'IndexTeam/IndexTTS-2',
    revision: null,
    rating: 9,
    ratingNotes: 'Excellent control and cloning; licensing is unresolved for shipping.',
    license: { id: 'Bilibili-Model-License', name: 'Bilibili Model Use License', commercial: null, restricted: true, review: true, url: 'https://huggingface.co/IndexTeam/IndexTTS-2' },
    languages: langs(['en', 'English', { locale: 'en-US' }], ['zh', 'Chinese']),
    capabilities: caps({ voiceClone: true, cloneKind: 'local', emotion: true, streaming: true, speed: true, seed: true }),
    voices: { format: 'index-reference', note: 'Local reference clones.' },
    hardware: { backend: 'sidecar', minRamGb: 16, recRamGb: 32, minVramGb: 8, recVramGb: 12, diskGb: 6.5 },
    defaults: { quality: 'f32', device: 'auto', temperature: 0.7, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['local-runtime', 'clone', 'review-license'],
    runtimePack: unavailable('The IndexTTS2 sidecar pack is not installed. Sidecar models are opt-in downloads; this build ships the supervisor only.'),
    estimatedBytes: 6500000000,
  },
  {
    id: 'xtts-v2',
    name: 'XTTS-v2',
    shortName: 'XTTS',
    family: 'Coqui',
    description:
      'The 467M compatibility baseline: 17 languages, local cloning and style transfer. Evaluation-only under Coqui CPML.',
    runtime: 'sidecar',
    runtimeLabel: 'Local sidecar · Python',
    repo: 'coqui/XTTS-v2',
    revision: null,
    rating: 6,
    ratingNotes: 'Legacy quality but very broad tooling support; non-commercial CPML.',
    license: { id: 'Coqui-CPML', name: 'Coqui Public Model License', commercial: false, restricted: true, url: 'https://coqui.ai/cpml' },
    languages: langs(
      ['ar', 'Arabic', { locale: 'ar-SA', arabic: true }], ['en', 'English', { locale: 'en-US' }], ['es', 'Spanish'],
      ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['pl', 'Polish'],
      ['tr', 'Turkish'], ['ru', 'Russian'], ['nl', 'Dutch'], ['cs', 'Czech'], ['zh', 'Chinese'],
      ['ja', 'Japanese'], ['hu', 'Hungarian'], ['ko', 'Korean'], ['hi', 'Hindi'],
    ),
    capabilities: caps({ voiceClone: true, cloneKind: 'local', emotion: true, multiSpeaker: true, streaming: true, speed: true, seed: true }),
    voices: { format: 'xtts-reference', note: 'Local reference clones; multi-reference style transfer.' },
    hardware: { backend: 'sidecar', minRamGb: 12, recRamGb: 24, minVramGb: 4, recVramGb: 8, diskGb: 2.1 },
    defaults: { quality: 'f32', device: 'auto', temperature: 0.7, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['local-runtime', 'clone', 'multilingual', 'arabic', 'non-commercial'],
    runtimePack: unavailable('The XTTS-v2 sidecar pack is not installed. Sidecar models are opt-in downloads; this build ships the supervisor only.'),
    estimatedBytes: 2000000000,
  },
];

async function fetchTree(repo, revision) {
  const response = await fetch(`${HF}/api/models/${repo}/tree/${revision}?recursive=true`, { headers: UA });
  if (!response.ok) throw new Error(`Tree request failed for ${repo}: ${response.status}`);
  return response.json();
}

async function sha256OfRemote(repo, revision, name) {
  const response = await fetch(`${HF}/${repo}/resolve/${revision}/${name}`, { headers: UA });
  if (!response.ok) throw new Error(`Download failed for ${repo}/${name}: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { sha256: crypto.createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length };
}

// Files each model's adapter needs, pinned to an exact Hugging Face revision.
// `weight` marks the file that represents the model's (single) quality option.
// Gated repos (Phonon 40M, OpenAudio) are pinned from tree metadata, which is
// public: LFS files carry their SHA-256 and small files their git blob SHA-1.
const ALL = /./;
const pins = {
  'phonon-40m-multilingual': { files: phononFiles['phonon-40m-multilingual'].map(([name]) => name) },
  'kokoro-82m': { include: [/^config\.json$/, /^kokoro-v1_0\.pth$/, /^voices\/.+\.pt$/], weight: 'kokoro-v1_0.pth' },
  'supertonic-3': { include: [/^config\.json$/, /^onnx\//, /^voice_styles\//], weight: 'onnx/vector_estimator.onnx' },
  'silma-tts': { revision: '226dd7a65cadf51f9a6dbe3953fc89003b3844d5', include: [/^model\.pt$/, /^vocab\.txt$/, /^config\.yaml$/], weight: 'model.pt' },
  chatterbox: {
    revision: '5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18',
    files: ['ve.pt', 't3_mtl23ls_v2.safetensors', 's3gen.pt', 'grapheme_mtl_merged_expanded_v1.json', 'conds.pt', 'Cangjie5_TC.json'],
    weight: 't3_mtl23ls_v2.safetensors',
  },
  'openaudio-s1-mini': { revision: 'f4b445029346701e082b60bb63fcc2d1bb17a0e2', include: [ALL], weight: 'model.pth' },
  'qwen3-tts': { revision: 'fd4b254389122332181a7c3db7f27e918eec64e3', include: [ALL], weight: 'model.safetensors' },
  omnivoice: { revision: 'c5fdb5ccb189668d56333f77ba2629f4cd7535f4', include: [ALL], weight: 'model.safetensors' },
  voxcpm2: { revision: '32279effe8c19989596f05d353d1447f51d9e915', include: [ALL], weight: 'model.safetensors' },
  'moss-tts': { revision: 'cdd3b911b1585e3f2dbc7775ef10f9926f58850a', include: [ALL], weight: 'model-00001-of-00004.safetensors' },
  'breeze-tts2': { revision: '3e28c5151381a722f1d8661b4118c298caa77aa4', include: [ALL], exclude: [/^assets\//], weight: 'model-00001-of-00002.safetensors' },
  'audio8-tts': { revision: '20e519d6e2c485ea1544f95f1fcaa6de6712bfc2', include: [ALL], exclude: [/\.jpe?g$/], weight: 'model.safetensors' },
  // The Qwen emotion-text model is optional and disabled in the adapter.
  indextts2: { revision: '740dcaff396282ffb241903d150ac011cd4b1ede', include: [ALL], exclude: [/^qwen0\.6bemo4-merge\//, /^LICENSE/], weight: 'gpt.pth' },
  'xtts-v2': {
    revision: '6c2b0d75eae4b7047358e3b6bd9325f857d43f77',
    files: ['config.json', 'dvae.pth', 'mel_stats.pth', 'model.pth', 'speakers_xtts.pth', 'vocab.json'],
    weight: 'model.pth',
  },
};
// What each model accepts beyond plain text, and how the Studio exposes it.
// `tags` are inserted into the text; `instruction`, `attributes` and `intensity`
// are sent alongside it. The emotion/nonVerbal capability flags derive from this.
const tag = (token, label, kind = 'sound') => ({ token, label, kind });
const EXPRESSION = {
  'supertonic-3': {
    note: 'Supertonic reads expression tags inside the text. Its voice style comes from the preset voices.',
    tags: [tag('<laugh>', 'Laugh'), tag('<breath>', 'Breath'), tag('<sigh>', 'Sigh')],
  },
  voxcpm2: {
    note: 'Describe the voice to design it, or the delivery when you use a reference clip.',
    instruction: {
      label: 'Voice description',
      placeholder: 'A young woman, gentle and sweet voice',
      examples: ['A young woman, gentle and sweet voice', 'A mature male narrator, calm and deep', 'Slightly faster, cheerful tone'],
      maxLength: 300,
    },
  },
  'breeze-tts2': {
    note: 'An instruction designs the voice, or directs the delivery of a reference clip. Vocal events go in the text.',
    instruction: {
      label: 'Voice direction',
      placeholder: 'A warm, thoughtful young woman with a clear voice and a calm, reflective delivery.',
      examples: [
        'A warm, thoughtful young woman with a clear voice and a calm, reflective delivery.',
        'Speak slowly with a restrained, serious tone.',
      ],
      maxLength: 400,
    },
    tags: [tag('(sigh)', 'Sigh'), tag('(clears throat)', 'Clear throat'), tag('[叹气]', '叹气 (sigh, Chinese)'), tag('[笑]', '笑 (laugh, Chinese)')],
  },
  omnivoice: {
    note: 'Pick voice attributes to design a voice. Accents apply to English.',
    attributes: [
      { id: 'gender', label: 'Gender', options: ['male', 'female'] },
      { id: 'age', label: 'Age', options: ['child', 'teenager', 'young adult', 'middle-aged', 'elderly'] },
      { id: 'pitch', label: 'Pitch', options: ['very low pitch', 'low pitch', 'moderate pitch', 'high pitch', 'very high pitch'] },
      { id: 'style', label: 'Style', options: ['whisper'] },
      {
        id: 'accent',
        label: 'Accent',
        options: ['american accent', 'british accent', 'australian accent', 'canadian accent', 'indian accent', 'chinese accent', 'japanese accent', 'korean accent', 'portuguese accent', 'russian accent'],
      },
    ],
  },
  chatterbox: {
    note: 'Exaggeration controls how expressive the delivery is.',
    intensity: { label: 'Exaggeration', min: 0.25, max: 2, step: 0.05, default: 0.5, hint: '0.5 is neutral; higher is more dramatic.' },
  },
  'moss-tts': {
    note: 'Insert explicit pauses anywhere in the text.',
    tags: [tag('[pause 0.5s]', 'Pause 0.5s', 'pause'), tag('[pause 1.0s]', 'Pause 1s', 'pause'), tag('[pause 2.5s]', 'Pause 2.5s', 'pause')],
  },
  'openaudio-s1-mini': {
    note: 'Emotion and tone markers go at the start of a sentence; sound markers anywhere. From the OpenAudio documentation.',
    tags: [
      tag('(excited)', 'Excited', 'emotion'),
      tag('(sad)', 'Sad', 'emotion'),
      tag('(angry)', 'Angry', 'emotion'),
      tag('(surprised)', 'Surprised', 'emotion'),
      tag('(whispering)', 'Whispering', 'emotion'),
      tag('(shouting)', 'Shouting', 'emotion'),
      tag('(laughing)', 'Laughing'),
      tag('(sighing)', 'Sighing'),
      tag('(sobbing)', 'Sobbing'),
    ],
  },
};

function expressionCapabilities(expression) {
  if (!expression) return { emotion: false, nonVerbal: false };
  const tags = expression.tags || [];
  return {
    emotion: Boolean(expression.instruction || expression.attributes || expression.intensity || tags.some((item) => item.kind === 'emotion')),
    nonVerbal: tags.some((item) => item.kind === 'sound'),
  };
}

const ALWAYS_SKIP = [/(^|\/)README\.md$/i, /(^|\/)\.gitattributes$/, /\.(png|jpe?g|svg|gif)$/i, /^samples\//, /^audio_samples\//, /^img\//, /^eval\//];

async function pinFiles(model) {
  const spec = pins[model.id];
  if (!spec) throw new Error(`No pin specification for ${model.id}`);
  const revision = spec.revision || model.revision;
  const tree = (await fetchTree(model.repo, revision)).filter((entry) => entry.type === 'file');
  const byPath = new Map(tree.map((entry) => [entry.path, entry]));
  const selected = spec.files
    ? spec.files.map((name) => {
        const entry = byPath.get(name);
        if (!entry) throw new Error(`${model.repo}@${revision} is missing ${name}`);
        return entry;
      })
    : tree.filter(
        (entry) =>
          spec.include.some((pattern) => pattern.test(entry.path)) &&
          !(spec.exclude || []).some((pattern) => pattern.test(entry.path)) &&
          !ALWAYS_SKIP.some((pattern) => pattern.test(entry.path)),
      );
  const files = selected.map((entry) => {
    if (!/^[0-9a-f]{40}$/.test(entry.oid || '')) throw new Error(`${model.id}/${entry.path} has no verifiable hash`);
    const isLfs = Boolean(entry.lfs);
    // Gated repos redact the LFS SHA-256 for anonymous callers, but the git id of
    // the LFS pointer is public and binds the content SHA-256 and size.
    const lfs = isLfs && /^[0-9a-f]{64}$/.test(entry.lfs.oid || '') ? entry.lfs.oid : '';
    const pin = lfs ? { sha256: lfs } : isLfs ? { sha256: '', lfsPointerSha1: entry.oid } : { sha256: '', gitSha1: entry.oid };
    return {
      name: entry.path,
      size: Number(entry.size),
      ...pin,
      required: true,
      ...(entry.path === spec.weight ? { quality: 'f32' } : {}),
    };
  });
  if (spec.weight && !files.some((file) => file.quality)) throw new Error(`${model.id}: weight file ${spec.weight} was not selected`);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  console.log(`  ${model.id}: pinned ${files.length} files, ${(total / 1e9).toFixed(2)} GB @ ${revision.slice(0, 10)}`);
  return { revision, files, total };
}

async function pinPhonon(model) {
  if (model.id === 'phonon-40m-multilingual') {
    // Gated on Hugging Face: the file hashes are public, the bytes need the
    // user's token after they accept the license on the model page.
    const { files } = await pinFiles(model);
    const quality = Object.fromEntries(phononFiles[model.id].map(([name, , kind]) => [name, kind]));
    model.files = files.map((file) => {
      const kind = quality[file.name];
      const { quality: _ignored, ...rest } = file;
      return { ...rest, required: !kind || kind === 'voice', ...(kind === 'q8' || kind === 'f32' ? { quality: kind } : {}) };
    });
    model.filesVerified = true;
    model.gated = true;
    model.runtimePack = { available: true };
    return model;
  }
  const tree = await fetchTree(model.repo, model.revision);
  const byPath = new Map(tree.map((entry) => [entry.path, entry]));
  const files = [];
  for (const [name, declaredSize, quality] of phononFiles[model.id]) {
    const entry = byPath.get(name);
    if (!entry) throw new Error(`${model.repo} is missing ${name}`);
    const size = Number(entry.size);
    if (size !== declaredSize) throw new Error(`${model.id}/${name}: expected ${declaredSize}, found ${size}`);
    let sha256 = entry.lfs && typeof entry.lfs.oid === 'string' ? entry.lfs.oid : '';
    if (!sha256) {
      const remote = await sha256OfRemote(model.repo, model.revision, name);
      if (remote.bytes !== size) throw new Error(`${model.id}/${name}: size drift ${remote.bytes} !== ${size}`);
      sha256 = remote.sha256;
    }
    files.push({
      name,
      size,
      sha256,
      required: !quality || quality === 'voice',
      ...(quality === 'q8' || quality === 'f32' ? { quality } : {}),
    });
    console.log(`  ${model.id}/${name}: pinned ${size} bytes`);
  }
  model.files = files;
  model.filesVerified = true;
  model.runtimePack = { available: true };
  return model;
}

const GATED = new Set(['phonon-40m-multilingual', 'openaudio-s1-mini']);

const built = [];
for (const model of models) {
  if (model.id.startsWith('phonon-')) {
    built.push(await pinPhonon(model));
    continue;
  }
  // Sidecar models: the runtime pack is built on the user's machine from the
  // recipe in runtimes.json, and the weights below are downloaded and verified.
  const { revision, files, total } = await pinFiles(model);
  const weightsGb = Math.ceil((total / 1e9) * 10) / 10;
  built.push({
    ...model,
    revision,
    files,
    filesVerified: true,
    ...(GATED.has(model.id) ? { gated: true } : {}),
    defaults: { ...model.defaults, quality: 'f32' },
    hardware: { ...model.hardware, diskGb: weightsGb },
    runtimePack: {
      available: false,
      packId: `${model.id}-sidecar`,
      reason: `${model.shortName} runs in its own Python environment, which is built on this computer when you install the model.`,
    },
    estimatedBytes: total,
  });
}

const document = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  defaultModelId: 'phonon-31m-en',
  voiceCatalog: {
    repo: 'gradium/phonon-voices',
    revision: '0ee17205f254b5abc43b266c8a0f215565c352f7',
    fileSize: 256136,
  },
  models: built.map((model, index) => ({
    ...base,
    ...model,
    // Derived capabilities: Arabic from the declared languages, emotion and
    // non-verbal sounds from what the Expression panel can actually send.
    capabilities: {
      ...model.capabilities,
      ...expressionCapabilities(EXPRESSION[model.id]),
      arabic: model.languages.some((language) => language.arabic || language.code === 'ar'),
    },
    ...(EXPRESSION[model.id] ? { expression: EXPRESSION[model.id] } : {}),
    order: index,
    downloadBytes:
      model.files && model.files.length
        ? model.files.filter((file) => file.required || file.quality === 'q8').reduce((total, file) => total + file.size, 0)
        : model.estimatedBytes || Math.round((model.hardware?.diskGb || 0) * 1_000_000_000),
  })),
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`Wrote ${document.models.length} manifests to ${path.relative(root, output)}`);
