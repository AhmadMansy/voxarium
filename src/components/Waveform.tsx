import { useCallback, useRef, useState, type PointerEvent } from 'react';
import { classNames } from '../lib/utils';

interface WaveformProps {
  peaks: number[];
  progress?: number;
  onSeek?: (ratio: number) => void;
  bars?: number;
  className?: string;
  quiet?: boolean;
}

function resample(peaks: number[], count: number): number[] {
  if (!peaks.length) return new Array(count).fill(0.3);
  if (peaks.length === count) return peaks;
  const output: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const source = (index / count) * peaks.length;
    const start = Math.floor(source);
    const end = Math.max(start + 1, Math.floor(((index + 1) / count) * peaks.length));
    let max = 0;
    for (let cursor = start; cursor < Math.min(end, peaks.length); cursor += 1) {
      max = Math.max(max, peaks[cursor] ?? 0);
    }
    output.push(max || 0.12);
  }
  return output;
}

export function Waveform({ peaks, progress = 0, onSeek, bars = 96, className, quiet }: WaveformProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const values = resample(peaks, bars);
  const clamped = Math.max(0, Math.min(1, progress));

  const seekTo = useCallback(
    (clientX: number) => {
      const element = ref.current;
      if (!element || !onSeek) return;
      const rect = element.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      onSeek(ratio);
    },
    [onSeek],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    seekTo(event.clientX);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !onSeek) return;
    seekTo(event.clientX);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
  };

  return (
    <div
      ref={ref}
      className={classNames('waveform', quiet && 'waveform--quiet', onSeek && 'waveform--seekable', dragging && 'is-dragging', className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role={onSeek ? 'slider' : undefined}
      aria-label={onSeek ? 'Audio position' : undefined}
      aria-valuemin={onSeek ? 0 : undefined}
      aria-valuemax={onSeek ? 100 : undefined}
      aria-valuenow={onSeek ? Math.round(clamped * 100) : undefined}
      tabIndex={onSeek ? 0 : undefined}
      onKeyDown={(event) => {
        if (!onSeek) return;
        if (event.key === 'ArrowLeft') onSeek(Math.max(0, clamped - 0.02));
        if (event.key === 'ArrowRight') onSeek(Math.min(1, clamped + 0.02));
      }}
    >
      {values.map((value, index) => {
        const active = index / values.length <= clamped;
        return (
          <span
            key={index}
            className={classNames('waveform__bar', active && 'is-played')}
            style={{ height: `${Math.max(6, Math.round(value * 100))}%` }}
          />
        );
      })}
    </div>
  );
}

export function LiveWaveform({ bars = 56, className }: { bars?: number; className?: string }) {
  return (
    <div className={classNames('live-wave', className)} aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => (
        <span
          key={index}
          className="live-wave__bar"
          style={{ animationDelay: `${(index % 13) * 0.09}s`, animationDuration: `${0.9 + (index % 7) * 0.12}s` }}
        />
      ))}
    </div>
  );
}
