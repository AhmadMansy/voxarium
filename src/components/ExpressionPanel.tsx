// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ExpressionSettings } from '../types';
import type { ModelManifest } from '../models/types';
import { hasExpression } from '../models/expression';
import { classNames } from '../lib/utils';
import { Icon } from './Icons';

interface ExpressionPanelProps {
  model: ModelManifest;
  values: ExpressionSettings | undefined;
  onChange: (next: ExpressionSettings) => void;
  onInsertTag: (token: string) => void;
}

/**
 * Model-aware expression controls: insertable tags (sounds, emotions, pauses), a
 * voice/style instruction, attribute pickers, or an intensity slider. Only what the
 * active model actually accepts is shown, and the same values apply to Batch and
 * to API requests.
 */
export function ExpressionPanel({ model, values, onChange, onInsertTag }: ExpressionPanelProps) {
  const spec = model.expression;
  if (!spec || !hasExpression(model)) return null;
  const current = values || {};
  const sounds = spec.tags?.filter((tag) => tag.kind !== 'pause') || [];
  const pauses = spec.tags?.filter((tag) => tag.kind === 'pause') || [];
  const intensity = spec.intensity;
  const intensityValue = current.intensity ?? intensity?.default ?? 0;
  const active =
    Boolean(current.instruction?.trim()) ||
    Object.values(current.attributes || {}).some(Boolean) ||
    (intensity ? intensityValue !== intensity.default : false);

  return (
    <section className="card side-card expression-panel">
      <div className="side-card__head">
        <span className="side-card__title">
          <Icon name="wand" size={14} /> Expression
        </span>
        {active && (
          <button className="link" onClick={() => onChange({})}>
            Reset
          </button>
        )}
      </div>
      {spec.note && <p className="field__hint expression-panel__note">{spec.note}</p>}

      {sounds.length > 0 && (
        <div className="field">
          <span className="field__label">Insert at cursor</span>
          <div className="expression-panel__tags">
            {sounds.map((tag) => (
              <button key={tag.token} className={classNames('chip chip--tiny', tag.kind === 'emotion' && 'chip--emotion')} onClick={() => onInsertTag(tag.token)} title={`Insert ${tag.token}`}>
                {tag.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {pauses.length > 0 && (
        <div className="field">
          <span className="field__label">Pauses</span>
          <div className="expression-panel__tags">
            {pauses.map((tag) => (
              <button key={tag.token} className="chip chip--tiny" onClick={() => onInsertTag(tag.token)} title={`Insert ${tag.token}`}>
                {tag.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {spec.instruction && (
        <label className="field">
          <span className="field__label">
            {spec.instruction.label}
            <em>
              {(current.instruction || '').length}/{spec.instruction.maxLength}
            </em>
          </span>
          <textarea
            className="input expression-panel__instruction"
            rows={3}
            maxLength={spec.instruction.maxLength}
            value={current.instruction || ''}
            placeholder={spec.instruction.placeholder}
            onChange={(event) => onChange({ ...current, instruction: event.target.value })}
          />
          <div className="expression-panel__tags">
            {spec.instruction.examples.map((example) => (
              <button key={example} className="chip chip--tiny" onClick={() => onChange({ ...current, instruction: example })} title={example}>
                {example.length > 34 ? `${example.slice(0, 32)}…` : example}
              </button>
            ))}
          </div>
          <span className="field__hint">Leave empty to use the selected voice as is.</span>
        </label>
      )}

      {spec.attributes && (
        <div className="expression-panel__attributes">
          {spec.attributes.map((group) => (
            <label key={group.id} className="field">
              <span className="field__label">{group.label}</span>
              <select
                className="select select--compact"
                value={current.attributes?.[group.id] || ''}
                onChange={(event) => onChange({ ...current, attributes: { ...current.attributes, [group.id]: event.target.value } })}
              >
                <option value="">Any</option>
                {group.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <span className="field__hint">Any choice here replaces the selected voice’s preset.</span>
        </div>
      )}

      {intensity && (
        <label className="field">
          <span className="field__label">
            {intensity.label}
            <em>{intensityValue.toFixed(2)}</em>
          </span>
          <input
            type="range"
            className="range"
            min={intensity.min}
            max={intensity.max}
            step={intensity.step}
            value={intensityValue}
            onChange={(event) => onChange({ ...current, intensity: Number(event.target.value) })}
          />
          {intensity.hint && <span className="field__hint">{intensity.hint}</span>}
        </label>
      )}
    </section>
  );
}
