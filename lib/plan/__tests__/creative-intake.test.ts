import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createDefaultCreative, createDefaultDraft } from "../../campaign-defaults.ts";
import {
  applyIntakeToMetaDraft,
  creativeDraftFingerprint,
  isUntouchedStarterCreative,
} from "../creative-intake-apply.ts";
import {
  bucketFromMeasurement,
  detectedBucketAfterRegister,
  intakeAspect,
  intakeCreativeFingerprint,
  intakeSendResultLine,
  intakeUploadProgress,
  intakeSendChanges,
  isIntakeUploadPath,
  matchAssetMode,
  matchRefusal,
  mayDeleteIntakeUpload,
  planIntakeSend,
  singleGroupKey,
  tiedStandardAspects,
  uploadIntakeSlots,
  type IntakeMetaUploadSlot,
  META_CROSS_PUBLISH_NOTE,
  META_LAUNCHED_UNROUTE_NOTE,
  META_LAUNCHED_UPDATE_NOTE,
  isMultiPlacementEnabled,
  type IntakeOwnedCreative,
  type IntakeSendAsset,
} from "../creative-intake.ts";
import { TIKTOK_LAUNCHED_UNROUTE_NOTE } from "../asset-routing.ts";

const image = (id: string, bucket: IntakeSendAsset["bucket"]): IntakeSendAsset => ({
  id,
  mediaKind: "image",
  bucket,
  groupId: null,
});
const video = (id: string, bucket: IntakeSendAsset["bucket"]): IntakeSendAsset => ({
  id,
  mediaKind: "video",
  bucket,
  groupId: null,
});

function stamp(key: string, creativeId: string, mode: "single" | "dual" | "full", assetIds: string[]): IntakeOwnedCreative {
  const fingerprint = intakeCreativeFingerprint({
    mode,
    assetIds,
    headline: "",
    description: "",
    caption: "",
    cta: "book_now",
    destinationUrl: "",
    pageId: "page-1",
    instagramActorId: "ig-1",
    name: "Creative",
  });
  return { key, creativeId, fingerprint, draftFingerprint: fingerprint };
}

describe("intake sort — pixels, then a filename only as a tiebreak", () => {
  it("1080×1350 → 4:5, 1080×1080 → 1:1, 1080×1920 → 9:16, 1920×1080 → other", () => {
    assert.equal(intakeAspect({ width: 1080, height: 1350, filename: "a.png" }).bucket, "4:5");
    assert.equal(intakeAspect({ width: 1080, height: 1080, filename: "a.png" }).bucket, "1:1");
    assert.equal(intakeAspect({ width: 1080, height: 1920, filename: "a.png" }).bucket, "9:16");
    const landscape = intakeAspect({ width: 1920, height: 1080, filename: "a.png" });
    assert.equal(landscape.bucket, "other");
    assert.equal(landscape.source, "pixels");
    assert.match(landscape.reason ?? "", /1920×1080/);
  });

  it("a filename hint loses to the measured pixels", () => {
    const sorted = intakeAspect({
      width: 1080,
      height: 1350,
      filename: "story-9x16-reel.mp4",
    });
    assert.equal(sorted.bucket, "4:5");
    assert.equal(sorted.source, "pixels");
    assert.equal(tiedStandardAspects(1080, 1350), null);
  });

  it("uses the filename only when the measurement cannot separate two ratios", () => {
    const tied = bucketFromMeasurement({
      width: 100,
      height: 100,
      snapped: "other",
      tied: ["4:5", "1:1"],
      filenameHint: "4:5",
    });
    assert.deepEqual(tied, { bucket: "4:5", source: "filename-tiebreak", reason: null });
    const pixelsWin = bucketFromMeasurement({
      width: 1080,
      height: 1350,
      snapped: "4:5",
      tied: ["4:5", "1:1"],
      filenameHint: "9:16",
    });
    assert.equal(pixelsWin.bucket, "4:5");
    assert.equal(pixelsWin.source, "pixels");
  });

  it("unreadable dimensions go to other and are not guessed from the filename", () => {
    for (const width of [null, 0, -1]) {
      const sorted = intakeAspect({ width, height: 1920, filename: "feed-4x5.png" });
      assert.equal(sorted.bucket, "other");
      assert.equal(sorted.source, "unreadable");
      assert.equal(sorted.reason, "Dimensions could not be read");
    }
  });
});

describe("Match validity", () => {
  const feed = image("a", "4:5");
  const square = image("b", "1:1");
  const story = image("c", "9:16");

  it("accepts dual (feed + 9:16) and full (4:5 + 1:1 + 9:16)", () => {
    assert.equal(matchRefusal([feed, story]), null);
    assert.equal(matchAssetMode([feed, story]), "dual");
    assert.equal(matchRefusal([video("wide", "1:1"), video("v", "9:16")]), null);
    assert.equal(matchAssetMode([video("wide", "1:1"), video("v", "9:16")]), "dual");
    assert.equal(matchRefusal([feed, square, story]), null);
    assert.equal(matchAssetMode([feed, square, story]), "full");
  });

  it("refuses every other selection, each with its own reason", () => {
    assert.equal(matchRefusal([feed]), "Select 2 or 3 assets");
    assert.equal(matchRefusal([feed, square, story, image("d", "4:5")]), "Select 2 or 3 assets");
    assert.equal(matchRefusal([feed, video("v", "9:16")]), "Mixed image and video — a Meta creative is one media kind");
    assert.equal(matchRefusal([feed, image("o", "other")]), "Move files out of Other before matching");
    assert.match(matchRefusal([feed, image("a2", "4:5")]) ?? "", /Two assets are 4:5/);
    assert.equal(
      matchRefusal([feed, square]),
      "Dual needs one feed asset (4:5 or 1:1) and one 9:16",
    );
    assert.equal(
      matchRefusal([story, image("c2", "9:16")]),
      "Two assets are 9:16 — a creative takes each ratio once",
    );
    assert.equal(
      matchRefusal([feed, square, image("x", "4:5")]),
      "Two assets are 4:5 — a creative takes each ratio once",
    );
    assert.equal(matchRefusal([feed, story, image("o", "other")]), "Move files out of Other before matching");
    assert.equal(matchAssetMode([feed, square]), null);
  });
});

describe("send plan", () => {
  it("is a no-op the second time the same groups are sent", () => {
    const assets: IntakeSendAsset[] = [
      { ...image("feed", "4:5"), groupId: "g1" },
      { ...image("story", "9:16"), groupId: "g1" },
      video("reel", "9:16"),
    ];
    const first = planIntakeSend({
      assets,
      owned: [],
      routes: [],
      metaLaunched: false,
      tiktokLaunched: false,
    });
    assert.equal(intakeSendChanges(first), true);
    assert.deepEqual(
      first.meta.map((row) => [row.key, row.mode, row.action]),
      [
        ["g1", "dual", "insert"],
        [singleGroupKey("reel"), "single", "insert"],
      ],
    );
    assert.deepEqual(first.tiktokWrites, [{ assetId: "reel", enabled: true }]);

    const owned = [
      stamp("g1", "c-dual", "dual", ["feed", "story"]),
      stamp(singleGroupKey("reel"), "c-reel", "single", ["reel"]),
    ];
    const second = planIntakeSend({
      assets,
      owned,
      routes: [{ assetId: "reel", enabled: true, uploadStatus: "ready" }],
      metaLaunched: false,
      tiktokLaunched: false,
    });
    assert.equal(intakeSendChanges(second), false);
    assert.deepEqual(second.meta.map((row) => row.action), ["noop", "noop"]);
    assert.deepEqual(second.removeCreativeIds, []);
    assert.deepEqual(second.tiktokWrites, []);
  });

  it("never touches a creative that was made or edited in the drawer", () => {
    const assets: IntakeSendAsset[] = [{ ...image("feed", "4:5"), groupId: "g1" }, { ...image("story", "9:16"), groupId: "g1" }];
    const edited = stamp("g1", "c1", "dual", ["feed", "story"]);
    edited.draftFingerprint = `${edited.fingerprint}-drawer-headline`;
    const plan = planIntakeSend({
      assets,
      owned: [edited],
      routes: [],
      metaLaunched: false,
      tiktokLaunched: false,
    });
    assert.equal(plan.meta[0]?.action, "noop");
    assert.equal(plan.removeCreativeIds.length, 0);
    assert.match(plan.notes.join(" "), /edited in the drawer/);

    const draft = createDefaultDraft();
    const drawer = createDefaultCreative();
    drawer.id = "drawer";
    drawer.name = "Operator cut";
    drawer.nameSource = "operator";
    drawer.headline = "kept";
    draft.creatives = [drawer];
    const applied = applyIntakeToMetaDraft(
      draft,
      plan,
      [
        { id: "feed", filename: "feed.png", mediaKind: "image", aspectRatio: "4:5", storageBucket: "campaign-assets", storagePath: "images/feed.png", thumbnailUrl: null },
        { id: "story", filename: "story.png", mediaKind: "image", aspectRatio: "9:16", storageBucket: "campaign-assets", storagePath: "images/story.png", thumbnailUrl: null },
      ],
      { pageId: "page-1", instagramActorId: "ig-1" },
    );
    const kept = applied.draft.creatives.find((creative) => creative.id === "drawer");
    assert.equal(kept?.headline, "kept");
    assert.equal(kept?.name, "Operator cut");
  });

  it("images never reach TikTok, and neither does a video that is not 9:16", () => {
    const plan = planIntakeSend({
      assets: [image("still", "9:16"), video("wide", "4:5"), video("reel", "9:16")],
      owned: [],
      routes: [],
      metaLaunched: false,
      tiktokLaunched: false,
    });
    assert.deepEqual(plan.tiktokWrites, [
      { assetId: "wide", enabled: false },
      { assetId: "reel", enabled: true },
    ]);
    const turnedOff = planIntakeSend({
      assets: [image("still", "4:5")],
      owned: [],
      routes: [{ assetId: "still", enabled: true, uploadStatus: "idle" }],
      metaLaunched: false,
      tiktokLaunched: false,
    });
    assert.deepEqual(turnedOff.tiktokWrites, [{ assetId: "still", enabled: false }]);
  });

  it("a launched TikTok route is never removed, and a launched Meta creative stays", () => {
    const plan = planIntakeSend({
      assets: [],
      owned: [stamp(singleGroupKey("reel"), "c-reel", "single", ["reel"])],
      routes: [{ assetId: "reel", enabled: true, uploadStatus: "launched" }],
      metaLaunched: true,
      tiktokLaunched: true,
    });
    assert.deepEqual(plan.removeCreativeIds, []);
    assert.deepEqual(plan.tiktokWrites, []);
    assert.ok(plan.notes.includes(META_LAUNCHED_UNROUTE_NOTE));

    const launchedIntake = planIntakeSend({
      assets: [video("wide", "4:5")],
      owned: [],
      routes: [{ assetId: "wide", enabled: true, uploadStatus: "launched" }],
      metaLaunched: false,
      tiktokLaunched: true,
    });
    assert.deepEqual(launchedIntake.tiktokWrites, []);
    assert.ok(launchedIntake.notes.includes(TIKTOK_LAUNCHED_UNROUTE_NOTE));
  });

  it("drops the untouched starter once Send writes the real creatives", () => {
    const draft = createDefaultDraft();
    const starter = createDefaultCreative();
    starter.id = "starter";
    starter.name = "Plan creative";
    starter.destinationUrl = "https://tickets.example/show";
    draft.creatives = [starter];
    draft.creativeAssignments = { "ad-set": ["starter"] };
    assert.equal(isUntouchedStarterCreative(starter), true);

    const plan = planIntakeSend({
      assets: [image("feed", "4:5"), image("square", "1:1"), image("story", "9:16")].map((asset) => ({
        ...asset,
        groupId: "full-1",
      })),
      owned: [],
      routes: [],
      metaLaunched: false,
      tiktokLaunched: false,
    });
    const applied = applyIntakeToMetaDraft(
      draft,
      plan,
      [
        { id: "feed", filename: "feed.png", mediaKind: "image", aspectRatio: "4:5", storageBucket: "campaign-assets", storagePath: "images/a.png", thumbnailUrl: null },
        { id: "square", filename: "sq.png", mediaKind: "image", aspectRatio: "1:1", storageBucket: "campaign-assets", storagePath: "images/b.png", thumbnailUrl: null },
        { id: "story", filename: "story.png", mediaKind: "image", aspectRatio: "9:16", storageBucket: "campaign-assets", storagePath: "images/c.png", thumbnailUrl: null },
      ],
      { pageId: "page-1", instagramActorId: "ig-1" },
    );
    assert.equal(applied.draft.creatives.length, 1);
    assert.equal(applied.draft.creatives[0]?.assetMode, "full");
    assert.deepEqual(
      applied.draft.creatives[0]?.assetVariations[0]?.assets.map((asset) => asset.aspectRatio),
      ["4:5", "1:1", "9:16"],
    );
    assert.equal(applied.draft.creatives[0]?.identity.pageId, "page-1");
    assert.equal(applied.draft.creatives[0]?.identity.instagramActorId, "ig-1");
    assert.deepEqual(applied.draft.creativeAssignments["ad-set"], []);
    assert.equal(applied.draft.creatives.some((creative) => creative.id === "starter"), false);

    const owned = applied.fingerprints.map((row) => ({
      key: row.key,
      creativeId: row.creativeId,
      fingerprint: row.fingerprint,
      draftFingerprint: row.fingerprint,
    }));
    const again = applyIntakeToMetaDraft(
      applied.draft,
      planIntakeSend({
        assets: [image("feed", "4:5"), image("square", "1:1"), image("story", "9:16")].map((asset) => ({
          ...asset,
          groupId: "full-1",
        })),
        owned,
        routes: [],
        metaLaunched: false,
        tiktokLaunched: false,
      }),
      [],
      { pageId: "page-1", instagramActorId: "ig-1" },
    );
    assert.equal(again.changed, false);
    assert.equal(again.draft.creatives[0]?.id, applied.draft.creatives[0]?.id);
    assert.equal(creativeDraftFingerprint(again.draft.creatives[0]!), owned[0]?.fingerprint);
  });
});

describe("send round 2", () => {
  it("leaves an enabled TikTok route alone when that asset is not in this intake", () => {
    const plan = planIntakeSend({
      assets: [video("reel", "9:16")],
      owned: [],
      routes: [
        { assetId: "reel", enabled: true, uploadStatus: "idle" },
        { assetId: "drawer-video", enabled: true, uploadStatus: "idle" },
      ],
      metaLaunched: false,
      tiktokLaunched: false,
    });
    assert.deepEqual(plan.tiktokWrites, []);
  });

  it("does not update an MML creative after Meta has launched, and still inserts a new one", () => {
    const plan = planIntakeSend({
      assets: [
        { ...image("feed", "4:5"), groupId: "g1" },
        { ...image("story", "9:16"), groupId: "g1" },
        image("square", "1:1"),
      ],
      owned: [stamp("g1", "c1", "dual", ["feed", "old"])],
      routes: [],
      metaLaunched: true,
      tiktokLaunched: false,
    });
    assert.equal(plan.meta.find((row) => row.key === "g1")?.action, "noop");
    assert.equal(plan.meta.find((row) => row.key === singleGroupKey("square"))?.action, "insert");
    assert.ok(plan.notes.includes(META_LAUNCHED_UPDATE_NOTE));
  });

  it("deletes only an mml- path this drop created", () => {
    const fresh = "images/mml-11111111-1111-1111-1111-111111111111-shot.png";
    assert.equal(isIntakeUploadPath(fresh), true);
    assert.equal(mayDeleteIntakeUpload(fresh, "images/kept.png"), true);
    assert.equal(mayDeleteIntakeUpload(fresh, fresh), false);
    assert.equal(mayDeleteIntakeUpload("images/kept.png", "images/other.png"), false);
    assert.equal(mayDeleteIntakeUpload("videos/mml-11111111-1111-1111-1111-111111111111-reel.mp4", null), true);
  });

  it("a channel hit makes no upload call, and a second send makes no call", async () => {
    let calls = 0;
    const pending = (id: string, mediaKind: "image" | "video"): IntakeMetaUploadSlot => ({
      registryAssetId: id,
      mediaKind,
      uploadStatus: "pending",
    });
    const hit = await uploadIntakeSlots({
      slots: [pending("a", "image")],
      channelPlatformId: () => "stored-hash",
      upload: async () => {
        calls += 1;
        return { ok: true, hash: "from-call" };
      },
    });
    assert.equal(calls, 0);
    assert.deepEqual(hit.called, []);
    assert.equal(hit.slots[0]?.uploadStatus, "uploaded");
    assert.equal(hit.slots[0]?.assetHash, "stored-hash");

    const first = await uploadIntakeSlots({
      slots: [pending("b", "video")],
      channelPlatformId: () => null,
      upload: async () => {
        calls += 1;
        return { ok: true, videoId: "vid-1" };
      },
    });
    assert.equal(calls, 1);
    const second = await uploadIntakeSlots({
      slots: first.slots,
      channelPlatformId: () => null,
      upload: async () => {
        calls += 1;
        return { ok: true, videoId: "vid-2" };
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(second.called, []);
    assert.equal(second.slots[0]?.videoId, "vid-1");

    const failed = await uploadIntakeSlots({
      slots: [pending("c", "image")],
      channelPlatformId: () => null,
      upload: async () => ({ ok: false, error: "Meta said no" }),
    });
    assert.equal(failed.slots[0]?.uploadStatus, "pending");
    assert.equal(failed.slots[0]?.error, "Meta said no");
  });
});

describe("dedupe keeps a measured ratio when the registry row is other", () => {
  it("a 1080×1920 measurement on an other row lands in 9:16 and does not replace 4:5", () => {
    const measured = intakeAspect({ width: 1080, height: 1920, filename: "clip.mp4" });
    assert.equal(measured.bucket, "9:16");
    assert.deepEqual(
      detectedBucketAfterRegister({ created: false, existingAspect: "other", measured: measured.bucket }),
      { bucket: "9:16", upgradeAsset: true },
    );
    assert.deepEqual(
      detectedBucketAfterRegister({ created: false, existingAspect: null, measured: "1:1" }),
      { bucket: "1:1", upgradeAsset: true },
    );
    assert.deepEqual(
      detectedBucketAfterRegister({ created: false, existingAspect: "4:5", measured: "9:16" }),
      { bucket: "4:5", upgradeAsset: false },
    );
    assert.deepEqual(
      detectedBucketAfterRegister({ created: true, existingAspect: "other", measured: "9:16" }),
      { bucket: "9:16", upgradeAsset: false },
    );
  });
});

describe("send feedback copy", () => {
  it("names the asset being uploaded and the per-group result", () => {
    assert.equal(intakeUploadProgress(1, 3), "Uploading 1 of 3…");
    assert.equal(
      intakeSendResultLine({ label: "Grid", error: null, tiktok: false }),
      "✓ Grid uploaded to Meta",
    );
    assert.equal(
      intakeSendResultLine({ label: "Reel", error: null, tiktok: true }),
      "✓ Reel uploaded to Meta · ✓ routed to TikTok",
    );
    assert.equal(
      intakeSendResultLine({ label: "Story", error: "Object not found", tiktok: false }),
      "Story: Object not found",
    );
  });
});

describe("video register always sends the measured frame", () => {
  it("posts videoWidth and videoHeight on every register, including a later dedupe", () => {
    const source = readFileSync("components/plan/mml-creative-intake.tsx", "utf8");
    assert.match(source, /video\.videoWidth/);
    assert.match(source, /video\.videoHeight/);
    assert.match(source, /width: measured\.width/);
    assert.match(source, /height: measured\.height/);
    assert.doesNotMatch(source, /dedup/);
  });
});

describe("MML intake guards", () => {
  it("reads the multi-placement flag without changing it", () => {
    assert.equal(isMultiPlacementEnabled("1"), true);
    assert.equal(isMultiPlacementEnabled(undefined), false);
    assert.equal(isMultiPlacementEnabled("0"), false);
    assert.match(META_CROSS_PUBLISH_NOTE, /cross-publish one asset/);
  });

  it("components/plan does not import lib/meta or lib/tiktok/write", () => {
    const root = "components/plan";
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk(root);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /from ["']@\/lib\/meta\//, file);
      assert.doesNotMatch(source, /from ["']@\/lib\/tiktok\/write\//, file);
    }
  });
});
