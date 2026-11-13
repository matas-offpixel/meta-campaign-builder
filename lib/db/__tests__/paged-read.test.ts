import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeDb, op } from "../../launched-ads/__tests__/fake-db.ts";
import { loadGoogleAdsAccounts } from "../../google-ads/campaign-insights/runner.ts";
import { allRows, rowsWhere } from "../../drive/db.ts";
import { dedupeOn, loadAllPaged, pageAll, PAGE_SIZE } from "../paged-read.ts";

/** Pages that overlap the way an unordered `.range` read can: the last ten rows of page 1 come back on page 2, and five fresh rows. */
function overlapping(prefix: string, extra: (i: number) => Record<string, unknown> = () => ({})) {
  const first = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `${prefix}-${String(i).padStart(4, "0")}`, ...extra(i) }));
  const second = [...first.slice(PAGE_SIZE - 10), ...Array.from({ length: 5 }, (_, i) => ({ id: `${prefix}-${PAGE_SIZE + i}`, ...extra(PAGE_SIZE + i) }))];
  return [first, second];
}

describe("lib/db/paged-read: every paged read is ordered by a unique key and deduped", () => {
  it("dedupeOn keeps the first sighting of a key, every part of a composite key counts, and a row without the key is kept", () => {
    const rows = [
      { event_id: "e", date: "2026-11-01", spend: 1 },
      { event_id: "e", date: "2026-11-01", spend: 1 },
      { event_id: "e", date: "2026-11-02", spend: 1 },
      { event_id: "f", date: "2026-11-01", spend: 1 },
      { spend: 9 },
    ];
    assert.deepEqual(dedupeOn(rows, ["event_id", "date"]).map((r) => `${(r as { event_id?: string }).event_id ?? "?"}/${(r as { date?: string }).date ?? "?"}`), ["e/2026-11-01", "e/2026-11-02", "f/2026-11-01", "?/?"]);
  });

  it("loadAllPaged: business order first, then the key as tie-breaker; overlapping pages are read once; stops on a short page", async () => {
    const pages = overlapping("t", (i) => ({ snapshot_at: `2026-11-${String(1 + (i % 9)).padStart(2, "0")}` }));
    let page = 0;
    const { db, calls } = fakeDb(() => ({ data: pages[page++] ?? [], error: null }));
    const rows = await loadAllPaged<{ id: string }>(db, "ticket_sales_snapshots", "id, snapshot_at", ["id"], (q) => q.gte("snapshot_at", "2026-10-01"), {
      orderBy: [{ column: "snapshot_at", ascending: true }],
    });
    assert.equal(rows.length, PAGE_SIZE + 5);
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
    assert.equal(calls.length, 2);
    for (const [index, call] of calls.entries()) {
      assert.deepEqual(call.ops.map(([name]) => name), ["select", "gte", "order", "order", "range"]);
      assert.deepEqual(call.ops.filter(([name]) => name === "order").map(([, args]) => args), [["snapshot_at", { ascending: true, nullsFirst: undefined }], ["id", { ascending: true }]]);
      assert.deepEqual(op(call, "range"), [index * PAGE_SIZE, index * PAGE_SIZE + PAGE_SIZE - 1]);
    }
  });

  it("loadAllPaged refuses an unselected key, an empty key, and surfaces a page error with the table name", async () => {
    const { db } = fakeDb(() => ({ data: null, error: { message: "statement timeout" } }));
    await assert.rejects(() => loadAllPaged(db, "events", "name", ["id"]), /order key "id" is not in the selected columns/);
    await assert.rejects(() => loadAllPaged(db, "events", "id", []), /needs a unique key/);
    await assert.rejects(() => loadAllPaged(db, "events", "id", ["id"]), /events: statement timeout/);
  });

  it("pageAll dedupes a builder's pages on a composite key and keeps the page size the caller asked for", async () => {
    const pages = [
      Array.from({ length: 500 }, (_, i) => ({ event_id: `e${i % 5}`, date: `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + Math.floor(i / 60)).padStart(2, "0")}`, n: 1 })),
      [{ event_id: "e0", date: "2026-01-01", n: 1 }, { event_id: "e9", date: "2026-01-01", n: 1 }],
    ];
    let page = 0;
    const seen: [number, number][] = [];
    const rows = await pageAll<{ n: number }>((from, to) => (seen.push([from, to]), Promise.resolve({ data: pages[page++] ?? [], error: null })), ["event_id", "date"], "rollups", 500);
    assert.deepEqual(seen, [[0, 499], [500, 999]]);
    assert.equal(rows.reduce((s, r) => s + r.n, 0), 500 + 1, "e0/2026-01-01 came back on page 2 and is not counted twice; e9 is new");
  });

  it("loadGoogleAdsAccounts reads clients and events in id order and sees each once across overlapping pages", async () => {
    const perTable = new Map<string, number>();
    const { db, calls } = fakeDb((call) => {
      const page = perTable.get(call.table) ?? 0;
      perTable.set(call.table, page + 1);
      if (call.table === "clients") return { data: overlapping("c", (i) => ({ status: "active", google_ads_account_id: `acct-${i}` }))[page] ?? [], error: null };
      if (call.table === "events") return { data: [{ id: "ev", client_id: "c-0000", google_ads_account_id: null }], error: null };
      if (call.table === "google_ads_accounts") return { data: [], error: null };
      return { data: [], error: null };
    });
    const loaded = await loadGoogleAdsAccounts(db);
    assert.equal(loaded.eventAccount.get("ev"), "acct-0");
    const clientReads = calls.filter((call) => call.table === "clients");
    assert.equal(clientReads.length, 2);
    for (const call of clientReads) assert.deepEqual(op(call, "order"), ["id", { ascending: true }]);
    const accountRead = calls.find((call) => call.table === "google_ads_accounts")!;
    assert.equal((op(accountRead, "in")![1] as string[]).length, PAGE_SIZE + 5, "every client's account once: 1,000 + 5, not 1,015");
  });

  it("drive/db rowsWhere and allRows page in id order and dedupe", async () => {
    let page = 0;
    const { db, calls } = fakeDb(() => ({ data: overlapping("f")[page++] ?? [], error: null }));
    const rows = await rowsWhere(db as never, "drive_folders", "event_id", "e");
    assert.equal(rows.length, PAGE_SIZE + 5);
    assert.deepEqual(calls[0]!.ops.map(([name]) => name), ["select", "eq", "order", "range"]);
    page = 0;
    const all = await allRows(db as never, "drive_folders");
    assert.equal(all.length, PAGE_SIZE + 5);
  });
});
