// SPDX-License-Identifier: AGPL-3.0-or-later
import type { VoiceInfo } from '../types';
import type { LicenseAck, ModelInstallState, ModelManifest } from '../models/types';
import { requiresLicenseAck, licenseAcknowledged } from '../models/license';

/**
 * Helpers for requests that arrive from the local API, CLI or MCP clients. They
 * run on the Studio's own engine (see state.tsx); this module only resolves
 * loosely written names into the ids the engine understands.
 */

export class BridgeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s_]+/g, '-');

/** Accepts a model id, short name or full name ("kokoro-82m", "Kokoro", "Kokoro-82M"). */
export function resolveModel(models: ModelManifest[], input: string | undefined): ModelManifest | null {
  if (!input) return null;
  const wanted = normalize(input);
  return (
    models.find((model) => model.id === input) ||
    models.find((model) => normalize(model.id) === wanted) ||
    models.find((model) => normalize(model.shortName) === wanted || normalize(model.name) === wanted) ||
    null
  );
}

/**
 * Accepts a full voice id ("kokoro-82m:af_heart"), the model's own id ("af_heart"),
 * or a display name ("Heart"). Only voices compatible with the model are candidates.
 */
export function resolveVoice(model: ModelManifest, candidates: VoiceInfo[], input: string | undefined): VoiceInfo | null {
  if (!input) return null;
  const wanted = normalize(input);
  return (
    candidates.find((voice) => voice.id === input) ||
    candidates.find((voice) => voice.id === `${model.id}:${input}`) ||
    candidates.find((voice) => normalize(voice.id.replace(`${model.id}:`, '')) === wanted) ||
    candidates.find((voice) => normalize(voice.name) === wanted) ||
    null
  );
}

/** Reference clips are the user's own recordings; API use is opt-in. */
export function isReferenceVoice(voice: VoiceInfo): boolean {
  return voice.source === 'model' && voice.id.includes(':ref:');
}

export function describeModel(
  model: ModelManifest,
  install: ModelInstallState | undefined,
  runtimeReady: boolean,
  acks: Record<string, LicenseAck>,
  activeId: string,
) {
  const installed = Boolean(install?.installed);
  const licensed = licenseAcknowledged(model, acks);
  return {
    id: model.id,
    name: model.name,
    runtime: model.runtime,
    active: model.id === activeId,
    installed,
    runnable: installed && runtimeReady && licensed,
    license: {
      id: model.license.id,
      name: model.license.name,
      commercial: model.license.commercial,
      acknowledgment_required: requiresLicenseAck(model),
      acknowledged: licensed,
    },
    languages: model.languages.map((language) => language.code),
    capabilities: model.capabilities,
    // What the model accepts beyond text: inline tags, an instruction, an intensity.
    expression: model.expression || null,
  };
}

export function describeVoice(voice: VoiceInfo, defaultId: string | undefined) {
  return {
    id: voice.id,
    name: voice.name,
    language: voice.language,
    gender: voice.gender,
    description: voice.description,
    kind: voice.source === 'custom' ? 'custom' : isReferenceVoice(voice) ? 'reference' : voice.source === 'model' ? 'model' : 'catalog',
    default: voice.id === defaultId,
  };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `check` passes, the engine reports an error, or time runs out. */
export async function waitFor(
  check: () => boolean,
  { timeoutMs, failure, message }: { timeoutMs: number; failure?: () => string | null; message: string },
): Promise<void> {
  const started = Date.now();
  while (!check()) {
    const failed = failure?.();
    if (failed) throw new BridgeError(503, failed);
    if (Date.now() - started > timeoutMs) throw new BridgeError(504, message);
    await sleep(250);
  }
}
