/**
 * Record 2026-11-26-mcp-m3b-today (MB1–MB4) on Today: every M3b change is a
 * row in FC1's form with design's words character for character; refusals
 * Matas acts on are logged muted and the ones that only correct Claude's
 * input aren't; reads aren't; a scheduled budget change waits at the top
 * with Cancel, then runs, skips or fails at its run time; Cancel on Today
 * and cancel_scheduled in Claude both stop it, and a cancelled change never
 * runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getLiveTool } from "../tools/live-read.ts";
import { pauseTool, resumeTool } from "../tools/live-status.ts";
import { cancelScheduledTool, listScheduledTool, moveBudgetTool, setBudgetTool } from "../tools/live-budget.ts";
import { renameTool } from "../tools/live-rename.ts";
import { addAudienceToStageTool, addCreativesToStageTool } from "../tools/live-stage.ts";
import { createSplitTestTool } from "../tools/live-test.ts";
import { runScheduledChanges } from "../live/scheduled.ts";
import { headerCount } from "../today/log.ts";
import { cancelFromToday } from "../today/undo.ts";
import { TODAY_META_WORDS } from "../today/words.ts";
import { OPERATOR } from "./helpers.ts";
import { AD_1, AS_B1, AS_BROAD, AS_FANS, AUD, CAMP_A, CAMP_B, CODE, YES, liveCtx, writes } from "./live-fixtures.ts";
import { MATAS_NAME, call, rowOf, todayLog } from "./today-fixtures.ts";

const AT = "2026-11-26T10:00:00Z";
const LATER = "2026-11-26T16:00:00Z";
const asked = (q: string) => ({ asked: q, answer: "yes do it" });

// ── The words ────────────────────────────────────────────────────────────────

test("every Today word is design's row, character for character, and all 32 of MB's rows are in", () => {
  const rows = new Map(
    readFileSync(new URL("./fixtures/words-mcp-today-2026-11-25.tsv", import.meta.url), "utf8")
      .split("\n")
      .slice(1)
      .filter(Boolean)
      .map((l) => {
        const [k, , w] = l.split("\t");
        return [k!, w!] as const;
      }),
  );
  for (const [key, words] of Object.entries(TODAY_META_WORDS)) assert.equal(words, rows.get(key), key);
  const mb = readFileSync(new URL("./fixtures/words-mcp-today-2026-11-25.tsv", import.meta.url), "utf8").split("\n").slice(-33, -1).map((l) => l.split("\t")[0]!);
  assert.equal(mb.length, 32);
  assert.equal(mb[0], "today.mcp.action.pause_campaign");
  for (const key of mb) assert.ok(key in TODAY_META_WORDS, `${key} is on Today`);
  // Typographic apostrophes and quotes, as the list has them.
  assert.equal(TODAY_META_WORDS["today.mcp.change.rename"], "“{before}” → “{after}”");
  assert.equal(TODAY_META_WORDS["today.mcp.undo.test"], "A test can’t be undone here. End it in Ads Manager.");
});

test("MB2's header: “{n} today”, then “ · {n} scheduled” when any wait (never “1 scheduleds”)", () => {
  assert.equal(headerCount(5, 1), "5 today · 1 scheduled");
  assert.equal(headerCount(1, 0), "1 today");
  assert.equal(headerCount(2, 3), "2 today · 3 scheduled");
  assert.equal(headerCount(0, 1), "0 today · 1 scheduled");
});

// ── MB1: each tool's row ─────────────────────────────────────────────────────

test("MB1 pause and resume: “Pause ad set / campaign / ad”, “{name}: live → paused”, FC1's approval line and question, Done, “Undo resumes it.”", async () => {
  const { ctx } = liveCtx({ ceiling: 5000 });
  const q = "Pause Broad on DHB27-LIVE (live → paused)?";
  const a = await call(ctx, pauseTool, { event: CODE, kind: "ad_set", id: AS_BROAD, approval: asked(q) }, AT);
  const b = await call(ctx, pauseTool, { event: CODE, kind: "campaign", id: CAMP_B, approval: YES }, "2026-11-26T10:05:00Z");
  const c = await call(ctx, pauseTool, { event: CODE, kind: "ad", id: AD_1, approval: YES }, "2026-11-26T10:10:00Z");
  const log = await todayLog(ctx, LATER);
  const r = rowOf(log, a.id);
  assert.deepEqual(
    { title: r.title, change: r.change, approved: r.approved, asked: r.asked, q: r.askedQ, a: r.askedA, outcome: r.outcome, undo: r.undo, note: r.note, edge: r.edge },
    {
      title: "Pause ad set · DHB27-LIVE",
      change: "Broad: live → paused",
      approved: "Approved in Claude · Thu 26 Nov, 10:00",
      asked: "What Claude asked",
      q: `Asked: “${q}”`,
      a: "Answer: “yes do it”",
      outcome: { text: `Done · 1 ad set changed · ${AS_BROAD}`, tone: "done" },
      undo: { label: "Undo", line: "Undo resumes it.", confirm: null },
      note: null,
      edge: "done",
    },
  );
  assert.equal(rowOf(log, b.id).title, "Pause campaign · DHB27-LIVE");
  assert.equal(rowOf(log, b.id).change, "[DHB27-LIVE] ON SALE 2: live → paused");
  assert.equal(rowOf(log, b.id).outcome?.text, `Done · 1 campaign changed · ${CAMP_B}`);
  assert.equal(rowOf(log, c.id).title, "Pause ad · DHB27-LIVE");
  // Newest first.
  assert.deepEqual(log.rows.map((x) => x.key), [c.id, b.id, a.id]);

  const d = await call(ctx, resumeTool, { event: CODE, kind: "campaign", id: CAMP_B, approval: YES }, "2026-11-26T11:00:00Z");
  const after = await todayLog(ctx, LATER);
  assert.equal(rowOf(after, d.id).title, "Resume campaign · DHB27-LIVE");
  assert.equal(rowOf(after, d.id).change, "[DHB27-LIVE] ON SALE 2: paused → live");
  assert.equal(rowOf(after, d.id).undo?.line, "Undo pauses it.");
  // The campaign changed after its pause, so the pause's Undo is off.
  assert.equal(rowOf(after, b.id).undo, null);
  assert.equal(rowOf(after, b.id).note, "Changed since, so Undo is off.");
});

test("MB1 set_budget: “Change budget”, “{name}: £{x} → £{y} a day” or “lifetime”, Undo puts it back", async () => {
  const { ctx, spy } = liveCtx({ ceiling: 5000 });
  const daily = await call(ctx, setBudgetTool, { event: CODE, kind: "ad_set", id: AS_FANS, daily_gbp: 30, approval: YES }, AT);
  const set = spy.objects.get(AS_B1)!;
  Object.assign(set, { dailyBudgetMinor: null, lifetimeBudgetMinor: 50000, budgetRemainingMinor: 40000, endTime: "2026-12-20T00:00:00Z" });
  const life = await call(ctx, setBudgetTool, { event: CODE, kind: "ad_set", id: AS_B1, lifetime_gbp: 600, approval: YES }, "2026-11-26T10:30:00Z");
  const log = await todayLog(ctx, LATER);
  assert.deepEqual([rowOf(log, daily.id).title, rowOf(log, daily.id).change, rowOf(log, daily.id).outcome?.text, rowOf(log, daily.id).undo?.line], [
    "Change budget · DHB27-LIVE",
    "Fans: £20.00 → £30.00 a day",
    `Done · 1 ad set changed · ${AS_FANS}`,
    "Undo puts it back to £20.00 a day.",
  ]);
  assert.deepEqual([rowOf(log, life.id).change, rowOf(log, life.id).undo?.line], ["Other campaign set: £500.00 → £600.00 lifetime", "Undo puts it back to £500.00 lifetime."]);
});

test("MB1 move_budget, rename, A/B test: the change lines, Undo where one exists, the test's line in place of Undo", async () => {
  const { ctx } = liveCtx({ ceiling: 5000 });
  const move = await call(ctx, moveBudgetTool, { event: CODE, from_ad_set: AS_BROAD, to_ad_set: AS_FANS, gbp_a_day: 5, approval: YES }, AT);
  const name = await call(ctx, renameTool, { event: CODE, kind: "ad", id: AD_1, name: "Broad · 25–34", approval: YES }, "2026-11-26T10:10:00Z");
  const ab = await call(ctx, createSplitTestTool, { event: CODE, campaign_ids: [CAMP_A, CAMP_B], start: "2026-11-27T00:00:00Z", end: "2026-12-19T00:00:00Z", name: "NX27 · A/B", approval: YES }, "2026-11-26T10:20:00Z");
  const log = await todayLog(ctx, LATER);
  const m = rowOf(log, move.id);
  assert.deepEqual([m.title, m.change, m.outcome?.text, m.undo?.line], ["Move budget · DHB27-LIVE", "£5.00 a day: Broad → Fans", `Done · 2 ad sets changed · ${AS_BROAD}, ${AS_FANS}`, "Undo moves £5.00 a day back to Broad."]);
  const n = rowOf(log, name.id);
  assert.deepEqual([n.title, n.change, n.outcome?.text, n.undo?.line], ["Rename · DHB27-LIVE", "“Teaser 1” → “Broad · 25–34”", `Done · 1 ad changed · ${AD_1}`, "Undo puts the old name back."]);
  const t = rowOf(log, ab.id);
  assert.deepEqual([t.title, t.change, t.outcome?.text, t.undo, t.note], [
    "Start an A/B test · DHB27-LIVE",
    "[DHB27-LIVE] ON SALE vs [DHB27-LIVE] ON SALE 2 · 50/50 · Fri 27 Nov – Sat 19 Dec",
    "Done · 1 test created · study-1",
    null,
    "A test can’t be undone here. End it in Ads Manager.",
  ]);
});

test("MB1 stage adds: Step 0's rows; paused ads have the delete Undo (confirms once), live ones FC1's live line, audiences nothing", async () => {
  const { ctx } = liveCtx({ ceiling: 5000 });
  const paused = await call(ctx, addCreativesToStageTool, { event: CODE, stage: "on_sale", draft_creative_ids: ["cr-1"], ad_set_ids: [AS_BROAD, AS_FANS], approval: YES }, AT);
  const live = await call(ctx, addCreativesToStageTool, { event: CODE, stage: "on_sale", draft_creative_ids: ["cr-1"], ad_set_ids: [AS_B1], live: true, approval: YES }, "2026-11-26T10:10:00Z");
  const aud = await call(ctx, addAudienceToStageTool, { event: CODE, stage: "on_sale", audience_ids: [AUD], approval: YES }, "2026-11-26T10:20:00Z");
  const log = await todayLog(ctx, LATER);
  const p = rowOf(log, paused.id);
  assert.deepEqual([p.title, p.change, p.outcome?.text], ["Add creatives · DHB27-LIVE", "On sale: 2 ads into 2 ad sets", `Done · 2 ads added · ad-${AS_BROAD}, ad-${AS_FANS}`]);
  assert.deepEqual(p.undo, {
    label: "Undo",
    line: "Undo deletes the 2 paused ads Claude made.",
    confirm: { question: "Delete the 2 paused ads Claude made? This can’t be undone.", cancel: "Cancel", button: "Delete" },
  });
  const l = rowOf(log, live.id);
  assert.deepEqual([l.change, l.undo, l.note], ["On sale: 1 ad into 1 ad set", null, "It’s live, so Undo can’t delete it. Pause it in the campaign tree."]);
  const u = rowOf(log, aud.id);
  assert.deepEqual([u.title, u.change, u.undo, u.note], ["Add audiences · DHB27-LIVE", "On sale: NX Signups into 3 ad sets", null, null]);
});

// ── MB3: what's logged and what isn't ────────────────────────────────────────

test("MB3: refusals Matas acts on are muted rows (no approval, ceiling, no ceiling, switch); Meta's refusal is Failed; the rest stay out", async () => {
  // £1,625.00 committed; Broad £30 → £40 adds £250.00 (25 days), over £1,800.
  const { ctx, spy } = liveCtx({ ceiling: 1800 });
  const none = await call(ctx, pauseTool, { event: CODE, kind: "ad_set", id: AS_BROAD }, AT);
  const over = await call(ctx, setBudgetTool, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 40, approval: YES }, "2026-11-26T10:01:00Z");
  spy.switches.adsetStatus = false;
  const off = await call(ctx, pauseTool, { event: CODE, kind: "ad_set", id: AS_FANS, approval: YES }, "2026-11-26T10:02:00Z");
  spy.switches.adsetStatus = true;
  spy.failWrite = true;
  const meta = await call(ctx, renameTool, { event: CODE, kind: "ad", id: AD_1, name: "New", approval: YES }, "2026-11-26T10:03:00Z");
  spy.failWrite = false;
  // Refusals that only correct what Claude sent, reads, and calls that changed nothing.
  await call(ctx, pauseTool, { event: CODE, kind: "ad_set", id: "999999999", approval: YES }, "2026-11-26T10:04:00Z");
  await call(ctx, setBudgetTool, { event: CODE, kind: "ad_set", id: AS_BROAD, lifetime_gbp: 400, approval: YES }, "2026-11-26T10:05:00Z");
  await call(ctx, setBudgetTool, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 40, at: "2026-11-26T10:06:00Z", approval: YES }, "2026-11-26T10:05:30Z");
  await call(ctx, getLiveTool, { event: CODE }, "2026-11-26T10:06:00Z");
  await call(ctx, listScheduledTool, { event: CODE }, "2026-11-26T10:07:00Z");
  await call(ctx, pauseTool, { event: CODE, kind: "ad", id: AD_1, approval: YES }, "2026-11-26T10:08:00Z");
  await call(ctx, pauseTool, { event: CODE, kind: "ad", id: AD_1, approval: YES }, "2026-11-26T10:09:00Z"); // already paused: changed nothing
  const log = await todayLog(ctx, LATER);
  const n = rowOf(log, none.id);
  assert.deepEqual([n.title, n.change, n.outcome, n.approved, n.edge], ["Pause ad set · DHB27-LIVE", `${AS_BROAD}: live → paused`, { text: "Refused · no approval given", tone: "refused" }, null, "muted"]);
  const o = rowOf(log, over.id);
  assert.deepEqual([o.change, o.outcome?.text, o.edge], ["Broad: £30.00 → £40.00 a day", "Refused · it would take DHB27-LIVE to £1875.00 committed, over its £1800.00 ceiling", "muted"]);
  assert.equal(rowOf(log, off.id).outcome?.text, "Refused · this is switched off in Off/Pixel, so nothing was sent");
  const f = rowOf(log, meta.id);
  assert.deepEqual([f.outcome, f.edge, f.undo], [{ text: "Failed · Meta didn’t take it, so nothing changed", tone: "failed" }, "failed", null]);
  // Five rows: the four above and the one real pause of the ad.
  assert.equal(log.rows.length, 5);
  assert.ok(!JSON.stringify(log).includes("raw, must never reach Claude"), "nothing raw from Meta");
});

test("MB3: no ceiling on a resume reads FC1's no-ceiling row, with the change line", async () => {
  const { ctx, spy } = liveCtx({ ceiling: null });
  spy.objects.get(AS_BROAD)!.status = "PAUSED";
  const r = await call(ctx, resumeTool, { event: CODE, kind: "ad_set", id: AS_BROAD, approval: asked("It was paused in Ads Manager. Resume Broad?") }, AT);
  const row = rowOf(await todayLog(ctx, LATER), r.id);
  assert.deepEqual([row.title, row.change, row.outcome?.text], ["Resume ad set · DHB27-LIVE", "Broad: paused → live", "Refused · DHB27-LIVE has no spend ceiling, and this starts or raises spend"]);
});

// ── MB2: scheduled budget changes ────────────────────────────────────────────

async function schedule(ctx: Parameters<typeof call>[0], runAt = "2026-11-27T09:00:00Z") {
  const out = await call(ctx, setBudgetTool, { event: CODE, kind: "ad_set", id: AS_BROAD, daily_gbp: 40, at: runAt, approval: asked("Raise Broad from £30.00 to £40.00 a day at 09:00 tomorrow, Fri 27 Nov?") }, "2026-11-26T16:40:00Z");
  const id = (out.data as { scheduled_id: string }).scheduled_id;
  // The row is made when Matas says yes (the database stamps created_at; the fake stamps the wall clock).
  await ctx.db.from("scheduled_meta_changes").update({ created_at: "2026-11-26T16:40:00Z" }).eq("id", id);
  return id;
}

test("MB2 waiting: at the top, soonest first, with Cancel and its note; the set_budget call itself is that row, not a second one", async () => {
  const { ctx } = liveCtx({ ceiling: 5000 });
  const later = await schedule(ctx, "2026-11-28T09:00:00Z");
  const soon = await schedule(ctx, "2026-11-27T09:00:00Z");
  const done = await call(ctx, renameTool, { event: CODE, kind: "ad", id: AD_1, name: "New", approval: YES }, AT);
  const log = await todayLog(ctx, "2026-11-26T17:00:00Z");
  assert.deepEqual(log.waiting.map((r) => r.key), [`scheduled:${soon}`, `scheduled:${later}`]);
  assert.deepEqual(log.rows.map((r) => r.key), [done.id]);
  const w = log.waiting[0]!;
  assert.deepEqual(
    { title: w.title, change: w.change, approved: w.approved, asked: w.asked, q: w.askedQ, scheduled: w.scheduled, cancel: w.cancel, edge: w.edge, undo: w.undo },
    {
      title: "Change budget · DHB27-LIVE",
      change: "Broad: £30.00 → £40.00 a day",
      approved: "Approved in Claude · Thu 26 Nov, 16:40",
      asked: "What Claude asked",
      q: "Asked: “Raise Broad from £30.00 to £40.00 a day at 09:00 tomorrow, Fri 27 Nov?”",
      scheduled: "Scheduled for Fri 27 Nov, 09:00",
      cancel: { label: "Cancel", note: "It runs only if nothing has changed by then." },
      edge: "waiting",
      undo: null,
    },
  );
  // On every day until it runs: tomorrow morning it still waits at the top.
  assert.equal((await todayLog(ctx, "2026-11-27T08:00:00Z")).waiting.length, 2);
  // No recorded old amount: "{name}: to £{y} a day", never "£0.00 →".
  await ctx.db.from("scheduled_meta_changes").update({ expected_minor: null }).eq("id", soon);
  assert.equal(rowOf(await todayLog(ctx, "2026-11-26T17:00:00Z"), soon).change, "Broad: to £40.00 a day");
});

test("MB2 Cancel on Today: “Cancelled by {name} · …”, muted; the cron never applies it; only while it's still scheduled", async () => {
  const { ctx, spy } = liveCtx({ ceiling: 5000 });
  const id = await schedule(ctx);
  assert.deepEqual(await cancelFromToday(ctx.db, { userId: OPERATOR, id, now: new Date("2026-11-26T17:02:00Z") }), { state: "cancelled" });
  const row = rowOf(await todayLog(ctx, "2026-11-26T18:00:00Z"), id);
  assert.deepEqual([row.cancelled, row.edge, row.cancel, row.scheduled], [`Cancelled by ${MATAS_NAME} · Thu 26 Nov, 17:02`, "muted", null, null]);
  // A cancelled change never runs.
  const out = await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-27T09:05:00Z") });
  assert.deepEqual([out.due, out.applied], [0, 0]);
  assert.equal(writes(spy).filter((c) => c.method === "setBudget").length, 0);
  // Cancelling again changes nothing; another user's id, or no row, is nothing.
  assert.deepEqual(await cancelFromToday(ctx.db, { userId: OPERATOR, id, now: new Date() }), { state: "not_scheduled" });
  assert.deepEqual(await cancelFromToday(ctx.db, { userId: "someone-else", id, now: new Date() }), { state: "none" });
  assert.deepEqual(await cancelFromToday(ctx.db, { userId: OPERATOR, id: "not-a-uuid", now: new Date() }), { state: "none" });
});

test("MB2 cancel_scheduled in Claude: “Cancelled in Claude · …”; the cron never applies it", async () => {
  const { ctx, spy } = liveCtx({ ceiling: 5000 });
  const id = await schedule(ctx);
  await call(ctx, cancelScheduledTool, { id, approval: YES }, "2026-11-26T17:10:00Z");
  const log = await todayLog(ctx, "2026-11-26T18:00:00Z");
  assert.equal(rowOf(log, id).cancelled, "Cancelled in Claude · Thu 26 Nov, 17:10");
  // cancel_scheduled's own call isn't a second row.
  assert.equal(log.rows.length, 1);
  await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-27T09:05:00Z") });
  assert.equal(writes(spy).filter((c) => c.method === "setBudget").length, 0);
});

test("MB2 cancel on Today after it ran is refused by the same guard as Claude's", async () => {
  const { ctx } = liveCtx({ ceiling: 5000 });
  const id = await schedule(ctx);
  await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-27T09:05:00Z") });
  assert.deepEqual(await cancelFromToday(ctx.db, { userId: OPERATOR, id, now: new Date("2026-11-27T09:06:00Z") }), { state: "not_scheduled" });
});

test("MB2 ran: into the day's log at its run time with “Ran as scheduled”, then Done with the budget Undo, Skipped · {reason} muted, or Failed", async () => {
  {
    const { ctx } = liveCtx({ ceiling: 5000 });
    const id = await schedule(ctx);
    await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-27T09:05:00Z") });
    const log = await todayLog(ctx, "2026-11-27T12:00:00Z");
    assert.equal(log.waiting.length, 0);
    const r = rowOf(log, id);
    assert.deepEqual([r.at, r.ran, r.outcome?.text, r.undo?.line, r.edge], ["2026-11-27T09:00:00.000Z", "Ran as scheduled · Fri 27 Nov, 09:00", `Done · 1 ad set changed · ${AS_BROAD}`, "Undo puts it back to £30.00 a day.", "done"]);
    // Its approval line is still the day it was asked.
    assert.equal(r.approved, "Approved in Claude · Thu 26 Nov, 16:40");
  }
  {
    const { ctx, spy } = liveCtx({ ceiling: 5000 });
    const id = await schedule(ctx);
    spy.objects.get(AS_BROAD)!.status = "PAUSED";
    await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-27T09:05:00Z") });
    const r = rowOf(await todayLog(ctx, "2026-11-27T12:00:00Z"), id);
    assert.deepEqual([r.ran, r.outcome, r.edge, r.undo], ["Ran as scheduled · Fri 27 Nov, 09:00", { text: "Skipped · it was paused after it was scheduled", tone: "muted" }, "muted", null]);
  }
  for (const [reason, set] of [
    ["the budget changed after it was scheduled", (s: ReturnType<typeof liveCtx>["spy"]) => void (s.objects.get(AS_BROAD)!.dailyBudgetMinor = 3500)],
    ["it ended or was deleted after it was scheduled", (s: ReturnType<typeof liveCtx>["spy"]) => void (s.objects.get(AS_BROAD)!.status = "DELETED")],
    ["budget changes were switched off in Off/Pixel", (s: ReturnType<typeof liveCtx>["spy"]) => void (s.switches.budget = false)],
  ] as const) {
    const { ctx, spy } = liveCtx({ ceiling: 5000 });
    const id = await schedule(ctx);
    set(spy);
    await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-27T09:05:00Z") });
    assert.equal(rowOf(await todayLog(ctx, "2026-11-27T12:00:00Z"), id).outcome?.text, `Skipped · ${reason}`);
  }
  {
    // The ceiling at apply time.
    const { ctx } = liveCtx({ ceiling: 5000 });
    const id = await schedule(ctx);
    await ctx.db.from("show_spend_ceilings").update({ total_gbp: 35 }).eq("total_gbp", 5000);
    await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-27T09:05:00Z") });
    assert.equal(rowOf(await todayLog(ctx, "2026-11-27T12:00:00Z"), id).outcome?.text, "Skipped · by then it would have taken the show over its spend ceiling, or the show had no ceiling");
  }
  {
    // Meta refused it: Failed, nothing raw.
    const { ctx, spy } = liveCtx({ ceiling: 5000 });
    const id = await schedule(ctx);
    spy.failWrite = true;
    await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-27T09:05:00Z") });
    const r = rowOf(await todayLog(ctx, "2026-11-27T12:00:00Z"), id);
    assert.deepEqual([r.outcome, r.edge], [{ text: "Failed · Meta didn’t take it, so nothing changed", tone: "failed" }, "failed"]);
  }
  {
    // A budget that changed during the write reads as skipped for that reason (MB2).
    const { ctx } = liveCtx({ ceiling: 5000 });
    const id = await schedule(ctx);
    const live = { ...ctx.live!, setBudget: async () => { throw Object.assign(new Error("changed"), { name: "BudgetChangedUnderfootError" }); } };
    const out = await runScheduledChanges({ db: ctx.db, live, now: new Date("2026-11-27T09:05:00Z") });
    assert.deepEqual([out.skipped, out.failed], [1, 0]);
    assert.equal(rowOf(await todayLog(ctx, "2026-11-27T12:00:00Z"), id).outcome?.text, "Skipped · the budget changed after it was scheduled");
  }
});

test("MB-A's header: five today and one scheduled", async () => {
  const { ctx } = liveCtx({ ceiling: 5000 });
  await schedule(ctx);
  await call(ctx, setBudgetTool, { event: CODE, kind: "ad_set", id: AS_FANS, daily_gbp: 30, approval: YES }, "2026-11-26T15:12:00Z");
  await call(ctx, renameTool, { event: CODE, kind: "ad", id: AD_1, name: "New", approval: YES }, "2026-11-26T14:05:00Z");
  await call(ctx, createSplitTestTool, { event: CODE, campaign_ids: [CAMP_A, CAMP_B], start: "2026-11-27T00:00:00Z", end: "2026-12-19T00:00:00Z", name: "T", approval: YES }, "2026-11-26T12:48:00Z");
  await call(ctx, pauseTool, { event: CODE, kind: "campaign", id: CAMP_B, approval: YES }, "2026-11-26T10:30:00Z");
  await call(ctx, pauseTool, { event: CODE, kind: "ad_set", id: AS_B1 }, "2026-11-26T09:30:00Z");
  const log = await todayLog(ctx, "2026-11-26T17:00:00Z");
  assert.equal(headerCount(log.rows.length, log.waiting.length), "5 today · 1 scheduled");
});
