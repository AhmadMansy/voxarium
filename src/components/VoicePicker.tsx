import { useEffect, useMemo, useRef, useState } from 'react';
import { VOICES, englishLocales, localeLabel, localeFlags } from '../data/catalog';
import { useFavoriteVoices } from '../lib/favorites';
import { classNames } from '../lib/utils';
import { useStudio } from '../state';
import { Icon } from './Icons';
import { Modal } from './Modal';
import { VoiceAvatar } from './VoiceAvatar';

interface VoicePickerProps {
  open: boolean;
  onClose: () => void;
  onBrowse: () => void;
}

export function VoicePicker({ open, onClose, onBrowse }: VoicePickerProps) {
  const { settings, model, updateSettings, engine, customVoices, openClone } = useStudio();
  const { favorites, isFavorite, toggle } = useFavoriteVoices();
  const [query, setQuery] = useState('');
  const [locale, setLocale] = useState('all');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setLocale('all');
      const timer = setTimeout(() => searchRef.current?.focus(), 40);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const installed = useMemo(() => new Set(['default', ...(model?.voiceIds || [])]), [model?.voiceIds]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...customVoices, ...VOICES]
      .filter((voice) => {
        if (locale !== 'all' && voice.locale !== locale) return false;
        if (!needle) return true;
        return `${voice.name} ${voice.description} ${voice.gender || ''} ${voice.age || ''}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        const favouriteDelta = Number(isFavorite(b.id)) - Number(isFavorite(a.id));
        if (favouriteDelta !== 0) return favouriteDelta;
        const customDelta = Number(b.source === 'custom') - Number(a.source === 'custom');
        if (customDelta !== 0) return customDelta;
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [query, locale, favorites, customVoices, isFavorite]);

  const selected = settings?.lastVoice || 'default';

  const choose = (id: string) => {
    updateSettings({ lastVoice: id, defaultVoice: id });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose a voice"
      subtitle={`${VOICES.length + customVoices.length} voices · ${installed.size - 1 + customVoices.length} on this device`}
      size="lg"
      icon={<Icon name="voices" size={18} />}
      footer={
        <>
          <span className="modal__foot-note">
            <Icon name="info" size={14} />
            Voice files are tiny (256 KB).
          </span>
          <button
            className="btn btn--subtle"
            onClick={() => {
              onClose();
              openClone('record');
            }}
          >
            <Icon name="mic" size={15} /> Add a voice
          </button>
          <button className="btn btn--subtle" onClick={onBrowse}>
            <Icon name="grid" size={15} /> Browse all voices
          </button>
        </>
      }
    >
      <div className="picker">
        <div className="picker__filters">
          <label className="search">
            <Icon name="search" size={16} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, mood or description…"
            />
            {query && (
              <button className="search__clear" onClick={() => setQuery('')} aria-label="Clear search">
                <Icon name="x" size={13} />
              </button>
            )}
          </label>
          <select className="select select--compact" value={locale} onChange={(event) => setLocale(event.target.value)}>
            <option value="all">All accents</option>
            {englishLocales.map((value) => (
              <option key={value} value={value}>
                {localeFlags[value]} {localeLabel(value)}
              </option>
            ))}
          </select>
        </div>

        <div className="picker__list">
          {results.map((voice) => {
            const isSelected = voice.id === selected;
            const isDownloaded = voice.source === 'custom' || installed.has(voice.id);
            return (
              <div
                key={voice.id}
                className={classNames('picker__row', isSelected && 'is-selected')}
                role="button"
                tabIndex={0}
                onClick={() => choose(voice.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') choose(voice.id);
                }}
              >
                <VoiceAvatar voiceId={voice.id} size="md" />
                <div className="picker__info">
                  <div className="picker__name">
                    {voice.name}
                    {voice.isDefault && <em className="tag tag--accent">Default</em>}
                    {voice.source === 'custom' && (
                      <em className="tag tag--accent">{voice.customKind === 'clone' ? 'Cloned' : 'Imported'}</em>
                    )}
                    {!isDownloaded && (
                      <span className="picker__remote" title="Downloads on first use">
                        <Icon name="downloadCloud" size={12} /> On demand
                      </span>
                    )}
                  </div>
                  <p>{voice.description}</p>
                  <div className="picker__tags">
                    <span className="tag">
                      {localeFlags[voice.locale] || '🌐'} {localeLabel(voice.locale)}
                    </span>
                    {voice.gender && <span className="tag">{voice.gender}</span>}
                    {voice.age && <span className="tag">{voice.age}</span>}
                  </div>
                </div>
                <div className="picker__actions">
                  <button
                    className={classNames('icon-toggle', isFavorite(voice.id) && 'is-on')}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(voice.id);
                    }}
                    aria-label={isFavorite(voice.id) ? 'Remove from favorites' : 'Add to favorites'}
                    title="Favorite"
                  >
                    <Icon name="star" size={15} />
                  </button>
                  {isSelected && (
                    <span className="picker__check">
                      <Icon name="check" size={15} />
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {!results.length && (
            <div className="empty empty--compact">
              <Icon name="search" size={22} />
              <strong>No voices match “{query}”</strong>
              <span>Try a mood, accent or a different name.</span>
            </div>
          )}
        </div>
        {engine.status !== 'ready' && (
          <p className="picker__note">
            <Icon name="info" size={14} />
            The engine is still loading. You can pick a voice now and preview it once the model is ready.
          </p>
        )}
      </div>
    </Modal>
  );
}
