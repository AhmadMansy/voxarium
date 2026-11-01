// SPDX-License-Identifier: AGPL-3.0-or-later
// WCAG contrast check for the design tokens in src/styles/tokens.css.
// It reads the real token values (hex and hsl) and checks the text/surface pairs the app
// actually uses, for both themes and every accent. Exits non-zero on a failure.
// Usage: node scripts/check-contrast.mjs [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src/styles/tokens.css'), 'utf8');
const verbose = process.argv.includes('--verbose');

/** Extracts `--name: value;` declarations from the first block whose selector matches. */
function block(selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`Selector not found: ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const vars = {};
  for (const match of css.slice(open + 1, close).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars[match[1]] = match[2].trim();
  return vars;
}

function parse(value, over = [1, 1, 1]) {
  const hex = value.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  const hsl = value.match(/^hsl\(\s*([0-9.]+)\s+([0-9.]+)%\s+([0-9.]+)%\s*\)$/);
  if (hsl) {
    const [h, s, l] = [Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100];
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  }
  const rgba = value.match(/^rgba?\(\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)(?:,\s*([0-9.]+))?\s*\)$/);
  if (rgba) {
    const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
    return [1, 2, 3].map((i, index) => (Number(rgba[i]) / 255) * alpha + over[index] * (1 - alpha));
  }
  throw new Error(`Cannot parse colour: ${value}`);
}

const lum = ([r, g, b]) => {
  const c = [r, g, b].map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const themes = { dark: block(':root[data-theme="dark"] {'), light: block(':root[data-theme="light"] {') };
const accents = ['signal', 'violet', 'cyan', 'amber', 'rose'].map((name) => ({ name, vars: block(`:root[data-accent="${name}"] {`) }));
// Per-theme accent text overrides, e.g. `:root[data-theme="light"][data-accent="signal"] { --accent-text: ...; --accent: ... }`.
function lightOverride(name) {
  const match = css.match(new RegExp(`:root\\[data-theme="light"\\]\\[data-accent="${name}"\\]\\s*\\{([^}]*)\\}`));
  const vars = {};
  for (const m of match[1].matchAll(/--([a-z-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const failures = [];
const rows = [];
function check(label, fg, bg, min) {
  const value = ratio(fg, bg);
  const ok = value >= min;
  rows.push({ label, value, min, ok });
  if (!ok) failures.push(`${label}: ${value.toFixed(2)} < ${min}`);
}

for (const [theme, t] of Object.entries(themes)) {
  const bg = parse(t.bg);
  const card = parse(t.card);
  for (const [surfaceName, surface] of [['bg', bg], ['card', card]]) {
    check(`${theme} text on ${surfaceName}`, parse(t.text), surface, 7);
    check(`${theme} text-soft on ${surfaceName}`, parse(t['text-soft']), surface, 4.5);
    check(`${theme} text-muted on ${surfaceName}`, parse(t['text-muted']), surface, 4.5);
    for (const status of ['ok', 'warn', 'danger']) check(`${theme} ${status} on ${surfaceName}`, parse(t[status]), surface, 4.5);
  }
  for (const accent of accents) {
    const fill = theme === 'light' ? parse(lightOverride(accent.name).accent || accent.vars.accent) : parse(accent.vars.accent);
    const textVar = theme === 'light' ? lightOverride(accent.name)['accent-text'] : accent.vars.accent;
    // Ink on a filled button/tile, accent as text and icons on the surfaces it appears on.
    check(`${theme}/${accent.name} ink on accent fill`, parse(accent.vars['accent-ink']), fill, 4.5);
    check(`${theme}/${accent.name} accent-text on bg`, parse(textVar), bg, 4.5);
    check(`${theme}/${accent.name} accent-text on card`, parse(textVar), card, 4.5);
  }
}

const bad = rows.filter((row) => !row.ok);
if (verbose) for (const row of rows) console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${row.value.toFixed(2).padStart(5)}  (min ${row.min})  ${row.label}`);
console.log(`${rows.length} contrast pairs checked, ${bad.length} below their minimum.`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exit(bad.length ? 1 : 0);
