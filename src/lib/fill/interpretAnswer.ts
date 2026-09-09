import type { FieldKind } from '../schema/fieldKind';
import { normalizeForSignature } from './signature';

/** Interpret only supported, single-fact questions. Classification alone does
 * not tell us whether Yes means the stored fact or its opposite. */
export function interpretBoolean(kind: FieldKind, label: string, fact: boolean): boolean | null {
  const question = normalizeForSignature(label);
  if (!question) return null;
  const singleQuestion = question.replace(/now or (?:in )?(?:the )?future|now or (?:at any time )?in (?:the )?future/g, '');
  if (/\b(if|unless|and|or)\b/.test(singleQuestion)) return null;
  // Both stored work facts describe US employment. A classified field does
  // not make that fact valid in another country or an unnamed jurisdiction.
  if (kind === 'auth.workAuthorized' || kind === 'auth.needsSponsorship') {
    if (/\b(canada|canadian|united kingdom|uk|europe|eu|australia|india|germany|singapore|ireland|france|japan)\b/.test(question)) return null;
    if (/\bin (?:the )?/.test(singleQuestion) && !/\bin (?:the )?(united states|u s|us|usa|u s a)\b/.test(singleQuestion)) return null;
  }
  if (kind === 'auth.workAuthorized') {
    if (/\b(citizen|citizenship|sponsorship|visa|not|without|unable)\b/.test(question)) return null;
    return /\b(authorized|eligible|legally able|legal right|work authorization)\b/.test(question) ? fact : null;
  }
  if (kind === 'auth.needsSponsorship') {
    if (/\b(authorized|citizen|citizenship)\b/.test(question)) return null;
    if (/\b(without|not require|not need|do not need|do not require)\b.{0,35}\b(sponsorship|sponsor|visa)\b/.test(question)) return !fact;
    if (/\b(no|cannot|can t|unable|not)\b/.test(question)) return null;
    return /\b(require|need)\b.{0,50}\b(sponsorship|sponsor|visa)\b|\bsponsorship (required|needed)\b|^sponsorship$/.test(question) ? fact : null;
  }
  return fact;
}
