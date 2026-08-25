import { ResumeVersionSchema, type ResumeVersion } from '../schema/resumeVersion';
import type { Profile } from '../schema/profile';
import { normalizeForSignature } from '../fill/signature';

export type ImportOutcome =
  | { ok: true; version: ResumeVersion; diff: BulletDiff }
  | { ok: false; errors: string[] };

export interface BulletDiff {
  /** Bullet text -> true when it appears verbatim (normalized) in the master profile. */
  known: Map<string, boolean>;
  keptCount: number;
  rewrittenCount: number;
}

/**
 * Parse whatever the user pasted back from claude.ai / ChatGPT. Accepts a
 * fenced ```json block or a bare JSON object; validates hard against the
 * ResumeVersion schema — malformed pastes are rejected with readable errors,
 * never half-stored.
 */
export function importResumePaste(pasted: string, profile: Profile): ImportOutcome {
  const jsonText = extractJsonBlock(pasted);
  if (!jsonText) {
    return { ok: false, errors: ['No JSON found in the pasted text. Paste the full ```json block from the chat.'] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, errors: [`JSON does not parse: ${String(err).slice(0, 200)}`] };
  }

  const result = ResumeVersionSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    };
  }

  return { ok: true, version: result.data, diff: diffBullets(result.data, profile) };
}

/**
 * Which bullets did the model keep verbatim vs rewrite? Rewritten bullets are
 * where fabrication risk lives — the review UI highlights them for reading
 * before approval.
 */
export function diffBullets(version: ResumeVersion, profile: Profile): BulletDiff {
  const masterBullets = new Set<string>();
  for (const entry of [...profile.work, ...profile.projects]) {
    for (const bullet of entry.bullets) masterBullets.add(normalizeForSignature(bullet.text));
  }

  const known = new Map<string, boolean>();
  let keptCount = 0;
  let rewrittenCount = 0;
  const versionBullets = [
    ...version.experience.flatMap((e) => e.bullets),
    ...version.projects.flatMap((p) => p.bullets),
  ];
  for (const bullet of versionBullets) {
    const kept = masterBullets.has(normalizeForSignature(bullet));
    known.set(bullet, kept);
    if (kept) keptCount++;
    else rewrittenCount++;
  }
  return { known, keptCount, rewrittenCount };
}

/** Fenced ```json block first; else the first balanced top-level {...}. */
export function extractJsonBlock(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced?.[1]?.trim().startsWith('{')) return fenced[1].trim();

  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
