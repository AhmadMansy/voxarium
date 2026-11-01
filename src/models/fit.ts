// SPDX-License-Identifier: AGPL-3.0-or-later
export type FitLevel = 'great' | 'runs' | 'cpu' | 'too-heavy';

export interface HardwareGpu {
  vendor?: string;
  device?: string;
  vramGb?: number | null;
  active?: boolean;
}

/** A snapshot of the machine, produced by Electron and consumed by the fit scorer. */
export interface HardwareProfile {
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalRamGb: number;
  freeRamGb: number;
  freeDiskGb: number | null;
  gpus: HardwareGpu[];
  gpuPreference: 'auto' | 'high-performance' | 'low-power';
  webgpuLikely: boolean;
}

export interface FitReason {
  kind: 'ok' | 'warn' | 'block';
  text: string;
}

export interface FitAssessment {
  level: FitLevel;
  score: number;
  label: string;
  summary: string;
  reasons: FitReason[];
}

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const hasUsableVram = (hardware: HardwareProfile, required: number) => {
  if (required <= 0) return true;
  return hardware.gpus.some((gpu) => (gpu.vramGb ?? 0) >= required);
};

/**
 * Scores hardware fit without pretending to benchmark. The result is a planning
 * aid: it combines the manifest's memory/disk floor with the measured machine.
 */
export function assessFit(
  model: { hardware: { backend: string; minRamGb: number; recRamGb: number; minVramGb: number; recVramGb: number; diskGb: number } },
  hardware: HardwareProfile,
): FitAssessment {
  const reasons: FitReason[] = [];
  const requirements = model.hardware;
  const isSidecar = requirements.backend === 'sidecar';
  const isWasm = requirements.backend === 'wasm-webgpu' || requirements.backend === 'onnx-web';
  let level: FitLevel = 'great';

  if (hardware.totalRamGb < requirements.minRamGb) {
    level = 'too-heavy';
    reasons.push({
      kind: 'block',
      text: `Needs about ${requirements.minRamGb} GB of RAM; this machine reports ${round(hardware.totalRamGb)} GB.`,
    });
  } else if (hardware.totalRamGb >= requirements.recRamGb) {
    reasons.push({ kind: 'ok', text: `${round(hardware.totalRamGb)} GB RAM meets the recommended ${requirements.recRamGb} GB.` });
  } else {
    level = 'runs';
    reasons.push({
      kind: 'warn',
      text: `Fits in ${round(hardware.totalRamGb)} GB, below the recommended ${requirements.recRamGb} GB. Expect slower loads.`,
    });
  }

  if (isSidecar) {
    if (requirements.minVramGb > 0 && !hasUsableVram(hardware, requirements.minVramGb)) {
      level = level === 'too-heavy' ? level : 'cpu';
      reasons.push({
        kind: 'warn',
        text: `Prefers ${requirements.minVramGb} GB of VRAM. No matching GPU was detected, so this would fall back to CPU or fail to start.`,
      });
    } else if (requirements.recVramGb > 0 && hasUsableVram(hardware, requirements.recVramGb)) {
      reasons.push({ kind: 'ok', text: `Detected a GPU with at least ${requirements.recVramGb} GB of VRAM.` });
    }
    reasons.push({ kind: 'warn', text: 'Sidecar runtimes are opt-in downloads and are not installed by default.' });
  } else if (isWasm) {
    if (requirements.minVramGb > 0 && !hasUsableVram(hardware, requirements.minVramGb)) {
      reasons.push({ kind: 'warn', text: 'No discrete GPU detected; WebGPU may use the integrated adapter or fall back to WASM.' });
    } else if (hardware.webgpuLikely) {
      reasons.push({ kind: 'ok', text: 'WebGPU is available; the model can use the GPU or WASM.' });
    }
  }

  if (hardware.freeDiskGb != null && hardware.freeDiskGb < requirements.diskGb * 1.1) {
    level = 'too-heavy';
    reasons.push({
      kind: 'block',
      text: `Needs about ${round(requirements.diskGb, 2)} GB free on disk; only ${round(hardware.freeDiskGb)} GB is free.`,
    });
  } else if (hardware.freeDiskGb != null) {
    reasons.push({ kind: 'ok', text: `${round(requirements.diskGb, 2)} GB of disk needed; ${round(hardware.freeDiskGb)} GB free.` });
  }

  if (level === 'great' && hardware.cpuCores < 4 && requirements.backend !== 'sidecar') {
    level = 'runs';
    reasons.push({ kind: 'warn', text: `${hardware.cpuCores} CPU cores detected; loading may take a little longer.` });
  }

  if (level === 'runs' && reasons.every((reason) => reason.kind !== 'warn')) {
    level = 'great';
  }

  const label =
    level === 'great' ? 'Great fit' : level === 'runs' ? 'Runs' : level === 'cpu' ? 'CPU only' : 'Too heavy';

  return {
    level,
    score: level === 'great' ? 10 : level === 'runs' ? 7 : level === 'cpu' ? 4 : 1,
    label,
    summary:
      level === 'great'
        ? 'This machine comfortably meets the recommended requirements.'
        : level === 'runs'
          ? 'It should run, with some slower loading or generation.'
          : level === 'cpu'
            ? 'It can run without the preferred GPU, but expect a slow sidecar.'
            : 'This machine does not meet the minimum requirements right now.',
    reasons,
  };
}

export interface ModelRating {
  score: number;
  label: string;
  notes: string;
  rubric: string;
  evidence: string;
}

export function modelRating(model: { rating: number; ratingNotes: string; ratingRubric: string; ratingEvidence: string }): ModelRating {
  const score = Math.max(1, Math.min(10, Math.round(model.rating)));
  const label = score >= 9 ? 'Flagship' : score >= 8 ? 'Excellent' : score >= 7 ? 'Strong' : score >= 5 ? 'Capable' : 'Experimental';
  return {
    score,
    label,
    notes: model.ratingNotes,
    rubric: model.ratingRubric,
    evidence: model.ratingEvidence,
  };
}

export function fitTone(level: FitLevel): 'ok' | 'warn' | 'danger' | 'muted' {
  if (level === 'great') return 'ok';
  if (level === 'runs') return 'warn';
  if (level === 'cpu') return 'muted';
  return 'danger';
}

export function licenseTone(license: { restricted?: boolean; commercial?: boolean | null }): 'ok' | 'warn' | 'danger' | 'muted' {
  if (license.restricted) return 'warn';
  if (license.commercial === false) return 'warn';
  if (license.commercial == null) return 'muted';
  return 'ok';
}

export function emptyHardware(): HardwareProfile {
  return {
    platform: 'unknown',
    arch: 'unknown',
    cpuModel: '',
    cpuCores: 0,
    totalRamGb: 0,
    freeRamGb: 0,
    freeDiskGb: null,
    gpus: [],
    gpuPreference: 'auto',
    webgpuLikely: false,
  };
}
