// SPDX-License-Identifier: AGPL-3.0-or-later
import { getVoice, voiceHue } from '../data/catalog';
import { classNames } from '../lib/utils';

interface VoiceAvatarProps {
  voiceId?: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  muted?: boolean;
}

const BAR_COUNT = 9;

/** A small deterministic generator, so a voice always gets the same signature. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bar heights (0.18 to 1) shaped like a spoken phrase: quiet edges, a louder middle. */
export function voicePrint(seed: string, count = BAR_COUNT): number[] {
  const random = seeded(seed || 'voice');
  return Array.from({ length: count }, (_, index) => {
    const position = count === 1 ? 0.5 : index / (count - 1);
    const envelope = 0.45 + 0.55 * Math.sin(Math.PI * position);
    return Math.max(0.18, Math.min(1, envelope * (0.4 + 0.6 * random())));
  });
}

/**
 * Every voice gets a tile with its own waveform signature in a tint of its hue. It replaces
 * the usual gradient-circle-with-initials, and is recognisable at a glance in a long list.
 */
export function VoiceAvatar({ voiceId, name, size = 'md', className, muted }: VoiceAvatarProps) {
  const voice = getVoice(voiceId);
  const label = name || voice.name;
  const hue = voiceHue(voice.id || label);
  const bars = voicePrint(voice.id || label);
  const width = 3;
  const gap = 2.2;
  const total = BAR_COUNT * width + (BAR_COUNT - 1) * gap;
  return (
    <span
      className={classNames('avatar', `avatar--${size}`, muted && 'avatar--muted', className)}
      style={{ ['--hue' as string]: hue }}
      title={label}
      aria-hidden="true"
    >
      <svg className="avatar__print" viewBox={`0 0 ${total} 24`} preserveAspectRatio="xMidYMid meet" focusable="false">
        {bars.map((height, index) => {
          const h = Math.max(3, height * 22);
          return <rect key={index} x={index * (width + gap)} y={(24 - h) / 2} width={width} height={h} rx={width / 2} />;
        })}
      </svg>
    </span>
  );
}
