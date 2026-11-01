// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FitAssessment } from './fit';
import type { ModelManifest } from './types';

/**
 * The one install contract every model follows, whatever its runtime or the operating
 * system. Stages that do not apply are marked `skipped`; they are never reordered.
 */
export type StageId = 'preflight' | 'consent' | 'toolchain' | 'environment' | 'weights' | 'prepare' | 'verify';
export type StageState = 'done' | 'pending' | 'skipped' | 'blocked';

export interface StageInfo {
  id: StageId;
  label: string;
  summary: string;
}

export const STAGES: StageInfo[] = [
  { id: 'preflight', label: 'Check this computer', summary: 'Disk space, memory, GPU, platform support and access.' },
  { id: 'consent', label: 'License', summary: 'Review and accept the model license.' },
  { id: 'toolchain', label: 'Toolchain', summary: 'Download the pinned uv and Python.' },
  { id: 'environment', label: 'Environment', summary: 'Build the model\'s isolated Python environment.' },
  { id: 'weights', label: 'Model files', summary: 'Download the pinned weights and verify every hash.' },
  { id: 'prepare', label: 'First start', summary: 'Load the model once and fetch any helper files.' },
  { id: 'verify', label: 'Test synthesis', summary: 'Speak a test sentence and check the audio.' },
];

export type SupportTier = 'A' | 'B' | 'C' | 'D';

/** Everything the plan needs; all of it is already known to the app. */
export interface PlanInput {
  model: ModelManifest;
  /** Weights are installed and verified. */
  weightsInstalled: boolean;
  /** The sidecar environment is installed (sidecar models only). */
  environmentReady: boolean;
  /** uv and the Python interpreter are installed (sidecar models only). */
  toolchainReady: boolean;
  /** The runtime can be installed on this system (not blocked by platform support). */
  runtimeAvailable: boolean;
  runtimeReason?: string | null;
  /** The first start finished (sidecar models only). */
  prepared: boolean;
  /** Result of the last test synthesis; null when it has never run. */
  synthesisOk: boolean | null;
  licenseAcknowledged: boolean;
  requiresLicenseAck: boolean;
  hasHfToken: boolean;
  fit: Pick<FitAssessment, 'level'> | null;
  tier: SupportTier | null;
  freeDiskGb: number | null;
  /** Bytes still to download for the runtime and for the weights. */
  runtimeBytes: number;
  weightsBytes: number;
}

export interface PlanStage extends StageInfo {
  state: StageState;
  detail?: string;
}

export interface InstallPlan {
  stages: PlanStage[];
  /** Reasons the install must not start. Empty means it may. */
  blockers: string[];
  /** Things worth knowing that do not stop the install. */
  warnings: string[];
  /** Total bytes still to download. */
  totalBytes: number;
  /** The first stage that still has work to do, or null when everything is done. */
  next: StageId | null;
  /** Installed, verified and test-synthesized. */
  ready: boolean;
}

const GB = 1024 ** 3;
/** Extracted environments are larger than their downloads; keep headroom on the target disk. */
const DISK_HEADROOM = 1.25;

export function planInstall(input: PlanInput): InstallPlan {
  const { model } = input;
  const sidecar = model.runtime === 'sidecar';
  const blockers: string[] = [];
  const warnings: string[] = [];
  const totalBytes = Math.max(0, input.runtimeBytes) + Math.max(0, input.weightsBytes);

  // 1. Preflight: everything that can be decided before downloading a byte.
  const alreadyInstalled = input.weightsInstalled && (!sidecar || input.environmentReady);
  if (!alreadyInstalled) {
    if (input.tier === 'D') blockers.push(input.runtimeReason || `${model.shortName} does not support this system yet.`);
    else if (sidecar && !input.runtimeAvailable && !input.environmentReady) {
      blockers.push(input.runtimeReason || `${model.shortName} has no runtime for this system.`);
    }
    if (input.fit?.level === 'too-heavy') blockers.push('This computer does not meet the minimum memory or disk for this model.');
    if (input.freeDiskGb != null && totalBytes > 0 && (totalBytes * DISK_HEADROOM) / GB > input.freeDiskGb) {
      blockers.push(`Not enough free disk space: about ${((totalBytes * DISK_HEADROOM) / GB).toFixed(1)} GB needed, ${input.freeDiskGb.toFixed(1)} GB free.`);
    }
    if (model.gated && !input.hasHfToken) blockers.push('This model is gated on Hugging Face: accept its terms there and add an access token in Settings.');
    if (!model.filesVerified || !model.files.length) blockers.push('No verified files are pinned for this model yet.');
  }
  if (input.tier === 'C') warnings.push('Experimental on this system: the recipe exists but has not been run end to end here.');
  if (input.fit?.level === 'cpu') warnings.push('No suitable GPU was found, so this model will run on the CPU and may be slow.');
  if (model.license.watermark) warnings.push('Outputs from this model carry an inaudible watermark.');
  if (sidecar && !input.prepared) warnings.push('The first start may download helper files and takes longer.');

  const stage = (id: StageId, state: StageState, detail?: string): PlanStage => ({ ...STAGES.find((item) => item.id === id)!, state, detail });

  const stages: PlanStage[] = [
    stage('preflight', blockers.length ? 'blocked' : 'done', blockers[0]),
    stage(
      'consent',
      !input.requiresLicenseAck ? 'skipped' : input.licenseAcknowledged ? 'done' : 'pending',
      input.requiresLicenseAck && !input.licenseAcknowledged ? `Accept the ${model.license.name}.` : undefined,
    ),
    stage('toolchain', !sidecar ? 'skipped' : input.toolchainReady || input.environmentReady ? 'done' : 'pending'),
    stage('environment', !sidecar ? 'skipped' : input.environmentReady ? 'done' : 'pending'),
    stage('weights', input.weightsInstalled ? 'done' : 'pending'),
    stage('prepare', !sidecar ? 'skipped' : input.prepared ? 'done' : 'pending'),
    stage('verify', input.synthesisOk === true ? 'done' : 'pending', input.synthesisOk === false ? 'The last test synthesis failed.' : undefined),
  ];

  const next = stages.find((item) => item.state === 'pending' || item.state === 'blocked')?.id ?? null;
  return { stages, blockers, warnings, totalBytes, next, ready: next === null };
}
