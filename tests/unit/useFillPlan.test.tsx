import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyProfile, type Profile } from '@lib/schema/profile';
import { SettingsSchema, type Settings } from '@lib/storage/settingsStore';
import type { ResolveOutcome } from '@lib/fill/resolver';
import type { PanelState } from '@hooks/useBackgroundPort';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), recordUnmatched: vi.fn(), watch: null as null | ((p: Profile) => void), settingsWatch: null as null | ((s: Settings) => void) }));
vi.mock('@lib/storage/unmatchedLog', () => ({ recordUnmatched: mocks.recordUnmatched }));
vi.mock('@lib/fill/resolver', async (original) => ({ ...await original<object>(), resolveFields: mocks.resolve }));
vi.mock('@hooks/useStores', async () => {
  const { useState } = await import('react');
  return {
    useProfile: () => { const [profile, setProfile] = useState(emptyProfile); mocks.watch = setProfile; return { profile, snapshot: null }; },
    useSettings: () => { const [settings, setSettings] = useState(() => SettingsSchema.parse({})); mocks.settingsWatch = setSettings; return { settings }; },
  };
});
import { useFillPlan } from '@hooks/useFillPlan';
import { cacheGet } from '@lib/storage/mappingCache';

let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<typeof useFillPlan>;
const state = (): PanelState => ({
  tabId: 1, tabUrl: 'https://example.com/job', fillResults: new Map(), jd: null, focusField: null,
  frames: new Map([[0, { documentId: 'document-a', atsId: null, url: 'https://example.com/job', fields: [
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
  mocks.recordUnmatched.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('retains a valid editable plan if optional unmatched logging fails', async () => {
  const page = state(); const field = page.frames.get(0)!.fields[0]!;
  mocks.resolve.mockResolvedValue({ rows: [], unmatched: [field], llmCalls: 0 });
  mocks.recordUnmatched.mockRejectedValue(new Error('Log quota exceeded'));
  await act(async () => root.render(<Harness state={page} />));
  expect(latest.plans.get(0)?.unmatched).toEqual([field]);
  expect(latest.plans.get(0)?.error).toContain('could not be logged');
  await act(async () => latest.editValue(0, field.fieldId, 'Reviewed answer'));
  expect(latest.plans.get(0)?.rows[0]?.instruction?.value).toBe('Reviewed answer');
});

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

it('turns an unrecognized field into an editable mapped row and remembers the correction', async () => {
  const page = state(); const field = page.frames.get(0)!.fields[0]!;
  mocks.resolve.mockResolvedValue({ rows: [], unmatched: [field], llmCalls: 0 });
  await act(async () => root.render(<Harness state={page} />));
  await act(async () => latest.editKind(0, field.fieldId, 'name.first'));
  expect(latest.plans.get(0)!.unmatched).toEqual([]);
  expect(latest.plans.get(0)!.rows[0]!.kind).toBe('name.first');
  await act(async () => latest.editValue(0, field.fieldId, 'Ada'));
  expect(latest.plans.get(0)!.rows[0]!.instruction?.value).toBe('Ada');
  expect((await cacheGet([field.signature])).get(field.signature)?.source).toBe('user-correction');
});

it('preserves a manually reviewed answer when only writing preferences change', async () => {
  const page = state(); const field = page.frames.get(0)!.fields[0]!;
  mocks.resolve.mockResolvedValue({ rows: [], unmatched: [field], llmCalls: 0 });
  await act(async () => root.render(<Harness state={page} />));
  await act(async () => latest.editValue(0, field.fieldId, 'My reviewed answer'));
  const settings = SettingsSchema.parse({}); settings.promptStyle.tone = 'Concise';
  await act(async () => mocks.settingsWatch!(settings));
  expect(latest.plans.get(0)!.rows[0]!.instruction?.value).toBe('My reviewed answer');
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
});

it('reconciles manual values when a new field appears in the same document', async () => {
  const page = state(); const field = page.frames.get(0)!.fields[0]!;
  mocks.resolve.mockResolvedValue({ rows: [], unmatched: [field], llmCalls: 0 });
  await act(async () => root.render(<Harness state={page} />));
  await act(async () => latest.editValue(0, field.fieldId, 'Reviewed'));
  const extra = {...field, fieldId:'extra',signature:'extra'};
  mocks.resolve.mockResolvedValue({rows:[],unmatched:[field,extra],llmCalls:0});
  await act(async () => root.render(<Harness state={{...page, frames:new Map([[0,{...page.frames.get(0)!,fields:[field,extra]}]])}} />));
  expect(latest.plans.get(0)!.rows[0]!.instruction?.value).toBe('Reviewed');
  expect(latest.plans.get(0)!.unmatched).toEqual([extra]);
});
