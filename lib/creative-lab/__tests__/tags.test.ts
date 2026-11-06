import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { CREATIVE_TAG_DIMENSIONS } from "../../db/creative-tags.ts";
import { computeTagPerformance } from "../../learning/tag-performance.ts";
import { CLIENTS, fact, NOW } from "../../learning/__tests__/fixtures.ts";
import type { ServiceRoleDb } from "../load.ts";
import { assignCaptionStyleTag, CAPTION_STYLES, CREATIVE_LAB_DIMENSIONS, voiceForStyle } from "../tags.ts";
import { fakeDb } from "./fake-db.ts";

const P26 = {
  events: [
    { id: "evt-umbrella", client_id: "client-puzzle", event_code: "P26-BDAY", meta_ad_account_id: null },
    { id: "evt-day", client_id: "client-puzzle", event_code: "P26-BDAY-DAY", meta_ad_account_id: null },
  ],
  clients: [{ id: "client-puzzle", meta_ad_account_id: "act_1058599195559790" }],
};

function db(extra: Record<string, Record<string, unknown>[]> = {}) {
  return fakeDb({ launched_ads: [], launched_ad_sets: [], ad_daily_insights: [], creative_tags: [], creative_tag_assignments: [], ...P26, ...extra });
}

describe("creative lab tags: caption_style", () => {
  it("is a Lab dimension, never one the AI auto-tagger is asked for", () => {
    assert.deepEqual([...CREATIVE_LAB_DIMENSIONS], ["caption_style"]);
    assert.equal((CREATIVE_TAG_DIMENSIONS as readonly string[]).includes("caption_style"), false);
  });

  it("writes the tag row and an assignment on the event the ad resolves to, not the round's show event", async () => {
    const fake = db({
      ad_daily_insights: [
        {
          meta_ad_id: "ad-1",
          meta_adset_id: "as-on-sale",
          campaign_name: "[P26-BDAY] Puzzle - 27 Dec - On Sale",
          ad_account_id: "act_1058599195559790",
          date: "2026-11-01",
        },
      ],
      launched_ad_sets: [{ id: "l1", meta_adset_id: "as-on-sale", client_id: "client-puzzle", event_id: "evt-umbrella" }],
    });
    const args = { userId: "op", eventId: "evt-day", metaAdId: "ad-1", creativeName: "LUKEDEAN-clip01_cap-lineup1", style: "lineup" as const };
    const first = await assignCaptionStyleTag(fake as unknown as ServiceRoleDb, args);
    assert.deepEqual([first.eventId, first.eventSource], ["evt-umbrella", "launched_ad_sets"]);

    const [tag] = fake.tables.creative_tags;
    assert.deepEqual(
      [tag.user_id, tag.dimension, tag.value_key, tag.value_label, tag.source],
      ["op", "caption_style", "lineup", "Lineup", "creative_lab"],
    );
    const [assignment] = fake.tables.creative_tag_assignments;
    assert.deepEqual(
      [assignment.event_id, assignment.creative_name, assignment.tag_id, assignment.source, assignment.confidence, assignment.meta_ad_id],
      ["evt-umbrella", "LUKEDEAN-clip01_cap-lineup1", tag.id, "creative_lab", 1, "ad-1"],
    );

    const again = await assignCaptionStyleTag(fake as unknown as ServiceRoleDb, args);
    assert.equal(again.tagId, first.tagId);
    assert.equal(fake.tables.creative_tags.length, 1);
    assert.equal(fake.tables.creative_tag_assignments.length, 1);
  });

  it("resolves by [EVENT_CODE] when the app did not launch the ad set; the exact code wins over a longer one", async () => {
    const fake = db({
      ad_daily_insights: [
        {
          meta_ad_id: "ad-2",
          meta_adset_id: "as-manual",
          campaign_name: "[P26-BDAY] Puzzle - 27 Dec - SIGNUP",
          ad_account_id: "act_1058599195559790",
          date: "2026-10-25",
        },
      ],
    });
    const out = await assignCaptionStyleTag(fake as unknown as ServiceRoleDb, {
      userId: "op",
      eventId: "evt-day",
      metaAdId: "ad-2",
      creativeName: "LUKEDEAN-clip02_cap-question1",
      style: "question",
    });
    assert.deepEqual([out.eventId, out.eventSource], ["evt-umbrella", "campaign_code"]);
  });

  it("falls back to the round's event when the ad has no ledger row and no ad-day yet", async () => {
    const out = await assignCaptionStyleTag(db() as unknown as ServiceRoleDb, {
      userId: "op",
      eventId: "evt-day",
      metaAdId: "ad-new",
      creativeName: "LUKEDEAN-clip03_cap-lineup2",
      style: "lineup",
    });
    assert.deepEqual([out.eventId, out.eventSource], ["evt-day", "round"]);
  });

  it("rejects a style outside the four", async () => {
    await assert.rejects(
      assignCaptionStyleTag(db() as unknown as ServiceRoleDb, {
        userId: "op",
        eventId: "evt-day",
        metaAdId: "ad-x",
        creativeName: "X",
        style: "hype" as "lineup",
      }),
      /unknown caption style/,
    );
  });

  it("flows through tag_performance like any other dimension", () => {
    const tags = new Map([
      ["t-cap-lineup", { id: "t-cap-lineup", dimension: "caption_style", value_key: "lineup", value_label: "Lineup" }],
    ]);
    const facts = [
      fact({ meta_ad_id: "ad-1", date: "2026-10-01", spend: 20, registrations: 4 }, { clientId: "client-a", tagIds: ["t-cap-lineup"] }),
      fact({ meta_ad_id: "ad-2", date: "2026-10-01", spend: 10, registrations: 1 }, { clientId: "client-a", tagIds: [] }),
    ];
    const rows = computeTagPerformance(facts, CLIENTS, tags, { now: NOW });
    const client = rows.find((r) => r.scope === "client" && r.dimension === "caption_style");
    assert.ok(client);
    assert.deepEqual([client.value_key, client.stage, client.ads, client.results], ["lineup", "registration", 1, 4]);
  });

  it("takes the voice from the style, and migration 200 lists every style", () => {
    assert.equal(voiceForStyle("artist_first_person"), "artist");
    assert.equal(voiceForStyle("lineup"), "promoter");
    const migration = readFileSync(new URL("../../../supabase/migrations/200_creative_lab_m3.sql", import.meta.url), "utf8");
    for (const style of CAPTION_STYLES) assert.match(migration, new RegExp(`'${style}'`));
  });
});
