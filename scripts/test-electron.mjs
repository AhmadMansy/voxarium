// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

/**
 * End-to-end smoke test for the model lifecycle.
 *
 * The download itself is stubbed without patching the app: complete `.part`
 * files are hard-linked into the model staging folder, so the real downloader
 * hashes and atomically installs them without touching the network. This keeps
 * the verification, install and uninstall paths honest.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'electron/models/manifests.json'), 'utf8'));
const phonon = manifest.models.find((model) => model.id === 'phonon-31m-en');
const gated = manifest.models.find((model) => model.id === 'phonon-40m-multilingual');

if (!fs.existsSync(path.join(root, 'dist/index.html'))) {
  console.error('dist/index.html is missing. Run `npm.cmd run build` first.');
  process.exit(1);
}

const baseModelDir =
  process.env.VOXARIUM_E2E_MODEL_DIR ||
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Voxarium', 'models');
const sourceDir = phonon.files.every((file) => fs.existsSync(path.join(baseModelDir, file.name)))
  ? baseModelDir
  : path.join(baseModelDir, phonon.id);

if (!phonon.files.every((file) => fs.existsSync(path.join(sourceDir, file.name)))) {
  console.error(
    `Model fixtures are missing in ${sourceDir}.\n` +
      'Run the app once to download Phonon 31M, or point VOXARIUM_E2E_MODEL_DIR at a folder with the five files.',
  );
  process.exit(1);
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'voxarium-e2e-'));
const staging = path.join(userData, 'models', '.staging', phonon.id);
fs.mkdirSync(staging, { recursive: true });
fs.mkdirSync(path.join(userData, 'audio'), { recursive: true });

for (const file of phonon.files) {
  const source = path.join(sourceDir, file.name);
  const part = path.join(staging, `${file.name}.part`);
  try {
    fs.linkSync(source, part);
  } catch {
    fs.copyFileSync(source, part);
  }
}

fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify(
    {
      setupComplete: false,
      onboardingDismissed: false,
      outputDir: path.join(userData, 'out'),
      lastVoice: 'default',
      defaultVoice: 'default',
      activeModelId: phonon.id,
      autoSave: true,
      autoPlay: false,
      quality: 'q8',
      device: 'cpu',
    },
    null,
    2,
  ),
  'utf8',
);
fs.mkdirSync(path.join(userData, 'out'), { recursive: true });

const consoleErrors = [];
const pageErrors = [];
const mainLogs = [];
let app;

const step = (message) => console.log(`→ ${message}`);
const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSnapshot(page, predicate, label, timeoutMs = 60000) {
  const started = Date.now();
  for (;;) {
    const snapshot = await page.evaluate(() => window.studio.models.snapshot());
    if (predicate(snapshot)) return snapshot;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await timeout(500);
  }
}

try {
  step('launching Voxarium with an isolated user data folder');
  app = await electron.launch({
    args: ['.'],
    cwd: root,
    env: { ...process.env, VOXARIUM_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  app.process().stdout?.on('data', (chunk) => mainLogs.push(String(chunk)));
  app.process().stderr?.on('data', (chunk) => mainLogs.push(String(chunk)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

  try {
    await page.waitForSelector('.app-shell', { timeout: 30000 });
  } catch (error) {
    console.error('window url:', page.url());
    console.error('window title:', await page.title().catch(() => '?'));
    console.error('body:', (await page.locator('body').innerText().catch(() => '?')).slice(0, 4000));
    throw error;
  }
  await page.waitForFunction(() => Boolean(window.studio?.models));

  step('opening the first-run model chooser');
  await page.waitForSelector('.setup-picker', { timeout: 30000 });
  const chooserCount = await page.locator('.setup-model-option').count();
  assert.equal(chooserCount, manifest.models.length, 'the chooser lists every model');
  const gatedOption = page.locator('.setup-model-option', { hasText: gated.shortName }).first();
  await gatedOption.waitFor();
  assert.match(await gatedOption.innerText(), /CC-BY-NC-4\.0/);
  assert.match(await gatedOption.innerText(), /Ready to install/);

  step('inspecting a gated, license-restricted model');
  await gatedOption.click();
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await page.waitForSelector('.setup-model-config');
  const gatedConfig = await page.locator('.setup-model-config').innerText();
  assert.match(gatedConfig, /Phonon 40M/);
  assert.match(gatedConfig, /CC-BY-NC-4\.0/);
  assert.equal(gated.gated, true, 'the gated repository is flagged for a Hugging Face token');
  assert.ok(gated.files.length > 0 && gated.filesVerified, 'gated files are pinned like any other model');

  step('choosing Phonon 31M and installing it from setup');
  await page.getByRole('button', { name: /Back to model list/ }).click();
  await page.waitForSelector('.setup-picker');
  await page.locator('.setup-model-option', { hasText: phonon.shortName }).first().click();
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await page.waitForSelector('.setup-model-config');
  assert.match(await page.locator('.setup-model-config').innerText(), /Phonon 31M/);
  await page.getByRole('button', { name: /Download & install/ }).click();
  const snapshot = await waitForSnapshot(
    page,
    (value) => value.models.find((model) => model.id === phonon.id)?.installed === true,
    'Phonon 31M installation',
    120000,
  );
  const install = snapshot.models.find((model) => model.id === phonon.id);
  assert.equal(install.lifecycle, 'installed');
  assert.equal(snapshot.runtimes.length, 15, 'the runtime catalog ships with 15 packs');
  await page.waitForSelector('.setup-done', { timeout: 180000 });
  await page.getByRole('button', { name: /Start creating/ }).click();
  await page.waitForSelector('.wizard', { state: 'detached' });

  step('browsing the full registry');
  await page.locator('.nav-item', { hasText: 'Models' }).click();
  await page.waitForSelector('.models-grid');
  const cardCount = await page.locator('.model-card').count();
  assert.equal(cardCount, manifest.models.length, 'every model stays visible');
  const phononCard = page.locator('.model-card', { hasText: phonon.shortName }).first();
  const gatedCard = page.locator('.model-card', { hasText: gated.shortName }).first();
  await phononCard.waitFor();
  assert.match(await phononCard.innerText(), /Apache-2\.0/);
  assert.match(await phononCard.innerText(), /Installed/);
  assert.match(await phononCard.innerText(), /Active/);
  assert.match(await gatedCard.innerText(), /CC-BY-NC-4\.0/);
  assert.match(await gatedCard.innerText(), /gated on Hugging Face/i);

  step('browsing the runtime pack catalog');
  const runtimePanel = page.locator('.runtimes-panel');
  await runtimePanel.waitFor();
  assert.equal(await runtimePanel.locator('.runtime-card').count(), 15, 'every runtime pack stays visible');
  const pythonRuntime = runtimePanel.locator('.runtime-card', { hasText: 'Python 3.12 runtime' }).first();
  await pythonRuntime.waitFor();
  assert.match(await pythonRuntime.innerText(), /PSF-2\.0/);
  assert.match(await pythonRuntime.innerText(), /Not installed/);
  assert.match(await pythonRuntime.innerText(), /Download/);
  const silmaRuntime = runtimePanel.locator('.runtime-card', { hasText: 'SILMA runtime' }).first();
  assert.match(await silmaRuntime.innerText(), /Build/);
  assert.match(await silmaRuntime.innerText(), /Import folder/);

  step('verifying every installed file');
  const verified = await page.evaluate((id) => window.studio.models.verify(id), phonon.id);
  assert.deepEqual(verified.mismatched, []);

  step('activating the installed model');
  const activated = await page.evaluate((id) => window.studio.models.activate(id), phonon.id);
  assert.equal(activated.ok, true, activated.error);

  step('opening the studio and synthesizing speech');
  await page.locator('.nav-item', { hasText: 'Studio' }).click();
  await page.waitForSelector('.editor__area');
  await page.waitForSelector('.engine-mini .status-dot--ok', { timeout: 180000 });
  const text = 'The model registry is working. This sentence was synthesized on this device.';
  await page.locator('.editor__area').fill(text);
  await page.getByRole('button', { name: /Generate speech/ }).click();
  await page.waitForSelector('.render__head', { timeout: 180000 });
  const entries = await page.evaluate(() => window.studio.history.list());
  const entry = entries.find((item) => item.text === text);
  assert.ok(entry, 'the take was saved to history');
  assert.equal(entry.meta.modelId, phonon.id);
  assert.equal(entry.meta.modelName, phonon.name);
  assert.equal(entry.meta.license, phonon.license.id);
  assert.equal(entry.text, text);
  const audioExists = await page.evaluate((file) => window.studio.audio.exists(file), entry.filePath);
  assert.equal(audioExists, true, 'the rendered WAV exists on disk');

  step('opening the model-aware pages without renderer errors');
  for (const [label, selector] of [
    ['Voices', '.page--voices'],
    ['History', '.page--history'],
    ['Batch', '.page--batch'],
    ['Settings', '.page--settings'],
  ]) {
    await page.locator('.nav-item', { hasText: label }).click();
    await page.waitForSelector(selector);
  }
  const about = await page.locator('.about-grid').innerText();
  assert.ok(about.includes(phonon.name), 'Settings reports the active model');
  assert.ok(about.includes(phonon.runtimeLabel.split(' · ')[0]), 'Settings reports the active runtime');

  step('refusing a switch to a model that is not installed');
  await page.locator('.nav-item', { hasText: 'Models' }).click();
  const refused = await page.evaluate((id) => window.studio.models.activate(id), gated.id);
  assert.equal(refused.ok, false);
  const afterRefusal = await page.evaluate(() => window.studio.models.snapshot());
  assert.equal(afterRefusal.activeModelId, phonon.id, 'the previous model stays active');
  assert.match(await page.locator('.model-card', { hasText: phonon.shortName }).first().innerText(), /Active/);

  step('uninstalling the model and reflecting it in the registry');
  const removed = await page.evaluate((id) => window.studio.models.uninstall(id), phonon.id);
  assert.equal(removed.ok, true);
  const afterRemoval = await waitForSnapshot(
    page,
    (value) => value.models.find((model) => model.id === phonon.id)?.installed === false,
    'Phonon 31M removal',
  );
  assert.equal(afterRemoval.models.find((model) => model.id === phonon.id).lifecycle, 'not-installed');
  await page.waitForFunction(
    (name) => {
      const card = [...document.querySelectorAll('.model-card')].find((node) => node.textContent?.includes(name));
      return card?.textContent?.includes('Not installed');
    },
    phonon.shortName,
    { timeout: 20000 },
  );

  assert.deepEqual(pageErrors, [], `renderer page errors:\n${pageErrors.join('\n')}`);
  assert.deepEqual(consoleErrors, [], `renderer console errors:\n${consoleErrors.join('\n')}`);
  console.log(
    '\nE2E model lifecycle passed: first-run chooser → gated inspection → setup install → verify → activate → synthesize → page sweep → switch refusal → uninstall',
  );
} catch (error) {
  if (mainLogs.length) {
    console.error('\nElectron main process output:');
    console.error(mainLogs.join('').trim());
  }
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
}
