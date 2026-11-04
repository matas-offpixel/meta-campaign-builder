import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveCanonicalTikTokWindow } from "../../share/tiktok-window.ts";
import { loadVenueTikTokCreatives } from "../venue-tiktok-creatives.ts";
import {
  liveTikTokThumbnailUrl,
  venueCreativesLayout,
} from "../venue-tiktok-creatives-view.ts";

const CLIENT_ID = "f7ed8aef-8527-4c3e-a16a-a05fc38861f5";
const NOW = new Date("2026-11-04T15:00:00Z");

interface EventFixture {
  id: string;
  name: string;
  client_id: string;
  event_code: string;
  kind: string;
  event_date: string | null;
  event_start_at: string | null;
  campaign_end_at: string | null;
}

interface SnapshotFixture {
  event_id: string;
  window_since: string;
  window_until: string;
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  video_views_2s: number | null;
  thumbnail_url: string | null;
}

interface RollupFixture {
  event_id: string;
  date: string;
  tiktok_spend: number;
}

type Filter = { col: string; op: "eq" | "gte" | "lte" | "gt"; value: unknown };

function eqValue(filters: Filter[], col: string): unknown {
  return filters.find((f) => f.op === "eq" && f.col === col)?.value;
}

function makeClient(fixture: {
  events: EventFixture[];
  snapshots: SnapshotFixture[];
  rollups: RollupFixture[];
}) {
  const queries: Array<{ table: string; select: string; filters: Filter[] }> = [];

  function rowsFor(table: string, select: string, filters: Filter[]): unknown[] {
    const eq = (row: Record<string, unknown>) =>
      filters.every(({ col, op, value }) => {
        const v = row[col];
        if (op === "eq") return v === value;
        if (op === "gte") return String(v) >= String(value);
        if (op === "lte") return String(v) <= String(value);
        return Number(v) > Number(value);
      });
    if (table === "events") {
      return fixture.events.filter((r) => eq({ ...r }));
    }
    if (table === "event_daily_rollups") {
      return fixture.rollups
        .filter((r) => eq({ ...r }))
        .map(() => ({ source_tiktok_at: "2026-11-04T10:00:00Z" }));
    }
    if (table === "tiktok_active_creatives_snapshots") {
      const rows = fixture.snapshots
        .filter((r) => eq({ ...r, kind: "ok" }))
        .sort((a, b) => a.window_since.localeCompare(b.window_since));
      if (select === "window_since") {
        return rows.map((r) => ({ window_since: r.window_since }));
      }
      return rows.map((r) => ({
        ad_id: r.ad_id,
        ad_name: r.ad_name,
        campaign_id: r.campaign_id,
        campaign_name: `[${r.event_id}] campaign`,
        status: "ACTIVE",
        spend: r.spend,
        impressions: r.impressions,
        reach: null,
        clicks: r.clicks,
        ctr: null,
        video_views_2s: r.video_views_2s,
        video_views_6s: null,
        video_views_100p: null,
        thumbnail_url: r.thumbnail_url,
        deeplink_url: null,
        ad_text: null,
        fetched_at: "2026-11-04T14:34:24.470Z",
        video_id: null,
        image_ids: null,
        tiktok_item_id: null,
        identity_id: null,
        identity_type: null,
      }));
    }
    return [];
  }

  const client = {
    from(table: string) {
      const query = { table, select: "", filters: [] as Filter[] };
      queries.push(query);
      const add = (op: Filter["op"]) => (col: string, value: unknown) => {
        query.filters.push({ col, op, value });
        return builder;
      };
      const builder = {
        select(columns: string) {
          query.select = columns;
          return builder;
        },
        eq: add("eq"),
        gte: add("gte"),
        lte: add("lte"),
        gt: add("gt"),
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle() {
          const rows = rowsFor(table, query.select, query.filters);
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then(resolve: (value: unknown) => unknown) {
          const rows = rowsFor(table, query.select, query.filters);
          return Promise.resolve(resolve({ data: rows, error: null }));
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

const brandAwareness: EventFixture = {
  id: "brand-awareness",
  name: "Brand Awareness (Always-On)",
  client_id: CLIENT_ID,
  event_code: "IRWOHD",
  kind: "brand_campaign",
  event_date: null,
  event_start_at: "2026-05-22 00:00:00+00",
  campaign_end_at: "2026-11-01 23:59:59+00",
};

function snapshot(
  over: Partial<SnapshotFixture> & Pick<SnapshotFixture, "ad_id">,
): SnapshotFixture {
  return {
    event_id: brandAwareness.id,
    window_since: "2026-05-22",
    window_until: "2026-11-01",
    ad_name: over.ad_id,
    campaign_id: "c1",
    spend: 10,
    impressions: 1000,
    clicks: 10,
    video_views_2s: 100,
    thumbnail_url: null,
    ...over,
  };
}

describe("loadVenueTikTokCreatives", () => {
  it("returns TikTok groups for an event with snapshot rows and none for an event without", async () => {
    const noSnapshot: EventFixture = {
      ...brandAwareness,
      id: "no-snapshot",
      name: "Second brand flight",
    };
    const { client, queries } = makeClient({
      events: [brandAwareness, noSnapshot],
      snapshots: [
        snapshot({ ad_id: "a1", ad_name: "VID 1", spend: 40 }),
        snapshot({ ad_id: "a2", ad_name: "VID 2", spend: 150 }),
      ],
      rollups: [
        { event_id: brandAwareness.id, date: "2026-10-01", tiktok_spend: 190 },
        { event_id: noSnapshot.id, date: "2026-10-01", tiktok_spend: 50 },
      ],
    });

    const groups = await loadVenueTikTokCreatives(client, {
      clientId: CLIENT_ID,
      eventCode: "IRWOHD",
      now: NOW,
    });

    assert.equal(groups.length, 1);
    assert.equal(groups[0].event_id, brandAwareness.id);
    assert.deepEqual(
      groups[0].cards.map((c) => [c.display_name, c.spend]),
      [
        ["VID 2", 150],
        ["VID 1", 40],
      ],
    );
    assert.ok(
      !queries.some((q) => q.table === "clients"),
      "client status is not consulted, same as the Meta venue creatives",
    );
  });

  it("returns no groups for a venue whose events have no snapshot", async () => {
    const { client } = makeClient({
      events: [brandAwareness],
      snapshots: [],
      rollups: [
        { event_id: brandAwareness.id, date: "2026-10-01", tiktok_spend: 190 },
      ],
    });
    const groups = await loadVenueTikTokCreatives(client, {
      clientId: CLIENT_ID,
      eventCode: "IRWOHD",
      now: NOW,
    });
    assert.deepEqual(groups, []);
  });

  it("reads the snapshot at the share report's canonical window", async () => {
    const fixture = {
      events: [brandAwareness],
      snapshots: [
        snapshot({ ad_id: "old", window_until: "2026-10-23", spend: 999 }),
        snapshot({ ad_id: "current", spend: 25 }),
      ],
      rollups: [
        { event_id: brandAwareness.id, date: "2026-10-13", tiktok_spend: 25 },
      ],
    };
    const { client, queries } = makeClient(fixture);
    const groups = await loadVenueTikTokCreatives(client, {
      clientId: CLIENT_ID,
      eventCode: "IRWOHD",
      now: NOW,
    });

    const canonical = await resolveCanonicalTikTokWindow(
      makeClient(fixture).client,
      brandAwareness,
      NOW,
    );
    assert.equal(canonical.source, "computed");
    assert.deepEqual(
      { since: canonical.since, until: canonical.until },
      { since: "2026-05-22", until: "2026-11-01" },
    );

    const snapshotRead = queries.find(
      (q) =>
        q.table === "tiktok_active_creatives_snapshots" &&
        q.select !== "window_since",
    );
    assert.ok(snapshotRead);
    assert.equal(eqValue(snapshotRead.filters, "window_since"), canonical.since);
    assert.equal(eqValue(snapshotRead.filters, "window_until"), canonical.until);
    assert.deepEqual(
      groups[0].cards.map((c) => c.spend),
      [25],
    );
    assert.deepEqual(groups[0].window, {
      since: canonical.since,
      until: canonical.until,
    });
  });

  it("skips the snapshot when the window is not computed, as the share report does", async () => {
    const { client, queries } = makeClient({
      events: [brandAwareness],
      snapshots: [snapshot({ ad_id: "a1" })],
      rollups: [],
    });
    const groups = await loadVenueTikTokCreatives(client, {
      clientId: CLIENT_ID,
      eventCode: "IRWOHD",
      now: NOW,
    });
    assert.deepEqual(groups, []);
    assert.ok(
      !queries.some(
        (q) =>
          q.table === "tiktok_active_creatives_snapshots" &&
          q.select !== "window_since",
      ),
    );
  });

  it("leaves CPC and video views blank when the snapshot has no value, and drops undelivered ads", async () => {
    const { client } = makeClient({
      events: [brandAwareness],
      snapshots: [
        snapshot({ ad_id: "a1", ad_name: "VID 3", clicks: 0, video_views_2s: null }),
        snapshot({ ad_id: "a2", ad_name: "Never served", spend: 0, impressions: 0 }),
      ],
      rollups: [
        { event_id: brandAwareness.id, date: "2026-10-01", tiktok_spend: 10 },
      ],
    });
    const groups = await loadVenueTikTokCreatives(client, {
      clientId: CLIENT_ID,
      eventCode: "IRWOHD",
      now: NOW,
    });
    assert.equal(groups[0].cards.length, 1);
    const card = groups[0].cards[0];
    assert.equal(card.display_name, "VID 3");
    assert.equal(card.cpc, null);
    assert.equal(card.video_views_2s, null);
  });
});

describe("liveTikTokThumbnailUrl", () => {
  const base = "https://p16-common-sign.tiktokcdn.com/obj/abc~tplv.jpeg";
  it("drops a signed URL whose x-expires has passed", () => {
    const expiresAt = Math.floor(NOW.getTime() / 1000) - 60;
    assert.equal(
      liveTikTokThumbnailUrl(`${base}?x-expires=${expiresAt}&x-signature=s`, NOW),
      null,
    );
  });
  it("keeps an unexpired signed URL and an unsigned URL", () => {
    const expiresAt = Math.floor(NOW.getTime() / 1000) + 3600;
    const signed = `${base}?x-expires=${expiresAt}&x-signature=s`;
    assert.equal(liveTikTokThumbnailUrl(signed, NOW), signed);
    assert.equal(liveTikTokThumbnailUrl(base, NOW), base);
  });
  it("returns null for a missing URL", () => {
    assert.equal(liveTikTokThumbnailUrl(null, NOW), null);
  });
});

describe("venueCreativesLayout", () => {
  it("platform=tiktok renders TikTok groups instead of the not-wired card", () => {
    const layout = venueCreativesLayout("tiktok", 2);
    assert.equal(layout.notWired, null);
    assert.equal(layout.showTikTok, true);
    assert.equal(layout.showMeta, false);
    assert.equal(layout.fetchMeta, false);
  });
  it("platform=all shows Meta then TikTok as labelled groups", () => {
    assert.deepEqual(venueCreativesLayout("all", 1), {
      fetchMeta: true,
      fetchTikTok: true,
      showMeta: true,
      showTikTok: true,
      labelPlatformGroups: true,
      notWired: null,
    });
  });
  it("platform=all without TikTok groups is the Meta-only section", () => {
    const layout = venueCreativesLayout("all", 0);
    assert.equal(layout.showTikTok, false);
    assert.equal(layout.labelPlatformGroups, false);
  });
  it("platform=meta never fetches TikTok", () => {
    const layout = venueCreativesLayout("meta", 3);
    assert.equal(layout.fetchTikTok, false);
    assert.equal(layout.showTikTok, false);
  });
  it("platform=google_ads keeps the not-wired card", () => {
    const layout = venueCreativesLayout("google_ads", 3);
    assert.equal(layout.notWired, "google_ads");
    assert.equal(layout.showMeta, false);
    assert.equal(layout.showTikTok, false);
  });
});
