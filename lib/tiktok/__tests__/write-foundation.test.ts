import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import { TikTokApiError } from "../client.ts";
import { createMockTikTokClient } from "../__mocks__/client.ts";
import { createTikTokAd, tikTokAdCreateIdentityLog } from "../write/ad.ts";
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
        draft: launchableDraft(),
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
      draft: launchableDraft(),
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
      draft: launchableDraft(),
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
      draft: launchableDraft(),
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

    const draft = launchableDraft();
    const adgroup = await createTikTokAdGroup({
      ...context,
      campaignId: "campaign_1",
      draft,
      adGroup: draft.budgetSchedule.adGroups[0],
    });
    const ad = await createTikTokAd({
      ...context,
      adGroupId: adgroup.adgroup_id,
      draft,
      creative: draft.creatives.items[0],
    });

    assert.ok(adgroup.adgroup_id.startsWith("adgroup_mock_"));
    assert.ok(ad.ad_id.startsWith("ad_mock_"));
    assert.deepEqual(
      mock.calls.map((call) => call.path),
      ["/adgroup/create/", "/ad/create/"],
    );
    assert.equal(mock.calls[1].body.is_aco, false);
    const creatives = mock.calls[1].body.creatives as Array<Record<string, unknown>>;
    assert.equal(creatives[0].creative_authorized, false);
    assert.equal(creatives[0].identity_type, "TT_USER");
    assert.deepEqual(creatives[0].image_ids, ["img_hero_1"]);
    assert.equal(creatives[0].video_id, "video_1");
    assert.equal(mock.calls[0].body.operation_status, "DISABLE");
    assert.equal(mock.calls[1].body.operation_status, "DISABLE");
  });

  it("logs outgoing /ad/create/ identity fields immediately before the write", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient();
    const draft = launchableDraft();
    draft.accountSetup.identityType = "BC_AUTH_TT";
    draft.accountSetup.identityDisplayName = "Ironworks";
    draft.accountSetup.identityBcId = "7629750024332378128";

    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      await createTikTokAd({
        ...BASE_CONTEXT,
        supabase: db as unknown as SupabaseClient,
        request: mock.tiktokPost,
        adGroupId: "adgroup_1",
        draft,
        creative: draft.creatives.items[0],
      });
    } finally {
      console.error = original;
    }

    const line = errors.find((entry) =>
      entry.includes("[tiktok/ad-create] outgoing identity fields"),
    );
    assert.ok(line, "expected identity payload log");
    const logged = tikTokAdCreateIdentityLog(mock.calls[0].body);
    assert.equal(logged.creatives[0].identity_type, "BC_AUTH_TT");
    assert.equal(
      logged.creatives[0].identity_authorized_bc_id,
      "7629750024332378128",
    );
    assert.equal(logged.creatives[0].identity_bc_id, null);
    assert.equal(logged.creatives[0].video_id, "video_1");
    assert.deepEqual(logged.creatives[0].image_ids, ["img_hero_1"]);
    assert.match(line, /identity_authorized_bc_id/);
    assert.match(line, /7629750024332378128/);
    assert.match(line, /"identity_type":"BC_AUTH_TT"/);
    assert.match(line, /"video_id":"video_1"/);
    assert.match(line, /"image_ids":\["img_hero_1"\]/);
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

  it("blocks a video creative with no cover image before any TikTok write", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient();
    const draft = launchableDraft();
    delete (draft.creatives.items[0] as { coverImageId?: string | null }).coverImageId;
    draft.creatives.items[0].thumbnailUrl = null;

    await assert.rejects(
      launchTikTokDraftState(
        {
          ...BASE_CONTEXT,
          supabase: db as unknown as SupabaseClient,
          request: mock.tiktokPost,
        },
        draft,
      ),
      /Hero/,
    );
    assert.equal(mock.calls.length, 0);
  });

  it("blocks BC_AUTH_TT without a Business Center id before any TikTok write", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient();
    const draft = launchableDraft();
    draft.accountSetup.identityType = "BC_AUTH_TT";
    draft.accountSetup.identityDisplayName = "Ironworks";
    draft.accountSetup.identityBcId = null;

    await assert.rejects(
      launchTikTokDraftState(
        {
          ...BASE_CONTEXT,
          supabase: db as unknown as SupabaseClient,
          request: mock.tiktokPost,
        },
        draft,
      ),
      /Ironworks/,
    );
    assert.equal(mock.calls.length, 0);
  });

  it("launches BC_AUTH_TT when identity_authorized_bc_id is resolved", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient();
    const draft = launchableDraft();
    draft.accountSetup.identityType = "BC_AUTH_TT";
    draft.accountSetup.identityDisplayName = "Ironworks";
    draft.accountSetup.identityBcId = "7078123456789012345";

    const out = await launchTikTokDraftState(
      {
        ...BASE_CONTEXT,
        supabase: db as unknown as SupabaseClient,
        request: mock.tiktokPost,
      },
      draft,
    );
    assert.equal(out.campaign_id, "campaign_mock_1");
    const ad = mock.calls.find((call) => call.path === "/ad/create/");
    assert.ok(ad);
    const creatives = ad.body.creatives as Array<Record<string, unknown>>;
    assert.equal(creatives[0].identity_type, "BC_AUTH_TT");
    assert.equal(creatives[0].identity_authorized_bc_id, "7078123456789012345");
    assert.equal(creatives[0].identity_bc_id, undefined);
  });

  it("blocks a GBP daily budget below 50 before any TikTok write and allows 50", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient();
    const draft = launchableDraft();
    draft.budgetSchedule.budgetAmount = 25;
    draft.budgetSchedule.adGroups[0].budget = 25;

    await assert.rejects(
      launchTikTokDraftState(
        {
          ...BASE_CONTEXT,
          supabase: db as unknown as SupabaseClient,
          request: mock.tiktokPost,
        },
        draft,
      ),
      /GBP/,
    );
    assert.equal(mock.calls.length, 0);

    const allowed = launchableDraft();
    allowed.budgetSchedule.budgetAmount = 50;
    allowed.budgetSchedule.adGroups[0].budget = 50;
    const out = await launchTikTokDraftState(
      {
        ...BASE_CONTEXT,
        supabase: db as unknown as SupabaseClient,
        request: mock.tiktokPost,
      },
      allowed,
    );
    assert.equal(out.campaign_id, "campaign_mock_1");
    assert.ok(mock.calls.length > 0);
  });

  it("blocks a taken campaign name in preflight before any TikTok write", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient();
    const draft = launchableDraft();
    draft.campaignSetup.campaignName = "[IRW0001] Jamie Jones -sig";

    await assert.rejects(
      launchTikTokDraftState(
        {
          ...BASE_CONTEXT,
          supabase: db as unknown as SupabaseClient,
          request: mock.tiktokPost,
          existingCampaignNames: ["[IRW0001] Jamie Jones -sig"],
        },
        draft,
      ),
      /Step 2/,
    );
    assert.equal(mock.calls.length, 0);
  });

  it("blocks CONVERSIONS + ON_WEB_REGISTER or CONTACT before any TikTok write", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    for (const event of ["ON_WEB_REGISTER", "CONTACT"] as const) {
      const db = new MemorySupabase();
      const mock = createMockTikTokClient();
      const draft = launchableDraft();
      draft.campaignSetup.objective = "CONVERSIONS";
      draft.campaignSetup.optimisationGoal = "CONVERSION";
      draft.accountSetup.pixelId = "px-1";
      draft.accountSetup.optimisationEvent = event;

      await assert.rejects(
        launchTikTokDraftState(
          {
            ...BASE_CONTEXT,
            supabase: db as unknown as SupabaseClient,
            request: mock.tiktokPost,
          },
          draft,
        ),
        /Ads Manager|no longer supported/,
      );
      assert.equal(mock.calls.length, 0, event);
    }
  });

  it("launches CONVERSIONS with a non-denied optimisation event", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient();
    const draft = launchableDraft();
    draft.campaignSetup.objective = "CONVERSIONS";
    draft.campaignSetup.optimisationGoal = "CONVERSION";
    draft.accountSetup.pixelId = "px-1";
    draft.accountSetup.optimisationEvent = "FORM";

    const out = await launchTikTokDraftState(
      {
        ...BASE_CONTEXT,
        supabase: db as unknown as SupabaseClient,
        request: mock.tiktokPost,
      },
      draft,
    );
    assert.equal(out.campaign_id, "campaign_mock_1");
    assert.ok(mock.calls.length > 0);
    const adGroup = mock.calls.find((call) => call.path === "/adgroup/create/");
    assert.ok(adGroup);
    assert.equal(adGroup.body.optimization_event, "FORM");
  });

  it("sends each ad group's own name on /adgroup/create/", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient();
    const draft = launchableDraft();
    const names = ["Prospecting UK", "Retargeting", "Lookalike EU"];
    draft.budgetSchedule.adGroups = names.map((name, index) => ({
      id: `ag-${index + 1}`,
      name,
      budget: 50,
      startAt: null,
      endAt: null,
    }));
    draft.creativeAssignments.byAdGroupId = {
      "ag-1": ["creative-1"],
      "ag-2": ["creative-1"],
      "ag-3": ["creative-1"],
    };

    const out = await launchTikTokDraftState(
      {
        ...BASE_CONTEXT,
        supabase: db as unknown as SupabaseClient,
        request: mock.tiktokPost,
      },
      draft,
    );
    assert.equal(out.adgroup_ids.length, 3);
    const adGroupNames = mock.calls
      .filter((call) => call.path === "/adgroup/create/")
      .map((call) => call.body.adgroup_name);
    assert.deepEqual(adGroupNames, names);
  });

  it("blocks Smart+ in preflight before any TikTok write", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient();
    const draft = launchableDraft();
    draft.optimisation.smartPlusEnabled = true;

    await assert.rejects(
      launchTikTokDraftState(
        {
          ...BASE_CONTEXT,
          supabase: db as unknown as SupabaseClient,
          request: mock.tiktokPost,
        },
        draft,
      ),
      /Smart\+ campaigns generate their own creative/,
    );
    assert.equal(mock.calls.length, 0);
  });

  it("attempts campaign cleanup after a mid-flight ad failure", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient({
      failAlways: {
        "/ad/create/": new TikTokApiError("ad invalid", 40000, "req-ad", 400),
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
      /ad invalid/,
    );

    assert.deepEqual(
      mock.calls.map((call) => call.path),
      ["/campaign/create/", "/adgroup/create/", "/ad/create/", "/campaign/delete/"],
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

  it("clears the idempotency ledger on rollback so retry creates a new campaign", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const db = new MemorySupabase();
    const mock = createMockTikTokClient({
      failOnce: {
        "/ad/create/": new TikTokApiError("ad invalid", 40000, "req-ad", 400),
      },
    });
    const args = {
      ...BASE_CONTEXT,
      supabase: db as unknown as SupabaseClient,
      request: mock.tiktokPost,
    };
    const draft = launchableDraft();

    await assert.rejects(launchTikTokDraftState(args, draft), /ad invalid/);
    assert.equal(db.rows.length, 0);
    assert.deepEqual(
      mock.calls.map((call) => call.path),
      ["/campaign/create/", "/adgroup/create/", "/ad/create/", "/campaign/delete/"],
    );

    const out = await launchTikTokDraftState(args, draft);
    assert.equal(out.campaign_id, "campaign_mock_2");
    assert.notEqual(out.campaign_id, "campaign_mock_1");
    assert.deepEqual(
      mock.calls.map((call) => call.path),
      [
        "/campaign/create/",
        "/adgroup/create/",
        "/ad/create/",
        "/campaign/delete/",
        "/campaign/create/",
        "/adgroup/create/",
        "/ad/create/",
      ],
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
  draft.accountSetup.identityType = "TT_USER";
  draft.accountSetup.currency = "GBP";
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
      coverImageId: "img_hero_1",
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
