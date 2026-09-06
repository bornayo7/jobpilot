import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyProfile, type Profile } from '@lib/schema/profile';
import { SettingsSchema } from '@lib/storage/settingsStore';
import type { ResolveOutcome } from '@lib/fill/resolver';
import type { PanelState } from '@hooks/useBackgroundPort';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), watch: null as null | ((p: Profile) => void) }));
vi.mock('@lib/fill/resolver', () => ({ resolveFields: mocks.resolve }));
vi.mock('@lib/storage/profileStore', () => ({
  loadProfile: async () => emptyProfile(),
  watchProfile: (cb: (p: Profile) => void) => { mocks.watch = cb; return () => {}; },
}));
vi.mock('@lib/storage/settingsStore', async (original) => ({
  ...await original<object>(),
  loadSettings: async () => SettingsSchema.parse({}),
  watchSettings: () => () => {},
}));
import { useFillPlan } from '@hooks/useFillPlan';

let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<typeof useFillPlan>;
const state = (): PanelState => ({
  tabId: 1, tabUrl: 'https://example.com/job', fillResults: new Map(), jd: null, focusField: null,
  frames: new Map([[0, { atsId: null, url: 'https://example.com/job', fields: [
    { fieldId: 'a', signature: 'a', label: 'First name', control: 'text', required: false },
  ] }]]),
});
function Harness({ state }: { state: PanelState }) { latest = useFillPlan(state); return null; }
function deferred() {
  let resolve!: (v: ResolveOutcome) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<ResolveOutcome>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const outcome = (calls: number): ResolveOutcome => ({ rows: [], unmatched: [], llmCalls: calls });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.resolve.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it.each(['resolve', 'reject'] as const)('ignores an old profile request that later %ss with identical fields', async (settle) => {
  const old = deferred(); const current = deferred();
  mocks.resolve.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  await act(async () => root.render(<Harness state={state()} />));
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  const profile = emptyProfile(); profile.basics.firstName = 'New';
  await act(async () => mocks.watch!(profile));
  expect(mocks.resolve).toHaveBeenCalledTimes(2);
  await act(async () => current.resolve(outcome(2)));
  await act(async () => settle === 'resolve' ? old.resolve(outcome(1)) : old.reject(new Error('old failure')));
  expect(latest.plans.get(0)?.llmCalls).toBe(2);
});

it('removes a plan when its frame becomes empty and ignores the pending result', async () => {
  const pending = deferred(); mocks.resolve.mockReturnValue(pending.promise);
  const initial = state();
  await act(async () => root.render(<Harness state={initial} />));
  const empty = { ...initial, frames: new Map([[0, { ...initial.frames.get(0)!, fields: [] }]]) };
  await act(async () => root.render(<Harness state={empty} />));
  await act(async () => pending.resolve(outcome(1)));
  expect(latest.plans.size).toBe(0);
});
