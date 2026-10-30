import type { Lang, PhononTTS, SpeechStats } from 'phonon-tts';
import type { EngineInfo, Settings, VoiceInfo } from '../types';
import type { ModelManifest, SidecarStatus, SidecarVoice } from '../models/types';
import { VOICES, getVoice, isCustomVoice, modelVoiceId, nativeVoiceId } from '../data/catalog';
import { concatPcm } from './audio';
import { toSeedValue } from './utils';
import { assertLocalSidecar, listSidecarVoices, synthesizeWithSidecar } from './sidecar';

type PhononModule = typeof import('phonon-tts');

export interface LoadedEngine {
  tts: PhononTTS | null;
  module: PhononModule | null;
  info: EngineInfo;
  modelId: string;
  runtime: ModelManifest['runtime'];
  sidecar?: { baseUrl: string; token: string };
  /** Voices reported by a sidecar model. */
  voices?: VoiceInfo[];
  defaultVoiceId?: string;
}

export interface LoadEngineOptions {
  settings: Settings;
  manifest: ModelManifest;
  serverUrl: string;
  onStage?: (stage: string) => void;
}

function moduleUrl(): string {
  return new URL('phonon/index.js', document.baseURI).href;
}

function workerUrl(settings: Settings): string {
  // Plain worker for the default adapter; the shim only exists to forward a preference.
  if (!settings.gpuPreference || settings.gpuPreference === 'auto') {
    return new URL('phonon/worker.js', document.baseURI).href;
  }
  const url = new URL('phonon/worker-gpu.js', document.baseURI);
  url.searchParams.set('gpuPreference', settings.gpuPreference);
  return url.href;
}

export function modelFileUrl(serverUrl: string, modelId: string, name: string): string {
  return `${serverUrl}/model/${encodeURIComponent(modelId)}/${encodeURIComponent(name)}`;
}

export function voiceFileUrl(serverUrl: string, voiceId: string): string {
  if (voiceId === 'default') return `${serverUrl}/model/default-voice.safetensors`;
  return `${serverUrl}/voice/${encodeURIComponent(voiceId)}.safetensors`;
}

export function customVoiceUrl(serverUrl: string, voiceId: string): string {
  return `${serverUrl}/voice/custom/${encodeURIComponent(voiceId)}.safetensors`;
}

export function runtimeGateError(manifest: ModelManifest, runtimeReady = manifest.runtimePack.available): string | null {
  if (manifest.runtime === 'phonon') return null;
  const pack = manifest.runtimePack;
  if (!runtimeReady) {
    return `${manifest.shortName} needs its ${manifest.runtime === 'onnx-web' ? 'ONNX' : 'Python sidecar'} runtime pack, which is not installed. ${pack.reason || ''}`.trim();
  }
  if (manifest.runtime === 'sidecar') return null;
  return `${manifest.shortName} has its ${manifest.runtimeLabel} runtime, but the generation adapter for this model is not wired up yet.`;
}

function sidecarVoiceInfo(manifest: ModelManifest, voice: SidecarVoice, defaultId: string): VoiceInfo {
  const language = voice.language || manifest.defaults.language;
  return {
    id: modelVoiceId(manifest.id, voice.id),
    name: voice.name,
    language,
    locale: language.toLowerCase(),
    gender: voice.gender || null,
    age: null,
    description:
      voice.description ||
      (voice.kind === 'reference' ? 'Your reference clip, cloned locally.' : `A built-in ${manifest.shortName} voice.`),
    file: '',
    isDefault: voice.id === defaultId,
    source: 'model',
    modelId: manifest.id,
  };
}

async function loadSidecarEngine({
  settings,
  manifest,
  onStage,
}: Omit<LoadEngineOptions, 'serverUrl'>): Promise<LoadedEngine> {
  onStage?.(`Starting ${manifest.shortName}…`);
  const startedAt = performance.now();
  // The main process reports each loading step; first starts can take a while.
  const unsubscribe = window.studio.onSidecarStatus?.((status) => {
    if (status.modelId === manifest.id && status.state === 'starting' && status.stage) onStage?.(status.stage);
  });
  let status: SidecarStatus;
  try {
    const current = await window.studio.models.sidecar.status(manifest.id);
    if (current.state === 'ready' && current.url && current.token) {
      status = current;
    } else {
      const started = await window.studio.models.sidecar.start(manifest.id, settings.device === 'cpu' ? 'cpu' : 'auto');
      if (!started.ok || !started.status?.url || !started.status?.token) {
        throw new Error(started.error || `${manifest.shortName} failed to start.`);
      }
      status = started.status;
    }
  } finally {
    unsubscribe?.();
  }
  const baseUrl = assertLocalSidecar(status);
  const token = status.token as string;
  const listed = await listSidecarVoices(baseUrl, token);
  const voices = listed.voices.map((voice) => sidecarVoiceInfo(manifest, voice, listed.default));
  const onGpu = status.device === 'cuda';
  const info: EngineInfo = {
    modelId: manifest.id,
    sampleRate: 24000,
    device: onGpu ? 'webgpu' : 'cpu',
    deviceReason: onGpu
      ? 'Runs on your NVIDIA GPU through CUDA PyTorch in a local Python sidecar.'
      : 'Runs on the CPU in a local Python sidecar.',
    threads: 1,
    threadsReason: 'Managed by the sidecar.',
    features: {},
    languages: manifest.languages.map((lang) => lang.code),
    crossOriginIsolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false,
    loadMs: performance.now() - startedAt,
  };
  return {
    tts: null,
    module: null,
    info,
    modelId: manifest.id,
    runtime: 'sidecar',
    sidecar: { baseUrl, token },
    voices,
    defaultVoiceId: modelVoiceId(manifest.id, listed.default),
  };
}

export async function loadEngine({
  settings,
  manifest,
  serverUrl,
  onStage,
}: LoadEngineOptions): Promise<LoadedEngine> {
  // Sidecar readiness is dynamic (installed packs), not the static manifest flag.
  // The caller and the main-process supervisor both enforce it, so do not re-gate here.
  if (manifest.runtime === 'sidecar') return loadSidecarEngine({ settings, manifest, onStage });

  const gate = runtimeGateError(manifest);
  if (gate) throw new Error(gate);

  if (manifest.runtime !== 'phonon') throw new Error(`${manifest.shortName} is not a Phonon runtime.`);

  onStage?.('Starting the local runtime…');
  const module = (await import(/* @vite-ignore */ moduleUrl())) as PhononModule;
  if (!module?.PhononTTS) throw new Error('The Phonon runtime could not be loaded.');

  const defaultVoiceFile = manifest.files.find((file) => file.name === 'default-voice.safetensors');
  if (!defaultVoiceFile) {
    throw new Error(`${manifest.shortName} is missing its default voice file.`);
  }

  const voices: Record<string, string> = {};
  for (const voice of VOICES) {
    voices[voice.id] =
      voice.id === 'default'
        ? modelFileUrl(serverUrl, manifest.id, defaultVoiceFile.name)
        : voiceFileUrl(serverUrl, voice.id);
  }

  onStage?.(`Loading ${manifest.shortName} weights…`);
  const startedAt = performance.now();
  const tts = await module.PhononTTS.load({
    lang: settings.language as Lang,
    rewrites: settings.rewrites,
    conditions: {
      num_speakers: settings.conditions.num_speakers,
      duration_delta: settings.conditions.duration_delta,
    },
    quant: settings.quality,
    model: {
      weights: {
        q8: modelFileUrl(serverUrl, manifest.id, 'model.q8.gguf'),
        f32: modelFileUrl(serverUrl, manifest.id, 'model.safetensors'),
      },
      tokenizer: modelFileUrl(serverUrl, manifest.id, 'tokenizer.json'),
      config: modelFileUrl(serverUrl, manifest.id, 'config.json'),
      voices,
      defaultVoice: 'default',
    },
    voices: ['default'],
    cache: false,
    threads: settings.threads === 'auto' ? 'auto' : Number(settings.threads),
    device: settings.device,
    workerUrl: workerUrl(settings),
    onProgress: (progress) => {
      if (progress.file === 'weights') {
        onStage?.(progress.cached ? 'Reading model from disk…' : 'Loading model weights…');
      }
    },
  });

  const info: EngineInfo = {
    modelId: manifest.id,
    sampleRate: tts.sampleRate,
    device: tts.device,
    deviceReason: tts.deviceReason,
    threads: tts.threads,
    threadsReason: tts.threadsReason,
    features: tts.features,
    languages: tts.languages,
    crossOriginIsolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false,
    loadMs: performance.now() - startedAt,
  };

  return { tts, module, info, modelId: manifest.id, runtime: 'phonon' };
}

export function releaseEngine(engine: LoadedEngine | null) {
  if (!engine) return;
  try {
    engine.tts?.dispose();
  } catch {}
}

export interface SynthesizeOptions {
  tts?: PhononTTS | null;
  text: string;
  voiceId: string;
  temperature?: number;
  seed?: string | number | bigint;
  signal?: AbortSignal;
  onChunk?: (pcm: Float32Array, totalSamples: number) => void;
  /** Return the audio produced so far when the signal aborts. */
  keepPartial?: boolean;
  manifest?: ModelManifest;
  sidecar?: { baseUrl: string; token: string };
  language?: string;
  /** Arabic variety (ISO 639-3) for models that distinguish them. */
  variety?: string;
  /** Speaking rate for sidecar models that support it (1 = normal). */
  speed?: number;
  /** Expression panel: a voice/style instruction and an intensity value. */
  instruction?: string;
  intensity?: number;
}

export interface SynthesizeResult {
  pcm: Float32Array;
  stats: SpeechStats | null;
}

export async function synthesize({
  tts,
  text,
  voiceId,
  temperature = 0.3,
  seed,
  signal,
  onChunk,
  keepPartial,
  manifest,
  sidecar,
  language,
  variety,
  speed,
  instruction,
  intensity,
}: SynthesizeOptions): Promise<SynthesizeResult> {
  if (!text.trim()) throw new Error('There is no text to speak.');
  if (manifest?.runtime === 'sidecar' && sidecar) {
    const result = await synthesizeWithSidecar({
      baseUrl: sidecar.baseUrl,
      token: sidecar.token,
      text,
      // Voices from other models fall back to this model's default voice.
      voiceId: nativeVoiceId(manifest.id, voiceId),
      language,
      variety,
      speed,
      instruction,
      intensity,
      temperature,
      seed: seed == null ? undefined : String(seed),
      signal,
      onChunk,
    });
    return { pcm: result.pcm, stats: result.stats };
  }
  if (!tts) throw new Error('The model is not ready yet.');
  const stream = tts.stream(text, {
    voice: voiceId,
    temperature,
    seed: seed == null ? undefined : toSeedValue(String(seed)),
    signal,
  });
  const chunks: Float32Array[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
      total += chunk.length;
      onChunk?.(chunk, total);
    }
  } catch (error) {
    try {
      stream.cancel();
    } catch {}
    const stats = await stream.done.catch(() => null);
    if (keepPartial && signal?.aborted && chunks.length) {
      return { pcm: concatPcm(chunks), stats };
    }
    throw error;
  }
  const stats = await stream.done.catch(() => null);
  return { pcm: concatPcm(chunks), stats };
}

export function previewLine(voiceId: string, sample?: string): string {
  const voice = getVoice(voiceId);
  if (sample) return sample;
  const bits = [
    `Hi, I'm ${voice.name}.`,
    voice.locale === 'characters'
      ? 'Every story deserves a voice like this one.'
      : 'Here is a quick preview of how I sound.',
  ];
  return bits.join(' ');
}

export async function tryAddVoice(
  tts: PhononTTS | null,
  voiceId: string,
  serverUrl: string,
): Promise<void> {
  if (!tts) return;
  // `tts.voices` lists every configured voice name, including files that were never
  // fetched, so it cannot be used to decide whether a voice is actually usable yet.
  // The default voice is loaded up front; every other voice is added here.
  if (voiceId === 'default') return;
  const voice = getVoice(voiceId);
  if (!voice) throw new Error(`Unknown voice: ${voiceId}`);
  if (isCustomVoice(voiceId) || voice.source === 'custom') {
    // Custom voices are already on disk, so they only need registering with the runtime.
    await tts.addVoice(voice.id, customVoiceUrl(serverUrl, voice.id));
    return;
  }
  const status = await window.studio.voices.download(voice.id);
  if (!status.ok) throw new Error(status.error || 'The voice file could not be downloaded.');
  await tts.addVoice(voice.id, voiceFileUrl(serverUrl, voice.id));
}
