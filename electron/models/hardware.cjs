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

async function probeHardware({ app, dataDir, gpuPreference = 'auto', logger = console } = {}) {
  let gpuInfo = null;
  try {
    gpuInfo = await app.getGPUInfo('complete');
  } catch (error) {
    logger.warn?.('[voxarium] GPU info unavailable', error);
  }
  const gpus = Array.isArray(gpuInfo?.gpuDevice) ? gpuInfo.gpuDevice.map(normalizeGpu) : [];
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
    gpuPreference,
    webgpuLikely,
    dataDir: dataDir ? path.basename(dataDir) : '',
  };
}

module.exports = { probeHardware, gb };
