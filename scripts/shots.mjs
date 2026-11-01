// SPDX-License-Identifier: AGPL-3.0-or-later
// Captures screenshots of every page in both themes, for design review and the README.
// It launches the built app with an isolated profile and installs Phonon 31M through the
// real first-run flow, using local copies of the model files (no network).
//
// Usage: node scripts/shots.mjs [--out <dir>] [--models <dir>] [--sizes 1440x900,1120x720]
//        [--themes dark,light] [--accent violet|cyan|amber|rose]
// Run `npm run build` first. VOXARIUM_E2E_MODEL_DIR also points at the model files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const outDir = path.resolve(arg('out', path.join(root, 'research', 'shots')));
const themes = arg('themes', 'dark,light').split(',');
const sizes = arg('sizes', '1440x900').split(',').map((value) => value.split('x').map(Number));
const accent = arg('accent', '');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'electron/models/manifests.json'), 'utf8'));
const phonon = manifest.models.find((model) => model.id === 'phonon-31m-en');

const baseModelDir =
  arg('models', '') ||
  process.env.VOXARIUM_E2E_MODEL_DIR ||
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Voxarium', 'models');
const sourceDir = phonon.files.every((file) => fs.existsSync(path.join(baseModelDir, file.name))) ? baseModelDir : path.join(baseModelDir, phonon.id);
if (!phonon.files.every((file) => fs.existsSync(path.join(sourceDir, file.name)))) {
  console.error(`Model files are missing in ${sourceDir}. Pass --models <dir> with the five Phonon 31M files.`);
  process.exit(1);
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'voxarium-shots-'));
const staging = path.join(userData, 'models', '.staging', phonon.id);
fs.mkdirSync(staging, { recursive: true });
fs.mkdirSync(path.join(userData, 'out'), { recursive: true });
for (const file of phonon.files) {
  const part = path.join(staging, `${file.name}.part`);
  try {
    fs.linkSync(path.join(sourceDir, file.name), part);
  } catch {
    fs.copyFileSync(path.join(sourceDir, file.name), part);
  }
}
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ setupComplete: false, onboardingDismissed: false, outputDir: path.join(userData, 'out'), activeModelId: phonon.id, autoSave: true, autoPlay: false, quality: 'q8', device: 'cpu', ...(accent ? { accent } : {}) }),
);
fs.mkdirSync(outDir, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let app;
try {
  app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, VOXARIUM_USER_DATA: userData } });
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell', { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.studio?.models));

  const resize = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, [w, h]) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(w, h);
      win.center();
    }, [width, height]);
    await wait(500);
  };
  const setTheme = async (theme) => {
    // The theme is a plain attribute on <html>; setting it directly is enough for a screenshot.
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await wait(300);
  };
  const shot = async (name, size, theme) => {
    const file = path.join(outDir, `${theme}-${size[0]}x${size[1]}-${name}.png`);
    await page.screenshot({ path: file });
    console.log(`  ${path.relative(root, file)}`);
  };

  // First-run chooser (before any model is installed).
  await resize(...sizes[0]);
  await page.waitForSelector('.setup-picker', { timeout: 30000 });
  for (const theme of themes) {
    await setTheme(theme);
    await shot('01-setup', sizes[0], theme);
  }
  await setTheme(themes[0]);

  // Install Phonon through the real flow.
  await page.locator('.setup-model-option', { hasText: phonon.shortName }).first().click();
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await page.waitForSelector('.setup-model-config');
  await page.getByRole('button', { name: /Download & install/ }).click();
  await page.waitForSelector('.setup-done', { timeout: 180000 });
  await page.getByRole('button', { name: /Start creating/ }).click();
  await page.waitForSelector('.wizard', { state: 'detached' });

  // One real take so History, the render card and the player have content.
  await page.locator('.nav-item', { hasText: 'Studio' }).click();
  await page.waitForSelector('.engine-mini .status-dot--ok', { timeout: 180000 });
  await page.locator('.editor__area').fill('Welcome to Voxarium. Every word you hear was generated on this computer, with no cloud service involved.');
  await page.getByRole('button', { name: /Generate speech|Generate/ }).first().click();
  await page.waitForSelector('.render__head', { timeout: 180000 });
  // Dismiss transient toasts so they never sit on top of a screenshot.
  for (let i = 0; i < 6 && (await page.locator('.toast__close').count()); i += 1) {
    await page.locator('.toast__close').first().click().catch(() => {});
    await wait(250);
  }
  await wait(600);

  const pages = [
    ['02-studio', 'Studio'],
    ['03-models', 'Models'],
    ['04-voices', 'Voices'],
    ['05-history', 'History'],
    ['06-batch', 'Batch'],
    ['07-integrations', 'Integrations'],
    ['08-settings', 'Settings'],
  ];
  for (const size of sizes) {
    await resize(...size);
    for (const theme of themes) {
      await setTheme(theme);
      for (const [name, label] of pages) {
        await page.locator('.nav-item', { hasText: label }).first().click();
        await wait(700);
        await shot(name, size, theme);
      }
      // The Add a voice dialog.
      await page.locator('.nav-item', { hasText: 'Voices' }).first().click();
      await page.getByRole('button', { name: /Add a voice/ }).first().click();
      await page.waitForSelector('.add-voice');
      await wait(400);
      await shot('09-add-voice', size, theme);
      await page.keyboard.press('Escape');
      await wait(300);
    }
  }
  console.log(`\nScreenshots written to ${outDir}`);
} finally {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
}
