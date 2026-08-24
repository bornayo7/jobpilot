import type { Profile } from '../schema/profile';
import type { FieldKind } from '../schema/fieldKind';
import { KIND_TO_PROFILE_PATH, SENSITIVE_KINDS } from '../schema/fieldKind';
import type { FillAction, FormFieldDescriptor } from '../messaging/protocol';
import { normalizeForSignature } from './signature';

export interface ResolvedValue {
  action: FillAction;
  value: string | boolean | { blobKey: string; filename: string };
  /** Human-readable preview for the review table. */
  display: string;
  /** True when the match into select options was fuzzy or the value is sensitive. */
  requiresReview: boolean;
  /** Null value: nothing in the profile answers this field. */
  empty: boolean;
}

export interface ResumeMeta {
  blobId: string;
  filename: string;
}

/**
 * Turn (kind, profile, descriptor) into a concrete fill value + action.
 * Select/checkbox targets are matched against the field's real options —
 * a fuzzy option match or a sensitive kind is flagged for review.
 */
export function valueFor(
  kind: FieldKind,
  field: FormFieldDescriptor,
  profile: Profile,
  resume: ResumeMeta | null,
): ResolvedValue | null {
  const sensitive = SENSITIVE_KINDS.has(kind);

  if (kind === 'docs.resume') {
    if (field.control !== 'file' || !resume) return null;
    return {
      action: 'attachFile',
      value: { blobKey: resume.blobId, filename: resume.filename },
      display: resume.filename,
      requiresReview: false,
      empty: false,
    };
  }
  if (kind === 'docs.coverLetter') {
    // Cover letters come from the Prompt Studio flow (M2) — never auto-filled.
    return null;
  }
  if (kind === 'question.freeText' || kind === 'question.choice' || kind === 'unknown') {
    return null;
  }

  const raw = rawValueFor(kind, profile);
  if (raw === null || raw === '') return null;

  // Boolean-answer kinds against yes/no style widgets.
  if (typeof raw === 'boolean') {
    if (field.control === 'checkbox') {
      return { action: 'setChecked', value: raw, display: raw ? 'checked' : 'unchecked', requiresReview: sensitive, empty: false };
    }
    const target = raw ? 'yes' : 'no';
    if (field.control === 'select' || field.control === 'combobox' || field.control === 'radio') {
      return matchOption(field, target, sensitive, raw ? ['yes', 'i am authorized'] : ['no', 'not require']);
    }
    return { action: 'setText', value: raw ? 'Yes' : 'No', display: raw ? 'Yes' : 'No', requiresReview: true, empty: false };
  }

  if (field.control === 'select' || field.control === 'radio') {
    return matchOption(field, raw, sensitive);
  }
  if (field.control === 'combobox') {
    return { action: 'pickListbox', value: raw, display: raw, requiresReview: sensitive, empty: false };
  }
  if (field.control === 'checkbox' || field.control === 'file') {
    return null; // string value can't drive these
  }

  return { action: 'setText', value: raw, display: raw, requiresReview: sensitive, empty: false };
}

function rawValueFor(kind: FieldKind, profile: Profile): string | boolean | null {
  switch (kind) {
    case 'name.full': {
      const full = `${profile.basics.firstName} ${profile.basics.lastName}`.trim();
      return full || null;
    }
    case 'location.combined': {
      const { city, state, country } = profile.basics.location;
      const combined = [city, state || country].filter(Boolean).join(', ');
      return combined || null;
    }
    case 'work.company':
      return profile.work[0]?.company || null;
    case 'work.title':
      return profile.work[0]?.title || null;
    default: {
      const path = KIND_TO_PROFILE_PATH[kind];
      if (!path) return null;
      const value = path.split('.').reduce<unknown>((obj, key) => {
        if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[key];
        return undefined;
      }, profile);
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') return value || null;
      return null;
    }
  }
}

/**
 * Match a target string against the field's options: exact normalized equality
 * first, then containment either way (fuzzy — flagged for review).
 */
function matchOption(
  field: FormFieldDescriptor,
  target: string,
  sensitive: boolean,
  extraNeedles: string[] = [],
): ResolvedValue | null {
  const options = field.options ?? [];
  if (options.length === 0) {
    // Custom widget without enumerable options — let the listbox picker try.
    return { action: 'pickListbox', value: target, display: target, requiresReview: true, empty: false };
  }

  const normTarget = normalizeForSignature(target);
  const needles = [normTarget, ...extraNeedles.map(normalizeForSignature)];

  const exact = options.find((o) => normalizeForSignature(o.label) === normTarget);
  if (exact) {
    return {
      action: 'selectOption',
      value: exact.value,
      display: exact.label,
      requiresReview: sensitive,
      empty: false,
    };
  }

  for (const needle of needles) {
    if (!needle) continue;
    const fuzzy = options.find((o) => {
      const norm = normalizeForSignature(o.label);
      return norm.includes(needle) || needle.includes(norm);
    });
    if (fuzzy) {
      return {
        action: 'selectOption',
        value: fuzzy.value,
        display: fuzzy.label,
        requiresReview: true, // fuzzy match always gets human eyes
        empty: false,
      };
    }
  }

  return null;
}
