import { test, expect } from './fixtures.mjs';
import { chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';

test('encrypted backup restores real Chrome storage and a large attachment', async ({ context, extensionId }, testInfo) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByLabel('First name', { exact: true }).fill('Backup Ada');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload document', exact: true }).click();
  await (await chooser).setFiles({ name: 'large-fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(1024 * 1024, 37) });
  await expect(page.getByRole('radio', { name: /large-fixture.pdf/ })).toBeChecked();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
  await page.getByLabel('Passphrase', { exact: true }).fill('synthetic-test-passphrase');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export encrypted backup', exact: true }).click();
  const backup = await download;
  const path = testInfo.outputPath('fixture.jpbak');
  await backup.saveAs(path);
  await page.getByLabel('First name', { exact: true }).fill('Changed after backup');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
  await page.locator('input[type="file"][accept=".jpbak,application/json"]').setInputFiles(path);
  await expect(page.getByText('Replace all current JobPilot data?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Replace data with this backup', exact: true }).click();
  await expect(page.getByText(/^Backup restored\./)).toBeVisible();
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue('Backup Ada');
  const restored = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('jobpilot'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const blobs = await new Promise((resolve, reject) => { const request = db.transaction('blobs').objectStore('blobs').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return blobs.map(blob => ({ name: blob.name, size: blob.bytes.byteLength, unchanged: new Uint8Array(blob.bytes).every(byte => byte === 37) }));
    } finally { db.close(); }
  });
  expect(restored).toEqual([{ name: 'large-fixture.pdf', size: 1024 * 1024, unchanged: true }]);
});

for (const phase of ['commit', 'rollback']) {
  test(`browser restart resumes an interrupted ${phase} journal before profile reads`, async () => {
    const root = resolve(tmpdir());
    const profile = await mkdtemp(join(root, 'jobpilot-browser-recovery-'));
    const extension = resolve('.output/chrome-mv3');
    const launch = () => chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    let context;
    try {
      context = await launch();
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const id = new URL(worker.url()).host;
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/options.html`);
      await page.getByLabel('First name', { exact: true }).fill('Before interruption');
      await page.getByRole('button', { name: 'Save profile', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
      // Seed exactly the durable state left after the IDB transaction, then
      // stop Chrome. Recovery must not depend on a promise in the old process.
      await page.evaluate(async phase => {
        await navigator.locks.request('jobpilot:storage', async () => {
          const key = 'jobpilot:profiles';
          const beforeLocal = await chrome.storage.local.get(key);
          const afterLocal = structuredClone(beforeLocal);
          const active = afterLocal[key].activeId;
          afterLocal[key].profiles[active].profile.basics.firstName = 'After recovery';
          afterLocal[key].profiles[active].revision += 1;
          const db = await new Promise((resolve, reject) => { const request = indexedDB.open('jobpilot'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
          try {
            await new Promise((resolve, reject) => {
              const tx = db.transaction('recoveryJournal', 'readwrite');
              tx.objectStore('recoveryJournal').put({ id: 'active', phase, beforeIdb: {}, beforeLocal, afterLocal, localKeys: [key] });
              tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
            });
          } finally { db.close(); }
        });
      }, phase);
      await context.close();
      context = await launch();
      const recovered = await context.newPage();
      await recovered.goto(`chrome-extension://${id}/options.html`);
      await expect(recovered.getByLabel('First name', { exact: true })).toHaveValue(phase === 'commit' ? 'After recovery' : 'Before interruption');
      expect(await recovered.evaluate(async () => {
        const db = await new Promise((resolve, reject) => { const request = indexedDB.open('jobpilot'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        try { return await new Promise((resolve, reject) => { const request = db.transaction('recoveryJournal').objectStore('recoveryJournal').count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
        finally { db.close(); }
      })).toBe(0);
    } finally {
      await context?.close();
      // Restrict recursive cleanup to this task's verified temporary directory.
      const child = relative(root, resolve(profile));
      if (child.startsWith('jobpilot-browser-recovery-') && !child.includes('..') && !child.includes('/') && !child.includes('\\')) await rm(profile, { recursive: true, force: true });
    }
  });
}
