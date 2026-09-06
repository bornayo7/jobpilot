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

  it('keeps simultaneous frame writes instead of letting the last snapshot win', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => cacheSet([
      { signature: `s${i}`, entry: { kind: 'question.freeText', confidence: 1, source: 'user-correction' } },
    ])));
    expect((await cacheGet(Array.from({ length: 12 }, (_, i) => `s${i}`))).size).toBe(12);
  });

  it('does not erase a correction while another lookup updates hit counters', async () => {
    await cacheSet([{ signature: 'old', entry: { kind: 'question.freeText', confidence: 0.8, source: 'llm' } }]);
    await Promise.all([
      cacheGet(['old']),
      cacheSet([{ signature: 'new', entry: { kind: 'name.first', confidence: 1, source: 'user-correction' } }]),
    ]);
    expect((await cacheGet(['old', 'new'])).size).toBe(2);
  });

  it('retains manual corrections when model entries exceed the cache limit', async () => {
    await cacheSet([{ signature: 'manual', entry: { kind: 'name.first', confidence: 1, source: 'user-correction' } }]);
    await cacheSet(Array.from({ length: 2001 }, (_, i) => ({
      signature: `model${i}`,
      entry: { kind: 'question.freeText' as const, confidence: 0.8, source: 'llm' as const },
    })));
    const found = await cacheGet(['manual', ...Array.from({ length: 2001 }, (_, i) => `model${i}`)]);
    expect(found.has('manual')).toBe(true);
    expect(found.size).toBe(2001);
  });
});
