import type { Profile } from '../schema/profile';
import { PROFILE_VALUE, SENSITIVE_KINDS, type FieldKind } from '../schema/fieldKind';
import type { FillPayload, FormFieldDescriptor } from '../messaging/protocol';
import { containsTokens, normalizeForSignature } from './signature';

/** A concrete fill for one field, plus whether a human must look at it first. */
export type ResolvedValue = FillPayload & {
  /** True when the match into select options was fuzzy or the value is sensitive. */
  requiresReview: boolean;
};

export interface ResumeMeta {
  blobId: string;
  filename: string;
}

/**
 * Turn (kind, profile, descriptor) into a concrete fill value + action, or
 * null when the profile has nothing for this field. Select/checkbox targets
 * are matched against the field's real options — a fuzzy option match or a
 * sensitive kind is flagged for review.
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
      requiresReview: false,
    };
  }

  const raw = PROFILE_VALUE[kind](profile);
  if (raw === null) return null;

  // Boolean-answer kinds against yes/no style widgets.
  if (typeof raw === 'boolean') {
    if (field.control === 'checkbox') {
      return { action: 'setChecked', value: raw, requiresReview: sensitive };
    }
    if (field.control === 'select' || field.control === 'combobox' || field.control === 'radio') {
      return matchOption(field, raw ? 'yes' : 'no', sensitive, raw ? ['yes', 'i am authorized'] : ['no', 'not require']);
    }
    return { action: 'setText', value: raw ? 'Yes' : 'No', requiresReview: true };
  }

  if (field.control === 'select' || field.control === 'radio') {
    return matchOption(field, raw, sensitive);
  }
  if (field.control === 'combobox') {
    return { action: 'pickListbox', value: raw, requiresReview: sensitive };
  }
  if (field.control === 'checkbox' || field.control === 'file') {
    return null; // a string value can't drive these
  }

  return { action: 'setText', value: raw, requiresReview: sensitive };
}

/**
 * Match a target string against the field's options: exact normalized equality
 * first, then whole-token containment either way (fuzzy — flagged for review).
 *
 * Containment is token-bounded on purpose. A bare substring test made "no"
 * match "Yes, I will require sponsorship NOW or in the future" — the opposite
 * answer — because "now" contains "no". Options that merely start with the
 * needle win over ones that contain it somewhere later.
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
    return { action: 'pickListbox', value: target, requiresReview: true };
  }

  const normTarget = normalizeForSignature(target);
  const needles = [normTarget, ...extraNeedles.map(normalizeForSignature)];

  const exact = options.find((o) => normalizeForSignature(o.label) === normTarget);
  if (exact) return { action: 'selectOption', value: exact.value, requiresReview: sensitive };

  for (const needle of needles) {
    if (!needle) continue;
    const fuzzy =
      options.find((o) => normalizeForSignature(o.label).startsWith(`${needle} `)) ??
      options.find((o) => {
        const norm = normalizeForSignature(o.label);
        return containsTokens(norm, needle) || containsTokens(needle, norm);
      });
    // A fuzzy match always gets human eyes.
    if (fuzzy) return { action: 'selectOption', value: fuzzy.value, requiresReview: true };
  }

  return null;
}
