import type { CampaignDraft } from "@/lib/types";

/** Collect page IDs used for IG engagement or ad identity in this draft. */
export function collectDraftPageIds(draft: CampaignDraft): Set<string> {
  const ids = new Set<string>();
  for (const g of draft.audiences.pageGroups) {
    for (const pid of g.pageIds) ids.add(pid);
  }
  for (const c of draft.creatives) {
    if (c.identity?.pageId) ids.add(c.identity.pageId);
  }
  return ids;
}

/** Pages with 2+ linked IGs that are in use but have no operator override. */
export function findMultiIgPagesMissingOverride(draft: CampaignDraft): string[] {
  const multi = draft.settings.multiIgPageIds ?? [];
  if (multi.length === 0) return [];
  const used = collectDraftPageIds(draft);
  const overrides = draft.settings.pageInstagramOverrides ?? {};
  return multi.filter((pageId) => used.has(pageId) && !overrides[pageId]);
}
