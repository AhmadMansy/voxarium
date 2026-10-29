import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'phonon.favoriteVoices';

let cache: string[] | null = null;
const listeners = new Set<() => void>();

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function snapshot(): string[] {
  if (!cache) cache = read();
  return cache;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFavoriteVoices() {
  const favorites = useSyncExternalStore(subscribe, snapshot, snapshot);

  const toggle = useCallback((id: string) => {
    const current = snapshot();
    const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    cache = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
    for (const listener of listeners) listener();
  }, []);

  const isFavorite = useCallback((id: string) => favorites.includes(id), [favorites]);

  return { favorites, isFavorite, toggle };
}
