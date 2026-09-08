import { getDb } from './db';
import type { FormFieldDescriptor } from '../messaging/protocol';

/**
 * Remember fields no resolver tier could classify, one row per unique field
 * shape. Local only: the log exists so adapter and heuristic gaps can be found
 * later by reading what real forms actually asked for. Best-effort — a failed
 * write must never break a fill.
 */
export async function recordUnmatched(
  atsId: string | null,
  url: string,
  fields: FormFieldDescriptor[],
): Promise<void> {
  if (fields.length === 0) return;
  try {
    const db = await getDb();
    const tx = db.transaction('unmatchedLog', 'readwrite');
    for (const field of fields) {
      await tx.store.put({
        id: field.signature,
        atsId,
        url,
        label: field.label || field.name || '(unlabeled)',
        control: field.control,
        signature: field.signature,
        seenAt: Date.now(),
      });
    }
    await tx.done;
  } catch (err) {
    console.warn('[jobpilot] unmatched log write failed', err);
  }
}
