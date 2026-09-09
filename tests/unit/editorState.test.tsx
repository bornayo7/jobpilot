import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getDb } from '@lib/storage/db';
import { createProfile, loadProfileSnapshot, saveProfileSnapshot, switchProfile } from '@lib/storage/profileStore';
import { loadSettings, patchSettings } from '@lib/storage/settingsStore';
import { saveAnswer, listAnswers, patchAnswer } from '@lib/memory/answers';
import { createJob, listJobs, patchJob } from '@lib/tracker/store';
import { SettingsTab } from '@components/SettingsTab';
import { AnswersTab } from '@components/AnswersTab';
import { TrackerTab } from '@components/TrackerTab';
import { OptionsApp } from '../../entrypoints/options/OptionsApp';
import { emptyProfile } from '@lib/schema/profile';

let host: HTMLDivElement; let root: Root;
async function waitFor(check: () => void | Promise<void>) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); await check(); });
}
async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fakeBrowser.reset();
  const db = await getDb();
  await db.clear('answers'); await db.clear('trackerJobs'); await db.clear('recoveryJournal');
  await loadProfileSnapshot();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('saves an edited warning without overwriting the newer Generate tone', async () => {
  await patchSettings({ promptStyle: { tone: 'Original tone' } });
  await act(async () => root.render(<SettingsTab />));
  await waitFor(() => expect(host.querySelector('.checkbox-line input')).not.toBeNull());
  await act(async () => (host.querySelector('.checkbox-line input') as HTMLInputElement).click());
  await act(async () => patchSettings({ promptStyle: { tone: 'New tone from Generate' } }));
  const save = [...host.querySelectorAll('button')].find(button => button.textContent === 'Save settings')!;
  await act(async () => save.click());
  await waitFor(async () => {
    const saved = await loadSettings();
    expect(saved.promptStyle.tone).toBe('New tone from Generate');
    expect(saved.dealbreakers.noSponsorship).toBe(true);
  });
});

it('keeps both the answer edit and an immediately clicked reuse choice', async () => {
  await saveAnswer({ questionRaw: 'Why this role?', answer: 'Old answer', company: 'Acme', jobId: 'job', reusable: false });
  await act(async () => root.render(<AnswersTab />));
  await waitFor(() => expect(host.querySelector('textarea[aria-label="Answer to Why this role?"]')).not.toBeNull());
  const box = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Answer to Why this role?"]')!;
  await input(box, 'Edited answer');
  await act(async () => {
    box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    host.querySelector<HTMLInputElement>('.include input')!.click();
  });
  await waitFor(async () => {
    const [saved] = await listAnswers();
    expect(saved?.answer).toBe('Edited answer');
    expect(saved?.reusable).toBe(true);
    expect(saved?.reuseConfirmed).toBe(true);
  });
});

it('preserves an answer draft and reports conflict when another editor changes the same answer', async () => {
  const saved = await saveAnswer({ questionRaw: 'Why this role?', answer: 'Original answer', company: 'Acme', jobId: 'job', reusable: false });
  await act(async () => root.render(<AnswersTab />));
  await waitFor(() => expect(host.querySelector('textarea[aria-label="Answer to Why this role?"]')).not.toBeNull());
  const box = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Answer to Why this role?"]')!;
  await input(box, 'My local draft');
  await act(async () => patchAnswer(saved.id, { answer: 'Saved by another editor' }, saved));
  await act(async () => box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  await waitFor(() => expect(host.textContent).toContain('Answer was not updated'));
  expect(box.value).toBe('My local draft');
  expect((await listAnswers())[0]?.answer).toBe('Saved by another editor');
});

it('preserves notes and reports conflict when another editor changes the same notes', async () => {
  const saved = await createJob({ company: 'Acme', title: 'Engineer', url: 'https://example.com/jobs/123', notes: 'Original note' });
  if (!saved) throw new Error('Synthetic application was not saved');
  await act(async () => root.render(<TrackerTab />));
  await waitFor(() => expect(host.querySelector('textarea')).not.toBeNull());
  const box = host.querySelector('textarea')!;
  await input(box, 'My local notes');
  await act(async () => patchJob(saved.id, { notes: 'Saved by another editor' }, saved));
  await act(async () => box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  await waitFor(() => expect(host.textContent).toContain('Application was not updated'));
  expect(box.value).toBe('My local notes');
  expect((await listJobs())[0]?.notes).toBe('Saved by another editor');
});

it('keeps notes when the application status changes immediately after blur', async () => {
  await createJob({ company: 'Acme', title: 'Engineer', url: 'https://example.com/jobs/123', notes: 'Old note' });
  await act(async () => root.render(<TrackerTab />));
  await waitFor(() => expect(host.querySelector('textarea')).not.toBeNull());
  const box = host.querySelector('textarea')!;
  await input(box, 'Interview with Ada');
  await act(async () => {
    box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    const select = host.querySelector<HTMLSelectElement>('select')!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'interviewing');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await waitFor(async () => {
    const [saved] = await listJobs();
    expect(saved?.notes).toBe('Interview with Ada');
    expect(saved?.status).toBe('interviewing');
  });
});

it('keeps exactly one profile import, documents and skills editor after import and profile switching', async () => {
  await act(async () => root.render(<OptionsApp />));
  await waitFor(() => expect(host.querySelector('input[accept="application/json"]')).not.toBeNull());
  const profile = emptyProfile(); profile.basics.firstName = 'Imported';
  const file = new File([JSON.stringify(profile)], 'profile.json', { type: 'application/json' });
  const upload = host.querySelector<HTMLInputElement>('input[accept="application/json"]')!;
  Object.defineProperty(upload, 'files', { configurable: true, value: [file] });
  await act(async () => upload.dispatchEvent(new Event('change', { bubbles: true })));
  await waitFor(() => expect([...host.querySelectorAll('input')].some(input => input.value === 'Imported')).toBe(true));
  await act(async () => createProfile('Second profile'));
  await waitFor(() => expect(host.querySelector<HTMLSelectElement>('[aria-label="Active profile"]')?.selectedOptions[0]?.textContent).toBe('Second profile'));
  await act(async () => switchProfile('default'));
  await waitFor(() => {
    expect([...host.querySelectorAll('input')].some(input => input.value === 'Imported')).toBe(true);
    const headings = [...host.querySelectorAll('h2')].map(item => item.textContent);
    expect(headings.filter(text => text === 'Documents')).toHaveLength(1);
    expect(headings.filter(text => text === 'Skills')).toHaveLength(1);
    expect(headings.filter(text => text === 'Import from your existing resume')).toHaveLength(1);
    expect([...host.querySelectorAll('button')].filter(item => item.textContent === 'Upload document')).toHaveLength(1);
  });
});

it('does not apply a delayed upload selection to a newer saved profile revision', async () => {
  const base = await loadProfileSnapshot();
  await act(async () => root.render(<OptionsApp />));
  await waitFor(() => expect(host.querySelector('input[accept^=".pdf"]')).not.toBeNull());
  let finish!: (bytes: ArrayBuffer) => void;
  const file = new File(['pdf'], 'resume.pdf', { type: 'application/pdf' });
  vi.spyOn(file, 'arrayBuffer').mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const upload = host.querySelector<HTMLInputElement>('input[accept^=".pdf"]')!;
  Object.defineProperty(upload, 'files', { configurable: true, value: [file] });
  await act(async () => upload.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => saveProfileSnapshot(base, { ...base.profile, basics: { ...base.profile.basics, firstName: 'New saved profile' } }));
  await waitFor(() => expect([...host.querySelectorAll('input')].some(input => input.value === 'New saved profile')).toBe(true));
  await act(async () => finish(new ArrayBuffer(4)));
  await waitFor(() => expect(host.textContent).toContain('saved profile changed during this action'));
  expect([...host.querySelectorAll<HTMLInputElement>('input[type=radio]')].every(input => !input.checked)).toBe(true);
  expect((await loadProfileSnapshot()).profile.documents.defaultResumeId).toBeNull();
});
