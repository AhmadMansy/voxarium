// SPDX-License-Identifier: AGPL-3.0-or-later
// Produces the launch demo video: a scripted tour of the app with captions, a narration made by the
// app itself, original music and sound effects. Output goes to research/demo/voxarium-demo.mp4.
//
// Usage: node scripts/demo.mjs [--out <dir>] [--models <dir>] [--regen]
// Run `npm run build` first. Needs ffmpeg on PATH. The app is captured from inside, frame by frame,
// so nothing else on screen can appear. Model files: VOXARIUM_E2E_MODEL_DIR. Narration is cached in <out>/vo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const outDir = path.resolve(arg('out', path.join(root, 'research', 'demo')));
const voDir = path.join(outDir, 'vo');
const regen = process.argv.includes('--regen');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'electron/models/manifests.json'), 'utf8'));
const phonon = manifest.models.find((model) => model.id === 'phonon-31m-en');
const baseDir = arg('models', '') || process.env.VOXARIUM_E2E_MODEL_DIR || '';
const sourceDir = phonon.files.every((file) => fs.existsSync(path.join(baseDir, file.name))) ? baseDir : path.join(baseDir, phonon.id);
if (!phonon.files.every((file) => fs.existsSync(path.join(sourceDir, file.name)))) {
  console.error('Model files are missing. Pass --models <dir> or set VOXARIUM_E2E_MODEL_DIR.');
  process.exit(1);
}
fs.mkdirSync(voDir, { recursive: true });

const SCRIPT = {
  intro: 'This is Voxarium. A text to speech studio that runs entirely on your computer.',
  choose: 'Pick a model. Each one shows its license, and how well it fits your hardware.',
  install: 'Voxarium downloads it, checks every file, and tests the voice before you use it.',
  studio: 'Write a script. Press generate. Hear it in seconds.',
  tour: 'Seventeen models. Your own voices. Batch scripts, a local A P I, and an M C P server for your agents.',
  theme: 'Dark or light, it is your studio.',
  outro: 'No account. No cloud. No telemetry. Open source, on GitHub.',
};
const SAMPLE_TEXT = 'Every word you hear was generated on this computer, with no cloud service involved.';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seed = (name) => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `voxarium-${name}-`));
  const staging = path.join(userData, 'models', '.staging', phonon.id);
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(path.join(userData, 'out'), { recursive: true });
  for (const file of phonon.files) fs.copyFileSync(path.join(sourceDir, file.name), path.join(staging, `${file.name}.part`));
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({ setupComplete: false, onboardingDismissed: false, outputDir: path.join(userData, 'out'), activeModelId: phonon.id, autoSave: true, autoPlay: false, quality: 'q8', device: 'cpu' }),
  );
  return userData;
};
const wavsIn = (userData) =>
  ['audio', 'out']
    .map((name) => path.join(userData, name))
    .filter((dir) => fs.existsSync(dir))
    .flatMap((dir) => fs.readdirSync(dir).filter((name) => name.endsWith('.wav')).map((name) => path.join(dir, name)))
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
const duration = (file) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout);

async function install(page) {
  await page.waitForSelector('.setup-picker', { timeout: 30000 });
  await page.locator('.setup-model-option', { hasText: phonon.shortName }).first().click();
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await page.waitForSelector('.setup-model-config');
  await page.getByRole('button', { name: /Download & install/ }).click();
  await page.waitForSelector('.setup-done', { timeout: 180000 });
  await page.getByRole('button', { name: /Start creating/ }).click();
  await page.waitForSelector('.wizard', { state: 'detached' });
  await page.locator('.nav-item', { hasText: 'Studio' }).click();
  await page.waitForSelector('.engine-mini .status-dot--ok', { timeout: 180000 });
}

// ------------------------------------------------------------------ pass A: narration by the app itself
if (regen || !Object.keys(SCRIPT).every((key) => fs.existsSync(path.join(voDir, `${key}.wav`)))) {
  console.log('Generating the narration with Voxarium...');
  const userData = seed('vo');
  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, VOXARIUM_USER_DATA: userData } });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.app-shell', { timeout: 30000 });
    await install(page);
    const seen = new Set();
    for (const [key, text] of Object.entries(SCRIPT)) {
      await page.locator('.editor__area').fill(text);
      await page.getByRole('button', { name: /Generate speech|Generate/ }).first().click();
      let file;
      for (let i = 0; i < 240 && !file; i += 1) {
        await wait(500);
        file = wavsIn(userData).find((candidate) => !seen.has(candidate));
        if (file) await wait(600); // let the file finish writing
      }
      if (!file) throw new Error(`No audio was produced for "${key}".`);
      seen.add(file);
      fs.copyFileSync(file, path.join(voDir, `${key}.wav`));
      console.log(`  ${key}: ${duration(path.join(voDir, `${key}.wav`)).toFixed(1)} s`);
    }
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
}
const vo = Object.fromEntries(Object.keys(SCRIPT).map((key) => [key, { file: path.join(voDir, `${key}.wav`), seconds: duration(path.join(voDir, `${key}.wav`)) }]));

// ------------------------------------------------------------------ pass B: the recording
const OVERLAY = String.raw`
(() => {
  const css = document.createElement('style');
  css.textContent = \`
    #vx-cap{position:fixed;left:50%;bottom:34px;transform:translate(-50%,16px);z-index:2147483000;opacity:0;pointer-events:none;
      transition:opacity .35s ease,transform .35s ease;max-width:84%;padding:14px 28px;border-radius:16px;text-align:center;
      background:rgba(20,17,14,.92);border:1px solid rgba(255,255,255,.1);box-shadow:0 18px 50px rgba(0,0,0,.5);
      font:700 30px/1.25 'Bricolage Grotesque Variable','Geist Variable',system-ui,sans-serif;color:#f7f0e6;letter-spacing:-.01em}
    #vx-cap.on{opacity:1;transform:translate(-50%,0)}
    #vx-cap b{color:hsl(16 100% 62%)}
    #vx-card{position:fixed;inset:0;z-index:2147483100;display:grid;place-items:center;text-align:center;pointer-events:none;
      background:radial-gradient(1000px 600px at 50% 30%,#2b231c,#12100d 70%);opacity:0;transition:opacity .5s ease;color:#f7f0e6}
    #vx-card.on{opacity:1}
    #vx-card img{width:132px;height:132px;border-radius:30px;box-shadow:0 20px 60px rgba(242,73,27,.35)}
    #vx-card h1{margin:22px 0 8px;font:800 84px/1 'Bricolage Grotesque Variable',system-ui,sans-serif;letter-spacing:-.03em}
    #vx-card p{margin:0;font:500 30px/1.3 'Geist Variable',system-ui,sans-serif;color:#d9cfc2}
    #vx-card code{display:inline-block;margin-top:26px;padding:10px 20px;border-radius:12px;background:#1f1a15;border:1px solid #3a322a;
      font:500 26px 'Geist Mono Variable',ui-monospace,monospace;color:hsl(16 100% 66%)}
    #vx-cursor{position:fixed;left:0;top:0;z-index:2147483200;pointer-events:none;width:26px;height:26px;margin:-3px 0 0 -3px;
      filter:drop-shadow(0 3px 5px rgba(0,0,0,.55));opacity:0;transition:opacity .3s}
    .vx-ring{position:fixed;z-index:2147483150;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;
      border:3px solid hsl(16 100% 62%);animation:vxr .55s ease-out forwards}
    @keyframes vxr{to{transform:scale(4.2);opacity:0}}
  \`;
  document.head.append(css);
  const cap = Object.assign(document.createElement('div'), { id: 'vx-cap' });
  const card = Object.assign(document.createElement('div'), { id: 'vx-card' });
  const cursor = document.createElement('div');
  cursor.id = 'vx-cursor';
  cursor.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#14110e" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.body.append(cap, card, cursor);
  addEventListener('mousemove', (e) => { cursor.style.opacity = 1; cursor.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
  addEventListener('mousedown', (e) => {
    const ring = document.createElement('div');
    ring.className = 'vx-ring';
    ring.style.left = e.clientX + 'px';
    ring.style.top = e.clientY + 'px';
    document.body.append(ring);
    setTimeout(() => ring.remove(), 700);
  }, true);
  window.vxCaption = (html) => { if (html) { cap.innerHTML = html; cap.classList.add('on'); } else cap.classList.remove('on'); };
  window.vxCard = (html) => { if (html) { card.innerHTML = html; card.classList.add('on'); } else card.classList.remove('on'); };
})();
`.replaceAll('\\`', '`');

const iconUrl = `data:image/png;base64,${fs.readFileSync(path.join(root, 'public', 'icon.png')).toString('base64')}`;
const introCard = `<div><img src="${iconUrl}" alt=""/><h1>Voxarium</h1><p>Text to speech that never leaves your computer.</p></div>`;
const outroCard = `<div><img src="${iconUrl}" alt=""/><h1>Free. Open source. Private.</h1><p>Windows · Linux · macOS</p><code>github.com/AhmadMansy/voxarium</code></div>`;

const userData = seed('demo');
let app;
try {
  app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, VOXARIUM_USER_DATA: userData } });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1280, 800);
    win.center();
  });
  await page.waitForSelector('.app-shell', { timeout: 30000 });
  await page.evaluate(OVERLAY);
  await page.evaluate((html) => window.vxCard(html), introCard);
  await wait(900);
  // The app is captured from inside (page screenshots), so other windows can never end up in the video.
  const framesDir = path.join(userData, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  const frames = []; // { file, t }
  let grabbing = true;
  const t0 = Date.now();
  const grabber = (async () => {
    for (let index = 0; grabbing; index += 1) {
      const file = path.join(framesDir, `${String(index).padStart(6, '0')}.jpg`);
      const t = (Date.now() - t0) / 1000;
      await page.screenshot({ path: file, type: 'jpeg', quality: 88 }).catch(() => {});
      if (fs.existsSync(file)) frames.push({ file, t });
    }
  })();
  await wait(600);
  const now = () => (Date.now() - t0) / 1000;
  const voices = []; // narration and the generated sample, placed on the timeline
  const sfx = []; // { t, kind }
  const caption = (html) => page.evaluate((value) => window.vxCaption(value), html);
  const card = (html) => page.evaluate((value) => window.vxCard(value), html);

  // Glide the cursor to an element, click it, and log a click sound.
  const press = async (locator) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
    await wait(180);
    sfx.push({ t: now(), kind: 'click' });
    await locator.click();
    await wait(250);
  };
  // Start a narration line now and run the scene's action alongside it.
  const scene = async (key, action) => {
    const start = now() + 0.15;
    voices.push({ file: vo[key].file, t: start });
    const floor = wait((vo[key].seconds + 0.55) * 1000);
    await Promise.all([action?.(), floor]);
  };

  sfx.push({ t: now(), kind: 'whoosh' });
  await scene('intro');
  sfx.push({ t: now(), kind: 'whoosh' });
  await card('');
  await wait(500);

  await caption('Pick a <b>model</b>');
  await scene('choose', async () => {
    await wait(800);
    await press(page.locator('.setup-model-option', { hasText: phonon.shortName }).first());
  });
  await press(page.getByRole('button', { name: /^Continue$/ }));
  await page.waitForSelector('.setup-model-config');
  await caption('Downloaded, <b>verified</b>, tested');
  await scene('install', async () => {
    await wait(600);
    await press(page.getByRole('button', { name: /Download & install/ }));
    await page.waitForSelector('.setup-done', { timeout: 180000 });
    sfx.push({ t: now(), kind: 'chime' });
  });
  await wait(600);
  await press(page.getByRole('button', { name: /Start creating/ }));
  await page.waitForSelector('.wizard', { state: 'detached' });
  await page.locator('.nav-item', { hasText: 'Studio' }).click();
  await page.waitForSelector('.engine-mini .status-dot--ok', { timeout: 180000 });

  await caption('Write. <b>Generate.</b> Listen.');
  await scene('studio', async () => {
    await page.locator('.editor__area').fill('');
    await press(page.locator('.editor__area'));
    const typingStart = now();
    await page.keyboard.type(SAMPLE_TEXT, { delay: 32 });
    for (let t = typingStart; t < now(); t += 0.09) sfx.push({ t, kind: 'tick' });
    await wait(400);
    await press(page.getByRole('button', { name: /Generate speech|Generate/ }).first());
    await page.waitForSelector('.render__head', { timeout: 180000 });
    sfx.push({ t: now(), kind: 'chime' });
  });
  const sample = wavsIn(userData).at(-1);
  if (sample) {
    voices.push({ file: sample, t: now() + 0.2 });
    await wait((duration(sample) + 0.9) * 1000);
  }

  await caption('<b>17</b> models · your voices · batch · API · MCP');
  await scene('tour', async () => {
    for (const label of ['Models', 'Voices', 'History', 'Batch', 'Integrations']) {
      await press(page.locator('.nav-item', { hasText: label }).first());
      await wait(700);
    }
  });

  await caption('Dark or <b>light</b>');
  await scene('theme', async () => {
    await press(page.locator('.nav-item', { hasText: 'Studio' }).first());
    await wait(500);
    sfx.push({ t: now(), kind: 'whoosh' });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await wait(1100);
    sfx.push({ t: now(), kind: 'whoosh' });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
  });

  await caption('');
  sfx.push({ t: now(), kind: 'whoosh' });
  await card(outroCard);
  await scene('outro');
  sfx.push({ t: now(), kind: 'chime' });
  await wait(2200);
  const total = now();

  grabbing = false;
  await grabber;
  const slash = (file) => file.split(path.sep).join('/');
  const entries = frames.map((frame, index) => [`file '${slash(frame.file)}'`, `duration ${((frames[index + 1]?.t ?? total) - frame.t).toFixed(4)}`]);
  fs.writeFileSync(path.join(userData, 'frames.txt'), [...entries.flat(), `file '${slash(frames.at(-1).file)}'`, ''].join('\n'));
  const rawFile = path.join(userData, 'raw.mp4');
  const built = spawnSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', path.join(userData, 'frames.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '18', rawFile], { stdio: 'ignore' });
  if (built.status !== 0) throw new Error('Could not build the video from frames.');
  console.log(`  ${frames.length} frames, about ${(frames.length / total).toFixed(1)} per second`);
  await app.close();
  app = undefined;

  // ---------------------------------------------------------------- sound: music + effects, in Node
  const SR = 44100;
  const length = Math.ceil((total + 1) * SR);
  const music = new Float32Array(length);
  const effects = new Float32Array(length);
  const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
  const bar = (60 / 96) * 4;
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
  for (let i = 0; i * bar < total + 1; i += 1) {
    const chord = chords[i % chords.length];
    const start = Math.floor(i * bar * SR);
    const span = Math.floor(bar * SR);
    for (let n = 0; n < span && start + n < length; n += 1) {
      const t = n / SR;
      const env = Math.min(1, t / 0.6) * Math.min(1, (bar - t) / 0.6 + 0.2);
      let pad = 0;
      for (const note of chord) pad += Math.sin(2 * Math.PI * hz(note - 12) * t) * 0.5 + Math.sin(2 * Math.PI * hz(note) * t * 1.002) * 0.25;
      music[start + n] += pad * env * 0.09;
    }
    // Soft plucked arpeggio, eighth notes.
    const step = bar / 8;
    for (let k = 0; k < 8; k += 1) {
      const note = chord[[0, 1, 2, 1, 0, 2, 1, 2][k]] + 12;
      const at = Math.floor((i * bar + k * step) * SR);
      for (let n = 0; n < SR * 0.5 && at + n < length; n += 1) {
        const t = n / SR;
        music[at + n] += Math.sin(2 * Math.PI * hz(note) * t) * Math.exp(-t * 7) * 0.13 * (k % 2 ? 0.7 : 1);
      }
    }
  }
  const add = (at, samples) => {
    const base = Math.floor(at * SR);
    for (let n = 0; n < samples.length && base + n < length; n += 1) if (base + n >= 0) effects[base + n] += samples[n];
  };
  const tone = (freq, seconds, gain, decay) => Array.from({ length: Math.floor(seconds * SR) }, (_, n) => Math.sin((2 * Math.PI * freq * n) / SR) * Math.exp((-n / SR) * decay) * gain);
  const kinds = {
    click: () => {
      const burst = Array.from({ length: Math.floor(0.03 * SR) }, (_, n) => (Math.random() * 2 - 1) * Math.exp((-n / SR) * 160) * 0.35);
      const blip = tone(1900, 0.06, 0.25, 55);
      return burst.map((value, n) => value + (blip[n] || 0));
    },
    tick: () => Array.from({ length: Math.floor(0.018 * SR) }, (_, n) => (Math.random() * 2 - 1) * Math.exp((-n / SR) * 260) * 0.14),
    chime: () => {
      const a = tone(hz(76), 0.9, 0.3, 4.5);
      const b = tone(hz(83), 1.1, 0.22, 4);
      const gap = Math.floor(0.09 * SR);
      return b.map((value, n) => value + (a[n - gap] || 0));
    },
    whoosh: () => {
      const n = Math.floor(0.7 * SR);
      let low = 0;
      return Array.from({ length: n }, (_, i) => {
        const t = i / n;
        const cutoff = 0.02 + 0.5 * Math.sin(Math.PI * t) ** 2;
        low += cutoff * (Math.random() * 2 - 1 - low);
        return low * Math.sin(Math.PI * t) * 0.9;
      });
    },
  };
  for (const effect of sfx) add(effect.t, kinds[effect.kind]());
  for (let n = 0; n < length; n += 1) music[n] *= Math.min(1, n / (1.5 * SR)) * Math.min(1, (length - n) / (2 * SR));
  const toWav = (samples, file) => {
    const data = Buffer.alloc(44 + samples.length * 2);
    data.write('RIFF', 0);
    data.writeUInt32LE(36 + samples.length * 2, 4);
    data.write('WAVEfmt ', 8);
    data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20);
    data.writeUInt16LE(1, 22);
    data.writeUInt32LE(SR, 24);
    data.writeUInt32LE(SR * 2, 28);
    data.writeUInt16LE(2, 32);
    data.writeUInt16LE(16, 34);
    data.write('data', 36);
    data.writeUInt32LE(samples.length * 2, 40);
    for (let n = 0; n < samples.length; n += 1) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[n])) * 32767), 44 + n * 2);
    fs.writeFileSync(file, data);
  };
  const musicFile = path.join(userData, 'music.wav');
  const sfxFile = path.join(userData, 'sfx.wav');
  toWav(music, musicFile);
  toWav(effects, sfxFile);

  // ---------------------------------------------------------------- mux
  const inputs = ['-i', rawFile, '-i', musicFile, '-i', sfxFile];
  const delays = voices.map((voice, index) => {
    inputs.push('-i', voice.file);
    const ms = Math.round(voice.t * 1000);
    return `[${index + 3}:a]aformat=sample_rates=44100:channel_layouts=mono,adelay=${ms}:all=1[v${index}]`;
  });
  const mix = voices.map((_, index) => `[v${index}]`).join('');
  const filter = [
    ...delays,
    `${mix}amix=inputs=${voices.length}:normalize=0,volume=1.35,asplit=2[vo][side]`,
    '[1:a]volume=0.9[m]',
    '[m][side]sidechaincompress=threshold=0.015:ratio=10:attack=15:release=450[ducked]',
    '[2:a]volume=0.8[fx]',
    '[ducked][fx][vo]amix=inputs=3:normalize=0,alimiter=limit=0.95,aformat=channel_layouts=stereo[a]',
  ].join(';');
  const target = path.join(outDir, 'voxarium-demo.mp4');
  const result = spawnSync('ffmpeg', ['-y', ...inputs, '-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-t', String(total), '-movflags', '+faststart', target], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('ffmpeg failed.');
  console.log(`Wrote ${path.relative(root, target)} (${total.toFixed(1)} s)`);
} finally {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
}
