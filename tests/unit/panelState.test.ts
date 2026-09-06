import { expect, it } from 'vitest';
import { reduce, type PanelState } from '@hooks/useBackgroundPort';
const state = (): PanelState => ({
  tabId: 1, tabUrl: 'https://example.com/a', jd: { title: 'Old job', text: 'Old text', frameId: 2 },
  fillResults: new Map([['old', { fieldId: 'old', ok: true }]]), focusField: null,
  frames: new Map([[0, { atsId: null, url: 'https://example.com/a', fields: [
    { fieldId: 'old', signature: 'old', control: 'text', label: 'Email', required: false },
  ] }], [2, { atsId: null, url: 'https://embedded.example/a', fields: [] }]]),
});

it('clears page state on a same-tab loading event even without a new content script', () => {
  const next = reduce(state(), { t: 'bg/tabChanged', tabId: 1, url: '', reset: true });
  expect(next.frames.size).toBe(0); expect(next.jd).toBeNull(); expect(next.fillResults.size).toBe(0);
});

it('drops old fields and child frames after a top-frame SPA navigation', () => {
  const next = reduce(state(), { t: 'bg/frameEvent', tabId: 1, frameId: 0, event: { t: 'cs/ready', atsId: null, url: 'https://example.com/b' } });
  expect(next.frames.size).toBe(1); expect(next.frames.get(0)!.fields).toEqual([]); expect(next.jd).toBeNull();
});

it('clears an embedded frame job description when that frame goes away', () => {
  const next = reduce(state(), { t: 'bg/frameGone', tabId: 1, frameId: 2 });
  expect(next.jd).toBeNull(); expect(next.frames.has(2)).toBe(false);
});

it('preserves a same-page reattachment but resets a changed URL', () => {
  expect(reduce(state(), { t: 'bg/tabChanged', tabId: 1, url: 'https://example.com/a' }).jd).not.toBeNull();
  expect(reduce(state(), { t: 'bg/tabChanged', tabId: 1, url: 'https://example.com/b' }).jd).toBeNull();
});

it('does not discard the posting when an unrelated iframe disconnects', () => {
  expect(reduce(state(), { t: 'bg/frameGone', tabId: 1, frameId: 99 }).jd).not.toBeNull();
});
