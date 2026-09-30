/**
 * In-memory stand-in for `meta_write_idempotency`, shared by the ad-set
 * targeting and destination write tests. Extracted from the targeting test
 * (#989) so the destination tests exercise the same ledger behaviour rather
 * than a second, subtly different fake.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface IdempotencyRow {
  id: string;
  draft_id: string;
  op_kind: string;
  op_payload_hash: string;
  op_result_id: string | null;
  op_status: "pending" | "success" | "failed";
  [key: string]: unknown;
}

export function memoryLedger(): {
  context: {
    supabase: SupabaseClient;
    userId: string;
    draftId: string;
    eventId: string | null;
  };
  lookupError: { code?: string; message?: string } | null;
} {
  const rows: IdempotencyRow[] = [];
  let nextId = 1;
  const state: { lookupError: { code?: string; message?: string } | null } = { lookupError: null };

  class Builder {
    private eqs: Record<string, unknown> = {};
    private pendingUpsert: { id?: string } | null = null;
    private pendingUpdate: Record<string, unknown> | null = null;
    private selected = false;
    private pendingDelete = false;

    select() {
      this.selected = true;
      return this;
    }

    eq(col: string, val: unknown) {
      this.eqs[col] = val;
      if (this.pendingUpdate) {
        const row = rows.find((candidate) =>
          Object.entries(this.eqs).every(([key, value]) => candidate[key] === value),
        );
        if (row) Object.assign(row, this.pendingUpdate);
      }
      return this;
    }

    upsert(payload: Record<string, unknown>) {
      if (state.lookupError && this.selected) {
        this.pendingUpsert = null;
        return this;
      }
      const row = rows.find(
        (candidate) =>
          candidate.draft_id === payload.draft_id &&
          candidate.op_kind === payload.op_kind &&
          candidate.op_payload_hash === payload.op_payload_hash,
      );
      if (row) {
        Object.assign(row, payload);
        this.pendingUpsert = row;
      } else {
        const inserted = {
          id: `idem_${nextId++}`,
          op_result_id: null,
          op_status: "pending",
          ...payload,
        } as IdempotencyRow;
        rows.push(inserted);
        this.pendingUpsert = inserted;
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
      if (state.lookupError && !this.pendingUpsert) {
        return Promise.resolve({ data: null, error: state.lookupError });
      }
      if (this.pendingUpsert && this.selected) {
        return Promise.resolve({ data: { id: this.pendingUpsert.id }, error: null });
      }
      const row =
        rows.find((candidate) =>
          Object.entries(this.eqs).every(([key, value]) => candidate[key] === value),
        ) ?? null;
      return Promise.resolve({ data: row, error: null });
    }

    then(onFulfilled?: (value: { data: null; error: null }) => unknown) {
      if (this.pendingDelete) {
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const candidate = rows[index]!;
          const match = Object.entries(this.eqs).every(
            ([key, value]) => candidate[key] === value,
          );
          if (match) rows.splice(index, 1);
        }
      }
      const value = { data: null, error: null };
      return Promise.resolve(onFulfilled ? onFulfilled(value) : value);
    }
  }

  const supabase = {
    from() {
      return new Builder();
    },
  } as unknown as SupabaseClient;

  return {
    context: {
      supabase,
      userId: "00000000-0000-4000-8000-000000000001",
      draftId: "00000000-0000-4000-8000-000000000003",
      eventId: null,
    },
    get lookupError() {
      return state.lookupError;
    },
    set lookupError(value) {
      state.lookupError = value;
    },
  };
}
