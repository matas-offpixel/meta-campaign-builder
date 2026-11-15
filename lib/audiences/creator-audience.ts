import { parseBracketedEventCode } from "../insights/meta-event-code-match.ts";
import { buildAudienceName } from "./naming.ts";
import type { CustomAudienceGroup } from "../types.ts";

/** Same sentence the website matrix shows when the write flag is off. */
export const META_AUDIENCE_WRITES_DISABLED_MESSAGE =
  "Will save as drafts (Meta writes are disabled).";

export function creatorAudienceWritesOpen(writesEnabled: boolean): boolean {
  return writesEnabled === true;
}

export function defaultPixelAudienceName(input: {
  campaignName: string;
  retentionDays: number;
  pixelEvent: string;
}): string {
  const campaignName = input.campaignName.trim();
  // `[CODE]` anywhere, not just at the start. Electric's campaigns were
  // renamed to their invoice format on 13 Oct 2026 —
  // `261023 Folamour | [NX26-FOLAMOUR] On sale` — so an anchored match
  // returns null and the audience silently drops from event scope to
  // client scope, named after the whole campaign. Same rule the rollup
  // matcher already uses.
  const eventCode = parseBracketedEventCode(campaignName);
  return buildAudienceName({
    scope: eventCode ? "event" : "client",
    client: { slug: null, name: campaignName || "Audience" },
    event: eventCode ? { eventCode, name: campaignName } : null,
    subtype: "website_pixel",
    retentionDays: input.retentionDays,
    pixelEvent: input.pixelEvent,
  });
}

export function attachCreatedAudienceToGroup(
  groups: CustomAudienceGroup[],
  selectedGroupId: string | null,
  created: { id: string; name: string },
): { groups: CustomAudienceGroup[]; groupId: string } {
  const selected = selectedGroupId
    ? groups.find((group) => group.id === selectedGroupId) ?? null
    : null;
  const target = selected ?? (groups.length === 1 ? groups[0]! : null);

  if (!target) {
    const group: CustomAudienceGroup = {
      id: crypto.randomUUID(),
      name: "New audience",
      audienceIds: [created.id],
      audienceNames: { [created.id]: created.name },
      populatingAudienceIds: [created.id],
    };
    return { groups: [...groups, group], groupId: group.id };
  }

  const audienceIds = target.audienceIds.includes(created.id)
    ? target.audienceIds
    : [...target.audienceIds, created.id];
  const populating = new Set(target.populatingAudienceIds ?? []);
  populating.add(created.id);
  return {
    groupId: target.id,
    groups: groups.map((group) =>
      group.id === target.id
        ? {
            ...group,
            audienceIds,
            audienceNames: { ...group.audienceNames, [created.id]: created.name },
            populatingAudienceIds: [...populating],
          }
        : group,
    ),
  };
}
