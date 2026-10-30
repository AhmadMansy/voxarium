import { useMemo, useState } from 'react';
import { formatBytes, formatDate } from '../lib/utils';
import { MODELS, defaultQualityFor } from '../models/registry';
import { assessFit, fitTone, modelRating } from '../models/fit';
import {
  canInstallModel,
  licenseAcknowledged,
  licenseBadge,
  licenseSummary,
  requiresLicenseAck,
} from '../models/license';
import {
  arabicVarietiesFor,
  capabilityEnabled,
  capabilityLabel,
  modelHasArabic,
  voicesForModel,
} from '../models/compat';
import type { ModelManifest, RuntimePackState } from '../models/types';
import { useStudio } from '../state';
import { Icon } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { classNames } from '../lib/utils';

const CAPABILITY_ORDER: (keyof ModelManifest['capabilities'])[] = [
  'voiceClone',
  'voiceImport',
  'multiSpeaker',
  'emotion',
  'nonVerbal',
  'streaming',
  'phonemes',
  'speed',
  'seed',
  'watermark',
  'arabic',
];

function lifecycleLabel(model: ModelManifest, installed: boolean, lifecycle: string, runtimeReady: boolean): string {
  if (installed) return 'Installed';
  if (lifecycle === 'downloading') return 'Downloading';
  if (lifecycle === 'verifying') return 'Verifying';
  if (lifecycle === 'update') return 'Update available';
  if (lifecycle === 'error') return 'Needs attention';
  if (!runtimeReady && model.runtime !== 'sidecar') return 'Runtime pack missing';
  if (!model.files.length) return 'Manual install';
  return 'Not installed';
}

function Percent({ value }: { value: number }) {
  return (
    <div className="progress progress--sm model-card__progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(1, Math.min(100, value))}%` }} />
    </div>
  );
}

function RuntimePackCard({ pack }: { pack: RuntimePackState }) {
  const { models } = useStudio();
  const busy = models.runtimeBusyId === pack.id;
  const progress = models.runtimeProgress[pack.id];
  const percent = progress?.percent ?? (progress && progress.total ? (progress.loaded / progress.total) * 100 : null);
  const badge = licenseBadge(pack.license);
  const status = pack.installed ? 'Installed' : pack.available ? 'Not installed' : 'Not published';
  const statusTone = pack.installed ? 'ok' : pack.available ? 'accent' : 'muted';
  const canDownload = pack.available && Boolean(pack.archive || pack.buildable);
  const size = pack.installed ? pack.bytes || pack.installedBytes : pack.sizeBytes;
  const kindLabel = pack.kind === 'python' ? 'Base interpreter' : pack.kind === 'tool' ? 'Installer tool' : 'Model runtime';
  const variantLabel =
    pack.variant && pack.variant !== 'none' ? (pack.variant === 'cpu' ? 'PyTorch CPU' : `PyTorch ${pack.variant.toUpperCase()}`) : null;

  return (
    <article className={classNames('runtime-card', pack.installed && 'is-installed')}>
      <header className="runtime-card__head">
        <div>
          <h3>{pack.name}</h3>
          <span className="runtime-card__meta">
            {kindLabel} · v{pack.version} · {pack.platform}/{pack.arch}
          </span>
        </div>
        <span className={classNames('tag', `tag--${statusTone}`)}>{status}</span>
      </header>

      <p className="runtime-card__desc">{pack.description}</p>

      <div className="runtime-card__chips">
        <span className={classNames('tag', `tag--${badge.tone}`)} title={badge.title}>
          {badge.label}
        </span>
        {size > 0 && <span className="tag tag--muted">{pack.installed ? '' : '~'}{formatBytes(size)}</span>}
        {variantLabel && <span className="tag tag--muted">{variantLabel}</span>}
        {pack.provides.length > 0 && (
          <span className="tag tag--muted">
            {pack.provides.length} model{pack.provides.length === 1 ? '' : 's'}
          </span>
        )}
        {pack.installed && pack.installedAt && (
          <span className="tag tag--muted">Installed {formatDate(pack.installedAt)}</span>
        )}
      </div>

      {!pack.installed && (pack.error || (!canDownload && pack.reason)) && (
        <div className="model-card__notice model-card__notice--warn">
          <Icon name="alert" size={14} />
          <span>{pack.error || pack.reason}</span>
        </div>
      )}

      {progress && !progress.done && (
        <div className="model-card__download">
          <div className="model-card__download-head">
            <span className="model-card__download-label" title={progress.file || undefined}>
              {progress.stage === 'verifying'
                ? 'Verifying SHA-256'
                : progress.stage === 'installing'
                  ? progress.file || 'Installing'
                  : `Downloading ${progress.file || ''}`}
            </span>
            <span>{percent != null ? `${Math.round(percent)}%` : formatBytes(progress.loaded || 0)}</span>
          </div>
          {percent != null && <Percent value={percent} />}
          <button className="btn btn--subtle btn--sm" onClick={() => void models.cancelRuntime()}>
            <Icon name="x" size={13} /> Cancel
          </button>
        </div>
      )}

      <div className="model-card__actions">
        {pack.installed ? (
          <>
            <button className="btn btn--subtle btn--sm" onClick={() => void models.verifyRuntime(pack.id)} disabled={busy}>
              <Icon name="checkCircle" size={14} /> Verify
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => void models.openRuntimeFolder(pack.id)} disabled={busy}>
              <Icon name="folder" size={14} /> Files
            </button>
            <button
              className="btn btn--ghost btn--sm btn--danger-text"
              onClick={() => void models.uninstallRuntime(pack.id)}
              disabled={busy}
            >
              <Icon name="trash" size={14} /> Remove
            </button>
          </>
        ) : (
          <>
            <button
              className="btn btn--primary btn--sm"
              onClick={() => void models.downloadRuntime(pack.id)}
              disabled={busy || !canDownload}
              title={canDownload ? undefined : pack.reason || 'This pack has no published archive yet.'}
            >
              <Icon name={busy ? 'loader' : 'download'} size={14} className={busy ? 'spin' : undefined} />
              {busy
                ? 'Installing…'
                : !canDownload
                  ? 'Not published'
                  : pack.buildable
                    ? `Build · ~${formatBytes(pack.sizeBytes)}`
                    : `Download · ${formatBytes(pack.sizeBytes)}`}
            </button>
            {pack.importable && (
              <button className="btn btn--ghost btn--sm" onClick={() => void models.importRuntime(pack.id)} disabled={busy}>
                <Icon name="folderOpen" size={14} /> Import folder
              </button>
            )}
            {pack.homepage && (
              <a
                className="btn btn--ghost btn--sm"
                href={pack.homepage}
                onClick={(event) => {
                  event.preventDefault();
                  void window.studio.openExternal(pack.homepage as string);
                }}
              >
                <Icon name="external" size={14} /> Source
              </a>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function ModelCard({ model }: { model: ModelManifest }) {
  const { models, updateSettings, toast, setPage } = useStudio();
  const [showLogs, setShowLogs] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const status = models.statusFor(model.id);
  const fit = assessFit(model, models.hardware);
  const rating = modelRating(model);
  const badge = licenseBadge(model.license);
  const ack = licenseAcknowledged(model, models.acks);
  const runtime = models.runtimeFor(model.id);
  const installable = canInstallModel(model, models.acks, runtime);
  const isActive = model.id === models.activeModel.id;
  const busy = models.busyId === model.id;
  const progress = models.progress[model.id];
  const sidecar = models.sidecars[model.id];
  const logs = models.sidecarLogs[model.id] || [];
  const voiceGroup = voicesForModel(model, []);
  const voiceCount = voiceGroup.voices.length;
  const lifecycle = lifecycleLabel(model, status.installed, status.lifecycle, runtime.ready);
  const downloadBytes = model.downloadBytes || model.files.reduce((total, file) => total + file.size, 0);
  const percent = progress?.percent ?? (progress && progress.total ? (progress.loaded / progress.total) * 100 : null);
  // While the runtime is being set up, show whichever pack (uv, Python, the model's
  // environment) is currently installing.
  const runtimePacks = runtime.pack ? [runtime.pack.id, ...runtime.pack.requires] : [];
  const runtimeEvent = runtimePacks
    .map((id) => models.runtimeProgress[id])
    .filter((event) => event && !event.done)
    .sort((a, b) => (b?.at || 0) - (a?.at || 0))[0];
  const runtimeBusy = Boolean(models.runtimeBusyId && runtimePacks.includes(models.runtimeBusyId)) || (busy && Boolean(runtimeEvent));
  const runtimeBytes = runtime.ready || !runtime.pack ? 0 : runtime.pack.sizeBytes;
  const needsToken = Boolean(model.gated && !status.installed && !models.hfToken?.hasToken);

  const accept = async () => {
    const confirmed = await window.studio.ui.confirm({
      title: `Acknowledge ${model.license.name}`,
      message: licenseSummary(model),
      detail:
        'You are responsible for following this license. Voxarium will never activate this model silently, and you can review the terms before you continue.',
      confirmLabel: 'I acknowledge',
    });
    if (!confirmed) return;
    const ok = await models.acknowledge(model.id);
    if (ok) toast('License acknowledged.', 'success', model.license.name);
  };

  const download = async () => {
    if (!ack) {
      await accept();
      return;
    }
    if (!installable.ok) {
      toast(`${model.shortName} cannot be installed yet.`, 'info', installable.reason);
      return;
    }
    const ok = await models.download(model.id, defaultQualityFor(model));
    if (ok) updateSettings({ setupComplete: true });
  };

  const activate = async () => {
    const ok = await models.activate(model.id);
    if (!ok) return;
    setPage('studio');
  };

  const verify = async () => {
    await models.verify(model.id);
  };

  const toggleLogs = async () => {
    if (!showLogs) await models.loadSidecarLogs(model.id);
    setShowLogs((value) => !value);
  };

  const sidecarBadge =
    sidecar?.state === 'ready'
      ? 'Sidecar ready'
      : sidecar?.state === 'starting'
        ? 'Starting sidecar'
        : sidecar?.state === 'error'
          ? 'Sidecar error'
          : 'Sidecar stopped';

  return (
    <article className={classNames('model-card', isActive && 'is-active', !runtime.ready && 'is-gated')}>
      <header className="model-card__head">
        <div className="model-card__title">
          <span className="model-card__mark">
            <Icon name={model.runtime === 'phonon' ? 'waveform' : model.runtime === 'onnx-web' ? 'cpu' : 'layers'} size={17} />
          </span>
          <div>
            <h3>
              {model.shortName}
              {isActive && <span className="tag tag--accent">Active</span>}
            </h3>
            <span className="model-card__family">
              {model.family} · {model.runtimeLabel}
            </span>
          </div>
        </div>
        <div className="model-card__badges">
          <button
            className="score-badge"
            title={`${rating.label} · ${rating.notes}`}
            onClick={() => setShowDetails((value) => !value)}
            aria-expanded={showDetails}
          >
            <strong>{rating.score}</strong>
            <span>/10</span>
            <em>{rating.label}</em>
          </button>
          <span className={classNames('tag', `tag--${badge.tone}`)} title={badge.title}>
            {badge.label}
          </span>
        </div>
      </header>

      <p className="model-card__desc">{model.description}</p>

      <div className="model-card__chips">
        <span className={classNames('tag', `tag--${fitTone(fit.level)}`)} title={fit.summary}>
          <Icon name="thermometer" size={11} /> {fit.label}
        </span>
        <span className={classNames('tag', status.installed ? 'tag--ok' : 'tag--muted')}>
          <Icon name={status.installed ? 'checkCircle' : 'downloadCloud'} size={11} /> {lifecycle}
        </span>
        <span className="tag">
          <Icon name="globe" size={11} /> {model.languages.length} language{model.languages.length === 1 ? '' : 's'}
        </span>
        {modelHasArabic(model) && (
          <span className="tag tag--warn" title={arabicVarietiesFor(model).map((variety) => variety.name).join(', ')}>
            Arabic
          </span>
        )}
        {status.installed && (
          <span className="tag">
            <Icon name="voices" size={11} /> {voiceCount} voice{voiceCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {progress && !progress.done && (
        <div className="model-card__download">
          <div className="model-card__download-head">
            <span>{progress.stage === 'verifying' ? 'Verifying' : `Downloading ${progress.file || ''}`}</span>
            <span>{percent != null ? `${Math.round(percent)}%` : `${formatBytes(progress.loaded || 0)}`}</span>
          </div>
          {percent != null && <Percent value={percent} />}
          <button className="btn btn--subtle btn--sm" onClick={() => void models.cancel()}>
            <Icon name="x" size={13} /> Cancel
          </button>
        </div>
      )}

      {runtimeEvent && (
        <div className="model-card__download">
          <div className="model-card__download-head">
            <span className="model-card__download-label" title={runtimeEvent.file || undefined}>
              {runtimeEvent.stage === 'installing' ? runtimeEvent.file || 'Setting up the runtime' : `Downloading ${runtimeEvent.file || 'runtime'}`}
            </span>
            <span>{runtimeEvent.percent != null ? `${Math.round(runtimeEvent.percent)}%` : ''}</span>
          </div>
          {runtimeEvent.percent != null && <Percent value={runtimeEvent.percent} />}
          <button className="btn btn--subtle btn--sm" onClick={() => void models.cancelRuntime()}>
            <Icon name="x" size={13} /> Cancel
          </button>
        </div>
      )}

      {!runtime.ready && !status.installed && !runtimeEvent && (
        <div className={classNames('model-card__notice', runtime.available ? 'model-card__notice--info' : 'model-card__notice--warn')}>
          <Icon name={runtime.available ? 'info' : 'alert'} size={14} />
          <span>{runtime.reason || 'This runtime pack is not installed yet.'}</span>
        </div>
      )}

      {status.installed && !runtime.ready && !runtimeEvent && (
        <div className="model-card__notice model-card__notice--warn">
          <Icon name="alert" size={14} />
          <span>The weights are installed but the runtime is missing. Use Install runtime to rebuild it.</span>
          <button className="btn btn--subtle btn--sm" onClick={() => runtime.packId && void models.downloadRuntime(runtime.packId)} disabled={runtimeBusy}>
            Install runtime
          </button>
        </div>
      )}

      {needsToken && (
        <div className="model-card__notice model-card__notice--license">
          <Icon name="shield" size={14} />
          <span>
            This repository is gated on Hugging Face. Accept its terms on the model page, then add an access token in Settings.
          </span>
          <button className="btn btn--subtle btn--sm" onClick={() => setPage('settings')}>
            Add token
          </button>
        </div>
      )}

      {model.runtime === 'sidecar' && sidecar?.state === 'starting' && sidecar.stage && (
        <div className="model-card__notice model-card__notice--info">
          <Icon name="loader" size={14} className="spin" />
          <span>{sidecar.stage}</span>
        </div>
      )}

      {requiresLicenseAck(model) && !ack && (
        <div className="model-card__notice model-card__notice--license">
          <Icon name="shield" size={14} />
          <span>{model.license.name} needs your acknowledgment before download or activation.</span>
          <button className="btn btn--subtle btn--sm" onClick={() => void accept()}>
            Review
          </button>
        </div>
      )}

      <div className="model-card__actions">
        {isActive && status.installed ? (
          <button className="btn btn--subtle btn--sm" onClick={() => setPage('studio')}>
            <Icon name="studio" size={14} /> Open studio
          </button>
        ) : status.installed ? (
          <button
            className="btn btn--primary btn--sm"
            onClick={() => void activate()}
            disabled={busy || !runtime.ready}
            title={runtime.ready ? undefined : runtime.reason || 'This model needs its runtime pack first.'}
          >
            <Icon name={busy ? 'loader' : 'check'} size={14} className={busy ? 'spin' : undefined} />
            {busy ? 'Starting…' : 'Activate'}
          </button>
        ) : (
          <button
            className="btn btn--primary btn--sm"
            onClick={() => void download()}
            disabled={busy || !installable.ok}
            title={installable.ok ? undefined : installable.reason}
          >
            <Icon name={busy || runtimeBusy ? 'loader' : 'download'} size={14} className={busy || runtimeBusy ? 'spin' : undefined} />
            {busy || runtimeBusy
              ? 'Installing…'
              : model.files.length
                ? `Install · ${formatBytes(downloadBytes + runtimeBytes)}${runtimeBytes ? ' incl. runtime' : ''}`
                : 'No verified files'}
          </button>
        )}

        {status.installed && (
          <button className="btn btn--subtle btn--sm" onClick={() => void verify()} disabled={busy}>
            <Icon name="checkCircle" size={14} /> Verify
          </button>
        )}

        <button className="btn btn--ghost btn--sm" onClick={() => void models.importFolder(model.id)} disabled={busy}>
          <Icon name="folderOpen" size={14} /> Import
        </button>

        {model.repo && (
          <a
            className="btn btn--ghost btn--sm"
            href={`https://huggingface.co/${model.repo}`}
            title={`Open ${model.repo} on Hugging Face. Obtain the weights under their license, then import them.`}
            onClick={(event) => {
              event.preventDefault();
              void window.studio.openExternal(`https://huggingface.co/${model.repo}`);
            }}
          >
            <Icon name="external" size={14} /> Get from source
          </a>
        )}

        <button className="btn btn--ghost btn--sm" onClick={() => void models.openFolder(model.id)} disabled={busy}>
          <Icon name="folder" size={14} /> Files
        </button>

        {status.installed && (
          <button
            className="btn btn--ghost btn--sm btn--danger-text"
            onClick={() => void models.uninstall(model.id)}
            disabled={busy || isActive}
            title={isActive ? 'Switch to another model before removing this one.' : undefined}
          >
            <Icon name="trash" size={14} /> Remove
          </button>
        )}

        {model.runtime === 'sidecar' && runtime.ready && (
          <button className="btn btn--ghost btn--sm" onClick={() => void (sidecar?.state === 'ready' ? models.stopSidecar(model.id) : models.startSidecar(model.id))}>
            <Icon name={sidecar?.state === 'ready' ? 'stop' : 'play'} size={14} /> {sidecarBadge}
          </button>
        )}

        {model.runtime === 'sidecar' && logs.length > 0 && (
          <button className="btn btn--ghost btn--sm" onClick={() => void toggleLogs()}>
            <Icon name="fileText" size={14} /> {showLogs ? 'Hide log' : 'Log'}
          </button>
        )}
      </div>

      {showLogs && (
        <pre className="model-card__log">
          {logs.slice(-40).map((entry, index) => (
            <span key={`${entry.at}-${index}`} className={`is-${entry.stream}`}>
              {entry.line}
              {'\n'}
            </span>
          ))}
        </pre>
      )}

      {showDetails && (
        <div className="model-card__details">
          <div>
            <strong>Rating rubric</strong>
            <p>{rating.rubric}</p>
            <a href={rating.evidence} onClick={(event) => { event.preventDefault(); void window.studio.openExternal(rating.evidence); }}>
              Evidence <Icon name="external" size={11} />
            </a>
          </div>
          <div>
            <strong>Hardware fit · {fit.score}/10</strong>
            <ul>
              {fit.reasons.map((reason, index) => (
                <li key={index} className={`is-${reason.kind}`}>
                  {reason.text}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <strong>Capabilities</strong>
            <ul className="model-card__capabilities">
              {CAPABILITY_ORDER.map((capability) => (
                <li key={capability} className={capabilityEnabled(model, capability) ? 'is-on' : 'is-off'}>
                  <Icon name={capabilityEnabled(model, capability) ? 'check' : 'x'} size={11} />
                  {capabilityLabel(capability)}
                  {!capabilityEnabled(model, capability) && <span className="sr-only"> not supported</span>}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <strong>License &amp; files</strong>
            <p>{licenseSummary(model)}</p>
            <p className="model-card__small">
              {model.repo} · {model.revision ? model.revision.slice(0, 12) : 'no pinned revision'}
            </p>
            {status.installedAt && <p className="model-card__small">Installed {formatDate(status.installedAt)}</p>}
            <div className="model-card__links">
              <a href={model.license.url} onClick={(event) => { event.preventDefault(); void window.studio.openExternal(model.license.url); }}>
                License <Icon name="external" size={11} />
              </a>
              <a href={`https://huggingface.co/${model.repo}`} onClick={(event) => { event.preventDefault(); void window.studio.openExternal(`https://huggingface.co/${model.repo}`); }}>
                Model card <Icon name="external" size={11} />
              </a>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export function ModelsPage() {
  const { models } = useStudio();
  const [filter, setFilter] = useState<'all' | 'installed' | 'runnable'>('all');

  const visible = useMemo(() => {
    return MODELS.filter((model) => {
      if (filter === 'installed') return models.statusFor(model.id).installed;
      if (filter === 'runnable') return models.runtimeFor(model.id).ready;
      return true;
    }).sort((a, b) => {
      const aActive = a.id === models.activeModel.id ? 1 : 0;
      const bActive = b.id === models.activeModel.id ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return a.order - b.order;
    });
  }, [filter, models]);

  const installedCount = MODELS.filter((model) => models.statusFor(model.id).installed).length;
  const runnableCount = MODELS.filter((model) => models.runtimeFor(model.id).ready).length;
  const runtimePacks = Object.values(models.runtimes);
  const installedRuntimeCount = runtimePacks.filter((pack) => pack.installed).length;
  const hardware = models.hardware;

  return (
    <div className="page page--models">
      <PageHeader
        icon="layers"
        eyebrow="Models"
        title="Choose your voice engine"
        description="Every model stays visible with its license, capabilities and hardware fit. Download only what you want to run."
        actions={
          <>
            <button className="btn btn--subtle" onClick={() => void models.refresh({ forceHardware: true })}>
              <Icon name="refresh" size={15} /> Re-scan hardware
            </button>
            <button className="btn btn--subtle" onClick={() => void models.openFolder(models.activeModel.id)}>
              <Icon name="folder" size={15} /> Model folder
            </button>
          </>
        }
      />

      <section className="card models-overview">
        <div className="models-overview__main">
          <span className="models-overview__mark">
            <Icon name="layers" size={20} />
          </span>
          <div>
            <span className="models-overview__eyebrow">Active model</span>
            <h2>{models.activeModel.name}</h2>
            <p>
              {models.activeModel.runtimeLabel} · {models.install.installed ? 'installed' : 'not installed'} ·{' '}
              {hardware.cpuCores} CPU cores · {Math.round(hardware.totalRamGb)} GB RAM
              {hardware.gpus.length ? ` · ${hardware.gpus.length} GPU${hardware.gpus.length === 1 ? '' : 's'}` : ' · no GPU detected'}
            </p>
          </div>
        </div>
        <div className="models-overview__stats">
          <div>
            <strong>{installedCount}</strong>
            <span>installed</span>
          </div>
          <div>
            <strong>{runnableCount}</strong>
            <span>ready to run</span>
          </div>
          <div>
            <strong>{MODELS.length}</strong>
            <span>in the registry</span>
          </div>
        </div>
      </section>

      <section className="card runtimes-panel">
        <header className="runtimes-panel__head">
          <div className="models-overview__main">
            <span className="models-overview__mark">
              <Icon name="layers" size={20} />
            </span>
            <div>
              <span className="models-overview__eyebrow">Runtime packs</span>
              <h2>Separate downloads, verified before use</h2>
              <p>
                The installer stays small. Python and model runtimes download individually, are checked against a
                pinned SHA-256, and install into your own data folder. {installedRuntimeCount} of {runtimePacks.length}{' '}
                installed.
              </p>
            </div>
          </div>
        </header>
        <div className="runtimes-grid">
          {runtimePacks.map((pack) => (
            <RuntimePackCard key={pack.id} pack={pack} />
          ))}
        </div>
        {!runtimePacks.length && (
          <div className="empty empty--compact models-empty">
            <Icon name="layers" size={24} />
            <strong>The runtime catalog is unavailable</strong>
            <span>Restart Voxarium or reinstall it to restore the runtime catalog.</span>
          </div>
        )}
      </section>

      <div className="models-toolbar" role="group" aria-label="Filter models">
        {[
          { id: 'all', label: `All ${MODELS.length}` },
          { id: 'installed', label: `Installed ${installedCount}` },
          { id: 'runnable', label: `Runnable ${runnableCount}` },
        ].map((option) => (
          <button
            key={option.id}
            className={classNames('filter-chip', filter === option.id && 'is-active')}
            onClick={() => setFilter(option.id as typeof filter)}
          >
            {option.label}
          </button>
        ))}
        <span className="models-toolbar__hint">
          <Icon name="info" size={13} />
          Sidecar and ONNX packs are optional; missing runtimes are shown, never hidden.
        </span>
      </div>

      <div className="models-grid">
        {visible.map((model) => (
          <ModelCard key={model.id} model={model} />
        ))}
      </div>

      {!visible.length && (
        <div className="empty empty--compact models-empty">
          <Icon name="layers" size={24} />
          <strong>No models match this filter</strong>
          <span>Show all models to see what is available.</span>
        </div>
      )}
    </div>
  );
}
