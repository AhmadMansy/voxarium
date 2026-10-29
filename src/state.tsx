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
  synthesize as runSynthesis,
  tryAddVoice,
  type LoadedEngine,
  type SynthesizeResult,
} from './lib/engine';
import { buildBaseName, titleFromText } from './lib/utils';

export interface ToastMessage {
  id: string;
  message: string;
  detail?: string;
  kind: 'info' | 'success' | 'error';
}

type EngineStatus = 'idle' | 'needs-setup' | 'loading' | 'ready' | 'error';

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
  cloneVoice: (options: { audio: ArrayBuffer; name: string; language: string }) => Promise<VoiceInfo | null>;
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
  reuseHistory: (entry: HistoryEntry) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

const runtimeKey = (settings: Settings) =>
  JSON.stringify({
    quality: settings.quality,
    device: settings.device,
    gpuPreference: settings.gpuPreference,
    threads: settings.threads,
    language: settings.language,
    rewrites: settings.rewrites,
    conditions: settings.conditions,
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

  const settingsRef = useRef<Settings | null>(null);
  const modelRef = useRef<ModelStatus | null>(null);
  const infoRef = useRef<AppInfo | null>(null);
  const engineRef = useRef<LoadedEngine | null>(null);
  const addedVoicesRef = useRef<Map<string, Promise<void>>>(new Map());
  const voiceQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  settingsRef.current = settings;
  modelRef.current = model;
  infoRef.current = info;

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
      const entries = await window.studio.history.list();
      entries.sort((a, b) => b.createdAt - a.createdAt);
      setHistory(entries);
    } catch {}
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
    async (options: { audio: ArrayBuffer; name: string; language: string }) => {
      const result = await window.studio.clone.create(options);
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

  const openClone = useCallback((tab: 'record' | 'import' = 'record') => setCloneTab(tab), []);
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
        const [appInfo, appSettings, status, entries, storageStats, customRecords, cloneStatus] = await Promise.all([
          window.studio.info(),
          window.studio.settings.get(),
          window.studio.model.status(),
          window.studio.history.list(),
          window.studio.storage.stats(),
          window.studio.voices.listCustom(),
          window.studio.clone.keyStatus(),
        ]);
        if (cancelled) return;
        setInfo(appInfo);
        setSettings(appSettings);
        setModel(status);
        entries.sort((a, b) => b.createdAt - a.createdAt);
        setHistory(entries);
        setStorage(storageStats);
        const mappedCustom = customRecords.map(customVoiceToInfo);
        setCustomVoiceRegistry(mappedCustom);
        setCustomVoicesState(mappedCustom);
        setCloneKey(cloneStatus);
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

  useEffect(
    () => () => {
      for (const timer of toastTimersRef.current.values()) clearTimeout(timer);
      toastTimersRef.current.clear();
      releaseEngine(engineRef.current);
    },
    [],
  );

  const effectiveSettings = useCallback((): Settings => {
    const current = settingsRef.current;
    if (!current) throw new Error('Settings are not loaded yet.');
    const status = modelRef.current;
    const copy: Settings = { ...current, conditions: { ...current.conditions } };
    if (copy.quality === 'f32' && !status?.f32Ready && status?.q8Ready) copy.quality = 'q8';
    if (copy.quality === 'q8' && !status?.q8Ready && status?.f32Ready) copy.quality = 'f32';
    return copy;
  }, []);

  const load = useCallback(async () => {
    const appInfo = infoRef.current;
    const status = modelRef.current;
    if (!appInfo?.serverUrl) {
      setEngineError('The local model server is unavailable. Try restarting Voxarium.');
      setEngineStatus('error');
      return;
    }
    if (!status?.installed) {
      setEngineStatus('needs-setup');
      return;
    }
    releaseEngine(engineRef.current);
    engineRef.current = null;
    addedVoicesRef.current.clear();
    setEngineStatus('loading');
    setEngineError(null);
    setEngineInfo(null);
    setEngineStage('Starting the local runtime…');
    try {
      const settingsToLoad = effectiveSettings();
      const loaded = await loadEngine({
        settings: settingsToLoad,
        serverUrl: appInfo.serverUrl,
        onStage: (stage) => setEngineStage(stage),
      });
      engineRef.current = loaded;
      setEngineInfo(loaded.info);
      setLoadedRuntime(runtimeKey(settingsToLoad));
      setEngineStatus('ready');
    } catch (error) {
      console.error('[phonon] engine load failed', error);
      setEngineError(errorMessage(error));
      setEngineStatus('error');
    }
  }, [effectiveSettings]);

  useEffect(() => {
    if (!booted || !settings || !model) return;
    if (!model.installed) {
      setEngineStatus('needs-setup');
      return;
    }
    if (engineStatus === 'idle' || engineStatus === 'needs-setup') void load();
  }, [booted, settings?.setupComplete, model?.installed, engineStatus, load]);

  const reload = useCallback(async () => {
    if (activeRequests > 0) {
      toast('Wait for the current generation to finish before reloading.', 'info');
      return;
    }
    await load();
  }, [activeRequests, load, toast]);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        if (patch.conditions) next.conditions = { ...prev.conditions, ...patch.conditions };
        return next;
      });
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        window.studio.settings.save(patch).catch((error) => {
          toast('Settings could not be saved.', 'error', errorMessage(error));
        });
      }, 280);
    },
    [toast],
  );

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
        await refreshStorage();
        toast('Phonon 31M is ready on this device.', 'success');
        return true;
      } catch (error) {
        if (!isAbort(error)) toast('Model download failed.', 'error', errorMessage(error));
        return false;
      } finally {
        setDownloadModelBusy(false);
      }
    },
    [refreshModel, refreshStorage, toast, updateSettings],
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
            quality: current.quality,
            device: current.device,
            temperature: current.temperature,
            seed: current.seed,
            rewrites: current.rewrites,
            language: current.language,
            conditions: { ...current.conditions },
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
          detail: options.deleteFile === false ? 'The history entry will be removed, but the WAV file stays on disk.' : 'The WAV file will also be deleted from your audio folder.',
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
    (entry: HistoryEntry) => {
      setStudioText(entry.text);
      const voice = getVoice(entry.voiceId);
      updateSettings({ lastVoice: voice.id === entry.voiceId ? entry.voiceId : 'default' });
      setPage('studio');
      toast('Loaded into the studio.', 'success');
    },
    [setStudioText, toast, updateSettings],
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
      ? loadedRuntime !== runtimeKey(settings)
      : false;

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
