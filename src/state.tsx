import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AppInfo,
  CloneKeyStatus,
  CustomVoiceRecord,
  DownloadProgress,
  EngineBridgeRequest,
  EngineInfo,
  HistoryEntry,
  ModelStatus,
  Page,
  Quality,
  Settings,
  SpeechStats,
  StorageStats,
  VoiceInfo,
} from './types';
import { VOICES, customVoiceToInfo, getModelVoices, getVoice, setCustomVoices as setCustomVoiceRegistry, setModelVoices } from './data/catalog';
import { computePeaks, encodeMp3, encodeWavBuffer } from './lib/audio';
import { BridgeError, describeModel, describeVoice, isReferenceVoice, resolveModel, resolveVoice, waitFor } from './lib/engineBridge';
import {
  loadEngine,
  previewLine,
  releaseEngine,
  runtimeGateError,
  synthesize as runSynthesis,
  tryAddVoice,
  type LoadedEngine,
  type SynthesizeResult,
} from './lib/engine';
import { buildBaseName, titleFromText } from './lib/utils';
import { MODELS, getModel, installState } from './models/registry';
import { currentPreferences, rememberPreferences, switchModelSettings } from './models/preferences';
import { capabilityReason, supportsLanguage, voiceCompatibleWithModel } from './models/compat';
import { licenseAcknowledged } from './models/license';
import { resolveExpression } from './models/expression';
import { runtimeReadiness, type RuntimeReadiness } from './models/runtime';
import type {
  LicenseAck,
  ModelDownloadEvent,
  ModelInstallState,
  ModelManifest,
  ModelsSnapshot,
  RuntimeDownloadEvent,
  RuntimePackState,
  SidecarLogEvent,
  SidecarStatus,
} from './models/types';
import type { HardwareProfile } from './models/fit';

export interface ToastMessage {
  id: string;
  message: string;
  detail?: string;
  kind: 'info' | 'success' | 'error';
}

type EngineStatus = 'idle' | 'needs-setup' | 'loading' | 'ready' | 'error';

interface ModelManager {
  snapshot: ModelsSnapshot | null;
  activeModel: ModelManifest;
  install: ModelInstallState;
  acks: Record<string, LicenseAck>;
  hardware: HardwareProfile;
  busyId: string | null;
  progress: Record<string, ModelDownloadEvent>;
  sidecars: Record<string, SidecarStatus>;
  sidecarLogs: Record<string, SidecarLogEvent[]>;
  runtimes: Record<string, RuntimePackState>;
  runtimeProgress: Record<string, RuntimeDownloadEvent>;
  runtimeBusyId: string | null;
  refresh: (options?: { forceHardware?: boolean }) => Promise<ModelsSnapshot | null>;
  statusFor: (id: string) => ModelInstallState;
  runtimeFor: (id: string) => RuntimeReadiness;
  download: (id: string, quality?: Quality) => Promise<boolean>;
  cancel: () => Promise<void>;
  verify: (id: string) => Promise<{ mismatched: string[] } | null>;
  uninstall: (id: string) => Promise<boolean>;
  activate: (id: string) => Promise<boolean>;
  acknowledge: (id: string) => Promise<boolean>;
  importFolder: (id: string) => Promise<boolean>;
  openFolder: (id: string, target?: 'model' | 'staging') => Promise<void>;
  startSidecar: (id: string) => Promise<boolean>;
  stopSidecar: (id: string) => Promise<void>;
  loadSidecarLogs: (id: string) => Promise<SidecarLogEvent[]>;
  downloadRuntime: (id: string) => Promise<boolean>;
  cancelRuntime: () => Promise<void>;
  verifyRuntime: (id: string) => Promise<boolean>;
  uninstallRuntime: (id: string) => Promise<boolean>;
  importRuntime: (id: string) => Promise<boolean>;
  openRuntimeFolder: (id: string) => Promise<void>;
  /** Hugging Face token status, needed only for gated repositories. */
  hfToken: { hasToken: boolean; encrypted: boolean } | null;
  saveHfToken: (token: string) => Promise<boolean>;
}

interface StudioContextValue {
  booted: boolean;
  bootError: string | null;
  info: AppInfo | null;
  settings: Settings | null;
  updateSettings: (patch: Partial<Settings>) => void;
  model: ModelStatus | null;
  refreshModel: () => Promise<ModelStatus | null>;
  storage: StorageStats | null;
  refreshStorage: () => Promise<void>;
  history: HistoryEntry[];
  refreshHistory: () => Promise<void>;
  customVoices: VoiceInfo[];
  refreshCustomVoices: () => Promise<VoiceInfo[]>;
  importVoiceFile: () => Promise<VoiceInfo | null>;
  renameCustomVoice: (id: string, name: string) => Promise<boolean>;
  deleteCustomVoice: (id: string) => Promise<boolean>;
  cloneVoice: (options: {
    audio: ArrayBuffer;
    name: string;
    language: string;
    consentAt?: number;
  }) => Promise<VoiceInfo | null>;
  cloneKey: CloneKeyStatus | null;
  saveCloneKey: (key: string) => Promise<boolean>;
  cloneTab: 'record' | 'import' | null;
  openClone: (tab?: 'record' | 'import') => void;
  closeClone: () => void;
  page: Page;
  setPage: (page: Page) => void;
  studioText: string;
  setStudioText: (text: string) => void;
  importText: () => Promise<void>;
  toasts: ToastMessage[];
  toast: (message: string, kind?: ToastMessage['kind'], detail?: string) => void;
  dismissToast: (id: string) => void;
  models: ModelManager;
  engine: {
    status: EngineStatus;
    info: EngineInfo | null;
    error: string | null;
    stage: string;
    runtimeDirty: boolean;
    busy: boolean;
    /** Voices reported by the loaded sidecar model (empty for Phonon). */
    voices: VoiceInfo[];
    reload: () => Promise<void>;
    ensureVoice: (voiceId: string) => Promise<void>;
    synthesize: (options: {
      text: string;
      voiceId: string;
      temperature?: number;
      seed?: string;
      signal?: AbortSignal;
      onChunk?: (pcm: Float32Array, totalSamples: number) => void;
      keepPartial?: boolean;
      /** Per-request overrides (API); otherwise the Studio settings apply. */
      language?: string;
      variety?: string;
      speed?: number;
      instruction?: string;
      intensity?: number;
    }) => Promise<SynthesizeResult>;
    preview: (voiceId: string, sample?: string) => Promise<SynthesizeResult>;
  };
  downloads: Record<string, DownloadProgress>;
  downloadModelBusy: boolean;
  voiceDownloadBusy: boolean;
  downloadModel: (quality: Quality) => Promise<boolean>;
  downloadVoice: (voiceId: string) => Promise<boolean>;
  downloadAllVoices: (voiceIds: string[]) => Promise<boolean>;
  cancelDownloads: () => Promise<void>;
  saveGeneration: (options: {
    pcm: Float32Array;
    text: string;
    voiceId: string;
    stats: SpeechStats | null;
    source?: 'studio' | 'api';
  }) => Promise<HistoryEntry | null>;
  deleteHistory: (id: string, options?: { confirm?: boolean; deleteFile?: boolean }) => Promise<boolean>;
  patchHistory: (id: string, patch: Partial<HistoryEntry>) => Promise<void>;
  clearHistory: () => Promise<void>;
  reuseHistory: (entry: HistoryEntry) => Promise<void>;
}

const StudioContext = createContext<StudioContextValue | null>(null);

const runtimeKey = (settings: Settings, modelId: string) =>
  JSON.stringify({
    modelId,
    quality: settings.quality,
    device: settings.device,
    gpuPreference: settings.gpuPreference,
    threads: settings.threads,
    language: settings.language,
    rewrites: settings.rewrites,
    conditions: settings.conditions,
    arabicVariety: settings.arabicVariety,
  });

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && /abort|cancel/i.test(error.message))
  );
}

/** Settings actually handed to the runtime: model preferences plus install fallbacks. */
function effectiveSettingsFor(
  model: ModelManifest,
  install: ModelInstallState,
  settings: Settings,
): Settings {
  const preferences = currentPreferences(settings, model);
  const copy: Settings = {
    ...settings,
    ...preferences,
    conditions: { ...preferences.conditions },
    activeModelId: model.id,
  };
  if (install.qualities.length && !install.qualities.includes(copy.quality)) {
    copy.quality = install.qualities[0];
  }
  return copy;
}

function emptyHardware(): HardwareProfile {
  return {
    platform: 'unknown',
    arch: 'unknown',
    cpuModel: '',
    cpuCores: 0,
    totalRamGb: 0,
    freeRamGb: 0,
    freeDiskGb: null,
    gpus: [],
    gpuPreference: 'auto',
    webgpuLikely: false,
  };
}

/**
 * Older takes predate the multi-model metadata. They belong to the original
 * Phonon 31M checkpoint, so fill the required fields instead of dropping them.
 */
function normalizeHistory(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.map((entry) => {
    const meta = (entry.meta || {}) as Partial<HistoryEntry['meta']>;
    const model = getModel(meta.modelId);
    return {
      ...entry,
      meta: {
        modelId: model.id,
        modelName: meta.modelName || model.name,
        runtime: meta.runtime || model.runtime,
        license: meta.license || model.license.id,
        rating: meta.rating || model.rating,
        capabilities: meta.capabilities || model.capabilities,
        quality: meta.quality || 'q8',
        device: meta.device || 'auto',
        temperature: meta.temperature ?? 0.3,
        seed: meta.seed || '4242424242424242',
        rewrites: meta.rewrites || 'default',
        language: meta.language || 'en',
        arabicVariety: meta.arabicVariety,
        conditions: meta.conditions || { num_speakers: '1', duration_delta: 0 },
      },
    };
  });
}

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [customVoices, setCustomVoicesState] = useState<VoiceInfo[]>([]);
  const [cloneKey, setCloneKey] = useState<CloneKeyStatus | null>(null);
  const [cloneTab, setCloneTab] = useState<'record' | 'import' | null>(null);
  const [page, setPage] = useState<Page>('studio');
  const [studioText, setStudioTextState] = useState(() => {
    try {
      return localStorage.getItem('phonon.studioText') || '';
    } catch {
      return '';
    }
  });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('idle');
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  // The latest load failure, readable inside async flows where state is stale.
  const engineErrorRef = useRef<string | null>(null);
  const [engineStage, setEngineStage] = useState('');
  const [loadedRuntime, setLoadedRuntime] = useState<string | null>(null);
  const [activeRequests, setActiveRequests] = useState(0);
  const [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({});
  const [downloadModelBusy, setDownloadModelBusy] = useState(false);
  const [voiceDownloadBusy, setVoiceDownloadBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<ModelsSnapshot | null>(null);
  const [modelBusyId, setModelBusyId] = useState<string | null>(null);
  const [modelProgress, setModelProgress] = useState<Record<string, ModelDownloadEvent>>({});
  const [sidecars, setSidecars] = useState<Record<string, SidecarStatus>>({});
  const [sidecarLogs, setSidecarLogs] = useState<Record<string, SidecarLogEvent[]>>({});
  const [runtimeProgress, setRuntimeProgress] = useState<Record<string, RuntimeDownloadEvent>>({});
  const [runtimeBusyId, setRuntimeBusyId] = useState<string | null>(null);

  const settingsRef = useRef<Settings | null>(null);
  const modelRef = useRef<ModelStatus | null>(null);
  const infoRef = useRef<AppInfo | null>(null);
  const engineRef = useRef<LoadedEngine | null>(null);
  const addedVoicesRef = useRef<Map<string, Promise<void>>>(new Map());
  const voiceQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const activeModel = useMemo(
    () => getModel(snapshot?.activeModelId || settings?.activeModelId),
    [snapshot?.activeModelId, settings?.activeModelId],
  );
  const activeInstall = useMemo(
    () => snapshot?.models.find((entry) => entry.id === activeModel.id) || installState(activeModel),
    [snapshot?.models, activeModel],
  );
  const acks = useMemo(() => snapshot?.licenses || {}, [snapshot?.licenses]);
  const hardware = snapshot?.hardware || emptyHardware();
  const runtimes = useMemo(
    () => Object.fromEntries((snapshot?.runtimes || []).map((pack) => [pack.id, pack])),
    [snapshot?.runtimes],
  );
  const runtimeFor = useCallback(
    (id: string) => runtimeReadiness(getModel(id), runtimes),
    [runtimes],
  );

  const activeModelRef = useRef<ModelManifest>(activeModel);
  const activeInstallRef = useRef<ModelInstallState>(activeInstall);
  const snapshotRef = useRef<ModelsSnapshot | null>(snapshot);

  settingsRef.current = settings;
  modelRef.current = model;
  infoRef.current = info;
  activeModelRef.current = activeModel;
  activeInstallRef.current = activeInstall;
  snapshotRef.current = snapshot;

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer) clearTimeout(timer);
    toastTimersRef.current.delete(id);
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastMessage['kind'] = 'info', detail?: string) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev.slice(-4), { id, message, detail, kind }]);
      const timer = setTimeout(() => dismissToast(id), kind === 'error' ? 7000 : 4200);
      toastTimersRef.current.set(id, timer);
    },
    [dismissToast],
  );

  const setStudioText = useCallback((text: string) => {
    setStudioTextState(text);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('phonon.studioText', studioText);
      } catch {}
    }, 350);
    return () => clearTimeout(timer);
  }, [studioText]);

  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.accent = settings.accent;
  }, [settings?.theme, settings?.accent]);

  const refreshModel = useCallback(async () => {
    const status = await window.studio.model.status();
    setModel(status);
    return status;
  }, []);

  const refreshStorage = useCallback(async () => {
    try {
      setStorage(await window.studio.storage.stats());
    } catch {}
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const entries = normalizeHistory(await window.studio.history.list());
      entries.sort((a, b) => b.createdAt - a.createdAt);
      setHistory(entries);
    } catch {}
  }, []);

  const refreshModels = useCallback(async (options?: { forceHardware?: boolean }) => {
    try {
      const next = await window.studio.models.snapshot(options);
      setSnapshot(next);
      setSidecars(Object.fromEntries(next.sidecars.map((status) => [status.modelId, status])));
      return next;
    } catch (error) {
      console.warn('[voxarium] could not read the model registry', error);
      return null;
    }
  }, []);

  const applyCustomVoices = useCallback((list: VoiceInfo[]) => {
    setCustomVoiceRegistry(list);
    setCustomVoicesState(list);
  }, []);

  const refreshCustomVoices = useCallback(async () => {
    const records = await window.studio.voices.listCustom();
    const mapped = records.map(customVoiceToInfo);
    applyCustomVoices(mapped);
    return mapped;
  }, [applyCustomVoices]);

  const importVoiceFile = useCallback(async () => {
    try {
      const result = await window.studio.voices.importCustom();
      if (result.cancelled) return null;
      if (!result.ok || !result.voice) {
        toast('That voice file could not be imported.', 'error', result.error);
        return null;
      }
      await refreshCustomVoices();
      void refreshStorage();
      const voice = getVoice(result.voice.id);
      toast(
        result.duplicate ? `${voice.name} is already in your library.` : `${voice.name} was added to your voices.`,
        result.duplicate ? 'info' : 'success',
        result.duplicate ? 'Importing it again would create an identical copy.' : voice.description,
      );
      return voice;
    } catch (error) {
      toast('That voice file could not be imported.', 'error', errorMessage(error));
      return null;
    }
  }, [refreshCustomVoices, refreshStorage, toast]);

  const renameCustomVoice = useCallback(
    async (id: string, name: string) => {
      try {
        const result = await window.studio.voices.renameCustom(id, name);
        if (!result.ok) {
          toast('That voice could not be renamed.', 'error', result.error);
          return false;
        }
        await refreshCustomVoices();
        toast('Voice renamed.', 'success');
        return true;
      } catch (error) {
        toast('That voice could not be renamed.', 'error', errorMessage(error));
        return false;
      }
    },
    [refreshCustomVoices, toast],
  );

  const cloneVoice = useCallback(
    async (options: { audio: ArrayBuffer; name: string; language: string; consentAt?: number }) => {
      const payload = {
        ...options,
        language: options.language,
        consentAt: options.consentAt || Date.now(),
      };
      const result = await window.studio.clone.create(payload);
      if (!result.ok || !result.voice) {
        if (result.code !== 'no-key') {
          toast('The voice could not be cloned.', 'error', result.error);
        }
        throw new Error(result.error || 'The voice could not be cloned.');
      }
      await refreshCustomVoices();
      void refreshStorage();
      return getVoice(result.voice.id);
    },
    [refreshCustomVoices, refreshStorage, toast],
  );

  const saveCloneKey = useCallback(
    async (key: string) => {
      try {
        const result = await window.studio.clone.setKey(key);
        if (!result.ok) {
          toast('The API key could not be saved.', 'error', result.error);
          return false;
        }
        setCloneKey({ hasKey: result.hasKey, encrypted: result.encrypted });
        toast(result.hasKey ? 'Gradium API key saved on this device.' : 'Gradium API key removed.', 'success');
        return true;
      } catch (error) {
        toast('The API key could not be saved.', 'error', errorMessage(error));
        return false;
      }
    },
    [toast],
  );

  const openClone = useCallback(
    (tab: 'record' | 'import' = 'record') => {
      const manifest = activeModelRef.current;
      if (tab === 'record' && !manifest.capabilities.voiceClone) {
        toast(
          `${manifest.shortName} cannot clone voices.`,
          'info',
          capabilityReason(manifest, 'voiceClone'),
        );
        if (manifest.capabilities.voiceImport) setCloneTab('import');
        return;
      }
      if (tab === 'import' && !manifest.capabilities.voiceImport) {
        toast(
          `${manifest.shortName} cannot import Phonon voices.`,
          'info',
          capabilityReason(manifest, 'voiceImport'),
        );
        return;
      }
      if (tab === 'record' && settingsRef.current?.allowCloudCloning === false) {
        setCloneTab('import');
        return;
      }
      setCloneTab(tab);
    },
    [toast],
  );
  const closeClone = useCallback(() => setCloneTab(null), []);

  useEffect(() => {
    setCustomVoiceRegistry(customVoices);
  }, [customVoices]);

  useEffect(() => {
    if (!window.studio?.onCloneProgress) return;
    const unsubscribe = window.studio.onCloneProgress((progress) => {
      if (progress.stage === 'done') void refreshCustomVoices();
    });
    return unsubscribe;
  }, [refreshCustomVoices]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!window.studio) throw new Error('The desktop bridge is unavailable.');
        const [appInfo, appSettings, status, entries, storageStats, customRecords, cloneStatus, models] =
          await Promise.all([
            window.studio.info(),
            window.studio.settings.get(),
            window.studio.model.status(),
            window.studio.history.list(),
            window.studio.storage.stats(),
            window.studio.voices.listCustom(),
            window.studio.clone.keyStatus(),
            window.studio.models.snapshot(),
          ]);
        if (cancelled) return;
        setInfo(appInfo);
        const activeModelId = models?.activeModelId || appSettings.activeModelId;
        setSettings({ ...appSettings, activeModelId });
        setModel(status);
        setHistory(normalizeHistory(entries).sort((a, b) => b.createdAt - a.createdAt));
        setStorage(storageStats);
        const mappedCustom = customRecords.map(customVoiceToInfo);
        setCustomVoiceRegistry(mappedCustom);
        setCustomVoicesState(mappedCustom);
        setCloneKey(cloneStatus);
        if (models) {
          setSnapshot(models);
          setSidecars(Object.fromEntries(models.sidecars.map((item) => [item.modelId, item])));
        }
      } catch (error) {
        if (!cancelled) setBootError(errorMessage(error));
      } finally {
        if (!cancelled) setBooted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!window.studio?.onDownloadProgress) return;
    return window.studio.onDownloadProgress((progress) => {
      const key = `${progress.kind}:${progress.file}`;
      setDownloads((prev) => ({ ...prev, [key]: { ...prev[key], ...progress } }));
    });
  }, []);

  useEffect(() => {
    if (!window.studio?.onModelsProgress) return;
    return window.studio.onModelsProgress((progress) => {
      if (progress.kind === 'runtime') {
        setRuntimeProgress((prev) => {
          const previous = prev[progress.runtimeId];
          if (previous?.done && !progress.done) return prev;
          return { ...prev, [progress.runtimeId]: { ...previous, ...progress } };
        });
        return;
      }
      setModelProgress((prev) => {
        const previous = prev[progress.modelId];
        if (previous?.done && !progress.done) return prev;
        return { ...prev, [progress.modelId]: { ...previous, ...progress } };
      });
    });
  }, []);

  useEffect(() => {
    if (!window.studio?.onModelsChanged) return;
    return window.studio.onModelsChanged(() => {
      void refreshModels();
    });
  }, [refreshModels]);

  useEffect(() => {
    if (!window.studio?.onSidecarStatus) return;
    return window.studio.onSidecarStatus((status) => {
      setSidecars((prev) => ({ ...prev, [status.modelId]: status }));
    });
  }, []);

  useEffect(() => {
    if (!window.studio?.onSidecarLog) return;
    return window.studio.onSidecarLog((event) => {
      setSidecarLogs((prev) => {
        const existing = prev[event.modelId] || [];
        const next = [...existing, event].slice(-200);
        return { ...prev, [event.modelId]: next };
      });
    });
  }, []);

  useEffect(
    () => () => {
      for (const timer of toastTimersRef.current.values()) clearTimeout(timer);
      toastTimersRef.current.clear();
      releaseEngine(engineRef.current);
    },
    [],
  );

  const effectiveSettings = useCallback(
    (): Settings => {
      const current = settingsRef.current;
      if (!current) throw new Error('Settings are not loaded yet.');
      return effectiveSettingsFor(activeModelRef.current, activeInstallRef.current, current);
    },
    [],
  );

  /** Loads a specific model. The caller decides whether to commit the switch first. */
  const loadFor = useCallback(
    async (manifest: ModelManifest, install: ModelInstallState, base: Settings): Promise<boolean> => {
      engineErrorRef.current = null;
      const appInfo = infoRef.current;
      if (!appInfo?.serverUrl) {
        engineErrorRef.current = 'The local model server is unavailable. Try restarting Voxarium.';
        setEngineError(engineErrorRef.current);
        setEngineStatus('error');
        return false;
      }
      if (!install.installed) {
        setEngineStatus('needs-setup');
        setEngineError(null);
        return false;
      }
      const gate = runtimeGateError(manifest, runtimeFor(manifest.id).ready);
      if (gate) {
        engineErrorRef.current = gate;
        setEngineError(gate);
        setEngineStatus('error');
        setEngineStage('');
        return false;
      }

      releaseEngine(engineRef.current);
      engineRef.current = null;
      addedVoicesRef.current.clear();
      setEngineStatus('loading');
      setEngineError(null);
      setEngineInfo(null);
      setEngineStage(`Starting ${manifest.shortName}…`);
      try {
        const settingsToLoad = effectiveSettingsFor(manifest, install, base);
        const loaded = await loadEngine({
          settings: settingsToLoad,
          manifest,
          serverUrl: appInfo.serverUrl,
          onStage: (stage) => setEngineStage(stage),
        });
        engineRef.current = loaded;
        setEngineInfo(loaded.info);
        setLoadedRuntime(runtimeKey(settingsToLoad, manifest.id));
        setEngineStatus('ready');
        setEngineStage('');
        return true;
      } catch (error) {
        console.error('[voxarium] engine load failed', error);
        engineErrorRef.current = errorMessage(error);
        setEngineError(errorMessage(error));
        setEngineStatus('error');
        setEngineStage('');
        return false;
      }
    },
    [runtimeFor],
  );

  const load = useCallback(async (): Promise<boolean> => {
    const current = settingsRef.current;
    if (!current) return false;
    return loadFor(activeModelRef.current, activeInstallRef.current, current);
  }, [loadFor]);

  useEffect(() => {
    if (!booted || !settings || !snapshot) return;
    if (!activeInstall.installed) {
      if (engineStatus === 'idle' || engineStatus === 'ready') {
        releaseEngine(engineRef.current);
        engineRef.current = null;
        setEngineStatus('needs-setup');
      }
      return;
    }
    if (engineStatus === 'idle' || engineStatus === 'needs-setup') void load();
  }, [booted, settings?.setupComplete, snapshot, activeInstall.installed, engineStatus, load]);

  const reload = useCallback(async () => {
    if (activeRequests > 0) {
      toast('Wait for the current generation to finish before reloading.', 'info');
      return;
    }
    await load();
  }, [activeRequests, load, toast]);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      const base = settingsRef.current;
      const remembered = base ? rememberPreferences(base, activeModelRef.current, patch) : null;
      const saved = remembered ? { ...patch, ...remembered } : patch;
      setSettings((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch } as Settings;
        if (patch.conditions) next.conditions = { ...prev.conditions, ...patch.conditions };
        if (remembered?.modelSettings) next.modelSettings = remembered.modelSettings;
        return next;
      });
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        window.studio.settings.save(saved).catch((error) => {
          toast('Settings could not be saved.', 'error', errorMessage(error));
        });
      }, 280);
    },
    [toast],
  );

  // Sidecar models report their own voices once they load. Register them so the
  // pickers can resolve them, and move the selection onto this model's voices.
  const [modelVoicesVersion, setModelVoicesVersion] = useState(0);
  useEffect(() => {
    const engine = engineRef.current;
    if (engineStatus !== 'ready' || !engine?.voices) return;
    setModelVoices(engine.modelId, engine.voices);
    setModelVoicesVersion((version) => version + 1);
    const current = settingsRef.current?.lastVoice;
    if (engine.defaultVoiceId && !engine.voices.some((voice) => voice.id === current)) {
      updateSettings({ lastVoice: engine.defaultVoiceId });
    }
  }, [engineStatus, engineInfo, updateSettings]);

  const commitSettings = useCallback(async (next: Settings) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSettings(next);
    try {
      await window.studio.settings.save(next);
    } catch (error) {
      console.error('[voxarium] settings could not be saved after a model switch', error);
    }
  }, []);

  const deleteCustomVoice = useCallback(
    async (id: string) => {
      const voice = customVoices.find((item) => item.id === id);
      const confirmed = await window.studio.ui.confirm({
        title: 'Delete this voice?',
        message: `Remove “${voice?.name || 'this voice'}” from your library?`,
        detail: 'The voice file will be deleted from this device. Recordings already made with it are kept.',
        confirmLabel: 'Delete voice',
        danger: true,
      });
      if (!confirmed) return false;
      try {
        await window.studio.voices.deleteCustom(id);
        addedVoicesRef.current.delete(id);
        await refreshCustomVoices();
        void refreshStorage();
        const current = settingsRef.current;
        if (current && (current.lastVoice === id || current.defaultVoice === id)) {
          updateSettings({ lastVoice: 'default', defaultVoice: 'default' });
        }
        toast('Voice deleted.', 'success');
        return true;
      } catch (error) {
        toast('That voice could not be deleted.', 'error', errorMessage(error));
        return false;
      }
    },
    [customVoices, refreshCustomVoices, refreshStorage, toast, updateSettings],
  );

  const ensureVoice = useCallback(async (voiceId: string) => {
    const engine = engineRef.current;
    const appInfo = infoRef.current;
    if (!engine) throw new Error('The model is not ready yet.');
    if (engine.runtime === 'sidecar') return;
    if (!appInfo?.serverUrl) throw new Error('The local model server is unavailable.');
    const existing = addedVoicesRef.current.get(voiceId);
    if (existing) return existing;
    const task = voiceQueueRef.current.then(async () => {
      await tryAddVoice(engine.tts, voiceId, appInfo.serverUrl as string);
      await Promise.all([refreshModel(), refreshStorage()]);
    });
    voiceQueueRef.current = task.catch(() => {});
    addedVoicesRef.current.set(voiceId, task);
    try {
      await task;
    } catch (error) {
      addedVoicesRef.current.delete(voiceId);
      throw error;
    }
  }, [refreshModel, refreshStorage]);

  const synthesize = useCallback(
    async (options: {
      text: string;
      voiceId: string;
      temperature?: number;
      seed?: string;
      signal?: AbortSignal;
      onChunk?: (pcm: Float32Array, totalSamples: number) => void;
      keepPartial?: boolean;
      /** Per-request overrides (API); otherwise the Studio settings apply. */
      language?: string;
      variety?: string;
      speed?: number;
      instruction?: string;
      intensity?: number;
    }) => {
      const engine = engineRef.current;
      const manifest = activeModelRef.current;
      if (!engine) throw new Error('The model is not ready yet.');
      await ensureVoice(options.voiceId);
      setActiveRequests((count) => count + 1);
      try {
        // The Expression panel applies to every caller (Studio, Batch, API); an API
        // request can override it.
        const expression = resolveExpression(manifest, settingsRef.current?.expression?.[manifest.id], {
          instruction: options.instruction,
          intensity: options.intensity,
        });
        return await runSynthesis({
          tts: engine.tts,
          manifest,
          sidecar: engine.sidecar,
          language: settingsRef.current?.language,
          variety: settingsRef.current?.arabicVariety,
          ...options,
          ...expression,
        });
      } finally {
        setActiveRequests((count) => Math.max(0, count - 1));
      }
    },
    [ensureVoice],
  );

  const preview = useCallback(
    async (voiceId: string, sample?: string) => {
      return synthesize({
        text: previewLine(voiceId, sample),
        voiceId,
        temperature: 0.25,
        seed: '4242424242424242',
      });
    },
    [synthesize],
  );

  const downloadModel = useCallback(
    async (quality: Quality) => {
      setDownloadModelBusy(true);
      try {
        const result = await window.studio.model.download({ quality });
        if (!result.ok) {
          if (!/cancel/i.test(result.error || '')) {
            toast('Model download failed.', 'error', result.error);
          }
          return false;
        }
        if (result.status) setModel(result.status);
        else await refreshModel();
        updateSettings({ quality, setupComplete: true });
        await Promise.all([refreshStorage(), refreshModels()]);
        toast(`${activeModelRef.current.shortName} is ready on this device.`, 'success');
        return true;
      } catch (error) {
        if (!isAbort(error)) toast('Model download failed.', 'error', errorMessage(error));
        return false;
      } finally {
        setDownloadModelBusy(false);
      }
    },
    [refreshModel, refreshModels, refreshStorage, toast, updateSettings],
  );

  const downloadModelById = useCallback(
    async (id: string, quality?: Quality) => {
      setModelBusyId(id);
      setModelProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      try {
        const modelToInstall = getModel(id);
        // Sidecar models need their runtime first: uv, the interpreter and the
        // model's own environment. The main process installs whatever is missing.
        const runtime = runtimeFor(id);
        if (!runtime.ready && runtime.packId) {
          if (!runtime.available) {
            toast(`${modelToInstall.shortName} cannot be installed yet.`, 'info', runtime.reason || undefined);
            return false;
          }
          setRuntimeBusyId(runtime.packId);
          try {
            const built = await window.studio.runtimes.download(runtime.packId);
            if (!built.ok) {
              if (!/cancel/i.test(built.error || '')) {
                toast(`The ${modelToInstall.shortName} runtime could not be installed.`, 'error', built.error);
              }
              await refreshModels();
              return false;
            }
          } finally {
            setRuntimeBusyId(null);
          }
          await refreshModels();
        }
        const result = await window.studio.models.download({
          id,
          quality: quality || modelToInstall.defaults.quality,
        });
        if (!result.ok) {
          if (!/cancel/i.test(result.error || '')) {
            toast(`${modelToInstall.shortName} could not be installed.`, 'error', result.error);
          }
          return false;
        }
        await Promise.all([refreshModels(), refreshStorage()]);
        if (id === activeModelRef.current.id) {
          setModel(await refreshModel());
          updateSettings({ setupComplete: true, quality: quality || modelToInstall.defaults.quality });
        }
        toast(`${modelToInstall.shortName} is installed.`, 'success');
        return true;
      } catch (error) {
        if (!isAbort(error)) toast('Model download failed.', 'error', errorMessage(error));
        return false;
      } finally {
        setModelBusyId(null);
      }
    },
    [refreshModel, refreshModels, refreshStorage, runtimeFor, toast, updateSettings],
  );

  const verifyModel = useCallback(
    async (id: string) => {
      try {
        const result = await window.studio.models.verify(id);
        await refreshModels();
        if (result.mismatched.length) {
          toast('Some files did not match their pinned hash.', 'error', result.mismatched.join(', '));
        } else {
          toast('Every file is complete and verified.', 'success');
        }
        return { mismatched: result.mismatched };
      } catch (error) {
        toast('The files could not be verified.', 'error', errorMessage(error));
        return null;
      }
    },
    [refreshModels, toast],
  );

  const uninstallModel = useCallback(
    async (id: string) => {
      const manifest = getModel(id);
      const confirmed = await window.studio.ui.confirm({
        title: `Remove ${manifest.shortName}?`,
        message: `Delete the model files for ${manifest.shortName} from this device?`,
        detail: 'Your recordings, voices and settings are kept. You can download or import the model again later.',
        confirmLabel: 'Remove model',
        danger: true,
      });
      if (!confirmed) return false;
      setModelBusyId(id);
      try {
        if (id === activeModelRef.current.id) {
          releaseEngine(engineRef.current);
          engineRef.current = null;
          setEngineInfo(null);
          setEngineStatus('needs-setup');
          setEngineStage('');
        }
        await window.studio.models.uninstall(id);
        await Promise.all([refreshModels(), refreshStorage()]);
        if (id === activeModelRef.current.id) setModel(await refreshModel());
        toast(`${manifest.shortName} was removed.`, 'success');
        return true;
      } catch (error) {
        toast('The model could not be removed.', 'error', errorMessage(error));
        return false;
      } finally {
        setModelBusyId(null);
      }
    },
    [refreshModel, refreshModels, refreshStorage, toast],
  );

  const acknowledgeModel = useCallback(
    async (id: string) => {
      try {
        await window.studio.models.acknowledge(id);
        await refreshModels();
        return true;
      } catch (error) {
        toast('The license could not be recorded.', 'error', errorMessage(error));
        return false;
      }
    },
    [refreshModels, toast],
  );

  const importModelFolder = useCallback(
    async (id: string) => {
      try {
        const result = await window.studio.models.importFolder(id);
        if (result.cancelled) return false;
        if (!result.ok) {
          toast('Those model files could not be used.', 'error', result.error);
          return false;
        }
        await Promise.all([refreshModels(), refreshStorage()]);
        if (id === activeModelRef.current.id) {
          setModel(await refreshModel());
          updateSettings({ setupComplete: true });
        }
        toast('Model files imported.', 'success', result.found?.join(', '));
        return true;
      } catch (error) {
        toast('Those model files could not be used.', 'error', errorMessage(error));
        return false;
      }
    },
    [refreshModel, refreshModels, refreshStorage, toast, updateSettings],
  );

  const openModelFolder = useCallback(async (id: string, target: 'model' | 'staging' = 'model') => {
    await window.studio.models.openFolder(id, target);
  }, []);

  // Why the last switch failed, so API clients get the same reason as the toast.
  const activationErrorRef = useRef<string | null>(null);
  const activateModel = useCallback(
    async (id: string) => {
      activationErrorRef.current = null;
      const current = settingsRef.current;
      if (!current) return false;
      const previousModel = activeModelRef.current;
      if (id === previousModel.id) return true;
      if (activeRequests > 0) {
        activationErrorRef.current = 'The Studio is generating; try again when it finishes.';
        toast('Wait for the current generation to finish before switching models.', 'info');
        return false;
      }
      const nextModel = getModel(id);
      let nextInstall = snapshotRef.current?.models.find((entry) => entry.id === id) || installState(nextModel);
      if (!nextInstall.installed) {
        // A download or import may have finished after the last React render, so
        // ask the main process before refusing a model that is actually on disk.
        try {
          const live = await window.studio.models.snapshot();
          setSnapshot(live);
          nextInstall = live.models.find((entry) => entry.id === id) || nextInstall;
        } catch {}
      }
      if (!nextInstall.installed) {
        activationErrorRef.current = `${nextModel.shortName} is not installed yet.`;
        toast(`${nextModel.shortName} is not installed yet.`, 'info');
        return false;
      }
      const previousSettings = current;
      const previousInstall = activeInstallRef.current;
      const nextSettings = {
        ...current,
        ...switchModelSettings(current, previousModel, nextModel),
      } as Settings;

      setModelBusyId(id);
      const activated = await window.studio.models.activate(id);
      if (!activated.ok) {
        setModelBusyId(null);
        activationErrorRef.current = activated.error || `${nextModel.shortName} could not be activated.`;
        toast(`${nextModel.shortName} could not be activated.`, 'error', activated.error);
        return false;
      }

      const loaded = await loadFor(nextModel, nextInstall, nextSettings);
      if (!loaded) {
        activationErrorRef.current = engineErrorRef.current || `${nextModel.shortName} failed to load.`;
        // Put the previous model back in charge and restore its engine so a failed
        // swap never strands the user on a model that cannot run.
        await window.studio.models.activate(previousModel.id).catch(() => {});
        await refreshModels();
        setModel(await refreshModel());
        setModelBusyId(null);
        await loadFor(previousModel, previousInstall, previousSettings);
        toast(
          `${nextModel.shortName} could not start. ${previousModel.shortName} is still selected.`,
          'error',
          engineError || undefined,
        );
        return false;
      }

      await commitSettings(nextSettings);
      if (activated.snapshot) setSnapshot(activated.snapshot);
      else await refreshModels();
      setModel(await refreshModel());
      setModelBusyId(null);
      toast(`${nextModel.shortName} is ready.`, 'success');
      return true;
    },
    [activeRequests, commitSettings, engineError, loadFor, refreshModel, refreshModels, toast],
  );

  const startSidecar = useCallback(
    async (id: string) => {
      try {
        const result = await window.studio.models.sidecar.start(id);
        if (!result.ok) {
          toast('The sidecar could not start.', 'error', result.error);
          return false;
        }
        if (result.status) setSidecars((prev) => ({ ...prev, [id]: result.status as SidecarStatus }));
        return true;
      } catch (error) {
        toast('The sidecar could not start.', 'error', errorMessage(error));
        return false;
      }
    },
    [toast],
  );

  const stopSidecar = useCallback(async (id: string) => {
    await window.studio.models.sidecar.stop(id);
  }, []);

  const loadSidecarLogs = useCallback(async (id: string) => {
    const logs = await window.studio.models.sidecar.logs(id);
    setSidecarLogs((prev) => ({ ...prev, [id]: logs.slice(-200) }));
    return logs;
  }, []);

  const downloadRuntime = useCallback(
    async (id: string) => {
      const pack = snapshotRef.current?.runtimes.find((entry) => entry.id === id);
      const label = pack?.name || 'The runtime pack';
      setRuntimeBusyId(id);
      setRuntimeProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      try {
        const result = await window.studio.runtimes.download(id);
        if (!result.ok) {
          if (!/cancel/i.test(result.error || '')) {
            toast(`${label} could not be installed.`, 'error', result.error);
          }
          return false;
        }
        await Promise.all([refreshModels(), refreshStorage()]);
        toast(`${label} is installed.`, 'success');
        return true;
      } catch (error) {
        if (!isAbort(error)) toast(`${label} could not be installed.`, 'error', errorMessage(error));
        return false;
      } finally {
        setRuntimeBusyId(null);
      }
    },
    [refreshModels, refreshStorage, toast],
  );

  const cancelRuntime = useCallback(async () => {
    await window.studio.runtimes.cancel();
    toast('Runtime download cancelled.', 'info');
  }, [toast]);

  const verifyRuntime = useCallback(
    async (id: string) => {
      try {
        const result = await window.studio.runtimes.verify(id);
        await refreshModels();
        if (!result.ok) {
          toast('The runtime pack could not be verified.', 'error', result.error);
          return false;
        }
        toast('The runtime pack is complete and verified.', 'success');
        return true;
      } catch (error) {
        toast('The runtime pack could not be verified.', 'error', errorMessage(error));
        return false;
      }
    },
    [refreshModels, toast],
  );

  const uninstallRuntime = useCallback(
    async (id: string) => {
      const pack = snapshotRef.current?.runtimes.find((entry) => entry.id === id);
      const dependents = (snapshotRef.current?.runtimes || []).filter(
        (entry) => entry.installed && entry.id !== id && entry.requires.includes(id),
      );
      const confirmed = await window.studio.ui.confirm({
        title: `Remove ${pack?.name || 'runtime pack'}?`,
        message: `Delete this runtime pack from this device?`,
        detail: dependents.length
          ? `${dependents.map((entry) => entry.name).join(', ')} ${dependents.length === 1 ? 'needs' : 'need'} this pack and will stop working until it is reinstalled. Model weights, voices and recordings are kept.`
          : 'Model weights, voices and recordings are kept. Models that need this pack cannot run until it is installed again.',
        confirmLabel: 'Remove runtime',
        danger: true,
      });
      if (!confirmed) return false;
      try {
        const result = await window.studio.runtimes.uninstall(id);
        if (!result.ok) {
          toast('The runtime pack could not be removed.', 'error', result.error);
          return false;
        }
        await Promise.all([refreshModels(), refreshStorage()]);
        toast('Runtime pack removed.', 'success');
        return true;
      } catch (error) {
        toast('The runtime pack could not be removed.', 'error', errorMessage(error));
        return false;
      }
    },
    [refreshModels, refreshStorage, toast],
  );

  const importRuntime = useCallback(
    async (id: string) => {
      try {
        const result = await window.studio.runtimes.importFolder(id);
        if (result.cancelled) return false;
        if (!result.ok) {
          toast('That folder is not a usable runtime pack.', 'error', result.error);
          return false;
        }
        await Promise.all([refreshModels(), refreshStorage()]);
        toast('Runtime pack imported.', 'success');
        return true;
      } catch (error) {
        toast('That folder is not a usable runtime pack.', 'error', errorMessage(error));
        return false;
      }
    },
    [refreshModels, refreshStorage, toast],
  );

  const openRuntimeFolder = useCallback(async (id: string) => {
    await window.studio.runtimes.openFolder(id);
  }, []);

  const cancelModelDownload = useCallback(async () => {
    await window.studio.models.cancel();
    toast('Download cancelled.', 'info');
  }, [toast]);

  const statusFor = useCallback(
    (id: string) => {
      const manifest = getModel(id);
      return snapshotRef.current?.models.find((entry) => entry.id === manifest.id) || installState(manifest);
    },
    [],
  );

  const downloadVoice = useCallback(
    async (voiceId: string) => {
      setVoiceDownloadBusy(true);
      try {
        const result = await window.studio.voices.download(voiceId);
        if (!result.ok) {
          if (!/another|running|abort|cancel/i.test(result.error || '')) {
            toast('Voice download failed.', 'error', result.error);
          }
          return false;
        }
        await refreshModel();
        await refreshStorage();
        return true;
      } catch (error) {
        if (!isAbort(error)) toast('Voice download failed.', 'error', errorMessage(error));
        return false;
      } finally {
        setVoiceDownloadBusy(false);
      }
    },
    [refreshModel, refreshStorage, toast],
  );

  const downloadAllVoices = useCallback(
    async (voiceIds: string[]) => {
      if (!voiceIds.length) return false;
      setVoiceDownloadBusy(true);
      try {
        const result = await window.studio.voices.downloadAll(voiceIds);
        if (!result.ok) {
          if (!/another|running|abort|cancel/i.test(result.error || '')) {
            toast('Voice download failed.', 'error', result.error);
          }
          return false;
        }
        await refreshModel();
        await refreshStorage();
        toast(`Downloaded ${result.downloaded ?? voiceIds.length} voices.`, 'success');
        return true;
      } catch (error) {
        if (!isAbort(error)) toast('Voice download failed.', 'error', errorMessage(error));
        return false;
      } finally {
        setVoiceDownloadBusy(false);
      }
    },
    [refreshModel, refreshStorage, toast],
  );

  const cancelDownloads = useCallback(async () => {
    await Promise.all([window.studio.model.cancel(), window.studio.voices.cancel()]);
    toast('Download cancelled.', 'info');
  }, [toast]);

  const saveGeneration = useCallback(
    async (options: { pcm: Float32Array; text: string; voiceId: string; stats: SpeechStats | null; source?: 'studio' | 'api' }) => {
      const current = settingsRef.current;
      if (!current) return null;
      const manifest = activeModelRef.current;
      const preferences = effectiveSettingsFor(manifest, activeInstallRef.current, current);
      const voice = getVoice(options.voiceId);
      const baseName = buildBaseName(current.filenameTemplate, {
        voice: voice.name,
        text: options.text,
      });
      try {
        const saved = await window.studio.audio.save({
          pcm: options.pcm,
          sampleRate: 24000,
          baseName,
        });
        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          title: titleFromText(options.text),
          text: options.text,
          voiceId: voice.id,
          voiceName: voice.name,
          createdAt: Date.now(),
          filePath: saved.filePath,
          fileName: saved.fileName,
          bytes: saved.bytes,
          duration: saved.duration,
          sampleRate: saved.sampleRate,
          peaks: computePeaks(options.pcm, 96),
          favorite: false,
          meta: {
            modelId: manifest.id,
            modelName: manifest.name,
            runtime: manifest.runtime,
            license: manifest.license.id,
            rating: manifest.rating,
            capabilities: { ...manifest.capabilities },
            quality: preferences.quality,
            device: preferences.device,
            temperature: preferences.temperature,
            seed: preferences.seed,
            rewrites: preferences.rewrites,
            language: preferences.language,
            arabicVariety: preferences.arabicVariety,
            conditions: { ...preferences.conditions },
            source: options.source || 'studio',
          },
          stats: options.stats,
        };
        const stored = await window.studio.history.upsert(entry);
        setHistory((prev) => [stored, ...prev.filter((item) => item.id !== stored.id)]);
        void refreshStorage();
        return stored;
      } catch (error) {
        toast('The audio could not be saved.', 'error', errorMessage(error));
        return null;
      }
    },
    [refreshStorage, toast],
  );

  const patchHistory = useCallback(
    async (id: string, patch: Partial<HistoryEntry>) => {
      const updated = await window.studio.history.patch(id, patch);
      if (updated) {
        setHistory((prev) => prev.map((item) => (item.id === id ? updated : item)));
      }
    },
    [],
  );

  const deleteHistory = useCallback(
    async (id: string, options: { confirm?: boolean; deleteFile?: boolean } = {}) => {
      const entry = history.find((item) => item.id === id);
      if (options.confirm !== false) {
        const confirmed = await window.studio.ui.confirm({
          title: 'Delete recording?',
          message: `Delete “${entry?.title || 'this recording'}” from history?`,
          detail:
            options.deleteFile === false
              ? 'The history entry will be removed, but the WAV file stays on disk.'
              : 'The WAV file will also be deleted from your audio folder.',
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!confirmed) return false;
      }
      await window.studio.history.remove(id, options.deleteFile !== false);
      setHistory((prev) => prev.filter((item) => item.id !== id));
      void refreshStorage();
      return true;
    },
    [history, refreshStorage],
  );

  const clearHistory = useCallback(async () => {
    if (!history.length) return;
    const confirmed = await window.studio.ui.confirm({
      title: 'Clear all history?',
      message: `Delete ${history.length} recording${history.length === 1 ? '' : 's'} and their WAV files?`,
      detail: 'This cannot be undone. The voice model and settings are not affected.',
      confirmLabel: 'Clear history',
      danger: true,
    });
    if (!confirmed) return;
    await window.studio.history.clear(true);
    setHistory([]);
    void refreshStorage();
    toast('History cleared.', 'success');
  }, [history.length, refreshStorage, toast]);

  const reuseHistory = useCallback(
    async (entry: HistoryEntry) => {
      const target = getModel(entry.meta?.modelId);
      const installed = statusFor(target.id).installed;
      if (target.id !== activeModelRef.current.id) {
        if (!installed) {
          toast(
            `${target.shortName} is not installed.`,
            'info',
            'The script and voice were loaded, but install the model before generating again.',
          );
        } else {
          const switched = await activateModel(target.id);
          if (!switched) return;
        }
      }
      setStudioText(entry.text);
      const current = settingsRef.current;
      const patch: Partial<Settings> = {
        lastVoice: entry.voiceId,
        defaultVoice: entry.voiceId,
        language: entry.meta?.language || 'en',
        temperature: entry.meta?.temperature ?? current?.temperature ?? 0.3,
        seed: entry.meta?.seed || current?.seed || '4242424242424242',
      };
      if (entry.meta?.arabicVariety) patch.arabicVariety = entry.meta.arabicVariety;
      updateSettings(patch);
      setPage('studio');
      toast('Loaded into the studio.', 'success', `${target.shortName} · ${entry.voiceName}`);
    },
    [activateModel, setStudioText, statusFor, toast, updateSettings],
  );

  const importText = useCallback(async () => {
    try {
      const result = await window.studio.ui.openTextFile();
      if (!result.ok || !result.content) return;
      setStudioText(result.content);
      setPage('studio');
      toast(`Imported ${result.name || 'text file'}.`, 'success');
    } catch (error) {
      toast('The text file could not be opened.', 'error', errorMessage(error));
    }
  }, [setStudioText, toast]);

  useEffect(() => {
    if (!window.studio?.onMenuAction) return;
    return window.studio.onMenuAction((action) => {
      if (action.action === 'go' && action.page) setPage(action.page);
      if (action.action === 'new-script') {
        setStudioText('');
        setPage('studio');
      }
      if (action.action === 'import-text') void importText();
      if (action.action === 'import-voice') void importVoiceFile();
      if (action.action === 'clone-voice') openClone('record');
    });
  }, [importText, importVoiceFile, openClone, setStudioText]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      console.error(event.error || event.message);
    };
    window.addEventListener('error', onError);
    return () => window.removeEventListener('error', onError);
  }, []);

  const runtimeDirty =
    engineStatus === 'ready' && settings != null && loadedRuntime != null
      ? loadedRuntime !== runtimeKey(effectiveSettingsFor(activeModel, activeInstall, settings), activeModel.id)
      : false;

  // ---------------------------------------------------------------------------
  // Engine bridge: requests from the local API, CLI and MCP clients run on this
  // same engine (same active model, voices and History) as the Studio.
  // ---------------------------------------------------------------------------
  const bridgeState = useRef({ booted, engineStatus, engineError, activeRequests, customVoices });
  bridgeState.current = { booted, engineStatus, engineError, activeRequests, customVoices };

  /** Voices a model can use right now, with its default. */
  const bridgeVoices = (model: ModelManifest): { voices: VoiceInfo[]; defaultId?: string; note?: string } => {
    const live = bridgeState.current;
    if (model.voices.format === 'phonon-safetensors') {
      const voices = [...live.customVoices, ...VOICES].filter((voice) => voiceCompatibleWithModel(model, voice));
      return { voices, defaultId: 'default' };
    }
    const engine = engineRef.current;
    if (engine?.modelId === model.id && engine.voices) return { voices: engine.voices, defaultId: engine.defaultVoiceId };
    const known = getModelVoices(model.id);
    return known.length
      ? { voices: known, defaultId: known.find((voice) => voice.isDefault)?.id }
      : { voices: [], note: `${model.shortName} lists its voices once it is active. Generate with it once, or pass no voice to use its default.` };
  };

  const bridgeHandler = useRef<(request: EngineBridgeRequest) => Promise<unknown>>(async () => null);
  bridgeHandler.current = async ({ op, payload }: EngineBridgeRequest) => {
    await waitFor(() => bridgeState.current.booted && Boolean(settingsRef.current), {
      timeoutMs: 60000,
      message: 'Voxarium is still starting.',
    });
    const active = activeModelRef.current;
    if (op === 'status') {
      const live = bridgeState.current;
      return {
        activeModel: { id: active.id, name: active.name, license: active.license.id },
        engine: { status: live.engineStatus, error: live.engineError, busy: live.activeRequests > 0 },
      };
    }
    if (op === 'models') {
      return MODELS.map((model) =>
        describeModel(model, snapshotRef.current?.models.find((entry) => entry.id === model.id), runtimeFor(model.id).ready, snapshotRef.current?.licenses || {}, active.id),
      );
    }
    if (op === 'voices') {
      const model = payload.model ? resolveModel(MODELS, String(payload.model)) : active;
      if (!model) throw new BridgeError(404, `Unknown model "${String(payload.model)}". See GET /v1/models.`);
      const { voices, defaultId, note } = bridgeVoices(model);
      return { model: model.id, voices: voices.map((voice) => describeVoice(voice, defaultId)), ...(note ? { note } : {}) };
    }
    if (op !== 'synthesize') throw new BridgeError(400, `Unknown operation "${op}".`);

    const text = String(payload.text || '');
    // 1. Model: switch the app's active model if the request names another one.
    let model = active;
    if (payload.model) {
      const wanted = resolveModel(MODELS, String(payload.model));
      if (!wanted) throw new BridgeError(404, `Unknown model "${String(payload.model)}". See GET /v1/models.`);
      model = wanted;
    }
    if (model.id !== active.id) {
      const install = snapshotRef.current?.models.find((entry) => entry.id === model.id);
      if (!install?.installed) throw new BridgeError(409, `${model.shortName} is not installed. Install it from the Models page first.`);
      if (!licenseAcknowledged(model, snapshotRef.current?.licenses || {})) {
        throw new BridgeError(403, `${model.shortName} uses the ${model.license.name}. Acknowledge it in the Models page before using it.`);
      }
      await waitFor(() => bridgeState.current.activeRequests === 0, { timeoutMs: 10 * 60000, message: 'The Studio is busy generating.' });
      if (!(await activateModel(model.id))) {
        throw new BridgeError(409, activationErrorRef.current || `${model.shortName} could not start.`);
      }
    }
    await waitFor(() => bridgeState.current.engineStatus === 'ready' && engineRef.current?.modelId === model.id, {
      timeoutMs: 30 * 60000,
      failure: () => (bridgeState.current.engineStatus === 'error' ? bridgeState.current.engineError || `${model.shortName} failed to load.` : null),
      message: `${model.shortName} did not finish loading in time.`,
    });

    // 2. Voice: the requested one, else the Studio's current voice, else the model default.
    const { voices, defaultId } = bridgeVoices(model);
    let voice: VoiceInfo | null = null;
    if (payload.voice) {
      voice = resolveVoice(model, voices, String(payload.voice));
      if (!voice) throw new BridgeError(400, `${model.shortName} has no voice "${String(payload.voice)}". See GET /v1/voices?model=${model.id}.`);
    } else {
      const current = settingsRef.current?.lastVoice;
      voice = voices.find((item) => item.id === current) || voices.find((item) => item.id === defaultId) || voices[0] || null;
    }
    if (!voice) throw new BridgeError(409, `${model.shortName} reported no voices.`);
    if (isReferenceVoice(voice) && !settingsRef.current?.apiAllowCloning) {
      throw new BridgeError(403, 'Reference-clip voices are disabled for API clients. Allow them in Settings › Local API.');
    }

    // 3. Language: validated against the model (Phonon follows the Studio language).
    const language = payload.language ? String(payload.language) : undefined;
    if (language && !supportsLanguage(model, language)) {
      throw new BridgeError(400, `${model.shortName} does not support "${language}". Supported: ${model.languages.map((item) => item.code).join(', ')}.`);
    }

    const preferences = effectiveSettingsFor(model, activeInstallRef.current, settingsRef.current as Settings);
    const result = await synthesize({
      text,
      voiceId: voice.id,
      temperature: typeof payload.temperature === 'number' ? payload.temperature : preferences.temperature,
      seed: typeof payload.seed === 'string' ? payload.seed : preferences.seed,
      ...(language ? { language } : {}),
      ...(typeof payload.speed === 'number' ? { speed: payload.speed } : {}),
      ...(typeof payload.instruction === 'string' ? { instruction: payload.instruction } : {}),
      ...(typeof payload.intensity === 'number' ? { intensity: payload.intensity } : {}),
    });

    let historyId: string | null = null;
    let filePath: string | null = null;
    if (payload.save) {
      const stored = await saveGeneration({ pcm: result.pcm, text, voiceId: voice.id, stats: result.stats, source: 'api' });
      historyId = stored?.id || null;
      filePath = stored?.filePath || null;
    }
    let played = false;
    if (payload.play) {
      const url = URL.createObjectURL(new Blob([encodeWavBuffer(result.pcm, 24000)], { type: 'audio/wav' }));
      const audio = new Audio(url);
      audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
      played = await audio.play().then(() => true, () => false);
    }
    return {
      pcm: result.pcm,
      ...(payload.format === 'mp3' ? { mp3: encodeMp3(result.pcm, 24000) } : {}),
      sampleRate: 24000,
      duration: result.pcm.length / 24000,
      modelId: model.id,
      voiceId: voice.id,
      license: model.license.id,
      commercial: model.license.commercial,
      historyId,
      filePath,
      played,
    };
  };

  useEffect(() => {
    const bridge = window.studio?.engineBridge;
    if (!bridge) return;
    const unsubscribe = bridge.onRequest((request) => {
      bridgeHandler.current(request).then(
        (result) => bridge.respond({ id: request.id, ok: true, result }),
        (error: unknown) =>
          bridge.respond({
            id: request.id,
            ok: false,
            error: errorMessage(error),
            status: error instanceof BridgeError ? error.status : 500,
          }),
      );
    });
    bridge.ready();
    return unsubscribe;
  }, []);

  const [hfToken, setHfToken] = useState<{ hasToken: boolean; encrypted: boolean } | null>(null);
  useEffect(() => {
    window.studio?.huggingface
      ?.tokenStatus()
      .then(setHfToken)
      .catch(() => setHfToken(null));
  }, []);

  const saveHfToken = useCallback(
    async (token: string) => {
      try {
        const result = await window.studio.huggingface.setToken(token);
        setHfToken({ hasToken: result.hasToken, encrypted: result.encrypted });
        if (!result.ok) {
          toast('The Hugging Face token was not saved.', 'error', result.error);
          return false;
        }
        toast(
          token.trim() ? 'Hugging Face token saved.' : 'Hugging Face token removed.',
          'success',
          result.user ? `Signed in as ${result.user}.` : undefined,
        );
        return true;
      } catch (error) {
        toast('The Hugging Face token was not saved.', 'error', errorMessage(error));
        return false;
      }
    },
    [toast],
  );

  const modelsValue: ModelManager = useMemo(
    () => ({
      hfToken,
      saveHfToken,
      snapshot,
      activeModel,
      install: activeInstall,
      acks,
      hardware,
      busyId: modelBusyId,
      progress: modelProgress,
      sidecars,
      sidecarLogs,
      runtimes,
      runtimeProgress,
      runtimeBusyId,
      refresh: refreshModels,
      statusFor,
      runtimeFor,
      download: downloadModelById,
      cancel: cancelModelDownload,
      verify: verifyModel,
      uninstall: uninstallModel,
      activate: activateModel,
      acknowledge: acknowledgeModel,
      importFolder: importModelFolder,
      openFolder: openModelFolder,
      startSidecar,
      stopSidecar,
      loadSidecarLogs,
      downloadRuntime,
      cancelRuntime,
      verifyRuntime,
      uninstallRuntime,
      importRuntime,
      openRuntimeFolder,
    }),
    [
      acknowledgeModel,
      acks,
      activateModel,
      activeInstall,
      activeModel,
      cancelModelDownload,
      cancelRuntime,
      downloadModelById,
      downloadRuntime,
      hardware,
      hfToken,
      importModelFolder,
      importRuntime,
      loadSidecarLogs,
      saveHfToken,
      modelBusyId,
      modelProgress,
      openModelFolder,
      openRuntimeFolder,
      refreshModels,
      runtimeBusyId,
      runtimeFor,
      runtimeProgress,
      runtimes,
      sidecarLogs,
      sidecars,
      snapshot,
      startSidecar,
      statusFor,
      stopSidecar,
      uninstallModel,
      uninstallRuntime,
      verifyModel,
      verifyRuntime,
    ],
  );

  const value: StudioContextValue = useMemo(
    () => ({
      booted,
      bootError,
      info,
      settings,
      updateSettings,
      model,
      refreshModel,
      storage,
      refreshStorage,
      history,
      refreshHistory,
      customVoices,
      refreshCustomVoices,
      importVoiceFile,
      renameCustomVoice,
      deleteCustomVoice,
      cloneVoice,
      cloneKey,
      saveCloneKey,
      cloneTab,
      openClone,
      closeClone,
      page,
      setPage,
      studioText,
      setStudioText,
      importText,
      toasts,
      toast,
      dismissToast,
      models: modelsValue,
      engine: {
        status: engineStatus,
        info: engineInfo,
        error: engineError,
        stage: engineStage,
        runtimeDirty,
        busy: activeRequests > 0,
        voices: modelVoicesVersion >= 0 ? engineRef.current?.voices || [] : [],
        reload,
        ensureVoice,
        synthesize,
        preview,
      },
      downloads,
      downloadModelBusy,
      voiceDownloadBusy,
      downloadModel,
      downloadVoice,
      downloadAllVoices,
      cancelDownloads,
      saveGeneration,
      deleteHistory,
      patchHistory,
      clearHistory,
      reuseHistory,
    }),
    [
      activeRequests,
      bootError,
      booted,
      clearHistory,
      cloneKey,
      cloneTab,
      cloneVoice,
      closeClone,
      customVoices,
      deleteCustomVoice,
      deleteHistory,
      dismissToast,
      downloadAllVoices,
      downloadModel,
      downloadModelBusy,
      downloadVoice,
      downloads,
      engineError,
      engineInfo,
      engineStage,
      engineStatus,
      ensureVoice,
      history,
      importText,
      importVoiceFile,
      info,
      model,
      modelsValue,
      modelVoicesVersion,
      openClone,
      page,
      patchHistory,
      preview,
      refreshCustomVoices,
      refreshHistory,
      refreshModel,
      refreshStorage,
      reload,
      renameCustomVoice,
      reuseHistory,
      runtimeDirty,
      saveCloneKey,
      saveGeneration,
      setPage,
      setStudioText,
      settings,
      storage,
      studioText,
      synthesize,
      toast,
      toasts,
      updateSettings,
      voiceDownloadBusy,
    ],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const context = useContext(StudioContext);
  if (!context) throw new Error('useStudio must be used inside StudioProvider');
  return context;
}
