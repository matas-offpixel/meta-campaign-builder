import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb, op, type FakeCall } from "../../launched-ads/__tests__/fake-db.ts";
import { PROPOSED_COUNT_ALIASES } from "../aliases.ts";
import { cellRows, processReport, type DryRunMemory, type IncomingReport } from "../store.ts";

const pdf12 = new Uint8Array(readFileSync(new URL("./fixtures/internal-counts-2026-11-12.pdf", import.meta.url)));
const pdf11 = new Uint8Array(readFileSync(new URL("./fixtures/internal-counts-2026-11-11.pdf", import.meta.url)));

const EVENTS = Object.values(PROPOSED_COUNT_ALIASES).map((code) => ({
  id: `id-${code}`,
  event_code: code,
  user_id: "u1",
  client_id: "c1",
}));

/** A tiny stateful database: reports by message id, everything else recorded. */
function fakeStore() {
  const reports = new Set<string>();
  const rpcs: Array<[string, Record<string, unknown>]> = [];
  const uploads: string[] = [];
  const { db, calls } = fakeDb((call: FakeCall) => {
    const insert = op(call, "insert")?.[0] as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
    const upsert = op(call, "upsert")?.[0] as Array<Record<string, unknown>> | undefined;
    if (call.table === "internal_count_reports" && op(call, "maybeSingle")) {
      const id = op(call, "eq")?.[1] as string;
      return { data: reports.has(id) ? { id: "r" } : null, error: null };
    }
    if (call.table === "internal_count_reports" && insert && !Array.isArray(insert)) {
      reports.add(insert.gmail_message_id as string);
      return { data: { id: `report-${reports.size}` }, error: null };
    }
    if (call.table === "events") return { data: EVENTS, error: null };
    if (call.table === "internal_count_blocks" && upsert) {
      return { data: upsert.map((b) => ({ id: `block-${b.block_index}`, block_index: b.block_index })), error: null };
    }
    return { data: [], error: null };
  });
  const sb = Object.assign(db as object, {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push([name, args]);
      return { error: null };
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploads.push(path);
          return { error: null };
        },
      }),
    },
  });
  return { sb: sb as never, calls, rpcs, uploads };
}

const message: IncomingReport = {
  userId: "u1",
  source: "gmail",
  messageId: "1a1ca72a26a7b4f0",
  receivedAt: "2026-11-12T11:51:09Z",
  sender: "Rachel@electric-group.co.uk",
  subject: "Internal Show counts 12.11.26",
  body: "Hi, Please see today's internal show counts attached.",
  pdf: { filename: "internal-counts.pdf", bytes: pdf12 },
};

describe("processReport", () => {
  it("writes each block once, then re-reading the message writes 0 rows", async () => {
    const store = fakeStore();
    const first = await processReport(store.sb, message, { confirmedAliases: PROPOSED_COUNT_ALIASES });
    assert.equal(first.status, "processed");
    assert.equal(first.blocksWritten, 9);
    assert.equal(store.rpcs.length, 9);
    assert.equal(store.uploads.length, 1);
    const ipc = store.rpcs.find(([, a]) => a.p_event_id === "id-NX26-IPC")![1];
    assert.equal(ipc.p_count_date, "2026-11-12");
    assert.equal((ipc.p_snapshot as { tickets_sold: number }).tickets_sold, 1828);
    assert.equal((ipc.p_snapshot as { gross_revenue_cents: number | null }).gross_revenue_cents, null);

    const writesBefore = store.calls.filter((c) => op(c, "insert") || op(c, "upsert")).length;
    const second = await processReport(store.sb, message, { confirmedAliases: PROPOSED_COUNT_ALIASES });
    assert.equal(second.status, "already_read");
    assert.equal(second.blocksWritten, 0);
    assert.equal(store.rpcs.length, 9);
    assert.equal(store.uploads.length, 1);
    assert.equal(store.calls.filter((c) => op(c, "insert") || op(c, "upsert")).length, writesBefore);
  });

  it("dry run writes nothing and carries counts forward for the SINCE LAST check", async () => {
    const store = fakeStore();
    const memory: DryRunMemory = { counts: [] };
    const opts = { dryRun: true, confirmedAliases: PROPOSED_COUNT_ALIASES, memory };
    await processReport(store.sb, { ...message, messageId: "m11", subject: "Internal Show counts 11.11.26", pdf: { filename: "a.pdf", bytes: pdf11 } }, opts);
    const r12 = await processReport(store.sb, message, opts);
    assert.equal(store.rpcs.length, 0);
    assert.equal(store.uploads.length, 0);
    assert.equal(store.calls.filter((c) => op(c, "insert") || op(c, "upsert")).length, 0);
    assert.equal(memory.counts.length, 18);
    assert.deepEqual(r12.plan!.reviewItems.map((i) => i.kind), ["price_looks_wrong"]);
    assert.ok(r12.plan!.blocks.every((b) => b.ourDelta === b.sinceLast));
  });

  it("sends only paid, non-blank cells to tier_channel_sales", async () => {
    const store = fakeStore();
    const r = await processReport(store.sb, message, { dryRun: true, confirmedAliases: PROPOSED_COUNT_ALIASES });
    const lock = r.plan!.blocks.find((b) => b.showName === "LOCKLEAD")!;
    const rows = cellRows(lock);
    assert.equal(rows.reduce((a, c) => a + (c.tickets ?? 0), 0), 372);
    assert.ok(rows.every((c) => c.tickets !== null));
    assert.ok(rows.some((c) => c.outlet === "SKIDDLE" && c.tier_name === "7:Group" && c.tickets === 32));
  });
});
