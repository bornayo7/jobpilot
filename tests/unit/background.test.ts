import { afterEach, expect, it, vi } from 'vitest';
import { browser } from '#imports';
import type { Browser } from 'wxt/browser';
import { CS_PORT, PANEL_PORT, type BgToCs, type CsToBg, type PanelToBg } from '@lib/messaging/protocol';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('hydrates a panel attached after a stable form has already reported its fields', async () => {
  let connect: (port: Browser.runtime.Port) => void = () => {};
  vi.spyOn(browser.runtime.onConnect, 'addListener').mockImplementation((listener) => { connect = listener; });
  vi.spyOn(browser.contextMenus, 'removeAll').mockResolvedValue();
  vi.spyOn(browser.contextMenus, 'create').mockReturnValue('menu');
  vi.spyOn(browser.sidePanel, 'setPanelBehavior').mockResolvedValue();
  vi.spyOn(browser.tabs.onRemoved, 'addListener').mockImplementation(() => {});
  vi.spyOn(browser.tabs.onUpdated, 'addListener').mockImplementation(() => {});
  vi.spyOn(browser.tabs.onActivated, 'addListener').mockImplementation(() => {});
  vi.spyOn(browser.contextMenus.onClicked, 'addListener').mockImplementation(() => {});
  vi.stubGlobal('defineBackground', (callback: () => void) => callback);
  const { default: boot } = await import('../../entrypoints/background');
  boot.main();
  let receiveContent: (message: CsToBg) => void = () => {};
  let receivePanel: (message: PanelToBg) => Promise<void> = async () => {};
  const panelMessages: unknown[] = [];
  const content = { name: CS_PORT, sender: { tab: { id: 7 }, frameId: 0 },
    postMessage: vi.fn((message: BgToCs) => {
      if (message.t === 'bg/scan') receiveContent({ t: 'cs/fields', documentId: 'stable', fields: [] });
    }), onMessage: { addListener: (listener: typeof receiveContent) => { receiveContent = listener; } }, onDisconnect: { addListener: vi.fn() } };
  connect(content as unknown as Browser.runtime.Port);
  receiveContent({ t: 'cs/ready', documentId: 'stable', atsId: 'ashby', url: 'https://jobs.ashbyhq.com/acme/1' });
  receiveContent({ t: 'cs/fields', documentId: 'stable', fields: [] });
  connect({ name: PANEL_PORT, postMessage: (message: unknown) => panelMessages.push(message),
    onMessage: { addListener: (listener: typeof receivePanel) => { receivePanel = listener; } }, onDisconnect: { addListener: vi.fn() } } as unknown as Browser.runtime.Port);
  await receivePanel({ t: 'panel/attach', tabId: 7 });
  expect(content.postMessage).toHaveBeenCalledWith({ t: 'bg/scan' });
  expect(panelMessages).toContainEqual(expect.objectContaining({ t: 'bg/frameEvent', event: expect.objectContaining({ t: 'cs/fields', documentId: 'stable' }) }));
});
