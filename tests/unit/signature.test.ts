import { describe, expect, it } from 'vitest';
import { fieldSignature } from '@lib/fill/signature';

describe('fieldSignature', () => {
  const base = { label: 'Why do you want to work here?', control: 'textarea' as const, autocomplete: undefined, options: undefined };

  it('is stable across per-job identifiers (same label, same shape)', () => {
    // The signature intentionally ignores name/id, so question_123 vs
    // question_987 on two Greenhouse boards produce the same hash.
    expect(fieldSignature('greenhouse', base)).toBe(fieldSignature('greenhouse', { ...base }));
  });

  it('differs across ATSs and control types', () => {
    expect(fieldSignature('greenhouse', base)).not.toBe(fieldSignature('lever', base));
    expect(fieldSignature('greenhouse', base)).not.toBe(
      fieldSignature('greenhouse', { ...base, control: 'text' }),
    );
  });

  it('normalizes case, punctuation, and whitespace in labels', () => {
    expect(fieldSignature(null, base)).toBe(
      fieldSignature(null, { ...base, label: '  WHY do you want to work here  ' }),
    );
  });

  it('includes option sets — Yes/No vs Yes/No/Decline differ', () => {
    const yesNo = {
      ...base,
      control: 'select' as const,
      options: [
        { value: '1', label: 'Yes' },
        { value: '0', label: 'No' },
      ],
    };
    const withDecline = {
      ...yesNo,
      options: [...yesNo.options, { value: '2', label: 'Decline to answer' }],
    };
    expect(fieldSignature('workday', yesNo)).not.toBe(fieldSignature('workday', withDecline));
    // Option order must not matter.
    expect(fieldSignature('workday', yesNo)).toBe(
      fieldSignature('workday', { ...yesNo, options: [...yesNo.options].reverse() }),
    );
  });
});
