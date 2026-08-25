import type { Settings } from '../storage/settingsStore';

export interface DealbreakerWarning {
  id: string;
  message: string;
  excerpt: string;
}

const SPONSORSHIP_PATTERNS = [
  /\b(unable|not able|cannot|can ?not|can't|will not|won'?t|do(es)? not)\s+(to\s+)?(provide|offer|sponsor|support)\w*\s*(visa|work)?\s*sponsor\w*/i,
  /\bno (visa )?sponsorship\b/i,
  /\bwithout (the need for |requiring )?(visa )?sponsorship\b/i,
  /\bsponsorship is not (available|offered|provided)\b/i,
  /\bmust (be|currently be) (legally )?authorized to work .{0,60}without .{0,20}sponsor/i,
];

const CLEARANCE_PATTERNS = [
  /\b(active )?(security clearance|ts\/sci|top secret|secret clearance)\b/i,
  /\bu\.?s\.? citizen(ship)?\s*(is\s*)?(required|only)\b/i,
  /\bmust be a u\.?s\.? citizen\b/i,
  /\bcitizens? only\b/i,
  /\bitar\b/,
];

/**
 * Scan a job description for the user's configured dealbreakers BEFORE they
 * spend 15 minutes applying. Entirely local — regex + light parsing, no model.
 */
export function checkDealbreakers(jdText: string, settings: Settings): DealbreakerWarning[] {
  const config = settings.dealbreakers;
  if (!config.enabled || !jdText) return [];

  const warnings: DealbreakerWarning[] = [];
  const add = (id: string, message: string, match: RegExpMatchArray | null) => {
    if (!match) return;
    if (warnings.some((w) => w.id === id)) return;
    warnings.push({ id, message, excerpt: excerptAround(jdText, match.index ?? 0, match[0].length) });
  };

  if (config.noSponsorship) {
    for (const pattern of SPONSORSHIP_PATTERNS) {
      add('sponsorship', 'Posting says visa sponsorship is not available', jdText.match(pattern));
    }
  }
  if (config.clearance) {
    for (const pattern of CLEARANCE_PATTERNS) {
      add('clearance', 'Requires citizenship or a security clearance', jdText.match(pattern));
    }
  }
  if (config.minSalary !== null && config.minSalary > 0) {
    const top = maxPostedSalary(jdText);
    if (top !== null && top < config.minSalary) {
      warnings.push({
        id: 'salary',
        message: `Posted salary tops out at $${top.toLocaleString()} — below your $${config.minSalary.toLocaleString()} floor`,
        excerpt: '',
      });
    }
  }
  for (const term of config.terms) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    const index = jdText.toLowerCase().indexOf(trimmed.toLowerCase());
    if (index !== -1) {
      warnings.push({
        id: `term:${trimmed.toLowerCase()}`,
        message: `Mentions "${trimmed}"`,
        excerpt: excerptAround(jdText, index, trimmed.length),
      });
    }
  }
  return warnings;
}

/** Highest dollar figure in the text, reading $85,000 / $85k / $85K styles. */
export function maxPostedSalary(text: string): number | null {
  let max: number | null = null;
  for (const match of text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d{2,3})(k)?\b/gi)) {
    const digits = Number(match[1]!.replace(/,/g, ''));
    const value = match[2] ? digits * 1000 : digits;
    // Ignore small figures ($50 signing gift cards etc.) — salaries are >= 20k.
    if (value >= 20_000 && (max === null || value > max)) max = value;
  }
  return max;
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, index + length + 45);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}
