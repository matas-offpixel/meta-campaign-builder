import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canProposeMigration,
  isRecoverableWebsiteDestination,
  offFunnelSkipReason,
  selectOffFunnelAuditRows,
  type EventLandingPageRef,
  type LiveCampaignDestination,
} from "../off-funnel-audit.ts";
import {
  liveDestinationsFromMetaSnapshot,
  liveDestinationsFromTikTokAds,
} from "../off-funnel-candidates.ts";

const LP = "https://app.offpixel.co.uk/l/gmc/mallorca";
const TICKETS = "https://tickets.example.com/jackies";

function live(
  over: Partial<LiveCampaignDestination> &
    Pick<LiveCampaignDestination, "campaignId" | "platform">,
): LiveCampaignDestination {
  return {
    campaignName: over.campaignName ?? over.campaignId,
    destinationUrl: over.destinationUrl ?? TICKETS,
    spend: over.spend ?? 200,
    active: over.active ?? true,
    eventId: over.eventId ?? "evt-1",
    eventName: over.eventName ?? "Jackies Mallorca",
    ...over,
  };
}

const lpByEvent: Record<string, EventLandingPageRef> = {
  "evt-1": {
    eventId: "evt-1",
    eventName: "Jackies Mallorca",
    eventPageUrl: LP,
  },
  "evt-no-lp": {
    eventId: "evt-no-lp",
    eventName: "No page yet",
    eventPageUrl: null,
  },
};

describe("selectOffFunnelAuditRows — invariant", () => {
  it("shows ONLY off-funnel-with-LP rows from a mixed fixture", () => {
    const fixture: LiveCampaignDestination[] = [
      live({
        campaignId: "on-funnel",
        platform: "meta",
        destinationUrl: LP,
        spend: 900,
      }),
      live({
        campaignId: "off-funnel-meta",
        platform: "meta",
        destinationUrl: TICKETS,
        spend: 400,
      }),
      live({
        campaignId: "off-funnel-tt",
        platform: "tiktok",
        destinationUrl: "https://ra.co/events/1",
        spend: 120,
      }),
      live({
        campaignId: "no-lp-campaign",
        platform: "meta",
        eventId: "evt-no-lp",
        destinationUrl: TICKETS,
        spend: 800,
      }),
    ];

    const rows = selectOffFunnelAuditRows(fixture, lpByEvent);
    assert.deepEqual(
      rows.map((r) => r.campaignId).sort(),
      ["off-funnel-meta", "off-funnel-tt"],
    );
    assert.equal(
      rows.some((r) => r.campaignId === "on-funnel"),
      false,
    );
    assert.equal(
      rows.some((r) => r.campaignId === "no-lp-campaign"),
      false,
    );
  });

  it("sorts by spend descending so a £5 leftover is not the first row", () => {
    const rows = selectOffFunnelAuditRows(
      [
        live({ campaignId: "small", platform: "meta", spend: 5 }),
        live({ campaignId: "large", platform: "meta", spend: 1400 }),
      ],
      lpByEvent,
    );
    assert.deepEqual(
      rows.map((r) => r.campaignId),
      ["large", "small"],
    );
  });
});

describe("canProposeMigration — on-funnel is a no-op", () => {
  it("already-on-funnel can never be migrated", () => {
    const onFunnel = live({
      campaignId: "already",
      platform: "meta",
      destinationUrl: `${LP}/`,
    });
    assert.equal(canProposeMigration(onFunnel, lpByEvent["evt-1"]), false);
    assert.equal(
      offFunnelSkipReason(onFunnel, lpByEvent["evt-1"]),
      "already_on_funnel",
    );
  });

  it("no LP and unknown destination are also no-ops", () => {
    assert.equal(
      offFunnelSkipReason(
        live({ campaignId: "x", platform: "meta", eventId: "evt-no-lp" }),
        lpByEvent["evt-no-lp"],
      ),
      "no_lp",
    );
    assert.equal(
      offFunnelSkipReason(
        live({
          campaignId: "spark",
          platform: "tiktok",
          destinationUrl: "https://www.tiktok.com/video/123",
        }),
        lpByEvent["evt-1"],
      ),
      "no_website_destination",
    );
    assert.equal(
      offFunnelSkipReason(
        live({
          campaignId: "paused",
          platform: "meta",
          active: false,
        }),
        lpByEvent["evt-1"],
      ),
      "inactive",
    );
  });
});

describe("isRecoverableWebsiteDestination", () => {
  it("keeps ticket hosts; drops on-platform creative permalinks", () => {
    assert.equal(isRecoverableWebsiteDestination(TICKETS), true);
    assert.equal(isRecoverableWebsiteDestination(LP), true);
    assert.equal(
      isRecoverableWebsiteDestination("https://www.tiktok.com/video/1"),
      false,
    );
    assert.equal(isRecoverableWebsiteDestination(null), false);
    assert.equal(isRecoverableWebsiteDestination(""), false);
  });
});

describe("snapshot flatteners", () => {
  it("splits Meta group spend across campaigns and reads link_url", () => {
    const liveRows = liveDestinationsFromMetaSnapshot(
      {
        kind: "ok",
        groups: [
          {
            spend: 100,
            any_ad_active: true,
            campaigns: [
              { id: "c1", name: "A" },
              { id: "c2", name: "B" },
            ],
            representative_preview: { link_url: TICKETS },
          },
        ],
      },
      { eventId: "evt-1", eventName: "Jackies" },
    );
    assert.equal(liveRows.length, 2);
    assert.equal(liveRows[0]?.spend, 50);
    assert.equal(liveRows[0]?.destinationUrl, TICKETS);
  });

  it("reads TikTok deeplink_url + ENABLE as active", () => {
    const liveRows = liveDestinationsFromTikTokAds(
      [
        {
          campaign_id: "tt1",
          campaign_name: "TT",
          deeplink_url: TICKETS,
          spend: "80.5",
          status: "ENABLE",
        },
      ],
      { eventId: "evt-1", eventName: "Jackies" },
    );
    assert.equal(liveRows[0]?.active, true);
    assert.equal(liveRows[0]?.spend, 80.5);
  });
});
