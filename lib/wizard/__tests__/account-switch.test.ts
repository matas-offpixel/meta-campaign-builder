import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDefaultCreative,
  createDefaultDraft,
} from "../../campaign-defaults.ts";
import { commitAccountSwitch } from "../account-switch.ts";

const OLD = "act_1073273492854557";
const NEXT = "act_606252931141334";

describe("account switch", () => {
  it("clears hashes, video ids, and registry ids but keeps fileName and aspectRatio", () => {
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
    assert.equal(cleared.registryAssetId, undefined);
    assert.equal(cleared.uploadedUrl, undefined);
    assert.equal(cleared.thumbnailUrl, undefined);
    assert.equal(cleared.uploadStatus, "pending");
    assert.equal(cleared.fileName, "poster.jpg");
    assert.equal(cleared.aspectRatio, "4:5");
    assert.equal(cleared.storagePath, "creatives/poster.jpg");
    assert.equal(next.creatives[0]!.name, "Artwork");
    assert.equal(next.creatives[0]!.nameSource, "operator");
    assert.equal(draft.creatives[0]!.assetVariations[0]!.assets[0]!.assetHash, "b7a997f09b47f16d684c7a147190d275");
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
});
