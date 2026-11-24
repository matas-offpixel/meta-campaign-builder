/**
 * Campaign creator, part 4 frames (records 2026-11-24-campaign-creator-replicate
 * and 2026-11-24-campaign-creator-tree-as-built): RC-A (the ⋯ menu and the
 * picker, RC-A2), RC-A-nomatch and RC-A-error (RC-A2's other two states),
 * RC-B (RC-B2), RC-B-notset (a venue with nothing stored), RC-F (RC-F2),
 * RC-F-sheet (Add 1 creative to On sale: 8 ad sets in 2 campaigns), RC-F-off (the switch off) and RC-G
 * (Add audience to…, after a run with misses).
 *
 * Built by the rules, not typed: RC-B's rows come from CC-1's replicateDraft
 * on the Glitterbox Bristol → Newcastle case, RC-F from buildCampaignTree and
 * the sheet's ticks from defaultSelection (live ticked, paused not). Account
 * and pixel ids are the venues' real ones (CC-1's tests); ad counts, dates,
 * ad set names and the page name are the record's invented ones. No fan or
 * staff data; "Matas" is the operator the record draws.
 */

import { createDefaultCreative, createDefaultDraft } from "../../lib/campaign-defaults.ts";
import {
  buildCampaignTree,
  defaultSelection,
  stageOfCampaign,
  stageSheetCampaigns,
  type NotAdded,
  type TreeAdditionRow,
  type TreeCampaign,
  type TreeSelection,
  type TreeView,
} from "../../lib/campaign-tree/tree.ts";
import { replicateDraft, type AudienceRoleRow, type ReplicateEvent, type ReplicateVenue } from "../../lib/replicate/replicate.ts";
import type { AdSetSuggestion, CampaignDraft } from "../../lib/types.ts";

export const CAMPAIGN_TREE_FRAME_IDS = ["RC-A", "RC-A-nomatch", "RC-A-error", "RC-B", "RC-B-notset", "RC-F", "RC-F-sheet", "RC-F-off", "RC-G"] as const;
export type CampaignTreeFrameId = (typeof CAMPAIGN_TREE_FRAME_IDS)[number];

const NX_ACCOUNT = "act_606252931141334";
const BRISTOL_ACCOUNT = "act_2011069725849568";
const NX_PIXEL = "645185673672763";
const BRISTOL_PIXEL = "800268622344093";
const ACCOUNT_NAMES = { [NX_ACCOUNT]: "NX Promoter", [BRISTOL_ACCOUNT]: "Electric Bristol Live" };
const GLITTERBOX_PAGE = "100064000000001";
const NOW = new Date("2026-11-26T09:00:00Z");

const EBR27_GLITTERBOX: ReplicateEvent = {
  id: "event-ebr27-glitterbox",
  event_code: "EBR27-GLITTERBOX",
  client_id: "client-electric",
  name: "Glitterbox",
  venue_name: "Electric Bristol",
  event_date: "2027-02-27",
  general_sale_at: "2026-11-20T12:00:00Z",
  signup_url: "https://crqln.com/l/glitterbox-bristol",
  meta_ad_account_id: "2011069725849568",
};

const NX27_GLITTERBOX: ReplicateEvent = {
  id: "event-nx27-glitterbox",
  event_code: "NX27-GLITTERBOX",
  client_id: "client-electric",
  name: "Glitterbox",
  venue_name: "NX Newcastle",
  event_date: "2027-03-06",
  general_sale_at: "2026-11-27T14:00:00Z",
  signup_url: "https://crqln.com/l/glitterbox-newcastle",
  meta_ad_account_id: "606252931141334",
};

/** Brixton has nothing stored yet (RC2's amber rows). */
const EBX27_GLITTERBOX: ReplicateEvent = {
  id: "event-ebx27-glitterbox",
  event_code: "EBX27-GLITTERBOX",
  client_id: "client-electric",
  name: "Glitterbox",
  venue_name: "Electric Brixton",
  event_date: "2027-03-13",
  general_sale_at: "2026-11-27T14:00:00Z",
  signup_url: "https://crqln.com/l/glitterbox-brixton",
  meta_ad_account_id: null,
};

const NX_VENUE: ReplicateVenue = { id: "venue-nx", name: "NX Newcastle", meta_ad_account_id: NX_ACCOUNT, meta_pixel_id: NX_PIXEL };
const BRISTOL_VENUE: ReplicateVenue = { id: "venue-ebr", name: "Electric Bristol", meta_ad_account_id: BRISTOL_ACCOUNT, meta_pixel_id: BRISTOL_PIXEL };
const BRIXTON_VENUE: ReplicateVenue = { id: "venue-ebx", name: "Electric Brixton", meta_ad_account_id: null, meta_pixel_id: null };

function adSet(i: number): AdSetSuggestion {
  return {
    id: `adset-${i}`,
    name: `Ad set ${i}`,
    sourceType: "interest_group",
    sourceId: "ig-1",
    sourceName: "House",
    ageMin: 18,
    ageMax: 40,
    budgetPerDay: 3,
    advantagePlus: false,
    enabled: true,
  };
}

/** [EBR27-GLITTERBOX] SIGNUP: 18 ad sets, 3 ads in each (54). */
function glitterboxSignup(audienceIds: string[]): CampaignDraft {
  const draft = createDefaultDraft();
  draft.id = "draft-ebr27-signup";
  draft.status = "published";
  draft.metaCampaignId = "120252700000000000";
  draft.settings = {
    ...draft.settings,
    clientId: "client-electric",
    eventId: EBR27_GLITTERBOX.id,
    campaignCode: "EBR27-GLITTERBOX",
    campaignName: "[EBR27-GLITTERBOX] SIGNUP",
    objective: "registration",
    adAccountId: BRISTOL_ACCOUNT,
    metaAdAccountId: BRISTOL_ACCOUNT,
    pixelId: BRISTOL_PIXEL,
    metaPixelId: BRISTOL_PIXEL,
    metaPageId: GLITTERBOX_PAGE,
  };
  draft.adSetSuggestions = Array.from({ length: 18 }, (_, i) => adSet(i + 1));
  draft.creatives = ["Static 1", "Static 2", "Video 1"].map((name, i) => ({
    ...createDefaultCreative("registration"),
    id: `creative-${i + 1}`,
    name,
    identity: { pageId: GLITTERBOX_PAGE, instagramAccountId: "17841400000000001" },
    destinationUrl: "https://crqln.com/l/glitterbox-bristol?utm_source=meta&utm_medium=paid&utm_campaign=EBR27-GLITTERBOX",
  }));
  draft.creativeAssignments = Object.fromEntries(draft.adSetSuggestions.map((s) => [s.id, draft.creatives.map((c) => c.id)]));
  draft.budgetSchedule = {
    ...draft.budgetSchedule,
    startDate: "2026-11-23T10:00",
    startDateSource: "operator",
    endDate: "2026-11-20T12:00",
    endDateSource: "event",
    endDatePhase: "general_sale",
  };
  draft.audiences.customAudienceGroups = [{ id: "cag-1", name: "Electric", audienceIds }];
  return draft;
}

/** Nine audiences found in NX by role, three in Bristol only. */
function glitterboxAudiences(): { ids: string[]; rows: AudienceRoleRow[] } {
  const rows: AudienceRoleRow[] = [];
  const ids: string[] = [];
  ["111", "112", "113", "114", "115", "116", "117"].forEach((page, i) => {
    ids.push(`ebr-page-${i}`);
    rows.push({ meta_audience_id: `ebr-page-${i}`, meta_ad_account_id: BRISTOL_ACCOUNT, funnel_stage: "top_of_funnel", audience_subtype: "page_engagement_fb", retention_days: 365, source_id: page, status: "ready" });
    rows.push({ meta_audience_id: `nx-page-${i}`, meta_ad_account_id: NX_ACCOUNT, funnel_stage: "top_of_funnel", audience_subtype: "page_engagement_fb", retention_days: 365, source_id: page, status: "ready" });
  });
  ids.push("ebr-px-30");
  rows.push({ meta_audience_id: "ebr-px-30", meta_ad_account_id: BRISTOL_ACCOUNT, funnel_stage: "retargeting", audience_subtype: "website_pixel", retention_days: 30, source_id: BRISTOL_PIXEL, status: "ready" });
  rows.push({ meta_audience_id: "nx-px-30", meta_ad_account_id: NX_ACCOUNT, funnel_stage: "retargeting", audience_subtype: "website_pixel", retention_days: 30, source_id: NX_PIXEL, status: "ready" });
  ids.push("ebr-signups");
  rows.push({ meta_audience_id: "ebr-signups", meta_ad_account_id: BRISTOL_ACCOUNT, funnel_stage: "retargeting", audience_subtype: "website_pixel", retention_days: 180, source_id: BRISTOL_PIXEL, event_id: EBR27_GLITTERBOX.id, status: "ready" });
  rows.push({ meta_audience_id: "nx-signups", meta_ad_account_id: NX_ACCOUNT, funnel_stage: "retargeting", audience_subtype: "website_pixel", retention_days: 180, source_id: NX_PIXEL, event_id: NX27_GLITTERBOX.id, status: "ready" });
  ids.push("ebr-buyers", "ebr-video", "ebr-page-x");
  rows.push({ meta_audience_id: "ebr-buyers", meta_ad_account_id: BRISTOL_ACCOUNT, funnel_stage: "bottom_funnel", audience_subtype: "customer_list", retention_days: null, source_id: "upload-1", list_role: "buyers", status: "ready" });
  rows.push({ meta_audience_id: "ebr-video", meta_ad_account_id: BRISTOL_ACCOUNT, funnel_stage: "mid_funnel", audience_subtype: "video_views", retention_days: 30, source_id: GLITTERBOX_PAGE, status: "ready" });
  rows.push({ meta_audience_id: "ebr-page-x", meta_ad_account_id: BRISTOL_ACCOUNT, funnel_stage: "top_of_funnel", audience_subtype: "page_engagement_ig", retention_days: 365, source_id: "999", status: "ready" });
  return { ids, rows };
}

function replicateTo(event: ReplicateEvent, venue: ReplicateVenue) {
  const { ids, rows } = glitterboxAudiences();
  return replicateDraft(
    glitterboxSignup(ids),
    { event, venue },
    {
      sourceEvent: EBR27_GLITTERBOX,
      sourceVenue: BRISTOL_VENUE,
      audienceRows: rows,
      accountNames: ACCOUNT_NAMES,
      pageNames: { [GLITTERBOX_PAGE]: "Glitterbox Official" },
      now: NOW,
      id: `draft-${event.event_code}`,
    },
  );
}

export function replicateSummary(target: "nx" | "brixton") {
  const r = target === "nx" ? replicateTo(NX27_GLITTERBOX, NX_VENUE) : replicateTo(EBX27_GLITTERBOX, BRIXTON_VENUE);
  return { title: r.title, changesTitle: r.changesTitle, changes: r.changes, keptTitle: r.keptTitle, kept: r.kept, pages: r.pages };
}

/** RC-A's picker: the client's upcoming events, soonest first, the source marked. */
export const PICK_EVENTS = [
  { id: "ev-es27-davepearce", name: "Dave Pearce", code: "ES27-DAVEPEARCE", venue: "Electric Studios, Sheffield", eventDate: "2027-02-13", isSource: false },
  { id: "ev-ebr27-locklead", name: "Locklead", code: "EBR27-LOCKLEAD", venue: "Electric Bristol", eventDate: "2027-02-26", isSource: false },
  { id: EBR27_GLITTERBOX.id, name: "Glitterbox", code: "EBR27-GLITTERBOX", venue: "Electric Bristol", eventDate: "2027-02-27", isSource: true },
  { id: NX27_GLITTERBOX.id, name: "Glitterbox", code: "NX27-GLITTERBOX", venue: "NX Newcastle", eventDate: "2027-03-06", isSource: false },
];

// ─── RC-F2, RC-F-off, RC-G ───────────────────────────────────────────────

function adSets(prefix: string, names: string[], status: "live" | "paused" = "live") {
  return names.map((name, i) => ({ id: `${prefix}${String(i + 1).padStart(3, "0")}`, name, status }));
}

const SIGNUP_ADSETS = adSets("23810", ["Adv+ Broad", "Retargeting · page", "Similar pages", ...Array.from({ length: 15 }, (_, i) => `Signup ${i + 4}`)]);
const PURCHASE_ADSETS = adSets("23820", ["Adv+ Broad", "Retargeting · signups", "Similar pages", "Techno page engagers", "House interests", "Video viewers 50%"]);

/** Each campaign's group comes from stageOfCampaign (RC14), from its name and objective. */
function campaign(input: Omit<TreeCampaign, "stage">, objective: string): TreeCampaign {
  return { ...input, stage: stageOfCampaign({ name: input.name, draftObjective: objective }) };
}

export const TREE_CAMPAIGNS: TreeCampaign[] = [
  campaign({ metaCampaignId: "120253000000001", name: "[NX27-GLITTERBOX] SIGNUP", status: "live", adSets: SIGNUP_ADSETS, draftId: "draft-signup", adAccountId: NX_ACCOUNT }, "registration"),
  campaign({ metaCampaignId: "120253000000002", name: "[NX27-GLITTERBOX] PURCHASE", status: "live", adSets: PURCHASE_ADSETS, draftId: "draft-purchase", adAccountId: NX_ACCOUNT }, "purchase"),
  // RC10: no draft on this event made it.
  campaign({ metaCampaignId: "120253000000005", name: "[NX27-GLITTERBOX] ON SALE · RETARGET", status: "live", adSets: adSets("23850", ["Signups 180 days", "Page views 30 days"]), draftId: null, adAccountId: NX_ACCOUNT }, ""),
  // RC14: TRAFFIC and REACH are On sale's own campaigns, by name.
  campaign({ metaCampaignId: "120253000000003", name: "[NX27-GLITTERBOX] TRAFFIC", status: "live", adSets: adSets("23830", ["Broad", "Lookalike 1%"]), draftId: "draft-traffic", adAccountId: NX_ACCOUNT }, "traffic"),
  campaign({ metaCampaignId: "120253000000004", name: "[NX27-GLITTERBOX] REACH", status: "paused", adSets: adSets("23840", ["Newcastle 25 km"], "paused"), draftId: "draft-reach", adAccountId: NX_ACCOUNT }, "awareness"),
  // RC14: no stage word in the name, and an engagement objective decides nothing: Unsorted.
  campaign({ metaCampaignId: "120253000000006", name: "[NX27-GLITTERBOX] VIDEO VIEWS", status: "live", adSets: adSets("23860", ["Video 50% 30 days"]), draftId: "draft-video", adAccountId: NX_ACCOUNT }, "engagement"),
];

const ADDITIONS: TreeAdditionRow[] = [
  {
    id: "add-1",
    meta_campaign_id: "120253000000001",
    stage: "signup",
    kind: "creative",
    meta_adset_ids: SIGNUP_ADSETS.map((a) => a.id),
    detail: { creatives: 4, ads: 72, who: "Matas" },
    onsale_refresh_line_id: null,
    created_at: "2026-11-26T11:00:00Z",
  },
  {
    id: "add-2",
    meta_campaign_id: "120253000000001",
    stage: "signup",
    kind: "audience",
    meta_adset_ids: SIGNUP_ADSETS.slice(0, 1).map((a) => a.id),
    detail: { audienceName: "Techno page engagers", who: "Matas" },
    onsale_refresh_line_id: "00000000-0000-4000-8000-000000000001",
    created_at: "2026-11-27T11:00:00Z",
  },
  {
    id: "add-3",
    meta_campaign_id: "120253000000002",
    stage: "on_sale",
    kind: "creative",
    meta_adset_ids: PURCHASE_ADSETS.map((a) => a.id),
    detail: { creatives: 1, ads: 6, who: "Matas" },
    onsale_refresh_line_id: null,
    created_at: "2026-12-04T11:00:00Z",
  },
];

export function treeView(): TreeView {
  return buildCampaignTree({ campaigns: TREE_CAMPAIGNS, additions: ADDITIONS, eventCampaignIds: ["120253000000001"] });
}

export function onSaleSheet(): { campaigns: TreeCampaign[]; selection: TreeSelection } {
  const campaigns = stageSheetCampaigns(treeView(), "on_sale");
  return { campaigns, selection: defaultSelection(campaigns) };
}

/** RC-G: Techno page engagers onto Signup, two ad sets not added. */
export function signupAudienceSheet(): { campaigns: TreeCampaign[]; selection: TreeSelection; audiences: { id: string; name: string }[]; notAdded: NotAdded[] } {
  const campaigns = stageSheetCampaigns(treeView(), "signup");
  return {
    campaigns,
    selection: defaultSelection(campaigns),
    audiences: [{ id: "6000000000001", name: "Techno page engagers" }],
    notAdded: [
      { name: "Retargeting · page", kind: "refused" },
      { name: "Similar pages", kind: "failed" },
    ],
  };
}

/** RC-A's source row: the Bristol campaign the operator replicates. */
export function sourceTreeView(): TreeView {
  return buildCampaignTree({
    campaigns: [{ ...TREE_CAMPAIGNS[0]!, metaCampaignId: "120252700000000000", name: "[EBR27-GLITTERBOX] SIGNUP", adAccountId: BRISTOL_ACCOUNT }],
    additions: [],
    eventCampaignIds: ["120252700000000000"],
  });
}
