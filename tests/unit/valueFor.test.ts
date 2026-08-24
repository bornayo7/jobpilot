import { describe, expect, it } from 'vitest';
import { valueFor } from '@lib/fill/valueFor';
import { emptyProfile } from '@lib/schema/profile';
import type { FormFieldDescriptor } from '@lib/messaging/protocol';

function field(partial: Partial<FormFieldDescriptor>): FormFieldDescriptor {
  return { fieldId: 'f1', control: 'text', label: '', required: false, signature: 's', ...partial };
}

function profileFixture() {
  const profile = emptyProfile();
  profile.basics.firstName = 'Ada';
  profile.basics.lastName = 'Lovelace';
  profile.basics.email = 'ada@example.com';
  profile.basics.location = { city: 'Austin', state: 'TX', country: 'USA', postal: '78701' };
  profile.workAuth.authorizedUS = true;
  profile.workAuth.needsSponsorship = false;
  profile.eeo.veteran = 'I am not a protected veteran';
  return profile;
}

describe('valueFor', () => {
  const profile = profileFixture();

  it('composes name.full and location.combined', () => {
    expect(valueFor('name.full', field({}), profile, null)?.value).toBe('Ada Lovelace');
    expect(valueFor('location.combined', field({}), profile, null)?.value).toBe('Austin, TX');
  });

  it('answers boolean kinds against yes/no selects with exact option values', () => {
    const authorized = valueFor(
      'auth.workAuthorized',
      field({
        control: 'select',
        options: [
          { value: '1', label: 'Yes' },
          { value: '0', label: 'No' },
        ],
      }),
      profile,
      null,
    );
    expect(authorized).toMatchObject({ action: 'selectOption', value: '1', requiresReview: true });

    const sponsorship = valueFor(
      'auth.needsSponsorship',
      field({
        control: 'select',
        options: [
          { value: 'y', label: 'Yes' },
          { value: 'n', label: 'No' },
        ],
      }),
      profile,
      null,
    );
    expect(sponsorship?.value).toBe('n');
  });

  it('matches EEO strings to options and always flags for review', () => {
    const veteran = valueFor(
      'eeo.veteran',
      field({
        control: 'select',
        options: [
          { value: 'v1', label: 'I identify as one or more of the classifications of a protected veteran' },
          { value: 'v2', label: 'I am not a protected veteran' },
          { value: 'v3', label: "I don't wish to answer" },
        ],
      }),
      profile,
      null,
    );
    expect(veteran).toMatchObject({ action: 'selectOption', value: 'v2', requiresReview: true });
  });

  it('returns null when the profile has no answer or no option matches', () => {
    expect(valueFor('eeo.gender', field({ control: 'select', options: [{ value: 'm', label: 'Male' }] }), profile, null)).toBeNull();
    expect(
      valueFor(
        'location.country',
        field({ control: 'select', options: [{ value: 'de', label: 'Germany' }] }),
        profile,
        null,
      ),
    ).toBeNull();
  });

  it('attaches the default resume to file fields and never to others', () => {
    const resume = { blobId: 'b1', filename: 'ada-resume.pdf' };
    const fileField = valueFor('docs.resume', field({ control: 'file' }), profile, resume);
    expect(fileField).toMatchObject({ action: 'attachFile', value: { blobKey: 'b1', filename: 'ada-resume.pdf' } });
    expect(valueFor('docs.resume', field({ control: 'text' }), profile, resume)).toBeNull();
    expect(valueFor('docs.resume', field({ control: 'file' }), profile, null)).toBeNull();
  });

  it('never produces values for free-text questions', () => {
    expect(valueFor('question.freeText', field({ control: 'textarea' }), profile, null)).toBeNull();
  });
});
