// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ModelManifest, RuntimePack, RuntimePackState } from './types';

/**
 * Runtime readiness is dynamic: a model's manifest only names the runtime pack
 * it needs (`runtimePack.packId`), and the pack is considered usable only after
 * the main process reports it as installed and verified. Keeping this in one
 * place means the Models page, the first-run wizard, the license gate and the
 * engine all agree on whether a model can actually run.
 */
export interface RuntimeReadiness {
  /** The model has everything its runtime needs on disk. */
  ready: boolean;
  /** The pack can be downloaded or imported right now. */
  available: boolean;
  /** Installed-pack identifier, when the manifest points at a pack. */
  packId: string | null;
  /** Human-readable explanation when `ready` is false. */
  reason: string | null;
  /** Live pack record, when the catalog knows the pack. */
  pack: RuntimePackState | null;
}

function asRuntimeMap(
  runtimes: Record<string, RuntimePackState> | RuntimePackState[] | null | undefined,
): Record<string, RuntimePackState> {
  if (!runtimes) return {};
  if (Array.isArray(runtimes)) {
    return Object.fromEntries(runtimes.map((pack) => [pack.id, pack]));
  }
  return runtimes;
}

export function runtimeReadiness(
  model: ModelManifest,
  runtimes: Record<string, RuntimePackState> | RuntimePackState[] | null | undefined,
): RuntimeReadiness {
  const declared: RuntimePack = model.runtimePack || { available: false };
  if (declared.available) {
    return { ready: true, available: true, packId: null, reason: null, pack: null };
  }

  const map = asRuntimeMap(runtimes);
  const pack = declared.packId ? map[declared.packId] || null : null;
  if (!pack) {
    return {
      ready: false,
      available: false,
      packId: declared.packId || null,
      reason: declared.reason || 'This model has no published runtime pack yet.',
      pack: null,
    };
  }

  const installable = Boolean(pack.available && (pack.archive || pack.buildable));
  return {
    ready: Boolean(pack.installed),
    available: Boolean(installable || pack.installed),
    packId: pack.id,
    reason: pack.installed
      ? null
      : pack.error
        ? `The last runtime install failed: ${pack.error}`
        : installable
          ? `Install sets up ${pack.name} first (${pack.buildable ? 'an isolated Python environment built on this computer' : 'a verified download'}), then downloads the model.`
          : pack.reason || declared.reason || `${pack.name} is not installed yet.`,
    pack,
  };
}

/** Packs that are worth showing in the runtime manager, in catalog order. */
export function visibleRuntimePacks(
  runtimes: Record<string, RuntimePackState> | RuntimePackState[] | null | undefined,
): RuntimePackState[] {
  return Object.values(asRuntimeMap(runtimes)).sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 'python' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
