import type { FillInstruction, FormFieldDescriptor } from '../messaging/protocol';
import type { FieldKind } from '../schema/fieldKind';
import type { Profile } from '../schema/profile';
import type { Settings } from '../storage/settingsStore';
import type { AtsId } from './adapters/ids';
import { adapterFor } from './adapters';
import type { PrefetchedField } from './adapters/types';
import { heuristicMatch } from './heuristics';
import { cacheGet, cacheSet } from '../storage/mappingCache';
import { routeTask } from '../providers/router';
import { buildFieldMappingRequest, parseFieldMappingResponse } from '../prompts/fieldMapping';
import { valueFor, type ResumeMeta } from './valueFor';
import type { FillSource } from '../messaging/protocol';
import { SENSITIVE_KINDS } from '../schema/fieldKind';

export interface ReviewRow {
  field: FormFieldDescriptor;
  kind: FieldKind;
  source: FillSource | 'none';
  confidence: number;
  instruction: FillInstruction | null;
  /** Default include state for the review table. */
  include: boolean;
  requiresReview: boolean;
  sensitive: boolean;
}

export interface ResolveOutcome {
  rows: ReviewRow[];
  /** Fields no tier could classify — surfaced in UI and the unmatched log. */
  unmatched: FormFieldDescriptor[];
  llmCalls: number;
}

/**
 * The three-tier resolver (runs in the side panel):
 *   1. per-ATS adapter (deterministic selector maps, confidence 1.0)
 *   2. heuristics (label/autocomplete rules, >= 0.8)
 *   3. mapping cache (previous LLM answers + user corrections)
 *   4. one batched LLM call for the remainder (allowlist-enforced), cached
 * Then values are materialized from the profile with review flags.
 */
export async function resolveFields(input: {
  atsId: AtsId | null;
  frameId: number;
  frameUrl: string;
  fields: FormFieldDescriptor[];
  profile: Profile;
  settings: Settings;
  resume: ResumeMeta | null;
  /** Disable tier 4 (no key configured / user preference). */
  llmEnabled: boolean;
}): Promise<ResolveOutcome> {
  const { atsId, frameId, fields, profile, settings, resume, llmEnabled } = input;
  const adapter = adapterFor(atsId);

  // Optional API prefetch: authoritative labels/options joined by name.
  let prefetched: Map<string, PrefetchedField> | null = null;
  if (adapter?.prefetchSchema) {
    const schema = await adapter.prefetchSchema(input.frameUrl).catch(() => null);
    if (schema && schema.length > 0) {
      prefetched = new Map(schema.map((f) => [f.name, f]));
    }
  }

  const enriched = fields.map((field) => enrich(field, prefetched));

  interface Pending {
    field: FormFieldDescriptor;
    kind: FieldKind | null;
    source: FillSource | 'none';
    confidence: number;
  }

  const pending: Pending[] = enriched.map((field) => {
    const adapterKind = adapter?.classify(field) ?? null;
    if (adapterKind) return { field, kind: adapterKind, source: 'adapter', confidence: 1 };
    const heuristic = heuristicMatch(field);
    if (heuristic) return { field, kind: heuristic.kind, source: 'heuristic', confidence: heuristic.confidence };
    return { field, kind: null, source: 'none', confidence: 0 };
  });

  // Tier 3: cache.
  const unresolved = pending.filter((p) => p.kind === null);
  if (unresolved.length > 0) {
    const cached = await cacheGet(unresolved.map((p) => p.field.signature));
    for (const entry of unresolved) {
      const hit = cached.get(entry.field.signature);
      if (hit) {
        entry.kind = hit.kind;
        entry.source = 'cache';
        entry.confidence = hit.confidence;
      }
    }
  }

  // Tier 4: one batched LLM call for whatever is left.
  let llmCalls = 0;
  const stillUnresolved = pending.filter((p) => p.kind === null);
  if (llmEnabled && stillUnresolved.length > 0) {
    try {
      const { provider, model } = routeTask(settings, 'mapping');
      const request = buildFieldMappingRequest(stillUnresolved.map((p) => p.field));
      llmCalls = 1;
      const response = await provider.chat({
        model,
        maxTokens: 1500,
        temperature: 0,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        jsonSchema: request.jsonSchema,
      });
      const mappings = parseFieldMappingResponse(response.text, stillUnresolved.length);
      const cacheEntries: Parameters<typeof cacheSet>[0] = [];
      for (const mapping of mappings) {
        const target = stillUnresolved[mapping.index];
        if (!target) continue;
        target.kind = mapping.kind;
        target.source = 'llm';
        target.confidence = mapping.confidence;
        cacheEntries.push({
          signature: target.field.signature,
          entry: { kind: mapping.kind, confidence: mapping.confidence, source: 'llm', model },
        });
      }
      await cacheSet(cacheEntries);
    } catch (err) {
      console.warn('[jobpilot] LLM mapping tier failed; continuing without it', err);
    }
  }

  const rows: ReviewRow[] = [];
  const unmatched: FormFieldDescriptor[] = [];

  for (const entry of pending) {
    if (entry.kind === null || entry.kind === 'unknown') {
      unmatched.push(entry.field);
      continue;
    }
    const sensitive = SENSITIVE_KINDS.has(entry.kind);
    const resolved = valueFor(entry.kind, entry.field, profile, resume);
    const alreadyFilled =
      !!entry.field.currentValue && entry.field.control !== 'file' && entry.field.control !== 'checkbox';

    const requiresReview =
      sensitive ||
      entry.kind === 'question.freeText' ||
      entry.kind === 'question.choice' ||
      entry.confidence < 0.85 ||
      (resolved?.requiresReview ?? false);

    const instruction: FillInstruction | null = resolved
      ? {
          fieldId: entry.field.fieldId,
          frameId,
          action: resolved.action,
          value: resolved.value,
          kind: entry.kind,
          source: entry.source === 'none' ? 'user' : entry.source,
          confidence: entry.confidence,
          requiresReview,
        }
      : null;

    rows.push({
      field: entry.field,
      kind: entry.kind,
      source: entry.source,
      confidence: entry.confidence,
      instruction,
      include: instruction !== null && !requiresReview && !alreadyFilled,
      requiresReview,
      sensitive,
    });
  }

  return { rows, unmatched, llmCalls };
}

/** Overlay authoritative API data (label/options/required) onto a scraped descriptor. */
function enrich(
  field: FormFieldDescriptor,
  prefetched: Map<string, PrefetchedField> | null,
): FormFieldDescriptor {
  if (!prefetched || !field.name) return field;
  const api = prefetched.get(field.name);
  if (!api) return field;
  return {
    ...field,
    label: api.label || field.label,
    required: api.required || field.required,
    options:
      api.options && api.options.length > 0 && (!field.options || field.options.length === 0)
        ? api.options
        : field.options,
  };
}
