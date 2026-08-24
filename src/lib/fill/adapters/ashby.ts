import type { FormFieldDescriptor } from '../../messaging/protocol';
import type { FieldKind } from '../../schema/fieldKind';
import type { AtsAdapter } from './types';

/**
 * Ashby's React SPA identifies system fields by _systemfield_* keys (visible
 * as input name/id). Everything else is per-company custom fields → heuristics.
 */
const SYSTEM_MAP: Record<string, FieldKind> = {
  _systemfield_name: 'name.full',
  _systemfield_email: 'contact.email',
  _systemfield_phone: 'contact.phone',
  _systemfield_resume: 'docs.resume',
  _systemfield_location: 'location.combined',
};

export const ashbyAdapter: AtsAdapter = {
  id: 'ashby',
  classify(field: FormFieldDescriptor): FieldKind | null {
    for (const key of [field.name, field.id, field.atsFieldKey]) {
      if (key && SYSTEM_MAP[key]) return SYSTEM_MAP[key] ?? null;
    }
    return null;
  },
};
