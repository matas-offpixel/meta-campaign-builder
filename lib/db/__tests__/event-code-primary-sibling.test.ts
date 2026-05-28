import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isEngagementOwnerForCode } from "../event-code-primary-sibling.ts";

/**
 * Pins R2a owner-selection for the rollup writer (issue #471
 * PR-A.5). The Edinburgh-shape (3 fixtures) and Brighton-shape
 * (4 fixtures) cases mirror the two real-world venue topologies we
 * triple-counted before this fix. Lex-min `events.id` is the owner.
 */

interface FakeEventsRow {
  id: string;
  event_code: string;
}

function fakeSupabaseWithEvents(rows: FakeEventsRow[]): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, "events", `unexpected table ${table}`);
      let codeFilter: string | null = null;
      let asc = true;
      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: string) {
          assert.equal(col, "event_code", `unexpected eq column ${col}`);
          codeFilter = val;
          return builder;
        },
        order(col: string, opts: { ascending: boolean }) {
          assert.equal(col, "id", `unexpected order column ${col}`);
          asc = opts.ascending;
          return builder;
        },
        limit() {
          return builder;
        },
        async maybeSingle() {
          const filtered = rows.filter((r) => r.event_code === codeFilter);
          filtered.sort((a, b) =>
            asc ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id),
          );
          const first = filtered[0];
          return { data: first ? { id: first.id } : null, error: null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

function failingSupabase(): SupabaseClient {
  return {
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        async maybeSingle() {
          return { data: null, error: { message: "db down" } };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

function throwingSupabase(): SupabaseClient {
  return {
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        async maybeSingle(): Promise<never> {
          throw new Error("connection refused");
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe("isEngagementOwnerForCode", () => {
  it("Edinburgh shape (3 fixtures) — only the lex-min event_id owns", async () => {
    const sb = fakeSupabaseWithEvents([
      // Real Edinburgh UUIDs from prod, sorted lex-min first.
      { id: "296e6bdc-03c1-4fe0-9294-4e7fd9386253", event_code: "WC26-EDINBURGH" },
      { id: "4749f1c4-526b-471c-90e0-41f991d78555", event_code: "WC26-EDINBURGH" },
      { id: "530ae3b4-4a20-456d-a40f-6600c82b41ce", event_code: "WC26-EDINBURGH" },
    ]);
    assert.equal(
      await isEngagementOwnerForCode(sb, {
        eventCode: "WC26-EDINBURGH",
        eventId: "296e6bdc-03c1-4fe0-9294-4e7fd9386253",
      }),
      true,
      "lex-min event_id should be owner",
    );
    assert.equal(
      await isEngagementOwnerForCode(sb, {
        eventCode: "WC26-EDINBURGH",
        eventId: "4749f1c4-526b-471c-90e0-41f991d78555",
      }),
      false,
      "middle sibling should not be owner",
    );
    assert.equal(
      await isEngagementOwnerForCode(sb, {
        eventCode: "WC26-EDINBURGH",
        eventId: "530ae3b4-4a20-456d-a40f-6600c82b41ce",
      }),
      false,
      "highest-id sibling should not be owner",
    );
  });

  it("Brighton shape (4 fixtures) — exactly one owner across siblings", async () => {
    const ids = [
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
      "44444444-4444-4444-4444-444444444444",
    ];
    const sb = fakeSupabaseWithEvents(
      ids.map((id) => ({ id, event_code: "WC26-BRIGHTON" })),
    );
    let owners = 0;
    for (const id of ids) {
      const isOwner = await isEngagementOwnerForCode(sb, {
        eventCode: "WC26-BRIGHTON",
        eventId: id,
      });
      if (isOwner) owners += 1;
    }
    assert.equal(owners, 1, "exactly one sibling must own engagement");
  });

  it("solo event (no siblings) — owner by construction", async () => {
    const sb = fakeSupabaseWithEvents([
      { id: "solo-event-id", event_code: "BB26-RIANBRAZIL-SOLO" },
    ]);
    assert.equal(
      await isEngagementOwnerForCode(sb, {
        eventCode: "BB26-RIANBRAZIL-SOLO",
        eventId: "solo-event-id",
      }),
      true,
    );
  });

  it("empty event_code → owner=true (skip path)", async () => {
    const sb = fakeSupabaseWithEvents([]);
    assert.equal(
      await isEngagementOwnerForCode(sb, { eventCode: "", eventId: "any" }),
      true,
    );
    assert.equal(
      await isEngagementOwnerForCode(sb, {
        eventCode: "   ",
        eventId: "any",
      }),
      true,
    );
  });

  it("DB error → owner=true (fail OPEN — preserves pre-R2a behaviour)", async () => {
    assert.equal(
      await isEngagementOwnerForCode(failingSupabase(), {
        eventCode: "WC26-EDINBURGH",
        eventId: "any",
      }),
      true,
    );
  });

  it("DB throw → owner=true (fail OPEN)", async () => {
    assert.equal(
      await isEngagementOwnerForCode(throwingSupabase(), {
        eventCode: "WC26-EDINBURGH",
        eventId: "any",
      }),
      true,
    );
  });

  it("no matching event for code → owner=true (defensive fail OPEN)", async () => {
    const sb = fakeSupabaseWithEvents([
      { id: "other-id", event_code: "DIFFERENT-CODE" },
    ]);
    assert.equal(
      await isEngagementOwnerForCode(sb, {
        eventCode: "WC26-EDINBURGH",
        eventId: "any",
      }),
      true,
    );
  });
});
