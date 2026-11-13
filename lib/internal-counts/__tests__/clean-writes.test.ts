import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeDb, op, type FakeCall } from "../../launched-ads/__tests__/fake-db.ts";
import { cleanText, cleanValue, cleanWrites } from "../clean-writes.ts";
import { mentionKey } from "../mentions.ts";

const NUL = "\u0000";
const LONE_HIGH = "\uD83D";
const LONE_LOW = "\uDE00";
const BAD = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("clean writes: no U+0000 or lone surrogate reaches Postgres", () => {
  it("strips NUL and lone surrogates, keeps real emoji pairs and everything else", () => {
    assert.equal(cleanText(`Grand total${NUL} 738.`), "Grand total 738.");
    assert.equal(cleanText(`a${LONE_HIGH}b${LONE_LOW}c`), "abc");
    assert.equal(cleanText("sold out 🎉 £39.50"), "sold out 🎉 £39.50");
  });

  it("cleans nested jsonb, arrays and keys; leaves numbers, nulls and dates alone", () => {
    const d = new Date("2026-10-02T14:08:00Z");
    const v = cleanValue({ detail: { sentence: `x${NUL}y`, key: `2026-09-30${NUL}z`, list: [`a${LONE_LOW}`, 3, null] }, [`k${NUL}`]: 1, at: d });
    assert.deepEqual(v, { detail: { sentence: "xy", key: "2026-09-30z", list: ["a", 3, null] }, k: 1, at: d });
  });

  it("wraps insert, upsert, update and rpc; reads and filters pass through untouched", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    const rpcs: unknown[] = [];
    const sb = cleanWrites(Object.assign(db as object, { rpc: async (_n: string, a: unknown) => (rpcs.push(a), { error: null }) }) as never) as {
      from(t: string): { insert(v: unknown): unknown; upsert(v: unknown, o?: unknown): unknown; update(v: unknown): { eq(c: string, v: unknown): unknown }; select(c: string): { eq(c: string, v: unknown): unknown } };
      rpc(n: string, a: unknown): Promise<unknown>;
    };
    await sb.from("internal_count_reports").insert({ body_text: `Hi${NUL}`, subject: `Fw: Internal Counts 30.09.26${LONE_HIGH}`, sender: `Jo${NUL} Hartley`, pdf_filename: `a${NUL}.pdf` });
    await sb.from("internal_count_review_items").upsert([{ detail: { key: `d${NUL}s` } }], { onConflict: "id" });
    await sb.from("internal_count_review_items").update({ resolution_detail: { note: `n${NUL}` } }).eq("id", `i${NUL}`);
    await sb.from("internal_count_blocks").select("id").eq("show_name", `IPC${NUL}`);
    await sb.rpc("write_internal_count_block", { p_snapshot: { raw_payload: { show_name: `IPC${NUL}` } }, p_cells: [{ tier_name: `1${NUL}` }] });
    const written = calls.flatMap((c: FakeCall) => ["insert", "upsert", "update"].map((k) => op(c, k)?.[0]).filter(Boolean));
    assert.equal(written.length, 3);
    assert.ok(!BAD.test(JSON.stringify(written)));
    assert.ok(!BAD.test(JSON.stringify(rpcs)));
    // A filter value is a read: left as given.
    assert.equal(op(calls[3], "eq")?.[1], `IPC${NUL}`);
    assert.deepEqual(op(calls[1], "upsert")?.[1], { onConflict: "id" });
    assert.equal(cleanWrites(sb as never), sb, "wrapping twice wraps once");
  });

  it("a sale sentence's key carries no NUL (the 30.09.26 crash)", () => {
    assert.ok(!BAD.test(mentionKey("Folamor nearly sold out on 3rd release for RA.", "2026-09-30")));
    assert.equal(mentionKey("Grand total 738.", "2026-10-30"), "2026-10-30|grand total 738.");
  });
});
