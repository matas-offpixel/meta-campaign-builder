import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadAudienceRows, loadReplicateEvent, loadReplicateNames, loadReplicateVenue, type ReplicateDb } from "../load.ts";

type Row = Record<string, unknown>;

/** A fake PostgREST: eq / in filters, range paging, and a column that "doesn't exist". */
function fakeDb(tables: Record<string, Row[]>, missing: Record<string, string[]> = {}) {
  const calls: Array<{ table: string; cols: string; range?: [number, number] }> = [];
  const db: ReplicateDb = {
    from(table) {
      return {
        select(cols) {
          const filters: Array<(r: Row) => boolean> = [];
          const call: { table: string; cols: string; range?: [number, number] } = { table, cols };
          calls.push(call);
          const err = (missing[table] ?? []).find((c) => cols.includes(c));
          const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          const q = {
            eq(col: string, v: unknown) {
              filters.push((r) => r[col] === v);
              return q;
            },
            in(col: string, vs: unknown[]) {
              filters.push((r) => vs.includes(r[col]));
              return q;
            },
            order() {
              return q;
            },
            async range(a: number, b: number) {
              call.range = [a, b];
              if (err) return { data: null, error: { code: "42703", message: `column ${table}.${err} does not exist` } };
              return { data: rows().slice(a, b + 1), error: null };
            },
            async maybeSingle() {
              if (err) return { data: null, error: { code: "42703", message: `column ${table}.${err} does not exist` } };
              return { data: rows()[0] ?? null, error: null };
            },
          };
          return q;
        },
      };
    },
  };
  return { db, calls };
}

const EVENT = { id: "e1", event_code: "NX27-GLITTERBOX", client_id: "c1", venue_id: null, venue_name: "NX NEWCASTLE", signup_url: "https://crqln.com/l/glitterbox-newcastle", meta_ad_account_id: "606252931141334", meta_pixel_id: null };

describe("replicate loads", () => {
  it("reads events.meta_pixel_id, and falls back when migration 266 isn't applied", async () => {
    const withPixel = fakeDb({ events: [{ ...EVENT, meta_pixel_id: "1987031252241238" }] });
    assert.equal((await loadReplicateEvent(withPixel.db, "e1"))?.meta_pixel_id, "1987031252241238");
    const before266 = fakeDb({ events: [EVENT] }, { events: ["meta_pixel_id"] });
    const event = await loadReplicateEvent(before266.db, "e1");
    assert.equal(event?.event_code, "NX27-GLITTERBOX");
    assert.equal(event?.meta_pixel_id, null);
  });

  it("finds the venue by venue_id, else the client's venue with the same venue key", async () => {
    const venues = [
      { id: "v1", client_id: "c1", name: "NX Newcastle", meta_ad_account_id: "act_606252931141334", meta_pixel_id: "645185673672763" },
      { id: "v2", client_id: "c1", name: "Electric Bristol", meta_ad_account_id: "act_2011069725849568", meta_pixel_id: "800268622344093" },
    ];
    const { db } = fakeDb({ venues });
    const byKey = await loadReplicateVenue(db, { ...EVENT, venue_id: null });
    assert.equal(byKey?.id, "v1");
    const byId = await loadReplicateVenue(db, { ...EVENT, venue_id: "v2" });
    assert.equal(byId?.meta_pixel_id, "800268622344093");
    const before266 = fakeDb({ venues }, { venues: ["*"] });
    assert.equal(await loadReplicateVenue(before266.db, { ...EVENT, venue_id: null }), null);
  });

  it("pages the target account's audiences past 1,000 rows and reads both id spellings", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ meta_audience_id: `a${i}`, meta_ad_account_id: i % 2 ? "act_606252931141334" : "606252931141334", funnel_stage: "top_of_funnel", audience_subtype: "page_engagement_fb", retention_days: 365, source_id: "1" }));
    const { db, calls } = fakeDb({ meta_custom_audiences: rows });
    const out = await loadAudienceRows(db, [], "606252931141334");
    assert.equal(out.length, 1500);
    assert.deepEqual(calls.map((c) => c.range), [[0, 999], [1000, 1999]]);
  });

  it("names accounts and pages from the BM tables, normalising act_", async () => {
    const { db } = fakeDb({
      bm_ad_accounts: [{ ad_account_id: "act_606252931141334", name: "NX Promoter" }],
      bm_pages: [{ page_id: "123", page_name: "Glitterbox Official" }],
    });
    const names = await loadReplicateNames(db, ["606252931141334", null], ["123", ""]);
    assert.deepEqual(names, { accountNames: { act_606252931141334: "NX Promoter" }, pageNames: { "123": "Glitterbox Official" } });
  });
});
