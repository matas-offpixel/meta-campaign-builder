/** Dedupe videos by id when merging multiple campaign fetches (stable order by id). */
export function mergeVideoSourcesDeduped<T extends { id: string }>(
  buckets: T[][],
): T[] {
  const byId = new Map<string, T>();
  for (const list of buckets) {
    for (const v of list) {
      if (!byId.has(v.id)) byId.set(v.id, v);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}
