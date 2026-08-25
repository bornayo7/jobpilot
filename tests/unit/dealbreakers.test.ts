import { describe, expect, it } from 'vitest';
import { checkDealbreakers, maxPostedSalary } from '@lib/memory/dealbreakers';
import { SettingsSchema, type Settings } from '@lib/storage/settingsStore';

function settingsWith(dealbreakers: Partial<Settings['dealbreakers']>): Settings {
  const settings = SettingsSchema.parse({});
  settings.dealbreakers = { ...settings.dealbreakers, ...dealbreakers };
  return settings;
}

describe('checkDealbreakers', () => {
  it('flags no-sponsorship language in its many phrasings', () => {
    const phrasings = [
      'We are unable to provide visa sponsorship for this role.',
      'This position does not offer sponsorship.',
      'Candidates must be authorized to work in the US without current or future sponsorship.',
      'No visa sponsorship available.',
    ];
    for (const text of phrasings) {
      const warnings = checkDealbreakers(text, settingsWith({ noSponsorship: true }));
      expect(warnings.map((w) => w.id)).toContain('sponsorship');
    }
  });

  it('flags clearance/citizenship requirements', () => {
    const warnings = checkDealbreakers(
      'Applicants must hold an active Top Secret clearance. U.S. citizenship required.',
      settingsWith({ clearance: true }),
    );
    expect(warnings.map((w) => w.id)).toContain('clearance');
  });

  it('warns when the posted salary tops out below the floor', () => {
    const warnings = checkDealbreakers(
      'Compensation: $70,000 - $85,000 per year plus equity.',
      settingsWith({ minSalary: 95_000 }),
    );
    expect(warnings.map((w) => w.id)).toContain('salary');
    expect(warnings.find((w) => w.id === 'salary')!.message).toContain('$85,000');
  });

  it('stays silent when salary meets the floor or is absent', () => {
    expect(checkDealbreakers('Pay range $90k-$120k', settingsWith({ minSalary: 95_000 }))).toEqual([]);
    expect(checkDealbreakers('Competitive compensation.', settingsWith({ minSalary: 95_000 }))).toEqual([]);
  });

  it('flags custom terms with an excerpt', () => {
    const warnings = checkDealbreakers(
      'This is a fully on-site position in our Dallas office.',
      settingsWith({ terms: ['on-site'] }),
    );
    expect(warnings[0]!.message).toContain('on-site');
    expect(warnings[0]!.excerpt).toContain('on-site position');
  });

  it('does nothing when disabled', () => {
    expect(
      checkDealbreakers('No sponsorship. TS/SCI required.', settingsWith({ enabled: false, noSponsorship: true, clearance: true })),
    ).toEqual([]);
  });
});

describe('maxPostedSalary', () => {
  it('reads $85,000 / $85k / mixed formats and picks the max', () => {
    expect(maxPostedSalary('range $70,000 to $85,000')).toBe(85_000);
    expect(maxPostedSalary('between $90k and $120K DOE')).toBe(120_000);
    expect(maxPostedSalary('a $50 gift card for interviewing')).toBeNull();
  });
});
