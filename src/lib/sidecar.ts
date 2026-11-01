// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SpeechStats } from '../types';
import { concatPcm, decodeAudioFile } from './audio';
import type { SidecarStatus, SidecarVoice } from '../models/types';

/**
 * HTTP client for the loopback sidecar servers (electron/sidecars). Requests
 * carry the per-session token and this module never accepts a remote URL.
 * Servers return mono float32 PCM already resampled to 24 kHz.
 */
export interface SidecarSynthesisOptions {
  baseUrl: string;
  token: string;
  text: string;
  /** The model's own voice id, or null for its default voice. */
  voiceId: string | null;
  language?: string;
  variety?: string;
  speed?: number;
  instruction?: string;
  intensity?: number;
  temperature?: number;
  seed?: string;
  signal?: AbortSignal;
  onChunk?: (pcm: Float32Array, totalSamples: number) => void;
}

export interface SidecarSynthesisResult {
  pcm: Float32Array;
  sampleRate: number;
  stats: SpeechStats | null;
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toFloat32(value: unknown): Float32Array | null {
  if (value instanceof Float32Array) return value;
  if (Array.isArray(value)) return Float32Array.from(value as number[]);
  if (typeof value === 'string') {
    const bytes = fromBase64(value);
    return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  }
  return null;
}

export function assertLocalSidecar(status: SidecarStatus): string {
  if (!status.url) throw new Error('The sidecar is not running.');
  let url: URL;
  try {
    url = new URL(status.url);
  } catch {
    throw new Error('The sidecar returned an invalid address.');
  }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
    throw new Error('Refusing to contact a sidecar that is not on this machine.');
  }
  if (!status.token) throw new Error('The sidecar session token is missing.');
  return status.url.replace(/\/$/, '');
}

export async function listSidecarVoices(baseUrl: string, token: string): Promise<{ voices: SidecarVoice[]; default: string }> {
  const response = await fetch(`${baseUrl}/voices`, { headers: { authorization: `Bearer ${token}` } });
  const body = (await response.json().catch(() => null)) as { voices?: SidecarVoice[]; default?: string; error?: string } | null;
  if (!response.ok || !body || !Array.isArray(body.voices)) {
    throw new Error(`The model did not list its voices: ${body?.error || response.status}`);
  }
  return { voices: body.voices, default: body.default || body.voices[0]?.id || 'default' };
}

export async function synthesizeWithSidecar({
  baseUrl,
  token,
  text,
  voiceId,
  language,
  variety,
  speed,
  instruction,
  intensity,
  temperature = 0.3,
  seed,
  signal,
  onChunk,
}: SidecarSynthesisOptions): Promise<SidecarSynthesisResult> {
  if (!text.trim()) throw new Error('There is no text to speak.');
  const response = await fetch(`${baseUrl}/synthesize`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      text,
      voice: voiceId,
      language: language || undefined,
      variety: variety || undefined,
      speed: speed || undefined,
      instruction: instruction || undefined,
      intensity: intensity ?? undefined,
      temperature,
      seed: seed || undefined,
      format: 'f32',
    }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const message = detail?.error || detail?.detail || `${response.status} ${response.statusText}`;
    throw new Error(`Sidecar synthesis failed: ${message}`);
  }

  const type = response.headers.get('content-type') || '';
  if (type.includes('ndjson') && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: Float32Array[] = [];
    let buffer = '';
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as { pcm?: unknown; sampleRate?: number; stats?: SpeechStats };
        const chunk = toFloat32(event.pcm);
        if (!chunk?.length) continue;
        chunks.push(chunk);
        total += chunk.length;
        onChunk?.(chunk, total);
      }
    }
    if (!chunks.length) throw new Error('The sidecar returned no audio.');
    return { pcm: concatPcm(chunks), sampleRate: 24000, stats: null };
  }

  if (type.includes('application/json')) {
    const body = (await response.json()) as { pcm?: unknown; sampleRate?: number; stats?: SpeechStats };
    const pcm = toFloat32(body.pcm);
    if (!pcm?.length) throw new Error('The sidecar returned no audio.');
    onChunk?.(pcm, pcm.length);
    return { pcm, sampleRate: body.sampleRate || 24000, stats: body.stats || null };
  }

  const audio = await decodeAudioFile(await response.arrayBuffer());
  const pcm = audio.getChannelData(0).slice();
  onChunk?.(pcm, pcm.length);
  return { pcm, sampleRate: audio.sampleRate, stats: null };
}
