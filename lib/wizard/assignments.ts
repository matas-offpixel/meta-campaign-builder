/**
 * lib/wizard/assignments.ts
 *
 * The Assign step's matrix (ad set id → creative ids) as pure helpers,
 * shared by components/steps/assign-creatives.tsx and the MCP draft tools.
 * Relative imports only (node:test).
 */
import type { AdCreativeDraft, AdSetSuggestion, CreativeAssignmentMatrix } from "../types.ts";

/** "Assign all": every enabled ad set gets every ad. */
export function assignAllCreatives(adSets: readonly AdSetSuggestion[], creatives: readonly Pick<AdCreativeDraft, "id">[]): CreativeAssignmentMatrix {
  const next: CreativeAssignmentMatrix = {};
  for (const s of adSets) if (s.enabled) next[s.id] = creatives.map((c) => c.id);
  return next;
}

/** The matrix without these ads (a removed ad leaves no assignment behind). */
export function withoutCreatives(matrix: CreativeAssignmentMatrix, creativeIds: ReadonlySet<string>): CreativeAssignmentMatrix {
  const next: CreativeAssignmentMatrix = {};
  for (const [adSetId, ids] of Object.entries(matrix ?? {})) next[adSetId] = ids.filter((id) => !creativeIds.has(id));
  return next;
}

/** The matrix without ad sets that are gone. */
export function forAdSets(matrix: CreativeAssignmentMatrix, adSets: readonly Pick<AdSetSuggestion, "id">[]): CreativeAssignmentMatrix {
  const keep = new Set(adSets.map((s) => s.id));
  return Object.fromEntries(Object.entries(matrix ?? {}).filter(([id]) => keep.has(id)));
}

/** How many ads each enabled ad set carries. */
export function assignmentCounts(matrix: CreativeAssignmentMatrix, adSets: readonly AdSetSuggestion[]): { adSets: number; withAds: number } {
  const enabled = adSets.filter((s) => s.enabled);
  return { adSets: enabled.length, withAds: enabled.filter((s) => (matrix?.[s.id] ?? []).length > 0).length };
}
