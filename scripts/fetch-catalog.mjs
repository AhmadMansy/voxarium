// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the bundled voice catalog from the public Phonon voices metadata.
// Run with: npm run catalog
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE =
  'https://huggingface.co/onnx-community/phonon-31m-en-ONNX/raw/main/voices/voices.jsonl';

const MODEL_REPO = 'gradium/phonon-31m-en';
const MODEL_REVISION = '92741c5b07d085ff840e26fea8ce43110b87852f';
const VOICES_REPO = 'gradium/phonon-voices';
const VOICES_REVISION = '0ee17205f254b5abc43b266c8a0f215565c352f7';

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`Catalog download failed: ${response.status}`);
const lines = (await response.text()).trim().split(/\r?\n/);

const voices = [
  {
    id: 'default',
    name: 'Phonon Default',
    language: 'en',
    locale: 'en-us',
    gender: null,
    age: null,
    description: "The checkpoint's original default voice, tuned by the Phonon team.",
    file: 'default-voice.safetensors',
    isDefault: true,
  },
  ...lines.map((line) => {
    const item = JSON.parse(line);
    return {
      id: item.voice_id,
      name: item.name,
      language: item.language,
      locale: item.locale,
      gender: item.gender ?? null,
      age: item.age ?? null,
      description: item.description,
      file: `${item.voice_id}.safetensors`,
      isDefault: false,
    };
  }),
];

const catalog = {
  generatedAt: new Date().toISOString(),
  model: {
    repo: MODEL_REPO,
    revision: MODEL_REVISION,
    name: 'Phonon 31M English',
    parameterCount: '31M',
    sampleRate: 24000,
    license: 'Apache-2.0',
  },
  voicesRepo: { repo: VOICES_REPO, revision: VOICES_REVISION },
  voices,
};

mkdirSync(join(root, 'src', 'data'), { recursive: true });
writeFileSync(join(root, 'src', 'data', 'voices.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log(`[catalog] wrote ${voices.length} voices to src/data/voices.json`);
