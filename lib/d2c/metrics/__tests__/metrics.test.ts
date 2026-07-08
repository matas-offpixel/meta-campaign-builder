/**
 * Unit tests for lib/d2c/metrics/*:
 *   mapMailchimpReport, mapBirdBroadcast, formatMetricsSummary, and the
 *   result_jsonb readers. The Bird case uses the shape from a REAL live
 *   capture (.scratch/bird-broadcast-metrics-capture.txt).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapMailchimpReport } from "../mailchimp.ts";
import { mapBirdBroadcast } from "../bird.ts";
import {
  formatMetricsSummary,
  readMailchimpCampaignId,
  readMailchimpServerPrefix,
  readSendMetrics,
} from "../types.ts";

const NOW = "2026-07-08T00:00:00.000Z";

describe("mapMailchimpReport", () => {
  it("normalises a report with opens/clicks/bounces", () => {
    const m = mapMailchimpReport(
      {
        emails_sent: 1000,
        opens: { opens_total: 640, unique_opens: 500, open_rate: 0.5 },
        clicks: { clicks_total: 120, unique_clicks: 90, click_rate: 0.09 },
        bounces: { hard_bounces: 3, soft_bounces: 2, syntax_errors: 0 },
        unsubscribed: 4,
      },
      NOW,
    );
    assert.equal(m.provider, "mailchimp");
    assert.equal(m.attempted, 1000);
    assert.equal(m.delivered, 995); // 1000 - 5 bounces
    assert.deepEqual(m.opens, { unique: 500, total: 640, rate: 0.5 });
    assert.deepEqual(m.clicks, { unique: 90, total: 120, rate: 0.09 });
    assert.equal(m.bounces, 5);
    assert.equal(m.unsubscribes, 4);
  });
});

describe("mapBirdBroadcast (real captured shape)", () => {
  it("maps counters.campaign → delivery metrics, opens/clicks null", () => {
    const m = mapBirdBroadcast(
      {
        counters: {
          campaign: { total: 2351, dispatched: 2351, dispatchFailed: 0, skipped: 0 },
          recipients: { total: 2437, reachable: 2437, subscribed: 2417 },
        },
      },
      NOW,
    );
    assert.equal(m.provider, "bird");
    assert.equal(m.attempted, 2351);
    assert.equal(m.delivered, 2351);
    assert.equal(m.bounces, 0);
    assert.equal(m.opens, null); // Bird has no engagement surface
    assert.equal(m.clicks, null);
    assert.equal(m.unsubscribes, null);
  });
});

describe("formatMetricsSummary", () => {
  it("email shows delivered + opens + clicks", () => {
    const line = formatMetricsSummary({
      fetched_at: NOW,
      provider: "mailchimp",
      attempted: 1000,
      delivered: 995,
      opens: { unique: 500, total: 640, rate: 0.5 },
      clicks: { unique: 90, total: 120, rate: 0.09 },
      bounces: 5,
      unsubscribes: 4,
      raw: {},
    });
    assert.equal(line, "Delivered 995 of 1,000 · Opens 500 (50%) · Clicks 90 (9%) · Bounces 5");
  });
  it("WhatsApp shows delivery only", () => {
    const line = formatMetricsSummary({
      fetched_at: NOW,
      provider: "bird",
      attempted: 2351,
      delivered: 2351,
      opens: null,
      clicks: null,
      bounces: 0,
      unsubscribes: null,
      raw: {},
    });
    assert.equal(line, "Delivered 2,351 of 2,351");
  });
});

describe("result_jsonb readers", () => {
  it("readSendMetrics round-trips a persisted metrics blob", () => {
    const metrics = {
      fetched_at: NOW,
      provider: "bird" as const,
      attempted: 10,
      delivered: 9,
      opens: null,
      clicks: null,
      bounces: 1,
      unsubscribes: null,
      raw: {},
    };
    assert.deepEqual(readSendMetrics({ metrics }), metrics);
    assert.equal(readSendMetrics({}), null);
    assert.equal(readSendMetrics(null), null);
  });

  it("readMailchimpCampaignId prefers meta, then details.campaign.id, then providerJobId", () => {
    assert.equal(readMailchimpCampaignId({ meta: { mailchimp_campaign_id: "m1" } }), "m1");
    assert.equal(readMailchimpCampaignId({ details: { campaign: { id: "c1" } } }), "c1");
    assert.equal(readMailchimpCampaignId({ providerJobId: "p1" }), "p1");
    assert.equal(readMailchimpCampaignId({}), null);
  });

  it("readMailchimpServerPrefix parses the DC from a long_archive_url", () => {
    assert.equal(
      readMailchimpServerPrefix({
        details: { campaign: { long_archive_url: "https://us7.campaign-archive.com/?u=x&id=y" } },
      }),
      "us7",
    );
    assert.equal(readMailchimpServerPrefix({ meta: { server_prefix: "us12" } }), "us12");
    assert.equal(readMailchimpServerPrefix({}), null);
  });
});
