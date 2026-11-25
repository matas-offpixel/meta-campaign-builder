/**
 * "Add to this draft" (25 Nov ruling on #1363): the template's made audiences
 * into the draft's audiences. No Meta call: only what already exists in the
 * draft's ad account goes in, by its Meta id.
 *
 *  - Every Reused list, pool and page audience joins one custom audience
 *    group named after the template (the Audiences tab's own "custom" group
 *    shape), deduped against what the group already holds.
 *  - The template's interests join one interest group of the same name.
 *  - Anything not made yet (Will be created, held in another account, a
 *    show's list the sync hasn't made) is left out and counted.
 *
 * Adding twice changes nothing the second time. The draft's other groups are
 * never touched.
 *
 * Pure. No `@/` imports, so node --test loads it.
 */

import type { AudienceSettings, CustomAudienceGroup, InterestGroup } from "../types.ts";
import type { ResolvedTemplate } from "./resolve.ts";

/** The groups this template writes, by a stable id so a second Add merges. */
export function templateGroupId(templateName: string): string {
  return `template:${templateName}`;
}

export interface AddResult {
  audiences: AudienceSettings;
  /** Items added: the template's Reused items ({n}). */
  added: number;
  /** Items not made yet, left out ({m}). */
  leftOut: number;
}

export function addTemplateToDraft(audiences: AudienceSettings, templateName: string, resolved: ResolvedTemplate): AddResult {
  const reused = resolved.items.filter((r) => r.status === "reused");
  const groupId = templateGroupId(templateName);

  const ids: string[] = [];
  const names: Record<string, string> = {};
  for (const r of reused) {
    if (r.item.kind === "interest") continue;
    for (const id of r.reusedIds) {
      if (!ids.includes(id)) ids.push(id);
      const name = typeof r.item.detail.name === "string" ? r.item.detail.name : null;
      if (name) names[id] = name;
    }
  }
  const interests = reused.flatMap((r) =>
    r.item.kind === "interest" && r.item.interestId ? [{ id: r.item.interestId, name: r.item.interestName ?? r.item.interestId }] : [],
  );

  const customGroups = [...(audiences.customAudienceGroups ?? [])];
  if (ids.length > 0) {
    const at = customGroups.findIndex((g) => g.id === groupId);
    if (at >= 0) {
      const g = customGroups[at]!;
      customGroups[at] = {
        ...g,
        audienceIds: [...g.audienceIds, ...ids.filter((id) => !g.audienceIds.includes(id))],
        audienceNames: { ...(g.audienceNames ?? {}), ...names },
      };
    } else {
      const g: CustomAudienceGroup = { id: groupId, name: templateName, audienceIds: ids, audienceNames: names };
      customGroups.push(g);
    }
  }

  const interestGroups = [...(audiences.interestGroups ?? [])];
  if (interests.length > 0) {
    const at = interestGroups.findIndex((g) => g.id === groupId);
    if (at >= 0) {
      const g = interestGroups[at]!;
      const have = new Set(g.interests.map((i) => i.id));
      interestGroups[at] = { ...g, interests: [...g.interests, ...interests.filter((i) => !have.has(i.id))] };
    } else {
      const g: InterestGroup = { id: groupId, name: templateName, interests };
      interestGroups.push(g);
    }
  }

  return {
    audiences: { ...audiences, customAudienceGroups: customGroups, interestGroups },
    added: reused.length,
    leftOut: resolved.items.length - reused.length,
  };
}
