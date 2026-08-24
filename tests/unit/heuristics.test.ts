import { describe, expect, it } from 'vitest';
import { heuristicMatch } from '@lib/fill/heuristics';
import type { FormFieldDescriptor } from '@lib/messaging/protocol';

function field(partial: Partial<FormFieldDescriptor>): FormFieldDescriptor {
  return {
    fieldId: 'f1',
    control: 'text',
    label: '',
    required: false,
    signature: 'sig',
    ...partial,
  };
}

describe('heuristicMatch', () => {
  it.each<[string, FormFieldDescriptor['control'], string]>([
    ['First Name', 'text', 'name.first'],
    ['Given name', 'text', 'name.first'],
    ['Last Name *', 'text', 'name.last'],
    ['Full name', 'text', 'name.full'],
    ['Email Address', 'text', 'contact.email'],
    ['Phone number', 'text', 'contact.phone'],
    ['LinkedIn Profile', 'text', 'links.linkedin'],
    ['GitHub URL', 'text', 'links.github'],
    ['Current location', 'text', 'location.combined'],
    ['City', 'text', 'location.city'],
    ['Are you legally authorized to work in the United States?', 'select', 'auth.workAuthorized'],
    ['Will you now or in the future require sponsorship for employment visa status?', 'select', 'auth.needsSponsorship'],
    ['Veteran Status', 'select', 'eeo.veteran'],
    ['Disability Status', 'select', 'eeo.disability'],
    ['Salary expectations', 'text', 'comp.expectedSalary'],
    ['How did you hear about this job?', 'text', 'misc.referralSource'],
  ])('"%s" (%s) -> %s', (label, control, expected) => {
    expect(heuristicMatch(field({ label, control }))?.kind).toBe(expected);
  });

  it('uses autocomplete attributes as a strong signal', () => {
    const match = heuristicMatch(field({ label: 'Contact', autocomplete: 'given-name' }));
    expect(match?.kind).toBe('name.first');
    expect(match!.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('resume rule requires a file control', () => {
    expect(heuristicMatch(field({ label: 'Resume/CV', control: 'file' }))?.kind).toBe('docs.resume');
    // "resume" mentioned in a text field is NOT a resume upload.
    expect(heuristicMatch(field({ label: 'Resume', control: 'text' }))?.kind).toBeUndefined();
  });

  it('adversarial labels do not match core kinds', () => {
    // These historically trip naive substring matchers.
    expect(heuristicMatch(field({ label: 'Name of referrer' }))?.kind).not.toBe('name.full');
    expect(heuristicMatch(field({ label: "Manager's email will be requested later" }))?.kind).not.toBe('contact.email');
    expect(heuristicMatch(field({ label: 'Company name' }))?.kind).not.toBe('name.full');
  });

  it('falls back to question.freeText for unmatched textareas only', () => {
    expect(heuristicMatch(field({ label: 'Why do you want to join us?', control: 'textarea' }))?.kind).toBe(
      'question.freeText',
    );
    expect(heuristicMatch(field({ label: 'Why do you want to join us?', control: 'text' }))).toBeNull();
  });
});
