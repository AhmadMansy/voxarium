export type Page = 'studio' | 'voices' | 'history' | 'batch' | 'settings';

export type Theme = 'dark' | 'light';
export type Accent = 'violet' | 'cyan' | 'amber' | 'rose';
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
export type Language = 'en' | 'none';
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
  /** Catalog voices come from Gradium; custom ones are cloned or imported locally. */
  source?: 'catalog' | 'custom';
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
}

export interface CloneProgress {
  stage: 'upload' | 'wait' | 'download' | 'done';
  message: string;
  voiceId?: string;
}

export interface CloneKeyStatus {
  hasKey: boolean;
  encrypted: boolean;
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
  /** Cloud cloning sends a short recording to Gradium once; off means import-only. */
  allowCloudCloning: boolean;
  /** Adapter preference for multi-GPU machines. High-performance needs a restart. */
  gpuPreference: GpuPreference;
  defaultVoice: string;
  lastVoice: string;
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
  quality: Quality;
  device: Device;
  temperature: number;
  seed: string;
  rewrites: Rewrites;
  language: Language;
  conditions: Conditions;
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
  exists: boolean;
  bytes: number;
  path: string;
}

export interface ModelStatus {
  installed: boolean;
  baseReady: boolean;
  q8Ready: boolean;
  f32Ready: boolean;
  files: Record<string, ModelFileStatus>;
  voicesDownloaded: number;
  voiceIds: string[];
  dirs: { data: string; models: string; voices: string; audio: string };
}

export interface StorageStats {
  models: { bytes: number; files: number };
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
    repo: string;
    revision: string;
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
  clone: {
    keyStatus: () => Promise<CloneKeyStatus>;
    setKey: (key: string) => Promise<CloneKeyStatus & { ok: boolean; error?: string }>;
    create: (payload: {
      audio: ArrayBuffer;
      name: string;
      language: string;
      startS?: number;
    }) => Promise<{ ok: boolean; code?: string; error?: string; voice?: CustomVoiceRecord }>;
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
  onCloneProgress: (callback: (progress: CloneProgress) => void) => () => void;
  onMenuAction: (callback: (action: { action: string; page?: Page }) => void) => () => void;
}
