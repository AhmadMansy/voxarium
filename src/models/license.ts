import type { LicenseAck, ModelLicense, ModelManifest } from './types';

export interface LicenseBadge {
  label: string;
  tone: 'ok' | 'warn' | 'danger' | 'muted';
  title: string;
}

export function licenseBadge(license: ModelLicense): LicenseBadge {
  if (license.review) {
    return {
      label: `${license.id} · review`,
      tone: 'danger',
      title: `${license.name} needs legal review before commercial use.`,
    };
  }
  if (license.restricted) {
    return {
      label: license.id,
      tone: 'warn',
      title: `${license.name} has conditions. Read and acknowledge before installing.`,
    };
  }
  if (license.commercial === false) {
    return {
      label: `${license.id} · non-commercial`,
      tone: 'warn',
      title: `${license.name} does not allow commercial use as published.`,
    };
  }
  if (license.commercial == null) {
    return { label: license.id, tone: 'muted', title: `${license.name} · terms need review.` };
  }
  return { label: license.id, tone: 'ok', title: `${license.name} allows commercial use.` };
}

export function requiresLicenseAck(model: ModelManifest): boolean {
  return Boolean(model.license.restricted || model.license.review || model.license.commercial === false);
}

export function licenseAcknowledged(model: ModelManifest, acks: Record<string, LicenseAck> | null | undefined): boolean {
  if (!requiresLicenseAck(model)) return true;
  const ack = acks?.[model.id];
  return Boolean(ack && ack.licenseId === model.license.id);
}

export function licenseSummary(model: ModelManifest): string {
  const commercial =
    model.license.commercial === true
      ? 'Commercial use allowed.'
      : model.license.commercial === false
        ? 'Non-commercial only.'
        : 'Commercial terms need review.';
  const extra = model.license.watermark ? ' Outputs are watermarked.' : '';
  return `${model.license.name}. ${commercial}${extra}`;
}

export function canInstallModel(
  model: ModelManifest,
  acks: Record<string, LicenseAck> | null | undefined,
  readiness?: { ready: boolean; available?: boolean; reason?: string | null } | null,
): { ok: boolean; reason?: string } {
  const runtimeReady = readiness ? readiness.ready : model.runtimePack.available;
  // A runtime that can be downloaded or built is installed together with the model.
  const runtimeInstallable = Boolean(readiness?.available);
  if (!runtimeReady && !runtimeInstallable) {
    return {
      ok: false,
      reason:
        readiness?.reason ||
        model.runtimePack.reason ||
        'The runtime pack for this model is not installed.',
    };
  }
  if (!model.files.length) {
    return { ok: false, reason: 'No verified files are pinned for this model yet.' };
  }
  if (!licenseAcknowledged(model, acks)) {
    return { ok: false, reason: `Acknowledge the ${model.license.name} before installing.` };
  }
  return { ok: true };
}
