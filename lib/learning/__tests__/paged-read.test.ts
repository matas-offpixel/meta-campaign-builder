import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeDb, op } from "../../launched-ads/__tests__/fake-db.ts";
import { loadAdContextIndex } from "../ad-facts.ts";
import { loadAllPaged, PAGE_SIZE } from "../paged-read.ts";

/** Pages that overlap the way an unordered `.range` read can: the last ten rows of page 1 come back again on page 2, and five fresh rows. */
function overlappingPages(table: string) {
  const first = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `${table}-${String(i).padStart(4, "0")}`, meta_ad_id: `ad-${i}`, client_id: "c", event_id: "e" }));
  const second = [...first.slice(PAGE_SIZE - 10), ...Array.from({ length: 5 }, (_, i) => ({ id: `${table}-${PAGE_SIZE + i}`, meta_ad_id: `ad-${PAGE_SIZE + i}`, client_id: "c", event_id: "e" }))];
  return [first, second];
}

describe("learning: paged reads are ordered by a unique key and deduped", () => {
  it("orders every page by the key, drops the rows a second page repeats, and stops on a short page", async () => {
    const pages = overlappingPages("t");
    let page = 0;
    const { db, calls } = fakeDb(() => ({ data: pages[page++] ?? [], error: null }));
    const rows = await loadAllPaged<{ id: string }>(db, "launched_ads", "id, meta_ad_id, client_id, event_id", ["id"]);
    assert.equal(rows.length, PAGE_SIZE + 5, "1,000 + 5 fresh rows; the 10 repeats are dropped");
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
    assert.equal(calls.length, 2);
    for (const [index, call] of calls.entries()) {
      assert.deepEqual(op(call, "order"), ["id", { ascending: true }]);
      assert.deepEqual(op(call, "range"), [index * PAGE_SIZE, index * PAGE_SIZE + PAGE_SIZE - 1]);
    }
  });

  it("a composite key dedupes on every part; a filter is applied before the order", async () => {
    const pages = [
      Array.from({ length: PAGE_SIZE }, (_, i) => ({ date: "2026-11-01", meta_ad_id: `a${i}`, spend: 1 })),
      [{ date: "2026-11-01", meta_ad_id: "a999", spend: 1 }, { date: "2026-11-02", meta_ad_id: "a999", spend: 1 }],
    ];
    let page = 0;
    const { db, calls } = fakeDb(() => ({ data: pages[page++] ?? [], error: null }));
    const rows = await loadAllPaged<{ spend: number }>(db, "ad_daily_insights", "date, meta_ad_id, spend", ["date", "meta_ad_id"], (q) => q.not("spend", "is", null));
    assert.equal(rows.reduce((sum, row) => sum + row.spend, 0), PAGE_SIZE + 1, "the same ad on a second day is a new row; the same (date, ad) is not");
    const names = calls[0]!.ops.map(([name]) => name);
    assert.deepEqual(names, ["select", "not", "order", "order", "range"]);
    assert.deepEqual(calls[0]!.ops.filter(([name]) => name === "order").map(([, args]) => args[0]), ["date", "meta_ad_id"]);
  });

  it("refuses a key that is not selected, and a read with no key", async () => {
    const { db } = fakeDb(() => ({ data: [], error: null }));
    await assert.rejects(() => loadAllPaged(db, "events", "name, event_code", ["id"]), /order key "id" is not in the selected columns/);
    await assert.rejects(() => loadAllPaged(db, "events", "id", []), /needs a unique key/);
  });

  it("surfaces a page error with the table name", async () => {
    const { db } = fakeDb(() => ({ data: null, error: { message: "statement timeout" } }));
    await assert.rejects(() => loadAllPaged(db, "launched_ads", "id", ["id"]), /launched_ads: statement timeout/);
  });

  it("loadAdContextIndex reads every ledger table in id order and keeps one entry per ad across overlapping pages", async () => {
    const perTable = new Map<string, number>();
    const { db, calls } = fakeDb((call) => {
      if (call.table === "launched_ads") {
        const page = perTable.get(call.table) ?? 0;
        perTable.set(call.table, page + 1);
        return { data: overlappingPages("la")[page] ?? [], error: null };
      }
      if (call.table === "launched_ad_sets") return { data: [{ id: "s1", meta_adset_id: "adset-1", client_id: "c", event_id: "e" }], error: null };
      if (call.table === "events") return { data: [{ id: "e", client_id: "c", event_code: "P26-BDAY", meta_ad_account_id: null }], error: null };
      if (call.table === "clients") return { data: [{ id: "c", meta_ad_account_id: "act_111111" }], error: null };
      return { data: [], error: null };
    });
    const index = await loadAdContextIndex(db);
    assert.equal(index.launchedAds.size, PAGE_SIZE + 5);
    assert.equal(index.launchedAdSets.size, 1);
    assert.deepEqual(index.codedEvents, [{ eventId: "e", clientId: "c", eventCode: "P26-BDAY", adAccountId: "act_111111" }]);
    for (const call of calls) assert.deepEqual(op(call, "order"), ["id", { ascending: true }], `${call.table} is read in id order`);
    assert.ok(calls.every((call) => String(op(call, "select")![0]).split(",")[0]!.trim() === "id"), "every ledger read selects id for the dedupe guard");
  });
});
