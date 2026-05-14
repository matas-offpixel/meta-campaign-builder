/**
 * lib/insights/__tests__/fetchEventLifetimeMetaMetrics.test.ts
 *
 * Cat F regression tests for the two-pass lifetime fetch (PR #418,
 * audit Section 5 + Joe's Cat F fix in PR #417). Pinned to the
 * production figures Joe observed on 2026-05-14 21:02 UTC for
 * `WC26-MANCHESTER`:
 *
 *   - Per-campaign reach SUM across 8 matching campaigns: **932,982**
 *   - Account-level cross-campaign DEDUP reach: **805,264**
 *   - Drift: +15.9% (the original Cat F bug surface)
 *
 * Tests target the pure aggregation primitives extracted to
 * `lib/insights/event-code-lifetime-two-pass.ts` so they can run under
 * `node --experimental-strip-types --test` without resolving the `@/`
 * alias graph that `meta.ts` pulls in (Supabase, server-only auth,
 * etc.). The orchestration layer in `meta.ts` is one thin wrapper that
 * paginates via `graphGetWithToken` and forwards to these primitives —
 * if the primitives are correct, the orchestration is correct.
 *
 * Coverage:
 *   1. Pass 1 → Pass 2 reach combiner returns account-dedup reach,
 *      NOT the per-campaign sum (THE Cat F fix).
 *   2. Pass 2 fallback to per-campaign sum when account row is missing
 *      or returns reach=0 (defensive against Meta transients).
 *   3. Bracket post-filter rejects case-mismatched campaigns (kept
 *      from pre-PR #418 behaviour — verified against the dash-norm
 *      `campaignMatchesBracketedEventCode` invariant).
 *   4. Pass 1 sums additive metrics (impressions / clicks / regs /
 *      video / engagements) across campaigns.
 *   5. `buildPass2CampaignIdFilter` produces the exact `IN` filter
 *      shape Meta requires.
 *   6. `aggregatePass1Pages` exposes matched IDs in the order they
 *      were encountered (drives Pass 2's filter, deterministic for
 *      logging / tests).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aggregatePass1Pages,
  buildPass2CampaignIdFilter,
  combineTwoPassReach,
} from "../event-code-lifetime-two-pass.ts";

describe("combineTwoPassReach (Cat F resolver)", () => {
  it("Manchester: returns 805k account-dedup, NOT 933k per-campaign sum", () => {
    // The exact 8-campaign Manchester scenario from Joe's PR #417 comment.
    const PER_CAMPAIGN_SUM = 932_982;
    const ACCOUNT_DEDUP = 805_264;
    const result = combineTwoPassReach({
      perCampaignSum: PER_CAMPAIGN_SUM,
      accountRow: { reach: String(ACCOUNT_DEDUP) },
    });
    assert.equal(
      result.reach,
      ACCOUNT_DEDUP,
      `Cat F regression: combiner returned reach=${result.reach}, expected account-dedup=${ACCOUNT_DEDUP}`,
    );
    assert.notEqual(
      result.reach,
      PER_CAMPAIGN_SUM,
      "Cat F regression: combiner must NOT return the per-campaign sum",
    );
    assert.equal(result.source, "account_dedup");
  });

  it("falls back to per-campaign sum when Pass 2 returned no row", () => {
    const result = combineTwoPassReach({
      perCampaignSum: 300,
      accountRow: undefined,
    });
    assert.equal(result.reach, 300);
    assert.equal(result.source, "campaign_sum_fallback");
  });

  it("falls back to per-campaign sum when Pass 2 returned reach=0", () => {
    // Meta sometimes returns a zero-row response on transient internal
    // errors. We DO NOT silently coerce to 0 — the venue card would
    // then render `—` which is visually worse than the slightly-
    // inflated per-campaign sum.
    const result = combineTwoPassReach({
      perCampaignSum: 50,
      accountRow: { reach: "0" },
    });
    assert.equal(result.reach, 50);
    assert.equal(result.source, "campaign_sum_fallback");
  });

  it("handles missing reach field on account row", () => {
    const result = combineTwoPassReach({
      perCampaignSum: 75,
      accountRow: { frequency: "1.2" },
    });
    assert.equal(result.reach, 75);
    assert.equal(result.source, "campaign_sum_fallback");
  });
});

describe("aggregatePass1Pages", () => {
  it("collects matched campaign IDs in encounter order", () => {
    const result = aggregatePass1Pages(
      [
        {
          data: [
            { campaign_id: "c1", campaign_name: "[WC26-BRIGHTON] BOFU" },
            { campaign_id: "c2", campaign_name: "[WC26-BRIGHTON] Presale" },
          ],
        },
        {
          data: [
            { campaign_id: "c3", campaign_name: "[WC26-BRIGHTON] Conversion" },
          ],
        },
      ],
      "WC26-BRIGHTON",
    );
    assert.deepEqual(result.matchedCampaignIds, ["c1", "c2", "c3"]);
    assert.equal(result.matchedCampaignNames.length, 3);
  });

  it("rejects case-mismatched campaigns and tracks them in filteredOut", () => {
    // Meta's `CONTAIN` filter is case-insensitive; the bracket post-
    // filter MUST drop a campaign like `[wc26-manchester]` when the
    // event_code is `WC26-MANCHESTER` (different casing) so reach
    // from a sub-fixture variant doesn't bleed into the cache.
    const result = aggregatePass1Pages(
      [
        {
          data: [
            {
              campaign_id: "ok",
              campaign_name: "[WC26-MANCHESTER] V2",
              reach: "100",
            },
            {
              campaign_id: "drop",
              campaign_name: "[wc26-manchester-LATER] V3",
              reach: "999",
            },
          ],
        },
      ],
      "WC26-MANCHESTER",
    );
    assert.deepEqual(result.matchedCampaignIds, ["ok"]);
    assert.equal(result.matchedCampaignNames.length, 1);
    assert.equal(result.matchedCampaignNames[0], "[WC26-MANCHESTER] V2");
    // Reach from the rejected campaign MUST NOT be summed.
    assert.equal(result.perCampaignReachSum, 100);
    assert.ok(
      result.filteredOutCampaignNames.includes("[wc26-manchester-LATER] V3"),
      "rejected campaign must surface in filteredOut for diagnostics",
    );
  });

  it("sums additive metrics across campaigns and pages", () => {
    const result = aggregatePass1Pages(
      [
        {
          data: [
            {
              campaign_id: "c1",
              campaign_name: "[WC26-BRISTOL] BOFU",
              impressions: "1000",
              reach: "100",
              inline_link_clicks: "20",
              actions: [
                { action_type: "complete_registration", value: "5" },
                { action_type: "video_view", value: "100" },
                { action_type: "video_15_sec_watched_actions", value: "30" },
                { action_type: "video_p100_watched_actions", value: "5" },
                { action_type: "post_engagement", value: "60" },
              ],
            },
          ],
        },
        {
          data: [
            {
              campaign_id: "c2",
              campaign_name: "[WC26-BRISTOL] Presale",
              impressions: "2000",
              reach: "200",
              inline_link_clicks: "40",
              actions: [
                {
                  action_type:
                    "offsite_conversion.fb_pixel_complete_registration",
                  value: "7",
                },
                { action_type: "video_view", value: "300" },
                { action_type: "post_engagement", value: "90" },
              ],
            },
          ],
        },
      ],
      "WC26-BRISTOL",
    );

    assert.equal(result.impressions, 3000);
    assert.equal(result.linkClicks, 60);
    assert.equal(result.metaRegs, 12);
    assert.equal(result.videoPlays3s, 400);
    assert.equal(result.videoPlays15s, 30);
    assert.equal(result.videoPlaysP100, 5);
    assert.equal(result.engagements, 150);
    // Pass 1 collects per-campaign reach sum as Pass-2 fallback only.
    assert.equal(result.perCampaignReachSum, 300);
  });

  it("returns empty result when no campaigns match (Pass 2 will be skipped)", () => {
    const result = aggregatePass1Pages(
      [
        {
          data: [
            // CONTAIN filter would let through but bracket filter rejects.
            {
              campaign_id: "x",
              campaign_name: "[OTHER-EVENT] BOFU",
              reach: "999",
            },
          ],
        },
      ],
      "WC26-NOWHERE",
    );
    assert.equal(result.matchedCampaignIds.length, 0);
    assert.equal(result.matchedCampaignNames.length, 0);
    assert.equal(result.perCampaignReachSum, 0);
    assert.equal(result.impressions, 0);
  });

  it("ignores rows missing campaign_id (defensive — Pass 1 must request this field)", () => {
    // Defensive: Meta has been observed dropping campaign_id when an
    // older API version is sticky on the access token. We still match
    // by name; the missing ID just means that campaign won't be in
    // Pass 2's IN filter (it'd over-include reach via the broader
    // account scope, but for THIS event_code that means "every
    // matched campaign INCLUDING THIS ONE" — so reach is correct).
    const result = aggregatePass1Pages(
      [
        {
          data: [
            { campaign_name: "[WC26-EDINBURGH] BOFU", reach: "50" },
            {
              campaign_id: "c2",
              campaign_name: "[WC26-EDINBURGH] Presale",
              reach: "75",
            },
          ],
        },
      ],
      "WC26-EDINBURGH",
    );
    assert.deepEqual(result.matchedCampaignIds, ["c2"]);
    assert.equal(result.matchedCampaignNames.length, 2);
    assert.equal(result.perCampaignReachSum, 125);
  });
});

describe("buildPass2CampaignIdFilter", () => {
  it("emits the exact { field, operator, value } shape Meta expects", () => {
    const filter = buildPass2CampaignIdFilter(["abc", "def", "ghi"]);
    const parsed = JSON.parse(filter);
    assert.equal(parsed.length, 1);
    assert.deepEqual(parsed[0], {
      field: "campaign.id",
      operator: "IN",
      value: ["abc", "def", "ghi"],
    });
  });

  it("preserves the order of campaign IDs (deterministic for logs / tests)", () => {
    const filter = buildPass2CampaignIdFilter(["c3", "c1", "c2"]);
    const parsed = JSON.parse(filter);
    assert.deepEqual(parsed[0]!.value, ["c3", "c1", "c2"]);
  });
});
