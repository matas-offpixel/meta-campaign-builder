import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { executeFourthefansHistoryBackfill } from "../event-history-backfill-core.ts";
import {
  cumulativeFourthefansSnapshotsFromDeltas,
  mergeFourthefansDailyDeltas,
  parseFourthefansSalesHistoryPayload,
  type FourthefansHistoryDay,
} from "../../ticketing/fourthefans/history.ts";
import type {
  EventTicketingLink,
  TicketingConnection,
} from "../../ticketing/types.ts";

describe("parseFourthefansSalesHistoryPayload", () => {
  it("treats empty sales array as success", () => {
    const out = parseFourthefansSalesHistoryPayload({ sales: [] });
    assert.deepEqual(out, []);
  });
});

describe("mergeFourthefansDailyDeltas + cumulativeFourthefansSnapshotsFromDeltas", () => {
  it("computes cumulative tickets (day1 delta 4 → 4; day2 delta 5 → 9)", () => {
    const deltas: FourthefansHistoryDay[] = [
      { date: "2026-01-01", tickets_sold: 4, revenue: 1 },
      { date: "2026-01-02", tickets_sold: 5, revenue: 2 },
    ];
    const cum = cumulativeFourthefansSnapshotsFromDeltas(deltas);
    assert.equal(cum.length, 2);
    assert.equal(cum[0].tickets_sold, 4);
    assert.equal(cum[0].gross_revenue_cents, 100);
    assert.equal(cum[1].tickets_sold, 9);
    assert.equal(cum[1].gross_revenue_cents, 300);
  });

  it("merges two listings on the same day before cumulative sum", () => {
    const merged = mergeFourthefansDailyDeltas([
      [{ date: "2026-01-01", tickets_sold: 2, revenue: 1 }],
      [{ date: "2026-01-01", tickets_sold: 3, revenue: 4 }],
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].tickets_sold, 5);
    assert.equal(merged[0].revenue, 5);
  });
});

describe("executeFourthefansHistoryBackfill", () => {
  const EVENT_ID = "00000000-0000-4000-8000-000000000001";
  const USER_ID = "00000000-0000-4000-8000-000000000002";
  const LINK_ID = "00000000-0000-4000-8000-000000000003";
  const CONN_ID = "00000000-0000-4000-8000-000000000004";

  function baseLink(): EventTicketingLink {
    const now = new Date().toISOString();
    return {
      id: LINK_ID,
      user_id: USER_ID,
      event_id: EVENT_ID,
      connection_id: CONN_ID,
      external_event_id: "999",
      external_event_url: null,
      created_at: now,
      updated_at: now,
    };
  }

  function baseConnection(): TicketingConnection {
    const now = new Date().toISOString();
    return {
      id: CONN_ID,
      user_id: USER_ID,
      client_id: "00000000-0000-4000-8000-000000000005",
      provider: "fourthefans",
      credentials: { access_token: "test-token" },
      external_account_id: "4thefans",
      status: "active",
      last_synced_at: null,
      last_error: null,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Minimal chain mock matching queries issued by event-history-backfill-core.
   */
  function createMockSupabase() {
    type SnapRow = {
      id: string;
      event_id: string;
      snapshot_at: string;
      source: string;
      tickets_sold: number;
      gross_revenue_cents: number | null;
    };

    const snapshots: SnapRow[] = [];
    let idSeq = 1;

    function chain(table: string) {
      let selectCols = "*";
      const filters: Record<string, unknown> = {};
      let orderAsc = false;
      let limitN: number | null = null;
      let updatePayload: Record<string, unknown> | null = null;

      const api = {
        select(cols: string) {
          selectCols = cols;
          return api;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return api;
        },
        order(_col: string, opts?: { ascending?: boolean }) {
          orderAsc = opts?.ascending !== false;
          return api;
        },
        limit(n: number) {
          limitN = n;
          return api;
        },
        async maybeSingle(): Promise<{ data: unknown; error: unknown }> {
          if (table === "events") {
            return {
              data: {
                id: EVENT_ID,
                user_id: USER_ID,
                presale_at: null,
              },
              error: null,
            };
          }
          if (table === "ticket_sales_snapshots") {
            if (
              selectCols.includes("snapshot_at") &&
              orderAsc &&
              limitN === 1 &&
              filters.event_id === EVENT_ID
            ) {
              const earliest = [...snapshots]
                .filter((s) => s.event_id === EVENT_ID)
                .sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at))[0];
              return {
                data: earliest ? { snapshot_at: earliest.snapshot_at } : null,
                error: null,
              };
            }
            if (
              selectCols === "id" &&
              filters.event_id === EVENT_ID &&
              filters.source === "fourthefans" &&
              typeof filters.snapshot_at === "string"
            ) {
              const hit = snapshots.find(
                (s) =>
                  s.event_id === EVENT_ID &&
                  s.source === "fourthefans" &&
                  s.snapshot_at === filters.snapshot_at,
              );
              return { data: hit ? { id: hit.id } : null, error: null };
            }
          }
          return { data: null, error: null };
        },
        insert(payload: Record<string, unknown>) {
          const id = `snap-${idSeq++}`;
          const row = payload as SnapRow;
          snapshots.push({
            id,
            event_id: row.event_id as string,
            snapshot_at: row.snapshot_at as string,
            source: row.source as string,
            tickets_sold: row.tickets_sold as number,
            gross_revenue_cents: row.gross_revenue_cents as number | null,
          });
          return { error: null };
        },
        update(patch: Record<string, unknown>) {
          updatePayload = patch;
          return {
            eq(col: string, val: unknown) {
              if (col === "id" && typeof val === "string") {
                const idx = snapshots.findIndex((s) => s.id === val);
                if (idx >= 0 && updatePayload) {
                  const u = updatePayload;
                  if (typeof u.tickets_sold === "number") {
                    snapshots[idx].tickets_sold = u.tickets_sold;
                  }
                  if (typeof u.gross_revenue_cents === "number") {
                    snapshots[idx].gross_revenue_cents = u.gross_revenue_cents;
                  }
                }
              }
              return { error: null };
            },
          };
        },
      };
      return api;
    }

    return {
      from: (table: string) => chain(table),
      snapshots,
    };
  }

  const adapters = {
    listLinksForEvent: async (): Promise<EventTicketingLink[]> => [
      baseLink(),
    ],
    getConnectionWithDecryptedCredentials: async (): Promise<TicketingConnection | null> =>
      baseConnection(),
    refreshAggregatedTicketsSoldFromSnapshots: async () => {},
    fetchHistory: async (): Promise<FourthefansHistoryDay[]> => [],
  };

  it("second run with same window inserts 0 and skips all rows (idempotent)", async () => {
    const mock = createMockSupabase();
    const opts = { from: "2026-01-01", to: "2026-01-05" };
    const fetchShort = async () => [
      { date: "2026-01-01", tickets_sold: 4, revenue: 1 },
      { date: "2026-01-02", tickets_sold: 5, revenue: 2 },
    ];

    const r1 = await executeFourthefansHistoryBackfill(
      mock as never,
      EVENT_ID,
      opts,
      {
        ...adapters,
        fetchHistory: fetchShort,
      },
    );
    assert.equal(r1.inserted, 2);
    assert.equal(r1.skipped, 0);
    assert.equal(mock.snapshots.length, 2);

    const r2 = await executeFourthefansHistoryBackfill(
      mock as never,
      EVENT_ID,
      opts,
      {
        ...adapters,
        fetchHistory: fetchShort,
      },
    );
    assert.equal(r2.inserted, 0);
    assert.equal(r2.skipped, 2);
    assert.equal(mock.snapshots.length, 2);
  });

  it("force=true overwrites existing snapshot values", async () => {
    const mock = createMockSupabase();
    const opts = { from: "2026-02-01", to: "2026-02-02" };
    const fetchShort = async () => [
      { date: "2026-02-01", tickets_sold: 10, revenue: 3 },
    ];

    await executeFourthefansHistoryBackfill(mock as never, EVENT_ID, opts, {
      ...adapters,
      fetchHistory: fetchShort,
    });

    assert.equal(mock.snapshots[0].tickets_sold, 10);

    const fetchUpdated = async () => [
      { date: "2026-02-01", tickets_sold: 99, revenue: 50 },
    ];

    const r3 = await executeFourthefansHistoryBackfill(
      mock as never,
      EVENT_ID,
      { ...opts, force: true },
      {
        ...adapters,
        fetchHistory: fetchUpdated,
      },
    );
    assert.equal(r3.inserted, 1);
    assert.equal(mock.snapshots[0].tickets_sold, 99);
    assert.equal(mock.snapshots[0].gross_revenue_cents, 5000);
  });
});
