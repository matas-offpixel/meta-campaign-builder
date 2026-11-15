/**
 * IRW0001 (Jamie Jones, IRONWORKS) read 15 Nov 2026. The top 10 signup
 * creatives and the top 10 purchase creatives, from ad_daily_insights
 * campaigns named [IRW0001], plus the latest TikTok snapshot window
 * (4 Aug–10 Oct 2026) ranked by spend. Tags are the AI tags on the
 * creatives that were read. No figure here is from the design drawing.
 */

import { buildCreativeSection, type CreativeDay, type CreativeSectionInput, type CreativeSectionModel, type CreativeTagRef, type TikTokRef } from "./creative-section.ts";

const EVENT = "2d5a5485-bfec-4812-9fcc-2f6f89262f6c";
const ACCOUNT = "act_1967530076312";

function day(name: string, objective: "signup" | "purchase", spend: number, impressions: number, clicks: number, signups: number, purchases: number, adId: string): CreativeDay {
  return { eventId: EVENT, name, objective, spend, impressions, clicks, signups, purchases, adId, adAccountId: ACCOUNT };
}

const DAYS: CreativeDay[] = [
  day("JJ - Motion 9 — Streaming", "signup", 297.2, 51856, 1385, 234, 0, "52522388931307"),
  day("JJ - Lineup Artwork", "signup", 437.22, 96313, 2329, 201, 0, "52523497351707"),
  day("JJ - Motion 9 — Jamie Jones Adv+", "signup", 342.11, 54987, 1799, 199, 0, "52522957265307"),
  day("JJ - Motion 9 — Jamie Jones", "signup", 294.76, 56884, 1966, 167, 0, "52523504130707"),
  day("JJ - Motion 9 — Electronic Music", "signup", 172.52, 22270, 760, 109, 0, "52523561301107"),
  day("JJ - Motion 9 — Streaming Manual 18-65", "signup", 155.13, 18882, 664, 84, 0, "52523785052507"),
  day("JJ - Motion 9 — Activities & Culture", "signup", 75.22, 12341, 322, 53, 0, "52522388935507"),
  day("JJ - Motion 9 — IRW / LWE / J2", "signup", 46.39, 8741, 257, 43, 0, "52522388935707"),
  day("JJ - Lineup - Feed – Copy", "signup", 92.18, 23575, 589, 43, 0, "52523485651707"),
  day("Reminder Static – Copy", "signup", 101.49, 19700, 420, 42, 0, "52524535184707"),
  day("JJ Feed Post - Gen Sale", "purchase", 984.24, 139779, 5126, 0, 30, "52524984796507"),
  day("TICKET UPDATE - V2 – Copy", "purchase", 671.06, 95802, 1652, 0, 20, "52524758041907"),
  day("JJ - Clip 4 — attached:52510624860107", "purchase", 83.54, 10318, 296, 0, 7, "52527176578107"),
  day("Seth Feed Post – V2", "purchase", 83.72, 12607, 848, 0, 7, "52531582737307"),
  day("TICKET UPDATE - V2", "purchase", 207.27, 27080, 481, 0, 7, "52524756209307"),
  day("Ironworks - Last Chance JJ Tickets V2", "purchase", 70.07, 8950, 278, 0, 7, "52532454659707"),
  day("Seth Feed Post – Copy", "purchase", 200.04, 29885, 2141, 0, 6, "52528134374907"),
  day("TICKET UPDATE", "purchase", 596.25, 80930, 1138, 0, 4, "52510625025107"),
  day("JJ Feed Post - Walk Through – Copy", "purchase", 131.37, 15428, 759, 0, 4, "52528134375107"),
  day("Ironworks - Last Chance JJ Tickets V1", "purchase", 33.56, 4682, 125, 0, 3, "52532454668507"),
];

function tag(name: string, dimension: CreativeTagRef["dimension"], label: string): CreativeTagRef {
  return { eventId: EVENT, name, dimension, label };
}

const TAGS: CreativeTagRef[] = [
  tag("JJ - Lineup Artwork", "asset_type", "Illustration"),
  tag("JJ - Lineup Artwork", "hook_tactic", "Bold Claim"),
  tag("JJ - Lineup Artwork", "messaging_angle", "Artist Headliner"),
  tag("JJ - Lineup Artwork", "messaging_angle", "Event Announcement / Update"),
  tag("JJ - Lineup Artwork", "visual_format", "Billboard"),
  tag("JJ - Motion 9 — Streaming", "asset_type", "High Production"),
  tag("JJ - Motion 9 — Streaming", "hook_tactic", "Urgency"),
  tag("JJ - Motion 9 — Streaming", "hook_tactic", "FOMO"),
  tag("JJ - Motion 9 — Streaming", "messaging_angle", "Urgency / Scarcity / FOMO"),
  tag("JJ - Motion 9 — Streaming", "messaging_angle", "Artist Headliner"),
  tag("JJ - Motion 9 — Streaming", "messaging_angle", "Event Announcement / Update"),
  tag("JJ - Motion 9 — Streaming", "visual_format", "Headline"),
  tag("JJ Feed Post - Gen Sale", "asset_type", "Hybrid"),
  tag("JJ Feed Post - Gen Sale", "hook_tactic", "Aspirational"),
  tag("JJ Feed Post - Gen Sale", "hook_tactic", "FOMO"),
  tag("JJ Feed Post - Gen Sale", "messaging_angle", "Artist Headliner"),
  tag("JJ Feed Post - Gen Sale", "messaging_angle", "Event Announcement / Update"),
  tag("JJ Feed Post - Gen Sale", "visual_format", "Headline"),
  tag("Reminder Static – Copy", "asset_type", "Lifestyle Image with Text"),
  tag("Reminder Static – Copy", "hook_tactic", "FOMO"),
  tag("Reminder Static – Copy", "hook_tactic", "Urgency"),
  tag("Reminder Static – Copy", "messaging_angle", "Artist Headliner"),
  tag("Reminder Static – Copy", "messaging_angle", "Urgency / Scarcity / FOMO"),
  tag("Reminder Static – Copy", "messaging_angle", "Event Announcement / Update"),
  tag("Reminder Static – Copy", "visual_format", "Celebrity"),
  tag("TICKET UPDATE", "asset_type", "Lifestyle Image with Text"),
  tag("TICKET UPDATE", "hook_tactic", "FOMO"),
  tag("TICKET UPDATE", "hook_tactic", "Urgency"),
  tag("TICKET UPDATE", "messaging_angle", "Artist Headliner"),
  tag("TICKET UPDATE", "messaging_angle", "Urgency / Scarcity / FOMO"),
  tag("TICKET UPDATE", "messaging_angle", "Event Announcement / Update"),
  tag("TICKET UPDATE", "visual_format", "Headline"),
  tag("TICKET UPDATE", "visual_format", "Celebrity"),
  tag("TICKET UPDATE - V2 – Copy", "asset_type", "Lifestyle Image with Text"),
  tag("TICKET UPDATE - V2 – Copy", "hook_tactic", "Urgency"),
  tag("TICKET UPDATE - V2 – Copy", "hook_tactic", "FOMO"),
  tag("TICKET UPDATE - V2 – Copy", "messaging_angle", "Urgency / Scarcity / FOMO"),
  tag("TICKET UPDATE - V2 – Copy", "messaging_angle", "Artist Headliner"),
  tag("TICKET UPDATE - V2 – Copy", "messaging_angle", "Event Announcement / Update"),
  tag("TICKET UPDATE - V2 – Copy", "visual_format", "Headline"),
];

const TIKTOK: TikTokRef[] = [
  { name: "80% - JJ New 1_vaES07ge.mp4", spend: 167.67, impressions: 13071, clicks: 370, views2s: 911, viewsFull: 45 },
  { name: "80% - JJ Classic 1_TsM7pLQI.mp4", spend: 114.92, impressions: 23263, clicks: 103, views2s: 8385, viewsFull: 345 },
  { name: "JJ - Lineup - Motion 1_cKoHRCX4.mp4", spend: 111.13, impressions: 17420, clicks: 119, views2s: 2653, viewsFull: 192 },
  { name: "80% - JJ New 2_57AZyiz0.mp4", spend: 76.89, impressions: 12613, clicks: 87, views2s: 2276, viewsFull: 104 },
  { name: "JJ - Lineup - Motion Classic 2_WaBQHo8P.mp4", spend: 42.84, impressions: 7939, clicks: 38, views2s: 1092, viewsFull: 75 },
  { name: "JJ - Lineup - Motion Classic 1_bh2JPt5k.mp4", spend: 38.75, impressions: 6020, clicks: 32, views2s: 618, viewsFull: 36 },
];

export function ironworksInput(surface: "internal" | "share"): CreativeSectionInput {
  return {
    surface,
    label: "IRONWORKS · Jamie Jones · IRW0001",
    scored: DAYS.map((row) => ({ eventId: row.eventId, name: row.name })),
    days: DAYS,
    tags: TAGS,
    renders: [],
    tiktok: TIKTOK,
    refreshOn: false,
    pauses: [],
  };
}

export function ironworksCreative(surface: "internal" | "share"): CreativeSectionModel {
  return buildCreativeSection(ironworksInput(surface));
}
