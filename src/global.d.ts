import type { StudioApi } from './types';

declare global {
  interface Window {
    studio: StudioApi;
  }
}

export {};
