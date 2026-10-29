import type { ModelManifest } from '../models/types';

/**
 * Infrastructure for the ONNX Runtime Web models that ship without a runtime
 * pack today. Nothing in the shipping registry reaches this module yet: the
 * engine gate keeps those models honestly unavailable until their pack and
 * model-specific adapter exist. Keeping the plumbing here means a pack only has
 * to provide a model URL and tensor adapters, not re-implement workers,
 * cancellation or memory checks.
 */

export type OnnxDevice = 'cpu' | 'webgpu';

export interface OnnxTensor {
  data: Float32Array | Int32Array | BigInt64Array;
  dims: number[];
  type: 'float32' | 'int32' | 'int64';
}

export type OnnxInputs = Record<string, OnnxTensor>;

export interface OnnxRuntimeOptions {
  modelUrl: string;
  device?: OnnxDevice;
  threads?: number;
  onStage?: (stage: string) => void;
}

export interface OnnxRuntime {
  readonly device: OnnxDevice;
  run(inputs: OnnxInputs, signal?: AbortSignal): Promise<Record<string, OnnxTensor>>;
  cancel(): void;
  dispose(): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cleanup?: () => void;
}

function abortError(): Error {
  const error = new Error('ONNX inference cancelled.');
  error.name = 'AbortError';
  return error;
}

function assets(device: OnnxDevice) {
  const base = new URL('ort/', document.baseURI);
  return {
    ortUrl: new URL(device === 'webgpu' ? 'ort.webgpu.min.mjs' : 'ort.min.mjs', base).href,
    wasmPaths: base.href,
  };
}

export interface MemoryGuardResult {
  ok: boolean;
  reason?: string;
  /** Rough peak footprint used for the decision. */
  estimatedBytes: number;
}

/**
 * A deliberately conservative guard. WASM keeps a copy of the weights in the
 * main heap, so allow roughly twice the download plus the manifest's RAM floor.
 */
export function onnxMemoryGuard(
  model: Pick<ModelManifest, 'downloadBytes' | 'hardware' | 'shortName'>,
  deviceMemoryGb?: number,
): MemoryGuardResult {
  const estimatedBytes = Math.max(model.downloadBytes * 2, model.hardware.minRamGb * 1024 ** 3 * 0.35);
  if (!deviceMemoryGb || !Number.isFinite(deviceMemoryGb)) {
    return { ok: true, estimatedBytes };
  }
  const budget = deviceMemoryGb * 1024 ** 3 * 0.6;
  if (estimatedBytes > budget) {
    return {
      ok: false,
      estimatedBytes,
      reason: `${model.shortName} needs roughly ${(estimatedBytes / 1024 ** 3).toFixed(1)} GB of headroom; this device reports ${deviceMemoryGb} GB of memory.`,
    };
  }
  return { ok: true, estimatedBytes };
}

/** `navigator.deviceMemory` is Chromium-only and intentionally coarse. */
export function deviceMemoryGb(): number | undefined {
  const value = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof value === 'number' ? value : undefined;
}

export async function createOnnxRuntime({
  modelUrl,
  device = 'cpu',
  threads = 1,
  onStage,
}: OnnxRuntimeOptions): Promise<OnnxRuntime> {
  onStage?.('Starting the ONNX runtime worker…');
  const worker = new Worker(new URL('../workers/ort.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  let closed = false;

  const failAll = (error: Error) => {
    for (const request of pending.values()) {
      request.cleanup?.();
      request.reject(error);
    }
    pending.clear();
  };

  worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; error?: string }>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    request.cleanup?.();
    if (!response.ok) request.reject(new Error(response.error || 'ONNX inference failed.'));
    else request.resolve(response);
  };
  worker.onerror = (event) => {
    failAll(new Error(event.message || 'The ONNX worker stopped unexpectedly.'));
  };

  const send = (message: Record<string, unknown>, signal?: AbortSignal) =>
    new Promise<unknown>((resolve, reject) => {
      if (closed) {
        reject(new Error('The ONNX runtime has been disposed.'));
        return;
      }
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const id = nextId++;
      let cleanup: (() => void) | undefined;
      const onAbort = () => {
        pending.delete(id);
        cleanup?.();
        reject(abortError());
      };
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
        cleanup = () => signal.removeEventListener('abort', onAbort);
      }
      pending.set(id, { resolve, reject, cleanup });
      worker.postMessage({ ...message, id });
    });

  try {
    const { ortUrl, wasmPaths } = assets(device);
    onStage?.(`Loading the ${device === 'webgpu' ? 'WebGPU' : 'WASM'} backend…`);
    await send({ type: 'init', ortUrl, wasmPaths, modelUrl, device, threads });
  } catch (error) {
    closed = true;
    worker.terminate();
    throw error;
  }

  return {
    device,
    async run(inputs, signal) {
      const response = (await send(
        {
          type: 'run',
          inputs: Object.fromEntries(
            Object.entries(inputs).map(([name, tensor]) => [
              name,
              { dims: tensor.dims, type: tensor.type, data: tensor.data.buffer },
            ]),
          ),
        },
        signal,
      )) as { outputs?: Record<string, { data: ArrayBuffer; dims: number[]; type: OnnxTensor['type'] }> };
      const outputs: Record<string, OnnxTensor> = {};
      for (const [name, tensor] of Object.entries(response.outputs || {})) {
        outputs[name] = {
          dims: tensor.dims,
          type: tensor.type,
          data:
            tensor.type === 'int64'
              ? new BigInt64Array(tensor.data)
              : tensor.type === 'int32'
                ? new Int32Array(tensor.data)
                : new Float32Array(tensor.data),
        };
      }
      return outputs;
    },
    cancel() {
      if (closed) return;
      closed = true;
      failAll(abortError());
      worker.terminate();
    },
    dispose() {
      if (closed) return;
      closed = true;
      try {
        worker.postMessage({ type: 'dispose', id: nextId++ });
      } catch {}
      failAll(new Error('The ONNX runtime was disposed.'));
      worker.terminate();
    },
  };
}
