/**
 * Unit tests for the Goal 1/3/6 pure seams in lib/d2c/dashboard-view.ts:
 *   resolveCta, viewportClamp, normaliseViewport,
 *   buildMailchimpCampaignUrl, buildBirdBroadcastUrl.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBirdBroadcastUrl,
  buildMailchimpCampaignUrl,
  normaliseViewport,
  resolveCta,
  viewportClamp,
} from "../dashboard-view.ts";

describe("resolveCta", () => {
  it("returns label+url when both present", () => {
    assert.deepEqual(
      resolveCta({ button_label: "ACCESS TICKETS", button_url: "https://ra.co/x" }),
      { label: "ACCESS TICKETS", url: "https://ra.co/x" },
    );
  });
  it("trims whitespace", () => {
    assert.deepEqual(resolveCta({ button_label: "  GO  ", button_url: "  u  " }), {
      label: "GO",
      url: "u",
    });
  });
  it("returns null when label missing (community reminder)", () => {
    assert.equal(resolveCta({ button_label: null, button_url: "https://x" }), null);
    assert.equal(resolveCta({ button_label: "", button_url: "https://x" }), null);
  });
  it("returns null when url missing", () => {
    assert.equal(resolveCta({ button_label: "GO", button_url: null }), null);
  });
  it("returns null for null/undefined source", () => {
    assert.equal(resolveCta(null), null);
    assert.equal(resolveCta(undefined), null);
  });
});

describe("viewportClamp / normaliseViewport", () => {
  it("clamps desktop to 640px, phone to 375px", () => {
    assert.equal(viewportClamp("desktop"), "640px");
    assert.equal(viewportClamp("phone"), "375px");
  });
  it("normalises persisted values, defaulting to desktop", () => {
    assert.equal(normaliseViewport("phone"), "phone");
    assert.equal(normaliseViewport("desktop"), "desktop");
    assert.equal(normaliseViewport("garbage"), "desktop");
    assert.equal(normaliseViewport(null), "desktop");
  });
});

describe("buildMailchimpCampaignUrl", () => {
  it("links to report summary for a sent campaign", () => {
    assert.equal(
      buildMailchimpCampaignUrl("us7", "abc123", { sent: true }),
      "https://us7.admin.mailchimp.com/reports/summary?id=abc123",
    );
  });
  it("links to the editor for a draft", () => {
    assert.equal(
      buildMailchimpCampaignUrl("us7", "abc123", { sent: false }),
      "https://us7.admin.mailchimp.com/campaigns/edit?id=abc123",
    );
  });
  it("returns null when prefix or id missing", () => {
    assert.equal(buildMailchimpCampaignUrl(null, "abc", { sent: true }), null);
    assert.equal(buildMailchimpCampaignUrl("us7", null, { sent: true }), null);
  });
});

describe("buildBirdBroadcastUrl", () => {
  it("prefers an explicit edit url", () => {
    assert.equal(
      buildBirdBroadcastUrl("bid", "https://app.bird.com/workspaces/w/campaigns/c"),
      "https://app.bird.com/workspaces/w/campaigns/c",
    );
  });
  it("falls back to the canonical broadcasts url", () => {
    assert.equal(
      buildBirdBroadcastUrl("bid-123", null),
      "https://app.bird.com/broadcasts/bid-123",
    );
  });
  it("returns null with no ids", () => {
    assert.equal(buildBirdBroadcastUrl(null, null), null);
  });
});
