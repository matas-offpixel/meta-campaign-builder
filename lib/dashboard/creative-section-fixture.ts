/**
 * IRW0006 (Charlotte de Witte, IRONWORKS), read 15 Nov 2026.
 * Every scored ad that spent on a [IRW0006] campaign, split by objective.
 * Signup rows do not carry that day's purchases. No TikTok snapshot exists
 * for this show. No figure here is from the design drawing.
 */

import { buildCreativeSection, type CreativeDay, type CreativeSectionInput, type CreativeSectionModel, type CreativeTagRef } from "./creative-section.ts";

const EVENT = "f8603e89-0b0e-4b43-9984-0f3f3a0e906d";
const ACCOUNT = "act_1967530076312";

function day(
  name: string,
  objective: "signup" | "purchase" | null,
  spend: number,
  impressions: number,
  clicks: number,
  signups: number,
  purchases: number,
  adId: string,
): CreativeDay {
  return { eventId: EVENT, name, objective, spend, impressions, clicks, signups, purchases, adId, adAccountId: ACCOUNT };
}

const DAYS: CreativeDay[] = [
  day("UGC 2 - CDW – Copy", "signup", 1827.94, 409368, 22845, 2912, 0, "52517143224107"),
  day("UGC 3 - CDW – Copy", "signup", 1631.92, 274225, 14181, 1786, 0, "52517143224307"),
  day("UGC 4 - CDW – Copy", "signup", 509.83, 128012, 5178, 619, 0, "52517143226507"),
  day("Static - CDW – Copy", "signup", 536.68, 172685, 6972, 550, 0, "52517719138307"),
  day("UGC 1 - CDW – Copy", "signup", 317.98, 77441, 3682, 358, 0, "52517143220307"),
  day("Feed - Reminder – Copy", "signup", 356.76, 71228, 2929, 276, 0, "52518750734107"),
  day("Reminder Static – Copy", "signup", 352.25, 101794, 2851, 242, 0, "52518791033307"),
  day("UGC 2 - CDW", "signup", 113.18, 29299, 1005, 129, 0, "52517142931307"),
  day("UGC 3 - CDW", "signup", 61.75, 12374, 417, 55, 0, "52517143078907"),
  day("Static - CDW", "signup", 29.26, 8226, 270, 23, 0, "52517718844307"),
  day("Feed - Reminder", "signup", 15.46, 2928, 143, 17, 0, "52518749438307"),
  day("Reminder Static", "signup", 11.63, 2930, 76, 11, 0, "52518790819707"),
  day("UGC 4 - CDW", "signup", 2.24, 590, 27, 4, 0, "52517143118107"),
  day("UGC 1 - CDW", "signup", 4.94, 1430, 53, 4, 0, "52517142353307"),
  day("Final Tickets", "purchase", 80.06, 9195, 751, 0, 33, "52519221321307"),
  day("Final Tickets – Copy", "purchase", 74.69, 12521, 523, 0, 14, "52519223650507"),
  day("Presale live", null, 37.67, 20355, 362, 0, 0, "52519050700507"),
  day("Presale Reminder – Copy", null, 17.15, 18549, 93, 0, 0, "52518793140507"),
  day("Presale live – Copy", null, 0.79, 631, 9, 0, 0, "52519514252907"),
  day("Presale Reminder", null, 21.7, 6340, 167, 0, 0, "52518792358507"),
  day("Final Tickets – Copy 2", "purchase", 0.83, 187, 5, 0, 0, "52519514022907"),
];

function tag(name: string, dimension: CreativeTagRef["dimension"], label: string): CreativeTagRef {
  return { eventId: EVENT, name, dimension, label };
}

const TAGS: CreativeTagRef[] = [
  tag("UGC 2 - CDW – Copy", "asset_type", "High Production"),
  tag("UGC 2 - CDW – Copy", "visual_format", "Celebrity"),
  tag("UGC 2 - CDW – Copy", "hook_tactic", "FOMO"),
  tag("UGC 2 - CDW – Copy", "hook_tactic", "Curiosity"),
  tag("UGC 2 - CDW – Copy", "messaging_angle", "Artist Headliner"),
  tag("UGC 2 - CDW – Copy", "messaging_angle", "Event Announcement / Update"),
  tag("Static - CDW – Copy", "asset_type", "Lifestyle Image with Text"),
  tag("Static - CDW – Copy", "visual_format", "Celebrity"),
  tag("Static - CDW – Copy", "hook_tactic", "Bold Claim"),
  tag("Static - CDW – Copy", "messaging_angle", "Artist Headliner"),
  tag("Presale Reminder – Copy", "asset_type", "Lifestyle Image with Text"),
  tag("Presale Reminder – Copy", "visual_format", "Celebrity"),
  tag("Presale Reminder – Copy", "hook_tactic", "Urgency"),
  tag("Presale Reminder – Copy", "messaging_angle", "Artist Headliner"),
  tag("Presale Reminder – Copy", "messaging_angle", "Urgency / Scarcity / FOMO"),
  tag("Final Tickets", "asset_type", "Lifestyle Image with Text"),
  tag("Final Tickets", "visual_format", "Celebrity"),
  tag("Final Tickets", "hook_tactic", "FOMO"),
  tag("Final Tickets", "hook_tactic", "Urgency"),
  tag("Final Tickets", "messaging_angle", "Artist Headliner"),
  tag("Final Tickets", "messaging_angle", "Event Announcement / Update"),
];

export function cdwInput(surface: "internal" | "share"): CreativeSectionInput {
  return {
    surface,
    client: "IRONWORKS",
    show: "Charlotte de Witte",
    through: "6 Aug",
    scored: DAYS.map((row) => ({ eventId: row.eventId, name: row.name })),
    days: DAYS,
    tags: TAGS,
    renders: [],
    tiktok: [],
    refreshOn: false,
    pauses: [],
  };
}

export function cdwCreative(surface: "internal" | "share"): CreativeSectionModel {
  return buildCreativeSection(cdwInput(surface));
}

/** The same show, with a Lab render and a refresh pause, so a share render can prove those links are gone. */
export function cdwWithLinks(surface: "internal" | "share"): CreativeSectionModel {
  const input = cdwInput(surface);
  return buildCreativeSection({
    ...input,
    renders: [{ eventId: EVENT, name: "UGC 2 - CDW – Copy", driveFileId: "drive-1", renderId: "render-1" }],
    refreshOn: true,
    pauses: [{ eventId: EVENT, lineId: "line-1", name: "UGC 2 - CDW – Copy" }],
  });
}
