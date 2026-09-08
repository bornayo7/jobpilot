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

const CONTEXT_MENU_ID = 'jobpilot-fix-field';

type Port = Browser.runtime.Port;

/** One connected content script. `ready` is what its cs/ready reported, once it has. */
interface Frame {
  port: Port;
  ready: { atsId: AtsId | null; url: string } | null;
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
    if (!frame) return;
    try {
      frame.port.postMessage(msg);
    } catch {
      framesOf(tabId).delete(frameId);
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
        frame.ready = { atsId: msg.atsId, url: msg.url };
      } else if (msg.t === 'cs/submitAttempt') {
        submissions.attempted(tabId, { url: msg.url, title: msg.title, answers: msg.answers });
      } else if (msg.t === 'cs/submitDetected') {
        void submissions.confirmed(tabId, { url: msg.url, title: msg.title });
      }
      for (const panel of panelsOn(tabId)) {
        sendToPanel(panel, { t: 'bg/frameEvent', tabId, frameId, event: msg });
      }
    });

    port.onDisconnect.addListener(() => {
      if (!owns()) return;
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
        case 'panel/execute':
          sendToFrame(msg.tabId, msg.frameId, { t: 'bg/execute', instructions: msg.instructions, files: msg.files });
          break;
        case 'panel/highlight':
          sendToFrame(msg.tabId, msg.frameId, { t: 'bg/highlight', fieldId: msg.fieldId });
          break;
        case 'panel/registerSite':
          await registerSite(msg.origin, msg.tabId);
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      panels.delete(port);
    });
  };

  /** Persist content-script injection for an origin the user enabled, then reload. */
  const registerSite = async (origin: string, tabId: number) => {
    const registrationId = `jobpilot-site-${new URL(origin).host}`;
    try {
      const existing = await browser.scripting.getRegisteredContentScripts({ ids: [registrationId] });
      if (existing.length === 0) {
        await browser.scripting.registerContentScripts([
          {
            id: registrationId,
            js: ['content-scripts/ats.js'],
            matches: [`${origin}/*`],
            allFrames: true,
            runAt: 'document_idle',
            persistAcrossSessions: true,
          },
        ]);
      }
      await browser.tabs.reload(tabId);
    } catch (err) {
      console.error('[jobpilot] registerSite failed', err);
    }
  };

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === CS_PORT) acceptContentScript(port);
    else if (port.name === PANEL_PORT) acceptPanel(port);
  });

  // A closed tab can never produce the confirmation its attempt was waiting for.
  browser.tabs.onRemoved.addListener((tabId) => submissions.forget(tabId));

  // Navigation to an unenabled site never sends cs/ready. Clear the previous
  // application's state as soon as navigation starts, including reloads.
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== 'loading' && !change.url) return;
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
