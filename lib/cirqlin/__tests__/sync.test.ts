import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CIRQLIN_ALERT_DEDUPE_WINDOW_MS,
  CIRQLIN_FAILURE_SENTINEL_DAY,
  syncCirqlinSignupsForEvent,
} from "../sync.ts";

function fakeSupabase(
  existing: Array<Record<string, unknown>> = [],
) {
  const rows = [...existing];
  const upserts: Array<{ row: unknown; conflict?: string }> = [];
  return {
    rows,
    upserts,
    from() {
      return {
        upsert(row: unknown, opts?: { onConflict?: string }) {
          upserts.push({ row, conflict: opts?.onConflict });
          const items = Array.isArray(row) ? row : [row];
          for (const item of items as Array<Record<string, unknown>>) {
            const idx = rows.findIndex(
              (current) =>
                current.event_id === item.event_id &&
                current.source === item.source &&
                current.day === item.day,
            );
            if (idx >= 0) rows[idx] = item;
            else rows.push(item);
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

describe("syncCirqlinSignupsForEvent", () => {
  it("writes a reserved-day unauthorized marker and alerts once, not a London-today row", async () => {
    const sb = fakeSupabase();
    const alerts: Array<{ dedupeKey: string; text: string }> = [];
    const result = await syncCirqlinSignupsForEvent(
      sb as never,
      { eventId: "evt-1", tag: "CQ-dod-newcastle" },
      {
        now: new Date("2026-09-15T23:30:00Z"),
        secret: "wrong",
        fetchImpl: async () =>
          new Response(JSON.stringify({ ok: false }), { status: 401 }),
        notify: async (input) => {
          assert.equal(input.respectBusinessHours, false);
          assert.equal(input.dedupeWindowMs, CIRQLIN_ALERT_DEDUPE_WINDOW_MS);
          alerts.push({ dedupeKey: input.dedupeKey, text: input.text });
        },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unauthorized");
    assert.equal(sb.upserts.length, 1);
    const row = sb.upserts[0]!.row as { day: string; raw_json: { reason: string } };
    assert.equal(row.day, CIRQLIN_FAILURE_SENTINEL_DAY);
    assert.equal(row.raw_json.reason, "unauthorized");
    assert.deepEqual(alerts, [
      {
        dedupeKey: "cirqlin_sync_failed:evt-1:unauthorized",
        text: "Cirqlin signup sync failed for evt-1 (unauthorized)",
      },
    ]);
  });

  it("writes no_page on the reserved day, not London-today", async () => {
    const sb = fakeSupabase();
    const result = await syncCirqlinSignupsForEvent(
      sb as never,
      { eventId: "evt-1", tag: "CQ-dod-newcastle" },
      {
        now: new Date("2026-09-15T23:30:00Z"),
        secret: "s",
        fetchImpl: async () =>
          new Response(JSON.stringify({ ok: false }), { status: 404 }),
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.reason, "no_page");
    const row = sb.upserts[0]!.row as { day: string; raw_json: { reason: string } };
    assert.equal(row.day, CIRQLIN_FAILURE_SENTINEL_DAY);
    assert.equal(row.raw_json.reason, "no_page");
  });

  it("does not overwrite today's live count with a no_page sentinel", async () => {
    const today = "2026-09-15";
    const sb = fakeSupabase([
      {
        event_id: "evt-1",
        source: "cirqlin",
        day: today,
        signups_day: 8,
        signups_total: 1843,
        snapshot_at: "2026-09-15T12:00:00.000Z",
        raw_json: { totals: { counted: 1843 } },
      },
    ]);
    const result = await syncCirqlinSignupsForEvent(
      sb as never,
      { eventId: "evt-1", tag: "CQ-dod-newcastle" },
      {
        now: new Date("2026-09-15T18:00:00Z"),
        secret: "s",
        fetchImpl: async () =>
          new Response(JSON.stringify({ ok: false }), { status: 404 }),
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.reason, "no_page");
    const live = sb.rows.find((row) => row.day === today);
    assert.equal(live?.signups_total, 1843);
    const marker = sb.rows.find((row) => row.day === CIRQLIN_FAILURE_SENTINEL_DAY);
    assert.equal((marker?.raw_json as { reason?: string } | undefined)?.reason, "no_page");
  });

  it("does not write or alert for not_configured", async () => {
    const sb = fakeSupabase();
    const alerts: unknown[] = [];
    const result = await syncCirqlinSignupsForEvent(
      sb as never,
      { eventId: "evt-1", tag: "CQ-dod-newcastle" },
      {
        secret: "",
        fetchImpl: async () => {
          throw new Error("must not fetch");
        },
        notify: async (input) => {
          alerts.push(input);
        },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_configured");
    assert.equal(sb.upserts.length, 0);
    assert.equal(alerts.length, 0);
  });

  it("reports a hung fetch as error and writes the failure marker", async () => {
    const sb = fakeSupabase();
    const result = await syncCirqlinSignupsForEvent(
      sb as never,
      { eventId: "evt-1", tag: "CQ-dod-newcastle" },
      {
        secret: "s",
        timeoutMs: 20,
        fetchImpl: () => new Promise(() => {}),
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "error");
    assert.match(result.error ?? "", /timed out/i);
    const row = sb.upserts[0]!.row as { day: string; raw_json: { reason: string } };
    assert.equal(row.day, CIRQLIN_FAILURE_SENTINEL_DAY);
    assert.equal(row.raw_json.reason, "error");
  });

  it("returns from a hung body instead of walking the cron budget", async () => {
    const sb = fakeSupabase();
    const result = await syncCirqlinSignupsForEvent(
      sb as never,
      { eventId: "evt-1", tag: "CQ-dod-newcastle" },
      {
        secret: "s",
        timeoutMs: 20,
        fetchImpl: async () =>
          ({
            status: 200,
            ok: true,
            json: () => new Promise(() => {}),
          }) as Response,
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "error");
    assert.match(result.error ?? "", /timed out/i);
  });
});
