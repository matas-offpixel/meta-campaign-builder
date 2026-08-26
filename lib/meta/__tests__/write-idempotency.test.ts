import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  clearMetaWriteIdempotency,
  hashMetaWritePayload,
  isMetaIdempotencyTableMissing,
  listFailedMetaWrites,
  withMetaWriteIdempotency,
} from "../write-idempotency.ts";

interface IdempotencyRow {
  id: string;
  user_id: string;
  event_id: string | null;
  draft_id: string;
  op_kind: string;
  op_payload_hash: string;
  op_result_id: string | null;
  op_status: "pending" | "success" | "failed";
}

class MemorySupabase {
  rows: IdempotencyRow[];
  lookupError: { code?: string; message?: string } | null = null;
  upsertError: { code?: string; message?: string } | null = null;

  constructor(rows: IdempotencyRow[] = []) {
    this.rows = rows;
  }

  from(table: string) {
    assert.equal(table, "meta_write_idempotency");
    return new MemoryBuilder(this);
  }
}

class MemoryBuilder {
  private readonly db: MemorySupabase;
  private eqs: Record<string, unknown> = {};
  private pendingUpsert: { id?: string } | null = null;
  private pendingUpdate: Record<string, unknown> | null = null;
  private pendingDelete = false;
  private selectedAfterWrite = false;

  constructor(db: MemorySupabase) {
    this.db = db;
  }

  select() {
    this.selectedAfterWrite = true;
    return this;
  }

  eq(col: string, val: unknown) {
    this.eqs[col] = val;
    if (this.pendingUpdate) {
      this.applyUpdate();
    }
    return this;
  }

  upsert(payload: Record<string, unknown>) {
    if (this.db.upsertError) {
      this.pendingUpsert = null;
      return this;
    }
    const row = this.db.rows.find(
      (candidate) =>
        candidate.draft_id === payload.draft_id &&
        candidate.op_kind === payload.op_kind &&
        candidate.op_payload_hash === payload.op_payload_hash,
    );
    if (row) {
      Object.assign(row, payload);
      this.pendingUpsert = row as { id?: string };
    } else {
      const inserted = {
        id: `idem_${this.db.rows.length + 1}`,
        op_result_id: null,
        ...payload,
      } as IdempotencyRow;
      this.db.rows.push(inserted);
      this.pendingUpsert = inserted as { id?: string };
    }
    return this;
  }

  update(patch: Record<string, unknown>) {
    this.pendingUpdate = patch;
    return this;
  }

  delete() {
    this.pendingDelete = true;
    return this;
  }

  maybeSingle() {
    if (this.db.lookupError && !this.pendingUpsert && !this.pendingUpdate) {
      return Promise.resolve({ data: null, error: this.db.lookupError });
    }
    if (this.db.upsertError && this.pendingUpsert === null && this.selectedAfterWrite) {
      return Promise.resolve({ data: null, error: this.db.upsertError });
    }
    if (this.pendingUpsert && this.selectedAfterWrite) {
      return Promise.resolve({ data: { id: this.pendingUpsert.id }, error: null });
    }
    const row =
      this.db.rows.find((candidate) =>
        Object.entries(this.eqs).every(
          ([key, value]) => candidate[key as keyof IdempotencyRow] === value,
        ),
      ) ?? null;
    return Promise.resolve({ data: row, error: null });
  }

  then(onFulfilled?: (value: { data: null; error: null }) => unknown) {
    if (this.pendingDelete) {
      this.db.rows = this.db.rows.filter(
        (candidate) =>
          !Object.entries(this.eqs).every(
            ([key, value]) => candidate[key as keyof IdempotencyRow] === value,
          ),
      );
    }
    const value = { data: null, error: null };
    return Promise.resolve(onFulfilled ? onFulfilled(value) : value);
  }

  private applyUpdate() {
    const row = this.db.rows.find((candidate) =>
      Object.entries(this.eqs).every(
        ([key, value]) => candidate[key as keyof IdempotencyRow] === value,
      ),
    );
    if (row && this.pendingUpdate) {
      Object.assign(row, this.pendingUpdate);
    }
  }
}

const BASE_CONTEXT = {
  userId: "00000000-0000-0000-0000-000000000001",
  eventId: "00000000-0000-0000-0000-000000000002",
  draftId: "00000000-0000-0000-0000-000000000003",
};

describe("isMetaIdempotencyTableMissing", () => {
  it("recognises PostgREST and Postgres missing-relation codes", () => {
    assert.equal(isMetaIdempotencyTableMissing({ code: "PGRST205" }), true);
    assert.equal(isMetaIdempotencyTableMissing({ code: "42P01" }), true);
    assert.equal(
      isMetaIdempotencyTableMissing({
        message: 'Could not find the table "public.meta_write_idempotency" in the schema cache',
      }),
      true,
    );
    assert.equal(isMetaIdempotencyTableMissing({ code: "23503" }), false);
  });
});

describe("withMetaWriteIdempotency", () => {
  it("returns the cached result for the same payload without a second run", async () => {
    const db = new MemorySupabase();
    const context = {
      ...BASE_CONTEXT,
      supabase: db as unknown as SupabaseClient,
    };
    let runs = 0;
    const run = async () => {
      runs += 1;
      return `campaign_${runs}`;
    };

    const first = await withMetaWriteIdempotency(
      context,
      "campaign_create",
      { name: "BB26" },
      run,
    );
    const second = await withMetaWriteIdempotency(
      context,
      "campaign_create",
      { name: "BB26" },
      run,
    );

    assert.equal(first, "campaign_1");
    assert.equal(second, "campaign_1");
    assert.equal(runs, 1);
    assert.equal(db.rows[0].op_status, "success");
    assert.equal(db.rows[0].op_result_id, "campaign_1");
  });

  it("runs the write when the table is absent (additive — today's behaviour)", async () => {
    const db = new MemorySupabase();
    db.lookupError = {
      code: "PGRST205",
      message: "Could not find the table public.meta_write_idempotency in the schema cache",
    };
    let runs = 0;

    const id = await withMetaWriteIdempotency(
      {
        ...BASE_CONTEXT,
        supabase: db as unknown as SupabaseClient,
      },
      "campaign_create",
      { name: "BB26" },
      async () => {
        runs += 1;
        return "campaign_live";
      },
    );

    assert.equal(id, "campaign_live");
    assert.equal(runs, 1);
    assert.equal(db.rows.length, 0);
  });

  it("runs the write when context is null (no hard dependency)", async () => {
    let runs = 0;
    const id = await withMetaWriteIdempotency(null, "adset_create", { name: "x" }, async () => {
      runs += 1;
      return "adset_1";
    });
    assert.equal(id, "adset_1");
    assert.equal(runs, 1);
  });

  it("re-runs a failed row and does not short-circuit onto a missing result id", async () => {
    const db = new MemorySupabase();
    const context = {
      ...BASE_CONTEXT,
      supabase: db as unknown as SupabaseClient,
    };
    await assert.rejects(
      withMetaWriteIdempotency(context, "ad_create", { name: "DOD ad" }, async () => {
        throw new Error("An unexpected error has occurred. Please retry your request later.");
      }),
    );
    assert.equal(db.rows[0].op_status, "failed");
    assert.equal(db.rows[0].op_result_id, null);

    let runs = 0;
    const retried = await withMetaWriteIdempotency(
      context,
      "ad_create",
      { name: "DOD ad" },
      async () => {
        runs += 1;
        return "ad_recovered";
      },
    );
    assert.equal(retried, "ad_recovered");
    assert.equal(runs, 1, "failed row must re-attempt, not return a cached id");
    assert.equal(db.rows[0].op_status, "success");
    assert.equal(db.rows[0].op_result_id, "ad_recovered");
  });

  it("marks the row failed and rethrows when run() fails", async () => {
    const db = new MemorySupabase();
    await assert.rejects(
      withMetaWriteIdempotency(
        {
          ...BASE_CONTEXT,
          supabase: db as unknown as SupabaseClient,
        },
        "ad_create",
        { name: "ad" },
        async () => {
          throw new Error("Meta 500");
        },
      ),
      /Meta 500/,
    );
    assert.equal(db.rows[0].op_status, "failed");
    assert.equal(db.rows[0].op_result_id, null);
  });

  it("lists only failed ad and ad-set rows (successes and other kinds stay hidden)", async () => {
    const rows = [
      { op_kind: "ad_create", op_payload_hash: "a", op_status: "failed" },
      { op_kind: "ad_create", op_payload_hash: "b", op_status: "success" },
      { op_kind: "campaign_create", op_payload_hash: "c", op_status: "failed" },
      { op_kind: "adset_create", op_payload_hash: "d", op_status: "failed" },
    ];
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    };
    const failed = await listFailedMetaWrites({
      supabase: supabase as unknown as SupabaseClient,
      draftId: BASE_CONTEXT.draftId,
    });
    assert.deepEqual(failed, [
      { op_kind: "ad_create", op_payload_hash: "a" },
      { op_kind: "adset_create", op_payload_hash: "d" },
    ]);
  });

  it("hashes payloads stably so key order does not fork the ledger", () => {
    assert.equal(
      hashMetaWritePayload({ b: 1, a: 2 }),
      hashMetaWritePayload({ a: 2, b: 1 }),
    );
  });
});

describe("clearMetaWriteIdempotency", () => {
  it("drops every row for the draft so retry cannot reuse deleted ids", async () => {
    const db = new MemorySupabase();
    const context = {
      ...BASE_CONTEXT,
      supabase: db as unknown as SupabaseClient,
    };
    await withMetaWriteIdempotency(context, "campaign_create", { name: "BB26" }, async () => "cam_1");
    assert.equal(db.rows.length, 1);

    await clearMetaWriteIdempotency(context);
    assert.equal(db.rows.length, 0);

    let runs = 0;
    const next = await withMetaWriteIdempotency(context, "campaign_create", { name: "BB26" }, async () => {
      runs += 1;
      return "cam_2";
    });
    assert.equal(next, "cam_2");
    assert.equal(runs, 1);
  });

  it("is a no-op when the table is absent", async () => {
    const db = new MemorySupabase();
    db.lookupError = { code: "42P01", message: "relation meta_write_idempotency does not exist" };
    await clearMetaWriteIdempotency({
      draftId: BASE_CONTEXT.draftId,
      supabase: db as unknown as SupabaseClient,
    });
  });
});
