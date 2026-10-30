import { useEffect, useMemo, useState } from 'react';
import { VOICES, getVoice, localeFlags, localeLabel } from '../data/catalog';
import {
  applyPronunciations,
  buildBaseName,
  classNames,
  formatBytes,
  formatDuration,
  pluralize,
} from '../lib/utils';
import { useStudio } from '../state';
import { capabilityEnabled, capabilityReason, supportsLanguage } from '../models/compat';
import { assessFit, fitTone } from '../models/fit';
import { licenseBadge } from '../models/license';
import type { Accent, Device, GpuInfoResult, GpuPreference, Language, Quality, Rewrites, Theme } from '../types';
import { Icon } from '../components/Icons';
import { IntegrationsCard } from '../components/IntegrationsCard';
import { PageHeader } from '../components/PageHeader';
import { VoiceAvatar } from '../components/VoiceAvatar';

const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: 'dark', label: 'Midnight', hint: 'Easy on the eyes' },
  { id: 'light', label: 'Daylight', hint: 'Crisp and bright' },
];

const ACCENTS: { id: Accent; label: string; color: string }[] = [
  { id: 'violet', label: 'Violet', color: 'hsl(262 85% 67%)' },
  { id: 'cyan', label: 'Cyan', color: 'hsl(190 85% 55%)' },
  { id: 'amber', label: 'Amber', color: 'hsl(38 92% 58%)' },
  { id: 'rose', label: 'Rose', color: 'hsl(342 82% 64%)' },
];

const DEVICES: { id: Device; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Pick the best device' },
  { id: 'cpu', label: 'CPU', hint: 'Always works' },
  { id: 'webgpu', label: 'WebGPU', hint: 'Offload to the GPU' },
];

const GPU_PREFERENCES: { id: GpuPreference; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Let Chromium decide' },
  { id: 'high-performance', label: 'High performance', hint: 'Prefer the discrete GPU' },
  { id: 'low-power', label: 'Low power', hint: 'Prefer the integrated GPU' },
];

const REWRITE_OPTIONS: { id: Rewrites; label: string; hint: string }[] = [
  { id: 'default', label: 'Standard', hint: 'Numbers, currency, emails, URLs, abbreviations' },
  { id: 'all', label: 'Everything', hint: 'Also reads phone numbers, times and dates aloud' },
  { id: 'none', label: 'Off', hint: 'Send the tokenizer exactly what you typed' },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface SettingsPageProps {
  onOpenSetup: () => void;
}

export function SettingsPage({ onOpenSetup }: SettingsPageProps) {
  const {
    settings,
    updateSettings,
    info,
    model,
    models,
    storage,
    engine,
    setPage,
    refreshModel,
    refreshStorage,
    downloadModel,
    downloadModelBusy,
    downloads,
    refreshHistory,
    toast,
    cloneKey,
    saveCloneKey,
    customVoices,
    openClone,
  } = useStudio();

  const [verifying, setVerifying] = useState(false);
  const [clearing, setClearing] = useState<'model' | 'voices' | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [hfDraft, setHfDraft] = useState('');
  const [hfBusy, setHfBusy] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [gpuInfo, setGpuInfo] = useState<GpuInfoResult | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    void refreshStorage();
  }, [refreshStorage]);

  useEffect(() => {
    let cancelled = false;
    window.studio.gpu
      .info()
      .then((next) => {
        if (!cancelled) setGpuInfo(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const voice = getVoice(settings?.lastVoice);
  const activeModel = models.activeModel;
  const activeFit = assessFit(activeModel, models.hardware);
  const activeLicense = licenseBadge(activeModel.license);
  const languageOptions = useMemo(() => {
    const declared = activeModel.languages.map((language) => ({
      id: language.code,
      label: language.name,
      hint: language.quality ? `${language.quality} quality` : 'Declared by this model',
    }));
    return [...declared, { id: 'none', label: 'Raw', hint: 'Skip normalization and tokenize exactly as written' }];
  }, [activeModel]);
  const languageSupported = supportsLanguage(activeModel, settings?.language);
  const namePreview = useMemo(
    () => buildBaseName(settings?.filenameTemplate || 'voxarium-{date}-{voice}', { voice: voice.name, text: 'example script' }),
    [settings?.filenameTemplate, voice.name],
  );

  if (!settings) return null;

  const engineDirty = engine.runtimeDirty;

  const restartForGpu = async () => {
    setRestarting(true);
    try {
      await window.studio.settings.save({ gpuPreference: settings.gpuPreference });
      await window.studio.restart();
    } catch (error) {
      setRestarting(false);
      toast('The app could not restart. Close and open it again.', 'error', errorText(error));
    }
  };

  const setQuality = (quality: Quality) => {
    const ready = quality === 'f32' ? model?.f32Ready : model?.q8Ready;
    if (!ready) {
      toast(`The ${quality.toUpperCase()} weights are not downloaded yet.`, 'info');
      return;
    }
    updateSettings({ quality });
  };

  const downloadQuality = async (quality: Quality) => {
    const ok = await downloadModel(quality);
    if (ok) toast(`${quality.toUpperCase()} weights are ready.`, 'success');
  };

  const verifyFiles = async () => {
    setVerifying(true);
    try {
      const result = await window.studio.model.verify();
      if (result.mismatched.length) {
        toast('Some model files look incomplete.', 'error', result.mismatched.join(', '));
      } else {
        toast('Every model file is complete.', 'success');
      }
      await refreshModel();
      await refreshStorage();
    } catch (error) {
      toast('The model files could not be verified.', 'error', errorText(error));
    } finally {
      setVerifying(false);
    }
  };

  const importFiles = async () => {
    try {
      const result = await window.studio.model.importFolder();
      if (result.cancelled) return;
      if (!result.ok) {
        toast('Those model files could not be used.', 'error', result.error);
        return;
      }
      await refreshModel();
      await refreshStorage();
      toast('Model files imported.', 'success', result.found?.join(', '));
    } catch (error) {
      toast('The folder could not be imported.', 'error', errorText(error));
    }
  };

  const removeModel = async () => {
    const confirmed = await window.studio.ui.confirm({
      title: 'Remove model files?',
      message: 'Delete the Phonon checkpoint from this device?',
      detail: 'Voices and recordings are kept. You will need to download or import the model again to generate speech.',
      confirmLabel: 'Remove model',
      danger: true,
    });
    if (!confirmed) return;
    setClearing('model');
    try {
      await window.studio.model.clear({ what: 'all' });
      await refreshModel();
      await refreshStorage();
      toast('Model files removed.', 'success');
    } finally {
      setClearing(null);
    }
  };

  const removeVoices = async () => {
    const confirmed = await window.studio.ui.confirm({
      title: 'Delete downloaded voices?',
      message: `Remove ${model?.voicesDownloaded || 0} downloaded voice files?`,
      detail: 'The default voice is part of the model and stays. Voices download again automatically when you use them.',
      confirmLabel: 'Delete voices',
      danger: true,
    });
    if (!confirmed) return;
    setClearing('voices');
    try {
      await window.studio.voices.clear();
      await refreshModel();
      await refreshStorage();
      toast('Downloaded voices deleted.', 'success');
    } finally {
      setClearing(null);
    }
  };

  const chooseOutput = async () => {
    const directory = await window.studio.paths.chooseOutputDir();
    updateSettings({ outputDir: directory });
  };

  const saveKey = async () => {
    const clean = keyDraft.trim();
    if (!clean) return;
    setKeyBusy(true);
    const ok = await saveCloneKey(clean);
    setKeyBusy(false);
    if (ok) setKeyDraft('');
  };

  const saveHf = async (token: string) => {
    setHfBusy(true);
    const ok = await models.saveHfToken(token.trim());
    setHfBusy(false);
    if (ok) setHfDraft('');
  };

  const clearKey = async () => {
    setKeyBusy(true);
    const ok = await saveCloneKey('');
    setKeyBusy(false);
    if (ok) setKeyDraft('');
  };

  const updatePronunciation = (index: number, patch: { from?: string; to?: string }) => {
    const next = settings.pronunciations.map((rule, position) =>
      position === index ? { ...rule, ...patch } : rule,
    );
    updateSettings({ pronunciations: next });
  };

  const addPronunciation = () => {
    updateSettings({ pronunciations: [...settings.pronunciations, { from: '', to: '' }] });
  };

  const removePronunciation = (index: number) => {
    updateSettings({ pronunciations: settings.pronunciations.filter((_, position) => position !== index) });
  };

  const pronunciationSample = useMemo(() => {
    const sample = 'Dr. Ahmed said the launch is on 14 March at 5:30 p.m. — email hello@example.com for 20% off.';
    const applied = applyPronunciations(sample, settings?.pronunciations || []);
    return { source: sample, result: applied.text, applied: applied.applied };
  }, [settings?.pronunciations]);

  const storageTotal = storage ? storage.totalBytes : 0;
  const storageParts = storage
    ? [
        { label: 'Model', value: storage.models.bytes, className: 'is-model' },
        { label: 'Voices', value: storage.voices.bytes, className: 'is-voices' },
        { label: 'Audio', value: storage.audio.bytes, className: 'is-audio' },
      ]
    : [];

  return (
    <div className="page page--settings">
      <PageHeader
        icon="settings"
        eyebrow="Settings"
        title="Studio settings"
        description={`Tune ${models.activeModel.shortName}, choose where files live, and make the studio sound the way you want.`}
        actions={
          <>
            <button className="btn btn--subtle" onClick={onOpenSetup}>
              <Icon name="downloadCloud" size={15} /> Setup assistant
            </button>
            <button className="btn btn--subtle" onClick={() => void refreshStorage()}>
              <Icon name="refresh" size={15} /> Refresh
            </button>
          </>
        }
      />

      <section className="card model-strip model-strip--settings">
        <div className="model-strip__main model-strip__main--static">
          <span className="model-strip__mark">
            <Icon name="layers" size={19} />
          </span>
          <span className="model-strip__text">
            <strong>{activeModel.shortName}</strong>
            <em>
              {activeModel.family} · {activeModel.runtimeLabel}
            </em>
          </span>
        </div>
        <div className="model-strip__badges">
          <span className="tag tag--accent" title={activeModel.ratingNotes}>
            ★ {activeModel.rating}/10
          </span>
          <span className={classNames('tag', `tag--${fitTone(activeFit.level)}`)} title={activeFit.summary}>
            {activeFit.label}
          </span>
          <span className={classNames('tag', `tag--${activeLicense.tone}`)} title={activeLicense.title}>
            {activeLicense.label}
          </span>
        </div>
        <div className="model-strip__caps">
          <span className={classNames('tag', capabilityEnabled(activeModel, 'streaming') ? 'tag--ok' : 'tag--muted')}>
            <Icon name={capabilityEnabled(activeModel, 'streaming') ? 'check' : 'x'} size={10} /> Streaming
          </span>
          <span className={classNames('tag', capabilityEnabled(activeModel, 'voiceClone') ? 'tag--ok' : 'tag--muted')}>
            <Icon name={capabilityEnabled(activeModel, 'voiceClone') ? 'check' : 'x'} size={10} /> Cloning
          </span>
          <span className={classNames('tag', capabilityEnabled(activeModel, 'multiSpeaker') ? 'tag--ok' : 'tag--muted')}>
            <Icon name={capabilityEnabled(activeModel, 'multiSpeaker') ? 'check' : 'x'} size={10} /> Dialogue
          </span>
        </div>
        <button className="btn btn--subtle btn--sm" onClick={() => setPage('models')}>
          <Icon name="layers" size={14} /> Manage models
        </button>
      </section>

      {engineDirty && (
        <div className="banner banner--warn banner--sticky">
          <span className="banner__icon">
            <Icon name="refresh" size={17} />
          </span>
          <div className="banner__body">
            <strong>Reload required</strong>
            <span>Quality, device, threads, language, rewrites or conditions changed. Reload the engine to apply them.</span>
          </div>
          <button className="btn btn--primary btn--sm" onClick={() => void engine.reload()} disabled={engine.busy}>
            <Icon name={engine.status === 'loading' ? 'loader' : 'refresh'} size={14} className={engine.status === 'loading' ? 'spin' : undefined} />
            {engine.status === 'loading' ? 'Loading…' : 'Reload engine'}
          </button>
        </div>
      )}

      <div className="settings-layout">
        <div className="settings-main">
          <section className="card settings-card">
            <header className="settings-card__head">
              <span className="settings-card__icon">
                <Icon name="sun" size={17} />
              </span>
              <div>
                <h2>Appearance</h2>
                <p>Make the studio feel like yours.</p>
              </div>
            </header>
            <div className="theme-grid">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  className={classNames('theme-card', settings.theme === theme.id && 'is-active')}
                  onClick={() => updateSettings({ theme: theme.id })}
                >
                  <span className={`theme-card__preview theme-card__preview--${theme.id}`}>
                    <span className="theme-card__sidebar" />
                    <span className="theme-card__content">
                      <span />
                      <span />
                      <span />
                    </span>
                  </span>
                  <span className="theme-card__label">
                    <strong>{theme.label}</strong>
                    <em>{theme.hint}</em>
                  </span>
                  <span className="theme-card__check">
                    <Icon name="check" size={13} />
                  </span>
                </button>
              ))}
            </div>
            <div className="settings-row">
              <div className="settings-row__label">
                <strong>Accent</strong>
                <span>Used for buttons, waveforms and highlights.</span>
              </div>
              <div className="accent-swatches">
                {ACCENTS.map((accent) => (
                  <button
                    key={accent.id}
                    className={classNames('accent-swatch', settings.accent === accent.id && 'is-active')}
                    style={{ ['--swatch' as string]: accent.color }}
                    onClick={() => updateSettings({ accent: accent.id })}
                    title={accent.label}
                    aria-label={accent.label}
                  >
                    <span />
                    {settings.accent === accent.id && <Icon name="check" size={12} />}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="card settings-card">
            <header className="settings-card__head">
              <span className="settings-card__icon">
                <Icon name="cpu" size={17} />
              </span>
              <div>
                <h2>Voice engine</h2>
                <p>How Phonon loads and runs its weights on this machine.</p>
              </div>
              <span className={classNames('tag', engine.status === 'ready' ? 'tag--ok' : engine.status === 'error' ? 'tag--danger' : 'tag--warn')}>
                <span className={classNames('status-dot', engine.status === 'ready' ? 'status-dot--ok' : engine.status === 'error' ? 'status-dot--danger' : 'status-dot--warn')} />
                {engine.status === 'ready' ? 'Running' : engine.status === 'loading' ? 'Loading' : engine.status === 'error' ? 'Error' : 'Idle'}
              </span>
            </header>

            {engine.status === 'error' && (
              <div className="inline-error">
                <Icon name="alert" size={15} />
                <span>{engine.error}</span>
                <button className="btn btn--subtle btn--sm" onClick={() => void engine.reload()}>
                  Retry
                </button>
              </div>
            )}

            <div className="settings-field">
              <div className="settings-field__head">
                <strong>Weight precision</strong>
                <span>Q8 is smaller and faster; F32 keeps every parameter.</span>
              </div>
              <div className="option-list">
                {(['q8', 'f32'] as Quality[]).map((quality) => {
                  const ready = quality === 'f32' ? model?.f32Ready : model?.q8Ready;
                  const size = info?.model.files[quality === 'f32' ? 'model.safetensors' : 'model.q8.gguf']?.size || 0;
                  const progress = downloadsFor(downloads, quality);
                  return (
                    <div key={quality} className={classNames('option-row', settings.quality === quality && 'is-selected')}>
                      <button className="option-row__main" onClick={() => setQuality(quality)} disabled={!ready}>
                        <span className="option-row__radio" />
                        <span>
                          <strong>{quality.toUpperCase()}</strong>
                          <em>{quality === 'q8' ? 'Compact · recommended' : 'Full precision'}</em>
                        </span>
                      </button>
                      <span className="option-row__aside">
                        <span>{formatBytes(size)}</span>
                        {ready ? (
                          <em className="tag tag--ok">On disk</em>
                        ) : downloadModelBusy ? (
                          <em className="tag tag--warn">{progress != null ? `${Math.round(progress)}%` : 'Downloading'}</em>
                        ) : (
                          <button className="btn btn--subtle btn--sm" onClick={() => void downloadQuality(quality)}>
                            <Icon name="download" size={13} /> Download
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="settings-field">
              <div className="settings-field__head">
                <strong>Compute device</strong>
                <span>{engine.info?.deviceReason || 'Auto chooses WebGPU for Q8 when a hardware adapter is available.'}</span>
              </div>
              <div className="segmented">
                {DEVICES.map((device) => (
                  <button
                    key={device.id}
                    className={classNames(settings.device === device.id && 'is-active')}
                    onClick={() => updateSettings({ device: device.id })}
                  >
                    <strong>{device.label}</strong>
                    <em>{device.hint}</em>
                  </button>
                ))}
              </div>
              {settings.device === 'webgpu' && settings.quality === 'f32' && (
                <p className="field__hint field__hint--warn">
                  <Icon name="alert" size={13} /> WebGPU is tuned for Q8. Switch precision or use Auto if the engine fails to start.
                </p>
              )}
            </div>

            <div className="settings-field">
              <div className="settings-field__head">
                <strong>Graphics adapter</strong>
                <span>
                  For machines with more than one GPU. WebGPU can only express a preference; Chromium still owns the
                  final choice. High performance is applied at startup, low power as an adapter hint.
                </span>
              </div>
              <div className="segmented">
                {GPU_PREFERENCES.map((preference) => (
                  <button
                    key={preference.id}
                    className={classNames(settings.gpuPreference === preference.id && 'is-active')}
                    onClick={() => updateSettings({ gpuPreference: preference.id })}
                  >
                    <strong>{preference.label}</strong>
                    <em>{preference.hint}</em>
                  </button>
                ))}
              </div>
              {gpuInfo?.devices?.length ? (
                <div className="gpu-device-list">
                  {gpuInfo.devices.map((gpu, index) => {
                    const label = gpu.deviceString || `GPU ${index + 1}`;
                    if (/basic render/i.test(label)) return null;
                    return (
                      <div
                        key={`${gpu.vendorId ?? index}-${gpu.deviceId ?? index}-${index}`}
                        className={classNames('gpu-device', gpu.active && 'is-active')}
                      >
                        <span className="gpu-device__dot" />
                        <div>
                          <strong>{label}</strong>
                          <em>
                            {[gpu.driverVendor, gpu.driverVersion].filter(Boolean).join(' ') || 'Graphics adapter'}
                          </em>
                        </div>
                        {gpu.active ? <span className="tag tag--ok">Active</span> : <span className="tag">Detected</span>}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <p className="field__hint">
                Changing the adapter needs an app restart; reloading the engine applies the worker hint immediately.
                {gpuInfo?.platform === 'win32' && (
                  <>
                    {' '}
                    <button className="link" onClick={() => void window.studio.gpu.openSettings()}>
                      Open Windows graphics settings <Icon name="external" size={11} />
                    </button>
                  </>
                )}
              </p>
              {settings.gpuPreference !== (gpuInfo?.preference || 'auto') && (
                <div className="gpu-restart">
                  <span>
                    Restart to apply{' '}
                    {settings.gpuPreference === 'high-performance'
                      ? 'the high-performance adapter'
                      : settings.gpuPreference === 'low-power'
                        ? 'the low-power adapter'
                        : 'automatic adapter selection'}
                    .
                  </span>
                  <button className="btn btn--primary btn--sm" onClick={() => void restartForGpu()} disabled={restarting}>
                    <Icon name={restarting ? 'loader' : 'refresh'} size={14} className={restarting ? 'spin' : undefined} />
                    Restart now
                  </button>
                </div>
              )}
            </div>

            <div className="settings-field settings-field--split">
              <div>
                <div className="settings-field__head">
                  <strong>CPU threads</strong>
                  <span>
                    {engine.info?.threadsReason || 'Threads need cross-origin isolation.'}
                    {engine.info ? ` · currently ${engine.info.threads}` : ''}
                  </span>
                </div>
                <select
                  className="select"
                  value={settings.threads === 'auto' ? 'auto' : String(settings.threads)}
                  onChange={(event) =>
                    updateSettings({ threads: event.target.value === 'auto' ? 'auto' : Number(event.target.value) })
                  }
                >
                  <option value="auto">Auto (up to 3)</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((thread) => (
                    <option key={thread} value={thread}>
                      {thread} thread{thread === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="settings-field__head">
                  <strong>Language</strong>
                  <span>
                    {activeModel.shortName} declares {languageOptions.length - 1} language
                    {languageOptions.length === 2 ? '' : 's'}. Unsupported values fall back to{' '}
                    {activeModel.defaults.language.toUpperCase()}.
                  </span>
                </div>
                <select
                  className="select"
                  value={languageSupported ? settings.language : activeModel.defaults.language}
                  onChange={(event) => updateSettings({ language: event.target.value as Language })}
                >
                  {languageOptions.map((language) => (
                    <option key={language.id} value={language.id} title={language.hint}>
                      {language.label}
                    </option>
                  ))}
                </select>
                {!languageSupported && (
                  <p className="field__hint field__hint--warn">
                    <Icon name="alert" size={13} /> {settings.language.toUpperCase()} is not declared by{' '}
                    {activeModel.shortName}; the studio falls back to {activeModel.defaults.language.toUpperCase()}.
                  </p>
                )}
              </div>
            </div>

            <div className="settings-field">
              <div className="settings-field__head">
                <strong>Word rewrites</strong>
                <span>
                  {!capabilityEnabled(activeModel, 'normalization')
                    ? capabilityReason(activeModel, 'normalization')
                    : settings.language === 'none'
                      ? 'Ignored while normalization is off.'
                      : 'How numbers and abbreviations are read aloud.'}
                </span>
              </div>
              <select
                className="select select--wide"
                value={settings.rewrites}
                disabled={settings.language === 'none' || !capabilityEnabled(activeModel, 'normalization')}
                onChange={(event) => updateSettings({ rewrites: event.target.value as Rewrites })}
              >
                {REWRITE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} — {option.hint}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-field">
              <div className="settings-field__head">
                <strong>Model conditions</strong>
                <span>Checkpoint conditioners. These need an engine reload to take effect.</span>
              </div>
              <div className="condition-grid">
                <label className="condition">
                  <span>
                    Speakers
                    <em>
                      {capabilityEnabled(activeModel, 'multiSpeaker')
                        ? 'How many voices are in the scene'
                        : capabilityReason(activeModel, 'multiSpeaker')}
                    </em>
                  </span>
                  <select
                    className="select"
                    value={settings.conditions.num_speakers}
                    disabled={!capabilityEnabled(activeModel, 'multiSpeaker')}
                    onChange={(event) =>
                      updateSettings({ conditions: { ...settings.conditions, num_speakers: event.target.value } })
                    }
                  >
                    <option value="0">0 · none</option>
                    <option value="1">1 · single speaker</option>
                    <option value="2">2 · conversation</option>
                  </select>
                </label>
                <label className="condition">
                  <span>
                    Duration delta
                    <em>{settings.conditions.duration_delta === 0 ? 'Neutral pacing' : settings.conditions.duration_delta > 0 ? 'Stretched pacing' : 'Tighter pacing'}</em>
                  </span>
                  <span className="condition__range">
                    <input
                      className="range"
                      type="range"
                      min={-1}
                      max={1}
                      step={0.05}
                      value={settings.conditions.duration_delta}
                      onChange={(event) =>
                        updateSettings({
                          conditions: { ...settings.conditions, duration_delta: Number(event.target.value) },
                        })
                      }
                    />
                    <em>{settings.conditions.duration_delta.toFixed(2)}</em>
                    <button
                      className="link"
                      onClick={() => updateSettings({ conditions: { ...settings.conditions, duration_delta: 0 } })}
                    >
                      Reset
                    </button>
                  </span>
                </label>
              </div>
            </div>

            <div className="engine-readout">
              <div>
                <span>Device</span>
                <strong>{engine.info ? (engine.info.device === 'webgpu' ? 'WebGPU' : 'CPU') : '—'}</strong>
              </div>
              <div>
                <span>Threads</span>
                <strong>{engine.info?.threads ?? '—'}</strong>
              </div>
              <div>
                <span>Load time</span>
                <strong>{engine.info ? formatDuration(engine.info.loadMs / 1000) : '—'}</strong>
              </div>
              <div>
                <span>Isolated</span>
                <strong>{engine.info?.crossOriginIsolated ? 'Yes' : 'No'}</strong>
              </div>
              <div>
                <span>SIMD</span>
                <strong>{engine.info?.features?.simd128 ? '128-bit' : 'Scalar'}</strong>
              </div>
              <div>
                <span>Languages</span>
                <strong>{engine.info?.languages?.join(', ') || 'en'}</strong>
              </div>
            </div>
            <div className="settings-card__footer">
              <button
                className="btn btn--subtle"
                onClick={() => void engine.reload()}
                disabled={engine.busy || engine.status === 'loading'}
              >
                <Icon name={engine.status === 'loading' ? 'loader' : 'refresh'} size={15} className={engine.status === 'loading' ? 'spin' : undefined} />
                {engine.status === 'loading' ? 'Loading engine…' : 'Reload engine'}
              </button>
              {engine.busy && <span className="field__hint">A generation is running. Reload is disabled until it finishes.</span>}
            </div>
          </section>

          <section className="card settings-card">
            <header className="settings-card__head">
              <span className="settings-card__icon">
                <Icon name="sparkles" size={17} />
              </span>
              <div>
                <h2>Generation defaults</h2>
                <p>The starting point for every new take.</p>
              </div>
            </header>

            <div className="settings-field settings-field--split">
              <label className="field">
                <span className="field__label">Studio voice</span>
                <span className="select-with-avatar">
                  <VoiceAvatar voiceId={voice.id} size="xs" />
                  <select
                    className="select"
                    value={settings.lastVoice}
                    onChange={(event) => updateSettings({ lastVoice: event.target.value, defaultVoice: event.target.value })}
                  >
                    {[...customVoices, ...VOICES].map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} — {localeLabel(item.locale)}
                        {item.source === 'custom' ? ' (custom)' : ''}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="field">
                <span className="field__label">
                  Temperature
                  <em>{settings.temperature.toFixed(2)}</em>
                </span>
                <input
                  type="range"
                  className="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.temperature}
                  onChange={(event) => updateSettings({ temperature: Number(event.target.value) })}
                />
                <span className="field__hint">Lower is more consistent; higher is more playful.</span>
              </label>
            </div>

            <label className="field">
              <span className="field__label">Default seed</span>
              <input
                className="input input--mono"
                value={settings.seed}
                inputMode="numeric"
                onChange={(event) => updateSettings({ seed: event.target.value.replace(/[^\d]/g, '').slice(0, 19) })}
              />
              <span className="field__hint">Keep the same seed to reproduce a take exactly.</span>
            </label>

            <div className="settings-toggles">
              <label className="switch-row">
                <span>
                  <strong>Save every take to history</strong>
                  <em>Writes a WAV into your audio folder.</em>
                </span>
                <span className="switch">
                  <input type="checkbox" checked={settings.autoSave} onChange={(event) => updateSettings({ autoSave: event.target.checked })} />
                  <span className="switch__track"><span className="switch__thumb" /></span>
                </span>
              </label>
              <label className="switch-row">
                <span>
                  <strong>Autoplay finished takes</strong>
                  <em>Play the render as soon as it is ready.</em>
                </span>
                <span className="switch">
                  <input type="checkbox" checked={settings.autoPlay} onChange={(event) => updateSettings({ autoPlay: event.target.checked })} />
                  <span className="switch__track"><span className="switch__thumb" /></span>
                </span>
              </label>
              <label className={classNames('switch-row', !capabilityEnabled(activeModel, 'streaming') && 'is-disabled')}>
                <span>
                  <strong>Stream while generating</strong>
                  <em>
                    {capabilityEnabled(activeModel, 'streaming')
                      ? 'Hear speech as the model produces it.'
                      : capabilityReason(activeModel, 'streaming')}
                  </em>
                </span>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={settings.streaming && capabilityEnabled(activeModel, 'streaming')}
                    disabled={!capabilityEnabled(activeModel, 'streaming')}
                    onChange={(event) => updateSettings({ streaming: event.target.checked })}
                  />
                  <span className="switch__track"><span className="switch__thumb" /></span>
                </span>
              </label>
            </div>

            <label className="field">
              <span className="field__label">Filename template</span>
              <input
                className="input input--mono"
                value={settings.filenameTemplate}
                onChange={(event) => updateSettings({ filenameTemplate: event.target.value })}
                spellCheck={false}
              />
              <span className="field__hint">
                Preview: <code>{namePreview}.wav</code>
              </span>
              <span className="token-row">
                {['{date}', '{time}', '{voice}', '{slug}', '{index}'].map((token) => (
                  <button
                    key={token}
                    className="chip chip--tiny"
                    onClick={() => updateSettings({ filenameTemplate: `${settings.filenameTemplate}${token}` })}
                  >
                    {token}
                  </button>
                ))}
              </span>
            </label>

            <div className="field">
              <span className="field__label">
                Export folder
                <em>Save dialogs start here</em>
              </span>
              <div className="path-row">
                <code className="path-row__value">{settings.outputDir}</code>
                <button className="btn btn--subtle btn--sm" onClick={() => void chooseOutput()}>
                  <Icon name="folderOpen" size={14} /> Choose
                </button>
                <button className="btn btn--icon btn--ghost" onClick={() => void window.studio.paths.reveal('output')} title="Open folder">
                  <Icon name="external" size={15} />
                </button>
              </div>
            </div>
          </section>

          <section className="card settings-card">
            <header className="settings-card__head">
              <span className="settings-card__icon">
                <Icon name="key" size={17} />
              </span>
              <div>
                <h2>Voice cloning</h2>
                <p>Bring your own voice, or import one designed in Gradium Studio.</p>
              </div>
              <span className={classNames('tag', capabilityEnabled(activeModel, 'voiceClone') ? 'tag--ok' : 'tag--muted')}>
                <Icon name={capabilityEnabled(activeModel, 'voiceClone') ? 'sparkles' : 'x'} size={11} />{' '}
                {capabilityEnabled(activeModel, 'voiceClone') ? 'Cloud, once' : 'Unavailable'}
              </span>
            </header>

            {!capabilityEnabled(activeModel, 'voiceClone') && (
              <div className="inline-error inline-error--info">
                <Icon name="alert" size={15} />
                <span>{capabilityReason(activeModel, 'voiceClone')}</span>
                <button className="btn btn--subtle btn--sm" onClick={() => setPage('models')}>
                  Choose a model
                </button>
              </div>
            )}

            <label className={classNames('switch-row', !capabilityEnabled(activeModel, 'voiceClone') && 'is-disabled')}>
              <span>
                <strong>Allow cloud voice cloning</strong>
                <em>
                  Sends a 10–15 second recording to Gradium once to create a voice. Turn it off to import only — then
                  nothing is ever uploaded.
                </em>
              </span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings.allowCloudCloning !== false}
                  disabled={!capabilityEnabled(activeModel, 'voiceClone')}
                  onChange={(event) => updateSettings({ allowCloudCloning: event.target.checked })}
                />
                <span className="switch__track"><span className="switch__thumb" /></span>
              </span>
            </label>

            <div className="settings-field">
              <div className="settings-field__head">
                <strong>Gradium API key</strong>
                <span>
                  {cloneKey?.hasKey
                    ? cloneKey.encrypted
                      ? 'Saved and encrypted on this device.'
                      : 'Saved in the app data folder on this device.'
                    : 'Only needed to clone a voice from a recording.'}
                </span>
              </div>
              <div className="path-row">
                <input
                  className="input input--mono"
                  type="password"
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  placeholder={cloneKey?.hasKey ? 'Paste a new key to replace the saved one' : 'Paste your Gradium API key'}
                  spellCheck={false}
                  disabled={keyBusy}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveKey();
                  }}
                />
                <button className="btn btn--subtle btn--sm" onClick={() => void saveKey()} disabled={!keyDraft.trim() || keyBusy}>
                  {keyBusy ? 'Saving…' : 'Save key'}
                </button>
                {cloneKey?.hasKey && (
                  <button className="btn btn--subtle btn--sm" onClick={() => void clearKey()} disabled={keyBusy}>
                    Remove
                  </button>
                )}
              </div>
              <p className="field__hint">
                Create a key in{' '}
                <button className="link" onClick={() => void window.studio.openExternal('https://studio.gradium.ai/')}>
                  Gradium Studio <Icon name="external" size={11} />
                </button>
                . Cloning runs in Gradium’s cloud once; the resulting 256 KB voice file is downloaded here and every later
                generation is local. The key never goes into recordings or exports.
              </p>
            </div>

            <div className="settings-field">
              <div className="settings-field__head">
                <strong>Your voices</strong>
                <span>
                  {customVoices.length
                    ? `${customVoices.length} custom voice${customVoices.length === 1 ? '' : 's'} on this device.`
                    : 'No custom voices yet — clone one or import a .safetensors file.'}
                </span>
              </div>
              <div className="clone-actions">
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => openClone('record')}
                  disabled={settings.allowCloudCloning === false || !capabilityEnabled(activeModel, 'voiceClone')}
                  title={capabilityReason(activeModel, 'voiceClone') || undefined}
                >
                  <Icon name="mic" size={14} /> Record &amp; clone
                </button>
                <button
                  className="btn btn--subtle btn--sm"
                  onClick={() => openClone('import')}
                  disabled={!capabilityEnabled(activeModel, 'voiceImport')}
                  title={capabilityReason(activeModel, 'voiceImport') || undefined}
                >
                  <Icon name="upload" size={14} /> Import voice file
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => void window.studio.paths.reveal('voices')}>
                  <Icon name="folder" size={14} /> Open voice folder
                </button>
              </div>
              <p className="field__hint">
                Imported and cloned voices appear beside the catalog everywhere — in the studio, the voice picker, batch
                renders and history. Importing works completely offline; only the initial clone sends a short clip to
                Gradium.
              </p>
            </div>
          </section>

          <section className="card settings-card">
            <header className="settings-card__head">
              <span className="settings-card__icon">
                <Icon name="downloadCloud" size={17} />
              </span>
              <div>
                <h2>Model downloads</h2>
                <p>Access for gated models and the folder for local reference voices.</p>
              </div>
              <span className={classNames('tag', models.hfToken?.hasToken ? 'tag--ok' : 'tag--muted')}>
                {models.hfToken?.hasToken ? 'Token saved' : 'No token'}
              </span>
            </header>

            <div className="settings-field">
              <div className="settings-field__head">
                <strong>Hugging Face access token</strong>
                <span>
                  {models.hfToken?.hasToken
                    ? models.hfToken.encrypted
                      ? 'Saved and encrypted on this device.'
                      : 'Saved in the app data folder on this device.'
                    : 'Only needed for gated models (Phonon 40M, OpenAudio S1-mini).'}
                </span>
              </div>
              <div className="path-row">
                <input
                  className="input input--mono"
                  type="password"
                  value={hfDraft}
                  onChange={(event) => setHfDraft(event.target.value)}
                  placeholder={models.hfToken?.hasToken ? 'Paste a new token to replace the saved one' : 'hf_…'}
                  spellCheck={false}
                  disabled={hfBusy}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveHf(hfDraft);
                  }}
                />
                <button className="btn btn--subtle btn--sm" onClick={() => void saveHf(hfDraft)} disabled={!hfDraft.trim() || hfBusy}>
                  {hfBusy ? 'Checking…' : 'Save token'}
                </button>
                {models.hfToken?.hasToken && (
                  <button className="btn btn--subtle btn--sm" onClick={() => void saveHf('')} disabled={hfBusy}>
                    Remove
                  </button>
                )}
              </div>
              <p className="field__hint">
                Accept the model’s terms on its Hugging Face page, then create a read token at{' '}
                <button className="link" onClick={() => void window.studio.openExternal('https://huggingface.co/settings/tokens')}>
                  huggingface.co/settings/tokens <Icon name="external" size={11} />
                </button>
                . The token is checked once with Hugging Face and then only sent to huggingface.co when a gated model
                downloads. It is never passed to a model after its first successful start.
              </p>
            </div>

            <div className="settings-field">
              <div className="settings-field__head">
                <strong>Reference voices for local cloning</strong>
                <span>Used by Qwen3-TTS, IndexTTS2, XTTS, Chatterbox and the other local cloning models.</span>
              </div>
              <div className="path-row">
                <button className="btn btn--ghost btn--sm" onClick={() => void window.studio.models.openReferences()}>
                  <Icon name="folderOpen" size={14} /> Open references folder
                </button>
              </div>
              <p className="field__hint">
                Add a clean 5–15 second recording (WAV, FLAC or MP3) and, ideally, a .txt file with the same name containing
                its exact transcript. Reload the model and the clip appears in the voice picker. Only use voices you have
                permission to clone; nothing leaves this computer.
              </p>
            </div>
          </section>

          <IntegrationsCard />

          <section className="card settings-card">
            <header className="settings-card__head">
              <span className="settings-card__icon">
                <Icon name="mic" size={17} />
              </span>
              <div>
                <h2>Pronunciation dictionary</h2>
                <p>Teach Phonon names, brands and acronyms. Whole words only, case-insensitive.</p>
              </div>
              <button className="btn btn--subtle btn--sm" onClick={addPronunciation}>
                <Icon name="plus" size={14} /> Add rule
              </button>
            </header>

            {settings.pronunciations.length ? (
              <div className="pronunciation-list">
                <div className="pronunciation-row pronunciation-row--head">
                  <span>Say this</span>
                  <span>As</span>
                  <span />
                </div>
                {settings.pronunciations.map((rule, index) => (
                  <div className="pronunciation-row" key={index}>
                    <input
                      className="input"
                      value={rule.from}
                      placeholder="e.g. GIF"
                      onChange={(event) => updatePronunciation(index, { from: event.target.value })}
                    />
                    <input
                      className="input"
                      value={rule.to}
                      placeholder="e.g. jiff"
                      onChange={(event) => updatePronunciation(index, { to: event.target.value })}
                    />
                    <button
                      className="btn btn--icon btn--ghost btn--danger-text"
                      onClick={() => removePronunciation(index)}
                      aria-label="Remove rule"
                      title="Remove rule"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pronunciation-empty">
                <Icon name="mic" size={22} />
                <div>
                  <strong>No rules yet</strong>
                  <span>Add one to fix a name like “Ahmed”, “Nginx” or “X Æ A-12”.</span>
                </div>
              </div>
            )}

            <div className="pronunciation-preview">
              <span>Preview</span>
              <p>{pronunciationSample.source}</p>
              <Icon name="arrowRight" size={15} />
              <p className="is-result">{pronunciationSample.result}</p>
              {pronunciationSample.applied > 0 && <em>{pluralize(pronunciationSample.applied, 'replacement')}</em>}
            </div>
          </section>

          <section className="card settings-card">
            <header className="settings-card__head">
              <span className="settings-card__icon">
                <Icon name="downloadCloud" size={17} />
              </span>
              <div>
                <h2>Model &amp; storage</h2>
                <p>Everything lives in your user data folder.</p>
              </div>
              <button className="btn btn--subtle btn--sm" onClick={() => void verifyFiles()} disabled={verifying}>
                <Icon name={verifying ? 'loader' : 'checkCircle'} size={14} className={verifying ? 'spin' : undefined} />
                {verifying ? 'Verifying…' : 'Verify files'}
              </button>
            </header>

            <div className="model-files">
              {Object.entries(model?.files || {}).map(([name, file]) => (
                <div key={name} className={classNames('model-file', file.exists ? 'is-ready' : 'is-missing')}>
                  <Icon name={file.exists ? 'checkCircle' : 'xCircle'} size={15} />
                  <span className="model-file__name">{name}</span>
                  {file.quality && <em className="tag">{file.quality.toUpperCase()}</em>}
                  <span className="model-file__size">{file.exists ? formatBytes(file.bytes) : file.bytes ? `Incomplete · ${formatBytes(file.bytes)}` : 'Not downloaded'}</span>
                </div>
              ))}
            </div>

            <div className="settings-button-row">
              <button className="btn btn--subtle btn--sm" onClick={() => void importFiles()}>
                <Icon name="folderOpen" size={14} /> Import files…
              </button>
              <button className="btn btn--subtle btn--sm" onClick={() => void window.studio.paths.reveal('models')}>
                <Icon name="folder" size={14} /> Model folder
              </button>
              <button className="btn btn--subtle btn--sm" onClick={() => void window.studio.paths.reveal('voices')}>
                <Icon name="voices" size={14} /> Voice folder
              </button>
              <button className="btn btn--danger-text btn--sm" onClick={() => void removeModel()} disabled={clearing === 'model'}>
                <Icon name={clearing === 'model' ? 'loader' : 'trash'} size={14} className={clearing === 'model' ? 'spin' : undefined} />
                Remove model
              </button>
              <button className="btn btn--danger-text btn--sm" onClick={() => void removeVoices()} disabled={clearing === 'voices' || !model?.voicesDownloaded}>
                <Icon name={clearing === 'voices' ? 'loader' : 'trash'} size={14} className={clearing === 'voices' ? 'spin' : undefined} />
                Delete voices
              </button>
            </div>

            <div className="storage">
              <div className="storage__bar">
                {storageParts.map((part) => (
                  <span
                    key={part.label}
                    className={classNames('storage__segment', part.className)}
                    style={{ width: `${storageTotal ? Math.max(1.5, (part.value / storageTotal) * 100) : 0}%` }}
                    title={`${part.label}: ${formatBytes(part.value)}`}
                  />
                ))}
              </div>
              <div className="storage__legend">
                {storageParts.map((part) => (
                  <span key={part.label}>
                    <em className={classNames('dot', part.className)} />
                    {part.label} <strong>{formatBytes(part.value)}</strong>
                  </span>
                ))}
                <span className="storage__free">
                  {storage?.freeDisk != null ? `${formatBytes(storage.freeDisk)} free` : '—'}
                </span>
              </div>
              <p className="storage__total">
                <Icon name="folder" size={13} /> {formatBytes(storageTotal)} used · {pluralize(storage?.audio.files || 0, 'recording')} ·{' '}
                {model?.voicesDownloaded || 0} voices installed
              </p>
            </div>
          </section>

          <section className="card settings-card settings-card--about">
            <header className="settings-card__head">
              <span className="settings-card__icon">
                <Icon name="info" size={17} />
              </span>
              <div>
                <h2>About</h2>
                <p>Voxarium {info?.version || ''} · local text-to-speech</p>
              </div>
            </header>
            <div className="about-grid">
              <div>
                <span>Model</span>
                <strong>{activeModel.name}</strong>
                <em>{activeModel.repo}</em>
              </div>
              <div>
                <span>Engine</span>
                <strong>{activeModel.runtimeLabel.split(' · ')[0]}</strong>
                <em>{activeModel.family}</em>
              </div>
              <div>
                <span>Electron</span>
                <strong>{info?.electron || '—'}</strong>
                <em>Chromium {info?.chrome || '—'}</em>
              </div>
              <div>
                <span>Platform</span>
                <strong>{info ? `${info.platform} · ${info.arch}` : '—'}</strong>
                <em>Node {info?.node || '—'}</em>
              </div>
            </div>
            <div className="about-links">
              <button className="btn btn--subtle btn--sm" onClick={() => void window.studio.openExternal(`https://huggingface.co/${activeModel.repo}`)}>
                <Icon name="external" size={14} /> Model card
              </button>
              <button className="btn btn--subtle btn--sm" onClick={() => void window.studio.openExternal(activeModel.license.url)}>
                <Icon name="external" size={14} /> License
              </button>
              {activeModel.runtime === 'phonon' && (
                <button className="btn btn--subtle btn--sm" onClick={() => void window.studio.openExternal('https://github.com/gradium-ai/xn-ptts')}>
                  <Icon name="external" size={14} /> Runtime source
                </button>
              )}
              <button className="btn btn--subtle btn--sm" onClick={() => void window.studio.paths.reveal('data')}>
                <Icon name="folder" size={14} /> Data folder
              </button>
            </div>
            <p className="about-fineprint">
              {activeModel.name} is licensed {activeModel.license.id}. Audio is generated entirely on this device — no scripts, audio or usage data
              are sent anywhere.
            </p>
          </section>
        </div>

        <aside className="settings-side">
          <section className="card settings-side__card">
            <h3>At a glance</h3>
            <dl className="settings-side__list">
              <div>
                <dt>Model</dt>
                <dd>{model?.installed ? 'Installed' : 'Not installed'}</dd>
              </div>
              <div>
                <dt>Precision</dt>
                <dd>{settings.quality.toUpperCase()}</dd>
              </div>
              <div>
                <dt>Device</dt>
                <dd>{engine.info ? (engine.info.device === 'webgpu' ? 'WebGPU' : 'CPU') : '—'}</dd>
              </div>
              <div>
                <dt>Threads</dt>
                <dd>{engine.info?.threads ?? '—'}</dd>
              </div>
              <div>
                <dt>Voices on disk</dt>
                <dd>{model?.voicesDownloaded || 0}</dd>
              </div>
              <div>
                <dt>Recordings</dt>
                <dd>{storage?.audio.files || 0}</dd>
              </div>
              <div>
                <dt>Library</dt>
                <dd>{formatBytes(storageTotal)}</dd>
              </div>
            </dl>
            <button className="btn btn--subtle btn--sm settings-side__cta" onClick={onOpenSetup}>
              <Icon name="sparkles" size={14} /> Open setup assistant
            </button>
          </section>

          <section className="card settings-side__card settings-side__card--tip">
            <span className="settings-side__icon">
              <Icon name="key" size={18} />
            </span>
            <h3>Reproducible takes</h3>
            <p>
              The same script, voice, temperature and seed always produce the same waveform. Lock a seed when you need a
              consistent character across sessions.
            </p>
          </section>

          <section className="card settings-side__card settings-side__card--tip">
            <span className="settings-side__icon">
              <Icon name="shield" size={18} />
            </span>
            <h3>Private by design</h3>
            <p>
              Model weights are fetched once from Hugging Face. After that the studio works offline — generation never leaves
              this machine.
            </p>
            <button className="link" onClick={() => void window.studio.paths.reveal('data')}>
              Open data folder <Icon name="external" size={12} />
            </button>
          </section>
        </aside>
      </div>

      <p className="page-footer-note">
        <Icon name="info" size={13} />
        Phonon 31M is a 31-million-parameter English checkpoint built on Pocket TTS and Mimi, released under Apache-2.0.
      </p>
    </div>
  );
}

// Model download progress is keyed by `${kind}:${file}` in the studio context.
function downloadsFor(
  downloads: Record<string, { loaded: number; total: number; percent: number | null; done?: boolean; cached?: boolean }>,
  quality: Quality,
): number | null {
  const file = quality === 'f32' ? 'model.safetensors' : 'model.q8.gguf';
  const progress = downloads[`model:${file}`];
  if (!progress) return null;
  if (progress.done || progress.cached) return 100;
  if (progress.percent != null) return progress.percent;
  if (progress.total > 0) return Math.min(100, (progress.loaded / progress.total) * 100);
  return null;
}
