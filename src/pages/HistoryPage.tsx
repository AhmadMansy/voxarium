import { useEffect, useMemo, useState } from 'react';
import { decodeAudioFile, encodeMp3 } from '../lib/audio';
import {
  classNames,
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  formatDurationPrecise,
  pluralize,
  slugify,
} from '../lib/utils';
import { usePlaybackTime, usePlayer } from '../player';
import { useStudio } from '../state';
import type { HistoryEntry } from '../types';
import { Icon } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { VoiceAvatar } from '../components/VoiceAvatar';
import { Waveform } from '../components/Waveform';

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function HistoryPage() {
  const { history, deleteHistory, patchHistory, clearHistory, reuseHistory, setPage, toast } = useStudio();
  const player = usePlayer();

  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [exporting, setExporting] = useState<'wav' | 'mp3' | null>(null);
  const [fileExists, setFileExists] = useState(true);

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return history.filter((entry) => {
      if (favoritesOnly && !entry.favorite) return false;
      if (!needle) return true;
      return `${entry.title} ${entry.text} ${entry.voiceName}`.toLowerCase().includes(needle);
    });
  }, [history, query, favoritesOnly]);

  const selected = entries.find((entry) => entry.id === selectedId) || null;
  const favoriteCount = history.filter((entry) => entry.favorite).length;
  const totalDuration = history.reduce((total, entry) => total + entry.duration, 0);
  const totalBytes = history.reduce((total, entry) => total + entry.bytes, 0);

  useEffect(() => {
    if (!entries.length) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!entries.some((entry) => entry.id === selectedId)) setSelectedId(entries[0].id);
  }, [entries, selectedId]);

  useEffect(() => {
    setEditing(false);
    setTitleDraft(selected?.title || '');
    if (!selected) {
      setFileExists(true);
      return;
    }
    let cancelled = false;
    void window.studio.audio
      .exists(selected.filePath)
      .then((exists) => {
        if (!cancelled) setFileExists(exists);
      })
      .catch(() => {
        if (!cancelled) setFileExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.filePath, selected?.title]);

  const playEntry = async (entry: HistoryEntry) => {
    if (player.meta?.id === entry.id) {
      player.toggle();
      return;
    }
    try {
      await player.playFile(entry.filePath, {
        id: entry.id,
        title: entry.title,
        subtitle: `${entry.voiceName} · ${formatDuration(entry.duration)}`,
        voiceId: entry.voiceId,
        voiceName: entry.voiceName,
        peaks: entry.peaks,
        filePath: entry.filePath,
        createdAt: entry.createdAt,
      });
    } catch (error) {
      toast('This recording could not be opened.', 'error', errorText(error));
    }
  };

  const saveTitle = async () => {
    if (!selected) return;
    const next = titleDraft.trim();
    if (!next || next === selected.title) {
      setEditing(false);
      setTitleDraft(selected.title);
      return;
    }
    await patchHistory(selected.id, { title: next });
    setEditing(false);
    toast('Recording renamed.', 'success');
  };

  const toggleFavorite = async (entry: HistoryEntry) => {
    await patchHistory(entry.id, { favorite: !entry.favorite });
  };

  const exportRecording = async (format: 'wav' | 'mp3') => {
    if (!selected) return;
    setExporting(format);
    try {
      const defaultName = `${slugify(selected.title, 60) || 'voxarium-audio'}.${format}`;
      if (format === 'wav') {
        const result = await window.studio.audio.export({
          sourcePath: selected.filePath,
          format: 'wav',
          defaultName,
        });
        if (result.ok) toast('WAV exported.', 'success', result.filePath);
      } else {
        const bytes = await window.studio.audio.read(selected.filePath);
        const buffer = await decodeAudioFile(bytes);
        const mp3 = encodeMp3(buffer.getChannelData(0), buffer.sampleRate);
        const result = await window.studio.audio.export({ bytes: mp3, format: 'mp3', defaultName });
        if (result.ok) toast('MP3 exported.', 'success', result.filePath);
      }
    } catch (error) {
      toast('The recording could not be exported.', 'error', errorText(error));
    } finally {
      setExporting(null);
    }
  };

  const removeSelected = async () => {
    if (!selected) return;
    const removed = await deleteHistory(selected.id);
    if (removed) toast('Recording deleted.', 'success');
  };

  return (
    <div className="page page--history">
      <PageHeader
        icon="history"
        eyebrow="Library"
        title="Your recordings"
        description={`${pluralize(history.length, 'take')} · ${formatDuration(totalDuration)} of speech · ${formatBytes(totalBytes)} on disk`}
        actions={
          <>
            <button className="btn btn--subtle" onClick={() => void window.studio.paths.reveal('audio')}>
              <Icon name="folder" size={15} /> Audio folder
            </button>
            <button className="btn btn--subtle btn--danger-text" onClick={() => void clearHistory()} disabled={!history.length}>
              <Icon name="trash" size={15} /> Clear all
            </button>
          </>
        }
      />

      {!history.length ? (
        <div className="empty empty--large">
          <span className="empty__icon">
            <Icon name="waveform" size={28} />
          </span>
          <strong>No recordings yet</strong>
          <p>Everything you generate is saved here with its script, voice and settings, so you can revisit or export it later.</p>
          <button className="btn btn--primary" onClick={() => setPage('studio')}>
            <Icon name="sparkles" size={15} /> Create your first take
          </button>
        </div>
      ) : (
        <div className="history-layout">
          <section className="history-list">
            <div className="history-list__head">
              <label className="search search--compact">
                <Icon name="search" size={15} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recordings…" />
                {query && (
                  <button className="search__clear" onClick={() => setQuery('')} aria-label="Clear search">
                    <Icon name="x" size={12} />
                  </button>
                )}
              </label>
              <button
                className={classNames('filter-chip filter-chip--icon', favoritesOnly && 'is-active')}
                onClick={() => setFavoritesOnly((value) => !value)}
                title="Show favorites only"
              >
                <Icon name="star" size={14} /> {favoriteCount}
              </button>
            </div>

            <div className="history-list__scroll">
              {entries.map((entry) => {
                const active = player.meta?.id === entry.id;
                return (
                  <div
                    key={entry.id}
                    className={classNames('history-item', entry.id === selectedId && 'is-selected', active && 'is-active')}
                    onClick={() => setSelectedId(entry.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(entry.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="history-item__art">
                      <VoiceAvatar voiceId={entry.voiceId} size="sm" />
                      <button
                        className={classNames('history-item__play', active && player.playing && 'is-playing')}
                        onClick={(event) => {
                          event.stopPropagation();
                          void playEntry(entry);
                        }}
                        aria-label={active && player.playing ? 'Pause' : 'Play recording'}
                      >
                        <Icon name={active && player.playing ? 'pause' : 'play'} size={12} />
                      </button>
                    </span>
                    <span className="history-item__body">
                      <span className="history-item__title">
                        {entry.title}
                        {entry.favorite && <Icon name="star" size={11} className="history-item__star" />}
                      </span>
                      <span className="history-item__meta">
                        {entry.voiceName} · {formatDate(entry.createdAt)}
                      </span>
                      <span className="history-item__wave">
                        <Waveform peaks={entry.peaks} bars={44} quiet className="waveform--mini" />
                      </span>
                    </span>
                    <span className="history-item__aside">
                      <span>{formatDuration(entry.duration)}</span>
                      <em>{formatBytes(entry.bytes)}</em>
                    </span>
                  </div>
                );
              })}
              {!entries.length && (
                <div className="history-list__empty">
                  <Icon name="search" size={20} />
                  <strong>No matches</strong>
                  <span>Try a different search or turn off favorites.</span>
                </div>
              )}
            </div>
          </section>

          {selected ? (
            <section className="history-detail">
              <div className="history-detail__head">
                <div className="history-detail__title">
                  {editing ? (
                    <div className="history-detail__rename">
                      <input
                        className="input"
                        value={titleDraft}
                        autoFocus
                        maxLength={120}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveTitle();
                          if (event.key === 'Escape') {
                            setEditing(false);
                            setTitleDraft(selected.title);
                          }
                        }}
                      />
                      <button className="btn btn--primary btn--sm" onClick={() => void saveTitle()}>
                        <Icon name="check" size={14} /> Save
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          setEditing(false);
                          setTitleDraft(selected.title);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <h2>{selected.title}</h2>
                      <button
                        className="btn btn--icon btn--ghost"
                        onClick={() => {
                          setEditing(true);
                          setTitleDraft(selected.title);
                        }}
                        title="Rename recording"
                        aria-label="Rename recording"
                      >
                        <Icon name="edit" size={15} />
                      </button>
                    </>
                  )}
                  <span className="history-detail__date">{formatDateTime(selected.createdAt)}</span>
                </div>
                <div className="history-detail__head-actions">
                  <button
                    className={classNames('icon-toggle', selected.favorite && 'is-on')}
                    onClick={() => void toggleFavorite(selected)}
                    title={selected.favorite ? 'Remove from favorites' : 'Add to favorites'}
                    aria-label={selected.favorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Icon name="star" size={17} />
                  </button>
                  <button
                    className="btn btn--subtle btn--sm"
                    onClick={() => reuseHistory(selected)}
                    title="Load this script and voice into the studio"
                  >
                    <Icon name="edit" size={14} /> Reuse
                  </button>
                  <button
                    className="btn btn--icon btn--ghost btn--danger-text"
                    onClick={() => void removeSelected()}
                    title="Delete recording"
                    aria-label="Delete recording"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>

              {!fileExists && (
                <div className="banner banner--error">
                  <span className="banner__icon">
                    <Icon name="alert" size={16} />
                  </span>
                  <div className="banner__body">
                    <strong>The audio file is missing</strong>
                    <span>It may have been moved or deleted outside the app. Playback and export are unavailable.</span>
                  </div>
                </div>
              )}

              <div className="history-detail__player">
                <button
                  className="play-big play-big--lg"
                  onClick={() => void playEntry(selected)}
                  disabled={!fileExists}
                  aria-label="Play recording"
                >
                  <Icon
                    name={player.meta?.id === selected.id && player.playing ? 'pause' : 'play'}
                    size={24}
                  />
                </button>
                <div className="history-detail__wave">
                  <HistoryWaveform entry={selected} disabled={!fileExists} onPlay={() => void playEntry(selected)} />
                </div>
              </div>

              <div className="history-detail__actions">
                <button className="btn btn--subtle btn--sm" onClick={() => void exportRecording('wav')} disabled={!fileExists || exporting !== null}>
                  <Icon name={exporting === 'wav' ? 'loader' : 'download'} size={14} className={exporting === 'wav' ? 'spin' : undefined} />
                  Download WAV
                </button>
                <button className="btn btn--subtle btn--sm" onClick={() => void exportRecording('mp3')} disabled={!fileExists || exporting !== null}>
                  <Icon name={exporting === 'mp3' ? 'loader' : 'download'} size={14} className={exporting === 'mp3' ? 'spin' : undefined} />
                  Download MP3
                </button>
                <button className="btn btn--subtle btn--sm" onClick={() => void window.studio.audio.reveal(selected.filePath)} disabled={!fileExists}>
                  <Icon name="folder" size={14} /> Show in folder
                </button>
                <button className="btn btn--subtle btn--sm" onClick={() => void window.studio.audio.open(selected.filePath)} disabled={!fileExists}>
                  <Icon name="external" size={14} /> Open
                </button>
                <button
                  className="btn btn--subtle btn--sm"
                  onClick={() => {
                    void window.studio.ui.copy(selected.text);
                    toast('Script copied.', 'success');
                  }}
                >
                  <Icon name="copy" size={14} /> Copy script
                </button>
              </div>

              <div className="history-detail__grid">
                <div className="detail-block">
                  <h3>Take details</h3>
                  <dl className="detail-list">
                    <div>
                      <dt>Voice</dt>
                      <dd>
                        <span className="detail-voice">
                          <VoiceAvatar voiceId={selected.voiceId} size="xs" />
                          {selected.voiceName}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Duration</dt>
                      <dd>{formatDurationPrecise(selected.duration)}</dd>
                    </div>
                    <div>
                      <dt>File size</dt>
                      <dd>{formatBytes(selected.bytes)} · 24 kHz</dd>
                    </div>
                    <div>
                      <dt>Precision</dt>
                      <dd>{selected.meta?.quality?.toUpperCase() || '—'}</dd>
                    </div>
                    <div>
                      <dt>Device</dt>
                      <dd>{selected.meta?.device === 'webgpu' ? 'WebGPU' : selected.meta?.device === 'cpu' ? 'CPU' : 'Auto'}</dd>
                    </div>
                    <div>
                      <dt>Temperature</dt>
                      <dd>{selected.meta?.temperature?.toFixed(2) ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Seed</dt>
                      <dd className="mono">{selected.meta?.seed || '—'}</dd>
                    </div>
                    <div>
                      <dt>Rewrites</dt>
                      <dd>{selected.meta?.rewrites || '—'}</dd>
                    </div>
                  </dl>
                </div>

                <div className="detail-block">
                  <h3>Generation</h3>
                  {selected.stats ? (
                    <dl className="detail-list">
                      <div>
                        <dt>Total time</dt>
                        <dd>{formatDurationPrecise((selected.stats.totalMs || 0) / 1000)}</dd>
                      </div>
                      <div>
                        <dt>First audio</dt>
                        <dd>{selected.stats.firstAudioMs != null ? `${Math.round(selected.stats.firstAudioMs)} ms` : '—'}</dd>
                      </div>
                      <div>
                        <dt>Per frame</dt>
                        <dd>{selected.stats.stepMs ? `${selected.stats.stepMs.avg.toFixed(1)} ms avg` : '—'}</dd>
                      </div>
                      <div>
                        <dt>Chunks</dt>
                        <dd>{selected.stats.chunks ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>Tokens</dt>
                        <dd>{selected.stats.tokens ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>Frames</dt>
                        <dd>{selected.stats.frames ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>Samples</dt>
                        <dd>{selected.stats.samples?.toLocaleString() ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>Realtime</dt>
                        <dd>
                          {selected.stats.totalMs && selected.duration
                            ? `${(selected.stats.totalMs / 1000 / selected.duration).toFixed(2)}×`
                            : '—'}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="detail-muted">Timing details were not captured for this take.</p>
                  )}
                </div>
              </div>

              <div className="history-detail__script">
                <div className="history-detail__script-head">
                  <h3>Script</h3>
                  <span>{selected.text.length.toLocaleString()} characters</span>
                </div>
                <p>{selected.text}</p>
              </div>

              <p className="history-detail__path">
                <Icon name="fileText" size={13} />
                {selected.filePath}
              </p>
            </section>
          ) : (
            <div className="history-detail history-detail--empty">
              <Icon name="cursor" size={24} />
              <strong>Select a recording</strong>
              <p>Pick a take on the left to see its waveform, settings and script.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryWaveform({
  entry,
  disabled,
  onPlay,
}: {
  entry: HistoryEntry;
  disabled: boolean;
  onPlay: () => void;
}) {
  const player = usePlayer();
  const time = usePlaybackTime();
  const active = player.meta?.id === entry.id;
  const duration = active ? player.duration : entry.duration;
  const progress = active && duration ? time / duration : 0;
  return (
    <>
      <Waveform
        peaks={entry.peaks}
        progress={progress}
        bars={170}
        onSeek={
          disabled
            ? undefined
            : (ratio) => {
                if (active) player.seek(ratio * player.duration);
                else onPlay();
              }
        }
      />
      <div className="history-detail__time">
        <span>{clock(active ? time : 0)}</span>
        <span>{clock(duration)}</span>
      </div>
    </>
  );
}
