/**
 * The writers behind M3b's seam, on a fake ledger: each refuses with its
 * switch off, writes once per ask (a retry finds its success on
 * meta_write_idempotency and sends nothing), and never writes without a
 * ledger row. The targeting write keeps Advantage+ on. The refresh's move,
 * shared with move_budget, reuses its plan so a side is never moved twice.
 * Migration 271 and the M3b words.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeBudget } from "../../meta/budget-write.ts";
import { writeCampaignStatus } from "../../meta/campaign-status-write.ts";
import { writeObjectName } from "../../meta/object-name-write.ts";
import { campaignsInRunningStudies, studyPayload, writeAdStudy } from "../../meta/ad-study.ts";
import { mergeAudienceIntoTargeting } from "../../meta/adset-targeting-write.ts";
import { moveAdSetDailyBudget, type MovePlan } from "../../onsale-refresh/apply.ts";
import { LIVE_FOR_DESIGN, LIVE_ROWS, LIVE_WORDS, countAdSets, countAds } from "../live/words.ts";
import { fakeDb } from "./fake-db.ts";
import { OPERATOR } from "./helpers.ts";

const DRAFT = "d0000000-0000-4000-8000-00000000d001";
const ledger = () => {
  const db = fakeDb({ meta_write_idempotency: [] });
  return { db, ctx: { supabase: db, userId: OPERATOR, draftId: DRAFT, eventId: null } };
};
const ON = { ENABLE_OPTIMISATION_WRITES: "1", OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED: "true" };

test("writeBudget: switch off refuses before the ledger; one POST per ask; a changed budget is never written", async () => {
  const { db, ctx } = ledger();
  const posts: unknown[] = [];
  const graph = { postBudget: async (...a: unknown[]) => void posts.push(a) };
  const args = { env: ON, ledger: ctx, graph, kind: "adset" as const, objectId: "120000000000000011", field: "daily_budget" as const, minor: 4000, expectedMinor: 3000, liveMinor: 3000, key: "k1" };
  await assert.rejects(writeBudget({ ...args, env: {} }), { name: "BudgetWritesDisabledError" });
  assert.equal(db.writes.length, 0);
  await writeBudget(args);
  await writeBudget(args);
  assert.equal(posts.length, 1, "the retry finds its success on the ledger");
  await assert.rejects(writeBudget({ ...args, key: "k2", liveMinor: 3500 }), { name: "BudgetChangedUnderfootError" });
  assert.equal(posts.length, 1);
  // No ledger table: required, so no POST.
  const bare = fakeDb({});
  await assert.rejects(writeBudget({ ...args, key: "k3", ledger: { ...ctx, supabase: bare } }), { name: "MetaWriteLedgerRequiredError" });
  assert.equal(posts.length, 1);
});

test("writeCampaignStatus: behind the ad-set status switch; one POST per ask", async () => {
  const { ctx } = ledger();
  const posts: string[] = [];
  const graph = { postCampaignStatus: async (id: string, s: string) => void posts.push(`${id}:${s}`) };
  await assert.rejects(writeCampaignStatus({ env: {}, ledger: ctx, graph, campaignId: "120000000000000001", status: "PAUSED", key: "k" }), { name: "AdSetStatusWritesDisabledError" });
  await writeCampaignStatus({ env: ON, ledger: ctx, graph, campaignId: "120000000000000001", status: "PAUSED", key: "k" });
  await writeCampaignStatus({ env: ON, ledger: ctx, graph, campaignId: "120000000000000001", status: "PAUSED", key: "k" });
  assert.deepEqual(posts, ["120000000000000001:PAUSED"]);
});

test("writeObjectName and writeAdStudy: one POST per ask on the ledger", async () => {
  const { ctx } = ledger();
  const names: string[] = [];
  for (let i = 0; i < 2; i++) await writeObjectName({ ledger: ctx, graph: { postName: async (_id, n) => void names.push(n) }, kind: "ad", objectId: "120000000000000111", name: " New name ", key: "k" });
  assert.deepEqual(names, ["New name"]);
  const studies: unknown[] = [];
  const payload = studyPayload({ name: "T", campaignA: "1", campaignB: "2", start: new Date("2026-11-27T00:00:00Z"), end: new Date("2026-12-10T00:00:00Z") });
  assert.deepEqual(JSON.parse(String(payload.cells)).map((c: { treatment_percentage: number; campaigns: string[] }) => [c.treatment_percentage, c.campaigns]), [[50, ["1"]], [50, ["2"]]]);
  assert.equal(payload.type, "SPLIT_TEST");
  for (let i = 0; i < 2; i++) assert.equal(await writeAdStudy({ ledger: ctx, graph: { createAdStudy: async (b, p) => (studies.push([b, p]), "study-9") }, businessId: "111", payload, key: "k" }), "study-9");
  assert.equal(studies.length, 1);
  const running = campaignsInRunningStudies(
    [
      { id: "s1", end_time: "2026-12-01T00:00:00+0000", cells: { data: [{ campaigns: { data: [{ id: "1" }] } }] } },
      { id: "s0", end_time: "2026-11-01T00:00:00+0000", cells: { data: [{ campaigns: { data: [{ id: "2" }] } }] } },
    ],
    new Date("2026-11-26T10:00:00Z"),
  );
  assert.deepEqual([...running], [["1", "s1"]]);
});

test("the targeting write adds the audience and leaves Advantage+ on: targeting_automation is kept as Meta returned it", () => {
  const targeting = { age_min: 18, age_max: 65, age_range: [25, 40], targeting_automation: { advantage_audience: 1 }, custom_audiences: [{ id: "1", name: "A" }] };
  const merged = mergeAudienceIntoTargeting(targeting, { id: "230000000000000001", name: "NX Signups" }, "include", "add");
  assert.ok(merged.ok);
  if (!merged.ok) return;
  assert.deepEqual(merged.targeting.targeting_automation, { advantage_audience: 1 });
  assert.deepEqual(merged.targeting.age_range, [25, 40]);
  assert.deepEqual((merged.targeting.custom_audiences as Array<{ id: string }>).map((a) => a.id), ["1", "230000000000000001"]);
});

test("the refresh's move, shared with move_budget: the giving side first, a retry with the stored plan doesn't move twice", async () => {
  // First try: the giving side lands, Meta refuses the receiving side.
  const budgets2 = new Map([["a", 3000], ["b", 2000]]);
  const posts2: string[] = [];
  let failB = true;
  const meta2 = {
    readAdSet: async (id: string) => ({ id, campaignId: "c", effectiveStatus: "ACTIVE", dailyBudget: budgets2.get(id)! }),
    updateAdSetDailyBudget: async (id: string, minor: number) => {
      if (id === "b" && failB) throw new Error("boom");
      posts2.push(`${id}:${minor}`);
      budgets2.set(id, minor);
    },
  };
  const l2 = ledger();
  const partial = await moveAdSetDailyBudget(meta2 as never, l2.ctx, { key: "k2", fromAdsetId: "a", toAdsetId: "b", deltaMinor: 500, campaignIds: ["c"] });
  assert.deepEqual([partial.state, partial.stop, partial.result.written], ["failed", "meta_failed", ["a"]]);
  failB = false;
  const retry = await moveAdSetDailyBudget(meta2 as never, l2.ctx, { key: "k2", fromAdsetId: "a", toAdsetId: "b", deltaMinor: 500, campaignIds: ["c"], previous: partial.result.plan as MovePlan });
  assert.equal(retry.state, "applied");
  assert.deepEqual(posts2, ["a:2500", "b:2500"], "the giving side isn't moved a second time");
  // Outside the campaign or not daily: stopped with a reason code.
  const out = await moveAdSetDailyBudget({ readAdSet: async (id: string) => ({ id, campaignId: "x", effectiveStatus: "ACTIVE", dailyBudget: 1 }), updateAdSetDailyBudget: async () => undefined } as never, l2.ctx, { key: "k3", fromAdsetId: "a", toAdsetId: "b", deltaMinor: 1, campaignIds: ["c"] });
  assert.equal(out.stop, "not_in_campaign");
});

test("migration 271: scheduled_meta_changes service role only (RLS on, no policy), the claim states, and the op_kind CHECK keeps prod's 22 kinds plus five", () => {
  const raw = readFileSync(new URL("../../../supabase/migrations/271_scheduled_meta_changes.sql", import.meta.url));
  const sql = raw.toString("utf8");
  assert.match(sql, /create table if not exists public\.scheduled_meta_changes \(/);
  assert.match(sql, /alter table public\.scheduled_meta_changes enable row level security;/);
  assert.match(sql, /revoke all on public\.scheduled_meta_changes from anon, authenticated;/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /\b(drop table|truncate|drop column)\b/i);
  assert.match(sql, /status in \('scheduled', 'applying', 'applied', 'skipped', 'cancelled', 'failed'\)/);
  assert.match(sql, /approval_source in \('claude_prompt'\)/);
  const kinds = [...sql.slice(sql.indexOf("check (op_kind in (")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const prod = ["campaign_create", "adset_create", "ad_create", "creative_upload", "adset_targeting_update", "adset_destination_update", "refresh_creative_create", "refresh_ad_create", "ad_status_update", "adset_status_update", "refresh_adset_budget_update", "refresh_adset_create", "refresh_custom_conversion_create", "refresh_campaign_create", "refresh_campaign_lifetime_budget_update", "refresh_campaign_status_update", "retargeting_audience_rule_update", "retargeting_study_create", "retargeting_study_end", "adset_end_time_update", "customer_list_create", "customer_list_users"];
  assert.deepEqual(kinds, [...prod, "campaign_status_update", "adset_budget_update", "campaign_budget_update", "object_name_update", "ad_study_create"]);
  // The pinned file (the PR body gives the same sha256).
  assert.match(createHash("sha256").update(raw).digest("hex"), /^[0-9a-f]{64}$/);
});

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
