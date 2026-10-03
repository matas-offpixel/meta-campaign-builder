import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDefaultCreative,
  createDefaultDraft,
} from "../../campaign-defaults.ts";
import { extractMetaDraftAssetRefs } from "../../plan/asset-routing.ts";
import { validateStep } from "../../validation.ts";
import { commitAccountSwitch } from "../account-switch.ts";

const OLD = "act_1073273492854557";
const NEXT = "act_606252931141334";

describe("account switch", () => {
  it("clears hashes and video ids and keeps the registry id", () => {
    const draft = createDefaultDraft();
    draft.settings.adAccountId = OLD;
    draft.settings.metaAdAccountId = OLD;
    const creative = createDefaultCreative();
    creative.name = "Artwork";
    creative.nameSource = "operator";
    creative.mediaType = "image";
    const asset = creative.assetVariations[0]!.assets[0]!;
    asset.fileName = "poster.jpg";
    asset.aspectRatio = "4:5";
    asset.storagePath = "creatives/poster.jpg";
    asset.storageBucket = "creative-uploads";
    asset.assetHash = "b7a997f09b47f16d684c7a147190d275";
    asset.videoId = "999";
    asset.uploadedUrl = "https://cdn.example/poster.jpg";
    asset.thumbnailUrl = "https://cdn.example/thumb.jpg";
    asset.registryAssetId = "registry-1";
    asset.uploadStatus = "uploaded";
    draft.creatives = [creative];

    const next = commitAccountSwitch(draft, NEXT, "confirm");
    const cleared = next.creatives[0]!.assetVariations[0]!.assets[0]!;
    assert.equal(cleared.assetHash, undefined);
    assert.equal(cleared.videoId, undefined);
    assert.equal(cleared.registryAssetId, "registry-1");
    assert.equal(cleared.uploadedUrl, undefined);
    assert.equal(cleared.thumbnailUrl, undefined);
    assert.equal(cleared.uploadStatus, "uploaded");
    assert.equal(cleared.fileName, "poster.jpg");
    assert.equal(cleared.aspectRatio, "4:5");
    assert.equal(cleared.storagePath, "creatives/poster.jpg");
    assert.equal(next.creatives[0]!.name, "Artwork");
    assert.equal(next.creatives[0]!.nameSource, "operator");
    assert.equal(draft.creatives[0]!.assetVariations[0]!.assets[0]!.assetHash, "b7a997f09b47f16d684c7a147190d275");
  });

  it("plan-linked draft keeps registry refs across a switch", () => {
    const draft = createDefaultDraft();
    draft.settings.adAccountId = OLD;
    draft.settings.metaAdAccountId = OLD;
    const creative = createDefaultCreative();
    creative.name = "Artwork";
    creative.mediaType = "video";
    const kept = creative.assetVariations[0]!.assets[0]!;
    kept.fileName = "clip.mp4";
    kept.storagePath = "videos/clip.mp4";
    kept.videoId = "999";
    kept.registryAssetId = "registry-1";
    kept.uploadStatus = "uploaded";
    creative.assetVariations[0]!.assets.push({
      id: "loose-asset",
      aspectRatio: "9:16",
      fileName: "extra.mp4",
      videoId: "888",
      uploadStatus: "uploaded",
    });
    draft.creatives = [creative];

    const next = commitAccountSwitch(draft, NEXT, "confirm");
    const refs = extractMetaDraftAssetRefs(next);
    assert.equal(refs.some((ref) => ref.registryAssetId === "registry-1"), true);
    const cleared = next.creatives[0]!.assetVariations[0]!.assets[0]!;
    assert.equal(cleared.registryAssetId, "registry-1");
    assert.equal(cleared.videoId, undefined);
    assert.equal(cleared.uploadStatus, "uploaded");
    const pending = next.creatives[0]!.assetVariations[0]!.assets[1]!;
    assert.equal(pending.registryAssetId, undefined);
    assert.equal(pending.uploadStatus, "pending");
    assert.equal(pending.videoId, undefined);
  });

  it("clears audience Meta ids but keeps the group definition", () => {
    const draft = createDefaultDraft();
    draft.settings.adAccountId = OLD;
    draft.settings.metaAdAccountId = OLD;
    draft.audiences.pageGroups = [
      {
        id: "group-1",
        name: "Main Phase",
        pageIds: ["111"],
        engagementTypes: ["ig_engagement_365d"],
        lookalike: true,
        lookalikeRanges: ["0-1%"],
        customAudienceIds: [],
        createEngagementAudiences: true,
        engagementAudienceIds: ["120250867495400239"],
        engagementAudienceStatuses: [
          {
            id: "120250867495400239",
            type: "ig_engagement_365d",
            pageId: "111",
            createdAt: "2026-10-01T00:00:00.000Z",
            readyForLookalike: true,
            populating: false,
          },
        ],
      },
    ];

    const next = commitAccountSwitch(draft, NEXT, "confirm");
    const group = next.audiences.pageGroups[0]!;
    assert.equal(group.name, "Main Phase");
    assert.deepEqual(group.pageIds, ["111"]);
    assert.deepEqual(group.engagementTypes, ["ig_engagement_365d"]);
    assert.equal(group.lookalike, true);
    assert.deepEqual(group.engagementAudienceIds, undefined);
    assert.deepEqual(group.engagementAudienceStatuses, []);
    assert.equal(draft.audiences.pageGroups[0]!.engagementAudienceIds?.[0], "120250867495400239");
  });

  it("removes custom picks and attach targets", () => {
    const draft = createDefaultDraft();
    draft.settings.adAccountId = OLD;
    draft.settings.metaAdAccountId = OLD;
    draft.settings.existingMetaCampaigns = [{
      id: "120",
      name: "Old",
      objective: "OUTCOME_SALES",
      status: "PAUSED",
      capturedAt: "2026-10-01T00:00:00.000Z",
    }];
    draft.settings.existingMetaAdSets = [{
      id: "456",
      name: "Old set",
      campaignId: "120",
      status: "PAUSED",
      capturedAt: "2026-10-01T00:00:00.000Z",
    }];
    draft.audiences.customAudienceGroups = [
      { id: "c", name: "Custom", audienceIds: ["120250867494340239"] },
    ];
    draft.audiences.selectedPagesLookalikeGroups = [
      {
        id: "l",
        name: "Lookalike",
        selectedPageIds: ["111"],
        engagementTypes: ["fb_likes"],
        lookalikeRanges: ["0-1%"],
        lookalikeAudienceIdsByRange: { "0-1%": ["120250867493940239"] },
      },
    ];
    draft.audiences.savedAudiences.audienceIds = ["120250867493940239"];

    const next = commitAccountSwitch(draft, NEXT, "confirm");
    assert.deepEqual(next.audiences.customAudienceGroups, []);
    assert.deepEqual(next.audiences.selectedPagesLookalikeGroups, []);
    assert.deepEqual(next.audiences.savedAudiences.audienceIds, []);
    assert.equal(next.settings.existingMetaCampaigns, undefined);
    assert.equal(next.settings.existingMetaAdSets, undefined);
    assert.equal(next.settings.adAccountId, NEXT);
    assert.equal(next.settings.metaPixelId, undefined);
  });

  it("leaves creatives and audiences in place when nothing account-scoped exists", () => {
    const draft = createDefaultDraft();
    draft.settings.adAccountId = OLD;
    draft.settings.metaAdAccountId = OLD;
    draft.settings.pixelId = "pixel-1";
    const creative = createDefaultCreative();
    creative.assetVariations[0]!.assets[0]!.fileName = "empty.jpg";
    draft.creatives = [creative];
    draft.audiences.pageGroups = [
      {
        id: "group-1",
        name: "Main Phase",
        pageIds: ["111"],
        engagementTypes: ["fb_likes"],
        lookalike: false,
        lookalikeRanges: [],
        customAudienceIds: [],
      },
    ];

    const next = commitAccountSwitch(draft, NEXT, "confirm");
    assert.equal(next.creatives, draft.creatives);
    assert.equal(next.audiences, draft.audiences);
    assert.equal(next.settings.adAccountId, NEXT);
    assert.equal(next.settings.pixelId, undefined);
  });

  it("cancel leaves the draft byte-identical", () => {
    const draft = createDefaultDraft();
    draft.settings.adAccountId = OLD;
    draft.settings.metaAdAccountId = OLD;
    const creative = createDefaultCreative();
    creative.assetVariations[0]!.assets[0]!.assetHash = "abc";
    creative.assetVariations[0]!.assets[0]!.uploadStatus = "uploaded";
    draft.creatives = [creative];

    const next = commitAccountSwitch(draft, NEXT, "cancel");
    assert.equal(next, draft);
    assert.equal(JSON.stringify(next), JSON.stringify(draft));
  });

  it("single-mode image slot after switch is a re-upload error", () => {
    const next = commitAccountSwitch(singleImageDraft(), NEXT, "confirm");
    const asset = next.creatives[0]!.assetVariations[0]!.assets[0]!;
    assert.equal(asset.uploadStatus, "uploaded");
    assert.equal(asset.assetHash, undefined);
    assert.equal(asset.videoId, undefined);
    const result = validateStep(4, next);
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes(reuploadMessage()));
  });

  it("re-upload that sets assetHash passes", () => {
    const next = commitAccountSwitch(singleImageDraft(), NEXT, "confirm");
    next.creatives[0]!.assetVariations[0]!.assets[0]!.assetHash =
      "b7a997f09b47f16d684c7a147190d275";
    const result = validateStep(4, next);
    assert.equal(result.errors.some((error) => error.includes("Re-upload to")), false);
    assert.equal(result.valid, true);
  });

  it("a legacy asset with registryAssetId and assetHash is untouched", () => {
    const draft = singleImageDraft();
    const before = draft.creatives[0]!.assetVariations[0]!.assets[0]!;
    const result = validateStep(4, draft);
    const after = draft.creatives[0]!.assetVariations[0]!.assets[0]!;
    assert.equal(after.registryAssetId, "registry-1");
    assert.equal(after.assetHash, before.assetHash);
    assert.equal(after.uploadStatus, "uploaded");
    assert.equal(result.errors.some((error) => error.includes("Re-upload to")), false);
    assert.equal(result.valid, true);
  });
});

function reuploadMessage(): string {
  return `"Artwork" › "Variation 1" › 9:16: Re-upload to ${NEXT} — this asset belongs to the previous ad account`;
}

function singleImageDraft() {
  const draft = createDefaultDraft();
  draft.settings.adAccountId = OLD;
  draft.settings.metaAdAccountId = OLD;
  const creative = createDefaultCreative();
  creative.name = "Artwork";
  creative.mediaType = "image";
  creative.assetMode = "single";
  creative.identity.pageId = "111";
  creative.captions[0]!.text = "Tonight";
  creative.destinationUrl = "https://tickets.example.com";
  const asset = creative.assetVariations[0]!.assets[0]!;
  asset.fileName = "poster.jpg";
  asset.storagePath = "images/poster.jpg";
  asset.assetHash = "b7a997f09b47f16d684c7a147190d275";
  asset.registryAssetId = "registry-1";
  asset.uploadStatus = "uploaded";
  draft.creatives = [creative];
  return draft;
}
