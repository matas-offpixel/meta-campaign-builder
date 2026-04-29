import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTikTokBriefFilename,
  buildTikTokBriefMarkdown,
} from "../brief.ts";
import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";

describe("TikTok brief export", () => {
  it("renders every brief section with configured draft data", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.accountSetup.advertiserId = "adv-1";
    draft.accountSetup.identityManualName = "Manual identity";
    draft.campaignSetup.eventCode = "EVT";
    draft.campaignSetup.campaignName = "[EVT] Summer Campaign";
    draft.campaignSetup.objective = "TRAFFIC";
    draft.campaignSetup.optimisationGoal = "CLICK";
    draft.campaignSetup.bidStrategy = "LOWEST_COST";
    draft.optimisation.benchmarkCpc = 1.2;
    draft.optimisation.maxDailySpend = 50;
    draft.audiences.interestCategoryLabels = { music: "Music" };
    draft.audiences.behaviourCategoryLabels = { live: "Live events" };
    draft.audiences.customAudienceLabels = { purchasers: "Purchasers" };
    draft.audiences.lookalikeAudienceLabels = { fans: "Fans lookalike" };
    draft.budgetSchedule.budgetAmount = 100;
    draft.budgetSchedule.scheduleStartAt = "2026-05-01";
    draft.budgetSchedule.scheduleEndAt = "2026-05-08";
    draft.budgetSchedule.adGroups = [
      { id: "ag-1", name: "Prospecting", budget: 100, startAt: null, endAt: null },
    ];
    draft.creatives.items = [
      {
        id: "creative-1",
        name: "Hero · v1",
        mode: "VIDEO_REFERENCE",
        baseName: "Hero",
        videoId: "video-1",
        videoUrl: "https://www.tiktok.com/@artist/video/video-1",
        thumbnailUrl: "https://example.com/thumb.jpg",
        durationSeconds: 15,
        title: "Video title",
        sparkPostId: null,
        caption: "Caption",
        adText: "Buy tickets now",
        displayName: "Promoter",
        landingPageUrl: "https://tickets.example.com",
        cta: "LEARN_MORE",
        musicId: null,
      },
    ];
    draft.creativeAssignments.byAdGroupId = { "ag-1": ["creative-1"] };

    const markdown = buildTikTokBriefMarkdown(draft, {
      eventName: "Summer Show",
      eventDate: "2026-05-10",
      clientName: "Client Co",
      advertiserName: "TikTok Ads Account",
    });

    assert.match(markdown, /^# \[EVT\] Summer Campaign/m);
    assert.match(markdown, /## Overview/);
    assert.match(markdown, /- Event: Summer Show on 2026-05-10/);
    assert.match(markdown, /- TikTok advertiser: TikTok Ads Account/);
    assert.match(markdown, /## Campaign config/);
    assert.match(markdown, /## Optimisation/);
    assert.match(markdown, /## Audiences/);
    assert.match(markdown, /- Interest categories: Music/);
    assert.match(markdown, /## Budget & schedule/);
    assert.match(markdown, /### Hero · v1/);
    assert.match(markdown, /\| Hero · v1 \| ✓ \|/);
    assert.match(markdown, /## Pre-flight checks/);
  });

  it("handles missing fields cleanly", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    const markdown = buildTikTokBriefMarkdown(draft);

    assert.match(markdown, /# \[no-event-code\] Untitled campaign/);
    assert.match(markdown, /- Event: Not set/);
    assert.match(markdown, /No creatives configured/);
    assert.match(markdown, /No creative assignments configured/);
  });

  it("includes the bracketed event code in the filename", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.campaignSetup.eventCode = "EVT";
    draft.campaignSetup.campaignName = "[EVT] Summer Campaign";

    assert.equal(
      buildTikTokBriefFilename(draft),
      "[EVT] Summer Campaign - TikTok brief.md",
    );
  });
});
