import { browser } from '#imports';

const REVISION_FLOOR_KEY = 'jobpilot:revision-floor';

/** Internal: call under the common storage lock before removing records.
 * The floor is intentionally outside backups: restoring an older backup must
 * never make an editor base from a deleted record valid again. */
export function retainRevisionFloor(...revisions: number[]): Promise<number> {
  return reserve(revisions, false);
}

/** Reserve one revision newer than every current, incoming, or removed base.
 * A failed later mutation may leave a gap; it cannot reuse an old revision. */
export function nextRestoreRevision(revisions: number[]): Promise<number> {
  return reserve(revisions, true);
}

async function reserve(revisions: number[], advance: boolean): Promise<number> {
  const stored = (await browser.storage.local.get(REVISION_FLOOR_KEY))[REVISION_FLOOR_KEY];
  let floor = typeof stored === 'number' && Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
  for (const value of revisions) if (Number.isSafeInteger(value) && value >= 0) floor = Math.max(floor, value);
  if (advance) {
    if (floor === Number.MAX_SAFE_INTEGER) throw new Error('Storage revision limit reached; export a backup before repair.');
    floor += 1;
  }
  if (floor !== stored) await browser.storage.local.set({ [REVISION_FLOOR_KEY]: floor });
  return floor;
}
