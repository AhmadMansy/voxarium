/// <reference lib="webworker" />

/**
 * Shared ONNX Runtime Web worker.
 *
 * The worker owns exactly one inference session. Tokenisation and feature
 * extraction stay with the model-specific adapter on the main thread; this
 * worker only moves tensors across the boundary so WASM threads and an optional
 * WebGPU adapter are set up once and reused for every request.
 */

type InitRequest = {
  type: 'init';
  id: number;
  ortUrl: string;
  wasmPaths: string;
  modelUrl: string;
  device: 'cpu' | 'webgpu';
  threads: number;
};

type RunRequest = {
  type: 'run';
  id: number;
  inputs: Record<string, { data: ArrayBuffer; dims: number[]; type: string }>;
};

type DisposeRequest = { type: 'dispose'; id: number };

type WorkerRequest = InitRequest | RunRequest | DisposeRequest;

type OrtTensor = { data: Float32Array | Int32Array | BigInt64Array; dims: number[]; type: string };

type OrtSession = { run: (feeds: Record<string, unknown>) => Promise<Record<string, OrtTensor>>; release?: () => Promise<void> };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ort: any = null;
let session: OrtSession | null = null;
let device: 'cpu' | 'webgpu' = 'cpu';

const scope = self as unknown as DedicatedWorkerGlobalScope;

function reply(id: number, payload: Record<string, unknown>) {
  scope.postMessage({ id, ...payload });
}

async function init(request: InitRequest) {
  ort = await import(/* @vite-ignore */ request.ortUrl);
  ort.env.wasm.wasmPaths = request.wasmPaths;
  ort.env.wasm.numThreads = Math.max(1, request.threads);
  ort.env.wasm.simd = true;
  device = request.device;

  const executionProviders = request.device === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
  session = await ort.InferenceSession.create(request.modelUrl, {
    executionProviders,
    graphOptimizationLevel: 'all',
  });
}

async function run(request: RunRequest) {
  if (!ort || !session) throw new Error('The ONNX session is not ready.');
  const feeds: Record<string, unknown> = {};
  for (const [name, tensor] of Object.entries(request.inputs)) {
    const data =
      tensor.type === 'int64'
        ? new BigInt64Array(tensor.data)
        : tensor.type === 'int32'
          ? new Int32Array(tensor.data)
          : new Float32Array(tensor.data);
    feeds[name] = new ort.Tensor(tensor.type, data, tensor.dims);
  }
  const outputs = await session.run(feeds);
  const serialised: Record<string, { data: ArrayBuffer; dims: number[]; type: string }> = {};
  for (const [name, tensor] of Object.entries(outputs)) {
    const data = tensor.data as Float32Array | Int32Array | BigInt64Array;
    const copy =
      data instanceof BigInt64Array
        ? new BigInt64Array(data).buffer
        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    serialised[name] = { data: copy as ArrayBuffer, dims: [...tensor.dims], type: tensor.type };
  }
  return serialised;
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'init') {
      await init(request);
      reply(request.id, { ok: true, device });
      return;
    }
    if (request.type === 'run') {
      reply(request.id, { ok: true, outputs: await run(request) });
      return;
    }
    if (request.type === 'dispose') {
      await session?.release?.().catch(() => {});
      session = null;
      reply(request.id, { ok: true });
    }
  } catch (error) {
    reply(request.id, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
