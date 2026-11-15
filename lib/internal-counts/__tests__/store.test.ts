import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb, op, type FakeCall } from "../../launched-ads/__tests__/fake-db.ts";
import { PROPOSED_COUNT_ALIASES } from "../aliases.ts";
import { offlineContext, type RunContext } from "../context.ts";
import { readPdf } from "../pdf-read.ts";
import { resolveItem } from "../resolve.ts";
import { cellRows, processMessage, type IncomingMessage } from "../store.ts";

const pdf12 = await readPdf(
  "JO'S INTERNAL SHOWS - INTERNAL COUNTS (23).pdf",
  new Uint8Array(readFileSync(new URL("./fixtures/internal-counts-2026-11-12.pdf", import.meta.url))),
);
const pdf11 = await readPdf("a.pdf", new Uint8Array(readFileSync(new URL("./fixtures/internal-counts-2026-11-11.pdf", import.meta.url))));

/** A run context over real-looking events, as loadRunContext would build it. */
function runContext(): RunContext {
  const ctx = offlineContext(PROPOSED_COUNT_ALIASES);
  ctx.offline = false;
  for (const e of ctx.events) {
    e.id = `id-${e.eventCode}`;
    e.userId = "u1";
    e.clientId = "c1";
  }
  ctx.eventsByCode = new Map(ctx.events.map((e) => [e.eventCode, e]));
  ctx.eventsById = new Map(ctx.events.map((e) => [e.id, e]));
  return ctx;
}

/** A tiny stateful database: reports by message id, everything else recorded. */
function fakeStore(seed: { item?: Record<string, unknown> } = {}) {
  const reports = new Set<string>();
  const rpcs: Array<[string, Record<string, unknown>]> = [];
  const uploads: string[] = [];
  const { db, calls } = fakeDb((call: FakeCall) => {
    const insert = op(call, "insert")?.[0] as Record<string, unknown> | undefined;
    const upsert = op(call, "upsert")?.[0] as Array<Record<string, unknown>> | undefined;
    if (call.table === "internal_count_reports" && op(call, "maybeSingle")) {
      return { data: reports.has(op(call, "eq")?.[1] as string) ? { id: "r" } : null, error: null };
    }
    if (call.table === "internal_count_reports" && insert && !Array.isArray(insert)) {
      reports.add(insert.gmail_message_id as string);
      return { data: { id: `report-${reports.size}` }, error: null };
    }
    if (call.table === "internal_count_blocks" && upsert) {
      return { data: upsert.map((b) => ({ id: `block-${b.block_index}`, block_index: b.block_index })), error: null };
    }
    if (call.table === "internal_count_review_items" && op(call, "single")) return { data: seed.item ?? null, error: null };
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

const message: IncomingMessage = {
  userId: "u1",
  source: "gmail",
  kind: "count",
  messageId: "1a1cf88f5009e5ff",
  threadId: "1a1cf88f5009e5ff",
  receivedAt: "2026-11-12T11:33:36Z",
  sentAt: "2026-11-12T11:33:30Z",
  sender: "Alex Mercer <alex.mercer@electric-group.co.uk>",
  subject: "Internal Show Count 12.11.26",
  body: "Hello, Please see today's internal show count attached.",
  forward: false,
  pdf: pdf12,
};

const writes = (calls: FakeCall[]) => calls.filter((c) => op(c, "insert") || op(c, "upsert") || op(c, "update") || op(c, "delete"));

describe("processMessage", () => {
  it("writes each show once; re-reading the message writes 0 rows", async () => {
    const store = fakeStore();
    const ctx = runContext();
    const first = await processMessage(store.sb, ctx, message);
    assert.equal(first.status, "processed");
    assert.equal(first.blocksWritten, 9);
    assert.equal(store.rpcs.length, 9);
    assert.equal(store.uploads.length, 1);
    const ipc = store.rpcs.find(([, a]) => a.p_event_id === "id-NX26-IPC")![1];
    assert.equal(ipc.p_count_date, "2026-11-12");
    assert.equal((ipc.p_snapshot as { tickets_sold: number }).tickets_sold, 1828);
    assert.equal((ipc.p_snapshot as { gross_revenue_cents: number | null }).gross_revenue_cents, null);

    const before = writes(store.calls).length;
    const second = await processMessage(store.sb, ctx, message);
    assert.equal(second.status, "already_read");
    assert.equal(store.rpcs.length, 9);
    assert.equal(store.uploads.length, 1);
    assert.equal(writes(store.calls).length, before);
  });

  it("dry run writes nothing and carries counts forward: ours minus 11 Nov equals SINCE LAST COUNT", async () => {
    const store = fakeStore();
    const ctx = runContext();
    await processMessage(store.sb, ctx, { ...message, messageId: "m11", subject: "Internal Show counts 11.11.26", sentAt: "2026-11-11T11:51:00Z", pdf: pdf11 }, { dryRun: true });
    const r12 = await processMessage(store.sb, ctx, message, { dryRun: true });
    assert.equal(store.rpcs.length, 0);
    assert.equal(store.uploads.length, 0);
    assert.equal(writes(store.calls).length, 0);
    assert.deepEqual(r12.reviewItems.map((i) => i.kind), ["price_looks_wrong"]);
    assert.ok(r12.plan!.blocks.every((b) => b.ourDelta === b.sinceLast));
  });

  it("the same PDF in a second email (a forward) is one count", async () => {
    const store = fakeStore();
    const ctx = runContext();
    await processMessage(store.sb, ctx, message, { dryRun: true });
    const fwd = await processMessage(
      store.sb,
      ctx,
      { ...message, messageId: "fw", subject: "Fw: Internal Show Count 12.11.26", forward: true, sentAt: "2026-11-12T13:00:00Z" },
      { dryRun: true },
    );
    assert.equal(fwd.status, "duplicate");
    assert.equal(fwd.blocksWritten, 0);
    assert.deepEqual(fwd.reviewItems, []);
  });

  it("a forward with a different sheet for a stored date keeps the stored one and asks", async () => {
    const store = fakeStore();
    const ctx = runContext();
    await processMessage(store.sb, ctx, { ...message, messageId: "m11", subject: "Internal Show counts 11.11.26", pdf: pdf11, sentAt: "2026-11-11T11:51:00Z" }, { dryRun: true });
    assert.equal(ctx.counts.length, 9);
    // A forward whose (different) PDF carries a count date already stored: pretend the 11 Nov sheet came first under the 12 Nov date.
    ctx.counts = ctx.counts.map((c) => ({ ...c, countDate: "2026-11-12", total: c.total - 1 }));
    const fwd = await processMessage(store.sb, ctx, { ...message, messageId: "fw2", forward: true, subject: "Fw: Internal Show Count 12.11.26" }, { dryRun: true });
    assert.equal(fwd.blocksWritten, 0);
    assert.ok(fwd.plan!.blocks.every((b) => b.status === "held"));
    assert.ok(fwd.reviewItems.some((i) => i.kind === "replaced" && i.detail.forward === true));
  });

  it("a reply in a count's thread is a note; its text runs the sales check", async () => {
    const store = fakeStore();
    const ctx = runContext();
    ctx.countThreads.set("t6", "report-6nov");
    const r = await processMessage(
      store.sb,
      ctx,
      { ...message, kind: "reply", messageId: "r1", threadId: "t6", subject: "Re: Internal Show counts 06.11.26", body: "We sold another 40 tickets on Skiddle tonight.", pdf: null },
      { dryRun: true },
    );
    assert.equal(r.status, "note");
    assert.deepEqual(r.reviewItems.map((i) => i.kind), ["sale_mention"]);
    assert.equal(r.blocksWritten, 0);
  });

  it("a near miss is stored with one item and nothing read from it", async () => {
    const store = fakeStore();
    const r = await processMessage(store.sb, runContext(), { ...message, kind: "near_miss", messageId: "nm", subject: "Re: Internal Counts 16.10.26" });
    assert.equal(r.status, "not_read");
    assert.deepEqual(r.reviewItems.map((i) => i.kind), ["near_miss"]);
    assert.equal(store.rpcs.length, 0);
  });

  it("an email body, subject and sender with U+0000 and a lone surrogate are written clean, sale items included", async () => {
    const store = fakeStore();
    await processMessage(store.sb, runContext(), {
      ...message,
      messageId: "nul-1",
      subject: "Internal Show Count 12.11.26\uD83D",
      sender: "Alex\u0000 Mercer <alex.mercer@electric-group.co.uk>",
      body: "Hello.\u0000\n\nWe have sold an additional 57 tickets on IPC tonight.\u0000",
    });
    const payloads = store.calls.flatMap((c) => ["insert", "upsert", "update"].map((k) => op(c, k)?.[0]).filter(Boolean));
    const bad = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    assert.ok(payloads.length > 0);
    assert.ok(!bad.test(JSON.stringify(payloads)));
    assert.ok(!bad.test(JSON.stringify(store.rpcs)));
    const report = payloads.find((p) => (p as Record<string, unknown>).body_text !== undefined) as Record<string, string>;
    assert.equal(report.subject, "Internal Show Count 12.11.26");
    assert.equal(report.sender, "Alex Mercer <alex.mercer@electric-group.co.uk>");
    const items = store.calls.filter((c) => c.table === "internal_count_review_items").flatMap((c) => (op(c, "insert")?.[0] as unknown[]) ?? []);
    assert.ok(items.some((i) => (i as { kind: string }).kind === "sale_mention"));
  });

  it("a reply whose items fail to write is unread again: its report row is deleted, so the next run retries it", async () => {
    const { db, calls } = fakeDb((call: FakeCall) => {
      const insert = op(call, "insert")?.[0] as Record<string, unknown> | Array<unknown> | undefined;
      if (call.table === "internal_count_reports" && op(call, "maybeSingle")) return { data: null, error: null };
      if (call.table === "internal_count_reports" && insert && !Array.isArray(insert)) return { data: { id: "report-r" }, error: null };
      if (call.table === "internal_count_review_items" && insert) return { data: null, error: { message: "unsupported Unicode escape sequence" } };
      return { data: [], error: null };
    });
    const ctx = runContext();
    ctx.countThreads.set("t6", "report-6nov");
    await assert.rejects(
      processMessage(db as never, ctx, { ...message, kind: "reply", messageId: "r2", threadId: "t6", subject: "Re: Internal Show counts 06.11.26", body: "We sold another 40 tickets on Skiddle tonight.", pdf: null }),
      /unsupported Unicode/,
    );
    const del = calls.find((c) => c.table === "internal_count_reports" && op(c, "delete"));
    assert.ok(del);
    assert.deepEqual(op(del!, "eq"), ["id", "report-r"]);
    assert.equal(ctx.countThreads.get("t6"), "report-6nov");
  });

  it("sends only paid, non-blank cells to tier_channel_sales", async () => {
    const r = await processMessage(fakeStore().sb, runContext(), message, { dryRun: true });
    const lock = r.plan!.blocks.find((b) => b.showName === "LOCKLEAD")!;
    const rows = cellRows(lock);
    assert.equal(rows.reduce((a, c) => a + (c.tickets ?? 0), 0), 372);
    assert.ok(rows.every((c) => c.tickets !== null));
    assert.ok(rows.some((c) => c.outlet === "SKIDDLE" && c.tier_name === "7:Group" && c.tickets === 32));
  });
});

describe("\"Revenue is right\"", () => {
  it("releases the held revenue on the block and records who; no count row is touched", async () => {
    const item = {
      id: "item-1",
      report_id: "report-1",
      block_id: "block-0",
      kind: "price_looks_wrong",
      show_name: "IPC",
      detail: {},
      resolved_at: null,
      resolution: null,
    };
    const store = fakeStore({ item });
    await resolveItem(store.sb, "item-1", { kind: "revenue_right" }, { userId: "u1", name: "Matas" }, runContext());
    const touched = writes(store.calls);
    assert.deepEqual(
      touched.map((c) => c.table),
      ["internal_count_blocks", "internal_count_review_items"],
    );
    assert.deepEqual(Object.keys(op(touched[0], "update")![0] as object).sort(), ["revenue_held", "revenue_released_at", "revenue_released_by"]);
    const resolved = op(touched[1], "update")![0] as Record<string, unknown>;
    assert.equal(resolved.resolution, "revenue_right");
    assert.equal(resolved.resolved_by, "u1");
    assert.equal(resolved.resolved_by_name, "Matas");
    assert.ok(resolved.resolved_at);
    assert.equal(store.rpcs.length, 0);
    assert.ok(!store.calls.some((c) => c.table === "tier_channel_sales" || c.table === "ticket_sales_snapshots"));
  });

  it("is refused on an item that's already checked: nothing resolves twice", async () => {
    const store = fakeStore({
      item: { id: "i", report_id: "r", block_id: "b", kind: "price_looks_wrong", show_name: "IPC", detail: {}, resolved_at: "2026-11-12T15:00:00Z", resolution: "keep_holding" },
    });
    await assert.rejects(resolveItem(store.sb, "i", { kind: "revenue_right" }, { userId: "u1", name: "Matas" }, runContext()));
    assert.equal(writes(store.calls).length, 0);
  });
});

describe("a total but no tiers: the two choices", () => {
  const schak = pdf12.sheet!.blocks.find((b) => b.showName === "SCHAK")!;
  const parsed = {
    ...schak,
    outlets: schak.outlets.map((o) => ({ ...o, cells: o.cells.map((c) => (c === null ? null : 0)) })),
    totals: { ...schak.totals!, cells: schak.totals!.cells.map(() => 0), total: 993 },
  };
  const item = { id: "nt", report_id: "report-1", block_id: "block-14", kind: "no_tiers", show_name: "SCHAK", detail: { total: 993, date: "2026-09-22" }, resolved_at: null, resolution: null };
  const block = {
    id: "block-14", report_id: "report-1", show_name: "SCHAK", event_id: "id-NX26-SCHAK", count_date: "2026-09-22",
    printed_date: null, chosen_total: null as number | null, revenue_held: true, status: "held", parsed,
  };
  function store() {
    const { db, calls } = fakeDb((call: FakeCall) => {
      if (call.table === "internal_count_review_items" && op(call, "single")) return { data: item, error: null };
      if (call.table === "internal_count_blocks" && op(call, "single")) return { data: { ...block, chosen_total: 993 }, error: null };
      return { data: [], error: null };
    });
    const rpcs: Array<[string, Record<string, unknown>]> = [];
    const sb = Object.assign(db as object, { rpc: async (n: string, a: Record<string, unknown>) => (rpcs.push([n, a]), { error: null }) });
    return { sb: sb as never, calls, rpcs };
  }

  it("\"Use the total\" stores the total with comps unknown: no tier rows, comp_tickets null", async () => {
    const s = store();
    await resolveItem(s.sb, "nt", { kind: "use_total", total: 993 }, { userId: "u1", name: "Matas" }, runContext());
    const blockUpdates = writes(s.calls).filter((c) => c.table === "internal_count_blocks").map((c) => op(c, "update")![0] as Record<string, unknown>);
    assert.deepEqual(blockUpdates[0], { chosen_total: 993 });
    assert.deepEqual(blockUpdates[1], { paid_tickets: 993, comp_tickets: null, total_tickets: 993 });
    assert.equal(s.rpcs.length, 1);
    const [, args] = s.rpcs[0];
    assert.deepEqual(args.p_cells, []);
    const snap = args.p_snapshot as { tickets_sold: number; gross_revenue_cents: number | null; raw_payload: Record<string, unknown> };
    assert.equal(snap.tickets_sold, 993);
    assert.equal(snap.gross_revenue_cents, null);
    assert.equal(snap.raw_payload.comps, null);
  });

  it("\"Skip this show\" stores nothing for it and keeps the block as skipped", async () => {
    const s = store();
    await resolveItem(s.sb, "nt", { kind: "skip_show" }, { userId: "u1", name: "Matas" }, runContext());
    assert.equal(s.rpcs.length, 0);
    const touched = writes(s.calls);
    assert.deepEqual(op(touched[0], "update")![0], { status: "skipped" });
    assert.equal((op(touched[1], "update")![0] as Record<string, unknown>).resolution, "skip_show");
    assert.ok(!s.calls.some((c) => c.table === "tier_channel_sales" || c.table === "ticket_sales_snapshots"));
  });
});

