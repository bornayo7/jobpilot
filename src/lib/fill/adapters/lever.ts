import type { FormFieldDescriptor } from '../../messaging/protocol';
import type { FieldKind } from '../../schema/fieldKind';
import type { AtsAdapter } from './types';

/**
 * Lever's classic apply form uses near-native inputs with stable name
 * attributes. Custom questions post as cards[{uuid}][...] with per-posting
 * uuids — those fall through to label-driven tiers by design.
 */
const NAME_MAP: Record<string, FieldKind> = {
  name: 'name.full',
  email: 'contact.email',
  phone: 'contact.phone',
  org: 'work.company',
  location: 'location.combined',
  resume: 'docs.resume',
  comments: 'question.freeText', // "Additional information"
  'urls[LinkedIn]': 'links.linkedin',
  'urls[GitHub]': 'links.github',
  'urls[Github]': 'links.github',
  'urls[Portfolio]': 'links.portfolio',
  'urls[Other]': 'links.other',
};

export const leverAdapter: AtsAdapter = {
  id: 'lever',
  classify(field: FormFieldDescriptor): FieldKind | null {
    if (!field.name) return null;
    return NAME_MAP[field.name] ?? null;
  },
};
