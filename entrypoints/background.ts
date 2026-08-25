import { browser } from '#imports';
import type { Browser } from 'wxt/browser';
import {
  CS_PORT,
  PANEL_PORT,
  type BgToCs,
  type BgToPanel,
  type CapturedAnswer,
  type CsToBg,
  type PanelToBg,
} from '@lib/messaging/protocol';
import type { AtsId } from '@lib/fill/adapters/ids';
import { cleanJobTitle, companyFromUrl } from '@lib/tracker/detect';
import { createJob } from '@lib/tracker/store';
import { saveAnswer } from '@lib/memory/answers';
import { loadProfile } from '@lib/storage/profileStore';
import { getDb } from '@lib/storage/db';

const CONTEXT_MENU_ID = 'jobpilot-fix-field';
const ATTEMPT_TTL_MS = 20 * 60 * 1000;

type Port = Browser.runtime.Port;

/**
 * The service worker is a pure event router. Ports and frame metadata live in
 * module scope — if Chrome kills the worker, every port dies with it and both
 * sides (content scripts, side panel) reconnect, repopulating this state. No
 * durable state lives here; everything durable is in storage.
 */
export default defineBackground(() => {
  // Toolbar click opens the side panel. Must be registered synchronously.
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('[jobpilot] setPanelBehavior failed', err));

  const frameKey = (tabId: number, frameId: number) => `${tabId}:${frameId}`;

  const csPorts = new Map<string, Port>();
  const frameMeta = new Map<string, { atsId: AtsId | null; url: string }>();
  const panelPorts = new Map<Port, number | null>(); // port -> attached tabId
  /** Submit-attempt snapshots awaiting a confirmation page, per tab. */
  const pendingAttempts = new Map<number, { url: string; title: string; answers: CapturedAnswer[]; at: number }>();

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

  /** Confirmation seen: pair with the attempt, write tracker job + answers. */
  const recordApplication = async (
    tabId: number,
    detected: { url: string; title: string },
  ): Promise<void> => {
    const attempt = pendingAttempts.get(tabId);
    const fresh = attempt && Date.now() - attempt.at < ATTEMPT_TTL_MS ? attempt : null;
    pendingAttempts.delete(tabId);

    const sourceUrl = fresh?.url ?? detected.url;
    const { company } = companyFromUrl(sourceUrl);
    const title = cleanJobTitle(fresh?.title || detected.title);

    let resumeName: string | undefined;
    try {
      const profile = await loadProfile();
      if (profile.documents.defaultResumeId) {
        const db = await getDb();
        resumeName = (await db.get('blobs', profile.documents.defaultResumeId))?.name;
      }
    } catch {
      // Resume attribution is best-effort.
    }

    const job = await createJob({ company, title, url: sourceUrl, resumeName }).catch(() => null);
    if (!job) return; // duplicate within 24h, or storage failure

    for (const answer of fresh?.answers ?? []) {
      await saveAnswer({
        questionRaw: answer.label,
        answer: answer.value,
        jobId: job.id,
        company: job.company,
        reusable: true, // hand-typed by the user — safe to resurface (review-gated)
      }).catch(() => undefined);
    }
  };

  const sendToPanel = (port: Port, msg: BgToPanel) => {
    try {
      port.postMessage(msg);
    } catch {
      panelPorts.delete(port);
    }
  };

  const sendToFrame = (tabId: number, frameId: number, msg: BgToCs) => {
    const port = csPorts.get(frameKey(tabId, frameId));
    if (!port) return false;
    try {
      port.postMessage(msg);
      return true;
    } catch {
      csPorts.delete(frameKey(tabId, frameId));
      return false;
    }
  };

  const broadcastToTabFrames = (tabId: number, msg: BgToCs) => {
    for (const [key, port] of csPorts) {
      const keyTabId = Number(key.split(':')[0]);
      if (keyTabId !== tabId) continue;
      try {
        port.postMessage(msg);
      } catch {
        csPorts.delete(key);
      }
    }
  };

  const relayToPanels = (tabId: number, frameId: number, event: CsToBg) => {
    for (const [port, attachedTab] of panelPorts) {
      if (attachedTab === tabId) {
        sendToPanel(port, { t: 'bg/frameEvent', tabId, frameId, event });
      }
    }
  };

  /** Replay known frame states so a late-opening panel sees current detection. */
  const replayFramesToPanel = (port: Port, tabId: number) => {
    for (const [key, meta] of frameMeta) {
      const [keyTab, keyFrame] = key.split(':');
      if (Number(keyTab) !== tabId) continue;
      sendToPanel(port, {
        t: 'bg/frameEvent',
        tabId,
        frameId: Number(keyFrame),
        event: { t: 'cs/ready', atsId: meta.atsId, url: meta.url },
      });
    }
  };

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === CS_PORT) {
      const tabId = port.sender?.tab?.id;
      const frameId = port.sender?.frameId ?? 0;
      if (tabId === undefined) return;
      const key = frameKey(tabId, frameId);
      csPorts.set(key, port);

      port.onMessage.addListener((raw) => {
        const msg = raw as CsToBg;
        if (msg.t === 'cs/ready') {
          frameMeta.set(key, { atsId: msg.atsId, url: msg.url });
        } else if (msg.t === 'cs/submitAttempt') {
          pendingAttempts.set(tabId, {
            url: msg.url,
            title: msg.title,
            answers: msg.answers,
            at: Date.now(),
          });
        } else if (msg.t === 'cs/submitDetected') {
          void recordApplication(tabId, { url: msg.url, title: msg.title });
        }
        relayToPanels(tabId, frameId, msg);
      });

      port.onDisconnect.addListener(() => {
        csPorts.delete(key);
        frameMeta.delete(key);
        for (const [panelPort, attachedTab] of panelPorts) {
          if (attachedTab === tabId) {
            sendToPanel(panelPort, { t: 'bg/frameGone', tabId, frameId });
          }
        }
      });
      return;
    }

    if (port.name === PANEL_PORT) {
      panelPorts.set(port, null);

      port.onMessage.addListener(async (raw) => {
        const msg = raw as PanelToBg;
        switch (msg.t) {
          case 'panel/attach': {
            let tabId = msg.tabId;
            if (tabId === null) {
              const [active] = await browser.tabs.query({ active: true, currentWindow: true });
              tabId = active?.id ?? null;
            }
            panelPorts.set(port, tabId);
            if (tabId !== null) {
              sendToPanel(port, { t: 'bg/tabChanged', tabId, url: frameMeta.get(frameKey(tabId, 0))?.url ?? '' });
              replayFramesToPanel(port, tabId);
            }
            break;
          }
          case 'panel/scan':
            broadcastToTabFrames(msg.tabId, { t: 'bg/scan' });
            break;
          case 'panel/extractJd':
            broadcastToTabFrames(msg.tabId, { t: 'bg/extractJd' });
            break;
          case 'panel/execute':
            sendToFrame(msg.tabId, msg.frameId, {
              t: 'bg/execute',
              instructions: msg.instructions,
              files: msg.files,
            });
            break;
          case 'panel/highlight':
            sendToFrame(msg.tabId, msg.frameId, { t: 'bg/highlight', fieldId: msg.fieldId });
            break;
          case 'panel/registerSite': {
            const registrationId = `jobpilot-site-${new URL(msg.origin).host}`;
            try {
              const existing = await browser.scripting.getRegisteredContentScripts({
                ids: [registrationId],
              });
              if (existing.length === 0) {
                await browser.scripting.registerContentScripts([
                  {
                    id: registrationId,
                    js: ['content-scripts/ats.js'],
                    matches: [`${msg.origin}/*`],
                    allFrames: true,
                    runAt: 'document_idle',
                    persistAcrossSessions: true,
                  },
                ]);
              }
              await browser.tabs.reload(msg.tabId);
            } catch (err) {
              console.error('[jobpilot] registerSite failed', err);
            }
            break;
          }
        }
      });

      port.onDisconnect.addListener(() => {
        panelPorts.delete(port);
      });
      return;
    }
  });

  // Keep attached panels pointed at the tab the user is actually looking at.
  browser.tabs.onActivated.addListener(({ tabId }) => {
    for (const [port] of panelPorts) {
      panelPorts.set(port, tabId);
      sendToPanel(port, { t: 'bg/tabChanged', tabId, url: frameMeta.get(frameKey(tabId, 0))?.url ?? '' });
      replayFramesToPanel(port, tabId);
    }
  });
});
