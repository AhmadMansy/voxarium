// SPDX-License-Identifier: AGPL-3.0-or-later
import { useStudio } from '../state';
import { classNames } from '../lib/utils';
import { Icon } from './Icons';

/** Tray and startup behaviour. The API itself lives on the Integrations page. */
export function BackgroundCard() {
  const { settings, updateSettings, setPage } = useStudio();
  if (!settings) return null;
  // Set once at startup from the user agent (see main.tsx).
  const platform = document.documentElement.dataset.platform;

  return (
    <section className="card settings-card">
      <header className="settings-card__head">
        <span className="settings-card__icon">
          <Icon name="cpu" size={17} />
        </span>
        <div>
          <h2>Background</h2>
          <p>Keep Voxarium ready for other apps and agents without a window open.</p>
        </div>
        <span className={classNames('tag', settings.apiEnabled ? 'tag--ok' : 'tag--muted')}>{settings.apiEnabled ? 'API on' : 'API off'}</span>
      </header>

      <label className="switch-row">
        <span>
          <strong>Keep running in the tray</strong>
          <em>Closing the window hides Voxarium to the tray, so the engine stays loaded for API requests.</em>
        </span>
        <span className="switch">
          <input type="checkbox" checked={settings.closeToTray} onChange={(event) => updateSettings({ closeToTray: event.target.checked })} />
          <span className="switch__track"><span className="switch__thumb" /></span>
        </span>
      </label>

      <label className="switch-row">
        <span>
          <strong>{platform === 'win32' ? 'Start with Windows' : 'Start at login'}</strong>
          <em>
            {platform === 'linux'
              ? 'Not supported on Linux yet. Add Voxarium to your desktop session startup instead.'
              : platform === 'darwin'
                ? 'Opens hidden in the menu bar when you log in.'
                : 'Starts hidden in the tray when you sign in.'}
          </em>
        </span>
        <span className="switch">
          <input
            type="checkbox"
            checked={settings.launchAtLogin}
            disabled={platform === 'linux'}
            onChange={(event) => updateSettings({ launchAtLogin: event.target.checked })}
          />
          <span className="switch__track"><span className="switch__thumb" /></span>
        </span>
      </label>

      <div className="settings-field">
        <div className="settings-field__head">
          <strong>Local API, MCP and command line</strong>
          <span>Turn the API on, copy client setups and see recent requests.</span>
        </div>
        <div className="path-row">
          <button className="btn btn--subtle btn--sm" onClick={() => setPage('integrations')}>
            <Icon name="plug" size={14} /> Open Integrations
          </button>
        </div>
      </div>
    </section>
  );
}
