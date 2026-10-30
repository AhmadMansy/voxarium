import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

/**
 * Integration test for the local API, CLI, MCP server and tray mode against the
 * built app. The profile links to installed models and runtimes
 * (VOXARIUM_TEST_SOURCE, default %APPDATA%\Voxarium), so it needs Phonon 31M and,
 * for the model-switch checks, Supertonic 3 installed there.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.env.VOXARIUM_TEST_SOURCE || path.join(process.env.APPDATA, 'Voxarium');
const port = Number(process.env.VOXARIUM_TEST_PORT || 7860);
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const cli = path.join(root, 'electron', 'cli', 'voxarium.cjs');
const mcp = path.join(root, 'electron', 'cli', 'voxarium-mcp.cjs');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-integrations-'));
for (const name of ['models', 'runtimes']) {
  execFileSync('cmd', ['/c', 'mklink', '/J', path.join(userData, name), path.join(source, name)], { stdio: 'ignore' });
}
for (const name of ['models-state.json', 'runtimes-state.json']) {
  if (fs.existsSync(path.join(source, name))) fs.copyFileSync(path.join(source, name), path.join(userData, name));
}
const state = JSON.parse(fs.readFileSync(path.join(userData, 'models-state.json'), 'utf8'));
state.activeModelId = 'phonon-31m-en';
fs.writeFileSync(path.join(userData, 'models-state.json'), JSON.stringify(state));
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ setupComplete: true, onboardingDismissed: true, activeModelId: 'phonon-31m-en', apiEnabled: true, apiPort: port, closeToTray: true, device: 'cpu', quality: 'q8', autoPlay: false }),
);
const hasSupertonic = Boolean(state.installs?.['supertonic-3']);

const env = { ...process.env, VOXARIUM_USER_DATA: userData };
const nodeEnv = { ...env, ELECTRON_RUN_AS_NODE: '1' };
const step = (message) => console.log(`→ ${message}`);
const discovery = () => JSON.parse(fs.readFileSync(path.join(userData, 'api.json'), 'utf8'));
const out = (name) => path.join(userData, name);

async function api(route, { method = 'GET', body, token, headers = {} } = {}) {
  const { url, token: discovered } = discovery();
  return fetch(`${url}${route}`, {
    method,
    headers: { ...(token !== null ? { authorization: `Bearer ${token ?? discovered}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function runCli(args) {
  return execFileSync(electronExe, [cli, ...args], { env: nodeEnv, encoding: 'utf8', timeout: 300000 });
}

function mcpSession(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(electronExe, [mcp], { env: nodeEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    const replies = new Map();
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines.filter(Boolean)) {
        const message = JSON.parse(line);
        replies.set(message.id, message);
        if (replies.size === messages.filter((item) => item.id != null).length) {
          child.stdin.end();
          resolve(replies);
        }
      }
    });
    child.on('error', reject);
    setTimeout(() => reject(new Error('MCP session timed out')), 300000).unref();
    for (const message of messages) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  });
}

let app;
try {
  step('launching the built app with the API enabled');
  app = await electron.launch({ args: ['.'], cwd: root, env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('.app-shell', { timeout: 30000 });
  for (let i = 0; i < 60 && !fs.existsSync(path.join(userData, 'api.json')); i += 1) await new Promise((r) => setTimeout(r, 250));
  const info = discovery();
  assert.equal(info.enabled, true);
  assert.equal(info.url, `http://127.0.0.1:${port}`);
  assert.match(info.token, /^vx_[a-f0-9]{48}$/);

  step('rejecting unauthenticated, browser and foreign-host requests');
  assert.equal((await api('/v1/health', { token: null })).status, 401);
  assert.equal((await api('/v1/health', { token: 'vx_wrong' })).status, 401);
  assert.equal((await api('/v1/health', { headers: { origin: 'https://example.com' } })).status, 403);
  const rebinding = await new Promise((resolve) => {
    import('node:http').then(({ request }) => {
      const req = request({ host: '127.0.0.1', port, path: '/v1/health', headers: { host: 'evil.example:80', authorization: `Bearer ${info.token}` } }, (res) => resolve(res.statusCode));
      req.end();
    });
  });
  assert.equal(rebinding, 403);

  step('listing models and voices');
  const health = await (await api('/v1/health')).json();
  assert.equal(health.activeModel.id, 'phonon-31m-en');
  const models = await (await api('/v1/models')).json();
  assert.equal(models.object, 'list');
  assert.equal(models.data.length, 15);
  assert.equal(models.data.find((model) => model.id === 'phonon-31m-en').active, true);
  const voices = await (await api('/v1/voices')).json();
  // Phonon 31M accepts the 38 English and character voices of the 103-voice catalog.
  assert.equal(voices.voices.length, 38, 'Phonon lists its compatible catalog voices');
  assert.ok(voices.voices.some((voice) => voice.default));

  step('OpenAI-compatible /v1/audio/speech with Phonon (mp3)');
  const speech = await api('/v1/audio/speech', { method: 'POST', body: { model: 'tts-1', input: 'The local API is working.', voice: 'alloy' } });
  assert.equal(speech.status, 200, await speech.clone().text());
  assert.equal(speech.headers.get('content-type'), 'audio/mpeg');
  const mp3 = Buffer.from(await speech.arrayBuffer());
  assert.ok(mp3.length > 4000 && (mp3[0] === 0xff || mp3.subarray(0, 3).toString() === 'ID3'), 'an MP3 stream came back');
  assert.equal(speech.headers.get('x-voxarium-model'), 'phonon-31m-en');

  step('validating bad requests');
  assert.equal((await api('/v1/audio/speech', { method: 'POST', body: { input: '' } })).status, 400);
  assert.equal((await api('/v1/speak', { method: 'POST', body: { text: 'x', voice: 'no-such-voice' } })).status, 400);
  assert.equal((await api('/v1/speak', { method: 'POST', body: { text: 'x', model: 'no-such-model' } })).status, 404);
  assert.equal((await api('/v1/speak', { method: 'POST', body: { text: 'x', format: 'ogg' } })).status, 400);

  if (hasSupertonic) {
    step('switching the app to Supertonic through /v1/speak and saving to History');
    const speak = await api('/v1/speak', { method: 'POST', body: { text: 'Switched models through the API.', model: 'Supertonic', voice: 'M1', save: true } });
    const body = await speak.json();
    if (speak.status !== 200) console.log('toasts:', await page.locator('.toast').allInnerTexts());
    assert.equal(speak.status, 200, JSON.stringify(body));
    assert.equal(body.model, 'supertonic-3');
    assert.equal(body.voice, 'supertonic-3:M1');
    assert.ok(body.duration > 1);
    assert.ok(Buffer.from(body.audio_base64, 'base64').subarray(0, 4).toString() === 'RIFF');
    assert.ok(body.history_id && fs.existsSync(body.file), 'the take was saved to History');
    const after = await (await api('/v1/health')).json();
    assert.equal(after.activeModel.id, 'supertonic-3', 'the Studio and API share one active model');
    const history = await page.evaluate(() => window.studio.history.list());
    assert.equal(history.find((entry) => entry.id === body.history_id).meta.source, 'api');
  }

  step('CLI via Voxarium’s own runtime (ELECTRON_RUN_AS_NODE)');
  const listed = runCli(['models']);
  assert.match(listed, /phonon-31m-en/);
  const cliWav = out('cli.wav');
  const said = runCli(['say', 'Hello from the command line.', '-o', cliWav]);
  assert.match(said, /→/);
  assert.equal(fs.readFileSync(cliWav).subarray(0, 4).toString(), 'RIFF');

  step('MCP server: initialize, tools/list, speak to a file');
  const mcpWav = out('mcp.wav');
  const replies = await mcpSession([
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'speak', arguments: { text: 'An agent asked me to say this.', output_path: mcpWav } } },
    { id: 4, method: 'tools/call', params: { name: 'list_models', arguments: {} } },
  ]);
  assert.equal(replies.get(1).result.serverInfo.name, 'voxarium');
  assert.deepEqual(replies.get(2).result.tools.map((tool) => tool.name), ['speak', 'list_models', 'list_voices', 'status']);
  assert.ok(!replies.get(3).result.isError, JSON.stringify(replies.get(3)));
  assert.match(replies.get(3).result.content[0].text, /Saved to/);
  assert.equal(fs.readFileSync(mcpWav).subarray(0, 4).toString(), 'RIFF');
  assert.match(replies.get(4).result.content[0].text, /phonon-31m-en/);

  step('closing the window keeps Voxarium in the tray with the API up');
  await page.evaluate(() => window.close());
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(app.process().exitCode, null, 'the app is still running');
  const tray = await api('/v1/speak', { method: 'POST', body: { text: 'Still here from the tray.', return_audio: false } });
  assert.equal(tray.status, 200, await tray.clone().text());
  assert.deepEqual(errors, [], 'no renderer errors');

  step('quitting, then letting the CLI start Voxarium hidden on demand');
  await app.evaluate(({ app: electronApp }) => electronApp.quit());
  await new Promise((r) => setTimeout(r, 3000));
  app = null;
  assert.equal(discovery().enabled, false, 'quitting clears the advertised endpoint');
  const relaunched = runCli(['say', 'Started on demand.', '-o', out('launched.wav')]);
  assert.match(relaunched, /→/);
  const pid = discovery().pid;
  assert.ok(pid, 'the relaunched app advertises itself');
  process.kill(pid);
  console.log('\nIntegrations passed: auth → OpenAI speech → model switch → CLI → MCP → tray → launch on demand');
} catch (error) {
  console.error('\nINTEGRATION TEST FAILED:', error);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  try {
    const pid = discovery().pid;
    if (pid) process.kill(pid);
  } catch {}
  await new Promise((r) => setTimeout(r, 1500));
  for (const name of ['models', 'runtimes']) {
    try {
      fs.rmdirSync(path.join(userData, name));
    } catch {}
  }
}
