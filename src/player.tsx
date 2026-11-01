// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  StudioPlayer,
  computePeaks,
  decodeAudioFile,
  pcmToAudioBuffer,
} from './lib/audio';

export interface TrackMeta {
  id: string;
  title: string;
  subtitle?: string;
  voiceId?: string;
  voiceName?: string;
  peaks?: number[];
  filePath?: string;
  badge?: string;
  createdAt?: number;
}

interface PlayerState {
  meta: TrackMeta | null;
  ready: boolean;
  playing: boolean;
  duration: number;
  rate: number;
  volume: number;
  loop: boolean;
}

interface PlayerApi {
  player: StudioPlayer;
  playPcm: (
    pcm: Float32Array,
    meta: TrackMeta,
    options?: { autoplay?: boolean; sampleRate?: number },
  ) => void;
  playFile: (
    filePath: string,
    meta: TrackMeta,
    options?: { autoplay?: boolean },
  ) => Promise<void>;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  stop: () => void;
  close: () => void;
  seek: (time: number) => void;
  setRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  setLoop: (loop: boolean) => void;
}

const EMPTY_STATE: PlayerState = {
  meta: null,
  ready: false,
  playing: false,
  duration: 0,
  rate: 1,
  volume: 1,
  loop: false,
};

const PlayerApiContext = createContext<PlayerApi | null>(null);
const PlayerStateContext = createContext<PlayerState>(EMPTY_STATE);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const player = useMemo(() => new StudioPlayer(), []);
  const [state, setState] = useState<PlayerState>(EMPTY_STATE);

  useEffect(() => {
    const unsubscribe = player.subscribe(() => {
      setState((prev) => {
        if (
          prev.playing === player.playing &&
          prev.duration === player.duration &&
          prev.rate === player.rate &&
          prev.volume === player.volume &&
          prev.loop === player.loop
        ) {
          return prev;
        }
        return {
          ...prev,
          playing: player.playing,
          duration: player.duration,
          rate: player.rate,
          volume: player.volume,
          loop: player.loop,
        };
      });
    });
    return () => {
      unsubscribe();
      player.dispose();
    };
  }, [player]);

  const loadBuffer = useCallback(
    (buffer: AudioBuffer, meta: TrackMeta, autoplay: boolean) => {
      player.setBuffer(buffer);
      setState((prev) => ({
        ...prev,
        meta,
        ready: true,
        duration: buffer.duration,
        playing: false,
      }));
      if (autoplay) player.play(0);
    },
    [player],
  );

  const playPcm = useCallback<PlayerApi['playPcm']>(
    (pcm, meta, options) => {
      if (!pcm.length) return;
      const buffer = pcmToAudioBuffer(pcm, options?.sampleRate ?? 24000);
      const withPeaks = meta.peaks?.length ? meta : { ...meta, peaks: computePeaks(pcm, 160) };
      loadBuffer(buffer, withPeaks, options?.autoplay !== false);
    },
    [loadBuffer],
  );

  const playFile = useCallback<PlayerApi['playFile']>(
    async (filePath, meta, options) => {
      const bytes = await window.studio.audio.read(filePath);
      const buffer = await decodeAudioFile(bytes);
      const channel = buffer.getChannelData(0);
      loadBuffer(buffer, { ...meta, peaks: meta.peaks?.length ? meta.peaks : computePeaks(channel, 160) }, options?.autoplay !== false);
    },
    [loadBuffer],
  );

  const play = useCallback(() => player.play(), [player]);
  const pause = useCallback(() => player.pause(), [player]);
  const toggle = useCallback(() => player.toggle(), [player]);
  const stop = useCallback(() => player.stop(), [player]);
  const seek = useCallback((time: number) => player.seek(time), [player]);
  const setRate = useCallback((rate: number) => player.setRate(rate), [player]);
  const setVolume = useCallback((volume: number) => player.setVolume(volume), [player]);
  const setLoop = useCallback((loop: boolean) => player.setLoop(loop), [player]);

  const close = useCallback(() => {
    player.stop();
    player.setBuffer(null);
    setState(EMPTY_STATE);
  }, [player]);

  const api = useMemo<PlayerApi>(
    () => ({
      player,
      playPcm,
      playFile,
      play,
      pause,
      toggle,
      stop,
      close,
      seek,
      setRate,
      setVolume,
      setLoop,
    }),
    [playPcm, playFile, play, pause, toggle, stop, close, seek, setRate, setVolume, setLoop, player],
  );

  return (
    <PlayerApiContext.Provider value={api}>
      <PlayerStateContext.Provider value={state}>{children}</PlayerStateContext.Provider>
    </PlayerApiContext.Provider>
  );
}

export function usePlayer(): PlayerApi & PlayerState {
  const api = useContext(PlayerApiContext);
  if (!api) throw new Error('usePlayer must be used inside PlayerProvider');
  const state = useContext(PlayerStateContext);
  return { ...api, ...state };
}

export function usePlayerApi(): PlayerApi {
  const api = useContext(PlayerApiContext);
  if (!api) throw new Error('usePlayerApi must be used inside PlayerProvider');
  return api;
}

/** Subscribes to the playhead only, so pages are not re-rendered every animation frame. */
export function usePlaybackTime(): number {
  const { player } = usePlayerApi();
  const subscribe = useCallback((listener: () => void) => player.subscribe(listener), [player]);
  const getSnapshot = useCallback(() => player.time, [player]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
