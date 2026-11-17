/** panel-read: each test carries its ad set's name as Approve made it (TT8), from launched_ad_sets. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { memoryDb } from "../../onsale-refresh/__tests__/memory-db.ts";
import { loadTestInputs } from "../panel-read.ts";
import { buildPanel } from "../panel-view.ts";

const base = { kind: "statics", runs_in: "tests_adset", result_event: "complete_registration", currency: "GBP", budget_pct: 15.38, at_minimum: true, first_delivery_at: "2026-11-24T08:00:00.000Z", winner_variant_id: null };

describe("panel-read: the test ad set's name", () => {
  it("takes the name from launched_ad_sets, so the panel line shows the full, dated name", async () => {
    const mem = memoryDb({
      creative_tests: [
        { id: "t1", event_id: "ev1", n: 1, format: "statics", state: "no_clear_winner", daily_budget_minor: 100, meta_adset_id: "as-1", ...base },
        { id: "t2", event_id: "ev1", n: 2, format: "statics", state: "no_clear_winner", daily_budget_minor: 100, meta_adset_id: "as-2", ...base },
        { id: "t3", event_id: "ev1", n: 3, format: "video", state: "waiting", daily_budget_minor: null, meta_adset_id: null, ...base },
      ],
      creative_test_variants: [],
      creative_test_reads: [],
      launched_ad_sets: [
        { meta_adset_id: "as-1", source_name: "NX26-LOCKLEAD · Tests · Statics · 24 Nov" },
        { meta_adset_id: "as-2", source_name: "NX26-LOCKLEAD · Tests · Statics · 24 Nov · 2" },
      ],
    });
    const inputs = await loadTestInputs(mem.db, ["ev1"]);
    assert.deepEqual(inputs.tests.map((t) => [t.id, t.adset_name ?? null]), [["t1", "NX26-LOCKLEAD · Tests · Statics · 24 Nov"], ["t2", "NX26-LOCKLEAD · Tests · Statics · 24 Nov · 2"], ["t3", null]]);
    const view = buildPanel({ eventCode: "NX26-LOCKLEAD", ...inputs, now: "2026-11-28T09:00:00.000Z" });
    assert.equal(view.cards[1]!.pause?.title, "Pause NX26-LOCKLEAD · Tests · Statics · 24 Nov · 2");
  });
});
