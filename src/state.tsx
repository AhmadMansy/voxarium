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
import { customVoiceToInfo, getVoice, setCustomVoices as setCustomVoiceRegistry } from './data/catalog';
import { computePeaks } from './lib/audio';
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
import { getModel, installState } from './models/registry';
import { currentPreferences, rememberPreferences, switchModelSettings } from './models/preferences';
import { capabilityReason } from './models/compat';
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
      const appInfo = infoRef.current;
      if (!appInfo?.serverUrl) {
        setEngineError('The local model server is unavailable. Try restarting Voxarium.');
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
    }) => {
      const engine = engineRef.current;
      if (!engine) throw new Error('The model is not ready yet.');
      await ensureVoice(options.voiceId);
      setActiveRequests((count) => count + 1);
      try {
        return await runSynthesis({ tts: engine.tts, ...options });
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
    [refreshModel, refreshModels, refreshStorage, toast, updateSettings],
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

  const activateModel = useCallback(
    async (id: string) => {
      const current = settingsRef.current;
      if (!current) return false;
      const previousModel = activeModelRef.current;
      if (id === previousModel.id) return true;
      if (activeRequests > 0) {
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
        toast(`${nextModel.shortName} could not be activated.`, 'error', activated.error);
        return false;
      }

      const loaded = await loadFor(nextModel, nextInstall, nextSettings);
      if (!loaded) {
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
    async (options: { pcm: Float32Array; text: string; voiceId: string; stats: SpeechStats | null }) => {
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

  const modelsValue: ModelManager = useMemo(
    () => ({
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
      importModelFolder,
      importRuntime,
      loadSidecarLogs,
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
