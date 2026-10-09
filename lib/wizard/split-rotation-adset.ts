import type { AdSetSuggestion, CreativeAssignmentMatrix } from "../types.ts";

/**
 * Clone an ad set this launch creates and move one creative into the clone.
 * The clone keeps the source settings and gets an operator name, so launch
 * does not rename it. Live Meta ids are dropped: the clone is a new ad set.
 */
export function splitRotationOntoOwnAdSet(input: {
  adSets: AdSetSuggestion[];
  assignments: CreativeAssignmentMatrix;
  adSetId: string;
  creativeId: string;
  creativeName: string;
  newId: string;
}): { adSets: AdSetSuggestion[]; assignments: CreativeAssignmentMatrix } {
  const source = input.adSets.find((adSet) => adSet.id === input.adSetId);
  if (!source) return { adSets: input.adSets, assignments: input.assignments };
  const name = `${source.name} — ${input.creativeName.trim() || "Ad"}`;
  const clone: AdSetSuggestion = {
    ...source,
    id: input.newId,
    name,
    nameSource: "operator",
  };
  delete clone.metaAdSetId;
  delete clone.importedFromAdSetId;
  delete clone.importedDestinationType;
  const index = input.adSets.findIndex((adSet) => adSet.id === input.adSetId);
  const adSets = [...input.adSets];
  adSets.splice(index + 1, 0, clone);
  const assignments: CreativeAssignmentMatrix = { ...input.assignments };
  assignments[input.adSetId] = (assignments[input.adSetId] ?? []).filter((id) => id !== input.creativeId);
  assignments[input.newId] = [input.creativeId];
  return { adSets, assignments };
}
