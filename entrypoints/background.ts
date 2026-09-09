import { browser } from '#imports';
import type { Browser } from 'wxt/browser';
import {
  CS_PORT,
  PANEL_PORT,
  type BgToCs,
  type BgToPanel,
  type CsToBg,
  type PanelToBg,
} from '@lib/messaging/protocol';
import type { AtsId } from '@lib/fill/adapters/detect';
import { SubmissionTracker } from '@lib/tracker/submissions';
import { registerEnabledSite } from '@lib/content/registerSite';

const CONTEXT_MENU_ID = 'jobpilot-fix-field';

type Port = Browser.runtime.Port;

/** One connected content script. `ready` is what its cs/ready reported, once it has. */
interface Frame {
  port: Port;
  ready: { atsId: AtsId | null; url: string; documentId: string } | null;
}

/**
 * The service worker is a pure event router. Ports and frame metadata live in
 * module scope — if Chrome kills the worker, every port dies with it and both
 * sides (content scripts, side panel) reconnect, repopulating this state. No
 * durable state lives here; what a confirmation writes goes through the
 * tracker layer.
 */
export default defineBackground(() => {
  // Toolbar click opens the side panel. Must be registered synchronously.
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('[jobpilot] setPanelBehavior failed', err));

  /** tabId -> frameId -> connected content script. */
  const frames = new Map<number, Map<number, Frame>>();
  /** port -> the tab it shows and the window it lives in (null = unknown). */
  const panels = new Map<Port, { tabId: number | null; windowId: number | null }>();
  const submissions = new SubmissionTracker();
  const runs = new Map<string, { panel: Port; tabId: number; frameId: number; documentId: string }>();

  const framesOf = (tabId: number) => frames.get(tabId) ?? new Map<number, Frame>();
  const panelsOn = (tabId: number) => [...panels].filter(([, attached]) => attached.tabId === tabId).map(([port]) => port);

  const sendToPanel = (port: Port, msg: BgToPanel) => {
    try {
      port.postMessage(msg);
    } catch {
      panels.delete(port);
    }
  };

  const sendToFrame = (tabId: number, frameId: number, msg: BgToCs) => {
    const frame = framesOf(tabId).get(frameId);
    if (!frame) return false;
    try {
      frame.port.postMessage(msg);
      return true;
    } catch {
      framesOf(tabId).delete(frameId);
      return false;
    }
  };
  const failRuns = (matches: (run: { panel: Port; tabId: number; frameId: number; documentId: string }) => boolean, error: string) => {
    for (const [runId, run] of runs) {
      if (!matches(run)) continue;
      sendToFrame(run.tabId, run.frameId, { t: 'bg/cancel', runId, documentId: run.documentId });
      sendToPanel(run.panel, { t: 'bg/runFailed', runId, error });
      runs.delete(runId);
    }
  };

  const broadcastToTab = (tabId: number, msg: BgToCs) => {
    for (const frameId of framesOf(tabId).keys()) sendToFrame(tabId, frameId, msg);
  };

  /** Point a panel at a tab: its URL, then every frame's detection so a
   *  late-opening panel sees the current state. */
  const showTab = (port: Port, tabId: number) => {
    sendToPanel(port, { t: 'bg/tabChanged', tabId, url: framesOf(tabId).get(0)?.ready?.url ?? '' });
    for (const [frameId, frame] of framesOf(tabId)) {
      if (frame.ready) {
        sendToPanel(port, { t: 'bg/frameEvent', tabId, frameId, event: { t: 'cs/ready', ...frame.ready } });
      }
      sendToFrame(tabId, frameId, { t: 'bg/scan' });
    }
  };

  // Right-click → "fix this field's mapping" → panel focuses the row.
  void browser.contextMenus
    ?.removeAll()
    .then(() => {
      browser.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: "JobPilot: fix this field's mapping",
        contexts: ['all'],
      });
    })
    .catch((err: unknown) => console.warn('[jobpilot] context menu setup failed', err));

  browser.contextMenus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID || tab?.id === undefined) return;
    // A context-menu click is a user gesture, so the panel may open.
    void browser.sidePanel?.open({ tabId: tab.id }).catch(() => undefined);
    sendToFrame(tab.id, info.frameId ?? 0, { t: 'bg/identifyContext' });
  });

  const acceptContentScript = (port: Port) => {
    const tabId = port.sender?.tab?.id;
    const frameId = port.sender?.frameId ?? 0;
    if (tabId === undefined) return;
    const tabFrames = frames.get(tabId) ?? new Map<number, Frame>();
    frames.set(tabId, tabFrames);
    const frame: Frame = { port, ready: null };
    tabFrames.set(frameId, frame);
    // The replacement document may connect before the old port's delayed
    // disconnect event arrives. Only the slot's current owner may act on it.
    const owns = () => tabFrames.get(frameId) === frame;

    port.onMessage.addListener((raw) => {
      if (!owns()) return;
      const msg = raw as CsToBg;
      if (msg.t === 'cs/ready') {
        if (frame.ready?.documentId !== msg.documentId) failRuns((run) => run.tabId === tabId && run.frameId === frameId, 'The application document changed');
        frame.ready = { atsId: msg.atsId, url: msg.url, documentId: msg.documentId };
      } else if (msg.documentId !== frame.ready?.documentId) {
        return;
      } else if (msg.t === 'cs/fillResults') {
        const run = runs.get(msg.runId);
        if (!run || run.tabId !== tabId || run.frameId !== frameId || run.documentId !== msg.documentId) return;
        runs.delete(msg.runId);
        sendToPanel(run.panel, { t: 'bg/frameEvent', tabId, frameId, event: msg });
        return;
      } else if (msg.t === 'cs/submitAttempt') {
        void submissions.attempted(tabId, { ...msg.provenance, documentId: msg.documentId, url: msg.url, title: msg.title, answers: msg.answers })
          .catch((error) => { for (const panel of panelsOn(tabId)) sendToPanel(panel, { t: 'bg/trackerStatus', tabId, message: `Could not preserve application evidence: ${String(error)}` }); });
      } else if (msg.t === 'cs/submitDetected') {
        void submissions.confirmed(tabId, msg).then((result) => {
          const message = result.status === 'recorded' ? `Application recorded for ${result.job.company}.` : result.reason;
          for (const panel of panelsOn(tabId)) sendToPanel(panel, { t: 'bg/trackerStatus', tabId, message });
        });
      }
      for (const panel of panelsOn(tabId)) {
        sendToPanel(panel, { t: 'bg/frameEvent', tabId, frameId, event: msg });
      }
    });

    port.onDisconnect.addListener(() => {
      if (!owns()) return;
      failRuns((run) => run.tabId === tabId && run.frameId === frameId, 'The application frame disconnected');
      tabFrames.delete(frameId);
      if (tabFrames.size === 0) frames.delete(tabId);
      for (const panel of panelsOn(tabId)) sendToPanel(panel, { t: 'bg/frameGone', tabId, frameId });
    });
  };

  const acceptPanel = (port: Port) => {
    panels.set(port, { tabId: null, windowId: null });

    port.onMessage.addListener(async (raw) => {
      const msg = raw as PanelToBg;
      switch (msg.t) {
        case 'panel/attach': {
          const windowId = msg.windowId ?? null;
          let tabId = msg.tabId;
          if (tabId === null) {
            // A service worker has no "current window"; ask for the panel's
            // own window when it told us, else the last focused one.
            const [active] = await browser.tabs.query(
              windowId !== null ? { active: true, windowId } : { active: true, lastFocusedWindow: true },
            );
            tabId = active?.id ?? null;
          }
          panels.set(port, { tabId, windowId });
          if (tabId !== null) showTab(port, tabId);
          break;
        }
        case 'panel/scan':
          broadcastToTab(msg.tabId, { t: 'bg/scan' });
          break;
        case 'panel/extractJd':
          broadcastToTab(msg.tabId, { t: 'bg/extractJd' });
          break;
        case 'panel/execute': {
          const frame = framesOf(msg.tabId).get(msg.frameId);
          if (!frame?.ready || frame.ready.documentId !== msg.documentId || [...runs.values()].some((run) => run.tabId === msg.tabId && run.frameId === msg.frameId)) {
            sendToPanel(port, { t: 'bg/runFailed', runId: msg.runId, error: 'The page changed or another fill is still running' });
            break;
          }
          runs.set(msg.runId, { panel: port, tabId: msg.tabId, frameId: msg.frameId, documentId: msg.documentId });
          if (!sendToFrame(msg.tabId, msg.frameId, { t: 'bg/execute', documentId: msg.documentId, runId: msg.runId, instructions: msg.instructions, files: msg.files, provenance: msg.provenance })) {
            failRuns((run) => run.panel === port && run.documentId === msg.documentId, 'The application frame is unavailable');
          }
          break;
        }
        case 'panel/cancel':
          if (runs.get(msg.runId)?.panel === port) {
            sendToFrame(msg.tabId, msg.frameId, { t: 'bg/cancel', documentId: msg.documentId, runId: msg.runId });
            runs.delete(msg.runId);
          }
          break;
        case 'panel/highlight':
          sendToFrame(msg.tabId, msg.frameId, { t: 'bg/highlight', fieldId: msg.fieldId });
          break;
        case 'panel/registerSite':
          try {
            await registerEnabledSite(msg);
            sendToPanel(port, { t: 'bg/siteRegistered', requestId: msg.requestId });
          } catch (error) {
            sendToPanel(port, { t: 'bg/siteRegistered', requestId: msg.requestId, error: String(error instanceof Error ? error.message : error) });
          }
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      failRuns((run) => run.panel === port, 'The panel disconnected');
      panels.delete(port);
    });
  };

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === CS_PORT) acceptContentScript(port);
    else if (port.name === PANEL_PORT) acceptPanel(port);
  });

  // A closed tab can never produce the confirmation its attempt was waiting for.
  browser.tabs.onRemoved.addListener((tabId) => {
    failRuns((run) => run.tabId === tabId, 'The tab closed');
    void submissions.forget(tabId).catch((error) => console.warn('[jobpilot] attempt cleanup failed', error));
  });

  // Navigation to an unenabled site never sends cs/ready. Clear the previous
  // application's state as soon as navigation starts, including reloads.
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== 'loading' && !change.url) return;
    failRuns((run) => run.tabId === tabId, 'The application page navigated');
    for (const panel of panelsOn(tabId)) {
      sendToPanel(panel, { t: 'bg/tabChanged', tabId, url: change.url ?? '', reset: true });
    }
  });

  // Keep attached panels pointed at the tab the user is actually looking at —
  // in the panel's own window. Side panels are per-window, so a tab switch in
  // a second window must not repoint the first window's panel.
  browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
    for (const [port, attached] of panels) {
      if (attached.windowId !== null && attached.windowId !== windowId) continue;
      panels.set(port, { ...attached, tabId });
      showTab(port, tabId);
    }
  });
});
