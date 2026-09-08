import type { FillInstruction, FillSource, FormFieldDescriptor } from '../messaging/protocol';
import { SENSITIVE_KINDS, type FieldKind } from '../schema/fieldKind';
import type { Profile } from '../schema/profile';
import type { Settings } from '../storage/settingsStore';
import type { AtsId } from './adapters/ids';
import { adapterFor } from './adapters';
import type { AtsAdapter, PrefetchedField } from './adapters/types';
import { heuristicMatch } from './heuristics';
import { cacheGet, cacheSet, type MappingEntry } from '../storage/mappingCache';
import { routeTask } from '../providers/router';
import { buildFieldMappingRequest, parseFieldMappingResponse } from '../prompts/fieldMapping';
import { valueFor, type ResumeMeta } from './valueFor';

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

/** Which kind a field is, and which tier said so. */
interface Classification {
  kind: FieldKind;
  source: FillSource;
  confidence: number;
}

/**
 * The resolver (runs in the side panel). Each field takes the first tier that
 * answers:
 *   0. a saved manual correction (overrides everything, adapters included)
 *   1. per-ATS adapter (deterministic selector maps, confidence 1.0)
 *   2. heuristics (label/autocomplete rules, >= 0.8)
 *   3. mapping cache (previous model answers for the same field shape)
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

  const cached = await cacheGet(enriched.map((field) => field.signature));
  const classified = new Map<string, Classification>();
  for (const field of enriched) {
    const classification = classify(field, adapter, cached.get(field.signature));
    if (classification) classified.set(field.fieldId, classification);
  }

  // Tier 4: one batched LLM call for whatever is left.
  let llmCalls = 0;
  const leftover = enriched.filter((field) => !classified.has(field.fieldId));
  if (llmEnabled && leftover.length > 0) {
    llmCalls = 1;
    try {
      for (const [field, classification] of await classifyWithModel(settings, leftover)) {
        classified.set(field.fieldId, classification);
      }
    } catch (err) {
      console.warn('[jobpilot] LLM mapping tier failed; continuing without it', err);
    }
  }

  const rows: ReviewRow[] = [];
  const unmatched: FormFieldDescriptor[] = [];
  for (const field of enriched) {
    const classification = classified.get(field.fieldId);
    if (!classification || classification.kind === 'unknown') {
      unmatched.push(field);
      continue;
    }
    rows.push(reviewRow({ field, ...classification, frameId, profile, resume }));
  }
  return { rows, unmatched, llmCalls };
}

/** Tiers 0–3, in precedence order. Null means the model tier gets a turn. */
function classify(
  field: FormFieldDescriptor,
  adapter: AtsAdapter | null,
  cached: MappingEntry | undefined,
): Classification | null {
  // Explicit corrections override every automatic tier, including adapters.
  if (cached?.source === 'user-correction') {
    return { kind: cached.kind, source: 'user', confidence: cached.confidence };
  }
  const adapterKind = adapter?.classify(field) ?? null;
  if (adapterKind) return { kind: adapterKind, source: 'adapter', confidence: 1 };
  const heuristic = heuristicMatch(field);
  if (heuristic) return { kind: heuristic.kind, source: 'heuristic', confidence: heuristic.confidence };
  if (cached) return { kind: cached.kind, source: 'cache', confidence: cached.confidence };
  return null;
}

/** One batched, allowlist-enforced model call; every answer is cached for next time. */
async function classifyWithModel(
  settings: Settings,
  fields: FormFieldDescriptor[],
): Promise<[FormFieldDescriptor, Classification][]> {
  const { provider, model } = routeTask(settings, 'mapping');
  const request = buildFieldMappingRequest(fields);
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

  const results: [FormFieldDescriptor, Classification][] = [];
  for (const { index, kind, confidence } of parseFieldMappingResponse(response.text, fields.length)) {
    const field = fields[index];
    if (field) results.push([field, { kind, source: 'llm', confidence }]);
  }
  await cacheSet(
    results.map(([field, { kind, confidence }]) => ({
      signature: field.signature,
      entry: { kind, confidence, source: 'llm', model },
    })),
  );
  return results;
}

/**
 * Materialize one classified field into a review row: the profile value, the
 * review flags, and whether the bulk fill includes it by default. Shared with
 * the manual kind correction in the fill plan so the two cannot disagree.
 */
export function reviewRow(input: {
  field: FormFieldDescriptor;
  kind: FieldKind;
  source: FillSource;
  confidence: number;
  frameId: number;
  profile: Profile;
  resume: ResumeMeta | null;
}): ReviewRow {
  const { field, kind, source, confidence, frameId, profile, resume } = input;
  const sensitive = SENSITIVE_KINDS.has(kind);
  const resolved = valueFor(kind, field, profile, resume);
  const requiresReview =
    sensitive ||
    kind === 'question.freeText' ||
    kind === 'question.choice' ||
    confidence < 0.85 ||
    (resolved?.requiresReview ?? false);
  const instruction: FillInstruction | null = resolved
    ? { ...resolved, fieldId: field.fieldId, frameId, kind, source, confidence, requiresReview }
    : null;
  // A control the page already filled is left alone unless the user opts in.
  const alreadyFilled = !!field.currentValue && field.control !== 'file' && field.control !== 'checkbox';

  return {
    field,
    kind,
    source,
    confidence,
    instruction,
    include: instruction !== null && !requiresReview && !alreadyFilled,
    requiresReview,
    sensitive,
  };
}

/** A field no tier could classify, shown so the user can map it or fill it by hand. */
export function unmatchedRow(field: FormFieldDescriptor): ReviewRow {
  return {
    field,
    kind: 'unknown',
    source: 'none',
    confidence: 0,
    instruction: null,
    include: false,
    requiresReview: true,
    sensitive: false,
  };
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
