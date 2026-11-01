// SPDX-License-Identifier: AGPL-3.0-or-later
import type { HardwareProfile } from './models/fit';
import type {
  LicenseAck,
  ModelCapabilities,
  ModelDownloadEvent,
  ModelInstallState,
  SynthesisCheck,
  ModelLicense,
  ModelsProgressEvent,
  ModelsSnapshot,
  ModelLifecycle,
  RuntimeKind,
  RuntimePackState,
  SidecarLogEvent,
  SidecarStatus,
} from './models/types';

export type Page = 'studio' | 'models' | 'voices' | 'history' | 'batch' | 'integrations' | 'settings';

export type Theme = 'dark' | 'light';
export type Accent = 'signal' | 'violet' | 'cyan' | 'amber' | 'rose';
export type Quality = 'q8' | 'f32';
export type Device = 'auto' | 'cpu' | 'webgpu';
/** Which GPU the browser process and WebGPU should prefer on multi-GPU machines. */
export type GpuPreference = 'auto' | 'high-performance' | 'low-power';

export interface GpuDeviceInfo {
  active?: boolean;
  vendorId?: number;
  deviceId?: number;
  deviceString?: string;
  driverVendor?: string;
  driverVersion?: string;
  gpuPreference?: number;
}

export interface GpuInfoResult {
  preference: GpuPreference;
  platform: string;
  active: string;
  devices: GpuDeviceInfo[];
  featureStatus: Record<string, string>;
}
export type Language = string;
export type Rewrites = 'default' | 'all' | 'none';

export interface VoiceInfo {
  id: string;
  name: string;
  language: string;
  locale: string;
  gender: string | null;
  age: string | null;
  description: string;
  file: string;
  isDefault: boolean;
  /**
   * Catalog voices ship with the model's voice pack; custom ones are imported locally;
   * model voices are reported by a sidecar model and only work with that model.
   */
  source?: 'catalog' | 'custom' | 'model';
  /** For model voices: the model that provides them. */
  modelId?: string;
  customKind?: 'clone' | 'import';
  createdAt?: number;
  bytes?: number;
}

export interface CustomVoiceRecord {
  id: string;
  name: string;
  source: 'clone' | 'import';
  language: string;
  createdAt: number;
  bytes: number;
  fileName: string;
  sha256?: string;
  /** Legacy: set on voices cloned by an earlier version; kept so they keep working. */
  consentAt?: number;
}

export interface Catalog {
  generatedAt: string;
  model: {
    repo: string;
    revision: string;
    name: string;
    parameterCount: string;
    sampleRate: number;
    license: string;
  };
  voicesRepo: { repo: string; revision: string };
  voices: VoiceInfo[];
}

export interface Conditions {
  num_speakers: string;
  duration_delta: number;
}

export interface Pronunciation {
  from: string;
  to: string;
}

export interface Settings {
  theme: Theme;
  accent: Accent;
  outputDir: string;
  autoSave: boolean;
  autoPlay: boolean;
  streaming: boolean;
  /** Adapter preference for multi-GPU machines. High-performance needs a restart. */
  gpuPreference: GpuPreference;
  defaultVoice: string;
  lastVoice: string;
  /** The model that owns the top-level generation settings. */
  activeModelId: string;
  /** Saved settings per model so switching preserves each model's setup. */
  modelSettings: Record<string, Partial<import('./models/types').ModelPreferences>>;
  arabicVariety: string;
  quality: Quality;
  device: Device;
  threads: 'auto' | number;
  language: Language;
  rewrites: Rewrites;
  conditions: Conditions;
  filenameTemplate: string;
  temperature: number;
  seed: string;
  pronunciations: Pronunciation[];
  setupComplete: boolean;
  onboardingDismissed: boolean;
  /** Local HTTP API for other apps, the CLI and MCP clients. */
  apiEnabled: boolean;
  apiPort: number;
  /** Lets API clients use the user's reference clips (local voice cloning). */
  apiAllowCloning: boolean;
  /** Closing the window keeps Voxarium running in the tray. */
  closeToTray: boolean;
  /** Start hidden in the tray when the user signs in. */
  launchAtLogin: boolean;
  /** Expression panel values per model (instruction, attributes, intensity). */
  expression: Record<string, ExpressionSettings>;
}

export interface ExpressionSettings {
  instruction?: string;
  attributes?: Record<string, string>;
  intensity?: number;
}

export interface ApiStatus {
  enabled: boolean;
  running: boolean;
  url: string | null;
  port: number;
  token: string | null;
  error: string | null;
  discoveryFile: string;
  closeToTray: boolean;
  launchAtLogin: boolean;
  cli: { command: string; args: string[]; env: Record<string, string> };
  mcp: { command: string; args: string[]; env: Record<string, string> };
}

/** One request in the local API's activity log (kept in memory, last 100). */
export interface ApiActivity {
  id: string;
  at: number;
  client: string;
  route: string;
  status: number;
  ms: number;
  error: string | null;
  model?: string;
  voice?: string;
  chars?: number;
  duration?: number;
  saved?: boolean;
  played?: boolean;
}

export type ApiTestResult =
  | { ok: true; model: string; voice: string; duration: number; audio_base64: string; license: string; commercial: boolean | null }
  | { ok: false; error: string };

export interface EngineBridgeRequest {
  id: string;
  op: 'status' | 'models' | 'voices' | 'synthesize';
  payload: Record<string, unknown>;
}

export interface SpeechStats {
  chunks?: number;
  tokens?: number;
  frames?: number;
  samples?: number;
  promptMs?: number;
  stepMs?: { avg: number; min: number; max: number };
  firstAudioMs?: number | null;
  totalMs?: number;
  cancelled: boolean;
}

export interface GenerationMeta {
  modelId: string;
  modelName: string;
  runtime: RuntimeKind;
  license: string;
  rating: number;
  capabilities: ModelCapabilities;
  quality: Quality;
  device: Device;
  temperature: number;
  seed: string;
  rewrites: Rewrites;
  language: Language;
  arabicVariety?: string;
  conditions: Conditions;
  /** Where the take came from: the Studio, or the local API (CLI/MCP/other apps). */
  source?: 'studio' | 'api';
}

export interface HistoryEntry {
  id: string;
  title: string;
  text: string;
  voiceId: string;
  voiceName: string;
  createdAt: number;
  filePath: string;
  fileName: string;
  bytes: number;
  duration: number;
  sampleRate: number;
  peaks: number[];
  favorite: boolean;
  meta: GenerationMeta;
  stats: SpeechStats | null;
}

export interface ModelFileStatus {
  size: number;
  required: boolean;
  quality?: Quality;
  sha256?: string;
  exists: boolean;
  bytes: number;
  verified?: boolean;
  path: string;
}

export interface ModelStatus {
  installed: boolean;
  baseReady: boolean;
  q8Ready: boolean;
  f32Ready: boolean;
  modelId?: string;
  name?: string;
  runtime?: string;
  lifecycle?: string;
  qualities?: Quality[];
  source?: string | null;
  files: Record<string, ModelFileStatus>;
  voicesDownloaded: number;
  voiceIds: string[];
  dirs: { data: string; models: string; voices: string; audio: string };
}

export interface StorageStats {
  models: { bytes: number; files: number };
  runtimes?: { bytes: number; files: number };
  voices: { bytes: number; files: number };
  audio: { bytes: number; files: number };
  historyBytes: number;
  totalBytes: number;
  freeDisk: number | null;
}

export interface AppInfo {
  version: string;
  name: string;
  electron: string;
  chrome: string;
  node: string;
  v8: string;
  platform: string;
  arch: string;
  isDev: boolean;
  paths: { data: string; models: string; voices: string; audio: string };
  serverUrl: string | null;
  model: {
    id: string;
    name: string;
    repo: string;
    revision: string | null;
    runtime: RuntimeKind;
    license: string;
    voicesRepo: string;
    voicesRevision: string;
    files: Record<string, { size: number; required: boolean; quality?: Quality }>;
  };
}

export interface DownloadProgress {
  kind: 'model' | 'voice';
  file: string;
  loaded: number;
  total: number;
  percent: number | null;
  cached?: boolean;
  index?: number;
  count?: number;
  voiceId?: string;
  completed?: boolean;
  started?: boolean;
  done?: boolean;
  quality?: Quality;
  at?: number;
}

export interface EngineInfo {
  modelId?: string;
  sampleRate: number;
  device: 'cpu' | 'webgpu';
  deviceReason: string;
  threads: number;
  threadsReason: string;
  features: Record<string, boolean>;
  languages: string[];
  crossOriginIsolated: boolean;
  loadMs: number;
}

export interface PreviewResult {
  pcm: Float32Array;
  stats: SpeechStats | null;
}

export interface StudioApi {
  info: () => Promise<AppInfo>;
  keepAwake: (on: boolean) => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
  restart: () => Promise<boolean>;
  gpu: {
    info: () => Promise<GpuInfoResult>;
    openSettings: () => Promise<boolean>;
  };
  settings: {
    get: () => Promise<Settings>;
    save: (patch: Partial<Settings>) => Promise<Settings>;
  };
  model: {
    status: () => Promise<ModelStatus>;
    download: (options: { quality: Quality }) => Promise<{ ok: boolean; status?: ModelStatus; error?: string }>;
    cancel: () => Promise<boolean>;
    clear: (options: { what: 'model' | 'all' }) => Promise<ModelStatus>;
    verify: () => Promise<ModelStatus & { mismatched: string[] }>;
    importFolder: () => Promise<{ ok: boolean; cancelled?: boolean; error?: string; found?: string[]; status?: ModelStatus }>;
  };
  models: {
    snapshot: (options?: { forceHardware?: boolean }) => Promise<ModelsSnapshot>;
    hardware: () => Promise<HardwareProfile>;
    download: (options: { id: string; quality: Quality }) => Promise<{ ok: boolean; status?: ModelInstallState; error?: string; code?: string }>;
    cancel: () => Promise<boolean>;
    verify: (id: string) => Promise<{ status: ModelInstallState; mismatched: string[] }>;
    verifySynthesis: (id: string) => Promise<SynthesisCheck & { modelId?: string; unsupported?: boolean }>;
    uninstall: (id: string) => Promise<{ ok: boolean; status: ModelInstallState }>;
    activate: (id: string) => Promise<{ ok: boolean; error?: string; snapshot?: ModelsSnapshot }>;
    acknowledge: (id: string) => Promise<{ ok: boolean; license: ModelLicense; acknowledgedAt: number }>;
    importFolder: (id: string) => Promise<{
      ok: boolean;
      cancelled?: boolean;
      error?: string;
      found?: string[];
      status?: ModelInstallState;
    }>;
    openFolder: (id: string, target?: 'model' | 'staging') => Promise<boolean>;
    openReferences: () => Promise<boolean>;
    sidecar: {
      start: (id: string, device?: 'cpu' | 'auto') => Promise<{ ok: boolean; status?: SidecarStatus; error?: string }>;
      stop: (id: string) => Promise<{ ok: boolean }>;
      status: (id: string) => Promise<SidecarStatus>;
      logs: (id: string) => Promise<SidecarLogEvent[]>;
    };
  };

  runtimes: {
    download: (id: string) => Promise<{ ok: boolean; status?: RuntimePackState; error?: string }>;
    cancel: () => Promise<boolean>;
    verify: (id: string) => Promise<{ ok: boolean; status?: RuntimePackState; error?: string }>;
    uninstall: (id: string) => Promise<{ ok: boolean; status?: RuntimePackState; error?: string }>;
    importFolder: (id: string) => Promise<{ ok: boolean; cancelled?: boolean; status?: RuntimePackState; error?: string }>;
    openFolder: (id: string) => Promise<boolean>;
  };
  voices: {
    download: (id: string) => Promise<{ ok: boolean; error?: string }>;
    downloadAll: (ids: string[]) => Promise<{ ok: boolean; downloaded?: number; error?: string }>;
    cancel: () => Promise<boolean>;
    clear: () => Promise<ModelStatus>;
    listCustom: () => Promise<CustomVoiceRecord[]>;
    importCustom: () => Promise<{
      ok: boolean;
      cancelled?: boolean;
      duplicate?: boolean;
      error?: string;
      voice?: CustomVoiceRecord;
    }>;
    renameCustom: (id: string, name: string) => Promise<{ ok: boolean; error?: string; voice?: CustomVoiceRecord | null }>;
    deleteCustom: (id: string) => Promise<{ ok: boolean; voices: CustomVoiceRecord[] }>;
  };
  api: {
    status: () => Promise<ApiStatus | null>;
    regenerateToken: () => Promise<ApiStatus | null>;
    activity: () => Promise<ApiActivity[]>;
    test: (payload: { text: string; voice?: string; instruction?: string }) => Promise<ApiTestResult>;
    onActivity: (callback: (entry: ApiActivity) => void) => () => void;
    onChanged: (callback: (status: ApiStatus | null) => void) => () => void;
  };
  engineBridge: {
    ready: () => void;
    respond: (message: { id: string; ok: boolean; result?: unknown; error?: string; status?: number }) => void;
    onRequest: (callback: (request: EngineBridgeRequest) => void) => () => void;
  };
  huggingface: {
    tokenStatus: () => Promise<{ hasToken: boolean; encrypted: boolean }>;
    setToken: (token: string) => Promise<{ ok: boolean; hasToken: boolean; encrypted: boolean; user?: string | null; error?: string }>;
  };
  history: {
    list: () => Promise<HistoryEntry[]>;
    upsert: (entry: HistoryEntry) => Promise<HistoryEntry>;
    patch: (id: string, patch: Partial<HistoryEntry>) => Promise<HistoryEntry | null>;
    remove: (id: string, deleteFile?: boolean) => Promise<boolean>;
    clear: (deleteFiles?: boolean) => Promise<boolean>;
  };
  audio: {
    save: (payload: { pcm: Float32Array; sampleRate: number; baseName: string }) => Promise<{
      filePath: string;
      fileName: string;
      bytes: number;
      duration: number;
      sampleRate: number;
    }>;
    read: (filePath: string) => Promise<ArrayBuffer>;
    exists: (filePath: string) => Promise<boolean>;
    export: (payload: {
      sourcePath?: string;
      bytes?: ArrayBuffer | Uint8Array;
      format?: 'wav' | 'mp3';
      defaultName?: string;
    }) => Promise<{ ok: boolean; cancelled?: boolean; filePath?: string }>;
    exportMany: (files: { path: string; name: string }[]) => Promise<{ ok: boolean; directory?: string; count?: number; cancelled?: boolean }>;
    reveal: (filePath: string) => Promise<boolean>;
    open: (filePath: string) => Promise<boolean>;
  };
  paths: {
    reveal: (target: 'data' | 'models' | 'voices' | 'audio' | 'output') => Promise<boolean>;
    chooseOutputDir: () => Promise<string>;
  };
  storage: {
    stats: () => Promise<StorageStats>;
  };
  ui: {
    confirm: (options: {
      title?: string;
      message?: string;
      detail?: string;
      confirmLabel?: string;
      danger?: boolean;
    }) => Promise<boolean>;
    openTextFile: () => Promise<{ ok: boolean; cancelled?: boolean; name?: string; content?: string }>;
    saveText: (payload: { content: string; defaultName: string }) => Promise<{ ok: boolean; cancelled?: boolean; filePath?: string }>;
    copy: (text: string) => Promise<boolean>;
  };
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
  onModelsProgress: (callback: (progress: ModelsProgressEvent) => void) => () => void;
  onModelsChanged: (callback: () => void) => () => void;
  onSidecarLog: (callback: (event: SidecarLogEvent) => void) => () => void;
  onSidecarStatus: (callback: (status: SidecarStatus) => void) => () => void;
  onMenuAction: (callback: (action: { action: string; page?: Page }) => void) => () => void;
}
