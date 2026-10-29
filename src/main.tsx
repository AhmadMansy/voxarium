import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PlayerProvider } from './player';
import { StudioProvider } from './state';
import './styles.css';

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
