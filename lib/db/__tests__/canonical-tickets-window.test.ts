/**
 * lib/db/__tests__/canonical-tickets-window.test.ts
 *
 * Guards the per-event "tickets sold" routing rule used by the
 * Campaign Performance card / Performance Summary table / sell-out
 * pacing. The picker (`pickTicketsSoldInWindow`) chooses between two
 * upstream sources per event:
 *
 *   - `tier_channel_sales.tickets_sold` SUM  ← manual cadence (J2,
 *     Innervisions, KOC). Authoritative when the event has a
 *     `manual_backfill` row in `tier_channel_sales_daily_history`
 *     and a non-zero tier-channel SUM.
 *   - `event_daily_rollups.tickets_sold` SUM ← API cadence
 *     (4theFans Brighton). Unchanged behaviour — required by the
 *     "4thefans-style API clients must keep working unchanged"
 *     constraint on this fix.
 *
 * Fixtures mirror the real shapes verified in Supabase 2026-05-26:
 *   - J2 Hard Techno (UTB0046-New): manual_backfill history,
 *     tier_channel_sales SUM = 1273, rollup tickets_sold SUM = 553.
 *   - 4thefans Brighton: cron rollups, no manual_backfill row.
 *   - Mixed: pre-tool manual_backfill + later cron rows on the same
 *     event (the migration case for KOC if/when they connect an API).
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  pickCanonicalLifetimeTickets,
  pickTicketsSoldInWindow,
} from "../canonical-tickets-window.ts";
import type { TierChannelDailyHistoryRow } from "../tier-channel-daily-history.ts";

const J2_EVENT_ID = "j2-event-id";
const BRIGHTON_EVENT_ID = "brighton-event-id";

function historyRow(
  partial: Partial<TierChannelDailyHistoryRow> & {
    snapshot_date: string;
    tickets_sold_total: number;
    source_kind: TierChannelDailyHistoryRow["source_kind"];
  },
): TierChannelDailyHistoryRow {
  return {
    id: `${partial.snapshot_date}-${partial.source_kind}`,
    event_id: J2_EVENT_ID,
    revenue_total: 0,
    captured_at: `${partial.snapshot_date}T00:00:00Z`,
    ...partial,
  };
}

describe("pickTicketsSoldInWindow — J2 manual_backfill (lifetime)", () => {
  it("returns tier_channel_sales SUM when event has a manual_backfill row", () => {
    const out = pickTicketsSoldInWindow({
      rollups: [
        { date: "2026-05-20", tickets_sold: 200 },
        { date: "2026-05-25", tickets_sold: 353 }, // SUM = 553
      ],
      dailyHistory: [
        historyRow({
          snapshot_date: "2026-05-20",
          tickets_sold_total: 1100,
          source_kind: "manual_backfill",
        }),
        historyRow({
          snapshot_date: "2026-05-25",
          tickets_sold_total: 1273,
          source_kind: "manual_backfill",
        }),
      ],
      eventIds: new Set([J2_EVENT_ID]),
      tierChannelLifetime: 1273,
      windowDays: null,
    });
    assert.equal(
      out,
      1273,
      "manual cadence + lifetime ⇒ tier_channel_sales current cumulative wins, not the 553 rollup sum",
    );
  });

  it("returns the tier-channel SUM even when it diverges from the latest history row", () => {
    // Real-world: tier_channel_sales gets upserted faster than the cron
    // writes a new daily_history row, so the latest cumulative can be a
    // few hours ahead of the most recent snapshot_date.
    const out = pickTicketsSoldInWindow({
      rollups: [],
      dailyHistory: [
        historyRow({
          snapshot_date: "2026-05-24",
          tickets_sold_total: 1240,
          source_kind: "manual_backfill",
        }),
      ],
      eventIds: new Set([J2_EVENT_ID]),
      tierChannelLifetime: 1273,
      windowDays: null,
    });
    assert.equal(out, 1273);
  });
});

describe("pickCanonicalLifetimeTickets — J2 baseline-suppression case (Innervisions)", () => {
  it("returns the absolute cumulative, not the per-day-delta sum", () => {
    // Innervisions opened with cumulative=489 BEFORE the tool tracked
    // them. Summing corroborated daily deltas would yield only
    // (latest − 489); the pacing helper must read the absolute number.
    const out = pickCanonicalLifetimeTickets({
      rollups: [],
      dailyHistory: [
        historyRow({
          snapshot_date: "2026-05-01",
          tickets_sold_total: 489, // pre-tool baseline
          source_kind: "manual_backfill",
        }),
        historyRow({
          snapshot_date: "2026-05-25",
          tickets_sold_total: 1273,
          source_kind: "manual_backfill",
        }),
      ],
      eventIds: new Set([J2_EVENT_ID]),
      tierChannelLifetime: 1273,
    });
    assert.equal(out, 1273, "pacing needs the absolute lifetime cumulative");
  });
});

describe("pickTicketsSoldInWindow — 4thefans Brighton (cron rollups only)", () => {
  it("returns the rollup SUM (existing behaviour) when no manual_backfill row exists", () => {
    const out = pickTicketsSoldInWindow({
      rollups: [
        { date: "2026-05-10", tickets_sold: 30 },
        { date: "2026-05-11", tickets_sold: 42 },
        { date: "2026-05-12", tickets_sold: 38 },
      ],
      dailyHistory: [
        // cron-source history coexists but does NOT trigger the
        // canonical bypass — the picker stays on the rollup path.
        {
          id: "cron-1",
          event_id: BRIGHTON_EVENT_ID,
          snapshot_date: "2026-05-10",
          tickets_sold_total: 30,
          revenue_total: 0,
          source_kind: "cron",
          captured_at: "2026-05-10T23:55:00Z",
        },
        {
          id: "cron-2",
          event_id: BRIGHTON_EVENT_ID,
          snapshot_date: "2026-05-11",
          tickets_sold_total: 72,
          revenue_total: 0,
          source_kind: "cron",
          captured_at: "2026-05-11T23:55:00Z",
        },
      ],
      eventIds: new Set([BRIGHTON_EVENT_ID]),
      tierChannelLifetime: 110, // tier_channel side ALSO populated by cron — non-zero
      windowDays: null,
    });
    assert.equal(
      out,
      110,
      "no manual_backfill ⇒ rollup-sum path; cron clients keep working unchanged",
    );
  });

  it("preserves the lifetime path when tier_channel SUM is zero/null", () => {
    const out = pickTicketsSoldInWindow({
      rollups: [
        { date: "2026-05-10", tickets_sold: 30 },
        { date: "2026-05-11", tickets_sold: 42 },
      ],
      dailyHistory: [],
      eventIds: new Set([BRIGHTON_EVENT_ID]),
      tierChannelLifetime: null,
      windowDays: null,
    });
    assert.equal(out, 72);
  });

  it("preserves the null-when-no-data signal", () => {
    const out = pickTicketsSoldInWindow({
      rollups: [],
      dailyHistory: [],
      eventIds: new Set([BRIGHTON_EVENT_ID]),
      tierChannelLifetime: null,
      windowDays: null,
    });
    assert.equal(
      out,
      null,
      "neither side has data ⇒ null, caller falls back to events.tickets_sold / plan-day",
    );
  });
});

describe("pickTicketsSoldInWindow — mixed source migration (manual then cron)", () => {
  it("treats the event as manual-cadence as long as ANY manual_backfill row exists", () => {
    // KOC pattern (hypothetical): operator backfilled cumulatives, then
    // a 4TF connection started writing cron rows. Both source_kinds
    // coexist on different snapshot_dates. The latest cumulative is
    // still the truth.
    const out = pickTicketsSoldInWindow({
      rollups: [{ date: "2026-05-25", tickets_sold: 50 }],
      dailyHistory: [
        historyRow({
          snapshot_date: "2026-05-01",
          tickets_sold_total: 800,
          source_kind: "manual_backfill",
        }),
        historyRow({
          snapshot_date: "2026-05-25",
          tickets_sold_total: 850,
          source_kind: "cron",
        }),
      ],
      eventIds: new Set([J2_EVENT_ID]),
      tierChannelLifetime: 850,
      windowDays: null,
    });
    assert.equal(out, 850);
  });
});

describe("pickTicketsSoldInWindow — windowed view (manual cadence)", () => {
  it("sums per-day corroborated deltas in the window, mirroring PR #464 bypass", () => {
    // Manual-bypass deltas key on the TRUE sale day (snapshot_date − 1).
    // History: 1100 → 1180 (Δ80) → 1273 (Δ93).
    //   - Δ80 keys to 2026-05-19 (sale day for the 2026-05-20 snapshot).
    //   - Δ93 keys to 2026-05-24 (sale day for the 2026-05-25 snapshot).
    // Last 7 days window: 2026-05-19..2026-05-25 → both deltas included.
    const window = [
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
      "2026-05-22",
      "2026-05-23",
      "2026-05-24",
      "2026-05-25",
    ];
    const out = pickTicketsSoldInWindow({
      rollups: [], // J2 has no rollup activity — manual bypass means none needed
      dailyHistory: [
        historyRow({
          snapshot_date: "2026-05-18",
          tickets_sold_total: 1100,
          source_kind: "manual_backfill",
        }),
        historyRow({
          snapshot_date: "2026-05-20",
          tickets_sold_total: 1180,
          source_kind: "manual_backfill",
        }),
        historyRow({
          snapshot_date: "2026-05-25",
          tickets_sold_total: 1273,
          source_kind: "manual_backfill",
        }),
      ],
      eventIds: new Set([J2_EVENT_ID]),
      tierChannelLifetime: 1273,
      windowDays: window,
    });
    assert.equal(out, 80 + 93, "deltas keyed to true sale day, both inside window");
  });

  it("excludes deltas whose true sale day falls before the window start", () => {
    const out = pickTicketsSoldInWindow({
      rollups: [],
      dailyHistory: [
        historyRow({
          snapshot_date: "2026-05-01",
          tickets_sold_total: 489,
          source_kind: "manual_backfill",
        }),
        historyRow({
          snapshot_date: "2026-05-05",
          tickets_sold_total: 600,
          source_kind: "manual_backfill",
        }),
        historyRow({
          snapshot_date: "2026-05-25",
          tickets_sold_total: 1273,
          source_kind: "manual_backfill",
        }),
      ],
      eventIds: new Set([J2_EVENT_ID]),
      tierChannelLifetime: 1273,
      // Last-7-days from 2026-05-25 — May 5 delta (true sale day May 4)
      // falls outside, May 25 delta (true sale day May 24) is inside.
      windowDays: [
        "2026-05-19",
        "2026-05-20",
        "2026-05-21",
        "2026-05-22",
        "2026-05-23",
        "2026-05-24",
        "2026-05-25",
      ],
    });
    assert.equal(out, 1273 - 600);
  });
});

describe("pickTicketsSoldInWindow — venue (multi-event)", () => {
  it("treats venue as manual-cadence when ANY scoped event has a manual_backfill row", () => {
    const eventA = "venue-event-a";
    const eventB = "venue-event-b";
    const out = pickTicketsSoldInWindow({
      rollups: [
        { date: "2026-05-25", tickets_sold: 100 }, // belongs to eventB
      ],
      dailyHistory: [
        {
          id: "a-1",
          event_id: eventA,
          snapshot_date: "2026-05-25",
          tickets_sold_total: 500,
          revenue_total: 0,
          source_kind: "manual_backfill",
          captured_at: "2026-05-25T23:55:00Z",
        },
        {
          id: "b-1",
          event_id: eventB,
          snapshot_date: "2026-05-25",
          tickets_sold_total: 100,
          revenue_total: 0,
          source_kind: "cron",
          captured_at: "2026-05-25T23:55:00Z",
        },
      ],
      eventIds: new Set([eventA, eventB]),
      tierChannelLifetime: 600, // SUM across both events
      windowDays: null,
    });
    assert.equal(out, 600, "venue lifetime = tier_channel sum across both events");
  });

  it("ignores history rows for events outside the venue scope", () => {
    const insideEvent = "venue-inside";
    const outsideEvent = "venue-outside";
    const out = pickTicketsSoldInWindow({
      rollups: [{ date: "2026-05-25", tickets_sold: 30 }],
      dailyHistory: [
        {
          id: "outside-1",
          event_id: outsideEvent,
          snapshot_date: "2026-05-25",
          tickets_sold_total: 999,
          revenue_total: 0,
          source_kind: "manual_backfill",
          captured_at: "2026-05-25T23:55:00Z",
        },
      ],
      eventIds: new Set([insideEvent]),
      tierChannelLifetime: null,
      windowDays: null,
    });
    assert.equal(
      out,
      30,
      "out-of-scope manual_backfill row must not trigger the bypass for the venue",
    );
  });
});

describe("pickTicketsSoldInWindow — brand campaign / no-ticketing", () => {
  it("returns null when neither side has data (no ticketing connection)", () => {
    const out = pickTicketsSoldInWindow({
      rollups: [],
      dailyHistory: [],
      eventIds: new Set(["brand-event"]),
      tierChannelLifetime: null,
      windowDays: ["2026-05-20", "2026-05-21"],
    });
    assert.equal(out, null);
  });

  it("returns 0 (not null) when rollups exist but none fall in window", () => {
    const out = pickTicketsSoldInWindow({
      rollups: [
        { date: "2026-04-01", tickets_sold: 10 },
        { date: "2026-04-02", tickets_sold: 5 },
      ],
      dailyHistory: [],
      eventIds: new Set([BRIGHTON_EVENT_ID]),
      tierChannelLifetime: null,
      windowDays: ["2026-05-20", "2026-05-21"],
    });
    assert.equal(out, 0);
  });
});
