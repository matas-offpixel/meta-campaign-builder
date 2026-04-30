import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import { TikTokApiError } from "../client.ts";
import { createMockTikTokClient } from "../__mocks__/client.ts";
import { createTikTokAd } from "../write/ad.ts";
import { createTikTokAdGroup } from "../write/adgroup.ts";
import { createTikTokCampaign } from "../write/campaign.ts";
import { hashTikTokWritePayload } from "../write/idempotency.ts";
import { launchTikTokDraftState } from "../write/orchestrator.ts";

interface IdempotencyRow {
  id: string;
  user_id: string;
  event_id: string;
  draft_id: string;
  op_kind: string;
  op_payload_hash: string;
  op_result_id: string | null;
  op_status: "pending" | "success" | "failed";
}

class MemorySupabase {
  rows: IdempotencyRow[];
  updates: Array<{ patch: Record<string, unknown>; eqs: Record<string, unknown> }>;

  constructor(rows: IdempotencyRow[] = []) {
    this.rows = rows;
    this.updates = [];
  }

  from(table: string) {
    assert.equal(table, "tiktok_write_idempotency");
    return new MemoryBuilder(this);
  }
}

class MemoryBuilder {
  private readonly db: MemorySupabase;
  private eqs: Record<string, unknown> = {};
  private pendingUpsert: { id?: string } | null = null;
  private pendingUpdate: Record<string, unknown> | null = null;
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

  maybeSingle() {
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
      this.db.updates.push({ patch: this.pendingUpdate, eqs: { ...this.eqs } });
    }
  }
}

const BASE_CONTEXT = {
  userId: "00000000-0000-0000-0000-000000000001",
  eventId: "00000000-0000-0000-0000-000000000002",
  draftId: "00000000-0000-0000-0000-000000000003",
  advertiserId: "advertiser_1",
  token: "token_1",
};

afterEach(() => {
  delete process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED;
});

describe("TikTok write feature flag", () => {
  it("throws before calling TikTok when writes are disabled", async () => {
    const db = new MemorySupabase();
    const mock = createMockTikTokClient();

    await assert.rejects(
      createTikTokCampaign({
        ...BASE_CONTEXT,
        supabase: db as unknown as SupabaseClient,
    request: mock.tiktokPost,
        campaignName: "Campaign",
        objective: "TRAFFIC",
      }),
      /TikTok writes are disabled/,
    );

    assert.equal(mock.calls.length, 0);
    assert.equal(db.rows.length, 0);
  });
});

describe("createTikTokCampaign", () => {
  it("creates campaigns through idempotency", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient();

    const out = await createTikTokCampaign({
      ...BASE_CONTEXT,
      supabase: db as unknown as SupabaseClient,
      request: mock.tiktokPost,
      campaignName: "Campaign",
      objective: "TRAFFIC",
    });

    assert.deepEqual(out, { campaign_id: "campaign_mock_1" });
    assert.equal(mock.calls[0].path, "/campaign/create/");
    assert.equal(db.rows[0].op_status, "success");
    assert.equal(db.rows[0].op_result_id, "campaign_mock_1");
  });

  it("returns the cached result for the same payload without a second API call", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient();
    const args = {
      ...BASE_CONTEXT,
      supabase: db as unknown as SupabaseClient,
      request: mock.tiktokPost,
      campaignName: "Campaign",
      objective: "TRAFFIC",
    };

    await createTikTokCampaign(args);
    const out = await createTikTokCampaign(args);

    assert.deepEqual(out, { campaign_id: "campaign_mock_1" });
    assert.equal(mock.calls.length, 1);
  });

  it("retries TikTok 50001 once before succeeding", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient({
      failOnce: {
        "/campaign/create/": new TikTokApiError(
          "rate limited",
          50001,
          "req-1",
          200,
        ),
      },
    });
    const sleeps: number[] = [];

    const out = await createTikTokCampaign({
      ...BASE_CONTEXT,
      supabase: db as unknown as SupabaseClient,
      request: mock.tiktokPost,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      campaignName: "Campaign",
      objective: "TRAFFIC",
    });

    assert.equal(out.campaign_id, "campaign_mock_1");
    assert.deepEqual(sleeps, [10_000]);
    assert.equal(mock.calls.length, 2);
  });
});

describe("ad group and ad writes", () => {
  it("creates an ad group followed by an ad", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient();
    const context = {
      ...BASE_CONTEXT,
      supabase: db as unknown as SupabaseClient,
      request: mock.tiktokPost,
    };

    const adgroup = await createTikTokAdGroup({
      ...context,
      campaignId: "campaign_1",
      adGroupName: "Prospecting",
      budget: 50,
      scheduleStartAt: "2026-05-01T09:00:00Z",
      scheduleEndAt: "2026-05-08T09:00:00Z",
      optimisationGoal: "CLICK",
    });
    const ad = await createTikTokAd({
      ...context,
      adGroupId: adgroup.adgroup_id,
      adName: "Hero · v1",
      videoId: "video_1",
      adText: "Ad text",
      displayName: "Off/Pixel",
      landingPageUrl: "https://example.com",
      cta: "LEARN_MORE",
      identityId: "identity_1",
    });

    assert.ok(adgroup.adgroup_id.startsWith("adgroup_mock_"));
    assert.ok(ad.ad_id.startsWith("ad_mock_"));
    assert.deepEqual(
      mock.calls.map((call) => call.path),
      ["/adgroup/create/", "/ad/create/"],
    );
  });
});

describe("launchTikTokDraftState", () => {
  it("launches campaign, ad groups, and ads in order", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient();
    const draft = launchableDraft();

    const out = await launchTikTokDraftState(
      {
        ...BASE_CONTEXT,
        supabase: db as unknown as SupabaseClient,
        request: mock.tiktokPost,
      },
      draft,
    );

    assert.equal(out.campaign_id, "campaign_mock_1");
    assert.equal(out.adgroup_ids.length, 1);
    assert.equal(out.ad_ids.length, 1);
    assert.deepEqual(
      mock.calls.map((call) => call.path),
      ["/campaign/create/", "/adgroup/create/", "/ad/create/"],
    );
  });

  it("attempts campaign cleanup after a mid-flight ad group failure", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient({
      failAlways: {
        "/adgroup/create/": new TikTokApiError("invalid", 40000, "req-1", 400),
      },
    });

    await assert.rejects(
      launchTikTokDraftState(
        {
          ...BASE_CONTEXT,
          supabase: db as unknown as SupabaseClient,
          request: mock.tiktokPost,
        },
        launchableDraft(),
      ),
      /invalid/,
    );

    assert.deepEqual(
      mock.calls.map((call) => call.path),
      ["/campaign/create/", "/adgroup/create/", "/campaign/delete/"],
    );
  });
});

describe("hashTikTokWritePayload", () => {
  it("hashes payloads deterministically regardless of object key order", () => {
    assert.equal(
      hashTikTokWritePayload({ b: 2, a: { d: 4, c: 3 } }),
      hashTikTokWritePayload({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });
});

function launchableDraft() {
  const draft = createDefaultTikTokDraft(BASE_CONTEXT.draftId);
  draft.eventId = BASE_CONTEXT.eventId;
  draft.accountSetup.advertiserId = BASE_CONTEXT.advertiserId;
  draft.accountSetup.identityId = "identity_1";
  draft.campaignSetup.campaignName = "Campaign";
  draft.campaignSetup.objective = "TRAFFIC";
  draft.campaignSetup.optimisationGoal = "CLICK";
  draft.budgetSchedule.budgetMode = "DAILY";
  draft.budgetSchedule.budgetAmount = 50;
  draft.budgetSchedule.scheduleStartAt = "2026-05-01T09:00:00Z";
  draft.budgetSchedule.scheduleEndAt = "2026-05-08T09:00:00Z";
  draft.budgetSchedule.adGroups = [
    {
      id: "adgroup-draft-1",
      name: "Prospecting",
      budget: 50,
      startAt: null,
      endAt: null,
    },
  ];
  draft.creatives.items = [
    {
      id: "creative-1",
      name: "Hero · v1",
      mode: "VIDEO_REFERENCE",
      baseName: "Hero",
      videoId: "video_1",
      videoUrl: null,
      thumbnailUrl: null,
      durationSeconds: null,
      title: null,
      sparkPostId: null,
      caption: "",
      adText: "Ad text",
      displayName: "Off/Pixel",
      landingPageUrl: "https://example.com",
      cta: "LEARN_MORE",
      musicId: null,
    },
  ];
  draft.creativeAssignments.byAdGroupId = {
    "adgroup-draft-1": ["creative-1"],
  };
  return draft;
}
