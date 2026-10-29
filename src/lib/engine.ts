import type { PhononTTS, SpeechStats } from 'phonon-tts';
import type { EngineInfo, Settings } from '../types';
import { VOICES, getVoice } from '../data/catalog';
import { concatPcm } from './audio';
import { toSeedValue } from './utils';

type PhononModule = typeof import('phonon-tts');

export interface LoadedEngine {
  tts: PhononTTS;
  module: PhononModule;
  info: EngineInfo;
}

export interface LoadEngineOptions {
  settings: Settings;
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

export async function loadEngine({ settings, serverUrl, onStage }: LoadEngineOptions): Promise<LoadedEngine> {
  onStage?.('Starting the local runtime…');
  const module = (await import(/* @vite-ignore */ moduleUrl())) as PhononModule;
  if (!module?.PhononTTS) throw new Error('The Phonon runtime could not be loaded.');

  const voices: Record<string, string> = {};
  for (const voice of VOICES) {
    voices[voice.id] =
      voice.id === 'default'
        ? `${serverUrl}/model/default-voice.safetensors`
        : `${serverUrl}/voice/${voice.id}.safetensors`;
  }

  onStage?.('Loading Phonon 31M weights…');
  const startedAt = performance.now();
  const tts = await module.PhononTTS.load({
    lang: settings.language,
    rewrites: settings.rewrites,
    conditions: {
      num_speakers: settings.conditions.num_speakers,
      duration_delta: settings.conditions.duration_delta,
    },
    quant: settings.quality,
    model: {
      weights: {
        q8: `${serverUrl}/model/model.q8.gguf`,
        f32: `${serverUrl}/model/model.safetensors`,
      },
      tokenizer: `${serverUrl}/model/tokenizer.json`,
      config: `${serverUrl}/model/config.json`,
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

  return { tts, module, info };
}

export function releaseEngine(engine: LoadedEngine | null) {
  if (!engine) return;
  try {
    engine.tts.dispose();
  } catch {}
}

export interface SynthesizeOptions {
  tts: PhononTTS;
  text: string;
  voiceId: string;
  temperature?: number;
  seed?: string | number | bigint;
  signal?: AbortSignal;
  onChunk?: (pcm: Float32Array, totalSamples: number) => void;
  /** Return the audio produced so far when the signal aborts. */
  keepPartial?: boolean;
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
}: SynthesizeOptions): Promise<SynthesizeResult> {
  if (!text.trim()) throw new Error('There is no text to speak.');
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
  tts: PhononTTS,
  voiceId: string,
  serverUrl: string,
): Promise<void> {
  // `tts.voices` lists every configured voice name, including files that were never
  // fetched, so it cannot be used to decide whether a voice is actually usable yet.
  // The default voice is loaded up front; every other voice is added here.
  if (voiceId === 'default') return;
  const voice = getVoice(voiceId);
  if (!voice) throw new Error(`Unknown voice: ${voiceId}`);
  if (voice.source === 'custom') {
    // Custom voices are already on disk, so they only need registering with the runtime.
    await tts.addVoice(voice.id, `${serverUrl}/voice/custom/${voice.id}.safetensors`);
    return;
  }
  const status = await window.studio.voices.download(voice.id);
  if (!status.ok) throw new Error(status.error || 'The voice file could not be downloaded.');
  const url = `${serverUrl}/voice/${voice.id}.safetensors`;
  await tts.addVoice(voice.id, url);
}
