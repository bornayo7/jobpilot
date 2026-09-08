import type { Profile } from './profile';

/**
 * Semantic field kinds — the shared vocabulary between ATS adapters, heuristics,
 * the LLM mapping tier, and the profile. String union (not enum) so selector-map
 * JSON files stay human-readable.
 */
export type FieldKind =
  | 'name.first'
  | 'name.last'
  | 'name.full'
  | 'contact.email'
  | 'contact.phone'
  | 'location.city'
  | 'location.state'
  | 'location.country'
  | 'location.postal'
  | 'location.combined'
  | 'links.linkedin'
  | 'links.github'
  | 'links.portfolio'
  | 'links.other'
  | 'docs.resume'
  | 'docs.coverLetter'
  | 'work.company'
  | 'work.title'
  | 'work.start'
  | 'work.end'
  | 'work.description'
  | 'work.current'
  | 'edu.school'
  | 'edu.degree'
  | 'edu.field'
  | 'edu.gpa'
  | 'edu.start'
  | 'edu.end'
  | 'auth.workAuthorized'
  | 'auth.needsSponsorship'
  | 'eeo.gender'
  | 'eeo.race'
  | 'eeo.veteran'
  | 'eeo.disability'
  | 'eeo.pronouns'
  | 'comp.expectedSalary'
  | 'misc.availableStart'
  | 'misc.referralSource'
  | 'question.freeText'
  | 'question.choice'
  | 'unknown';

/** A profile answer: text, a yes/no, or null when the profile has nothing for it. */
export type ProfileValue = string | boolean | null;

const text = (value: string): ProfileValue => value || null;
/** Kinds the profile cannot answer directly: files, free-text questions,
 *  per-posting choices, and repeated work/education sections (not yet resolved). */
const none = (): ProfileValue => null;

/**
 * How each kind reads its answer from the Profile. Exhaustive by type, so a new
 * kind cannot be added without deciding where its value comes from, and
 * ALL_FIELD_KINDS derives from it.
 */
export const PROFILE_VALUE: Record<FieldKind, (profile: Profile) => ProfileValue> = {
  'name.first': (p) => text(p.basics.firstName),
  'name.last': (p) => text(p.basics.lastName),
  'name.full': (p) => text(`${p.basics.firstName} ${p.basics.lastName}`.trim()),
  'contact.email': (p) => text(p.basics.email),
  'contact.phone': (p) => text(p.basics.phone),
  'location.city': (p) => text(p.basics.location.city),
  'location.state': (p) => text(p.basics.location.state),
  'location.country': (p) => text(p.basics.location.country),
  'location.postal': (p) => text(p.basics.location.postal),
  'location.combined': (p) => {
    const { city, state, country } = p.basics.location;
    return text([city, state || country].filter(Boolean).join(', '));
  },
  'links.linkedin': (p) => text(p.links.linkedin),
  'links.github': (p) => text(p.links.github),
  'links.portfolio': (p) => text(p.links.portfolio),
  'links.other': none,
  'docs.resume': none, // the default resume blob, resolved by valueFor
  'docs.coverLetter': none, // Prompt Studio output — never auto-filled
  'work.company': (p) => text(p.work[0]?.company ?? ''),
  'work.title': (p) => text(p.work[0]?.title ?? ''),
  'work.start': none,
  'work.end': none,
  'work.description': none,
  'work.current': none,
  'edu.school': none,
  'edu.degree': none,
  'edu.field': none,
  'edu.gpa': none,
  'edu.start': none,
  'edu.end': none,
  'auth.workAuthorized': (p) => p.workAuth.authorizedUS,
  'auth.needsSponsorship': (p) => p.workAuth.needsSponsorship,
  'eeo.gender': (p) => text(p.eeo.gender),
  'eeo.race': (p) => text(p.eeo.race),
  'eeo.veteran': (p) => text(p.eeo.veteran),
  'eeo.disability': (p) => text(p.eeo.disability),
  'eeo.pronouns': (p) => text(p.eeo.pronouns),
  'comp.expectedSalary': (p) => text(p.preferences.expectedSalary),
  'misc.availableStart': (p) => text(p.preferences.availableStart),
  'misc.referralSource': none,
  'question.freeText': none,
  'question.choice': none,
  unknown: none,
};

export const ALL_FIELD_KINDS = Object.keys(PROFILE_VALUE) as FieldKind[];

/**
 * The LLM mapping tier may ONLY emit these kinds. Core contact/EEO/auth kinds
 * are adapter/heuristic-only — a structural guard against a model mis-mapping
 * a sensitive field. Enforced in the resolver; a model answer outside this list
 * is discarded.
 */
export const LLM_ALLOWED_KINDS: ReadonlySet<FieldKind> = new Set([
  'question.freeText',
  'question.choice',
  'comp.expectedSalary',
  'misc.availableStart',
  'misc.referralSource',
  'unknown',
]);

/** Kinds whose review rows get "verify" styling and are never bulk-approved. */
export const SENSITIVE_KINDS: ReadonlySet<FieldKind> = new Set([
  'eeo.gender',
  'eeo.race',
  'eeo.veteran',
  'eeo.disability',
  'eeo.pronouns',
  'auth.workAuthorized',
  'auth.needsSponsorship',
]);
