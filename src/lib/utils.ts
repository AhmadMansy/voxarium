// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Pronunciation } from '../types';

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unit]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDurationPrecise(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  return seconds < 10 ? `${seconds.toFixed(2)}s` : formatDuration(seconds);
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function slugify(value: string, maxLength = 48): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

export function countWords(text: string): number {
  const matches = text.trim().match(/[\p{L}\p{N}'’€$£%.-]+/gu);
  return matches ? matches.length : 0;
}

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const matches = trimmed.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g);
  return matches ? matches.length : 0;
}

export function estimateDuration(text: string): number {
  const words = countWords(text);
  if (!words) return 0;
  // Speech runs at a natural, fairly brisk pace; ~2.7 words per second.
  return Math.max(0.6, words / 2.7);
}

export function applyPronunciations(text: string, rules: Pronunciation[]): { text: string; applied: number } {
  let output = text;
  let applied = 0;
  for (const rule of rules) {
    if (!rule.from.trim()) continue;
    const escaped = rule.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    output = output.replace(regex, () => {
      applied += 1;
      return rule.to;
    });
  }
  return { text: output, applied };
}

export function toSeedValue(seed: string): number | bigint {
  const digits = String(seed).replace(/[^\d]/g, '');
  if (!digits) return 4242424242424242;
  const asNumber = Number(digits);
  if (!Number.isSafeInteger(asNumber)) return BigInt(digits.slice(0, 19));
  return asNumber;
}

export function randomSeed(): string {
  return String(Math.floor(Math.random() * 8_000_000_000_000_000) + 1_000_000_000_000_000);
}

export function buildBaseName(
  template: string,
  values: { voice: string; text: string; index?: number },
): string {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
    now.getSeconds(),
  ).padStart(2, '0')}`;
  const base = template
    .replaceAll('{date}', date)
    .replaceAll('{time}', time)
    .replaceAll('{voice}', slugify(values.voice, 28) || 'voice')
    .replaceAll('{slug}', slugify(values.text, 36) || 'speech')
    .replaceAll('{index}', String(values.index ?? 1).padStart(2, '0'));
  return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || `voxarium-${time}`;
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function titleFromText(text: string): string {
  const firstLine = text.trim().split(/\r?\n/)[0] || 'Untitled speech';
  return truncate(firstLine, 78);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

