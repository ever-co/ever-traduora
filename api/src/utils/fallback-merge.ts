import { IntermediateTranslation } from '../domain/formatters';

/**
 * Combines the translations of a locale with those of its fallback locale, matching them by term.
 * Every term of the fallback is kept, in the fallback's order; where the locale has a translation for the term, that one wins.
 * The two lists are not aligned (the locale's list leaves out the terms it has not translated), so they must not be
 * combined by position.
 */
export function mergeWithFallback(fallback: IntermediateTranslation[], primary: IntermediateTranslation[]): IntermediateTranslation[] {
  const primaryByTerm = new Map<string, IntermediateTranslation>();
  for (const entry of primary) {
    primaryByTerm.set(entry.term, entry);
  }

  const seen = new Set<string>();
  const merged: IntermediateTranslation[] = [];
  for (const entry of fallback) {
    seen.add(entry.term);
    const own = primaryByTerm.get(entry.term);
    merged.push({ term: entry.term, translation: own ? own.translation : entry.translation });
  }
  for (const entry of primary) {
    if (!seen.has(entry.term)) {
      merged.push({ term: entry.term, translation: entry.translation });
    }
  }
  return merged;
}
