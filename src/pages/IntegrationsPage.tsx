// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiActivity, ApiStatus } from '../types';
import { useStudio } from '../state';
import { classNames, formatDuration } from '../lib/utils';
import { Icon } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';

type Client = 'claude-code' | 'claude-desktop' | 'cursor' | 'openai' | 'curl' | 'cli';

const CLIENTS: { id: Client; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'openai', label: 'OpenAI SDK' },
  { id: 'curl', label: 'curl' },
  { id: 'cli', label: 'Command line' },
];

function quote(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function routeLabel(route: string): string {
  if (route.includes('/v1/audio/speech')) return 'speech (OpenAI)';
  if (route.includes('/v1/speak')) return 'speak';
  if (route.includes('/v1/models')) return 'models';
  if (route.includes('/v1/voices')) return 'voices';
  if (route.includes('/v1/health')) return 'health';
  return route.replace(/^[A-Z]+\s+/, '');
}

function timeAgo(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Integrations: the local API, MCP server and CLI. Everything here runs on the
 * Studio's engine, so requests use the active model, its voices and History.
 */
export function IntegrationsPage() {
  const { settings, updateSettings, toast, models, engine, setPage } = useStudio();
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [activity, setActivity] = useState<ApiActivity[]>([]);
  const [portDraft, setPortDraft] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [client, setClient] = useState<Client>('claude-code');
  const [tryText, setTryText] = useState('Hello! This came through the Voxarium API.');
  const [trying, setTrying] = useState(false);
  const [tryResult, setTryResult] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let alive = true;
    window.studio.api.status().then((next) => alive && setStatus(next)).catch(() => {});
    window.studio.api.activity().then((list) => alive && setActivity(list)).catch(() => {});
    const offStatus = window.studio.api.onChanged((next) => setStatus(next));
    const offActivity = window.studio.api.onActivity((entry) => setActivity((list) => [entry, ...list].slice(0, 100)));
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => {
      alive = false;
      offStatus();
      offActivity();
      clearInterval(timer);
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (settings) setPortDraft(String(settings.apiPort || status?.port || 7849));
  }, [settings?.apiPort, status?.port]);

  const base = status?.url ? `${status.url}/v1` : `http://127.0.0.1:${status?.port || 7849}/v1`;
  const token = status?.token || '<token>';

  const setup = useMemo<Record<Client, { hint: string; code: string; file?: string }>>(() => {
    const mcp = status?.mcp;
    const cli = status?.cli;
    const mcpJson = mcp
      ? JSON.stringify({ mcpServers: { voxarium: { command: mcp.command, args: mcp.args, env: mcp.env } } }, null, 2)
      : '';
    return {
      'claude-code': {
        hint: 'Run once in a terminal. Claude Code can then speak to you and create audio files with the speak tool.',
        code: mcp ? `claude mcp add voxarium --scope user -e ELECTRON_RUN_AS_NODE=1 -- ${quote(mcp.command)} ${mcp.args.map(quote).join(' ')}` : '',
      },
      'claude-desktop': {
        hint: 'Add this to Claude Desktop’s configuration file, then restart Claude Desktop.',
        file: '%APPDATA%\\Claude\\claude_desktop_config.json',
        code: mcpJson,
      },
      cursor: {
        hint: 'Add this to Cursor’s MCP configuration (global), or to .cursor/mcp.json in a project.',
        file: '%USERPROFILE%\\.cursor\\mcp.json',
        code: mcpJson,
      },
      openai: {
        hint: 'Any OpenAI-compatible app or SDK: point it at this base URL and use the token as the API key. Voxarium model and voice ids work; OpenAI names fall back to the active model.',
        code: [
          'from openai import OpenAI',
          '',
          `client = OpenAI(base_url="${base}", api_key="${token}")`,
          'client.audio.speech.create(',
          `    model="${models.activeModel.id}",`,
          '    voice="",  # empty: the current voice',
          '    input="Hello from Voxarium",',
          ').write_to_file("hello.mp3")',
        ].join('\n'),
      },
      curl: {
        hint: 'Plain HTTP. Use curl.exe in PowerShell. response_format can be mp3, wav or pcm.',
        code: `curl.exe ${base}/audio/speech -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d "{\\"input\\": \\"Hello from Voxarium\\", \\"response_format\\": \\"wav\\"}" -o hello.wav`,
      },
      cli: {
        hint: 'PowerShell. Commands: say, models, voices, status. "say" plays the audio, or writes it with -o file.wav. Voxarium starts in the tray if needed.',
        code: cli
          ? [
              '$env:ELECTRON_RUN_AS_NODE = 1',
              `& ${quote(cli.command)} ${cli.args.map(quote).join(' ')} say "Hello from the command line"`,
              `& ${quote(cli.command)} ${cli.args.map(quote).join(' ')} say -m kokoro-82m "Hi" -o hi.wav`,
            ].join('\n')
          : '',
      },
    };
  }, [base, token, status?.mcp, status?.cli, models.activeModel.id]);

  if (!settings) return null;

  const running = Boolean(status?.running);
  const current = setup[client];

  const applyPort = () => {
    const port = Number(portDraft);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      toast('Choose a port between 1024 and 65535.', 'error');
      setPortDraft(String(settings.apiPort));
      return;
    }
    if (port !== settings.apiPort) updateSettings({ apiPort: port });
  };

  const copy = async (value: string, label: string) => {
    await window.studio.ui.copy(value);
    toast(`${label} copied.`, 'success');
  };

  const regenerate = async () => {
    const confirmed = await window.studio.ui.confirm({
      title: 'Create a new API token?',
      message: 'Apps using the current token will need the new one.',
      detail: 'The CLI and MCP server pick up the new token automatically.',
      confirmLabel: 'Create new token',
    });
    if (!confirmed) return;
    setStatus(await window.studio.api.regenerateToken());
    toast('A new API token is active.', 'success');
  };

  const tryIt = async () => {
    setTrying(true);
    setTryResult(null);
    const result = await window.studio.api.test({ text: tryText });
    setTrying(false);
    if (!result.ok) {
      setTryResult(result.error);
      return;
    }
    setTryResult(`${result.duration.toFixed(2)}s · ${result.model} · ${result.voice}`);
    audioRef.current?.pause();
    audioRef.current = new Audio(`data:audio/wav;base64,${result.audio_base64}`);
    void audioRef.current.play().catch(() => {});
  };

  const failures = activity.filter((entry) => entry.status >= 400).length;

  return (
    <div className="page page--integrations">
      <PageHeader
        title="Use Voxarium from other apps"
        description="An OpenAI-compatible API, an MCP server for AI agents and a command line, all on this computer and all using the same engine as the Studio."
        actions={
          <label className={classNames('integrations-toggle', running && 'is-on')}>
            <span>{running ? `API on · ${status?.port}` : 'API off'}</span>
            <span className="switch">
              <input type="checkbox" checked={settings.apiEnabled} onChange={(event) => updateSettings({ apiEnabled: event.target.checked })} aria-label="Enable the local API" />
              <span className="switch__track"><span className="switch__thumb" /></span>
            </span>
          </label>
        }
      />

      <div className="settings-layout">
        <div className="settings-main">
          {status?.error && (
            <div className="inline-error">
              <Icon name="alert" size={15} />
              <span>{status.error}</span>
            </div>
          )}

          <section className="card settings-card">
            <header className="settings-card__head">
              <span className="settings-card__icon">
                <Icon name="key" size={17} />
              </span>
              <div>
                <h2>Connection</h2>
                <p>Listens on 127.0.0.1 only. Every request needs the token; browsers and other computers cannot connect.</p>
              </div>
            </header>

            <div className="settings-field">
              <div className="settings-field__head">
                <strong>Base URL</strong>
                <span>{running ? 'Point clients here.' : 'Turn the API on to accept requests.'}</span>
              </div>
              <div className="path-row">
                <input className="input input--mono" value={base} readOnly aria-label="API base URL" />
                <button className="btn btn--subtle btn--sm" onClick={() => void copy(base, 'Base URL')}>
                  <Icon name="copy" size={13} /> Copy
                </button>
                <input
                  className="input input--mono api-port"
                  value={portDraft}
                  inputMode="numeric"
                  aria-label="Port"
                  title="Port"
                  onChange={(event) => setPortDraft(event.target.value.replace(/\D/g, '').slice(0, 5))}
                  onBlur={applyPort}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applyPort();
                  }}
                />
              </div>
            </div>

            <div className="settings-field">
              <div className="settings-field__head">
                <strong>API token</strong>
                <span>Send as “Authorization: Bearer …”, or use it as the API key in OpenAI clients.</span>
              </div>
              <div className="path-row">
                <input
                  className="input input--mono"
                  type={showToken ? 'text' : 'password'}
                  value={status?.token || ''}
                  placeholder={running ? '' : 'Created when the API is turned on'}
                  readOnly
                  aria-label="API token"
                />
                <button className="btn btn--subtle btn--sm" onClick={() => setShowToken((value) => !value)} disabled={!status?.token}>
                  {showToken ? 'Hide' : 'Show'}
                </button>
                <button className="btn btn--subtle btn--sm" onClick={() => void copy(status?.token || '', 'Token')} disabled={!status?.token}>
                  <Icon name="copy" size={13} /> Copy
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => void regenerate()} disabled={!running}>
                  New token
                </button>
              </div>
            </div>

            <label className="switch-row">
              <span>
                <strong>Allow API clients to use your reference voices</strong>
                <em>Off by default. When on, apps and agents can speak with the voice clips in your references folder.</em>
              </span>
              <span className="switch">
                <input type="checkbox" checked={settings.apiAllowCloning} onChange={(event) => updateSettings({ apiAllowCloning: event.target.checked })} />
                <span className="switch__track"><span className="switch__thumb" /></span>
              </span>
            </label>
          </section>

          <section className="card settings-card">
            <header className="settings-card__head">
              <span className="settings-card__icon">
                <Icon name="plug" size={17} />
              </span>
              <div>
                <h2>Connect a client</h2>
                <p>Copy the setup for your tool. Agents get the speak, list_models, list_voices and status tools.</p>
              </div>
            </header>
            <div className="client-tabs" role="tablist">
              {CLIENTS.map((item) => (
                <button key={item.id} role="tab" aria-selected={client === item.id} className={classNames(client === item.id && 'is-active')} onClick={() => setClient(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <p className="field__hint">
              {current.hint}
              {current.file && (
                <>
                  {' '}File: <code>{current.file}</code>
                </>
              )}
            </p>
            <div className="api-snippet">
              <pre>{current.code || 'Loading…'}</pre>
              <button className="btn btn--subtle btn--sm" onClick={() => void copy(current.code, 'Setup')} disabled={!current.code}>
                <Icon name="copy" size={13} /> Copy
              </button>
            </div>
          </section>

          <section className="card settings-card">
            <header className="settings-card__head">
              <span className="settings-card__icon">
                <Icon name="history" size={17} />
              </span>
              <div>
                <h2>Recent requests</h2>
                <p>The last 100 requests since Voxarium started. Nothing is stored on disk.</p>
              </div>
              {failures > 0 && <span className="tag tag--warn">{failures} failed</span>}
            </header>
            {activity.length ? (
              <div className="activity-table" role="table" aria-label="Recent API requests">
                <div className="activity-row activity-row--head" role="row">
                  <span>When</span>
                  <span>Client</span>
                  <span>Request</span>
                  <span>Model · voice</span>
                  <span>Audio</span>
                  <span>Status</span>
                </div>
                {activity.map((entry) => (
                  <div key={entry.id} className={classNames('activity-row', entry.status >= 400 && 'is-error')} role="row" title={entry.error || undefined}>
                    <span>{timeAgo(entry.at, now)}</span>
                    <span className="activity-row__client">{entry.client}</span>
                    <span>
                      {routeLabel(entry.route)}
                      {entry.chars ? <em> · {entry.chars} chars</em> : null}
                    </span>
                    <span className="activity-row__model">{entry.model ? `${entry.model}${entry.voice ? ` · ${entry.voice.replace(`${entry.model}:`, '')}` : ''}` : '—'}</span>
                    <span>
                      {entry.duration ? formatDuration(entry.duration) : '—'}
                      {entry.played ? <em> · played</em> : null}
                      {entry.saved ? <em> · saved</em> : null}
                    </span>
                    <span>
                      <em className={classNames('tag', entry.status >= 400 ? 'tag--warn' : 'tag--ok')}>{entry.status}</em> <em>{(entry.ms / 1000).toFixed(1)}s</em>
                    </span>
                    {entry.error && <span className="activity-row__error">{entry.error}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty empty--compact">
                <Icon name="plug" size={22} />
                <strong>No requests yet</strong>
                <span>{running ? 'Requests from apps, the CLI and agents appear here.' : 'Turn the API on, then connect a client.'}</span>
              </div>
            )}
          </section>
        </div>

        <aside className="settings-side">
          <section className="card settings-side__card">
            <h3>Status</h3>
            <dl className="settings-side__list">
              <div>
                <dt>API</dt>
                <dd>{running ? 'Running' : status?.error ? 'Error' : 'Off'}</dd>
              </div>
              <div>
                <dt>Active model</dt>
                <dd>{models.activeModel.shortName}</dd>
              </div>
              <div>
                <dt>Engine</dt>
                <dd>{engine.status === 'ready' ? (engine.busy ? 'Busy' : 'Ready') : engine.status}</dd>
              </div>
              <div>
                <dt>Tray mode</dt>
                <dd>{settings.closeToTray ? 'On' : 'Off'}</dd>
              </div>
              <div>
                <dt>Requests</dt>
                <dd>{activity.length}</dd>
              </div>
            </dl>
            <button className="btn btn--subtle btn--sm settings-side__cta" onClick={() => setPage('settings')}>
              <Icon name="settings" size={14} /> Tray &amp; startup settings
            </button>
          </section>

          <section className="card settings-side__card">
            <h3>Try it</h3>
            <p className="field__hint">Sends a real request through the API with the current model and voice.</p>
            <textarea className="input try-it__text" rows={3} value={tryText} maxLength={2000} onChange={(event) => setTryText(event.target.value)} />
            <button className="btn btn--primary btn--sm settings-side__cta" onClick={() => void tryIt()} disabled={!running || trying || !tryText.trim()}>
              <Icon name={trying ? 'loader' : 'play'} size={14} className={trying ? 'spin' : undefined} />
              {trying ? 'Generating…' : running ? 'Speak through the API' : 'Turn the API on first'}
            </button>
            {tryResult && <p className="field__hint try-it__result">{tryResult}</p>}
          </section>

          <section className="card settings-side__card settings-side__card--tip">
            <span className="settings-side__icon">
              <Icon name="shield" size={18} />
            </span>
            <h3>One engine</h3>
            <p>
              API, CLI and agent requests run one at a time on the Studio’s engine. Naming another model switches the app
              to it, and license acknowledgments still apply.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
