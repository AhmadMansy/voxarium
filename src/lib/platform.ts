// SPDX-License-Identifier: AGPL-3.0-or-later

/** The operating system family, read once from the user agent (the renderer has no Node access). */
export type PlatformFamily = 'darwin' | 'win32' | 'linux';

export const platformFamily: PlatformFamily = (() => {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Mac/i.test(agent)) return 'darwin';
  if (/Windows/i.test(agent)) return 'win32';
  return 'linux';
})();

export const isMac = platformFamily === 'darwin';

/** The modifier key as people read it on this system: ⌘ on macOS, Ctrl elsewhere. */
export const modKey = isMac ? '⌘' : 'Ctrl';

/** A keyboard shortcut label such as "⌘1" on macOS or "Ctrl+1" on Windows and Linux. */
export function shortcut(key: string): string {
  return isMac ? `${modKey}${key}` : `${modKey}+${key}`;
}
