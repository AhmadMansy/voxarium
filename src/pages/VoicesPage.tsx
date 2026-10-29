import { Fragment, useMemo, useState } from 'react';
import { VOICES, localeFlags, localeLabel } from '../data/catalog';
import { computePeaks } from '../lib/audio';
import { voiceCompatibilityNote, voiceCompatibleWithModel } from '../models/compat';
import { useFavoriteVoices } from '../lib/favorites';
import { classNames, formatBytes } from '../lib/utils';
import { usePlayer } from '../player';
import { useStudio } from '../state';
import type { VoiceInfo } from '../types';
import { Icon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { VoiceAvatar } from '../components/VoiceAvatar';

type VoiceFilter = 'all' | 'yours' | 'favorites' | 'downloaded' | 'characters';

const FILTERS: { id: VoiceFilter; label: string }[] = [
  { id: 'all', label: 'All voices' },
  { id: 'yours', label: 'Your voices' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'downloaded', label: 'Downloaded' },
  { id: 'characters', label: 'Characters' },
];

function previewError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function VoicesPage() {
  const {
    settings,
    model,
    models,
    engine,
    updateSettings,
    downloadVoice,
    downloadAllVoices,
    voiceDownloadBusy,
    customVoices,
    openClone,
    renameCustomVoice,
    deleteCustomVoice,
    toast,
  } = useStudio();
  const { favorites, isFavorite, toggle } = useFavoriteVoices();
  const player = usePlayer();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<VoiceFilter>('all');
  const [locale, setLocale] = useState('all');
  const [gender, setGender] = useState('all');
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<VoiceInfo | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingBusy, setRenamingBusy] = useState(false);

  const voices = useMemo(() => [...customVoices, ...VOICES], [customVoices]);
  const installed = useMemo(() => new Set(['default', ...(model?.voiceIds || [])]), [model?.voiceIds]);
  const selectedId = settings?.lastVoice || 'default';

  const isInstalled = (voice: VoiceInfo) => voice.source === 'custom' || installed.has(voice.id);

  const locales = useMemo(() => {
    const unique = Array.from(new Set(VOICES.map((voice) => voice.locale)));
    unique.sort((a, b) => localeLabel(a).localeCompare(localeLabel(b)));
    return unique;
  }, []);

  const counts = useMemo(
    () => ({
      all: voices.length,
      yours: customVoices.length,
      favorites: voices.filter((voice) => favorites.includes(voice.id)).length,
      downloaded: voices.filter((voice) => isInstalled(voice)).length,
      characters: VOICES.filter((voice) => voice.locale === 'characters').length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voices, customVoices.length, favorites, installed],
  );

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = voices.filter((voice) => {
      if (filter === 'yours' && voice.source !== 'custom') return false;
      if (filter === 'favorites' && !favorites.includes(voice.id)) return false;
      if (filter === 'downloaded' && !isInstalled(voice)) return false;
      if (filter === 'characters' && !voice.locale.includes('characters')) return false;
      if (locale !== 'all' && voice.locale !== locale) return false;
      if (gender !== 'all' && voice.gender !== gender) return false;
      if (!needle) return true;
      return `${voice.name} ${voice.description} ${voice.gender || ''} ${voice.age || ''} ${localeLabel(voice.locale)}`
        .toLowerCase()
        .includes(needle);
    });
    // Compatible voices lead; incompatible ones stay visible with a reason so the
    // catalog never silently disappears when a model is switched.
    return filtered.sort((a, b) => {
      const aOk = voiceCompatibleWithModel(models.activeModel, a) ? 0 : 1;
      const bOk = voiceCompatibleWithModel(models.activeModel, b) ? 0 : 1;
      return aOk - bOk;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter, locale, gender, favorites, installed, voices, models.activeModel]);

  const missing = useMemo(() => VOICES.filter((voice) => !installed.has(voice.id)), [installed]);
  const missingBytes = missing.length * 256136;

  const useVoice = (voice: VoiceInfo) => {
    updateSettings({ lastVoice: voice.id, defaultVoice: voice.id });
    toast(`${voice.name} is now in the studio.`, 'success');
  };

  const previewVoice = async (voice: VoiceInfo) => {
    if (previewingId) return;
    const activePreview = player.meta?.id.startsWith('voice-preview-') && player.meta.voiceId === voice.id;
    if (activePreview) {
      player.toggle();
      return;
    }
    if (engine.status !== 'ready') {
      toast('The engine is still warming up.', 'info');
      return;
    }
    setPreviewingId(voice.id);
    try {
      const output = await engine.preview(voice.id);
      player.playPcm(
        output.pcm,
        {
          id: `voice-preview-${voice.id}`,
          title: `${voice.name} · preview`,
          subtitle: `${localeLabel(voice.locale)}${voice.gender ? ` · ${voice.gender}` : ''}`,
          voiceId: voice.id,
          voiceName: voice.name,
          peaks: computePeaks(output.pcm, 120),
          badge: 'Preview',
        },
        { autoplay: true },
      );
    } catch (error) {
      toast('The preview could not be generated.', 'error', previewError(error));
    } finally {
      setPreviewingId(null);
    }
  };

  const downloadOne = async (voice: VoiceInfo) => {
    setDownloadingId(voice.id);
    const ok = await downloadVoice(voice.id);
    setDownloadingId(null);
    if (ok) toast(`${voice.name} is downloaded.`, 'success');
  };

  const downloadMissing = async () => {
    if (!missing.length) return;
    const ok = await downloadAllVoices(missing.map((voice) => voice.id));
    if (ok) toast('Every voice is now on this device.', 'success');
  };

  const beginRename = (voice: VoiceInfo) => {
    setRenaming(voice);
    setRenameValue(voice.name);
  };

  const commitRename = async () => {
    if (!renaming || renamingBusy) return;
    const clean = renameValue.trim();
    if (!clean || clean === renaming.name) {
      setRenaming(null);
      return;
    }
    setRenamingBusy(true);
    const ok = await renameCustomVoice(renaming.id, clean);
    setRenamingBusy(false);
    if (ok) setRenaming(null);
  };

  return (
    <div className="page page--voices">
      <PageHeader
        icon="voices"
        eyebrow="Voice library"
        title="Find a voice"
        description="Audition the cast, star the ones you love, and drop any voice straight into the studio — or add your own."
        actions={
          <>
            <button className="btn btn--subtle" onClick={() => void window.studio.paths.reveal('voices')}>
              <Icon name="folder" size={15} /> Voice files
            </button>
            <button className="btn btn--subtle" onClick={() => void downloadMissing()} disabled={voiceDownloadBusy || !missing.length}>
              <Icon name={voiceDownloadBusy ? 'loader' : 'download'} size={15} className={voiceDownloadBusy ? 'spin' : undefined} />
              {missing.length ? `Download ${missing.length}` : 'All voices saved'}
            </button>
            <button className="btn btn--primary" onClick={() => openClone('record')}>
              <Icon name="mic" size={15} /> Add a voice
            </button>
          </>
        }
      />

      <div className="notice">
        <Icon name="info" size={15} />
        <span>
          Showing compatibility with <strong>{models.activeModel.shortName}</strong>.{' '}
          {models.activeModel.voices.format === 'phonon-safetensors'
            ? 'Voices in the current language stay available; others are grouped below with the reason they cannot be used.'
            : models.activeModel.voices.note ||
              'This model brings its own voice pack, so the shared Phonon catalog cannot be used with it.'}{' '}
          Your own voices are cloned or imported once, then run entirely on this device.
        </span>
        <em>{formatBytes(missingBytes)} missing</em>
      </div>

      <div className="filter-bar">
        <div className="filter-chips">
          {FILTERS.filter((item) => item.id !== 'yours' || customVoices.length > 0).map((item) => (
            <button
              key={item.id}
              className={classNames('filter-chip', filter === item.id && 'is-active')}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span>{counts[item.id]}</span>
            </button>
          ))}
        </div>
        <div className="filter-fields">
          <label className="search search--compact">
            <Icon name="search" size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search voices…"
            />
            {query && (
              <button className="search__clear" onClick={() => setQuery('')} aria-label="Clear search">
                <Icon name="x" size={12} />
              </button>
            )}
          </label>
          <select className="select select--compact" value={locale} onChange={(event) => setLocale(event.target.value)}>
            <option value="all">Every accent</option>
            {locales.map((value) => (
              <option key={value} value={value}>
                {localeFlags[value] || '🌐'} {localeLabel(value)}
              </option>
            ))}
          </select>
          <select className="select select--compact" value={gender} onChange={(event) => setGender(event.target.value)}>
            <option value="all">Any voice</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </div>
      </div>

      {results.length ? (
        <div className="voice-grid">
          {results.map((voice, index) => {
            const custom = voice.source === 'custom';
            const downloaded = isInstalled(voice);
            const selected = selectedId === voice.id;
            const isPreviewing = previewingId === voice.id;
            const activePreview = player.meta?.id === `voice-preview-${voice.id}`;
            const downloading = downloadingId === voice.id;
            const compatible = voiceCompatibleWithModel(models.activeModel, voice);
            const previous = index > 0 ? results[index - 1] : null;
            const showDivider = !compatible && previous && voiceCompatibleWithModel(models.activeModel, previous);
            return (
              <Fragment key={voice.id}>
                {showDivider && (
                  <div className="voice-grid__divider">
                    <span>Not compatible with {models.activeModel.shortName}</span>
                  </div>
                )}
                <article className={classNames('voice-card', selected && 'is-selected', custom && 'is-custom', !compatible && 'is-incompatible')}>
                <div className="voice-card__top">
                  <VoiceAvatar voiceId={voice.id} size="xl" />
                  <div className="voice-card__marks">
                    {selected && (
                      <span className="tag tag--accent">
                        <Icon name="check" size={10} /> In studio
                      </span>
                    )}
                    {custom ? (
                      <span className="tag tag--accent" title="Added on this device">
                        <Icon name={voice.customKind === 'clone' ? 'mic' : 'upload'} size={10} />
                        {voice.customKind === 'clone' ? 'Cloned' : 'Imported'}
                      </span>
                    ) : downloaded ? (
                      <span className="tag tag--ok" title="Stored on this device">
                        <Icon name="check" size={10} /> Saved
                      </span>
                    ) : (
                      <span className="tag" title="Downloads on first use">
                        <Icon name="downloadCloud" size={11} /> On demand
                      </span>
                    )}
                    <button
                      className={classNames('icon-toggle icon-toggle--floating', isFavorite(voice.id) && 'is-on')}
                      onClick={() => toggle(voice.id)}
                      aria-label={isFavorite(voice.id) ? 'Remove from favorites' : 'Add to favorites'}
                      title={isFavorite(voice.id) ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <Icon name="star" size={15} />
                    </button>
                  </div>
                </div>

                <div className="voice-card__heading">
                  <h3>
                    {voice.name}
                    {voice.isDefault && <em className="tag tag--accent">Default</em>}
                  </h3>
                  <span>
                    {localeFlags[voice.locale] || '🌐'} {localeLabel(voice.locale)}
                    {voice.gender ? ` · ${voice.gender}` : ''}
                    {voice.age ? ` · ${voice.age}` : ''}
                    {custom && voice.bytes ? ` · ${formatBytes(voice.bytes)}` : ''}
                  </span>
                </div>

                <p className="voice-card__desc">{voice.description}</p>
                {!compatible && (
                  <p className="voice-card__compat">
                    <Icon name="alert" size={13} /> {voiceCompatibilityNote(models.activeModel, voice)}
                  </p>
                )}

                <div className="voice-card__actions">
                  <button
                    className="btn btn--subtle btn--sm"
                    onClick={() => void previewVoice(voice)}
                    disabled={!compatible || Boolean(previewingId && previewingId !== voice.id)}
                    title={!compatible ? voiceCompatibilityNote(models.activeModel, voice) || undefined : 'Preview voice'}
                  >
                    <Icon
                      name={isPreviewing ? 'loader' : activePreview && player.playing ? 'pause' : 'play'}
                      size={14}
                      className={isPreviewing ? 'spin' : undefined}
                    />
                    {isPreviewing ? 'Synthesizing…' : activePreview && player.playing ? 'Playing' : 'Preview'}
                  </button>
                  <button
                    className={classNames('btn btn--sm', selected ? 'btn--ghost' : 'btn--primary')}
                    onClick={() => useVoice(voice)}
                    disabled={selected || !compatible}
                    title={!compatible ? voiceCompatibilityNote(models.activeModel, voice) || undefined : undefined}
                  >
                    {selected ? (
                      <>
                        <Icon name="check" size={14} /> Selected
                      </>
                    ) : (
                      <>
                        <Icon name="arrowRight" size={14} /> Use voice
                      </>
                    )}
                  </button>
                  {custom ? (
                    <>
                      <button
                        className="btn btn--icon btn--ghost"
                        onClick={() => beginRename(voice)}
                        title="Rename voice"
                        aria-label="Rename voice"
                      >
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        className="btn btn--icon btn--ghost btn--danger-text"
                        onClick={() => void deleteCustomVoice(voice.id)}
                        title="Delete voice"
                        aria-label="Delete voice"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </>
                  ) : (
                    !downloaded && (
                      <button
                        className="btn btn--icon btn--ghost"
                        onClick={() => void downloadOne(voice)}
                        disabled={downloading || voiceDownloadBusy}
                        title="Download voice file"
                        aria-label="Download voice file"
                      >
                        <Icon name={downloading ? 'loader' : 'download'} size={15} className={downloading ? 'spin' : undefined} />
                      </button>
                    )
                  )}
                </div>
                </article>
              </Fragment>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <span className="empty__icon">
            <Icon name={filter === 'favorites' ? 'star' : filter === 'yours' ? 'mic' : 'search'} size={26} />
          </span>
          <strong>
            {filter === 'favorites'
              ? 'No favorites yet'
              : filter === 'yours'
                ? 'No voices of your own yet'
                : 'No voices found'}
          </strong>
          <p>
            {filter === 'favorites'
              ? 'Star a voice and it will show up here for quick access.'
              : filter === 'yours'
                ? 'Clone your voice with Gradium or import a .safetensors voice file to get started.'
                : 'Try a different name, accent or filter.'}
          </p>
          {filter === 'yours' ? (
            <button className="btn btn--primary btn--sm" onClick={() => openClone('record')}>
              <Icon name="mic" size={14} /> Add a voice
            </button>
          ) : (
            (query || filter !== 'all' || locale !== 'all' || gender !== 'all') && (
              <button
                className="btn btn--subtle btn--sm"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                  setLocale('all');
                  setGender('all');
                }}
              >
                Reset filters
              </button>
            )
          )}
        </div>
      )}

      <p className="page-footer-note">
        <Icon name="shield" size={13} />
        Voice files live in <code>{model?.dirs.voices || 'your app data folder'}</code> and never leave your device. Custom
        voices are kept in a <code>custom</code> subfolder.
      </p>

      <Modal
        open={Boolean(renaming)}
        onClose={() => setRenaming(null)}
        title="Rename voice"
        subtitle="Only the display name changes — the voice file stays the same."
        size="sm"
        icon={<Icon name="edit" size={17} />}
        footer={
          <>
            <button className="btn btn--subtle" onClick={() => setRenaming(null)} disabled={renamingBusy}>
              Cancel
            </button>
            <button className="btn btn--primary" onClick={() => void commitRename()} disabled={renamingBusy || !renameValue.trim()}>
              {renamingBusy ? 'Saving…' : 'Save name'}
            </button>
          </>
        }
      >
        <label className="field">
          <span>Voice name</span>
          <input
            autoFocus
            value={renameValue}
            maxLength={60}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commitRename();
            }}
          />
        </label>
      </Modal>
    </div>
  );
}
