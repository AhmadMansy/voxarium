import { useEffect, useMemo, useState } from 'react';
import type { ApiStatus } from '../types';
import { useStudio } from '../state';
import { classNames } from '../lib/utils';
import { Icon } from './Icons';

type Snippet = 'openai' | 'mcp' | 'cli';

function quoteArg(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/**
 * Settings card for the local API, MCP server, CLI and tray mode. Everything here
 * runs on the Studio's engine: API requests use the active model and voices.
 */
export function IntegrationsCard() {
  const { settings, updateSettings, toast } = useStudio();
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [portDraft, setPortDraft] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [snippet, setSnippet] = useState<Snippet>('openai');

  useEffect(() => {
    let alive = true;
    window.studio.api.status().then((next) => alive && setStatus(next)).catch(() => {});
    const off = window.studio.api.onChanged((next) => setStatus(next));
    return () => {
      alive = false;
      off();
    };
  }, []);

  useEffect(() => {
    if (settings) setPortDraft(String(settings.apiPort || status?.port || 7849));
  }, [settings?.apiPort, status?.port]);

  const base = status?.url ? `${status.url}/v1` : `http://127.0.0.1:${status?.port || 7849}/v1`;
  const token = status?.token || '<token>';

  const snippets = useMemo<Record<Snippet, { label: string; code: string; hint: string }>>(() => {
    const mcp = status?.mcp;
    const cli = status?.cli;
    const mcpConfig = mcp
      ? JSON.stringify({ mcpServers: { voxarium: { command: mcp.command, args: mcp.args, env: mcp.env } } }, null, 2)
      : '';
    const cliLine = cli
      ? `$env:ELECTRON_RUN_AS_NODE=1; & ${quoteArg(cli.command)} ${cli.args.map(quoteArg).join(' ')} say "Hello from Voxarium"`
      : '';
    return {
      openai: {
        label: 'OpenAI-compatible',
        hint: 'Any app or SDK that speaks the OpenAI speech API: set the base URL and use the token as the API key. "model" and "voice" accept Voxarium ids; OpenAI names fall back to the active model and its voice.',
        code: [
          `curl ${base}/audio/speech \\`,
          `  -H "Authorization: Bearer ${token}" \\`,
          `  -H "Content-Type: application/json" \\`,
          `  -d '{"model": "kokoro-82m", "input": "Hello from Voxarium", "voice": "af_heart", "response_format": "mp3"}' \\`,
          '  -o speech.mp3',
          '',
          '# Python: OpenAI(base_url="' + base + '", api_key="' + token + '")',
        ].join('\n'),
      },
      mcp: {
        label: 'MCP (agents)',
        hint: 'Add this to your MCP client (Claude Code, Claude Desktop, Cursor). Tools: speak, list_models, list_voices, status. It starts Voxarium in the tray if it is not running.',
        code: mcpConfig,
      },
      cli: {
        label: 'Command line',
        hint: 'Commands: say, models, voices, status. "say" plays the audio, or writes it with -o file.wav. With Node.js installed you can also run: node <script> say …',
        code: cliLine,
      },
    };
  }, [base, token, status?.mcp, status?.cli]);

  if (!settings) return null;

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

  const tag = status?.running
    ? { tone: 'ok', label: `Running · ${status.port}` }
    : status?.error
      ? { tone: 'warn', label: 'Error' }
      : { tone: 'muted', label: 'Off' };
  const current = snippets[snippet];

  return (
    <section className="card settings-card">
      <header className="settings-card__head">
        <span className="settings-card__icon">
          <Icon name="cpu" size={17} />
        </span>
        <div>
          <h2>Local API &amp; integrations</h2>
          <p>Let other apps, scripts and AI agents generate speech with your local models.</p>
        </div>
        <span className={classNames('tag', `tag--${tag.tone}`)}>{tag.label}</span>
      </header>

      <label className="switch-row">
        <span>
          <strong>Enable the local API</strong>
          <em>
            Listens on 127.0.0.1 only and needs the token below. Requests use the same engine, active model and voices as
            the Studio; browsers cannot call it.
          </em>
        </span>
        <span className="switch">
          <input type="checkbox" checked={settings.apiEnabled} onChange={(event) => updateSettings({ apiEnabled: event.target.checked })} />
          <span className="switch__track"><span className="switch__thumb" /></span>
        </span>
      </label>

      {status?.error && (
        <div className="inline-error">
          <Icon name="alert" size={15} />
          <span>{status.error}</span>
        </div>
      )}

      <label className="switch-row">
        <span>
          <strong>Keep running in the tray</strong>
          <em>Closing the window hides Voxarium to the tray so the engine stays ready for API requests.</em>
        </span>
        <span className="switch">
          <input type="checkbox" checked={settings.closeToTray} onChange={(event) => updateSettings({ closeToTray: event.target.checked })} />
          <span className="switch__track"><span className="switch__thumb" /></span>
        </span>
      </label>

      <label className="switch-row">
        <span>
          <strong>Start with Windows</strong>
          <em>Starts hidden in the tray when you sign in.</em>
        </span>
        <span className="switch">
          <input type="checkbox" checked={settings.launchAtLogin} onChange={(event) => updateSettings({ launchAtLogin: event.target.checked })} />
          <span className="switch__track"><span className="switch__thumb" /></span>
        </span>
      </label>

      <label className="switch-row">
        <span>
          <strong>Allow API clients to use your reference voices</strong>
          <em>Off by default. When on, apps and agents can generate speech with the voice clips in your references folder.</em>
        </span>
        <span className="switch">
          <input type="checkbox" checked={settings.apiAllowCloning} onChange={(event) => updateSettings({ apiAllowCloning: event.target.checked })} />
          <span className="switch__track"><span className="switch__thumb" /></span>
        </span>
      </label>

      <div className="settings-field">
        <div className="settings-field__head">
          <strong>Address</strong>
          <span>{status?.running ? 'Other apps on this computer can reach Voxarium here.' : 'Used when the API is on.'}</span>
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
            onChange={(event) => setPortDraft(event.target.value.replace(/\D/g, '').slice(0, 5))}
            onBlur={applyPort}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyPort();
            }}
          />
        </div>
      </div>

      {status?.running && (
        <div className="settings-field">
          <div className="settings-field__head">
            <strong>API token</strong>
            <span>Send it as “Authorization: Bearer …”, or use it as the API key in OpenAI clients.</span>
          </div>
          <div className="path-row">
            <input className="input input--mono" type={showToken ? 'text' : 'password'} value={status.token || ''} readOnly aria-label="API token" />
            <button className="btn btn--subtle btn--sm" onClick={() => setShowToken((value) => !value)}>
              {showToken ? 'Hide' : 'Show'}
            </button>
            <button className="btn btn--subtle btn--sm" onClick={() => void copy(status.token || '', 'Token')}>
              <Icon name="copy" size={13} /> Copy
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => void regenerate()}>
              New token
            </button>
          </div>
        </div>
      )}

      <div className="settings-field">
        <div className="settings-field__head">
          <strong>Connect a client</strong>
          <span>{current.hint}</span>
        </div>
        <div className="segmented api-snippet__tabs" role="tablist">
          {(Object.keys(snippets) as Snippet[]).map((key) => (
            <button key={key} role="tab" aria-selected={snippet === key} className={classNames(snippet === key && 'is-active')} onClick={() => setSnippet(key)}>
              {snippets[key].label}
            </button>
          ))}
        </div>
        <div className="api-snippet">
          <pre>{current.code}</pre>
          <button className="btn btn--subtle btn--sm" onClick={() => void copy(current.code, current.label)} disabled={!current.code}>
            <Icon name="copy" size={13} /> Copy
          </button>
        </div>
      </div>
    </section>
  );
}
