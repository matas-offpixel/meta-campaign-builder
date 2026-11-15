import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeObjectiveBudget } from "../compute.ts";
import { googleObjective, metaObjective } from "../objectives.ts";
import { loadObjectiveBudgetInput, readObjectiveBudget, scopeEvents } from "../read.ts";
import type { ObjectiveBudgetResult, ObjectiveRow } from "../types.ts";
import { BRAND, S1, S2, fixture } from "./fixture.ts";

const TO = "2026-11-04";

function row(r: ObjectiveBudgetResult, label: string, channel: ObjectiveRow["channel"]): ObjectiveRow {
  const found = r.rows.find((x) => x.label === label && x.channel === channel);
  assert.ok(found, `no ${label} · ${channel} row`);
  return found;
}

const close = (a: number | null, b: number) => assert.ok(a != null && Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

describe("metaObjective: phaseFromMetaObjective, then its own mapping", () => {
  const cases: [string | null, string | null, string | null, string | null][] = [
    ["OUTCOME_SALES", "OFFSITE_CONVERSIONS", "COMPLETE_REGISTRATION", "registration"],
    ["OUTCOME_LEADS", "OFFSITE_CONVERSIONS", "COMPLETE_REGISTRATION", "registration"],
    ["OUTCOME_LEADS", "LEAD_GENERATION", null, "registration"],
    ["OUTCOME_SALES", "OFFSITE_CONVERSIONS", "PURCHASE", "purchase"],
    ["OUTCOME_SALES", "OFFSITE_CONVERSIONS", "INITIATED_CHECKOUT", "purchase"],
    ["OUTCOME_SALES", "OFFSITE_CONVERSIONS", "OTHER", "purchase"],
    // A sales campaign optimising for landing page views is still Purchase under the shared mapping.
    ["OUTCOME_SALES", "LANDING_PAGE_VIEWS", null, "purchase"],
    ["OUTCOME_SALES", "OFFSITE_CONVERSIONS", null, null],
    ["OUTCOME_TRAFFIC", "LANDING_PAGE_VIEWS", null, "traffic"],
    ["LINK_CLICKS", "LINK_CLICKS", null, "traffic"],
    ["OUTCOME_AWARENESS", "REACH", null, "awareness_engagement"],
    ["OUTCOME_ENGAGEMENT", "POST_ENGAGEMENT", null, "awareness_engagement"],
    ["VIDEO_VIEWS", null, null, "awareness_engagement"],
    [null, null, null, null],
    ["APP_INSTALLS", null, null, null],
  ];
  for (const [campaignObjective, optimizationGoal, promotedEvent, want] of cases) {
    it(`${campaignObjective} / ${optimizationGoal} / ${promotedEvent} → ${want}`, () => {
      assert.equal(metaObjective({ campaignObjective, optimizationGoal, promotedEvent }).objective, want);
    });
  }
  it("marks a lead ad set", () => {
    assert.equal(metaObjective({ campaignObjective: "OUTCOME_LEADS", optimizationGoal: "LEAD_GENERATION", promotedEvent: null }).lead, true);
    assert.equal(metaObjective({ campaignObjective: "OUTCOME_SALES", optimizationGoal: "OFFSITE_CONVERSIONS", promotedEvent: "COMPLETE_REGISTRATION" }).lead, false);
  });
  it("Google: Search is Traffic, Video is Awareness & engagement, anything else isn't stored", () => {
    assert.equal(googleObjective("SEARCH"), "traffic");
    assert.equal(googleObjective("VIDEO"), "awareness_engagement");
    assert.equal(googleObjective("DISPLAY"), null);
    assert.equal(googleObjective(null), null);
  });
});

describe("objective × channel, client scope, since launch", () => {
  const r = computeObjectiveBudget(fixture(), { kind: "client" }, { from: null, to: TO });

  it("each channel's rows sum to its D12 paid spend", () => {
    for (const channel of ["meta", "tiktok", "google"] as const) {
      const sum = r.rows.filter((x) => x.channel === channel).reduce((s, x) => s + (x.spend.value ?? 0), 0);
      close(sum, r.paidInPeriod[channel]);
    }
    close(r.paidInPeriod.meta, 525);
    close(r.paidInPeriod.tiktok, 85);
    close(r.paidInPeriod.google, 37.5);
    close(r.paidInPeriod.all, 647.5);
  });

  it("Registration: registrations, and leads for a lead ad set", () => {
    const reg = row(r, "Registration", "meta");
    close(reg.spend.value, 140);
    assert.equal(reg.resultMetric, "registrations");
    assert.equal(reg.result.value, 100);
    close(reg.costPerResult.value, 1.4);
    assert.equal(reg.roas, null);
  });

  it("Purchase: purchases, ROAS slot with its reason (Meta purchase value isn't stored)", () => {
    const p = row(r, "Purchase", "meta");
    close(p.spend.value, 220);
    assert.equal(p.result.value, 11);
    close(p.costPerResult.value, 20);
    assert.ok(p.roas);
    assert.equal(p.roas.value, null);
    assert.match(p.roas.source, /action_values/);
  });

  it("Traffic: landing page views on Meta, clicks on Google Search", () => {
    const t = row(r, "Traffic", "meta");
    assert.equal(t.result.value, 400);
    close(t.costPerResult.value, 0.125);
    const g = row(r, "Traffic", "google");
    close(g.spend.value, 12.5);
    assert.equal(g.resultMetric, "clicks");
    assert.equal(g.result.value, 50);
    close(g.costPerResult.value, 0.25);
  });

  it("Awareness & engagement: reach, including the brand campaign and an override", () => {
    const a = row(r, "Awareness & engagement", "meta");
    close(a.spend.value, 55);
    assert.equal(a.result.value, 12000);
    assert.match(a.result.source, /counted again/);
  });

  it("spend with no stored objective is its own row per channel", () => {
    close(row(r, "Objective not stored", "meta").spend.value, 60);
    close(row(r, "Objective not stored", "tiktok").spend.value, 85);
    close(row(r, "Objective not stored", "google").spend.value, 25);
    const tt = row(r, "Objective not stored", "tiktok");
    assert.equal(tt.result.value, null);
    assert.equal(tt.costPerResult.value, null);
    assert.match(tt.spend.source, /TikTok/);
  });

  it("another promoter's campaign on the shared account is never counted", () => {
    const all = r.rows.reduce((s, x) => s + (x.spend.value ?? 0), 0);
    close(all, 647.5);
  });

  it("share of spend is of the scope's paid spend", () => {
    close(row(r, "Purchase", "meta").shareOfSpend.value, 220 / 647.5);
  });

  it("rows come in objective order, not stored last", () => {
    assert.deepEqual(
      r.rows.map((x) => `${x.label}·${x.channel}`),
      [
        "Registration·meta",
        "Purchase·meta",
        "Traffic·meta",
        "Traffic·google",
        "Awareness & engagement·meta",
        "Objective not stored·meta",
        "Objective not stored·tiktok",
        "Objective not stored·google",
      ],
    );
  });
});

describe("objective × channel, a period and a show", () => {
  it("a period reads only its days", () => {
    const r = computeObjectiveBudget(fixture(), { kind: "client" }, { from: "2026-09-15", to: "2026-09-30" });
    close(r.paidInPeriod.all, 402.5);
    close(row(r, "Purchase", "meta").spend.value, 220);
    assert.equal(r.rows.find((x) => x.label === "Registration"), undefined);
    close(row(r, "Awareness & engagement", "meta").spend.value, 25);
  });

  it("a show reads its own campaigns only", () => {
    const r = computeObjectiveBudget(fixture(), { kind: "show", eventId: S1 }, { from: null, to: TO });
    close(r.paidInPeriod.all, 392.5);
    close(row(r, "Registration", "meta").spend.value, 100);
    close(row(r, "Objective not stored", "meta").spend.value, 60);
    assert.equal(r.rows.some((x) => x.channel === "tiktok"), false);
  });

  it("an undated brand campaign is a scope of its own", () => {
    const r = computeObjectiveBudget(fixture(), { kind: "show", eventId: BRAND }, { from: null, to: TO });
    close(r.paidInPeriod.all, 45);
    close(row(r, "Awareness & engagement", "meta").spend.value, 30);
  });

  it("an override wins over the [CODE] in the name", () => {
    const input = fixture();
    input.overrides.meta.m3 = S1;
    const r = computeObjectiveBudget(input, { kind: "show", eventId: S1 }, { from: null, to: TO });
    close(row(r, "Traffic", "meta").spend.value, 50);
  });
});

describe("budget", () => {
  it("plan is budget_marketing (one per venue code) + additional spend; variance and total follow E6", () => {
    const b = computeObjectiveBudget(fixture(), { kind: "client" }, { from: null, to: TO }).budget;
    assert.equal(b.planParts.budgetMarketing.value, 23000);
    assert.equal(b.planParts.additionalSpend.value, 150);
    assert.equal(b.plan.value, 23150);
    assert.equal(b.paid.value, 647.5);
    assert.equal(b.credits.value, 40);
    assert.equal(b.variance.value, 23150 - 647.5 + 40);
    assert.equal(b.variance.source, "plan − paid + credits");
    // Sub-budgets: what ran under one (120), the allocation of the other (300).
    assert.equal(b.subBudgets.value, 420);
    assert.match(b.subBudgets.source, /Night Two afters/);
    // WhatsApp rate not set: D2C is SMS only, and the total says it excludes WhatsApp.
    assert.equal(b.d2cParts.whatsapp.value, null);
    assert.equal(b.d2c.value, 80);
    assert.equal(b.totalMarketing.value, 647.5 + 420 + 80);
    assert.deepEqual(b.totalExcludes, ["WhatsApp"]);
    assert.match(b.totalMarketing.source, /excludes WhatsApp/);
  });

  it("with the Bird rate set, WhatsApp is delivered × rate", () => {
    const input = fixture();
    input.d2c.rate = { rate: 0.02, currency: "GBP" };
    const b = computeObjectiveBudget(input, { kind: "client" }, { from: null, to: TO }).budget;
    assert.equal(b.d2cParts.whatsapp.value, 20);
    assert.equal(b.d2c.value, 100);
    assert.deepEqual(b.totalExcludes, []);
    assert.equal(b.totalMarketing.value, 647.5 + 420 + 100);
  });

  it("no rate and no SMS: D2C is null, never £0", () => {
    const input = fixture();
    input.entries = input.entries!.filter((e) => e.kind !== "sms_cost");
    const b = computeObjectiveBudget(input, { kind: "client" }, { from: null, to: TO }).budget;
    assert.equal(b.d2c.value, null);
    assert.equal(b.totalMarketing.value, 647.5 + 420);
  });

  it("a client season budget is the plan when entered", () => {
    const input = fixture();
    input.entries!.push({ id: "s", eventId: null, kind: "season_budget", label: "Season 1", amount: 20000, spent: null, day: "2026-05-25" });
    const b = computeObjectiveBudget(input, { kind: "client" }, { from: null, to: TO }).budget;
    assert.equal(b.plan.value, 20000);
    assert.match(b.plan.source, /Season 1/);
    assert.equal(b.variance.value, 20000 - 647.5 + 40);
  });

  it("a show's plan is its own budget_marketing; client-level entries stay with the client", () => {
    const b = computeObjectiveBudget(fixture(), { kind: "show", eventId: S1 }, { from: null, to: TO }).budget;
    assert.equal(b.plan.value, 10150);
    assert.equal(b.credits.value, 0);
    assert.equal(b.subBudgets.value, 120);
    assert.equal(b.d2cParts.sms.value, 0);
    assert.equal(b.paid.value, 392.5);
  });

  it("before migration 250 every entered figure says so", () => {
    const input = fixture();
    input.entries = null;
    const b = computeObjectiveBudget(input, { kind: "client" }, { from: null, to: TO }).budget;
    assert.equal(b.credits.value, 0);
    assert.match(b.credits.source, /migration 250/);
    assert.equal(b.subBudgets.value, 0);
  });

  it("budget runs since launch even when the rows are a period", () => {
    const r = computeObjectiveBudget(fixture(), { kind: "client" }, { from: "2026-09-15", to: TO });
    assert.equal(r.budget.paid.value, 647.5);
  });

  it("no budget anywhere: plan and variance are null", () => {
    const input = fixture();
    for (const e of input.events) e.budgetMarketing = null;
    input.additionalSpend = [];
    const b = computeObjectiveBudget(input, { kind: "client" }, { from: null, to: TO }).budget;
    assert.equal(b.plan.value, null);
    assert.equal(b.variance.value, null);
  });
});

describe("scopeEvents", () => {
  it("keeps dated shows and brand campaigns, drops cancelled and undated shows", () => {
    const base = { name: "x", meta_campaign_id: null, meta_ad_account_id: null, budget_marketing: null };
    const out = scopeEvents([
      { ...base, id: "a", event_code: "A", event_date: "2026-10-01", kind: "event", status: "upcoming" },
      { ...base, id: "b", event_code: "B", event_date: null, kind: "brand_campaign", status: "on_sale" },
      { ...base, id: "c", event_code: "C", event_date: null, kind: "event", status: "upcoming" },
      { ...base, id: "d", event_code: "D", event_date: "2026-10-01", kind: "event", status: "cancelled" },
    ]);
    assert.deepEqual(out.map((e) => e.eventId), ["a", "b"]);
    assert.equal(out[1].kind, "brand_campaign");
  });
});

// ─── read.ts against a fake Supabase ───────────────────────────────────────

type Rows = Record<string, Record<string, unknown>[]>;

function fakeDb(tables: Rows, calls: string[] = [], missing: string[] = []) {
  return {
    from(table: string) {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      let range: [number, number] | null = null;
      const run = () => {
        if (missing.includes(table)) return { data: null, error: { message: `relation "public.${table}" does not exist` } };
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        rows.sort((a, b) => String(a.id ?? a.campaign_id ?? "").localeCompare(String(b.id ?? b.campaign_id ?? "")));
        return { data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null };
      };
      const q = {
        select() {
          return q;
        },
        eq(c: string, v: unknown) {
          filters.push((r) => r[c] === v);
          return q;
        },
        in(c: string, vs: readonly unknown[]) {
          filters.push((r) => vs.includes(r[c]));
          return q;
        },
        order() {
          return q;
        },
        range(from: number, to: number) {
          calls.push(`${table}:${from}-${to}`);
          range = [from, to];
          return Promise.resolve(run());
        },
        maybeSingle() {
          const res = run();
          return Promise.resolve({ data: res.data?.[0] ?? null, error: res.error });
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

function db(missing: string[] = [], calls: string[] = []) {
  const f = fixture();
  return fakeDb(
    {
      clients: [
        { id: "c1", name: "Riverside Venue", meta_ad_account_id: "123", status: "active", whatsapp_message_rate: null, whatsapp_message_rate_currency: null },
      ],
      events: [
        { id: S1, client_id: "c1", event_code: "RV01", name: "Night One", event_date: "2026-10-03", kind: "event", status: "upcoming", meta_campaign_id: "m1", meta_ad_account_id: null, budget_marketing: "10000.00" },
        { id: S2, client_id: "c1", event_code: "RV02", name: "Night Two", event_date: "2026-10-10", kind: "event", status: "upcoming", meta_campaign_id: null, meta_ad_account_id: null, budget_marketing: "8000.00" },
        { id: BRAND, client_id: "c1", event_code: "RVBR", name: "Brand (always-on)", event_date: null, kind: "brand_campaign", status: "on_sale", meta_campaign_id: null, meta_ad_account_id: null, budget_marketing: "5000.00" },
      ],
      ad_daily_insights: f.metaAdDays.map((a, i) => ({
        id: `ad${i}`,
        ad_account_id: "act_123",
        meta_campaign_id: a.campaignId,
        meta_adset_id: a.adSetId,
        campaign_name: a.campaignName,
        date: a.day,
        spend: String(a.spend),
        impressions: a.impressions,
        reach: a.reach,
        link_clicks: a.linkClicks,
        landing_page_views: a.landingPageViews,
        registrations: a.registrations,
        leads: a.leads,
        purchases: a.purchases,
        campaign_objective: a.campaignObjective,
        optimization_goal: a.optimizationGoal,
        promoted_event: a.promotedEvent,
      })),
      google_ads_daily_snapshots: f.googleDays.map((g, i) => ({
        id: `g${i}`,
        event_code: g.eventCode,
        date: g.day,
        cost_micros: g.spend * 1_000_000,
        campaign_resource_name: `customers/1/campaigns/${g.campaignId}`,
        advertising_channel_type: g.channelType,
        impressions: g.impressions,
        clicks: g.clicks,
        conversions: 0,
        conversion_value_micros: 0,
      })),
      event_daily_rollups: f.rollups.map((r, i) => ({
        id: `r${i}`,
        event_id: r.eventId,
        date: r.day,
        ad_spend: r.meta,
        tiktok_spend: r.tiktok,
        google_ads_spend: r.google,
        source_meta_at: r.metaSynced ? "x" : null,
        source_tiktok_at: r.tiktokSynced ? "x" : null,
        source_google_ads_at: r.googleSynced ? "x" : null,
      })),
      additional_spend_entries: [{ id: "x1", event_id: S1, scope: "event", date: "2026-09-10", amount: "150.00" }],
      marketing_budget_entries: f.entries!.map((e) => ({ id: e.id, client_id: "c1", event_id: e.eventId, kind: e.kind, label: e.label, amount: String(e.amount), spent: e.spent == null ? null : String(e.spent), entry_date: e.day })),
      campaign_event_overrides: [{ platform: "meta", campaign_id: "m7", event_id: S2 }],
      d2c_broadcast_stats: f.d2c.rows.map((r) => ({ ...r })),
    },
    calls,
    missing,
  );
}

describe("readObjectiveBudget", () => {
  it("reads the same figures as the pure calc, every SELECT paged", async () => {
    const calls: string[] = [];
    const r = await readObjectiveBudget(db([], calls) as never, { clientId: "c1", to: TO });
    assert.ok(r);
    const want = computeObjectiveBudget(fixture(), { kind: "client" }, { from: null, to: TO });
    assert.deepEqual(r.rows, want.rows);
    assert.deepEqual(r.budget, want.budget);
    for (const t of ["events", "ad_daily_insights", "google_ads_daily_snapshots", "event_daily_rollups", "additional_spend_entries", "marketing_budget_entries", "d2c_broadcast_stats"]) {
      assert.ok(calls.includes(`${t}:0-999`), `${t} not paged`);
    }
  });

  it("migration 250 not applied: entries read as null", async () => {
    const input = await loadObjectiveBudgetInput(db(["marketing_budget_entries"]) as never, "c1");
    assert.ok(input);
    assert.equal(input.entries, null);
  });

  it("a show that isn't the client's reads as null", async () => {
    assert.equal(await readObjectiveBudget(db() as never, { clientId: "c1", eventId: "someone-else", to: TO }), null);
  });

  it("to defaults to yesterday (London)", async () => {
    const r = await readObjectiveBudget(db() as never, { clientId: "c1", eventId: S2, today: "2026-09-22" });
    assert.ok(r);
    assert.equal(r.period.to, "2026-09-21");
    close(r.paidInPeriod.all, 40 + 50 + 70 + 20);
  });
});
