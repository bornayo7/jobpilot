import type { Profile } from '../schema/profile';
import { normalizeForSignature } from '../fill/signature';

export interface MatchGap {
  /** Your profile skills that the posting actually mentions. */
  coveredSkills: string[];
  /** Your profile skills the posting never mentions (fine — just not relevant here). */
  unusedSkills: string[];
  /** Recurring posting terms absent from your profile — candidate gaps to
   *  address in the tailored resume, or honest misses. Heuristic, not a score. */
  missingTerms: string[];
}

const STOPWORDS = new Set(
  `a about above after all also an and any are as at be been being between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just like me more most my no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with you your years experience team teams work working strong ability skills skill required requirements preferred plus benefits salary role position job candidate candidates company must new using knowledge including help build responsibilities qualifications equal opportunity employer status applicants apply application day days week remote hybrid onsite full time part location locations`.split(
    /\s+/,
  ),
);

/**
 * Local keyword coverage: which of your skills the posting mentions, and which
 * recurring posting terms your profile lacks. Deliberately a gap LIST, not a
 * gamified percentage — coverage numbers invite score-chasing and Simplify's
 * own score is distrusted for exactly that.
 */
export function computeMatchGap(jdText: string, profile: Profile): MatchGap {
  const jdNorm = ` ${normalizeForSignature(jdText)} `;

  const coveredSkills: string[] = [];
  const unusedSkills: string[] = [];
  for (const skill of profile.skills) {
    const needle = normalizeForSignature(skill.name);
    if (!needle) continue;
    // Whole-token match only. A bare `includes(needle)` would call "C", "R",
    // or "Go" covered because they appear inside unrelated words.
    (jdNorm.includes(` ${needle} `) ? coveredSkills : unusedSkills).push(skill.name);
  }

  // Profile text corpus for absence checks.
  const profileText = normalizeForSignature(
    [
      ...profile.skills.map((s) => s.name),
      ...profile.work.flatMap((w) => [w.title, w.company, ...w.bullets.map((b) => b.text)]),
      ...profile.projects.flatMap((p) => [p.name, p.description, ...p.bullets.map((b) => b.text)]),
      ...profile.education.map((e) => `${e.degree} ${e.field}`),
    ].join(' '),
  );

  // Term extraction: unigrams + bigrams that recur in the posting.
  const tokens = normalizeForSignature(jdText)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
  const counts = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    const unigram = tokens[i]!;
    counts.set(unigram, (counts.get(unigram) ?? 0) + 1);
    if (i + 1 < tokens.length) {
      const bigram = `${unigram} ${tokens[i + 1]}`;
      counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
    }
  }

  const missingTerms = [...counts.entries()]
    .filter(([term, count]) => count >= 2 && !profileText.includes(term))
    // Prefer bigrams and frequent terms; drop unigrams that are inside a kept bigram.
    .sort((a, b) => b[0].split(' ').length - a[0].split(' ').length || b[1] - a[1])
    .reduce<string[]>((kept, [term]) => {
      if (kept.some((k) => k.includes(term) || term.includes(k))) return kept;
      kept.push(term);
      return kept;
    }, [])
    .slice(0, 12);

  return { coveredSkills, unusedSkills, missingTerms };
}
