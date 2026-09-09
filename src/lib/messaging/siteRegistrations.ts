import type { SiteTarget } from '../content/registerSite';
import type { BgToPanel, PanelToBg } from './protocol';

/** Owns the panel-to-worker registration acknowledgement and disconnect state. */
export class SiteRegistrations {
  private pending = new Map<string, (error?: string) => void>();
  constructor(private send: (message: PanelToBg) => void) {}

  register(target: SiteTarget): Promise<void> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error?: string) => {
        clearTimeout(timer); this.pending.delete(requestId);
        if (error) reject(new Error(error)); else resolve();
      };
      const timer = setTimeout(() => finish('The extension did not acknowledge site registration. Try again.'), 15_000);
      this.pending.set(requestId, finish);
      try { this.send({ t: 'panel/registerSite', requestId, ...target }); }
      catch (error) { finish(String(error instanceof Error ? error.message : error)); }
    });
  }

  accept(message: BgToPanel): void {
    if (message.t === 'bg/siteRegistered') this.pending.get(message.requestId)?.(message.error);
  }

  cancelAll(): void {
    for (const finish of this.pending.values()) finish('The extension disconnected before registration was acknowledged. Try again.');
  }
}
