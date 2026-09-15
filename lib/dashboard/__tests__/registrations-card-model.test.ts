import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CirqlinSnapshotRow } from "../../cirqlin/types.ts";
import type { MailchimpRegistrationsData } from "../../mailchimp/compute-registrations.ts";
import { buildRegistrationsCardModel } from "../registrations-card-model.ts";

const mailchimp: MailchimpRegistrationsData = {
  newSinceBaseline: 1686,
  totalSubscribers: 1686,
  baselineSubscribers: 0,
  lastSyncedAt: "2026-09-15T12:00:00Z",
  hasAudience: true,
  mailchimpAccountConnected: true,
};

const cirqlin: CirqlinSnapshotRow[] = [
  {
    day: "2026-08-26",
    signups_day: 64,
    signups_total: 1843,
    snapshot_at: "2026-09-15T12:00:00Z",
    raw_json: {
      totals: { counted: 1843 },
      sync: { mailchimp: { synced: 1837, failed: 4, skipped: 1 } },
    },
  },
];

describe("buildRegistrationsCardModel", () => {
  it("puts Cirqlin on the primary line and Mailchimp underneath", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: cirqlin,
      spendRows: [{ date: "2026-08-26", ad_spend: 1458 }],
      generalSaleAt: "2026-09-09T13:00:00+00:00",
      mailchimpTagged: 1723,
    });
    assert.equal(model.source, "cirqlin");
    assert.equal(model.primary, 1843);
    assert.equal(model.primaryCaption, "signups · Cirqlin");
    assert.equal(
      model.mailchimpLine,
      "1,686 subscribed in Mailchimp · 1,723 tagged",
    );
    assert.equal(
      model.syncFailureLine,
      "4 signups did not reach Mailchimp (invalid email)",
    );
    assert.equal(model.fallbackLine, null);
  });

  it("falls back to Mailchimp when Cirqlin has no page for the tag", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: [
        {
          day: "2026-09-15",
          signups_day: 0,
          signups_total: 0,
          snapshot_at: "2026-09-15T12:00:00Z",
          raw_json: { reason: "no_page", tag: "CQ-dod-newcastle" },
        },
      ],
      spendRows: [{ date: "2026-08-26", ad_spend: 100 }],
      generalSaleAt: "2026-09-09T13:00:00+00:00",
    });
    assert.equal(model.source, "mailchimp");
    assert.equal(model.primary, 1686);
    assert.equal(
      model.fallbackLine,
      "Cirqlin has no page for this tag — showing Mailchimp.",
    );
    assert.equal(model.mailchimpLine, null);
  });

  it("stays on Mailchimp when Cirqlin was never asked", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: null,
      spendRows: [],
      generalSaleAt: null,
    });
    assert.equal(model.source, "mailchimp");
    assert.equal(model.primary, 1686);
    assert.equal(model.fallbackLine, null);
  });
});
