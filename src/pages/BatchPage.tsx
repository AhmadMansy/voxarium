// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_VOICE_ID, VOICES, allVoices, getVoice, localeFlags, localeLabel } from '../data/catalog';
import { voiceCompatibilityNote, voiceCompatibleWithModel } from '../models/compat';
import {
  applyPronunciations,
  classNames,
  countWords,
  estimateDuration,
  formatDuration,
  formatDurationPrecise,
  slugify,
  titleFromText,
} from '../lib/utils';
import { usePlayer } from '../player';
import { useStudio } from '../state';
import type { HistoryEntry } from '../types';
import { Icon } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { VoiceAvatar } from '../components/VoiceAvatar';

interface BatchItem {
  index: number;
  text: string;
  voiceId: string;
  voiceName: string;
  warning?: string;
}

interface BatchResult {
  status: 'done' | 'error' | 'skipped';
  entry?: HistoryEntry;
  error?: string;
}

const MAX_ITEMS = 50;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && /abort|cancel/i.test(error.message))
  );
}

function parseLines(script: string, fallbackVoiceId: string): BatchItem[] {
  const voices = allVoices();
  const byName = new Map(voices.map((voice) => [voice.name.toLowerCase(), voice]));
  const byId = new Map(voices.map((voice) => [voice.id.toLowerCase(), voice]));
  const items: BatchItem[] = [];
  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^\[([^\]]{1,80})\]\s*(.+)$/);
    let text = line;
    let voiceId = fallbackVoiceId;
    let warning: string | undefined;
    if (match) {
      const token = match[1].trim();
      const voice = byName.get(token.toLowerCase()) || byId.get(token.toLowerCase());
      text = match[2].trim();
      if (voice) voiceId = voice.id;
      else warning = `Unknown voice “${token}” — using ${getVoice(fallbackVoiceId).name}`;
    }
    text = text.replace(/^[-–—•]\s*/, '').trim();
    if (!text) continue;
    const voice = getVoice(voiceId);
    items.push({
      index: items.length,
      text,
      voiceId,
      voiceName: voice.name,
      warning,
    });
  }
  return items;
}

export function BatchPage() {
  const { settings, engine, model, models, studioText, saveGeneration, setPage, toast, customVoices } = useStudio();
  const player = usePlayer();

  const [script, setScript] = useState(
    studioText.trim()
      ? studioText
      : '',
  );
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, BatchResult>>({});
  const [completed, setCompleted] = useState(0);
  const [voiceOverrides, setVoiceOverrides] = useState<Record<number, string>>({});
  const abortRef = useRef<AbortController | null>(null);

  const activeModel = models.activeModel;
  const studioVoiceId = settings?.lastVoice || DEFAULT_VOICE_ID;
  const fallbackVoiceId = voiceCompatibleWithModel(activeModel, getVoice(studioVoiceId))
    ? studioVoiceId
    : DEFAULT_VOICE_ID;

  const allItems = useMemo(() => {
    const parsed = parseLines(script, fallbackVoiceId);
    return parsed.map((item, index) => {
      const voiceId = voiceOverrides[index];
      if (!voiceId || voiceId === item.voiceId) return item;
      return { ...item, voiceId, voiceName: getVoice(voiceId).name };
    });
  }, [script, fallbackVoiceId, customVoices, voiceOverrides]);
  const items = useMemo(() => allItems.slice(0, MAX_ITEMS), [allItems]);
  const overflow = Math.max(0, allItems.length - MAX_ITEMS);
  const incompatible = useMemo(
    () => items.filter((item) => !voiceCompatibleWithModel(activeModel, getVoice(item.voiceId))),
    [items, activeModel],
  );
  const canSwitchAll = voiceCompatibleWithModel(activeModel, getVoice(DEFAULT_VOICE_ID));

  useEffect(() => {
    setVoiceOverrides({});
  }, [script, activeModel.id]);

  const words = useMemo(() => items.reduce((total, item) => total + countWords(item.text), 0), [items]);
  const estimated = useMemo(() => estimateDuration(items.map((item) => item.text).join(' ')), [items]);
  const uniqueVoices = useMemo(() => new Set(items.map((item) => item.voiceId)).size, [items]);
  const doneCount = Object.values(results).filter((result) => result.status === 'done').length;
  const failedCount = Object.values(results).filter((result) => result.status === 'error').length;

  useEffect(() => {
    if (!running) {
      setResults({});
      setCompleted(0);
      setActive(null);
    }
  }, [script]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const example = useMemo(() => {
    const a = VOICES[1] || getVoice('default');
    const b = VOICES[3] || a;
    return [
      `[${a.name}] Welcome to the morning briefing. Here are the three things worth knowing today.`,
      `[${b.name}] First: the city council approved the new riverside park, with work starting in spring.`,
      `[${a.name}] Second: train services return to normal after this weekend's engineering work.`,
      `[${b.name}] And finally — the weather. Bright spells this morning, with a chance of rain by four.`,
    ].join('\n');
  }, []);

  const switchAll = () => {
    const next: Record<number, string> = {};
    for (const item of incompatible) next[item.index] = DEFAULT_VOICE_ID;
    setVoiceOverrides((current) => ({ ...current, ...next }));
    toast(`Switched ${incompatible.length} line${incompatible.length === 1 ? '' : 's'} to ${getVoice(DEFAULT_VOICE_ID).name}.`, 'success');
  };

  const begin = async () => {
    if (running) {
      abortRef.current?.abort();
      return;
    }
    if (!settings) return;
    if (!items.length) {
      toast('Add at least one line to the batch.', 'info');
      return;
    }
    if (incompatible.length) {
      toast(
        `${incompatible.length} line${incompatible.length === 1 ? ' uses a voice' : 's use voices'} that ${activeModel.shortName} cannot speak.`,
        'error',
        canSwitchAll ? 'Use “Switch all” to move them to a compatible voice.' : 'Install a model with its own voice pack first.',
      );
      return;
    }
    if (engine.status !== 'ready') {
      if (!model?.installed) toast('Set up the model before running a batch.', 'info');
      else toast('The engine is still warming up.', 'info');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResults({});
    setCompleted(0);
    let failed = 0;
    let done = 0;

    for (const item of items) {
      if (controller.signal.aborted) break;
      setActive(item.index);
      try {
        const spoken = applyPronunciations(item.text, settings.pronunciations || []).text;
        const output = await engine.synthesize({
          text: spoken,
          voiceId: item.voiceId,
          temperature: settings.temperature,
          seed: settings.seed,
          signal: controller.signal,
        });
        const entry = await saveGeneration({
          pcm: output.pcm,
          text: item.text,
          voiceId: item.voiceId,
          stats: output.stats,
        });
        if (!entry) throw new Error('The audio could not be saved to history.');
        done += 1;
        setResults((prev) => ({ ...prev, [item.index]: { status: 'done', entry } }));
      } catch (error) {
        if (isAbort(error) || controller.signal.aborted) {
          setResults((prev) => ({ ...prev, [item.index]: { status: 'skipped' } }));
          break;
        }
        failed += 1;
        setResults((prev) => ({ ...prev, [item.index]: { status: 'error', error: errorText(error) } }));
      } finally {
        setCompleted((count) => count + 1);
      }
    }

    abortRef.current = null;
    setActive(null);
    setRunning(false);
    if (controller.signal.aborted) {
      toast('Batch stopped.', 'info', `${done} line${done === 1 ? '' : 's'} completed.`);
    } else if (failed) {
      toast('Batch finished with errors.', 'error', `${done} succeeded · ${failed} failed.`);
    } else {
      toast('Batch complete.', 'success', `${done} line${done === 1 ? '' : 's'} saved to history.`);
    }
  };

  const exportAll = async () => {
    const files = Object.values(results)
      .map((result) => result.entry)
      .filter((entry): entry is HistoryEntry => Boolean(entry))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((entry) => ({
        path: entry.filePath,
        name: slugify(entry.title, 70) || `phonon-${entry.id.slice(0, 6)}`,
      }));
    if (!files.length) return;
    const response = await window.studio.audio.exportMany(files);
    if (response.ok) toast(`Exported ${response.count} files.`, 'success', response.directory);
  };

  const playItem = async (result: BatchResult) => {
    if (!result.entry) return;
    if (player.meta?.id === result.entry.id) {
      player.toggle();
      return;
    }
    try {
      await player.playFile(result.entry.filePath, {
        id: result.entry.id,
        title: result.entry.title,
        subtitle: `${result.entry.voiceName} · ${formatDuration(result.entry.duration)}`,
        voiceId: result.entry.voiceId,
        voiceName: result.entry.voiceName,
        peaks: result.entry.peaks,
      });
    } catch (error) {
      toast('That clip could not be played.', 'error', errorText(error));
    }
  };

  const progress = items.length ? (completed / items.length) * 100 : 0;

  return (
    <div className="page page--batch">
      <PageHeader
        icon="batch"
        eyebrow="Batch"
        title="Render a whole script"
        description={`Put a voice in square brackets at the start of each line and ${models.activeModel.shortName} will cast every line automatically.`}
        actions={
          <>
            <button className="btn btn--subtle" onClick={() => setScript(example)} disabled={running}>
              <Icon name="fileText" size={15} /> Load example
            </button>
            <button className="btn btn--subtle" onClick={() => void window.studio.paths.reveal('audio')}>
              <Icon name="folder" size={15} /> Audio folder
            </button>
          </>
        }
      />

      <div className="batch-grid">
        <section className="card editor batch-editor">
          <div className="editor__head">
            <div className="editor__label">
              <span className="editor__label-icon">
                <Icon name="fileText" size={15} />
              </span>
              Batch script
              <span className="editor__count">{script.length.toLocaleString()} characters</span>
            </div>
            <div className="editor__tools">
              <button className="btn btn--ghost btn--sm" onClick={() => setScript('')} disabled={running || !script}>
                <Icon name="rotateCcw" size={14} /> Clear
              </button>
            </div>
          </div>
          <textarea
            className="editor__area batch-editor__area"
            value={script}
            maxLength={30000}
            spellCheck
            disabled={running}
            onChange={(event) => setScript(event.target.value)}
            placeholder={`[Zoey] Welcome back to the show — today we're talking about sound.\n[Phonon Default] Every line gets its own voice.\n\nOr write without brackets to use the voice from the studio.`}
          />
          <div className="editor__foot batch-editor__foot">
            <div className="editor__stats">
              <span>
                <strong>{items.length}</strong> lines
              </span>
              <span>
                <strong>{words.toLocaleString()}</strong> words
              </span>
              <span>
                <Icon name="clock" size={13} /> ~{formatDuration(estimated)}
              </span>
              <span>
                <Icon name="voices" size={13} /> {uniqueVoices} voice{uniqueVoices === 1 ? '' : 's'}
              </span>
            </div>
            <span className="editor__count">Max {MAX_ITEMS} lines per batch</span>
          </div>
        </section>

        <section className="card batch-queue">
          <div className="side-card__head batch-queue__head">
            <span className="side-card__title">Queue · {activeModel.shortName}</span>
            <span className="batch-queue__count">
              {items.length ? `${items.length} line${items.length === 1 ? '' : 's'}` : 'Empty'}
            </span>
          </div>

          {incompatible.length > 0 && (
            <div className="banner banner--warn batch-queue__warning">
              <span className="banner__icon">
                <Icon name="alert" size={16} />
              </span>
              <div className="banner__body">
                <strong>
                  {incompatible.length} voice{incompatible.length === 1 ? '' : 's'} incompatible with {activeModel.shortName}
                </strong>
                <span>{voiceCompatibilityNote(activeModel, getVoice(incompatible[0].voiceId))}</span>
              </div>
              <button className="btn btn--primary btn--sm" onClick={switchAll} disabled={!canSwitchAll}>
                <Icon name="refresh" size={14} /> Switch all
              </button>
            </div>
          )}

          {items.length ? (
            <div className="batch-queue__list">
              {items.map((item) => {
                const result = results[item.index];
                const isActive = active === item.index;
                const voice = getVoice(item.voiceId);
                const compatible = voiceCompatibleWithModel(activeModel, voice);
                return (
                  <div
                    key={item.index}
                    className={classNames(
                      'batch-item',
                      isActive && 'is-active',
                      result?.status === 'done' && 'is-done',
                      result?.status === 'error' && 'is-error',
                    )}
                  >
                    <span className="batch-item__index">
                      {isActive ? (
                        <Icon name="loader" size={15} className="spin" />
                      ) : result?.status === 'done' ? (
                        <Icon name="check" size={14} />
                      ) : result?.status === 'error' ? (
                        <Icon name="alert" size={14} />
                      ) : result?.status === 'skipped' ? (
                        <Icon name="minus" size={14} />
                      ) : (
                        String(item.index + 1).padStart(2, '0')
                      )}
                    </span>
                    <div className="batch-item__body">
                      <div className="batch-item__voice">
                        <VoiceAvatar voiceId={item.voiceId} size="xs" />
                        <span>{item.voiceName}</span>
                        <em>{localeFlags[voice.locale] || '🌐'} {localeLabel(voice.locale)}</em>
                        {item.warning && (
                          <span className="tag tag--warn" title={item.warning}>
                            <Icon name="alert" size={10} /> Unknown voice
                          </span>
                        )}
                        {!compatible && (
                          <span className="tag tag--danger" title={voiceCompatibilityNote(activeModel, voice) || undefined}>
                            <Icon name="alert" size={10} /> Incompatible
                          </span>
                        )}
                      </div>
                      <p>{item.text}</p>
                      {result?.status === 'error' && <span className="batch-item__error">{result.error}</span>}
                      {result?.status === 'done' && result.entry && (
                        <span className="batch-item__done">
                          <Icon name="checkCircle" size={12} /> {formatDurationPrecise(result.entry.duration)} saved
                        </span>
                      )}
                    </div>
                    {result?.status === 'done' && result.entry && (
                      <button
                        className={classNames('icon-toggle', player.meta?.id === result.entry.id && player.playing && 'is-on')}
                        onClick={() => void playItem(result)}
                        aria-label="Play clip"
                        title="Play clip"
                      >
                        <Icon name={player.meta?.id === result.entry.id && player.playing ? 'pause' : 'play'} size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
              {overflow > 0 && (
                <p className="batch-queue__overflow">
                  <Icon name="alert" size={14} /> {overflow} more line{overflow === 1 ? '' : 's'} will be ignored — batches are
                  capped at {MAX_ITEMS}.
                </p>
              )}
            </div>
          ) : (
            <div className="empty empty--compact batch-queue__empty">
              <Icon name="listChecks" size={24} />
              <strong>Nothing queued</strong>
              <span>Start each line with a voice name in brackets, like [Juniper] Hello there.</span>
            </div>
          )}

          <div className="batch-queue__foot">
            {running && (
              <div className="progress progress--sm">
                <span style={{ width: `${progress}%` }} />
              </div>
            )}
            <div className="batch-queue__status">
              <span>
                {running
                  ? `Rendering ${Math.min(completed + 1, items.length)} of ${items.length}…`
                  : doneCount
                    ? `${doneCount} done${failedCount ? ` · ${failedCount} failed` : ''}`
                    : 'Ready when you are'}
              </span>
              {doneCount > 0 && !running && (
                <button className="link" onClick={() => void exportAll()}>
                  Export all <Icon name="download" size={13} />
                </button>
              )}
            </div>
            <button
              className={classNames('btn btn--lg batch-queue__cta', running ? 'btn--danger' : 'btn--primary')}
              onClick={() => void begin()}
              disabled={!items.length || incompatible.length > 0 || (engine.status !== 'ready' && !running)}
            >
              {running ? (
                <>
                  <Icon name="stop" size={17} /> Stop batch
                </>
              ) : (
                <>
                  Generate {items.length || ''} line{items.length === 1 ? '' : 's'}
                </>
              )}
            </button>
            {!running && doneCount > 0 && (
              <button className="btn btn--ghost btn--sm" onClick={() => setPage('history')}>
                <Icon name="history" size={14} /> View in history
              </button>
            )}
          </div>
        </section>
      </div>

      <div className="batch-tips">
        <div>
          <span className="batch-tips__icon">
            <Icon name="voices" size={16} />
          </span>
          <div>
            <strong>Cast voices inline</strong>
            <p>Use the voice's name or its catalog ID. Unknown names fall back to your studio voice.</p>
          </div>
        </div>
        <div>
          <span className="batch-tips__icon">
            <Icon name="mic" size={16} />
          </span>
          <div>
            <strong>Pronunciation rules apply</strong>
            <p>Your dictionary from settings runs on every line before it is spoken.</p>
          </div>
        </div>
        <div>
          <span className="batch-tips__icon">
            <Icon name="folder" size={16} />
          </span>
          <div>
            <strong>Every take is saved</strong>
            <p>Finished lines land in history as WAV files, ready to export together.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
