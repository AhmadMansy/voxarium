// SPDX-License-Identifier: AGPL-3.0-or-later
// Platform helpers shared by the runtime manager. Every function takes the platform
// as an argument (defaulting to this machine) so Linux and macOS behaviour can be
// unit-tested from a Windows machine.
const path = require('node:path');

/** Platforms Voxarium builds installers for. `linux-arm64` is not published yet. */
const PLATFORMS = ['win32-x64', 'linux-x64', 'darwin-arm64', 'darwin-x64'];

const PLATFORM_LABELS = {
  'win32-x64': 'Windows (x64)',
  'linux-x64': 'Linux (x64)',
  'darwin-arm64': 'macOS (Apple Silicon)',
  'darwin-x64': 'macOS (Intel)',
};

/**
 * Support tiers for a model runtime on one platform.
 *  A  Verified     a CI smoke test synthesizes on this platform
 *  B  Builds       the environment builds and a test sentence was synthesized by hand
 *  C  Experimental the recipe exists but has not been run end to end here
 *  D  Unsupported  it cannot work here (missing wheels, Linux-only code, ...)
 */
const TIERS = {
  A: { label: 'Verified', usable: true },
  B: { label: 'Builds', usable: true },
  C: { label: 'Experimental', usable: true },
  D: { label: 'Unsupported', usable: false },
};

function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function platformLabel(key = platformKey()) {
  return PLATFORM_LABELS[key] || key;
}

/**
 * An entry-point value is a string, or an object keyed by `"<platform>-<arch>"`,
 * `"<platform>"` or `"default"`. Returns the entry with every value resolved.
 */
function resolveEntry(entry, key = platformKey()) {
  const out = {};
  const platform = key.split('-')[0];
  for (const [name, value] of Object.entries(entry || {})) {
    if (typeof value === 'string') out[name] = value;
    else if (value && typeof value === 'object') out[name] = value[key] ?? value[platform] ?? value.default ?? '';
  }
  return out;
}

/** Path of the Python interpreter inside a virtual environment folder. */
function venvPython(venvDir, platform = process.platform) {
  return platform === 'win32' ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');
}

/** Directory that holds a virtual environment's executables and DLLs. */
function venvBin(venvDir, platform = process.platform) {
  return platform === 'win32' ? path.join(venvDir, 'Scripts') : path.join(venvDir, 'bin');
}

/** Tier a sidecar pack declares for a platform (`D` when it declares nothing). */
function tierFor(pack, key = platformKey()) {
  const tier = pack?.support?.[key];
  return tier && TIERS[tier] ? tier : 'D';
}

/**
 * Turns a catalog pack into the view for one platform:
 *  - tool/python packs pick their archive and entry from `variants[key]`;
 *  - sidecar packs get the tier from `support[key]` and an unsupported pack is
 *    marked unavailable with a reason the UI can show.
 */
function resolvePack(pack, key = platformKey()) {
  const resolved = { ...pack };
  const [platform, arch] = key.split('-');
  resolved.platform = platform;
  resolved.arch = arch;

  if (pack.variants) {
    const variant = pack.variants[key];
    if (variant) {
      Object.assign(resolved, variant);
      resolved.tier = 'B';
    } else {
      resolved.available = false;
      resolved.reason = `${pack.name} has no build for ${platformLabel(key)} yet.`;
      resolved.tier = 'D';
      resolved.archive = null;
    }
    delete resolved.variants;
  } else if (pack.kind === 'sidecar') {
    resolved.tier = tierFor(pack, key);
    if (!TIERS[resolved.tier].usable) {
      resolved.available = false;
      resolved.reason = `${pack.name} does not support ${platformLabel(key)} yet.`;
    }
  }
  if (resolved.entry) resolved.entry = resolveEntry(resolved.entry, key);
  return resolved;
}

module.exports = {
  PLATFORMS,
  PLATFORM_LABELS,
  TIERS,
  platformKey,
  platformLabel,
  resolveEntry,
  venvPython,
  venvBin,
  tierFor,
  resolvePack,
};
