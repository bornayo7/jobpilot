import type { BgToPanel, FillInstruction, FillProvenance, FillResult, PanelToBg, SerializedFile } from './protocol';

interface Run {
  tabId: number; frameId: number; documentId: string;
  finish: (error: Error | null, results?: FillResult[]) => void;
}

/** Owns acknowledged executions; callers cannot mistake sending a message for
 * completion. Timeouts, navigation and disconnects all settle the same promise. */
export class FillRuns {
  private pending = new Map<string, Run>();
  constructor(private readonly send: (message: PanelToBg) => void) {}

  execute(input: { tabId: number; frameId: number; documentId: string; instructions: FillInstruction[]; files?: SerializedFile[]; provenance?: FillProvenance }, signal?: AbortSignal): Promise<FillResult[]> {
    if (signal?.aborted) return Promise.reject(new Error('Fill cancelled'));
    if ([...this.pending.values()].some((run) => run.tabId === input.tabId && run.frameId === input.frameId)) return Promise.reject(new Error('A fill is already running in this frame'));
    const runId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let finished = false;
      const cancel = () => finish(new Error('Fill cancelled'));
      const timer = setTimeout(() => finish(new Error('The application did not acknowledge completion. Rescan before retrying.')), 5000 + input.instructions.length * 4200);
      const finish = (error: Error | null, results: FillResult[] = []) => {
        if (finished) return;
        finished = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.pending.delete(runId);
        if (error) {
          try { this.send({ t: 'panel/cancel', runId, tabId: input.tabId, frameId: input.frameId, documentId: input.documentId }); } catch { /* disconnected */ }
          reject(error);
        } else resolve(results);
      };
      this.pending.set(runId, { ...input, finish });
      signal?.addEventListener('abort', cancel, { once: true });
      try { this.send({ t: 'panel/execute', ...input, runId }); } catch (error) { finish(new Error(String(error))); }
    });
  }

  /** Returns true only for a current completion, so stale results never paint. */
  accept(message: BgToPanel): boolean {
    if (message.t === 'bg/runFailed') {
      this.pending.get(message.runId)?.finish(new Error(message.error)); return false;
    }
    if (message.t === 'bg/frameEvent' && message.event.t === 'cs/fillResults') {
      const run = this.pending.get(message.event.runId);
      if (!run || run.tabId !== message.tabId || run.frameId !== message.frameId || run.documentId !== message.event.documentId) return false;
      run.finish(null, message.event.results); return true;
    }
    for (const run of this.pending.values()) {
      if (message.t === 'bg/tabChanged' && (message.reset || message.tabId !== run.tabId)) run.finish(new Error('The active application changed'));
      if (message.t === 'bg/frameGone' && message.tabId === run.tabId && message.frameId === run.frameId) run.finish(new Error('The application frame disconnected'));
      if (message.t === 'bg/frameEvent' && message.event.t === 'cs/ready' && message.tabId === run.tabId && message.frameId === run.frameId && message.event.documentId !== run.documentId) run.finish(new Error('The application document changed'));
    }
    return false;
  }

  cancelAll(reason = 'Connection closed'): void {
    for (const run of this.pending.values()) run.finish(new Error(reason));
  }
}
