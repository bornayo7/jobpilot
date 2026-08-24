import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { cacheGet, cacheSet } from '@lib/storage/mappingCache';

describe('mappingCache', () => {
  beforeEach(() => fakeBrowser.reset());

  it('round-trips entries and bumps hit counters', async () => {
    await cacheSet([
      { signature: 'sig1', entry: { kind: 'question.freeText', confidence: 0.8, source: 'llm', model: 'm' } },
    ]);
    const first = await cacheGet(['sig1', 'missing']);
    expect(first.get('sig1')).toMatchObject({ kind: 'question.freeText', hits: 1 });
    expect(first.has('missing')).toBe(false);

    const second = await cacheGet(['sig1']);
    expect(second.get('sig1')!.hits).toBe(2);
  });

  it('user corrections permanently shadow LLM entries', async () => {
    await cacheSet([
      { signature: 'sig1', entry: { kind: 'question.freeText', confidence: 0.7, source: 'llm' } },
    ]);
    await cacheSet([
      { signature: 'sig1', entry: { kind: 'comp.expectedSalary', confidence: 1, source: 'user-correction' } },
    ]);
    // A later LLM write must NOT overwrite the correction.
    await cacheSet([
      { signature: 'sig1', entry: { kind: 'question.choice', confidence: 0.9, source: 'llm' } },
    ]);
    const cached = await cacheGet(['sig1']);
    expect(cached.get('sig1')).toMatchObject({ kind: 'comp.expectedSalary', source: 'user-correction' });
  });
});
