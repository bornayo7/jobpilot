import type { FormFieldDescriptor } from '../messaging/protocol';
import { LLM_ALLOWED_KINDS, type FieldKind } from '../schema/fieldKind';

/**
 * Batch field-mapping prompt for the cheap-model tier. The model may only
 * assign kinds from LLM_ALLOWED_KINDS — core contact/EEO kinds are handled by
 * adapters/heuristics, and the resolver re-enforces the allowlist on results.
 */
export function buildFieldMappingRequest(fields: FormFieldDescriptor[]) {
  const allowed = [...LLM_ALLOWED_KINDS];

  const payload = fields.map((field, i) => ({
    i,
    label: field.label || field.ariaLabel || field.placeholder || field.name || '',
    control: field.control,
    ...(field.options ? { options: field.options.slice(0, 8).map((o) => o.label) } : {}),
  }));

  const system = [
    'You classify job-application form fields into semantic kinds.',
    `Allowed kinds, use ONLY these: ${allowed.join(', ')}.`,
    'Guidance:',
    '- question.freeText: open-ended screening/essay questions answered in prose.',
    '- question.choice: screening questions answered by picking an option.',
    '- comp.expectedSalary: salary/compensation expectation fields.',
    '- misc.availableStart: start date / availability fields.',
    '- misc.referralSource: "how did you hear about us" fields.',
    '- unknown: anything else, including fields you are unsure about.',
    'Never guess a more specific kind than the evidence supports — prefer unknown.',
  ].join('\n');

  const user = `Classify each field:\n${JSON.stringify(payload, null, 2)}`;

  const jsonSchema = {
    type: 'object',
    properties: {
      mappings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            i: { type: 'integer' },
            kind: { type: 'string', enum: allowed },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['i', 'kind', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['mappings'],
    additionalProperties: false,
  } as const;

  return { system, user, jsonSchema };
}

export interface FieldMappingResult {
  index: number;
  kind: FieldKind;
  confidence: number;
}

/** Parse + allowlist-enforce the model's response. Malformed entries are dropped. */
export function parseFieldMappingResponse(text: string, fieldCount: number): FieldMappingResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const mappings = (parsed as { mappings?: unknown }).mappings;
  if (!Array.isArray(mappings)) return [];

  const results: FieldMappingResult[] = [];
  for (const entry of mappings) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { i, kind, confidence } = entry as Record<string, unknown>;
    if (typeof i !== 'number' || i < 0 || i >= fieldCount) continue;
    if (typeof kind !== 'string' || !LLM_ALLOWED_KINDS.has(kind as FieldKind)) continue;
    results.push({
      index: i,
      kind: kind as FieldKind,
      confidence: typeof confidence === 'number' ? Math.min(Math.max(confidence, 0), 1) : 0.5,
    });
  }
  return results;
}
