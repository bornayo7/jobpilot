import { browser } from '#imports';
import type { FieldKind } from '../schema/fieldKind';

export interface MappingEntry {
  kind: FieldKind;
  confidence: number;
  source: 'llm' | 'user-correction';
  model?: string;
  createdAt: number;
  lastHit: number;
  hits: number;
}

const KEY = 'jobpilot:mappingCache';
const MAX_ENTRIES = 2000;

type CacheShape = Record<string, MappingEntry>;

async function readAll(): Promise<CacheShape> {
  const stored = await browser.storage.local.get(KEY);
  return (stored[KEY] as CacheShape | undefined) ?? {};
}

async function writeAll(cache: CacheShape): Promise<void> {
  await browser.storage.local.set({ [KEY]: cache });
}

/** Batch lookup; bumps hit counters for found entries. */
export async function cacheGet(signatures: string[]): Promise<Map<string, MappingEntry>> {
  const cache = await readAll();
  const found = new Map<string, MappingEntry>();
  let touched = false;
  const now = Date.now();
  for (const sig of signatures) {
    const entry = cache[sig];
    if (entry) {
      entry.lastHit = now;
      entry.hits += 1;
      touched = true;
      found.set(sig, entry);
    }
  }
  if (touched) await writeAll(cache);
  return found;
}

/**
 * Store mappings. A user-correction permanently shadows an LLM entry; an LLM
 * result never overwrites a user correction.
 */
export async function cacheSet(
  entries: { signature: string; entry: Omit<MappingEntry, 'createdAt' | 'lastHit' | 'hits'> }[],
): Promise<void> {
  if (entries.length === 0) return;
  const cache = await readAll();
  const now = Date.now();

  for (const { signature, entry } of entries) {
    const existing = cache[signature];
    if (existing?.source === 'user-correction' && entry.source === 'llm') continue;
    cache[signature] = {
      ...entry,
      createdAt: existing?.createdAt ?? now,
      lastHit: now,
      hits: existing?.hits ?? 0,
    };
  }

  // LRU prune by lastHit.
  const keys = Object.keys(cache);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => cache[a]!.lastHit - cache[b]!.lastHit)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((key) => delete cache[key]);
  }

  await writeAll(cache);
}
