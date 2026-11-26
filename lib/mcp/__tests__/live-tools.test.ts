/**
 * M3b's live tools: the approval and scope first, the ceiling on every
 * change that starts or raises spend, only each tool's own path called
 * (spies), a retry of the same ask never writing twice, and scheduled
 * budget changes applied once at their time, skipped when the object
 * changed, never when cancelled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { META_TOOLS } from "../tools/index.ts";
import { getLiveTool } from "../tools/live-read.ts";
import { pauseTool, resumeTool } from "../tools/live-status.ts";
import { cancelScheduledTool, listScheduledTool, moveBudgetTool, setBudgetTool } from "../tools/live-budget.ts";
import { renameTool } from "../tools/live-rename.ts";
import { addAudienceToStageTool, addCreativesToStageTool } from "../tools/live-stage.ts";
import { createSplitTestTool } from "../tools/live-test.ts";
import { runScheduledChanges } from "../live/scheduled.ts";
import { LIVE_WORDS } from "../live/words.ts";
import { OPERATOR } from "./helpers.ts";
import {
  ACT2,
  AD_1,
  AS_B1,
  AS_BROAD,
  AS_C1,
  AS_FANS,
  AUD,
  CAMP_A,
  CAMP_B,
  CAMP_C,
  CAMP_NODRAFT,
  CODE,
  DRAFT_A,
  NOW,
  YES,
  liveCtx,
  writes,
} from "./live-fixtures.ts";

async function run(tool: McpTool, ctx: ToolContext, args: Record<string, unknown>) {
  return tool.run(ctx, args);
}

async function refused(p: Promise<unknown>, re: RegExp): Promise<ToolInputError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ToolInputError, `a plain refusal, got ${e instanceof Error ? e.message : e}`);
    assert.match(e.message, re);
    assert.doesNotMatch(e.message, /raw, must never reach Claude/);
    return e;
  }
  assert.fail("expected a refusal");
}

const CHANGERS: Array<[McpTool, Record<string, unknown>]> = [
  [pauseTool, { event: CODE, kind: "ad_set", id: AS_BROAD }],
  [resumeTool, { event: CODE, kind: "ad_set", id: AS_BROAD }],
  [setBudgetTool, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 40 }],
  [moveBudgetTool, { event: CODE, from_ad_set: AS_BROAD, to_ad_set: AS_FANS, gbp_a_day: 5 }],
  [renameTool, { event: CODE, kind: "ad", id: AD_1, name: "New" }],
  [addCreativesToStageTool, { event: CODE, stage: "on_sale", draft_creative_ids: ["cr-1"] }],
  [addAudienceToStageTool, { event: CODE, stage: "on_sale", audience_ids: [AUD] }],
  [createSplitTestTool, { event: CODE, campaign_ids: [CAMP_A, CAMP_B], start: "2026-11-27T00:00:00Z", end: "2026-12-10T00:00:00Z", name: "T" }],
  [cancelScheduledTool, { id: "5c000000-0000-4000-8000-000000000001" }],
];

test("every M3b change refuses with no approval, an empty one or one over 1,000 characters, before anything is read or sent", async () => {
  for (const [tool, args] of CHANGERS) {
    for (const approval of [undefined, {}, { asked: "Pause it?", answer: "" }, { asked: "x".repeat(1001), answer: "yes" }]) {
      const { ctx, db, spy } = liveCtx({ ceiling: 5000 });
      const e = await refused(run(tool, ctx, { ...args, approval }), /^Refused: there’s no approval with this\./);
      assert.match(String(e.summary?.refused), /^(no_approval|approval_too_long)$/, tool.name);
      assert.deepEqual(spy.calls, [], `${tool.name}: nothing read or sent`);
      assert.deepEqual(db.writes, [], `${tool.name}: nothing written`);
    }
  }
});

test("a grant without mcp:meta, or a user no longer Matas, is refused by every M3b tool, the reads too", async () => {
  const all: Array<[McpTool, Record<string, unknown>]> = [...CHANGERS.map(([t, a]) => [t, { ...a, approval: YES }] as [McpTool, Record<string, unknown>]), [getLiveTool, { event: CODE }], [listScheduledTool, { event: CODE }]];
  for (const opts of [{ scope: "mcp:read mcp:draft" }, { isMatas: false }]) {
    for (const [tool, args] of all) {
      const { ctx, spy } = liveCtx({ ceiling: 5000, ...opts });
      await refused(run(tool, ctx, args), /^Refused: this connection can’t make Meta changes\./);
      assert.deepEqual(spy.calls, [], tool.name);
    }
  }
  assert.equal(META_TOOLS.length, 14);
});

// ── pause / resume ──────────────────────────────────────────────────────────

test("pause: the ad-set status write, keyed on the ask, on the campaign's published draft; a retry is a no-op", async () => {
  const { ctx, spy } = liveCtx();
  const out = await run(pauseTool, ctx, { event: CODE, kind: "ad_set", id: AS_BROAD, approval: YES });
  const sent = writes(spy);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.method, "setStatus");
  assert.deepEqual({ ...sent[0]!.input, key: "k" }, { userId: OPERATOR, kind: "adset", id: AS_BROAD, status: "PAUSED", ledger: { draftId: DRAFT_A, eventId: sent[0]!.input.ledger && (sent[0]!.input.ledger as { eventId: string }).eventId }, key: "k" });
  assert.equal((out.data as { change: string }).change, "Broad: live → paused");
  assert.equal((out.data as { message: string }).message, `Done: 1 ad set changed · ${AS_BROAD}.`);
  // Same ask again: Meta shows it paused, nothing is sent.
  const again = await run(pauseTool, ctx, { event: CODE, kind: "ad_set", id: AS_BROAD, approval: YES });
  assert.equal((again.data as { message: string }).message, LIVE_WORDS.samePaused("Broad"));
  assert.equal(writes(spy).length, 1);
});

test("pause: switched off, outside the event, a campaign with no draft, or a raw Meta failure: plain refusals, nothing sent", async () => {
  {
    const { ctx, spy } = liveCtx();
    spy.switches.adsetStatus = false;
    await refused(run(pauseTool, ctx, { event: CODE, kind: "ad_set", id: AS_BROAD, approval: YES }), /^Refused: this is switched off in Off\/Pixel\. Nothing was sent to Meta\.$/);
    assert.deepEqual(spy.calls, []);
  }
  {
    const { ctx, spy } = liveCtx();
    spy.objects.set("120000000000000099", { ...spy.objects.get(AS_BROAD)!, id: "120000000000000099", campaignId: "120000000000000098" });
    await refused(run(pauseTool, ctx, { event: CODE, kind: "ad_set", id: "120000000000000099", approval: YES }), /isn’t in DHB27-LIVE’s campaigns/);
    assert.equal(writes(spy).length, 0);
  }
  {
    const { ctx, spy } = liveCtx();
    await refused(run(pauseTool, ctx, { event: CODE, kind: "campaign", id: CAMP_NODRAFT, approval: YES }), /has no published draft on DHB27-LIVE/);
    assert.equal(writes(spy).length, 0);
  }
  {
    const { ctx, spy } = liveCtx();
    spy.failWrite = true;
    const e = await refused(run(pauseTool, ctx, { event: CODE, kind: "ad", id: AD_1, approval: YES }), /^Meta didn’t take it, so nothing changed\./);
    assert.equal(e.summary?.refused, "meta_failed");
  }
});

test("resume: paused outside Off/Pixel is refused unless the question says so; the ceiling is checked against the money a day it starts", async () => {
  const resumeArgs = { event: CODE, kind: "ad_set", id: AS_BROAD };
  {
    const { ctx, spy } = liveCtx({ ceiling: 5000 });
    spy.objects.get(AS_BROAD)!.status = "PAUSED";
    await refused(run(resumeTool, ctx, { ...resumeArgs, approval: { asked: "Resume Broad?", answer: "yes" } }), /was paused outside Off\/Pixel/);
    assert.equal(writes(spy).length, 0);
    // Said in the question: it runs.
    await run(resumeTool, ctx, { ...resumeArgs, approval: { asked: "Broad was paused in Ads Manager. Resume it at £30 a day?", answer: "yes" } });
    assert.deepEqual(writes(spy).map((c) => [c.method, c.input.status]), [["setStatus", "ACTIVE"]]);
  }
  {
    // Paused by the app (an earlier pause in the log): no mention needed.
    const { ctx, db, spy } = liveCtx({ ceiling: 5000 });
    spy.objects.get(AS_BROAD)!.status = "PAUSED";
    await db.from("mcp_actions").insert({ user_id: OPERATOR, tool: "pause", status: "done", result: { objectId: AS_BROAD }, created_at: "2026-11-25T10:00:00Z" });
    await run(resumeTool, ctx, { ...resumeArgs, approval: { asked: "Resume Broad?", answer: "yes" } });
    assert.equal(writes(spy).length, 1);
  }
  for (const [ceiling, re] of [
    [null, /^Refused: DHB27-LIVE has no spend ceiling, so nothing that starts or raises spend can run\./],
    // Without Broad the show commits £875.00; Broad back on adds £30 × 25 days.
    [1000, /^Refused: this would take DHB27-LIVE to £1,625\.00 committed, over its £1,000\.00 ceiling \(set for this show\)\. Committed is £0\.00 spent \(none yet\), plus £0\.00 left on live lifetime budgets and £1,625\.00 in live daily budgets to their end or the show, read from Meta now\. This change adds £750\.00\. Nothing was sent to Meta\.$/],
  ] as const) {
    const { ctx, spy } = liveCtx({ ceiling });
    spy.objects.get(AS_BROAD)!.status = "PAUSED";
    await refused(run(resumeTool, ctx, { ...resumeArgs, approval: { asked: "Broad was paused in Ads Manager; resume?", answer: "yes" } }), re);
    assert.equal(writes(spy).length, 0);
  }
  {
    // An account not in £: refused, ceilings are in £.
    const { ctx, spy } = liveCtx({ ceiling: 5000 });
    spy.objects.get(AS_C1)!.status = "PAUSED";
    await refused(run(resumeTool, ctx, { event: CODE, kind: "ad_set", id: AS_C1, approval: { asked: "Paused in Ads Manager; resume US set?", answer: "yes" } }), /spends in USD, and ceilings are in £/);
    assert.equal(writes(spy).length, 0);
  }
});

// ── set_budget and the scheduled changes ────────────────────────────────────

test("set_budget: down needs no ceiling; up is checked; the type must match; the budget write is called once per ask", async () => {
  {
    const { ctx, spy } = liveCtx({ ceiling: null });
    const out = await run(setBudgetTool, ctx, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 20, approval: YES });
    assert.equal((out.data as { change: string }).change, "Broad: £30.00 → £20.00 a day");
    const sent = writes(spy);
    assert.deepEqual(sent.map((c) => [c.method, c.input.field, c.input.minor, c.input.expectedMinor]), [["setBudget", "daily_budget", 2000, 3000]]);
    // The same ask again: Meta already shows £20, nothing more is sent.
    const again = await run(setBudgetTool, ctx, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 20, approval: YES });
    assert.match((again.data as { message: string }).message, /^Nothing changed: Broad is already at £20\.00 a day\.$/);
    assert.equal(writes(spy).length, 1);
  }
  {
    // £1,625.00 committed; Broad £30 → £40 adds £250.00 (25 days), → £35 adds £125.00.
    const { ctx, spy } = liveCtx({ ceiling: 1800 });
    const e = await refused(run(setBudgetTool, ctx, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 40, approval: YES }), /to £1,875\.00 committed, over its £1,800\.00 ceiling/);
    assert.deepEqual([e.summary?.refused, e.summary?.delta, e.summary?.after], ["over_ceiling", 250, 1875]);
    await run(setBudgetTool, ctx, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 35, approval: YES });
    assert.equal(writes(spy).length, 1);
  }
  {
    // Spent to date counts (ad_daily_insights): £200 spent + £1,625.00 committed is over £1,800.
    const { ctx, spy } = liveCtx({ ceiling: 1800, spent: 200 });
    await refused(run(setBudgetTool, ctx, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 31, approval: YES }), /to £1,850\.00 committed, over its £1,800\.00 ceiling \(set for this show\)\. Committed is £200\.00 spent \(to 25 Nov\), plus/);
    // A cut is never blocked, over the ceiling or not.
    await run(setBudgetTool, ctx, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 10, approval: YES });
    assert.equal(writes(spy).length, 1);
  }
  {
    const { ctx, spy } = liveCtx({ ceiling: 5000 });
    await refused(run(setBudgetTool, ctx, { event: CODE, kind: "ad_set", id: AS_BROAD, lifetime_gbp: 400, approval: YES }), /runs on a daily budget, so give daily_gbp/);
    await refused(run(setBudgetTool, ctx, { event: CODE, kind: "campaign", id: CAMP_A, daily_gbp: 40, approval: YES }), /budgets are set on its ad sets/);
    spy.switches.budget = false;
    await refused(run(setBudgetTool, ctx, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 10, approval: YES }), /switched off in Off\/Pixel/);
    assert.equal(writes(spy).length, 0);
  }
});

async function schedule(ctx: ToolContext, at: string, daily = 40) {
  const out = await run(setBudgetTool, ctx, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: daily, at, approval: { asked: `Raise Broad to £${daily} a day at ${at}?`, answer: "yes" } });
  return (out.data as { scheduled_id: string }).scheduled_id;
}

test("set_budget with at: Claude is told design's scheduled row, with londonWhen's time", async () => {
  const { ctx } = liveCtx({ ceiling: 5000 });
  const out = await run(setBudgetTool, ctx, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 40, at: "2026-11-26T18:00:00Z", approval: YES });
  const data = out.data as { message: string; scheduled_id: string };
  assert.equal(data.message, `Scheduled for Thu 26 Nov, 18:00 London time: Broad: £30.00 → £40.00 a day (change ${data.scheduled_id}). It runs only if nothing has changed by then. Cancel it with cancel_scheduled.`);
});

test("list_scheduled: a change with no recorded old amount reads \"Broad: to £40.00 a day\", never \"£0.00 →\"", async () => {
  const { ctx } = liveCtx({ ceiling: 5000 });
  const id = await schedule(ctx, "2026-11-26T18:00:00Z");
  await ctx.db.from("scheduled_meta_changes").update({ expected_minor: null }).eq("id", id);
  const listed = await run(listScheduledTool, ctx, { event: CODE });
  const line = (listed.data as { changes: Array<{ id: string; change: string }> }).changes.find((c) => c.id === id)!;
  assert.equal(line.change, "Broad: to £40.00 a day");
  assert.doesNotMatch(line.change, /£0\.00 →/);
  const out = await run(cancelScheduledTool, ctx, { id, approval: { asked: "Cancel it?", answer: "yes" } });
  assert.equal((out.data as { message: string }).message, "Cancelled the change due Thu 26 Nov, 18:00 London time: Broad: to £40.00 a day. It won’t run.");
});

test("set_budget with at: stored with the yes, nothing sent now; applied once at its time, ceiling checked again", async () => {
  const { ctx, db, spy } = liveCtx({ ceiling: 5000 });
  const id = await schedule(ctx, "2026-11-26T18:00:00Z");
  assert.equal(writes(spy).length, 0, "nothing sent at ask time");
  const row = (db as unknown as { writes: Array<{ table: string; rows: unknown }> }).writes.find((w) => w.table === "scheduled_meta_changes");
  assert.ok(row);
  const stored = (row!.rows as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual([stored.amount_minor, stored.expected_minor, stored.raises_spend, stored.approval_answer, stored.ledger_draft_id], [4000, 3000, true, "yes", DRAFT_A]);
  // The same ask twice is the same row.
  assert.equal(await schedule(ctx, "2026-11-26T18:00:00Z"), id);

  const before = await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-26T17:45:00Z"), shipped: true });
  assert.equal(before.due, 0);
  const at = await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-26T18:00:00Z"), shipped: true });
  assert.deepEqual([at.applied, at.skipped], [1, 0]);
  const again = await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-26T18:15:00Z"), shipped: true });
  assert.equal(again.due, 0, "applied once");
  const budgetWrites = writes(spy).filter((c) => c.method === "setBudget");
  assert.equal(budgetWrites.length, 1);
  assert.equal(budgetWrites[0]!.input.key, `scheduled:${id}`);
  const listed = await run(listScheduledTool, ctx, { event: CODE });
  assert.equal((listed.data as { changes: Array<{ state: string }> }).changes[0]!.state, "applied");
});

test("a scheduled change is skipped when the object changed since (budget edited, paused, ended), over the ceiling, or switched off; never forced", async () => {
  const cases: Array<[string, (spy: ReturnType<typeof liveCtx>["spy"], ctx: ToolContext) => Promise<void> | void]> = [
    ["budget_changed", (spy) => void (spy.objects.get(AS_BROAD)!.dailyBudgetMinor = 3500)],
    ["paused", (spy) => void (spy.objects.get(AS_BROAD)!.status = "PAUSED")],
    ["ended", (spy) => void (spy.objects.get(AS_BROAD)!.endTime = "2026-11-26T12:00:00Z")],
    ["switch", (spy) => void (spy.switches.budget = false)],
    ["ceiling", async (_spy, ctx) => void (await ctx.db.from("show_spend_ceilings").update({ total_gbp: 10 }).eq("total_gbp", 5000))],
  ];
  for (const [reason, change] of cases) {
    const { ctx, spy } = liveCtx({ ceiling: 5000 });
    await schedule(ctx, "2026-11-26T18:00:00Z");
    await change(spy, ctx);
    const out = await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-26T18:00:00Z"), shipped: true });
    assert.deepEqual([out.applied, out.skipped], [0, 1], reason);
    assert.equal(writes(spy).filter((c) => c.method === "setBudget").length, 0, reason);
    const listed = await run(listScheduledTool, ctx, { event: CODE });
    const line = (listed.data as { changes: Array<{ state: string; why?: string }> }).changes[0]!;
    assert.equal(line.state, "skipped", reason);
    assert.equal(line.why, LIVE_WORDS.skip[reason], reason);
  }
});

test("cancel_scheduled: a cancelled change never runs; cancelling twice changes nothing; an applied one can't be cancelled", async () => {
  const { ctx, spy } = liveCtx({ ceiling: 5000 });
  const id = await schedule(ctx, "2026-11-26T18:00:00Z");
  const out = await run(cancelScheduledTool, ctx, { id, approval: { asked: "Cancel it?", answer: "yes" } });
  assert.match((out.data as { message: string }).message, /^Cancelled the change due Thu 26 Nov, 18:00 London time: Broad: £30\.00 → £40\.00 a day\. It won’t run\.$/);
  await run(cancelScheduledTool, ctx, { id, approval: { asked: "Cancel it?", answer: "yes" } });
  const ran = await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-27T00:00:00Z"), shipped: true });
  assert.equal(ran.due, 0);
  assert.equal(writes(spy).filter((c) => c.method === "setBudget").length, 0);

  const id2 = await schedule(ctx, "2026-11-26T19:00:00Z", 45);
  await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-26T19:00:00Z"), shipped: true });
  await refused(run(cancelScheduledTool, ctx, { id: id2, approval: { asked: "Cancel it?", answer: "yes" } }), /^Refused: change [0-9a-f-]+ is no longer scheduled \(applied\)\. Nothing was changed\.$/);
  await refused(run(cancelScheduledTool, ctx, { id: "5c000000-0000-4000-8000-000000000009", approval: { asked: "Cancel it?", answer: "yes" } }), /there’s no scheduled change/);
});

test("set_budget at: refused in the past, without a zone, or too far ahead", async () => {
  const { ctx } = liveCtx({ ceiling: 5000 });
  for (const at of ["2026-11-26T09:00:00Z", "2026-11-26T18:00:00", "2027-03-01T10:00:00Z", "2026-11-26T10:05:00Z"]) {
    await refused(run(setBudgetTool, ctx, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 40, at, approval: YES }), /^Refused: give at as a time with its zone, at least 15 minutes and at most 60 days ahead\. Nothing was scheduled\.$/);
  }
});

// ── move_budget ─────────────────────────────────────────────────────────────

test("move_budget: within one campaign through the refresh's move, the receiving side under the ceiling; a retry never moves twice", async () => {
  const { ctx, db, spy } = liveCtx({ ceiling: 5000 });
  const args = { event: CODE, from_ad_set: AS_BROAD, to_ad_set: AS_FANS, gbp_a_day: 5, approval: { asked: "Move £5 a day Broad → Fans?", answer: "yes" } };
  const out = await run(moveBudgetTool, ctx, args);
  assert.equal((out.data as { change: string }).change, "£5.00 a day: Broad → Fans");
  const moves = writes(spy).filter((c) => c.method === "moveBudget");
  assert.equal(moves.length, 1);
  assert.deepEqual([moves[0]!.input.campaignId, moves[0]!.input.deltaMinor, (moves[0]!.input.ledger as { draftId: string }).draftId], [CAMP_A, 500, DRAFT_A]);
  // The server logs the done row; the same ask again finds it and sends nothing.
  await db.from("mcp_actions").insert({ user_id: OPERATOR, tool: "move_budget", status: "done", result: out.summary, created_at: "2026-11-26T10:00:01Z" });
  const again = await run(moveBudgetTool, ctx, args);
  assert.equal((again.data as { changed?: boolean }).changed, false);
  assert.equal(writes(spy).filter((c) => c.method === "moveBudget").length, 1);
});

test("move_budget: a failed first try's plan is reused; across campaigns, under the floor, or no ceiling: refused", async () => {
  {
    const { ctx, db, spy } = liveCtx({ ceiling: 5000 });
    const args = { event: CODE, from_ad_set: AS_BROAD, to_ad_set: AS_FANS, gbp_a_day: 5, approval: { asked: "Move £5?", answer: "yes" } };
    const { callKey } = await import("../live/resolve.ts");
    const key = callKey("move_budget", args, args.approval);
    const plan = { fromAdsetId: AS_BROAD, toAdsetId: AS_FANS, deltaMinor: 500, from: { before: 3500, after: 3000 }, to: { before: 2000, after: 2500 } };
    await db.from("mcp_actions").insert({ user_id: OPERATOR, tool: "move_budget", status: "failed", result: { key, plan, written: [AS_BROAD] }, created_at: "2026-11-26T09:59:00Z" });
    await run(moveBudgetTool, ctx, args);
    assert.deepEqual(writes(spy).find((c) => c.method === "moveBudget")!.input.previous, plan);
  }
  for (const [args, re, ceiling] of [
    [{ from_ad_set: AS_BROAD, to_ad_set: AS_B1, gbp_a_day: 5 }, /both ad sets must be in the same campaign/, 500],
    [{ from_ad_set: AS_BROAD, to_ad_set: AS_FANS, gbp_a_day: 29.5 }, /under £1\.00 a day/, 500],
  ] as const) {
    const { ctx, spy } = liveCtx({ ceiling });
    await refused(run(moveBudgetTool, ctx, { event: CODE, ...args, approval: YES }), re);
    assert.equal(writes(spy).length, 0);
  }
  {
    // A move that doesn't raise committed spend (both run to show day) needs no ceiling.
    const { ctx, spy } = liveCtx({ ceiling: null });
    await run(moveBudgetTool, ctx, { event: CODE, from_ad_set: AS_BROAD, to_ad_set: AS_FANS, gbp_a_day: 5, approval: YES });
    assert.equal(writes(spy).filter((c) => c.method === "moveBudget").length, 1);
  }
  {
    // One that does (Broad ends in 3 days, Fans runs to show day: +£5 × 22 days) is refused without one.
    const { ctx, spy } = liveCtx({ ceiling: null });
    spy.objects.get(AS_BROAD)!.endTime = "2026-11-28T23:00:00Z";
    const e = await refused(run(moveBudgetTool, ctx, { event: CODE, from_ad_set: AS_BROAD, to_ad_set: AS_FANS, gbp_a_day: 5, approval: YES }), /^Refused: DHB27-LIVE has no spend ceiling/);
    assert.equal(e.summary?.delta, 110);
    assert.equal(writes(spy).length, 0);
  }
});

// ── rename ──────────────────────────────────────────────────────────────────

test("rename: the name write once, the same name is a no-op, no ceiling read", async () => {
  const { ctx, spy } = liveCtx({ ceiling: null });
  const out = await run(renameTool, ctx, { event: CODE, kind: "ad", id: AD_1, name: "Teaser 1 — v2", approval: YES });
  assert.equal((out.data as { message: string }).message, "Renamed: Teaser 1 → Teaser 1 — v2.");
  const again = await run(renameTool, ctx, { event: CODE, kind: "ad", id: AD_1, name: "Teaser 1 — v2", approval: YES });
  assert.equal((again.data as { changed: boolean }).changed, false);
  assert.deepEqual(writes(spy).map((c) => c.method), ["rename"]);
  await refused(run(renameTool, ctx, { event: CODE, kind: "ad", id: AD_1, name: "x".repeat(401), approval: YES }), /at most 400 characters/);
});

// ── add_creatives_to_stage ──────────────────────────────────────────────────

test("add_creatives_to_stage: bulk-attach with the tree run, paused by default, files sent first; a retry is the same run", async () => {
  const { ctx, spy } = liveCtx({ ceiling: null });
  const args = { event: CODE, stage: "on_sale", draft_creative_ids: ["cr-1"], approval: { asked: "Add Teaser 1 to On sale, 2 ad sets, paused?", answer: "yes" } };
  const out = await run(addCreativesToStageTool, ctx, args);
  const order = spy.calls.filter((c) => ["sendAssets", "bulkAttach"].includes(c.method)).map((c) => c.method);
  assert.deepEqual(order, ["sendAssets", "bulkAttach"]);
  const body = spy.calls.find((c) => c.method === "bulkAttach")!.input.body as Record<string, unknown>;
  assert.equal(body.createPaused, true);
  assert.equal((body.tree as { stage: string }).stage, "on_sale");
  // The live campaigns' live ad sets only: A's two; B's one (C is on another account and isn't the stage's).
  assert.deepEqual(body.campaignAdSets, { [CAMP_A]: [AS_BROAD, AS_FANS], [CAMP_B]: [AS_B1] });
  assert.equal((out.data as { mode: string }).mode, "It’s paused: nothing spends until it’s switched on.");
  await run(addCreativesToStageTool, ctx, args);
  const runs = spy.calls.filter((c) => c.method === "bulkAttach").map((c) => ((c.input.body as Record<string, unknown>).tree as { runId: string }).runId);
  assert.equal(runs[0], runs[1], "the same ask is the same tree run, so the ledger answers it");
});

test("add_creatives_to_stage: live checks the ceiling first; switched off, an unknown creative or a stage with nothing to add: refused", async () => {
  {
    const { ctx, spy } = liveCtx({ ceiling: null });
    await refused(run(addCreativesToStageTool, ctx, { event: CODE, stage: "on_sale", draft_creative_ids: ["cr-1"], live: true, approval: YES }), /has no spend ceiling/);
    assert.equal(writes(spy).length, 0);
  }
  {
    // Live ads on a show already committed past its ceiling: refused before any file moves.
    const { ctx, spy } = liveCtx({ ceiling: 1000 });
    await refused(run(addCreativesToStageTool, ctx, { event: CODE, stage: "on_sale", draft_creative_ids: ["cr-1"], ad_set_ids: [AS_BROAD], live: true, approval: YES }), /to £1,625\.00 committed, over its £1,000\.00 ceiling/);
    assert.equal(writes(spy).length, 0);
  }
  {
    const { ctx, spy } = liveCtx({ ceiling: 1625 });
    await run(addCreativesToStageTool, ctx, { event: CODE, stage: "on_sale", draft_creative_ids: ["cr-1"], ad_set_ids: [AS_BROAD], live: true, approval: YES });
    const body = spy.calls.find((c) => c.method === "bulkAttach")!.input.body as Record<string, unknown>;
    assert.equal(body.createPaused, false);
    assert.deepEqual(body.campaignAdSets, { [CAMP_A]: [AS_BROAD] });
  }
  for (const [args, re, off] of [
    [{ stage: "on_sale", draft_creative_ids: ["cr-1"] }, /switched off/, true],
    [{ stage: "on_sale", draft_creative_ids: ["nope"] }, /there’s no ad nope on DHB27-LIVE’s drafts/, false],
    [{ stage: "signup", draft_creative_ids: ["cr-1"] }, /has no Signup campaign Off\/Pixel can add to/i, false],
    [{ stage: "on_sale" }, /give draft_creative_ids, file_ids or pairs/, false],
  ] as const) {
    const { ctx, spy } = liveCtx({ ceiling: 5000 });
    if (off) spy.switches.treeAdd = false;
    await refused(run(addCreativesToStageTool, ctx, { event: CODE, ...args, approval: YES }), re);
    assert.equal(writes(spy).length, 0);
  }
});

// ── add_audience_to_stage ───────────────────────────────────────────────────

test("add_audience_to_stage: the targeting write per campaign's draft, include/add with the tree run; Advantage+ sets take it as a suggestion", async () => {
  const { ctx, spy } = liveCtx({ ceiling: null });
  const out = await run(addAudienceToStageTool, ctx, { event: CODE, stage: "on_sale", audience_ids: [AUD], approval: YES });
  const calls = writes(spy).filter((c) => c.method === "adsetAudience").map((c) => c.input.body as Record<string, unknown>);
  assert.equal(calls.length, 2);
  for (const b of calls) assert.deepEqual([b.direction, b.action, b.commit, b.audienceName], ["include", "add", true, "NX Signups"]);
  assert.deepEqual(calls.map((b) => b.draftId).sort(), [DRAFT_A, "d0000000-0000-4000-8000-00000000d002"]);
  assert.equal((out.data as { note?: string }).note, LIVE_WORDS.suggestions);
  assert.equal((out.data as { change: string }).change, "On sale: NX Signups into 3 ad sets");
  await refused(run(addAudienceToStageTool, ctx, { event: CODE, stage: "on_sale", audience_ids: ["230000000000000777"], approval: YES }), /isn’t one of this client’s audiences/);
});

// ── create_split_test ───────────────────────────────────────────────────────

test("create_split_test: two campaigns on one account, in no running study; the study made once through the ledgered path", async () => {
  const base = { event: CODE, start: "2026-11-27T00:00:00Z", end: "2026-12-10T00:00:00Z", name: "NX27 · A/B" };
  {
    const { ctx, spy } = liveCtx();
    const out = await run(createSplitTestTool, ctx, { ...base, campaign_ids: [CAMP_A, CAMP_B], approval: YES });
    const made = writes(spy).filter((c) => c.method === "createStudy");
    assert.equal(made.length, 1);
    assert.deepEqual([made[0]!.input.businessId, (made[0]!.input.study as { campaignA: string }).campaignA, (made[0]!.input.study as { campaignB: string }).campaignB], ["111", CAMP_A, CAMP_B]);
    assert.equal((out.data as { message: string }).message, "Done: 1 test created · study-1.");
  }
  {
    const { ctx, spy } = liveCtx();
    await refused(run(createSplitTestTool, ctx, { ...base, campaign_ids: [CAMP_A, CAMP_C], approval: YES }), /are on different ad accounts/);
    spy.studies.set(CAMP_B, "study-0");
    await refused(run(createSplitTestTool, ctx, { ...base, campaign_ids: [CAMP_A, CAMP_B], approval: YES }), /is already in a running test \(study-0\)/);
    await refused(run(createSplitTestTool, ctx, { ...base, campaign_ids: [CAMP_A, CAMP_A], approval: YES }), /takes two different campaigns/);
    await refused(run(createSplitTestTool, ctx, { ...base, end: "2027-06-01T00:00:00Z", campaign_ids: [CAMP_A, CAMP_B], approval: YES }), /^Refused: give start and end as times with their zone: start now or later, end after start, at most 90 days apart\. Nothing was sent to Meta\.$/);
    assert.equal(writes(spy).length, 0);
  }
});

// ── get_live ────────────────────────────────────────────────────────────────

test("get_live: per campaign, ad set and ad; money a day from a lifetime budget's remaining over London days left; the strict flag only where the draft asked for suggestions", async () => {
  const { ctx, spy } = liveCtx();
  Object.assign(spy.objects.get(AS_B1)!, { dailyBudgetMinor: null, lifetimeBudgetMinor: 50000, budgetRemainingMinor: 20000, endTime: "2026-11-30T22:59:00Z" });
  const out = await run(getLiveTool, ctx, { event: CODE });
  const data = out.data as { campaigns: Array<{ id: string; adSets: Array<{ id: string; flags?: string[]; budget: { moneyADay: number } | null; learning: string | null; targeting: { advantagePlus: boolean; customAudiences: string[]; ageSuggestion: unknown } }> }> };
  const a = data.campaigns.find((c) => c.id === CAMP_A)!;
  const broad = a.adSets.find((s) => s.id === AS_BROAD)!;
  const fans = a.adSets.find((s) => s.id === AS_FANS)!;
  assert.deepEqual(broad.flags, [LIVE_WORDS.strictFlag]);
  assert.equal(fans.flags, undefined);
  assert.deepEqual([broad.learning, broad.targeting.advantagePlus, broad.targeting.customAudiences], ["LEARNING", false, ["NX Signups"]]);
  assert.deepEqual(fans.targeting.ageSuggestion, { min: 25, max: 40 });
  // £200 left over 26–30 Nov in London (5 days): £40 a day.
  assert.equal(data.campaigns.find((c) => c.id === CAMP_B)!.adSets[0]!.budget!.moneyADay, 40);
  assert.equal(out.summary.strictFlagged, 1);
  assert.equal(writes(spy).length, 0, "read only");
  void ACT2;
  void NOW;
});
