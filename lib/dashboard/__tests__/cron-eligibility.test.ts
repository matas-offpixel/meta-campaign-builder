import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  computeSaleDateWindow,
  filterCodeMatchEligibleIds,
  mergeActiveCreativesEligibilityIds,
  mergeRollupSyncEligibilityIds,
} from "../cron-eligibility.ts";

describe("computeSaleDateWindow", () => {
  const now = new Date("2026-07-28T12:00:00.000Z");

  it("computes a ±30-day window (active-creatives / autotag cron)", () => {
    const { sinceISO, untilISO } = computeSaleDateWindow(now, 30);
    assert.equal(sinceISO, "2026-06-28T12:00:00.000Z");
    assert.equal(untilISO, "2026-08-27T12:00:00.000Z");
  });

  it("computes a ±60-day window (rollup-sync cron — load-bearing, do not change)", () => {
    const { sinceISO, untilISO } = computeSaleDateWindow(now, 60);
    assert.equal(sinceISO, "2026-05-29T12:00:00.000Z");
    assert.equal(untilISO, "2026-09-26T12:00:00.000Z");
  });
});

describe("cron eligibility merging", () => {
  it("keeps active-creatives on linked-and-dated plus code-match fallback", () => {
    assert.deepEqual(
      mergeActiveCreativesEligibilityIds({
        ticketingIds: ["ticketing-only", "both"],
        saleDateIds: ["sale-date-only", "both"],
        codeMatchIds: ["code-match-only"],
      }),
      ["both", "code-match-only"],
    );
  });

  it("keeps rollup-sync loose across ticketing, sale-date, google, code-match, and brand-campaign legs", () => {
    assert.deepEqual(
      mergeRollupSyncEligibilityIds({
        ticketingIds: ["ticketing-only", "union-dup"],
        saleDateIds: ["sale-date-only", "union-dup"],
        googleAdsIds: ["google-ads-only"],
        codeMatchIds: ["code-match-only"],
        brandCampaignIds: ["brand-campaign-only"],
      }),
      [
        "ticketing-only",
        "union-dup",
        "sale-date-only",
        "google-ads-only",
        "code-match-only",
        "brand-campaign-only",
      ],
    );
  });
});

describe("filterCodeMatchEligibleIds", () => {
  const now = new Date("2026-05-02T12:00:00Z");

  it("includes on-sale/live event-code rows with null or recent event dates", () => {
    assert.deepEqual(
      filterCodeMatchEligibleIds(
        [
          {
            id: "code-match-null-date",
            event_code: "WC26-MANCHESTER",
            status: "on_sale",
            event_date: null,
          },
          {
            id: "code-match-recent",
            event_code: "WC26-LONDON-KENTISH",
            status: "live",
            event_date: "2026-04-26",
          },
        ],
        now,
      ),
      ["code-match-null-date", "code-match-recent"],
    );
  });

  it("excludes code-match rows without populated code, valid status, or recent event date", () => {
    assert.deepEqual(
      filterCodeMatchEligibleIds(
        [
          {
            id: "too-old",
            event_code: "OP-TITLERUNIN-LONDON",
            status: "on_sale",
            event_date: "2025-10-01",
          },
          {
            id: "no-code",
            event_code: "",
            status: "on_sale",
            event_date: null,
          },
          {
            id: "wrong-status",
            event_code: "WC26-BIRMINGHAM",
            status: "completed",
            event_date: "2026-04-26",
          },
        ],
        now,
      ),
      [],
    );
  });
});
