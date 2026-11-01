// SPDX-License-Identifier: AGPL-3.0-or-later
const os = require('node:os');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const VENDORS = {
  0x10de: 'NVIDIA',
  0x1002: 'AMD',
  0x8086: 'Intel',
  0x106b: 'Apple',
  0x1414: 'Microsoft',
  0x13b5: 'ARM',
  0x5143: 'Qualcomm',
};

const gb = (bytes) => Math.round((Number(bytes) / 1024 ** 3) * 10) / 10;

function normalizeGpu(device) {
  const vendorId = Number(device?.vendorId);
  return {
    vendor: VENDORS[vendorId] || device?.driverVendor || device?.vendorId || 'Unknown',
    device: device?.deviceString || device?.driverVendor || 'GPU',
    vramGb: Number.isFinite(Number(device?.vramGb)) ? Number(device.vramGb) : null,
    active: Boolean(device?.active),
  };
}

/**
 * NVIDIA GPUs through nvidia-smi, which ships with the driver. Chromium does not
 * report VRAM, and sidecar runtimes need to know whether CUDA PyTorch will work.
 */
function probeNvidia() {
  return new Promise((resolve) => {
    const { execFile } = require('node:child_process');
    const candidates = [
      'nvidia-smi',
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
    ];
    const attempt = (index) => {
      if (index >= candidates.length) return resolve([]);
      execFile(
        candidates[index],
        ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'],
        { windowsHide: true, timeout: 8000 },
        (error, stdout) => {
          if (error) return attempt(index + 1);
          const gpus = String(stdout)
            .split(/\r?\n/)
            .map((line) => line.split(',').map((part) => part.trim()))
            .filter((parts) => parts.length >= 3 && parts[0])
            .map(([name, memory, driver]) => ({ name, vramGb: Math.round((Number(memory) / 1024) * 10) / 10, driver }));
          resolve(gpus);
        },
      );
    };
    attempt(0);
  });
}

async function probeHardware({ app, dataDir, gpuPreference = 'auto', logger = console } = {}) {
  let gpuInfo = null;
  try {
    gpuInfo = await app.getGPUInfo('complete');
  } catch (error) {
    logger.warn?.('[voxarium] GPU info unavailable', error);
  }
  const gpus = Array.isArray(gpuInfo?.gpuDevice) ? gpuInfo.gpuDevice.map(normalizeGpu) : [];
  const nvidia = await probeNvidia();
  // Fill in VRAM for NVIDIA adapters Chromium reported without it.
  for (const gpu of gpus) {
    if (gpu.vendor !== 'NVIDIA' || gpu.vramGb != null) continue;
    const match = nvidia.find((item) => item.name && gpu.device && gpu.device.includes(item.name.replace(/^NVIDIA\s+/i, ''))) || nvidia[0];
    if (match) gpu.vramGb = match.vramGb;
  }
  if (nvidia.length && !gpus.some((gpu) => gpu.vendor === 'NVIDIA')) {
    gpus.push(...nvidia.map((item) => ({ vendor: 'NVIDIA', device: item.name, vramGb: item.vramGb, active: false })));
  }
  const cuda = nvidia.length
    ? { available: true, name: nvidia[0].name, vramGb: Math.max(...nvidia.map((item) => item.vramGb || 0)), driver: nvidia[0].driver }
    : { available: false, name: null, vramGb: 0, driver: null };
  const featureStatus = gpuInfo?.featureStatus && typeof gpuInfo.featureStatus === 'object' ? gpuInfo.featureStatus : {};
  const aux = gpuInfo?.auxAttributes || {};
  const webgpuLikely =
    String(featureStatus.webgpu || '').toLowerCase().includes('enabled') ||
    Boolean(aux.glRenderer && /angle|vulkan|d3d/i.test(String(aux.glRenderer)));

  let freeDiskGb = null;
  try {
    const stats = await fsp.statfs(dataDir || process.cwd());
    freeDiskGb = gb(Number(stats.bsize) * Number(stats.bavail));
  } catch {}

  return {
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model || '',
    cpuCores: os.cpus().length,
    totalRamGb: gb(os.totalmem()),
    freeRamGb: gb(os.freemem()),
    freeDiskGb,
    gpus,
    cuda,
    gpuPreference,
    webgpuLikely,
    dataDir: dataDir ? path.basename(dataDir) : '',
  };
}

module.exports = { probeHardware, probeNvidia, gb };
