import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CirqlinSnapshotRow } from "../../cirqlin/types.ts";
import type { MailchimpRegistrationsData } from "../../mailchimp/compute-registrations.ts";
import { readFileSync } from "node:fs";

import { buildRegistrationsCardModel } from "../registrations-card-model.ts";

const UNREACHABLE = "Cirqlin could not be reached — showing Mailchimp.";

const mailchimp: MailchimpRegistrationsData = {
  newSinceBaseline: 1686,
  totalSubscribers: 1686,
  baselineSubscribers: 0,
  lastSyncedAt: "2026-09-15T12:00:00Z",
  hasAudience: true,
  mailchimpAccountConnected: true,
};

const freshAt = "2026-09-15T12:00:00Z";
const nowMs = Date.parse("2026-09-15T18:00:00Z");

const cirqlin: CirqlinSnapshotRow[] = [
  {
    day: "2026-08-26",
    signups_day: 64,
    signups_total: 1843,
    snapshot_at: freshAt,
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
      nowMs,
    });
    assert.equal(model.source, "cirqlin");
    assert.equal(model.primary, 1843);
    assert.equal(model.primaryCaption, "signups · Cirqlin");
    assert.equal(model.mailchimpLine, "1,686 subscribed in Mailchimp");
    assert.equal(
      model.syncFailureLine,
      "4 signups did not reach Mailchimp (invalid email)",
    );
    assert.equal(model.fallbackLine, null);
  });

  it("captions a snapshot older than 48h with its capture date, not as current", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: [
        {
          ...cirqlin[0]!,
          snapshot_at: "2026-09-01T12:00:00Z",
        },
      ],
      spendRows: [],
      generalSaleAt: null,
      nowMs: Date.parse("2026-09-15T18:00:00Z"),
    });
    assert.equal(model.source, "cirqlin");
    assert.equal(model.primary, 1843);
    assert.equal(model.primaryCaption, "signups · Cirqlin · as of 1 Sept");
  });

  it("unauthorized with no snapshots (just the sync failure) shows Mailchimp and the sentence", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: null,
      spendRows: [],
      generalSaleAt: null,
      cirqlinFailure: "unauthorized",
      nowMs,
    });
    assert.equal(model.source, "mailchimp");
    assert.equal(model.primary, 1686);
    assert.equal(model.fallbackLine, UNREACHABLE);
  });

  it("a CRM tag with no snapshots is not an unanswered Cirqlin read", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: null,
      spendRows: [],
      generalSaleAt: null,
      cirqlinAsked: true,
      nowMs,
    });
    assert.equal(model.source, "mailchimp");
    assert.equal(model.primary, 1686);
    assert.equal(model.fallbackLine, null);
  });

  it("unauthorized with no prior rows shows Mailchimp and the unreachable sentence", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: [
        {
          day: "2026-09-15",
          signups_day: 0,
          signups_total: 0,
          snapshot_at: freshAt,
          raw_json: { reason: "unauthorized", tag: "CQ-dod-newcastle" },
        },
      ],
      spendRows: [],
      generalSaleAt: null,
      nowMs,
    });
    assert.equal(model.source, "mailchimp");
    assert.equal(model.primary, 1686);
    assert.equal(model.primaryCaption, "subscribed · Mailchimp");
    assert.equal(model.fallbackLine, UNREACHABLE);
  });

  it("unauthorized with prior rows keeps the stale Cirqlin number and its date", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: [
        {
          ...cirqlin[0]!,
          snapshot_at: "2026-09-01T12:00:00Z",
        },
        {
          day: "2026-09-15",
          signups_day: 0,
          signups_total: 0,
          snapshot_at: freshAt,
          raw_json: { reason: "unauthorized", tag: "CQ-dod-newcastle" },
        },
      ],
      spendRows: [],
      generalSaleAt: null,
      nowMs: Date.parse("2026-09-15T18:00:00Z"),
    });
    assert.equal(model.source, "cirqlin");
    assert.equal(model.primary, 1843);
    assert.equal(model.primaryCaption, "signups · Cirqlin · as of 1 Sept");
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
          snapshot_at: freshAt,
          raw_json: { reason: "no_page", tag: "CQ-dod-newcastle" },
        },
      ],
      spendRows: [{ date: "2026-08-26", ad_spend: 100 }],
      generalSaleAt: "2026-09-09T13:00:00+00:00",
      nowMs,
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
      nowMs,
    });
    assert.equal(model.source, "mailchimp");
    assert.equal(model.primary, 1686);
    assert.equal(model.fallbackLine, null);
  });

  it("keeps the no-signups CPR label when counted is 0 and there was spend", () => {
    const model = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: [
        {
          day: "2026-08-26",
          signups_day: 0,
          signups_total: 0,
          snapshot_at: freshAt,
          raw_json: { totals: { counted: 0 } },
        },
      ],
      spendRows: [{ date: "2026-08-26", ad_spend: 1458 }],
      generalSaleAt: "2026-09-09T13:00:00+00:00",
      nowMs,
    });
    assert.equal(model.primary, 0);
    assert.ok(model.cpr);
    assert.equal(
      model.cpr.label,
      "Cost per signup — no spend or signups in the signup phase",
    );
    assert.equal(model.cpr.spend, 1458);
  });

  it("does not carry a mailchimpTagged input — there is no source for it", () => {
    const src = readFileSync(
      new URL("../registrations-card-model.ts", import.meta.url),
      "utf8",
    );
    assert.equal(src.includes("mailchimpTagged"), false);
  });
});
