import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseTikTokLaunchStreamLine,
  readTikTokLaunchStream,
} from "../write/launch-stream.ts";

describe("parseTikTokLaunchStreamLine", () => {
  it("parses a progress line the orchestrator emits", () => {
    const event = parseTikTokLaunchStreamLine(
      JSON.stringify({
        type: "progress",
        phase: "ad",
        campaignId: "campaign_1",
        adGroupsDone: 2,
        adGroupsTotal: 3,
        adsDone: 5,
        adsTotal: 9,
      }),
    );
    assert.deepEqual(event, {
      type: "progress",
      phase: "ad",
      campaignId: "campaign_1",
      adGroupsDone: 2,
      adGroupsTotal: 3,
      adsDone: 5,
      adsTotal: 9,
    });
  });

  it("parses a failed result that still carries request_id", () => {
    const event = parseTikTokLaunchStreamLine(
      JSON.stringify({
        type: "result",
        status: 502,
        body: {
          ok: false,
          error: "TikTok error 40000: invalid params",
          tiktok: {
            code: 40000,
            message: "invalid params",
            request_id: "2026082100123456789",
          },
        },
      }),
    );
    assert.ok(event?.type === "result");
    assert.equal(event.status, 502);
    assert.equal(event.body.ok, false);
    if (!event.body.ok) {
      assert.equal(event.body.tiktok?.request_id, "2026082100123456789");
    }
  });

  it("ignores blank and malformed lines", () => {
    assert.equal(parseTikTokLaunchStreamLine(""), null);
    assert.equal(parseTikTokLaunchStreamLine("  "), null);
    assert.equal(parseTikTokLaunchStreamLine("{nope"), null);
  });
});

describe("readTikTokLaunchStream", () => {
  it("replays ndjson progress then the result", async () => {
    const body = [
      JSON.stringify({
        type: "progress",
        phase: "campaign",
        campaignId: "campaign_1",
        adGroupsDone: 0,
        adGroupsTotal: 1,
        adsDone: 0,
        adsTotal: 1,
      }),
      JSON.stringify({
        type: "result",
        status: 200,
        body: {
          ok: true,
          campaign_id: "campaign_1",
          adgroup_ids: ["ag_1"],
          ad_ids: ["ad_1"],
          launched_at: "2026-08-21T00:00:00.000Z",
          entities: [],
        },
      }),
      "",
    ].join("\n");
    const res = new Response(body, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    });
    const events: string[] = [];
    await readTikTokLaunchStream(res, (event) => {
      events.push(event.type);
    });
    assert.deepEqual(events, ["progress", "result"]);
  });
});
