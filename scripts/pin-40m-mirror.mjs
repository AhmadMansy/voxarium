// SPDX-License-Identifier: AGPL-3.0-or-later
// Verifies the community mirror of Phonon 40M against the official (gated)
// Gradium tree before pinning hashes. Writes electron/models/phonon-40m-pin.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const HF = 'https://huggingface.co';
const OFFICIAL = 'gradium/phonon-40m-multilingual';
const MIRROR = 'empyrealworks/Phonon-40M-multilingual';
const VOICES = 'gradium/phonon-voices';
const OFFICIAL_REV = '1537ce46c64f42903e0d608b132ccb073dac46d2';
const MIRROR_REV = '163ca9cf4e922dd0af5e1ec69cb3f07eab2aee93';
const VOICES_REV = '0ee17205f254b5abc43b266c8a0f215565c352f7';

const get = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response;
};

const tree = async (repo, rev) => (await (await get(`${HF}/api/models/${repo}/tree/${rev}?recursive=true`)).json());

const official = new Map((await tree(OFFICIAL, OFFICIAL_REV)).map((entry) => [entry.path, entry]));
const mirror = new Map((await tree(MIRROR, MIRROR_REV)).map((entry) => [entry.path, entry]));
const voices = new Map((await tree(VOICES, VOICES_REV)).map((entry) => [entry.path, entry]));

const small = ['config.json', 'tokenizer.json'];
const lfs = ['model.q8.gguf'];
const pinned = {};

for (const name of small) {
  const a = official.get(name);
  const b = mirror.get(name);
  if (!a || !b) throw new Error(`missing ${name}`);
  if (a.oid !== b.oid) throw new Error(`git blob mismatch for ${name}`);
  const buffer = Buffer.from(await (await get(`${HF}/${MIRROR}/resolve/${MIRROR_REV}/${name}`)).arrayBuffer());
  if (buffer.length !== a.size) throw new Error(`size drift for ${name}`);
  pinned[name] = { size: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), verification: 'sha256' };
  console.log(`${name}: ${buffer.length} bytes, git oid matches official, sha256 pinned`);
}

for (const name of lfs) {
  const a = official.get(name);
  const b = mirror.get(name);
  if (!a || !b || !a.lfs || !b.lfs) throw new Error(`missing lfs ${name}`);
  if (a.lfs.oid !== b.lfs.oid) throw new Error(`lfs sha mismatch for ${name}`);
  if (a.size !== b.size) throw new Error(`lfs size mismatch for ${name}`);
  pinned[name] = { size: a.size, sha256: a.lfs.oid, verification: 'sha256', source: MIRROR, revision: MIRROR_REV };
  console.log(`${name}: ${a.size} bytes, sha256 matches official LFS`);
}

const voiceOfficial = official.get('default-voice.safetensors');
const voiceCatalog = voices.get('default.safetensors');
if (!voiceOfficial || !voiceCatalog) throw new Error('default voice missing');
if (voiceOfficial.lfs && voiceCatalog.lfs && voiceOfficial.lfs.oid === voiceCatalog.lfs.oid) {
  pinned['default-voice.safetensors'] = {
    size: voiceCatalog.size,
    sha256: voiceCatalog.lfs.oid,
    verification: 'sha256',
    source: VOICES,
    revision: VOICES_REV,
    remoteName: 'default.safetensors',
  };
  console.log('default-voice.safetensors: matches public voice catalog');
}

const output = path.join(root, 'electron', 'models', 'phonon-40m-pin.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  `${JSON.stringify({ official: OFFICIAL, officialRevision: OFFICIAL_REV, mirror: MIRROR, mirrorRevision: MIRROR_REV, files: pinned }, null, 2)}\n`,
  'utf8',
);
console.log(`Wrote ${path.relative(root, output)}`);
