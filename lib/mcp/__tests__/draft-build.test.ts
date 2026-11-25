/**
 * M2b draft tools: each one's happy path on the fixture draft, the
 * refusals every write shares (published, archived, someone else's,
 * changed since read), the £8 floor, the objective knock-ons against the
 * Campaign step's own change, merging dedupes, identity on every ad, the
 * template apply, and no network: a global fetch spy fails the test on any
 * request (the tools' only reaches out are the deps' spies).
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultCreative } from "../../campaign-defaults.ts";
import type { AdSetSuggestion, AudienceSettings, CampaignDraft } from "../../types.ts";
import { generateSuggestions } from "../../wizard/generate-adset-suggestions.ts";
import { UK_NATIONWIDE_FALLBACK } from "../../wizard/adset-suggestions.ts";
import { objectiveChangePatch, suggestCampaignName } from "../../wizard/objective-change.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { setDraftAudiencesTool } from "../tools/draft-audiences.ts";
import {
  AD_SET_FLOOR_GBP,
  duplicateDraftTool,
  removeDraftCreativesTool,
  setDraftAdSetsTool,
  setDraftCopyTool,
  setDraftIdentityTool,
  setDraftObjectiveTool,
  setDraftScheduleTool,
} from "../tools/draft-build.ts";
import { applyAudienceTemplateTool } from "../tools/draft-edit.ts";
import { APPLY_WORDS } from "../drafts/templates.ts";
import { CLIENT_NX } from "./fixtures.ts";
import { D_ARCH, D_DRAFT, D_PUB, D_STAFF, EL_IG, EL_PAGE, NX_ACCOUNT, NX_IG, NX_PAGE, UPDATED, draftCtx, readRow } from "./draft-fixtures.ts";
import { OPERATOR } from "./helpers.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── No network: any fetch during a tool run fails the test. ─────────────────
let fetchCalls: string[] = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = (async (input: unknown) => {
    fetchCalls.push(String(input));
    throw new Error("network is off in tests");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  assert.deepEqual(fetchCalls, [], "no fetch from any draft tool");
});

type Out = { data: Record<string, unknown>; summary: Record<string, unknown> };
const run = async (tool: McpTool, ctx: ToolContext, args: Record<string, unknown>) => (await tool.run(ctx, { draft_id: D_DRAFT, updated_at: UPDATED, ...args })) as Out;

async function refused(p: Promise<unknown>, re: RegExp): Promise<ToolInputError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ToolInputError, `expected a refusal, got ${String(e)}`);
    assert.match(e.message, re);
    return e;
  }
  assert.fail(`expected a refusal matching ${re}`);
}

type Db = ReturnType<typeof draftCtx>["db"];
const draftWrites = (db: Db) => db.writes.filter((w) => w.table === "campaign_drafts");

/** Edit the fixture draft's json in place (updated_at unchanged), as a setup step. */
async function shape(db: Db, edit: (d: CampaignDraft) => CampaignDraft) {
  const row = (await readRow(db, D_DRAFT))!;
  await db.from("campaign_drafts").update({ draft_json: edit(structuredClone(row.draft_json as CampaignDraft)) }).eq("id", D_DRAFT).select("id");
  db.writes.length = 0;
}
const saved = async (db: Db) => (await readRow(db, D_DRAFT))!.draft_json as CampaignDraft;

const AUDIENCES: AudienceSettings = {
  pageGroups: [
    { id: "pg-tech", name: "Tech House pages", pageIds: ["111", "112"], engagementTypes: ["fb_likes"], lookalike: false, lookalikeRanges: [], customAudienceIds: [] },
    { id: "pg-disco", name: "Disco pages", pageIds: ["121"], engagementTypes: ["fb_likes"], lookalike: false, lookalikeRanges: [], customAudienceIds: [] },
    { id: "pg-other", name: "Other client's pages", pageIds: ["131"], engagementTypes: ["fb_likes"], lookalike: false, lookalikeRanges: [], customAudienceIds: [] },
  ],
  customAudienceGroups: [],
  savedAudiences: { audienceIds: [] },
  interestGroups: [
    { id: "ig-a", name: "House", interests: [{ id: "6003000000101", name: "House music" }, { id: "6003000000102", name: "Defected" }] },
    { id: "ig-b", name: "House 2", interests: [{ id: "6003000000102", name: "Defected" }, { id: "6003000000103", name: "Glitterbox" }] },
    { id: "ig-c", name: "Fashion", interests: [{ id: "6003000000201", name: "Streetwear" }] },
  ],
  selectedPagesLookalikeGroups: [],
};

/** The draft with groups and Generate's ad sets (each £5 a day). */
async function withAudiences(db: Db) {
  await shape(db, (d) => {
    const rows = generateSuggestions(AUDIENCES, 0, d.budgetSchedule.locationGroups ?? [], UK_NATIONWIDE_FALLBACK).map((r) => ({ ...r, budgetPerDay: 5 }));
    return { ...d, audiences: AUDIENCES, adSetSuggestions: [...d.adSetSuggestions, ...rows], creativeAssignments: Object.fromEntries(rows.map((r) => [r.id, ["cr-1", "cr-2"]])) };
  });
}

// ── The refusals every M2b write shares ─────────────────────────────────────

const WRITES: Array<[McpTool, Record<string, unknown>]> = [
  [setDraftObjectiveTool, { objective: "purchase" }],
  [setDraftAdSetsTool, { changes: [{ ad_set_id: "as-1", budget_per_day: 9 }] }],
  [setDraftAudiencesTool, { changes: [{ add_interests: { new_group_name: "Disco", interests: [{ search: "Disco" }] } }] }],
  [setDraftIdentityTool, { page_id: EL_PAGE }],
  [setDraftCopyTool, { headline: "Glitterbox Newcastle" }],
  [removeDraftCreativesTool, { creative_ids: ["cr-1"] }],
  [setDraftScheduleTool, { start: "2026-12-01", end: "2026-12-14" }],
  [applyAudienceTemplateTool, { template: "Techno" }],
];

test("every M2b write refuses a published, archived or someone else's draft, and a stale updated_at, writing nothing", async () => {
  for (const [tool, args] of WRITES) {
    for (const [id, re, why] of [
      [D_PUB, /is published/, "not_draft"],
      [D_ARCH, /is archived/, "not_draft"],
      [D_STAFF, /belongs to another account/, "not_owner"],
    ] as const) {
      const { ctx, db } = draftCtx();
      const e = await refused(tool.run(ctx, { draft_id: id, updated_at: UPDATED, ...args }), re);
      assert.equal(e.summary?.refused, why, `${tool.name} ${id}`);
      assert.deepEqual(draftWrites(db), [], tool.name);
    }
    const { ctx, db } = draftCtx();
    const e = await refused(tool.run(ctx, { draft_id: D_DRAFT, updated_at: "2026-11-24T08:00:00.000+00:00", ...args }), /changed since you read it/);
    assert.equal(e.summary?.refused, "changed_since_read", tool.name);
    assert.deepEqual(draftWrites(db), [], tool.name);
  }
});

test("a write that lost the race to another save is refused, not written blind", async () => {
  const { ctx, db } = draftCtx();
  // Someone saves between the read and the guarded update: the update finds no row.
  const original = db.from.bind(db);
  let reads = 0;
  (db as unknown as { from: typeof db.from }).from = ((t: string) => {
    const q = original(t);
    // The fake runs a query when it is awaited: then() runs it now.
    if (t === "campaign_drafts" && ++reads === 2) void original("campaign_drafts").update({ updated_at: "2026-11-24T08:59:00.000+00:00" }).eq("id", D_DRAFT).select("id").then(() => undefined);
    return q;
  }) as typeof db.from;
  await refused(run(setDraftScheduleTool, ctx, { start: "2026-12-01", end: "2026-12-14" }), /changed since you read it/);
  assert.equal(((await readRow(db, D_DRAFT))!.draft_json as CampaignDraft).budgetSchedule.startDate, "2026-11-01T10:00");
});

// ── set_draft_objective ─────────────────────────────────────────────────────

test("set_draft_objective: the Campaign step's change: goal, suggested name, pixel event, rules stamp", async () => {
  const { ctx, db } = draftCtx();
  await shape(db, (d) => ({ ...d, settings: { ...d.settings, objective: "traffic", optimisationGoal: "landing_page_views", campaignName: suggestCampaignName("NX27-GLITTERBOX", "traffic") } }));
  const before = await saved(db);
  const out = await run(setDraftObjectiveTool, ctx, { objective: "registration" });
  const after = await saved(db);
  // The same settings the objective cards make.
  const patch = objectiveChangePatch(before.settings, "registration");
  for (const [k, v] of Object.entries(patch)) assert.equal((after.settings as unknown as Record<string, unknown>)[k], v, k);
  for (const [k, v] of Object.entries(before.settings)) if (!(k in patch)) assert.deepEqual((after.settings as unknown as Record<string, unknown>)[k], v, k);
  assert.equal(after.settings.optimisationGoal, "conversions");
  assert.equal(after.settings.campaignName, "[NX27-GLITTERBOX] Registration");
  assert.equal(out.data.promotedEvent, "COMPLETE_REGISTRATION");
  assert.equal(out.data.nameFollowed, true);
  assert.equal((await readRow(db, D_DRAFT))!.objective, "registration");
  assert.deepEqual((out.summary.after as Record<string, unknown>).promotedEvent, "COMPLETE_REGISTRATION");
});

test("set_draft_objective: a hand-edited name is kept; awareness clears Advantage+ as the Budget step does", async () => {
  const { ctx, db } = draftCtx();
  await shape(db, (d) => ({ ...d, adSetSuggestions: d.adSetSuggestions.map((r) => ({ ...r, advantagePlus: true })) }));
  const out = await run(setDraftObjectiveTool, ctx, { objective: "awareness" });
  const after = await saved(db);
  assert.equal(after.settings.campaignName, "[NX27-GLITTERBOX] SIGNUP");
  assert.equal(after.settings.optimisationGoal, "reach");
  assert.equal(out.data.advantagePlusCleared, 2);
  assert.ok(after.adSetSuggestions.every((r) => !r.advantagePlus));
  assert.match(String(out.data.promotedEvent), /^none/);
});

// ── set_draft_ad_sets ───────────────────────────────────────────────────────

test("set_draft_ad_sets: enable, budget, rename, ages, Advantage+, add_broad blank and with suggestions, assign_all", async () => {
  const { ctx, db } = draftCtx();
  await withAudiences(db);
  const rows = (await saved(db)).adSetSuggestions.filter((r) => r.sourceType !== "blank");
  const ids = rows.map((r) => r.id);
  const changes = [
    ...ids.slice(0, 5).map((id) => ({ ad_set_id: id, budget_per_day: 9 })),
    ...ids.slice(5).map((id) => ({ ad_set_id: id, enabled: false })),
    { ad_set_id: "as-1", enabled: false },
    { ad_set_id: "as-2", enabled: false },
    { ad_set_id: ids[0], name: "Tech house fans", age_min: 21, age_max: 40, advantage_plus: true },
    { add_broad: {}, name: "Broad", budget_per_day: 15 },
    { add_broad: { suggestion_group_id: "pg-tech" }, budget_per_day: 10 },
  ];
  const out = await run(setDraftAdSetsTool, ctx, { changes, assign_all: true });
  const after = await saved(db);
  const enabled = after.adSetSuggestions.filter((r) => r.enabled);
  assert.deepEqual(enabled.map((r) => r.budgetPerDay), [9, 9, 9, 9, 9, 15, 10]);
  const first = after.adSetSuggestions.find((r) => r.id === ids[0])!;
  assert.deepEqual([first.name, first.nameSource, first.ageMin, first.ageMax, first.advantagePlus], ["Tech house fans", "operator", 21, 40, true]);
  const [blank, broad] = after.adSetSuggestions.slice(-2) as [AdSetSuggestion, AdSetSuggestion];
  assert.deepEqual([blank.sourceType, blank.advantagePlus, blank.name], ["blank", true, "Broad"]);
  assert.deepEqual([broad.sourceType, broad.sourceId, broad.advantagePlus, broad.name], ["page_group", "pg-tech", true, "Broad + Tech House pages"]);
  // Broad rows target the draft's locations.
  assert.deepEqual(blank.locationGroupIds, ["g1"]);
  // Assign all: every ad in every enabled ad set, none in a disabled one.
  for (const r of enabled) assert.deepEqual(after.creativeAssignments[r.id], ["cr-1", "cr-2"]);
  assert.equal(after.creativeAssignments[ids[5]!], undefined);
  assert.equal(out.data.totalPerDayGbp, 70);
  assert.deepEqual(out.data.assignments, { adSets: 7, withAds: 7 });
  assert.equal(out.data.floorOverride, null);
});

test(`set_draft_ad_sets: an enabled ad set under £${AD_SET_FLOOR_GBP} a day is refused; override needs a reason, which is logged and returned`, async () => {
  const { ctx, db } = draftCtx();
  const e = await refused(run(setDraftAdSetsTool, ctx, { changes: [{ ad_set_id: "as-1", budget_per_day: 5 }] }), /1 enabled ad set is under £8 a day: Broad £5\.00/);
  assert.equal(e.summary?.refused, "under_floor");
  assert.deepEqual(draftWrites(db), []);
  // Disabled ad sets don't count.
  await run(setDraftAdSetsTool, ctx, { changes: [{ ad_set_id: "as-1", budget_per_day: 5, enabled: false }] });
  const fresh = draftCtx();
  await refused(run(setDraftAdSetsTool, fresh.ctx, { changes: [{ ad_set_id: "as-2", budget_per_day: 4 }], override: true }), /needs override_reason/);
  const out = await run(setDraftAdSetsTool, fresh.ctx, { changes: [{ ad_set_id: "as-2", budget_per_day: 4 }], override: true, override_reason: "Retargeting pool of 900 people; £4 spends it." });
  const logged = out.summary.floorOverride as { reason: string; adSets: Array<{ id: string; perDay: number }> };
  assert.equal(logged.reason, "Retargeting pool of 900 people; £4 spends it.");
  assert.deepEqual(logged.adSets.map((a) => [a.id, a.perDay]), [["as-2", 4]]);
  assert.deepEqual(out.data.floorOverride, out.summary.floorOverride);
});

test("set_draft_ad_sets: lifetime drafts take budget_lifetime and check the floor per day over the schedule; refusals save nothing", async () => {
  const { ctx, db } = draftCtx();
  await shape(db, (d) => ({ ...d, budgetSchedule: { ...d.budgetSchedule, budgetType: "lifetime", startDate: "2026-12-01T00:00", endDate: "2026-12-10T23:59" }, adSetSuggestions: d.adSetSuggestions.map((r) => ({ ...r, budgetPerDay: 0, budgetLifetime: 200 })) }));
  await refused(run(setDraftAdSetsTool, ctx, { changes: [{ ad_set_id: "as-1", budget_per_day: 9 }] }), /budget is lifetime/);
  await refused(run(setDraftAdSetsTool, ctx, { changes: [{ ad_set_id: "as-1", budget_lifetime: 50 }] }), /under £8 a day: Broad £5\.00/);
  await refused(run(setDraftAdSetsTool, ctx, { changes: [{ ad_set_id: "nope", enabled: false }] }), /no ad set nope/);
  await refused(run(setDraftAdSetsTool, ctx, { changes: [{ ad_set_id: "as-1", age_min: 50, age_max: 30 }] }), /age_min \(50\) is above age_max \(30\)/);
  await refused(run(setDraftAdSetsTool, ctx, { changes: [{ ad_set_id: "as-1", advantage_plus: false }] }), /always runs Advantage\+/);
  assert.deepEqual(draftWrites(db), []);
  const out = await run(setDraftAdSetsTool, ctx, { changes: [{ ad_set_id: "as-1", budget_lifetime: 90 }] });
  assert.equal((out.data.adSets as Array<{ id: string; perDayGbp: number }>).find((a) => a.id === "as-1")!.perDayGbp, 9);
});

// ── set_draft_audiences ─────────────────────────────────────────────────────

test("set_draft_audiences: remove, merge (deduped), add interests by search, add a recorded custom audience; ad sets follow", async () => {
  const { ctx, db, spies } = draftCtx();
  await withAudiences(db);
  const rows0 = (await saved(db)).adSetSuggestions;
  const igA = rows0.find((r) => r.sourceId === "ig-a")!;
  await shape(db, (d) => ({ ...d, adSetSuggestions: d.adSetSuggestions.map((r) => (r.id === igA.id ? { ...r, budgetPerDay: 11, name: "House fans", nameSource: "operator" } : r)) }));
  const tables = db as unknown as { from(t: string): { insert(r: unknown): { select(): PromiseLike<unknown> } } };
  await tables.from("meta_custom_audiences").insert({ meta_audience_id: "238000000000001", meta_ad_account_id: NX_ACCOUNT, name: "NX Signups", status: "ready" }).select();
  db.writes.length = 0;

  const out = await run(setDraftAudiencesTool, ctx, {
    changes: [
      { remove: "pg-other" },
      { merge: { group_ids: ["ig-a", "ig-b"], name: "House & disco" } },
      { add_interests: { group_id: "ig-a", interests: [{ search: "Defected Records" }] } },
      { add_interests: { new_group_name: "Tech house", interests: [{ search: "Tech house" }, { search: "Disco" }] } },
      { add_custom: { audience_ids: ["238000000000001"], name: "Signups" } },
    ],
  });
  const after = await saved(db);
  assert.deepEqual(after.audiences.pageGroups.map((g) => g.id), ["pg-tech", "pg-disco"]);
  const merged = after.audiences.interestGroups.find((g) => g.id === "ig-a")!;
  assert.equal(merged.name, "House & disco");
  assert.deepEqual(merged.interests.map((i) => i.id), ["6003000000101", "6003000000102", "6003000000103", "6003000000003"]);
  assert.equal(after.audiences.interestGroups.some((g) => g.id === "ig-b"), false);
  const tech = after.audiences.interestGroups.find((g) => g.name === "Tech house")!;
  assert.deepEqual(tech.interests.map((i) => [i.id, i.targetabilityStatus, i.source]), [["6003000000001", "valid", "search"], ["6003000000002", "valid", "search"]]);
  assert.deepEqual(after.audiences.customAudienceGroups.map((g) => [g.name, g.audienceIds, g.audienceNames]), [["Signups", ["238000000000001"], { "238000000000001": "NX Signups" }]]);
  // Ad sets: pg-other's and ig-b's are gone; ig-a's is kept with its budget and name; the new groups got theirs.
  const ids = after.adSetSuggestions.map((r) => r.sourceId);
  assert.equal(ids.includes("pg-other"), false);
  assert.equal(ids.includes("ig-b"), false);
  const keptA = after.adSetSuggestions.find((r) => r.id === igA.id)!;
  assert.deepEqual([keptA.budgetPerDay, keptA.name], [11, "House fans"]);
  assert.match(keptA.sourceName, /\(4 interests\)/);
  assert.ok(after.adSetSuggestions.some((r) => r.sourceId === tech.id && r.sourceType === "interest_group"));
  assert.ok(after.adSetSuggestions.some((r) => r.sourceType === "custom_group" && r.sourceId === after.audiences.customAudienceGroups[0]!.id));
  // Assignments follow the rows.
  assert.equal(Object.keys(after.creativeAssignments).some((k) => !after.adSetSuggestions.some((r) => r.id === k)), false);
  assert.deepEqual(spies.interests, ["Defected Records", "Tech house", "Disco"]);
  assert.equal(out.summary.metaGets, 3);
  assert.deepEqual((out.summary.adSetsRemovedIds as string[]).length, 2);
});

test("set_draft_audiences: an unclear interest lists its hits and saves nothing; an unrecorded custom audience is refused", async () => {
  const { ctx, db } = draftCtx();
  await withAudiences(db);
  const e = await refused(run(setDraftAudiencesTool, ctx, { changes: [{ add_interests: { group_id: "ig-c", interests: [{ search: "House" }] } }] }), /didn't give one clear interest/);
  assert.equal((e.data!.choices as Array<{ hits: unknown[] }>)[0]!.hits.length, 2);
  await refused(run(setDraftAudiencesTool, ctx, { changes: [{ add_custom: { audience_ids: ["238000000000999"], name: "X" } }] }), /aren't recorded as ready/);
  await refused(run(setDraftAudiencesTool, ctx, { changes: [{ merge: { group_ids: ["ig-a", "pg-tech"], name: "X" } }] }), /Only groups of one kind merge/);
  await refused(run(setDraftAudiencesTool, ctx, { changes: [{ remove: "nope" }] }), /no audience group nope/);
  assert.deepEqual(draftWrites(db), []);
  // With the id, the hit is picked.
  const out = await run(setDraftAudiencesTool, ctx, { changes: [{ add_interests: { group_id: "ig-c", interests: [{ search: "House", interest_id: "6003000000004" }] } }] });
  assert.deepEqual((out.data.done as string[])[0], "added 1 interests to Fashion");
});

// ── set_draft_identity ──────────────────────────────────────────────────────

test("set_draft_identity: the page and its Instagram on settings and every ad; one page-list GET", async () => {
  const { ctx, db, spies } = draftCtx();
  await shape(db, (d) => ({ ...d, creatives: [...d.creatives, { ...createDefaultCreative("registration"), id: "cr-3", name: "No page yet", identity: { pageId: "", instagramAccountId: "" } }] }));
  const out = await run(setDraftIdentityTool, ctx, { page_id: EL_PAGE });
  const after = await saved(db);
  assert.equal(after.settings.metaPageId, EL_PAGE);
  assert.equal(after.settings.metaIGAccountId, EL_IG);
  for (const c of after.creatives) assert.deepEqual([c.identity.pageId, c.identity.instagramAccountId, c.identity.instagramActorId], [EL_PAGE, EL_IG, EL_IG], c.id);
  assert.equal(out.data.ads, 3);
  assert.deepEqual(out.data.replacedPages, [NX_PAGE]);
  assert.deepEqual(spies.pageLists, [NX_ACCOUNT]);
  assert.deepEqual((out.summary.before as { adPages: string[] }).adPages, [NX_PAGE]);
});

test("set_draft_identity: a page the account can't use is refused; keep_page_ids leaves those ads; a given Instagram wins", async () => {
  const { ctx, db } = draftCtx();
  const e = await refused(run(setDraftIdentityTool, ctx, { page_id: "999999999" }), /isn't one act_606252931141334 can run ads from/);
  assert.equal(e.summary?.refused, "page_not_usable");
  assert.ok((e.data!.pages as unknown[]).length > 0);
  assert.deepEqual(draftWrites(db), []);
  await shape(db, (d) => ({ ...d, creatives: d.creatives.map((c) => (c.id === "cr-2" ? { ...c, identity: { pageId: "100064000000099", instagramAccountId: "" } } : c)) }));
  const out = await run(setDraftIdentityTool, ctx, { page_id: EL_PAGE, instagram_actor_id: "17841400000000555", keep_page_ids: ["100064000000099"] });
  const after = await saved(db);
  assert.deepEqual(after.creatives.map((c) => c.identity.pageId), [EL_PAGE, "100064000000099"]);
  assert.equal(after.creatives[0]!.identity.instagramActorId, "17841400000000555");
  assert.equal(out.data.keptOnTheirPage, 1);
});

// ── set_draft_copy ──────────────────────────────────────────────────────────

test("set_draft_copy: primary texts, headline, description and CTA on every ad or the listed ones; the log keeps lengths, not copy", async () => {
  const { ctx, db } = draftCtx();
  const out = await run(setDraftCopyTool, ctx, { primary_texts: ["Glitterbox returns to Newcastle.", "Presale Friday."], headline: "Glitterbox · NX Newcastle", description: "Sign up for presale", cta: "sign_up" });
  const after = await saved(db);
  for (const c of after.creatives) {
    assert.deepEqual(c.captions.map((x) => x.text), ["Glitterbox returns to Newcastle.", "Presale Friday."]);
    assert.deepEqual([c.headline, c.description, c.cta], ["Glitterbox · NX Newcastle", "Sign up for presale", "sign_up"]);
  }
  assert.equal(out.data.ads, 2);
  assert.equal(JSON.stringify(out.summary).includes("Glitterbox"), false);
  const one = await run(setDraftCopyTool, { ...ctx }, { updated_at: String((await readRow(db, D_DRAFT))!.updated_at), cta: "book_now", ad_ids: ["cr-2"] });
  const again = await saved(db);
  assert.deepEqual(again.creatives.map((c) => c.cta), ["sign_up", "book_now"]);
  assert.equal(one.data.ads, 1);
});

test("set_draft_copy: an artist-voice caption, an unknown CTA and unknown ads are refused", async () => {
  const { ctx, db } = draftCtx();
  await refused(run(setDraftCopyTool, ctx, { primary_texts: ["Newcastle, I can't wait to play for you again!"] }), /artist-voice caption/);
  await refused(run(setDraftCopyTool, ctx, { cta: "shop_now" }), /cta is one of sign_up, learn_more, book_now, buy_tickets/);
  await refused(run(setDraftCopyTool, ctx, { headline: "x", ad_ids: ["cr-9"] }), /aren't in this draft: cr-9/);
  assert.deepEqual(draftWrites(db), []);
});

// ── remove_draft_creatives ──────────────────────────────────────────────────

test("remove_draft_creatives: the ads and their assignments go; all_except [] removes every ad", async () => {
  const { ctx, db } = draftCtx();
  await shape(db, (d) => ({ ...d, creativeAssignments: { "as-1": ["cr-1", "cr-2"], "as-2": ["cr-1"] } }));
  await run(removeDraftCreativesTool, ctx, { creative_ids: ["cr-1"] });
  let after = await saved(db);
  assert.deepEqual(after.creatives.map((c) => c.id), ["cr-2"]);
  assert.deepEqual(after.creativeAssignments, { "as-1": ["cr-2"], "as-2": [] });
  await refused(run(removeDraftCreativesTool, ctx, { updated_at: String((await readRow(db, D_DRAFT))!.updated_at), creative_ids: ["cr-1"] }), /aren't in this draft: cr-1/);
  const out = await run(removeDraftCreativesTool, ctx, { updated_at: String((await readRow(db, D_DRAFT))!.updated_at), all_except: [] });
  after = await saved(db);
  assert.deepEqual(after.creatives, []);
  assert.deepEqual(after.creativeAssignments, { "as-1": [], "as-2": [] });
  assert.equal(out.data.left, 0);
});

// ── set_draft_schedule ──────────────────────────────────────────────────────

test("set_draft_schedule: London start and end, budgets untouched; a past start and an end before the start are refused", async () => {
  const { ctx, db } = draftCtx();
  const before = await saved(db);
  const out = await run(setDraftScheduleTool, ctx, { start: "2026-12-01T10:00", end: "2026-12-14" });
  const after = await saved(db);
  assert.deepEqual([after.budgetSchedule.startDate, after.budgetSchedule.endDate], ["2026-12-01T10:00", "2026-12-14T23:59"]);
  assert.equal(after.budgetSchedule.startDateSource, "operator");
  assert.deepEqual(after.adSetSuggestions.map((r) => r.budgetPerDay), before.adSetSuggestions.map((r) => r.budgetPerDay));
  assert.equal(after.budgetSchedule.budgetAmount, before.budgetSchedule.budgetAmount);
  assert.equal(out.data.days, 14);
  const fresh = draftCtx();
  await refused(run(setDraftScheduleTool, fresh.ctx, { start: "2026-11-20", end: "2026-12-14" }), /is in the past/);
  await refused(run(setDraftScheduleTool, fresh.ctx, { start: "2026-12-05", end: "2026-12-01" }), /is before the start/);
  assert.deepEqual(draftWrites(fresh.db), []);
});

// ── duplicate_draft ─────────────────────────────────────────────────────────

test("duplicate_draft: the library's Duplicate: same event, a new draft, the source untouched; someone else's refused", async () => {
  const { ctx, db } = draftCtx();
  const out = await duplicateDraftTool.run(ctx, { draft_id: D_PUB, name: "[NX27] arm B" });
  const id = String((out.data as Record<string, unknown>).draft_id);
  assert.notEqual(id, D_PUB);
  const row = (await readRow(db, id))!;
  assert.deepEqual([row.status, row.user_id, row.event_id, row.name], ["draft", OPERATOR, "e0000000-0000-4000-8000-000000000010", "[NX27] arm B"]);
  const json = row.draft_json as CampaignDraft;
  assert.equal(json.creatives.length, 2);
  assert.equal(json.launchSummary, undefined);
  assert.equal((await readRow(db, D_PUB))!.status, "published");
  const plain = await duplicateDraftTool.run(ctx, { draft_id: D_DRAFT });
  assert.equal((plain.data as { name: string }).name, "[NX27-GLITTERBOX] SIGNUP (Copy)");
  await refused(duplicateDraftTool.run(ctx, { draft_id: D_STAFF }), /belongs to another account/);
  assert.deepEqual([...new Set(draftWrites(db).map((w) => w.op))], ["insert"]);
});

// ── apply_audience_template ─────────────────────────────────────────────────

async function withTemplate(db: Db, confirmed = true) {
  const t = db as unknown as { from(t: string): { insert(r: unknown): { select(): PromiseLike<unknown> } } };
  await t.from("audience_templates").insert({ id: "tpl-1", name: "Techno", business_id: null, client_id: CLIENT_NX, genre_families: ["techno"], notes: "Locklead", confirmed_by: confirmed ? OPERATOR : null, confirmed_at: confirmed ? "2026-11-24T08:00:00Z" : null }).select();
  const item = (over: Record<string, unknown>) => ({ template_id: "tpl-1", list_role: null, family_key: null, page_id: null, retention_days: null, interest_id: null, interest_name: null, meta_audience_id: null, detail: {}, ...over });
  for (const [id, over] of [
    ["it-1", { kind: "customer_list", list_role: "buyers", meta_audience_id: "238000000000010", detail: { name: "Techno buyers" } }],
    ["it-2", { kind: "customer_list", list_role: "similar", meta_audience_id: "238000000000020", detail: { name: "Held list", heldIn: "act_999" } }],
    ["it-3", { kind: "retargeting_pool", list_role: "page_views", retention_days: 30 }],
    ["it-4", { kind: "retargeting_pool", list_role: "video_viewers", retention_days: 30, detail: { threshold: 75 } }],
    ["it-5", { kind: "interest", interest_id: "6003000000301", interest_name: "Techno" }],
  ] as const)
    await t.from("audience_template_items").insert(item({ id, ...over })).select();
  await t.from("meta_custom_audiences").insert({ id: "mca-1", meta_audience_id: "238000000000010", meta_ad_account_id: NX_ACCOUNT, audience_subtype: "customer_list", list_role: "buyers", retention_days: null, source_id: null, source_meta: {}, event_id: null, status: "ready" }).select();
  db.writes.length = 0;
}

test("apply_audience_template: Reused audiences go in by Meta id; the rest are left out in the tab's words; twice changes nothing", async () => {
  const { ctx, db } = draftCtx();
  await withTemplate(db);
  const out = await run(applyAudienceTemplateTool, ctx, { template: "techno" });
  const after = await saved(db);
  const group = after.audiences.customAudienceGroups.find((g) => g.id === "template:Techno")!;
  assert.deepEqual(group.audienceIds, ["238000000000010"]);
  assert.deepEqual(after.audiences.interestGroups.find((g) => g.id === "template:Techno")!.interests.map((i) => i.id), ["6003000000301"]);
  assert.deepEqual(out.data.sentences, [
    "Added Techno to [NX27-GLITTERBOX] SIGNUP: 2 audiences.",
    "1 isn’t made yet, so it’s left out.",
    "1 is held in act_999, so it’s left out.",
    "1 needs this show’s videos picked, so it’s left out.",
  ]);
  assert.ok(after.adSetSuggestions.some((r) => r.sourceId === "template:Techno" && r.sourceType === "custom_group"));
  const again = await run(applyAudienceTemplateTool, ctx, { updated_at: String((await readRow(db, D_DRAFT))!.updated_at), template: "Techno" });
  assert.deepEqual(again.summary.newAudienceIds, []);
  assert.equal((await saved(db)).adSetSuggestions.length, after.adSetSuggestions.length);
});

test("apply_audience_template: an unconfirmed template and an unknown one are refused", async () => {
  const { ctx, db } = draftCtx();
  await withTemplate(db, false);
  await refused(run(applyAudienceTemplateTool, ctx, { template: "Techno" }), /Not confirmed yet\. Matas confirms a template before it’s used\./);
  await refused(run(applyAudienceTemplateTool, ctx, { template: "Jazz" }), /No template called "Jazz"/);
  assert.deepEqual(draftWrites(db), []);
});

test("apply_audience_template's words are words-rc-2026-11-24.tsv's (258 rows, sha256 f2100dd0…e6ce)", async () => {
  const { createHash } = await import("node:crypto");
  const raw = readFileSync(join(HERE, "fixtures/words-rc-2026-11-24.tsv"));
  assert.equal(createHash("sha256").update(raw).digest("hex"), "f2100dd0ebd1eea090f378d749e75bee561b3f0caa7badffecfac1ea02f4e6ce");
  const rows = raw.toString("utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
  assert.equal(rows.length, 258);
  const byKey = new Map(rows.map((r) => [r[0]!, r[2]!]));
  for (const [k, v] of Object.entries(APPLY_WORDS)) assert.equal(byKey.get(k), v, k);
});

// ── no outside calls but the two GETs ──────────────────────────────────────

test("the M2b tools reach out only through the interest search and the page list (and M2's location search)", () => {
  for (const f of ["lib/mcp/tools/draft-build.ts", "lib/mcp/tools/draft-audiences.ts", "lib/mcp/drafts/templates.ts"]) {
    const src = readFileSync(join(HERE, "../../..", f), "utf8");
    assert.doesNotMatch(src, /\b(fetch|graphPost|graphPostWithToken|graphDelete|graphGet)\s*\(/, f);
    assert.doesNotMatch(src, /graph\.facebook\.com|from\s+["'][^"']*\/(tiktok|google-ads|notify|d2c|actions)\//, f);
    for (const m of src.matchAll(/deps\.(\w+)\(/g)) assert.ok(["interestSearch", "pagesForAccount", "newId"].includes(m[1]!), `${f}: deps.${m[1]}`);
  }
});

void NX_IG;

test("set_draft_audiences: custom groups merge into one (audience ids deduped); the first keeps its ad set, the others' go", async () => {
  const { ctx, db } = draftCtx();
  await shape(db, (d) => {
    const audiences: AudienceSettings = {
      ...AUDIENCES,
      customAudienceGroups: [
        { id: "custom:1", name: "Tech House", audienceIds: ["238000000000001", "238000000000002"], audienceNames: { "238000000000001": "TH FB" } },
        { id: "custom:2", name: "Disco", audienceIds: ["238000000000002", "238000000000003"], audienceNames: { "238000000000003": "Disco IG" } },
      ],
    };
    const rows = generateSuggestions(audiences, 0, d.budgetSchedule.locationGroups ?? [], UK_NATIONWIDE_FALLBACK).map((r) => ({ ...r, budgetPerDay: 9 }));
    return { ...d, audiences, adSetSuggestions: rows };
  });
  const out = await run(setDraftAudiencesTool, ctx, { changes: [{ merge: { group_ids: ["custom:1", "custom:2"], name: "Crossover pages" } }] });
  const after = await saved(db);
  assert.deepEqual(after.audiences.customAudienceGroups.map((g) => [g.id, g.name, g.audienceIds]), [["custom:1", "Crossover pages", ["238000000000001", "238000000000002", "238000000000003"]]]);
  assert.deepEqual(after.audiences.customAudienceGroups[0]!.audienceNames, { "238000000000001": "TH FB", "238000000000003": "Disco IG" });
  assert.deepEqual(after.adSetSuggestions.filter((r) => r.sourceType === "custom_group").map((r) => r.sourceId), ["custom:1"]);
  assert.match((out.data.done as string[])[0]!, /3 audiences \(1 duplicates dropped\)/);
});

test("set_draft_budget level: a campaign (CBO) lifetime draft moves to daily budgets on the ad sets, split evenly, as the card's switch", async () => {
  const { setDraftBudgetTool } = await import("../tools/draft-edit.ts");
  const { ctx, db } = draftCtx();
  await shape(db, (d) => ({ ...d, budgetSchedule: { ...d.budgetSchedule, budgetLevel: "campaign", budgetType: "lifetime", budgetAmount: 1000 }, adSetSuggestions: d.adSetSuggestions.map((r) => ({ ...r, budgetPerDay: 0, budgetLifetime: 89.5 })) }));
  const out = await run(setDraftBudgetTool, ctx, { level: "ad_set", type: "daily", amount_gbp: 60, start: "2026-11-25T18:00", end: "2026-11-30T16:59" });
  const after = await saved(db);
  assert.deepEqual([after.budgetSchedule.budgetLevel, after.budgetSchedule.budgetType, after.budgetSchedule.budgetAmount], ["ad_set", "daily", 60]);
  assert.deepEqual(after.adSetSuggestions.map((r) => r.budgetPerDay), [30, 30]);
  assert.equal(out.data.budgetsOn, "ad sets");
  assert.deepEqual((out.summary.before as { level: string }).level, "campaign");
  // Then the ad sets take their own budgets, checked against the floor.
  const next = await run(setDraftAdSetsTool, ctx, { updated_at: String((await readRow(db, D_DRAFT))!.updated_at), changes: [{ ad_set_id: "as-1", budget_per_day: 9 }, { ad_set_id: "as-2", budget_per_day: 15 }] });
  assert.equal(next.data.totalPerDayGbp, 24);
});
