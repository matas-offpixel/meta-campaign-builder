/**
 * M3b's words (lib/mcp/live/words.ts): the rows it reuses are design's, word
 * for word, against a copy of the list (fixtures/words-mcp-today-2026-11-25.tsv);
 * the count helpers are the today.mcp.count.* rows; londonWhen is design's
 * "Thu 26 Nov, 18:00" (26 Nov verdict), weekday from London's own date;
 * M3b is on with Today's rows (MB4: LIVE_CHANGES_SHIPPED and
 * TODAY_UNDO_SHIPPED together), and switched off every one of its tools
 * answers the existing claude.mcp.refused.switch row. The rows
 * design corrected on 26 Nov (LIVE_RULED) are pinned here character for
 * character, typographic ’ included, and leave LIVE_FOR_DESIGN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIVE_FOR_DESIGN, LIVE_ROWS, LIVE_RULED, LIVE_WORDS, countAdSets, countAds, countCampaigns, countChanges, countTiers } from "../live/words.ts";
import { londonWhen } from "../live/resolve.ts";
import { LIVE_CHANGES_SHIPPED, LIVE_TOOL_NAMES } from "../live/shipped.ts";
import { TODAY_UNDO_SHIPPED } from "../meta/today-undo.ts";
import { runScheduledChanges } from "../live/scheduled.ts";
import { META_TOOLS } from "../tools/index.ts";
import { ToolInputError } from "../tool-types.ts";
import { liveCtx } from "./live-fixtures.ts";

const ROWS = new Map(
  readFileSync(new URL("./fixtures/words-mcp-today-2026-11-25.tsv", import.meta.url), "utf8")
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((l) => {
      const [k, , w] = l.split("\t");
      return [k!, w!] as const;
    }),
);
const row = (k: string, v: Record<string, string> = {}) => ROWS.get(k)!.replace(/\{([a-z]+)\}/g, (m, n: string) => v[n] ?? m);

test("M3b words: the rows it reuses are design's, word for word; every new string is listed for design once, under its own key", () => {
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
  const row = (k: string, v: Record<string, string> = {}) => rows.get(k)!.replace(/\{([a-z]+)\}/g, (m, n: string) => v[n] ?? m);
  assert.equal(LIVE_ROWS.refusedSwitch, row("claude.mcp.refused.switch"));
  assert.equal(LIVE_ROWS.failed("R"), row("claude.mcp.failed", { result: "R" }));
  assert.equal(LIVE_ROWS.changePause("N"), row("today.mcp.change.pause", { name: "N" }));
  assert.equal(LIVE_ROWS.changeResume("N"), row("today.mcp.change.resume", { name: "N" }));
  assert.equal(LIVE_ROWS.changeMove(5, "A", "B"), row("today.mcp.change.move_budget", { x: "5.00", from: "A", to: "B" }));
  assert.equal(LIVE_ROWS.changeAddCreatives("S", "1 ad", "2 ad sets"), row("today.mcp.change.add_creatives", { stage: "S", ads: "1 ad", adsets: "2 ad sets" }));
  assert.equal(LIVE_ROWS.changeAddAudiences("S", "A", "2 ad sets"), row("today.mcp.change.add_audiences", { stage: "S", audiences: "A", adsets: "2 ad sets" }));
  assert.equal(LIVE_ROWS.created(["test", "tests"], ["x"]), row("today.mcp.result.created.one", { thing: "test", id: "x" }));
  assert.equal(LIVE_ROWS.undoResume, row("today.mcp.undo.resume"));
  assert.equal(LIVE_ROWS.undoPause, row("today.mcp.undo.pause"));
  assert.equal(LIVE_ROWS.undoBudget(30), row("today.mcp.undo.budget", { x: "30.00" }));
  assert.equal(LIVE_ROWS.undoMove(5, "A"), row("today.mcp.undo.move", { x: "5.00", from: "A" }));
  assert.equal(countAds(1), row("today.mcp.count.ads.one"));
  assert.equal(countAdSets(3), row("today.mcp.count.adsets", { n: "3" }));
  const keys = LIVE_FOR_DESIGN.map((w) => w.key);
  assert.equal(new Set(keys).size, keys.length, "one entry per key");
  for (const k of keys) assert.ok(!rows.has(k), `${k} isn't a row yet`);
  for (const w of LIVE_FOR_DESIGN) assert.ok(w.where && w.candidate, w.key);
  // Refusals end as the house rule says.
  for (const w of LIVE_FOR_DESIGN.filter((x) => x.candidate.startsWith("Refused:"))) assert.match(w.candidate, /(Nothing was sent to Meta|Nothing was changed|Nothing was scheduled|nothing was changed\. Try again)\.$/, w.key);
  assert.ok(LIVE_WORDS.metaFailed);
});

// Design's 26 Nov verdict on #1389, copied character for character.
const RULED: Record<string, string> = {
  "claude.mcp.live.same.live": "Nothing changed: {name} is already live.",
  "claude.mcp.live.resume.parent_off": "{name} is live, but its {parent} is paused, so it won’t spend until that’s live too.",
  "claude.mcp.live.refused.paused_outside": "Refused: {name} was paused outside Off/Pixel. Ask Matas again, say so in the question, and send it with his answer. Nothing was sent to Meta.",
  "claude.mcp.live.refused.budget_amount": "Refused: give one amount in £, from £1.00 to £100,000.00, as daily_gbp or lifetime_gbp. Nothing was sent to Meta.",
  "claude.mcp.live.scheduled": "Scheduled for {when} London time: {change} (change {id}). It runs only if nothing has changed by then. Cancel it with cancel_scheduled.",
  "claude.mcp.live.refused.at": "Refused: give at as a time with its zone, at least 15 minutes and at most 60 days ahead. Nothing was scheduled.",
  "claude.mcp.live.cancelled": "Cancelled the change due {when} London time: {change}. It won’t run.",
  "claude.mcp.live.refused.cancel_state": "Refused: change {id} is no longer scheduled ({state}). Nothing was changed.",
  "claude.mcp.live.skip.budget_changed": "Skipped: the budget changed after it was scheduled.",
  "claude.mcp.live.skip.paused": "Skipped: it was paused after it was scheduled.",
  "claude.mcp.live.skip.ended": "Skipped: it ended or was deleted after it was scheduled.",
  "claude.mcp.live.skip.ceiling": "Skipped: by then it would have gone over the client’s daily ceiling, or the client had no ceiling.",
  "claude.mcp.live.move.partial": "{from} went down by £{x} a day, but {to} didn’t go up: its budget changed or Meta refused it. Read both with get_live.",
  "claude.mcp.live.refused.too_many_ads": "Refused: that’s {ads} across {campaigns}, over the 200 ads and 8 campaigns one run can add. Narrow ad_set_ids. Nothing was sent to Meta.",
  "claude.mcp.live.refused.test_dates": "Refused: give start and end as times with their zone: start now or later, end after start, at most 90 days apart. Nothing was sent to Meta.",
  "claude.mcp.live.refused.test_business": "Refused: the ad account isn’t in a business portfolio, and Meta needs one to hold a test. Nothing was sent to Meta.",
  "claude.mcp.live.test.line": "{a} and {b} split 50/50 from {start} to {end} London time, judged on cost per result.",
  "claude.mcp.live.change.budget.to": "{name}: to £{y} {per}",
};

test("design's corrected rows (26 Nov) are word for word, typographic ’ and all, and no longer listed for design", () => {
  assert.deepEqual(LIVE_RULED, RULED);
  for (const w of Object.values(LIVE_RULED)) assert.doesNotMatch(w, /'/, "typographic ’ only");
  const pendingKeys = new Set(LIVE_FOR_DESIGN.map((w) => w.key));
  for (const k of Object.keys(LIVE_RULED)) assert.ok(!pendingKeys.has(k), `${k} left LIVE_FOR_DESIGN`);
  assert.equal(LIVE_FOR_DESIGN.length, 57, "72 keys less design's 17 corrected rows, plus the 26 Nov plan's two read-back lines");
  for (const w of Object.values(LIVE_RULED).filter((x) => x.startsWith("Refused:"))) assert.match(w, /(Nothing was sent to Meta|Nothing was changed|Nothing was scheduled)\.$/);
});

test("design's corrected rows, as Claude reads them", () => {
  assert.equal(LIVE_WORDS.sameLive("Broad"), "Nothing changed: Broad is already live.");
  assert.equal(LIVE_WORDS.parentOff("Broad", "campaign"), "Broad is live, but its campaign is paused, so it won’t spend until that’s live too.");
  assert.equal(LIVE_WORDS.pausedOutside("Broad"), "Refused: Broad was paused outside Off/Pixel. Ask Matas again, say so in the question, and send it with his answer. Nothing was sent to Meta.");
  assert.equal(LIVE_WORDS.budgetAmount, "Refused: give one amount in £, from £1.00 to £100,000.00, as daily_gbp or lifetime_gbp. Nothing was sent to Meta.");
  const change = LIVE_WORDS.budgetChange("Broad", 30, 40, false);
  assert.equal(change, "Broad: £30.00 → £40.00 a day");
  const when = londonWhen("2026-11-26T18:00:00Z");
  assert.equal(LIVE_WORDS.scheduled(change, when, "5c01"), "Scheduled for Thu 26 Nov, 18:00 London time: Broad: £30.00 → £40.00 a day (change 5c01). It runs only if nothing has changed by then. Cancel it with cancel_scheduled.");
  assert.equal(LIVE_WORDS.schedulePast, "Refused: give at as a time with its zone, at least 15 minutes and at most 60 days ahead. Nothing was scheduled.");
  assert.equal(LIVE_WORDS.cancelled(change, when), "Cancelled the change due Thu 26 Nov, 18:00 London time: Broad: £30.00 → £40.00 a day. It won’t run.");
  assert.equal(LIVE_WORDS.cancelState("5c01", LIVE_WORDS.state.failed!), "Refused: change 5c01 is no longer scheduled (failed). Nothing was changed.");
  assert.equal(LIVE_WORDS.skip.budget_changed, "Skipped: the budget changed after it was scheduled.");
  assert.equal(LIVE_WORDS.skip.paused, "Skipped: it was paused after it was scheduled.");
  assert.equal(LIVE_WORDS.skip.ended, "Skipped: it ended or was deleted after it was scheduled.");
  // PR D: the ruled client-ceiling row stays as the record (pinned above); the skip now speaks of the show's spend ceiling (PENDING DESIGN).
  assert.equal(LIVE_WORDS.skip.ceiling, "Skipped: by then it would have taken the show over its spend ceiling, or the show had no ceiling.");
  assert.equal(LIVE_WORDS.movePartial("Broad", "Fans", 5), "Broad went down by £5.00 a day, but Fans didn’t go up: its budget changed or Meta refused it. Read both with get_live.");
  assert.equal(LIVE_WORDS.testDates, "Refused: give start and end as times with their zone: start now or later, end after start, at most 90 days apart. Nothing was sent to Meta.");
  assert.equal(LIVE_WORDS.testNoBusiness, "Refused: the ad account isn’t in a business portfolio, and Meta needs one to hold a test. Nothing was sent to Meta.");
  assert.equal(
    LIVE_WORDS.testLine("Teaser A", "Teaser B", londonWhen("2026-11-27T00:00:00Z"), londonWhen("2026-12-10T00:00:00Z")),
    "Teaser A and Teaser B split 50/50 from Fri 27 Nov, 00:00 to Thu 10 Dec, 00:00 London time, judged on cost per result.",
  );
});

test("refused.too_many_ads is counted: never \"1 ads\" or \"1 campaigns\"", () => {
  assert.equal(countCampaigns(1), "1 campaign");
  assert.equal(countCampaigns(9), "9 campaigns");
  assert.equal(countCampaigns(0), "0 campaigns");
  assert.equal(LIVE_WORDS.tooManyAds(1, 1), "Refused: that’s 1 ad across 1 campaign, over the 200 ads and 8 campaigns one run can add. Narrow ad_set_ids. Nothing was sent to Meta.");
  assert.equal(LIVE_WORDS.tooManyAds(240, 9), "Refused: that’s 240 ads across 9 campaigns, over the 200 ads and 8 campaigns one run can add. Narrow ad_set_ids. Nothing was sent to Meta.");
  assert.equal(LIVE_WORDS.tooManyAds(201, 1), "Refused: that’s 201 ads across 1 campaign, over the 200 ads and 8 campaigns one run can add. Narrow ad_set_ids. Nothing was sent to Meta.");
  assert.equal(LIVE_WORDS.tooManyAds(1, 9), "Refused: that’s 1 ad across 9 campaigns, over the 200 ads and 8 campaigns one run can add. Narrow ad_set_ids. Nothing was sent to Meta.");
  for (const [a, c] of [[1, 1], [1, 9], [201, 1], [240, 9]] as const) assert.doesNotMatch(LIVE_WORDS.tooManyAds(a, c), /\b1 (ads|campaigns)\b/);
});

test("live.change.budget.to: a budget change with no recorded old amount reads \"to £y\", never \"£0.00 →\"", () => {
  assert.equal(LIVE_WORDS.budgetChange("Broad", null, 40, false), "Broad: to £40.00 a day");
  assert.equal(LIVE_WORDS.budgetChange("Broad", null, 400, true), "Broad: to £400.00 lifetime");
  assert.doesNotMatch(LIVE_WORDS.budgetChange("Broad", null, 40, false), /£0\.00 →/);
});

test("the count helpers are the today.mcp.count rows: .one at 1, {n} otherwise", () => {
  for (const n of [0, 1, 2, 12]) {
    const one = n === 1;
    assert.equal(countAds(n), one ? row("today.mcp.count.ads.one") : row("today.mcp.count.ads", { n: String(n) }));
    assert.equal(countAdSets(n), one ? row("today.mcp.count.adsets.one") : row("today.mcp.count.adsets", { n: String(n) }));
    assert.equal(countTiers(n), one ? row("today.mcp.count.tiers.one") : row("today.mcp.count.tiers", { n: String(n) }));
    assert.equal(countChanges(n), one ? row("today.mcp.count.changes.one") : row("today.mcp.count.changes", { n: String(n) }));
  }
});

test("londonWhen is \"Thu 26 Nov, 18:00\": London's weekday and date, 24-hour time", () => {
  // Thursday 26 Nov 2026 and Friday 27 Nov 2026 (GMT): the weekday follows London's date.
  assert.equal(londonWhen("2026-11-26T18:00:00Z"), "Thu 26 Nov, 18:00");
  assert.equal(londonWhen("2026-11-27T09:05:00Z"), "Fri 27 Nov, 09:05");
  // 23:30 London on Thu 26 Nov is still Thursday; 00:30 on Fri 27 Nov is Friday.
  assert.equal(londonWhen("2026-11-26T23:30:00Z"), "Thu 26 Nov, 23:30");
  assert.equal(londonWhen("2026-11-27T00:30:00Z"), "Fri 27 Nov, 00:30");
  // BST: 23:30 UTC on Fri 9 Apr 2027 is 00:30 on Sat 10 Apr in London.
  assert.equal(londonWhen("2027-04-09T23:30:00Z"), "Sat 10 Apr, 00:30");
  assert.equal(londonWhen("2027-04-10T09:00:00Z"), "Sat 10 Apr, 10:00");
});

test("MB4: M3b is on with Today's rows and Undo, and the two constants flip together", () => {
  assert.equal(LIVE_CHANGES_SHIPPED, true);
  assert.equal(TODAY_UNDO_SHIPPED, true);
  assert.equal(LIVE_CHANGES_SHIPPED, TODAY_UNDO_SHIPPED, "neither flips on its own (MB4)");
});

test("switched off (liveShipped false), all eleven tools answer claude.mcp.refused.switch before anything runs", async () => {
  assert.equal(LIVE_ROWS.refusedSwitch, row("claude.mcp.refused.switch"));
  const tools = META_TOOLS.filter((t) => (LIVE_TOOL_NAMES as readonly string[]).includes(t.name));
  assert.deepEqual(tools.map((t) => t.name).sort(), [...LIVE_TOOL_NAMES].sort());
  for (const tool of tools) {
    const { ctx, spy } = liveCtx();
    (ctx as { liveShipped?: boolean }).liveShipped = false;
    await assert.rejects(tool.run(ctx, { event: "ES27-ENZO", approval: { asked: "a", answer: "yes" } }), (e: unknown) => {
      assert.ok(e instanceof ToolInputError, tool.name);
      assert.equal(e.message, LIVE_ROWS.refusedSwitch, tool.name);
      assert.equal(e.summary?.switch, "m3b_not_shipped", tool.name);
      return true;
    });
    assert.deepEqual(spy.calls, [], `${tool.name} reached nothing`);
  }
  // On, the same wrapped tool runs (its own refusal, not the switch).
  const { ctx } = liveCtx();
  const getLive = tools.find((t) => t.name === "get_live")!;
  await assert.rejects(getLive.run({ ...ctx, liveShipped: true }, {}), (e: unknown) => e instanceof ToolInputError && e.message !== LIVE_ROWS.refusedSwitch);
});

test("the scheduled-changes cron applies nothing while M3b is off", async () => {
  const { ctx, spy } = liveCtx();
  const out = await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-26T18:00:00Z"), shipped: false });
  assert.equal(out.skippedReason, "m3b_not_shipped");
  assert.equal(out.due, 0);
  assert.deepEqual(spy.calls, []);
});
