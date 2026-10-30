import type { Quality } from '../types';

export type RuntimeKind = 'phonon' | 'onnx-web' | 'sidecar';
export type ModelFormat = 'phonon-safetensors' | 'kokoro-voice-pack' | 'reference-audio' | 'unknown';
export type CloneKind = 'none' | 'local' | 'cloud';
export type FitLevel = 'great' | 'runs' | 'cpu' | 'too-heavy';

export interface ModelCapabilities {
  voiceImport: boolean;
  voiceClone: boolean;
  cloneKind: CloneKind;
  multiSpeaker: boolean;
  emotion: boolean;
  nonVerbal: boolean;
  streaming: boolean;
  phonemes: boolean;
  normalization: boolean;
  speed: boolean;
  seed: boolean;
  watermark: boolean;
  arabic: boolean;
}

export interface ModelLicense {
  id: string;
  name: string;
  commercial: boolean | null;
  restricted: boolean;
  review?: boolean;
  watermark?: boolean;
  url: string;
}

export interface ModelLanguage {
  code: string;
  name: string;
  locale?: string;
  quality?: 'high' | 'medium' | 'low';
  arabic?: boolean;
}

export interface ModelVoiceFormat {
  format: string;
  shape?: number[];
  catalog?: string;
  catalogRevision?: string;
  compatibleLocales?: string[];
  note?: string;
}

export interface ModelHardware {
  backend: 'wasm-webgpu' | 'onnx-web' | 'sidecar' | string;
  minRamGb: number;
  recRamGb: number;
  minVramGb: number;
  recVramGb: number;
  diskGb: number;
}

export interface ModelDefaults {
  quality: Quality;
  device: 'auto' | 'cpu' | 'webgpu';
  temperature: number;
  seed: string;
  language: string;
  rewrites: 'default' | 'all' | 'none';
  threads: 'auto' | number;
}

export interface ModelFile {
  name: string;
  size: number;
  /** SHA-256 for LFS files; empty when the file is pinned another way. */
  sha256: string;
  /** Git blob SHA-1 of a small, non-LFS file. */
  gitSha1?: string;
  /** Git blob SHA-1 of the LFS pointer (gated repos hide the SHA-256 itself). */
  lfsPointerSha1?: string;
  required: boolean;
  quality?: Quality;
}

export interface RuntimePack {
  available: boolean;
  reason?: string;
  /** Runtime pack in electron/models/runtimes.json that must be installed first. */
  packId?: string;
}

export interface ModelManifest {
  schemaVersion?: number;
  id: string;
  name: string;
  shortName: string;
  family: string;
  description: string;
  runtime: RuntimeKind;
  runtimeLabel: string;
  repo: string;
  revision: string | null;
  rating: number;
  ratingNotes: string;
  ratingRubric: string;
  ratingEvidence: string;
  license: ModelLicense;
  languages: ModelLanguage[];
  capabilities: ModelCapabilities;
  voices: ModelVoiceFormat;
  hardware: ModelHardware;
  defaults: ModelDefaults;
  tags: string[];
  available: boolean;
  files: ModelFile[];
  filesVerified: boolean;
  /** The Hugging Face repo is gated: downloads need the user's access token. */
  gated?: boolean;
  runtimePack: RuntimePack;
  order: number;
  downloadBytes: number;
  estimatedBytes?: number;
}

export interface ManifestDocument {
  schemaVersion: number;
  generatedAt: string;
  defaultModelId: string;
  voiceCatalog: { repo: string; revision: string; fileSize: number };
  models: ModelManifest[];
}

/** Persisted, per-model settings. The top-level settings mirror the active model. */
export interface ModelPreferences {
  quality: Quality;
  device: 'auto' | 'cpu' | 'webgpu';
  threads: 'auto' | number;
  language: string;
  rewrites: 'default' | 'all' | 'none';
  conditions: { num_speakers: string; duration_delta: number };
  temperature: number;
  seed: string;
  lastVoice: string;
  streaming: boolean;
  arabicVariety: string;
}

export interface ModelFileState {
  name: string;
  size: number;
  sha256: string;
  required: boolean;
  quality?: Quality;
  exists: boolean;
  bytes: number;
  verified: boolean;
  path: string;
}

export type ModelLifecycle = 'not-installed' | 'downloading' | 'verifying' | 'installed' | 'update' | 'error';

export interface ModelInstallState {
  id: string;
  lifecycle: ModelLifecycle;
  installed: boolean;
  baseReady: boolean;
  qualities: Quality[];
  files: Record<string, ModelFileState>;
  bytes: number;
  installedAt: number | null;
  verifiedAt: number | null;
  source: 'download' | 'import' | 'legacy' | null;
  error?: string;
}

export interface LicenseAck {
  id: string;
  acknowledgedAt: number;
  licenseId: string;
}

export interface SidecarStatus {
  modelId: string;
  state: 'stopped' | 'starting' | 'ready' | 'error';
  url: string | null;
  token: string | null;
  pid: number | null;
  error?: string;
  startedAt?: number;
  /** Human-readable loading step while state is 'starting'. */
  stage?: string;
  device?: string;
  /** The model finished its first (online) load and now runs offline. */
  prepared?: boolean;
}

export interface SidecarVoice {
  id: string;
  name: string;
  language?: string;
  gender?: string | null;
  description?: string;
  kind?: 'design' | 'reference';
}

export interface ModelsSnapshot {
  activeModelId: string;
  generatedAt: string;
  hardware: import('./fit').HardwareProfile;
  models: ModelInstallState[];
  licenses: Record<string, LicenseAck>;
  sidecars: SidecarStatus[];
  runtimes: RuntimePackState[];
}

export type RuntimePackKind = 'tool' | 'python' | 'sidecar';
export type RuntimePackLifecycle = 'installed' | 'not-installed' | 'not-published' | 'error';

export interface RuntimePackArchive {
  name: string;
  url: string;
  size: number;
  sha256: string;
}

export interface RuntimePackState {
  id: string;
  name: string;
  kind: RuntimePackKind;
  version: string;
  platform: string;
  arch: string;
  description: string;
  homepage?: string;
  license: ModelLicense;
  available: boolean;
  importable: boolean;
  reason: string | null;
  entry: { python?: string; server?: string; uv?: string };
  requires: string[];
  provides: string[];
  archive: RuntimePackArchive | null;
  /** Built on this machine from a pinned recipe instead of downloaded as an archive. */
  buildable?: boolean;
  /** PyTorch build used by an installed sidecar pack: a CUDA tag, 'cpu', or 'none'. */
  variant?: string | null;
  sizeBytes: number;
  installedBytes: number;
  lifecycle: RuntimePackLifecycle;
  installed: boolean;
  bytes: number;
  installedAt: number | null;
  verifiedAt: number | null;
  source: 'download' | 'import' | 'build' | null;
  error?: string;
}

export interface RuntimeDownloadEvent {
  kind: 'runtime';
  runtimeId: string;
  file: string;
  loaded: number;
  total: number;
  percent: number | null;
  index: number;
  count: number;
  cached?: boolean;
  stage: 'downloading' | 'verifying' | 'installing' | 'installed' | 'error';
  done?: boolean;
  error?: string;
  at?: number;
}

export type ModelsProgressEvent = ModelDownloadEvent | RuntimeDownloadEvent;

export interface ModelDownloadEvent {
  kind: 'model';
  modelId: string;
  file: string;
  loaded: number;
  total: number;
  percent: number | null;
  index: number;
  count: number;
  cached?: boolean;
  stage: ModelLifecycle;
  quality?: Quality;
  done?: boolean;
  error?: string;
  at?: number;
}

export interface SidecarLogEvent {
  modelId: string;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  at: number;
}
