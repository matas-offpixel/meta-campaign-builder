/**
 * Book now in a placement-customised (Dual / Full) creative.
 *
 * Meta rejects BOOK_NOW in `asset_feed_spec.call_to_action_types` (subcode
 * 1885396). BOOK_TRAVEL is accepted and Ads Manager shows it as button
 * "Book now", Main destination "Website" (ad 120252046313680755). The link
 * labels copy the shape Ads Manager saves (creative 1141391478840165).
 *
 * Single-asset Book now keeps BOOK_NOW in link_data / video_data: the
 * fixture `single-book-now-main.json` is main's output at 4a9159b.
 *
 * Run: node --test.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  BUY_TICKETS_FACEBOOK_EVENT_WARNING,
  buildCreativePayload,
  creativeBuyTicketsShowsAsFacebookEvent,
  mapCTAToAssetFeed,
} from "../creative.ts";
import { createDefaultCreative, createDefaultDraft, defaultCtaForObjective } from "../../campaign-defaults.ts";
import { validateStep } from "../../validation.ts";
import type { AdCreativeDraft, Asset, CTAType } from "../../types.ts";

const ORIG_FLAG = process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
afterEach(() => {
  if (ORIG_FLAG === undefined) delete process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
  else process.env.ENABLE_MULTI_PLACEMENT_ASSETS = ORIG_FLAG;
});

const enhancementsOff = {
  enabled: false,
  textOptimizations: false,
  visualEnhancements: false,
  musicEnhancements: false,
  autoVariations: false,
} as const;

function creative(over: Partial<AdCreativeDraft>): AdCreativeDraft {
  return {
    id: "cr_snap",
    name: "Snap Creative",
    sourceType: "new",
    mediaType: "image",
    assetMode: "single",
    identity: { pageId: "pg_123", instagramAccountId: "" },
    assetVariations: [{ id: "v1", name: "Variation 1", assets: [] }],
    captions: [{ id: "cap_1", text: "Come see us live" }],
    headline: "Rudimental",
    description: "Newcastle",
    destinationUrl: "https://example.com/tickets",
    cta: "book_now",
    enhancements: enhancementsOff,
    ...over,
  };
}

function withAssets(over: Partial<AdCreativeDraft>, assets: Asset[]): AdCreativeDraft {
  return creative({ ...over, assetVariations: [{ id: "v1", name: "Variation 1", assets }] });
}

const img = (ratio: Asset["aspectRatio"], hash: string): Asset => ({
  id: `a_${ratio}`,
  aspectRatio: ratio,
  uploadStatus: "uploaded",
  assetHash: hash,
});
const vid = (ratio: Asset["aspectRatio"], id: string): Asset => ({
  id: `a_${ratio}`,
  aspectRatio: ratio,
  uploadStatus: "uploaded",
  videoId: id,
  thumbnailUrl: `https://cdn/${id}.jpg`,
});

const URL_TAGS =
  "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{adset.id}}&utm_term={{ad.id}}";

const STORIES_REELS = {
  publisher_platforms: ["facebook", "instagram"],
  facebook_positions: ["story", "facebook_reels"],
  instagram_positions: ["story", "reels"],
};

const COPY = {
  bodies: [{ text: "Come see us live" }],
  link_urls: [
    {
      website_url: "https://example.com/tickets",
      display_url: "",
      adlabels: [{ name: "story_link" }, { name: "feed_link" }],
    },
  ],
  call_to_action_types: ["BOOK_TRAVEL"],
  optimization_type: "PLACEMENT",
  titles: [{ text: "Rudimental" }],
  descriptions: [{ text: "Newcastle" }],
};

function imageSnapshot(feedHash: string, storyHash: string) {
  return {
    name: "Snap Creative",
    object_story_spec: { page_id: "pg_123" },
    asset_feed_spec: {
      ...COPY,
      ad_formats: ["SINGLE_IMAGE"],
      images: [
        { hash: feedHash, adlabels: [{ name: "feed_asset" }] },
        { hash: storyHash, adlabels: [{ name: "story_asset" }] },
      ],
      asset_customization_rules: [
        {
          customization_spec: STORIES_REELS,
          image_label: { name: "story_asset" },
          link_url_label: { name: "story_link" },
        },
        {
          customization_spec: {},
          image_label: { name: "feed_asset" },
          link_url_label: { name: "feed_link" },
        },
      ],
    },
    url_tags: URL_TAGS,
  };
}

function videoSnapshot(feedId: string, storyId: string) {
  return {
    name: "Snap Creative",
    object_story_spec: { page_id: "pg_123" },
    asset_feed_spec: {
      ...COPY,
      ad_formats: ["SINGLE_VIDEO"],
      videos: [
        { video_id: feedId, thumbnail_url: `https://cdn/${feedId}.jpg`, adlabels: [{ name: "feed_asset" }] },
        { video_id: storyId, thumbnail_url: `https://cdn/${storyId}.jpg`, adlabels: [{ name: "story_asset" }] },
      ],
      asset_customization_rules: [
        {
          customization_spec: STORIES_REELS,
          video_label: { name: "story_asset" },
          link_url_label: { name: "story_link" },
        },
        {
          customization_spec: {},
          video_label: { name: "feed_asset" },
          link_url_label: { name: "feed_link" },
        },
      ],
    },
    url_tags: URL_TAGS,
  };
}

describe("Book now in asset_feed_spec → BOOK_TRAVEL + link labels (payload snapshots)", () => {
  it("dual image", async () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const payload = await buildCreativePayload(
      withAssets({ assetMode: "dual" }, [img("4:5", "hash_45"), img("9:16", "hash_916")]),
    );
    assert.deepEqual(payload, imageSnapshot("hash_45", "hash_916"));
  });

  it("full image (4:5 is the Feed asset; 1:1 is not sent)", async () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const payload = await buildCreativePayload(
      withAssets({ assetMode: "full" }, [
        img("4:5", "hash_45"),
        img("9:16", "hash_916"),
        img("1:1", "hash_11"),
      ]),
    );
    assert.deepEqual(payload, imageSnapshot("hash_45", "hash_916"));
  });

  it("dual video", async () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const payload = await buildCreativePayload(
      withAssets({ assetMode: "dual", mediaType: "video" }, [vid("4:5", "vid_45"), vid("9:16", "vid_916")]),
    );
    assert.deepEqual(payload, videoSnapshot("vid_45", "vid_916"));
  });

  it("full video", async () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const payload = await buildCreativePayload(
      withAssets({ assetMode: "full", mediaType: "video" }, [
        vid("4:5", "vid_45"),
        vid("9:16", "vid_916"),
        vid("1:1", "vid_11"),
      ]),
    );
    assert.deepEqual(payload, videoSnapshot("vid_45", "vid_916"));
  });

  it("every other CTA keeps its own type in asset_feed_spec", () => {
    const cases: Array<[CTAType, string]> = [
      ["book_now", "BOOK_TRAVEL"],
      ["buy_tickets", "BUY_TICKETS"],
      ["sign_up", "SIGN_UP"],
      ["learn_more", "LEARN_MORE"],
    ];
    for (const [cta, type] of cases) assert.equal(mapCTAToAssetFeed(cta), type, cta);
  });
});

describe("Single-asset Book now is byte-identical to main", () => {
  it("image and video, flag on and off", async () => {
    const single = {
      image: withAssets({}, [img("9:16", "hash_916")]),
      video: withAssets({ mediaType: "video" }, [vid("9:16", "vid_916")]),
    };
    single.video.assetVariations[0].assets[0].thumbnailUrl = "https://cdn/thumb_916.jpg";
    const out: Record<string, unknown> = {};
    for (const flag of ["1", ""]) {
      if (flag) process.env.ENABLE_MULTI_PLACEMENT_ASSETS = flag;
      else delete process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
      out[`image_flag${flag || "off"}`] = await buildCreativePayload(single.image);
      out[`video_flag${flag || "off"}`] = await buildCreativePayload(single.video);
    }
    const main = readFileSync(join(import.meta.dirname, "fixtures/single-book-now-main.json"), "utf8");
    assert.equal(JSON.stringify(out, null, 2), main);
  });
});

describe("Buy tickets in asset_feed_spec warns, never blocks", () => {
  const dual = (cta: CTAType) =>
    withAssets({ assetMode: "dual", cta }, [img("4:5", "hash_45"), img("9:16", "hash_916")]);

  it("warns for buy_tickets in Dual and Full mode", () => {
    assert.equal(creativeBuyTicketsShowsAsFacebookEvent(dual("buy_tickets")), true);
    assert.equal(
      creativeBuyTicketsShowsAsFacebookEvent(creative({ assetMode: "full", cta: "buy_tickets" })),
      true,
    );
  });

  it("warns for buy_tickets with 2+ variations (rotation is also an asset_feed_spec)", () => {
    const c = creative({ cta: "buy_tickets" });
    c.assetVariations = [
      { id: "v1", name: "Variation 1", assets: [img("9:16", "h1")] },
      { id: "v2", name: "Variation 2", assets: [img("9:16", "h2")] },
    ];
    assert.equal(creativeBuyTicketsShowsAsFacebookEvent(c), true);
  });

  it("no warning for book_now, single-asset buy_tickets, or an existing post", () => {
    assert.equal(creativeBuyTicketsShowsAsFacebookEvent(dual("book_now")), false);
    assert.equal(
      creativeBuyTicketsShowsAsFacebookEvent(withAssets({ cta: "buy_tickets" }, [img("9:16", "h")])),
      false,
    );
    assert.equal(
      creativeBuyTicketsShowsAsFacebookEvent(
        creative({ assetMode: "dual", cta: "buy_tickets", sourceType: "existing_post" }),
      ),
      false,
    );
  });

  it("Dual mode passes the creatives step with book_now and with buy_tickets", () => {
    for (const cta of ["book_now", "buy_tickets"] as const) {
      const draft = createDefaultDraft();
      draft.creatives = [dual(cta)];
      assert.deepEqual(validateStep(4, draft), { valid: true, errors: [] }, cta);
    }
  });

  it("the creative step renders the warning text for buy_tickets + dual only", () => {
    const root = join(import.meta.dirname, "../../..");
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", join(import.meta.dirname, "render-buy-tickets-event-note.tsx")],
      { cwd: root, encoding: "utf8" },
    );
    const report = JSON.parse(out.trim().split("\n").pop()!) as Record<string, string>;
    assert.ok(report.buyTicketsDual.includes(BUY_TICKETS_FACEBOOK_EVENT_WARNING), report.buyTicketsDual);
    assert.ok(report.buyTicketsDual.includes('role="status"'), "a status, not an alert");
    assert.equal(report.bookNowDual, "");
    assert.equal(report.buyTicketsSingle, "");
  });
});

describe("Default CTA by objective", () => {
  it("sales objectives default to book_now", () => {
    assert.equal(defaultCtaForObjective("purchase"), "book_now");
    assert.equal(defaultCtaForObjective("initiate_checkout"), "book_now");
    assert.equal(createDefaultCreative("purchase").cta, "book_now");
  });

  it("registration defaults to sign_up", () => {
    assert.equal(defaultCtaForObjective("registration"), "sign_up");
    assert.equal(createDefaultCreative("registration").cta, "sign_up");
  });

  it("no objective keeps book_now", () => {
    assert.equal(createDefaultCreative().cta, "book_now");
  });
});
