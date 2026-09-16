import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  applyTikTokLaunchProgress,
  buildTikTokLaunchPanelModel,
  emptyTikTokLaunchProgress,
  formatTikTokLaunchPanel,
} from "../launch-progress.ts";

describe("buildTikTokLaunchPanelModel", () => {
  it("renders in-flight, succeeded, and failed as distinct states", () => {
    const inFlight = formatTikTokLaunchPanel(
      buildTikTokLaunchPanelModel({
        status: "launching",
        progress: emptyTikTokLaunchProgress(),
      }),
    );
    const succeededLive = formatTikTokLaunchPanel(
      buildTikTokLaunchPanelModel({
        status: "success",
        campaignId: "campaign_1",
        adGroupCount: 3,
        adCount: 9,
        launchedAt: "2026-08-21T00:00:00.000Z",
        adsManagerUrl:
          "https://ads.tiktok.com/i18n/manage/campaign?aadvid=7639802149165301776",
      }),
    );
    const succeededPaused = formatTikTokLaunchPanel(
      buildTikTokLaunchPanelModel({
        status: "success",
        campaignId: "campaign_1",
        adGroupCount: 3,
        adCount: 9,
        launchPaused: true,
      }),
    );
    const failed = formatTikTokLaunchPanel(
      buildTikTokLaunchPanelModel({
        status: "error",
        errorMessage: "TikTok error 40000: invalid params",
        tiktok: {
          code: 40000,
          message: "invalid params",
          request_id: "2026082100123456789",
        },
      }),
    );

    assert.match(inFlight, /^state:in-flight$/m);
    assert.match(succeededLive, /^state:succeeded$/m);
    assert.match(succeededPaused, /^state:succeeded$/m);
    assert.match(failed, /^state:failed$/m);
    assert.notEqual(inFlight, succeededLive);
    assert.notEqual(succeededLive, failed);
    assert.notEqual(inFlight, failed);
    assert.notEqual(succeededLive, succeededPaused);

    assert.match(inFlight, /this is the long step/);
    assert.doesNotMatch(inFlight, /ad_groups:\d+\/\d+/);
    assert.match(succeededLive, /campaign:campaign_1/);
    assert.match(succeededLive, /ad_groups:3/);
    assert.match(succeededLive, /ads:9/);
    assert.match(succeededLive, /title:Launched live/);
    assert.match(succeededLive, /Delivery starts at the schedule start/);
    assert.match(succeededPaused, /title:Launched paused/);
    assert.match(succeededPaused, /Nothing will deliver until it is enabled in Ads Manager/);
    assert.match(
      succeededLive,
      /ads_manager:https:\/\/ads\.tiktok\.com\/i18n\/manage\/campaign\?aadvid=7639802149165301776/,
    );
    assert.match(failed, /request_id:2026082100123456789/);
    assert.match(failed, /invalid params/);
  });

  it("shows only launcher-reported counts during the ads phase", () => {
    const model = buildTikTokLaunchPanelModel({
      status: "launching",
      progress: applyTikTokLaunchProgress({
        phase: "ad",
        campaignId: "campaign_1",
        adGroupsDone: 2,
        adGroupsTotal: 3,
        adsDone: 5,
        adsTotal: 9,
      }),
    });
    const rendered = formatTikTokLaunchPanel(model);
    assert.match(rendered, /phase:campaign:done:Created campaign_1/);
    assert.match(rendered, /phase:adgroup:active:2\/3/);
    assert.match(rendered, /phase:ad:active:5\/9 · this is the long step/);
  });
});

describe("TikTokLaunchPanel markup", () => {
  it("binds a distinct data-launch-state and surfaces request_id", () => {
    const source = readFileSync(
      new URL("../../../components/tiktok-wizard/launch-panel.tsx", import.meta.url),
      "utf8",
    );
    assert.match(source, /data-launch-state=\{model\.state\}/);
    assert.match(source, /data-request-id=\{model\.requestId\}/);
    assert.match(source, /request_id \{model\.requestId\}/);
  });
});
