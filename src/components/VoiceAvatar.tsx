// SPDX-License-Identifier: AGPL-3.0-or-later
import { getVoice, voiceHue, voiceInitials } from '../data/catalog';
import { classNames } from '../lib/utils';

interface VoiceAvatarProps {
  voiceId?: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  muted?: boolean;
}

export function VoiceAvatar({ voiceId, name, size = 'md', className, muted }: VoiceAvatarProps) {
  const voice = getVoice(voiceId);
  const label = name || voice.name;
  const hue = voiceHue(voice.id || label);
  return (
    <span
      className={classNames('avatar', `avatar--${size}`, muted && 'avatar--muted', className)}
      style={{ ['--hue' as string]: hue }}
      title={label}
      aria-hidden="true"
    >
      <span className="avatar__ring" />
      <span className="avatar__initials">{voiceInitials(label) || '◈'}</span>
    </span>
  );
}
