import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from '#imports';
import type { Browser } from 'wxt/browser';
import {
  PANEL_PORT,
  type BgToPanel,
  type FillInstruction,
  type FillResult,
  type FormFieldDescriptor,
  type PanelToBg,
  type SerializedFile,
} from '@lib/messaging/protocol';
import type { AtsId } from '@lib/fill/adapters/ids';

export interface FrameState {
  atsId: AtsId | null;
  url: string;
  fields: FormFieldDescriptor[];
}

export interface PanelState {
  tabId: number | null;
  tabUrl: string;
  /** frameId -> frame state, for the attached tab. */
  frames: Map<number, FrameState>;
  /** fieldId -> latest fill result. */
  fillResults: Map<string, FillResult>;
  jd: { title: string; text: string } | null;
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

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const port = browser.runtime.connect({ name: PANEL_PORT });
      portRef.current = port;

      port.onMessage.addListener((raw) => {
        const msg = raw as BgToPanel;
        setState((prev) => reduce(prev, msg));
      });

      port.onDisconnect.addListener(() => {
        portRef.current = null;
        if (!disposed) setTimeout(connect, 400);
      });

      port.postMessage({ t: 'panel/attach', tabId: null } satisfies PanelToBg);
    };

    connect();
    return () => {
      disposed = true;
      portRef.current?.disconnect();
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
      execute(tabId: number, frameId: number, instructions: FillInstruction[], files?: SerializedFile[]) {
        portRef.current?.postMessage({
          t: 'panel/execute',
          tabId,
          frameId,
          instructions,
          files,
        } satisfies PanelToBg);
      },
      highlight(tabId: number, frameId: number, fieldId: string) {
        portRef.current?.postMessage({ t: 'panel/highlight', tabId, frameId, fieldId } satisfies PanelToBg);
      },
      extractJd(tabId: number) {
        portRef.current?.postMessage({ t: 'panel/extractJd', tabId } satisfies PanelToBg);
      },
    }),
    [],
  );

  return { state, actions };
}

function reduce(prev: PanelState, msg: BgToPanel): PanelState {
  switch (msg.t) {
    case 'bg/tabChanged': {
      if (msg.tabId === prev.tabId) return { ...prev, tabUrl: msg.url || prev.tabUrl };
      return { ...emptyState(), tabId: msg.tabId, tabUrl: msg.url };
    }
    case 'bg/frameGone': {
      if (msg.tabId !== prev.tabId) return prev;
      const frames = new Map(prev.frames);
      frames.delete(msg.frameId);
      return { ...prev, frames };
    }
    case 'bg/frameEvent': {
      if (msg.tabId !== prev.tabId) return prev;
      const frames = new Map(prev.frames);
      const frame: FrameState = frames.get(msg.frameId) ?? { atsId: null, url: '', fields: [] };
      const event = msg.event;
      switch (event.t) {
        case 'cs/ready':
          frames.set(msg.frameId, { ...frame, atsId: event.atsId, url: event.url });
          return {
            ...prev,
            frames,
            tabUrl: msg.frameId === 0 && event.url ? event.url : prev.tabUrl,
          };
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
          return { ...prev, jd: { title: event.title, text: event.text } };
        }
        case 'cs/contextField':
          return { ...prev, focusField: { frameId: msg.frameId, fieldId: event.fieldId, at: Date.now() } };
        case 'cs/wizardStep':
        case 'cs/submitAttempt':
        case 'cs/submitDetected':
          return prev; // Background consumes these (tracker + answers bank).
      }
      return prev;
    }
  }
}
