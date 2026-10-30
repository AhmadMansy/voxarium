// One engine for everything. The Studio window owns the engine (Phonon runs in its
// WebAssembly/WebGPU worker; sidecar models are driven from it too), so API, CLI
// and MCP requests are queued here and executed by the renderer through the same
// code path as the Studio: same active model, same voices, same History.
const crypto = require('node:crypto');

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const READY_TIMEOUT_MS = 120_000;

function createEngineBridge({ ipcMain, ensureWindow, log = console.log }) {
  /** @type {Map<string, {resolve: Function, reject: Function, timer: NodeJS.Timeout}>} */
  const inflight = new Map();
  let ready = false;
  let readyWaiters = [];
  let chain = Promise.resolve();
  let queued = 0;

  ipcMain.on('engine:bridge-ready', () => {
    ready = true;
    for (const resolve of readyWaiters) resolve();
    readyWaiters = [];
  });

  ipcMain.on('engine:response', (event, message) => {
    const entry = inflight.get(message?.id);
    if (!entry) return;
    inflight.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else {
      const error = new Error(message.error || 'The engine failed.');
      error.status = message.status || 500;
      entry.reject(error);
    }
  });

  /** Called when the renderer reloads or the window goes away. */
  function reset(reason = 'The Voxarium window was closed.') {
    ready = false;
    for (const [id, entry] of inflight) {
      clearTimeout(entry.timer);
      entry.reject(Object.assign(new Error(reason), { status: 503 }));
      inflight.delete(id);
    }
  }

  async function waitReady() {
    const win = await ensureWindow();
    if (ready) return win;
    await Promise.race([
      new Promise((resolve) => readyWaiters.push(resolve)),
      new Promise((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('The Voxarium engine did not start in time.'), { status: 503 })), READY_TIMEOUT_MS),
      ),
    ]);
    return win;
  }

  async function send(op, payload, timeoutMs) {
    const win = await waitReady();
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        inflight.delete(id);
        reject(Object.assign(new Error(`The engine did not answer "${op}" in time.`), { status: 504 }));
      }, timeoutMs);
      inflight.set(id, { resolve, reject, timer });
      win.webContents.send('engine:request', { id, op, payload });
    });
  }

  /**
   * Runs a request against the engine. Synthesis is serialized: one model is
   * loaded at a time, so requests wait their turn instead of fighting over it.
   */
  function request(op, payload = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (op !== 'synthesize') return send(op, payload, timeoutMs);
    queued += 1;
    const run = chain.then(() => send(op, payload, timeoutMs));
    chain = run.catch(() => {}).finally(() => {
      queued -= 1;
    });
    return run.catch((error) => {
      log(`[voxarium] engine request failed: ${error.message}`);
      throw error;
    });
  }

  return { request, reset, pending: () => queued, isReady: () => ready };
}

module.exports = { createEngineBridge };
