// Hand-rolled, zero-dependency string similarity — confirmed with the user
// rather than adding a new npm package, consistent with this codebase's
// demonstrated preference against dependencies for small algorithms (Module
// Six added zero packages). Used only by DUPLICATE_FUZZY_MATCH; scoring
// callers (company-match.ts/contact-match.ts) treat a fuzzy-only signal as
// LOW confidence at most — never enough by itself to suggest a merge.

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 0; i < a.length; i++) {
    const currentRow = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const insertCost = currentRow[j] + 1;
      const deleteCost = previousRow[j + 1] + 1;
      const substituteCost = previousRow[j] + (a[i] === b[j] ? 0 : 1);
      currentRow.push(Math.min(insertCost, deleteCost, substituteCost));
    }
    previousRow = currentRow;
  }

  return previousRow[b.length];
}

/**
 * Similarity ratio between two strings, 0–100 (100 = identical). Callers
 * should pass already-normalized strings (see normalize.ts) for meaningful
 * results — this function does no normalization of its own.
 */
export function similarityScore(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 100;

  const distance = levenshteinDistance(a, b);
  return Math.round((1 - distance / maxLength) * 100);
}
