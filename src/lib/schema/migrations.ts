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

  let data = raw as Record<string, unknown>;
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;

  // Version 0 = pre-versioned or missing; just stamp the current version and
  // let zod defaults fill any gaps. Future migrations chain here:
  //   if (version < 2) { data = migrateV1toV2(data); }
  if (version < CURRENT_SCHEMA_VERSION) {
    data = { ...data, schemaVersion: CURRENT_SCHEMA_VERSION };
  }

  const parsed = ProfileSchema.safeParse(data);
  if (parsed.success) return parsed.data;

  console.error(
    '[jobpilot] profile failed validation after migration; starting fresh:',
    parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
  );
  return emptyProfile();
}
