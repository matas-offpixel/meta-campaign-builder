import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft, type TikTokCreativeDraft } from "../../types/tiktok-draft.ts";
import type { CampaignDraft } from "../../types.ts";
import {
  GOOGLE_NO_ASSETS_COPY,
  TIKTOK_IMAGE_UNSUPPORTED_REASON,
  TIKTOK_LAUNCHED_UNROUTE_NOTE,
  canRouteAssetToTikTok,
  defaultTikTokRoute,
  extractMetaDraftAssetRefs,
  mergeRoutedTikTokCreatives,
  registryProvenance,
  resolveTikTokRoute,
} from "../asset-routing.ts";
import { applyTikTokAssetRouting } from "../asset-routing-execute.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan } from "../types.ts";

function asset(partial: {
  id: string;
  mediaKind: "image" | "video";
  aspectRatio: "1:1" | "4:5" | "9:16" | "other";
  filename?: string;
}) {
  return {
    id: partial.id,
    userId: "user-1",
    contentHash: "abc",
    byteSize: 12,
    filename: partial.filename ?? `${partial.id}.bin`,
    mediaKind: partial.mediaKind,
    aspectRatio: partial.aspectRatio,
    durationSeconds: partial.mediaKind === "video" ? 15 : null,
    storageBucket: "campaign-assets",
    storagePath: `videos/${partial.id}.mp4`,
    thumbnailUrl: null,
    createdAt: "2026-08-26T12:00:00.000Z",
  };
}

describe("routing defaults matrix", () => {
  it("pre-ticks 9:16 and other-aspect video; images are off and disabled", () => {
    assert.deepEqual(defaultTikTokRoute({ mediaKind: "video", aspectRatio: "9:16" }), {
      enabled: true,
      disabled: false,
      disabledReason: null,
    });
    assert.deepEqual(defaultTikTokRoute({ mediaKind: "video", aspectRatio: "4:5" }), {
      enabled: true,
      disabled: false,
      disabledReason: null,
    });
    assert.deepEqual(defaultTikTokRoute({ mediaKind: "video", aspectRatio: "1:1" }), {
      enabled: true,
      disabled: false,
      disabledReason: null,
    });
    assert.deepEqual(defaultTikTokRoute({ mediaKind: "video", aspectRatio: "other" }), {
      enabled: true,
      disabled: false,
      disabledReason: null,
    });
    assert.deepEqual(defaultTikTokRoute({ mediaKind: "image", aspectRatio: "9:16" }), {
      enabled: false,
      disabled: true,
      disabledReason: TIKTOK_IMAGE_UNSUPPORTED_REASON,
    });
    assert.equal(canRouteAssetToTikTok({ mediaKind: "image" }), false);
    assert.equal(canRouteAssetToTikTok({ mediaKind: "video" }), true);
  });

  it("a saved enabled=true on an image is still forced off", () => {
    const resolved = resolveTikTokRoute(
      { mediaKind: "image", aspectRatio: "1:1" },
      {
        planId: "p1",
        assetId: "img-1",
        channel: "tiktok",
        enabled: true,
        uploadStatus: "idle",
        uploadError: null,
        derivedCreativeId: null,
      },
    );
    assert.equal(resolved.enabled, false);
    assert.equal(resolved.disabled, true);
    assert.equal(resolved.disabledReason, TIKTOK_IMAGE_UNSUPPORTED_REASON);
  });
});

describe("image-to-TikTok is impossible through any path", () => {
  it("execute refuses a forged enabled image and never calls upload", async () => {
    let uploads = 0;
    const plan = goldenPlan();
    const image = asset({ id: "img-1", mediaKind: "image", aspectRatio: "1:1", filename: "still.jpg" });
    const db = {
      async find() {
        return image;
      },
    };
    void db;
    const result = await applyTikTokAssetRouting({
      supabase: emptyRoutingDb([image], [
        {
          plan_id: plan.id,
          asset_id: image.id,
          user_id: plan.userId,
          channel: "tiktok",
          enabled: true,
          upload_status: "idle",
          upload_error: null,
          derived_creative_id: null,
        },
      ]),
      plan,
      metaDraft: metaDraftWithAsset({
        registryAssetId: image.id,
        mediaType: "image",
        hash: "hash_img",
        aspectRatio: "1:1",
      }),
      tiktokDraft: createDefaultTikTokDraft("tt-1"),
      advertiserId: "adv-1",
      token: "tok",
      launched: false,
      upload: async () => {
        uploads += 1;
        return { ok: true, videoId: "should-not-exist", durationSeconds: 1 };
      },
    });
    assert.equal(uploads, 0);
    assert.equal(
      result.cells.find((cell) => cell.assetId === image.id)?.reason,
      TIKTOK_IMAGE_UNSUPPORTED_REASON,
    );
    assert.equal(result.draft.creatives.items.length, 0);
  });
});

describe("mergeRoutedTikTokCreatives — #854 provenance", () => {
  it("adds one derived creative per routed video and keeps operator edits", () => {
    const draft = createDefaultTikTokDraft("tt-1");
    draft.creatives.items.push({
      id: "op-1",
      name: "Operator cut",
      mode: "VIDEO_REFERENCE",
      baseName: "Operator cut",
      videoId: "op_vid",
      videoUrl: null,
      thumbnailUrl: null,
      durationSeconds: 8,
      title: "op",
      sparkPostId: null,
      caption: "mine",
      adText: "mine",
      displayName: "",
      landingPageUrl: "https://example.com",
      cta: null,
      musicId: null,
    } satisfies TikTokCreativeDraft);

    const first = mergeRoutedTikTokCreatives({
      draft,
      routed: [
        {
          assetId: "a1",
          videoId: "tt_1",
          filename: "Parable 9x16.mp4",
          thumbnailUrl: null,
          durationSeconds: 12,
          adText: "From Meta caption",
          landingPageUrl: "https://tickets.example.com",
        },
      ],
      launched: false,
    });
    assert.equal(first.added, 1);
    assert.equal(first.keptOperatorItems, 1);
    const derived = first.draft.creatives.items.find((item) => item.derivedFrom === registryProvenance("a1"));
    assert.ok(derived);
    assert.equal(derived?.adText, "From Meta caption");
    assert.equal(derived?.videoId, "tt_1");

    derived!.adText = "edited in TikTok wizard";
    const second = mergeRoutedTikTokCreatives({
      draft: first.draft,
      routed: [
        {
          assetId: "a1",
          videoId: "tt_1",
          filename: "Parable 9x16.mp4",
          thumbnailUrl: null,
          durationSeconds: 12,
          adText: "From Meta caption",
          landingPageUrl: "https://tickets.example.com",
        },
      ],
      launched: false,
    });
    const again = second.draft.creatives.items.find((item) => item.derivedFrom === registryProvenance("a1"));
    assert.equal(again?.adText, "edited in TikTok wizard");
    assert.equal(second.added, 0);
    assert.equal(
      second.draft.creatives.items.find((item) => item.id === "op-1")?.adText,
      "mine",
    );
  });

  it("unrouting before launch removes the derived creative; after launch it stays", () => {
    const seeded = mergeRoutedTikTokCreatives({
      draft: createDefaultTikTokDraft("tt-1"),
      routed: [
        {
          assetId: "a1",
          videoId: "tt_1",
          filename: "a.mp4",
          thumbnailUrl: null,
          durationSeconds: 10,
          adText: "cap",
          landingPageUrl: "https://x",
        },
      ],
      launched: false,
    });
    const before = mergeRoutedTikTokCreatives({
      draft: seeded.draft,
      routed: [],
      launched: false,
    });
    assert.equal(before.removed, 1);
    assert.equal(before.draft.creatives.items.length, 0);

    const after = mergeRoutedTikTokCreatives({
      draft: seeded.draft,
      routed: [],
      launched: true,
    });
    assert.equal(after.removed, 0);
    assert.equal(after.skippedLaunched, 1);
    assert.equal(after.draft.creatives.items.length, 1);
  });
});

describe("channel-id hit is a no-op upload", () => {
  it("does not call TikTok when the advertiser already has this asset", async () => {
    let uploads = 0;
    const plan = goldenPlan();
    const video = asset({ id: "vid-1", mediaKind: "video", aspectRatio: "9:16", filename: "9x16.mp4" });
    const db = routingDbWithChannel(video, {
      userId: plan.userId,
      channel: "tiktok",
      scope: "adv-1",
      platformId: "already_there",
    });
    const result = await applyTikTokAssetRouting({
      supabase: db,
      plan,
      metaDraft: metaDraftWithAsset({
        registryAssetId: video.id,
        mediaType: "video",
        videoId: "meta_vid",
        aspectRatio: "9:16",
      }),
      tiktokDraft: createDefaultTikTokDraft("tt-1"),
      advertiserId: "adv-1",
      token: "tok",
      launched: false,
      upload: async () => {
        uploads += 1;
        return { ok: true, videoId: "new", durationSeconds: 9 };
      },
    });
    assert.equal(uploads, 0);
    assert.equal(result.cells[0]?.uploaded, false);
    assert.equal(result.cells[0]?.ok, true);
    assert.equal(result.draft.creatives.items[0]?.videoId, "already_there");
  });

  it("a failed upload marks that cell and still routes the sibling", async () => {
    const plan = goldenPlan();
    const a = asset({ id: "a", mediaKind: "video", aspectRatio: "9:16", filename: "a.mp4" });
    const b = asset({ id: "b", mediaKind: "video", aspectRatio: "4:5", filename: "b.mp4" });
    const result = await applyTikTokAssetRouting({
      supabase: emptyRoutingDb([a, b], []),
      plan,
      metaDraft: metaDraftWithAssets([
        { registryAssetId: a.id, mediaType: "video", videoId: "va", aspectRatio: "9:16" },
        { registryAssetId: b.id, mediaType: "video", videoId: "vb", aspectRatio: "4:5" },
      ]),
      tiktokDraft: createDefaultTikTokDraft("tt-1"),
      advertiserId: "adv-1",
      token: "tok",
      launched: false,
      upload: async ({ asset: row }) => {
        if (row.id === "a") return { ok: false, error: "TikTok 502" };
        return { ok: true, videoId: "ok_b", durationSeconds: 8 };
      },
    });
    assert.equal(result.cells.find((cell) => cell.assetId === "a")?.ok, false);
    assert.equal(result.cells.find((cell) => cell.assetId === "a")?.reason, "TikTok 502");
    assert.equal(result.cells.find((cell) => cell.assetId === "b")?.ok, true);
    assert.equal(result.draft.creatives.items.length, 1);
    assert.equal(result.draft.creatives.items[0]?.videoId, "ok_b");
  });
});

describe("extractMetaDraftAssetRefs", () => {
  it("dedupes the same Meta id across variations", () => {
    const refs = extractMetaDraftAssetRefs(
      metaDraftWithAssets([
        { registryAssetId: "a", mediaType: "video", videoId: "v1", aspectRatio: "9:16" },
        { registryAssetId: "a", mediaType: "video", videoId: "v1", aspectRatio: "9:16" },
      ]),
    );
    assert.equal(refs.length, 1);
  });
});

describe("plan page grep-guard still bans upload and targeting", () => {
  it("allows route toggles on the matrix and nothing else", () => {
    const files = [
      "components/plan/plan-workspace.tsx",
      "components/plan/asset-routing-matrix.tsx",
      "app/(dashboard)/plans/page.tsx",
      "app/(dashboard)/plan/[id]/page.tsx",
      "components/library/plan-library.tsx",
      "components/library/library-rows.tsx",
      "components/viz/overflow-menu.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /type=["']file["']/, `${file} has no upload`);
      assert.doesNotMatch(
        source,
        /AccountPicker|account-picker|AssetUpload|upload-asset/,
        `${file} has no account picker`,
      );
      assert.doesNotMatch(
        source,
        /InterestGroupsPanel|PageAudiencesPanel|CustomAudiencesPanel|SavedAudiencesPanel|useFetchPages|interest-search/,
        `${file} has no targeting UI`,
      );
    }
    const matrix = readFileSync("components/plan/asset-routing-matrix.tsx", "utf8");
    assert.match(matrix, /type=["']checkbox["']/);
    assert.match(matrix, /GOOGLE_NO_ASSETS_COPY|Search ads take no assets/);
    assert.match(matrix, /TIKTOK_LAUNCHED_UNROUTE_NOTE|already launched/);
    void GOOGLE_NO_ASSETS_COPY;
    void TIKTOK_LAUNCHED_UNROUTE_NOTE;
  });
});

function goldenPlan(): CampaignPlan {
  return {
    id: "plan-1",
    userId: "user-1",
    name: "Louder",
    status: "draft",
    intent: {
      eventId: "event-1",
      objectiveIntent: "registration",
      budget: { totalDaily: 40, metaDaily: 20, tiktokDaily: 20, googleDaily: 0 },
      destinationUrl: "https://tickets.example.com",
      audienceClusterRef: null,
      creativeSetRef: null,
      startDate: null,
      endDate: null,
      startTime: null,
      endTime: null,
    },
    launches: {
      meta: { ...IDLE_PLAN_LAUNCH, draftId: "meta-1" },
      tiktok: { ...IDLE_PLAN_LAUNCH, draftId: "tt-1" },
      google: { ...IDLE_PLAN_LAUNCH },
    },
    createdAt: "2026-08-26T12:00:00.000Z",
    updatedAt: "2026-08-26T12:00:00.000Z",
  };
}

function metaDraftWithAsset(input: {
  registryAssetId: string;
  mediaType: "image" | "video";
  hash?: string;
  videoId?: string;
  aspectRatio: "1:1" | "4:5" | "9:16";
}): CampaignDraft {
  return metaDraftWithAssets([input]);
}

function metaDraftWithAssets(
  items: Array<{
    registryAssetId: string;
    mediaType: "image" | "video";
    hash?: string;
    videoId?: string;
    aspectRatio: "1:1" | "4:5" | "9:16";
  }>,
): CampaignDraft {
  return {
    id: "meta-1",
    status: "draft",
    settings: {
      campaignName: "Louder",
      adAccountId: "act_1",
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
    creatives: items.map((item, index) => ({
      id: `c${index}`,
      name: `Creative ${index + 1}`,
      sourceType: "upload",
      identity: {
        pageId: "p",
        instagramAccountId: "",
        instagramActorId: "",
      },
      mediaType: item.mediaType,
      assetMode: "single",
      assetVariations: [
        {
          id: `v${index}`,
          name: "Variation 1",
          assets: [
            {
              id: `a${index}`,
              aspectRatio: item.aspectRatio,
              uploadStatus: "uploaded",
              assetHash: item.hash,
              videoId: item.videoId,
              registryAssetId: item.registryAssetId,
            },
          ],
        },
      ],
      captions: [{ id: "cap", text: "Meta caption" }],
      headline: "",
      description: "",
      destinationUrl: "https://tickets.example.com",
      cta: "LEARN_MORE",
      enhancements: {
        enabled: false,
        textOptimizations: false,
        visualEnhancements: false,
        musicEnhancements: false,
        autoVariations: false,
      },
    })),
    optimisationStrategy: { rules: [], guardrails: [] },
    budgetSchedule: {
      budgetType: "DAILY",
      dailyBudget: 20,
      startDate: null,
      endDate: null,
    },
    adSetSuggestions: [],
    creativeAssignments: {},
    createdAt: "2026-08-26T12:00:00.000Z",
    updatedAt: "2026-08-26T12:00:00.000Z",
  } as unknown as CampaignDraft;
}

function emptyRoutingDb(
  assets: ReturnType<typeof asset>[],
  routeRows: Record<string, unknown>[],
) {
  return routingDb(assets, routeRows, []);
}

function routingDbWithChannel(
  row: ReturnType<typeof asset>,
  channel: { userId: string; channel: string; scope: string; platformId: string },
) {
  return routingDb(
    [row],
    [],
    [
      {
        asset_id: row.id,
        user_id: channel.userId,
        channel: channel.channel,
        scope: channel.scope,
        platform_id: channel.platformId,
      },
    ],
  );
}

function routingDb(
  assets: ReturnType<typeof asset>[],
  routeRows: Record<string, unknown>[],
  channelRows: Record<string, unknown>[],
) {
  const assetMap = new Map(assets.map((row) => [row.id, toAssetRow(row)]));
  const routes = [...routeRows];
  const channels = [...channelRows];

  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const inFilters: Array<[string, unknown[]]> = [];
      const chain = {
        select() {
          return chain;
        },
        eq(col: string, value: unknown) {
          filters.push([col, value]);
          return chain;
        },
        in(col: string, values: unknown[]) {
          inFilters.push([col, values]);
          return chain;
        },
        maybeSingle: async () => {
          const rows = rowsFor(table).filter((row) =>
            filters.every(([col, value]) => row[col] === value),
          );
          return { data: rows[0] ?? null, error: null };
        },
        then(
          resolve: (value: {
            data: Record<string, unknown>[] | null;
            error: null;
          }) => void,
        ) {
          const rows = rowsFor(table).filter((row) => {
            const eqs = filters.every(([col, value]) => row[col] === value);
            const ins = inFilters.every(([col, values]) => values.includes(row[col]));
            return eqs && ins;
          });
          resolve({ data: rows, error: null });
        },
        upsert(row: Record<string, unknown>) {
          if (table === "campaign_plan_asset_routes") {
            const idx = routes.findIndex(
              (item) => item.plan_id === row.plan_id && item.asset_id === row.asset_id,
            );
            if (idx >= 0) routes[idx] = { ...routes[idx], ...row };
            else routes.push(row);
          }
          if (table === "creative_asset_channel_ids") {
            channels.push(row);
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
    if (table === "creative_assets") return [...assetMap.values()];
    if (table === "campaign_plan_asset_routes") return routes;
    if (table === "creative_asset_channel_ids") return channels;
    return [];
  }
}

function toAssetRow(row: ReturnType<typeof asset>): Record<string, unknown> {
  return {
    id: row.id,
    user_id: row.userId,
    content_hash: row.contentHash,
    byte_size: row.byteSize,
    filename: row.filename,
    media_kind: row.mediaKind,
    aspect_ratio: row.aspectRatio,
    duration_seconds: row.durationSeconds,
    storage_bucket: row.storageBucket,
    storage_path: row.storagePath,
    thumbnail_url: row.thumbnailUrl,
    created_at: row.createdAt,
  };
}
