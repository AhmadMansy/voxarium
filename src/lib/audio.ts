import { Mp3Encoder } from '@breezystack/lamejs';

let sharedContext: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') {
    sharedContext = new AudioContext({ sampleRate: 24000 });
  }
  if (sharedContext.state === 'suspended') void sharedContext.resume();
  return sharedContext;
}

export function concatPcm(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function computePeaks(pcm: Float32Array, buckets = 96): number[] {
  if (!pcm.length) return new Array(buckets).fill(0);
  const size = Math.max(1, Math.floor(pcm.length / buckets));
  const peaks: number[] = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = bucket * size;
    const end = Math.min(pcm.length, start + size);
    let max = 0;
    let sum = 0;
    for (let i = start; i < end; i += 1) {
      const value = Math.abs(pcm[i]);
      if (value > max) max = value;
      sum += value * value;
    }
    const rms = end > start ? Math.sqrt(sum / (end - start)) : 0;
    peaks.push(Math.max(0.02, Math.min(1, max * 0.72 + rms * 0.65)));
  }
  // A light blur makes the mini waveforms look less spiky.
  return peaks.map((value, index) => {
    const prev = peaks[index - 1] ?? value;
    const next = peaks[index + 1] ?? value;
    return Math.min(1, Math.max(0.02, (prev + value * 2 + next) / 4));
  });
}

export function pcmToAudioBuffer(pcm: Float32Array, sampleRate = 24000): AudioBuffer {
  const ctx = getAudioContext();
  const buffer = ctx.createBuffer(1, Math.max(1, pcm.length), sampleRate);
  buffer.getChannelData(0).set(pcm);
  return buffer;
}

export function encodeWavBuffer(pcm: Float32Array, sampleRate = 24000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  let offset = 44;
  for (let i = 0; i < pcm.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
    offset += 2;
  }
  return buffer;
}

export function encodeMp3(pcm: Float32Array, sampleRate = 24000, kbps = 96): Uint8Array {
  const encoder = new Mp3Encoder(1, sampleRate, kbps);
  const samples = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, pcm[i]));
    samples[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const chunks: Uint8Array[] = [];
  const blockSize = 1152;
  for (let i = 0; i < samples.length; i += blockSize) {
    const slice = samples.subarray(i, Math.min(samples.length, i + blockSize));
    const encoded = encoder.encodeBuffer(slice);
    if (encoded.length) chunks.push(new Uint8Array(encoded));
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(new Uint8Array(tail));
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export async function decodeAudioFile(buffer: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  return ctx.decodeAudioData(buffer.slice(0));
}

/** A small scheduling player for audio chunks that arrive while the model is generating. */
export class LivePlayer {
  private ctx: AudioContext;
  private gain: GainNode;
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private active = false;
  volume = 1;

  constructor() {
    this.ctx = getAudioContext();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.ctx.destination);
  }

  start() {
    this.stopSources();
    this.active = true;
    this.nextTime = this.ctx.currentTime + 0.08;
  }

  enqueue(pcm: Float32Array, sampleRate = 24000) {
    if (!this.active || !pcm.length) return;
    const buffer = this.ctx.createBuffer(1, pcm.length, sampleRate);
    buffer.getChannelData(0).set(pcm);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    const startAt = Math.max(this.ctx.currentTime + 0.03, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      try {
        source.disconnect();
      } catch {}
    };
  }

  setVolume(value: number) {
    this.volume = value;
    if (this.gain) this.gain.gain.value = value;
  }

  stopSources() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
      try {
        source.disconnect();
      } catch {}
    }
    this.sources.clear();
  }

  stop() {
    this.active = false;
    this.stopSources();
  }

  dispose() {
    this.stop();
    try {
      this.gain.disconnect();
    } catch {}
  }
}

/** A scrubbable Web Audio player used for previews and history playback. */
export class StudioPlayer {
  private ctx: AudioContext;
  private gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private startedAt = 0;
  private offset = 0;
  private raf = 0;
  private _playing = false;
  private _rate = 1;
  private _volume = 1;
  private _loop = false;
  private listeners = new Set<() => void>();

  constructor() {
    this.ctx = getAudioContext();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this._volume;
    this.gain.connect(this.ctx.destination);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get playing(): boolean {
    return this._playing;
  }

  get rate(): number {
    return this._rate;
  }

  get volume(): number {
    return this._volume;
  }

  get loop(): boolean {
    return this._loop;
  }

  get time(): number {
    if (!this._playing) return Math.min(this.offset, this.duration);
    const elapsed = (this.ctx.currentTime - this.startedAt) * this._rate;
    if (this._loop && this.duration > 0) return (this.offset + elapsed) % this.duration;
    return Math.min(this.duration, this.offset + elapsed);
  }

  setBuffer(buffer: AudioBuffer | null) {
    this.stopInternal(true);
    this.buffer = buffer;
    this.offset = 0;
    this.emit();
  }

  play(from?: number) {
    if (!this.buffer) return;
    if (this._playing) {
      if (from == null) return;
      this.stopInternal(false);
    }
    let start = from ?? this.offset;
    if (start >= this.duration - 0.005) start = 0;
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = this._loop;
    source.playbackRate.value = this._rate;
    source.connect(this.gain);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      this._playing = false;
      cancelAnimationFrame(this.raf);
      if (!this._loop) this.offset = this.duration;
      this.emit();
    };
    source.start(0, Math.max(0, start));
    this.source = source;
    this.startedAt = this.ctx.currentTime;
    this.offset = start;
    this._playing = true;
    this.emit();
    this.tick();
  }

  pause() {
    if (!this._playing) return;
    const current = this.time;
    this.offset = current;
    this.stopInternal(false);
    this.emit();
  }

  toggle() {
    if (this._playing) this.pause();
    else this.play();
  }

  seek(time: number) {
    const clamped = Math.max(0, Math.min(this.duration, time));
    if (this._playing) {
      this.stopInternal(false);
      this.offset = clamped;
      this.play(clamped);
    } else {
      this.offset = clamped;
      this.emit();
    }
  }

  setRate(rate: number) {
    const current = this.time;
    this._rate = rate;
    if (this._playing) {
      this.stopInternal(false);
      this.offset = current;
      this.play(current);
    }
    this.emit();
  }

  setVolume(volume: number) {
    this._volume = Math.max(0, Math.min(1, volume));
    this.gain.gain.value = this._volume;
    this.emit();
  }

  setLoop(loop: boolean) {
    this._loop = loop;
    if (this.source) this.source.loop = loop;
    this.emit();
  }

  stop() {
    this.offset = 0;
    this.stopInternal(true);
    this.emit();
  }

  private stopInternal(reset: boolean) {
    if (this.source) {
      const source = this.source;
      this.source = null;
      try {
        source.onended = null;
        source.stop();
      } catch {}
      try {
        source.disconnect();
      } catch {}
    }
    this._playing = false;
    cancelAnimationFrame(this.raf);
    if (reset) this.offset = 0;
  }

  private tick = () => {
    this.raf = requestAnimationFrame(() => {
      if (!this._playing) return;
      this.emit();
      this.tick();
    });
  };

  dispose() {
    this.stopInternal(true);
    try {
      this.gain.disconnect();
    } catch {}
    this.listeners.clear();
  }
}
