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

/**
 * Where each kind reads from in the Profile. Paths are dot-notation into the
 * Profile object; `null` means the value doesn't come from the profile directly
 * (files, free-text questions, repeated sections resolved with sectionIndex).
 */
export const KIND_TO_PROFILE_PATH: Record<FieldKind, string | null> = {
  'name.first': 'basics.firstName',
  'name.last': 'basics.lastName',
  'name.full': null, // composed: firstName + lastName
  'contact.email': 'basics.email',
  'contact.phone': 'basics.phone',
  'location.city': 'basics.location.city',
  'location.state': 'basics.location.state',
  'location.country': 'basics.location.country',
  'location.postal': 'basics.location.postal',
  'location.combined': null, // composed: "City, State"
  'links.linkedin': 'links.linkedin',
  'links.github': 'links.github',
  'links.portfolio': 'links.portfolio',
  'links.other': null,
  'docs.resume': null, // blob from idb
  'docs.coverLetter': null,
  'work.company': null, // repeated section: work[sectionIndex].company
  'work.title': null,
  'work.start': null,
  'work.end': null,
  'work.description': null,
  'work.current': null,
  'edu.school': null,
  'edu.degree': null,
  'edu.field': null,
  'edu.gpa': null,
  'edu.start': null,
  'edu.end': null,
  'auth.workAuthorized': 'workAuth.authorizedUS',
  'auth.needsSponsorship': 'workAuth.needsSponsorship',
  'eeo.gender': 'eeo.gender',
  'eeo.race': 'eeo.race',
  'eeo.veteran': 'eeo.veteran',
  'eeo.disability': 'eeo.disability',
  'eeo.pronouns': 'eeo.pronouns',
  'comp.expectedSalary': 'preferences.expectedSalary',
  'misc.availableStart': 'preferences.availableStart',
  'misc.referralSource': null,
  'question.freeText': null,
  'question.choice': null,
  unknown: null,
};

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

export const ALL_FIELD_KINDS = Object.keys(KIND_TO_PROFILE_PATH) as FieldKind[];

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
