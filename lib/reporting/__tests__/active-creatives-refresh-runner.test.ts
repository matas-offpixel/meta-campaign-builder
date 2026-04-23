// ─────────────────────────────────────────────────────────────────────────────
// active-creatives-refresh-runner tests.
//
// Run with:  node --experimental-strip-types --test lib/reporting/__tests__
//
// We never import `share-active-creatives` (which is server-only) —
// the runner takes the fetcher via the `_fetcher` injection point so
// tests can drive the loop with a fake. The Supabase client is also
// faked: only `from(table).upsert(...)` and `from(table).update(...).eq(...).is(...)`
// are exercised, mirroring the helper test stubs.
// ─────────────────────────────────────────────────────────────────────────────

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  refreshActiveCreativesForEvent,
  pickTtlMs,
  DEFAULT_REFRESH_PRESETS,
  TIGHT_TTL_WINDOW_DAYS,
  type RefreshInput,
} from "../active-creatives-refresh-runner.ts";
import {
  ACS_DEFAULT_TTL_MS,
  ACS_TIGHT_TTL_MS,
} from "../../db/active-creatives-snapshots.ts";
import type { ShareActiveCreativesResult } from "../share-active-creatives.ts";
import type { DatePreset } from "../../insights/types.ts";

// ── tiny fake supabase ─────────────────────────────────────────────────────
//
// Records every upsert so the runner's "wroteSnapshot" reporting can
// be verified end-to-end. Update calls (markSnapshotStale isn't on
// the runner's path, but the writer's chain ends with .upsert(),
// not .update(), so nothing extra is needed here).

interface FakeSupabaseRec {
  upserts: Array<{ table: string; row: Record<string, unknown> }>;
}

function makeFakeSupabase(): {
  client: SupabaseClient;
  rec: FakeSupabaseRec;
} {
  const rec: FakeSupabaseRec = { upserts: [] };
  const builder = {
    upsert(payload: Record<string, unknown>) {
      // The runner only invokes this through `writeActiveCreativesSnapshot`,
      // which records (table, row) for inspection.
      rec.upserts.push({ table: lastTable, row: payload });
      return Promise.resolve({ data: null, error: null });
    },
  };
  let lastTable = "";
  const client = {
    from(table: string) {
      lastTable = table;
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, rec };
}

// ── canned results the fake fetcher returns ────────────────────────────────

const OK_RESULT: ShareActiveCreativesResult = {
  kind: "ok",
  groups: [],
  ad_account_id: "act_1",
  event_code: "EVT-1",
  fetched_at: "2026-04-22T12:00:00Z",
  meta: {
    campaigns_total: 1,
    campaigns_failed: 0,
    ads_fetched: 0,
    dropped_no_creative: 0,
    truncated: false,
    unattributed: {
      ads_count: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      inline_link_clicks: 0,
      landingPageViews: 0,
      registrations: 0,
      purchases: 0,
    },
  },
};

const ERROR_RESULT: ShareActiveCreativesResult = {
  kind: "error",
  reason: "no_owner_token",
  message: "Owner has not connected Facebook (or token expired).",
};

const SKIP_RESULT: ShareActiveCreativesResult = {
  kind: "skip",
  reason: "no_event_code",
};

// ── tests ──────────────────────────────────────────────────────────────────

describe("pickTtlMs", () => {
  it("returns ACS_DEFAULT_TTL_MS when eventDate is null", () => {
    assert.equal(pickTtlMs(null), ACS_DEFAULT_TTL_MS);
  });

  it("returns ACS_TIGHT_TTL_MS inside the 14-day window", () => {
    const now = Date.UTC(2026, 5, 1);
    const inSevenDays = new Date(now + 7 * 24 * 60 * 60 * 1000);
    assert.equal(pickTtlMs(inSevenDays, now), ACS_TIGHT_TTL_MS);
  });

  it("returns ACS_DEFAULT_TTL_MS just past the 14-day boundary", () => {
    const now = Date.UTC(2026, 5, 1);
    const past14 = new Date(
      now + (TIGHT_TTL_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    assert.equal(pickTtlMs(past14, now), ACS_DEFAULT_TTL_MS);
  });

  it("returns ACS_DEFAULT_TTL_MS for past-show events (revenue trickle)", () => {
    const now = Date.UTC(2026, 5, 1);
    const yesterday = new Date(now - 24 * 60 * 60 * 1000);
    assert.equal(pickTtlMs(yesterday, now), ACS_DEFAULT_TTL_MS);
  });
});

describe("refreshActiveCreativesForEvent", () => {
  const baseInput: Omit<RefreshInput, "_fetcher"> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: null as any,
    eventId: "evt-1",
    userId: "user-1",
    eventCode: "EVT-1",
    adAccountId: "act_1",
    eventDate: null,
    presets: DEFAULT_REFRESH_PRESETS,
  };

  it("writes one snapshot per ok preset", async () => {
    const { client, rec } = makeFakeSupabase();
    const out = await refreshActiveCreativesForEvent({
      ...baseInput,
      supabase: client,
      _fetcher: async () => OK_RESULT,
    });
    assert.equal(out.ok, true);
    assert.equal(out.presetResults.length, DEFAULT_REFRESH_PRESETS.length);
    for (const p of out.presetResults) {
      assert.equal(p.ok, true);
      assert.equal(p.kind, "ok");
      assert.equal(p.wroteSnapshot, true);
    }
    assert.equal(rec.upserts.length, DEFAULT_REFRESH_PRESETS.length);
    // All upserts went to the right table.
    for (const u of rec.upserts) {
      assert.equal(u.table, "active_creatives_snapshots");
      assert.equal(u.row.event_id, "evt-1");
      assert.equal(u.row.user_id, "user-1");
      assert.equal(u.row.is_stale, false);
    }
  });

  it("isolates one preset's exception so the rest still run", async () => {
    // Hard requirement: per-preset try/catch. A throw on `last_30d`
    // must not prevent `last_7d` (or any other preset) from
    // writing its snapshot.
    const { client, rec } = makeFakeSupabase();
    const fetcher: RefreshInput["_fetcher"] = async ({ datePreset }) => {
      if (datePreset === "last_30d") {
        throw new Error("synthetic meta failure");
      }
      return OK_RESULT;
    };
    const out = await refreshActiveCreativesForEvent({
      ...baseInput,
      supabase: client,
      _fetcher: fetcher,
    });
    assert.equal(out.ok, false, "overall ok should be false on partial fail");
    const failed = out.presetResults.find((r) => r.preset === "last_30d");
    assert.ok(failed);
    assert.equal(failed!.ok, false);
    assert.equal(failed!.kind, "error");
    assert.match(failed!.error ?? "", /synthetic meta failure/);
    assert.equal(failed!.wroteSnapshot, false);
    // Every OTHER preset still wrote its snapshot.
    const succeeded = out.presetResults.filter((r) => r.preset !== "last_30d");
    for (const p of succeeded) {
      assert.equal(p.ok, true);
      assert.equal(p.wroteSnapshot, true);
    }
    assert.equal(rec.upserts.length, DEFAULT_REFRESH_PRESETS.length - 1);
  });

  it("does NOT overwrite snapshots when fetcher returns kind='error'", async () => {
    // The "no owner token" branch returns kind=error from the
    // fetcher without throwing. The writer must refuse to clobber
    // the last-good snapshot — same contract as the unit test
    // for `writeActiveCreativesSnapshot`, exercised through the
    // runner.
    const { client, rec } = makeFakeSupabase();
    const out = await refreshActiveCreativesForEvent({
      ...baseInput,
      supabase: client,
      _fetcher: async () => ERROR_RESULT,
    });
    assert.equal(out.ok, false);
    for (const p of out.presetResults) {
      assert.equal(p.ok, false);
      assert.equal(p.kind, "error");
      assert.equal(p.wroteSnapshot, false);
      assert.equal(p.error, ERROR_RESULT.message);
    }
    assert.equal(rec.upserts.length, 0, "must not touch the cache");
  });

  it("does NOT overwrite snapshots when fetcher returns kind='skip'", async () => {
    const { client, rec } = makeFakeSupabase();
    const out = await refreshActiveCreativesForEvent({
      ...baseInput,
      supabase: client,
      _fetcher: async () => SKIP_RESULT,
    });
    assert.equal(out.ok, false);
    for (const p of out.presetResults) {
      assert.equal(p.kind, "skip");
      assert.equal(p.wroteSnapshot, false);
    }
    assert.equal(rec.upserts.length, 0);
  });

  it("uses tight TTL inside 14d of event_date", async () => {
    const { client, rec } = makeFakeSupabase();
    const now = Date.now();
    const eventDate = new Date(now + 5 * 24 * 60 * 60 * 1000);
    await refreshActiveCreativesForEvent({
      ...baseInput,
      supabase: client,
      eventDate,
      presets: ["last_7d"] as DatePreset[],
      _fetcher: async () => OK_RESULT,
    });
    assert.equal(rec.upserts.length, 1);
    const row = rec.upserts[0].row;
    const fetchedAt = new Date(row.fetched_at as string).getTime();
    const expiresAt = new Date(row.expires_at as string).getTime();
    const ttl = expiresAt - fetchedAt;
    // TTL should match the tight cadence (allow a few ms of jitter).
    assert.ok(
      Math.abs(ttl - ACS_TIGHT_TTL_MS) < 1000,
      `expected tight TTL, got ${ttl}ms`,
    );
  });

  it("uses default TTL outside 14d of event_date", async () => {
    const { client, rec } = makeFakeSupabase();
    const now = Date.now();
    const eventDate = new Date(now + 90 * 24 * 60 * 60 * 1000);
    await refreshActiveCreativesForEvent({
      ...baseInput,
      supabase: client,
      eventDate,
      presets: ["last_7d"] as DatePreset[],
      _fetcher: async () => OK_RESULT,
    });
    const row = rec.upserts[0].row;
    const fetchedAt = new Date(row.fetched_at as string).getTime();
    const expiresAt = new Date(row.expires_at as string).getTime();
    const ttl = expiresAt - fetchedAt;
    assert.ok(
      Math.abs(ttl - ACS_DEFAULT_TTL_MS) < 1000,
      `expected default TTL, got ${ttl}ms`,
    );
  });

  it("forwards customRange only when the preset is 'custom'", async () => {
    const { client, rec } = makeFakeSupabase();
    const seenForCustom: Array<{
      preset: DatePreset;
      customRange: unknown;
    }> = [];
    await refreshActiveCreativesForEvent({
      ...baseInput,
      supabase: client,
      presets: ["last_7d", "custom"] as DatePreset[],
      customRange: { since: "2026-04-01", until: "2026-04-15" },
      _fetcher: async (input) => {
        seenForCustom.push({
          preset: input.datePreset!,
          customRange: input.customRange,
        });
        return OK_RESULT;
      },
    });
    const last7 = seenForCustom.find((r) => r.preset === "last_7d");
    const custom = seenForCustom.find((r) => r.preset === "custom");
    assert.equal(last7?.customRange, undefined);
    assert.deepEqual(custom?.customRange, {
      since: "2026-04-01",
      until: "2026-04-15",
    });
    // The custom upsert row should also carry the range.
    const customRow = rec.upserts.find(
      (u) => u.row.date_preset === "custom",
    )?.row;
    assert.equal(customRow?.custom_since, "2026-04-01");
    assert.equal(customRow?.custom_until, "2026-04-15");
  });
});
