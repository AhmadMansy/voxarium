// SPDX-License-Identifier: AGPL-3.0-or-later
// Records a short silent screen capture of the app (setup, a generation, the pages), then adds the
// generated speech to the video with ffmpeg. Output goes to research/demo/ by default.
//
// Usage: node scripts/demo.mjs [--out <dir>] [--models <dir>]
// Run `npm run build` first. Needs ffmpeg on PATH. Model files come from VOXARIUM_E2E_MODEL_DIR.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const outDir = path.resolve(arg('out', path.join(root, 'research', 'demo')));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'electron/models/manifests.json'), 'utf8'));
const phonon = manifest.models.find((model) => model.id === 'phonon-31m-en');
const baseDir = arg('models', '') || process.env.VOXARIUM_E2E_MODEL_DIR || '';
const sourceDir = phonon.files.every((file) => fs.existsSync(path.join(baseDir, file.name))) ? baseDir : path.join(baseDir, phonon.id);
if (!phonon.files.every((file) => fs.existsSync(path.join(sourceDir, file.name)))) {
  console.error('Model files are missing. Pass --models <dir> or set VOXARIUM_E2E_MODEL_DIR.');
  process.exit(1);
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'voxarium-demo-'));
const staging = path.join(userData, 'models', '.staging', phonon.id);
fs.mkdirSync(staging, { recursive: true });
fs.mkdirSync(path.join(userData, 'out'), { recursive: true });
for (const file of phonon.files) fs.copyFileSync(path.join(sourceDir, file.name), path.join(staging, `${file.name}.part`));
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ setupComplete: false, onboardingDismissed: false, outputDir: path.join(userData, 'out'), activeModelId: phonon.id, autoSave: true, autoPlay: false, quality: 'q8', device: 'cpu' }),
);
fs.mkdirSync(outDir, { recursive: true });
const videoDir = path.join(userData, 'video');
fs.mkdirSync(videoDir, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let app;
try {
  app = await electron.launch({
    args: ['.'],
    cwd: root,
    env: { ...process.env, VOXARIUM_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1280, 800);
    win.center();
  });
  await page.waitForSelector('.app-shell', { timeout: 30000 });
  const bounds = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.show();
    win.setAlwaysOnTop(true);
    win.focus();
    return win.getContentBounds();
  });
  await wait(800);
  // Playwright's recordVideo stops Electron windows from loading and a window capture comes out
  // black, so grab the screen region under the window instead (the window is kept on top).
  const scale = (await page.evaluate(() => window.devicePixelRatio)) || 1;
  const rect = [bounds.x, bounds.y, bounds.width, bounds.height].map((value) => Math.round(value * scale));
  const capture = spawn('ffmpeg', ['-y', '-f', 'gdigrab', '-framerate', '25', '-offset_x', String(rect[0]), '-offset_y', String(rect[1]), '-video_size', `${rect[2] - (rect[2] % 2)}x${rect[3] - (rect[3] % 2)}`, '-i', 'desktop', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(videoDir, 'raw.mp4')], { stdio: ['pipe', 'ignore', 'ignore'] });
  const started = Date.now();
  await wait(1500);
  await page.waitForSelector('.app-shell', { timeout: 30000 });
  await page.waitForSelector('.setup-picker', { timeout: 30000 });
  await wait(2500);

  await page.locator('.setup-model-option', { hasText: phonon.shortName }).first().click();
  await wait(1200);
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await page.waitForSelector('.setup-model-config');
  await wait(1500);
  await page.getByRole('button', { name: /Download & install/ }).click();
  await page.waitForSelector('.setup-done', { timeout: 180000 });
  await wait(1500);
  await page.getByRole('button', { name: /Start creating/ }).click();
  await page.waitForSelector('.wizard', { state: 'detached' });

  await page.locator('.nav-item', { hasText: 'Studio' }).click();
  await page.waitForSelector('.engine-mini .status-dot--ok', { timeout: 180000 });
  await page.locator('.editor__area').click();
  await page.keyboard.type('Welcome to Voxarium. Every word you hear was generated on this computer, with no cloud service involved.', { delay: 28 });
  await wait(1200);
  await page.getByRole('button', { name: /Generate speech|Generate/ }).first().click();
  const generatedAt = (Date.now() - started) / 1000;
  await page.waitForSelector('.render__head', { timeout: 180000 });
  await wait(4500);

  for (const label of ['Models', 'Voices', 'History', 'Settings', 'Studio']) {
    await page.locator('.nav-item', { hasText: label }).first().click();
    await wait(2200);
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  });
  await wait(2500);

  capture.stdin.write('q');
  await new Promise((resolve) => capture.on('close', resolve));
  await page.close();
  await app.close();
  app = undefined;

  const video = fs.readdirSync(videoDir).find((name) => name.endsWith('.mp4'));
  const wavDir = ['audio', 'out'].map((name) => path.join(userData, name)).find((dir) => fs.existsSync(dir) && fs.readdirSync(dir).some((name) => name.endsWith('.wav')));
  const wav = wavDir && fs.readdirSync(wavDir).find((name) => name.endsWith('.wav'));
  if (!video) throw new Error('No video was recorded.');
  const target = path.join(outDir, 'voxarium-demo.mp4');
  const input = ['-y', '-i', path.join(videoDir, video)];
  const delayMs = Math.round((generatedAt + 3) * 1000);
  const args = wav
    ? [...input, '-i', path.join(wavDir, wav), '-filter_complex', `[1:a]adelay=${delayMs}|${delayMs}[a]`, '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-c:a', 'aac', '-shortest', target]
    : [...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', target];
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('ffmpeg failed.');
  console.log(`Wrote ${path.relative(root, target)}${wav ? ' (with the generated speech)' : ' (silent: no WAV was saved)'}`);
} finally {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
}
