// Shared client for the Voxarium CLI and MCP server. Finds the running app through
// the discovery file it writes (api.json in the user data folder), starts it in
// the background when needed, and calls the local API. No dependencies.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const LAUNCH_TIMEOUT_MS = 120_000;

function userDataDir() {
  if (process.env.VOXARIUM_USER_DATA) return process.env.VOXARIUM_USER_DATA;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Voxarium');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Voxarium');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Voxarium');
}

function readDiscovery() {
  try {
    return JSON.parse(fs.readFileSync(path.join(userDataDir(), 'api.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Explicit settings win; otherwise use what the app advertises. */
function endpoint() {
  const discovery = readDiscovery();
  return {
    url: (process.env.VOXARIUM_API_URL || discovery?.url || '').replace(/\/+$/, '') || null,
    token: process.env.VOXARIUM_API_TOKEN || discovery?.token || null,
    discovery,
  };
}

class VoxariumError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(method, route, body, { url, token }) {
  let response;
  try {
    response = await fetch(`${url}${route}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new VoxariumError(`Voxarium is not reachable at ${url} (${error.cause?.code || error.message}).`, 0);
  }
  const type = response.headers.get('content-type') || '';
  if (!response.ok) {
    const detail = type.includes('json') ? (await response.json().catch(() => null))?.error?.message : await response.text().catch(() => '');
    throw new VoxariumError(detail || `HTTP ${response.status}`, response.status);
  }
  return type.includes('json') ? response.json() : Buffer.from(await response.arrayBuffer());
}

async function healthy(target) {
  if (!target.url || !target.token) return false;
  try {
    await call('GET', '/v1/health', null, target);
    return true;
  } catch {
    return false;
  }
}

/** Returns a reachable endpoint, launching Voxarium hidden in the tray if needed. */
async function connect({ launch = true, log = () => {} } = {}) {
  let target = endpoint();
  if (await healthy(target)) return target;
  if (process.env.VOXARIUM_API_URL) throw new VoxariumError(`Voxarium is not answering at ${process.env.VOXARIUM_API_URL}.`, 0);
  const command = target.discovery?.launch;
  if (!launch || !command?.command || !fs.existsSync(command.command)) {
    throw new VoxariumError(
      target.discovery
        ? 'Voxarium is not running. Start it, and enable Settings › Local API.'
        : 'Voxarium was not found. Install and open it once, then enable Settings › Local API.',
      0,
    );
  }
  log('Starting Voxarium in the background…');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(command.command, command.args || [], { detached: true, stdio: 'ignore', env, windowsHide: true }).unref();
  const started = Date.now();
  while (Date.now() - started < LAUNCH_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    target = endpoint();
    // The app rewrites api.json on startup; "disabled" written after our launch is final.
    if (target.discovery && target.discovery.enabled === false && target.discovery.updatedAt > started) {
      throw new VoxariumError('Voxarium started, but its local API is turned off. Enable Settings › Local API.', 0);
    }
    if (await healthy(target)) return target;
  }
  throw new VoxariumError('Voxarium did not start in time.', 0);
}

module.exports = { connect, call, endpoint, readDiscovery, userDataDir, VoxariumError };
