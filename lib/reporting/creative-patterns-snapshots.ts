export interface PatternSnapshotRow {
  event_id: string;
  fetched_at: string;
  build_version: string | null;
}

export function selectLatestSnapshotsByEvent<T extends PatternSnapshotRow>(
  rows: T[],
): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const current = latest.get(row.event_id);
    if (!current || row.fetched_at > current.fetched_at) {
      latest.set(row.event_id, row);
    }
  }
  return [...latest.values()];
}
