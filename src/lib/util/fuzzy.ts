import { normalizeForSignature } from '../fill/signature';

/**
 * Sørensen–Dice similarity on character bigrams of normalized text.
 * Cheap, dependency-free, and good enough to match "Why do you want to work
 * here?" against "What interests you about this role?"-adjacent phrasings
 * when combined with token overlap below.
 */
export function diceSimilarity(a: string, b: string): number {
  const bigramsA = bigrams(normalizeForSignature(a));
  const bigramsB = bigrams(normalizeForSignature(b));
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let overlap = 0;
  for (const [gram, countA] of bigramsA) {
    const countB = bigramsB.get(gram);
    if (countB) overlap += Math.min(countA, countB);
  }
  const sizeA = [...bigramsA.values()].reduce((n, c) => n + c, 0);
  const sizeB = [...bigramsB.values()].reduce((n, c) => n + c, 0);
  return (2 * overlap) / (sizeA + sizeB);
}

/** Jaccard overlap of content tokens — robust to reordering. */
export function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(normalizeForSignature(a).split(' ').filter((t) => t.length > 2));
  const tokensB = new Set(normalizeForSignature(b).split(' ').filter((t) => t.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared++;
  return shared / (tokensA.size + tokensB.size - shared);
}

/** Blended question-similarity score in [0, 1]. */
export function questionSimilarity(a: string, b: string): number {
  return 0.6 * diceSimilarity(a, b) + 0.4 * tokenOverlap(a, b);
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const gram = text.slice(i, i + 2);
    if (gram.includes(' ')) continue;
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}
