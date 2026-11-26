/**
 * M3b's words (lib/mcp/live/words.ts): the rows it reuses are design's, word
 * for word, against a copy of the list (fixtures/words-mcp-today-2026-11-25.tsv);
 * the count helpers are the today.mcp.count.* rows; londonWhen is design's
 * "Thu 26 Nov, 18:00" (26 Nov verdict), weekday from London's own date; and
 * M3b ships switched off: every one of its tools answers the existing
 * claude.mcp.refused.switch row until LIVE_CHANGES_SHIPPED is true.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIVE_FOR_DESIGN, LIVE_ROWS, LIVE_WORDS, countAdSets, countAds, countChanges, countTiers } from "../live/words.ts";
import { londonWhen } from "../live/resolve.ts";
import { LIVE_CHANGES_SHIPPED, LIVE_TOOL_NAMES } from "../live/shipped.ts";
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

test("M3b ships switched off: all eleven tools answer claude.mcp.refused.switch before anything runs", async () => {
  assert.equal(LIVE_CHANGES_SHIPPED, false);
  assert.equal(LIVE_ROWS.refusedSwitch, row("claude.mcp.refused.switch"));
  const tools = META_TOOLS.filter((t) => (LIVE_TOOL_NAMES as readonly string[]).includes(t.name));
  assert.deepEqual(tools.map((t) => t.name).sort(), [...LIVE_TOOL_NAMES].sort());
  for (const tool of tools) {
    const { ctx, spy } = liveCtx();
    delete (ctx as { liveShipped?: boolean }).liveShipped;
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
  const out = await runScheduledChanges({ db: ctx.db, live: ctx.live!, now: new Date("2026-11-26T18:00:00Z") });
  assert.equal(out.skippedReason, "m3b_not_shipped");
  assert.equal(out.due, 0);
  assert.deepEqual(spy.calls, []);
});
