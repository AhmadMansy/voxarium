// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computePeaks, decodeAudioFile, encodeWavBuffer, getAudioContext } from '../lib/audio';
import { classNames, formatDuration } from '../lib/utils';
import { useStudio } from '../state';
import type { VoiceInfo } from '../types';
import { Icon } from './Icons';
import { Modal } from './Modal';
import { Waveform } from './Waveform';

const MAX_SECONDS = 20;
const MIN_SECONDS = 2.5;
const BAR_COUNT = 44;
const LANGUAGE_OPTIONS = [
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'es', label: 'Spanish' },
  { id: 'pt', label: 'Portuguese' },
];
const READING_SCRIPT =
  'The quick brown fox jumps over the lazy dog. Every voice tells a story, and this one is about to tell yours.';

type RecordState = 'idle' | 'requesting' | 'recording' | 'recorded';

interface Clip {
  wav: ArrayBuffer;
  url: string;
  peaks: number[];
  seconds: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function secondsLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `0:${String(whole).padStart(2, '0')}`;
}

export function CloneVoiceModal() {
  const {
    settings,
    cloneTab,
    closeClone,
    cloneVoice,
    cloneKey,
    saveCloneKey,
    importVoiceFile,
    updateSettings,
    toast,
  } = useStudio();

  const open = cloneTab !== null;
  const cloudAllowed = settings?.allowCloudCloning !== false;
  const [tab, setTab] = useState<'record' | 'import'>('record');
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0.06));
  const [clip, setClip] = useState<Clip | null>(null);
  const [name, setName] = useState('My voice');
  const [language, setLanguage] = useState('en');
  const [consent, setConsent] = useState(false);
  const [consentAt, setConsentAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<VoiceInfo | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [showKeyField, setShowKeyField] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef(0);
  const meterTickRef = useRef(0);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipUrlRef = useRef<string | null>(null);
  const activeRef = useRef(false);

  const teardownRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {}
    }
    try {
      sourceRef.current?.disconnect();
    } catch {}
    sourceRef.current = null;
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const reset = useCallback(() => {
    activeRef.current = false;
    teardownRecording();
    if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    clipUrlRef.current = null;
    audioRef.current?.pause();
    setClip(null);
    setRecordState('idle');
    setElapsed(0);
    setLevels(new Array(BAR_COUNT).fill(0.06));
    setName('My voice');
    setLanguage('en');
    setConsent(false);
    setConsentAt(null);
    setBusy(false);
    setStage('');
    setError(null);
    setCreated(null);
    setKeyDraft('');
    setShowKeyField(false);
    setPlaying(false);
    setPlayProgress(0);
  }, [teardownRecording]);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    activeRef.current = true;
    setTab(cloneTab === 'import' || !cloudAllowed ? 'import' : 'record');
  }, [open, cloneTab, cloudAllowed, reset]);

  // Turning cloud cloning off while the modal is open drops back to the offline path.
  useEffect(() => {
    if (!cloudAllowed && tab === 'record') setTab('import');
  }, [cloudAllowed, tab]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) closeClone();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, closeClone]);

  useEffect(() => () => reset(), [reset]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    autoStopRef.current = true;
    try {
      recorder.stop();
    } catch {}
  }, []);

  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This system does not expose a microphone to the app.');
      return;
    }
    setRecordState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      const ctx = getAudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      sourceRef.current = source;
      analyserRef.current = analyser;

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      autoStopRef.current = false;

      const data = new Uint8Array(analyser.fftSize);

      const meter = (now: number) => {
        rafRef.current = requestAnimationFrame(meter);
        if (now - meterTickRef.current < 70) return;
        meterTickRef.current = now;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let index = 0; index < data.length; index += 1) {
          const value = (data[index] - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / data.length);
        const level = Math.max(0.05, Math.min(1, rms * 5.5));
        setLevels((prev) => [...prev.slice(1), level]);
      };

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        void (async () => {
          const chunks = chunksRef.current;
          chunksRef.current = [];
          const type = recorder.mimeType || mime || 'audio/webm';
          teardownRecording();
          if (autoStopRef.current) autoStopRef.current = false;
          if (!activeRef.current) return;
          if (!chunks.length) {
            setRecordState('idle');
            setError('Nothing was recorded. Check that your microphone is working and try again.');
            return;
          }
          try {
            const raw = await new Blob(chunks, { type }).arrayBuffer();
            const decoded = await decodeAudioFile(raw);
            const pcm = decoded.getChannelData(0).slice();
            const seconds = pcm.length / decoded.sampleRate;
            if (seconds < MIN_SECONDS) {
              setRecordState('idle');
              setError(`That was only ${seconds.toFixed(1)} seconds. Record at least ${MIN_SECONDS} seconds of speech.`);
              return;
            }
            const trimmed = pcm.subarray(0, Math.min(pcm.length, Math.round(MAX_SECONDS * decoded.sampleRate)));
            const wav = encodeWavBuffer(trimmed, decoded.sampleRate);
            const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
            if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
            clipUrlRef.current = url;
            setClip({
              wav,
              url,
              peaks: computePeaks(trimmed, 72),
              seconds: trimmed.length / decoded.sampleRate,
            });
            setElapsed(trimmed.length / decoded.sampleRate);
            setRecordState('recorded');
            setError(null);
          } catch (decodeError) {
            setRecordState('idle');
            setError(`The recording could not be processed. ${errorText(decodeError)}`);
          }
        })();
      };

      recorder.start(250);
      startedAtRef.current = performance.now();
      setElapsed(0);
      setLevels(new Array(BAR_COUNT).fill(0.06));
      setRecordState('recording');
      setPlayProgress(0);
      setPlaying(false);
      rafRef.current = requestAnimationFrame(meter);
      timerRef.current = setInterval(() => {
        const seconds = (performance.now() - startedAtRef.current) / 1000;
        setElapsed(Math.min(MAX_SECONDS, seconds));
        if (seconds >= MAX_SECONDS) {
          autoStopRef.current = true;
          stopRecording();
        }
      }, 100);
    } catch (microphoneError) {
      teardownRecording();
      setRecordState('idle');
      const message = errorText(microphoneError);
      setError(
        /denied|not allowed|permission/i.test(message)
          ? 'Microphone access was denied. Allow it for Voxarium in Windows privacy settings, then try again.'
          : `The microphone could not be opened. ${message}`,
      );
    }
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  };

  useEffect(() => {
    setPlaying(false);
    setPlayProgress(0);
  }, [clip?.url]);

  const submitClone = async () => {
    if (!clip || busy) return;
    if (!name.trim()) {
      setError('Give the voice a name.');
      return;
    }
    if (!consent) {
      setError('Confirm that you have the speaker’s permission to clone this voice.');
      return;
    }
    if (!consentAt) {
      setError('Tick the permission checkbox again to record your consent.');
      return;
    }
    if (!cloneKey?.hasKey) {
      setShowKeyField(true);
      setError('Add a Gradium API key to clone a voice.');
      return;
    }
    setError(null);
    setBusy(true);
    setStage('Starting…');
    const unsubscribe = window.studio.onCloneProgress((progress) => setStage(progress.message));
    try {
      const voice = await cloneVoice({ audio: clip.wav, name: name.trim(), language, consentAt });
      if (voice) {
        setCreated(voice);
        setStage('');
      }
    } catch (cloneError) {
      const message = errorText(cloneError);
      setError(
        /api key/i.test(message)
          ? 'Gradium rejected the API key. Check it below and try again.'
          : message,
      );
    } finally {
      unsubscribe();
      setBusy(false);
    }
  };

  const submitImport = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const voice = await importVoiceFile();
      if (voice) setCreated(voice);
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    const clean = keyDraft.trim();
    if (!clean) return;
    setSavingKey(true);
    const ok = await saveCloneKey(clean);
    setSavingKey(false);
    if (ok) {
      setKeyDraft('');
      setShowKeyField(false);
      setError(null);
    }
  };

  const useCreated = () => {
    if (!created) return;
    updateSettings({ lastVoice: created.id, defaultVoice: created.id });
    toast(`${created.name} is now in the studio.`, 'success');
    closeClone();
  };

  const keyLabel = useMemo(() => {
    if (!cloneKey) return 'Checking key…';
    if (cloneKey.hasKey) return cloneKey.encrypted ? 'Key saved · encrypted on this device' : 'Key saved on this device';
    return 'No Gradium API key yet';
  }, [cloneKey]);

  const recordLabel =
    recordState === 'requesting'
      ? 'Waiting for microphone…'
      : recordState === 'recording'
        ? 'Stop recording'
        : recordState === 'recorded'
          ? 'Record again'
          : 'Start recording';

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) closeClone();
      }}
      title="Add a voice"
      subtitle="Clone your own voice through Gradium — one short upload — or bring a voice file you already have."
      size="lg"
      icon={<Icon name="mic" size={18} />}
      footer={
        created ? (
          <>
            <span className="modal__foot-note">
              <Icon name="shield" size={14} /> Stored on this device
            </span>
            <button className="btn btn--subtle" onClick={() => setCreated(null)}>
              Add another
            </button>
            <button className="btn btn--primary" onClick={useCreated}>
              <Icon name="check" size={15} /> Use this voice
            </button>
          </>
        ) : (
          <>
            <span className="modal__foot-note">
              <Icon name="info" size={14} /> Voice files work with every Phonon checkpoint
            </span>
            <button className="btn btn--subtle" onClick={closeClone} disabled={busy}>
              Cancel
            </button>
            {tab === 'record' ? (
              <button
                className="btn btn--primary"
                onClick={() => void submitClone()}
                disabled={busy || !clip || !consent}
              >
                <Icon name={busy ? 'loader' : 'sparkles'} size={15} className={busy ? 'spin' : undefined} />
                {busy ? 'Cloning…' : 'Clone this voice'}
              </button>
            ) : (
              <button className="btn btn--primary" onClick={() => void submitImport()} disabled={busy}>
                <Icon name={busy ? 'loader' : 'upload'} size={15} className={busy ? 'spin' : undefined} />
                {busy ? 'Importing…' : 'Import voice file'}
              </button>
            )}
          </>
        )
      }
    >
      {created ? (
        <div className="clone-success">
          <span className="clone-success__icon">
            <Icon name="checkCircle" size={30} />
          </span>
          <strong>{created.name}</strong>
          <p>
            {created.description} It is already available in the voice picker, the studio and batch renders.
          </p>
          <div className="clone-success__tags">
            <span className="tag tag--ok">
              <Icon name="check" size={10} /> Ready
            </span>
            <span className="tag">{created.id.startsWith('c_') ? 'Custom voice' : 'Catalog voice'}</span>
            <span className="tag">{created.language.toUpperCase()}</span>
            {consentAt && tab === 'record' && (
              <span className="tag tag--ok" title={new Date(consentAt).toLocaleString()}>
                <Icon name="shield" size={10} /> Consent recorded
              </span>
            )}
          </div>
          {clip && tab === 'record' && (
            <div className="clone-success__clip">
              <div className="clip-player">
                <button className="btn btn--icon btn--primary" onClick={togglePlayback} aria-label={playing ? 'Pause' : 'Play'}>
                  <Icon name={playing ? 'pause' : 'play'} size={14} />
                </button>
                <Waveform
                  peaks={clip.peaks}
                  progress={playProgress}
                  bars={64}
                  onSeek={(ratio) => {
                    const audio = audioRef.current;
                    if (!audio) return;
                    audio.currentTime = ratio * clip.seconds;
                    setPlayProgress(ratio);
                  }}
                />
                <em>{formatDuration(clip.seconds)}</em>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="clone">
          <div className={classNames('clone-tabs', !cloudAllowed && 'clone-tabs--single')} role="tablist" aria-label="How to add a voice">
            {cloudAllowed && (
              <button
                role="tab"
                aria-selected={tab === 'record'}
                className={classNames('clone-tab', tab === 'record' && 'is-active')}
                onClick={() => setTab('record')}
                disabled={busy}
              >
                <Icon name="mic" size={15} />
                <span>
                  <strong>Record your voice</strong>
                  <em>Sends a 10–15 s clip to Gradium once</em>
                </span>
              </button>
            )}
            <button
              role="tab"
              aria-selected={tab === 'import'}
              className={classNames('clone-tab', tab === 'import' && 'is-active')}
              onClick={() => setTab('import')}
              disabled={busy}
            >
              <Icon name="upload" size={15} />
              <span>
                <strong>Import a voice file</strong>
                <em>Use a .safetensors · nothing is uploaded</em>
              </span>
            </button>
          </div>

          {tab === 'record' ? (
            <div className="clone-panel">
              <div className="cloud-note">
                <Icon name="globe" size={16} />
                <div>
                  <strong>Cloning happens in Gradium’s cloud, once</strong>
                  <p>
                    Your 10–15 second recording is sent to Gradium to build the voice. The resulting voice file is
                    downloaded here, and every generation afterwards runs entirely on this device. Nothing else leaves
                    your machine.
                  </p>
                </div>
                <button
                  className="link"
                  onClick={() => {
                    updateSettings({ allowCloudCloning: false });
                    setTab('import');
                    setError(null);
                  }}
                  disabled={busy}
                >
                  Turn off cloud cloning
                </button>
              </div>
              <div className={classNames('recorder', recordState === 'recording' && 'is-recording')}>
                <div className="recorder__stage">
                  <button
                    className={classNames('record-button', recordState === 'recording' && 'is-recording')}
                    onClick={() => {
                      if (recordState === 'recording') stopRecording();
                      else if (!busy) void startRecording();
                    }}
                    disabled={recordState === 'requesting' || busy}
                    aria-label={recordLabel}
                  >
                    <Icon
                      name={recordState === 'recording' ? 'stop' : recordState === 'requesting' ? 'loader' : 'mic'}
                      size={24}
                      className={recordState === 'requesting' ? 'spin' : undefined}
                    />
                  </button>
                  <div className="recorder__readout">
                    <strong>{secondsLabel(elapsed)}</strong>
                    <em>
                      {recordState === 'recording'
                        ? `${secondsLabel(MAX_SECONDS)} limit · speak naturally`
                        : recordState === 'recorded'
                          ? 'Recording captured'
                          : `Aim for 10–15 clear seconds`}
                    </em>
                  </div>
                </div>

                {recordState === 'recording' ? (
                  <div className="recorder__levels" aria-hidden="true">
                    {levels.map((level, index) => (
                      <span key={index} style={{ height: `${Math.round(level * 100)}%` }} />
                    ))}
                  </div>
                ) : clip ? (
                  <div className="clip-player">
                    <button className="btn btn--icon btn--primary" onClick={togglePlayback} aria-label={playing ? 'Pause' : 'Play'}>
                      <Icon name={playing ? 'pause' : 'play'} size={14} />
                    </button>
                    <Waveform
                      peaks={clip.peaks}
                      progress={playProgress}
                      bars={64}
                      onSeek={(ratio) => {
                        const audio = audioRef.current;
                        if (!audio) return;
                        audio.currentTime = ratio * clip.seconds;
                        setPlayProgress(ratio);
                      }}
                    />
                    <em>{formatDuration(clip.seconds)}</em>
                  </div>
                ) : (
                  <p className="recorder__hint">
                    <Icon name="info" size={13} />
                    {recordState === 'requesting'
                      ? 'Allow microphone access when Windows asks.'
                      : 'Find a quiet room and read the line below at a natural pace.'}
                  </p>
                )}
              </div>

              {!clip && recordState !== 'recording' && (
                <blockquote className="reading-script">
                  <Icon name="speaker" size={15} />
                  <span>“{READING_SCRIPT}”</span>
                </blockquote>
              )}

              <div className="clone-form">
                <label className="field">
                  <span>Voice name</span>
                  <input
                    value={name}
                    maxLength={60}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="My voice"
                    disabled={busy}
                  />
                </label>
                <label className="field">
                  <span>Recording language</span>
                  <select className="select" value={language} onChange={(event) => setLanguage(event.target.value)} disabled={busy}>
                    {LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <em>Phonon 31M speaks English; the voice keeps its character in any language.</em>
                </label>
              </div>

              <label className="check-row">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => {
                    setConsent(event.target.checked);
                    setConsentAt(event.target.checked ? Date.now() : null);
                  }}
                  disabled={busy}
                />
                <span>
                  I have the speaker’s permission to clone this voice, and I agree to send this recording to Gradium
                  once. <em>Impersonating someone without consent is not allowed.</em>
                </span>
              </label>

              <div className="clone-key">
                <div className="clone-key__head">
                  <span className="settings-card__icon">
                    <Icon name="key" size={15} />
                  </span>
                  <div>
                    <strong>Gradium API key</strong>
                    <em>{keyLabel}</em>
                  </div>
                  <button className="link" onClick={() => setShowKeyField((value) => !value)} disabled={busy}>
                    {cloneKey?.hasKey ? 'Replace' : 'Add key'}
                  </button>
                </div>
                {(showKeyField || !cloneKey?.hasKey) && (
                  <div className="clone-key__row">
                    <input
                      type="password"
                      value={keyDraft}
                      onChange={(event) => setKeyDraft(event.target.value)}
                      placeholder="Paste your Gradium API key"
                      spellCheck={false}
                      disabled={busy || savingKey}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveKey();
                      }}
                    />
                    <button className="btn btn--subtle btn--sm" onClick={() => void saveKey()} disabled={!keyDraft.trim() || savingKey}>
                      {savingKey ? 'Saving…' : 'Save key'}
                    </button>
                  </div>
                )}
                <p className="clone-key__note">
                  Cloning runs in Gradium’s cloud (the local model has no audio encoder). Create a key in{' '}
                  <button className="link" onClick={() => void window.studio.openExternal('https://studio.gradium.ai/')}>
                    Gradium Studio
                  </button>
                  . The key is stored {cloneKey?.encrypted === false ? 'in the app data folder' : 'encrypted'} on this device and
                  is only used for cloning.
                </p>
              </div>

              <ol className="clone-steps">
                <li>
                  <span>1</span> Record 10–15 seconds of clear speech — the clip is only used to build the voice.
                </li>
                <li>
                  <span>2</span> The clip is sent to Gradium once; the voice fingerprint is saved to your account.
                </li>
                <li>
                  <span>3</span> The voice file is downloaded here and works offline from then on.
                </li>
              </ol>

              {busy && (
                <div className="clone-progress">
                  <span className="clone-progress__bar" />
                  <div>
                    <strong>{stage || 'Working…'}</strong>
                    <em>This usually takes 10–40 seconds. Keep the app open.</em>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="clone-panel">
              {!cloudAllowed && (
                <div className="cloud-note cloud-note--off">
                  <Icon name="shield" size={16} />
                  <div>
                    <strong>Cloud cloning is off — import only</strong>
                    <p>
                      Voxarium will not send recordings anywhere. Import a voice file below, or turn cloud cloning
                      back on to record and clone in Gradium.
                    </p>
                  </div>
                  <button className="link" onClick={() => updateSettings({ allowCloudCloning: true })}>
                    Turn on
                  </button>
                </div>
              )}
              <div className="import-drop">
                <span className="import-drop__icon">
                  <Icon name="upload" size={26} />
                </span>
                <strong>Choose a Phonon voice file</strong>
                <p>
                  Every voice is a tiny <code>.safetensors</code> file with one <code>speaker_wavs</code> tensor. Download one
                  from Gradium Studio with <em>Download for Phonon</em>, or use any file someone shared with you.
                </p>
                <button className="btn btn--primary" onClick={() => void submitImport()} disabled={busy}>
                  <Icon name={busy ? 'loader' : 'folderOpen'} size={15} className={busy ? 'spin' : undefined} />
                  {busy ? 'Opening…' : 'Browse voice files'}
                </button>
                <div className="import-drop__meta">
                  <span>
                    <Icon name="check" size={12} /> No API key
                  </span>
                  <span>
                    <Icon name="check" size={12} /> Stays on this device
                  </span>
                  <span>
                    <Icon name="check" size={12} /> Validated before import
                  </span>
                </div>
              </div>

              <div className="import-note">
                <Icon name="shield" size={16} />
                <div>
                  <strong>Where do voice files come from?</strong>
                  <p>
                    Gradium’s voice catalog has hundreds of ready-made voices, and Studio can design or clone new ones. Either
                    way, the file you download is compatible with every Phonon checkpoint.
                  </p>
                  <button className="link" onClick={() => void window.studio.openExternal('https://studio.gradium.ai/')}>
                    Open Gradium Studio <Icon name="external" size={11} />
                  </button>
                </div>
              </div>

              <ol className="clone-steps">
                <li>
                  <span>1</span> In Gradium Studio, open a voice’s menu and choose <strong>Download for Phonon</strong>.
                </li>
                <li>
                  <span>2</span> Import the file here — it is validated and copied into your voice library.
                </li>
                <li>
                  <span>3</span> Pick it anywhere a catalog voice works, with no network needed.
                </li>
              </ol>
            </div>
          )}

          {error && (
            <div className="inline-error">
              <Icon name="alert" size={15} />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      {clip && (
        <audio
          ref={audioRef}
          src={clip.url}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPlayProgress(0);
          }}
          onTimeUpdate={(event) => {
            const audio = event.currentTarget;
            if (audio.duration) setPlayProgress(audio.currentTime / audio.duration);
          }}
        />
      )}
    </Modal>
  );
}
