import { CURRENT_SCHEMA_VERSION, ProfileSchema, emptyProfile } from './profile';
import type { Profile } from './profile';

/**
 * Migrate any previously stored profile shape to the current schema.
 * Stepwise: each case upgrades one version, then falls through validation.
 * Unknown/corrupt data falls back to an empty profile rather than crashing
 * the extension; the raw value is preserved by the caller for recovery.
 */
export function migrateProfile(raw: unknown): Profile {
  if (raw == null) return emptyProfile();

  const result = validateProfile(raw);
  if (result.ok) return result.profile;

  console.error('[jobpilot] profile failed validation after migration; starting fresh:', result.errors.join('; '));
  return emptyProfile();
}

export type ProfileValidation = { ok: true; profile: Profile } | { ok: false; errors: string[] };

/**
 * The strict form: same migration chain, but a shape that does not validate
 * is reported, not replaced. The options page's JSON import uses this so a
 * wrong file is rejected with the reasons instead of silently loading an empty
 * profile into the editor for the user to save over their real one.
 */
export function validateProfile(raw: unknown): ProfileValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['(root): expected a JSON object'] };
  }

  let data = raw as Record<string, unknown>;
  // Zod defaults accept any object after stripping unknown keys. A settings
  // export or {} must not become an empty profile one Save away from data loss.
  if (!Object.keys(ProfileSchema.shape).some((key) => key !== 'schemaVersion' && Object.hasOwn(data, key))) {
    return { ok: false, errors: ['(root): no recognized profile sections'] };
  }
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
  if (version > CURRENT_SCHEMA_VERSION) {
    return { ok: false, errors: [`schemaVersion: version ${version} requires a newer JobPilot`] };
  }

  // Version 0 = pre-versioned or missing; just stamp the current version and
  // let zod defaults fill any gaps. Future migrations chain here:
  //   if (version < 2) { data = migrateV1toV2(data); }
  if (version < CURRENT_SCHEMA_VERSION) {
    data = { ...data, schemaVersion: CURRENT_SCHEMA_VERSION };
  }

  const parsed = ProfileSchema.safeParse(data);
  if (parsed.success) return { ok: true, profile: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  };
}
