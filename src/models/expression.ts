import type { ExpressionSettings } from '../types';
import type { ModelManifest } from './types';

/** What travels with a synthesis request besides the text and voice. */
export interface ExpressionRequest {
  instruction?: string;
  intensity?: number;
}

export function hasExpression(model: ModelManifest): boolean {
  const spec = model.expression;
  return Boolean(spec && (spec.tags?.length || spec.instruction || spec.attributes?.length || spec.intensity));
}

/**
 * Turns the Studio's saved Expression values (or an API override) into what the
 * model receives. Attribute pickers become one comma-separated instruction, the
 * format OmniVoice expects; values a model does not accept are dropped.
 */
export function resolveExpression(
  model: ModelManifest,
  saved: ExpressionSettings | undefined,
  override: ExpressionRequest = {},
): ExpressionRequest {
  const spec = model.expression;
  if (!spec) return {};
  const request: ExpressionRequest = {};
  const takesInstruction = Boolean(spec.instruction || spec.attributes);
  if (takesInstruction) {
    let instruction = override.instruction;
    if (instruction == null) {
      if (spec.attributes) {
        instruction = spec.attributes
          .map((group) => saved?.attributes?.[group.id])
          .filter((value): value is string => Boolean(value))
          .join(', ');
      } else {
        instruction = saved?.instruction;
      }
    }
    const trimmed = (instruction || '').trim().slice(0, spec.instruction?.maxLength || 300);
    if (trimmed) request.instruction = trimmed;
  }
  if (spec.intensity) {
    const raw = override.intensity ?? saved?.intensity ?? spec.intensity.default;
    request.intensity = Math.min(spec.intensity.max, Math.max(spec.intensity.min, Number(raw)));
  }
  return request;
}

/** Inserts a tag at the cursor with sensible spacing; returns the new text and cursor. */
export function insertTag(text: string, start: number, end: number, token: string): { text: string; cursor: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^[\s.,!?;:]/.test(after) ? ' ' : '';
  const inserted = `${lead}${token}${trail}`;
  return { text: `${before}${inserted}${after}`, cursor: before.length + inserted.length };
}
