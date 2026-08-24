import type { FormFieldDescriptor } from '../messaging/protocol';
import type { AtsId } from './adapters/ids';

/**
 * Stable identity for a form field ACROSS jobs and companies on the same ATS.
 * Deliberately excludes per-posting identifiers (question_12345, cards[uuid],
 * element ids) so "Why do you want to work here?" on two different Greenhouse
 * boards hits the same mapping-cache entry. Option labels are included because
 * "Yes/No" and "Yes/No/Decline to answer" are different questions in practice.
 *
 * FNV-1a (64-bit, hex) — synchronous, tiny, and collision-safe at cache scale
 * (~thousands of entries); crypto.subtle would force async through discovery.
 */
export function fieldSignature(
  atsId: AtsId | null,
  field: Pick<FormFieldDescriptor, 'label' | 'control' | 'autocomplete' | 'options'>,
): string {
  const optionPart = (field.options ?? [])
    .map((o) => normalizeForSignature(o.label))
    .sort()
    .join(',');
  const input = [
    atsId ?? 'generic',
    normalizeForSignature(field.label),
    field.control,
    normalizeForSignature(field.autocomplete ?? ''),
    optionPart,
  ].join('|');
  return fnv1a64(input);
}

export function normalizeForSignature(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fnv1a64(input: string): string {
  // 64-bit FNV-1a using BigInt; returns 16 hex chars.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}
