import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeDb, op, type FakeCall } from "../../launched-ads/__tests__/fake-db.ts";
import { offlineContext } from "../context.ts";
import { applySeed, CONFIRMED_NOT_OURS, CONFIRMED_SHEET_ALIASES, planSeed, SeedError } from "../seed-names.ts";

const CODES = [...new Set(Object.values(CONFIRMED_SHEET_ALIASES))];

function db(opts: { aliasTable?: boolean; events?: Array<{ id: string; event_code: string }>; existing?: Array<{ alias: string; event_id: string }> } = {}) {
  const events = opts.events ?? CODES.map((c) => ({ id: `id-${c}`, event_code: c }));
  return fakeDb((call: FakeCall) => {
    if (call.table === "event_count_aliases" && op(call, "limit")) {
      return opts.aliasTable === false ? { data: null, error: { code: "42P01", message: 'relation "event_count_aliases" does not exist' } } : { data: [], error: null };
    }
    if (call.table === "event_count_aliases" && op(call, "range")) return { data: opts.existing ?? [], error: null };
    if (call.table === "events") return { data: events, error: null };
    return { data: [], error: null };
  });
}

const writes = (calls: FakeCall[]) => calls.filter((c) => op(c, "insert") || op(c, "upsert") || op(c, "update") || op(c, "delete"));

describe("the confirmed names seed", () => {
  it("covers the 16 aliases and 8 not-ours names Matas confirmed, with both Folamour spellings", () => {
    assert.equal(Object.keys(CONFIRMED_SHEET_ALIASES).length, 16);
    assert.equal(CONFIRMED_SHEET_ALIASES.Folamour, "NX26-FOLAMOUR");
    assert.equal(CONFIRMED_SHEET_ALIASES.FOLAMOUR, "NX26-FOLAMOUR");
    assert.equal(CONFIRMED_NOT_OURS.length, 8);
  });

  it("stops clearly when migration 235 isn't applied", async () => {
    const { db: sb } = db({ aliasTable: false });
    await assert.rejects(planSeed(sb), (e: unknown) => e instanceof SeedError && /Apply migrations 234 and 235 first/.test(e.message));
  });

  it("an event code with no event, or two, fails the whole plan and writes nothing", async () => {
    const events = CODES.filter((c) => c !== "NX26-DJEZ").map((c) => ({ id: `id-${c}`, event_code: c }));
    events.push({ id: "dup", event_code: "NX26-IPC" });
    const { db: sb, calls } = db({ events });
    await assert.rejects(planSeed(sb), (e: unknown) => e instanceof SeedError && /NX26-DJEZ \(0\)/.test(e.message) && /NX26-IPC \(2\)/.test(e.message));
    assert.equal(writes(calls).length, 0);
  });

  it("plans new, already and conflict; applying decides every non-conflict name and skips the conflict", async () => {
    const { db: sb, calls } = db({
      existing: [
        { alias: "IPC", event_id: "id-NX26-IPC" },
        { alias: "KREAM", event_id: "someone-else" },
      ],
    });
    const plan = await planSeed(sb);
    assert.equal(plan.aliases.find((a) => a.alias === "IPC")!.state, "already");
    const kream = plan.aliases.find((a) => a.alias === "KREAM")!;
    assert.equal(kream.state, "conflict");
    assert.equal(kream.existingEventId, "someone-else");
    assert.equal(plan.aliases.filter((a) => a.state === "new").length, 14);

    const ctx = offlineContext();
    ctx.events = CODES.map((c) => ({ id: `id-${c}`, eventCode: c, name: c, eventDate: null, userId: "u1", clientId: "c1" }));
    ctx.eventsById = new Map(ctx.events.map((e) => [e.id, e]));
    ctx.eventsByCode = new Map(ctx.events.map((e) => [e.eventCode, e]));
    const result = await applySeed(sb, ctx, plan, { userId: "u1", name: "Matas" });
    assert.equal(result.aliasesWritten, 14);
    assert.equal(result.decided, 15 + 8);
    // decideName writes each new alias through #1218's table, the way "Match to {event}" does.
    const aliasWrites = writes(calls).filter((c) => c.table === "event_count_aliases");
    const rows = aliasWrites.map((c) => op(c, "upsert")![0] as { alias: string; event_id: string });
    assert.equal(rows.length, 15);
    assert.ok(!rows.some((r) => r.alias === "KREAM"));
    assert.deepEqual(op(aliasWrites[0], "upsert")![1], { onConflict: "alias", ignoreDuplicates: true });
    const names = writes(calls).filter((c) => c.table === "internal_count_show_names").map((c) => (op(c, "upsert")![0] as { name: string; not_ours: boolean }));
    assert.equal(names.length, 23);
    assert.ok(names.some((n) => n.name === "DUSKY BRIS" && n.not_ours));
    assert.ok(ctx.notOurs.has("ENZO SIRAGUSA"));
    assert.equal(ctx.aliases.Folamour, "NX26-FOLAMOUR");
  });
});
