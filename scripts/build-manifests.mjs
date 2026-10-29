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
    runtime: 'onnx-web',
    runtimeLabel: 'ONNX Runtime Web · WASM / WebGPU',
    repo: 'hexgrad/Kokoro-82M',
    revision: null,
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
    hardware: { backend: 'onnx-web', minRamGb: 4, recRamGb: 8, minVramGb: 0, recVramGb: 0, diskGb: 0.2 },
    defaults: { quality: 'q8', device: 'auto', temperature: 0.3, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['browser-native', 'english', 'multilingual', 'cpu-friendly', 'commercial'],
    runtimePack: unavailable('The Kokoro ONNX pipeline is not bundled in this build. The shared ONNX worker is installed and ready for the runtime pack.'),
    estimatedBytes: 90000000,
  },
  {
    id: 'supertonic-3',
    name: 'Supertonic 3',
    shortName: 'Supertonic',
    family: 'Supertonic',
    description:
      '31-language ONNX model that runs comfortably on CPU. Four small graphs, expression tags and full Arabic coverage.',
    runtime: 'onnx-web',
    runtimeLabel: 'ONNX Runtime Web · WASM / WebGPU',
    repo: 'Supertone/supertonic-3',
    revision: null,
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
    capabilities: caps({ streaming: true, emotion: true, normalization: true, seed: true }),
    voices: { format: 'supertonic-style', note: 'Style presets instead of speaker embeddings.', compatibleLocales: ['ar-sa', 'en-us'] },
    hardware: { backend: 'onnx-web', minRamGb: 6, recRamGb: 12, minVramGb: 0, recVramGb: 0, diskGb: 0.45 },
    defaults: { quality: 'q8', device: 'auto', temperature: 0.3, seed: '4242424242424242', language: 'en', rewrites: 'default', threads: 'auto' },
    tags: ['browser-native', 'multilingual', 'arabic', 'cpu-friendly', 'commercial'],
    runtimePack: unavailable('The Supertonic 3 ONNX graphs are not bundled in this build. The shared ONNX worker is installed and ready for the runtime pack.'),
    estimatedBytes: 420000000,
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

async function pinPhonon(model) {
  if (model.id === 'phonon-40m-multilingual') {
    // The official repository is gated on Hugging Face and the only community
    // mirror does not match the official LFS hashes, so nothing can be pinned
    // honestly yet. Keep the card, manifest and adapter path, but disable
    // automatic installs.
    model.files = [];
    model.filesVerified = false;
    model.runtimePack = unavailable(
      'The official Phonon 40M repository is gated on Hugging Face, so its files cannot be pinned and verified automatically. Accept the license on the model page and install the files manually; the Phonon adapter and voice catalog are already wired for it.',
    );
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

const built = [];
for (const model of models) {
  if (model.id.startsWith('phonon-')) {
    built.push(await pinPhonon(model));
  } else {
    // Sidecar models point at a separately installed runtime pack. The pack
    // catalog lives in runtimes.json; no pack is bundled with the installer.
    const runtimePack =
      model.runtime === 'sidecar'
        ? { ...model.runtimePack, packId: `${model.id}-sidecar` }
        : model.runtimePack;
    built.push({ ...model, files: [], filesVerified: false, runtimePack });
  }
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
