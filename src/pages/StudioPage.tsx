// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getVoice, localeFlags, localeLabel } from '../data/catalog';
import { LivePlayer, computePeaks, encodeMp3, encodeWavBuffer } from '../lib/audio';
import {
  arabicVarietiesFor,
  capabilityEnabled,
  capabilityReason,
  languageLabel,
  modelHasArabic,
  supportsLanguage,
  voiceCompatibilityNote,
} from '../models/compat';
import { fitTone, assessFit } from '../models/fit';
import { licenseBadge } from '../models/license';
import {
  applyPronunciations,
  buildBaseName,
  countSentences,
  countWords,
  estimateDuration,
  formatBytes,
  formatDuration,
  formatDurationPrecise,
  randomSeed,
  titleFromText,
} from '../lib/utils';
import { usePlayer, usePlaybackTime } from '../player';
import { useStudio } from '../state';
import type { HistoryEntry, SpeechStats } from '../types';
import { Icon } from '../components/Icons';
import { modKey, shortcut } from '../lib/platform';
import { ModelRequired, PageHeader } from '../components/PageHeader';
import { ExpressionPanel } from '../components/ExpressionPanel';
import { VoiceAvatar } from '../components/VoiceAvatar';
import { insertTag } from '../models/expression';
import { VoicePicker } from '../components/VoicePicker';
import { LiveWaveform, Waveform } from '../components/Waveform';
import { classNames } from '../lib/utils';

interface RenderResult {
  id: string;
  pcm: Float32Array;
  stats: SpeechStats | null;
  text: string;
  voiceId: string;
  duration: number;
  elapsedMs: number;
  createdAt: number;
  saved: HistoryEntry | null;
}

const SAMPLES = [
  {
    label: 'Narration',
    text: 'The lighthouse had stood at the edge of the world for two hundred years, and on clear nights its beam still swept the water like a patient hand. Sailors said the light remembered every ship it had ever guided home.',
  },
  {
    label: 'Podcast',
    text: "Welcome back to The Long Take. I'm your host, and today we're doing something a little different: we're going to talk about the sounds we usually ignore — the hum of a fridge, the tick of a radiator, the distant train at 2 a.m.",
  },
  {
    label: 'Product',
    text: 'Meet the new Aperture One. A camera small enough to forget, sharp enough to remember. With a full-frame sensor, eight stops of stabilization, and a battery that outlasts the day.',
  },
  {
    label: 'Character',
    text: 'Oh, you want the treasure? Everyone wants the treasure. They climb the mountain, they solve the riddles, they argue with the wind — and not one of them ever asks the dragon how her day is going.',
  },
  {
    label: 'Meditation',
    text: 'Settle into a comfortable position. Let your shoulders soften. Breathe in slowly through your nose, and out through your mouth. There is nowhere else you need to be right now.',
  },
];

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function temperatureLabel(value: number): string {
  if (value < 0.2) return 'Very steady';
  if (value < 0.42) return 'Balanced';
  if (value < 0.65) return 'Expressive';
  return 'Wild';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && /abort|cancel/i.test(error.message))
  );
}

interface StudioPageProps {
  onOpenSetup: () => void;
}

export function StudioPage({ onOpenSetup }: StudioPageProps) {
  const {
    settings,
    model,
    models,
    engine,
    studioText,
    setStudioText,
    importText,
    toast,
    saveGeneration,
    updateSettings,
    setPage,
  } = useStudio();
  const player = usePlayer();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [streamSamples, setStreamSamples] = useState(0);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState<'wav' | 'mp3' | null>(null);
  const [saving, setSaving] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const liveRef = useRef<LivePlayer | null>(null);
  const startRef = useRef(0);

  const voice = getVoice(settings?.lastVoice);
  const activeModel = models.activeModel;
  const activeFit = assessFit(activeModel, models.hardware);
  const activeLicense = licenseBadge(activeModel.license);
  const voiceWarning = voiceCompatibilityNote(activeModel, voice);
  const arabicVarieties = arabicVarietiesFor(activeModel);
  const showArabic = modelHasArabic(activeModel);
  const languageSupported = supportsLanguage(activeModel, settings?.language);
  const capabilityChips = [
    { key: 'voiceClone' as const, label: 'Cloning' },
    { key: 'multiSpeaker' as const, label: 'Dialogue' },
    { key: 'emotion' as const, label: 'Emotion' },
    { key: 'streaming' as const, label: 'Streaming' },
    { key: 'arabic' as const, label: 'Arabic' },
  ];
  /** Inserts an expression tag at the editor's cursor and keeps focus there. */
  const insertExpressionTag = (token: string) => {
    const area = editorRef.current;
    const start = area?.selectionStart ?? studioText.length;
    const end = area?.selectionEnd ?? studioText.length;
    const next = insertTag(studioText, start, end, token);
    if (next.text.length > 6000) return;
    setStudioText(next.text);
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const stats = useMemo(() => {
    const text = studioText;
    return {
      words: countWords(text),
      sentences: countSentences(text),
      seconds: estimateDuration(text),
      characters: text.length,
    };
  }, [studioText]);
  const pronunciation = useMemo(
    () => applyPronunciations(studioText, settings?.pronunciations || []),
    [studioText, settings?.pronunciations],
  );
  const resultPeaks = useMemo(
    () => (result ? computePeaks(result.pcm, 160) : []),
    [result?.id],
  );

  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => setElapsed((performance.now() - startRef.current) / 1000), 90);
    return () => clearInterval(timer);
  }, [generating]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      liveRef.current?.dispose();
    },
    [],
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const generate = useCallback(async () => {
    if (generating) {
      stopGeneration();
      return;
    }
    if (!settings) return;
    if (!studioText.trim()) {
      toast('Write something for the model to say.', 'info');
      return;
    }
    if (engine.status !== 'ready') {
      if (!model?.installed) onOpenSetup();
      else if (engine.status === 'error') toast('The engine needs attention.', 'error', engine.error || undefined);
      else toast('The engine is still warming up.', 'info');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    startRef.current = performance.now();
    setGenerating(true);
    setElapsed(0);
    setStreamSamples(0);
    setResult(null);

    const live = settings.streaming ? new LivePlayer() : null;
    if (live) {
      live.start();
      liveRef.current = live;
    }

    const renderId = crypto.randomUUID();
    const voiceId = settings.lastVoice || 'default';
    const spoken = pronunciation.text;
    let streamedAudio = false;

    try {
      const output = await engine.synthesize({
        text: spoken,
        voiceId,
        temperature: settings.temperature,
        seed: settings.seed,
        signal: controller.signal,
        keepPartial: true,
        onChunk: (pcm, total) => {
          streamedAudio = true;
          if (live) live.enqueue(pcm);
          setStreamSamples(total);
        },
      });
      const duration = output.pcm.length / 24000;
      const elapsedMs = performance.now() - startRef.current;
      const next: RenderResult = {
        id: renderId,
        pcm: output.pcm,
        stats: output.stats,
        text: studioText,
        voiceId,
        duration,
        elapsedMs,
        createdAt: Date.now(),
        saved: null,
      };
      setResult(next);
      player.playPcm(
        output.pcm,
        {
          id: renderId,
          title: titleFromText(studioText),
          subtitle: `${voice.name} · ${formatDuration(duration)}`,
          voiceId,
          voiceName: voice.name,
          peaks: computePeaks(output.pcm, 160),
          badge: settings.quality.toUpperCase(),
          createdAt: Date.now(),
        },
        { autoplay: settings.autoPlay && !(settings.streaming && streamedAudio) },
      );

      if (output.stats?.cancelled) {
        toast('Generation stopped.', 'info', `${formatDurationPrecise(duration)} of audio was kept.`);
      } else {
        toast('Speech rendered.', 'success', `${formatDurationPrecise(duration)} · ${(elapsedMs / 1000).toFixed(1)}s`);
      }

      if (settings.autoSave && duration > 0.05) {
        const saved = await saveGeneration({ pcm: output.pcm, text: studioText, voiceId, stats: output.stats });
        if (saved) {
          setResult((current) => (current && current.id === renderId ? { ...current, saved } : current));
        }
      }
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) {
        toast('Generation stopped.', 'info');
      } else {
        toast('Speech generation failed.', 'error', errorText(error));
      }
    } finally {
      live?.dispose();
      if (liveRef.current === live) liveRef.current = null;
      abortRef.current = null;
      setGenerating(false);
      setElapsed(0);
    }
  }, [
    engine,
    generating,
    model?.installed,
    onOpenSetup,
    player,
    pronunciation.text,
    saveGeneration,
    settings,
    stopGeneration,
    studioText,
    toast,
    voice.name,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void generate();
      }
      if (event.key === 'Escape' && generating) {
        event.preventDefault();
        stopGeneration();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [generate, generating, stopGeneration]);

  const clearScript = async () => {
    if (!studioText) return;
    const confirmed = await window.studio.ui.confirm({
      title: 'Clear the script?',
      message: 'This removes the text in the editor.',
      detail: 'Your history and rendered audio are not affected.',
      confirmLabel: 'Clear script',
      danger: true,
    });
    if (confirmed) setStudioText('');
  };

  const previewVoice = async () => {
    if (engine.status !== 'ready') {
      if (!model?.installed) onOpenSetup();
      else toast('The engine is still warming up.', 'info');
      return;
    }
    if (engine.busy) {
      toast('Wait for the current render to finish.', 'info');
      return;
    }
    setPreviewing(true);
    try {
      const output = await engine.preview(voice.id);
      player.playPcm(
        output.pcm,
        {
          id: `preview-${voice.id}-${Date.now()}`,
          title: `${voice.name} · preview`,
          subtitle: 'Voice preview',
          voiceId: voice.id,
          voiceName: voice.name,
          peaks: computePeaks(output.pcm, 120),
        },
        { autoplay: true },
      );
    } catch (error) {
      toast('The voice preview could not be generated.', 'error', errorText(error));
    } finally {
      setPreviewing(false);
    }
  };

  const saveCurrent = async () => {
    if (!result || result.saved) return;
    setSaving(true);
    const saved = await saveGeneration({
      pcm: result.pcm,
      text: result.text,
      voiceId: result.voiceId,
      stats: result.stats,
    });
    if (saved) {
      setResult((current) => (current ? { ...current, saved } : current));
      toast('Saved to history.', 'success', saved.fileName);
    }
    setSaving(false);
  };

  const exportAudio = async (format: 'wav' | 'mp3') => {
    if (!result || !settings) return;
    setExporting(format);
    try {
      const bytes = format === 'wav' ? encodeWavBuffer(result.pcm, 24000) : encodeMp3(result.pcm, 24000);
      const defaultName = buildBaseName(settings.filenameTemplate, { voice: voice.name, text: result.text });
      const response = await window.studio.audio.export({
        bytes,
        format,
        defaultName: `${defaultName}.${format}`,
      });
      if (response.ok && response.filePath) {
        toast(`Exported ${format.toUpperCase()}.`, 'success', response.filePath);
      }
    } catch (error) {
      toast('The audio could not be exported.', 'error', errorText(error));
    } finally {
      setExporting(null);
    }
  };

  const activeTrack = player.meta?.id === result?.id;
  const engineLabel = engine.info
    ? `${engine.info.device === 'webgpu' ? 'WebGPU' : 'CPU'} · ${engine.info.threads} thread${engine.info.threads === 1 ? '' : 's'}`
    : 'Starting…';

  const playResult = useCallback(
    (ratio?: number) => {
      if (!result) return;
      player.playPcm(
        result.pcm,
        {
          id: result.id,
          title: titleFromText(result.text),
          subtitle: `${voice.name} · ${formatDuration(result.duration)}`,
          voiceId: result.voiceId,
          voiceName: voice.name,
          peaks: resultPeaks,
        },
        { autoplay: true },
      );
      if (ratio && ratio > 0) player.seek(ratio * result.duration);
    },
    [player, result, resultPeaks, voice.name],
  );

  return (
    <div className="page page--studio">
      <PageHeader
        title="Create speech"
        description="Write a script, cast a voice, and render natural speech entirely on this device."
        actions={
          <>
            <button className="btn btn--subtle" onClick={() => setPage('models')}>
              <Icon name="layers" size={15} /> Models
            </button>
            <button className="btn btn--subtle" onClick={() => void importText()}>
              <Icon name="upload" size={15} /> Import
            </button>
            <button className="btn btn--subtle" onClick={() => setPage('history')}>
              <Icon name="history" size={15} /> History
            </button>
          </>
        }
      />

      <section className="model-strip" aria-label="Active voice model">
        <button className="model-strip__main" onClick={() => setPage('models')} title="Switch model">
          <span className="model-strip__mark">
            <Icon name="layers" size={16} />
          </span>
          <span className="model-strip__text">
            <strong>{activeModel.shortName}</strong>
            <em>{activeModel.family} · {activeModel.runtimeLabel}</em>
          </span>
          <Icon name="chevronRight" size={14} />
        </button>
        <div className="model-strip__badges">
          <span className={classNames('tag', `tag--${activeLicense.tone}`)} title={activeLicense.title}>
            {activeLicense.label}
          </span>
          <span className={classNames('tag', `tag--${fitTone(activeFit.level)}`)} title={activeFit.summary}>
            {activeFit.label}
          </span>
        </div>
        {/* Only what this model can do; unsupported features are explained where they would appear. */}
        <div className="model-strip__caps">
          {capabilityChips
            .filter((capability) => capabilityEnabled(activeModel, capability.key))
            .map((capability) => (
              <span key={capability.key} className="model-strip__cap" title={`${capability.label} is supported`}>
                {capability.label}
              </span>
            ))}
        </div>
      </section>

      {showArabic && (
        <div className="model-language-bar">
          <span className="tag tag--accent">
            <Icon name="globe" size={11} /> Arabic
          </span>
          <label className="model-language-bar__field">
            <span>Variety</span>
            <select
              className="select select--compact"
              value={settings?.arabicVariety || 'arb'}
              onChange={(event) => updateSettings({ arabicVariety: event.target.value })}
              disabled={arabicVarieties.length <= 1}
            >
              {arabicVarieties.map((variety) => (
                <option key={variety.code} value={variety.code}>
                  {variety.name}
                </option>
              ))}
            </select>
          </label>
          {arabicVarieties.length <= 1 && <em>Only Modern Standard Arabic is declared for this model.</em>}
        </div>
      )}

      {!languageSupported && (
        <div className="model-language-bar model-language-bar--warn">
          <Icon name="alert" size={14} />
          <span>
            {activeModel.shortName} does not declare {settings?.language?.toUpperCase()}. Pick a supported language in
            Settings before generating.
          </span>
        </div>
      )}

      {!model?.installed && <ModelRequired onOpenSetup={onOpenSetup} />}

      {model?.installed && engine.status === 'error' && (
        <div className="banner banner--error">
          <span className="banner__icon">
            <Icon name="alert" size={17} />
          </span>
          <div className="banner__body">
            <strong>The voice engine could not start</strong>
            <span>{engine.error}</span>
          </div>
          <button className="btn btn--subtle btn--sm" onClick={() => setPage('models')}>
            <Icon name="layers" size={14} /> Switch model
          </button>
          <button className="btn btn--subtle btn--sm" onClick={() => void engine.reload()}>
            <Icon name="refresh" size={14} /> Retry
          </button>
        </div>
      )}

      {engine.runtimeDirty && (
        <div className="banner banner--warn">
          <span className="banner__icon">
            <Icon name="refresh" size={17} />
          </span>
          <div className="banner__body">
            <strong>Engine settings changed</strong>
            <span>Reload the model to apply the new quality, device or thread settings.</span>
          </div>
          <button className="btn btn--subtle btn--sm" onClick={() => void engine.reload()}>
            Reload engine
          </button>
        </div>
      )}

      <div className="studio-grid">
        <div className="studio-main">
          <section className="card editor">
            <div className="editor__head">
              <div className="editor__label">
                <span className="editor__label-icon">
                  <Icon name="fileText" size={15} />
                </span>
                Script
                <span className="editor__count">{stats.characters.toLocaleString()} / 6,000</span>
              </div>
              <div className="editor__tools">
                <div className="editor__samples">
                  <span>Try</span>
                  {SAMPLES.map((sample) => (
                    <button
                      key={sample.label}
                      className="chip chip--tiny"
                      onClick={() => {
                        const next = studioText.trim() ? `${studioText.trimEnd()}\n\n${sample.text}` : sample.text;
                        setStudioText(next.slice(0, 6000));
                      }}
                    >
                      {sample.label}
                    </button>
                  ))}
                </div>
                <button className="btn btn--ghost btn--sm" onClick={() => setStudioText('')} disabled={!studioText}>
                  <Icon name="rotateCcw" size={14} /> Clear
                </button>
              </div>
            </div>
            <textarea
              ref={editorRef}
              className="editor__area"
              value={studioText}
              maxLength={6000}
              spellCheck
              placeholder="Type or paste your script here. The model reads numbers, dates and abbreviations naturally — and you can teach it names in the pronunciation dictionary."
              onChange={(event) => setStudioText(event.target.value)}
            />
            <div className="editor__foot">
              <div className="editor__stats">
                <span>
                  <strong>{stats.words.toLocaleString()}</strong> words
                </span>
                <span>
                  <strong>{stats.sentences.toLocaleString()}</strong> sentences
                </span>
                <span>
                  <Icon name="clock" size={13} /> ~{formatDuration(stats.seconds)}
                </span>
                {pronunciation.applied > 0 && (
                  <button className="editor__pron" onClick={() => setPage('settings')} title="Pronunciation rules are applied before speaking">
                    <Icon name="mic" size={13} /> {pronunciation.applied} replacement
                    {pronunciation.applied === 1 ? '' : 's'}
                  </button>
                )}
              </div>
              <button
                className={classNames('btn btn--primary btn--lg generate-btn', generating && 'is-stopping')}
                onClick={() => void generate()}
                title={`Generate speech (${shortcut('Enter')})`}
              >
                {generating ? (
                  <>
                    <Icon name="stop" size={16} /> Stop generating
                  </>
                ) : (
                  <>
                    Generate speech <kbd>{modKey} ↵</kbd>
                  </>
                )}
              </button>
            </div>
          </section>

          {generating ? (
            <section className="card render render--live">
              <div className="render__live-head">
                <span className="live-pill">
                  <span className="live-pill__dot" /> Rendering
                </span>
                <span className="render__live-time">{elapsed.toFixed(1)}s</span>
              </div>
              <LiveWaveform bars={64} />
              <div className="render__live-foot">
                <span>
                  <Icon name="voices" size={14} /> {voice.name}
                </span>
                <span>
                  <Icon name="wave" size={14} /> {formatDurationPrecise(streamSamples / 24000)} generated
                </span>
                <span className="render__live-note">
                  {streamSamples > 0 ? 'Audio is streaming to your speakers.' : 'Prompting the model…'}
                </span>
                <button className="btn btn--subtle btn--sm" onClick={stopGeneration}>
                  <Icon name="stop" size={13} /> Stop
                </button>
              </div>
            </section>
          ) : result ? (
            <section className="card render">
              <div className="render__head">
                <div className="render__title">
                  <span className={classNames('status-dot', result.stats?.cancelled && 'status-dot--warn')} />
                  <div>
                    <strong>{result.stats?.cancelled ? 'Partial render' : 'Latest render'}</strong>
                    <span>{titleFromText(result.text)}</span>
                  </div>
                  {result.saved ? (
                    <span className="tag tag--ok">
                      <Icon name="check" size={11} /> Saved
                    </span>
                  ) : (
                    <span className="tag">Not saved</span>
                  )}
                  {result.stats?.cancelled && <span className="tag tag--warn">Stopped early</span>}
                </div>
                <div className="render__actions">
                  {!result.saved && (
                    <button className="btn btn--subtle btn--sm" onClick={() => void saveCurrent()} disabled={saving}>
                      <Icon name={saving ? 'loader' : 'bookmark'} size={14} className={saving ? 'spin' : undefined} />
                      Save
                    </button>
                  )}
                  <button className="btn btn--subtle btn--sm" onClick={() => void exportAudio('wav')} disabled={exporting !== null}>
                    <Icon name={exporting === 'wav' ? 'loader' : 'download'} size={14} className={exporting === 'wav' ? 'spin' : undefined} />
                    WAV
                  </button>
                  <button className="btn btn--subtle btn--sm" onClick={() => void exportAudio('mp3')} disabled={exporting !== null}>
                    <Icon name={exporting === 'mp3' ? 'loader' : 'download'} size={14} className={exporting === 'mp3' ? 'spin' : undefined} />
                    MP3
                  </button>
                  <button
                    className="btn btn--icon btn--ghost"
                    title="Show in folder"
                    aria-label="Show in folder"
                    disabled={!result.saved}
                    onClick={() => {
                      if (result.saved) void window.studio.audio.reveal(result.saved.filePath);
                    }}
                  >
                    <Icon name="folder" size={16} />
                  </button>
                  <button
                    className="btn btn--icon btn--ghost"
                    title="Open audio"
                    aria-label="Open audio"
                    disabled={!result.saved}
                    onClick={() => {
                      if (result.saved) void window.studio.audio.open(result.saved.filePath);
                    }}
                  >
                    <Icon name="external" size={16} />
                  </button>
                </div>
              </div>

              <div className="render__player">
                <button
                  className="play-big"
                  onClick={() => {
                    if (activeTrack) player.toggle();
                    else playResult();
                  }}
                  aria-label={activeTrack && player.playing ? 'Pause' : 'Play render'}
                >
                  <Icon name={activeTrack && player.playing ? 'pause' : 'play'} size={22} />
                </button>
                <div className="render__wave">
                  <ResultWaveform result={result} peaks={resultPeaks} onPlay={playResult} />
                </div>
                <div className="render__wave-meta">
                  <strong>{formatDurationPrecise(result.duration)}</strong>
                  <span>{formatBytes(result.pcm.length * 2 + 44)} WAV</span>
                </div>
              </div>

              <div className="render__meta">
                <span className="tag tag--accent">
                  <Icon name="voices" size={11} /> {voice.name}
                </span>
                <span className="tag">
                  {localeFlags[voice.locale] || '🌐'} {localeLabel(voice.locale)}
                </span>
                <span className="tag">
                  <Icon name="layers" size={11} /> {activeModel.shortName}
                </span>
                {languageSupported && settings?.language && settings.language !== 'none' && (
                  <span className="tag">
                    <Icon name="globe" size={11} /> {languageLabel(activeModel, settings.language)}
                    {showArabic && settings.arabicVariety
                      ? ` · ${arabicVarieties.find((variety) => variety.code === settings.arabicVariety)?.name || 'MSA'}`
                      : ''}
                  </span>
                )}
                <span className="tag">{settings?.quality.toUpperCase()}</span>
                <span className="tag">{settings?.device === 'auto' ? 'Auto device' : settings?.device === 'webgpu' ? 'WebGPU' : 'CPU'}</span>
                <span className="tag">
                  <Icon name="clock" size={11} /> {(result.elapsedMs / 1000).toFixed(2)}s render
                </span>
                {result.stats?.firstAudioMs != null && (
                  <span className="tag">First audio {Math.round(result.stats.firstAudioMs)} ms</span>
                )}
                {result.stats?.totalMs != null && result.duration > 0 && (
                  <span className="tag">{(result.stats.totalMs / 1000 / result.duration).toFixed(2)}× realtime</span>
                )}
                {result.stats?.tokens != null && <span className="tag">{result.stats.tokens} tokens</span>}
              </div>
            </section>
          ) : (
            <section className="card render-empty">
              <span className="render-empty__icon">
                <Icon name="waveform" size={24} />
              </span>
              <div>
                <strong>Your render will appear here</strong>
                <p>
                  {activeModel.shortName} streams audio as it generates, then saves the take to your history. Use the buttons above to export
                  WAV or MP3 whenever you like.
                </p>
              </div>
              <div className="render-empty__hint">
                <Icon name="shield" size={13} /> Local only
              </div>
            </section>
          )}
        </div>

        <aside className="studio-side">
          <section className="card side-card voice-panel">
            <div className="side-card__head">
              <span className="side-card__title">Voice</span>
              <button className="link" onClick={() => setPickerOpen(true)}>
                Change <Icon name="chevronRight" size={13} />
              </button>
            </div>
            <button className="voice-current" onClick={() => setPickerOpen(true)}>
              <VoiceAvatar voiceId={voice.id} size="lg" />
              <span className="voice-current__info">
                <span className="voice-current__name">
                  {voice.name}
                  {voice.isDefault && <em className="tag tag--accent">Default</em>}
                </span>
                <span className="voice-current__meta">
                  {localeFlags[voice.locale] || '🌐'} {localeLabel(voice.locale)}
                  {voice.gender ? ` · ${voice.gender}` : ''}
                  {voice.age ? ` · ${voice.age}` : ''}
                </span>
                <span className="voice-current__desc">{voice.description}</span>
              </span>
              <Icon name="chevronRight" size={16} className="voice-current__chevron" />
            </button>
            {voiceWarning && (
              <p className="voice-panel__warn">
                <Icon name="alert" size={12} /> {voiceWarning}
              </p>
            )}
            <div className="voice-panel__actions">
              <button className="btn btn--subtle btn--sm" onClick={() => void previewVoice()} disabled={previewing || engine.busy}>
                <Icon name={previewing ? 'loader' : 'play'} size={14} className={previewing ? 'spin' : undefined} />
                {previewing ? 'Generating…' : 'Preview voice'}
              </button>
              <span className="voice-panel__hint">24 kHz mono</span>
            </div>
          </section>

          <ExpressionPanel
            model={activeModel}
            values={settings?.expression?.[activeModel.id]}
            onChange={(next) => updateSettings({ expression: { ...(settings?.expression || {}), [activeModel.id]: next } })}
            onInsertTag={insertExpressionTag}
          />

          <section className="card side-card">
            <div className="side-card__head">
              <span className="side-card__title">Delivery</span>
              <button className="link" onClick={() => setPage('settings')}>
                Settings <Icon name="chevronRight" size={13} />
              </button>
            </div>

            <label className="field">
              <span className="field__label">
                Temperature
                <em>{settings?.temperature.toFixed(2)} · {temperatureLabel(settings?.temperature || 0)}</em>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={settings?.temperature ?? 0.3}
                onChange={(event) => updateSettings({ temperature: Number(event.target.value) })}
                className="range"
              />
              <span className="field__hint">Lower is steadier, higher is more animated.</span>
            </label>

            <label className="field">
              <span className="field__label">
                Seed
                <em>reproducible takes</em>
              </span>
              <span className="input-row">
                <input
                  className="input input--mono"
                  value={settings?.seed || ''}
                  onChange={(event) => updateSettings({ seed: event.target.value.replace(/[^\d]/g, '').slice(0, 19) })}
                  inputMode="numeric"
                  spellCheck={false}
                  placeholder="4242424242424242"
                />
                <button
                  className="btn btn--icon btn--subtle"
                  onClick={() => updateSettings({ seed: randomSeed() })}
                  title="Randomize seed"
                  aria-label="Randomize seed"
                >
                  <Icon name="dice" size={16} />
                </button>
              </span>
              <span className="field__hint">Same text, voice and seed gives the same audio.</span>
            </label>

            <label className="switch-row">
              <span>
                <strong>Play while generating</strong>
                <em>
                  {capabilityEnabled(activeModel, 'streaming')
                    ? 'Hear audio as it streams in'
                    : capabilityReason(activeModel, 'streaming')}
                </em>
              </span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings?.streaming ?? true}
                  disabled={!capabilityEnabled(activeModel, 'streaming')}
                  onChange={(event) => updateSettings({ streaming: event.target.checked })}
                />
                <span className="switch__track">
                  <span className="switch__thumb" />
                </span>
              </span>
            </label>
            <label className="switch-row">
              <span>
                <strong>Autoplay finished takes</strong>
                <em>Replay when the render completes</em>
              </span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={settings?.autoPlay ?? true}
                  onChange={(event) => updateSettings({ autoPlay: event.target.checked })}
                />
                <span className="switch__track">
                  <span className="switch__thumb" />
                </span>
              </span>
            </label>
          </section>

          <section className="card side-card engine-mini">
            <div className="side-card__head">
              <span className="side-card__title">Local engine</span>
              <span className={classNames('status-dot', engine.status === 'ready' ? 'status-dot--ok' : engine.status === 'error' ? 'status-dot--danger' : 'status-dot--warn')} />
            </div>
            <dl className="engine-mini__list">
              <div>
                <dt>Model</dt>
                <dd>{activeModel.shortName}</dd>
              </div>
              <div>
                <dt>Device</dt>
                <dd>{engine.info ? (engine.info.device === 'webgpu' ? 'WebGPU' : 'CPU') : engine.stage || '—'}</dd>
              </div>
              <div>
                <dt>Threads</dt>
                <dd>{engine.info?.threads ?? '—'}</dd>
              </div>
              <div>
                <dt>Precision</dt>
                <dd>{settings?.quality.toUpperCase() || '—'}</dd>
              </div>
            </dl>
            {engine.runtimeDirty ? (
              <button className="btn btn--subtle btn--sm engine-mini__action" onClick={() => void engine.reload()}>
                <Icon name="refresh" size={14} /> Apply settings
              </button>
            ) : (
              <button className="btn btn--ghost btn--sm engine-mini__action" onClick={() => setPage('settings')}>
                <Icon name="settings" size={14} /> Engine settings
              </button>
            )}
            <p className="engine-mini__note">
              <Icon name="shield" size={12} /> Runs from disk · no network needed
            </p>
          </section>
        </aside>
      </div>

      <VoicePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onBrowse={() => { setPickerOpen(false); setPage('voices'); }} />
    </div>
  );
}

/** A tiny component so the playhead re-renders without re-rendering the editor. */
function ResultWaveform({
  result,
  peaks,
  onPlay,
}: {
  result: RenderResult;
  peaks: number[];
  onPlay: (ratio?: number) => void;
}) {
  const player = usePlayer();
  const time = usePlaybackTime();
  const active = player.meta?.id === result.id;
  const duration = active ? player.duration : result.duration;
  const progress = active && duration ? time / duration : 0;
  return (
    <>
      <Waveform
        peaks={peaks}
        progress={progress}
        bars={150}
        className="render__waveform"
        onSeek={(ratio) => {
          if (active) player.seek(ratio * player.duration);
          else onPlay(ratio);
        }}
      />
      <div className="render__wave-labels">
        <span>{clock(active ? time : 0)}</span>
        <span>{formatDuration(duration)}</span>
      </div>
    </>
  );
}
