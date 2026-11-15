import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeDb, op } from "../../launched-ads/__tests__/fake-db.ts";
import { loadFinalCounts, pickFinal, type CountRow } from "../final-count.ts";

const row = (countDate: string, paid: number, comps: number, writtenAt = `${countDate}T12:00:00Z`): CountRow => ({
  blockId: `b-${countDate}`,
  countDate,
  paid,
  comps,
  total: paid + comps,
  writtenAt,
});

describe("ruling c: a show's final count", () => {
  it("DJ EZ (2 Oct): the 5 Oct count, 305 paid + 218 comps, is the final", () => {
    const rows = [row("2026-09-29", 210, 120), row("2026-10-01", 228, 137), row("2026-10-05", 305, 218)];
    const f = pickFinal(rows, "2026-10-02")!;
    assert.equal(f.countDate, "2026-10-05");
    assert.equal(f.paid, 305);
    assert.equal(f.comps, 218);
  });

  it("the latest post-show count wins; earlier post-show counts stay (Folamour: 26 Oct over 23 Oct)", () => {
    const rows = [row("2026-10-23", 1268, 0), row("2026-10-26", 1292, 0)];
    assert.equal(pickFinal(rows, "2026-10-23")!.countDate, "2026-10-26");
  });

  it("show day itself counts as after (Modern Funktion, 996 on 16 Oct)", () => {
    assert.equal(pickFinal([row("2026-10-12", 900, 0), row("2026-10-16", 996, 0)], "2026-10-16")!.total, 996);
  });

  it("no final before show day, or without a show date", () => {
    assert.equal(pickFinal([row("2026-10-01", 228, 137)], "2026-10-02"), null);
    assert.equal(pickFinal([row("2026-10-05", 305, 218)], null), null);
  });

  it("loadFinalCounts reads only written, final blocks, paged in id order", async () => {
    const { db, calls } = fakeDb(() => ({
      data: [{ id: "b1", event_id: "e1", count_date: "2026-10-05", paid_tickets: 305, comp_tickets: 218, total_tickets: 523 }],
      error: null,
    }));
    const m = await loadFinalCounts(db, ["e1"]);
    assert.deepEqual(m.get("e1"), { eventId: "e1", blockId: "b1", countDate: "2026-10-05", paid: 305, comps: 218, total: 523 });
    const c = calls[0];
    assert.deepEqual(op(c, "eq"), ["is_final", true]);
    assert.ok(op(c, "range"));
    assert.equal((await loadFinalCounts(db, [])).size, 0);
  });
});
