import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CampaignLedgerObjectiveError,
  runCampaignCreateLedger,
} from "../campaign-ledger.ts";
import type { MetaWriteContext } from "../write-idempotency.ts";

interface Row {
  id: string;
  user_id: string;
  event_id: string | null;
  draft_id: string;
  op_kind: string;
  op_payload_hash: string;
  op_result_id: string | null;
  op_status: "pending" | "success" | "failed";
}

class Memory {
  rows: Row[] = [];
  from() {
    return new Builder(this);
  }
}

class Builder {
  private eqs: Record<string, string> = {};
  private deleteMode = false;
  private upsertRow: Row | null = null;
  private patch: Partial<Row> | null = null;
  private db: Memory;
  constructor(db: Memory) {
    this.db = db;
  }
  select() { return this; }
  eq(col: string, val: string) {
    this.eqs[col] = val;
    if (this.patch) this.applyPatch();
    return this;
  }
  delete() {
    this.deleteMode = true;
    return this;
  }
  upsert(payload: Record<string, unknown>) {
    const found = this.db.rows.find(
      (row) =>
        row.draft_id === payload.draft_id &&
        row.op_kind === payload.op_kind &&
        row.op_payload_hash === payload.op_payload_hash,
    );
    if (found) {
      Object.assign(found, payload);
      this.upsertRow = found;
    } else {
      const inserted = {
        id: `row-${this.db.rows.length + 1}`,
        op_result_id: null,
        op_status: "pending",
        ...payload,
      } as Row;
      this.db.rows.push(inserted);
      this.upsertRow = inserted;
    }
    return this;
  }
  update(patch: Partial<Row>) {
    this.patch = patch;
    return this;
  }
  maybeSingle() {
    if (this.upsertRow) return Promise.resolve({ data: { id: this.upsertRow.id }, error: null });
    const row = this.db.rows.find((candidate) =>
      Object.entries(this.eqs).every(([key, value]) => candidate[key as keyof Row] === value),
    );
    return Promise.resolve({ data: row ?? null, error: null });
  }
  then(onFulfilled?: (value: { data: null; error: null }) => unknown) {
    if (this.deleteMode) {
      this.db.rows = this.db.rows.filter(
        (candidate) =>
          !Object.entries(this.eqs).every(([key, value]) => candidate[key as keyof Row] === value),
      );
    }
    const value = { data: null, error: null };
    return Promise.resolve(onFulfilled ? onFulfilled(value) : value);
  }
  private applyPatch() {
    const row = this.db.rows.find((candidate) =>
      Object.entries(this.eqs).every(([key, value]) => candidate[key as keyof Row] === value),
    );
    if (row && this.patch) Object.assign(row, this.patch);
  }
}

const payload = {
  adAccountId: "act_606252931141334",
  name: "[NX26-SCHAK] SCHAK On Sale",
  objective: "initiate_checkout",
  status: "ACTIVE",
};

function context(db: Memory): MetaWriteContext {
  return {
    supabase: db as unknown as MetaWriteContext["supabase"],
    userId: "user-1",
    draftId: "draft-schak",
    eventId: "event-1",
  };
}

describe("SCHAK launch, archive, launch", () => {
  it("recreates when the ledger campaign is archived and drops dependent rows", async () => {
    const db = new Memory();
    const ctx = context(db);
    let creates = 0;
    const first = await runCampaignCreateLedger({
      context: ctx,
      payload,
      draftObjective: "initiate_checkout",
      campaignName: payload.name,
      fetchCampaign: async () => null,
      create: async () => {
        creates += 1;
        return "120251973029760755";
      },
    });
    assert.equal(first.outcome, "created");
    assert.equal(creates, 1);
    db.rows.push({
      id: "adset-row",
      user_id: "user-1",
      event_id: "event-1",
      draft_id: "draft-schak",
      op_kind: "adset_create",
      op_payload_hash: "adset",
      op_result_id: "adset-old",
      op_status: "success",
    });
    db.rows.push({
      id: "creative-row",
      user_id: "user-1",
      event_id: "event-1",
      draft_id: "draft-schak",
      op_kind: "creative_upload",
      op_payload_hash: "creative",
      op_result_id: "1061861486722197",
      op_status: "success",
    });

    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    let secondCreates = 0;
    try {
      const second = await runCampaignCreateLedger({
        context: ctx,
        payload,
        draftObjective: "initiate_checkout",
        campaignName: payload.name,
        fetchCampaign: async () => ({
          id: "120251973029760755",
          name: payload.name,
          effective_status: "ARCHIVED",
          objective: "OUTCOME_SALES",
        }),
        create: async () => {
          secondCreates += 1;
          return "120259999999999755";
        },
      });
      assert.equal(second.outcome, "recreated");
      assert.equal(second.id, "120259999999999755");
    } finally {
      console.log = original;
    }
    assert.equal(secondCreates, 1);
    assert.equal(creates, 1);
    assert.match(logs.join("\n"), /campaign_reused_dead → recreated/);
    assert.equal(db.rows.some((row) => row.op_result_id === "120251973029760755"), false);
    assert.equal(db.rows.some((row) => row.op_kind === "adset_create"), false);
    assert.equal(db.rows.some((row) => row.op_kind === "creative_upload"), true);
    assert.equal(db.rows.some((row) => row.op_result_id === "120259999999999755"), true);
  });

  it("reuses a live campaign with the same objective and does not create", async () => {
    const db = new Memory();
    const ctx = context(db);
    await runCampaignCreateLedger({
      context: ctx,
      payload,
      draftObjective: "initiate_checkout",
      campaignName: payload.name,
      fetchCampaign: async () => null,
      create: async () => "120251973029760755",
    });
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    let creates = 0;
    try {
      const again = await runCampaignCreateLedger({
        context: ctx,
        payload,
        draftObjective: "initiate_checkout",
        campaignName: payload.name,
        fetchCampaign: async () => ({
          id: "120251973029760755",
          name: payload.name,
          effective_status: "ACTIVE",
          objective: "OUTCOME_SALES",
        }),
        create: async () => {
          creates += 1;
          return "should-not-run";
        },
      });
      assert.equal(again.outcome, "reused");
      assert.equal(again.id, "120251973029760755");
    } finally {
      console.log = original;
    }
    assert.equal(creates, 0);
    assert.match(logs.join("\n"), /Campaign reused \(ledger\) ID 120251973029760755/);
    assert.doesNotMatch(logs.join("\n"), /created/);
  });

  it("refuses a live campaign whose objective no longer matches, and creates nothing", async () => {
    const db = new Memory();
    const ctx = context(db);
    await runCampaignCreateLedger({
      context: ctx,
      payload,
      draftObjective: "initiate_checkout",
      campaignName: payload.name,
      fetchCampaign: async () => null,
      create: async () => "120251973029760755",
    });
    let creates = 0;
    await assert.rejects(
      () =>
        runCampaignCreateLedger({
          context: ctx,
          payload,
          draftObjective: "initiate_checkout",
          campaignName: payload.name,
          fetchCampaign: async () => ({
            id: "120251973029760755",
            name: payload.name,
            effective_status: "ACTIVE",
            objective: "OUTCOME_TRAFFIC",
          }),
          create: async () => {
            creates += 1;
            return "nope";
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof CampaignLedgerObjectiveError);
        assert.match(err.message, /objective changed/);
        assert.match(err.message, /OUTCOME_TRAFFIC/);
        return true;
      },
    );
    assert.equal(creates, 0);
  });
});
