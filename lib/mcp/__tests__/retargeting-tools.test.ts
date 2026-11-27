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
    // An Electric show optimises on InitiateCheckout: the pixel had it on the ticket site in 28 days.
    pixelHosts: { any: ["skiddle.com"], pageView: ["skiddle.com"], checkout: ["skiddle.com"], registration: [] },
    ...over,
  };
}

function record(over: Partial<RetargetingInput> = {}): RetargetingRecord {
  const i = input(over);
  return { eventId: i.eventId, eventCode: i.eventCode, plan: planRetargeting(i), input: i, proposalId: null };
}

function ctxWith(records: RetargetingRecord[], opts: { scope?: string; isMatas?: boolean; build?: Record<string, unknown> | null; owner?: string; archived?: string[]; outcome?: Partial<FunnelOutcome>; statuses?: Record<string, string>; held?: string[]; unfinished?: { eventId: string; eventCode: string; why: "show" | "total" }[]; notRead?: "purchases"[]; pages?: { id: string; name: string; igId: string | null; igUsername: string | null }[] } = {}) {
  const calls: { read: unknown[]; create: { build: FunnelBuild; mode: string; approval: unknown }[]; pages: string[] } = { read: [], create: [], pages: [] };
  const deps: McpRetargetingDeps = {
    async campaignStatuses({ ids }) {
      return Object.fromEntries(ids.map((id) => [id, opts.statuses?.[id] ?? null]));
    },
    async read(args) {
      calls.read.push(args);
      const want = (code: string | null) => !args.codes || args.codes.some((c) => c.toUpperCase() === (code ?? "").toUpperCase());
      return { records: records.filter((r) => want(r.eventCode)), metaGets: 3, skipped: [], unfinished: (opts.unfinished ?? []).filter((row) => want(row.eventCode)), notRead: opts.notRead ?? [] };
    },
    async create(args) {
      calls.create.push({ build: args.build, mode: args.mode, approval: args.approval });
      const progress = { campaignId: "120000000000001", audiences: { a: "1", b: "2", c: "3", d: "4", e: "5", f: "6" }, adSets: { cold: { id: "131", dailyMinor: 630 }, warm: { id: "132", dailyMinor: 945 }, hot: { id: "133", dailyMinor: 525 } }, ads: ["141", "142", "143"], ...(args.mode === "live" ? { active: true, scheduled: ["s1", "s2"] } : {}) };
      return { outcome: { state: "applied", reason: null, progress, ...opts.outcome } as FunnelOutcome, adsManager: "https://business.facebook.com/adsmanager/manage/campaigns?act=123&selected_campaign_ids=120000000000001" };
    },
  };
  const events = records.map((r) => ({ id: r.eventId, event_code: r.eventCode, user_id: opts.owner ?? OPERATOR, client_id: "c1", client: { name: "NX", status: "active" } }));
  for (const code of opts.held ?? []) events.push({ id: `held-${code}`, event_code: code, user_id: OPERATOR, client_id: "9d4ebdfe-f062-4e4d-8982-1947829667b8", client: { name: "Louder / Parable", status: "active" } });
  for (const code of opts.archived ?? []) events.push({ id: `arch-${code}`, event_code: code, user_id: OPERATOR, client_id: "c2", client: { name: "4theFans", status: "archived" } });
  const db = fakeDb({ events, retargeting_builds: opts.build ? [{ event_id: EVENT, ...opts.build }] : [] });
  // The ad account's Pages (GET /act_{id}/promote_pages): NX Loves with its Instagram, as the 27 Nov read found it.
  const audiences = { promotePages: async () => (calls.pages.push("act"), { pages: opts.pages ?? [{ id: "259905047197071", name: "NX LOVES ", igId: "17841460869627228", igUsername: "nxloves" }, { id: "1001", name: "NX Newcastle", igId: "ig1", igUsername: "nxnewcastle" }], metaGets: 1 }) };
  const ctx = { db, readers: {} as never, userId: OPERATOR, scope: opts.scope ?? SCOPE, isMatas: opts.isMatas ?? true, retargeting: deps, audiences, seesClientNames: true, today: "2026-11-26", now: new Date("2026-11-26T10:00:00Z") } as unknown as ToolContext;
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
    "NX26-RUDIMENTAL · final month · 35 %: Wider £663.00 lifetime (£39.00 a day) · Retargeting £21.00 a day: Similar £0.00 · Cold £8.40 · Warm £7.35 · Hot £5.25 · audiences 1 made, 10 to make, 2 missing access",
    "Matched Pages · venue not matched · promoter NX Newcastle · lineup MC Fenn. If one is wrong, Matas corrects it before the build.",
    "Needs advertiser access: MC Fenn (Facebook) · MC Fenn (Instagram).",
    "Similar skipped: NX26-RUDIMENTAL has no genre, so its share goes to Cold.",
    "Then final 2 weeks from Sat 28 Nov at 40 %, as a scheduled change.",
    // Matas, 27 Nov: an Electric show optimises on InitiateCheckout once on sale (PENDING DESIGN).
    "Optimises on: InitiateCheckout.",
    // Matas, 27 Nov: an NX show's ads run from NX Loves (claude.rt.ads.line.copied, ruled 27 Nov).
    "Ads: the show’s one live ad, copied into both campaigns, run from NX LOVES and Instagram nxloves (the Electric group’s Page for Newcastle).",
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
  assert.equal(lines[0], "Louder / Parable is held for now, so its shows are left out.");
  assert.equal(lines[1], "5 shows on sale: 1 to build, 4 skipped.");
  assert.match(lines[2]!, /^NX26-RUDIMENTAL · final month · 35 %/);
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
  assert.equal(data.message, "Done: NX26-RUDIMENTAL · Wider and Retargeting created paused · 3 ad sets · 6 audiences made.\nOptimises on: InitiateCheckout.\nAds: the show’s one live ad, copied into both campaigns, run from NX LOVES and Instagram nxloves (the Electric group’s Page for Newcastle).");
  assert.equal(data.campaign_id, "120000000000001");
  assert.deepEqual(data.ad_set_ids, { cold: "131", warm: "132", hot: "133" });
  assert.match(String(data.ads_manager), /^https:\/\/business\.facebook\.com\/adsmanager\/manage\/campaigns\?act=123&selected_campaign_ids=120000000000001$/);
});

test("create_show_campaigns live: the done line, and a paused build asked as live goes live from its stored build", async () => {
  const fresh = ctxWith([record()]);
  const out = await run(createShowCampaignsTool, fresh.ctx, { event: "NX26-RUDIMENTAL", mode: "live", approval: YES });
  assert.equal((out.data as { message: string }).message, "Done: NX26-RUDIMENTAL · Wider and Retargeting created live · 3 ad sets · 6 audiences made.\nOptimises on: InitiateCheckout.\nAds: the show’s one live ad, copied into both campaigns, run from NX LOVES and Instagram nxloves (the Electric group’s Page for Newcastle).");
  const stored = record().plan.build as FunnelBuild;
  const paused = ctxWith([record({ funnelBuilt: { state: "paused", mode: "paused", campaignId: "1", tiers: { similar: 0, cold: 630, warm: 945, hot: 525 }, took: [] } })], { build: { build: stored, mode: "paused", state: "paused", progress: { campaignId: "1", ads: ["141"] }, meta_campaign_id: "1" } });
  await run(createShowCampaignsTool, paused.ctx, { event: "NX26-RUDIMENTAL", mode: "live", approval: YES });
  assert.equal(paused.calls.create[0]!.mode, "live");
  // A build whose ads were made before the Electric default keeps its copied ads' own Page (nothing read for it).
  assert.deepEqual(paused.calls.create[0]!.build, { ...stored, identity: null, creatives: null, copyAds: null });
  assert.deepEqual(paused.calls.pages, []);
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
  assert.deepEqual(lines.slice(3), [
    "Location expansion couldn’t be read back for NX26-RUDIMENTAL · Retargeting · Warm, so it may be on. Check “Reach more people likely to respond to your ads” in Ads Manager.",
    "NX26-RUDIMENTAL · Retargeting · Hot still has location expansion on. Untick “Reach more people likely to respond to your ads” for it in Ads Manager.",
  ]);
});

test("plan_retargeting: each existing prospecting campaign is paused when Wider goes live (fix 4, Matas 27 Nov)", async () => {
  const campaigns = [
    { id: "1", name: "NX26-RUDIMENTAL · Prospecting", adSetNames: ["Broad · Advantage+"], delivering: true },
    { id: "2", name: "NX26-RUDIMENTAL · Lineup", adSetNames: ["Lineup · interests"], delivering: true },
  ];
  const { ctx } = ctxWith([record({ campaigns })]);
  const lines = String(((await run(planRetargetingTool, ctx, { events: "NX26-RUDIMENTAL" })).data as { message: string }).message).split("\n");
  assert.ok(lines.includes("Existing prospecting: NX26-RUDIMENTAL · Prospecting · pause when Wider goes live, once Matas says yes (its remaining budget is counted in Wider’s lifetime)."));
  assert.ok(lines.includes("Existing prospecting: NX26-RUDIMENTAL · Lineup · pause when Wider goes live, once Matas says yes (its remaining budget is counted in Wider’s lifetime)."));
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
  assert.match(message, /\nExisting prospecting: NX26-RUDIMENTAL · Prospecting · pause when Wider goes live, once Matas says yes \(its remaining budget is counted in Wider’s lifetime\)\./);
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
  assert.deepEqual(lines, ["NX26-RUDIMENTAL · skipped: it already has a Wider or Retargeting campaign.", "Similar comes back at the next step, Sat 28 Nov, now its page group is confirmed.", "Optimises on: Purchase. NX26-RUDIMENTAL’s ad sets were made on it, so they keep it; nothing on them is changed."]);
  const refused = record({ genreFamily: "dnb", pageGroup: group, funnelBuilt: { state: "live", mode: "live", campaignId: "1", tiers: { similar: 0, cold: 840, warm: 735, hot: 525 }, took: [], similarRefused: { day: "2026-11-26", reason: "Its audience is too small." } } });
  const again = ctxWith([refused]);
  assert.match(String(((await run(planRetargetingTool, again.ctx, { events: "NX26-RUDIMENTAL" })).data as { message: string }).message), /\nSimilar couldn’t be added on Thu 26 Nov: Its audience is too small\. Its share stays in Cold\.\nOptimises on: Purchase\./);
});

test("design's two tool descriptions (27 Nov), word for word, and plan_retargeting's title", () => {
  assert.equal(planRetargetingTool.title, "Plan each show's two campaigns");
  assert.equal(planRetargetingTool.description, "Read only. For one event code, a list of codes, or \"live\" (every show on sale or in presale, of a non-archived client): what each show's two campaigns, \"{code} · Wider\" and \"{code} · Retargeting\", would be today. Per show: the stretch and share; Wider's lifetime, end date and £ a day; Retargeting's £ a day and its split (Similar, Cold, Warm, Hot); audiences made, to make and missing advertiser access; the venue, promoter and lineup Pages it matched. With one code, the destination and the ads: the show's live ads or the Drive creatives given, and the Page they run from (an Electric show's city Page by default). Then, when they apply: Similar skipped and why, presale sign-ups left out, each existing prospecting campaign as keep, pause or fold into Wider, and the next stretch as a scheduled change. A show that can't be built is one skipped line with the reason. Nothing is sent to Meta or saved.");
  assert.equal(createShowCampaignsTool.description, "Makes one show's two campaigns as plan_retargeting plans them: \"{code} · Wider\" (Advantage+ audience, lifetime budget) and \"{code} · Retargeting\" (Similar, Cold, Warm and Hot, daily budgets), the missing audiences, and the ads: the show's live ads with its current copy, or the Drive creatives given, run from identity's Page (an Electric show's city Page by default). mode paused makes both paused and moves nothing. mode live checks the show's ceiling, switches both on and schedules each later stretch step (Retargeting up, Wider's remaining lifetime down). It's refused while the show's existing prospecting still runs; pausing or folding that is Matas's yes, and this tool never does it. Asked again, it carries on from what's made; a paused build asked as live goes live. Needs Matas's yes in this chat: ask him the show, paused or live, Wider's lifetime and Retargeting's £ a day, then pass approval with your question (asked) and his reply word for word (answer).");
});

test("Louder / Parable is held (Matas, 27 Nov): one held show is refused by plan_retargeting and by create_show_campaigns, before any read", async () => {
  const { ctx, calls } = ctxWith([record()], { held: ["20261204CSA"] });
  await refused(run(planRetargetingTool, ctx, { events: "20261204CSA" }), /^Refused: Louder \/ Parable is held for now\. Nothing was changed\.$/);
  await refused(run(createShowCampaignsTool, ctx, { event: "20261204CSA", mode: "paused", approval: YES }), /^Refused: Louder \/ Parable is held for now\. Nothing was changed\.$/);
  assert.deepEqual(calls.read, []);
  assert.deepEqual(calls.create, []);
});

test("Louder / Parable is held: in a list its show is left out with the line at the top; the rest are planned", async () => {
  const { ctx, calls } = ctxWith([record()], { held: ["20261204CSA"] });
  const lines = String(((await run(planRetargetingTool, ctx, { events: ["NX26-RUDIMENTAL", "20261204CSA"] })).data as { message: string }).message).split("\n");
  assert.equal(lines[0], "Louder / Parable is held for now, so its shows are left out.");
  assert.match(lines[1]!, /^NX26-RUDIMENTAL · final month/);
  assert.ok(!lines.some((line) => line.startsWith("20261204CSA")));
  assert.deepEqual((calls.read[0] as { codes: string[] }).codes, ["NX26-RUDIMENTAL"]);
});

// ── The connector's limits (Matas, 27 Nov: plan_retargeting timed out on prod) ──

const notFinished = (code: string, why: "show" | "total" = "show") => ({ eventId: `id-${code}`, eventCode: code, why });

test("plan_retargeting(live): shows not finished in time are counted, named after the head line, and never waited for", async () => {
  const { ctx } = ctxWith([record()], { unfinished: [notFinished("NX26-SLOW"), notFinished("NX26-LATE", "total")] });
  const out = await run(planRetargetingTool, ctx, { events: "live" });
  const data = out.data as { message: string; shows: { code: string; skipped: string | null; lines: string[] }[] };
  const lines = data.message.split("\n");
  assert.equal(lines[1], "3 shows on sale: 1 to build, 0 skipped.");
  assert.equal(lines[2], "2 shows weren’t finished in time, so they aren’t shown: NX26-SLOW, NX26-LATE. Ask again with their codes.");
  assert.deepEqual(data.shows.filter((row) => row.skipped === "not_finished").map((row) => row.code), ["NX26-SLOW", "NX26-LATE"]);
  assert.equal((out.summary as { unfinished: number }).unfinished, 2);
});

test("plan_retargeting(one code): a show not finished in time says so on its own line, not 'not on sale'", async () => {
  const { ctx } = ctxWith([], { unfinished: [notFinished("NX26-RUDIMENTAL")] });
  const out = await run(planRetargetingTool, ctx, { events: "NX26-RUDIMENTAL" });
  assert.equal((out.data as { message: string }).message, "NX26-RUDIMENTAL wasn’t finished in time, so it isn’t shown. Try again.");
});

test("plan_retargeting: a show's reads that ran out close its lines; the purchase read running out opens the answer", async () => {
  const partial = { ...record(), notRead: ["pages", "hosts"] as ("pages" | "hosts")[] };
  const { ctx } = ctxWith([partial], { notRead: ["purchases"] });
  const lines = String(((await run(planRetargetingTool, ctx, { events: "NX26-RUDIMENTAL" })).data as { message: string }).message).split("\n");
  assert.equal(lines[0], "Not read in time, so not shown: the purchases on each show’s pixel. Try again.");
  assert.equal(lines.at(-1), "Not read in time, so not shown: the venue, promoter and lineup Pages and the pixel’s sites. Try again.");
});

test("create_show_campaigns: refused when its show wasn't read in full in time, before anything is made", async () => {
  const late = ctxWith([], { unfinished: [notFinished("NX26-RUDIMENTAL")] });
  await refused(run(createShowCampaignsTool, late.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES }), /^Refused: NX26-RUDIMENTAL couldn’t be read in time, so nothing was made\. Try again\.$/);
  assert.deepEqual(late.calls.create, []);
  const partial = ctxWith([{ ...record(), notRead: ["prospecting"] }]);
  await refused(run(createShowCampaignsTool, partial.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES }), /^Refused: NX26-RUDIMENTAL couldn’t be read in time/);
  assert.deepEqual(partial.calls.create, []);
  const front = ctxWith([record()], { notRead: ["purchases"] });
  await refused(run(createShowCampaignsTool, front.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES }), /couldn’t be read in time/);
  assert.deepEqual(front.calls.create, []);
});

// ── Matas, 27 Nov: one destination for every ad in both campaigns ──

const RUDIMENTAL_DEST = { link: "https://www.rudimental-newcastle.com/", url_tags: "ref=meta&utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{adset.name}}&utm_term={{ad.name}}" };
const STORED_DEST = { link: RUDIMENTAL_DEST.link, urlTags: RUDIMENTAL_DEST.url_tags };

test("plan_retargeting(one code, destination): the plan line shows it; with 'live' it's refused before any read", async () => {
  const { ctx, calls } = ctxWith([record()]);
  const lines = String(((await run(planRetargetingTool, ctx, { events: "NX26-RUDIMENTAL", destination: RUDIMENTAL_DEST })).data as { message: string }).message).split("\n");
  assert.equal(lines.at(-1), "Ads: the show’s one live ad, copied into both campaigns, run from NX LOVES and Instagram nxloves (the Electric group’s Page for Newcastle).");
  assert.equal(lines.at(-2), "Destination: https://www.rudimental-newcastle.com/ · URL parameters ref=meta&utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{adset.name}}&utm_term={{ad.name}}");
  const again = ctxWith([record()]);
  await refused(run(planRetargetingTool, again.ctx, { events: "live", destination: RUDIMENTAL_DEST }), /^Refused: a destination is for one show at a time, so give one event code\. Nothing was changed\.$/);
  assert.deepEqual(again.calls.read, []);
  assert.equal(calls.read.length, 1);
});

test("create_show_campaigns(destination): the build carries the link and url_tags as written; a bad one is refused before any read", async () => {
  const { ctx, calls } = ctxWith([record()]);
  await run(createShowCampaignsTool, ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES, destination: RUDIMENTAL_DEST });
  assert.deepEqual(calls.create[0]!.build.destination, STORED_DEST);
  const bad = ctxWith([record()]);
  await refused(run(createShowCampaignsTool, bad.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES, destination: { link: "http://www.rudimental-newcastle.com/" } }), /^Refused: the destination link must be a full https:\/\/ web address\. Nothing was changed\.$/);
  await refused(run(createShowCampaignsTool, bad.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES, destination: { link: RUDIMENTAL_DEST.link, url_tags: "?utm_source=meta" } }), /^Refused: url_tags must be URL parameters/);
  assert.deepEqual([bad.calls.read, bad.calls.create], [[], []]);
});

test("create_show_campaigns asked again: the stored destination carries on; another one is refused once ads are made, taken while none are", async () => {
  const stored = { ...(record().plan.build as FunnelBuild), destination: STORED_DEST };
  // Asked again with no destination: carries on with the one it was made with.
  const resumed = ctxWith([record()], { build: { build: stored, mode: "paused", state: "failed", progress: { campaignId: "1", ads: ["141"] }, meta_campaign_id: "1" } });
  await run(createShowCampaignsTool, resumed.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES });
  assert.deepEqual(resumed.calls.create[0]!.build.destination, STORED_DEST);
  // Another destination once ads are made: refused, nothing changed.
  const other = { link: "https://www.skiddle.com/e/1" };
  const made = ctxWith([record()], { build: { build: stored, mode: "paused", state: "failed", progress: { campaignId: "1", ads: ["141"] }, meta_campaign_id: "1" } });
  await refused(run(createShowCampaignsTool, made.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES, destination: other }), /^Refused: NX26-RUDIMENTAL’s ads are already made with https:\/\/www\.rudimental-newcastle\.com\/ as their destination, and create_show_campaigns doesn’t change ads that are made\. Nothing was changed\.$/);
  assert.deepEqual(made.calls.create, []);
  // No ad made yet: the new destination is the one it carries on with.
  const early = ctxWith([record()], { build: { build: stored, mode: "paused", state: "failed", progress: { campaignId: "1" }, meta_campaign_id: "1" } });
  await run(createShowCampaignsTool, early.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES, destination: other });
  assert.deepEqual(early.calls.create[0]!.build.destination, { link: other.link, urlTags: null });
});

test("design's input descriptions for destination (re-ruled with #1410's list), link and url_tags (27 Nov, on #1409), word for word, straight marks", () => {
  for (const tool of [planRetargetingTool, createShowCampaignsTool]) {
    const destination = (tool.inputSchema as unknown as Record<string, { description?: string; unwrap(): { shape: Record<string, { description?: string; unwrap?: () => { description?: string } }> } }>).destination!;
    assert.equal(destination.description, "Optional, one show only: one destination for every ad in both campaigns, copied or from Drive. It sets only the link and URL parameters; copy, media and the Page come from the ads, creatives and identity. Once ads are made it can't be changed.");
    const shape = destination.unwrap().shape;
    assert.equal(shape.link!.description, "The https:// web address every ad in both campaigns links to.");
    assert.equal(shape.url_tags!.description ?? shape.url_tags!.unwrap?.().description, "Meta's URL parameters for every ad, with no leading ?, e.g. utm_source=meta&utm_campaign={{campaign.name}}. Kept exactly as written: Meta fills in {{campaign.name}}, {{adset.name}} and {{ad.name}}.");
  }
});

// Matas, 27 Nov: the Electric group's on-sale ad sets optimise on InitiateCheckout (PENDING DESIGN words).
test("optimise_on: an Electric show builds on InitiateCheckout by default; asked for purchase, on Purchase; another client on Purchase", async () => {
  const nx = ctxWith([record()]);
  await run(createShowCampaignsTool, nx.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES });
  assert.deepEqual([nx.calls.create[0]!.build.optimiseOn, nx.calls.create[0]!.build.checkout], ["initiate_checkout", "seen"]);
  const asked = ctxWith([record()]);
  const out = await run(createShowCampaignsTool, asked.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES, optimise_on: "purchase" });
  assert.equal(asked.calls.create[0]!.build.optimiseOn, "purchase");
  assert.equal(String((out.data as { message: string }).message).split("\n")[1], "Optimises on: Purchase.");
  assert.equal((out.summary as { optimisedOn: string }).optimisedOn, "PURCHASE");
  const other = ctxWith([record({ eventCode: "P26-BDAY" })]);
  const lines = String(((await run(planRetargetingTool, other.ctx, { events: "P26-BDAY" })).data as { message: string }).message).split("\n");
  assert.ok(lines.includes("Optimises on: Purchase."), lines.join("\n"));
  const overridden = String(((await run(planRetargetingTool, other.ctx, { events: "P26-BDAY", optimise_on: "initiate_checkout" })).data as { message: string }).message).split("\n");
  assert.ok(overridden.includes("Optimises on: InitiateCheckout."), overridden.join("\n"));
});

test("optimise_on: a pixel with no InitiateCheckout in 28 days, or one not read, is refused before anything is sent; Purchase still builds", async () => {
  const none = ctxWith([record({ pixelHosts: { any: ["skiddle.com"], pageView: ["skiddle.com"], checkout: [], registration: [] } })]);
  const e = await refused(run(createShowCampaignsTool, none.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES }), /^Refused: NX26-RUDIMENTAL’s pixel had no InitiateCheckout in the last 28 days, so the ad sets would have nothing to optimise on\. Pass optimise_on "purchase" to build on Purchase\. Nothing was sent to Meta\.$/);
  assert.equal((e.summary as { refused: string }).refused, "no_checkout");
  const unread = ctxWith([record({ pixelHosts: null })]);
  await refused(run(createShowCampaignsTool, unread.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES }), /^Refused: NX26-RUDIMENTAL’s pixel’s InitiateCheckout couldn’t be read in time, so nothing was built\. Asking again tries it\. Nothing was sent to Meta\.$/);
  assert.deepEqual([...none.calls.create, ...unread.calls.create], []);
  const plan = String(((await run(planRetargetingTool, none.ctx, { events: "NX26-RUDIMENTAL" })).data as { message: string }).message);
  assert.match(plan, /\nOptimises on: InitiateCheckout\.\nNX26-RUDIMENTAL’s pixel had no InitiateCheckout in the last 28 days, so create_show_campaigns would refuse it\./);
  await run(createShowCampaignsTool, none.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES, optimise_on: "purchase" });
  assert.equal(none.calls.create[0]!.build.optimiseOn, "purchase");
});

test("optimise_on: NX26-RUDIMENTAL's paused build with no ad sets yet carries on on InitiateCheckout; one whose ad sets exist keeps their event and says so", async () => {
  const stored = { ...(record().plan.build as FunnelBuild), optimiseOn: undefined, checkout: undefined };
  const progress = { campaignId: "120252781594470755", audiences: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`k${i}`, String(i)])) };
  const builtNoSets = record({ funnelBuilt: { state: "failed", mode: "paused", campaignId: "120252781594470755", tiers: { similar: 0, cold: 0, warm: 0, hot: 0 }, took: [], adSetsMade: false, optimisedOn: null } });
  const rud = ctxWith([builtNoSets], { build: { build: stored, mode: "paused", state: "failed", progress, meta_campaign_id: "120252781594470755" } });
  const plan = String(((await run(planRetargetingTool, rud.ctx, { events: "NX26-RUDIMENTAL" })).data as { message: string }).message).split("\n");
  assert.deepEqual(plan, ["NX26-RUDIMENTAL · skipped: it already has a Wider or Retargeting campaign.", "Optimises on: InitiateCheckout."]);
  await run(createShowCampaignsTool, rud.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES });
  assert.deepEqual([rud.calls.create[0]!.build.optimiseOn, rud.calls.create[0]!.build.checkout], ["initiate_checkout", "seen"]);
  // Ad sets made before 27 Nov (Purchase): kept, and asking for InitiateCheckout says so.
  const made = ctxWith([record()], { build: { build: stored, mode: "paused", state: "failed", progress: { ...progress, adSets: { cold: { id: "131", dailyMinor: 630 } } }, meta_campaign_id: "120252781594470755" } });
  const out = await run(createShowCampaignsTool, made.ctx, { event: "NX26-RUDIMENTAL", mode: "paused", approval: YES, optimise_on: "initiate_checkout" });
  const lines = String((out.data as { message: string }).message).split("\n");
  assert.deepEqual(lines.slice(1, 3), ["Optimises on: Purchase. NX26-RUDIMENTAL’s ad sets were made on it, so they keep it; nothing on them is changed.", "Asked for InitiateCheckout, but NX26-RUDIMENTAL’s ad sets were made on Purchase, so they keep it; nothing on them is changed."]);
  assert.equal(made.calls.create[0]!.build.optimiseOn, "purchase");
});
