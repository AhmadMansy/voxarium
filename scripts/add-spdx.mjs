// Adds `SPDX-License-Identifier: AGPL-3.0-or-later` to first-party source files.
// Safe to re-run: files that already have an SPDX line are skipped.
// Usage: node scripts/add-spdx.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPDX = 'SPDX-License-Identifier: AGPL-3.0-or-later';
const check = process.argv.includes('--check');

const TARGETS = [
  { dir: 'src', exts: ['.ts', '.tsx'], comment: (t) => `// ${t}` },
  { dir: 'electron', exts: ['.cjs'], comment: (t) => `// ${t}` },
  { dir: 'scripts', exts: ['.mjs', '.js'], comment: (t) => `// ${t}` },
  { dir: 'electron/sidecars', exts: ['.py'], comment: (t) => `# ${t}` },
];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', 'phonon', 'ort', '__pycache__']);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const seen = new Set();
let changed = 0;
let missing = 0;
for (const target of TARGETS) {
  const base = path.join(root, target.dir);
  if (!fs.existsSync(base)) continue;
  for (const file of walk(base)) {
    if (seen.has(file) || !target.exts.includes(path.extname(file))) continue;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('SPDX-License-Identifier')) continue;
    missing += 1;
    if (check) {
      console.log(`missing: ${path.relative(root, file)}`);
      continue;
    }
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const line = target.comment(SPDX) + eol;
    // A byte-order mark must stay the very first character, so the header goes after it.
    const bom = text.startsWith('﻿') ? '﻿' : '';
    const body = bom ? text.slice(1) : text;
    let next;
    if (body.startsWith('#!')) {
      const idx = body.indexOf('\n') + 1;
      next = bom + body.slice(0, idx) + line + body.slice(idx);
    } else {
      next = bom + line + body;
    }
    fs.writeFileSync(file, next);
    changed += 1;
  }
}
if (check) process.exit(missing ? 1 : 0);
console.log(`SPDX header added to ${changed} file(s).`);
