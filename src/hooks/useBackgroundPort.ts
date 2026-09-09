import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from '#imports';
import type { Browser } from 'wxt/browser';
import {
  PANEL_PORT,
  type BgToPanel,
  type FillInstruction,
  type FillProvenance,
  type FillResult,
  type FormFieldDescriptor,
  type PanelToBg,
  type SerializedFile,
} from '@lib/messaging/protocol';
import type { AtsId } from '@lib/fill/adapters/detect';
import { FillRuns } from '@lib/messaging/fillRuns';
import { SiteRegistrations } from '@lib/messaging/siteRegistrations';
import type { SiteTarget } from '@lib/content/registerSite';

export interface FrameState {
  documentId: string;
  atsId: AtsId | null;
  url: string;
  fields: FormFieldDescriptor[];
}

export interface PanelState {
  trackerNotice?: string;
  tabId: number | null;
  tabUrl: string;
  /** frameId -> frame state, for the attached tab. */
  frames: Map<number, FrameState>;
  /** fieldId -> latest fill result. */
  fillResults: Map<string, FillResult>;
  jd: { title: string; text: string; frameId?: number } | null;
  /** Set by the right-click "fix this field" flow — FillTab scrolls to it. */
  focusField: { frameId: number; fieldId: string; at: number } | null;
}

const emptyState = (): PanelState => ({
  tabId: null,
  tabUrl: '',
  frames: new Map(),
  fillResults: new Map(),
  jd: null,
  focusField: null,
});

/**
 * The panel's live connection to the background hub. Reconnects when the
 * service worker restarts; re-attaches to the active tab on every connect.
 */
export function useBackgroundPort() {
  const [state, setState] = useState<PanelState>(emptyState);
  const portRef = useRef<Browser.runtime.Port | null>(null);
  const runs = useRef<FillRuns | null>(null);
  const registrations = useRef<SiteRegistrations | null>(null);
  registrations.current ??= new SiteRegistrations((message) => {
    if (!portRef.current) throw new Error('The extension is reconnecting. Try again shortly.');
    portRef.current.postMessage(message);
  });
  runs.current ??= new FillRuns((message) => {
    if (!portRef.current) throw new Error('The extension is reconnecting. Try again shortly.');
    portRef.current.postMessage(message);
  });

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;
      const port = browser.runtime.connect({ name: PANEL_PORT });
      portRef.current = port;

      port.onMessage.addListener((raw) => {
        if (disposed || portRef.current !== port) return;
        const msg = raw as BgToPanel;
        registrations.current!.accept(msg);
        const currentResult = runs.current!.accept(msg);
        if (msg.t === 'bg/frameEvent' && msg.event.t === 'cs/fillResults' && !currentResult) return;
        setState((prev) => reduce(prev, msg));
      });

      port.onDisconnect.addListener(() => {
        if (disposed || portRef.current !== port) return;
        portRef.current = null;
        runs.current!.cancelAll();
        registrations.current!.cancelAll();
        reconnectTimer = setTimeout(connect, 400);
      });

      // Attach with this panel's window so the hub only follows tab switches
      // inside it. windows.getCurrent() is async; if the port died meanwhile
      // the reconnect path attaches again, so a failed post is fine to drop.
      const attach = (windowId?: number) => {
        if (disposed || portRef.current !== port) return;
        try {
          port.postMessage({
            t: 'panel/attach',
            tabId: null,
            ...(windowId !== undefined ? { windowId } : {}),
          } satisfies PanelToBg);
        } catch {
          // port already gone
        }
      };
      browser.windows.getCurrent().then(
        (win) => attach(win.id),
        () => attach(),
      );
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      runs.current!.cancelAll('The panel closed');
      registrations.current!.cancelAll();
      const port = portRef.current; portRef.current = null; port?.disconnect();
    };
  }, []);

  const actions = useMemo(
    () => ({
      send(msg: PanelToBg) {
        portRef.current?.postMessage(msg);
      },
      scan(tabId: number) {
        portRef.current?.postMessage({ t: 'panel/scan', tabId } satisfies PanelToBg);
      },
      registerSite(target: SiteTarget) { return registrations.current!.register(target); },
      execute(tabId: number, frameId: number, documentId: string, instructions: FillInstruction[], files?: SerializedFile[], provenance?: FillProvenance, signal?: AbortSignal) {
        return runs.current!.execute({ tabId, frameId, documentId, instructions, files, provenance }, signal);
      },
      highlight(tabId: number, frameId: number, fieldId: string) {
        portRef.current?.postMessage({ t: 'panel/highlight', tabId, frameId, fieldId } satisfies PanelToBg);
      },
      extractJd(tabId: number) {
        setState((prev) => prev.tabId === tabId ? { ...prev, jd: null } : prev);
        portRef.current?.postMessage({ t: 'panel/extractJd', tabId } satisfies PanelToBg);
      },
    }),
    [],
  );

  return { state, actions };
}

/** What the tabs may ask the background to do. */
export type PanelActions = ReturnType<typeof useBackgroundPort>['actions'];

export function reduce(prev: PanelState, msg: BgToPanel): PanelState {
  switch (msg.t) {
    case 'bg/siteRegistered': return prev;
    case 'bg/runFailed': return prev;
    case 'bg/trackerStatus': return msg.tabId === prev.tabId ? { ...prev, trackerNotice: msg.message } : prev;
    case 'bg/tabChanged': {
      if (!msg.reset && msg.tabId === prev.tabId && (!msg.url || msg.url === prev.tabUrl)) {
        return { ...prev, tabUrl: msg.url || prev.tabUrl };
      }
      return { ...emptyState(), tabId: msg.tabId, tabUrl: msg.url };
    }
    case 'bg/frameGone': {
      if (msg.tabId !== prev.tabId) return prev;
      const frames = new Map(prev.frames);
      frames.delete(msg.frameId);
      return { ...prev, frames, ...(msg.frameId === 0 || prev.jd?.frameId === msg.frameId
        ? { jd: null, fillResults: new Map(), focusField: null } : {}) };
    }
    case 'bg/frameEvent': {
      if (msg.tabId !== prev.tabId) return prev;
      const frames = new Map(prev.frames);
      const frame: FrameState = frames.get(msg.frameId) ?? { documentId: '', atsId: null, url: '', fields: [] };
      const event = msg.event;
      if (event.t !== 'cs/ready' && event.documentId !== frame.documentId) return prev;
      switch (event.t) {
        case 'cs/ready': {
          // The top frame reporting a different URL is a navigation, full or
          // client-side. The extracted JD and the fill results described the
          // old page; carrying them over left the Generate tab building
          // prompts for the previous posting.
          const navigated = msg.frameId === 0 && !!event.url && !!prev.tabUrl && event.url !== prev.tabUrl;
          const frameNavigated = !!frame.documentId && frame.documentId !== event.documentId || !!frame.url && frame.url !== event.url;
          if (navigated) frames.clear();
          frames.set(msg.frameId, { ...frame, documentId: event.documentId, atsId: event.atsId, url: event.url, fields: navigated || frameNavigated ? [] : frame.fields });
          return {
            ...prev,
            frames,
            tabUrl: msg.frameId === 0 && event.url ? event.url : prev.tabUrl,
            ...(navigated || frameNavigated ? { jd: null, fillResults: new Map<string, FillResult>(), focusField: null } : {}),
          };
        }
        case 'cs/fields':
          frames.set(msg.frameId, { ...frame, fields: event.fields });
          return { ...prev, frames };
        case 'cs/fillResults': {
          const fillResults = new Map(prev.fillResults);
          for (const result of event.results) fillResults.set(result.fieldId, result);
          return { ...prev, fillResults };
        }
        case 'cs/jdText': {
          // Keep the longest JD text across frames (top frame usually wins).
          if (prev.jd && prev.jd.text.length >= event.text.length) return prev;
          return { ...prev, jd: { title: event.title, text: event.text, frameId: msg.frameId } };
        }
        case 'cs/contextField':
          return { ...prev, focusField: { frameId: msg.frameId, fieldId: event.fieldId, at: Date.now() } };
        case 'cs/submitAttempt':
        case 'cs/submitDetected':
          return prev; // Background consumes these (tracker + answers bank).
      }
      return prev;
    }
  }
}
