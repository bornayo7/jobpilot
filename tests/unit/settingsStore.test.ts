import { beforeEach, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { loadSettingsSnapshot, patchSettings, SettingsConflictError } from '@lib/storage/settingsStore';
import { getDb } from '@lib/storage/db';
beforeEach(async () => { fakeBrowser.reset(); await (await getDb()).clear('recoveryJournal'); });
it('retains independent tone and settings edits from the same base', async () => {
  const base = await loadSettingsSnapshot();
  await Promise.all([patchSettings({ promptStyle: { tone:'Warm' } },base),patchSettings({ dealbreakers:{noSponsorship:true} },base)]);
  expect((await loadSettingsSnapshot()).settings).toMatchObject({promptStyle:{tone:'Warm'},dealbreakers:{noSponsorship:true}});
});
it('detects conflict only on edited fields and keeps unchanged fields current', async () => {
  const base = await loadSettingsSnapshot();
  await patchSettings({promptStyle:{tone:'First'}},base);
  await expect(patchSettings({promptStyle:{tone:'Second'}},base)).rejects.toBeInstanceOf(SettingsConflictError);
  const draft = structuredClone(base.settings); draft.openaiKey = 'example-not-a-real-key';
  const merged = await patchSettings(draft,base);
  expect(merged.settings.promptStyle.tone).toBe('First');
  expect(merged.settings.openaiKey).toBe('example-not-a-real-key');
});
