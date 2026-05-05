import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  metaAudienceIdempotencyKey,
  withMetaAudienceWriteIdempotency,
} from "../audience-idempotency.ts";

describe("withMetaAudienceWriteIdempotency", () => {
  it("inserts the idempotency key before the API call and caches success", async () => {
    const db = new MemorySupabase();
    const order: string[] = [];

    const id = await withMetaAudienceWriteIdempotency(
      db,
      {
        idempotencyKey: metaAudienceIdempotencyKey("audience_1", "user_1"),
        userId: "user_1",
        audienceId: "audience_1",
      },
      async () => {
        order.push("api");
        assert.equal(db.rows.length, 1);
        assert.equal(db.rows[0].idempotency_key, "mca:audience_1:user_1");
        return "meta_1";
      },
    );

    assert.equal(id, "meta_1");
    assert.deepEqual(order, ["api"]);
    assert.equal(db.rows[0].meta_audience_id, "meta_1");

    const cached = await withMetaAudienceWriteIdempotency(
      db,
      {
        idempotencyKey: "mca:audience_1:user_1",
        userId: "user_1",
        audienceId: "audience_1",
      },
      async () => {
        throw new Error("should not call API");
      },
    );
    assert.equal(cached, "meta_1");
  });
});

interface Row {
  idempotency_key: string;
  user_id: string;
  audience_id: string;
  meta_audience_id: string | null;
}

class MemorySupabase {
  rows: Row[] = [];

  from(table: string) {
    assert.equal(table, "meta_audience_write_idempotency");
    return new Builder(this);
  }
}

class Builder {
  private readonly db: MemorySupabase;
  private eqs: Record<string, unknown> = {};
  private insertPayload: Row | null = null;
  private updatePayload: Partial<Row> | null = null;

  constructor(db: MemorySupabase) {
    this.db = db;
  }

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.eqs[column] = value;
    return this;
  }

  insert(payload: Omit<Row, "meta_audience_id">) {
    this.insertPayload = { ...payload, meta_audience_id: null };
    return Promise.resolve(this.applyInsert());
  }

  update(payload: Partial<Row>) {
    this.updatePayload = payload;
    return this;
  }

  maybeSingle() {
    const row =
      this.db.rows.find((candidate) =>
        Object.entries(this.eqs).every(
          ([key, value]) => candidate[key as keyof Row] === value,
        ),
      ) ?? null;
    return Promise.resolve({ data: row, error: null });
  }

  then(resolve: (value: { data: null; error: null }) => unknown) {
    if (this.updatePayload) {
      const row = this.db.rows.find((candidate) =>
        Object.entries(this.eqs).every(
          ([key, value]) => candidate[key as keyof Row] === value,
        ),
      );
      if (row) Object.assign(row, this.updatePayload);
    }
    return Promise.resolve(resolve({ data: null, error: null }));
  }

  private applyInsert() {
    if (this.insertPayload) this.db.rows.push(this.insertPayload);
    return { data: null, error: null };
  }
}
