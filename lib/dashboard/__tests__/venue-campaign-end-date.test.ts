/**
 * Regression tests for per-venue campaign end date (MAX event_date).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { venueCampaignEndDate } from "../venue-campaign-end-date.ts";
import { buildVenueCanonicalFunnel } from "../venue-canonical-funnel.ts";

const TODAY = new Date("2026-05-29T12:00:00Z");

function fixtures(
  dates: Array<string | null>,
): Array<{ event_date: string | null }> {
  return dates.map((event_date) => ({ event_date }));
}

describe("venueCampaignEndDate", () => {
  it("WC26-EDINBURGH: MAX upcoming group game = 24 Jun (Brazil)", () => {
    const end = venueCampaignEndDate(
      fixtures(["2026-06-13", "2026-06-19", "2026-06-24"]),
      TODAY,
    );
    assert.equal(end, "2026-06-24");
  });

  it("WC26-EDINBURGH: auto-corrects when Scotland Last 32 lands (29 Jun)", () => {
    const end = venueCampaignEndDate(
      fixtures([
        "2026-06-13",
        "2026-06-19",
        "2026-06-24",
        "2026-06-29",
      ]),
      TODAY,
    );
    assert.equal(end, "2026-06-29");
  });

  it("WC26-BRIGHTON: MAX = 1 Jul (England Last 32 already in DB)", () => {
    const end = venueCampaignEndDate(
      fixtures(["2026-06-17", "2026-06-23", "2026-06-27", "2026-07-01"]),
      TODAY,
    );
    assert.equal(end, "2026-07-01");
  });

  it("single-fixture venue: MAX equals that fixture (no behaviour change)", () => {
    const end = venueCampaignEndDate(fixtures(["2026-07-26"]), TODAY);
    assert.equal(end, "2026-07-26");
  });

  it("all fixtures past: returns latest past date", () => {
    const end = venueCampaignEndDate(
      fixtures(["2026-04-19", "2026-05-20", "2026-05-24"]),
      TODAY,
    );
    assert.equal(end, "2026-05-24");
  });

  it("no dates: returns null", () => {
    assert.equal(venueCampaignEndDate(fixtures([null, null]), TODAY), null);
    assert.equal(venueCampaignEndDate([], TODAY), null);
  });
});

describe("venueCampaignEndDate → buildVenueCanonicalFunnel daysToEvent", () => {
  it("Edinburgh 24 Jun → 26 days from 29 May", () => {
    const end = venueCampaignEndDate(
      fixtures(["2026-06-13", "2026-06-19", "2026-06-24"]),
      TODAY,
    );
    const funnel = buildVenueCanonicalFunnel({
      capacity: 5_475,
      ticketsSold: 3_856,
      lifetimeCacheRow: null,
      dailyRollups: [],
      eventDate: end,
      today: TODAY,
    });
    assert.equal(funnel.backwardRead.daysToEvent, 26);
  });

  it("Brighton 1 Jul → 33 days from 29 May", () => {
    const end = venueCampaignEndDate(
      fixtures(["2026-06-17", "2026-06-23", "2026-06-27", "2026-07-01"]),
      TODAY,
    );
    const funnel = buildVenueCanonicalFunnel({
      capacity: 4_000,
      ticketsSold: 2_000,
      lifetimeCacheRow: null,
      dailyRollups: [],
      eventDate: end,
      today: TODAY,
    });
    assert.equal(funnel.backwardRead.daysToEvent, 33);
  });

  it("event passed: daysToEvent ≤ 0, requiredPerDay suppressed", () => {
    const end = venueCampaignEndDate(
      fixtures(["2026-04-19", "2026-05-20"]),
      TODAY,
    );
    const funnel = buildVenueCanonicalFunnel({
      capacity: 1_000,
      ticketsSold: 800,
      lifetimeCacheRow: null,
      dailyRollups: [],
      eventDate: end,
      allocatedBudget: 5_000,
      today: TODAY,
    });
    assert.equal(end, "2026-05-20");
    assert.ok((funnel.backwardRead.daysToEvent ?? 0) <= 0);
    assert.equal(funnel.spendReconciliation.requiredPerDayState, "event_passed");
    assert.equal(funnel.spendReconciliation.requiredPerDay, null);
  });

  it("sold out: requiredPerDay suppressed even with future campaign end", () => {
    const end = venueCampaignEndDate(
      fixtures(["2026-06-13", "2026-06-24"]),
      TODAY,
    );
    const funnel = buildVenueCanonicalFunnel({
      capacity: 1_000,
      ticketsSold: 1_000,
      lifetimeCacheRow: null,
      dailyRollups: [],
      eventDate: end,
      allocatedBudget: 5_000,
      today: TODAY,
    });
    assert.equal(funnel.backwardRead.ticketsRemaining, 0);
    assert.equal(funnel.spendReconciliation.requiredPerDayState, "sold_out");
    assert.equal(funnel.spendReconciliation.requiredPerDay, null);
  });
});
