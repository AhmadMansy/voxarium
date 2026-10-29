import { usePlaybackTime, usePlayer } from '../player';
import { Icon } from './Icons';
import { VoiceAvatar } from './VoiceAvatar';
import { Waveform } from './Waveform';

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function PlayerBar() {
  const player = usePlayer();
  const time = usePlaybackTime();

  if (!player.meta) return null;

  const duration = player.duration || 0;
  const progress = duration > 0 ? Math.min(1, time / duration) : 0;

  return (
    <div className="playerbar">
      <div className="playerbar__track">
        <span className="playerbar__art">
          <VoiceAvatar voiceId={player.meta.voiceId} name={player.meta.voiceName || player.meta.title} size="sm" />
          {player.playing && (
            <span className="playerbar__ping" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
        </span>
        <span className="playerbar__meta">
          <span className="playerbar__title" title={player.meta.title}>
            {player.meta.title}
          </span>
          <span className="playerbar__sub">{player.meta.subtitle || 'On-device speech'}</span>
        </span>
      </div>

      <div className="playerbar__center">
        <button
          className="playerbar__play"
          onClick={player.toggle}
          aria-label={player.playing ? 'Pause' : 'Play'}
          disabled={!player.ready}
        >
          <Icon name={player.playing ? 'pause' : 'play'} size={19} />
        </button>
        <span className="playerbar__time">{clock(time)}</span>
        <Waveform
          peaks={player.meta.peaks || []}
          progress={progress}
          bars={110}
          className="playerbar__wave"
          onSeek={(ratio) => player.seek(ratio * duration)}
        />
        <span className="playerbar__time">{clock(duration)}</span>
      </div>

      <div className="playerbar__tools">
        <button
          className={`icon-toggle ${player.loop ? 'is-on' : ''}`}
          onClick={() => player.setLoop(!player.loop)}
          aria-label="Loop"
          title="Loop"
        >
          <Icon name="loop" size={16} />
        </button>
        <div className="playerbar__volume">
          <Icon name={player.volume === 0 ? 'volumeOff' : 'volume'} size={16} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={player.volume}
            onChange={(event) => player.setVolume(Number(event.target.value))}
            aria-label="Volume"
          />
        </div>
        <select
          className="playerbar__rate"
          value={player.rate}
          onChange={(event) => player.setRate(Number(event.target.value))}
          aria-label="Playback speed"
          title="Playback speed"
        >
          <option value={0.75}>0.75×</option>
          <option value={1}>1×</option>
          <option value={1.25}>1.25×</option>
          <option value={1.5}>1.5×</option>
          <option value={2}>2×</option>
        </select>
        <button className="btn btn--icon btn--ghost" onClick={player.close} aria-label="Close player" title="Close player">
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}
