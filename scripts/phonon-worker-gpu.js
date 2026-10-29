// GPU preference shim for the phonon-tts worker.
//
// `phonon-tts` asks for a WebGPU adapter with no options, so on a multi-GPU machine the
// browser always picks its default adapter. This module is copied next to `worker.js` by
// `scripts/sync-phonon.mjs` and loaded as `worker-gpu.js?gpuPreference=...`. It forwards the
// preference chosen in Settings into `requestAdapter` and then hands control to the real
// worker. The adapter name still comes from Chromium; `high-performance` also gets a
// `--force-high-performance-gpu` switch at app start.
const preference = new URL(self.location.href).searchParams.get('gpuPreference');

if (preference === 'high-performance' || preference === 'low-power') {
  const gpu = self.navigator?.gpu;
  const requestAdapter = gpu?.requestAdapter;
  if (gpu && typeof requestAdapter === 'function') {
    const patched = (options = {}) => requestAdapter.call(gpu, { ...options, powerPreference: preference });
    try {
      Object.defineProperty(gpu, 'requestAdapter', { value: patched, configurable: true });
    } catch {
      try {
        gpu.requestAdapter = patched;
      } catch {
        // The hint is best-effort; WebGPU still works with the browser's default adapter.
      }
    }
  }
}

await import('./worker.js');
