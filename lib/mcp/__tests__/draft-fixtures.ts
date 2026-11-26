/**
 * Fixtures for the M2 draft tools: drafts, events, a venue, the client's
 * page, a Drive tree and spies for every outside call (Meta location
 * search, Drive, Storage). Codes, ids and counts only; no person data.
 */
import { writeFile } from "node:fs/promises";
import { createDefaultCreative, createDefaultDraft } from "../../campaign-defaults.ts";
import { migrateDraft } from "../../autosave.ts";
import type { DriveApi, DriveFile, DriveMediaFile } from "../../drive/client.ts";
import type { LocationSearchHit } from "../../meta/location-search.ts";
import type { CampaignDraft } from "../../types.ts";
import type { McpDraftDeps, ToolContext } from "../tool-types.ts";
import type { AccountPage, InterestHit } from "../graph-reads.ts";
import { fakeDb } from "./fake-db.ts";
import { CLIENT_NX, NOW, TODAY, fakeReaders, tables } from "./fixtures.ts";
import { OPERATOR, STAFF } from "./helpers.ts";

export const CLIENT_EL = "c0000000-0000-4000-8000-000000000003";
export const EV_SRC = "e0000000-0000-4000-8000-000000000010";
export const EV_TGT = "e0000000-0000-4000-8000-000000000011";
export const EV_EL = "e0000000-0000-4000-8000-000000000012";
export const EV_GONE = "e0000000-0000-4000-8000-000000000013";
export const D_PUB = "d0000000-0000-4000-8000-000000000010";
export const D_DRAFT = "d0000000-0000-4000-8000-000000000011";
export const D_STAFF = "d0000000-0000-4000-8000-000000000012";
export const D_ARCH = "d0000000-0000-4000-8000-000000000013";
export const UPDATED = "2026-11-24T08:00:00.123456+00:00";
export const NX_ACCOUNT = "act_606252931141334";
export const NX_PIXEL = "645185673672763";
export const NX_PAGE = "100064000000001";
export const NX_IG = "17841400000000001";
export const TGT_SIGNUP = "https://crqln.com/l/glitterbox-newcastle";
export const TGT_TICKETS = "https://www.skiddle.com/e/40000001";
export const SCOPE_BOTH = "mcp:read mcp:draft";

function sourceDraft(): CampaignDraft {
  const d = createDefaultDraft();
  d.id = D_PUB;
  d.settings = { ...d.settings, eventId: EV_SRC, clientId: CLIENT_NX, adAccountId: NX_ACCOUNT, metaAdAccountId: NX_ACCOUNT, pixelId: NX_PIXEL, campaignCode: "NX26-SRC", campaignName: "[NX26-SRC] SIGNUP", objective: "registration" };
  const c = createDefaultCreative("registration");
  c.id = "cr-1";
  c.name = "Teaser 1";
  c.identity = { pageId: NX_PAGE, instagramAccountId: NX_IG };
  c.destinationUrl = "https://crqln.com/l/source-show?utm_source=meta";
  const c2 = { ...createDefaultCreative("registration"), id: "cr-2", name: "Teaser 2", identity: { pageId: NX_PAGE, instagramAccountId: NX_IG }, destinationUrl: "https://crqln.com/l/source-show" };
  d.creatives = [c, c2];
  d.adSetSuggestions = [
    { id: "as-1", name: "Broad", sourceType: "blank", sourceId: "", sourceName: "Broad", ageMin: 18, ageMax: 35, budgetPerDay: 20, enabled: true, advantagePlus: false } as never,
    { id: "as-2", name: "Fans", sourceType: "blank", sourceId: "", sourceName: "Fans", ageMin: 18, ageMax: 35, budgetPerDay: 30, enabled: true, advantagePlus: false } as never,
  ];
  d.budgetSchedule = { ...d.budgetSchedule, startDate: "2026-11-01T10:00", endDate: "2026-12-20T23:59", locationGroups: [{ id: "g1", label: "Newcastle upon Tyne (+40 km)", source: "manual", selections: [{ id: "s1", source: "search", label: "Newcastle upon Tyne", mode: "include", locationType: "city", locationKey: "2618097", radius: 40, distanceUnit: "kilometer" }] }] };
  d.status = "published";
  return d;
}

function draftRow(id: string, draft: CampaignDraft, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: OPERATOR,
    name: draft.settings.campaignName,
    status: draft.status,
    objective: draft.settings.objective,
    event_id: draft.settings.eventId,
    client_id: draft.settings.clientId,
    ad_account_id: draft.settings.adAccountId,
    updated_at: UPDATED,
    draft_json: draft,
    ...over,
  };
}

export function draftTables() {
  const base = tables();
  const src = sourceDraft();
  const editable: CampaignDraft = {
    ...structuredClone(src),
    id: D_DRAFT,
    status: "draft",
    settings: { ...src.settings, eventId: EV_TGT, campaignCode: "NX27-GLITTERBOX", campaignName: "[NX27-GLITTERBOX] SIGNUP" },
  };
  const staff: CampaignDraft = { ...structuredClone(editable), id: D_STAFF };
  const archived: CampaignDraft = { ...structuredClone(editable), id: D_ARCH, status: "archived" };
  const ev = (over: Record<string, unknown>) => ({
    name: "Show",
    venue_name: "NX Newcastle",
    venue_city: "Newcastle",
    venue_id: "venue-nx",
    status: "upcoming",
    meta_campaign_id: null,
    announcement_at: null,
    presale_at: null,
    general_sale_at: null,
    meta_ad_account_id: null,
    meta_pixel_id: null,
    signup_url: null,
    ticket_url: null,
    drive_folder_id: null,
    user_id: OPERATOR,
    ...over,
  });
  return {
    ...base,
    clients: [
      ...base.clients.map((c) => (c.id === CLIENT_NX ? { ...c, default_page_ids: [NX_PAGE], default_instagram_actor_id: NX_IG } : c)),
      { id: CLIENT_EL, name: "Electric", status: "active", default_page_ids: [], default_instagram_actor_id: null },
    ],
    events: [
      ...base.events,
      ev({ id: EV_SRC, event_code: "NX26-SRC", client_id: CLIENT_NX, client: { name: "NX Live" }, event_date: "2026-12-20", signup_url: "https://crqln.com/l/source-show" }),
      ev({
        id: EV_TGT,
        event_code: "NX27-GLITTERBOX",
        name: "Glitterbox",
        client_id: CLIENT_NX,
        client: { name: "NX Live" },
        event_date: "2027-03-06",
        presale_at: "2027-01-15T10:00:00Z",
        general_sale_at: "2027-01-17T10:00:00Z",
        signup_url: TGT_SIGNUP,
        ticket_url: TGT_TICKETS,
        drive_folder_id: "drv-event",
      }),
      ev({ id: EV_EL, event_code: "EBR27-LOCKLEAD", client_id: CLIENT_EL, client: { name: "Electric" }, event_date: "2027-02-26", venue_id: null, venue_name: "Electric Bristol" }),
      ev({ id: EV_GONE, event_code: "NX26-GONE", client_id: CLIENT_NX, client: { name: "NX Live" }, event_date: "2026-11-01" }),
    ],
    venues: [{ id: "venue-nx", name: "NX Newcastle", client_id: CLIENT_NX, meta_ad_account_id: NX_ACCOUNT, meta_pixel_id: NX_PIXEL }],
    meta_custom_audiences: [],
    bm_ad_accounts: [{ ad_account_id: NX_ACCOUNT, name: "NX Promoter" }],
    bm_pages: [{ page_id: NX_PAGE, page_name: "NX Newcastle" }],
    campaign_drafts: [
      ...base.campaign_drafts,
      draftRow(D_PUB, src),
      draftRow(D_DRAFT, editable),
      draftRow(D_STAFF, staff, { user_id: STAFF }),
      draftRow(D_ARCH, archived),
    ],
    drive_folders: [{ event_id: EV_TGT, key: "event", name: "NX27-GLITTERBOX", drive_folder_id: "drv-event" }],
    creative_assets: [] as Array<Record<string, unknown>>,
    // M3a: the send step's dedupe; PR D: the per-show spend ceilings and the spend they read.
    creative_asset_channel_ids: [] as Array<Record<string, unknown>>,
    client_spend_ceilings: [] as Array<Record<string, unknown>>,
    show_spend_ceilings: [] as Array<Record<string, unknown>>,
    show_spend_ceiling_events: [] as Array<Record<string, unknown>>,
    ad_daily_insights: [] as Array<Record<string, unknown>>,
    creative_lab_captions: [
      { id: "cap-1", event_id: EV_TGT, style: "artist_first_person", text: "Newcastle, I can't wait to play for you again", primary_text: null },
      { id: "cap-2", event_id: EV_TGT, style: "promoter", text: "Glitterbox returns to Newcastle", primary_text: null },
    ],
    event_artists: [],
    mcp_actions: [] as Array<Record<string, unknown>>,
    // runLaunchGuard's reads (lib/launch-guard/load.ts).
    artists: [] as Array<Record<string, unknown>>,
    bm_ig_accounts: [] as Array<Record<string, unknown>>,
    client_business_managers: [] as Array<Record<string, unknown>>,
    campaign_plan_meta_launch: [] as Array<Record<string, unknown>>,
    // apply_audience_template's reads.
    audience_templates: [] as Array<Record<string, unknown>>,
    audience_template_items: [] as Array<Record<string, unknown>>,
  };
}

// ─── Spies ──────────────────────────────────────────────────────────────────

export interface Spies {
  geo: string[];
  interests: string[];
  pageLists: string[];
  drive: string[];
  uploads: string[];
  copies: Array<[string, string]>;
}

/** Meta's interest search, as the fake answers it. */
export const INTEREST_HITS: Record<string, InterestHit[]> = {
  "tech house": [
    { id: "6003000000001", name: "Tech house", audienceSize: 9_000_000, path: ["Interests", "Music", "Tech house"] },
    { id: "6003000000009", name: "Tech house music festivals" },
  ],
  disco: [{ id: "6003000000002", name: "Disco", audienceSize: 40_000_000 }],
  "defected records": [{ id: "6003000000003", name: "Defected Records" }],
  house: [
    { id: "6003000000004", name: "House music" },
    { id: "6003000000005", name: "House (TV series)" },
  ],
};

export const EL_PAGE = "769954239540040";
export const EL_IG = "17841400000000077";
/** The pages NX_ACCOUNT can run ads from (promote_pages), as the fake answers it. */
export const ACCOUNT_PAGES: AccountPage[] = [
  { id: NX_PAGE, name: "NX Newcastle", instagramId: NX_IG },
  { id: EL_PAGE, name: "Electric Studios", instagramId: EL_IG },
  { id: "100064000000099", name: "No IG page", instagramId: null },
];

const HITS: Record<string, LocationSearchHit[]> = {
  leeds: [
    { key: "811209", name: "Leeds", type: "city", country_code: "GB", country_name: "United Kingdom", region: "England" },
  ],
  manchester: [
    { key: "2513419", name: "Manchester", type: "city", country_code: "GB", country_name: "United Kingdom", region: "England" },
    { key: "2490299", name: "Manchester", type: "city", country_code: "US", country_name: "United States", region: "New Hampshire" },
  ],
};

const FOLDER = "application/vnd.google-apps.folder";
const media = (over: Partial<DriveMediaFile> & { id: string; name: string; mimeType: string }): DriveMediaFile =>
  ({ parents: ["drv-videos"], trashed: false, size: 2_000_000, width: 1080, height: 1920, rotation: 0, durationMs: 15_000, thumbnailLink: null, ...over }) as DriveMediaFile;

export const DRIVE_FILES: DriveMediaFile[] = [
  media({ id: "file-clip-916", name: "clip-a.mp4", mimeType: "video/mp4" }),
  media({ id: "file-static-916", name: "poster.jpg", mimeType: "image/jpeg", durationMs: null }),
  media({ id: "file-static-45", name: "poster-feed.jpg", mimeType: "image/jpeg", width: 1080, height: 1350, durationMs: null }),
];

export function fakeDrive(spies: Spies): DriveApi {
  const folders: Record<string, DriveFile> = {
    "drv-videos": { id: "drv-videos", name: "Videos", mimeType: FOLDER, parents: ["drv-event"], trashed: false } as DriveFile,
  };
  const note = (s: string) => spies.drive.push(s);
  return {
    driveId: "drive-test",
    async listChildren(parent) {
      note(`listChildren:${parent}`);
      return parent === "drv-event" ? [folders["drv-videos"]!] : [];
    },
    async getFile(id) {
      note(`getFile:${id}`);
      return folders[id] ?? DRIVE_FILES.find((f) => f.id === id) ?? null;
    },
    async listMedia(parent) {
      note(`listMedia:${parent}`);
      return DRIVE_FILES.filter((f) => f.parents?.[0] === parent);
    },
    async getMediaFile(id) {
      note(`getMediaFile:${id}`);
      return DRIVE_FILES.find((f) => f.id === id) ?? null;
    },
    async downloadTo(id, filePath) {
      note(`downloadTo:${id}`);
      await writeFile(filePath, `bytes-of-${id}`);
      return { contentHash: `hash-${id}`, byteSize: 2_000_000 };
    },
    createFolder: async () => {
      throw new Error("no Drive writes");
    },
    uploadFile: async () => {
      throw new Error("no Drive writes");
    },
    createShortcut: async () => {
      throw new Error("no Drive writes");
    },
    update: async () => {
      throw new Error("no Drive writes");
    },
    download: async () => {
      throw new Error("not used");
    },
    startPageToken: async () => "t",
    listChanges: async () => ({ changes: [], newStartPageToken: "t", nextPageToken: null }) as never,
    shareReader: async () => {
      throw new Error("no Drive writes");
    },
    removePermission: async () => {
      throw new Error("no Drive writes");
    },
  };
}

let seq = 0;
export function fakeDraftDeps(spies: Spies, over: Partial<McpDraftDeps> = {}): McpDraftDeps {
  return {
    async geoSearch({ query }) {
      spies.geo.push(query);
      return { hits: HITS[query.trim().toLowerCase().split(",")[0]!] ?? [], metaGets: 1 };
    },
    async interestSearch({ query }) {
      spies.interests.push(query);
      return { hits: INTEREST_HITS[query.trim().toLowerCase()] ?? [], metaGets: 1 };
    },
    async pagesForAccount({ adAccountId }) {
      spies.pageLists.push(adAccountId);
      return { pages: ACCOUNT_PAGES, metaGets: 1, truncated: false };
    },
    drive: () => fakeDrive(spies),
    async uploadFile(storagePath) {
      spies.uploads.push(storagePath);
    },
    async copyObject(from, to) {
      spies.copies.push([from, to]);
    },
    newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    ...over,
  };
}

export function newSpies(): Spies {
  return { geo: [], interests: [], pageLists: [], drive: [], uploads: [], copies: [] };
}

export function draftCtx(over: Partial<ToolContext> = {}, spies = newSpies()) {
  const db = fakeDb(draftTables());
  const c = {
    db,
    readers: { ...fakeReaders, migrateDraft: (raw: Record<string, unknown>) => migrateDraft(raw) as unknown as Record<string, unknown> },
    userId: OPERATOR,
    seesClientNames: true,
    today: TODAY,
    now: NOW,
    scope: SCOPE_BOTH,
    draft: fakeDraftDeps(spies),
    ...over,
  } as ToolContext & { db: ReturnType<typeof fakeDb> };
  return { ctx: c, db, spies };
}

/** The row as the table holds it now. */
export async function readRow(db: ReturnType<typeof fakeDb>, id: string): Promise<Record<string, unknown> | null> {
  const res = await db.from("campaign_drafts").select("*").eq("id", id).maybeSingle();
  return (res.data as Record<string, unknown> | null) ?? null;
}
