import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { browser } from '#imports';
import type { Browser } from 'wxt/browser';
import { useBackgroundPort } from '@hooks/useBackgroundPort';
import type { BgToPanel, PanelToBg } from '@lib/messaging/protocol';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('ignores delayed events from a StrictMode-disposed port after its replacement connects', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers();
  const ports: { receive: (message: BgToPanel) => void; disconnectEvent: () => void; sent: PanelToBg[] }[] = [];
  vi.spyOn(browser.runtime, 'connect').mockImplementation(() => {
    const port = { receive: (_message: BgToPanel) => {}, disconnectEvent: () => {}, sent: [] as PanelToBg[] }; ports.push(port);
    return { postMessage: (message: PanelToBg) => port.sent.push(message), disconnect: vi.fn(),
      onMessage: { addListener: (listener: typeof port.receive) => { port.receive = listener; } },
      onDisconnect: { addListener: (listener: typeof port.disconnectEvent) => { port.disconnectEvent = listener; } },
    } as unknown as Browser.runtime.Port;
  });
  vi.spyOn(browser.windows, 'getCurrent').mockResolvedValue({ id: 1 } as never);
  let latest!: ReturnType<typeof useBackgroundPort>;
  function Harness() { latest = useBackgroundPort(); return null; }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
    expect(ports).toHaveLength(2); const old = ports[0]!; const live = ports[1]!;
    await act(async () => live.receive({ t: 'bg/tabChanged', tabId: 7, url: 'https://example.com/jobs/1' }));
    const pending = latest.actions.execute(7, 0, 'doc', []);
    const execution = live.sent.find((message) => message.t === 'panel/execute');
    if (execution?.t !== 'panel/execute') throw Error('execution expected');
    await act(async () => {
      old.disconnectEvent(); old.receive({ t: 'bg/tabChanged', tabId: 99, url: 'https://old.example.com' });
      live.receive({ t: 'bg/frameEvent', tabId: 7, frameId: 0, event: { t: 'cs/fillResults', documentId: 'doc', runId: execution.runId, results: [] } });
    });
    expect(await pending).toEqual([]); expect(latest.state.tabId).toBe(7);
  } finally { await act(async () => root.unmount()); host.remove(); }
  expect(vi.getTimerCount()).toBe(0);
});
