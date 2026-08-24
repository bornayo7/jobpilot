import type { FormFieldDescriptor } from '../../messaging/protocol';
import type { FieldKind } from '../../schema/fieldKind';
import type { AtsId } from './ids';

/** Authoritative field info prefetched from an ATS API (Greenhouse Job Board API). */
export interface PrefetchedField {
  /** The form control's name attribute (join key to descriptors). */
  name: string;
  label: string;
  required: boolean;
  type: string;
  options?: { value: string; label: string }[];
}

export interface AtsAdapter {
  id: AtsId;
  /**
   * Tier-1 classification from platform-stable keys (name attributes,
   * data-automation-id, _systemfield_*). Return null to fall through to
   * heuristics/cache/LLM.
   */
  classify(field: FormFieldDescriptor): FieldKind | null;
  /**
   * Optional API prefetch keyed off the page URL. Returns authoritative field
   * schemas to join onto scraped descriptors — an accelerator, never a
   * dependency (resolver degrades to the DOM path when this fails).
   */
  prefetchSchema?(url: string): Promise<PrefetchedField[] | null>;
}
