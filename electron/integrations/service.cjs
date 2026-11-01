// SPDX-License-Identifier: AGPL-3.0-or-later
// Integrations: the local API server, the discovery file other tools read, the
// tray icon and start-with-Windows. Settings drive everything through apply().
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_PORT = 7849;

function appRoot() {
  return path.join(__dirname, '..', '..');
}

/** Folder holding the CLI and MCP scripts (outside app.asar in packaged builds). */
function cliDir() {
  const bundled = path.join(__dirname, '..', 'cli');
  const unpacked = bundled.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  return unpacked !== bundled && fs.existsSync(unpacked) ? unpacked : bundled;
}

function createIntegrations({ app, Tray, Menu, nativeImage, clipboard, dataDir, iconPath, apiServer, getSettings, showWindow, quit, log = console.log }) {
  const discoveryFile = path.join(dataDir, 'api.json');
  const tokenFile = path.join(dataDir, 'api-token.json');
  let tray = null;
  let lastError = null;

  function token() {
    try {
      const stored = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      if (typeof stored.token === 'string' && stored.token.length >= 32) return stored.token;
    } catch {}
    return regenerateToken();
  }

  function regenerateToken() {
    const value = `vx_${crypto.randomBytes(24).toString('hex')}`;
    fs.writeFileSync(tokenFile, `${JSON.stringify({ token: value }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return value;
  }

  /** How a CLI or MCP client can start Voxarium in the background. */
  function launchCommand() {
    return app.isPackaged
      ? { command: process.execPath, args: ['--hidden'] }
      : { command: process.execPath, args: [appRoot(), '--hidden'] };
  }

  /** Runs one of the bundled scripts with Voxarium's own runtime (no separate Node needed). */
  function scriptCommand(name) {
    return {
      command: process.execPath,
      args: [path.join(cliDir(), name)],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
  }

  function writeDiscovery() {
    const payload = {
      app: 'Voxarium',
      version: app.getVersion(),
      enabled: apiServer.running(),
      url: apiServer.url(),
      port: apiServer.port(),
      token: apiServer.running() ? token() : null,
      pid: process.pid,
      launch: launchCommand(),
      updatedAt: Date.now(),
    };
    try {
      fs.writeFileSync(discoveryFile, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      log(`[voxarium] could not write ${discoveryFile}: ${error.message}`);
    }
  }

  function clearDiscovery() {
    try {
      const current = JSON.parse(fs.readFileSync(discoveryFile, 'utf8'));
      // Keep the launch command so clients can start Voxarium again later.
      fs.writeFileSync(discoveryFile, `${JSON.stringify({ ...current, enabled: false, url: null, port: null, token: null, pid: null, updatedAt: Date.now() }, null, 2)}\n`, 'utf8');
    } catch {}
  }

  function trayMenu() {
    const url = apiServer.url();
    return Menu.buildFromTemplate([
      { label: 'Open Voxarium', click: () => showWindow() },
      { type: 'separator' },
      { label: url ? `Local API: ${url}` : lastError ? 'Local API: failed to start' : 'Local API: off', enabled: false },
      {
        label: 'Copy API URL',
        enabled: Boolean(url),
        click: () => clipboard.writeText(`${url}/v1`),
      },
      { type: 'separator' },
      { label: 'Quit Voxarium', click: () => quit() },
    ]);
  }

  function updateTray(settings) {
    const wanted = Boolean(settings.closeToTray || settings.apiEnabled || app.commandLine.hasSwitch('hidden') || process.argv.includes('--hidden'));
    if (!wanted) {
      tray?.destroy();
      tray = null;
      return;
    }
    if (!tray) {
      const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
      tray = new Tray(image);
      tray.setToolTip('Voxarium');
      tray.on('click', () => showWindow());
    }
    tray.setContextMenu(trayMenu());
    tray.setToolTip(apiServer.url() ? `Voxarium · API on ${apiServer.url()}` : 'Voxarium');
  }

  function updateLoginItem(settings) {
    if (process.platform !== 'win32' && process.platform !== 'darwin') return;
    try {
      const { command, args } = launchCommand();
      app.setLoginItemSettings({ openAtLogin: Boolean(settings.launchAtLogin), path: command, args });
    } catch (error) {
      log(`[voxarium] could not update the login item: ${error.message}`);
    }
  }

  async function apply(settings = getSettings()) {
    const port = Number.isInteger(Number(settings.apiPort)) && Number(settings.apiPort) > 0 ? Number(settings.apiPort) : DEFAULT_PORT;
    lastError = null;
    if (settings.apiEnabled) {
      if (!apiServer.running() || apiServer.port() !== port) {
        try {
          await apiServer.start(port);
        } catch (error) {
          lastError = error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Choose another port.` : error.message;
          log(`[voxarium] local API failed to start: ${lastError}`);
          await apiServer.stop();
        }
      }
      if (apiServer.running()) token();
      writeDiscovery();
    } else {
      await apiServer.stop();
      clearDiscovery();
      writeLaunchOnly();
    }
    updateTray(settings);
    updateLoginItem(settings);
    return status();
  }

  function writeLaunchOnly() {
    if (fs.existsSync(discoveryFile)) return;
    writeDiscovery();
  }

  function status() {
    const settings = getSettings();
    const running = apiServer.running();
    const url = apiServer.url();
    return {
      enabled: Boolean(settings.apiEnabled),
      running,
      url,
      port: apiServer.port() || Number(settings.apiPort) || DEFAULT_PORT,
      token: running ? token() : null,
      error: lastError,
      discoveryFile,
      closeToTray: Boolean(settings.closeToTray),
      launchAtLogin: Boolean(settings.launchAtLogin),
      cli: scriptCommand('voxarium.cjs'),
      mcp: scriptCommand('voxarium-mcp.cjs'),
    };
  }

  async function shutdown() {
    await apiServer.stop();
    clearDiscovery();
    tray?.destroy();
    tray = null;
  }

  return { apply, status, token, regenerateToken, shutdown, hasTray: () => Boolean(tray), DEFAULT_PORT };
}

module.exports = { createIntegrations, DEFAULT_PORT, cliDir };
