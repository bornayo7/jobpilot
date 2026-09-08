import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { PanelState } from '@hooks/useBackgroundPort';

const mocks = vi.hoisted(() => ({ render: vi.fn(), save: vi.fn() }));
vi.mock('@lib/generation/renderPdf', () => ({ renderResumePdf: mocks.render }));
vi.mock('@lib/generation/renderDocx', () => ({ renderResumeDocx: vi.fn() }));
vi.mock('@lib/generation/renderCoverLetterPdf', () => ({ renderCoverLetterPdf: vi.fn() }));
vi.mock('@lib/storage/versions', () => ({ listVersions: async () => [], saveVersion: mocks.save }));
import { GenerateTab } from '@components/GenerateTab';
import { ImportProfileCard } from '@components/profile/ImportProfileCard';
import { emptyProfile } from '@lib/schema/profile';
let root: Root; let host: HTMLDivElement;
const state: PanelState = { tabId: 1, tabUrl: 'https://example.com/a', frames: new Map(), fillResults: new Map(), focusField: null, jd: { title: 'Job', text: 'Description' } };
const actions = { send: vi.fn(), extractJd: vi.fn() };
const json = JSON.stringify({ meta: { company: 'Acme' }, basics: { name: 'Ada' } });
async function paste(value: string) {
  const box = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, value);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
  await act(async () => button.click());
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fakeBrowser.reset(); mocks.render.mockReset().mockResolvedValue(new ArrayBuffer(4)); mocks.save.mockReset();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('about:blank');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<GenerateTab state={state} actions={actions} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('requires a fresh review after editing the resume JSON', async () => {
  await paste(json); await click('Validate & review');
  expect(host.textContent).toContain('Approve');
  await paste(json.replace('Ada', 'Grace'));
  expect(host.textContent).not.toContain('Approve');
  expect(host.querySelector('iframe')).toBeNull();
});

it('invalidates a profile import when the pasted JSON changes', async () => {
  const update = vi.fn();
  await act(async () => root.render(<ImportProfileCard profile={emptyProfile()} update={update} />));
  await paste(JSON.stringify({ basics: { firstName: 'Ada' } })); await click('Validate');
  expect(host.textContent).toContain('Apply to profile');
  await paste('invalid');
  expect(host.textContent).not.toContain('Apply to profile');
  expect(update).not.toHaveBeenCalled();
});

it('ignores a pending preview after switching prompt types', async () => {
  let finish!: (bytes: ArrayBuffer) => void;
  mocks.render.mockReturnValue(new Promise<ArrayBuffer>((resolve) => { finish = resolve; }));
  await paste(json); await click('Validate & review'); await click('Cover letter');
  await act(async () => finish(new ArrayBuffer(4)));
  await click('Tailored resume');
  expect(host.querySelector('iframe')).toBeNull();
  expect(host.textContent).not.toContain('Approve');
});

it('invalidates review when moving to another posting while preserving the pasted draft', async () => {
  await paste(json); await click('Validate & review');
  await act(async () => root.render(<GenerateTab state={{ ...state, tabUrl: 'https://example.com/b' }} actions={actions} />));
  expect(host.textContent).not.toContain('Approve');
  expect(host.querySelector('textarea')!.value).toBe(json);
});
