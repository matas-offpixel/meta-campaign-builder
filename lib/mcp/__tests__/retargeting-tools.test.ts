/**
 * M3c: plan_retargeting and create_show_campaigns, with the 08:00 read and the
 * create path as spies (RF9's words; the house rules: Matas's chat yes,
 * plain refusals that end "Nothing was changed.", ids and links only).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { createShowCampaignsTool, planRetargetingTool } from "../tools/retargeting.ts";
import type { McpRetargetingDeps } from "../retargeting/types.ts";
import { planRetargeting, type RetargetingInput } from "../../retargeting/plan.ts";
import type { RetargetingRecord } from "../../retargeting/runner.ts";
import type { FunnelBuild, FunnelOutcome } from "../../retargeting/funnel-apply.ts";
import { fakeDb } from "./fake-db.ts";
import { OPERATOR } from "./helpers.ts";

const SCOPE = "mcp:read mcp:draft mcp:meta";
const YES = { asked: "Make NX26-RUDIMENTAL · Retargeting paused? £21.00 a day from Broad · Advantage+ once it's live.", answer: "yes, paused" };
const EVENT = "e0000000-0000-4000-8000-000000000001";

function input(over: Partial<RetargetingInput> = {}): RetargetingInput {
  return {
    eventId: EVENT,
    eventCode: "NX26-RUDIMENTAL",
    runDay: "2026-11-26",
    eventDate: "2026-12-12",
    onSaleDay: "2026-10-01",
    announceDay: "2026-09-29",
    read: { state: "platform_proposed", pixel: { id: "px1" }, pixelName: "NX Skiddle", platform: "Skiddle", domain: null } as never,
    last7SpendGbp: 420,
    minDailyMinor: null,
    sources: {
      pixelId: "px1",
      links: [{ kind: "ticket", rule: "skiddle.com/e/1", host: "skiddle.com", name: "Skiddle", platform: "skiddle" }],
      videos: [],
      pages: [
        { id: "1001", name: "NX Newcastle", igId: "ig1", kind: "promoter", hasRole: true },
        { id: "1002", name: "MC Fenn", igId: "ig2", kind: "lineup", hasRole: false },
      ],
      lists: [],
    },
    existing: null,
    legacy: [],
    budgetGbp: null,
    spendToDateGbp: 0,
    committedGbp: null,
    main: null,
    ads: [{ adId: "7001", name: "Rudimental · announce" }],
    geoFromAdsetId: "5001",
    where: { draftId: "d0000000-0000-4000-8000-000000000001", adAccountId: "act_123", campaignIds: ["4001"] },
    prospecting: [{ id: "5001", kind: "adset", name: "Broad · Advantage+", dailyMinor: 3600, adSets: 1 }, { id: "5002", kind: "adset", name: "Interests", dailyMinor: 2400, adSets: 1 }],
    madeAudiences: ["rf:ticket:30"],
    ...over,
  };
}

function record(over: Partial<RetargetingInput> = {}): RetargetingRecord {
  const i = input(over);
  return { eventId: i.eventId, eventCode: i.eventCode, plan: planRetargeting(i), input: i, proposalId: null };
}

function ctxWith(records: RetargetingRecord[], opts: { scope?: string; isMatas?: boolean; build?: Record<string, unknown> | null; owner?: string; archived?: string[]; outcome?: Partial<FunnelOutcome>; statuses?: Record<string, string> } = {}) {
  const calls: { read: unknown[]; create: { build: FunnelBuild; mode: string; approval: unknown }[] } = { read: [], create: [] };
  const deps: McpRetargetingDeps = {
    async campaignStatuses({ ids }) {
      return Object.fromEntries(ids.map((id) => [id, opts.statuses?.[id] ?? null]));
    },
    async read(args) {
      calls.read.push(args);
      return { records: args.codes ? records.filter((r) => args.codes!.some((c) => c.toUpperCase() === (r.eventCode ?? "").toUpperCase())) : records, metaGets: 3, skipped: [] };
    },
    async create(args) {
      calls.create.push({ build: args.build, mode: args.mode, approval: args.approval });
      const progress = { campaignId: "120000000000001", audiences: { a: "1", b: "2", c: "3", d: "4", e: "5", f: "6" }, adSets: { cold: { id: "131", dailyMinor: 630 }, warm: { id: "132", dailyMinor: 945 }, hot: { id: "133", dailyMinor: 525 } }, ads: ["141", "142", "143"], ...(args.mode === "live" ? { active: true, scheduled: ["s1", "s2"] } : {}) };
      return { outcome: { state: "applied", reason: null, progress, ...opts.outcome } as FunnelOutcome, adsManager: "https://business.facebook.com/adsmanager/manage/campaigns?act=123&selected_campaign_ids=120000000000001" };
    },
  };
  const events = records.map((r) => ({ id: r.eventId, event_code: r.eventCode, user_id: opts.owner ?? OPERATOR, client_id: "c1", client: { name: "NX", status: "active" } }));
  for (const code of opts.archived ?? []) events.push({ id: `arch-${code}`, event_code: code, user_id: OPERATOR, client_id: "c2", client: { name: "4theFans", status: "archived" } });
  const db = fakeDb({ events, retargeting_builds: opts.build ? [{ event_id: EVENT, ...opts.build }] : [] });
  const ctx = { db, readers: {} as never, userId: OPERATOR, scope: opts.scope ?? SCOPE, isMatas: opts.isMatas ?? true, retargeting: deps, seesClientNames: true, today: "2026-11-26", now: new Date("2026-11-26T10:00:00Z") } as unknown as ToolContext;
  return { ctx, calls, db };
}

async function refused(p: Promise<unknown>, re: RegExp): Promise<ToolInputError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ToolInputError, String(e));
    assert.match(e.message, re);
    return e;
  }
  assert.fail("expected a refusal");
}

const run = (tool: McpTool, ctx: ToolContext, args: Record<string, unknown>) => tool.run(ctx, args);

test("plan_retargeting(code): RF9's line, then access and the next stretch, read only", async () => {
  const { ctx, calls, db } = ctxWith([record()]);
  const out = await run(planRetargetingTool, ctx, { events: "NX26-RUDIMENTAL" });
  const message = String((out.data as { message: string }).message).split("\n");
  assert.equal(message[0], "NX26-RUDIMENTAL · final month · 35 % · £21.00 a day: Cold £6.30 · Warm £9.45 · Hot £5.25 · from Broad · Advantage+ £36.00 → £15.00 · audiences 1 made, 10 to make, 2 missing access");
  assert.equal(message[1], "Needs advertiser access: MC Fenn (Facebook) · MC Fenn (Instagram).");
  assert.equal(message[2], "Then final 2 weeks from Sat 28 Nov at 40 %, as a scheduled change.");
  assert.equal(message.length, 3);
  assert.equal(planRetargetingTool.readOnly, true);
  assert.deepEqual((db as unknown as { writes: unknown[] }).writes, []);
  assert.deepEqual(calls.create, []);
});

test("plan_retargeting(\"live\"): the counts first, then each show, then the skipped ones with their reasons", async () => {
  const built = record({ eventId: "e2", eventCode: "XMPL-ROOF", funnelBuilt: { state: "paused", mode: "paused", campaignId: "1", tiers: { similar: 0, cold: 600, warm: 300, hot: 100 }, took: [] } });
  const noLink = record({ eventId: "e3", eventCode: "XMPL-ATTIC", sources: { ...input().sources, links: [] } });
  const soon = record({ eventId: "e4", eventCode: "XMPL-DOCKS", eventDate: "2026-11-28" });
  const short = record({ eventId: "e5", eventCode: "XMPL-NONE", prospecting: [{ id: "9", kind: "adset", name: "Broad", dailyMinor: 100, adSets: 1 }] });
  const { ctx } = ctxWith([record(), built, noLink, soon, short]);
  const out = await run(planRetargetingTool, ctx, { events: "live" });
  const lines = String((out.data as { message: string }).message).split("\n");
  assert.equal(lines[0], "5 shows on sale: 1 to build, 4 skipped.");
  assert.match(lines[1]!, /^NX26-RUDIMENTAL · final month · 35 %/);
  assert.deepEqual(lines.slice(-4), [
    "XMPL-ROOF · skipped: it already has a Retargeting campaign.",
    "XMPL-ATTIC · skipped: it has no ticket link.",
    "XMPL-DOCKS · skipped: the show is within 3 days.",
    "XMPL-NONE · skipped: prospecting has nothing above £1.00 an ad set to give.",
  ]);
  assert.deepEqual(out.summary.reasons, { built: 1, no_link: 1, soon: 1, no_money: 1 });
});

test("plan_retargeting: an archived client's show is skipped by name; the read never sees it", async () => {
  const { ctx, calls } = ctxWith([record()], { archived: ["FTF26-OLD"] });
  const out = await run(planRetargetingTool, ctx, { events: ["NX26-RUDIMENTAL", "FTF26-OLD"] });
  assert.match(String((out.data as { message: string }).message), /FTF26-OLD · skipped: its client is archived\./);
  assert.deepEqual((calls.read[0] as { codes: string[] }).codes, ["NX26-RUDIMENTAL"]);
});

test("both tools: refused without mcp:meta or for anyone but Matas, before any read", async () => {
  for (const opts of [{ scope: "mcp:read mcp:draft" }, { isMatas: false }]) {
    const { ctx, calls } = ctxWith([record()], opts);
    await refused(run(planRetargetingTool, ctx, { events: "live" }), /^Refused: this connection can’t make Meta changes\./);
    await refused(run(createShowCampaignsTool, ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES }), /^Refused: this connection can’t make Meta changes\./);
    assert.deepEqual(calls.read, []);
  }
});

test("create_show_campaigns: no chat yes, nothing runs", async () => {
  const { ctx, calls } = ctxWith([record()]);
  for (const approval of [undefined, { asked: "", answer: "yes" }, { asked: "x", answer: "y".repeat(1001) }]) {
    await assert.rejects(run(createShowCampaignsTool, ctx, { event: "NX26-RUDIMENTAL", mode: "live", approval }), ToolInputError);
  }
  assert.deepEqual(calls.read, []);
  assert.deepEqual(calls.create, []);
});

test("create_show_campaigns paused: the plan's build, paused, the done line, ids and the Ads Manager link", async () => {
  const { ctx, calls } = ctxWith([record()]);
  const out = await run(createShowCampaignsTool, ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0]!.mode, "paused");
  assert.deepEqual(calls.create[0]!.approval, YES);
  assert.equal(calls.create[0]!.build.kind, "retargeting_funnel_create");
  assert.deepEqual(calls.create[0]!.build.plan.tiers, { similar: 0, cold: 630, warm: 945, hot: 525 });
  const data = out.data as Record<string, unknown>;
  assert.equal(data.message, "Done: NX26-RUDIMENTAL · Retargeting created paused · 3 ad sets · 6 audiences made. Takes £21.00 a day from prospecting once it’s live.");
  assert.equal(data.campaign_id, "120000000000001");
  assert.deepEqual(data.ad_set_ids, { cold: "131", warm: "132", hot: "133" });
  assert.match(String(data.ads_manager), /^https:\/\/business\.facebook\.com\/adsmanager\/manage\/campaigns\?act=123&selected_campaign_ids=120000000000001$/);
});

test("create_show_campaigns live: says what it takes, and a paused build asked as live goes live from its stored build", async () => {
  const fresh = ctxWith([record()]);
  const out = await run(createShowCampaignsTool, fresh.ctx, { event: "NX26-RUDIMENTAL", mode: "live", approval: YES });
  assert.equal((out.data as { message: string }).message, "Done: NX26-RUDIMENTAL · Retargeting created live · 3 ad sets · 6 audiences made. Takes £21.00 a day from prospecting.");
  const stored = record().plan.build as FunnelBuild;
  const paused = ctxWith([record({ funnelBuilt: { state: "paused", mode: "paused", campaignId: "1", tiers: { similar: 0, cold: 630, warm: 945, hot: 525 }, took: [] } })], { build: { build: stored, mode: "paused", state: "paused", progress: { campaignId: "1" }, meta_campaign_id: "1" } });
  await run(createShowCampaignsTool, paused.ctx, { event: "NX26-RUDIMENTAL", mode: "live", approval: YES });
  assert.equal(paused.calls.create[0]!.mode, "live");
  assert.equal(paused.calls.create[0]!.build, stored);
});

test("create_show_campaigns: already live, or paused asked again as paused, is a no-op", async () => {
  const stored = record().plan.build as FunnelBuild;
  const live = ctxWith([record()], { build: { build: stored, mode: "live", state: "live", progress: { campaignId: "1", active: true }, meta_campaign_id: "1" } });
  assert.equal((await run(createShowCampaignsTool, live.ctx, { event: "NX26-RUDIMENTAL", mode: "live", approval: YES })).data && live.calls.create.length, 0);
  const paused = ctxWith([record()], { build: { build: stored, mode: "paused", state: "paused", progress: { campaignId: "1" }, meta_campaign_id: "1" } });
  const out = await run(createShowCampaignsTool, paused.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES });
  assert.equal((out.data as { message: string }).message, "NX26-RUDIMENTAL · Retargeting is already made and paused. Nothing was changed.");
  assert.equal(paused.calls.create.length, 0);
});

test("create_show_campaigns: a show that can't be built is refused with its skip line; another account's show too", async () => {
  const noLink = ctxWith([record({ sources: { ...input().sources, links: [] } })]);
  await refused(run(createShowCampaignsTool, noLink.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES }), /^Refused: NX26-RUDIMENTAL · skipped: it has no ticket link\. Nothing was changed\.$/);
  const theirs = ctxWith([record()], { owner: "someone-else" });
  await refused(run(createShowCampaignsTool, theirs.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES }), /another account/);
  assert.deepEqual([...noLink.calls.create, ...theirs.calls.create], []);
});

test("create_show_campaigns: a failure says what's made, in plain words; the ceiling's own refusal comes through as written", async () => {
  const partly = ctxWith([record()], { outcome: { state: "failed", reason: "Meta is still building an audience. Retry in an hour.", step: "audience", error: "raw meta body" } });
  const e = await refused(run(createShowCampaignsTool, partly.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES }), /^Meta is still building an audience\. Retry in an hour\. What's made so far is paused; ask again to carry on\.$/);
  assert.doesNotMatch(JSON.stringify(e.summary), /raw meta body/);
  const ceiling = ctxWith([record()], { outcome: { state: "failed", reason: "Refused: NX has no daily ceiling, so nothing that starts spend can run. Matas sets one in Settings › Claude. Nothing was sent to Meta.", step: "ceiling", progress: {} } });
  await refused(run(createShowCampaignsTool, ceiling.ctx, { event: "NX26-RUDIMENTAL", mode: "live", approval: YES }), /^Refused: NX has no daily ceiling.*Nothing was sent to Meta\.$/);
});

test("create_show_campaigns: a tier Meta still has location expansion on for gets the untick line, per ad set", async () => {
  const readBack = [
    { adsetId: "131", name: "NX26-RUDIMENTAL · Retargeting · Cold", geoOff: true, advantageOff: true },
    { adsetId: "133", name: "NX26-RUDIMENTAL · Retargeting · Hot", geoOff: false, advantageOff: true, read: true },
    { adsetId: "132", name: "NX26-RUDIMENTAL · Retargeting · Warm", geoOff: false, advantageOff: false, read: false },
  ];
  const { ctx } = ctxWith([record()], { outcome: { progress: { campaignId: "120000000000001", audiences: { a: "1" }, adSets: { similar: undefined, cold: { id: "131", dailyMinor: 630 }, hot: { id: "133", dailyMinor: 525 } }, readBack } as never } });
  const out = await run(createShowCampaignsTool, ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES });
  const lines = String((out.data as { message: string }).message).split("\n");
  assert.deepEqual(lines.slice(1), [
    "Location expansion couldn’t be read back for NX26-RUDIMENTAL · Retargeting · Warm, so it may be on. Check “Reach more people likely to respond to your ads” in Ads Manager.",
    "NX26-RUDIMENTAL · Retargeting · Hot still has location expansion on. Untick “Reach more people likely to respond to your ads” for it in Ads Manager.",
  ]);
});

test("plan_retargeting: the keep / pause / fold advice only once the two-campaign record is ruled", async () => {
  const campaigns = [
    { id: "1", name: "NX26-RUDIMENTAL · Prospecting", adSetNames: ["Broad · Advantage+"], delivering: true },
    { id: "2", name: "NX26-RUDIMENTAL · Lineup", adSetNames: ["Lineup · interests"], delivering: true },
  ];
  const off = ctxWith([record({ campaigns })]);
  assert.doesNotMatch(String(((await run(planRetargetingTool, off.ctx, { events: "NX26-RUDIMENTAL" })).data as { message: string }).message), /Fold into Wider/);
  const on = ctxWith([record({ campaigns })]);
  (on.ctx as { showCampaignsRuled?: boolean }).showCampaignsRuled = true;
  const message = String(((await run(planRetargetingTool, on.ctx, { events: "NX26-RUDIMENTAL" })).data as { message: string }).message);
  assert.match(message, /\nPause: NX26-RUDIMENTAL · Lineup\. Fold into Wider: NX26-RUDIMENTAL · Prospecting\. Nothing is paused without Matas's yes\.$/);
});

const FOLD = [
  { id: "4101", name: "NX26-RUDIMENTAL · Prospecting", adSetNames: ["Broad · Advantage+", "Interests"], delivering: true },
  { id: "4102", name: "NX26-RUDIMENTAL · Tests", adSetNames: ["NX26-RUDIMENTAL · Tests · A"], delivering: true },
];

test("two campaigns (staged): the plan adds Wider's line; a live create waits until the prospecting it folds is paused", async () => {
  const twoInput = { twoCampaigns: true, campaigns: FOLD } as Partial<RetargetingInput>;
  const plan = ctxWith([record(twoInput)]);
  (plan.ctx as { showCampaignsRuled?: boolean }).showCampaignsRuled = true;
  const message = String(((await run(planRetargetingTool, plan.ctx, { events: "NX26-RUDIMENTAL" })).data as { message: string }).message);
  assert.match(message, /\nNX26-RUDIMENTAL · Wider · £\d+\.\d{2} a day · £[\d.]+ over 17 days \(lifetime\) · Broad · Lookalikes\n/);
  assert.match(message, /Fold into Wider: NX26-RUDIMENTAL · Prospecting/);

  const running = ctxWith([record(twoInput)], { statuses: { 4101: "ACTIVE" } });
  await refused(run(createShowCampaignsTool, running.ctx, { event: "NX26-RUDIMENTAL", mode: "live", approval: YES }), /^Refused: NX26-RUDIMENTAL's prospecting still runs \(NX26-RUDIMENTAL · Prospecting\)\. Fold or pause it first, on Matas's yes, then make it live\. Nothing was changed\.$/);
  assert.equal(running.calls.create.length, 0);

  const folded = ctxWith([record(twoInput)], { statuses: { 4101: "PAUSED" } });
  await run(createShowCampaignsTool, folded.ctx, { event: "NX26-RUDIMENTAL", mode: "live", approval: YES });
  assert.equal(folded.calls.create.length, 1);
  assert.ok(folded.calls.create[0]!.build.wider);

  // Paused builds Wider whatever runs: it spends nothing.
  const paused = ctxWith([record(twoInput)], { statuses: { 4101: "ACTIVE" } });
  await run(createShowCampaignsTool, paused.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES });
  assert.equal(paused.calls.create.length, 1);
});
