import { useEffect, useMemo, useState } from 'react';
import type { Quality } from '../types';
import { useStudio } from '../state';
import { classNames, formatBytes, formatDuration } from '../lib/utils';
import { Icon } from './Icons';
import { MODELS, defaultQualityFor, modelFiles, qualitiesFor } from '../models/registry';
import { assessFit, fitTone, modelRating } from '../models/fit';
import {
  licenseAcknowledged,
  licenseBadge,
  licenseSummary,
  requiresLicenseAck,
} from '../models/license';
import { modelHasArabic, qualityOptions } from '../models/compat';
import type { ModelManifest } from '../models/types';

interface SetupWizardProps {
  open: boolean;
  onClose: () => void;
}

type WizardStep = 'choose' | 'configure';

/** A runtime that is installed, or that Install can download or build first. */
function runtimeInstallable(readiness: { ready: boolean; available: boolean }): boolean {
  return readiness.ready || readiness.available;
}

function runtimeReady(model: ModelManifest, ready: boolean): boolean {
  return ready && model.files.length > 0;
}

function runtimeLabel(model: ModelManifest, installed: boolean, ready: boolean): string {
  if (installed) return 'Installed';
  if (!ready) return 'Runtime pack missing';
  if (!model.files.length) return 'No verified files';
  return 'Ready to install';
}

function runtimeTone(model: ModelManifest, installed: boolean, ready: boolean): string {
  if (installed) return 'ok';
  if (!runtimeReady(model, ready)) return 'muted';
  return 'accent';
}

export function SetupWizard({ open, onClose }: SetupWizardProps) {
  const {
    settings,
    model,
    models,
    setPage,
    engine,
    updateSettings,
    toast,
  } = useStudio();

  const [step, setStep] = useState<WizardStep>('choose');
  const [selectedId, setSelectedId] = useState(models.activeModel.id);
  const [quality, setQuality] = useState<Quality>(defaultQualityFor(models.activeModel));
  const [started, setStarted] = useState(false);
  const [activating, setActivating] = useState(false);
  const [query, setQuery] = useState('');
  const [showFit, setShowFit] = useState(false);

  const selectedModel = useMemo(
    () => MODELS.find((entry) => entry.id === selectedId) || models.activeModel,
    [selectedId, models.activeModel],
  );
  const selectedStatus = models.statusFor(selectedModel.id);
  const selectedInstalled = selectedStatus.installed;
  const isActive = selectedModel.id === models.activeModel.id;
  const activeInstall = Boolean(model?.installed);
  const progress = models.progress[selectedModel.id];
  const busy = models.busyId === selectedModel.id;
  const ack = licenseAcknowledged(selectedModel, models.acks);
  const selectedRuntime = models.runtimeFor(selectedModel.id);
  const canInstallRuntime = runtimeReady(selectedModel, runtimeInstallable(selectedRuntime));
  const fit = assessFit(selectedModel, models.hardware);
  const rating = modelRating(selectedModel);
  const badge = licenseBadge(selectedModel.license);
  const options = qualityOptions(selectedModel);
  const files = modelFiles(selectedModel, quality);
  const ready = isActive && selectedInstalled && engine.status === 'ready';
  const loading =
    activating || (isActive && selectedInstalled && engine.status !== 'ready' && engine.status !== 'error');
  const failed = isActive && selectedInstalled && engine.status === 'error';
  const downloading = started || (busy && !selectedInstalled);

  const visibleModels = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return MODELS;
    return MODELS.filter((entry) => {
      const haystack = [
        entry.name,
        entry.shortName,
        entry.family,
        entry.runtimeLabel,
        entry.description,
        ...entry.languages.map((language) => language.name),
        ...entry.tags,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setStep('choose');
    setStarted(false);
    setActivating(false);
    setQuery('');
    setShowFit(false);
    setSelectedId(models.activeModel.id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const status = models.statusFor(selectedId);
    const available = qualitiesFor(selectedModel);
    const installed = available.filter((entry) => status.qualities.includes(entry));
    setQuality(installed[0] || defaultQualityFor(selectedModel));
  }, [open, selectedId]);

  if (!open) return null;

  const choose = (id: string) => {
    setSelectedId(id);
    setStarted(false);
    setShowFit(false);
  };

  const accept = async (): Promise<boolean> => {
    if (!requiresLicenseAck(selectedModel)) return true;
    const confirmed = await window.studio.ui.confirm({
      title: `Acknowledge ${selectedModel.license.name}`,
      message: licenseSummary(selectedModel),
      detail:
        'You are responsible for following this license. Voxarium will never activate this model silently, and you can review the terms before you continue.',
      confirmLabel: 'I acknowledge',
    });
    if (!confirmed) return false;
    const ok = await models.acknowledge(selectedModel.id);
    if (ok) toast('License acknowledged.', 'success', selectedModel.license.name);
    return ok;
  };

  const openModelLibrary = () => {
    updateSettings({ onboardingDismissed: true });
    onClose();
    setPage('models');
  };

  const activateInstalled = async (id: string) => {
    setActivating(true);
    try {
      return await models.activate(id);
    } finally {
      setActivating(false);
    }
  };

  const beginDownload = async () => {
    if (!canInstallRuntime) {
      toast(selectedRuntime.reason || 'This model has no installable runtime yet.', 'info');
      return;
    }
    if (!ack) {
      const accepted = await accept();
      if (!accepted) return;
    }
    setStarted(true);
    const ok = await models.download(selectedModel.id, quality);
    setStarted(false);
    if (!ok) return;
    updateSettings({ setupComplete: true, quality });
    if (selectedModel.id !== models.activeModel.id) {
      await activateInstalled(selectedModel.id);
    }
  };

  const handleImport = async () => {
    if (!canInstallRuntime) {
      toast(selectedRuntime.reason || 'This model has no importable runtime yet.', 'info');
      return;
    }
    if (!ack) {
      const accepted = await accept();
      if (!accepted) return;
    }
    const ok = await models.importFolder(selectedModel.id);
    if (!ok) return;
    updateSettings({ setupComplete: true });
    if (selectedModel.id !== models.activeModel.id) {
      await activateInstalled(selectedModel.id);
    }
  };

  const activateSelected = async () => {
    const ok = await activateInstalled(selectedModel.id);
    if (ok) updateSettings({ setupComplete: true });
  };

  const finish = () => {
    updateSettings({ setupComplete: true, onboardingDismissed: true });
    onClose();
  };

  const dismiss = () => {
    updateSettings({ onboardingDismissed: true });
    onClose();
    if (!activeInstall) toast('You can finish setup any time from the sidebar.', 'info');
  };

  const percent = progress?.percent ?? (progress && progress.total ? (progress.loaded / progress.total) * 100 : 0);

  return (
    <div className="wizard-backdrop">
      <div className="wizard" role="dialog" aria-modal="true" aria-label="Set up Voxarium">
        <aside className="wizard__brand">
          <div className="brand brand--lg">
            <span className="brand__mark">
              <Icon name="audioLines" size={22} />
            </span>
            <span className="brand__name">Voxarium</span>
          </div>
          <div className="wizard__hero">
            <span className="wizard__tag">
              <Icon name="zap" size={12} /> On-device voice
            </span>
            <h1>
              Pick a voice
              <br />
              engine.
            </h1>
            <p>
              Voxarium ships with a registry of {MODELS.length} speech models. Choose what to install now — every model
              stays visible, even when its runtime pack is not ready yet.
            </p>
          </div>
          <ul className="wizard__features">
            <li>
              <Icon name="cpu" size={15} /> Runs locally on CPU or GPU
            </li>
            <li>
              <Icon name="layers" size={15} /> {MODELS.length} models in the registry
            </li>
            <li>
              <Icon name="shield" size={15} /> Licenses shown before install
            </li>
            <li>
              <Icon name="checkCircle" size={15} /> SHA-256 verified downloads
            </li>
          </ul>
          <div className="wizard__privacy">
            <Icon name="shield" size={14} />
            <span>Nothing is downloaded or activated silently.</span>
          </div>
        </aside>

        <section className="wizard__panel">
          <button className="wizard__close" onClick={dismiss} aria-label="Close setup">
            <Icon name="x" size={18} />
          </button>

          {step === 'choose' ? (
            <div className="setup-picker">
              <span className="setup-step">Step 1 of 2 · Choose a model</span>
              <div className="setup-picker__head">
                <div>
                  <h2>Which engine should Voxarium use?</h2>
                  <p className="setup-options__lead">
                    All {MODELS.length} models are listed with their license, hardware fit and runtime status. You can
                    change this later in Models.
                  </p>
                </div>
                <div className="setup-picker__count">
                  <strong>{visibleModels.length}</strong>
                  <span>of {MODELS.length}</span>
                </div>
              </div>

              <label className="setup-picker__search">
                <Icon name="search" size={15} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by model, language or capability…"
                  aria-label="Search models"
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                    <Icon name="x" size={13} />
                  </button>
                )}
              </label>

              <div className="setup-picker__list" role="listbox" aria-label="Available models">
                {visibleModels.map((entry) => {
                  const status = models.statusFor(entry.id);
                  const entryFit = assessFit(entry, models.hardware);
                  const entryRating = modelRating(entry);
                  const entryBadge = licenseBadge(entry.license);
                  const selected = entry.id === selectedModel.id;
                  const active = entry.id === models.activeModel.id;
                  const label = runtimeLabel(entry, status.installed, runtimeInstallable(models.runtimeFor(entry.id)));
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={classNames(
                        'setup-model-option',
                        selected && 'is-selected',
                        active && 'is-active',
                        !runtimeReady(entry, runtimeInstallable(models.runtimeFor(entry.id))) && !status.installed && 'is-gated',
                      )}
                      onClick={() => choose(entry.id)}
                      data-model-id={entry.id}
                    >
                      <span className="setup-model-option__mark">
                        <Icon
                          name={entry.runtime === 'phonon' ? 'waveform' : entry.runtime === 'onnx-web' ? 'cpu' : 'layers'}
                          size={16}
                        />
                      </span>
                      <span className="setup-model-option__body">
                        <span className="setup-model-option__title">
                          <strong>{entry.shortName}</strong>
                          {active && <em className="tag tag--accent">Active</em>}
                          <em className={classNames('tag', `tag--${runtimeTone(entry, status.installed, runtimeInstallable(models.runtimeFor(entry.id)))}`)}>
                            {label}
                          </em>
                          {!entry.license.commercial && <em className="tag tag--warn">Non-commercial</em>}
                        </span>
                        <span className="setup-model-option__meta">
                          {entry.family} · {entry.runtimeLabel} · {entry.languages.length} language
                          {entry.languages.length === 1 ? '' : 's'}
                          {modelHasArabic(entry) ? ' · Arabic' : ''}
                        </span>
                        <span className="setup-model-option__tags">
                          <span className={classNames('tag', `tag--${fitTone(entryFit.level)}`)} title={entryFit.summary}>
                            <Icon name="thermometer" size={11} /> {entryFit.label}
                          </span>
                          <span className={classNames('tag', `tag--${entryBadge.tone}`)} title={entryBadge.title}>
                            {entryBadge.label}
                          </span>
                          <span className="setup-model-option__score">
                            {entryRating.score}/10 · {entryRating.label}
                          </span>
                        </span>
                      </span>
                      <span className="setup-model-option__radio" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>

              {!visibleModels.length && (
                <div className="setup-picker__empty">
                  <Icon name="search" size={20} />
                  <strong>No models match “{query}”</strong>
                  <span>Try a name, language or capability.</span>
                </div>
              )}

              <div className="setup-picker__footer">
                <div className="setup-picker__selection">
                  <span>Selected</span>
                  <strong>{selectedModel.shortName}</strong>
                  <em>{runtimeLabel(selectedModel, selectedInstalled, selectedRuntime.ready)}</em>
                </div>
                <button
                  className="btn btn--primary btn--lg setup-picker__continue"
                  onClick={() => setStep('configure')}
                  disabled={!visibleModels.length}
                >
                  Continue
                  <Icon name="arrowRight" size={17} />
                </button>
              </div>

              <button className="setup-options__later" onClick={dismiss}>
                Set up later
              </button>
            </div>
          ) : ready ? (
            <div className="setup-done">
              <span className="setup-done__icon">
                <Icon name="check" size={30} />
              </span>
              <h2>Ready to speak</h2>
              <p className="setup-done__lead">
                {selectedModel.shortName} is loaded and listening. Write something in the studio, pick a voice, and
                generate.
              </p>
              <div className="setup-done__grid">
                <div>
                  <span>Model</span>
                  <strong>{selectedModel.shortName}</strong>
                </div>
                <div>
                  <span>Device</span>
                  <strong>{engine.info?.device === 'webgpu' ? 'WebGPU' : 'CPU'}</strong>
                </div>
                <div>
                  <span>Precision</span>
                  <strong>{settings?.quality === 'f32' ? 'F32' : 'Q8'}</strong>
                </div>
                <div>
                  <span>Load time</span>
                  <strong>{formatDuration((engine.info?.loadMs || 0) / 1000)}</strong>
                </div>
              </div>
              <button className="btn btn--primary btn--lg setup-done__cta" onClick={finish}>
                Start creating
                <Icon name="arrowRight" size={17} />
              </button>
              <button className="setup-options__later" onClick={() => setStep('choose')}>
                Pick a different model
              </button>
              <p className="setup-done__hint">Tip: press Ctrl/⌘ + Enter in the studio to generate.</p>
            </div>
          ) : failed ? (
            <div className="setup-error">
              <span className="setup-error__icon">
                <Icon name="alert" size={24} />
              </span>
              <h2>{selectedModel.shortName} could not start</h2>
              <p>The model files are installed, but the local runtime ran into a problem.</p>
              <pre>{engine.error}</pre>
              <div className="setup-error__actions">
                <button className="btn btn--primary" onClick={() => void engine.reload()}>
                  <Icon name="refresh" size={16} /> Try again
                </button>
                <button className="btn btn--subtle" onClick={() => setStep('choose')}>
                  Choose another model
                </button>
                <button className="btn btn--ghost" onClick={dismiss}>
                  Continue anyway
                </button>
              </div>
            </div>
          ) : loading ? (
            <div className="setup-loading">
              <span className="setup-loading__spinner">
                <Icon name="loader" size={30} />
              </span>
              <h2>Warming up {selectedModel.shortName}</h2>
              <p>{engine.stage || 'Preparing the local runtime…'}</p>
              <div className="setup-loading__bar">
                <span />
                <span />
                <span />
              </div>
              <div className="setup-loading__meta">
                <span>
                  <Icon name="cpu" size={13} /> {settings?.quality === 'f32' ? 'F32 weights' : 'Q8 weights'}
                </span>
                <span>
                  <Icon name="shield" size={13} /> Loaded from disk
                </span>
              </div>
            </div>
          ) : downloading ? (
            <div className="setup-progress">
              <div className="setup-progress__head">
                <div>
                  <span className="setup-progress__label">Downloading {selectedModel.shortName}</span>
                  <strong>
                    {formatBytes(progress?.loaded || 0)} <span>of {formatBytes(progress?.total || selectedModel.downloadBytes)}</span>
                  </strong>
                </div>
                <span className="setup-progress__pct">{Math.round(progress?.percent ?? percent)}%</span>
              </div>
              <div className="progress progress--lg">
                <span style={{ width: `${Math.max(1, Math.min(100, progress?.percent ?? percent))}%` }} />
              </div>
              <p className="setup-progress__file">
                {progress?.stage === 'verifying'
                  ? 'Verifying SHA-256 hashes…'
                  : progress?.file
                    ? `Fetching ${progress.file}…`
                    : 'Connecting to the model mirror…'}
              </p>
              <ul className="file-list">
                {files.map((file) => {
                  const state = selectedStatus.files[file.name];
                  const done = Boolean(state?.exists);
                  const activeFile = progress?.file === file.name && !progress?.done;
                  return (
                    <li key={file.name} className={done ? 'is-done' : activeFile ? 'is-active' : undefined}>
                      <Icon name={done ? 'checkCircle' : activeFile ? 'loader' : 'clock'} size={15} />
                      <span>{file.name}</span>
                      <em>{done ? formatBytes(file.size) : activeFile ? formatBytes(progress?.loaded || 0) : 'Waiting'}</em>
                    </li>
                  );
                })}
              </ul>
              <p className="setup-progress__note">
                {progress?.count
                  ? `File ${Math.min(progress.count, (progress.index || 0) + 1)} of ${progress.count} · `
                  : ''}
                Keep this window open. The download resumes if you retry.
              </p>
              <button className="btn btn--subtle" onClick={() => void models.cancel()}>
                <Icon name="x" size={15} /> Cancel download
              </button>
            </div>
          ) : (
            <div className="setup-model-config">
              <button className="setup-model-config__back" onClick={() => setStep('choose')}>
                <Icon name="arrowLeft" size={15} /> Back to model list
              </button>
              <span className="setup-step">Step 2 of 2 · Configure {selectedModel.shortName}</span>
              <div className="setup-model-config__head">
                <div>
                  <h2>{selectedInstalled ? `Use ${selectedModel.shortName}` : `Set up ${selectedModel.shortName}`}</h2>
                  <p className="setup-options__lead">{selectedModel.description}</p>
                </div>
                <span className="score-badge setup-model-config__score" title={`${rating.label} · ${rating.notes}`}>
                  <strong>{rating.score}</strong>
                  <span>/10</span>
                </span>
              </div>

              <div className="setup-model-facts">
                <div>
                  <span>Hardware fit</span>
                  <strong className={`is-${fitTone(fit.level)}`}>
                    <Icon name="thermometer" size={12} /> {fit.label}
                  </strong>
                </div>
                <div>
                  <span>License</span>
                  <strong className={`is-${badge.tone}`}>{badge.label}</strong>
                </div>
                <div>
                  <span>Runtime</span>
                  <strong className={runtimeReady(selectedModel, selectedRuntime.ready) ? 'is-ok' : 'is-muted'}>
                    {selectedModel.runtimeLabel}
                  </strong>
                </div>
                <div>
                  <span>Languages</span>
                  <strong>{selectedModel.languages.length}</strong>
                </div>
              </div>

              <div className="setup-model-config__tags">
                <span className={classNames('tag', `tag--${runtimeTone(selectedModel, selectedInstalled, selectedRuntime.ready)}`)}>
                  <Icon name={selectedInstalled ? 'checkCircle' : 'downloadCloud'} size={11} />
                  {runtimeLabel(selectedModel, selectedInstalled, selectedRuntime.ready)}
                </span>
                <span className={classNames('tag', `tag--${badge.tone}`)} title={badge.title}>
                  <Icon name="shield" size={11} /> {selectedModel.license.name}
                </span>
                {selectedModel.files.length > 0 && (
                  <span className="tag">
                    <Icon name="download" size={11} /> {formatBytes(selectedModel.downloadBytes)} download
                  </span>
                )}
                <button
                  type="button"
                  className="setup-model-config__fit-toggle"
                  onClick={() => setShowFit((value) => !value)}
                  aria-expanded={showFit}
                >
                  <Icon name={showFit ? 'chevronUp' : 'chevronDown'} size={12} /> Why this fit?
                </button>
              </div>

              {showFit && (
                <div className="setup-model-fit">
                  <p>{fit.summary}</p>
                  <ul>
                    {fit.reasons.map((reason, index) => (
                      <li key={index} className={`is-${reason.kind}`}>
                        {reason.text}
                      </li>
                    ))}
                  </ul>
                  <p className="setup-model-fit__langs">
                    {selectedModel.languages.map((language) => language.name).join(' · ')}
                  </p>
                </div>
              )}

              {!canInstallRuntime && (
                <div className="banner banner--warn setup-model-gate">
                  <span className="banner__icon">
                    <Icon name="alert" size={16} />
                  </span>
                  <div className="banner__body">
                    <strong>This model cannot be installed from Setup yet</strong>
                    <span>{selectedRuntime.reason || 'The runtime pack for this model is not bundled yet.'}</span>
                  </div>
                  <button className="btn btn--subtle btn--sm" onClick={openModelLibrary}>
                    <Icon name="layers" size={13} /> Runtime packs
                  </button>
                </div>
              )}

              {requiresLicenseAck(selectedModel) && !ack && (
                <div className="banner banner--warn setup-model-license">
                  <span className="banner__icon">
                    <Icon name="shield" size={16} />
                  </span>
                  <div className="banner__body">
                    <strong>{selectedModel.license.name} needs your acknowledgment</strong>
                    <span>{licenseSummary(selectedModel)}</span>
                  </div>
                  <button className="btn btn--subtle btn--sm" onClick={() => void accept()}>
                    Review
                  </button>
                </div>
              )}

              {options.length > 1 && (
                <div className="quality-picker">
                  {options.map((option) => {
                    const isOnDisk = selectedStatus.qualities.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        className={`quality-card ${quality === option.id ? 'is-selected' : ''}`}
                        onClick={() => setQuality(option.id)}
                        type="button"
                      >
                        <span className="quality-card__radio" />
                        <span className="quality-card__body">
                          <span className="quality-card__title">
                            {option.label}
                            {option.id === selectedModel.defaults.quality && <em>Recommended</em>}
                            {isOnDisk && (
                              <em className="is-ready">
                                <Icon name="check" size={11} /> On disk
                              </em>
                            )}
                          </span>
                          <span className="quality-card__note">{option.note}</span>
                          <span className="quality-card__size">{formatBytes(option.bytes)} one-time download</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedInstalled ? (
                isActive ? (
                  <button className="btn btn--primary btn--lg setup-options__cta" onClick={() => void engine.reload()}>
                    <Icon name="refresh" size={18} /> Reload {selectedModel.shortName}
                  </button>
                ) : (
                  <button
                    className="btn btn--primary btn--lg setup-options__cta"
                    onClick={() => void activateSelected()}
                    disabled={busy}
                  >
                    <Icon name={busy ? 'loader' : 'play'} size={18} className={busy ? 'spin' : undefined} />
                    {busy ? 'Starting…' : `Use ${selectedModel.shortName}`}
                  </button>
                )
              ) : (
                <button
                  className="btn btn--primary btn--lg setup-options__cta"
                  onClick={() => void beginDownload()}
                  disabled={!canInstallRuntime || busy}
                  title={canInstallRuntime ? undefined : selectedRuntime.reason || undefined}
                >
                  <Icon name="download" size={18} />
                  Download &amp; install
                </button>
              )}

              <div className="setup-options__or">
                <span />
                <em>or</em>
                <span />
              </div>

              <button
                className="btn btn--subtle setup-options__import"
                onClick={() => void handleImport()}
                disabled={!canInstallRuntime || busy}
                title={canInstallRuntime ? undefined : selectedRuntime.reason || undefined}
              >
                <Icon name="folderOpen" size={16} />
                Use model files I already have
              </button>

              {!canInstallRuntime && (
                <button className="btn btn--ghost setup-options__import" onClick={openModelLibrary}>
                  <Icon name="layers" size={16} />
                  Manage runtime packs
                </button>
              )}

              <p className="setup-options__legal">
                <button onClick={() => void window.studio.openExternal(`https://huggingface.co/${selectedModel.repo}`)}>
                  {selectedModel.repo}
                </button>{' '}
                ·{' '}
                <button onClick={() => void window.studio.openExternal(selectedModel.license.url)}>
                  {selectedModel.license.id}
                </button>{' '}
                · {selectedModel.revision ? selectedModel.revision.slice(0, 10) : 'no pinned revision'}
              </p>
              <button className="setup-options__later" onClick={dismiss}>
                Set up later
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
