import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultCreative, createDefaultDraft } from "../../campaign-defaults.ts";
import type { AdSetSuggestion, CampaignDraft } from "../../types.ts";
import {
  accountDisplay,
  displayUrl,
  rebaseLink,
  replicateDraft,
  replicatedDraftLine,
  type AudienceRoleRow,
  type ReplicateEvent,
  type ReplicateVenue,
} from "../replicate.ts";

// Real account and pixel ids and names (scripts/seed-venue-meta-defaults.mts
// dry run and bm_ad_accounts.name, 24 Nov). Ruling 1: the dialog shows Meta's
// name with the venue in brackets, not RC-B's frame names.
const NX_ACCOUNT = "act_606252931141334";
const BRISTOL_ACCOUNT = "act_2011069725849568";
const SHEFFIELD_ACCOUNT = "act_1073273492854557";
const NX_PIXEL = "645185673672763";
const BRISTOL_PIXEL = "800268622344093";
const SHEFFIELD_PIXEL = "2261755947685271";
const SHEFFIELD_SKIDDLE_PIXEL = "1987031252241238";
const ACCOUNT_NAMES = { [NX_ACCOUNT]: "NX Promoter", [BRISTOL_ACCOUNT]: "Electric Bristol Live", [SHEFFIELD_ACCOUNT]: "ELECTRIC STUDIOS SHEFFIELD" };
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

const NX_VENUE: ReplicateVenue = { id: "venue-nx", name: "NX Newcastle", meta_ad_account_id: NX_ACCOUNT, meta_pixel_id: NX_PIXEL };
const BRISTOL_VENUE: ReplicateVenue = { id: "venue-ebr", name: "Electric Bristol", meta_ad_account_id: BRISTOL_ACCOUNT, meta_pixel_id: BRISTOL_PIXEL };
const SHEFFIELD_VENUE: ReplicateVenue = { id: "venue-es", name: "Electric Studios", meta_ad_account_id: SHEFFIELD_ACCOUNT, meta_pixel_id: SHEFFIELD_PIXEL };

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

/** [EBR27-GLITTERBOX] SIGNUP: 18 ad sets, 3 ads in each (54), 12 custom audiences. */
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
    metaCreativeId: `bristol-creative-${i}`,
    metaAdIds: [`bristol-ad-${i}`],
  }));
  draft.creativeAssignments = Object.fromEntries(
    draft.adSetSuggestions.map((s) => [s.id, draft.creatives.map((c) => c.id)]),
  );
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

/** Nine audiences that exist in both accounts by role, three in Bristol only. */
function glitterboxAudiences(): { ids: string[]; rows: AudienceRoleRow[] } {
  const pages = ["111", "112", "113", "114", "115", "116", "117"];
  const rows: AudienceRoleRow[] = [];
  const ids: string[] = [];
  pages.forEach((page, i) => {
    ids.push(`ebr-page-${i}`);
    rows.push({ meta_audience_id: `ebr-page-${i}`, meta_ad_account_id: BRISTOL_ACCOUNT, funnel_stage: "top_of_funnel", audience_subtype: "page_engagement_fb", retention_days: 365, source_id: page, status: "ready" });
    rows.push({ meta_audience_id: `nx-page-${i}`, meta_ad_account_id: "606252931141334", funnel_stage: "top_of_funnel", audience_subtype: "page_engagement_fb", retention_days: 365, source_id: page, status: "ready" });
  });
  // Pixel page views, client-wide, on each account's own pixel.
  ids.push("ebr-px-30");
  rows.push({ meta_audience_id: "ebr-px-30", meta_ad_account_id: BRISTOL_ACCOUNT, funnel_stage: "retargeting", audience_subtype: "website_pixel", retention_days: 30, source_id: BRISTOL_PIXEL, status: "ready" });
  rows.push({ meta_audience_id: "nx-px-30", meta_ad_account_id: NX_ACCOUNT, funnel_stage: "retargeting", audience_subtype: "website_pixel", retention_days: 30, source_id: NX_PIXEL, status: "ready" });
  // This show's signups: the source's for EBR27, the target's for NX27.
  ids.push("ebr-signups");
  rows.push({ meta_audience_id: "ebr-signups", meta_ad_account_id: BRISTOL_ACCOUNT, funnel_stage: "retargeting", audience_subtype: "website_pixel", retention_days: 180, source_id: BRISTOL_PIXEL, event_id: EBR27_GLITTERBOX.id, status: "ready" });
  rows.push({ meta_audience_id: "nx-signups", meta_ad_account_id: NX_ACCOUNT, funnel_stage: "retargeting", audience_subtype: "website_pixel", retention_days: 180, source_id: NX_PIXEL, event_id: NX27_GLITTERBOX.id, status: "ready" });
  // Bristol only: a buyers list, video viewers, and one more page.
  ids.push("ebr-buyers", "ebr-video", "ebr-page-x");
  rows.push({ meta_audience_id: "ebr-buyers", meta_ad_account_id: BRISTOL_ACCOUNT, funnel_stage: "bottom_funnel", audience_subtype: "customer_list", retention_days: null, source_id: "upload-1", list_role: "buyers", status: "ready" });
  rows.push({ meta_audience_id: "ebr-video", meta_ad_account_id: BRISTOL_ACCOUNT, funnel_stage: "mid_funnel", audience_subtype: "video_views", retention_days: 30, source_id: GLITTERBOX_PAGE, status: "ready" });
  rows.push({ meta_audience_id: "ebr-page-x", meta_ad_account_id: BRISTOL_ACCOUNT, funnel_stage: "top_of_funnel", audience_subtype: "page_engagement_ig", retention_days: 365, source_id: "999", status: "ready" });
  // Same role in NX, but failed: not usable.
  rows.push({ meta_audience_id: "nx-page-x-failed", meta_ad_account_id: NX_ACCOUNT, funnel_stage: "top_of_funnel", audience_subtype: "page_engagement_ig", retention_days: 365, source_id: "999", status: "failed" });
  return { ids, rows };
}

function replicateGlitterbox() {
  const { ids, rows } = glitterboxAudiences();
  const source = glitterboxSignup(ids);
  const before = JSON.stringify(source);
  const result = replicateDraft(
    source,
    { event: NX27_GLITTERBOX, venue: NX_VENUE },
    {
      sourceEvent: EBR27_GLITTERBOX,
      sourceVenue: BRISTOL_VENUE,
      audienceRows: rows,
      accountNames: ACCOUNT_NAMES,
      pageNames: { [GLITTERBOX_PAGE]: "Glitterbox Official" },
      now: NOW,
      id: "draft-nx27-signup",
    },
  );
  return { source, before, result };
}

describe("replicateDraft: Glitterbox EBR27 → NX27 (RC-B)", () => {
  it("renders the change rows as RC-B shows them, with ruling 1's account names", () => {
    const { result } = replicateGlitterbox();
    assert.equal(result.title, "Replicate [EBR27-GLITTERBOX] SIGNUP to NX27-GLITTERBOX");
    assert.equal(result.changesTitle, "Changes to match NX27-GLITTERBOX");
    assert.deepEqual(
      result.changes.map((c) => [c.label, c.text]),
      [
        ["Event", "NX27-GLITTERBOX · NX Newcastle (was EBR27-GLITTERBOX)"],
        ["Name", "[NX27-GLITTERBOX] SIGNUP (was [EBR27-GLITTERBOX] SIGNUP)"],
        ["Account", "Account: NX Promoter (NX Newcastle) (was Electric Bristol Live (Electric Bristol))"],
        ["Pixel", "Pixel …2763 (was …4093)"],
        ["Link", "Link: crqln.com/l/glitterbox-newcastle · 54 ads (was crqln.com/l/glitterbox-bristol)"],
        ["Dates", "Starts Thu 26 Nov · ends at On sale (was Mon 23 Nov)"],
        // RC-B's Copy row is R8's (caption templates): not re-rendered here.
        ["Audiences", "9 found in NX Promoter (NX Newcastle) · 3 will be created"],
      ],
    );
    assert.equal(result.keptTitle, "Kept from the source");
    assert.equal(result.kept, "Objective, 18 ad sets, budgets, placements, interests.");
    assert.deepEqual(
      result.pages.map((p) => [p.question, p.keep, p.change]),
      [["Ads run from Glitterbox Official: keep or change", "Keep Glitterbox Official", "Change"]],
    );
  });

  it("carries each row's word key and fill-ins", () => {
    const { result } = replicateGlitterbox();
    const byField = Object.fromEntries(result.changes.map((c) => [c.field, c]));
    assert.equal(byField.account!.key, "replicate.change.account");
    assert.deepEqual(byField.account!.fill, { "account name": "NX Promoter (NX Newcastle)" });
    assert.equal(byField.pixel!.key, "replicate.change.pixel");
    assert.deepEqual(byField.pixel!.fill, { "last 4": "2763" });
    assert.equal(byField.link!.key, "replicate.change.link");
    assert.deepEqual(byField.link!.fill, { url: "crqln.com/l/glitterbox-newcastle", n: 54 });
    assert.equal(byField.audiences!.key, "replicate.change.audiences");
    assert.deepEqual(byField.audiences!.fill, { n: 9, account: "NX Promoter (NX Newcastle)", m: 3 });
    assert.ok(result.changes.every((c) => c.tone === "change"));
  });

  it("changes account, pixel and code in the draft, never carrying Bristol's", () => {
    const { result } = replicateGlitterbox();
    const s = result.draft.settings;
    assert.equal(s.eventId, NX27_GLITTERBOX.id);
    assert.equal(s.campaignCode, "NX27-GLITTERBOX");
    assert.equal(s.campaignName, "[NX27-GLITTERBOX] SIGNUP");
    assert.equal(s.adAccountId, NX_ACCOUNT);
    assert.equal(s.metaAdAccountId, NX_ACCOUNT);
    assert.equal(s.pixelId, NX_PIXEL);
    assert.equal(s.metaPixelId, NX_PIXEL);
    const rest: Record<string, unknown> = { ...result.draft };
    delete rest.replicatedFrom;
    const json = JSON.stringify(rest);
    for (const bristol of ["2011069725849568", BRISTOL_PIXEL, "glitterbox-bristol", "EBR27", "ebr-"]) {
      assert.equal(json.includes(bristol), false, bristol);
    }
    for (const c of result.draft.creatives) {
      assert.equal(c.destinationUrl, "https://crqln.com/l/glitterbox-newcastle?utm_source=meta&utm_medium=paid&utm_campaign=NX27-GLITTERBOX");
      assert.equal(c.metaCreativeId, undefined);
      assert.equal(c.metaAdIds, undefined);
    }
  });

  it("saves as a new, unlaunched draft and leaves the source alone", () => {
    const { source, before, result } = replicateGlitterbox();
    assert.equal(JSON.stringify(source), before);
    assert.equal(result.draft.id, "draft-nx27-signup");
    assert.equal(result.draft.status, "draft");
    assert.equal(result.draft.metaCampaignId, undefined);
    assert.equal(result.draft.launchSummary, undefined);
    assert.equal(result.draft.settings.wizardMode, "new");
    assert.deepEqual(result.draft.replicatedFrom.sourceDraftId, "draft-ebr27-signup");
    assert.equal(
      replicatedDraftLine(result.draft.replicatedFrom),
      "Replicated from [EBR27-GLITTERBOX] SIGNUP, Thu 26 Nov. Launch runs the checks first.",
    );
  });

  it("re-derives the dates from the target: start now, end at NX27's on-sale", () => {
    const { result } = replicateGlitterbox();
    assert.equal(result.draft.budgetSchedule.startDate, "2026-11-26T09:00");
    assert.equal(result.draft.budgetSchedule.endDate, "2026-11-27T14:00");
    assert.equal(result.draft.budgetSchedule.endDatePhase, "general_sale");
  });

  it("keeps the structure: objective, ad sets, budgets, interests", () => {
    const { source, result } = replicateGlitterbox();
    assert.equal(result.draft.settings.objective, "registration");
    assert.deepEqual(result.draft.adSetSuggestions, source.adSetSuggestions);
    assert.deepEqual(result.draft.audiences.interestGroups, source.audiences.interestGroups);
    assert.equal(result.draft.budgetSchedule.budgetAmount, source.budgetSchedule.budgetAmount);
  });
});

describe("replicateDraft: audiences by role", () => {
  it("resolves a role found in the target account and holds back one to be created", () => {
    const { result } = replicateGlitterbox();
    const found = new Map(result.audiences.found.map((f) => [f.sourceId, f.targetId]));
    assert.equal(found.get("ebr-page-0"), "nx-page-0");
    assert.equal(found.get("ebr-px-30"), "nx-px-30");
    // The source show's signups become the target show's, never another show's.
    assert.equal(found.get("ebr-signups"), "nx-signups");
    assert.deepEqual(result.audiences.toCreate.map((t) => t.sourceId).sort(), ["ebr-buyers", "ebr-page-x", "ebr-video"]);
    const targeted = result.draft.audiences.customAudienceGroups[0]!.audienceIds;
    assert.equal(targeted.length, 9);
    assert.ok(targeted.every((id) => id.startsWith("nx-")));
    assert.deepEqual(
      result.draft.replicatedFrom.audiencesToCreate.map((t) => t.sourceId).sort(),
      ["ebr-buyers", "ebr-page-x", "ebr-video"],
    );
  });

  it("leaves an audience with no role out of targeting in another account", () => {
    const source = glitterboxSignup(["ebr-page-0", "hand-picked-123"]);
    const { rows } = glitterboxAudiences();
    const result = replicateDraft(source, { event: NX27_GLITTERBOX, venue: NX_VENUE }, { sourceEvent: EBR27_GLITTERBOX, audienceRows: rows, accountNames: ACCOUNT_NAMES, now: NOW, id: "x" });
    assert.deepEqual(result.draft.audiences.customAudienceGroups[0]!.audienceIds, ["nx-page-0"]);
    assert.deepEqual(result.audiences.unmapped, ["hand-picked-123"]);
  });
});

describe("replicateDraft: Paul Van Dyk → Dave Pearce", () => {
  const PVD: ReplicateEvent = {
    id: "event-nx27-pvd",
    event_code: "NX27-PAULVANDYK",
    client_id: "client-electric",
    venue_name: "NX Newcastle",
    event_date: "2027-02-20",
    signup_url: "https://paulvandyk-newcastle.com/",
    meta_ad_account_id: "606252931141334",
  };
  const DAVE_PEARCE: ReplicateEvent = {
    id: "event-es27-davepearce",
    event_code: "ES27-DAVEPEARCE",
    client_id: "client-electric",
    venue_name: "Electric Studios",
    venue_city: "Sheffield",
    event_date: "2027-02-13",
    general_sale_at: "2026-11-25T10:00:00Z",
    signup_url: "https://crqln.com/l/davepearce-sheffield",
    meta_ad_account_id: "1073273492854557",
  };

  it("points every ad at crqln.com/l/davepearce-sheffield", () => {
    const source = glitterboxSignup([]);
    source.settings = { ...source.settings, eventId: PVD.id, campaignCode: "NX27-PAULVANDYK", campaignName: "[NX27-PAULVANDYK] SIGNUP", adAccountId: NX_ACCOUNT, metaAdAccountId: NX_ACCOUNT, pixelId: NX_PIXEL, metaPixelId: NX_PIXEL };
    source.creatives = source.creatives.map((c) => ({ ...c, destinationUrl: "https://paulvandyk-newcastle.com/?utm_source=meta&utm_campaign=nx27-paulvandyk" }));
    const result = replicateDraft(source, { event: DAVE_PEARCE, venue: SHEFFIELD_VENUE }, { sourceEvent: PVD, accountNames: ACCOUNT_NAMES, now: NOW, id: "x" });
    for (const c of result.draft.creatives) {
      assert.equal(c.destinationUrl, "https://crqln.com/l/davepearce-sheffield?utm_source=meta&utm_campaign=es27-davepearce");
    }
    assert.doesNotMatch(JSON.stringify(result.draft.creatives), /paulvandyk/i);
    const link = result.changes.find((c) => c.field === "link")!;
    assert.equal(link.text, "Link: crqln.com/l/davepearce-sheffield · 54 ads (was paulvandyk-newcastle.com)");
    assert.equal(result.draft.settings.campaignName, "[ES27-DAVEPEARCE] SIGNUP");
  });
});

describe("replicateDraft: the event's pixel override (Sheffield Skiddle)", () => {
  it("takes the event's pixel over the venue's", () => {
    const LPRHYTHM: ReplicateEvent = { id: "event-es27-lprhythm", event_code: "ES27-LPRHYTHM", client_id: "client-electric", venue_name: "Electric Studios", event_date: "2027-01-30", signup_url: "https://crqln.com/l/lprhythm", meta_ad_account_id: "1073273492854557" };
    const SKIDDLE_SHOW: ReplicateEvent = { id: "event-es27-skiddle", event_code: "ES27-DAVEPEARCE", client_id: "client-electric", venue_name: "Electric Studios", event_date: "2027-02-13", signup_url: "https://crqln.com/l/davepearce-sheffield", meta_ad_account_id: "1073273492854557", meta_pixel_id: SHEFFIELD_SKIDDLE_PIXEL };
    const source = glitterboxSignup([]);
    source.settings = { ...source.settings, eventId: LPRHYTHM.id, campaignCode: "ES27-LPRHYTHM", campaignName: "[ES27-LPRHYTHM] SIGNUP", adAccountId: SHEFFIELD_ACCOUNT, metaAdAccountId: SHEFFIELD_ACCOUNT, pixelId: SHEFFIELD_PIXEL, metaPixelId: SHEFFIELD_PIXEL };
    const result = replicateDraft(source, { event: SKIDDLE_SHOW, venue: SHEFFIELD_VENUE }, { sourceEvent: LPRHYTHM, accountNames: ACCOUNT_NAMES, now: NOW, id: "x" });
    assert.equal(result.draft.settings.metaPixelId, SHEFFIELD_SKIDDLE_PIXEL);
    assert.equal(result.draft.settings.pixelId, SHEFFIELD_SKIDDLE_PIXEL);
    assert.equal(result.changes.find((c) => c.field === "pixel")!.text, "Pixel …1238 (was …5271)");
    // Same account as the source: no Account row.
    assert.equal(result.changes.some((c) => c.field === "account"), false);
  });

  it("a dialog override wins over the event's column", () => {
    const source = glitterboxSignup([]);
    const result = replicateDraft(source, { event: NX27_GLITTERBOX, venue: NX_VENUE, eventOverrides: { metaPixelId: "1283861880364565" } }, { sourceEvent: EBR27_GLITTERBOX, now: NOW, id: "x" });
    assert.equal(result.draft.settings.metaPixelId, "1283861880364565");
  });
});

describe("replicateDraft: the page is kept and asked about", () => {
  it("keeps the page and IG on every ad and asks once per page", () => {
    const { source, result } = replicateGlitterbox();
    assert.deepEqual(result.draft.creatives.map((c) => c.identity), source.creatives.map((c) => c.identity));
    assert.equal(result.draft.settings.metaPageId, GLITTERBOX_PAGE);
    assert.equal(result.pages.length, 1);
    assert.equal(result.pages[0]!.pageId, GLITTERBOX_PAGE);
    assert.equal(result.pages[0]!.ads, 54);
  });

  it("names the page by its id when no name is known", () => {
    const source = glitterboxSignup([]);
    const result = replicateDraft(source, { event: NX27_GLITTERBOX, venue: NX_VENUE }, { sourceEvent: EBR27_GLITTERBOX, now: NOW, id: "x" });
    assert.equal(result.pages[0]!.question, `Ads run from ${GLITTERBOX_PAGE}: keep or change`);
  });
});

describe("replicateDraft: a venue with no values", () => {
  it("marks account and pixel 'not set, check' and empties them", () => {
    const BRIXTON_SHOW: ReplicateEvent = { id: "event-brixton", event_code: "EBX27-TEST", client_id: "client-electric", venue_name: "Electric Brixton", event_date: "2027-03-01", signup_url: "https://crqln.com/l/test-brixton" };
    const BRIXTON: ReplicateVenue = { id: "venue-ebx", name: "Electric Brixton", meta_ad_account_id: null, meta_pixel_id: null };
    const source = glitterboxSignup([]);
    const result = replicateDraft(source, { event: BRIXTON_SHOW, venue: BRIXTON }, { sourceEvent: EBR27_GLITTERBOX, accountNames: ACCOUNT_NAMES, now: NOW, id: "x" });
    const amber = result.changes.filter((c) => c.tone === "not_set");
    assert.deepEqual(amber.map((c) => c.text), [
      "Account: not set for Electric Brixton, check",
      "Pixel: not set for Electric Brixton, check",
    ]);
    assert.ok(amber.every((c) => c.key === "replicate.change.not_set"));
    assert.deepEqual(amber[1]!.fill, { Field: "Pixel", venue: "Electric Brixton" });
    assert.equal(result.draft.settings.adAccountId, "");
    assert.equal(result.draft.settings.metaAdAccountId, undefined);
    assert.equal(result.draft.settings.pixelId, "");
    assert.equal(result.draft.settings.metaPixelId, undefined);
  });

  it("with no venue row at all, names the event's venue", () => {
    const event: ReplicateEvent = { ...NX27_GLITTERBOX, meta_ad_account_id: null };
    const result = replicateDraft(glitterboxSignup([]), { event, venue: null }, { sourceEvent: EBR27_GLITTERBOX, now: NOW, id: "x" });
    assert.deepEqual(
      result.changes.filter((c) => c.tone === "not_set").map((c) => c.text),
      ["Account: not set for NX Newcastle, check", "Pixel: not set for NX Newcastle, check"],
    );
  });
});

describe("accountDisplay (ruling 1)", () => {
  it("names the account by Meta's name, then the venue in brackets", () => {
    assert.equal(accountDisplay("NX Promoter", "NX Newcastle"), "NX Promoter (NX Newcastle)");
    assert.equal(accountDisplay("act_606252931141334", null), "act_606252931141334");
  });

  it("falls back to the id when Meta's name isn't known, keeping the venue", () => {
    const result = replicateDraft(glitterboxSignup([]), { event: NX27_GLITTERBOX, venue: NX_VENUE }, { sourceEvent: EBR27_GLITTERBOX, now: NOW, id: "x" });
    assert.equal(result.changes.find((c) => c.field === "account")!.text, `Account: ${NX_ACCOUNT} (NX Newcastle) (was ${BRISTOL_ACCOUNT} (Electric Bristol))`);
  });
});

describe("links", () => {
  it("shows a link without scheme, query or trailing slash", () => {
    assert.equal(displayUrl("https://www.paulvandyk-newcastle.com/?utm_source=x"), "paulvandyk-newcastle.com");
    assert.equal(displayUrl("https://crqln.com/l/glitterbox-newcastle/"), "crqln.com/l/glitterbox-newcastle");
  });

  it("keeps the source's UTM tags and swaps the code and slug in them", () => {
    assert.equal(
      rebaseLink(
        "https://crqln.com/l/glitterbox-bristol?utm_campaign=EBR27-GLITTERBOX&utm_content=glitterbox-bristol&fbclid=1",
        "https://crqln.com/l/glitterbox-newcastle?utm_source=cirqlin",
        { fromCode: "EBR27-GLITTERBOX", toCode: "NX27-GLITTERBOX", fromSlug: "glitterbox-bristol", toSlug: "glitterbox-newcastle" },
      ),
      "https://crqln.com/l/glitterbox-newcastle?utm_source=cirqlin&utm_campaign=NX27-GLITTERBOX&utm_content=glitterbox-newcastle",
    );
  });
});
