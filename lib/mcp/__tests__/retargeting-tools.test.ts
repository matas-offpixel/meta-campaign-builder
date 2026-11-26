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
const YES = { asked: "Make NX26-RUDIMENTAL · Wider and NX26-RUDIMENTAL · Retargeting paused? Wider £663.00 lifetime, Retargeting £21.00 a day once they're live.", answer: "yes, paused" };
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

test("plan_retargeting(code): TC8's line with both campaigns, the matched Pages (TC9), access, Similar skipped and the next stretch, read only", async () => {
  const { ctx, calls, db } = ctxWith([record({ matchedPages: { venue: null, brands: ["NX Newcastle"], artists: ["MC Fenn"] } })]);
  const out = await run(planRetargetingTool, ctx, { events: "NX26-RUDIMENTAL" });
  const message = String((out.data as { message: string }).message).split("\n");
  assert.deepEqual(message, [
    "NX26-RUDIMENTAL · final month · 35 %: Wider £663.00 lifetime (£39.00 a day) · Retargeting £21.00 a day: Similar £3.15 · Cold £5.25 · Warm £7.35 · Hot £5.25 · audiences 1 made, 10 to make, 2 missing access",
    "Matched Pages · venue not matched · promoter NX Newcastle · lineup MC Fenn. If one is wrong, Matas corrects it before the build.",
    "Needs advertiser access: MC Fenn (Facebook) · MC Fenn (Instagram).",
    "Similar skipped: NX26-RUDIMENTAL has no genre, so its share goes to Cold.",
    "Then final 2 weeks from Sat 28 Nov at 40 %, as a scheduled change.",
  ]);
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
    "XMPL-ROOF · skipped: it already has a Wider or Retargeting campaign.",
    "XMPL-ATTIC · skipped: it has no ticket link.",
    "XMPL-DOCKS · skipped: the show is within 3 days.",
    "XMPL-NONE · skipped: it has no prospecting budget to fold into Wider.",
  ]);
  assert.deepEqual(out.summary.reasons, { built: 1, no_link: 1, soon: 1, no_budget: 1 });
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

test("create_show_campaigns paused: the plan's build (both campaigns), paused, the done line, ids and the Ads Manager link", async () => {
  const { ctx, calls } = ctxWith([record()]);
  const out = await run(createShowCampaignsTool, ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0]!.mode, "paused");
  assert.deepEqual(calls.create[0]!.approval, YES);
  assert.equal(calls.create[0]!.build.kind, "retargeting_funnel_create");
  // No genre: Similar's £3.15 is in Cold's budget (TC3).
  assert.deepEqual(calls.create[0]!.build.plan.tiers, { similar: 0, cold: 840, warm: 735, hot: 525 });
  assert.equal(calls.create[0]!.build.wider?.campaignName, "NX26-RUDIMENTAL · Wider");
  assert.equal(calls.create[0]!.build.wider?.lifetimeMinor, 66300);
  const data = out.data as Record<string, unknown>;
  assert.equal(data.message, "Done: NX26-RUDIMENTAL · Wider and Retargeting created paused · 3 ad sets · 6 audiences made.");
  assert.equal(data.campaign_id, "120000000000001");
  assert.deepEqual(data.ad_set_ids, { cold: "131", warm: "132", hot: "133" });
  assert.match(String(data.ads_manager), /^https:\/\/business\.facebook\.com\/adsmanager\/manage\/campaigns\?act=123&selected_campaign_ids=120000000000001$/);
});

test("create_show_campaigns live: the done line, and a paused build asked as live goes live from its stored build", async () => {
  const fresh = ctxWith([record()]);
  const out = await run(createShowCampaignsTool, fresh.ctx, { event: "NX26-RUDIMENTAL", mode: "live", approval: YES });
  assert.equal((out.data as { message: string }).message, "Done: NX26-RUDIMENTAL · Wider and Retargeting created live · 3 ad sets · 6 audiences made.");
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
  assert.equal((out.data as { message: string }).message, "NX26-RUDIMENTAL · Wider and Retargeting are already made and paused. Nothing was changed.");
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
  const e = await refused(run(createShowCampaignsTool, partly.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES }), /^Meta is still building an audience\. Retry in an hour\. What’s made so far is paused; ask again to carry on\.$/);
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

test("plan_retargeting: each existing prospecting campaign as keep, pause or fold into Wider (TC8)", async () => {
  const campaigns = [
    { id: "1", name: "NX26-RUDIMENTAL · Prospecting", adSetNames: ["Broad · Advantage+"], delivering: true },
    { id: "2", name: "NX26-RUDIMENTAL · Lineup", adSetNames: ["Lineup · interests"], delivering: true },
  ];
  const { ctx } = ctxWith([record({ campaigns })]);
  const lines = String(((await run(planRetargetingTool, ctx, { events: "NX26-RUDIMENTAL" })).data as { message: string }).message).split("\n");
  assert.ok(lines.includes("Existing prospecting: NX26-RUDIMENTAL · Prospecting · fold into Wider, once Matas says yes."));
  assert.ok(lines.includes("Existing prospecting: NX26-RUDIMENTAL · Lineup · pause, once Matas says yes."));
});

const FOLD = [
  { id: "4101", name: "NX26-RUDIMENTAL · Prospecting", adSetNames: ["Broad · Advantage+", "Interests"], delivering: true },
  { id: "4102", name: "NX26-RUDIMENTAL · Tests", adSetNames: ["NX26-RUDIMENTAL · Tests · A"], delivering: true },
];

test("two campaigns: the plan names the fold; a live create waits until the prospecting it folds is paused", async () => {
  const twoInput = { twoCampaigns: true, campaigns: FOLD } as Partial<RetargetingInput>;
  const plan = ctxWith([record(twoInput)]);
  const message = String(((await run(planRetargetingTool, plan.ctx, { events: "NX26-RUDIMENTAL" })).data as { message: string }).message);
  assert.match(message, /^NX26-RUDIMENTAL · final month · 35 %: Wider £663\.00 lifetime \(£39\.00 a day\)/);
  assert.match(message, /\nExisting prospecting: NX26-RUDIMENTAL · Prospecting · fold into Wider, once Matas says yes\./);
  assert.match(message, /\nExisting prospecting: NX26-RUDIMENTAL · Tests · keep\./);

  const running = ctxWith([record(twoInput)], { statuses: { 4101: "ACTIVE" } });
  await refused(run(createShowCampaignsTool, running.ctx, { event: "NX26-RUDIMENTAL", mode: "live", approval: YES }), /^Refused: NX26-RUDIMENTAL’s prospecting still runs \(NX26-RUDIMENTAL · Prospecting\)\. Fold or pause it first, on Matas’s yes, then make it live\. Nothing was changed\.$/);
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

test("plan_retargeting: a built show without Similar whose group is confirmed now says Similar comes back at the next step (Matas, 27 Nov)", async () => {
  const group = { id: "g", genreFamily: "dnb", pageIds: ["2001", "2002"], igIds: [], confirmed: true };
  const built = record({ genreFamily: "dnb", pageGroup: group, funnelBuilt: { state: "live", mode: "live", campaignId: "1", tiers: { similar: 0, cold: 840, warm: 735, hot: 525 }, took: [] } });
  const { ctx } = ctxWith([built]);
  const lines = String(((await run(planRetargetingTool, ctx, { events: "NX26-RUDIMENTAL" })).data as { message: string }).message).split("\n");
  assert.deepEqual(lines, ["NX26-RUDIMENTAL · skipped: it already has a Wider or Retargeting campaign.", "Similar comes back at the next step, Sat 28 Nov, now its page group is confirmed."]);
  const refused = record({ genreFamily: "dnb", pageGroup: group, funnelBuilt: { state: "live", mode: "live", campaignId: "1", tiers: { similar: 0, cold: 840, warm: 735, hot: 525 }, took: [], similarRefused: { day: "2026-11-26", reason: "Its audience is too small." } } });
  const again = ctxWith([refused]);
  assert.match(String(((await run(planRetargetingTool, again.ctx, { events: "NX26-RUDIMENTAL" })).data as { message: string }).message), /\nSimilar couldn’t be added on Thu 26 Nov: Its audience is too small\. Its share stays in Cold\.$/);
});

test("design's two tool descriptions (27 Nov), word for word, and plan_retargeting's title", () => {
  assert.equal(planRetargetingTool.title, "Plan each show's two campaigns");
  assert.equal(planRetargetingTool.description, "Read only. For one event code, a list of codes, or \"live\" (every show on sale or in presale, of a non-archived client): what each show's two campaigns, \"{code} · Wider\" and \"{code} · Retargeting\", would be today. Per show: the stretch and share; Wider's lifetime, end date and £ a day; Retargeting's £ a day and its split (Similar, Cold, Warm, Hot); audiences made, to make and missing advertiser access; the venue, promoter and lineup Pages it matched. Then, when they apply: Similar skipped and why, presale sign-ups left out, each existing prospecting campaign as keep, pause or fold into Wider, and the next stretch as a scheduled change. A show that can't be built is one skipped line with the reason. Nothing is sent to Meta or saved.");
  assert.equal(createShowCampaignsTool.description, "Makes one show's two campaigns as plan_retargeting plans them: \"{code} · Wider\" (Advantage+ audience, lifetime budget) and \"{code} · Retargeting\" (Similar, Cold, Warm and Hot, daily budgets), the missing audiences, and the show's live ads with its current copy. mode paused makes both paused and moves nothing. mode live checks the show's ceiling, switches both on and schedules each later stretch step (Retargeting up, Wider's remaining lifetime down). It's refused while the show's existing prospecting still runs; pausing or folding that is Matas's yes, and this tool never does it. Asked again, it carries on from what's made; a paused build asked as live goes live. Needs Matas's yes in this chat: ask him the show, paused or live, Wider's lifetime and Retargeting's £ a day, then pass approval with your question (asked) and his reply word for word (answer).");
});
