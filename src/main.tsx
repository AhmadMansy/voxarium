// SPDX-License-Identifier: AGPL-3.0-or-later
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PlayerProvider } from './player';
import { StudioProvider } from './state';
import './styles.css';

// Lets the stylesheet adapt the title bar to each system's window controls.
const agent = navigator.userAgent;
document.documentElement.dataset.platform = /Mac/i.test(agent) ? 'darwin' : /Windows/i.test(agent) ? 'win32' : 'linux';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

createRoot(container).render(
  <StrictMode>
    <StudioProvider>
      <PlayerProvider>
        <App />
      </PlayerProvider>
    </StudioProvider>
  </StrictMode>,
);
