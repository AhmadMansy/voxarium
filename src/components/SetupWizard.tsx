import { useEffect, useMemo, useState } from 'react';
import type { Quality } from '../types';
import { useStudio } from '../state';
import { formatBytes, formatDuration } from '../lib/utils';
import { Icon } from './Icons';

interface SetupWizardProps {
  open: boolean;
  onClose: () => void;
}

const BASE_FILES = ['config.json', 'tokenizer.json', 'default-voice.safetensors'];

export function SetupWizard({ open, onClose }: SetupWizardProps) {
  const {
    info,
    settings,
    model,
    engine,
    downloads,
    downloadModelBusy,
    downloadModel,
    cancelDownloads,
    refreshModel,
    refreshStorage,
    updateSettings,
    toast,
  } = useStudio();

  const [quality, setQuality] = useState<Quality>(settings?.quality === 'f32' ? 'f32' : 'q8');
  const [started, setStarted] = useState(false);

  const installed = Boolean(model?.installed);
  const ready = installed && engine.status === 'ready';

  useEffect(() => {
    if (!open) return;
    if (ready) setStarted(false);
  }, [open, ready]);

  useEffect(() => {
    if (!installed || !model) return;
    if (!model.q8Ready && model.f32Ready) setQuality('f32');
    if (model.q8Ready) setQuality((current) => (current === 'f32' && model.f32Ready ? 'f32' : 'q8'));
  }, [installed, model?.q8Ready, model?.f32Ready]);

  const names = useMemo(
    () => [...BASE_FILES, quality === 'f32' ? 'model.safetensors' : 'model.q8.gguf'],
    [quality],
  );

  const totals = useMemo(() => {
    let total = 0;
    let loaded = 0;
    for (const name of names) {
      const size = info?.model.files[name]?.size || model?.files[name]?.size || 0;
      total += size;
      const progress = downloads[`model:${name}`];
      loaded += Math.min(size, progress?.loaded || 0);
    }
    return { total, loaded, percent: total ? Math.min(100, (loaded / total) * 100) : 0 };
  }, [downloads, info, model, names]);

  const activeFile = useMemo(() => {
    const entries = Object.values(downloads).filter((item) => item.kind === 'model' && !item.done);
    entries.sort((a, b) => (b.at || 0) - (a.at || 0));
    return entries[0]?.file || null;
  }, [downloads]);

  if (!open) return null;

  const beginDownload = async () => {
    setStarted(true);
    const ok = await downloadModel(quality);
    if (!ok) setStarted(false);
  };

  const handleCancel = () => {
    setStarted(false);
    void cancelDownloads();
  };

  const handleImport = async () => {
    try {
      const result = await window.studio.model.importFolder();
      if (result.cancelled) return;
      if (!result.ok) {
        toast('Those model files could not be used.', 'error', result.error);
        return;
      }
      const status = await refreshModel();
      await refreshStorage();
      const nextQuality: Quality = status?.f32Ready && !status?.q8Ready ? 'f32' : 'q8';
      setQuality(nextQuality);
      updateSettings({ quality: nextQuality, setupComplete: true });
      toast('Model files imported.', 'success');
    } catch (error) {
      toast('The model folder could not be opened.', 'error', error instanceof Error ? error.message : String(error));
    }
  };

  const finish = () => {
    updateSettings({ setupComplete: true, onboardingDismissed: true });
    onClose();
  };

  const dismiss = () => {
    updateSettings({ onboardingDismissed: true });
    onClose();
    if (!installed) toast('You can finish setup any time from the sidebar.', 'info');
  };

  const qualityOptions: { id: Quality; label: string; note: string; size: number }[] = [
    {
      id: 'q8',
      label: 'Compact',
      note: 'Quantized weights. Fastest start, ideal for laptops.',
      size: info?.model.files['model.q8.gguf']?.size || 64512352,
    },
    {
      id: 'f32',
      label: 'Full precision',
      note: 'Unquantized weights for the most faithful detail.',
      size: info?.model.files['model.safetensors']?.size || 102823920,
    },
  ];

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
              Speech,
              <br />
              without the cloud.
            </h1>
            <p>
              Phonon 31M turns writing into natural speech right here on your PC. No account, no uploads, no
              usage limits.
            </p>
          </div>
          <ul className="wizard__features">
            <li>
              <Icon name="cpu" size={15} /> Runs locally on CPU or GPU
            </li>
            <li>
              <Icon name="voices" size={15} /> 100+ expressive voices
            </li>
            <li>
              <Icon name="wave" size={15} /> Streaming 24 kHz audio
            </li>
            <li>
              <Icon name="shield" size={15} /> Nothing leaves your machine
            </li>
          </ul>
          <div className="wizard__privacy">
            <Icon name="shield" size={14} />
            <span>Your scripts and audio stay in your own folders.</span>
          </div>
        </aside>

        <section className="wizard__panel">
          <button className="wizard__close" onClick={dismiss} aria-label="Close setup">
            <Icon name="x" size={18} />
          </button>

          {ready ? (
            <div className="setup-done">
              <span className="setup-done__icon">
                <Icon name="check" size={30} />
              </span>
              <h2>Ready to speak</h2>
              <p className="setup-done__lead">
                Phonon 31M is loaded and listening. Write something in the studio, pick a voice, and generate.
              </p>
              <div className="setup-done__grid">
                <div>
                  <span>Device</span>
                  <strong>{engine.info?.device === 'webgpu' ? 'WebGPU' : 'CPU'}</strong>
                </div>
                <div>
                  <span>Threads</span>
                  <strong>{engine.info?.threads ?? 1}</strong>
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
              <p className="setup-done__hint">Tip: press ⌘/Ctrl + Enter in the studio to generate.</p>
            </div>
          ) : engine.status === 'error' && installed ? (
            <div className="setup-error">
              <span className="setup-error__icon">
                <Icon name="alert" size={24} />
              </span>
              <h2>The engine could not start</h2>
              <p>The model is installed, but the local WebAssembly runtime ran into a problem.</p>
              <pre>{engine.error}</pre>
              <div className="setup-error__actions">
                <button className="btn btn--primary" onClick={() => void engine.reload()}>
                  <Icon name="refresh" size={16} /> Try again
                </button>
                <button className="btn btn--subtle" onClick={dismiss}>
                  Continue anyway
                </button>
              </div>
            </div>
          ) : installed ? (
            <div className="setup-loading">
              <span className="setup-loading__spinner">
                <Icon name="loader" size={30} />
              </span>
              <h2>Warming up the engine</h2>
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
          ) : started && downloadModelBusy ? (
            <div className="setup-progress">
              <div className="setup-progress__head">
                <div>
                  <span className="setup-progress__label">Downloading Phonon 31M</span>
                  <strong>{formatBytes(totals.loaded)} <span>of {formatBytes(totals.total)}</span></strong>
                </div>
                <span className="setup-progress__pct">{Math.round(totals.percent)}%</span>
              </div>
              <div className="progress progress--lg">
                <span style={{ width: `${totals.percent}%` }} />
              </div>
              <p className="setup-progress__file">
                {activeFile ? `Fetching ${activeFile}…` : 'Connecting to the model mirror…'}
              </p>
              <ul className="file-list">
                {names.map((name) => {
                  const progress = downloads[`model:${name}`];
                  const size = info?.model.files[name]?.size || 0;
                  const done = Boolean(progress && (progress.cached || progress.loaded >= size)) || Boolean(model?.files[name]?.exists);
                  const active = !done && progress && progress.loaded > 0;
                  return (
                    <li key={name} className={done ? 'is-done' : active ? 'is-active' : undefined}>
                      <Icon name={done ? 'checkCircle' : active ? 'loader' : 'clock'} size={15} />
                      <span>{name}</span>
                      <em>{done ? formatBytes(size) : active ? formatBytes(progress?.loaded || 0) : 'Waiting'}</em>
                    </li>
                  );
                })}
              </ul>
              <button className="btn btn--subtle" onClick={handleCancel}>
                <Icon name="x" size={15} /> Cancel download
              </button>
              <p className="setup-progress__note">Keep this window open. The download resumes if you retry.</p>
            </div>
          ) : (
            <div className="setup-options">
              <span className="setup-step">Step 1 of 1</span>
              <h2>Set up Phonon 31M</h2>
              <p className="setup-options__lead">
                A compact, high-quality speech model. Choose a weight format — you can switch later in settings.
              </p>

              <div className="quality-picker">
                {qualityOptions.map((option) => {
                  const isReady = option.id === 'f32' ? model?.f32Ready : model?.q8Ready;
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
                          {option.id === 'q8' && <em>Recommended</em>}
                          {isReady && (
                            <em className="is-ready">
                              <Icon name="check" size={11} /> On disk
                            </em>
                          )}
                        </span>
                        <span className="quality-card__note">{option.note}</span>
                        <span className="quality-card__size">{formatBytes(option.size)} one-time download</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <button className="btn btn--primary btn--lg setup-options__cta" onClick={() => void beginDownload()}>
                <Icon name="download" size={18} />
                Download & install
              </button>

              <div className="setup-options__or">
                <span />
                <em>or</em>
                <span />
              </div>

              <button className="btn btn--subtle setup-options__import" onClick={() => void handleImport()}>
                <Icon name="folderOpen" size={16} />
                Use model files I already have
              </button>

              <p className="setup-options__legal">
                Model by <button onClick={() => void window.studio.openExternal('https://huggingface.co/gradium/phonon-31m-en')}>Gradium</button> · Apache-2.0 · 24 kHz mono
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
