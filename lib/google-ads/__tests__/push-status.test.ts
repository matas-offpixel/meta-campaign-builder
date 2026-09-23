import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import type { GoogleSearchPlanTree } from "../../google-search/types.ts";
import {
  describeGoogleSearchPush,
  googleSearchLiveStartBlocks,
  googleSearchServingRsasMissingUrl,
  parseGoogleSearchConfirmStart,
  parseGoogleSearchLaunchPaused,
  resolveGoogleSearchPushStatus,
} from "../push-status.ts";

describe("parseGoogleSearchLaunchPaused", () => {
  it("treats an absent value as live and rejects anything that is not a boolean", () => {
    assert.deepEqual(parseGoogleSearchLaunchPaused(undefined), { ok: true, value: false });
    assert.deepEqual(parseGoogleSearchLaunchPaused(true), { ok: true, value: true });
    assert.deepEqual(parseGoogleSearchLaunchPaused(false), { ok: true, value: false });
    for (const value of ["false", "true", 1, 0, null, "paused"]) {
      const parsed = parseGoogleSearchLaunchPaused(value);
      assert.equal(parsed.ok, false);
      if (!parsed.ok) assert.equal(parsed.error, "launchPaused must be a boolean");
    }
  });
});

describe("parseGoogleSearchConfirmStart", () => {
  it("treats an absent value as not confirmed and rejects a non-boolean", () => {
    assert.deepEqual(parseGoogleSearchConfirmStart(undefined), { ok: true, value: false });
    assert.deepEqual(parseGoogleSearchConfirmStart(true), { ok: true, value: true });
    const parsed = parseGoogleSearchConfirmStart("true");
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.error, "confirmStart must be a boolean");
  });
});

describe("resolveGoogleSearchPushStatus", () => {
  it("pauses only the campaign the sheet names, in either stored shape", () => {
    const perTheme = resolveGoogleSearchPushStatus({
      launchPaused: false,
      level: "campaign",
      campaignName: "C4 Genre-Discovery",
      bidAdjustments: { status_at_launch: "PAUSED" },
    });
    const mapped = resolveGoogleSearchPushStatus({
      launchPaused: false,
      level: "campaign",
      campaignName: "C4 Genre-Discovery",
      bidAdjustments: {
        status_at_launch_by_campaign: { "C4 Genre-Discovery": "PAUSED" },
      },
    });
    const other = resolveGoogleSearchPushStatus({
      launchPaused: false,
      level: "campaign",
      campaignName: "C1 Brand",
      bidAdjustments: {
        status_at_launch_by_campaign: { "C4 Genre-Discovery": "PAUSED" },
      },
    });
    assert.equal(perTheme, "PAUSED");
    assert.equal(mapped, "PAUSED");
    assert.equal(other, "ENABLED");
  });

  it("pauses an ad group by the (PAUSED) name convention or a matching C-code in the map", () => {
    assert.equal(
      resolveGoogleSearchPushStatus({
        launchPaused: false,
        level: "ad_group",
        campaignName: "C4 Conquest",
        bidAdjustments: {},
        adGroupName: "AG2 Past Off/Pixel clients (PAUSED)",
      }),
      "PAUSED",
    );
    const map = {
      status_at_launch_by_campaign: {
        "C5 Artist-Lineup": "PAUSED",
        "C1 Brand": "ENABLED",
      },
    };
    assert.equal(
      resolveGoogleSearchPushStatus({
        launchPaused: false,
        level: "ad_group",
        campaignName: "[IRW0005] Search",
        bidAdjustments: map,
        adGroupName: "C5 – Artist-Lineup",
      }),
      "PAUSED",
    );
    assert.equal(
      resolveGoogleSearchPushStatus({
        launchPaused: false,
        level: "ad_group",
        campaignName: "[IRW0005] Search",
        bidAdjustments: map,
        adGroupName: "C15 – Other",
      }),
      "ENABLED",
    );
    assert.equal(
      resolveGoogleSearchPushStatus({
        launchPaused: true,
        level: "ad",
        campaignName: "C1 Brand",
        bidAdjustments: {},
        adGroupName: "AG1",
      }),
      "PAUSED",
    );
  });
});

describe("describeGoogleSearchPush", () => {
  it("names the live count, the paused count, and each paused campaign", () => {
    const adGroup = (keywords: number) => ({
      name: "AG",
      rsas: [{}],
      keywords: Array.from({ length: keywords }, () => ({})),
    });
    const live = (name: string, groups: ReturnType<typeof adGroup>[]) => ({
      name,
      bid_adjustments: {},
      ad_groups: groups,
    });
    const tree = {
      campaigns: [
        live("C1", [adGroup(12), adGroup(12), adGroup(23)]),
        live("C2", [adGroup(12), adGroup(12)]),
        live("C3", [adGroup(12), adGroup(12)]),
        live("C5", [adGroup(12), adGroup(12)]),
        live("C6", [adGroup(12), adGroup(12), adGroup(12)]),
        {
          name: "C4 Genre-Discovery",
          bid_adjustments: { status_at_launch: "PAUSED" },
          ad_groups: [adGroup(12)],
        },
      ],
    } as unknown as Pick<GoogleSearchPlanTree, "campaigns">;

    assert.equal(
      describeGoogleSearchPush(tree, false),
      "Push will create 5 campaigns live and 1 paused (C4 Genre-Discovery — marked Paused in the sheet), 13 ad groups, 13 ads, 167 keywords. Ads begin serving immediately.",
    );
  });

  it("says when the whole push is paused and will not serve", () => {
    const tree = {
      campaigns: [
        {
          name: "C1 Brand",
          bid_adjustments: {},
          ad_groups: [{ name: "AG", rsas: [{}], keywords: [{}] }],
        },
      ],
    } as unknown as Pick<GoogleSearchPlanTree, "campaigns">;
    assert.equal(
      describeGoogleSearchPush(tree, true),
      "Push will create 1 campaign paused, 1 ad group, 1 ad, 1 keyword. Nothing will serve until it is enabled in Google Ads.",
    );
    const sheet = {
      campaigns: [
        {
          name: "C4 Genre-Discovery",
          bid_adjustments: { status_at_launch: "PAUSED" },
          ad_groups: [{ name: "AG", rsas: [{}], keywords: [{}] }],
        },
      ],
    } as unknown as Pick<GoogleSearchPlanTree, "campaigns">;
    assert.match(describeGoogleSearchPush(sheet, false), /Nothing will serve/);
    assert.match(describeGoogleSearchPush(sheet, false), /C4 Genre-Discovery/);
  });

  it("resolves the IRW0005 shape to 4 live campaigns and C5 paused", () => {
    const ag = (name: string) => ({ name, rsas: [{}], keywords: [{}] });
    const live = (name: string, groups = [ag("AG")]) => ({
      name,
      bid_adjustments: { status_at_launch: "ENABLED" as const },
      ad_groups: groups,
    });
    const tree = {
      campaigns: [
        live("[IRW0005] Appetite Halloween | Search | C1 Brand"),
        live("[IRW0005] Appetite Halloween | Search | C2 Generic"),
        live("[IRW0005] Appetite Halloween | Search | C3 Venue"),
        live("[IRW0005] Appetite Halloween | Search | C4 Conquest", [
          ag("AG1 Intent"),
          ag("AG2 Past Off/Pixel clients (PAUSED)"),
        ]),
        {
          name: "[IRW0005] Appetite Halloween | Search | C5 Artist-Lineup",
          bid_adjustments: { status_at_launch: "PAUSED" },
          ad_groups: [ag("Artist terms")],
        },
      ],
    } as unknown as Pick<GoogleSearchPlanTree, "campaigns">;

    const statuses = tree.campaigns.map((campaign) =>
      resolveGoogleSearchPushStatus({
        launchPaused: false,
        level: "campaign",
        campaignName: campaign.name,
        bidAdjustments: campaign.bid_adjustments,
      }),
    );
    assert.deepEqual(statuses, ["ENABLED", "ENABLED", "ENABLED", "ENABLED", "PAUSED"]);
    const sentence = describeGoogleSearchPush(tree, false);
    assert.match(sentence, /4 campaigns live and 1 paused \(C5 Artist-Lineup — marked Paused in the sheet\)/);
    assert.match(sentence, /AG2 Past Off\/Pixel clients/);
    assert.match(sentence, /Ads begin serving immediately/);
  });
});

describe("googleSearchLiveStartBlocks", () => {
  it("blocks a past or absent start only for a campaign that would go live", () => {
    const blocks = googleSearchLiveStartBlocks({
      campaigns: [
        { name: "[IRW0001] JJ | Search | C1 Brand", bid_adjustments: {} },
        {
          name: "C4 Genre-Discovery",
          bid_adjustments: { status_at_launch: "PAUSED", start: "2020-01-01" },
        },
      ],
      dateRange: { since: "2026-09-17", until: "2026-10-04" },
      launchPaused: false,
      today: "2026-09-22",
    });
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].campaignName, "[IRW0001] JJ | Search | C1 Brand");
    assert.equal(blocks[0].start, "2026-09-17");

    const absent = googleSearchLiveStartBlocks({
      campaigns: [{ name: "C1 Brand", bid_adjustments: {} }],
      dateRange: null,
      launchPaused: false,
      today: "2026-09-22",
    });
    assert.equal(absent[0].kind, "absent");

    const pausedPush = googleSearchLiveStartBlocks({
      campaigns: [{ name: "C1 Brand", bid_adjustments: {} }],
      dateRange: null,
      launchPaused: true,
      today: "2026-09-22",
    });
    assert.deepEqual(pausedPush, []);

    const todayIsFine = googleSearchLiveStartBlocks({
      campaigns: [{ name: "C1 Brand", bid_adjustments: { start: "2026-09-22" } }],
      dateRange: null,
      launchPaused: false,
      today: "2026-09-22",
    });
    assert.deepEqual(todayIsFine, []);
  });
});

describe("googleSearchServingRsasMissingUrl", () => {
  it("blocks a null final URL only on an RSA that would serve", () => {
    const tree = {
      campaigns: [
        {
          name: "C1 Brand",
          bid_adjustments: {},
          ad_groups: [
            {
              name: "AG1",
              rsas: [{ final_url: null, pushed_resource_name: null }],
            },
          ],
        },
      ],
    } as unknown as Pick<GoogleSearchPlanTree, "campaigns">;
    assert.equal(googleSearchServingRsasMissingUrl(tree, false).length, 1);
    assert.equal(googleSearchServingRsasMissingUrl(tree, true).length, 0);

    const pausedCampaign = {
      campaigns: [
        {
          name: "C5 Artist-Lineup",
          bid_adjustments: { status_at_launch: "PAUSED" },
          ad_groups: [
            { name: "AG", rsas: [{ final_url: "  ", pushed_resource_name: null }] },
          ],
        },
      ],
    } as unknown as Pick<GoogleSearchPlanTree, "campaigns">;
    assert.equal(googleSearchServingRsasMissingUrl(pausedCampaign, false).length, 0);
  });
});

describe("google search push route", () => {
  it("rejects an unparseable launchPaused before loading the plan or calling Google", () => {
    const route = readFileSync(
      new URL("../../../app/api/google-search/[id]/push/route.ts", import.meta.url),
      "utf8",
    );
    const parseAt = route.indexOf("parseGoogleSearchLaunchPaused");
    const loadAt = route.indexOf("loadGoogleSearchPlanTree(");
    const pushAt = route.indexOf("await pushGoogleSearchPlan");
    const validateAt = route.indexOf("if (hasHardErrors");
    const startAt = route.indexOf("start_date_blocked");
    const credentialsAt = route.indexOf("await getGoogleAdsCredentials");
    assert.ok(parseAt > 0 && parseAt < loadAt);
    assert.ok(route.indexOf("status: 400") < loadAt);
    assert.ok(validateAt < pushAt);
    assert.ok(startAt < credentialsAt);
    assert.ok(credentialsAt < pushAt);
    assert.match(route, /rsa_final_url_missing|hasHardErrors/);
  });
});
