import { describe, expect, it } from 'vitest';
import { rankAnswers, type AnswerRecord } from '@lib/memory/answers';
import { questionSimilarity } from '@lib/util/fuzzy';

function record(partial: Partial<AnswerRecord> & Pick<AnswerRecord, 'id' | 'questionRaw' | 'answer'>): AnswerRecord {
  return {
    questionNormalized: '',
    jobId: '',
    company: '',
    reusable: true,
    reuseConfirmed: true,
    createdAt: 0,
    ...partial,
  };
}

describe('questionSimilarity', () => {
  it('scores paraphrased questions above the suggestion threshold (0.4)', () => {
    const score = questionSimilarity(
      'Why do you want to work here?',
      'Why would you like to work at our company?',
    );
    expect(score).toBeGreaterThan(0.4);
  });

  it('scores unrelated questions below the threshold', () => {
    const score = questionSimilarity('Why do you want to work here?', 'What is your expected salary range?');
    expect(score).toBeLessThan(0.4);
  });

  it('identical questions score near 1', () => {
    expect(questionSimilarity('Describe a project you are proud of', 'Describe a project you are proud of')).toBeGreaterThan(0.95);
  });
});

describe('rankAnswers', () => {
  const bank: AnswerRecord[] = [
    record({ id: 'a', questionRaw: 'Why do you want to work here?', answer: 'Because X', reusable: true, company: 'Acme' }),
    record({ id: 'b', questionRaw: 'Why do you want to work here?', answer: 'Company-B specific', reusable: false, jobId: 'job-b', company: 'BetaCorp' }),
    record({ id: 'c', questionRaw: 'What is your salary expectation?', answer: '$90k', reusable: true }),
  ];

  it('suggests reusable answers for paraphrased questions, ranked by score', () => {
    const suggestions = rankAnswers('Why would you like to work at our company?', bank, '');
    expect(suggestions.map((s) => s.record.id)).toContain('a');
    expect(suggestions.map((s) => s.record.id)).not.toContain('c');
  });

  it('anti-answer-bleed: non-reusable answers from OTHER jobs are never suggested', () => {
    const suggestions = rankAnswers('Why do you want to work here?', bank, 'job-x');
    expect(suggestions.map((s) => s.record.id)).not.toContain('b');
  });

  it('same-job answers qualify even when non-reusable', () => {
    const suggestions = rankAnswers('Why do you want to work here?', bank, 'job-b');
    expect(suggestions.map((s) => s.record.id)).toContain('b');
  });

  it('requires fresh confirmation before reusing legacy automatically captured answers', () => {
    const legacy = record({ id: 'legacy', questionRaw: 'Why this role?', answer: 'Private context', reuseConfirmed: undefined });
    expect(rankAnswers('Why this role?', [legacy], '')).toEqual([]);
    expect(rankAnswers('Why this role?', [{...legacy, reuseConfirmed:true}], '')).toHaveLength(1);
  });

  it('suggests an application-only answer on the same canonical application', () => {
    const saved = record({ id:'scoped',questionRaw:'Why this role?',answer:'Specific answer',reusable:false,applicationId:'lever:acme:1' });
    expect(rankAnswers('Why this role?', [saved], 'lever:acme:1')).toHaveLength(1);
    expect(rankAnswers('Why this role?', [saved], 'lever:other:2')).toEqual([]);
  });
});
