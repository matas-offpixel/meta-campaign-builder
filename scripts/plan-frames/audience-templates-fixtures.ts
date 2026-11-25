/**
 * RC-E fixtures: the Audience templates tab (design record
 * docs/design-record/2026-11-24-campaign-creator-replicate.html, RC5).
 * The frame's own values: House & disco in NX Promoter, confirmed by Matas
 * Tue 24 Nov, two customer lists and two pools reused, video viewers to
 * create, Folamour and Robbie Doherty reused, Ewan McVicar added with "Add
 * page to this group" and not saved yet, three interests, and Techno not
 * confirmed. The record says its counts, retention days and interests are
 * invented; so are the ids here.
 *
 * Pure. No `@/` imports, so node --test can load it.
 */

import type { AudienceTemplatesPayload } from "../../lib/actions/audience-templates.ts";
import type { AudienceTemplate, KnownAudience, TemplateItem } from "../../lib/audience-templates/resolve.ts";

export const AUDIENCE_TEMPLATE_FRAME_IDS = ["RC-E"] as const;
export type AudienceTemplateFrameId = (typeof AUDIENCE_TEMPLATE_FRAME_IDS)[number];

const ACCOUNT = "act_606252931141334";
const PIXEL = "645185673672763";
const MATAS = "b3ee4e5c-44e6-4684-acf6-efefbecd5858";

const base = { familyKey: null, pageId: null, retentionDays: null, interestId: null, interestName: null, metaAudienceId: null, listRole: null } as const;

const list = (family: "house_tech" | "disco", name: string): TemplateItem => ({ ...base, kind: "customer_list", listRole: "buyers", familyKey: family, detail: { name } });
const pool = (role: "page_views" | "signups" | "video_viewers", days: number, threshold?: number): TemplateItem => ({
  ...base,
  kind: "retargeting_pool",
  listRole: role,
  retentionDays: days,
  detail: threshold != null ? { threshold } : {},
});
const page = (pageId: string, name: string): TemplateItem => ({ ...base, kind: "page_engagers", pageId, retentionDays: 365, detail: { name } });
const interest = (interestId: string, interestName: string): TemplateItem => ({ ...base, kind: "interest", interestId, interestName, detail: {} });

export const HOUSE_DISCO: AudienceTemplate = {
  id: "00000000-0000-4000-8000-0000000000e1",
  name: "House & disco",
  businessId: "1927009767586803",
  clientId: "f9045034-2788-4b1d-94d1-1a5ab7fa5ac8",
  genreFamilies: ["house_tech", "disco"],
  shows: ["Locklead", "Ewan McVicar", "Folamour", "Robbie Doherty", "Julian Fijma"],
  confirmedBy: MATAS,
  confirmedAt: "2026-11-24T12:00:00Z",
  items: [
    list("house_tech", "Tech house buyers"),
    list("disco", "Disco buyers"),
    pool("page_views", 30),
    pool("signups", 180),
    pool("video_viewers", 30, 50),
    page("756330917740654", "Folamour"),
    page("269098466834722", "Robbie Doherty"),
    interest("6003479860669", "House music"),
    interest("6003320931941", "Disco"),
    interest("6003150125367", "Defected Records"),
  ],
};

export const TECHNO: AudienceTemplate = {
  id: "00000000-0000-4000-8000-0000000000e2",
  name: "Techno",
  businessId: "1927009767586803",
  clientId: "f9045034-2788-4b1d-94d1-1a5ab7fa5ac8",
  genreFamilies: ["techno", "hard_techno", "melodic_prog"],
  shows: ["AZYR", "Schak"],
  confirmedBy: null,
  confirmedAt: null,
  items: [],
};

/** Confirmed, so only Techno reads "Not confirmed yet" beside House & disco, as RC-E draws it. */
const confirmedEmpty = (n: number, name: string, genreFamilies: AudienceTemplate["genreFamilies"], shows: string[]): AudienceTemplate => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  name,
  businessId: "1927009767586803",
  clientId: "f9045034-2788-4b1d-94d1-1a5ab7fa5ac8",
  genreFamilies,
  shows,
  confirmedBy: MATAS,
  confirmedAt: "2026-11-24T12:00:00Z",
  items: [],
});

export const HOUSE_GARAGE = confirmedEmpty(3, "House & garage", ["garage_bass", "house_tech"], ["Silva Bumpa", "Interplanetary Criminal"]);
export const COMMERCIAL = confirmedEmpty(4, "Commercial house", ["commercial", "house_tech", "disco"], ["D.O.D", "Rudimental"]);

/** Ewan McVicar: added with "Add page to this group", not saved (RC-E's "1 change"). */
export const RC_E_PENDING: TemplateItem[] = [page("1000000000000003", "Ewan McVicar")];

const k = (id: string, rest: Partial<KnownAudience> & { subtype: string }): KnownAudience => ({
  source: "row",
  metaAudienceId: id,
  accountId: ACCOUNT,
  ...rest,
});

export const RC_E_KNOWN: KnownAudience[] = [
  k("9000000000000001", { subtype: "customer_list", listRole: "buyers", familyKey: "house_tech" }),
  k("9000000000000002", { subtype: "customer_list", listRole: "buyers", familyKey: "disco" }),
  k("9000000000000003", { subtype: "website_pixel", pixelId: PIXEL, pixelEvent: "PageView", retentionDays: 30, urlContains: [], eventId: null }),
  k("9000000000000004", { subtype: "website_pixel", pixelId: PIXEL, pixelEvent: "CompleteRegistration", retentionDays: 180, urlContains: [], eventId: null }),
  k("9000000000000005", { source: "launch", subtype: "page_engagement_fb", pageId: "756330917740654", retentionDays: 365 }),
  k("9000000000000006", { source: "launch", subtype: "page_engagement_ig", pageId: "756330917740654", retentionDays: 365 }),
  k("9000000000000007", { source: "launch", subtype: "page_engagement_fb", pageId: "269098466834722", retentionDays: 365 }),
  k("9000000000000008", { source: "launch", subtype: "page_engagement_ig", pageId: "269098466834722", retentionDays: 365 }),
  // Another account's audience for Ewan McVicar: not this account's, so he is created.
  { source: "row", metaAudienceId: "9000000000000009", accountId: "act_2011069725849568", subtype: "page_engagement_fb", pageId: "1000000000000003", retentionDays: 365 },
];

export const RC_E_DATA: AudienceTemplatesPayload = {
  templates: [HOUSE_DISCO, HOUSE_GARAGE, TECHNO, COMMERCIAL],
  known: RC_E_KNOWN,
  accountId: ACCOUNT,
  accountName: "NX Promoter",
  pixelId: PIXEL,
  pixelName: "NX Loves",
  writesEnabled: false,
  confirmerNames: { [MATAS]: "Matas" },
  accountNames: { [ACCOUNT]: "NX Promoter" },
  pages: [
    { pageId: "1000000000000003", name: "Ewan McVicar" },
    { pageId: "756330917740654", name: "Folamour" },
  ],
};
