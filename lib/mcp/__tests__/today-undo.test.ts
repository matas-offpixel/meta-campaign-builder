/**
 * Today's Undo (FC1, MB1): each pair runs live through the same writes the
 * live tools use, keyed "undo:{row}" — pause ↔ resume, a budget back (daily,
 * lifetime, scheduled), a move back, a rename back, a delete of paused
 * objects Claude made (confirmed once) — and nothing else has an Undo. An
 * Undo that starts spend meets the ceiling; an object changed since is left
 * alone; every press is one today_undo row, approved on Today.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pauseTool, resumeTool } from "../tools/live-status.ts";
import { moveBudgetTool, setBudgetTool } from "../tools/live-budget.ts";
import { renameTool } from "../tools/live-rename.ts";
import { addAudienceToStageTool, addCreativesToStageTool } from "../tools/live-stage.ts";
import { createSplitTestTool } from "../tools/live-test.ts";
import { runScheduledChanges } from "../live/scheduled.ts";
import { OPERATOR } from "./helpers.ts";
import { AD_1, AS_B1, AS_BROAD, AS_FANS, AUD, CAMP_A, CAMP_B, CLIENT, CODE, DRAFT_A, EVENT, YES, liveCtx, writes } from "./live-fixtures.ts";
import { MATAS_NAME, call, rowOf, todayLog, undo } from "./today-fixtures.ts";

const AT = "2026-11-26T10:00:00Z";
const PRESS = "2026-11-26T11:05:00Z";
const LATER = "2026-11-26T16:00:00Z";
const undoRows = (ctx: { db: { from: (t: string) => unknown } }) =>
  (ctx.db as unknown as { writes: Array<{ table: string; op: string; rows: unknown }> }).writes.filter((w) => w.table === "mcp_actions" && w.op === "insert").flatMap((w) => (Array.isArray(w.rows) ? w.rows : [w.rows]) as Array<Record<string, unknown>>).filter((r) => r.tool === "today_undo");

test("pause → Undo resumes it: the status write ACTIVE keyed undo:{row}, the ceiling checked; the row reads Undone by Matas; a second press does nothing", async () => {
  const { ctx, spy } = liveCtx({ ceiling: 500 });
  const a = await call(ctx, pauseTool, { event: CODE, kind: "ad_set", id: AS_BROAD, approval: YES }, AT);
  const before = writes(spy).length;
  assert.deepEqual(await undo(ctx, a.id, PRESS), { state: "undone" });
  const w = writes(spy).slice(before);
  assert.deepEqual(w.map((c) => [c.method, c.input.id, c.input.status, c.input.key]), [["setStatus", AS_BROAD, "ACTIVE", `undo:${a.id}`]]);
  assert.deepEqual((w[0]!.input.ledger as { draftId: string }).draftId, DRAFT_A);
  assert.ok(spy.calls.some((c) => c.method === "accountInfo"), "resuming starts spend: the ceiling's currency read ran");
  // One today_undo row: approved on Today by Matas, naming the row it undid.
  const [u] = undoRows(ctx);
  assert.deepEqual([u!.kind, u!.status, u!.approval_source, u!.approved_by, (u!.result as { undoOf: string }).undoOf], ["meta", "done", "today", OPERATOR, a.id]);
  const row = rowOf(await todayLog(ctx, LATER), a.id);
  assert.deepEqual([row.undo, row.note], [null, `Undone by ${MATAS_NAME} · Thu 26 Nov, 11:05`]);
  assert.deepEqual(await undo(ctx, a.id, PRESS), { state: "already" });
  assert.equal(writes(spy).length, before + 1);
});

test("pause → Undo with no ceiling: refused, nothing sent, the row reads FC-B's “Undo refused · {client} has no daily ceiling, and this starts spend”", async () => {
  const { ctx, spy } = liveCtx({ ceiling: null });
  const a = await call(ctx, pauseTool, { event: CODE, kind: "ad_set", id: AS_BROAD, approval: YES }, AT);
  const before = writes(spy).length;
  const out = await undo(ctx, a.id, PRESS);
  assert.deepEqual(out, { state: "refused", refused: "no_ceiling", reason: "NX Live has no daily ceiling, and this starts spend" });
  assert.equal(writes(spy).length, before);
  const row = rowOf(await todayLog(ctx, LATER), a.id);
  assert.deepEqual([row.undo, row.note], [null, "Undo refused · NX Live has no daily ceiling, and this starts spend"]);
});

test("resume → Undo pauses it (stops spend: no ceiling read)", async () => {
  const { ctx, spy } = liveCtx({ ceiling: 500 });
  spy.objects.get(AS_BROAD)!.status = "PAUSED";
  const r = await call(ctx, resumeTool, { event: CODE, kind: "ad_set", id: AS_BROAD, approval: { asked: "It was paused in Ads Manager; resume Broad?", answer: "yes" } }, AT);
  await ctx.db.from("client_spend_ceilings").update({ daily_gbp: 0 }).eq("client_id", CLIENT);
  const before = writes(spy).length;
  assert.deepEqual(await undo(ctx, r.id, PRESS), { state: "undone" });
  assert.deepEqual(writes(spy).slice(before).map((c) => [c.method, c.input.status]), [["setStatus", "PAUSED"]]);
});

test("budget → Undo puts it back: daily, lifetime and a scheduled change that ran; raising it back meets the ceiling", async () => {
  {
    const { ctx, spy } = liveCtx({ ceiling: 500 });
    const a = await call(ctx, setBudgetTool, { event: CODE, kind: "ad_set", id: AS_FANS, daily_gbp: 30, approval: YES }, AT);
    const before = writes(spy).length;
    assert.deepEqual(await undo(ctx, a.id, PRESS), { state: "undone" });
    const [w] = writes(spy).slice(before);
    assert.deepEqual([w!.method, w!.input.id, w!.input.field, w!.input.minor, w!.input.expectedMinor, w!.input.key], ["setBudget", AS_FANS, "daily_budget", 2000, 3000, `undo:${a.id}`]);
    assert.equal(spy.objects.get(AS_FANS)!.dailyBudgetMinor, 2000);
  }
  {
    // A budget lowered: Undo raises it, so it meets the ceiling.
    const { ctx, spy } = liveCtx({ ceiling: 25 });
    const a = await call(ctx, setBudgetTool, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 10, approval: YES }, AT);
    const before = writes(spy).length;
    assert.deepEqual(await undo(ctx, a.id, PRESS), { state: "refused", refused: "over_ceiling", reason: "it would take NX Live to £30.00 a day, over its £25.00 ceiling" });
    assert.equal(writes(spy).length, before);
  }
  {
    const { ctx, spy } = liveCtx({ ceiling: 5000 });
    Object.assign(spy.objects.get(AS_B1)!, { dailyBudgetMinor: null, lifetimeBudgetMinor: 50000, budgetRemainingMinor: 40000, endTime: "2026-12-20T00:00:00Z" });
    const a = await call(ctx, setBudgetTool, { event: CODE, kind: "ad_set", id: AS_B1, lifetime_gbp: 600, approval: YES }, AT);
    const before = writes(spy).length;
    assert.deepEqual(await undo(ctx, a.id, PRESS), { state: "undone" });
    const [w] = writes(spy).slice(before);
    assert.deepEqual([w!.input.field, w!.input.minor], ["lifetime_budget", 50000]);
  }
  {
    const { ctx, spy } = liveCtx({ ceiling: 500 });
    const out = await call(ctx, setBudgetTool, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 40, at: "2026-11-27T09:00:00Z", approval: YES }, AT);
    const id = (out.data as { scheduled_id: string }).scheduled_id;
    await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-27T09:05:00Z") });
    const before = writes(spy).length;
    assert.deepEqual(await undo(ctx, `scheduled:${id}`, "2026-11-27T10:00:00Z"), { state: "undone" });
    const [w] = writes(spy).slice(before);
    assert.deepEqual([w!.input.minor, w!.input.expectedMinor, w!.input.key], [3000, 4000, `undo:scheduled:${id}`]);
    assert.equal(rowOf(await todayLog(ctx, "2026-11-27T12:00:00Z"), id).note, `Undone by ${MATAS_NAME} · Fri 27 Nov, 10:00`);
  }
});

test("move → Undo moves the money back, from the receiver to the giver, the giver's new budget against the ceiling", async () => {
  const { ctx, spy } = liveCtx({ ceiling: 500 });
  const a = await call(ctx, moveBudgetTool, { event: CODE, from_ad_set: AS_BROAD, to_ad_set: AS_FANS, gbp_a_day: 5, approval: YES }, AT);
  const before = writes(spy).length;
  assert.deepEqual(await undo(ctx, a.id, PRESS), { state: "undone" });
  const [w] = writes(spy).slice(before);
  assert.deepEqual([w!.method, w!.input.fromAdsetId, w!.input.toAdsetId, w!.input.deltaMinor, w!.input.key], ["moveBudget", AS_FANS, AS_BROAD, 500, `undo:${a.id}`]);
  assert.deepEqual([spy.objects.get(AS_BROAD)!.dailyBudgetMinor, spy.objects.get(AS_FANS)!.dailyBudgetMinor], [3000, 2000]);
});

test("rename → Undo puts the old name back", async () => {
  const { ctx, spy } = liveCtx({ ceiling: null });
  const a = await call(ctx, renameTool, { event: CODE, kind: "ad", id: AD_1, name: "Teaser 1 — v2", approval: YES }, AT);
  const before = writes(spy).length;
  assert.deepEqual(await undo(ctx, a.id, PRESS), { state: "undone" });
  const [w] = writes(spy).slice(before);
  assert.deepEqual([w!.method, w!.input.id, w!.input.name, w!.input.key], ["rename", AD_1, "Teaser 1", `undo:${a.id}`]);
  assert.equal(spy.objects.get(AD_1)!.name, "Teaser 1");
});

test("paused objects Claude made → Undo deletes them, only after the one confirm, only while each is still paused", async () => {
  {
    const { ctx, spy } = liveCtx({ ceiling: null });
    const a = await call(ctx, addCreativesToStageTool, { event: CODE, stage: "on_sale", draft_creative_ids: ["cr-1"], ad_set_ids: [AS_BROAD, AS_FANS], approval: YES }, AT);
    for (const set of [AS_BROAD, AS_FANS]) spy.objects.set(`ad-${set}`, { ...spy.objects.get(AD_1)!, id: `ad-${set}`, status: "PAUSED", effectiveStatus: "PAUSED", adsetId: set });
    const before = writes(spy).length;
    assert.deepEqual(await undo(ctx, a.id, PRESS), { state: "confirm" });
    assert.equal(writes(spy).length, before, "nothing before the confirm");
    assert.deepEqual(await undo(ctx, a.id, PRESS, true), { state: "undone" });
    assert.deepEqual(writes(spy).slice(before).map((c) => [c.method, c.input.kind, c.input.id, c.input.status, c.input.key]), [
      ["setStatus", "ad", `ad-${AS_BROAD}`, "DELETED", `undo:${a.id}`],
      ["setStatus", "ad", `ad-${AS_FANS}`, "DELETED", `undo:${a.id}`],
    ]);
  }
  {
    // A paused launch: its campaign, on the launch's draft.
    const { ctx, spy } = liveCtx({ ceiling: null });
    const id = "6a000000-0000-4000-8000-000000000001";
    Object.assign(spy.objects.get(CAMP_A)!, { status: "PAUSED", effectiveStatus: "PAUSED" });
    await ctx.db.from("mcp_actions").insert({ id, user_id: OPERATOR, tool: "launch_draft", kind: "meta", status: "done", args: { draft_id: DRAFT_A, mode: "paused", approval: YES }, result: { draftId: DRAFT_A, mode: "paused", metaCampaignId: CAMP_A, campaignName: "[NX27-LIVE] ON SALE", adSetIds: [], adIds: [] }, event_id: EVENT, client_id: CLIENT, approved_at: AT, created_at: AT });
    const row = rowOf(await todayLog(ctx, LATER), id);
    assert.deepEqual([row.title, row.change, row.outcome?.text, row.undo?.line, row.undo?.confirm?.question], [
      "Launch draft · NX27-LIVE",
      "[NX27-LIVE] ON SALE: draft → paused",
      `Done · 1 campaign launched · ${CAMP_A}`,
      "Undo deletes the paused campaign Claude made.",
      "Delete the paused campaign Claude made? This can’t be undone.",
    ]);
    const before = writes(spy).length;
    assert.deepEqual(await undo(ctx, id, PRESS, true), { state: "undone" });
    const [w] = writes(spy).slice(before);
    assert.deepEqual([w!.input.kind, w!.input.id, w!.input.status, (w!.input.ledger as { draftId: string }).draftId], ["campaign", CAMP_A, "DELETED", DRAFT_A]);
  }
  {
    // Switched on since (in Ads Manager): the delete is off, nothing sent.
    const { ctx, spy } = liveCtx({ ceiling: null });
    const id = "6a000000-0000-4000-8000-000000000002";
    await ctx.db.from("mcp_actions").insert({ id, user_id: OPERATOR, tool: "launch_draft", kind: "meta", status: "done", args: { draft_id: DRAFT_A, mode: "paused" }, result: { draftId: DRAFT_A, mode: "paused", metaCampaignId: CAMP_A }, event_id: EVENT, client_id: CLIENT, created_at: AT });
    const before = writes(spy).length;
    assert.deepEqual(await undo(ctx, id, PRESS, true), { state: "off" });
    assert.equal(writes(spy).length, before);
    assert.equal(rowOf(await todayLog(ctx, LATER), id).note, "Changed since, so Undo is off.");
  }
});

test("no Undo on a live launch, added audiences, a test or a part-done move; and none for anyone's row but the caller's", async () => {
  const { ctx, spy } = liveCtx({ ceiling: 500 });
  const aud = await call(ctx, addAudienceToStageTool, { event: CODE, stage: "on_sale", audience_ids: [AUD], approval: YES }, AT);
  const ab = await call(ctx, createSplitTestTool, { event: CODE, campaign_ids: [CAMP_A, CAMP_B], start: "2026-11-27T00:00:00Z", end: "2026-12-19T00:00:00Z", name: "T", approval: YES }, AT);
  const liveId = "6a000000-0000-4000-8000-000000000003";
  await ctx.db.from("mcp_actions").insert({ id: liveId, user_id: OPERATOR, tool: "launch_draft", kind: "meta", status: "done", args: { draft_id: DRAFT_A, mode: "live" }, result: { draftId: DRAFT_A, mode: "live", metaCampaignId: CAMP_A }, event_id: EVENT, client_id: CLIENT, created_at: AT });
  const partId = "6a000000-0000-4000-8000-000000000004";
  await ctx.db.from("mcp_actions").insert({ id: partId, user_id: OPERATOR, tool: "move_budget", kind: "meta", status: "failed", args: { event: CODE }, result: { code: CODE, fromAdsetId: AS_BROAD, toAdsetId: AS_FANS, fromName: "Broad", toName: "Fans", deltaMinor: 500, written: [AS_BROAD], refused: "underfoot" }, event_id: EVENT, client_id: CLIENT, created_at: AT });
  const before = writes(spy).length;
  for (const id of [aud.id, ab.id, liveId, partId]) assert.deepEqual(await undo(ctx, id, PRESS, true), { state: "none" }, id);
  assert.equal(writes(spy).length, before);
  const log = await todayLog(ctx, LATER);
  assert.equal(rowOf(log, liveId).note, "It’s live, so Undo can’t delete it. Pause it in the campaign tree.");
  const part = rowOf(log, partId);
  assert.deepEqual([part.outcome?.text, part.undo], [`Failed · 1 of 2 ad sets changed · ${AS_BROAD}`, null]);
  // Someone else's row: nothing.
  const a = await call(ctx, pauseTool, { event: CODE, kind: "ad_set", id: AS_FANS, approval: YES }, AT);
  const other = await (await import("../today/undo.ts")).runUndo({ db: ctx.db, live: ctx.live!, userId: "00000000-0000-4000-8000-000000000999", now: new Date(PRESS), logger: { log: async () => "stdout" } }, a.id, { confirmed: true });
  assert.deepEqual(other, { state: "none" });
});

test("changed since: an object no longer as the change left it is left alone (“Changed since, so Undo is off.”), and so is one a later change touched", async () => {
  {
    const { ctx, spy } = liveCtx({ ceiling: 500 });
    const a = await call(ctx, pauseTool, { event: CODE, kind: "ad_set", id: AS_BROAD, approval: YES }, AT);
    spy.objects.get(AS_BROAD)!.status = "ACTIVE"; // resumed in Ads Manager
    const before = writes(spy).length;
    assert.deepEqual(await undo(ctx, a.id, PRESS), { state: "off" });
    assert.equal(writes(spy).length, before);
    assert.equal(rowOf(await todayLog(ctx, LATER), a.id).note, "Changed since, so Undo is off.");
  }
  {
    const { ctx, spy } = liveCtx({ ceiling: 500 });
    const a = await call(ctx, setBudgetTool, { event: CODE, kind: "ad_set", id: AS_FANS, daily_gbp: 30, approval: YES }, AT);
    spy.objects.get(AS_FANS)!.dailyBudgetMinor = 3500; // edited in Ads Manager
    assert.deepEqual(await undo(ctx, a.id, PRESS), { state: "off" });
  }
  {
    const { ctx, spy } = liveCtx({ ceiling: 500 });
    const a = await call(ctx, renameTool, { event: CODE, kind: "ad", id: AD_1, name: "One", approval: YES }, AT);
    await call(ctx, renameTool, { event: CODE, kind: "ad", id: AD_1, name: "Two", approval: { asked: "Rename again?", answer: "yes" } }, "2026-11-26T10:30:00Z");
    const row = rowOf(await todayLog(ctx, LATER), a.id);
    assert.deepEqual([row.undo, row.note], [null, "Changed since, so Undo is off."]);
    const before = writes(spy).length;
    assert.deepEqual(await undo(ctx, a.id, PRESS), { state: "off" });
    assert.equal(writes(spy).length, before);
  }
});

test("a switch that's off refuses the Undo before anything is read; Meta failing leaves the Undo to press again", async () => {
  {
    const { ctx, spy } = liveCtx({ ceiling: 500 });
    const a = await call(ctx, pauseTool, { event: CODE, kind: "ad_set", id: AS_BROAD, approval: YES }, AT);
    spy.switches.adsetStatus = false;
    const calls = spy.calls.length;
    assert.deepEqual(await undo(ctx, a.id, PRESS), { state: "refused", refused: "switch_off", reason: "this is switched off in Off/Pixel, so nothing was sent" });
    assert.equal(spy.calls.length, calls, "nothing read or sent");
  }
  {
    const { ctx, spy } = liveCtx({ ceiling: null });
    const a = await call(ctx, renameTool, { event: CODE, kind: "ad", id: AD_1, name: "One", approval: YES }, AT);
    spy.failWrite = true;
    const out = await undo(ctx, a.id, PRESS);
    assert.deepEqual(out, { state: "refused", refused: "meta_failed", reason: "Meta didn’t take it, so nothing changed" });
    const row = rowOf(await todayLog(ctx, LATER), a.id);
    assert.equal(row.note, "Undo refused · Meta didn’t take it, so nothing changed");
    assert.equal(row.undo?.line, "Undo puts the old name back.", "Meta didn't answer: Undo stays to press again");
    assert.ok(!JSON.stringify(row).includes("raw"), "nothing raw from Meta");
    spy.failWrite = false;
    assert.deepEqual(await undo(ctx, a.id, PRESS), { state: "undone" });
  }
});
