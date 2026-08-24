import type { FormFieldDescriptor } from '../messaging/protocol';
import type { FieldKind } from '../schema/fieldKind';
import { normalizeForSignature } from './signature';

export interface HeuristicMatch {
  kind: FieldKind;
  confidence: number;
}

interface Rule {
  kind: FieldKind;
  /** Regexes tested against the normalized label. Anchor tightly — "name of
   *  referrer" must NOT match name rules. */
  label?: RegExp[];
  /** Exact autocomplete attribute values (strongest browser-standard signal). */
  autocomplete?: string[];
  /** Restrict to these control types (e.g. resume must be a file input). */
  controls?: FormFieldDescriptor['control'][];
  /** Base confidence for a label hit (autocomplete hits get +0.05, cap 0.98). */
  confidence?: number;
}

const RULES: Rule[] = [
  { kind: 'name.first', autocomplete: ['given-name'], label: [/^(first|given)( |-)?name$/, /^first$/, /^legal first name$/, /^preferred first name$/] },
  { kind: 'name.last', autocomplete: ['family-name'], label: [/^(last|family)( |-)?name$/, /^surname$/, /^legal last name$/] },
  { kind: 'name.full', autocomplete: ['name'], label: [/^(full |legal |your )?name$/] },
  { kind: 'contact.email', autocomplete: ['email'], label: [/^e ?mail( address)?$/, /^(your |primary |work |personal )?e ?mail( address)?$/] },
  { kind: 'contact.phone', autocomplete: ['tel'], label: [/^(mobile|cell|phone|telephone)( number)?$/, /^(primary |mobile |cell |contact )?phone( number)?$/] },
  { kind: 'location.city', autocomplete: ['address-level2'], label: [/^(city|town)$/] },
  { kind: 'location.state', autocomplete: ['address-level1'], label: [/^(state|province|region)( \/ (province|region))?$/] },
  { kind: 'location.country', autocomplete: ['country', 'country-name'], label: [/^country( of residence)?$/] },
  { kind: 'location.postal', autocomplete: ['postal-code'], label: [/^(zip|postal)( ?code)?$/] },
  { kind: 'location.combined', label: [/^((current|your) )?location( \(city\))?$/, /^city (and|,) state$/, /^where (are you|do you) (located|live|based)/] },
  { kind: 'links.linkedin', label: [/linked ?in/] },
  { kind: 'links.github', label: [/git ?hub/] },
  { kind: 'links.portfolio', label: [/^portfolio( url| link)?$/, /^(personal )?website$/, /portfolio/] },
  { kind: 'docs.resume', controls: ['file'], label: [/resume|\bcv\b|curriculum vitae/], confidence: 0.95 },
  { kind: 'docs.coverLetter', controls: ['file', 'textarea'], label: [/cover ?letter/] },
  { kind: 'auth.workAuthorized', label: [/(authorized|eligible|legally able|legal right|lawfully authorized).{0,40}work/, /work authorization/] },
  { kind: 'auth.needsSponsorship', label: [/sponsorship|require.{0,30}(visa|sponsor)|sponsor.{0,30}(visa|employment|work)/] },
  { kind: 'eeo.gender', label: [/^gender( identity)?$/, /^sex$/] },
  { kind: 'eeo.race', label: [/race|ethnicit/] },
  { kind: 'eeo.veteran', label: [/veteran/] },
  { kind: 'eeo.disability', label: [/disabilit/] },
  { kind: 'eeo.pronouns', label: [/^pronouns?$/] },
  { kind: 'comp.expectedSalary', label: [/(salary|compensation|pay) (expectation|requirement)s?/, /^(expected|desired) (salary|compensation|pay)( range)?$/] },
  { kind: 'misc.availableStart', label: [/start date|available to start|availability date|earliest.{0,20}start/] },
  { kind: 'misc.referralSource', label: [/how did you (hear|find|learn)|referral source|who referred/] },
  { kind: 'work.company', label: [/^(current |most recent )?(company|employer|organi[sz]ation)$/] },
  { kind: 'work.title', label: [/^(current |most recent )?(job )?title$/, /^current (role|position)$/] },
];

/**
 * Tier-2 field matcher: normalized-label regexes + autocomplete attributes.
 * Deterministic and free. Returns null below the acceptance threshold — the
 * resolver then consults the mapping cache / LLM tier instead.
 */
export function heuristicMatch(field: FormFieldDescriptor): HeuristicMatch | null {
  const label = normalizeForSignature(
    [field.label, field.ariaLabel, field.placeholder].find((s) => s && s.trim()) ?? '',
  );
  const autocomplete = (field.autocomplete ?? '').toLowerCase().trim();

  let best: HeuristicMatch | null = null;
  for (const rule of RULES) {
    if (rule.controls && !rule.controls.includes(field.control)) continue;

    let confidence = 0;
    if (rule.autocomplete && autocomplete && rule.autocomplete.includes(autocomplete)) {
      confidence = 0.95;
    }
    if (rule.label && label) {
      for (const pattern of rule.label) {
        if (pattern.test(label)) {
          confidence = Math.max(confidence, rule.confidence ?? 0.9);
          break;
        }
      }
    }
    if (confidence > 0 && (!best || confidence > best.confidence)) {
      best = { kind: rule.kind, confidence: Math.min(confidence, 0.98) };
    }
  }

  // Free-text fallback: an unmatched textarea is a screening question, not a
  // profile field — flag it as such (always review-gated downstream).
  if (!best && field.control === 'textarea' && label) {
    return { kind: 'question.freeText', confidence: 0.6 };
  }

  return best && best.confidence >= 0.8 ? best : null;
}
