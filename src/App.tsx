// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import { SetupWizard } from './components/SetupWizard';
import { CloneVoiceModal } from './components/CloneVoiceModal';
import { Toasts } from './components/Toasts';
import { Icon, type IconName } from './components/Icons';
import { PlayerBar } from './components/PlayerBar';
import { usePlayer } from './player';
import { useStudio } from './state';
import { BatchPage } from './pages/BatchPage';
import { HistoryPage } from './pages/HistoryPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { ModelsPage } from './pages/ModelsPage';
import { SettingsPage } from './pages/SettingsPage';
import { StudioPage } from './pages/StudioPage';
import { VoicesPage } from './pages/VoicesPage';
import type { Page } from './types';
import { classNames } from './lib/utils';

const NAV: { id: Page; label: string; icon: IconName; hint: string }[] = [
  { id: 'studio', label: 'Studio', icon: 'studio', hint: 'Write and render speech' },
  { id: 'models', label: 'Models', icon: 'layers', hint: 'Install and switch voice engines' },
  { id: 'voices', label: 'Voices', icon: 'voices', hint: 'Browse the cast' },
  { id: 'history', label: 'History', icon: 'history', hint: 'Your recordings' },
  { id: 'batch', label: 'Batch', icon: 'batch', hint: 'Render a full script' },
  { id: 'integrations', label: 'Integrations', icon: 'plug', hint: 'API, MCP and command line' },
  { id: 'settings', label: 'Settings', icon: 'settings', hint: 'Tune the studio' },
];

const PAGE_LABEL: Record<Page, string> = {
  studio: 'Studio',
  models: 'Models',
  voices: 'Voice library',
  history: 'History',
  batch: 'Batch render',
  integrations: 'Integrations',
  settings: 'Settings',
};

function Splash() {
  return (
    <div className="splash">
      <div className="splash__glow" aria-hidden="true" />
      <div className="splash__inner">
        <div className="brand brand--lg splash__brand">
          <span className="brand__mark">
            <Icon name="audioLines" size={24} />
          </span>
          <span className="brand__name">Voxarium</span>
        </div>
        <div className="splash__wave" aria-hidden="true">
          {Array.from({ length: 9 }, (_, index) => (
            <span key={index} style={{ animationDelay: `${index * 0.11}s` }} />
          ))}
        </div>
        <p>Preparing your on-device studio…</p>
      </div>
    </div>
  );
}

function BootError({ message }: { message: string }) {
  return (
    <div className="boot-error">
      <span className="boot-error__icon">
        <Icon name="alert" size={26} />
      </span>
      <h1>Voxarium could not start</h1>
      <p>The desktop bridge did not answer. Reloading the window usually fixes this.</p>
      <pre>{message}</pre>
      <div className="boot-error__actions">
        <button className="btn btn--primary" onClick={() => window.location.reload()}>
          <Icon name="refresh" size={16} /> Reload window
        </button>
        <button className="btn btn--subtle" onClick={() => void window.studio.paths.reveal('data')}>
          <Icon name="folder" size={16} /> Open data folder
        </button>
      </div>
    </div>
  );
}

export function App() {
  const {
    booted,
    bootError,
    settings,
    info,
    model,
    models,
    engine,
    page,
    setPage,
    history,
    updateSettings,
    refreshModel,
  } = useStudio();
  const player = usePlayer();
  const [setupOpen, setSetupOpen] = useState(false);
  const autoSetup = useRef(false);

  useEffect(() => {
    if (!booted || !settings) return;
    if (autoSetup.current) return;
    autoSetup.current = true;
    if (!settings.setupComplete && !settings.onboardingDismissed) setSetupOpen(true);
  }, [booted, settings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const match = /^([1-7])$/.exec(event.key);
      if (!match) return;
      event.preventDefault();
      setPage(NAV[Number(match[1]) - 1].id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setPage]);

  if (!booted) return <Splash />;
  if (bootError) return <BootError message={bootError} />;
  if (!settings) return <Splash />;

  const engineTone =
    engine.status === 'ready'
      ? 'ok'
      : engine.status === 'error'
        ? 'danger'
        : engine.status === 'needs-setup'
          ? 'muted'
          : 'warn';
  const engineLabel =
    engine.status === 'ready'
      ? `${settings.quality.toUpperCase()} · ${engine.info?.device === 'webgpu' ? 'WebGPU' : 'CPU'}`
      : engine.status === 'loading'
        ? 'Warming up…'
        : engine.status === 'error'
          ? 'Engine error'
          : engine.status === 'needs-setup'
            ? 'Not installed'
            : 'Idle';

  const active = NAV.find((item) => item.id === page) || NAV[0];

  const openSetup = () => setSetupOpen(true);

  const toggleTheme = () => {
    updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
  };

  const handleEngineClick = () => {
    if (engine.status === 'needs-setup' || !model?.installed) openSetup();
    else if (engine.status === 'error') void engine.reload();
    else setPage('settings');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="brand__mark">
            <Icon name="audioLines" size={19} />
          </span>
          <span className="sidebar__brand-text">
            <strong>Voxarium</strong>
            <em>Local speech</em>
          </span>
        </div>

        <nav className="sidebar__nav" aria-label="Primary">
          {NAV.map((item) => {
            const selected = item.id === page;
            const badge =
              item.id === 'history' && history.length
                ? history.length > 99
                  ? '99+'
                  : String(history.length)
                : null;
            return (
              <button
                key={item.id}
                className={classNames('nav-item', selected && 'is-active')}
                onClick={() => setPage(item.id)}
                aria-current={selected ? 'page' : undefined}
                title={item.hint}
              >
                <span className="nav-item__icon">
                  <Icon name={item.icon} size={18} />
                </span>
                <span className="nav-item__label">{item.label}</span>
                {badge && <span className="nav-item__badge">{badge}</span>}
                {item.id === 'integrations' && settings.apiEnabled && (
                  <span className="nav-item__dot" title="The local API is on" aria-label="API on" />
                )}
                {item.id === 'studio' && !badge && <span className="nav-item__key">⌘1</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar__spacer" />

        {!model?.installed && (
          <button className="sidebar__setup" onClick={openSetup}>
            <span className="sidebar__setup-icon">
              <Icon name="downloadCloud" size={16} />
            </span>
            <span>
              <strong>Install model</strong>
              <em>{models.activeModel.shortName} · {models.activeModel.downloadBytes ? `${Math.round(models.activeModel.downloadBytes / 1024 / 1024)} MB` : 'open Models'}</em>
            </span>
            <Icon name="chevronRight" size={14} />
          </button>
        )}

        <div className="sidebar__foot">
          <button className={classNames('engine-chip', `engine-chip--${engineTone}`)} onClick={handleEngineClick}>
            <span className={classNames('status-dot', `status-dot--${engineTone}`)} />
            <span className="engine-chip__text">
              <strong>{engineLabel}</strong>
              <em>
                {engine.status === 'ready'
                  ? `${engine.info?.threads ?? 1} thread${(engine.info?.threads ?? 1) === 1 ? '' : 's'} · 24 kHz`
                  : engine.status === 'loading'
                    ? engine.stage || 'Loading the local runtime'
                    : `${models.activeModel.shortName} · on device`}
              </em>
            </span>
            <Icon name={engine.status === 'error' ? 'refresh' : 'chevronRight'} size={14} />
          </button>

          <div className="sidebar__tools">
            <button className="icon-toggle" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
              <Icon name={settings.theme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
            <button
              className="icon-toggle"
              onClick={openSetup}
              title="Setup assistant"
              aria-label="Setup assistant"
            >
              <Icon name="downloadCloud" size={16} />
            </button>
            <span className="sidebar__version">v{info?.version || '1.0.0'}</span>
          </div>
        </div>
      </aside>

      <div className={classNames('workspace', player.meta && 'has-player')}>
        <header className="titlebar">
          <div className="titlebar__drag">
            <span className="titlebar__page">{PAGE_LABEL[page]}</span>
            <span className="titlebar__divider" />
            <span className="titlebar__hint">{active.hint}</span>
          </div>
          <div className="titlebar__status">
            <span className="titlebar__local">
              <Icon name="shield" size={12} /> On-device
            </span>
            <span className={classNames('titlebar__engine', `titlebar__engine--${engineTone}`)}>
              <span className={classNames('status-dot', `status-dot--${engineTone}`)} />
              {engine.status === 'ready' ? `${settings.quality.toUpperCase()} · ${engine.info?.device === 'webgpu' ? 'WebGPU' : 'CPU'}` : engineLabel}
            </span>
          </div>
          <div className="titlebar__control-space" aria-hidden="true" />
        </header>

        <main className="app-body">
          <div className="page-scroll" key={page}>
            {page === 'studio' && <StudioPage onOpenSetup={openSetup} />}
            {page === 'models' && <ModelsPage />}
            {page === 'voices' && <VoicesPage />}
            {page === 'history' && <HistoryPage />}
            {page === 'batch' && <BatchPage />}
            {page === 'integrations' && <IntegrationsPage />}
            {page === 'settings' && <SettingsPage onOpenSetup={openSetup} />}
          </div>
        </main>

        <PlayerBar />
      </div>

      <Toasts />
      <CloneVoiceModal />
      <SetupWizard
        open={setupOpen}
        onClose={() => {
          setSetupOpen(false);
          void refreshModel();
        }}
      />
    </div>
  );
}
