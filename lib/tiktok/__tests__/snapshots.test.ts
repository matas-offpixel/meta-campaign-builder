import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  readActiveTikTokCreativesSnapshot,
  writeActiveTikTokCreativesSnapshot,
} from "../snapshots.ts";

function makeWriteStub(): {
  client: SupabaseClient;
  calls: { table: string | null; rows: unknown[] };
} {
  const calls = { table: null as string | null, rows: [] as unknown[] };
  const client = {
    from(table: string) {
      calls.table = table;
      return {
        upsert(rows: unknown[]) {
          calls.rows.push(rows);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("writeActiveTikTokCreativesSnapshot", () => {
  it("refuses skip and error writes to preserve last-good", async () => {
    const { client, calls } = makeWriteStub();
    const key = {
      eventId: "event-1",
      userId: "user-1",
      window: { since: "2026-04-01", until: "2026-04-30" },
    };

    assert.equal(
      await writeActiveTikTokCreativesSnapshot(client, key, {
        kind: "skip",
        reason: "no_creds",
      }),
      false,
    );
    assert.equal(
      await writeActiveTikTokCreativesSnapshot(client, key, {
        kind: "error",
        message: "boom",
      }),
      false,
    );
    assert.equal(calls.table, null);
    assert.equal(calls.rows.length, 0);
  });

  it("writes ok rows with the event window conflict key", async () => {
    const { client, calls } = makeWriteStub();
    const wrote = await writeActiveTikTokCreativesSnapshot(
      client,
      {
        eventId: "event-1",
        userId: "user-1",
        window: { since: "2026-04-01", until: "2026-04-30" },
      },
      {
        kind: "ok",
        rows: [
          {
            ad_id: "ad-1",
            campaign_id: "camp-1",
            campaign_name: "Campaign",
            thumbnail_url: "https://example.com/thumb.jpg",
            deeplink_url: "https://example.com/post",
            ad_text: "Copy",
            ad_name: "POST 1",
            primary_status: "ACTIVE",
            secondary_status: "UNKNOWN",
            reach: 100,
            cost_per_1000_reached: 10,
            frequency: 1,
            clicks_all: 20,
            ctr_all: 2,
            secondary_source: null,
            primary_source: null,
            attribution_source: null,
            currency: "GBP",
            post_url: "https://example.com/post",
            cost: 12,
            impressions: 1000,
            impressions_raw: null,
            cpm: 12,
            clicks_destination: 20,
            cpc_destination: 0.6,
            ctr_destination: 2,
            video_views_2s: 800,
            video_views_6s: 600,
            video_views_p25: null,
            video_views_p50: null,
            video_views_p75: null,
            video_views_p100: 300,
            avg_play_time_per_user: null,
            avg_play_time_per_video_view: null,
            interactive_addon_impressions: null,
            interactive_addon_destination_clicks: null,
          },
        ],
      },
    );

    assert.equal(wrote, true);
    assert.equal(calls.table, "tiktok_active_creatives_snapshots");
    const rows = calls.rows[0] as Array<Record<string, unknown>>;
    assert.equal(rows[0].event_id, "event-1");
    assert.equal(rows[0].ad_id, "ad-1");
    assert.equal(rows[0].window_since, "2026-04-01");
    assert.equal(rows[0].window_until, "2026-04-30");
  });
});

describe("readActiveTikTokCreativesSnapshot", () => {
  it("maps stored rows back to TikTok ad rows", async () => {
    const client = {
      from() {
        const builder = {
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          order() {
            return Promise.resolve({
              data: [
                {
                  ad_id: "ad-1",
                  ad_name: "POST 1",
                  campaign_id: "camp-1",
                  campaign_name: "Campaign",
                  status: "ACTIVE",
                  spend: "12",
                  impressions: 1000,
                  reach: 100,
                  clicks: 20,
                  ctr: "2",
                  video_views_2s: 800,
                  video_views_6s: 600,
                  video_views_100p: 300,
                  thumbnail_url: "https://example.com/thumb.jpg",
                  deeplink_url: "https://example.com/post",
                  ad_text: "Copy",
                  fetched_at: "2026-04-29T00:00:00Z",
                },
              ],
              error: null,
            });
          },
        };
        return builder;
      },
    } as unknown as SupabaseClient;

    const snapshot = await readActiveTikTokCreativesSnapshot(client, "event-1", {
      since: "2026-04-01",
      until: "2026-04-30",
    });

    assert.equal(snapshot?.rows[0].ad_id, "ad-1");
    assert.equal(snapshot?.rows[0].cost, 12);
    assert.equal(snapshot?.rows[0].thumbnail_url, "https://example.com/thumb.jpg");
  });
});
