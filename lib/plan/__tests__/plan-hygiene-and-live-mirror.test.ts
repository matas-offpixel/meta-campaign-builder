import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import type { Asset, CampaignDraft } from "../../types.ts";
import {
  CANNOT_REGISTER_REASON,
  backfillHistoricalMetaAssets,
  collectBackfillCandidates,
  countUnregisteredMetaAssets,
  formatBackfillSummary,
  stampRegistryIdsOnDraft,
  storageRefFromUrl,
} from "../asset-backfill.ts";
import { extractMetaDraftAssetRefs } from "../asset-routing.ts";
import {
  ARCHIVE_PLAN_CONFIRM,
  DELETE_PLAN_CONFIRM,
  planChildRowsAllowHardDelete,
  planDisposalAction,
} from "../delete-policy.ts";
import { mergeDerivedGoogleKeywords } from "../derive/google.ts";
import { mergeDerivedTikTokInterests } from "../derive/tiktok.ts";
import { archiveCampaignPlan, deleteCampaignPlan } from "../dispose.ts";
import {
  diffNewAssetIds,
  formatMetaStaleChip,
  isDerivedStale,
} from "../live-mirror.ts";
import { shouldPersistPlanOnChange } from "../persist-policy.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlanLaunches } from "../types.ts";

function idleLaunches(): CampaignPlanLaunches {
  return {
    meta: { ...IDLE_PLAN_LAUNCH },
    tiktok: { ...IDLE_PLAN_LAUNCH },
    google: { ...IDLE_PLAN_LAUNCH },
  };
}

describe("plans are not created by navigation", () => {
  it("does not persist when the operator has not edited", () => {
    assert.equal(shouldPersistPlanOnChange({ hasUserEdit: false, eventId: "e1" }), false);
    assert.equal(shouldPersistPlanOnChange({ hasUserEdit: true, eventId: "" }), false);
    assert.equal(shouldPersistPlanOnChange({ hasUserEdit: true, eventId: "e1" }), true);
  });

  it("workspace persist effect is gated on first edit (falsifies persist-on-mount)", () => {
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(workspace, /shouldPersistPlanOnChange/);
    assert.match(workspace, /hasUserEdit/);
    assert.match(workspace, /isNew/);
    assert.doesNotMatch(
      workspace,
      /useEffect\(\(\) => \{\s*if \(!plan\.intent\.eventId\) return;/,
      "the old persist-on-every-plan-change effect is gone",
    );
  });
});

describe("delete gating by child-row state", () => {
  it("hard-deletes only while every child is idle or absent", () => {
    assert.equal(planChildRowsAllowHardDelete(idleLaunches()), true);
    assert.equal(
      planChildRowsAllowHardDelete({
        ...idleLaunches(),
        meta: { ...IDLE_PLAN_LAUNCH, draftId: "d1" },
      }),
      true,
      "prepared-but-idle drafts are still deletable",
    );
    assert.equal(
      planDisposalAction({
        ...idleLaunches(),
        tiktok: { status: "live", platformCampaignId: "tt", draftId: "d2", error: null },
      }),
      "archive",
    );
    assert.equal(
      planDisposalAction({
        ...idleLaunches(),
        google: { status: "failed", platformCampaignId: null, draftId: "g1", error: "x" },
      }),
      "archive",
    );
  });

  it("delete touches campaign_plans only — never campaign_drafts", async () => {
    const db = disposeDb({});
    const result = await deleteCampaignPlan(db, "plan-1", "user-1");
    assert.equal(result.ok, true);
    assert.ok(db.touched.includes("delete:campaign_plans"));
    assert.equal(
      db.touched.some((entry) => entry.includes("campaign_drafts")),
      false,
    );
  });

  it("refuses hard-delete once a child has launched and archive only updates the plan", async () => {
    const db = disposeDb({
      meta: { status: "live", platform_campaign_id: "120", draft_id: "d1" },
    });
    const denied = await deleteCampaignPlan(db, "plan-1", "user-1");
    assert.equal(denied.ok, false);
    if (denied.ok === false) assert.equal(denied.action, "archive");
    assert.equal(
      db.touched.includes("delete:campaign_plans"),
      false,
    );
    const archived = await archiveCampaignPlan(db, "plan-1", "user-1");
    assert.equal(archived.ok, true);
    assert.ok(db.touched.includes("update:campaign_plans"));
    assert.equal(
      db.touched.some((entry) => entry.includes("campaign_drafts")),
      false,
    );
  });

  it("list and plan page confirm before delete or archive", () => {
    const action = readFileSync("components/plan/plan-delete-action.tsx", "utf8");
    assert.doesNotMatch(action, /window\.confirm/);
    assert.match(action, /Dialog/);
    assert.match(action, /DialogDescription/);
    assert.match(action, /DELETE_PLAN_CONFIRM|ARCHIVE_PLAN_CONFIRM/);
    assert.match(DELETE_PLAN_CONFIRM, /removes the plan only/);
    assert.match(DELETE_PLAN_CONFIRM, /drafts and launched campaigns untouched/);
    assert.match(ARCHIVE_PLAN_CONFIRM, /drafts and launched campaigns untouched/);
    const list = readFileSync("app/(dashboard)/plans/page.tsx", "utf8");
    const rows = readFileSync("components/library/library-rows.tsx", "utf8");
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(`${list}\n${rows}`, /PlanDeleteAction/);
    assert.match(workspace, /PlanDeleteAction/);
  });
});

describe("historical asset backfill", () => {
  it("parses storage object URLs and refuses CDN guesses", () => {
    assert.deepEqual(
      storageRefFromUrl(
        "https://proj.supabase.co/storage/v1/object/public/campaign-assets/videos/aa.mp4",
      ),
      { bucket: "campaign-assets", path: "videos/aa.mp4" },
    );
    assert.equal(storageRefFromUrl("https://scontent.xx.fbcdn.net/v/t1.jpg"), null);
  });

  it("registers reachable DOD assets, is honest on missing bytes, and is idempotent", async () => {
    const draft = dodShapedDraft();
    const bytes = new Map<string, Uint8Array>([
      ["images/dod-feed.jpg", new TextEncoder().encode("dod-feed-bytes")],
      ["videos/dod-vert.mp4", new TextEncoder().encode("dod-vert-bytes")],
    ]);
    const db = backfillDb([
      {
        id: "already-1",
        user_id: "user-1",
        content_hash: "pre",
        byte_size: 4,
        filename: "already.mp4",
        media_kind: "video",
        aspect_ratio: "9:16",
        duration_seconds: 12,
        storage_bucket: "campaign-assets",
        storage_path: "videos/already.mp4",
        thumbnail_url: null,
        created_at: "2026-08-01T00:00:00.000Z",
      },
    ], [
      {
        asset_id: "already-1",
        user_id: "user-1",
        channel: "meta",
        scope: "act_dod",
        platform_id: "vid-already",
      },
    ]);

    const first = await backfillHistoricalMetaAssets({
      supabase: db,
      userId: "user-1",
      draft,
      storage: {
        download: async (_bucket, path) => bytes.get(path) ?? null,
      },
    });

    assert.equal(first.registered, 2, "4:5 image + 9:16 video with bytes");
    assert.equal(first.alreadyRegistered, 1, "channel-id hit");
    assert.equal(first.cannotRegister, 1, "1:1 image with Meta CDN only");
    assert.equal(
      first.rows.find((row) => row.platformId === "hash-square")?.reason,
      CANNOT_REGISTER_REASON,
    );
    assert.equal(first.rows.filter((row) => row.status === "registered").length, 2);
    assert.equal(
      first.draft.creatives.some((creative) =>
        creative.assetVariations.some((variation) =>
          variation.assets.some((asset) => asset.registryAssetId),
        ),
      ),
      true,
    );

    const second = await backfillHistoricalMetaAssets({
      supabase: db,
      userId: "user-1",
      draft: first.draft,
      storage: {
        download: async (_bucket, path) => bytes.get(path) ?? null,
      },
    });
    assert.equal(second.registered, 0, "second run registers nothing");
    assert.equal(second.alreadyRegistered, 3);
    assert.equal(second.cannotRegister, 1);
  });

  it("counts unregistered refs for the explicit Register N action", () => {
    const refs = extractMetaDraftAssetRefs(dodShapedDraft());
    assert.equal(refs.length, 4);
    assert.equal(countUnregisteredMetaAssets(refs), 4);
    const stamped = stampRegistryIdsOnDraft(
      dodShapedDraft(),
      new Map([["hash-feed", "a1"], ["vid-vert", "a2"]]),
    );
    assert.equal(countUnregisteredMetaAssets(extractMetaDraftAssetRefs(stamped)), 2);
    assert.equal(collectBackfillCandidates(dodShapedDraft()).length, 4);
  });

  it("matrix shows a one-line summary and cannot-register reasons after backfill", () => {
    assert.equal(
      formatBackfillSummary({ registered: 2, alreadyRegistered: 1, cannotRegister: 1 }),
      "2 registered · 1 already · 1 cannot register",
    );
    const route = readFileSync("app/api/plan/[id]/asset-backfill/route.ts", "utf8");
    assert.match(route, /alreadyRegistered/);
    assert.match(route, /cannotRegister/);
  });
});

describe("M.3 live mirror", () => {
  it("shows the staleness chip when Meta updated_at advances and clears after re-derive", () => {
    const meta = "2026-08-26T15:00:00.000Z";
    const derived = "2026-08-26T12:00:00.000Z";
    assert.equal(isDerivedStale(meta, derived), true);
    const chip = formatMetaStaleChip({
      metaUpdatedAt: meta,
      lastDerivedAt: derived,
      now: new Date("2026-08-26T16:00:00.000Z"),
    });
    assert.equal(chip, "Meta changed 1 hour ago after last derivation — Re-derive");

    const tiktok = mergeDerivedTikTokInterests(
      createDefaultTikTokDraft("tt"),
      [],
      "2026-08-26T16:00:00.000Z",
    );
    assert.equal(tiktok.draft.lastDerivedAt, "2026-08-26T16:00:00.000Z");
    assert.equal(isDerivedStale(meta, tiktok.draft.lastDerivedAt), false);
    assert.equal(
      formatMetaStaleChip({
        metaUpdatedAt: meta,
        lastDerivedAt: tiktok.draft.lastDerivedAt,
        now: new Date("2026-08-26T16:00:00.000Z"),
      }),
      null,
    );

    const google = mergeDerivedGoogleKeywords(emptyGoogleTree(), []);
    assert.ok(google.lastDerivedAt);
    assert.equal(isDerivedStale(meta, "2026-08-26T16:00:00.000Z"), false);
  });

  it("marks assets new only after the first visit snapshot", () => {
    const first = diffNewAssetIds(["a", "b"], null);
    assert.deepEqual(first.newIds, []);
    const second = diffNewAssetIds(["a", "b", "c"], first.nextSeen);
    assert.deepEqual(second.newIds, ["c"]);
    const third = diffNewAssetIds(["a", "b", "c"], second.nextSeen);
    assert.deepEqual(third.newIds, []);
  });

  it("workspace refreshes on focus, never polls, and never auto-derives", () => {
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    const assets = readFileSync("components/plan/canvas-assets.tsx", "utf8");
    assert.match(workspace, /refreshMirror/);
    assert.match(workspace, /addEventListener\("focus"/);
    assert.match(workspace, /visibilitychange/);
    assert.doesNotMatch(workspace, /setInterval/);
    assert.doesNotMatch(assets, /setInterval/);
    assert.match(workspace, /staleChip/);
    assert.match(workspace, /onRederive/);
    assert.doesNotMatch(workspace, /auto-deriv|autoderiv|void rederive\((["'])tiktok/);
  });
});

function disposeDb(launches: {
  meta?: Record<string, unknown>;
  tiktok?: Record<string, unknown>;
  google?: Record<string, unknown>;
}) {
  const touched: string[] = [];
  return {
    touched,
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => {
                  touched.push(`select:${table}`);
                  const data =
                    table === "campaign_plan_meta_launch"
                      ? (launches.meta ?? null)
                      : table === "campaign_plan_tiktok_launch"
                        ? (launches.tiktok ?? null)
                        : table === "campaign_plan_google_launch"
                          ? (launches.google ?? null)
                          : null;
                  return { data, error: null };
                },
              };
            },
          };
        },
        delete() {
          return {
            eq() {
              return {
                eq: async () => {
                  touched.push(`delete:${table}`);
                  return { error: null };
                },
              };
            },
          };
        },
        update() {
          return {
            eq() {
              return {
                eq: async () => {
                  touched.push(`update:${table}`);
                  return { error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

function backfillDb(
  assets: Record<string, unknown>[],
  channels: Record<string, unknown>[],
) {
  const assetRows = [...assets];
  const channelRows = [...channels];
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const chain = {
        select() {
          return chain;
        },
        eq(col: string, value: unknown) {
          filters.push([col, value]);
          return chain;
        },
        maybeSingle: async () => {
          const rows = rowsFor(table).filter((row) =>
            filters.every(([col, value]) => row[col] === value),
          );
          return { data: rows[0] ?? null, error: null };
        },
        upsert(row: Record<string, unknown>) {
          if (table === "creative_assets") {
            const existing = assetRows.find(
              (item) =>
                item.user_id === row.user_id &&
                item.content_hash === row.content_hash &&
                item.byte_size === row.byte_size,
            );
            if (existing) {
              return {
                select: () => ({
                  maybeSingle: async () => ({ data: existing, error: null }),
                }),
              };
            }
            const created = { ...row, id: row.id ?? crypto.randomUUID(), created_at: "2026-08-26T00:00:00.000Z" };
            assetRows.push(created);
            return {
              select: () => ({
                maybeSingle: async () => ({ data: created, error: null }),
              }),
            };
          }
          if (table === "creative_asset_channel_ids") {
            channelRows.push(row);
          }
          return {
            select: () => ({
              maybeSingle: async () => ({ data: row, error: null }),
            }),
          };
        },
      };
      return chain;
    },
  };

  function rowsFor(table: string): Record<string, unknown>[] {
    if (table === "creative_assets") return assetRows;
    if (table === "creative_asset_channel_ids") return channelRows;
    return [];
  }
}

function dodShapedDraft(): CampaignDraft {
  const feed: Asset = {
    id: "feed",
    aspectRatio: "4:5",
    uploadStatus: "uploaded",
    assetHash: "hash-feed",
    storagePath: "images/dod-feed.jpg",
    storageBucket: "campaign-assets",
    uploadedUrl:
      "https://proj.supabase.co/storage/v1/object/public/campaign-assets/images/dod-feed.jpg",
  };
  const vert: Asset = {
    id: "vert",
    aspectRatio: "9:16",
    uploadStatus: "uploaded",
    videoId: "vid-vert",
    storagePath: "videos/dod-vert.mp4",
    storageBucket: "campaign-assets",
  };
  const square: Asset = {
    id: "square",
    aspectRatio: "1:1",
    uploadStatus: "uploaded",
    assetHash: "hash-square",
    uploadedUrl: "https://scontent.xx.fbcdn.net/v/t1/dod.jpg",
  };
  const already: Asset = {
    id: "already",
    aspectRatio: "9:16",
    uploadStatus: "uploaded",
    videoId: "vid-already",
  };
  return {
    id: "dod-meta",
    status: "draft",
    settings: {
      campaignName: "DOD Kayode",
      adAccountId: "act_dod",
      clientId: null,
      eventId: null,
      pageId: null,
      instagramAccountId: null,
      pixelId: null,
      objective: "OUTCOME_TRAFFIC",
      optimisationGoal: "LINK_CLICKS",
      buyingType: "AUCTION",
      specialAdCategories: [],
    },
    audiences: {
      locations: [],
      ageMin: 18,
      ageMax: 65,
      genders: [],
      languages: [],
      interestGroups: [],
      customAudienceIds: [],
      savedAudienceId: null,
    },
    creatives: [
      creative("c-feed", "image", "DOD feed 4:5", [feed]),
      creative("c-vert", "video", "DOD vertical 9:16", [vert]),
      creative("c-square", "image", "DOD square 1:1", [square]),
      creative("c-already", "video", "DOD already registered", [already]),
    ],
    optimisationStrategy: { rules: [], guardrails: [] },
    budgetSchedule: {
      budgetType: "DAILY",
      dailyBudget: 40,
      startDate: null,
      endDate: null,
    },
    adSetSuggestions: [],
    creativeAssignments: {},
    createdAt: "2026-08-26T12:00:00.000Z",
    updatedAt: "2026-08-26T12:00:00.000Z",
  } as unknown as CampaignDraft;
}

function creative(
  id: string,
  mediaType: "image" | "video",
  name: string,
  assets: Asset[],
) {
  return {
    id,
    name,
    sourceType: "upload",
    identity: { pageId: "p", instagramAccountId: "", instagramActorId: "" },
    mediaType,
    assetMode: "dual",
    assetVariations: [{ id: `${id}-v`, name: name, assets }],
    captions: [{ id: "cap", text: "DOD" }],
    headline: "",
    description: "",
    destinationUrl: "https://tickets.example.com/dod",
    cta: "LEARN_MORE",
    enhancements: {
      enabled: false,
      textOptimizations: false,
      visualEnhancements: false,
      musicEnhancements: false,
      autoVariations: false,
    },
  };
}

function emptyGoogleTree() {
  return {
    plan: {
      id: "g1",
      user_id: "user-1",
      event_id: null,
      google_ads_account_id: null,
      name: "DOD",
      status: "draft" as const,
      total_budget: null,
      bidding_strategy: "maximize_clicks" as const,
      structure_mode: "single_campaign" as const,
      geo_targets: [],
      geo_target_type: "PRESENCE" as const,
      date_range: null,
      pushed_at: null,
      created_at: "2026-08-26T12:00:00.000Z",
      updated_at: "2026-08-26T12:00:00.000Z",
    },
    campaigns: [
      {
        id: "c1",
        plan_id: "g1",
        name: "DOD",
        priority: null,
        monthly_budget: null,
        daily_budget: null,
        bid_adjustments: {},
        notes: null,
        sort_order: 0,
        pushed_resource_name: null,
        created_at: "2026-08-26T12:00:00.000Z",
        ad_groups: [
          {
            id: "ag1",
            campaign_id: "c1",
            name: "Group",
            default_cpc: null,
            sort_order: 0,
            pushed_resource_name: null,
            keywords: [],
            rsas: [],
            created_at: "2026-08-26T12:00:00.000Z",
          },
        ],
        negatives: [],
      },
    ],
    plan_negatives: [],
    sitelinks: [],
  };
}
