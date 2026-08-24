import { describe, expect, it } from 'vitest';
import { migrateProfile } from '@lib/schema/migrations';
import { CURRENT_SCHEMA_VERSION, emptyProfile } from '@lib/schema/profile';

describe('migrateProfile', () => {
  it('returns an empty profile for null/undefined', () => {
    expect(migrateProfile(null)).toEqual(emptyProfile());
    expect(migrateProfile(undefined)).toEqual(emptyProfile());
  });

  it('round-trips a current profile', () => {
    const profile = emptyProfile();
    profile.basics.firstName = 'Ada';
    profile.work.push({
      id: 'w1',
      company: 'Acme',
      title: 'Engineer',
      location: '',
      start: 'Jun 2024',
      end: '',
      current: true,
      bullets: [{ text: 'Built things', tags: ['building'] }],
    });
    expect(migrateProfile(profile)).toEqual(profile);
  });

  it('stamps pre-versioned data with the current version and fills defaults', () => {
    const migrated = migrateProfile({ basics: { firstName: 'Ada' } });
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.basics.firstName).toBe('Ada');
    expect(migrated.links.other).toEqual([]);
    expect(migrated.workAuth.needsSponsorship).toBe(false);
  });

  it('falls back to empty on unrecoverable junk', () => {
    expect(migrateProfile({ schemaVersion: 1, work: 'not-an-array' })).toEqual(emptyProfile());
    expect(migrateProfile(42)).toEqual(emptyProfile());
  });
});
