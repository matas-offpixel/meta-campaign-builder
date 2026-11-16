/**
 * lib/dashboard/page-audience-panel/fixture.ts
 *
 * Frames and tests only: Electric Brixton's 16 linked CIRQLIN pages, real
 * counts as GET /api/partner/page-audience would return them on 16 Nov
 * 2026. Prod's cirqlin_page_audience had no rows yet (the first nightly
 * read is 16 Nov, 23:55 UTC), so the counts were read the endpoint's own
 * way from CIRQLIN's tables, read-only, counts only (cirqlin
 * partner-page-audience.ts: spam_verdict 'ok', cities named at 10 or more,
 * whatsapp_with_phone = marketing yes with a phone, community_joined_at,
 * clicks on the page's invite code, the code on another page = shared,
 * partner consents not revoked). partner_box_offered is the page's own
 * additional_privacy_policies being non-empty (no crowd pages here).
 * No person data: show names and counts only. No entered member count
 * exists for Electric yet (community_member_counts is empty).
 *
 * ELECTRIC_SHOWS_WITHOUT_PAGE are the client's five events with no
 * cirqlin_page_id (prod, 16 Nov), for HP2's "shows without a CIRQLIN page".
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { toFigures, type PageAudienceFigures, type StoredPageAudienceRow } from "../../cirqlin/page-audience/read.ts";
import type { PanelShow, PanelVenue } from "../audience-panels.ts";
import type { PageAudiencePanelInput } from "./model.ts";

type City = [name: string, region: string, country: string, signups: number];

type Page = {
  eventId: string;
  code: string;
  name: string;
  venue: string;
  pageId: string;
  umbrella?: true;
  signups: number;
  marketing: number;
  whatsapp: number;
  joined: number;
  clicks: number;
  shared: boolean;
  partner: number;
  box: boolean;
  couldntTell: number;
  everywhereElse: number;
  cities: City[];
  /** cirqlin pages.timezone null → the default zone. */
  tz?: string;
};

const E = "ENG";
const S = "SCT";
const W = "WLS";

export const ELECTRIC_CLIENT_ID = "f9045034-2788-4b1d-94d1-1a5ab7fa5ac8";
export const ELECTRIC_CLIENT_NAME = "Electric Brixton";
export const ELECTRIC_READ_DAY = "2026-11-16";

export const ELECTRIC_PAGES: readonly Page[] = [
  {
    eventId: "f0b5636b-ea5d-442e-8a71-36fd930a2b2b", code: "NX26-DOD", name: "D.O.D", venue: "nx newcastle", pageId: "e0b4a82d-a530-49a8-a04d-e5494b947d14",
    signups: 1843, marketing: 324, whatsapp: 324, joined: 0, clicks: 0, shared: false, partner: 0, box: false, couldntTell: 156, everywhereElse: 553,
    cities: [["Newcastle upon Tyne", E, "GB", 215], ["Gateshead", E, "GB", 107], ["Glasgow", S, "GB", 90], ["Sunderland", E, "GB", 70], ["Stockton-on-Tees", E, "GB", 54], ["Manchester", E, "GB", 48], ["City of London", E, "GB", 45], ["Middlesbrough", E, "GB", 41], ["Leeds", E, "GB", 39], ["Wallsend", E, "GB", 35], ["Birmingham", E, "GB", 30], ["South Shields", E, "GB", 29], ["Bristol", E, "GB", 25], ["Newport", W, "GB", 24], ["North Shields", E, "GB", 24], ["Durham", E, "GB", 20], ["Hartlepool", E, "GB", 20], ["Peterlee", E, "GB", 19], ["Islington", E, "GB", 17], ["Edinburgh", S, "GB", 16], ["Morpeth", E, "GB", 15], ["Seaham", E, "GB", 15], ["Darlington", E, "GB", 13], ["Washington", E, "GB", 13], ["Whitley Bay", E, "GB", 13], ["Cramlington", E, "GB", 12], ["Fulham", E, "GB", 12], ["Wakefield", E, "GB", 12], ["Bolton", E, "GB", 11], ["Bishop Auckland", E, "GB", 10], ["Carlisle", E, "GB", 10], ["Consett", E, "GB", 10], ["Newton Aycliffe", E, "GB", 10], ["Wembley", E, "GB", 10]],
  },
  {
    eventId: "b9a4f11e-623c-4900-97bd-5c78d2fa770f", code: "NX26-SCHAK", name: "Schak", venue: "nx newcastle", pageId: "1860e52b-b261-4b3b-b53a-d72b79e5849d",
    signups: 1792, marketing: 306, whatsapp: 306, joined: 0, clicks: 0, shared: false, partner: 0, box: false, couldntTell: 203, everywhereElse: 385,
    cities: [["Newcastle upon Tyne", E, "GB", 227], ["Gateshead", E, "GB", 159], ["Glasgow", S, "GB", 96], ["Sunderland", E, "GB", 63], ["Wallsend", E, "GB", 45], ["Stockton-on-Tees", E, "GB", 41], ["Bolton", E, "GB", 35], ["Manchester", E, "GB", 35], ["Bristol", E, "GB", 33], ["City of London", E, "GB", 32], ["South Shields", E, "GB", 32], ["Leeds", E, "GB", 30], ["Newport", W, "GB", 30], ["Wembley", E, "GB", 28], ["Birmingham", E, "GB", 27], ["North Shields", E, "GB", 26], ["Blyth", E, "GB", 19], ["Fulham", E, "GB", 19], ["Stanley", E, "GB", 17], ["Chester-le-Street", E, "GB", 16], ["Edinburgh", S, "GB", 16], ["Consett", E, "GB", 15], ["Hartlepool", E, "GB", 15], ["Middlesbrough", E, "GB", 13], ["Peterlee", E, "GB", 13], ["Bedlington", E, "GB", 12], ["Durham", E, "GB", 12], ["Islington", E, "GB", 12], ["Blaydon", E, "GB", 11], ["Cramlington", E, "GB", 11], ["Derby", E, "GB", 11], ["Seaham", E, "GB", 11], ["Washington", E, "GB", 11], ["Wolverhampton", E, "GB", 11], ["Morpeth", E, "GB", 10], ["Newton Aycliffe", E, "GB", 10]],
  },
  {
    eventId: "d9e475be-5d5b-4c8d-8be2-e9800844f5f4", code: "NX26-AZYR", name: "AZYR b2b Partiboi69", venue: "nx newcastle", pageId: "a71c9e02-5d34-4b8f-9e16-3c7a208d54f1",
    signups: 1758, marketing: 298, whatsapp: 298, joined: 0, clicks: 60, shared: false, partner: 0, box: false, couldntTell: 281, everywhereElse: 606,
    cities: [["Newcastle upon Tyne", E, "GB", 112], ["Glasgow", S, "GB", 100], ["Gateshead", E, "GB", 87], ["Manchester", E, "GB", 58], ["Bristol", E, "GB", 41], ["Wembley", E, "GB", 41], ["Leeds", E, "GB", 37], ["North Shields", E, "GB", 29], ["Sunderland", E, "GB", 28], ["Birmingham", E, "GB", 27], ["Newport", W, "GB", 23], ["City of London", E, "GB", 22], ["London", E, "GB", 21], ["Edinburgh", S, "GB", 20], ["South Shields", E, "GB", 20], ["Stockton-on-Tees", E, "GB", 20], ["Fulham", E, "GB", 19], ["Liverpool", E, "GB", 18], ["Wallsend", E, "GB", 18], ["Prescot", E, "GB", 17], ["Islington", E, "GB", 16], ["Sheffield", E, "GB", 16], ["Banstead", E, "GB", 14], ["Middlesbrough", E, "GB", 12], ["Peterlee", E, "GB", 12], ["Bradford", E, "GB", 11], ["Hackney", E, "GB", 11], ["Hartlepool", E, "GB", 11], ["Consett", E, "GB", 10]],
  },
  {
    eventId: "9361ce50-8a5f-4cbd-a7d9-67dc853fc212", code: "EBR27-GLITTERBOX", name: "Glitterbox", venue: "electric bristol", pageId: "efc691c4-a121-4190-8bdf-3002d5df7972",
    signups: 1410, marketing: 310, whatsapp: 310, joined: 410, clicks: 326, shared: false, partner: 429, box: true, couldntTell: 0, everywhereElse: 549,
    cities: [["London", E, "GB", 263], ["Bristol", E, "GB", 256], ["Plymouth", E, "GB", 76], ["Newport", W, "GB", 47], ["Bath", E, "GB", 32], ["Cardiff", W, "GB", 24], ["Swindon", E, "GB", 24], ["Weston-super-Mare", E, "GB", 23], ["Birmingham", E, "GB", 22], ["Bridgwater", E, "GB", 17], ["Gloucester", E, "GB", 13], ["Kingswood", E, "GB", 12], ["Cheltenham", E, "GB", 11], ["Mangotsfield", E, "GB", 11], ["Glasgow", S, "GB", 10], ["Rochdale", E, "GB", 10], ["Sheffield", E, "GB", 10]],
  },
  {
    eventId: "565600ea-0b5d-4c91-8215-187bb37434e8", code: "NX26-FOLAMOUR", name: "Folamour", venue: "nx newcastle", pageId: "3f8a6c14-2b7d-4e59-9c81-5d6ea4f70b23",
    signups: 1314, marketing: 181, whatsapp: 181, joined: 0, clicks: 0, shared: false, partner: 166, box: true, couldntTell: 159, everywhereElse: 479,
    cities: [["Newcastle upon Tyne", E, "GB", 109], ["Gateshead", E, "GB", 70], ["Glasgow", S, "GB", 60], ["Sunderland", E, "GB", 39], ["Manchester", E, "GB", 36], ["Newport", W, "GB", 29], ["Stockton-on-Tees", E, "GB", 28], ["Liverpool", E, "GB", 26], ["Leeds", E, "GB", 23], ["City of London", E, "GB", 22], ["Bristol", E, "GB", 21], ["Middlesbrough", E, "GB", 21], ["Birmingham", E, "GB", 19], ["Fulham", E, "GB", 19], ["Wallsend", E, "GB", 18], ["North Shields", E, "GB", 14], ["Peterlee", E, "GB", 14], ["Hackney", E, "GB", 13], ["Islington", E, "GB", 12], ["Bradford", E, "GB", 11], ["Edinburgh", S, "GB", 11], ["Hull", E, "GB", 11], ["Darlington", E, "GB", 10], ["Hartlepool", E, "GB", 10], ["Seaham", E, "GB", 10], ["Wembley", E, "GB", 10], ["York", E, "GB", 10]],
  },
  {
    eventId: "eac13b87-74cb-454f-8007-36a4a8a09593", code: "NX26-RUDIMENTAL", name: "Rudimental", venue: "nx newcastle", pageId: "6b90b556-2609-4942-a02c-dc02b4e8c182",
    signups: 1096, marketing: 147, whatsapp: 147, joined: 0, clicks: 0, shared: false, partner: 0, box: false, couldntTell: 49, everywhereElse: 448,
    cities: [["Newcastle upon Tyne", E, "GB", 122], ["London", E, "GB", 112], ["Manchester", E, "GB", 52], ["Wallsend", E, "GB", 51], ["Gateshead", E, "GB", 41], ["Glasgow", S, "GB", 27], ["Leeds", E, "GB", 23], ["North Shields", E, "GB", 23], ["Bolton", E, "GB", 22], ["Sunderland", E, "GB", 22], ["Stockton-on-Tees", E, "GB", 20], ["South Shields", E, "GB", 16], ["Edinburgh", S, "GB", 14], ["City of London", E, "GB", 11], ["Durham", E, "GB", 11], ["Newport", W, "GB", 11], ["Washington", E, "GB", 11], ["Harrow", E, "GB", 10]],
  },
  {
    eventId: "c6c3af5f-5f10-4492-8bcf-9cbf644be523", code: "NX26-GLOBAL", name: "Global Marketing", venue: "nx newcastle", pageId: "54582c7c-e710-4baa-b4aa-326b100c13c9", umbrella: true, tz: "Europe/London",
    signups: 825, marketing: 825, whatsapp: 825, joined: 0, clicks: 0, shared: false, partner: 0, box: false, couldntTell: 28, everywhereElse: 548,
    cities: [["London", E, "GB", 160], ["Manchester", E, "GB", 29], ["Newcastle upon Tyne", E, "GB", 15], ["Bristol", E, "GB", 13], ["Birmingham", E, "GB", 11], ["Leeds", E, "GB", 11], ["Glasgow", S, "GB", 10]],
  },
  {
    eventId: "f319a1c7-29fb-47cd-a7dc-66fdd7356ee1", code: "ES27-LPRHYTHM", name: "L.P Rhythm", venue: "electric studios", pageId: "d08aa5b4-7002-449b-b646-8c7fafc59fec",
    signups: 810, marketing: 198, whatsapp: 198, joined: 371, clicks: 275, shared: false, partner: 0, box: false, couldntTell: 0, everywhereElse: 314,
    cities: [["London", E, "GB", 176], ["Sheffield", E, "GB", 165], ["Manchester", E, "GB", 53], ["Leeds", E, "GB", 26], ["Birmingham", E, "GB", 23], ["Chesterfield", E, "GB", 12], ["Liverpool", E, "GB", 11], ["Doncaster", E, "GB", 10], ["Newcastle upon Tyne", E, "GB", 10], ["Rotherham", E, "GB", 10]],
  },
  {
    eventId: "6e629f57-ac3f-4c9e-b1e4-9b717b65c004", code: "NX26-ROBBIEDOHERTY", name: "Robbie Doherty", venue: "nx newcastle", pageId: "0c8e8daa-b2e3-49c0-8804-9f1c3453ff3b",
    signups: 687, marketing: 78, whatsapp: 78, joined: 0, clicks: 0, shared: false, partner: 0, box: false, couldntTell: 0, everywhereElse: 280,
    cities: [["London", E, "GB", 164], ["Newcastle upon Tyne", E, "GB", 58], ["Manchester", E, "GB", 47], ["Wallsend", E, "GB", 43], ["Glasgow", S, "GB", 23], ["Leeds", E, "GB", 20], ["South Shields", E, "GB", 16], ["Durham", E, "GB", 14], ["Stockton-on-Tees", E, "GB", 12], ["Sunderland", E, "GB", 10]],
  },
  {
    eventId: "602f9e86-ee03-4ece-81e0-6b7a3b224ae6", code: "NX26-LOCKLEAD", name: "Locklead", venue: "nx newcastle", pageId: "62df0675-3dd9-4d02-9aa4-cabaee568ae7",
    signups: 649, marketing: 75, whatsapp: 75, joined: 257, clicks: 906, shared: false, partner: 0, box: false, couldntTell: 0, everywhereElse: 266,
    cities: [["London", E, "GB", 168], ["Manchester", E, "GB", 60], ["Newcastle upon Tyne", E, "GB", 57], ["Wallsend", E, "GB", 47], ["South Shields", E, "GB", 15], ["Middlesbrough", E, "GB", 13], ["Glasgow", S, "GB", 12], ["Stockton-on-Tees", E, "GB", 11]],
  },
  {
    eventId: "cd1035d1-1d5a-47ce-a37c-0750f9012b85", code: "EBR26-KREAM", name: "Kream", venue: "electric bristol", pageId: "6750d900-c859-425b-8307-3fd3b5c1d554",
    signups: 593, marketing: 134, whatsapp: 134, joined: 0, clicks: 192, shared: false, partner: 0, box: false, couldntTell: 0, everywhereElse: 318,
    cities: [["London", E, "GB", 145], ["Bristol", E, "GB", 64], ["Newport", W, "GB", 20], ["Cardiff", W, "GB", 12], ["Plymouth", E, "GB", 12], ["Bath", E, "GB", 11], ["Swindon", E, "GB", 11]],
  },
  {
    eventId: "5b0a5359-28ce-4841-a532-9e88022cf8e7", code: "ES26-FEVER105", name: "Sheffield Fever 105", venue: "electric studios", pageId: "6dbf5473-b9af-42f8-8b20-a82040bd7698",
    signups: 539, marketing: 95, whatsapp: 95, joined: 0, clicks: 0, shared: true, partner: 88, box: true, couldntTell: 0, everywhereElse: 277,
    cities: [["London", E, "GB", 104], ["Sheffield", E, "GB", 83], ["Manchester", E, "GB", 42], ["Leeds", E, "GB", 12], ["Kingston upon Hull", E, "GB", 11], ["Glasgow", S, "GB", 10]],
  },
  {
    eventId: "144aa77b-9e12-49d2-a92b-a42e2f0af4ee", code: "NX27-EWANMCVICAR", name: "Ewan McVicar", venue: "nx newcastle", pageId: "8552e007-6de0-4cc4-ad7f-a3607d07ed5b",
    signups: 469, marketing: 117, whatsapp: 117, joined: 192, clicks: 83, shared: false, partner: 116, box: true, couldntTell: 0, everywhereElse: 231,
    cities: [["London", E, "GB", 58], ["Newcastle upon Tyne", E, "GB", 47], ["Wallsend", E, "GB", 35], ["Manchester", E, "GB", 31], ["Leeds", E, "GB", 22], ["South Shields", E, "GB", 21], ["Stockton-on-Tees", E, "GB", 13], ["Sunderland", E, "GB", 11]],
  },
  {
    eventId: "c06694eb-77e8-45ae-9f3f-245540215fa3", code: "ES26-GDS", name: "Girls Don't Sync", venue: "electric studios", pageId: "46442f70-3b6c-432e-9da6-66719aa83d24",
    signups: 261, marketing: 34, whatsapp: 34, joined: 0, clicks: 0, shared: false, partner: 0, box: false, couldntTell: 0, everywhereElse: 109,
    cities: [["Sheffield", E, "GB", 69], ["London", E, "GB", 61], ["Manchester", E, "GB", 22]],
  },
  {
    eventId: "e9f7b325-dfb1-46e9-a8bf-e5cf097e7747", code: "NX26-DJEZ", name: "DJ EZ", venue: "nx newcastle", pageId: "b4312f2e-bdac-4483-8812-eaa04ab86699", tz: "Europe/London",
    signups: 1, marketing: 0, whatsapp: 0, joined: 0, clicks: 0, shared: false, partner: 0, box: false, couldntTell: 0, everywhereElse: 1, cities: [],
  },
  {
    eventId: "407eb204-7498-49aa-983d-d336af81e871", code: "NX27-PAULVANDYK", name: "Paul van Dyk", venue: "nx newcastle", pageId: "a2adc496-3be3-4942-93b8-c163a8485045",
    signups: 1, marketing: 1, whatsapp: 1, joined: 0, clicks: 5, shared: false, partner: 1, box: true, couldntTell: 0, everywhereElse: 1, cities: [],
  },
];

/** Electric's shows with no CIRQLIN page (events.cirqlin_page_id null, 16 Nov). */
export const ELECTRIC_SHOWS_WITHOUT_PAGE: readonly PanelShow[] = [
  { id: "a8696914-1280-4b13-a0b4-ebf584bbd55c", code: "ES26-MALLGRAB", name: "Mall Grab - Sheffield", venue_key: "electric studios" },
  { id: "df3ea903-5ab5-4b7c-948e-e21666826df1", code: "NX26-MF", name: "Modern Funktion", venue_key: "nx newcastle" },
  { id: "2b7b7262-5d04-4363-b980-17b3900224fb", code: "NX26-EED", name: "East End Dubs", venue_key: "nx newcastle" },
  { id: "2567a255-3015-4aeb-b1a3-13d070c62ec6", code: "NX26-IPC", name: "Interplanetary Criminal", venue_key: "nx newcastle" },
  { id: "217c0436-460d-4a18-b612-68fe8f9ba794", code: "NX27-JULIANFIJMA", name: "Julian Fijma", venue_key: "nx newcastle" },
];

/** The stored row a page would have after the 16 Nov nightly read. */
export function storedRow(p: Page, day = ELECTRIC_READ_DAY): StoredPageAudienceRow {
  return {
    page_id: p.pageId,
    fetch_day: day,
    event_id: p.eventId,
    is_umbrella: p.umbrella === true,
    signups: p.signups,
    geo_cities: p.cities.map(([name, region, country, signups]) => ({ name, region, country, signups })),
    geo_everywhere_else: p.everywhereElse,
    geo_couldnt_tell: p.couldntTell,
    consent_marketing: p.marketing,
    channels_offered: ["email", "sms", "whatsapp"],
    community_joined: p.joined,
    community_link_clicks: p.clicks,
    community_code_shared: p.shared,
    whatsapp_with_phone: p.whatsapp,
    partner_opt_in: p.partner,
    partner_box_offered: p.box,
    daily_timezone: p.tz ?? "Europe/London",
    signups_check: "unchecked",
    signups_stored: null,
    signups_stored_at: null,
    fetched_at: `${day}T23:55:00Z`,
  };
}

export function electricShows(): PanelShow[] {
  return [...ELECTRIC_PAGES.map((p) => ({ id: p.eventId, code: p.code, name: p.name, venue_key: p.venue })), ...ELECTRIC_SHOWS_WITHOUT_PAGE];
}

/** The dashboard's views for Electric: the client, its three venues, every show chip. */
export function electricViews(): { viewIds: string[]; venues: PanelVenue[] } {
  const venues: PanelVenue[] = [
    { key: "nx newcastle", name: "NX Newcastle", viewId: "venue:nx newcastle" },
    { key: "electric bristol", name: "Electric Bristol", viewId: "venue:electric bristol" },
    { key: "electric studios", name: "Electric Studios", viewId: "venue:electric studios" },
  ];
  return {
    viewIds: ["all", ...venues.map((v) => v.viewId), ...[...ELECTRIC_PAGES.map((p) => p.code), ...ELECTRIC_SHOWS_WITHOUT_PAGE.map((s) => s.code!)].map((c) => c.toLowerCase())],
    venues,
  };
}

export function electricFigures(): Map<string, PageAudienceFigures> {
  return new Map(ELECTRIC_PAGES.map((p) => [p.eventId, toFigures(p.eventId, p.umbrella === true, storedRow(p))]));
}

export function electricInput(): PageAudiencePanelInput {
  return {
    shows: electricShows(),
    pages: electricFigures(),
    history: new Map(),
    entered: new Map(),
    clientName: ELECTRIC_CLIENT_NAME,
    umbrellaIds: new Set(ELECTRIC_PAGES.filter((p) => p.umbrella).map((p) => p.eventId)),
  };
}

export function electricPage(code: string): Page {
  const p = ELECTRIC_PAGES.find((x) => x.code === code);
  if (!p) throw new Error(`no fixture page ${code}`);
  return p;
}
