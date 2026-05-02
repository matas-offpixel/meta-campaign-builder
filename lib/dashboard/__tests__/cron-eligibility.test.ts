import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  filterCodeMatchEligibleIds,
  mergeActiveCreativesEligibilityIds,
  mergeRollupSyncEligibilityIds,
} from "../cron-eligibility.ts";

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

  it("keeps rollup-sync loose across ticketing, sale-date, google, and code-match legs", () => {
    assert.deepEqual(
      mergeRollupSyncEligibilityIds({
        ticketingIds: ["ticketing-only", "union-dup"],
        saleDateIds: ["sale-date-only", "union-dup"],
        googleAdsIds: ["google-ads-only"],
        codeMatchIds: ["code-match-only"],
      }),
      [
        "ticketing-only",
        "union-dup",
        "sale-date-only",
        "google-ads-only",
        "code-match-only",
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
