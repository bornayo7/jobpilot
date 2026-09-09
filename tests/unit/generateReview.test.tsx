import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { PanelState } from '@hooks/useBackgroundPort';
import { getDb } from '@lib/storage/db';
import { loadProfileSnapshot } from '@lib/storage/profileStore';
import { loadSettingsSnapshot } from '@lib/storage/settingsStore';
import { loadGenerationDraft, saveGenerationDraft } from '@lib/generation/draftStore';

const mocks = vi.hoisted(() => ({ render: vi.fn(), cover: vi.fn(), save: vi.fn() }));
vi.mock('@lib/generation/renderPdf', () => ({ renderResumePdf: mocks.render }));
vi.mock('@lib/generation/renderDocx', () => ({ renderResumeDocx: async () => new ArrayBuffer(4) }));
vi.mock('@lib/generation/validatePdf', () => ({ validateResumePdf: async () => ({ ok: true, problems: [] }) }));
vi.mock('@lib/generation/renderCoverLetterPdf', () => ({ renderCoverLetterPdf: mocks.cover }));
vi.mock('@lib/storage/versions', async (original) => ({ ...await original<object>(), listVersions: async () => [], commitVersion: mocks.save }));
import { GenerateTab } from '@components/GenerateTab';
import { ImportProfileCard } from '@components/profile/ImportProfileCard';
import { emptyProfile } from '@lib/schema/profile';
let root: Root; let host: HTMLDivElement;
const state: PanelState = { tabId: 1, tabUrl: 'https://example.com/a', frames: new Map(), fillResults: new Map(), focusField: null, jd: { title: 'Job', text: 'Description' } };
const actions = { extractJd: vi.fn() };
const json = JSON.stringify({ meta: { company: 'Acme' }, basics: { name: 'Ada' } });
const button = (text: string) => [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
async function waitFor(check: () => void) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); check(); });
}
async function paste(value: string) {
  const box = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Generated result"]') ?? host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, value);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(text: string) { await act(async () => button(text)!.click()); }
async function ready() { await waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Generated result"]')?.disabled).toBe(false)); }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fakeBrowser.reset();
  const db = await getDb(); await db.clear('generationDrafts'); await db.clear('recoveryJournal');
  await loadProfileSnapshot(); await loadSettingsSnapshot();
  mocks.render.mockReset().mockResolvedValue(new ArrayBuffer(4));
  mocks.cover.mockReset().mockResolvedValue(new ArrayBuffer(4));
  mocks.save.mockReset().mockResolvedValue({ id: 'saved-version' });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('about:blank');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<GenerateTab state={state} actions={actions} />));
  await ready();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('requires a fresh review after editing the resume JSON', async () => {
  await paste(json); await click('Validate & review');
  await waitFor(() => expect(button('Approve')).toBeTruthy());
  await paste(json.replace('Ada', 'Grace'));
  expect(button('Approve')).toBeUndefined();
  expect(host.querySelector('iframe')).toBeNull();
});
it('invalidates a profile import when the pasted JSON changes', async () => {
  const update = vi.fn();
  await act(async () => root.render(<ImportProfileCard profile={emptyProfile()} update={update} />));
  await paste(JSON.stringify({ basics: { firstName: 'Ada' } })); await click('Validate');
  expect(button('Apply to profile')).toBeTruthy();
  await paste('invalid');
  expect(button('Apply to profile')).toBeUndefined();
  expect(update).not.toHaveBeenCalled();
});
it('ignores a pending preview after switching prompt types', async () => {
  let finish!: (bytes: ArrayBuffer) => void;
  mocks.render.mockReturnValue(new Promise<ArrayBuffer>((resolve) => { finish = resolve; }));
  await paste(json); await click('Validate & review');
  await waitFor(() => expect(mocks.render).toHaveBeenCalled());
  await click('Cover letter');
  await act(async () => finish(new ArrayBuffer(4)));
  await click('Tailored resume');
  expect(host.querySelector('iframe')).toBeNull();
  expect(button('Approve')).toBeUndefined();
});
it('keeps separate drafts for two postings and restores the first when returning', async () => {
  await paste(json); await click('Validate & review');
  await act(async () => root.render(<GenerateTab state={{ ...state, tabUrl: 'https://example.com/b' }} actions={actions} />));
  await ready();
  expect(button('Approve')).toBeUndefined();
  expect(host.querySelector('textarea')!.value).toBe('');
  await paste('Second application draft');
  await act(async () => root.render(<GenerateTab state={state} actions={actions} />));
  await ready();
  expect(host.querySelector('textarea')!.value).toBe(json);
});
it('does not store an obsolete cover letter or erase newer pasted text', async () => {
  let finish!: (bytes: ArrayBuffer) => void;
  mocks.cover.mockReturnValue(new Promise<ArrayBuffer>(resolve => { finish = resolve; }));
  await click('Cover letter'); await paste('Original letter'); await click('Review'); await click('Save + render PDF');
  await waitFor(() => expect(mocks.cover).toHaveBeenCalled());
  await paste('New letter drafted while the old render was running');
  await act(async () => finish(new ArrayBuffer(4)));
  expect(mocks.save).not.toHaveBeenCalled();
  expect(host.querySelector('textarea')!.value).toContain('New letter');
  expect(button('Save + render PDF')).toBeUndefined();
});
it('allows an already approved commit to finish without clearing a newer draft', async () => {
  let finish!: (record: { id: string }) => void;
  mocks.save.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await paste(json); await click('Validate & review');
  await waitFor(() => expect(button('Approve')?.disabled).toBe(false));
  await click('Approve');
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  const newer = json.replace('Ada', 'Grace');
  await paste(newer);
  await act(async () => finish({ id: 'stored' }));
  expect(host.querySelector('textarea')!.value).toBe(newer);
  expect(button('Approve')).toBeUndefined();
});
it('restores an application draft after the panel is reopened', async () => {
  await paste('Saved for later');
  await waitFor(() => expect(host.textContent).toContain('Draft saved on this device'));
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<GenerateTab state={state} actions={actions} />));
  await ready();
  expect(host.querySelector('textarea')!.value).toBe('Saved for later');
});

it('invalidates review when reloading a changed draft from another page', async () => {
  await click('Cover letter'); await paste('Original letter');
  await waitFor(() => expect(host.textContent).toContain('Draft saved on this device'));
  const key = { applicationUrl: state.tabUrl, profileId: (await loadProfileSnapshot()).id };
  const saved = (await loadGenerationDraft(key))!;
  await act(async () => saveGenerationDraft(key, { promptType: 'coverLetter', question: '', pasted: 'Changed in another page' }, saved.revision));
  await paste('Local draft that conflicts');
  await waitFor(() => expect(button('Reload saved draft')).toBeTruthy());
  await click('Review');
  expect(button('Save + render PDF')).toBeTruthy();
  await click('Reload saved draft');
  await waitFor(() => expect(host.querySelector('textarea')!.value).toBe('Changed in another page'));
  expect(button('Save + render PDF')).toBeUndefined();
});
