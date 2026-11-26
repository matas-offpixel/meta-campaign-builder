/**
 * PR D: the per-show spend ceiling (lib/mcp/meta/show-ceiling.ts). Each brand
 * default, the shared group, a launch that would cross the ceiling, a cut
 * always allowed, and each part of committed spend from its source: spent to
 * date (ad_daily_insights, paged past 1,000 rows), live lifetime budgets left
 * and live daily budgets to their end or show day. Mocks only: the fake
 * database and the live spy; nothing reaches Meta.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolInputError } from "../tool-types.ts";
import {
  BRAND_DEFAULTS,
  PUZZLE_GROUP,
  addedLine,
  brandDefault,
  checkShowCeiling,
  committedBudgets,
  daysLeft,
  daysToShow,
  draftAddedLine,
  resolveShowCeiling,
  type ShowChange,
} from "../meta/show-ceiling.ts";
import { CEILING_FOR_DESIGN } from "../meta/ceiling-words.ts";
import { fakeDb } from "./fake-db.ts";
import { OPERATOR } from "./helpers.ts";
import { ACT, ACT2, AS_BROAD, AS_FANS, BASE_COMMITTED, CAMP_A, CAMP_B, CODE, EVENT, NOW, liveDeps, liveSpy, liveTables } from "./live-fixtures.ts";

const EVENT2 = "e0000000-0000-4000-8000-00000000e002";
const GROUP = "5e000000-0000-4000-8000-0000000000a1";

async function refused(p: Promise<unknown>, re: RegExp): Promise<ToolInputError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ToolInputError, `a plain refusal, got ${e instanceof Error ? e.message : e}`);
    assert.match(e.message, re);
    assert.match(e.message, /Nothing was sent to Meta\.$/);
    return e;
  }
  assert.fail("expected a refusal");
}

function setup(opts: { ceiling?: number | null; spent?: number; code?: string } = {}) {
  const tables = liveTables({ ceiling: opts.ceiling, spent: opts.spent }) as Record<string, Record<string, unknown>[]>;
  if (opts.code) tables.events![0]!.event_code = opts.code;
  const db = fakeDb(tables);
  const spy = liveSpy();
  const live = liveDeps(spy);
  const check = (change: ShowChange, event: { id: string; code?: string } = { id: EVENT }) => checkShowCeiling({ db, live, userId: OPERATOR, event, change, now: NOW });
  return { db, spy, live, check, tables };
}

const raiseBroad = (minor: number): ShowChange => ({ starts: false, objects: [{ kind: "adset", id: AS_BROAD, dailyMinor: minor }] });

// ── Brand defaults ──────────────────────────────────────────────────────────

test("brand defaults by the code's leading letters: NX £3,000, ES £2,500, AS £2,000; EBR waits for Matas; DHB and P26 none", () => {
  assert.equal(brandDefault("NX26-AZYR")?.totalGbp, 3000);
  assert.equal(brandDefault("nx27-ewanmcvicar")?.totalGbp, 3000);
  assert.equal(brandDefault("ES27-DAVEPEARCE")?.totalGbp, 2500);
  assert.equal(brandDefault("AS26-HOU")?.totalGbp, 2000);
  // EBR is its own brand (ES never matches it) and isn't confirmed.
  assert.deepEqual([brandDefault("EBR27-GLITTERBOX")?.brand, brandDefault("EBR27-GLITTERBOX")?.totalGbp, brandDefault("EBR27-GLITTERBOX")?.confirmed], ["EBR", 2500, false]);
  assert.equal(brandDefault("DHB26-DUBAI")?.totalGbp, null);
  // P26 is a shared group, not a per-show default; the group is empty until Matas names its two shows.
  assert.equal(brandDefault("P26-BDAY"), null);
  assert.deepEqual([PUZZLE_GROUP.totalGbp, PUZZLE_GROUP.eventCodes.length], [4500, 0]);
  assert.equal(brandDefault("WC26-ABERDEEN"), null);
  assert.equal(brandDefault(null), null);
  assert.deepEqual(BRAND_DEFAULTS.filter((d) => !d.confirmed).map((d) => d.brand), ["EBR"]);
});

test("each default holds a show with no row of its own: NX, ES and AS check against their total", async () => {
  for (const [code, total] of [["NX27-LIVE", 3000], ["ES27-LIVE", 2500], ["AS27-LIVE", 2000]] as const) {
    const { check } = setup({ code });
    const out = await check({ starts: true });
    assert.deepEqual([out.checked, out.ceilingGbp, out.source, out.after], [true, total, { kind: "default", brand: code.slice(0, 2) }, BASE_COMMITTED], code);
    // Broad £30 → £80 takes the show to £2,875.00, over AS's £2,000; Broad → £50 (£2,125.00) fits NX and ES.
    if (total === 2000) await refused(check(raiseBroad(8000)), /to £2,875\.00 committed, over its £2,000\.00 ceiling \(the AS default\)/);
    else await check(raiseBroad(5000));
  }
});

test("no ceiling: DHB (set per show), P26 outside its group, and EBR until Matas confirms; refused before Meta is read", async () => {
  for (const [code, re] of [
    ["DHB27-LIVE", /^Refused: DHB27-LIVE has no spend ceiling, so nothing that starts or raises spend can run\. Matas sets one for the show\./],
    ["P26-LIVE", /^Refused: P26-LIVE has no spend ceiling/],
    ["EBR27-LIVE", /^Refused: EBR27-LIVE has no spend ceiling yet: the EBR default of £2,500\.00 waits for Matas to confirm it\./],
  ] as const) {
    const { check, spy } = setup({ code });
    const e = await refused(check({ starts: true }), re);
    assert.equal(e.summary?.refused, "no_ceiling");
    assert.deepEqual(spy.calls, [], `${code}: nothing read from Meta for a change that starts spend`);
  }
});

test("a show's own row wins over its brand default", async () => {
  const { check, db } = setup({ code: "NX27-LIVE" });
  await db.from("show_spend_ceilings").insert({ id: "5e000000-0000-4000-8000-0000000000b1", event_id: EVENT, group_name: null, total_gbp: 1000, set_by: OPERATOR, set_at: "2026-11-26T09:00:00Z" });
  await refused(check({ starts: true }), /over its £1,000\.00 ceiling \(set for this show\)/);
});

// ── The shared group ────────────────────────────────────────────────────────

function withGroup(total: number, otherSpent: number) {
  const s = setup();
  const t = s.tables;
  t.events!.push({ ...t.events![0]!, id: EVENT2, event_code: "DHB27-LIVE2", meta_campaign_id: "120000000000000777" });
  t.show_spend_ceilings!.push({ id: GROUP, event_id: null, group_name: "DHB shared", total_gbp: total, set_by: OPERATOR, set_at: "2026-11-26T09:00:00Z" });
  t.show_spend_ceiling_events!.push({ event_id: EVENT, ceiling_id: GROUP, added_by: OPERATOR, added_at: "2026-11-26T09:00:00Z" });
  t.show_spend_ceiling_events!.push({ event_id: EVENT2, ceiling_id: GROUP, added_by: OPERATOR, added_at: "2026-11-26T09:00:00Z" });
  // The other show spent on its own (now deleted) campaign: its spend still counts.
  t.ad_daily_insights!.push({ meta_ad_id: "ad-other", meta_adset_id: "as-other", meta_campaign_id: "120000000000000777", ad_account_id: ACT, date: "2026-11-24", spend: otherSpent });
  return s;
}

test("a shared group: one total over both shows' committed spend, named in the refusal", async () => {
  {
    const { check } = withGroup(2000, 300);
    const out = await check({ starts: true });
    assert.deepEqual([out.ceilingGbp, out.after, out.source], [2000, BASE_COMMITTED + 300, { kind: "group", codes: ["DHB27-LIVE", "DHB27-LIVE2"] }]);
  }
  {
    // The other show's £500 spent takes the pair to £2,125.00: refused, though this show alone is under.
    const { check } = withGroup(2000, 500);
    const e = await refused(
      check({ starts: true }),
      /^Refused: this would take DHB27-LIVE to £2,125\.00 committed, over its £2,000\.00 ceiling \(shared by DHB27-LIVE and DHB27-LIVE2\)\. That’s £500\.00 spent to date \(Off\/Pixel’s Meta insights, to 24 Nov\)/,
    );
    assert.equal(e.summary?.refused, "over_ceiling");
  }
  {
    // Resolved straight from the rows.
    const { db } = withGroup(4500, 0);
    const r = await resolveShowCeiling(db, { id: EVENT2, code: "DHB27-LIVE2" });
    assert.equal(r.kind, "set");
    assert.deepEqual(r.kind === "set" ? r.ceilings.map((c) => [c.totalGbp, [...c.eventIds].sort()]) : null, [[4500, [EVENT, EVENT2].sort()]]);
  }
});

// ── Launches, raises and cuts ───────────────────────────────────────────────

test("a launch that would cross the ceiling is refused; under it, it's checked and passes", async () => {
  const draft = {
    settings: { campaignName: "[DHB27-LIVE] ON SALE 3" },
    budgetSchedule: { budgetLevel: "ad_set", budgetType: "daily", budgetAmount: 0, currency: "GBP", startDate: "2026-11-27T09:00", endDate: "2026-12-06T23:59" },
    adSetSuggestions: [
      { enabled: true, budgetPerDay: 25 },
      { enabled: false, budgetPerDay: 999 },
    ],
  } as never;
  const line = draftAddedLine(draft);
  // £25 a day, 27 Nov → 6 Dec (10 days, starting tomorrow): £250.00.
  assert.deepEqual(addedLine(line, { id: EVENT, code: CODE, eventDate: "2026-12-20" }, NOW), { lifetime: 0, daily: 250 });
  {
    const { check } = setup({ ceiling: 1800 });
    const e = await refused(check({ starts: true, added: [line] }), /to £1,875\.00 committed, over its £1,800\.00 ceiling \(set for this show\)\. .*this change adds £250\.00\./);
    assert.deepEqual([e.summary?.before, e.summary?.after, e.summary?.delta], [BASE_COMMITTED, 1875, 250]);
  }
  {
    const { check } = setup({ ceiling: 1875 });
    const out = await check({ starts: true, added: [line] });
    assert.deepEqual([out.checked, out.after, out.delta], [true, 1875, 250]);
  }
});

test("a cut is always allowed: no ceiling, or already over it, and nothing is checked", async () => {
  for (const ceiling of [null, 100]) {
    const { check } = setup({ ceiling, spent: 5000 });
    const out = await check(raiseBroad(1000));
    assert.deepEqual([out.checked, out.delta], [false, -500], String(ceiling));
  }
  {
    // A lifetime cut, likewise.
    const { check, spy } = setup({ ceiling: null });
    spy.objects.get(AS_FANS)!.dailyBudgetMinor = null;
    spy.objects.get(AS_FANS)!.lifetimeBudgetMinor = 50000;
    spy.objects.get(AS_FANS)!.budgetRemainingMinor = 30000;
    const out = await check({ starts: false, objects: [{ kind: "adset", id: AS_FANS, lifetimeMinor: 40000 }] });
    assert.deepEqual([out.checked, out.delta], [false, -100]);
  }
});

test("a raise over the ceiling is refused; one that fits passes; with no ceiling a raise is refused", async () => {
  {
    const { check } = setup({ ceiling: 1700 });
    await refused(check(raiseBroad(4000)), /to £1,875\.00 committed, over its £1,700\.00 ceiling/);
    const ok = await check(raiseBroad(3100));
    assert.deepEqual([ok.checked, ok.after], [true, 1650]);
  }
  {
    const { check } = setup({ ceiling: null });
    const e = await refused(check(raiseBroad(3100)), /has no spend ceiling/);
    assert.equal(e.summary?.delta, 25);
  }
});

// ── The parts of committed spend ────────────────────────────────────────────

test("committed spend: paused budgets and ended ones count nothing, lifetime counts what's left, a campaign budget counts once", () => {
  const show = { id: EVENT, code: CODE, eventDate: "2026-12-20" };
  const base = { name: "x", accountId: ACT, startTime: null, endTime: null, budgetRemainingMinor: null, lifetimeBudgetMinor: null, dailyBudgetMinor: null };
  const t = committedBudgets(
    [
      {
        campaign: { ...base, id: "c1", status: "ACTIVE" },
        adsets: [
          { ...base, id: "a1", status: "ACTIVE", dailyBudgetMinor: 1000 },
          { ...base, id: "a2", status: "PAUSED", dailyBudgetMinor: 5000 },
          { ...base, id: "a3", status: "ACTIVE", dailyBudgetMinor: 5000, endTime: "2026-11-25T23:00:00Z" },
          { ...base, id: "a4", status: "ACTIVE", lifetimeBudgetMinor: 60000, budgetRemainingMinor: 25000 },
          { ...base, id: "a5", status: "ACTIVE", dailyBudgetMinor: 1000, endTime: "2026-11-28T23:00:00Z" },
        ],
      },
      // CBO: £40 a day on the campaign to show day, its ad sets hold no budget.
      { campaign: { ...base, id: "c2", status: "ACTIVE", dailyBudgetMinor: 4000 }, adsets: [{ ...base, id: "b1", status: "ACTIVE" }, { ...base, id: "b2", status: "ACTIVE" }] },
      // A paused campaign: its live ad sets don't spend.
      { campaign: { ...base, id: "c3", status: "PAUSED" }, adsets: [{ ...base, id: "d1", status: "ACTIVE", dailyBudgetMinor: 9900 }] },
    ],
    show,
    NOW,
  );
  // a1 £10 × 25 + a5 £10 × 3 (26–28 Nov) + c2 £40 × 25 = £1,280; a4 £250 left.
  assert.deepEqual([t.daily, t.lifetime], [1280, 250]);
  // Resuming the paused campaign adds its live ad set: £99 × 25.
  const after = committedBudgets([{ campaign: { ...base, id: "c3", status: "PAUSED" }, adsets: [{ ...base, id: "d1", status: "ACTIVE", dailyBudgetMinor: 9900 }] }], show, NOW, [{ kind: "campaign", id: "c3", status: "ACTIVE" }]);
  assert.equal(after.daily, 2475);
});

test("days: London days, today and the end both counted; a draft's zoneless dates are London time; show day when there's no end", () => {
  assert.equal(daysLeft("2026-11-28T23:00:00Z", NOW), 3);
  assert.equal(daysLeft("2026-11-26T09:00:00Z", NOW), 0, "ended this morning");
  assert.equal(daysLeft("2026-12-06T23:59", NOW, "2026-11-27T09:00"), 10);
  assert.equal(daysLeft("2026-11-26T09:00", NOW), 0, "a zoneless end that's passed in London");
  assert.equal(daysToShow("2026-12-20", NOW), 25);
  assert.equal(daysToShow("2026-11-20", NOW), 1, "a budget still on after show day counts today");
});

test("spent to date is every ad_daily_insights row on the show's campaigns, paged past PostgREST's 1,000 rows", async () => {
  const { check, tables } = setup({ ceiling: 100000 });
  for (let i = 0; i < 2500; i++) {
    tables.ad_daily_insights!.push({ meta_ad_id: `ad-${String(i).padStart(4, "0")}`, meta_adset_id: AS_BROAD, meta_campaign_id: i % 2 ? CAMP_A : CAMP_B, ad_account_id: ACT, date: "2026-11-20", spend: 1 });
  }
  // Another show's campaign: not counted.
  tables.ad_daily_insights!.push({ meta_ad_id: "ad-x", meta_adset_id: "x", meta_campaign_id: "120000000000000888", ad_account_id: ACT, date: "2026-11-25", spend: 9999 });
  const out = await check({ starts: true });
  assert.deepEqual([out.committed?.spent, out.committed?.through, out.after], [2500, "2026-11-20", BASE_COMMITTED + 2500]);
});

test("a show whose counted spend or budgets sit on an account not in £ is refused; a show with no date and an open daily budget can't be added up", async () => {
  {
    const { check, spy } = setup({ ceiling: 100000 });
    // The US campaign's ad set goes live: its budget is in USD.
    spy.objects.get("120000000000000031")!.status = "ACTIVE";
    const e = await refused(check({ starts: true }), /^Refused: DHB27-LIVE’s spend includes ad account act_222222222, which spends in USD, and ceilings are in £\./);
    assert.deepEqual([e.summary?.refused, e.summary?.account], ["not_gbp", ACT2]);
  }
  {
    const { check, tables } = setup({ ceiling: 100000 });
    tables.events![0]!.event_date = null;
    const e = await refused(check({ starts: true }), /^Refused: Broad has a daily budget with no end date and DHB27-LIVE has no show date, so its committed spend can’t be added up\./);
    assert.equal(e.summary?.refused, "unbounded");
  }
});

test("a ceiling that can't be read refuses (never assumed); Meta unread refuses with its own words", async () => {
  {
    const { db, live } = setup({ ceiling: 5000 });
    const broken = { from: (t: string) => (t === "show_spend_ceilings" ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }) } : db.from(t)) } as never;
    await refused(checkShowCeiling({ db: broken, live, userId: OPERATOR, event: { id: EVENT, code: CODE }, change: { starts: true }, now: NOW }), /^Refused: DHB27-LIVE’s spend ceiling or spend to date couldn’t be read\. Try again\./);
  }
  {
    const { db, live } = setup({ ceiling: 5000 });
    const failing = { ...live, readChildren: async () => { throw new Error("Meta said no (raw)"); } };
    await assert.rejects(checkShowCeiling({ db, live: failing, userId: OPERATOR, event: { id: EVENT, code: CODE }, change: { starts: true }, now: NOW }), (e: unknown) => {
      assert.ok(e instanceof ToolInputError);
      assert.equal(e.message, "Refused: Meta couldn’t be read, so nothing was changed. Try again.");
      assert.equal(e.summary?.refused, "meta_unread");
      return true;
    });
  }
});

test("every ceiling refusal is declared for design (PENDING DESIGN) and ends saying nothing was sent", () => {
  const keys = CEILING_FOR_DESIGN.map((w) => w.key);
  assert.deepEqual(new Set(keys).size, keys.length);
  for (const w of CEILING_FOR_DESIGN.filter((x) => x.candidate.startsWith("Refused:"))) assert.match(w.candidate, /Nothing was sent to Meta\.$/, w.key);
});
