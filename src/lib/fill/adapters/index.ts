import type { AtsAdapter } from './types';
import type { AtsId } from './ids';
import { greenhouseAdapter } from './greenhouse';
import { leverAdapter } from './lever';
import { ashbyAdapter } from './ashby';

const ADAPTERS: Partial<Record<AtsId, AtsAdapter>> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  // workday, icims, smartrecruiters land in M4; linkedin/indeed stay
  // heuristics-only by design (ToS-sensitive, unstable DOMs).
};

export function adapterFor(atsId: AtsId | null): AtsAdapter | null {
  return atsId ? (ADAPTERS[atsId] ?? null) : null;
}

export { detectAts, ATS_LABELS } from './detect';
export type { AtsAdapter, PrefetchedField } from './types';
