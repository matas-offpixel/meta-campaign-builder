import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { deriveFunnelTargetsFromSoldOutEvents } from "../funnel-pacing-derive.ts";

describe("deriveFunnelTargetsFromSoldOutEvents", () => {
  test("averages sold-out event rollups into target metrics", () => {
    const result = deriveFunnelTargetsFromSoldOutEvents(
      [
        { id: "e1", name: "Older sellout", event_date: "2026-04-01" },
        { id: "e2", name: "Latest sellout", event_date: "2026-04-20" },
      ],
      [
        {
          event_id: "e1",
          ad_spend: 100,
          link_clicks: 1000,
          tickets_sold: 100,
          meta_reach: 10000,
        },
        {
          event_id: "e2",
          ad_spend: 300,
          link_clicks: 3000,
          tickets_sold: 300,
          meta_reach: 30000,
        },
      ],
    );

    assert.equal(result?.tofu_target_reach, 20000);
    assert.equal(result?.mofu_target_clicks, 2000);
    assert.equal(result?.bofu_target_purchases, 200);
    assert.equal(result?.derived_from_event_id, "e2");
  });
});
