// SPDX-License-Identifier: AGPL-3.0-or-later
import type { StudioApi } from './types';

declare global {
  interface Window {
    studio: StudioApi;
  }
}

export {};
