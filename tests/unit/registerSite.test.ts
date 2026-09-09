import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browser } from '#imports';
import { enableCurrentSite, registerEnabledSite } from '@lib/content/registerSite';
import { SiteRegistrations } from '@lib/messaging/siteRegistrations';
import type { PanelToBg } from '@lib/messaging/protocol';

const target = { tabId: 7, origin: 'https://careers.example.com', url: 'https://careers.example.com/jobs/1' };
beforeEach(() => {
  vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ id: 7, url: target.url }] as never);
  vi.spyOn(browser.tabs, 'get').mockResolvedValue({ id: 7, url: target.url } as never);
  vi.spyOn(browser.tabs, 'reload').mockResolvedValue();
  vi.spyOn(browser.permissions, 'request').mockResolvedValue(true as never);
  vi.spyOn(browser.permissions, 'contains').mockResolvedValue(true as never);
  vi.spyOn(browser.scripting, 'getRegisteredContentScripts').mockResolvedValue([] as never);
  vi.spyOn(browser.scripting, 'registerContentScripts').mockResolvedValue();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('reports enabled only after permission, registration, and reload succeed', async () => {
  expect(await enableCurrentSite(7, registerEnabledSite)).toBe(target.origin);
  expect(browser.scripting.registerContentScripts).toHaveBeenCalledWith([expect.objectContaining({ matches: [`${target.origin}/*`], js: ['content-scripts/ats.js'], persistAcrossSessions: true })]);
  expect(browser.tabs.reload).toHaveBeenCalledWith(7);
});
it('propagates denied and rejected permission without registering or reloading', async () => {
  vi.mocked(browser.permissions.request).mockResolvedValueOnce(false as never).mockRejectedValueOnce(new Error('Permission API unavailable'));
  await expect(enableCurrentSite(7, registerEnabledSite)).rejects.toThrow('Permission declined');
  await expect(enableCurrentSite(7, registerEnabledSite)).rejects.toThrow('Permission API unavailable');
  expect(browser.scripting.registerContentScripts).not.toHaveBeenCalled(); expect(browser.tabs.reload).not.toHaveBeenCalled();
});
it('propagates registration failure and never claims success or reloads', async () => {
  vi.mocked(browser.scripting.registerContentScripts).mockRejectedValue(new Error('Registration refused'));
  await expect(enableCurrentSite(7, registerEnabledSite)).rejects.toThrow('Registration refused');
  expect(browser.tabs.reload).not.toHaveBeenCalled();
});
it('does not reload a different page after asynchronous registration', async () => {
  vi.mocked(browser.tabs.get).mockResolvedValueOnce({ url: target.url } as never).mockResolvedValueOnce({ url: `${target.url}/other` } as never);
  await expect(registerEnabledSite(target)).rejects.toThrow('page changed');
  expect(browser.tabs.reload).not.toHaveBeenCalled();
});
it('rejects revoked permission and a switched active tab', async () => {
  vi.mocked(browser.permissions.contains).mockResolvedValue(false as never);
  await expect(registerEnabledSite(target)).rejects.toThrow('no longer granted');
  await expect(enableCurrentSite(8, registerEnabledSite)).rejects.toThrow('Open the job page');
  expect(browser.scripting.registerContentScripts).not.toHaveBeenCalled();
});
it('waits for its request acknowledgement and propagates worker errors', async () => {
  const sent: PanelToBg[] = []; const pending = new SiteRegistrations((message) => sent.push(message));
  const first = pending.register(target); let finished = false; void first.then(() => { finished = true; });
  const message = sent[0]; if (message?.t !== 'panel/registerSite') throw Error('registration expected');
  pending.accept({ t: 'bg/siteRegistered', requestId: 'old' }); await Promise.resolve(); expect(finished).toBe(false);
  pending.accept({ t: 'bg/siteRegistered', requestId: message.requestId }); await first;
  const second = pending.register(target); const secondResult = expect(second).rejects.toThrow('Refused');
  const next = sent[1]; if (next?.t !== 'panel/registerSite') throw Error('registration expected');
  pending.accept({ t: 'bg/siteRegistered', requestId: next.requestId, error: 'Refused' }); await secondResult;
});
it('settles missing acknowledgements on disconnect or timeout', async () => {
  vi.useFakeTimers(); const requests = new SiteRegistrations(vi.fn());
  const first = expect(requests.register(target)).rejects.toThrow('disconnected'); requests.cancelAll(); await first;
  const second = expect(requests.register(target)).rejects.toThrow('did not acknowledge'); await vi.advanceTimersByTimeAsync(15_001); await second;
});
